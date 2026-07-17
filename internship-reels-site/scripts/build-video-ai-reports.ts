import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GeminiClient } from '../lib/gemini.js';
import {
  VIDEO_REPORT_MODEL,
  VIDEO_REPORT_RESPONSE_SCHEMA,
  VIDEO_REPORT_SCHEMA_VERSION,
  buildVideoEvidence,
  parseVideoRecordsFromIndex,
  storedVideoReport,
  validateVideoReportOutput,
  videoReportContentHash,
  videoReportPrompt,
  videoReportSystemInstruction,
  type StoredVideoReport,
  type VideoReportSnapshot,
} from '../lib/video-reports.js';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const analysisPath = path.join(siteRoot, 'analysis.html');
const jsonPath = path.join(siteRoot, 'data', 'video-ai-reports.json');
const javascriptPath = path.join(siteRoot, 'data', 'video-ai-reports.js');
const apiKey = process.env.GEMINI_API_KEY?.trim();
const force = process.argv.includes('--force');

if (!apiKey) {
  throw new Error('GEMINI_API_KEY is required for the explicit video-report maintenance command.');
}

const source = await readFile(analysisPath, 'utf8');
const records = parseVideoRecordsFromIndex(source);
const existing = await loadExistingSnapshot();
const reports: Record<string, StoredVideoReport> = { ...existing.reports };
const pending = records.filter((record) => {
  const candidateId = string(record.candidate_id);
  const current = reports[candidateId];
  return force
    || !current
    || current.content_hash !== videoReportContentHash(record)
    || !passesCurrentEvidenceGate(current, record);
});

if (pending.length === 0) {
  console.log(`Video AI reports are current (${records.length}/${records.length}); no Gemini calls made.`);
  await persistSnapshot(reports);
  process.exit(0);
}

const client = new GeminiClient({ apiKey });
for (let index = 0; index < pending.length; index += 1) {
  const record = pending[index];
  if (!record) continue;
  const candidateId = string(record.candidate_id);
  console.log(`Generating reviewed report ${index + 1}/${pending.length}: ${candidateId}`);
  const evidence = buildVideoEvidence(record);
  const response = await client.generateJson({
    model: VIDEO_REPORT_MODEL,
    systemInstruction: videoReportSystemInstruction(),
    prompt: videoReportPrompt(record, evidence),
    responseSchema: VIDEO_REPORT_RESPONSE_SCHEMA,
    maxOutputTokens: 1_400,
  });
  const validated = validateVideoReportOutput(response, evidence);
  reports[candidateId] = storedVideoReport(record, validated, evidence);
  await persistSnapshot(reports);

  if (index < pending.length - 1) {
    console.log('Waiting 13 seconds to remain inside the supplied free-tier RPM limit.');
    await new Promise((resolve) => setTimeout(resolve, 13_000));
  }
}

console.log(`Video AI reports ready (${records.length}/${records.length}); ${pending.length} Gemini call(s) made.`);

async function loadExistingSnapshot(): Promise<VideoReportSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as Partial<VideoReportSnapshot>;
    if (
      parsed.schema_version === VIDEO_REPORT_SCHEMA_VERSION
      && parsed.model === VIDEO_REPORT_MODEL
      && parsed.reports
      && typeof parsed.reports === 'object'
    ) {
      return parsed as VideoReportSnapshot;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    schema_version: VIDEO_REPORT_SCHEMA_VERSION,
    generated_at: new Date(0).toISOString(),
    model: VIDEO_REPORT_MODEL,
    reports: {},
  };
}

async function persistSnapshot(allReports: Record<string, StoredVideoReport>): Promise<void> {
  const allowedIds = new Set(records.map((record) => string(record.candidate_id)));
  const filtered = Object.fromEntries(
    Object.entries(allReports)
      .filter(([candidateId]) => allowedIds.has(candidateId))
      .map(([candidateId, report]) => (
        [candidateId, { ...report, candidate_id: candidateId }] as [string, StoredVideoReport]
      ))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const snapshot: VideoReportSnapshot = {
    schema_version: VIDEO_REPORT_SCHEMA_VERSION,
    generated_at: latestGeneratedAt(Object.values(filtered)),
    model: VIDEO_REPORT_MODEL,
    reports: filtered,
  };
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  const safeForScript = JSON.stringify(snapshot)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  await atomicWrite(jsonPath, serialized);
  await atomicWrite(
    javascriptPath,
    `window.__VIRALBENCH_VIDEO_AI_REPORTS__ = ${safeForScript};\n`,
  );
}

async function atomicWrite(destination: string, contents: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
}

function latestGeneratedAt(reportsToCompare: StoredVideoReport[]): string {
  return reportsToCompare
    .map((report) => report.generated_at)
    .sort()
    .at(-1) ?? new Date().toISOString();
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Every per-video record requires a candidate_id.');
  }
  return value.trim();
}

function passesCurrentEvidenceGate(report: StoredVideoReport, record: Record<string, unknown>): boolean {
  try {
    validateVideoReportOutput(report, buildVideoEvidence(record));
    return true;
  } catch {
    return false;
  }
}
