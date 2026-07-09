import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

export const DEFAULT_TREND_DB_PATH = path.join(process.cwd(), 'trend_examples.sqlite');
const MINIMUM_GROUNDED_EXAMPLES = 3;

export interface TrendExampleInput {
  id: string;
  source_url: string;
  source_name: string;
  captured_at: string;
  niche: string;
  platform: string;
  format: string;
  hook: string;
  caption: string;
  observed_metrics: Record<string, unknown>;
  visual_structure: string[] | string;
  CTA: string;
  why_it_works: string[] | string;
  remake_notes: string;
}

export interface TrendExample extends Omit<TrendExampleInput, 'visual_structure' | 'why_it_works'> {
  visual_structure: string[];
  why_it_works: string[];
}

export interface TrendCitation {
  id: string;
  source_url: string;
  source_name: string;
  hook: string;
}

export interface TrendClaim {
  text: string;
  citations: TrendCitation[];
}

export interface TrendResearchAnswer {
  status: 'ok' | 'insufficient_examples';
  answer: string;
  claims: TrendClaim[];
  citations: TrendCitation[];
}

export interface SearchTrendExamplesParams {
  niche?: string;
  format?: string;
  platform?: string;
  query?: string;
  limit?: number;
}

export interface ResearchTrendsParams extends SearchTrendExamplesParams {
  question?: string;
  minimum_examples?: number;
}

export interface GenerateScanContentBriefParams {
  niche: string;
  item: string;
  format?: string;
  target_platform?: string;
  minimum_examples?: number;
}

export interface ScanContentBrief {
  status: 'ok';
  niche: string;
  item: string;
  target_platform: string;
  target_format: string;
  tiktok_hook: string;
  slides: Array<{
    slide_number: number;
    on_screen_text: string;
    visual_direction: string;
    citations: TrendCitation[];
  }>;
  spoken_script: string;
  caption: string;
  valuation_explanation_structure: string[];
  call_to_action: string;
  trend_basis: TrendClaim[];
  citations: TrendCitation[];
}

export interface InsufficientExamplesResult {
  status: 'insufficient_examples';
  answer: string;
  claims: [];
  citations: [];
}

export type GenerateScanContentBriefResult = ScanContentBrief | InsufficientExamplesResult;

interface TrendExampleRow {
  id: string;
  source_url: string;
  source_name: string;
  captured_at: string;
  niche: string;
  platform: string;
  format: string;
  hook: string;
  caption: string;
  observed_metrics: string;
  visual_structure: string;
  CTA: string;
  why_it_works: string;
  remake_notes: string;
}

export function initTrendExamplesDb(dbPath = DEFAULT_TREND_DB_PATH): void {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  sqliteExec(dbPath, `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS trend_examples (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        source_name TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        niche TEXT NOT NULL,
        platform TEXT NOT NULL,
        format TEXT NOT NULL,
        hook TEXT NOT NULL,
        caption TEXT NOT NULL,
        observed_metrics TEXT NOT NULL,
        visual_structure TEXT NOT NULL,
        CTA TEXT NOT NULL,
        why_it_works TEXT NOT NULL,
        remake_notes TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS trend_examples_fts USING fts5(
        id UNINDEXED,
        hook,
        caption,
        niche,
        visual_structure,
        remake_notes,
        tokenize = 'unicode61'
      );
    `);
}

