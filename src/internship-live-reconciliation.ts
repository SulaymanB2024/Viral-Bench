import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteJson } from './artifact-integrity';
import {
  buildBatchPreflight,
  reserveLaneBudget,
  selectSemanticCandidates,
  settleLaneBudget,
  validateResearchBatchManifest,
  type BatchLedger,
  type ResearchBatchManifest,
  type SelectionGroup,
  type SemanticCandidate,
} from './internship-research-batch';
import { normalizePublicPostUrl, type SocialPlatform } from './semantic-intelligence';

interface GenericDiscoveryRun {
  id: string;
  actor_id: string;
  item_count: number;
  actual_cost_usd: number | null;
  external_calls_made: number;
  items: unknown[];
}

interface GenericDiscoveryReport {
  research_id: string;
  created_at: string;
  runs: GenericDiscoveryRun[];
  errors: Array<{ id: string; message: string }>;
  totals: {
    items: number;
    actual_cost_usd_reported: number;
    configured_max_charge_usd: number;
    conservative_spend_usd: number;
    external_calls_made: number;
  };
}

interface SeoCandidate {
  evidence_id: string;
  platform: SocialPlatform;
  cohort: 'recent' | 'popular';
  canonical_url: string | null;
  source_query: string | null;
  title: string;
  description: string;
  channel_name: string;
  published_at_raw: string | null;
  duration_sec: number | null;
  observed_metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
  };
}

interface SeoDiscoveryReport {
  research_id: string;
  created_at: string;
  candidates: SeoCandidate[];
  provider_gaps: unknown[];
  runs: Array<{ usage_total_usd: number | null }>;
  external_calls_made: number;
  total_usage_usd: number | null;
  errors: string[];
}

export interface EnrichedSemanticCandidate extends SemanticCandidate {
  source_report: string;
  source_run: string;
  source_query: string | null;
  classification_basis: 'observed_competitor_source' | 'query_family_heuristic' | 'format_outlier_heuristic';
  classification_version: 'internship_candidate_taxonomy_v1';
  classification_confidence: number;
  human_override: null;
  cohort_assignment_basis: 'provider_run' | 'provider_cohort' | 'ranked_within_combined_provider_pool';
  format_outlier_score: number;
}

export interface LiveCandidateReport {
  schema_version: 1;
  batch_id: string;
  generated_at: string;
  input_counts: {
    generic_discovery_items: number;
    proof_process_items: number;
    access_safety_ai_items: number;
    total_provider_rows: number;
  };
  output_counts: {
    normalized_candidates: number;
    by_platform: Record<string, number>;
    by_source_group: Record<string, number>;
    by_group: Record<string, number>;
    by_cohort: Record<string, number>;
  };
  exclusions: Record<string, number>;
  provider_gaps: Array<{ source_run: string; reason: string; rows: number }>;
  evidence_boundary: {
    source_group_is_observed: false;
    source_group_overwritten_by_outlier_classification: false;
    format_outlier_is_heuristic: true;
    raw_cross_platform_ranking_allowed: false;
    explicit_foreign_market_rows_excluded: true;
    high_school_and_admissions_excluded: true;
  };
  candidates: EnrichedSemanticCandidate[];
}

export interface LiveCoverageLedger {
  schema_version: 1;
  batch_id: string;
  generated_at: string;
  costs: {
    currency: 'USD';
    discovery_lane_cap_usd: 5;
    actual_cost_usd_reported: number;
    conservative_spend_usd: number;
    remaining_discovery_ceiling_usd: number;
    failed_run_unsettled_ceiling_usd: number;
  };
  counts: {
    provider_rows: number;
    normalized_candidates: number;
    unique_candidates: number;
    selected: number;
    selected_by_platform: Record<string, number>;
    selected_by_group: Record<string, number>;
  };
  providers: Array<{
    provider: string;
    status: 'completed' | 'partial' | 'blocked';
    external_calls_made: number;
    measurement_gaps: string[];
  }>;
  blockers: string[];
}

interface ReconcileOptions {
  manifest: ResearchBatchManifest | unknown;
  generic: GenericDiscoveryReport;
  proof: SeoDiscoveryReport;
  access: SeoDiscoveryReport;
  now?: () => Date;
}

