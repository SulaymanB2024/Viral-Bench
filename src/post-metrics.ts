import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteFile, atomicWriteJson } from './artifact-integrity';
import {
  CREATIVE_LANES,
  DELIVERY_MODES,
  TRACTION_AUDIO_MODES,
  TRACTION_CHECKPOINTS,
  type CreativeLane,
  type DeliveryMode,
  type TractionAudioMode,
  type TractionCheckpoint,
} from './traction-experiment';

export const DEFAULT_METRICS_STORE_PATH = path.join(process.cwd(), '.ops', 'metrics', 'post_metrics.json');

export const RAW_COMPARISON_METRICS = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'follows',
  'profile_visits',
  'dms',
] as const;

export const TRACTION_COMPARISON_METRICS = [
  'view_velocity',
  'average_watch_time_sec',
  'completion_rate',
  'rewatch_rate',
  'share_rate',
  'save_rate',
  'follow_rate',
  'profile_visit_rate',
] as const;

export const COMPARISON_METRICS = [
  ...RAW_COMPARISON_METRICS,
  ...TRACTION_COMPARISON_METRICS,
] as const;

export type RawComparisonMetric = typeof RAW_COMPARISON_METRICS[number];
export type TractionComparisonMetric = typeof TRACTION_COMPARISON_METRICS[number];
export type ComparisonMetric = typeof COMPARISON_METRICS[number];
export const SNAPSHOT_METRICS = [
  ...RAW_COMPARISON_METRICS,
  'average_watch_time_sec',
  'completion_rate',
  'rewatch_rate',
] as const;
export const MEASUREMENT_STATES = [
  'observed',
  'not_available',
  'not_applicable',
  'pending',
] as const;
export type SnapshotMetric = typeof SNAPSHOT_METRICS[number];
export type MeasurementState = typeof MEASUREMENT_STATES[number];
export type MetricMeasurementStates = Record<SnapshotMetric, MeasurementState>;

export interface MetricSnapshot {
  captured_at: string;
  checkpoint: TractionCheckpoint;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows: number | null;
  profile_visits: number | null;
  dms: number | null;
  average_watch_time_sec: number | null;
  completion_rate: number | null;
  rewatch_rate: number | null;
  measurement_states: MetricMeasurementStates;
  notes: string[];
}

export interface PostMetricsRecord {
  post_id: string;
  job_id: string;
  platform: string;
  account_handle: string;
  posted_url: string;
  posted_at: string;
  content_type: string;
  hook: string;
  format: string;
  CTA: string;
  experiment_id: string | null;
  variant_id: string | null;
  creative_lane: CreativeLane | null;
  delivery_mode: DeliveryMode | null;
  audio_mode: TractionAudioMode | null;
  duration_sec: number | null;
  metric_snapshots: MetricSnapshot[];
  notes: string[];
}

export interface PostMetricsStore {
  records: PostMetricsRecord[];
}

export interface MetricsListFilters {
  platform?: string;
  job_id?: string;
  content_type?: string;
  experiment_id?: string;
  creative_lane?: CreativeLane;
  checkpoint?: TractionCheckpoint;
}

export interface TractionSummary {
  view_velocity: number | null;
  average_watch_time_sec: number | null;
  completion_rate: number | null;
  rewatch_rate: number | null;
  share_rate: number | null;
  save_rate: number | null;
  follow_rate: number | null;
  profile_visit_rate: number | null;
}

export interface MetricsComparisonRow {
  rank: number | null;
  post_id: string;
  job_id: string;
  platform: string;
  content_type: string;
  experiment_id: string | null;
  variant_id: string | null;
  creative_lane: CreativeLane | null;
  metric: ComparisonMetric;
  value: number | null;
  comparison_checkpoint: TractionCheckpoint;
  latest_snapshot_at: string | null;
  compared_posts: number;
  total_candidate_posts: number;
  measurement_state: MeasurementState | 'derived' | 'unavailable';
  comparison_note: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows: number | null;
  profile_visits: number | null;
  dms: number | null;
  traction: TractionSummary;
}

interface CliArgs {
  command: string;
  options: Record<string, string | boolean>;
}

