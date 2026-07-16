import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ApifyApiClient, canonicalJson, type ApifyActorExecution } from './apify-api';

export const SEO_RESEARCH_PLATFORMS = ['youtube_shorts', 'tiktok'] as const;
export const SEO_RESEARCH_COHORTS = ['recent', 'popular'] as const;
export const APIFY_SOCIAL_ACTOR_ALLOWLIST = {
  youtube_shorts: 'streamers/youtube-scraper',
  tiktok: 'clockworks/tiktok-scraper',
} as const;
const APIFY_MIN_RUN_CHARGE_CAP_USD: Partial<Record<SeoResearchPlatform, number>> = {
  tiktok: 0.5,
};

export type SeoResearchPlatform = typeof SEO_RESEARCH_PLATFORMS[number];
export type SeoResearchCohort = typeof SEO_RESEARCH_COHORTS[number];

export interface SeoResearchRequest {
  research_id: string;
  niche: string;
  strategy_mode: 'valuation' | 'career_guidance';
  platforms: SeoResearchPlatform[];
  search_queries: string[];
  cohorts: SeoResearchCohort[];
  max_results_per_query: number;
  approval: {
    state: 'draft' | 'approved' | 'rejected';
    approved_by: string | null;
    approved_at: string | null;
  };
  cost_policy: {
    max_apify_usd: number;
  };
  house_style: {
    name: string;
    voice: string[];
    recurring_devices: string[];
    differentiators: string[];
  };
}

export interface SeoResearchPreflight {
  research_id: string;
  approved: boolean;
  public_research_gate_enabled: boolean;
  paid_gate_enabled: boolean;
  credential_presence: { apify_token: boolean };
  actors: Record<SeoResearchPlatform, { configured: boolean; allowlisted: boolean; environment_key: string }>;
  estimated_max_items: number;
  max_apify_usd: number;
  live_ready: boolean;
  blockers: string[];
  external_calls_made: 0;
}

export interface SeoDiscoveryCandidate {
  evidence_id: string;
  platform: SeoResearchPlatform;
  cohort: SeoResearchCohort;
  canonical_url: string | null;
  source_query: string | null;
  title: string;
  description: string;
  channel_name: string;
  channel_url: string | null;
  hashtags: string[];
  published_at_raw: string | null;
  duration_sec: number | null;
  observed_metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
  };
  metric_capture_at: string;
  provider_gap: string | null;
  provenance: {
    provider: 'apify';
    actor_id: string;
    actor_build_id: string | null;
    actor_build_number: string | null;
    actor_input_sha256: string;
    actor_input_mode: 'search';
    run_id: string;
    dataset_id: string;
    dataset_item_offset: number;
    raw_item_sha256: string;
    raw_artifact_path: string;
    max_total_charge_usd: number;
    usage_total_usd: number | null;
    usage_finalized: boolean;
  };
}

export interface SeoDiscoveryReport {
  research_id: string;
  created_at: string;
  status: 'completed' | 'partial' | 'failed';
  request_sha256: string;
  candidates: SeoDiscoveryCandidate[];
  provider_gaps: SeoDiscoveryCandidate[];
  runs: Array<{
    cohort: SeoResearchCohort;
    run_id: string;
    dataset_id: string;
    actor_build_id: string | null;
    actor_build_number: string | null;
    max_total_charge_usd: number;
    usage_total_usd: number | null;
    usage_finalized: boolean;
    raw_artifact_path: string;
  }>;
  external_calls_made: number;
  total_usage_usd: number | null;
  evidence_boundary: {
    ranking_label: 'top observed in this bounded collection';
    causal_claims_allowed: false;
    missing_metrics_are_zero: false;
    raw_media_downloaded: false;
  };
  errors: string[];
}

export interface SeoStrategyReport {
  strategy_id: string;
  research_id: string;
  created_at: string;
  niche: string;
  evidence_summary: {
    candidate_count: number;
    usable_candidate_count: number;
    cohorts: SeoResearchCohort[];
    evidence_ids: string[];
  };
  observed_patterns: Array<{
    pattern: string;
    evidence_ids: string[];
    observation: string;
  }>;
  derived_recommendations: Array<{
    recommendation: string;
    rationale: string;
    evidence_ids: string[];
    confidence: number;
    inference_method: 'bounded_pattern_synthesis';
  }>;
  search_intent: {
    primary_terms: string[];
    title_rules: string[];
    description_rules: string[];
  };
  house_style: SeoResearchRequest['house_style'];
  originality_constraints: string[];
  content_concepts: Array<{
    concept_id: string;
    working_title: string;
    opening_hook: string;
    structure: string[];
    seo_terms: string[];
    house_style_moves: string[];
    evidence_ids: string[];
    adaptation_note: string;
    prohibited_copying: string[];
  }>;
  limitations: string[];
  approval_state: 'draft';
}

