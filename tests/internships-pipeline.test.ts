import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { loadCreativeJobManifest } from '../packages/creative/job_schema';
import { renderSlideSvg } from '../packages/creative/local_renderer';

const ROOT = process.cwd();
const JOB_PATH = path.join(
  ROOT,
  '.ops',
  'creative_jobs',
  'incoming',
  'internships_com_signal_stack_001.json',
);
const VIDEO_JOB_PATH = path.join(
  ROOT,
  '.ops',
  'creative_jobs',
  'incoming',
  'internships_com_proof_gap_002.json',
);

test('Internships.com TikTok job stays brand-isolated and review-gated', () => {
  const job = loadCreativeJobManifest(JOB_PATH);

  assert.equal(job.brand?.id, 'internships_com');
  assert.equal(job.brand?.display_name, 'Internships.com');
  assert.equal(job.brand?.account_handle, null);
  assert.deepEqual(job.platform_targets, ['TikTok']);
  assert.equal(job.output_requirements.house_style?.system, 'internships_signal_stack_v1');
  assert.equal(job.provider_policy.account_automation_allowed, false);
  assert.equal(job.approval_status.state, 'draft');
  assert.ok(job.generated_assets.every((asset) => asset.approved_for_posting === false));
  assert.match(job.output_requirements.caption, /you stay in control/i);
  assert.match(job.output_requirements.posting_notes.join(' '), /exact approval/i);
  assert.doesNotMatch(JSON.stringify(job), /WorthScan/);
});

test('Internships.com slides use the signal-stack system without WorthScan copy', () => {
  const job = loadCreativeJobManifest(JOB_PATH);
  const sourceDataUri = 'data:image/png;base64,AA==';

  for (const slide of job.output_requirements.slides) {
    const svg = renderSlideSvg(job, slide, sourceDataUri, false);
    assert.match(svg, /Internships\.com/);
    assert.match(svg, new RegExp(`data-proof-mode="${slide.visual_mode}"`));
    assert.doesNotMatch(svg, /WorthScan|guaranteed appraisal|Illustrative visual/);
  }

  const hero = renderSlideSvg(job, job.output_requirements.slides[0], sourceDataUri, false);
  assert.match(hero, /THE FOUR-SIGNAL CHECK/);
  assert.match(hero, /No internship, referral, interview, or response is guaranteed\./);
});

test('Internships.com account registry cannot identify or authorize a posting account yet', () => {
  const accountPath = path.join(ROOT, '.ops', 'accounts', 'internships_com_tiktok.json');
  const account = JSON.parse(fs.readFileSync(accountPath, 'utf8')) as Record<string, unknown>;
  const launchQueue = fs.readFileSync(
    path.join(ROOT, '.ops', 'launch', 'internships_com_tiktok_launch_queue.md'),
    'utf8',
  );

  assert.equal(account.brand_id, 'internships_com');
  assert.equal(account.public_handle, null);
  assert.equal(account.ownership_state, 'unverified');
  assert.equal(account.authorized_work_account_confirmed, false);
  assert.match(launchQueue, /never use a personal account/i);
  assert.match(launchQueue, /Approve the exact caption, video hash, destination handle, and visibility/i);
  assert.match(launchQueue, /Publish manually/i);
});

test('research-derived Internships.com video stays original and review-gated', () => {
  const job = loadCreativeJobManifest(VIDEO_JOB_PATH);

  assert.equal(job.brand?.id, 'internships_com');
  assert.equal(job.output_mode, 'video');
  assert.equal(job.video_requirements?.target_duration_sec, 16);
  assert.deepEqual(job.platform_targets, ['TikTok']);
  assert.equal(job.provider_policy.allow_paid_generation, true);
  assert.equal(job.provider_policy.allow_browser_ui, true);
  assert.equal(job.provider_policy.allow_social_publishing, false);
  assert.equal(job.provider_policy.account_automation_allowed, false);
  assert.equal(job.approval_status.state, 'draft');
  assert.deepEqual(job.generated_assets, []);
  assert.match(job.output_requirements.spoken_script, /don't invent it/i);
  assert.match(job.output_requirements.posting_notes.join(' '), /not approved for posting/i);
  assert.doesNotMatch(JSON.stringify(job), /guaranteed referral|100% WIN RATE|WorthScan/i);
});
