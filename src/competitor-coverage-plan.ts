import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  atomicWriteJson,
  describeArtifact,
  type ArtifactDescriptor,
} from './artifact-integrity';

type JsonRecord = Record<string, unknown>;
type SupportedPlatform = 'instagram' | 'tiktok' | 'youtube_shorts';
type CollectionTaskType =
  | 'retry_failed_profile_collection'
  | 'add_profile_collection'
  | 'review_empty_collection_result'
  | 'review_source_candidates'
  | 'review_unsupported_source'
  | 'discover_official_sources';
type CollectionRoute =
  | 'apify_profile_collection'
  | 'source_result_review'
  | 'manual_source_review'
  | 'official_source_discovery';
type PriorRunState = 'succeeded' | 'failed' | 'not_reported';

const SUPPORTED_PLATFORMS = new Set<SupportedPlatform>([
  'instagram',
  'tiktok',
  'youtube_shorts',
]);
const DEFAULT_PATHS = {
  profiles: '.semantic-artifacts/competitor-intelligence-profiles/competitor-profiles.json',
  source_candidates: '.ops/competitor_research/internship-shortform-source-review-candidates-20260718.json',
  discovery_manifest: '.ops/competitor_research/scheduled-internship-broad-discovery-v1.json',
  discovery_report: '.semantic-artifacts/scheduled-research/current/broad-discovery.json',
  pipeline_refresh: 'internship-reels-site/data/pipeline-refresh.json',
} as const;

export type CoveragePlanSourceId = keyof typeof DEFAULT_PATHS;

export interface CompetitorCoveragePlanInputs {
  profiles: unknown;
  source_candidates: unknown;
  discovery_manifest: unknown;
  discovery_report: unknown;
  pipeline_refresh: unknown;
  source_paths?: Partial<Record<CoveragePlanSourceId, string>>;
  generated_at?: string;
}

