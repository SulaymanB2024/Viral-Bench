import type { AudienceSignal, SelectionLedger } from './internship-research-batch';

const HIGH_PERFORMANCE_THRESHOLD = 0.75;
const MIN_CONTRAST_CATEGORY_COUNT = 3;
const MAX_REPORTED_CONTRASTS = 8;

export interface ResearchSynthesisVideo {
  evidence_id: string;
  platform?: string;
  normalized_performance_score: number | null;
  topic: string;
  hook_type: string;
  format: string;
  cta_type: string;
  semantic_state: 'multimodal_mapped' | 'metadata_only';
}

export interface AudienceThemeDepth {
  theme: string;
  signal_count: number;
  signal_share: number;
  unique_source_pages: number;
  source_page_share: number;
  largest_source_share: number;
  average_signal_confidence: number;
  source_pattern: 'distributed' | 'mixed' | 'concentrated';
  evidence_strength: 'moderate' | 'directional' | 'thin';
  evidence_ids: string[];
}

export interface PerformanceContrast {
  dimension: 'topic' | 'hook_type' | 'format' | 'cta_type';
  category: string;
  high_performance_count: number;
  high_performance_total: number;
  high_performance_share: number;
  comparison_count: number;
  comparison_total: number;
  comparison_share: number;
  percentage_point_delta: number;
  relative_index: number | null;
  direction: 'overrepresented' | 'underrepresented';
  stability: 'directional' | 'fragile';
  sensitivity: PerformanceContrastSensitivity;
  platform_sensitivity: PerformanceContrastPlatformSensitivity;
  evidence_ids: string[];
  interpretation: string;
}

export interface PerformanceContrastSensitivity {
  method: 'leave_one_video_out';
  runs: number;
  direction_consistency: number;
  sign_flip_count: number;
  zero_delta_count: number;
  minimum_percentage_point_delta: number;
  maximum_percentage_point_delta: number;
  assessment: 'direction_holds' | 'single_video_sensitive' | 'insufficient_for_sensitivity';
  most_influential_evidence_ids: string[];
  interpretation: string;
}

export interface PerformanceContrastPlatformSensitivity {
  method: 'leave_one_platform_out';
  platforms: string[];
  runs: number;
  direction_consistency: number;
  sign_flip_count: number;
  zero_delta_count: number;
  minimum_percentage_point_delta: number;
  maximum_percentage_point_delta: number;
  assessment: 'cross_platform_direction_holds' | 'platform_sensitive' | 'insufficient_platform_coverage';
  omitted_platform_deltas: Array<{
    platform: string;
    percentage_point_delta: number;
  }>;
  interpretation: string;
}

export interface ResearchFinding {
  id: string;
  conclusion: string;
  confidence: 'low' | 'medium';
  reasoning: string;
  evidence: string[];
  evidence_ids: string[];
  alternative_explanations: string[];
  decision_implication: string;
  would_change_our_mind: string[];
}

export interface ResearchTension {
  id: string;
  tension: string;
  why_it_matters: string;
  current_resolution: string;
}

export interface OwnedResearchTest {
  id: string;
  hypothesis: string;
  intervention: string;
  comparator: string;
  primary_measures: string[];
  guardrails: string[];
  minimum_design: string;
  falsification_rule: string;
  rationale_finding_ids: string[];
}

export interface InternshipResearchSynthesis {
  schema_version: 1;
  generated_at: string;
  method: {
    audience_observation_unit: 'identity_free_public_signal';
    source_independence_unit: 'unique_public_source_url';
    performance_comparison: 'within_platform_and_age_bucket_percentile';
    high_performance_threshold: number;
    causal_claims_allowed: false;
    interpretation_policy: 'observation_then_alternative_explanation_then_owned_test';
  };
  sample: {
    audience_signals: number;
    unique_audience_source_pages: number;
    content_videos: number;
    scored_content_videos: number;
    high_performance_videos: number;
    comparison_videos: number;
    selected_research_posts: number;
  };
  audience_theme_depth: AudienceThemeDepth[];
  performance_contrasts: PerformanceContrast[];
  findings: ResearchFinding[];
  tensions: ResearchTension[];
  owned_test_priorities: OwnedResearchTest[];
  unresolved_questions: string[];
  evidence_boundaries: string[];
}

