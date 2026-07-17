import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteFile, atomicWriteJson } from './artifact-integrity';

interface DbRow {
  evidence_id: string;
  platform: 'tiktok' | 'instagram' | 'youtube_shorts';
  canonical_url: string;
  caption: string;
  posted_at: string | null;
  account_handle: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  analysis_json: string | null;
  semantic_item_count: number;
}

interface Analysis {
  duration_sec: number;
  hook: { text: string; start_sec: number; end_sec: number };
  creative_beats: Array<{ start_sec: number; end_sec: number; label: string; description: string; evidence: string[] }>;
  visible_proof: Array<{ start_sec: number; end_sec: number; description: string }>;
  on_screen_text: Array<{ start_sec: number; end_sec: number; text: string }>;
  speech: Array<{ start_sec: number; end_sec: number; text: string }>;
  audio_cues: Array<{ start_sec: number; end_sec: number; description: string }>;
  pacing: { cuts_per_minute: number | null; pattern: string };
  cta: { text: string; start_sec: number | null; end_sec: number | null };
  claims: Array<{ text: string; start_sec: number; end_sec: number; support: string }>;
  style: string[];
  evidence_limitations: string[];
}

interface VideoMapItem {
  evidence_id: string;
  source_group: 'competitor_brand' | 'founder_adjacent' | 'category_creator';
  platform: DbRow['platform'];
  account_handle: string;
  canonical_url: string;
  posted_at: string | null;
  age_bucket: '0_90_days' | '91_365_days' | 'older_than_365_days' | 'unknown';
  normalized_performance_score: number | null;
  metrics: Pick<DbRow, 'views' | 'likes' | 'comments' | 'shares' | 'saves'>;
  duration_sec: number | null;
  topic: string;
  audience_state: string;
  content_promise: string;
  proof_mode: string;
  next_action: string;
  journey_stage: string;
  hook_type: string;
  format: string;
  cta_type: string;
  caption: string;
  hook: Analysis['hook'] | null;
  creative_beats: Analysis['creative_beats'];
  on_screen_text: Analysis['on_screen_text'];
  speech: Analysis['speech'];
  visible_proof: Analysis['visible_proof'];
  audio_cues: Analysis['audio_cues'];
  pacing: Analysis['pacing'] | null;
  cta: Analysis['cta'] | null;
  style: string[];
  claims: Analysis['claims'];
  evidence_limitations: string[];
  semantic_state: 'multimodal_mapped' | 'metadata_only';
}

interface MetaAdItem {
  evidence_id: string;
  input_url: string;
  page_name: string;
  active: boolean;
  start_date: string | null;
  publisher_platforms: string[];
  body: string;
  title: string;
  caption: string;
  cta: string;
  video_urls: string[];
  canonical_url: string | null;
  semantic_analysis: Analysis | null;
}

interface RecommendedSeries {
  priority: number;
  name: string;
  audience_state: string;
  episode_structure: string[];
  role_in_demo: string;
  evidence_ids: string[];
  resource_ids: string[];
}

interface SemanticResource {
  resource_id: string;
  title: string;
  publisher: string;
  url: string;
  source_class: string;
  authority: string;
  jurisdiction: string;
  semantic_topics: string[];
  audience_states: string[];
  series: string[];
  use_for: string;
  evidence_boundary: string;
  freshness_policy: 'stable_reference' | 'verify_before_publish';
  verified_at: string;
}

interface ContentMap {
  schema_version: 4;
  generated_at: string;
  scope: {
    purpose: 'content_identification_and_demo_planning';
    publishing_in_scope: false;
    causal_performance_claims_allowed: false;
  };
  coverage: {
    videos_in_database: number;
    videos_multimodally_mapped: number;
    semantic_items: number;
    semantic_item_composition: Record<string, number>;
    platforms: Record<string, number>;
    accounts: Record<string, number>;
    active_meta_ads_observed: number;
    active_meta_video_ads_observed: number;
    unique_meta_ad_concepts_observed: number;
  };
  taxonomy: {
    method: 'heuristic_keyword_rules';
    observed_or_derived: 'derived';
    topics: Record<string, number>;
    audience_states: Record<string, number>;
    content_promises: Record<string, number>;
    proof_modes: Record<string, number>;
    next_actions: Record<string, number>;
    journey_stages: Record<string, number>;
    hook_types: Record<string, number>;
    formats: Record<string, number>;
    cta_types: Record<string, number>;
  };
  performance_comparison: {
    method: 'within_platform_and_age_bucket_percentile';
    raw_cross_platform_ranking_allowed: false;
    causal_claims_allowed: false;
  };
  resource_catalog: {
    resources: SemanticResource[];
    by_source_class: Record<string, number>;
    by_authority: Record<string, number>;
    topic_coverage: Record<string, number>;
    audience_state_coverage: Record<string, number>;
    time_sensitive_resources: number;
  };
  research_expansion: {
    batch_id: string | null;
    status: string;
    public_audience_signals: number;
    new_candidates: number;
    selected_for_analysis: number;
    newly_multimodally_analyzed: number;
    selection_target: number;
    measurement_gaps: string[];
  };
  videos: VideoMapItem[];
  live_ads: MetaAdItem[];
  recommended_series: RecommendedSeries[];
  priority_path: Array<{
    stage: number;
    objective: string;
    content_mix: string[];
    demo_value: string;
  }>;
  coverage_gaps: string[];
  evidence_boundaries: string[];
}

interface CliOptions {
  dbPath: string;
  instagramDiscoveryPath: string;
  metaAdsPath: string;
  metaAdAnalysisPath: string;
  outJsonPath: string;
  outMarkdownPath: string;
  researchExpansionPath: string;
  semanticResourceCatalogPath: string;
}

