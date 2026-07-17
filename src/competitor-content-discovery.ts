import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ApifyApiClient,
  canonicalJson,
  type ApifyActorExecution,
} from './apify-api';
import { atomicWriteJson } from './artifact-integrity';

const APIFY_INSTAGRAM_SCRAPER = 'apify/instagram-scraper';
const INSTAGRAM_RESULTS_TYPES = ['posts', 'details', 'comments', 'reels', 'mentions', 'stories'] as const;
const INSTAGRAM_SEARCH_TYPES = ['hashtag', 'profile', 'place', 'user'] as const;

interface DiscoveryRun {
  id: string;
  actor_id: string;
  input_mode: ApifyActorExecution['actor_input_mode'];
  input: Record<string, unknown>;
  max_charge_usd: number;
  max_items: number;
  build?: string;
}

interface DiscoveryConfig {
  research_id: string;
  purpose: 'public_competitor_content_research';
  publishing_in_scope: false;
  max_total_charge_usd?: number;
  runs: DiscoveryRun[];
}

interface DiscoveryReport {
  research_id: string;
  created_at: string;
  purpose: DiscoveryConfig['purpose'];
  publishing_in_scope: false;
  runs: Array<{
    id: string;
    actor_id: string;
    input_mode: DiscoveryRun['input_mode'];
    run_id: string;
    dataset_id: string;
    actor_build_id: string | null;
    actor_build_number: string | null;
    actor_input_sha256: string;
    status: 'SUCCEEDED';
    actual_cost_usd: number | null;
    usage_finalized: boolean;
    item_count: number;
    external_calls_made: number;
    items: unknown[];
  }>;
  errors: Array<{ id: string; message: string }>;
  totals: {
    successful_runs: number;
    failed_runs: number;
    items: number;
    actual_cost_usd_reported: number;
    configured_max_charge_usd: number;
    conservative_spend_usd: number;
    remaining_cap_usd: number;
    external_calls_made: number;
  };
  redactions: ['credential values are never serialized'];
}

