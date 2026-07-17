import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  atomicWriteFile,
  atomicWriteJson,
  describeArtifact,
  sha256,
  stableJson,
  type ArtifactDescriptor,
} from './artifact-integrity';
import {
  DEFAULT_METRICS_STORE_PATH,
  SNAPSHOT_METRICS,
  validatePostMetricsStore,
  type MeasurementState,
  type PostMetricsStore,
  type SnapshotMetric,
} from './post-metrics';
import {
  TRACTION_CHECKPOINTS,
  type TractionCheckpoint,
} from './traction-experiment';

const EVENT_NAMES = [
  'search_performed',
  'zero_results',
  'listing_clicked',
  'listing_saved',
  'match_viewed',
  'tailor_started',
  'tailor_completed',
  'tailor_edited',
  'tailor_rejected',
  'application_started',
  'application_reviewed',
  'application_submitted',
  'social_reach',
  'social_three_second_view',
  'social_completed_view',
  'social_saved',
  'social_shared',
  'social_commented',
  'social_profile_visit',
  'social_followed',
  'social_link_clicked',
] as const;

const PROHIBITED_FIELDS = [
  'resume_text',
  'name',
  'email',
  'message',
  'user_id',
  'application_history',
] as const;

export type OwnedEventName = typeof EVENT_NAMES[number];

export interface OwnedEventAggregate {
  schema_version: 2;
  bucket_start: string;
  bucket_end: string;
  account_id: string;
  campaign_id: string | null;
  experiment_id: string | null;
  variant_id: string | null;
  post_id: string | null;
  audience_segment: string;
  event_name: OwnedEventName;
  count: number;
  rates: {
    average_watch_time_seconds: number | null;
    completion_rate: number | null;
    hook_retention_rate: number | null;
  };
  privacy: {
    aggregate_only: true;
    minimum_bucket_count: number;
    prohibited_fields: typeof PROHIBITED_FIELDS;
  };
}

export interface MarketingMetricFact {
  fact_id: string;
  post_id: string;
  captured_at: string;
  checkpoint: TractionCheckpoint;
  metric_name: SnapshotMetric;
  value: number | null;
  measurement_state: MeasurementState;
}

export interface MarketingDashboardDataset {
  schema_version: 'owned_marketing_dashboard_v1';
  generated_at: string;
  connection_state: 'not_connected' | 'partial' | 'connected';
  dimensions: {
    accounts: Array<{
      account_id: string;
      platform: string | null;
      account_handle: string | null;
    }>;
    campaigns: Array<{
      campaign_id: string;
      source: 'owned_event_attribution';
    }>;
    experiments: Array<{
      experiment_id: string;
      job_id: string | null;
    }>;
    variants: Array<{
      variant_id: string;
      experiment_id: string;
    }>;
    posts: Array<{
      post_id: string;
      account_id: string;
      job_id: string;
      experiment_id: string | null;
      variant_id: string | null;
      platform: string;
      posted_at: string;
      content_type: string;
    }>;
  };
  facts: {
    metric_observations: MarketingMetricFact[];
    event_aggregates: OwnedEventAggregate[];
  };
  quality: {
    metric_completeness: number | null;
    checkpoint_coverage: number | null;
    issues: Array<{
      severity: 'critical' | 'high' | 'medium' | 'low';
      code: string;
      message: string;
    }>;
  };
  mart: MarketingDashboardMart;
}

export interface MarketingDashboardMart {
  checkpoint: TractionCheckpoint;
  post_count: number;
  posts_at_checkpoint: number;
  kpis: {
    owned_reach: number | null;
    average_post_completion_rate: number | null;
    application_conversion_rate: number | null;
  };
  drivers: {
    engagement_rate: number | null;
    share_rate: number | null;
    save_rate: number | null;
    follow_rate: number | null;
    profile_visit_rate: number | null;
    social_link_click_rate: number | null;
  };
  guardrails: {
    metric_completeness: number | null;
    checkpoint_coverage: number | null;
    event_attribution_coverage: number | null;
  };
  post_performance: Array<{
    post_id: string;
    platform: string;
    experiment_id: string | null;
    variant_id: string | null;
    views: number | null;
    completion_rate: number | null;
    engagement_rate: number | null;
  }>;
}

