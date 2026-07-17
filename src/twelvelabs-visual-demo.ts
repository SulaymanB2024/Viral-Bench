import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  atomicWriteFile,
  atomicWriteJson,
  describeArtifact,
  hashFile,
  type ArtifactDescriptor,
} from './artifact-integrity';
import {
  classifyEnglishEvidence,
  type EnglishEvidence,
} from './content-language';
import type { InternshipResearchSynthesis } from './internship-research-synthesis';
import { buildTwelveLabsDashboardHtml } from './twelvelabs-dashboard-template';

interface DeepRecord {
  candidate_id: string;
  platform: string;
  platform_post_id: string;
  canonical_url: string;
  cohort: {
    rank: number;
    success_percentile: number;
    complexity_score: number;
  };
  strategy: {
    data: {
      opening: {
        start_sec: number;
        end_sec: number;
        observed_words: string;
        observed_visual: string;
        mechanism: string;
      };
      content_arc: {
        audience_problem: string;
        progression: string;
        payoff: string;
      };
      cta: {
        observed_words: string;
        requested_action: string;
      };
      claims: Array<{ observed_claim: string; evidence_status: string }>;
      transferable_structure: {
        hook_pattern: string;
        beat_pattern: string;
        payoff_pattern: string;
      };
      evidence_limitations: string[];
    };
  };
  segmentation: {
    segments: Record<string, Array<{
      start_time: number;
      end_time: number;
      metadata: Record<string, unknown>;
    }>>;
  };
  quality: {
    passed: boolean;
    visual_coverage_ratio: number;
    max_visual_gap_sec: number;
    definition_counts: Record<string, number>;
  };
  retry_performed: boolean;
  usage_pricing_estimate_usd: number | null;
  input_fingerprint?: {
    fingerprint_sha256: string;
  };
}

interface MediaManifest {
  batch_id?: string;
  generated_at?: string;
  rows: Array<{
    candidate_id: string;
    media_path: string | null;
    duration_sec: number | null;
    media_sha256?: string | null;
    byte_size?: number | null;
  }>;
}

interface SelectionLedger {
  generated_at: string;
  entries: Array<{
    candidate_id: string;
    account_handle: string;
    source_group: string;
    posted_at: string | null;
    metrics: {
      views: number | null;
      likes: number | null;
      comments: number | null;
      shares: number | null;
      saves: number | null;
    };
  }>;
}

interface ResearchManifest {
  collection: {
    profiles: Array<{
      company: string;
      platform: string;
      locator: string;
      identity_status: string;
    }>;
  };
}

interface PaidEvidence {
  label: 'Paid/ad flag observed' | 'Not marked paid' | 'Unknown';
  state: 'paid_flag_observed' | 'not_marked_paid' | 'unknown';
  basis: string;
}

export interface DemoRecord extends DeepRecord {
  media_src: string;
  duration_sec: number;
  account_handle: string;
  source_group: string;
  posted_at: string | null;
  metric_snapshot_at: string;
  metrics: SelectionLedger['entries'][number]['metrics'];
  language: EnglishEvidence;
  company: {
    name: string | null;
    basis: string;
  };
  paid: PaidEvidence;
}

const repoRoot = path.resolve(__dirname, '..');
const mediaManifestPath = path.join(
  repoRoot,
  '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-media.json',
);
const selectionLedgerPath = path.join(
  repoRoot,
  '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-selection.json',
);
const researchManifestPath = path.join(
  repoRoot,
  '.ops/competitor_research/internship-us-content-expansion-20260716.json',
);
const researchExpansionPath = path.join(
  repoRoot,
  '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-expansion.json',
);

export interface DashboardGenerationOptions {
  analysisDir?: string;
  outputPath?: string;
  mediaOutputDir?: string;
  mediaPublicBase?: string;
  preserveExistingMedia?: boolean;
  siteNavigation?: boolean;
  mediaManifestPath?: string;
  selectionLedgerPath?: string;
  researchManifestPath?: string;
  researchExpansionPath?: string;
  now?: () => Date;
}

export interface DashboardGenerationResult {
  output_path: string;
  data_path: string;
  manifest_path: string;
  english_records: number;
  analyzed_records: number;
  excluded_non_english: number;
  join_failures: number;
  external_calls_made: 0;
}

export interface DashboardSnapshot {
  schema_version: 'twelvelabs_dashboard_snapshot_v1';
  dashboard_kind: 'competitor_creative_research';
  owned_marketing_data_state: 'not_connected';
  generated_at: string;
  metric_snapshot_at: string;
  analyzed_count: number;
  excluded_non_english: number;
  join_reconciliation: {
    analyzed_records: number;
    rendered_records: number;
    excluded_non_english: number;
    failures: Array<{ candidate_id: string; reason: string }>;
  };
  research_synthesis: InternshipResearchSynthesis | null;
  records: DemoRecord[];
}

