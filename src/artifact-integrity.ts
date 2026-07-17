import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ArtifactDescriptor {
  path: string;
  sha256: string;
  bytes: number;
  modified_at: string;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashFile(filePath: string): string {
  return sha256(fs.readFileSync(path.resolve(filePath)));
}

export function describeArtifact(filePath: string, relativeTo = process.cwd()): ArtifactDescriptor {
  const target = path.resolve(filePath);
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error(`Artifact is not a file: ${target}`);
  return {
    path: path.relative(path.resolve(relativeTo), target) || path.basename(target),
    sha256: hashFile(target),
    bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
  };
}

export function atomicWriteFile(
  filePath: string,
  contents: string | Buffer,
  options: { mode?: number; skipIfUnchanged?: boolean } = {},
): void {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (options.skipIfUnchanged !== false && fs.existsSync(target)) {
    const current = fs.readFileSync(target);
    const next = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    if (current.equals(next)) return;
  }
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, 'wx', options.mode ?? 0o600);
    try {
      fs.writeFileSync(descriptor, contents);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
