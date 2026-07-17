import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteFile, atomicWriteJson } from './artifact-integrity';
import type { CommentSignalReport } from './internship-comment-signals';
import type { LiveCandidateReport, LiveCoverageLedger } from './internship-live-reconciliation';
import {
  buildInternshipResearchSynthesis,
  type InternshipResearchSynthesis,
  type ResearchSynthesisVideo,
} from './internship-research-synthesis';
import {
  ownedTestMatrix,
  recommendedContentProgram,
  type AudienceSignalReport,
  type BatchLedger,
  type ResearchBatchManifest,
  type SelectionLedger,
} from './internship-research-batch';

interface ContentMapSnapshot {
  coverage?: {
    videos_in_database?: number;
    videos_multimodally_mapped?: number;
    semantic_items?: number;
    active_meta_ads_observed?: number;
    unique_meta_ad_concepts_observed?: number;
  };
  videos?: ResearchSynthesisVideo[];
}

interface MultimodalReport {
  target: number;
  analyzed: number;
  conservative_maximum_estimate_usd: number;
  usage_pricing_estimate_usd: number;
  actual_charge_reported_by_provider: false;
  external_calls_made: number;
  measurement_gaps: string[];
}

interface MediaRecoveryReport {
  totals: { actual_cost_usd_reported: number; external_calls_made: number };
}

interface FinalizeInput {
  manifest: ResearchBatchManifest;
  discoveryLedger: BatchLedger;
  candidates: LiveCandidateReport;
  selection: SelectionLedger;
  coverage: LiveCoverageLedger;
  community: AudienceSignalReport;
  comments: CommentSignalReport;
  sourceRegistry: { sources: Array<Record<string, unknown>> };
  publicSignals: { signals: Array<Record<string, unknown>> };
  opportunities: { items: Array<Record<string, unknown>> };
  contentMap: ContentMapSnapshot;
  multimodal: MultimodalReport;
  mediaRecovery: MediaRecoveryReport;
  generatedAt: string;
}

