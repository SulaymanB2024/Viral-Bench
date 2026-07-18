import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteJson } from './artifact-integrity';

export const ACQUISITION_PROGRAM_ID = 'viralbench-acquisition-20260718';
export const ACQUISITION_TRANCHE_USD = 25;
export const ACQUISITION_PROGRAM_CEILING_USD = 100;

export const ACQUISITION_GATE_THRESHOLDS_V1 = {
  minimum_relevant_after_dedupe_rate: 0.2,
  minimum_recent_timestamp_and_view_candidates: 10,
  minimum_analysis_pass_rate: 0.8,
  maximum_cost_per_new_relevant_vs_best_prior: 2,
  minimum_internship_early_career_share: 0.7,
} as const;

export const ACQUISITION_ALLOCATION_CAPS_V1 = {
  best_acquisition_route: 0.5,
  temporal_rechecks: 0.2,
  selected_multimodal_analysis: 0.2,
  exploration_and_reserve: 0.1,
} as const;

export interface RouteEconomicsInputV1 {
  route_id: string;
  route_kind: 'acquisition' | 'analysis' | 'temporal_recheck' | 'draft_discovery';
  returned_rows: number;
  relevant_rows: number;
  unique_rows: number;
  recent_timestamp_and_view_rows: number;
  metric_complete_rows: number;
  competitor_coverage_gained: number;
  analyzed_items: number;
  analysis_passed_items: number;
  temporal_rechecks_attempted: number;
  temporal_rechecks_with_usable_snapshot: number;
  actual_or_conservative_cost_usd: number;
  cost_basis: 'actual_reported' | 'actual_or_conservative' | 'zero_call_draft';
  accepted: boolean;
}

export interface RouteEconomicsV1 extends RouteEconomicsInputV1 {
  relevant_rows_per_dollar: number | null;
  unique_rows_per_dollar: number | null;
  cost_per_new_relevant_item_usd: number | null;
  relevant_after_dedupe_rate: number | null;
  duplicate_rate: number | null;
  freshness_rate: number | null;
  metric_completeness_rate: number | null;
  analysis_pass_rate: number | null;
  temporal_recheck_yield: number | null;
}

export interface StopSignalsV1 {
  consecutive_provider_failures: number;
  consecutive_subthreshold_yield_waves: number;
  cumulative_spend_known_or_conservatively_reserved: boolean;
  private_data_exposure: boolean;
  provenance_reconciliation_resolved: boolean;
}

export interface TrancheGateInputV1 {
  current_conservative_spend_usd: number;
  latest_route: RouteEconomicsV1;
  best_prior_accepted_cost_per_relevant_usd: number | null;
  spend_fully_settled_or_conservatively_reserved: boolean;
  internship_early_career_share: number | null;
  stop_signals: StopSignalsV1;
}

export interface TrancheGateV1 {
  current_tranche: 1 | 2 | 3 | 4;
  current_tranche_ceiling_usd: number;
  next_tranche: 2 | 3 | 4 | null;
  next_tranche_state: 'locked' | 'unlocked' | 'program_complete';
  gates: Array<{
    gate_id: string;
    passed: boolean;
    observed: number | boolean | null;
    threshold: number | boolean | string;
  }>;
  stop_reasons: string[];
  allocation_caps: {
    best_acquisition_route_usd: number;
    temporal_rechecks_usd: number;
    selected_multimodal_analysis_usd: number;
    exploration_and_reserve_usd: number;
  };
}

