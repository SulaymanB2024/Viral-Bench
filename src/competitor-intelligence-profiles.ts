import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  atomicWriteJson,
  describeArtifact,
  type ArtifactDescriptor,
} from './artifact-integrity';

const HIGH_SIGNAL_STATES = new Set([
  'breakout_candidate',
  'evergreen_winner',
  'high_performer',
  'promising',
]);
const VIDEO_CONTENT_TYPES = new Set(['short_video', 'feed_video']);
const PLATFORM_ALIASES: Record<string, string> = {
  instagram: 'instagram',
  tiktok: 'tiktok',
  youtube: 'youtube_shorts',
  youtube_shorts: 'youtube_shorts',
};
const SOURCE_PLATFORM_ALIASES: Record<string, string> = {
  ...PLATFORM_ALIASES,
  discovery: 'discovery',
  facebook: 'facebook',
};
const TAXONOMY_DIMENSIONS = [
  'topic',
  'audience_state',
  'content_promise',
  'proof_mode',
  'next_action',
  'journey_stage',
  'hook_type',
  'format',
  'cta_type',
] as const;

type TaxonomyDimension = typeof TAXONOMY_DIMENSIONS[number];
type JsonRecord = Record<string, unknown>;
type AnalysisSource = 'semantic_map' | 'scheduled_twelvelabs' | 'generated_video_report';

export interface CompetitorProfileInputs {
  core_competitors: unknown;
  competitor_universe: unknown;
  content_library: unknown;
  semantic_map: unknown;
  pipeline_refresh: unknown;
  video_reports: unknown;
  source_paths?: Partial<Record<CompetitorProfileSourceId, string>>;
  generated_at?: string;
}

export type CompetitorProfileSourceId =
  | 'core_competitors'
  | 'competitor_universe'
  | 'content_library'
  | 'semantic_map'
  | 'pipeline_refresh'
  | 'video_reports';

export interface DistributionRow {
  value: string;
  count: number;
  share: number;
}

export interface CompetitorRepresentativePost {
  item_id: string;
  platform: string;
  content_type: string;
  account_handle: string;
  canonical_url: string;
  posted_at: string | null;
  signal: string;
  comparison_percentile: number | null;
  observed_velocity_per_hour: number | null;
  confidence: string;
  analyzed: boolean;
  analysis_sources: AnalysisSource[];
  structured_taxonomy: Partial<Record<TaxonomyDimension, string>> | null;
  provider_observation: {
    hook_observed: boolean;
    cta_observed: boolean;
    styles: string[];
    pacing_pattern: string | null;
    visible_proof_count: number;
    claim_count: number;
    limitation_count: number;
  } | null;
  evidence_limitations: string[];
}

export interface CompetitorIntelligenceProfile {
  competitor_id: string;
  name: string;
  category: string;
  status: string;
  priority: number | null;
  official_url: string | null;
  known_socials: Array<{
    platform: string;
    handle: string;
    url: string | null;
  }>;
  coverage: {
    known_social_platforms: number;
    observed_platforms: string[];
    observed_posts: number;
    recent_posts_30d: number;
    high_signal_posts: number;
    repeated_capture_posts: number;
    observed_velocity_posts: number;
    deep_analyzed_posts: number;
    structured_taxonomy_posts: number;
    deep_analysis_share: number | null;
    high_signal_analysis_share: number | null;
    latest_observed_at: string | null;
    state:
      | 'deep_analysis_directional'
      | 'deep_analysis_thin'
      | 'observed_unanalyzed'
      | 'known_socials_unobserved'
      | 'social_discovery_gap';
  };
  evidence_quality: {
    assessment: 'directional' | 'thin' | 'metadata_only' | 'unobserved';
    analysis_sources: Record<AnalysisSource, number>;
    taxonomy_method: string | null;
    taxonomy_status: string | null;
    limitations: string[];
  };
  performance: {
    comparison_basis: 'within_platform_content_type_and_age_cohort';
    median_comparison_percentile: number | null;
    high_signal_share: number | null;
    by_signal: Record<string, number>;
    analyzed_high_signal_posts: number;
  };
  patterns: Partial<Record<TaxonomyDimension, DistributionRow[]>>;
  representative_posts: CompetitorRepresentativePost[];
  next_action: {
    code:
      | 'monitor_and_refresh'
      | 'expand_analysis_sample'
      | 'analyze_first_video'
      | 'analyze_high_signal_video'
      | 'normalize_scheduled_analysis'
      | 'collect_eligible_video'
      | 'collect_known_socials'
      | 'discover_official_socials';
    reason: string;
    candidate_item_id: string | null;
    candidate_url: string | null;
  };
}

export interface CompetitorIntelligenceProfiles {
  schema_version: 'viralbench_competitor_intelligence_profiles_v1';
  generated_at: string;
  status: 'ready' | 'partial';
  audience: 'marketing_team';
  summary: {
    active_competitors: number;
    priority_competitors: number;
    with_known_socials: number;
    with_observed_content: number;
    priority_with_observed_content: number;
    with_deep_analysis: number;
    priority_with_deep_analysis: number;
    with_structured_taxonomy: number;
    content_coverage: number | null;
    priority_content_coverage: number | null;
    deep_analysis_coverage: number | null;
    priority_deep_analysis_coverage: number | null;
    library_items: number;
    semantic_map_videos: number;
    semantic_map_multimodal_videos: number;
    scheduled_analysis_records: number;
    generated_video_reports: number;
    distinct_reconciled_deep_posts: number;
  };
  source_lineage: Array<{
    source_id: CompetitorProfileSourceId;
    path: string;
    generated_at: string | null;
    grain: string;
    authoritative_for: string;
  }>;
  profiles: CompetitorIntelligenceProfile[];
  queues: {
    collection: Array<{
      competitor: string;
      priority: number | null;
      coverage_state: CompetitorIntelligenceProfile['coverage']['state'];
      known_social_platforms: string[];
      next_action: CompetitorIntelligenceProfile['next_action'];
    }>;
    analysis: Array<{
      competitor: string;
      priority: number | null;
      gap: 'first_deep_analysis' | 'high_signal_analysis' | 'expand_sample';
      item_id: string;
      platform: string;
      content_type: string;
      canonical_url: string;
      signal: string;
      comparison_percentile: number | null;
      selection_reason: string;
    }>;
    taxonomy_normalization: Array<{
      competitor: string;
      deep_analyzed_posts: number;
      structured_taxonomy_posts: number;
      reason: string;
    }>;
    no_eligible_video: Array<{
      competitor: string;
      observed_posts: number;
      reason: string;
    }>;
  };
  quality: {
    issues: Array<{
      severity: 'critical' | 'high' | 'medium' | 'low';
      code: string;
      message: string;
      next_action: string;
    }>;
  };
  evidence_boundaries: string[];
}

