import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import ffmpegPath from 'ffmpeg-static';

export interface ShortVideoRenderResult {
  status: 'rendered';
  package_dir: string;
  output_path: string;
  narration_path: string;
  captions_path: string;
  manifest_path: string;
  source_slides: string[];
  duration_sec: number;
  output_sha256: string;
  output_bytes: number;
  approved_for_posting: false;
}

export function buildConcatManifest(slidePaths: string[], secondsPerSlide: number): string {
  if (!slidePaths.length) throw new Error('Short-video rendering requires at least one slide.');
  if (!Number.isFinite(secondsPerSlide) || secondsPerSlide <= 0) throw new Error('secondsPerSlide must be positive.');
  const lines: string[] = [];
  for (const slide of slidePaths) {
    lines.push(`file '${escapeConcatPath(path.resolve(slide))}'`);
    lines.push(`duration ${secondsPerSlide.toFixed(3)}`);
  }
  lines.push(`file '${escapeConcatPath(path.resolve(slidePaths[slidePaths.length - 1]))}'`);
  return `${lines.join('\n')}\n`;
}

export function buildSrtCaptions(script: string, durationSec: number, wordsPerCaption = 10): string {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('Caption script must not be empty.');
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('Caption duration must be positive.');
  if (!Number.isInteger(wordsPerCaption) || wordsPerCaption < 4 || wordsPerCaption > 16) {
    throw new Error('wordsPerCaption must be an integer from 4 to 16.');
  }
  const chunks: string[][] = [];
  for (let index = 0; index < words.length; index += wordsPerCaption) chunks.push(words.slice(index, index + wordsPerCaption));
  let cursor = 0;
  return `${chunks.map((chunk, index) => {
    const share = chunk.length / words.length;
    const end = index === chunks.length - 1 ? durationSec : cursor + durationSec * share;
    const block = `${index + 1}\n${srtTimestamp(cursor)} --> ${srtTimestamp(end)}\n${wrapCaption(chunk.join(' '))}`;
    cursor = end;
    return block;
  }).join('\n\n')}\n`;
}

