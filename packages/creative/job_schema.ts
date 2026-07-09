import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const CREATIVE_PROVIDER_NAMES = [
  'local_renderer',
  'gemini_image',
  'gemini_video_understanding',
  'openai_image',
  'browser_manual',
] as const;

export type CreativeProviderName = typeof CREATIVE_PROVIDER_NAMES[number];

export const PAID_PROVIDER_NAMES: CreativeProviderName[] = [
  'gemini_image',
  'gemini_video_understanding',
  'openai_image',
];

export type ApprovalState = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'posted';
export type GateEnv = Record<string, string | undefined>;

export interface SourceInput {
  kind: 'manual_note' | 'creative_center_manual_observation' | 'local_file' | 'reference_url' | 'item_pricing_note';
  label: string;
  value?: string;
  path?: string;
  url?: string;
  captured_at?: string;
  notes?: string;
}

export interface TrendExampleReference {
  id: string;
  source_name: string;
  source_url: string;
  captured_at: string;
  platform: string;
  format: string;
  hook: string;
  notes: string;
}

export interface ProviderPolicy {
  approved_providers: CreativeProviderName[];
  allow_paid_generation: boolean;
  allow_browser_ui: boolean;
  allow_social_publishing: boolean;
  account_automation_allowed: false;
  credentials_policy: 'no_credentials_in_repo';
  notes: string[];
}

export interface CreativeSlideRequirement {
  slide_number: number;
  on_screen_text: string;
  visual_direction: string;
}

export interface OutputRequirements {
  aspect_ratio: '9:16';
  dimensions: {
    width: number;
    height: number;
  };
  slide_count: number;
  required_outputs: Array<'slides' | 'caption' | 'hashtags' | 'spoken_script' | 'posting_notes'>;
  slides: CreativeSlideRequirement[];
  caption: string;
  hashtags: string[];
  spoken_script: string;
  posting_notes: string[];
}

export interface ApprovalStatus {
  state: ApprovalState;
  human_reviewer: string | null;
  reviewed_at: string | null;
  notes: string[];
}

export interface GeneratedAsset {
  provider: CreativeProviderName;
  kind: 'slide' | 'caption' | 'hashtags' | 'spoken_script' | 'posting_notes' | 'image' | 'video' | 'qa';
  path: string;
  sha256?: string;
  created_at?: string;
  approved_for_posting: boolean;
  notes?: string;
}

export interface CreativeJobManifest {
  job_id: string;
  niche: string;
  platform_targets: string[];
  content_type: string;
  source_inputs: SourceInput[];
  trend_examples: TrendExampleReference[];
  provider_policy: ProviderPolicy;
  output_requirements: OutputRequirements;
  approval_status: ApprovalStatus;
  generated_assets: GeneratedAsset[];
  qa_notes: string[];
}

export interface SecretScanFinding {
  file: string;
  line: number;
  rule: string;
}

const APPROVAL_STATES = ['draft', 'pending_review', 'approved', 'rejected', 'posted'] as const;
const SOURCE_INPUT_KINDS = [
  'manual_note',
  'creative_center_manual_observation',
  'local_file',
  'reference_url',
  'item_pricing_note',
] as const;
const REQUIRED_OUTPUTS = ['slides', 'caption', 'hashtags', 'spoken_script', 'posting_notes'] as const;
const ASSET_KINDS = ['slide', 'caption', 'hashtags', 'spoken_script', 'posting_notes', 'image', 'video', 'qa'] as const;
const TEXT_FILE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.gitignore',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const SECRET_PATTERNS: Array<{ rule: string; pattern: RegExp }> = [
  { rule: 'openai_api_key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { rule: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { rule: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule: 'github_token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { rule: 'slack_token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  {
    rule: 'literal_secret_assignment',
    pattern: /\b(?:API_KEY|SECRET|PASSWORD|ACCESS_TOKEN|REFRESH_TOKEN|AUTHORIZATION)\b\s*[:=]\s*["']([^"'\r\n]{16,})["']/g,
  },
];

export function loadCreativeJobManifest(filePath: string): CreativeJobManifest {
  const raw = fs.readFileSync(filePath, 'utf8');
  return validateCreativeJobManifest(JSON.parse(raw));
}

export function validateCreativeJobManifest(input: unknown): CreativeJobManifest {
  const record = expectRecord(input, 'creative job manifest');
  const outputRequirements = normalizeOutputRequirements(expectRecord(record.output_requirements, 'output_requirements'));
  const job: CreativeJobManifest = {
    job_id: requiredText(record, 'job_id'),
    niche: requiredText(record, 'niche'),
    platform_targets: requiredTextArray(record, 'platform_targets'),
    content_type: requiredText(record, 'content_type'),
    source_inputs: requiredRecordArray(record, 'source_inputs').map(normalizeSourceInput),
    trend_examples: requiredRecordArray(record, 'trend_examples').map(normalizeTrendExample),
    provider_policy: normalizeProviderPolicy(expectRecord(record.provider_policy, 'provider_policy')),
    output_requirements: outputRequirements,
    approval_status: normalizeApprovalStatus(expectRecord(record.approval_status, 'approval_status')),
    generated_assets: requiredRecordArray(record, 'generated_assets').map(normalizeGeneratedAsset),
    qa_notes: requiredTextArray(record, 'qa_notes'),
  };

  assertNoAccountAutomation(job);
  return job;
}