interface NormalizedCompetitor {
  key: string;
  name: string;
  category: string;
  status: string;
  priority: number | null;
  official_url: string | null;
  known_socials: CompetitorIntelligenceProfile['known_socials'];
}

interface NormalizedContentItem {
  item_id: string;
  platform: string;
  content_type: string;
  platform_post_id: string;
  canonical_url: string;
  account_handle: string;
  posted_at: string | null;
  last_seen_at: string | null;
  observation_count: number;
  age_bucket: string;
  signal: string;
  comparison_percentile: number | null;
  observed_velocity_per_hour: number | null;
  confidence: string;
  evidence_limitations: string[];
}

interface MatchedSemanticVideo {
  item: NormalizedContentItem;
  competitor_key: string | null;
  semantic_state: string;
  taxonomy: Partial<Record<TaxonomyDimension, string>>;
  provider_observation: CompetitorRepresentativePost['provider_observation'];
}

interface MatchedScheduledAnalysis {
  item: NormalizedContentItem;
  competitor_key: string | null;
  provider_observation: CompetitorRepresentativePost['provider_observation'];
}

interface BuildContext {
  generated_at: string;
  source_paths: Record<CompetitorProfileSourceId, string>;
  competitors: NormalizedCompetitor[];
  content_items: NormalizedContentItem[];
  competitor_by_item_id: Map<string, string>;
  analysis_sources_by_item_id: Map<string, Set<AnalysisSource>>;
  semantic_by_item_id: Map<string, MatchedSemanticVideo>;
  scheduled_by_item_id: Map<string, MatchedScheduledAnalysis>;
  taxonomy_method: string | null;
  taxonomy_status: string | null;
}

const DEFAULT_SOURCE_PATHS: Record<CompetitorProfileSourceId, string> = {
  core_competitors: '.ops/competitor_research/internship-core-competitors-v1.json',
  competitor_universe: '.semantic-artifacts/competitor-content/discovery/internship-competitor-universe-20260716.json',
  content_library: 'internship-reels-site/library.json',
  semantic_map: '.semantic-artifacts/competitor-content/reports/internship-content-semantic-map-20260716.json',
  pipeline_refresh: 'internship-reels-site/data/pipeline-refresh.json',
  video_reports: 'internship-reels-site/data/video-ai-reports.json',
};

