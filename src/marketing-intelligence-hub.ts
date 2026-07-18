import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  atomicWriteJson,
  describeArtifact,
  type ArtifactDescriptor,
} from './artifact-integrity';

const VERIFIED_SOURCE_STATUSES = new Set(['observed', 'sample_observed']);
const RESOLVED_SOURCE_STATUSES = new Set([
  ...VERIFIED_SOURCE_STATUSES,
  'access_limited_rate_limited',
  'measurement_gap_rate_limited',
  'connection_required',
]);
const HIGH_SIGNAL_STATUSES = new Set([
  'breakout_candidate',
  'evergreen_winner',
  'high_performer',
  'promising',
]);
const PLATFORM_ALIASES: Record<string, string> = {
  instagram: 'instagram',
  tiktok: 'tiktok',
  youtube: 'youtube_shorts',
  youtube_shorts: 'youtube_shorts',
};

export type HubSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface HubQualityIssue {
  severity: HubSeverity;
  code: string;
  message: string;
  next_action: string;
}

export interface MarketingIntelligenceHub {
  schema_version: 'viralbench_marketing_intelligence_hub_v1';
  generated_at: string;
  status: 'ready' | 'partial' | 'blocked';
  audience: 'marketing_team';
  scope: {
    public_competitor_intelligence: true;
    owned_marketing_performance: true;
    evidence_domains_separated: true;
  };
  headline: {
    verified_source_coverage: number | null;
    priority_competitor_content_coverage: number | null;
    temporal_measurement_coverage: number | null;
    deep_analysis_queue_coverage: number | null;
    owned_performance_connection_state: 'not_connected' | 'partial' | 'connected';
  };
  inventory: {
    sources: {
      total: number;
      verified: number;
      state_resolved: number;
      state_resolution_coverage: number | null;
      access_limited: number;
      connection_required: number;
      verification_overrides_applied: number;
      by_status: Record<string, number>;
      by_category: Record<string, number>;
      pending: Array<{
        rank: number | null;
        source_id: string;
        name: string;
        category: string;
        status: string;
        url: string | null;
        verification_checked_at: string | null;
        verification_method: string | null;
        verification_evidence_url: string | null;
        verification_summary: string | null;
        http_status: number | null;
      }>;
    };
    competitors: {
      total: number;
      priority_total: number;
      with_known_socials: number;
      with_observed_content: number;
      priority_with_observed_content: number;
      rows: CompetitorCoverageRow[];
    };
    content: {
      schema_version: number | string | null;
      unique_items: number;
      observations: number;
      repeated_items: number;
      observed_velocity_items: number;
      distinct_accounts: number;
      recent_items_30d: number;
      publication_time_coverage: number | null;
      by_platform: Record<string, number>;
      by_content_type: Record<string, number>;
      by_signal: Record<string, number>;
      top_account_share: number | null;
      top_accounts: Array<{ account_handle: string; posts: number; share: number }>;
    };
    analysis: {
      queue_items: number;
      matched_queue_items: number;
      generated_video_reports: number;
      reports_reconciled_to_library: number;
      scheduled_analysis_records: number;
      scheduled_analyses_reconciled_to_library: number;
      priority_competitors_with_content: number;
      priority_competitors_with_deep_analysis: number;
      priority_competitor_analysis_coverage: number | null;
      semantic_video_analyses: number | null;
      latest_refresh_status: string | null;
      latest_refresh_analysis_coverage: number | null;
    };
    owned_performance: {
      connection_state: 'not_connected' | 'partial' | 'connected';
      post_count: number;
      metric_observations: number;
      event_aggregates: number;
      quality_issues: number;
    };
  };
  queues: {
    priority_competitor_gaps: CompetitorCoverageRow[];
    priority_competitor_analysis_gaps: CompetitorCoverageRow[];
    priority_competitor_analysis_queue: CompetitorAnalysisQueueRow[];
    source_gaps: MarketingIntelligenceHub['inventory']['sources']['pending'];
    viral_analysis: ViralQueueRow[];
  };
  freshness: Array<{
    source_id: string;
    path: string;
    generated_at: string | null;
    age_hours: number | null;
    state: 'current' | 'stale' | 'missing';
  }>;
  quality: {
    issues: HubQualityIssue[];
  };
  evidence_boundaries: string[];
}

export interface CompetitorCoverageRow {
  name: string;
  category: string;
  status: string;
  priority: number | null;
  official_url: string | null;
  known_social_platforms: number;
  observed_platforms: number;
  observed_posts: number;
  deep_analyzed_posts: number;
  latest_observed_at: string | null;
  coverage_state: 'observed' | 'known_socials_unobserved' | 'social_discovery_gap';
  analysis_state: 'analyzed' | 'not_analyzed';
}

export interface ViralQueueRow {
  item_id: string;
  platform: string;
  content_type: string;
  account_handle: string;
  canonical_url: string;
  signal: string;
  comparison_percentile: number | null;
  observed_velocity_per_hour: number | null;
  confidence: string;
  analyzed: boolean;
}

export interface CompetitorAnalysisQueueRow {
  competitor: string;
  category: string;
  priority: number | null;
  item_id: string;
  platform: string;
  content_type: string;
  account_handle: string;
  canonical_url: string;
  signal: string;
  comparison_percentile: number | null;
  observed_velocity_per_hour: number | null;
  confidence: string;
  latest_observed_at: string | null;
  selection_reason: string;
}

export interface MarketingAnalysisIntakePlan {
  schema_version: 'viralbench_marketing_analysis_intake_plan_v1';
  generated_at: string;
  execution_state: 'draft_not_authorized';
  candidate_count: number;
  batch_count: number;
  batches: Array<{
    request_id: string;
    urls: string[];
    allowed_platforms: string[];
    comment_policy: {
      enabled: false;
      max_high_engagement: 0;
      max_recent: 0;
      max_replies_per_thread: 0;
    };
    approval_state: 'draft';
    cost_limits: {
      max_total_usd: 4.5;
      max_apify_usd: 0.5;
      max_twelvelabs_usd: 4;
      max_gemini_usd: 0;
    };
    selection: CompetitorAnalysisQueueRow[];
  }>;
  stop_conditions: string[];
}

export interface MarketingIntelligenceInputs {
  source_registry: unknown;
  source_verification: unknown;
  core_competitors: unknown;
  competitor_universe: unknown;
  content_library: unknown;
  owned_dashboard: unknown;
  video_reports?: unknown;
  pipeline_refresh?: unknown;
  semantic_counts?: {
    social_posts?: number;
    social_accounts?: number;
    performance_observations?: number;
    video_analyses?: number;
    social_comments?: number;
    semantic_items?: number;
  };
  source_paths?: Partial<Record<HubSourceId, string>>;
  generated_at?: string;
}

type HubSourceId =
  | 'source_registry'
  | 'source_verification'
  | 'core_competitors'
  | 'competitor_universe'
  | 'content_library'
  | 'owned_dashboard'
  | 'video_reports'
  | 'pipeline_refresh'
  | 'semantic_database';

interface ArtifactPayload {
  surface: 'dashboard';
  manifest: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
}

const DEFAULT_SOURCE_PATHS: Record<HubSourceId, string> = {
  source_registry: '.ops/competitor_research/internship-us-public-source-registry-20260716.json',
  source_verification: '.ops/competitor_research/internship-source-verification-20260717.json',
  core_competitors: '.ops/competitor_research/internship-core-competitors-v1.json',
  competitor_universe: '.semantic-artifacts/competitor-content/discovery/internship-competitor-universe-20260716.json',
  content_library: 'internship-reels-site/library.json',
  owned_dashboard: '.semantic-artifacts/marketing-dashboard/owned-marketing-dashboard.json',
  video_reports: 'internship-reels-site/data/video-ai-reports.json',
  pipeline_refresh: 'internship-reels-site/data/pipeline-refresh.json',
  semantic_database: '.semantic-artifacts/competitor-content/semantic_corpus.sqlite',
};

