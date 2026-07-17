import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ApifyApiClient, canonicalJson, type ApifyActorExecution } from './apify-api';
import { atomicWriteJson } from './artifact-integrity';

export const JOB_CONTENT_SOURCE_IDS = ['runway', 'handshake', 'internships_com'] as const;
export const JOB_CONTENT_COHORTS = ['recent', 'popular'] as const;
export const JOB_CONTENT_TIKTOK_ACTOR = 'clockworks/tiktok-scraper';
const APIFY_MIN_RUN_CHARGE_CAP_USD = 0.5;

export type JobContentSourceId = typeof JOB_CONTENT_SOURCE_IDS[number];
export type JobContentCohort = typeof JOB_CONTENT_COHORTS[number];
export type JobContentSourceRelation = 'founder_profile' | 'brand_profile' | 'category_proxy';

export const JOB_CONTENT_SOURCE_CATALOG: Record<JobContentSourceId, {
  display_name: string;
  relation: JobContentSourceRelation;
  profiles: string[];
  search_queries: string[];
  identity_state: 'reviewed_founder' | 'official_linked_profile' | 'no_owned_profile_confirmed';
  identity_evidence_url: string;
  learning_goal: string;
}> = {
  runway: {
    display_name: 'Runway',
    relation: 'founder_profile',
    profiles: ['fordcoleman_'],
    search_queries: [],
    identity_state: 'reviewed_founder',
    identity_evidence_url: 'https://www.joinrunway.io/',
    learning_goal: 'Founder-led early-career positioning, urgency, job-search beliefs, and product education.',
  },
  handshake: {
    display_name: 'Handshake',
    relation: 'brand_profile',
    profiles: ['joinhandshake'],
    search_queries: [],
    identity_state: 'official_linked_profile',
    identity_evidence_url: 'https://joinhandshake.com/',
    learning_goal: 'Brand-led career education, opportunity alerts, relatable student content, and community prompts.',
  },
  internships_com: {
    display_name: 'Internships.com',
    relation: 'category_proxy',
    profiles: [],
    search_queries: [
      'internship search tips',
      'internship application mistakes',
      'internship openings',
    ],
    identity_state: 'no_owned_profile_confirmed',
    identity_evidence_url: 'https://www.internships.com/',
    learning_goal: 'The broader internship-search content language that the Internships.com brand must compete within.',
  },
};

export interface JobContentFeedRequest {
  feed_id: string;
  sources: JobContentSourceId[];
  cohorts: JobContentCohort[];
  max_results_per_profile: number;
  max_results_per_query: number;
  approval: {
    state: 'draft' | 'approved' | 'rejected';
    approved_by: string | null;
    approved_at: string | null;
  };
  cost_policy: {
    max_apify_usd: number;
  };
}

export interface JobContentFeedPreflight {
  feed_id: string;
  approved: boolean;
  public_research_gate_enabled: boolean;
  paid_gate_enabled: boolean;
  credential_presence: { apify_token: boolean };
  actor: { configured: boolean; allowlisted: boolean; environment_key: 'APIFY_ACTOR_TIKTOK' };
  source_count: number;
  planned_run_count: number;
  estimated_max_items: number;
  max_apify_usd: number;
  minimum_required_budget_usd: number;
  live_ready: boolean;
  blockers: string[];
  external_calls_made: 0;
}

export interface JobContentDiscoverySpec {
  source_id: JobContentSourceId;
  cohort: JobContentCohort;
  actor_id: string;
  build?: string;
  input_mode: 'profile' | 'search';
  input: Record<string, unknown>;
  expected_max_items: number;
}

export interface JobSearchContentItem {
  evidence_id: string;
  source_id: JobContentSourceId;
  source_relation: JobContentSourceRelation;
  cohort: JobContentCohort;
  cohorts_observed: JobContentCohort[];
  platform: 'tiktok';
  platform_post_id: string | null;
  canonical_url: string | null;
  caption: string;
  posted_at: string | null;
  author: {
    handle: string;
    display_name: string;
    profile_url: string | null;
    platform_verified: boolean | null;
  };
  source_query: string | null;
  hashtags: string[];
  observed_metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  signals: {
    hook_type: ContentHookType;
    topic: ContentTopic;
    format: ContentFormat;
    cta_type: ContentCtaType;
    claim_flags: string[];
  };
  provider_gap: string | null;
  provenance: {
    provider: 'apify';
    actor_id: string;
    actor_build_id: string | null;
    actor_build_number: string | null;
    actor_input_sha256: string;
    actor_input_mode: 'profile' | 'search';
    run_id: string;
    dataset_id: string;
    dataset_item_offset: number;
    raw_item_sha256: string;
    max_total_charge_usd: number;
    usage_total_usd: number | null;
    usage_finalized: boolean;
  };
}