export function buildCompetitorIntelligenceProfiles(
  input: CompetitorProfileInputs,
): CompetitorIntelligenceProfiles {
  const core = object(input.core_competitors, 'core competitor registry');
  const universe = object(input.competitor_universe, 'competitor universe');
  const library = object(input.content_library, 'content library');
  const semanticMap = object(input.semantic_map, 'semantic map');
  const pipelineRefresh = object(input.pipeline_refresh, 'pipeline refresh');
  const videoReports = object(input.video_reports, 'video reports');
  const sourcePaths = { ...DEFAULT_SOURCE_PATHS, ...(input.source_paths ?? {}) };
  const generatedAt = resolveGeneratedAt(input.generated_at, [
    core.generated_at,
    universe.generated_at,
    universe.created_at,
    library.generated_at,
    semanticMap.generated_at,
    pipelineRefresh.generated_at,
    pipelineRefresh.updated_at,
    pipelineRefresh.last_completed_at,
    videoReports.generated_at,
  ]);
  const issues: CompetitorIntelligenceProfiles['quality']['issues'] = [];
  const competitors = mergeCompetitors(
    array(core.competitors, 'core competitors'),
    array(universe.competitors, 'expanded competitors'),
  );
  const contentItems = normalizeContentItems(array(library.items, 'content library items'));
  const contentByPlatformPost = new Map(
    contentItems.map((item) => [`${item.platform}:${item.platform_post_id}`, item]),
  );
  const contentByCanonicalUrl = new Map(
    contentItems.map((item) => [item.canonical_url, item]),
  );
  const handleAssignments = buildHandleAssignments(competitors, issues);
  const competitorByItemId = new Map<string, string>();
  for (const item of contentItems) {
    const competitorKey = handleAssignments.get(`${item.platform}:${normalizeHandle(item.account_handle)}`);
    if (competitorKey) competitorByItemId.set(item.item_id, competitorKey);
  }

  const analysisSourcesByItemId = new Map<string, Set<AnalysisSource>>();
  const semanticByItemId = new Map<string, MatchedSemanticVideo>();
  const semanticVideos = array(semanticMap.videos, 'semantic map videos');
  let semanticReconciled = 0;
  let semanticMultimodal = 0;
  for (const [index, entry] of semanticVideos.entries()) {
    const row = object(entry, `semantic video ${index}`);
    const item = matchContentItem(row, contentByPlatformPost, contentByCanonicalUrl);
    if (!item) continue;
    semanticReconciled += 1;
    const semanticState = text(row.semantic_state) || 'unknown';
    if (semanticState === 'multimodal_mapped') {
      semanticMultimodal += 1;
      addAnalysisSource(analysisSourcesByItemId, item.item_id, 'semantic_map');
    }
    semanticByItemId.set(item.item_id, {
      item,
      competitor_key: competitorByItemId.get(item.item_id) ?? null,
      semantic_state: semanticState,
      taxonomy: taxonomyFrom(row),
      provider_observation: providerObservation(row),
    });
  }

  const declaredSemanticCoverage = nullableInteger(recordOrEmpty(semanticMap.coverage).videos_multimodally_mapped);
  if (semanticReconciled < semanticVideos.length) issues.push(qualityIssue(
    'high',
    'semantic_map_library_reconciliation_gap',
    `${semanticReconciled} of ${semanticVideos.length} semantic-map videos reconcile to the current library.`,
    'Regenerate the semantic map from the current library or preserve platform and platform-post identities.',
  ));
  if (declaredSemanticCoverage !== null && declaredSemanticCoverage !== semanticMultimodal) {
    issues.push(qualityIssue(
      'high',
      'semantic_map_coverage_mismatch',
      `Semantic-map coverage declares ${declaredSemanticCoverage} multimodal videos but ${semanticMultimodal} reconciled rows carry multimodal_mapped state.`,
      'Repair the semantic-map summary so declared and row-level coverage reconcile.',
    ));
  }

  const scheduledByItemId = new Map<string, MatchedScheduledAnalysis>();
  const scheduledAnalyses = arrayOrEmpty(pipelineRefresh.analyses);
  let scheduledReconciled = 0;
  for (const [index, entry] of scheduledAnalyses.entries()) {
    const row = object(entry, `scheduled analysis ${index}`);
    const item = matchContentItem(row, contentByPlatformPost, contentByCanonicalUrl);
    if (!item) continue;
    scheduledReconciled += 1;
    addAnalysisSource(analysisSourcesByItemId, item.item_id, 'scheduled_twelvelabs');
    scheduledByItemId.set(item.item_id, {
      item,
      competitor_key: competitorByItemId.get(item.item_id) ?? null,
      provider_observation: providerObservation(row),
    });
  }
  if (scheduledReconciled < scheduledAnalyses.length) issues.push(qualityIssue(
    'high',
    'scheduled_analysis_library_reconciliation_gap',
    `${scheduledReconciled} of ${scheduledAnalyses.length} scheduled analyses reconcile to the current library.`,
    'Preserve canonical_url, platform, and platform_post_id in each published scheduled analysis.',
  ));

  const reportRows = Object.values(recordOrEmpty(videoReports.reports))
    .map((entry) => recordOrEmpty(entry));
  let reconciledReports = 0;
  for (const report of reportRows) {
    const matched = matchGeneratedReport(
      report,
      contentByPlatformPost,
      contentByCanonicalUrl,
    );
    if (!matched) continue;
    reconciledReports += 1;
    addAnalysisSource(analysisSourcesByItemId, matched.item_id, 'generated_video_report');
  }
  if (reconciledReports < reportRows.length) issues.push(qualityIssue(
    'medium',
    'generated_report_library_reconciliation_gap',
    `${reconciledReports} of ${reportRows.length} generated video reports reconcile to the current library.`,
    'Preserve the source platform post ID in every generated video report.',
  ));

  const taxonomy = recordOrEmpty(semanticMap.taxonomy);
  const taxonomyMethod = nullableText(taxonomy.method);
  const taxonomyStatus = nullableText(taxonomy.observed_or_derived);
  if (!taxonomyMethod || !taxonomyStatus) issues.push(qualityIssue(
    'high',
    'taxonomy_provenance_missing',
    'The semantic map does not declare both taxonomy method and observed-versus-derived state.',
    'Publish taxonomy method and evidence state before presenting pattern labels to marketers.',
  ));

  const context: BuildContext = {
    generated_at: generatedAt,
    source_paths: sourcePaths,
    competitors,
    content_items: contentItems,
    competitor_by_item_id: competitorByItemId,
    analysis_sources_by_item_id: analysisSourcesByItemId,
    semantic_by_item_id: semanticByItemId,
    scheduled_by_item_id: scheduledByItemId,
    taxonomy_method: taxonomyMethod,
    taxonomy_status: taxonomyStatus,
  };
  const profiles = competitors
    .map((competitor) => buildProfile(competitor, context))
    .sort(compareProfiles);
  const priorityProfiles = profiles.filter((profile) => (
    profile.priority !== null && profile.priority <= 2
  ));
  const observedProfiles = profiles.filter((profile) => profile.coverage.observed_posts > 0);
  const priorityObservedProfiles = priorityProfiles.filter((profile) => profile.coverage.observed_posts > 0);
  const deepProfiles = profiles.filter((profile) => profile.coverage.deep_analyzed_posts > 0);
  const priorityDeepProfiles = priorityProfiles.filter((profile) => profile.coverage.deep_analyzed_posts > 0);
  const taxonomyProfiles = profiles.filter((profile) => profile.coverage.structured_taxonomy_posts > 0);

  if (priorityObservedProfiles.length < priorityProfiles.length) issues.push(qualityIssue(
    'high',
    'priority_competitor_content_gap',
    `${priorityObservedProfiles.length} of ${priorityProfiles.length} priority competitors have reconciled public content.`,
    'Collect the priority competitor queue, starting with known official social accounts.',
  ));
  if (priorityDeepProfiles.length < priorityObservedProfiles.length) issues.push(qualityIssue(
    'high',
    'priority_competitor_analysis_gap',
    `${priorityDeepProfiles.length} of ${priorityObservedProfiles.length} observed priority competitors have at least one reconciled deep analysis.`,
    'Analyze one eligible representative video per observed priority competitor before generalizing their creative strategy.',
  ));

  const noEligibleVideo = profiles
    .filter((profile) => (
      profile.coverage.observed_posts > 0
      && profile.coverage.deep_analyzed_posts === 0
      && profile.next_action.code === 'collect_eligible_video'
    ))
    .map((profile) => ({
      competitor: profile.name,
      observed_posts: profile.coverage.observed_posts,
      reason: profile.next_action.reason,
    }));
  if (noEligibleVideo.length > 0) issues.push(qualityIssue(
    'medium',
    'observed_competitor_without_eligible_video',
    `${noEligibleVideo.length} observed ${pluralize('competitor', noEligibleVideo.length)} ${
      noEligibleVideo.length === 1 ? 'has' : 'have'
    } no unanalyzed short or feed video eligible for deep analysis.`,
    'Collect an eligible public video; do not send image-only posts to the video-analysis provider.',
  ));

  const sourceLineage = buildSourceLineage(
    sourcePaths,
    core,
    universe,
    library,
    semanticMap,
    pipelineRefresh,
    videoReports,
  );
  const collectionQueue = profiles
    .filter((profile) => profile.coverage.observed_posts === 0)
    .map((profile) => ({
      competitor: profile.name,
      priority: profile.priority,
      coverage_state: profile.coverage.state,
      known_social_platforms: profile.known_socials.map((row) => row.platform),
      next_action: profile.next_action,
    }));
  const analysisQueue = profiles.flatMap((profile) => {
    const candidateId = profile.next_action.candidate_item_id;
    const candidate = candidateId
      ? profile.representative_posts.find((post) => post.item_id === candidateId)
      : undefined;
    if (!candidate) return [];
    const gap = profile.next_action.code === 'analyze_first_video'
      ? 'first_deep_analysis' as const
      : profile.next_action.code === 'analyze_high_signal_video'
        ? 'high_signal_analysis' as const
        : profile.next_action.code === 'expand_analysis_sample'
          ? 'expand_sample' as const
          : null;
    if (!gap) return [];
    return [{
      competitor: profile.name,
      priority: profile.priority,
      gap,
      item_id: candidate.item_id,
      platform: candidate.platform,
      content_type: candidate.content_type,
      canonical_url: candidate.canonical_url,
      signal: candidate.signal,
      comparison_percentile: candidate.comparison_percentile,
      selection_reason: analysisSelectionReason(profile, candidate, gap),
    }];
  }).sort((left, right) => (
    (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
    || analysisGapPriority(left.gap) - analysisGapPriority(right.gap)
    || signalPriority(left.signal) - signalPriority(right.signal)
    || (right.comparison_percentile ?? -1) - (left.comparison_percentile ?? -1)
    || left.competitor.localeCompare(right.competitor)
  ));
  const taxonomyNormalization = profiles
    .filter((profile) => (
      profile.coverage.deep_analyzed_posts > 0
      && profile.coverage.structured_taxonomy_posts === 0
    ))
    .map((profile) => ({
      competitor: profile.name,
      deep_analyzed_posts: profile.coverage.deep_analyzed_posts,
      structured_taxonomy_posts: profile.coverage.structured_taxonomy_posts,
      reason: 'Provider analysis exists, but it has not been normalized into the shared competitor taxonomy.',
    }));

  return {
    schema_version: 'viralbench_competitor_intelligence_profiles_v1',
    generated_at: generatedAt,
    status: issues.some((entry) => ['critical', 'high'].includes(entry.severity))
      ? 'partial'
      : 'ready',
    audience: 'marketing_team',
    summary: {
      active_competitors: profiles.length,
      priority_competitors: priorityProfiles.length,
      with_known_socials: profiles.filter((profile) => profile.known_socials.length > 0).length,
      with_observed_content: observedProfiles.length,
      priority_with_observed_content: priorityObservedProfiles.length,
      with_deep_analysis: deepProfiles.length,
      priority_with_deep_analysis: priorityDeepProfiles.length,
      with_structured_taxonomy: taxonomyProfiles.length,
      content_coverage: rate(observedProfiles.length, profiles.length),
      priority_content_coverage: rate(priorityObservedProfiles.length, priorityProfiles.length),
      deep_analysis_coverage: rate(deepProfiles.length, observedProfiles.length),
      priority_deep_analysis_coverage: rate(priorityDeepProfiles.length, priorityObservedProfiles.length),
      library_items: contentItems.length,
      semantic_map_videos: semanticVideos.length,
      semantic_map_multimodal_videos: semanticMultimodal,
      scheduled_analysis_records: scheduledAnalyses.length,
      generated_video_reports: reportRows.length,
      distinct_reconciled_deep_posts: analysisSourcesByItemId.size,
    },
    source_lineage: sourceLineage,
    profiles,
    queues: {
      collection: collectionQueue,
      analysis: analysisQueue,
      taxonomy_normalization: taxonomyNormalization,
      no_eligible_video: noEligibleVideo,
    },
    quality: { issues },
    evidence_boundaries: [
      'A competitor profile describes the bounded public sample currently collected; it is not the competitor’s complete strategy.',
      'Structured topic, audience, promise, proof, hook, format, and CTA labels are reproducible derived taxonomy, not human-coded ground truth.',
      'Performance percentiles compare posts only within compatible platform, content-type, and age cohorts; raw cross-platform ranking is disabled.',
      'A provider analysis establishes observed media evidence, not that a hook, style, edit, creator, or CTA caused distribution.',
      'Public competitor wording, footage, audio, people, and beat order remain research evidence and are not reusable creative assets.',
      'Metadata-only, uncollected, unreconciled, and provider-failed records remain explicit gaps rather than negative evidence.',
      'Only short_video and feed_video items enter the TwelveLabs analysis queue; image and carousel posts require a different analysis path.',
      'Owned marketing outcomes remain a separate evidence domain and are not inferred from competitor performance.',
    ],
  };
}

export function loadCompetitorProfileInputs(options: {
  root?: string;
  generated_at?: string;
  source_paths?: Partial<Record<CompetitorProfileSourceId, string>>;
} = {}): CompetitorProfileInputs {
  const root = path.resolve(options.root ?? process.cwd());
  const sourcePaths = { ...DEFAULT_SOURCE_PATHS, ...(options.source_paths ?? {}) };
  const required = Object.entries(sourcePaths) as Array<[CompetitorProfileSourceId, string]>;
  for (const [sourceId, relativePath] of required) {
    const target = path.resolve(root, relativePath);
    if (!fs.existsSync(target)) {
      throw new Error(`Required competitor-profile source is missing (${sourceId}): ${target}`);
    }
  }
  return {
    core_competitors: readJson(path.resolve(root, sourcePaths.core_competitors)),
    competitor_universe: readJson(path.resolve(root, sourcePaths.competitor_universe)),
    content_library: readJson(path.resolve(root, sourcePaths.content_library)),
    semantic_map: readJson(path.resolve(root, sourcePaths.semantic_map)),
    pipeline_refresh: readJson(path.resolve(root, sourcePaths.pipeline_refresh)),
    video_reports: readJson(path.resolve(root, sourcePaths.video_reports)),
    source_paths: sourcePaths,
    generated_at: options.generated_at,
  };
}

export function writeCompetitorIntelligenceProfiles(options: {
  root?: string;
  output_dir?: string;
  profiles: CompetitorIntelligenceProfiles;
}): {
  profiles: ArtifactDescriptor;
  manifest: ArtifactDescriptor;
} {
  const root = path.resolve(options.root ?? process.cwd());
  const outputDir = path.resolve(
    root,
    options.output_dir ?? '.semantic-artifacts/competitor-intelligence-profiles',
  );
  const profilePath = path.join(outputDir, 'competitor-profiles.json');
  const manifestPath = path.join(outputDir, 'build-manifest.json');
  atomicWriteJson(profilePath, options.profiles);
  const sources = options.profiles.source_lineage.map((source) => (
    describeArtifact(path.resolve(root, source.path), root)
  ));
  atomicWriteJson(manifestPath, {
    schema_version: 'viralbench_competitor_intelligence_profiles_build_v1',
    generated_at: options.profiles.generated_at,
    source_artifacts: sources,
    output_artifacts: {
      profiles: describeArtifact(profilePath, root),
    },
  });
  return {
    profiles: describeArtifact(profilePath, root),
    manifest: describeArtifact(manifestPath, root),
  };
}

function buildProfile(
  competitor: NormalizedCompetitor,
  context: BuildContext,
): CompetitorIntelligenceProfile {
  const items = context.content_items
    .filter((item) => context.competitor_by_item_id.get(item.item_id) === competitor.key)
    .sort(compareContentItems);
  const analyzedItems = items.filter((item) => (
    context.analysis_sources_by_item_id.has(item.item_id)
  ));
  const semanticRows = items
    .map((item) => context.semantic_by_item_id.get(item.item_id))
    .filter((row): row is MatchedSemanticVideo => (
      Boolean(row) && row?.semantic_state === 'multimodal_mapped'
    ));
  const highSignalItems = items.filter((item) => HIGH_SIGNAL_STATES.has(item.signal));
  const analyzedHighSignalItems = highSignalItems.filter((item) => (
    context.analysis_sources_by_item_id.has(item.item_id)
  ));
  const latestObservedAt = latestIso(items.map((item) => item.last_seen_at ?? item.posted_at));
  const patterns = Object.fromEntries(TAXONOMY_DIMENSIONS.map((dimension) => [
    dimension,
    distribution(
      semanticRows.map((row) => row.taxonomy[dimension]).filter((value): value is string => Boolean(value)),
    ),
  ])) as Partial<Record<TaxonomyDimension, DistributionRow[]>>;
  const sourceCounts: Record<AnalysisSource, number> = {
    semantic_map: 0,
    scheduled_twelvelabs: 0,
    generated_video_report: 0,
  };
  for (const item of analyzedItems) {
    for (const source of context.analysis_sources_by_item_id.get(item.item_id) ?? []) {
      sourceCounts[source] += 1;
    }
  }
  const limitations = profileLimitations({
    competitor,
    items,
    analyzedItems,
    semanticRows,
    highSignalItems,
    analyzedHighSignalItems,
    taxonomy_method: context.taxonomy_method,
    taxonomy_status: context.taxonomy_status,
  });
  const assessment = items.length === 0
    ? 'unobserved' as const
    : analyzedItems.length === 0
      ? 'metadata_only' as const
      : analyzedItems.length < 3 || semanticRows.length < 2
        ? 'thin' as const
        : 'directional' as const;
  const state = items.length === 0
    ? competitor.known_socials.length > 0
      ? 'known_socials_unobserved' as const
      : 'social_discovery_gap' as const
    : analyzedItems.length === 0
      ? 'observed_unanalyzed' as const
      : assessment === 'directional'
        ? 'deep_analysis_directional' as const
        : 'deep_analysis_thin' as const;
  const nextAction = profileNextAction({
    competitor,
    items,
    analyzedItems,
    semanticRows,
    highSignalItems,
    analyzedHighSignalItems,
  });
  const representativeItems = items.slice(0, 3);
  const candidateItem = nextAction.candidate_item_id
    ? items.find((item) => item.item_id === nextAction.candidate_item_id)
    : undefined;
  if (candidateItem && !representativeItems.some((item) => item.item_id === candidateItem.item_id)) {
    representativeItems.push(candidateItem);
  }
  const representativePosts = representativeItems
    .map((item) => representativePost(item, context));
  const percentiles = items
    .map((item) => item.comparison_percentile)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  return {
    competitor_id: slug(competitor.name),
    name: competitor.name,
    category: competitor.category,
    status: competitor.status,
    priority: competitor.priority,
    official_url: competitor.official_url,
    known_socials: competitor.known_socials,
    coverage: {
      known_social_platforms: competitor.known_socials.length,
      observed_platforms: [...new Set(items.map((item) => item.platform))].sort(),
      observed_posts: items.length,
      recent_posts_30d: items.filter((item) => (
        ['0_72_hours', '4_30_days'].includes(item.age_bucket)
      )).length,
      high_signal_posts: highSignalItems.length,
      repeated_capture_posts: items.filter((item) => item.observation_count >= 2).length,
      observed_velocity_posts: items.filter((item) => item.observed_velocity_per_hour !== null).length,
      deep_analyzed_posts: analyzedItems.length,
      structured_taxonomy_posts: semanticRows.length,
      deep_analysis_share: rate(analyzedItems.length, items.length),
      high_signal_analysis_share: rate(analyzedHighSignalItems.length, highSignalItems.length),
      latest_observed_at: latestObservedAt,
      state,
    },
    evidence_quality: {
      assessment,
      analysis_sources: sourceCounts,
      taxonomy_method: context.taxonomy_method,
      taxonomy_status: context.taxonomy_status,
      limitations,
    },
    performance: {
      comparison_basis: 'within_platform_content_type_and_age_cohort',
      median_comparison_percentile: median(percentiles),
      high_signal_share: rate(highSignalItems.length, items.length),
      by_signal: countBy(items.map((item) => item.signal)),
      analyzed_high_signal_posts: analyzedHighSignalItems.length,
    },
    patterns,
    representative_posts: representativePosts,
    next_action: nextAction,
  };
}

function representativePost(
  item: NormalizedContentItem,
  context: BuildContext,
): CompetitorRepresentativePost {
  const sources = [...(context.analysis_sources_by_item_id.get(item.item_id) ?? [])].sort();
  const semantic = context.semantic_by_item_id.get(item.item_id);
  const scheduled = context.scheduled_by_item_id.get(item.item_id);
  return {
    item_id: item.item_id,
    platform: item.platform,
    content_type: item.content_type,
    account_handle: item.account_handle,
    canonical_url: item.canonical_url,
    posted_at: item.posted_at,
    signal: item.signal,
    comparison_percentile: item.comparison_percentile,
    observed_velocity_per_hour: item.observed_velocity_per_hour,
    confidence: item.confidence,
    analyzed: sources.length > 0,
    analysis_sources: sources,
    structured_taxonomy: semantic?.semantic_state === 'multimodal_mapped'
      ? semantic.taxonomy
      : null,
    provider_observation: scheduled?.provider_observation
      ?? (semantic?.semantic_state === 'multimodal_mapped' ? semantic.provider_observation : null),
    evidence_limitations: item.evidence_limitations,
  };
}

function profileNextAction(input: {
  competitor: NormalizedCompetitor;
  items: NormalizedContentItem[];
  analyzedItems: NormalizedContentItem[];
  semanticRows: MatchedSemanticVideo[];
  highSignalItems: NormalizedContentItem[];
  analyzedHighSignalItems: NormalizedContentItem[];
}): CompetitorIntelligenceProfile['next_action'] {
  if (input.items.length === 0) {
    if (input.competitor.known_socials.length > 0) return {
      code: 'collect_known_socials',
      reason: 'Official or reviewed social accounts are known, but no current posts reconcile to the library.',
      candidate_item_id: null,
      candidate_url: null,
    };
    return {
      code: 'discover_official_socials',
      reason: 'No reviewed official social account is available for bounded content collection.',
      candidate_item_id: null,
      candidate_url: null,
    };
  }
  const eligible = input.items.filter((item) => (
    VIDEO_CONTENT_TYPES.has(item.content_type)
    && !input.analyzedItems.some((analyzed) => analyzed.item_id === item.item_id)
  ));
  const candidate = eligible[0];
  if (input.analyzedItems.length === 0) {
    return candidate ? {
      code: 'analyze_first_video',
      reason: 'Public content is collected, but no representative video has reconciled deep analysis.',
      candidate_item_id: candidate.item_id,
      candidate_url: candidate.canonical_url,
    } : {
      code: 'collect_eligible_video',
      reason: 'Collected posts are not eligible unanalyzed short or feed videos; collect a video before invoking TwelveLabs.',
      candidate_item_id: null,
      candidate_url: null,
    };
  }
  if (input.semanticRows.length === 0) return {
    code: 'normalize_scheduled_analysis',
    reason: 'Deep provider analysis exists, but none of it is represented in the shared structured competitor taxonomy.',
    candidate_item_id: null,
    candidate_url: null,
  };
  const highSignalCandidate = eligible.find((item) => HIGH_SIGNAL_STATES.has(item.signal));
  if (input.highSignalItems.length > input.analyzedHighSignalItems.length && highSignalCandidate) return {
    code: 'analyze_high_signal_video',
    reason: 'At least one high-signal post remains unanalyzed, so the profile may miss the competitor’s strongest observed creative.',
    candidate_item_id: highSignalCandidate.item_id,
    candidate_url: highSignalCandidate.canonical_url,
  };
  if (input.analyzedItems.length / input.items.length < 0.5 && candidate) return {
    code: 'expand_analysis_sample',
    reason: 'Less than half of collected posts have deep analysis; expand the sample before treating patterns as stable.',
    candidate_item_id: candidate.item_id,
    candidate_url: candidate.canonical_url,
  };
  return {
    code: 'monitor_and_refresh',
    reason: 'The current bounded profile has directional deep evidence; refresh collection and recheck emerging high-signal posts.',
    candidate_item_id: null,
    candidate_url: null,
  };
}

function profileLimitations(input: {
  competitor: NormalizedCompetitor;
  items: NormalizedContentItem[];
  analyzedItems: NormalizedContentItem[];
  semanticRows: MatchedSemanticVideo[];
  highSignalItems: NormalizedContentItem[];
  analyzedHighSignalItems: NormalizedContentItem[];
  taxonomy_method: string | null;
  taxonomy_status: string | null;
}): string[] {
  const limitations: string[] = [];
  if (input.items.length === 0) {
    limitations.push(input.competitor.known_socials.length > 0
      ? 'Known social accounts have no reconciled current content.'
      : 'Official social-account discovery is incomplete.');
    return limitations;
  }
  if (input.analyzedItems.length === 0) limitations.push(
    'No collected post has reconciled deep media analysis.',
  );
  if (input.analyzedItems.length > 0 && input.analyzedItems.length < 3) limitations.push(
    'Fewer than three posts have deep analysis; pattern evidence is thin.',
  );
  if (input.semanticRows.length === 0 && input.analyzedItems.length > 0) limitations.push(
    'Deep analysis exists outside the normalized structured taxonomy.',
  );
  if (input.highSignalItems.length > input.analyzedHighSignalItems.length) limitations.push(
    `${input.highSignalItems.length - input.analyzedHighSignalItems.length} high-signal posts remain unanalyzed.`,
  );
  if (input.items.filter((item) => item.observation_count >= 2).length < input.items.length) limitations.push(
    'Some posts have only one capture; observed velocity is unavailable or low-confidence for those posts.',
  );
  if (input.taxonomy_status === 'derived') limitations.push(
    `Structured labels are derived with ${input.taxonomy_method ?? 'an undeclared method'} and are not human-coded ground truth.`,
  );
  limitations.push(
    'Observed performance cannot establish that a creative pattern caused distribution.',
  );
  return limitations;
}

function normalizeContentItems(entries: unknown[]): NormalizedContentItem[] {
  const items = entries.map((entry, index): NormalizedContentItem => {
    const row = object(entry, `content item ${index}`);
    const performance = recordOrEmpty(row.performance);
    const itemId = text(row.item_id);
    const platform = normalizePlatform(row.platform);
    const platformPostId = text(row.platform_post_id);
    const canonicalUrl = httpsUrl(row.canonical_url);
    const accountHandle = text(row.account_handle);
    if (!itemId || !platform || !platformPostId || !canonicalUrl || !accountHandle) {
      throw new Error(`Content item ${index} is missing a required identity field`);
    }
    return {
      item_id: itemId,
      platform,
      content_type: text(row.content_type) || 'unknown',
      platform_post_id: platformPostId,
      canonical_url: canonicalUrl,
      account_handle: accountHandle,
      posted_at: isoDate(row.posted_at),
      last_seen_at: isoDate(row.last_seen_at),
      observation_count: nullableInteger(row.observation_count) ?? 0,
      age_bucket: text(performance.age_bucket) || 'unknown',
      signal: text(performance.signal) || 'unknown',
      comparison_percentile: nullableRate(performance.comparison_percentile),
      observed_velocity_per_hour: nullableNumber(performance.observed_view_velocity_per_hour),
      confidence: text(performance.confidence) || 'unknown',
      evidence_limitations: arrayOrEmpty(performance.evidence_limitations)
        .map(text)
        .filter(Boolean),
    };
  });
  const itemIds = new Set<string>();
  const platformPostIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.item_id)) throw new Error(`Duplicate content item_id: ${item.item_id}`);
    const platformPostKey = `${item.platform}:${item.platform_post_id}`;
    if (platformPostIds.has(platformPostKey)) {
      throw new Error(`Duplicate content platform-post identity: ${platformPostKey}`);
    }
    itemIds.add(item.item_id);
    platformPostIds.add(platformPostKey);
  }
  return items;
}