export function renderShortVideoPackage(options: {
  packageDir: string;
  outputPath?: string;
  durationSec?: number;
  voice?: string;
  speechRate?: number;
  ffmpegBinary?: string;
  sayBinary?: string;
}): ShortVideoRenderResult {
  const packageDir = path.resolve(options.packageDir);
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    throw new Error(`Rendered creative package does not exist: ${packageDir}`);
  }
  const slides = fs.readdirSync(path.join(packageDir, 'output'))
    .filter((file) => /^slide_\d+\.png$/i.test(file))
    .sort()
    .map((file) => path.join(packageDir, 'output', file));
  if (!slides.length) throw new Error('Rendered creative package has no output/slide_*.png files.');
  const scriptPath = path.join(packageDir, 'output', 'spoken_script.txt');
  if (!fs.existsSync(scriptPath)) throw new Error('Rendered creative package has no output/spoken_script.txt.');
  const script = fs.readFileSync(scriptPath, 'utf8').trim();
  if (!script) throw new Error('Spoken script must not be empty.');
  const packageManifestPath = path.join(packageDir, 'manifest.json');
  const packageManifest = fs.existsSync(packageManifestPath)
    ? readPackageManifest(packageManifestPath)
    : null;
  const jobId = packageManifest?.job_id ?? path.basename(packageDir);
  const durationSec = options.durationSec ?? 20;
  if (!Number.isFinite(durationSec) || durationSec < 4 || durationSec > 60) {
    throw new Error('Short-video duration must be from 4 to 60 seconds.');
  }
  const outputPath = path.resolve(options.outputPath ?? path.join(packageDir, 'output', `${safeName(jobId)}.mp4`));
  if (!outputPath.startsWith(`${packageDir}${path.sep}`)) {
    throw new Error('Short-video output must remain inside the rendered package directory.');
  }
  const ffmpeg = options.ffmpegBinary ?? ffmpegPath;
  if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new Error('ffmpeg binary is unavailable.');
  const say = options.sayBinary ?? '/usr/bin/say';
  if (!fs.existsSync(say)) throw new Error('macOS say is unavailable; supply an approved narration track instead.');

  const temporaryDir = path.join(packageDir, `.short-video-${process.pid}`);
  fs.mkdirSync(temporaryDir, { recursive: false });
  const concatPath = path.join(temporaryDir, 'slides.concat.txt');
  const narrationPath = path.join(packageDir, 'output', 'narration.aiff');
  const captionsPath = path.join(packageDir, 'output', 'captions.srt');
  const manifestPath = path.join(packageDir, 'qa', 'short_video_manifest.json');
  try {
    fs.writeFileSync(concatPath, buildConcatManifest(slides, durationSec / slides.length), { flag: 'wx' });
    fs.writeFileSync(captionsPath, buildSrtCaptions(script, durationSec, 6));
    execFileSync(say, [
      '-v', options.voice ?? 'Samantha',
      '-r', String(options.speechRate ?? 190),
      '-o', narrationPath,
      script,
    ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-i', narrationPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', `scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,subtitles=${escapeFilterPath(captionsPath)}:force_style='FontName=Arial,FontSize=7,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,MarginV=42,Alignment=2',format=yuv420p`,
      '-r', '30',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '128k', '-af', `apad=pad_dur=${durationSec}`,
      '-t', String(durationSec),
      '-movflags', '+faststart',
      outputPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });

    const bytes = fs.readFileSync(outputPath);
    const result: ShortVideoRenderResult = {
      status: 'rendered',
      package_dir: packageDir,
      output_path: outputPath,
      narration_path: narrationPath,
      captions_path: captionsPath,
      manifest_path: manifestPath,
      source_slides: slides,
      duration_sec: durationSec,
      output_sha256: sha256(bytes),
      output_bytes: bytes.length,
      approved_for_posting: false,
    };
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      ...result,
      created_at: new Date().toISOString(),
      renderer: 'local_ffmpeg_static',
      narration: 'macOS say local synthetic voice',
      source_slide_sha256: slides.map((slide) => ({ path: slide, sha256: sha256(fs.readFileSync(slide)) })),
      spoken_script_sha256: sha256(Buffer.from(script)),
      qa_state: 'pending_human_review',
      evidence_limitations: packageManifest?.posting_notes.slice(0, 5) ?? [
        'The video is a locally rendered draft and requires factual review.',
        'No public posting is authorized by the renderer.',
      ],
    }, null, 2)}\n`);
    return result;
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function readPackageManifest(filePath: string): { job_id: string; posting_notes: string[] } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const outputs = record.output_requirements;
    if (typeof record.job_id !== 'string' || !record.job_id.trim()
      || !outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return null;
    const postingNotes = (outputs as Record<string, unknown>).posting_notes;
    return {
      job_id: record.job_id.trim(),
      posting_notes: Array.isArray(postingNotes)
        ? postingNotes.flatMap((note) => typeof note === 'string' && note.trim() ? [note.trim()] : [])
        : [],
    };
  } catch {
    return null;
  }
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'short-video';
}

function escapeConcatPath(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function srtTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return [hours, minutes, wholeSeconds].map((value) => String(value).padStart(2, '0')).join(':')
    + `,${String(remainder).padStart(3, '0')}`;
}

function wrapCaption(value: string): string {
  const words = value.split(/\s+/);
  if (value.length <= 42) return value;
  let best = 1;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const current = Math.abs(words.slice(0, index).join(' ').length - words.slice(index).join(' ').length);
    if (current < distance) {
      best = index;
      distance = current;
    }
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}.`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const packageDir = options['package-dir'];
    if (!packageDir) throw new Error('Usage: npm run shorts -- --package-dir <rendered-package> [--out <inside-package.mp4>]');
    const result = renderShortVideoPackage({
      packageDir,
      outputPath: options.out,
      durationSec: options.duration ? Number(options.duration) : undefined,
      voice: options.voice,
      speechRate: options.rate ? Number(options.rate) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
