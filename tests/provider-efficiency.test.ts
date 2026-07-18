import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApifyApiClient, consolidateCompatibleApifyRuns, createApifyAcquisitionRunV1 } from '../src/apify-api';
import { createProviderSpendEventV1, cumulativeConservativeSpendV1, deterministicHashV1 } from '../src/provider-acquisition-contracts';
import { TwelveLabsBatchClient, estimatePegasusBatchItemUsd, failedOnlyRetryRequest } from '../src/twelvelabs-batch';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

test('Apify preserves a non-retryable chargeable start, final settlement, build provenance, and truncation telemetry', async () => {
  const calls: string[] = [];
  const responses = [
    new Response(JSON.stringify({ data: { id: 'run-1' } }), { status: 201 }),
    new Response(JSON.stringify({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'dataset-1', buildNumber: '1.0.0', usageTotalUsd: 0.1 } })),
    new Response(JSON.stringify([{ id: 'one' }]), { headers: { 'x-apify-pagination-total': '2' } }),
    new Response(JSON.stringify({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'dataset-1', buildNumber: '1.0.1', usageTotalUsd: 0.12 } })),
  ];
  const client = new ApifyApiClient({ token: 'test-token', maxRetryAttempts: 0, sleep: async () => undefined, fetchImpl: async (input) => {
    calls.push(String(input));
    const response = responses.shift();
    assert.ok(response);
    return response;
  } });
  const result = await client.executeActor({ actorId: 'owner/actor', input: { urls: ['https://example.test/a'] }, inputMode: 'explicit_url', maxTotalChargeUsd: 0.2, build: '1.0.0', maxItems: 1, maxDatasetItems: 1, maxPollAttempts: 1, usageSettlementMs: 0 });
  assert.equal(calls.filter((url) => url.includes('/runs?')).length, 1);
  assert.equal(result.actual_cost_usd, 0.12);
  assert.equal(result.usage_settlement_state, 'settled');
  assert.equal(result.build_drift_detected, true);
  assert.equal(result.dataset_completion_state, 'truncated');
  assert.equal(result.duplicate_adjusted_unique_items, 1);
  const contract = createApifyAcquisitionRunV1(result, { programId: 'program', routeId: 'route', reservationUsd: 0.2, programCeilingUsd: 1, priorConservativeSpendUsd: 0 });
  assert.equal(contract.schema_version, 'acquisition_run_v1');
  assert.equal(contract.spend.actual_provider_cost_usd, 0.12);
  assert.equal(contract.counts.unique, 1);
});

test('Apify retries 429/5xx only for safe reads and keeps unknown settlement conservatively reserved', async () => {
  const responses = [
    new Response(JSON.stringify({ data: { id: 'run-2' } }), { status: 201 }),
    new Response('{}', { status: 429, headers: { 'retry-after': '0' } }),
    new Response('{}', { status: 503 }),
    new Response(JSON.stringify({ data: { id: 'run-2', status: 'SUCCEEDED', defaultDatasetId: 'dataset-2' } })),
    new Response(JSON.stringify([{ id: 'same' }, { id: 'same' }]), { headers: { 'x-apify-pagination-total': '2' } }),
    new Response(JSON.stringify({ data: { id: 'run-2', status: 'SUCCEEDED', defaultDatasetId: 'dataset-2' } })),
  ];
  const client = new ApifyApiClient({ token: 'test-token', maxRetryAttempts: 2, sleep: async () => undefined, random: () => 0, fetchImpl: async () => {
    const response = responses.shift(); assert.ok(response); return response;
  } });
  const run = await client.executeActor({ actorId: 'owner/actor', input: { urls: ['a'] }, inputMode: 'explicit_url', maxTotalChargeUsd: 0.2, maxItems: 2, maxDatasetItems: 2, maxPollAttempts: 1, usageSettlementMs: 0 });
  assert.equal(run.usage_settlement_state, 'unknown');
  assert.equal(run.duplicate_adjusted_unique_items, 1);
  const consolidated = consolidateCompatibleApifyRuns([run], 0.2);
  assert.equal(consolidated.unknown_spend, true);
  assert.equal(consolidated.conservative_cost_usd, 0.2);
  assert.equal(consolidated.duplicate_adjusted_yield, 0.5);
});

