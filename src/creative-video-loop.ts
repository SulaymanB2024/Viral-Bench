import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type CreativeEvaluation,
  type CreativeRevisionDirective,
  type VideoCreativeAnalysis,
} from './semantic-intelligence';

export const CREATIVE_LOOP_STOP_REASONS = [
  'candidate_limit',
  'two_non_improving_revisions',
  'provider_failure',
  'cost_exhausted',
  'qa_blocker',
] as const;

export type CreativeLoopStopReason = typeof CREATIVE_LOOP_STOP_REASONS[number];

export interface CreativeLoopManifest {
  loop_id: string;
  job_id: string;
  initial_prompt: string;
  semantic_bundle_path: string;
  target_duration_sec: number;
  max_candidates: number;
  max_extensions_per_candidate: number;
  min_improvement_points: number;
  max_cost_usd: number;
  currency: 'USD';
  approval_state: 'approved_for_draft_generation';
}

export interface GeneratedVideoCandidate {
  candidate_id: string;
  video_path: string;
  provider: 'veo_video' | 'fixture';
  model: string;
  operation_ids: string[];
  extension_count: number;
  cost_usd: number;
  generation_trace_path?: string;
  approved_for_posting: false;
}

export interface ReingestedCandidate {
  analysis: VideoCreativeAnalysis;
  semantic_evidence_ids: string[];
  analysis_path?: string;
}

export interface CreativeLoopCandidateResult {
  candidate: GeneratedVideoCandidate;
  analysis: VideoCreativeAnalysis;
  evaluation: CreativeEvaluation;
  revision_directive: CreativeRevisionDirective | null;
  improvement_points: number | null;
  met_minimum_improvement: boolean | null;
  artifacts: string[];
}

export interface CreativeLoopResult {
  loop_id: string;
  job_id: string;
  status: 'pending_human_review';
  stop_reason: CreativeLoopStopReason;
  candidates: CreativeLoopCandidateResult[];
  best_candidate_id: string | null;
  best_predicted_coas: number | null;
  total_cost_usd: number;
  max_cost_usd: number;
  generated_at: string;
  external_posting_actions: 0;
  approval_required: true;
  output_path: string;
}

export interface CreativeLoopAdapters {
  generateCandidate(input: {
    manifest: CreativeLoopManifest;
    candidate_id: string;
    prompt: string;
    revision: CreativeRevisionDirective | null;
    remaining_cost_usd: number;
  }): Promise<GeneratedVideoCandidate>;
  reingestCandidate(input: {
    manifest: CreativeLoopManifest;
    candidate: GeneratedVideoCandidate;
  }): Promise<ReingestedCandidate>;
  evaluateCandidate(input: {
    manifest: CreativeLoopManifest;
    candidate: GeneratedVideoCandidate;
    analysis: VideoCreativeAnalysis;
    semantic_evidence_ids: string[];
  }): Promise<CreativeEvaluation>;
  reviseCandidate(input: {
    manifest: CreativeLoopManifest;
    candidate: GeneratedVideoCandidate;
    analysis: VideoCreativeAnalysis;
    evaluation: CreativeEvaluation;
    prior_candidates: CreativeLoopCandidateResult[];
  }): Promise<CreativeRevisionDirective>;
}

export function validateCreativeLoopManifest(input: unknown): CreativeLoopManifest {
  const record = expectRecord(input, 'creative loop manifest');
  const manifest: CreativeLoopManifest = {
    loop_id: requiredText(record, 'loop_id'),
    job_id: requiredText(record, 'job_id'),
    initial_prompt: requiredText(record, 'initial_prompt'),
    semantic_bundle_path: requiredText(record, 'semantic_bundle_path'),
    target_duration_sec: requiredInteger(record, 'target_duration_sec'),
    max_candidates: requiredInteger(record, 'max_candidates'),
    max_extensions_per_candidate: requiredInteger(record, 'max_extensions_per_candidate'),
    min_improvement_points: requiredNumber(record, 'min_improvement_points'),
    max_cost_usd: requiredNumber(record, 'max_cost_usd'),
    currency: record.currency === 'USD' ? 'USD' : fail('currency must be USD.'),
    approval_state: record.approval_state === 'approved_for_draft_generation'
      ? 'approved_for_draft_generation'
      : fail('approval_state must be approved_for_draft_generation.'),
  };
  if (manifest.target_duration_sec < 16 || manifest.target_duration_sec > 24) throw new Error('target_duration_sec must be between 16 and 24.');
  if (manifest.max_candidates < 1 || manifest.max_candidates > 3) throw new Error('max_candidates must be between 1 and 3.');
  if (manifest.max_extensions_per_candidate < 0 || manifest.max_extensions_per_candidate > 2) throw new Error('max_extensions_per_candidate must be between 0 and 2.');
  if (manifest.min_improvement_points < 2) throw new Error('min_improvement_points must be at least 2.');
  if (manifest.max_cost_usd <= 0) throw new Error('max_cost_usd must be positive.');
  return manifest;
}

