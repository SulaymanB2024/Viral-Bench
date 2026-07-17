import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  atomicWriteJson,
  hashFile,
  sha256,
  stableJson,
} from './artifact-integrity';
import { classifyEnglishEvidence } from './content-language';
import { generateTwelveLabsDashboard } from './twelvelabs-visual-demo';
import { PEGASUS_MODEL } from './semantic-intelligence';
import {
  estimateTwelveLabsAnalysisCost,
  TwelveLabsClient,
  type TwelveLabsSegmentDefinition,
  type TwelveLabsSegmentationAnalysis,
  type TwelveLabsStructuredAnalysis,
  type TwelveLabsTimeSegment,
} from './semantic-pipeline';
import type { InternshipMediaManifest } from './internship-media-prep';
import type { SelectionLedger } from './internship-research-batch';

const LANE_CAP_USD = 12;
const DEFAULT_COHORT_SIZE = 6;
const DEFAULT_SUCCESS_PERCENTILE = 0.9;
const DEFAULT_MAX_DURATION_SEC = 90;
const STRATEGY_MAX_OUTPUT_TOKENS = 2_048;
const SEGMENTATION_MAX_OUTPUT_TOKENS = 32_768;
const RETRY_MAX_OUTPUT_TOKENS = 16_384;
const DEEP_ANALYSIS_PROFILE = 'successful_content_deep_clone_v1' as const;
const DEEP_ANALYSIS_CONTRACT_VERSION = 'deep_clone_contract_v2';
const QUALITY_MINIMUM_COVERAGE = 0.9;
const QUALITY_MAXIMUM_GAP_SEC = 2.01;

interface StrategyAnalysis {
  opening: {
    start_sec: number;
    end_sec: number;
    observed_words: string;
    observed_visual: string;
    mechanism: string;
  };
  content_arc: {
    audience_problem: string;
    progression: string;
    payoff: string;
  };
  cta: {
    observed_words: string;
    requested_action: string;
  };
  claims: Array<{
    observed_claim: string;
    evidence_status: 'visible' | 'spoken' | 'unsupported';
  }>;
  transferable_structure: {
    hook_pattern: string;
    beat_pattern: string;
    payoff_pattern: string;
  };
  evidence_limitations: string[];
}

export interface DeepAnalysisCohortEntry {
  row: InternshipMediaManifest['rows'][number];
  selection: SelectionLedger['entries'][number];
  success_percentile: number;
  complexity_score: number;
  cohort_rank: number;
  selection_basis: 'within_platform_and_age_bucket_success_then_complexity';
}

export interface DeepAnalysisQuality {
  passed: boolean;
  definition_counts: Record<string, number>;
  definition_coverage: Record<string, {
    coverage_ratio: number;
    max_gap_sec: number;
  }>;
  visual_coverage_ratio: number;
  max_visual_gap_sec: number;
  audio_coverage_ratio: number;
  max_audio_gap_sec: number;
  editing_coverage_ratio: number;
  max_editing_gap_sec: number;
  missing_metadata_fields: string[];
  retry_definition_ids: string[];
}

export interface DeepAnalysisInputFingerprint {
  schema_version: 1;
  fingerprint_sha256: string;
  inputs: {
    analysis_profile: typeof DEEP_ANALYSIS_PROFILE;
    contract_version: typeof DEEP_ANALYSIS_CONTRACT_VERSION;
    provider_model: typeof PEGASUS_MODEL;
    media_sha256: string;
    media_bytes: number;
    media_duration_sec: number | null;
    strategy_prompt_sha256: string;
    strategy_schema_sha256: string;
    segment_definitions_sha256: string;
    quality_contract_sha256: string;
  };
}

export interface DeepAnalysisRecord {
  candidate_id: string;
  platform: string;
  platform_post_id: string;
  canonical_url: string;
  chosen_pillar: string;
  analysis_profile: typeof DEEP_ANALYSIS_PROFILE;
  input_fingerprint: DeepAnalysisInputFingerprint;
  cohort: {
    rank: number;
    success_percentile: number;
    complexity_score: number;
    comparison_method: 'within_platform_and_age_bucket_percentile';
  };
  provider_asset_id: string;
  strategy: TwelveLabsStructuredAnalysis<StrategyAnalysis>;
  segmentation: TwelveLabsSegmentationAnalysis;
  retry_segmentation: TwelveLabsSegmentationAnalysis | null;
  first_pass_quality: DeepAnalysisQuality;
  quality: DeepAnalysisQuality;
  retry_performed: boolean;
  maximum_estimated_cost_usd: number;
  usage_pricing_estimate_usd: number | null;
  external_calls_made: number;
}

