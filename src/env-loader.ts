import * as fs from 'node:fs';
import * as path from 'node:path';

export type EnvMap = Record<string, string | undefined>;

export interface LoadedEnvFile {
  path: string;
  absolute_path: string;
  exists: boolean;
  loaded_key_count: number;
  keys: string[];
  ignored_line_count: number;
  warnings: string[];
  values: EnvMap;
}

export interface MergedEnvFileReport {
  env_file: LoadedEnvFile | null;
  effective_env: EnvMap;
}

export function loadEnvFile(filePath: string, rootDir = process.cwd()): LoadedEnvFile {
  const absolutePath = path.resolve(rootDir, filePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      path: relativeToRoot(rootDir, absolutePath),
      absolute_path: absolutePath,
      exists: false,
      loaded_key_count: 0,
      keys: [],
      ignored_line_count: 0,
      warnings: [`Env file does not exist: ${relativeToRoot(rootDir, absolutePath)}`],
      values: {},
    };
  }

  const parsed = parseEnvFile(fs.readFileSync(absolutePath, 'utf8'));
  return {
    path: relativeToRoot(rootDir, absolutePath),
    absolute_path: absolutePath,
    exists: true,
    loaded_key_count: Object.keys(parsed.values).length,
    keys: Object.keys(parsed.values).sort(),
    ignored_line_count: parsed.ignored_line_count,
    warnings: parsed.warnings,
    values: parsed.values,
  };
}

export function mergeEnvWithFile(
  baseEnv: EnvMap,
  options: { envFile?: string; rootDir?: string } = {},
): MergedEnvFileReport {
  const rootDir = options.rootDir ?? process.cwd();
  const envFile = options.envFile ? loadEnvFile(options.envFile, rootDir) : null;
  return {
    env_file: envFile,
    effective_env: {
      ...(envFile?.values ?? {}),
      ...baseEnv,
    },
  };
}

export function parseEnvFile(content: string): { values: EnvMap; ignored_line_count: number; warnings: string[] } {
  const values: EnvMap = {};
  const warnings: string[] = [];
  let ignoredLineCount = 0;

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      ignoredLineCount += 1;
      warnings.push(`Ignored line ${index + 1}: expected KEY=value`);
      return;
    }

    const [, key, rawValue] = match;
    values[key] = parseEnvValue(rawValue);
  });

  return { values, ignored_line_count: ignoredLineCount, warnings };
}

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  const commentIndex = trimmed.search(/\s#/);
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}

function relativeToRoot(rootDir: string, absolutePath: string): string {
  const relative = path.relative(rootDir, absolutePath).replace(/\\/g, '/');
  return relative || '.';
}
