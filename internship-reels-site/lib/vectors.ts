import * as fs from 'node:fs';

import type { LoadedVectorIndex, VectorManifest } from './types.js';

export function loadVectorIndex(manifestPath: string, binaryPath: string): LoadedVectorIndex | null {
  if (!fs.existsSync(manifestPath) || !fs.existsSync(binaryPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VectorManifest;
  if (
    manifest.schema_version !== 'viralbench_agent_vectors_v1'
    || manifest.model !== 'gemini-embedding-2'
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
      model: 'gemini-embedding-2',
      dimension,
      index_version: indexVersion,
      generated_at: generatedAt,
      count: entries.length,
      entries,
    },
    binary,
  };
}
