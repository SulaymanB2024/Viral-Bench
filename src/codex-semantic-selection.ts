import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteJson } from './artifact-integrity';
import {
  createBaselineDiscoveryReport,
  redactPublicPipelineText,
  type PublicPipelineRefreshStatus,
} from './scheduled-semantic-refresh';
import {
  normalizePublicPostUrl,
  type SocialPlatform,
  type UrlIntakeRequest,
} from './semantic-intelligence';
import {
  buildViralContentLibrary,
  type ViralContentItem,
  type ViralContentLibrary,
  type ViralSignal,
} from './viral-content-library';

export const CODEX_RESEARCH_BUDGET = {
  discovery_apify_usd: 4.5,
  selected_url_apify_usd: 0.5,
  apify_total_usd: 5,
  twelvelabs_usd: 4,
  total_usd: 9,
} as const;

export const CODEX_SELECTION_DIMENSIONS = [
  'breakout_signal',
  'evergreen_signal',
  'novel_format',
  'coverage_gap',
  'cross_platform_contrast',
  'longitudinal_change',
  'high_engagement_outlier',
] as const;

export type CodexSelectionDimension = typeof CODEX_SELECTION_DIMENSIONS[number];

interface DiscoveryReport {
  research_id: string;
  created_at: string;
  runs: Array<{ id: string; item_count: number; items: unknown[] }>;
  errors: Array<{ id: string; message: string }>;
  totals: {
    successful_runs: number;
    failed_runs: number;
    items: number;
    actual_cost_usd_reported: number;
    configured_max_charge_usd: number;
    conservative_spend_usd: number;
    remaining_cap_usd: number;
    external_calls_made: number;
  };
}

interface SemanticAttemptReport {
  costs: Array<{
    provider: string;
    estimated_cost_usd: number;
    actual_cost_usd: number | null;
  }>;
}

export interface CodexReviewCandidate {
  item_id: string;
  canonical_url: string;
  platform: SocialPlatform;
  content_type: ViralContentItem['content_type'];
  account_handle: string;
  caption_excerpt: string;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  observation_count: number;
  signal: ViralSignal;
  comparison_percentile: number | null;
  comparison_group_size: number;
  latest_views: number | null;
  latest_public_interactions: number | null;
  observed_view_velocity_per_hour: number | null;
  observed_interaction_velocity_per_hour: number | null;
  previously_analyzed: boolean;
  evidence_limitations: string[];
  source_runs: string[];
}

export interface CodexReviewPacket {
  schema_version: 'viralbench_codex_review_packet_v1';
  generated_at: string;
  discovery_research_id: string;
  discovery_created_at: string;
  budget: typeof CODEX_RESEARCH_BUDGET;
  selection_contract: {
    minimum: 6;
    maximum: 10;
    minimum_new_share: 0.6;
    minimum_platforms_when_available: 2;
    maximum_per_account: 3;
    eligible_platforms: ['tiktok', 'instagram'];
    eligible_content_types: ['short_video', 'feed_video'];
  };
  summary: {
    provider_rows: number;
    discovery_runs: number;
    discovery_failures: number;
    tracked_unique_items: number;
    current_discovery_items: number;
    eligible_video_candidates: number;
    tracked_but_not_twelvelabs_eligible: number;
    previously_analyzed_candidates: number;
    by_platform: Record<string, number>;
    by_signal: Record<string, number>;
  };
  candidates: CodexReviewCandidate[];
  evidence_boundaries: string[];
}

export interface CodexSelectionDecision {
  schema_version: 'viralbench_codex_selection_v1';
  decided_by: 'codex_automation';
  decided_at: string;
  authorization_basis: string;
  selection_strategy: string;
  selections: Array<{
    canonical_url: string;
    why_now: string;
    dimensions: CodexSelectionDimension[];
  }>;
}

export interface CodexSelectionSummary {
  schema_version: 'viralbench_codex_selection_summary_v1';
  decided_at: string;
  decided_by: 'codex_automation';
  selection_strategy: string;
  selected: number;
  newly_selected: number;
  by_platform: Record<string, number>;
  by_signal: Record<string, number>;
  selections: Array<CodexSelectionDecision['selections'][number] & {
    platform: SocialPlatform;
    account_handle: string;
    signal: ViralSignal;
    previously_analyzed: boolean;
  }>;
}