export function assertProviderAllowed(
  input: CreativeJobManifest | unknown,
  provider: CreativeProviderName,
  env: GateEnv = process.env,
): CreativeJobManifest {
  const job = validateCreativeJobManifest(input);
  if (!job.provider_policy.approved_providers.includes(provider)) {
    throw new Error(`Provider "${provider}" is not approved for creative job "${job.job_id}".`);
  }

  if (PAID_PROVIDER_NAMES.includes(provider)) {
    if (!job.provider_policy.allow_paid_generation) {
      throw new Error(`Provider "${provider}" is paid/external and the job policy does not allow paid generation.`);
    }
    requireEnvGate(env, 'ALLOW_PAID_GENERATION', 'paid generation');
  }

  if (provider === 'browser_manual') {
    if (!job.provider_policy.allow_browser_ui) {
      throw new Error('Browser UI workflows are disabled by this creative job policy.');
    }
    requireEnvGate(env, 'ALLOW_BROWSER_UI', 'browser UI workflow');
  }

  return job;
}

export function assertCanMoveCreativeJobStatus(
  input: CreativeJobManifest | unknown,
  targetState: ApprovalState,
  env: GateEnv = process.env,
): CreativeJobManifest {
  const job = validateCreativeJobManifest(input);
  if (targetState !== 'posted') return job;

  if (!job.provider_policy.allow_social_publishing) {
    throw new Error('Social publishing is disabled by this creative job policy.');
  }
  requireEnvGate(env, 'ALLOW_SOCIAL_PUBLISHING', 'social publishing');

  if (
    job.approval_status.state !== 'approved'
    || !job.approval_status.human_reviewer
    || !job.approval_status.reviewed_at
  ) {
    throw new Error('Human approval is required before generated assets can move to posted.');
  }

  const unapprovedAssets = job.generated_assets.filter((asset) => !asset.approved_for_posting);
  if (unapprovedAssets.length) {
    throw new Error(`Generated assets require human approval before posting: ${unapprovedAssets.map((a) => a.path).join(', ')}`);
  }

  return job;
}

export function scanRepositoryForSecrets(rootDir = process.cwd()): SecretScanFinding[] {
  const files = listGitCandidateFiles(rootDir);
  const findings: SecretScanFinding[] = [];

  for (const relativePath of files) {
    if (!isTextCandidate(relativePath)) continue;
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size > 512 * 1024) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');

    for (const { rule, pattern } of SECRET_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const candidate = match[1] ?? match[0];
        if (isPlaceholderSecret(candidate)) continue;
        findings.push({
          file: relativePath,
          line: lineNumberAt(content, match.index),
          rule,
        });
      }
    }
  }

  return findings;
}

function normalizeSourceInput(record: Record<string, unknown>): SourceInput {
  const item: SourceInput = {
    kind: oneOf(requiredText(record, 'kind'), SOURCE_INPUT_KINDS, 'source_inputs.kind'),
    label: requiredText(record, 'label'),
  };
  const value = optionalText(record.value, 'source_inputs.value');
  const sourcePath = optionalText(record.path, 'source_inputs.path');
  const url = optionalText(record.url, 'source_inputs.url');
  const capturedAt = optionalText(record.captured_at, 'source_inputs.captured_at');
  const notes = optionalText(record.notes, 'source_inputs.notes');
  if (value) item.value = value;
  if (sourcePath) item.path = sourcePath;
  if (url) item.url = url;
  if (capturedAt) item.captured_at = capturedAt;
  if (notes) item.notes = notes;

  if (!item.value && !item.path && !item.url) {
    throw new Error(`source input "${item.label}" needs value, path, or url`);
  }
  return item;
}

function normalizeTrendExample(record: Record<string, unknown>): TrendExampleReference {
  return {
    id: requiredText(record, 'id'),
    source_name: requiredText(record, 'source_name'),
    source_url: requiredText(record, 'source_url'),
    captured_at: requiredText(record, 'captured_at'),
    platform: requiredText(record, 'platform'),
    format: requiredText(record, 'format'),
    hook: requiredText(record, 'hook'),
    notes: requiredText(record, 'notes'),
  };
}

