import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { collectCompetitorContent } from './competitor-content-discovery';
import {
  chooseCommentPosts,
  collectIdentityFreeCommentSignals,
} from './internship-comment-signals';
import {
  analyzeInternshipMedia,
  deepAnalysisMaximumEstimate,
} from './internship-multimodal-analysis';
import type { InternshipMediaManifest } from './internship-media-prep';
import type {
  LiveCandidateReport,
} from './internship-live-reconciliation';
import type { SelectionLedger } from './internship-research-batch';
import { createBaselineDiscoveryReport } from './scheduled-semantic-refresh';
import {
  analyzeStaticCanary,
  selectStaticCanary,
  selectVideoCanary,
  type StaticAnalysisReport,
  type StaticCanarySelection,
  type VideoCanarySelection,
} from './mixed-media-canary';
import {
  buildInstagramRecheckConfig,
  buildViralContentLibrary,
  type RecheckConfig,
  type ViralContentLibrary,
} from './viral-content-library';
type UnknownRecord = Record<string, unknown>;

interface OfficialSourceReport {
  resources: UnknownRecord[];
  summary: UnknownRecord;
}

export const BUDGET_ALLOCATIONS = {
  social_discovery: 5,
  audience_comment_research: 4,
  video_analysis: 7,
  static_analysis: 3,
  analysis_retries: 2,
  metric_rechecks: 2,
  reserve: 2,
} as const;

export type BudgetLane = keyof typeof BUDGET_ALLOCATIONS;

export interface ProviderCallLedgerEntry {
  call_id: string;
  lane: BudgetLane;
  provider: string;
  purpose: string;
  declared_ceiling_usd: number;
  conservative_spend_usd: number;
  actual_cost_usd: number | null;
  status: 'reserved' | 'succeeded' | 'failed' | 'unknown_after_interruption';
  started_at: string;
  finished_at: string | null;
  progress_records: number;
  output_sha256: string | null;
  failure_code: string | null;
  recovery_of_call_id: string | null;
}

export interface ProviderSpendLedger {
  schema_version: 'viralbench_provider_spend_ledger_v1';
  run_id: string;
  cap_usd: 25;
  generated_at: string;
  updated_at: string;
  allocations: typeof BUDGET_ALLOCATIONS;
  calls: ProviderCallLedgerEntry[];
  actual_cost_usd_reported: number;
  actual_cost_complete: boolean;
  conservative_spend_usd: number;
  remaining_conservative_ceiling_usd: number;
  redactions: ['credential values are never serialized'];
}

interface RunnerCheckpoint {
  schema_version: 'viralbench_intelligence_run_checkpoint_v1';
  run_id: string;
  created_at: string;
  updated_at: string;
  live_execution_authorized: boolean;
  scheduler_created: false;
  consecutive_no_progress_failures: number;
  phases: Record<string, {
    status: 'pending' | 'running' | 'completed' | 'failed';
    updated_at: string;
    progress_records: number;
    outputs: string[];
    failure_code: string | null;
  }>;
}

interface RunnerPaths {
  repoRoot: string;
  siteRoot: string;
  sourceRoot: string;
  sourceReports: string;
  sourceDiscovery: string;
  sourceLibraryBaseline: string;
  dataRoot: string;
  stateRoot: string;
  ledger: string;
  checkpoint: string;
  preflight: string;
  socialRefresh: string;
  audienceRefresh: string;
  audienceManifest: string;
  metricRefresh: string;
  official: string;
  owned: string;
  selectionReport: string;
  videoAnalysis: string;
  staticAnalysis: string;
  qualityReport: string;
  sourceManifest: string;
  finalManifest: string;
}

interface PreflightReport {
  schema_version: 'viralbench_intelligence_preflight_v1';
  generated_at: string;
  run_id: string;
  ready: boolean;
  live_required_for_provider_calls: true;
  scheduler_in_scope: false;
  baseline: {
    social_posts: number;
    audience_signals: number;
    official_resources: number;
    expected_source_records: number;
  };
  canary: {
    videos: number;
    videos_by_platform: Record<string, number>;
    video_accounts: number;
    video_maximum_estimate_usd: number;
    static_items: number;
    static_by_content_type: Record<string, number>;
    static_accounts: number;
    static_topics: number;
    carousel_slide_limit: 5;
  };
  credentials: {
    apify_available: boolean;
    twelvelabs_available: boolean;
    gemini_available: boolean;
  };
  budget: {
    cap_usd: 25;
    allocations: typeof BUDGET_ALLOCATIONS;
    planned_conservative_maximum_usd: number;
  };
  gaps: string[];
}

const MIN_RECHECK_AGE_HOURS = 6;

export function createProviderSpendLedger(runId: string, now = new Date().toISOString()): ProviderSpendLedger {
  return refreshLedger({
    schema_version: 'viralbench_provider_spend_ledger_v1',
    run_id: runId,
    cap_usd: 25,
    generated_at: now,
    updated_at: now,
    allocations: BUDGET_ALLOCATIONS,
    calls: [],
    actual_cost_usd_reported: 0,
    actual_cost_complete: true,
    conservative_spend_usd: 0,
    remaining_conservative_ceiling_usd: 25,
    redactions: ['credential values are never serialized'],
  }, now);
}

export function reserveProviderCall(
  ledger: ProviderSpendLedger,
  input: {
    callId: string;
    lane: BudgetLane;
    provider: string;
    purpose: string;
    declaredCeilingUsd: number;
    recoveryOfCallId?: string;
    now?: string;
  },
): ProviderCallLedgerEntry {
  const existing = ledger.calls.find((call) => call.call_id === input.callId);
  if (existing) return existing;
  const ceiling = money(input.declaredCeilingUsd);
  if (!(ceiling > 0)) throw new Error('provider call ceiling must be positive');
  const laneSpend = money(ledger.calls
    .filter((call) => call.lane === input.lane)
    .reduce((sum, call) => sum + call.conservative_spend_usd, 0));
  if (money(laneSpend + ceiling) > BUDGET_ALLOCATIONS[input.lane]) {
    throw new Error(`budget_stop:${input.lane} call would exceed its allocation`);
  }
  if (money(ledger.conservative_spend_usd + ceiling) > ledger.cap_usd) {
    throw new Error('budget_stop:provider call would exceed the $25 run cap');
  }
  if (input.lane === 'reserve') {
    const recoveryTarget = input.recoveryOfCallId
      ? ledger.calls.find((entry) => entry.call_id === input.recoveryOfCallId)
      : null;
    if (!recoveryTarget || !['failed', 'succeeded'].includes(recoveryTarget.status)) {
      throw new Error('budget_stop:reserve may be used only by documented failed-call recovery');
    }
  }
  const now = input.now ?? new Date().toISOString();
  const call: ProviderCallLedgerEntry = {
    call_id: input.callId,
    lane: input.lane,
    provider: input.provider,
    purpose: input.purpose,
    declared_ceiling_usd: ceiling,
    conservative_spend_usd: ceiling,
    actual_cost_usd: null,
    status: 'reserved',
    started_at: now,
    finished_at: null,
    progress_records: 0,
    output_sha256: null,
    failure_code: null,
    recovery_of_call_id: input.recoveryOfCallId ?? null,
  };
  ledger.calls.push(call);
  refreshLedger(ledger, now);
  return call;
}

