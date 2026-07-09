import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  buildArtifactInventory,
  buildAutonomyAudit,
  buildAutonomyPlan,
  buildBlockerLedger,
  buildCapabilityEnvPlan,
  buildCapabilityPlan,
  buildContextPack,
  buildEvidenceMap,
  buildHarnessDoctor,
  buildInformationIndex,
  buildCapabilityProfile,
  buildJobReadinessMatrix,
  buildReproducibilityManifest,
  buildRepoStatus,
  exportSourcePackage,
  exportProviderHandoffPacket,
  findLatestHarnessRun,
  inspectHarness,
  listCodexPrimitives,
  prepareProviderInputs,
  preflightProviderRequests,
  rankIncomingJobs,
  resumeHarnessRun,
  runCodexAutonomy,
  runCodexHarness,
  stageSourceOfTruth,
  verifySourcePackage,
} from '../src/codex-harness';

const SCOOTER_JOB = path.join(
  process.cwd(),
  '.ops',
  'creative_jobs',
  'incoming',
  'worthscan_scooter_battery_001.json',
);

function createProviderFixtureRoot(): { rootDir: string; requestPath: string } {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-provider-fixture-'));
  const incomingDir = path.join(rootDir, '.ops', 'creative_jobs', 'incoming');
  const requestDir = path.join(rootDir, '.ops', 'provider_requests');
  const promptDir = path.join(rootDir, '.ops', 'prompts', 'openai');
  fs.mkdirSync(incomingDir, { recursive: true });
  fs.mkdirSync(requestDir, { recursive: true });
  fs.mkdirSync(promptDir, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), '.ops', 'creative_jobs', 'incoming', 'scan_bike_001.json'),
    path.join(incomingDir, 'scan_bike_001.json'),
  );
  fs.copyFileSync(
    path.join(process.cwd(), '.ops', 'provider_requests', 'sample_openai_image_request.json'),
    path.join(requestDir, 'sample_openai_image_request.json'),
  );
  fs.writeFileSync(
    path.join(promptDir, 'image_generation.md'),
    '# OpenAI image generation fixture\n',
  );

  return {
    rootDir,
    requestPath: path.join(requestDir, 'sample_openai_image_request.json'),
  };
}

test('capability profile exposes availability flags without secret values', () => {
  const profile = buildCapabilityProfile({
    ALLOW_PAID_GENERATION: 'true',
    OPENAI_API_KEY: 'present-for-test',
    GEMINI_API_KEY: '',
  });
  const serialized = JSON.stringify(profile);

  assert.equal(profile.autonomy_level, 'provider_enabled');
  assert.equal(profile.gates.allow_paid_generation, true);
  assert.equal(profile.credentials.openai_api_key_available, true);
  assert.equal(profile.credentials.gemini_api_key_available, false);
  assert.doesNotMatch(serialized, /present-for-test/);
  assert.equal(profile.credential_policy, 'available_flags_only_no_secret_values');
});

test('primitive menu gives Codex callable autonomous harness commands', () => {
  const primitives = listCodexPrimitives();
  const ids = primitives.map((primitive) => primitive.id);

  assert.ok(ids.includes('harness.auto'));
  assert.ok(ids.includes('harness.doctor'));
  assert.ok(ids.includes('harness.repo_status'));
  assert.ok(ids.includes('harness.capability_plan'));
  assert.ok(ids.includes('harness.capability_env'));
  assert.ok(ids.includes('harness.reproducibility_manifest'));
  assert.ok(ids.includes('harness.stage_source'));
  assert.ok(ids.includes('harness.source_package'));
  assert.ok(ids.includes('harness.verify_source_package'));
  assert.ok(ids.includes('harness.autonomy_audit'));
  assert.ok(ids.includes('harness.autonomy_plan'));
  assert.ok(ids.includes('harness.inspect'));
  assert.ok(ids.includes('harness.run'));
  assert.ok(ids.includes('harness.rank_jobs'));
  assert.ok(ids.includes('harness.job_matrix'));
  assert.ok(ids.includes('harness.evidence_map'));
  assert.ok(ids.includes('harness.context_pack'));
  assert.ok(ids.includes('harness.information_index'));
  assert.ok(ids.includes('harness.inventory'));
  assert.ok(ids.includes('harness.resume'));
  assert.ok(ids.includes('harness.latest_run'));
  assert.ok(ids.includes('harness.blockers'));
  assert.ok(ids.includes('harness.provider_preflight'));
  assert.ok(ids.includes('harness.prepare_provider_inputs'));
  assert.ok(ids.includes('harness.provider_handoff'));
  assert.ok(ids.includes('creative.render'));
  assert.ok(ids.includes('provider.dry_run'));
  assert.ok(ids.includes('provider.live_run'));
  assert.ok(ids.includes('metrics.compare'));
  assert.ok(primitives.every((primitive) => primitive.command.length > 0));
});

