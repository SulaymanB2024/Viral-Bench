import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import {
  APIFY_API_BASE,
  ApifyApiClient,
  canonicalJson,
  type ApifyActorExecution,
} from './apify-api';
import { atomicWriteJson } from './artifact-integrity';

import {
  DEFAULT_SEMANTIC_ARTIFACT_DIR,
  MARENGO_MODEL,
  PEGASUS_MODEL,
  PROVIDER_MODEL_REVISION_UNKNOWN,
  SOCIAL_PLATFORMS,
  SqliteSemanticStore,
  actorIdForPlatform,
  assertPublicUrlIngestionAllowed,
  normalizeActorItems,
  normalizePublicPostUrl,
  storeContentAddressedMedia,
  validateUrlIntakeRequest,
  validateVideoCreativeAnalysis,
  writeRawActorArtifact,
  type NormalizedSocialPost,
  type SemanticItem,
  type SemanticSearchHit,
  type SemanticSearchQuery,
  type SocialPlatform,
  type UrlIntakeRequest,
  type VideoCreativeAnalysis,
} from './semantic-intelligence';

export { APIFY_API_BASE };
export { TwelveLabsBatchClient, failedOnlyRetryRequest, estimatePegasusBatchItemUsd } from './twelvelabs-batch';
export const TWELVELABS_API_BASE = 'https://api.twelvelabs.io/v1.3';

export interface SemanticPreflightReport {
  request_id: string;
  request_approved: boolean;
  public_url_gate_enabled: boolean;
  paid_generation_gate_enabled: boolean;
  credentials: {
    apify_token_available: boolean;
    twelvelabs_api_key_available: boolean;
  };
  actor_configuration: Record<SocialPlatform, { configured: boolean; environment_key: string }>;
  models: {
    embeddings: typeof MARENGO_MODEL;
    analysis: typeof PEGASUS_MODEL;
  };
  live_ready: boolean;
  blockers: string[];
  external_calls_made: 0;
  credential_policy: 'presence_only_no_values';
}

export interface ProviderCostEntry {
  provider: 'apify' | 'twelvelabs' | 'gemini';
  operation: string;
  estimated_cost_usd: number;
  actual_cost_usd: number | null;
}

export interface SemanticIngestionReport {
  request_id: string;
  status: 'completed' | 'partial' | 'blocked' | 'failed';
  posts_ingested: number;
  text_only_posts: number;
  semantic_items_written: number;
  external_calls_made: number;
  costs: ProviderCostEntry[];
  total_cost_usd: number;
  model_traces: Array<{ provider: string; model: string; version: string }>;
  evidence_ids: string[];
  output_paths: string[];
  blockers: string[];
  errors: string[];
  measurement_gaps: string[];
  ingestion_reconciliation: ProviderIngestionReconciliation[];
  redactions: ['credential values are never serialized'];
}

export interface ProviderIngestionReconciliation {
  platform: SocialPlatform;
  requested_urls: number;
  provider_items_returned: number;
  provider_items_total_reported: number | null;
  dataset_truncated: boolean;
  dataset_truncation_unknown: boolean;
  accepted: number;
  excluded: number;
  quarantined: number;
  unmatched_requested_urls: string[];
  exclusions: Array<{ dataset_item_offset: number; reason: string; raw_item_sha256: string }>;
  quarantines: Array<{ dataset_item_offset: number; reason: string; raw_item_sha256: string }>;
  reconciliation_passed: boolean;
}

export interface ApifyRunResult {
  run_id: string;
  dataset_id: string;
  actor_id: string;
  actor_build_id: string | null;
  actor_build_number: string | null;
  actor_input_sha256: string;
  actor_input_mode: ApifyActorExecution['actor_input_mode'];
  status: 'SUCCEEDED';
  items: unknown[];
  dataset_items_returned: number;
  dataset_items_total_reported: number | null;
  dataset_truncated: boolean;
  dataset_truncation_unknown: boolean;
  linked_datasets: ApifyLinkedDataset[];
  supplemental_runs: ApifySupplementalRun[];
  actual_cost_usd: number | null;
  usage_finalized: boolean;
  pricing_info: unknown | null;
  charged_event_counts: Record<string, number> | null;
  external_calls_made: number;
  resumed: boolean;
}

export interface ApifySupplementalRun {
  kind: 'instagram_comments_high_engagement' | 'instagram_comments_recent';
  run_id: string;
  dataset_id: string;
  actor_build_id: string | null;
  actor_build_number: string | null;
  actor_input_sha256: string;
  dataset_items_returned: number;
  dataset_items_total_reported: number | null;
  dataset_truncated: boolean;
  dataset_truncation_unknown: boolean;
  actual_cost_usd: number | null;
  usage_finalized: boolean;
}

export interface ApifyLinkedDataset {
  kind: 'comments';
  dataset_id: string;
  source_item_index: number;
  source_field: string;
  items: unknown[];
}

export interface TwelveLabsEmbeddingSegment {
  embedding: number[];
  start_sec: number | null;
  end_sec: number | null;
  scope: string | null;
  modality: string | null;
}

export interface SemanticEvidenceBundle {
  query: SemanticSearchQuery;
  created_at: string;
  ranking_policy: {
    default_order: 'retrieval_relevance';
    fusion: 'reciprocal_rank_fusion';
    rrf_k: 60;
    vector_candidates: 200;
    fts_candidates: 200;
    outcome_changes_semantic_rank: false;
  };
  hits: SemanticSearchHit[];
  posts: Array<{
    post_id: string;
    canonical_url: string;
    platforms: SocialPlatform[];
    accounts: string[];
    hashtags: string[];
    evidence_ids: string[];
    hit_types: string[];
  }>;
}