export function settleProviderCall(
  ledger: ProviderSpendLedger,
  callId: string,
  input: {
    status: 'succeeded' | 'failed' | 'unknown_after_interruption';
    actualCostUsd?: number | null;
    progressRecords?: number;
    outputSha256?: string | null;
    failureCode?: string | null;
    now?: string;
  },
): void {
  const call = ledger.calls.find((entry) => entry.call_id === callId);
  if (!call) throw new Error(`Unknown provider call ${callId}.`);
  call.status = input.status;
  call.actual_cost_usd = input.actualCostUsd === undefined || input.actualCostUsd === null
    ? null
    : money(input.actualCostUsd);
  call.progress_records = Math.max(0, Math.floor(input.progressRecords ?? 0));
  call.output_sha256 = input.outputSha256 ?? null;
  call.failure_code = input.failureCode ?? null;
  call.finished_at = input.now ?? new Date().toISOString();
  refreshLedger(ledger, call.finished_at);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'help';
  if (!['preflight', 'run', 'resume', 'status'].includes(command)) {
    printHelp();
    if (command !== 'help') process.exitCode = 1;
    return;
  }
  const paths = resolvePaths(option(args, '--source-root'));
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(readStatus(paths), null, 2)}\n`);
    return;
  }
  loadCredentials(paths);
  const preflight = buildPreflight(paths);
  if (command === 'resume' && fs.existsSync(paths.checkpoint)) {
    preflight.run_id = readJson<RunnerCheckpoint>(paths.checkpoint).run_id;
  }
  writeJson(paths.preflight, preflight);
  if (command === 'preflight') {
    process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
    return;
  }
  if (!args.includes('--live')) {
    throw new Error(`${command} requires --live before any paid provider call may start.`);
  }
  if (!preflight.ready) {
    throw new Error(`Preflight failed: ${preflight.gaps.join('; ')}`);
  }
  await runRefresh(paths, preflight, command === 'resume');
}

function buildPreflight(paths: RunnerPaths): PreflightReport {
  assertSourceSurface(paths);
  const discoveryFiles = baselineDiscoveryFiles(paths);
  const library = buildViralContentLibrary({
    discoveryFiles,
    sqlitePath: path.join(paths.sourceRoot, '.semantic-artifacts/competitor-content/semantic_corpus.sqlite'),
  });
  const audienceInputs = baselineAudiencePaths(paths).map(readJson);
  const audienceSignals = audienceInputs.reduce<number>((sum, input) => (
    sum + array(recordOrEmpty(input).signals).length
  ), 0);
  const officialCatalog = readJson<UnknownRecord>(
    path.join(paths.sourceRoot, '.ops/competitor_research/internship-semantic-resources-20260717.json'),
  );
  const officialResources = array(officialCatalog.resources).length;
  const manifest = readJson<InternshipMediaManifest>(sourceReport(paths, 'media'));
  const selection = readJson<SelectionLedger>(sourceReport(paths, 'selection'));
  const priorDeep = readJson<unknown>(sourceReport(paths, 'multimodal-deep'));
  const videos = selectVideoCanary(manifest, selection, [priorDeep], paths.sourceRoot);
  const eligible = new Set(videos.map((item) => item.candidate_id));
  const liveManifest = absoluteMediaManifest(manifest, paths.sourceRoot);
  const videoEstimate = deepAnalysisMaximumEstimate(liveManifest, selection, {
    limit: 8,
    minimumSuccessPercentile: 0,
    eligibleCandidateIds: eligible,
  });
  const statics = selectStaticCanary(library, discoveryFiles.map(readJson));
  const plannedMaximum = money(3 + 4 + videoEstimate + 3 + 2 + 2);
  const credentials = {
    apify_available: Boolean(process.env.APIFY_TOKEN?.trim()),
    twelvelabs_available: Boolean(process.env.TWELVELABS_API_KEY?.trim()),
    gemini_available: Boolean(process.env.GEMINI_API_KEY?.trim()),
  };
  const gaps = [
    ...(library.summary.unique_items < 718
      ? [`Only ${library.summary.unique_items} baseline social posts reconciled; expected at least 718.`]
      : []),
    ...(audienceSignals < 97 ? [`Only ${audienceSignals} baseline audience signals were found.`] : []),
    ...(officialResources !== 18 ? [`Expected 18 allowlisted official resources; found ${officialResources}.`] : []),
    ...(videoEstimate > BUDGET_ALLOCATIONS.video_analysis
      ? [`Video maximum estimate ${videoEstimate} exceeds its $7 lane.`]
      : []),
    ...(videos.length !== 8 ? ['Mixed-media video selection did not produce eight records.'] : []),
    ...(statics.length !== 6 ? ['Mixed-media static selection did not produce six records.'] : []),
    ...(!credentials.apify_available ? ['APIFY_TOKEN is unavailable.'] : []),
    ...(!credentials.twelvelabs_available ? ['TWELVELABS_API_KEY is unavailable.'] : []),
    ...(!credentials.gemini_available ? ['GEMINI_API_KEY is unavailable.'] : []),
    ...(plannedMaximum > 25 ? [`Planned conservative maximum ${plannedMaximum} exceeds $25.`] : []),
  ];
  return {
    schema_version: 'viralbench_intelligence_preflight_v1',
    generated_at: new Date().toISOString(),
    run_id: runId(),
    ready: gaps.length === 0,
    live_required_for_provider_calls: true,
    scheduler_in_scope: false,
    baseline: {
      social_posts: library.summary.unique_items,
      audience_signals: audienceSignals,
      official_resources: officialResources,
      expected_source_records: library.summary.unique_items + audienceSignals + officialResources,
    },
    canary: {
      videos: videos.length,
      videos_by_platform: counts(videos.map((item) => item.platform)),
      video_accounts: new Set(videos.map((item) => item.account_handle.toLowerCase())).size,
      video_maximum_estimate_usd: videoEstimate,
      static_items: statics.length,
      static_by_content_type: counts(statics.map((item) => item.content_type)),
      static_accounts: new Set(statics.map((item) => item.account_handle.toLowerCase())).size,
      static_topics: new Set(statics.map((item) => item.topic)).size,
      carousel_slide_limit: 5,
    },
    credentials,
    budget: {
      cap_usd: 25,
      allocations: BUDGET_ALLOCATIONS,
      planned_conservative_maximum_usd: plannedMaximum,
    },
    gaps,
  };
}

async function runRefresh(paths: RunnerPaths, preflight: PreflightReport, resume: boolean): Promise<void> {
  fs.mkdirSync(paths.stateRoot, { recursive: true });
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  const checkpoint = loadCheckpoint(paths, preflight.run_id, resume);
  checkpoint.live_execution_authorized = true;
  const ledger = loadLedger(paths, checkpoint.run_id, resume);
  if (resume) invalidateDerivedPhasesIfSourceChanged(paths, checkpoint);
  writeCheckpoint(paths, checkpoint);
  writeLedger(paths, ledger);

  await phase(paths, checkpoint, 'social_discovery', [paths.socialRefresh], async () => {
    const config = readJson<UnknownRecord>(
      path.join(paths.sourceRoot, '.ops/competitor_research/internship-us-live-profile-discovery-20260716.json'),
    );
    const result = await providerCall(paths, ledger, {
      callId: 'social-discovery-refresh',
      lane: 'social_discovery',
      provider: 'Apify',
      purpose: 'underrepresented-platform and low-concentration social refresh',
      ceiling: 3,
      output: paths.socialRefresh,
    }, async () => {
      const report = await collectCompetitorContent(config, requiredCredential('APIFY_TOKEN'));
      writeJson(paths.socialRefresh, report);
      const actualComplete = report.runs.every((run) => run.usage_finalized);
      return {
        progress: report.totals.items,
        actual: actualComplete ? report.totals.actual_cost_usd_reported : null,
      };
    });
    return { progress: result.progress };
  });

  await phase(paths, checkpoint, 'audience_comment_research', [paths.audienceRefresh, paths.audienceManifest], async () => {
    const selection = readJson<SelectionLedger>(sourceReport(paths, 'selection'));
    const candidates = readJson<LiveCandidateReport>(
      path.join(paths.sourceReports, 'internship-us-content-expansion-20260716-live-candidates.json'),
    );
    const posts = chooseCommentPosts(selection, candidates);
    const result = await providerCall(paths, ledger, {
      callId: 'audience-comment-refresh',
      lane: 'audience_comment_research',
      provider: 'Apify',
      purpose: 'identity-free audience theme and comment research',
      ceiling: 4,
      output: paths.audienceRefresh,
    }, async () => {
      const collected = await collectIdentityFreeCommentSignals({
        token: requiredCredential('APIFY_TOKEN'),
        batchId: 'viralbench-evidence-quality-upgrade-20260717',
        posts,
      });
      writeJson(paths.audienceManifest, collected.manifest);
      writeJson(paths.audienceRefresh, collected.report);
      const completed = collected.report.runs.filter((run) => run.status === 'completed');
      const actualComplete = completed.length === collected.report.runs.length
        && completed.every((run) => run.actual_cost_usd !== null);
      return {
        progress: collected.report.signals.length,
        actual: actualComplete ? collected.report.costs.actual_cost_usd_reported : null,
      };
    });
    return { progress: result.progress };
  });

  await phase(paths, checkpoint, 'metric_recheck', [paths.metricRefresh], async () => {
    const currentLibrary = buildLibraryFromAvailableDiscovery(paths);
    const config = oldEnoughRecheckConfig(currentLibrary);
    const result = await providerCall(paths, ledger, {
      callId: 'metric-recheck',
      lane: 'metric_rechecks',
      provider: 'Apify',
      purpose: 'single one-time metric recapture for meaningful observed velocity',
      ceiling: 2,
      output: paths.metricRefresh,
    }, async () => {
      const report = await collectCompetitorContent(config, requiredCredential('APIFY_TOKEN'));
      writeJson(paths.metricRefresh, report);
      const actualComplete = report.runs.every((run) => run.usage_finalized);
      return {
        progress: report.totals.items,
        actual: actualComplete ? report.totals.actual_cost_usd_reported : null,
      };
    });
    return { progress: result.progress };
  });

  await phase(paths, checkpoint, 'source_rebuild', [
    path.join(paths.siteRoot, 'library.json'),
    paths.sourceManifest,
  ], async () => {
    const library = buildLibraryFromAvailableDiscovery(paths);
    writeJson(path.join(paths.siteRoot, 'library.json'), library);
    const sourceManifest = {
      schema_version: 'viralbench_source_record_manifest_v2',
      generated_at: new Date().toISOString(),
      source_records: {
        social_posts: library.summary.unique_items,
        audience_signals_input: baselineAudiencePaths(paths)
          .concat(fs.existsSync(paths.audienceRefresh) ? [paths.audienceRefresh] : [])
          .reduce((sum, file) => sum + array(recordOrEmpty(readJson(file)).signals).length, 0),
        official_resources_expected: 18,
        owned_connection_state: 'not_connected',
      },
      social_summary: library.summary,
      no_scheduler_created: true,
    };
    writeJson(paths.sourceManifest, sourceManifest);
    return { progress: library.summary.unique_items };
  });

  await phase(paths, checkpoint, 'official_sources', [paths.official], async () => {
    runCommand(paths.siteRoot, path.join(paths.siteRoot, 'node_modules/.bin/tsx'), [
      path.join(paths.siteRoot, 'scripts/fetch-official-sources.ts'),
      '--catalog',
      path.join(paths.sourceRoot, '.ops/competitor_research/internship-semantic-resources-20260717.json'),
      '--out',
      paths.official,
    ]);
    const report = readJson<OfficialSourceReport>(paths.official);
    if (report.resources.length !== 18) throw new Error('official_source_count_mismatch');
    return { progress: number(report.summary.current) || 1 };
  });

  await phase(paths, checkpoint, 'owned_import', [paths.owned], async () => {
    runCommand(paths.siteRoot, path.join(paths.siteRoot, 'node_modules/.bin/tsx'), [
      path.join(paths.siteRoot, 'scripts/import-owned-events.ts'),
      '--out',
      paths.owned,
    ]);
    return { progress: 1 };
  });

  await phase(paths, checkpoint, 'mixed_media_selection', [paths.selectionReport], async () => {
    const selection = selectCanaries(paths);
    writeJson(paths.selectionReport, {
      schema_version: 'viralbench_mixed_media_selection_v1',
      generated_at: new Date().toISOString(),
      videos: selection.videos,
      static_items: selection.statics,
      constraints: {
        video_target: 8,
        videos_minimum_per_platform: 2,
        videos_maximum_per_platform: 3,
        videos_maximum_per_account: 1,
        carousel_target: 3,
        image_target: 3,
        static_minimum_accounts: 4,
        static_minimum_topics: 3,
        carousel_maximum_slides: 5,
      },
    });
    return { progress: selection.videos.length + selection.statics.length };
  });

  await phase(paths, checkpoint, 'video_analysis', [paths.videoAnalysis], async () => {
    const selection = selectCanaries(paths);
    const report = await runVideoAnalysis(paths, ledger, selection.videos);
    writeJson(paths.videoAnalysis, report);
    const records = array(recordOrEmpty(report).records);
    if (records.length !== 8 || records.some((row) => recordOrEmpty(recordOrEmpty(row).quality).passed !== true)) {
      throw new Error('video_canary_quality_gate_failed');
    }
    return { progress: records.length };
  });

  await phase(paths, checkpoint, 'static_analysis', [paths.staticAnalysis], async () => {
    const selection = selectCanaries(paths);
    const report = await runStaticAnalysis(paths, ledger, selection.statics);
    writeJson(paths.staticAnalysis, report);
    if (report.records.length !== 6) throw new Error('static_canary_quality_gate_failed');
    return { progress: report.records.length };
  });

  await phase(paths, checkpoint, 'mixed_media_quality', [paths.qualityReport], async () => {
    const video = readJson<UnknownRecord>(paths.videoAnalysis);
    const staticReport = readJson<StaticAnalysisReport>(paths.staticAnalysis);
    const videoRecords = array(video.records);
    const report = {
      schema_version: 'viralbench_mixed_media_quality_v1',
      generated_at: new Date().toISOString(),
      video: {
        selected: 8,
        analyzed: videoRecords.length,
        quality_passed: videoRecords.filter((row) => recordOrEmpty(recordOrEmpty(row).quality).passed === true).length,
        by_platform: counts(videoRecords.map((row) => text(recordOrEmpty(row).platform))),
        unique_accounts: preflight.canary.video_accounts,
      },
      static: {
        selected: 6,
        analyzed: staticReport.records.length,
        by_content_type: preflight.canary.static_by_content_type,
        unique_accounts: preflight.canary.static_accounts,
        unique_topics: preflight.canary.static_topics,
        maximum_carousel_slides: 5,
      },
      causal_claims_allowed: false,
      source_wording_reusable: false,
      passed: videoRecords.length === 8
        && staticReport.records.length === 6
        && videoRecords.every((row) => recordOrEmpty(recordOrEmpty(row).quality).passed === true),
    };
    writeJson(paths.qualityReport, report);
    if (!report.passed) throw new Error('mixed_media_quality_gate_failed');
    return { progress: 14 };
  });

  await phase(paths, checkpoint, 'corpus_and_vectors', [
    path.join(paths.dataRoot, 'agent-index-build-manifest.json'),
    path.join(paths.dataRoot, 'agent-corpus-public.json'),
    path.join(paths.dataRoot, 'agent-vectors.json'),
  ], async () => {
    runIndexBuild(paths);
    const manifest = readJson<UnknownRecord>(path.join(paths.dataRoot, 'agent-index-build-manifest.json'));
    const reconciliation = recordOrEmpty(manifest.reconciliation);
    if (text(reconciliation.public_vector_coverage_state) !== 'complete') {
      throw new Error('public_vector_coverage_incomplete');
    }
    return { progress: number(reconciliation.public_documents) };
  });

  await phase(paths, checkpoint, 'static_release', [
    path.join(paths.dataRoot, 'release-privacy-report.json'),
    path.join(paths.siteRoot, 'public/index.html'),
  ], async () => {
    runCommand(paths.siteRoot, 'npm', ['run', 'build']);
    const report = readJson<UnknownRecord>(path.join(paths.dataRoot, 'release-privacy-report.json'));
    if (report.passed !== true) throw new Error('release_privacy_scan_failed');
    return { progress: number(report.files) };
  });

  const acceptanceDependencies = [
    path.join(paths.dataRoot, 'agent-index-build-manifest.json'),
    path.join(paths.dataRoot, 'release-privacy-report.json'),
    paths.qualityReport,
    paths.ledger,
  ];
  if (
    checkpoint.phases.acceptance_manifest?.status === 'completed'
    && fs.existsSync(paths.finalManifest)
    && acceptanceDependencies.some((dependency) => (
      fs.existsSync(dependency)
      && fs.statSync(dependency).mtimeMs > fs.statSync(paths.finalManifest).mtimeMs
    ))
  ) {
    checkpoint.phases.acceptance_manifest.status = 'pending';
    checkpoint.phases.acceptance_manifest.updated_at = new Date().toISOString();
    writeCheckpoint(paths, checkpoint);
  }
  await phase(paths, checkpoint, 'acceptance_manifest', [paths.finalManifest], async () => {
    const final = buildAcceptanceManifest(paths, ledger);
    writeJson(paths.finalManifest, final);
    if (final.status !== 'passed') {
      throw new Error(`acceptance_gates_failed:${final.failed_gates.join(',')}`);
    }
    return { progress: final.gates.length };
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    run_id: checkpoint.run_id,
    final_manifest: path.relative(paths.repoRoot, paths.finalManifest),
    conservative_spend_usd: ledger.conservative_spend_usd,
    actual_cost_usd_reported: ledger.actual_cost_usd_reported,
    actual_cost_complete: ledger.actual_cost_complete,
    scheduler_created: false,
  }, null, 2)}\n`);
}

