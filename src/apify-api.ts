import * as crypto from 'node:crypto';

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

    return {
      actor_id: options.actorId,
      actor_build_id: finalized.buildId ?? terminal.buildId,
      actor_build_number: finalized.buildNumber ?? terminal.buildNumber,
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

function redact(message: string): string {
  return message
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