function mergeCompetitors(coreEntries: unknown[], expandedEntries: unknown[]): NormalizedCompetitor[] {
  const merged = new Map<string, JsonRecord>();
  for (const [index, entry] of [...coreEntries, ...expandedEntries].entries()) {
    const row = object(entry, `competitor ${index}`);
    const name = text(row.name);
    if (!name) throw new Error(`Competitor ${index} is missing name`);
    const key = normalizeName(name);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    merged.set(key, {
      ...row,
      ...existing,
      known_socials: {
        ...recordOrEmpty(row.known_socials),
        ...recordOrEmpty(existing.known_socials),
      },
      content_priority: row.content_priority === 'exclude' || existing.content_priority === 'exclude'
        ? 'exclude'
        : existing.content_priority ?? row.content_priority,
    });
  }
  return [...merged.entries()]
    .filter(([, row]) => row.content_priority !== 'exclude')
    .map(([key, row], index): NormalizedCompetitor => {
      const knownSocials = Object.entries(recordOrEmpty(row.known_socials))
        .flatMap(([rawPlatform, value]) => {
          const platform = normalizeSourcePlatform(rawPlatform);
          const handle = socialHandle(value);
          if (!platform || !handle) return [];
          return [{
            platform,
            handle,
            url: nullableHttpsUrl(value),
          }];
        })
        .sort((left, right) => (
          left.platform.localeCompare(right.platform)
          || left.handle.localeCompare(right.handle)
        ));
      return {
        key,
        name: text(row.name) || `Competitor ${index + 1}`,
        category: text(row.category) || 'uncategorized',
        status: text(row.status) || 'unknown',
        priority: nullableInteger(row.content_priority),
        official_url: nullableHttpsUrl(row.official_url),
        known_socials: knownSocials,
      };
    });
}