function normalizeProviderPolicy(record: Record<string, unknown>): ProviderPolicy {
  const policy: ProviderPolicy = {
    approved_providers: requiredTextArray(record, 'approved_providers')
      .map((provider) => oneOf(provider, CREATIVE_PROVIDER_NAMES, 'provider_policy.approved_providers')),
    allow_paid_generation: requiredBoolean(record, 'allow_paid_generation'),
    allow_browser_ui: requiredBoolean(record, 'allow_browser_ui'),
    allow_social_publishing: requiredBoolean(record, 'allow_social_publishing'),
    account_automation_allowed: false,
    credentials_policy: oneOf(requiredText(record, 'credentials_policy'), ['no_credentials_in_repo'] as const, 'credentials_policy'),
    notes: requiredTextArray(record, 'notes'),
  };

  if (record.account_automation_allowed !== false) {
    throw new Error('account_automation_allowed must be false.');
  }

  return policy;
}

function normalizeOutputRequirements(record: Record<string, unknown>): OutputRequirements {
  const dimensions = expectRecord(record.dimensions, 'output_requirements.dimensions');
  const slideCount = requiredPositiveInteger(record, 'slide_count');
  const slides = requiredRecordArray(record, 'slides').map(normalizeSlideRequirement);
  if (slides.length !== slideCount) {
    throw new Error(`output_requirements.slide_count is ${slideCount}, but ${slides.length} slide(s) were provided.`);
  }

  return {
    aspect_ratio: oneOf(requiredText(record, 'aspect_ratio'), ['9:16'] as const, 'output_requirements.aspect_ratio'),
    dimensions: {
      width: requiredPositiveInteger(dimensions, 'width'),
      height: requiredPositiveInteger(dimensions, 'height'),
    },
    slide_count: slideCount,
    required_outputs: requiredTextArray(record, 'required_outputs')
      .map((output) => oneOf(output, REQUIRED_OUTPUTS, 'output_requirements.required_outputs')),
    slides,
    caption: requiredText(record, 'caption'),
    hashtags: requiredTextArray(record, 'hashtags'),
    spoken_script: requiredText(record, 'spoken_script'),
    posting_notes: requiredTextArray(record, 'posting_notes'),
  };
}

function normalizeSlideRequirement(record: Record<string, unknown>): CreativeSlideRequirement {
  return {
    slide_number: requiredPositiveInteger(record, 'slide_number'),
    on_screen_text: requiredText(record, 'on_screen_text'),
    visual_direction: requiredText(record, 'visual_direction'),
  };
}

function normalizeApprovalStatus(record: Record<string, unknown>): ApprovalStatus {
  return {
    state: oneOf(requiredText(record, 'state'), APPROVAL_STATES, 'approval_status.state'),
    human_reviewer: nullableText(record.human_reviewer, 'approval_status.human_reviewer'),
    reviewed_at: nullableText(record.reviewed_at, 'approval_status.reviewed_at'),
    notes: requiredTextArray(record, 'notes'),
  };
}

function normalizeGeneratedAsset(record: Record<string, unknown>): GeneratedAsset {
  const asset: GeneratedAsset = {
    provider: oneOf(requiredText(record, 'provider'), CREATIVE_PROVIDER_NAMES, 'generated_assets.provider'),
    kind: oneOf(requiredText(record, 'kind'), ASSET_KINDS, 'generated_assets.kind'),
    path: requiredText(record, 'path'),
    approved_for_posting: record.approved_for_posting === true,
  };
  const sha256 = optionalText(record.sha256, 'generated_assets.sha256');
  const createdAt = optionalText(record.created_at, 'generated_assets.created_at');
  const notes = optionalText(record.notes, 'generated_assets.notes');
  if (sha256) asset.sha256 = sha256;
  if (createdAt) asset.created_at = createdAt;
  if (notes) asset.notes = notes;
  return asset;
}

function assertNoAccountAutomation(job: CreativeJobManifest): void {
  if (job.provider_policy.account_automation_allowed !== false) {
    throw new Error('Account automation is not allowed.');
  }
}

function requireEnvGate(env: GateEnv, flag: string, action: string): void {
  if ((env[flag] ?? '').toLowerCase() !== 'true') {
    throw new Error(`${action} is blocked unless ${flag}=true.`);
  }
}

function listGitCandidateFiles(rootDir: string): string[] {
  try {
    const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: rootDir,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return output.split('\0').filter(Boolean);
  } catch {
    return walkFiles(rootDir).map((file) => path.relative(rootDir, file));
  }
}

function walkFiles(rootDir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function isTextCandidate(filePath: string): boolean {
  const ext = path.extname(filePath) || path.basename(filePath);
  return TEXT_FILE_EXTENSIONS.has(ext);
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('process.env')
    || normalized.includes('example')
    || normalized.includes('placeholder')
    || normalized.includes('redacted')
    || normalized.includes('not-set')
    || normalized.includes('your_')
    || normalized.includes('todo');
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
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
  return value.map((item, index) => expectRecord(item, `${field}[${index}]`));
}

function requiredTextArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  const clean = value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${field}[${index}] must be a non-empty string.`);
    }
    return item.trim();
  });
  if (!clean.length) throw new Error(`${field} must not be empty.`);
  return clean;
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string or null.`);
  }
  return value.trim();
}

function requiredBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`);
  return value;
}

function requiredPositiveInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function oneOf<T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string when provided.`);
  }
  return value.trim();
}