export function buildInternshipResearchSynthesis(input: {
  generatedAt: string;
  audienceSignals: AudienceSignal[];
  videos: ResearchSynthesisVideo[];
  selectionCounts: SelectionLedger['counts'];
  measurementGaps: string[];
}): InternshipResearchSynthesis {
  const scoredVideos = input.videos.filter(
    (video) => video.normalized_performance_score !== null,
  );
  const highPerformanceVideos = scoredVideos.filter(
    (video) => (video.normalized_performance_score ?? -1) >= HIGH_PERFORMANCE_THRESHOLD,
  );
  const comparisonVideos = scoredVideos.filter(
    (video) => (video.normalized_performance_score ?? -1) < HIGH_PERFORMANCE_THRESHOLD,
  );
  const audienceThemeDepth = buildAudienceThemeDepth(input.audienceSignals);
  const performanceContrasts = buildPerformanceContrasts(
    highPerformanceVideos,
    comparisonVideos,
  );
  const findings = buildFindings(
    input.audienceSignals,
    input.videos,
    audienceThemeDepth,
    performanceContrasts,
  );

  return {
    schema_version: 1,
    generated_at: input.generatedAt,
    method: {
      audience_observation_unit: 'identity_free_public_signal',
      source_independence_unit: 'unique_public_source_url',
      performance_comparison: 'within_platform_and_age_bucket_percentile',
      high_performance_threshold: HIGH_PERFORMANCE_THRESHOLD,
      causal_claims_allowed: false,
      interpretation_policy: 'observation_then_alternative_explanation_then_owned_test',
    },
    sample: {
      audience_signals: input.audienceSignals.length,
      unique_audience_source_pages: new Set(
        input.audienceSignals.map((signal) => signal.source_url),
      ).size,
      content_videos: input.videos.length,
      scored_content_videos: scoredVideos.length,
      high_performance_videos: highPerformanceVideos.length,
      comparison_videos: comparisonVideos.length,
      selected_research_posts: input.selectionCounts.selected,
    },
    audience_theme_depth: audienceThemeDepth,
    performance_contrasts: performanceContrasts,
    findings,
    tensions: buildTensions(audienceThemeDepth, performanceContrasts),
    owned_test_priorities: buildOwnedTests(),
    unresolved_questions: [
      'Do the same audience themes persist when community coverage expands beyond the currently available sources?',
      'Which observed patterns survive human recoding of topic, hook, format, and CTA labels?',
      'Which patterns replicate on owned posts after matching platform, topic, duration, posting window, and audience size?',
      'Do saves, completion, qualified comments, and downstream visits agree, or does each creative pattern optimize a different outcome?',
      ...input.measurementGaps.slice(0, 5),
    ],
    evidence_boundaries: [
      'Audience-signal counts are not survey prevalence estimates. Unique source pages are reported to expose source concentration.',
      'The 75th-percentile split is an exploratory descriptive contrast inside platform and posting-age cohorts, not a causal threshold.',
      'Taxonomy labels are heuristic and can create or hide apparent differences; they require human recoding before confirmatory use.',
      'Observed competitor performance can generate owned-content hypotheses, but it cannot identify why a platform distributed a post.',
      'A recommendation is retained only as a testable decision with a stated alternative explanation and falsification rule.',
    ],
  };
}

