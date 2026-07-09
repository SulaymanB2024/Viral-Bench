import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  type CreativeJobManifest,
  assertCanMoveCreativeJobStatus,
  loadCreativeJobManifest,
} from '../packages/creative/job_schema';
import { runCreativeProvider } from '../packages/creative/provider_router';
import {
  addMetricSnapshotToStore,
  comparePosts,
  createPostInStore,
  createPostedContentRecord,
  exportMetrics,
  validatePostMetricsRecord,
  type PostMetricsStore,
} from '../src/post-metrics';
import {
  attachValuationCardToCreativeJob,
  generateValuationExplanationBlock,
  validateValuationCard,
  type ValuationCard,
} from '../src/valuation-card';

const INCOMING_DIR = path.join(process.cwd(), '.ops', 'creative_jobs', 'incoming');
const WORTHSCAN_JOB_PATHS = fs.readdirSync(INCOMING_DIR)
  .filter((file) => /^worthscan_.*\.json$/.test(file))
  .sort()
  .map((file) => path.join(INCOMING_DIR, file));

const REQUIRED_PACKAGE_FILES = [
  'manifest.json',
  path.join('source', 'bike_001.jpg'),
  path.join('source', 'listing.txt'),
  path.join('research', 'trend_examples.json'),
  path.join('research', 'notes.md'),
  path.join('prompts', 'gemini_image_prompt.md'),
  path.join('prompts', 'openai_image_prompt.md'),
  path.join('prompts', 'caption_prompt.md'),
  path.join('output', 'slide_01.png'),
  path.join('output', 'slide_02.png'),
  path.join('output', 'slide_03.png'),
  path.join('output', 'slide_04.png'),
  path.join('output', 'slide_05.png'),
  path.join('output', 'caption.txt'),
  path.join('output', 'hashtags.txt'),
  path.join('output', 'spoken_script.txt'),
  path.join('output', 'posting_notes.md'),
  path.join('qa', 'checklist.md'),
  path.join('qa', 'approval.md'),
];

function worthscanJobs(): CreativeJobManifest[] {
  return WORTHSCAN_JOB_PATHS.map(loadCreativeJobManifest);
}

function sampleValuationCard(overrides: Partial<ValuationCard> = {}): ValuationCard {
  return {
    item_type: 'used commuter bike',
    asking_price: 220,
    estimated_range_low: 160,
    estimated_range_high: 210,
    confidence: 'medium',
    value_drivers: [
      'Recognizable commuter frame brand',
      'Included lock and rear rack',
      'Three similar local listings cluster below asking price',
    ],
    risk_flags: [
      'Brake pads look worn',
      'Tuneup cost may reduce the fair offer',
    ],
    comps: [
      {
        label: 'Local comp A',
        source: 'manual marketplace note',
        price: 180,
        condition: 'similar commuter bike, fair condition',
      },
      {
        label: 'Local comp B',
        source: 'manual marketplace note',
        price: 205,
        condition: 'cleaner bike with rack',
      },
    ],
    verdict: 'Fair buy near the lower half of the range; negotiate above $210.',
    disclaimer: 'This is a resale estimate range, not a guarantee or official appraisal.',
    ...overrides,
  };
}

test('all 10 WorthScan creative jobs validate and stay draft-local', () => {
  const jobs = worthscanJobs();

  assert.equal(jobs.length, 10);
  for (const job of jobs) {
    assert.equal(job.approval_status.state, 'draft');
    assert.deepEqual(job.provider_policy.approved_providers, ['local_renderer']);
    assert.equal(job.provider_policy.allow_paid_generation, false);
    assert.equal(job.provider_policy.allow_browser_ui, false);
    assert.equal(job.provider_policy.allow_social_publishing, false);
    assert.equal(job.provider_policy.account_automation_allowed, false);
    assert.equal(job.output_requirements.slide_count, 5);
    assert.equal(job.output_requirements.slides.length, 5);
    assert.deepEqual(job.output_requirements.required_outputs, [
      'slides',
      'caption',
      'hashtags',
      'spoken_script',
      'posting_notes',
    ]);
  }
});

test('valuation cards validate and attach to creative jobs', () => {
  const card = validateValuationCard(sampleValuationCard());
  const explanation = generateValuationExplanationBlock(card);
  const job = worthscanJobs()[0];
  const withValuation = attachValuationCardToCreativeJob(job, card);

  assert.match(explanation, /Estimated range: \$160-\$210/);
  assert.equal(withValuation.source_inputs.length, job.source_inputs.length + 1);
  assert.match(withValuation.qa_notes.at(-1) ?? '', /Valuation card attached/);
});

test('unsupported exact valuation claims fail', () => {
  assert.throws(
    () => validateValuationCard(sampleValuationCard({
      estimated_range_low: 185,
      estimated_range_high: 185,
      confidence: 'medium',
      comps: [],
      verdict: 'This is worth exactly $185.',
    })),
    /Exact-value claims require high confidence/,
  );
});