const MIN_SELECTIONS = 6;
const MAX_SELECTIONS = 10;
const MIN_NEW_SHARE = 0.6;
const MAX_PER_ACCOUNT = 3;
export const CODEX_SELECTION_AUTHORIZATION_BASIS = 'User authorized Codex automation to choose a bounded public-video subset after broad Apify discovery.';

export function buildCodexReviewPacket(input: {
  library: ViralContentLibrary;
  discovery: DiscoveryReport;
  previousStatus?: unknown;
  now?: () => Date;
}): CodexReviewPacket {
  validateDiscoveryBudget(input.discovery);
  const now = input.now ?? (() => new Date());
  const analyzedUrls = previousAnalysisUrls(input.previousStatus);
  const candidates = input.library.items
    .filter((item) => item.provenance.source_reports.includes(input.discovery.research_id))
    .filter((item) => ['short_video', 'feed_video'].includes(item.content_type))
    .filter((item) => ['tiktok', 'instagram'].includes(item.platform))
    .map((item): CodexReviewCandidate => {
      const latest = item.observations[item.observations.length - 1];
      return {
        item_id: item.item_id,
        canonical_url: item.canonical_url,
        platform: item.platform,
        content_type: item.content_type,
        account_handle: item.account_handle,
        caption_excerpt: item.caption.slice(0, 800),
        posted_at: item.posted_at,
        first_seen_at: item.first_seen_at,
        last_seen_at: item.last_seen_at,
        observation_count: item.observation_count,
        signal: item.performance.signal,
        comparison_percentile: item.performance.comparison_percentile,
        comparison_group_size: item.performance.comparison_group_size,
        latest_views: item.performance.latest_views,
        latest_public_interactions: item.performance.latest_public_interactions,
        observed_view_velocity_per_hour: item.performance.observed_view_velocity_per_hour,
        observed_interaction_velocity_per_hour: item.performance.observed_interaction_velocity_per_hour,
        previously_analyzed: analyzedUrls.has(item.canonical_url),
        evidence_limitations: item.performance.evidence_limitations,
        source_runs: item.provenance.source_runs,
      };
    })
    .sort(compareReviewCandidates)
    .slice(0, 200);

  const currentDiscoveryItems = input.library.items.filter((item) => (
    item.provenance.source_reports.includes(input.discovery.research_id)
  ));
  return {
    schema_version: 'viralbench_codex_review_packet_v1',
    generated_at: now().toISOString(),
    discovery_research_id: input.discovery.research_id,
    discovery_created_at: input.discovery.created_at,
    budget: CODEX_RESEARCH_BUDGET,
    selection_contract: {
      minimum: MIN_SELECTIONS,
      maximum: MAX_SELECTIONS,
      minimum_new_share: MIN_NEW_SHARE,
      minimum_platforms_when_available: 2,
      maximum_per_account: MAX_PER_ACCOUNT,
      eligible_platforms: ['tiktok', 'instagram'],
      eligible_content_types: ['short_video', 'feed_video'],
    },
    summary: {
      provider_rows: input.discovery.totals.items,
      discovery_runs: input.discovery.totals.successful_runs,
      discovery_failures: input.discovery.totals.failed_runs,
      tracked_unique_items: input.library.summary.unique_items,
      current_discovery_items: currentDiscoveryItems.length,
      eligible_video_candidates: candidates.length,
      tracked_but_not_twelvelabs_eligible: currentDiscoveryItems.filter((item) => (
        item.platform === 'youtube_shorts'
        || !['short_video', 'feed_video'].includes(item.content_type)
      )).length,
      previously_analyzed_candidates: candidates.filter((candidate) => candidate.previously_analyzed).length,
      by_platform: counts(candidates.map((candidate) => candidate.platform)),
      by_signal: counts(candidates.map((candidate) => candidate.signal)),
    },
    candidates,
    evidence_boundaries: [
      'Candidates come only from the current bounded public Apify discovery report.',
      'Codex may prioritize novelty, coverage gaps, repeated growth, or useful contrasts; raw views alone are not a global ranking.',
      'Comparisons remain within platform, content type, and age bucket.',
      'A selection is a research allocation decision, not a prediction that the creative mechanism caused performance.',
      'Only TikTok and Instagram video rows are currently TwelveLabs-eligible; YouTube Shorts remain tracked until their Actor has a verified direct-media route.',
      'Images and carousels remain tracked in the library but are not sent to TwelveLabs.',
    ],
  };
}