test('inspect lists incoming jobs, provider requests, capabilities, and primitives', () => {
  const inspected = inspectHarness({}, process.cwd());

  assert.ok(inspected.incoming_jobs.some((job) => job.job_id === 'worthscan_scooter_battery_001'));
  assert.ok(inspected.provider_requests.some((request) => request.request_id === 'sample-openai-image-request'));
  assert.ok(inspected.primitives.some((primitive) => primitive.id === 'harness.run'));
  assert.ok(inspected.information_sources.some((source) => source.id === 'source.harness'));
  assert.ok(inspected.information_sources.some((source) => source.kind === 'job'));
  assert.ok(inspected.job_rankings.some((ranking) => ranking.job_id === 'worthscan_scooter_battery_001'));
  assert.ok(inspected.evidence_map.jobs.some((job) => job.job_id === 'worthscan_scooter_battery_001'));
  assert.ok(inspected.blocker_ledger.blockers.some((blocker) => blocker.id === 'git.reproducibility'));
  assert.ok(inspected.provider_preflight.preflights.some((preflight) => preflight.request_id === 'sample-openai-image-request'));
  assert.ok(inspected.capability_plan.lanes.some((lane) => lane.id === 'provider'));
  assert.equal(inspected.repo_status.is_git_repo, true);
  assert.equal(inspected.capability_profile.autonomy_level, 'local_only');
});

test('repo status exposes reproducibility data without ad hoc shell parsing', () => {
  const status = buildRepoStatus(process.cwd());

  assert.equal(status.is_git_repo, true);
  assert.ok(status.git_root?.endsWith('Viral-Bench'));
  assert.ok(Array.isArray(status.remotes));
  assert.ok(Array.isArray(status.modified));
  assert.ok(Array.isArray(status.untracked));
  assert.ok(status.modified_source_of_truth_count >= 0);
  assert.ok(Array.isArray(status.modified_source_of_truth));
  assert.ok(status.untracked_source_of_truth_count >= 0);
});

test('job ranking gives Codex scored runnable work choices', () => {
  const rankings = rankIncomingJobs({}, process.cwd());

  assert.ok(rankings.length >= 10);
  assert.equal(rankings[0].rank, 1);
  assert.equal(rankings[0].job_id, 'worthscan_scooter_battery_001');
  assert.ok(rankings.every((ranking, index) => ranking.rank === index + 1));
  assert.ok(rankings.some((ranking) => ranking.job_id === 'worthscan_scooter_battery_001' && ranking.reasons.length > 0));
  assert.ok(rankings.every((ranking) => typeof ranking.score === 'number'));
});

test('job matrix links jobs to renders, providers, launch queue, metrics, and commands', () => {
  const matrix = buildJobReadinessMatrix({}, process.cwd());
  const scooter = matrix.jobs.find((row) => row.job_id === 'worthscan_scooter_battery_001');
  const scanBike = matrix.jobs.find((row) => row.job_id === 'scan_bike_001');

  assert.equal(matrix.job_count, 11);
  assert.ok(matrix.rendered_job_count >= 3);
  assert.ok(matrix.provider_linked_job_count >= 1);
  assert.ok(matrix.launch_queue_job_count >= 3);
  assert.ok(scooter);
  assert.equal(scooter?.launch_queue.mentioned, true);
  assert.equal(scooter?.render_package.manifest_exists, true);
  assert.ok(scooter?.next_commands.some((command) => command.includes('creative -- validate')));
  assert.ok(scanBike?.provider_requests.some((request) => request.provider === 'openai_image'));
  assert.ok(scanBike?.provider_requests.some((request) => request.ready_for_provider_handoff));
  assert.ok(matrix.next_commands.some((command) => command.includes('rank-jobs')));
});

