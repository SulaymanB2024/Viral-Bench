import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CREATIVE_PROVIDER_NAMES,
  PAID_PROVIDER_NAMES,
  type CreativeProviderName,
} from '../packages/creative/job_schema';

export const SUPPORTED_PROVIDER_NAMES = CREATIVE_PROVIDER_NAMES;

export const PROVIDER_MODES = [
  'dry_run',
  'manual',
  'generation',
  'analysis',
] as const;

export const PROVIDER_REQUEST_STATUSES = [
  'draft',
  'blocked',
  'skipped',
  'completed',
] as const;

const OUTPUT_KINDS = [
  'image',
  'video',
  'text',
  'qa',
  'manifest',
  'research',
] as const;

export type ProviderMode = typeof PROVIDER_MODES[number];
export type ProviderRequestStatus = typeof PROVIDER_REQUEST_STATUSES[number];
export type ProviderOutputKind = typeof OUTPUT_KINDS[number];
export type ProviderName = CreativeProviderName;
export type GateEnv = Record<string, string | undefined>;

export interface ProviderOutputRequirement {
  path: string;
  kind: ProviderOutputKind;
  description: string;
}

export interface ProviderRequestOutputRequirements {
  package_subdir: string;
  files: ProviderOutputRequirement[];
  notes: string[];
}

export interface ProviderCostPolicy {
  allow_paid_generation: boolean;
  allow_browser_ui: boolean;
  external_calls_allowed: boolean;
  max_cost_usd: number;
  currency: 'USD';
  notes: string[];
}

export interface ProviderRequestManifest {
  request_id: string;
  provider: ProviderName;
  provider_mode: ProviderMode;
  job_id: string;
  input_assets: string[];
  prompt_path: string;
  output_requirements: ProviderRequestOutputRequirements;
  cost_policy: ProviderCostPolicy;
  approval_required: boolean;
  status: ProviderRequestStatus;
}

export interface ProviderRequestCreateInput {
  request_id: string;
  provider: ProviderName;
  job_id: string;
  prompt_path: string;
  provider_mode?: ProviderMode;
  input_assets?: string[];
  output_requirements?: ProviderRequestOutputRequirements;
  cost_policy?: Partial<ProviderCostPolicy>;
  approval_required?: boolean;
  status?: ProviderRequestStatus;
}

export interface ProviderDryRunResult {
  request_id: string;
  provider: ProviderName;
  status: 'blocked' | 'skipped';
  external_calls_made: 0;
  output_paths: string[];
  log: string[];
}

export interface WriteProviderOutputOptions {
  relativePath: string;
  content: string | Buffer;
  overwrite?: boolean;
}

export function createProviderRequestManifest(input: ProviderRequestCreateInput): ProviderRequestManifest {
  return validateProviderRequestManifest({
    request_id: input.request_id,
    provider: input.provider,
    provider_mode: input.provider_mode ?? 'dry_run',
    job_id: input.job_id,
    input_assets: input.input_assets ?? [],
    prompt_path: input.prompt_path,
    output_requirements: input.output_requirements ?? defaultOutputRequirements(input.provider),
    cost_policy: {
      allow_paid_generation: false,
      allow_browser_ui: false,
      external_calls_allowed: false,
      max_cost_usd: 0,
      currency: 'USD',
      notes: ['Created as a dry-run request. External calls stay blocked until explicitly enabled.'],
      ...input.cost_policy,
    },
    approval_required: input.approval_required ?? true,
    status: input.status ?? 'draft',
  });
}