interface DiscoverySpec {
  platform: SeoResearchPlatform;
  cohort: SeoResearchCohort;
  actorId: string;
  build?: string;
  input: Record<string, unknown>;
  expectedMaxItems: number;
}

export function validateSeoResearchRequest(value: unknown): SeoResearchRequest {
  const record = object(value, 'SEO research request');
  const approval = object(record.approval, 'approval');
  const cost = object(record.cost_policy, 'cost_policy');
  const style = object(record.house_style, 'house_style');
  const request: SeoResearchRequest = {
    research_id: requiredText(record.research_id, 'research_id'),
    niche: requiredText(record.niche, 'niche'),
    strategy_mode: record.strategy_mode === undefined
      ? 'valuation'
      : oneOf(requiredText(record.strategy_mode, 'strategy_mode'), ['valuation', 'career_guidance'] as const, 'strategy_mode'),
    platforms: unique(requiredStringArray(record.platforms, 'platforms').map((item) => oneOf(item, SEO_RESEARCH_PLATFORMS, 'platforms'))),
    search_queries: unique(requiredStringArray(record.search_queries, 'search_queries').map((item) => item.trim())),
    cohorts: unique(requiredStringArray(record.cohorts, 'cohorts').map((item) => oneOf(item, SEO_RESEARCH_COHORTS, 'cohorts'))),
    max_results_per_query: boundedInteger(record.max_results_per_query, 'max_results_per_query', 1, 50),
    approval: {
      state: oneOf(requiredText(approval.state, 'approval.state'), ['draft', 'approved', 'rejected'] as const, 'approval.state'),
      approved_by: optionalText(approval.approved_by),
      approved_at: optionalText(approval.approved_at),
    },
    cost_policy: {
      max_apify_usd: positiveNumber(cost.max_apify_usd, 'cost_policy.max_apify_usd'),
    },
    house_style: {
      name: requiredText(style.name, 'house_style.name'),
      voice: requiredStringArray(style.voice, 'house_style.voice'),
      recurring_devices: requiredStringArray(style.recurring_devices, 'house_style.recurring_devices'),
      differentiators: requiredStringArray(style.differentiators, 'house_style.differentiators'),
    },
  };
  if (!request.platforms.length) throw new Error('platforms must contain at least one platform.');
  if (!request.search_queries.length || request.search_queries.length > 10) throw new Error('search_queries must contain 1 to 10 queries.');
  if (!request.cohorts.length) throw new Error('cohorts must contain at least one cohort.');
  if (request.approval.state === 'approved' && (!request.approval.approved_by || !request.approval.approved_at)) {
    throw new Error('Approved research requires approved_by and approved_at.');
  }
  if (request.approval.approved_at && !Number.isFinite(Date.parse(request.approval.approved_at))) {
    throw new Error('approval.approved_at must be an ISO-compatible timestamp.');
  }
  if (!request.house_style.voice.length || !request.house_style.differentiators.length) {
    throw new Error('house_style must define voice and differentiators.');
  }
  return request;
}

export function buildSeoResearchPreflight(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): SeoResearchPreflight {
  const request = validateSeoResearchRequest(value);
  const actors = Object.fromEntries(
    SEO_RESEARCH_PLATFORMS.map((platform) => [platform, actorReadiness(platform, env)]),
  ) as SeoResearchPreflight['actors'];
  const blockers: string[] = [];
  if (request.approval.state !== 'approved') blockers.push('seo_research_not_approved');
  if (!enabled(env.ALLOW_PUBLIC_SEO_RESEARCH)) blockers.push('ALLOW_PUBLIC_SEO_RESEARCH');
  if (!enabled(env.ALLOW_PAID_GENERATION)) blockers.push('ALLOW_PAID_GENERATION');
  if (!optionalText(env.APIFY_TOKEN)) blockers.push('APIFY_TOKEN');
  for (const platform of request.platforms) {
    if (!actors[platform].configured) blockers.push(actors[platform].environment_key);
    else if (!actors[platform].allowlisted && !enabled(env.ALLOW_CUSTOM_APIFY_ACTORS)) blockers.push(`allowlist:${platform}`);
  }
  const minimumRequiredBudget = request.platforms.reduce((total, platform) => (
    total + (APIFY_MIN_RUN_CHARGE_CAP_USD[platform] ?? 0) * request.cohorts.length
  ), 0);
  if (request.cost_policy.max_apify_usd < minimumRequiredBudget) {
    blockers.push(`cost_policy.max_apify_usd>=${round(minimumRequiredBudget, 2)}`);
  }
  return {
    research_id: request.research_id,
    approved: request.approval.state === 'approved',
    public_research_gate_enabled: enabled(env.ALLOW_PUBLIC_SEO_RESEARCH),
    paid_gate_enabled: enabled(env.ALLOW_PAID_GENERATION),
    credential_presence: { apify_token: Boolean(optionalText(env.APIFY_TOKEN)) },
    actors,
    estimated_max_items: request.platforms.length * request.cohorts.length * request.search_queries.length * request.max_results_per_query,
    max_apify_usd: request.cost_policy.max_apify_usd,
    live_ready: blockers.length === 0,
    blockers,
    external_calls_made: 0,
  };
}

