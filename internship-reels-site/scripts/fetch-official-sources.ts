import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { sanitizePublicText } from '../lib/corpus.js';

type UnknownRecord = Record<string, unknown>;

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'ViralBenchEvidenceRefresh/2.0 (+https://internship-reels-site.vercel.app)';

export interface OfficialSourceReport {
  schema_version: 'viralbench_official_sources_v1';
  generated_at: string;
  resources: Array<UnknownRecord & {
    status: 'current' | 'failed';
    retrieved_at: string;
    final_url: string | null;
    http_status: number | null;
    page_title: string;
    summary: string;
    chunks: string[];
    page_content_hash: string | null;
    failure_reason: string | null;
  }>;
  summary: {
    expected: number;
    current: number;
    failed: number;
  };
}

export async function fetchOfficialSources(
  catalogInput: unknown,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
  } = {},
): Promise<OfficialSourceReport> {
  const catalog = record(catalogInput, 'official resource catalog');
  const resources = array(catalog.resources).map((value, index) => record(value, `resources[${index}]`));
  const allowedHosts = new Set(resources.map((resource) => normalizedHost(requiredHttpsUrl(resource.url))));
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const output: OfficialSourceReport['resources'] = [];

  for (const resource of resources) {
    const retrievedAt = now().toISOString();
    try {
      const fetched = await fetchWithReviewedRedirects(
        requiredHttpsUrl(resource.url),
        allowedHosts,
        fetchImpl,
      );
      const parsed = extractReviewedPage(fetched.body);
      output.push({
        ...resource,
        status: 'current',
        retrieved_at: retrievedAt,
        final_url: fetched.url,
        http_status: fetched.status,
        page_title: parsed.title,
        summary: parsed.summary || sanitizePublicText(resource.use_for, 1_000),
        chunks: parsed.chunks,
        page_content_hash: createHash('sha256').update(parsed.normalizedText).digest('hex'),
        failure_reason: null,
      });
    } catch (error) {
      output.push({
        ...resource,
        status: 'failed',
        retrieved_at: retrievedAt,
        final_url: null,
        http_status: error instanceof OfficialFetchError ? error.status : null,
        page_title: '',
        summary: '',
        chunks: [],
        page_content_hash: null,
        failure_reason: error instanceof OfficialFetchError ? error.code : 'official_fetch_failed',
      });
    }
  }

  return {
    schema_version: 'viralbench_official_sources_v1',
    generated_at: now().toISOString(),
    resources: output,
    summary: {
      expected: resources.length,
      current: output.filter((resource) => resource.status === 'current').length,
      failed: output.filter((resource) => resource.status === 'failed').length,
    },
  };
}

async function fetchWithReviewedRedirects(
  initialUrl: string,
  allowedHosts: Set<string>,
  fetchImpl: typeof fetch,
): Promise<{ url: string; status: number; body: string }> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(normalizedHost(current))) {
      throw new OfficialFetchError('unreviewed_redirect_target', null);
    }
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === MAX_REDIRECTS) {
        throw new OfficialFetchError('redirect_limit_or_missing_location', response.status);
      }
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new OfficialFetchError(`http_${response.status}`, response.status);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new OfficialFetchError('unsupported_content_type', response.status);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new OfficialFetchError('response_too_large', response.status);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new OfficialFetchError('response_too_large', response.status);
    }
    return { url: current, status: response.status, body: bytes.toString('utf8') };
  }
  throw new OfficialFetchError('redirect_limit', null);
}

function extractReviewedPage(html: string): {
  title: string;
  summary: string;
  chunks: string[];
  normalizedText: string;
} {
  const title = sanitizePublicText(
    decodeEntities(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)),
    300,
  );
  const description = sanitizePublicText(
    decodeEntities(
      firstMatch(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
      || firstMatch(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i),
    ),
    800,
  );
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const paragraphs = [...withoutNoise.matchAll(/<(?:p|li|h1|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:p|li|h1|h2|h3)>/gi)]
    .map((match) => sanitizePublicText(decodeEntities(stripTags(match[1] ?? '')), 1_200))
    .filter((value) => value.length >= 30);
  const unique = [...new Set(paragraphs)];
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of unique) {
    if (`${current} ${paragraph}`.trim().length > 1_500) {
      if (current) chunks.push(current);
      current = paragraph;
    } else {
      current = `${current} ${paragraph}`.trim();
    }
    if (chunks.length >= 3) break;
  }
  if (current && chunks.length < 3) chunks.push(current);
  const normalizedText = [title, description, ...chunks].filter(Boolean).join('\n');
  if (normalizedText.length < 80) throw new OfficialFetchError('insufficient_reviewed_text', 200);
  return {
    title,
    summary: description || chunks[0]?.slice(0, 800) || '',
    chunks,
    normalizedText,
  };
}

class OfficialFetchError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, status: number | null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function firstMatch(value: string, pattern: RegExp): string {
  return pattern.exec(value)?.[1] ?? '';
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizedHost(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
}

function requiredHttpsUrl(value: unknown): string {
  if (typeof value !== 'string') throw new OfficialFetchError('missing_https_url', null);
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new OfficialFetchError('missing_https_url', null);
  return parsed.toString();
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as UnknownRecord;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const catalogPath = option(args, '--catalog');
  if (!catalogPath) throw new Error('--catalog is required.');
  const outputPath = path.resolve(option(args, '--out') ?? path.join(siteDirectory, 'data/official-sources.json'));
  const report = await fetchOfficialSources(JSON.parse(fs.readFileSync(path.resolve(catalogPath), 'utf8')));
  atomicWrite(outputPath, report);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output_path: outputPath,
    ...report.summary,
    external_calls_made: report.summary.expected,
    paid_calls_made: 0,
  }, null, 2)}\n`);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
