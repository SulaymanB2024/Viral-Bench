import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  buildMarketingAnalysisIntakePlan,
  buildMarketingIntelligenceArtifact,
  buildMarketingIntelligenceHub,
  loadMarketingIntelligenceInputs,
} from '../src/marketing-intelligence-hub';

const generatedAt = '2026-07-17T20:00:00.000Z';

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    source_registry: {
      generated_at: generatedAt,
      sources: [
        { rank: 1, source_id: 'official-1', name: 'Official 1', category: 'official', status: 'observed', url: 'https://example.com/1' },
        { rank: 2, source_id: 'official-2', name: 'Official 2', category: 'official', status: 'sample_observed', url: 'https://example.com/2' },
        { rank: 3, source_id: 'official-3', name: 'Official 3', category: 'official', status: 'queued_official_page_review', url: 'https://example.com/3' },
        { rank: 4, source_id: 'owned-1', name: 'Owned outcomes', category: 'owned', status: 'not_supplied', url: null },
      ],
    },
    source_verification: {
      generated_at: generatedAt,
      verifications: [
        {
          source_id: 'official-3',
          status: 'observed',
          checked_at: generatedAt,
          verification_method: 'official_page_review',
          evidence_url: 'https://example.com/3',
          evidence_summary: 'Current official page returned.',
        },
        {
          source_id: 'owned-1',
          status: 'connection_required',
          checked_at: generatedAt,
          verification_method: 'evidence_domain_review',
          evidence_summary: 'First-party connection required.',
        },
      ],
    },
    core_competitors: {
      generated_at: generatedAt,
      competitors: [
        {
          name: 'Core Observed Co',
          category: 'core_marketplace',
          status: 'active_verified',
          content_priority: 1,
          official_url: 'https://core.example',
          known_socials: { tiktok: 'https://www.tiktok.com/@other' },
        },
        {
          name: 'Pivoted Legacy Co',
          category: 'pivoted_or_stale',
          status: 'pivoted_verified',
          content_priority: 'exclude',
          official_url: 'https://legacy.example',
          known_socials: { instagram: 'https://www.instagram.com/legacy/' },
        },
      ],
    },
    competitor_universe: {
      created_at: generatedAt,
      competitors: [
        {
          name: 'Observed Co',
          category: 'marketplace',
          status: 'active_verified',
          content_priority: 1,
          official_url: 'https://observed.example',
          known_socials: { instagram: 'https://www.instagram.com/observed.co/' },
        },
        {
          name: 'Unobserved Co',
          category: 'placement',
          status: 'active_verified',
          content_priority: 1,
          official_url: 'https://unobserved.example',
          known_socials: { tiktok: 'https://www.tiktok.com/@unobserved' },
        },
        {
          name: 'Discovery Gap Co',
          category: 'career_infrastructure',
          status: 'active_verified',
          content_priority: 2,
          official_url: 'https://gap.example',
          known_socials: {},
        },
      ],
    },
    content_library: {
      schema_version: 2,
      generated_at: generatedAt,
      summary: { observations: 3, repeated_items: 1 },
      analysis_queue: [{ item_id: 'instagram:post:POST1' }],
      items: [
        {
          item_id: 'instagram:post:POST1',
          platform: 'instagram',
          content_type: 'short_video',
          platform_post_id: 'POST1',
          canonical_url: 'https://www.instagram.com/reel/POST1/',
          account_handle: 'observed.co',
          posted_at: '2026-07-16T00:00:00.000Z',
          last_seen_at: generatedAt,
          observation_count: 2,
          performance: {
            age_bucket: '0_72_hours',
            signal: 'breakout_candidate',
            comparison_percentile: 0.98,
            observed_view_velocity_per_hour: 500,
            confidence: 'high',
          },
        },
        {
          item_id: 'tiktok:POST2',
          platform: 'tiktok',
          content_type: 'short_video',
          platform_post_id: 'POST2',
          canonical_url: 'https://www.tiktok.com/@other/video/POST2',
          account_handle: 'other',
          posted_at: '2026-06-20T00:00:00.000Z',
          last_seen_at: generatedAt,
          observation_count: 1,
          performance: {
            age_bucket: '4_30_days',
            signal: 'baseline',
            comparison_percentile: 0.4,
            observed_view_velocity_per_hour: null,
            confidence: 'low',
          },
        },
      ],
    },
    owned_dashboard: {
      generated_at: generatedAt,
      connection_state: 'not_connected',
      dimensions: { posts: [] },
      facts: { metric_observations: [], event_aggregates: [] },
      quality: { issues: [{ severity: 'critical', code: 'not-connected' }] },
    },
    video_reports: {
      generated_at: generatedAt,
      reports: {
        report1: { candidate_id: 'live:instagram:POST1:discovery' },
      },
    },
    pipeline_refresh: {
      updated_at: generatedAt,
      status: 'completed',
      providers: { twelvelabs: { analysis_coverage: 1 } },
      analyses: [],
    },
    semantic_counts: { video_analyses: 1 },
    semantic_analysis_assets: [],
    generated_at: generatedAt,
    ...overrides,
  };
}