export type ContentHookType =
  | 'numbered_list'
  | 'question'
  | 'warning_or_contrarian'
  | 'opportunity_alert'
  | 'outcome_or_proof'
  | 'relatable_identity'
  | 'direct_statement';

export type ContentTopic =
  | 'opportunity_alert'
  | 'resume_and_application'
  | 'networking'
  | 'interview'
  | 'intern_life'
  | 'career_identity'
  | 'job_search_strategy'
  | 'product_or_tool'
  | 'general_career';

export type ContentFormat =
  | 'slideshow'
  | 'reply'
  | 'day_in_the_life'
  | 'green_screen'
  | 'list_explainer'
  | 'long_explainer'
  | 'meme_or_reaction'
  | 'short_talking_point';

export type ContentCtaType =
  | 'comment_keyword'
  | 'save_or_share'
  | 'follow'
  | 'apply_or_click'
  | 'question_prompt'
  | 'none';

export interface JobContentSourceSummary {
  source_id: JobContentSourceId;
  display_name: string;
  relation: JobContentSourceRelation;
  identity_state: typeof JOB_CONTENT_SOURCE_CATALOG[JobContentSourceId]['identity_state'];
  item_count: number;
  recent_count: number;
  popular_count: number;
  median_observed_views: number | null;
  topics: Array<{ label: ContentTopic; count: number }>;
  hook_types: Array<{ label: ContentHookType; count: number }>;
  formats: Array<{ label: ContentFormat; count: number }>;
  cta_types: Array<{ label: ContentCtaType; count: number }>;
  language_markers: Array<{ term: string; count: number }>;
  top_observed: Array<{
    evidence_id: string;
    caption: string;
    canonical_url: string | null;
    views: number | null;
  }>;
  evidence_limitations: string[];
}

export interface JobContentFeedReport {
  feed_id: string;
  created_at: string;
  status: 'completed' | 'partial' | 'failed';
  request_sha256: string;
  items: JobSearchContentItem[];
  provider_gaps: JobSearchContentItem[];
  source_summaries: JobContentSourceSummary[];
  cross_source_patterns: {
    recurring_topics: Array<{ label: ContentTopic; count: number }>;
    recurring_hook_types: Array<{ label: ContentHookType; count: number }>;
    recurring_formats: Array<{ label: ContentFormat; count: number }>;
    recurring_cta_types: Array<{ label: ContentCtaType; count: number }>;
    language_markers: Array<{ term: string; count: number }>;
    observations: string[];
  };
  runs: Array<{
    source_id: JobContentSourceId;
    cohort: JobContentCohort;
    input_mode: 'profile' | 'search';
    run_id: string;
    dataset_id: string;
    actor_build_id: string | null;
    actor_build_number: string | null;
    item_count: number;
    dataset_items_total_reported: number | null;
    dataset_truncated: boolean;
    dataset_truncation_unknown: boolean;
    max_total_charge_usd: number;
    usage_total_usd: number | null;
    usage_finalized: boolean;
  }>;
  external_calls_made: number;
  total_usage_usd: number | null;
  evidence_boundary: {
    public_metadata_only: true;
    raw_media_downloaded: false;
    source_identity_is_inferred_from_search: false;
    rankings_are_causal_proof: false;
    category_proxy_is_official_brand_content: false;
  };
  errors: string[];
}

