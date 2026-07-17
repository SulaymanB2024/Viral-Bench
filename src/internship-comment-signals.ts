import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ApifyApiClient } from './apify-api';
import { atomicWriteJson } from './artifact-integrity';
import {
  identityFreeAudienceTextSignal,
  type AudienceSignal,
  type SelectionLedger,
} from './internship-research-batch';
import type { EnrichedSemanticCandidate, LiveCandidateReport } from './internship-live-reconciliation';
import { normalizePublicPostUrl, type SocialPlatform } from './semantic-intelligence';

interface CommentRunSpec {
  id: string;
  platform: SocialPlatform;
  actor_id: string;
  input: Record<string, unknown>;
  max_charge_usd: number;
  max_items: number;
  provider_cohort: 'mixed' | 'high_engagement' | 'recent';
}

interface TransientComment {
  sourceUrl: string;
  platform: SocialPlatform;
  text: string;
  publishedAt: string | null;
  likes: number;
  providerCohort: CommentRunSpec['provider_cohort'];
}

export interface CommentSignalReport {
  schema_version: 1;
  batch_id: string;
  generated_at: string;
  selected_posts: number;
  selected_posts_by_platform: Record<string, number>;
  collected_comment_rows: number;
  retained_identity_free_signals: number;
  counts_by_theme: Record<string, number>;
  counts_by_platform: Record<string, number>;
  runs: Array<{
    id: string;
    platform: SocialPlatform;
    actor_id: string;
    run_id: string | null;
    status: 'completed' | 'failed' | 'budget_blocked';
    max_charge_usd: number;
    actual_cost_usd: number | null;
    conservative_spend_usd: number;
    item_count: number;
    error: string | null;
  }>;
  costs: {
    currency: 'USD';
    lane_cap_usd: 4;
    actual_cost_usd_reported: number;
    conservative_spend_usd: number;
    remaining_ceiling_usd: number;
  };
  signals: AudienceSignal[];
  measurement_gaps: string[];
  privacy: {
    usernames_persisted: false;
    profile_urls_persisted: false;
    raw_comment_text_persisted: false;
    comment_ids_persisted: false;
    identity_redacted_before_persistence: true;
  };
  redactions: ['credential values are never serialized'];
}

