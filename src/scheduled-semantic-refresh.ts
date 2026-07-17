import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteJson } from './artifact-integrity';
import { mergeEnvWithFile } from './env-loader';
import {
  buildSemanticPreflight,
  ingestSemanticUrlsLive,
  type SemanticIngestionReport,
  type SemanticPreflightReport,
} from './semantic-pipeline';
import {
  validateUrlIntakeRequest,
  type SocialPlatform,
  type UrlIntakeRequest,
  type VideoCreativeAnalysis,
} from './semantic-intelligence';
import {
  buildViralContentLibrary,
  type ViralContentLibrary,
} from './viral-content-library';

const DEFAULT_MANIFEST = '.ops/url_intake_requests/internship-category-creators-expansion-20260716.json';
const DEFAULT_ARTIFACT_DIR = '.semantic-artifacts/scheduled-refresh/current';
const DEFAULT_LIBRARY = 'internship-reels-site/library.json';
const DEFAULT_STATUS = 'internship-reels-site/data/pipeline-refresh.json';
const MAX_SCHEDULED_BUDGET_USD = 5;
const MIN_ANALYSIS_COVERAGE = 0.8;

export const SCHEDULE_CONTRACT = {
  timezone: 'America/Chicago',
  local_time: '09:17',
  weekdays: ['Monday', 'Thursday'],
  cron: '17 9 * * 1,4',
} as const;

interface CliOptions {
  mode: 'preflight' | 'run';
  manifestPath: string;
  artifactDir: string;
  siteLibraryPath: string;
  siteStatusPath: string;
  envFile?: string;
  maxTotalUsd: number;
}

interface UnknownRecord {
  [key: string]: unknown;
}

interface BaselineLibraryItem {
  platform?: unknown;
  content_type?: unknown;
  canonical_url?: unknown;
  account_handle?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  posted_at?: unknown;
  observations?: unknown;
  provenance?: unknown;
}

interface BaselineObservation {
  captured_at?: unknown;
  source_runs?: unknown;
  discovery_modes?: unknown;
  views?: unknown;
  likes?: unknown;
  comments?: unknown;
  shares?: unknown;
  saves?: unknown;
}

export interface RefreshPublicationGate {
  publishable: boolean;
  status: 'completed' | 'partial' | 'blocked';
  requested_urls: number;
  reconciled_urls: number;
  analyzed_videos: number;
  analysis_coverage: number;
  budget_used_usd: number;
  failures: string[];
}

export interface PublicPipelineRefreshStatus {
  schema_version: 'viralbench_pipeline_refresh_v1';
  status: 'configured' | 'completed' | 'partial';
  updated_at: string;
  last_completed_at: string | null;
  schedule: typeof SCHEDULE_CONTRACT;
  budget: {
    currency: 'USD';
    max_total_usd: number;
    max_apify_usd: number;
    max_twelvelabs_usd: number;
    actual_or_conservative_usd: number | null;
  };
  source: {
    request_id: string;
    manifest_path: string;
    requested_urls: number;
  };
  providers: {
    apify: {
      state: 'configured' | 'completed';
      accepted_posts: number | null;
      actual_or_conservative_usd: number | null;
    };
    twelvelabs: {
      state: 'configured' | 'completed' | 'partial';
      analyzed_videos: number | null;
      analysis_coverage: number | null;
      actual_or_conservative_usd: number | null;
      models: string[];
    };
  };
  results: {
    posts_ingested: number | null;
    semantic_items_written: number | null;
    external_calls_made: number | null;
    library_unique_items: number | null;
    library_observations: number | null;
  };
  analyses: PublicVideoAnalysis[];
  evidence_boundaries: string[];
  errors: string[];
  measurement_gaps: string[];
}

interface PublicVideoAnalysis {
  canonical_url: string;
  platform: SocialPlatform;
  platform_post_id: string;
  duration_sec: number;
  hook: string;
  cta: string;
  style: string[];
  evidence_limitations: string[];
}

interface SqliteAnalysisRow {
  canonical_url: string;
  platform: SocialPlatform;
  platform_post_id: string;
  analysis_json: string;
}