export function validateOwnedEventAggregate(input: unknown): OwnedEventAggregate {
  const row = object(input, 'owned event aggregate');
  assertExactKeys(row, [
    'schema_version',
    'bucket_start',
    'bucket_end',
    'account_id',
    'campaign_id',
    'experiment_id',
    'variant_id',
    'post_id',
    'audience_segment',
    'event_name',
    'count',
    'rates',
    'privacy',
  ], 'owned event aggregate');
  if (row.schema_version !== 2) throw new Error('owned event aggregate schema_version must be 2');
  const bucketStart = dateTime(row.bucket_start, 'bucket_start');
  const bucketEnd = dateTime(row.bucket_end, 'bucket_end');
  if (Date.parse(bucketEnd) <= Date.parse(bucketStart)) throw new Error('bucket_end must be later than bucket_start');
  const eventName = enumValue(row.event_name, EVENT_NAMES, 'event_name');
  const privacy = object(row.privacy, 'privacy');
  assertExactKeys(privacy, ['aggregate_only', 'minimum_bucket_count', 'prohibited_fields'], 'privacy');
  if (privacy.aggregate_only !== true) throw new Error('privacy.aggregate_only must be true');
  const prohibited = stringArray(privacy.prohibited_fields, 'privacy.prohibited_fields');
  if (stableJson(prohibited) !== stableJson(PROHIBITED_FIELDS)) {
    throw new Error('privacy.prohibited_fields must match the privacy contract exactly');
  }
  const minimumBucketCount = integer(privacy.minimum_bucket_count, 'privacy.minimum_bucket_count', 5);
  const count = integer(row.count, 'count', 0);
  if (count > 0 && count < minimumBucketCount) {
    throw new Error('nonzero event counts below privacy.minimum_bucket_count must be suppressed upstream');
  }
  const rates = object(row.rates, 'rates');
  assertExactKeys(rates, [
    'average_watch_time_seconds',
    'completion_rate',
    'hook_retention_rate',
  ], 'rates');
  const experimentId = nullableString(row.experiment_id, 'experiment_id');
  const variantId = nullableString(row.variant_id, 'variant_id');
  if (variantId && !experimentId) throw new Error('variant_id requires experiment_id');
  return {
    schema_version: 2,
    bucket_start: bucketStart,
    bucket_end: bucketEnd,
    account_id: nonemptyString(row.account_id, 'account_id'),
    campaign_id: nullableString(row.campaign_id, 'campaign_id'),
    experiment_id: experimentId,
    variant_id: variantId,
    post_id: nullableString(row.post_id, 'post_id'),
    audience_segment: nonemptyString(row.audience_segment, 'audience_segment'),
    event_name: eventName,
    count,
    rates: {
      average_watch_time_seconds: nullableNonNegative(rates.average_watch_time_seconds, 'rates.average_watch_time_seconds'),
      completion_rate: nullableRate(rates.completion_rate, 'rates.completion_rate'),
      hook_retention_rate: nullableRate(rates.hook_retention_rate, 'rates.hook_retention_rate'),
    },
    privacy: {
      aggregate_only: true,
      minimum_bucket_count: minimumBucketCount,
      prohibited_fields: PROHIBITED_FIELDS,
    },
  };
}

