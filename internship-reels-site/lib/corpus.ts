import { createHash } from 'node:crypto';

import {
  CONTENT_TYPES,
  PERFORMANCE_SIGNALS,
  SOCIAL_PLATFORMS,
  type AgentAnalysis,
  type AgentCorpus,
  type AgentMetrics,
  type EvidenceContentType,
  type EvidenceDocument,
  type EvidenceVisibility,
  type OfficialEvidenceDocument,
  type PerformanceSignal,
  type SocialEvidenceDocument,
  type SocialPlatform,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const INLINE_URL = /\bhttps?:\/\/[^\s<>"']+/gi;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMPTY_METRICS: AgentMetrics = {
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  engagement_rate: null,
  observed_view_velocity_per_hour: null,
};

export interface CorpusBuildOptions {
  audienceInputs?: unknown[];
  analysisInputs?: unknown[];
  officialInput?: unknown;
  ownedInput?: unknown;
}

export function sanitizePublicText(value: unknown, maxLength = 3_000): string {
  if (typeof value !== 'string') return '';
  const withoutContacts = value
    .replace(EMAIL, '[email redacted]')
    .replace(INLINE_URL, '[link redacted]')
    .replace(/(?:\+?\d[\s().-]*){7,}/g, (candidate) => (
      candidate.replace(/\D/g, '').length >= 7 ? '[phone redacted]' : candidate
    ))
    .replace(CONTROL, ' ');
  const compact = withoutContacts.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function parseDashboardSnapshot(source: string): UnknownRecord {
  const marker = 'window.__TWELVELABS_DASHBOARD_SNAPSHOT__ = ';
  const start = source.indexOf(marker);
  const endMarker = ';\nwindow.dispatchEvent';
  const end = source.indexOf(endMarker, start + marker.length);
  if (start < 0 || end < 0) {
    throw new Error('TwelveLabs dashboard snapshot assignment was not found.');
  }
  const parsed = JSON.parse(source.slice(start + marker.length, end)) as unknown;
  return record(parsed, 'dashboard snapshot');
}

export function buildAgentCorpus(
  libraryInput: unknown,
  dashboardInput: unknown,
  options: CorpusBuildOptions = {},
): AgentCorpus {
  const library = record(libraryInput, 'library');
  const dashboard = record(dashboardInput, 'dashboard');
  const items = array(library.items);
  const dashboardRecords = [
    ...array(dashboard.records),
    ...(options.analysisInputs ?? []).flatMap((input) => array(optionalRecord(input)?.records)),
  ];
  const documents = new Map<string, EvidenceDocument>();
  const skippedByReason = new Map<string, number>();
  const skip = (source: string, reason: string): void => {
    const key = `${source}:${reason}`;
    skippedByReason.set(key, (skippedByReason.get(key) ?? 0) + 1);
  };

  for (const input of items) {
    const item = optionalRecord(input);
    if (!item) {
      skip('library', 'invalid_row_shape');
      continue;
    }
    const platform = socialPlatform(item.platform);
    const platformPostId = text(item.platform_post_id);
    if (!platform) {
      skip('library', 'invalid_or_missing_platform');
      continue;
    }
    if (!platformPostId) {
      skip('library', 'missing_platform_post_id');
      continue;
    }
    const performance = optionalRecord(item.performance);
    const observations = array(item.observations);
    const latestObservation = optionalRecord(observations.at(-1));
    const provenanceInput = optionalRecord(item.provenance);
    const sourceIds = uniqueStrings([
      ...textArray(provenanceInput?.source_reports),
      ...array(latestObservation?.source_reports).flatMap((value) => typeof value === 'string' ? [value] : []),
    ]);
    const observedVelocity = nullableNumber(performance?.observed_view_velocity_per_hour);
    const observationCount = nullableNumber(item.observation_count) ?? observations.length;
    const document = finalizeDocument({
      document_id: `evidence:${platform}:${platformPostId}`,
      item_id: text(item.item_id) || `${platform}:post:${platformPostId}`,
      evidence_type: 'social_post',
      visibility: 'public_reviewed',
      review_method: 'deterministic_contract',
      content_type: contentType(item.content_type, platform),
      topic_tags: uniqueStrings(textArray(item.hashtags)),
      audience_states: [],
      confidence: sanitizePublicText(performance?.confidence, 40) || 'unknown',
      confidence_score: confidenceScore(performance?.confidence),
      provenance: {
        source_kind: 'public_social',
        source_ids: sourceIds,
        publisher: null,
        authority: 'public_social_snapshot',
        jurisdiction: null,
        source_count: Math.max(1, sourceIds.length),
        independent_source_count: Math.max(1, sourceIds.length),
      },
      freshness: {
        status: 'not_applicable',
        retrieved_at: isoDate(item.last_seen_at) ?? isoDate(latestObservation?.captured_at),
        verified_at: null,
        content_hash: null,
      },
      measurement: {
        state: observedVelocity !== null && observationCount >= 2 ? 'observed' : 'single_snapshot',
        observation_count: observationCount,
        observation_window_hours: nullableNumber(performance?.observation_window_hours),
        comparison_method: nullableText(performance?.comparison_metric)
          ? 'within_platform_content_type_and_age_bucket'
          : null,
      },
      kind: 'library_item',
      platform,
      platform_post_id: platformPostId,
      canonical_url: safePublicUrl(item.canonical_url),
      account_handle: sanitizePublicText(item.account_handle, 120),
      source_expression: sanitizePublicText(item.caption),
      hashtags: textArray(item.hashtags).map((tag) => sanitizePublicText(tag, 80)).filter(Boolean),
      posted_at: isoDate(item.posted_at),
      last_observed_at: isoDate(item.last_seen_at) ?? isoDate(latestObservation?.captured_at),
      signal: performanceSignal(performance?.signal),
      age_bucket: nullableText(performance?.age_bucket),
      comparison_percentile: nullableNumber(performance?.comparison_percentile),
      comparison_group_size: nullableNumber(performance?.comparison_group_size),
      metrics: {
        views: nullableNumber(performance?.latest_views) ?? nullableNumber(latestObservation?.views),
        likes: nullableNumber(latestObservation?.likes),
        comments: nullableNumber(latestObservation?.comments),
        shares: nullableNumber(latestObservation?.shares),
        saves: nullableNumber(latestObservation?.saves),
        engagement_rate: nullableNumber(performance?.latest_engagement_rate),
        observed_view_velocity_per_hour: observedVelocity,
      },
      analysis: null,
      evidence_limitations: uniqueStrings([
        ...textArray(performance?.evidence_limitations),
        'Source captions describe creator expression and are not independently verified factual claims.',
      ]),
      search_text: '',
      content_hash: '',
    });
    documents.set(documentKey(platform, platformPostId), document);
  }

  for (const input of dashboardRecords) {
    const item = optionalRecord(input);
    if (!item) {
      skip('dashboard', 'invalid_row_shape');
      continue;
    }
    const platform = socialPlatform(item.platform);
    const platformPostId = text(item.platform_post_id);
    if (!platform) {
      skip('dashboard', 'invalid_or_missing_platform');
      continue;
    }
    if (!platformPostId) {
      skip('dashboard', 'missing_platform_post_id');
      continue;
    }
    const key = documentKey(platform, platformPostId);
    const existing = documents.get(key);
    const socialExisting = existing?.evidence_type === 'social_post' ? existing : null;
    if (!socialExisting) {
      skip('dashboard', 'analysis_without_library_post');
      continue;
    }
    const strategy = optionalRecord(optionalRecord(item.strategy)?.data);
    const analysis = analysisFromRecord(strategy, item);
    const metrics = optionalRecord(item.metrics);
    const cohort = optionalRecord(item.cohort);
    const quality = optionalRecord(item.quality);
    const qualityPassed = quality?.passed === true;
    const dashboardLimitations = uniqueStrings([
      ...analysis.evidence_limitations,
      ...(quality?.passed === false ? ['Provider quality checks did not pass for this analysis.'] : []),
      'Observed creative mechanics are research evidence, not reusable creator wording, footage, or identity.',
    ]);

    const merged = finalizeDocument({
      document_id: socialExisting.document_id,
      item_id: socialExisting.item_id,
      evidence_type: 'social_post',
      visibility: quality?.passed === false ? 'operator_provisional' : 'public_reviewed',
      review_method: qualityPassed ? 'provider_quality_gate' : 'deterministic_contract',
      content_type: socialExisting.content_type,
      topic_tags: uniqueStrings([
        ...(socialExisting?.topic_tags ?? []),
        nullableText(item.chosen_pillar) ?? '',
        nullableText(item.source_group) ?? '',
      ]),
      audience_states: uniqueStrings([
        ...(socialExisting?.audience_states ?? []),
        analysis.audience_problem,
      ]),
      confidence: qualityPassed ? 'provider_quality_passed' : socialExisting?.confidence ?? 'unknown',
      confidence_score: qualityPassed ? 0.9 : socialExisting?.confidence_score ?? 0.4,
      provenance: {
        source_kind: 'public_social',
        source_ids: uniqueStrings([
          ...(socialExisting?.provenance.source_ids ?? []),
          text(item.candidate_id),
          text(item.provider_asset_id),
        ]),
        publisher: null,
        authority: 'public_social_snapshot',
        jurisdiction: null,
        source_count: Math.max(1, (socialExisting?.provenance.source_count ?? 0) + 1),
        independent_source_count: Math.max(1, socialExisting?.provenance.independent_source_count ?? 1),
      },
      freshness: socialExisting?.freshness ?? {
        status: 'not_applicable',
        retrieved_at: isoDate(item.metric_snapshot_at),
        verified_at: null,
        content_hash: null,
      },
      measurement: {
        state: socialExisting?.measurement.state ?? 'single_snapshot',
        observation_count: socialExisting?.measurement.observation_count ?? 1,
        observation_window_hours: socialExisting?.measurement.observation_window_hours ?? null,
        comparison_method: 'within_platform_and_age_bucket_percentile',
      },
      kind: 'analyzed_post',
      platform,
      platform_post_id: platformPostId,
      canonical_url: socialExisting?.canonical_url || safePublicUrl(item.canonical_url),
      account_handle: socialExisting?.account_handle || sanitizePublicText(item.account_handle, 120),
      source_expression: socialExisting?.source_expression || analysis.opening_text,
      hashtags: socialExisting?.hashtags ?? [],
      posted_at: socialExisting?.posted_at ?? isoDate(item.posted_at),
      last_observed_at: latestNullableIso(
        socialExisting?.last_observed_at ?? null,
        isoDate(item.metric_snapshot_at),
      ),
      signal: socialExisting?.signal ?? 'analyzed',
      age_bucket: socialExisting?.age_bucket ?? null,
      comparison_percentile: socialExisting?.comparison_percentile ?? nullableNumber(cohort?.success_percentile),
      comparison_group_size: socialExisting?.comparison_group_size ?? null,
      metrics: mergeMetrics(
        socialExisting?.metrics,
        metrics,
        socialExisting?.last_observed_at ?? null,
        isoDate(item.metric_snapshot_at),
      ),
      analysis,
      evidence_limitations: uniqueStrings([
        ...(socialExisting?.evidence_limitations ?? []),
        ...dashboardLimitations,
      ]),
      search_text: '',
      content_hash: '',
    });
    documents.set(key, merged);
  }

  const audienceDocuments = buildAudienceDocuments(options.audienceInputs ?? [], skip);
  for (const document of audienceDocuments) documents.set(document.document_id, document);
  const officialDocuments = buildOfficialDocuments(options.officialInput, skip);
  for (const document of officialDocuments) documents.set(document.document_id, document);
  const ownedDocuments = buildOwnedDocuments(options.ownedInput, skip);
  for (const document of ownedDocuments) documents.set(document.document_id, document);

  return assembleCorpus({
    documents: [...documents.values()],
    visibility: 'operator_provisional',
    generatedAt: latestIso(
      nullableText(library.generated_at),
      nullableText(dashboard.generated_at),
      ...officialDocuments.map((document) => document.freshness.retrieved_at),
    ),
    sourceManifest: {
      library_generated_at: isoDate(library.generated_at),
      dashboard_generated_at: isoDate(dashboard.generated_at),
      library_items: items.length,
      dashboard_records: dashboardRecords.length,
      audience_signals: audienceDocuments.reduce((sum, item) => sum + item.provenance.source_count, 0),
      audience_documents: audienceDocuments.length,
      official_resources: officialDocuments.length,
      owned_connection_state: ownedConnectionState(options.ownedInput),
      skipped_rows: [...skippedByReason.values()].reduce((sum, count) => sum + count, 0),
      skipped_by_reason: Object.fromEntries([...skippedByReason.entries()].sort(([left], [right]) => (
        left.localeCompare(right)
      ))),
    },
  });
}

export function createCorpusView(corpus: AgentCorpus, visibility: EvidenceVisibility): AgentCorpus {
  const documents = visibility === 'public_reviewed'
    ? corpus.documents.filter((document) => document.visibility === 'public_reviewed')
    : corpus.documents;
  return assembleCorpus({
    documents,
    visibility,
    generatedAt: corpus.generated_at,
    sourceManifest: {
      library_generated_at: corpus.source_manifest.library_generated_at,
      dashboard_generated_at: corpus.source_manifest.dashboard_generated_at,
      library_items: corpus.source_manifest.library_items,
      dashboard_records: corpus.source_manifest.dashboard_records,
      audience_signals: corpus.source_manifest.audience_signals,
      audience_documents: corpus.source_manifest.audience_documents,
      official_resources: corpus.source_manifest.official_resources,
      owned_connection_state: corpus.source_manifest.owned_connection_state,
      skipped_rows: corpus.source_manifest.skipped_rows,
      skipped_by_reason: corpus.source_manifest.skipped_by_reason,
    },
  });
}

function assembleCorpus(input: {
  documents: EvidenceDocument[];
  visibility: EvidenceVisibility;
  generatedAt: string;
  sourceManifest: Pick<
    AgentCorpus['source_manifest'],
    | 'library_generated_at'
    | 'dashboard_generated_at'
    | 'library_items'
    | 'dashboard_records'
    | 'audience_signals'
    | 'audience_documents'
    | 'official_resources'
    | 'owned_connection_state'
    | 'skipped_rows'
    | 'skipped_by_reason'
  >;
}): AgentCorpus {
  const sorted = [...input.documents].sort((left, right) => left.document_id.localeCompare(right.document_id));
  const typeCounts = counts(sorted.map((item) => item.evidence_type));
  const indexVersion = stableHash(sorted.map((item) => [item.document_id, item.content_hash])).slice(0, 20);
  return {
    schema_version: 'viralbench_evidence_corpus_v2',
    generated_at: input.generatedAt,
    index_version: indexVersion,
    visibility: input.visibility,
    source_manifest: {
      ...input.sourceManifest,
      deduplicated_documents: sorted.length,
      public_reviewed_documents: sorted.filter((item) => item.visibility === 'public_reviewed').length,
      operator_provisional_documents: sorted.filter((item) => item.visibility === 'operator_provisional').length,
      by_evidence_type: typeCounts,
      redactions: [
        'email addresses',
        'phone numbers',
        'non-canonical URLs inside source text',
        'claims explicitly marked unsupported by the analysis provider',
        'comment identities and private account data are not indexed',
      ],
    },
    documents: sorted,
  };
}

function buildAudienceDocuments(
  inputs: unknown[],
  skip: (source: string, reason: string) => void,
): EvidenceDocument[] {
  const grouped = new Map<string, UnknownRecord[]>();
  for (const input of inputs) {
    const report = optionalRecord(input);
    if (!report) {
      skip('audience', 'invalid_report');
      continue;
    }
    for (const raw of array(report.signals)) {
      const signal = optionalRecord(raw);
      if (!signal) {
        skip('audience', 'invalid_signal_shape');
        continue;
      }
      if (signal.identity_redacted !== true) {
        skip('audience', 'identity_not_redacted');
        continue;
      }
      const theme = text(signal.theme);
      if (!theme) {
        skip('audience', 'missing_theme');
        continue;
      }
      const rows = grouped.get(theme) ?? [];
      rows.push(signal);
      grouped.set(theme, rows);
    }
  }
  return [...grouped.entries()].map(([theme, rows]) => {
    const deduplicatedRows = [...new Map(rows.map((row) => [
      text(row.signal_id) || stableHash([
        safePublicUrl(row.source_url),
        sanitizePublicText(row.paraphrased_need, 500),
      ]),
      row,
    ])).values()];
    const urls = uniqueStrings(deduplicatedRows.map((row) => safePublicUrl(row.source_url)).filter(Boolean));
    const communities = uniqueStrings(deduplicatedRows.map((row) => text(row.community)).filter(Boolean));
    const needs = uniqueStrings(deduplicatedRows.map((row) => sanitizePublicText(row.paraphrased_need, 500)).filter(Boolean));
    const audienceStates = uniqueStrings(deduplicatedRows.map((row) => text(row.audience_segment)).filter(Boolean));
    const confidence = average(deduplicatedRows.map((row) => nullableNumber(row.confidence)).filter((value): value is number => value !== null));
    return finalizeDocument({
      document_id: `evidence:audience:${stableHash(theme).slice(0, 20)}`,
      item_id: `audience-theme:${theme}`,
      evidence_type: 'audience_theme',
      visibility: deduplicatedRows.length >= 5 ? 'public_reviewed' : 'operator_provisional',
      review_method: 'deterministic_contract',
      content_type: 'audience_aggregate',
      topic_tags: [theme],
      audience_states: audienceStates,
      confidence: confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
      confidence_score: confidence,
      provenance: {
        source_kind: 'public_audience',
        source_ids: uniqueStrings(deduplicatedRows.map((row) => text(row.signal_id))),
        publisher: communities.join(', ') || null,
        authority: 'identity_safe_public_signal',
        jurisdiction: null,
        source_count: deduplicatedRows.length,
        independent_source_count: urls.length,
      },
      freshness: {
        status: 'current',
        retrieved_at: latestNullableIso(...deduplicatedRows.map((row) => isoDate(row.published_at))) ?? null,
        verified_at: null,
        content_hash: null,
      },
      measurement: {
        state: 'not_applicable',
        observation_count: deduplicatedRows.length,
        observation_window_hours: null,
        comparison_method: 'identity_safe_theme_aggregation',
      },
      kind: 'aggregated_signal',
      platform: null,
      platform_post_id: '',
      canonical_url: urls[0] ?? '',
      account_handle: '',
      source_expression: needs.slice(0, 8).join(' '),
      hashtags: [],
      posted_at: null,
      last_observed_at: latestNullableIso(...deduplicatedRows.map((row) => isoDate(row.published_at))),
      signal: 'analyzed',
      age_bucket: null,
      comparison_percentile: null,
      comparison_group_size: deduplicatedRows.length,
      metrics: { ...EMPTY_METRICS },
      analysis: null,
      evidence_limitations: uniqueStrings([
        'Audience signals are identity-safe paraphrases, not survey prevalence estimates.',
        `This theme contains ${deduplicatedRows.length} observations from ${urls.length} independent public source pages.`,
        ...(deduplicatedRows.length < 5 ? ['The privacy minimum of five observations is not met; this theme is operator-only.'] : []),
      ]),
      search_text: '',
      content_hash: '',
    });
  });
}

function buildOfficialDocuments(
  input: unknown,
  skip: (source: string, reason: string) => void,
): OfficialEvidenceDocument[] {
  const root = optionalRecord(input);
  if (!root) return [];
  return array(root.resources).flatMap((raw): OfficialEvidenceDocument[] => {
    const resource = optionalRecord(raw);
    if (!resource) {
      skip('official', 'invalid_resource_shape');
      return [];
    }
    const id = text(resource.resource_id);
    const url = safePublicUrl(resource.url);
    if (!id || !url) {
      skip('official', 'missing_id_or_https_url');
      return [];
    }
    const status = ['current', 'stale', 'failed'].includes(text(resource.status))
      ? text(resource.status) as 'current' | 'stale' | 'failed'
      : 'stale';
    const chunks = textArray(resource.chunks).map((value) => sanitizePublicText(value, 1_600)).filter(Boolean);
    const summary = sanitizePublicText(resource.summary, 1_500)
      || sanitizePublicText(resource.use_for, 1_500);
    return [finalizeDocument({
      document_id: `evidence:official:${id}`,
      item_id: `official:${id}`,
      evidence_type: 'official_source',
      visibility: status === 'current' && (summary || chunks.length) ? 'public_reviewed' : 'operator_provisional',
      review_method: 'deterministic_contract',
      content_type: 'official_guidance',
      topic_tags: uniqueStrings(textArray(resource.semantic_topics)),
      audience_states: uniqueStrings(textArray(resource.audience_states)),
      confidence: status === 'current' ? 'authoritative_current' : `authoritative_${status}`,
      confidence_score: status === 'current' ? 0.95 : status === 'stale' ? 0.5 : 0.1,
      provenance: {
        source_kind: 'official_primary',
        source_ids: [id],
        publisher: sanitizePublicText(resource.publisher, 160) || null,
        authority: sanitizePublicText(resource.authority, 100) || null,
        jurisdiction: sanitizePublicText(resource.jurisdiction, 80) || null,
        source_count: 1,
        independent_source_count: 1,
      },
      freshness: {
        status,
        retrieved_at: isoDate(resource.retrieved_at),
        verified_at: isoDate(resource.verified_at),
        content_hash: nullableText(resource.page_content_hash),
      },
      measurement: {
        state: 'not_applicable',
        observation_count: status === 'current' ? 1 : 0,
        observation_window_hours: null,
        comparison_method: null,
      },
      kind: 'official_resource',
      platform: null,
      platform_post_id: '',
      canonical_url: url,
      account_handle: sanitizePublicText(resource.publisher, 160),
      source_expression: [sanitizePublicText(resource.page_title, 300), summary, ...chunks].filter(Boolean).join(' '),
      hashtags: [],
      posted_at: null,
      last_observed_at: isoDate(resource.retrieved_at) ?? isoDate(resource.verified_at),
      signal: 'analyzed',
      age_bucket: null,
      comparison_percentile: null,
      comparison_group_size: null,
      metrics: { ...EMPTY_METRICS },
      analysis: null,
      evidence_limitations: uniqueStrings([
        sanitizePublicText(resource.evidence_boundary, 500),
        ...(status !== 'current' ? [`Official source status is ${status}; do not use it for public guidance.`] : []),
      ]),
      search_text: '',
      content_hash: '',
    })];
  });
}

function buildOwnedDocuments(
  input: unknown,
  skip: (source: string, reason: string) => void,
): EvidenceDocument[] {
  const root = optionalRecord(input);
  if (!root) return [];
  const connectionState = ownedConnectionState(root);
  const aggregates = array(root.aggregates);
  if (connectionState === 'not_connected' || !aggregates.length) {
    return [finalizeDocument({
      document_id: 'evidence:owned:not-connected',
      item_id: 'owned:not-connected',
      evidence_type: 'owned_aggregate',
      visibility: 'operator_provisional',
      review_method: 'deterministic_contract',
      content_type: 'owned_metric_aggregate',
      topic_tags: ['owned_outcomes'],
      audience_states: [],
      confidence: 'not_connected',
      confidence_score: 0,
      provenance: {
        source_kind: 'owned_aggregate',
        source_ids: [],
        publisher: 'Internships.com',
        authority: 'owned_measurement',
        jurisdiction: null,
        source_count: 0,
        independent_source_count: 0,
      },
      freshness: {
        status: 'failed',
        retrieved_at: isoDate(root.generated_at),
        verified_at: null,
        content_hash: null,
      },
      measurement: {
        state: 'not_connected',
        observation_count: 0,
        observation_window_hours: null,
        comparison_method: null,
      },
      kind: 'owned_data',
      platform: null,
      platform_post_id: '',
      canonical_url: '',
      account_handle: '',
      source_expression: 'Owned marketing outcomes are not connected.',
      hashtags: [],
      posted_at: null,
      last_observed_at: null,
      signal: 'insufficient_data',
      age_bucket: null,
      comparison_percentile: null,
      comparison_group_size: null,
      metrics: { ...EMPTY_METRICS },
      analysis: null,
      evidence_limitations: ['No privacy-safe owned aggregate export is connected; absence must not be interpreted as zero performance or demand.'],
      search_text: '',
      content_hash: '',
    })];
  }
  return aggregates.flatMap((raw, index): EvidenceDocument[] => {
    const aggregate = optionalRecord(raw);
    if (!aggregate) {
      skip('owned', 'invalid_aggregate_shape');
      return [];
    }
    const count = nullableNumber(aggregate.count);
    const minimum = nullableNumber(aggregate.minimum_bucket_count) ?? 5;
    if (count === null || (count > 0 && count < minimum)) {
      skip('owned', 'privacy_bucket_too_small');
      return [];
    }
    const id = text(aggregate.aggregate_id) || stableHash(aggregate).slice(0, 20);
    return [finalizeDocument({
      document_id: `evidence:owned:${id}`,
      item_id: `owned:${id}`,
      evidence_type: 'owned_aggregate',
      visibility: 'public_reviewed',
      review_method: 'deterministic_contract',
      content_type: 'owned_metric_aggregate',
      topic_tags: uniqueStrings([text(aggregate.event_name), text(aggregate.audience_segment)]),
      audience_states: uniqueStrings([text(aggregate.audience_segment)]),
      confidence: 'privacy_safe_aggregate',
      confidence_score: 0.9,
      provenance: {
        source_kind: 'owned_aggregate',
        source_ids: [id],
        publisher: 'Internships.com',
        authority: 'owned_measurement',
        jurisdiction: null,
        source_count: 1,
        independent_source_count: 1,
      },
      freshness: {
        status: 'current',
        retrieved_at: isoDate(root.generated_at),
        verified_at: null,
        content_hash: stableHash(aggregate),
      },
      measurement: {
        state: 'observed',
        observation_count: 1,
        observation_window_hours: null,
        comparison_method: 'privacy_safe_aggregate',
      },
      kind: 'owned_data',
      platform: null,
      platform_post_id: '',
      canonical_url: '',
      account_handle: '',
      source_expression: sanitizePublicText(aggregate.summary, 1_500)
        || `${sanitizePublicText(aggregate.event_name, 100)} count ${count}`,
      hashtags: [],
      posted_at: isoDate(aggregate.bucket_start),
      last_observed_at: isoDate(aggregate.bucket_end),
      signal: 'analyzed',
      age_bucket: null,
      comparison_percentile: null,
      comparison_group_size: null,
      metrics: { ...EMPTY_METRICS },
      analysis: null,
      evidence_limitations: ['Owned evidence is aggregated and cannot describe individual users or application histories.'],
      search_text: '',
      content_hash: '',
    })];
  });
}

function analysisFromRecord(strategy: UnknownRecord | null, item: UnknownRecord): AgentAnalysis {
  const opening = optionalRecord(strategy?.opening);
  const arc = optionalRecord(strategy?.content_arc);
  const cta = optionalRecord(strategy?.cta);
  const structure = optionalRecord(strategy?.transferable_structure);
  const claims = array(strategy?.claims)
    .map((value) => optionalRecord(value))
    .filter((value): value is UnknownRecord => Boolean(value))
    .filter((value) => ['visible', 'spoken'].includes(text(value.evidence_status)))
    .map((value) => sanitizePublicText(value.observed_claim, 400))
    .filter(Boolean);
  return {
    opening_text: sanitizePublicText(opening?.observed_words, 800),
    hook_pattern: sanitizePublicText(structure?.hook_pattern, 500),
    beat_pattern: sanitizePublicText(structure?.beat_pattern, 500),
    payoff_pattern: sanitizePublicText(structure?.payoff_pattern, 500),
    audience_problem: sanitizePublicText(arc?.audience_problem, 500),
    cta: sanitizePublicText(cta?.requested_action, 400),
    claims,
    evidence_limitations: uniqueStrings(textArray(strategy?.evidence_limitations)),
    fragments: analysisFragments(item),
  };
}

function analysisFragments(item: UnknownRecord): AgentAnalysis['fragments'] {
  const segments = optionalRecord(optionalRecord(item.segmentation)?.segments);
  if (!segments) return [];
  return ['visual_shots', 'audio_beats', 'editing_beats'].flatMap((fragmentType) => (
    array(segments[fragmentType]).slice(0, 6).flatMap((raw): NonNullable<AgentAnalysis['fragments']> => {
      const segment = optionalRecord(raw);
      const metadata = optionalRecord(segment?.metadata);
      if (!segment || !metadata) return [];
      const summary = sanitizePublicText(Object.values(metadata).filter((value) => typeof value === 'string').join(' '), 600);
      return summary ? [{
        fragment_type: fragmentType,
        start_sec: nullableNumber(segment.start_time),
        end_sec: nullableNumber(segment.end_time),
        summary,
      }] : [];
    })
  ));
}

function finalizeDocument<T extends EvidenceDocument>(input: T): T {
  const searchText = [
    input.evidence_type.replaceAll('_', ' '),
    input.content_type.replaceAll('_', ' '),
    input.account_handle,
    input.source_expression,
    input.topic_tags.join(' '),
    input.audience_states.join(' '),
    input.hashtags.join(' '),
    input.analysis?.opening_text,
    input.analysis?.hook_pattern,
    input.analysis?.beat_pattern,
    input.analysis?.payoff_pattern,
    input.analysis?.audience_problem,
    input.analysis?.cta,
    ...(input.analysis?.fragments?.map((fragment) => fragment.summary) ?? []),
  ].filter(Boolean).join(' ');
  const withoutDerived = {
    ...input,
    search_text: sanitizePublicText(searchText, 8_000),
    content_hash: '',
  };
  return {
    ...withoutDerived,
    content_hash: stableHash(withoutDerived),
  };
}

function mergeMetrics(
  existing: AgentMetrics | undefined,
  next: UnknownRecord | null,
  existingObservedAt: string | null,
  nextObservedAt: string | null,
): AgentMetrics {
  const useNext = next !== null && (
    !existing
    || timestamp(nextObservedAt) > timestamp(existingObservedAt)
  );
  if (useNext) {
    return {
      views: nullableNumber(next.views),
      likes: nullableNumber(next.likes),
      comments: nullableNumber(next.comments),
      shares: nullableNumber(next.shares),
      saves: nullableNumber(next.saves),
      engagement_rate: nullableNumber(next.engagement_rate),
      observed_view_velocity_per_hour: nullableNumber(next.observed_view_velocity_per_hour),
    };
  }
  return {
    views: existing?.views ?? nullableNumber(next?.views),
    likes: existing?.likes ?? nullableNumber(next?.likes),
    comments: existing?.comments ?? nullableNumber(next?.comments),
    shares: existing?.shares ?? nullableNumber(next?.shares),
    saves: existing?.saves ?? nullableNumber(next?.saves),
    engagement_rate: existing?.engagement_rate ?? null,
    observed_view_velocity_per_hour: existing?.observed_view_velocity_per_hour ?? null,
  };
}

function ownedConnectionState(value: unknown): 'not_connected' | 'partial' | 'connected' {
  const root = optionalRecord(value);
  const state = text(root?.connection_state);
  return state === 'partial' || state === 'connected' ? state : 'not_connected';
}

function contentType(value: unknown, platform: SocialPlatform): EvidenceContentType {
  if (typeof value === 'string' && (CONTENT_TYPES as readonly string[]).includes(value)) {
    return value as EvidenceContentType;
  }
  return platform === 'instagram' ? 'short_video' : 'short_video';
}

function confidenceScore(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return clamp(value);
  return { high: 0.9, medium: 0.65, low: 0.35 }[text(value).toLowerCase()] ?? 0.4;
}

function average(values: number[]): number {
  return values.length ? clamp(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 10_000) / 10_000));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as UnknownRecord).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function optionalRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function socialPlatform(value: unknown): SocialPlatform | null {
  return typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value)
    ? value as SocialPlatform
    : null;
}

function performanceSignal(value: unknown): PerformanceSignal {
  return typeof value === 'string' && (PERFORMANCE_SIGNALS as readonly string[]).includes(value)
    ? value as PerformanceSignal
    : 'insufficient_data';
}

function safePublicUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestIso(...values: Array<string | null>): string {
  const timestamps = values
    .map((value) => value ? new Date(value).getTime() : Number.NaN)
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : new Date(0).toISOString();
}

function latestNullableIso(...values: Array<string | null>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  return valid.length ? latestIso(...valid) : null;
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function documentKey(platform: SocialPlatform, platformPostId: string): string {
  return `${platform}:${platformPostId}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizePublicText(value, 500)).filter(Boolean))];
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}
