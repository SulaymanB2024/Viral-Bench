import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

import { validateDiscoveryConfig } from '../src/competitor-content-discovery';
import {
  buildApprovedSelection,
  buildCodexReviewPacket,
  CODEX_RESEARCH_BUDGET,
  CODEX_SELECTION_AUTHORIZATION_BASIS,
  finalizeCodexRefresh,
  validateCodexSelectionDecision,
  type CodexReviewPacket,
  type CodexSelectionDecision,
} from '../src/codex-semantic-selection';
import type { PublicPipelineRefreshStatus } from '../src/scheduled-semantic-refresh';
import type {
  ViralContentItem,
  ViralContentLibrary,
} from '../src/viral-content-library';

const DISCOVERY_ID = 'scheduled-internship-broad-discovery-v1';

test('broad discovery config reserves 4.50 USD of the five-dollar Apify cap', () => {
  const config = validateDiscoveryConfig(JSON.parse(fs.readFileSync(path.resolve(
    '.ops/competitor_research/scheduled-internship-broad-discovery-v1.json',
  ), 'utf8')));
  assert.equal(config.max_total_charge_usd, CODEX_RESEARCH_BUDGET.discovery_apify_usd);
  assert.equal(
    config.runs.reduce((sum, run) => sum + run.max_charge_usd, 0),
    CODEX_RESEARCH_BUDGET.discovery_apify_usd,
  );
  assert.deepEqual(
    new Set(config.runs.map((run) => run.actor_id)),
    new Set(['clockworks/tiktok-scraper', 'apify/instagram-scraper', 'streamers/youtube-scraper']),
  );
});

test('review packet exposes only current-discovery videos while tracking the broad library', () => {
  const packet = reviewPacket();
  assert.equal(packet.summary.provider_rows, 800);
  assert.equal(packet.summary.tracked_unique_items, 8);
  assert.equal(packet.summary.eligible_video_candidates, 7);
  assert.equal(packet.summary.current_discovery_items, 7);
  assert.equal(packet.summary.previously_analyzed_candidates, 1);
  assert.ok(packet.candidates.every((candidate) => candidate.content_type !== 'image_post'));
});

test('Codex decision becomes an approved split-budget URL manifest', () => {
  const packet = reviewPacket();
  const approved = buildApprovedSelection(packet, decision());
  assert.equal(approved.manifest.approval_state, 'approved');
  assert.equal(approved.manifest.urls.length, 6);
  assert.equal(approved.manifest.cost_limits.max_apify_usd, 0.5);
  assert.equal(approved.manifest.cost_limits.max_twelvelabs_usd, 4);
  assert.equal(approved.manifest.cost_limits.max_total_usd, 4.5);
  assert.equal(approved.summary.newly_selected, 5);
  assert.deepEqual(approved.summary.by_platform, { instagram: 3, tiktok: 3 });
});

test('selection rejects unsupported candidates, account concentration, and silent reanalysis', () => {
  const packet = reviewPacket();
  const unsupported = decision();
  unsupported.selections[0].canonical_url = 'https://www.tiktok.com/@missing/video/9999999999999999999';
  assert.throws(() => validateCodexSelectionDecision(packet, unsupported), /not eligible/);

  const repeatWithoutReason = decision();
  repeatWithoutReason.selections[0].dimensions = ['breakout_signal'];
  assert.throws(() => validateCodexSelectionDecision(packet, repeatWithoutReason), /requires longitudinal_change/);

  const concentrated = decision();
  const first = concentrated.selections[0];
  concentrated.selections = Array.from({ length: 6 }, (_, index) => ({
    ...first,
    canonical_url: `https://www.tiktok.com/@same/video/${7600000000000000100n + BigInt(index)}`,
  }));
  const expandedPacket: CodexReviewPacket = {
    ...packet,
    candidates: concentrated.selections.map((selection, index) => ({
        ...packet.candidates[0],
        item_id: `same-${index}`,
        canonical_url: selection.canonical_url,
        previously_analyzed: false,
      })),
  };
  assert.throws(() => validateCodexSelectionDecision(expandedPacket, concentrated), /account cap/);
});