export function chooseCommentPosts(
  selection: SelectionLedger,
  candidates: LiveCandidateReport,
): EnrichedSemanticCandidate[] {
  const candidatesById = new Map(candidates.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const selected = selection.entries
    .filter((entry) => entry.selected)
    .map((entry) => ({ entry, candidate: candidatesById.get(entry.candidate_id) }))
    .filter((row): row is { entry: SelectionLedger['entries'][number]; candidate: EnrichedSemanticCandidate } => Boolean(row.candidate));
  return (['tiktok', 'instagram', 'youtube_shorts'] as const).flatMap((platform) => selected
    .filter((row) => row.candidate.platform === platform)
    .sort((left, right) => (
      (right.entry.normalized_performance_score ?? 0.5) - (left.entry.normalized_performance_score ?? 0.5)
      || right.candidate.evidence_richness - left.candidate.evidence_richness
      || right.candidate.novelty_score - left.candidate.novelty_score
      || left.candidate.candidate_id.localeCompare(right.candidate.candidate_id)
    ))
    .slice(0, 6)
    .map((row) => row.candidate));
}

export function buildCommentRunSpecs(posts: EnrichedSemanticCandidate[]): CommentRunSpec[] {
  const urls = (platform: SocialPlatform) => posts
    .filter((post) => post.platform === platform)
    .map((post) => post.canonical_url);
  const tiktok = urls('tiktok');
  const instagram = urls('instagram');
  const youtube = urls('youtube_shorts');
  if (tiktok.length !== 6 || instagram.length !== 6 || youtube.length !== 6) {
    throw new Error('Comment collection requires the six highest-value selected posts from each platform.');
  }
  const specs: CommentRunSpec[] = [
    {
      id: 'tiktok-comments-mixed-pool',
      platform: 'tiktok',
      actor_id: 'clockworks/tiktok-comments-scraper',
      input: { postURLs: tiktok, commentsPerPost: 25, maxRepliesPerComment: 2 },
      max_charge_usd: 1,
      max_items: 450,
      provider_cohort: 'mixed',
    },
    {
      id: 'instagram-comments-high-engagement',
      platform: 'instagram',
      actor_id: 'apify/instagram-scraper',
      input: { directUrls: instagram, resultsType: 'comments', resultsLimit: 5, isNewestComments: false, includeNestedComments: false },
      max_charge_usd: 0.75,
      max_items: 30,
      provider_cohort: 'high_engagement',
    },
    {
      id: 'instagram-comments-recent',
      platform: 'instagram',
      actor_id: 'apify/instagram-scraper',
      input: { directUrls: instagram, resultsType: 'comments', resultsLimit: 5, isNewestComments: true, includeNestedComments: false },
      max_charge_usd: 0.75,
      max_items: 30,
      provider_cohort: 'recent',
    },
    {
      id: 'youtube-comments-high-engagement',
      platform: 'youtube_shorts',
      actor_id: 'streamers/youtube-comments-scraper',
      input: { startUrls: youtube.map((url) => ({ url })), maxComments: 5, sortCommentsBy: 'TOP_COMMENTS' },
      max_charge_usd: 0.75,
      max_items: 30,
      provider_cohort: 'high_engagement',
    },
    {
      id: 'youtube-comments-recent',
      platform: 'youtube_shorts',
      actor_id: 'streamers/youtube-comments-scraper',
      input: { startUrls: youtube.map((url) => ({ url })), maxComments: 5, sortCommentsBy: 'NEWEST_FIRST' },
      max_charge_usd: 0.75,
      max_items: 30,
      provider_cohort: 'recent',
    },
  ];
  const cap = money(specs.reduce((sum, spec) => sum + spec.max_charge_usd, 0));
  if (cap !== 4) throw new Error(`Comment run ceilings ${cap} must equal the $4 audience-voice lane cap.`);
  return specs;
}

export async function collectIdentityFreeCommentSignals(options: {
  token: string;
  batchId: string;
  posts: EnrichedSemanticCandidate[];
  now?: () => Date;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ manifest: unknown; report: CommentSignalReport }> {
  if (!options.token.trim()) throw new Error('APIFY_TOKEN is required.');
  const now = options.now ?? (() => new Date());
  const specs = buildCommentRunSpecs(options.posts);
  const selectedIds = new Set(options.posts.map((post) => `${post.platform}:${post.platform_post_id}`));
  const comments: TransientComment[] = [];
  const runs: CommentSignalReport['runs'] = [];
  let conservativeSpend = 0;
  let actualReported = 0;
  let externalCalls = 0;

  for (const spec of specs) {
    if (money(conservativeSpend + spec.max_charge_usd) > 4) {
      runs.push({
        id: spec.id,
        platform: spec.platform,
        actor_id: spec.actor_id,
        run_id: null,
        status: 'budget_blocked',
        max_charge_usd: spec.max_charge_usd,
        actual_cost_usd: null,
        conservative_spend_usd: 0,
        item_count: 0,
        error: 'maximum possible charge exceeds remaining audience-voice lane cap',
      });
      continue;
    }
    const client = new ApifyApiClient({ token: options.token, fetchImpl: options.fetchImpl, sleep: options.sleep });
    try {
      const result = await client.executeActor({
        actorId: spec.actor_id,
        input: spec.input,
        inputMode: 'explicit_url',
        maxTotalChargeUsd: spec.max_charge_usd,
        maxItems: spec.max_items,
        maxDatasetItems: spec.max_items,
        usageSettlementMs: 5_000,
      });
      const spend = result.actual_cost_usd ?? spec.max_charge_usd;
      conservativeSpend = money(conservativeSpend + spend);
      actualReported = money(actualReported + (result.actual_cost_usd ?? 0));
      for (const raw of result.items) {
        const comment = transientComment(raw, spec, selectedIds);
        if (comment) comments.push(comment);
      }
      runs.push({
        id: spec.id,
        platform: spec.platform,
        actor_id: spec.actor_id,
        run_id: result.run_id,
        status: 'completed',
        max_charge_usd: spec.max_charge_usd,
        actual_cost_usd: result.actual_cost_usd,
        conservative_spend_usd: spend,
        item_count: result.items.length,
        error: null,
      });
    } catch (error) {
      const started = client.externalCallsMade > 0;
      const spend = started ? spec.max_charge_usd : 0;
      conservativeSpend = money(conservativeSpend + spend);
      runs.push({
        id: spec.id,
        platform: spec.platform,
        actor_id: spec.actor_id,
        run_id: null,
        status: 'failed',
        max_charge_usd: spec.max_charge_usd,
        actual_cost_usd: null,
        conservative_spend_usd: spend,
        item_count: 0,
        error: redact(error instanceof Error ? error.message : String(error)),
      });
    } finally {
      externalCalls += client.externalCallsMade;
    }
  }

  const signals = selectAndRedact(comments);
  const completedRuns = runs.filter((run) => run.status === 'completed');
  const report: CommentSignalReport = {
    schema_version: 1,
    batch_id: options.batchId,
    generated_at: now().toISOString(),
    selected_posts: options.posts.length,
    selected_posts_by_platform: counts(options.posts.map((post) => post.platform)),
    collected_comment_rows: comments.length,
    retained_identity_free_signals: signals.length,
    counts_by_theme: counts(signals.map((signal) => signal.theme)),
    counts_by_platform: counts(signals.map((signal) => signal.community.replace(/_comment$/, ''))),
    runs,
    costs: {
      currency: 'USD',
      lane_cap_usd: 4,
      actual_cost_usd_reported: actualReported,
      conservative_spend_usd: conservativeSpend,
      remaining_ceiling_usd: money(4 - conservativeSpend),
    },
    signals,
    measurement_gaps: [
      ...runs.filter((run) => run.status !== 'completed').map((run) => `${run.id}: ${run.error ?? run.status}`),
      ...(completedRuns.some((run) => run.actual_cost_usd === null) ? ['At least one completed comment run did not report final invoice usage; its full ceiling remains conservatively consumed.'] : []),
      ...(signals.length < 18 ? [`Only ${signals.length} identity-free comment signals survived relevance and deduplication filters.`] : []),
      `Provider external calls made: ${externalCalls}.`,
    ],
    privacy: {
      usernames_persisted: false,
      profile_urls_persisted: false,
      raw_comment_text_persisted: false,
      comment_ids_persisted: false,
      identity_redacted_before_persistence: true,
    },
    redactions: ['credential values are never serialized'],
  };
  const manifest = {
    schema_version: 1,
    batch_id: options.batchId,
    purpose: 'identity_redacted_public_comment_research',
    publishing_in_scope: false,
    selected_posts: options.posts.map((post) => ({
      candidate_id: post.candidate_id,
      platform: post.platform,
      canonical_url: post.canonical_url,
    })),
    run_specs: specs,
    total_max_charge_usd: 4,
    privacy: {
      persist_commenter_usernames: false,
      persist_raw_comment_text: false,
      persist_comment_ids: false,
    },
  };
  return { manifest, report };
}

export async function reconcileExistingCommentSignalReport(options: {
  token: string;
  posts: EnrichedSemanticCandidate[];
  prior: CommentSignalReport;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<CommentSignalReport> {
  if (!options.token.trim()) throw new Error('APIFY_TOKEN is required.');
  const specs = new Map(buildCommentRunSpecs(options.posts).map((spec) => [spec.id, spec]));
  const selectedIds = new Set(options.posts.map((post) => `${post.platform}:${post.platform_post_id}`));
  const comments: TransientComment[] = [];
  let externalCalls = 0;
  const gaps: string[] = [];
  for (const priorRun of options.prior.runs) {
    if (priorRun.status !== 'completed' || !priorRun.run_id) continue;
    const spec = specs.get(priorRun.id);
    if (!spec) {
      gaps.push(`${priorRun.id}: no matching deterministic run specification.`);
      continue;
    }
    const client = new ApifyApiClient({ token: options.token, fetchImpl: options.fetchImpl, sleep: options.sleep });
    try {
      const run = await client.getRun(priorRun.run_id);
      if (!run.defaultDatasetId) throw new Error('completed run has no default dataset');
      const page = await client.getAllDatasetItems(run.defaultDatasetId, 500, spec.max_items);
      for (const raw of page.items) {
        const comment = transientComment(raw, spec, selectedIds);
        if (comment) comments.push(comment);
      }
    } catch (error) {
      gaps.push(`${priorRun.id}: ${redact(error instanceof Error ? error.message : String(error))}`);
    } finally {
      externalCalls += client.externalCallsMade;
    }
  }
  const signals = selectAndRedact(comments);
  const coveredPosts = new Set(signals.map((signal) => signal.source_url)).size;
  return {
    ...options.prior,
    generated_at: new Date().toISOString(),
    collected_comment_rows: comments.length,
    retained_identity_free_signals: signals.length,
    counts_by_theme: counts(signals.map((signal) => signal.theme)),
    counts_by_platform: counts(signals.map((signal) => signal.community.replace(/_comment$/, ''))),
    signals,
    measurement_gaps: [
      ...options.prior.runs.filter((run) => run.status !== 'completed').map((run) => `${run.id}: ${run.error ?? run.status}`),
      ...gaps,
      ...(signals.length < 18 ? [`Only ${signals.length} identity-free comment signals survived relevance and deduplication filters.`] : []),
      ...(coveredPosts < options.posts.length ? [`${options.posts.length - coveredPosts} of ${options.posts.length} selected posts returned no retained public comment signal; this is a comment-coverage gap, not negative audience evidence.`] : []),
      `Reconciled from existing completed datasets with ${externalCalls} read-only provider calls; no Actor was started.`,
    ],
  };
}

function transientComment(
  input: unknown,
  spec: CommentRunSpec,
  selectedIds: Set<string>,
): TransientComment | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const item = input as Record<string, unknown>;
  if (text(item.error) || text(item.errorCode)) return null;
  const commentText = firstText(item, ['text', 'comment', 'content', 'commentText']);
  if (!commentText) return null;
  const sourceUrl = commentSourceUrl(item, spec.platform);
  if (!sourceUrl) return null;
  let normalized: ReturnType<typeof normalizePublicPostUrl>;
  try {
    normalized = normalizePublicPostUrl(sourceUrl);
  } catch {
    return null;
  }
  if (!selectedIds.has(`${normalized.platform}:${normalized.platform_post_id}`)) return null;
  return {
    sourceUrl: normalized.canonical_url,
    platform: normalized.platform,
    text: commentText,
    publishedAt: dateValue(firstValue(item, ['createTimeISO', 'timestamp', 'publishedAt', 'date', 'publishedTimeText'])),
    likes: numberValue(firstValue(item, ['diggCount', 'likesCount', 'likes', 'likeCount', 'voteCount'])) ?? 0,
    providerCohort: spec.provider_cohort,
  };
}

function selectAndRedact(comments: TransientComment[]): AudienceSignal[] {
  const groups = new Map<string, TransientComment[]>();
  for (const comment of comments) {
    const key = `${comment.platform}:${normalizePublicPostUrl(comment.sourceUrl).platform_post_id}`;
    const rows = groups.get(key) ?? [];
    rows.push(comment);
    groups.set(key, rows);
  }
  const signals: AudienceSignal[] = [];
  const seenSignals = new Set<string>();
  for (const rows of groups.values()) {
    const unique = [...new Map(rows.map((row) => [`${sha256(row.text)}:${row.publishedAt ?? ''}`, row])).values()];
    const high = [...unique].sort((left, right) => right.likes - left.likes || left.text.localeCompare(right.text)).slice(0, 5);
    const recent = [...unique].sort((left, right) => (Date.parse(right.publishedAt ?? '') || 0) - (Date.parse(left.publishedAt ?? '') || 0)
      || left.text.localeCompare(right.text)).slice(0, 5);
    for (const comment of [...high, ...recent]) {
      const signal = identityFreeAudienceTextSignal({
        sourceUrl: comment.sourceUrl,
        sourceType: 'public_comment',
        community: `${comment.platform}_comment`,
        publishedAt: comment.publishedAt,
        transientText: comment.text,
      });
      if (!signal || seenSignals.has(signal.signal_id)) continue;
      seenSignals.add(signal.signal_id);
      signals.push(signal);
    }
  }
  return signals;
}

function commentSourceUrl(item: Record<string, unknown>, platform: SocialPlatform): string {
  const direct = firstText(item, ['videoWebUrl', 'videoUrl', 'postUrl', 'parentPostUrl', 'inputUrl', 'pageUrl', 'input', 'url']);
  if (direct && /^https:\/\//.test(direct)) return direct;
  if (platform === 'youtube_shorts') {
    const videoId = firstText(item, ['videoId', 'video.id']);
    if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }
  return '';
}

function firstValue(value: Record<string, unknown>, paths: string[]): unknown {
  for (const keyPath of paths) {
    let current: unknown = value;
    for (const key of keyPath.split('.')) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return null;
}

function firstText(value: Record<string, unknown>, paths: string[]): string {
  const found = firstValue(value, paths);
  return typeof found === 'string' ? found.trim() : '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function dateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1_000).toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function redact(value: string): string {
  return value
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as T;
}

function writeJson(filePath: string, value: unknown): void {
  atomicWriteJson(path.resolve(filePath), value);
}

function option(argv: string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function main(): Promise<void> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error('APIFY_TOKEN is required.');
  const argv = process.argv.slice(2);
  const selectionPath = option(argv, '--selection', '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-selection.json');
  const candidatesPath = option(argv, '--candidates', '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-live-candidates.json');
  const manifestOut = option(argv, '--manifest-out', '.ops/competitor_research/internship-us-comment-collection-20260716.json');
  const reportOut = option(argv, '--out', '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-comment-signals.json');
  const selection = readJson<SelectionLedger>(selectionPath);
  const candidates = readJson<LiveCandidateReport>(candidatesPath);
  const posts = chooseCommentPosts(selection, candidates);
  const existing = fs.existsSync(path.resolve(reportOut)) ? readJson<CommentSignalReport>(reportOut) : null;
  const result = existing
    ? {
      manifest: fs.existsSync(path.resolve(manifestOut)) ? readJson<unknown>(manifestOut) : { batch_id: selection.batch_id },
      report: await reconcileExistingCommentSignalReport({ token, posts, prior: existing }),
      mode: 'reconciled_existing_datasets',
    }
    : {
      ...(await collectIdentityFreeCommentSignals({ token, batchId: selection.batch_id, posts })),
      mode: 'live_collection',
    };
  writeJson(manifestOut, result.manifest);
  writeJson(reportOut, result.report);
  const hasCoverageGap = result.report.runs.some((run) => run.status !== 'completed')
    || new Set(result.report.signals.map((signal) => signal.source_url)).size < result.report.selected_posts;
  process.stdout.write(`${JSON.stringify({
    mode: result.mode,
    status: hasCoverageGap ? 'completed_with_gaps' : 'completed',
    selected_posts: result.report.selected_posts,
    collected_comment_rows: result.report.collected_comment_rows,
    identity_free_signals: result.report.retained_identity_free_signals,
    actual_cost_usd_reported: result.report.costs.actual_cost_usd_reported,
    conservative_spend_usd: result.report.costs.conservative_spend_usd,
    runs: result.report.runs.map((run) => ({ id: run.id, status: run.status, items: run.item_count, actual_cost_usd: run.actual_cost_usd })),
    manifest_path: manifestOut,
    output_path: reportOut,
  }, null, 2)}\n`);
}

if (require.main === module) void main();