export function addTrendExample(dbPath: string, input: TrendExampleInput): string {
  initTrendExamplesDb(dbPath);
  const example = normalizeTrendExample(input);
  sqliteExec(dbPath, `
      BEGIN;

      INSERT INTO trend_examples (
        id, source_url, source_name, captured_at, niche, platform, format, hook,
        caption, observed_metrics, visual_structure, CTA, why_it_works, remake_notes,
        updated_at
      )
      VALUES (
        ${sqlString(example.id)},
        ${sqlString(example.source_url)},
        ${sqlString(example.source_name)},
        ${sqlString(example.captured_at)},
        ${sqlString(example.niche)},
        ${sqlString(example.platform)},
        ${sqlString(example.format)},
        ${sqlString(example.hook)},
        ${sqlString(example.caption)},
        ${sqlString(JSON.stringify(example.observed_metrics))},
        ${sqlString(JSON.stringify(example.visual_structure))},
        ${sqlString(example.CTA)},
        ${sqlString(JSON.stringify(example.why_it_works))},
        ${sqlString(example.remake_notes)},
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        source_name = excluded.source_name,
        captured_at = excluded.captured_at,
        niche = excluded.niche,
        platform = excluded.platform,
        format = excluded.format,
        hook = excluded.hook,
        caption = excluded.caption,
        observed_metrics = excluded.observed_metrics,
        visual_structure = excluded.visual_structure,
        CTA = excluded.CTA,
        why_it_works = excluded.why_it_works,
        remake_notes = excluded.remake_notes,
        updated_at = excluded.updated_at
      ;

      DELETE FROM trend_examples_fts WHERE id = ${sqlString(example.id)};

      INSERT INTO trend_examples_fts (id, hook, caption, niche, visual_structure, remake_notes)
      VALUES (
        ${sqlString(example.id)},
        ${sqlString(example.hook)},
        ${sqlString(example.caption)},
        ${sqlString(example.niche)},
        ${sqlString(example.visual_structure.join('\n'))},
        ${sqlString(example.remake_notes)}
      );

      COMMIT;
    `);

  return example.id;
}

export function searchTrendExamples(dbPath: string, params: SearchTrendExamplesParams = {}): TrendExample[] {
  initTrendExamplesDb(dbPath);
  const limit = clampLimit(params.limit);
  const where: string[] = [];
  const ftsQuery = buildFtsQuery(params.query);

  if (params.niche?.trim()) {
    where.push(`lower(e.niche) LIKE ${sqlString(`%${params.niche.trim().toLowerCase()}%`)}`);
  }
  if (params.format?.trim()) {
    where.push(`lower(e.format) = ${sqlString(params.format.trim().toLowerCase())}`);
  }
  if (params.platform?.trim()) {
    where.push(`lower(e.platform) = ${sqlString(params.platform.trim().toLowerCase())}`);
  }

  if (ftsQuery) {
    const sql = `
        SELECT e.*
        FROM trend_examples e
        JOIN trend_examples_fts ON trend_examples_fts.id = e.id
        WHERE trend_examples_fts MATCH ${sqlString(ftsQuery)}
        ${where.length ? `AND ${where.join(' AND ')}` : ''}
        ORDER BY bm25(trend_examples_fts), e.captured_at DESC, e.id ASC
        LIMIT ${limit}
      `;
    const rows = sqliteJson<TrendExampleRow>(dbPath, sql);
    return rows.map(rowToTrendExample);
  }

  const sql = `
      SELECT e.*
      FROM trend_examples e
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.captured_at DESC, e.id ASC
      LIMIT ${limit}
    `;
  const rows = sqliteJson<TrendExampleRow>(dbPath, sql);
  return rows.map(rowToTrendExample);
}

export function research_trends(dbPath: string, params: ResearchTrendsParams = {}): TrendResearchAnswer {
  const minimum = params.minimum_examples ?? MINIMUM_GROUNDED_EXAMPLES;
  const examples = searchTrendExamples(dbPath, { ...params, limit: params.limit ?? 12 });

  if (examples.length < minimum) {
    return insufficientExamples(params.niche, examples.length, minimum);
  }

  const citations = examples.slice(0, 6).map(toCitation);
  const claims: TrendClaim[] = [
    {
      text: `The saved examples in this niche use concrete scan/value hooks instead of broad trend language: ${examples.slice(0, 3).map((e) => `"${e.hook}"`).join('; ')}.`,
      citations: examples.slice(0, 3).map(toCitation),
    },
    {
      text: `The common visual pattern is item-first proof: show the object, reveal condition or comparable-price checks, then land on a worth range or buy/pass decision.`,
      citations: examplesWithField(examples, 'visual_structure').slice(0, 3).map(toCitation),
    },
    {
      text: `The repeatable CTA pattern asks viewers to comment, scan, or request a checklist after the value reveal.`,
      citations: examples.filter((e) => e.CTA.trim()).slice(0, 3).map(toCitation),
    },
  ].filter((claim) => claim.citations.length > 0);

  return {
    status: 'ok',
    answer: [
      `Grounded trend read for ${params.niche || 'all saved examples'}${params.format ? ` (${params.format})` : ''}:`,
      ...claims.map((claim) => `- ${claim.text} ${formatCitationRefs(claim.citations)}`),
    ].join('\n'),
    claims,
    citations,
  };
}