export function validateCodexSelectionDecision(
  packet: CodexReviewPacket,
  input: unknown,
): CodexSelectionDecision {
  const decision = record(input, 'Codex selection decision');
  if (decision.schema_version !== 'viralbench_codex_selection_v1') {
    throw new Error('selection schema_version must be viralbench_codex_selection_v1.');
  }
  if (decision.decided_by !== 'codex_automation') {
    throw new Error('selection decided_by must be codex_automation.');
  }
  const decidedAt = requiredText(decision.decided_at, 'decided_at');
  if (!Number.isFinite(Date.parse(decidedAt))) throw new Error('decided_at must be an ISO date-time.');
  if (requiredText(decision.authorization_basis, 'authorization_basis') !== CODEX_SELECTION_AUTHORIZATION_BASIS) {
    throw new Error('selection authorization_basis does not match the standing user authorization.');
  }
  const selectionStrategy = requiredText(decision.selection_strategy, 'selection_strategy');
  if (selectionStrategy.length < 60) {
    throw new Error('selection_strategy must explain the cross-candidate allocation in at least 60 characters.');
  }
  if (!Array.isArray(decision.selections)) throw new Error('selections must be an array.');
  if (decision.selections.length < MIN_SELECTIONS || decision.selections.length > MAX_SELECTIONS) {
    throw new Error(`selections must contain ${MIN_SELECTIONS} to ${MAX_SELECTIONS} candidates.`);
  }

  const candidateByUrl = new Map(packet.candidates.map((candidate) => [candidate.canonical_url, candidate]));
  const seen = new Set<string>();
  const normalizedSelections = decision.selections.map((raw, index) => {
    const selection = record(raw, `selections[${index}]`);
    const normalized = normalizePublicPostUrl(requiredText(selection.canonical_url, `selections[${index}].canonical_url`));
    if (seen.has(normalized.canonical_url)) throw new Error(`Duplicate selection URL ${normalized.canonical_url}.`);
    seen.add(normalized.canonical_url);
    const candidate = candidateByUrl.get(normalized.canonical_url);
    if (!candidate) throw new Error(`Selection URL is not eligible in the current review packet: ${normalized.canonical_url}.`);
    const whyNow = requiredText(selection.why_now, `selections[${index}].why_now`);
    if (whyNow.length < 40) throw new Error(`selections[${index}].why_now must contain at least 40 characters.`);
    if (!Array.isArray(selection.dimensions) || !selection.dimensions.length) {
      throw new Error(`selections[${index}].dimensions must be a non-empty array.`);
    }
    const dimensions = unique(selection.dimensions.map((value) => {
      if (typeof value !== 'string' || !CODEX_SELECTION_DIMENSIONS.includes(value as CodexSelectionDimension)) {
        throw new Error(`selections[${index}] contains an unsupported decision dimension.`);
      }
      return value as CodexSelectionDimension;
    }));
    if (candidate.previously_analyzed && !dimensions.includes('longitudinal_change')) {
      throw new Error(`Previously analyzed selection ${normalized.canonical_url} requires longitudinal_change.`);
    }
    return {
      canonical_url: normalized.canonical_url,
      why_now: whyNow,
      dimensions,
    };
  });

  const selectedCandidates = normalizedSelections.map((selection) => candidateByUrl.get(selection.canonical_url)!);
  const availablePlatforms = new Set(packet.candidates.map((candidate) => candidate.platform));
  const selectedPlatforms = new Set(selectedCandidates.map((candidate) => candidate.platform));
  if (availablePlatforms.size >= 2 && selectedPlatforms.size < 2) {
    throw new Error('Selection must cover at least two available platforms.');
  }
  const accountCounts = counts(selectedCandidates.map((candidate) => `${candidate.platform}:${candidate.account_handle.toLowerCase()}`));
  const concentrated = Object.entries(accountCounts).find(([, count]) => count > MAX_PER_ACCOUNT);
  if (concentrated) throw new Error(`Selection exceeds the ${MAX_PER_ACCOUNT}-item account cap for ${concentrated[0]}.`);
  const newAvailable = packet.candidates.filter((candidate) => !candidate.previously_analyzed).length;
  const minimumNew = Math.min(
    normalizedSelections.length,
    newAvailable,
    Math.ceil(normalizedSelections.length * MIN_NEW_SHARE),
  );
  const newSelected = selectedCandidates.filter((candidate) => !candidate.previously_analyzed).length;
  if (newSelected < minimumNew) {
    throw new Error(`Selection requires at least ${minimumNew} candidates not previously analyzed; received ${newSelected}.`);
  }

  return {
    schema_version: 'viralbench_codex_selection_v1',
    decided_by: 'codex_automation',
    decided_at: new Date(decidedAt).toISOString(),
    authorization_basis: CODEX_SELECTION_AUTHORIZATION_BASIS,
    selection_strategy: selectionStrategy,
    selections: normalizedSelections,
  };
}