export function createPostedContentRecord(input: unknown): PostMetricsRecord {
  const record = expectRecord(input, 'post metrics record');
  return validatePostMetricsRecord({
    post_id: requiredText(record, 'post_id'),
    job_id: requiredText(record, 'job_id'),
    platform: requiredText(record, 'platform'),
    account_handle: requiredText(record, 'account_handle'),
    posted_url: requiredUrl(record, 'posted_url'),
    posted_at: optionalDateTime(record.posted_at, 'posted_at') ?? new Date().toISOString(),
    content_type: requiredText(record, 'content_type'),
    hook: requiredText(record, 'hook'),
    format: requiredText(record, 'format'),
    CTA: requiredText({ CTA: record.CTA ?? record.cta }, 'CTA'),
    experiment_id: nullableText(record.experiment_id, 'experiment_id'),
    variant_id: nullableText(record.variant_id, 'variant_id'),
    creative_lane: nullableOneOf(record.creative_lane, CREATIVE_LANES, 'creative_lane'),
    delivery_mode: nullableOneOf(record.delivery_mode, DELIVERY_MODES, 'delivery_mode'),
    audio_mode: nullableOneOf(record.audio_mode, TRACTION_AUDIO_MODES, 'audio_mode'),
    duration_sec: nullablePositiveNumber(record.duration_sec, 'duration_sec'),
    metric_snapshots: Array.isArray(record.metric_snapshots)
      ? record.metric_snapshots.map(validateMetricSnapshot)
      : [],
    notes: normalizeTextArray(record.notes, 'notes', { allowEmpty: true }),
  });
}

export function validatePostMetricsRecord(input: unknown): PostMetricsRecord {
  const record = expectRecord(input, 'post metrics record');
  const post: PostMetricsRecord = {
    post_id: requiredText(record, 'post_id'),
    job_id: requiredText(record, 'job_id'),
    platform: requiredText(record, 'platform'),
    account_handle: requiredText(record, 'account_handle'),
    posted_url: requiredUrl(record, 'posted_url'),
    posted_at: requiredDateTime(record, 'posted_at'),
    content_type: requiredText(record, 'content_type'),
    hook: requiredText(record, 'hook'),
    format: requiredText(record, 'format'),
    CTA: requiredText({ CTA: record.CTA ?? record.cta }, 'CTA'),
    experiment_id: nullableText(record.experiment_id, 'experiment_id'),
    variant_id: nullableText(record.variant_id, 'variant_id'),
    creative_lane: nullableOneOf(record.creative_lane, CREATIVE_LANES, 'creative_lane'),
    delivery_mode: nullableOneOf(record.delivery_mode, DELIVERY_MODES, 'delivery_mode'),
    audio_mode: nullableOneOf(record.audio_mode, TRACTION_AUDIO_MODES, 'audio_mode'),
    duration_sec: nullablePositiveNumber(record.duration_sec, 'duration_sec'),
    metric_snapshots: requiredRecordArray(record, 'metric_snapshots').map(validateMetricSnapshot),
    notes: normalizeTextArray(record.notes, 'notes', { allowEmpty: true }),
  };

  if ((post.experiment_id === null) !== (post.variant_id === null)) {
    throw new Error('experiment_id and variant_id must be provided together.');
  }
  if ((post.creative_lane === null) !== (post.delivery_mode === null)) {
    throw new Error('creative_lane and delivery_mode must be provided together.');
  }
  if (post.creative_lane === 'generated_video' && post.delivery_mode !== 'rendered_video') {
    throw new Error('generated_video metrics records must use delivery_mode=rendered_video.');
  }

  post.metric_snapshots.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  validateSnapshotSequence(post);
  return post;
}

export function validateMetricSnapshot(input: unknown): MetricSnapshot {
  const record = expectRecord(input, 'metric snapshot');
  const values = {
    views: nullableMetricNumber(record.views, 'views'),
    likes: nullableMetricNumber(record.likes, 'likes'),
    comments: nullableMetricNumber(record.comments, 'comments'),
    shares: nullableMetricNumber(record.shares, 'shares'),
    saves: nullableMetricNumber(record.saves, 'saves'),
    follows: nullableMetricNumber(record.follows, 'follows'),
    profile_visits: nullableMetricNumber(record.profile_visits, 'profile_visits'),
    dms: nullableMetricNumber(record.dms, 'dms'),
    average_watch_time_sec: nullableNonNegativeNumber(record.average_watch_time_sec, 'average_watch_time_sec'),
    completion_rate: nullableRate(record.completion_rate, 'completion_rate'),
    rewatch_rate: nullableRate(record.rewatch_rate, 'rewatch_rate'),
  } satisfies Record<SnapshotMetric, number | null>;
  const snapshot: MetricSnapshot = {
    captured_at: requiredDateTime(record, 'captured_at'),
    checkpoint: record.checkpoint === undefined
      ? 'custom'
      : oneOf(requiredText(record, 'checkpoint'), TRACTION_CHECKPOINTS, 'checkpoint'),
    ...values,
    measurement_states: measurementStates(record.measurement_states, values),
    notes: normalizeTextArray(record.notes, 'notes', { allowEmpty: true }),
  };
  validateMeasurementStateConsistency(snapshot);
  return snapshot;
}