test('reconciles source, competitor, viral, analysis, and owned-performance coverage', () => {
  const hub = buildMarketingIntelligenceHub(fixture());

  assert.equal(hub.status, 'partial');
  assert.equal(hub.headline.verified_source_coverage, 0.75);
  assert.equal(hub.headline.priority_competitor_content_coverage, 0.5);
  assert.equal(hub.headline.temporal_measurement_coverage, 0.5);
  assert.equal(hub.headline.deep_analysis_queue_coverage, 1);
  assert.equal(hub.headline.owned_performance_connection_state, 'not_connected');
  assert.equal(hub.inventory.competitors.total, 4);
  assert.equal(hub.inventory.sources.state_resolved, 4);
  assert.equal(hub.inventory.sources.state_resolution_coverage, 1);
  assert.equal(hub.inventory.sources.verification_overrides_applied, 2);
  assert.equal(hub.inventory.competitors.with_observed_content, 2);
  assert.equal(hub.inventory.analysis.reports_reconciled_to_library, 1);
  assert.equal(hub.inventory.analysis.scheduled_analyses_reconciled_to_library, 0);
  assert.equal(hub.inventory.analysis.priority_competitor_analysis_coverage, 0.5);
  assert.equal(hub.queues.priority_competitor_analysis_gaps.length, 1);
  assert.equal(hub.queues.priority_competitor_analysis_queue.length, 1);
  assert.equal(hub.queues.priority_competitor_analysis_queue[0]?.competitor, 'Core Observed Co');
  assert.equal(hub.queues.priority_competitor_analysis_queue[0]?.item_id, 'tiktok:POST2');
  assert.equal(hub.inventory.content.distinct_accounts, 2);
  assert.equal(hub.queues.priority_competitor_gaps.length, 2);
  assert.equal(hub.queues.viral_analysis[0]?.analyzed, true);
  assert.ok(hub.quality.issues.some((issue) => issue.code === 'owned_performance_not_connected'));
});

test('reconciles published scheduled analyses into deep-analysis coverage', () => {
  const base = fixture();
  const hub = buildMarketingIntelligenceHub({
    ...base,
    video_reports: { generated_at: base.generated_at, reports: {} },
    pipeline_refresh: {
      updated_at: base.generated_at,
      status: 'partial',
      providers: { twelvelabs: { analysis_coverage: 0.8 } },
      analyses: [{
        canonical_url: 'https://www.instagram.com/reel/POST1/',
        platform: 'instagram',
        platform_post_id: 'POST1',
      }],
    },
  });

  assert.equal(hub.inventory.analysis.generated_video_reports, 0);
  assert.equal(hub.inventory.analysis.scheduled_analysis_records, 1);
  assert.equal(hub.inventory.analysis.scheduled_analyses_reconciled_to_library, 1);
  assert.equal(hub.headline.deep_analysis_queue_coverage, 1);
  assert.equal(hub.inventory.analysis.priority_competitor_analysis_coverage, 0.5);
  assert.equal(hub.queues.viral_analysis[0]?.analyzed, true);
});

test('reconciles historical semantic asset identities into deep-analysis coverage', () => {
  const base = fixture();
  const hub = buildMarketingIntelligenceHub({
    ...base,
    video_reports: { generated_at: base.generated_at, reports: {} },
    pipeline_refresh: {
      updated_at: base.generated_at,
      status: 'partial',
      providers: { twelvelabs: { analysis_coverage: 0.8 } },
      analyses: [],
    },
    semantic_analysis_assets: [{ video_asset_id: 'instagram:post:POST1:video' }],
  });

  assert.equal(hub.inventory.analysis.semantic_analysis_distinct_assets, 1);
  assert.equal(hub.inventory.analysis.semantic_analysis_posts_reconciled_to_library, 1);
  assert.equal(hub.headline.deep_analysis_queue_coverage, 1);
  assert.equal(hub.inventory.analysis.priority_competitor_analysis_coverage, 0.5);
  assert.equal(hub.queues.viral_analysis[0]?.analyzed, true);
});

