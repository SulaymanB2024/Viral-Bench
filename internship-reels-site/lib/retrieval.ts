import type {
  AgentCorpus,
  AgentEvidence,
  AgentFilters,
  EvidenceDocument,
  EvidenceType,
  LoadedVectorIndex,
  QueryIntent,
  RetrievalCoverage,
  RetrievalResult,
} from './types.js';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'how', 'i',
  'in', 'internship', 'internships', 'into', 'is', 'it', 'of', 'on', 'or', 'post',
  'posts', 'reviewed', 'that', 'the', 'these', 'this', 'to', 'turn', 'was', 'what',
  'when', 'where', 'which', 'who', 'why', 'with', 'work', 'working',
]);

const PERFORMANCE_INTENT = /\b(best|breakout|highest|perform(?:ance|ing)?|top|winner|winning)\b/i;
const VELOCITY_INTENT = /\b(velocity|growth rate|growing|views? per hour|momentum|trajectory)\b/i;
const OFFICIAL_INTENT = /\b(official|law|legal|rights?|flsa|unpaid|cpt|opt|stem opt|uscis|dso|ada|eeoc|dol|department of labor|job scam|fraud|eligibility|work authori[sz]ation)\b/i;
const OWNED_INTENT = /\b(our|owned|internships\.com).{0,30}\b(results?|outcomes?|conversion|applications?|campaign|experiment|posts?|performance|saves?|shares?|clicks?)\b|\b(conversion|application) rate\b/i;
const CREATIVE_INTENT = /\b(hook|carousel|image|creative|format|opening|beat|cta|slide|video structure|caption)\b/i;
const AUDIENCE_INTENT = /\b(audience|students? (?:need|want|worr(?:y|ied|ies)|fear|struggle)|pain point|concern|housing|pay|compensation|cost|stress|uncertain(?:ty)?|anxi(?:ety|ous)|confus(?:ed|ion)|overwhelm(?:ed|ing)?)\b/i;
const CROSS_SOURCE_INTENT = /\b(cross[- ]source|triangulat|combine.{0,20}(official|audience|social)|compare.{0,20}(sources?|evidence families))\b/i;

interface ScoredDocument {
  document: EvidenceDocument;
  lexical_score: number;
  matched_query_terms: number;
  vector_score: number | null;
  fused_score: number;
  rank_sources: Array<'lexical' | 'vector' | 'cohort' | 'intent'>;
}

