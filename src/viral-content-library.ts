import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  normalizePublicPostUrl,
  type SocialPlatform,
} from './semantic-intelligence';
import { atomicWriteJson } from './artifact-integrity';

export type ViralAgeBucket =
  | '0_72_hours'
  | '4_30_days'
  | '31_90_days'
  | '91_365_days'
  | 'older_than_365_days'
  | 'unknown';

export type ViralSignal =
  | 'breakout_candidate'
  | 'evergreen_winner'
  | 'high_performer'
  | 'promising'
  | 'baseline'
  | 'insufficient_data';

export type ViralContentType =
  | 'short_video'
  | 'feed_video'
  | 'carousel_post'
  | 'image_post';

export type ViralComparisonMetric =
  | 'views_and_engagement'
  | 'public_interactions'
  | 'none';

export interface ViralContentObservation {
  captured_at: string;
  source_reports: string[];
  source_runs: string[];
  discovery_modes: string[];
  source_queries: string[];
  cohorts: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  interaction_metrics_observed: string[];
  interaction_metrics_missing: string[];
  interaction_metric_coverage: number;
  public_interactions: number | null;
  post_age_hours: number | null;
  lifetime_views_per_hour: number | null;
  engagement_rate: number | null;
}

export interface ViralContentItem {
  item_id: string;
  platform: SocialPlatform;
  content_type: ViralContentType;
  platform_post_id: string;
  canonical_url: string;
  account_handle: string;
  caption: string;
  hashtags: string[];
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  observation_count: number;
  observations: ViralContentObservation[];
  provenance: {
    source_reports: string[];
    source_runs: string[];
    discovery_modes: string[];
    source_queries: string[];
  };
  performance: {
    age_bucket: ViralAgeBucket;
    latest_views: number | null;
    latest_public_interactions: number | null;
    latest_engagement_rate: number | null;
    lifetime_views_per_hour: number | null;
    observed_view_velocity_per_hour: number | null;
    observed_interaction_velocity_per_hour: number | null;
    observation_window_hours: number | null;
    latest_interaction_metric_coverage: number;
    comparison_metric: ViralComparisonMetric;
    comparison_percentile: number | null;
    comparison_group_size: number;
    signal: ViralSignal;
    confidence: 'low' | 'medium' | 'high';
    evidence_limitations: string[];
  };
}

export interface ViralContentLibrary {
  schema_version: 2;
  generated_at: string;
  scope: {
    purpose: 'public_social_content_pattern_research';
    public_metadata_only: true;
    causal_claims_allowed: false;
    raw_cross_platform_ranking_allowed: false;
  };
  sources: {
    discovery_files: string[];
    sqlite_path: string | null;
    provider_cost_usd_reported: number;
  };
  summary: {
    unique_items: number;
    observations: number;
    repeated_items: number;
    by_platform: Record<string, number>;
    by_content_type: Record<string, number>;
    by_age_bucket: Record<string, number>;
    by_signal: Record<string, number>;
    analysis_queue_items: number;
  };
  analysis_queue: Array<{
    item_id: string;
    canonical_url: string;
    platform: SocialPlatform;
    content_type: ViralContentType;
    signal: ViralSignal;
    comparison_percentile: number | null;
    reason: string;
  }>;
  evidence_boundaries: string[];
  items: ViralContentItem[];
}

interface DiscoveryReport {
  research_id?: string;
  created_at?: string;
  totals?: {
    actual_cost_usd_reported?: number;
  };
  runs?: Array<{
    id?: string;
    actor_id?: string;
    input_mode?: string;
    items?: unknown[];
  }>;
}