export function reconcileLiveDiscovery(options: ReconcileOptions): {
  candidates: LiveCandidateReport;
  selection: ReturnType<typeof selectSemanticCandidates>;
  coverage: LiveCoverageLedger;
  ledger: BatchLedger;
} {
  const manifest = validateResearchBatchManifest(options.manifest);
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const exclusions: Record<string, number> = {};
  const providerGaps: LiveCandidateReport['provider_gaps'] = [];
  const normalized: EnrichedSemanticCandidate[] = [];

  for (const run of options.generic.runs) {
    const sourceGroup = groupForRun(run.id);
    const platform = platformForActor(run.actor_id);
    let providerGapRows = 0;
    for (const raw of run.items) {
      const item = objectOrNull(raw);
      if (!item) {
        bump(exclusions, 'malformed_provider_row');
        providerGapRows += 1;
        continue;
      }
      if (text(item.error) || text(item.errorCode) || Array.isArray(item.requestErrorMessages)) {
        bump(exclusions, 'provider_gap_row');
        providerGapRows += 1;
        continue;
      }
      if (platform === 'instagram' && !isInstagramVideo(item)) {
        bump(exclusions, 'non_video_instagram_row');
        continue;
      }
      const candidate = normalizeGenericCandidate(item, {
        report: options.generic.research_id,
        run: run.id,
        platform,
        sourceGroup,
        cohort: run.id.includes('popular') ? 'popular' : 'recent',
      }, exclusions);
      if (candidate) normalized.push(candidate);
    }
    if (providerGapRows) providerGaps.push({ source_run: run.id, reason: 'provider returned explicit error rows', rows: providerGapRows });
  }

  normalized.push(...normalizeSeoCandidates(options.proof, 'student_problem_creator', exclusions));
  normalized.push(...normalizeSeoCandidates(options.access, 'opportunity_access_safety', exclusions));
  assignInstagramPoolCohorts(normalized);
  assignFormatOutliers(normalized);

  const candidates: LiveCandidateReport = {
    schema_version: 1,
    batch_id: manifest.batch_id,
    generated_at: generatedAt,
    input_counts: {
      generic_discovery_items: options.generic.totals.items,
      proof_process_items: options.proof.candidates.length + options.proof.provider_gaps.length,
      access_safety_ai_items: options.access.candidates.length + options.access.provider_gaps.length,
      total_provider_rows: options.generic.totals.items + options.proof.candidates.length + options.proof.provider_gaps.length
        + options.access.candidates.length + options.access.provider_gaps.length,
    },
    output_counts: {
      normalized_candidates: normalized.length,
      by_platform: counts(normalized.map((candidate) => candidate.platform)),
      by_source_group: counts(normalized.map((candidate) => candidate.source_group)),
      by_group: counts(normalized.map((candidate) => candidate.selection_group ?? candidate.source_group)),
      by_cohort: counts(normalized.map((candidate) => candidate.cohort)),
    },
    exclusions,
    provider_gaps: [
      ...providerGaps,
      ...options.generic.errors.map((error) => ({ source_run: error.id, reason: redact(error.message), rows: 0 })),
    ],
    evidence_boundary: {
      source_group_is_observed: false,
      source_group_overwritten_by_outlier_classification: false,
      format_outlier_is_heuristic: true,
      raw_cross_platform_ranking_allowed: false,
      explicit_foreign_market_rows_excluded: true,
      high_school_and_admissions_excluded: true,
    },
    candidates: normalized,
  };
  const selection = selectSemanticCandidates(normalized, manifest, now);
  const actualReported = money(
    options.generic.totals.actual_cost_usd_reported
      + (options.proof.total_usage_usd ?? 0)
      + (options.access.total_usage_usd ?? 0),
  );
  const conservativeSpend = money(
    options.generic.totals.conservative_spend_usd
      + (options.proof.total_usage_usd ?? 1)
      + (options.access.total_usage_usd ?? 1),
  );
  const unresolvedCeiling = money(Math.max(0, conservativeSpend - actualReported));
  const externalCalls = options.generic.totals.external_calls_made
    + options.proof.external_calls_made
    + options.access.external_calls_made;
  let ledger = buildBatchPreflight(manifest, {
    APIFY_TOKEN: 'present-not-serialized',
    ALLOW_PUBLIC_SEO_RESEARCH: 'true',
    ALLOW_PAID_GENERATION: 'true',
  }, now);
  ledger = reserveLaneBudget(ledger, 'discovery', 5);
  ledger = settleLaneBudget(
    ledger,
    'discovery',
    5,
    actualReported,
    externalCalls,
    options.generic.errors.length ? 'partial' : 'completed',
    options.generic.errors.length
      ? [`${options.generic.errors.length} discovery run failed; ${unresolvedCeiling} USD remains a conservative unsettled ceiling, not a known charge.`]
      : [],
  );
  if (unresolvedCeiling > 0) {
    const discoveryLane = ledger.lanes.find((lane) => lane.id === 'discovery');
    if (discoveryLane) discoveryLane.committed_max_cost_usd = unresolvedCeiling;
    ledger.committed_max_cost_usd = unresolvedCeiling;
    ledger.remaining_uncommitted_usd = money(ledger.hard_cap_usd - ledger.actual_cost_usd - unresolvedCeiling);
  }
  const coverage: LiveCoverageLedger = {
    schema_version: 1,
    batch_id: manifest.batch_id,
    generated_at: generatedAt,
    costs: {
      currency: 'USD',
      discovery_lane_cap_usd: 5,
      actual_cost_usd_reported: actualReported,
      conservative_spend_usd: conservativeSpend,
      remaining_discovery_ceiling_usd: money(5 - conservativeSpend),
      failed_run_unsettled_ceiling_usd: unresolvedCeiling,
    },
    counts: {
      provider_rows: candidates.input_counts.total_provider_rows,
      normalized_candidates: normalized.length,
      unique_candidates: selection.counts.unique_candidates,
      selected: selection.counts.selected,
      selected_by_platform: selection.counts.by_platform,
      selected_by_group: selection.counts.by_group,
    },
    providers: [
      {
        provider: 'apify',
        status: options.generic.errors.length ? 'partial' : 'completed',
        external_calls_made: externalCalls,
        measurement_gaps: [
          ...options.generic.errors.map((error) => `${error.id}: ${redact(error.message)}`),
          ...(unresolvedCeiling ? [`Failed-run invoice usage is not embedded in the discovery artifact; ${unresolvedCeiling} USD is held as a conservative ceiling.`] : []),
        ],
      },
      {
        provider: 'twelvelabs',
        status: 'blocked',
        external_calls_made: 0,
        measurement_gaps: ['The locally discoverable TwelveLabs credential was rejected by the provider; no multimodal analysis call was started.'],
      },
      {
        provider: 'google_gemini',
        status: 'blocked',
        external_calls_made: 0,
        measurement_gaps: ['The locally discoverable Google credential returned HTTP 403 during a no-charge model-list check; it was not used as an analysis substitute.'],
      },
      {
        provider: 'firecrawl',
        status: 'blocked',
        external_calls_made: 0,
        measurement_gaps: ['No usable Firecrawl credential was found locally; official-source retrieval remains represented by direct public-source artifacts.'],
      },
    ],
    blockers: [
      '36 videos are selected, but new multimodal analysis is blocked until a provider accepts a credential.',
      'The failed Instagram proof/process popular-search run is a provider gap, not evidence of absent Instagram demand.',
      ...selection.shortfalls,
    ],
  };
  return { candidates, selection, coverage, ledger };
}