test('rendered WorthScan packages contain required folders and files', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-worthscan-render-'));
  const jobs = worthscanJobs().slice(0, 3);

  for (const job of jobs) {
    const outDir = path.join(baseDir, job.job_id);
    const result = await runCreativeProvider('local_renderer', job, { outDir, env: {} });
    assert.equal(result.status, 'rendered');
    for (const relativeFile of REQUIRED_PACKAGE_FILES) {
      assert.ok(fs.existsSync(path.join(outDir, relativeFile)), `${job.job_id} missing ${relativeFile}`);
    }
    assert.match(
      fs.readFileSync(path.join(outDir, 'output', 'posting_notes.md'), 'utf8'),
      /Do not auto-post/,
    );
  }
});

test('metrics records validate', () => {
  const record = validatePostMetricsRecord({
    ...createPostedContentRecord({
      post_id: 'worthscan-post-001',
      job_id: 'worthscan_bike_commuter_001',
      platform: 'TikTok',
      account_handle: '@worthscan',
      posted_url: 'https://example.com/worthscan/post-001',
      posted_at: '2026-07-06T20:00:00.000Z',
      content_type: 'slideshow',
      hook: 'Scan this commuter bike before you pay',
      format: 'slideshow',
      CTA: 'Comment scan with the next listing',
      notes: ['manual post'],
    }),
    metric_snapshots: [
      {
        captured_at: '2026-07-07T20:00:00.000Z',
        views: 1200,
        likes: 140,
        comments: 14,
        shares: 22,
        saves: 80,
        follows: 6,
        profile_visits: 30,
        dms: 2,
        notes: ['24 hour read'],
      },
    ],
  });

  assert.equal(record.post_id, 'worthscan-post-001');
  assert.equal(record.metric_snapshots[0].saves, 80);
});

test('metric snapshots can be added', () => {
  const store: PostMetricsStore = createPostInStore({ records: [] }, {
    post_id: 'worthscan-post-002',
    job_id: 'worthscan_scooter_battery_001',
    platform: 'TikTok',
    account_handle: '@worthscan',
    posted_url: 'https://example.com/worthscan/post-002',
    posted_at: '2026-07-06T21:00:00.000Z',
    content_type: 'slideshow',
    hook: 'Scan this scooter before battery risk eats the deal',
    format: 'slideshow',
    CTA: 'Comment scan',
    notes: [],
  });
  const next = addMetricSnapshotToStore(store, 'worthscan-post-002', {
    captured_at: '2026-07-07T21:00:00.000Z',
    views: 900,
    likes: 88,
    comments: 11,
    shares: 15,
    saves: 70,
    follows: 5,
    profile_visits: 22,
    dms: 1,
    notes: ['24 hour read'],
  });

  assert.equal(next.records[0].metric_snapshots.length, 1);
  assert.equal(next.records[0].metric_snapshots[0].views, 900);
});

test('metrics compare ranks posts by selected metric', () => {
  let store: PostMetricsStore = { records: [] };
  store = createPostInStore(store, {
    post_id: 'worthscan-post-a',
    job_id: 'worthscan_bike_commuter_001',
    platform: 'TikTok',
    account_handle: '@worthscan',
    posted_url: 'https://example.com/worthscan/a',
    posted_at: '2026-07-06T20:00:00.000Z',
    content_type: 'slideshow',
    hook: 'Bike hook',
    format: 'slideshow',
    CTA: 'Comment scan',
    notes: [],
  });
  store = createPostInStore(store, {
    post_id: 'worthscan-post-b',
    job_id: 'worthscan_laptop_001',
    platform: 'TikTok',
    account_handle: '@worthscan',
    posted_url: 'https://example.com/worthscan/b',
    posted_at: '2026-07-06T22:00:00.000Z',
    content_type: 'slideshow',
    hook: 'Laptop hook',
    format: 'slideshow',
    CTA: 'Comment scan',
    notes: [],
  });
  store = addMetricSnapshotToStore(store, 'worthscan-post-a', {
    captured_at: '2026-07-07T20:00:00.000Z',
    views: 1000,
    likes: 90,
    comments: 8,
    shares: 12,
    saves: 45,
    follows: 3,
    profile_visits: 18,
    dms: 0,
    notes: [],
  });
  store = addMetricSnapshotToStore(store, 'worthscan-post-b', {
    captured_at: '2026-07-07T22:00:00.000Z',
    views: 800,
    likes: 84,
    comments: 12,
    shares: 10,
    saves: 90,
    follows: 4,
    profile_visits: 26,
    dms: 2,
    notes: [],
  });

  const comparison = comparePosts(store, { metric: 'saves' });
  const csv = exportMetrics(store, 'csv');

  assert.equal(comparison[0].post_id, 'worthscan-post-b');
  assert.equal(comparison[0].value, 90);
  assert.match(comparison[0].comparison_note, /Directional only/);
  assert.match(csv, /post_id,job_id,platform/);
  assert.match(csv, /profile_visits/);
});

test('no provider credentials are required for local WorthScan rendering', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-worthscan-no-creds-'));
  const job = worthscanJobs()[0];

  await assert.doesNotReject(() => runCreativeProvider('local_renderer', job, { outDir, env: {} }));
});

test('social publishing is not allowed by default for WorthScan jobs', () => {
  for (const job of worthscanJobs()) {
    assert.throws(
      () => assertCanMoveCreativeJobStatus(job, 'posted', { ALLOW_SOCIAL_PUBLISHING: 'true' }),
      /Social publishing is disabled/,
    );
  }
});