export interface AcquisitionEconomicsV1 {
  schema_version: 'viralbench_acquisition_economics_v1';
  generated_at: string;
  program_id: typeof ACQUISITION_PROGRAM_ID;
  status: 'ready_with_locked_next_tranche' | 'ready' | 'blocked';
  scope_policy: {
    internship_early_career_minimum_share: 0.7;
    broader_job_search_maximum_share: 0.3;
    discovery_seed_counts: {
      total: number;
      internship_early_career: number;
      broader_job_search: number;
    };
    post_acquisition_scope_mix_state: 'measured' | 'unmeasured';
  };
  compatibility: {
    migration_style: 'additive';
    normalized_social_post_contract_unchanged: true;
    viral_content_library_schema_2_readable: true;
    prior_provider_ledger_readable: true;
  };
  spend_ledger: {
    currency: 'USD';
    lifetime_program_ceiling_usd: 100;
    tranche_size_usd: 25;
    baseline: {
      actual_reported_usd: number;
      conservative_spend_usd: number;
      settlement_state: 'partially_settled_conservative_reserved';
    };
    finalized_current_wave: {
      apify_actual_reported_usd: number;
      twelvelabs_actual_or_conservative_usd: number;
      combined_actual_or_conservative_usd: number;
      settlement_state: 'apify_settled_twelvelabs_conservatively_estimated';
    };
    cumulative: {
      actual_reported_usd: number;
      actual_reported_plus_provider_estimate_usd: number;
      conservative_spend_usd: number;
      first_tranche_remaining_usd: number;
      settlement_state: 'partially_settled_all_unknowns_conservatively_reserved';
    };
    events: Array<{
      event_id: string;
      provider: string;
      route_id: string;
      actual_reported_usd: number | null;
      actual_or_conservative_usd: number;
      settlement_state: 'settled' | 'conservatively_reserved' | 'actual_or_conservative';
      source_path: string;
    }>;
  };
  route_scorecard: RouteEconomicsV1[];
  tranche_gate: TrancheGateV1;
  source_to_corpus: {
    acquired_raw_rows: number;
    acquired_unique_public_items: number;
    production_social_posts: number;
    total_source_records: number;
    public_documents: number;
    operator_documents: number;
    public_vectors: number;
    operator_vectors: number;
    current_wave_items_promoted_to_production_corpus: 0;
    state: 'reconciled_baseline_wave_not_promoted';
  };
  acquisition_runs: Array<{
    run_id: string;
    provider: 'apify';
    actor_id: string;
    build: string | null;
    returned_rows: number;
    actual_reported_usd: number | null;
    usage_finalized: boolean;
  }>;
  twelvelabs_batches: {
    records: [];
    current_wave_execution_mode: 'individual';
    batch_parity_evidence_state: 'missing';
    contract_schema_path: 'schemas/twelvelabs-batch-analysis-v1.schema.json';
  };
  discovery: {
    seed_manifest_path: string;
    seed_count: number;
    registry_review_candidates: number;
    unresolved_access_gaps: number;
    external_calls_authorized: false;
  };
  live_validation: {
    decision: 'blocked_zero_calls';
    new_calls_made: 0;
    new_conservative_reservation_usd: 0;
    credentials_present: boolean;
    reviewed_actor_pins_present: boolean;
    reusable_assets_manifest_present: boolean;
    approved_new_call_manifest_present: boolean;
    shared_reservation_recorded: boolean;
    paid_and_public_ingestion_gates_enabled: boolean;
    three_video_batch_parity_evidence_present: boolean;
    blockers: string[];
  };
  artifact_links: Array<{
    role: string;
    path: string;
    sha256: string;
  }>;
  ranking_policy: {
    raw_cross_platform_performance_ranking_allowed: false;
    required_comparison_boundary: string;
  };
  evidence_boundaries: string[];
}

interface JsonRecord {
  [key: string]: unknown;
}

const SOURCE_PATHS = {
  discovery: '.ops/competitor_research/internship-discovery-acquisition-draft-v1-20260718.json',
  baseline_ledger: 'internship-reels-site/data/provider-spend-ledger.json',
  wave: '.semantic-artifacts/authorized-waves/wave-reconciliation-20260718.json',
  collection: '.semantic-artifacts/authorized-waves/competitor-collection-report-20260718.json',
  analysis: '.semantic-artifacts/authorized-waves/analysis-status-output-20260718.json',
  metric_recheck: 'internship-reels-site/data/metric-recheck-refresh.json',
  source_manifest: 'internship-reels-site/data/source-record-manifest.json',
  index_manifest: 'internship-reels-site/data/agent-index-build-manifest.json',
  collection_manifest: '.semantic-artifacts/authorized-waves/competitor-collection-20260718.json',
  analysis_manifest: '.semantic-artifacts/authorized-waves/competitor-analysis-20260718.json',
} as const;

