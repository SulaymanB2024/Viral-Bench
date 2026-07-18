import * as crypto from 'node:crypto';
import {
  createProviderSpendEventV1,
  type AcquisitionRunV1,
} from './provider-acquisition-contracts';

export const APIFY_API_BASE = 'https://api.apify.com/v2';

export type ApifyRunStatus =
  | 'READY'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMING-OUT'
  | 'TIMED-OUT'
  | 'ABORTING'
  | 'ABORTED';

export interface ApifyRunData {
  id: string;
  status: ApifyRunStatus;
  defaultDatasetId: string | null;
  buildId: string | null;
  buildNumber: string | null;
  usageTotalUsd: number | null;
  pricingInfo: unknown | null;
  chargedEventCounts: Record<string, number> | null;
}

export interface ApifyActorExecution {
  actor_id: string;
  actor_build_id: string | null;
  actor_build_number: string | null;
  actor_input_sha256: string;
  actor_input_mode: 'explicit_url' | 'search' | 'profile' | 'channel' | 'hashtag';
  run_id: string;
  dataset_id: string;
  status: 'SUCCEEDED';
  items: unknown[];
  item_offsets: number[];
  dataset_items_returned: number;
  dataset_items_total_reported: number | null;
  dataset_truncated: boolean;
  dataset_truncation_unknown: boolean;
  actual_cost_usd: number | null;
  usage_finalized: boolean;
  pricing_info: unknown | null;
  charged_event_counts: Record<string, number> | null;
  external_calls_made: number;
  requested_build?: string | null;
  build_drift_detected?: boolean;
  dataset_completion_state?: 'complete' | 'truncated' | 'unknown';
  usage_settlement_state?: 'settled' | 'unknown';
  duplicate_adjusted_unique_items?: number;
}

export interface ApifyCompatibleRunConsolidation {
  actor_id: string;
  requested_build: string | null;
  resolved_builds: string[];
  run_ids: string[];
  returned_items: number;
  unique_items: number;
  duplicate_adjusted_yield: number;
  actual_cost_usd: number | null;
  conservative_cost_usd: number;
  unknown_spend: boolean;
  dataset_completion_state: 'complete' | 'truncated' | 'unknown';
}

export interface ApifyAcquisitionRunOptions {
  programId: string;
  routeId: string;
  reservationUsd: number;
  programCeilingUsd: number;
  priorConservativeSpendUsd: number;
  counts?: Partial<AcquisitionRunV1['counts']>;
  now?: () => Date;
}

export interface ApifyApiOptions {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  retryBaseMs?: number;
  maxRetryAttempts?: number;
}

export interface ExecuteActorOptions {
  actorId: string;
  input: Record<string, unknown>;
  inputMode: ApifyActorExecution['actor_input_mode'];
  maxTotalChargeUsd: number;
  build?: string;
  maxItems?: number;
  timeoutSeconds?: number;
  memoryMb?: number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  datasetPageSize?: number;
  maxDatasetItems?: number;
  usageSettlementMs?: number;
}

interface ApifyEnvelope {
  data?: Record<string, unknown>;
  error?: { type?: string; message?: string };
}

/**
 * Minimal REST adapter for paid Actor runs. Chargeable creation POSTs are never
 * retried because Apify does not expose a run-start idempotency key.
 */