function buildAudienceThemeDepth(signals: AudienceSignal[]): AudienceThemeDepth[] {
  const byTheme = groupBy(signals, (signal) => signal.theme);
  return [...byTheme.entries()].map(([theme, rows]): AudienceThemeDepth => {
    const bySource = groupBy(rows, (signal) => signal.source_url);
    const largestSourceCount = Math.max(...[...bySource.values()].map((items) => items.length));
    const sourcePageShare = ratio(bySource.size, rows.length);
    const largestSourceShare = ratio(largestSourceCount, rows.length);
    const sourcePattern = largestSourceShare >= 0.5
      ? 'concentrated'
      : sourcePageShare >= 0.6 && bySource.size >= 4
        ? 'distributed'
        : 'mixed';
    const evidenceStrength = bySource.size >= 8 && rows.length >= 10
      ? 'moderate'
      : bySource.size >= 3 && rows.length >= 4
        ? 'directional'
        : 'thin';
    return {
      theme,
      signal_count: rows.length,
      signal_share: ratio(rows.length, signals.length),
      unique_source_pages: bySource.size,
      source_page_share: sourcePageShare,
      largest_source_share: largestSourceShare,
      average_signal_confidence: round(
        rows.reduce((sum, signal) => sum + signal.confidence, 0) / rows.length,
      ),
      source_pattern: sourcePattern,
      evidence_strength: evidenceStrength,
      evidence_ids: rows.slice(0, 8).map((signal) => signal.signal_id),
    };
  }).sort((left, right) => (
    right.signal_count - left.signal_count
    || right.unique_source_pages - left.unique_source_pages
    || left.theme.localeCompare(right.theme)
  ));
}

function buildPerformanceContrasts(
  highPerformanceVideos: ResearchSynthesisVideo[],
  comparisonVideos: ResearchSynthesisVideo[],
): PerformanceContrast[] {
  if (!highPerformanceVideos.length || !comparisonVideos.length) return [];
  const dimensions: PerformanceContrast['dimension'][] = [
    'topic',
    'hook_type',
    'format',
    'cta_type',
  ];
  const contrasts = dimensions.flatMap((dimension) => {
    const categories = new Set([
      ...highPerformanceVideos.map((video) => video[dimension]),
      ...comparisonVideos.map((video) => video[dimension]),
    ]);
    return [...categories].flatMap((category): PerformanceContrast[] => {
      if (!category || category === 'unknown' || category === 'unclear') return [];
      const high = highPerformanceVideos.filter((video) => video[dimension] === category);
      const comparison = comparisonVideos.filter((video) => video[dimension] === category);
      if (high.length + comparison.length < MIN_CONTRAST_CATEGORY_COUNT) return [];
      const highShare = ratio(high.length, highPerformanceVideos.length);
      const comparisonShare = ratio(comparison.length, comparisonVideos.length);
      const delta = round(highShare - comparisonShare);
      if (delta === 0) return [];
      const sensitivity = buildPerformanceContrastSensitivity(
        dimension,
        category,
        highPerformanceVideos,
        comparisonVideos,
        delta,
      );
      const platformSensitivity = buildPerformanceContrastPlatformSensitivity(
        dimension,
        category,
        highPerformanceVideos,
        comparisonVideos,
        delta,
      );
      return [{
        dimension,
        category,
        high_performance_count: high.length,
        high_performance_total: highPerformanceVideos.length,
        high_performance_share: highShare,
        comparison_count: comparison.length,
        comparison_total: comparisonVideos.length,
        comparison_share: comparisonShare,
        percentage_point_delta: delta,
        relative_index: comparisonShare === 0 ? null : round(highShare / comparisonShare),
        direction: delta > 0 ? 'overrepresented' : 'underrepresented',
        stability: (
          high.length >= 4
          && comparison.length >= 4
          && sensitivity.assessment === 'direction_holds'
        ) ? 'directional' : 'fragile',
        sensitivity,
        platform_sensitivity: platformSensitivity,
        evidence_ids: [...high, ...comparison]
          .sort((left, right) => (
            (right.normalized_performance_score ?? -1)
            - (left.normalized_performance_score ?? -1)
          ))
          .slice(0, 8)
          .map((video) => video.evidence_id),
        interpretation: `${sentenceLabel(dimension)} "${label(category)}" is ${formatPercentagePoints(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} prevalent in the at-or-above 75th-percentile group. ${sensitivity.interpretation} ${platformSensitivity.interpretation} Treat this as a matched-test candidate, not a winning formula.`,
      }];
    });
  });
  return contrasts
    .sort((left, right) => (
      Math.abs(right.percentage_point_delta) - Math.abs(left.percentage_point_delta)
      || left.dimension.localeCompare(right.dimension)
      || left.category.localeCompare(right.category)
    ))
    .slice(0, MAX_REPORTED_CONTRASTS);
}

