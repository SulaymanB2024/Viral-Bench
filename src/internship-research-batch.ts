import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteFile, atomicWriteJson } from './artifact-integrity';
import {
  normalizePublicPostUrl,
  type SocialPlatform,
} from './semantic-intelligence';

export const RESEARCH_LANES = [
  'discovery',
  'audience_voice',
  'multimodal_analysis',
  'supplemental_retrieval',
  'retry_reserve',
] as const;
export const SELECTION_GROUPS = [
  'competitor_product',
  'student_problem_creator',
  'opportunity_access_safety',
  'contrast_outlier',
] as const;

export type ResearchLaneId = typeof RESEARCH_LANES[number];
export type SelectionGroup = typeof SELECTION_GROUPS[number];

export interface ResearchBatchManifest {
  schema_version: 1;
  batch_id: string;
  purpose: 'public_us_internship_content_and_market_research';
  geography: 'US';
  audience: ['college_students', 'recent_graduates'];
  publishing_in_scope: false;
  privacy: {
    public_data_only: true;
    persist_usernames: false;
    persist_profile_urls: false;
    excluded_data: string[];
  };
  budget: {
    currency: 'USD';
    hard_cap_usd: number;
    lanes: Array<{
      id: ResearchLaneId;
      max_usd: number;
      required_credentials: string[];
      required_gates: string[];
    }>;
  };
  collection: {
    platforms: ['tiktok', 'instagram', 'youtube_shorts'];
    cohorts: ['recent', 'popular'];
    max_results_per_profile_per_cohort: number;
    max_results_per_query_per_cohort: number;
    profiles: Array<{
      company: string;
      platform: SocialPlatform;
      locator: string;
      identity_status: 'verified_existing_corpus' | 'official_site_link' | 'requires_verification';
      source_group: 'competitor_product';
    }>;
    query_batches: Array<{ id: string; queries: string[] }>;
    comments: {
      target_posts: 18;
      max_high_engagement: 5;
      max_recent: 5;
      max_replies_per_thread: 2;
    };
    community_sources: Array<{ community: string; url: string; max_items: number }>;
  };
  selection: {
    target_total: 36;
    group_quotas: Record<SelectionGroup, number>;
    minimum_per_platform: 8;
    maximum_per_account: 3;
  };
  approval: {
    state: 'approved';
    basis: string;
    approved_at: string;
  };
}

export type LaneStatus =
  | 'ready'
  | 'reserved'
  | 'completed'
  | 'partial'
  | 'blocked_missing_prerequisite'
  | 'failed';

export interface BatchLedger {
  schema_version: 1;
  batch_id: string;
  generated_at: string;
  hard_cap_usd: number;
  actual_cost_usd: number;
  committed_max_cost_usd: number;
  remaining_uncommitted_usd: number;
  external_calls_made: number;
  status: 'ready' | 'partially_ready' | 'blocked' | 'completed_with_gaps';
  lanes: Array<{
    id: ResearchLaneId;
    max_usd: number;
    actual_cost_usd: number;
    committed_max_cost_usd: number;
    status: LaneStatus;
    blockers: string[];
    measurement_gaps: string[];
    external_calls_made: number;
  }>;
  redactions: ['credential values are never serialized'];
}

export interface SemanticCandidate {
  candidate_id: string;
  candidate_source?: string | null;
  canonical_url: string;
  platform: SocialPlatform;
  platform_post_id: string;
  account_handle: string;
  source_group: SelectionGroup;
  selection_group?: SelectionGroup | null;
  cohort: 'recent' | 'popular';
  cohorts_observed?: Array<'recent' | 'popular'>;
  cohort_assignment_basis?: string | null;
  posted_at: string | null;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  evidence_richness: number;
  novelty_score: number;
  classification_basis?: string | null;
  classification_version?: string | null;
  classification_confidence?: number | null;
  human_override?: {
    reviewer: string;
    reviewed_at: string;
    reason: string;
    selection_group: SelectionGroup;
  } | null;
}

export interface SelectionLedger {
  schema_version: 1;
  batch_id: string;
  generated_at: string;
  target_total: 36;
  entries: Array<{
    candidate_id: string;
    candidate_source: string | null;
    canonical_url: string;
    platform: SocialPlatform;
    platform_post_id: string;
    account_handle: string;
    source_group: SelectionGroup;
    chosen_pillar: SelectionGroup;
    cohort: 'recent' | 'popular';
    source_groups_observed?: SelectionGroup[];
    chosen_pillars_observed?: SelectionGroup[];
    cohorts_observed?: Array<'recent' | 'popular'>;
    observation_count?: number;
    observations?: Array<{
      candidate_id: string;
      candidate_source: string | null;
      source_group: SelectionGroup;
      chosen_pillar: SelectionGroup;
      cohort: 'recent' | 'popular';
      posted_at: string | null;
      metrics: SemanticCandidate['metrics'];
      classification_basis: string | null;
      classification_version: string | null;
      classification_confidence: number | null;
      human_override: SemanticCandidate['human_override'];
    }>;
    posted_at: string | null;
    age_bucket: '0_90_days' | '91_365_days' | 'older_than_365_days' | 'unknown';
    metrics: SemanticCandidate['metrics'];
    classification_basis: string | null;
    selected: boolean;
    selection_reason: string | null;
    exclusion_reason: string | null;
    normalized_performance_score: number | null;
    evidence_richness: number;
    novelty_score: number;
    classification_version?: string | null;
    classification_confidence?: number | null;
    human_override?: SemanticCandidate['human_override'];
  }>;
  identity_groups?: Array<{
    identity_key: string;
    canonical_candidate_id: string;
    candidate_ids: string[];
    candidate_sources: string[];
    source_groups_observed: SelectionGroup[];
    chosen_pillars_observed: SelectionGroup[];
    cohorts_observed: Array<'recent' | 'popular'>;
    observation_count: number;
    divergence_fields: string[];
  }>;
  counts: {
    input_candidates: number;
    unique_candidates: number;
    duplicate_candidates_removed: number;
    selected: number;
    by_group: Record<string, number>;
    by_platform: Record<string, number>;
    by_cohort: Record<string, number>;
  };
  shortfalls: string[];
  evidence_boundary: {
    raw_cross_platform_ranking_allowed: false;
    selection_is_performance_prediction: false;
    comparison_method: 'within_platform_and_age_bucket_percentile';
  };
}

export interface AudienceSignal {
  signal_id: string;
  source_url: string;
  source_type: 'public_community_thread' | 'public_comment';
  community: string;
  published_at: string | null;
  audience_segment: 'college_student' | 'recent_graduate' | 'international_student' | 'first_generation_or_access' | 'unspecified_early_career';
  theme: string;
  paraphrased_need: string;
  confidence: number;
  classification_version?: 'audience_theme_rules_v1';
  candidate_themes?: string[];
  human_override?: null;
  identity_redacted: true;
}

export interface AudienceSignalReport {
  schema_version: 1;
  batch_id: string;
  generated_at: string;
  external_calls_made: number;
  target_range: { minimum: 40; maximum: 60 };
  collected: number;
  counts_by_theme: Record<string, number>;
  counts_by_community: Record<string, number>;
  source_statuses: Array<{
    community: string;
    status: 'completed' | 'partial' | 'failed';
    items: number;
    error: string | null;
  }>;
  signals: AudienceSignal[];
  measurement_gaps: string[];
  privacy: {
    usernames_persisted: false;
    profile_urls_persisted: false;
    raw_post_text_persisted: false;
    identity_redacted_before_persistence: true;
  };
}

interface TransientCommunityItem {
  sourceUrl: string;
  publishedAt: string | null;
  title: string;
  content: string;
}

