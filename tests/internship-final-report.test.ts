import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { buildFinalResearchArtifacts } from '../src/internship-final-report';
import type { CommentSignalReport } from '../src/internship-comment-signals';
import type { LiveCandidateReport, LiveCoverageLedger } from '../src/internship-live-reconciliation';
import type { AudienceSignalReport, BatchLedger, ResearchBatchManifest, SelectionLedger } from '../src/internship-research-batch';

function read<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as T;
}

test('final report reconciles paid cost, conservative ceiling, audiences, and completed analysis state', () => {
  const base = '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716';
  const result = buildFinalResearchArtifacts({
    manifest: read<ResearchBatchManifest>('.ops/competitor_research/internship-us-content-expansion-20260716.json'),
    discoveryLedger: read<BatchLedger>(`${base}-ledger.json`),
    candidates: read<LiveCandidateReport>(`${base}-live-candidates.json`),
    selection: read<SelectionLedger>(`${base}-selection.json`),
    coverage: read<LiveCoverageLedger>(`${base}-coverage.json`),
    community: read<AudienceSignalReport>(`${base}-audience-signals.json`),
    comments: read<CommentSignalReport>(`${base}-comment-signals.json`),
    sourceRegistry: read(`${'.ops/competitor_research/internship-us-public-source-registry-20260716.json'}`),
    publicSignals: read('.ops/competitor_research/internship-us-public-signals-20260716.json'),
    opportunities: read('.ops/job_content_feeds/internship-us-opportunity-sample-20260716.json'),
    contentMap: read('.semantic-artifacts/competitor-content/reports/internship-content-semantic-map-20260716.json'),
    multimodal: read(`${base}-multimodal.json`),
    mediaRecovery: read('.semantic-artifacts/competitor-content/discovery/internship-us-media-recovery-20260716.json'),
    generatedAt: '2026-07-17T02:00:00.000Z',
  });
  const selection = result.expansion.selection_summary as SelectionLedger['counts'];
  const audience = result.expansion.audience_summary as { collected: number };
  const semantic = result.expansion.semantic_summary as { newly_selected_posts: number; newly_multimodally_analyzed_posts: number };
  const synthesis = result.expansion.research_synthesis as {
    findings: Array<{ alternative_explanations: string[]; would_change_our_mind: string[] }>;
    audience_theme_depth: Array<{ unique_source_pages: number }>;
    performance_contrasts: Array<{
      sensitivity: {
        method: string;
        direction_consistency: number;
        minimum_percentage_point_delta: number;
        maximum_percentage_point_delta: number;
      };
      platform_sensitivity: {
        method: string;
        direction_consistency: number;
        assessment: string;
      };
    }>;
    owned_test_priorities: Array<{ falsification_rule: string }>;
  };

  assert.equal(result.ledger.actual_cost_usd, 4.172801);
  assert.equal(result.ledger.committed_max_cost_usd, 0.601534);
  assert.equal(result.ledger.remaining_uncommitted_usd, 20.225665);
  assert.equal(selection.selected, 36);
  assert.equal(audience.collected, 97);
  assert.deepEqual([semantic.newly_selected_posts, semantic.newly_multimodally_analyzed_posts], [36, 36]);
  assert.ok(synthesis.findings.length >= 4);
  assert.ok(synthesis.findings.every((finding) => finding.alternative_explanations.length > 0));
  assert.ok(synthesis.findings.every((finding) => finding.would_change_our_mind.length > 0));
  assert.ok(synthesis.audience_theme_depth.some((theme) => theme.unique_source_pages >= 10));
  assert.ok(synthesis.performance_contrasts.every(
    (contrast) => contrast.sensitivity.method === 'leave_one_video_out',
  ));
  assert.ok(synthesis.performance_contrasts.every(
    (contrast) => contrast.sensitivity.direction_consistency >= 0
      && contrast.sensitivity.direction_consistency <= 1,
  ));
  assert.ok(synthesis.performance_contrasts.every(
    (contrast) => contrast.platform_sensitivity.method === 'leave_one_platform_out',
  ));
  assert.ok(synthesis.owned_test_priorities.every((item) => item.falsification_rule.length > 0));
  assert.match(result.markdown, /## Analytical synthesis/);
  assert.match(result.markdown, /Leave-one-out direction/);
  assert.match(result.markdown, /single scored video/);
  assert.match(result.markdown, /Platform sensitivity/);
  assert.match(result.markdown, /entire platform/);
  assert.match(result.markdown, /## Falsifiable owned-content tests/);
  assert.doesNotMatch(JSON.stringify(result), /apify_api_|tlk_/);
});
