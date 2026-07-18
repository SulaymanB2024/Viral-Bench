import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACQUISITION_ALLOCATION_CAPS_V1,
  ACQUISITION_GATE_THRESHOLDS_V1,
  assertLegacyAcquisitionArtifactReadable,
  buildCurrentAcquisitionEconomicsV1,
  buildRouteEconomicsV1,
  evaluateTrancheGateV1,
  validateAcquisitionEconomicsV1,
} from '../src/acquisition-economics';

test('computes the complete source-yield scorecard with explicit cost bases', () => {
  const result = buildRouteEconomicsV1({
    route_id: 'route',
    route_kind: 'acquisition',
    returned_rows: 100,
    relevant_rows: 60,
    unique_rows: 80,
    recent_timestamp_and_view_rows: 40,
    metric_complete_rows: 72,
    competitor_coverage_gained: 4,
    analyzed_items: 10,
    analysis_passed_items: 8,
    temporal_rechecks_attempted: 5,
    temporal_rechecks_with_usable_snapshot: 4,
    actual_or_conservative_cost_usd: 2,
    cost_basis: 'actual_reported',
    accepted: true,
  });
  assert.equal(result.relevant_rows_per_dollar, 30);
  assert.equal(result.unique_rows_per_dollar, 40);
  assert.equal(result.duplicate_rate, 0.2);
  assert.equal(result.freshness_rate, 0.5);
  assert.equal(result.metric_completeness_rate, 0.9);
  assert.equal(result.analysis_pass_rate, 0.8);
  assert.equal(result.temporal_recheck_yield, 0.8);
});

test('unlocks only when every approved threshold and stop gate passes', () => {
  const route = buildRouteEconomicsV1({
    route_id: 'latest',
    route_kind: 'acquisition',
    returned_rows: 100,
    relevant_rows: 25,
    unique_rows: 50,
    recent_timestamp_and_view_rows: 10,
    metric_complete_rows: 50,
    competitor_coverage_gained: 2,
    analyzed_items: 10,
    analysis_passed_items: 8,
    temporal_rechecks_attempted: 0,
    temporal_rechecks_with_usable_snapshot: 0,
    actual_or_conservative_cost_usd: 2.5,
    cost_basis: 'actual_reported',
    accepted: true,
  });
  const open = evaluateTrancheGateV1({
    current_conservative_spend_usd: 20,
    latest_route: route,
    best_prior_accepted_cost_per_relevant_usd: 0.1,
    spend_fully_settled_or_conservatively_reserved: true,
    internship_early_career_share: 0.7,
    stop_signals: {
      consecutive_provider_failures: 0,
      consecutive_subthreshold_yield_waves: 0,
      cumulative_spend_known_or_conservatively_reserved: true,
      private_data_exposure: false,
      provenance_reconciliation_resolved: true,
    },
  });
  assert.equal(open.next_tranche_state, 'unlocked');
  assert.deepEqual(open.allocation_caps, {
    best_acquisition_route_usd: 12.5,
    temporal_rechecks_usd: 5,
    selected_multimodal_analysis_usd: 5,
    exploration_and_reserve_usd: 2.5,
  });
  assert.equal(ACQUISITION_ALLOCATION_CAPS_V1.best_acquisition_route, 0.5);
  assert.equal(ACQUISITION_GATE_THRESHOLDS_V1.minimum_relevant_after_dedupe_rate, 0.2);

  const locked = evaluateTrancheGateV1({
    ...{
      current_conservative_spend_usd: 20,
      latest_route: route,
      best_prior_accepted_cost_per_relevant_usd: 0.1,
      spend_fully_settled_or_conservatively_reserved: true,
      internship_early_career_share: null,
    },
    stop_signals: {
      consecutive_provider_failures: 2,
      consecutive_subthreshold_yield_waves: 0,
      cumulative_spend_known_or_conservatively_reserved: true,
      private_data_exposure: false,
      provenance_reconciliation_resolved: true,
    },
  });
  assert.equal(locked.next_tranche_state, 'locked');
  assert.deepEqual(locked.stop_reasons, ['two_consecutive_provider_failures']);
});

test('builds the reconciled real-data report and locks tranche two on unmeasured scope mix', () => {
  const report = buildCurrentAcquisitionEconomicsV1();
  assert.equal(validateAcquisitionEconomicsV1(report), report);
  assert.equal(report.spend_ledger.cumulative.actual_reported_usd, 2.6489);
  assert.equal(report.spend_ledger.cumulative.actual_reported_plus_provider_estimate_usd, 3.430954);
  assert.equal(report.spend_ledger.cumulative.conservative_spend_usd, 20.556622);
  assert.equal(report.spend_ledger.cumulative.first_tranche_remaining_usd, 4.443378);
  assert.equal(report.source_to_corpus.acquired_raw_rows, 273);
  assert.equal(report.source_to_corpus.acquired_unique_public_items, 220);
  assert.equal(report.source_to_corpus.production_social_posts, 1052);
  assert.equal(report.source_to_corpus.total_source_records, 1183);
  assert.equal(report.source_to_corpus.public_documents, 1073);
  assert.equal(report.source_to_corpus.operator_documents, 1082);
  assert.equal(report.tranche_gate.next_tranche_state, 'locked');
  assert.equal(
    report.tranche_gate.gates.find((gate) => gate.gate_id === 'internship_early_career_scope_mix')?.passed,
    false,
  );
  assert.equal(report.live_validation.new_calls_made, 0);
  assert.equal(report.ranking_policy.raw_cross_platform_performance_ranking_allowed, false);
});

test('keeps normalized social posts and ViralContentLibrary schema 2 readable additively', () => {
  assert.equal(assertLegacyAcquisitionArtifactReadable({
    evidence_id: 'instagram:post:one',
    platform: 'instagram',
    canonical_url: 'https://www.instagram.com/p/one/',
    platform_post_id: 'one',
  }), 'normalized_social_post');
  assert.equal(assertLegacyAcquisitionArtifactReadable({
    schema_version: 2,
    items: [],
  }), 'viral_content_library_v2');
  assert.throws(() => assertLegacyAcquisitionArtifactReadable({ schema_version: 99 }), /unsupported/);
});