export function buildMarketingDashboardDataset(options: {
  postMetricsStore: PostMetricsStore;
  ownedEvents?: unknown[];
  checkpoint?: TractionCheckpoint;
  generatedAt?: string;
}): MarketingDashboardDataset {
  const store = validatePostMetricsStore(options.postMetricsStore);
  const checkpoint = options.checkpoint ?? '24h';
  if (!(TRACTION_CHECKPOINTS as readonly string[]).includes(checkpoint)) {
    throw new Error(`Unsupported dashboard checkpoint: ${checkpoint}`);
  }
  const ownedEvents = (options.ownedEvents ?? []).map(validateOwnedEventAggregate);
  assertUniqueEventGrain(ownedEvents);
  const accounts = new Map<string, MarketingDashboardDataset['dimensions']['accounts'][number]>();
  const campaigns = new Map<string, MarketingDashboardDataset['dimensions']['campaigns'][number]>();
  const experiments = new Map<string, MarketingDashboardDataset['dimensions']['experiments'][number]>();
  const variants = new Map<string, MarketingDashboardDataset['dimensions']['variants'][number]>();
  const posts: MarketingDashboardDataset['dimensions']['posts'] = [];
  const metricFacts: MarketingMetricFact[] = [];

  for (const post of store.records) {
    const accountId = `${post.platform}:${post.account_handle.replace(/^@/, '').toLowerCase()}`;
    accounts.set(accountId, {
      account_id: accountId,
      platform: post.platform,
      account_handle: post.account_handle,
    });
    posts.push({
      post_id: post.post_id,
      account_id: accountId,
      job_id: post.job_id,
      experiment_id: post.experiment_id,
      variant_id: post.variant_id,
      platform: post.platform,
      posted_at: post.posted_at,
      content_type: post.content_type,
    });
    if (post.experiment_id) {
      experiments.set(post.experiment_id, {
        experiment_id: post.experiment_id,
        job_id: post.job_id,
      });
    }
    if (post.experiment_id && post.variant_id) {
      variants.set(`${post.experiment_id}:${post.variant_id}`, {
        variant_id: post.variant_id,
        experiment_id: post.experiment_id,
      });
    }
    for (const snapshot of post.metric_snapshots) {
      for (const metricName of SNAPSHOT_METRICS) {
        const identity = {
          post_id: post.post_id,
          captured_at: snapshot.captured_at,
          checkpoint: snapshot.checkpoint,
          metric_name: metricName,
        };
        metricFacts.push({
          fact_id: `metric:${sha256(stableJson(identity)).slice(0, 24)}`,
          ...identity,
          value: snapshot[metricName],
          measurement_state: snapshot.measurement_states[metricName],
        });
      }
    }
  }

  for (const event of ownedEvents) {
    if (!accounts.has(event.account_id)) {
      accounts.set(event.account_id, {
        account_id: event.account_id,
        platform: null,
        account_handle: null,
      });
    }
    if (event.campaign_id) campaigns.set(event.campaign_id, {
      campaign_id: event.campaign_id,
      source: 'owned_event_attribution',
    });
    if (event.experiment_id && !experiments.has(event.experiment_id)) {
      experiments.set(event.experiment_id, {
        experiment_id: event.experiment_id,
        job_id: null,
      });
    }
    if (event.experiment_id && event.variant_id) {
      variants.set(`${event.experiment_id}:${event.variant_id}`, {
        variant_id: event.variant_id,
        experiment_id: event.experiment_id,
      });
    }
  }

  assertUniqueMetricGrain(metricFacts);
  const checkpointPostIds = new Set(metricFacts
    .filter((fact) => fact.checkpoint === checkpoint)
    .map((fact) => fact.post_id));
  const observedMetricFacts = metricFacts.filter((fact) => (
    fact.measurement_state === 'observed' && fact.value !== null
  )).length;
  const metricCompleteness = metricFacts.length
    ? round(observedMetricFacts / metricFacts.length)
    : null;
  const checkpointCoverage = posts.length
    ? round(checkpointPostIds.size / posts.length)
    : null;
  const issues: MarketingDashboardDataset['quality']['issues'] = [];
  if (!posts.length && !ownedEvents.length) issues.push({
    severity: 'critical',
    code: 'owned_marketing_sources_not_connected',
    message: 'No owned post-metric snapshots or aggregate event facts are connected.',
  });
  if (posts.length && !ownedEvents.length) issues.push({
    severity: 'high',
    code: 'owned_event_source_not_connected',
    message: 'Post performance is available, but click, application, and conversion event facts are not connected.',
  });
  if (!posts.length && ownedEvents.length) issues.push({
    severity: 'high',
    code: 'post_metric_source_not_connected',
    message: 'Aggregate events are available, but checkpoint-matched owned post metrics are not connected.',
  });
  if (posts.length && checkpointPostIds.size < posts.length) issues.push({
    severity: 'high',
    code: 'checkpoint_coverage_incomplete',
    message: `${checkpointPostIds.size}/${posts.length} posts have a ${checkpoint} metric snapshot.`,
  });
  if (metricCompleteness !== null && metricCompleteness < 1) issues.push({
    severity: 'medium',
    code: 'metric_missingness_present',
    message: `Observed metric completeness is ${Math.round(metricCompleteness * 100)}%; unavailable and pending values remain null.`,
  });

  const connectionState = posts.length && ownedEvents.length
    ? 'connected'
    : posts.length || ownedEvents.length
      ? 'partial'
      : 'not_connected';
  const dimensions = {
    accounts: sortedValues(accounts),
    campaigns: sortedValues(campaigns),
    experiments: sortedValues(experiments),
    variants: sortedValues(variants),
    posts: [...posts].sort((left, right) => left.post_id.localeCompare(right.post_id)),
  };
  validateReferentialIntegrity(dimensions, ownedEvents);
  const quality = {
    metric_completeness: metricCompleteness,
    checkpoint_coverage: checkpointCoverage,
    issues,
  };
  const facts = {
    metric_observations: metricFacts.sort((left, right) => (
      left.post_id.localeCompare(right.post_id)
      || Date.parse(left.captured_at) - Date.parse(right.captured_at)
      || left.metric_name.localeCompare(right.metric_name)
    )),
    event_aggregates: [...ownedEvents].sort(eventSort),
  };
  return {
    schema_version: 'owned_marketing_dashboard_v1',
    generated_at: dateTime(options.generatedAt ?? new Date().toISOString(), 'generatedAt'),
    connection_state: connectionState,
    dimensions,
    facts,
    quality,
    mart: buildMarketingDashboardMart({
      checkpoint,
      posts: dimensions.posts,
      metricFacts: facts.metric_observations,
      events: facts.event_aggregates,
      quality,
    }),
  };
}

