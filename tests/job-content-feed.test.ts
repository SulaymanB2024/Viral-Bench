import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildJobContentDiscoverySpecs,
  buildJobContentFeedPreflight,
  normalizeJobSearchContentItem,
  reanalyzeJobContentFeedReport,
  summarizeCrossSourcePatterns,
  summarizeJobContentSource,
  validateJobContentFeedRequest,
  type JobContentDiscoverySpec,
} from '../src/job-content-feed';
import type { ApifyActorExecution } from '../src/apify-api';

const REQUEST = {
  feed_id: 'job-search-content-thin',
  sources: ['runway', 'handshake', 'internships_com'],
  cohorts: ['recent', 'popular'],
  max_results_per_profile: 8,
  max_results_per_query: 6,
  approval: {
    state: 'approved',
    approved_by: 'test',
    approved_at: '2026-07-16T18:00:00.000Z',
  },
  cost_policy: {
    max_apify_usd: 6,
  },
};

const ENV = {
  ALLOW_PUBLIC_SEO_RESEARCH: 'true',
  ALLOW_PAID_GENERATION: 'true',
  APIFY_TOKEN: 'test-token',
  APIFY_ACTOR_TIKTOK: 'clockworks/tiktok-scraper',
};

test('job-search content request validates and stays gated', () => {
  const request = validateJobContentFeedRequest(REQUEST);
  assert.deepEqual(request.sources, ['runway', 'handshake', 'internships_com']);
  assert.equal(buildJobContentFeedPreflight(request, {}).live_ready, false);
  const ready = buildJobContentFeedPreflight(request, ENV);
  assert.equal(ready.live_ready, true);
  assert.equal(ready.planned_run_count, 6);
  assert.equal(ready.estimated_max_items, 68);
});

test('discovery plan uses exact profiles and a labeled category proxy', () => {
  const specs = buildJobContentDiscoverySpecs(REQUEST, ENV);
  assert.equal(specs.length, 6);
  assert.equal(specs.filter((spec) => spec.input_mode === 'profile').length, 4);
  assert.equal(specs.filter((spec) => spec.input_mode === 'search').length, 2);
  const runway = specs.find((spec) => spec.source_id === 'runway' && spec.cohort === 'recent');
  assert.deepEqual(runway?.input.profiles, ['fordcoleman_']);
  assert.equal(runway?.input.profileSorting, 'latest');
  const internships = specs.find((spec) => spec.source_id === 'internships_com' && spec.cohort === 'popular');
  assert.deepEqual(internships?.input.searchQueries, [
    'internship search tips',
    'internship application mistakes',
    'internship openings',
  ]);
});

test('normalization classifies job-search content signals', () => {
  const item = normalizeJobSearchContentItem({
    id: '123',
    text: '3 internship application mistakes to avoid before you apply. Save this.',
    createTimeISO: '2026-07-16T18:00:00.000Z',
    webVideoUrl: 'https://www.tiktok.com/@joinhandshake/video/123',
    authorMeta: {
      name: 'joinhandshake',
      nickName: 'Handshake',
      profileUrl: 'https://www.tiktok.com/@joinhandshake',
      verified: true,
    },
    playCount: 1200,
    diggCount: 100,
    commentCount: 5,
    shareCount: 12,
    collectCount: 30,
    hashtags: [{ name: 'internshiptips' }],
  }, 0, spec('handshake'), execution(), 1, '2026-07-16T19:00:00.000Z');
  assert.equal(item.signals.hook_type, 'numbered_list');
  assert.equal(item.signals.topic, 'resume_and_application');
  assert.equal(item.signals.format, 'list_explainer');
  assert.equal(item.signals.cta_type, 'save_or_share');
  assert.deepEqual(item.cohorts_observed, ['recent']);
  assert.equal(item.author.platform_verified, true);
  assert.deepEqual(item.hashtags, ['internshiptips']);
});

