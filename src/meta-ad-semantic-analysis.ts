import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteJson } from './artifact-integrity';
import {
  TwelveLabsClient,
  estimateTwelveLabsSemanticCost,
  type TwelveLabsEmbeddingSegment,
} from './semantic-pipeline';
import {
  storeContentAddressedMedia,
  type VideoCreativeAnalysis,
} from './semantic-intelligence';

interface MetaAdCandidate {
  evidence_id: string;
  ad_archive_id: string;
  input_url: string;
  page_name: string;
  canonical_url: string | null;
  copy: {
    body: string;
    title: string;
    caption: string;
    cta: string;
  };
  video_url: string;
}

interface MetaAdSemanticItem {
  evidence_id: string;
  ad_archive_id: string;
  input_url: string;
  page_name: string;
  canonical_url: string | null;
  copy: MetaAdCandidate['copy'];
  media: {
    local_path: string;
    sha256: string;
    bytes: number;
    mime_type: string;
  };
  provider_asset_id: string;
  analysis: VideoCreativeAnalysis;
  video_segments: TwelveLabsEmbeddingSegment[];
  copy_embedding: number[];
  estimated_cost_usd: number;
}

interface MetaAdSemanticReport {
  report_id: string;
  created_at: string;
  source_path: string;
  status: 'completed' | 'partial' | 'failed';
  items: MetaAdSemanticItem[];
  errors: Array<{ evidence_id: string; message: string }>;
  estimated_cost_usd: number;
  external_calls_made: number;
  models: {
    analysis: 'pegasus1.5';
    embeddings: 'marengo3.0';
  };
  redactions: ['credential values are never serialized'];
}

interface CliOptions {
  sourcePath: string;
  outputPath: string;
  mediaRoot: string;
  maxCostUsd: number;
  limit: number;
}

export async function analyzeMetaAds(options: CliOptions): Promise<MetaAdSemanticReport> {
  const apiKey = process.env.TWELVELABS_API_KEY?.trim();
  if (!apiKey) throw new Error('TWELVELABS_API_KEY is required.');
  const source = JSON.parse(fs.readFileSync(path.resolve(options.sourcePath), 'utf8')) as unknown;
  const candidates = extractCandidates(array(record(source).items)).slice(0, options.limit);
  const previous = readPrevious(options.outputPath);
  const byEvidenceId = new Map(previous.items.map((item) => [item.evidence_id, item]));
  const errors = previous.errors.filter((entry) => !candidates.some((candidate) => candidate.evidence_id === entry.evidence_id));
  const client = new TwelveLabsClient({ apiKey });
  let estimatedCost = previous.items.reduce((sum, item) => sum + item.estimated_cost_usd, 0);

  for (const candidate of candidates) {
    if (byEvidenceId.has(candidate.evidence_id)) continue;
    try {
      const media = await storeContentAddressedMedia(candidate.video_url, {
        rootDir: options.mediaRoot,
      });
      if (!media.local_path || !media.sha256 || media.bytes === null || !media.mime_type) {
        throw new Error('Ad video download did not produce a complete local media record.');
      }
      const asset = await client.createAsset({
        localPath: media.local_path,
        filename: path.basename(media.local_path),
        userMetadata: {
          evidence_id: candidate.evidence_id,
          source_sha256: media.sha256,
          advertiser: candidate.page_name,
        },
      });
      if (asset.duration === null || asset.duration <= 0) {
        throw new Error('TwelveLabs ready asset did not report a positive duration.');
      }
      const itemEstimate = estimateTwelveLabsSemanticCost(asset.duration, 4_096, 1);
      if (estimatedCost + itemEstimate > options.maxCostUsd + 1e-9) {
        throw new Error('cost_exhausted:twelvelabs_meta_ads');
      }
      const analysis = await client.analyzeVideo({
        videoAssetId: `${candidate.evidence_id}:video`,
        assetId: asset._id,
        maxTokens: 4_096,
        prompt: [
          'Analyze this active Meta advertisement as research evidence.',
          'Identify the exact opening hook, offer framing, visible product or workflow proof, on-screen text, spoken claims, pacing, CTA, and limitations.',
          'Do not infer targeting, conversion, effectiveness, or causal performance.',
        ].join(' '),
      });
      const videoSegments = await client.embedVideo({ assetId: asset._id });
      const copyEmbedding = await client.embedText([
        candidate.copy.title,
        candidate.copy.body,
        candidate.copy.caption,
        candidate.copy.cta,
      ].filter(Boolean).join('\n'));
      const item: MetaAdSemanticItem = {
        evidence_id: candidate.evidence_id,
        ad_archive_id: candidate.ad_archive_id,
        input_url: candidate.input_url,
        page_name: candidate.page_name,
        canonical_url: candidate.canonical_url,
        copy: candidate.copy,
        media: {
          local_path: media.local_path,
          sha256: media.sha256,
          bytes: media.bytes,
          mime_type: media.mime_type,
        },
        provider_asset_id: asset._id,
        analysis,
        video_segments: videoSegments,
        copy_embedding: copyEmbedding,
        estimated_cost_usd: itemEstimate,
      };
      byEvidenceId.set(item.evidence_id, item);
      estimatedCost += itemEstimate;
      writeReport(options, [...byEvidenceId.values()], errors, estimatedCost, client.externalCallsMade);
    } catch (error) {
      errors.push({
        evidence_id: candidate.evidence_id,
        message: redactError(error instanceof Error ? error.message : String(error)),
      });
      writeReport(options, [...byEvidenceId.values()], errors, estimatedCost, client.externalCallsMade);
    }
  }
  return writeReport(options, [...byEvidenceId.values()], errors, estimatedCost, client.externalCallsMade);
}