test('evidence map exposes job sources, rendered evidence, claim safety, and commands', () => {
  const map = buildEvidenceMap(process.cwd());
  const scooter = map.jobs.find((row) => row.job_id === 'worthscan_scooter_battery_001');

  assert.equal(map.job_count, 11);
  assert.ok(map.jobs_with_trend_examples >= 10);
  assert.ok(map.jobs_with_manual_boundary >= 10);
  assert.ok(map.jobs_with_rendered_evidence >= 3);
  assert.equal(map.jobs_with_claim_blockers, 0);
  assert.ok(scooter);
  assert.equal(scooter?.evidence_counts.trend_example_count, 3);
  assert.equal(scooter?.manual_boundary_declared, true);
  assert.equal(scooter?.claim_safety.disclaimer_present, true);
  assert.equal(scooter?.claim_safety.range_language_present, true);
  assert.equal(scooter?.claim_safety.exact_value_claim_present, false);
  assert.equal(scooter?.claim_safety.guarantee_claim_present, false);
  assert.equal(scooter?.rendered_evidence.manifest_exists, true);
  assert.ok(scooter?.next_commands.some((command) => command.includes('creative -- validate')));
  assert.ok(map.next_commands.some((command) => command.includes('job-matrix')));
});

test('information index maps source, schemas, jobs, provider requests, tests, and ops docs', () => {
  const sources = buildInformationIndex(process.cwd());
  const kinds = new Set(sources.map((source) => source.kind));

  assert.ok(kinds.has('source'));
  assert.ok(kinds.has('schema'));
  assert.ok(kinds.has('test'));
  assert.ok(kinds.has('job'));
  assert.ok(kinds.has('provider_request'));
  assert.ok(kinds.has('ops_doc'));
  assert.ok(sources.every((source) => fs.existsSync(source.path)));
});

test('context pack writes bounded hashed excerpts for Codex', () => {
  const pack = buildContextPack(process.cwd(), { maxFiles: 8, maxCharsPerFile: 200 });

  assert.equal(pack.source_count, 8);
  assert.equal(pack.max_chars_per_file, 200);
  assert.ok(pack.sources.some((source) => source.id === 'source.harness'));
  assert.ok(pack.sources.every((source) => source.excerpt.length <= 200));
  assert.ok(pack.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)));
});

test('blocker ledger exposes reproducibility and capability gates', () => {
  const ledger = buildBlockerLedger({}, process.cwd());
  const ids = ledger.blockers.map((blocker) => blocker.id);

  assert.ok(ids.includes('git.reproducibility'));
  assert.ok(ids.includes('provider.paid_generation'));
  assert.ok(ids.includes('browser.research'));
  assert.ok(ids.includes('publishing.social'));
  assert.equal(ledger.blockers.find((blocker) => blocker.id === 'provider.paid_generation')?.status, 'open');
});

test('capability plan explains provider, browser, and publishing gates', () => {
  const plan = buildCapabilityPlan({}, process.cwd());
  const providerLane = plan.lanes.find((lane) => lane.id === 'provider');
  const browserLane = plan.lanes.find((lane) => lane.id === 'browser');
  const publishingLane = plan.lanes.find((lane) => lane.id === 'publishing');
  const openAiRequest = plan.provider_requests.find((request) => request.provider === 'openai_image');

  assert.equal(plan.capability_profile.credential_policy, 'available_flags_only_no_secret_values');
  assert.equal(providerLane?.status, 'needs_credential');
  assert.equal(browserLane?.status, 'needs_gate');
  assert.equal(publishingLane?.status, 'human_boundary');
  assert.ok(openAiRequest);
  assert.equal(openAiRequest?.live_external_call_allowed, false);
  assert.ok(Array.isArray(openAiRequest?.missing_input_assets));
  assert.ok(openAiRequest?.missing_gates.includes('provider credential'));
  assert.ok(plan.browser.allowed_tasks_path?.endsWith('.ops/browser/allowed_browser_tasks.md'));
  assert.ok(plan.publishing.launch_queue_path?.endsWith('.ops/launch/launch_queue.md'));
});

