import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInstagramRecheckConfig,
  buildViralContentLibrary,
} from '../src/viral-content-library';

function writeReport(
  root: string,
  name: string,
  createdAt: string,
  items: unknown[],
  runId = 'instagram-recent-hashtag-search',
): string {
  const target = path.join(root, name);
  fs.writeFileSync(target, JSON.stringify({
    research_id: name.replace('.json', ''),
    created_at: createdAt,
    totals: { actual_cost_usd_reported: 0.25 },
    runs: [{
      id: runId,
      actor_id: 'apify/instagram-hashtag-scraper',
      input_mode: 'hashtag',
      items,
    }],
  }));
  return target;
}

function reel(id: string, views: number, timestamp = '2026-07-16T12:00:00.000Z') {
  return {
    url: `https://www.instagram.com/reel/${id}/`,
    type: 'Video',
    caption: `Internship proof tip ${id} #internship #careeradvice`,
    timestamp,
    ownerUsername: `creator_${id}`,
    videoViewCount: views,
    likesCount: Math.round(views * 0.1),
    commentsCount: Math.round(views * 0.01),
    shares: Math.round(views * 0.02),
  };
}

function feedPost(
  id: string,
  likes: number,
  type: 'Image' | 'Sidecar',
  timestamp = '2026-07-16T12:00:00.000Z',
  completeInteractions = true,
) {
  return {
    url: `https://www.instagram.com/p/${id}/`,
    type,
    productType: type === 'Sidecar' ? 'carousel_container' : 'feed',
    caption: `Internship feed tip ${id} #internship #careeradvice`,
    timestamp,
    ownerUsername: `creator_${id}`,
    likesCount: likes,
    commentsCount: Math.round(likes * 0.1),
    ...(completeInteractions ? {
      shares: Math.round(likes * 0.05),
      saves: Math.round(likes * 0.02),
    } : {}),
  };
}

test('builds a time-dated, deduplicated library with observed velocity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-content-library-'));
  const first = writeReport(root, 'first.json', '2026-07-17T12:00:00.000Z', [
    reel('TOP123', 1_000),
    reel('MID123', 600),
    reel('LOW123', 400),
    reel('LOW456', 300),
    reel('LOW789', 100),
  ]);
  const second = writeReport(root, 'second.json', '2026-07-18T12:00:00.000Z', [
    reel('TOP123', 3_000),
  ], 'instagram-popular-keyword-search');

  const library = buildViralContentLibrary({
    discoveryFiles: [first, second],
    sqlitePath: null,
    now: () => new Date('2026-07-18T12:00:00.000Z'),
  });

  assert.equal(library.summary.unique_items, 5);
  assert.equal(library.summary.observations, 6);
  assert.equal(library.summary.repeated_items, 1);
  assert.equal(library.sources.provider_cost_usd_reported, 0.5);
  const top = library.items.find((item) => item.platform_post_id === 'TOP123');
  assert.ok(top);
  assert.equal(top.observation_count, 2);
  assert.equal(top.performance.observed_view_velocity_per_hour, 83.333333);
  assert.equal(top.performance.comparison_percentile, 1);
  assert.equal(top.performance.signal, 'breakout_candidate');
  assert.deepEqual(top.provenance.discovery_modes, ['hashtag']);
  assert.deepEqual(top.provenance.source_runs, [
    'instagram-popular-keyword-search',
    'instagram-recent-hashtag-search',
  ]);
  assert.ok(top.performance.evidence_limitations.includes(
    'Observational ranking does not identify a causal content mechanism.',
  ));
});

test('merges duplicate routes at one capture without inventing repeat observations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-content-library-'));
  const target = path.join(root, 'overlap.json');
  fs.writeFileSync(target, JSON.stringify({
    research_id: 'overlap',
    created_at: '2026-07-17T12:00:00.000Z',
    runs: [
      {
        id: 'instagram-recent-hashtag-search',
        input_mode: 'hashtag',
        items: [reel('SAME123', 1_000)],
      },
      {
        id: 'instagram-popular-keyword-search',
        input_mode: 'search',
        items: [reel('SAME123', 1_000)],
      },
    ],
  }));

  const library = buildViralContentLibrary({
    discoveryFiles: [target],
    sqlitePath: null,
    now: () => new Date('2026-07-17T12:00:00.000Z'),
  });

  assert.equal(library.summary.unique_items, 1);
  assert.equal(library.summary.observations, 1);
  assert.equal(library.summary.repeated_items, 0);
  assert.deepEqual(library.items[0].observations[0].source_runs, [
    'instagram-popular-keyword-search',
    'instagram-recent-hashtag-search',
  ]);
  assert.deepEqual(library.items[0].observations[0].discovery_modes, ['hashtag', 'search']);
});

