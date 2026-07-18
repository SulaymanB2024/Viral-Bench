import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import sharp from 'sharp';

import { sanitizePublicText } from '../internship-reels-site/lib/corpus';
import type { InternshipMediaManifest } from './internship-media-prep';
import type { SelectionLedger } from './internship-research-batch';
import type { ViralContentItem, ViralContentLibrary } from './viral-content-library';

type UnknownRecord = Record<string, unknown>;

const VIDEO_QUOTAS = {
  instagram: 3,
  tiktok: 3,
  youtube_shorts: 2,
} as const;
const STATIC_PER_TYPE = 3;
const STATIC_CALL_CEILING_USD = 0.5;

export interface VideoCanarySelection {
  candidate_id: string;
  platform: string;
  platform_post_id: string;
  account_handle: string;
  canonical_url: string;
  cohort: string;
  normalized_performance_score: number | null;
  media_path: string;
}

export interface StaticCanarySelection {
  item_id: string;
  platform_post_id: string;
  account_handle: string;
  canonical_url: string;
  content_type: 'carousel_post' | 'image_post';
  topic: string;
  signal: string;
  comparison_percentile: number | null;
  image_urls: string[];
}

export interface StaticAnalysisReport {
  schema_version: 'viralbench_static_analysis_v1';
  generated_at: string;
  target: 6;
  selected: number;
  analyzed: number;
  conservative_spend_usd: number;
  actual_charge_reported_by_provider: false;
  external_calls_made: number;
  records: UnknownRecord[];
  gaps: string[];
}

export function selectVideoCanary(
  manifest: InternshipMediaManifest,
  selection: SelectionLedger,
  analyzedReports: unknown[],
  sourceRoot: string,
): VideoCanarySelection[] {
  const analyzedIds = new Set(analyzedReports.flatMap((report) => (
    array(recordOrEmpty(report).records).map((row) => text(recordOrEmpty(row).candidate_id)).filter(Boolean)
  )));
  const selectedById = new Map(selection.entries
    .filter((entry) => entry.selected)
    .map((entry) => [entry.candidate_id, entry]));
  const eligible = manifest.rows.flatMap((row): VideoCanarySelection[] => {
    const ledger = selectedById.get(row.candidate_id);
    if (
      !ledger
      || analyzedIds.has(row.candidate_id)
      || row.retrieval_state !== 'ready'
      || row.media_kind !== 'downloaded_public_video'
      || !row.media_path
      || row.duration_sec === null
      || row.duration_sec > 90
      || ledger.normalized_performance_score === null
    ) return [];
    const mediaPath = path.isAbsolute(row.media_path) ? row.media_path : path.resolve(sourceRoot, row.media_path);
    if (!fs.existsSync(mediaPath)) return [];
    return [{
      candidate_id: row.candidate_id,
      platform: row.platform,
      platform_post_id: row.platform_post_id,
      account_handle: ledger.account_handle,
      canonical_url: row.canonical_url,
      cohort: ledger.cohort,
      normalized_performance_score: ledger.normalized_performance_score,
      media_path: mediaPath,
    }];
  }).sort((left, right) => (
    (right.normalized_performance_score ?? -1) - (left.normalized_performance_score ?? -1)
    || Number(left.cohort === 'recent') - Number(right.cohort === 'recent')
    || left.candidate_id.localeCompare(right.candidate_id)
  ));

  const result: VideoCanarySelection[] = [];
  const accounts = new Set<string>();
  for (const [platform, quota] of Object.entries(VIDEO_QUOTAS)) {
    const pool = eligible.filter((item) => item.platform === platform);
    const mixed = [
      ...pool.filter((item) => item.cohort === 'recent'),
      ...pool.filter((item) => item.cohort !== 'recent'),
    ];
    for (const item of mixed) {
      if (result.filter((entry) => entry.platform === platform).length >= quota) break;
      const account = item.account_handle.toLowerCase();
      if (account && accounts.has(account)) continue;
      result.push(item);
      if (account) accounts.add(account);
    }
  }
  if (result.length !== 8) {
    throw new Error(`Mixed-media video canary requires 8 eligible videos; selected ${result.length}.`);
  }
  for (const platform of Object.keys(VIDEO_QUOTAS)) {
    const count = result.filter((item) => item.platform === platform).length;
    if (count < 2 || count > 3) throw new Error(`Video canary platform balance failed for ${platform}.`);
  }
  return result;
}

