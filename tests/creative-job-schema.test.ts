import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  type CreativeJobManifest,
  assertCanMoveCreativeJobStatus,
  loadCreativeJobManifest,
  scanRepositoryForSecrets,
  validateCreativeJobManifest,
} from '../packages/creative/job_schema';
import { runCreativeProvider } from '../packages/creative/provider_router';

const SAMPLE_JOB_PATH = path.join(
  process.cwd(),
  '.ops',
  'creative_jobs',
  'incoming',
  'scan_bike_001.json',
);

function sampleJob(): CreativeJobManifest {
  return loadCreativeJobManifest(SAMPLE_JOB_PATH);
}

function cloneJob(job: CreativeJobManifest): CreativeJobManifest {
  return JSON.parse(JSON.stringify(job)) as CreativeJobManifest;
}

test('creative job manifest validates', () => {
  const job = sampleJob();

  assert.equal(job.job_id, 'scan_bike_001');
  assert.equal(job.niche, 'used bikes and scooters resale valuation');
  assert.deepEqual(job.platform_targets, ['TikTok', 'Instagram Reels', 'YouTube Shorts']);
  assert.equal(job.output_requirements.slide_count, 5);
  assert.equal(job.output_requirements.slides.length, 5);
  assert.equal(job.provider_policy.account_automation_allowed, false);
});

test('paid generation blocks by default', async () => {
  const job = cloneJob(sampleJob());
  job.provider_policy.approved_providers = [
    ...job.provider_policy.approved_providers,
    'openai_image',
  ];
  job.provider_policy.allow_paid_generation = true;

  await assert.rejects(
    () => runCreativeProvider('openai_image', job, { env: {} }),
    /ALLOW_PAID_GENERATION=true/,
  );
});

test('browser UI workflow blocks by default', async () => {
  const job = cloneJob(sampleJob());
  job.provider_policy.allow_browser_ui = true;

  await assert.rejects(
    () => runCreativeProvider('browser_manual', job, { env: {} }),
    /ALLOW_BROWSER_UI=true/,
  );
});

test('social publishing blocks by default', () => {
  const job = cloneJob(sampleJob());
  job.provider_policy.allow_social_publishing = true;
  job.approval_status = {
    state: 'approved',
    human_reviewer: 'Human Operator',
    reviewed_at: '2026-07-06T17:00:00.000Z',
    notes: ['Approved for manual posting test.'],
  };

  assert.throws(
    () => assertCanMoveCreativeJobStatus(job, 'posted', {}),
    /ALLOW_SOCIAL_PUBLISHING=true/,
  );
});

test('account automation is rejected by manifest validation', () => {
  const job = cloneJob(sampleJob()) as unknown as Record<string, unknown>;
  const providerPolicy = job.provider_policy as Record<string, unknown>;
  providerPolicy.account_automation_allowed = true;

  assert.throws(
    () => validateCreativeJobManifest(job),
    /account_automation_allowed must be false/,
  );
});

test('generated assets require human approval before moving to posted', () => {
  const job = cloneJob(sampleJob());
  job.provider_policy.allow_social_publishing = true;
  job.generated_assets = [
    {
      provider: 'local_renderer',
      kind: 'slide',
      path: '.ops/creative_jobs/rendered/sample/output/slide_01.png',
      approved_for_posting: false,
    },
  ];

  assert.throws(
    () => assertCanMoveCreativeJobStatus(job, 'posted', { ALLOW_SOCIAL_PUBLISHING: 'true' }),
    /Human approval is required/,
  );
});

test('local renderer creates a review package without paid providers', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-creative-'));
  const result = await runCreativeProvider('local_renderer', sampleJob(), { outDir });

  assert.equal(result.status, 'rendered');
  assert.equal(result.render.slide_paths.length, 5);
  assert.equal(path.relative(outDir, result.render.rendered_manifest_path), 'manifest.json');
  assert.equal(path.relative(outDir, result.render.source_image_path), path.join('source', 'bike_001.jpg'));
  assert.equal(path.relative(outDir, result.render.listing_path), path.join('source', 'listing.txt'));
  assert.equal(path.relative(outDir, result.render.trend_examples_path), path.join('research', 'trend_examples.json'));
  assert.equal(path.relative(outDir, result.render.research_notes_path), path.join('research', 'notes.md'));
  assert.equal(path.relative(outDir, result.render.gemini_image_prompt_path), path.join('prompts', 'gemini_image_prompt.md'));
  assert.equal(path.relative(outDir, result.render.openai_image_prompt_path), path.join('prompts', 'openai_image_prompt.md'));
  assert.equal(path.relative(outDir, result.render.caption_prompt_path), path.join('prompts', 'caption_prompt.md'));
  assert.deepEqual(
    result.render.slide_paths.map((slidePath) => path.relative(outDir, slidePath)),
    [
      path.join('output', 'slide_01.png'),
      path.join('output', 'slide_02.png'),
      path.join('output', 'slide_03.png'),
      path.join('output', 'slide_04.png'),
      path.join('output', 'slide_05.png'),
    ],
  );
  assert.equal(path.relative(outDir, result.render.caption_path), path.join('output', 'caption.txt'));
  assert.equal(path.relative(outDir, result.render.hashtags_path), path.join('output', 'hashtags.txt'));
  assert.equal(path.relative(outDir, result.render.spoken_script_path), path.join('output', 'spoken_script.txt'));
  assert.equal(path.relative(outDir, result.render.posting_notes_path), path.join('output', 'posting_notes.md'));
  assert.equal(path.relative(outDir, result.render.qa_checklist_path), path.join('qa', 'checklist.md'));
  assert.equal(path.relative(outDir, result.render.approval_path), path.join('qa', 'approval.md'));
  assert.ok(fs.existsSync(result.render.caption_path));
  assert.ok(fs.existsSync(result.render.hashtags_path));
  assert.ok(fs.existsSync(result.render.spoken_script_path));
  assert.ok(fs.existsSync(result.render.posting_notes_path));
  assert.match(fs.readFileSync(result.render.posting_notes_path, 'utf8'), /Do not auto-post/);
  assert.match(fs.readFileSync(result.render.approval_path, 'utf8'), /Nothing moves to posted/);
});

test('no secrets are present in tracked files', () => {
  const findings = scanRepositoryForSecrets(process.cwd());

  assert.deepEqual(findings, []);
});
