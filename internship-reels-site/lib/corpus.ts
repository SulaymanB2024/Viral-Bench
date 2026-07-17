import { createHash } from 'node:crypto';

import {
  PERFORMANCE_SIGNALS,
  SOCIAL_PLATFORMS,
  type AgentAnalysis,
  type AgentCorpus,
  type AgentDocument,
  type AgentMetrics,
  type PerformanceSignal,
  type SocialPlatform,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const INLINE_URL = /\bhttps?:\/\/[^\s<>"']+/gi;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizePublicText(value: unknown, maxLength = 3_000): string {
  if (typeof value !== 'string') return '';
  const withoutContacts = value
    .replace(EMAIL, '[email redacted]')
    .replace(INLINE_URL, '[link redacted]')
    .replace(/(?:\+?\d[\s().-]*){7,}/g, (candidate) => (
      candidate.replace(/\D/g, '').length >= 7 ? '[phone redacted]' : candidate
    ))
    .replace(CONTROL, ' ');
  const compact = withoutContacts.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function parseDashboardSnapshot(source: string): UnknownRecord {
  const marker = 'window.__TWELVELABS_DASHBOARD_SNAPSHOT__ = ';
  const start = source.indexOf(marker);
  const endMarker = ';\nwindow.dispatchEvent';
  const end = source.indexOf(endMarker, start + marker.length);
  if (start < 0 || end < 0) {
    throw new Error('TwelveLabs dashboard snapshot assignment was not found.');
  }
  const parsed = JSON.parse(source.slice(start + marker.length, end)) as unknown;
  return record(parsed, 'dashboard snapshot');
}

export function buildAgentCorpus(libraryInput: unknown, dashboardInput: unknown): AgentCorpus {
  const library = record(libraryInput, 'library');
  const dashboard = record(dashboardInput, 'dashboard');
  const items = array(library.items);
  const dashboardRecords = array(dashboard.records);
  const documents = new Map<string, AgentDocument>();
  const skippedByReason = new Map<string, number>();
  const skip = (source: 'library' | 'dashboard', reason: string): void => {
    const key = `${source}:${reason}`;
    skippedByReason.set(key, (skippedByReason.get(key) ?? 0) + 1);
  };

  for (const input of items) {
    const item = optionalRecord(input);
    if (!item) {
      skip('library', 'invalid_row_shape');
      continue;
    }
    const platform = socialPlatform(item.platform);
    const platformPostId = text(item.platform_post_id);
    if (!platform) {
      skip('library', 'invalid_or_missing_platform');
      continue;
    }
    if (!platformPostId) {
      skip('library', 'missing_platform_post_id');
      continue;
    }
    const performance = optionalRecord(item.performance);
    const observations = array(item.observations);
    const latestObservation = optionalRecord(observations.at(-1));
    const sourceExpression = sanitizePublicText(item.caption);
    const hashtags = textArray(item.hashtags).map((tag) => sanitizePublicText(tag, 80)).filter(Boolean);
    const document = finalizeDocument({
      document_id: `evidence:${platform}:${platformPostId}`,
      item_id: text(item.item_id) || `${platform}:post:${platformPostId}`,
      kind: 'library_item',
      platform,
      platform_post_id: platformPostId,
      canonical_url: safePublicUrl(item.canonical_url),
      account_handle: sanitizePublicText(item.account_handle, 120),
      source_expression: sourceExpression,
      hashtags,
      posted_at: isoDate(item.posted_at),
      last_observed_at: isoDate(item.last_seen_at) ?? isoDate(latestObservation?.captured_at),
      signal: performanceSignal(performance?.signal),
      age_bucket: nullableText(performance?.age_bucket),
      comparison_percentile: nullableNumber(performance?.comparison_percentile),
      comparison_group_size: nullableNumber(performance?.comparison_group_size),
      confidence: sanitizePublicText(performance?.confidence, 40) || 'unknown',
      metrics: {
        views: nullableNumber(performance?.latest_views) ?? nullableNumber(latestObservation?.views),
        likes: nullableNumber(latestObservation?.likes),
        comments: nullableNumber(latestObservation?.comments),
        shares: nullableNumber(latestObservation?.shares),
        saves: nullableNumber(latestObservation?.saves),
        engagement_rate: nullableNumber(performance?.latest_engagement_rate),
        observed_view_velocity_per_hour: nullableNumber(performance?.observed_view_velocity_per_hour),
      },
      analysis: null,
      evidence_limitations: uniqueStrings([
        ...textArray(performance?.evidence_limitations),
        'Source captions describe creator expression and are not independently verified factual claims.',
      ]),
      search_text: '',
      content_hash: '',
    });
    documents.set(documentKey(platform, platformPostId), document);
  }

  for (const input of dashboardRecords) {
    const item = optionalRecord(input);
    if (!item) {
      skip('dashboard', 'invalid_row_shape');
      continue;
    }
    const platform = socialPlatform(item.platform);
    const platformPostId = text(item.platform_post_id);
    if (!platform) {
      skip('dashboard', 'invalid_or_missing_platform');
      continue;
    }
    if (!platformPostId) {
      skip('dashboard', 'missing_platform_post_id');
      continue;
    }
    const key = documentKey(platform, platformPostId);
    const existing = documents.get(key);
    const strategy = optionalRecord(optionalRecord(item.strategy)?.data);
    const analysis = analysisFromStrategy(strategy);
    const metrics = optionalRecord(item.metrics);
    const cohort = optionalRecord(item.cohort);
    const quality = optionalRecord(item.quality);
    const dashboardLimitations = uniqueStrings([
      ...analysis.evidence_limitations,
      ...(quality?.passed === false ? ['Provider quality checks did not pass for this analysis.'] : []),
      'Observed creative mechanics are research evidence, not reusable creator wording, footage, or identity.',
    ]);

    const merged = finalizeDocument({
      document_id: existing?.document_id ?? `evidence:${platform}:${platformPostId}`,
      item_id: existing?.item_id ?? (text(item.candidate_id) || `${platform}:post:${platformPostId}`),
      kind: 'analyzed_post',
      platform,
      platform_post_id: platformPostId,
      canonical_url: existing?.canonical_url || safePublicUrl(item.canonical_url),
      account_handle: existing?.account_handle || sanitizePublicText(item.account_handle, 120),
      source_expression: existing?.source_expression || analysis.opening_text,
      hashtags: existing?.hashtags ?? [],
      posted_at: existing?.posted_at ?? isoDate(item.posted_at),
      last_observed_at: latestNullableIso(
        existing?.last_observed_at ?? null,
        isoDate(item.metric_snapshot_at),
      ),
      signal: existing?.signal ?? 'analyzed',
      age_bucket: existing?.age_bucket ?? null,
      comparison_percentile: existing?.comparison_percentile ?? nullableNumber(cohort?.success_percentile),
      comparison_group_size: existing?.comparison_group_size ?? null,
      confidence: existing?.confidence ?? (quality?.passed === true ? 'provider_quality_passed' : 'unknown'),
      metrics: mergeMetrics(
        existing?.metrics,
        metrics,
        existing?.last_observed_at ?? null,
        isoDate(item.metric_snapshot_at),
      ),
      analysis,
      evidence_limitations: uniqueStrings([
        ...(existing?.evidence_limitations ?? []),
        ...dashboardLimitations,
      ]),
      search_text: '',
      content_hash: '',
    });
    documents.set(key, merged);
  }

  const sorted = [...documents.values()].sort((left, right) => (
    left.document_id.localeCompare(right.document_id)
  ));
  const indexVersion = stableHash(sorted.map((item) => [item.document_id, item.content_hash])).slice(0, 20);
  return {
    schema_version: 'viralbench_agent_corpus_v1',
    generated_at: latestIso(
      nullableText(library.generated_at),
      nullableText(dashboard.generated_at),
    ),
    index_version: indexVersion,
    source_manifest: {
      library_generated_at: isoDate(library.generated_at),
      dashboard_generated_at: isoDate(dashboard.generated_at),
      library_items: items.length,
      dashboard_records: dashboardRecords.length,
      deduplicated_documents: sorted.length,
      skipped_rows: [...skippedByReason.values()].reduce((sum, count) => sum + count, 0),
      skipped_by_reason: Object.fromEntries([...skippedByReason.entries()].sort(([left], [right]) => (
        left.localeCompare(right)
      ))),
      redactions: [
        'email addresses',
        'phone numbers',
        'non-canonical URLs inside source text',
        'claims explicitly marked unsupported by the analysis provider',
        'comment identities and private account data are not indexed',
      ],
    },
    documents: sorted,
  };
}

function analysisFromStrategy(strategy: UnknownRecord | null): AgentAnalysis {
  const opening = optionalRecord(strategy?.opening);
  const arc = optionalRecord(strategy?.content_arc);
  const cta = optionalRecord(strategy?.cta);
  const structure = optionalRecord(strategy?.transferable_structure);
  const claims = array(strategy?.claims)
    .map((value) => optionalRecord(value))
    .filter((value): value is UnknownRecord => Boolean(value))
    .filter((value) => ['visible', 'spoken'].includes(text(value.evidence_status)))
    .map((value) => sanitizePublicText(value.observed_claim, 400))
    .filter(Boolean);
  return {
    opening_text: sanitizePublicText(opening?.observed_words, 800),
    hook_pattern: sanitizePublicText(structure?.hook_pattern, 500),
    beat_pattern: sanitizePublicText(structure?.beat_pattern, 500),
    payoff_pattern: sanitizePublicText(structure?.payoff_pattern, 500),
    audience_problem: sanitizePublicText(arc?.audience_problem, 500),
    cta: sanitizePublicText(cta?.requested_action, 400),
    claims,
    evidence_limitations: uniqueStrings(textArray(strategy?.evidence_limitations)),
  };
}

function finalizeDocument(input: AgentDocument): AgentDocument {
  const searchText = [
    input.account_handle,
    input.source_expression,
    input.hashtags.join(' '),
    input.analysis?.opening_text,
    input.analysis?.hook_pattern,
    input.analysis?.beat_pattern,
    input.analysis?.payoff_pattern,
    input.analysis?.audience_problem,
    input.analysis?.cta,
  ].filter(Boolean).join(' ');
  const withoutDerived = {
    ...input,
    search_text: sanitizePublicText(searchText, 8_000),
    content_hash: '',
  };
  return {
    ...withoutDerived,
    content_hash: stableHash(withoutDerived),
  };
}

function mergeMetrics(
  existing: AgentMetrics | undefined,
  next: UnknownRecord | null,
  existingObservedAt: string | null,
  nextObservedAt: string | null,
): AgentMetrics {
  const useNext = next !== null && (
    !existing
    || timestamp(nextObservedAt) > timestamp(existingObservedAt)
  );
  if (useNext) {
    return {
      views: nullableNumber(next.views),
      likes: nullableNumber(next.likes),
      comments: nullableNumber(next.comments),
      shares: nullableNumber(next.shares),
      saves: nullableNumber(next.saves),
      engagement_rate: nullableNumber(next.engagement_rate),
      observed_view_velocity_per_hour: nullableNumber(next.observed_view_velocity_per_hour),
    };
  }
  return {
    views: existing?.views ?? nullableNumber(next?.views),
    likes: existing?.likes ?? nullableNumber(next?.likes),
    comments: existing?.comments ?? nullableNumber(next?.comments),
    shares: existing?.shares ?? nullableNumber(next?.shares),
    saves: existing?.saves ?? nullableNumber(next?.saves),
    engagement_rate: existing?.engagement_rate ?? null,
    observed_view_velocity_per_hour: existing?.observed_view_velocity_per_hour ?? null,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as UnknownRecord).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function optionalRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function socialPlatform(value: unknown): SocialPlatform | null {
  return typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value)
    ? value as SocialPlatform
    : null;
}

function performanceSignal(value: unknown): PerformanceSignal {
  return typeof value === 'string' && (PERFORMANCE_SIGNALS as readonly string[]).includes(value)
    ? value as PerformanceSignal
    : 'insufficient_data';
}

function safePublicUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestIso(...values: Array<string | null>): string {
  const timestamps = values
    .map((value) => value ? new Date(value).getTime() : Number.NaN)
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : new Date(0).toISOString();
}

function latestNullableIso(...values: Array<string | null>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  return valid.length ? latestIso(...valid) : null;
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function documentKey(platform: SocialPlatform, platformPostId: string): string {
  return `${platform}:${platformPostId}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizePublicText(value, 500)).filter(Boolean))];
}