test('final status accounts for discovery and selected retrieval inside five Apify dollars', () => {
  const packet = reviewPacket();
  const status = finalizeCodexRefresh({
    discovery: discoveryReport(),
    packet,
    decision: decision(),
    semanticStatus: semanticStatus(),
    library: library(),
  });
  assert.equal(status.schema_version, 'viralbench_pipeline_refresh_v2');
  assert.deepEqual(status.budget, {
    currency: 'USD',
    max_total_usd: 9,
    max_apify_usd: 5,
    max_twelvelabs_usd: 4,
    apify_discovery_ceiling_usd: 4.5,
    apify_selected_url_ceiling_usd: 0.5,
    actual_or_conservative_usd: 4.5,
    apify_actual_or_conservative_usd: 3.5,
    twelvelabs_actual_or_conservative_usd: 1,
    prior_attempts_actual_or_conservative_usd: 0,
  });
  assert.equal((status.orchestration as Record<string, unknown>).selected_videos, 6);
});

function decision(): CodexSelectionDecision {
  const urls = [
    'https://www.tiktok.com/@creator0/video/7600000000000000000',
    'https://www.tiktok.com/@creator1/video/7600000000000000001',
    'https://www.tiktok.com/@creator2/video/7600000000000000002',
    'https://www.instagram.com/reel/TEST3/',
    'https://www.instagram.com/reel/TEST4/',
    'https://www.instagram.com/reel/TEST5/',
  ];
  return {
    schema_version: 'viralbench_codex_selection_v1',
    decided_by: 'codex_automation',
    decided_at: '2026-07-17T18:00:00.000Z',
    authorization_basis: CODEX_SELECTION_AUTHORIZATION_BASIS,
    selection_strategy: 'Prioritize one repeat-growth check plus new breakout, coverage-gap, and cross-platform contrast candidates.',
    selections: urls.map((canonicalUrl, index) => ({
      canonical_url: canonicalUrl,
      why_now: `Candidate ${index} fills a documented evidence gap while preserving platform and account diversity.`,
      dimensions: index === 0
        ? ['longitudinal_change' as const]
        : index % 2
          ? ['coverage_gap' as const]
          : ['cross_platform_contrast' as const],
    })),
  };
}

function reviewPacket(): CodexReviewPacket {
  return buildCodexReviewPacket({
    library: library(),
    discovery: discoveryReport(),
    previousStatus: {
      analyses: [{ canonical_url: 'https://www.tiktok.com/@creator0/video/7600000000000000000' }],
    },
    now: () => new Date('2026-07-17T17:00:00.000Z'),
  });
}

function discoveryReport() {
  return {
    research_id: DISCOVERY_ID,
    created_at: '2026-07-17T16:00:00.000Z',
    runs: [{ id: 'fixture-run', item_count: 800, items: [] }],
    errors: [],
    totals: {
      successful_runs: 10,
      failed_runs: 0,
      items: 800,
      actual_cost_usd_reported: 3,
      configured_max_charge_usd: 4.5,
      conservative_spend_usd: 3.25,
      remaining_cap_usd: 1.25,
      external_calls_made: 50,
    },
  };
}

function library(): ViralContentLibrary {
  const items = [
    ...Array.from({ length: 3 }, (_, index) => item(
      index,
      'tiktok',
      `https://www.tiktok.com/@creator${index}/video/${7600000000000000000n + BigInt(index)}`,
      `creator${index}`,
    )),
    ...Array.from({ length: 4 }, (_, offset) => item(
      offset + 3,
      'instagram',
      `https://www.instagram.com/reel/TEST${offset + 3}/`,
      `igcreator${offset}`,
    )),
    {
      ...item(7, 'instagram', 'https://www.instagram.com/p/IMAGE7/', 'imagecreator'),
      content_type: 'image_post' as const,
      provenance: {
        source_reports: ['published-library-baseline'],
        source_runs: ['old-run'],
        discovery_modes: ['stored_snapshot'],
        source_queries: [],
      },
    },
  ];
  return {
    schema_version: 2,
    generated_at: '2026-07-17T16:00:00.000Z',
    scope: {
      purpose: 'public_social_content_pattern_research',
      public_metadata_only: true,
      causal_claims_allowed: false,
      raw_cross_platform_ranking_allowed: false,
    },
    sources: { discovery_files: [], sqlite_path: null, provider_cost_usd_reported: 3 },
    summary: {
      unique_items: items.length,
      observations: items.length,
      repeated_items: 0,
      by_platform: { instagram: 5, tiktok: 3 },
      by_content_type: { feed_video: 4, image_post: 1, short_video: 3 },
      by_age_bucket: { '4_30_days': items.length },
      by_signal: { breakout_candidate: items.length },
      analysis_queue_items: 7,
    },
    analysis_queue: [],
    evidence_boundaries: [],
    items,
  };
}

