import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentCorpus,
  sanitizePublicText,
  stableHash,
} from '../lib/corpus.js';
import { validateMarketingOutput, validateResearchOutput } from '../lib/evidence.js';
import {
  createOperatorSession,
  hashIpAddress,
  hashOperatorPassword,
  operatorCookie,
  verifyOperatorPassword,
  verifySessionToken,
} from '../lib/auth.js';
import { retrieveEvidence } from '../lib/retrieval.js';
import { MemoryAgentStateStore } from '../lib/state.js';
import type { LoadedVectorIndex } from '../lib/types.js';
import { corpus, document, evidence } from './helpers.js';

test('corpus normalization deduplicates records and removes contact data and unsupported claims', () => {
  const library = {
    generated_at: '2026-07-16T00:00:00Z',
    items: [{
      item_id: 'library-1',
      platform: 'tiktok',
      platform_post_id: '123',
      canonical_url: 'https://www.tiktok.com/@safe/video/123',
      account_handle: 'safe',
      caption: 'Email student@example.com, call +1 (312) 555-0199, or visit https://private.example/path',
      hashtags: ['internship'],
      posted_at: '2026-07-01T00:00:00Z',
      last_seen_at: '2026-07-02T00:00:00Z',
      observations: [],
      performance: { signal: 'promising' },
    }],
  };
  const dashboard = {
    generated_at: '2026-07-17T00:00:00Z',
    records: [{
      platform: 'tiktok',
      platform_post_id: '123',
      strategy: {
        data: {
          opening: { observed_words: 'A visible opening' },
          claims: [
            { observed_claim: 'Visible claim', evidence_status: 'visible' },
            { observed_claim: 'Unsupported private claim', evidence_status: 'unsupported' },
          ],
          transferable_structure: { hook_pattern: 'Problem before explanation' },
        },
      },
      quality: { passed: true },
    }],
  };
  const result = buildAgentCorpus(library, dashboard);
  assert.equal(result.documents.length, 1);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /student@example\.com/);
  assert.doesNotMatch(serialized, /312.*555.*0199/);
  assert.doesNotMatch(serialized, /private\.example/);
  assert.deepEqual(result.documents[0]?.analysis?.claims, ['Visible claim']);
  assert.equal(result.documents[0]?.kind, 'analyzed_post');
  assert.doesNotMatch(result.documents[0]?.search_text ?? '', /\bpromising\b/);
});

test('public text and content hashing are deterministic', () => {
  assert.equal(sanitizePublicText('  one\n two  '), 'one two');
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
});

test('corpus selects the freshest metric snapshot and reports invalid rows instead of silently dropping them', () => {
  const result = buildAgentCorpus({
    generated_at: '2026-07-17T00:00:00.000Z',
    items: [
      null,
      { platform: 'unsupported', platform_post_id: 'bad-platform' },
      {
        item_id: 'library-1',
        platform: 'tiktok',
        platform_post_id: 'freshness',
        canonical_url: 'https://www.tiktok.com/@safe/video/freshness',
        account_handle: 'safe',
        last_seen_at: '2026-07-18T00:00:00.000Z',
        observations: [{
          captured_at: '2026-07-18T00:00:00.000Z',
          views: 200,
          likes: 20,
          comments: 2,
          shares: 1,
          saves: 1,
        }],
        performance: {},
      },
    ],
  }, {
    generated_at: '2026-07-17T00:00:00.000Z',
    records: [
      { platform: 'tiktok' },
      {
        platform: 'tiktok',
        platform_post_id: 'freshness',
        metric_snapshot_at: '2026-07-16T00:00:00.000Z',
        metrics: { views: 100, likes: 10, comments: 1, shares: 0, saves: 0 },
        strategy: { data: {} },
        quality: { passed: true },
      },
    ],
  });

  assert.equal(result.documents[0]?.metrics.views, 200);
  assert.equal(result.documents[0]?.signal, 'insufficient_data');
  assert.equal(result.documents[0]?.last_observed_at, '2026-07-18T00:00:00.000Z');
  assert.equal(result.source_manifest.skipped_rows, 3);
  assert.deepEqual(result.source_manifest.skipped_by_reason, {
    'dashboard:missing_platform_post_id': 1,
    'library:invalid_or_missing_platform': 1,
    'library:invalid_row_shape': 1,
  });
});

test('retrieval filters explicitly and uses cohort percentiles only for performance intent', () => {
  const low = document('a-low', {
    platform: 'instagram',
    search_text: 'resume internship hook',
    comparison_percentile: 0.2,
    metrics: { ...document('x').metrics, views: 9_000_000 },
  });
  const high = document('z-high', {
    platform: 'tiktok',
    search_text: 'resume internship hook',
    comparison_percentile: 0.95,
    metrics: { ...document('x').metrics, views: 20 },
  });
  const library = corpus([low, high]);
  const relevance = retrieveEvidence({ corpus: library, query: 'resume internship hook' });
  assert.equal(relevance.query_mode, 'relevance');
  assert.equal(relevance.evidence[0]?.evidence_id, low.document_id);
  const performance = retrieveEvidence({ corpus: library, query: 'best performing' });
  assert.equal(performance.query_mode, 'cohort_performance');
  assert.equal(performance.evidence[0]?.evidence_id, high.document_id);
  assert.ok(performance.evidence[0]?.rank_sources.includes('cohort'));
  const filtered = retrieveEvidence({
    corpus: library,
    query: 'resume',
    filters: { platforms: ['instagram'], date_from: '2026-01-01', date_to: '2026-12-31' },
  });
  assert.deepEqual(filtered.evidence.map((item) => item.platform), ['instagram']);
});