export function buildApprovedSelection(
  packet: CodexReviewPacket,
  decisionInput: unknown,
): { decision: CodexSelectionDecision; manifest: UrlIntakeRequest; summary: CodexSelectionSummary } {
  const decision = validateCodexSelectionDecision(packet, decisionInput);
  const candidateByUrl = new Map(packet.candidates.map((candidate) => [candidate.canonical_url, candidate]));
  const selectedCandidates = decision.selections.map((selection) => candidateByUrl.get(selection.canonical_url)!);
  const allowedPlatforms = (['tiktok', 'instagram', 'youtube_shorts'] as const)
    .filter((platform) => selectedCandidates.some((candidate) => candidate.platform === platform));
  const manifest: UrlIntakeRequest = {
    request_id: `${packet.discovery_research_id}-${decision.decided_at.slice(0, 10)}-codex-selection`,
    urls: decision.selections.map((selection) => selection.canonical_url),
    allowed_platforms: allowedPlatforms,
    comment_policy: {
      enabled: false,
      max_high_engagement: 0,
      max_recent: 0,
      max_replies_per_thread: 0,
    },
    approval_state: 'approved',
    cost_limits: {
      max_total_usd: CODEX_RESEARCH_BUDGET.selected_url_apify_usd + CODEX_RESEARCH_BUDGET.twelvelabs_usd,
      max_apify_usd: CODEX_RESEARCH_BUDGET.selected_url_apify_usd,
      max_twelvelabs_usd: CODEX_RESEARCH_BUDGET.twelvelabs_usd,
      max_gemini_usd: 0,
    },
  };
  const selections = decision.selections.map((selection) => {
    const candidate = candidateByUrl.get(selection.canonical_url)!;
    return {
      ...selection,
      platform: candidate.platform,
      account_handle: candidate.account_handle,
      signal: candidate.signal,
      previously_analyzed: candidate.previously_analyzed,
    };
  });
  return {
    decision,
    manifest,
    summary: {
      schema_version: 'viralbench_codex_selection_summary_v1',
      decided_at: decision.decided_at,
      decided_by: decision.decided_by,
      selection_strategy: decision.selection_strategy,
      selected: selections.length,
      newly_selected: selections.filter((selection) => !selection.previously_analyzed).length,
      by_platform: counts(selections.map((selection) => selection.platform)),
      by_signal: counts(selections.map((selection) => selection.signal)),
      selections,
    },
  };
}