function item(
  index: number,
  platform: 'tiktok' | 'instagram',
  canonicalUrl: string,
  accountHandle: string,
): ViralContentItem {
  return {
    item_id: `${platform}-${index}`,
    platform,
    content_type: platform === 'tiktok' ? 'short_video' : 'feed_video',
    platform_post_id: String(index),
    canonical_url: canonicalUrl,
    account_handle: accountHandle,
    caption: `Public internship research candidate ${index}`,
    hashtags: ['internship'],
    posted_at: '2026-07-10T00:00:00.000Z',
    first_seen_at: '2026-07-17T16:00:00.000Z',
    last_seen_at: '2026-07-17T16:00:00.000Z',
    observation_count: 1,
    observations: [{
      captured_at: '2026-07-17T16:00:00.000Z',
      source_reports: [DISCOVERY_ID],
      source_runs: ['fixture-run'],
      discovery_modes: ['search'],
      source_queries: [],
      cohorts: ['recent'],
      views: 1000 + index,
      likes: 100,
      comments: 10,
      shares: 5,
      saves: 5,
      interaction_metrics_observed: ['views', 'likes', 'comments', 'shares', 'saves'],
      interaction_metrics_missing: [],
      interaction_metric_coverage: 1,
      public_interactions: 120,
      post_age_hours: 100,
      lifetime_views_per_hour: 10,
      engagement_rate: 0.12,
    }],
    provenance: {
      source_reports: [DISCOVERY_ID],
      source_runs: ['fixture-run'],
      discovery_modes: ['search'],
      source_queries: [],
    },
    performance: {
      age_bucket: '4_30_days',
      latest_views: 1000 + index,
      latest_public_interactions: 120,
      latest_engagement_rate: 0.12,
      lifetime_views_per_hour: 10,
      observed_view_velocity_per_hour: null,
      observed_interaction_velocity_per_hour: null,
      observation_window_hours: null,
      latest_interaction_metric_coverage: 1,
      comparison_metric: 'views_and_engagement',
      comparison_percentile: 0.9 - index / 100,
      comparison_group_size: 20,
      signal: 'breakout_candidate',
      confidence: 'medium',
      evidence_limitations: ['One public snapshot cannot establish causal performance.'],
    },
  };
}

function semanticStatus(): PublicPipelineRefreshStatus {
  return {
    schema_version: 'viralbench_pipeline_refresh_v1',
    status: 'completed',
    updated_at: '2026-07-17T19:00:00.000Z',
    last_completed_at: '2026-07-17T19:00:00.000Z',
    schedule: {
      timezone: 'America/Chicago',
      local_time: '09:17',
      weekdays: ['Monday', 'Thursday'],
      cron: '17 9 * * 1,4',
    },
    budget: {
      currency: 'USD',
      max_total_usd: 4.5,
      max_apify_usd: 0.5,
      max_twelvelabs_usd: 4,
      actual_or_conservative_usd: 1.25,
    },
    source: { request_id: 'fixture', manifest_path: 'fixture.json', requested_urls: 6 },
    providers: {
      apify: { state: 'completed', accepted_posts: 6, actual_or_conservative_usd: 0.25 },
      twelvelabs: {
        state: 'completed',
        analyzed_videos: 6,
        analysis_coverage: 1,
        actual_or_conservative_usd: 1,
        models: ['marengo3.0', 'pegasus1.5'],
      },
    },
    results: {
      posts_ingested: 6,
      semantic_items_written: 100,
      external_calls_made: 20,
      library_unique_items: 8,
      library_observations: 8,
    },
    analyses: [],
    evidence_boundaries: [],
    errors: [],
    measurement_gaps: [],
  };
}