export function validateScheduledRefreshRequest(
  input: unknown,
  maxTotalUsd = MAX_SCHEDULED_BUDGET_USD,
): UrlIntakeRequest {
  const request = validateUrlIntakeRequest(input);
  if (request.approval_state !== 'approved') {
    throw new Error('Scheduled semantic refresh requires an approved URL intake manifest.');
  }
  if (!Number.isFinite(maxTotalUsd) || maxTotalUsd <= 0 || maxTotalUsd > MAX_SCHEDULED_BUDGET_USD) {
    throw new Error(`Scheduled max budget must be positive and no greater than ${MAX_SCHEDULED_BUDGET_USD} USD.`);
  }
  if (request.cost_limits.max_total_usd > maxTotalUsd) {
    throw new Error(
      `Manifest ceiling ${request.cost_limits.max_total_usd} USD exceeds the scheduled cap ${maxTotalUsd} USD.`,
    );
  }
  return request;
}

export function evaluateRefreshPublicationGate(
  request: UrlIntakeRequest,
  report: SemanticIngestionReport,
  analyzedVideos: number,
  maxTotalUsd = MAX_SCHEDULED_BUDGET_USD,
): RefreshPublicationGate {
  const failures: string[] = [];
  const reconciliations = report.ingestion_reconciliation ?? [];
  const reconciledUrls = reconciliations.reduce((sum, row) => sum + row.accepted, 0);
  const unmatched = reconciliations.flatMap((row) => row.unmatched_requested_urls ?? []);
  const analysisCoverage = request.urls.length
    ? round(analyzedVideos / request.urls.length)
    : 0;

  if (!['completed', 'partial'].includes(report.status)) failures.push(`pipeline_status:${report.status}`);
  if (report.blockers.length) failures.push('pipeline_blockers_present');
  if (report.posts_ingested < request.urls.length) failures.push('not_all_requested_posts_ingested');
  if (reconciliations.length !== request.allowed_platforms.length) failures.push('provider_reconciliation_missing');
  if (reconciliations.some((row) => !row.reconciliation_passed)) failures.push('provider_reconciliation_failed');
  if (unmatched.length) failures.push('requested_urls_unmatched');
  if (reconciledUrls < request.urls.length) failures.push('accepted_post_count_below_request');
  if (analysisCoverage < MIN_ANALYSIS_COVERAGE) failures.push('twelvelabs_analysis_coverage_below_80_percent');
  if (report.total_cost_usd > maxTotalUsd + 1e-9) failures.push('scheduled_budget_exceeded');

  return {
    publishable: failures.length === 0,
    status: failures.length
      ? 'blocked'
      : report.status === 'completed' && analysisCoverage === 1
        ? 'completed'
        : 'partial',
    requested_urls: request.urls.length,
    reconciled_urls: reconciledUrls,
    analyzed_videos: analyzedVideos,
    analysis_coverage: analysisCoverage,
    budget_used_usd: round(report.total_cost_usd),
    failures,
  };
}

export function createBaselineDiscoveryReport(
  libraryInput: unknown,
  requestId: string,
  providerCostUsd: number,
): UnknownRecord {
  const library = record(libraryInput);
  const items = Array.isArray(library.items) ? library.items : [];
  const groupedRuns = new Map<string, { id: string; input_mode: string; items: UnknownRecord[] }>();

  for (const rawItem of items) {
    const item = recordOrNull(rawItem) as BaselineLibraryItem | null;
    if (!item) continue;
    const platform = socialPlatform(item.platform);
    const canonicalUrl = text(item.canonical_url);
    if (!platform || !canonicalUrl) continue;
    const observations = Array.isArray(item.observations) ? item.observations : [];
    const provenance = recordOrNull(item.provenance);
    for (const rawObservation of observations) {
      const observation = recordOrNull(rawObservation) as BaselineObservation | null;
      if (!observation || !isoDate(observation.captured_at)) continue;
      const sourceRuns = textArray(observation.source_runs).length
        ? textArray(observation.source_runs)
        : textArray(provenance?.source_runs).length
          ? textArray(provenance?.source_runs)
          : ['published-library-baseline'];
      const discoveryModes = textArray(observation.discovery_modes).length
        ? textArray(observation.discovery_modes)
        : textArray(provenance?.discovery_modes).length
          ? textArray(provenance?.discovery_modes)
          : ['stored_snapshot'];

      sourceRuns.forEach((sourceRun, index) => {
        const discoveryMode = discoveryModes[index] ?? discoveryModes[0] ?? 'stored_snapshot';
        const key = `${sourceRun}\u0000${discoveryMode}`;
        const run = groupedRuns.get(key) ?? { id: sourceRun, input_mode: discoveryMode, items: [] };
        run.items.push(discoveryItem(item, observation, platform, canonicalUrl));
        groupedRuns.set(key, run);
      });
    }
  }

  return {
    research_id: `published-library-baseline-for-${requestId}`,
    created_at: isoDate(library.generated_at) ?? new Date(0).toISOString(),
    totals: { actual_cost_usd_reported: round(providerCostUsd) },
    runs: [...groupedRuns.values()].sort((left, right) => (
      left.id.localeCompare(right.id) || left.input_mode.localeCompare(right.input_mode)
    )),
  };
}