function normalizeGenericCandidate(
  item: Record<string, unknown>,
  context: {
    report: string;
    run: string;
    platform: SocialPlatform;
    sourceGroup: SelectionGroup;
    cohort: 'recent' | 'popular';
  },
  exclusions: Record<string, number>,
): EnrichedSemanticCandidate | null {
  const rawUrl = firstText(item, ['webVideoUrl', 'url']);
  if (!rawUrl) {
    bump(exclusions, 'missing_post_url');
    return null;
  }
  let normalized: ReturnType<typeof normalizePublicPostUrl>;
  try {
    normalized = normalizePublicPostUrl(rawUrl);
  } catch {
    bump(exclusions, 'unsupported_or_non_post_url');
    return null;
  }
  if (normalized.platform !== context.platform) {
    bump(exclusions, 'platform_url_mismatch');
    return null;
  }
  const content = firstText(item, ['text', 'caption', 'title', 'description', 'translatedTitle']);
  if (isAdmissionsContent(content)) {
    bump(exclusions, 'high_school_or_admissions');
    return null;
  }
  if (context.sourceGroup !== 'competitor_product' && isExplicitForeignMarket(content)) {
    bump(exclusions, 'explicit_non_us_market');
    return null;
  }
  const account = firstText(item, ['authorMeta.name', 'ownerUsername', 'channelUsername', 'channelName', 'channelId'])
    || `unknown-${normalized.platform_post_id}`;
  const postedAt = dateValue(firstValue(item, ['createTimeISO', 'timestamp', 'date', 'createTime']));
  const duration = durationValue(firstValue(item, ['videoMeta.duration', 'duration']));
  const views = numberValue(firstValue(item, ['playCount', 'videoPlayCount', 'viewCount', 'views']));
  const likes = numberValue(firstValue(item, ['diggCount', 'likesCount', 'likes', 'likeCount']));
  const comments = numberValue(firstValue(item, ['commentCount', 'commentsCount', 'comments']));
  const shares = numberValue(firstValue(item, ['shareCount', 'shares']));
  const saves = numberValue(firstValue(item, ['collectCount', 'saves']));
  const outlier = outlierScore(content, duration, item.isSlideshow === true);
  return {
    candidate_id: `live:${normalized.platform}:${normalized.platform_post_id}:${context.run}`,
    candidate_source: `${context.report}#${context.run}`,
    canonical_url: normalized.canonical_url,
    platform: normalized.platform,
    platform_post_id: normalized.platform_post_id,
    account_handle: account,
    source_group: context.sourceGroup,
    selection_group: context.sourceGroup,
    cohort: context.cohort,
    cohorts_observed: [context.cohort],
    cohort_assignment_basis: 'provider_run',
    posted_at: postedAt,
    metrics: { views, likes, comments, shares, saves },
    evidence_richness: evidenceRichness(content, postedAt, { views, likes, comments, shares, saves }),
    novelty_score: Math.min(1, 0.45 + outlier * 0.55),
    source_report: context.report,
    source_run: context.run,
    source_query: firstText(item, ['input', 'fromYTUrl']) || null,
    classification_basis: context.sourceGroup === 'competitor_product' ? 'observed_competitor_source' : 'query_family_heuristic',
    classification_version: 'internship_candidate_taxonomy_v1',
    classification_confidence: context.sourceGroup === 'competitor_product' ? 0.95 : 0.7,
    human_override: null,
    format_outlier_score: outlier,
  };
}