export interface SemanticPipelineOptions {
  dbPath: string;
  artifactDir?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  apifyUsageSettlementMs?: number;
  apifyDatasetPageSize?: number;
  apifyMaxDatasetItems?: number;
  apifyMaxRetryAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

interface TwelveLabsEmbedResponse {
  data?: Array<{
    embedding?: number[];
    start_sec?: number;
    end_sec?: number;
    start_offset_sec?: number;
    end_offset_sec?: number;
    embedding_scope?: string;
    embedding_option?: string;
  }>;
  error?: { message?: string; code?: string };
}

interface PegasusResponse {
  id?: string;
  data?: unknown;
  text?: string;
  result?: unknown;
  finish_reason?: 'stop' | 'length';
  usage?: { output_tokens?: number; input_tokens?: number };
  error?: { message?: string; code?: string };
}

export interface TwelveLabsStructuredAnalysis<T extends object> {
  data: T;
  provider_generation_id: string | null;
  finish_reason: 'stop';
  usage: { input_tokens: number | null; output_tokens: number | null };
}

export interface TwelveLabsSegmentField {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'integer' | 'array';
  description: string;
  enum?: Array<string | number | boolean>;
}

export interface TwelveLabsSegmentDefinition {
  id: string;
  description: string;
  fields: TwelveLabsSegmentField[];
}

export interface TwelveLabsTimeSegment {
  start_time: number;
  end_time: number;
  metadata: Record<string, unknown>;
}

export interface TwelveLabsSegmentationAnalysis {
  task_id: string;
  provider_generation_id: string | null;
  finish_reason: 'stop';
  usage: { input_tokens: number | null; output_tokens: number | null };
  segments: Record<string, TwelveLabsTimeSegment[]>;
}

export interface TwelveLabsAsset {
  _id: string;
  method: 'direct' | 'url' | 'multipart' | string;
  status: 'processing' | 'ready' | 'failed';
  filename: string | null;
  file_type: string | null;
  duration: number | null;
  size: number | null;
  created_at: string | null;
  user_metadata: Record<string, string | number | boolean> | null;
  error: unknown | null;
}

interface ApifyRunPolicy {
  maxCostUsd?: number;
  commentPolicy?: UrlIntakeRequest['comment_policy'];
}

interface NormalizationProvenance {
  actor_id: string;
  actor_build_id?: string | null;
  actor_build_number?: string | null;
  actor_input_sha256?: string | null;
  actor_input_mode?: 'explicit_url' | 'search' | 'profile' | 'channel' | 'hashtag';
  run_id: string;
  dataset_id: string;
  raw_artifact_path: string;
  collected_at?: string;
}

export function normalizeProviderItemsWithReconciliation(
  request: UrlIntakeRequest,
  platform: SocialPlatform,
  items: unknown[],
  provenance: NormalizationProvenance,
  completeness: {
    dataset_items_total_reported: number | null;
    dataset_truncated: boolean;
    dataset_truncation_unknown: boolean;
  },
): { posts: NormalizedSocialPost[]; reconciliation: ProviderIngestionReconciliation } {
  const posts: NormalizedSocialPost[] = [];
  const exclusions: ProviderIngestionReconciliation['exclusions'] = [];
  const quarantines: ProviderIngestionReconciliation['quarantines'] = [];
  let acceptedItems = 0;
  for (const [index, item] of items.entries()) {
    const rawItemSha256 = stableHash(canonicalJson(item));
    const exclusionReason = providerItemExclusionReason(item);
    if (exclusionReason) {
      exclusions.push({
        dataset_item_offset: index,
        reason: exclusionReason,
        raw_item_sha256: rawItemSha256,
      });
      continue;
    }
    try {
      const normalized = normalizeActorItems(request, platform, [item], {
        ...provenance,
        dataset_item_offset: index,
      });
      if (!normalized.length) {
        quarantines.push({
          dataset_item_offset: index,
          reason: 'normalize:no_post_emitted',
          raw_item_sha256: rawItemSha256,
        });
        continue;
      }
      posts.push(...normalized);
      acceptedItems += 1;
    } catch (error) {
      quarantines.push({
        dataset_item_offset: index,
        reason: redactProviderError('normalize', errorMessage(error)),
        raw_item_sha256: rawItemSha256,
      });
    }
  }
  const acceptedUrls = new Set(posts.map((post) => post.canonical_url));
  const requestedUrls = request.urls
    .filter((url) => normalizePublicPostUrl(url).platform === platform)
    .map((url) => normalizePublicPostUrl(url).canonical_url);
  const reconciliation: ProviderIngestionReconciliation = {
    platform,
    requested_urls: requestedUrls.length,
    provider_items_returned: items.length,
    provider_items_total_reported: completeness.dataset_items_total_reported,
    dataset_truncated: completeness.dataset_truncated,
    dataset_truncation_unknown: completeness.dataset_truncation_unknown,
    accepted: acceptedItems,
    excluded: exclusions.length,
    quarantined: quarantines.length,
    unmatched_requested_urls: requestedUrls.filter((url) => !acceptedUrls.has(url)),
    exclusions,
    quarantines,
    reconciliation_passed: acceptedItems + exclusions.length + quarantines.length === items.length,
  };
  if (!reconciliation.reconciliation_passed) {
    throw new Error(`provider item reconciliation failed for ${platform}`);
  }
  return { posts, reconciliation };
}

function providerItemExclusionReason(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const explicit = ['error', 'errorCode', 'errorDescription', 'errorMessage']
    .map((field) => record[field])
    .find((entry) => typeof entry === 'string' && entry.trim());
  if (typeof explicit === 'string') {
    return `provider_gap:${redactProviderError('provider', explicit).slice(0, 240)}`;
  }
  if (Array.isArray(record.requestErrorMessages) && record.requestErrorMessages.length) {
    return 'provider_gap:request_error_messages';
  }
  return null;
}

export function buildSemanticPreflight(
  requestInput: UrlIntakeRequest | unknown,
  env: Record<string, string | undefined> = process.env,
): SemanticPreflightReport {
  const request = validateUrlIntakeRequest(requestInput);
  const publicGate = enabled(env, 'ALLOW_PUBLIC_URL_INGESTION');
  const paidGate = enabled(env, 'ALLOW_PAID_GENERATION');
  const apifyCredential = Boolean(nonEmpty(env.APIFY_TOKEN));
  const twelveLabsCredential = Boolean(nonEmpty(env.TWELVELABS_API_KEY));
  const actorConfiguration = {
    tiktok: { configured: Boolean(nonEmpty(env.APIFY_ACTOR_TIKTOK)), environment_key: 'APIFY_ACTOR_TIKTOK' },
    instagram: { configured: Boolean(nonEmpty(env.APIFY_ACTOR_INSTAGRAM)), environment_key: 'APIFY_ACTOR_INSTAGRAM' },
    youtube_shorts: { configured: Boolean(nonEmpty(env.APIFY_ACTOR_YOUTUBE)), environment_key: 'APIFY_ACTOR_YOUTUBE' },
  } satisfies SemanticPreflightReport['actor_configuration'];
  const blockers: string[] = [];
  if (request.approval_state !== 'approved') blockers.push('url_intake_not_approved');
  if (!publicGate) blockers.push('ALLOW_PUBLIC_URL_INGESTION');
  if (!paidGate) blockers.push('ALLOW_PAID_GENERATION');
  if (!apifyCredential) blockers.push('APIFY_TOKEN');
  if (!twelveLabsCredential) blockers.push('TWELVELABS_API_KEY');
  for (const platform of request.allowed_platforms) {
    if (!actorConfiguration[platform].configured) blockers.push(actorConfiguration[platform].environment_key);
  }
  if (request.cost_limits.max_total_usd <= 0 || request.cost_limits.max_apify_usd <= 0 || request.cost_limits.max_twelvelabs_usd <= 0) {
    blockers.push('positive ingestion cost limits');
  }
  return {
    request_id: request.request_id,
    request_approved: request.approval_state === 'approved',
    public_url_gate_enabled: publicGate,
    paid_generation_gate_enabled: paidGate,
    credentials: {
      apify_token_available: apifyCredential,
      twelvelabs_api_key_available: twelveLabsCredential,
    },
    actor_configuration: actorConfiguration,
    models: { embeddings: MARENGO_MODEL, analysis: PEGASUS_MODEL },
    live_ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    external_calls_made: 0,
    credential_policy: 'presence_only_no_values',
  };
}

export async function runApifyActorForUrls(
  platform: SocialPlatform,
  urls: string[],
  options: SemanticPipelineOptions,
  policy: ApifyRunPolicy = {},
): Promise<ApifyRunResult> {
  const env = options.env ?? process.env;
  const token = nonEmpty(env.APIFY_TOKEN);
  if (!token) throw new Error('APIFY_TOKEN is required for an approved live Apify call.');
  const actorId = actorIdForPlatform(platform, env);
  const artifactDir = path.resolve(options.artifactDir ?? DEFAULT_SEMANTIC_ARTIFACT_DIR);
  const input = buildApifyActorInput(platform, urls, env, policy.commentPolicy);
  const build = nonEmpty(env[actorBuildEnv(platform)]);
  const cacheIdentity = canonicalJson({
    platform,
    actorId,
    build: build ?? null,
    input,
    commentPolicy: policy.commentPolicy ?? null,
  });
  const statePath = path.join(artifactDir, 'apify-runs', `${safeName(platform)}-${stableHash(cacheIdentity).slice(0, 16)}.json`);
  const previous = readJsonIfExists<ApifyRunResult>(statePath);
  if (previous?.status === 'SUCCEEDED' && previous.dataset_id && Array.isArray(previous.items)) {
    return {
      ...previous,
      actor_build_id: previous.actor_build_id ?? null,
      actor_build_number: previous.actor_build_number ?? null,
      actor_input_sha256: previous.actor_input_sha256 ?? stableHash(canonicalJson(input)),
      actor_input_mode: previous.actor_input_mode ?? 'explicit_url',
      dataset_items_returned: previous.dataset_items_returned ?? previous.items.length,
      dataset_items_total_reported: previous.dataset_items_total_reported ?? null,
      dataset_truncated: previous.dataset_truncated ?? false,
      dataset_truncation_unknown: previous.dataset_truncation_unknown ?? false,
      linked_datasets: Array.isArray(previous.linked_datasets) ? previous.linked_datasets : [],
      supplemental_runs: Array.isArray(previous.supplemental_runs) ? previous.supplemental_runs : [],
      usage_finalized: previous.usage_finalized ?? false,
      pricing_info: previous.pricing_info ?? null,
      charged_event_counts: previous.charged_event_counts ?? null,
      external_calls_made: 0,
      resumed: true,
    };
  }
  const estimatedCost = nonNegativeEnvNumber(env.APIFY_ESTIMATED_RUN_COST_USD, 0);
  const environmentCeiling = nonNegativeEnvNumber(env.APIFY_RUN_COST_CEILING_USD, Number.POSITIVE_INFINITY);
  const policyCeiling = typeof policy.maxCostUsd === 'number' && Number.isFinite(policy.maxCostUsd)
    ? policy.maxCostUsd
    : Number.POSITIVE_INFINITY;
  const requestCeiling = Math.min(environmentCeiling, policyCeiling);
  if (!Number.isFinite(requestCeiling) || requestCeiling <= 0) {
    throw new Error('Apify live calls require a positive finite request cost ceiling.');
  }
  if (estimatedCost > requestCeiling) throw new Error('cost_exhausted:apify_estimate_exceeds_run_ceiling');
  const supplementalSpecs = instagramCommentRunSpecs(platform, urls, input, policy.commentPolicy);
  const runCeilings = splitUsdCeiling(requestCeiling, 1 + supplementalSpecs.length);
  const client = new ApifyApiClient({
    token,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetryAttempts: options.apifyMaxRetryAttempts,
  });
  const execution = await client.executeActor({
    actorId,
    input,
    inputMode: 'explicit_url',
    maxTotalChargeUsd: runCeilings[0],
    maxItems: urls.length,
    build,
    pollIntervalMs: options.pollIntervalMs,
    maxPollAttempts: options.maxPollAttempts,
    datasetPageSize: options.apifyDatasetPageSize,
    maxDatasetItems: options.apifyMaxDatasetItems,
    usageSettlementMs: options.apifyUsageSettlementMs,
  });
  const linked = await fetchLinkedApifyDatasets(execution.items, { client });
  const supplementalRuns: ApifySupplementalRun[] = [];
  const supplementalDatasets: ApifyLinkedDataset[] = [];
  const knownCosts: Array<number | null> = [execution.actual_cost_usd];
  for (const [specIndex, spec] of supplementalSpecs.entries()) {
    const supplemental = await client.executeActor({
      actorId,
      input: spec.input,
      inputMode: 'explicit_url',
      maxTotalChargeUsd: runCeilings[specIndex + 1],
      maxItems: spec.maxItems,
      build,
      pollIntervalMs: options.pollIntervalMs,
      maxPollAttempts: options.maxPollAttempts,
      datasetPageSize: options.apifyDatasetPageSize,
      maxDatasetItems: spec.maxItems + urls.length,
      usageSettlementMs: options.apifyUsageSettlementMs,
    });
    knownCosts.push(supplemental.actual_cost_usd);
    supplementalRuns.push({
      kind: spec.kind,
      run_id: supplemental.run_id,
      dataset_id: supplemental.dataset_id,
      actor_build_id: supplemental.actor_build_id,
      actor_build_number: supplemental.actor_build_number,
      actor_input_sha256: supplemental.actor_input_sha256,
      dataset_items_returned: supplemental.dataset_items_returned,
      dataset_items_total_reported: supplemental.dataset_items_total_reported,
      dataset_truncated: supplemental.dataset_truncated,
      dataset_truncation_unknown: supplemental.dataset_truncation_unknown,
      actual_cost_usd: supplemental.actual_cost_usd,
      usage_finalized: supplemental.usage_finalized,
    });
    supplementalDatasets.push(...instagramCommentDatasets(
      execution.items,
      urls,
      supplemental.items,
      supplemental.dataset_id,
      spec.kind,
    ));
  }
  const result: ApifyRunResult = {
    ...execution,
    linked_datasets: [...linked.datasets, ...supplementalDatasets],
    supplemental_runs: supplementalRuns,
    actual_cost_usd: sumKnownCosts(knownCosts),
    external_calls_made: client.externalCallsMade,
    resumed: false,
  };
  writeJsonAtomic(statePath, result);
  return result;
}

export class TwelveLabsClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private calls = 0;

