import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildInternshipResearchSynthesis,
  type ResearchSynthesisVideo,
} from '../src/internship-research-synthesis';
import type { AudienceSignal, SelectionLedger } from '../src/internship-research-batch';

function signal(
  id: string,
  theme: string,
  source: string,
  confidence = 0.8,
): AudienceSignal {
  return {
    signal_id: id,
    source_url: source,
    source_type: 'public_comment',
    community: 'test',
    published_at: '2026-07-17T00:00:00.000Z',
    audience_segment: 'college_student',
    theme,
    paraphrased_need: `Need represented by ${theme}.`,
    confidence,
    identity_redacted: true,
  };
}

function video(
  id: string,
  score: number,
  topic: string,
  hook: string,
  format: string,
  cta = 'none',
  platform?: string,
): ResearchSynthesisVideo {
  return {
    evidence_id: id,
    platform,
    normalized_performance_score: score,
    topic,
    hook_type: hook,
    format,
    cta_type: cta,
    semantic_state: 'multimodal_mapped',
  };
}

const selectionCounts: SelectionLedger['counts'] = {
  input_candidates: 20,
  unique_candidates: 18,
  duplicate_candidates_removed: 2,
  selected: 8,
  by_group: { competitor_product: 4, student_problem_creator: 4 },
  by_platform: { tiktok: 4, instagram: 4 },
  by_cohort: { popular: 4, recent: 4 },
};

test('research synthesis exposes source concentration, contrasts, alternatives, and falsification', () => {
  const audienceSignals = [
    signal('general-1', 'general_early_career_uncertainty', 'https://example.com/g1', 0.55),
    signal('general-2', 'general_early_career_uncertainty', 'https://example.com/g2', 0.55),
    signal('general-3', 'general_early_career_uncertainty', 'https://example.com/g3', 0.55),
    signal('general-4', 'general_early_career_uncertainty', 'https://example.com/g4', 0.55),
    signal('proof-1', 'resume_and_proof', 'https://example.com/p1'),
    signal('proof-2', 'resume_and_proof', 'https://example.com/p2'),
    signal('proof-3', 'resume_and_proof', 'https://example.com/p3'),
    signal('proof-4', 'resume_and_proof', 'https://example.com/p4'),
    signal('cost-1', 'access_compensation_and_cost', 'https://example.com/c1'),
    signal('cost-2', 'access_compensation_and_cost', 'https://example.com/c1'),
    signal('cost-3', 'access_compensation_and_cost', 'https://example.com/c1'),
    signal('cost-4', 'access_compensation_and_cost', 'https://example.com/c2'),
  ];
  const videos = [
    video('high-1', 1, 'interview', 'question', 'talking_point', 'soft_prompt'),
    video('high-2', 0.95, 'interview', 'question', 'talking_point', 'soft_prompt'),
    video('high-3', 0.9, 'networking', 'question', 'talking_point', 'follow_or_comment'),
    video('high-4', 0.8, 'resume_and_application', 'direct_statement', 'list_explainer'),
    video('base-1', 0.7, 'resume_and_application', 'direct_statement', 'list_explainer'),
    video('base-2', 0.6, 'resume_and_application', 'direct_statement', 'list_explainer'),
    video('base-3', 0.5, 'resume_and_application', 'direct_statement', 'long_explainer'),
    video('base-4', 0.4, 'job_search_stress', 'warning_or_contrarian', 'long_explainer'),
  ];
  const result = buildInternshipResearchSynthesis({
    generatedAt: '2026-07-17T12:00:00.000Z',
    audienceSignals,
    videos,
    selectionCounts,
    measurementGaps: ['one source failed'],
  });

  const general = result.audience_theme_depth.find(
    (theme) => theme.theme === 'general_early_career_uncertainty',
  );
  const cost = result.audience_theme_depth.find(
    (theme) => theme.theme === 'access_compensation_and_cost',
  );
  const questions = result.performance_contrasts.find(
    (contrast) => contrast.dimension === 'hook_type' && contrast.category === 'question',
  );

  assert.equal(result.method.causal_claims_allowed, false);
  assert.equal(general?.source_pattern, 'distributed');
  assert.equal(cost?.source_pattern, 'concentrated');
  assert.equal(cost?.unique_source_pages, 2);
  assert.equal(questions?.direction, 'overrepresented');
  assert.equal(questions?.high_performance_count, 3);
  assert.equal(questions?.comparison_count, 0);
  assert.equal(questions?.sensitivity.method, 'leave_one_video_out');
  assert.equal(questions?.sensitivity.direction_consistency, 1);
  assert.equal(questions?.sensitivity.assessment, 'direction_holds');
  assert.equal(questions?.sensitivity.sign_flip_count, 0);
  assert.equal(questions?.platform_sensitivity.assessment, 'insufficient_platform_coverage');
  assert.ok(result.findings.every((finding) => finding.alternative_explanations.length > 0));
  assert.ok(result.findings.every((finding) => finding.would_change_our_mind.length > 0));
  assert.ok(result.owned_test_priorities.every((item) => item.falsification_rule.length > 0));
  assert.ok(result.unresolved_questions.includes('one source failed'));
});