interface ExistingMultimodalRecord {
  candidate_id: string;
  analysis: {
    speech: Array<{ text: string }>;
    on_screen_text: Array<{ text: string }>;
  };
}

interface CohortOptions {
  limit?: number;
  minimumSuccessPercentile?: number;
  eligibleCandidateIds?: ReadonlySet<string>;
  maxDurationSec?: number;
}

export function selectDeepAnalysisCohort(
  manifest: InternshipMediaManifest,
  selection: SelectionLedger,
  options: CohortOptions = {},
): DeepAnalysisCohortEntry[] {
  if (manifest.batch_id !== selection.batch_id) {
    throw new Error('media manifest and selection ledger must belong to the same batch');
  }
  const limit = options.limit ?? DEFAULT_COHORT_SIZE;
  const minimumSuccessPercentile = options.minimumSuccessPercentile ?? DEFAULT_SUCCESS_PERCENTILE;
  const maxDurationSec = options.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('deep-analysis cohort limit must be a positive integer');
  if (minimumSuccessPercentile < 0 || minimumSuccessPercentile > 1) {
    throw new Error('minimum success percentile must be between zero and one');
  }
  if (!(maxDurationSec > 0)) throw new Error('deep-analysis maximum duration must be positive');
  const selectedById = new Map(selection.entries
    .filter((entry) => entry.selected)
    .map((entry) => [entry.candidate_id, entry]));
  const ranked = manifest.rows.flatMap((row): DeepAnalysisCohortEntry[] => {
    const selected = selectedById.get(row.candidate_id);
    if (
      !selected
      || (options.eligibleCandidateIds && !options.eligibleCandidateIds.has(row.candidate_id))
      || row.retrieval_state !== 'ready'
      || !row.media_path
      || row.media_kind !== 'downloaded_public_video'
      || row.duration_sec === null
      || row.duration_sec > maxDurationSec
      || row.limitation
      || selected.normalized_performance_score === null
      || selected.normalized_performance_score < minimumSuccessPercentile
    ) return [];
    return [{
      row,
      selection: selected,
      success_percentile: selected.normalized_performance_score,
      complexity_score: contentComplexityScore(row.duration_sec, selected.evidence_richness, selected.novelty_score),
      cohort_rank: 0,
      selection_basis: 'within_platform_and_age_bucket_success_then_complexity',
    }];
  }).sort((left, right) => (
    right.success_percentile - left.success_percentile
    || right.complexity_score - left.complexity_score
    || left.row.candidate_id.localeCompare(right.row.candidate_id)
  )).slice(0, limit);
  return ranked.map((entry, index) => ({ ...entry, cohort_rank: index + 1 }));
}

export function loadEnglishCandidateIds(analysisDir: string): Set<string> {
  const root = path.resolve(analysisDir);
  if (!fs.existsSync(root)) return new Set();
  return new Set(fs.readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name): string[] => {
      const record = read<ExistingMultimodalRecord>(path.join(root, name));
      const language = classifyEnglishEvidence(
        record.analysis.speech.map((segment) => segment.text).join(' '),
        record.analysis.on_screen_text.map((segment) => segment.text).join(' '),
      );
      return language.is_english ? [record.candidate_id] : [];
    }));
}

export function deepCloneSegmentDefinitions(): TwelveLabsSegmentDefinition[] {
  return [
    {
      id: 'visual_shots',
      description: 'Partition the entire video into consecutive visual shots or slides whenever composition, subject action, or displayed content materially changes.',
      fields: [
        {
          name: 'visual_description',
          type: 'string',
          description: 'Concrete visible subjects, objects, background, composition, and action in this segment. Describe only observed evidence.',
        },
        {
          name: 'camera_and_motion',
          type: 'string',
          description: 'Framing, angle, camera movement, zoom, crop, and subject motion. Use "static" when none is observed.',
        },
        {
          name: 'on_screen_text_exact',
          type: 'string',
          description: 'All legible on-screen text exactly as displayed, followed by its position and styling. Use "none" when no text is visible.',
        },
      ],
    },
    {
      id: 'audio_beats',
      description: 'Partition the entire video into consecutive audio states whenever speaker, line, delivery, music, sound effect, or silence changes.',
      fields: [
        {
          name: 'speech_exact',
          type: 'string',
          description: 'Exact audible words in this segment. Use "none" for silence, music-only, or unintelligible speech and do not invent a transcript.',
        },
        {
          name: 'delivery',
          type: 'string',
          description: 'Observed vocal pace, emphasis, tone, pauses, and speaker changes. Use "none" when speech is absent.',
        },
        {
          name: 'music_and_sound',
          type: 'string',
          description: 'Observed music, ambience, sound effects, beats, and their relationship to the visual edit. Use "none" when absent.',
        },
      ],
    },
    {
      id: 'editing_beats',
      description: 'Partition the entire video into consecutive editing beats whenever transition, layout, motion treatment, or attention device changes.',
      fields: [
        {
          name: 'transition_in',
          type: 'string',
          description: 'Exact transition entering this beat, such as hard cut, fade, jump cut, swipe, zoom, or opening frame.',
        },
        {
          name: 'layout_and_motion',
          type: 'string',
          description: 'Layer arrangement, caption placement, graphics, overlays, animation, and motion treatment during this beat.',
        },
        {
          name: 'attention_device',
          type: 'string',
          description: 'Observed device used to renew attention, such as reveal, text change, gesture, proof insert, pattern interrupt, or "none".',
        },
      ],
    },
  ];
}