export function buildMarketingIntelligenceHub(
  input: MarketingIntelligenceInputs,
): MarketingIntelligenceHub {
  const generatedAt = isoDate(input.generated_at) ?? new Date().toISOString();
  const sourcePaths = { ...DEFAULT_SOURCE_PATHS, ...(input.source_paths ?? {}) };
  const sourceRegistry = object(input.source_registry, 'source registry');
  const sourceVerification = object(input.source_verification, 'source verification overlay');
  const coreCompetitors = object(input.core_competitors, 'core competitor registry');
  const competitorUniverse = object(input.competitor_universe, 'competitor universe');
  const contentLibrary = object(input.content_library, 'content library');
  const ownedDashboard = object(input.owned_dashboard, 'owned dashboard');
  const verificationBySourceId = new Map<string, Record<string, unknown>>();
  for (const [index, entry] of array(sourceVerification.verifications, 'source verifications').entries()) {
    const verification = object(entry, `source verification ${index}`);
    const sourceId = text(verification.source_id);
    if (!sourceId) throw new Error(`source verification ${index} is missing source_id`);
    if (verificationBySourceId.has(sourceId)) {
      throw new Error(`Duplicate source verification for ${sourceId}`);
    }
    verificationBySourceId.set(sourceId, verification);
  }
  const sourceRows = array(sourceRegistry.sources, 'source registry sources').map((entry, index) => {
    const row = object(entry, `source registry source ${index}`);
    const sourceId = text(row.source_id) || `source-${index + 1}`;
    const verification = verificationBySourceId.get(sourceId);
    return {
      rank: nullableInteger(row.rank),
      source_id: sourceId,
      name: text(row.name) || text(row.source_id) || `Source ${index + 1}`,
      category: text(row.category) || 'uncategorized',
      status: text(verification?.status) || text(row.status) || 'unknown',
      url: nullableText(row.url),
      verification_checked_at: isoDate(verification?.checked_at),
      verification_method: nullableText(verification?.verification_method),
      verification_evidence_url: nullableText(verification?.evidence_url),
      verification_summary: nullableText(verification?.evidence_summary),
      http_status: nullableInteger(verification?.http_status),
    };
  });
  const sourceIds = new Set(sourceRows.map((row) => row.source_id));
  const unmatchedVerificationIds = [...verificationBySourceId.keys()]
    .filter((sourceId) => !sourceIds.has(sourceId))
    .sort();
  const verificationOverridesApplied = sourceRows
    .filter((row) => row.verification_checked_at !== null)
    .length;
  const verifiedSources = sourceRows.filter((row) => VERIFIED_SOURCE_STATUSES.has(row.status));
  const resolvedSources = sourceRows.filter((row) => RESOLVED_SOURCE_STATUSES.has(row.status));
  const pendingSources = sourceRows
    .filter((row) => !VERIFIED_SOURCE_STATUSES.has(row.status))
    .sort((left, right) => (
      (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name)
    ));

  const contentItems = array(contentLibrary.items, 'content library items').map((entry, index) => (
    normalizeContentItem(entry, index)
  ));

  const reportsRecord = recordOrEmpty(recordOrEmpty(input.video_reports).reports);
  const reports = Object.values(reportsRecord).map((entry) => recordOrEmpty(entry));
  const refresh = recordOrEmpty(input.pipeline_refresh);
  const scheduledAnalyses = arrayOrEmpty(refresh.analyses).map((entry) => recordOrEmpty(entry));
  const analyzedPostIds = new Set<string>();
  let reconciledReportCount = 0;
  let reconciledScheduledAnalysisCount = 0;
  const libraryPostIds = contentItems
    .map((item) => item.platform_post_id)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const report of reports) {
    const candidateId = text(report.candidate_id);
    for (const postId of libraryPostIds) {
      if (candidateId.includes(postId)) {
        analyzedPostIds.add(postId);
        reconciledReportCount += 1;
        break;
      }
    }
  }
  for (const analysis of scheduledAnalyses) {
    const platform = text(analysis.platform);
    const platformPostId = text(analysis.platform_post_id);
    const canonicalUrl = text(analysis.canonical_url);
    const matched = contentItems.find((item) => (
      platformPostId
      && item.platform_post_id === platformPostId
      && (!platform || item.platform === platform)
    )) ?? contentItems.find((item) => canonicalUrl && item.canonical_url === canonicalUrl);
    if (!matched) continue;
    analyzedPostIds.add(matched.platform_post_id);
    reconciledScheduledAnalysisCount += 1;
  }

  const accountsByPlatform = new Map<string, {
    count: number;
    latest: string | null;
    deep_analyzed_posts: number;
  }>();
  const accounts = new Map<string, number>();
  for (const item of contentItems) {
    const account = normalizeHandle(item.account_handle);
    if (account) accounts.set(account, (accounts.get(account) ?? 0) + 1);
    if (!account || !item.platform) continue;
    const key = `${item.platform}:${account}`;
    const current = accountsByPlatform.get(key) ?? { count: 0, latest: null, deep_analyzed_posts: 0 };
    current.count += 1;
    current.latest = latestIso(current.latest, item.last_seen_at ?? item.posted_at);
    if (analyzedPostIds.has(item.platform_post_id)) current.deep_analyzed_posts += 1;
    accountsByPlatform.set(key, current);
  }

  const competitorEntries = mergeCompetitorEntries(
    array(coreCompetitors.competitors, 'core competitors'),
    array(competitorUniverse.competitors, 'expanded competitors'),
  ).filter((entry) => !isExcludedCompetitor(entry));
  const competitors = competitorEntries.map((entry, index) => (
    normalizeCompetitor(entry, index, accountsByPlatform)
  ));
  const priorityCompetitors = competitors.filter((row) => row.priority !== null && row.priority <= 2);
  const priorityObserved = priorityCompetitors.filter((row) => row.observed_posts > 0);
  const priorityAnalyzed = priorityObserved.filter((row) => row.deep_analyzed_posts > 0);

  const rawAnalysisQueue = arrayOrEmpty(contentLibrary.analysis_queue);
  const queueRows = rawAnalysisQueue.map((entry, index) => {
    const row = object(entry, `analysis queue ${index}`);
    const itemId = text(row.item_id);
    const platformPostId = itemId.split(':').at(-1) ?? '';
    const content = contentItems.find((item) => item.item_id === itemId)
      ?? contentItems.find((item) => item.platform_post_id === platformPostId);
    return viralQueueRow(content ?? normalizeContentItem(row, index), analyzedPostIds);
  });
  const matchedQueueItems = queueRows.filter((row) => row.analyzed).length;

  const summary = recordOrEmpty(contentLibrary.summary);
  const repeatedItems = integerOr(summary.repeated_items, contentItems.filter((item) => item.observation_count >= 2).length);
  const observedVelocityItems = contentItems.filter((item) => (
    item.observed_velocity_per_hour !== null
  )).length;
  const recentItems30d = contentItems.filter((item) => (
    ['0_72_hours', '4_30_days'].includes(item.age_bucket)
  )).length;
  const publishedItems = contentItems.filter((item) => item.posted_at !== null).length;
  const platformCounts = countBy(contentItems, (item) => item.platform || 'unknown');
  const contentTypeCounts = countBy(contentItems, (item) => item.content_type || 'unknown');
  const signalCounts = countBy(contentItems, (item) => item.signal || 'unknown');
  const topAccounts = [...accounts.entries()]
    .map(([account_handle, posts]) => ({
      account_handle,
      posts,
      share: rate(posts, contentItems.length) ?? 0,
    }))
    .sort((left, right) => right.posts - left.posts || left.account_handle.localeCompare(right.account_handle))
    .slice(0, 10);

  const ownedConnection = ownedConnectionState(ownedDashboard.connection_state);
  const ownedDimensions = recordOrEmpty(ownedDashboard.dimensions);
  const ownedFacts = recordOrEmpty(ownedDashboard.facts);
  const ownedQuality = recordOrEmpty(ownedDashboard.quality);
  const refreshProviders = recordOrEmpty(refresh.providers);
  const refreshTwelveLabs = recordOrEmpty(refreshProviders.twelvelabs);

  const headline = {
    verified_source_coverage: rate(verifiedSources.length, sourceRows.length),
    priority_competitor_content_coverage: rate(priorityObserved.length, priorityCompetitors.length),
    temporal_measurement_coverage: rate(repeatedItems, contentItems.length),
    deep_analysis_queue_coverage: rate(matchedQueueItems, queueRows.length),
    owned_performance_connection_state: ownedConnection,
  } satisfies MarketingIntelligenceHub['headline'];

  const issues: HubQualityIssue[] = [];
  if (unmatchedVerificationIds.length > 0) issues.push(issue(
    'high',
    'source_verification_orphans',
    `${unmatchedVerificationIds.length} source-verification records do not match the canonical registry.`,
    `Correct or register these source IDs: ${unmatchedVerificationIds.join(', ')}.`,
  ));
  if (resolvedSources.length < sourceRows.length) issues.push(issue(
    'high',
    'source_state_unresolved',
    `${sourceRows.length - resolvedSources.length} registered sources still have a queued, collectable, or otherwise unresolved state.`,
    'Run a bounded verification pass and record observed, access-limited, connection-required, failed, or retired state with current evidence.',
  ));
  if ((headline.verified_source_coverage ?? 0) < 0.8) issues.push(issue(
    'high',
    'source_verification_below_target',
    `${verifiedSources.length} of ${sourceRows.length} registered sources are verified.`,
    'Review or fetch the highest-ranked pending official sources and record current, stale, failed, or access-limited state.',
  ));
  if ((headline.priority_competitor_content_coverage ?? 0) < 0.8) issues.push(issue(
    'high',
    'priority_competitor_coverage_below_target',
    `${priorityObserved.length} of ${priorityCompetitors.length} priority competitors have reconciled public content.`,
    'Collect the bounded priority gap queue, starting with competitors that already have known social accounts.',
  ));
  if ((headline.temporal_measurement_coverage ?? 0) < 0.5) issues.push(issue(
    'medium',
    'temporal_measurement_below_target',
    `${repeatedItems} of ${contentItems.length} posts have repeated captures.`,
    'Recheck recent, high-signal posts at decision-useful intervals before treating velocity as observed.',
  ));
  if ((headline.deep_analysis_queue_coverage ?? 0) < 0.5) issues.push(issue(
    'high',
    'deep_analysis_queue_below_target',
    `${matchedQueueItems} of ${queueRows.length} queued viral candidates reconcile to generated multimodal reports.`,
    'Analyze a diverse, bounded cohort across platform, content type, topic, and account before generalizing creative patterns.',
  ));
  const priorityCompetitorAnalysisCoverage = rate(priorityAnalyzed.length, priorityObserved.length);
  if ((priorityCompetitorAnalysisCoverage ?? 0) < 0.5) issues.push(issue(
    'high',
    'priority_competitor_analysis_below_target',
    `${priorityAnalyzed.length} of ${priorityObserved.length} priority competitors with collected content have a reconciled deep analysis.`,
    'Analyze at least one representative high-signal post for each observed priority competitor, then expand by content type and audience state.',
  ));
  if (reconciledReportCount < reports.length) issues.push(issue(
    'medium',
    'video_report_reconciliation_gap',
    `${reconciledReportCount} of ${reports.length} generated video reports reconcile to the current content library.`,
    'Preserve the source platform post ID in every generated report so library refreshes can retain analysis lineage.',
  ));
  if (reconciledScheduledAnalysisCount < scheduledAnalyses.length) issues.push(issue(
    'medium',
    'scheduled_analysis_reconciliation_gap',
    `${reconciledScheduledAnalysisCount} of ${scheduledAnalyses.length} scheduled TwelveLabs analyses reconcile to the current content library.`,
    'Preserve canonical_url, platform, and platform_post_id in every published scheduled analysis.',
  ));
  if (ownedConnection !== 'connected') issues.push(issue(
    ownedConnection === 'not_connected' ? 'critical' : 'medium',
    'owned_performance_not_connected',
    `Owned marketing performance is ${ownedConnection.replace('_', ' ')}.`,
    'Connect append-only post snapshots and privacy-safe aggregate events; do not substitute competitor metrics.',
  ));
  if (Number(contentLibrary.schema_version) < 2 || contentTypeCounts.unknown === contentItems.length) issues.push(issue(
    'high',
    'content_library_artifact_drift',
    'The current content-library artifact does not expose the v2 content-type contract supported by the checked-in builder.',
    'Regenerate the library after the active discovery owner finishes, then verify image, carousel, feed-video, and short-video counts.',
  ));
  const refreshStatus = nullableText(refresh.status);
  if (refreshStatus && refreshStatus !== 'completed') issues.push(issue(
    'medium',
    'latest_refresh_not_complete',
    `The latest scheduled refresh is ${refreshStatus}.`,
    'Keep the partial state visible and resolve provider or schema errors before treating analysis coverage as complete.',
  ));

  const freshness = buildFreshness(input, sourcePaths, generatedAt);
  for (const stale of freshness.filter((row) => row.state !== 'current')) {
    issues.push(issue(
      stale.state === 'missing' ? 'critical' : 'medium',
      `source_${stale.state}_${stale.source_id}`,
      `${stale.source_id.replaceAll('_', ' ')} is ${stale.state}.`,
      stale.state === 'missing'
        ? `Restore the required source at ${stale.path}.`
        : `Refresh ${stale.path} and preserve the prior artifact for reconciliation.`,
    ));
  }

  const status = freshness.some((row) => row.state === 'missing')
    ? 'blocked'
    : issues.some((entry) => ['critical', 'high'].includes(entry.severity))
      ? 'partial'
      : 'ready';

  const priorityGaps = priorityCompetitors
    .filter((row) => row.observed_posts === 0)
    .sort((left, right) => (
      (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
      || right.known_social_platforms - left.known_social_platforms
      || left.name.localeCompare(right.name)
    ));
  const priorityAnalysisGaps = priorityObserved
    .filter((row) => row.deep_analyzed_posts === 0)
    .sort((left, right) => (
      (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
      || right.observed_posts - left.observed_posts
      || left.name.localeCompare(right.name)
    ));
  const competitorEntryByName = new Map(competitorEntries.map((entry) => [
    normalizeHandle(text(entry.name)),
    entry,
  ]));
  const priorityAnalysisQueue = priorityAnalysisGaps
    .map((competitor) => selectCompetitorAnalysisCandidate(
      competitor,
      competitorEntryByName.get(normalizeHandle(competitor.name)),
      contentItems,
    ))
    .filter((row): row is CompetitorAnalysisQueueRow => row !== null);

  return {
    schema_version: 'viralbench_marketing_intelligence_hub_v1',
    generated_at: generatedAt,
    status,
    audience: 'marketing_team',
    scope: {
      public_competitor_intelligence: true,
      owned_marketing_performance: true,
      evidence_domains_separated: true,
    },
    headline,
    inventory: {
      sources: {
        total: sourceRows.length,
        verified: verifiedSources.length,
        state_resolved: resolvedSources.length,
        state_resolution_coverage: rate(resolvedSources.length, sourceRows.length),
        access_limited: sourceRows.filter((row) => row.status.includes('rate_limited')).length,
        connection_required: sourceRows.filter((row) => row.status === 'connection_required').length,
        verification_overrides_applied: verificationOverridesApplied,
        by_status: countBy(sourceRows, (row) => row.status),
        by_category: countBy(sourceRows, (row) => row.category),
        pending: pendingSources,
      },
      competitors: {
        total: competitors.length,
        priority_total: priorityCompetitors.length,
        with_known_socials: competitors.filter((row) => row.known_social_platforms > 0).length,
        with_observed_content: competitors.filter((row) => row.observed_posts > 0).length,
        priority_with_observed_content: priorityObserved.length,
        rows: competitors,
      },
      content: {
        schema_version: scalarOrNull(contentLibrary.schema_version),
        unique_items: contentItems.length,
        observations: integerOr(summary.observations, contentItems.reduce((sum, item) => sum + item.observation_count, 0)),
        repeated_items: repeatedItems,
        observed_velocity_items: observedVelocityItems,
        distinct_accounts: accounts.size,
        recent_items_30d: recentItems30d,
        publication_time_coverage: rate(publishedItems, contentItems.length),
        by_platform: platformCounts,
        by_content_type: contentTypeCounts,
        by_signal: signalCounts,
        top_account_share: topAccounts[0]?.share ?? null,
        top_accounts: topAccounts,
      },
      analysis: {
        queue_items: queueRows.length,
        matched_queue_items: matchedQueueItems,
        generated_video_reports: reports.length,
        reports_reconciled_to_library: reconciledReportCount,
        scheduled_analysis_records: scheduledAnalyses.length,
        scheduled_analyses_reconciled_to_library: reconciledScheduledAnalysisCount,
        priority_competitors_with_content: priorityObserved.length,
        priority_competitors_with_deep_analysis: priorityAnalyzed.length,
        priority_competitor_analysis_coverage: priorityCompetitorAnalysisCoverage,
        semantic_video_analyses: nullableInteger(input.semantic_counts?.video_analyses),
        latest_refresh_status: refreshStatus,
        latest_refresh_analysis_coverage: nullableRate(refreshTwelveLabs.analysis_coverage),
      },
      owned_performance: {
        connection_state: ownedConnection,
        post_count: arrayOrEmpty(ownedDimensions.posts).length,
        metric_observations: arrayOrEmpty(ownedFacts.metric_observations).length,
        event_aggregates: arrayOrEmpty(ownedFacts.event_aggregates).length,
        quality_issues: arrayOrEmpty(ownedQuality.issues).length,
      },
    },
    queues: {
      priority_competitor_gaps: priorityGaps,
      priority_competitor_analysis_gaps: priorityAnalysisGaps,
      priority_competitor_analysis_queue: priorityAnalysisQueue,
      source_gaps: pendingSources,
      viral_analysis: queueRows
        .sort((left, right) => (
          signalPriority(left.signal) - signalPriority(right.signal)
          || (right.comparison_percentile ?? -1) - (left.comparison_percentile ?? -1)
          || left.item_id.localeCompare(right.item_id)
        ))
        .slice(0, 30),
    },
    freshness,
    quality: { issues },
    evidence_boundaries: [
      'Public competitor intelligence and owned marketing performance share one operating surface but never one fact domain.',
      'Observed velocity requires repeated captures; lifetime views divided by post age is only a lifetime proxy.',
      'Performance comparisons are valid only within compatible platform, content-type, and age cohorts.',
      'Viral ranking is descriptive and cannot establish that a hook, format, creator, or edit caused distribution.',
      'Deep-analysis coverage reconciles both generated video reports and the latest published scheduled TwelveLabs analysis records.',
      'Missing providers, failed fetches, and uncollected competitors remain visible measurement gaps.',
      'Null owned metrics remain null until privacy-safe owned facts are connected.',
    ],
  };
}

export function buildMarketingAnalysisIntakePlan(
  hub: MarketingIntelligenceHub,
  maxUrlsPerBatch = 7,
): MarketingAnalysisIntakePlan {
  if (!Number.isInteger(maxUrlsPerBatch) || maxUrlsPerBatch < 1 || maxUrlsPerBatch > 10) {
    throw new Error('maxUrlsPerBatch must be an integer between 1 and 10');
  }
  const candidates = hub.queues.priority_competitor_analysis_queue;
  const runDate = hub.generated_at.slice(0, 10).replaceAll('-', '');
  const batches: MarketingAnalysisIntakePlan['batches'] = [];
  for (let index = 0; index < candidates.length; index += maxUrlsPerBatch) {
    const selection = candidates.slice(index, index + maxUrlsPerBatch);
    batches.push({
      request_id: `marketing-intelligence-analysis-gaps-${runDate}-batch-${batches.length + 1}`,
      urls: selection.map((row) => row.canonical_url),
      allowed_platforms: [...new Set(selection.map((row) => row.platform))].sort(),
      comment_policy: {
        enabled: false,
        max_high_engagement: 0,
        max_recent: 0,
        max_replies_per_thread: 0,
      },
      approval_state: 'draft',
      cost_limits: {
        max_total_usd: 4.5,
        max_apify_usd: 0.5,
        max_twelvelabs_usd: 4,
        max_gemini_usd: 0,
      },
      selection,
    });
  }
  return {
    schema_version: 'viralbench_marketing_analysis_intake_plan_v1',
    generated_at: hub.generated_at,
    execution_state: 'draft_not_authorized',
    candidate_count: candidates.length,
    batch_count: batches.length,
    batches,
    stop_conditions: [
      'Do not execute while another Viral-Bench provider run owns the pipeline.',
      'Require explicit approval_state=approved before any external call.',
      'Stop when a batch reaches its total or provider-specific cost ceiling.',
      'Preserve failed, unmatched, or incomplete candidates as visible measurement gaps.',
      'Do not collect comments unless a separately reviewed privacy policy enables them.',
    ],
  };
}

export function buildMarketingIntelligenceArtifact(
  hub: MarketingIntelligenceHub,
): ArtifactPayload {
  const overview = [{
    source_state_resolution_coverage: hub.inventory.sources.state_resolution_coverage,
    verified_source_coverage: hub.headline.verified_source_coverage,
    priority_competitor_content_coverage: hub.headline.priority_competitor_content_coverage,
    priority_competitor_analysis_coverage: hub.inventory.analysis.priority_competitor_analysis_coverage,
    temporal_measurement_coverage: hub.headline.temporal_measurement_coverage,
    deep_analysis_queue_coverage: hub.headline.deep_analysis_queue_coverage,
    owned_performance_connection_state: hub.headline.owned_performance_connection_state,
  }];
  const coverageRates = [
    {
      area: 'Source states resolved',
      rate: hub.inventory.sources.state_resolution_coverage,
      numerator: hub.inventory.sources.state_resolved,
      denominator: hub.inventory.sources.total,
      target: 1,
    },
    {
      area: 'Verified sources',
      rate: hub.headline.verified_source_coverage,
      numerator: hub.inventory.sources.verified,
      denominator: hub.inventory.sources.total,
      target: 0.8,
    },
    {
      area: 'Priority competitors',
      rate: hub.headline.priority_competitor_content_coverage,
      numerator: hub.inventory.competitors.priority_with_observed_content,
      denominator: hub.inventory.competitors.priority_total,
      target: 0.8,
    },
    {
      area: 'Repeated captures',
      rate: hub.headline.temporal_measurement_coverage,
      numerator: hub.inventory.content.repeated_items,
      denominator: hub.inventory.content.unique_items,
      target: 0.5,
    },
    {
      area: 'Priority competitor analysis',
      rate: hub.inventory.analysis.priority_competitor_analysis_coverage,
      numerator: hub.inventory.analysis.priority_competitors_with_deep_analysis,
      denominator: hub.inventory.analysis.priority_competitors_with_content,
      target: 0.5,
    },
    {
      area: 'Deep analysis queue',
      rate: hub.headline.deep_analysis_queue_coverage,
      numerator: hub.inventory.analysis.matched_queue_items,
      denominator: hub.inventory.analysis.queue_items,
      target: 0.5,
    },
  ];
  const platformMix = Object.entries(hub.inventory.content.by_platform)
    .map(([platform, posts]) => ({
      platform: displayToken(platform),
      posts,
      share: rate(posts, hub.inventory.content.unique_items),
      distinct_accounts: hub.inventory.content.distinct_accounts,
    }))
    .sort((left, right) => right.posts - left.posts);
  const priorityGaps = hub.queues.priority_competitor_gaps.map((row) => ({
    competitor: row.name,
    category: displayToken(row.category),
    priority: row.priority,
    known_social_platforms: row.known_social_platforms,
    coverage_state: displayToken(row.coverage_state),
    official_url: row.official_url,
  }));
  const competitorAnalysisQueue = hub.queues.priority_competitor_analysis_queue.map((row) => ({
    competitor: row.competitor,
    category: displayToken(row.category),
    priority: row.priority,
    platform: displayToken(row.platform),
    content_type: displayToken(row.content_type),
    account: row.account_handle,
    signal: displayToken(row.signal),
    percentile: row.comparison_percentile,
    observed_velocity_per_hour: row.observed_velocity_per_hour,
    confidence: displayToken(row.confidence),
    latest_observed_at: row.latest_observed_at,
    selection_reason: row.selection_reason,
    source_url: row.canonical_url,
  }));
  const viralQueue = hub.queues.viral_analysis.map((row, index) => ({
    rank: index + 1,
    account: row.account_handle,
    platform: displayToken(row.platform),
    content_type: displayToken(row.content_type),
    signal: displayToken(row.signal),
    percentile: row.comparison_percentile,
    observed_velocity_per_hour: row.observed_velocity_per_hour,
    confidence: displayToken(row.confidence),
    analyzed: row.analyzed ? 'Yes' : 'No',
    source_url: row.canonical_url,
  }));
  const sourceGaps = hub.queues.source_gaps.map((row) => ({
    rank: row.rank,
    source: row.name,
    category: displayToken(row.category),
    status: displayToken(row.status),
    checked_at: row.verification_checked_at,
    verification_method: row.verification_method ? displayToken(row.verification_method) : null,
    http_status: row.http_status,
    evidence_summary: row.verification_summary,
    evidence_url: row.verification_evidence_url,
    source_url: row.url,
  }));
  const qualityIssues = hub.quality.issues.map((row) => ({
    severity: displayToken(row.severity),
    issue: row.message,
    next_action: row.next_action,
    code: row.code,
  }));
  const sources = artifactSources(hub);
  const manifestSources = sources.map((source) => ({ ...source }));
  const statusNote = hub.status === 'ready'
    ? 'All required inputs are available; outstanding gaps are operating priorities rather than evidence blockers.'
    : 'The hub is usable for public intelligence, but high-impact source, competitor, analysis, or owned-data gaps remain visible.';

  return {
    surface: 'dashboard',
    manifest: {
      version: 1,
      surface: 'dashboard',
      title: 'ViralBench Marketing Intelligence',
      description: 'Source coverage, competitor coverage, viral-content measurement, analysis depth, and owned-performance readiness for the marketing team.',
      generatedAt: hub.generated_at,
      sources: manifestSources,
      cards: [
        metricCard('verified-sources', 'overview', 'source-reconciliation', 'Verified sources', 'verified_source_coverage', 'percent',
          'Observed or sample-observed sources divided by every registered source.'),
        metricCard('priority-competitors', 'overview', 'competitor-reconciliation', 'Priority competitors', 'priority_competitor_content_coverage', 'percent',
          'Priority-1/2 competitors with at least one reconciled public post.'),
        metricCard('temporal-coverage', 'overview', 'content-library', 'Repeated captures', 'temporal_measurement_coverage', 'percent',
          'Public posts with two or more distinct observations.'),
        metricCard('analysis-coverage', 'overview', 'analysis-reconciliation', 'Deep analysis queue', 'deep_analysis_queue_coverage', 'percent',
          'Queued viral candidates matched to a generated multimodal report.'),
        metricCard('owned-connection', 'overview', 'owned-dashboard', 'Owned performance', 'owned_performance_connection_state', undefined,
          'Explicit owned-data connection state; competitor metrics never fill this card.'),
      ],
      charts: [
        {
          id: 'coverage-rates',
          title: 'Marketing intelligence coverage',
          subtitle: 'Current verified coverage against the operating thresholds defined in the goal contract.',
          type: 'bar',
          dataset: 'coverage_rates',
          sourceId: 'hub-reconciliation',
          encodings: {
            x: { field: 'area', type: 'nominal', label: 'Intelligence area' },
            y: { field: 'rate', type: 'quantitative', format: 'percent', label: 'Coverage' },
            tooltip: [
              { field: 'numerator', type: 'quantitative', label: 'Covered' },
              { field: 'denominator', type: 'quantitative', label: 'Total' },
              { field: 'target', type: 'quantitative', format: 'percent', label: 'Target' },
            ],
          },
          valueFormat: 'percent',
          surface: { orientation: 'horizontal' },
        },
        {
          id: 'platform-mix',
          title: 'Public content by platform',
          subtitle: `${hub.inventory.content.unique_items} unique posts across ${hub.inventory.content.distinct_accounts} public accounts.`,
          type: 'bar',
          dataset: 'platform_mix',
          sourceId: 'content-library',
          encodings: {
            x: { field: 'platform', type: 'nominal', label: 'Platform' },
            y: { field: 'posts', type: 'quantitative', label: 'Posts' },
            tooltip: [
              { field: 'share', type: 'quantitative', format: 'percent', label: 'Corpus share' },
              { field: 'distinct_accounts', type: 'quantitative', label: 'Distinct accounts' },
            ],
          },
          valueFormat: 'number',
        },
      ],
      tables: [
        {
          id: 'priority-gaps',
          title: 'Priority competitor coverage gaps',
          subtitle: 'Known competitors that still have no reconciled public post in the current library.',
          dataset: 'priority_competitor_gaps',
          sourceId: 'competitor-reconciliation',
          defaultSort: { field: 'priority', direction: 'asc' },
          density: 'dense',
          columns: [
            { field: 'competitor', label: 'Competitor', type: 'text' },
            { field: 'category', label: 'Category', type: 'text' },
            { field: 'priority', label: 'Priority', format: 'number' },
            { field: 'known_social_platforms', label: 'Known socials', format: 'number' },
            { field: 'coverage_state', label: 'Coverage state', type: 'text' },
            { field: 'official_url', label: 'Official URL', type: 'text' },
          ],
        },
        {
          id: 'competitor-analysis-gaps',
          title: 'Priority competitor analysis queue',
          subtitle: 'One highest-signal public post selected for each observed priority competitor without reconciled multimodal analysis.',
          dataset: 'priority_competitor_analysis_queue',
          sourceId: 'analysis-reconciliation',
          defaultSort: { field: 'priority', direction: 'asc' },
          density: 'dense',
          columns: [
            { field: 'competitor', label: 'Competitor', type: 'text' },
            { field: 'category', label: 'Category', type: 'text' },
            { field: 'priority', label: 'Priority', format: 'number' },
            { field: 'platform', label: 'Platform', type: 'text' },
            { field: 'content_type', label: 'Type', type: 'text' },
            { field: 'account', label: 'Account', type: 'text' },
            { field: 'signal', label: 'Signal', type: 'text' },
            { field: 'percentile', label: 'Percentile', format: 'percent' },
            { field: 'observed_velocity_per_hour', label: 'Observed velocity / hr', format: 'number' },
            { field: 'confidence', label: 'Confidence', type: 'text' },
            { field: 'latest_observed_at', label: 'Latest observed', type: 'text' },
            { field: 'selection_reason', label: 'Selection reason', type: 'text' },
            { field: 'source_url', label: 'Source URL', type: 'text' },
          ],
        },
        {
          id: 'viral-analysis-queue',
          title: 'Viral content analysis queue',
          subtitle: 'High-signal items ranked within compatible platform and age cohorts; descriptive, not causal.',
          dataset: 'viral_analysis_queue',
          sourceId: 'content-library',
          defaultSort: { field: 'rank', direction: 'asc' },
          density: 'dense',
          columns: [
            { field: 'rank', label: 'Rank', format: 'number' },
            { field: 'account', label: 'Account', type: 'text' },
            { field: 'platform', label: 'Platform', type: 'text' },
            { field: 'content_type', label: 'Type', type: 'text' },
            { field: 'signal', label: 'Signal', type: 'text' },
            { field: 'percentile', label: 'Percentile', format: 'percent' },
            { field: 'observed_velocity_per_hour', label: 'Observed velocity / hr', format: 'number' },
            { field: 'confidence', label: 'Confidence', type: 'text' },
            { field: 'analyzed', label: 'Deep analyzed', type: 'text' },
            { field: 'source_url', label: 'Source URL', type: 'text' },
          ],
        },
        {
          id: 'source-gaps',
          title: 'Source verification and connection queue',
          subtitle: 'Registered sources that are not yet observed or sample-observed.',
          dataset: 'source_gaps',
          sourceId: 'source-reconciliation',
          defaultSort: { field: 'rank', direction: 'asc' },
          density: 'dense',
          columns: [
            { field: 'rank', label: 'Rank', format: 'number' },
            { field: 'source', label: 'Source', type: 'text' },
            { field: 'category', label: 'Category', type: 'text' },
            { field: 'status', label: 'Status', type: 'text' },
            { field: 'checked_at', label: 'Checked at', type: 'text' },
            { field: 'verification_method', label: 'Verification', type: 'text' },
            { field: 'http_status', label: 'HTTP', format: 'number' },
            { field: 'evidence_summary', label: 'Evidence', type: 'text' },
            { field: 'evidence_url', label: 'Evidence URL', type: 'text' },
            { field: 'source_url', label: 'Source URL', type: 'text' },
          ],
        },
        {
          id: 'quality-issues',
          title: 'Data-quality and operating blockers',
          subtitle: 'Issues are prioritized by decision impact rather than by file or pipeline stage.',
          dataset: 'quality_issues',
          sourceId: 'hub-reconciliation',
          defaultSort: { field: 'severity', direction: 'asc' },
          density: 'dense',
          columns: [
            { field: 'severity', label: 'Severity', type: 'text' },
            { field: 'issue', label: 'Issue', type: 'text' },
            { field: 'next_action', label: 'Next action', type: 'text' },
            { field: 'code', label: 'Code', type: 'text' },
          ],
        },
      ],
      blocks: [
        {
          id: 'scope-note',
          type: 'markdown',
          body: `**Status: ${hub.status}.** ${statusNote}\n\nPublic competitor intelligence and owned marketing performance are shown together for operating convenience, but they remain separate evidence domains.`,
        },
        {
          id: 'headline-kpis',
          type: 'metric-strip',
          cardIds: ['verified-sources', 'priority-competitors', 'temporal-coverage', 'analysis-coverage', 'owned-connection'],
        },
        { id: 'coverage-chart-block', type: 'chart', chartId: 'coverage-rates', layout: 'full' },
        { id: 'platform-chart-block', type: 'chart', chartId: 'platform-mix', layout: 'half' },
        { id: 'priority-gaps-block', type: 'table', tableId: 'priority-gaps', layout: 'full' },
        { id: 'competitor-analysis-gaps-block', type: 'table', tableId: 'competitor-analysis-gaps', layout: 'full' },
        { id: 'viral-analysis-block', type: 'table', tableId: 'viral-analysis-queue', layout: 'full' },
        { id: 'source-gaps-block', type: 'table', tableId: 'source-gaps', layout: 'full' },
        { id: 'quality-block', type: 'table', tableId: 'quality-issues', layout: 'full' },
        {
          id: 'evidence-boundaries',
          type: 'markdown',
          body: `### Evidence boundaries\n\n${hub.evidence_boundaries.map((entry) => `- ${entry}`).join('\n')}`,
        },
      ],
    },
    snapshot: {
      version: 1,
      generatedAt: hub.generated_at,
      status: hub.status,
      datasets: {
        overview,
        coverage_rates: coverageRates,
        platform_mix: platformMix,
        priority_competitor_gaps: priorityGaps,
        priority_competitor_analysis_queue: competitorAnalysisQueue,
        viral_analysis_queue: viralQueue,
        source_gaps: sourceGaps,
        quality_issues: qualityIssues,
      },
      ...(hub.status === 'blocked' ? {
        accessIssues: hub.quality.issues
          .filter((entry) => entry.severity === 'critical')
          .map((entry) => ({
            id: entry.code,
            scope: 'marketing intelligence hub',
            sourceId: 'hub-reconciliation',
            message: entry.message,
          })),
      } : {}),
    },
    sources,
  };
}

export function writeMarketingIntelligenceHub(options: {
  hub: MarketingIntelligenceHub;
  output_dir: string;
}): {
  dataset: ArtifactDescriptor;
  artifact: ArtifactDescriptor;
  analysis_plan: ArtifactDescriptor;
  manifest: ArtifactDescriptor;
} {
  const outputDir = path.resolve(options.output_dir);
  const datasetPath = path.join(outputDir, 'marketing-intelligence-hub.json');
  const artifactPath = path.join(outputDir, 'artifact.json');
  const analysisPlanPath = path.join(outputDir, 'analysis-intake-plan.json');
  atomicWriteJson(datasetPath, options.hub);
  atomicWriteJson(artifactPath, buildMarketingIntelligenceArtifact(options.hub));
  atomicWriteJson(analysisPlanPath, buildMarketingAnalysisIntakePlan(options.hub));
  const manifestPath = path.join(outputDir, 'build-manifest.json');
  const manifest = {
    schema_version: 'viralbench_marketing_intelligence_hub_build_v1',
    generated_at: options.hub.generated_at,
    status: options.hub.status,
    outputs: {
      dataset: describeArtifact(datasetPath),
      artifact: describeArtifact(artifactPath),
      analysis_plan: describeArtifact(analysisPlanPath),
    },
    quality: options.hub.quality,
    evidence_boundaries: options.hub.evidence_boundaries,
  };
  atomicWriteJson(manifestPath, manifest);
  return {
    dataset: describeArtifact(datasetPath),
    artifact: describeArtifact(artifactPath),
    analysis_plan: describeArtifact(analysisPlanPath),
    manifest: describeArtifact(manifestPath),
  };
}

export function loadMarketingIntelligenceInputs(options: {
  root?: string;
  paths?: Partial<Record<HubSourceId, string>>;
  generated_at?: string;
} = {}): MarketingIntelligenceInputs {
  const root = path.resolve(options.root ?? process.cwd());
  const sourcePaths = { ...DEFAULT_SOURCE_PATHS, ...(options.paths ?? {}) };
  const required: HubSourceId[] = [
    'source_registry',
    'source_verification',
    'core_competitors',
    'competitor_universe',
    'content_library',
    'owned_dashboard',
  ];
  for (const sourceId of required) {
    const target = path.resolve(root, sourcePaths[sourceId]);
    if (!fs.existsSync(target)) throw new Error(`Required hub source is missing: ${sourcePaths[sourceId]}`);
  }
  const optionalJson = (sourceId: HubSourceId): unknown => {
    const target = path.resolve(root, sourcePaths[sourceId]);
    return fs.existsSync(target) ? readJson(target) : undefined;
  };
  const databasePath = path.resolve(root, sourcePaths.semantic_database);
  return {
    source_registry: readJson(path.resolve(root, sourcePaths.source_registry)),
    source_verification: readJson(path.resolve(root, sourcePaths.source_verification)),
    core_competitors: readJson(path.resolve(root, sourcePaths.core_competitors)),
    competitor_universe: readJson(path.resolve(root, sourcePaths.competitor_universe)),
    content_library: readJson(path.resolve(root, sourcePaths.content_library)),
    owned_dashboard: readJson(path.resolve(root, sourcePaths.owned_dashboard)),
    video_reports: optionalJson('video_reports'),
    pipeline_refresh: optionalJson('pipeline_refresh'),
    semantic_counts: fs.existsSync(databasePath) ? readSemanticCounts(databasePath) : undefined,
    source_paths: sourcePaths,
    generated_at: options.generated_at,
  };
}

function normalizeContentItem(input: unknown, index: number) {
  const row = object(input, `content item ${index}`);
  const performance = recordOrEmpty(row.performance);
  const itemId = text(row.item_id) || `content-${index + 1}`;
  return {
    item_id: itemId,
    platform: text(row.platform) || itemId.split(':')[0] || 'unknown',
    content_type: text(row.content_type) || 'unknown',
    platform_post_id: text(row.platform_post_id) || itemId.split(':').at(-1) || '',
    canonical_url: text(row.canonical_url),
    account_handle: text(row.account_handle) || 'unknown',
    posted_at: isoDate(row.posted_at),
    last_seen_at: isoDate(row.last_seen_at),
    observation_count: integerOr(row.observation_count, arrayOrEmpty(row.observations).length),
    age_bucket: text(performance.age_bucket) || 'unknown',
    signal: text(performance.signal) || text(row.signal) || 'unknown',
    comparison_percentile: nullableRate(performance.comparison_percentile ?? row.comparison_percentile),
    observed_velocity_per_hour: nullableNumber(
      performance.observed_view_velocity_per_hour
      ?? performance.observed_interaction_velocity_per_hour
      ?? row.observed_view_velocity_per_hour,
    ),
    confidence: text(performance.confidence) || 'unknown',
  };
}

function mergeCompetitorEntries(...universes: unknown[][]): Record<string, unknown>[] {
  const byName = new Map<string, Record<string, unknown>>();
  for (const universe of universes) {
    for (const [index, entry] of universe.entries()) {
      const row = object(entry, `competitor ${index}`);
      const key = normalizeHandle(text(row.name));
      if (!key) continue;
      const existing = byName.get(key);
      byName.set(key, {
        ...(existing ?? {}),
        ...row,
        known_socials: {
          ...recordOrEmpty(existing?.known_socials),
          ...recordOrEmpty(row.known_socials),
        },
      });
    }
  }
  return [...byName.values()];
}

function isExcludedCompetitor(row: Record<string, unknown>): boolean {
  return text(row.content_priority).toLowerCase() === 'exclude'
    || text(row.status).toLowerCase() === 'excluded';
}

function normalizeCompetitor(
  input: unknown,
  index: number,
  accountsByPlatform: Map<string, {
    count: number;
    latest: string | null;
    deep_analyzed_posts: number;
  }>,
): CompetitorCoverageRow {
  const row = object(input, `competitor ${index}`);
  const socials = recordOrEmpty(row.known_socials);
  const matches: Array<{
    count: number;
    latest: string | null;
    deep_analyzed_posts: number;
  }> = [];
  let knownSocialPlatforms = 0;
  for (const [platformName, rawUrl] of Object.entries(socials)) {
    const platform = PLATFORM_ALIASES[platformName.toLowerCase()];
    const handle = socialHandle(rawUrl);
    if (text(rawUrl)) knownSocialPlatforms += 1;
    if (!platform || !handle) continue;
    const matched = accountsByPlatform.get(`${platform}:${handle}`);
    if (matched) matches.push(matched);
  }
  const observedPosts = matches.reduce((sum, match) => sum + match.count, 0);
  const deepAnalyzedPosts = matches.reduce((sum, match) => sum + match.deep_analyzed_posts, 0);
  const latestObservedAt = matches.reduce<string | null>((latest, match) => latestIso(latest, match.latest), null);
  return {
    name: text(row.name) || `Competitor ${index + 1}`,
    category: text(row.category) || 'uncategorized',
    status: text(row.status) || 'unknown',
    priority: nullableInteger(row.content_priority),
    official_url: nullableText(row.official_url),
    known_social_platforms: knownSocialPlatforms,
    observed_platforms: matches.length,
    observed_posts: observedPosts,
    deep_analyzed_posts: deepAnalyzedPosts,
    latest_observed_at: latestObservedAt,
    coverage_state: observedPosts > 0
      ? 'observed'
      : knownSocialPlatforms > 0
        ? 'known_socials_unobserved'
        : 'social_discovery_gap',
    analysis_state: deepAnalyzedPosts > 0 ? 'analyzed' : 'not_analyzed',
  };
}

function selectCompetitorAnalysisCandidate(
  competitor: CompetitorCoverageRow,
  competitorEntry: Record<string, unknown> | undefined,
  contentItems: Array<ReturnType<typeof normalizeContentItem>>,
): CompetitorAnalysisQueueRow | null {
  if (!competitorEntry) return null;
  const handles = new Set<string>();
  for (const [platformName, rawUrl] of Object.entries(recordOrEmpty(competitorEntry.known_socials))) {
    const platform = PLATFORM_ALIASES[platformName.toLowerCase()];
    const handle = socialHandle(rawUrl);
    if (platform && handle) handles.add(`${platform}:${handle}`);
  }
  const candidates = contentItems
    .filter((item) => handles.has(`${item.platform}:${normalizeHandle(item.account_handle)}`))
    .sort((left, right) => (
      signalPriority(left.signal) - signalPriority(right.signal)
      || (right.comparison_percentile ?? -1) - (left.comparison_percentile ?? -1)
      || (right.observed_velocity_per_hour ?? -1) - (left.observed_velocity_per_hour ?? -1)
      || (Date.parse(right.posted_at ?? '') || 0) - (Date.parse(left.posted_at ?? '') || 0)
      || left.item_id.localeCompare(right.item_id)
    ));
  const selected = candidates[0];
  if (!selected) return null;
  const percentile = selected.comparison_percentile === null
    ? 'no compatible-cohort percentile'
    : `${round(selected.comparison_percentile * 100, 1)}th percentile in its compatible cohort`;
  return {
    competitor: competitor.name,
    category: competitor.category,
    priority: competitor.priority,
    item_id: selected.item_id,
    platform: selected.platform,
    content_type: selected.content_type,
    account_handle: selected.account_handle,
    canonical_url: selected.canonical_url,
    signal: selected.signal,
    comparison_percentile: selected.comparison_percentile,
    observed_velocity_per_hour: selected.observed_velocity_per_hour,
    confidence: selected.confidence,
    latest_observed_at: selected.last_seen_at ?? selected.posted_at,
    selection_reason: `Highest-ranked unanalyzed ${competitor.name} post by evidence-safe signal priority and cohort percentile (${percentile}).`,
  };
}

function viralQueueRow(
  item: ReturnType<typeof normalizeContentItem>,
  analyzedPostIds: Set<string>,
): ViralQueueRow {
  return {
    item_id: item.item_id,
    platform: item.platform,
    content_type: item.content_type,
    account_handle: item.account_handle,
    canonical_url: item.canonical_url,
    signal: item.signal,
    comparison_percentile: item.comparison_percentile,
    observed_velocity_per_hour: item.observed_velocity_per_hour,
    confidence: item.confidence,
    analyzed: analyzedPostIds.has(item.platform_post_id),
  };
}

function buildFreshness(
  input: MarketingIntelligenceInputs,
  sourcePaths: Record<HubSourceId, string>,
  generatedAt: string,
): MarketingIntelligenceHub['freshness'] {
  const generated = Date.parse(generatedAt);
  const values: Array<[HubSourceId, unknown, number]> = [
    ['source_registry', input.source_registry, 24 * 14],
    ['source_verification', input.source_verification, 24 * 7],
    ['core_competitors', input.core_competitors, 24 * 14],
    ['competitor_universe', input.competitor_universe, 24 * 14],
    ['content_library', input.content_library, 24 * 7],
    ['owned_dashboard', input.owned_dashboard, 24 * 7],
    ['video_reports', input.video_reports, 24 * 7],
    ['pipeline_refresh', input.pipeline_refresh, 24 * 7],
  ];
  return values.map(([sourceId, raw, staleAfterHours]) => {
    if (raw === undefined) return {
      source_id: sourceId,
      path: sourcePaths[sourceId],
      generated_at: null,
      age_hours: null,
      state: 'missing' as const,
    };
    const record = recordOrEmpty(raw);
    const sourceGeneratedAt = isoDate(
      record.generated_at
      ?? record.created_at
      ?? record.updated_at
      ?? record.last_completed_at,
    );
    const ageHours = sourceGeneratedAt && Number.isFinite(generated)
      ? round((generated - Date.parse(sourceGeneratedAt)) / 3_600_000)
      : null;
    return {
      source_id: sourceId,
      path: sourcePaths[sourceId],
      generated_at: sourceGeneratedAt,
      age_hours: ageHours,
      state: ageHours !== null && ageHours > staleAfterHours ? 'stale' as const : 'current' as const,
    };
  });
}

function artifactSources(hub: MarketingIntelligenceHub): Array<Record<string, unknown>> {
  const pathFor = (id: HubSourceId) => (
    hub.freshness.find((source) => source.source_id === id)?.path ?? DEFAULT_SOURCE_PATHS[id]
  );
  const jsonSource = (id: string, label: string, filePath: string) => ({
    id,
    label,
    path: filePath,
    query: {
      engine: 'DuckDB',
      language: 'sql',
      executed_at: hub.generated_at,
      sql: `SELECT * FROM read_json_auto('${filePath.replaceAll("'", "''")}');`,
      description: `Read the reviewed Viral-Bench JSON artifact at ${filePath}.`,
      tables_used: [filePath],
    },
  });
  const hubDatasetPath = '.semantic-artifacts/marketing-intelligence-hub/marketing-intelligence-hub.json';
  return [
    jsonSource('source-registry', 'Internship public source registry', pathFor('source_registry')),
    jsonSource('source-verification', 'Current source verification overlay', pathFor('source_verification')),
    jsonSource('core-competitors', 'Established internship competitor registry', pathFor('core_competitors')),
    jsonSource('competitor-universe', 'Expanded internship competitor universe', pathFor('competitor_universe')),
    jsonSource('content-library', 'Viral content library', pathFor('content_library')),
    jsonSource('owned-dashboard', 'Owned marketing dashboard', pathFor('owned_dashboard')),
    jsonSource('video-reports', 'Generated video analysis reports', pathFor('video_reports')),
    jsonSource('pipeline-refresh', 'Latest pipeline refresh status', pathFor('pipeline_refresh')),
    {
      id: 'source-reconciliation',
      label: 'Registry and source-verification reconciliation',
      query: {
        engine: 'DuckDB',
        language: 'sql',
        executed_at: hub.generated_at,
        sql: `SELECT inventory.sources FROM read_json_auto('${hubDatasetPath}');`,
        description: 'Applies current evidence-backed verification states to canonical source-registry entries without changing the base registry or converting access failures into empty-source claims.',
        tables_used: [hubDatasetPath, pathFor('source_registry'), pathFor('source_verification')],
        filters: ['Raw community text and user identifiers are excluded', 'Owned sources remain connection-required until first-party data is supplied'],
        metric_definitions: ['Verified source coverage = observed or sample-observed reconciled sources / all canonical registered sources.'],
      },
    },
    {
      id: 'competitor-reconciliation',
      label: 'Core and expanded competitor reconciliation',
      query: {
        engine: 'DuckDB',
        language: 'sql',
        executed_at: hub.generated_at,
        sql: `SELECT inventory.competitors FROM read_json_auto('${hubDatasetPath}');`,
        description: 'Merges the established core registry with the expansion universe, deduplicates by normalized competitor name, excludes explicitly pivoted entries, and reconciles known public social handles to current corpus accounts.',
        tables_used: [hubDatasetPath, pathFor('core_competitors'), pathFor('competitor_universe'), pathFor('content_library')],
        filters: ['content_priority = exclude is omitted from active coverage', 'Public account observations only'],
        metric_definitions: ['Priority competitor content coverage = active priority-1/2 competitors with reconciled public content / all active priority-1/2 competitors.'],
      },
    },
    {
      id: 'analysis-reconciliation',
      label: 'Analysis queue reconciliation',
      query: {
        engine: 'DuckDB',
        language: 'sql',
        executed_at: hub.generated_at,
        sql: `SELECT queues.viral_analysis FROM read_json_auto('${hubDatasetPath}');`,
        description: 'Matches generated multimodal report candidate identifiers to current library posts, viral queue items, and reconciled competitor accounts.',
        tables_used: [hubDatasetPath, pathFor('content_library'), pathFor('video_reports'), pathFor('core_competitors'), pathFor('competitor_universe')],
        filters: [
          'Only current high-signal analysis queue items',
          'Identifier match must resolve to a current library post',
          'Competitor analysis requires an observed priority competitor account',
          'One unanalyzed candidate per competitor, ranked by signal, compatible-cohort percentile, observed velocity, and recency',
        ],
        metric_definitions: [
          'Deep analysis queue coverage = matched queued items / all queued items.',
          'Priority competitor analysis coverage = observed priority-1/2 competitors with at least one reconciled deep analysis / all observed priority-1/2 competitors.',
        ],
      },
    },
    {
      id: 'hub-reconciliation',
      label: 'Marketing intelligence hub reconciliation',
      query: {
        engine: 'DuckDB',
        language: 'sql',
        executed_at: hub.generated_at,
        sql: `SELECT * FROM read_json_auto('${hubDatasetPath}');`,
        description: 'Reconciles source, competitor, content, analysis, refresh, and owned-performance artifacts without mixing public and owned facts.',
        tables_used: [hubDatasetPath, ...hub.freshness.map((source) => source.path)],
        filters: ['Public metadata only for competitor intelligence', 'Owned facts remain a separate KPI domain'],
        metric_definitions: [
          'Verified source coverage = observed or sample-observed registered sources / all registered sources.',
          'Priority competitor content coverage = priority-1/2 competitors with reconciled public content / all priority-1/2 competitors.',
          'Temporal measurement coverage = public posts with at least two distinct captures / all public posts.',
          'Deep analysis queue coverage = queued viral candidates matched to a generated multimodal report / all queued candidates.',
        ],
      },
    },
  ];
}

function metricCard(
  id: string,
  dataset: string,
  sourceId: string,
  label: string,
  field: string,
  format: 'percent' | 'number' | 'compact' | 'currency' | undefined,
  description: string,
): Record<string, unknown> {
  return {
    id,
    dataset,
    sourceId,
    description,
    metrics: [{ label, field, ...(format ? { format } : {}) }],
  };
}

function readSemanticCounts(databasePath: string): MarketingIntelligenceInputs['semantic_counts'] {
  const tables = [
    'social_posts',
    'social_accounts',
    'performance_observations',
    'video_analyses',
    'social_comments',
    'semantic_items',
  ] as const;
  return Object.fromEntries(tables.map((table) => {
    const output = execFileSync('sqlite3', [databasePath, `SELECT COUNT(*) FROM ${table};`], {
      encoding: 'utf8',
    }).trim();
    return [table, Number(output)];
  }));
}

function socialHandle(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    return normalizeHandle(parts.at(-1)?.replace(/^@/, '') ?? '');
  } catch {
    return normalizeHandle(raw);
  }
}

