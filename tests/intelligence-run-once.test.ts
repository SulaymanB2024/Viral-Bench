import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  createProviderSpendLedger,
  reserveProviderCall,
  settleProviderCall,
} from '../src/intelligence-run-once';
import {
  selectStaticCanary,
  selectVideoCanary,
} from '../src/mixed-media-canary';
import type { InternshipMediaManifest } from '../src/internship-media-prep';
import type { SelectionLedger } from '../src/internship-research-batch';
import type { ViralContentLibrary } from '../src/viral-content-library';

test('provider ledger reserves declared ceilings and fails closed by lane and total cap', () => {
  const ledger = createProviderSpendLedger('test-run', '2026-07-17T00:00:00Z');
  for (const [callId, lane, ceiling] of [
    ['social', 'social_discovery', 5],
    ['audience', 'audience_comment_research', 4],
    ['video', 'video_analysis', 7],
    ['static', 'static_analysis', 3],
    ['retry', 'analysis_retries', 2],
    ['metric', 'metric_rechecks', 2],
  ] as const) {
    reserveProviderCall(ledger, {
      callId,
      lane,
      provider: 'test',
      purpose: 'budget contract',
      declaredCeilingUsd: ceiling,
      now: '2026-07-17T00:00:00Z',
    });
  }
  assert.equal(ledger.conservative_spend_usd, 23);
  assert.equal(ledger.remaining_conservative_ceiling_usd, 2);
  assert.throws(() => reserveProviderCall(ledger, {
    callId: 'ordinary-reserve',
    lane: 'reserve',
    provider: 'test',
    purpose: 'not a failed call',
    declaredCeilingUsd: 1,
  }), /reserve may be used only/);
  assert.throws(() => reserveProviderCall(ledger, {
    callId: 'social-overflow',
    lane: 'social_discovery',
    provider: 'test',
    purpose: 'overflow',
    declaredCeilingUsd: 0.01,
  }), /exceed its allocation/);
  settleProviderCall(ledger, 'social', {
    status: 'succeeded',
    actualCostUsd: null,
    progressRecords: 10,
  });
  assert.equal(ledger.conservative_spend_usd, 23);
  assert.equal(ledger.actual_cost_complete, false);
});

test('video canary enforces eight items, balanced platforms, and one item per account', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viralbench-video-canary-'));
  const platforms = [
    'instagram', 'instagram', 'instagram',
    'tiktok', 'tiktok', 'tiktok',
    'youtube_shorts', 'youtube_shorts',
  ];
  const rows = platforms.map((platform, index) => {
    const mediaPath = path.join(root, `${index}.mp4`);
    fs.writeFileSync(mediaPath, 'video');
    return {
      candidate_id: `candidate-${index}`,
      platform,
      platform_post_id: `post-${index}`,
      canonical_url: `https://example.test/${index}`,
      media_kind: 'downloaded_public_video',
      media_path: mediaPath,
      duration_sec: 30,
      retrieval_state: 'ready',
      limitation: null,
    };
  });
  const manifest = {
    schema_version: 1,
    batch_id: 'batch',
    generated_at: '2026-07-17T00:00:00Z',
    rows,
  } as unknown as InternshipMediaManifest;
  const selection = {
    schema_version: 1,
    batch_id: 'batch',
    entries: rows.map((row, index) => ({
      candidate_id: row.candidate_id,
      selected: true,
      account_handle: `account-${index}`,
      canonical_url: row.canonical_url,
      platform: row.platform,
      platform_post_id: row.platform_post_id,
      cohort: index % 2 ? 'recent' : 'popular',
      normalized_performance_score: 0.8,
    })),
  } as unknown as SelectionLedger;
  const selected = selectVideoCanary(manifest, selection, [], root);
  assert.equal(selected.length, 8);
  assert.deepEqual(
    Object.fromEntries([...new Set(platforms)].map((platform) => [
      platform,
      selected.filter((item) => item.platform === platform).length,
    ])),
    { instagram: 3, tiktok: 3, youtube_shorts: 2 },
  );
  assert.equal(new Set(selected.map((item) => item.account_handle)).size, 8);
});

test('static canary selects three carousels and three images across topics and accounts', () => {
  const contentTypes = [
    'carousel_post', 'carousel_post', 'carousel_post',
    'image_post', 'image_post', 'image_post',
  ] as const;
  const captions = [
    'internship pay and housing',
    'interview preparation',
    'resume application',
    'job scam rights',
    'networking linkedin',
    'early career uncertainty',
  ];
  const items = contentTypes.map((contentType, index) => ({
    item_id: `item-${index}`,
    platform: 'instagram',
    content_type: contentType,
    platform_post_id: `POST${index}`,
    canonical_url: `https://www.instagram.com/p/POST${index}/`,
    account_handle: `account-${index}`,
    caption: captions[index],
    hashtags: [],
    posted_at: null,
    first_seen_at: '2026-07-17T00:00:00Z',
    last_seen_at: '2026-07-17T00:00:00Z',
    observation_count: 1,
    observations: [],
    provenance: {
      source_reports: ['source'],
      source_runs: ['run'],
      discovery_modes: ['search'],
      source_queries: ['internship'],
    },
    performance: {
      age_bucket: '4_30_days',
      latest_views: null,
      latest_public_interactions: 10,
      latest_engagement_rate: null,
      lifetime_views_per_hour: null,
      observed_view_velocity_per_hour: null,
      observed_interaction_velocity_per_hour: null,
      observation_window_hours: null,
      latest_interaction_metric_coverage: 1,
      comparison_metric: 'public_interactions',
      comparison_percentile: 0.9 - index * 0.05,
      comparison_group_size: 6,
      signal: 'high_performer',
      confidence: 'medium',
      evidence_limitations: [],
    },
  }));
  const library = {
    schema_version: 2,
    generated_at: '2026-07-17T00:00:00Z',
    items,
  } as unknown as ViralContentLibrary;
  const discovery = {
    runs: [{
      items: items.map((item, index) => ({
        url: item.canonical_url,
        displayUrl: `https://images.example.test/${index}.jpg`,
        childPosts: item.content_type === 'carousel_post'
          ? Array.from({ length: 8 }, (_, slide) => ({ displayUrl: `https://images.example.test/${index}-${slide}.jpg` }))
          : [],
      })),
    }],
  };
  const selected = selectStaticCanary(library, [discovery]);
  assert.equal(selected.length, 6);
  assert.equal(selected.filter((item) => item.content_type === 'carousel_post').length, 3);
  assert.equal(selected.filter((item) => item.content_type === 'image_post').length, 3);
  assert.ok(selected.filter((item) => item.content_type === 'carousel_post').every((item) => item.image_urls.length <= 5));
  assert.ok(new Set(selected.map((item) => item.topic)).size >= 3);
  assert.ok(new Set(selected.map((item) => item.account_handle)).size >= 4);
});