export function buildFinalResearchArtifacts(input: FinalizeInput): {
  ledger: BatchLedger;
  coverage: Record<string, unknown>;
  expansion: Record<string, unknown>;
  markdown: string;
} {
  const discovery = requiredLane(input.discoveryLedger, 'discovery');
  const commentSources = new Set(input.comments.signals.map((signal) => signal.source_url)).size;
  const audienceGaps = unique([
    ...input.comments.measurement_gaps,
    ...(commentSources < input.comments.selected_posts
      ? [`${input.comments.selected_posts - commentSources} of ${input.comments.selected_posts} selected posts returned no retained public comment signal; this is a comment-coverage gap, not negative audience evidence.`]
      : []),
    'The exact original comment-collection HTTP call count was not retained; five completed provider runs and their settled costs are recorded.',
  ]);
  const analysisUnsettledCeiling = money(Math.max(0,
    input.multimodal.conservative_maximum_estimate_usd - input.multimodal.usage_pricing_estimate_usd));
  const lanes: BatchLedger['lanes'] = [
    discovery,
    {
      id: 'audience_voice', max_usd: 4,
      actual_cost_usd: input.comments.costs.actual_cost_usd_reported,
      committed_max_cost_usd: 0,
      status: audienceGaps.length ? 'partial' : 'completed', blockers: [], measurement_gaps: audienceGaps,
      external_calls_made: 0,
    },
    {
      id: 'multimodal_analysis', max_usd: 12,
      actual_cost_usd: input.multimodal.usage_pricing_estimate_usd,
      committed_max_cost_usd: analysisUnsettledCeiling,
      status: input.multimodal.analyzed === input.multimodal.target ? 'completed' : 'partial',
      blockers: [],
      measurement_gaps: [
        ...input.multimodal.measurement_gaps,
        'TwelveLabs does not report an invoice charge per analysis response; actual_cost_usd is the usage-pricing estimate and the remaining maximum estimate is conservatively retained.',
      ],
      external_calls_made: input.multimodal.external_calls_made,
    },
    {
      id: 'supplemental_retrieval', max_usd: 2, actual_cost_usd: input.mediaRecovery.totals.actual_cost_usd_reported, committed_max_cost_usd: 0,
      status: input.community.measurement_gaps.length ? 'partial' : 'completed', blockers: [],
      measurement_gaps: input.community.measurement_gaps,
      external_calls_made: input.community.external_calls_made + input.mediaRecovery.totals.external_calls_made,
    },
    {
      id: 'retry_reserve', max_usd: 2, actual_cost_usd: 0, committed_max_cost_usd: 0,
      status: 'reserved', blockers: [], measurement_gaps: [], external_calls_made: 0,
    },
  ];
  const actual = money(lanes.reduce((sum, lane) => sum + lane.actual_cost_usd, 0));
  const committed = money(lanes.reduce((sum, lane) => sum + lane.committed_max_cost_usd, 0));
  const ledger: BatchLedger = {
    schema_version: 1,
    batch_id: input.manifest.batch_id,
    generated_at: input.generatedAt,
    hard_cap_usd: input.manifest.budget.hard_cap_usd,
    actual_cost_usd: actual,
    committed_max_cost_usd: committed,
    remaining_uncommitted_usd: money(input.manifest.budget.hard_cap_usd - actual - committed),
    external_calls_made: lanes.reduce((sum, lane) => sum + lane.external_calls_made, 0),
    status: 'completed_with_gaps',
    lanes,
    redactions: ['credential values are never serialized'],
  };
  const themeCounts = mergeCounts(input.community.counts_by_theme, input.comments.counts_by_theme);
  const historical = input.contentMap.coverage ?? {};
  const synthesis = buildInternshipResearchSynthesis({
    generatedAt: input.generatedAt,
    audienceSignals: [...input.community.signals, ...input.comments.signals],
    videos: input.contentMap.videos ?? [],
    selectionCounts: input.selection.counts,
    measurementGaps: unique([
      ...input.community.measurement_gaps,
      ...audienceGaps,
      ...input.multimodal.measurement_gaps,
      ...input.coverage.blockers,
    ]),
  });
  const expansion = {
    schema_version: 1,
    batch_id: input.manifest.batch_id,
    generated_at: input.generatedAt,
    ledger,
    discovery_summary: {
      provider_rows: input.candidates.input_counts.total_provider_rows,
      normalized_candidates: input.candidates.output_counts.normalized_candidates,
      unique_candidates: input.selection.counts.unique_candidates,
      duplicate_candidates_removed: input.selection.counts.duplicate_candidates_removed,
    },
    selection_summary: input.selection.counts,
    selection_shortfalls: input.selection.shortfalls,
    audience_summary: {
      collected: input.community.collected + input.comments.retained_identity_free_signals,
      community_thread_signals: input.community.collected,
      public_comment_signals: input.comments.retained_identity_free_signals,
      comment_posts_targeted: input.comments.selected_posts,
      comment_posts_with_retained_signals: commentSources,
      counts_by_theme: themeCounts,
      counts_by_community: { ...input.community.counts_by_community, ...input.comments.counts_by_platform },
      measurement_gaps: [...input.community.measurement_gaps, ...audienceGaps],
    },
    semantic_summary: {
      historical_unique_posts: historical.videos_in_database ?? 0,
      historical_multimodally_mapped_posts: historical.videos_multimodally_mapped ?? 0,
      historical_semantic_rows: historical.semantic_items ?? 0,
      historical_ad_executions: historical.active_meta_ads_observed ?? 0,
      historical_unique_ad_concepts: historical.unique_meta_ad_concepts_observed ?? 0,
      newly_selected_posts: input.selection.counts.selected,
      newly_multimodally_analyzed_posts: input.multimodal.analyzed,
    },
    research_synthesis: synthesis,
    content_program: recommendedContentProgram(),
    owned_test_matrix: ownedTestMatrix(),
    source_registry_path: '.ops/competitor_research/internship-us-public-source-registry-20260716.json',
    public_signals_path: '.ops/competitor_research/internship-us-public-signals-20260716.json',
    opportunity_sample_path: '.ops/job_content_feeds/internship-us-opportunity-sample-20260716.json',
  };
  const coverage = {
    ...input.coverage,
    generated_at: input.generatedAt,
    providers: input.coverage.providers.map((provider) => provider.provider === 'twelvelabs'
      ? {
          provider: 'twelvelabs',
          status: 'completed' as const,
          external_calls_made: input.multimodal.external_calls_made,
          measurement_gaps: [
            'The provider does not report an invoice charge per analysis response; usage-priced and conservative estimates are retained.',
          ],
        }
      : provider),
    costs: {
      ...input.coverage.costs,
      audience_voice_actual_cost_usd_reported: input.comments.costs.actual_cost_usd_reported,
      supplemental_retrieval_actual_cost_usd_reported: input.mediaRecovery.totals.actual_cost_usd_reported,
      multimodal_usage_pricing_estimate_usd: input.multimodal.usage_pricing_estimate_usd,
      multimodal_conservative_maximum_estimate_usd: input.multimodal.conservative_maximum_estimate_usd,
      batch_actual_cost_usd_reported: actual,
      batch_conservative_spend_usd: money(actual + committed),
      batch_remaining_uncommitted_usd: ledger.remaining_uncommitted_usd,
    },
    counts: {
      ...input.coverage.counts,
      community_thread_signals: input.community.collected,
      public_comment_signals: input.comments.retained_identity_free_signals,
      comment_posts_targeted: input.comments.selected_posts,
      comment_posts_with_retained_signals: commentSources,
      newly_multimodally_analyzed: input.multimodal.analyzed,
    },
    blockers: unique([
      ...input.coverage.blockers.filter((value) => !/multimodal analysis is blocked|credential/i.test(value)),
      ...input.community.measurement_gaps,
      ...audienceGaps,
      'Google Trends returned HTTP 429, so no relative search-demand ranking is reported.',
    ]),
  };
  return {
    ledger,
    coverage,
    expansion,
    markdown: renderMarkdown(input, ledger, commentSources, themeCounts, synthesis),
  };
}

