import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  buildCompetitorCoveragePlan,
  loadCompetitorCoveragePlanInputs,
  type CompetitorCoveragePlanInputs,
} from '../src/competitor-coverage-plan';

const generatedAt = '2026-07-17T23:40:35.704Z';

function fixture(): CompetitorCoveragePlanInputs {
  const source = (
    platform: string,
    handle: string,
    url: string,
  ) => ({ platform, handle, url });
  const profile = (
    id: string,
    name: string,
    priority: number,
    socials: unknown[],
    observedPosts = 0,
  ) => ({
    competitor_id: id,
    name,
    priority,
    known_socials: socials,
    coverage: { observed_posts: observedPosts },
  });
  return {
    profiles: {
      generated_at: generatedAt,
      summary: {
        active_competitors: 6,
        priority_competitors: 6,
        priority_with_observed_content: 1,
        priority_with_deep_analysis: 0,
      },
      profiles: [
        profile('instagram-empty', 'Instagram Empty', 1, [
          source('instagram', 'instagramempty', 'https://www.instagram.com/instagramempty/'),
        ]),
        profile('tiktok-failed', 'TikTok Failed', 1, [
          source('tiktok', 'tiktokfailed', 'https://www.tiktok.com/@tiktokfailed'),
        ]),
        profile('youtube-new', 'YouTube New', 2, [
          source('youtube_shorts', 'youtubenew', 'https://www.youtube.com/@youtubenew'),
        ]),
        profile('facebook-manual', 'Facebook Manual', 2, [
          source('facebook', 'facebookmanual', 'https://www.facebook.com/facebookmanual'),
        ]),
        profile('source-gap', 'Source Gap', 2, []),
        profile('observed', 'Observed', 1, [
          source('instagram', 'observed', 'https://www.instagram.com/observed/'),
        ], 2),
      ],
      queues: {
        collection: [
          { competitor: 'Instagram Empty' },
          { competitor: 'TikTok Failed' },
          { competitor: 'YouTube New' },
          { competitor: 'Facebook Manual' },
          { competitor: 'Source Gap' },
        ],
        analysis: [{
          competitor: 'Observed',
          priority: 1,
          gap: 'first_deep_analysis',
          item_id: 'instagram:post:POST1',
          platform: 'instagram',
          content_type: 'short_video',
          canonical_url: 'https://www.instagram.com/p/POST1/',
          signal: 'breakout_candidate',
          comparison_percentile: 0.95,
          selection_reason: 'First eligible candidate.',
        }, {
          competitor: 'Observed',
          priority: 1,
          gap: 'expand_sample',
          item_id: 'instagram:post:POST2',
          platform: 'instagram',
          content_type: 'feed_video',
          canonical_url: 'https://www.instagram.com/p/POST2/',
          signal: 'baseline',
          comparison_percentile: 0.5,
          selection_reason: 'Expand the sample.',
        }, {
          competitor: 'Observed',
          priority: 1,
          gap: 'expand_sample',
          item_id: 'instagram:post:POST3',
          platform: 'instagram',
          content_type: 'feed_video',
          canonical_url: 'https://www.instagram.com/p/POST3/',
          signal: 'baseline',
          comparison_percentile: 0.4,
          selection_reason: 'Expand the sample.',
        }],
        taxonomy_normalization: [{ competitor: 'Observed' }],
        no_eligible_video: [{ competitor: 'Facebook Manual' }],
      },
    },
    source_candidates: {
      generated_at: generatedAt,
      competitors: [{
        competitor: 'Source Gap',
        review_state: 'no_verified_shortform_source_found',
        candidate_sources: [],
      }],
    },
    discovery_manifest: {
      created_at: '2026-07-17T23:00:00.000Z',
      max_total_charge_usd: 4.5,
      runs: [{
        id: 'instagram-profiles',
        actor_id: 'apify/instagram-scraper',
        input_mode: 'profile',
        input: {
          directUrls: [
            'https://www.instagram.com/instagramempty/',
            'https://www.instagram.com/unregistered/',
          ],
        },
      }, {
        id: 'tiktok-profiles',
        actor_id: 'clockworks/tiktok-scraper',
        input_mode: 'profile',
        input: {
          profiles: ['tiktokfailed'],
        },
      }, {
        id: 'topic-search',
        actor_id: 'clockworks/tiktok-scraper',
        input_mode: 'search',
        input: { searchQueries: ['internships'] },
      }],
    },
    discovery_report: {
      created_at: '2026-07-17T23:30:00.000Z',
      runs: [{ id: 'instagram-profiles', status: 'SUCCEEDED' }],
      errors: [{ id: 'tiktok-profiles', message: 'budget floor' }],
    },
    pipeline_refresh: {
      updated_at: generatedAt,
      budget: {
        max_apify_usd: 5,
        apify_discovery_ceiling_usd: 4.5,
        apify_selected_url_ceiling_usd: 0.5,
        max_twelvelabs_usd: 4,
      },
      source: { requested_urls: 2 },
      providers: {
        twelvelabs: {
          analyzed_videos: 2,
          actual_or_conservative_usd: 0.2,
        },
      },
    },
    generated_at: generatedAt,
  };
}