export function buildCompetitorContentMap(options: CliOptions): ContentMap {
  const rows = sqliteJson<DbRow>(options.dbPath, `
    SELECT
      p.evidence_id,
      p.platform,
      p.canonical_url,
      p.caption,
      p.posted_at,
      a.handle AS account_handle,
      o.views,
      o.likes,
      o.comments,
      o.shares,
      o.saves,
      va.analysis_json,
      (
        SELECT COUNT(*) FROM semantic_items s
        WHERE s.post_id = p.evidence_id
      ) AS semantic_item_count
    FROM social_posts p
    JOIN social_accounts a ON a.evidence_id = p.account_id
    LEFT JOIN performance_observations o ON o.observation_id = (
      SELECT observation_id FROM performance_observations
      WHERE post_id = p.evidence_id
      ORDER BY captured_at DESC, observation_id DESC
      LIMIT 1
    )
    LEFT JOIN video_analyses va ON va.analysis_id = (
      SELECT analysis_id FROM video_analyses
      WHERE video_asset_id = p.evidence_id || ':video'
      ORDER BY created_at DESC, analysis_id DESC
      LIMIT 1
    )
    ORDER BY p.platform, a.handle, p.posted_at DESC, p.evidence_id;
  `);
  const semanticItems = sqliteJson<{ count: number }>(
    options.dbPath,
    'SELECT COUNT(*) AS count FROM semantic_items;',
  )[0]?.count ?? 0;
  const semanticItemComposition = Object.fromEntries(sqliteJson<{ item_type: string; count: number }>(
    options.dbPath,
    'SELECT item_type, COUNT(*) AS count FROM semantic_items GROUP BY item_type ORDER BY item_type;',
  ).map((row) => [row.item_type, row.count]));
  const generatedAt = new Date();
  const videos = normalizeVideoPerformance(rows.map((row) => toVideoMapItem(row, generatedAt)));
  const adsDocument = readJson(options.metaAdsPath);
  const metaAdAnalysisDocument = readOptionalJson(options.metaAdAnalysisPath);
  const liveAds = normalizeMetaAds(
    arrayAt(adsDocument, 'items'),
    new Map(arrayAt(metaAdAnalysisDocument, 'items').map((raw) => {
      const item = record(raw);
      return [text(item.evidence_id), parseAnalysisValue(item.analysis)] as const;
    })),
  );
  const instagramDocument = readJson(options.instagramDiscoveryPath);
  const instagramRows = discoveryRunItems(instagramDocument, 'instagram');
  const adCoverageRows = discoveryRunItems(instagramDocument, 'meta-active');
  const coverageGaps = deriveCoverageGaps(
    videos,
    instagramRows.length ? instagramRows : arrayAt(instagramDocument, 'items'),
    adCoverageRows.length ? adCoverageRows : arrayAt(adsDocument, 'items'),
  );
  if (new Set(liveAds.map((ad) => ad.page_name.toLowerCase())).size <= 2) {
    coverageGaps.push('The verified active-ad sample covers only Handshake and Simplify; other requested advertisers remain measurement gaps.');
  }
  const resources = readSemanticResourceCatalog(options.semanticResourceCatalogPath);
  if (!resources.length) {
    coverageGaps.push('No primary-source semantic resource catalog was available; topic guidance remains competitor- and audience-evidence-only.');
  }
  const recommendedSeries = buildRecommendedSeries(videos, resources);
  const expansion = readResearchExpansion(options.researchExpansionPath);
  coverageGaps.push(...expansion.measurement_gaps);
  const map: ContentMap = {
    schema_version: 4,
    generated_at: generatedAt.toISOString(),
    scope: {
      purpose: 'content_identification_and_demo_planning',
      publishing_in_scope: false,
      causal_performance_claims_allowed: false,
    },
    coverage: {
      videos_in_database: videos.length,
      videos_multimodally_mapped: videos.filter((video) => video.semantic_state === 'multimodal_mapped').length,
      semantic_items: semanticItems,
      semantic_item_composition: semanticItemComposition,
      platforms: counts(videos.map((video) => video.platform)),
      accounts: counts(videos.map((video) => video.account_handle)),
      active_meta_ads_observed: liveAds.filter((ad) => ad.active).length,
      active_meta_video_ads_observed: liveAds.filter((ad) => ad.active && ad.video_urls.length > 0).length,
      unique_meta_ad_concepts_observed: new Set(liveAds.map(metaAdConceptKey)).size,
    },
    taxonomy: {
      method: 'heuristic_keyword_rules',
      observed_or_derived: 'derived',
      topics: counts(videos.map((video) => video.topic)),
      audience_states: counts(videos.map((video) => video.audience_state)),
      content_promises: counts(videos.map((video) => video.content_promise)),
      proof_modes: counts(videos.map((video) => video.proof_mode)),
      next_actions: counts(videos.map((video) => video.next_action)),
      journey_stages: counts(videos.map((video) => video.journey_stage)),
      hook_types: counts(videos.map((video) => video.hook_type)),
      formats: counts(videos.map((video) => video.format)),
      cta_types: counts(videos.map((video) => video.cta_type)),
    },
    performance_comparison: {
      method: 'within_platform_and_age_bucket_percentile',
      raw_cross_platform_ranking_allowed: false,
      causal_claims_allowed: false,
    },
    resource_catalog: {
      resources,
      by_source_class: counts(resources.map((resource) => resource.source_class)),
      by_authority: counts(resources.map((resource) => resource.authority)),
      topic_coverage: counts(resources.flatMap((resource) => resource.semantic_topics)),
      audience_state_coverage: counts(resources.flatMap((resource) => resource.audience_states)),
      time_sensitive_resources: resources.filter((resource) => resource.freshness_policy === 'verify_before_publish').length,
    },
    research_expansion: expansion,
    videos,
    live_ads: liveAds,
    recommended_series: recommendedSeries,
    priority_path: [
      {
        stage: 1,
        objective: 'Prove that the demo understands a student problem before it promotes a product.',
        content_mix: ['Close the Proof Gap', 'Application Leak Check', 'Coffee Chat Without the Cringe'],
        demo_value: 'Shows diagnosis, evidence extraction, and one useful next action.',
      },
      {
        stage: 2,
        objective: 'Show repeatability across urgent and emotionally difficult job-search moments.',
        content_mix: ['Opportunity Radar', 'Rejection Reset', 'Internship Reality Check'],
        demo_value: 'Demonstrates that the system can switch between utility, empathy, and verification.',
      },
      {
        stage: 3,
        objective: 'Introduce product behavior only after the useful lesson is complete.',
        content_mix: ['One-action product demo', 'AI, But Keep It True', 'Student Scam Check'],
        demo_value: 'Makes the promo legible without turning every episode into an advertisement.',
      },
      {
        stage: 4,
        objective: 'Keep employer acquisition messaging in a distinct B2B lane.',
        content_mix: ['Post a role in minutes', 'Reach early-career candidates', 'Hiring workflow proof'],
        demo_value: 'Prevents employer ads from diluting the student-facing editorial identity.',
      },
    ],
    coverage_gaps: coverageGaps,
    evidence_boundaries: [
      'Observed views and engagement describe this bounded sample; they do not prove a hook, format, or CTA caused distribution.',
      'Public competitor media is retained for research and semantic analysis only; footage, scripts, shot order, and creator identity are not reusable creative assets.',
      'An empty or failed profile/ad scrape is a measurement gap, not proof that the brand has no content or no active advertising.',
      'Primary-source resources ground definitions, rights, safety checks, and opportunity verification; they do not validate competitor performance claims.',
      'Any deadline, eligibility rule, wage rule, immigration rule, or live opportunity must be rechecked at the linked first-party source before publication.',
      'The recommended series are strategy hypotheses to test with owned content, not predicted performance guarantees.',
    ],
  };
  return map;
}