export function validatePostMetricsStore(input: unknown): PostMetricsStore {
  if (Array.isArray(input)) {
    return { records: input.map(validatePostMetricsRecord) };
  }
  const record = expectRecord(input, 'post metrics store');
  return {
    records: requiredRecordArray(record, 'records').map(validatePostMetricsRecord),
  };
}

export function loadPostMetricsStore(filePath = DEFAULT_METRICS_STORE_PATH): PostMetricsStore {
  if (!fs.existsSync(filePath)) return { records: [] };
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return { records: [] };
  return validatePostMetricsStore(JSON.parse(raw));
}

export function savePostMetricsStore(store: PostMetricsStore, filePath = DEFAULT_METRICS_STORE_PATH): void {
  const validated = validatePostMetricsStore(store);
  atomicWriteJson(filePath, validated);
}

export function createPostInStore(store: PostMetricsStore, input: unknown): PostMetricsStore {
  const validated = validatePostMetricsStore(store);
  const post = createPostedContentRecord(input);
  if (validated.records.some((record) => record.post_id === post.post_id)) {
    throw new Error(`post_id already exists: ${post.post_id}`);
  }
  return {
    records: [...validated.records, post],
  };
}

export function addMetricSnapshotToStore(
  store: PostMetricsStore,
  postId: string,
  input: unknown,
): PostMetricsStore {
  const validated = validatePostMetricsStore(store);
  const snapshot = validateMetricSnapshot(input);
  let found = false;
  const records = validated.records.map((record) => {
    if (record.post_id !== postId) return record;
    found = true;
    if (record.metric_snapshots.some((existing) => existing.captured_at === snapshot.captured_at)) {
      throw new Error(`metric snapshot captured_at already exists for ${postId}: ${snapshot.captured_at}`);
    }
    if (
      snapshot.checkpoint !== 'custom'
      && record.metric_snapshots.some((existing) => existing.checkpoint === snapshot.checkpoint)
    ) {
      throw new Error(`metric checkpoint already exists for ${postId}: ${snapshot.checkpoint}`);
    }
    const latest = record.metric_snapshots.at(-1);
    if (latest && Date.parse(snapshot.captured_at) <= Date.parse(latest.captured_at)) {
      throw new Error(`metric snapshots are append-only; captured_at must be later than ${latest.captured_at}`);
    }
    return validatePostMetricsRecord({
      ...record,
      metric_snapshots: [...record.metric_snapshots, snapshot],
    });
  });

  if (!found) throw new Error(`post_id not found: ${postId}`);
  return { records };
}

export function listMetrics(
  store: PostMetricsStore,
  filters: MetricsListFilters = {},
): PostMetricsRecord[] {
  return validatePostMetricsStore(store).records.filter((record) => {
    if (filters.platform && !sameText(record.platform, filters.platform)) return false;
    if (filters.job_id && record.job_id !== filters.job_id) return false;
    if (filters.content_type && !sameText(record.content_type, filters.content_type)) return false;
    if (filters.experiment_id && record.experiment_id !== filters.experiment_id) return false;
    if (filters.creative_lane && record.creative_lane !== filters.creative_lane) return false;
    return true;
  });
}

