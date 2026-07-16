import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { ApifyApiClient } from '../src/apify-api';
import {
  buildSeoDiscoverySpecs,
  buildSeoResearchPreflight,
  buildSeoStrategyReport,
  runSeoDiscovery,
  validateSeoResearchRequest,
} from '../src/seo-research';

const request = {
  research_id: 'test-seo-001',
  niche: 'used electric scooter valuation',
  platforms: ['youtube_shorts'],
  search_queries: ['used scooter battery test', 'electric scooter resale value'],
  cohorts: ['recent', 'popular'],
  max_results_per_query: 2,
  approval: {
    state: 'approved',
    approved_by: 'test operator',
    approved_at: '2026-07-15T12:00:00.000Z',
  },
  cost_policy: { max_apify_usd: 0.2 },
  house_style: {
    name: 'WorthScan proof-first valuation',
    voice: ['plainspoken'],
    recurring_devices: ['three comparable listings'],
    differentiators: ['range plus confidence'],
  },
};

const tiktokRequest = {
  research_id: 'internships-com-tiktok-test',
  niche: 'internship application strategy for college students',
  strategy_mode: 'career_guidance',
  platforms: ['tiktok'],
  search_queries: ['internship resume tips'],
  cohorts: ['recent', 'popular'],
  max_results_per_query: 2,
  approval: {
    state: 'approved',
    approved_by: 'test operator',
    approved_at: '2026-07-15T18:00:00.000Z',
  },
  cost_policy: { max_apify_usd: 1 },
  house_style: {
    name: 'Internships.com signal stack',
    voice: ['direct', 'student-respectful'],
    recurring_devices: ['match, prove, connect, review'],
    differentiators: ['no guaranteed outcomes'],
  },
};

test('SEO research validates an approved bounded request and builds separate cohorts', () => {
  const validated = validateSeoResearchRequest(request);
  assert.equal(validated.search_queries.length, 2);
  const env = {
    ALLOW_PUBLIC_SEO_RESEARCH: 'true',
    ALLOW_PAID_GENERATION: 'true',
    APIFY_TOKEN: 'test-token',
    APIFY_ACTOR_YOUTUBE: 'streamers/youtube-scraper',
  };
  const preflight = buildSeoResearchPreflight(request, env);
  assert.equal(preflight.live_ready, true);
  assert.equal(preflight.external_calls_made, 0);
  assert.deepEqual(preflight.credential_presence, { apify_token: true });
  const specs = buildSeoDiscoverySpecs(request, env);
  assert.equal(specs.length, 2);
  assert.equal(specs[0].input.maxResults, 0);
  assert.equal(specs[0].input.maxResultsShorts, 2);
  assert.equal(specs[0].input.aiVideoSummary, false);
  assert.deepEqual(specs.map((spec) => spec.input.sortingOrder), ['date', 'views']);
});

test('TikTok SEO research uses the reviewed metadata-only Actor contract', () => {
  const env = {
    ALLOW_PUBLIC_SEO_RESEARCH: 'true',
    ALLOW_PAID_GENERATION: 'true',
    APIFY_TOKEN: 'test-token',
    APIFY_ACTOR_TIKTOK: 'clockworks/tiktok-scraper',
  };
  const preflight = buildSeoResearchPreflight(tiktokRequest, env);
  assert.equal(preflight.live_ready, true);
  assert.equal(preflight.actors.tiktok.allowlisted, true);
  const specs = buildSeoDiscoverySpecs(tiktokRequest, env);
  assert.equal(specs.length, 2);
  assert.deepEqual(specs.map((spec) => spec.input.videoSearchSorting), ['LATEST', 'MOST_LIKED']);
  assert.deepEqual(specs.map((spec) => spec.input.videoSearchDateFilter), ['PAST_MONTH', 'LAST_6_MONTHS']);
  assert.ok(specs.every((spec) => spec.input.searchSection === '/video'));
  assert.ok(specs.every((spec) => spec.input.shouldDownloadVideos === false));
  assert.ok(specs.every((spec) => spec.input.shouldDownloadSlideshowImages === false));
  assert.ok(specs.every((spec) => spec.input.downloadSubtitlesOptions === 'NEVER_DOWNLOAD_SUBTITLES'));
});