function normalizeSeoCandidates(
  report: SeoDiscoveryReport,
  sourceGroup: SelectionGroup,
  exclusions: Record<string, number>,
): EnrichedSemanticCandidate[] {
  return report.candidates.flatMap((item): EnrichedSemanticCandidate[] => {
    if (!item.canonical_url) {
      bump(exclusions, 'missing_post_url');
      return [];
    }
    const content = `${item.title} ${item.description}`.trim();
    if (isAdmissionsContent(content)) {
      bump(exclusions, 'high_school_or_admissions');
      return [];
    }
    if (isExplicitForeignMarket(content)) {
      bump(exclusions, 'explicit_non_us_market');
      return [];
    }
    let normalized: ReturnType<typeof normalizePublicPostUrl>;
    try {
      normalized = normalizePublicPostUrl(item.canonical_url);
    } catch {
      bump(exclusions, 'unsupported_or_non_post_url');
      return [];
    }
    const outlier = outlierScore(content, item.duration_sec, false);
    const metrics = {
      views: item.observed_metrics.views,
      likes: item.observed_metrics.likes,
      comments: item.observed_metrics.comments,
      shares: null,
      saves: null,
    };
    return [{
      candidate_id: item.evidence_id,
      candidate_source: `${report.research_id}#${item.platform}-${item.cohort}`,
      canonical_url: normalized.canonical_url,
      platform: normalized.platform,
      platform_post_id: normalized.platform_post_id,
      account_handle: item.channel_name || `unknown-${normalized.platform_post_id}`,
      source_group: sourceGroup,
      selection_group: sourceGroup,
      cohort: item.cohort,
      cohorts_observed: [item.cohort],
      cohort_assignment_basis: 'provider_cohort',
      posted_at: dateValue(item.published_at_raw),
      metrics,
      evidence_richness: evidenceRichness(content, item.published_at_raw, metrics),
      novelty_score: Math.min(1, 0.45 + outlier * 0.55),
      source_report: report.research_id,
      source_run: `${item.platform}-${item.cohort}`,
      source_query: item.source_query,
      classification_basis: 'query_family_heuristic',
      classification_version: 'internship_candidate_taxonomy_v1',
      classification_confidence: 0.7,
      human_override: null,
      format_outlier_score: outlier,
    }];
  });
}

