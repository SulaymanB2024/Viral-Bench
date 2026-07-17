import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { buildAgentCorpus, parseDashboardSnapshot } from '../lib/corpus.js';
import { GeminiClient } from '../lib/gemini.js';
import { loadVectorIndex, serializeVectors } from '../lib/vectors.js';

const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(siteDirectory, 'data');
const corpusPath = path.join(dataDirectory, 'agent-corpus.json');
const manifestPath = path.join(dataDirectory, 'agent-vectors.json');
const binaryPath = path.join(dataDirectory, 'agent-vectors.bin');
const buildManifestPath = path.join(dataDirectory, 'agent-index-build-manifest.json');
const maintenancePath = path.join(dataDirectory, '.embedding-maintenance.json');
const EMBEDDING_TOKENS_PER_MINUTE = 25_000;
const EMBEDDINGS_PER_DAY = 900;

interface MaintenanceState {
  calls: Array<{ at: number; estimated_tokens: number }>;
}

async function main(): Promise<void> {
  const embed = process.argv.slice(2).includes('--embed');
  const requireVectors = process.argv.slice(2).includes('--require-vectors');
  const libraryPath = path.join(siteDirectory, 'library.json');
  const dashboardPath = path.join(siteDirectory, 'twelvelabs-dashboard-data.js');
  const library = JSON.parse(fs.readFileSync(libraryPath, 'utf8')) as unknown;
  const dashboard = parseDashboardSnapshot(
    fs.readFileSync(dashboardPath, 'utf8'),
  );
  const corpus = buildAgentCorpus(library, dashboard);
  fs.mkdirSync(dataDirectory, { recursive: true });

  const previous = loadVectorIndex(manifestPath, binaryPath);
  const previousHashes = new Map(previous?.manifest.entries.map((entry) => [
    entry.document_id,
    entry.content_hash,
  ]) ?? []);
  const vectors = corpus.documents.flatMap((document) => {
    const prior = previous?.vectors.get(document.document_id);
    return prior && previousHashes.get(document.document_id) === document.content_hash
      ? [{
          document_id: document.document_id,
          content_hash: document.content_hash,
          values: Array.from(prior),
        }]
      : [];
  });
  const reusedCount = vectors.length;

  if (embed) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY is required only when --embed is supplied.');
    const changed = corpus.documents.filter((document) => (
      previousHashes.get(document.document_id) !== document.content_hash
    ));
    const maintenance = loadMaintenanceState();
    trimMaintenanceState(maintenance);
    if (maintenance.calls.length + changed.length > EMBEDDINGS_PER_DAY) {
      throw new Error(
        `Embedding this refresh would exceed the ${EMBEDDINGS_PER_DAY}-document rolling 24-hour maintenance cap.`,
      );
    }
    const client = new GeminiClient({ apiKey });
    for (const [index, document] of changed.entries()) {
      const estimatedTokens = Math.max(1, Math.ceil(document.search_text.length / 4));
      await waitForTokenCapacity(maintenance, estimatedTokens);
      recordMaintenanceCall(maintenance, estimatedTokens);
      const values = await client.embedText(
        document.search_text,
        async () => {
          trimMaintenanceState(maintenance);
          if (maintenance.calls.length >= EMBEDDINGS_PER_DAY) return false;
          await waitForTokenCapacity(maintenance, estimatedTokens);
          recordMaintenanceCall(maintenance, estimatedTokens);
          return true;
        },
      );
      vectors.push({
        document_id: document.document_id,
        content_hash: document.content_hash,
        values,
      });
      process.stderr.write(`Embedded ${index + 1}/${changed.length}\r`);
    }
    if (changed.length) process.stderr.write('\n');
  }

  const vectorById = new Map(vectors.map((vector) => [vector.document_id, vector]));
  const ordered = corpus.documents.flatMap((document) => {
    const vector = vectorById.get(document.document_id);
    return vector ? [vector] : [];
  });
  if (embed && ordered.length !== corpus.documents.length) {
    throw new Error(
      `Embedding refresh incomplete: ${ordered.length}/${corpus.documents.length} documents have vectors.`,
    );
  }
  if (requireVectors && ordered.length !== corpus.documents.length) {
    throw new Error(
      `Required vector coverage is incomplete: ${ordered.length}/${corpus.documents.length} documents have vectors.`,
    );
  }
  const vectorCoverageState = corpus.documents.length === 0
    ? 'absent_no_documents'
    : ordered.length === corpus.documents.length
      ? 'complete'
      : ordered.length === 0
        ? 'absent_not_requested'
        : 'partial_not_requested';
  const serialized = serializeVectors(ordered, corpus.index_version, new Date().toISOString());
  atomicWrite(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
  atomicWrite(manifestPath, `${JSON.stringify(serialized.manifest, null, 2)}\n`);
  atomicWrite(binaryPath, serialized.binary);
  const buildManifest = {
    schema_version: 'viralbench_agent_index_build_v1',
    generated_at: new Date().toISOString(),
    index_version: corpus.index_version,
    sources: {
      library: fileDescriptor(libraryPath),
      dashboard: fileDescriptor(dashboardPath),
    },
    outputs: {
      corpus: fileDescriptor(corpusPath),
      vector_manifest: fileDescriptor(manifestPath),
      vector_binary: fileDescriptor(binaryPath),
    },
    reconciliation: {
      documents: corpus.documents.length,
      vectors: ordered.length,
      vector_coverage: corpus.documents.length
        ? Math.round((ordered.length / corpus.documents.length) * 1_000_000) / 1_000_000
        : null,
      vector_coverage_state: vectorCoverageState,
      vectors_required: requireVectors || embed,
      skipped_rows: corpus.source_manifest.skipped_rows,
      skipped_by_reason: corpus.source_manifest.skipped_by_reason,
    },
  };
  atomicWrite(buildManifestPath, `${JSON.stringify(buildManifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    index_version: corpus.index_version,
    documents: corpus.documents.length,
    vectors: ordered.length,
    vector_coverage_state: vectorCoverageState,
    vectors_required: requireVectors || embed,
    embedding_calls: embed ? ordered.length - reusedCount : 0,
    build_manifest: path.relative(siteDirectory, buildManifestPath),
  }, null, 2)}\n`);
}