function buildMarketingDashboardMart(options: {
  checkpoint: TractionCheckpoint;
  posts: MarketingDashboardDataset['dimensions']['posts'];
  metricFacts: MarketingMetricFact[];
  events: OwnedEventAggregate[];
  quality: MarketingDashboardDataset['quality'];
}): MarketingDashboardMart {
  const facts = options.metricFacts.filter((fact) => fact.checkpoint === options.checkpoint);
  const byPostMetric = new Map(facts.map((fact) => [`${fact.post_id}:${fact.metric_name}`, fact]));
  const observed = (postId: string, metric: SnapshotMetric): number | null => {
    const fact = byPostMetric.get(`${postId}:${metric}`);
    return fact?.measurement_state === 'observed' ? fact.value : null;
  };
  const completeValues = (metric: SnapshotMetric): number[] | null => {
    if (!options.posts.length) return null;
    const values = options.posts.map((post) => observed(post.post_id, metric));
    return values.every((value): value is number => value !== null) ? values : null;
  };
  const completeSum = (metric: SnapshotMetric): number | null => {
    const values = completeValues(metric);
    return values ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const completeAverage = (metric: SnapshotMetric): number | null => {
    const values = completeValues(metric);
    return values?.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  };
  const ratioToViews = (numeratorMetrics: SnapshotMetric[]): number | null => {
    const views = completeSum('views');
    if (views === null || views <= 0) return null;
    const numerators = numeratorMetrics.map(completeSum);
    if (numerators.some((value) => value === null)) return null;
    return round(numerators.reduce<number>((sum, value) => sum + (value ?? 0), 0) / views);
  };
  const eventCount = (name: OwnedEventName): number | null => {
    const rows = options.events.filter((event) => event.event_name === name);
    return rows.length ? rows.reduce((sum, event) => sum + event.count, 0) : null;
  };
  const eventRate = (numerator: OwnedEventName, denominator: OwnedEventName): number | null => {
    const numeratorCount = eventCount(numerator);
    const denominatorCount = eventCount(denominator);
    return numeratorCount === null || denominatorCount === null || denominatorCount <= 0
      ? null
      : round(numeratorCount / denominatorCount);
  };
  const attributedEvents = options.events.filter((event) => (
    event.campaign_id || event.experiment_id || event.variant_id || event.post_id
  )).length;
  const postPerformance = options.posts.map((post) => ({
    post_id: post.post_id,
    platform: post.platform,
    experiment_id: post.experiment_id,
    variant_id: post.variant_id,
    views: observed(post.post_id, 'views'),
    completion_rate: observed(post.post_id, 'completion_rate'),
    engagement_rate: postEngagementRate(post.post_id, observed),
  }));
  return {
    checkpoint: options.checkpoint,
    post_count: options.posts.length,
    posts_at_checkpoint: new Set(facts.map((fact) => fact.post_id)).size,
    kpis: {
      owned_reach: completeSum('views'),
      average_post_completion_rate: completeAverage('completion_rate'),
      application_conversion_rate: eventRate('application_submitted', 'social_link_clicked'),
    },
    drivers: {
      engagement_rate: ratioToViews(['likes', 'comments', 'shares', 'saves']),
      share_rate: ratioToViews(['shares']),
      save_rate: ratioToViews(['saves']),
      follow_rate: ratioToViews(['follows']),
      profile_visit_rate: ratioToViews(['profile_visits']),
      social_link_click_rate: eventRate('social_link_clicked', 'social_reach'),
    },
    guardrails: {
      metric_completeness: options.quality.metric_completeness,
      checkpoint_coverage: options.quality.checkpoint_coverage,
      event_attribution_coverage: options.events.length
        ? round(attributedEvents / options.events.length)
        : null,
    },
    post_performance: postPerformance,
  };
}

export function renderMarketingDashboard(dataset: MarketingDashboardDataset): string {
  const title = 'Owned marketing performance';
  const state = dataset.connection_state === 'not_connected'
    ? `<section class="empty"><p class="eyebrow">Data connection required</p><h2>Owned marketing data is not connected.</h2><p>Connect append-only post metric snapshots and privacy-safe aggregate event facts. Competitor research is intentionally excluded from these KPIs.</p></section>`
    : `<section class="cards">
      ${metricCard('Owned reach', dataset.mart.kpis.owned_reach, `Exact ${dataset.mart.checkpoint} checkpoint; null until every included post has observed views.`)}
      ${rateCard('Average completion', dataset.mart.kpis.average_post_completion_rate, 'Unweighted post average at the selected checkpoint.')}
      ${rateCard('Application conversion', dataset.mart.kpis.application_conversion_rate, 'Applications submitted / social link clicks from aggregate owned events.')}
      ${rateCard('Engagement', dataset.mart.drivers.engagement_rate, 'Likes + comments + shares + saves / views; null if any component is unavailable.')}
    </section>
    <section><h2>Post performance at ${escapeHtml(dataset.mart.checkpoint)}</h2>${postTable(dataset)}</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="Checkpoint-matched owned marketing performance with explicit missingness and attribution coverage.">
<style>
:root{color-scheme:light;--bg:#fcfcfc;--ink:#080808;--muted:#666;--line:#e4e4e4;--card:#fff;--accent:#6d7d69}*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.wrap{max-width:1180px;margin:auto;padding:48px 28px 80px}
h1{font:400 clamp(38px,6vw,76px)/.98 Georgia,serif;letter-spacing:-.04em;margin:0}.lede{max-width:760px;color:var(--muted);line-height:1.6}
.meta{margin:28px 0;padding:14px 0;border-block:1px solid var(--line);font:12px ui-monospace,monospace;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:32px 0}
.card{background:var(--card);padding:22px}.value{font:32px ui-monospace,monospace;color:var(--accent)}.label{margin-top:9px;font-weight:650}.note{font-size:12px;color:var(--muted);line-height:1.5}
.empty{margin-top:54px;max-width:760px;padding:38px;border:1px solid var(--line);background:var(--card)}.eyebrow{font:11px ui-monospace,monospace;text-transform:uppercase;color:var(--accent)}
table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);font-size:13px}th{font:11px ui-monospace,monospace;color:var(--muted);text-transform:uppercase}
@media(max-width:640px){.wrap{padding:30px 16px 60px}table{display:block;overflow:auto}}
</style></head><body><main class="wrap"><p class="eyebrow">ViralBench / owned measurement</p><h1>${title}</h1>
<p class="lede">Owned outcomes only. Competitor creative research can propose experiments, but it cannot populate reach, engagement, click, application, or conversion KPIs.</p>
<div class="meta">State: ${escapeHtml(dataset.connection_state)} · checkpoint: ${escapeHtml(dataset.mart.checkpoint)} · generated: ${escapeHtml(dataset.generated_at)} · ${dataset.quality.issues.length} quality issue(s)</div>
${state}</main></body></html>`;
}

export function loadOwnedEventsFromDirectory(directory: string): {
  events: unknown[];
  sources: ArtifactDescriptor[];
} {
  const root = path.resolve(directory);
  if (!fs.existsSync(root)) return { events: [], sources: [] };
  const files = fs.readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(root, name))
    .sort();
  return {
    events: files.flatMap((file) => {
      const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      return Array.isArray(value) ? value : [value];
    }),
    sources: files.map((file) => describeArtifact(file)),
  };
}