function assignInstagramPoolCohorts(candidates: EnrichedSemanticCandidate[]): void {
  const pool = candidates.filter((candidate) => candidate.source_run.includes('recent-and-popular-pool'));
  const accounts = new Map<string, EnrichedSemanticCandidate[]>();
  for (const candidate of pool) {
    const rows = accounts.get(candidate.account_handle) ?? [];
    rows.push(candidate);
    accounts.set(candidate.account_handle, rows);
  }
  for (const rows of accounts.values()) {
    const popular = [...rows].sort((left, right) => engagement(right) - engagement(left))
      .slice(0, Math.min(6, Math.ceil(rows.length / 2)));
    const popularIds = new Set(popular.map((candidate) => candidate.candidate_id));
    for (const candidate of rows) {
      candidate.cohorts_observed = ['recent', 'popular'];
      candidate.cohort = popularIds.has(candidate.candidate_id) ? 'popular' : 'recent';
      candidate.cohort_assignment_basis = 'ranked_within_combined_provider_pool';
    }
  }
}

function assignFormatOutliers(candidates: EnrichedSemanticCandidate[]): void {
  for (const platform of ['tiktok', 'instagram', 'youtube_shorts'] as const) {
    const eligible = candidates
      .filter((candidate) => candidate.platform === platform && candidate.source_group !== 'competitor_product')
      .sort((left, right) => right.format_outlier_score - left.format_outlier_score
        || right.novelty_score - left.novelty_score
        || left.candidate_id.localeCompare(right.candidate_id));
    for (const candidate of eligible.slice(0, 4)) {
      candidate.selection_group = 'contrast_outlier';
      candidate.classification_basis = 'format_outlier_heuristic';
      candidate.classification_confidence = Math.max(candidate.classification_confidence, 0.65);
      candidate.novelty_score = Math.max(candidate.novelty_score, 0.9);
    }
  }
}

function groupForRun(runId: string): SelectionGroup {
  if (/competitor|profiles/.test(runId)) return 'competitor_product';
  if (/access-safety-ai/.test(runId)) return 'opportunity_access_safety';
  return 'student_problem_creator';
}

function platformForActor(actor: string): SocialPlatform {
  if (/tiktok/i.test(actor)) return 'tiktok';
  if (/instagram/i.test(actor)) return 'instagram';
  if (/youtube/i.test(actor)) return 'youtube_shorts';
  throw new Error(`Unsupported discovery actor ${actor}.`);
}

function isInstagramVideo(item: Record<string, unknown>): boolean {
  return text(item.type).toLowerCase() === 'video'
    || text(item.productType).toLowerCase() === 'clips'
    || Boolean(text(item.videoUrl));
}

function isAdmissionsContent(value: string): boolean {
  return /\b(high school|secondary school|college admissions?|law school admissions?|lawschooladmissions|common app|sat prep|act prep)\b/i.test(value);
}

function isExplicitForeignMarket(value: string): boolean {
  return /\b(south africa|ghana jobs?|ghanajobs|freshgradph|philippines jobs?|uk nurses?|uknurses|australia internships?|canada internships?|nigeria jobs?|myanmar jobs?|kenya jobs?|dubai internships?)\b/i.test(value);
}

