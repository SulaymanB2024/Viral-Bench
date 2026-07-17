import * as fs from 'node:fs';

import { mergeEnvWithFile } from './env-loader';
import {
  JOB_CONTENT_SOURCE_CATALOG,
  buildJobContentDiscoverySpecs,
  buildJobContentFeedPreflight,
  reanalyzeJobContentFeedReport,
  runJobContentFeed,
  validateJobContentFeedRequest,
  writeJobContentFeedReport,
} from './job-content-feed';

interface CliArgs {
  command: string;
  options: Record<string, string | boolean>;
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const effectiveEnv = mergeEnvWithFile(process.env, {
    envFile: stringOpt(options, 'env-file'),
    rootDir: process.cwd(),
  }).effective_env;

  switch (command) {
    case 'catalog':
      console.log(JSON.stringify(JOB_CONTENT_SOURCE_CATALOG, null, 2));
      return;

    case 'validate': {
      const request = loadRequest(requiredStringOpt(options, 'file'));
      console.log(JSON.stringify({ ok: true, feed_id: request.feed_id, external_calls_made: 0 }, null, 2));
      return;
    }

    case 'preflight': {
      const request = loadRawRequest(requiredStringOpt(options, 'file'));
      console.log(JSON.stringify(buildJobContentFeedPreflight(request, effectiveEnv), null, 2));
      return;
    }

    case 'plan': {
      const request = loadRawRequest(requiredStringOpt(options, 'file'));
      console.log(JSON.stringify({
        feed_id: validateJobContentFeedRequest(request).feed_id,
        specs: buildJobContentDiscoverySpecs(request, effectiveEnv),
        external_calls_made: 0,
      }, null, 2));
      return;
    }

    case 'probe': {
      const request = loadRawRequest(requiredStringOpt(options, 'file'));
      const outputPath = stringOpt(options, 'out')
        || `.semantic-artifacts/job-content/${validateJobContentFeedRequest(request).feed_id}.json`;
      const report = await runJobContentFeed(request, {
        outputPath,
        env: effectiveEnv,
      });
      console.log(JSON.stringify({
        ok: report.status !== 'failed',
        path: outputPath,
        status: report.status,
        item_count: report.items.length,
        provider_gap_count: report.provider_gaps.length,
        total_usage_usd: report.total_usage_usd,
        external_calls_made: report.external_calls_made,
        source_counts: report.source_summaries.map((source) => ({
          source_id: source.source_id,
          relation: source.relation,
          item_count: source.item_count,
        })),
        errors: report.errors,
      }, null, 2));
      return;
    }

    case 'reanalyze': {
      const filePath = requiredStringOpt(options, 'file');
      const outputPath = stringOpt(options, 'out') || filePath;
      const current = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Parameters<typeof reanalyzeJobContentFeedReport>[0];
      const report = reanalyzeJobContentFeedReport(current);
      writeJobContentFeedReport(outputPath, report);
      console.log(JSON.stringify({
        ok: true,
        path: outputPath,
        item_count: report.items.length,
        source_counts: report.source_summaries.map((source) => ({
          source_id: source.source_id,
          item_count: source.item_count,
        })),
        external_calls_made: 0,
      }, null, 2));
      return;
    }

    case 'help':
    default:
      printHelp();
      process.exit(command === 'help' ? 0 : 1);
  }
}

function loadRequest(filePath: string) {
  return validateJobContentFeedRequest(loadRawRequest(filePath));
}

function loadRawRequest(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function parseArgs(argv: string[]): CliArgs {
  const [command = 'help', ...rest] = argv;
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
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

function printHelp(): void {
  console.log(`Viral-Bench job-search content feed

Commands:
  catalog
  validate --file .ops/job_content_feeds/job_search_content_sources_20260716.json
  preflight --file .ops/job_content_feeds/job_search_content_sources_20260716.json --env-file .env
  plan --file .ops/job_content_feeds/job_search_content_sources_20260716.json --env-file .env
  probe --file .ops/job_content_feeds/job_search_content_sources_20260716.json --env-file .env
  reanalyze --file .semantic-artifacts/job-content/job-search-content-sources-20260716.json

Purpose:
  - Collects public short-video metadata from reviewed brand/founder profiles.
  - Uses a clearly labeled category proxy where no official social account is confirmed.
  - Classifies hooks, topics, formats, CTAs, claim flags, and observed metrics.
  - Does not download competitor media or treat observed performance as causal proof.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