export interface DashboardIntegrityManifest {
  schema_version: 'twelvelabs_dashboard_manifest_v1';
  dashboard_kind: 'competitor_creative_research';
  owned_marketing_data_state: 'not_connected';
  generated_at: string;
  sources: {
    media_manifest: ArtifactDescriptor;
    selection_ledger: ArtifactDescriptor;
    research_manifest: ArtifactDescriptor;
    research_expansion: ArtifactDescriptor | null;
    deep_analysis_records: ArtifactDescriptor[];
  };
  reconciliation: DashboardSnapshot['join_reconciliation'];
  analysis_cache: {
    fingerprinted_records: number;
    legacy_unfingerprinted_records: number;
    reuse_policy: 'exact_fingerprint_and_quality_gate_required';
  };
  media_assets: Array<{
    candidate_id: string;
    source: ArtifactDescriptor;
    output_path: string;
    output_sha256: string;
    bytes: number;
  }>;
  outputs: {
    html_path: string;
    data_path: string;
  };
  evidence_boundaries: string[];
}

export function generateTwelveLabsDashboard(
  options: DashboardGenerationOptions = {},
): DashboardGenerationResult {
  const analysisDir = path.resolve(
    options.analysisDir ?? path.join(
      repoRoot,
      '.semantic-artifacts/competitor-content/analysis/internship-us-20260716-deep-v1',
    ),
  );
  const outputPath = path.resolve(
    options.outputPath ?? path.join(
      repoRoot,
      '.semantic-artifacts/competitor-content/demos/twelvelabs-deep-visual-demo.html',
    ),
  );
  const resolvedMediaManifestPath = path.resolve(options.mediaManifestPath ?? mediaManifestPath);
  const resolvedSelectionLedgerPath = path.resolve(options.selectionLedgerPath ?? selectionLedgerPath);
  const resolvedResearchManifestPath = path.resolve(options.researchManifestPath ?? researchManifestPath);
  const resolvedResearchExpansionPath = path.resolve(options.researchExpansionPath ?? researchExpansionPath);
  const mediaManifest = read<MediaManifest>(resolvedMediaManifestPath);
  const selectionLedger = read<SelectionLedger>(resolvedSelectionLedgerPath);
  const researchManifest = read<ResearchManifest>(resolvedResearchManifestPath);
  const researchSynthesis = fs.existsSync(resolvedResearchExpansionPath)
    ? read<{ research_synthesis?: InternshipResearchSynthesis }>(resolvedResearchExpansionPath).research_synthesis ?? null
    : null;
  const mediaById = uniqueByCandidateId(mediaManifest.rows, 'media manifest');
  const selectionById = uniqueByCandidateId(selectionLedger.entries, 'selection ledger');
  const deepFiles = fs.readdirSync(analysisDir)
    .filter((name) => name.endsWith('-deep.json'))
    .map((name) => path.join(analysisDir, name))
    .sort();
  const deepRecords = deepFiles
    .map((file) => read<DeepRecord>(file))
    .sort((left, right) => left.cohort.rank - right.cohort.rank);
  const paidByPostId = collectPaidEvidence(
    repoRoot,
    new Set(deepRecords.map((record) => record.platform_post_id)),
  );
  const failures: Array<{ candidate_id: string; reason: string }> = [];
  const excludedNonEnglish: string[] = [];
  const mediaAssets: DashboardIntegrityManifest['media_assets'] = [];
  const records = deepRecords.flatMap((record): DemoRecord[] => {
    const media = mediaById.get(record.candidate_id);
    const selection = selectionById.get(record.candidate_id);
    if (!selection) {
      failures.push({ candidate_id: record.candidate_id, reason: 'selection ledger row missing' });
      return [];
    }
    if (!record.quality?.passed) {
      failures.push({ candidate_id: record.candidate_id, reason: 'deep-analysis quality gate not passed' });
      return [];
    }
    const language = classifyEnglishEvidence(
      segmentText(record, 'audio_beats', 'speech_exact'),
      segmentText(record, 'visual_shots', 'on_screen_text_exact'),
    );
    if (!language.is_english) {
      excludedNonEnglish.push(record.candidate_id);
      return [];
    }
    if (!media) {
      failures.push({ candidate_id: record.candidate_id, reason: 'media manifest row missing' });
      return [];
    }
    if (!media.media_path) {
      failures.push({ candidate_id: record.candidate_id, reason: 'media path missing' });
      return [];
    }
    if (!(media.duration_sec && media.duration_sec > 0)) {
      failures.push({ candidate_id: record.candidate_id, reason: 'positive media duration missing' });
      return [];
    }
    const sourceMediaPath = path.resolve(repoRoot, media.media_path);
    if (!fs.existsSync(sourceMediaPath) || !fs.statSync(sourceMediaPath).isFile()) {
      failures.push({ candidate_id: record.candidate_id, reason: 'source media file missing' });
      return [];
    }
    const sourceMedia = describeArtifact(sourceMediaPath, repoRoot);
    if (media.media_sha256 && sourceMedia.sha256 !== media.media_sha256) {
      failures.push({ candidate_id: record.candidate_id, reason: 'source media SHA-256 differs from manifest' });
      return [];
    }
    if (media.byte_size !== null && media.byte_size !== undefined && sourceMedia.bytes !== media.byte_size) {
      failures.push({ candidate_id: record.candidate_id, reason: 'source media byte size differs from manifest' });
      return [];
    }
    const mediaFileName = `${record.platform}-${record.platform_post_id}${path.extname(sourceMediaPath) || '.mp4'}`;
    let mediaSrc = path.relative(path.dirname(outputPath), sourceMediaPath);
    let outputMediaPath = sourceMediaPath;
    if (options.mediaOutputDir) {
      const mediaOutputDir = path.resolve(options.mediaOutputDir);
      const mediaOutputPath = path.join(mediaOutputDir, mediaFileName);
      fs.mkdirSync(mediaOutputDir, { recursive: true });
      const outputIsCurrent = fs.existsSync(mediaOutputPath)
        && hashFile(mediaOutputPath) === sourceMedia.sha256;
      if (!options.preserveExistingMedia || !outputIsCurrent) {
        atomicWriteFile(mediaOutputPath, fs.readFileSync(sourceMediaPath));
      }
      outputMediaPath = mediaOutputPath;
      const publicBase = (options.mediaPublicBase ?? './media').replace(/\/+$/, '');
      mediaSrc = `${publicBase}/${mediaFileName}`;
    }
    const copiedMedia = describeArtifact(outputMediaPath, path.dirname(outputPath));
    mediaAssets.push({
      candidate_id: record.candidate_id,
      source: sourceMedia,
      output_path: copiedMedia.path,
      output_sha256: copiedMedia.sha256,
      bytes: copiedMedia.bytes,
    });
    const company = findCompany(
      researchManifest.collection.profiles,
      record.platform,
      selection.account_handle,
    );
    return [{
      ...record,
      media_src: mediaSrc,
      duration_sec: media.duration_sec,
      account_handle: selection.account_handle,
      source_group: selection.source_group,
      posted_at: selection.posted_at,
      metric_snapshot_at: selectionLedger.generated_at,
      metrics: selection.metrics,
      language,
      company,
      paid: paidByPostId.get(record.platform_post_id) ?? unknownPaidEvidence(),
    }];
  });

  if (failures.length) {
    throw new Error(`Dashboard reconciliation failed: ${failures.map((failure) => (
      `${failure.candidate_id}: ${failure.reason}`
    )).join('; ')}`);
  }
  if (!records.length) throw new Error('No English deep-analysis records are available for the visual demo.');
  const reconciliation: DashboardSnapshot['join_reconciliation'] = {
    analyzed_records: deepRecords.length,
    rendered_records: records.length,
    excluded_non_english: excludedNonEnglish.length,
    failures,
  };
  const snapshot: DashboardSnapshot = {
    schema_version: 'twelvelabs_dashboard_snapshot_v1',
    dashboard_kind: 'competitor_creative_research',
    owned_marketing_data_state: 'not_connected',
    generated_at: (options.now?.() ?? new Date()).toISOString(),
    metric_snapshot_at: selectionLedger.generated_at,
    analyzed_count: deepRecords.length,
    excluded_non_english: excludedNonEnglish.length,
    join_reconciliation: reconciliation,
    research_synthesis: researchSynthesis,
    records,
  };
  const dataPath = path.join(path.dirname(outputPath), 'twelvelabs-dashboard-data.js');
  const integrityManifestPath = path.join(path.dirname(outputPath), 'twelvelabs-dashboard-manifest.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  atomicWriteFile(outputPath, buildHtml(snapshot, options.siteNavigation));
  atomicWriteFile(dataPath, buildDashboardDataScript(snapshot));
  const integrityManifest: DashboardIntegrityManifest = {
    schema_version: 'twelvelabs_dashboard_manifest_v1',
    dashboard_kind: 'competitor_creative_research',
    owned_marketing_data_state: 'not_connected',
    generated_at: snapshot.generated_at,
    sources: {
      media_manifest: describeArtifact(resolvedMediaManifestPath, repoRoot),
      selection_ledger: describeArtifact(resolvedSelectionLedgerPath, repoRoot),
      research_manifest: describeArtifact(resolvedResearchManifestPath, repoRoot),
      research_expansion: fs.existsSync(resolvedResearchExpansionPath)
        ? describeArtifact(resolvedResearchExpansionPath, repoRoot)
        : null,
      deep_analysis_records: deepFiles.map((file) => describeArtifact(file, repoRoot)),
    },
    reconciliation,
    analysis_cache: {
      fingerprinted_records: deepRecords.filter((record) => Boolean(
        record.input_fingerprint?.fingerprint_sha256,
      )).length,
      legacy_unfingerprinted_records: deepRecords.filter((record) => !(
        record.input_fingerprint?.fingerprint_sha256
      )).length,
      reuse_policy: 'exact_fingerprint_and_quality_gate_required',
    },
    media_assets: mediaAssets,
    outputs: {
      html_path: path.relative(repoRoot, outputPath),
      data_path: path.relative(repoRoot, dataPath),
    },
    evidence_boundaries: [
      'This artifact is competitor creative research, not owned marketing performance.',
      'No owned campaign, spend, click, lead, application, or conversion facts are connected.',
      'Non-English exclusions are counted only when the language evidence gate classifies a record as non-English.',
      'Missing joins, missing media, and integrity mismatches fail the build.',
      'Legacy deep-analysis records remain visible as historical evidence but are never eligible for cache reuse without an exact input fingerprint.',
    ],
  };
  atomicWriteJson(integrityManifestPath, integrityManifest);
  return {
    output_path: path.relative(repoRoot, outputPath),
    data_path: path.relative(repoRoot, dataPath),
    manifest_path: path.relative(repoRoot, integrityManifestPath),
    english_records: records.length,
    analyzed_records: deepRecords.length,
    excluded_non_english: excludedNonEnglish.length,
    join_failures: failures.length,
    external_calls_made: 0 as const,
  };
}

function main(): void {
  const result = generateTwelveLabsDashboard({
    analysisDir: process.argv[2],
    outputPath: process.argv[3],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function buildDashboardDataScript(snapshot: DashboardSnapshot): string {
  const serialized = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  return `window.__TWELVELABS_DASHBOARD_SNAPSHOT__ = ${serialized};
window.dispatchEvent(new CustomEvent('twelvelabs-dashboard-snapshot', {
  detail: window.__TWELVELABS_DASHBOARD_SNAPSHOT__
}));
`;
}

function buildHtml(snapshot: DashboardSnapshot, siteNavigation = false): string {
  return buildTwelveLabsDashboardHtml(snapshot, { siteNavigation });
}

function buildLegacyHtml(data: DemoRecord[], analyzedCount: number): string {
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TwelveLabs Deep Analysis</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0d0c;
      --surface: #111411;
      --surface-2: #161a16;
      --line: #2a3029;
      --line-soft: #20251f;
      --text: #f0f2e9;
      --muted: #92998f;
      --dim: #626960;
      --lime: #d6ff4b;
      --cyan: #5fd6cf;
      --violet: #ad8cff;
      --amber: #ffbb57;
      --danger: #ff726f;
      --radius: 12px;
      --ui: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono: "SFMono-Regular", "Roboto Mono", Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: var(--ui); }
    body { overflow-x: hidden; }
    button, a { font: inherit; }
    button { color: inherit; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 224px minmax(0, 1fr) 340px; grid-template-rows: 68px minmax(0, 1fr); }
    .topbar { grid-column: 1 / -1; display: flex; align-items: center; gap: 24px; padding: 0 24px; border-bottom: 1px solid var(--line); background: rgba(11,13,12,.96); position: sticky; top: 0; z-index: 10; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 200px; }
    .brand-mark { width: 22px; height: 22px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; transform: rotate(-6deg); }
    .brand-mark span { background: var(--lime); border-radius: 1px; }
    .brand-mark span:nth-child(2) { opacity: .72; }
    .brand-mark span:nth-child(3) { opacity: .42; }
    .brand-name { font-size: 14px; font-weight: 720; letter-spacing: -.02em; }
    .top-title { flex: 1; font-size: 13px; color: var(--muted); }
    .top-title strong { color: var(--text); font-weight: 620; }
    .run-state { display: flex; align-items: center; gap: 9px; color: var(--muted); font: 11px/1 var(--mono); letter-spacing: .04em; text-transform: uppercase; }
    .run-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 4px rgba(214,255,75,.08); }
    .sources { grid-column: 1; grid-row: 2; border-right: 1px solid var(--line); padding: 18px 12px; background: #0d100e; }
    .rail-heading { margin: 0 10px 14px; color: var(--dim); font: 10px/1.2 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
    .source { width: 100%; display: grid; grid-template-columns: 29px minmax(0, 1fr); gap: 9px; align-items: center; padding: 11px 9px; border: 0; border-left: 2px solid transparent; border-radius: 0 7px 7px 0; background: transparent; text-align: left; cursor: pointer; transition: background 160ms ease, border-color 160ms ease; }
    .source:hover { background: var(--surface); }
    .source.active { background: var(--surface-2); border-left-color: var(--lime); }
    .source-rank { color: var(--dim); font: 11px/1 var(--mono); }
    .source.active .source-rank { color: var(--lime); }
    .source-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 620; }
    .source-meta { margin-top: 4px; color: var(--dim); font: 10px/1.2 var(--mono); }
    .workspace { grid-column: 2; grid-row: 2; min-width: 0; padding: 22px 24px 32px; overflow: auto; }
    .hero { display: grid; grid-template-columns: minmax(230px, 300px) minmax(320px, 1fr); gap: 26px; align-items: start; }
    .video-frame { position: relative; background: #000; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; aspect-ratio: 9 / 16; max-height: 54vh; justify-self: center; box-shadow: 0 24px 70px rgba(0,0,0,.32); }
    video { display: block; width: 100%; height: 100%; object-fit: cover; background: #000; }
    .rank-flag { position: absolute; top: 10px; left: 10px; padding: 6px 8px; border-radius: 5px; background: rgba(11,13,12,.84); backdrop-filter: blur(8px); color: var(--lime); font: 10px/1 var(--mono); pointer-events: none; }
    .narrative { padding-top: 4px; }
    .narrative h1 { margin: 0; max-width: 730px; font-size: clamp(28px, 3.3vw, 50px); line-height: 1.03; letter-spacing: -.045em; font-weight: 660; text-wrap: balance; }
    .identity-line { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 17px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .identity-company { color: var(--text); }
    .identity-language { color: var(--lime); font-family: var(--mono); font-size: 11px; text-transform: uppercase; }
    .identity-paid { color: var(--muted); font-family: var(--mono); font-size: 11px; text-transform: uppercase; }
    .identity-paid.paid { color: var(--amber); }
    .identity-paid.clear { color: var(--lime); }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--line); }
    .metric-value { font: 19px/1 var(--mono); }
    .metric-value.good { color: var(--lime); }
    .metric-value.missing { color: var(--dim); }
    .metric-label { margin-top: 7px; color: var(--dim); font: 9px/1.2 var(--mono); letter-spacing: .09em; text-transform: uppercase; }
    .metric-note { grid-column: 1 / -1; margin-top: 2px; color: var(--dim); font: 9px/1.45 var(--mono); }
    .now-inspecting { margin-top: 28px; padding: 17px 0 0; border-top: 1px solid var(--line-soft); }
    .inspect-label { color: var(--dim); font: 9px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
    .inspect-time { margin-left: 8px; color: var(--lime); }
    .inspect-copy { margin-top: 9px; color: var(--text); font-size: 13px; line-height: 1.52; }
    .timeline { margin-top: 28px; padding-top: 21px; border-top: 1px solid var(--line); }
    .timeline-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
    .timeline-head h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
    .timeline-head p { margin: 0; color: var(--dim); font: 10px/1.3 var(--mono); }
    .axis { position: relative; height: 18px; margin-left: 76px; border-bottom: 1px solid var(--line-soft); }
    .tick { position: absolute; bottom: 3px; color: var(--dim); font: 8px/1 var(--mono); transform: translateX(-50%); }
    .lane { display: grid; grid-template-columns: 68px minmax(0, 1fr); gap: 8px; margin-top: 12px; align-items: center; }
    .lane-label { color: var(--muted); font: 9px/1 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
    .lane-track { position: relative; height: 34px; background: #0e110f; border: 1px solid var(--line-soft); overflow: hidden; }
    .segment { position: absolute; top: 3px; bottom: 3px; min-width: 3px; border: 0; border-right: 1px solid rgba(11,13,12,.55); cursor: pointer; opacity: .78; transition: opacity 120ms ease, transform 120ms ease, filter 120ms ease; }
    .segment:hover, .segment.active { opacity: 1; filter: brightness(1.14); transform: translateY(-1px); }
    .segment.visual { background: var(--cyan); }
    .segment.audio { background: var(--violet); }
    .segment.editing { background: var(--amber); }
    .playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--lime); z-index: 5; pointer-events: none; box-shadow: 0 0 8px rgba(214,255,75,.8); }
    .inspector { grid-column: 3; grid-row: 2; border-left: 1px solid var(--line); padding: 22px 22px 32px; background: #0d100e; overflow: auto; }
    .inspector h2 { margin: 0; font-size: 15px; letter-spacing: -.015em; }
    .structure { margin-top: 18px; }
    .structure-row { padding: 14px 0; border-top: 1px solid var(--line-soft); }
    .structure-label { color: var(--dim); font: 9px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
    .structure-copy { margin-top: 7px; color: #d6dad1; font-size: 12px; line-height: 1.5; }
    .cta { color: var(--lime); }
    .claims { margin-top: 20px; }
    .claim { padding: 11px 0 11px 13px; border-left: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.45; }
    .claim + .claim { margin-top: 8px; }
    .claim-status { display: block; margin-top: 5px; color: var(--dim); font: 8px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .source-link { display: inline-flex; margin-top: 22px; color: var(--text); text-decoration: none; border-bottom: 1px solid var(--lime); font-size: 11px; padding-bottom: 3px; }
    .empty-note { color: var(--muted); font-size: 12px; }
    .context-value { margin-top: 7px; color: #d6dad1; font-size: 12px; line-height: 1.5; }
    .context-value.paid { color: var(--amber); }
    .context-value.clear { color: var(--lime); }
    .context-basis { display: block; margin-top: 4px; color: var(--dim); font: 9px/1.4 var(--mono); }
    .inspector-section { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--line); }
    @media (max-width: 1080px) {
      .app { grid-template-columns: 184px minmax(0, 1fr); }
      .inspector { grid-column: 2; grid-row: 3; border-left: 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: 180px 1fr; gap: 24px; }
      .structure { margin-top: 0; }
    }
    @media (max-width: 760px) {
      .app { display: block; }
      .topbar { height: 62px; padding: 0 16px; }
      .top-title { display: none; }
      .run-state { margin-left: auto; }
      .sources { border-right: 0; border-bottom: 1px solid var(--line); display: block; overflow: hidden; padding: 10px; }
      .rail-heading { display: none; }
      #sourceList { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
      #sourceList::-webkit-scrollbar { display: none; }
      .source { min-width: 168px; }
      .workspace { padding: 18px 16px 26px; }
      .hero { grid-template-columns: 116px minmax(0, 1fr); gap: 16px; }
      .video-frame { max-height: 38vh; border-radius: 8px; }
      .narrative h1 { font-size: 24px; }
      .mechanism { font-size: 12px; margin-top: 12px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; padding-top: 14px; }
      .metric-value { font-size: 14px; }
      .now-inspecting { margin-top: 16px; }
      .axis { margin-left: 58px; }
      .lane { grid-template-columns: 50px minmax(0, 1fr); }
      .inspector { display: block; padding: 20px 16px 30px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span class="brand-name">TwelveLabs</span></div>
      <div class="top-title"><strong>English content</strong> / performance &amp; attribution</div>
      <div class="run-state"><span class="run-dot"></span><span id="runCount">${data.length} English / ${analyzedCount} analyzed</span></div>
    </header>
    <nav class="sources" aria-label="Analyzed videos">
      <p class="rail-heading">Analyzed</p>
      <div id="sourceList"></div>
    </nav>
    <section class="workspace">
      <div class="hero">
        <div class="video-frame">
          <video id="video" controls playsinline preload="metadata"></video>
          <div class="rank-flag" id="rankFlag"></div>
        </div>
        <div class="narrative">
          <h1 id="headline"></h1>
          <div class="identity-line">
            <span class="identity-company" id="identityCompany"></span>
            <span id="identityAccount"></span>
            <span class="identity-language">English</span>
            <span class="identity-paid" id="identityPaid"></span>
          </div>
          <div class="metrics" id="metrics"></div>
          <div class="now-inspecting">
            <div class="inspect-label">Now inspecting <span class="inspect-time" id="inspectTime"></span></div>
            <div class="inspect-copy" id="inspectCopy">Select a segment.</div>
          </div>
        </div>
      </div>
      <section class="timeline" aria-label="Timestamped evidence">
        <div class="timeline-head">
          <h2>Timeline</h2>
          <p>Select a block to seek.</p>
        </div>
        <div class="axis" id="axis"></div>
        <div id="lanes"></div>
      </section>
    </section>
    <aside class="inspector">
      <div>
        <h2>Performance context</h2>
        <p class="empty-note">Observed counters and source-level attribution.</p>
      </div>
      <div>
        <div class="structure" id="context"></div>
        <section class="inspector-section">
          <h2>Structure</h2>
          <p class="empty-note">Observed mechanics.</p>
          <div class="structure" id="structure"></div>
          <div class="claims" id="claims"></div>
          <a class="source-link" id="sourceLink" target="_blank" rel="noreferrer">Open public source</a>
        </section>
      </div>
    </aside>
  </main>
  <script>
    const records = ${serialized};
    const laneSpecs = [
      { id: 'visual_shots', label: 'Visual', className: 'visual' },
      { id: 'audio_beats', label: 'Audio', className: 'audio' },
      { id: 'editing_beats', label: 'Editing', className: 'editing' },
    ];
    const sourceList = document.querySelector('#sourceList');
    const video = document.querySelector('#video');
    const lanes = document.querySelector('#lanes');
    const playheads = [];
    let activeIndex = 0;
    let activeSegment = null;

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
    const time = (seconds) => seconds < 60
      ? seconds.toFixed(seconds % 1 ? 1 : 0) + 's'
      : Math.floor(seconds / 60) + ':' + String(Math.round(seconds % 60)).padStart(2, '0');
    const firstMetadata = (metadata) => Object.values(metadata ?? {}).filter(Boolean).join(' · ');
    const compactNumber = (value) => {
      if (value === null || value === undefined) return '—';
      return new Intl.NumberFormat('en-US', {
        notation: value >= 10000 ? 'compact' : 'standard',
        maximumFractionDigits: value >= 1000000 ? 1 : 0,
      }).format(value);
    };
    const fullNumber = (value) => value === null || value === undefined
      ? 'Not returned by source'
      : new Intl.NumberFormat('en-US').format(value);
    const date = (value) => value
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
      : 'Unknown';
    const companyLabel = (record) => record.company.name ?? 'No company identified';
    const headline = (value) => {
      const copy = String(value ?? '').trim();
      if (copy.length <= 150) return copy;
      const firstSentence = copy.match(/^.{25,150}?[.!?](?:\\s|$)/)?.[0]?.trim();
      if (firstSentence) return firstSentence;
      return copy.slice(0, 147).replace(/\\s+\\S*$/, '') + '…';
    };

    function renderSources() {
      sourceList.innerHTML = records.map((record, index) => \`
        <button class="source \${index === activeIndex ? 'active' : ''}" data-index="\${index}">
          <span class="source-rank">\${String(record.cohort.rank).padStart(2, '0')}</span>
          <span>
            <span class="source-name">\${escapeHtml(record.company.name ?? '@' + record.account_handle)}</span>
            <span class="source-meta">\${escapeHtml(record.platform.replace('_', ' '))} · \${compactNumber(record.metrics.views)} views</span>
          </span>
        </button>
      \`).join('');
      sourceList.querySelectorAll('.source').forEach((button) => {
        button.addEventListener('click', () => selectRecord(Number(button.dataset.index)));
      });
      if (window.matchMedia('(max-width: 760px)').matches) {
        sourceList.querySelector('.source.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    function renderAxis(duration) {
      const ticks = duration > 90 ? 6 : 5;
      document.querySelector('#axis').innerHTML = Array.from({ length: ticks }, (_, index) => {
        const pct = (index / (ticks - 1)) * 100;
        return \`<span class="tick" style="left:\${pct}%">\${time(duration * index / (ticks - 1))}</span>\`;
      }).join('');
    }

    function renderLanes(record) {
      playheads.length = 0;
      lanes.innerHTML = laneSpecs.map((lane) => {
        const segments = record.segmentation.segments[lane.id] ?? [];
        const blocks = segments.map((segment, index) => {
          const left = (segment.start_time / record.duration_sec) * 100;
          const width = ((segment.end_time - segment.start_time) / record.duration_sec) * 100;
          return \`<button class="segment \${lane.className}" data-lane="\${lane.id}" data-index="\${index}" title="\${escapeHtml(firstMetadata(segment.metadata))}" style="left:\${left}%;width:\${width}%"></button>\`;
        }).join('');
        return \`<div class="lane"><div class="lane-label">\${lane.label}</div><div class="lane-track">\${blocks}<span class="playhead"></span></div></div>\`;
      }).join('');
      lanes.querySelectorAll('.playhead').forEach((node) => playheads.push(node));
      lanes.querySelectorAll('.segment').forEach((button) => {
        button.addEventListener('click', () => inspectSegment(button.dataset.lane, Number(button.dataset.index), button));
      });
    }

    function renderStructure(record) {
      const strategy = record.strategy.data;
      const structure = strategy.transferable_structure;
      document.querySelector('#structure').innerHTML = [
        ['Hook pattern', structure.hook_pattern],
        ['Beat pattern', structure.beat_pattern],
        ['Payoff pattern', structure.payoff_pattern],
        ['Audience problem', strategy.content_arc.audience_problem],
        ['CTA', strategy.cta.requested_action],
      ].map(([label, copy]) => \`<div class="structure-row"><div class="structure-label">\${escapeHtml(label)}</div><div class="structure-copy \${label === 'CTA' ? 'cta' : ''}">\${escapeHtml(copy)}</div></div>\`).join('');
      document.querySelector('#claims').innerHTML = strategy.claims.length
        ? '<div class="structure-label">Observed claims</div>' + strategy.claims.map((claim) => \`<div class="claim">\${escapeHtml(claim.observed_claim)}<span class="claim-status">\${escapeHtml(claim.evidence_status)}</span></div>\`).join('')
        : '';
      const sourceLink = document.querySelector('#sourceLink');
      sourceLink.href = record.canonical_url;
    }

    function renderContext(record) {
      const paidClass = record.paid.state === 'paid_flag_observed'
        ? 'paid'
        : record.paid.state === 'not_marked_paid' ? 'clear' : '';
      const rows = [
        ['Language', 'English', 'TwelveLabs evidence: ' + record.language.basis.replaceAll('_', ' ') + '.', 'clear'],
        ['Company', companyLabel(record), record.company.basis, ''],
        ['Account', '@' + record.account_handle, record.source_group.replaceAll('_', ' '), ''],
        ['Paid status', record.paid.label, record.paid.basis, paidClass],
        ['Posted', date(record.posted_at), 'Platform publication date.', ''],
        ['Metrics captured', date(record.metric_snapshot_at), 'Observed snapshot; counters may change.', ''],
      ];
      document.querySelector('#context').innerHTML = rows.map(([label, value, basis, cls]) => \`
        <div class="structure-row">
          <div class="structure-label">\${escapeHtml(label)}</div>
          <div class="context-value \${cls}">\${escapeHtml(value)}<span class="context-basis">\${escapeHtml(basis)}</span></div>
        </div>
      \`).join('');
    }

    function selectRecord(index) {
      activeIndex = index;
      activeSegment = null;
      const record = records[index];
      renderSources();
      video.src = record.media_src;
      document.querySelector('#rankFlag').textContent = 'RANK ' + String(record.cohort.rank).padStart(2, '0');
      const fullHeadline = record.strategy.data.opening.observed_words;
      document.querySelector('#headline').textContent = headline(fullHeadline);
      document.querySelector('#headline').title = fullHeadline;
      document.querySelector('#identityCompany').textContent = companyLabel(record);
      document.querySelector('#identityAccount').textContent = '@' + record.account_handle;
      const identityPaid = document.querySelector('#identityPaid');
      identityPaid.textContent = record.paid.label;
      identityPaid.className = 'identity-paid '
        + (record.paid.state === 'paid_flag_observed' ? 'paid' : record.paid.state === 'not_marked_paid' ? 'clear' : '');
      document.querySelector('#metrics').innerHTML = [
        [record.metrics.views, 'views'],
        [record.metrics.likes, 'likes'],
        [record.metrics.comments, 'comments'],
        [record.metrics.shares, 'shares'],
        [record.metrics.saves, 'saves'],
      ].map(([value, label]) => \`
        <div title="\${escapeHtml(fullNumber(value))}">
          <div class="metric-value \${value === null ? 'missing' : label === 'views' ? 'good' : ''}">\${compactNumber(value)}</div>
          <div class="metric-label">\${escapeHtml(label)}</div>
        </div>
      \`).join('') + \`
        <div class="metric-note">Within-platform, age-normalized rank.</div>
      \`;
      document.querySelector('#inspectTime').textContent = '';
      document.querySelector('#inspectCopy').textContent = 'Select a segment.';
      renderAxis(record.duration_sec);
      renderLanes(record);
      renderContext(record);
      renderStructure(record);
    }

    function inspectSegment(laneId, index, button) {
      const record = records[activeIndex];
      const segment = record.segmentation.segments[laneId][index];
      video.currentTime = segment.start_time;
      video.play().catch(() => {});
      if (activeSegment) activeSegment.classList.remove('active');
      activeSegment = button;
      activeSegment.classList.add('active');
      const label = laneSpecs.find((lane) => lane.id === laneId)?.label ?? laneId;
      document.querySelector('#inspectTime').textContent = label + ' · ' + time(segment.start_time) + '—' + time(segment.end_time);
      document.querySelector('#inspectCopy').textContent = firstMetadata(segment.metadata);
    }

    video.addEventListener('timeupdate', () => {
      const record = records[activeIndex];
      const pct = Math.max(0, Math.min(100, (video.currentTime / record.duration_sec) * 100));
      playheads.forEach((node) => { node.style.left = pct + '%'; });
    });

    selectRecord(0);
  </script>
</body>
</html>`;
}

function read<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function uniqueByCandidateId<T extends { candidate_id: string }>(
  rows: T[],
  label: string,
): Map<string, T> {
  const output = new Map<string, T>();
  for (const row of rows) {
    if (output.has(row.candidate_id)) {
      throw new Error(`${label} contains duplicate candidate_id ${row.candidate_id}`);
    }
    output.set(row.candidate_id, row);
  }
  return output;
}

function segmentText(record: DeepRecord, lane: string, field: string): string {
  return (record.segmentation.segments[lane] ?? [])
    .map((segment) => segment.metadata[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().toLowerCase() !== 'none')
    .join(' ');
}

function findCompany(
  profiles: ResearchManifest['collection']['profiles'],
  platform: string,
  accountHandle: string,
): DemoRecord['company'] {
  const normalizedHandle = accountHandle.toLowerCase().replace(/^@/, '');
  const profile = profiles.find((candidate) => (
    candidate.platform === platform
    && locatorHandle(candidate.locator) === normalizedHandle
  ));
  return profile
    ? {
      name: profile.company,
      basis: `Matched to reviewed ${profile.identity_status.replaceAll('_', ' ')} profile.`,
    }
    : {
      name: null,
      basis: 'No reviewed company profile matched this creator or channel.',
    };
}

function locatorHandle(locator: string): string {
  return locator
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?(?:instagram|tiktok)\.com\//, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
}

function collectPaidEvidence(repoRootPath: string, targetPostIds: Set<string>): Map<string, PaidEvidence> {
  const signals = new Map<string, Array<{ isAd: boolean | null; isSponsored: boolean | null }>>();
  const roots = [
    path.join(repoRootPath, '.semantic-artifacts/competitor-content/raw'),
    path.join(repoRootPath, '.semantic-artifacts/competitor-content/apify-runs'),
  ];
  for (const root of roots) {
    for (const file of jsonFiles(root)) {
      const value = read<unknown>(file);
      walkJson(value, (item) => {
        const postId = matchingPostId(item, targetPostIds);
        if (!postId) return;
        const isAd = typeof item.isAd === 'boolean' ? item.isAd : null;
        const isSponsored = typeof item.isSponsored === 'boolean' ? item.isSponsored : null;
        if (isAd === null && isSponsored === null) return;
        const current = signals.get(postId) ?? [];
        current.push({ isAd, isSponsored });
        signals.set(postId, current);
      });
    }
  }
  return new Map([...targetPostIds].map((postId) => {
    const observations = signals.get(postId) ?? [];
    if (observations.some((signal) => signal.isAd === true || signal.isSponsored === true)) {
      const isAd = observations.some((signal) => signal.isAd === true);
      const isSponsored = observations.some((signal) => signal.isSponsored === true);
      return [postId, {
        label: 'Paid/ad flag observed',
        state: 'paid_flag_observed',
        basis: `Source metadata: isAd=${isAd}; isSponsored=${isSponsored}.`,
      }];
    }
    if (observations.some((signal) => signal.isAd === false && signal.isSponsored === false)) {
      return [postId, {
        label: 'Not marked paid',
        state: 'not_marked_paid',
        basis: 'Source metadata explicitly returned isAd=false and isSponsored=false.',
      }];
    }
    return [postId, unknownPaidEvidence()];
  }));
}

function unknownPaidEvidence(): PaidEvidence {
  return {
    label: 'Unknown',
    state: 'unknown',
    basis: 'No explicit paid, ad, or sponsorship flag was retained for this source.',
  };
}

function jsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.json')) output.push(file);
    }
  };
  visit(root);
  return output;
}

function walkJson(value: unknown, visitor: (item: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visitor));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const item = value as Record<string, unknown>;
  visitor(item);
  Object.values(item).forEach((child) => walkJson(child, visitor));
}

function matchingPostId(item: Record<string, unknown>, targets: Set<string>): string | null {
  const direct = [item.id, item.videoId, item.platform_post_id]
    .find((value) => typeof value === 'string' || typeof value === 'number');
  const directText = direct === undefined ? '' : String(direct);
  if (targets.has(directText)) return directText;
  const urls = [item.webVideoUrl, item.url, item.canonical_url]
    .filter((value): value is string => typeof value === 'string');
  return [...targets].find((target) => urls.some((url) => url.includes(target))) ?? null;
}

if (require.main === module) main();
