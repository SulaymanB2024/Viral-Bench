import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addMetricSnapshotToStore,
  comparePosts,
  createPostInStore,
  createPostedContentRecord,
  exportMetrics,
  summarizeTraction,
  type PostMetricsStore,
} from '../src/post-metrics';

function tractionPost(postId: string, variantId: string, postedAt: string) {
  return {
    post_id: postId,
    job_id: 'internships_com_signal_stack_001',
    platform: 'TikTok',
    account_handle: '@internships',
    posted_url: `https://example.com/${postId}`,
    posted_at: postedAt,
    content_type: 'slideshow',
    hook: `Hook for ${variantId}`,
    format: 'slideshow',
    CTA: 'Save this',
    experiment_id: 'signal-stack-experiment-001',
    variant_id: variantId,
    creative_lane: 'image_slideshow',
    delivery_mode: 'native_carousel',
    audio_mode: 'platform_commercial_music',
    duration_sec: 20,
    notes: [],
  };
}

test('legacy post records receive backward-compatible traction defaults', () => {
  const record = createPostedContentRecord({
    post_id: 'legacy-post',
    job_id: 'legacy-job',
    platform: 'TikTok',
    account_handle: '@legacy',
    posted_url: 'https://example.com/legacy-post',
    posted_at: '2026-07-16T00:00:00.000Z',
    content_type: 'slideshow',
    hook: 'Legacy hook',
    format: 'slideshow',
    CTA: 'Save this',
    notes: [],
  });

  assert.equal(record.experiment_id, null);
  assert.equal(record.creative_lane, null);
  assert.equal(record.duration_sec, null);
});

test('traction summaries calculate velocity and per-view quality rates', () => {
  let store: PostMetricsStore = createPostInStore(
    { records: [] },
    tractionPost('traction-post-a', 'variant-a', '2026-07-16T00:00:00.000Z'),
  );
  store = addMetricSnapshotToStore(store, 'traction-post-a', {
    captured_at: '2026-07-16T01:00:00.000Z',
    checkpoint: '1h',
    views: 100,
    likes: 10,
    comments: 1,
    shares: 2,
    saves: 4,
    follows: 1,
    profile_visits: 5,
    dms: null,
    average_watch_time_sec: 7.5,
    completion_rate: 0.35,
    rewatch_rate: null,
    notes: [],
  });
  store = addMetricSnapshotToStore(store, 'traction-post-a', {
    captured_at: '2026-07-17T00:00:00.000Z',
    checkpoint: '24h',
    views: 1200,
    likes: 150,
    comments: 20,
    shares: 36,
    saves: 96,
    follows: 12,
    profile_visits: 60,
    dms: null,
    average_watch_time_sec: 8.4,
    completion_rate: 0.42,
    rewatch_rate: 0.08,
    notes: [],
  });

  const summary = summarizeTraction(store.records[0]);
  assert.equal(summary.view_velocity, 47.826087);
  assert.equal(summary.share_rate, 0.03);
  assert.equal(summary.save_rate, 0.08);
  assert.equal(summary.follow_rate, 0.01);
  assert.equal(summary.profile_visit_rate, 0.05);
  assert.equal(summary.completion_rate, 0.42);
});