export function buildSeoDiscoverySpecs(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): DiscoverySpec[] {
  const request = validateSeoResearchRequest(value);
  return request.platforms.flatMap((platform) => request.cohorts.map((cohort): DiscoverySpec => {
    const readiness = actorReadiness(platform, env);
    if (!readiness.configured) throw new Error(`${readiness.environment_key} is required.`);
    if (!readiness.allowlisted && !enabled(env.ALLOW_CUSTOM_APIFY_ACTORS)) {
      throw new Error(`Configured Actor for ${platform} is not in the reviewed allowlist.`);
    }
    const expectedMaxItems = request.search_queries.length * request.max_results_per_query;
    if (platform === 'tiktok') {
      return {
        platform,
        cohort,
        actorId: optionalText(env.APIFY_ACTOR_TIKTOK)!,
        build: optionalText(env.APIFY_ACTOR_BUILD_TIKTOK) ?? undefined,
        expectedMaxItems,
        input: {
          searchQueries: request.search_queries,
          searchSection: '/video',
          resultsPerPage: request.max_results_per_query,
          videoSearchSorting: cohort === 'popular' ? 'MOST_LIKED' : 'LATEST',
          videoSearchDateFilter: cohort === 'popular' ? 'LAST_6_MONTHS' : 'PAST_MONTH',
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
        },
      };
    }
    return {
      platform,
      cohort,
      actorId: optionalText(env.APIFY_ACTOR_YOUTUBE)!,
      build: optionalText(env.APIFY_ACTOR_BUILD_YOUTUBE) ?? undefined,
      expectedMaxItems,
      input: {
        searchQueries: request.search_queries,
        maxResults: 0,
        maxResultsShorts: request.max_results_per_query,
        maxResultStreams: 0,
        sortingOrder: cohort === 'popular' ? 'views' : 'date',
        dateFilter: 'month',
        downloadSubtitles: false,
        saveSubsToKVS: false,
        aiVideoDescription: false,
        aiVideoSummary: false,
      },
    };
  }));
}