test('Apify start failures never retry and incompatible runs cannot be consolidated', async () => {
  let calls = 0;
  const client = new ApifyApiClient({ token: 'test-token', maxRetryAttempts: 5, fetchImpl: async () => { calls += 1; throw new Error('network'); } });
  await assert.rejects(() => client.executeActor({ actorId: 'owner/actor', input: {}, inputMode: 'explicit_url', maxTotalChargeUsd: 0.1 }), /non_idempotent/);
  assert.equal(calls, 1);
  assert.throws(() => consolidateCompatibleApifyRuns([
    { actor_id: 'a', actor_build_id: null, actor_build_number: null, actor_input_sha256: HASH_A, actor_input_mode: 'explicit_url', run_id: '1', dataset_id: 'd', status: 'SUCCEEDED', items: [], item_offsets: [], dataset_items_returned: 0, dataset_items_total_reported: 0, dataset_truncated: false, dataset_truncation_unknown: false, actual_cost_usd: 0, usage_finalized: true, pricing_info: null, charged_event_counts: null, external_calls_made: 0 },
    { actor_id: 'b', actor_build_id: null, actor_build_number: null, actor_input_sha256: HASH_A, actor_input_mode: 'explicit_url', run_id: '2', dataset_id: 'd', status: 'SUCCEEDED', items: [], item_offsets: [], dataset_items_returned: 0, dataset_items_total_reported: 0, dataset_truncated: false, dataset_truncation_unknown: false, actual_cost_usd: 0, usage_finalized: true, pricing_info: null, charged_event_counts: null, external_calls_made: 0 },
  ], 0.2), /incompatible/);
});

test('provider spend holds unknown usage and enforces a cumulative program ceiling across retries', () => {
  const first = createProviderSpendEventV1({ program_id: 'program', run_id: 'one', route_id: 'route', provider: 'apify', actor_or_model: 'actor', input_hash: HASH_A, reserved_usd: 0.6, program_ceiling_usd: 1, prior_conservative_spend_usd: 0, settlement_state: 'unknown', stop_state: 'partial' });
  assert.equal(first.conservative_spend_usd, 0.6);
  assert.equal(cumulativeConservativeSpendV1([first], 'program'), 0.6);
  assert.throws(() => createProviderSpendEventV1({ program_id: 'program', run_id: 'retry', route_id: 'route', provider: 'apify', actor_or_model: 'actor', input_hash: HASH_B, reserved_usd: 0.5, program_ceiling_usd: 1, prior_conservative_spend_usd: first.conservative_spend_usd, settlement_state: 'failed', stop_state: 'stopped' }), /ceiling/);
});

function batchRequest() {
  return {
    program_id: 'program', run_id: 'batch-1', route_id: 'approved-route', program_ceiling_usd: 1, prior_conservative_spend_usd: 0, conservative_reservation_usd: 0.2,
    now: () => new Date('2026-07-18T00:00:00.000Z'),
    items: [
      { item_id: 'video-1', asset_id: 'asset-reused-1', asset_sha256: HASH_A, asset_status: 'ready' as const, duration_sec: 60, start_sec: 10, end_sec: 30, max_tokens: 512 },
      { item_id: 'video-2', asset_id: 'asset-reused-2', asset_sha256: HASH_B, asset_status: 'ready' as const, duration_sec: 45, max_tokens: 512 },
      { item_id: 'video-3', asset_id: 'asset-reused-3', asset_sha256: HASH_C, asset_status: 'ready' as const, duration_sec: 30, max_tokens: 512 },
    ],
  };
}