function buildHandleAssignments(
  competitors: NormalizedCompetitor[],
  issues: CompetitorIntelligenceProfiles['quality']['issues'],
): Map<string, string> {
  const assignments = new Map<string, Set<string>>();
  for (const competitor of competitors) {
    for (const social of competitor.known_socials) {
      const key = `${social.platform}:${normalizeHandle(social.handle)}`;
      const values = assignments.get(key) ?? new Set<string>();
      values.add(competitor.key);
      assignments.set(key, values);
    }
  }
  const result = new Map<string, string>();
  for (const [handle, competitorKeys] of assignments.entries()) {
    if (competitorKeys.size === 1) {
      result.set(handle, [...competitorKeys][0]);
      continue;
    }
    issues.push(qualityIssue(
      'high',
      'ambiguous_competitor_social_handle',
      `${handle} is assigned to ${competitorKeys.size} competitors and cannot be reconciled safely.`,
      'Correct the competitor registry so one platform handle resolves to one competitor.',
    ));
  }
  return result;
}

function matchContentItem(
  row: JsonRecord,
  byPlatformPost: Map<string, NormalizedContentItem>,
  byCanonicalUrl: Map<string, NormalizedContentItem>,
): NormalizedContentItem | null {
  const platform = normalizePlatform(row.platform);
  const explicitPostId = text(row.platform_post_id);
  const evidenceParts = text(row.evidence_id).split(':');
  const evidencePostId = evidenceParts.length >= 3 ? evidenceParts.at(-1) ?? '' : '';
  const postId = explicitPostId || evidencePostId;
  if (platform && postId) {
    const item = byPlatformPost.get(`${platform}:${postId}`);
    if (item) return item;
  }
  const url = nullableHttpsUrl(row.canonical_url);
  return url ? byCanonicalUrl.get(url) ?? null : null;
}

