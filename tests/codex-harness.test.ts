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
  buildCapabilityUnlockMap,
  buildCapabilityPlan,
  buildContextPack,
  buildCredentialCoverageMap,
  buildDecisionSurface,
  buildEvidenceMap,
  buildGoalCompletionAudit,
  buildHarnessDoctor,
  buildHarnessRunHistory,
  buildInformationIndex,
  buildCapabilityProfile,
  buildJobReadinessMatrix,
  buildLaunchMap,
  buildReproducibilityManifest,
  buildRepoStatus,
  buildVerificationMap,
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
  assert.ok(ids.includes('harness.capability_unlock_map'));
  assert.ok(ids.includes('harness.capability_env'));
  assert.ok(ids.includes('harness.credential_coverage'));
  assert.ok(ids.includes('harness.reproducibility_manifest'));
  assert.ok(ids.includes('harness.verification_map'));
  assert.ok(ids.includes('harness.stage_source'));
  assert.ok(ids.includes('harness.source_package'));
  assert.ok(ids.includes('harness.verify_source_package'));
  assert.ok(ids.includes('harness.autonomy_audit'));
  assert.ok(ids.includes('harness.goal_completion_audit'));
  assert.ok(ids.includes('harness.autonomy_plan'));
  assert.ok(ids.includes('harness.decision_surface'));
  assert.ok(ids.includes('harness.inspect'));
  assert.ok(ids.includes('harness.run'));
  assert.ok(ids.includes('harness.rank_jobs'));
  assert.ok(ids.includes('harness.job_matrix'));
  assert.ok(ids.includes('harness.evidence_map'));
  assert.ok(ids.includes('harness.launch_map'));
  assert.ok(ids.includes('harness.context_pack'));
  assert.ok(ids.includes('harness.information_index'));
  assert.ok(ids.includes('harness.inventory'));
  assert.ok(ids.includes('harness.resume'));
  assert.ok(ids.includes('harness.run_history'));
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
  assert.ok(inspected.launch_map.jobs.some((job) => job.job_id === 'worthscan_scooter_battery_001'));
  assert.ok(inspected.verification_map.recommended_commands.some((command) => command.includes('autonomy-audit')));
  assert.ok(inspected.blocker_ledger.blockers.some((blocker) => blocker.id === 'git.reproducibility'));
  assert.ok(inspected.provider_preflight.preflights.some((preflight) => preflight.request_id === 'sample-openai-image-request'));
  assert.equal(inspected.goal_completion_audit.can_mark_goal_complete, false);
  assert.equal(inspected.decision_surface.summary.can_mark_goal_complete, false);
  assert.ok(inspected.capability_plan.lanes.some((lane) => lane.id === 'provider'));
  assert.ok(inspected.capability_unlock_map.lanes.some((lane) => lane.id === 'paid_provider_generation'));
  assert.ok(inspected.credential_coverage.keys.some((key) => key.key === 'OPENAI_API_KEY'));
  assert.ok(Array.isArray(inspected.run_history.runs));
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

test('verification map turns changed files into targeted validation commands', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-verification-map-'));
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, '.ops', 'launch'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'src', 'codex-harness.ts'), 'export const changed = true;\n');
  fs.writeFileSync(path.join(rootDir, '.ops', 'launch', 'launch_queue.md'), '# Launch Queue\n');
  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });

  const map = buildVerificationMap(rootDir);
  const ids = map.validation_targets.map((target) => target.id);

  assert.equal(map.dirty, true);
  assert.equal(map.changed_source_of_truth_count, 2);
  assert.ok(map.changed_files.some((file) => file.path === 'src/codex-harness.ts' && file.validation_target_ids.includes('harness.focused')));
  assert.ok(map.changed_files.some((file) => file.path === '.ops/launch/launch_queue.md' && file.validation_target_ids.includes('launch.focused')));
  assert.ok(ids.includes('typescript.typecheck'));
  assert.ok(ids.includes('harness.stage_source_dry_run'));
  assert.ok(ids.includes('test.full_suite'));
  assert.ok(map.recommended_commands.some((command) => command.includes('tests/codex-harness.test.ts')));
  assert.ok(map.recommended_commands.some((command) => command.includes('tests/launch-kit.test.ts')));
  assert.ok(map.recommended_commands.some((command) => command.includes('stage-source --dry-run')));
  assert.ok(map.stage_source_command?.includes('git add'));
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