test('capability plan reflects enabled gates without leaking credential values', () => {
  const plan = buildCapabilityPlan({
    ALLOW_PAID_GENERATION: 'true',
    ALLOW_BROWSER_UI: 'true',
    ALLOW_SOCIAL_PUBLISHING: 'true',
    OPENAI_API_KEY: 'present-for-test',
  }, process.cwd());
  const serialized = JSON.stringify(plan);
  const openAiRequest = plan.provider_requests.find((request) => request.provider === 'openai_image');

  assert.equal(plan.capability_profile.autonomy_level, 'publishing_enabled');
  assert.equal(openAiRequest?.credential_available, true);
  assert.doesNotMatch(serialized, /present-for-test/);
});

test('capability env plan reads ignored env files without leaking values', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-env-plan-'));
  fs.writeFileSync(path.join(rootDir, '.env'), [
    'ALLOW_PAID_GENERATION=true',
    'OPENAI_API_KEY=secret-value-for-test',
    'OPENAI_IMAGE_SIZE=1024x1536',
    'not a valid env line',
  ].join('\n'));

  const plan = buildCapabilityEnvPlan({ env: {}, rootDir, envFile: '.env' });
  const serialized = JSON.stringify(plan);
  const openAiKey = plan.keys.find((key) => key.key === 'OPENAI_API_KEY');
  const paidGate = plan.keys.find((key) => key.key === 'ALLOW_PAID_GENERATION');

  assert.equal(plan.env_file?.exists, true);
  assert.ok(plan.env_file?.keys.includes('OPENAI_API_KEY'));
  assert.equal(plan.capability_profile.gates.allow_paid_generation, true);
  assert.equal(plan.capability_profile.credentials.openai_api_key_available, true);
  assert.equal(openAiKey?.source, 'env_file');
  assert.equal(paidGate?.present, true);
  assert.ok(plan.warnings.some((warning) => warning.includes('Ignored line')));
  assert.doesNotMatch(serialized, /secret-value-for-test/);
});

test('autonomy plan returns an ordered Codex execution queue without leaking credentials', () => {
  const plan = buildAutonomyPlan('Make WorthScan autonomous for Codex', {
    ALLOW_PAID_GENERATION: 'true',
    OPENAI_API_KEY: 'present-for-test',
  }, process.cwd());
  const serialized = JSON.stringify(plan);

  assert.ok(plan.steps.length >= 5);
  assert.ok(plan.selected_next_step);
  assert.ok(plan.selected_next_step?.safe_to_run_now);
  assert.ok(plan.steps.some((step) => step.id === 'local.auto'));
  assert.ok(plan.steps.some((step) => step.id === 'information.job_matrix'));
  assert.ok(plan.steps.some((step) => step.id === 'information.evidence_map'));
  assert.ok(plan.steps.some((step) => step.id === 'provider.preflight_all'));
  assert.ok(plan.steps.some((step) => step.id.startsWith('provider.')));
  assert.ok(plan.command_policy.safe_default_commands.some((command) => command.includes('autonomy-plan')));
  assert.ok(plan.command_policy.capability_gated_commands.some((command) => command.includes('provider:run-live')));
  assert.equal(plan.command_policy.secret_policy, 'available_flags_only_no_secret_values');
  assert.doesNotMatch(serialized, /present-for-test/);
});

test('provider preflight reports missing local inputs and preparation commands', () => {
  const { rootDir } = createProviderFixtureRoot();
  const report = preflightProviderRequests({}, rootDir);
  const preflight = report.preflights.find((item) => item.provider === 'openai_image');

  assert.equal(report.request_count, 1);
  assert.equal(report.prepared_request_count, 0);
  assert.ok(preflight);
  assert.equal(preflight?.missing_prompt, null);
  assert.ok(preflight?.missing_input_assets.includes('.ops/creative_jobs/rendered/scan_bike_001/source/bike_001.jpg'));
  assert.ok(preflight?.missing_input_assets.includes('.ops/creative_jobs/rendered/scan_bike_001/manifest.json'));
  assert.ok(preflight?.suggested_prepare_command?.includes('prepare-provider-inputs'));
  assert.equal(preflight?.ready_for_provider_handoff, false);
  assert.equal(preflight?.ready_for_live_request, false);
  assert.ok(preflight?.declared_outputs.some((asset) => asset.path.endsWith('provider_outputs/openai_image/image_generation_plan.md')));
  assert.equal(preflight?.dry_run.external_calls_made, 0);
});