export function buildDeepAnalysisInputFingerprint(
  row: InternshipMediaManifest['rows'][number],
  strategyPrompt: string,
  definitions: TwelveLabsSegmentDefinition[] = deepCloneSegmentDefinitions(),
): DeepAnalysisInputFingerprint {
  if (!row.media_path) throw new Error(`${row.candidate_id}: deep analysis requires a local media path`);
  const mediaPath = path.resolve(row.media_path);
  const stat = fs.statSync(mediaPath);
  if (!stat.isFile()) throw new Error(`${row.candidate_id}: media path is not a file`);
  const mediaSha256 = hashFile(mediaPath);
  if (row.media_sha256 && row.media_sha256 !== mediaSha256) {
    throw new Error(`${row.candidate_id}: media SHA-256 does not match the manifest`);
  }
  if (row.byte_size !== null && row.byte_size !== stat.size) {
    throw new Error(`${row.candidate_id}: media byte size does not match the manifest`);
  }
  const inputs: DeepAnalysisInputFingerprint['inputs'] = {
    analysis_profile: DEEP_ANALYSIS_PROFILE,
    contract_version: DEEP_ANALYSIS_CONTRACT_VERSION,
    provider_model: PEGASUS_MODEL,
    media_sha256: mediaSha256,
    media_bytes: stat.size,
    media_duration_sec: row.duration_sec,
    strategy_prompt_sha256: sha256(strategyPrompt),
    strategy_schema_sha256: sha256(stableJson(strategyAnalysisSchema())),
    segment_definitions_sha256: sha256(stableJson(definitions)),
    quality_contract_sha256: sha256(stableJson({
      minimum_coverage: QUALITY_MINIMUM_COVERAGE,
      maximum_gap_sec: QUALITY_MAXIMUM_GAP_SEC,
      required_definitions: definitions.map((definition) => ({
        id: definition.id,
        fields: definition.fields.map((field) => field.name),
      })),
    })),
  };
  return {
    schema_version: 1,
    fingerprint_sha256: sha256(stableJson(inputs)),
    inputs,
  };
}

