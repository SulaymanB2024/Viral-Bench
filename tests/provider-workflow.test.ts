import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  createProviderRequestManifest,
  loadProviderRequestManifest,
  runProviderDryRun,
  validateProviderRequestManifest,
  writeProviderOutput,
} from '../src/provider-workflow';

const SAMPLE_GEMINI_IMAGE_REQUEST = path.join(
  process.cwd(),
  '.ops',
  'provider_requests',
  'sample_gemini_image_request.json',
);
const SAMPLE_BROWSER_REQUEST = path.join(
  process.cwd(),
  '.ops',
  'provider_requests',
  'sample_browser_manual_request.json',
);

test('provider request validates', () => {
  const request = loadProviderRequestManifest(SAMPLE_GEMINI_IMAGE_REQUEST);

  assert.equal(request.request_id, 'sample-gemini-image-request');
  assert.equal(request.provider, 'gemini_image');
  assert.equal(request.provider_mode, 'dry_run');
  assert.equal(request.status, 'draft');
});

test('paid provider request is blocked by default', () => {
  const request = loadProviderRequestManifest(SAMPLE_GEMINI_IMAGE_REQUEST);

  const result = runProviderDryRun(request, { env: {} });

  assert.equal(result.status, 'blocked');
  assert.match(result.log.join('\n'), /ALLOW_PAID_GENERATION=true/);
});

test('browser provider request is blocked by default', () => {
  const request = loadProviderRequestManifest(SAMPLE_BROWSER_REQUEST);

  const result = runProviderDryRun(request, { env: {} });

  assert.equal(result.status, 'blocked');
  assert.match(result.log.join('\n'), /ALLOW_BROWSER_UI=true/);
});

test('dry run writes no external calls', () => {
  const request = loadProviderRequestManifest(SAMPLE_GEMINI_IMAGE_REQUEST);

  const result = runProviderDryRun(request, { env: { ALLOW_PAID_GENERATION: 'true' } });

  assert.equal(result.external_calls_made, 0);
  assert.equal(result.status, 'skipped');
  assert.match(result.log.join('\n'), /dry run/i);
});

test('dry run produces a clear blocked or skipped log', () => {
  const paidRequest = loadProviderRequestManifest(SAMPLE_GEMINI_IMAGE_REQUEST);
  const browserRequest = loadProviderRequestManifest(SAMPLE_BROWSER_REQUEST);

  const blocked = runProviderDryRun(browserRequest, { env: {} });
  const skipped = runProviderDryRun(paidRequest, { env: { ALLOW_PAID_GENERATION: 'true' } });

  assert.match(blocked.log.join('\n'), /blocked/i);
  assert.match(skipped.log.join('\n'), /skipped/i);
});

test('provider outputs cannot overwrite existing approved package files without explicit overwrite flag', () => {
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-provider-output-'));
  const approvedPath = path.join(packageDir, 'output', 'approved.txt');
  fs.mkdirSync(path.dirname(approvedPath), { recursive: true });
  fs.writeFileSync(approvedPath, 'approved output');

  const request = createProviderRequestManifest({
    request_id: 'local-output-test',
    provider: 'local_renderer',
    job_id: 'scan_bike_001',
    prompt_path: '.ops/prompts/post_package/qa_review.md',
    output_requirements: {
      package_subdir: 'output',
      files: [{ path: 'approved.txt', kind: 'qa', description: 'QA note' }],
      notes: ['Write a deterministic QA note.'],
    },
  });

  assert.throws(
    () => writeProviderOutput(request, packageDir, {
      relativePath: 'output/approved.txt',
      content: 'replacement',
    }),
    /Refusing to overwrite/,
  );

  assert.doesNotThrow(() => writeProviderOutput(request, packageDir, {
    relativePath: 'output/approved.txt',
    content: 'replacement',
    overwrite: true,
  }));
  assert.equal(fs.readFileSync(approvedPath, 'utf8'), 'replacement');
});

test('provider request creation fills dry-run defaults', () => {
  const request = createProviderRequestManifest({
    request_id: 'sample-openai-image-request',
    provider: 'openai_image',
    job_id: 'scan_bike_001',
    prompt_path: '.ops/prompts/openai/image_generation.md',
    output_requirements: {
      package_subdir: 'provider_outputs/openai_image',
      files: [{ path: 'image_plan.md', kind: 'image', description: 'Image generation plan' }],
      notes: ['Use approved source assets only.'],
    },
  });

  const validated = validateProviderRequestManifest(request);

  assert.equal(validated.provider_mode, 'dry_run');
  assert.equal(validated.approval_required, true);
  assert.equal(validated.cost_policy.allow_paid_generation, false);
  assert.equal(validated.status, 'draft');
});