test('launch map separates manual handoff readiness from autonomous publishing gates', () => {
  const map = buildLaunchMap({}, process.cwd());
  const scooter = map.jobs.find((row) => row.job_id === 'worthscan_scooter_battery_001');

  assert.equal(map.queued_job_count, 3);
  assert.equal(map.manual_handoff_ready_job_count, 3);
  assert.equal(map.autonomous_publish_ready_job_count, 0);
  assert.equal(map.metrics_job_count, 0);
  assert.ok(map.launch_docs.every((doc) => doc.exists));
  assert.ok(scooter);
  assert.equal(scooter?.order, 2);
  assert.equal(scooter?.manual_handoff_ready, true);
  assert.equal(scooter?.autonomous_publish_ready, false);
  assert.equal(scooter?.launch_copy.tiktok_caption, true);
  assert.equal(scooter?.launch_copy.metric_schedule, true);
  assert.ok(scooter?.required_files.every((file) => file.exists));
  assert.ok(scooter?.blockers.includes('ALLOW_SOCIAL_PUBLISHING=false'));
  assert.ok(scooter?.blockers.includes('job policy disallows social publishing'));
  assert.ok(scooter?.next_commands.some((command) => command.includes('metrics:create-post')));
  assert.ok(map.next_commands.some((command) => command.includes('evidence-map')));
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

test('capability unlock map explains closed external gates without leaking credentials', () => {
  const map = buildCapabilityUnlockMap({
    ALLOW_PAID_GENERATION: 'true',
    OPENAI_API_KEY: 'present-for-test',
  }, process.cwd());
  const serialized = JSON.stringify(map);
  const provider = map.lanes.find((lane) => lane.id === 'paid_provider_generation');
  const browser = map.lanes.find((lane) => lane.id === 'browser_research');
  const publishing = map.lanes.find((lane) => lane.id === 'social_publishing');

  assert.equal(map.credential_policy, 'available_flags_only_no_secret_values');
  assert.ok(provider);
  assert.equal(provider.current_enabled, true);
  assert.ok(provider.required_credentials.includes('OPENAI_API_KEY'));
  assert.ok(provider.related_requests.some((request) => request.request_id === 'sample-openai-image-live-request'));
  assert.ok(provider.activation_commands.some((command) => command.includes('provider:run-live')));
  assert.ok(browser);
  assert.ok(browser.required_env.includes('ALLOW_BROWSER_UI=true'));
  assert.ok(publishing);
  assert.equal(publishing.status, 'human_boundary');
  assert.doesNotMatch(serialized, /present-for-test/);
});

test('credential coverage maps usable and unbound keys without leaking values', () => {
  const map = buildCredentialCoverageMap({
    env: {
      ALLOW_PAID_GENERATION: 'true',
      OPENAI_API_KEY: 'present-for-test',
      OPENROUTER_API_KEY: 'router-secret-for-test',
    },
    rootDir: process.cwd(),
  });
  const serialized = JSON.stringify(map);
  const openAi = map.keys.find((key) => key.key === 'OPENAI_API_KEY');
  const openRouter = map.keys.find((key) => key.key === 'OPENROUTER_API_KEY');

  assert.equal(map.credential_policy, 'available_flags_only_no_secret_values');
  assert.ok(openAi);
  assert.equal(openAi.status, 'usable_now');
  assert.ok(openAi.ready_request_ids.includes('sample-openai-image-live-request'));
  assert.ok(openRouter);
  assert.equal(openRouter.status, 'present_but_unbound');
  assert.equal(openRouter.current_binding, 'unbound');
  assert.equal(map.summary.usable_now_count >= 1, true);
  assert.doesNotMatch(serialized, /present-for-test|router-secret-for-test/);
});

test('capability env plan reads ignored env files without leaking values', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-env-plan-'));
  fs.writeFileSync(path.join(rootDir, '.env'), [
    'ALLOW_PAID_GENERATION=true',
    'OPENAI_API_KEY=secret-value-for-test',
    'OPENROUTER_API_KEY=router-secret-for-test',
    'OPENAI_IMAGE_SIZE=1024x1536',
    'not a valid env line',
  ].join('\n'));

  const plan = buildCapabilityEnvPlan({ env: {}, rootDir, envFile: '.env' });
  const serialized = JSON.stringify(plan);
  const openAiKey = plan.keys.find((key) => key.key === 'OPENAI_API_KEY');
  const openRouterKey = plan.keys.find((key) => key.key === 'OPENROUTER_API_KEY');
  const paidGate = plan.keys.find((key) => key.key === 'ALLOW_PAID_GENERATION');

  assert.equal(plan.env_file?.exists, true);
  assert.ok(plan.env_file?.keys.includes('OPENAI_API_KEY'));
  assert.equal(plan.capability_profile.gates.allow_paid_generation, true);
  assert.equal(plan.capability_profile.credentials.openai_api_key_available, true);
  assert.equal(openAiKey?.source, 'env_file');
  assert.equal(openRouterKey?.source, 'env_file');
  assert.equal(paidGate?.present, true);
  assert.ok(plan.warnings.some((warning) => warning.includes('Ignored line')));
  assert.doesNotMatch(serialized, /secret-value-for-test|router-secret-for-test/);
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
  assert.ok(plan.steps.some((step) => step.id === 'information.launch_map'));
  assert.ok(plan.steps.some((step) => step.id === 'information.run_history'));
  assert.ok(plan.steps.some((step) => step.id === 'verification.map'));
  assert.ok(plan.steps.some((step) => step.id === 'capability.unlock_map'));
  assert.ok(plan.steps.some((step) => step.id === 'capability.credential_coverage'));
  assert.ok(plan.steps.some((step) => step.id === 'goal.completion_audit'));
  assert.ok(plan.steps.some((step) => step.id === 'provider.preflight_all'));
  assert.ok(plan.steps.some((step) => step.id.startsWith('provider.')));
  assert.ok(plan.command_policy.safe_default_commands.some((command) => command.includes('decision-surface')));
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
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- capability-unlock-map')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- credential-coverage')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- decision-surface')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- run-history')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- reproducibility-manifest')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- stage-source --dry-run')));
  assert.ok(audit.next_commands.some((command) => command.includes('npm run harness -- source-package')));
});