  constructor(options: {
    apiKey: string;
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
  }) {
    if (!options.apiKey.trim()) throw new Error('TWELVELABS_API_KEY is required.');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? wait;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maxPollAttempts = options.maxPollAttempts ?? 300;
  }

  get externalCallsMade(): number {
    return this.calls;
  }

  async createAsset(input: {
    localPath?: string;
    url?: string;
    filename?: string;
    userMetadata?: Record<string, string | number | boolean>;
  }): Promise<TwelveLabsAsset> {
    if (Boolean(input.localPath) === Boolean(input.url)) {
      throw new Error('TwelveLabs asset creation requires exactly one localPath or direct raw-media URL.');
    }
    const form = new FormData();
    if (input.localPath) {
      const resolved = path.resolve(input.localPath);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) throw new Error('TwelveLabs asset localPath must be a file.');
      if (stat.size > 200 * 1024 * 1024) throw new Error('TwelveLabs direct asset upload exceeds 200 MB.');
      const bytes = fs.readFileSync(resolved);
      const filename = input.filename?.trim() || path.basename(resolved);
      form.append('method', 'direct');
      form.append('file', new Blob([new Uint8Array(bytes)]), filename);
      form.append('filename', filename);
    } else {
      const url = assertTwelveLabsRawMediaUrl(input.url!);
      form.append('method', 'url');
      form.append('url', url);
      if (input.filename?.trim()) form.append('filename', input.filename.trim());
    }
    form.append('enable_hls', 'false');
    form.append('enable_thumbnail', 'false');
    if (input.userMetadata) form.append('user_metadata', JSON.stringify(input.userMetadata));
    const created = await this.requestRaw<Record<string, unknown>>('/assets', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
      body: form,
    }, 'TwelveLabs asset create');
    const assetId = textOrNull(created._id);
    if (!assetId) throw new Error('TwelveLabs asset create returned no asset ID.');
    return this.waitForAsset(assetId);
  }

  async retrieveAsset(assetId: string): Promise<TwelveLabsAsset> {
    const response = await this.requestRaw<Record<string, unknown>>(
      `/assets/${encodeURIComponent(assetId)}`,
      { method: 'GET', headers: { 'x-api-key': this.apiKey, Accept: 'application/json' } },
      'TwelveLabs asset retrieve',
      true,
    );
    return parseTwelveLabsAsset(response);
  }

  async waitForAsset(assetId: string): Promise<TwelveLabsAsset> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const asset = await this.retrieveAsset(assetId);
      if (asset.status === 'ready') return asset;
      if (asset.status === 'failed') throw new Error(`twelvelabs_asset_failed:${safeProviderDetail(asset.error)}`);
      if (attempt === this.maxPollAttempts - 1) throw new Error('twelvelabs_asset_poll_timeout');
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error('twelvelabs_asset_poll_timeout');
  }

  async embedText(text: string): Promise<number[]> {
    const response = await this.request<TwelveLabsEmbedResponse>('/embed-v2', {
      input_type: 'text',
      model_name: MARENGO_MODEL,
      text: { input_text: text },
    }, 'TwelveLabs text embedding');
    return requireEmbedding(response.data?.[0]?.embedding, 'TwelveLabs text embedding');
  }

  async embedVideo(input: { assetId?: string; localPath?: string; url?: string; startSec?: number; endSec?: number }): Promise<TwelveLabsEmbeddingSegment[]> {
    const sourceCount = [input.assetId, input.localPath, input.url].filter(Boolean).length;
    if (sourceCount !== 1) throw new Error('TwelveLabs video embedding requires exactly one assetId, localPath, or direct URL.');
    const mediaSource = input.assetId
      ? { asset_id: input.assetId }
      : input.localPath
      ? { base64_string: fs.readFileSync(input.localPath).toString('base64') }
      : input.url ? { url: assertTwelveLabsRawMediaUrl(input.url) } : null;
    if (!mediaSource) throw new Error('TwelveLabs video embedding requires localPath or direct URL.');
    if ('base64_string' in mediaSource
      && typeof mediaSource.base64_string === 'string'
      && Buffer.byteLength(mediaSource.base64_string, 'base64') > 36 * 1024 * 1024) {
      throw new Error('TwelveLabs sync video embedding base64 input exceeds 36 MB.');
    }
    const response = await this.request<TwelveLabsEmbedResponse>('/embed-v2', {
      input_type: 'video',
      model_name: MARENGO_MODEL,
      video: {
        media_source: mediaSource,
        ...(input.startSec === undefined ? {} : { start_sec: input.startSec }),
        ...(input.endSec === undefined ? {} : { end_sec: input.endSec }),
        segmentation: { strategy: 'dynamic', dynamic: { min_duration_sec: 3 } },
        embedding_option: ['visual', 'audio', 'transcription'],
        embedding_scope: ['clip', 'asset'],
        embedding_type: ['separate_embedding', 'fused_embedding'],
      },
    }, 'TwelveLabs video embedding');
    const segments = response.data ?? [];
    if (!segments.length) throw new Error('TwelveLabs video embedding returned no segments.');
    return segments.map((segment) => ({
      embedding: requireEmbedding(segment.embedding, 'TwelveLabs video embedding segment'),
      start_sec: finiteNumber(segment.start_sec ?? segment.start_offset_sec),
      end_sec: finiteNumber(segment.end_sec ?? segment.end_offset_sec),
      scope: textOrNull(segment.embedding_scope),
      modality: textOrNull(segment.embedding_option),
    }));
  }

  async analyzeVideo(input: {
    videoAssetId: string;
    assetId?: string;
    localPath?: string;
    url?: string;
    modelRevision?: string | null;
    prompt?: string;
    startSec?: number;
    endSec?: number;
    maxTokens?: number;
  }): Promise<VideoCreativeAnalysis> {
    const sourceCount = [input.assetId, input.localPath, input.url].filter(Boolean).length;
    if (sourceCount !== 1) throw new Error('Pegasus analysis requires exactly one assetId, localPath, or direct URL.');
    const mediaSource = input.assetId
      ? { type: 'asset_id', asset_id: input.assetId }
      : input.localPath
      ? { type: 'base64_string', base64_string: fs.readFileSync(input.localPath).toString('base64') }
      : input.url ? { type: 'url', url: assertTwelveLabsRawMediaUrl(input.url) } : null;
    if (!mediaSource) throw new Error('Pegasus analysis requires localPath or direct URL.');
    if ('base64_string' in mediaSource
      && typeof mediaSource.base64_string === 'string'
      && Buffer.byteLength(mediaSource.base64_string, 'base64') > 30 * 1024 * 1024) {
      throw new Error('TwelveLabs sync Pegasus base64 input exceeds 30 MB.');
    }
    const response = await this.request<PegasusResponse>('/analyze', {
      model_name: PEGASUS_MODEL,
      video: mediaSource,
      ...(input.startSec === undefined ? {} : { start_time: input.startSec }),
      ...(input.endSec === undefined ? {} : { end_time: input.endSec }),
      prompt: input.prompt?.trim()
        ? `${input.prompt.trim()}\n\nReturn the exact requested creative-analysis schema. Ground every field in visible or audible evidence and use seconds for all timestamps. State limitations instead of guessing.`
        : 'Analyze this short-form ad. Ground every field in visible or audible evidence and use seconds for all timestamps. State limitations instead of guessing.',
      stream: false,
      temperature: 0.1,
      max_tokens: input.maxTokens ?? 4_096,
      response_format: {
        type: 'json_schema',
        json_schema: pegasusCreativeAnalysisSchema(),
      },
    }, 'TwelveLabs Pegasus analysis');
    if (response.finish_reason === 'length') {
      throw new Error('Pegasus structured response was truncated before schema validation completed.');
    }
    const payload = parsePegasusPayload(response.data ?? response.result ?? response.text);
    const wrapped = {
      ...payload,
      analysis_id: `${input.videoAssetId}:analysis:${stableHash(JSON.stringify(payload)).slice(0, 16)}`,
      video_asset_id: input.videoAssetId,
      model_name: PEGASUS_MODEL,
      model_version: PROVIDER_MODEL_REVISION_UNKNOWN,
      model_revision: input.modelRevision ?? null,
      provider_generation_id: textOrNull(response.id),
      provider_asset_id: input.assetId ?? null,
      provider_analysis_task_id: null,
      finish_reason: 'stop' as const,
      usage: {
        input_tokens: integerOrNull(response.usage?.input_tokens),
        output_tokens: integerOrNull(response.usage?.output_tokens),
      },
      created_at: new Date().toISOString(),
    };
    return validateVideoCreativeAnalysis(wrapped);
  }

  async analyzeStructured<T extends object>(input: {
    assetId: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<TwelveLabsStructuredAnalysis<T>> {
    if (!input.assetId.trim()) throw new Error('Pegasus structured analysis requires an asset ID.');
    if (!input.prompt.trim()) throw new Error('Pegasus structured analysis requires a focused prompt.');
    const response = await this.request<PegasusResponse>('/analyze', {
      model_name: PEGASUS_MODEL,
      video: { type: 'asset_id', asset_id: input.assetId.trim() },
      prompt: input.prompt.trim(),
      stream: false,
      temperature: 0.1,
      max_tokens: input.maxTokens ?? 2_048,
      response_format: {
        type: 'json_schema',
        json_schema: input.jsonSchema,
      },
    }, 'TwelveLabs Pegasus structured analysis');
    if (response.finish_reason === 'length') {
      throw new Error('Pegasus focused structured response was truncated.');
    }
    return {
      data: parsePegasusPayload(response.data ?? response.result ?? response.text) as T,
      provider_generation_id: textOrNull(response.id),
      finish_reason: 'stop',
      usage: {
        input_tokens: integerOrNull(response.usage?.input_tokens),
        output_tokens: integerOrNull(response.usage?.output_tokens),
      },
    };
  }

  async segmentVideo(input: {
    assetId: string;
    customId: string;
    segmentDefinitions: TwelveLabsSegmentDefinition[];
    minSegmentDuration?: number;
    maxSegmentDuration?: number;
    maxTokens?: number;
  }): Promise<TwelveLabsSegmentationAnalysis> {
    if (!input.assetId.trim()) throw new Error('TwelveLabs segmentation requires an asset ID.');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.customId)) {
      throw new Error('TwelveLabs segmentation customId must contain 1-64 letters, numbers, underscores, or hyphens.');
    }
    validateSegmentDefinitions(input.segmentDefinitions);
    const minSegmentDuration = input.minSegmentDuration ?? 2;
    const maxSegmentDuration = input.maxSegmentDuration ?? 4;
    if (minSegmentDuration < 2 || maxSegmentDuration < minSegmentDuration) {
      throw new Error('TwelveLabs segment duration constraints must be at least two seconds and ordered.');
    }
    const body = {
      video: { type: 'asset_id', asset_id: input.assetId.trim() },
      model_name: PEGASUS_MODEL,
      custom_id: input.customId,
      analysis_mode: 'time_based_metadata',
      temperature: 0.1,
      max_tokens: input.maxTokens ?? 32_768,
      min_segment_duration: minSegmentDuration,
      max_segment_duration: maxSegmentDuration,
      response_format: {
        type: 'segment_definitions',
        segment_definitions: input.segmentDefinitions,
      },
    };
    const idempotencyKey = `segment-${stableHash(canonicalJson(body)).slice(0, 48)}`;
    const created = await this.requestRaw<Record<string, unknown>>('/analyze/tasks', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    }, 'TwelveLabs segmentation task create', true);
    const taskId = textOrNull(created.task_id);
    if (!taskId) throw new Error('TwelveLabs segmentation task create returned no task ID.');

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const task = await this.requestRaw<Record<string, unknown>>(
        `/analyze/tasks/${encodeURIComponent(taskId)}`,
        { method: 'GET', headers: { 'x-api-key': this.apiKey, Accept: 'application/json' } },
        'TwelveLabs segmentation task retrieve',
        true,
      );
      const status = textOrNull(task.status);
      if (status === 'failed') {
        throw new Error(`twelvelabs_segmentation_failed:${safeProviderDetail(task.error)}`);
      }
      if (status === 'ready') {
        const result = task.result && typeof task.result === 'object' && !Array.isArray(task.result)
          ? task.result as Record<string, unknown>
          : null;
        if (!result) throw new Error('TwelveLabs ready segmentation task returned no result.');
        if (result.finish_reason === 'length') {
          throw new Error('TwelveLabs segmentation response was truncated.');
        }
        return {
          task_id: taskId,
          provider_generation_id: textOrNull(result.generation_id),
          finish_reason: 'stop',
          usage: {
            input_tokens: integerOrNull((result.usage as Record<string, unknown> | undefined)?.input_tokens),
            output_tokens: integerOrNull((result.usage as Record<string, unknown> | undefined)?.output_tokens),
          },
          segments: parseTwelveLabsSegments(result.data, input.segmentDefinitions),
        };
      }
      if (!status || !['queued', 'pending', 'processing'].includes(status)) {
        throw new Error('TwelveLabs segmentation task returned an unknown status.');
      }
      if (attempt === this.maxPollAttempts - 1) throw new Error('twelvelabs_segmentation_poll_timeout');
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error('twelvelabs_segmentation_poll_timeout');
  }

  private async request<T>(endpoint: string, body: unknown, label: string): Promise<T> {
    return this.requestRaw<T>(endpoint, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, label);
  }

  private async requestRaw<T>(
    endpoint: string,
    init: RequestInit,
    label: string,
    retrySafe = false,
  ): Promise<T> {
    const maxAttempts = retrySafe ? 4 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response: Response;
      this.calls += 1;
      try {
        response = await this.fetchImpl(`${TWELVELABS_API_BASE}${endpoint}`, init);
      } catch {
        if (!retrySafe || attempt === maxAttempts - 1) {
          throw new Error(`${label}:network_error${retrySafe ? '' : '_after_non_idempotent_request'}`);
        }
        await this.sleep(500 * (2 ** attempt));
        continue;
      }
      if (retrySafe && (response.status === 429 || response.status >= 500) && attempt < maxAttempts - 1) {
        await this.sleep(retryAfterMs(response.headers.get('retry-after'), 500 * (2 ** attempt)));
        continue;
      }
      return jsonResponse<T>(response, label);
    }
    throw new Error(`${label}:retry_exhausted`);
  }
}