function postEngagementRate(
  postId: string,
  observed: (postId: string, metric: SnapshotMetric) => number | null,
): number | null {
  const views = observed(postId, 'views');
  const interactions = ['likes', 'comments', 'shares', 'saves']
    .map((metric) => observed(postId, metric as SnapshotMetric));
  if (views === null || views <= 0 || interactions.some((value) => value === null)) return null;
  return round(interactions.reduce<number>((sum, value) => sum + (value ?? 0), 0) / views);
}

function validateReferentialIntegrity(
  dimensions: MarketingDashboardDataset['dimensions'],
  events: OwnedEventAggregate[],
): void {
  const accountIds = new Set(dimensions.accounts.map((row) => row.account_id));
  const campaignIds = new Set(dimensions.campaigns.map((row) => row.campaign_id));
  const experimentIds = new Set(dimensions.experiments.map((row) => row.experiment_id));
  const variantIds = new Set(dimensions.variants.map((row) => `${row.experiment_id}:${row.variant_id}`));
  const postIds = new Set(dimensions.posts.map((row) => row.post_id));
  for (const post of dimensions.posts) {
    if (!accountIds.has(post.account_id)) throw new Error(`post ${post.post_id} has an orphan account_id`);
    if (post.experiment_id && !experimentIds.has(post.experiment_id)) throw new Error(`post ${post.post_id} has an orphan experiment_id`);
    if (post.experiment_id && post.variant_id && !variantIds.has(`${post.experiment_id}:${post.variant_id}`)) {
      throw new Error(`post ${post.post_id} has an orphan variant_id`);
    }
  }
  for (const event of events) {
    if (!accountIds.has(event.account_id)) throw new Error(`event has an orphan account_id ${event.account_id}`);
    if (event.campaign_id && !campaignIds.has(event.campaign_id)) throw new Error(`event has an orphan campaign_id ${event.campaign_id}`);
    if (event.experiment_id && !experimentIds.has(event.experiment_id)) throw new Error(`event has an orphan experiment_id ${event.experiment_id}`);
    if (event.experiment_id && event.variant_id && !variantIds.has(`${event.experiment_id}:${event.variant_id}`)) {
      throw new Error(`event has an orphan variant_id ${event.variant_id}`);
    }
    if (event.post_id && !postIds.has(event.post_id)) throw new Error(`event has an orphan post_id ${event.post_id}`);
  }
}