export function comparePosts(
  store: PostMetricsStore,
  options: MetricsListFilters & { metric?: ComparisonMetric } = {},
): MetricsComparisonRow[] {
  const metric = options.metric ?? 'views';
  if (!COMPARISON_METRICS.includes(metric)) {
    throw new Error(`metric must be one of: ${COMPARISON_METRICS.join(', ')}`);
  }

  const records = listMetrics(store, options);
  if (!records.length) return [];
  const checkpoint = options.checkpoint ?? comparisonCheckpoint(records);
  const prepared = records
    .map((record) => {
      const snapshot = snapshotAtCheckpoint(record, checkpoint);
      const traction = summarizeTraction(record, snapshot);
      const value = comparisonMetricValue(snapshot, traction, metric);
      return {
        rank: null,
        post_id: record.post_id,
        job_id: record.job_id,
        platform: record.platform,
        content_type: record.content_type,
        experiment_id: record.experiment_id,
        variant_id: record.variant_id,
        creative_lane: record.creative_lane,
        metric,
        value,
        comparison_checkpoint: checkpoint,
        latest_snapshot_at: snapshot?.captured_at ?? null,
        compared_posts: 0,
        total_candidate_posts: records.length,
        measurement_state: comparisonMeasurementState(snapshot, traction, metric),
        comparison_note: '',
        views: snapshot?.views ?? null,
        likes: snapshot?.likes ?? null,
        comments: snapshot?.comments ?? null,
        shares: snapshot?.shares ?? null,
        saves: snapshot?.saves ?? null,
        follows: snapshot?.follows ?? null,
        profile_visits: snapshot?.profile_visits ?? null,
        dms: snapshot?.dms ?? null,
        traction,
      };
    });
  const comparedPosts = prepared.filter((row) => row.value !== null).length;
  const comparisonNote = [
    comparedPosts < 10
      ? 'Directional only: small pilot sample. Do not treat rank as a conclusive format winner.'
      : 'Directional ranking; confirm with repeated posts and completed 7-day reads.',
    `All values use the ${checkpoint} checkpoint; ${records.length - comparedPosts} of ${records.length} posts remain visible but unranked because the selected value is unavailable.`,
  ].join(' ');
  let rank = 0;
  return prepared
    .sort((left, right) => (
      left.value === null && right.value === null
        ? left.post_id.localeCompare(right.post_id)
        : left.value === null ? 1
          : right.value === null ? -1
            : right.value - left.value || left.post_id.localeCompare(right.post_id)
    ))
    .map((row) => ({
      ...row,
      rank: row.value === null ? null : ++rank,
      compared_posts: comparedPosts,
      comparison_note: comparisonNote,
    }));
}

export function summarizeTraction(
  record: PostMetricsRecord,
  snapshot: MetricSnapshot | null = latestMetricSnapshot(record),
): TractionSummary {
  if (!snapshot) {
    return {
      view_velocity: null,
      average_watch_time_sec: null,
      completion_rate: null,
      rewatch_rate: null,
      share_rate: null,
      save_rate: null,
      follow_rate: null,
      profile_visit_rate: null,
    };
  }
  const previous = previousObservedSnapshot(record, snapshot, 'views');
  const elapsedHours = previous
    ? (Date.parse(snapshot.captured_at) - Date.parse(previous.captured_at)) / 3_600_000
    : null;
  const viewVelocity = (
    previous
    && previous.views !== null
    && snapshot.views !== null
    && elapsedHours !== null
    && elapsedHours > 0
    && snapshot.views >= previous.views
  ) ? round((snapshot.views - previous.views) / elapsedHours) : null;
  const rate = (value: number | null): number | null => {
    if (value === null || snapshot.views === null || snapshot.views < 0) return null;
    if (snapshot.views === 0) return value === 0 ? 0 : null;
    return round(value / snapshot.views);
  };
  return {
    view_velocity: viewVelocity,
    average_watch_time_sec: snapshot.average_watch_time_sec,
    completion_rate: snapshot.completion_rate,
    rewatch_rate: snapshot.rewatch_rate,
    share_rate: rate(snapshot.shares),
    save_rate: rate(snapshot.saves),
    follow_rate: rate(snapshot.follows),
    profile_visit_rate: rate(snapshot.profile_visits),
  };
}

export function latestMetricSnapshot(record: PostMetricsRecord): MetricSnapshot | null {
  const validated = validatePostMetricsRecord(record);
  return validated.metric_snapshots.at(-1) ?? null;
}

export function snapshotAtCheckpoint(
  record: PostMetricsRecord,
  checkpoint: TractionCheckpoint,
): MetricSnapshot | null {
  const validated = validatePostMetricsRecord(record);
  const snapshots = validated.metric_snapshots.filter((snapshot) => snapshot.checkpoint === checkpoint);
  return snapshots.at(-1) ?? null;
}

function comparisonMetricValue(
  snapshot: MetricSnapshot | null,
  traction: TractionSummary,
  metric: ComparisonMetric,
): number | null {
  if (RAW_COMPARISON_METRICS.includes(metric as RawComparisonMetric)) {
    return snapshot?.[metric as RawComparisonMetric] ?? null;
  }
  return traction[metric as TractionComparisonMetric] ?? null;
}

function comparisonMeasurementState(
  snapshot: MetricSnapshot | null,
  traction: TractionSummary,
  metric: ComparisonMetric,
): MeasurementState | 'derived' | 'unavailable' {
  if (!snapshot) return 'unavailable';
  if (RAW_COMPARISON_METRICS.includes(metric as RawComparisonMetric)) {
    return snapshot.measurement_states[metric as RawComparisonMetric];
  }
  return traction[metric as TractionComparisonMetric] === null ? 'unavailable' : 'derived';
}

