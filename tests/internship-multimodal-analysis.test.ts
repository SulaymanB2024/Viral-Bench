import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  assessDeepAnalysisQuality,
  buildDeepAnalysisInputFingerprint,
  deepAnalysisMaximumEstimate,
  deepCloneSegmentDefinitions,
  loadEnglishCandidateIds,
  maximumBatchEstimate,
  selectDeepAnalysisCohort,
  validateDeepAnalysisCache,
} from '../src/internship-multimodal-analysis';
import { hashFile } from '../src/artifact-integrity';
import type { InternshipMediaManifest } from '../src/internship-media-prep';
import type { SelectionLedger } from '../src/internship-research-batch';
import type { TwelveLabsSegmentationAnalysis } from '../src/semantic-pipeline';

test('36 short videos remain below the $12 analysis lane ceiling', () => {
  const rows = Array.from({length: 36}, (_, index) => ({candidate_id:`c${index}`,canonical_url:'https://example.com',platform:'tiktok',platform_post_id:String(index),chosen_pillar:'student_problem_creator',media_path:`v${index}.mp4`,media_sha256:'x',byte_size:1,duration_sec:60,media_kind:'downloaded_public_video' as const,retrieval_state:'ready' as const,limitation:null}));
  const manifest: InternshipMediaManifest = {schema_version:1,batch_id:'b',generated_at:new Date(0).toISOString(),media_directory:'m',rows,costs:{supplemental_retrieval_actual_usd:0},privacy:{public_media_only:true,publishing_in_scope:false}};
  assert.ok(maximumBatchEstimate(manifest) < 12);
});

test('deep cohort keeps fewer full-fidelity winners and uses complexity only as a tie-break', () => {
  const { manifest, selection } = cohortFixture([
    { id: 'winner-complex', performance: 0.98, duration: 45, kind: 'downloaded_public_video' },
    { id: 'winner-simple', performance: 0.98, duration: 8, kind: 'downloaded_public_video' },
    { id: 'higher-but-incomplete', performance: 1, duration: 60, kind: 'rendered_public_slideshow' },
    { id: 'complex-but-not-successful', performance: 0.89, duration: 60, kind: 'downloaded_public_video' },
  ]);

  const cohort = selectDeepAnalysisCohort(manifest, selection, { limit: 2, minimumSuccessPercentile: 0.9 });

  assert.deepEqual(cohort.map((entry) => entry.row.candidate_id), ['winner-complex', 'winner-simple']);
  assert.equal(cohort[0].cohort_rank, 1);
  assert.ok(cohort[0].complexity_score > cohort[1].complexity_score);
  assert.ok(deepAnalysisMaximumEstimate(manifest, selection, { limit: 2 }) > maximumBatchEstimate(manifest, 2));
  assert.ok(deepAnalysisMaximumEstimate(manifest, selection, { limit: 2 }) < 12);
});

test('deep cohort applies the English eligibility set before paid ranking', () => {
  const { manifest, selection } = cohortFixture([
    { id: 'non-english-winner', performance: 1, duration: 40, kind: 'downloaded_public_video' },
    { id: 'english-winner', performance: 0.98, duration: 35, kind: 'downloaded_public_video' },
  ]);

  const cohort = selectDeepAnalysisCohort(manifest, selection, {
    limit: 2,
    minimumSuccessPercentile: 0.9,
    eligibleCandidateIds: new Set(['english-winner']),
  });

  assert.deepEqual(cohort.map((entry) => entry.row.candidate_id), ['english-winner']);
  assert.equal(cohort[0].cohort_rank, 1);
});

test('deep cohort rejects long-form query false positives before paid analysis', () => {
  const { manifest, selection } = cohortFixture([
    { id: 'tv-news-report', performance: 1, duration: 335, kind: 'downloaded_public_video' },
    { id: 'short-form-winner', performance: 0.95, duration: 45, kind: 'downloaded_public_video' },
  ]);

  const cohort = selectDeepAnalysisCohort(manifest, selection, {
    limit: 2,
    minimumSuccessPercentile: 0.9,
    eligibleCandidateIds: new Set(['tv-news-report', 'short-form-winner']),
  });

  assert.deepEqual(cohort.map((entry) => entry.row.candidate_id), ['short-form-winner']);
});

