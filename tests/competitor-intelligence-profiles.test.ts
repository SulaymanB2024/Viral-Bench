import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  buildCompetitorIntelligenceProfiles,
  loadCompetitorProfileInputs,
  type CompetitorProfileInputs,
} from '../src/competitor-intelligence-profiles';

const generatedAt = '2026-07-17T20:00:00.000Z';

function fixture(overrides: Record<string, unknown> = {}): CompetitorProfileInputs {
  return {
    core_competitors: {
      generated_at: generatedAt,
      competitors: [{
        name: 'Analyzed Co',
        category: 'marketplace',
        status: 'active_verified',
        content_priority: 1,
        official_url: 'https://analyzed.example/',
        known_socials: {
          instagram: 'https://www.instagram.com/analyzed/',
          tiktok: 'https://www.tiktok.com/@analyzed',
        },
      }, {
        name: 'Excluded Co',
        category: 'legacy',
        status: 'pivoted',
        content_priority: 'exclude',
        official_url: 'https://excluded.example/',
        known_socials: {},
      }],
    },
    competitor_universe: {
      created_at: generatedAt,
      competitors: [{
        name: 'Observed Co',
        category: 'experience',
        status: 'active_verified',
        content_priority: 1,
        official_url: 'https://observed.example/',
        known_socials: {
          instagram: 'https://www.instagram.com/observed/',
        },
      }, {
        name: 'Known Gap Co',
        category: 'placement',
        status: 'active_verified',
        content_priority: 2,
        official_url: 'https://known-gap.example/',
        known_socials: {
          tiktok: 'https://www.tiktok.com/@known-gap',
          facebook: 'https://www.facebook.com/known-gap',
        },
      }, {
        name: 'Discovery Gap Co',
        category: 'infrastructure',
        status: 'active_verified',
        content_priority: 2,
        official_url: 'https://discovery-gap.example/',
        known_socials: {},
      }],
    },
    content_library: {
      schema_version: 2,
      generated_at: generatedAt,
      items: [{
        item_id: 'instagram:post:POST1',
        platform: 'instagram',
        content_type: 'short_video',
        platform_post_id: 'POST1',
        canonical_url: 'https://www.instagram.com/p/POST1/',
        account_handle: 'analyzed',
        posted_at: '2026-07-16T00:00:00.000Z',
        last_seen_at: generatedAt,
        observation_count: 2,
        performance: {
          age_bucket: '0_72_hours',
          signal: 'breakout_candidate',
          comparison_percentile: 0.95,
          observed_view_velocity_per_hour: 120,
          confidence: 'high',
          evidence_limitations: ['Short observation window.'],
        },
      }, {
        item_id: 'tiktok:post:POST2',
        platform: 'tiktok',
        content_type: 'short_video',
        platform_post_id: 'POST2',
        canonical_url: 'https://www.tiktok.com/@analyzed/video/POST2',
        account_handle: 'analyzed',
        posted_at: '2026-06-20T00:00:00.000Z',
        last_seen_at: generatedAt,
        observation_count: 1,
        performance: {
          age_bucket: '4_30_days',
          signal: 'baseline',
          comparison_percentile: 0.4,
          observed_view_velocity_per_hour: null,
          confidence: 'medium',
          evidence_limitations: [],
        },
      }, {
        item_id: 'instagram:post:POST3',
        platform: 'instagram',
        content_type: 'feed_video',
        platform_post_id: 'POST3',
        canonical_url: 'https://www.instagram.com/p/POST3/',
        account_handle: 'observed',
        posted_at: '2026-07-15T00:00:00.000Z',
        last_seen_at: generatedAt,
        observation_count: 1,
        performance: {
          age_bucket: '0_72_hours',
          signal: 'promising',
          comparison_percentile: 0.8,
          observed_view_velocity_per_hour: null,
          confidence: 'medium',
          evidence_limitations: [],
        },
      }],
    },
    semantic_map: {
      schema_version: 4,
      generated_at: generatedAt,
      coverage: { videos_multimodally_mapped: 1 },
      taxonomy: {
        method: 'heuristic_keyword_rules',
        observed_or_derived: 'derived',
      },
      videos: [{
        evidence_id: 'instagram:post:POST1',
        platform: 'instagram',
        canonical_url: 'https://www.instagram.com/p/POST1/',
        account_handle: 'analyzed',
        semantic_state: 'multimodal_mapped',
        topic: 'interview',
        audience_state: 'interview_uncertain',
        content_promise: 'process_instruction',
        proof_mode: 'visible_demonstration',
        next_action: 'practice',
        journey_stage: 'act',
        hook_type: 'question',
        format: 'talking_point',
        cta_type: 'soft_prompt',
        hook: { text: 'Source wording must not appear in the profile.' },
        cta: { text: 'Follow for more.' },
        pacing: { pattern: 'Single continuous shot.' },
        style: ['Informative'],
        visible_proof: [{ description: 'A visible screen.' }],
        claims: [],
        evidence_limitations: ['One source.'],
      }],
    },
    pipeline_refresh: {
      schema_version: 'viralbench_pipeline_refresh_v2',
      updated_at: generatedAt,
      status: 'partial',
      analyses: [{
        canonical_url: 'https://www.tiktok.com/@analyzed/video/POST2',
        platform: 'tiktok',
        platform_post_id: 'POST2',
        hook: { text: 'Another source hook.' },
        cta: { text: 'No explicit call to action.' },
        pacing: { pattern: 'Fast cuts.' },
        style: ['Fast-paced'],
        visible_proof: [{ description: 'Visible interface.' }],
        claims: [{ text: 'Observed claim.' }],
        evidence_limitations: ['No external verification.'],
      }],
    },
    video_reports: {
      generated_at: generatedAt,
      reports: {},
    },
    generated_at: generatedAt,
    ...overrides,
  } as CompetitorProfileInputs;
}