function extractCandidates(items: unknown[]): MetaAdCandidate[] {
  const output: MetaAdCandidate[] = [];
  for (const raw of items) {
    const item = record(raw);
    if (item.isActive !== true || item.error || item.errorDescription) continue;
    const snapshot = record(item.snapshot);
    const body = record(snapshot.body);
    const videos = array(snapshot.videos).map(record);
    const videoUrl = videos.map((video) => text(video.videoHdUrl) || text(video.videoSdUrl)).find(Boolean);
    if (!videoUrl) continue;
    const adArchiveId = text(item.adArchiveID) || text(item.adArchiveId) || text(item.adId);
    if (!adArchiveId) continue;
    output.push({
      evidence_id: `meta-ad:${adArchiveId}`,
      ad_archive_id: adArchiveId,
      input_url: text(item.inputUrl),
      page_name: text(item.pageName) || text(snapshot.pageName),
      canonical_url: text(item.url) || null,
      copy: {
        body: text(body.text) || text(snapshot.body),
        title: text(snapshot.title),
        caption: text(snapshot.caption),
        cta: text(snapshot.ctaText),
      },
      video_url: videoUrl,
    });
  }
  return output;
}

function writeReport(
  options: CliOptions,
  items: MetaAdSemanticItem[],
  errors: MetaAdSemanticReport['errors'],
  estimatedCostUsd: number,
  externalCallsMade: number,
): MetaAdSemanticReport {
  const report: MetaAdSemanticReport = {
    report_id: metaAdReportId(options.outputPath),
    created_at: new Date().toISOString(),
    source_path: options.sourcePath,
    status: items.length === 0 ? 'failed' : errors.length ? 'partial' : 'completed',
    items,
    errors,
    estimated_cost_usd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    external_calls_made: externalCallsMade,
    models: {
      analysis: 'pegasus1.5',
      embeddings: 'marengo3.0',
    },
    redactions: ['credential values are never serialized'],
  };
  atomicWriteJson(path.resolve(options.outputPath), report);
  return report;
}

export function metaAdReportId(outputPath: string): string {
  const basename = path.basename(outputPath);
  const extension = path.extname(basename);
  return extension ? basename.slice(0, -extension.length) : basename;
}

function readPrevious(filePath: string): Pick<MetaAdSemanticReport, 'items' | 'errors'> {
  if (!fs.existsSync(path.resolve(filePath))) return { items: [], errors: [] };
  try {
    const value = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as Partial<MetaAdSemanticReport>;
    return {
      items: Array.isArray(value.items) ? value.items : [],
      errors: Array.isArray(value.errors) ? value.errors : [],
    };
  } catch {
    return { items: [], errors: [] };
  }
}

function parseCli(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    values.set(key, value);
    index += 1;
  }
  const maxCostUsd = Number(values.get('--max-cost') ?? '1');
  const limit = Number(values.get('--limit') ?? '10');
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error('--max-cost must be positive.');
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit must be a positive integer.');
  return {
    sourcePath: values.get('--source') ?? '.semantic-artifacts/competitor-content/discovery/meta-active-competitor-ads-20260716.json',
    outputPath: values.get('--out') ?? '.semantic-artifacts/competitor-content/reports/meta-active-video-ads-semantic-20260716.json',
    mediaRoot: values.get('--media-root') ?? '.semantic-artifacts/competitor-content/meta-ads',
    maxCostUsd,
    limit,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function redactError(value: string): string {
  return value
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+|[A-Za-z0-9_.-]{32})\b/g, '[REDACTED]')
    .slice(0, 1_000);
}

async function main(): Promise<void> {
  const report = await analyzeMetaAds(parseCli(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    items: report.items.length,
    errors: report.errors.length,
    estimated_cost_usd: report.estimated_cost_usd,
    external_calls_made: report.external_calls_made,
  }, null, 2)}\n`);
}

if (require.main === module) {
  void main();
}