test('existing multimodal evidence identifies English candidates before deep analysis', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-language-'));
  try {
    fs.writeFileSync(path.join(directory, 'english.json'), JSON.stringify({
      candidate_id: 'english',
      analysis: {
        speech: [{ text: 'This is how you prepare for an internship interview and explain your experience.' }],
        on_screen_text: [{ text: 'Save this checklist for your next interview.' }],
      },
    }));
    fs.writeFileSync(path.join(directory, 'non-english.json'), JSON.stringify({
      candidate_id: 'non-english',
      analysis: {
        speech: [],
        on_screen_text: [{ text: 'Ceritain dong pengalaman magang lo yang paling random.' }],
      },
    }));

    assert.deepEqual([...loadEnglishCandidateIds(directory)], ['english']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('deep quality gate requires complete metadata and near-continuous visual, audio, and editing coverage', () => {
  const definitions = deepCloneSegmentDefinitions();
  const completeMetadata = Object.fromEntries(definitions.map((definition) => [
    definition.id,
    Object.fromEntries(definition.fields.map((field) => [field.name, 'observed'])),
  ]));
  const analysis: TwelveLabsSegmentationAnalysis = {
    task_id: 'task-1',
    provider_generation_id: 'generation-1',
    finish_reason: 'stop',
    usage: { input_tokens: 100, output_tokens: 100 },
    segments: Object.fromEntries(definitions.map((definition) => [
      definition.id,
      [{ start_time: 0, end_time: 10, metadata: completeMetadata[definition.id] }],
    ])),
  };

  const passing = assessDeepAnalysisQuality(analysis, 10, definitions);
  assert.equal(passing.passed, true);
  assert.equal(passing.visual_coverage_ratio, 1);
  assert.equal(passing.audio_coverage_ratio, 1);
  assert.equal(passing.editing_coverage_ratio, 1);

  analysis.segments.visual_shots[0].end_time = 6;
  analysis.segments.audio_beats[0].end_time = 7;
  analysis.segments.editing_beats[0].end_time = 8;
  const failing = assessDeepAnalysisQuality(analysis, 10, definitions);
  assert.equal(failing.passed, false);
  assert.deepEqual(failing.retry_definition_ids, ['audio_beats', 'editing_beats', 'visual_shots']);
  assert.equal(failing.max_visual_gap_sec, 4);
  assert.equal(failing.max_audio_gap_sec, 3);
  assert.equal(failing.max_editing_gap_sec, 2);
});

test('deep-analysis cache reuse requires an exact media, prompt, schema, and quality fingerprint', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-deep-fingerprint-'));
  const mediaPath = path.join(directory, 'sample.mp4');
  fs.writeFileSync(mediaPath, 'stable-media-bytes');
  const { manifest } = cohortFixture([
    { id: 'fingerprinted', performance: 1, duration: 10, kind: 'downloaded_public_video' },
  ]);
  const row = {
    ...manifest.rows[0],
    media_path: mediaPath,
    media_sha256: hashFile(mediaPath),
    byte_size: fs.statSync(mediaPath).size,
  };
  const definitions = deepCloneSegmentDefinitions();
  const expected = buildDeepAnalysisInputFingerprint(row, 'strategy prompt v1', definitions);
  const quality = {
    passed: true,
    retry_definition_ids: [],
    definition_counts: Object.fromEntries(definitions.map((definition) => [definition.id, 1])),
    definition_coverage: Object.fromEntries(definitions.map((definition) => [
      definition.id,
      { coverage_ratio: 1, max_gap_sec: 0 },
    ])),
  };

  assert.equal(validateDeepAnalysisCache({
    analysis_profile: 'successful_content_deep_clone_v1',
    input_fingerprint: expected,
    quality,
  }, expected, definitions).reusable, true);

  const changedPrompt = buildDeepAnalysisInputFingerprint(row, 'strategy prompt v2', definitions);
  assert.deepEqual(validateDeepAnalysisCache({
    analysis_profile: 'successful_content_deep_clone_v1',
    input_fingerprint: expected,
    quality,
  }, changedPrompt, definitions), {
    reusable: false,
    reasons: ['input fingerprint changed'],
  });
  assert.ok(validateDeepAnalysisCache({
    analysis_profile: 'successful_content_deep_clone_v1',
    quality,
  }, expected, definitions).reasons.includes('input fingerprint missing'));

  fs.writeFileSync(mediaPath, 'changed-media-bytes');
  assert.throws(
    () => buildDeepAnalysisInputFingerprint(row, 'strategy prompt v1', definitions),
    /media SHA-256 does not match/,
  );
});

function cohortFixture(rows: Array<{
  id: string;
  performance: number;
  duration: number;
  kind: InternshipMediaManifest['rows'][number]['media_kind'];
}>): { manifest: InternshipMediaManifest; selection: SelectionLedger } {
  const manifest: InternshipMediaManifest = {
    schema_version: 1,
    batch_id: 'deep-batch',
    generated_at: new Date(0).toISOString(),
    media_directory: 'media',
    rows: rows.map((row) => ({
      candidate_id: row.id,
      canonical_url: `https://example.com/${row.id}`,
      platform: 'tiktok',
      platform_post_id: row.id,
      chosen_pillar: 'student_problem_creator',
      media_path: `${row.id}.mp4`,
      media_sha256: 'hash',
      byte_size: 100,
      duration_sec: row.duration,
      media_kind: row.kind,
      retrieval_state: 'ready',
      limitation: row.kind === 'rendered_public_slideshow' ? 'No original soundtrack.' : null,
    })),
    costs: { supplemental_retrieval_actual_usd: 0 },
    privacy: { public_media_only: true, publishing_in_scope: false },
  };
  const selection: SelectionLedger = {
    schema_version: 1,
    batch_id: 'deep-batch',
    generated_at: new Date(0).toISOString(),
    target_total: 36,
    entries: rows.map((row) => ({
      candidate_id: row.id,
      candidate_source: 'fixture',
      canonical_url: `https://example.com/${row.id}`,
      platform: 'tiktok',
      platform_post_id: row.id,
      account_handle: 'fixture',
      source_group: 'student_problem_creator',
      chosen_pillar: 'student_problem_creator',
      cohort: 'popular',
      posted_at: new Date(0).toISOString(),
      age_bucket: 'older_than_365_days',
      metrics: { views: 1000, likes: 100, comments: 10, shares: 5, saves: 5 },
      classification_basis: 'fixture',
      selected: true,
      selection_reason: 'fixture',
      exclusion_reason: null,
      normalized_performance_score: row.performance,
      evidence_richness: 0.95,
      novelty_score: 0.8,
    })),
    counts: {
      input_candidates: rows.length,
      unique_candidates: rows.length,
      duplicate_candidates_removed: 0,
      selected: rows.length,
      by_group: { student_problem_creator: rows.length },
      by_platform: { tiktok: rows.length },
      by_cohort: { popular: rows.length },
    },
    shortfalls: [],
    evidence_boundary: {
      raw_cross_platform_ranking_allowed: false,
      selection_is_performance_prediction: false,
      comparison_method: 'within_platform_and_age_bucket_percentile',
    },
  };
  return { manifest, selection };
}