export function validateJobContentFeedRequest(value: unknown): JobContentFeedRequest {
  const record = object(value, 'job content feed request');
  const approval = object(record.approval, 'approval');
  const cost = object(record.cost_policy, 'cost_policy');
  const sources = unique(requiredStringArray(record.sources, 'sources').map((source) => (
    oneOf(source, JOB_CONTENT_SOURCE_IDS, 'sources')
  )));
  const cohorts = unique(requiredStringArray(record.cohorts, 'cohorts').map((cohort) => (
    oneOf(cohort, JOB_CONTENT_COHORTS, 'cohorts')
  )));
  if (!sources.length) throw new Error('sources must contain at least one source.');
  if (!cohorts.length) throw new Error('cohorts must contain at least one cohort.');
  const state = oneOf(
    requiredText(approval.state, 'approval.state'),
    ['draft', 'approved', 'rejected'] as const,
    'approval.state',
  );
  const approvedBy = optionalText(approval.approved_by);
  const approvedAt = optionalText(approval.approved_at);
  if (state === 'approved' && (!approvedBy || !approvedAt)) {
    throw new Error('Approved job content feed requests require approved_by and approved_at.');
  }
  if (approvedAt && !Number.isFinite(Date.parse(approvedAt))) {
    throw new Error('approval.approved_at must be an ISO-compatible timestamp.');
  }
  return {
    feed_id: requiredText(record.feed_id, 'feed_id'),
    sources,
    cohorts,
    max_results_per_profile: boundedInteger(record.max_results_per_profile, 'max_results_per_profile', 1, 25),
    max_results_per_query: boundedInteger(record.max_results_per_query, 'max_results_per_query', 1, 25),
    approval: {
      state,
      approved_by: approvedBy,
      approved_at: approvedAt,
    },
    cost_policy: {
      max_apify_usd: positiveNumber(cost.max_apify_usd, 'cost_policy.max_apify_usd'),
    },
  };
}

export function buildJobContentDiscoverySpecs(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): JobContentDiscoverySpec[] {
  const request = validateJobContentFeedRequest(value);
  const actorId = optionalText(env.APIFY_ACTOR_TIKTOK);
  if (!actorId) throw new Error('APIFY_ACTOR_TIKTOK is required.');
  if (actorId !== JOB_CONTENT_TIKTOK_ACTOR && !enabled(env.ALLOW_CUSTOM_APIFY_ACTORS)) {
    throw new Error('Configured TikTok Actor is not in the reviewed allowlist.');
  }
  return request.sources.flatMap((sourceId) => {
    const source = JOB_CONTENT_SOURCE_CATALOG[sourceId];
    return request.cohorts.map((cohort): JobContentDiscoverySpec => {
      const commonInput = {
        scrapeRelatedSearchWords: false,
        scrapeRelatedVideos: false,
        scrapeAdditionalAuthorMeta: false,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSlideshowImages: false,
        shouldDownloadAvatars: false,
        shouldDownloadMusicCovers: false,
        downloadSubtitlesOptions: 'NEVER_DOWNLOAD_SUBTITLES',
        commentsPerPost: 0,
        maxFollowersPerProfile: 0,
        maxFollowingPerProfile: 0,
      };
      if (source.profiles.length) {
        return {
          source_id: sourceId,
          cohort,
          actor_id: actorId,
          build: optionalText(env.APIFY_ACTOR_BUILD_TIKTOK) ?? undefined,
          input_mode: 'profile',
          expected_max_items: source.profiles.length * request.max_results_per_profile,
          input: {
            profiles: source.profiles,
            resultsPerPage: request.max_results_per_profile,
            profileSorting: cohort === 'popular' ? 'popular' : 'latest',
            ...commonInput,
          },
        };
      }
      return {
        source_id: sourceId,
        cohort,
        actor_id: actorId,
        build: optionalText(env.APIFY_ACTOR_BUILD_TIKTOK) ?? undefined,
        input_mode: 'search',
        expected_max_items: source.search_queries.length * request.max_results_per_query,
        input: {
          searchQueries: source.search_queries,
          searchSection: '/video',
          resultsPerPage: request.max_results_per_query,
          videoSearchSorting: cohort === 'popular' ? 'MOST_LIKED' : 'LATEST',
          videoSearchDateFilter: cohort === 'popular' ? 'LAST_6_MONTHS' : 'PAST_MONTH',
          ...commonInput,
        },
      };
    });
  });
}

