import type { VercelRequest, VercelResponse } from '@vercel/node';

import type {
  AgentCorpus,
  AgentEvidence,
  LoadedVectorIndex,
  SocialEvidenceDocument,
  SocialPlatform,
} from '../lib/types.js';

export function document(
  id: string,
  overrides: Partial<SocialEvidenceDocument> = {},
): SocialEvidenceDocument {
  const platform: SocialPlatform = overrides.platform ?? 'tiktok';
  return {
    document_id: `evidence:${platform}:${id}`,
    item_id: `${platform}:post:${id}`,
    evidence_type: 'social_post',
    visibility: 'public_reviewed',
    review_method: 'provider_quality_gate',
    content_type: 'short_video',
    topic_tags: ['resume_and_application'],
    audience_states: ['proof_gap'],
    kind: 'analyzed_post',
    platform,
    platform_post_id: id,
    canonical_url: `https://example.com/${id}`,
    account_handle: 'reviewed-source',
    source_expression: `Original source expression for ${id}`,
    hashtags: [],
    posted_at: '2026-07-01T00:00:00.000Z',
    last_observed_at: '2026-07-02T00:00:00.000Z',
    signal: 'promising',
    age_bucket: '7d',
    comparison_percentile: 0.5,
    comparison_group_size: 20,
    confidence: 'observed',
    confidence_score: 0.9,
    provenance: {
      source_kind: 'public_social',
      source_ids: [`source-${id}`],
      publisher: null,
      authority: 'public_social_snapshot',
      jurisdiction: null,
      source_count: 1,
      independent_source_count: 1,
    },
    freshness: {
      status: 'not_applicable',
      retrieved_at: '2026-07-02T00:00:00.000Z',
      verified_at: null,
      content_hash: null,
    },
    measurement: {
      state: 'observed',
      observation_count: 2,
      observation_window_hours: 24,
      comparison_method: 'within_platform_content_type_and_age_bucket',
    },
    metrics: {
      views: 1_000,
      likes: 100,
      comments: 10,
      shares: 5,
      saves: 4,
      engagement_rate: 0.1,
      observed_view_velocity_per_hour: 20,
    },
    analysis: {
      opening_text: `Opening mechanism for ${id}`,
      hook_pattern: `Hook pattern about ${id}`,
      beat_pattern: 'Name the tension, show a concrete example, then state the boundary.',
      payoff_pattern: 'A practical next step without an outcome promise.',
      audience_problem: 'Students need a more specific way to communicate relevant experience.',
      cta: 'Review the draft before sending.',
      claims: [],
      evidence_limitations: ['Observed public snapshot only.'],
    },
    evidence_limitations: ['Observed public snapshot only.'],
    search_text: `resume internship internships hook students coursework proof awareness ${id}`,
    content_hash: `hash-${id}`,
    ...overrides,
  };
}

export function corpus(documents: SocialEvidenceDocument[] = [document('alpha'), document('beta')]): AgentCorpus {
  return {
    schema_version: 'viralbench_evidence_corpus_v2',
    generated_at: '2026-07-17T00:00:00.000Z',
    index_version: 'test-index',
    visibility: 'public_reviewed',
    source_manifest: {
      library_generated_at: '2026-07-17T00:00:00.000Z',
      dashboard_generated_at: '2026-07-17T00:00:00.000Z',
      library_items: documents.length,
      dashboard_records: documents.length,
      audience_signals: 0,
      audience_documents: 0,
      official_resources: 0,
      owned_connection_state: 'not_connected',
      deduplicated_documents: documents.length,
      public_reviewed_documents: documents.length,
      operator_provisional_documents: 0,
      by_evidence_type: { social_post: documents.length },
      skipped_rows: 0,
      skipped_by_reason: {},
      redactions: [],
    },
    documents,
  };
}

export function completeVectorIndex(library: AgentCorpus): LoadedVectorIndex {
  return {
    manifest: {
      schema_version: 'viralbench_agent_vectors_v1',
      model: 'gemini-embedding-2',
      dimension: 768,
      index_version: library.index_version,
      generated_at: library.generated_at,
      count: library.documents.length,
      entries: library.documents.map((item, index) => ({
        document_id: item.document_id,
        content_hash: item.content_hash,
        offset: index * 768,
      })),
    },
    vectors: new Map(library.documents.map((item) => {
      const vector = new Float32Array(768);
      vector[0] = 1;
      return [item.document_id, vector];
    })),
  };
}

export function evidence(id = 'alpha'): AgentEvidence {
  const item = document(id);
  return {
    evidence_id: item.document_id,
    item_id: item.item_id,
    evidence_type: item.evidence_type,
    visibility: item.visibility,
    review_method: item.review_method,
    content_type: item.content_type,
    title: item.analysis!.hook_pattern,
    snippet: item.analysis!.beat_pattern,
    source_url: item.canonical_url,
    platform: item.platform,
    account_handle: item.account_handle,
    posted_at: item.posted_at,
    observed_at: item.last_observed_at,
    signal: item.signal,
    age_bucket: item.age_bucket,
    comparison_percentile: item.comparison_percentile,
    confidence: item.confidence_score,
    freshness_status: item.freshness.status,
    measurement_state: item.measurement.state,
    source_count: item.provenance.source_count,
    independent_source_count: item.provenance.independent_source_count,
    metrics: item.metrics,
    evidence_limitations: item.evidence_limitations,
    retrieval_relevance: 1,
    rank_sources: ['lexical'],
  };
}

export interface MockResponseState {
  statusCode: number;
  body: unknown;
  headers: Map<string, string | string[] | number>;
}

export function mockRequest(options: {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}): VercelRequest {
  return {
    method: options.method ?? 'POST',
    body: options.body,
    headers: options.headers ?? {},
    query: {},
    cookies: {},
  } as unknown as VercelRequest;
}

export function mockResponse(): { response: VercelResponse; state: MockResponseState } {
  const state: MockResponseState = {
    statusCode: 200,
    body: null,
    headers: new Map(),
  };
  const response = {
    setHeader(name: string, value: string | string[] | number) {
      state.headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(value: unknown) {
      state.body = value;
      return this;
    },
  } as unknown as VercelResponse;
  return { response, state };
}