export function validateCreativeEvaluation(input: unknown): CreativeEvaluation {
  const record = expectRecord(input, 'CreativeEvaluation');
  if (record.observed_coas !== null) throw new Error('Generated candidate evaluation must not present predicted COAS as observed performance.');
  if (record.status !== 'draft_pending_human_review') throw new Error('CreativeEvaluation.status must be draft_pending_human_review.');
  const score = requiredNumber(record, 'predicted_coas');
  const confidence = requiredNumber(record, 'confidence');
  const rubric = requiredNumber(record, 'rubric_alignment');
  if (score < 0 || score > 100 || rubric < 0 || rubric > 100 || confidence < 0 || confidence > 1) {
    throw new Error('CreativeEvaluation scores must use 0-100 and confidence must use 0-1.');
  }
  if (!Array.isArray(record.qa_blockers) || !Array.isArray(record.evidence_ids)) {
    throw new Error('CreativeEvaluation qa_blockers and evidence_ids must be arrays.');
  }
  return input as CreativeEvaluation;
}

export function validateCreativeRevisionDirective(input: unknown): CreativeRevisionDirective {
  const record = expectRecord(input, 'CreativeRevisionDirective');
  requiredText(record, 'directive_id');
  requiredText(record, 'candidate_id');
  requiredText(record, 'created_at');
  requiredText(record, 'objective');
  const target = requiredNumber(record, 'target_predicted_coas_improvement');
  if (target < 2) throw new Error('CreativeRevisionDirective must target at least a two-point predicted COAS improvement.');
  if (!Array.isArray(record.preserve) || !record.preserve.every(nonEmptyText)) throw new Error('CreativeRevisionDirective.preserve must be a string array.');
  if (!Array.isArray(record.change) || !record.change.length) throw new Error('CreativeRevisionDirective.change must not be empty.');
  const allowedFields = new Set(['hook', 'beat', 'proof', 'on_screen_text', 'speech', 'audio', 'pacing', 'cta', 'claim', 'style']);
  for (const [index, value] of record.change.entries()) {
    const change = expectRecord(value, `change[${index}]`);
    if (!allowedFields.has(requiredText(change, 'field'))) throw new Error(`change[${index}].field is unsupported.`);
    requiredText(change, 'instruction');
    if (!Array.isArray(change.evidence_ids) || !change.evidence_ids.every(nonEmptyText)) throw new Error(`change[${index}].evidence_ids must be a string array.`);
  }
  const constraints = expectRecord(record.constraints, 'constraints');
  const duration = requiredNumber(constraints, 'target_duration_sec');
  if (duration < 16 || duration > 24 || constraints.aspect_ratio !== '9:16' || constraints.unapproved_draft_only !== true) {
    throw new Error('CreativeRevisionDirective constraints must preserve 16-24 seconds, 9:16, and unapproved_draft_only=true.');
  }
  if (!Array.isArray(constraints.prohibited_claims) || !constraints.prohibited_claims.every(nonEmptyText)) {
    throw new Error('constraints.prohibited_claims must be a string array.');
  }
  return input as CreativeRevisionDirective;
}