export async function runSeoDiscovery(
  value: unknown,
  options: {
    outputDir: string;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
    usageSettlementMs?: number;
  },
): Promise<SeoDiscoveryReport> {
  const env = options.env ?? process.env;
  const request = validateSeoResearchRequest(value);
  const preflight = buildSeoResearchPreflight(request, env);
  if (!preflight.live_ready) throw new Error(`seo_research_blocked:${preflight.blockers.join(',')}`);
  const token = optionalText(env.APIFY_TOKEN)!;
  const specs = buildSeoDiscoverySpecs(request, env);
  const runCap = request.cost_policy.max_apify_usd / specs.length;
  const outputDir = path.resolve(options.outputDir);
  const now = options.now ?? (() => new Date());
  const candidates: SeoDiscoveryCandidate[] = [];
  const providerGaps: SeoDiscoveryCandidate[] = [];
  const runs: SeoDiscoveryReport['runs'] = [];
  const errors: string[] = [];
  let externalCalls = 0;

  for (const spec of specs) {
    const client = new ApifyApiClient({ token, fetchImpl: options.fetchImpl, sleep: options.sleep });
    try {
      const execution = await client.executeActor({
        actorId: spec.actorId,
        build: spec.build,
        input: spec.input,
        inputMode: 'search',
        maxTotalChargeUsd: runCap,
        maxItems: spec.expectedMaxItems,
        maxDatasetItems: spec.expectedMaxItems + 10,
        pollIntervalMs: options.pollIntervalMs,
        maxPollAttempts: options.maxPollAttempts,
        usageSettlementMs: options.usageSettlementMs,
      });
      const rawArtifactPath = writeRawDiscoveryArtifact(outputDir, request.research_id, spec, execution);
      const normalized = execution.items.map((item, index) => normalizeDiscoveryCandidate(
        item,
        execution.item_offsets[index] ?? index,
        spec,
        execution,
        rawArtifactPath,
        runCap,
        now().toISOString(),
      ));
      candidates.push(...normalized.filter((candidate) => !candidate.provider_gap));
      providerGaps.push(...normalized.filter((candidate) => candidate.provider_gap));
      runs.push({
        cohort: spec.cohort,
        run_id: execution.run_id,
        dataset_id: execution.dataset_id,
        actor_build_id: execution.actor_build_id,
        actor_build_number: execution.actor_build_number,
        max_total_charge_usd: runCap,
        usage_total_usd: execution.actual_cost_usd,
        usage_finalized: execution.usage_finalized,
        raw_artifact_path: rawArtifactPath,
      });
    } catch (error) {
      errors.push(redactError(error instanceof Error ? error.message : String(error)));
    } finally {
      externalCalls += client.externalCallsMade;
    }
  }

  const knownCosts = runs.map((run) => run.usage_total_usd).filter((value): value is number => value !== null);
  const report: SeoDiscoveryReport = {
    research_id: request.research_id,
    created_at: now().toISOString(),
    status: candidates.length ? (errors.length ? 'partial' : 'completed') : 'failed',
    request_sha256: sha256(canonicalJson(request)),
    candidates,
    provider_gaps: providerGaps,
    runs,
    external_calls_made: externalCalls,
    total_usage_usd: runs.length > 0 && knownCosts.length === runs.length
      ? round(knownCosts.reduce((sum, cost) => sum + cost, 0), 6)
      : null,
    evidence_boundary: {
      ranking_label: 'top observed in this bounded collection',
      causal_claims_allowed: false,
      missing_metrics_are_zero: false,
      raw_media_downloaded: false,
    },
    errors,
  };
  writeJsonAtomic(path.join(outputDir, `${safeName(request.research_id)}-discovery.json`), report);
  return report;
}