function comparisonCheckpoint(records: PostMetricsRecord[]): TractionCheckpoint {
  const standard = (['7d', '72h', '24h', '1h'] as TractionCheckpoint[])
    .map((checkpoint, maturity) => ({
      checkpoint,
      maturity,
      coverage: records.filter((record) => snapshotAtCheckpoint(record, checkpoint)).length,
    }))
    .filter((row) => row.coverage > 0)
    .sort((left, right) => right.coverage - left.coverage || left.maturity - right.maturity);
  if (standard[0]) return standard[0].checkpoint;
  const customCoverage = records.filter((record) => snapshotAtCheckpoint(record, 'custom')).length;
  if (!customCoverage) throw new Error('No metric snapshots are available for comparison.');
  validateCustomComparisonWindow(records);
  return 'custom';
}

function validateCustomComparisonWindow(records: PostMetricsRecord[]): void {
  const elapsedHours = records.flatMap((record): number[] => {
    const snapshot = snapshotAtCheckpoint(record, 'custom');
    if (!snapshot) return [];
    return [(Date.parse(snapshot.captured_at) - Date.parse(record.posted_at)) / 3_600_000];
  });
  if (
    elapsedHours.length > 1
    && Math.max(...elapsedHours) - Math.min(...elapsedHours) > 1
  ) {
    throw new Error(
      'Custom snapshots are not checkpoint-matched; record a shared 1h, 24h, 72h, or 7d checkpoint.',
    );
  }
}

function previousObservedSnapshot(
  record: PostMetricsRecord,
  snapshot: MetricSnapshot,
  metric: RawComparisonMetric,
): MetricSnapshot | null {
  const validated = validatePostMetricsRecord(record);
  return validated.metric_snapshots
    .filter((candidate) => (
      Date.parse(candidate.captured_at) < Date.parse(snapshot.captured_at)
      && candidate[metric] !== null
      && candidate.measurement_states[metric] === 'observed'
    ))
    .at(-1) ?? null;
}

export function exportMetrics(
  store: PostMetricsStore,
  format: 'json' | 'csv',
  filters: MetricsListFilters = {},
): string {
  const records = listMetrics(store, filters);
  if (format === 'json') return `${JSON.stringify(records, null, 2)}\n`;
  if (format === 'csv') return toCsv(records);
  throw new Error('format must be json or csv');
}