test('goal completion audit keeps the active objective unclosed until all evidence passes', () => {
  const audit = buildGoalCompletionAudit('Make WorthScan autonomous for Codex', {}, process.cwd());
  const ids = audit.requirements.map((requirement) => requirement.id);
  const provider = audit.requirements.find((requirement) => requirement.id === 'goal.api_key_provider_path');
  const completion = audit.requirements.find((requirement) => requirement.id === 'goal.completion_claim');

  assert.equal(audit.summary_status === 'achieved', false);
  assert.equal(audit.can_mark_goal_complete, false);
  assert.ok(ids.includes('goal.repo_reproducibility'));
  assert.ok(ids.includes('goal.codex_information_primitives'));
  assert.ok(ids.includes('goal.local_autonomous_loop'));
  assert.ok(ids.includes('goal.api_key_provider_path'));
  assert.ok(provider);
  assert.notEqual(provider.status, 'passed');
  assert.ok(provider.proof_commands.some((command) => command.includes('provider:run-live')));
  assert.ok(completion);
  assert.equal(completion.status, 'open');
  assert.ok(audit.next_commands.some((command) => command.includes('goal-completion-audit')));
});

test('decision surface queues safe Codex actions separately from external gates', () => {
  const surface = buildDecisionSurface('Make WorthScan autonomous for Codex', {
    ALLOW_PAID_GENERATION: 'true',
    OPENAI_API_KEY: 'present-for-test',
  }, process.cwd());
  const serialized = JSON.stringify(surface);

  assert.ok(surface.summary.safe_now_count > 0);
  assert.ok(surface.summary.capability_gated_count >= 0);
  assert.ok(surface.summary.human_boundary_count > 0);
  assert.equal(surface.summary.can_mark_goal_complete, false);
  assert.ok(surface.selected_safe_action);
  assert.ok(surface.queues.safe_now.some((action) => action.id === 'reproducibility.stage_source_dry_run'));
  assert.ok(surface.queues.safe_now.some((action) => action.id.startsWith('provider.handoff.')));
  assert.ok(surface.queues.capability_gated.every((action) => action.queue === 'capability_gated'));
  assert.ok(surface.queues.human_boundary.some((action) => action.id === 'publishing.boundary'));
  assert.ok(surface.current_state.provider_request_count >= 1);
  assert.ok(surface.next_commands.some((command) => command.includes('decision-surface')));
  assert.doesNotMatch(serialized, /present-for-test/);
});