export function validateDeepAnalysisCache(
  record: unknown,
  expected: DeepAnalysisInputFingerprint,
  definitions: TwelveLabsSegmentDefinition[] = deepCloneSegmentDefinitions(),
): { reusable: boolean; reasons: string[] } {
  const root = record && typeof record === 'object' && !Array.isArray(record)
    ? record as Partial<DeepAnalysisRecord>
    : {};
  const reasons: string[] = [];
  if (root.analysis_profile !== DEEP_ANALYSIS_PROFILE) reasons.push('analysis profile changed');
  if (!root.input_fingerprint) {
    reasons.push('input fingerprint missing');
  } else if (
    root.input_fingerprint.schema_version !== expected.schema_version
    || root.input_fingerprint.fingerprint_sha256 !== expected.fingerprint_sha256
    || stableJson(root.input_fingerprint.inputs) !== stableJson(expected.inputs)
  ) {
    reasons.push('input fingerprint changed');
  }
  if (!root.quality?.passed) reasons.push('quality gate not passed');
  if (root.quality?.retry_definition_ids?.length) reasons.push('quality retry remains required');
  for (const definition of definitions) {
    const definitionCount = root.quality?.definition_counts?.[definition.id] ?? 0;
    if (definitionCount <= 0) {
      reasons.push(`${definition.id} output missing`);
    }
    const coverage = root.quality?.definition_coverage?.[definition.id];
    if (
      !coverage
      || coverage.coverage_ratio < QUALITY_MINIMUM_COVERAGE
      || coverage.max_gap_sec > QUALITY_MAXIMUM_GAP_SEC
    ) reasons.push(`${definition.id} coverage incomplete`);
  }
  return { reusable: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function deepAnalysisMaximumEstimate(
  manifest: InternshipMediaManifest,
  selection: SelectionLedger,
  options: CohortOptions = {},
): number {
  return money(selectDeepAnalysisCohort(manifest, selection, options).reduce((sum, entry) => (
    sum + maximumItemEstimate(entry.row.duration_sec ?? 0, deepCloneSegmentDefinitions().length)
  ), 0));
}

export function maximumBatchEstimate(
  manifest: InternshipMediaManifest,
  limit = Number.MAX_SAFE_INTEGER,
): number {
  return money(manifest.rows.filter((row) => row.retrieval_state === 'ready').slice(0, limit)
    .reduce((sum, row) => sum + estimateTwelveLabsAnalysisCost(row.duration_sec ?? 0, 4_096), 0));
}

export async function analyzeInternshipMedia(options: {
  apiKey: string;
  manifest: InternshipMediaManifest;
  selection: SelectionLedger;
  strategyPrompt: string;
  outputDir: string;
  limit?: number;
  minimumSuccessPercentile?: number;
  eligibleCandidateIds?: ReadonlySet<string>;
  clientFactory?: () => TwelveLabsClient;
}): Promise<Record<string, unknown>> {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const cohort = selectDeepAnalysisCohort(options.manifest, options.selection, {
    limit: options.limit,
    minimumSuccessPercentile: options.minimumSuccessPercentile,
    eligibleCandidateIds: options.eligibleCandidateIds,
  });
  const maximumBatchCost = deepAnalysisMaximumEstimate(options.manifest, options.selection, {
    limit: options.limit,
    minimumSuccessPercentile: options.minimumSuccessPercentile,
    eligibleCandidateIds: options.eligibleCandidateIds,
  });
  if (maximumBatchCost > LANE_CAP_USD) {
    throw new Error('maximum possible deep-analysis charge exceeds the $12 lane cap');
  }
  const definitions = deepCloneSegmentDefinitions();
  const records: DeepAnalysisRecord[] = [];
  const gaps: string[] = [];
  let conservativeSpend = 0;
  let externalCalls = 0;
  let reusedRecords = 0;
  let invalidatedRecords = 0;

  for (const entry of cohort) {
    const row = entry.row;
    const output = path.join(options.outputDir, `${row.platform}-${row.platform_post_id}-deep.json`);
    let inputFingerprint: DeepAnalysisInputFingerprint;
    try {
      inputFingerprint = buildDeepAnalysisInputFingerprint(row, options.strategyPrompt, definitions);
    } catch (error) {
      gaps.push(`${row.candidate_id}: ${redact(error instanceof Error ? error.message : String(error))}`);
      continue;
    }
    if (fs.existsSync(output)) {
      const existing = read<DeepAnalysisRecord>(output);
      const cache = validateDeepAnalysisCache(existing, inputFingerprint, definitions);
      if (cache.reusable) {
        const refreshed = {
          ...existing,
          cohort: {
            rank: entry.cohort_rank,
            success_percentile: entry.success_percentile,
            complexity_score: entry.complexity_score,
            comparison_method: 'within_platform_and_age_bucket_percentile' as const,
          },
        };
        write(output, refreshed);
        records.push(refreshed);
        reusedRecords += 1;
        continue;
      }
      invalidatedRecords += 1;
      gaps.push(`${row.candidate_id}: cached analysis invalidated (${cache.reasons.join('; ')})`);
    }
    const maximum = money(maximumItemEstimate(row.duration_sec ?? 0, definitions.length));
    if (money(conservativeSpend + maximum) > LANE_CAP_USD) {
      gaps.push(`${row.candidate_id}: budget stop`);
      break;
    }
    const client = options.clientFactory?.() ?? new TwelveLabsClient({ apiKey: options.apiKey });
    try {
      const asset = await client.createAsset({
        localPath: row.media_path!,
        filename: path.basename(row.media_path!),
        userMetadata: {
          batch_id: options.manifest.batch_id,
          candidate_id: row.candidate_id,
          analysis_profile: 'successful_content_deep_clone_v1',
        },
      });
      const strategyResult = await client.analyzeStructured<StrategyAnalysis>({
        assetId: asset._id,
        prompt: options.strategyPrompt,
        jsonSchema: strategyAnalysisSchema(),
        maxTokens: STRATEGY_MAX_OUTPUT_TOKENS,
      });
      const strategy: TwelveLabsStructuredAnalysis<StrategyAnalysis> = {
        ...strategyResult,
        data: validateStrategyAnalysis(strategyResult.data),
      };
      let segmentation = await client.segmentVideo({
        assetId: asset._id,
        customId: customId(row, 'deep'),
        segmentDefinitions: definitions,
        minSegmentDuration: 2,
        maxSegmentDuration: 4,
        maxTokens: SEGMENTATION_MAX_OUTPUT_TOKENS,
      });
      const firstPassQuality = assessDeepAnalysisQuality(segmentation, row.duration_sec ?? asset.duration ?? 0, definitions);
      let retryPerformed = false;
      let retryDefinitionCount = 0;
      let retrySegmentation: TwelveLabsSegmentationAnalysis | null = null;
      if (!firstPassQuality.passed && firstPassQuality.retry_definition_ids.length) {
        const retryDefinitions = definitions.filter((definition) => firstPassQuality.retry_definition_ids.includes(definition.id));
        retrySegmentation = await client.segmentVideo({
          assetId: asset._id,
          customId: customId(row, 'retry'),
          segmentDefinitions: retryDefinitions,
          minSegmentDuration: 2,
          maxSegmentDuration: 3,
          maxTokens: RETRY_MAX_OUTPUT_TOKENS,
        });
        segmentation = {
          ...segmentation,
          segments: { ...segmentation.segments, ...retrySegmentation.segments },
          usage: {
            input_tokens: addNullable(segmentation.usage.input_tokens, retrySegmentation.usage.input_tokens),
            output_tokens: addNullable(segmentation.usage.output_tokens, retrySegmentation.usage.output_tokens),
          },
        };
        retryPerformed = true;
        retryDefinitionCount = retryDefinitions.length;
      }
      const quality = assessDeepAnalysisQuality(segmentation, row.duration_sec ?? asset.duration ?? 0, definitions);
      if (!quality.passed) {
        gaps.push(`${row.candidate_id}: deep analysis remained incomplete after focused quality retry`);
      }
      const outputTokens = addNullable(strategy.usage.output_tokens, segmentation.usage.output_tokens);
      const usageEstimate = outputTokens === null
        ? null
        : money(estimateDeepAnalysisCost(
          row.duration_sec ?? asset.duration ?? 0,
          outputTokens,
          definitions.length,
          retryDefinitionCount,
        ));
      const record: DeepAnalysisRecord = {
        candidate_id: row.candidate_id,
        platform: row.platform,
        platform_post_id: row.platform_post_id,
        canonical_url: row.canonical_url,
        chosen_pillar: row.chosen_pillar,
        analysis_profile: DEEP_ANALYSIS_PROFILE,
        input_fingerprint: inputFingerprint,
        cohort: {
          rank: entry.cohort_rank,
          success_percentile: entry.success_percentile,
          complexity_score: entry.complexity_score,
          comparison_method: 'within_platform_and_age_bucket_percentile',
        },
        provider_asset_id: asset._id,
        strategy,
        segmentation,
        retry_segmentation: retrySegmentation,
        first_pass_quality: firstPassQuality,
        quality,
        retry_performed: retryPerformed,
        maximum_estimated_cost_usd: maximum,
        usage_pricing_estimate_usd: usageEstimate,
        external_calls_made: client.externalCallsMade,
      };
      write(output, record);
      records.push(record);
      conservativeSpend = money(conservativeSpend + maximum);
    } catch (error) {
      conservativeSpend = money(conservativeSpend + maximum);
      gaps.push(`${row.candidate_id}: ${redact(error instanceof Error ? error.message : String(error))}`);
    } finally {
      externalCalls += client.externalCallsMade;
    }
  }

  if (cohort.length < (options.limit ?? DEFAULT_COHORT_SIZE)) {
    gaps.push(`Only ${cohort.length} full-fidelity videos met the success-percentile gate.`);
  }
  return {
    schema_version: 2,
    batch_id: options.manifest.batch_id,
    generated_at: new Date().toISOString(),
    analysis_profile: 'successful_content_deep_clone_v1',
    target: options.limit ?? DEFAULT_COHORT_SIZE,
    minimum_success_percentile: options.minimumSuccessPercentile ?? DEFAULT_SUCCESS_PERCENTILE,
    maximum_duration_sec: DEFAULT_MAX_DURATION_SEC,
    language_filter: options.eligibleCandidateIds
      ? {
        required_language: 'English',
        evidence_source: 'existing_multimodal_speech_and_on_screen_text',
        eligible_candidates: options.eligibleCandidateIds.size,
      }
      : null,
    eligible: cohort.length,
    analyzed: records.length,
    reused_records: reusedRecords,
    invalidated_cached_records: invalidatedRecords,
    newly_analyzed: records.length - reusedRecords,
    conservative_maximum_estimate_usd: conservativeSpend,
    preflight_maximum_estimate_usd: maximumBatchCost,
    usage_pricing_estimate_usd: money(records.reduce((sum, row) => sum + (row.usage_pricing_estimate_usd ?? 0), 0)),
    actual_charge_reported_by_provider: false,
    external_calls_made: externalCalls,
    cohort: cohort.map((entry) => ({
      candidate_id: entry.row.candidate_id,
      rank: entry.cohort_rank,
      platform: entry.row.platform,
      success_percentile: entry.success_percentile,
      complexity_score: entry.complexity_score,
    })),
    records,
    measurement_gaps: gaps,
    evidence_boundary: {
      success_is_observed_within_platform_and_age_bucket: true,
      performance_causation_claimed: false,
      structural_patterns_may_be_adapted: true,
      competitor_wording_footage_identity_or_branding_reusable: false,
      publishing_in_scope: false,
    },
    redactions: ['credential values are never serialized'],
  };
}

export function assessDeepAnalysisQuality(
  analysis: TwelveLabsSegmentationAnalysis,
  durationSec: number,
  definitions: TwelveLabsSegmentDefinition[] = deepCloneSegmentDefinitions(),
): DeepAnalysisQuality {
  const definitionCounts: Record<string, number> = {};
  const definitionCoverage: DeepAnalysisQuality['definition_coverage'] = {};
  const missingFields: string[] = [];
  const retryIds = new Set<string>();
  for (const definition of definitions) {
    const segments = analysis.segments[definition.id] ?? [];
    definitionCounts[definition.id] = segments.length;
    if (!segments.length) retryIds.add(definition.id);
    const coverage = intervalCoverage(segments, durationSec);
    definitionCoverage[definition.id] = {
      coverage_ratio: coverage.ratio,
      max_gap_sec: coverage.maxGapSec,
    };
    if (
      coverage.ratio < QUALITY_MINIMUM_COVERAGE
      || coverage.maxGapSec > QUALITY_MAXIMUM_GAP_SEC
    ) retryIds.add(definition.id);
    for (const [index, segment] of segments.entries()) {
      for (const field of definition.fields) {
        const value = segment.metadata[field.name];
        if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
          missingFields.push(`${definition.id}[${index}].${field.name}`);
          retryIds.add(definition.id);
        }
      }
    }
  }
  const visualCoverage = definitionCoverage.visual_shots ?? { coverage_ratio: 0, max_gap_sec: durationSec };
  const audioCoverage = definitionCoverage.audio_beats ?? { coverage_ratio: 0, max_gap_sec: durationSec };
  const editingCoverage = definitionCoverage.editing_beats ?? { coverage_ratio: 0, max_gap_sec: durationSec };
  return {
    passed: retryIds.size === 0,
    definition_counts: definitionCounts,
    definition_coverage: definitionCoverage,
    visual_coverage_ratio: visualCoverage.coverage_ratio,
    max_visual_gap_sec: visualCoverage.max_gap_sec,
    audio_coverage_ratio: audioCoverage.coverage_ratio,
    max_audio_gap_sec: audioCoverage.max_gap_sec,
    editing_coverage_ratio: editingCoverage.coverage_ratio,
    max_editing_gap_sec: editingCoverage.max_gap_sec,
    missing_metadata_fields: missingFields,
    retry_definition_ids: [...retryIds].sort(),
  };
}

function strategyAnalysisSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      opening: {
        type: 'object',
        properties: {
          start_sec: { type: 'number' },
          end_sec: { type: 'number' },
          observed_words: { type: 'string' },
          observed_visual: { type: 'string' },
          mechanism: { type: 'string' },
        },
        required: ['start_sec', 'end_sec', 'observed_words', 'observed_visual', 'mechanism'],
      },
      content_arc: {
        type: 'object',
        properties: {
          audience_problem: { type: 'string' },
          progression: { type: 'string' },
          payoff: { type: 'string' },
        },
        required: ['audience_problem', 'progression', 'payoff'],
      },
      cta: {
        type: 'object',
        properties: {
          observed_words: { type: 'string' },
          requested_action: { type: 'string' },
        },
        required: ['observed_words', 'requested_action'],
      },
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            observed_claim: { type: 'string' },
            evidence_status: { type: 'string', enum: ['visible', 'spoken', 'unsupported'] },
          },
          required: ['observed_claim', 'evidence_status'],
        },
      },
      transferable_structure: {
        type: 'object',
        properties: {
          hook_pattern: { type: 'string' },
          beat_pattern: { type: 'string' },
          payoff_pattern: { type: 'string' },
        },
        required: ['hook_pattern', 'beat_pattern', 'payoff_pattern'],
      },
      evidence_limitations: { type: 'array', items: { type: 'string' } },
    },
    required: ['opening', 'content_arc', 'cta', 'claims', 'transferable_structure', 'evidence_limitations'],
  };
}