async function runVideoAnalysis(
  paths: RunnerPaths,
  ledger: ProviderSpendLedger,
  videos: VideoCanarySelection[],
): Promise<UnknownRecord> {
  const manifest = absoluteMediaManifest(
    readJson<InternshipMediaManifest>(sourceReport(paths, 'media')),
    paths.sourceRoot,
  );
  const selection = readJson<SelectionLedger>(sourceReport(paths, 'selection'));
  const eligible = new Set(videos.map((item) => item.candidate_id));
  const ceiling = deepAnalysisMaximumEstimate(manifest, selection, {
    limit: 8,
    minimumSuccessPercentile: 0,
    eligibleCandidateIds: eligible,
  });
  const strategyPrompt = fs.readFileSync(
    path.join(paths.sourceRoot, '.ops/prompts/twelvelabs/internship_us_selected_content_analysis.md'),
    'utf8',
  );
  const outputDirectory = path.join(paths.stateRoot, 'video-analysis-cache');
  const primaryCall = ledger.calls.find((call) => call.call_id === 'video-analysis-primary');
  let report = primaryCall?.status === 'succeeded' && fs.existsSync(paths.videoAnalysis)
    ? readJson<UnknownRecord>(paths.videoAnalysis)
    : recordOrEmpty((await providerCall(paths, ledger, {
        callId: 'video-analysis-primary',
        lane: 'video_analysis',
        provider: 'TwelveLabs',
        purpose: 'eight-video balanced mixed-media canary',
        ceiling,
        output: paths.videoAnalysis,
      }, async () => {
        const primaryReport = await analyzeInternshipMedia({
          apiKey: requiredCredential('TWELVELABS_API_KEY'),
          manifest,
          selection,
          strategyPrompt,
          outputDir: outputDirectory,
          limit: 8,
          minimumSuccessPercentile: 0,
          eligibleCandidateIds: eligible,
        });
        return {
          value: primaryReport,
          progress: array(recordOrEmpty(primaryReport).records).length,
          actual: null,
        };
      })).value);
  const successful = new Set(array(report.records).flatMap((row) => (
    recordOrEmpty(recordOrEmpty(row).quality).passed === true
      ? [text(recordOrEmpty(row).candidate_id)]
      : []
  )));
  const retryIds = new Set(videos.map((item) => item.candidate_id).filter((id) => !successful.has(id)));
  if (retryIds.size && !ledger.calls.some((call) => call.call_id === 'video-analysis-retry')) {
    const retryCeiling = deepAnalysisMaximumEstimate(manifest, selection, {
      limit: retryIds.size,
      minimumSuccessPercentile: 0,
      eligibleCandidateIds: retryIds,
    });
    if (retryCeiling > 0 && retryCeiling <= remainingLane(ledger, 'analysis_retries')) {
      const retry = await providerCall(paths, ledger, {
        callId: 'video-analysis-retry',
        lane: 'analysis_retries',
        provider: 'TwelveLabs',
        purpose: 'documented failed or incomplete video analysis retry',
        ceiling: retryCeiling,
        output: paths.videoAnalysis,
      }, async () => {
        const retryReport = await analyzeInternshipMedia({
          apiKey: requiredCredential('TWELVELABS_API_KEY'),
          manifest,
          selection,
          strategyPrompt,
          outputDir: outputDirectory,
          limit: retryIds.size,
          minimumSuccessPercentile: 0,
          eligibleCandidateIds: retryIds,
        });
        return {
          value: retryReport,
          progress: array(recordOrEmpty(retryReport).records).length,
          actual: null,
        };
      });
      report = mergeReports(report, recordOrEmpty(retry.value));
    }
  }
  const remainingFailedIds = new Set(array(report.records).flatMap((row) => (
    recordOrEmpty(recordOrEmpty(row).quality).passed === true
      ? []
      : [text(recordOrEmpty(row).candidate_id)]
  )).filter(Boolean));
  if (remainingFailedIds.size && !ledger.calls.some((call) => call.call_id === 'video-analysis-reserve-recovery')) {
    const recoveryCeiling = deepAnalysisMaximumEstimate(manifest, selection, {
      limit: remainingFailedIds.size,
      minimumSuccessPercentile: 0,
      eligibleCandidateIds: remainingFailedIds,
    });
    if (recoveryCeiling > 0 && recoveryCeiling <= remainingLane(ledger, 'reserve')) {
      const recovery = await providerCall(paths, ledger, {
        callId: 'video-analysis-reserve-recovery',
        lane: 'reserve',
        provider: 'TwelveLabs',
        purpose: 'reserve recovery for documented incomplete video quality gate',
        ceiling: recoveryCeiling,
        output: paths.videoAnalysis,
        recoveryOfCallId: 'video-analysis-retry',
      }, async () => {
        const recoveryReport = await analyzeInternshipMedia({
          apiKey: requiredCredential('TWELVELABS_API_KEY'),
          manifest,
          selection,
          strategyPrompt,
          outputDir: outputDirectory,
          limit: remainingFailedIds.size,
          minimumSuccessPercentile: 0,
          eligibleCandidateIds: remainingFailedIds,
        });
        return {
          value: recoveryReport,
          progress: array(recordOrEmpty(recoveryReport).records).length,
          actual: null,
        };
      });
      report = mergeReports(report, recordOrEmpty(recovery.value));
    }
  }
  return report;
}

