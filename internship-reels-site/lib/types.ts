export const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'youtube_shorts'] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];

export const PERFORMANCE_SIGNALS = [
  'baseline',
  'breakout_candidate',
  'evergreen_winner',
  'high_performer',
  'insufficient_data',
  'promising',
  'analyzed',
] as const;
export type PerformanceSignal = typeof PERFORMANCE_SIGNALS[number];

export interface AgentMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagement_rate: number | null;
  observed_view_velocity_per_hour: number | null;
}

export interface AgentAnalysis {
  opening_text: string;
  hook_pattern: string;
  beat_pattern: string;
  payoff_pattern: string;
  audience_problem: string;
  cta: string;
  claims: string[];
  evidence_limitations: string[];
}

export interface AgentDocument {
  document_id: string;
  item_id: string;
  kind: 'library_item' | 'analyzed_post';
  platform: SocialPlatform;
  platform_post_id: string;
  canonical_url: string;
  account_handle: string;
  source_expression: string;
  hashtags: string[];
  posted_at: string | null;
  last_observed_at: string | null;
  signal: PerformanceSignal;
  age_bucket: string | null;
  comparison_percentile: number | null;
  comparison_group_size: number | null;
  confidence: string;
  metrics: AgentMetrics;
  analysis: AgentAnalysis | null;
  evidence_limitations: string[];
  search_text: string;
  content_hash: string;
}

export interface AgentCorpus {
  schema_version: 'viralbench_agent_corpus_v1';
  generated_at: string;
  index_version: string;
  source_manifest: {
    library_generated_at: string | null;
    dashboard_generated_at: string | null;
    library_items: number;
    dashboard_records: number;
    deduplicated_documents: number;
    skipped_rows: number;
    skipped_by_reason: Record<string, number>;
    redactions: string[];
  };
  documents: AgentDocument[];
}

export interface AgentFilters {
  platforms?: SocialPlatform[];
  signals?: PerformanceSignal[];
  date_from?: string;
  date_to?: string;
}

export interface VectorManifestEntry {
  document_id: string;
  content_hash: string;
  offset: number;
}

export interface VectorManifest {
  schema_version: 'viralbench_agent_vectors_v1';
  model: 'gemini-embedding-2';
  dimension: 768;
  index_version: string;
  generated_at: string;
  count: number;
  entries: VectorManifestEntry[];
}

export interface LoadedVectorIndex {
  manifest: VectorManifest;
  vectors: Map<string, Float32Array>;
}

export interface AgentEvidence {
  evidence_id: string;
  item_id: string;
  title: string;
  snippet: string;
  source_url: string;
  platform: SocialPlatform;
  account_handle: string;
  posted_at: string | null;
  observed_at: string | null;
  signal: PerformanceSignal;
  age_bucket: string | null;
  comparison_percentile: number | null;
  metrics: AgentMetrics;
  evidence_limitations: string[];
  retrieval_relevance: number;
  rank_sources: Array<'lexical' | 'vector' | 'cohort'>;
}

export interface RetrievalResult {
  evidence: AgentEvidence[];
  query_mode: 'relevance' | 'cohort_performance';
  vector_used: boolean;
}

export interface ResearchFinding {
  claim: string;
  evidence_ids: string[];
}

export interface ResearchAnswer {
  mode: 'generated' | 'cached' | 'retrieval_only';
  answer: string;
  findings: ResearchFinding[];
  evidence: AgentEvidence[];
  limitations: string[];
  followups: string[];
  model: string | null;
  index_version: string;
}

export interface MarketingConcept {
  title: string;
  hypothesis: string;
  hook: string;
  format: string;
  script_beats: string[];
  cta: string;
  evidence_ids: string[];
}

export interface MarketingBrief {
  mode: 'generated' | 'retrieval_only';
  summary: string;
  audience_tension: string;
  concepts: MarketingConcept[];
  experiment: {
    hypothesis: string;
    control: string;
    variants: string[];
    primary_metrics: string[];
    checkpoints: string[];
  };
  claim_risks: Array<{
    claim: string;
    risk: string;
    mitigation: string;
  }>;
  evidence: AgentEvidence[];
  limitations: string[];
  model: string;
  index_version: string;
  downloads: {
    markdown: string;
    json: Record<string, unknown>;
  };
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  reset_at: string;
}
