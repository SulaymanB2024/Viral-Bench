import {
  type CreativeJobManifest,
  validateCreativeJobManifest,
} from '../packages/creative/job_schema';

export const VALUATION_CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

export type ValuationConfidence = typeof VALUATION_CONFIDENCE_LEVELS[number];

export interface ValuationComp {
  label: string;
  source: string;
  price: number;
  condition: string;
  url?: string;
  observed_at?: string;
  notes?: string;
}

export interface ValuationCard {
  item_type: string;
  asking_price: number;
  estimated_range_low: number;
  estimated_range_high: number;
  confidence: ValuationConfidence;
  value_drivers: string[];
  risk_flags: string[];
  comps: ValuationComp[];
  verdict: string;
  disclaimer: string;
}

export function validateValuationCard(input: unknown): ValuationCard {
  const record = expectRecord(input, 'valuation card');
  const card: ValuationCard = {
    item_type: requiredText(record, 'item_type'),
    asking_price: requiredMoney(record, 'asking_price'),
    estimated_range_low: requiredMoney(record, 'estimated_range_low'),
    estimated_range_high: requiredMoney(record, 'estimated_range_high'),
    confidence: oneOf(requiredText(record, 'confidence'), VALUATION_CONFIDENCE_LEVELS, 'confidence'),
    value_drivers: requiredTextArray(record, 'value_drivers'),
    risk_flags: requiredTextArray(record, 'risk_flags', { allowEmpty: true }),
    comps: requiredRecordArray(record, 'comps').map(validateValuationComp),
    verdict: requiredText(record, 'verdict'),
    disclaimer: requiredText(record, 'disclaimer'),
  };

  if (card.estimated_range_low > card.estimated_range_high) {
    throw new Error('estimated_range_low must be less than or equal to estimated_range_high.');
  }
  if (card.confidence === 'high' && card.comps.length < 2) {
    throw new Error('high confidence valuation cards require at least two comps.');
  }
  if (!/estimate|range|not a guarantee|not guaranteed|not an appraisal/i.test(card.disclaimer)) {
    throw new Error('disclaimer must state that the valuation is an estimate/range and not a guarantee.');
  }
  if (/guaranteed|certified appraisal|official appraisal/i.test(card.verdict)) {
    throw new Error('valuation verdicts must not claim guaranteed or official appraisal status.');
  }
  if (hasExactValueClaim(card) && (card.confidence !== 'high' || card.comps.length < 3)) {
    throw new Error('Exact-value claims require high confidence and at least three supporting comps.');
  }

  return card;
}

export function generateValuationExplanationBlock(input: ValuationCard | unknown): string {
  const card = validateValuationCard(input);
  return [
    `## Valuation Card: ${card.item_type}`,
    '',
    `Asking price: ${formatMoney(card.asking_price)}`,
    `Estimated range: ${formatMoney(card.estimated_range_low)}-${formatMoney(card.estimated_range_high)}`,
    `Confidence: ${card.confidence}`,
    '',
    '### Value Drivers',
    ...card.value_drivers.map((driver) => `- ${driver}`),
    '',
    '### Risk Flags',
    ...(card.risk_flags.length ? card.risk_flags.map((flag) => `- ${flag}`) : ['- No risk flags recorded.']),
    '',
    '### Comparable Checks',
    ...card.comps.map((comp) => `- ${comp.label}: ${formatMoney(comp.price)} from ${comp.source} (${comp.condition})`),
    '',
    '### Verdict',
    card.verdict,
    '',
    '### Disclaimer',
    card.disclaimer,
    '',
  ].join('\n');
}

export function attachValuationCardToCreativeJob(
  jobInput: CreativeJobManifest | unknown,
  cardInput: ValuationCard | unknown,
): CreativeJobManifest {
  const job = validateCreativeJobManifest(jobInput);
  const card = validateValuationCard(cardInput);
  const summary = [
    `${card.item_type}: asking ${formatMoney(card.asking_price)}`,
    `estimated range ${formatMoney(card.estimated_range_low)}-${formatMoney(card.estimated_range_high)}`,
    `confidence ${card.confidence}`,
    `verdict: ${card.verdict}`,
  ].join('; ');

  return validateCreativeJobManifest({
    ...job,
    source_inputs: [
      ...job.source_inputs,
      {
        kind: 'item_pricing_note',
        label: 'Valuation card',
        value: summary,
        notes: 'Attached by valuation-card module. Keep final content range-based unless exact claim support is documented.',
      },
    ],
    qa_notes: [
      ...job.qa_notes,
      `Valuation card attached for ${card.item_type}; reviewer must verify comps and confidence before posting.`,
    ],
  });
}

function validateValuationComp(input: unknown): ValuationComp {
  const record = expectRecord(input, 'valuation comp');
  const comp: ValuationComp = {
    label: requiredText(record, 'label'),
    source: requiredText(record, 'source'),
    price: requiredMoney(record, 'price'),
    condition: requiredText(record, 'condition'),
  };
  const url = optionalUrl(record.url, 'url');
  const observedAt = optionalDateTime(record.observed_at, 'observed_at');
  const notes = optionalText(record.notes, 'notes');
  if (url) comp.url = url;
  if (observedAt) comp.observed_at = observedAt;
  if (notes) comp.notes = notes;
  return comp;
}

function hasExactValueClaim(card: ValuationCard): boolean {
  if (card.estimated_range_low === card.estimated_range_high) return true;
  const text = [
    card.verdict,
    ...card.value_drivers,
    ...card.risk_flags,
  ].join(' ');
  return /\bexact(?:ly)?\b|\bappraised at\b|\bworth\s+\$?\d[\d,]*(?:\.\d{2})?\b/i.test(text);
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
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

function requiredTextArray(
  record: Record<string, unknown>,
  field: string,
  options: { allowEmpty: boolean } = { allowEmpty: false },
): string[] {
  const value = record[field];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  const clean = value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${field}[${index}] must be a non-empty string.`);
    }
    return item.trim();
  });
  if (!options.allowEmpty && !clean.length) throw new Error(`${field} must not be empty.`);
  return clean;
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string when provided.`);
  }
  return value.trim();
}

function requiredMoney(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return Math.round(value * 100) / 100;
}

function optionalUrl(value: unknown, field: string): string | undefined {
  const text = optionalText(value, field);
  if (!text) return;
  try {
    new URL(text);
  } catch {
    throw new Error(`${field} must be a valid URL when provided.`);
  }
  return text;
}

function optionalDateTime(value: unknown, field: string): string | undefined {
  const text = optionalText(value, field);
  if (!text) return;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid date-time string when provided.`);
  }
  return text;
}

function oneOf<T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}