async function runStaticAnalysis(
  paths: RunnerPaths,
  ledger: ProviderSpendLedger,
  selections: StaticCanarySelection[],
): Promise<StaticAnalysisReport> {
  const primaryCall = ledger.calls.find((call) => call.call_id === 'static-analysis-primary');
  let report = primaryCall?.status === 'succeeded' && fs.existsSync(paths.staticAnalysis)
    ? readJson<StaticAnalysisReport>(paths.staticAnalysis)
    : (await providerCall(paths, ledger, {
        callId: 'static-analysis-primary',
        lane: 'static_analysis',
        provider: 'Gemini',
        purpose: 'three carousels and three ordinary image posts',
        ceiling: 3,
        output: paths.staticAnalysis,
      }, async () => {
        const primaryReport = await analyzeStaticCanary({
          selections,
          apiKey: requiredCredential('GEMINI_API_KEY'),
        });
        return { value: primaryReport, progress: primaryReport.records.length, actual: null };
      })).value as StaticAnalysisReport;
  const succeeded = new Set(report.records.map((row) => text(recordOrEmpty(row).candidate_id)));
  const failed = selections.filter((item) => !succeeded.has(item.item_id));
  const retryCeiling = money(failed.length * 0.5);
  if (
    failed.length
    && retryCeiling <= remainingLane(ledger, 'analysis_retries')
    && !ledger.calls.some((call) => call.call_id === 'static-analysis-retry')
  ) {
    const retry = await providerCall(paths, ledger, {
      callId: 'static-analysis-retry',
      lane: 'analysis_retries',
      provider: 'Gemini',
      purpose: 'documented failed static-analysis retry',
      ceiling: retryCeiling,
      output: paths.staticAnalysis,
    }, async () => {
      const retryReport = await analyzeStaticCanary({
        selections: failed,
        apiKey: requiredCredential('GEMINI_API_KEY'),
      });
      return { value: retryReport, progress: retryReport.records.length, actual: null };
    });
    report = mergeStaticReports(report, retry.value as StaticAnalysisReport);
  }
  const stillSucceeded = new Set(report.records.map((row) => text(recordOrEmpty(row).candidate_id)));
  const stillFailed = selections.filter((item) => !stillSucceeded.has(item.item_id));
  if (stillFailed.length && !ledger.calls.some((call) => call.call_id === 'static-analysis-reserve-recovery')) {
    const library = readJson<ViralContentLibrary>(path.join(paths.siteRoot, 'library.json'));
    const replacementCohort = selectStaticCanary(
      library,
      availableDiscoveryFiles(paths).map(readJson),
      { excludedItemIds: new Set(stillFailed.map((item) => item.item_id)) },
    );
    const replacements = replacementCohort.filter((item) => !stillSucceeded.has(item.item_id));
    const recoveryCeiling = money(replacements.length * 0.5);
    if (
      replacements.length === stillFailed.length
      && recoveryCeiling > 0
      && recoveryCeiling <= remainingLane(ledger, 'reserve')
    ) {
      const recovery = await providerCall(paths, ledger, {
        callId: 'static-analysis-reserve-recovery',
        lane: 'reserve',
        provider: 'Gemini',
        purpose: 'reserve recovery using fresh media for documented static source failures',
        ceiling: recoveryCeiling,
        output: paths.staticAnalysis,
        recoveryOfCallId: 'static-analysis-primary',
      }, async () => {
        const recoveryReport = await analyzeStaticCanary({
          selections: replacements,
          apiKey: requiredCredential('GEMINI_API_KEY'),
        });
        return { value: recoveryReport, progress: recoveryReport.records.length, actual: null };
      });
      report = mergeStaticReports(report, recovery.value as StaticAnalysisReport);
      const selectionReport = readJson<UnknownRecord>(paths.selectionReport);
      selectionReport.static_items = replacementCohort;
      selectionReport.static_recovery = {
        failed_source_items: stillFailed.map((item) => item.item_id),
        replacement_items: replacements.map((item) => item.item_id),
        reason: 'source media failed deterministic image validation or fetch',
      };
      writeJson(paths.selectionReport, selectionReport);
    }
  }
  return report;
}