function toCsv(records: PostMetricsRecord[]): string {
  const headers = [
    'post_id',
    'job_id',
    'platform',
    'account_handle',
    'posted_url',
    'posted_at',
    'content_type',
    'hook',
    'format',
    'CTA',
    'experiment_id',
    'variant_id',
    'creative_lane',
    'delivery_mode',
    'audio_mode',
    'duration_sec',
    'captured_at',
    'checkpoint',
    'views',
    'likes',
    'comments',
    'shares',
    'saves',
    'follows',
    'profile_visits',
    'dms',
    'average_watch_time_sec',
    'completion_rate',
    'rewatch_rate',
    'view_velocity',
    'share_rate',
    'save_rate',
    'follow_rate',
    'profile_visit_rate',
    'measurement_states',
    'post_notes',
    'snapshot_notes',
  ];
  const rows = records.flatMap((record) => {
    const snapshots: Array<MetricSnapshot | null> = record.metric_snapshots.length
      ? record.metric_snapshots
      : [null];
    return snapshots.map((snapshot) => {
    const traction = summarizeTraction(record, snapshot);
    return [
      record.post_id,
      record.job_id,
      record.platform,
      record.account_handle,
      record.posted_url,
      record.posted_at,
      record.content_type,
      record.hook,
      record.format,
      record.CTA,
      record.experiment_id ?? '',
      record.variant_id ?? '',
      record.creative_lane ?? '',
      record.delivery_mode ?? '',
      record.audio_mode ?? '',
      record.duration_sec ?? '',
      snapshot?.captured_at ?? '',
      snapshot?.checkpoint ?? '',
      snapshot?.views ?? '',
      snapshot?.likes ?? '',
      snapshot?.comments ?? '',
      snapshot?.shares ?? '',
      snapshot?.saves ?? '',
      snapshot?.follows ?? '',
      snapshot?.profile_visits ?? '',
      snapshot?.dms ?? '',
      snapshot?.average_watch_time_sec ?? '',
      snapshot?.completion_rate ?? '',
      snapshot?.rewatch_rate ?? '',
      traction.view_velocity ?? '',
      traction.share_rate ?? '',
      traction.save_rate ?? '',
      traction.follow_rate ?? '',
      traction.profile_visit_rate ?? '',
      snapshot ? JSON.stringify(snapshot.measurement_states) : '',
      record.notes.join(' | '),
      snapshot?.notes.join(' | ') ?? '',
    ].map(csvCell).join(',');
    });
  });
  return `${headers.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const storePath = stringOpt(options, 'store') ?? DEFAULT_METRICS_STORE_PATH;

  switch (command) {
    case 'create-post': {
      const store = loadPostMetricsStore(storePath);
      const next = createPostInStore(store, {
        post_id: requiredStringOpt(options, 'post-id'),
        job_id: requiredStringOpt(options, 'job-id'),
        platform: requiredStringOpt(options, 'platform'),
        account_handle: requiredStringOpt(options, 'account-handle'),
        posted_url: requiredStringOpt(options, 'posted-url'),
        posted_at: stringOpt(options, 'posted-at') ?? new Date().toISOString(),
        content_type: requiredStringOpt(options, 'content-type'),
        hook: requiredStringOpt(options, 'hook'),
        format: requiredStringOpt(options, 'format'),
        CTA: requiredStringOpt(options, 'cta'),
        experiment_id: stringOpt(options, 'experiment-id'),
        variant_id: stringOpt(options, 'variant-id'),
        creative_lane: stringOpt(options, 'creative-lane'),
        delivery_mode: stringOpt(options, 'delivery-mode'),
        audio_mode: stringOpt(options, 'audio-mode'),
        duration_sec: nonNegativeNumberOpt(options, 'duration-sec'),
        metric_snapshots: [],
        notes: stringListOpt(options, 'notes'),
      });
      savePostMetricsStore(next, storePath);
      console.log(JSON.stringify({ ok: true, store: storePath, post_id: requiredStringOpt(options, 'post-id') }, null, 2));
      return;
    }

    case 'add-snapshot': {
      const store = loadPostMetricsStore(storePath);
      const postId = requiredStringOpt(options, 'post-id');
      const next = addMetricSnapshotToStore(store, postId, {
        captured_at: stringOpt(options, 'captured-at') ?? new Date().toISOString(),
        checkpoint: stringOpt(options, 'checkpoint') ?? 'custom',
        views: numberOpt(options, 'views'),
        likes: numberOpt(options, 'likes'),
        comments: numberOpt(options, 'comments'),
        shares: numberOpt(options, 'shares'),
        saves: numberOpt(options, 'saves'),
        follows: numberOpt(options, 'follows'),
        profile_visits: numberOpt(options, 'profile-visits'),
        dms: numberOpt(options, 'dms'),
        average_watch_time_sec: nonNegativeNumberOpt(options, 'average-watch-time-sec'),
        completion_rate: rateOpt(options, 'completion-rate'),
        rewatch_rate: rateOpt(options, 'rewatch-rate'),
        measurement_states: measurementStatesFromOptions(options),
        notes: stringListOpt(options, 'notes'),
      });
      savePostMetricsStore(next, storePath);
      console.log(JSON.stringify({ ok: true, store: storePath, post_id: postId }, null, 2));
      return;
    }

    case 'list': {
      const records = listMetrics(loadPostMetricsStore(storePath), filtersFromOptions(options));
      console.log(JSON.stringify({ count: records.length, records }, null, 2));
      return;
    }

    case 'compare': {
      const rows = comparePosts(loadPostMetricsStore(storePath), {
        ...filtersFromOptions(options),
        metric: metricOpt(stringOpt(options, 'metric') ?? 'views'),
        checkpoint: checkpointOpt(stringOpt(options, 'checkpoint')),
      });
      console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
      return;
    }

    case 'export': {
      const format = exportFormatOpt(stringOpt(options, 'format') ?? 'json');
      const output = exportMetrics(loadPostMetricsStore(storePath), format, filtersFromOptions(options));
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        atomicWriteFile(outPath, output);
        console.log(JSON.stringify({ ok: true, store: storePath, out: outPath, format }, null, 2));
        return;
      }
      process.stdout.write(output);
      return;
    }

    case 'help':
    default:
      printHelp();
      process.exit(command === 'help' ? 0 : 1);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const [command = 'help', ...rest] = argv;
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }

  return { command, options };
}

function filtersFromOptions(options: Record<string, string | boolean>): MetricsListFilters {
  return {
    platform: stringOpt(options, 'platform'),
    job_id: stringOpt(options, 'job-id'),
    content_type: stringOpt(options, 'content-type'),
    experiment_id: stringOpt(options, 'experiment-id'),
    creative_lane: optionalCreativeLane(stringOpt(options, 'creative-lane')),
    checkpoint: checkpointOpt(stringOpt(options, 'checkpoint')),
  };
}

function stringOpt(options: Record<string, string | boolean>, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredStringOpt(options: Record<string, string | boolean>, key: string): string {
  const value = stringOpt(options, key);
  if (!value) throw new Error(`Missing required option --${key}`);
  return value;
}

function numberOpt(options: Record<string, string | boolean>, key: string): number | undefined {
  const value = stringOpt(options, key);
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`--${key} must be a non-negative number`);
  return Math.trunc(number);
}

function nonNegativeNumberOpt(options: Record<string, string | boolean>, key: string): number | undefined {
  const value = stringOpt(options, key);
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`--${key} must be a non-negative number`);
  return number;
}

function rateOpt(options: Record<string, string | boolean>, key: string): number | undefined {
  const number = nonNegativeNumberOpt(options, key);
  if (number !== undefined && number > 1) throw new Error(`--${key} must be from 0 to 1`);
  return number;
}

function optionalCreativeLane(value: string | undefined): CreativeLane | undefined {
  if (value === undefined) return undefined;
  if (!CREATIVE_LANES.includes(value as CreativeLane)) {
    throw new Error(`--creative-lane must be one of: ${CREATIVE_LANES.join(', ')}`);
  }
  return value as CreativeLane;
}

function checkpointOpt(value: string | undefined): TractionCheckpoint | undefined {
  if (value === undefined) return undefined;
  if (!TRACTION_CHECKPOINTS.includes(value as TractionCheckpoint)) {
    throw new Error(`--checkpoint must be one of: ${TRACTION_CHECKPOINTS.join(', ')}`);
  }
  return value as TractionCheckpoint;
}

function measurementStatesFromOptions(
  options: Record<string, string | boolean>,
): Partial<MetricMeasurementStates> | undefined {
  const output: Partial<MetricMeasurementStates> = {};
  for (const metric of SNAPSHOT_METRICS) {
    const option = `${metric.replaceAll('_', '-')}-state`;
    const value = stringOpt(options, option);
    if (!value) continue;
    if (!MEASUREMENT_STATES.includes(value as MeasurementState)) {
      throw new Error(`--${option} must be one of: ${MEASUREMENT_STATES.join(', ')}`);
    }
    output[metric] = value as MeasurementState;
  }
  return Object.keys(output).length ? output : undefined;
}

function stringListOpt(options: Record<string, string | boolean>, key: string): string[] {
  const value = stringOpt(options, key);
  if (!value) return [];
  return value.split('|').map((item) => item.trim()).filter(Boolean);
}

function metricOpt(value: string): ComparisonMetric {
  if (!COMPARISON_METRICS.includes(value as ComparisonMetric)) {
    throw new Error(`--metric must be one of: ${COMPARISON_METRICS.join(', ')}`);
  }
  return value as ComparisonMetric;
}

function exportFormatOpt(value: string): 'json' | 'csv' {
  if (value !== 'json' && value !== 'csv') {
    throw new Error('--format must be json or csv');
  }
  return value;
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredRecordArray(record: Record<string, unknown>, field: string): Array<Record<string, unknown>> {
  const value = record[field];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => expectRecord(item, `${field}[${index}]`));
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredUrl(record: Record<string, unknown>, field: string): string {
  const value = requiredText(record, field);
  try {
    new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  return value;
}

function requiredDateTime(record: Record<string, unknown>, field: string): string {
  const value = requiredText(record, field);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid date-time string.`);
  }
  return value;
}