export function validateResearchBatchManifest(input: unknown): ResearchBatchManifest {
  const value = record(input, 'research batch manifest');
  if (value.schema_version !== 1) throw new Error('schema_version must be 1.');
  if (text(value.purpose) !== 'public_us_internship_content_and_market_research') {
    throw new Error('purpose must remain public US internship research.');
  }
  if (text(value.geography) !== 'US') throw new Error('geography must be US.');
  if (value.publishing_in_scope !== false) throw new Error('publishing_in_scope must be false.');
  const audience = stringArray(value.audience, 'audience');
  if (audience.join('|') !== 'college_students|recent_graduates') {
    throw new Error('audience must be college_students and recent_graduates only.');
  }
  const privacy = record(value.privacy, 'privacy');
  if (privacy.public_data_only !== true || privacy.persist_usernames !== false || privacy.persist_profile_urls !== false) {
    throw new Error('privacy must enforce public data and prohibit persisted identities.');
  }
  const excludedData = stringArray(privacy.excluded_data, 'privacy.excluded_data');
  for (const required of ['high_school_and_admissions_content', 'private_applypilot_data', 'resume_text', 'names', 'email_addresses']) {
    if (!excludedData.includes(required)) throw new Error(`privacy.excluded_data must include ${required}.`);
  }

  const budget = record(value.budget, 'budget');
  const hardCap = money(budget.hard_cap_usd, 'budget.hard_cap_usd');
  if (hardCap > 25) throw new Error('budget.hard_cap_usd cannot exceed 25.');
  const lanes = array(budget.lanes, 'budget.lanes').map((raw, index) => {
    const lane = record(raw, `budget.lanes[${index}]`);
    const id = text(lane.id) as ResearchLaneId;
    if (!RESEARCH_LANES.includes(id)) throw new Error(`Unsupported budget lane ${id || index}.`);
    return {
      id,
      max_usd: nonNegativeMoney(lane.max_usd, `${id}.max_usd`),
      required_credentials: stringArray(lane.required_credentials, `${id}.required_credentials`),
      required_gates: stringArray(lane.required_gates, `${id}.required_gates`),
    };
  });
  if (new Set(lanes.map((lane) => lane.id)).size !== RESEARCH_LANES.length || lanes.length !== RESEARCH_LANES.length) {
    throw new Error('budget.lanes must contain every research lane exactly once.');
  }
  const laneTotal = roundMoney(lanes.reduce((sum, lane) => sum + lane.max_usd, 0));
  if (laneTotal !== hardCap) throw new Error(`Budget lane caps ${laneTotal} must equal hard cap ${hardCap}.`);
  const expectedCaps: Record<ResearchLaneId, number> = {
    discovery: 5,
    audience_voice: 4,
    multimodal_analysis: 12,
    supplemental_retrieval: 2,
    retry_reserve: 2,
  };
  for (const lane of lanes) {
    if (lane.max_usd !== expectedCaps[lane.id]) throw new Error(`${lane.id}.max_usd must be ${expectedCaps[lane.id]}.`);
  }

  const collection = record(value.collection, 'collection');
  const platforms = stringArray(collection.platforms, 'collection.platforms');
  if (platforms.join('|') !== 'tiktok|instagram|youtube_shorts') throw new Error('All three short-form platforms are required.');
  const cohorts = stringArray(collection.cohorts, 'collection.cohorts');
  if (cohorts.join('|') !== 'recent|popular') throw new Error('Both recent and popular cohorts are required.');
  const maxProfile = boundedInteger(collection.max_results_per_profile_per_cohort, 'max_results_per_profile_per_cohort', 1, 6);
  const maxQuery = boundedInteger(collection.max_results_per_query_per_cohort, 'max_results_per_query_per_cohort', 1, 8);
  const profiles = array(collection.profiles, 'collection.profiles').map((raw, index) => {
    const profile = record(raw, `collection.profiles[${index}]`);
    const platform = text(profile.platform) as SocialPlatform;
    if (!['tiktok', 'instagram', 'youtube_shorts'].includes(platform)) throw new Error(`Invalid profile platform ${platform}.`);
    const identityStatus = text(profile.identity_status) as ResearchBatchManifest['collection']['profiles'][number]['identity_status'];
    if (!['verified_existing_corpus', 'official_site_link', 'requires_verification'].includes(identityStatus)) {
      throw new Error(`Invalid identity_status for profile ${index}.`);
    }
    return {
      company: requiredText(profile.company, `profiles[${index}].company`),
      platform,
      locator: requiredText(profile.locator, `profiles[${index}].locator`),
      identity_status: identityStatus,
      source_group: 'competitor_product' as const,
    };
  });
  const queryBatches = array(collection.query_batches, 'collection.query_batches').map((raw, index) => {
    const batch = record(raw, `query_batches[${index}]`);
    const queries = stringArray(batch.queries, `query_batches[${index}].queries`);
    if (queries.length !== 10 || new Set(queries.map((query) => query.toLowerCase())).size !== 10) {
      throw new Error(`query_batches[${index}] must contain exactly 10 unique queries.`);
    }
    return { id: requiredText(batch.id, `query_batches[${index}].id`), queries };
  });
  if (queryBatches.length !== 2) throw new Error('Exactly two query batches are required.');

  const comments = record(collection.comments, 'collection.comments');
  const validatedComments = {
    target_posts: boundedInteger(comments.target_posts, 'comments.target_posts', 18, 18) as 18,
    max_high_engagement: boundedInteger(comments.max_high_engagement, 'comments.max_high_engagement', 5, 5) as 5,
    max_recent: boundedInteger(comments.max_recent, 'comments.max_recent', 5, 5) as 5,
    max_replies_per_thread: boundedInteger(comments.max_replies_per_thread, 'comments.max_replies_per_thread', 2, 2) as 2,
  };
  const communitySources = array(collection.community_sources, 'collection.community_sources').map((raw, index) => {
    const source = record(raw, `community_sources[${index}]`);
    const url = requiredText(source.url, `community_sources[${index}].url`);
    assertHttpsUrl(url, `community_sources[${index}].url`);
    return {
      community: requiredText(source.community, `community_sources[${index}].community`),
      url,
      max_items: boundedInteger(source.max_items, `community_sources[${index}].max_items`, 1, 12),
    };
  });

  const selection = record(value.selection, 'selection');
  const groupQuotasRaw = record(selection.group_quotas, 'selection.group_quotas');
  const groupQuotas = Object.fromEntries(SELECTION_GROUPS.map((group) => [
    group,
    boundedInteger(groupQuotasRaw[group], `selection.group_quotas.${group}`, 1, 36),
  ])) as Record<SelectionGroup, number>;
  const targetTotal = boundedInteger(selection.target_total, 'selection.target_total', 36, 36) as 36;
  if (Object.values(groupQuotas).reduce((sum, quota) => sum + quota, 0) !== targetTotal) {
    throw new Error('selection group quotas must sum to 36.');
  }
  const minimumPerPlatform = boundedInteger(selection.minimum_per_platform, 'selection.minimum_per_platform', 8, 8) as 8;
  const maximumPerAccount = boundedInteger(selection.maximum_per_account, 'selection.maximum_per_account', 3, 3) as 3;
  const approval = record(value.approval, 'approval');
  if (text(approval.state) !== 'approved') throw new Error('The batch must be explicitly approved.');
  const approvedAt = requiredText(approval.approved_at, 'approval.approved_at');
  if (!Number.isFinite(Date.parse(approvedAt))) throw new Error('approval.approved_at must be an ISO date-time.');

  return {
    schema_version: 1,
    batch_id: requiredText(value.batch_id, 'batch_id'),
    purpose: 'public_us_internship_content_and_market_research',
    geography: 'US',
    audience: ['college_students', 'recent_graduates'],
    publishing_in_scope: false,
    privacy: {
      public_data_only: true,
      persist_usernames: false,
      persist_profile_urls: false,
      excluded_data: excludedData,
    },
    budget: { currency: 'USD', hard_cap_usd: hardCap, lanes },
    collection: {
      platforms: ['tiktok', 'instagram', 'youtube_shorts'],
      cohorts: ['recent', 'popular'],
      max_results_per_profile_per_cohort: maxProfile,
      max_results_per_query_per_cohort: maxQuery,
      profiles,
      query_batches: queryBatches,
      comments: validatedComments,
      community_sources: communitySources,
    },
    selection: {
      target_total: targetTotal,
      group_quotas: groupQuotas,
      minimum_per_platform: minimumPerPlatform,
      maximum_per_account: maximumPerAccount,
    },
    approval: {
      state: 'approved',
      basis: requiredText(approval.basis, 'approval.basis'),
      approved_at: approvedAt,
    },
  };
}

export function buildBatchPreflight(
  manifestInput: ResearchBatchManifest | unknown,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): BatchLedger {
  const manifest = validateResearchBatchManifest(manifestInput);
  const lanes = manifest.budget.lanes.map((lane): BatchLedger['lanes'][number] => {
    const blockers = [
      ...lane.required_credentials.filter((key) => !nonEmpty(env[key])).map((key) => `missing_credential:${key}`),
      ...lane.required_gates.filter((key) => env[key] !== 'true').map((key) => `gate_not_enabled:${key}`),
    ];
    const isReserve = lane.id === 'retry_reserve';
    return {
      id: lane.id,
      max_usd: lane.max_usd,
      actual_cost_usd: 0,
      committed_max_cost_usd: 0,
      status: blockers.length ? 'blocked_missing_prerequisite' : isReserve ? 'reserved' : 'ready',
      blockers,
      measurement_gaps: blockers.length
        ? [`${lane.id} was not executed because required credentials or gates were unavailable; this is not negative evidence about the source.`]
        : [],
      external_calls_made: 0,
    };
  });
  return recalculateLedger({
    schema_version: 1,
    batch_id: manifest.batch_id,
    generated_at: now().toISOString(),
    hard_cap_usd: manifest.budget.hard_cap_usd,
    actual_cost_usd: 0,
    committed_max_cost_usd: 0,
    remaining_uncommitted_usd: manifest.budget.hard_cap_usd,
    external_calls_made: 0,
    status: lanes.every((lane) => ['ready', 'reserved'].includes(lane.status)) ? 'ready' : 'partially_ready',
    lanes,
    redactions: ['credential values are never serialized'],
  });
}

