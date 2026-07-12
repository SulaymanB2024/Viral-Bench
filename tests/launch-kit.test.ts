import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  loadCreativeJobManifest,
  scanRepositoryForSecrets,
} from '../packages/creative/job_schema';

const REQUIRED_LAUNCH_JOBS = [
  'worthscan_bike_commuter_001',
  'worthscan_scooter_battery_001',
  'worthscan_minifridge_001',
];

const LAUNCH_KIT_DOCS = [
  '.ops/accounts/account_setup_checklist.md',
  '.ops/accounts/account_readiness.json',
  '.ops/accounts/socials.md',
  '.ops/accounts/handle_ideas.md',
  '.ops/accounts/profile_copy.md',
  '.ops/accounts/launch_checklist.md',
  '.ops/launch/dm_response_templates.md',
  '.ops/launch/first_10_posts.md',
  '.ops/launch/launch_calendar.md',
  '.ops/launch/pinned_comment_templates.md',
  '.ops/launch/launch_queue.md',
  '.ops/launch/manual_launch_packet.md',
  '.ops/launch/metrics_tracking_template.md',
  '.ops/launch/posting_qa_checklist.md',
  '.ops/launch/codex_launch_control.md',
];

const FORBIDDEN_DOC_PATTERNS = [
  {
    name: 'saved browser-state reference',
    pattern: /\b(?:session|sessions|cookie|cookies)\b/i,
  },
  {
    name: 'credential-like value assignment',
    pattern: /\b(?:password|passcode|2fa code|recovery code|verification code|api key|access token|refresh token|secret)\s*[:=]\s*\S+/i,
  },
  {
    name: 'platform credential field',
    pattern: /\b(?:tiktok|instagram|youtube).{0,40}\b(?:password|passcode|2fa code|recovery code|verification code|access token|refresh token|secret)\s*[:=]/i,
  },
];

function readDoc(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function launchSection(queue: string, jobId: string): string {
  const heading = new RegExp(`^## \\d+\\. \`${escapeRegExp(jobId)}\`$`, 'm');
  const match = heading.exec(queue);
  assert.ok(match, `missing launch section for ${jobId}`);

  const start = match.index;
  const afterHeading = start + match[0].length;
  const next = /\n## \d+\. `/.exec(queue.slice(afterHeading));
  return queue.slice(start, next ? afterHeading + next.index : queue.length);
}

test('manual launch kit docs exist and cover requested account assets', () => {
  for (const relativePath of LAUNCH_KIT_DOCS) {
    assert.ok(fs.existsSync(path.join(process.cwd(), relativePath)), `${relativePath} missing`);
  }

  const accountSetup = readDoc('.ops/accounts/account_setup_checklist.md');
  assert.match(accountSetup, /TikTok Setup Checklist/);
  assert.match(accountSetup, /Instagram Professional Account Setup Checklist/);
  assert.match(accountSetup, /YouTube Shorts Brand Channel Setup Checklist/);
  assert.match(accountSetup, /2FA And Password-Manager Checklist/);
  assert.match(accountSetup, /Account Recovery Checklist/);
  assert.match(accountSetup, /Manual Posting Checklist/);

  const profileCopy = readDoc('.ops/accounts/profile_copy.md');
  assert.match(profileCopy, /Final Bio Options/);
  assert.match(profileCopy, /Profile Image Prompt/);
  assert.match(profileCopy, /Banner Prompt/);
  assert.match(profileCopy, /Link-In-Bio Copy/);

  assert.match(readDoc('.ops/accounts/handle_ideas.md'), /WorthScan Final Handle Shortlist/);
  assert.match(readDoc('.ops/launch/pinned_comment_templates.md'), /Pinned Comment Templates/);
  assert.match(readDoc('.ops/launch/dm_response_templates.md'), /First DM Response Templates/);
});

test('package scripts expose WorthScan operations and Codex harness without legacy agent entrypoints', () => {
  const packageJson = JSON.parse(readDoc('package.json')) as { scripts: Record<string, string> };

  assert.equal(packageJson.scripts['legacy:auth'], undefined);
  assert.equal(packageJson.scripts['legacy:start'], undefined);
  assert.equal(packageJson.scripts.harness, 'tsx src/codex-harness.ts');
  assert.equal(packageJson.scripts['metrics:add-snapshot'], 'tsx src/post-metrics.ts add-snapshot');
  assert.equal(packageJson.scripts.creative, 'tsx packages/creative/cli.ts');
});

test('account and launch docs do not contain secrets or platform access values', () => {
  const findings = scanRepositoryForSecrets(process.cwd())
    .filter((finding) => LAUNCH_KIT_DOCS.includes(finding.file));
  assert.deepEqual(findings, []);

  for (const relativePath of LAUNCH_KIT_DOCS) {
    const lines = readDoc(relativePath).split('\n');
    lines.forEach((line, index) => {
      for (const rule of FORBIDDEN_DOC_PATTERNS) {
        assert.doesNotMatch(line, rule.pattern, `${relativePath}:${index + 1} ${rule.name}`);
      }
    });
  }
});

test('launch queue references valid rendered WorthScan jobs', () => {
  const queue = readDoc('.ops/launch/launch_queue.md');

  for (const jobId of REQUIRED_LAUNCH_JOBS) {
    assert.ok(queue.includes(`\`${jobId}\``), `${jobId} missing from launch queue`);
    const manifestPath = path.join(process.cwd(), '.ops', 'creative_jobs', 'rendered', jobId, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), `${jobId} rendered manifest missing`);
    const manifest = loadCreativeJobManifest(manifestPath);
    assert.equal(manifest.job_id, jobId);
    assert.equal(manifest.provider_policy.allow_social_publishing, true);
    assert.equal(manifest.provider_policy.account_automation_allowed, false);
  }
});

test('each launch queue item has platform copy, posting checklist, and metrics plan', () => {
  const queue = readDoc('.ops/launch/launch_queue.md');
  const requiredFields = [
    'Platform-specific caption:',
    'TikTok caption:',
    'Instagram caption:',
    'YouTube Shorts title:',
    'YouTube Shorts description:',
    'Hashtags:',
    'First comment:',
    'Posting checklist:',
    'Metric snapshot schedule:',
  ];
  const requiredMetricMarkers = ['1-hour:', '24-hour:', '72-hour:', '7-day:'];

  for (const jobId of REQUIRED_LAUNCH_JOBS) {
    const section = launchSection(queue, jobId);
    for (const field of requiredFields) {
      assert.ok(section.includes(field), `${jobId} missing ${field}`);
    }
    for (const marker of requiredMetricMarkers) {
      assert.ok(section.includes(marker), `${jobId} missing ${marker}`);
    }
  }
});

test('manual launch packet runs from account setup to first metrics entry', () => {
  const packet = readDoc('.ops/launch/manual_launch_packet.md');
  const metricsTemplate = readDoc('.ops/launch/metrics_tracking_template.md');

  assert.match(packet, /Create Accounts Manually/);
  assert.match(packet, /Confirm First Rendered Packages/);
  assert.match(packet, /Review First Launch Item/);
  assert.match(packet, /Post Manually/);
  assert.match(packet, /Create First Metric Record/);
  assert.match(packet, /Add 1-Hour Metric Snapshot/);
  assert.match(packet, /npm run metrics:create-post/);
  assert.match(packet, /npm run metrics:add-snapshot/);
  assert.match(metricsTemplate, /--likes/);
  assert.match(metricsTemplate, /--profile-visits/);
  assert.match(metricsTemplate, /1-hour, 24-hour, 72-hour, and 7-day/);
});