export function buildJobContentFeedPreflight(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): JobContentFeedPreflight {
  const request = validateJobContentFeedRequest(value);
  const actorId = optionalText(env.APIFY_ACTOR_TIKTOK);
  const allowlisted = actorId === JOB_CONTENT_TIKTOK_ACTOR;
  const plannedRunCount = request.sources.length * request.cohorts.length;
  const minimumRequiredBudget = round(plannedRunCount * APIFY_MIN_RUN_CHARGE_CAP_USD, 2);
  const blockers: string[] = [];
  if (request.approval.state !== 'approved') blockers.push('job_content_feed_not_approved');
  if (!enabled(env.ALLOW_PUBLIC_SEO_RESEARCH)) blockers.push('ALLOW_PUBLIC_SEO_RESEARCH');
  if (!enabled(env.ALLOW_PAID_GENERATION)) blockers.push('ALLOW_PAID_GENERATION');
  if (!optionalText(env.APIFY_TOKEN)) blockers.push('APIFY_TOKEN');
  if (!actorId) blockers.push('APIFY_ACTOR_TIKTOK');
  else if (!allowlisted && !enabled(env.ALLOW_CUSTOM_APIFY_ACTORS)) blockers.push('allowlist:tiktok');
  if (request.cost_policy.max_apify_usd < minimumRequiredBudget) {
    blockers.push(`cost_policy.max_apify_usd>=${minimumRequiredBudget}`);
  }
  const estimatedMaxItems = request.sources.reduce((total, sourceId) => {
    const source = JOB_CONTENT_SOURCE_CATALOG[sourceId];
    const perCohort = source.profiles.length
      ? source.profiles.length * request.max_results_per_profile
      : source.search_queries.length * request.max_results_per_query;
    return total + perCohort * request.cohorts.length;
  }, 0);
  return {
    feed_id: request.feed_id,
    approved: request.approval.state === 'approved',
    public_research_gate_enabled: enabled(env.ALLOW_PUBLIC_SEO_RESEARCH),
    paid_gate_enabled: enabled(env.ALLOW_PAID_GENERATION),
    credential_presence: { apify_token: Boolean(optionalText(env.APIFY_TOKEN)) },
    actor: {
      configured: Boolean(actorId),
      allowlisted,
      environment_key: 'APIFY_ACTOR_TIKTOK',
    },
    source_count: request.sources.length,
    planned_run_count: plannedRunCount,
    estimated_max_items: estimatedMaxItems,
    max_apify_usd: request.cost_policy.max_apify_usd,
    minimum_required_budget_usd: minimumRequiredBudget,
    live_ready: blockers.length === 0,
    blockers,
    external_calls_made: 0,
  };
}

export async function runJobContentFeed(
  value: unknown,
  options: {
    outputPath: string;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
    usageSettlementMs?: number;
  },
): Promise<JobContentFeedReport> {
  const env = options.env ?? process.env;
  const request = validateJobContentFeedRequest(value);
  const preflight = buildJobContentFeedPreflight(request, env);
  if (!preflight.live_ready) throw new Error(`job_content_feed_blocked:${preflight.blockers.join(',')}`);
  const specs = buildJobContentDiscoverySpecs(request, env);
  const runCap = request.cost_policy.max_apify_usd / specs.length;
  const items: JobSearchContentItem[] = [];
  const providerGaps: JobSearchContentItem[] = [];
  const runs: JobContentFeedReport['runs'] = [];
  const errors: string[] = [];
  const now = options.now ?? (() => new Date());
  let externalCalls = 0;

  for (const spec of specs) {
    const client = new ApifyApiClient({
      token: optionalText(env.APIFY_TOKEN)!,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
    });
    try {
      const execution = await client.executeActor({
        actorId: spec.actor_id,
        build: spec.build,
        input: spec.input,
        inputMode: spec.input_mode,
        maxTotalChargeUsd: runCap,
        maxItems: spec.expected_max_items,
        maxDatasetItems: spec.expected_max_items + 10,
        pollIntervalMs: options.pollIntervalMs,
        maxPollAttempts: options.maxPollAttempts,
        usageSettlementMs: options.usageSettlementMs,
      });
      execution.items.forEach((item, index) => {
        const normalized = normalizeJobSearchContentItem(
          item,
          execution.item_offsets[index] ?? index,
          spec,
          execution,
          runCap,
          now().toISOString(),
        );
        if (normalized.provider_gap) providerGaps.push(normalized);
        else if (isExpectedProfileItem(normalized, spec)) items.push(normalized);
      });
      runs.push({
        source_id: spec.source_id,
        cohort: spec.cohort,
        input_mode: spec.input_mode,
        run_id: execution.run_id,
        dataset_id: execution.dataset_id,
        actor_build_id: execution.actor_build_id,
        actor_build_number: execution.actor_build_number,
        item_count: execution.items.length,
        dataset_items_total_reported: execution.dataset_items_total_reported,
        dataset_truncated: execution.dataset_truncated,
        dataset_truncation_unknown: execution.dataset_truncation_unknown,
        max_total_charge_usd: runCap,
        usage_total_usd: execution.actual_cost_usd,
        usage_finalized: execution.usage_finalized,
      });
    } catch (error) {
      errors.push(`${spec.source_id}:${spec.cohort}:${redactError(error instanceof Error ? error.message : String(error))}`);
    } finally {
      externalCalls += client.externalCallsMade;
    }
  }

  const knownCosts = runs.map((run) => run.usage_total_usd).filter((cost): cost is number => cost !== null);
  const uniqueItems = deduplicateJobContentItems(items);
  const report: JobContentFeedReport = {
    feed_id: request.feed_id,
    created_at: now().toISOString(),
    status: items.length ? (errors.length ? 'partial' : 'completed') : 'failed',
    request_sha256: sha256(canonicalJson(request)),
    items: uniqueItems,
    provider_gaps: providerGaps,
    source_summaries: request.sources.map((sourceId) => summarizeJobContentSource(
      sourceId,
      uniqueItems.filter((item) => item.source_id === sourceId),
    )),
    cross_source_patterns: summarizeCrossSourcePatterns(uniqueItems),
    runs,
    external_calls_made: externalCalls,
    total_usage_usd: runs.length > 0 && knownCosts.length === runs.length
      ? round(knownCosts.reduce((sum, cost) => sum + cost, 0), 6)
      : null,
    evidence_boundary: {
      public_metadata_only: true,
      raw_media_downloaded: false,
      source_identity_is_inferred_from_search: false,
      rankings_are_causal_proof: false,
      category_proxy_is_official_brand_content: false,
    },
    errors,
  };
  writeJobContentFeedReport(options.outputPath, report);
  return report;
}