export function reserveLaneBudget(ledger: BatchLedger, laneId: ResearchLaneId, maxPotentialChargeUsd: number): BatchLedger {
  const charge = money(maxPotentialChargeUsd, 'maxPotentialChargeUsd');
  const next = cloneLedger(ledger);
  const lane = requiredLane(next, laneId);
  if (lane.status === 'blocked_missing_prerequisite') throw new Error(`${laneId} is blocked by missing prerequisites.`);
  const laneRemaining = roundMoney(lane.max_usd - lane.actual_cost_usd - lane.committed_max_cost_usd);
  if (charge > laneRemaining) throw new Error(`${laneId} reservation ${charge} exceeds lane remaining cap ${laneRemaining}.`);
  if (charge > next.remaining_uncommitted_usd) {
    throw new Error(`${laneId} reservation ${charge} exceeds batch remaining cap ${next.remaining_uncommitted_usd}.`);
  }
  lane.committed_max_cost_usd = roundMoney(lane.committed_max_cost_usd + charge);
  lane.status = 'reserved';
  return recalculateLedger(next);
}

export function settleLaneBudget(
  ledger: BatchLedger,
  laneId: ResearchLaneId,
  reservedMaxUsd: number,
  actualCostUsd: number,
  externalCallsMade: number,
  status: 'completed' | 'partial' | 'failed',
  measurementGaps: string[] = [],
): BatchLedger {
  const reserved = nonNegativeMoney(reservedMaxUsd, 'reservedMaxUsd');
  const actual = nonNegativeMoney(actualCostUsd, 'actualCostUsd');
  if (actual > reserved) throw new Error('Actual provider cost cannot exceed the reserved maximum.');
  const next = cloneLedger(ledger);
  const lane = requiredLane(next, laneId);
  if (reserved > lane.committed_max_cost_usd) throw new Error('Cannot settle more budget than the lane has reserved.');
  lane.committed_max_cost_usd = roundMoney(lane.committed_max_cost_usd - reserved);
  lane.actual_cost_usd = roundMoney(lane.actual_cost_usd + actual);
  lane.external_calls_made += boundedInteger(externalCallsMade, 'externalCallsMade', 0, Number.MAX_SAFE_INTEGER);
  lane.status = status;
  lane.measurement_gaps.push(...measurementGaps.map((gap) => redactText(gap)));
  return recalculateLedger(next);
}

interface CandidateIdentityGroup {
  identity_key: string;
  canonical: SemanticCandidate;
  observations: SemanticCandidate[];
  divergence_fields: string[];
}

export function deduplicateCandidates(input: unknown[]): {
  candidates: SemanticCandidate[];
  duplicatesRemoved: number;
  identityGroups: CandidateIdentityGroup[];
} {
  const grouped = new Map<string, SemanticCandidate[]>();
  input.forEach((raw, index) => {
    const candidate = validateCandidate(raw, index);
    const normalized = normalizePublicPostUrl(candidate.canonical_url);
    const key = `${normalized.platform}:${normalized.platform_post_id}`;
    const normalizedCandidate = {
      ...candidate,
      canonical_url: normalized.canonical_url,
      platform: normalized.platform,
      platform_post_id: normalized.platform_post_id,
    };
    const observations = grouped.get(key) ?? [];
    observations.push(normalizedCandidate);
    grouped.set(key, observations);
  });
  const identityGroups = [...grouped.entries()].map(([identityKey, observations]): CandidateIdentityGroup => {
    const ranked = [...observations].sort((left, right) => (
      candidateRank(right) - candidateRank(left)
      || stableCompare(left.candidate_id, right.candidate_id)
    ));
    return {
      identity_key: identityKey,
      canonical: ranked[0],
      observations: [...observations].sort((left, right) => stableCompare(left.candidate_id, right.candidate_id)),
      divergence_fields: candidateDivergenceFields(observations),
    };
  }).sort((left, right) => stableCompare(left.identity_key, right.identity_key));
  return {
    candidates: identityGroups.map((group) => group.canonical)
      .sort((left, right) => stableCompare(left.candidate_id, right.candidate_id)),
    duplicatesRemoved: input.length - identityGroups.length,
    identityGroups,
  };
}

export function selectSemanticCandidates(
  input: unknown[],
  manifestInput: ResearchBatchManifest | unknown,
  now: () => Date = () => new Date(),
): SelectionLedger {
  const manifest = validateResearchBatchManifest(manifestInput);
  const { candidates, duplicatesRemoved, identityGroups } = deduplicateCandidates(input);
  const identityByCanonicalId = new Map(identityGroups.map((group) => [group.canonical.candidate_id, group]));
  const selectionNow = now();
  const performance = normalizedPerformanceScores(candidates, selectionNow);
  const ranked = [...candidates].sort((left, right) => (
    selectionScore(right, performance.get(right.candidate_id) ?? null)
      - selectionScore(left, performance.get(left.candidate_id) ?? null)
    || stableCompare(left.candidate_id, right.candidate_id)
  ));
  const selected = new Set<string>();
  const accountCounts = new Map<string, number>();

  for (const group of SELECTION_GROUPS) {
    const quota = manifest.selection.group_quotas[group];
    for (const candidate of ranked.filter((item) => selectionGroup(item) === group)) {
      if (countSelectedGroup(ranked, selected, group) >= quota) break;
      const accountKey = `${candidate.platform}:${candidate.account_handle.toLowerCase()}`;
      if ((accountCounts.get(accountKey) ?? 0) >= manifest.selection.maximum_per_account) continue;
      selected.add(candidate.candidate_id);
      accountCounts.set(accountKey, (accountCounts.get(accountKey) ?? 0) + 1);
    }
  }

  repairPlatformMinimums(ranked, selected, accountCounts, manifest);

  const selectedRows = ranked.filter((candidate) => selected.has(candidate.candidate_id));
  const byGroup = counts(selectedRows.map(selectionGroup));
  const byPlatform = counts(selectedRows.map((candidate) => candidate.platform));
  const byCohort = counts(selectedRows.map((candidate) => candidate.cohort));
  const shortfalls: string[] = [];
  if (selectedRows.length < manifest.selection.target_total) {
    shortfalls.push(`Selected ${selectedRows.length} of ${manifest.selection.target_total} target videos.`);
  }
  for (const group of SELECTION_GROUPS) {
    const actual = byGroup[group] ?? 0;
    const target = manifest.selection.group_quotas[group];
    if (actual < target) shortfalls.push(`${group} has ${actual} of ${target} required selections.`);
  }
  for (const platform of manifest.collection.platforms) {
    const actual = byPlatform[platform] ?? 0;
    if (actual < manifest.selection.minimum_per_platform) {
      shortfalls.push(`${platform} has ${actual} of ${manifest.selection.minimum_per_platform} minimum selections.`);
    }
  }

  return {
    schema_version: 1,
    batch_id: manifest.batch_id,
    generated_at: selectionNow.toISOString(),
    target_total: 36,
    entries: candidates.map((candidate) => {
      const isSelected = selected.has(candidate.candidate_id);
      const identity = identityByCanonicalId.get(candidate.candidate_id);
      if (!identity) throw new Error(`Missing identity group for ${candidate.candidate_id}.`);
      const observedSourceGroups = unique(identity.observations.map((row) => row.source_group)).sort() as SelectionGroup[];
      const observedPillars = unique(identity.observations.map(selectionGroup)).sort() as SelectionGroup[];
      const observedCohorts = unique(identity.observations.flatMap((row) => (
        row.cohorts_observed?.length ? row.cohorts_observed : [row.cohort]
      ))).sort() as Array<'recent' | 'popular'>;
      const chosenPillar = selectionGroup(candidate);
      return {
        candidate_id: candidate.candidate_id,
        candidate_source: candidate.candidate_source ?? null,
        canonical_url: candidate.canonical_url,
        platform: candidate.platform,
        platform_post_id: candidate.platform_post_id,
        account_handle: candidate.account_handle,
        source_group: candidate.source_group,
        chosen_pillar: chosenPillar,
        cohort: candidate.cohort,
        source_groups_observed: observedSourceGroups,
        chosen_pillars_observed: observedPillars,
        cohorts_observed: observedCohorts,
        observation_count: identity.observations.length,
        observations: identity.observations.map((observation) => ({
          candidate_id: observation.candidate_id,
          candidate_source: observation.candidate_source ?? null,
          source_group: observation.source_group,
          chosen_pillar: selectionGroup(observation),
          cohort: observation.cohort,
          posted_at: observation.posted_at,
          metrics: observation.metrics,
          classification_basis: observation.classification_basis ?? null,
          classification_version: observation.classification_version ?? null,
          classification_confidence: observation.classification_confidence ?? null,
          human_override: observation.human_override ?? null,
        })),
        posted_at: candidate.posted_at,
        age_bucket: ageBucket(candidate.posted_at, selectionNow) as SelectionLedger['entries'][number]['age_bucket'],
        metrics: candidate.metrics,
        classification_basis: candidate.classification_basis ?? null,
        selected: isSelected,
        selection_reason: isSelected
          ? `fills ${chosenPillar} quota with within-platform/age normalization; account cap respected`
          : null,
        exclusion_reason: isSelected ? null : exclusionReason(candidate, ranked, selected, accountCounts, manifest),
        normalized_performance_score: performance.get(candidate.candidate_id) ?? null,
        evidence_richness: candidate.evidence_richness,
        novelty_score: candidate.novelty_score,
        classification_version: candidate.classification_version ?? null,
        classification_confidence: candidate.classification_confidence ?? null,
        human_override: candidate.human_override ?? null,
      };
    }),
    identity_groups: identityGroups.map((group) => ({
      identity_key: group.identity_key,
      canonical_candidate_id: group.canonical.candidate_id,
      candidate_ids: group.observations.map((row) => row.candidate_id),
      candidate_sources: unique(group.observations
        .map((row) => row.candidate_source)
        .filter((value): value is string => Boolean(value))).sort(),
      source_groups_observed: unique(group.observations.map((row) => row.source_group)).sort() as SelectionGroup[],
      chosen_pillars_observed: unique(group.observations.map(selectionGroup)).sort() as SelectionGroup[],
      cohorts_observed: unique(group.observations.flatMap((row) => (
        row.cohorts_observed?.length ? row.cohorts_observed : [row.cohort]
      ))).sort() as Array<'recent' | 'popular'>,
      observation_count: group.observations.length,
      divergence_fields: group.divergence_fields,
    })),
    counts: {
      input_candidates: input.length,
      unique_candidates: candidates.length,
      duplicate_candidates_removed: duplicatesRemoved,
      selected: selectedRows.length,
      by_group: byGroup,
      by_platform: byPlatform,
      by_cohort: byCohort,
    },
    shortfalls,
    evidence_boundary: {
      raw_cross_platform_ranking_allowed: false,
      selection_is_performance_prediction: false,
      comparison_method: 'within_platform_and_age_bucket_percentile',
    },
  };
}