test('prepare provider inputs renders canonical assets and clears local preflight blockers', async () => {
  const { rootDir, requestPath } = createProviderFixtureRoot();
  const result = await prepareProviderInputs(requestPath, { rootDir });

  assert.equal(result.request_id, 'sample-openai-image-request');
  assert.equal(result.still_missing_inputs.length, 0);
  assert.ok(fs.existsSync(path.join(rootDir, '.ops', 'creative_jobs', 'rendered', 'scan_bike_001', 'source', 'bike_001.jpg')));
  assert.ok(fs.existsSync(path.join(rootDir, '.ops', 'creative_jobs', 'rendered', 'scan_bike_001', 'manifest.json')));
  assert.ok(result.created_paths.some((createdPath) => createdPath.endsWith('source/bike_001.jpg')));
  assert.equal(result.provider_preflight.ready_for_provider_handoff, true);
  assert.ok(result.next_commands.some((command) => command.includes('provider:run-dry')));
});

test('provider handoff packet writes bounded context without secret values', async () => {
  const { rootDir, requestPath } = createProviderFixtureRoot();
  await prepareProviderInputs(requestPath, { rootDir });
  const outDir = path.join(rootDir, '.ops', 'harness', 'provider_handoffs', 'test-openai-handoff');
  const packet = exportProviderHandoffPacket(requestPath, {
    rootDir,
    outDir,
    env: {
      ALLOW_PAID_GENERATION: 'true',
      OPENAI_API_KEY: 'secret-value-for-test',
    },
    maxTextChars: 120,
  });
  const serialized = JSON.stringify(packet);

  assert.equal(packet.request_id, 'sample-openai-image-request');
  assert.equal(packet.provider, 'openai_image');
  assert.equal(packet.job_id, 'scan_bike_001');
  assert.equal(packet.request.request_id, 'sample-openai-image-request');
  assert.equal(packet.provider_preflight.ready_for_provider_handoff, true);
  assert.equal(packet.external_call_policy.external_calls_made, 0);
  assert.equal(packet.external_call_policy.live_external_call_allowed, false);
  assert.equal(packet.capability_profile.credentials.openai_api_key_available, true);
  assert.doesNotMatch(serialized, /secret-value-for-test/);
  assert.ok(fs.existsSync(packet.files.manifest_path));
  assert.ok(fs.existsSync(packet.files.request_copy_path));
  assert.ok(fs.existsSync(packet.files.job_copy_path ?? ''));
  assert.ok(fs.existsSync(packet.files.prompt_copy_path ?? ''));
  assert.ok(fs.existsSync(packet.files.asset_manifest_path));
  assert.ok(packet.prompt.text_excerpt?.includes('OpenAI image generation fixture'));
  assert.ok(packet.input_assets.some((asset) => asset.path.endsWith('source/bike_001.jpg') && /^[a-f0-9]{64}$/.test(asset.sha256 ?? '')));
  assert.ok(packet.next_commands.some((command) => command.includes('provider:run-dry')));
});

test('reproducibility manifest separates source-of-truth from generated artifacts', () => {
  const manifest = buildReproducibilityManifest(process.cwd());

  assert.ok(manifest.source_of_truth.file_count >= manifest.source_of_truth.untracked_count);
  assert.ok(manifest.source_of_truth.files.some((file) => file.path === 'src/codex-harness.ts'));
  assert.ok(manifest.source_of_truth.files.some((file) => file.path === '.env.example'));
  assert.ok(manifest.source_of_truth.files.some((file) => file.path === 'package.json'));
  assert.ok(manifest.source_of_truth.files.every((file) => !file.path.startsWith('.ops/harness/')));
  assert.ok(manifest.generated_artifacts.ignored_or_runtime_paths.includes('.ops/harness/runs/'));
  assert.ok(manifest.generated_artifacts.ignored_or_runtime_paths.includes('.ops/harness/source_packages/'));
  assert.ok(manifest.commands.inspect.includes('npm run harness -- stage-source --dry-run'));
  assert.ok(manifest.commands.inspect.includes('npm run harness -- source-package'));
  assert.ok(manifest.commands.verify.includes('npm test -- --runInBand'));
});