export function redactPublicPipelineText(value: unknown, maxLength = 500): string {
  const textValue = typeof value === 'string' ? value : String(value ?? '');
  return textValue
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\/Users\/[^/\s]+\/[^\s]*/g, '[local path]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function buildPublicRefreshStatus(input: {
  request: UrlIntakeRequest;
  manifestPath: string;
  report: SemanticIngestionReport;
  gate: RefreshPublicationGate;
  library: ViralContentLibrary;
  analyses: PublicVideoAnalysis[];
  now?: () => Date;
}): PublicPipelineRefreshStatus {
  const now = input.now ?? (() => new Date());
  const apifyCost = providerCost(input.report, 'apify');
  const twelveLabsCost = providerCost(input.report, 'twelvelabs');
  return {
    schema_version: 'viralbench_pipeline_refresh_v1',
    status: input.gate.status === 'completed' ? 'completed' : 'partial',
    updated_at: now().toISOString(),
    last_completed_at: now().toISOString(),
    schedule: SCHEDULE_CONTRACT,
    budget: {
      currency: 'USD',
      max_total_usd: input.request.cost_limits.max_total_usd,
      max_apify_usd: input.request.cost_limits.max_apify_usd,
      max_twelvelabs_usd: input.request.cost_limits.max_twelvelabs_usd,
      actual_or_conservative_usd: round(input.report.total_cost_usd),
    },
    source: {
      request_id: input.request.request_id,
      manifest_path: input.manifestPath,
      requested_urls: input.request.urls.length,
    },
    providers: {
      apify: {
        state: 'completed',
        accepted_posts: input.gate.reconciled_urls,
        actual_or_conservative_usd: apifyCost,
      },
      twelvelabs: {
        state: input.gate.analysis_coverage === 1 ? 'completed' : 'partial',
        analyzed_videos: input.gate.analyzed_videos,
        analysis_coverage: input.gate.analysis_coverage,
        actual_or_conservative_usd: twelveLabsCost,
        models: input.report.model_traces
          .filter((trace) => trace.provider.toLowerCase() === 'twelvelabs')
          .map((trace) => trace.model),
      },
    },
    results: {
      posts_ingested: input.report.posts_ingested,
      semantic_items_written: input.report.semantic_items_written,
      external_calls_made: input.report.external_calls_made,
      library_unique_items: input.library.summary.unique_items,
      library_observations: input.library.summary.observations,
    },
    analyses: input.analyses,
    evidence_boundaries: [
      'The scheduled job reads only the approved public URLs in the committed intake manifest.',
      'Costs are provider-reported actuals when available and conservative estimates otherwise.',
      'Partial means every requested URL reconciled and at least 80% received TwelveLabs analysis; it does not mean complete analysis coverage.',
      'Creative descriptions are provider observations, not causal performance claims.',
      'Credentials, downloaded media, raw provider payloads, and the semantic database are not published.',
    ],
    errors: input.report.errors.map((entry) => redactPublicPipelineText(entry)),
    measurement_gaps: input.report.measurement_gaps.map((entry) => redactPublicPipelineText(entry)),
  };
}