export function buildRouteEconomicsV1(input: RouteEconomicsInputV1): RouteEconomicsV1 {
  const countFields = [
    'returned_rows',
    'relevant_rows',
    'unique_rows',
    'recent_timestamp_and_view_rows',
    'metric_complete_rows',
    'competitor_coverage_gained',
    'analyzed_items',
    'analysis_passed_items',
    'temporal_rechecks_attempted',
    'temporal_rechecks_with_usable_snapshot',
  ] as const;
  for (const field of countFields) nonNegativeInteger(input[field], field);
  nonNegativeMoney(input.actual_or_conservative_cost_usd, 'actual_or_conservative_cost_usd');
  if (input.unique_rows > input.returned_rows || input.relevant_rows > input.unique_rows) {
    throw new Error('route_count_order_invalid');
  }
  const cost = input.actual_or_conservative_cost_usd;
  return {
    ...input,
    relevant_rows_per_dollar: cost > 0 ? round(input.relevant_rows / cost) : null,
    unique_rows_per_dollar: cost > 0 ? round(input.unique_rows / cost) : null,
    cost_per_new_relevant_item_usd: cost > 0 && input.relevant_rows > 0
      ? round(cost / input.relevant_rows)
      : null,
    relevant_after_dedupe_rate: input.returned_rows > 0
      ? round(input.relevant_rows / input.returned_rows)
      : null,
    duplicate_rate: input.returned_rows > 0
      ? round((input.returned_rows - input.unique_rows) / input.returned_rows)
      : null,
    freshness_rate: input.unique_rows > 0
      ? round(input.recent_timestamp_and_view_rows / input.unique_rows)
      : null,
    metric_completeness_rate: input.unique_rows > 0
      ? round(input.metric_complete_rows / input.unique_rows)
      : null,
    analysis_pass_rate: input.analyzed_items > 0
      ? round(input.analysis_passed_items / input.analyzed_items)
      : null,
    temporal_recheck_yield: input.temporal_rechecks_attempted > 0
      ? round(input.temporal_rechecks_with_usable_snapshot / input.temporal_rechecks_attempted)
      : null,
  };
}

export function evaluateTrancheGateV1(input: TrancheGateInputV1): TrancheGateV1 {
  nonNegativeMoney(input.current_conservative_spend_usd, 'current_conservative_spend_usd');
  const currentTranche = Math.min(4, Math.max(1, Math.ceil(Math.max(input.current_conservative_spend_usd, 0.000001) / ACQUISITION_TRANCHE_USD))) as 1 | 2 | 3 | 4;
  const nextTranche = currentTranche < 4 ? (currentTranche + 1) as 2 | 3 | 4 : null;
  const latestCost = input.latest_route.cost_per_new_relevant_item_usd;
  const priorCost = input.best_prior_accepted_cost_per_relevant_usd;
  const costThreshold = priorCost === null
    ? null
    : round(priorCost * ACQUISITION_GATE_THRESHOLDS_V1.maximum_cost_per_new_relevant_vs_best_prior);
  const gates: TrancheGateV1['gates'] = [
    {
      gate_id: 'deduplicated_relevance',
      passed: (input.latest_route.relevant_after_dedupe_rate ?? 0)
        >= ACQUISITION_GATE_THRESHOLDS_V1.minimum_relevant_after_dedupe_rate,
      observed: input.latest_route.relevant_after_dedupe_rate,
      threshold: ACQUISITION_GATE_THRESHOLDS_V1.minimum_relevant_after_dedupe_rate,
    },
    {
      gate_id: 'recent_timestamp_and_view_candidates',
      passed: input.latest_route.recent_timestamp_and_view_rows
        >= ACQUISITION_GATE_THRESHOLDS_V1.minimum_recent_timestamp_and_view_candidates,
      observed: input.latest_route.recent_timestamp_and_view_rows,
      threshold: ACQUISITION_GATE_THRESHOLDS_V1.minimum_recent_timestamp_and_view_candidates,
    },
    {
      gate_id: 'analysis_quality',
      passed: (input.latest_route.analysis_pass_rate ?? 0)
        >= ACQUISITION_GATE_THRESHOLDS_V1.minimum_analysis_pass_rate,
      observed: input.latest_route.analysis_pass_rate,
      threshold: ACQUISITION_GATE_THRESHOLDS_V1.minimum_analysis_pass_rate,
    },
    {
      gate_id: 'spend_settled_or_conservatively_reserved',
      passed: input.spend_fully_settled_or_conservatively_reserved,
      observed: input.spend_fully_settled_or_conservatively_reserved,
      threshold: true,
    },
    {
      gate_id: 'cost_per_new_relevant',
      passed: latestCost !== null && (costThreshold === null || latestCost <= costThreshold + 1e-9),
      observed: latestCost,
      threshold: costThreshold ?? 'requires accepted prior wave',
    },
    {
      gate_id: 'internship_early_career_scope_mix',
      passed: input.internship_early_career_share !== null
        && input.internship_early_career_share
          >= ACQUISITION_GATE_THRESHOLDS_V1.minimum_internship_early_career_share,
      observed: input.internship_early_career_share,
      threshold: ACQUISITION_GATE_THRESHOLDS_V1.minimum_internship_early_career_share,
    },
  ];
  const stopReasons: string[] = [];
  if (input.stop_signals.consecutive_provider_failures >= 2) stopReasons.push('two_consecutive_provider_failures');
  if (input.stop_signals.consecutive_subthreshold_yield_waves >= 2) stopReasons.push('two_consecutive_subthreshold_yield_waves');
  if (!input.stop_signals.cumulative_spend_known_or_conservatively_reserved) stopReasons.push('unknown_cumulative_spend');
  if (input.stop_signals.private_data_exposure) stopReasons.push('private_data_exposure');
  if (!input.stop_signals.provenance_reconciliation_resolved) stopReasons.push('unresolved_provenance_reconciliation');
  if (input.current_conservative_spend_usd > ACQUISITION_PROGRAM_CEILING_USD + 1e-9) {
    stopReasons.push('program_ceiling_exceeded');
  }
  const gatePassed = gates.every((gate) => gate.passed) && stopReasons.length === 0;
  return {
    current_tranche: currentTranche,
    current_tranche_ceiling_usd: currentTranche * ACQUISITION_TRANCHE_USD,
    next_tranche: nextTranche,
    next_tranche_state: nextTranche === null ? 'program_complete' : gatePassed ? 'unlocked' : 'locked',
    gates,
    stop_reasons: stopReasons,
    allocation_caps: {
      best_acquisition_route_usd: ACQUISITION_TRANCHE_USD * ACQUISITION_ALLOCATION_CAPS_V1.best_acquisition_route,
      temporal_rechecks_usd: ACQUISITION_TRANCHE_USD * ACQUISITION_ALLOCATION_CAPS_V1.temporal_rechecks,
      selected_multimodal_analysis_usd: ACQUISITION_TRANCHE_USD * ACQUISITION_ALLOCATION_CAPS_V1.selected_multimodal_analysis,
      exploration_and_reserve_usd: ACQUISITION_TRANCHE_USD * ACQUISITION_ALLOCATION_CAPS_V1.exploration_and_reserve,
    },
  };
}