function assertUniqueMetricGrain(facts: MarketingMetricFact[]): void {
  const keys = facts.map((fact) => `${fact.post_id}|${fact.captured_at}|${fact.metric_name}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error('metric observations are not unique at post x capture x metric grain');
  }
}

function assertUniqueEventGrain(events: OwnedEventAggregate[]): void {
  const keys = events.map((event) => [
    event.bucket_start,
    event.bucket_end,
    event.account_id,
    event.campaign_id ?? '',
    event.experiment_id ?? '',
    event.variant_id ?? '',
    event.post_id ?? '',
    event.audience_segment,
    event.event_name,
  ].join('|'));
  if (new Set(keys).size !== keys.length) {
    throw new Error('owned event aggregates are not unique at bucket x attribution x event grain');
  }
}

function eventSort(left: OwnedEventAggregate, right: OwnedEventAggregate): number {
  return Date.parse(left.bucket_start) - Date.parse(right.bucket_start)
    || left.account_id.localeCompare(right.account_id)
    || left.event_name.localeCompare(right.event_name);
}

function sortedValues<T>(values: Map<string, T>): T[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function metricCard(label: string, value: number | null, note: string): string {
  return `<article class="card"><div class="value">${value === null ? '—' : value.toLocaleString('en-US')}</div><div class="label">${escapeHtml(label)}</div><p class="note">${escapeHtml(note)}</p></article>`;
}

function rateCard(label: string, value: number | null, note: string): string {
  return metricCard(label, value === null ? null : Number((value * 100).toFixed(1)), `${note}${value === null ? '' : ' Displayed as percent.'}`)
    .replace(/(<div class="value">)([^<]+)(<\/div>)/, (_, before, displayed, after) => (
      `${before}${displayed === '—' ? displayed : `${displayed}%`}${after}`
    ));
}

function postTable(dataset: MarketingDashboardDataset): string {
  if (!dataset.mart.post_performance.length) return '<p class="note">No post rows are available.</p>';
  return `<table><thead><tr><th>Post</th><th>Platform</th><th>Views</th><th>Completion</th><th>Engagement</th></tr></thead><tbody>${
    dataset.mart.post_performance.map((row) => `<tr><td>${escapeHtml(row.post_id)}</td><td>${escapeHtml(row.platform)}</td><td>${formatNumber(row.views)}</td><td>${formatRate(row.completion_rate)}</td><td>${formatRate(row.engagement_rate)}</td></tr>`).join('')
  }</tbody></table>`;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function formatRate(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character] ?? character));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonemptyString(value, label);
}

function dateTime(value: unknown, label: string): string {
  const text = nonemptyString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid date-time`);
  return new Date(timestamp).toISOString();
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return value as number;
}