test('builds source-backed profiles for analyzed, observed, and unobserved competitors', () => {
  const profiles = buildCompetitorIntelligenceProfiles(fixture());
  const analyzed = profiles.profiles.find((profile) => profile.name === 'Analyzed Co');
  const observed = profiles.profiles.find((profile) => profile.name === 'Observed Co');
  const knownGap = profiles.profiles.find((profile) => profile.name === 'Known Gap Co');
  const discoveryGap = profiles.profiles.find((profile) => profile.name === 'Discovery Gap Co');

  assert.equal(profiles.status, 'partial');
  assert.equal(profiles.summary.active_competitors, 4);
  assert.equal(profiles.summary.with_observed_content, 2);
  assert.equal(profiles.summary.with_deep_analysis, 1);
  assert.equal(profiles.summary.distinct_reconciled_deep_posts, 2);
  assert.equal(analyzed?.coverage.deep_analyzed_posts, 2);
  assert.equal(analyzed?.coverage.structured_taxonomy_posts, 1);
  assert.equal(analyzed?.coverage.state, 'deep_analysis_thin');
  assert.equal(analyzed?.patterns.hook_type?.[0]?.value, 'question');
  assert.equal(analyzed?.patterns.hook_type?.[0]?.share, 1);
  assert.equal(analyzed?.representative_posts[0]?.analyzed, true);
  assert.equal(analyzed?.representative_posts[0]?.structured_taxonomy?.topic, 'interview');
  assert.doesNotMatch(JSON.stringify(analyzed), /Source wording must not appear/);
  assert.equal(observed?.coverage.state, 'observed_unanalyzed');
  assert.equal(observed?.next_action.code, 'analyze_first_video');
  assert.equal(observed?.next_action.candidate_item_id, 'instagram:post:POST3');
  assert.equal(knownGap?.coverage.state, 'known_socials_unobserved');
  assert.deepEqual(
    knownGap?.known_socials.map((source) => source.platform),
    ['facebook', 'tiktok'],
  );
  assert.equal(knownGap?.next_action.code, 'collect_known_socials');
  assert.equal(discoveryGap?.coverage.state, 'social_discovery_gap');
  assert.equal(discoveryGap?.next_action.code, 'discover_official_socials');
  assert.equal(profiles.profiles.some((profile) => profile.name === 'Excluded Co'), false);
  assert.ok(profiles.quality.issues.some((issue) => issue.code === 'priority_competitor_content_gap'));
});

test('keeps image-only competitors out of the TwelveLabs queue', () => {
  const input = fixture();
  const content = input.content_library as { items: Array<Record<string, unknown>> };
  content.items[2].content_type = 'image_post';
  const profiles = buildCompetitorIntelligenceProfiles(input);

  assert.equal(
    profiles.queues.analysis.some((row) => row.competitor === 'Observed Co'),
    false,
  );
  assert.deepEqual(
    profiles.queues.no_eligible_video.map((row) => row.competitor),
    ['Observed Co'],
  );
  assert.ok(
    profiles.quality.issues.some((issue) => issue.code === 'observed_competitor_without_eligible_video'),
  );
});