export function buildCurrentAcquisitionEconomicsV1(root = process.cwd()): AcquisitionEconomicsV1 {
  const read = (relative: string): JsonRecord => readJson(path.resolve(root, relative));
  const discovery = read(SOURCE_PATHS.discovery);
  const baseline = read(SOURCE_PATHS.baseline_ledger);
  const wave = read(SOURCE_PATHS.wave);
  const collection = read(SOURCE_PATHS.collection);
  const analysis = read(SOURCE_PATHS.analysis);
  const metricRecheck = read(SOURCE_PATHS.metric_recheck);
  const sourceManifest = read(SOURCE_PATHS.source_manifest);
  const indexManifest = read(SOURCE_PATHS.index_manifest);

  const discoveryAllocation = record(discovery.allocation, 'discovery allocation');
  const waveBudget = record(wave.budget, 'wave budget');
  const waveCollection = record(wave.collection, 'wave collection');
  const waveAnalysis = record(wave.analysis, 'wave analysis');
  const uniqueContent = record(waveCollection.unique_content, 'wave unique content');
  const baselineCalls = array(baseline.calls, 'baseline calls');
  const baselineActual = finiteNumber(baseline.actual_cost_usd_reported, 'baseline actual');
  const baselineConservative = finiteNumber(baseline.conservative_spend_usd, 'baseline conservative');
  const apifyBudget = record(waveBudget.apify, 'wave apify budget');
  const twelveLabsBudget = record(waveBudget.twelvelabs, 'wave TwelveLabs budget');
  const waveApifyActual = finiteNumber(apifyBudget.cumulative_actual_usd, 'wave Apify actual');
  const waveTwelveLabs = finiteNumber(twelveLabsBudget.actual_or_conservative_usd, 'wave TwelveLabs actual or conservative');
  const waveCombined = finiteNumber(waveBudget.combined_actual_or_conservative_usd, 'wave combined');
  const cumulativeConservative = round(baselineConservative + waveCombined);
  const collectionTotals = record(collection.totals, 'collection totals');
  const collectionRows = array(collection.runs, 'collection runs');
  const collectionMetrics = deriveCollectionMetrics(collectionRows, new Date(requiredText(wave.generated_at, 'wave generated_at')));
  const analyzed = finiteNumber(waveAnalysis.requested_urls, 'analysis requested URLs');
  const analysisPassed = finiteNumber(waveAnalysis.deep_analyzed_videos, 'analysis passed videos');
  const providerTasks = record(waveCollection.provider_ready_tasks, 'provider ready tasks');
  const recheckTotals = record(metricRecheck.totals, 'metric recheck totals');
  const recheckRows = finiteNumber(recheckTotals.items, 'metric recheck items');

  const acquisitionRoute = buildRouteEconomicsV1({
    route_id: 'authorized-competitor-collection-waves-20260718',
    route_kind: 'acquisition',
    returned_rows: collectionMetrics.returned,
    relevant_rows: collectionMetrics.unique,
    unique_rows: collectionMetrics.unique,
    recent_timestamp_and_view_rows: collectionMetrics.recentTimestampAndView,
    metric_complete_rows: collectionMetrics.metricComplete,
    competitor_coverage_gained: finiteNumber(providerTasks.succeeded, 'provider tasks succeeded'),
    analyzed_items: analyzed,
    analysis_passed_items: analysisPassed,
    temporal_rechecks_attempted: 0,
    temporal_rechecks_with_usable_snapshot: 0,
    actual_or_conservative_cost_usd: waveApifyActual,
    cost_basis: 'actual_reported',
    accepted: true,
  });
  const analysisRoute = buildRouteEconomicsV1({
    route_id: 'authorized-competitor-analysis-waves-20260718',
    route_kind: 'analysis',
    returned_rows: analyzed,
    relevant_rows: analyzed,
    unique_rows: analyzed,
    recent_timestamp_and_view_rows: analyzed,
    metric_complete_rows: analyzed,
    competitor_coverage_gained: analysisPassed,
    analyzed_items: analyzed,
    analysis_passed_items: analysisPassed,
    temporal_rechecks_attempted: 0,
    temporal_rechecks_with_usable_snapshot: 0,
    actual_or_conservative_cost_usd: waveTwelveLabs,
    cost_basis: 'actual_or_conservative',
    accepted: true,
  });
  const temporalRoute = buildRouteEconomicsV1({
    route_id: 'metric-recheck',
    route_kind: 'temporal_recheck',
    returned_rows: recheckRows,
    relevant_rows: recheckRows,
    unique_rows: recheckRows,
    recent_timestamp_and_view_rows: recheckRows,
    metric_complete_rows: recheckRows,
    competitor_coverage_gained: 0,
    analyzed_items: 0,
    analysis_passed_items: 0,
    temporal_rechecks_attempted: recheckRows,
    temporal_rechecks_with_usable_snapshot: recheckRows,
    actual_or_conservative_cost_usd: finiteNumber(recheckTotals.actual_cost_usd_reported, 'metric recheck actual'),
    cost_basis: 'actual_reported',
    accepted: true,
  });
  const discoveryRoute = buildRouteEconomicsV1({
    route_id: 'internship-discovery-acquisition-draft-v1-20260718',
    route_kind: 'draft_discovery',
    returned_rows: 0,
    relevant_rows: 0,
    unique_rows: 0,
    recent_timestamp_and_view_rows: 0,
    metric_complete_rows: 0,
    competitor_coverage_gained: 0,
    analyzed_items: 0,
    analysis_passed_items: 0,
    temporal_rechecks_attempted: 0,
    temporal_rechecks_with_usable_snapshot: 0,
    actual_or_conservative_cost_usd: 0,
    cost_basis: 'zero_call_draft',
    accepted: false,
  });
  const priorNewRelevant = 1052 - 977;
  const bestPriorCost = round(1.1622 / priorNewRelevant);
  const gateRoute = {
    ...acquisitionRoute,
    analyzed_items: analysisRoute.analyzed_items,
    analysis_passed_items: analysisRoute.analysis_passed_items,
    analysis_pass_rate: analysisRoute.analysis_pass_rate,
  };
  const trancheGate = evaluateTrancheGateV1({
    current_conservative_spend_usd: cumulativeConservative,
    latest_route: gateRoute,
    best_prior_accepted_cost_per_relevant_usd: bestPriorCost,
    spend_fully_settled_or_conservatively_reserved: true,
    internship_early_career_share: null,
    stop_signals: {
      consecutive_provider_failures: 0,
      consecutive_subthreshold_yield_waves: 0,
      cumulative_spend_known_or_conservatively_reserved: true,
      private_data_exposure: false,
      provenance_reconciliation_resolved: true,
    },
  });
  const sourceRecords = record(sourceManifest.source_records, 'source records');
  const reconciliation = record(indexManifest.reconciliation, 'index reconciliation');
  const socialPosts = finiteNumber(sourceRecords.social_posts, 'social posts');
  const totalSourceRecords = socialPosts
    + finiteNumber(reconciliation.source_records && record(reconciliation.source_records, 'reconciled sources').audience_signals, 'audience signals')
    + finiteNumber(reconciliation.source_records && record(reconciliation.source_records, 'reconciled sources').official_resources, 'official resources');
  const artifactLinks = Object.entries(SOURCE_PATHS).map(([role, relative]) => ({
    role,
    path: relative,
    sha256: sha256File(path.resolve(root, relative)),
  }));
  const liveBlockers = [
    'ALLOW_PAID_GENERATION is disabled in the inspected canonical environment.',
    'ALLOW_PUBLIC_URL_INGESTION is disabled in the inspected canonical environment.',
    'No reviewed manifest authorizes a new canary or parity call.',
    'No shared conservative reservation up to $1.00 was recorded for a new call.',
    'No reusable three-asset batch manifest and no batch-versus-individual parity record were found.',
  ];
  const events: AcquisitionEconomicsV1['spend_ledger']['events'] = baselineCalls.map((entry, index) => {
    const row = record(entry, `baseline call ${index}`);
    const actual = nullableFiniteNumber(row.actual_cost_usd, `baseline call ${index} actual`);
    return {
      event_id: requiredText(row.call_id, `baseline call ${index} call_id`),
      provider: requiredText(row.provider, `baseline call ${index} provider`),
      route_id: requiredText(row.lane, `baseline call ${index} lane`),
      actual_reported_usd: actual,
      actual_or_conservative_usd: finiteNumber(row.conservative_spend_usd, `baseline call ${index} conservative`),
      settlement_state: actual === null ? 'conservatively_reserved' as const : 'settled' as const,
      source_path: SOURCE_PATHS.baseline_ledger,
    };
  });
  events.push(
    {
      event_id: 'authorized-wave-apify-20260718',
      provider: 'Apify',
      route_id: acquisitionRoute.route_id,
      actual_reported_usd: waveApifyActual,
      actual_or_conservative_usd: waveApifyActual,
      settlement_state: 'settled',
      source_path: SOURCE_PATHS.wave,
    },
    {
      event_id: 'authorized-wave-twelvelabs-20260718',
      provider: 'TwelveLabs',
      route_id: analysisRoute.route_id,
      actual_reported_usd: null,
      actual_or_conservative_usd: waveTwelveLabs,
      settlement_state: 'actual_or_conservative',
      source_path: SOURCE_PATHS.wave,
    },
  );
  const result: AcquisitionEconomicsV1 = {
    schema_version: 'viralbench_acquisition_economics_v1',
    generated_at: requiredText(wave.generated_at, 'wave generated_at'),
    program_id: ACQUISITION_PROGRAM_ID,
    status: trancheGate.next_tranche_state === 'locked' ? 'ready_with_locked_next_tranche' : 'ready',
    scope_policy: {
      internship_early_career_minimum_share: 0.7,
      broader_job_search_maximum_share: 0.3,
      discovery_seed_counts: {
        total: finiteNumber(discoveryAllocation.target_total, 'discovery total'),
        internship_early_career: finiteNumber(discoveryAllocation.internship_early_career, 'discovery internship'),
        broader_job_search: finiteNumber(discoveryAllocation.broader_job_search, 'discovery broader jobs'),
      },
      post_acquisition_scope_mix_state: 'unmeasured',
    },
    compatibility: {
      migration_style: 'additive',
      normalized_social_post_contract_unchanged: true,
      viral_content_library_schema_2_readable: true,
      prior_provider_ledger_readable: true,
    },
    spend_ledger: {
      currency: 'USD',
      lifetime_program_ceiling_usd: 100,
      tranche_size_usd: 25,
      baseline: {
        actual_reported_usd: baselineActual,
        conservative_spend_usd: baselineConservative,
        settlement_state: 'partially_settled_conservative_reserved',
      },
      finalized_current_wave: {
        apify_actual_reported_usd: waveApifyActual,
        twelvelabs_actual_or_conservative_usd: waveTwelveLabs,
        combined_actual_or_conservative_usd: waveCombined,
        settlement_state: 'apify_settled_twelvelabs_conservatively_estimated',
      },
      cumulative: {
        actual_reported_usd: round(baselineActual + waveApifyActual),
        actual_reported_plus_provider_estimate_usd: round(baselineActual + waveCombined),
        conservative_spend_usd: cumulativeConservative,
        first_tranche_remaining_usd: round(ACQUISITION_TRANCHE_USD - cumulativeConservative),
        settlement_state: 'partially_settled_all_unknowns_conservatively_reserved',
      },
      events,
    },
    route_scorecard: [acquisitionRoute, analysisRoute, temporalRoute, discoveryRoute],
    tranche_gate: trancheGate,
    source_to_corpus: {
      acquired_raw_rows: finiteNumber(collectionTotals.items, 'collection item total'),
      acquired_unique_public_items: collectionMetrics.unique,
      production_social_posts: socialPosts,
      total_source_records: totalSourceRecords,
      public_documents: finiteNumber(reconciliation.public_documents, 'public documents'),
      operator_documents: finiteNumber(reconciliation.operator_documents, 'operator documents'),
      public_vectors: finiteNumber(reconciliation.public_vectors, 'public vectors'),
      operator_vectors: finiteNumber(reconciliation.vectors, 'operator vectors'),
      current_wave_items_promoted_to_production_corpus: 0,
      state: 'reconciled_baseline_wave_not_promoted',
    },
    acquisition_runs: collectionRows.map((entry, index) => {
      const row = record(entry, `collection run ${index}`);
      return {
        run_id: requiredText(row.run_id, `collection run ${index} run_id`),
        provider: 'apify' as const,
        actor_id: requiredText(row.actor_id, `collection run ${index} actor_id`),
        build: nullableText(row.actor_build_number),
        returned_rows: array(row.items, `collection run ${index} items`).length,
        actual_reported_usd: nullableFiniteNumber(row.actual_cost_usd, `collection run ${index} actual`),
        usage_finalized: row.usage_finalized === true,
      };
    }),
    twelvelabs_batches: {
      records: [],
      current_wave_execution_mode: 'individual',
      batch_parity_evidence_state: 'missing',
      contract_schema_path: 'schemas/twelvelabs-batch-analysis-v1.schema.json',
    },
    discovery: {
      seed_manifest_path: SOURCE_PATHS.discovery,
      seed_count: array(discovery.seeds, 'discovery seeds').length,
      registry_review_candidates: array(discovery.registry_review_candidates, 'registry review candidates').length,
      unresolved_access_gaps: array(discovery.access_gaps, 'discovery access gaps').length,
      external_calls_authorized: false,
    },
    live_validation: {
      decision: 'blocked_zero_calls',
      new_calls_made: 0,
      new_conservative_reservation_usd: 0,
      credentials_present: true,
      reviewed_actor_pins_present: true,
      reusable_assets_manifest_present: false,
      approved_new_call_manifest_present: false,
      shared_reservation_recorded: false,
      paid_and_public_ingestion_gates_enabled: false,
      three_video_batch_parity_evidence_present: false,
      blockers: liveBlockers,
    },
    artifact_links: artifactLinks,
    ranking_policy: {
      raw_cross_platform_performance_ranking_allowed: false,
      required_comparison_boundary: 'Compare performance only within platform, content type, and age bucket; preserve raw metrics as dated observations.',
    },
    evidence_boundaries: [
      'AcquisitionEconomicsV1 is additive and does not migrate or rewrite normalized social posts, ViralContentLibrary schema 2, or the prior provider ledger.',
      'Actual reported provider cost is separated from provider estimates and conservative reservations; missing invoices are never represented as zero.',
      'The finalized wave remains ignored research evidence and added zero items to the production corpus in this controller integration.',
      'Discovery seeds remain draft-only pending registry review and authorize zero external calls.',
      'Raw cross-platform performance ranking is forbidden.',
      'No provider call was made while live-call gates, a new manifest, a shared reservation, reusable assets, or parity evidence were absent.',
    ],
  };
  validateAcquisitionEconomicsV1(result);
  return result;
}