export function selectStaticCanary(
  library: ViralContentLibrary,
  discoveryInputs: unknown[],
  options: {
    excludedItemIds?: ReadonlySet<string>;
  } = {},
): StaticCanarySelection[] {
  const rawItems = discoveryInputs.flatMap((input) => (
    array(recordOrEmpty(input).runs).flatMap((run) => array(recordOrEmpty(run).items))
  ));
  const rawByPostId = new Map<string, UnknownRecord>();
  for (const raw of rawItems) {
    const item = recordOrEmpty(raw);
    const url = firstText(item, ['url', 'postUrl', 'canonicalUrl']);
    const id = url ? instagramPostId(url) : null;
    if (id && !rawByPostId.has(id)) rawByPostId.set(id, item);
  }
  const candidates = library.items
    .filter((item): item is ViralContentItem & { content_type: 'carousel_post' | 'image_post' } => (
      item.platform === 'instagram'
      && (item.content_type === 'carousel_post' || item.content_type === 'image_post')
      && !options.excludedItemIds?.has(item.item_id)
    ))
    .map((item) => ({
      item,
      topic: classifyTopic(item),
      imageUrls: imageUrls(rawByPostId.get(item.platform_post_id)),
    }))
    .filter((row) => row.imageUrls.length > 0)
    .sort((left, right) => (
      signalPriority(left.item.performance.signal) - signalPriority(right.item.performance.signal)
      || (right.item.performance.comparison_percentile ?? -1) - (left.item.performance.comparison_percentile ?? -1)
      || left.item.item_id.localeCompare(right.item.item_id)
    ));

  const selected: StaticCanarySelection[] = [];
  const accounts = new Set<string>();
  const topics = new Set<string>();
  for (const contentType of ['carousel_post', 'image_post'] as const) {
    const pool = candidates.filter((row) => row.item.content_type === contentType);
    while (selected.filter((item) => item.content_type === contentType).length < STATIC_PER_TYPE) {
      const unusedTopic = pool.find((row) => (
        !selected.some((item) => item.item_id === row.item.item_id)
        && !accounts.has(row.item.account_handle.toLowerCase())
        && !topics.has(row.topic)
      ));
      const fallback = pool.find((row) => (
        !selected.some((item) => item.item_id === row.item.item_id)
        && !accounts.has(row.item.account_handle.toLowerCase())
      ));
      const row = unusedTopic ?? fallback;
      if (!row) break;
      selected.push({
        item_id: row.item.item_id,
        platform_post_id: row.item.platform_post_id,
        account_handle: row.item.account_handle,
        canonical_url: row.item.canonical_url,
        content_type: row.item.content_type,
        topic: row.topic,
        signal: row.item.performance.signal,
        comparison_percentile: row.item.performance.comparison_percentile,
        image_urls: row.imageUrls.slice(0, 5),
      });
      accounts.add(row.item.account_handle.toLowerCase());
      topics.add(row.topic);
    }
  }
  if (selected.length !== 6) throw new Error(`Static canary requires 6 resolvable items; selected ${selected.length}.`);
  if (accounts.size < 4) throw new Error('Static canary requires at least four independent accounts.');
  if (topics.size < 3) throw new Error('Static canary requires at least three audience topics.');
  return selected;
}

