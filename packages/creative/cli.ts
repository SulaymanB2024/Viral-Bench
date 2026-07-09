import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type CreativeProviderName,
  CREATIVE_PROVIDER_NAMES,
  loadCreativeJobManifest,
} from './job_schema';
import { runCreativeProvider } from './provider_router';

interface CliArgs {
  command: string;
  options: Record<string, string | boolean>;
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'validate': {
      const job = loadCreativeJobManifest(requiredStringOpt(options, 'job'));
      console.log(JSON.stringify({ ok: true, job_id: job.job_id }, null, 2));
      return;
    }

    case 'render': {
      const job = loadCreativeJobManifest(requiredStringOpt(options, 'job'));
      const result = await runCreativeProvider('local_renderer', job, {
        outDir: stringOpt(options, 'out'),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'provider': {
      const provider = providerOpt(requiredStringOpt(options, 'name'));
      const job = loadCreativeJobManifest(requiredStringOpt(options, 'job'));
      const result = await runCreativeProvider(provider, job, {
        outDir: stringOpt(options, 'out'),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'schema': {
      console.log(fs.readFileSync(path.join(__dirname, 'job_schema.ts'), 'utf8'));
      return;
    }

    case 'help':
    default:
      printHelp();
      process.exit(command === 'help' ? 0 : 1);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const [command = 'help', ...rest] = argv;
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }

  return { command, options };
}

function stringOpt(options: Record<string, string | boolean>, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredStringOpt(options: Record<string, string | boolean>, key: string): string {
  const value = stringOpt(options, key);
  if (!value) throw new Error(`Missing required option --${key}`);
  return value;
}

function providerOpt(value: string): CreativeProviderName {
  if (!CREATIVE_PROVIDER_NAMES.includes(value as CreativeProviderName)) {
    throw new Error(`--name must be one of: ${CREATIVE_PROVIDER_NAMES.join(', ')}`);
  }
  return value as CreativeProviderName;
}

function printHelp(): void {
  console.log(`Viral-Bench creative operations CLI

Commands:
  validate --job .ops/creative_jobs/incoming/scan_bike_001.json
  render --job .ops/creative_jobs/incoming/scan_bike_001.json
  provider --name browser_manual --job .ops/creative_jobs/incoming/scan_bike_001.json

Hard gates:
  - Paid generation requires ALLOW_PAID_GENERATION=true and job policy approval.
  - Browser UI workflows require ALLOW_BROWSER_UI=true and job policy approval.
  - Social publishing requires ALLOW_SOCIAL_PUBLISHING=true, job policy approval, and human approval.
  - Account automation and committed credentials are never allowed.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