function matchGeneratedReport(
  row: JsonRecord,
  byPlatformPost: Map<string, NormalizedContentItem>,
  byCanonicalUrl: Map<string, NormalizedContentItem>,
): NormalizedContentItem | null {
  const direct = matchContentItem(row, byPlatformPost, byCanonicalUrl);
  if (direct) return direct;
  const match = /^live:([^:]+):([^:]+):/.exec(text(row.candidate_id));
  if (!match) return null;
  const platform = normalizePlatform(match[1]);
  const postId = match[2];
  return platform && postId
    ? byPlatformPost.get(`${platform}:${postId}`) ?? null
    : null;
}

function taxonomyFrom(row: JsonRecord): Partial<Record<TaxonomyDimension, string>> {
  return Object.fromEntries(TAXONOMY_DIMENSIONS.flatMap((dimension) => {
    const value = text(row[dimension]);
    return value ? [[dimension, value]] : [];
  })) as Partial<Record<TaxonomyDimension, string>>;
}

function providerObservation(
  row: JsonRecord,
): CompetitorRepresentativePost['provider_observation'] {
  const hook = recordOrEmpty(row.hook);
  const cta = recordOrEmpty(row.cta);
  const pacing = recordOrEmpty(row.pacing);
  const ctaText = text(cta.text);
  return {
    hook_observed: Boolean(text(hook.text)),
    cta_observed: Boolean(ctaText) && !/no explicit|no call to action|no cta/i.test(ctaText),
    styles: arrayOrEmpty(row.style).map(text).filter(Boolean).slice(0, 12),
    pacing_pattern: nullableText(pacing.pattern),
    visible_proof_count: arrayOrEmpty(row.visible_proof).length,
    claim_count: arrayOrEmpty(row.claims).length,
    limitation_count: arrayOrEmpty(row.evidence_limitations).length,
  };
}

