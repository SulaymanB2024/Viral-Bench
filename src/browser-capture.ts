import * as fs from 'node:fs';

import {
  addTrendExample,
  type TrendExampleInput,
} from './trend-research';

export const HUMAN_REVIEW_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
] as const;

export type HumanReviewStatus = typeof HUMAN_REVIEW_STATUSES[number];

export interface BrowserCapture {
  capture_id: string;
  source_name: string;
  source_url: string;
  captured_at: string;
  niche: string;
  platform: string;
  observed_format: string;
  visible_metrics: Record<string, string | number | boolean | null>;
  hook: string;
  caption_or_visible_text: string;
  visual_notes: string;
  why_it_may_work: string;
  remake_notes: string;
  evidence_notes: string;
  human_review_status: HumanReviewStatus;
}

export function loadBrowserCapture(filePath: string): BrowserCapture {
  return validateBrowserCapture(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function validateBrowserCapture(input: unknown): BrowserCapture {
  const record = expectRecord(input, 'browser capture');
  const capture: BrowserCapture = {
    capture_id: requiredText(record, 'capture_id'),
    source_name: requiredText(record, 'source_name'),
    source_url: requiredUrl(record, 'source_url'),
    captured_at: requiredDateTime(record, 'captured_at'),
    niche: requiredText(record, 'niche'),
    platform: requiredText(record, 'platform'),
    observed_format: requiredText(record, 'observed_format'),
    visible_metrics: normalizeMetrics(record.visible_metrics),
    hook: requiredText(record, 'hook'),
    caption_or_visible_text: requiredText(record, 'caption_or_visible_text'),
    visual_notes: requiredText(record, 'visual_notes'),
    why_it_may_work: requiredText(record, 'why_it_may_work'),
    remake_notes: requiredText(record, 'remake_notes'),
    evidence_notes: requiredText(record, 'evidence_notes'),
    human_review_status: oneOf(requiredText(record, 'human_review_status'), HUMAN_REVIEW_STATUSES, 'human_review_status'),
  };

  if (!capture.source_url.startsWith('https://')) {
    throw new Error('source_url must use https.');
  }

  return capture;
}

export function addHumanReviewStatus(
  input: BrowserCapture | unknown,
  status: HumanReviewStatus,
): BrowserCapture {
  if (!HUMAN_REVIEW_STATUSES.includes(status)) {
    throw new Error(`human_review_status must be one of: ${HUMAN_REVIEW_STATUSES.join(', ')}.`);
  }
  const capture = validateBrowserCapture(input);
  return { ...capture, human_review_status: status };
}

export function browserCaptureToTrendExample(input: BrowserCapture | unknown): TrendExampleInput {
  const capture = validateBrowserCapture(input);
  if (capture.human_review_status !== 'approved') {
    throw new Error('human_review_status must be approved before browser capture ingestion.');
  }

  return {
    id: capture.capture_id,
    source_url: capture.source_url,
    source_name: capture.source_name,
    captured_at: capture.captured_at,
    niche: capture.niche,
    platform: capture.platform,
    format: capture.observed_format,
    hook: capture.hook,
    caption: capture.caption_or_visible_text,
    observed_metrics: capture.visible_metrics,
    visual_structure: splitNotes(capture.visual_notes),
    CTA: inferCta(capture.caption_or_visible_text),
    why_it_works: splitNotes(capture.why_it_may_work),
    remake_notes: capture.remake_notes,
  };
}

export function ingestBrowserCapture(dbPath: string, input: BrowserCapture | unknown): string {
  const trendExample = browserCaptureToTrendExample(input);
  return addTrendExample(dbPath, trendExample);
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredUrl(record: Record<string, unknown>, field: string): string {
  const value = requiredText(record, field);
  try {
    new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  return value;
}

function requiredDateTime(record: Record<string, unknown>, field: string): string {
  const value = requiredText(record, field);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid date-time string.`);
  }
  return value;
}

function normalizeMetrics(value: unknown): BrowserCapture['visible_metrics'] {
  const record = expectRecord(value, 'visible_metrics');
  const metrics: BrowserCapture['visible_metrics'] = {};
  for (const [key, metric] of Object.entries(record)) {
    if (!key.trim()) throw new Error('visible_metrics keys must be non-empty.');
    if (
      metric !== null
      && typeof metric !== 'string'
      && typeof metric !== 'number'
      && typeof metric !== 'boolean'
    ) {
      throw new Error(`visible_metrics.${key} must be a string, number, boolean, or null.`);
    }
    metrics[key.trim()] = metric;
  }
  return metrics;
}

function oneOf<T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}

function splitNotes(value: string): string[] {
  return value
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferCta(captionOrVisibleText: string): string {
  const commentMatch = captionOrVisibleText.match(/\bcomment\b[^.!\n]*/i);
  if (commentMatch) return commentMatch[0].trim();
  const followMatch = captionOrVisibleText.match(/\bfollow\b[^.!\n]*/i);
  if (followMatch) return followMatch[0].trim();
  return 'Human reviewer must add an explicit CTA before publishing.';
}