test('TwelveLabs batch creates, polls, retrieves structured item results, clips windows, and supports failed-only retry', async () => {
  const bodies: unknown[] = [];
  let statusCalls = 0;
  const client = new TwelveLabsBatchClient({ apiKey: 'test-key', pollIntervalMs: 0, sleep: async () => undefined, fetchImpl: async (input, init) => {
    const url = String(input);
    if (url.endsWith('/analyze/batches')) {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ batch_id: 'batch-1' }), { status: 201 });
    }
    if (url.endsWith('/results')) {
      const requestBody = bodies[0] as { requests: Array<{ custom_id: string }> };
      return new Response(JSON.stringify({ data: [
        { task_id: 't1', custom_id: requestBody.requests[0]?.custom_id, status: 'ready', data: { generation_id: 'g1', data: { hook: 'observed' }, finish_reason: 'stop', usage: { output_tokens: 20 } } },
        { task_id: 't2', custom_id: requestBody.requests[1]?.custom_id, status: 'failed', error: { code: 'asset_unavailable', message: 'asset unavailable' } },
        { task_id: 't3', custom_id: requestBody.requests[2]?.custom_id, status: 'ready', data: { generation_id: 'g3', data: { hook: 'observed' }, finish_reason: 'stop', usage: { output_tokens: 21 } } },
      ] }));
    }
    statusCalls += 1;
    return new Response(JSON.stringify({ batch_id: 'batch-1', status: statusCalls === 1 ? 'processing' : 'completed', expires_at: '2026-07-19T00:00:00Z' }));
  } });
  const promise = client.analyzeBatch(batchRequest());
  const report = await promise;
  const requestBody = bodies[0] as { requests: Array<{ custom_id: string; video: { asset_id: string }; start_time: number; end_time: number; max_tokens: number }> };
  assert.ok(requestBody.requests.every((item) => item.video.asset_id.startsWith('asset-reused-')));
  assert.equal(requestBody.requests[0]?.start_time, 10);
  assert.equal(requestBody.requests[0]?.end_time, 30);
  assert.equal(requestBody.requests[0]?.max_tokens, 512);
  assert.equal(new Set(requestBody.requests.map((item) => item.custom_id)).size, 3);
  assert.equal(report.batch_status, 'completed');
  assert.equal(report.counts.analyzed, 2);
  assert.equal(report.stop_state, 'partial');
  assert.equal(report.pricing_assumption, 'no_batch_discount_assumed');
  assert.equal(report.spend.actual_provider_cost_usd, null);
  assert.equal(report.spend.conservative_spend_usd, 0.2);
  const retry = failedOnlyRetryRequest(report, batchRequest());
  assert.equal(retry.items.length, 1);
  assert.equal(retry.items[0]?.item_id, 'video-2');
  assert.equal(retry.parent_batch_id, 'batch-1');
});

test('TwelveLabs retries safe 429/503 batch reads, marks expiration partial, and rejects unready assets, token overages, and exhausted budgets before calls', async () => {
  const request = batchRequest();
  const calls: string[] = [];
  const responses = [
    new Response(JSON.stringify({ batch_id: 'expired-batch' }), { status: 201 }),
    new Response('{}', { status: 429, headers: { 'retry-after': '0' } }),
    new Response('{}', { status: 503 }),
    new Response(JSON.stringify({ batch_id: 'expired-batch', status: 'expired' })),
    new Response(JSON.stringify({ data: [] })),
  ];
  const client = new TwelveLabsBatchClient({ apiKey: 'test-key', pollIntervalMs: 0, sleep: async () => undefined, fetchImpl: async (input) => { calls.push(String(input)); const response = responses.shift(); assert.ok(response); return response; } });
  const expired = await client.analyzeBatch(request);
  assert.equal(expired.batch_status, 'expired');
  assert.equal(expired.stop_reason, 'batch_expired_unfinished_items_canceled');
  assert.equal(calls.filter((url) => url.endsWith('/expired-batch')).length, 3);
  const noCallClient = new TwelveLabsBatchClient({ apiKey: 'test-key', fetchImpl: async () => { throw new Error('should not call'); } });
  await assert.rejects(() => noCallClient.analyzeBatch({ ...request, items: [{ ...request.items[0]!, asset_status: 'processing' }] }), /asset_processing/);
  await assert.rejects(() => noCallClient.analyzeBatch({ ...request, items: [{ ...request.items[0]!, asset_status: 'failed' }] }), /asset_failed/);
  await assert.rejects(() => noCallClient.analyzeBatch({ ...request, items: [{ ...request.items[0]!, max_tokens: 98_305 }] }), /max_tokens/);
  await assert.rejects(() => noCallClient.analyzeBatch({ ...request, prior_conservative_spend_usd: 0.9, conservative_reservation_usd: 0.2 }), /ceiling/);
  assert.ok(estimatePegasusBatchItemUsd(20, 512) > 0);
  assert.equal(deterministicHashV1({ stable: true }).length, 64);
});