export function generate_scan_content_brief(
  dbPath: string,
  params: GenerateScanContentBriefParams,
): GenerateScanContentBriefResult {
  const minimum = params.minimum_examples ?? MINIMUM_GROUNDED_EXAMPLES;
  const examples = searchTrendExamples(dbPath, {
    niche: params.niche,
    platform: params.target_platform,
    limit: 12,
  });

  if (examples.length < minimum) {
    return insufficientExamples(params.niche, examples.length, minimum);
  }

  const basis = research_trends(dbPath, {
    niche: params.niche,
    platform: params.target_platform,
    minimum_examples: minimum,
  });
  if (basis.status !== 'ok') {
    return {
      status: 'insufficient_examples',
      answer: basis.answer,
      claims: [],
      citations: [],
    };
  }

  const coreExamples = examples.slice(0, Math.max(3, minimum));
  const citations = coreExamples.map(toCitation);
  const item = params.item.trim();
  const cta = mostUsefulCta(coreExamples);
  const targetPlatform = params.target_platform?.trim() || 'TikTok';
  const targetFormat = params.format?.trim() || 'slideshow';

  const slides: ScanContentBrief['slides'] = [
    {
      slide_number: 1,
      on_screen_text: `Scan this ${item} before you pay`,
      visual_direction: `Tight phone-camera shot of the ${item}, listing price visible, no polished studio look.`,
      citations: [citations[0]],
    },
    {
      slide_number: 2,
      on_screen_text: 'Check the model, age, and obvious damage first',
      visual_direction: 'Circle the brand/model mark and one visible condition issue.',
      citations: [citations[0], citations[1]],
    },
    {
      slide_number: 3,
      on_screen_text: 'Compare it to 3 local resale listings',
      visual_direction: 'Show three simple comparable price cards, highest to lowest.',
      citations: [citations[1]],
    },
    {
      slide_number: 4,
      on_screen_text: 'Subtract repairs before you call it a deal',
      visual_direction: 'Show a quick repair checklist with one red flag highlighted.',
      citations: [citations[1], citations[2]],
    },
    {
      slide_number: 5,
      on_screen_text: 'Worth range: fair buy, risky buy, or pass',
      visual_direction: 'Final value range with a clear buy/pass label and comment prompt.',
      citations: [citations[2]],
    },
  ];

  return {
    status: 'ok',
    niche: params.niche,
    item,
    target_platform: targetPlatform,
    target_format: targetFormat,
    tiktok_hook: `Scan this ${item} before you pay the asking price`,
    slides,
    spoken_script: [
      `Before you buy this ${item}, run it through a fast resale scan.`,
      'Start with the exact model and visible condition, then compare it against three current local listings instead of one random asking price.',
      'After that, subtract obvious repairs or missing parts. The final number should be a range, not a fake exact price: fair buy, risky buy, or pass.',
      `${cta}`,
    ].join(' '),
    caption: `Would you buy this ${item}? Comment "scan" and I will break down the next listing. #resale #studentdeals #valuation #usedgear`,
    valuation_explanation_structure: [
      'Identify exact item, model, age, and included accessories.',
      'Use three local comparable listings or sold examples as the baseline.',
      'Subtract visible repairs, missing parts, pickup hassle, and time-to-resell risk.',
      'Return a range with confidence level and a buy/pass decision.',
    ],
    call_to_action: cta,
    trend_basis: basis.claims,
    citations,
  };
}