test('TikTok preflight blocks budgets below the current per-run charge-cap minimum', () => {
  const lowBudget = { ...tiktokRequest, cost_policy: { max_apify_usd: 0.2 } };
  const preflight = buildSeoResearchPreflight(lowBudget, {
    ALLOW_PUBLIC_SEO_RESEARCH: 'true',
    ALLOW_PAID_GENERATION: 'true',
    APIFY_TOKEN: 'test-token',
    APIFY_ACTOR_TIKTOK: 'clockworks/tiktok-scraper',
  });

  assert.equal(preflight.live_ready, false);
  assert.ok(preflight.blockers.includes('cost_policy.max_apify_usd>=1'));
  assert.equal(preflight.external_calls_made, 0);
});

test('Apify adapter retries safe reads, paginates raw items, and reconciles final usage', async () => {
  const responses = [
    new Response(JSON.stringify({ data: { id: 'run12345678' } }), { status: 201 }),
    new Response('', { status: 429, headers: { 'retry-after': '0' } }),
    new Response(JSON.stringify({
      data: {
        id: 'run12345678', status: 'SUCCEEDED', defaultDatasetId: 'dataset12345678',
        buildId: 'build12345678', buildNumber: '1.2.3', usageTotalUsd: 0.01,
      },
    })),
    new Response(JSON.stringify([{ id: 'one' }, { id: 'two' }]), {
      headers: { 'x-apify-pagination-total': '3' },
    }),
    new Response(JSON.stringify([{ id: 'three' }]), {
      headers: { 'x-apify-pagination-total': '3' },
    }),
    new Response(JSON.stringify({
      data: {
        id: 'run12345678', status: 'SUCCEEDED', defaultDatasetId: 'dataset12345678',
        buildId: 'build12345678', buildNumber: '1.2.3', usageTotalUsd: 0.011,
      },
    })),
  ];
  const calls: string[] = [];
  const waits: number[] = [];
  const client = new ApifyApiClient({
    token: 'test-token',
    sleep: async (milliseconds) => { waits.push(milliseconds); },
    random: () => 0,
    fetchImpl: async (input) => {
      calls.push(String(input));
      const response = responses.shift();
      assert.ok(response, `Unexpected request ${String(input)}`);
      return response;
    },
  });
  const result = await client.executeActor({
    actorId: 'streamers/youtube-scraper',
    input: { searchQueries: ['scooter'], maxResultsShorts: 3 },
    inputMode: 'search',
    maxTotalChargeUsd: 0.1,
    maxItems: 3,
    datasetPageSize: 2,
    maxDatasetItems: 3,
    usageSettlementMs: 0,
  });
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.item_offsets, [0, 1, 2]);
  assert.equal(result.actual_cost_usd, 0.011);
  assert.equal(result.usage_finalized, true);
  assert.equal(result.actor_build_number, '1.2.3');
  assert.equal(calls.length, 6);
  assert.deepEqual(waits, [0]);
  assert.doesNotMatch(calls.join('\n'), /clean=true/);
  assert.doesNotMatch(calls.join('\n'), /test-token/);
});

test('SEO discovery retains observed evidence and strategy keeps inference separate', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-seo-'));
  const env = {
    ALLOW_PUBLIC_SEO_RESEARCH: 'true',
    ALLOW_PAID_GENERATION: 'true',
    APIFY_TOKEN: 'test-token',
    APIFY_ACTOR_YOUTUBE: 'streamers/youtube-scraper',
  };
  const items = [
    {
      id: 'short-one',
      title: 'Before you buy a used scooter, check this battery risk',
      url: 'https://www.youtube.com/shorts/short-one',
      viewCount: 120000,
      likes: 5000,
      commentsCount: 120,
      channelName: 'Repair Lab',
      date: '2 weeks ago',
    },
    {
      id: 'short-two',
      title: 'What is this electric scooter worth? 3 checks',
      url: 'https://www.youtube.com/shorts/short-two',
      viewCount: 80000,
      likes: 2500,
      commentsCount: 80,
      channelName: 'Resale Guide',
      date: '3 weeks ago',
    },
  ];
  const responses: Response[] = [];
  for (const cohort of ['recent', 'popular']) {
    responses.push(
      new Response(JSON.stringify({ data: { id: `run-${cohort}-12345678` } }), { status: 201 }),
      new Response(JSON.stringify({
        data: {
          id: `run-${cohort}-12345678`, status: 'SUCCEEDED', defaultDatasetId: `dataset-${cohort}-12345678`,
          buildId: 'build12345678', buildNumber: '9.9.9', usageTotalUsd: 0.006,
        },
      })),
      new Response(JSON.stringify(items)),
      new Response(JSON.stringify({
        data: {
          id: `run-${cohort}-12345678`, status: 'SUCCEEDED', defaultDatasetId: `dataset-${cohort}-12345678`,
          buildId: 'build12345678', buildNumber: '9.9.9', usageTotalUsd: 0.007,
        },
      })),
    );
  }
  const report = await runSeoDiscovery(request, {
    outputDir,
    env,
    usageSettlementMs: 0,
    now: () => new Date('2026-07-15T13:00:00.000Z'),
    fetchImpl: async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });
  assert.equal(report.status, 'completed');
  assert.equal(report.candidates.length, 4);
  assert.equal(report.total_usage_usd, 0.014);
  assert.equal(report.evidence_boundary.causal_claims_allowed, false);
  assert.ok(report.candidates.every((candidate) => candidate.provenance.actor_build_number === '9.9.9'));
  assert.ok(report.candidates.every((candidate) => candidate.published_at_raw?.includes('weeks ago')));

  const strategy = buildSeoStrategyReport(request, report, () => new Date('2026-07-15T13:05:00.000Z'));
  assert.equal(strategy.approval_state, 'draft');
  assert.equal(strategy.content_concepts.length, 3);
  assert.ok(strategy.observed_patterns.length > 0);
  assert.ok(strategy.derived_recommendations.every((item) => item.inference_method === 'bounded_pattern_synthesis'));
  assert.match(strategy.originality_constraints.join(' '), /Never copy/i);
  assert.match(strategy.limitations.join(' '), /not causal proof/i);
});

