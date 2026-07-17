import * as fs from 'node:fs';

export const CREATIVE_LANES = ['image_slideshow', 'generated_video'] as const;
export const DELIVERY_MODES = ['native_carousel', 'rendered_video'] as const;
export const TRACTION_AUDIO_MODES = [
  'platform_commercial_music',
  'provider_native_audio',
  'original_audio',
  'none',
] as const;
export const COMMERCIAL_USE_STATUSES = [
  'precleared',
  'provider_generated',
  'operator_owned',
  'requires_review',
  'not_applicable',
] as const;
export const TRACTION_PRIMARY_METRICS = [
  'view_velocity',
  'average_watch_time_sec',
  'completion_rate',
  'rewatch_rate',
  'share_rate',
  'save_rate',
  'follow_rate',
  'profile_visit_rate',
] as const;
export const TRACTION_CHANGE_DIMENSIONS = [
  'topic',
  'hook',
  'first_frame',
  'slide_order',
  'visual_style',
  'pacing',
  'audio',
  'cta',
  'duration',
] as const;
export const TRACTION_VARIANT_STATUSES = [
  'draft',
  'ready_for_manual_post',
  'posted',
  'measured',
  'rejected',
] as const;
export const TRACTION_CHECKPOINTS = ['1h', '24h', '72h', '7d', 'custom'] as const;

export type CreativeLane = typeof CREATIVE_LANES[number];
export type DeliveryMode = typeof DELIVERY_MODES[number];
export type TractionAudioMode = typeof TRACTION_AUDIO_MODES[number];
export type CommercialUseStatus = typeof COMMERCIAL_USE_STATUSES[number];
export type TractionPrimaryMetric = typeof TRACTION_PRIMARY_METRICS[number];
export type TractionChangeDimension = typeof TRACTION_CHANGE_DIMENSIONS[number];
export type TractionVariantStatus = typeof TRACTION_VARIANT_STATUSES[number];
export type TractionCheckpoint = typeof TRACTION_CHECKPOINTS[number];

export interface TractionAudioPlan {
  mode: TractionAudioMode;
  track_id: string | null;
  track_title: string | null;
  source_url: string | null;
  captured_at: string | null;
  region: string | null;
  commercial_use_status: CommercialUseStatus;
  added_at_posting: boolean;
  notes: string[];
}

export interface TractionVariant {
  variant_id: string;
  label: string;
  hook: string;
  changed_dimensions: TractionChangeDimension[];
  audio_plan: TractionAudioPlan;
  status: TractionVariantStatus;
}

export interface TractionDecisionPolicy {
  minimum_checkpoint: '24h' | '72h' | '7d';
  min_repeats_before_pattern: number;
  max_changed_dimensions_per_variant: 1 | 2;
  stop_after_non_improving_variants: number;
}

export interface TractionPublishingPolicy {
  manual_only: true;
  human_approval_required: true;
  auto_posting_allowed: false;
}

export interface TractionExperimentManifest {
  experiment_id: string;
  job_id: string;
  objective: 'audience_traction';
  content_family: string;
  creative_lane: CreativeLane;
  delivery_mode: DeliveryMode;
  hypothesis: string;
  control_variant_id: string | null;
  primary_metrics: TractionPrimaryMetric[];
  variants: TractionVariant[];
  decision_policy: TractionDecisionPolicy;
  publishing_policy: TractionPublishingPolicy;
  notes: string[];
}