export function loadProviderRequestManifest(filePath: string): ProviderRequestManifest {
  return validateProviderRequestManifest(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function validateProviderRequestManifest(input: unknown): ProviderRequestManifest {
  const record = expectRecord(input, 'provider request manifest');
  const request: ProviderRequestManifest = {
    request_id: requiredText(record, 'request_id'),
    provider: oneOf(requiredText(record, 'provider'), CREATIVE_PROVIDER_NAMES, 'provider'),
    provider_mode: oneOf(requiredText(record, 'provider_mode'), PROVIDER_MODES, 'provider_mode'),
    job_id: requiredText(record, 'job_id'),
    input_assets: requiredTextArray(record, 'input_assets', { allowEmpty: true }),
    prompt_path: requiredText(record, 'prompt_path'),
    output_requirements: normalizeOutputRequirements(expectRecord(record.output_requirements, 'output_requirements')),
    cost_policy: normalizeCostPolicy(expectRecord(record.cost_policy, 'cost_policy')),
    approval_required: requiredBoolean(record, 'approval_required'),
    status: oneOf(requiredText(record, 'status'), PROVIDER_REQUEST_STATUSES, 'status'),
  };

  if (request.provider_mode !== 'dry_run' && !request.approval_required) {
    throw new Error('approval_required must be true for non-dry-run provider requests.');
  }
  if (request.provider !== 'local_renderer' && request.cost_policy.external_calls_allowed) {
    throw new Error('external_calls_allowed must remain false in this scaffold.');
  }
  return request;
}

export function runProviderDryRun(
  input: ProviderRequestManifest | unknown,
  options: { env?: GateEnv } = {},
): ProviderDryRunResult {
  const request = validateProviderRequestManifest(input);
  const gate = evaluateProviderGate(request, options.env ?? process.env);
  if (!gate.allowed) {
    return {
      request_id: request.request_id,
      provider: request.provider,
      status: 'blocked',
      external_calls_made: 0,
      output_paths: declaredOutputPaths(request),
      log: [
        `blocked provider request ${request.request_id} (${request.provider})`,
        gate.reason,
        'No external calls were made.',
      ],
    };
  }

  return {
    request_id: request.request_id,
    provider: request.provider,
    status: 'skipped',
    external_calls_made: 0,
    output_paths: declaredOutputPaths(request),
    log: [
      `skipped provider request ${request.request_id} (${request.provider})`,
      'Dry run only: provider interfaces are scaffolded, but no Gemini, OpenAI, browser UI, or social platform call was made.',
      `Declared outputs would be written under ${request.output_requirements.package_subdir}/ after an approved provider implementation returns local artifacts.`,
    ],
  };
}

export function writeProviderOutput(
  input: ProviderRequestManifest | unknown,
  packageDir: string,
  options: WriteProviderOutputOptions,
): string {
  const request = validateProviderRequestManifest(input);
  const packageRoot = path.resolve(packageDir);
  if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) {
    throw new Error(`Rendered package folder does not exist: ${packageDir}`);
  }

  const normalizedRelativePath = normalizeRelativePath(options.relativePath);
  const allowedPaths = new Set(declaredOutputPaths(request));
  if (!allowedPaths.has(normalizedRelativePath)) {
    throw new Error(`Provider output path is not declared by this request: ${normalizedRelativePath}`);
  }

  const absolutePath = path.resolve(packageRoot, normalizedRelativePath);
  if (!absolutePath.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error('Provider output path must stay inside the rendered package folder.');
  }

  if (fs.existsSync(absolutePath) && !options.overwrite) {
    throw new Error(`Refusing to overwrite existing approved package file without overwrite flag: ${normalizedRelativePath}`);
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, options.content);
  return absolutePath;
}

function evaluateProviderGate(
  request: ProviderRequestManifest,
  env: GateEnv,
): { allowed: true } | { allowed: false; reason: string } {
  if (request.status !== 'draft') {
    return {
      allowed: false,
      reason: `Request status is ${request.status}; only draft requests can run through dry-run evaluation.`,
    };
  }

  if (PAID_PROVIDER_NAMES.includes(request.provider)) {
    if (!request.cost_policy.allow_paid_generation) {
      return {
        allowed: false,
        reason: 'Paid generation is blocked unless cost_policy.allow_paid_generation=true and ALLOW_PAID_GENERATION=true.',
      };
    }
    if (!envEnabled(env, 'ALLOW_PAID_GENERATION')) {
      return {
        allowed: false,
        reason: 'Paid generation is blocked unless ALLOW_PAID_GENERATION=true.',
      };
    }
  }

  if (request.provider === 'browser_manual') {
    if (!request.cost_policy.allow_browser_ui) {
      return {
        allowed: false,
        reason: 'Browser UI workflows are blocked unless cost_policy.allow_browser_ui=true and ALLOW_BROWSER_UI=true.',
      };
    }
    if (!envEnabled(env, 'ALLOW_BROWSER_UI')) {
      return {
        allowed: false,
        reason: 'Browser UI workflows are blocked unless ALLOW_BROWSER_UI=true.',
      };
    }
  }

  return { allowed: true };
}

function defaultOutputRequirements(provider: ProviderName): ProviderRequestOutputRequirements {
  return {
    package_subdir: `provider_outputs/${provider}`,
    files: [
      {
        path: 'dry_run_notes.md',
        kind: 'text',
        description: 'Dry-run notes for the provider request.',
      },
    ],
    notes: ['No provider output is generated until an approved implementation returns local artifacts.'],
  };
}

function normalizeOutputRequirements(record: Record<string, unknown>): ProviderRequestOutputRequirements {
  return {
    package_subdir: normalizeRelativePath(requiredText(record, 'package_subdir')),
    files: requiredRecordArray(record, 'files').map(normalizeOutputRequirement),
    notes: requiredTextArray(record, 'notes'),
  };
}

function normalizeOutputRequirement(record: Record<string, unknown>): ProviderOutputRequirement {
  return {
    path: normalizeRelativePath(requiredText(record, 'path')),
    kind: oneOf(requiredText(record, 'kind'), OUTPUT_KINDS, 'output_requirements.files.kind'),
    description: requiredText(record, 'description'),
  };
}

function normalizeCostPolicy(record: Record<string, unknown>): ProviderCostPolicy {
  const maxCost = requiredNumber(record, 'max_cost_usd');
  if (maxCost < 0) throw new Error('cost_policy.max_cost_usd must be zero or greater.');
  return {
    allow_paid_generation: requiredBoolean(record, 'allow_paid_generation'),
    allow_browser_ui: requiredBoolean(record, 'allow_browser_ui'),
    external_calls_allowed: requiredBoolean(record, 'external_calls_allowed'),
    max_cost_usd: maxCost,
    currency: oneOf(requiredText(record, 'currency'), ['USD'] as const, 'cost_policy.currency'),
    notes: requiredTextArray(record, 'notes'),
  };
}

function declaredOutputPaths(request: ProviderRequestManifest): string[] {
  return request.output_requirements.files.map((file) => (
    normalizeRelativePath(path.join(request.output_requirements.package_subdir, file.path))
  ));
}

function normalizeRelativePath(value: string): string {
  if (path.isAbsolute(value)) {
    throw new Error('Provider paths must be relative.');
  }
  const normalized = path.normalize(value).replace(/\\/g, '/');
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new Error('Provider paths must stay inside the rendered package folder.');
  }
  return normalized;
}

function envEnabled(env: GateEnv, key: string): boolean {
  return (env[key] ?? '').toLowerCase() === 'true';
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredRecordArray(record: Record<string, unknown>, field: string): Array<Record<string, unknown>> {
  const value = record[field];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  if (!value.length) throw new Error(`${field} must not be empty.`);
  return value.map((item, index) => expectRecord(item, `${field}[${index}]`));
}

function requiredTextArray(
  record: Record<string, unknown>,
  field: string,
  options: { allowEmpty?: boolean } = {},
): string[] {
  const value = record[field];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  if (!options.allowEmpty && !value.length) throw new Error(`${field} must not be empty.`);
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${field}[${index}] must be a non-empty string.`);
    }
    return item.trim();
  });
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  return value;
}

function oneOf<T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}