export class ApifyApiClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly retryBaseMs: number;
  private readonly maxRetryAttempts: number;
  private calls = 0;

  constructor(options: ApifyApiOptions) {
    if (!options.token.trim()) throw new Error('APIFY_TOKEN is required.');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? wait;
    this.random = options.random ?? Math.random;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.maxRetryAttempts = options.maxRetryAttempts ?? 4;
  }

  get externalCallsMade(): number {
    return this.calls;
  }

  async executeActor(options: ExecuteActorOptions): Promise<ApifyActorExecution> {
    if (!Number.isFinite(options.maxTotalChargeUsd) || options.maxTotalChargeUsd <= 0) {
      throw new Error('Apify Actor runs require a positive finite maxTotalChargeUsd.');
    }
    const actorId = canonicalActorId(options.actorId);
    const query = new URLSearchParams({
      waitForFinish: '0',
      maxTotalChargeUsd: String(options.maxTotalChargeUsd),
    });
    if (options.build?.trim()) query.set('build', options.build.trim());
    if (options.maxItems !== undefined) query.set('maxItems', String(positiveInteger(options.maxItems, 'maxItems')));
    if (options.timeoutSeconds !== undefined) query.set('timeout', String(positiveInteger(options.timeoutSeconds, 'timeoutSeconds')));
    if (options.memoryMb !== undefined) query.set('memory', String(positiveInteger(options.memoryMb, 'memoryMb')));

    const startResponse = await this.fetchOnce(
      `${APIFY_API_BASE}/actors/${encodeURIComponent(actorId)}/runs?${query}`,
      {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(options.input),
      },
    );
    const start = await parseJson<ApifyEnvelope>(startResponse, 'Apify Actor start');
    const runId = text(start.data?.id);
    if (!runId) throw new Error(redact(`apify_actor_start:${start.error?.message ?? 'missing run id'}`));

    const attempts = options.maxPollAttempts ?? 120;
    const interval = options.pollIntervalMs ?? 2_000;
    let terminal: ApifyRunData | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const run = await this.getRun(runId);
      if (run.status === 'SUCCEEDED') {
        terminal = run;
        break;
      }
      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
        throw new Error(`apify_run_failed:${run.status}`);
      }
      if (attempt === attempts - 1) throw new Error('apify_poll_timeout');
      await this.sleep(interval);
    }
    if (!terminal?.defaultDatasetId) throw new Error('apify_run_missing_dataset');

    const dataset = await this.getAllDatasetItems(
      terminal.defaultDatasetId,
      options.datasetPageSize ?? 500,
      options.maxDatasetItems ?? 10_000,
    );

    let finalized = terminal;
    let usageFinalized = false;
    const settlementMs = options.usageSettlementMs ?? 10_000;
    if (settlementMs > 0) await this.sleep(settlementMs);
    try {
      finalized = await this.getRun(runId);
      usageFinalized = true;
    } catch {
      // The terminal run and raw dataset remain valid evidence. The caller can
      // distinguish an unsettled usage gap from a zero-dollar run.
    }

    const resolvedBuildNumber = finalized.buildNumber ?? terminal.buildNumber;
    return {
      actor_id: options.actorId,
      actor_build_id: finalized.buildId ?? terminal.buildId,
      actor_build_number: resolvedBuildNumber,
      actor_input_sha256: sha256(canonicalJson(options.input)),
      actor_input_mode: options.inputMode,
      run_id: runId,
      dataset_id: terminal.defaultDatasetId,
      status: 'SUCCEEDED',
      items: dataset.items,
      item_offsets: dataset.offsets,
      dataset_items_returned: dataset.items.length,
      dataset_items_total_reported: dataset.totalReported,
      dataset_truncated: dataset.truncated,
      dataset_truncation_unknown: dataset.truncationUnknown,
      actual_cost_usd: finalized.usageTotalUsd ?? terminal.usageTotalUsd,
      usage_finalized: usageFinalized,
      pricing_info: finalized.pricingInfo ?? terminal.pricingInfo,
      charged_event_counts: finalized.chargedEventCounts ?? terminal.chargedEventCounts,
      external_calls_made: this.calls,
      requested_build: options.build?.trim() || null,
      build_drift_detected: Boolean(options.build?.trim() && resolvedBuildNumber && resolvedBuildNumber !== options.build.trim()),
      dataset_completion_state: dataset.truncated ? 'truncated' : dataset.truncationUnknown ? 'unknown' : 'complete',
      usage_settlement_state: usageFinalized && finalized.usageTotalUsd !== null ? 'settled' : 'unknown',
      duplicate_adjusted_unique_items: uniqueItemCount(dataset.items),
    };
  }

  async getRun(runId: string): Promise<ApifyRunData> {
    const response = await this.fetchRetryable(
      `${APIFY_API_BASE}/actor-runs/${encodeURIComponent(runId)}`,
      { headers: this.headers(false) },
      'Apify Actor poll',
    );
    const body = await parseJson<ApifyEnvelope>(response, 'Apify Actor poll');
    const data = body.data ?? {};
    const id = text(data.id) ?? runId;
    const status = text(data.status) as ApifyRunStatus | null;
    if (!status || !isRunStatus(status)) throw new Error('apify_run_response_missing_status');
    return {
      id,
      status,
      defaultDatasetId: text(data.defaultDatasetId),
      buildId: text(data.buildId),
      buildNumber: text(data.buildNumber),
      usageTotalUsd: finiteNumber(data.usageTotalUsd),
      pricingInfo: data.pricingInfo ?? null,
      chargedEventCounts: numericRecord(data.chargedEventCounts),
    };
  }

  async getAllDatasetItems(
    datasetId: string,
    pageSize = 500,
    maxItems = 10_000,
  ): Promise<{
    items: unknown[];
    offsets: number[];
    totalReported: number | null;
    truncated: boolean;
    truncationUnknown: boolean;
  }> {
    const limit = Math.min(1_000, positiveInteger(pageSize, 'datasetPageSize'));
    const ceiling = positiveInteger(maxItems, 'maxDatasetItems');
    const items: unknown[] = [];
    const offsets: number[] = [];
    let offset = 0;
    let totalReported: number | null = null;
    while (items.length < ceiling) {
      const pageLimit = Math.min(limit, ceiling - items.length);
      const query = new URLSearchParams({ format: 'json', offset: String(offset), limit: String(pageLimit) });
      const response = await this.fetchRetryable(
        `${APIFY_API_BASE}/datasets/${encodeURIComponent(datasetId)}/items?${query}`,
        { headers: this.headers(false) },
        'Apify dataset page',
      );
      const totalHeader = nonNegativeHeader(response.headers.get('x-apify-pagination-total'));
      if (totalHeader !== null) totalReported = totalHeader;
      const page = await parseJson<unknown[]>(response, 'Apify dataset page');
      if (!Array.isArray(page)) throw new Error('apify_dataset_response_must_be_array');
      page.forEach((item, index) => {
        items.push(item);
        offsets.push(offset + index);
      });
      offset += page.length;
      if (!page.length || page.length < pageLimit || (totalHeader !== null && offset >= totalHeader)) break;
    }
    const reachedCeiling = items.length >= ceiling;
    return {
      items,
      offsets,
      totalReported,
      truncated: totalReported !== null && totalReported > items.length,
      truncationUnknown: reachedCeiling && totalReported === null,
    };
  }

  private headers(json: boolean): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private async fetchOnce(input: string, init: RequestInit): Promise<Response> {
    this.calls += 1;
    try {
      return await this.fetchImpl(input, init);
    } catch {
      throw new Error('apify_network_error_after_non_idempotent_request');
    }
  }

  private async fetchRetryable(input: string, init: RequestInit, label: string): Promise<Response> {
    let lastStatus: number | null = null;
    for (let attempt = 0; attempt <= this.maxRetryAttempts; attempt += 1) {
      let response: Response;
      this.calls += 1;
      try {
        response = await this.fetchImpl(input, init);
      } catch {
        if (attempt === this.maxRetryAttempts) throw new Error(`${label}:network_error`);
        await this.sleep(this.retryDelay(attempt, null));
        continue;
      }
      lastStatus = response.status;
      if (response.status !== 429 && response.status < 500) return response;
      if (attempt === this.maxRetryAttempts) return response;
      await this.sleep(this.retryDelay(attempt, response.headers.get('retry-after')));
    }
    throw new Error(`${label}:HTTP_${lastStatus ?? 'unknown'}`);
  }

  private retryDelay(attempt: number, retryAfter: string | null): number {
    const explicit = retryAfterMilliseconds(retryAfter);
    if (explicit !== null) return explicit;
    const base = this.retryBaseMs * (2 ** attempt);
    return Math.round(base + this.random() * base);
  }
}