export function loadTractionExperimentManifest(filePath: string): TractionExperimentManifest {
  return validateTractionExperimentManifest(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function validateTractionExperimentManifest(input: unknown): TractionExperimentManifest {
  const record = expectRecord(input, 'traction experiment manifest');
  const creativeLane = oneOf(requiredText(record, 'creative_lane'), CREATIVE_LANES, 'creative_lane');
  const deliveryMode = oneOf(requiredText(record, 'delivery_mode'), DELIVERY_MODES, 'delivery_mode');
  const decisionPolicy = normalizeDecisionPolicy(expectRecord(record.decision_policy, 'decision_policy'));
  const variants = requiredRecordArray(record, 'variants').map((variant, index) => (
    normalizeVariant(variant, index, creativeLane, decisionPolicy.max_changed_dimensions_per_variant)
  ));
  if (variants.length > 5) throw new Error('variants must contain no more than five entries.');

  const objective = requiredText(record, 'objective');
  if (objective !== 'audience_traction') {
    throw new Error('objective must be audience_traction; conversion and revenue optimization are outside this harness.');
  }
  if (creativeLane === 'generated_video' && deliveryMode !== 'rendered_video') {
    throw new Error('generated_video experiments must use delivery_mode=rendered_video.');
  }

  const variantIds = variants.map((variant) => variant.variant_id);
  if (new Set(variantIds).size !== variantIds.length) throw new Error('variant_id values must be unique.');
  const controlVariantId = nullableText(record.control_variant_id, 'control_variant_id');
  if (controlVariantId && !variantIds.includes(controlVariantId)) {
    throw new Error('control_variant_id must reference one of the declared variants.');
  }
  for (const variant of variants) {
    if (variant.variant_id === controlVariantId && variant.changed_dimensions.length) {
      throw new Error('The control variant must not declare changed_dimensions.');
    }
    if (controlVariantId && variant.variant_id !== controlVariantId && !variant.changed_dimensions.length) {
      throw new Error('Every non-control variant must declare at least one changed dimension.');
    }
  }

  const primaryMetrics = requiredTextArray(record, 'primary_metrics').map((metric) => (
    oneOf(metric, TRACTION_PRIMARY_METRICS, 'primary_metrics')
  ));
  if (primaryMetrics.length < 2) throw new Error('primary_metrics must include at least two traction signals.');
  if (new Set(primaryMetrics).size !== primaryMetrics.length) throw new Error('primary_metrics must not contain duplicates.');
  if (!primaryMetrics.includes('view_velocity')) throw new Error('primary_metrics must include view_velocity.');

  return {
    experiment_id: requiredText(record, 'experiment_id'),
    job_id: requiredText(record, 'job_id'),
    objective: 'audience_traction',
    content_family: requiredText(record, 'content_family'),
    creative_lane: creativeLane,
    delivery_mode: deliveryMode,
    hypothesis: requiredText(record, 'hypothesis'),
    control_variant_id: controlVariantId,
    primary_metrics: primaryMetrics,
    variants,
    decision_policy: decisionPolicy,
    publishing_policy: normalizePublishingPolicy(expectRecord(record.publishing_policy, 'publishing_policy')),
    notes: textArray(record.notes, 'notes', true),
  };
}

function normalizeVariant(
  record: Record<string, unknown>,
  index: number,
  creativeLane: CreativeLane,
  maxChangedDimensions: number,
): TractionVariant {
  const status = oneOf(requiredText(record, 'status'), TRACTION_VARIANT_STATUSES, `variants[${index}].status`);
  const changedDimensions = textArray(record.changed_dimensions, `variants[${index}].changed_dimensions`, true).map((value) => (
    oneOf(value, TRACTION_CHANGE_DIMENSIONS, `variants[${index}].changed_dimensions`)
  ));
  if (new Set(changedDimensions).size !== changedDimensions.length) {
    throw new Error(`variants[${index}].changed_dimensions must not contain duplicates.`);
  }
  if (changedDimensions.length > maxChangedDimensions) {
    throw new Error(`variants[${index}] changes more than ${maxChangedDimensions} dimensions.`);
  }
  return {
    variant_id: requiredText(record, 'variant_id'),
    label: requiredText(record, 'label'),
    hook: requiredText(record, 'hook'),
    changed_dimensions: changedDimensions,
    audio_plan: normalizeAudioPlan(
      expectRecord(record.audio_plan, `variants[${index}].audio_plan`),
      creativeLane,
      status,
      index,
    ),
    status,
  };
}

function normalizeAudioPlan(
  record: Record<string, unknown>,
  creativeLane: CreativeLane,
  variantStatus: TractionVariantStatus,
  index: number,
): TractionAudioPlan {
  const field = `variants[${index}].audio_plan`;
  const mode = oneOf(requiredText(record, 'mode'), TRACTION_AUDIO_MODES, `${field}.mode`);
  const plan: TractionAudioPlan = {
    mode,
    track_id: nullableText(record.track_id, `${field}.track_id`),
    track_title: nullableText(record.track_title, `${field}.track_title`),
    source_url: nullableUrl(record.source_url, `${field}.source_url`),
    captured_at: nullableDateTime(record.captured_at, `${field}.captured_at`),
    region: nullableText(record.region, `${field}.region`),
    commercial_use_status: oneOf(
      requiredText(record, 'commercial_use_status'),
      COMMERCIAL_USE_STATUSES,
      `${field}.commercial_use_status`,
    ),
    added_at_posting: requiredBoolean(record, 'added_at_posting'),
    notes: textArray(record.notes, `${field}.notes`, true),
  };

  if (mode === 'platform_commercial_music') {
    const selected = Boolean(plan.track_id && plan.captured_at && plan.region)
      && plan.commercial_use_status === 'precleared';
    const pendingSelection = variantStatus === 'draft'
      && !plan.track_id
      && !plan.captured_at
      && plan.commercial_use_status === 'requires_review';
    if (!plan.added_at_posting || (!selected && !pendingSelection)) {
      throw new Error(`${field} platform commercial music must be a pending draft selection or a precleared track added at posting.`);
    }
  }
  if (mode === 'provider_native_audio') {
    if (creativeLane !== 'generated_video') throw new Error(`${field} provider_native_audio is valid only for generated_video.`);
    if (plan.commercial_use_status !== 'provider_generated' || plan.added_at_posting) {
      throw new Error(`${field} provider-native audio must be provider_generated and not added at posting.`);
    }
  }
  if (mode === 'original_audio' && !['operator_owned', 'requires_review'].includes(plan.commercial_use_status)) {
    throw new Error(`${field} original audio must be operator_owned or requires_review.`);
  }
  if (mode === 'none') {
    if (plan.commercial_use_status !== 'not_applicable' || plan.added_at_posting) {
      throw new Error(`${field} with mode=none must use not_applicable and added_at_posting=false.`);
    }
    if (plan.track_id || plan.track_title || plan.source_url || plan.captured_at || plan.region) {
      throw new Error(`${field} with mode=none must not declare track metadata.`);
    }
  }
  return plan;
}

function normalizeDecisionPolicy(record: Record<string, unknown>): TractionDecisionPolicy {
  const minimumCheckpoint = oneOf(requiredText(record, 'minimum_checkpoint'), ['24h', '72h', '7d'] as const, 'decision_policy.minimum_checkpoint');
  const minRepeats = requiredInteger(record, 'min_repeats_before_pattern');
  const maxChanged = requiredInteger(record, 'max_changed_dimensions_per_variant');
  const stopAfter = requiredInteger(record, 'stop_after_non_improving_variants');
  if (minRepeats < 2 || minRepeats > 5) throw new Error('min_repeats_before_pattern must be from 2 to 5.');
  if (maxChanged !== 1 && maxChanged !== 2) throw new Error('max_changed_dimensions_per_variant must be 1 or 2.');
  if (stopAfter < 2 || stopAfter > 3) throw new Error('stop_after_non_improving_variants must be 2 or 3.');
  return {
    minimum_checkpoint: minimumCheckpoint,
    min_repeats_before_pattern: minRepeats,
    max_changed_dimensions_per_variant: maxChanged,
    stop_after_non_improving_variants: stopAfter,
  };
}

function normalizePublishingPolicy(record: Record<string, unknown>): TractionPublishingPolicy {
  if (record.manual_only !== true || record.human_approval_required !== true || record.auto_posting_allowed !== false) {
    throw new Error('publishing_policy must keep manual_only=true, human_approval_required=true, and auto_posting_allowed=false.');
  }
  return { manual_only: true, human_approval_required: true, auto_posting_allowed: false };
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredRecordArray(record: Record<string, unknown>, field: string): Array<Record<string, unknown>> {
  const value = record[field];
  if (!Array.isArray(value) || !value.length) throw new Error(`${field} must be a non-empty array.`);
  return value.map((item, index) => expectRecord(item, `${field}[${index}]`));
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function requiredTextArray(record: Record<string, unknown>, field: string): string[] {
  return textArray(record[field], field, false);
}

function textArray(value: unknown, field: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  if (!allowEmpty && !value.length) throw new Error(`${field} must not be empty.`);
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`${field}[${index}] must be a non-empty string.`);
    return item.trim();
  });
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be null or a non-empty string.`);
  return value.trim();
}

function nullableUrl(value: unknown, field: string): string | null {
  const text = nullableText(value, field);
  if (text === null) return null;
  try {
    new URL(text);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  return text;
}

function nullableDateTime(value: unknown, field: string): string | null {
  const text = nullableText(value, field);
  if (text === null) return null;
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${field} must be a valid date-time string.`);
  return text;
}

function requiredBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`);
  return value;
}

function requiredInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer.`);
  return value as number;
}

function oneOf<T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (!allowed.includes(value as T[number])) throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  return value as T[number];
}

function parseArgs(argv: string[]): { command: string; file?: string } {
  const [command = 'help', ...rest] = argv;
  const fileIndex = rest.indexOf('--file');
  return { command, file: fileIndex >= 0 ? rest[fileIndex + 1] : undefined };
}

if (require.main === module) {
  try {
    const { command, file } = parseArgs(process.argv.slice(2));
    if (command === 'validate') {
      if (!file) throw new Error('Usage: npm run traction -- validate --file <experiment.json>');
      const experiment = loadTractionExperimentManifest(file);
      console.log(JSON.stringify({
        ok: true,
        experiment_id: experiment.experiment_id,
        creative_lane: experiment.creative_lane,
        variants: experiment.variants.length,
        objective: experiment.objective,
      }, null, 2));
    } else {
      console.log('Usage: npm run traction -- validate --file <experiment.json>');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