export async function ingestSemanticUrlsLive(
  requestInput: UrlIntakeRequest | unknown,
  options: SemanticPipelineOptions,
): Promise<SemanticIngestionReport> {
  const env = options.env ?? process.env;
  const request = assertPublicUrlIngestionAllowed(requestInput, env);
  if (!enabled(env, 'ALLOW_PAID_GENERATION')) throw new Error('live semantic ingestion is blocked unless ALLOW_PAID_GENERATION=true');
  const preflight = buildSemanticPreflight(request, env);
  if (!preflight.live_ready) return blockedIngestion(request.request_id, preflight.blockers);
  const client = new TwelveLabsClient({
    apiKey: nonEmpty(env.TWELVELABS_API_KEY)!,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    pollIntervalMs: options.pollIntervalMs,
    maxPollAttempts: options.maxPollAttempts,
  });
  const store = new SqliteSemanticStore(options.dbPath);
  store.initialize();
  const artifactDir = path.resolve(options.artifactDir ?? DEFAULT_SEMANTIC_ARTIFACT_DIR);
  const posts: NormalizedSocialPost[] = [];
  const costs: ProviderCostEntry[] = [];
  const errors: string[] = [];
  const measurementGaps: string[] = [];
  const ingestionReconciliation: ProviderIngestionReconciliation[] = [];
  let externalCalls = 0;

  for (const platform of SOCIAL_PLATFORMS) {
    const urls = request.urls.filter((url) => normalizePublicPostUrl(url).platform === platform);
    if (!urls.length) continue;
    try {
      const run = await runApifyActorForUrls(platform, urls, options, {
        maxCostUsd: request.cost_limits.max_apify_usd,
        commentPolicy: request.comment_policy,
      });
      externalCalls += run.external_calls_made;
      const rawArtifactPath = writeRawActorArtifact(request.request_id, platform, {
        run_metadata: {
          actor_id: run.actor_id,
          actor_build_id: run.actor_build_id,
          actor_build_number: run.actor_build_number,
          actor_input_sha256: run.actor_input_sha256,
          run_id: run.run_id,
          dataset_id: run.dataset_id,
          dataset_items_returned: run.dataset_items_returned,
          dataset_items_total_reported: run.dataset_items_total_reported,
          dataset_truncated: run.dataset_truncated,
          dataset_truncation_unknown: run.dataset_truncation_unknown,
        },
        primary_dataset: run.items,
        linked_datasets: run.linked_datasets,
      }, artifactDir);
      const normalizedResult = normalizeProviderItemsWithReconciliation(
        request,
        platform,
        mergeLinkedComments(run.items, run.linked_datasets),
        {
        actor_id: run.actor_id,
        actor_build_id: run.actor_build_id,
        actor_build_number: run.actor_build_number,
        actor_input_sha256: run.actor_input_sha256,
        actor_input_mode: run.actor_input_mode,
        run_id: run.run_id,
        dataset_id: run.dataset_id,
        raw_artifact_path: rawArtifactPath,
        collected_at: (options.now ?? (() => new Date()))().toISOString(),
        },
        {
          dataset_items_total_reported: run.dataset_items_total_reported,
          dataset_truncated: run.dataset_truncated,
          dataset_truncation_unknown: run.dataset_truncation_unknown,
        },
      );
      const normalized = normalizedResult.posts;
      ingestionReconciliation.push(normalizedResult.reconciliation);
      if (run.dataset_truncated || run.dataset_truncation_unknown) {
        measurementGaps.push(`${platform}: provider dataset completeness is truncated or unknown.`);
      }
      if (normalizedResult.reconciliation.unmatched_requested_urls.length) {
        measurementGaps.push(
          `${platform}: ${normalizedResult.reconciliation.unmatched_requested_urls.length} requested URLs had no accepted provider row.`,
        );
      }
      for (const post of normalized) {
        if (post.media.source_url) {
          try {
            post.media = await storeContentAddressedMedia(post.media.source_url, {
              rootDir: artifactDir,
              fetchImpl: options.fetchImpl,
              bearerAuthorization: apifyMediaAuthorization(post.media.source_url, nonEmpty(env.APIFY_TOKEN)),
            });
            externalCalls += 1;
          } catch (error) {
            post.partial_text_only = true;
            post.evidence_limitations.push(`Video download failed: ${redactProviderError('media', errorMessage(error))}`);
          }
        }
        store.upsertPost(post);
        posts.push(post);
      }
      costs.push({
        provider: 'apify',
        operation: `actor:${platform}`,
        estimated_cost_usd: run.actual_cost_usd === null ? request.cost_limits.max_apify_usd : 0,
        actual_cost_usd: run.actual_cost_usd,
      });
      enforceCostCeiling(request, costs);
    } catch (error) {
      errors.push(redactProviderError('apify', errorMessage(error)));
    }
  }

  let semanticItemsWritten = 0;
  for (const post of posts) {
    const beforeCalls = client.externalCallsMade;
    try {
      const alreadyEstimated = costs
        .filter((entry) => entry.provider === 'twelvelabs')
        .reduce((sum, entry) => sum + (entry.actual_cost_usd ?? entry.estimated_cost_usd), 0);
      const result = await indexPostSemanticEvidence(
        post,
        store,
        client,
        options,
        request.cost_limits.max_twelvelabs_usd - alreadyEstimated,
      );
      semanticItemsWritten += result.semantic_items_written;
      costs.push(...result.costs);
      enforceCostCeiling(request, costs);
    } catch (error) {
      errors.push(redactProviderError('twelvelabs', errorMessage(error)));
    } finally {
      externalCalls += client.externalCallsMade - beforeCalls;
    }
  }
  const outputPath = path.join(artifactDir, 'reports', `${safeName(request.request_id)}-semantic-ingestion.json`);
  const report: SemanticIngestionReport = {
    request_id: request.request_id,
    status: posts.length === 0 ? 'failed' : errors.length || measurementGaps.length ? 'partial' : 'completed',
    posts_ingested: posts.length,
    text_only_posts: posts.filter((post) => post.partial_text_only).length,
    semantic_items_written: semanticItemsWritten,
    external_calls_made: externalCalls,
    costs,
    total_cost_usd: totalCost(costs),
    model_traces: [
      { provider: 'TwelveLabs', model: MARENGO_MODEL, version: PROVIDER_MODEL_REVISION_UNKNOWN },
      { provider: 'TwelveLabs', model: PEGASUS_MODEL, version: PROVIDER_MODEL_REVISION_UNKNOWN },
    ],
    evidence_ids: posts.map((post) => post.evidence_id),
    output_paths: [options.dbPath, outputPath],
    blockers: [],
    errors,
    measurement_gaps: measurementGaps,
    ingestion_reconciliation: ingestionReconciliation,
    redactions: ['credential values are never serialized'],
  };
  writeJsonAtomic(outputPath, report);
  return report;
}