export function parseRedditAtom(xml: string): TransientCommunityItem[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap((match): TransientCommunityItem[] => {
    const entry = match[1];
    const href = /<link\s+href="([^"]+)"/.exec(entry)?.[1] ?? '';
    const title = elementText(entry, 'title');
    if (!href || !title) return [];
    return [{
      sourceUrl: decodeEntities(href),
      publishedAt: isoOrNull(elementText(entry, 'updated') || elementText(entry, 'published')),
      title: cleanTransientText(title),
      content: cleanTransientText(elementText(entry, 'content')),
    }];
  });
}

export function identityFreeAudienceSignal(item: TransientCommunityItem, community: string): AudienceSignal | null {
  const transientText = `${item.title} ${item.content}`.replace(/\s+/g, ' ').trim();
  if (!isEarlyCareerRelevant(transientText, community)) return null;
  return identityFreeAudienceTextSignal({
    sourceUrl: item.sourceUrl,
    sourceType: 'public_community_thread',
    community,
    publishedAt: item.publishedAt,
    transientText,
  });
}

export function identityFreeAudienceTextSignal(input: {
  sourceUrl: string;
  sourceType: AudienceSignal['source_type'];
  community: string;
  publishedAt: string | null;
  transientText: string;
}): AudienceSignal | null {
  const transientText = input.transientText.replace(/\s+/g, ' ').trim();
  if (transientText.length < 12 || /^(?:thanks|thank you|lol|same|this|yes|no|real|facts)[.! ]*$/i.test(transientText)) return null;
  const candidateThemes = classifyAudienceThemes(transientText);
  const theme = candidateThemes[0];
  return {
    signal_id: `audience:${sha256(`${input.sourceUrl}|${theme}|${transientText}`).slice(0, 16)}`,
    source_url: stripTracking(input.sourceUrl),
    source_type: input.sourceType,
    community: input.community,
    published_at: input.publishedAt,
    audience_segment: classifyAudienceSegment(transientText),
    theme,
    paraphrased_need: paraphrasedNeed(theme),
    confidence: theme === 'general_early_career_uncertainty' ? 0.55 : candidateThemes.length > 1 ? 0.7 : 0.8,
    classification_version: 'audience_theme_rules_v1',
    candidate_themes: candidateThemes,
    human_override: null,
    identity_redacted: true,
  };
}

export async function collectPublicAudienceSignals(
  manifestInput: ResearchBatchManifest | unknown,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    userAgent?: string;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<AudienceSignalReport> {
  const manifest = validateResearchBatchManifest(manifestInput);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const signals: AudienceSignal[] = [];
  const sourceStatuses: AudienceSignalReport['source_statuses'] = [];
  const seen = new Set<string>();
  let externalCallsMade = 0;
  for (const source of manifest.collection.community_sources) {
    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        externalCallsMade += 1;
        response = await fetchImpl(source.url, {
          headers: {
            Accept: 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
            'User-Agent': options.userAgent ?? 'Viral-Bench/1.0 public research; identity-redacted storage',
          },
        });
        if (response.status !== 429 || attempt === 2) break;
        const retryAfterSeconds = Number(response.headers.get('retry-after'));
        const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(5_000, retryAfterSeconds * 1_000)
          : 1_000 * (attempt + 1);
        await sleep(retryDelay);
      }
      if (!response) throw new Error('Public RSS request did not return a response.');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      const sourceSignals = parseRedditAtom(xml)
        .map((item) => identityFreeAudienceSignal(item, source.community))
        .filter((item): item is AudienceSignal => Boolean(item))
        .filter((item) => {
          if (seen.has(item.source_url)) return false;
          seen.add(item.source_url);
          return true;
        })
        .slice(0, source.max_items);
      signals.push(...sourceSignals);
      sourceStatuses.push({
        community: source.community,
        status: sourceSignals.length >= source.max_items ? 'completed' : 'partial',
        items: sourceSignals.length,
        error: null,
      });
    } catch (error) {
      sourceStatuses.push({
        community: source.community,
        status: 'failed',
        items: 0,
        error: redactText(error instanceof Error ? error.message : String(error)),
      });
    }
    if (signals.length >= 60) break;
    await sleep(750);
  }
  const boundedSignals = signals.slice(0, 60);
  const measurementGaps: string[] = [];
  if (boundedSignals.length < 40) {
    measurementGaps.push(`Collected ${boundedSignals.length} of the 40-signal minimum because public RSS coverage was incomplete or filtered as off-topic.`);
  }
  for (const source of sourceStatuses.filter((status) => status.status !== 'completed')) {
    measurementGaps.push(`${source.community} returned ${source.status === 'failed' ? 'a provider failure' : 'fewer relevant items than its cap'}; this is a coverage gap, not negative audience evidence.`);
  }
  return {
    schema_version: 1,
    batch_id: manifest.batch_id,
    generated_at: now().toISOString(),
    external_calls_made: externalCallsMade,
    target_range: { minimum: 40, maximum: 60 },
    collected: boundedSignals.length,
    counts_by_theme: counts(boundedSignals.map((signal) => signal.theme)),
    counts_by_community: counts(boundedSignals.map((signal) => signal.community)),
    source_statuses: sourceStatuses,
    signals: boundedSignals,
    measurement_gaps: unique(measurementGaps),
    privacy: {
      usernames_persisted: false,
      profile_urls_persisted: false,
      raw_post_text_persisted: false,
      identity_redacted_before_persistence: true,
    },
  };
}

