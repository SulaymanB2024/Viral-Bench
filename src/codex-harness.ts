import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  type CreativeJobManifest,
  type CreativeProviderName,
  loadCreativeJobManifest,
  scanRepositoryForSecrets,
} from '../packages/creative/job_schema';
import { runCreativeProvider } from '../packages/creative/provider_router';
import {
  loadProviderRequestManifest,
  runProviderDryRun,
  type ProviderDryRunResult,
  type ProviderRequestManifest,
} from './provider-workflow';

export const DEFAULT_HARNESS_RUNS_DIR = path.join(process.cwd(), '.ops', 'harness', 'runs');
export const DEFAULT_SOURCE_PACKAGES_DIR = path.join(process.cwd(), '.ops', 'harness', 'source_packages');

export interface HarnessCredentialProfile {
  openai_api_key_available: boolean;
  gemini_api_key_available: boolean;
  lightreel_api_key_available: boolean;
  scrape_creators_api_key_available: boolean;
  doublespeed_tokens_available: boolean;
}

export interface HarnessCapabilityProfile {
  autonomy_level: 'local_only' | 'browser_enabled' | 'provider_enabled' | 'publishing_enabled';
  gates: {
    allow_paid_generation: boolean;
    allow_browser_ui: boolean;
    allow_social_publishing: boolean;
  };
  credentials: HarnessCredentialProfile;
  credential_policy: 'available_flags_only_no_secret_values';
}

export interface CodexPrimitive {
  id: string;
  kind: 'auto' | 'doctor' | 'reproducibility' | 'inspect' | 'rank' | 'context' | 'trend' | 'creative' | 'provider' | 'browser' | 'metrics' | 'publish';
  command: string;
  purpose: string;
  writes: string[];
  required_gates: string[];
  autonomy: 'safe_default' | 'capability_gated' | 'human_boundary';
}

export interface HarnessInformationSource {
  id: string;
  kind: 'source' | 'schema' | 'test' | 'job' | 'provider_request' | 'ops_doc' | 'skill' | 'report';
  path: string;
  role: string;
}

export interface HarnessJobRanking {
  rank: number;
  job_id: string;
  path: string;
  score: number;
  runnable_now: boolean;
  reasons: string[];
  blockers: string[];
}

export interface HarnessContextPackSource {
  id: string;
  kind: HarnessInformationSource['kind'];
  path: string;
  role: string;
  size_bytes: number;
  sha256: string;
  excerpt: string;
  truncated: boolean;
}

export interface HarnessContextPack {
  created_at: string;
  root_dir: string;
  max_files: number;
  max_chars_per_file: number;
  source_count: number;
  sources: HarnessContextPackSource[];
}

export interface HarnessArtifactInventoryItem {
  path: string;
  relative_path: string;
  kind: 'json' | 'markdown' | 'text' | 'image' | 'other';
  size_bytes: number;
  sha256: string;
}

export interface HarnessArtifactInventory {
  root_dir: string;
  created_at: string;
  artifact_count: number;
  artifacts: HarnessArtifactInventoryItem[];
}

export interface HarnessBlocker {
  id: string;
  severity: 'blocker' | 'high' | 'medium' | 'low';
  status: 'open' | 'resolved';
  evidence: string[];
  next_action: string;
}

export interface HarnessBlockerLedger {
  created_at: string;
  root_dir: string;
  blockers: HarnessBlocker[];
}

export interface HarnessResumeReport {
  run_id: string;
  run_dir: string;
  status: HarnessRunRecord['status'];
  selected_job: HarnessRunRecord['selected_job'];
  missing_artifacts: string[];
  artifact_inventory_path: string;
  blocker_ledger_path: string;
  reproducibility_manifest_path?: string;
  autonomy_audit_path?: string;
  next_commands: string[];
}

export interface HarnessRepoStatus {
  root_dir: string;
  git_root: string | null;
  branch: string | null;
  upstream: string | null;
  remotes: string[];
  is_git_repo: boolean;
  dirty: boolean;
  modified: string[];
  modified_count: number;
  modified_source_of_truth_count: number;
  modified_source_of_truth: string[];
  untracked: string[];
  untracked_count: number;
  untracked_source_of_truth_count: number;
  untracked_source_of_truth: string[];
}

export interface HarnessReproducibilityFile {
  path: string;
  status: 'tracked_or_modified' | 'untracked';
  role: string;
}

export interface HarnessReproducibilityManifest {
  created_at: string;
  root_dir: string;
  repo_status: HarnessRepoStatus;
  source_of_truth: {
    file_count: number;
    tracked_or_modified_count: number;
    modified_count: number;
    untracked_count: number;
    dirty_count: number;
    files: HarnessReproducibilityFile[];
  };
  generated_artifacts: {
    ignored_or_runtime_paths: string[];
    notes: string[];
  };
  commands: {
    inspect: string[];
    stage_source_of_truth: string | null;
    verify: string[];
  };
}

export interface HarnessStageSourceReport {
  created_at: string;
  root_dir: string;
  dry_run: boolean;
  applied: boolean;
  before: {
    modified_source_of_truth_count: number;
    untracked_source_of_truth_count: number;
    dirty_source_of_truth_count: number;
  };
  after?: {
    modified_source_of_truth_count: number;
    untracked_source_of_truth_count: number;
    dirty_source_of_truth_count: number;
  };
  staged_paths: string[];
  excluded_generated_paths: string[];
  command: string | null;
  warnings: string[];
}

export interface HarnessSourcePackageFile {
  source_path: string;
  package_path: string;
  role: string;
  size_bytes: number;
  sha256: string;
}

export interface HarnessSourcePackageReport {
  created_at: string;
  root_dir: string;
  package_dir: string;
  files_dir: string;
  manifest_path: string;
  reproducibility_manifest_path: string;
  source_file_count: number;
  dirty_source_file_count: number;
  aggregate_sha256: string;
  files: HarnessSourcePackageFile[];
  excluded_generated_paths: string[];
  verify_command: string;
}

export interface HarnessSourcePackageVerification {
  package_dir: string;
  manifest_path: string;
  ok: boolean;
  source_file_count: number;
  aggregate_sha256: string | null;
  missing_files: string[];
  hash_mismatches: Array<{ path: string; expected_sha256: string; actual_sha256: string }>;
}

export interface HarnessAutonomyAuditCriterion {
  id: string;
  status: 'passed' | 'open' | 'blocked';
  evidence: string[];
  next_action: string;
}

export interface HarnessAutonomyAudit {
  created_at: string;
  goal: string;
  root_dir: string;
  summary_status: 'local_autonomy_ready' | 'needs_reproducibility' | 'needs_capability' | 'blocked';
  criteria: HarnessAutonomyAuditCriterion[];
  next_commands: string[];
}

export interface HarnessDoctorReport {
  created_at: string;
  root_dir: string;
  repo_status: HarnessRepoStatus;
  reproducibility_manifest: HarnessReproducibilityManifest;
  autonomy_audit: HarnessAutonomyAudit;
  capability_profile: HarnessCapabilityProfile;
  blocker_ledger: HarnessBlockerLedger;
  information_surface: {
    source_count: number;
    by_kind: Record<HarnessInformationSource['kind'], number>;
  };
  incoming_job_count: number;
  provider_request_count: number;
  latest_run: HarnessResumeReport | null;
  secret_scan: {
    status: 'clear' | 'blocked';
    finding_count: number;
  };
  readiness: {
    local_autonomy: boolean;
    browser_autonomy: boolean;
    provider_autonomy: boolean;
    publishing_autonomy: boolean;
  };
  recommended_commands: string[];
}

export interface HarnessAutoResult {
  created_at: string;
  goal: string;
  status: HarnessRunRecord['status'];
  auto_result_path: string;
  decision: {
    action: 'ran_local_harness';
    reason: string;
    stop_reason: string;
  };
  doctor: HarnessDoctorReport;
  run: HarnessRunRecord;
  resume: HarnessResumeReport;
  next_commands: string[];
}

export interface HarnessRunOptions {
  goal: string;
  jobPath?: string;
  runId?: string;
  outDir?: string;
  env?: Record<string, string | undefined>;
  maxContextFiles?: number;
  maxContextCharsPerFile?: number;
}

export interface HarnessStage {
  name: string;
  status: 'completed' | 'skipped' | 'blocked';
  evidence: string[];
  artifacts: string[];
}

export interface HarnessRunRecord {
  run_id: string;
  goal: string;
  created_at: string;
  status: 'advanced' | 'needs_capability' | 'blocked';
  selected_job: {
    path: string;
    job_id: string;
    reason: string;
  };
  capability_profile: HarnessCapabilityProfile;
  primitives_path: string;
  capabilities_path: string;
  information_index_path: string;
  context_pack_path: string;
  job_rankings_path: string;
  reproducibility_manifest_path: string;
  autonomy_audit_path: string;
  artifact_inventory_path: string;
  blocker_ledger_path: string;
  next_actions_path: string;
  prompt_packet_path: string;
  render_output_dir: string;
  provider_dry_runs: ProviderDryRunResult[];
  stages: HarnessStage[];
  next_actions: string[];
}

interface CliArgs {
  command: string;
  options: Record<string, string | boolean>;
}