export async function ingestSemanticFixture(
  requestInput: UrlIntakeRequest | unknown,
  fixtures: Partial<Record<SocialPlatform, unknown[]>>,
  options: {
    dbPath: string;
    artifactDir?: string;
    embeddingForText: (text: string) => number[] | Promise<number[]>;
    videoAnalysisByPostId?: Record<string, VideoCreativeAnalysis>;
    videoSegmentsByPostId?: Record<string, TwelveLabsEmbeddingSegment[]>;
    collectedAt?: string;
  },
): Promise<SemanticIngestionReport> {
  const request = validateUrlIntakeRequest(requestInput);
  const store = new SqliteSemanticStore(options.dbPath);
  store.initialize();
  const artifactDir = path.resolve(options.artifactDir ?? DEFAULT_SEMANTIC_ARTIFACT_DIR);
  const posts: NormalizedSocialPost[] = [];
  const ingestionReconciliation: ProviderIngestionReconciliation[] = [];
  let semanticItemsWritten = 0;
  for (const platform of request.allowed_platforms) {
    const items = fixtures[platform] ?? [];
    if (!items.length) continue;
    const rawArtifactPath = writeRawActorArtifact(request.request_id, platform, items, artifactDir);
    const normalizedResult = normalizeProviderItemsWithReconciliation(
      request,
      platform,
      items,
      {
        actor_id: `fixture:${platform}`,
        run_id: `fixture-run:${request.request_id}:${platform}`,
        dataset_id: `fixture-dataset:${request.request_id}:${platform}`,
        raw_artifact_path: rawArtifactPath,
        collected_at: options.collectedAt ?? '2026-01-01T00:00:00.000Z',
      },
      {
        dataset_items_total_reported: items.length,
        dataset_truncated: false,
        dataset_truncation_unknown: false,
      },
    );
    const normalized = normalizedResult.posts;
    ingestionReconciliation.push(normalizedResult.reconciliation);
    for (const post of normalized) {
      store.upsertPost(post);
      posts.push(post);
      const analysis = options.videoAnalysisByPostId?.[post.evidence_id];
      if (analysis) store.upsertVideoAnalysis(analysis);
      const itemsToIndex = await buildTextSemanticItems(post, analysis, options.embeddingForText);
      for (const item of itemsToIndex) {
        store.upsertSemanticItem(item);
        semanticItemsWritten += 1;
      }
      for (const [index, segment] of (options.videoSegmentsByPostId?.[post.evidence_id] ?? []).entries()) {
        store.upsertSemanticItem(videoSegmentItem(post, segment, index));
        semanticItemsWritten += 1;
      }
    }
  }
  const measurementGaps = ingestionReconciliation.flatMap((row) => (
    row.unmatched_requested_urls.length
      ? [`${row.platform}: ${row.unmatched_requested_urls.length} requested URLs had no accepted fixture row.`]
      : []
  ));
  return {
    request_id: request.request_id,
    status: posts.length ? measurementGaps.length ? 'partial' : 'completed' : 'failed',
    posts_ingested: posts.length,
    text_only_posts: posts.filter((post) => post.partial_text_only).length,
    semantic_items_written: semanticItemsWritten,
    external_calls_made: 0,
    costs: [],
    total_cost_usd: 0,
    model_traces: [
      { provider: 'fixture', model: MARENGO_MODEL, version: PROVIDER_MODEL_REVISION_UNKNOWN },
      { provider: 'fixture', model: PEGASUS_MODEL, version: PROVIDER_MODEL_REVISION_UNKNOWN },
    ],
    evidence_ids: posts.map((post) => post.evidence_id),
    output_paths: [options.dbPath],
    blockers: [],
    errors: [],
    measurement_gaps: measurementGaps,
    ingestion_reconciliation: ingestionReconciliation,
    redactions: ['credential values are never serialized'],
  };
}

export async function searchSemanticCorpus(
  dbPath: string,
  query: SemanticSearchQuery,
  options: { queryEmbedding?: number[]; twelveLabsClient?: TwelveLabsClient },
): Promise<SemanticSearchHit[]> {
  const queryEmbedding = options.queryEmbedding ?? await options.twelveLabsClient?.embedText(query.query);
  if (!queryEmbedding) throw new Error('semantic search requires a supplied query embedding or an approved TwelveLabs client');
  return new SqliteSemanticStore(dbPath).search(query, queryEmbedding);
}

export function buildSemanticEvidenceBundle(query: SemanticSearchQuery, hits: SemanticSearchHit[]): SemanticEvidenceBundle {
  const byPost = new Map<string, SemanticEvidenceBundle['posts'][number]>();
  for (const hit of hits) {
    const current = byPost.get(hit.post_id) ?? {
      post_id: hit.post_id,
      canonical_url: hit.canonical_url,
      platforms: [],
      accounts: [],
      hashtags: [],
      evidence_ids: [],
      hit_types: [],
    };
    current.platforms = unique([...current.platforms, hit.platform]);
    current.accounts = unique([...current.accounts, hit.account_handle]);
    current.hashtags = unique([...current.hashtags, ...hit.hashtags]);
    current.evidence_ids = unique([...current.evidence_ids, hit.evidence_id]);
    current.hit_types = unique([...current.hit_types, hit.item_type]);
    byPost.set(hit.post_id, current);
  }
  return {
    query,
    created_at: new Date().toISOString(),
    ranking_policy: {
      default_order: 'retrieval_relevance',
      fusion: 'reciprocal_rank_fusion',
      rrf_k: 60,
      vector_candidates: 200,
      fts_candidates: 200,
      outcome_changes_semantic_rank: false,
    },
    hits,
    posts: [...byPost.values()],
  };
}