test('TikTok discovery normalizes observed metadata and builds career-guidance concepts', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-tiktok-seo-'));
  const env = {
    ALLOW_PUBLIC_SEO_RESEARCH: 'true',
    ALLOW_PAID_GENERATION: 'true',
    APIFY_TOKEN: 'test-token',
    APIFY_ACTOR_TIKTOK: 'clockworks/tiktok-scraper',
  };
  const item = {
    id: '7450000000000000001',
    text: 'Internship resume tips: turn coursework into proof #internshiptips',
    webVideoUrl: 'https://www.tiktok.com/@careercoach/video/7450000000000000001?lang=en',
    createTimeISO: '2026-07-10T12:00:00.000Z',
    playCount: 42000,
    diggCount: 3100,
    commentCount: 91,
    authorMeta: { name: 'careercoach', profileUrl: 'https://www.tiktok.com/@careercoach' },
    videoMeta: { duration: 24 },
    hashtags: [{ name: 'internshiptips' }],
  };
  const responses: Response[] = [];
  for (const cohort of ['recent', 'popular']) {
    responses.push(
      new Response(JSON.stringify({ data: { id: `run-tiktok-${cohort}-12345678` } }), { status: 201 }),
      new Response(JSON.stringify({
        data: {
          id: `run-tiktok-${cohort}-12345678`, status: 'SUCCEEDED', defaultDatasetId: `dataset-tiktok-${cohort}-12345678`,
          buildId: 'tiktok-build-12345678', buildNumber: '2.0.0', usageTotalUsd: 0.004,
        },
      })),
      new Response(JSON.stringify([item])),
      new Response(JSON.stringify({
        data: {
          id: `run-tiktok-${cohort}-12345678`, status: 'SUCCEEDED', defaultDatasetId: `dataset-tiktok-${cohort}-12345678`,
          buildId: 'tiktok-build-12345678', buildNumber: '2.0.0', usageTotalUsd: 0.005,
        },
      })),
    );
  }
  const report = await runSeoDiscovery(tiktokRequest, {
    outputDir,
    env,
    usageSettlementMs: 0,
    now: () => new Date('2026-07-15T18:30:00.000Z'),
    fetchImpl: async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });
  assert.equal(report.status, 'completed');
  assert.equal(report.candidates.length, 2);
  assert.equal(report.candidates[0].platform, 'tiktok');
  assert.equal(report.candidates[0].canonical_url, 'https://www.tiktok.com/@careercoach/video/7450000000000000001');
  assert.equal(report.candidates[0].channel_name, 'careercoach');
  assert.equal(report.candidates[0].observed_metrics.views, 42000);
  assert.deepEqual(report.candidates[0].hashtags, ['internshiptips']);

  const strategy = buildSeoStrategyReport(tiktokRequest, report, () => new Date('2026-07-15T18:35:00.000Z'));
  assert.match(strategy.content_concepts[0].working_title, /internship application/i);
  assert.match(strategy.content_concepts.map((concept) => concept.adaptation_note).join(' '), /student action stack/i);
  assert.match(strategy.search_intent.title_rules.join(' '), /Do not promise an internship/i);
  assert.doesNotMatch(strategy.derived_recommendations.join(' '), /WorthScan/);
});