export function buildCapabilityProfile(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessCapabilityProfile {
  const gates = {
    allow_paid_generation: envEnabled(env, 'ALLOW_PAID_GENERATION'),
    allow_browser_ui: envEnabled(env, 'ALLOW_BROWSER_UI'),
    allow_social_publishing: envEnabled(env, 'ALLOW_SOCIAL_PUBLISHING'),
  };
  const credentials: HarnessCredentialProfile = {
    openai_api_key_available: Boolean(nonEmpty(env.OPENAI_API_KEY)),
    gemini_api_key_available: Boolean(nonEmpty(env.GEMINI_API_KEY) || nonEmpty(env.GOOGLE_API_KEY)),
    lightreel_api_key_available: Boolean(nonEmpty(env.LIGHTREEL_API_KEY)),
    scrape_creators_api_key_available: Boolean(nonEmpty(env.SCRAPE_CREATORS_API_KEY)),
    doublespeed_tokens_available: fs.existsSync(path.join(rootDir, '.doublespeed-tokens.json')),
  };

  return {
    autonomy_level: gates.allow_social_publishing
      ? 'publishing_enabled'
      : gates.allow_paid_generation
        ? 'provider_enabled'
        : gates.allow_browser_ui
          ? 'browser_enabled'
          : 'local_only',
    gates,
    credentials,
    credential_policy: 'available_flags_only_no_secret_values',
  };
}

export function listCodexPrimitives(): CodexPrimitive[] {
  return [
    {
      id: 'harness.auto',
      kind: 'auto',
      command: 'npm run harness -- auto --goal "<goal>"',
      purpose: 'Run the safest local autonomous loop: diagnose the repo, select and render work, write durable artifacts, then stop at explicit capability or reproducibility gates.',
      writes: ['.ops/harness/runs/<run_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.doctor',
      kind: 'doctor',
      command: 'npm run harness -- doctor',
      purpose: 'Return a machine-readable readiness report covering repo reproducibility, capability gates, information surface, latest run, secrets, and next commands.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.repo_status',
      kind: 'inspect',
      command: 'npm run harness -- repo-status',
      purpose: 'Return branch, remote, dirty state, and untracked source-of-truth files without shelling through ad hoc status commands.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.reproducibility_manifest',
      kind: 'reproducibility',
      command: 'npm run harness -- reproducibility-manifest',
      purpose: 'Return the tracked/untracked source-of-truth boundary, generated artifact boundary, exact git add command, and verification commands for portable Codex work.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.stage_source',
      kind: 'reproducibility',
      command: 'npm run harness -- stage-source --dry-run',
      purpose: 'Preview or apply a git add operation for only manifest-classified source-of-truth files; generated artifacts remain excluded.',
      writes: ['git index when --apply is supplied'],
      required_gates: ['--apply for real git index changes'],
      autonomy: 'capability_gated',
    },
    {
      id: 'harness.source_package',
      kind: 'reproducibility',
      command: 'npm run harness -- source-package',
      purpose: 'Copy manifest-classified source-of-truth files into an ignored package directory with hashes and a verification manifest.',
      writes: ['.ops/harness/source_packages/<package_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.verify_source_package',
      kind: 'reproducibility',
      command: 'npm run harness -- verify-source-package --package .ops/harness/source_packages/<package_id>',
      purpose: 'Verify a source package by checking every copied file hash and aggregate package hash.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.autonomy_audit',
      kind: 'doctor',
      command: 'npm run harness -- autonomy-audit --goal "<goal>"',
      purpose: 'Audit the full autonomy objective against current evidence, including information primitives, local execution, reproducibility, provider, browser, and publishing gates.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.inspect',
      kind: 'inspect',
      command: 'npm run harness -- inspect',
      purpose: 'Return available jobs, provider requests, capability gates, credential availability flags, and callable primitives.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.run',
      kind: 'inspect',
      command: 'npm run harness -- run --goal "<goal>"',
      purpose: 'Create a durable autonomous run folder with selected job context, rendered package, provider dry-runs, next actions, and a Codex prompt packet.',
      writes: ['.ops/harness/runs/<run_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.rank_jobs',
      kind: 'rank',
      command: 'npm run harness -- rank-jobs',
      purpose: 'Rank incoming creative jobs by local runnability, evidence density, hook specificity, risk/comparison clarity, and output completeness.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.context_pack',
      kind: 'context',
      command: 'npm run harness -- context-pack --out .ops/harness/context_pack.json',
      purpose: 'Write a bounded, hashed context pack of source, schema, job, provider, ops, skill, report, and test excerpts for Codex to inspect.',
      writes: ['.ops/harness/context_pack.json or caller-provided --out path'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.information_index',
      kind: 'context',
      command: 'npm run harness -- information-index',
      purpose: 'Return the complete information-source map across source files, schemas, tests, jobs, provider requests, ops docs, skills, and reports.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.inventory',
      kind: 'inspect',
      command: 'npm run harness -- inventory --run .ops/harness/runs/<run_id>',
      purpose: 'Inventory a run folder with file kinds, byte sizes, and hashes so Codex can reason over existing artifacts.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.resume',
      kind: 'inspect',
      command: 'npm run harness -- resume --run .ops/harness/runs/<run_id>',
      purpose: 'Read an existing run, verify expected artifacts, and return next executable commands without recreating the run.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.latest_run',
      kind: 'inspect',
      command: 'npm run harness -- latest-run',
      purpose: 'Find and summarize the most recent harness run without requiring the caller to know its run id.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.blockers',
      kind: 'inspect',
      command: 'npm run harness -- blockers',
      purpose: 'Return a current blocker ledger for reproducibility, provider gates, browser gates, publishing gates, and credential availability.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'trend.research',
      kind: 'trend',
      command: 'npm run trend -- research --niche "<niche>" --format slideshow --db trend_examples.sqlite',
      purpose: 'Produce citation-backed trend claims from locally saved examples; returns insufficient_examples instead of inventing claims.',
      writes: ['trend_examples.sqlite when initialized or ingested separately'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'trend.brief',
      kind: 'trend',
      command: 'npm run trend -- brief --niche "<niche>" --item "<item>" --out trend_outputs/<slug> --db trend_examples.sqlite',
      purpose: 'Generate and render a local scan/value content brief when enough grounded examples exist.',
      writes: ['trend_outputs/<slug>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'creative.validate',
      kind: 'creative',
      command: 'npm run creative -- validate --job .ops/creative_jobs/incoming/<job>.json',
      purpose: 'Validate a creative job manifest and its provider, approval, and output requirements.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'creative.render',
      kind: 'creative',
      command: 'npm run creative -- render --job .ops/creative_jobs/incoming/<job>.json',
      purpose: 'Render a deterministic local review package with slides, captions, prompts, QA, and approval artifacts.',
      writes: ['.ops/creative_jobs/rendered/<job_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'provider.dry_run',
      kind: 'provider',
      command: 'npm run trend -- provider:run-dry --file .ops/provider_requests/<request>.json',
      purpose: 'Evaluate provider intent and capability gates without making external calls.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'provider.live_ready',
      kind: 'provider',
      command: 'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-dry --file .ops/provider_requests/<request>.json',
      purpose: 'Confirm whether a paid provider request is configured to move past the policy gate before a live adapter is implemented or called.',
      writes: [],
      required_gates: ['ALLOW_PAID_GENERATION=true', 'request.cost_policy.allow_paid_generation=true', 'provider API key available'],
      autonomy: 'capability_gated',
    },
    {
      id: 'browser.capture_validate',
      kind: 'browser',
      command: 'npm run trend -- browser:validate-capture --file .ops/browser/captures/reviewed/<capture>.json',
      purpose: 'Validate manual or browser-assisted research captures before ingesting them as trend examples.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'metrics.compare',
      kind: 'metrics',
      command: 'npm run metrics:compare -- --metric saves',
      purpose: 'Rank posted content by latest manually recorded metric snapshots with small-sample caveats.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'publish.boundary',
      kind: 'publish',
      command: 'ALLOW_SOCIAL_PUBLISHING=true npm run harness -- inspect',
      purpose: 'Expose that publishing remains outside the default harness until job policy, environment gate, approved assets, and account ownership are all true.',
      writes: [],
      required_gates: ['ALLOW_SOCIAL_PUBLISHING=true', 'job.provider_policy.allow_social_publishing=true', 'human-approved generated assets'],
      autonomy: 'human_boundary',
    },
  ];
}

export function buildInformationIndex(rootDir = process.cwd()): HarnessInformationSource[] {
  const sources: HarnessInformationSource[] = [];

  addKnownSource(sources, rootDir, 'source.trend_research', 'source', 'src/trend-research.ts', 'SQLite-backed trend intake, FTS search, grounded research answers, and content brief rendering.');
  addKnownSource(sources, rootDir, 'source.harness', 'source', 'src/codex-harness.ts', 'Codex-facing autonomous runner, capability profiler, primitive menu, and durable run artifact writer.');
  addKnownSource(sources, rootDir, 'source.provider_workflow', 'source', 'src/provider-workflow.ts', 'Provider request manifests, gate evaluation, dry-runs, and controlled provider output writes.');
  addKnownSource(sources, rootDir, 'source.browser_capture', 'source', 'src/browser-capture.ts', 'Manual/browser-assisted capture validation and approved capture ingestion.');
  addKnownSource(sources, rootDir, 'source.post_metrics', 'source', 'src/post-metrics.ts', 'Posted-content metric store, snapshots, comparisons, and CSV/JSON export.');
  addKnownSource(sources, rootDir, 'source.valuation_card', 'source', 'src/valuation-card.ts', 'Range-based valuation cards and unsupported exact-value claim rejection.');
  addKnownSource(sources, rootDir, 'source.creative_schema', 'source', 'packages/creative/job_schema.ts', 'Creative job schema, provider policy gates, posting gates, and secret scanning.');
  addKnownSource(sources, rootDir, 'source.local_renderer', 'source', 'packages/creative/local_renderer.ts', 'Deterministic local package renderer for slides, prompts, QA, and approval artifacts.');
  addKnownSource(sources, rootDir, 'source.provider_router', 'source', 'packages/creative/provider_router.ts', 'Creative provider router for local renderer and gated provider stubs.');

  addGlobSources(sources, rootDir, 'schema', 'schemas', '.json', 'schema', 'JSON schemas for trend examples, browser captures, providers, metrics, and valuation cards.');
  addGlobSources(sources, rootDir, 'test', 'tests', '.ts', 'test', 'Node test coverage for Codex harness, creative gates, trend research, metrics, provider workflow, and launch kit.');
  addGlobSources(sources, rootDir, 'job', path.join('.ops', 'creative_jobs', 'incoming'), '.json', 'job', 'Incoming creative job manifest Codex can validate, select, render, and continue.');
  addGlobSources(sources, rootDir, 'provider_request', path.join('.ops', 'provider_requests'), '.json', 'provider_request', 'Provider intent manifest for browser, Gemini, OpenAI, or local provider work.');
  addGlobSources(sources, rootDir, 'ops_launch', path.join('.ops', 'launch'), '.md', 'ops_doc', 'Launch, posting, metric, DM, pinned-comment, and QA operating docs.');
  addGlobSources(sources, rootDir, 'ops_browser', path.join('.ops', 'browser'), '.md', 'ops_doc', 'Browser workflow boundaries, capture template, and Creative Center protocol.');
  addGlobSources(sources, rootDir, 'ops_accounts', path.join('.ops', 'accounts'), '.md', 'ops_doc', 'Account setup, handle, profile, and launch checklist docs.');
  addGlobSources(sources, rootDir, 'skill', path.join('.codex', 'skills'), '.md', 'skill', 'Local Codex skills for creative browser research, image planning, rendering, and social setup.');
  addGlobSources(sources, rootDir, 'report', 'reports', '.md', 'report', 'Readiness audits and evidence reports.');

  return sources;
}

export function rankIncomingJobs(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessJobRanking[] {
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  return listIncomingJobs(rootDir)
    .map((item) => scoreCreativeJob(loadCreativeJobManifest(item.path), item.path, capabilityProfile))
    .sort((a, b) => b.score - a.score || a.job_id.localeCompare(b.job_id))
    .map((ranking, index) => ({ ...ranking, rank: index + 1 }));
}

export function buildContextPack(
  rootDir = process.cwd(),
  options: { maxFiles?: number; maxCharsPerFile?: number } = {},
): HarnessContextPack {
  const maxFiles = options.maxFiles ?? 80;
  const maxCharsPerFile = options.maxCharsPerFile ?? 2400;
  const sources = buildInformationIndex(rootDir)
    .sort((a, b) => contextKindPriority(a.kind) - contextKindPriority(b.kind) || a.id.localeCompare(b.id))
    .slice(0, maxFiles)
    .map((source) => packSource(source, maxCharsPerFile));

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    max_files: maxFiles,
    max_chars_per_file: maxCharsPerFile,
    source_count: sources.length,
    sources,
  };
}

export function buildArtifactInventory(rootDir: string): HarnessArtifactInventory {
  const resolvedRoot = path.resolve(rootDir);
  const artifacts = fs.existsSync(resolvedRoot)
    ? walkFiles(resolvedRoot)
      .filter((filePath) => fs.statSync(filePath).isFile())
      .sort()
      .map((filePath) => inventoryFile(resolvedRoot, filePath))
    : [];

  return {
    root_dir: resolvedRoot,
    created_at: new Date().toISOString(),
    artifact_count: artifacts.length,
    artifacts,
  };
}

export function buildBlockerLedger(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessBlockerLedger {
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const blockers: HarnessBlocker[] = [];
  const repoStatus = buildRepoStatus(rootDir);
  const dirtySource = Array.from(new Set([
    ...repoStatus.modified_source_of_truth,
    ...repoStatus.untracked_source_of_truth,
  ])).sort();

  blockers.push({
    id: 'git.reproducibility',
    severity: dirtySource.length ? 'blocker' : 'low',
    status: dirtySource.length ? 'open' : 'resolved',
    evidence: dirtySource.length
      ? [
        `${repoStatus.modified_source_of_truth_count} source-of-truth file(s) are modified or staged.`,
        `${repoStatus.untracked_source_of_truth_count} source-of-truth file(s) are untracked.`,
        ...dirtySource.slice(0, 12),
      ]
      : ['No dirty source-of-truth files found by git status.'],
    next_action: dirtySource.length
      ? 'Stage and commit the WorthScan/harness source, schemas, docs, tests, manifests, package files, and package lock before treating the harness as reproducible.'
      : 'No action needed.',
  });

  blockers.push({
    id: 'provider.paid_generation',
    severity: capabilityProfile.gates.allow_paid_generation ? 'low' : 'high',
    status: capabilityProfile.gates.allow_paid_generation ? 'resolved' : 'open',
    evidence: [
      `ALLOW_PAID_GENERATION=${capabilityProfile.gates.allow_paid_generation}`,
      `openai_api_key_available=${capabilityProfile.credentials.openai_api_key_available}`,
      `gemini_api_key_available=${capabilityProfile.credentials.gemini_api_key_available}`,
    ],
    next_action: capabilityProfile.gates.allow_paid_generation
      ? 'Route any live provider work through request manifests and keep secret values out of artifacts.'
      : 'Enable only when needed with explicit request policy, env gate, and provider credential availability.',
  });

  blockers.push({
    id: 'browser.research',
    severity: capabilityProfile.gates.allow_browser_ui ? 'low' : 'medium',
    status: capabilityProfile.gates.allow_browser_ui ? 'resolved' : 'open',
    evidence: [`ALLOW_BROWSER_UI=${capabilityProfile.gates.allow_browser_ui}`],
    next_action: capabilityProfile.gates.allow_browser_ui
      ? 'Use browser capture validation before ingesting any research evidence.'
      : 'Keep research to local/manual captures until browser UI is explicitly enabled and request policy allows it.',
  });

  blockers.push({
    id: 'publishing.social',
    severity: capabilityProfile.gates.allow_social_publishing ? 'medium' : 'high',
    status: capabilityProfile.gates.allow_social_publishing ? 'resolved' : 'open',
    evidence: [`ALLOW_SOCIAL_PUBLISHING=${capabilityProfile.gates.allow_social_publishing}`],
    next_action: capabilityProfile.gates.allow_social_publishing
      ? 'Confirm job policy, generated asset approval, and account-owner confirmation before posted ledger moves.'
      : 'Do not publish or move assets to posted until publishing is explicitly enabled and all approval gates pass.',
  });

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    blockers,
  };
}

export function resumeHarnessRun(runDir: string): HarnessResumeReport {
  const resolvedRunDir = path.resolve(runDir);
  const runPath = path.join(resolvedRunDir, 'run.json');
  if (!fs.existsSync(runPath)) {
    throw new Error(`run.json not found: ${runPath}`);
  }

  const record = JSON.parse(fs.readFileSync(runPath, 'utf8')) as HarnessRunRecord;
  const expectedArtifacts = [
    record.primitives_path,
    record.capabilities_path,
    record.information_index_path,
    record.context_pack_path,
    record.job_rankings_path,
    record.reproducibility_manifest_path,
    record.autonomy_audit_path,
    record.artifact_inventory_path,
    record.blocker_ledger_path,
    record.next_actions_path,
    record.prompt_packet_path,
    path.join(record.render_output_dir, 'manifest.json'),
  ].filter((artifactPath): artifactPath is string => typeof artifactPath === 'string' && artifactPath.length > 0);
  const missingArtifacts = expectedArtifacts.filter((artifactPath) => !fs.existsSync(artifactPath));

  return {
    run_id: record.run_id,
    run_dir: resolvedRunDir,
    status: record.status,
    selected_job: record.selected_job,
    missing_artifacts: missingArtifacts,
    artifact_inventory_path: record.artifact_inventory_path,
    blocker_ledger_path: record.blocker_ledger_path,
    reproducibility_manifest_path: record.reproducibility_manifest_path,
    autonomy_audit_path: record.autonomy_audit_path,
    next_commands: [
      `npm run harness -- inventory --run ${resolvedRunDir}`,
      `npm run harness -- autonomy-audit --goal "${record.goal.replace(/"/g, '\\"')}"`,
      `npm run harness -- reproducibility-manifest`,
      `npm run harness -- source-package`,
      `npm run harness -- blockers`,
      `npm run creative -- validate --job ${record.selected_job.path}`,
      `npm run creative -- render --job ${record.selected_job.path}`,
    ],
  };
}

export function buildRepoStatus(rootDir = process.cwd()): HarnessRepoStatus {
  const gitRoot = gitOutput(rootDir, ['rev-parse', '--show-toplevel']);
  const branch = gitOutput(rootDir, ['branch', '--show-current']);
  const upstream = gitOutput(rootDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const remoteOutput = gitOutput(rootDir, ['remote', '-v']) ?? '';
  const statusOutput = gitOutput(rootDir, ['status', '--porcelain=v1', '-uall']) ?? '';
  const statusLines = statusOutput.split(/\r?\n/).filter((line) => line.trim());
  const modified = statusLines
    .filter((line) => !line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .sort();
  const modifiedSourceOfTruth = modified.filter((filePath) => isSourceOfTruthPath(filePath));
  const untracked = statusLines
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3))
    .sort();
  const untrackedSourceOfTruth = untracked.filter((filePath) => isSourceOfTruthPath(filePath));

  return {
    root_dir: rootDir,
    git_root: gitRoot?.trim() || null,
    branch: branch?.trim() || null,
    upstream: upstream?.trim() || null,
    remotes: remoteOutput.split(/\r?\n/).filter((line) => line.trim()).sort(),
    is_git_repo: Boolean(gitRoot?.trim()),
    dirty: statusLines.length > 0,
    modified,
    modified_count: modified.length,
    modified_source_of_truth_count: modifiedSourceOfTruth.length,
    modified_source_of_truth: modifiedSourceOfTruth,
    untracked,
    untracked_count: untracked.length,
    untracked_source_of_truth_count: untrackedSourceOfTruth.length,
    untracked_source_of_truth: untrackedSourceOfTruth,
  };
}

export function buildReproducibilityManifest(rootDir = process.cwd()): HarnessReproducibilityManifest {
  const repoStatus = buildRepoStatus(rootDir);
  const trackedSource = listTrackedSourceFiles(rootDir);
  const trackedOrModified = Array.from(new Set([
    ...trackedSource,
    ...repoStatus.modified.filter((filePath) => isSourceOfTruthPath(filePath)),
  ])).sort();
  const dirtySource = Array.from(new Set([
    ...repoStatus.modified_source_of_truth,
    ...repoStatus.untracked_source_of_truth,
  ])).sort();
  const files: HarnessReproducibilityFile[] = [
    ...trackedOrModified.map((filePath) => ({
      path: filePath,
      status: 'tracked_or_modified' as const,
      role: sourceOfTruthRole(filePath),
    })),
    ...repoStatus.untracked_source_of_truth.map((filePath) => ({
      path: filePath,
      status: 'untracked' as const,
      role: sourceOfTruthRole(filePath),
    })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const stagePaths = dirtySource;

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    repo_status: repoStatus,
    source_of_truth: {
      file_count: files.length,
      tracked_or_modified_count: trackedOrModified.length,
      modified_count: repoStatus.modified_source_of_truth_count,
      untracked_count: repoStatus.untracked_source_of_truth_count,
      dirty_count: dirtySource.length,
      files,
    },
    generated_artifacts: {
      ignored_or_runtime_paths: [
        '.ops/creative_jobs/rendered/',
        '.ops/harness/',
        '.ops/harness/runs/',
        '.ops/harness/source_packages/',
        'trend_outputs/',
        'trend_examples.sqlite',
        'node_modules/',
        'dist/',
        'build/',
        'output/',
      ],
      notes: [
        'Rendered creative packages are local review artifacts and should not be required for source reproducibility.',
        'Harness run folders are durable local evidence but can be regenerated from tracked source-of-truth inputs.',
        'Database files and trend outputs are runtime artifacts unless explicitly promoted into fixtures or manifests.',
      ],
    },
    commands: {
      inspect: [
        'npm run harness -- repo-status',
        'npm run harness -- reproducibility-manifest',
        'npm run harness -- stage-source --dry-run',
        'npm run harness -- source-package',
        'git status --short --untracked-files=all',
      ],
      stage_source_of_truth: stagePaths.length ? `git add ${stagePaths.map(shellQuote).join(' ')}` : null,
      verify: [
        'npm run typecheck -- --pretty false',
        'npm test -- --runInBand',
        'npm run harness -- doctor',
      ],
    },
  };
}

export function stageSourceOfTruth(
  options: { apply?: boolean; rootDir?: string } = {},
): HarnessStageSourceReport {
  const rootDir = options.rootDir ?? process.cwd();
  const beforeManifest = buildReproducibilityManifest(rootDir);
  const stagePaths = Array.from(new Set([
    ...beforeManifest.repo_status.modified_source_of_truth,
    ...beforeManifest.repo_status.untracked_source_of_truth,
  ])).sort();
  const warnings: string[] = [];

  if (!beforeManifest.repo_status.is_git_repo) {
    warnings.push('Not a git repository; no staging command can be applied.');
  }
  if (!stagePaths.length) {
    warnings.push('No dirty source-of-truth files found.');
  }

  const command = stagePaths.length ? `git add ${stagePaths.map(shellQuote).join(' ')}` : null;
  if (options.apply && stagePaths.length) {
    execFileSync('git', ['add', ...stagePaths], {
      cwd: rootDir,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  }

  const afterManifest = options.apply ? buildReproducibilityManifest(rootDir) : undefined;
  const result: HarnessStageSourceReport = {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    dry_run: !options.apply,
    applied: Boolean(options.apply && stagePaths.length),
    before: {
      modified_source_of_truth_count: beforeManifest.repo_status.modified_source_of_truth_count,
      untracked_source_of_truth_count: beforeManifest.repo_status.untracked_source_of_truth_count,
      dirty_source_of_truth_count: beforeManifest.source_of_truth.dirty_count,
    },
    staged_paths: stagePaths,
    excluded_generated_paths: beforeManifest.generated_artifacts.ignored_or_runtime_paths,
    command,
    warnings,
  };

  if (afterManifest) {
    result.after = {
      modified_source_of_truth_count: afterManifest.repo_status.modified_source_of_truth_count,
      untracked_source_of_truth_count: afterManifest.repo_status.untracked_source_of_truth_count,
      dirty_source_of_truth_count: afterManifest.source_of_truth.dirty_count,
    };
  }

  return result;
}

export function exportSourcePackage(
  options: { rootDir?: string; outDir?: string; packageId?: string } = {},
): HarnessSourcePackageReport {
  const rootDir = options.rootDir ?? process.cwd();
  const createdAt = new Date().toISOString();
  const packageId = options.packageId ?? createPackageId(createdAt);
  const packageDir = path.resolve(options.outDir ?? path.join(rootDir, '.ops', 'harness', 'source_packages', packageId));
  const filesDir = path.join(packageDir, 'files');

  if (fs.existsSync(packageDir) && fs.readdirSync(packageDir).length > 0) {
    throw new Error(`source package output directory already exists and is not empty: ${packageDir}`);
  }

  const reproducibilityManifest = buildReproducibilityManifest(rootDir);
  const sourceFiles = reproducibilityManifest.source_of_truth.files;
  fs.mkdirSync(filesDir, { recursive: true });

  const files: HarnessSourcePackageFile[] = [];
  for (const sourceFile of sourceFiles) {
    const sourcePath = path.join(rootDir, sourceFile.path);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`source-of-truth file is missing and cannot be packaged: ${sourceFile.path}`);
    }
    const packagePath = path.join(filesDir, sourceFile.path);
    fs.mkdirSync(path.dirname(packagePath), { recursive: true });
    fs.copyFileSync(sourcePath, packagePath);
    const content = fs.readFileSync(packagePath);
    files.push({
      source_path: sourceFile.path,
      package_path: path.relative(packageDir, packagePath),
      role: sourceFile.role,
      size_bytes: content.byteLength,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    });
  }

  const aggregateSha256 = aggregateFileHashes(files);
  const reproducibilityManifestPath = path.join(packageDir, 'reproducibility_manifest.json');
  const manifestPath = path.join(packageDir, 'source_package.json');
  const report: HarnessSourcePackageReport = {
    created_at: createdAt,
    root_dir: rootDir,
    package_dir: packageDir,
    files_dir: filesDir,
    manifest_path: manifestPath,
    reproducibility_manifest_path: reproducibilityManifestPath,
    source_file_count: files.length,
    dirty_source_file_count: reproducibilityManifest.source_of_truth.dirty_count,
    aggregate_sha256: aggregateSha256,
    files,
    excluded_generated_paths: reproducibilityManifest.generated_artifacts.ignored_or_runtime_paths,
    verify_command: `npm run harness -- verify-source-package --package ${shellQuote(packageDir)}`,
  };

  fs.writeFileSync(reproducibilityManifestPath, `${JSON.stringify(reproducibilityManifest, null, 2)}\n`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifySourcePackage(packageDir: string): HarnessSourcePackageVerification {
  const resolvedPackageDir = path.resolve(packageDir);
  const manifestPath = path.join(resolvedPackageDir, 'source_package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`source_package.json not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as HarnessSourcePackageReport;
  const missingFiles: string[] = [];
  const hashMismatches: HarnessSourcePackageVerification['hash_mismatches'] = [];
  const actualFiles: HarnessSourcePackageFile[] = [];

  for (const file of manifest.files) {
    const packagePath = path.join(resolvedPackageDir, file.package_path);
    if (!fs.existsSync(packagePath)) {
      missingFiles.push(file.package_path);
      continue;
    }
    const content = fs.readFileSync(packagePath);
    const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
    actualFiles.push({ ...file, size_bytes: content.byteLength, sha256: actualSha256 });
    if (actualSha256 !== file.sha256) {
      hashMismatches.push({
        path: file.package_path,
        expected_sha256: file.sha256,
        actual_sha256: actualSha256,
      });
    }
  }

  const aggregateSha256 = missingFiles.length ? null : aggregateFileHashes(actualFiles);
  if (aggregateSha256 && aggregateSha256 !== manifest.aggregate_sha256) {
    hashMismatches.push({
      path: 'source_package.aggregate',
      expected_sha256: manifest.aggregate_sha256,
      actual_sha256: aggregateSha256,
    });
  }

  return {
    package_dir: resolvedPackageDir,
    manifest_path: manifestPath,
    ok: missingFiles.length === 0 && hashMismatches.length === 0,
    source_file_count: manifest.source_file_count,
    aggregate_sha256: aggregateSha256,
    missing_files: missingFiles,
    hash_mismatches: hashMismatches,
  };
}

export function buildAutonomyAudit(
  goal = 'Make WorthScan autonomous for Codex',
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessAutonomyAudit {
  const repoStatus = buildRepoStatus(rootDir);
  const reproducibility = buildReproducibilityManifest(rootDir);
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const primitives = listCodexPrimitives();
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  const incomingJobs = listIncomingJobs(rootDir);
  const providerRequests = listProviderRequests(rootDir);
  const informationSources = buildInformationIndex(rootDir);
  const secretFindings = scanRepositoryForSecrets(rootDir);
  const dirtySourceCount = reproducibility.source_of_truth.dirty_count;
  const hasProviderCredential = capabilityProfile.credentials.openai_api_key_available
    || capabilityProfile.credentials.gemini_api_key_available
    || capabilityProfile.credentials.lightreel_api_key_available
    || capabilityProfile.credentials.scrape_creators_api_key_available;
  const requiredInformationPrimitives = [
    'harness.inspect',
    'harness.doctor',
    'harness.repo_status',
    'harness.reproducibility_manifest',
    'harness.autonomy_audit',
    'harness.source_package',
    'harness.verify_source_package',
    'harness.information_index',
    'harness.context_pack',
    'harness.rank_jobs',
    'harness.resume',
    'harness.inventory',
    'harness.blockers',
  ];
  const missingInformationPrimitives = requiredInformationPrimitives.filter((id) => !primitiveIds.has(id));
  const criteria: HarnessAutonomyAuditCriterion[] = [
    {
      id: 'codex.information_primitives',
      status: missingInformationPrimitives.length ? 'open' : 'passed',
      evidence: missingInformationPrimitives.length
        ? [`Missing primitive id(s): ${missingInformationPrimitives.join(', ')}`]
        : [`${requiredInformationPrimitives.length} required information primitive(s) are available.`],
      next_action: missingInformationPrimitives.length
        ? 'Add missing primitive commands before treating the harness as Codex-operable.'
        : 'Use npm run harness -- primitives for the callable command menu.',
    },
    {
      id: 'codex.local_execution',
      status: incomingJobs.length && secretFindings.length === 0 ? 'passed' : 'blocked',
      evidence: [
        `incoming_job_count=${incomingJobs.length}`,
        `secret_finding_count=${secretFindings.length}`,
        `top_ranked_job=${rankIncomingJobs(env, rootDir)[0]?.job_id ?? 'none'}`,
      ],
      next_action: incomingJobs.length && secretFindings.length === 0
        ? 'Run npm run harness -- auto --goal "<goal>" for the next bounded local pass.'
        : 'Add at least one valid incoming job and clear secret findings before autonomous local execution.',
    },
    {
      id: 'codex.reproducibility',
      status: dirtySourceCount ? 'blocked' : 'passed',
      evidence: dirtySourceCount
        ? [
          `${repoStatus.modified_source_of_truth_count} source-of-truth file(s) are modified or staged.`,
          `${repoStatus.untracked_source_of_truth_count} source-of-truth file(s) are untracked.`,
          `stage_source_of_truth=${reproducibility.commands.stage_source_of_truth}`,
        ]
        : ['No dirty source-of-truth files found.'],
      next_action: dirtySourceCount
        ? 'Stage and commit the manifest-listed source-of-truth files, then rerun npm run harness -- autonomy-audit --goal "<goal>".'
        : 'Keep generated artifacts out of git unless intentionally promoted.',
    },
    {
      id: 'codex.provider_autonomy',
      status: capabilityProfile.gates.allow_paid_generation && hasProviderCredential ? 'passed' : 'open',
      evidence: [
        `ALLOW_PAID_GENERATION=${capabilityProfile.gates.allow_paid_generation}`,
        `provider_credential_available=${hasProviderCredential}`,
        `provider_request_count=${providerRequests.length}`,
      ],
      next_action: capabilityProfile.gates.allow_paid_generation && hasProviderCredential
        ? 'Route live provider work through provider request manifests and keep secret values out of artifacts.'
        : 'Stay in dry-run/local mode until a provider key and explicit ALLOW_PAID_GENERATION gate are present.',
    },
    {
      id: 'codex.browser_autonomy',
      status: capabilityProfile.gates.allow_browser_ui ? 'passed' : 'open',
      evidence: [`ALLOW_BROWSER_UI=${capabilityProfile.gates.allow_browser_ui}`],
      next_action: capabilityProfile.gates.allow_browser_ui
        ? 'Validate browser captures before ingesting them into trend evidence.'
        : 'Use local/manual capture files until browser UI automation is explicitly enabled.',
    },
    {
      id: 'codex.publishing_autonomy',
      status: capabilityProfile.gates.allow_social_publishing ? 'passed' : 'open',
      evidence: [`ALLOW_SOCIAL_PUBLISHING=${capabilityProfile.gates.allow_social_publishing}`],
      next_action: capabilityProfile.gates.allow_social_publishing
        ? 'Require approved assets, job policy approval, and account-owner confirmation before marking items posted.'
        : 'Keep social publishing at the human confirmation boundary.',
    },
    {
      id: 'codex.information_surface',
      status: informationSources.length >= 20 ? 'passed' : 'open',
      evidence: [
        `information_source_count=${informationSources.length}`,
        `schema_count=${informationSources.filter((source) => source.kind === 'schema').length}`,
        `test_count=${informationSources.filter((source) => source.kind === 'test').length}`,
      ],
      next_action: informationSources.length >= 20
        ? 'Use npm run harness -- context-pack for bounded source excerpts.'
        : 'Add more schemas, ops docs, provider requests, or tests to improve Codex context.',
    },
  ];
  const hasBlocked = criteria.some((criterion) => criterion.status === 'blocked');
  const hasOpenCapability = criteria.some((criterion) => criterion.status === 'open' && criterion.id.includes('autonomy'));
  const summaryStatus: HarnessAutonomyAudit['summary_status'] = hasBlocked
    ? dirtySourceCount
      ? 'needs_reproducibility'
      : 'blocked'
    : hasOpenCapability
      ? 'needs_capability'
      : 'local_autonomy_ready';

  return {
    created_at: new Date().toISOString(),
    goal,
    root_dir: rootDir,
    summary_status: summaryStatus,
    criteria,
    next_commands: [
      'npm run harness -- reproducibility-manifest',
      'npm run harness -- stage-source --dry-run',
      'npm run harness -- source-package',
      'npm run harness -- doctor',
      'npm run harness -- auto --goal "<goal>"',
      ...reproducibility.commands.verify,
    ],
  };
}

export function findLatestHarnessRun(rootDir = process.cwd()): HarnessResumeReport | null {
  const runsDir = path.join(rootDir, '.ops', 'harness', 'runs');
  if (!fs.existsSync(runsDir)) return null;

  const candidates = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'run.json')))
    .map((dir) => ({ dir, mtimeMs: fs.statSync(path.join(dir, 'run.json')).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const candidate of candidates) {
    try {
      return resumeHarnessRun(candidate.dir);
    } catch {
      // Ignore malformed run folders; the doctor should still report the best usable run.
    }
  }
  return null;
}

export function buildHarnessDoctor(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessDoctorReport {
  const repoStatus = buildRepoStatus(rootDir);
  const reproducibilityManifest = buildReproducibilityManifest(rootDir);
  const autonomyAudit = buildAutonomyAudit('Make WorthScan autonomous for Codex', env, rootDir);
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const blockerLedger = buildBlockerLedger(env, rootDir);
  const informationSources = buildInformationIndex(rootDir);
  const incomingJobs = listIncomingJobs(rootDir);
  const providerRequests = listProviderRequests(rootDir);
  const secretFindings = scanRepositoryForSecrets(rootDir);
  const byKind = informationSources.reduce(
    (counts, source) => {
      counts[source.kind] = (counts[source.kind] ?? 0) + 1;
      return counts;
    },
    {} as Record<HarnessInformationSource['kind'], number>,
  );
  const hasProviderCredential = capabilityProfile.credentials.openai_api_key_available
    || capabilityProfile.credentials.gemini_api_key_available
    || capabilityProfile.credentials.lightreel_api_key_available
    || capabilityProfile.credentials.scrape_creators_api_key_available;
  const localAutonomy = incomingJobs.length > 0 && secretFindings.length === 0;
  const recommendedCommands = [
    'npm run harness -- autonomy-audit --goal "<goal>"',
    'npm run harness -- reproducibility-manifest',
    'npm run harness -- stage-source --dry-run',
    'npm run harness -- source-package',
    'npm run harness -- rank-jobs',
    'npm run harness -- run --goal "<goal>"',
    'npm run harness -- blockers',
  ];

  if (repoStatus.untracked_source_of_truth_count) {
    recommendedCommands.unshift('git status --short --untracked-files=all');
  }
  const latestRun = findLatestHarnessRun(rootDir);
  if (latestRun) {
    recommendedCommands.push(`npm run harness -- resume --run ${latestRun.run_dir}`);
  }

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    repo_status: repoStatus,
    reproducibility_manifest: reproducibilityManifest,
    autonomy_audit: autonomyAudit,
    capability_profile: capabilityProfile,
    blocker_ledger: blockerLedger,
    information_surface: {
      source_count: informationSources.length,
      by_kind: byKind,
    },
    incoming_job_count: incomingJobs.length,
    provider_request_count: providerRequests.length,
    latest_run: latestRun,
    secret_scan: {
      status: secretFindings.length ? 'blocked' : 'clear',
      finding_count: secretFindings.length,
    },
    readiness: {
      local_autonomy: localAutonomy,
      browser_autonomy: localAutonomy && capabilityProfile.gates.allow_browser_ui,
      provider_autonomy: localAutonomy && capabilityProfile.gates.allow_paid_generation && hasProviderCredential,
      publishing_autonomy: localAutonomy && capabilityProfile.gates.allow_social_publishing,
    },
    recommended_commands: recommendedCommands,
  };
}

export function inspectHarness(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): {
  repo_status: HarnessRepoStatus;
  reproducibility_manifest: HarnessReproducibilityManifest;
  autonomy_audit: HarnessAutonomyAudit;
  capability_profile: HarnessCapabilityProfile;
  primitives: CodexPrimitive[];
  information_sources: HarnessInformationSource[];
  job_rankings: HarnessJobRanking[];
  blocker_ledger: HarnessBlockerLedger;
  latest_run: HarnessResumeReport | null;
  incoming_jobs: Array<{ job_id: string; path: string }>;
  provider_requests: Array<{ request_id: string; provider: CreativeProviderName; path: string; status: string }>;
} {
  return {
    repo_status: buildRepoStatus(rootDir),
    reproducibility_manifest: buildReproducibilityManifest(rootDir),
    autonomy_audit: buildAutonomyAudit('Make WorthScan autonomous for Codex', env, rootDir),
    capability_profile: buildCapabilityProfile(env, rootDir),
    primitives: listCodexPrimitives(),
    information_sources: buildInformationIndex(rootDir),
    job_rankings: rankIncomingJobs(env, rootDir),
    blocker_ledger: buildBlockerLedger(env, rootDir),
    latest_run: findLatestHarnessRun(rootDir),
    incoming_jobs: listIncomingJobs(rootDir),
    provider_requests: listProviderRequests(rootDir),
  };
}

export async function runCodexHarness(options: HarnessRunOptions): Promise<HarnessRunRecord> {
  if (!options.goal.trim()) throw new Error('goal must be a non-empty string.');

  const rootDir = process.cwd();
  const createdAt = new Date().toISOString();
  const runId = options.runId || createRunId(options.goal, createdAt);
  const runDir = path.resolve(options.outDir || path.join(DEFAULT_HARNESS_RUNS_DIR, runId));
  fs.mkdirSync(runDir, { recursive: true });

  const capabilityProfile = buildCapabilityProfile(options.env ?? process.env, rootDir);
  const selected = selectCreativeJob(options.jobPath, rootDir, capabilityProfile);
  const stages: HarnessStage[] = [];

  const contextDir = path.join(runDir, 'context');
  const providerDir = path.join(runDir, 'providers');
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(providerDir, { recursive: true });

  const selectedJobPath = path.join(contextDir, 'selected_job.json');
  fs.writeFileSync(selectedJobPath, `${JSON.stringify(selected.job, null, 2)}\n`);
  stages.push({
    name: 'select_job',
    status: 'completed',
    evidence: [`Selected ${selected.job.job_id}: ${selected.reason}`],
    artifacts: [selectedJobPath],
  });

  const secretFindings = scanRepositoryForSecrets(rootDir);
  const secretScanPath = path.join(contextDir, 'secret_scan.json');
  fs.writeFileSync(secretScanPath, `${JSON.stringify({ findings: secretFindings }, null, 2)}\n`);
  stages.push({
    name: 'secret_scan',
    status: secretFindings.length ? 'blocked' : 'completed',
    evidence: secretFindings.length
      ? [`Found ${secretFindings.length} secret-like value(s); inspect ${secretScanPath}.`]
      : ['No secret-like values found in git candidate text files.'],
    artifacts: [secretScanPath],
  });

  const renderDir = path.join(runDir, 'rendered', selected.job.job_id);
  const renderResult = await runCreativeProvider('local_renderer', selected.job, {
    outDir: renderDir,
    env: options.env ?? process.env,
  });
  if (renderResult.status !== 'rendered') {
    throw new Error(`local renderer returned unexpected status: ${renderResult.status}`);
  }
  stages.push({
    name: 'render_local_package',
    status: 'completed',
    evidence: [`Rendered ${selected.job.job_id} into ${renderResult.render.output_dir}.`],
    artifacts: [
      renderResult.render.rendered_manifest_path,
      renderResult.render.caption_path,
      renderResult.render.posting_notes_path,
      renderResult.render.qa_checklist_path,
    ],
  });

  const providerDryRuns = runProviderRequests(providerDir, options.env ?? process.env, rootDir);
  stages.push({
    name: 'provider_gate_evaluation',
    status: providerDryRuns.some((result) => result.status === 'blocked') ? 'blocked' : 'completed',
    evidence: providerDryRuns.length
      ? providerDryRuns.map((result) => `${result.request_id}: ${result.status}; external_calls_made=${result.external_calls_made}`)
      : ['No provider request manifests found.'],
    artifacts: providerDryRuns.map((result) => path.join(providerDir, `${result.request_id}.json`)),
  });

  const primitivesPath = path.join(runDir, 'primitives.json');
  const capabilitiesPath = path.join(runDir, 'capabilities.json');
  const informationIndexPath = path.join(runDir, 'information_index.json');
  const contextPackPath = path.join(runDir, 'context_pack.json');
  const jobRankingsPath = path.join(runDir, 'job_rankings.json');
  const reproducibilityManifestPath = path.join(runDir, 'reproducibility_manifest.json');
  const autonomyAuditPath = path.join(runDir, 'autonomy_audit.json');
  const artifactInventoryPath = path.join(runDir, 'artifact_inventory.json');
  const blockerLedgerPath = path.join(runDir, 'blocker_ledger.json');
  const nextActionsPath = path.join(runDir, 'next_actions.json');
  const promptPacketPath = path.join(runDir, 'codex_next_prompt.md');
  const nextActions = buildNextActions(selected.job, capabilityProfile, providerDryRuns, secretFindings.length);
  const informationIndex = buildInformationIndex(rootDir);
  const contextPack = buildContextPack(rootDir, {
    maxFiles: options.maxContextFiles,
    maxCharsPerFile: options.maxContextCharsPerFile,
  });
  const jobRankings = rankIncomingJobs(options.env ?? process.env, rootDir);
  const reproducibilityManifest = buildReproducibilityManifest(rootDir);
  const autonomyAudit = buildAutonomyAudit(options.goal, options.env ?? process.env, rootDir);
  const blockerLedger = buildBlockerLedger(options.env ?? process.env, rootDir);

  fs.writeFileSync(primitivesPath, `${JSON.stringify(listCodexPrimitives(), null, 2)}\n`);
  fs.writeFileSync(capabilitiesPath, `${JSON.stringify(capabilityProfile, null, 2)}\n`);
  fs.writeFileSync(informationIndexPath, `${JSON.stringify(informationIndex, null, 2)}\n`);
  fs.writeFileSync(contextPackPath, `${JSON.stringify(contextPack, null, 2)}\n`);
  fs.writeFileSync(jobRankingsPath, `${JSON.stringify(jobRankings, null, 2)}\n`);
  fs.writeFileSync(reproducibilityManifestPath, `${JSON.stringify(reproducibilityManifest, null, 2)}\n`);
  fs.writeFileSync(autonomyAuditPath, `${JSON.stringify(autonomyAudit, null, 2)}\n`);
  fs.writeFileSync(blockerLedgerPath, `${JSON.stringify(blockerLedger, null, 2)}\n`);
  fs.writeFileSync(nextActionsPath, `${JSON.stringify({ run_id: runId, next_actions: nextActions }, null, 2)}\n`);
  fs.writeFileSync(promptPacketPath, renderPromptPacket(options.goal, selected.job, nextActions, capabilityProfile));
  const artifactInventory = buildArtifactInventory(runDir);
  fs.writeFileSync(artifactInventoryPath, `${JSON.stringify(artifactInventory, null, 2)}\n`);

  const record: HarnessRunRecord = {
    run_id: runId,
    goal: options.goal,
    created_at: createdAt,
    status: secretFindings.length ? 'blocked' : providerDryRuns.some((result) => result.status === 'blocked') ? 'needs_capability' : 'advanced',
    selected_job: {
      path: selected.path,
      job_id: selected.job.job_id,
      reason: selected.reason,
    },
    capability_profile: capabilityProfile,
    primitives_path: primitivesPath,
    capabilities_path: capabilitiesPath,
    information_index_path: informationIndexPath,
    context_pack_path: contextPackPath,
    job_rankings_path: jobRankingsPath,
    reproducibility_manifest_path: reproducibilityManifestPath,
    autonomy_audit_path: autonomyAuditPath,
    artifact_inventory_path: artifactInventoryPath,
    blocker_ledger_path: blockerLedgerPath,
    next_actions_path: nextActionsPath,
    prompt_packet_path: promptPacketPath,
    render_output_dir: renderDir,
    provider_dry_runs: providerDryRuns,
    stages,
    next_actions: nextActions,
  };

  const runPath = path.join(runDir, 'run.json');
  fs.writeFileSync(runPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function runCodexAutonomy(options: HarnessRunOptions): Promise<HarnessAutoResult> {
  if (!options.goal.trim()) throw new Error('goal must be a non-empty string.');

  const run = await runCodexHarness(options);
  const runDir = path.dirname(run.prompt_packet_path);
  const resume = resumeHarnessRun(runDir);
  const doctor = buildHarnessDoctor(options.env ?? process.env, process.cwd());
  const openBlockers = doctor.blocker_ledger.blockers.filter((blocker) => blocker.status === 'open');
  const hasHardOpenBlocker = openBlockers.some((blocker) => blocker.severity === 'blocker' || blocker.severity === 'high');
  const status: HarnessRunRecord['status'] = run.status === 'blocked'
    ? 'blocked'
    : hasHardOpenBlocker
      ? 'needs_capability'
      : run.status;
  const stopReason = openBlockers.length
    ? `Stopped at open gates: ${openBlockers.map((blocker) => blocker.id).join(', ')}.`
    : 'No open blocker ledger entries after the local harness run.';
  const nextCommands = [
    `npm run harness -- resume --run ${runDir}`,
    `npm run harness -- inventory --run ${runDir}`,
    `npm run harness -- autonomy-audit --goal "${options.goal.replace(/"/g, '\\"')}"`,
    'npm run harness -- reproducibility-manifest',
    'npm run harness -- stage-source --dry-run',
    'npm run harness -- source-package',
    'npm run harness -- doctor',
    ...resume.next_commands,
  ];
  if (doctor.repo_status.untracked_source_of_truth_count) {
    nextCommands.unshift('git status --short --untracked-files=all');
  }

  const autoResultPath = path.join(runDir, 'auto_result.json');
  const result: HarnessAutoResult = {
    created_at: new Date().toISOString(),
    goal: options.goal,
    status,
    auto_result_path: autoResultPath,
    decision: {
      action: 'ran_local_harness',
      reason: `Selected ${run.selected_job.job_id} and completed the local render/provider-gate pass.`,
      stop_reason: stopReason,
    },
    doctor,
    run,
    resume,
    next_commands: Array.from(new Set(nextCommands)),
  };

  fs.writeFileSync(autoResultPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(run.artifact_inventory_path, `${JSON.stringify(buildArtifactInventory(runDir), null, 2)}\n`);
  return result;
}

function selectCreativeJob(
  jobPath: string | undefined,
  rootDir: string,
  capabilityProfile: HarnessCapabilityProfile,
): { path: string; job: CreativeJobManifest; reason: string } {
  if (jobPath) {
    const resolved = path.resolve(jobPath);
    return {
      path: resolved,
      job: loadCreativeJobManifest(resolved),
      reason: 'explicit job path supplied by caller',
    };
  }

  const rankings = rankIncomingJobs({
    ALLOW_PAID_GENERATION: String(capabilityProfile.gates.allow_paid_generation),
    ALLOW_BROWSER_UI: String(capabilityProfile.gates.allow_browser_ui),
    ALLOW_SOCIAL_PUBLISHING: String(capabilityProfile.gates.allow_social_publishing),
  }, rootDir);
  const best = rankings[0];
  if (best) {
    return {
      path: best.path,
      job: loadCreativeJobManifest(best.path),
      reason: `highest harness rank (${best.score}): ${best.reasons.slice(0, 3).join('; ')}`,
    };
  }

  const jobs = listIncomingJobs(rootDir);
  if (!jobs.length) throw new Error('No incoming creative job manifests found.');
  return {
    path: jobs[0].path,
    job: loadCreativeJobManifest(jobs[0].path),
    reason: 'first sorted incoming job manifest',
  };
}

function listIncomingJobs(rootDir: string): Array<{ job_id: string; path: string }> {
  const incomingDir = path.join(rootDir, '.ops', 'creative_jobs', 'incoming');
  if (!fs.existsSync(incomingDir)) return [];
  return fs.readdirSync(incomingDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const filePath = path.join(incomingDir, file);
      const job = loadCreativeJobManifest(filePath);
      return { job_id: job.job_id, path: filePath };
    });
}

function listProviderRequests(rootDir: string): Array<{ request_id: string; provider: CreativeProviderName; path: string; status: string }> {
  const requestDir = path.join(rootDir, '.ops', 'provider_requests');
  if (!fs.existsSync(requestDir)) return [];
  return fs.readdirSync(requestDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const filePath = path.join(requestDir, file);
      const request = loadProviderRequestManifest(filePath);
      return {
        request_id: request.request_id,
        provider: request.provider,
        path: filePath,
        status: request.status,
      };
    });
}

function runProviderRequests(
  providerDir: string,
  env: Record<string, string | undefined>,
  rootDir: string,
): ProviderDryRunResult[] {
  const requestDir = path.join(rootDir, '.ops', 'provider_requests');
  if (!fs.existsSync(requestDir)) return [];

  const results: ProviderDryRunResult[] = [];
  for (const file of fs.readdirSync(requestDir).filter((entry) => entry.endsWith('.json')).sort()) {
    const requestPath = path.join(requestDir, file);
    const request: ProviderRequestManifest = loadProviderRequestManifest(requestPath);
    const result = runProviderDryRun(request, { env });
    fs.writeFileSync(path.join(providerDir, `${request.request_id}.json`), `${JSON.stringify(result, null, 2)}\n`);
    results.push(result);
  }
  return results;
}

function scoreCreativeJob(
  job: CreativeJobManifest,
  filePath: string,
  capabilityProfile: HarnessCapabilityProfile,
): HarnessJobRanking {
  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = 0;

  if (job.provider_policy.approved_providers.includes('local_renderer')) {
    score += 25;
    reasons.push('local renderer approved');
  } else {
    blockers.push('local renderer is not approved');
  }

  if (job.trend_examples.length >= 3) {
    score += 18;
    reasons.push(`${job.trend_examples.length} trend examples`);
  } else {
    blockers.push('fewer than 3 trend examples');
    score += job.trend_examples.length * 4;
  }

  if (job.source_inputs.length >= 3) {
    score += 10;
    reasons.push(`${job.source_inputs.length} source inputs`);
  }

  if (job.output_requirements.slide_count === 5 && job.output_requirements.slides.length === 5) {
    score += 12;
    reasons.push('complete 5-slide output plan');
  }

  if (job.job_id.startsWith('worthscan_')) {
    score += 8;
    reasons.push('campaign-specific WorthScan manifest');
  }

  const combinedText = [
    job.niche,
    job.content_type,
    ...job.source_inputs.map((input) => `${input.label} ${input.value ?? ''} ${input.notes ?? ''}`),
    ...job.trend_examples.map((example) => `${example.hook} ${example.notes}`),
    ...job.output_requirements.slides.map((slide) => `${slide.on_screen_text} ${slide.visual_direction}`),
    job.output_requirements.caption,
    job.output_requirements.spoken_script,
    ...job.output_requirements.posting_notes,
    ...job.qa_notes,
  ].join('\n').toLowerCase();

  const concreteRiskCount = countMatches(
    combinedText,
    /\b(?:battery|charger|lock|authenticity|serial|fret|pickup|smell|odor|stain|missing|wear|repair|risk)\b/g,
  );
  if (concreteRiskCount > 0) {
    const points = Math.min(concreteRiskCount, 24);
    score += points;
    reasons.push(`${concreteRiskCount} concrete risk signal${concreteRiskCount === 1 ? '' : 's'}`);
  }

  const scoredSignals: Array<[RegExp, number, string]> = [
    [/\bbattery\b|\bcharger\b|\block\b|\bauthenticity\b|\bserial\b/, 12, 'specific hidden-risk hook'],
    [/\brisk\b|\bsubtract\b|\bmissing\b|\bwear\b|\brepair\b/, 10, 'explicit risk subtraction'],
    [/\bcomp\b|\bcompare\b|\bthree local\b/, 10, 'comparison proof'],
    [/\brange\b|\bconfidence\b|\bnot a guarantee\b|\bestimate\b/, 8, 'range-based valuation boundary'],
    [/\bcomment\b|\bscan\b/, 6, 'viewer CTA present'],
    [/\bbefore\b|\btrap\b|\bfools you\b|\beats the deal\b/, 6, 'first-frame tension'],
  ];
  for (const [pattern, points, reason] of scoredSignals) {
    if (pattern.test(combinedText)) {
      score += points;
      reasons.push(reason);
    }
  }

  if (job.provider_policy.allow_paid_generation && !capabilityProfile.gates.allow_paid_generation) {
    blockers.push('paid generation policy needs ALLOW_PAID_GENERATION=true');
    score -= 20;
  }
  if (job.provider_policy.allow_browser_ui && !capabilityProfile.gates.allow_browser_ui) {
    blockers.push('browser UI policy needs ALLOW_BROWSER_UI=true');
    score -= 12;
  }
  if (job.provider_policy.allow_social_publishing && !capabilityProfile.gates.allow_social_publishing) {
    blockers.push('social publishing policy needs ALLOW_SOCIAL_PUBLISHING=true');
    score -= 18;
  }
  if (job.provider_policy.account_automation_allowed !== false) {
    blockers.push('account automation policy is not false');
    score -= 50;
  }
  if (job.approval_status.state !== 'draft') {
    score -= 5;
    reasons.push(`approval state is ${job.approval_status.state}`);
  }

  return {
    rank: 0,
    job_id: job.job_id,
    path: filePath,
    score,
    runnable_now: blockers.length === 0,
    reasons,
    blockers,
  };
}

function addKnownSource(
  sources: HarnessInformationSource[],
  rootDir: string,
  id: string,
  kind: HarnessInformationSource['kind'],
  relativePath: string,
  role: string,
): void {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  sources.push({ id, kind, path: absolutePath, role });
}

function addGlobSources(
  sources: HarnessInformationSource[],
  rootDir: string,
  idPrefix: string,
  relativeDir: string,
  extension: string,
  kind: HarnessInformationSource['kind'],
  role: string,
): void {
  const dir = path.join(rootDir, relativeDir);
  if (!fs.existsSync(dir)) return;

  for (const file of walkFiles(dir).filter((filePath) => filePath.endsWith(extension)).sort()) {
    const relativePath = path.relative(rootDir, file);
    const slug = relativePath.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
    sources.push({
      id: `${idPrefix}.${slug}`,
      kind,
      path: file,
      role,
    });
  }
}

function walkFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function inventoryFile(rootDir: string, filePath: string): HarnessArtifactInventoryItem {
  const content = fs.readFileSync(filePath);
  const relativePath = path.relative(rootDir, filePath);
  return {
    path: filePath,
    relative_path: relativePath,
    kind: artifactKind(filePath),
    size_bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

function artifactKind(filePath: string): HarnessArtifactInventoryItem['kind'] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.md') return 'markdown';
  if (extension === '.txt') return 'text';
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return 'image';
  return 'other';
}

function gitOutput(rootDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function listTrackedSourceFiles(rootDir: string): string[] {
  const output = gitOutput(rootDir, ['ls-files']) ?? '';
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((filePath) => isSourceOfTruthPath(filePath))
    .sort();
}

function listUntrackedSourceFiles(rootDir: string): string[] {
  let output = '';
  try {
    output = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return ['git status failed; reproducibility could not be verified'];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3))
    .filter((filePath) => isSourceOfTruthPath(filePath))
    .sort();
}

function isSourceOfTruthPath(filePath: string): boolean {
  if (filePath === '.ops/creative_jobs/rendered/.gitignore') {
    return true;
  }

  if (
    filePath.includes('/rendered/')
    || filePath.startsWith('.ops/harness/')
    || filePath.startsWith('trend_outputs/')
    || filePath === 'trend_examples.sqlite'
    || filePath.includes('/node_modules/')
    || filePath.includes('/dist/')
    || filePath.includes('/build/')
    || filePath.includes('/output/')
  ) {
    return false;
  }

  return (
    filePath.startsWith('.ops/')
    || filePath.startsWith('.codex/skills/')
    || filePath.startsWith('src/')
    || filePath.startsWith('packages/')
    || filePath.startsWith('schemas/')
    || filePath.startsWith('tests/')
    || filePath.startsWith('reports/')
    || ['.gitignore', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json'].includes(filePath)
  );
}

function sourceOfTruthRole(filePath: string): string {
  if (filePath.startsWith('src/')) return 'application and harness source';
  if (filePath.startsWith('packages/')) return 'creative package source';
  if (filePath.startsWith('schemas/')) return 'validation schema';
  if (filePath.startsWith('tests/')) return 'verification test';
  if (filePath.startsWith('.ops/creative_jobs/incoming/')) return 'incoming creative job manifest';
  if (filePath === '.ops/creative_jobs/rendered/.gitignore') return 'generated render output boundary';
  if (filePath.startsWith('.ops/provider_requests/')) return 'provider request manifest';
  if (filePath.startsWith('.ops/launch/')) return 'launch operating document';
  if (filePath.startsWith('.ops/accounts/')) return 'account setup operating document';
  if (filePath.startsWith('.ops/browser/')) return 'browser research operating document or fixture';
  if (filePath.startsWith('.ops/prompts/')) return 'provider prompt template';
  if (filePath.startsWith('.ops/trend_seeds/')) return 'trend seed documentation';
  if (filePath.startsWith('.ops/')) return 'operations source';
  if (filePath.startsWith('.codex/skills/')) return 'local Codex skill';
  if (filePath.startsWith('reports/')) return 'readiness or evidence report';
  if (filePath === '.gitignore') return 'generated artifact boundary';
  if (filePath === 'README.md') return 'operator documentation';
  if (filePath === 'package.json') return 'package scripts and dependency manifest';
  if (filePath === 'package-lock.json') return 'dependency lockfile';
  if (filePath === 'tsconfig.json') return 'TypeScript project config';
  return 'repository source';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function packSource(source: HarnessInformationSource, maxCharsPerFile: number): HarnessContextPackSource {
  const content = fs.readFileSync(source.path);
  const text = content.toString('utf8');
  const excerpt = text.slice(0, maxCharsPerFile);
  return {
    id: source.id,
    kind: source.kind,
    path: source.path,
    role: source.role,
    size_bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    excerpt,
    truncated: text.length > excerpt.length,
  };
}

function contextKindPriority(kind: HarnessInformationSource['kind']): number {
  const order: Record<HarnessInformationSource['kind'], number> = {
    source: 0,
    schema: 1,
    job: 2,
    provider_request: 3,
    ops_doc: 4,
    skill: 5,
    report: 6,
    test: 7,
  };
  return order[kind];
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

function buildNextActions(
  job: CreativeJobManifest,
  capabilities: HarnessCapabilityProfile,
  providerDryRuns: ProviderDryRunResult[],
  secretFindingCount: number,
): string[] {
  const actions: string[] = [];
  if (secretFindingCount) {
    actions.push('Inspect context/secret_scan.json and remove or quarantine secret-like values before autonomous provider work.');
  }

  actions.push(`Review rendered package for ${job.job_id}; replace placeholder visuals with real approved item media if the local render is not sufficient.`);
  actions.push('Use primitives.json as the callable Codex command menu for the next autonomous step.');

  const blockedProviders = providerDryRuns.filter((result) => result.status === 'blocked');
  if (blockedProviders.length) {
    actions.push('Provider requests are still dry-run or blocked; enable only the needed capability env gates and request policies before any live adapter call.');
  }

  if (capabilities.credentials.openai_api_key_available || capabilities.credentials.gemini_api_key_available) {
    actions.push('A provider API key appears available by presence flag; keep values out of artifacts and route any future live call through provider manifests.');
  } else {
    actions.push('No paid provider API key was detected; continue with local renderer, browser captures, and stored trend evidence.');
  }

  if (!capabilities.gates.allow_social_publishing || !job.provider_policy.allow_social_publishing) {
    actions.push('Publishing remains outside this run: social publishing requires env gate, job policy approval, human-approved assets, and account-owner confirmation.');
  }

  return actions;
}

function renderPromptPacket(
  goal: string,
  job: CreativeJobManifest,
  nextActions: string[],
  capabilities: HarnessCapabilityProfile,
): string {
  return [
    `# Codex Harness Packet: ${job.job_id}`,
    '',
    '## Goal',
    goal,
    '',
    '## Selected Job',
    `- job_id: ${job.job_id}`,
    `- niche: ${job.niche}`,
    `- content_type: ${job.content_type}`,
    `- platforms: ${job.platform_targets.join(', ')}`,
    '',
    '## Capability Profile',
    `- autonomy_level: ${capabilities.autonomy_level}`,
    `- allow_paid_generation: ${capabilities.gates.allow_paid_generation}`,
    `- allow_browser_ui: ${capabilities.gates.allow_browser_ui}`,
    `- allow_social_publishing: ${capabilities.gates.allow_social_publishing}`,
    `- openai_api_key_available: ${capabilities.credentials.openai_api_key_available}`,
    `- gemini_api_key_available: ${capabilities.credentials.gemini_api_key_available}`,
    '',
    '## Next Actions',
    ...nextActions.map((action) => `- ${action}`),
    '',
  ].join('\n');
}

function createRunId(goal: string, createdAt: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || 'codex-harness-run';
  const hash = crypto.createHash('sha256').update(`${goal}:${createdAt}`).digest('hex').slice(0, 8);
  return `${createdAt.replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')}-${slug}-${hash}`;
}

function createPackageId(createdAt: string): string {
  return `${createdAt.replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')}-source-package`;
}

function aggregateFileHashes(files: HarnessSourcePackageFile[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of files.slice().sort((a, b) => a.source_path.localeCompare(b.source_path))) {
    hash.update(file.source_path);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function envEnabled(env: Record<string, string | undefined>, key: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env[key] ?? '').toLowerCase());
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const [command = 'help', ...rest] = argv;
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }

  return { command, options };
}

function stringOpt(options: Record<string, string | boolean>, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredStringOpt(options: Record<string, string | boolean>, key: string): string {
  const value = stringOpt(options, key);
  if (!value) throw new Error(`Missing required option --${key}`);
  return value;
}

function numberOpt(options: Record<string, string | boolean>, key: string): number | undefined {
  const value = stringOpt(options, key);
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`--${key} must be a positive number`);
  return number;
}

function flagEnabled(options: Record<string, string | boolean>, key: string): boolean {
  const value = options[key];
  return value === true || (typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()));
}

function printHelp(): void {
  console.log(`Viral-Bench Codex harness

Commands:
  auto --goal "<goal>" [--job .ops/creative_jobs/incoming/<job>.json] [--out .ops/harness/runs/<id>] [--run-id <id>]
    Run one bounded local autonomous pass, persist artifacts, and report stop gates.

  doctor
    Print a readiness report with repo status, information surface, latest run, blockers, and recommended commands.

  repo-status
    Print branch, remote, dirty state, and untracked source-of-truth files.

  reproducibility-manifest [--out .ops/harness/reproducibility_manifest.json]
    Print or write the source-of-truth boundary, generated artifact boundary, stage command, and verification commands.

  stage-source [--dry-run] [--apply]
    Preview or apply git staging for manifest-classified source-of-truth files only.

  source-package [--out .ops/harness/source_packages/<package_id>]
    Copy source-of-truth files into an ignored package directory with hashes and a verifier manifest.

  verify-source-package --package .ops/harness/source_packages/<package_id>
    Verify every copied source package file hash and aggregate package hash.

  autonomy-audit --goal "<goal>" [--out .ops/harness/autonomy_audit.json]
    Audit the autonomy objective against current repo evidence and capability gates.

  inspect
    Print capability flags, incoming jobs, provider requests, and Codex primitives.

  primitives
    Print the callable primitive command menu.

  information-index
    Print the complete information source map.

  rank-jobs
    Rank incoming creative jobs for autonomous selection.

  context-pack [--out .ops/harness/context_pack.json] [--max-files 80] [--max-chars-per-file 2400]
    Write a bounded context pack with hashed file excerpts for Codex.

  inventory --run .ops/harness/runs/<run_id>
    Inventory a run folder with artifact hashes.

  resume --run .ops/harness/runs/<run_id>
    Inspect an existing run and return missing artifacts plus next commands.

  latest-run
    Find and summarize the newest valid harness run.

  blockers
    Print the current autonomy blocker ledger.

  run --goal "<goal>" [--job .ops/creative_jobs/incoming/<job>.json] [--out .ops/harness/runs/<id>] [--run-id <id>]
    Select a job, render a local package, evaluate provider gates, and write durable Codex run artifacts.
`);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'auto': {
      const result = await runCodexAutonomy({
        goal: requiredStringOpt(options, 'goal'),
        jobPath: stringOpt(options, 'job'),
        outDir: stringOpt(options, 'out'),
        runId: stringOpt(options, 'run-id'),
        maxContextFiles: numberOpt(options, 'max-context-files'),
        maxContextCharsPerFile: numberOpt(options, 'max-context-chars-per-file'),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'doctor':
      console.log(JSON.stringify(buildHarnessDoctor(), null, 2));
      return;

    case 'repo-status':
      console.log(JSON.stringify(buildRepoStatus(), null, 2));
      return;

    case 'reproducibility-manifest': {
      const manifest = buildReproducibilityManifest();
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(JSON.stringify({ ok: true, path: outPath, source_file_count: manifest.source_of_truth.file_count }, null, 2));
        return;
      }
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }

    case 'stage-source':
      console.log(JSON.stringify(stageSourceOfTruth({ apply: flagEnabled(options, 'apply') }), null, 2));
      return;

    case 'source-package': {
      const report = exportSourcePackage({ outDir: stringOpt(options, 'out') });
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    case 'verify-source-package':
      console.log(JSON.stringify(verifySourcePackage(requiredStringOpt(options, 'package')), null, 2));
      return;

    case 'autonomy-audit': {
      const audit = buildAutonomyAudit(stringOpt(options, 'goal') ?? 'Make WorthScan autonomous for Codex');
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`);
        console.log(JSON.stringify({ ok: true, path: outPath, summary_status: audit.summary_status }, null, 2));
        return;
      }
      console.log(JSON.stringify(audit, null, 2));
      return;
    }

    case 'inspect':
      console.log(JSON.stringify(inspectHarness(), null, 2));
      return;

    case 'primitives':
      console.log(JSON.stringify(listCodexPrimitives(), null, 2));
      return;

    case 'information-index':
      console.log(JSON.stringify(buildInformationIndex(), null, 2));
      return;

    case 'blockers':
      console.log(JSON.stringify(buildBlockerLedger(), null, 2));
      return;

    case 'rank-jobs':
      console.log(JSON.stringify(rankIncomingJobs(), null, 2));
      return;

    case 'inventory':
      console.log(JSON.stringify(buildArtifactInventory(requiredStringOpt(options, 'run')), null, 2));
      return;

    case 'resume':
      console.log(JSON.stringify(resumeHarnessRun(requiredStringOpt(options, 'run')), null, 2));
      return;

    case 'latest-run':
      console.log(JSON.stringify(findLatestHarnessRun(), null, 2));
      return;

    case 'context-pack': {
      const pack = buildContextPack(process.cwd(), {
        maxFiles: numberOpt(options, 'max-files'),
        maxCharsPerFile: numberOpt(options, 'max-chars-per-file'),
      });
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`);
        console.log(JSON.stringify({ ok: true, path: outPath, source_count: pack.source_count }, null, 2));
        return;
      }
      console.log(JSON.stringify(pack, null, 2));
      return;
    }

    case 'run': {
      const record = await runCodexHarness({
        goal: requiredStringOpt(options, 'goal'),
        jobPath: stringOpt(options, 'job'),
        outDir: stringOpt(options, 'out'),
        runId: stringOpt(options, 'run-id'),
        maxContextFiles: numberOpt(options, 'max-context-files'),
        maxContextCharsPerFile: numberOpt(options, 'max-context-chars-per-file'),
      });
      console.log(JSON.stringify(record, null, 2));
      return;
    }

    case 'help':
    default:
      printHelp();
      process.exit(command === 'help' ? 0 : 1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