async function providerCall<T>(
  paths: RunnerPaths,
  ledger: ProviderSpendLedger,
  input: {
    callId: string;
    lane: BudgetLane;
    provider: string;
    purpose: string;
    ceiling: number;
    output: string;
    recoveryOfCallId?: string;
  },
  execute: () => Promise<{ value?: T; progress: number; actual: number | null }>,
): Promise<{ value?: T; progress: number; actual: number | null }> {
  const call = reserveProviderCall(ledger, {
    callId: input.callId,
    lane: input.lane,
    provider: input.provider,
    purpose: input.purpose,
    declaredCeilingUsd: input.ceiling,
    recoveryOfCallId: input.recoveryOfCallId,
  });
  if (call.status !== 'reserved') {
    throw new Error(`provider_call_not_repeated:${input.callId}:${call.status}`);
  }
  writeLedger(paths, ledger);
  try {
    const result = await execute();
    if (result.progress <= 0) throw new Error('provider_call_no_progress');
    const hash = fs.existsSync(input.output) ? hashFile(input.output) : null;
    settleProviderCall(ledger, input.callId, {
      status: 'succeeded',
      actualCostUsd: result.actual,
      progressRecords: result.progress,
      outputSha256: hash,
    });
    writeLedger(paths, ledger);
    return result;
  } catch (error) {
    settleProviderCall(ledger, input.callId, {
      status: 'failed',
      failureCode: safeFailure(error),
    });
    writeLedger(paths, ledger);
    throw error;
  }
}

