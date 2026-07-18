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

export const EVIDENCE_TYPES = [
  'social_post',
  'audience_theme',
  'official_source',
  'owned_aggregate',
] as const;
export type EvidenceType = typeof EVIDENCE_TYPES[number];

export const EVIDENCE_VISIBILITIES = ['public_reviewed', 'operator_provisional'] as const;
export type EvidenceVisibility = typeof EVIDENCE_VISIBILITIES[number];

export const REVIEW_METHODS = [
  'deterministic_contract',
  'provider_quality_gate',
  'human_override',
] as const;
export type ReviewMethod = typeof REVIEW_METHODS[number];

export const CONTENT_TYPES = [
  'short_video',
  'feed_video',
  'carousel_post',
  'image_post',
  'audience_aggregate',
  'official_guidance',
  'owned_metric_aggregate',
] as const;
export type EvidenceContentType = typeof CONTENT_TYPES[number];

export const QUERY_INTENTS = [
  'audience_need',
  'creative_mechanics',
  'performance',
  'observed_velocity',
  'official_guidance',
  'owned_outcomes',
  'cross_source',
] as const;
export type QueryIntent = typeof QUERY_INTENTS[number];

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
  fragments?: Array<{
    fragment_type: string;
    start_sec: number | null;
    end_sec: number | null;
    summary: string;
  }>;
}

export interface EvidenceProvenance {
  source_kind: 'public_social' | 'public_audience' | 'official_primary' | 'owned_aggregate';
  source_ids: string[];
  publisher: string | null;
  authority: string | null;
  jurisdiction: string | null;
  source_count: number;
  independent_source_count: number;
}

export interface EvidenceFreshness {
  status: 'current' | 'stale' | 'failed' | 'not_applicable';
  retrieved_at: string | null;
  verified_at: string | null;
  content_hash: string | null;
}

export interface EvidenceMeasurement {
  state: 'observed' | 'single_snapshot' | 'not_applicable' | 'not_connected';
  observation_count: number;
  observation_window_hours: number | null;
  comparison_method: string | null;
}

interface EvidenceDocumentBase {
  document_id: string;
  item_id: string;
  evidence_type: EvidenceType;
  visibility: EvidenceVisibility;
  review_method: ReviewMethod;
  content_type: EvidenceContentType;
  topic_tags: string[];
  audience_states: string[];
  confidence: string;
  confidence_score: number;
  provenance: EvidenceProvenance;
  freshness: EvidenceFreshness;
  measurement: EvidenceMeasurement;
  kind: 'library_item' | 'analyzed_post' | 'aggregated_signal' | 'official_resource' | 'owned_data';
  platform: SocialPlatform | null;
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
  metrics: AgentMetrics;
  analysis: AgentAnalysis | null;
  evidence_limitations: string[];
  search_text: string;
  content_hash: string;
}

export interface SocialEvidenceDocument extends EvidenceDocumentBase {
  evidence_type: 'social_post';
  platform: SocialPlatform;
}

export interface AudienceEvidenceDocument extends EvidenceDocumentBase {
  evidence_type: 'audience_theme';
  platform: null;
}

export interface OfficialEvidenceDocument extends EvidenceDocumentBase {
  evidence_type: 'official_source';
  platform: null;
}

export interface OwnedEvidenceDocument extends EvidenceDocumentBase {
  evidence_type: 'owned_aggregate';
  platform: null;
}

export type EvidenceDocument =
  | SocialEvidenceDocument
  | AudienceEvidenceDocument
  | OfficialEvidenceDocument
  | OwnedEvidenceDocument;

// Kept as an additive compatibility alias for existing callers.
export type AgentDocument = EvidenceDocument;

export interface AgentCorpus {
  schema_version: 'viralbench_evidence_corpus_v2';
  generated_at: string;
  index_version: string;
  visibility: EvidenceVisibility;
  source_manifest: {
    library_generated_at: string | null;
    dashboard_generated_at: string | null;
    library_items: number;
    dashboard_records: number;
    audience_signals: number;
    audience_documents: number;
    official_resources: number;
    owned_connection_state: 'not_connected' | 'partial' | 'connected';
    deduplicated_documents: number;
    public_reviewed_documents: number;
    operator_provisional_documents: number;
    by_evidence_type: Record<string, number>;
    skipped_rows: number;
    skipped_by_reason: Record<string, number>;
    redactions: string[];
  };
  documents: EvidenceDocument[];
}

export interface AgentFilters {
  platforms?: SocialPlatform[];
  signals?: PerformanceSignal[];
  evidence_types?: EvidenceType[];
  content_types?: EvidenceContentType[];
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
  model: 'gemini-embedding-2' | 'viralbench-local-hash-v1';
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
  evidence_type: EvidenceType;
  visibility: EvidenceVisibility;
  review_method: ReviewMethod;
  content_type: EvidenceContentType;
  title: string;
  snippet: string;
  source_url: string;
  platform: SocialPlatform | null;
  account_handle: string;
  posted_at: string | null;
  observed_at: string | null;
  signal: PerformanceSignal;
  age_bucket: string | null;
  comparison_percentile: number | null;
  confidence: number;
  freshness_status: EvidenceFreshness['status'];
  measurement_state: EvidenceMeasurement['state'];
  source_count: number;
  independent_source_count: number;
  metrics: AgentMetrics;
  evidence_limitations: string[];
  retrieval_relevance: number;
  rank_sources: Array<'lexical' | 'vector' | 'cohort' | 'intent'>;
}

export interface RetrievalCoverage {
  considered: Record<EvidenceType, number>;
  returned: Record<EvidenceType, number>;
  public_reviewed: number;
  operator_provisional: number;
  current_sources: number;
  stale_sources: number;
  measurement_gaps: string[];
}

export interface RetrievalResult {
  evidence: AgentEvidence[];
  query_mode: 'relevance' | 'cohort_performance';
  query_intent: QueryIntent;
  vector_used: boolean;
  coverage: RetrievalCoverage;
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
  query_intent: QueryIntent;
  coverage: RetrievalCoverage;
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
  query_intent: QueryIntent;
  coverage: RetrievalCoverage;
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