export function buildSeoStrategyReport(
  requestValue: unknown,
  discovery: SeoDiscoveryReport,
  now: () => Date = () => new Date(),
): SeoStrategyReport {
  const request = validateSeoResearchRequest(requestValue);
  if (discovery.research_id !== request.research_id) throw new Error('Discovery report research_id does not match the request.');
  const usable = discovery.candidates.filter((candidate) => !candidate.provider_gap && candidate.title.trim());
  const ranked = [...usable].sort((left, right) => (right.observed_metrics.views ?? -1) - (left.observed_metrics.views ?? -1));
  const evidenceIds = ranked.slice(0, 20).map((candidate) => candidate.evidence_id);
  const top = ranked.slice(0, Math.min(10, ranked.length));
  const hookGroups = groupHookPatterns(top);
  const terms = commonTerms(request.search_queries, top);
  const observedPatterns: SeoStrategyReport['observed_patterns'] = [];
  for (const group of hookGroups.slice(0, 3)) {
    observedPatterns.push({
      pattern: group.label,
      evidence_ids: group.candidates.map((candidate) => candidate.evidence_id),
      observation: `${group.candidates.length} of the ${top.length} highest-view observed titles in this bounded sample use ${group.label}.`,
    });
  }
  if (top.length) {
    const averageLength = Math.round(top.reduce((sum, candidate) => sum + candidate.title.length, 0) / top.length);
    observedPatterns.push({
      pattern: 'title length',
      evidence_ids: top.map((candidate) => candidate.evidence_id),
      observation: `The ${top.length} highest-view observed titles average ${averageLength} characters in this collection.`,
    });
  }
  const confidence = Math.min(0.85, round(0.35 + usable.length / 100, 2));
  const recommendations: SeoStrategyReport['derived_recommendations'] = request.strategy_mode === 'career_guidance'
    ? [
      {
        recommendation: 'Name the internship-search problem in the first title clause and answer it in the first two spoken seconds.',
        rationale: 'This combines explicit query alignment with the recurring warning, question, and numbered-list structures observed in the bounded cohort.',
        evidence_ids: evidenceIds.slice(0, 8),
        confidence,
        inference_method: 'bounded_pattern_synthesis',
      },
      {
        recommendation: 'Show a concrete signal stack—role language, earned proof, a human connection, and review—before the product CTA.',
        rationale: `The adaptation preserves ${request.house_style.name} while turning compact problem-to-answer pacing into verifiable student actions.`,
        evidence_ids: evidenceIds.slice(0, 8),
        confidence,
        inference_method: 'bounded_pattern_synthesis',
      },
      {
        recommendation: 'Publish distinct recent and evergreen query variants, then learn from owned retention and completion metrics.',
        rationale: 'Recent and popular cohorts answer different questions, and public metrics do not establish causality.',
        evidence_ids: evidenceIds,
        confidence: Math.min(confidence, 0.75),
        inference_method: 'bounded_pattern_synthesis',
      },
    ]
    : [
      {
        recommendation: 'Put the searchable item and risk or payoff in the first title clause and the first two spoken seconds.',
        rationale: 'This combines explicit query alignment with the recurring warning, question, or verdict structures observed in the bounded cohort.',
        evidence_ids: evidenceIds.slice(0, 8),
        confidence,
        inference_method: 'bounded_pattern_synthesis',
      },
      {
        recommendation: 'Show the inspection proof before stating a valuation range; label uncertainty and invite the next item to scan.',
        rationale: `The adaptation preserves ${request.house_style.name} while using the cohort's compact problem-to-answer pacing.`,
        evidence_ids: evidenceIds.slice(0, 8),
        confidence,
        inference_method: 'bounded_pattern_synthesis',
      },
      {
        recommendation: 'Publish distinct recent and evergreen variants instead of treating raw view count as a universal winner signal.',
        rationale: 'Recent and popular cohorts answer different questions, and public metrics do not establish causality.',
        evidence_ids: evidenceIds,
        confidence: Math.min(confidence, 0.75),
        inference_method: 'bounded_pattern_synthesis',
      },
    ];
  const primaryTerms = terms.slice(0, 12);
  const concepts = conceptTemplates(request, primaryTerms, evidenceIds);
  return {
    strategy_id: `${request.research_id}:strategy:${sha256(canonicalJson({ primaryTerms, evidenceIds })).slice(0, 12)}`,
    research_id: request.research_id,
    created_at: now().toISOString(),
    niche: request.niche,
    evidence_summary: {
      candidate_count: discovery.candidates.length + discovery.provider_gaps.length,
      usable_candidate_count: usable.length,
      cohorts: unique(usable.map((candidate) => candidate.cohort)),
      evidence_ids: evidenceIds,
    },
    observed_patterns: observedPatterns,
    derived_recommendations: recommendations,
    search_intent: {
      primary_terms: primaryTerms,
      title_rules: request.strategy_mode === 'career_guidance'
        ? [
          'Use the exact student problem in natural search language.',
          'Pair it with a concrete fix, checklist, before/after, or decision.',
          'Do not promise an internship, referral, interview, or response.',
        ]
        : [
          'Name the item or problem using natural search language.',
          'Pair the noun with a concrete risk, check, comparison, or verdict.',
          'Keep the title accurate to visible or sourced evidence; no unsupported price or condition claim.',
        ],
      description_rules: request.strategy_mode === 'career_guidance'
        ? [
          'Answer the student question in the first sentence.',
          'Separate sourced platform behavior from advice and examples.',
          'Use a small relevant hashtag set; do not stuff unrelated trend terms.',
        ]
        : [
          'Answer the search intent in the first sentence.',
          'Name the checks performed and the limits of the estimate.',
          'Use a small relevant hashtag set; do not stuff unrelated trend terms.',
        ],
    },
    house_style: request.house_style,
    originality_constraints: [
      'Never copy a collected title, script, shot sequence, thumbnail, or creator identity verbatim.',
      'Adapt structural principles from multiple evidence items, not the expression of one source.',
      'Use only owned, licensed, or purpose-created media in generated content.',
      'Separate observed public metrics from inferred creative recommendations.',
      'Do not claim that a format caused performance; validate the house-style variant with owned post metrics.',
    ],
    content_concepts: concepts,
    limitations: [
      'Apify discovery is a bounded, time-stamped sample rather than a complete platform census.',
      'Public view and engagement metrics are observations, not causal proof of an SEO or creative choice.',
      'TwelveLabs is reserved for owned/licensed raw media or approved local drafts; social page URLs and competitor footage are not analyzed here.',
      ...(discovery.total_usage_usd === null ? ['At least one Apify run cost had not finalized, so total usage is a measurement gap.'] : []),
    ],
    approval_state: 'draft',
  };
}

export function writeSeoStrategyReport(outputPath: string, report: SeoStrategyReport): string {
  const target = path.resolve(outputPath);
  writeJsonAtomic(target, report);
  return target;
}