export async function collectCompetitorContent(
  configInput: DiscoveryConfig | unknown,
  token: string,
): Promise<DiscoveryReport> {
  const config = validateDiscoveryConfig(configInput);
  if (config.purpose !== 'public_competitor_content_research' || config.publishing_in_scope !== false) {
    throw new Error('Discovery config must remain public research-only with publishing disabled.');
  }
  const configuredMaxChargeUsd = roundMoney(config.runs.reduce((sum, run) => sum + run.max_charge_usd, 0));
  const batchCapUsd = config.max_total_charge_usd ?? configuredMaxChargeUsd;
  const client = new ApifyApiClient({ token });
  const runs: DiscoveryReport['runs'] = [];
  const errors: DiscoveryReport['errors'] = [];
  let conservativeSpendUsd = 0;

  for (const run of config.runs) {
    if (roundMoney(conservativeSpendUsd + run.max_charge_usd) > batchCapUsd) {
      errors.push({
        id: run.id,
        message: `budget_stop:max potential charge ${run.max_charge_usd} exceeds remaining batch cap ${roundMoney(batchCapUsd - conservativeSpendUsd)}`,
      });
      continue;
    }
    const callsBeforeRun = client.externalCallsMade;
    try {
      const result = await client.executeActor({
        actorId: run.actor_id,
        input: run.input,
        inputMode: run.input_mode,
        maxTotalChargeUsd: run.max_charge_usd,
        maxItems: run.max_items,
        build: run.build,
        maxDatasetItems: run.max_items,
        usageSettlementMs: 5_000,
      });
      runs.push({
        id: run.id,
        actor_id: result.actor_id,
        input_mode: run.input_mode,
        run_id: result.run_id,
        dataset_id: result.dataset_id,
        actor_build_id: result.actor_build_id,
        actor_build_number: result.actor_build_number,
        actor_input_sha256: result.actor_input_sha256,
        status: result.status,
        actual_cost_usd: result.actual_cost_usd,
        usage_finalized: result.usage_finalized,
        item_count: result.items.length,
        external_calls_made: result.external_calls_made,
        items: result.items,
      });
      conservativeSpendUsd = roundMoney(
        conservativeSpendUsd + (result.actual_cost_usd ?? run.max_charge_usd),
      );
    } catch (error) {
      if (client.externalCallsMade > callsBeforeRun) {
        // A chargeable run-start request was made, so reserve the full ceiling
        // when provider usage is unavailable. This prevents a failed or
        // partially observed run from silently freeing budget for another run.
        conservativeSpendUsd = roundMoney(conservativeSpendUsd + run.max_charge_usd);
      }
      errors.push({
        id: run.id,
        message: redactError(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return {
    research_id: config.research_id,
    created_at: new Date().toISOString(),
    purpose: config.purpose,
    publishing_in_scope: false,
    runs,
    errors,
    totals: {
      successful_runs: runs.length,
      failed_runs: errors.length,
      items: runs.reduce((sum, run) => sum + run.item_count, 0),
      actual_cost_usd_reported: roundMoney(runs.reduce((sum, run) => sum + (run.actual_cost_usd ?? 0), 0)),
      configured_max_charge_usd: configuredMaxChargeUsd,
      conservative_spend_usd: conservativeSpendUsd,
      remaining_cap_usd: roundMoney(Math.max(0, batchCapUsd - conservativeSpendUsd)),
      external_calls_made: client.externalCallsMade,
    },
    redactions: ['credential values are never serialized'],
  };
}

function parseCli(argv: string[]): { configPath: string; outputPath: string; validateOnly: boolean } {
  const values = new Map<string, string>();
  let validateOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    if (key === '--validate-only') {
      validateOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    values.set(key, value);
    index += 1;
  }
  return {
    configPath: values.get('--config') ?? '.ops/competitor_research/internship-content-expansion-20260716.json',
    outputPath: values.get('--out') ?? '.semantic-artifacts/competitor-content/discovery/internship-content-expansion-20260716.json',
    validateOnly,
  };
}

export function validateDiscoveryConfig(input: unknown): DiscoveryConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Discovery config must be an object.');
  }
  const parsed = input as Partial<DiscoveryConfig>;
  if (!parsed.research_id?.trim() || !Array.isArray(parsed.runs) || parsed.runs.length === 0) {
    throw new Error('Discovery config requires research_id and at least one run.');
  }
  if (parsed.purpose !== 'public_competitor_content_research' || parsed.publishing_in_scope !== false) {
    throw new Error('Discovery config must remain public research-only with publishing disabled.');
  }
  for (const run of parsed.runs) {
    if (!run.id?.trim() || !run.actor_id?.trim() || !run.input || typeof run.input !== 'object') {
      throw new Error('Each discovery run requires id, actor_id, input_mode, and input.');
    }
    if (!Number.isFinite(run.max_charge_usd) || run.max_charge_usd <= 0) {
      throw new Error(`${run.id}.max_charge_usd must be positive.`);
    }
    if (!Number.isInteger(run.max_items) || run.max_items <= 0) {
      throw new Error(`${run.id}.max_items must be a positive integer.`);
    }
    if (run.actor_id === APIFY_INSTAGRAM_SCRAPER) validateInstagramDiscoveryRun(run);
  }
  const configuredMaxChargeUsd = roundMoney(parsed.runs.reduce((sum, run) => sum + run.max_charge_usd, 0));
  const batchCapUsd = parsed.max_total_charge_usd ?? configuredMaxChargeUsd;
  if (!Number.isFinite(batchCapUsd) || batchCapUsd <= 0) {
    throw new Error('max_total_charge_usd must be a positive finite number.');
  }
  if (configuredMaxChargeUsd > batchCapUsd) {
    throw new Error(`Configured run ceilings ${configuredMaxChargeUsd} exceed batch cap ${batchCapUsd}.`);
  }
  return parsed as DiscoveryConfig;
}

function validateInstagramDiscoveryRun(run: DiscoveryRun): void {
  const input = run.input;
  const resultsType = optionalString(input.resultsType) ?? 'posts';
  if (!INSTAGRAM_RESULTS_TYPES.includes(resultsType as typeof INSTAGRAM_RESULTS_TYPES[number])) {
    throw new Error(`${run.id}.input.resultsType is not supported by ${APIFY_INSTAGRAM_SCRAPER}.`);
  }
  const directUrls = input.directUrls;
  if (directUrls !== undefined && (
    !Array.isArray(directUrls)
    || directUrls.length === 0
    || directUrls.some((value) => typeof value !== 'string' || !value.trim())
  )) {
    throw new Error(`${run.id}.input.directUrls must be a non-empty string array when provided.`);
  }
  const search = optionalString(input.search);
  if (Array.isArray(directUrls) && directUrls.length && search) {
    throw new Error(`${run.id} cannot combine directUrls and search for ${APIFY_INSTAGRAM_SCRAPER}.`);
  }
  const searchType = optionalString(input.searchType);
  if (searchType && !INSTAGRAM_SEARCH_TYPES.includes(searchType as typeof INSTAGRAM_SEARCH_TYPES[number])) {
    throw new Error(`${run.id}.input.searchType is not supported by ${APIFY_INSTAGRAM_SCRAPER}.`);
  }
  if (search && ['comments', 'mentions', 'stories'].includes(resultsType)) {
    throw new Error(`${run.id}.input.resultsType=${resultsType} requires direct Instagram URLs.`);
  }
  positiveIntegerIfPresent(input.resultsLimit, `${run.id}.input.resultsLimit`);
  positiveIntegerIfPresent(input.searchLimit, `${run.id}.input.searchLimit`, 250);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveIntegerIfPresent(value: unknown, field: string, maximum?: number): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) <= 0 || (maximum !== undefined && (value as number) > maximum)) {
    throw new Error(`${field} must be a positive integer${maximum === undefined ? '' : ` no greater than ${maximum}`}.`);
  }
}

function readConfig(filePath: string): DiscoveryConfig {
  return validateDiscoveryConfig(JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')));
}

function writeReport(filePath: string, report: DiscoveryReport): void {
  atomicWriteJson(path.resolve(filePath), report);
}

function redactError(value: string): string {
  return value
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 1_000);
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const config = readConfig(options.configPath);
  if (options.validateOnly) {
    process.stdout.write(`${JSON.stringify({
      research_id: config.research_id,
      runs: config.runs.length,
      actor_inputs: config.runs.map((run) => ({
        id: run.id,
        actor_id: run.actor_id,
        build: run.build ?? 'default',
        input_sha256: sha256Hash(canonicalJson(run.input)),
      })),
      configured_max_charge_usd: roundMoney(config.runs.reduce((sum, run) => sum + run.max_charge_usd, 0)),
      max_total_charge_usd: config.max_total_charge_usd ?? roundMoney(config.runs.reduce((sum, run) => sum + run.max_charge_usd, 0)),
      external_calls_made: 0,
    }, null, 2)}\n`);
    return;
  }
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error('APIFY_TOKEN is required.');
  const report = await collectCompetitorContent(config, token);
  writeReport(options.outputPath, report);
  process.stdout.write(`${JSON.stringify({
    research_id: report.research_id,
    runs: report.totals.successful_runs,
    failed_runs: report.totals.failed_runs,
    items: report.totals.items,
    actual_cost_usd_reported: report.totals.actual_cost_usd_reported,
    output_path: options.outputPath,
  }, null, 2)}\n`);
}

function sha256Hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

if (require.main === module) {
  void main();
}