export async function runCreativeVideoLoop(
  manifestInput: CreativeLoopManifest | unknown,
  adapters: CreativeLoopAdapters,
  options: { outputDir: string; now?: () => Date },
): Promise<CreativeLoopResult> {
  const manifest = validateCreativeLoopManifest(manifestInput);
  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const finalPath = path.join(outputDir, 'creative-loop-result.json');
  if (fs.existsSync(finalPath)) throw new Error(`Refusing to overwrite existing creative loop result: ${finalPath}`);
  const candidates: CreativeLoopCandidateResult[] = [];
  let prompt = manifest.initial_prompt;
  let pendingRevision: CreativeRevisionDirective | null = null;
  let totalCost = 0;
  let nonImprovingRevisions = 0;
  let stopReason: CreativeLoopStopReason = 'candidate_limit';

  for (let index = 0; index < manifest.max_candidates; index += 1) {
    const candidateId = `${manifest.loop_id}:candidate:${index + 1}`;
    if (totalCost >= manifest.max_cost_usd) {
      stopReason = 'cost_exhausted';
      break;
    }
    let candidate: GeneratedVideoCandidate;
    try {
      candidate = await adapters.generateCandidate({
        manifest,
        candidate_id: candidateId,
        prompt,
        revision: pendingRevision,
        remaining_cost_usd: manifest.max_cost_usd - totalCost,
      });
    } catch {
      stopReason = 'provider_failure';
      break;
    }
    validateGeneratedCandidate(candidate, candidateId, manifest);
    if (candidate.cost_usd > manifest.max_cost_usd - totalCost) {
      stopReason = 'cost_exhausted';
      break;
    }
    totalCost += candidate.cost_usd;

    let reingested: ReingestedCandidate;
    let evaluation: CreativeEvaluation;
    try {
      reingested = await adapters.reingestCandidate({ manifest, candidate });
      evaluation = validateCreativeEvaluation(await adapters.evaluateCandidate({
        manifest,
        candidate,
        analysis: reingested.analysis,
        semantic_evidence_ids: reingested.semantic_evidence_ids,
      }));
    } catch {
      stopReason = 'provider_failure';
      break;
    }
    const priorScore = candidates.at(-1)?.evaluation.predicted_coas ?? null;
    const improvement = priorScore === null ? null : evaluation.predicted_coas - priorScore;
    const metMinimum = improvement === null ? null : improvement >= manifest.min_improvement_points;
    if (metMinimum === false) nonImprovingRevisions += 1;
    else if (metMinimum === true) nonImprovingRevisions = 0;

    const candidateDir = path.join(outputDir, `candidate-${index + 1}`);
    fs.mkdirSync(candidateDir, { recursive: true });
    const analysisPath = writeExclusiveJson(path.join(candidateDir, 'pegasus-analysis.json'), reingested.analysis);
    const evaluationPath = writeExclusiveJson(path.join(candidateDir, 'creative-evaluation.json'), evaluation);
    const artifacts = [candidate.video_path, analysisPath, evaluationPath, ...(candidate.generation_trace_path ? [candidate.generation_trace_path] : [])];
    const candidateResult: CreativeLoopCandidateResult = {
      candidate,
      analysis: reingested.analysis,
      evaluation,
      revision_directive: null,
      improvement_points: improvement,
      met_minimum_improvement: metMinimum,
      artifacts,
    };
    candidates.push(candidateResult);

    if (evaluation.qa_blockers.length) {
      stopReason = 'qa_blocker';
      break;
    }
    if (nonImprovingRevisions >= 2) {
      stopReason = 'two_non_improving_revisions';
      break;
    }
    if (index === manifest.max_candidates - 1) {
      stopReason = 'candidate_limit';
      break;
    }
    try {
      pendingRevision = validateCreativeRevisionDirective(await adapters.reviseCandidate({
        manifest,
        candidate,
        analysis: reingested.analysis,
        evaluation,
        prior_candidates: candidates,
      }));
    } catch {
      stopReason = 'provider_failure';
      break;
    }
    const revisionPath = writeExclusiveJson(path.join(candidateDir, 'creative-revision-directive.json'), pendingRevision);
    candidateResult.revision_directive = pendingRevision;
    candidateResult.artifacts.push(revisionPath);
    prompt = renderRevisedPrompt(manifest.initial_prompt, pendingRevision);
  }

  const best = [...candidates].sort((left, right) => right.evaluation.predicted_coas - left.evaluation.predicted_coas)[0];
  const result: CreativeLoopResult = {
    loop_id: manifest.loop_id,
    job_id: manifest.job_id,
    status: 'pending_human_review',
    stop_reason: stopReason,
    candidates,
    best_candidate_id: best?.candidate.candidate_id ?? null,
    best_predicted_coas: best?.evaluation.predicted_coas ?? null,
    total_cost_usd: totalCost,
    max_cost_usd: manifest.max_cost_usd,
    generated_at: (options.now ?? (() => new Date()))().toISOString(),
    external_posting_actions: 0,
    approval_required: true,
    output_path: finalPath,
  };
  writeExclusiveJson(finalPath, result);
  return result;
}