function loadMaintenanceState(): MaintenanceState {
  if (!fs.existsSync(maintenancePath)) return { calls: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(maintenancePath, 'utf8')) as Partial<MaintenanceState>;
    return {
      calls: Array.isArray(parsed.calls)
        ? parsed.calls.filter((entry) => (
            entry
            && typeof entry.at === 'number'
            && typeof entry.estimated_tokens === 'number'
          ))
        : [],
    };
  } catch {
    return { calls: [] };
  }
}

function trimMaintenanceState(state: MaintenanceState): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1_000;
  state.calls = state.calls.filter((entry) => entry.at > cutoff);
}

function recordMaintenanceCall(state: MaintenanceState, estimatedTokens: number): void {
  trimMaintenanceState(state);
  state.calls.push({ at: Date.now(), estimated_tokens: estimatedTokens });
  atomicWrite(maintenancePath, `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

function fileDescriptor(filePath: string): { path: string; sha256: string; bytes: number } {
  const contents = fs.readFileSync(filePath);
  return {
    path: path.relative(siteDirectory, filePath),
    sha256: createHash('sha256').update(contents).digest('hex'),
    bytes: contents.byteLength,
  };
}

function atomicWrite(filePath: string, contents: string | Buffer, mode = 0o600): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, 'wx', mode);
    try {
      fs.writeFileSync(descriptor, contents);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

async function waitForTokenCapacity(state: MaintenanceState, nextTokens: number): Promise<void> {
  while (true) {
    const cutoff = Date.now() - 60_000;
    const recent = state.calls.filter((entry) => entry.at > cutoff);
    const used = recent.reduce((sum, entry) => sum + entry.estimated_tokens, 0);
    if (used + nextTokens <= EMBEDDING_TOKENS_PER_MINUTE) return;
    const oldest = recent[0];
    const waitMs = Math.max(250, Math.min(60_000, (oldest?.at ?? Date.now()) + 60_000 - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

await main();