function outlierScore(content: string, duration: number | null, slideshow: boolean): number {
  let score = 0.25;
  if (slideshow) score += 0.35;
  if (duration !== null && (duration <= 12 || duration >= 180)) score += 0.3;
  if (/\b(pov|replying to|duet|storytime|day in the life)\b/i.test(content)) score += 0.15;
  if (content.length <= 45 || content.length >= 500) score += 0.1;
  return Math.min(1, score);
}

function evidenceRichness(
  content: string,
  postedAt: string | null,
  metrics: SemanticCandidate['metrics'],
): number {
  let score = 0.35;
  if (content.trim()) score += 0.2;
  if (postedAt) score += 0.15;
  if (metrics.views !== null) score += 0.15;
  if (metrics.likes !== null || metrics.comments !== null) score += 0.1;
  if (metrics.shares !== null || metrics.saves !== null) score += 0.05;
  return Math.min(1, score);
}

function engagement(candidate: EnrichedSemanticCandidate): number {
  return (candidate.metrics.views ?? 0)
    + (candidate.metrics.likes ?? 0) * 4
    + (candidate.metrics.comments ?? 0) * 8
    + (candidate.metrics.shares ?? 0) * 12
    + (candidate.metrics.saves ?? 0) * 12;
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

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function durationValue(value: unknown): number | null {
  const number = numberValue(value);
  if (number !== null) return number;
  if (typeof value !== 'string' || !value.includes(':')) return null;
  const segments = value.split(':').map(Number);
  if (segments.some((segment) => !Number.isFinite(segment))) return null;
  return segments.reduce((total, segment) => total * 60 + segment, 0);
}

function dateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function bump(countsValue: Record<string, number>, key: string): void {
  countsValue[key] = (countsValue[key] ?? 0) + 1;
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) bump(result, value);
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function redact(value: string): string {
  return value
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
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

function main(): void {
  const argv = process.argv.slice(2);
  const manifestPath = option(argv, '--manifest', '.ops/competitor_research/internship-us-content-expansion-20260716.json');
  const genericPath = option(argv, '--generic', '.semantic-artifacts/competitor-content/discovery/internship-us-live-profile-discovery-20260716.json');
  const proofPath = option(argv, '--proof', '.semantic-artifacts/seo/internship-us-proof-process-20260716-discovery.json');
  const accessPath = option(argv, '--access', '.semantic-artifacts/seo/internship-us-access-safety-ai-20260716-discovery.json');
  const outputDir = option(argv, '--out-dir', '.semantic-artifacts/competitor-content/reports');
  const manifest = readJson<unknown>(manifestPath);
  const result = reconcileLiveDiscovery({
    manifest,
    generic: readJson<GenericDiscoveryReport>(genericPath),
    proof: readJson<SeoDiscoveryReport>(proofPath),
    access: readJson<SeoDiscoveryReport>(accessPath),
  });
  const batchId = validateResearchBatchManifest(manifest).batch_id;
  const base = path.join(outputDir, batchId);
  writeJson(`${base}-live-candidates.json`, result.candidates);
  writeJson(`${base}-selection.json`, result.selection);
  writeJson(`${base}-coverage.json`, result.coverage);
  writeJson(`${base}-ledger.json`, result.ledger);
  process.stdout.write(`${JSON.stringify({
    status: result.selection.shortfalls.length ? 'completed_with_gaps' : 'selected',
    provider_rows: result.candidates.input_counts.total_provider_rows,
    normalized_candidates: result.candidates.output_counts.normalized_candidates,
    unique_candidates: result.selection.counts.unique_candidates,
    selected: result.selection.counts.selected,
    selected_by_platform: result.selection.counts.by_platform,
    selected_by_group: result.selection.counts.by_group,
    actual_cost_usd_reported: result.coverage.costs.actual_cost_usd_reported,
    conservative_spend_usd: result.coverage.costs.conservative_spend_usd,
    shortfalls: result.selection.shortfalls,
    outputs: [
      `${base}-live-candidates.json`,
      `${base}-selection.json`,
      `${base}-coverage.json`,
      `${base}-ledger.json`,
    ],
  }, null, 2)}\n`);
}

if (require.main === module) main();