function contentComplexityScore(durationSec: number | null, evidenceRichness: number, noveltyScore: number): number {
  const durationComponent = Math.min(1, Math.log1p(Math.max(0, durationSec ?? 0)) / Math.log(61));
  return roundScore(durationComponent * 0.45 + evidenceRichness * 0.35 + noveltyScore * 0.2);
}

function maximumItemEstimate(durationSec: number, definitionCount: number): number {
  const billableVideoMultiplier = 1 + definitionCount + definitionCount;
  const outputTokenCeiling = STRATEGY_MAX_OUTPUT_TOKENS
    + SEGMENTATION_MAX_OUTPUT_TOKENS
    + RETRY_MAX_OUTPUT_TOKENS;
  return estimateTwelveLabsAnalysisCost(durationSec * billableVideoMultiplier, outputTokenCeiling);
}

function estimateDeepAnalysisCost(
  durationSec: number,
  outputTokens: number,
  definitionCount: number,
  retryDefinitionCount: number,
): number {
  return estimateTwelveLabsAnalysisCost(
    durationSec * (1 + definitionCount + retryDefinitionCount),
    outputTokens,
  );
}

function validateStrategyAnalysis(input: StrategyAnalysis | unknown): StrategyAnalysis {
  const root = requiredRecord(input, 'strategy analysis');
  const opening = requiredRecord(root.opening, 'strategy analysis opening');
  const contentArc = requiredRecord(root.content_arc, 'strategy analysis content_arc');
  const cta = requiredRecord(root.cta, 'strategy analysis cta');
  const transferable = requiredRecord(root.transferable_structure, 'strategy analysis transferable_structure');
  if (!Array.isArray(root.claims) || !Array.isArray(root.evidence_limitations)) {
    throw new Error('strategy analysis claims and evidence_limitations must be arrays');
  }
  const startSec = requiredNumber(opening.start_sec, 'strategy analysis opening.start_sec');
  const endSec = requiredNumber(opening.end_sec, 'strategy analysis opening.end_sec');
  if (startSec < 0 || endSec <= startSec) throw new Error('strategy analysis opening timestamps are invalid');
  const claims = root.claims.map((claim, index) => {
    const value = requiredRecord(claim, `strategy analysis claims[${index}]`);
    const status = requiredString(value.evidence_status, `strategy analysis claims[${index}].evidence_status`);
    if (!['visible', 'spoken', 'unsupported'].includes(status)) {
      throw new Error(`strategy analysis claims[${index}].evidence_status is invalid`);
    }
    return {
      observed_claim: requiredString(value.observed_claim, `strategy analysis claims[${index}].observed_claim`),
      evidence_status: status as StrategyAnalysis['claims'][number]['evidence_status'],
    };
  });
  return {
    opening: {
      start_sec: startSec,
      end_sec: endSec,
      observed_words: requiredString(opening.observed_words, 'strategy analysis opening.observed_words'),
      observed_visual: requiredString(opening.observed_visual, 'strategy analysis opening.observed_visual'),
      mechanism: requiredString(opening.mechanism, 'strategy analysis opening.mechanism'),
    },
    content_arc: {
      audience_problem: requiredString(contentArc.audience_problem, 'strategy analysis content_arc.audience_problem'),
      progression: requiredString(contentArc.progression, 'strategy analysis content_arc.progression'),
      payoff: requiredString(contentArc.payoff, 'strategy analysis content_arc.payoff'),
    },
    cta: {
      observed_words: requiredString(cta.observed_words, 'strategy analysis cta.observed_words'),
      requested_action: requiredString(cta.requested_action, 'strategy analysis cta.requested_action'),
    },
    claims,
    transferable_structure: {
      hook_pattern: requiredString(transferable.hook_pattern, 'strategy analysis transferable_structure.hook_pattern'),
      beat_pattern: requiredString(transferable.beat_pattern, 'strategy analysis transferable_structure.beat_pattern'),
      payoff_pattern: requiredString(transferable.payoff_pattern, 'strategy analysis transferable_structure.payoff_pattern'),
    },
    evidence_limitations: root.evidence_limitations.map((value, index) => (
      requiredString(value, `strategy analysis evidence_limitations[${index}]`)
    )),
  };
}