/** Consolidates only runs with identical actor, requested build, and input. */
export function consolidateCompatibleApifyRuns(
  runs: ApifyActorExecution[],
  reservationUsd: number,
): ApifyCompatibleRunConsolidation {
  if (!runs.length) throw new Error('apify_compatible_consolidation_requires_runs');
  if (!Number.isFinite(reservationUsd) || reservationUsd < 0) throw new Error('apify_reservation_must_be_non_negative');
  const first = runs[0];
  if (runs.some((run) => run.actor_id !== first.actor_id || run.actor_input_sha256 !== first.actor_input_sha256 || (run.requested_build ?? null) !== (first.requested_build ?? null))) {
    throw new Error('apify_incompatible_runs_cannot_consolidate');
  }
  const items = runs.flatMap((run) => run.items);
  const actuals = runs.map((run) => run.actual_cost_usd);
  const unknownSpend = runs.some((run) => run.usage_settlement_state !== 'settled' || run.actual_cost_usd === null);
  const actual = unknownSpend ? null : actuals.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const completion = runs.some((run) => run.dataset_completion_state === 'unknown') ? 'unknown'
    : runs.some((run) => run.dataset_completion_state === 'truncated') ? 'truncated' : 'complete';
  return {
    actor_id: first.actor_id,
    requested_build: first.requested_build ?? null,
    resolved_builds: [...new Set(runs.map((run) => run.actor_build_number).filter((value): value is string => Boolean(value)))],
    run_ids: runs.map((run) => run.run_id),
    returned_items: items.length,
    unique_items: uniqueItemCount(items),
    duplicate_adjusted_yield: items.length ? uniqueItemCount(items) / items.length : 0,
    actual_cost_usd: actual,
    conservative_cost_usd: unknownSpend ? reservationUsd : Math.max(actual ?? 0, 0),
    unknown_spend: unknownSpend,
    dataset_completion_state: completion,
  };
}