test('retrieval fuses lexical and positive vector candidates without outcome fields', () => {
  const lexical = document('lexical', { search_text: 'resume proof checklist' });
  const semantic = document('semantic', {
    search_text: 'unrelated vocabulary',
    comparison_percentile: 0.99,
    metrics: { ...document('x').metrics, views: 99_000_000 },
  });
  const lexicalVector = new Float32Array(768);
  lexicalVector[1] = 1;
  const semanticVector = new Float32Array(768);
  semanticVector[0] = 1;
  const queryVector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
  const vectorIndex: LoadedVectorIndex = {
    manifest: {
      schema_version: 'viralbench_agent_vectors_v1',
      model: 'gemini-embedding-2',
      dimension: 768,
      index_version: 'test-index',
      generated_at: '2026-07-17T00:00:00.000Z',
      count: 2,
      entries: [
        { document_id: lexical.document_id, content_hash: lexical.content_hash, offset: 0 },
        { document_id: semantic.document_id, content_hash: semantic.content_hash, offset: 768 },
      ],
    },
    vectors: new Map([
      [lexical.document_id, lexicalVector],
      [semantic.document_id, semanticVector],
    ]),
  };
  const result = retrieveEvidence({
    corpus: corpus([lexical, semantic]),
    query: 'resume proof',
    vectorIndex,
    queryVector,
  });
  assert.equal(result.vector_used, true);
  assert.deepEqual(new Set(result.evidence.map((item) => item.evidence_id)), new Set([
    lexical.document_id,
    semantic.document_id,
  ]));
  assert.deepEqual(result.evidence.find((item) => item.evidence_id === lexical.document_id)?.rank_sources, ['lexical']);
  assert.deepEqual(result.evidence.find((item) => item.evidence_id === semantic.document_id)?.rank_sources, ['vector']);
});

test('evidence gate rejects unknown IDs, causal language, copied source, and malformed briefs', () => {
  const item = evidence();
  assert.throws(() => validateResearchOutput({
    answer: 'A grounded answer.',
    findings: [{ claim: 'A claim.', evidence_ids: ['evidence:tiktok:unknown'] }],
    limitations: [],
    followups: [],
  }, [item]), /outside the retrieval package/);
  assert.throws(() => validateResearchOutput({
    answer: 'This proves that the hook causes more views.',
    findings: [{ claim: 'A grounded observation.', evidence_ids: [item.evidence_id] }],
    limitations: [],
    followups: [],
  }, [item]), /causal/);
  const longCopy = `${item.title} ${item.snippet}`;
  assert.throws(() => validateResearchOutput({
    answer: longCopy,
    findings: [{ claim: 'Observed mechanic.', evidence_ids: [item.evidence_id] }],
    limitations: [],
    followups: [],
  }, [item]), /source phrase/);
  assert.throws(() => validateMarketingOutput({
    summary: 'Summary',
    audience_tension: 'Tension',
    concepts: [],
    experiment: {
      hypothesis: 'Hypothesis',
      control: 'Control',
      variants: [],
      primary_metrics: [],
      checkpoints: [],
    },
    claim_risks: [],
    limitations: [],
  }, [item]), /exactly three/);
});

test('scrypt auth signs an eight-hour secure session and hashes IP identifiers', () => {
  const password = 'correct horse battery staple';
  const encoded = hashOperatorPassword(password, Buffer.alloc(16, 7));
  assert.equal(verifyOperatorPassword(password, encoded), true);
  assert.equal(verifyOperatorPassword('wrong password here', encoded), false);
  const now = Date.parse('2026-07-17T12:00:00Z');
  const secret = 's'.repeat(48);
  const { session, token } = createOperatorSession(secret, now);
  assert.equal(session.exp - session.iat, 8 * 60 * 60);
  assert.deepEqual(verifySessionToken(token, secret, now + 1_000), session);
  assert.equal(verifySessionToken(token, secret, now + 8 * 60 * 60 * 1_000), null);
  assert.match(operatorCookie(token), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(hashIpAddress('203.0.113.8', 'a'.repeat(32)).length, 32);
});

test('memory state enforces concurrent rolling quotas, cache expiry, and revocation', async () => {
  const store = new MemoryAgentStateStore();
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () => store.rateLimit('concurrent', 5, 60_000)),
  );
  assert.equal(attempts.filter((result) => result.allowed).length, 5);
  await store.setJson('answer', { safe: true }, 60);
  assert.deepEqual(await store.getJson('answer'), { safe: true });
  await store.revokeSession('session-1', 60);
  assert.equal(await store.isSessionRevoked('session-1'), true);
});