export function renderExpansionMarkdown(input: {
  manifest: ResearchBatchManifest;
  ledger: BatchLedger;
  selection: SelectionLedger;
  audience: AudienceSignalReport;
  sources: unknown;
  publicSignals: unknown;
  opportunities: unknown;
  generatedAt: string;
}): string {
  const sourceRows = array(record(input.sources, 'sources document').sources, 'sources');
  const publicSignalRows = array(record(input.publicSignals, 'public signals document').signals, 'signals');
  const opportunityRows = array(record(input.opportunities, 'opportunities document').items, 'opportunities');
  const program = recommendedContentProgram();
  const testMatrix = ownedTestMatrix();
  const lines = [
    '# US internship content and data expansion',
    '',
    `Generated: ${input.generatedAt}`,
    '',
    '## Outcome',
    '',
    `The reproducible US batch is prepared with a hard ceiling of $${input.manifest.budget.hard_cap_usd}. Public official-source research and identity-redacted community RSS collection are complete where the current environment allowed them. Paid social discovery and multimodal analysis remain prerequisite-blocked measurement gaps; they are not reported as empty content markets.`,
    '',
    '## Coverage and reconciliation',
    '',
    `- Public data sources registered: ${sourceRows.length}.`,
    `- Official or first-party market/product signals reviewed: ${publicSignalRows.length}.`,
    `- Public opportunity-format examples: ${opportunityRows.length}; every one requires first-party revalidation before publication.`,
    `- Identity-free community signals: ${input.audience.collected} of the requested 40-60 range.`,
    `- Discovery candidates available to the new batch: ${input.selection.counts.unique_candidates}; selected for new multimodal analysis: ${input.selection.counts.selected} of 36.`,
    `- Recorded provider cost: $${input.ledger.actual_cost_usd}; committed maximum: $${input.ledger.committed_max_cost_usd}; uncommitted ceiling: $${input.ledger.remaining_uncommitted_usd}.`,
    '',
    'The candidate, selected, mapped, indexed, and semantic-row counts remain separate. A repeated caption, hashtag, or segment row is retrieval material, not another independent post.',
    '',
    '## New evidence and content implications',
    '',
    ...publicSignalRows.map((raw) => {
      const signal = record(raw, 'public signal');
      return `- [${requiredText(signal.signal_id, 'signal_id')}](${requiredText(signal.source_url, 'source_url')}): ${requiredText(signal.content_implication, 'content_implication')}`;
    }),
    '',
    '## Audience voice',
    '',
    `Recurring themes: ${inlineCounts(input.audience.counts_by_theme)}.`,
    '',
    'These are aggregate, paraphrased needs. Usernames, profile links, and raw post bodies were discarded before the artifact was written.',
    '',
    '## Prioritized content program',
    '',
    '| Priority | Series | Voice | Audience problem | Evidence rule |',
    '| ---: | --- | --- | --- | --- |',
    ...program.map((item) => `| ${item.priority} | ${item.name} | ${item.voice} | ${item.problem} | ${item.evidence_rule} |`),
    '',
    '## Nine-post owned test',
    '',
    '| Post | Voice | Series | Hypothesis | Primary measures |',
    '| ---: | --- | --- | --- | --- |',
    ...testMatrix.map((item) => `| ${item.post} | ${item.voice} | ${item.series} | ${item.hypothesis} | ${item.measures.join(', ')} |`),
    '',
    'Compare results only after all three posts in each voice have reached the same checkpoint. Use reach, three-second views, hook retention, average watch time, completion, saves, shares, profile visits, follows, and link clicks; do not compare raw views across platforms as if they share a distribution baseline.',
    '',
    '## Ranked data sources',
    '',
    '| Rank | Source | Category | Access | Status | Privacy |',
    '| ---: | --- | --- | --- | --- | --- |',
    ...sourceRows.slice(0, 30).map((raw) => {
      const source = record(raw, 'source');
      const url = requiredText(source.url, 'source.url');
      const linkedName = url.startsWith('https://')
        ? `[${requiredText(source.name, 'source.name')}](${url})`
        : `\`${url}\``;
      return `| ${source.rank} | ${linkedName} | ${source.category} | ${source.access} | ${source.status} | ${source.privacy_risk} |`;
    }),
    '',
    '## Coverage and blocker ledger',
    '',
    ...input.ledger.lanes.flatMap((lane) => [
      `- **${lane.id}: ${lane.status}.** Cap $${lane.max_usd}; actual $${lane.actual_cost_usd}; committed $${lane.committed_max_cost_usd}.`,
      ...lane.blockers.map((blocker) => `  - ${blocker}`),
      ...lane.measurement_gaps.map((gap) => `  - ${gap}`),
    ]),
    ...input.audience.measurement_gaps.map((gap) => `- Audience collection: ${gap}`),
    ...input.selection.shortfalls.map((gap) => `- Semantic selection: ${gap}`),
    '- Google Trends: the official endpoint returned HTTP 429 during this run, so the batch records a rate-limit gap and makes no relative-demand claims.',
    '- Social identities marked `requires_verification` must be verified against an official company site before a paid actor run.',
    '',
    '## Evidence boundaries',
    '',
    '- Observed facts, company marketing claims, heuristic themes, strategy recommendations, and future owned metrics remain separate fields and sections.',
    '- Missing, skipped, failed, or rate-limited sources are measurement gaps, not evidence that a topic, account, or market is absent.',
    '- Opportunity posts require an immediate first-party availability, pay, deadline, location, and eligibility check.',
    '- Work-authorization, compensation, and safety content must link to current USCIS, Department of Labor, or FTC guidance and must not present individualized legal advice.',
    '- Public competitor media and community content are research evidence only; creator identity, exact scripts, footage, and shot sequences are not reusable assets.',
    '',
    '## Rerun inputs',
    '',
    '```yaml',
    'workflow: firecrawl-market-research-plus-public-social-batch',
    `batch_manifest: .ops/competitor_research/${input.manifest.batch_id}.json`,
    'geography: US',
    'audience: [college_students, recent_graduates]',
    'platforms: [tiktok, instagram, youtube_shorts]',
    `query_batches: ${input.manifest.collection.query_batches.length}`,
    `hard_cap_usd: ${input.manifest.budget.hard_cap_usd}`,
    'publishing_in_scope: false',
    '```',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function recommendedContentProgram(): Array<{
  priority: number;
  name: string;
  voice: 'operator' | 'peer' | 'radar';
  problem: string;
  evidence_rule: string;
}> {
  return [
    { priority: 1, name: 'Close the Proof Gap', voice: 'operator', problem: 'My resume is all coursework or responsibilities.', evidence_rule: 'Show requirement, truthful evidence, rewrite, and review.' },
    { priority: 2, name: 'Student Scam Check', voice: 'radar', problem: 'I cannot tell whether this opportunity is legitimate.', evidence_rule: 'Verify employer source and apply current FTC checks.' },
    { priority: 3, name: 'Opportunity Radar', voice: 'radar', problem: 'I need a current opening that actually fits me.', evidence_rule: 'Show timestamp, pay, location, eligibility, deadline, and first-party URL.' },
    { priority: 4, name: 'Application Leak Check', voice: 'operator', problem: 'I applied everywhere and heard nothing.', evidence_rule: 'Diagnose one observable weakness without claiming it caused rejection.' },
    { priority: 5, name: 'No Internship, Still Build Proof', voice: 'operator', problem: 'I missed summer recruiting or have no formal experience.', evidence_rule: 'Use bounded project, campus, work, or community evidence.' },
    { priority: 6, name: 'Interview Process, Not Perfect Answers', voice: 'operator', problem: 'I freeze or ramble in interviews.', evidence_rule: 'Teach a repeatable reasoning and practice loop.' },
    { priority: 7, name: 'Coffee Chat Without the Cringe', voice: 'peer', problem: 'Networking feels transactional and awkward.', evidence_rule: 'Use a low-pressure research question and explicit follow-up boundary.' },
    { priority: 8, name: 'Rejection Reset', voice: 'peer', problem: 'Ghosting and rejection are becoming personal.', evidence_rule: 'Separate known facts, guesses, process review, and next action.' },
    { priority: 9, name: 'Internship Reality Check', voice: 'peer', problem: 'I do not know the unwritten rules after I start.', evidence_rule: 'Use observable workplace signals and a feedback loop.' },
    { priority: 10, name: 'AI, But Keep It True', voice: 'operator', problem: 'AI makes my application generic or inaccurate.', evidence_rule: 'Show source evidence, generated draft, human edit, and final control.' },
    { priority: 11, name: 'CPT and OPT Question Router', voice: 'radar', problem: 'I do not know where work-authorization questions belong.', evidence_rule: 'Link USCIS guidance and direct personal cases to the student DSO.' },
    { priority: 12, name: 'Can I Afford This Internship?', voice: 'operator', problem: 'Pay, housing, transit, and lost wages may make the role inaccessible.', evidence_rule: 'Calculate disclosed costs and label unknowns; do not give legal conclusions.' },
    { priority: 13, name: 'Small Employer Radar', voice: 'radar', problem: 'Large-brand roles are crowded and close early.', evidence_rule: 'Verify smaller-employer freshness and explain role fit.' },
    { priority: 14, name: 'Community College and Transfer Proof', voice: 'peer', problem: 'Generic advice assumes a four-year residential network.', evidence_rule: 'Use audience-specific sources and avoid deficit framing.' },
    { priority: 15, name: 'Return Offer Signal Check', voice: 'operator', problem: 'I want to turn an internship into a full-time offer.', evidence_rule: 'Teach feedback, contribution, communication, and decision checkpoints without guarantees.' },
  ];
}

export function ownedTestMatrix(): Array<{
  post: number;
  voice: 'operator' | 'peer' | 'radar';
  series: string;
  hypothesis: string;
  measures: string[];
}> {
  return [
    { post: 1, voice: 'operator', series: 'Close the Proof Gap', hypothesis: 'A visible truthful before/after earns saves and completion.', measures: ['hook retention', 'completion', 'saves'] },
    { post: 2, voice: 'peer', series: 'Rejection Reset', hypothesis: 'Recognition plus one bounded action earns shares and comments.', measures: ['shares', 'comments', 'completion'] },
    { post: 3, voice: 'radar', series: 'Opportunity Radar', hypothesis: 'Verified specifics earn saves and link clicks.', measures: ['saves', 'link clicks', 'profile visits'] },
    { post: 4, voice: 'operator', series: 'Application Leak Check', hypothesis: 'A one-leak diagnostic sustains average watch time.', measures: ['average watch time', 'completion', 'saves'] },
    { post: 5, voice: 'peer', series: 'Coffee Chat Without the Cringe', hypothesis: 'A low-pressure script earns shares without overpromising referrals.', measures: ['shares', 'saves', 'comments'] },
    { post: 6, voice: 'radar', series: 'Student Scam Check', hypothesis: 'An urgent official-source check earns completion and shares.', measures: ['completion', 'shares', 'follows'] },
    { post: 7, voice: 'operator', series: 'AI, But Keep It True', hypothesis: 'Visible human review differentiates the product and drives profile visits.', measures: ['profile visits', 'link clicks', 'saves'] },
    { post: 8, voice: 'peer', series: 'Internship Reality Check', hypothesis: 'A workplace-recognition moment grows follows and comments.', measures: ['follows', 'comments', 'shares'] },
    { post: 9, voice: 'radar', series: 'Small Employer Radar', hypothesis: 'A less-crowded verified alternative drives qualified clicks.', measures: ['link clicks', 'saves', 'completion'] },
  ];
}

function repairPlatformMinimums(
  ranked: SemanticCandidate[],
  selected: Set<string>,
  accountCounts: Map<string, number>,
  manifest: ResearchBatchManifest,
): void {
  for (const platform of manifest.collection.platforms) {
    let safety = manifest.selection.target_total * 2;
    while (countSelectedPlatform(ranked, selected, platform) < manifest.selection.minimum_per_platform && safety > 0) {
      safety -= 1;
      const incoming = ranked.find((candidate) => {
        if (selected.has(candidate.candidate_id) || candidate.platform !== platform) return false;
        const accountKey = `${candidate.platform}:${candidate.account_handle.toLowerCase()}`;
        if ((accountCounts.get(accountKey) ?? 0) >= manifest.selection.maximum_per_account) return false;
        return ranked.some((outgoing) => (
          selected.has(outgoing.candidate_id)
          && selectionGroup(outgoing) === selectionGroup(candidate)
          && outgoing.platform !== platform
          && countSelectedPlatform(ranked, selected, outgoing.platform) > manifest.selection.minimum_per_platform
        ));
      });
      if (!incoming) break;
      const outgoing = [...ranked].reverse().find((candidate) => (
        selected.has(candidate.candidate_id)
        && selectionGroup(candidate) === selectionGroup(incoming)
        && candidate.platform !== platform
        && countSelectedPlatform(ranked, selected, candidate.platform) > manifest.selection.minimum_per_platform
      ));
      if (!outgoing) break;
      selected.delete(outgoing.candidate_id);
      selected.add(incoming.candidate_id);
      const outgoingKey = `${outgoing.platform}:${outgoing.account_handle.toLowerCase()}`;
      const incomingKey = `${incoming.platform}:${incoming.account_handle.toLowerCase()}`;
      accountCounts.set(outgoingKey, Math.max(0, (accountCounts.get(outgoingKey) ?? 1) - 1));
      accountCounts.set(incomingKey, (accountCounts.get(incomingKey) ?? 0) + 1);
    }
  }
}

function exclusionReason(
  candidate: SemanticCandidate,
  ranked: SemanticCandidate[],
  selected: Set<string>,
  accountCounts: Map<string, number>,
  manifest: ResearchBatchManifest,
): string {
  const accountKey = `${candidate.platform}:${candidate.account_handle.toLowerCase()}`;
  if ((accountCounts.get(accountKey) ?? 0) >= manifest.selection.maximum_per_account) return 'account cap reached';
  const group = selectionGroup(candidate);
  if (countSelectedGroup(ranked, selected, group) >= manifest.selection.group_quotas[group]) {
    return 'source-group quota filled by higher-ranked candidates';
  }
  return 'insufficient remaining quota or platform-balance fit';
}

function normalizedPerformanceScores(candidates: SemanticCandidate[], now: Date): Map<string, number | null> {
  const groups = new Map<string, SemanticCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.platform}:${ageBucket(candidate.posted_at, now)}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const scores = new Map<string, number | null>();
  for (const group of groups.values()) {
    const observed = group.filter((candidate) => candidate.metrics.views !== null).sort((left, right) => (
      metricValue(left) - metricValue(right) || stableCompare(left.candidate_id, right.candidate_id)
    ));
    const indexById = new Map(observed.map((candidate, index) => [candidate.candidate_id, index]));
    for (const candidate of group) {
      const index = indexById.get(candidate.candidate_id);
      scores.set(candidate.candidate_id, index === undefined ? null : observed.length === 1 ? 0.5 : roundScore(index / (observed.length - 1)));
    }
  }
  return scores;
}

function selectionScore(candidate: SemanticCandidate, performance: number | null): number {
  return candidate.evidence_richness * 0.45 + candidate.novelty_score * 0.35 + (performance ?? 0.5) * 0.2;
}

function candidateRank(candidate: SemanticCandidate): number {
  return candidate.evidence_richness * 2 + candidate.novelty_score + metricValue(candidate) / 1_000_000_000;
}

function selectionGroup(candidate: SemanticCandidate): SelectionGroup {
  return candidate.human_override?.selection_group
    ?? candidate.selection_group
    ?? candidate.source_group;
}

function candidateDivergenceFields(candidates: SemanticCandidate[]): string[] {
  if (candidates.length < 2) return [];
  const fields: Array<[string, (candidate: SemanticCandidate) => unknown]> = [
    ['candidate_source', (candidate) => candidate.candidate_source ?? null],
    ['source_group', (candidate) => candidate.source_group],
    ['chosen_pillar', selectionGroup],
    ['cohort', (candidate) => candidate.cohort],
    ['posted_at', (candidate) => candidate.posted_at],
    ['metrics', (candidate) => candidate.metrics],
    ['classification_basis', (candidate) => candidate.classification_basis ?? null],
  ];
  return fields.flatMap(([field, read]) => (
    new Set(candidates.map((candidate) => JSON.stringify(read(candidate)))).size > 1 ? [field] : []
  ));
}

function metricValue(candidate: SemanticCandidate): number {
  const views = candidate.metrics.views ?? 0;
  const interactions = (candidate.metrics.likes ?? 0) + (candidate.metrics.comments ?? 0) * 2
    + (candidate.metrics.shares ?? 0) * 3 + (candidate.metrics.saves ?? 0) * 3;
  return Math.log1p(views) + (views > 0 ? Math.min(1, interactions / views) : 0);
}

function ageBucket(value: string | null, now: Date): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'unknown';
  const ageDays = Math.max(0, (now.getTime() - Date.parse(value)) / 86_400_000);
  if (ageDays <= 90) return '0_90_days';
  if (ageDays <= 365) return '91_365_days';
  return 'older_than_365_days';
}