export function renderCompetitorContentMapMarkdown(map: ContentMap): string {
  const topVideos = [...map.videos]
    .filter((video) => video.semantic_state === 'multimodal_mapped')
    .sort((left, right) => (
      (right.normalized_performance_score ?? -1) - (left.normalized_performance_score ?? -1)
      || left.evidence_id.localeCompare(right.evidence_id)
    ))
    .slice(0, 20);
  const lines = [
    '# Internship content semantic map',
    '',
    `Generated: ${map.generated_at}`,
    '',
    '## Outcome',
    '',
    'This is a research and demo-planning map, not a publishing calendar. It identifies the content system to build: student problem recognition first, useful evidence and action second, and product promotion only after the lesson is complete.',
    '',
    '## Coverage',
    '',
    `- ${map.coverage.videos_multimodally_mapped} of ${map.coverage.videos_in_database} collected videos have complete timestamp-grounded TwelveLabs semantic evidence.`,
    `- ${map.coverage.semantic_items} semantic rows are stored for retrieval (${inlineCounts(map.coverage.semantic_item_composition)}); they derive from ${map.coverage.videos_in_database} collected videos and are not ${map.coverage.semantic_items} independent source items.`,
    `- Platforms: ${inlineCounts(map.coverage.platforms)}.`,
    `- Accounts: ${inlineCounts(map.coverage.accounts)}.`,
    `- Active Meta ad executions observed: ${map.coverage.active_meta_ads_observed}; active video executions: ${map.coverage.active_meta_video_ads_observed}; exact normalized creative/copy concepts: ${map.coverage.unique_meta_ad_concepts_observed}.`,
    `- US research expansion: ${map.research_expansion.public_audience_signals} identity-free audience signals, ${map.research_expansion.new_candidates} new discovery candidates, ${map.research_expansion.selected_for_analysis} of ${map.research_expansion.selection_target} target selections, and ${map.research_expansion.newly_multimodally_analyzed} fresh multimodal analyses.`,
    `- Primary-source registry: ${map.resource_catalog.resources.length} resources (${inlineCounts(map.resource_catalog.by_source_class)}); ${map.resource_catalog.time_sensitive_resources} require live re-verification before publication.`,
    '',
    '## What the videos actually contain',
    '',
    '| Source | Platform | Age cohort | Within-cohort percentile | Topic | Hook | Format | CTA | Raw views | Opening evidence |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- | ---: | --- |',
    ...topVideos.map((video) => [
      `@${escapeCell(video.account_handle)}`,
      video.platform,
      video.age_bucket,
      video.normalized_performance_score ?? '',
      video.topic,
      video.hook_type,
      video.format,
      video.cta_type,
      video.metrics.views ?? '',
      `[${escapeCell(truncate(video.hook?.text || video.caption, 105))}](${video.canonical_url})`,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '## Observed semantic patterns',
    '',
    `Taxonomy status: ${map.taxonomy.observed_or_derived} using ${map.taxonomy.method}; labels are reproducible heuristics, not human-coded ground truth.`,
    '',
    `- Topics: ${inlineCounts(map.taxonomy.topics)}.`,
    `- Audience states: ${inlineCounts(map.taxonomy.audience_states)}.`,
    `- Content promises: ${inlineCounts(map.taxonomy.content_promises)}.`,
    `- Proof modes: ${inlineCounts(map.taxonomy.proof_modes)}.`,
    `- Next actions: ${inlineCounts(map.taxonomy.next_actions)}.`,
    `- Journey stages: ${inlineCounts(map.taxonomy.journey_stages)}.`,
    `- Hook types: ${inlineCounts(map.taxonomy.hook_types)}.`,
    `- Formats: ${inlineCounts(map.taxonomy.formats)}.`,
    `- CTA types: ${inlineCounts(map.taxonomy.cta_types)}.`,
    `- Performance comparison: ${map.performance_comparison.method}; raw cross-platform ranking is disabled.`,
    '',
    'The strongest reusable distinction is not one winning hook. It is a portfolio split:',
    '',
    '1. Utility explainers diagnose one student problem and show a concrete next action.',
    '2. Opportunity alerts trade depth for verified urgency and saveability.',
    '3. Relatable memes earn recognition but usually carry little instructional or product value.',
    '4. Student-acquisition ads use job-search friction, rankings or social proof, and direct sign-up CTAs.',
    '5. Employer ads use time pressure, hiring pain, workflow compression, and direct sign-up CTAs; they should remain separate from student editorial content.',
    '',
    '### Decision-layer semantic crosswalk',
    '',
    '| Source | Audience state | Promise | Proof mode | Next action | Journey stage |',
    '| --- | --- | --- | --- | --- | --- |',
    ...topVideos.map((video) => [
      `[@${escapeCell(video.account_handle)}](${video.canonical_url})`,
      video.audience_state,
      video.content_promise,
      video.proof_mode,
      video.next_action,
      video.journey_stage,
    ].map((value) => escapeCell(String(value))).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    ...renderVideoByVideoAnalysis(map),
    '## What the expanded evidence changes',
    '',
    '- Proof-building is now a cross-competitor category, not a single-source idea: Extern, Forage, Parker Dewey, and Virtual Internships all frame experience as the bridge to employability.',
    '- Autofill, mass application, matching, and generic AI assistance are crowded positions across Simplify, RippleMatch, WayUp, and Handshake. They are useful demo capabilities, but weak as the sole editorial identity.',
    '- Creator evidence adds depth competitors often lack: interview reasoning, authentic networking questions, manager conversations, return-offer behavior, workplace judgment, and career-fair execution.',
    '- Simplify and Handshake demonstrate two different paid lanes. Simplify sells relief and social proof to job seekers; Handshake sells speed and qualified reach to employers.',
    '',
    '## Primary-source resource anchors',
    '',
    'These sources ground definitions, process guidance, safety checks, rights, and live opportunity verification. They are not performance evidence and do not make competitor claims reusable.',
    '',
    '| Resource | Class | Topics | Audience states | Use | Freshness |',
    '| --- | --- | --- | --- | --- | --- |',
    ...map.resource_catalog.resources.map((resource) => [
      `[${resource.title}](${resource.url})`,
      resource.source_class,
      resource.semantic_topics.join(', '),
      resource.audience_states.join(', '),
      resource.use_for,
      resource.freshness_policy,
    ].map((value) => escapeCell(String(value))).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '## Recommended content system',
    '',
    '| Priority | Series | Audience state | Episode structure | Resource anchors | Demo role |',
    '| ---: | --- | --- | --- | --- | --- |',
    ...map.recommended_series.map((series) => [
      series.priority,
      series.name,
      series.audience_state,
      series.episode_structure.join(' → '),
      series.resource_ids.join(', ') || 'competitor/audience evidence only',
      series.role_in_demo,
    ].map((value) => escapeCell(String(value))).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '## Best path forward for the promo/demo',
    '',
    ...map.priority_path.map((stage) => [
      `### ${stage.stage}. ${stage.objective}`,
      '',
      `Content mix: ${stage.content_mix.join(', ')}.`,
      '',
      `Why it belongs in the demo: ${stage.demo_value}`,
      '',
    ]).flat(),
    '## Active-ad evidence',
    '',
    '| Advertiser | Active | Platforms | Start | CTA | Video | Opening evidence |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...map.live_ads.map((ad) => [
      ad.page_name || ad.input_url,
      ad.active ? 'yes' : 'no',
      ad.publisher_platforms.join(', '),
      ad.start_date ?? '',
      ad.cta,
      ad.video_urls.length ? 'yes' : 'no',
      truncate(ad.semantic_analysis?.hook.text || [ad.title, ad.body].filter(Boolean).join(' — '), 120),
    ].map((value) => escapeCell(String(value))).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '## Coverage gaps',
    '',
    ...map.coverage_gaps.map((gap) => `- ${gap}`),
    '',
    '## Evidence boundaries',
    '',
    ...map.evidence_boundaries.map((boundary) => `- ${boundary}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderVideoByVideoAnalysis(map: ContentMap): string[] {
  const sourceGroupOrder: Record<VideoMapItem['source_group'], number> = {
    competitor_brand: 0,
    founder_adjacent: 1,
    category_creator: 2,
  };
  const videos = [...map.videos].sort((left, right) => (
    sourceGroupOrder[left.source_group] - sourceGroupOrder[right.source_group]
    || left.account_handle.localeCompare(right.account_handle)
    || (right.normalized_performance_score ?? -1) - (left.normalized_performance_score ?? -1)
    || left.evidence_id.localeCompare(right.evidence_id)
  ));
  const lines = [
    '## Video-by-video analysis',
    '',
    'Every entry below separates observed media evidence from derived interpretation. Percentiles are within the same platform and age cohort; they are prioritization signals, not evidence that a hook, format, or claim caused performance. Adaptation notes describe abstract patterns only—owned creative must use original wording, footage, audio, beat order, people, and verified claims.',
    '',
  ];
  let activeGroup: VideoMapItem['source_group'] | null = null;
  videos.forEach((video, index) => {
    if (video.source_group !== activeGroup) {
      activeGroup = video.source_group;
      lines.push(`### ${sourceGroupLabel(video.source_group)}`, '');
    }
    lines.push(...renderSingleVideoAnalysis(video, map.resource_catalog.resources, index + 1));
  });
  return lines;
}

function renderSingleVideoAnalysis(
  video: VideoMapItem,
  resources: SemanticResource[],
  index: number,
): string[] {
  const title = truncate(video.hook?.text || video.caption || video.evidence_id, 100);
  const sourceLabel = video.platform === 'youtube_shorts'
    ? 'YouTube Shorts'
    : video.platform === 'tiktok'
      ? 'TikTok'
      : 'Instagram';
  const semanticRead = [
    semanticLabel(video.audience_state),
    semanticLabel(video.content_promise),
    semanticLabel(video.next_action),
  ].join(' → ');
  const structure = video.creative_beats.length
    ? video.creative_beats.map((beat) => (
      `  - \`${formatTimeRange(beat.start_sec, beat.end_sec)}\` ${truncate(beat.label, 55)} — ${truncate(beat.description, 180)}`
    ))
    : ['  - No timestamped creative-beat structure is available.'];
  const resourceMatches = resources
    .map((resource) => ({
      resource,
      score: Number(resource.semantic_topics.includes(video.topic))
        + Number(resource.audience_states.includes(video.audience_state)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || freshnessPriority(left.resource.freshness_policy) - freshnessPriority(right.resource.freshness_policy)
      || left.resource.resource_id.localeCompare(right.resource.resource_id)
    ))
    .slice(0, 3)
    .map(({ resource }) => `[${resource.title}](${resource.url})`);
  const limitations = video.evidence_limitations.length
    ? `${video.evidence_limitations
      .slice(0, 3)
      .map((limitation) => stripTerminalPunctuation(truncate(limitation, 220)))
      .join('. ')}.`
    : 'No item-specific provider limitation was recorded; the report-wide causal and originality boundaries still apply.';
  return [
    `#### Video ${index}: @${video.account_handle} — ${title || video.evidence_id}`,
    '',
    `- Source: [${sourceLabel}](${video.canonical_url}); posted ${formatDate(video.posted_at)}; duration ${video.duration_sec === null ? 'unavailable' : `${roundTime(video.duration_sec)}s`}; ${semanticLabel(video.age_bucket)} cohort; ${formatPercentile(video.normalized_performance_score)}.`,
    `- Evidence state: ${semanticLabel(video.semantic_state)}; evidence ID \`${video.evidence_id}\`; latest public snapshot: ${formatMetricSummary(video.metrics)}.`,
    `- Semantic read: ${semanticRead}. Topic: ${semanticLabel(video.topic)}. Delivery: ${semanticLabel(video.hook_type)} hook; format ${semanticLabel(video.format)}; captured CTA class: ${semanticLabel(video.cta_type)}.`,
    `- Opening evidence: “${truncate(video.hook?.text || video.caption, 260) || 'No opening text was captured.'}”${video.hook ? ` (${formatTimeRange(video.hook.start_sec, video.hook.end_sec)})` : ''}`,
    '- Timestamped structure:',
    ...structure,
    `- Craft read: ${formatCraftRead(video)}.`,
    `- Proof and claims: ${formatProofAndClaims(video)}.`,
    `- CTA and editorial action: ${formatCtaRead(video)}.`,
    `- Performance read: ${performanceRead(video)}`,
    `- Adaptation hypothesis: ${adaptationHypothesis(video)}`,
    `- Primary-source anchors: ${resourceMatches.join('; ') || 'No direct primary-source anchor is assigned; treat this as competitor/audience evidence only.'}`,
    `- Limitations: ${limitations}`,
    '',
  ];
}

function sourceGroupLabel(sourceGroup: VideoMapItem['source_group']): string {
  if (sourceGroup === 'competitor_brand') return 'Competitor brands';
  if (sourceGroup === 'founder_adjacent') return 'Founder-adjacent creators';
  return 'Category creators';
}

function semanticLabel(value: string): string {
  const labels: Record<string, string> = {
    '0_90_days': '0–90 days',
    '91_365_days': '91–365 days',
    older_than_365_days: 'older than 365 days',
    youtube_shorts: 'YouTube Shorts',
  };
  if (labels[value]) return labels[value];
  return value.replaceAll('_', ' ');
}

function formatDate(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : 'date unavailable';
}

function formatPercentile(value: number | null): string {
  return value === null
    ? 'within-cohort percentile unavailable'
    : `within-cohort percentile ${(value * 100).toFixed(1)}`;
}

function formatMetricSummary(metrics: VideoMapItem['metrics']): string {
  const values: Array<[string, number | null]> = [
    ['views', metrics.views],
    ['likes', metrics.likes],
    ['comments', metrics.comments],
    ['shares', metrics.shares],
    ['saves', metrics.saves],
  ];
  const available = values
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .map(([label, value]) => `${label} ${value.toLocaleString('en-US')}`);
  return available.join(', ') || 'no public metrics retained';
}

function formatTimeRange(start: number | null, end: number | null): string {
  if (start === null || end === null) return 'timing unavailable';
  return `${roundTime(start)}–${roundTime(end)}s`;
}

function roundTime(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function formatProofAndClaims(video: VideoMapItem): string {
  const proofExamples = video.visible_proof
    .slice(0, 3)
    .map((proof) => `${formatTimeRange(proof.start_sec, proof.end_sec)} ${stripTerminalPunctuation(truncate(proof.description, 110))}`);
  const supportCounts = counts(video.claims.map((claim) => claim.support));
  const claimExamples = video.claims
    .slice(0, 2)
    .map((claim) => `“${truncate(claim.text, 120)}” (${semanticLabel(claim.support)})`);
  const parts = [
    `mode ${semanticLabel(video.proof_mode)}`,
    `${video.visible_proof.length} visible proof moment${video.visible_proof.length === 1 ? '' : 's'}`,
    `${video.claims.length} captured claim${video.claims.length === 1 ? '' : 's'}`,
  ];
  if (Object.keys(supportCounts).length) parts.push(`claim support ${inlineCounts(supportCounts)}`);
  if (proofExamples.length) parts.push(`visible examples: ${proofExamples.join('; ')}`);
  if (claimExamples.length) parts.push(`claim examples: ${claimExamples.join('; ')}`);
  return parts.join('. ');
}

function formatCraftRead(video: VideoMapItem): string {
  const pacing = video.pacing
    ? `${stripTerminalPunctuation(truncate(video.pacing.pattern, 120)) || 'pattern not described'}${video.pacing.cuts_per_minute === null ? '' : `; ${roundTime(video.pacing.cuts_per_minute)} cuts/min`}`
    : 'unavailable';
  const style = video.style.length ? video.style.map(semanticLabel).join(', ') : 'unavailable';
  const audioExamples = video.audio_cues
    .slice(0, 2)
    .map((cue) => `${formatTimeRange(cue.start_sec, cue.end_sec)} ${stripTerminalPunctuation(truncate(cue.description, 100))}`);
  return [
    `pacing ${pacing}`,
    `style ${style}`,
    `${video.on_screen_text.length} on-screen-text span${video.on_screen_text.length === 1 ? '' : 's'}`,
    `${video.speech.length} speech span${video.speech.length === 1 ? '' : 's'}`,
    `${video.audio_cues.length} audio cue${video.audio_cues.length === 1 ? '' : 's'}${audioExamples.length ? ` (${audioExamples.join('; ')})` : ''}`,
  ].join('; ');
}

function formatCtaRead(video: VideoMapItem): string {
  if (!video.cta?.text || /none observed|no (?:explicit |visible )?(?:call[- ]to[- ]action|cta)/i.test(video.cta.text)) {
    return `No explicit CTA was captured; modeled editorial action is ${semanticLabel(video.next_action)}`;
  }
  const timing = video.cta.start_sec === null || video.cta.end_sec === null
    ? 'timing unavailable'
    : formatTimeRange(video.cta.start_sec, video.cta.end_sec);
  return `“${truncate(video.cta.text, 180)}” (${timing}); modeled editorial action is ${semanticLabel(video.next_action)}`;
}

function performanceRead(video: VideoMapItem): string {
  const percentile = video.normalized_performance_score;
  if (percentile === null) {
    return 'No within-cohort percentile is available, so this item should be studied for semantic coverage rather than ranked performance.';
  }
  const band = percentile >= 0.8
    ? 'high-priority pattern candidate'
    : percentile >= 0.6
      ? 'above-median pattern candidate'
      : percentile >= 0.4
        ? 'middle-of-cohort reference'
        : 'lower-cohort contrast case';
  return `${formatPercentile(percentile)} classifies this as a ${band} in the bounded sample. It does not identify which creative element caused distribution.`;
}

function adaptationHypothesis(video: VideoMapItem): string {
  const promisePattern: Record<string, string> = {
    application_efficiency: 'Show one application step being compressed, expose the evidence inputs and uncertainty, and retain a visible human review.',
    career_exploration: 'Make one role or pathway concrete through an owned task, comparison, or day-in-the-life example, then route the viewer to first-party role information.',
    emotional_normalization: 'Name the frustration without guessing its cause, distinguish observation from inference, and offer one bounded process check.',
    evidence_translation: 'Start with one recognizable proof gap, demonstrate a truthful evidence transformation, and finish with one review action.',
    hiring_efficiency: 'Keep this in the employer lane: name one hiring bottleneck, show the workflow evidence, and avoid mixing it into student editorial content.',
    opportunity_discovery: 'Lead with the opening, show eligibility, pay, location, deadline, and verification time, then link the first-party source.',
    process_instruction: 'Name the awkward or high-pressure moment, demonstrate an original sequence or script, and leave the viewer with one concrete next action.',
    recognition: 'Rebuild the relatable moment from owned audience insight and add a useful action if the post is meant to teach rather than only entertain.',
    risk_reduction: 'Lead with one specific risk question, demonstrate a first-party check, and provide a safe escalation path without making a legal conclusion.',
    workplace_navigation: 'Open on one observable workplace tension, show a safer behavior and feedback loop, and separate personal experience from general advice.',
  };
  const proofPattern: Record<string, string> = {
    authority_or_social_proof: 'Any authority or social-proof claim must be independently verified and attributed.',
    before_after: 'Use an owned, truth-checked before/after rather than reproducing the source example.',
    none_observed: 'Add a concrete demonstration or first-party source so the owned version does not depend on assertion alone.',
    personal_testimony: 'Use a consenting owned narrator and label personal experience as experience, not a universal result.',
    quantitative_claim: 'Use audited owned metrics or a clearly cited first-party dataset, with denominator and date.',
    source_verification: 'Show the first-party source and visible verification timestamp.',
    step_by_step_demonstration: 'Rebuild the sequence around the owned workflow and change the wording, examples, and beat order.',
    visible_demonstration: 'Use owned screen, document, or process evidence and a distinct visual sequence.',
  };
  return `${promisePattern[video.content_promise] ?? 'Translate the observed pattern into one original, evidence-backed lesson.'} ${proofPattern[video.proof_mode] ?? 'Use only owned or licensed evidence.'}`;
}

function freshnessPriority(value: SemanticResource['freshness_policy']): number {
  return value === 'stable_reference' ? 0 : 1;
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.!?]+$/, '');
}

function toVideoMapItem(row: DbRow, generatedAt: Date): VideoMapItem {
  const analysis = parseAnalysis(row.analysis_json);
  const openingText = [
    row.caption,
    analysis?.hook.text,
    ...(analysis?.on_screen_text.map((entry) => entry.text) ?? []),
  ].filter(Boolean).join(' ');
  const fallbackText = analysis?.speech.map((entry) => entry.text).join(' ') ?? '';
  const semanticText = [
    openingText,
    fallbackText,
    ...(analysis?.creative_beats.flatMap((beat) => [beat.label, beat.description, ...beat.evidence]) ?? []),
    ...(analysis?.visible_proof.map((entry) => entry.description) ?? []),
    ...(analysis?.claims.map((claim) => claim.text) ?? []),
    analysis?.cta.text,
  ].filter(Boolean).join(' ');
  const topic = classifyTopic(openingText, fallbackText);
  const audienceState = classifyAudienceState(semanticText, topic);
  const contentPromise = classifyContentPromise(semanticText, topic);
  const proofMode = classifyProofMode(semanticText, analysis);
  const nextAction = classifyNextAction(semanticText, topic, analysis?.cta.text ?? '');
  return {
    evidence_id: row.evidence_id,
    source_group: sourceGroup(row.account_handle),
    platform: row.platform,
    account_handle: row.account_handle,
    canonical_url: row.canonical_url,
    posted_at: row.posted_at,
    age_bucket: ageBucket(row.posted_at, generatedAt),
    normalized_performance_score: null,
    metrics: {
      views: nullableNumber(row.views),
      likes: nullableNumber(row.likes),
      comments: nullableNumber(row.comments),
      shares: nullableNumber(row.shares),
      saves: nullableNumber(row.saves),
    },
    duration_sec: analysis?.duration_sec ?? null,
    topic,
    audience_state: audienceState,
    content_promise: contentPromise,
    proof_mode: proofMode,
    next_action: nextAction,
    journey_stage: classifyJourneyStage(topic, contentPromise, nextAction),
    hook_type: classifyHook(analysis?.hook.text || row.caption),
    format: classifyFormat(analysis),
    cta_type: classifyCta(analysis?.cta.text || row.caption),
    caption: row.caption,
    hook: analysis?.hook ?? null,
    creative_beats: analysis?.creative_beats ?? [],
    on_screen_text: analysis?.on_screen_text ?? [],
    speech: analysis?.speech ?? [],
    visible_proof: analysis?.visible_proof ?? [],
    audio_cues: analysis?.audio_cues ?? [],
    pacing: analysis?.pacing ?? null,
    cta: analysis?.cta ?? null,
    style: analysis?.style ?? [],
    claims: analysis?.claims ?? [],
    evidence_limitations: analysis && row.semantic_item_count > 0
      ? analysis.evidence_limitations
      : ['Complete TwelveLabs semantic evidence is not available for this item.'],
    semantic_state: analysis && row.semantic_item_count > 0 ? 'multimodal_mapped' : 'metadata_only',
  };
}

function normalizeVideoPerformance(videos: VideoMapItem[]): VideoMapItem[] {
  const groups = new Map<string, VideoMapItem[]>();
  for (const video of videos) {
    const key = `${video.platform}:${video.age_bucket}`;
    const group = groups.get(key) ?? [];
    group.push(video);
    groups.set(key, group);
  }
  const scores = new Map<string, number | null>();
  for (const group of groups.values()) {
    const observed = group
      .filter((video) => video.metrics.views !== null)
      .sort((left, right) => metricValue(left) - metricValue(right) || left.evidence_id.localeCompare(right.evidence_id));
    const ranks = new Map(observed.map((video, index) => [video.evidence_id, index]));
    for (const video of group) {
      const index = ranks.get(video.evidence_id);
      scores.set(video.evidence_id, index === undefined ? null : observed.length === 1 ? 0.5 : roundScore(index / (observed.length - 1)));
    }
  }
  return videos.map((video) => ({ ...video, normalized_performance_score: scores.get(video.evidence_id) ?? null }));
}

function metricValue(video: VideoMapItem): number {
  const views = video.metrics.views ?? 0;
  const interactions = (video.metrics.likes ?? 0) + (video.metrics.comments ?? 0) * 2
    + (video.metrics.shares ?? 0) * 3 + (video.metrics.saves ?? 0) * 3;
  return Math.log1p(views) + (views > 0 ? Math.min(1, interactions / views) : 0);
}

function ageBucket(postedAt: string | null, generatedAt: Date): VideoMapItem['age_bucket'] {
  if (!postedAt || !Number.isFinite(Date.parse(postedAt))) return 'unknown';
  const days = Math.max(0, (generatedAt.getTime() - Date.parse(postedAt)) / 86_400_000);
  if (days <= 90) return '0_90_days';
  if (days <= 365) return '91_365_days';
  return 'older_than_365_days';
}

function normalizeMetaAds(items: unknown[], analyses = new Map<string, Analysis | null>()): MetaAdItem[] {
  return items.flatMap((raw): MetaAdItem[] => {
    const item = record(raw);
    if (item.error || item.errorDescription) return [];
    const snapshot = record(item.snapshot);
    const body = record(snapshot.body);
    const videos = array(snapshot.videos).map(record);
    const adId = text(item.adArchiveID) || text(item.adArchiveId) || text(item.adId);
    if (!adId) return [];
    const evidenceId = `meta-ad:${adId || stableId(JSON.stringify(item))}`;
    return [{
      evidence_id: evidenceId,
      input_url: text(item.inputUrl),
      page_name: text(item.pageName) || text(snapshot.pageName),
      active: item.isActive === true,
      start_date: textOrNull(item.startDateFormatted),
      publisher_platforms: array(item.publisherPlatform).map(text).filter(Boolean),
      body: text(body.text) || text(snapshot.body),
      title: text(snapshot.title),
      caption: text(snapshot.caption),
      cta: text(snapshot.ctaText),
      video_urls: videos.flatMap((video) => [
        text(video.videoHdUrl),
        text(video.videoSdUrl),
      ].filter(Boolean).slice(0, 1)),
      canonical_url: textOrNull(item.url),
      semantic_analysis: analyses.get(evidenceId) ?? null,
    }];
  });
}

function metaAdConceptKey(ad: MetaAdItem): string {
  return [ad.page_name, ad.body, ad.title, ad.caption, ad.cta]
    .map((value) => value.toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
}

function readResearchExpansion(filePath: string): ContentMap['research_expansion'] {
  const value = readOptionalJson(filePath);
  const root = record(value);
  const ledger = record(root.ledger);
  const selection = record(root.selection_summary);
  const audience = record(root.audience_summary);
  const semantic = record(root.semantic_summary);
  const gaps = [
    ...array(root.selection_shortfalls).map(text).filter(Boolean),
    ...array(audience.measurement_gaps).map(text).filter(Boolean),
    ...array(ledger.lanes).map(record).flatMap((lane) => array(lane.measurement_gaps).map(text).filter(Boolean)),
  ];
  return {
    batch_id: textOrNull(root.batch_id),
    status: text(ledger.status) || (Object.keys(root).length ? 'available' : 'not_run'),
    public_audience_signals: nullableNumber(audience.collected) ?? 0,
    new_candidates: nullableNumber(selection.unique_candidates) ?? 0,
    selected_for_analysis: nullableNumber(selection.selected) ?? 0,
    newly_multimodally_analyzed: nullableNumber(semantic.newly_multimodally_analyzed_posts) ?? 0,
    selection_target: 36,
    measurement_gaps: unique(gaps),
  };
}

function readSemanticResourceCatalog(filePath: string): SemanticResource[] {
  const root = record(readOptionalJson(filePath));
  const resources = array(root.resources).map((raw, index): SemanticResource => {
    const item = record(raw);
    const resourceId = text(item.resource_id);
    const url = text(item.url);
    const freshnessPolicy = text(item.freshness_policy);
    const verifiedAt = text(item.verified_at);
    if (!resourceId || !text(item.title) || !text(item.publisher) || !text(item.source_class)
      || !text(item.authority) || !text(item.jurisdiction) || !text(item.use_for)
      || !text(item.evidence_boundary)) {
      throw new Error(`Semantic resource ${index + 1} is missing a required field.`);
    }
    if (!/^https:\/\//.test(url)) throw new Error(`Semantic resource ${resourceId} must use an HTTPS URL.`);
    if (!['stable_reference', 'verify_before_publish'].includes(freshnessPolicy)) {
      throw new Error(`Semantic resource ${resourceId} has an invalid freshness policy.`);
    }
    if (!Number.isFinite(Date.parse(verifiedAt))) {
      throw new Error(`Semantic resource ${resourceId} has an invalid verification timestamp.`);
    }
    return {
      resource_id: resourceId,
      title: text(item.title),
      publisher: text(item.publisher),
      url,
      source_class: text(item.source_class),
      authority: text(item.authority),
      jurisdiction: text(item.jurisdiction),
      semantic_topics: unique(array(item.semantic_topics).map(text).filter(Boolean)),
      audience_states: unique(array(item.audience_states).map(text).filter(Boolean)),
      series: unique(array(item.series).map(text).filter(Boolean)),
      use_for: text(item.use_for),
      evidence_boundary: text(item.evidence_boundary),
      freshness_policy: freshnessPolicy as SemanticResource['freshness_policy'],
      verified_at: new Date(verifiedAt).toISOString(),
    };
  });
  if (new Set(resources.map((resource) => resource.resource_id)).size !== resources.length) {
    throw new Error('Semantic resource IDs must be unique.');
  }
  return resources;
}

function buildRecommendedSeries(videos: VideoMapItem[], resources: SemanticResource[]): RecommendedSeries[] {
  const evidence = (topics: string | string[], limit = 3) => {
    const topicSet = new Set(Array.isArray(topics) ? topics : [topics]);
    return videos
      .filter((video) => topicSet.has(video.topic) && video.semantic_state === 'multimodal_mapped')
      .slice(0, limit)
      .map((video) => video.evidence_id);
  };
  const series: Array<Omit<RecommendedSeries, 'resource_ids'>> = [
    {
      priority: 1,
      name: 'Close the Proof Gap',
      audience_state: 'My resume is all coursework or responsibilities.',
      episode_structure: ['job requirement', 'real student evidence', 'truthful rewrite', 'review check'],
      role_in_demo: 'Best demonstration of semantic matching, evidence discipline, and visible before/after value.',
      evidence_ids: evidence('resume_and_application'),
    },
    {
      priority: 2,
      name: 'Application Leak Check',
      audience_state: 'I applied everywhere and heard nothing.',
      episode_structure: ['specific leak', 'why it weakens the application', 'one fix', 'track the result'],
      role_in_demo: 'Turns a vague pain point into a bounded diagnostic workflow.',
      evidence_ids: evidence(['resume_and_application', 'job_search_stress']),
    },
    {
      priority: 3,
      name: 'Coffee Chat Without the Cringe',
      audience_state: 'Networking feels fake and I do not know what to say.',
      episode_structure: ['person to contact', 'low-pressure message', 'useful question', 'follow-up'],
      role_in_demo: 'Pairs a recognizable hook with a concrete script framework without promising referrals.',
      evidence_ids: evidence('networking'),
    },
    {
      priority: 4,
      name: 'Opportunity Radar',
      audience_state: 'I need real openings and I am afraid I am late.',
      episode_structure: ['role and cohort', 'eligibility', 'pay and location', 'deadline', 'first-party source'],
      role_in_demo: 'Shows current-data verification and creates a naturally saveable utility format.',
      evidence_ids: evidence('opportunity_alert'),
    },
    {
      priority: 5,
      name: 'Interview Process, Not Perfect Answers',
      audience_state: 'I do not know how to answer or think aloud.',
      episode_structure: ['question', 'what is being evaluated', 'stepwise process', 'practice prompt'],
      role_in_demo: 'Supports list explainers and timed visual proof without copying competitor wording.',
      evidence_ids: evidence('interview'),
    },
    {
      priority: 6,
      name: 'Rejection Reset',
      audience_state: 'Ghosting and rejection are making the search feel personal.',
      episode_structure: ['name the emotion', 'separate fact from guess', 'inspect one process step', 'next action'],
      role_in_demo: 'Adds emotional credibility and prevents the brand from sounding like an application machine.',
      evidence_ids: evidence('job_search_stress'),
    },
    {
      priority: 7,
      name: 'Internship Reality Check',
      audience_state: 'I got the internship and do not know the unwritten rules.',
      episode_structure: ['popular assumption', 'observable workplace signal', 'safer behavior', 'feedback loop'],
      role_in_demo: 'Extends the product story beyond applying into internship performance and return-offer preparation.',
      evidence_ids: evidence('intern_life'),
    },
    {
      priority: 8,
      name: 'AI, But Keep It True',
      audience_state: 'I want AI help without generic or fabricated applications.',
      episode_structure: ['appropriate AI task', 'student evidence', 'human review', 'final student control'],
      role_in_demo: 'Makes the AI value proposition explicit while preserving trust and originality.',
      evidence_ids: evidence('ai_job_search'),
    },
    {
      priority: 9,
      name: 'Student Scam Check',
      audience_state: 'I cannot tell whether this opportunity or recruiter is legitimate.',
      episode_structure: ['suspicious signal', 'first-party verification', 'FTC check', 'safe next action'],
      role_in_demo: 'Creates a recurring safety utility while keeping urgency separate from fear-based promotion.',
      evidence_ids: evidence('opportunity_alert'),
    },
    {
      priority: 10,
      name: 'No Internship, Still Build Proof',
      audience_state: 'I missed recruiting or have no formal experience.',
      episode_structure: ['target skill', 'bounded project or responsibility', 'visible artifact', 'truthful proof statement'],
      role_in_demo: 'Extends proof-building beyond formal internships without manufacturing experience.',
      evidence_ids: evidence('resume_and_application'),
    },
    {
      priority: 11,
      name: 'CPT and OPT Question Router',
      audience_state: 'I do not know where my work-authorization question belongs.',
      episode_structure: ['question type', 'official USCIS source', 'DSO handoff', 'no legal conclusion'],
      role_in_demo: 'Shows safe evidence routing for a high-stakes student segment.',
      evidence_ids: [],
    },
    {
      priority: 12,
      name: 'Can I Afford This Internship?',
      audience_state: 'Pay, housing, transit, and lost wages may make the role inaccessible.',
      episode_structure: ['disclosed pay', 'full cost inventory', 'unknowns', 'comparison'],
      role_in_demo: 'Adds access and affordability to opportunity evaluation instead of equating prestige with fit.',
      evidence_ids: evidence('opportunity_alert'),
    },
    {
      priority: 13,
      name: 'Small Employer Radar',
      audience_state: 'Large-brand roles are crowded or already closed.',
      episode_structure: ['verified smaller employer', 'role fit', 'freshness', 'first-party application path'],
      role_in_demo: 'Demonstrates discovery breadth and reduces dependence on the same high-competition brands.',
      evidence_ids: evidence('opportunity_alert'),
    },
    {
      priority: 14,
      name: 'Community College and Transfer Proof',
      audience_state: 'Generic career advice assumes a four-year residential network.',
      episode_structure: ['specific constraint', 'existing evidence', 'local or campus resource', 'next action'],
      role_in_demo: 'Makes access differences first-class without deficit framing.',
      evidence_ids: evidence(['resume_and_application', 'networking']),
    },
    {
      priority: 15,
      name: 'Return Offer Signal Check',
      audience_state: 'I want to turn this internship into a full-time opportunity.',
      episode_structure: ['observable signal', 'feedback request', 'contribution evidence', 'decision checkpoint'],
      role_in_demo: 'Connects internship performance to evidence and feedback without promising conversion.',
      evidence_ids: evidence('intern_life'),
    },
  ];
  return series.map((item) => ({
    ...item,
    resource_ids: resources
      .filter((resource) => resource.series.includes(item.name))
      .map((resource) => resource.resource_id),
  }));
}

function deriveCoverageGaps(videos: VideoMapItem[], instagramItems: unknown[], adItems: unknown[]): string[] {
  const gaps: string[] = [];
  const incompleteVideos = videos.filter((video) => video.semantic_state === 'metadata_only');
  if (incompleteVideos.length) {
    gaps.push(`${incompleteVideos.length} collected videos remain metadata-only after provider validation failures: ${incompleteVideos.map((video) => video.evidence_id).join(', ')}.`);
  }
  const mappedAccounts = new Set(videos
    .filter((video) => video.semantic_state === 'multimodal_mapped')
    .map((video) => video.account_handle.toLowerCase()));
  const requiredAccounts = [
    { label: 'Simplify', aliases: ['joinsimplify', 'simplify.jobs'] },
    { label: 'Parker Dewey / Micro-Internships', aliases: ['microinternships'] },
    { label: 'Forage', aliases: ['theforage'] },
  ];
  for (const account of requiredAccounts) {
    if (!account.aliases.some((alias) => mappedAccounts.has(alias))) {
      gaps.push(`No multimodally mapped video from ${account.label} is present yet.`);
    }
  }
  const instagramErrors = instagramItems.map(record).filter((item) => item.error || item.errorDescription);
  if (instagramErrors.length) {
    gaps.push(`${instagramErrors.length} Instagram profile inputs returned empty/private/not-found results and require corrected official handles or a separate discovery pass.`);
  }
  const foreignOwners = instagramItems.map(record).filter((item) => (
    text(item.inputUrl).includes('joinhandshake')
    && text(item.ownerUsername)
    && text(item.ownerUsername) !== 'joinhandshake'
  ));
  if (foreignOwners.length) {
    gaps.push('The Handshake Instagram profile feed included collaborator-owned posts; input URL and owner identity must remain separate in source attribution.');
  }
  const forageCollision = instagramItems.map(record).some((item) => (
    text(item.inputUrl).includes('theforage')
    && /(canberra|haig park village markets|australian market)/i.test([
      text(item.caption),
      text(item.alt),
      text(item.ownerFullName),
    ].join(' '))
  ));
  if (forageCollision) {
    gaps.push('The @theforage input resolved to an unrelated Australian market account; the correct official Forage social identity remains unresolved.');
  }
  const adErrors = adItems.map(record).filter((item) => (
    item.error
    || item.errorDescription
    || !(text(item.adArchiveID) || text(item.adArchiveId) || text(item.adId))
  ));
  if (adErrors.length) {
    gaps.push(`${adErrors.length} Meta page inputs returned no item or an error; this is not evidence that those brands run no ads.`);
  }
  const adPages = new Set(normalizeMetaAds(adItems).map((ad) => ad.page_name.toLowerCase()));
  if (!adPages.has('handshake')) gaps.push('No verified Handshake active-ad result was observed.');
  if (adPages.size <= 2) gaps.push('The current active-ad sample is verified for only two advertisers; empty page inputs and keyword collisions remain measurement gaps.');
  return unique(gaps);
}

function classifyTopic(value: string, fallbackValue = ''): string {
  return classifyTopicValue(value) ?? classifyTopicValue(fallbackValue) ?? 'general_career';
}

function classifyTopicValue(value: string): string | null {
  const textValue = value.toLowerCase();
  if (/(ai |gemini|claude|codex|chatgpt)/.test(textValue)) return 'ai_job_search';
  if (/(post (?:a |your )?job|hire (?:faster|interns?|talent)|talent acquisition|talent pipeline|campus recruiting|early-career talent|companies? (?:hosting|looking for|hiring)|business owner.{0,80}hire)/.test(textValue)) return 'employer_hiring';
  if (/(open now|applications? (?:are )?open|who(?:'s| is) hiring|hiring interns?|internships? alert|application deadline|paid (?:fall|spring|summer|remote) internships?|internship program .*open|apply early)/.test(textValue)) return 'opportunity_alert';
  if (/(intern mistake|interns? get fired|fired .*intern|return offer|day in the life|as an intern|workplace|office rules|office politics|unwritten rules)/.test(textValue)) return 'intern_life';
  if (/(ghosted|rejection|job search|entry-level job|applying into the void|applicant count|candidate count|employed, but at what cost)/.test(textValue)) return 'job_search_stress';
  if (/(resume|résumé|cv |cover letter|application|mass apply|applying)/.test(textValue)) return 'resume_and_application';
  if (/(interview|tell me about yourself|behavioral|interview questions?|recruiter will ask)/.test(textValue)) return 'interview';
  if (/(coffee chat|networking|outreach|referral|alumni|connect with)/.test(textValue)) return 'networking';
  if (/(major|career path|industry|role fit)/.test(textValue)) return 'career_identity';
  if (/(post your job|hire|candidates|early talent)/.test(textValue)) return 'employer_hiring';
  return null;
}

function classifyAudienceState(value: string, topic: string): string {
  const textValue = value.toLowerCase();
  if (topic === 'employer_hiring') return 'employer_hiring_pressure';
  if (/(scam|fake recruiter|fraud|legitimate|personal information|bank account|pay .* fee)/.test(textValue)) return 'safety_uncertain';
  if (/(\b(?:cpt|opt|f-1)\b|stem opt|sponsorship|work authorization|international student)/.test(textValue)) return 'work_authorization_uncertain';
  if (topic === 'opportunity_alert' || /(too late|missed (?:recruiting|internship)|deadline|open now|applications? open)/.test(textValue)) return 'late_or_urgent';
  if (topic === 'job_search_stress' || /(ghosted|rejected|rejection|no response|invisible|applying into the void)/.test(textValue)) return 'invisible_or_rejected';
  if (topic === 'networking' || /(awkward|cringe|coffee chat|referral|outreach)/.test(textValue)) return 'socially_uncertain';
  if (topic === 'career_identity' || /(what roles?|which roles?|career path|fit my major|major.*career)/.test(textValue)) return 'role_uncertain';
  if (topic === 'interview') return 'interview_uncertain';
  if (topic === 'ai_job_search' || /(generic|fabricat|sound like ai|authentic)/.test(textValue)) return 'authenticity_uncertain';
  if (topic === 'intern_life' || /(first day|manager|office politics|workplace norms?)/.test(textValue)) return 'workplace_uncertain';
  if (/(unpaid|afford|lost wages|low-income|financial barrier|housing cost|cost of (?:housing|commut|transport)|(?:commut|transport).{0,30}(?:cost|expense|afford))/.test(textValue)) return 'access_constrained';
  if (/(no experience|coursework|class project|proof gap|resume|résumé|cover letter|qualified)/.test(textValue)) return 'proof_gap';
  if (/(overwhelmed|hundreds of applications|mass appl|too many|application fatigue)/.test(textValue)) return 'overwhelmed';
  return 'general_growth';
}

function classifyContentPromise(value: string, topic: string): string {
  const textValue = value.toLowerCase();
  if (topic === 'employer_hiring') return 'hiring_efficiency';
  if (topic === 'opportunity_alert') return 'opportunity_discovery';
  if (/(scam|fraud|\b(?:cpt|opt|f-1)\b|stem opt|work authorization|unpaid|afford|legal advice|employment rights?|worker rights?|wage rights?)/.test(textValue)) return 'risk_reduction';
  if (topic === 'resume_and_application' || /(proof|rewrite|bullet|cover letter)/.test(textValue)) return 'evidence_translation';
  if (topic === 'interview' || topic === 'networking') return 'process_instruction';
  if (topic === 'intern_life') return 'workplace_navigation';
  if (topic === 'job_search_stress') return 'emotional_normalization';
  if (topic === 'ai_job_search') return 'application_efficiency';
  if (/(pov|when you|me:|that feeling|relatable)/.test(textValue)) return 'recognition';
  return 'career_exploration';
}

function classifyProofMode(value: string, analysis: Analysis | null): string {
  const textValue = value.toLowerCase();
  const claimText = analysis?.claims.map((claim) => claim.text.toLowerCase()).join(' ') ?? '';
  if (/(before.{0,40}after|instead of|rewrite|good.{0,20}better.{0,20}best)/.test(textValue)) return 'before_after';
  if (/(official source|first-party|verified|according to|deadline|eligibility)/.test(textValue)) return 'source_verification';
  if (/(harvard students|trusted by|voted|million candidates|fortune 100|testimonial|reviews?)/.test(textValue)) return 'authority_or_social_proof';
  if (/(\$\s?\d|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b|\b\d[\d,.]*[kmb]\s*(?:jobs?|applications?|candidates?|users?|views?|offers?)\b|\b\d[\d,.]*\s*(?:jobs?|applications?|candidates?|companies|views?|interviews?|offers?|days?|hours?|expenses?|income|rent|costs?|dollars?)\b|\b(?:hundreds?|thousands?|millions?)\s+(?:of\s+)?(?:people|jobs?|applications?|candidates?|users?|views?|offers?)\b)/.test(claimText)) {
    return 'quantitative_claim';
  }
  if (/\b(i|my|we) (?:got|landed|used|applied|learned|was|am)\b/.test(textValue)) return 'personal_testimony';
  if ((analysis?.visible_proof.length ?? 0) > 0) return 'visible_demonstration';
  if ((analysis?.creative_beats.length ?? 0) >= 4) return 'step_by_step_demonstration';
  return 'none_observed';
}

function classifyNextAction(value: string, topic: string, cta: string): string {
  const textValue = value.toLowerCase();
  const ctaValue = cta.toLowerCase();
  if (topic === 'employer_hiring') return 'post_or_promote_role';
  if (/(\b(?:cpt|opt|f-1)\b|stem opt|work authorization|designated school official|\bdso\b)/.test(textValue)) return 'consult_authoritative_adviser';
  if (/(scam|fraud|legitimate|verify|official source)/.test(textValue)) return 'verify_source';
  if (/(unpaid|afford|lost wages|housing cost|cost of (?:housing|commut|transport)|(?:commut|transport).{0,30}(?:cost|expense|afford))/.test(textValue)) return 'compare_total_cost';
  if (topic === 'opportunity_alert') return 'verify_and_apply';
  if (topic === 'resume_and_application') return 'revise_evidence';
  if (topic === 'interview') return 'practice';
  if (topic === 'networking') return 'contact_person';
  if (topic === 'job_search_stress') return 'review_process';
  if (/(sign up|\bapply\b|click|download|\btry\b)/.test(ctaValue)) return 'apply_or_visit';
  if (/(follow|comment)/.test(ctaValue)) return 'engage';
  if (/(save|share)/.test(ctaValue)) return 'save_or_share';
  return 'reflect_or_explore';
}

function classifyJourneyStage(topic: string, contentPromise: string, nextAction: string): string {
  if (topic === 'employer_hiring' || ['apply_or_visit', 'post_or_promote_role'].includes(nextAction)) return 'convert';
  if (['verify_source', 'verify_and_apply', 'consult_authoritative_adviser', 'compare_total_cost'].includes(nextAction)) return 'verify';
  if (!['reflect_or_explore', 'review_process'].includes(nextAction)) return 'act';
  if (['evidence_translation', 'process_instruction', 'risk_reduction', 'workplace_navigation'].includes(contentPromise)) return 'diagnose';
  if (['emotional_normalization', 'recognition'].includes(contentPromise)) return 'recognize';
  return 'understand';
}

function classifyHook(value: string): string {
  const textValue = value.trim().toLowerCase();
  if (!textValue) return 'unclear';
  if (textValue.includes('?') || /^(how|what|why|when|where|do|does|is|are|can)\b/.test(textValue)) return 'question';
  if (/(don't|do not|never|stop |mistake|wrong|no mass|void|nothing to do with)/.test(textValue)) return 'warning_or_contrarian';
  if (/(got |landed|interviews?|offers?|proof|result|outdid|worked)/.test(textValue)) return 'outcome_or_proof';
  if (/(open now|hiring|alert|applications? open|deadline)/.test(textValue)) return 'opportunity_alert';
  if (/(me, |every job seeker|that type of|full time job|busy girl)/.test(textValue)) return 'relatable_identity';
  return 'direct_statement';
}

function classifyFormat(analysis: Analysis | null): string {
  if (!analysis) return 'unknown';
  if (analysis.duration_sec <= 10 && analysis.speech.length === 0 && analysis.on_screen_text.length > 0) return 'text_meme_or_reaction';
  if (analysis.duration_sec <= 12) return 'short_punchline';
  if (analysis.on_screen_text.length >= 4 || analysis.creative_beats.length >= 5) return 'list_explainer';
  if (analysis.duration_sec >= 40) return 'long_explainer';
  if (analysis.speech.length > 0) return 'talking_point';
  return 'visual_montage';
}

function classifyCta(value: string): string {
  const textValue = value.toLowerCase();
  if (!textValue.trim() || /(no (?:explicit |visible )?(?:call[- ]to[- ]action|cta)|none observed)/.test(textValue)) return 'none';
  if (/(sign up|apply|click|download|post your job|try )/.test(textValue)) return 'apply_or_click';
  if (/(follow|comment)/.test(textValue)) return 'follow_or_comment';
  if (/(save|share)/.test(textValue)) return 'save_or_share';
  if (textValue.includes('?') || /(let me know|tell us)/.test(textValue)) return 'question_prompt';
  return 'soft_prompt';
}

function sourceGroup(handle: string): VideoMapItem['source_group'] {
  const normalized = handle.toLowerCase();
  if ([
    'joinhandshake',
    'ripplematch',
    'wayup',
    'simplifyjobs',
    'joinsimplify',
    'simplify.jobs',
    'microinternships',
    'theforage',
    'externhq',
    'virtual_internships',
    'virtualinternships',
    'careeredgeorg',
  ].includes(normalized)) {
    return 'competitor_brand';
  }
  if (normalized === 'fordcoleman_') return 'founder_adjacent';
  return 'category_creator';
}

function parseAnalysis(value: string | null): Analysis | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Analysis;
  } catch {
    return null;
  }
}

function parseAnalysisValue(value: unknown): Analysis | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Analysis
    : null;
}

function sqliteJson<T>(dbPath: string, sql: string): T[] {
  const output = execFileSync('sqlite3', ['-json', path.resolve(dbPath)], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  }).trim();
  return output ? JSON.parse(output) as T[] : [];
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function readOptionalJson(filePath: string): unknown {
  return fs.existsSync(path.resolve(filePath)) ? readJson(filePath) : {};
}

function arrayAt(value: unknown, field: string): unknown[] {
  return array(record(value)[field]);
}

function discoveryRunItems(value: unknown, runIdFragment: string): unknown[] {
  return array(record(value).runs)
    .map(record)
    .filter((run) => text(run.id).includes(runIdFragment))
    .flatMap((run) => array(run.items));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textOrNull(value: unknown): string | null {
  return text(value) || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function counts(values: string[]): Record<string, number> {
  return Object.fromEntries(
    [...values.reduce((map, value) => map.set(value || 'unknown', (map.get(value || 'unknown') ?? 0) + 1), new Map<string, number>())]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function inlineCounts(value: Record<string, number>): string {
  return Object.entries(value).map(([label, count]) => `${label} ${count}`).join(', ') || 'none';
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function parseCli(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    values.set(key, value);
    index += 1;
  }
  return {
    dbPath: values.get('--db') ?? '.semantic-artifacts/competitor-content/semantic_corpus.sqlite',
    instagramDiscoveryPath: values.get('--instagram') ?? '.semantic-artifacts/competitor-content/discovery/internship-content-expansion-20260716.json',
    metaAdsPath: values.get('--ads') ?? '.semantic-artifacts/competitor-content/discovery/meta-active-competitor-ads-expanded-relevant-20260716.json',
    metaAdAnalysisPath: values.get('--ad-analysis') ?? '.semantic-artifacts/competitor-content/reports/meta-active-video-ads-semantic-expanded-20260716.json',
    researchExpansionPath: values.get('--research-expansion') ?? '.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-expansion.json',
    semanticResourceCatalogPath: values.get('--resources') ?? '.ops/competitor_research/internship-semantic-resources-20260717.json',
    outJsonPath: values.get('--out-json') ?? '.semantic-artifacts/competitor-content/reports/internship-content-semantic-map-20260716.json',
    outMarkdownPath: values.get('--out-md') ?? 'docs/INTERNSHIP_CONTENT_SEMANTIC_MAP_20260716.md',
  };
}

function main(): void {
  const options = parseCli(process.argv.slice(2));
  const map = buildCompetitorContentMap(options);
  atomicWriteJson(path.resolve(options.outJsonPath), map);
  atomicWriteFile(path.resolve(options.outMarkdownPath), renderCompetitorContentMapMarkdown(map));
  process.stdout.write(`${JSON.stringify({
    status: 'completed',
    videos: map.coverage.videos_in_database,
    multimodal_videos: map.coverage.videos_multimodally_mapped,
    semantic_items: map.coverage.semantic_items,
    active_meta_ads: map.coverage.active_meta_ads_observed,
    unique_meta_ad_concepts: map.coverage.unique_meta_ad_concepts_observed,
    semantic_resources: map.resource_catalog.resources.length,
    research_expansion_status: map.research_expansion.status,
    output_paths: [options.outJsonPath, options.outMarkdownPath],
  }, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