export function finalizeCodexRefresh(input: {
  discovery: DiscoveryReport;
  packet: CodexReviewPacket;
  decision: unknown;
  semanticStatus: PublicPipelineRefreshStatus | unknown;
  library: ViralContentLibrary;
  priorAttemptReports?: SemanticAttemptReport[];
}): Record<string, unknown> {
  const approved = buildApprovedSelection(input.packet, input.decision);
  const semanticStatus = record(input.semanticStatus, 'semantic refresh status');
  const providers = record(semanticStatus.providers, 'semantic refresh providers');
  const apify = record(providers.apify, 'semantic refresh Apify provider');
  const twelvelabs = record(providers.twelvelabs, 'semantic refresh TwelveLabs provider');
  const selectedApifySpend = nonNegativeNumber(apify.actual_or_conservative_usd, 'selected Apify spend');
  const twelvelabsSpend = nonNegativeNumber(twelvelabs.actual_or_conservative_usd, 'TwelveLabs spend');
  const priorApifySpend = providerAttemptCost(input.priorAttemptReports ?? [], 'apify');
  const priorTwelvelabsSpend = providerAttemptCost(input.priorAttemptReports ?? [], 'twelvelabs');
  const discoveryApifySpend = input.discovery.totals.conservative_spend_usd;
  const apifySpend = round(discoveryApifySpend + priorApifySpend + selectedApifySpend);
  const cumulativeTwelvelabsSpend = round(priorTwelvelabsSpend + twelvelabsSpend);
  const totalSpend = round(apifySpend + cumulativeTwelvelabsSpend);
  if (apifySpend > CODEX_RESEARCH_BUDGET.apify_total_usd + 1e-9) {
    throw new Error(`Combined Apify spend ${apifySpend} exceeds the ${CODEX_RESEARCH_BUDGET.apify_total_usd} USD cap.`);
  }
  if (cumulativeTwelvelabsSpend > CODEX_RESEARCH_BUDGET.twelvelabs_usd + 1e-9) {
    throw new Error(`TwelveLabs spend ${cumulativeTwelvelabsSpend} exceeds the ${CODEX_RESEARCH_BUDGET.twelvelabs_usd} USD cap.`);
  }
  if (totalSpend > CODEX_RESEARCH_BUDGET.total_usd + 1e-9) {
    throw new Error(`Combined provider spend ${totalSpend} exceeds the ${CODEX_RESEARCH_BUDGET.total_usd} USD cap.`);
  }
  const evidenceBoundaries = Array.isArray(semanticStatus.evidence_boundaries)
    ? semanticStatus.evidence_boundaries.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    ...semanticStatus,
    schema_version: 'viralbench_pipeline_refresh_v2',
    budget: {
      currency: 'USD',
      max_total_usd: CODEX_RESEARCH_BUDGET.total_usd,
      max_apify_usd: CODEX_RESEARCH_BUDGET.apify_total_usd,
      max_twelvelabs_usd: CODEX_RESEARCH_BUDGET.twelvelabs_usd,
      apify_discovery_ceiling_usd: CODEX_RESEARCH_BUDGET.discovery_apify_usd,
      apify_selected_url_ceiling_usd: CODEX_RESEARCH_BUDGET.selected_url_apify_usd,
      actual_or_conservative_usd: totalSpend,
      apify_actual_or_conservative_usd: apifySpend,
      twelvelabs_actual_or_conservative_usd: cumulativeTwelvelabsSpend,
      prior_attempts_actual_or_conservative_usd: round(priorApifySpend + priorTwelvelabsSpend),
    },
    source: {
      ...record(semanticStatus.source, 'semantic refresh source'),
      discovery_research_id: input.discovery.research_id,
      discovery_rows: input.discovery.totals.items,
      discovery_runs: input.discovery.totals.successful_runs,
      discovery_failures: input.discovery.totals.failed_runs,
    },
    providers: {
      ...providers,
      apify: {
        ...apify,
        actual_or_conservative_usd: apifySpend,
        discovery_actual_or_conservative_usd: discoveryApifySpend,
        selected_attempts_actual_or_conservative_usd: round(priorApifySpend + selectedApifySpend),
      },
      twelvelabs: {
        ...twelvelabs,
        actual_or_conservative_usd: cumulativeTwelvelabsSpend,
        recovery_attempts: input.priorAttemptReports?.length ?? 0,
      },
    },
    orchestration: {
      decided_by: approved.decision.decided_by,
      decided_at: approved.decision.decided_at,
      selection_strategy: approved.decision.selection_strategy,
      eligible_video_candidates: input.packet.summary.eligible_video_candidates,
      selected_videos: approved.summary.selected,
      newly_selected_videos: approved.summary.newly_selected,
      selected_by_platform: approved.summary.by_platform,
      recovery_attempts: input.priorAttemptReports?.length ?? 0,
      selections: approved.summary.selections,
    },
    results: {
      ...record(semanticStatus.results, 'semantic refresh results'),
      broad_discovery_rows: input.discovery.totals.items,
      broad_library_unique_items: input.library.summary.unique_items,
      broad_library_observations: input.library.summary.observations,
    },
    evidence_boundaries: [
      'Apify first collects a broad public surface; Codex then allocates the separate TwelveLabs budget to a smaller documented subset.',
      'The 5 USD Apify cap includes both broad discovery and selected-item media retrieval.',
      'Codex selection is constrained by novelty, platform coverage, account concentration, and explicit evidence rationales.',
      'Failed publication attempts remain in cumulative provider accounting; a recovery run never resets the budget.',
      ...evidenceBoundaries,
    ],
    errors: Array.isArray(semanticStatus.errors)
      ? semanticStatus.errors.map((value) => redactPublicPipelineText(value, 500))
      : [],
    measurement_gaps: Array.isArray(semanticStatus.measurement_gaps)
      ? semanticStatus.measurement_gaps.map((value) => redactPublicPipelineText(value, 500))
      : [],
  };
}

