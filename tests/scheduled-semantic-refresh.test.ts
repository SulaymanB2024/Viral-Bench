import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBaselineDiscoveryReport,
  evaluateRefreshPublicationGate,
  redactPublicPipelineText,
  validateScheduledRefreshRequest,
} from '../src/scheduled-semantic-refresh';
import type {
  ProviderIngestionReconciliation,
  SemanticIngestionReport,
} from '../src/semantic-pipeline';
import type { UrlIntakeRequest } from '../src/semantic-intelligence';

const request: UrlIntakeRequest = {
  request_id: 'scheduled-test',
  urls: Array.from({ length: 10 }, (_, index) => (
    `https://www.tiktok.com/@creator/video/${1000000000 + index}`
  )),
  allowed_platforms: ['tiktok'],
  comment_policy: {
    enabled: false,
    max_high_engagement: 0,
    max_recent: 0,
    max_replies_per_thread: 0,
  },
  approval_state: 'approved',
  cost_limits: {
    max_total_usd: 5,
    max_apify_usd: 1,
    max_twelvelabs_usd: 4,
    max_gemini_usd: 0,
  },
};

function reconciliation(overrides: Partial<ProviderIngestionReconciliation> = {}): ProviderIngestionReconciliation {
  return {
    platform: 'tiktok',
    requested_urls: 10,
    provider_items_returned: 10,
    provider_items_total_reported: 10,
    dataset_truncated: false,
    dataset_truncation_unknown: false,
    accepted: 10,
    excluded: 0,
    quarantined: 0,
    unmatched_requested_urls: [],
    exclusions: [],
    quarantines: [],
    reconciliation_passed: true,
    ...overrides,
  };
}

function ingestionReport(
  overrides: Partial<SemanticIngestionReport> = {},
): SemanticIngestionReport {
  return {
    request_id: request.request_id,
    status: 'partial',
    posts_ingested: 10,
    text_only_posts: 0,
    semantic_items_written: 100,
    external_calls_made: 30,
    costs: [
      {
        provider: 'apify',
        operation: 'actor:tiktok',
        estimated_cost_usd: 0,
        actual_cost_usd: 0.05,
      },
      {
        provider: 'twelvelabs',
        operation: 'analysis',
        estimated_cost_usd: 0.95,
        actual_cost_usd: null,
      },
    ],
    total_cost_usd: 1,
    model_traces: [],
    evidence_ids: [],
    output_paths: [],
    blockers: [],
    errors: ['two analyses did not pass timestamp validation'],
    measurement_gaps: [],
    ingestion_reconciliation: [reconciliation()],
    redactions: ['credential values are never serialized'],
    ...overrides,
  };
}

test('scheduled refresh accepts only approved manifests inside the five-dollar ceiling', () => {
  assert.equal(validateScheduledRefreshRequest(request, 5).request_id, request.request_id);
  assert.throws(
    () => validateScheduledRefreshRequest({ ...request, approval_state: 'draft' }, 5),
    /approved URL intake manifest/,
  );
  assert.throws(
    () => validateScheduledRefreshRequest(request, 4.99),
    /exceeds the scheduled cap/,
  );
  assert.throws(
    () => validateScheduledRefreshRequest(request, 5.01),
    /no greater than 5 USD/,
  );
});

test('publication gate permits a labeled partial run at exactly eighty percent analysis coverage', () => {
  const gate = evaluateRefreshPublicationGate(request, ingestionReport(), 8, 5);
  assert.equal(gate.publishable, true);
  assert.equal(gate.status, 'partial');
  assert.equal(gate.analysis_coverage, 0.8);
  assert.deepEqual(gate.failures, []);
});

test('publication gate blocks unmatched URLs, missing reconciliation, low coverage, and overspend', () => {
  const unmatched = evaluateRefreshPublicationGate(request, ingestionReport({
    ingestion_reconciliation: [reconciliation({
      accepted: 9,
      unmatched_requested_urls: [request.urls[9]],
    })],
  }), 8, 5);
  assert.equal(unmatched.publishable, false);
  assert.ok(unmatched.failures.includes('requested_urls_unmatched'));

  const missing = evaluateRefreshPublicationGate(
    request,
    ingestionReport({ ingestion_reconciliation: [] }),
    8,
    5,
  );
  assert.ok(missing.failures.includes('provider_reconciliation_missing'));

  const lowCoverage = evaluateRefreshPublicationGate(request, ingestionReport(), 7, 5);
  assert.ok(lowCoverage.failures.includes('twelvelabs_analysis_coverage_below_80_percent'));

  const overspend = evaluateRefreshPublicationGate(
    request,
    ingestionReport({ total_cost_usd: 5.000001 }),
    8,
    5,
  );
  assert.ok(overspend.failures.includes('scheduled_budget_exceeded'));
});

test('published library observations become deterministic stored-snapshot discovery rows', () => {
  const report = createBaselineDiscoveryReport({
    generated_at: '2026-07-17T00:00:00.000Z',
    items: [{
      platform: 'instagram',
      content_type: 'carousel_post',
      canonical_url: 'https://www.instagram.com/p/ABC123/',
      account_handle: 'creator',
      caption: 'Observed caption #internship',
      hashtags: ['internship'],
      posted_at: '2026-07-16T00:00:00.000Z',
      observations: [{
        captured_at: '2026-07-17T00:00:00.000Z',
        source_runs: ['run-one'],
        discovery_modes: ['explicit_url'],
        views: null,
        likes: 20,
        comments: 2,
        shares: 1,
        saves: 3,
      }],
    }],
  }, request.request_id, 3.25) as {
    totals: { actual_cost_usd_reported: number };
    runs: Array<{ id: string; input_mode: string; items: Array<Record<string, unknown>> }>;
  };

  assert.equal(report.totals.actual_cost_usd_reported, 3.25);
  assert.equal(report.runs[0].id, 'run-one');
  assert.equal(report.runs[0].input_mode, 'explicit_url');
  assert.deepEqual(report.runs[0].items[0], {
    url: 'https://www.instagram.com/p/ABC123/',
    text: 'Observed caption #internship',
    timestamp: '2026-07-16T00:00:00.000Z',
    scrapedAt: '2026-07-17T00:00:00.000Z',
    username: 'creator',
    hashtags: ['internship'],
    type: 'Sidecar',
    productType: 'carousel_container',
    viewCount: null,
    likesCount: 20,
    commentsCount: 2,
    shareCount: 1,
    saveCount: 3,
  });
});

test('public pipeline messages redact provider credentials and local paths', () => {
  const redacted = redactPublicPipelineText(
    "token=apify_api_secret Bearer tlk_secret at /Users/person/private/file.json and https://instagram.example.fbcdn.net/o1/video.mp4?signature=secret",
  );
  assert.doesNotMatch(redacted, /apify_api_secret|tlk_secret|\/Users\/person|signature=secret/);
  assert.match(redacted, /\[REDACTED\]/);
  assert.match(redacted, /\[local path\]/);
  assert.match(redacted, /\[provider media URL\]/);
});