function actorReadiness(platform: SeoResearchPlatform, env: Record<string, string | undefined>) {
  const environmentKey = platform === 'youtube_shorts' ? 'APIFY_ACTOR_YOUTUBE' : 'APIFY_ACTOR_TIKTOK';
  const configured = optionalText(env[environmentKey]);
  return {
    configured: Boolean(configured),
    allowlisted: configured === APIFY_SOCIAL_ACTOR_ALLOWLIST[platform],
    environment_key: environmentKey,
  };
}

function normalizeDiscoveryCandidate(
  raw: unknown,
  offset: number,
  spec: DiscoverySpec,
  execution: ApifyActorExecution,
  rawArtifactPath: string,
  maxChargeUsd: number,
  capturedAt: string,
): SeoDiscoveryCandidate {
  const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const providerGap = providerGapText(item);
  const url = firstTextAt(item, spec.platform === 'tiktok'
    ? ['webVideoUrl', 'url', 'videoUrl', 'shareUrl']
    : ['url', 'videoUrl', 'webpageUrl']);
  const id = firstTextAt(item, ['id', 'videoId', 'awemeId']);
  const authorName = firstTextAt(item, ['authorMeta.name', 'authorMeta.nickName', 'author', 'authorName', 'channelName']);
  const canonicalUrl = spec.platform === 'tiktok'
    ? canonicalTikTokUrl(url, id, authorName)
    : canonicalYouTubeUrl(url, id);
  const title = firstTextAt(item, spec.platform === 'tiktok'
    ? ['text', 'desc', 'description', 'title']
    : ['title', 'name']) ?? '';
  const description = firstTextAt(item, ['description', 'text', 'desc']) ?? '';
  const channelName = spec.platform === 'tiktok'
    ? authorName ?? 'unknown'
    : firstTextAt(item, ['channelName', 'channelTitle', 'channelId']) ?? 'unknown';
  const sourceQuery = firstTextAt(item, ['searchQuery', 'query', 'fromYTUrl']);
  const rawHash = sha256(canonicalJson(raw));
  return {
    evidence_id: `apify:${execution.run_id}:item:${offset}:${rawHash.slice(0, 10)}`,
    platform: spec.platform,
    cohort: spec.cohort,
    canonical_url: canonicalUrl,
    source_query: sourceQuery,
    title,
    description,
    channel_name: channelName,
    channel_url: spec.platform === 'tiktok'
      ? firstTextAt(item, ['authorMeta.profileUrl', 'authorMeta.url', 'authorUrl'])
      : firstTextAt(item, ['channelUrl', 'inputChannelUrl']),
    hashtags: unique([
      ...extractHashtags(title),
      ...extractHashtags(description),
      ...hashtagArray(item.hashtags),
    ]),
    published_at_raw: firstTextAt(item, ['createTimeISO', 'createTime', 'date', 'publishedAt', 'publishedTimeText']),
    duration_sec: firstNumberAt(item, ['videoMeta.duration', 'videoMeta.durationSeconds', 'durationSeconds', 'durationSec', 'duration']),
    observed_metrics: {
      views: firstNumberAt(item, ['playCount', 'stats.playCount', 'viewCount', 'views']),
      likes: firstNumberAt(item, ['diggCount', 'stats.diggCount', 'likes', 'likeCount']),
      comments: firstNumberAt(item, ['commentCount', 'stats.commentCount', 'commentsCount', 'comments']),
    },
    metric_capture_at: capturedAt,
    provider_gap: providerGap,
    provenance: {
      provider: 'apify',
      actor_id: execution.actor_id,
      actor_build_id: execution.actor_build_id,
      actor_build_number: execution.actor_build_number,
      actor_input_sha256: execution.actor_input_sha256,
      actor_input_mode: 'search',
      run_id: execution.run_id,
      dataset_id: execution.dataset_id,
      dataset_item_offset: offset,
      raw_item_sha256: rawHash,
      raw_artifact_path: rawArtifactPath,
      max_total_charge_usd: maxChargeUsd,
      usage_total_usd: execution.actual_cost_usd,
      usage_finalized: execution.usage_finalized,
    },
  };
}

function providerGapText(item: Record<string, unknown>): string | null {
  return firstTextAt(item, ['errorCode', 'error', 'errorDescription', 'errorMessage']);
}