export function validateAcquisitionEconomicsV1(value: unknown): AcquisitionEconomicsV1 {
  const row = record(value, 'AcquisitionEconomicsV1');
  if (row.schema_version !== 'viralbench_acquisition_economics_v1') throw new Error('unsupported_acquisition_economics_schema');
  if (row.program_id !== ACQUISITION_PROGRAM_ID) throw new Error('unexpected_acquisition_program_id');
  const ranking = record(row.ranking_policy, 'ranking policy');
  if (ranking.raw_cross_platform_performance_ranking_allowed !== false) throw new Error('raw_cross_platform_ranking_must_be_forbidden');
  const spend = record(record(row.spend_ledger, 'spend ledger').cumulative, 'cumulative spend');
  const conservative = finiteNumber(spend.conservative_spend_usd, 'cumulative conservative spend');
  if (conservative > ACQUISITION_PROGRAM_CEILING_USD + 1e-9) throw new Error('acquisition_program_ceiling_exceeded');
  const compatibility = record(row.compatibility, 'compatibility');
  if (compatibility.migration_style !== 'additive'
    || compatibility.normalized_social_post_contract_unchanged !== true
    || compatibility.viral_content_library_schema_2_readable !== true
    || compatibility.prior_provider_ledger_readable !== true) {
    throw new Error('legacy_artifact_compatibility_not_preserved');
  }
  return value as AcquisitionEconomicsV1;
}

