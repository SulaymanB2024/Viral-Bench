import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  addTrendExample,
  generate_scan_content_brief,
  initTrendExamplesDb,
  renderContentBrief,
  research_trends,
  searchTrendExamples,
  type TrendExampleInput,
} from '../src/trend-research';

function tmpDb(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-trends-'));
  return { dir, dbPath: path.join(dir, 'trend_examples.sqlite') };
}

function example(overrides: Partial<TrendExampleInput> = {}): TrendExampleInput {
  const n = overrides.id ?? `creative-center-${Math.random().toString(36).slice(2)}`;
  return {
    id: n,
    source_url: `https://ads.tiktok.com/business/creativecenter/inspiration/example/${n}`,
    source_name: 'TikTok Creative Center',
    captured_at: '2026-07-06T15:00:00.000Z',
    niche: 'AI-assisted resale valuation: used bikes and student resale',
    platform: 'TikTok',
    format: 'slideshow',
    hook: 'Scan this campus bike before you pay $220',
    caption: 'Quick resale check for student bikes. Comment scan for the checklist.',
    observed_metrics: { likes: 14200, comments: 340, saves: 980 },
    visual_structure: [
      'Close crop of the item with price tag visible',
      'Three visible condition checks',
      'Final worth range and buy/pass decision',
    ],
    CTA: 'Comment scan for a valuation checklist',
    why_it_works: [
      'Opens with a concrete item and price',
      'Makes the viewer compare their own deal',
    ],
    remake_notes: 'Remake for scooters, textbooks, mini fridges, and dorm furniture with local resale prices.',
    ...overrides,
  };
}

test('adds a manually collected Creative Center trend example', () => {
  const { dbPath } = tmpDb();
  initTrendExamplesDb(dbPath);

  const id = addTrendExample(dbPath, example({ id: 'manual-bike-001' }));

  assert.equal(id, 'manual-bike-001');
  const results = searchTrendExamples(dbPath, { niche: 'used bikes', format: 'slideshow' });
  assert.equal(results.length, 1);
  assert.equal(results[0].source_name, 'TikTok Creative Center');
  assert.equal(results[0].hook, 'Scan this campus bike before you pay $220');
});

test('searches examples by niche, format, and FTS fields', () => {
  const { dbPath } = tmpDb();
  initTrendExamplesDb(dbPath);
  addTrendExample(dbPath, example({ id: 'bike-001', hook: 'Scan this bike before you overpay' }));
  addTrendExample(dbPath, example({
    id: 'mini-fridge-001',
    niche: 'AI-assisted resale valuation: student resale items',
    format: 'video',
    hook: 'Is this dorm mini fridge worth $45?',
    remake_notes: 'Use for move-out day appliance deals.',
  }));

  const results = searchTrendExamples(dbPath, {
    niche: 'bike',
    format: 'slideshow',
    query: 'overpay',
  });

  assert.deepEqual(results.map((r) => r.id), ['bike-001']);
});

test('research_trends returns insufficient examples instead of unsupported claims', () => {
  const { dbPath } = tmpDb();
  initTrendExamplesDb(dbPath);
  addTrendExample(dbPath, example({ id: 'bike-001' }));

  const answer = research_trends(dbPath, {
    niche: 'used scooters',
    format: 'slideshow',
    question: 'What hooks are working for scan/value posts?',
  });

  assert.equal(answer.status, 'insufficient_examples');
  assert.match(answer.answer, /insufficient examples/i);
  assert.deepEqual(answer.citations, []);
});

test('research_trends cites stored examples for every trend claim', () => {
  const { dbPath } = tmpDb();
  initTrendExamplesDb(dbPath);
  addTrendExample(dbPath, example({ id: 'bike-001', hook: 'Scan this bike before you overpay' }));
  addTrendExample(dbPath, example({ id: 'bike-002', hook: 'This $90 scooter is hiding a $180 repair' }));
  addTrendExample(dbPath, example({ id: 'bike-003', hook: 'I checked three campus resale listings in 30 seconds' }));

  const answer = research_trends(dbPath, {
    niche: 'bike',
    format: 'slideshow',
    question: 'What hooks are working for scan/value posts?',
  });

  assert.equal(answer.status, 'ok');
  assert.ok(answer.claims.length >= 3);
  for (const claim of answer.claims) {
    assert.ok(claim.citations.length > 0, `missing citations for claim: ${claim.text}`);
  }
  assert.ok(answer.citations.some((citation) => citation.id === 'bike-001'));
});

test('generates a scan/value content brief from at least three stored examples and renders local stub files', async () => {
  const { dbPath, dir } = tmpDb();
  initTrendExamplesDb(dbPath);
  addTrendExample(dbPath, example({ id: 'bike-001', hook: 'Scan this bike before you overpay' }));
  addTrendExample(dbPath, example({ id: 'bike-002', hook: 'This $90 scooter is hiding a $180 repair', format: 'video' }));
  addTrendExample(dbPath, example({ id: 'bike-003', hook: 'I checked three campus resale listings in 30 seconds' }));

  const brief = generate_scan_content_brief(dbPath, {
    niche: 'bike',
    item: 'used commuter bike',
    format: 'slideshow',
    target_platform: 'TikTok',
  });

  assert.equal(brief.status, 'ok');
  assert.match(brief.tiktok_hook, /used commuter bike/i);
  assert.equal(brief.slides.length, 5);
  assert.ok(brief.spoken_script.length > 100);
  assert.ok(brief.valuation_explanation_structure.length >= 3);
  assert.ok(brief.trend_basis.every((claim) => claim.citations.length > 0));

  const outDir = path.join(dir, 'rendered');
  const output = await renderContentBrief(brief, outDir);

  assert.equal(output.slide_paths.length, 5);
  for (const slidePath of output.slide_paths) {
    assert.equal(path.extname(slidePath), '.png');
    assert.ok(fs.existsSync(slidePath), `${slidePath} was not written`);
    assert.ok(fs.statSync(slidePath).size > 0, `${slidePath} is empty`);
  }
  assert.equal(fs.readFileSync(path.join(outDir, 'caption.txt'), 'utf8'), brief.caption);
  assert.match(fs.readFileSync(path.join(outDir, 'posting_notes.md'), 'utf8'), /Citations/);
});