function buildPerformanceContrastSensitivity(
  dimension: PerformanceContrast['dimension'],
  category: string,
  highPerformanceVideos: ResearchSynthesisVideo[],
  comparisonVideos: ResearchSynthesisVideo[],
  originalDelta: number,
): PerformanceContrastSensitivity {
  const runs: Array<{
    evidence_id: string;
    delta: number;
    influence: number;
  }> = [];
  const recordRun = (
    removed: ResearchSynthesisVideo,
    highRows: ResearchSynthesisVideo[],
    comparisonRows: ResearchSynthesisVideo[],
  ) => {
    if (!highRows.length || !comparisonRows.length) return;
    const highShare = ratio(
      highRows.filter((video) => video[dimension] === category).length,
      highRows.length,
    );
    const comparisonShare = ratio(
      comparisonRows.filter((video) => video[dimension] === category).length,
      comparisonRows.length,
    );
    const delta = round(highShare - comparisonShare);
    runs.push({
      evidence_id: removed.evidence_id,
      delta,
      influence: round(Math.abs(delta - originalDelta)),
    });
  };

  highPerformanceVideos.forEach((removed, index) => {
    recordRun(
      removed,
      highPerformanceVideos.filter((_, rowIndex) => rowIndex !== index),
      comparisonVideos,
    );
  });
  comparisonVideos.forEach((removed, index) => {
    recordRun(
      removed,
      highPerformanceVideos,
      comparisonVideos.filter((_, rowIndex) => rowIndex !== index),
    );
  });

  const originalDirection = Math.sign(originalDelta);
  const directionMatches = runs.filter(
    (run) => Math.sign(run.delta) === originalDirection,
  ).length;
  const signFlipCount = runs.filter(
    (run) => Math.sign(run.delta) === -originalDirection,
  ).length;
  const zeroDeltaCount = runs.filter((run) => run.delta === 0).length;
  const directionConsistency = ratio(directionMatches, runs.length);
  const assessment = runs.length < 4
    ? 'insufficient_for_sensitivity'
    : signFlipCount > 0 || zeroDeltaCount > 0 || directionConsistency < 1
      ? 'single_video_sensitive'
      : 'direction_holds';
  const deltas = runs.length ? runs.map((run) => run.delta) : [originalDelta];
  const minimumDelta = round(Math.min(...deltas));
  const maximumDelta = round(Math.max(...deltas));
  const mostInfluentialEvidenceIds = unique(
    [...runs]
      .sort((left, right) => (
        right.influence - left.influence
        || left.evidence_id.localeCompare(right.evidence_id)
      ))
      .map((run) => run.evidence_id),
  ).slice(0, 3);
  const interpretation = assessment === 'insufficient_for_sensitivity'
    ? `Only ${runs.length} valid leave-one-video-out runs were possible, so single-record sensitivity remains unresolved.`
    : `The direction survives ${directionMatches}/${runs.length} leave-one-video-out runs; the delta ranges from ${formatSignedPercent(minimumDelta)} to ${formatSignedPercent(maximumDelta)}${signFlipCount || zeroDeltaCount ? `, with ${signFlipCount} sign flips and ${zeroDeltaCount} zero-delta runs` : ''}.`;

  return {
    method: 'leave_one_video_out',
    runs: runs.length,
    direction_consistency: directionConsistency,
    sign_flip_count: signFlipCount,
    zero_delta_count: zeroDeltaCount,
    minimum_percentage_point_delta: minimumDelta,
    maximum_percentage_point_delta: maximumDelta,
    assessment,
    most_influential_evidence_ids: mostInfluentialEvidenceIds,
    interpretation,
  };
}

