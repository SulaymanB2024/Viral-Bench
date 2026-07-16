import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  createProviderRequestManifest,
  loadProviderRequestManifest,
  runProviderDryRun,
  runProviderLive,
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

test('live provider run blocks before external calls unless gates and credentials are present', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-provider-live-blocked-'));
  const packageDir = path.join(rootDir, '.ops', 'creative_jobs', 'rendered', 'scan_bike_001');
  fs.mkdirSync(path.join(rootDir, '.ops', 'prompts', 'openai'), { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.ops', 'prompts', 'openai', 'image_generation.md'), 'Generate one product image.\n');
  const request = createProviderRequestManifest({
    request_id: 'blocked-live-openai',
    provider: 'openai_image',
    provider_mode: 'generation',
    job_id: 'scan_bike_001',
    prompt_path: '.ops/prompts/openai/image_generation.md',
    output_requirements: {
      package_subdir: 'provider_outputs/openai_image',
      files: [
        { path: 'generated.png', kind: 'image', description: 'Generated image' },
        { path: 'openai_image_run.json', kind: 'manifest', description: 'Run report' },
      ],
      notes: ['Live test request.'],
    },
    cost_policy: {
      allow_paid_generation: true,
      external_calls_allowed: true,
      max_cost_usd: 1,
    },
  });
  let fetchCalls = 0;

  const result = await runProviderLive(request, {
    rootDir,
    packageDir,
    env: {},
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('{}');
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.external_calls_made, 0);
  assert.equal(fetchCalls, 0);
  assert.match(result.log.join('\n'), /ALLOW_PAID_GENERATION=true|OPENAI_API_KEY/);
});

test('openai live provider run writes declared files without serializing secrets or image b64', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-provider-live-openai-'));
  const packageDir = path.join(rootDir, '.ops', 'creative_jobs', 'rendered', 'scan_bike_001');
  fs.mkdirSync(path.join(rootDir, '.ops', 'prompts', 'openai'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.ops', 'creative_jobs', 'rendered', 'scan_bike_001'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.ops', 'creative_jobs', 'incoming'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'inputs'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.ops', 'prompts', 'openai', 'image_generation.md'), 'OpenAI live fixture prompt.\n');
  fs.writeFileSync(path.join(rootDir, 'inputs', 'manifest.json'), JSON.stringify({ job_id: 'scan_bike_001', slide: 'fixture' }));
  const job = JSON.parse(fs.readFileSync(path.resolve('.ops/creative_jobs/incoming/scan_bike_001.json'), 'utf8')) as Record<string, unknown>;
  const providerPolicy = job.provider_policy as Record<string, unknown>;
  providerPolicy.approved_providers = ['local_renderer', 'openai_image'];
  providerPolicy.allow_paid_generation = true;
  fs.writeFileSync(path.join(rootDir, '.ops', 'creative_jobs', 'incoming', 'scan_bike_001.json'), `${JSON.stringify(job, null, 2)}\n`);
  const imageBytes = Buffer.from('fake image bytes');
  const b64 = imageBytes.toString('base64');
  const request = createProviderRequestManifest({
    request_id: 'live-openai-success',
    provider: 'openai_image',
    provider_mode: 'generation',
    job_id: 'scan_bike_001',
    prompt_path: '.ops/prompts/openai/image_generation.md',
    input_assets: ['inputs/manifest.json'],
    output_requirements: {
      package_subdir: 'provider_outputs/openai_image',
      files: [
        { path: 'generated.png', kind: 'image', description: 'Generated image' },
        { path: 'openai_image_run.json', kind: 'manifest', description: 'Run report' },
      ],
      notes: ['Live test request.'],
    },
    cost_policy: {
      allow_paid_generation: true,
      external_calls_allowed: true,
      max_cost_usd: 1,
    },
  });
  let capturedBody: Record<string, unknown> | null = null;
  let capturedAuthorization = '';

  const result = await runProviderLive(request, {
    rootDir,
    packageDir,
    env: {
      ALLOW_PAID_GENERATION: 'true',
      OPENAI_API_KEY: 'secret-value-for-test',
    },
    fetchImpl: async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      capturedAuthorization = headers.Authorization;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({
        created: 123,
        data: [{
          b64_json: b64,
          output_format: 'png',
          quality: 'medium',
          size: '1024x1536',
          revised_prompt: 'Fixture revised prompt',
        }],
        usage: { total_tokens: 42 },
      }), { status: 200 });
    },
  });
  const serialized = JSON.stringify(result);
  const imagePath = path.join(packageDir, 'provider_outputs', 'openai_image', 'generated.png');
  const reportPath = path.join(packageDir, 'provider_outputs', 'openai_image', 'openai_image_run.json');
  const reportText = fs.readFileSync(reportPath, 'utf8');
  assert.ok(capturedBody);
  const requestBody = capturedBody as Record<string, unknown>;

  assert.equal(capturedAuthorization, 'Bearer secret-value-for-test');
  assert.match(String(requestBody.prompt), /OpenAI live fixture prompt/);
  assert.match(String(requestBody.prompt), /scan_bike_001/);
  assert.equal(result.status, 'completed');
  assert.equal(result.external_calls_made, 1);
  assert.deepEqual(fs.readFileSync(imagePath), imageBytes);
  assert.ok(result.files_written.includes('provider_outputs/openai_image/generated.png'));
  assert.ok(result.files_written.includes('provider_outputs/openai_image/openai_image_run.json'));
  assert.doesNotMatch(serialized, /secret-value-for-test/);
  assert.doesNotMatch(serialized, new RegExp(b64));
  assert.doesNotMatch(reportText, /secret-value-for-test/);
  assert.doesNotMatch(reportText, new RegExp(b64));
});