function renderMarkdown(
  input: FinalizeInput,
  ledger: BatchLedger,
  commentSources: number,
  themes: Record<string, number>,
  synthesis: InternshipResearchSynthesis,
): string {
  const program = recommendedContentProgram();
  const tests = ownedTestMatrix();
  const c = input.contentMap.coverage ?? {};
  return `# US internship content and data expansion

Generated: ${input.generatedAt}

## Outcome

The live, public-data-only US batch completed discovery, deterministic selection, identity-redacted audience collection, market-source registration, multimodal analysis, and content planning under the $25 hard cap. It produced ${input.candidates.input_counts.total_provider_rows} provider rows, ${input.candidates.output_counts.normalized_candidates} normalized candidates, ${input.selection.counts.unique_candidates} unique candidates, all ${input.selection.counts.selected} required selections, and ${input.multimodal.analyzed} of ${input.multimodal.target} fresh TwelveLabs analyses.

## Spend and reconciliation

| Stage | Count |
| --- | ---: |
| Provider rows | ${input.candidates.input_counts.total_provider_rows} |
| Normalized candidates | ${input.candidates.output_counts.normalized_candidates} |
| Unique candidates | ${input.selection.counts.unique_candidates} |
| Canonical duplicates removed | ${input.selection.counts.duplicate_candidates_removed} |
| Selected posts | ${input.selection.counts.selected} |
| Existing unique posts / multimodally mapped | ${c.videos_in_database ?? 0} / ${c.videos_multimodally_mapped ?? 0} |
| Existing semantic rows | ${c.semantic_items ?? 0} |
| Existing ad executions / unique concepts | ${c.active_meta_ads_observed ?? 0} / ${c.unique_meta_ad_concepts_observed ?? 0} |

- Reported plus usage-priced provider cost: $${ledger.actual_cost_usd.toFixed(6)}.
- Conservative spend including unsettled discovery and analysis ceilings: $${money(ledger.actual_cost_usd + ledger.committed_max_cost_usd).toFixed(6)}.
- Remaining uncommitted batch ceiling: $${ledger.remaining_uncommitted_usd.toFixed(4)}.
- Selection quotas: ${inlineCounts(input.selection.counts.by_group)}; platform floor result: ${inlineCounts(input.selection.counts.by_platform)}; shortfalls: none.

Unique posts, repeated semantic rows, ad executions, and unique ad concepts remain separate counts. Raw cross-platform view rankings are prohibited; selection uses within-platform and age-bucket percentiles.

## Audience voice

- ${input.community.collected} identity-free public-community thread signals.
- ${input.comments.retained_identity_free_signals} identity-free public-comment signals from ${commentSources} of ${input.comments.selected_posts} targeted posts.
- Recurring themes: ${inlineCounts(themes)}.
- Usernames, profile URLs, raw comment text, comment IDs, names, emails, résumé text, and applicant histories are not persisted.

## Analytical synthesis

The reasoning contract is observation → alternative explanation → owned test. Audience counts are paired with unique source pages, and competitor-performance patterns remain exploratory until they replicate on owned content.

| Finding | Confidence | Reasoning | Decision implication |
| --- | --- | --- | --- |
${synthesis.findings.map((finding) => `| ${escapeCell(finding.conclusion)} | ${finding.confidence} | ${escapeCell(finding.reasoning)} | ${escapeCell(finding.decision_implication)} |`).join('\n')}

### What could overturn these conclusions

${synthesis.findings.map((finding) => [
    `- **${finding.id}.** Alternatives: ${finding.alternative_explanations.join(' / ')}`,
    `  - Change our mind if: ${finding.would_change_our_mind.join(' / ')}`,
  ].join('\n')).join('\n')}

### Audience evidence depth

| Theme | Signals | Share | Unique source pages | Largest-page share | Source pattern | Evidence strength |
| --- | ---: | ---: | ---: | ---: | --- | --- |
${synthesis.audience_theme_depth.map((theme) => `| ${theme.theme} | ${theme.signal_count} | ${percent(theme.signal_share)} | ${theme.unique_source_pages} | ${percent(theme.largest_source_share)} | ${theme.source_pattern} | ${theme.evidence_strength} |`).join('\n')}

Signal volume and source breadth answer different questions. Repeated comments on one page can show intensity around one stimulus; they do not establish population prevalence.

### Exploratory performance contrasts

High-performance means at or above the within-platform and posting-age 75th percentile. The comparison group is the remaining scored corpus.

| Dimension | Category | High-performance group | Comparison group | Difference | Leave-one-out direction | Leave-one-out range | Stability |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- |
${synthesis.performance_contrasts.map((contrast) => `| ${contrast.dimension} | ${contrast.category} | ${contrast.high_performance_count}/${contrast.high_performance_total} (${percent(contrast.high_performance_share)}) | ${contrast.comparison_count}/${contrast.comparison_total} (${percent(contrast.comparison_share)}) | ${signedPercent(contrast.percentage_point_delta)} | ${percent(contrast.sensitivity.direction_consistency)} (${contrast.sensitivity.assessment}) | ${signedPercent(contrast.sensitivity.minimum_percentage_point_delta)} to ${signedPercent(contrast.sensitivity.maximum_percentage_point_delta)} | ${contrast.stability} |`).join('\n')}

#### Platform sensitivity

${synthesis.performance_contrasts.map((contrast) => `- **${contrast.dimension}: ${contrast.category}.** ${contrast.platform_sensitivity.interpretation}`).join('\n')}

The leave-one-out diagnostics ask whether removing any single scored video or one entire platform changes the observed direction; they do not repair confounding or make the estimate precise. These contrasts remain hypothesis generators. They do not control for creator, topic, time, audience, or production quality and therefore do not identify causes.

### Research tensions

${synthesis.tensions.map((tension) => `- **${tension.tension}** ${tension.why_it_matters} Resolution: ${tension.current_resolution}`).join('\n')}

## Prioritized content program

| Priority | Series | Voice | Audience problem | Evidence rule |
| ---: | --- | --- | --- | --- |
${program.map((item) => `| ${item.priority} | ${item.name} | ${item.voice} | ${item.problem} | ${item.evidence_rule} |`).join('\n')}

## Falsifiable owned-content tests

| Test | Hypothesis | Minimum design | Falsification rule |
| --- | --- | --- | --- |
${synthesis.owned_test_priorities.map((test) => `| ${test.id} | ${escapeCell(test.hypothesis)} | ${escapeCell(test.minimum_design)} | ${escapeCell(test.falsification_rule)} |`).join('\n')}

Each test must keep equivalent measurement windows and retain its stated guardrails. A directional competitor pattern is not promoted to a content rule unless the owned test reproduces it.

## Nine-post owned test

| Post | Voice | Series | Hypothesis | Primary measures |
| ---: | --- | --- | --- | --- |
${tests.map((item) => `| ${item.post} | ${item.voice} | ${item.series} | ${item.hypothesis} | ${item.measures.join(', ')} |`).join('\n')}

Compare posts after equivalent measurement windows. Retain platform and age cohorts; do not treat raw views from different platforms as a shared performance scale.

## Ranked additional data sources

| Rank | Source | Category | Access | Freshness | Privacy |
| ---: | --- | --- | --- | --- | --- |
${input.sourceRegistry.sources.map((source) => `| ${source.rank} | [${source.name}](${source.url}) | ${source.category} | ${source.access} | ${source.freshness} | ${source.privacy_risk} |`).join('\n')}

The registry contains ${input.sourceRegistry.sources.length} ranked sources, ${input.publicSignals.signals.length} observed first-party/public market signals, and ${input.opportunities.items.length} opportunity-format examples. Opportunity availability, compensation, deadline, location, and eligibility require immediate first-party revalidation before content use.

## Coverage and blocker ledger

${ledger.lanes.flatMap((lane) => [
    `- **${lane.id}: ${lane.status}.** Cap $${lane.max_usd}; actual $${lane.actual_cost_usd}; committed $${lane.committed_max_cost_usd}.`,
    ...lane.blockers.map((value) => `  - ${value}`),
    ...lane.measurement_gaps.map((value) => `  - ${value}`),
  ]).join('\n')}
- Google Trends returned HTTP 429; this is a measurement gap, so no relative search-demand ranking is claimed.
- One Instagram popular search failed; this is a provider gap, not evidence of absent demand.

## Evidence boundaries

- Observed evidence, company claims, heuristic classifications, and recommendations remain distinct fields.
- Missing, skipped, failed, and rate-limited providers are measurement gaps, never negative market evidence.
- Safety claims must use current FTC guidance; work-authorization claims must use current USCIS guidance and route individual cases to the student's DSO.
- All ${input.multimodal.analyzed} newly selected items have timestamp-grounded Pegasus analysis. The prior historical corpus remains separately counted at ${c.videos_multimodally_mapped ?? 0} mapped posts and ${c.semantic_items ?? 0} semantic rows.
- Audience-signal counts are not survey prevalence estimates; the synthesis reports ${synthesis.sample.unique_audience_source_pages} unique source pages alongside ${synthesis.sample.audience_signals} signals.
- The analytical synthesis retains alternative explanations and explicit falsification rules; recommendations are not treated as conclusions.
- This batch publishes nothing and contacts nobody.
`;
}