async function phase(
  paths: RunnerPaths,
  checkpoint: RunnerCheckpoint,
  name: string,
  outputs: string[],
  execute: () => Promise<{ progress: number }>,
): Promise<void> {
  const existing = checkpoint.phases[name];
  if (
    existing?.status === 'completed'
    && outputs.every((output) => fs.existsSync(output))
  ) return;
  if (existing?.status === 'running') {
    existing.status = 'failed';
    existing.failure_code = 'interrupted_before_checkpoint';
    checkpoint.consecutive_no_progress_failures += 1;
  }
  checkpoint.phases[name] = {
    status: 'running',
    updated_at: new Date().toISOString(),
    progress_records: 0,
    outputs: outputs.map((output) => path.relative(paths.repoRoot, output)),
    failure_code: null,
  };
  writeCheckpoint(paths, checkpoint);
  try {
    const result = await execute();
    if (!(result.progress > 0)) throw new Error('phase_no_progress');
    checkpoint.phases[name] = {
      ...checkpoint.phases[name]!,
      status: 'completed',
      updated_at: new Date().toISOString(),
      progress_records: result.progress,
      failure_code: null,
    };
    checkpoint.consecutive_no_progress_failures = 0;
    writeCheckpoint(paths, checkpoint);
  } catch (error) {
    checkpoint.phases[name] = {
      ...checkpoint.phases[name]!,
      status: 'failed',
      updated_at: new Date().toISOString(),
      failure_code: safeFailure(error),
    };
    checkpoint.consecutive_no_progress_failures += 1;
    writeCheckpoint(paths, checkpoint);
    if (checkpoint.consecutive_no_progress_failures >= 2) {
      throw new Error(`no_progress_stop:${name}:two consecutive failures`);
    }
    throw error;
  }
}

function runIndexBuild(paths: RunnerPaths): void {
  const executable = path.join(paths.siteRoot, 'node_modules/.bin/tsx');
  const args = [
    path.join(paths.siteRoot, 'scripts/build-agent-index.ts'),
    '--library', path.join(paths.siteRoot, 'library.json'),
    '--dashboard', path.join(paths.siteRoot, 'twelvelabs-dashboard-data.js'),
    '--official', paths.official,
    '--owned', paths.owned,
    '--local-vectors',
    '--require-public-vectors',
  ];
  for (const input of [
    ...baselineAudiencePaths(paths),
    ...(fs.existsSync(paths.audienceRefresh) ? [paths.audienceRefresh] : []),
  ]) args.push('--audience', input);
  for (const input of [
    sourceReport(paths, 'multimodal'),
    sourceReport(paths, 'multimodal-deep'),
    paths.videoAnalysis,
    paths.staticAnalysis,
  ]) args.push('--analysis', input);
  runCommand(paths.siteRoot, executable, args);
}

function buildAcceptanceManifest(
  paths: RunnerPaths,
  ledger: ProviderSpendLedger,
): {
  schema_version: string;
  generated_at: string;
  status: 'passed' | 'failed';
  gates: Array<{ id: string; passed: boolean; observed: unknown }>;
  failed_gates: string[];
  release_ready: boolean;
  no_scheduler_created: true;
} {
  const index = readJson<UnknownRecord>(path.join(paths.dataRoot, 'agent-index-build-manifest.json'));
  const reconciliation = recordOrEmpty(index.reconciliation);
  const sourceRecords = recordOrEmpty(reconciliation.source_records);
  const operatorByEvidenceType = recordOrEmpty(reconciliation.operator_by_evidence_type);
  const official = readJson<OfficialSourceReport>(paths.official);
  const quality = readJson<UnknownRecord>(paths.qualityReport);
  const privacy = readJson<UnknownRecord>(path.join(paths.dataRoot, 'release-privacy-report.json'));
  const publicCorpus = readJson<UnknownRecord>(path.join(paths.dataRoot, 'agent-corpus-public.json'));
  const documents = array(publicCorpus.documents);
  const totalSources = number(sourceRecords.social_posts)
    + number(sourceRecords.audience_signals)
    + number(sourceRecords.official_resources);
  const gates = [
    {
      id: 'source_records_reconcile',
      passed: number(sourceRecords.social_posts) >= 718 && totalSources >= 833,
      observed: {
        social_posts: number(sourceRecords.social_posts),
        total_source_records: totalSources,
      },
    },
    {
      id: 'provider_spend_cap',
      passed: ledger.conservative_spend_usd <= 25 && ledger.actual_cost_usd_reported <= 25,
      observed: {
        conservative_usd: ledger.conservative_spend_usd,
        actual_reported_usd: ledger.actual_cost_usd_reported,
        actual_complete: ledger.actual_cost_complete,
      },
    },
    {
      id: 'social_post_document_cardinality',
      passed: number(reconciliation.social_document_count) === number(sourceRecords.social_posts)
        && number(operatorByEvidenceType.social_post) === number(sourceRecords.social_posts),
      observed: {
        source_posts: number(sourceRecords.social_posts),
        social_documents: number(reconciliation.social_document_count),
      },
    },
    {
      id: 'official_source_statuses',
      passed: official.resources.length === 18
        && official.resources.every((resource) => ['current', 'stale', 'failed'].includes(text(resource.status))),
      observed: official.summary,
    },
    {
      id: 'public_vector_coverage',
      passed: text(reconciliation.public_vector_coverage_state) === 'complete'
        && number(reconciliation.public_vectors) === number(reconciliation.public_documents),
      observed: {
        state: reconciliation.public_vector_coverage_state,
        vectors: reconciliation.public_vectors,
        documents: reconciliation.public_documents,
      },
    },
    {
      id: 'public_visibility_boundary',
      passed: documents.every((document) => text(recordOrEmpty(document).visibility) === 'public_reviewed'),
      observed: { public_documents: documents.length },
    },
    {
      id: 'owned_not_connected',
      passed: text(sourceRecords.owned_connection_state) === 'not_connected',
      observed: sourceRecords.owned_connection_state,
    },
    {
      id: 'mixed_media_quality',
      passed: quality.passed === true,
      observed: { video: quality.video, static: quality.static },
    },
    {
      id: 'release_privacy_and_allowlist',
      passed: privacy.passed === true,
      observed: {
        findings: privacy.findings,
        blocked_paths_absent: privacy.blocked_paths_absent,
      },
    },
  ];
  const failed = gates.filter((gate) => !gate.passed).map((gate) => gate.id);
  return {
    schema_version: 'viralbench_intelligence_run_manifest_v1',
    generated_at: new Date().toISOString(),
    status: failed.length ? 'failed' : 'passed',
    gates,
    failed_gates: failed,
    release_ready: failed.length === 0,
    no_scheduler_created: true,
  };
}

