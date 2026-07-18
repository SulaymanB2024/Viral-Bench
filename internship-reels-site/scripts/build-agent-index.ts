import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { buildAgentCorpus, createCorpusView, parseDashboardSnapshot } from '../lib/corpus.js';
import { GeminiClient } from '../lib/gemini.js';
import { loadVectorIndex, localHashEmbedding, serializeVectors } from '../lib/vectors.js';

const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(siteDirectory, 'data');
const publicCorpusPath = path.join(dataDirectory, 'agent-corpus-public.json');
const operatorCorpusPath = path.join(dataDirectory, 'agent-corpus-operator.json');
const compatibilityCorpusPath = path.join(dataDirectory, 'agent-corpus.json');
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
  const args = process.argv.slice(2);
  const embed = args.includes('--embed');
  const localVectors = args.includes('--local-vectors');
  if (embed && localVectors) throw new Error('--embed and --local-vectors are mutually exclusive.');
  const requireVectors = args.includes('--require-vectors');
  const requirePublicVectors = args.includes('--require-public-vectors') || embed || localVectors;
  const libraryPath = path.resolve(option(args, '--library') ?? path.join(siteDirectory, 'library.json'));
  const dashboardPath = path.resolve(option(args, '--dashboard') ?? path.join(siteDirectory, 'twelvelabs-dashboard-data.js'));
  const audiencePaths = options(args, '--audience').map((value) => path.resolve(value));
  const analysisPaths = options(args, '--analysis').map((value) => path.resolve(value));
  const officialPath = optionalExistingPath(
    option(args, '--official') ?? path.join(dataDirectory, 'official-sources.json'),
  );
  const ownedPath = optionalExistingPath(
    option(args, '--owned') ?? path.join(dataDirectory, 'owned-evidence.json'),
  );
  const library = JSON.parse(fs.readFileSync(libraryPath, 'utf8')) as unknown;
  const dashboard = parseDashboardSnapshot(fs.readFileSync(dashboardPath, 'utf8'));
  const audienceInputs = audiencePaths.map(readJson);
  const analysisInputs = analysisPaths.map(readJson);
  const officialInput = officialPath ? readJson(officialPath) : null;
  const ownedInput = ownedPath ? readJson(ownedPath) : null;
  const completeCorpus = buildAgentCorpus(library, dashboard, {
    audienceInputs,
    analysisInputs,
    officialInput,
    ownedInput,
  });
  const socialDocumentCount = completeCorpus.documents.filter((document) => (
    document.evidence_type === 'social_post'
  )).length;
  if (socialDocumentCount !== completeCorpus.source_manifest.library_items) {
    throw new Error(
      `Social retrieval cardinality mismatch: ${socialDocumentCount} documents for `
      + `${completeCorpus.source_manifest.library_items} library posts.`,
    );
  }
  const publicCorpus = createCorpusView(completeCorpus, 'public_reviewed');
  const operatorCorpus = createCorpusView(completeCorpus, 'operator_provisional');
  fs.mkdirSync(dataDirectory, { recursive: true });

  const previous = loadVectorIndex(manifestPath, binaryPath);
  const vectorModel = localVectors ? 'viralbench-local-hash-v1' : 'gemini-embedding-2';
  const canReusePrevious = previous?.manifest.model === vectorModel;
  const previousHashes = new Map(previous?.manifest.entries.map((entry) => [
    entry.document_id,
    entry.content_hash,
  ]) ?? []);
  const vectors = operatorCorpus.documents.flatMap((document) => {
    const prior = canReusePrevious ? previous?.vectors.get(document.document_id) : null;
    return prior && previousHashes.get(document.document_id) === document.content_hash
      ? [{
          document_id: document.document_id,
          content_hash: document.content_hash,
          values: Array.from(prior),
        }]
      : [];
  });
  const reusedCount = vectors.length;

  if (localVectors) {
    const reusedIds = new Set(vectors.map((vector) => vector.document_id));
    for (const document of operatorCorpus.documents) {
      if (reusedIds.has(document.document_id)) continue;
      vectors.push({
        document_id: document.document_id,
        content_hash: document.content_hash,
        values: localHashEmbedding(document.search_text),
      });
    }
  }

  if (embed) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY is required only when --embed is supplied.');
    const changed = operatorCorpus.documents.filter((document) => (
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
  const ordered = operatorCorpus.documents.flatMap((document) => {
    const vector = vectorById.get(document.document_id);
    return vector ? [vector] : [];
  });
  const publicVectorCount = publicCorpus.documents.filter((document) => vectorById.has(document.document_id)).length;
  if (requirePublicVectors && publicVectorCount !== publicCorpus.documents.length) {
    throw new Error(
      `Required public vector coverage is incomplete: ${publicVectorCount}/${publicCorpus.documents.length} documents have vectors.`,
    );
  }
  if (requireVectors && ordered.length !== operatorCorpus.documents.length) {
    throw new Error(
      `Required operator vector coverage is incomplete: ${ordered.length}/${operatorCorpus.documents.length} documents have vectors.`,
    );
  }
  const publicVectorCoverageState = coverageState(publicCorpus.documents.length, publicVectorCount);
  const operatorVectorCoverageState = coverageState(operatorCorpus.documents.length, ordered.length);
  const serialized = serializeVectors(
    ordered,
    operatorCorpus.index_version,
    new Date().toISOString(),
    vectorModel,
  );
  atomicWrite(publicCorpusPath, `${JSON.stringify(publicCorpus, null, 2)}\n`);
  atomicWrite(operatorCorpusPath, `${JSON.stringify(operatorCorpus, null, 2)}\n`);
  atomicWrite(compatibilityCorpusPath, `${JSON.stringify(publicCorpus, null, 2)}\n`);
  atomicWrite(manifestPath, `${JSON.stringify(serialized.manifest, null, 2)}\n`);
  atomicWrite(binaryPath, serialized.binary);
  const buildManifest = {
    schema_version: 'viralbench_agent_index_build_v2',
    generated_at: new Date().toISOString(),
    index_versions: {
      public: publicCorpus.index_version,
      operator: operatorCorpus.index_version,
    },
    sources: {
      library: fileDescriptor(libraryPath),
      dashboard: fileDescriptor(dashboardPath),
      audience: audiencePaths.map(fileDescriptor),
      analysis: analysisPaths.map(fileDescriptor),
      official: officialPath ? fileDescriptor(officialPath) : null,
      owned: ownedPath ? fileDescriptor(ownedPath) : null,
    },
    outputs: {
      public_corpus: fileDescriptor(publicCorpusPath),
      operator_corpus: fileDescriptor(operatorCorpusPath),
      compatibility_corpus: fileDescriptor(compatibilityCorpusPath),
      vector_manifest: fileDescriptor(manifestPath),
      vector_binary: fileDescriptor(binaryPath),
    },
    reconciliation: {
      source_records: {
        social_posts: completeCorpus.source_manifest.library_items,
        audience_signals: completeCorpus.source_manifest.audience_signals,
        official_resources: completeCorpus.source_manifest.official_resources,
        owned_connection_state: completeCorpus.source_manifest.owned_connection_state,
      },
      public_documents: publicCorpus.documents.length,
      operator_documents: operatorCorpus.documents.length,
      vectors: ordered.length,
      public_vectors: publicVectorCount,
      public_vector_coverage: ratio(publicVectorCount, publicCorpus.documents.length),
      operator_vector_coverage: ratio(ordered.length, operatorCorpus.documents.length),
      public_vector_coverage_state: publicVectorCoverageState,
      operator_vector_coverage_state: operatorVectorCoverageState,
      vectors_required: requireVectors || requirePublicVectors,
      skipped_rows: completeCorpus.source_manifest.skipped_rows,
      skipped_by_reason: completeCorpus.source_manifest.skipped_by_reason,
      social_document_count: socialDocumentCount,
      public_by_evidence_type: publicCorpus.source_manifest.by_evidence_type,
      operator_by_evidence_type: operatorCorpus.source_manifest.by_evidence_type,
    },
  };
  atomicWrite(buildManifestPath, `${JSON.stringify(buildManifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    public_index_version: publicCorpus.index_version,
    operator_index_version: operatorCorpus.index_version,
    public_documents: publicCorpus.documents.length,
    operator_documents: operatorCorpus.documents.length,
    vectors: ordered.length,
    public_vector_coverage_state: publicVectorCoverageState,
    operator_vector_coverage_state: operatorVectorCoverageState,
    vectors_required: requireVectors || requirePublicVectors,
    vector_model: vectorModel,
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

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function optionalExistingPath(value: string): string | null {
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) ? resolved : null;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function options(args: string[], name: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    result.push(value);
    index += 1;
  }
  return result;
}

function coverageState(total: number, count: number): string {
  if (!total) return 'absent_no_documents';
  if (count === total) return 'complete';
  if (!count) return 'absent_not_requested';
  return 'partial_not_requested';
}

function ratio(count: number, total: number): number | null {
  return total ? Math.round((count / total) * 1_000_000) / 1_000_000 : null;
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