test('keeps public intelligence and owned performance as separate sourced cards', () => {
  const hub = buildMarketingIntelligenceHub(fixture());
  const artifact = buildMarketingIntelligenceArtifact(hub);
  const manifest = artifact.manifest as {
    cards: Array<{ id: string; sourceId: string }>;
    blocks: Array<{ type: string; cardIds?: string[] }>;
  };
  const cards = Object.fromEntries(manifest.cards.map((card) => [card.id, card.sourceId]));

  assert.equal(cards['priority-competitors'], 'competitor-reconciliation');
  assert.equal(cards['verified-sources'], 'source-reconciliation');
  assert.equal(cards['temporal-coverage'], 'content-library');
  assert.equal(cards['owned-connection'], 'owned-dashboard');
  assert.deepEqual(
    manifest.blocks.find((block) => block.type === 'metric-strip')?.cardIds,
    ['verified-sources', 'priority-competitors', 'temporal-coverage', 'analysis-coverage', 'owned-connection'],
  );
});

test('creates bounded draft analysis batches without authorizing external calls', () => {
  const hub = buildMarketingIntelligenceHub(fixture());
  const plan = buildMarketingAnalysisIntakePlan(hub, 1);

  assert.equal(plan.execution_state, 'draft_not_authorized');
  assert.equal(plan.candidate_count, 1);
  assert.equal(plan.batch_count, 1);
  assert.equal(plan.batches[0]?.approval_state, 'draft');
  assert.deepEqual(plan.batches[0]?.urls, ['https://www.tiktok.com/@other/video/POST2']);
  assert.deepEqual(plan.batches[0]?.allowed_platforms, ['tiktok']);
  assert.equal(plan.batches[0]?.comment_policy.enabled, false);
  assert.throws(() => buildMarketingAnalysisIntakePlan(hub, 11), /between 1 and 10/);
});

test('deduplicates core and expanded competitors and omits explicit exclusions', () => {
  const input = fixture();
  const universe = input.competitor_universe as { competitors: Array<Record<string, unknown>> };
  universe.competitors.push({
    name: 'Core Observed Co',
    category: 'core_marketplace',
    status: 'active_verified',
    content_priority: 1,
    official_url: 'https://core.example',
    known_socials: { instagram: 'https://www.instagram.com/observed.co/' },
  });
  const hub = buildMarketingIntelligenceHub(input);

  assert.equal(hub.inventory.competitors.total, 4);
  assert.equal(hub.inventory.competitors.rows.filter((row) => row.name === 'Core Observed Co').length, 1);
  assert.equal(hub.inventory.competitors.rows.some((row) => row.name === 'Pivoted Legacy Co'), false);
  assert.equal(
    hub.inventory.competitors.rows.find((row) => row.name === 'Core Observed Co')?.known_social_platforms,
    2,
  );
});

test('fails closed on duplicate verification evidence and surfaces orphan source ids', () => {
  const duplicate = fixture();
  const verification = duplicate.source_verification as { verifications: Array<Record<string, unknown>> };
  verification.verifications.push({ ...verification.verifications[0] });
  assert.throws(
    () => buildMarketingIntelligenceHub(duplicate),
    /Duplicate source verification for official-3/,
  );

  const orphan = fixture({
    source_verification: {
      generated_at: generatedAt,
      verifications: [{
        source_id: 'not-in-registry',
        status: 'observed',
        checked_at: generatedAt,
      }],
    },
  });
  const hub = buildMarketingIntelligenceHub(orphan);
  assert.ok(hub.quality.issues.some((issue) => issue.code === 'source_verification_orphans'));
});

test('flags stale v1 content artifacts instead of inventing content types', () => {
  const base = fixture();
  const content = base.content_library as Record<string, unknown>;
  content.schema_version = 1;
  content.items = (content.items as Array<Record<string, unknown>>).map(({ content_type: _ignored, ...item }) => item);
  const hub = buildMarketingIntelligenceHub(base);

  assert.equal(hub.inventory.content.by_content_type.unknown, 2);
  assert.ok(hub.quality.issues.some((issue) => issue.code === 'content_library_artifact_drift'));
});

test('loader fails closed when a required hub source is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-intelligence-hub-'));
  assert.throws(
    () => loadMarketingIntelligenceInputs({ root }),
    /Required hub source is missing/,
  );
});