function buildPerformanceContrastPlatformSensitivity(
  dimension: PerformanceContrast['dimension'],
  category: string,
  highPerformanceVideos: ResearchSynthesisVideo[],
  comparisonVideos: ResearchSynthesisVideo[],
  originalDelta: number,
): PerformanceContrastPlatformSensitivity {
  const platforms = unique(
    [...highPerformanceVideos, ...comparisonVideos].map(platformForVideo),
  ).sort();
  const omittedPlatformDeltas = platforms.flatMap((platform) => {
    const highRows = highPerformanceVideos.filter(
      (video) => platformForVideo(video) !== platform,
    );
    const comparisonRows = comparisonVideos.filter(
      (video) => platformForVideo(video) !== platform,
    );
    if (!highRows.length || !comparisonRows.length) return [];
    const highShare = ratio(
      highRows.filter((video) => video[dimension] === category).length,
      highRows.length,
    );
    const comparisonShare = ratio(
      comparisonRows.filter((video) => video[dimension] === category).length,
      comparisonRows.length,
    );
    return [{
      platform,
      percentage_point_delta: round(highShare - comparisonShare),
    }];
  });
  const originalDirection = Math.sign(originalDelta);
  const directionMatches = omittedPlatformDeltas.filter(
    (run) => Math.sign(run.percentage_point_delta) === originalDirection,
  ).length;
  const signFlipCount = omittedPlatformDeltas.filter(
    (run) => Math.sign(run.percentage_point_delta) === -originalDirection,
  ).length;
  const zeroDeltaCount = omittedPlatformDeltas.filter(
    (run) => run.percentage_point_delta === 0,
  ).length;
  const directionConsistency = ratio(directionMatches, omittedPlatformDeltas.length);
  const assessment = platforms.length < 2 || omittedPlatformDeltas.length < 2
    ? 'insufficient_platform_coverage'
    : signFlipCount > 0 || zeroDeltaCount > 0 || directionConsistency < 1
      ? 'platform_sensitive'
      : 'cross_platform_direction_holds';
  const deltas = omittedPlatformDeltas.length
    ? omittedPlatformDeltas.map((run) => run.percentage_point_delta)
    : [originalDelta];
  const minimumDelta = round(Math.min(...deltas));
  const maximumDelta = round(Math.max(...deltas));
  const interpretation = assessment === 'insufficient_platform_coverage'
    ? `Only ${platforms.length} platform${platforms.length === 1 ? '' : 's'} supplied valid scored coverage, so platform-level sensitivity remains unresolved.`
    : `The direction survives ${directionMatches}/${omittedPlatformDeltas.length} leave-one-platform-out runs; the platform-omission range is ${formatSignedPercent(minimumDelta)} to ${formatSignedPercent(maximumDelta)}${signFlipCount || zeroDeltaCount ? `, with ${signFlipCount} sign flips and ${zeroDeltaCount} zero-delta runs` : ''}.`;

  return {
    method: 'leave_one_platform_out',
    platforms,
    runs: omittedPlatformDeltas.length,
    direction_consistency: directionConsistency,
    sign_flip_count: signFlipCount,
    zero_delta_count: zeroDeltaCount,
    minimum_percentage_point_delta: minimumDelta,
    maximum_percentage_point_delta: maximumDelta,
    assessment,
    omitted_platform_deltas: omittedPlatformDeltas,
    interpretation,
  };
}