async function indexPostSemanticEvidence(
  post: NormalizedSocialPost,
  store: SqliteSemanticStore,
  client: TwelveLabsClient,
  options: SemanticPipelineOptions,
  maxCostUsd: number,
): Promise<{ semantic_items_written: number; external_calls_made: number; costs: ProviderCostEntry[] }> {
  let analysis: VideoCreativeAnalysis | undefined;
  let segments: TwelveLabsEmbeddingSegment[] = [];
  const callsBefore = client.externalCallsMade;
  let estimatedCost = 0;
  if (post.media.local_path || post.media.source_url) {
    const asset = await client.createAsset({
      localPath: post.media.local_path ?? undefined,
      url: post.media.local_path ? undefined : post.media.source_url ?? undefined,
      filename: post.media.local_path ? path.basename(post.media.local_path) : undefined,
      userMetadata: {
        evidence_id: post.evidence_id,
        ...(post.media.sha256 ? { source_sha256: post.media.sha256 } : {}),
      },
    });
    if (asset.duration === null || asset.duration <= 0) {
      throw new Error('TwelveLabs ready asset did not report a positive duration for cost estimation.');
    }
    const textRequests = estimatedTextEmbeddingRequests(post, true);
    estimatedCost = estimateTwelveLabsSemanticCost(asset.duration, 4_096, textRequests);
    if (!Number.isFinite(maxCostUsd) || estimatedCost > maxCostUsd + 1e-9) {
      throw new Error('cost_exhausted:twelvelabs_pre_call_estimate');
    }
    analysis = await client.analyzeVideo({
      videoAssetId: `${post.evidence_id}:video`,
      assetId: asset._id,
      maxTokens: 4_096,
    });
    store.upsertVideoAnalysis(analysis);
    if (asset.duration >= 4) {
      segments = await client.embedVideo({
        assetId: asset._id,
      });
    } else {
      post.evidence_limitations.push('Video is shorter than the four-second minimum for TwelveLabs video embeddings; structured analysis and text embeddings were retained.');
      store.upsertPost(post);
    }
  } else {
    const textRequests = estimatedTextEmbeddingRequests(post, false);
    estimatedCost = estimateTwelveLabsSemanticCost(0, 0, textRequests);
    if (!Number.isFinite(maxCostUsd) || estimatedCost > maxCostUsd + 1e-9) {
      throw new Error('cost_exhausted:twelvelabs_pre_call_estimate');
    }
  }
  let written = 0;
  for (const [index, segment] of segments.entries()) {
    store.upsertSemanticItem(videoSegmentItem(post, segment, index));
    written += 1;
  }
  const textItems = await buildTextSemanticItems(post, analysis, async (text) => {
    return client.embedText(text);
  });
  for (const item of textItems) {
    store.upsertSemanticItem(item);
    written += 1;
  }
  return {
    semantic_items_written: written,
    external_calls_made: client.externalCallsMade - callsBefore,
    costs: [{ provider: 'twelvelabs', operation: `post:${post.evidence_id}`, estimated_cost_usd: roundUsd(estimatedCost), actual_cost_usd: null }],
  };
}

async function buildTextSemanticItems(
  post: NormalizedSocialPost,
  analysis: VideoCreativeAnalysis | undefined,
  embed: (text: string) => number[] | Promise<number[]>,
): Promise<SemanticItem[]> {
  const definitions: Array<{ id: string; evidenceId: string; type: SemanticItem['item_type']; text: string; start: number | null; end: number | null }> = [];
  if (post.caption.trim()) definitions.push({
    id: `${post.evidence_id}:semantic:caption`, evidenceId: post.evidence_id, type: 'caption', text: post.caption, start: null, end: null,
  });
  const rootText = new Map(post.comments.filter((comment) => !comment.parent_comment_id).map((comment) => [comment.platform_comment_id, comment.text]));
  for (const comment of post.comments) {
    const context = comment.parent_comment_id ? rootText.get(comment.thread_root_id) : null;
    const text = context ? `Parent comment: ${context}\nReply by @${comment.author_handle}: ${comment.text}` : `Comment by @${comment.author_handle}: ${comment.text}`;
    definitions.push({ id: `${comment.evidence_id}:semantic`, evidenceId: comment.evidence_id, type: 'comment', text, start: null, end: null });
  }
  const themes = analysis ? unique([...analysis.style, ...analysis.creative_beats.map((beat) => beat.label)]).join(', ') : 'insufficient video evidence';
  definitions.push({
    id: `${post.account.evidence_id}:semantic:${post.evidence_id}`,
    evidenceId: post.account.evidence_id,
    type: 'account',
    text: `Account @${post.account.handle}. Bio: ${post.account.bio || 'not provided'}. Aggregated themes from this post: ${themes}.`,
    start: null,
    end: null,
  });
  for (const tag of post.hashtags) definitions.push({
    id: `${post.evidence_id}:semantic:hashtag:${tag}`,
    evidenceId: `${post.evidence_id}:hashtag:${tag}`,
    type: 'hashtag',
    text: `Hashtag #${tag}. Surrounding post context: ${post.caption || themes}.`,
    start: null,
    end: null,
  });
  if (analysis) definitions.push({
    id: `${analysis.analysis_id}:semantic`,
    evidenceId: analysis.analysis_id,
    type: 'pegasus_description',
    text: JSON.stringify({
      hook: analysis.hook,
      creative_beats: analysis.creative_beats,
      visible_proof: analysis.visible_proof,
      cta: analysis.cta,
      claims: analysis.claims,
      style: analysis.style,
      evidence_limitations: analysis.evidence_limitations,
    }),
    start: analysis.hook.start_sec,
    end: analysis.hook.end_sec,
  });

  const output: SemanticItem[] = [];
  for (const definition of definitions) {
    const embedding = await embed(boundedTextEmbeddingInput(definition.text));
    output.push(baseSemanticItem(post, definition.id, definition.evidenceId, definition.type, definition.text, embedding, definition.start, definition.end));
  }
  return output;
}

function boundedTextEmbeddingInput(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const maxChars = 1_400;
  const maxWords = 300;
  const words = normalized.split(' ');
  if (normalized.length <= maxChars && words.length <= maxWords) return normalized;
  const head = words.slice(0, 220).join(' ');
  const tail = words.slice(-60).join(' ');
  const combined = `${head} [...truncated for embedding...] ${tail}`;
  if (combined.length <= maxChars) return combined;
  const marker = ' [...truncated for embedding...] ';
  const headChars = Math.floor((maxChars - marker.length) * 0.72);
  const tailChars = maxChars - marker.length - headChars;
  return `${normalized.slice(0, headChars)}${marker}${normalized.slice(-tailChars)}`;
}

function videoSegmentItem(post: NormalizedSocialPost, segment: TwelveLabsEmbeddingSegment, index: number): SemanticItem {
  const start = segment.start_sec;
  const end = segment.end_sec;
  return baseSemanticItem(
    post,
    `${post.evidence_id}:semantic:video:${index}`,
    `${post.evidence_id}:video:${index}`,
    'video_segment',
    `Multimodal video segment ${index + 1}${start === null ? '' : ` from ${start}s to ${end ?? '?'}s`} (${segment.modality ?? 'fused'}; ${segment.scope ?? 'clip'}).`,
    segment.embedding,
    start,
    end,
  );
}

function baseSemanticItem(
  post: NormalizedSocialPost,
  itemId: string,
  evidenceId: string,
  itemType: SemanticItem['item_type'],
  text: string,
  embedding: number[],
  startSec: number | null,
  endSec: number | null,
): SemanticItem {
  return {
    item_id: itemId,
    evidence_id: evidenceId,
    post_id: post.evidence_id,
    item_type: itemType,
    text,
    embedding,
    embedding_model: MARENGO_MODEL,
    model_version: PROVIDER_MODEL_REVISION_UNKNOWN,
    canonical_url: post.canonical_url,
    start_sec: startSec,
    end_sec: endSec,
    platform: post.platform,
    account_handle: post.account.handle,
    hashtags: post.hashtags,
    created_at: post.posted_at ?? post.collected_at,
    observed_coas: null,
    predicted_coas: null,
    confidence: post.partial_text_only ? 0.45 : 0.8,
  };
}

export function pegasusCreativeAnalysisSchema(): Record<string, unknown> {
  // TwelveLabs accepts a documented subset of JSON Schema. Keep the provider
  // schema free of additionalProperties, numeric bounds, type arrays, and
  // unsupported composition even though the persisted sidecar is validated
  // more strictly after generation.
  const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };
  const timed = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object',
    properties: { start_sec: { type: 'number' }, end_sec: { type: 'number' }, ...properties },
    required: ['start_sec', 'end_sec', ...required],
  });
  return {
    type: 'object',
    properties: {
      duration_sec: { type: 'number' },
      hook: timed({ text: { type: 'string' } }, ['text']),
      creative_beats: { type: 'array', items: timed({ label: { type: 'string' }, description: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } }, ['label', 'description', 'evidence']) },
      visible_proof: { type: 'array', items: timed({ description: { type: 'string' } }, ['description']) },
      on_screen_text: { type: 'array', items: timed({ text: { type: 'string' } }, ['text']) },
      speech: { type: 'array', items: timed({ text: { type: 'string' } }, ['text']) },
      audio_cues: { type: 'array', items: timed({ description: { type: 'string' } }, ['description']) },
      pacing: {
        type: 'object',
        properties: { cuts_per_minute: nullableNumber, pattern: { type: 'string' } },
        required: ['cuts_per_minute', 'pattern'],
      },
      cta: {
        type: 'object',
        properties: { text: { type: 'string' }, start_sec: nullableNumber, end_sec: nullableNumber },
        required: ['text', 'start_sec', 'end_sec'],
      },
      claims: { type: 'array', items: timed({ text: { type: 'string' }, support: { type: 'string', enum: ['visible', 'spoken', 'unsupported'] } }, ['text', 'support']) },
      style: { type: 'array', items: { type: 'string' } },
      evidence_limitations: { type: 'array', items: { type: 'string' } },
    },
    required: ['duration_sec', 'hook', 'creative_beats', 'visible_proof', 'on_screen_text', 'speech', 'audio_cues', 'pacing', 'cta', 'claims', 'style', 'evidence_limitations'],
  };
}