function providerAttemptCost(reports: SemanticAttemptReport[], provider: string): number {
  return round(reports.flatMap((report) => report.costs ?? [])
    .filter((entry) => entry.provider === provider)
    .reduce((sum, entry) => sum + (entry.actual_cost_usd ?? entry.estimated_cost_usd), 0));
}

function validateDiscoveryBudget(discovery: DiscoveryReport): void {
  if (!discovery.research_id?.trim() || !Array.isArray(discovery.runs) || !discovery.totals) {
    throw new Error('Discovery report is incomplete.');
  }
  if (discovery.totals.configured_max_charge_usd !== CODEX_RESEARCH_BUDGET.discovery_apify_usd) {
    throw new Error(`Discovery ceiling must be ${CODEX_RESEARCH_BUDGET.discovery_apify_usd} USD.`);
  }
  if (discovery.totals.conservative_spend_usd > CODEX_RESEARCH_BUDGET.discovery_apify_usd + 1e-9) {
    throw new Error('Discovery conservative spend exceeds its Apify allocation.');
  }
}

function previousAnalysisUrls(input: unknown): Set<string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return new Set();
  const analyses = (input as Record<string, unknown>).analyses;
  if (!Array.isArray(analyses)) return new Set();
  const urls = analyses.flatMap((analysis) => {
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return [];
    const value = (analysis as Record<string, unknown>).canonical_url;
    if (typeof value !== 'string') return [];
    try {
      return [normalizePublicPostUrl(value).canonical_url];
    } catch {
      return [];
    }
  });
  return new Set(urls);
}

function compareReviewCandidates(left: CodexReviewCandidate, right: CodexReviewCandidate): number {
  return signalPriority(left.signal) - signalPriority(right.signal)
    || Number(left.previously_analyzed) - Number(right.previously_analyzed)
    || (right.comparison_percentile ?? -1) - (left.comparison_percentile ?? -1)
    || (right.observed_view_velocity_per_hour ?? -1) - (left.observed_view_velocity_per_hour ?? -1)
    || (right.latest_public_interactions ?? -1) - (left.latest_public_interactions ?? -1)
    || left.item_id.localeCompare(right.item_id);
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

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as T;
}

