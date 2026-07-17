import { execFileSync, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteFile, atomicWriteJson } from './artifact-integrity';
import type { SelectionLedger } from './internship-research-batch';

interface RecoveryReport { runs: Array<{ items: Array<Record<string, unknown>> }>; totals: { actual_cost_usd_reported: number } }
export interface InternshipMediaManifest {
  schema_version: 1;
  batch_id: string;
  generated_at: string;
  media_directory: string;
  rows: Array<{
    candidate_id: string; canonical_url: string; platform: string; platform_post_id: string;
    chosen_pillar: string; media_path: string | null; media_sha256: string | null;
    byte_size: number | null; duration_sec: number | null;
    media_kind: 'downloaded_public_video' | 'rendered_public_slideshow' | 'unavailable';
    retrieval_state: 'ready' | 'gap'; limitation: string | null;
  }>;
  costs: { supplemental_retrieval_actual_usd: number };
  privacy: { public_media_only: true; publishing_in_scope: false };
}

export async function prepareInternshipMedia(options: {
  selection: SelectionLedger; recovery: RecoveryReport; mediaDir: string; ffmpegPath: string;
}): Promise<InternshipMediaManifest> {
  fs.mkdirSync(options.mediaDir, { recursive: true });
  const recovery = new Map(options.recovery.runs.flatMap((run) => run.items).map((item) => [String(item.id), item]));
  const selected = options.selection.entries.filter((entry) => entry.selected);
  const rows: InternshipMediaManifest['rows'] = [];
  for (const entry of selected) {
    let mediaPath = findVideo(options.mediaDir, entry.platform, entry.platform_post_id);
    let kind: InternshipMediaManifest['rows'][number]['media_kind'] = mediaPath ? 'downloaded_public_video' : 'unavailable';
    let limitation: string | null = null;
    if (!mediaPath) {
      const item = recovery.get(entry.platform_post_id);
      const links = stringArray(item?.slideshowImageLinks);
      if (links.length) {
        mediaPath = await renderSlideshow(entry.platform_post_id, links, options.mediaDir, options.ffmpegPath);
        kind = 'rendered_public_slideshow';
        limitation = 'Slideshow was rendered from observed public image frames; no original soundtrack is represented.';
      }
    }
    const stat = mediaPath ? fs.statSync(mediaPath) : null;
    rows.push({
      candidate_id: entry.candidate_id, canonical_url: entry.canonical_url, platform: entry.platform,
      platform_post_id: entry.platform_post_id, chosen_pillar: entry.chosen_pillar,
      media_path: mediaPath ? path.relative(process.cwd(), mediaPath) : null,
      media_sha256: mediaPath ? sha256(fs.readFileSync(mediaPath)) : null,
      byte_size: stat?.size ?? null, duration_sec: mediaPath ? probeDuration(mediaPath, options.ffmpegPath) : null,
      media_kind: kind, retrieval_state: mediaPath ? 'ready' : 'gap',
      limitation: mediaPath ? limitation : 'Public media could not be resolved; no substitute media was used.',
    });
  }
  return {
    schema_version: 1, batch_id: options.selection.batch_id, generated_at: new Date().toISOString(),
    media_directory: path.relative(process.cwd(), options.mediaDir), rows,
    costs: { supplemental_retrieval_actual_usd: options.recovery.totals.actual_cost_usd_reported },
    privacy: { public_media_only: true, publishing_in_scope: false },
  };
}

function findVideo(directory: string, platform: string, id: string): string | null {
  const prefix = `${platform}-${id}.`;
  const filename = fs.readdirSync(directory).find((name) => name.startsWith(prefix) && /\.(mp4|mov|webm)$/i.test(name));
  return filename ? path.join(directory, filename) : null;
}

async function renderSlideshow(id: string, links: string[], directory: string, ffmpeg: string): Promise<string> {
  const frameDir = path.join(directory, `slideshow-${id}`);
  fs.mkdirSync(frameDir, { recursive: true });
  const frames: string[] = [];
  for (let index = 0; index < links.length; index += 1) {
    const target = path.join(frameDir, `${String(index).padStart(3, '0')}.jpg`);
    if (!fs.existsSync(target)) {
      const response = await fetch(links[index]);
      if (!response.ok) throw new Error(`slideshow frame retrieval failed with HTTP ${response.status}`);
      atomicWriteFile(target, Buffer.from(await response.arrayBuffer()));
    }
    frames.push(target);
  }
  const listPath = path.join(frameDir, 'frames.txt');
  atomicWriteFile(listPath, `${frames.flatMap((frame) => [`file '${frame.replace(/'/g, "'\\''")}'`, 'duration 2']).concat(`file '${frames.at(-1)!.replace(/'/g, "'\\''")}'`).join('\n')}\n`);
  const output = path.join(directory, `tiktok-${id}.mp4`);
  const temporaryOutput = `${output}.${process.pid}.tmp.mp4`;
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
      '-r', '30', '-c:v', 'libx264', '-an', temporaryOutput]);
    fs.renameSync(temporaryOutput, output);
  } catch (error) {
    if (fs.existsSync(temporaryOutput)) fs.unlinkSync(temporaryOutput);
    throw error;
  }
  return output;
}

function probeDuration(file: string, ffmpeg: string): number | null {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(`${result.stderr ?? ''}`);
  return match ? Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000) / 1000 : null;
}
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    if (typeof item === 'string' && item.startsWith('https://')) return [item];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const link = [record.tiktokLink, record.downloadLink].find((candidate) => typeof candidate === 'string' && candidate.startsWith('https://'));
    return typeof link === 'string' ? [link] : [];
  });
}
function sha256(value: Buffer): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as T; }
function write(file: string, value: unknown): void { atomicWriteJson(path.resolve(file), value); }

async function main(): Promise<void> {
  const mediaDir = path.resolve('.semantic-artifacts/competitor-content/media/internship-us-20260716');
  const manifest = await prepareInternshipMedia({
    selection: read('.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-selection.json'),
    recovery: read('.semantic-artifacts/competitor-content/discovery/internship-us-media-recovery-20260716.json'),
    mediaDir, ffmpegPath: path.resolve('node_modules/ffmpeg-static/ffmpeg'),
  });
  const out = '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-media.json';
  write(out, manifest);
  process.stdout.write(`${JSON.stringify({ready: manifest.rows.filter((row) => row.retrieval_state === 'ready').length, gaps: manifest.rows.filter((row) => row.retrieval_state === 'gap').length, output_path: out}, null, 2)}\n`);
}
if (require.main === module) void main();
