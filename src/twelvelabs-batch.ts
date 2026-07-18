import {
  createProviderSpendEventV1,
  deterministicHashV1,
  type ProviderItemLineageV1,
  type TwelveLabsBatchAnalysisV1,
} from './provider-acquisition-contracts';

export const TWELVELABS_BATCH_MAX_ITEMS = 1_000;
export const TWELVELABS_BATCH_MAX_CONTENT_HOURS = 2_000;
export const TWELVELABS_BATCH_EXPIRY_HOURS = 24;
export const PEGASUS_GENERAL_MAX_TOKENS = 98_304;

export interface TwelveLabsBatchItemInput {
  item_id: string;
  asset_id: string;
  asset_sha256: string;
  asset_status: 'ready' | 'processing' | 'failed';
  duration_sec: number;
  start_sec?: number;
  end_sec?: number;
  prompt?: string;
  max_tokens?: number;
  parent_item_id?: string | null;
}

export interface TwelveLabsBatchRequest {
  program_id: string;
  run_id: string;
  route_id: string;
  program_ceiling_usd: number;
  prior_conservative_spend_usd: number;
  conservative_reservation_usd: number;
  items: TwelveLabsBatchItemInput[];
  now?: () => Date;
  parent_batch_id?: string | null;
  response_schema?: Record<string, unknown>;
}

interface BatchStatusResponse {
  batch_id?: string;
  status?: string;
  created_at?: string;
  expires_at?: string;
  total_items?: number;
}

interface BatchResult {
  task_id?: string;
  custom_id?: string;
  status?: string;
  data?: { generation_id?: string; data?: unknown; finish_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  error?: { code?: string; message?: string };
}

/**
 * Uses only already-ready TwelveLabs asset IDs.  It deliberately does not call
 * Marengo; embedding/indexing is separately priced and must happen after
 * metadata filtering.
 */
export class TwelveLabsBatchClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private calls = 0;

  constructor(options: { apiKey: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; pollIntervalMs?: number; maxPollAttempts?: number }) {
    if (!options.apiKey.trim()) throw new Error('TWELVELABS_API_KEY is required.');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maxPollAttempts = options.maxPollAttempts ?? 300;
  }

  get externalCallsMade(): number { return this.calls; }

  async analyzeBatch(request: TwelveLabsBatchRequest): Promise<TwelveLabsBatchAnalysisV1> {
    const prepared = prepareBatch(request);
    const createdAt = (request.now ?? (() => new Date()))().toISOString();
    // Creation may result in chargeable tasks, so this POST is intentionally not retried.
    const create = await this.requestOnce('/analyze/batches', {
      method: 'POST', headers: this.headers(true), body: JSON.stringify(prepared.body),
    }, 'TwelveLabs batch create');
    const batchId = stringAt(create, 'batch_id');
    if (!batchId) throw new Error('twelvelabs_batch_create_missing_batch_id');
    let status: BatchStatusResponse = { batch_id: batchId, status: 'pending' };
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      status = await this.requestRetryable<BatchStatusResponse>(`/analyze/batches/${encodeURIComponent(batchId)}`, { method: 'GET', headers: this.headers(false) }, 'TwelveLabs batch status');
      const state = normalizedStatus(status.status);
      if (state === 'completed' || state === 'canceled' || state === 'expired') break;
      if (attempt === this.maxPollAttempts - 1) throw new Error('twelvelabs_batch_poll_timeout');
      await this.sleep(this.pollIntervalMs);
    }
    const resultsBody = await this.requestRetryable<unknown>(`/analyze/batches/${encodeURIComponent(batchId)}/results`, { method: 'GET', headers: this.headers(false) }, 'TwelveLabs batch results');
    const results = resultItems(resultsBody);
    return toContract(request, prepared, batchId, status, results, createdAt);
  }

  private headers(json: boolean): Record<string, string> {
    return { 'x-api-key': this.apiKey, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) };
  }

  private async requestOnce(endpoint: string, init: RequestInit, label: string): Promise<Record<string, unknown>> {
    this.calls += 1;
    try { return await parse(await this.fetchImpl(`https://api.twelvelabs.io/v1.3${endpoint}`, init), label); }
    catch (error) { if (error instanceof Error) throw error; throw new Error(`${label}:network_error_after_non_idempotent_request`); }
  }

  private async requestRetryable<T>(endpoint: string, init: RequestInit, label: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      this.calls += 1;
      try {
        const response = await this.fetchImpl(`https://api.twelvelabs.io/v1.3${endpoint}`, init);
        if ((response.status === 429 || response.status === 503 || response.status >= 500) && attempt < 3) {
          await this.sleep(retryDelay(response.headers.get('retry-after'), attempt));
          continue;
        }
        return await parse(response, label) as T;
      } catch (error) {
        if (error instanceof Error && !error.message.endsWith(':network_error')) throw error;
        if (attempt === 3) throw new Error(`${label}:network_error`);
        await this.sleep(retryDelay(null, attempt));
      }
    }
    throw new Error(`${label}:retry_exhausted`);
  }
}