export interface CollectionTask {
  task_id: string;
  competitor_id: string;
  competitor: string;
  priority: number | null;
  task_type: CollectionTaskType;
  route: CollectionRoute;
  platform: string | null;
  handle: string | null;
  source_url: string | null;
  prior_runs: Array<{
    run_id: string;
    state: PriorRunState;
  }>;
  candidate_sources: Array<{
    platform: SupportedPlatform;
    handle: string;
    url: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  reason: string;
  completion_evidence: string;
}

export interface AnalysisTask {
  competitor: string;
  priority: number | null;
  gap: 'first_deep_analysis' | 'high_signal_analysis' | 'expand_sample';
  item_id: string;
  platform: SupportedPlatform;
  content_type: 'short_video' | 'feed_video';
  canonical_url: string;
  signal: string;
  comparison_percentile: number | null;
  selection_reason: string;
}

export interface CompetitorCoverageOperationsPlan {
  schema_version: 'viralbench_competitor_coverage_operations_plan_v1';
  generated_at: string;
  status: 'ready' | 'partial' | 'blocked';
  audience: 'marketing_operations';
  summary: {
    active_competitors: number;
    priority_competitors: number;
    priority_with_observed_content: number;
    priority_with_deep_analysis: number;
    collection_gap_competitors: number;
    source_candidate_review_competitors: number;
    official_source_discovery_competitors: number;
    collection_tasks: number;
    provider_collection_tasks: number;
    source_review_tasks: number;
    analysis_tasks: number;
    analysis_waves: number;
    failed_profile_runs_to_recover: number;
    taxonomy_normalization_competitors: number;
    no_eligible_video_competitors: number;
    unattributed_configured_targets: number;
  };
  completion_contract: {
    collection: string;
    analysis: string;
    viral_tracking: string;
    evidence: string;
  };
  provider_guardrails: {
    apify: {
      max_total_usd_per_cycle: number | null;
      broad_discovery_ceiling_usd: number | null;
      selected_url_ceiling_usd: number | null;
      task_cost_estimates_available: false;
      rule: string;
    };
    twelvelabs: {
      max_total_usd_per_cycle: number | null;
      latest_cycle_analyzed_videos: number;
      latest_cycle_actual_or_conservative_usd: number | null;
      latest_cycle_average_usd_per_analysis: number | null;
      rule: string;
    };
    approval: {
      external_calls_authorized_by_this_plan: false;
      rule: string;
    };
  };
  collection: {
    tasks: CollectionTask[];
    waves: Array<{
      wave_id: string;
      objective: string;
      task_ids: string[];
      apify_ceiling_usd: number | null;
      execution_state: 'requires_reviewed_manifest';
    }>;
    prior_profile_runs: Array<{
      run_id: string;
      platform: SupportedPlatform;
      state: PriorRunState;
      configured_targets: number;
    }>;
    monitoring_recovery: Array<{
      run_id: string;
      platform: SupportedPlatform;
      registered_targets: number;
      registered_competitors: string[];
      unattributed_targets: number;
      reason: string;
      completion_evidence: string;
    }>;
    unattributed_configured_targets: Array<{
      platform: SupportedPlatform;
      handle: string;
      prior_runs: Array<{ run_id: string; state: PriorRunState }>;
      reason: string;
    }>;
  };
  analysis: {
    planning_capacity_basis: {
      items_per_wave: number;
      basis: 'latest_cycle_requested_urls';
      note: string;
    };
    waves: Array<{
      wave_id: string;
      objective: string;
      candidates: AnalysisTask[];
      estimated_cost_usd: number | null;
      max_twelvelabs_usd: number | null;
      budget_fit: boolean | null;
      estimate_basis: string;
      execution_state: 'requires_approved_url_manifest';
    }>;
    taxonomy_normalization: unknown[];
    no_eligible_video: unknown[];
  };
  source_lineage: Array<{
    source_id: CoveragePlanSourceId;
    path: string;
    generated_at: string | null;
    grain: string;
    authoritative_for: string;
  }>;
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

interface ProfileSource {
  platform: string;
  handle: string;
  url: string | null;
}

interface Profile {
  competitor_id: string;
  name: string;
  priority: number | null;
  known_socials: ProfileSource[];
  observed_posts: number;
}

interface ConfiguredTarget {
  platform: SupportedPlatform;
  handle: string;
  run_id: string;
  state: PriorRunState;
}

interface PriorProfileRun {
  run_id: string;
  platform: SupportedPlatform;
  state: PriorRunState;
  configured_targets: number;
}

interface SourceCandidateReview {
  competitor: string;
  review_state: 'candidate_sources_found' | 'no_verified_shortform_source_found';
  candidate_sources: CollectionTask['candidate_sources'];
}

export function buildCompetitorCoveragePlan(
  input: CompetitorCoveragePlanInputs,
): CompetitorCoverageOperationsPlan {
  const profilesArtifact = object(input.profiles, 'competitor profiles');
  const sourceCandidatesArtifact = object(input.source_candidates, 'source candidates');
  const discoveryManifest = object(input.discovery_manifest, 'discovery manifest');
  const discoveryReport = object(input.discovery_report, 'discovery report');
  const pipelineRefresh = object(input.pipeline_refresh, 'pipeline refresh');
  const sourcePaths = { ...DEFAULT_PATHS, ...(input.source_paths ?? {}) };
  const generatedAt = resolveGeneratedAt(input.generated_at, [
    profilesArtifact.generated_at,
    sourceCandidatesArtifact.generated_at,
    discoveryManifest.generated_at,
    discoveryManifest.created_at,
    discoveryReport.created_at,
    pipelineRefresh.generated_at,
    pipelineRefresh.updated_at,
    pipelineRefresh.last_completed_at,
  ]);
  const issues: CompetitorCoverageOperationsPlan['quality']['issues'] = [];
  const profiles = normalizeProfiles(array(profilesArtifact.profiles, 'profiles'));
  const profileByName = new Map(profiles.map((profile) => [profile.name, profile]));
  const sourceCandidateReviews = normalizeSourceCandidateReviews(
    array(sourceCandidatesArtifact.competitors, 'source candidate competitors'),
    profileByName,
  );
  const configured = configuredTargets(discoveryManifest, discoveryReport);
  const collectionQueue = array(
    object(profilesArtifact.queues, 'profile queues').collection,
    'collection queue',
  );
  const collectionTasks: CollectionTask[] = [];

  for (const [index, entry] of collectionQueue.entries()) {
    const row = object(entry, `collection queue row ${index}`);
    const competitorName = requiredText(row.competitor, `collection queue row ${index} competitor`);
    const profile = profileByName.get(competitorName);
    if (!profile) {
      throw new Error(`Collection queue references unknown competitor: ${competitorName}`);
    }
    if (profile.observed_posts > 0) {
      throw new Error(`Collection queue competitor already has observed posts: ${competitorName}`);
    }
    if (profile.known_socials.length === 0) {
      const candidateReview = sourceCandidateReviews.get(profile.name);
      if (candidateReview?.candidate_sources.length) {
        collectionTasks.push({
          task_id: taskId(profile.competitor_id, 'source-candidate-review', null),
          competitor_id: profile.competitor_id,
          competitor: profile.name,
          priority: profile.priority,
          task_type: 'review_source_candidates',
          route: 'source_result_review',
          platform: null,
          handle: null,
          source_url: null,
          prior_runs: [],
          candidate_sources: candidateReview.candidate_sources,
          reason: `${candidateReview.candidate_sources.length} public short-form source ${plural('candidate', candidateReview.candidate_sources.length)} await registry review.`,
          completion_evidence: 'Each candidate is promoted to the reviewed source registry or rejected with dated evidence and a reason.',
        });
        continue;
      }
      collectionTasks.push({
        task_id: taskId(profile.competitor_id, 'source-discovery', null),
        competitor_id: profile.competitor_id,
        competitor: profile.name,
        priority: profile.priority,
        task_type: 'discover_official_sources',
        route: 'official_source_discovery',
        platform: null,
        handle: null,
        source_url: null,
        prior_runs: [],
        candidate_sources: [],
        reason: 'No reviewed official social source is registered for this competitor.',
        completion_evidence: 'A reviewed official source URL is registered or an explicit no-public-source/access-limited state is recorded.',
      });
      continue;
    }
    for (const source of profile.known_socials) {
      collectionTasks.push(collectionTask(profile, source, configured.targets));
    }
  }
  ensureUnique(collectionTasks.map((task) => task.task_id), 'collection task_id');
  collectionTasks.sort(compareCollectionTasks);

  const knownSourceKeys = new Set(
    profiles.flatMap((profile) => profile.known_socials.map((source) => (
      sourceKey(source.platform, source.handle)
    ))),
  );
  const unattributed = groupConfiguredTargets(
    configured.targets.filter((target) => (
      !knownSourceKeys.has(sourceKey(target.platform, target.handle))
    )),
  );
  const profilesBySourceKey = new Map<string, Profile>();
  for (const profile of profiles) {
    for (const source of profile.known_socials) {
      profilesBySourceKey.set(sourceKey(source.platform, source.handle), profile);
    }
  }
  const monitoringRecovery = configured.runs
    .filter((run) => run.state === 'failed')
    .map((run) => {
      const runTargets = configured.targets.filter((target) => target.run_id === run.run_id);
      const registeredProfiles = [...new Map(runTargets.flatMap((target) => {
        const profile = profilesBySourceKey.get(sourceKey(target.platform, target.handle));
        return profile ? [[profile.competitor_id, profile] as const] : [];
      })).values()].sort((left, right) => left.name.localeCompare(right.name));
      return {
        run_id: run.run_id,
        platform: run.platform,
        registered_targets: registeredProfiles.length,
        registered_competitors: registeredProfiles.map((profile) => profile.name),
        unattributed_targets: runTargets.filter((target) => (
          !profilesBySourceKey.has(sourceKey(target.platform, target.handle))
        )).length,
        reason: 'The recurring profile-monitoring run failed, so current viral tracking for its configured accounts is incomplete.',
        completion_evidence: 'A reviewed rerun completes inside the approved cap and reconciles every configured target or preserves an itemized failure.',
      };
    });
  if (configured.failedRuns > 0) {
    issues.push(issue(
      'high',
      'profile_collection_runs_failed',
      `${configured.failedRuns} configured profile collection ${plural('run', configured.failedRuns)} failed in the latest discovery report.`,
      'Repair or rebudget the failed run before treating its configured accounts as collected.',
    ));
  }
  if (unattributed.length > 0) {
    issues.push(issue(
      'medium',
      'configured_targets_missing_from_source_registry',
      `${unattributed.length} configured profile ${plural('target', unattributed.length)} do not exactly reconcile to a reviewed competitor source.`,
      'Review each handle and either register its official ownership, correct drift, or explicitly reject it.',
    ));
  }

  const analysisQueue = normalizeAnalysisQueue(
    array(object(profilesArtifact.queues, 'profile queues').analysis, 'analysis queue'),
  );
  const pipelineBudget = recordOrEmpty(pipelineRefresh.budget);
  const pipelineProviders = recordOrEmpty(pipelineRefresh.providers);
  const twelveLabs = recordOrEmpty(pipelineProviders.twelvelabs);
  const pipelineSource = recordOrEmpty(pipelineRefresh.source);
  const waveCapacity = positiveInteger(pipelineSource.requested_urls) ?? 10;
  const analyzedVideos = nonNegativeInteger(twelveLabs.analyzed_videos) ?? 0;
  const twelveLabsActual = nonNegativeNumber(twelveLabs.actual_or_conservative_usd);
  const averageAnalysisCost = analyzedVideos > 0 && twelveLabsActual !== null
    ? round(twelveLabsActual / analyzedVideos)
    : null;
  const maxTwelveLabs = nonNegativeNumber(pipelineBudget.max_twelvelabs_usd);
  const analysisWaves = chunk(analysisQueue, waveCapacity).map((candidates, index) => {
    const estimate = averageAnalysisCost === null
      ? null
      : round(averageAnalysisCost * candidates.length);
    const budgetFit = estimate === null || maxTwelveLabs === null
      ? null
      : estimate <= maxTwelveLabs + 1e-9;
    if (budgetFit === false) {
      issues.push(issue(
        'critical',
        'analysis_wave_exceeds_current_twelvelabs_cap',
        `Analysis wave ${index + 1} estimates ${estimate} USD against a ${maxTwelveLabs} USD cap.`,
        'Reduce the wave or obtain a separately approved budget before execution.',
      ));
    }
    return {
      wave_id: `analysis-wave-${index + 1}`,
      objective: index === 0
        ? 'Close first-analysis gaps first, then cover the strongest unanalyzed signals.'
        : 'Finish the remaining bounded analysis backlog after the prior wave reconciles.',
      candidates,
      estimated_cost_usd: estimate,
      max_twelvelabs_usd: maxTwelveLabs,
      budget_fit: budgetFit,
      estimate_basis: averageAnalysisCost === null
        ? 'No usable latest-cycle average; execution must rely on the provider cap.'
        : `Latest cycle actual-or-conservative average: ${averageAnalysisCost} USD per completed analysis; this is planning evidence, not a quote.`,
      execution_state: 'requires_approved_url_manifest' as const,
    };
  });

  const queues = object(profilesArtifact.queues, 'profile queues');
  const taxonomyNormalization = array(queues.taxonomy_normalization, 'taxonomy normalization queue');
  const noEligibleVideo = array(queues.no_eligible_video, 'no eligible video queue');
  const summary = object(profilesArtifact.summary, 'profile summary');
  const collectionGapCompetitors = new Set(collectionTasks.map((task) => task.competitor_id)).size;
  const sourceDiscoveryCompetitors = new Set(collectionTasks
    .filter((task) => task.task_type === 'discover_official_sources')
    .map((task) => task.competitor_id)).size;
  const sourceCandidateReviewCompetitors = new Set(collectionTasks
    .filter((task) => task.task_type === 'review_source_candidates')
    .map((task) => task.competitor_id)).size;
  const providerTasks = collectionTasks.filter((task) => task.route === 'apify_profile_collection');
  const reviewTasks = collectionTasks.filter((task) => task.route !== 'apify_profile_collection');

  if (collectionGapCompetitors > 0) {
    issues.push(issue(
      'high',
      'competitor_collection_backlog_open',
      `${collectionGapCompetitors} competitors still lack reconciled content.`,
      'Execute reviewed collection waves and record explicit access-limited states where collection is not possible.',
    ));
  }
  if (analysisQueue.length > 0) {
    issues.push(issue(
      'high',
      'competitor_analysis_backlog_open',
      `${analysisQueue.length} eligible videos remain in the prioritized deep-analysis queue.`,
      'Execute approved analysis waves and reconcile every success or failure to the source item identity.',
    ));
  }
  const unsupportedTasks = collectionTasks.filter((task) => (
    task.task_type === 'review_unsupported_source'
  ));
  if (unsupportedTasks.length > 0) {
    issues.push(issue(
      'medium',
      'known_sources_outside_current_profile_collectors',
      `${unsupportedTasks.length} known source ${plural('route', unsupportedTasks.length)} use platforms outside the configured Instagram, TikTok, and YouTube profile collectors.`,
      'Review these sources manually or add a separately tested, policy-approved collector path.',
    ));
  }

  const critical = issues.some((entry) => entry.severity === 'critical');
  const incomplete = collectionGapCompetitors > 0
    || analysisQueue.length > 0
    || taxonomyNormalization.length > 0
    || noEligibleVideo.length > 0
    || unattributed.length > 0;
  const maxApify = nonNegativeNumber(pipelineBudget.max_apify_usd);
  const broadDiscoveryCeiling = nonNegativeNumber(pipelineBudget.apify_discovery_ceiling_usd)
    ?? nonNegativeNumber(discoveryManifest.max_total_charge_usd);
  const selectedUrlCeiling = nonNegativeNumber(pipelineBudget.apify_selected_url_ceiling_usd);

  return {
    schema_version: 'viralbench_competitor_coverage_operations_plan_v1',
    generated_at: generatedAt,
    status: critical ? 'blocked' : incomplete ? 'partial' : 'ready',
    audience: 'marketing_operations',
    summary: {
      active_competitors: nonNegativeInteger(summary.active_competitors) ?? profiles.length,
      priority_competitors: nonNegativeInteger(summary.priority_competitors) ?? 0,
      priority_with_observed_content: nonNegativeInteger(summary.priority_with_observed_content) ?? 0,
      priority_with_deep_analysis: nonNegativeInteger(summary.priority_with_deep_analysis) ?? 0,
      collection_gap_competitors: collectionGapCompetitors,
      source_candidate_review_competitors: sourceCandidateReviewCompetitors,
      official_source_discovery_competitors: sourceDiscoveryCompetitors,
      collection_tasks: collectionTasks.length,
      provider_collection_tasks: providerTasks.length,
      source_review_tasks: reviewTasks.length,
      analysis_tasks: analysisQueue.length,
      analysis_waves: analysisWaves.length,
      failed_profile_runs_to_recover: monitoringRecovery.length,
      taxonomy_normalization_competitors: taxonomyNormalization.length,
      no_eligible_video_competitors: noEligibleVideo.length,
      unattributed_configured_targets: unattributed.length,
    },
    completion_contract: {
      collection: 'Every priority competitor has reconciled current public content or a reviewed access-limited/no-public-source state with dated evidence.',
      analysis: 'Every observed priority competitor has at least one reconciled eligible deep analysis, or an item-level provider failure remains explicit.',
      viral_tracking: 'High-signal ranking uses compatible platform/content-type/age cohorts and repeated captures where available; cross-platform raw-count ranking remains disabled.',
      evidence: 'Source identity, provider outcome, cost, and analysis lineage reconcile to the current library before marketing claims are published.',
    },
    provider_guardrails: {
      apify: {
        max_total_usd_per_cycle: maxApify,
        broad_discovery_ceiling_usd: broadDiscoveryCeiling,
        selected_url_ceiling_usd: selectedUrlCeiling,
        task_cost_estimates_available: false,
        rule: 'Collection tasks are not costed individually because current evidence does not support reliable per-profile estimates; the approved manifest ceiling remains authoritative.',
      },
      twelvelabs: {
        max_total_usd_per_cycle: maxTwelveLabs,
        latest_cycle_analyzed_videos: analyzedVideos,
        latest_cycle_actual_or_conservative_usd: twelveLabsActual,
        latest_cycle_average_usd_per_analysis: averageAnalysisCost,
        rule: 'Wave estimates use the latest cycle average only for planning and never replace the hard provider cap or item-level reconciliation.',
      },
      approval: {
        external_calls_authorized_by_this_plan: false,
        rule: 'This artifact is an operations backlog, not an approved provider request. External collection or analysis still requires the existing reviewed manifest and budget gates.',
      },
    },
    collection: {
      tasks: collectionTasks,
      waves: buildCollectionWaves(collectionTasks, maxApify),
      prior_profile_runs: configured.runs,
      monitoring_recovery: monitoringRecovery,
      unattributed_configured_targets: unattributed,
    },
    analysis: {
      planning_capacity_basis: {
        items_per_wave: waveCapacity,
        basis: 'latest_cycle_requested_urls',
        note: 'This reproduces the latest reviewed cycle size for planning; it is not asserted as a provider limit.',
      },
      waves: analysisWaves,
      taxonomy_normalization: taxonomyNormalization,
      no_eligible_video: noEligibleVideo,
    },
    source_lineage: sourceLineage(
      sourcePaths,
      profilesArtifact,
      sourceCandidatesArtifact,
      discoveryManifest,
      discoveryReport,
      pipelineRefresh,
    ),
    quality: { issues },
    evidence_boundaries: [
      'The plan describes unresolved work from current artifacts; it does not prove that a source has no content or that a provider will return content.',
      'A successful profile run with no reconciled post triggers source/result review instead of an automatic paid rerun.',
      'A failed configured run remains failed evidence; its accounts are not counted as collected.',
      'Failed recurring profile runs remain explicit monitoring-recovery work even when a competitor already has older observed content.',
      'Configured handles that do not exactly match the reviewed source registry remain unattributed and cannot silently establish competitor ownership.',
      'Public-web source candidates remain review work and do not become authoritative collection identities until the registry accepts them.',
      'Facebook and discovery-link sources remain visible, but they are not routed into the currently configured Instagram, TikTok, or YouTube profile collectors.',
      'Only short_video and feed_video items with explicit current-library identities can enter an analysis wave.',
      'Latest-cycle average cost is a planning estimate, not a provider quote, invoice, authorization, or guarantee.',
      'No external provider call, publication, or account change is authorized or performed by this artifact.',
    ],
  };
}

export function loadCompetitorCoveragePlanInputs(options: {
  root?: string;
  generated_at?: string;
  source_paths?: Partial<Record<CoveragePlanSourceId, string>>;
} = {}): CompetitorCoveragePlanInputs {
  const root = path.resolve(options.root ?? process.cwd());
  const sourcePaths = { ...DEFAULT_PATHS, ...(options.source_paths ?? {}) };
  for (const [sourceId, relativePath] of Object.entries(sourcePaths) as Array<
    [CoveragePlanSourceId, string]
  >) {
    const target = path.resolve(root, relativePath);
    if (!fs.existsSync(target)) {
      throw new Error(`Required coverage-plan source is missing (${sourceId}): ${target}`);
    }
  }
  return {
    profiles: readJson(path.resolve(root, sourcePaths.profiles)),
    source_candidates: readJson(path.resolve(root, sourcePaths.source_candidates)),
    discovery_manifest: readJson(path.resolve(root, sourcePaths.discovery_manifest)),
    discovery_report: readJson(path.resolve(root, sourcePaths.discovery_report)),
    pipeline_refresh: readJson(path.resolve(root, sourcePaths.pipeline_refresh)),
    source_paths: sourcePaths,
    generated_at: options.generated_at,
  };
}

export function writeCompetitorCoveragePlan(options: {
  root?: string;
  output_dir?: string;
  plan: CompetitorCoverageOperationsPlan;
}): {
  plan: ArtifactDescriptor;
  manifest: ArtifactDescriptor;
} {
  const root = path.resolve(options.root ?? process.cwd());
  const outputDir = path.resolve(
    root,
    options.output_dir ?? '.semantic-artifacts/competitor-intelligence-profiles',
  );
  const planPath = path.join(outputDir, 'coverage-plan.json');
  const manifestPath = path.join(outputDir, 'coverage-plan-build-manifest.json');
  atomicWriteJson(planPath, options.plan);
  atomicWriteJson(manifestPath, {
    schema_version: 'viralbench_competitor_coverage_operations_plan_build_v1',
    generated_at: options.plan.generated_at,
    source_artifacts: options.plan.source_lineage.map((source) => (
      describeArtifact(path.resolve(root, source.path), root)
    )),
    output_artifacts: {
      plan: describeArtifact(planPath, root),
    },
  });
  return {
    plan: describeArtifact(planPath, root),
    manifest: describeArtifact(manifestPath, root),
  };
}

function normalizeProfiles(entries: unknown[]): Profile[] {
  const profiles = entries.map((entry, index): Profile => {
    const row = object(entry, `profile ${index}`);
    const coverage = object(row.coverage, `profile ${index} coverage`);
    const socials = array(row.known_socials, `profile ${index} known_socials`)
      .map((source, sourceIndex): ProfileSource => {
        const social = object(source, `profile ${index} source ${sourceIndex}`);
        return {
          platform: requiredText(social.platform, `profile ${index} source platform`),
          handle: requiredText(social.handle, `profile ${index} source handle`),
          url: nullableHttpsUrl(social.url),
        };
      });
    return {
      competitor_id: requiredText(row.competitor_id, `profile ${index} competitor_id`),
      name: requiredText(row.name, `profile ${index} name`),
      priority: nullableInteger(row.priority),
      known_socials: socials,
      observed_posts: nonNegativeInteger(coverage.observed_posts) ?? 0,
    };
  });
  ensureUnique(profiles.map((profile) => profile.competitor_id), 'profile competitor_id');
  ensureUnique(profiles.map((profile) => profile.name), 'profile name');
  const sourceOwners = new Map<string, string>();
  for (const profile of profiles) {
    for (const source of profile.known_socials) {
      const key = sourceKey(source.platform, source.handle);
      const owner = sourceOwners.get(key);
      if (owner && owner !== profile.competitor_id) {
        throw new Error(`Ambiguous reviewed source identity ${key}: ${owner}, ${profile.competitor_id}`);
      }
      sourceOwners.set(key, profile.competitor_id);
    }
  }
  return profiles;
}

function normalizeSourceCandidateReviews(
  entries: unknown[],
  profiles: Map<string, Profile>,
): Map<string, SourceCandidateReview> {
  const reviews = entries.map((entry, index): SourceCandidateReview => {
    const row = object(entry, `source candidate review ${index}`);
    const competitor = requiredText(row.competitor, `source candidate review ${index} competitor`);
    if (!profiles.has(competitor)) {
      throw new Error(`Source candidate review references unknown competitor: ${competitor}`);
    }
    const reviewState = text(row.review_state);
    if (!['candidate_sources_found', 'no_verified_shortform_source_found'].includes(reviewState)) {
      throw new Error(`Source candidate review ${competitor} has invalid review_state`);
    }
    const candidates = array(row.candidate_sources, `source candidate review ${competitor} sources`)
      .map((entry, sourceIndex): CollectionTask['candidate_sources'][number] => {
        const source = object(entry, `source candidate review ${competitor} source ${sourceIndex}`);
        const platform = text(source.platform);
        if (!SUPPORTED_PLATFORMS.has(platform as SupportedPlatform)) {
          throw new Error(`Source candidate review ${competitor} uses unsupported platform: ${platform}`);
        }
        const confidence = text(source.confidence);
        if (!['high', 'medium', 'low'].includes(confidence)) {
          throw new Error(`Source candidate review ${competitor} has invalid confidence`);
        }
        return {
          platform: platform as SupportedPlatform,
          handle: requiredText(source.handle, `source candidate review ${competitor} handle`),
          url: requiredHttpsUrl(source.url, `source candidate review ${competitor} URL`),
          confidence: confidence as 'high' | 'medium' | 'low',
        };
      });
    if (reviewState === 'candidate_sources_found' && candidates.length === 0) {
      throw new Error(`Source candidate review ${competitor} declares candidates but has none`);
    }
    if (reviewState === 'no_verified_shortform_source_found' && candidates.length > 0) {
      throw new Error(`Source candidate review ${competitor} has candidates in a no-source state`);
    }
    ensureUnique(
      candidates.map((candidate) => sourceKey(candidate.platform, candidate.handle)),
      `source candidate identity for ${competitor}`,
    );
    return {
      competitor,
      review_state: reviewState as SourceCandidateReview['review_state'],
      candidate_sources: candidates,
    };
  });
  ensureUnique(reviews.map((review) => review.competitor), 'source candidate competitor');
  const owners = new Map<string, string>();
  for (const profile of profiles.values()) {
    for (const source of profile.known_socials) {
      owners.set(sourceKey(source.platform, source.handle), profile.name);
    }
  }
  for (const review of reviews) {
    for (const candidate of review.candidate_sources) {
      const key = sourceKey(candidate.platform, candidate.handle);
      const owner = owners.get(key);
      if (owner && owner !== review.competitor) {
        throw new Error(`Ambiguous source candidate identity ${key}: ${owner}, ${review.competitor}`);
      }
      owners.set(key, review.competitor);
    }
  }
  return new Map(reviews.map((review) => [review.competitor, review]));
}

function configuredTargets(
  manifest: JsonRecord,
  report: JsonRecord,
): {
  targets: ConfiguredTarget[];
  runs: PriorProfileRun[];
  failedRuns: number;
} {
  const outcomes = new Map<string, PriorRunState>();
  for (const entry of arrayOrEmpty(report.runs)) {
    const row = object(entry, 'discovery report run');
    const id = requiredText(row.id, 'discovery report run id');
    outcomes.set(id, text(row.status).toUpperCase() === 'SUCCEEDED' ? 'succeeded' : 'failed');
  }
  for (const entry of arrayOrEmpty(report.errors)) {
    const row = object(entry, 'discovery report error');
    const id = requiredText(row.id, 'discovery report error id');
    outcomes.set(id, 'failed');
  }
  const targets: ConfiguredTarget[] = [];
  const runs: PriorProfileRun[] = [];
  for (const entry of array(manifest.runs, 'discovery manifest runs')) {
    const row = object(entry, 'discovery manifest run');
    if (text(row.input_mode) !== 'profile') continue;
    const runId = requiredText(row.id, 'discovery manifest run id');
    const platform = platformFromActor(row.actor_id);
    if (!platform) continue;
    const runInput = object(row.input, `discovery manifest run ${runId} input`);
    const handles = platform === 'tiktok'
      ? arrayOrEmpty(runInput.profiles).map(normalizeHandle).filter(Boolean)
      : arrayOrEmpty(runInput.directUrls).map(sourceHandle).filter(Boolean);
    const state = outcomes.get(runId) ?? 'not_reported';
    runs.push({
      run_id: runId,
      platform,
      state,
      configured_targets: new Set(handles).size,
    });
    for (const handle of new Set(handles)) {
      targets.push({ platform, handle, run_id: runId, state });
    }
  }
  runs.sort((left, right) => left.run_id.localeCompare(right.run_id));
  return {
    targets,
    runs,
    failedRuns: runs.filter((run) => run.state === 'failed').length,
  };
}

function collectionTask(
  profile: Profile,
  source: ProfileSource,
  configured: ConfiguredTarget[],
): CollectionTask {
  const refs = configured
    .filter((target) => sourceKey(target.platform, target.handle) === (
      sourceKey(source.platform, source.handle)
    ))
    .map((target) => ({ run_id: target.run_id, state: target.state }))
    .sort((left, right) => left.run_id.localeCompare(right.run_id));
  const supported = SUPPORTED_PLATFORMS.has(source.platform as SupportedPlatform);
  const failed = refs.some((ref) => ref.state === 'failed');
  const succeeded = refs.some((ref) => ref.state === 'succeeded');
  const taskType: CollectionTaskType = !supported
    ? 'review_unsupported_source'
    : failed
      ? 'retry_failed_profile_collection'
      : succeeded
        ? 'review_empty_collection_result'
        : 'add_profile_collection';
  const route: CollectionRoute = !supported
    ? 'manual_source_review'
    : failed || !succeeded
      ? 'apify_profile_collection'
      : 'source_result_review';
  const reason = taskType === 'review_unsupported_source'
    ? `The ${source.platform} source is known but has no configured profile collector in the current scheduled manifest.`
    : taskType === 'retry_failed_profile_collection'
      ? 'This official source was configured in a failed profile run and therefore has not been collected successfully.'
      : taskType === 'review_empty_collection_result'
        ? 'A profile run succeeded, but this competitor still has no reconciled current content; verify source identity, activity, window, and result mapping before rerunning.'
        : 'This reviewed source is not covered by a configured profile run.';
  const completionEvidence = taskType === 'review_empty_collection_result'
    ? 'A reviewed finding records inactive/no eligible content, identity correction, mapping repair, access limitation, or a newly reconciled post.'
    : taskType === 'review_unsupported_source'
      ? 'A manual dated review or separately approved collector produces a reconciled post or explicit access/no-content state.'
      : 'A reviewed provider run reconciles at least one post or records an itemized failure/access-limited state.';
  return {
    task_id: taskId(profile.competitor_id, taskType, source.platform),
    competitor_id: profile.competitor_id,
    competitor: profile.name,
    priority: profile.priority,
    task_type: taskType,
    route,
    platform: source.platform,
    handle: source.handle,
    source_url: source.url,
    prior_runs: refs,
    candidate_sources: [],
    reason,
    completion_evidence: completionEvidence,
  };
}

function normalizeAnalysisQueue(entries: unknown[]): AnalysisTask[] {
  const rows = entries.map((entry, index): AnalysisTask => {
    const row = object(entry, `analysis queue row ${index}`);
    const platform = text(row.platform);
    const contentType = text(row.content_type);
    const gap = text(row.gap);
    if (!SUPPORTED_PLATFORMS.has(platform as SupportedPlatform)) {
      throw new Error(`Analysis queue row ${index} uses unsupported platform: ${platform}`);
    }
    if (!['short_video', 'feed_video'].includes(contentType)) {
      throw new Error(`Analysis queue row ${index} is not an eligible video: ${contentType}`);
    }
    if (!['first_deep_analysis', 'high_signal_analysis', 'expand_sample'].includes(gap)) {
      throw new Error(`Analysis queue row ${index} has invalid gap: ${gap}`);
    }
    return {
      competitor: requiredText(row.competitor, `analysis queue row ${index} competitor`),
      priority: nullableInteger(row.priority),
      gap: gap as AnalysisTask['gap'],
      item_id: requiredText(row.item_id, `analysis queue row ${index} item_id`),
      platform: platform as SupportedPlatform,
      content_type: contentType as AnalysisTask['content_type'],
      canonical_url: requiredHttpsUrl(row.canonical_url, `analysis queue row ${index} canonical_url`),
      signal: requiredText(row.signal, `analysis queue row ${index} signal`),
      comparison_percentile: nullableRate(row.comparison_percentile),
      selection_reason: requiredText(
        row.selection_reason,
        `analysis queue row ${index} selection_reason`,
      ),
    };
  });
  ensureUnique(rows.map((row) => row.item_id), 'analysis queue item_id');
  return rows.sort(compareAnalysisTasks);
}

function buildCollectionWaves(
  tasks: CollectionTask[],
  maxApifyUsd: number | null,
): CompetitorCoverageOperationsPlan['collection']['waves'] {
  const definitions = [
    {
      id: 'collection-wave-1-priority-one-provider',
      objective: 'Add uncovered profile routes for priority-one competitors after the failed monitoring runs are separately repaired.',
      include: (task: CollectionTask) => (
        task.priority === 1 && task.route === 'apify_profile_collection'
      ),
    },
    {
      id: 'collection-wave-2-priority-two-provider',
      objective: 'Close provider-ready collection gaps for priority-two competitors.',
      include: (task: CollectionTask) => (
        task.priority === 2 && task.route === 'apify_profile_collection'
      ),
    },
    {
      id: 'collection-wave-3-lower-priority-provider',
      objective: 'Cover remaining provider-ready lower-priority sources after higher-priority reconciliation.',
      include: (task: CollectionTask) => (
        (task.priority === null || task.priority > 2)
        && task.route === 'apify_profile_collection'
      ),
    },
    {
      id: 'collection-wave-4-source-review',
      objective: 'Resolve source candidates, successful-but-empty results, unsupported platforms, and missing-source states without blind paid reruns.',
      include: (task: CollectionTask) => task.route !== 'apify_profile_collection',
    },
  ];
  return definitions.flatMap((definition) => {
    const taskIds = tasks.filter(definition.include).map((task) => task.task_id);
    return taskIds.length > 0 ? [{
      wave_id: definition.id,
      objective: definition.objective,
      task_ids: taskIds,
      apify_ceiling_usd: definition.id.includes('provider') ? maxApifyUsd : 0,
      execution_state: 'requires_reviewed_manifest' as const,
    }] : [];
  });
}

function groupConfiguredTargets(
  targets: ConfiguredTarget[],
): CompetitorCoverageOperationsPlan['collection']['unattributed_configured_targets'] {
  const grouped = new Map<string, ConfiguredTarget[]>();
  for (const target of targets) {
    const key = sourceKey(target.platform, target.handle);
    grouped.set(key, [...(grouped.get(key) ?? []), target]);
  }
  return [...grouped.values()].map((rows) => ({
    platform: rows[0].platform,
    handle: rows[0].handle,
    prior_runs: rows
      .map((row) => ({ run_id: row.run_id, state: row.state }))
      .sort((left, right) => left.run_id.localeCompare(right.run_id)),
    reason: 'Configured collection identity does not exactly match a reviewed source identity; ownership remains unproven.',
  })).sort((left, right) => (
    left.platform.localeCompare(right.platform) || left.handle.localeCompare(right.handle)
  ));
}

function sourceLineage(
  paths: Record<CoveragePlanSourceId, string>,
  profiles: JsonRecord,
  sourceCandidates: JsonRecord,
  manifest: JsonRecord,
  report: JsonRecord,
  refresh: JsonRecord,
): CompetitorCoverageOperationsPlan['source_lineage'] {
  const row = (
    sourceId: CoveragePlanSourceId,
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
    row('profiles', profiles, 'one competitor profile plus explicit work queues', 'competitor identity, current coverage, evidence quality, and next action'),
    row('source_candidates', sourceCandidates, 'one bounded public-web source review per unresolved competitor', 'review candidates and explicit inconclusive source searches'),
    row('discovery_manifest', manifest, 'one configured provider run', 'configured profile targets and charge ceilings'),
    row('discovery_report', report, 'one completed run plus itemized failures', 'latest execution outcomes and reported/conservative cost'),
    row('pipeline_refresh', refresh, 'one published scheduled cycle', 'current cycle caps, analysis throughput, and provider state'),
  ];
}

function compareCollectionTasks(left: CollectionTask, right: CollectionTask): number {
  return (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
    || collectionTaskPriority(left.task_type) - collectionTaskPriority(right.task_type)
    || left.competitor.localeCompare(right.competitor)
    || (left.platform ?? '').localeCompare(right.platform ?? '');
}

function compareAnalysisTasks(left: AnalysisTask, right: AnalysisTask): number {
  return analysisGapPriority(left.gap) - analysisGapPriority(right.gap)
    || (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
    || (right.comparison_percentile ?? -1) - (left.comparison_percentile ?? -1)
    || left.competitor.localeCompare(right.competitor)
    || left.item_id.localeCompare(right.item_id);
}

function analysisGapPriority(value: AnalysisTask['gap']): number {
  if (value === 'first_deep_analysis') return 0;
  if (value === 'high_signal_analysis') return 1;
  return 2;
}

function collectionTaskPriority(value: CollectionTaskType): number {
  const values: Record<CollectionTaskType, number> = {
    retry_failed_profile_collection: 0,
    add_profile_collection: 1,
    review_empty_collection_result: 2,
    review_source_candidates: 3,
    discover_official_sources: 4,
    review_unsupported_source: 5,
  };
  return values[value];
}

function taskId(competitorId: string, taskType: string, platform: string | null): string {
  return [competitorId, taskType, platform].filter(Boolean).join(':');
}

function platformFromActor(value: unknown): SupportedPlatform | null {
  const actor = text(value).toLowerCase();
  if (actor.includes('tiktok')) return 'tiktok';
  if (actor.includes('instagram')) return 'instagram';
  if (actor.includes('youtube')) return 'youtube_shorts';
  return null;
}

function sourceKey(platform: string, handle: string): string {
  return `${platform}:${normalizeHandle(handle)}`;
}

function sourceHandle(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return normalizeHandle(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    return normalizeHandle(raw);
  }
}

function normalizeHandle(value: unknown): string {
  return text(value).toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, '');
}

function issue(
  severity: 'critical' | 'high' | 'medium' | 'low',
  code: string,
  message: string,
  nextAction: string,
): CompetitorCoverageOperationsPlan['quality']['issues'][number] {
  return { severity, code, message, next_action: nextAction };
}

function ensureUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function resolveGeneratedAt(explicit: unknown, candidates: unknown[]): string {
  const explicitDate = isoDate(explicit);
  if (explicitDate) return explicitDate;
  const dates = candidates.map(isoDate).filter((value): value is string => Boolean(value));
  if (dates.length === 0) {
    throw new Error('Coverage plan requires a valid source or explicit generated_at timestamp');
  }
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

function plural(value: string, count: number): string {
  return count === 1 ? value : `${value}s`;
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
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

function requiredText(value: unknown, label: string): string {
  const result = text(value);
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const result = nullableInteger(value);
  return result !== null && result >= 0 ? result : null;
}

function positiveInteger(value: unknown): number | null {
  const result = nullableInteger(value);
  return result !== null && result > 0 ? result : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function nullableRate(value: unknown): number | null {
  const result = nonNegativeNumber(value);
  return result !== null && result <= 1 ? result : null;
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

function requiredHttpsUrl(value: unknown, label: string): string {
  const result = nullableHttpsUrl(value);
  if (!result) throw new Error(`${label} must be a valid HTTPS URL`);
  return result;
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
  const inputs = loadCompetitorCoveragePlanInputs({
    root,
    generated_at: args['generated-at'],
  });
  const plan = buildCompetitorCoveragePlan(inputs);
  const outputs = writeCompetitorCoveragePlan({
    root,
    output_dir: args['output-dir'],
    plan,
  });
  process.stdout.write(`${JSON.stringify({
    schema_version: plan.schema_version,
    generated_at: plan.generated_at,
    status: plan.status,
    summary: plan.summary,
    outputs,
  }, null, 2)}\n`);
}

if (require.main === module) runCli();
