import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMarketingDashboardDataset,
  renderMarketingDashboard,
  validateOwnedEventAggregate,
  type OwnedEventAggregate,
} from '../src/marketing-data-model';
import {
  SNAPSHOT_METRICS,
  type MeasurementState,
  type PostMetricsRecord,
  type SnapshotMetric,
} from '../src/post-metrics';

function post(
  postId: string,
  overrides: Partial<Record<SnapshotMetric, number | null>> = {},
  states: Partial<Record<SnapshotMetric, MeasurementState>> = {},
): PostMetricsRecord {
  const values = {
    views: 100,
    likes: 10,
    comments: 2,
    shares: 3,
    saves: 4,
    follows: 2,
    profile_visits: 5,
    dms: 1,
    average_watch_time_sec: 8,
    completion_rate: 0.5,
    rewatch_rate: 0.1,
    ...overrides,
  };
  const measurementStates = Object.fromEntries(SNAPSHOT_METRICS.map((metric) => [
    metric,
    states[metric] ?? (values[metric] === null ? 'not_available' : 'observed'),
  ])) as Record<SnapshotMetric, MeasurementState>;
  return {
    post_id: postId,
    job_id: 'job-1',
    platform: 'instagram',
    account_handle: 'owned-account',
    posted_url: `https://www.instagram.com/reel/${postId}/`,
    posted_at: '2026-07-16T00:00:00.000Z',
    content_type: 'reel',
    hook: 'A testable hook',
    format: 'talking_head',
    CTA: 'Visit the profile',
    experiment_id: 'experiment-1',
    variant_id: 'variant-1',
    creative_lane: 'generated_video',
    delivery_mode: 'rendered_video',
    audio_mode: 'provider_native_audio',
    duration_sec: 20,
    metric_snapshots: [{
      captured_at: '2026-07-17T00:00:00.000Z',
      checkpoint: '24h',
      ...values,
      measurement_states: measurementStates,
      notes: [],
    }],
    notes: [],
  };
}

function event(
  eventName: OwnedEventAggregate['event_name'],
  count: number,
): OwnedEventAggregate {
  return {
    schema_version: 2,
    bucket_start: '2026-07-17T00:00:00.000Z',
    bucket_end: '2026-07-18T00:00:00.000Z',
    account_id: 'instagram:owned-account',
    campaign_id: 'campaign-1',
    experiment_id: 'experiment-1',
    variant_id: 'variant-1',
    post_id: 'post-1',
    audience_segment: 'all',
    event_name: eventName,
    count,
    rates: {
      average_watch_time_seconds: null,
      completion_rate: null,
      hook_retention_rate: null,
    },
    privacy: {
      aggregate_only: true,
      minimum_bucket_count: 5,
      prohibited_fields: [
        'resume_text',
        'name',
        'email',
        'message',
        'user_id',
        'application_history',
      ],
    },
  };
}

test('owned marketing dashboard stays explicitly not connected without owned facts', () => {
  const dataset = buildMarketingDashboardDataset({
    postMetricsStore: { records: [] },
    generatedAt: '2026-07-17T00:00:00.000Z',
  });

  assert.equal(dataset.connection_state, 'not_connected');
  assert.equal(dataset.mart.kpis.owned_reach, null);
  assert.equal(dataset.mart.kpis.application_conversion_rate, null);
  assert.equal(dataset.quality.issues[0]?.code, 'owned_marketing_sources_not_connected');
  assert.match(renderMarketingDashboard(dataset), /Owned marketing data is not connected/);
  assert.match(renderMarketingDashboard(dataset), /Competitor research is intentionally excluded/);
});

test('owned mart uses exact checkpoint facts and never fills missing interactions with zero', () => {
  const dataset = buildMarketingDashboardDataset({
    postMetricsStore: {
      records: [post('post-1', { shares: null }, { shares: 'not_available' })],
    },
    generatedAt: '2026-07-17T00:00:00.000Z',
  });

  assert.equal(dataset.connection_state, 'partial');
  assert.equal(dataset.mart.kpis.owned_reach, 100);
  assert.equal(dataset.mart.drivers.engagement_rate, null);
  assert.equal(dataset.mart.post_performance[0]?.engagement_rate, null);
  assert.equal(dataset.quality.metric_completeness, 0.909091);
  assert.equal(dataset.facts.metric_observations.length, 11);
  assert.equal(dataset.facts.metric_observations.find((fact) => fact.metric_name === 'shares')?.value, null);
});

test('owned mart reconciles dimensions and computes only source-backed KPI ratios', () => {
  const events = [
    event('social_reach', 100),
    event('social_link_clicked', 10),
    event('application_submitted', 5),
  ];
  const dataset = buildMarketingDashboardDataset({
    postMetricsStore: { records: [post('post-1')] },
    ownedEvents: events,
    generatedAt: '2026-07-17T00:00:00.000Z',
  });

  assert.equal(dataset.connection_state, 'connected');
  assert.equal(dataset.mart.kpis.owned_reach, 100);
  assert.equal(dataset.mart.kpis.average_post_completion_rate, 0.5);
  assert.equal(dataset.mart.kpis.application_conversion_rate, 0.5);
  assert.equal(dataset.mart.drivers.engagement_rate, 0.19);
  assert.equal(dataset.mart.drivers.social_link_click_rate, 0.1);
  assert.equal(dataset.mart.guardrails.event_attribution_coverage, 1);
  assert.deepEqual(dataset.dimensions.campaigns, [{
    campaign_id: 'campaign-1',
    source: 'owned_event_attribution',
  }]);
});

test('owned event contract rejects privacy leaks, undersized buckets, and duplicate fact grain', () => {
  assert.throws(() => validateOwnedEventAggregate({
    ...event('social_reach', 4),
  }), /below privacy.minimum_bucket_count/);
  assert.throws(() => validateOwnedEventAggregate({
    ...event('social_reach', 10),
    email: 'person@example.com',
  }), /prohibited or unsupported fields: email/);
  assert.throws(() => validateOwnedEventAggregate({
    ...event('social_reach', 10),
    privacy: {
      ...event('social_reach', 10).privacy,
      prohibited_fields: ['email'],
    },
  }), /privacy contract exactly/);
  const duplicate = event('social_reach', 10);
  assert.throws(() => buildMarketingDashboardDataset({
    postMetricsStore: { records: [post('post-1')] },
    ownedEvents: [duplicate, duplicate],
  }), /not unique at bucket x attribution x event grain/);
});