function option(argv: string[], name: string, fallback?: string): string {
  const index = argv.indexOf(name);
  if (index < 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} is required.`);
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function buildPacketCommand(argv: string[]): void {
  const discoveryPath = option(argv, '--discovery');
  const baselineLibraryPath = option(argv, '--baseline-library', 'internship-reels-site/library.json');
  const previousStatusPath = option(argv, '--previous-status', 'internship-reels-site/data/pipeline-refresh.json');
  const dbPath = option(argv, '--db', '.semantic-artifacts/competitor-content/semantic_corpus.sqlite');
  const artifactDir = option(argv, '--artifact-dir', '.semantic-artifacts/scheduled-research/current');
  const baselineLibrary = readJson<ViralContentLibrary>(baselineLibraryPath);
  const discovery = readJson<DiscoveryReport>(discoveryPath);
  const baselineReportPath = path.join(artifactDir, 'published-library-baseline.json');
  const proposedLibraryPath = path.join(artifactDir, 'proposed-library.json');
  const packetPath = path.join(artifactDir, 'codex-review-packet.json');
  atomicWriteJson(
    path.resolve(baselineReportPath),
    createBaselineDiscoveryReport(baselineLibrary, discovery.research_id, 0),
  );
  const library = buildViralContentLibrary({
    discoveryFiles: [baselineReportPath, discoveryPath],
    sqlitePath: fs.existsSync(path.resolve(dbPath)) ? dbPath : null,
  });
  const previousStatus = fs.existsSync(path.resolve(previousStatusPath))
    ? readJson<unknown>(previousStatusPath)
    : undefined;
  const packet = buildCodexReviewPacket({ library, discovery, previousStatus });
  atomicWriteJson(path.resolve(proposedLibraryPath), library);
  atomicWriteJson(path.resolve(packetPath), packet);
  process.stdout.write(`${JSON.stringify({
    packet_path: packetPath,
    proposed_library_path: proposedLibraryPath,
    ...packet.summary,
    external_calls_made: 0,
  }, null, 2)}\n`);
}

function approveCommand(argv: string[]): void {
  const packetPath = option(argv, '--packet');
  const decisionPath = option(argv, '--decision');
  const manifestPath = option(argv, '--manifest', '.ops/url_intake_requests/scheduled-codex-current.json');
  const summaryPath = option(argv, '--summary', '.semantic-artifacts/scheduled-research/current/codex-selection-summary.json');
  const approved = buildApprovedSelection(
    readJson<CodexReviewPacket>(packetPath),
    readJson<unknown>(decisionPath),
  );
  atomicWriteJson(path.resolve(manifestPath), approved.manifest);
  atomicWriteJson(path.resolve(summaryPath), approved.summary);
  process.stdout.write(`${JSON.stringify({
    manifest_path: manifestPath,
    summary_path: summaryPath,
    selected: approved.summary.selected,
    newly_selected: approved.summary.newly_selected,
    by_platform: approved.summary.by_platform,
    apify_total_cap_usd: CODEX_RESEARCH_BUDGET.apify_total_usd,
    twelvelabs_cap_usd: CODEX_RESEARCH_BUDGET.twelvelabs_usd,
    external_calls_made: 0,
  }, null, 2)}\n`);
}

function finalizeCommand(argv: string[]): void {
  const discovery = readJson<DiscoveryReport>(option(argv, '--discovery'));
  const packet = readJson<CodexReviewPacket>(option(argv, '--packet'));
  const decision = readJson<unknown>(option(argv, '--decision'));
  const semanticStatus = readJson<unknown>(option(argv, '--semantic-status'));
  const proposedLibrary = readJson<ViralContentLibrary>(option(argv, '--proposed-library'));
  const siteStatusPath = option(argv, '--site-status', 'internship-reels-site/data/pipeline-refresh.json');
  const siteLibraryPath = option(argv, '--site-library', 'internship-reels-site/library.json');
  const priorReportPaths = repeatedOptions(argv, '--prior-semantic-report');
  const status = finalizeCodexRefresh({
    discovery,
    packet,
    decision,
    semanticStatus,
    library: proposedLibrary,
    priorAttemptReports: priorReportPaths.map((filePath) => readJson<SemanticAttemptReport>(filePath)),
  });
  atomicWriteJson(path.resolve(siteStatusPath), status);
  atomicWriteJson(path.resolve(siteLibraryPath), proposedLibrary);
  process.stdout.write(`${JSON.stringify({
    site_status_path: siteStatusPath,
    site_library_path: siteLibraryPath,
    status: status.status,
    budget: status.budget,
    orchestration: status.orchestration,
    external_calls_made: 0,
  }, null, 2)}\n`);
}

function repeatedOptions(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    values.push(value);
    index += 1;
  }
  return values;
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === 'packet') return buildPacketCommand(argv.slice(1));
  if (command === 'approve') return approveCommand(argv.slice(1));
  if (command === 'finalize') return finalizeCommand(argv.slice(1));
  throw new Error('Choose packet, approve, or finalize.');
}

if (require.main === module) main();