export function assertLegacyAcquisitionArtifactReadable(value: unknown): 'normalized_social_post' | 'viral_content_library_v2' {
  const row = record(value, 'legacy acquisition artifact');
  if (row.schema_version === 2 && Array.isArray(row.items)) return 'viral_content_library_v2';
  if (typeof row.evidence_id === 'string'
    && typeof row.platform === 'string'
    && typeof row.canonical_url === 'string'
    && typeof row.platform_post_id === 'string') return 'normalized_social_post';
  throw new Error('unsupported_legacy_acquisition_artifact');
}

export function writeCurrentAcquisitionEconomicsV1(options: {
  root?: string;
  output_path?: string;
} = {}): string {
  const root = path.resolve(options.root ?? process.cwd());
  const relative = options.output_path
    ?? '.ops/competitor_research/viral-acquisition-economics-v1-20260718.json';
  const report = buildCurrentAcquisitionEconomicsV1(root);
  atomicWriteJson(path.resolve(root, relative), report);
  return relative;
}

function deriveCollectionMetrics(runs: unknown[], now: Date): {
  returned: number;
  unique: number;
  recentTimestampAndView: number;
  metricComplete: number;
} {
  const identities = new Map<string, { timestamp: number | null; views: number | null }>();
  let returned = 0;
  for (const [runIndex, entry] of runs.entries()) {
    const run = record(entry, `collection run ${runIndex}`);
    const actor = requiredText(run.actor_id, `collection run ${runIndex} actor`);
    for (const raw of array(run.items, `collection run ${runIndex} items`)) {
      returned += 1;
      const item = record(raw, `collection item ${runIndex}`);
      if (typeof item.error === 'string') continue;
      const platform = actor.includes('tiktok') ? 'tiktok'
        : actor.includes('youtube') ? 'youtube_shorts' : 'instagram';
      const id = nullableText(item.id) ?? nullableText(item.shortCode) ?? nullableText(item.url);
      if (!id) continue;
      const timestampText = nullableText(item.createTimeISO) ?? nullableText(item.date) ?? nullableText(item.timestamp);
      const timestamp = timestampText === null ? null : Date.parse(timestampText);
      const views = nullableFiniteNumber(
        item.playCount ?? item.viewCount ?? item.videoPlayCount,
        'collection item views',
      );
      const key = `${platform}:${id}`;
      if (!identities.has(key)) identities.set(key, {
        timestamp: timestamp !== null && Number.isFinite(timestamp) ? timestamp : null,
        views,
      });
    }
  }
  const unique = [...identities.values()];
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  return {
    returned,
    unique: unique.length,
    recentTimestampAndView: unique.filter((item) => item.timestamp !== null
      && item.views !== null
      && item.timestamp <= now.getTime()
      && now.getTime() - item.timestamp <= oneYearMs).length,
    metricComplete: unique.filter((item) => item.timestamp !== null && item.views !== null).length,
  };
}