function discoveryItem(
  item: BaselineLibraryItem,
  observation: BaselineObservation,
  platform: SocialPlatform,
  canonicalUrl: string,
): UnknownRecord {
  const contentType = text(item.content_type);
  const instagramType = contentType === 'carousel_post'
    ? { type: 'Sidecar', productType: 'carousel_container' }
    : contentType === 'image_post'
      ? { type: 'Image', productType: 'feed' }
      : contentType === 'short_video' || canonicalUrl.includes('/reel/')
        ? { type: 'Video', productType: 'clips' }
        : { type: 'Video', productType: 'feed' };
  return {
    url: canonicalUrl,
    text: text(item.caption),
    timestamp: isoDate(item.posted_at),
    scrapedAt: isoDate(observation.captured_at),
    username: text(item.account_handle),
    hashtags: textArray(item.hashtags),
    ...(platform === 'instagram' ? instagramType : {}),
    viewCount: nullableNumber(observation.views),
    likesCount: nullableNumber(observation.likes),
    commentsCount: nullableNumber(observation.comments),
    shareCount: nullableNumber(observation.shares),
    saveCount: nullableNumber(observation.saves),
  };
}

function readPublicAnalyses(dbPath: string): PublicVideoAnalysis[] {
  const sql = `
    SELECT p.canonical_url, p.platform, p.platform_post_id, a.analysis_json
    FROM video_analyses a
    JOIN video_assets v ON v.asset_id = a.video_asset_id
    JOIN social_posts p ON p.evidence_id = v.post_id
    ORDER BY p.platform, p.platform_post_id;
  `;
  const output = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
  const rows = output ? JSON.parse(output) as SqliteAnalysisRow[] : [];
  return rows.flatMap((row): PublicVideoAnalysis[] => {
    try {
      const analysis = JSON.parse(row.analysis_json) as VideoCreativeAnalysis;
      return [{
        canonical_url: row.canonical_url,
        platform: row.platform,
        platform_post_id: row.platform_post_id,
        duration_sec: round(analysis.duration_sec),
        hook: redactPublicPipelineText(analysis.hook?.text, 280),
        cta: redactPublicPipelineText(analysis.cta?.text, 280),
        style: textArray(analysis.style).map((entry) => redactPublicPipelineText(entry, 120)).slice(0, 8),
        evidence_limitations: textArray(analysis.evidence_limitations)
          .map((entry) => redactPublicPipelineText(entry, 240))
          .slice(0, 8),
      }];
    } catch {
      return [];
    }
  });
}

function providerCost(report: SemanticIngestionReport, provider: 'apify' | 'twelvelabs'): number {
  return round(report.costs
    .filter((entry) => entry.provider === provider)
    .reduce((sum, entry) => sum + (entry.actual_cost_usd ?? entry.estimated_cost_usd), 0));
}

function prepareArtifactDirectory(relativePath: string): { artifactDir: string; dbPath: string } {
  const allowedRoot = path.resolve('.semantic-artifacts/scheduled-refresh');
  const artifactDir = path.resolve(relativePath);
  if (artifactDir === allowedRoot || !artifactDir.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error('Scheduled refresh artifact directory must be inside .semantic-artifacts/scheduled-refresh/.');
  }
  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  return { artifactDir, dbPath: path.join(artifactDir, 'semantic-corpus.sqlite') };
}