export async function renderContentBrief(brief: ScanContentBrief, outDir: string): Promise<{
  slide_paths: string[];
  caption_path: string;
  posting_notes_path: string;
}> {
  if (brief.status !== 'ok') {
    throw new Error('Cannot render an insufficient-examples brief.');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const slidePaths: string[] = [];

  for (const slide of brief.slides) {
    const slidePath = path.join(outDir, `slide_${String(slide.slide_number).padStart(2, '0')}.png`);
    const svg = renderSlideSvg(brief, slide);
    await sharp(Buffer.from(svg)).png().toFile(slidePath);
    slidePaths.push(slidePath);
  }

  const captionPath = path.join(outDir, 'caption.txt');
  fs.writeFileSync(captionPath, brief.caption);

  const postingNotesPath = path.join(outDir, 'posting_notes.md');
  fs.writeFileSync(postingNotesPath, renderPostingNotes(brief));

  return {
    slide_paths: slidePaths,
    caption_path: captionPath,
    posting_notes_path: postingNotesPath,
  };
}

function sqliteExec(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

function sqliteJson<T>(dbPath: string, sql: string): T[] {
  const output = execFileSync('sqlite3', ['-json', dbPath], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
  return output ? JSON.parse(output) as T[] : [];
}

function sqlString(value: unknown): string {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function normalizeTrendExample(input: TrendExampleInput): TrendExample {
  const required: Array<keyof TrendExampleInput> = [
    'id',
    'source_url',
    'source_name',
    'captured_at',
    'niche',
    'platform',
    'format',
    'hook',
    'caption',
    'observed_metrics',
    'visual_structure',
    'CTA',
    'why_it_works',
    'remake_notes',
  ];

  for (const field of required) {
    if (input[field] === undefined || input[field] === null || String(input[field]).trim?.() === '') {
      throw new Error(`Trend example is missing required field: ${field}`);
    }
  }

  return {
    id: cleanText(input.id, 'id'),
    source_url: cleanText(input.source_url, 'source_url'),
    source_name: cleanText(input.source_name, 'source_name'),
    captured_at: cleanText(input.captured_at, 'captured_at'),
    niche: cleanText(input.niche, 'niche'),
    platform: cleanText(input.platform, 'platform'),
    format: cleanText(input.format, 'format'),
    hook: cleanText(input.hook, 'hook'),
    caption: String(input.caption ?? '').trim(),
    observed_metrics: input.observed_metrics && typeof input.observed_metrics === 'object' ? input.observed_metrics : {},
    visual_structure: normalizeStringArray(input.visual_structure, 'visual_structure'),
    CTA: cleanText(input.CTA, 'CTA'),
    why_it_works: normalizeStringArray(input.why_it_works, 'why_it_works'),
    remake_notes: cleanText(input.remake_notes, 'remake_notes'),
  };
}

function cleanText(value: unknown, field: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`Trend example is missing required field: ${field}`);
  return text;
}

function normalizeStringArray(value: string[] | string, field: string): string[] {
  const items = Array.isArray(value)
    ? value
    : String(value)
      .split(/\r?\n|;/)
      .map((item) => item.trim());
  const clean = items.map((item) => String(item).trim()).filter(Boolean);
  if (!clean.length) throw new Error(`Trend example is missing required field: ${field}`);
  return clean;
}

function rowToTrendExample(row: TrendExampleRow): TrendExample {
  return {
    id: row.id,
    source_url: row.source_url,
    source_name: row.source_name,
    captured_at: row.captured_at,
    niche: row.niche,
    platform: row.platform,
    format: row.format,
    hook: row.hook,
    caption: row.caption,
    observed_metrics: safeJson(row.observed_metrics, {}),
    visual_structure: safeJson(row.visual_structure, []),
    CTA: row.CTA,
    why_it_works: safeJson(row.why_it_works, []),
    remake_notes: row.remake_notes,
  };
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clampLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return 25;
  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function buildFtsQuery(query: string | undefined): string {
  const terms = (query ?? '').toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return terms.slice(0, 8).map((term) => `${term}*`).join(' AND ');
}

function examplesWithField(examples: TrendExample[], field: 'visual_structure' | 'why_it_works'): TrendExample[] {
  return examples.filter((example) => example[field].length > 0);
}

function toCitation(example: TrendExample): TrendCitation {
  return {
    id: example.id,
    source_url: example.source_url,
    source_name: example.source_name,
    hook: example.hook,
  };
}

function formatCitationRefs(citations: TrendCitation[]): string {
  return citations.map((citation) => `[${citation.id}]`).join(' ');
}

function insufficientExamples(niche: string | undefined, count: number, minimum: number): InsufficientExamplesResult {
  const subject = niche?.trim() ? `"${niche.trim()}"` : 'the requested niche';
  return {
    status: 'insufficient_examples',
    answer: `insufficient examples: found ${count} saved example(s) for ${subject}; need at least ${minimum} before making trend claims.`,
    claims: [],
    citations: [],
  };
}

function mostUsefulCta(examples: TrendExample[]): string {
  const cta = examples.find((example) => example.CTA.trim())?.CTA.trim();
  return cta || 'Comment "scan" for the valuation checklist';
}

function renderSlideSvg(brief: ScanContentBrief, slide: ScanContentBrief['slides'][number]): string {
  const accent = ['#18a999', '#f15bb5', '#fee440', '#00bbf9', '#9b5de5'][(slide.slide_number - 1) % 5];
  const citationText = `Sources: ${slide.citations.map((citation) => citation.id).join(', ')}`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#111317"/>
  <rect x="58" y="70" width="964" height="1780" rx="0" fill="#f8f5ef"/>
  <rect x="58" y="70" width="964" height="20" fill="${accent}"/>
  <text x="96" y="170" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#111317">${escapeXml(brief.item.toUpperCase())}</text>
  <text x="96" y="280" font-family="Arial, Helvetica, sans-serif" font-size="74" font-weight="800" fill="#111317">${escapeXml(wrapLine(slide.on_screen_text, 23)[0] ?? '')}</text>
  <text x="96" y="368" font-family="Arial, Helvetica, sans-serif" font-size="74" font-weight="800" fill="#111317">${escapeXml(wrapLine(slide.on_screen_text, 23)[1] ?? '')}</text>
  <text x="96" y="456" font-family="Arial, Helvetica, sans-serif" font-size="74" font-weight="800" fill="#111317">${escapeXml(wrapLine(slide.on_screen_text, 23).slice(2).join(' '))}</text>
  <rect x="96" y="610" width="888" height="640" fill="#ffffff" stroke="#d2d2d2" stroke-width="4"/>
  <text x="132" y="700" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#111317">Visual direction</text>
  ${wrapLine(slide.visual_direction, 34).slice(0, 6).map((line, index) => (
    `<text x="132" y="${780 + index * 58}" font-family="Arial, Helvetica, sans-serif" font-size="42" fill="#22252b">${escapeXml(line)}</text>`
  )).join('\n  ')}
  <rect x="96" y="1360" width="888" height="230" fill="${accent}" opacity="0.22"/>
  <text x="132" y="1440" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#111317">Valuation post stub</text>
  <text x="132" y="1502" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#111317">Replace this panel with item photos or listing screenshots.</text>
  <text x="96" y="1745" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#40454f">${escapeXml(citationText)}</text>
  <text x="900" y="1745" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#111317">${slide.slide_number}/5</text>
</svg>`;
}

function renderPostingNotes(brief: ScanContentBrief): string {
  return [
    `# Posting Notes: ${brief.item}`,
    '',
    `Platform: ${brief.target_platform}`,
    `Format: ${brief.target_format}`,
    '',
    '## Hook',
    brief.tiktok_hook,
    '',
    '## Spoken Script',
    brief.spoken_script,
    '',
    '## Valuation Structure',
    ...brief.valuation_explanation_structure.map((line) => `- ${line}`),
    '',
    '## Trend Basis',
    ...brief.trend_basis.map((claim) => `- ${claim.text} ${formatCitationRefs(claim.citations)}`),
    '',
    '## Citations',
    ...brief.citations.map((citation) => `- [${citation.id}] ${citation.source_name}: ${citation.source_url}`),
    '',
  ].join('\n');
}

function wrapLine(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