test('stage source defaults to dry-run and only applies with explicit flag', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-stage-source-'));
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'src', 'example.ts'), 'export const example = true;\n');
  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });

  const dryRun = stageSourceOfTruth({ rootDir });
  const dryStatus = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.applied, false);
  assert.deepEqual(dryRun.staged_paths, ['src/example.ts']);
  assert.match(dryStatus, /\?\? src\/example\.ts/);

  const applied = stageSourceOfTruth({ rootDir, apply: true });
  const appliedStatus = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.after?.untracked_source_of_truth_count, 0);
  assert.match(appliedStatus, /A  src\/example\.ts/);
});

test('source package exports and verifies source-of-truth files only', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-source-package-root-'));
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.ops', 'harness', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'src', 'example.ts'), 'export const example = true;\n');
  fs.writeFileSync(path.join(rootDir, '.ops', 'harness', 'runs', 'runtime.json'), '{}\n');
  fs.writeFileSync(path.join(rootDir, 'README.md'), '# Example\n');
  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
  const outDir = path.join(os.tmpdir(), `viral-bench-source-package-${Date.now()}`);

  const report = exportSourcePackage({ rootDir, outDir });
  const verification = verifySourcePackage(outDir);

  assert.equal(report.source_file_count, 2);
  assert.equal(report.dirty_source_file_count, 2);
  assert.ok(fs.existsSync(path.join(outDir, 'files', 'src', 'example.ts')));
  assert.ok(fs.existsSync(path.join(outDir, 'files', 'README.md')));
  assert.equal(fs.existsSync(path.join(outDir, 'files', '.ops', 'harness', 'runs', 'runtime.json')), false);
  assert.equal(verification.ok, true);
  assert.equal(verification.aggregate_sha256, report.aggregate_sha256);
});

test('autonomy audit reports objective-level gates with evidence', () => {
  const audit = buildAutonomyAudit('Make WorthScan autonomous for Codex', {}, process.cwd());
  const ids = audit.criteria.map((criterion) => criterion.id);

  assert.ok(ids.includes('codex.information_primitives'));
  assert.ok(ids.includes('codex.local_execution'));
  assert.ok(ids.includes('codex.reproducibility'));
  assert.ok(ids.includes('codex.provider_autonomy'));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- capability-plan')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- reproducibility-manifest')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- stage-source --dry-run')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- source-package')));
});

test('doctor reports readiness, information surface, and recommended commands', () => {
  const doctor = buildHarnessDoctor({}, process.cwd());

  assert.equal(doctor.repo_status.is_git_repo, true);
  assert.ok(doctor.capability_plan.provider_requests.length >= 1);
  assert.ok(doctor.provider_preflight.preflights.length >= 1);
  assert.ok(doctor.reproducibility_manifest.source_of_truth.file_count > 0);
  assert.ok(doctor.autonomy_audit.criteria.some((criterion) => criterion.id === 'codex.reproducibility'));
  assert.ok(doctor.incoming_job_count >= 10);
  assert.ok(doctor.provider_request_count >= 1);
  assert.ok(doctor.information_surface.source_count >= doctor.incoming_job_count);
  assert.equal(doctor.readiness.local_autonomy, doctor.secret_scan.status === 'clear' && doctor.incoming_job_count > 0);
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- run')));
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- provider-preflight')));
});

