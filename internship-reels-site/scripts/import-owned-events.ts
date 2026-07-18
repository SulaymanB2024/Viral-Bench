import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

type UnknownRecord = Record<string, unknown>;

const PROHIBITED_FIELDS = [
  'resume_text',
  'name',
  'email',
  'message',
  'user_id',
  'application_history',
] as const;

const EVENT_NAMES = new Set([
  'search_performed',
  'zero_results',
  'listing_clicked',
  'listing_saved',
  'match_viewed',
  'tailor_started',
  'tailor_completed',
  'tailor_edited',
  'tailor_rejected',
  'application_started',
  'application_reviewed',
  'application_submitted',
  'social_reach',
  'social_three_second_view',
  'social_completed_view',
  'social_saved',
  'social_shared',
  'social_commented',
  'social_profile_visit',
  'social_followed',
  'social_link_clicked',
]);

export interface OwnedEvidenceImport {
  schema_version: 'viralbench_owned_evidence_v1';
  generated_at: string;
  connection_state: 'not_connected' | 'connected';
  source_rows: number;
  aggregates: Array<{
    aggregate_id: string;
    bucket_start: string;
    bucket_end: string;
    audience_segment: string;
    event_name: string;
    count: number;
    minimum_bucket_count: number;
    summary: string;
  }>;
  privacy: {
    aggregate_only: true;
    minimum_bucket_count: 5;
    prohibited_fields: typeof PROHIBITED_FIELDS;
  };
  measurement_gaps: string[];
}

export function importOwnedEvents(input: unknown, generatedAt = new Date().toISOString()): OwnedEvidenceImport {
  const rows = normalizeRows(input);
  for (const row of rows) assertNoProhibitedFields(row);
  const aggregates = rows.map((raw, index) => validateRow(raw, index));
  return {
    schema_version: 'viralbench_owned_evidence_v1',
    generated_at: generatedAt,
    connection_state: aggregates.length ? 'connected' : 'not_connected',
    source_rows: rows.length,
    aggregates,
    privacy: {
      aggregate_only: true,
      minimum_bucket_count: 5,
      prohibited_fields: PROHIBITED_FIELDS,
    },
    measurement_gaps: aggregates.length
      ? []
      : ['No privacy-safe owned aggregate export is connected; absence is not interpreted as zero demand or performance.'],
  };
}

export function disconnectedOwnedEvidence(generatedAt = new Date().toISOString()): OwnedEvidenceImport {
  return importOwnedEvents([], generatedAt);
}

function validateRow(value: unknown, index: number): OwnedEvidenceImport['aggregates'][number] {
  const row = record(value, `owned event row ${index}`);
  if (row.schema_version !== 2) throw new Error(`owned event row ${index} schema_version must be 2.`);
  const bucketStart = dateTime(row.bucket_start, `row ${index} bucket_start`);
  const bucketEnd = dateTime(row.bucket_end, `row ${index} bucket_end`);
  if (Date.parse(bucketEnd) <= Date.parse(bucketStart)) {
    throw new Error(`owned event row ${index} bucket_end must be after bucket_start.`);
  }
  const eventName = requiredText(row.event_name, `row ${index} event_name`);
  if (!EVENT_NAMES.has(eventName)) throw new Error(`owned event row ${index} event_name is unsupported.`);
  const audienceSegment = requiredText(row.audience_segment, `row ${index} audience_segment`);
  const count = integer(row.count, `row ${index} count`, 0);
  const privacy = record(row.privacy, `row ${index} privacy`);
  if (privacy.aggregate_only !== true) throw new Error(`owned event row ${index} must be aggregate_only.`);
  const minimumBucketCount = integer(privacy.minimum_bucket_count, `row ${index} minimum_bucket_count`, 5);
  const prohibited = Array.isArray(privacy.prohibited_fields) ? privacy.prohibited_fields : [];
  if (JSON.stringify(prohibited) !== JSON.stringify(PROHIBITED_FIELDS)) {
    throw new Error(`owned event row ${index} prohibited_fields must match the privacy contract.`);
  }
  if (count > 0 && count < minimumBucketCount) {
    throw new Error(`owned event row ${index} count is below its privacy bucket.`);
  }
  const identity = {
    bucket_start: bucketStart,
    bucket_end: bucketEnd,
    account_id: requiredText(row.account_id, `row ${index} account_id`),
    campaign_id: nullableText(row.campaign_id),
    experiment_id: nullableText(row.experiment_id),
    variant_id: nullableText(row.variant_id),
    post_id: nullableText(row.post_id),
    audience_segment: audienceSegment,
    event_name: eventName,
  };
  return {
    aggregate_id: createHash('sha256').update(stableJson(identity)).digest('hex').slice(0, 24),
    bucket_start: bucketStart,
    bucket_end: bucketEnd,
    audience_segment: audienceSegment,
    event_name: eventName,
    count,
    minimum_bucket_count: minimumBucketCount,
    summary: `${humanize(eventName)} was observed ${count} times in the privacy-safe ${humanize(audienceSegment)} aggregate bucket.`,
  };
}

function normalizeRows(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  const root = input as UnknownRecord;
  if (Array.isArray(root.events)) return root.events;
  if (root.schema_version === 2) return [root];
  return [];
}

function assertNoProhibitedFields(value: unknown, pathLabel = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoProhibitedFields(item, `${pathLabel}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as UnknownRecord)) {
    if ((PROHIBITED_FIELDS as readonly string[]).includes(key) && pathLabel !== 'root.privacy') {
      throw new Error(`Prohibited owned-data field found at ${pathLabel}.${key}.`);
    }
    assertNoProhibitedFields(nested, `${pathLabel}.${key}`);
  }
}

function parseInput(source: string, extension: string): unknown {
  if (extension === '.jsonl' || extension === '.ndjson') {
    return source.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(`Invalid JSONL row ${index + 1}.`);
      }
    });
  }
  return JSON.parse(source) as unknown;
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as UnknownRecord;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value.trim();
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateTime(value: unknown, label: string): string {
  const text = requiredText(value, label);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO date-time.`);
  return new Date(parsed).toISOString();
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new Error(`${label} must be an integer >= ${minimum}.`);
  return Number(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as UnknownRecord).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const inputPath = option(args, '--input');
  const outputPath = path.resolve(option(args, '--out') ?? path.join(siteDirectory, 'data/owned-evidence.json'));
  const result = inputPath
    ? importOwnedEvents(
        parseInput(fs.readFileSync(path.resolve(inputPath), 'utf8'), path.extname(inputPath).toLowerCase()),
      )
    : disconnectedOwnedEvidence();
  atomicWrite(outputPath, result);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output_path: outputPath,
    connection_state: result.connection_state,
    aggregates: result.aggregates.length,
    prohibited_fields_retained: 0,
    external_calls_made: 0,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