test('builds a bounded recent-Instagram temporal recheck config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-content-library-'));
  const report = writeReport(root, 'recent.json', '2026-07-17T12:00:00.000Z', [
    reel('ONE123', 2_000),
    reel('TWO123', 1_000),
  ]);
  const library = buildViralContentLibrary({
    discoveryFiles: [report],
    sqlitePath: null,
    now: () => new Date('2026-07-17T12:00:00.000Z'),
  });

  const config = buildInstagramRecheckConfig(library, {
    researchId: 'recheck-test',
    limit: 1,
    maxChargeUsd: 1.5,
  });

  assert.equal(config.max_total_charge_usd, 1.5);
  assert.equal(config.runs[0].max_items, 1);
  assert.equal(config.runs[0].input.directUrls.length, 1);
  assert.equal(config.runs[0].input.resultsLimit, 1);
  assert.throws(
    () => buildInstagramRecheckConfig(library, { maxChargeUsd: 10.01 }),
    /cannot exceed 10 USD/,
  );
});

test('retains Instagram images and carousels with content-type-safe interaction ranking', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-content-library-'));
  const report = writeReport(root, 'feed-posts.json', '2026-07-17T12:00:00.000Z', [
    ...[100, 90, 80, 70, 60].map((likes, index) => feedPost(`IMG${index}`, likes, 'Image')),
    ...[50, 40, 30, 20, 10].map((likes, index) => feedPost(`CAR${index}`, likes, 'Sidecar')),
  ], 'instagram-general-post-profile-feed');

  const library = buildViralContentLibrary({
    discoveryFiles: [report],
    sqlitePath: null,
    now: () => new Date('2026-07-17T12:00:00.000Z'),
  });

  assert.equal(library.schema_version, 2);
  assert.equal(library.scope.purpose, 'public_social_content_pattern_research');
  assert.deepEqual(library.summary.by_content_type, {
    carousel_post: 5,
    image_post: 5,
  });
  const topImage = library.items.find((item) => item.platform_post_id === 'IMG0');
  assert.ok(topImage);
  assert.equal(topImage.content_type, 'image_post');
  assert.equal(topImage.performance.latest_views, null);
  assert.equal(topImage.performance.latest_public_interactions, 117);
  assert.equal(topImage.performance.comparison_metric, 'public_interactions');
  assert.equal(topImage.performance.comparison_group_size, 5);
  assert.equal(topImage.performance.comparison_percentile, 1);
  assert.equal(topImage.performance.signal, 'breakout_candidate');
  assert.ok(topImage.performance.evidence_limitations.some((entry) => (
    entry.includes('no public view denominator')
  )));

  const config = buildInstagramRecheckConfig(library, {
    researchId: 'general-post-recheck-test',
    limit: 1,
    maxChargeUsd: 1,
  });
  assert.equal(config.runs[0].id, 'instagram-selected-posts-recheck');
  assert.equal(config.runs[0].input.directUrls.length, 1);
  assert.match(config.runs[0].input.directUrls[0], /instagram\.com\/p\//);
});

test('keeps missing interaction metrics unavailable instead of treating them as zero', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-content-library-'));
  const report = writeReport(root, 'incomplete-feed-post.json', '2026-07-17T12:00:00.000Z', [
    feedPost('MISSING1', 100, 'Image', '2026-07-16T12:00:00.000Z', false),
  ], 'instagram-general-post-profile-feed');

  const library = buildViralContentLibrary({
    discoveryFiles: [report],
    sqlitePath: null,
    now: () => new Date('2026-07-17T12:00:00.000Z'),
  });
  const item = library.items[0];

  assert.equal(item.performance.latest_public_interactions, null);
  assert.equal(item.performance.latest_engagement_rate, null);
  assert.equal(item.performance.latest_interaction_metric_coverage, 0.5);
  assert.equal(item.performance.comparison_metric, 'none');
  assert.equal(item.performance.signal, 'insufficient_data');
  assert.deepEqual(item.observations[0].interaction_metrics_missing, ['shares', 'saves']);
  assert.ok(item.performance.evidence_limitations.some((entry) => (
    entry.includes('missing shares, saves')
  )));
});

test('does not assign high confidence to repeat captures only five minutes apart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-content-library-'));
  const first = writeReport(root, 'short-window-first.json', '2026-07-17T12:00:00.000Z',
    Array.from({ length: 20 }, (_, index) => reel(`WINDOW${index}`, 1_000 + index)));
  const second = writeReport(root, 'short-window-second.json', '2026-07-17T12:05:00.000Z',
    Array.from({ length: 20 }, (_, index) => reel(`WINDOW${index}`, 1_100 + index)));

  const library = buildViralContentLibrary({
    discoveryFiles: [first, second],
    sqlitePath: null,
    now: () => new Date('2026-07-17T12:05:00.000Z'),
  });
  const item = library.items.find((entry) => entry.platform_post_id === 'WINDOW19');
  assert.ok(item);

  assert.equal(item.performance.observation_window_hours, 0.083333);
  assert.notEqual(item.performance.confidence, 'high');
  assert.ok(item.performance.evidence_limitations.some((entry) => (
    entry.includes('Repeated captures span only')
  )));
});