function enforceCostCeiling(request: UrlIntakeRequest, entries: ProviderCostEntry[]): void {
  const total = totalCost(entries);
  if (total > request.cost_limits.max_total_usd) throw new Error('cost_exhausted:total');
  const byProvider = (provider: ProviderCostEntry['provider']) => entries
    .filter((entry) => entry.provider === provider)
    .reduce((sum, entry) => sum + (entry.actual_cost_usd ?? entry.estimated_cost_usd), 0);
  if (byProvider('apify') > request.cost_limits.max_apify_usd) throw new Error('cost_exhausted:apify');
  if (byProvider('twelvelabs') > request.cost_limits.max_twelvelabs_usd) throw new Error('cost_exhausted:twelvelabs');
  if (byProvider('gemini') > request.cost_limits.max_gemini_usd) throw new Error('cost_exhausted:gemini');
}

function totalCost(entries: ProviderCostEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.actual_cost_usd ?? entry.estimated_cost_usd), 0);
}

function apifyMediaAuthorization(
  mediaUrl: string,
  token: string | undefined,
): { origin: string; token: string } | undefined {
  if (!token?.trim()) return undefined;
  try {
    const parsed = new URL(mediaUrl);
    return parsed.origin === 'https://api.apify.com'
      ? { origin: parsed.origin, token: token.trim() }
      : undefined;
  } catch {
    return undefined;
  }
}

export function estimateTwelveLabsSemanticCost(
  durationSec: number,
  maxOutputTokens: number,
  textEmbeddingRequests: number,
): number {
  if (durationSec < 0 || maxOutputTokens < 0 || textEmbeddingRequests < 0) {
    throw new Error('TwelveLabs cost-estimator inputs must be non-negative.');
  }
  const durationMinutes = durationSec / 60;
  const marengoVideo = durationMinutes * 0.042;
  const marengoText = (textEmbeddingRequests / 1_000) * 0.07;
  return estimateTwelveLabsAnalysisCost(durationSec, maxOutputTokens) + marengoVideo + marengoText;
}

export function estimateTwelveLabsAnalysisCost(
  durationSec: number,
  outputTokens: number,
): number {
  if (durationSec < 0 || outputTokens < 0) {
    throw new Error('TwelveLabs analysis cost-estimator inputs must be non-negative.');
  }
  const durationMinutes = durationSec / 60;
  const pegasusInput = durationMinutes * 0.0292;
  const pegasusOutput = (outputTokens / 1_000) * 0.0075;
  return pegasusInput + pegasusOutput;
}

function estimatedTextEmbeddingRequests(post: NormalizedSocialPost, includesAnalysis: boolean): number {
  return (post.caption.trim() ? 1 : 0)
    + post.comments.length
    + 1
    + post.hashtags.length
    + (includesAnalysis ? 1 : 0);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function splitUsdCeiling(total: number, parts: number): number[] {
  const totalMicros = Math.floor(total * 1_000_000 + Number.EPSILON);
  const baseMicros = Math.floor(totalMicros / parts);
  if (baseMicros <= 0) throw new Error('Apify request cost ceiling is too small for the planned run count.');
  const remainder = totalMicros - baseMicros * parts;
  return Array.from({ length: parts }, (_, index) => (
    (baseMicros + (index < remainder ? 1 : 0)) / 1_000_000
  ));
}

function blockedIngestion(requestId: string, blockers: string[]): SemanticIngestionReport {
  return {
    request_id: requestId,
    status: 'blocked',
    posts_ingested: 0,
    text_only_posts: 0,
    semantic_items_written: 0,
    external_calls_made: 0,
    costs: [],
    total_cost_usd: 0,
    model_traces: [],
    evidence_ids: [],
    output_paths: [],
    blockers,
    errors: [],
    measurement_gaps: [],
    ingestion_reconciliation: [],
    redactions: ['credential values are never serialized'],
  };
}

function parsePegasusPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      throw new Error('Pegasus structured response was not valid JSON.');
    }
  }
  throw new Error('Pegasus structured response was missing.');
}

function validateSegmentDefinitions(definitions: TwelveLabsSegmentDefinition[]): void {
  if (!definitions.length || definitions.length > 10) {
    throw new Error('TwelveLabs segmentation requires between one and ten segment definitions.');
  }
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!/^[A-Za-z0-9_-]+$/.test(definition.id) || ids.has(definition.id)) {
      throw new Error('TwelveLabs segment definition IDs must be unique letters, numbers, underscores, or hyphens.');
    }
    ids.add(definition.id);
    if (!definition.description.trim()) throw new Error(`TwelveLabs segment definition ${definition.id} requires a description.`);
    if (!definition.fields.length || definition.fields.length > 20) {
      throw new Error(`TwelveLabs segment definition ${definition.id} requires between one and twenty fields.`);
    }
    const fieldNames = new Set<string>();
    for (const field of definition.fields) {
      if (!/^[A-Za-z0-9_-]+$/.test(field.name) || fieldNames.has(field.name)) {
        throw new Error(`TwelveLabs segment definition ${definition.id} has an invalid or duplicate field name.`);
      }
      fieldNames.add(field.name);
      if (!field.description.trim()) {
        throw new Error(`TwelveLabs segment field ${definition.id}.${field.name} requires a description.`);
      }
    }
  }
}

function parseTwelveLabsSegments(
  value: unknown,
  definitions: TwelveLabsSegmentDefinition[],
): Record<string, TwelveLabsTimeSegment[]> {
  const payload = parsePegasusPayload(value);
  const parsed: Record<string, TwelveLabsTimeSegment[]> = {};
  for (const definition of definitions) {
    const segments = payload[definition.id];
    if (!Array.isArray(segments)) {
      throw new Error(`TwelveLabs segmentation response is missing ${definition.id}.`);
    }
    parsed[definition.id] = segments.map((segment, index) => {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
        throw new Error(`TwelveLabs segmentation ${definition.id}[${index}] must be an object.`);
      }
      const row = segment as Record<string, unknown>;
      const startTime = finiteNumber(row.start_time);
      const endTime = finiteNumber(row.end_time);
      if (startTime === null || endTime === null || startTime < 0 || endTime <= startTime) {
        throw new Error(`TwelveLabs segmentation ${definition.id}[${index}] has invalid timestamps.`);
      }
      if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) {
        throw new Error(`TwelveLabs segmentation ${definition.id}[${index}] has invalid metadata.`);
      }
      return {
        start_time: startTime,
        end_time: endTime,
        metadata: row.metadata as Record<string, unknown>,
      };
    });
  }
  return parsed;
}

function parseTwelveLabsAsset(value: Record<string, unknown>): TwelveLabsAsset {
  const assetId = textOrNull(value._id);
  const status = textOrNull(value.status);
  if (!assetId || !status || !['processing', 'ready', 'failed'].includes(status)) {
    throw new Error('TwelveLabs asset response is missing a valid ID or status.');
  }
  const metadata = value.user_metadata;
  return {
    _id: assetId,
    method: textOrNull(value.method) ?? 'unknown',
    status: status as TwelveLabsAsset['status'],
    filename: textOrNull(value.filename),
    file_type: textOrNull(value.file_type),
    duration: finiteNumber(value.duration),
    size: finiteNumber(value.size),
    created_at: textOrNull(value.created_at),
    user_metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, string | number | boolean>
      : null,
    error: value.error ?? null,
  };
}

function assertTwelveLabsRawMediaUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('TwelveLabs media URL must be a valid direct HTTPS URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('TwelveLabs media URL must be credential-free HTTPS.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (
    host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be'
    || host === 'tiktok.com' || host.endsWith('.tiktok.com')
    || host === 'instagram.com' || host.endsWith('.instagram.com')
  ) {
    throw new Error('TwelveLabs accepts raw media URLs, not social-platform page URLs. Upload a lawful local file as an asset.');
  }
  return parsed.toString();
}

function safeProviderDetail(value: unknown): string {
  if (typeof value === 'string') return redactProviderError('twelvelabs', value);
  if (value && typeof value === 'object') return redactProviderError('twelvelabs', JSON.stringify(value));
  return 'provider_reported_failure';
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function retryAfterMs(value: string | null, fallback: number): number {
  if (!value?.trim()) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : fallback;
}

async function jsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    const message = typeof error.message === 'string'
      ? error.message
      : typeof record.message === 'string' ? record.message : `HTTP ${response.status}`;
    const code = typeof error.code === 'string'
      ? error.code
      : typeof record.code === 'string' ? record.code : null;
    throw new Error(redactProviderError(label, `${code ? `${code}:` : ''}${message}`));
  }
  return parsed as T;
}

function requireEmbedding(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`${label} returned an invalid embedding.`);
  }
  return value as number[];
}

function writeJsonAtomic(target: string, value: unknown): void {
  atomicWriteJson(target, value);
}