function selectCanaries(paths: RunnerPaths): {
  videos: VideoCanarySelection[];
  statics: StaticCanarySelection[];
} {
  const library = readJson<ViralContentLibrary>(path.join(paths.siteRoot, 'library.json'));
  const manifest = readJson<InternshipMediaManifest>(sourceReport(paths, 'media'));
  const selection = readJson<SelectionLedger>(sourceReport(paths, 'selection'));
  const deep = readJson(sourceReport(paths, 'multimodal-deep'));
  return {
    videos: selectVideoCanary(manifest, selection, [deep], paths.sourceRoot),
    statics: selectStaticCanary(library, availableDiscoveryFiles(paths).map(readJson)),
  };
}

function buildLibraryFromAvailableDiscovery(paths: RunnerPaths): ViralContentLibrary {
  return buildViralContentLibrary({
    discoveryFiles: availableDiscoveryFiles(paths),
    sqlitePath: path.join(paths.sourceRoot, '.semantic-artifacts/competitor-content/semantic_corpus.sqlite'),
  });
}

export function libraryEvidenceFingerprint(library: ViralContentLibrary): string {
  const evidence = library.items.map((item) => ({
    item_id: item.item_id,
    platform: item.platform,
    content_type: item.content_type,
    platform_post_id: item.platform_post_id,
    canonical_url: item.canonical_url,
    account_handle: item.account_handle,
    caption: item.caption,
    hashtags: item.hashtags,
    posted_at: item.posted_at,
    observations: item.observations,
    provenance: item.provenance,
  })).sort((left, right) => left.item_id.localeCompare(right.item_id));
  return crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

function invalidateDerivedPhasesIfSourceChanged(
  paths: RunnerPaths,
  checkpoint: RunnerCheckpoint,
): void {
  if (checkpoint.phases.source_rebuild?.status !== 'completed') return;
  const currentPath = path.join(paths.siteRoot, 'library.json');
  if (!fs.existsSync(currentPath)) return;
  const current = readJson<ViralContentLibrary>(currentPath);
  const candidate = buildLibraryFromAvailableDiscovery(paths);
  if (libraryEvidenceFingerprint(current) === libraryEvidenceFingerprint(candidate)) return;
  const now = new Date().toISOString();
  for (const name of ['source_rebuild', 'corpus_and_vectors', 'static_release', 'acceptance_manifest']) {
    const phaseValue = checkpoint.phases[name];
    if (!phaseValue) continue;
    phaseValue.status = 'pending';
    phaseValue.updated_at = now;
    phaseValue.failure_code = null;
  }
  checkpoint.updated_at = now;
}

function availableDiscoveryFiles(paths: RunnerPaths): string[] {
  return [
    ...baselineDiscoveryFiles(paths),
    ...(fs.existsSync(paths.socialRefresh) ? [paths.socialRefresh] : []),
    ...(fs.existsSync(paths.metricRefresh) ? [paths.metricRefresh] : []),
  ];
}

function baselineDiscoveryFiles(paths: RunnerPaths): string[] {
  const files = listJson(paths.sourceDiscovery);
  const sourceLibrary = path.join(paths.sourceRoot, 'internship-reels-site/library.json');
  if (!fs.existsSync(sourceLibrary)) return files;
  fs.mkdirSync(paths.stateRoot, { recursive: true });
  const library = readJson<ViralContentLibrary>(sourceLibrary);
  const fingerprint = libraryEvidenceFingerprint(library).slice(0, 20);
  writeJson(
    paths.sourceLibraryBaseline,
    createBaselineDiscoveryReport(library, `evidence-quality-source-baseline-${fingerprint}`, 0),
  );
  return uniqueStrings([paths.sourceLibraryBaseline, ...files]);
}

function oldEnoughRecheckConfig(library: ViralContentLibrary): RecheckConfig {
  const config = buildInstagramRecheckConfig(library, {
    researchId: 'viralbench-evidence-quality-recheck-20260717',
    limit: 50,
    maxChargeUsd: 2,
  });
  const itemsByUrl = new Map(library.items.map((item) => [item.canonical_url, item]));
  const now = Date.now();
  const urls = config.runs[0]!.input.directUrls.filter((url) => {
    const item = itemsByUrl.get(url);
    const capturedAt = item?.observations.at(-1)?.captured_at;
    if (!capturedAt) return false;
    return now - Date.parse(capturedAt) >= MIN_RECHECK_AGE_HOURS * 60 * 60 * 1_000;
  }).slice(0, 20);
  if (!urls.length) throw new Error('No existing metric snapshots are old enough for a meaningful velocity recapture.');
  config.runs[0]!.input.directUrls = urls;
  config.runs[0]!.max_items = urls.length;
  return config;
}

function mergeReports(primary: UnknownRecord, retry: UnknownRecord): UnknownRecord {
  const records = new Map<string, unknown>();
  for (const row of [...array(primary.records), ...array(retry.records)]) {
    const candidateId = text(recordOrEmpty(row).candidate_id);
    if (candidateId) records.set(candidateId, row);
  }
  return {
    ...primary,
    generated_at: new Date().toISOString(),
    analyzed: records.size,
    records: [...records.values()],
    measurement_gaps: uniqueStrings([
      ...textArray(primary.measurement_gaps),
      ...textArray(retry.measurement_gaps),
    ]),
    retry_run_included: true,
  };
}

function mergeStaticReports(primary: StaticAnalysisReport, retry: StaticAnalysisReport): StaticAnalysisReport {
  const records = new Map<string, UnknownRecord>();
  for (const row of [...primary.records, ...retry.records]) {
    const id = text(recordOrEmpty(row).candidate_id);
    if (id) records.set(id, row);
  }
  return {
    ...primary,
    generated_at: new Date().toISOString(),
    analyzed: records.size,
    conservative_spend_usd: money(primary.conservative_spend_usd + retry.conservative_spend_usd),
    external_calls_made: primary.external_calls_made + retry.external_calls_made,
    records: [...records.values()],
    gaps: uniqueStrings([...primary.gaps, ...retry.gaps]),
  };
}

function absoluteMediaManifest(
  manifest: InternshipMediaManifest,
  sourceRoot: string,
): InternshipMediaManifest {
  return {
    ...manifest,
    rows: manifest.rows.map((row) => ({
      ...row,
      media_path: row.media_path
        ? path.isAbsolute(row.media_path) ? row.media_path : path.resolve(sourceRoot, row.media_path)
        : null,
    })),
  };
}

function loadCheckpoint(paths: RunnerPaths, requestedRunId: string, resume: boolean): RunnerCheckpoint {
  if (resume) {
    if (!fs.existsSync(paths.checkpoint)) throw new Error('resume requires an existing checkpoint');
    return readJson<RunnerCheckpoint>(paths.checkpoint);
  }
  if (fs.existsSync(paths.checkpoint)) {
    const existing = readJson<RunnerCheckpoint>(paths.checkpoint);
    const incomplete = Object.values(existing.phases).some((phaseValue) => phaseValue.status !== 'completed');
    if (incomplete) throw new Error('An incomplete run exists; use resume --live.');
  }
  const now = new Date().toISOString();
  return {
    schema_version: 'viralbench_intelligence_run_checkpoint_v1',
    run_id: requestedRunId,
    created_at: now,
    updated_at: now,
    live_execution_authorized: false,
    scheduler_created: false,
    consecutive_no_progress_failures: 0,
    phases: {},
  };
}

function loadLedger(paths: RunnerPaths, runIdValue: string, resume: boolean): ProviderSpendLedger {
  if (resume && fs.existsSync(paths.ledger)) return readJson<ProviderSpendLedger>(paths.ledger);
  return createProviderSpendLedger(runIdValue);
}

function refreshLedger(ledger: ProviderSpendLedger, now: string): ProviderSpendLedger {
  ledger.updated_at = now;
  ledger.conservative_spend_usd = money(ledger.calls.reduce((sum, call) => (
    sum + call.conservative_spend_usd
  ), 0));
  ledger.actual_cost_usd_reported = money(ledger.calls.reduce((sum, call) => (
    sum + (call.actual_cost_usd ?? 0)
  ), 0));
  ledger.actual_cost_complete = ledger.calls.every((call) => (
    call.status !== 'reserved' && call.actual_cost_usd !== null
  ));
  ledger.remaining_conservative_ceiling_usd = money(ledger.cap_usd - ledger.conservative_spend_usd);
  return ledger;
}

function remainingLane(ledger: ProviderSpendLedger, lane: BudgetLane): number {
  const spent = ledger.calls.filter((call) => call.lane === lane)
    .reduce((sum, call) => sum + call.conservative_spend_usd, 0);
  return money(BUDGET_ALLOCATIONS[lane] - spent);
}

function loadCredentials(paths: RunnerPaths): void {
  for (const candidate of [
    path.join(paths.sourceRoot, '.env'),
    path.join(paths.sourceRoot, 'internship-reels-site/.env.local'),
    path.join(paths.repoRoot, '.env'),
    path.join(paths.siteRoot, '.env.local'),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    const loadEnvFile = (process as NodeJS.Process & {
      loadEnvFile?: (filePath?: string) => void;
    }).loadEnvFile;
    loadEnvFile?.call(process, candidate);
  }
}

function requiredCredential(name: 'APIFY_TOKEN' | 'TWELVELABS_API_KEY' | 'GEMINI_API_KEY'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is unavailable.`);
  return value;
}

function resolvePaths(sourceRootOption: string | undefined): RunnerPaths {
  const repoRoot = path.resolve(__dirname, '..');
  const sourceRoot = path.resolve(
    sourceRootOption
      ?? process.env.VIRAL_BENCH_SOURCE_ROOT
      ?? (fs.existsSync(path.join(repoRoot, '.semantic-artifacts'))
        ? repoRoot
        : path.resolve(repoRoot, '..', '..', 'Viral-Bench')),
  );
  const siteRoot = path.join(repoRoot, 'internship-reels-site');
  const dataRoot = path.join(siteRoot, 'data');
  const stateRoot = path.join(repoRoot, '.ops/intelligence-run-once');
  return {
    repoRoot,
    siteRoot,
    sourceRoot,
    sourceReports: path.join(sourceRoot, '.semantic-artifacts/competitor-content/reports'),
    sourceDiscovery: path.join(sourceRoot, '.semantic-artifacts/competitor-content/discovery'),
    sourceLibraryBaseline: path.join(stateRoot, 'source-library-baseline.json'),
    dataRoot,
    stateRoot,
    ledger: path.join(dataRoot, 'provider-spend-ledger.json'),
    checkpoint: path.join(stateRoot, 'checkpoint.json'),
    preflight: path.join(dataRoot, 'intelligence-preflight.json'),
    socialRefresh: path.join(dataRoot, 'social-discovery-refresh.json'),
    audienceRefresh: path.join(dataRoot, 'audience-comment-refresh.json'),
    audienceManifest: path.join(dataRoot, 'audience-comment-refresh-manifest.json'),
    metricRefresh: path.join(dataRoot, 'metric-recheck-refresh.json'),
    official: path.join(dataRoot, 'official-sources.json'),
    owned: path.join(dataRoot, 'owned-evidence.json'),
    selectionReport: path.join(dataRoot, 'mixed-media-selection.json'),
    videoAnalysis: path.join(dataRoot, 'mixed-media-video-analysis.json'),
    staticAnalysis: path.join(dataRoot, 'mixed-media-static-analysis.json'),
    qualityReport: path.join(dataRoot, 'mixed-media-quality-report.json'),
    sourceManifest: path.join(dataRoot, 'source-record-manifest.json'),
    finalManifest: path.join(dataRoot, 'intelligence-run-manifest.json'),
  };
}

function assertSourceSurface(paths: RunnerPaths): void {
  for (const required of [
    paths.sourceDiscovery,
    paths.sourceReports,
    path.join(paths.sourceRoot, '.semantic-artifacts/competitor-content/semantic_corpus.sqlite'),
    sourceReport(paths, 'media'),
    sourceReport(paths, 'selection'),
    sourceReport(paths, 'multimodal-deep'),
  ]) {
    if (!fs.existsSync(required)) throw new Error(`Required source surface is unavailable: ${path.basename(required)}`);
  }
}

function sourceReport(
  paths: RunnerPaths,
  suffix: 'audience-signals' | 'comment-signals' | 'media' | 'selection' | 'multimodal' | 'multimodal-deep',
): string {
  return path.join(
    paths.sourceReports,
    `internship-us-content-expansion-20260716-${suffix}.json`,
  );
}

function baselineAudiencePaths(paths: RunnerPaths): string[] {
  return [sourceReport(paths, 'audience-signals'), sourceReport(paths, 'comment-signals')];
}

function readStatus(paths: RunnerPaths): UnknownRecord {
  return {
    checkpoint: fs.existsSync(paths.checkpoint) ? readJson(paths.checkpoint) : null,
    provider_spend: fs.existsSync(paths.ledger) ? readJson(paths.ledger) : null,
    final_manifest: fs.existsSync(paths.finalManifest) ? readJson(paths.finalManifest) : null,
  };
}

function runCommand(cwd: string, executable: string, args: string[]): void {
  const result = spawnSync(executable, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const details = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim().slice(-4_000);
    throw new Error(`command_failed:${path.basename(executable)}:${safeFailure(details)}`);
  }
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
}

function writeCheckpoint(paths: RunnerPaths, checkpoint: RunnerCheckpoint): void {
  checkpoint.updated_at = new Date().toISOString();
  writeJson(paths.checkpoint, checkpoint);
}

function writeLedger(paths: RunnerPaths, ledger: ProviderSpendLedger): void {
  refreshLedger(ledger, new Date().toISOString());
  writeJson(paths.ledger, ledger);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function listJson(directory: string): string[] {
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(directory, name))
    .sort();
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function runId(): string {
  return `evidence-quality-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:AIza|apify_api_|tlk_|sk-proj-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\/Users\/[^\s:]+/g, '[LOCAL_PATH]')
    .replace(/https?:\/\/\S+/g, '[URL]')
    .slice(0, 400);
}

function printHelp(): void {
  process.stdout.write(`Viral-Bench one-time evidence refresh

Commands:
  preflight [--source-root <path>]
  run --live [--source-root <path>]
  resume --live [--source-root <path>]
  status [--source-root <path>]

No command creates or activates a scheduler. Paid calls require the explicit
--live flag and are checkpointed against a conservative $25 provider ledger.
`);
}

function recordOrEmpty(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${safeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