export function normalizeJobSearchContentItem(
  raw: unknown,
  offset: number,
  spec: JobContentDiscoverySpec,
  execution: ApifyActorExecution,
  maxChargeUsd: number,
  capturedAt: string,
): JobSearchContentItem {
  const item = objectOrEmpty(raw);
  const author = objectOrEmpty(item.authorMeta);
  const caption = cleanCaption(firstText(item, ['text', 'description', 'caption']) ?? '');
  const postId = firstText(item, ['id', 'awemeId']);
  const canonicalUrl = firstText(item, ['webVideoUrl', 'url', 'videoUrl', 'shareUrl']);
  const providerGap = firstText(item, ['error', 'errorDescription', 'message']);
  return {
    evidence_id: `job-content:${spec.source_id}:${execution.run_id}:${offset}:${sha256(canonicalJson(raw)).slice(0, 12)}`,
    source_id: spec.source_id,
    source_relation: JOB_CONTENT_SOURCE_CATALOG[spec.source_id].relation,
    cohort: spec.cohort,
    cohorts_observed: [spec.cohort],
    platform: 'tiktok',
    platform_post_id: postId,
    canonical_url: canonicalUrl,
    caption,
    posted_at: isoDate(firstValue(item, ['createTimeISO', 'createTime', 'publishedAt'])),
    author: {
      handle: firstText(author, ['name', 'uniqueId']) ?? '',
      display_name: firstText(author, ['nickName', 'nickname', 'displayName']) ?? '',
      profile_url: firstText(author, ['profileUrl', 'url']),
      platform_verified: booleanOrNull(firstValue(author, ['verified'])),
    },
    source_query: firstText(item, ['searchQuery', 'input']),
    hashtags: hashtags(item.hashtags),
    observed_metrics: {
      views: numberOrNull(firstValue(item, ['playCount', 'viewCount', 'views'])),
      likes: numberOrNull(firstValue(item, ['diggCount', 'likeCount', 'likes'])),
      comments: numberOrNull(firstValue(item, ['commentCount', 'comments'])),
      shares: numberOrNull(firstValue(item, ['shareCount', 'shares'])),
      saves: numberOrNull(firstValue(item, ['collectCount', 'saveCount', 'saves'])),
    },
    signals: {
      hook_type: classifyHook(caption),
      topic: classifyTopic(caption),
      format: classifyFormat(caption, item),
      cta_type: classifyCta(caption),
      claim_flags: classifyClaimFlags(caption),
    },
    provider_gap: providerGap,
    provenance: {
      provider: 'apify',
      actor_id: execution.actor_id,
      actor_build_id: execution.actor_build_id,
      actor_build_number: execution.actor_build_number,
      actor_input_sha256: execution.actor_input_sha256,
      actor_input_mode: spec.input_mode,
      run_id: execution.run_id,
      dataset_id: execution.dataset_id,
      dataset_item_offset: offset,
      raw_item_sha256: sha256(canonicalJson(raw)),
      max_total_charge_usd: maxChargeUsd,
      usage_total_usd: execution.actual_cost_usd,
      usage_finalized: execution.usage_finalized,
    },
  };
}

