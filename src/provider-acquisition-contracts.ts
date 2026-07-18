import * as crypto from 'node:crypto';

/**
 * Versioned, provider-neutral accounting records.  These are intentionally
 * additive: normalized social-post and viral-library records remain unchanged.
 */
export type ProviderNameV1 = 'apify' | 'twelvelabs';
export type SettlementStateV1 = 'settled' | 'pending' | 'unknown' | 'failed';
export type StopStateV1 = 'running' | 'completed' | 'partial' | 'blocked' | 'stopped';

export interface ProviderItemLineageV1 {
  item_id: string;
  custom_id: string | null;
  input_hash: string;
  output_hash: string | null;
  quality_state: 'accepted' | 'excluded' | 'failed' | 'pending' | 'unknown';
  error_code: string | null;
  error_detail: string | null;
  parent_item_id: string | null;
}

export interface ProviderSpendEventV1 {
  schema_version: 'provider_spend_event_v1';
  program_id: string;
  run_id: string;
  route_id: string;
  provider: ProviderNameV1;
  actor_or_model: string;
  build_or_revision: string | null;
  input_hash: string;
  asset_hashes: string[];
  reserved_usd: number;
  program_ceiling_usd: number;
  prior_conservative_spend_usd: number;
  actual_provider_cost_usd: number | null;
  usage_pricing_estimate_usd: number | null;
  conservative_spend_usd: number;
  settlement_state: SettlementStateV1;
  retries: number;
  occurred_at: string;
  settled_at: string | null;
  stop_state: StopStateV1;
  stop_reason: string | null;
  output_hashes: string[];
}

export interface AcquisitionRunV1 {
  schema_version: 'acquisition_run_v1';
  program_id: string;
  run_id: string;
  route_id: string;
  provider: ProviderNameV1;
  actor_or_model: string;
  build_or_revision: string | null;
  input_hash: string;
  asset_hashes: string[];
  started_at: string;
  completed_at: string | null;
  counts: {
    returned: number;
    relevant: number;
    unique: number;
    recent: number;
    metric_complete: number;
    media_ready: number;
    analyzed: number;
  };
  item_lineage: ProviderItemLineageV1[];
  spend: ProviderSpendEventV1;
  output_hashes: string[];
  stop_state: StopStateV1;
  stop_reason: string | null;
}

export interface TwelveLabsBatchAnalysisV1 extends Omit<AcquisitionRunV1, 'schema_version' | 'provider' | 'actor_or_model'> {
  schema_version: 'twelvelabs_batch_analysis_v1';
  provider: 'twelvelabs';
  actor_or_model: 'pegasus1.5';
  batch_id: string | null;
  parent_batch_id: string | null;
  expires_at: string | null;
  batch_status: 'pending' | 'processing' | 'completed' | 'canceled' | 'expired' | 'unknown';
  result_retention_until: string | null;
  pricing_assumption: 'no_batch_discount_assumed';
}

export interface SpendInputV1 {
  program_id: string;
  run_id: string;
  route_id: string;
  provider: ProviderNameV1;
  actor_or_model: string;
  build_or_revision?: string | null;
  input_hash: string;
  asset_hashes?: string[];
  reserved_usd: number;
  program_ceiling_usd: number;
  prior_conservative_spend_usd: number;
  actual_provider_cost_usd?: number | null;
  usage_pricing_estimate_usd?: number | null;
  settlement_state: SettlementStateV1;
  retries?: number;
  occurred_at?: string;
  settled_at?: string | null;
  stop_state: StopStateV1;
  stop_reason?: string | null;
  output_hashes?: string[];
}

/** Unknown, pending, and failed billing never releases a reservation. */
export function createProviderSpendEventV1(input: SpendInputV1): ProviderSpendEventV1 {
  money(input.reserved_usd, 'reserved_usd');
  money(input.program_ceiling_usd, 'program_ceiling_usd');
  money(input.prior_conservative_spend_usd, 'prior_conservative_spend_usd');
  if (input.actual_provider_cost_usd !== undefined && input.actual_provider_cost_usd !== null) {
    money(input.actual_provider_cost_usd, 'actual_provider_cost_usd');
  }
  if (input.usage_pricing_estimate_usd !== undefined && input.usage_pricing_estimate_usd !== null) {
    money(input.usage_pricing_estimate_usd, 'usage_pricing_estimate_usd');
  }
  const settledActual = input.settlement_state === 'settled' ? input.actual_provider_cost_usd ?? null : null;
  const conservative = settledActual === null ? input.reserved_usd : Math.max(settledActual, input.usage_pricing_estimate_usd ?? 0);
  if (round(input.prior_conservative_spend_usd + conservative) > input.program_ceiling_usd + 1e-9) {
    throw new Error('cumulative_program_ceiling_exhausted');
  }
  return {
    schema_version: 'provider_spend_event_v1',
    program_id: required(input.program_id, 'program_id'),
    run_id: required(input.run_id, 'run_id'),
    route_id: required(input.route_id, 'route_id'),
    provider: input.provider,
    actor_or_model: required(input.actor_or_model, 'actor_or_model'),
    build_or_revision: input.build_or_revision ?? null,
    input_hash: hashLike(input.input_hash, 'input_hash'),
    asset_hashes: uniqueHashes(input.asset_hashes ?? []),
    reserved_usd: round(input.reserved_usd),
    program_ceiling_usd: round(input.program_ceiling_usd),
    prior_conservative_spend_usd: round(input.prior_conservative_spend_usd),
    actual_provider_cost_usd: input.actual_provider_cost_usd ?? null,
    usage_pricing_estimate_usd: input.usage_pricing_estimate_usd ?? null,
    conservative_spend_usd: round(conservative),
    settlement_state: input.settlement_state,
    retries: nonNegativeInteger(input.retries ?? 0, 'retries'),
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    settled_at: input.settled_at ?? null,
    stop_state: input.stop_state,
    stop_reason: input.stop_reason ?? null,
    output_hashes: uniqueHashes(input.output_hashes ?? []),
  };
}

export function cumulativeConservativeSpendV1(events: ProviderSpendEventV1[], programId: string): number {
  const matching = events.filter((event) => event.program_id === programId);
  if (matching.some((event) => !Number.isFinite(event.conservative_spend_usd))) {
    throw new Error('unknown_conservative_spend');
  }
  return round(matching.reduce((sum, event) => sum + event.conservative_spend_usd, 0));
}

export function deterministicHashV1(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJsonV1(value)).digest('hex');
}

export function canonicalJsonV1(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV1).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonV1(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label}_required`);
  return value.trim();
}

function hashLike(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label}_must_be_sha256`);
  return value.toLowerCase();
}

function uniqueHashes(values: string[]): string[] {
  return [...new Set(values.map((value) => hashLike(value, 'hash')))];
}

function money(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}_must_be_non_negative_finite`);
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label}_must_be_non_negative_integer`);
  return value;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