function buildSourceLineage(
  paths: Record<CompetitorProfileSourceId, string>,
  core: JsonRecord,
  universe: JsonRecord,
  library: JsonRecord,
  semanticMap: JsonRecord,
  pipelineRefresh: JsonRecord,
  videoReports: JsonRecord,
): CompetitorIntelligenceProfiles['source_lineage'] {
  const row = (
    sourceId: CompetitorProfileSourceId,
    raw: JsonRecord,
    grain: string,
    authoritativeFor: string,
  ) => ({
    source_id: sourceId,
    path: paths[sourceId],
    generated_at: sourceTimestamp(raw),
    grain,
    authoritative_for: authoritativeFor,
  });
  return [
    row('core_competitors', core, 'one established competitor per row', 'established competitor identity and reviewed official accounts'),
    row('competitor_universe', universe, 'one expanded competitor per row', 'expanded competitor universe and collection priority'),
    row('content_library', library, 'one public post with one or more observations', 'current public post identity and compatible-cohort performance'),
    row('semantic_map', semanticMap, 'one semantically mapped public video per row', 'structured derived taxonomy and timestamp-grounded evidence state'),
    row('pipeline_refresh', pipelineRefresh, 'one latest scheduled provider analysis per row', 'latest scheduled TwelveLabs results and provider state'),
    row('video_reports', videoReports, 'one generated report per candidate identifier', 'generated deep-report lineage'),
  ];
}