function canonicalTikTokUrl(url: string | null, id: string | null, authorName: string | null): string | null {
  if (url) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/^\/(?:@[^/]+)\/(?:video|photo)\/(\d+)/);
      if ((parsed.hostname === 'tiktok.com' || parsed.hostname.endsWith('.tiktok.com')) && match) {
        const account = parsed.pathname.split('/')[1];
        return `https://www.tiktok.com/${account}/video/${match[1]}`;
      }
    } catch {
      return null;
    }
  }
  const cleanAuthor = authorName?.replace(/^@/, '').trim();
  if (id && /^\d+$/.test(id) && cleanAuthor) return `https://www.tiktok.com/@${cleanAuthor}/video/${id}`;
  return null;
}

function canonicalYouTubeUrl(url: string | null, id: string | null): string | null {
  if (id) return `https://www.youtube.com/shorts/${id}`;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname.endsWith('youtube.com') && parts[0] === 'shorts' && parts[1]) {
      return `https://www.youtube.com/shorts/${parts[1]}`;
    }
    if (parsed.hostname === 'youtu.be' && parts[0]) return `https://www.youtube.com/shorts/${parts[0]}`;
    if (parsed.hostname.endsWith('youtube.com') && parsed.searchParams.get('v')) {
      return `https://www.youtube.com/shorts/${parsed.searchParams.get('v')}`;
    }
  } catch {
    return null;
  }
  return null;
}

function groupHookPatterns(candidates: SeoDiscoveryCandidate[]): Array<{ label: string; candidates: SeoDiscoveryCandidate[] }> {
  const definitions: Array<[string, RegExp]> = [
    ['a warning or loss-avoidance frame', /\b(?:avoid|warning|mistake|scam|risk|never|before you|don\W?t|waste|problem)\b/i],
    ['a question or explicit answer frame', /\?|\b(?:how|why|what|which|worth|should|can)\b/i],
    ['a number, price, or ranked-list frame', /(?:\$|\b\d+[,.]?\d*\b|\bthree\b|\bfive\b|\btop\b)/i],
    ['a verdict or transformation frame', /\b(?:buy|pass|deal|worth|result|changed|fixed|flip|profit)\b/i],
  ];
  return definitions
    .map(([label, pattern]) => ({ label, candidates: candidates.filter((candidate) => pattern.test(candidate.title)) }))
    .filter((group) => group.candidates.length)
    .sort((left, right) => right.candidates.length - left.candidates.length || left.label.localeCompare(right.label));
}

function commonTerms(queries: string[], candidates: SeoDiscoveryCandidate[]): string[] {
  const stop = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'best', 'buy', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'shorts', 'the', 'this', 'to', 'used', 'video', 'what', 'with', 'you', 'your']);
  const counts = new Map<string, number>();
  for (const text of [...queries, ...candidates.flatMap((candidate) => [candidate.title, candidate.description])]) {
    for (const term of text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []) {
      if (stop.has(term)) continue;
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([term]) => term);
}