/** Produces a new request that contains only failed/canceled/expired items. */
export function failedOnlyRetryRequest(previous: TwelveLabsBatchAnalysisV1, original: TwelveLabsBatchRequest): TwelveLabsBatchRequest {
  const byItem = new Map(original.items.map((item) => [item.item_id, item]));
  const failures = previous.item_lineage.filter((item) => item.quality_state === 'failed');
  if (!failures.length) throw new Error('twelvelabs_batch_no_failed_items_to_retry');
  return {
    ...original,
    run_id: `${original.run_id}:retry:${previous.batch_id ?? 'unknown'}`,
    parent_batch_id: previous.batch_id,
    items: failures.map((failure) => {
      const originalItem = byItem.get(failure.item_id);
      if (!originalItem) throw new Error(`twelvelabs_batch_missing_original_item:${failure.item_id}`);
      return { ...originalItem, parent_item_id: failure.item_id };
    }),
  };
}

export function estimatePegasusBatchItemUsd(durationSec: number, maxTokens: number): number {
  if (!Number.isFinite(durationSec) || durationSec < 0 || !Number.isInteger(maxTokens) || maxTokens < 512 || maxTokens > PEGASUS_GENERAL_MAX_TOKENS) {
    throw new Error('invalid_pegasus_batch_cost_input');
  }
  return round((durationSec / 60) * 0.0292 + (maxTokens / 1_000) * 0.0075);
}

function prepareBatch(request: TwelveLabsBatchRequest): { body: Record<string, unknown>; items: Array<TwelveLabsBatchItemInput & { custom_id: string; clipped_duration_sec: number; max_tokens: number }> } {
  if (!request.items.length || request.items.length > TWELVELABS_BATCH_MAX_ITEMS) throw new Error('twelvelabs_batch_item_limit');
  const seen = new Set<string>();
  const items = request.items.map((item) => {
    if (!item.item_id.trim() || !item.asset_id.trim()) throw new Error('twelvelabs_batch_item_identity_required');
    if (!/^[a-f0-9]{64}$/i.test(item.asset_sha256)) throw new Error('twelvelabs_batch_asset_sha256_required');
    if (item.asset_status !== 'ready') throw new Error(`twelvelabs_asset_${item.asset_status}:${item.item_id}`);
    if (seen.has(item.item_id)) throw new Error(`twelvelabs_batch_duplicate_item:${item.item_id}`);
    seen.add(item.item_id);
    const start = item.start_sec ?? 0;
    const end = item.end_sec ?? item.duration_sec;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > item.duration_sec) throw new Error(`twelvelabs_batch_invalid_window:${item.item_id}`);
    const maxTokens = item.max_tokens ?? 2_048;
    if (!Number.isInteger(maxTokens) || maxTokens < 512 || maxTokens > PEGASUS_GENERAL_MAX_TOKENS) throw new Error(`twelvelabs_batch_max_tokens:${item.item_id}`);
    const customId = `vb-${deterministicHashV1({ program: request.program_id, route: request.route_id, item: item.item_id, asset: item.asset_sha256, start, end }).slice(0, 48)}`;
    return { ...item, custom_id: customId, clipped_duration_sec: end - start, max_tokens: maxTokens, start_sec: start, end_sec: end };
  });
  if (items.reduce((total, item) => total + item.clipped_duration_sec, 0) / 3600 > TWELVELABS_BATCH_MAX_CONTENT_HOURS) throw new Error('twelvelabs_batch_content_hour_limit');
  const estimate = round(items.reduce((total, item) => total + estimatePegasusBatchItemUsd(item.clipped_duration_sec, item.max_tokens), 0));
  if (request.conservative_reservation_usd + 1e-9 < estimate) throw new Error('twelvelabs_batch_reservation_below_usage_estimate');
  if (round(request.prior_conservative_spend_usd + request.conservative_reservation_usd) > request.program_ceiling_usd + 1e-9) throw new Error('cumulative_program_ceiling_exhausted');
  return {
    items,
    body: {
      model_name: 'pegasus1.5', analysis_mode: 'general',
      defaults: { temperature: 0.1, max_tokens: Math.max(...items.map((item) => item.max_tokens)), ...(request.response_schema ? { response_format: { type: 'json_schema', json_schema: request.response_schema } } : {}) },
      requests: items.map((item) => ({ video: { type: 'asset_id', asset_id: item.asset_id }, custom_id: item.custom_id, start_time: item.start_sec, end_time: item.end_sec, max_tokens: item.max_tokens, ...(item.prompt?.trim() ? { prompt: item.prompt.trim() } : {}) })),
    },
  };
}

