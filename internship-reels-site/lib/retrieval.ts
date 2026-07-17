import type {
  AgentCorpus,
  AgentDocument,
  AgentEvidence,
  AgentFilters,
  LoadedVectorIndex,
  RetrievalResult,
} from './types.js';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'these', 'this', 'to', 'was', 'what',
  'when', 'where', 'which', 'who', 'why', 'with', 'work', 'working',
]);

const PERFORMANCE_INTENT = /\b(best|breakout|highest|perform(?:ance|ing)?|top|velocity|winner|winning)\b/i;

interface ScoredDocument {
  document: AgentDocument;
  lexical_score: number;
  vector_score: number | null;
  fused_score: number;
  rank_sources: Array<'lexical' | 'vector' | 'cohort'>;
}

export function tokenize(value: string): string[] {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function retrieveEvidence(options: {
  corpus: AgentCorpus;
  query: string;
  filters?: AgentFilters;
  vectorIndex?: LoadedVectorIndex | null;
  queryVector?: number[] | null;
  limit?: number;
}): RetrievalResult {
  const limit = Math.max(1, Math.min(options.limit ?? 12, 12));
  const filtered = options.corpus.documents.filter((document) => matchesFilters(document, options.filters));
  const lexicalScores = bm25Scores(filtered, options.query);
  const vectorScores = vectorSimilarityScores(filtered, options.vectorIndex, options.queryVector);
  const lexicalRank = rankMap(lexicalScores);
  const vectorRank = rankMap(vectorScores);
  const performanceIntent = PERFORMANCE_INTENT.test(options.query);

  const scored: ScoredDocument[] = filtered.map((document) => {
    const lexical = lexicalScores.get(document.document_id) ?? 0;
    const vector = vectorScores.get(document.document_id) ?? null;
    const sources: Array<'lexical' | 'vector' | 'cohort'> = [];
    let fused = 0;
    const lexicalPosition = lexicalRank.get(document.document_id);
    const vectorPosition = vectorRank.get(document.document_id);
    if (lexicalPosition !== undefined && lexical > 0) {
      sources.push('lexical');
      fused += 1 / (60 + lexicalPosition);
    }
    if (vectorPosition !== undefined && vector !== null) {
      sources.push('vector');
      fused += 1 / (60 + vectorPosition);
    }
    if (performanceIntent && document.comparison_percentile !== null) sources.push('cohort');
    return {
      document,
      lexical_score: lexical,
      vector_score: vector,
      fused_score: fused,
      rank_sources: sources,
    };
  });

  const relevant = scored.filter((item) => (
    performanceIntent
      ? item.lexical_score > 0 || tokenize(options.query).length === 0 || isGenericPerformanceQuery(options.query)
      : item.fused_score > 0
  ));
  const ranked = performanceIntent
    ? rankWithinCohorts(relevant)
    : relevant.sort((left, right) => (
      right.fused_score - left.fused_score
      || right.lexical_score - left.lexical_score
      || left.document.document_id.localeCompare(right.document.document_id)
    ));

  return {
    evidence: ranked.slice(0, limit).map((item, index) => toEvidence(item, index)),
    query_mode: performanceIntent ? 'cohort_performance' : 'relevance',
    vector_used: Boolean(options.queryVector && options.vectorIndex?.vectors.size),
  };
}

function bm25Scores(documents: AgentDocument[], query: string): Map<string, number> {
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

function vectorSimilarityScores(
  documents: AgentDocument[],
  index: LoadedVectorIndex | null | undefined,
  queryVector: number[] | null | undefined,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!index || !queryVector || queryVector.length !== index.manifest.dimension) return result;
  for (const document of documents) {
    const vector = index.vectors.get(document.document_id);
    if (!vector) continue;
    const similarity = cosineSimilarity(queryVector, vector);
    if (similarity > 0) result.set(document.document_id, similarity);
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

function rankWithinCohorts(items: ScoredDocument[]): ScoredDocument[] {
  return items.sort((left, right) => (
    (right.document.comparison_percentile ?? -1) - (left.document.comparison_percentile ?? -1)
    || right.lexical_score - left.lexical_score
    || left.document.platform.localeCompare(right.document.platform)
    || String(left.document.age_bucket).localeCompare(String(right.document.age_bucket))
  ));
}

function toEvidence(item: ScoredDocument, index: number): AgentEvidence {
  const document = item.document;
  const title = document.analysis?.hook_pattern
    || document.analysis?.opening_text
    || document.source_expression
    || `@${document.account_handle} on ${document.platform.replace('_', ' ')}`;
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
    title: truncate(title, 180),
    snippet: truncate(snippet, 360),
    source_url: document.canonical_url,
    platform: document.platform,
    account_handle: document.account_handle,
    posted_at: document.posted_at,
    observed_at: document.last_observed_at,
    signal: document.signal,
    age_bucket: document.age_bucket,
    comparison_percentile: document.comparison_percentile,
    metrics: document.metrics,
    evidence_limitations: document.evidence_limitations,
    retrieval_relevance: Number((1 / (index + 1)).toFixed(6)),
    rank_sources: item.rank_sources,
  };
}

function matchesFilters(document: AgentDocument, filters?: AgentFilters): boolean {
  if (!filters) return true;
  if (filters.platforms?.length && !filters.platforms.includes(document.platform)) return false;
  if (filters.signals?.length && !filters.signals.includes(document.signal)) return false;
  if (filters.date_from && (!document.posted_at || document.posted_at < `${filters.date_from}T00:00:00.000Z`)) return false;
  if (filters.date_to && (!document.posted_at || document.posted_at > `${filters.date_to}T23:59:59.999Z`)) return false;
  return true;
}

function isGenericPerformanceQuery(query: string): boolean {
  const meaningful = tokenize(query).filter((token) => !['best', 'breakout', 'highest', 'performance', 'performing', 'top', 'velocity', 'winner', 'winning'].includes(token));
  return meaningful.length === 0;
}

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}