/** Maps an Apify execution to the additive V1 contract without changing corpus records. */
export function createApifyAcquisitionRunV1(
  execution: ApifyActorExecution,
  options: ApifyAcquisitionRunOptions,
): AcquisitionRunV1 {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const unique = execution.duplicate_adjusted_unique_items ?? uniqueItemCount(execution.items);
  const stopState: AcquisitionRunV1['stop_state'] = execution.dataset_completion_state === 'complete' ? 'completed' : 'partial';
  const stopReason = execution.dataset_completion_state === 'truncated'
    ? 'dataset_truncated'
    : execution.dataset_completion_state === 'unknown' ? 'dataset_completeness_unknown' : null;
  const outputHashes = execution.items.map((item) => sha256(canonicalJson(item)));
  const settlementState = execution.usage_settlement_state === 'settled' ? 'settled' : 'unknown';
  const spend = createProviderSpendEventV1({
    program_id: options.programId,
    run_id: execution.run_id,
    route_id: options.routeId,
    provider: 'apify',
    actor_or_model: execution.actor_id,
    build_or_revision: execution.actor_build_number ?? execution.actor_build_id,
    input_hash: execution.actor_input_sha256,
    reserved_usd: options.reservationUsd,
    program_ceiling_usd: options.programCeilingUsd,
    prior_conservative_spend_usd: options.priorConservativeSpendUsd,
    actual_provider_cost_usd: execution.actual_cost_usd,
    settlement_state: settlementState,
    settled_at: settlementState === 'settled' ? now : null,
    stop_state: stopState,
    stop_reason: stopReason,
    output_hashes: outputHashes,
  });
  return {
    schema_version: 'acquisition_run_v1',
    program_id: options.programId,
    run_id: execution.run_id,
    route_id: options.routeId,
    provider: 'apify',
    actor_or_model: execution.actor_id,
    build_or_revision: execution.actor_build_number ?? execution.actor_build_id,
    input_hash: execution.actor_input_sha256,
    asset_hashes: [],
    started_at: now,
    completed_at: now,
    counts: {
      returned: execution.dataset_items_returned,
      relevant: options.counts?.relevant ?? 0,
      unique,
      recent: options.counts?.recent ?? 0,
      metric_complete: options.counts?.metric_complete ?? 0,
      media_ready: options.counts?.media_ready ?? 0,
      analyzed: options.counts?.analyzed ?? 0,
    },
    item_lineage: execution.items.map((item, index) => ({
      item_id: `${execution.run_id}:${execution.item_offsets[index] ?? index}`,
      custom_id: null,
      input_hash: execution.actor_input_sha256,
      output_hash: outputHashes[index] ?? null,
      quality_state: 'unknown',
      error_code: null,
      error_detail: null,
      parent_item_id: null,
    })),
    spend,
    output_hashes: [...new Set(outputHashes)],
    stop_state: stopState,
    stop_reason: stopReason,
  };
}

export function canonicalActorId(actorId: string): string {
  const clean = actorId.trim();
  const slashCount = (clean.match(/\//g) ?? []).length;
  if (!clean || slashCount > 1) throw new Error('Apify Actor ID must be an ID or owner/name pair.');
  return slashCount === 1 ? clean.replace('/', '~') : clean;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRunStatus(value: string): value is ApifyRunStatus {
  return ['READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMING-OUT', 'TIMED-OUT', 'ABORTING', 'ABORTED'].includes(value);
}

async function parseJson<T>(response: Response, label: string): Promise<T> {
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    const code = text(nested.type) ?? text(nested.code) ?? text(record.code);
    const message = text(nested.message) ?? text(record.message) ?? `HTTP ${response.status}`;
    throw new Error(redact(`${label}:${code ? `${code}:` : ''}${message}`));
  }
  return parsed as T;
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeHeader(value: string | null): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numericRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]));
  return entries.length ? Object.fromEntries(entries) : null;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function uniqueItemCount(items: unknown[]): number {
  return new Set(items.map((item) => sha256(canonicalJson(item)))).size;
}

function redact(message: string): string {
  return message
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
