import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { sanitizePublicText } from '../lib/corpus.js';

type UnknownRecord = Record<string, unknown>;

const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(siteDirectory, 'public');
const dataDirectory = path.join(siteDirectory, 'data');
const STATIC_FILES = [
  'index.html',
  'benchmarks.html',
  'ask.html',
  'work.html',
  'analysis.html',
  'dashboard.html',
  'queue.html',
  'operator.html',
  'ads.html',
  'styles.css',
  'agent.css',
  'ads.css',
  'site-navigation.js',
  'ask.js',
  'operator.js',
  'work.js',
  'ads.js',
  'ads-data.js',
  'twelvelabs-dashboard-data.js',
] as const;

export interface ReleasePrivacyReport {
  schema_version: 'viralbench_release_privacy_scan_v1';
  generated_at: string;
  output_directory: 'public';
  files: number;
  bytes: number;
  release_hash: string;
  sanitized_library_items: number;
  findings: Array<{ file: string; rule: string }>;
  blocked_paths_absent: string[];
  passed: boolean;
}

export function buildPublicLibrary(input: unknown): unknown {
  const root = record(input, 'library');
  const items = array(root.items).map((raw, index) => {
    const item = record(raw, `library.items[${index}]`);
    const performance = recordOrEmpty(item.performance);
    const observations = array(item.observations).map((value) => {
      const observation = recordOrEmpty(value);
      return {
        captured_at: isoDate(observation.captured_at),
        views: nullableNumber(observation.views),
        likes: nullableNumber(observation.likes),
        comments: nullableNumber(observation.comments),
        shares: nullableNumber(observation.shares),
        saves: nullableNumber(observation.saves),
        post_age_hours: nullableNumber(observation.post_age_hours),
        lifetime_views_per_hour: nullableNumber(observation.lifetime_views_per_hour),
        engagement_rate: nullableNumber(observation.engagement_rate),
      };
    });
    return {
      item_id: safeId(item.item_id),
      platform: safeId(item.platform),
      content_type: safeId(item.content_type),
      platform_post_id: safeId(item.platform_post_id),
      canonical_url: safeHttpsUrl(item.canonical_url),
      account_handle: sanitizePublicText(item.account_handle, 120),
      caption: sanitizePublicText(item.caption, 2_000),
      hashtags: textArray(item.hashtags).map((value) => sanitizePublicText(value, 80)).filter(Boolean),
      posted_at: isoDate(item.posted_at),
      first_seen_at: isoDate(item.first_seen_at),
      last_seen_at: isoDate(item.last_seen_at),
      observation_count: observations.length,
      observations,
      performance: {
        age_bucket: safeId(performance.age_bucket),
        latest_views: nullableNumber(performance.latest_views),
        latest_public_interactions: nullableNumber(performance.latest_public_interactions),
        latest_engagement_rate: nullableNumber(performance.latest_engagement_rate),
        lifetime_views_per_hour: nullableNumber(performance.lifetime_views_per_hour),
        observed_view_velocity_per_hour: nullableNumber(performance.observed_view_velocity_per_hour),
        observed_interaction_velocity_per_hour: nullableNumber(performance.observed_interaction_velocity_per_hour),
        observation_window_hours: nullableNumber(performance.observation_window_hours),
        comparison_metric: safeId(performance.comparison_metric),
        comparison_percentile: nullableNumber(performance.comparison_percentile),
        comparison_group_size: nullableNumber(performance.comparison_group_size) ?? 0,
        signal: safeId(performance.signal),
        confidence: safeId(performance.confidence),
        evidence_limitations: textArray(performance.evidence_limitations)
          .map((value) => sanitizePublicText(value, 500))
          .filter(Boolean),
      },
    };
  });
  return {
    schema_version: 2,
    generated_at: isoDate(root.generated_at),
    scope: {
      purpose: 'public_social_content_pattern_research',
      public_metadata_only: true,
      causal_claims_allowed: false,
      raw_cross_platform_ranking_allowed: false,
    },
    summary: {
      unique_items: items.length,
      by_platform: counts(items.map((item) => item.platform)),
      by_content_type: counts(items.map((item) => item.content_type)),
    },
    evidence_boundaries: textArray(root.evidence_boundaries)
      .map((value) => sanitizePublicText(value, 500))
      .filter(Boolean),
    items,
  };
}

