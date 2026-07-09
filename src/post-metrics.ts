import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_METRICS_STORE_PATH = path.join(process.cwd(), '.ops', 'metrics', 'post_metrics.json');

export const COMPARISON_METRICS = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'follows',
  'profile_visits',
  'dms',
] as const;

export type ComparisonMetric = typeof COMPARISON_METRICS[number];

export interface MetricSnapshot {
  captured_at: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  follows: number;
  profile_visits: number;
  dms: number;
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
}

export interface MetricsComparisonRow {
  rank: number;
  post_id: string;
  job_id: string;
  platform: string;
  content_type: string;
  metric: ComparisonMetric;
  value: number;
  latest_snapshot_at: string | null;
  compared_posts: number;
  comparison_note: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  follows: number;
  profile_visits: number;
  dms: number;
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
    metric_snapshots: requiredRecordArray(record, 'metric_snapshots').map(validateMetricSnapshot),
    notes: normalizeTextArray(record.notes, 'notes', { allowEmpty: true }),
  };

  post.metric_snapshots.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  return post;
}

export function validateMetricSnapshot(input: unknown): MetricSnapshot {
  const record = expectRecord(input, 'metric snapshot');
  return {
    captured_at: requiredDateTime(record, 'captured_at'),
    views: requiredMetricNumber(record, 'views'),
    likes: requiredMetricNumber(record, 'likes'),
    comments: requiredMetricNumber(record, 'comments'),
    shares: requiredMetricNumber(record, 'shares'),
    saves: requiredMetricNumber(record, 'saves'),
    follows: requiredMetricNumber(record, 'follows'),
    profile_visits: requiredMetricNumber(record, 'profile_visits'),
    dms: requiredMetricNumber(record, 'dms'),
    notes: normalizeTextArray(record.notes, 'notes', { allowEmpty: true }),
  };
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
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`);
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
  const comparisonNote = records.length < 10
    ? 'Directional only: small pilot sample. Do not treat rank as a conclusive format winner.'
    : 'Directional ranking; confirm with repeated posts and completed 7-day reads.';

  return records
    .map((record) => {
      const latest = latestMetricSnapshot(record);
      return {
        rank: 0,
        post_id: record.post_id,
        job_id: record.job_id,
        platform: record.platform,
        content_type: record.content_type,
        metric,
        value: latest?.[metric] ?? 0,
        latest_snapshot_at: latest?.captured_at ?? null,
        compared_posts: records.length,
        comparison_note: comparisonNote,
        views: latest?.views ?? 0,
        likes: latest?.likes ?? 0,
        comments: latest?.comments ?? 0,
        shares: latest?.shares ?? 0,
        saves: latest?.saves ?? 0,
        follows: latest?.follows ?? 0,
        profile_visits: latest?.profile_visits ?? 0,
        dms: latest?.dms ?? 0,
      };
    })
    .sort((a, b) => b.value - a.value || a.post_id.localeCompare(b.post_id))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function latestMetricSnapshot(record: PostMetricsRecord): MetricSnapshot | null {
  const validated = validatePostMetricsRecord(record);
  return validated.metric_snapshots.at(-1) ?? null;
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
    'latest_captured_at',
    'views',
    'likes',
    'comments',
    'shares',
    'saves',
    'follows',
    'profile_visits',
    'dms',
    'notes',
  ];
  const rows = records.map((record) => {
    const latest = latestMetricSnapshot(record);
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
      latest?.captured_at ?? '',
      latest?.views ?? 0,
      latest?.likes ?? 0,
      latest?.comments ?? 0,
      latest?.shares ?? 0,
      latest?.saves ?? 0,
      latest?.follows ?? 0,
      latest?.profile_visits ?? 0,
      latest?.dms ?? 0,
      record.notes.join(' | '),
    ].map(csvCell).join(',');
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
        views: numberOpt(options, 'views') ?? 0,
        likes: numberOpt(options, 'likes') ?? 0,
        comments: numberOpt(options, 'comments') ?? 0,
        shares: numberOpt(options, 'shares') ?? 0,
        saves: numberOpt(options, 'saves') ?? 0,
        follows: numberOpt(options, 'follows') ?? 0,
        profile_visits: numberOpt(options, 'profile-visits') ?? 0,
        dms: numberOpt(options, 'dms') ?? 0,
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
      });
      console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
      return;
    }

    case 'export': {
      const format = exportFormatOpt(stringOpt(options, 'format') ?? 'json');
      const output = exportMetrics(loadPostMetricsStore(storePath), format, filtersFromOptions(options));
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, output);
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

function requiredMetricNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.trunc(value);
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

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function printHelp(): void {
  console.log(`Viral-Bench post metrics CLI

Commands:
  create-post --post-id worthscan-post-001 --job-id worthscan_bike_commuter_001 --platform TikTok --account-handle @worthscan --posted-url https://example.com/post --content-type slideshow --hook "Scan this bike" --format slideshow --cta "Comment scan"
  add-snapshot --post-id worthscan-post-001 --views 1000 --likes 120 --comments 15 --shares 20 --saves 80 --follows 8 --profile-visits 30 --dms 2
  list --platform TikTok --job-id worthscan_bike_commuter_001
  compare --metric saves --content-type slideshow
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
