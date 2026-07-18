import * as fs from 'node:fs';

import type { LoadedVectorIndex, VectorManifest } from './types.js';

export function loadVectorIndex(manifestPath: string, binaryPath: string): LoadedVectorIndex | null {
  if (!fs.existsSync(manifestPath) || !fs.existsSync(binaryPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VectorManifest;
  if (
    manifest.schema_version !== 'viralbench_agent_vectors_v1'
    || !['gemini-embedding-2', 'viralbench-local-hash-v1'].includes(manifest.model)
    || manifest.dimension !== 768
  ) {
    throw new Error('Agent vector manifest is incompatible.');
  }
  const binary = fs.readFileSync(binaryPath);
  const expectedBytes = manifest.count * manifest.dimension * 4;
  if (binary.byteLength !== expectedBytes) {
    throw new Error(`Agent vector binary length mismatch: expected ${expectedBytes}, received ${binary.byteLength}.`);
  }
  const vectors = new Map<string, Float32Array>();
  for (const entry of manifest.entries) {
    const vector = new Float32Array(manifest.dimension);
    for (let index = 0; index < manifest.dimension; index += 1) {
      vector[index] = binary.readFloatLE((entry.offset + index) * 4);
    }
    vectors.set(entry.document_id, vector);
  }
  return { manifest, vectors };
}

export function serializeVectors(
  vectors: Array<{ document_id: string; content_hash: string; values: number[] }>,
  indexVersion: string,
  generatedAt: string,
  model: VectorManifest['model'] = 'gemini-embedding-2',
): { manifest: VectorManifest; binary: Buffer } {
  const dimension = 768;
  const binary = Buffer.alloc(vectors.length * dimension * 4);
  const entries = vectors.map((vector, vectorIndex) => {
    if (vector.values.length !== dimension || vector.values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Embedding for ${vector.document_id} must contain ${dimension} finite values.`);
    }
    const offset = vectorIndex * dimension;
    for (let index = 0; index < dimension; index += 1) {
      binary.writeFloatLE(vector.values[index] ?? 0, (offset + index) * 4);
    }
    return {
      document_id: vector.document_id,
      content_hash: vector.content_hash,
      offset,
    };
  });
  return {
    manifest: {
      schema_version: 'viralbench_agent_vectors_v1',
      model,
      dimension,
      index_version: indexVersion,
      generated_at: generatedAt,
      count: entries.length,
      entries,
    },
    binary,
  };
}

export function localHashEmbedding(value: string): number[] {
  const dimension = 768;
  const vector = Array.from({ length: dimension }, () => 0);
  const tokens = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 8_000);
  const features = [
    ...tokens,
    ...tokens.slice(0, -1).map((token, index) => `${token}_${tokens[index + 1] ?? ''}`),
  ];
  for (const feature of features) {
    const hash = fnv1a(feature);
    const index = hash % dimension;
    const sign = ((hash >>> 8) & 1) === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return norm ? vector.map((item) => item / norm) : vector;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