export function summarizeJobContentSource(
  sourceId: JobContentSourceId,
  items: JobSearchContentItem[],
): JobContentSourceSummary {
  const source = JOB_CONTENT_SOURCE_CATALOG[sourceId];
  const topObserved = [...items]
    .sort((left, right) => (right.observed_metrics.views ?? -1) - (left.observed_metrics.views ?? -1))
    .slice(0, 5)
    .map((item) => ({
      evidence_id: item.evidence_id,
      caption: item.caption,
      canonical_url: item.canonical_url,
      views: item.observed_metrics.views,
    }));
  return {
    source_id: sourceId,
    display_name: source.display_name,
    relation: source.relation,
    identity_state: source.identity_state,
    item_count: items.length,
    recent_count: items.filter((item) => item.cohorts_observed.includes('recent')).length,
    popular_count: items.filter((item) => item.cohorts_observed.includes('popular')).length,
    median_observed_views: median(items.map((item) => item.observed_metrics.views).filter((view): view is number => view !== null)),
    topics: countLabels(items.map((item) => item.signals.topic)),
    hook_types: countLabels(items.map((item) => item.signals.hook_type)),
    formats: countLabels(items.map((item) => item.signals.format)),
    cta_types: countLabels(items.map((item) => item.signals.cta_type)),
    language_markers: languageMarkers(items),
    top_observed: topObserved,
    evidence_limitations: [
      'This is a bounded public metadata collection, not a complete account history.',
      'Observed views and engagement do not prove that a hook or format caused distribution.',
      ...(source.relation === 'category_proxy'
        ? ['This cohort represents the internship-search category, not official Internships.com social output.']
        : []),
    ],
  };
}

export function summarizeCrossSourcePatterns(items: JobSearchContentItem[]): JobContentFeedReport['cross_source_patterns'] {
  const topics = countLabels(items.map((item) => item.signals.topic));
  const hooks = countLabels(items.map((item) => item.signals.hook_type));
  const formats = countLabels(items.map((item) => item.signals.format));
  const ctas = countLabels(items.map((item) => item.signals.cta_type));
  const markers = languageMarkers(items);
  const observations: string[] = [];
  if (topics[0]) observations.push(`The most common topic in this bounded sample is ${humanize(topics[0].label)} (${topics[0].count} posts).`);
  if (hooks[0]) observations.push(`The most common opening structure is ${humanize(hooks[0].label)} (${hooks[0].count} posts).`);
  if (formats[0]) observations.push(`The most common metadata-inferred format is ${humanize(formats[0].label)} (${formats[0].count} posts).`);
  if (ctas[0] && ctas[0].label !== 'none') observations.push(`The most common explicit CTA is ${humanize(ctas[0].label)} (${ctas[0].count} posts).`);
  if (markers.length) observations.push(`Recurring category language includes ${markers.slice(0, 6).map((marker) => marker.term).join(', ')}.`);
  observations.push('Popular-post rankings are descriptive evidence, not causal proof; owned-account testing must determine what works for Internships.com.');
  return {
    recurring_topics: topics,
    recurring_hook_types: hooks,
    recurring_formats: formats,
    recurring_cta_types: ctas,
    language_markers: markers,
    observations,
  };
}

export function reanalyzeJobContentFeedReport(report: JobContentFeedReport): JobContentFeedReport {
  const reclassified = report.items.map((item) => {
    const caption = cleanCaption(item.caption);
    return {
      ...item,
      caption,
      cohorts_observed: unique(item.cohorts_observed?.length ? item.cohorts_observed : [item.cohort]),
      signals: {
        hook_type: classifyHook(caption),
        topic: classifyTopic(caption),
        format: classifyFormat(caption, { isSlideshow: item.signals.format === 'slideshow' }),
        cta_type: classifyCta(caption),
        claim_flags: classifyClaimFlags(caption),
      },
    };
  });
  const items = deduplicateJobContentItems(reclassified);
  const sourceIds = JOB_CONTENT_SOURCE_IDS.filter((sourceId) => (
    report.source_summaries.some((summary) => summary.source_id === sourceId)
    || items.some((item) => item.source_id === sourceId)
  ));
  return {
    ...report,
    items,
    source_summaries: sourceIds.map((sourceId) => summarizeJobContentSource(
      sourceId,
      items.filter((item) => item.source_id === sourceId),
    )),
    cross_source_patterns: summarizeCrossSourcePatterns(items),
  };
}