function conceptTemplates(
  request: SeoResearchRequest,
  terms: string[],
  evidenceIds: string[],
): SeoStrategyReport['content_concepts'] {
  const noun = terms[0] ?? request.niche;
  const shared = {
    seo_terms: terms.slice(0, 8),
    house_style_moves: unique([...request.house_style.recurring_devices, ...request.house_style.differentiators]).slice(0, 5),
    evidence_ids: evidenceIds.slice(0, 10),
    prohibited_copying: ['source wording', 'source footage', 'source shot order', 'creator likeness or identity'],
  };
  if (request.strategy_mode === 'career_guidance') {
    return [
      {
        concept_id: `${request.research_id}:signal-stack`,
        working_title: '4 signals your internship application may be missing',
        opening_hook: 'Before you send another internship application, check these four signals.',
        structure: ['Name the target role', 'Match only language supported by real experience', 'Turn coursework or projects into proof', 'Find a relevant alumni bridge', 'Review and send; never imply auto-submission'],
        ...shared,
        adaptation_note: 'Adapts the observed checklist and warning structures into an original, verifiable student action stack.',
      },
      {
        concept_id: `${request.research_id}:listing-to-resume`,
        working_title: 'Turn one internship listing into a stronger resume',
        opening_hook: 'Do not copy the listing—translate its real requirements into proof you already earned.',
        structure: ['Show one role phrase', 'Map it to real coursework or project evidence', 'Rewrite one bullet without inventing experience', 'Read it back for accuracy', 'Review and send manually'],
        ...shared,
        adaptation_note: 'Uses before/after pacing while making factual accuracy and student review the house-style differentiator.',
      },
      {
        concept_id: `${request.research_id}:alumni-bridge`,
        working_title: 'Before you apply, look for this alumni bridge',
        opening_hook: 'A relevant connection is a research path, not a guaranteed referral.',
        structure: ['Name the target company or function', 'Find one relevant alumni path', 'Draft a specific low-pressure question', 'Show the no-guarantee boundary', 'Return to the application checklist'],
        ...shared,
        adaptation_note: 'Turns a networking payoff into a privacy-safe, non-spammy research workflow with no outcome promise.',
      },
    ];
  }
  return [
    {
      concept_id: `${request.research_id}:hidden-cost`,
      working_title: `${titleCase(noun)} deal or hidden-cost trap? 5 checks before you buy`,
      opening_hook: `This ${noun} can look cheap until one hidden repair erases the deal.`,
      structure: ['Show the item and search phrase', 'Reveal the highest-risk unknown', 'Run three visible checks', 'Compare a sourced range', 'Give a qualified buy/pass verdict and invite the next scan'],
      ...shared,
      adaptation_note: 'Adapts the observed warning and checklist structures into an evidence-first WorthScan audit with original wording and media.',
    },
    {
      concept_id: `${request.research_id}:three-comps`,
      working_title: `What is this ${noun} worth? Three comps changed the answer`,
      opening_hook: `The asking price is not the answer; three comparable listings are.`,
      structure: ['State the exact item', 'Show three comparable observations', 'Adjust for condition and missing evidence', 'Present a range and confidence', 'Ask viewers what to scan next'],
      ...shared,
      adaptation_note: 'Uses the observed answer/verdict frame but makes sourced comparison and uncertainty the distinctive house device.',
    },
    {
      concept_id: `${request.research_id}:proof-first`,
      working_title: `Before buying a ${noun}, make the seller show these clues`,
      opening_hook: `No proof of this one detail? Price the uncertainty in.`,
      structure: ['Open on the missing proof', 'Name the seller question', 'Show acceptable and weak evidence', 'Translate uncertainty into a range adjustment', 'Close with the WorthScan disclaimer'],
      ...shared,
      adaptation_note: 'Turns compact search-answer pacing into an original proof-first buyer education format.',
    },
  ];
}

function writeRawDiscoveryArtifact(
  outputDir: string,
  researchId: string,
  spec: DiscoverySpec,
  execution: ApifyActorExecution,
): string {
  const payload = {
    research_id: researchId,
    platform: spec.platform,
    cohort: spec.cohort,
    actor_id: execution.actor_id,
    actor_build_id: execution.actor_build_id,
    actor_build_number: execution.actor_build_number,
    actor_input_sha256: execution.actor_input_sha256,
    run_id: execution.run_id,
    dataset_id: execution.dataset_id,
    item_offsets: execution.item_offsets,
    items: execution.items,
  };
  const hash = sha256(canonicalJson(payload));
  const target = path.join(outputDir, 'raw', safeName(researchId), `${spec.platform}-${spec.cohort}-${hash.slice(0, 16)}.json`);
  writeJsonAtomic(target, payload);
  return target;
}

function writeJsonAtomic(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === serialized) return;
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, serialized, { flag: 'wx' });
  fs.renameSync(temporary, target);
}

function firstTextAt(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = optionalText(valueAtPath(record, key));
    if (value) return value;
  }
  return null;
}

function firstNumberAt(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = valueAtPath(record, key);
    if (typeof value === 'number' && Number.isFinite(value)) return value < 0 ? null : value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/,/g, ''));
      if (Number.isFinite(parsed)) return parsed < 0 ? null : parsed;
    }
  }
  return null;
}

function hashtagArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim().replace(/^#/, '')];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const name = firstTextAt(item as Record<string, unknown>, ['name', 'title', 'hashtagName']);
      return name ? [name.replace(/^#/, '')] : [];
    }
    return [];
  });
}

function valueAtPath(record: Record<string, unknown>, keyPath: string): unknown {
  let current: unknown = record;
  for (const segment of keyPath.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function extractHashtags(value: string): string[] {
  return [...value.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1].toLowerCase());
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`${label} must be a non-empty string.`);
  return text;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return value.map((item) => String(item).trim());
}

function oneOf<T extends readonly string[]>(value: string, values: T, label: string): T[number] {
  if (!values.includes(value)) throw new Error(`${label} must be one of: ${values.join(', ')}.`);
  return value as T[number];
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`);
  return value;
}

function enabled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function redactError(message: string): string {
  return message
    .replace(/\b(?:apify_api_[A-Za-z0-9_-]+|tlk_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}