test('harness run writes durable Codex artifacts and renders selected job', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-harness-'));
  const record = await runCodexHarness({
    goal: 'Make WorthScan autonomous for Codex',
    jobPath: SCOOTER_JOB,
    outDir,
    runId: 'test-run',
    env: {},
  });

  assert.equal(record.run_id, 'test-run');
  assert.equal(record.selected_job.job_id, 'worthscan_scooter_battery_001');
  assert.ok(['advanced', 'needs_capability'].includes(record.status));
  assert.ok(fs.existsSync(path.join(outDir, 'run.json')));
  assert.ok(fs.existsSync(record.primitives_path));
  assert.ok(fs.existsSync(record.capabilities_path));
  assert.ok(fs.existsSync(record.information_index_path));
  assert.ok(fs.existsSync(record.context_pack_path));
  assert.ok(fs.existsSync(record.job_rankings_path));
  assert.ok(fs.existsSync(record.evidence_map_path));
  assert.ok(fs.existsSync(record.reproducibility_manifest_path));
  assert.ok(fs.existsSync(record.autonomy_audit_path));
  assert.ok(record.provider_preflight_path);
  assert.ok(fs.existsSync(record.provider_preflight_path));
  assert.ok(fs.existsSync(record.artifact_inventory_path));
  assert.ok(fs.existsSync(record.blocker_ledger_path));
  assert.ok(fs.existsSync(record.next_actions_path));
  assert.ok(fs.existsSync(record.prompt_packet_path));
  assert.ok(fs.existsSync(path.join(record.render_output_dir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(record.render_output_dir, 'output', 'caption.txt')));
  assert.ok(record.provider_dry_runs.every((result) => result.external_calls_made === 0));
  assert.match(fs.readFileSync(record.prompt_packet_path, 'utf8'), /Codex Harness Packet/);
  assert.match(fs.readFileSync(record.information_index_path, 'utf8'), /source.harness/);
  assert.match(fs.readFileSync(record.context_pack_path, 'utf8'), /sha256/);
  assert.match(fs.readFileSync(record.job_rankings_path, 'utf8'), /score/);
  assert.match(fs.readFileSync(record.evidence_map_path, 'utf8'), /claim_safety/);
  assert.match(fs.readFileSync(record.reproducibility_manifest_path, 'utf8'), /source_of_truth/);
  assert.match(fs.readFileSync(record.autonomy_audit_path, 'utf8'), /codex\.reproducibility/);
  assert.match(fs.readFileSync(record.provider_preflight_path, 'utf8'), /provider_preflight|preflights/);
  assert.match(fs.readFileSync(record.artifact_inventory_path, 'utf8'), /artifact_count/);
  assert.match(fs.readFileSync(record.blocker_ledger_path, 'utf8'), /git\.reproducibility/);
  assert.match(fs.readFileSync(record.next_actions_path, 'utf8'), /next_actions/);
});

test('resume reports missing artifacts and next commands for an existing run', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-harness-resume-'));
  const record = await runCodexHarness({
    goal: 'Resume autonomous WorthScan work',
    jobPath: SCOOTER_JOB,
    outDir,
    runId: 'resume-test',
    env: {},
  });
  const inventory = buildArtifactInventory(outDir);
  const resume = resumeHarnessRun(outDir);

  assert.equal(resume.run_id, 'resume-test');
  assert.equal(resume.selected_job.job_id, record.selected_job.job_id);
  assert.deepEqual(resume.missing_artifacts, []);
  assert.equal(resume.reproducibility_manifest_path, record.reproducibility_manifest_path);
  assert.equal(resume.autonomy_audit_path, record.autonomy_audit_path);
  assert.ok(record.provider_preflight_path);
  assert.ok(resume.next_commands.some((command) => command.includes('npm run creative -- validate')));
  assert.ok(inventory.artifacts.some((artifact) => artifact.relative_path === 'run.json'));
});

test('auto loop writes a durable auto result and keeps external gates explicit', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-harness-auto-'));
  const result = await runCodexAutonomy({
    goal: 'Make WorthScan autonomous for Codex',
    jobPath: SCOOTER_JOB,
    outDir,
    runId: 'auto-test',
    env: {},
  });
  const inventory = buildArtifactInventory(outDir);

  assert.equal(result.run.run_id, 'auto-test');
  assert.equal(result.run.selected_job.job_id, 'worthscan_scooter_battery_001');
  assert.ok(fs.existsSync(result.auto_result_path));
  assert.ok(fs.existsSync(result.run.reproducibility_manifest_path));
  assert.ok(fs.existsSync(result.run.autonomy_audit_path));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- doctor')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- autonomy-audit')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- stage-source --dry-run')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- source-package')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- provider-preflight')));
  assert.ok(result.decision.stop_reason.includes('provider.paid_generation') || result.status === 'advanced');
  assert.ok(inventory.artifacts.some((artifact) => artifact.relative_path === 'auto_result.json'));
});

test('latest run returns null when no harness run folder exists', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-no-runs-'));

  assert.equal(findLatestHarnessRun(rootDir), null);
});