test('separates retries, empty-result review, new routes, manual sources, and discovery', () => {
  const plan = buildCompetitorCoveragePlan(fixture());
  const tasks = Object.fromEntries(plan.collection.tasks.map((task) => [
    task.competitor,
    task,
  ]));

  assert.equal(tasks['Instagram Empty'].task_type, 'review_empty_collection_result');
  assert.equal(tasks['Instagram Empty'].route, 'source_result_review');
  assert.equal(tasks['TikTok Failed'].task_type, 'retry_failed_profile_collection');
  assert.equal(tasks['TikTok Failed'].route, 'apify_profile_collection');
  assert.equal(tasks['YouTube New'].task_type, 'add_profile_collection');
  assert.equal(tasks['Facebook Manual'].task_type, 'review_unsupported_source');
  assert.equal(tasks['Source Gap'].task_type, 'discover_official_sources');
  assert.equal(plan.summary.collection_gap_competitors, 5);
  assert.equal(plan.summary.official_source_discovery_competitors, 1);
  assert.equal(plan.summary.failed_profile_runs_to_recover, 1);
  assert.deepEqual(plan.collection.monitoring_recovery, [{
    run_id: 'tiktok-profiles',
    platform: 'tiktok',
    registered_targets: 1,
    registered_competitors: ['TikTok Failed'],
    unattributed_targets: 0,
    reason: 'The recurring profile-monitoring run failed, so current viral tracking for its configured accounts is incomplete.',
    completion_evidence: 'A reviewed rerun completes inside the approved cap and reconciles every configured target or preserves an itemized failure.',
  }]);
  assert.ok(plan.quality.issues.some((issue) => issue.code === 'profile_collection_runs_failed'));
});

test('routes public-web candidates to registry review instead of fresh discovery', () => {
  const input = fixture();
  const candidates = input.source_candidates as {
    competitors: Array<Record<string, unknown>>;
  };
  candidates.competitors[0] = {
    competitor: 'Source Gap',
    review_state: 'candidate_sources_found',
    candidate_sources: [{
      platform: 'instagram',
      handle: 'sourcegap',
      url: 'https://www.instagram.com/sourcegap/',
      confidence: 'high',
    }],
  };
  const plan = buildCompetitorCoveragePlan(input);
  const task = plan.collection.tasks.find((row) => row.competitor === 'Source Gap');

  assert.equal(task?.task_type, 'review_source_candidates');
  assert.equal(task?.route, 'source_result_review');
  assert.deepEqual(task?.candidate_sources, [{
    platform: 'instagram',
    handle: 'sourcegap',
    url: 'https://www.instagram.com/sourcegap/',
    confidence: 'high',
  }]);
  assert.equal(plan.summary.source_candidate_review_competitors, 1);
  assert.equal(plan.summary.official_source_discovery_competitors, 0);
});