function compareProfiles(
  left: CompetitorIntelligenceProfile,
  right: CompetitorIntelligenceProfile,
): number {
  return (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
    || coverageStatePriority(left.coverage.state) - coverageStatePriority(right.coverage.state)
    || right.coverage.observed_posts - left.coverage.observed_posts
    || left.name.localeCompare(right.name);
}

function compareContentItems(left: NormalizedContentItem, right: NormalizedContentItem): number {
  return signalPriority(left.signal) - signalPriority(right.signal)
    || (right.comparison_percentile ?? -1) - (left.comparison_percentile ?? -1)
    || (right.observed_velocity_per_hour ?? -1) - (left.observed_velocity_per_hour ?? -1)
    || (Date.parse(right.posted_at ?? '') || 0) - (Date.parse(left.posted_at ?? '') || 0)
    || left.item_id.localeCompare(right.item_id);
}

function analysisSelectionReason(
  profile: CompetitorIntelligenceProfile,
  candidate: CompetitorRepresentativePost,
  gap: 'first_deep_analysis' | 'high_signal_analysis' | 'expand_sample',
): string {
  const percentile = candidate.comparison_percentile === null
    ? 'compatible-cohort percentile unavailable'
    : `compatible-cohort percentile ${round(candidate.comparison_percentile * 100, 1)}`;
  if (gap === 'first_deep_analysis') {
    return `First eligible deep-analysis candidate for ${profile.name}; ${candidate.signal}; ${percentile}.`;
  }
  if (gap === 'high_signal_analysis') {
    return `Highest-ranked unanalyzed high-signal ${profile.name} video; ${candidate.signal}; ${percentile}.`;
  }
  return `Highest-ranked eligible post for expanding the ${profile.name} sample; ${candidate.signal}; ${percentile}.`;
}

function analysisGapPriority(value: 'first_deep_analysis' | 'high_signal_analysis' | 'expand_sample'): number {
  if (value === 'first_deep_analysis') return 0;
  if (value === 'high_signal_analysis') return 1;
  return 2;
}

function coverageStatePriority(value: CompetitorIntelligenceProfile['coverage']['state']): number {
  const priorities: Record<CompetitorIntelligenceProfile['coverage']['state'], number> = {
    observed_unanalyzed: 0,
    deep_analysis_thin: 1,
    known_socials_unobserved: 2,
    social_discovery_gap: 3,
    deep_analysis_directional: 4,
  };
  return priorities[value];
}

function signalPriority(value: string): number {
  const priorities: Record<string, number> = {
    breakout_candidate: 0,
    evergreen_winner: 1,
    high_performer: 2,
    promising: 3,
    baseline: 4,
    insufficient_data: 5,
  };
  return priorities[value] ?? 10;
}

function distribution(values: string[]): DistributionRow[] {
  const counts = countBy(values);
  return Object.entries(counts)
    .map(([value, count]) => ({
      value,
      count,
      share: rate(count, values.length) ?? 0,
    }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, 5);
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values.filter(Boolean)) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function addAnalysisSource(
  sources: Map<string, Set<AnalysisSource>>,
  itemId: string,
  source: AnalysisSource,
): void {
  const current = sources.get(itemId) ?? new Set<AnalysisSource>();
  current.add(source);
  sources.set(itemId, current);
}

function qualityIssue(
  severity: 'critical' | 'high' | 'medium' | 'low',
  code: string,
  message: string,
  nextAction: string,
): CompetitorIntelligenceProfiles['quality']['issues'][number] {
  return { severity, code, message, next_action: nextAction };
}

function resolveGeneratedAt(explicit: unknown, candidates: unknown[]): string {
  const explicitDate = isoDate(explicit);
  if (explicitDate) return explicitDate;
  const dates = candidates.map(isoDate).filter((value): value is string => Boolean(value));
  if (dates.length === 0) throw new Error('Competitor profiles require a valid source or explicit generated_at timestamp');
  return dates.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function sourceTimestamp(row: JsonRecord): string | null {
  return isoDate(
    row.generated_at
    ?? row.updated_at
    ?? row.last_completed_at
    ?? row.created_at,
  );
}

function latestIso(values: Array<string | null>): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  return dates.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? round(values[middle])
    : round((values[middle - 1] + values[middle]) / 2);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round(numerator / denominator) : null;
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function pluralize(value: string, count: number): string {
  return count === 1 ? value : `${value}s`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeHandle(value: string): string {
  return value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, '');
}

function normalizePlatform(value: unknown): string {
  return PLATFORM_ALIASES[text(value).toLowerCase()] ?? '';
}

function normalizeSourcePlatform(value: unknown): string {
  return SOURCE_PLATFORM_ALIASES[text(value).toLowerCase()] ?? '';
}

function socialHandle(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return normalizeHandle(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    return normalizeHandle(raw);
  }
}

function httpsUrl(value: unknown): string {
  return nullableHttpsUrl(value) ?? '';
}

function nullableHttpsUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function recordOrEmpty(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
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

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableInteger(value: unknown): number | null {
  const number = nullableNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function nullableRate(value: unknown): number | null {
  const number = nullableNumber(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
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
  const inputs = loadCompetitorProfileInputs({
    root,
    generated_at: args['generated-at'],
  });
  const profiles = buildCompetitorIntelligenceProfiles(inputs);
  const outputs = writeCompetitorIntelligenceProfiles({
    root,
    output_dir: args['output-dir'],
    profiles,
  });
  process.stdout.write(`${JSON.stringify({
    schema_version: profiles.schema_version,
    generated_at: profiles.generated_at,
    status: profiles.status,
    summary: profiles.summary,
    queue_counts: {
      collection: profiles.queues.collection.length,
      analysis: profiles.queues.analysis.length,
      taxonomy_normalization: profiles.queues.taxonomy_normalization.length,
      no_eligible_video: profiles.queues.no_eligible_video.length,
    },
    outputs,
  }, null, 2)}\n`);
}

if (require.main === module) runCli();