export function runCodexExecRevision(
  context: {
    manifest: CreativeLoopManifest;
    candidate: GeneratedVideoCandidate;
    analysis: VideoCreativeAnalysis;
    evaluation: CreativeEvaluation;
    prior_candidates: CreativeLoopCandidateResult[];
  },
  options: {
    rootDir?: string;
    outputDir: string;
    env?: Record<string, string | undefined>;
    codexBinary?: string;
    schemaPath?: string;
  },
): CreativeRevisionDirective {
  const env = options.env ?? process.env;
  if ((env.ALLOW_CODEX_CREATIVE_REVISION ?? '').toLowerCase() !== 'true') {
    throw new Error('Codex creative revision is blocked unless ALLOW_CODEX_CREATIVE_REVISION=true.');
  }
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const schemaPath = path.resolve(options.schemaPath ?? path.join(rootDir, 'schemas', 'creative-revision-directive.schema.json'));
  if (!fs.existsSync(schemaPath)) throw new Error(`Creative revision schema does not exist: ${schemaPath}`);
  const outputPath = path.join(outputDir, `codex-revision-${safeName(context.candidate.candidate_id)}.json`);
  if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite existing Codex revision: ${outputPath}`);
  const prompt = [
    'Act as the repo-aware creative analyst for Viral-Bench.',
    'Use only the supplied semantic evidence, Pegasus analysis, evaluation, and repository context; do not perform online search.',
    'Return a CreativeRevisionDirective that targets at least a two-point predicted COAS improvement.',
    'Keep claims evidence-grounded, preserve the 9:16 duration constraint, and keep the result an unapproved draft.',
    'Do not edit files or publish anything.',
  ].join(' ');
  execFileSync(options.codexBinary ?? 'codex', [
    'exec', '--ephemeral', '--sandbox', 'read-only',
    '--output-schema', schemaPath,
    '--output-last-message', outputPath,
    prompt,
  ], {
    cwd: rootDir,
    env,
    input: `${JSON.stringify(context)}\n`,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return validateCreativeRevisionDirective(JSON.parse(fs.readFileSync(outputPath, 'utf8')));
}

export function createFixtureRevisionDirective(input: {
  candidateId: string;
  targetDurationSec: number;
  evidenceIds: string[];
  index: number;
}): CreativeRevisionDirective {
  return {
    directive_id: `${input.candidateId}:revision:${input.index}`,
    candidate_id: input.candidateId,
    created_at: '2026-01-01T00:00:00.000Z',
    objective: 'Make the proof appear earlier and answer skeptical viewer objections without adding unsupported claims.',
    preserve: ['Evidence-grounded product identity', 'Native-audio continuity', 'Human-review boundary'],
    change: [{
      field: 'hook',
      instruction: 'Open with the visible transformation result, then immediately show the source evidence that supports it.',
      evidence_ids: input.evidenceIds,
    }, {
      field: 'cta',
      instruction: 'Invite a specific skeptical question instead of implying guaranteed performance.',
      evidence_ids: input.evidenceIds,
    }],
    target_predicted_coas_improvement: 2,
    constraints: {
      target_duration_sec: input.targetDurationSec,
      aspect_ratio: '9:16',
      unapproved_draft_only: true,
      prohibited_claims: ['Guaranteed outcomes', 'Fabricated customer proof', 'Unobserved product capabilities'],
    },
  };
}

function validateGeneratedCandidate(candidate: GeneratedVideoCandidate, expectedId: string, manifest: CreativeLoopManifest): void {
  if (candidate.candidate_id !== expectedId) throw new Error('Generator returned an unexpected candidate_id.');
  if (candidate.approved_for_posting !== false) throw new Error('Every generated candidate must remain unapproved for posting.');
  if (!fs.existsSync(candidate.video_path)) throw new Error(`Generated video does not exist: ${candidate.video_path}`);
  if (!Number.isFinite(candidate.cost_usd) || candidate.cost_usd < 0) throw new Error('Generated candidate cost must be non-negative.');
  if (!Number.isInteger(candidate.extension_count) || candidate.extension_count < 0 || candidate.extension_count > manifest.max_extensions_per_candidate) {
    throw new Error('Generated candidate exceeds the extension limit.');
  }
}

function renderRevisedPrompt(initialPrompt: string, revision: CreativeRevisionDirective): string {
  return [
    initialPrompt,
    '',
    `Revision objective: ${revision.objective}`,
    'Preserve:',
    ...revision.preserve.map((item) => `- ${item}`),
    'Change:',
    ...revision.change.map((item) => `- ${item.field}: ${item.instruction} [evidence: ${item.evidence_ids.join(', ')}]`),
    `Target predicted COAS improvement: ${revision.target_predicted_coas_improvement} points.`,
    'This is an unapproved draft. Do not include prohibited or unsupported claims.',
  ].join('\n');
}

function writeExclusiveJson(target: string, value: unknown): string {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  return target;
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function requiredNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number.`);
  return value;
}

function requiredInteger(record: Record<string, unknown>, field: string): number {
  const value = requiredNumber(record, field);
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer.`);
  return value;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function fail(message: string): never {
  throw new Error(message);
}

function safeName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}