test('doctor reports readiness, information surface, and recommended commands', () => {
  const doctor = buildHarnessDoctor({}, process.cwd());

  assert.equal(doctor.repo_status.is_git_repo, true);
  assert.equal(doctor.goal_completion_audit.can_mark_goal_complete, false);
  assert.ok(doctor.capability_plan.provider_requests.length >= 1);
  assert.ok(doctor.provider_preflight.preflights.length >= 1);
  assert.ok(doctor.credential_coverage.keys.some((key) => key.key === 'OPENAI_API_KEY'));
  assert.ok(Array.isArray(doctor.run_history.runs));
  assert.ok(doctor.reproducibility_manifest.source_of_truth.file_count > 0);
  assert.ok(doctor.autonomy_audit.criteria.some((criterion) => criterion.id === 'codex.reproducibility'));
  assert.ok(doctor.incoming_job_count >= 10);
  assert.ok(doctor.provider_request_count >= 1);
  assert.ok(doctor.information_surface.source_count >= doctor.incoming_job_count);
  assert.equal(doctor.readiness.local_autonomy, doctor.secret_scan.status === 'clear' && doctor.incoming_job_count > 0);
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- run')));
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- provider-preflight')));
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- capability-unlock-map')));
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- credential-coverage')));
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- goal-completion-audit')));
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- decision-surface')));
  assert.ok(doctor.recommended_commands.some((command) => command.includes('npm run harness -- run-history')));
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
  assert.ok(fs.existsSync(record.launch_map_path));
  assert.ok(fs.existsSync(record.verification_map_path));
  assert.ok(fs.existsSync(record.capability_unlock_map_path));
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
  assert.match(fs.readFileSync(record.launch_map_path, 'utf8'), /manual_handoff_ready/);
  assert.match(fs.readFileSync(record.verification_map_path, 'utf8'), /recommended_commands/);
  assert.match(fs.readFileSync(record.capability_unlock_map_path, 'utf8'), /paid_provider_generation/);
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
  assert.ok(resume.next_commands.some((command) => command.includes('npm run harness -- capability-unlock-map')));
  assert.ok(resume.next_commands.some((command) => command.includes('npm run harness -- run-history')));
  assert.ok(resume.next_commands.some((command) => command.includes('npm run creative -- validate')));
  assert.ok(inventory.artifacts.some((artifact) => artifact.relative_path === 'run.json'));
});