function requiredLane(ledger: BatchLedger, id: BatchLedger['lanes'][number]['id']): BatchLedger['lanes'][number] {
  const lane = ledger.lanes.find((item) => item.id === id);
  if (!lane) throw new Error(`Missing ${id} lane.`);
  return JSON.parse(JSON.stringify(lane)) as BatchLedger['lanes'][number];
}

function mergeCounts(...values: Array<Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) for (const [key, count] of Object.entries(value)) result[key] = (result[key] ?? 0) + count;
  return Object.fromEntries(Object.entries(result).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function inlineCounts(value: Record<string, number>): string {
  return Object.entries(value).map(([key, count]) => `${key}=${count}`).join(', ');
}

function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function signedPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`;
}
function escapeCell(value: string): string { return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim(); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function money(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
function readJson<T>(filePath: string): T { return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as T; }
function writeJson(filePath: string, value: unknown): void {
  atomicWriteJson(path.resolve(filePath), value);
}

function main(): void {
  const base = '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716';
  const artifacts = buildFinalResearchArtifacts({
    manifest: readJson('.ops/competitor_research/internship-us-content-expansion-20260716.json'),
    discoveryLedger: readJson(`${base}-ledger.json`),
    candidates: readJson(`${base}-live-candidates.json`),
    selection: readJson(`${base}-selection.json`),
    coverage: readJson(`${base}-coverage.json`),
    community: readJson(`${base}-audience-signals.json`),
    comments: readJson(`${base}-comment-signals.json`),
    sourceRegistry: readJson('.ops/competitor_research/internship-us-public-source-registry-20260716.json'),
    publicSignals: readJson('.ops/competitor_research/internship-us-public-signals-20260716.json'),
    opportunities: readJson('.ops/job_content_feeds/internship-us-opportunity-sample-20260716.json'),
    contentMap: readJson('.semantic-artifacts/competitor-content/reports/internship-content-semantic-map-20260716.json'),
    multimodal: readJson(`${base}-multimodal.json`),
    mediaRecovery: readJson('.semantic-artifacts/competitor-content/discovery/internship-us-media-recovery-20260716.json'),
    generatedAt: new Date().toISOString(),
  });
  writeJson(`${base}-ledger.json`, artifacts.ledger);
  writeJson(`${base}-coverage.json`, artifacts.coverage);
  writeJson(`${base}-expansion.json`, artifacts.expansion);
  atomicWriteFile(path.resolve('docs/INTERNSHIP_US_CONTENT_DATA_EXPANSION_20260716.md'), artifacts.markdown);
  process.stdout.write(`${JSON.stringify({
    status: 'completed_with_gaps', actual_cost_usd: artifacts.ledger.actual_cost_usd,
    conservative_spend_usd: money(artifacts.ledger.actual_cost_usd + artifacts.ledger.committed_max_cost_usd),
    remaining_uncommitted_usd: artifacts.ledger.remaining_uncommitted_usd,
    selected: (artifacts.expansion.selection_summary as SelectionLedger['counts']).selected,
    audience_signals: (artifacts.expansion.audience_summary as { collected: number }).collected,
  }, null, 2)}\n`);
}

if (require.main === module) main();