function buildFindings(
  signals: AudienceSignal[],
  videos: ResearchSynthesisVideo[],
  themes: AudienceThemeDepth[],
  contrasts: PerformanceContrast[],
): ResearchFinding[] {
  const findings: ResearchFinding[] = [];
  const theme = (id: string) => themes.find((item) => item.theme === id);
  const topicVideos = (id: string) => videos.filter((video) => video.topic === id);
  const general = theme('general_early_career_uncertainty');
  if (general) {
    findings.push({
      id: 'broad_uncertainty_is_a_routing_signal',
      conclusion: 'Broad early-career uncertainty is a routing signal, not a sufficiently specific creative brief.',
      confidence: general.evidence_strength === 'moderate' ? 'medium' : 'low',
      reasoning: `${general.signal_count} of ${signals.length} signals were assigned to the broad uncertainty theme across ${general.unique_source_pages} source pages. The breadth is real enough to prioritize diagnosis, but the label is too broad to identify one intervention.`,
      evidence: [
        `${general.signal_count}/${signals.length} identity-free signals (${formatShare(general.signal_share)})`,
        `${general.unique_source_pages} unique source pages; largest page contributed ${formatShare(general.largest_source_share)}`,
      ],
      evidence_ids: general.evidence_ids,
      alternative_explanations: [
        'The comment classifier may default ambiguous short comments into the broad theme.',
        'A few selected videos may invite generic questions that do not represent the wider student population.',
      ],
      decision_implication: 'Open with one recognizable moment, then route the viewer to one bounded next action instead of publishing generic job-search reassurance.',
      would_change_our_mind: [
        'Human recoding splits most broad-theme signals into stable, narrower needs.',
        'Owned generic-advice posts outperform matched specific-diagnostic posts on retention and saves.',
      ],
    });
  }

  const proof = theme('resume_and_proof');
  const proofVideos = topicVideos('resume_and_application');
  const proofContrast = contrasts.find(
    (contrast) => contrast.dimension === 'topic' && contrast.category === 'resume_and_application',
  );
  if (proof && proofVideos.length) {
    findings.push({
      id: 'proof_is_a_product_wedge_not_an_automatic_reach_mechanism',
      conclusion: 'Proof-building is a credible product wedge, but “resume content” is not automatically a reach mechanism.',
      confidence: 'medium',
      reasoning: `Proof appears in ${proof.signal_count} audience signals across ${proof.unique_source_pages} source pages and in ${proofVideos.length} of ${videos.length} mapped videos. Yet the resume/application label is ${proofContrast ? `${formatPercentagePoints(Math.abs(proofContrast.percentage_point_delta))} ${proofContrast.direction}` : 'not established as overrepresented'} in the exploratory high-performance split.`,
      evidence: [
        `${proof.signal_count} audience signals from ${proof.unique_source_pages} unique source pages`,
        `${proofVideos.length}/${videos.length} mapped videos use the resume/application topic`,
        proofContrast
          ? `${proofContrast.high_performance_count}/${proofContrast.high_performance_total} high-performance versus ${proofContrast.comparison_count}/${proofContrast.comparison_total} comparison videos`
          : 'No stable performance contrast was available',
      ],
      evidence_ids: unique([
        ...proof.evidence_ids,
        ...proofVideos.slice(0, 8).map((video) => video.evidence_id),
      ]),
      alternative_explanations: [
        'The topic label combines weak generic tips with stronger visible transformations.',
        'Platform, creator, recency, and execution quality may explain the observed performance split.',
      ],
      decision_implication: 'Keep Close the Proof Gap as the core demonstration, but package it as a visible requirement-to-evidence transformation rather than another resume tip.',
      would_change_our_mind: [
        'Matched owned proof-transformation posts fail to improve saves or completion versus generic advice.',
        'Human recoding shows that the apparent cross-source proof theme is a taxonomy artifact.',
      ],
    });
  }

  const access = theme('access_compensation_and_cost');
  if (access) {
    findings.push({
      id: 'access_is_important_but_currently_source_concentrated',
      conclusion: 'Affordability and access deserve an explicit exploration lane, but the current count cannot support a prevalence claim.',
      confidence: 'low',
      reasoning: `${access.signal_count} signals mention cost or access, but they come from only ${access.unique_source_pages} source pages and the largest page supplies ${formatShare(access.largest_source_share)} of them.`,
      evidence: [
        `${access.signal_count}/${signals.length} identity-free audience signals`,
        `${access.unique_source_pages} unique source pages`,
        `Source pattern: ${access.source_pattern}`,
      ],
      evidence_ids: access.evidence_ids,
      alternative_explanations: [
        'One source video may have elicited a locally intense concern that is not broadly prevalent.',
        'Cost concerns may be undercounted elsewhere because the collection queries did not target affordability directly.',
      ],
      decision_implication: 'Test Can I Afford This Internship? as a bounded editorial lane and judge it on qualified saves, comments, and downstream actions—not on the current raw signal count.',
      would_change_our_mind: [
        'A broader source sample does not reproduce the theme.',
        'Matched owned tests show no qualified engagement or useful follow-up behavior.',
      ],
    });
  }

  const positiveContrast = contrasts.find((contrast) => (
    contrast.direction === 'overrepresented'
    && contrast.stability === 'directional'
    && contrast.dimension !== 'topic'
  )) ?? contrasts.find((contrast) => contrast.direction === 'overrepresented');
  if (positiveContrast) {
    findings.push({
      id: 'observed_winner_pattern_requires_owned_replication',
      conclusion: `${sentenceLabel(positiveContrast.category)} is a candidate mechanism to test, not a template to copy.`,
      confidence: 'low',
      reasoning: `${positiveContrast.interpretation} The contrast remains observational and shares causes with creator, topic, platform, age, and production differences.`,
      evidence: [
        `${positiveContrast.high_performance_count}/${positiveContrast.high_performance_total} high-performance videos`,
        `${positiveContrast.comparison_count}/${positiveContrast.comparison_total} comparison videos`,
        `${formatSignedPercent(positiveContrast.percentage_point_delta)} prevalence difference`,
      ],
      evidence_ids: positiveContrast.evidence_ids,
      alternative_explanations: [
        'The category may be correlated with a topic or creator rather than performance.',
        'The heuristic label may not capture the actual opening mechanism.',
      ],
      decision_implication: 'Use a matched owned-content pair to isolate the pattern while holding topic, platform, duration, and posting window as constant as practical.',
      would_change_our_mind: [
        'The contrast disappears after human recoding or basic stratification.',
        'Three matched owned pairs do not reproduce the directional retention difference.',
      ],
    });
  }
  return findings;
}