function ownedConnectionState(value: unknown): 'not_connected' | 'partial' | 'connected' {
  return value === 'connected' || value === 'partial' ? value : 'not_connected';
}

function signalPriority(value: string): number {
  const priorities: Record<string, number> = {
    breakout_candidate: 0,
    evergreen_winner: 1,
    high_performer: 2,
    promising: 3,
  };
  return priorities[value] ?? (HIGH_SIGNAL_STATUSES.has(value) ? 4 : 10);
}

function displayToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countBy<T>(rows: T[], selector: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function issue(
  severity: HubSeverity,
  code: string,
  message: string,
  nextAction: string,
): HubQualityIssue {
  return { severity, code, message, next_action: nextAction };
}

function latestIso(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round(numerator / denominator) : null;
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function normalizeHandle(value: string): string {
  return value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, '');
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown): string | null {
  return text(value) || null;
}

function scalarOrNull(value: unknown): number | string | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableRate(value: unknown): number | null {
  const number = nullableNumber(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
}

function nullableInteger(value: unknown): number | null {
  const number = nullableNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function integerOr(value: unknown, fallback: number): number {
  return nullableInteger(value) ?? fallback;
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${token}`);
    result[token.slice(2)] = next;
    index += 1;
  }
  return result;
}

function runCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root ?? process.cwd());
  const outputDir = path.resolve(root, args['output-dir'] ?? '.semantic-artifacts/marketing-intelligence-hub');
  const inputs = loadMarketingIntelligenceInputs({
    root,
    generated_at: args['generated-at'],
  });
  const hub = buildMarketingIntelligenceHub(inputs);
  const outputs = writeMarketingIntelligenceHub({ hub, output_dir: outputDir });
  process.stdout.write(`${JSON.stringify({
    schema_version: hub.schema_version,
    generated_at: hub.generated_at,
    status: hub.status,
    headline: hub.headline,
    outputs,
  }, null, 2)}\n`);
}

if (require.main === module) runCli();
