import type { VercelRequest, VercelResponse } from '@vercel/node';

import type {
  AgentCorpus,
  AgentDocument,
  AgentEvidence,
  SocialPlatform,
} from '../lib/types.js';

export function document(
  id: string,
  overrides: Partial<AgentDocument> = {},
): AgentDocument {
  const platform: SocialPlatform = overrides.platform ?? 'tiktok';
  return {
    document_id: `evidence:${platform}:${id}`,
    item_id: `${platform}:post:${id}`,
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

export function corpus(documents: AgentDocument[] = [document('alpha'), document('beta')]): AgentCorpus {
  return {
    schema_version: 'viralbench_agent_corpus_v1',
    generated_at: '2026-07-17T00:00:00.000Z',
    index_version: 'test-index',
    source_manifest: {
      library_generated_at: '2026-07-17T00:00:00.000Z',
      dashboard_generated_at: '2026-07-17T00:00:00.000Z',
      library_items: documents.length,
      dashboard_records: documents.length,
      deduplicated_documents: documents.length,
      skipped_rows: 0,
      skipped_by_reason: {},
      redactions: [],
    },
    documents,
  };
}

export function evidence(id = 'alpha'): AgentEvidence {
  const item = document(id);
  return {
    evidence_id: item.document_id,
    item_id: item.item_id,
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