function buildTensions(
  themes: AudienceThemeDepth[],
  contrasts: PerformanceContrast[],
): ResearchTension[] {
  const proofContrast = contrasts.find(
    (contrast) => contrast.dimension === 'topic' && contrast.category === 'resume_and_application',
  );
  const access = themes.find((theme) => theme.theme === 'access_compensation_and_cost');
  return [
    {
      id: 'audience_need_vs_distribution',
      tension: `A topic can be strategically important even when it is not overrepresented among observed high performers${proofContrast ? `; resume/application is ${formatSignedPercent(proofContrast.percentage_point_delta)} in this split` : ''}.`,
      why_it_matters: 'Optimizing only for competitor reach would erase product differentiation and audience utility.',
      current_resolution: 'Use competitor performance to shape packaging, while audience evidence and product truth determine which problems deserve coverage.',
    },
    {
      id: 'signal_volume_vs_source_independence',
      tension: access
        ? `${access.signal_count} affordability signals compress to ${access.unique_source_pages} source pages.`
        : 'Raw signal volume can mask repeated observations from the same source page.',
      why_it_matters: 'Repeated comments can show intensity around one stimulus without establishing broad prevalence.',
      current_resolution: 'Report both signal count and unique source pages; treat concentrated themes as exploration lanes.',
    },
    {
      id: 'pattern_reuse_vs_causal_story',
      tension: 'Within-cohort performance contrasts are useful for hypothesis generation but cannot identify why distribution occurred.',
      why_it_matters: 'A plausible creative story can become false certainty if creator, platform, timing, and audience are ignored.',
      current_resolution: 'Translate each pattern into a matched owned test with an explicit falsification rule.',
    },
    {
      id: 'taxonomy_reproducibility_vs_meaning',
      tension: 'Heuristic labels are reproducible, but reproducibility alone does not make them semantically correct.',
      why_it_matters: 'Broad or overlapping labels can manufacture apparent gaps and performance differences.',
      current_resolution: 'Keep labels as exploratory metadata and require human recoding before confirmatory decisions.',
    },
  ];
}