test('waves eligible analyses at the latest reviewed cycle size and preserves cost uncertainty', () => {
  const plan = buildCompetitorCoveragePlan(fixture());

  assert.equal(plan.analysis.planning_capacity_basis.items_per_wave, 2);
  assert.deepEqual(plan.analysis.waves.map((wave) => wave.candidates.length), [2, 1]);
  assert.deepEqual(
    plan.analysis.waves.flatMap((wave) => wave.candidates.map((candidate) => candidate.gap)),
    ['first_deep_analysis', 'expand_sample', 'expand_sample'],
  );
  assert.deepEqual(plan.analysis.waves.map((wave) => wave.estimated_cost_usd), [0.2, 0.1]);
  assert.deepEqual(plan.analysis.waves.map((wave) => wave.budget_fit), [true, true]);
  assert.equal(plan.provider_guardrails.apify.task_cost_estimates_available, false);
  assert.equal(plan.provider_guardrails.approval.external_calls_authorized_by_this_plan, false);
});

test('surfaces configured profile targets that do not reconcile to reviewed sources', () => {
  const plan = buildCompetitorCoveragePlan(fixture());

  assert.deepEqual(plan.collection.unattributed_configured_targets, [{
    platform: 'instagram',
    handle: 'unregistered',
    prior_runs: [{ run_id: 'instagram-profiles', state: 'succeeded' }],
    reason: 'Configured collection identity does not exactly match a reviewed source identity; ownership remains unproven.',
  }]);
  assert.ok(
    plan.quality.issues.some((issue) => issue.code === 'configured_targets_missing_from_source_registry'),
  );
});

test('fails closed on ineligible analyses, duplicate identities, and missing required sources', () => {
  const invalidAnalysis = fixture();
  const profiles = invalidAnalysis.profiles as {
    queues: { analysis: Array<Record<string, unknown>> };
  };
  profiles.queues.analysis[0].content_type = 'image_post';
  assert.throws(
    () => buildCompetitorCoveragePlan(invalidAnalysis),
    /not an eligible video/,
  );

  const duplicate = fixture();
  const duplicateProfiles = duplicate.profiles as { profiles: unknown[] };
  duplicateProfiles.profiles.push(duplicateProfiles.profiles[0]);
  assert.throws(
    () => buildCompetitorCoveragePlan(duplicate),
    /Duplicate profile competitor_id/,
  );

  const ambiguous = fixture();
  const ambiguousProfiles = ambiguous.profiles as {
    profiles: Array<{ known_socials: unknown[] }>;
  };
  ambiguousProfiles.profiles[2].known_socials = [
    {
      platform: 'instagram',
      handle: 'instagramempty',
      url: 'https://www.instagram.com/instagramempty/',
    },
  ];
  assert.throws(
    () => buildCompetitorCoveragePlan(ambiguous),
    /Ambiguous reviewed source identity/,
  );

  const ambiguousCandidate = fixture();
  const candidateReviews = ambiguousCandidate.source_candidates as {
    competitors: Array<Record<string, unknown>>;
  };
  candidateReviews.competitors[0] = {
    competitor: 'Source Gap',
    review_state: 'candidate_sources_found',
    candidate_sources: [{
      platform: 'instagram',
      handle: 'observed',
      url: 'https://www.instagram.com/observed/',
      confidence: 'high',
    }],
  };
  assert.throws(
    () => buildCompetitorCoveragePlan(ambiguousCandidate),
    /Ambiguous source candidate identity/,
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-plan-'));
  assert.throws(
    () => loadCompetitorCoveragePlanInputs({ root }),
    /Required coverage-plan source is missing/,
  );
});

test('derives deterministic generated_at from the freshest source', () => {
  const input = fixture();
  delete input.generated_at;
  const report = input.discovery_report as Record<string, unknown>;
  report.created_at = '2026-07-18T01:00:00.000Z';
  const plan = buildCompetitorCoveragePlan(input);

  assert.equal(plan.generated_at, '2026-07-18T01:00:00.000Z');
});