test('source and cross-source summaries preserve descriptive evidence boundaries', () => {
  const first = normalizeJobSearchContentItem({
    id: '1',
    text: 'Comment “jobs” for the remote internship list',
    webVideoUrl: 'https://www.tiktok.com/@joinhandshake/video/1',
    authorMeta: { name: 'joinhandshake', nickName: 'Handshake' },
    playCount: 2000,
  }, 0, spec('handshake'), execution(), 1, '2026-07-16T19:00:00.000Z');
  const second = normalizeJobSearchContentItem({
    id: '2',
    text: 'Nobody tells students this about applying early',
    webVideoUrl: 'https://www.tiktok.com/@fordcoleman_/video/2',
    authorMeta: { name: 'fordcoleman_', nickName: 'Ford Coleman' },
    playCount: 4000,
  }, 1, spec('runway'), execution(), 1, '2026-07-16T19:00:00.000Z');
  const summary = summarizeJobContentSource('handshake', [first]);
  assert.equal(summary.top_observed[0].views, 2000);
  const cross = summarizeCrossSourcePatterns([first, second]);
  assert.ok(cross.observations.some((observation) => /causal/i.test(observation)));
});

test('reanalyzes and deduplicates posts observed in both cohorts', () => {
  const recent = normalizeJobSearchContentItem({
    id: 'same',
    text: 'Recruiters will ask this interview question. Save this.',
    webVideoUrl: 'https://www.tiktok.com/@fordcoleman_/video/same',
    authorMeta: { name: 'fordcoleman_', nickName: 'Ford Coleman' },
    playCount: 500,
  }, 0, spec('runway'), execution(), 1, '2026-07-16T19:00:00.000Z');
  const popular = {
    ...recent,
    cohort: 'popular' as const,
    cohorts_observed: ['popular' as const],
    evidence_id: `${recent.evidence_id}:popular`,
  };
  const report = reanalyzeJobContentFeedReport({
    feed_id: 'test',
    created_at: '2026-07-16T19:00:00.000Z',
    status: 'completed',
    request_sha256: 'request',
    items: [recent, popular],
    provider_gaps: [],
    source_summaries: [summarizeJobContentSource('runway', [recent, popular])],
    cross_source_patterns: summarizeCrossSourcePatterns([recent, popular]),
    runs: [],
    external_calls_made: 0,
    total_usage_usd: 0,
    evidence_boundary: {
      public_metadata_only: true,
      raw_media_downloaded: false,
      source_identity_is_inferred_from_search: false,
      rankings_are_causal_proof: false,
      category_proxy_is_official_brand_content: false,
    },
    errors: [],
  });
  assert.equal(report.items.length, 1);
  assert.deepEqual(report.items[0].cohorts_observed.sort(), ['popular', 'recent']);
  assert.equal(report.items[0].signals.topic, 'interview');
});

function spec(sourceId: 'runway' | 'handshake' | 'internships_com'): JobContentDiscoverySpec {
  return {
    source_id: sourceId,
    cohort: 'recent',
    actor_id: 'clockworks/tiktok-scraper',
    input_mode: sourceId === 'internships_com' ? 'search' : 'profile',
    input: {},
    expected_max_items: 5,
  };
}

function execution(): ApifyActorExecution {
  return {
    actor_id: 'clockworks/tiktok-scraper',
    actor_build_id: 'build',
    actor_build_number: '1',
    actor_input_sha256: 'input',
    actor_input_mode: 'profile',
    run_id: 'run',
    dataset_id: 'dataset',
    status: 'SUCCEEDED',
    items: [],
    item_offsets: [],
    dataset_items_returned: 0,
    dataset_items_total_reported: 0,
    dataset_truncated: false,
    dataset_truncation_unknown: false,
    actual_cost_usd: 0.01,
    usage_finalized: true,
    pricing_info: null,
    charged_event_counts: null,
    external_calls_made: 1,
  };
}