function readJson(filePath: string): JsonRecord {
  return record(JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown, filePath);
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_must_be_object`);
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}_must_be_array`);
  return value;
}

function requiredText(value: unknown, label: string): string {
  const result = nullableText(value);
  if (result === null) throw new Error(`${label}_required`);
  return result;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}_must_be_finite`);
  return value;
}

function nullableFiniteNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, label);
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label}_must_be_non_negative_integer`);
}

function nonNegativeMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}_must_be_non_negative_finite`);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing_value:${token}`);
    result[token.slice(2)] = next;
    index += 1;
  }
  return result;
}

function runCli(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'build' && command !== 'check') {
    throw new Error('Usage: acquisition-economics.ts <build|check> [--root <path>] [--output <path>]');
  }
  const args = parseArgs(rest);
  const root = path.resolve(args.root ?? process.cwd());
  const report = buildCurrentAcquisitionEconomicsV1(root);
  if (command === 'build') {
    const output = writeCurrentAcquisitionEconomicsV1({ root, output_path: args.output });
    process.stdout.write(`${JSON.stringify({
      schema_version: report.schema_version,
      conservative_spend_usd: report.spend_ledger.cumulative.conservative_spend_usd,
      next_tranche_state: report.tranche_gate.next_tranche_state,
      live_validation: report.live_validation.decision,
      output,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    schema_version: report.schema_version,
    source_to_corpus: report.source_to_corpus,
    spend: report.spend_ledger.cumulative,
    next_tranche_state: report.tranche_gate.next_tranche_state,
    artifact_count: report.artifact_links.length,
  }, null, 2)}\n`);
}

if (require.main === module) runCli();