export function writeJobContentFeedReport(outputPath: string, report: JobContentFeedReport): string {
  const target = path.resolve(outputPath);
  atomicWriteJson(target, report);
  return target;
}

function isExpectedProfileItem(item: JobSearchContentItem, spec: JobContentDiscoverySpec): boolean {
  if (spec.input_mode !== 'profile') return true;
  const profiles = JOB_CONTENT_SOURCE_CATALOG[spec.source_id].profiles.map((profile) => profile.toLowerCase());
  return profiles.includes(item.author.handle.toLowerCase());
}

function deduplicateJobContentItems(items: JobSearchContentItem[]): JobSearchContentItem[] {
  const byKey = new Map<string, JobSearchContentItem>();
  for (const item of items) {
    const key = `${item.source_id}:${item.platform_post_id ?? item.canonical_url ?? item.evidence_id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...item,
        cohorts_observed: unique(item.cohorts_observed?.length ? item.cohorts_observed : [item.cohort]),
      });
      continue;
    }
    const preferred = (item.observed_metrics.views ?? -1) > (existing.observed_metrics.views ?? -1)
      ? item
      : existing;
    byKey.set(key, {
      ...preferred,
      cohorts_observed: unique([
        ...(existing.cohorts_observed?.length ? existing.cohorts_observed : [existing.cohort]),
        ...(item.cohorts_observed?.length ? item.cohorts_observed : [item.cohort]),
      ]),
    });
  }
  return [...byKey.values()];
}

function classifyHook(caption: string): ContentHookType {
  const text = caption.trim();
  if (/^(?:\d+|one|two|three|four|five)\b|\b\d+\s+(?:ways|things|tips|mistakes|steps|sites|roles)\b/i.test(text)) return 'numbered_list';
  if (/\b(?:now hiring|we(?:'re| are) hiring|hiring interns?|applications? (?:is|are) (?:open|live)|roles? (?:is|are) (?:open|live)|open now|deadline|opportunity alert)\b/i.test(text)) return 'opportunity_alert';
  if (/\b(?:stop|don't|do not|never|nobody tells|hot take|myth|mistake|wrong|avoid|before you)\b/i.test(text)) return 'warning_or_contrarian';
  if (/\b(?:how i (?:got|landed)|i (?:got|landed)|what i did|result|proof|offer|interviewed)\b/i.test(text)) return 'outcome_or_proof';
  if (/\?/.test(text) || /^(?:how|what|why|where|when|which|who|is|are|do|does|can|should)\b/i.test(text)) return 'question';
  if (text.length <= 120 && /\b(?:me when|pov|literally|girl|summer|cool cool|full time job|gasp|mood|type of)\b/i.test(text)) return 'relatable_identity';
  return 'direct_statement';
}

function classifyTopic(caption: string): ContentTopic {
  if (/\b(?:now hiring|we(?:'re| are) hiring|hiring interns?|applications? (?:is|are) (?:open|live)|roles? (?:is|are) (?:open|live)|open now|deadline|opportunity alert|remote roles?)\b/i.test(caption)) return 'opportunity_alert';
  if (/interview/i.test(caption)) return 'interview';
  if (/\b(?:resume|cover letter|application|apply|applying|applicant|qualification|job description)\b/i.test(caption)) return 'resume_and_application';
  if (/\b(?:network|coffee chat|referral|recruiter|alumni|message|email|linkedin)\b/i.test(caption)) return 'networking';
  if (/\b(?:day in (?:my|the) life|diml|intern life|summer internship|office perk|corporate gir)\b/i.test(caption)) return 'intern_life';
  if (/\b(?:major|career path|first job|dream job|career change|behind|college life|new grad|entry.level)\b/i.test(caption)) return 'career_identity';
  if (/\b(?:tool|platform|site|website|app|gemini|ai|tracker|notification|job board)\b/i.test(caption)) return 'product_or_tool';
  if (/\b(?:job search|internship search|land a job|land an internship|get ahead|early|timing|ghosted)\b/i.test(caption)) return 'job_search_strategy';
  return 'general_career';
}

function classifyFormat(caption: string, item: Record<string, unknown>): ContentFormat {
  if (item.isSlideshow === true || Array.isArray(item.slideshowImageLinks)) return 'slideshow';
  if (/^\s*replying to\b/i.test(caption)) return 'reply';
  if (/\b(?:day in (?:my|the) life|diml|grwm|morning routine)\b/i.test(caption)) return 'day_in_the_life';
  if (/\b#?greenscreen\b/i.test(caption)) return 'green_screen';
  if (/^(?:\d+|one|two|three|four|five)\b|\b\d+\s+(?:ways|things|tips|mistakes|steps|sites|roles)\b/i.test(caption)) return 'list_explainer';
  if (caption.length >= 240) return 'long_explainer';
  if (caption.length <= 120 && classifyHook(caption) === 'relatable_identity') return 'meme_or_reaction';
  return 'short_talking_point';
}

function classifyCta(caption: string): ContentCtaType {
  if (/\bcomment\b[^.\n]{0,50}(?:["“”']|\bfor\b)/i.test(caption)) return 'comment_keyword';
  if (/\b(?:save this|share this|repost|send this)\b/i.test(caption)) return 'save_or_share';
  if (/\bfollow\b/i.test(caption)) return 'follow';
  if (/\b(?:apply now|start applying|link in bio|click|sign up|start your search)\b/i.test(caption)) return 'apply_or_click';
  if (/\?/.test(caption)) return 'question_prompt';
  return 'none';
}

function classifyClaimFlags(caption: string): string[] {
  const flags: string[] = [];
  if (/\b(?:guarantee|guaranteed|will get you|land any|always get|never fail)\b/i.test(caption)) flags.push('guaranteed_outcome_language');
  if (/\b\d+(?:\.\d+)?[%x]\b|\b\d+\s+(?:offers?|interviews?|applications?|followers?|views?)\b/i.test(caption)) flags.push('numeric_outcome_claim');
  if (/\b(?:before everyone|apply first|too late|right now|today only|don't wait|immediately)\b/i.test(caption)) flags.push('urgency_claim');
  if (/\b(?:referral|refer you)\b/i.test(caption)) flags.push('referral_language');
  return flags;
}

function languageMarkers(items: JobSearchContentItem[]): Array<{ term: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const terms = unique(
      item.caption
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[@#][\w.]+/g, ' ')
        .match(/[a-z][a-z'-]{2,}/g) ?? [],
    );
    terms
      .filter((term) => !STOPWORDS.has(term))
      .forEach((term) => counts.set(term, (counts.get(term) ?? 0) + 1));
  }
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .filter((entry) => entry.count >= 2)
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
    .slice(0, 15);
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'all', 'also', 'and', 'are', 'because', 'been', 'before', 'being', 'but',
  'can', 'come', 'could', 'did', 'does', 'doing', 'don', 'for', 'from', 'get', 'got', 'had', 'has',
  'have', 'here', 'how', 'into', 'its', 'just', 'like', 'make', 'more', 'most', 'need', 'not', 'now',
  'one', 'only', 'our', 'out', 'over', 'people', 'really', 'right', 'say', 'should', 'some', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'this', 'those', 'through', 'too',
  'use', 'using', 'very', 'want', 'was', 'way', 'were', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'with', 'would', 'you', 'your',
]);

function cleanCaption(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\u0000/g, '')
    .trim();
}

function countLabels<T extends string>(labels: T[]): Array<{ label: T; count: number }> {
  const counts = new Map<T, number>();
  labels.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function hashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => {
    if (typeof item === 'string') return item.replace(/^#/, '').trim();
    return firstText(objectOrEmpty(item), ['name', 'title']) ?? '';
  }).filter(Boolean));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return value.map((item) => String(item).trim());
}

function requiredText(value: unknown, label: string): string {
  const result = optionalText(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function oneOf<T extends readonly string[]>(value: string, allowed: T, label: string): T[number] {
  if (!allowed.includes(value as T[number])) throw new Error(`${label} contains unsupported value: ${value}`);
  return value as T[number];
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  return value;
}

function firstText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2, 2);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function redactError(value: string): string {
  return value
    .replace(/apify_api_[A-Za-z0-9]+/g, '[REDACTED_APIFY_TOKEN]')
    .replace(/tlk_[A-Za-z0-9]+/g, '[REDACTED_TWELVELABS_TOKEN]')
    .slice(0, 500);
}
