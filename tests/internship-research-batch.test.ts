import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  buildBatchPreflight,
  collectPublicAudienceSignals,
  deduplicateCandidates,
  identityFreeAudienceSignal,
  parseRedditAtom,
  preflightSelectionPath,
  reserveLaneBudget,
  selectSemanticCandidates,
  settleLaneBudget,
  validateResearchBatchManifest,
} from '../src/internship-research-batch';

const MANIFEST_PATH = path.resolve(
  '.ops/competitor_research/internship-us-content-expansion-20260716.json',
);

function manifest(): ReturnType<typeof validateResearchBatchManifest> {
  return validateResearchBatchManifest(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')));
}

test('US internship batch validates the fixed scope, quotas, and $25 lane sum', () => {
  const value = manifest();

  assert.equal(value.geography, 'US');
  assert.deepEqual(value.audience, ['college_students', 'recent_graduates']);
  assert.equal(value.budget.hard_cap_usd, 25);
  assert.equal(value.budget.lanes.reduce((sum, lane) => sum + lane.max_usd, 0), 25);
  assert.equal(Object.values(value.selection.group_quotas).reduce((sum, count) => sum + count, 0), 36);
  assert.ok(value.privacy.excluded_data.includes('high_school_and_admissions_content'));
  assert.ok(value.privacy.excluded_data.includes('private_applypilot_data'));
  assert.equal(value.collection.query_batches.length, 2);
  assert.ok(value.collection.query_batches.every((batch) => batch.queries.length === 10));
});

test('preflight serializes prerequisite presence without credential values', () => {
  const ledger = buildBatchPreflight(manifest(), {
    APIFY_TOKEN: 'secret-apify-test-value',
    ALLOW_PUBLIC_SEO_RESEARCH: 'true',
    ALLOW_PAID_GENERATION: 'true',
  }, () => new Date('2026-07-16T23:00:00.000Z'));
  const discovery = ledger.lanes.find((lane) => lane.id === 'discovery');
  const multimodal = ledger.lanes.find((lane) => lane.id === 'multimodal_analysis');

  assert.equal(discovery?.status, 'ready');
  assert.equal(multimodal?.status, 'blocked_missing_prerequisite');
  assert.doesNotMatch(JSON.stringify(ledger), /secret-apify-test-value/);
  assert.equal(ledger.external_calls_made, 0);
});

test('budget reservations fail closed at lane and batch boundaries', () => {
  const readyEnv = {
    APIFY_TOKEN: 'test',
    TWELVELABS_API_KEY: 'test',
    ALLOW_PUBLIC_SEO_RESEARCH: 'true',
    ALLOW_PUBLIC_URL_INGESTION: 'true',
    ALLOW_PAID_GENERATION: 'true',
  };
  let ledger = buildBatchPreflight(manifest(), readyEnv);
  ledger = reserveLaneBudget(ledger, 'discovery', 5);
  assert.throws(() => reserveLaneBudget(ledger, 'discovery', 0.01), /lane remaining cap/);
  ledger = settleLaneBudget(ledger, 'discovery', 5, 4.25, 4, 'completed');
  assert.equal(ledger.actual_cost_usd, 4.25);
  assert.equal(ledger.remaining_uncommitted_usd, 20.75);
  assert.throws(() => reserveLaneBudget(ledger, 'discovery', 0.76), /lane remaining cap/);
  assert.throws(() => reserveLaneBudget(ledger, 'multimodal_analysis', 12.01), /lane remaining cap/);
});

test('candidate selection deduplicates canonical IDs and satisfies group, platform, and account quotas', () => {
  const groups = [
    ['competitor_product', 12],
    ['student_problem_creator', 12],
    ['opportunity_access_safety', 6],
    ['contrast_outlier', 6],
  ] as const;
  const platforms = ['tiktok', 'instagram', 'youtube_shorts'] as const;
  const candidates: unknown[] = [];
  let sequence = 10_000_000_000;
  for (const [group, count] of groups) {
    for (let index = 0; index < count; index += 1) {
      const platform = platforms[index % platforms.length];
      const id = String(sequence++);
      const account = `${group}-${platform}-${Math.floor(index / 3)}`;
      const canonicalUrl = platform === 'tiktok'
        ? `https://www.tiktok.com/@${account}/video/${id}`
        : platform === 'instagram'
          ? `https://www.instagram.com/reel/${id}/`
          : `https://www.youtube.com/shorts/${id}`;
      candidates.push({
        candidate_id: `${group}-${platform}-${id}`,
        canonical_url: canonicalUrl,
        platform,
        platform_post_id: id,
        account_handle: account,
        source_group: group,
        cohort: index % 2 ? 'popular' : 'recent',
        posted_at: index % 2 ? '2026-01-01T00:00:00.000Z' : '2026-07-01T00:00:00.000Z',
        metrics: { views: 1_000 + index, likes: 100, comments: 10, shares: 5, saves: 7 },
        evidence_richness: 0.9,
        novelty_score: 0.8,
      });
    }
  }
  candidates.push({
    ...(candidates[0] as Record<string, unknown>),
    candidate_id: 'duplicate-lower',
    candidate_source: 'alternate-run',
    source_group: 'contrast_outlier',
    selection_group: 'contrast_outlier',
    cohort: 'popular',
    metrics: { views: 900, likes: null, comments: null, shares: null, saves: null },
    evidence_richness: 0.1,
  });

  const deduplicated = deduplicateCandidates(candidates);
  const ledger = selectSemanticCandidates(candidates, manifest(), () => new Date('2026-07-16T23:00:00.000Z'));

  assert.equal(deduplicated.duplicatesRemoved, 1);
  assert.equal(ledger.counts.unique_candidates, 36);
  assert.equal(ledger.counts.selected, 36);
  assert.deepEqual(ledger.counts.by_group, {
    competitor_product: 12,
    student_problem_creator: 12,
    contrast_outlier: 6,
    opportunity_access_safety: 6,
  });
  assert.deepEqual(ledger.counts.by_platform, { instagram: 12, tiktok: 12, youtube_shorts: 12 });
  assert.deepEqual(ledger.shortfalls, []);
  assert.ok(ledger.entries.every((entry) => entry.selection_reason && !entry.exclusion_reason));
  assert.ok(ledger.entries.every((entry) => entry.chosen_pillar === entry.source_group));
  assert.ok(ledger.entries.every((entry) => entry.age_bucket !== 'unknown'));
  assert.ok(ledger.entries.every((entry) => entry.metrics.views !== null));
  const duplicateGroup = ledger.identity_groups?.find((group) => group.observation_count === 2);
  assert.ok(duplicateGroup);
  assert.deepEqual(duplicateGroup.source_groups_observed, ['competitor_product', 'contrast_outlier']);
  assert.deepEqual(duplicateGroup.cohorts_observed, ['popular', 'recent']);
  assert.ok(duplicateGroup.divergence_fields.includes('metrics'));
  assert.equal(
    ledger.entries.find((entry) => entry.candidate_id === (candidates[0] as Record<string, unknown>).candidate_id)?.observation_count,
    2,
  );
});

test('prepare uses a distinct preflight selection artifact path', () => {
  const base = '.semantic-artifacts/competitor-content/reports/batch';
  assert.equal(
    preflightSelectionPath(base),
    '.semantic-artifacts/competitor-content/reports/batch-preflight-selection.json',
  );
  assert.notEqual(preflightSelectionPath(base), `${base}-selection.json`);
});

test('community parsing discards author identity and persists only a paraphrased need', () => {
  const rawTitle = 'International student received a fake recruiter check for an internship';
  const xml = `<?xml version="1.0"?><feed><entry><author><name>/u/private_student</name></author><title>${rawTitle}</title><updated>2026-07-16T20:00:00Z</updated><link href="https://www.reddit.com/r/internships/comments/abc123/example/"/><content>My professor name and personal details appeared in this message.</content></entry></feed>`;
  const parsed = parseRedditAtom(xml);
  const signal = identityFreeAudienceSignal(parsed[0], 'r/internships');
  const serialized = JSON.stringify(signal);

  assert.equal(parsed.length, 1);
  assert.equal(signal?.theme, 'job_scam_and_verification');
  assert.equal(signal?.identity_redacted, true);
  assert.equal(signal?.classification_version, 'audience_theme_rules_v1');
  assert.equal(signal?.human_override, null);
  assert.doesNotMatch(serialized, /private_student|professor name|received a fake recruiter check/);
  assert.match(signal?.paraphrased_need ?? '', /verify/i);
});

test('public RSS collection reports partial coverage without retaining raw user text', async () => {
  const value = manifest();
  value.collection.community_sources = value.collection.community_sources.slice(0, 1);
  const xml = `<?xml version="1.0"?><feed><entry><author><name>/u/private_student</name></author><title>Resume advice for a college internship</title><updated>2026-07-16T20:00:00Z</updated><link href="https://www.reddit.com/r/internships/comments/abc123/example/"/><content>Here is my full personal resume story.</content></entry></feed>`;
  const report = await collectPublicAudienceSignals(value, {
    now: () => new Date('2026-07-16T23:00:00.000Z'),
    fetchImpl: async () => new Response(xml, { status: 200 }),
    sleep: async () => undefined,
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.collected, 1);
  assert.equal(report.external_calls_made, 1);
  assert.equal(report.source_statuses[0].status, 'partial');
  assert.match(report.measurement_gaps.join('\n'), /coverage gap|Collected 1/);
  assert.doesNotMatch(serialized, /private_student|full personal resume story/);
  assert.equal(report.privacy.identity_redacted_before_persistence, true);
});