function intervalCoverage(segments: TwelveLabsTimeSegment[], durationSec: number): { ratio: number; maxGapSec: number } {
  if (!(durationSec > 0) || !segments.length) return { ratio: 0, maxGapSec: Math.max(0, durationSec) };
  const ordered = segments
    .map((segment) => ({
      start: Math.max(0, Math.min(durationSec, segment.start_time)),
      end: Math.max(0, Math.min(durationSec, segment.end_time)),
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  if (!ordered.length) return { ratio: 0, maxGapSec: durationSec };
  let covered = 0;
  let cursor = 0;
  let maxGap = 0;
  for (const segment of ordered) {
    maxGap = Math.max(maxGap, segment.start - cursor);
    if (segment.end > cursor) {
      covered += segment.end - Math.max(cursor, segment.start);
      cursor = segment.end;
    }
  }
  maxGap = Math.max(maxGap, durationSec - cursor);
  return {
    ratio: roundScore(Math.min(1, covered / durationSec)),
    maxGapSec: Math.round(maxGap * 100) / 100,
  };
}

function customId(row: InternshipMediaManifest['rows'][number], suffix: string): string {
  return `${row.platform}_${row.platform_post_id}_${suffix}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function addNullable(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function redact(value: string): string {
  return value.replace(/tlk_[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 500);
}

function read<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as T;
}

function write(file: string, value: unknown): void {
  atomicWriteJson(path.resolve(file), value);
}

async function main(): Promise<void> {
  const envFileArg = process.argv.indexOf('--env-file');
  const envFile = path.resolve(envFileArg >= 0 ? process.argv[envFileArg + 1] : '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : undefined;
  const percentileArg = process.argv.indexOf('--minimum-success-percentile');
  const minimumSuccessPercentile = percentileArg >= 0 ? Number(process.argv[percentileArg + 1]) : undefined;
  const base = '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716';
  const manifest = read<InternshipMediaManifest>(`${base}-media.json`);
  const selection = read<SelectionLedger>(`${base}-selection.json`);
  const existingAnalysisDir = path.resolve('.semantic-artifacts/competitor-content/analysis/internship-us-20260716');
  const englishCandidateIds = loadEnglishCandidateIds(existingAnalysisDir);
  const cohortOptions = {
    limit,
    minimumSuccessPercentile,
    eligibleCandidateIds: englishCandidateIds,
  };
  const cohort = selectDeepAnalysisCohort(manifest, selection, cohortOptions);
  const preflight = {
    status: process.env.TWELVELABS_API_KEY?.trim() ? 'ready' : 'blocked_missing_credential',
    credential_required: 'TWELVELABS_API_KEY',
    credential_present: Boolean(process.env.TWELVELABS_API_KEY?.trim()),
    env_file: path.relative(process.cwd(), envFile) || '.env',
    target: limit ?? DEFAULT_COHORT_SIZE,
    eligible: cohort.length,
    language_filter: 'English',
    english_evidence_candidates: englishCandidateIds.size,
    language_evidence_source: path.relative(process.cwd(), existingAnalysisDir),
    maximum_duration_sec: DEFAULT_MAX_DURATION_SEC,
    minimum_success_percentile: minimumSuccessPercentile ?? DEFAULT_SUCCESS_PERCENTILE,
    maximum_estimate_usd: deepAnalysisMaximumEstimate(manifest, selection, cohortOptions),
    external_calls_made: 0,
  };
  if (process.argv.includes('--preflight')) {
    process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
    return;
  }
  const apiKey = process.env.TWELVELABS_API_KEY?.trim();
  if (!apiKey) {
    process.stderr.write(`${JSON.stringify({
      ...preflight,
      next_action: 'Add a TwelveLabs API key to the selected env file, then rerun this command.',
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  const report = await analyzeInternshipMedia({
    apiKey,
    manifest,
    selection,
    strategyPrompt: fs.readFileSync(path.resolve('.ops/prompts/twelvelabs/internship_us_selected_content_analysis.md'), 'utf8'),
    outputDir: path.resolve('.semantic-artifacts/competitor-content/analysis/internship-us-20260716-deep-v1'),
    limit,
    minimumSuccessPercentile,
    eligibleCandidateIds: englishCandidateIds,
  });
  write(`${base}-multimodal-deep.json`, report);
  const dashboard = generateTwelveLabsDashboard();
  process.stdout.write(`${JSON.stringify({
    analyzed: report.analyzed,
    target: report.target,
    minimum_success_percentile: report.minimum_success_percentile,
    conservative_maximum_estimate_usd: report.conservative_maximum_estimate_usd,
    usage_pricing_estimate_usd: report.usage_pricing_estimate_usd,
    measurement_gaps: (report.measurement_gaps as string[]).length,
    dashboard_updated: dashboard.output_path,
    dashboard_data_updated: dashboard.data_path,
  }, null, 2)}\n`);
}

if (require.main === module) void main();