function validateCandidate(input: unknown, index: number): SemanticCandidate {
  const value = record(input, `candidate[${index}]`);
  const sourceGroup = text(value.source_group) as SelectionGroup;
  if (!SELECTION_GROUPS.includes(sourceGroup)) throw new Error(`candidate[${index}] has invalid source_group.`);
  const selectionGroupValue = text(value.selection_group) as SelectionGroup;
  if (selectionGroupValue && !SELECTION_GROUPS.includes(selectionGroupValue)) {
    throw new Error(`candidate[${index}] has invalid selection_group.`);
  }
  const cohort = text(value.cohort) as 'recent' | 'popular';
  if (!['recent', 'popular'].includes(cohort)) throw new Error(`candidate[${index}] has invalid cohort.`);
  const cohortsObserved = value.cohorts_observed === undefined
    ? [cohort]
    : array(value.cohorts_observed, `candidate[${index}].cohorts_observed`)
      .map((entry) => requiredText(entry, `candidate[${index}].cohorts_observed`))
      .map((entry) => {
        if (!['recent', 'popular'].includes(entry)) {
          throw new Error(`candidate[${index}] has invalid cohorts_observed value.`);
        }
        return entry as 'recent' | 'popular';
      });
  const humanOverride = value.human_override === undefined || value.human_override === null
    ? null
    : validateCandidateHumanOverride(value.human_override, index);
  const metrics = record(value.metrics, `candidate[${index}].metrics`);
  return {
    candidate_id: requiredText(value.candidate_id, `candidate[${index}].candidate_id`),
    candidate_source: text(value.candidate_source) || null,
    canonical_url: requiredText(value.canonical_url, `candidate[${index}].canonical_url`),
    platform: requiredText(value.platform, `candidate[${index}].platform`) as SocialPlatform,
    platform_post_id: requiredText(value.platform_post_id, `candidate[${index}].platform_post_id`),
    account_handle: requiredText(value.account_handle, `candidate[${index}].account_handle`),
    source_group: sourceGroup,
    selection_group: selectionGroupValue || null,
    cohort,
    cohorts_observed: unique(cohortsObserved) as Array<'recent' | 'popular'>,
    cohort_assignment_basis: text(value.cohort_assignment_basis) || null,
    posted_at: nullableIso(value.posted_at, `candidate[${index}].posted_at`),
    metrics: {
      views: nullableNonNegativeNumber(metrics.views, 'views'),
      likes: nullableNonNegativeNumber(metrics.likes, 'likes'),
      comments: nullableNonNegativeNumber(metrics.comments, 'comments'),
      shares: nullableNonNegativeNumber(metrics.shares, 'shares'),
      saves: nullableNonNegativeNumber(metrics.saves, 'saves'),
    },
    evidence_richness: boundedNumber(value.evidence_richness, `candidate[${index}].evidence_richness`, 0, 1),
    novelty_score: boundedNumber(value.novelty_score, `candidate[${index}].novelty_score`, 0, 1),
    classification_basis: text(value.classification_basis) || null,
    classification_version: text(value.classification_version) || null,
    classification_confidence: nullableBoundedNumber(
      value.classification_confidence,
      `candidate[${index}].classification_confidence`,
      0,
      1,
    ),
    human_override: humanOverride,
  };
}