async function runRefresh(options: CliOptions, request: UrlIntakeRequest, env: NodeJS.ProcessEnv): Promise<void> {
  const { artifactDir, dbPath } = prepareArtifactDirectory(options.artifactDir);
  const report = await ingestSemanticUrlsLive(request, {
    dbPath,
    artifactDir,
    env,
  });
  const analyses = readPublicAnalyses(dbPath);
  const gate = evaluateRefreshPublicationGate(request, report, analyses.length, options.maxTotalUsd);
  atomicWriteJson(path.join(artifactDir, 'reports', 'scheduled-publication-gate.json'), gate);
  if (!gate.publishable) {
    throw new Error(`Scheduled refresh publication gate failed: ${gate.failures.join(', ')}`);
  }

  const currentLibrary = JSON.parse(fs.readFileSync(path.resolve(options.siteLibraryPath), 'utf8')) as unknown;
  const currentLibraryRecord = record(currentLibrary);
  const currentSources = recordOrNull(currentLibraryRecord.sources);
  const previousCost = nullableNumber(currentSources?.provider_cost_usd_reported) ?? 0;
  const baselinePath = path.join(artifactDir, 'published-library-baseline.json');
  atomicWriteJson(
    baselinePath,
    createBaselineDiscoveryReport(currentLibrary, request.request_id, previousCost + providerCost(report, 'apify')),
  );
  const library = buildViralContentLibrary({
    discoveryFiles: [baselinePath],
    sqlitePath: dbPath,
  });
  library.sources.discovery_files = [
    `published-library-baseline:${isoDate(currentLibraryRecord.generated_at) ?? 'unknown'}`,
    path.relative(process.cwd(), path.resolve(options.manifestPath)),
  ];
  library.sources.sqlite_path = `scheduled-refresh:${request.request_id}`;
  atomicWriteJson(path.resolve(options.siteLibraryPath), library);

  const publicStatus = buildPublicRefreshStatus({
    request,
    manifestPath: path.relative(process.cwd(), path.resolve(options.manifestPath)),
    report,
    gate,
    library,
    analyses,
  });
  atomicWriteJson(path.resolve(options.siteStatusPath), publicStatus);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    request_id: request.request_id,
    status: gate.status,
    requested_urls: gate.requested_urls,
    analyzed_videos: gate.analyzed_videos,
    analysis_coverage: gate.analysis_coverage,
    total_cost_usd: gate.budget_used_usd,
    library_unique_items: library.summary.unique_items,
    library_observations: library.summary.observations,
    external_calls_made: report.external_calls_made,
  }, null, 2)}\n`);
}

function parseCli(argv: string[]): CliOptions {
  const preflight = argv.includes('--preflight');
  const run = argv.includes('--run');
  if (preflight === run) {
    throw new Error('Choose exactly one mode: --preflight or --run.');
  }
  const value = (name: string, fallback?: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index < 0) return fallback;
    const result = argv[index + 1];
    if (!result || result.startsWith('--')) throw new Error(`${name} requires a value.`);
    return result;
  };
  const budget = Number(value('--max-total-usd', String(MAX_SCHEDULED_BUDGET_USD)));
  if (!Number.isFinite(budget)) throw new Error('--max-total-usd must be a number.');
  return {
    mode: preflight ? 'preflight' : 'run',
    manifestPath: value('--manifest', DEFAULT_MANIFEST)!,
    artifactDir: value('--artifact-dir', DEFAULT_ARTIFACT_DIR)!,
    siteLibraryPath: value('--site-library', DEFAULT_LIBRARY)!,
    siteStatusPath: value('--site-status', DEFAULT_STATUS)!,
    envFile: value('--env-file'),
    maxTotalUsd: budget,
  };
}

async function main(): Promise<void> {
  let options: CliOptions | null = null;
  try {
    options = parseCli(process.argv.slice(2));
    const request = validateScheduledRefreshRequest(
      JSON.parse(fs.readFileSync(path.resolve(options.manifestPath), 'utf8')),
      options.maxTotalUsd,
    );
    const merged = mergeEnvWithFile(process.env, { envFile: options.envFile });
    const env = merged.effective_env;
    const preflight: SemanticPreflightReport = buildSemanticPreflight(request, env);
    if (options.mode === 'preflight') {
      process.stdout.write(`${JSON.stringify({
        ...preflight,
        manifest_path: path.relative(process.cwd(), path.resolve(options.manifestPath)),
        max_scheduled_total_usd: options.maxTotalUsd,
        env_file_loaded: merged.env_file?.exists ?? false,
      }, null, 2)}\n`);
      if (!preflight.live_ready) process.exitCode = 1;
      return;
    }
    if (!preflight.live_ready) {
      throw new Error(`Semantic refresh preflight blocked: ${preflight.blockers.join(', ')}`);
    }
    await runRefresh(options, request, env);
  } catch (error) {
    const message = redactPublicPipelineText(error instanceof Error ? error.message : String(error), 1_000);
    if (options) {
      const artifactDir = path.resolve(options.artifactDir);
      if (artifactDir.startsWith(`${path.resolve('.semantic-artifacts/scheduled-refresh')}${path.sep}`)) {
        atomicWriteJson(path.join(artifactDir, 'reports', 'scheduled-refresh-failure.json'), {
          schema_version: 'viralbench_scheduled_refresh_failure_v1',
          failed_at: new Date().toISOString(),
          message,
          credentials_serialized: false,
        });
      }
    }
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object.');
  }
  return value as UnknownRecord;
}

function recordOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function socialPlatform(value: unknown): SocialPlatform | null {
  return typeof value === 'string' && ['tiktok', 'instagram', 'youtube_shorts'].includes(value)
    ? value as SocialPlatform
    : null;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

if (require.main === module) {
  void main();
}