export async function analyzeStaticCanary(options: {
  selections: StaticCanarySelection[];
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<StaticAnalysisReport> {
  if (!options.apiKey.trim()) throw new Error('GEMINI_API_KEY is required for live static analysis.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const records: UnknownRecord[] = [];
  const gaps: string[] = [];
  let conservativeSpend = 0;
  let externalCalls = 0;

  for (const selection of options.selections) {
    if (roundMoney(conservativeSpend + STATIC_CALL_CEILING_USD) > 3) {
      gaps.push(`${selection.item_id}: static analysis budget stop`);
      break;
    }
    conservativeSpend = roundMoney(conservativeSpend + STATIC_CALL_CEILING_USD);
    try {
      const images = [];
      for (const url of selection.image_urls.slice(0, 5)) {
        const response = await fetchImpl(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
          headers: { Accept: 'image/*' },
        });
        externalCalls += 1;
        if (!response.ok) throw new Error(`image_http_${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('image_too_large');
        const normalized = await sharp(bytes)
          .rotate()
          .resize({ width: 1_024, height: 1_024, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        images.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: normalized.toString('base64'),
          },
        });
      }
      if (!images.length) throw new Error('no_reviewable_images');
      const response = await fetchImpl(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': options.apiKey,
          },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                {
                  text: [
                    `Analyze this ${selection.content_type.replaceAll('_', ' ')} as observational creative evidence.`,
                    'Describe only visible mechanics. Do not copy source wording, infer identity, promise outcomes, or claim a mechanism caused performance.',
                    'Return opening, progression, payoff, CTA, transferable patterns, and limitations.',
                  ].join(' '),
                },
                ...images,
              ],
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: staticAnalysisSchema(),
              maxOutputTokens: 1_400,
              temperature: 0.15,
            },
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      externalCalls += 1;
      if (!response.ok) throw new Error(`gemini_http_${response.status}`);
      const payload = await response.json() as UnknownRecord;
      const candidate = recordOrEmpty(array(payload.candidates)[0]);
      const content = recordOrEmpty(candidate.content);
      const firstPart = recordOrEmpty(array(content.parts)[0]);
      const outputText = text(
        firstPart.text,
      );
      const analysis = validateStaticAnalysis(JSON.parse(outputText) as unknown);
      records.push({
        candidate_id: selection.item_id,
        platform: 'instagram',
        platform_post_id: selection.platform_post_id,
        canonical_url: selection.canonical_url,
        account_handle: selection.account_handle,
        chosen_pillar: selection.topic,
        source_group: 'mixed_media_static_canary',
        metric_snapshot_at: now().toISOString(),
        quality: { passed: true, review_method: 'provider_quality_gate' },
        cohort: {
          success_percentile: selection.comparison_percentile,
          comparison_method: 'within_platform_content_type_and_age_bucket_percentile',
        },
        strategy: {
          data: analysis,
          provider_generation_id: text(payload.responseId) || null,
          finish_reason: text(candidate.finishReason) || null,
        },
        static_analysis: {
          content_type: selection.content_type,
          frames_reviewed: images.length,
          input_hash: crypto.createHash('sha256')
            .update(JSON.stringify({ item_id: selection.item_id, image_urls: selection.image_urls }))
            .digest('hex'),
        },
      });
    } catch (error) {
      gaps.push(`${selection.item_id}: ${safeFailure(error)}`);
    }
  }
  return {
    schema_version: 'viralbench_static_analysis_v1',
    generated_at: now().toISOString(),
    target: 6,
    selected: options.selections.length,
    analyzed: records.length,
    conservative_spend_usd: conservativeSpend,
    actual_charge_reported_by_provider: false,
    external_calls_made: externalCalls,
    records,
    gaps,
  };
}

function validateStaticAnalysis(value: unknown): UnknownRecord {
  const root = recordOrEmpty(value);
  const opening = recordOrEmpty(root.opening);
  const arc = recordOrEmpty(root.content_arc);
  const cta = recordOrEmpty(root.cta);
  const structure = recordOrEmpty(root.transferable_structure);
  for (const [label, candidate] of [
    ['opening.mechanism', opening.mechanism],
    ['content_arc.progression', arc.progression],
    ['content_arc.payoff', arc.payoff],
    ['transferable_structure.hook_pattern', structure.hook_pattern],
    ['transferable_structure.beat_pattern', structure.beat_pattern],
  ] as const) {
    if (!text(candidate).trim()) throw new Error(`missing_${label.replace('.', '_')}`);
  }
  return sanitizeObject(root);
}

function sanitizeObject(value: unknown): UnknownRecord {
  const sanitize = (input: unknown): unknown => {
    if (typeof input === 'string') return sanitizePublicText(input, 800);
    if (Array.isArray(input)) return input.slice(0, 12).map(sanitize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as UnknownRecord).map(([key, nested]) => [key, sanitize(nested)]));
    }
    return input;
  };
  return recordOrEmpty(sanitize(value));
}

function staticAnalysisSchema(): UnknownRecord {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['opening', 'content_arc', 'cta', 'claims', 'transferable_structure', 'evidence_limitations'],
    properties: {
      opening: {
        type: 'object',
        additionalProperties: false,
        required: ['observed_words', 'observed_visual', 'mechanism'],
        properties: {
          observed_words: { type: 'string' },
          observed_visual: { type: 'string' },
          mechanism: { type: 'string' },
        },
      },
      content_arc: {
        type: 'object',
        additionalProperties: false,
        required: ['audience_problem', 'progression', 'payoff'],
        properties: {
          audience_problem: { type: 'string' },
          progression: { type: 'string' },
          payoff: { type: 'string' },
        },
      },
      cta: {
        type: 'object',
        additionalProperties: false,
        required: ['observed_words', 'requested_action'],
        properties: {
          observed_words: { type: 'string' },
          requested_action: { type: 'string' },
        },
      },
      claims: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['observed_claim', 'evidence_status'],
          properties: {
            observed_claim: { type: 'string' },
            evidence_status: { type: 'string', enum: ['visible', 'unsupported'] },
          },
        },
      },
      transferable_structure: {
        type: 'object',
        additionalProperties: false,
        required: ['hook_pattern', 'beat_pattern', 'payoff_pattern'],
        properties: {
          hook_pattern: { type: 'string' },
          beat_pattern: { type: 'string' },
          payoff_pattern: { type: 'string' },
        },
      },
      evidence_limitations: { type: 'array', maxItems: 8, items: { type: 'string' } },
    },
  };
}

function imageUrls(value: UnknownRecord | undefined): string[] {
  if (!value) return [];
  const candidates: string[] = [];
  for (const key of ['displayUrl', 'imageUrl', 'thumbnailUrl']) {
    const url = text(value[key]);
    if (url.startsWith('https://')) candidates.push(url);
  }
  for (const key of ['images', 'childPosts', 'sidecarChildren']) {
    for (const raw of array(value[key])) {
      if (typeof raw === 'string' && raw.startsWith('https://')) candidates.push(raw);
      const item = recordOrEmpty(raw);
      for (const nestedKey of ['displayUrl', 'imageUrl', 'url']) {
        const url = text(item[nestedKey]);
        if (url.startsWith('https://')) candidates.push(url);
      }
      for (const nested of array(item.images)) {
        if (typeof nested === 'string' && nested.startsWith('https://')) candidates.push(nested);
        const nestedRecord = recordOrEmpty(nested);
        const url = text(nestedRecord.url || nestedRecord.src);
        if (url.startsWith('https://')) candidates.push(url);
      }
    }
  }
  return [...new Set(candidates)].slice(0, 5);
}

function classifyTopic(item: ViralContentItem): string {
  const textValue = `${item.caption} ${item.hashtags.join(' ')}`.toLowerCase();
  if (/\b(pay|paid|housing|cost|afford|salary|wage)\b/.test(textValue)) return 'access_compensation_and_cost';
  if (/\b(interview|hirevue|behavioral)\b/.test(textValue)) return 'interview_preparation';
  if (/\b(scam|fake|unpaid|rights?|cpt|opt)\b/.test(textValue)) return 'opportunity_safety';
  if (/\b(resume|cv|application|cover letter)\b/.test(textValue)) return 'resume_and_application';
  if (/\b(network|linkedin|referral)\b/.test(textValue)) return 'networking';
  return 'general_early_career_uncertainty';
}

function instagramPostId(value: string): string | null {
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return ['p', 'reel', 'reels'].includes(parts[0] ?? '') ? parts[1] ?? null : null;
  } catch {
    return null;
  }
}

function firstText(value: UnknownRecord, paths: string[]): string | null {
  for (const key of paths) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function signalPriority(signal: string): number {
  return {
    breakout_candidate: 0,
    evergreen_winner: 1,
    high_performer: 2,
    promising: 3,
    baseline: 4,
    insufficient_data: 5,
  }[signal] ?? 6;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordOrEmpty(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:AIza|apify_api_|tlk_)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/https?:\/\/\S+/g, '[URL REDACTED]')
    .slice(0, 240);
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