function nullableNonNegative(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be null or non-negative`);
  return value;
}

function nullableRate(value: unknown, label: string): number | null {
  const number = nullableNonNegative(value, label);
  if (number !== null && number > 1) throw new Error(`${label} must be between zero and one`);
  return number;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`${label} must be a string array`);
  return value as string[];
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} has an unsupported value`);
  return value as T;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains prohibited or unsupported fields: ${unknown.join(', ')}`);
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length) throw new Error(`${label} is missing required fields: ${missing.join(', ')}`);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function cliOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function main(): void {
  const storePath = path.resolve(cliOption('--store') ?? DEFAULT_METRICS_STORE_PATH);
  const eventsDirectory = path.resolve(cliOption('--events-dir') ?? path.join('.ops', 'metrics', 'owned_events'));
  const outputDirectory = path.resolve(cliOption('--output-dir') ?? path.join('.semantic-artifacts', 'marketing-dashboard'));
  const checkpoint = (cliOption('--checkpoint') ?? '24h') as TractionCheckpoint;
  const store = fs.existsSync(storePath)
    ? validatePostMetricsStore(JSON.parse(fs.readFileSync(storePath, 'utf8')))
    : { records: [] };
  const owned = loadOwnedEventsFromDirectory(eventsDirectory);
  const dataset = buildMarketingDashboardDataset({
    postMetricsStore: store,
    ownedEvents: owned.events,
    checkpoint,
  });
  const dataPath = path.join(outputDirectory, 'owned-marketing-dashboard.json');
  const htmlPath = path.join(outputDirectory, 'owned-marketing-dashboard.html');
  const manifestPath = path.join(outputDirectory, 'owned-marketing-dashboard-manifest.json');
  atomicWriteJson(dataPath, dataset);
  atomicWriteFile(htmlPath, renderMarketingDashboard(dataset));
  atomicWriteJson(manifestPath, {
    schema_version: 'owned_marketing_dashboard_build_v1',
    generated_at: dataset.generated_at,
    connection_state: dataset.connection_state,
    sources: {
      post_metrics: fs.existsSync(storePath) ? describeArtifact(storePath) : null,
      owned_events: owned.sources,
    },
    outputs: {
      data: describeArtifact(dataPath),
      html: describeArtifact(htmlPath),
    },
    quality: dataset.quality,
    evidence_boundaries: [
      'Only owned post metric snapshots and privacy-safe aggregate event facts populate KPIs.',
      'Competitor research never populates owned performance metrics.',
      'Missing values remain null and checkpoint joins are exact.',
    ],
  });
  process.stdout.write(`${JSON.stringify({
    connection_state: dataset.connection_state,
    posts: dataset.mart.post_count,
    events: dataset.facts.event_aggregates.length,
    checkpoint: dataset.mart.checkpoint,
    output_path: path.relative(process.cwd(), htmlPath),
    data_path: path.relative(process.cwd(), dataPath),
    manifest_path: path.relative(process.cwd(), manifestPath),
  }, null, 2)}\n`);
}

if (require.main === module) main();