function readJsonIfExists<T>(target: string): T | null {
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function buildApifyActorInput(
  platform: SocialPlatform,
  urls: string[],
  env: Record<string, string | undefined> = process.env,
  commentPolicy?: UrlIntakeRequest['comment_policy'],
): Record<string, unknown> {
  if (!urls.length) throw new Error('Apify Actor input requires at least one supplied public post URL.');
  const canonicalUrls = urls.map((url) => {
    const normalized = normalizePublicPostUrl(url);
    if (normalized.platform !== platform) throw new Error(`Apify ${platform} input contains a URL for ${normalized.platform}.`);
    return normalized.canonical_url;
  });
  const inputField = nonEmpty(env[actorInputFieldEnv(platform)]) ?? defaultActorInputField(platform);
  const format = nonEmpty(env[actorInputFormatEnv(platform)]) ?? defaultActorInputFormat(platform);
  if (format !== 'string_array' && format !== 'request_list') {
    throw new Error(`${actorInputFormatEnv(platform)} must be string_array or request_list.`);
  }
  const extras = applyApprovedCommentPolicy(platform, parseApifyInputExtras(platform, env), commentPolicy);
  if (Object.hasOwn(extras, inputField)) {
    throw new Error(`${actorInputExtrasEnv(platform)} cannot override the supplied URL field ${inputField}.`);
  }
  assertNoDiscoveryOrAccountActions(extras, actorInputExtrasEnv(platform));
  return {
    ...extras,
    [inputField]: format === 'request_list'
      ? canonicalUrls.map((url) => ({ url }))
      : canonicalUrls,
  };
}

function applyApprovedCommentPolicy(
  platform: SocialPlatform,
  extras: Record<string, unknown>,
  policy: UrlIntakeRequest['comment_policy'] | undefined,
): Record<string, unknown> {
  if (platform !== 'tiktok' || !policy) return extras;
  if (!policy.enabled) {
    return {
      ...extras,
      commentsPerPost: 0,
      topLevelCommentsPerPost: 0,
      maxRepliesPerComment: 0,
    };
  }
  const topLevelLimit = policy.max_high_engagement + policy.max_recent;
  return {
    ...extras,
    commentsPerPost: topLevelLimit,
    topLevelCommentsPerPost: topLevelLimit,
    maxRepliesPerComment: policy.max_replies_per_thread,
  };
}

function instagramCommentRunSpecs(
  platform: SocialPlatform,
  urls: string[],
  primaryInput: Record<string, unknown>,
  policy: UrlIntakeRequest['comment_policy'] | undefined,
): Array<{
  kind: ApifySupplementalRun['kind'];
  input: Record<string, unknown>;
  maxItems: number;
}> {
  if (platform !== 'instagram' || !policy?.enabled) return [];
  const base = {
    ...primaryInput,
    resultsType: 'comments',
    includeNestedComments: policy.max_replies_per_thread > 0,
  };
  const specs: Array<{
    kind: ApifySupplementalRun['kind'];
    input: Record<string, unknown>;
    maxItems: number;
  }> = [];
  const add = (kind: ApifySupplementalRun['kind'], resultsLimit: number, newest: boolean): void => {
    if (resultsLimit <= 0) return;
    const perPostCeiling = resultsLimit * (1 + policy.max_replies_per_thread);
    specs.push({
      kind,
      input: {
        ...base,
        resultsLimit,
        isNewestComments: newest,
      },
      maxItems: Math.max(1, urls.length * perPostCeiling),
    });
  };
  add('instagram_comments_high_engagement', policy.max_high_engagement, false);
  add('instagram_comments_recent', policy.max_recent, true);
  return specs;
}

function instagramCommentDatasets(
  primaryItems: unknown[],
  urls: string[],
  comments: unknown[],
  datasetId: string,
  kind: ApifySupplementalRun['kind'],
): ApifyLinkedDataset[] {
  const sourceIndexes = new Map<string, number>();
  for (const [index, item] of primaryItems.entries()) {
    const postId = instagramPostIdFromRecord(item);
    if (postId) sourceIndexes.set(postId, index);
  }
  for (const [index, url] of urls.entries()) {
    try {
      const postId = normalizePublicPostUrl(url).platform_post_id;
      sourceIndexes.set(postId, sourceIndexes.get(postId) ?? index);
    } catch {
      // The approved URL list was already validated; this is defensive only.
    }
  }
  const grouped = new Map<number, unknown[]>();
  for (const comment of comments) {
    const postId = instagramPostIdFromRecord(comment);
    const sourceIndex = postId ? sourceIndexes.get(postId) : urls.length === 1 ? 0 : undefined;
    if (sourceIndex === undefined) continue;
    const rows = grouped.get(sourceIndex) ?? [];
    rows.push(comment);
    grouped.set(sourceIndex, rows);
  }
  return [...grouped.entries()].map(([sourceItemIndex, items]) => ({
    kind: 'comments',
    dataset_id: datasetId,
    source_item_index: sourceItemIndex,
    source_field: `separate_actor:${kind}`,
    items,
  }));
}

function instagramPostIdFromRecord(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['shortCode', 'shortcode', 'postShortCode', 'code']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  for (const key of ['postUrl', 'inputUrl', 'url', 'parentPostUrl', 'commentUrl']) {
    const candidate = record[key];
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      const normalized = normalizePublicPostUrl(candidate);
      if (normalized.platform === 'instagram') return normalized.platform_post_id;
    } catch {
      // Continue through alternate provider fields.
    }
  }
  return null;
}

function sumKnownCosts(costs: Array<number | null>): number | null {
  return costs.every((cost): cost is number => cost !== null)
    ? roundUsd(costs.reduce((sum, cost) => sum + cost, 0))
    : null;
}

export function mergeLinkedComments(items: unknown[], linkedDatasets: ApifyLinkedDataset[]): unknown[] {
  const commentsByIndex = new Map<number, unknown[]>();
  for (const dataset of linkedDatasets) {
    if (dataset.kind !== 'comments') continue;
    const current = commentsByIndex.get(dataset.source_item_index) ?? [];
    current.push(...dataset.items);
    commentsByIndex.set(dataset.source_item_index, current);
  }
  return items.map((item, index) => {
    const linked = commentsByIndex.get(index);
    if (!linked?.length || !item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    const existing = Array.isArray(record.comments) ? record.comments : [];
    return { ...record, comments: [...existing, ...linked] };
  });
}

async function fetchLinkedApifyDatasets(
  items: unknown[],
  options: { client: ApifyApiClient },
): Promise<{ datasets: ApifyLinkedDataset[]; external_calls_made: number }> {
  const datasets: ApifyLinkedDataset[] = [];
  const seen = new Set<string>();
  let externalCalls = 0;
  for (const [sourceItemIndex, item] of items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    for (const sourceField of ['commentsDatasetURL', 'commentsDatasetUrl', 'commentsDatasetId', 'commentsDatasetID']) {
      const datasetId = apifyDatasetId(record[sourceField]);
      if (!datasetId) continue;
      const key = `${sourceItemIndex}:${datasetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const before = options.client.externalCallsMade;
      const page = await options.client.getAllDatasetItems(datasetId, 500, 5_000);
      externalCalls += options.client.externalCallsMade - before;
      datasets.push({
        kind: 'comments',
        dataset_id: datasetId,
        source_item_index: sourceItemIndex,
        source_field: sourceField,
        items: page.items,
      });
    }
  }
  return { datasets, external_calls_made: externalCalls };
}

function apifyDatasetId(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const clean = value.trim();
  if (/^[A-Za-z0-9_-]{8,}$/.test(clean)) return clean;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'api.apify.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const datasetIndex = parts.findIndex((part) => part === 'datasets' || part === 'dataset');
    const datasetId = datasetIndex >= 0 ? parts[datasetIndex + 1] : undefined;
    return datasetId && /^[A-Za-z0-9_-]{8,}$/.test(datasetId) ? datasetId : null;
  } catch {
    return null;
  }
}

function parseApifyInputExtras(
  platform: SocialPlatform,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const key = actorInputExtrasEnv(platform);
  const serialized = nonEmpty(env[key]);
  if (!serialized) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(`${key} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${key} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function assertNoDiscoveryOrAccountActions(value: unknown, label: string, trail: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoDiscoveryOrAccountActions(item, label, [...trail, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (/(?:search|discover|relatedvideos|hashtagurls|profileurls|usernames|channelurls|login|captcha|cookie|session|password|private|followusers|likeposts|sendmessages)/.test(normalized)) {
      throw new Error(`${label} contains prohibited discovery, authentication, private-data, or account-action field: ${[...trail, key].join('.')}`);
    }
    assertNoDiscoveryOrAccountActions(child, label, [...trail, key]);
  }
}

function defaultActorInputField(platform: SocialPlatform): string {
  if (platform === 'tiktok') return 'postURLs';
  if (platform === 'instagram') return 'directUrls';
  return 'startUrls';
}

function defaultActorInputFormat(platform: SocialPlatform): 'string_array' | 'request_list' {
  return platform === 'youtube_shorts' ? 'request_list' : 'string_array';
}

function actorInputFieldEnv(platform: SocialPlatform): string {
  if (platform === 'tiktok') return 'APIFY_INPUT_FIELD_TIKTOK';
  if (platform === 'instagram') return 'APIFY_INPUT_FIELD_INSTAGRAM';
  return 'APIFY_INPUT_FIELD_YOUTUBE';
}

function actorInputFormatEnv(platform: SocialPlatform): string {
  if (platform === 'tiktok') return 'APIFY_INPUT_FORMAT_TIKTOK';
  if (platform === 'instagram') return 'APIFY_INPUT_FORMAT_INSTAGRAM';
  return 'APIFY_INPUT_FORMAT_YOUTUBE';
}

function actorInputExtrasEnv(platform: SocialPlatform): string {
  if (platform === 'tiktok') return 'APIFY_INPUT_EXTRAS_TIKTOK_JSON';
  if (platform === 'instagram') return 'APIFY_INPUT_EXTRAS_INSTAGRAM_JSON';
  return 'APIFY_INPUT_EXTRAS_YOUTUBE_JSON';
}

function actorBuildEnv(platform: SocialPlatform): string {
  if (platform === 'tiktok') return 'APIFY_ACTOR_BUILD_TIKTOK';
  if (platform === 'instagram') return 'APIFY_ACTOR_BUILD_INSTAGRAM';
  return 'APIFY_ACTOR_BUILD_YOUTUBE';
}

function redactProviderError(provider: string, message: string): string {
  const redacted = message
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]+|apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return `${provider}:${redacted.slice(0, 500)}`;
}

function stableHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function enabled(env: Record<string, string | undefined>, key: string): boolean {
  return (env[key] ?? '').trim().toLowerCase() === 'true';
}

function nonEmpty(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function nonNegativeEnvNumber(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
