import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ingestBrowserCapture,
  loadBrowserCapture,
} from './browser-capture';
import {
  createProviderRequestManifest,
  loadProviderRequestManifest,
  runProviderDryRun,
  runProviderLive,
  SUPPORTED_PROVIDER_NAMES,
  type ProviderName,
  type ProviderOutputKind,
} from './provider-workflow';
import {
  DEFAULT_TREND_DB_PATH,
  addTrendExample,
  generate_scan_content_brief,
  initTrendExamplesDb,
  renderContentBrief,
  research_trends,
  searchTrendExamples,
  type TrendExampleInput,
} from './trend-research';

interface CliArgs {
  command: string;
  options: Record<string, string | boolean>;
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const dbPath = stringOpt(options, 'db') || DEFAULT_TREND_DB_PATH;

  switch (command) {
    case 'init': {
      initTrendExamplesDb(dbPath);
      console.log(JSON.stringify({ ok: true, dbPath }, null, 2));
      return;
    }

    case 'add': {
      const file = requiredStringOpt(options, 'file');
      const input = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<TrendExampleInput>;
      const id = addTrendExample(dbPath, withIntakeDefaults(input));
      console.log(JSON.stringify({ ok: true, dbPath, id }, null, 2));
      return;
    }

    case 'search': {
      const results = searchTrendExamples(dbPath, {
        niche: stringOpt(options, 'niche'),
        format: stringOpt(options, 'format'),
        platform: stringOpt(options, 'platform'),
        query: stringOpt(options, 'query'),
        limit: numberOpt(options, 'limit'),
      });
      console.log(JSON.stringify({ count: results.length, results }, null, 2));
      return;
    }

    case 'research': {
      const answer = research_trends(dbPath, {
        niche: stringOpt(options, 'niche'),
        format: stringOpt(options, 'format'),
        platform: stringOpt(options, 'platform'),
        query: stringOpt(options, 'query'),
        question: stringOpt(options, 'question'),
        minimum_examples: numberOpt(options, 'minimum-examples'),
      });
      console.log(JSON.stringify(answer, null, 2));
      return;
    }

    case 'brief': {
      const brief = generate_scan_content_brief(dbPath, {
        niche: requiredStringOpt(options, 'niche'),
        item: requiredStringOpt(options, 'item'),
        format: stringOpt(options, 'format') || 'slideshow',
        target_platform: stringOpt(options, 'platform') || 'TikTok',
        minimum_examples: numberOpt(options, 'minimum-examples'),
      });

      const outDir = stringOpt(options, 'out');
      if (brief.status === 'ok' && outDir) {
        const render = await renderContentBrief(brief, outDir);
        console.log(JSON.stringify({ brief, render }, null, 2));
        return;
      }

      console.log(JSON.stringify(brief, null, 2));
      return;
    }

    case 'schema': {
      const schemaPath = path.join(__dirname, '..', 'schemas', 'trend-example.schema.json');
      console.log(fs.readFileSync(schemaPath, 'utf8'));
      return;
    }

    case 'provider:create-request': {
      const provider = providerNameOpt(requiredStringOpt(options, 'provider'));
      const jobId = requiredStringOpt(options, 'job-id');
      const request = createProviderRequestManifest({
        request_id: stringOpt(options, 'request-id') || `${jobId}-${provider}-request`,
        provider,
        job_id: jobId,
        prompt_path: requiredStringOpt(options, 'prompt-path'),
        input_assets: stringListOpt(options, 'input-assets'),
        output_requirements: {
          package_subdir: stringOpt(options, 'package-subdir') || `provider_outputs/${provider}`,
          files: [
            {
              path: stringOpt(options, 'output-file') || 'dry_run_notes.md',
              kind: outputKindOpt(stringOpt(options, 'output-kind') || 'text'),
              description: stringOpt(options, 'output-description') || 'Provider dry-run notes.',
            },
          ],
          notes: [stringOpt(options, 'notes') || 'Dry-run provider request. No external calls are made by default.'],
        },
        cost_policy: {
          allow_paid_generation: booleanOpt(options, 'allow-paid-generation'),
          allow_browser_ui: booleanOpt(options, 'allow-browser-ui'),
          external_calls_allowed: false,
          max_cost_usd: numberOpt(options, 'max-cost-usd') ?? 0,
          currency: 'USD',
          notes: [stringOpt(options, 'cost-notes') || 'External calls stay blocked unless environment gates are explicitly enabled.'],
        },
      });
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(request, null, 2)}\n`);
        console.log(JSON.stringify({ ok: true, path: outPath, request_id: request.request_id }, null, 2));
        return;
      }
      console.log(JSON.stringify(request, null, 2));
      return;
    }

    case 'provider:validate-request': {
      const file = requiredStringOpt(options, 'file');
      const request = loadProviderRequestManifest(file);
      console.log(JSON.stringify({ ok: true, request_id: request.request_id, provider: request.provider }, null, 2));
      return;
    }

    case 'provider:run-dry': {
      const file = requiredStringOpt(options, 'file');
      const request = loadProviderRequestManifest(file);
      const result = runProviderDryRun(request);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'provider:run-live': {
      const file = requiredStringOpt(options, 'file');
      const request = loadProviderRequestManifest(file);
      const result = await runProviderLive(request, {
        packageDir: requiredStringOpt(options, 'package-dir'),
        rootDir: stringOpt(options, 'root') || process.cwd(),
        overwrite: booleanOpt(options, 'overwrite'),
        model: stringOpt(options, 'model'),
        size: stringOpt(options, 'size'),
        quality: stringOpt(options, 'quality'),
        outputFormat: imageOutputFormatOpt(stringOpt(options, 'output-format')),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'browser:validate-capture': {
      const file = requiredStringOpt(options, 'file');
      const capture = loadBrowserCapture(file);
      console.log(JSON.stringify({ ok: true, capture_id: capture.capture_id, human_review_status: capture.human_review_status }, null, 2));
      return;
    }

    case 'browser:ingest-capture': {
      const file = requiredStringOpt(options, 'file');
      const capture = loadBrowserCapture(file);
      const id = ingestBrowserCapture(dbPath, capture);
      console.log(JSON.stringify({ ok: true, dbPath, id }, null, 2));
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

function withIntakeDefaults(input: Partial<TrendExampleInput>): TrendExampleInput {
  return {
    id: input.id || `manual-${Date.now()}`,
    source_url: input.source_url || '',
    source_name: input.source_name || 'TikTok Creative Center',
    captured_at: input.captured_at || new Date().toISOString(),
    niche: input.niche || '',
    platform: input.platform || 'TikTok',
    format: input.format || 'slideshow',
    hook: input.hook || '',
    caption: input.caption || '',
    observed_metrics: input.observed_metrics || {},
    visual_structure: input.visual_structure || [],
    CTA: input.CTA || '',
    why_it_works: input.why_it_works || [],
    remake_notes: input.remake_notes || '',
  };
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

function numberOpt(options: Record<string, string | boolean>, key: string): number | undefined {
  const value = stringOpt(options, key);
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`--${key} must be a number`);
  return number;
}

function booleanOpt(options: Record<string, string | boolean>, key: string): boolean {
  return options[key] === true || stringOpt(options, key)?.toLowerCase() === 'true';
}

function stringListOpt(options: Record<string, string | boolean>, key: string): string[] {
  const value = stringOpt(options, key);
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function providerNameOpt(value: string): ProviderName {
  if (!SUPPORTED_PROVIDER_NAMES.includes(value as ProviderName)) {
    throw new Error(`--provider must be one of: ${SUPPORTED_PROVIDER_NAMES.join(', ')}`);
  }
  return value as ProviderName;
}

function outputKindOpt(value: string): ProviderOutputKind {
  const allowed: ProviderOutputKind[] = ['image', 'video', 'text', 'qa', 'manifest', 'research'];
  if (!allowed.includes(value as ProviderOutputKind)) {
    throw new Error(`--output-kind must be one of: ${allowed.join(', ')}`);
  }
  return value as ProviderOutputKind;
}

function imageOutputFormatOpt(value: string | undefined): 'png' | 'jpeg' | 'webp' | undefined {
  if (!value) return undefined;
  const allowed = ['png', 'jpeg', 'webp'] as const;
  if (!allowed.includes(value as typeof allowed[number])) {
    throw new Error(`--output-format must be one of: ${allowed.join(', ')}`);
  }
  return value as typeof allowed[number];
}

function printHelp(): void {
  console.log(`Viral-Bench trend research CLI

Commands:
  init --db trend_examples.sqlite
  add --file example.json --db trend_examples.sqlite
  search --niche "used bikes" --format slideshow --query "scan"
  research --niche "used bikes" --format slideshow
  brief --niche "used bikes" --item "used commuter bike" --out trend_outputs/bike
  browser:validate-capture --file .ops/browser/samples/creative_center_bike_capture.json
  browser:ingest-capture --file .ops/browser/samples/creative_center_bike_capture.json --db trend_examples.sqlite
  provider:create-request --provider openai_image --job-id scan_bike_001 --prompt-path .ops/prompts/openai/image_generation.md
  provider:validate-request --file .ops/provider_requests/sample_openai_image_request.json
  provider:run-dry --file .ops/provider_requests/sample_openai_image_request.json
  provider:run-live --file .ops/provider_requests/<live_request>.json --package-dir .ops/creative_jobs/rendered/<job_id>
  schema

Notes:
  - Intake is manual. Save Creative Center observations to JSON, then run add.
  - Provider live calls are blocked unless request policy, environment gates, and credentials are all present.
  - No Lightreel, OpenRouter, Gemini, ScrapeCreators, Apify, TikTok scraping, or posting is used by default.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