function validateCandidateHumanOverride(
  input: unknown,
  index: number,
): NonNullable<SemanticCandidate['human_override']> {
  const value = record(input, `candidate[${index}].human_override`);
  const group = requiredText(value.selection_group, `candidate[${index}].human_override.selection_group`) as SelectionGroup;
  if (!SELECTION_GROUPS.includes(group)) {
    throw new Error(`candidate[${index}].human_override has invalid selection_group.`);
  }
  return {
    reviewer: requiredText(value.reviewer, `candidate[${index}].human_override.reviewer`),
    reviewed_at: nullableIso(value.reviewed_at, `candidate[${index}].human_override.reviewed_at`)
      ?? (() => { throw new Error(`candidate[${index}].human_override.reviewed_at is required.`); })(),
    reason: requiredText(value.reason, `candidate[${index}].human_override.reason`),
    selection_group: group,
  };
}

function classifyAudienceThemes(value: string): string[] {
  const textValue = value.toLowerCase();
  const definitions: Array<[string, RegExp]> = [
    ['job_scam_and_verification', /(scam|fake recruiter|fake check|gift card|suspicious job)/],
    ['international_work_authorization', /(cpt|opt|international student|sponsor|work authorization|f-1)/],
    ['access_compensation_and_cost', /(unpaid|pay|salary|housing|commute|afford|low.income)/],
    ['starting_without_formal_experience', /(no experience|zero experience|never worked|class project|coursework|freshman)/],
    ['resume_and_proof', /(resume|résumé|cv|bullet|ats)/],
    ['application_silence_and_volume', /(ghost|no response|hundreds of applications|applied everywhere|application.*reject)/],
    ['interview_preparation', /(interview|behavioral|tell me about yourself|technical screen)/],
    ['networking_and_outreach', /(network|coffee chat|alumni|referral|recruiter message)/],
    ['rejection_and_wellbeing', /(reject|burnout|depress|hopeless|anxiety|giving up)/],
    ['opportunity_timing', /(deadline|summer 2027|summer 2026|too late|when.*apply|offer timeline)/],
    ['internship_performance', /(return offer|intern.*mistake|first day|manager|workplace|internship.*going)/],
    ['ai_truthfulness_and_differentiation', /(chatgpt| ai |artificial intelligence|generated resume)/],
    ['career_direction', /(major|career path|what job|direction|recent grad)/],
  ];
  const matched = definitions
    .filter(([, pattern]) => pattern.test(` ${textValue} `))
    .map(([theme]) => theme);
  return matched.length ? matched : ['general_early_career_uncertainty'];
}

function classifyAudienceSegment(value: string): AudienceSignal['audience_segment'] {
  const textValue = value.toLowerCase();
  if (/(international student|f-1|cpt|opt|sponsor)/.test(textValue)) return 'international_student';
  if (/(first.gen|community college|transfer student|low.income|cannot afford)/.test(textValue)) return 'first_generation_or_access';
  if (/(recent grad|new grad|graduated|post.grad)/.test(textValue)) return 'recent_graduate';
  if (/(college|university|freshman|sophomore|junior|senior|student|internship)/.test(textValue)) return 'college_student';
  return 'unspecified_early_career';
}

function paraphrasedNeed(theme: string): string {
  const values: Record<string, string> = {
    job_scam_and_verification: 'Students need a quick way to verify whether a job or internship message is legitimate before sharing information or money.',
    international_work_authorization: 'International students need clear routing to official work-authorization guidance and their school official without receiving improvised legal advice.',
    access_compensation_and_cost: 'Students need to understand whether the full financial cost of an internship is workable, not only whether the role sounds prestigious.',
    starting_without_formal_experience: 'Students without formal experience need help turning real coursework, projects, campus work, and responsibilities into truthful evidence.',
    resume_and_proof: 'Students want specific feedback on whether their resume demonstrates relevant proof instead of listing generic responsibilities.',
    application_silence_and_volume: 'Students applying repeatedly without responses need a bounded way to inspect targeting, evidence, timing, and process quality.',
    interview_preparation: 'Students need repeatable interview practice that improves structure and reflection without memorizing perfect answers.',
    networking_and_outreach: 'Students need low-pressure outreach language and a clear follow-up boundary that does not treat every contact as a referral request.',
    rejection_and_wellbeing: 'Students need job-search guidance that acknowledges rejection fatigue while separating market conditions from controllable next steps.',
    opportunity_timing: 'Students need current, verified timelines and alternatives when a large-employer recruiting window has already moved.',
    internship_performance: 'Students need help understanding feedback, workplace norms, contribution, and return-offer signals after an internship begins.',
    ai_truthfulness_and_differentiation: 'Students want AI assistance that preserves their real evidence and voice rather than generating generic or fabricated claims.',
    career_direction: 'Students and recent graduates need a practical way to narrow roles and industries without pretending one major determines one career.',
    general_early_career_uncertainty: 'Early-career job seekers need one specific, evidence-based next action instead of broad reassurance or guaranteed outcomes.',
  };
  return values[theme] ?? values.general_early_career_uncertainty;
}

function isEarlyCareerRelevant(value: string, community: string): boolean {
  if (community === 'r/internships') return true;
  return /(internship|intern |college|student|recent grad|new grad|entry.level|resume|job search|career fair|cpt|opt)/i.test(value);
}