test('research synthesis keeps empty performance samples explicit instead of inventing contrasts', () => {
  const result = buildInternshipResearchSynthesis({
    generatedAt: '2026-07-17T12:00:00.000Z',
    audienceSignals: [signal('one', 'resume_and_proof', 'https://example.com/one')],
    videos: [{
      ...video('unscored', 0, 'resume_and_application', 'question', 'talking_point'),
      normalized_performance_score: null,
    }],
    selectionCounts,
    measurementGaps: [],
  });

  assert.equal(result.performance_contrasts.length, 0);
  assert.equal(result.sample.scored_content_videos, 0);
  assert.ok(result.findings.some(
    (finding) => finding.id === 'proof_is_a_product_wedge_not_an_automatic_reach_mechanism',
  ));
});

test('research synthesis exposes contrasts that depend on individual videos', () => {
  const videos = [
    video('high-question-1', 1, 'interview', 'question', 'talking_point'),
    video('high-question-2', 0.9, 'interview', 'question', 'talking_point'),
    video('high-other', 0.8, 'interview', 'direct_statement', 'talking_point'),
    video('base-question-1', 0.7, 'interview', 'question', 'talking_point'),
    video('base-question-2', 0.6, 'interview', 'question', 'talking_point'),
    video('base-question-3', 0.5, 'interview', 'question', 'talking_point'),
    video('base-other-1', 0.4, 'interview', 'direct_statement', 'talking_point'),
    video('base-other-2', 0.3, 'interview', 'direct_statement', 'talking_point'),
  ];
  const result = buildInternshipResearchSynthesis({
    generatedAt: '2026-07-17T12:00:00.000Z',
    audienceSignals: [],
    videos,
    selectionCounts,
    measurementGaps: [],
  });
  const questions = result.performance_contrasts.find(
    (contrast) => contrast.dimension === 'hook_type' && contrast.category === 'question',
  );

  assert.equal(questions?.direction, 'overrepresented');
  assert.equal(questions?.sensitivity.assessment, 'single_video_sensitive');
  assert.ok((questions?.sensitivity.sign_flip_count ?? 0) > 0);
  assert.ok((questions?.sensitivity.minimum_percentage_point_delta ?? 0) < 0);
  assert.ok((questions?.sensitivity.maximum_percentage_point_delta ?? 0) > 0);
  assert.equal(questions?.stability, 'fragile');
  assert.ok((questions?.sensitivity.most_influential_evidence_ids.length ?? 0) > 0);
});

test('research synthesis detects a pooled contrast that reverses within a platform', () => {
  const videos = [
    video('instagram:high:1', 1, 'interview', 'question', 'talking_point', 'none', 'instagram'),
    video('instagram:high:2', 0.9, 'interview', 'question', 'talking_point', 'none', 'instagram'),
    video('instagram:high:3', 0.8, 'interview', 'question', 'talking_point', 'none', 'instagram'),
    video('instagram:base:1', 0.7, 'interview', 'direct_statement', 'talking_point', 'none', 'instagram'),
    video('instagram:base:2', 0.6, 'interview', 'direct_statement', 'talking_point', 'none', 'instagram'),
    video('instagram:base:3', 0.5, 'interview', 'direct_statement', 'talking_point', 'none', 'instagram'),
    video('tiktok:high:1', 1, 'interview', 'direct_statement', 'talking_point', 'none', 'tiktok'),
    video('tiktok:high:2', 0.9, 'interview', 'direct_statement', 'talking_point', 'none', 'tiktok'),
    video('tiktok:high:3', 0.8, 'interview', 'direct_statement', 'talking_point', 'none', 'tiktok'),
    video('tiktok:base:1', 0.7, 'interview', 'question', 'talking_point', 'none', 'tiktok'),
    video('tiktok:base:2', 0.6, 'interview', 'question', 'talking_point', 'none', 'tiktok'),
    video('tiktok:base:3', 0.5, 'interview', 'direct_statement', 'talking_point', 'none', 'tiktok'),
  ];
  const result = buildInternshipResearchSynthesis({
    generatedAt: '2026-07-17T12:00:00.000Z',
    audienceSignals: [],
    videos,
    selectionCounts,
    measurementGaps: [],
  });
  const questions = result.performance_contrasts.find(
    (contrast) => contrast.dimension === 'hook_type' && contrast.category === 'question',
  );

  assert.equal(questions?.direction, 'overrepresented');
  assert.deepEqual(questions?.platform_sensitivity.platforms, ['instagram', 'tiktok']);
  assert.equal(questions?.platform_sensitivity.assessment, 'platform_sensitive');
  assert.equal(questions?.platform_sensitivity.direction_consistency, 0.5);
  assert.equal(questions?.platform_sensitivity.sign_flip_count, 1);
  assert.ok((questions?.platform_sensitivity.minimum_percentage_point_delta ?? 0) < 0);
  assert.ok((questions?.platform_sensitivity.maximum_percentage_point_delta ?? 0) > 0);
});