test('traction comparisons rank matched experiment variants by derived signals', () => {
  let store: PostMetricsStore = { records: [] };
  store = createPostInStore(store, tractionPost('traction-post-a', 'variant-a', '2026-07-16T00:00:00.000Z'));
  store = createPostInStore(store, tractionPost('traction-post-b', 'variant-b', '2026-07-16T00:00:00.000Z'));
  store = addMetricSnapshotToStore(store, 'traction-post-a', {
    captured_at: '2026-07-16T01:00:00.000Z', checkpoint: '1h', views: 100,
    likes: 10, comments: 1, shares: 2, saves: 5, follows: 1,
    profile_visits: 3, dms: null, average_watch_time_sec: 6, completion_rate: 0.3,
    rewatch_rate: null, notes: [],
  });
  store = addMetricSnapshotToStore(store, 'traction-post-b', {
    captured_at: '2026-07-16T01:00:00.000Z', checkpoint: '1h', views: 200,
    likes: 15, comments: 2, shares: 4, saves: 9, follows: 2,
    profile_visits: 6, dms: null, average_watch_time_sec: 7, completion_rate: 0.34,
    rewatch_rate: null, notes: [],
  });
  store = addMetricSnapshotToStore(store, 'traction-post-a', {
    captured_at: '2026-07-17T00:00:00.000Z', checkpoint: '24h', views: 1200,
    likes: 100, comments: 10, shares: 24, saves: 60, follows: 6,
    profile_visits: 30, dms: 0, average_watch_time_sec: 7, completion_rate: 0.35,
    rewatch_rate: 0.05, notes: [],
  });
  store = addMetricSnapshotToStore(store, 'traction-post-b', {
    captured_at: '2026-07-17T00:00:00.000Z', checkpoint: '24h', views: 2400,
    likes: 180, comments: 18, shares: 72, saves: 168, follows: 24,
    profile_visits: 96, dms: 0, average_watch_time_sec: 9, completion_rate: 0.48,
    rewatch_rate: 0.09, notes: [],
  });

  const velocity = comparePosts(store, {
    experiment_id: 'signal-stack-experiment-001',
    metric: 'view_velocity',
  });
  const saveRate = comparePosts(store, {
    experiment_id: 'signal-stack-experiment-001',
    metric: 'save_rate',
  });

  assert.equal(velocity[0].variant_id, 'variant-b');
  assert.equal(velocity[0].value, 95.652174);
  assert.equal(saveRate[0].variant_id, 'variant-b');
  assert.equal(saveRate[0].value, 0.07);
});

test('traction records reject incomplete experiment links and invalid rates', () => {
  assert.throws(
    () => createPostedContentRecord({
      ...tractionPost('broken-post', 'variant-a', '2026-07-16T00:00:00.000Z'),
      variant_id: null,
    }),
    /experiment_id and variant_id must be provided together/,
  );

  let store: PostMetricsStore = createPostInStore(
    { records: [] },
    tractionPost('rate-post', 'variant-a', '2026-07-16T00:00:00.000Z'),
  );
  assert.throws(
    () => addMetricSnapshotToStore(store, 'rate-post', {
      captured_at: '2026-07-17T00:00:00.000Z', checkpoint: '24h', views: 10,
      likes: 1, comments: 0, shares: 0, saves: 0, follows: 0,
      profile_visits: 0, dms: 0, average_watch_time_sec: 5,
      completion_rate: 1.2, rewatch_rate: 0, notes: [],
    }),
    /completion_rate must be from 0 to 1/,
  );
  assert.equal(store.records.length, 1);
});

test('omitted metrics remain unavailable and exports retain every snapshot', () => {
  let store: PostMetricsStore = createPostInStore(
    { records: [] },
    tractionPost('missingness-post', 'variant-a', '2026-07-16T00:00:00.000Z'),
  );
  store = addMetricSnapshotToStore(store, 'missingness-post', {
    captured_at: '2026-07-16T01:00:00.000Z',
    checkpoint: '1h',
    views: 100,
    notes: [],
  });
  store = addMetricSnapshotToStore(store, 'missingness-post', {
    captured_at: '2026-07-17T00:00:00.000Z',
    checkpoint: '24h',
    views: 1_000,
    notes: [],
  });

  const latest = store.records[0].metric_snapshots[1];
  assert.equal(latest.shares, null);
  assert.equal(latest.measurement_states.shares, 'not_available');
  assert.equal(summarizeTraction(store.records[0]).share_rate, null);
  const csv = exportMetrics(store, 'csv');
  assert.equal(csv.trim().split('\n').length, 3);
  assert.match(csv, /not_available/);
});

test('snapshot identity and cumulative counters are append-only', () => {
  let store: PostMetricsStore = createPostInStore(
    { records: [] },
    tractionPost('append-only-post', 'variant-a', '2026-07-16T00:00:00.000Z'),
  );
  store = addMetricSnapshotToStore(store, 'append-only-post', {
    captured_at: '2026-07-16T01:00:00.000Z',
    checkpoint: '1h',
    views: 100,
    notes: [],
  });
  assert.throws(() => addMetricSnapshotToStore(store, 'append-only-post', {
    captured_at: '2026-07-16T02:00:00.000Z',
    checkpoint: '1h',
    views: 120,
    notes: [],
  }), /checkpoint already exists/);
  assert.throws(() => addMetricSnapshotToStore(store, 'append-only-post', {
    captured_at: '2026-07-17T00:00:00.000Z',
    checkpoint: '24h',
    views: 99,
    notes: [],
  }), /views must be monotonic/);
});
