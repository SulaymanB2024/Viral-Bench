import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  addHumanReviewStatus,
  browserCaptureToTrendExample,
  loadBrowserCapture,
  validateBrowserCapture,
} from '../src/browser-capture';

const SAMPLE_CAPTURE_PATH = path.join(
  process.cwd(),
  '.ops',
  'browser',
  'samples',
  'creative_center_bike_capture.json',
);

test('browser capture validates', () => {
  const capture = loadBrowserCapture(SAMPLE_CAPTURE_PATH);

  assert.equal(capture.capture_id, 'creative-center-bike-capture-001');
  assert.equal(capture.source_name, 'TikTok Creative Center');
  assert.equal(capture.platform, 'TikTok');
  assert.equal(capture.human_review_status, 'approved');
});

test('invalid browser capture fails', () => {
  assert.throws(
    () => validateBrowserCapture({
      capture_id: 'bad-capture',
      source_name: 'TikTok Creative Center',
      source_url: '',
      captured_at: '2026-07-06T18:00:00.000Z',
      niche: '',
      platform: 'TikTok',
      observed_format: '',
      visible_metrics: {},
      hook: '',
      caption_or_visible_text: '',
      visual_notes: '',
      why_it_may_work: '',
      remake_notes: '',
      evidence_notes: '',
      human_review_status: 'draft',
    }),
    /source_url/,
  );
});

test('valid browser capture converts into a trend example shape', () => {
  const capture = loadBrowserCapture(SAMPLE_CAPTURE_PATH);
  const trendExample = browserCaptureToTrendExample(capture);

  assert.equal(trendExample.id, capture.capture_id);
  assert.equal(trendExample.source_url, capture.source_url);
  assert.equal(trendExample.source_name, capture.source_name);
  assert.equal(trendExample.format, capture.observed_format);
  assert.equal(trendExample.caption, capture.caption_or_visible_text);
  assert.deepEqual(trendExample.observed_metrics, capture.visible_metrics);
  assert.ok(trendExample.visual_structure.includes(capture.visual_notes));
  assert.ok(trendExample.why_it_works.includes(capture.why_it_may_work));
  assert.equal(trendExample.remake_notes, capture.remake_notes);
});

test('capture ingestion requires human review status before adding to trend db', () => {
  const capture = loadBrowserCapture(SAMPLE_CAPTURE_PATH);
  const pendingCapture = addHumanReviewStatus(capture, 'pending_review');

  assert.throws(
    () => browserCaptureToTrendExample(pendingCapture),
    /human_review_status must be approved/,
  );
});

test('browser capture can be ingested after approval', () => {
  const { dbPath } = tmpDb();
  const capture = addHumanReviewStatus(loadBrowserCapture(SAMPLE_CAPTURE_PATH), 'approved');
  const trendExample = browserCaptureToTrendExample(capture);

  assert.equal(trendExample.id, 'creative-center-bike-capture-001');
  assert.doesNotThrow(() => validateBrowserCapture(capture));
});

function tmpDb(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-browser-capture-'));
  return { dir, dbPath: path.join(dir, 'trend_examples.sqlite') };
}