test('queues the explicit next-action candidate when it ranks outside the first three posts', () => {
  const input = fixture();
  const content = input.content_library as { items: Array<Record<string, unknown>> };
  const analyzedSecond = content.items[1].performance as Record<string, unknown>;
  analyzedSecond.signal = 'promising';
  analyzedSecond.comparison_percentile = 0.95;
  const newItem = (
    postId: string,
    signal: string,
    comparisonPercentile: number,
  ): Record<string, unknown> => ({
    item_id: `instagram:post:${postId}`,
    platform: 'instagram',
    content_type: 'short_video',
    platform_post_id: postId,
    canonical_url: `https://www.instagram.com/p/${postId}/`,
    account_handle: 'analyzed',
    posted_at: '2026-06-01T00:00:00.000Z',
    last_seen_at: generatedAt,
    observation_count: 1,
    performance: {
      age_bucket: '4_30_days',
      signal,
      comparison_percentile: comparisonPercentile,
      observed_view_velocity_per_hour: null,
      confidence: 'medium',
      evidence_limitations: [],
    },
  });
  content.items.push(
    newItem('POST4', 'high_performer', 0.9),
    newItem('POST5', 'baseline', 0.9),
    newItem('POST6', 'baseline', 0.8),
    newItem('POST7', 'baseline', 0.7),
    newItem('POST8', 'baseline', 0.6),
  );
  const refresh = input.pipeline_refresh as { analyses: Array<Record<string, unknown>> };
  refresh.analyses.push({
    canonical_url: 'https://www.instagram.com/p/POST4/',
    platform: 'instagram',
    platform_post_id: 'POST4',
  });

  const profiles = buildCompetitorIntelligenceProfiles(input);
  const analyzed = profiles.profiles.find((profile) => profile.name === 'Analyzed Co');
  const queued = profiles.queues.analysis.find((row) => row.competitor === 'Analyzed Co');

  assert.equal(analyzed?.next_action.code, 'expand_analysis_sample');
  assert.equal(analyzed?.next_action.candidate_item_id, 'instagram:post:POST5');
  assert.equal(analyzed?.representative_posts.length, 4);
  assert.equal(queued?.item_id, 'instagram:post:POST5');
  assert.equal(queued?.gap, 'expand_sample');
});

test('separates metadata taxonomy from reconciled deep analysis', () => {
  const input = fixture();
  const semantic = input.semantic_map as {
    coverage: { videos_multimodally_mapped: number };
    videos: Array<Record<string, unknown>>;
  };
  semantic.coverage.videos_multimodally_mapped = 0;
  semantic.videos[0].semantic_state = 'metadata_only';
  const refresh = input.pipeline_refresh as { analyses: unknown[] };
  refresh.analyses = [];
  const profiles = buildCompetitorIntelligenceProfiles(input);
  const analyzed = profiles.profiles.find((profile) => profile.name === 'Analyzed Co');

  assert.equal(analyzed?.coverage.deep_analyzed_posts, 0);
  assert.equal(analyzed?.coverage.structured_taxonomy_posts, 0);
  assert.equal(analyzed?.coverage.state, 'observed_unanalyzed');
  assert.deepEqual(analyzed?.patterns.topic, []);
});

test('reconciles generated reports only through explicit identities', () => {
  const input = fixture();
  const refresh = input.pipeline_refresh as { analyses: unknown[] };
  refresh.analyses = [];
  const reports = input.video_reports as { reports: Record<string, unknown> };
  reports.reports = {
    explicit: {
      candidate_id: 'live:instagram:POST3:reviewed-pool',
    },
    unsafe_substring: {
      candidate_id: 'opaque-candidate-containing-POST2',
    },
  };
  const profiles = buildCompetitorIntelligenceProfiles(input);
  const analyzed = profiles.profiles.find((profile) => profile.name === 'Analyzed Co');
  const observed = profiles.profiles.find((profile) => profile.name === 'Observed Co');

  assert.equal(observed?.coverage.deep_analyzed_posts, 1);
  assert.equal(analyzed?.coverage.deep_analyzed_posts, 1);
  assert.ok(
    profiles.quality.issues.some((issue) => issue.code === 'generated_report_library_reconciliation_gap'),
  );
});

test('surfaces unreconciled provider records and taxonomy provenance gaps', () => {
  const input = fixture();
  input.pipeline_refresh = {
    updated_at: generatedAt,
    analyses: [{
      platform: 'tiktok',
      platform_post_id: 'MISSING',
      canonical_url: 'https://www.tiktok.com/@missing/video/MISSING',
    }],
  };
  input.semantic_map = {
    generated_at: generatedAt,
    coverage: { videos_multimodally_mapped: 0 },
    taxonomy: {},
    videos: [],
  };
  const profiles = buildCompetitorIntelligenceProfiles(input);

  assert.ok(
    profiles.quality.issues.some((issue) => issue.code === 'scheduled_analysis_library_reconciliation_gap'),
  );
  assert.ok(
    profiles.quality.issues.some((issue) => issue.code === 'taxonomy_provenance_missing'),
  );
});

test('fails closed on duplicate content identity and missing required sources', () => {
  const duplicate = fixture();
  const content = duplicate.content_library as { items: Array<Record<string, unknown>> };
  content.items.push({ ...content.items[0] });
  assert.throws(
    () => buildCompetitorIntelligenceProfiles(duplicate),
    /Duplicate content item_id/,
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'competitor-profiles-'));
  assert.throws(
    () => loadCompetitorProfileInputs({ root }),
    /Required competitor-profile source is missing/,
  );
});

test('derives deterministic generated_at from the freshest input when not explicit', () => {
  const { generated_at: _ignored, ...input } = fixture();
  const refresh = input.pipeline_refresh as Record<string, unknown>;
  refresh.updated_at = '2026-07-18T01:30:00.000Z';
  const profiles = buildCompetitorIntelligenceProfiles(input);

  assert.equal(profiles.generated_at, '2026-07-18T01:30:00.000Z');
});
