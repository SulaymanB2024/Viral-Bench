import type {
  AgentEvidence,
  MarketingBrief,
  MarketingConcept,
  ResearchFinding,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

const CAUSAL_OVERCLAIM = /\b(proves? that|causes?|guarantees?|ensures?|will (?:increase|drive|deliver|produce)|always works?)\b/i;
const NEGATED_CAUSAL_OVERCLAIM = /\b(?:cannot|can't|can not|does not|doesn't|do not|don't|never|fails? to|rather than)\s+(?:(?:directly|necessarily|reasonably|reliably)\s+)?(?:proves? that|causes?|guarantees?|ensures?|always works?)\b/gi;
const NEGATED_GUARANTEE_NOUN = /\b(?:no|not|rather than|without|does not constitute|doesn't constitute|cannot constitute)\s+(?:a\s+)?guarantee\b/gi;
const CROSS_PLATFORM_RANK = /\b(highest|most|best|top)\b.{0,45}\bviews?\b.{0,45}\b(across|overall|all platforms?)\b/i;

export interface ValidatedResearchOutput {
  answer: string;
  findings: ResearchFinding[];
  limitations: string[];
  followups: string[];
}

export interface ValidatedMarketingOutput {
  summary: string;
  audience_tension: string;
  concepts: MarketingConcept[];
  experiment: MarketingBrief['experiment'];
  claim_risks: MarketingBrief['claim_risks'];
  limitations: string[];
}

export function validateResearchOutput(input: unknown, evidence: AgentEvidence[]): ValidatedResearchOutput {
  const value = record(input, 'research output');
  const answer = requiredText(value.answer, 'answer', 4_000);
  const findings = recordArray(value.findings, 'findings').map((finding, index) => ({
    claim: requiredText(finding.claim, `findings[${index}].claim`, 1_000),
    evidence_ids: evidenceIds(finding.evidence_ids, `findings[${index}].evidence_ids`, evidence),
  }));
  if (!findings.length || findings.length > 8) throw new Error('findings must contain 1 to 8 entries.');
  const result = {
    answer,
    findings,
    limitations: textArray(value.limitations, 'limitations', 8, 600),
    followups: textArray(value.followups, 'followups', 5, 300),
  };
  assertEvidenceSafe(result, evidence);
  return result;
}

export function validateMarketingOutput(input: unknown, evidence: AgentEvidence[]): ValidatedMarketingOutput {
  const value = record(input, 'marketing output');
  const concepts = recordArray(value.concepts, 'concepts').map((concept, index) => ({
    title: requiredText(concept.title, `concepts[${index}].title`, 160),
    hypothesis: requiredText(concept.hypothesis, `concepts[${index}].hypothesis`, 600),
    hook: requiredText(concept.hook, `concepts[${index}].hook`, 220),
    format: requiredText(concept.format, `concepts[${index}].format`, 160),
    script_beats: textArray(concept.script_beats, `concepts[${index}].script_beats`, 8, 500),
    cta: requiredText(concept.cta, `concepts[${index}].cta`, 300),
    evidence_ids: evidenceIds(concept.evidence_ids, `concepts[${index}].evidence_ids`, evidence),
  }));
  if (concepts.length !== 3) throw new Error('concepts must contain exactly three entries.');
  if (concepts.some((concept) => concept.script_beats.length < 3)) {
    throw new Error('Every concept must include at least three script beats.');
  }
  const experimentValue = record(value.experiment, 'experiment');
  const result: ValidatedMarketingOutput = {
    summary: requiredText(value.summary, 'summary', 2_000),
    audience_tension: requiredText(value.audience_tension, 'audience_tension', 1_000),
    concepts,
    experiment: {
      hypothesis: requiredText(experimentValue.hypothesis, 'experiment.hypothesis', 800),
      control: requiredText(experimentValue.control, 'experiment.control', 300),
      variants: textArray(experimentValue.variants, 'experiment.variants', 4, 300),
      primary_metrics: textArray(experimentValue.primary_metrics, 'experiment.primary_metrics', 6, 80),
      checkpoints: textArray(experimentValue.checkpoints, 'experiment.checkpoints', 6, 40),
    },
    claim_risks: recordArray(value.claim_risks, 'claim_risks').slice(0, 8).map((risk, index) => ({
      claim: requiredText(risk.claim, `claim_risks[${index}].claim`, 500),
      risk: requiredText(risk.risk, `claim_risks[${index}].risk`, 500),
      mitigation: requiredText(risk.mitigation, `claim_risks[${index}].mitigation`, 500),
    })),
    limitations: textArray(value.limitations, 'limitations', 10, 600),
  };
  assertEvidenceSafe(result, evidence);
  return result;
}

export function assertEvidenceSafe(output: unknown, evidence: AgentEvidence[]): void {
  const text = collectStrings(output).join(' ');
  const unnegatedText = text
    .replace(NEGATED_CAUSAL_OVERCLAIM, '')
    .replace(NEGATED_GUARANTEE_NOUN, '');
  if (CAUSAL_OVERCLAIM.test(unnegatedText)) {
    throw new Error('Output contains unsupported causal or guaranteed language.');
  }
  if (CROSS_PLATFORM_RANK.test(text)) throw new Error('Output contains a prohibited cross-platform raw-view ranking.');
  if (containsLongSourceCopy(text, evidence)) throw new Error('Output reproduces a long source phrase.');
}

function containsLongSourceCopy(output: string, evidence: AgentEvidence[]): boolean {
  const outputTokens = normalizedTokens(output);
  if (outputTokens.length < 12) return false;
  const phrases = new Set<string>();
  for (let index = 0; index <= outputTokens.length - 12; index += 1) {
    phrases.add(outputTokens.slice(index, index + 12).join(' '));
  }
  for (const item of evidence) {
    const sourceTokens = normalizedTokens(`${item.title} ${item.snippet}`);
    for (let index = 0; index <= sourceTokens.length - 12; index += 1) {
      if (phrases.has(sourceTokens.slice(index, index + 12).join(' '))) return true;
    }
  }
  return false;
}

function evidenceIds(value: unknown, label: string, evidence: AgentEvidence[]): string[] {
  const ids = textArray(value, label, 12, 200);
  if (!ids.length) throw new Error(`${label} must contain at least one evidence ID.`);
  const allowed = new Set(evidence.map((item) => item.evidence_id));
  if (ids.some((id) => !allowed.has(id))) throw new Error(`${label} references evidence outside the retrieval package.`);
  return [...new Set(ids)];
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as UnknownRecord;
}

function recordArray(value: unknown, label: string): UnknownRecord[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => record(item, `${label}[${index}]`));
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return compact;
}

function textArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > maxItems) throw new Error(`${label} exceeds ${maxItems} entries.`);
  return value.map((item, index) => requiredText(item, `${label}[${index}]`, maxLength));
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value as UnknownRecord).flatMap(collectStrings);
  return [];
}

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}