export function tokenize(value: string): string[] {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function classifyQueryIntent(query: string): QueryIntent {
  if (OWNED_INTENT.test(query)) return 'owned_outcomes';
  if (OFFICIAL_INTENT.test(query)) return 'official_guidance';
  if (VELOCITY_INTENT.test(query)) return 'observed_velocity';
  if (CROSS_SOURCE_INTENT.test(query)) return 'cross_source';
  if (PERFORMANCE_INTENT.test(query)) return 'performance';
  if (CREATIVE_INTENT.test(query)) return 'creative_mechanics';
  return AUDIENCE_INTENT.test(query) ? 'audience_need' : 'cross_source';
}

export function retrieveEvidence(options: {
  corpus: AgentCorpus;
  query: string;
  filters?: AgentFilters;
  vectorIndex?: LoadedVectorIndex | null;
  queryVector?: number[] | null;
  limit?: number;
  intent?: QueryIntent;
}): RetrievalResult {
  const limit = Math.max(1, Math.min(options.limit ?? 16, 16));
  const intent = options.intent ?? classifyQueryIntent(options.query);
  const baseFiltered = options.corpus.documents.filter((document) => matchesFilters(document, options.filters));
  const filtered = baseFiltered.filter((document) => eligibleForIntent(document, intent, options.query));
  const lexicalScores = bm25Scores(filtered, options.query);
  const matchedQueryTerms = queryTermMatches(filtered, options.query);
  const vectorScores = vectorSimilarityScores(filtered, options.vectorIndex, options.queryVector);
  const lexicalRank = rankMap(lexicalScores);
  const vectorRank = rankMap(vectorScores);
  const performanceIntent = intent === 'performance';

  const scored: ScoredDocument[] = filtered.map((document) => {
    const lexical = lexicalScores.get(document.document_id) ?? 0;
    const vector = vectorScores.get(document.document_id) ?? null;
    const sources: ScoredDocument['rank_sources'] = [];
    let fused = 0;
    const lexicalPosition = lexicalRank.get(document.document_id);
    const vectorPosition = vectorRank.get(document.document_id);
    if (lexicalPosition !== undefined && lexical > 0) {
      sources.push('lexical');
      fused += 1 / (60 + lexicalPosition);
    }
    if (vectorPosition !== undefined && vector !== null) {
      sources.push('vector');
      const vectorWeight = options.vectorIndex?.manifest.model === 'viralbench-local-hash-v1' ? 0.5 : 1;
      fused += vectorWeight / (60 + vectorPosition);
    }
    const intentBoost = intentPriority(document, intent, options.query);
    if (intentBoost > 0) {
      sources.push('intent');
      fused += intentBoost;
    }
    if (performanceIntent && document.comparison_percentile !== null) {
      sources.push('cohort');
      fused += document.comparison_percentile / 200;
    }
    return {
      document,
      lexical_score: lexical,
      matched_query_terms: matchedQueryTerms.get(document.document_id) ?? 0,
      vector_score: vector,
      fused_score: fused,
      rank_sources: sources,
    };
  });

  const genericPerformance = performanceIntent && isGenericPerformanceQuery(options.query);
  const localHashIndex = options.vectorIndex?.manifest.model === 'viralbench-local-hash-v1';
  const minimumLocalMatches = new Set(normalizedMatchTokens(options.query)).size >= 3 ? 2 : 1;
  const relevant = scored.filter((item) => (
    genericPerformance
    || (
      item.lexical_score > 0
      && (!localHashIndex || item.matched_query_terms >= minimumLocalMatches)
    )
    || (!localHashIndex && item.vector_score !== null)
  ));
  const ranked = relevant.sort((left, right) => (
    right.fused_score - left.fused_score
    || right.lexical_score - left.lexical_score
    || (right.document.comparison_percentile ?? -1) - (left.document.comparison_percentile ?? -1)
    || left.document.document_id.localeCompare(right.document.document_id)
  ));
  const diversified = diversify(ranked, limit, intent);
  const evidence = diversified.map((item, index) => toEvidence(item, index));
  return {
    evidence,
    query_mode: performanceIntent ? 'cohort_performance' : 'relevance',
    query_intent: intent,
    vector_used: Boolean(
      options.queryVector
      && options.vectorIndex?.vectors.size
      && evidence.some((item) => item.rank_sources.includes('vector')),
    ),
    coverage: buildCoverage(baseFiltered, evidence, intent),
  };
}

function eligibleForIntent(document: EvidenceDocument, intent: QueryIntent, query: string): boolean {
  if (intent === 'official_guidance') return document.evidence_type === 'official_source';
  if (intent === 'owned_outcomes') return document.evidence_type === 'owned_aggregate';
  if (intent === 'observed_velocity') {
    return document.evidence_type === 'social_post'
      && document.measurement.state === 'observed'
      && document.metrics.observed_view_velocity_per_hour !== null;
  }
  if (intent === 'performance') {
    return document.evidence_type === 'social_post' && document.comparison_percentile !== null;
  }
  if (intent === 'creative_mechanics') {
    if (document.evidence_type !== 'social_post') return false;
    if (/\bcarousel|slides?\b/i.test(query)) return document.content_type === 'carousel_post';
    if (/\bimage|photo|static\b/i.test(query)) return document.content_type === 'image_post';
    if (/\bvideo\b/i.test(query)) return ['short_video', 'feed_video'].includes(document.content_type);
    return true;
  }
  if (intent === 'audience_need') {
    return document.evidence_type === 'audience_theme'
      || (
        document.evidence_type === 'social_post'
        && Boolean(document.analysis?.audience_problem)
        && (
          !/\binternships?\b/i.test(query)
          || /\binternships?\b/i.test(document.search_text)
        )
      );
  }
  return document.evidence_type !== 'owned_aggregate'
    || document.measurement.state !== 'not_connected';
}

function intentPriority(document: EvidenceDocument, intent: QueryIntent, query: string): number {
  if (intent === 'official_guidance' && document.evidence_type === 'official_source') return 0.03;
  if (intent === 'owned_outcomes' && document.evidence_type === 'owned_aggregate') return 0.03;
  if (intent === 'audience_need' && document.evidence_type === 'audience_theme') return 0.008;
  if (intent === 'observed_velocity' && document.metrics.observed_view_velocity_per_hour !== null) return 0.02;
  if (intent === 'performance' && document.comparison_percentile !== null) return 0.015;
  if (intent === 'creative_mechanics' && /\bcarousel|slides?\b/i.test(query) && document.content_type === 'carousel_post') {
    return 0.025;
  }
  if (intent === 'cross_source') return 0.002;
  return 0;
}

function diversify(items: ScoredDocument[], limit: number, intent: QueryIntent): ScoredDocument[] {
  const selected: ScoredDocument[] = [];
  const accountCounts = new Map<string, number>();
  const typeCounts = new Map<EvidenceType, number>();
  const pool = [...items];

  if (intent === 'cross_source') {
    for (const type of ['official_source', 'audience_theme', 'social_post'] as const) {
      const index = pool.findIndex((item) => item.document.evidence_type === type);
      if (index >= 0) {
        const [item] = pool.splice(index, 1);
        if (item) {
          selected.push(item);
          typeCounts.set(type, 1);
          noteAccount(item.document, accountCounts);
        }
      }
    }
  }

  for (const item of pool) {
    if (selected.length >= limit) break;
    const account = item.document.account_handle.toLowerCase();
    if (account && (accountCounts.get(account) ?? 0) >= 2) continue;
    if ((typeCounts.get(item.document.evidence_type) ?? 0) >= Math.max(4, Math.ceil(limit * 0.7))) continue;
    selected.push(item);
    typeCounts.set(item.document.evidence_type, (typeCounts.get(item.document.evidence_type) ?? 0) + 1);
    noteAccount(item.document, accountCounts);
  }
  return selected.slice(0, limit);
}

function noteAccount(document: EvidenceDocument, counts: Map<string, number>): void {
  const account = document.account_handle.toLowerCase();
  if (account) counts.set(account, (counts.get(account) ?? 0) + 1);
}

function bm25Scores(documents: EvidenceDocument[], query: string): Map<string, number> {
  const terms = tokenize(query);
  const result = new Map<string, number>();
  if (!terms.length) return result;
  const tokenized = documents.map((document) => ({
    id: document.document_id,
    tokens: tokenize(document.search_text),
  }));
  const averageLength = tokenized.reduce((sum, item) => sum + item.tokens.length, 0) / Math.max(1, tokenized.length);
  const documentFrequency = new Map<string, number>();
  for (const item of tokenized) {
    const present = new Set(item.tokens);
    for (const term of new Set(terms)) {
      if (present.has(term)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const k1 = 1.2;
  const b = 0.75;
  for (const item of tokenized) {
    const frequencies = new Map<string, number>();
    for (const token of item.tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const frequency = frequencies.get(term) ?? 0;
      if (!frequency) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + ((documents.length - df + 0.5) / (df + 0.5)));
      const denominator = frequency + k1 * (1 - b + b * (item.tokens.length / Math.max(1, averageLength)));
      score += idf * ((frequency * (k1 + 1)) / denominator);
    }
    if (score > 0) result.set(item.id, score);
  }
  return result;
}

function queryTermMatches(documents: EvidenceDocument[], query: string): Map<string, number> {
  const queryTerms = new Set(normalizedMatchTokens(query));
  return new Map(documents.map((document) => {
    const documentTerms = new Set(normalizedMatchTokens(document.search_text));
    const matches = [...queryTerms].filter((term) => documentTerms.has(term)).length;
    return [document.document_id, matches];
  }));
}

function normalizedMatchTokens(value: string): string[] {
  return tokenize(value).map((token) => (
    token.length > 4 && token.endsWith('s') && !token.endsWith('ss')
      ? token.slice(0, -1)
      : token
  ));
}

function vectorSimilarityScores(
  documents: EvidenceDocument[],
  index: LoadedVectorIndex | null | undefined,
  queryVector: number[] | null | undefined,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!index || !queryVector || queryVector.length !== index.manifest.dimension) return result;
  const minimumSimilarity = index.manifest.model === 'viralbench-local-hash-v1' ? 0 : 0.2;
  for (const document of documents) {
    const vector = index.vectors.get(document.document_id);
    if (!vector) continue;
    const similarity = cosineSimilarity(queryVector, vector);
    if (similarity > minimumSimilarity) result.set(document.document_id, similarity);
  }
  return result;
}

export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function rankMap(scores: Map<string, number>): Map<string, number> {
  return new Map(
    [...scores.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([id], index) => [id, index + 1]),
  );
}

function toEvidence(item: ScoredDocument, index: number): AgentEvidence {
  const document = item.document;
  const title = titleForDocument(document);
  const snippet = document.analysis
    ? [
        document.analysis.audience_problem,
        document.analysis.beat_pattern,
        document.analysis.payoff_pattern,
      ].filter(Boolean).join(' ')
    : document.source_expression;
  return {
    evidence_id: document.document_id,
    item_id: document.item_id,
    evidence_type: document.evidence_type,
    visibility: document.visibility,
    review_method: document.review_method,
    content_type: document.content_type,
    title: truncate(title, 180),
    snippet: truncate(snippet, 480),
    source_url: document.canonical_url,
    platform: document.platform,
    account_handle: document.account_handle,
    posted_at: document.posted_at,
    observed_at: document.last_observed_at,
    signal: document.signal,
    age_bucket: document.age_bucket,
    comparison_percentile: document.comparison_percentile,
    confidence: document.confidence_score,
    freshness_status: document.freshness.status,
    measurement_state: document.measurement.state,
    source_count: document.provenance.source_count,
    independent_source_count: document.provenance.independent_source_count,
    metrics: document.metrics,
    evidence_limitations: document.evidence_limitations,
    retrieval_relevance: Number((1 / (index + 1)).toFixed(6)),
    rank_sources: [...new Set(item.rank_sources)],
  };
}

function titleForDocument(document: EvidenceDocument): string {
  if (document.evidence_type === 'official_source') {
    return document.source_expression.split(/[.!?]/)[0] || 'Official guidance';
  }
  if (document.evidence_type === 'audience_theme') {
    return document.topic_tags[0]?.replaceAll('_', ' ') || 'Audience theme';
  }
  if (document.evidence_type === 'owned_aggregate') {
    return document.measurement.state === 'not_connected' ? 'Owned outcomes not connected' : 'Owned outcome aggregate';
  }
  return document.analysis?.hook_pattern
    || document.analysis?.opening_text
    || document.source_expression
    || `@${document.account_handle} on ${(document.platform ?? 'social').replace('_', ' ')}`;
}

function matchesFilters(document: EvidenceDocument, filters?: AgentFilters): boolean {
  if (!filters) return true;
  if (filters.platforms?.length && (!document.platform || !filters.platforms.includes(document.platform))) return false;
  if (filters.signals?.length && !filters.signals.includes(document.signal)) return false;
  if (filters.evidence_types?.length && !filters.evidence_types.includes(document.evidence_type)) return false;
  if (filters.content_types?.length && !filters.content_types.includes(document.content_type)) return false;
  if (filters.date_from && (!document.posted_at || document.posted_at < `${filters.date_from}T00:00:00.000Z`)) return false;
  if (filters.date_to && (!document.posted_at || document.posted_at > `${filters.date_to}T23:59:59.999Z`)) return false;
  return true;
}

function buildCoverage(
  consideredDocuments: EvidenceDocument[],
  evidence: AgentEvidence[],
  intent: QueryIntent,
): RetrievalCoverage {
  const considered = evidenceTypeCounts(consideredDocuments.map((document) => document.evidence_type));
  const returned = evidenceTypeCounts(evidence.map((item) => item.evidence_type));
  const gaps: string[] = [];
  if (intent === 'observed_velocity' && !evidence.length) {
    gaps.push('No matching records have a non-null velocity measured across distinct capture timestamps.');
  }
  if (intent === 'owned_outcomes' && !evidence.length) {
    gaps.push('Privacy-safe owned marketing aggregates are not connected.');
  }
  if (intent === 'official_guidance' && !evidence.length) {
    gaps.push('No current reviewed official source matched this question.');
  }
  if (intent === 'cross_source' && new Set(evidence.map((item) => item.evidence_type)).size < 2) {
    gaps.push('Cross-source synthesis requires at least two evidence families.');
  }
  return {
    considered,
    returned,
    public_reviewed: evidence.filter((item) => item.visibility === 'public_reviewed').length,
    operator_provisional: evidence.filter((item) => item.visibility === 'operator_provisional').length,
    current_sources: evidence.filter((item) => item.freshness_status === 'current').length,
    stale_sources: evidence.filter((item) => ['stale', 'failed'].includes(item.freshness_status)).length,
    measurement_gaps: gaps,
  };
}

function evidenceTypeCounts(types: EvidenceType[]): Record<EvidenceType, number> {
  const result: Record<EvidenceType, number> = {
    social_post: 0,
    audience_theme: 0,
    official_source: 0,
    owned_aggregate: 0,
  };
  for (const type of types) result[type] += 1;
  return result;
}

function isGenericPerformanceQuery(query: string): boolean {
  const meaningful = tokenize(query).filter((token) => ![
    'best', 'breakout', 'highest', 'performance', 'performing', 'top', 'winner', 'winning',
  ].includes(token));
  return meaningful.length === 0;
}

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}