function buildOwnedTests(): OwnedResearchTest[] {
  return [
    {
      id: 'proof_transformation_vs_generic_advice',
      hypothesis: 'A visible requirement-to-evidence transformation will improve completion and saves relative to generic resume advice.',
      intervention: 'Show one job requirement, one truthful student evidence item, one before/after rewrite, and one review check.',
      comparator: 'Cover the same requirement with advice-only narration and no visible transformation.',
      primary_measures: ['3-second retention', 'completion rate', 'saves per 1,000 qualified views'],
      guardrails: ['No invented experience', 'Matched platform and duration', 'Equivalent measurement windows'],
      minimum_design: 'At least three paired posts with topic, duration, posting window, and distribution conditions matched as closely as practical.',
      falsification_rule: 'Reject the directional hypothesis if the intervention fails to beat its matched comparator on median completion and saves across the paired set.',
      rationale_finding_ids: ['proof_is_a_product_wedge_not_an_automatic_reach_mechanism'],
    },
    {
      id: 'question_diagnosis_vs_direct_statement',
      hypothesis: 'A specific diagnostic question will improve early retention relative to a direct statement on the same student problem.',
      intervention: 'Open with a concrete question that names one observable job-search moment.',
      comparator: 'State the same problem and promise directly without a question.',
      primary_measures: ['3-second retention', 'average watch time', 'completion rate'],
      guardrails: ['Keep body, proof, CTA, duration, and visual treatment equivalent', 'No platform-to-platform comparison'],
      minimum_design: 'At least three within-platform matched pairs before treating the direction as repeatable.',
      falsification_rule: 'Reject the directional hypothesis if the question opening does not improve median 3-second retention across the matched pairs.',
      rationale_finding_ids: ['observed_winner_pattern_requires_owned_replication'],
    },
    {
      id: 'affordability_utility_lane',
      hypothesis: 'A full-cost internship check will earn more qualified saves and specific follow-up questions than prestige-led opportunity coverage.',
      intervention: 'Show disclosed pay, housing, transit, lost-wage assumptions, unknowns, and a first-party verification path.',
      comparator: 'Cover the same opportunity through employer prestige and role description without the cost inventory.',
      primary_measures: ['qualified saves', 'specific cost or access comments', 'verified outbound actions'],
      guardrails: ['Use current first-party facts', 'Label unknowns', 'No legal or financial guarantee'],
      minimum_design: 'Run at least three matched opportunity pairs across different cost profiles and review comment quality manually.',
      falsification_rule: 'Pause the lane if it does not improve qualified saves or produce materially more specific access questions across the matched set.',
      rationale_finding_ids: ['access_is_important_but_currently_source_concentrated'],
    },
  ];
}

function groupBy<T>(values: T[], keyFor: (value: T) => string): Map<string, T[]> {
  const output = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    output.set(key, [...(output.get(key) ?? []), value]);
  }
  return output;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator) : 0;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function platformForVideo(video: ResearchSynthesisVideo): string {
  const explicit = video.platform?.trim().toLowerCase();
  if (explicit) return explicit;
  if (!video.evidence_id.includes(':')) return 'unknown';
  const [prefix] = video.evidence_id.split(':', 1);
  return prefix?.trim().toLowerCase() || 'unknown';
}

function label(value: string): string {
  return value.replace(/_/g, ' ');
}

function sentenceLabel(value: string): string {
  const copy = label(value);
  return `${copy.charAt(0).toUpperCase()}${copy.slice(1)}`;
}

function formatPercentagePoints(value: number): string {
  return `${(value * 100).toFixed(1)} percentage points`;
}

function formatShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number): string {
  const formatted = (value * 100).toFixed(1);
  return `${value > 0 ? '+' : ''}${formatted} percentage points`;
}