interface SqliteObservationRow {
  evidence_id: string;
  platform: SocialPlatform;
  platform_post_id: string;
  canonical_url: string;
  content_type: string;
  caption: string;
  posted_at: string | null;
  collected_at: string;
  account_handle: string;
  request_id: string;
  apify_actor_id: string;
  captured_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

interface CandidateObservation {
  platform: SocialPlatform;
  contentType: ViralContentType;
  platformPostId: string;
  canonicalUrl: string;
  accountHandle: string;
  caption: string;
  hashtags: string[];
  postedAt: string | null;
  capturedAt: string;
  sourceReport: string;
  sourceRun: string;
  discoveryMode: string;
  sourceQuery: string | null;
  cohort: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

interface BuildOptions {
  discoveryFiles?: string[];
  sqlitePath?: string | null;
  now?: () => Date;
}

export interface RecheckConfig {
  research_id: string;
  purpose: 'public_competitor_content_research';
  publishing_in_scope: false;
  max_total_charge_usd: number;
  runs: Array<{
    id: string;
    actor_id: 'apify/instagram-scraper';
    input_mode: 'explicit_url';
    input: {
      directUrls: string[];
      resultsType: 'posts';
      resultsLimit: 1;
      addParentData: true;
    };
    max_charge_usd: number;
    max_items: number;
  }>;
}

export function buildViralContentLibrary(options: BuildOptions = {}): ViralContentLibrary {
  const now = options.now ?? (() => new Date());
  const discoveryFiles = unique((options.discoveryFiles ?? []).map((file) => path.resolve(file))).sort();
  const candidates: CandidateObservation[] = [];
  let providerCost = 0;

  for (const file of discoveryFiles) {
    const report = readJson<DiscoveryReport>(file);
    const sourceReport = report.research_id?.trim() || path.basename(file);
    const capturedAt = isoDate(report.created_at) ?? now().toISOString();
    providerCost += nonNegativeNumber(report.totals?.actual_cost_usd_reported) ?? 0;
    for (const run of report.runs ?? []) {
      const sourceRun = run.id?.trim() || 'unknown-run';
      const discoveryMode = run.input_mode?.trim() || inferDiscoveryMode(sourceRun);
      const cohort = inferCohort(sourceRun);
      for (const raw of run.items ?? []) {
        const normalized = normalizeDiscoveryItem(raw, {
          sourceReport,
          sourceRun,
          discoveryMode,
          cohort,
          capturedAt,
        });
        if (normalized) candidates.push(normalized);
      }
    }
  }

  const sqlitePath = options.sqlitePath ? path.resolve(options.sqlitePath) : null;
  if (sqlitePath && fs.existsSync(sqlitePath)) {
    candidates.push(...readSqliteObservations(sqlitePath));
  }

  const generatedAt = now().toISOString();
  const items = assembleItems(candidates, generatedAt);
  const analysisQueue = items
    .filter((item) => ['breakout_candidate', 'evergreen_winner', 'high_performer'].includes(item.performance.signal))
    .sort((left, right) => (
      signalPriority(left.performance.signal) - signalPriority(right.performance.signal)
      || (right.performance.comparison_percentile ?? -1) - (left.performance.comparison_percentile ?? -1)
      || left.item_id.localeCompare(right.item_id)
    ))
    .slice(0, 100)
    .map((item) => ({
      item_id: item.item_id,
      canonical_url: item.canonical_url,
      platform: item.platform,
      content_type: item.content_type,
      signal: item.performance.signal,
      comparison_percentile: item.performance.comparison_percentile,
      reason: analysisReason(item),
    }));

  return {
    schema_version: 2,
    generated_at: generatedAt,
    scope: {
      purpose: 'public_social_content_pattern_research',
      public_metadata_only: true,
      causal_claims_allowed: false,
      raw_cross_platform_ranking_allowed: false,
    },
    sources: {
      discovery_files: discoveryFiles.map((file) => path.relative(process.cwd(), file) || path.basename(file)),
      sqlite_path: sqlitePath ? path.relative(process.cwd(), sqlitePath) || path.basename(sqlitePath) : null,
      provider_cost_usd_reported: round(providerCost),
    },
    summary: {
      unique_items: items.length,
      observations: items.reduce((sum, item) => sum + item.observation_count, 0),
      repeated_items: items.filter((item) => distinctCaptureCount(item.observations) > 1).length,
      by_platform: counts(items.map((item) => item.platform)),
      by_content_type: counts(items.map((item) => item.content_type)),
      by_age_bucket: counts(items.map((item) => item.performance.age_bucket)),
      by_signal: counts(items.map((item) => item.performance.signal)),
      analysis_queue_items: analysisQueue.length,
    },
    analysis_queue: analysisQueue,
    evidence_boundaries: [
      'A public metric snapshot describes what was visible at capture time; it does not prove why distribution occurred.',
      'Observed velocity requires at least two distinct capture timestamps. Lifetime views divided by post age is retained only as a labeled proxy.',
      'Performance percentiles compare posts only within the same platform, content type, and age bucket; raw cross-platform and cross-format ranking is disabled.',
      'Instagram image and carousel rankings use visible public interactions because a public reach or view denominator is not available for those post types.',
      'Breakout and evergreen labels are research queue signals, not performance guarantees or causal conclusions.',
      'Provider failures, missing dates, and missing metrics are measurement gaps rather than negative evidence.',
    ],
    items,
  };
}

export function buildInstagramRecheckConfig(
  library: ViralContentLibrary,
  options: {
    researchId?: string;
    limit?: number;
    maxChargeUsd?: number;
  } = {},
): RecheckConfig {
  const limit = boundedInteger(options.limit ?? 50, 1, 100, 'limit');
  const maxChargeUsd = positiveMoney(options.maxChargeUsd ?? 2, 'maxChargeUsd');
  if (maxChargeUsd > 10) throw new Error('A single recheck config cannot exceed 10 USD.');
  const urls = library.items
    .filter((item) => (
      item.platform === 'instagram'
      && ['0_72_hours', '4_30_days'].includes(item.performance.age_bucket)
      && hasComparableMetric(item)
    ))
    .sort((left, right) => (
      signalPriority(left.performance.signal) - signalPriority(right.performance.signal)
      || (right.performance.comparison_percentile ?? -1) - (left.performance.comparison_percentile ?? -1)
      || left.item_id.localeCompare(right.item_id)
    ))
    .slice(0, limit)
    .map((item) => item.canonical_url);
  if (!urls.length) throw new Error('No recent Instagram candidates are eligible for a temporal recheck.');
  const researchId = options.researchId?.trim()
    || `viral-library-instagram-recheck-${library.generated_at.slice(0, 10).replaceAll('-', '')}`;
  return {
    research_id: researchId,
    purpose: 'public_competitor_content_research',
    publishing_in_scope: false,
    max_total_charge_usd: maxChargeUsd,
    runs: [{
      id: 'instagram-selected-posts-recheck',
      actor_id: 'apify/instagram-scraper',
      input_mode: 'explicit_url',
      input: {
        directUrls: urls,
        resultsType: 'posts',
        resultsLimit: 1,
        addParentData: true,
      },
      max_charge_usd: maxChargeUsd,
      max_items: urls.length,
    }],
  };
}

function normalizeDiscoveryItem(
  input: unknown,
  context: {
    sourceReport: string;
    sourceRun: string;
    discoveryMode: string;
    cohort: string;
    capturedAt: string;
  },
): CandidateObservation | null {
  const item = recordOrNull(input);
  if (!item || item.error || item.errorCode || item.errorDescription) return null;
  const rawUrl = firstText(item, ['url', 'webVideoUrl', 'postUrl', 'canonicalUrl']);
  if (!rawUrl) return null;
  let normalized: ReturnType<typeof normalizePublicPostUrl>;
  try {
    normalized = normalizePublicPostUrl(rawUrl);
  } catch {
    return null;
  }
  const contentType = inferContentType(item, normalized.platform);
  if (!contentType) return null;
  const caption = firstText(item, ['text', 'caption', 'description', 'title', 'translatedTitle']) ?? '';
  const postedAt = dateValue(firstValue(item, ['createTimeISO', 'publishedAt', 'timestamp', 'takenAt', 'date', 'createTime']));
  const capturedAt = dateValue(firstValue(item, ['scrapedAt', 'collectedAt'])) ?? context.capturedAt;
  const accountHandle = firstText(item, [
    'authorMeta.name',
    'authorMeta.uniqueId',
    'author.username',
    'ownerUsername',
    'channelUsername',
    'channelName',
    'username',
  ]) ?? `unknown-${normalized.platform_post_id}`;
  return {
    platform: normalized.platform,
    contentType,
    platformPostId: normalized.platform_post_id,
    canonicalUrl: normalized.canonical_url,
    accountHandle,
    caption,
    hashtags: extractHashtags(item, caption),
    postedAt,
    capturedAt,
    sourceReport: context.sourceReport,
    sourceRun: context.sourceRun,
    discoveryMode: context.discoveryMode,
    sourceQuery: firstText(item, ['searchQuery', 'search', 'query', 'input', 'inputUrl', 'fromYTUrl']),
    cohort: context.cohort,
    views: firstNumber(item, ['playCount', 'viewCount', 'views', 'videoPlayCount', 'videoViewCount', 'playCountFb']),
    likes: firstNumber(item, ['diggCount', 'likeCount', 'likes', 'likesCount']),
    comments: firstNumber(item, ['commentCount', 'commentsCount']),
    shares: firstNumber(item, ['shareCount', 'shares', 'reshareCount']),
    saves: firstNumber(item, ['collectCount', 'saveCount', 'saves']),
  };
}

function readSqliteObservations(dbPath: string): CandidateObservation[] {
  const sql = `
    SELECT
      p.evidence_id,
      p.platform,
      p.platform_post_id,
      p.canonical_url,
      p.content_type,
      p.caption,
      p.posted_at,
      p.collected_at,
      a.handle AS account_handle,
      p.request_id,
      p.apify_actor_id,
      o.captured_at,
      o.views,
      o.likes,
      o.comments,
      o.shares,
      o.saves
    FROM social_posts p
    JOIN social_accounts a ON a.evidence_id = p.account_id
    JOIN performance_observations o ON o.post_id = p.evidence_id
    ORDER BY p.evidence_id, o.captured_at;
  `;
  const output = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
  if (!output) return [];
  const rows = JSON.parse(output) as SqliteObservationRow[];
  return rows.flatMap((row): CandidateObservation[] => {
    if (!['tiktok', 'instagram', 'youtube_shorts'].includes(row.platform)) return [];
    return [{
      platform: row.platform,
      contentType: storedContentType(row.content_type, row.platform),
      platformPostId: row.platform_post_id,
      canonicalUrl: row.canonical_url,
      accountHandle: row.account_handle,
      caption: row.caption,
      hashtags: [...row.caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => match[1].toLowerCase()),
      postedAt: isoDate(row.posted_at),
      capturedAt: isoDate(row.captured_at) ?? isoDate(row.collected_at) ?? new Date(0).toISOString(),
      sourceReport: `sqlite:${path.basename(dbPath)}`,
      sourceRun: row.request_id,
      discoveryMode: row.apify_actor_id ? 'approved_url_ingestion' : 'sqlite',
      sourceQuery: null,
      cohort: 'stored',
      views: nonNegativeNumber(row.views),
      likes: nonNegativeNumber(row.likes),
      comments: nonNegativeNumber(row.comments),
      shares: nonNegativeNumber(row.shares),
      saves: nonNegativeNumber(row.saves),
    }];
  });
}

function assembleItems(candidates: CandidateObservation[], generatedAt: string): ViralContentItem[] {
  const grouped = new Map<string, CandidateObservation[]>();
  for (const candidate of candidates) {
    const itemId = `${candidate.platform}:post:${candidate.platformPostId}`;
    const rows = grouped.get(itemId) ?? [];
    rows.push(candidate);
    grouped.set(itemId, rows);
  }

  const items = [...grouped.entries()].map(([itemId, rows]): ViralContentItem => {
    const ordered = [...rows].sort((left, right) => (
      Date.parse(left.capturedAt) - Date.parse(right.capturedAt)
      || left.sourceRun.localeCompare(right.sourceRun)
    ));
    const latestMetadata = [...ordered].reverse().find((row) => row.caption || row.accountHandle) ?? ordered.at(-1)!;
    const postedAt = ordered.map((row) => row.postedAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
    const observations = mergeObservations(ordered, postedAt);
    return {
      item_id: itemId,
      platform: latestMetadata.platform,
      content_type: latestMetadata.contentType,
      platform_post_id: latestMetadata.platformPostId,
      canonical_url: latestMetadata.canonicalUrl,
      account_handle: latestMetadata.accountHandle,
      caption: ordered.map((row) => row.caption).sort((left, right) => right.length - left.length)[0] ?? '',
      hashtags: unique(ordered.flatMap((row) => row.hashtags)).sort(),
      posted_at: postedAt,
      first_seen_at: observations[0].captured_at,
      last_seen_at: observations.at(-1)!.captured_at,
      observation_count: observations.length,
      observations,
      provenance: {
        source_reports: unique(ordered.map((row) => row.sourceReport)).sort(),
        source_runs: unique(ordered.map((row) => row.sourceRun)).sort(),
        discovery_modes: unique(ordered.map((row) => row.discoveryMode)).sort(),
        source_queries: unique(ordered.map((row) => row.sourceQuery).filter((value): value is string => Boolean(value))).sort(),
      },
      performance: {
        age_bucket: ageBucket(postedAt, observations.at(-1)!.captured_at),
        latest_views: observations.at(-1)!.views,
        latest_public_interactions: observations.at(-1)!.public_interactions,
        latest_engagement_rate: observations.at(-1)!.engagement_rate,
        lifetime_views_per_hour: observations.at(-1)!.lifetime_views_per_hour,
        observed_view_velocity_per_hour: observedVelocity(observations),
        observed_interaction_velocity_per_hour: observedInteractionVelocity(observations),
        observation_window_hours: observationWindowHours(observations),
        latest_interaction_metric_coverage: observations.at(-1)!.interaction_metric_coverage,
        comparison_metric: 'none',
        comparison_percentile: null,
        comparison_group_size: 0,
        signal: 'insufficient_data',
        confidence: 'low',
        evidence_limitations: [],
      },
    };
  });

  applyComparativeSignals(items, generatedAt);
  return items.sort((left, right) => (
    left.platform.localeCompare(right.platform)
    || Date.parse(right.last_seen_at) - Date.parse(left.last_seen_at)
    || left.item_id.localeCompare(right.item_id)
  ));
}

function mergeObservations(rows: CandidateObservation[], postedAt: string | null): ViralContentObservation[] {
  const merged = new Map<string, ViralContentObservation>();
  for (const row of rows) {
    const key = [
      row.capturedAt,
      row.views ?? '',
      row.likes ?? '',
      row.comments ?? '',
      row.shares ?? '',
      row.saves ?? '',
    ].join('|');
    const current = merged.get(key);
    if (current) {
      current.source_reports = unique([...current.source_reports, row.sourceReport]).sort();
      current.source_runs = unique([...current.source_runs, row.sourceRun]).sort();
      current.discovery_modes = unique([...current.discovery_modes, row.discoveryMode]).sort();
      if (row.sourceQuery) current.source_queries = unique([...current.source_queries, row.sourceQuery]).sort();
      current.cohorts = unique([...current.cohorts, row.cohort]).sort();
      continue;
    }
    const postAgeHours = hoursBetween(postedAt, row.capturedAt);
    const interactionCompleteness = interactionMetricCompleteness(row);
    merged.set(key, {
      captured_at: row.capturedAt,
      source_reports: [row.sourceReport],
      source_runs: [row.sourceRun],
      discovery_modes: [row.discoveryMode],
      source_queries: row.sourceQuery ? [row.sourceQuery] : [],
      cohorts: [row.cohort],
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      saves: row.saves,
      interaction_metrics_observed: interactionCompleteness.observed,
      interaction_metrics_missing: interactionCompleteness.missing,
      interaction_metric_coverage: interactionCompleteness.coverage,
      public_interactions: publicInteractions(row),
      post_age_hours: postAgeHours,
      lifetime_views_per_hour: row.views !== null && postAgeHours !== null && postAgeHours > 0
        ? round(row.views / postAgeHours)
        : null,
      engagement_rate: engagementRate(row),
    });
  }
  return [...merged.values()].sort((left, right) => (
    Date.parse(left.captured_at) - Date.parse(right.captured_at)
    || metricKey(left).localeCompare(metricKey(right))
  ));
}

function applyComparativeSignals(items: ViralContentItem[], generatedAt: string): void {
  const groups = new Map<string, ViralContentItem[]>();
  for (const item of items) {
    const key = `${item.platform}:${item.content_type}:${item.performance.age_bucket}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const observed = group
      .filter((item) => comparisonMetricValue(item) !== null)
      .sort((left, right) => (
        performanceScore(left) - performanceScore(right)
        || left.item_id.localeCompare(right.item_id)
      ));
    const ranks = new Map(observed.map((item, index) => [item.item_id, index]));
    for (const item of group) {
      const rank = ranks.get(item.item_id);
      const percentile = rank === undefined
        ? null
        : observed.length === 1 ? 0.5 : round(rank / (observed.length - 1));
      const distinctCaptures = distinctCaptureCount(item.observations);
      const observationWindow = item.performance.observation_window_hours;
      item.performance.comparison_percentile = percentile;
      item.performance.comparison_group_size = observed.length;
      item.performance.comparison_metric = comparisonMetric(item);
      item.performance.signal = viralSignal(item.performance.age_bucket, percentile, observed.length);
      item.performance.confidence = distinctCaptures >= 2
        && observationWindow !== null
        && observationWindow >= 24
        && observed.length >= 20
        ? 'high'
        : observed.length >= 10 && (
          (distinctCaptures >= 2 && observationWindow !== null && observationWindow >= 1)
          || Boolean(item.posted_at)
        ) ? 'medium' : 'low';
      item.performance.evidence_limitations = unique([
        'Observational ranking does not identify a causal content mechanism.',
        ...(distinctCaptures < 2
          ? ['Only one distinct capture timestamp is available; observed velocity is unknown.']
          : []),
        ...(item.performance.latest_views !== null && item.performance.observed_view_velocity_per_hour === null
          ? ['Lifetime views per hour is a proxy, not an observed growth trajectory.']
          : []),
        ...(item.performance.latest_views === null
          ? ['This post type has no public view denominator; comparison uses visible likes, comments, shares, and saves only.']
          : []),
        ...(item.performance.latest_views === null && item.performance.observed_interaction_velocity_per_hour === null
          ? ['Only a public interaction snapshot is available; interaction growth is not observed.']
          : []),
        ...(item.performance.latest_interaction_metric_coverage < 1
          ? [`Engagement is unavailable because the latest snapshot is missing ${item.observations.at(-1)!.interaction_metrics_missing.join(', ')}; missing interactions are not treated as zero.`]
          : []),
        ...(distinctCaptures >= 2 && observationWindow !== null && observationWindow < 1
          ? [`Repeated captures span only ${observationWindow} hours; velocity remains low-confidence until a longer observation window is available.`]
          : []),
        ...(!item.posted_at ? ['Publication time is missing; temporal classification is incomplete.'] : []),
        ...(observed.length < 10
          ? [`The within-platform/content-type/age comparison group has only ${observed.length} observed items.`]
          : []),
        ...(Date.parse(item.last_seen_at) > Date.parse(generatedAt)
          ? ['The latest source capture is later than the library generation timestamp.']
          : []),
      ]);
    }
  }
}

function viralSignal(
  bucket: ViralAgeBucket,
  percentile: number | null,
  groupSize: number,
): ViralSignal {
  if (percentile === null || groupSize < 5) return 'insufficient_data';
  if (percentile >= 0.9 && ['0_72_hours', '4_30_days'].includes(bucket)) return 'breakout_candidate';
  if (percentile >= 0.9 && bucket === 'older_than_365_days') return 'evergreen_winner';
  if (percentile >= 0.9) return 'high_performer';
  if (percentile >= 0.75) return 'promising';
  return 'baseline';
}

function observedVelocity(observations: ViralContentObservation[]): number | null {
  const byCapture = observations
    .filter((observation): observation is ViralContentObservation & { views: number } => observation.views !== null)
    .sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at));
  const first = byCapture[0];
  const last = byCapture.at(-1);
  if (!first || !last || first.captured_at === last.captured_at) return null;
  const elapsedHours = (Date.parse(last.captured_at) - Date.parse(first.captured_at)) / 3_600_000;
  const delta = last.views - first.views;
  return elapsedHours > 0 && delta >= 0 ? round(delta / elapsedHours) : null;
}

function performanceScore(item: ViralContentItem): number {
  if (item.performance.latest_views !== null) {
    const engagement = item.performance.latest_engagement_rate ?? 0;
    return Math.log1p(item.performance.latest_views) + Math.min(1, engagement);
  }
  return Math.log1p(item.performance.latest_public_interactions ?? 0);
}

function comparisonMetric(item: ViralContentItem): ViralComparisonMetric {
  if (item.performance.latest_views !== null) return 'views_and_engagement';
  if (item.performance.latest_public_interactions !== null) return 'public_interactions';
  return 'none';
}

function comparisonMetricValue(item: ViralContentItem): number | null {
  if (item.performance.latest_views !== null) return item.performance.latest_views;
  return item.performance.latest_public_interactions;
}

function hasComparableMetric(item: ViralContentItem): boolean {
  return comparisonMetricValue(item) !== null;
}

function publicInteractions(row: {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}): number | null {
  const values = [row.likes, row.comments, row.shares, row.saves];
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function interactionMetricCompleteness(row: {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}): { observed: string[]; missing: string[]; coverage: number } {
  const values = {
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
  };
  const observed = Object.entries(values).flatMap(([metric, value]) => value === null ? [] : [metric]);
  const missing = Object.entries(values).flatMap(([metric, value]) => value === null ? [metric] : []);
  return { observed, missing, coverage: round(observed.length / Object.keys(values).length) };
}

function observedInteractionVelocity(observations: ViralContentObservation[]): number | null {
  const byCapture = observations
    .filter((observation): observation is ViralContentObservation & { public_interactions: number } => (
      observation.public_interactions !== null
    ))
    .sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at));
  const first = byCapture[0];
  const last = byCapture.at(-1);
  if (!first || !last || first.captured_at === last.captured_at) return null;
  const elapsedHours = (Date.parse(last.captured_at) - Date.parse(first.captured_at)) / 3_600_000;
  const delta = last.public_interactions - first.public_interactions;
  return elapsedHours > 0 && delta >= 0 ? round(delta / elapsedHours) : null;
}

function engagementRate(row: {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}): number | null {
  if (row.views === null || row.views <= 0) return null;
  if ([row.likes, row.comments, row.shares, row.saves].some((value) => value === null)) return null;
  return round(
    ((row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0) + (row.saves ?? 0))
      / row.views,
  );
}

function observationWindowHours(observations: ViralContentObservation[]): number | null {
  const captures = unique(observations.map((observation) => observation.captured_at)).sort();
  if (captures.length < 2) return null;
  return round((Date.parse(captures.at(-1)!) - Date.parse(captures[0])) / 3_600_000);
}

function ageBucket(postedAt: string | null, capturedAt: string): ViralAgeBucket {
  const ageHours = hoursBetween(postedAt, capturedAt);
  if (ageHours === null) return 'unknown';
  if (ageHours <= 72) return '0_72_hours';
  if (ageHours <= 24 * 30) return '4_30_days';
  if (ageHours <= 24 * 90) return '31_90_days';
  if (ageHours <= 24 * 365) return '91_365_days';
  return 'older_than_365_days';
}

function hoursBetween(start: string | null, end: string): number | null {
  if (!start) return null;
  const milliseconds = Date.parse(end) - Date.parse(start);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? round(milliseconds / 3_600_000) : null;
}

function inferContentType(
  item: Record<string, unknown>,
  platform: SocialPlatform,
): ViralContentType | null {
  if (platform !== 'instagram') return 'short_video';
  const type = (firstText(item, ['type']) ?? '').toLowerCase();
  const productType = (firstText(item, ['productType']) ?? '').toLowerCase();
  if (type === 'sidecar' || productType === 'carousel_container') return 'carousel_post';
  if (type === 'image') return 'image_post';
  const isVideo = type === 'video'
    || productType === 'clips'
    || Boolean(firstText(item, ['videoUrl', 'videoPlayUrl']))
    || firstNumber(item, ['videoViewCount', 'videoPlayCount']) !== null;
  if (isVideo) return productType === 'clips' ? 'short_video' : 'feed_video';
  if (productType === 'feed') return 'image_post';
  return null;
}

function storedContentType(value: string, platform: SocialPlatform): ViralContentType {
  if (platform !== 'instagram') return 'short_video';
  const normalized = value.trim().toLowerCase();
  if (['image', 'image_post', 'photo'].includes(normalized)) return 'image_post';
  if (['carousel', 'carousel_post', 'sidecar', 'carousel_container'].includes(normalized)) return 'carousel_post';
  if (['feed_video', 'video_post'].includes(normalized)) return 'feed_video';
  return 'short_video';
}

function analysisReason(item: ViralContentItem): string {
  const timing = ['0_72_hours', '4_30_days'].includes(item.performance.age_bucket) ? 'Recent' : 'Older';
  if (item.content_type === 'carousel_post') {
    return `${timing} within-platform/content-type/age-cohort outlier; inspect cover framing, slide order, proof density, caption, and CTA.`;
  }
  if (item.content_type === 'image_post') {
    return `${timing} within-platform/content-type/age-cohort outlier; inspect visual framing, caption structure, proof, and CTA.`;
  }
  if (item.performance.signal === 'evergreen_winner') {
    return 'Older within-platform/content-type/age-cohort outlier; prioritize durable topic and format analysis.';
  }
  return 'Recent within-platform/content-type/age-cohort outlier; prioritize hook, pacing, proof, and audience-state analysis.';
}

function extractHashtags(item: Record<string, unknown>, caption: string): string[] {
  const values = firstValue(item, ['hashtags', 'tags']);
  const structured = Array.isArray(values)
    ? values.flatMap((value) => {
      if (typeof value === 'string') return [value];
      const recordValue = recordOrNull(value);
      return recordValue ? [firstText(recordValue, ['name', 'title', 'hashtag']) ?? ''] : [];
    })
    : [];
  return unique([
    ...structured,
    ...[...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => match[1]),
  ].map((value) => value.replace(/^#/, '').trim().toLowerCase()).filter(Boolean));
}

function inferCohort(runId: string): string {
  const normalized = runId.toLowerCase();
  if (normalized.includes('recent') && normalized.includes('popular')) return 'mixed';
  if (normalized.includes('popular')) return 'popular';
  if (normalized.includes('recent') || normalized.includes('latest')) return 'recent';
  return 'unknown';
}

function inferDiscoveryMode(runId: string): string {
  if (/hashtag/i.test(runId)) return 'hashtag';
  if (/search/i.test(runId)) return 'search';
  if (/profile/i.test(runId)) return 'profile';
  return 'unknown';
}

function signalPriority(signal: ViralSignal): number {
  return {
    breakout_candidate: 0,
    evergreen_winner: 1,
    high_performer: 2,
    promising: 3,
    baseline: 4,
    insufficient_data: 5,
  }[signal];
}

function distinctCaptureCount(observations: ViralContentObservation[]): number {
  return new Set(observations.map((observation) => observation.captured_at)).size;
}

function metricKey(observation: ViralContentObservation): string {
  return [
    observation.views ?? '',
    observation.likes ?? '',
    observation.comments ?? '',
    observation.shares ?? '',
    observation.saves ?? '',
  ].join('|');
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

function firstText(value: Record<string, unknown>, paths: string[]): string | null {
  const found = firstValue(value, paths);
  return typeof found === 'string' && found.trim() ? found.trim() : null;
}

function firstNumber(value: Record<string, unknown>, paths: string[]): number | null {
  return nonNegativeNumber(firstValue(value, paths));
}

function nonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replaceAll(',', ''));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function dateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
    return new Date(milliseconds).toISOString();
  }
  return isoDate(value);
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, value: unknown): void {
  atomicWriteJson(path.resolve(filePath), value);
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function positiveMoney(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive.`);
  return round(value);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function stringOption(argv: string[], name: string, fallback?: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function numberOption(argv: string[], name: string, fallback: number): number {
  const value = stringOption(argv, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function discoveryFilesFromArgs(argv: string[]): string[] {
  const explicit: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--discovery') continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--discovery requires a value.');
    explicit.push(value);
    index += 1;
  }
  const directory = stringOption(
    argv,
    '--discovery-dir',
    '.semantic-artifacts/competitor-content/discovery',
  );
  const discovered = directory && fs.existsSync(directory)
    ? fs.readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.join(directory, file))
    : [];
  return unique([...explicit, ...discovered]).sort();
}

function printHelp(): void {
  process.stdout.write(`Viral-Bench viral content library

Commands:
  build [--discovery-dir <dir>] [--discovery <file>] [--db <sqlite>] [--out <json>]
  recheck-plan --library <json> [--out <json>] [--limit 50] [--max-charge-usd 2]

The build command makes no external calls. Recheck plans are public-metadata-only
Apify configs and still require the existing credential, gate, and budget checks
before execution.
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'help';
  if (command === 'build') {
    const library = buildViralContentLibrary({
      discoveryFiles: discoveryFilesFromArgs(argv.slice(1)),
      sqlitePath: stringOption(
        argv,
        '--db',
        '.semantic-artifacts/competitor-content/semantic_corpus.sqlite',
      ),
    });
    const output = stringOption(
      argv,
      '--out',
      '.semantic-artifacts/viral-library/content-library.json',
    )!;
    writeJson(output, library);
    process.stdout.write(`${JSON.stringify({
      output_path: output,
      ...library.summary,
      provider_cost_usd_reported: library.sources.provider_cost_usd_reported,
      external_calls_made: 0,
    }, null, 2)}\n`);
    return;
  }
  if (command === 'recheck-plan') {
    const libraryPath = stringOption(argv, '--library');
    if (!libraryPath) throw new Error('recheck-plan requires --library.');
    const output = stringOption(
      argv,
      '--out',
      '.ops/competitor_research/viral-content-library-recheck.json',
    )!;
    const config = buildInstagramRecheckConfig(readJson<ViralContentLibrary>(libraryPath), {
      limit: numberOption(argv, '--limit', 50),
      maxChargeUsd: numberOption(argv, '--max-charge-usd', 2),
    });
    writeJson(output, config);
    process.stdout.write(`${JSON.stringify({
      output_path: output,
      urls: config.runs[0].input.directUrls.length,
      max_charge_usd: config.max_total_charge_usd,
      external_calls_made: 0,
    }, null, 2)}\n`);
    return;
  }
  printHelp();
}

if (require.main === module) main();