function optionalDateTime(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a valid date-time string when provided.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid date-time string.`);
  }
  return value.trim();
}

function nullableText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be null or a non-empty string.`);
  }
  return value.trim();
}

function nullableOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] | null {
  const text = nullableText(value, field);
  return text === null ? null : oneOf(text, allowed, field);
}

function nullablePositiveNumber(value: unknown, field: string): number | null {
  const number = nullableNonNegativeNumber(value, field);
  if (number === null) return null;
  if (number <= 0) throw new Error(`${field} must be positive when provided.`);
  return number;
}

function nullableNonNegativeNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number when provided.`);
  }
  return value;
}

function nullableRate(value: unknown, field: string): number | null {
  const number = nullableNonNegativeNumber(value, field);
  if (number !== null && number > 1) throw new Error(`${field} must be from 0 to 1.`);
  return number;
}

function nullableMetricNumber(value: unknown, field: string): number | null {
  const number = nullableNonNegativeNumber(value, field);
  return number === null ? null : Math.trunc(number);
}

function measurementStates(
  value: unknown,
  metrics: Record<SnapshotMetric, number | null>,
): MetricMeasurementStates {
  const supplied = value === undefined || value === null
    ? {}
    : expectRecord(value, 'measurement_states');
  return Object.fromEntries(SNAPSHOT_METRICS.map((metric) => {
    const state = supplied[metric];
    if (state === undefined) return [metric, metrics[metric] === null ? 'not_available' : 'observed'];
    if (typeof state !== 'string' || !MEASUREMENT_STATES.includes(state as MeasurementState)) {
      throw new Error(`measurement_states.${metric} must be one of: ${MEASUREMENT_STATES.join(', ')}.`);
    }
    return [metric, state];
  })) as MetricMeasurementStates;
}

function validateMeasurementStateConsistency(snapshot: MetricSnapshot): void {
  for (const metric of SNAPSHOT_METRICS) {
    const state = snapshot.measurement_states[metric];
    const value = snapshot[metric];
    if (state === 'observed' && value === null) {
      throw new Error(`${metric} must have a value when measurement_states.${metric}=observed.`);
    }
    if (state !== 'observed' && value !== null) {
      throw new Error(`${metric} must be null when measurement_states.${metric}=${state}.`);
    }
  }
}

function validateSnapshotSequence(post: PostMetricsRecord): void {
  const captures = new Set<string>();
  const standardCheckpoints = new Set<TractionCheckpoint>();
  let previous: MetricSnapshot | null = null;
  for (const snapshot of post.metric_snapshots) {
    if (Date.parse(snapshot.captured_at) < Date.parse(post.posted_at)) {
      throw new Error(`metric snapshot ${snapshot.captured_at} precedes posted_at for ${post.post_id}.`);
    }
    if (captures.has(snapshot.captured_at)) {
      throw new Error(`duplicate metric snapshot captured_at for ${post.post_id}: ${snapshot.captured_at}`);
    }
    captures.add(snapshot.captured_at);
    if (snapshot.checkpoint !== 'custom') {
      if (standardCheckpoints.has(snapshot.checkpoint)) {
        throw new Error(`duplicate metric checkpoint for ${post.post_id}: ${snapshot.checkpoint}`);
      }
      standardCheckpoints.add(snapshot.checkpoint);
    }
    if (previous) {
      for (const metric of RAW_COMPARISON_METRICS) {
        const prior = previous[metric];
        const current = snapshot[metric];
        if (
          prior !== null
          && current !== null
          && previous.measurement_states[metric] === 'observed'
          && snapshot.measurement_states[metric] === 'observed'
          && current < prior
        ) {
          throw new Error(`${metric} must be monotonic for ${post.post_id}; ${current} is below ${prior}.`);
        }
      }
    }
    previous = snapshot;
  }
}

function oneOf<T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (!allowed.includes(value as T[number])) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}

function normalizeTextArray(
  value: unknown,
  field: string,
  options: { allowEmpty: boolean },
): string[] {
  if (value === undefined || value === null) {
    if (options.allowEmpty) return [];
    throw new Error(`${field} must be an array.`);
  }
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  const clean = value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${field}[${index}] must be a non-empty string.`);
    }
    return item.trim();
  });
  if (!options.allowEmpty && !clean.length) throw new Error(`${field} must not be empty.`);
  return clean;
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function printHelp(): void {
  console.log(`Viral-Bench post metrics CLI

Commands:
  create-post --post-id post-001 --job-id job-001 --platform TikTok --account-handle @account --posted-url https://example.com/post --content-type slideshow --hook "Opening hook" --format slideshow --cta "Save this" --experiment-id experiment-001 --variant-id variant-a --creative-lane image_slideshow --delivery-mode native_carousel --audio-mode platform_commercial_music
  add-snapshot --post-id post-001 --checkpoint 24h --views 1000 --likes 120 --comments 15 --shares 20 --saves 80 --follows 8 --profile-visits 30 --dms 2 --average-watch-time-sec 8.4 --completion-rate 0.42 --rewatch-rate 0.08
  list --platform TikTok --experiment-id experiment-001 --creative-lane image_slideshow
  compare --metric view_velocity --experiment-id experiment-001
  export --format csv --out .ops/metrics/post_metrics.csv

Notes:
  - Metrics are local manual records only.
  - No provider credentials, scraping, browser automation, or social posting is used.
`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