export function buildPublicAnalysisHtml(source: string): string {
  const startMarker = '    const records = ';
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error('Analysis page records assignment was not found.');
  const arrayStart = start + startMarker.length;
  const arrayEnd = jsonArrayEnd(source, arrayStart);
  const records = array(JSON.parse(source.slice(arrayStart, arrayEnd)) as unknown)
    .map((value) => publicAnalysisRecord(record(value, 'analysis record')));
  return [
    source.slice(0, start),
    startMarker,
    JSON.stringify(records),
    source.slice(arrayEnd),
  ].join('');
}

export function scanPublicRelease(root: string): ReleasePrivacyReport {
  const files = walk(root);
  const findings: ReleasePrivacyReport['findings'] = [];
  let bytes = 0;
  for (const file of files) {
    const contents = fs.readFileSync(file);
    bytes += contents.byteLength;
    if (!isTextFile(file)) continue;
    const text = contents.toString('utf8');
    const relative = path.relative(root, file);
    if (path.extname(file).toLowerCase() === '.html') {
      for (const reference of localAssetReferences(text)) {
        const target = path.join(root, reference.replace(/^\.?\//, ''));
        if (!fs.existsSync(target)) {
          findings.push({ file: relative, rule: `missing_local_asset:${reference}` });
        }
      }
    }
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) {
      findings.push({ file: relative, rule: 'email_address' });
    }
    if (/(?:apify_api_|tlk_|sk-proj-|AIza)[A-Za-z0-9_-]{10,}/.test(text)) {
      findings.push({ file: relative, rule: 'credential_pattern' });
    }
    if (/\/Users\/|[A-Z]:\\Users\\/i.test(text)) {
      findings.push({ file: relative, rule: 'local_absolute_path' });
    }
    if (containsPhoneNumber(text)) {
      findings.push({ file: relative, rule: 'phone_number' });
    }
    if (/\b(?:proves?|guarantees?|causes?)\s+(?:that\s+)?(?:more|higher|better|performance|results|views|engagement|outcomes)\b/i.test(text)) {
      findings.push({ file: relative, rule: 'unsupported_causal_or_guarantee_claim' });
    }
    if (/operator_provisional/.test(text) && relative !== 'operator.js') {
      findings.push({ file: relative, rule: 'operator_provisional_evidence' });
    }
  }
  const blockedPaths = [
    'lib',
    'tests',
    'scripts',
    'data/agent-corpus.json',
    'package.json',
  ];
  const absent = blockedPaths.filter((relative) => !fs.existsSync(path.join(root, relative)));
  if (absent.length !== blockedPaths.length) {
    for (const relative of blockedPaths.filter((entry) => !absent.includes(entry))) {
      findings.push({ file: relative, rule: 'blocked_path_published' });
    }
  }
  return {
    schema_version: 'viralbench_release_privacy_scan_v1',
    generated_at: new Date().toISOString(),
    output_directory: 'public',
    files: files.length,
    bytes,
    release_hash: hashPublicRelease(root, files),
    sanitized_library_items: 0,
    findings,
    blocked_paths_absent: absent,
    passed: findings.length === 0 && absent.length === blockedPaths.length,
  };
}

function localAssetReferences(html: string): string[] {
  const references = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
    ...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi),
  ].map((match) => (match[1] ?? '').split(/[?#]/)[0] ?? '').filter((reference) => (
    reference
    && !/^(?:https?:|data:|mailto:|#)/i.test(reference)
    && !reference.includes('${')
  ));
  return [...new Set(references)].sort();
}

export function hashPublicRelease(root: string, files = walk(root)): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(root, file).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function build(): ReleasePrivacyReport {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const library = buildPublicLibrary(JSON.parse(fs.readFileSync(path.join(siteDirectory, 'library.json'), 'utf8')));
  const publicGeneratedAt = record(library, 'public library').generated_at;
  for (const relative of STATIC_FILES) {
    if (relative === 'analysis.html') {
      atomicWrite(
        path.join(outputDirectory, relative),
        buildPublicAnalysisHtml(fs.readFileSync(path.join(siteDirectory, relative), 'utf8')),
        0o644,
      );
      continue;
    }
    copyFile(relative, relative);
  }
  copyDirectory('media', 'media');
  atomicWrite(
    path.join(outputDirectory, 'data/video-ai-reports.js'),
    `window.__VIRALBENCH_VIDEO_AI_REPORTS__ = ${JSON.stringify({
      schema_version: 'viralbench_public_analysis_summaries_v2',
      generated_at: publicGeneratedAt,
      reports: {},
      evidence_boundary: 'Exact source speech, on-screen wording, provider identifiers, and reusable creator text are server-side only.',
    })};\n`,
    0o644,
  );

  atomicWrite(path.join(outputDirectory, 'library.json'), `${JSON.stringify(library, null, 2)}\n`, 0o644);
  const report = scanPublicRelease(outputDirectory);
  report.sanitized_library_items = array(record(library, 'public library').items).length;
  atomicWrite(path.join(dataDirectory, 'release-privacy-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) {
    throw new Error(`Public release privacy scan failed: ${report.findings.map((item) => `${item.file}:${item.rule}`).join(', ')}`);
  }
  return report;
}

function publicAnalysisRecord(input: UnknownRecord): UnknownRecord {
  const strategy = recordOrEmpty(recordOrEmpty(input.strategy).data);
  const opening = recordOrEmpty(strategy.opening);
  const arc = recordOrEmpty(strategy.content_arc);
  const cta = recordOrEmpty(strategy.cta);
  const structure = recordOrEmpty(strategy.transferable_structure);
  const segmentation = recordOrEmpty(input.segmentation);
  const segments = recordOrEmpty(segmentation.segments);
  return {
    candidate_id: safeId(input.candidate_id),
    platform: safeId(input.platform),
    platform_post_id: safeId(input.platform_post_id),
    canonical_url: safeHttpsUrl(input.canonical_url),
    chosen_pillar: safeId(input.chosen_pillar),
    cohort: {
      rank: nullableNumber(recordOrEmpty(input.cohort).rank) ?? 0,
      success_percentile: nullableNumber(recordOrEmpty(input.cohort).success_percentile),
    },
    strategy: {
      data: {
        opening: {
          start_sec: nullableNumber(opening.start_sec) ?? 0,
          end_sec: nullableNumber(opening.end_sec) ?? 0,
          observed_words: 'Reviewed opening pattern; exact source wording withheld.',
          observed_visual: sanitizePublicText(opening.observed_visual, 500),
          mechanism: sanitizePublicText(opening.mechanism, 500),
        },
        content_arc: {
          audience_problem: sanitizePublicText(arc.audience_problem, 500),
          progression: sanitizePublicText(arc.progression, 500),
          payoff: sanitizePublicText(arc.payoff, 500),
        },
        cta: {
          requested_action: sanitizePublicText(cta.requested_action, 300),
        },
        claims: [],
        transferable_structure: {
          hook_pattern: sanitizePublicText(structure.hook_pattern, 500),
          beat_pattern: sanitizePublicText(structure.beat_pattern, 500),
          payoff_pattern: sanitizePublicText(structure.payoff_pattern, 500),
        },
        evidence_limitations: textArray(strategy.evidence_limitations)
          .map((value) => sanitizePublicText(value, 500))
          .filter(Boolean),
      },
    },
    segmentation: {
      segments: {
        visual_shots: publicSegments(segments.visual_shots, ['visual_description', 'camera_and_motion']),
        audio_beats: publicSegments(segments.audio_beats, ['delivery', 'music_and_sound']),
        editing_beats: publicSegments(segments.editing_beats, ['attention_device', 'layout_and_motion', 'transition_in']),
      },
    },
    media_src: safeMediaPath(input.media_src),
    duration_sec: nullableNumber(input.duration_sec) ?? 0,
    account_handle: sanitizePublicText(input.account_handle, 120),
    source_group: safeId(input.source_group),
    posted_at: isoDate(input.posted_at),
    metric_snapshot_at: isoDate(input.metric_snapshot_at),
    metrics: {
      views: nullableNumber(recordOrEmpty(input.metrics).views),
      likes: nullableNumber(recordOrEmpty(input.metrics).likes),
      comments: nullableNumber(recordOrEmpty(input.metrics).comments),
      shares: nullableNumber(recordOrEmpty(input.metrics).shares),
      saves: nullableNumber(recordOrEmpty(input.metrics).saves),
    },
    language: {
      basis: safeId(recordOrEmpty(input.language).basis),
    },
    company: {
      name: sanitizePublicText(recordOrEmpty(input.company).name, 120) || null,
      basis: sanitizePublicText(recordOrEmpty(input.company).basis, 300),
    },
    paid: {
      label: sanitizePublicText(recordOrEmpty(input.paid).label, 120),
      state: safeId(recordOrEmpty(input.paid).state),
      basis: sanitizePublicText(recordOrEmpty(input.paid).basis, 300),
    },
  };
}

function publicSegments(value: unknown, allowedMetadata: string[]): UnknownRecord[] {
  return array(value).slice(0, 40).map((raw) => {
    const segment = recordOrEmpty(raw);
    const metadata = recordOrEmpty(segment.metadata);
    return {
      start_time: nullableNumber(segment.start_time) ?? 0,
      end_time: nullableNumber(segment.end_time) ?? 0,
      metadata: Object.fromEntries(allowedMetadata.flatMap((key) => {
        const safe = sanitizePublicText(metadata[key], 500);
        return safe ? [[key, safe]] : [];
      })),
    };
  });
}

function safeMediaPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/^\.\//, '/');
  return /^\/media\/[A-Za-z0-9_./-]+$/.test(normalized) ? normalized : '';
}

function containsPhoneNumber(value: string): boolean {
  return /(?<![\d.])(?:\+?1[\s.-])?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/.test(value)
    || /(?<!\d)\+\d{1,3}(?:[\s.-]\d{2,4}){2,4}(?!\d)/.test(value);
}

function jsonArrayEnd(value: string, start: number): number {
  if (value[start] !== '[') throw new Error('Analysis records assignment must begin with a JSON array.');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '[' || character === '{') depth += 1;
    if (character === ']' || character === '}') depth -= 1;
    if (depth === 0) return index + 1;
  }
  throw new Error('Analysis records JSON array was not terminated.');
}

function copyFile(sourceRelative: string, targetRelative: string): void {
  const source = path.join(siteDirectory, sourceRelative);
  const target = path.join(outputDirectory, targetRelative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(sourceRelative: string, targetRelative: string): void {
  const source = path.join(siteDirectory, sourceRelative);
  if (!fs.existsSync(source)) return;
  for (const file of walk(source)) {
    copyFile(path.relative(siteDirectory, file), path.join(targetRelative, path.relative(source, file)));
  }
}

function walk(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).sort();
}

function isTextFile(file: string): boolean {
  return ['.html', '.css', '.js', '.json', '.txt', '.md'].includes(path.extname(file).toLowerCase());
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as UnknownRecord;
}

function recordOrEmpty(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeId(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^\p{L}\p{N}_.:@/-]/gu, '').slice(0, 240) : '';
}

function safeHttpsUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function atomicWrite(filePath: string, contents: string, mode = 0o600): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, contents, { mode });
  fs.renameSync(temporary, filePath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = build();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output_directory: outputDirectory,
    files: report.files,
    bytes: report.bytes,
    sanitized_library_items: report.sanitized_library_items,
    privacy_scan_passed: report.passed,
    release_hash: report.release_hash,
  }, null, 2)}\n`);
}