test('run history summarizes usable and unreadable durable runs', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-run-history-'));
  const runsDir = path.join(rootDir, '.ops', 'harness', 'runs');
  const goodRunDir = path.join(runsDir, 'good-run');
  const badRunDir = path.join(runsDir, 'bad-run');
  const sharedArtifact = path.join(goodRunDir, 'artifact.json');
  const renderDir = path.join(goodRunDir, 'rendered', 'job_001');
  fs.mkdirSync(renderDir, { recursive: true });
  fs.mkdirSync(badRunDir, { recursive: true });
  fs.writeFileSync(sharedArtifact, '{}\n');
  fs.writeFileSync(path.join(renderDir, 'manifest.json'), '{}\n');
  fs.writeFileSync(path.join(badRunDir, 'run.json'), '{not-json');
  fs.writeFileSync(path.join(goodRunDir, 'run.json'), `${JSON.stringify({
    run_id: 'good-run',
    goal: 'Exercise run history',
    created_at: '2026-07-09T00:00:00.000Z',
    status: 'needs_capability',
    selected_job: {
      path: '.ops/creative_jobs/incoming/job_001.json',
      job_id: 'job_001',
      reason: 'test fixture',
    },
    capability_profile: buildCapabilityProfile({}, rootDir),
    primitives_path: sharedArtifact,
    capabilities_path: sharedArtifact,
    information_index_path: sharedArtifact,
    context_pack_path: sharedArtifact,
    job_rankings_path: sharedArtifact,
    evidence_map_path: sharedArtifact,
    launch_map_path: sharedArtifact,
    verification_map_path: sharedArtifact,
    capability_unlock_map_path: path.join(goodRunDir, 'missing_capability_unlock_map.json'),
    reproducibility_manifest_path: sharedArtifact,
    autonomy_audit_path: sharedArtifact,
    artifact_inventory_path: sharedArtifact,
    blocker_ledger_path: sharedArtifact,
    provider_preflight_path: sharedArtifact,
    next_actions_path: sharedArtifact,
    prompt_packet_path: sharedArtifact,
    render_output_dir: renderDir,
    provider_dry_runs: [{
      request_id: 'sample-openai-image-live-request',
      provider: 'openai_image',
      status: 'blocked',
      external_calls_made: 0,
      output_paths: [],
      log: ['blocked for test'],
    }],
    stages: [{
      name: 'provider_gate_evaluation',
      status: 'blocked',
      evidence: ['blocked for test'],
      artifacts: [],
    }],
    next_actions: ['inspect capability gates'],
  }, null, 2)}\n`);

  const history = buildHarnessRunHistory({ rootDir, limit: 10 });
  const goodRun = history.runs.find((run) => run.run_id === 'good-run');
  const badRun = history.runs.find((run) => run.run_id === 'bad-run');

  assert.equal(history.exists, true);
  assert.equal(history.run_count, 2);
  assert.ok(goodRun);
  assert.equal(goodRun.status, 'needs_capability');
  assert.equal(goodRun.selected_job?.job_id, 'job_001');
  assert.equal(goodRun.missing_artifact_count, 1);
  assert.equal(goodRun.provider_dry_run_count, 1);
  assert.equal(goodRun.provider_blocked_count, 1);
  assert.equal(goodRun.external_calls_made, 0);
  assert.equal(goodRun.stage_status_counts.blocked, 1);
  assert.ok(goodRun.resume_commands.some((command) => command.includes('npm run harness -- resume') || command.includes('npm run harness -- inventory')));
  assert.ok(badRun);
  assert.equal(badRun.status, 'unreadable');
  assert.match(badRun.error ?? '', /JSON|Unexpected|property/i);
  assert.ok(history.next_commands.some((command) => command.includes('npm run harness -- run-history')));
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
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- goal-completion-audit')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- decision-surface')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- stage-source --dry-run')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- source-package')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- provider-preflight')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- capability-unlock-map')));
  assert.ok(result.next_commands.some((command) => command.includes('npm run harness -- run-history')));
  assert.ok(result.decision.stop_reason.includes('provider.paid_generation') || result.status === 'advanced');
  assert.ok(inventory.artifacts.some((artifact) => artifact.relative_path === 'auto_result.json'));
});

test('latest run returns null when no harness run folder exists', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-no-runs-'));

  assert.equal(findLatestHarnessRun(rootDir), null);
});