function recalculateLedger(ledger: BatchLedger): BatchLedger {
  ledger.actual_cost_usd = roundMoney(ledger.lanes.reduce((sum, lane) => sum + lane.actual_cost_usd, 0));
  ledger.committed_max_cost_usd = roundMoney(ledger.lanes.reduce((sum, lane) => sum + lane.committed_max_cost_usd, 0));
  ledger.remaining_uncommitted_usd = roundMoney(ledger.hard_cap_usd - ledger.actual_cost_usd - ledger.committed_max_cost_usd);
  ledger.external_calls_made = ledger.lanes.reduce((sum, lane) => sum + lane.external_calls_made, 0);
  if (ledger.remaining_uncommitted_usd < 0) throw new Error('Batch ledger exceeded its hard cap.');
  if (ledger.lanes.some((lane) => lane.status === 'blocked_missing_prerequisite')) ledger.status = 'partially_ready';
  else if (ledger.lanes.every((lane) => ['completed', 'reserved'].includes(lane.status))) ledger.status = 'completed_with_gaps';
  else ledger.status = 'ready';
  return ledger;
}

function requiredLane(ledger: BatchLedger, laneId: ResearchLaneId): BatchLedger['lanes'][number] {
  const lane = ledger.lanes.find((item) => item.id === laneId);
  if (!lane) throw new Error(`Missing budget lane ${laneId}.`);
  return lane;
}

function cloneLedger(ledger: BatchLedger): BatchLedger {
  return JSON.parse(JSON.stringify(ledger)) as BatchLedger;
}

function countSelectedGroup(candidates: SemanticCandidate[], selected: Set<string>, group: SelectionGroup): number {
  return candidates.filter((candidate) => selected.has(candidate.candidate_id) && selectionGroup(candidate) === group).length;
}

function countSelectedPlatform(candidates: SemanticCandidate[], selected: Set<string>, platform: SocialPlatform): number {
  return candidates.filter((candidate) => selected.has(candidate.candidate_id) && candidate.platform === platform).length;
}

function elementText(value: string, element: string): string {
  const match = new RegExp(`<${element}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${element}>`).exec(value);
  return match?.[1] ?? '';
}

function cleanTransientText(value: string): string {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, key: string) => {
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return named[key.toLowerCase()] ?? match;
  });
}

function stripTracking(value: string): string {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function redactText(value: string): string {
  return value
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\/u\/[A-Za-z0-9_-]+/g, '/u/[REDACTED]')
    .slice(0, 1_000);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredText(value: unknown, label: string): string {
  const result = text(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((item, index) => requiredText(item, `${label}[${index}]`));
}

function nonEmpty(value: string | undefined): string | null {
  const result = value?.trim();
  return result || null;
}

function money(value: unknown, label: string): number {
  return boundedNumber(value, label, Number.EPSILON, Number.MAX_SAFE_INTEGER);
}

function nonNegativeMoney(value: unknown, label: string): number {
  return boundedNumber(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function nullableNonNegativeNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  return boundedNumber(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function nullableBoundedNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null || value === undefined || value === '') return null;
  return boundedNumber(value, label, minimum, maximum);
}

function nullableIso(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const result = requiredText(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO date-time or null.`);
  return result;
}

function isoOrNull(value: string): string | null {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function assertHttpsUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${label} must use https.`);
}

function counts(values: string[]): Record<string, number> {
  return Object.fromEntries([...values.reduce((map, value) => (
    map.set(value || 'unknown', (map.get(value || 'unknown') ?? 0) + 1)
  ), new Map<string, number>())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function inlineCounts(value: Record<string, number>): string {
  return Object.entries(value).map(([label, count]) => `${label} ${count}`).join(', ') || 'none';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stableCompare(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as unknown;
}

function writeJson(filePath: string, value: unknown): void {
  atomicWriteJson(filePath, value);
}

export function preflightSelectionPath(basePath: string): string {
  return `${basePath}-preflight-selection.json`;
}

function parseCli(argv: string[]): { command: string; values: Map<string, string> } {
  const command = argv[0]?.startsWith('--') ? 'prepare' : argv[0] ?? 'prepare';
  const start = command === 'prepare' && argv[0]?.startsWith('--') ? 0 : 1;
  const values = new Map<string, string>();
  for (let index = start; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    values.set(key, value);
    index += 1;
  }
  return { command, values };
}

async function main(): Promise<void> {
  const { command, values } = parseCli(process.argv.slice(2));
  const manifestPath = values.get('--manifest') ?? '.ops/competitor_research/internship-us-content-expansion-20260716.json';
  const manifest = validateResearchBatchManifest(readJson(manifestPath));
  if (command === 'validate') {
    process.stdout.write(`${JSON.stringify({ status: 'valid', batch_id: manifest.batch_id, hard_cap_usd: manifest.budget.hard_cap_usd }, null, 2)}\n`);
    return;
  }
  if (command === 'select') {
    const candidatesPath = values.get('--candidates');
    if (!candidatesPath) throw new Error('select requires --candidates.');
    const document = readJson(candidatesPath);
    const candidateRows = Array.isArray(document) ? document : array(record(document, 'candidate document').candidates, 'candidates');
    const selection = selectSemanticCandidates(candidateRows, manifest);
    const outputPath = values.get('--out') ?? `.semantic-artifacts/competitor-content/reports/${manifest.batch_id}-selection.json`;
    writeJson(outputPath, selection);
    process.stdout.write(`${JSON.stringify({ status: selection.shortfalls.length ? 'completed_with_gaps' : 'completed', selected: selection.counts.selected, output_path: outputPath }, null, 2)}\n`);
    return;
  }
  if (command !== 'prepare') throw new Error(`Unknown command ${command}. Use prepare, validate, or select.`);

  const outputDir = values.get('--out-dir') ?? '.semantic-artifacts/competitor-content/reports';
  let ledger = buildBatchPreflight(manifest);
  const audience = await collectPublicAudienceSignals(manifest);
  ledger = reserveLaneBudget(ledger, 'supplemental_retrieval', 0.01);
  ledger = settleLaneBudget(
    ledger,
    'supplemental_retrieval',
    0.01,
    0,
    audience.external_calls_made,
    audience.measurement_gaps.length ? 'partial' : 'completed',
    audience.measurement_gaps,
  );
  const selection = selectSemanticCandidates([], manifest);
  const generatedAt = new Date().toISOString();
  const sourcesPath = values.get('--sources') ?? '.ops/competitor_research/internship-us-public-source-registry-20260716.json';
  const publicSignalsPath = values.get('--public-signals') ?? '.ops/competitor_research/internship-us-public-signals-20260716.json';
  const opportunitiesPath = values.get('--opportunities') ?? '.ops/job_content_feeds/internship-us-opportunity-sample-20260716.json';
  const reportInput = {
    manifest,
    ledger,
    selection,
    audience,
    sources: readJson(sourcesPath),
    publicSignals: readJson(publicSignalsPath),
    opportunities: readJson(opportunitiesPath),
    generatedAt,
  };
  const base = path.join(outputDir, manifest.batch_id);
  writeJson(`${base}-ledger.json`, ledger);
  writeJson(`${base}-audience-signals.json`, audience);
  const selectionPreflightPath = preflightSelectionPath(base);
  writeJson(selectionPreflightPath, selection);
  writeJson(`${base}-expansion.json`, {
    schema_version: 1,
    batch_id: manifest.batch_id,
    generated_at: generatedAt,
    ledger,
    selection_artifact_state: 'preflight_no_candidates',
    selection_preflight_summary: selection.counts,
    selection_preflight_shortfalls: selection.shortfalls,
    audience_summary: {
      collected: audience.collected,
      counts_by_theme: audience.counts_by_theme,
      counts_by_community: audience.counts_by_community,
      measurement_gaps: audience.measurement_gaps,
    },
    content_program: recommendedContentProgram(),
    owned_test_matrix: ownedTestMatrix(),
    source_registry_path: sourcesPath,
    public_signals_path: publicSignalsPath,
    opportunity_sample_path: opportunitiesPath,
  });
  const markdownPath = values.get('--out-md') ?? 'docs/INTERNSHIP_US_CONTENT_DATA_EXPANSION_20260716.md';
  atomicWriteFile(markdownPath, renderExpansionMarkdown(reportInput));
  process.stdout.write(`${JSON.stringify({
    status: 'completed_with_gaps',
    batch_id: manifest.batch_id,
    actual_cost_usd: ledger.actual_cost_usd,
    audience_signals: audience.collected,
    semantic_candidates_selected: selection.counts.selected,
    output_paths: [
      `${base}-ledger.json`,
      `${base}-audience-signals.json`,
      selectionPreflightPath,
      `${base}-expansion.json`,
      markdownPath,
    ],
  }, null, 2)}\n`);
}

if (require.main === module) {
  void main();
}