function toContract(request: TwelveLabsBatchRequest, prepared: ReturnType<typeof prepareBatch>, batchId: string, status: BatchStatusResponse, results: BatchResult[], startedAt: string): TwelveLabsBatchAnalysisV1 {
  const resultByCustom = new Map(results.map((result) => [result.custom_id, result]));
  const lineage: ProviderItemLineageV1[] = prepared.items.map((item) => {
    const result = resultByCustom.get(item.custom_id);
    const ready = result?.status === 'ready' && result.data?.finish_reason !== 'length';
    const state: ProviderItemLineageV1['quality_state'] = ready ? 'accepted' : result?.status === 'processing' || result?.status === 'queued' ? 'pending' : 'failed';
    const output = ready ? result?.data?.data ?? null : null;
    return { item_id: item.item_id, custom_id: item.custom_id, input_hash: deterministicHashV1(item), output_hash: output === null ? null : deterministicHashV1(output), quality_state: state, error_code: result?.error?.code ?? (result?.data?.finish_reason === 'length' ? 'response_truncated' : state === 'failed' ? 'batch_item_not_ready' : null), error_detail: result?.error?.message ?? null, parent_item_id: item.parent_item_id ?? null };
  });
  const completed = lineage.filter((item) => item.quality_state === 'accepted');
  const batchStatus = normalizedStatus(status.status);
  const stopped = batchStatus === 'expired' || batchStatus === 'canceled' || lineage.some((item) => item.quality_state === 'failed');
  const inputHash = deterministicHashV1(prepared.body);
  const outputHashes = completed.flatMap((item) => item.output_hash ? [item.output_hash] : []);
  const usageEstimate = round(prepared.items.reduce((sum, item) => sum + estimatePegasusBatchItemUsd(item.clipped_duration_sec, item.max_tokens), 0));
  const spend = createProviderSpendEventV1({ program_id: request.program_id, run_id: request.run_id, route_id: request.route_id, provider: 'twelvelabs', actor_or_model: 'pegasus1.5', input_hash: inputHash, asset_hashes: prepared.items.map((item) => item.asset_sha256), reserved_usd: request.conservative_reservation_usd, program_ceiling_usd: request.program_ceiling_usd, prior_conservative_spend_usd: request.prior_conservative_spend_usd, usage_pricing_estimate_usd: usageEstimate, settlement_state: 'unknown', stop_state: stopped ? 'partial' : 'completed', stop_reason: batchStatus === 'expired' ? 'batch_expired_unfinished_items_canceled' : stopped ? 'one_or_more_items_failed_or_incomplete' : null, output_hashes: outputHashes });
  const expiresAt = stringAt(status as Record<string, unknown>, 'expires_at') ?? new Date(new Date(startedAt).getTime() + TWELVELABS_BATCH_EXPIRY_HOURS * 3_600_000).toISOString();
  return { schema_version: 'twelvelabs_batch_analysis_v1', program_id: request.program_id, run_id: request.run_id, route_id: request.route_id, provider: 'twelvelabs', actor_or_model: 'pegasus1.5', build_or_revision: null, input_hash: inputHash, asset_hashes: prepared.items.map((item) => item.asset_sha256), started_at: startedAt, completed_at: new Date().toISOString(), counts: { returned: results.length, relevant: completed.length, unique: new Set(completed.map((item) => item.item_id)).size, recent: completed.length, metric_complete: completed.length, media_ready: prepared.items.length, analyzed: completed.length }, item_lineage: lineage, spend, output_hashes: outputHashes, stop_state: stopped ? 'partial' : 'completed', stop_reason: spend.stop_reason, batch_id: batchId, parent_batch_id: request.parent_batch_id ?? null, expires_at: expiresAt, batch_status: batchStatus, result_retention_until: new Date(new Date(startedAt).getTime() + 30 * 24 * 3_600_000).toISOString(), pricing_assumption: 'no_batch_discount_assumed' };
}

function resultItems(body: unknown): BatchResult[] { return Array.isArray(body) ? body as BatchResult[] : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).data) ? (body as { data: BatchResult[] }).data : []; }
function normalizedStatus(value: string | undefined): TwelveLabsBatchAnalysisV1['batch_status'] { return value === 'pending' || value === 'processing' || value === 'completed' || value === 'canceled' || value === 'expired' ? value : 'unknown'; }
function stringAt(value: Record<string, unknown>, key: string): string | null { const item = value[key]; return typeof item === 'string' && item.trim() ? item.trim() : null; }
async function parse(response: Response, label: string): Promise<Record<string, unknown>> { let body: unknown; try { body = await response.json(); } catch { throw new Error(`${label}:invalid_json`); } if (!response.ok) { const error = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null; const message = error && typeof error === 'object' ? (error as Record<string, unknown>).message : null; throw new Error(`${label}:http_${response.status}${typeof message === 'string' ? `:${message.slice(0, 160)}` : ''}`); } return body && typeof body === 'object' ? body as Record<string, unknown> : {}; }
function retryDelay(header: string | null, attempt: number): number { const seconds = Number(header); return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : 500 * (2 ** attempt); }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
