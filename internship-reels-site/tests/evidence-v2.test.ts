import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { buildAgentCorpus, createCorpusView } from '../lib/corpus.js';
import { retrieveEvidence } from '../lib/retrieval.js';
import { createAgentStateStore } from '../lib/state.js';
import { localHashEmbedding, loadVectorIndex, serializeVectors } from '../lib/vectors.js';
import {
  buildPublicAnalysisHtml,
  buildPublicLibrary,
  hashPublicRelease,
  scanPublicRelease,
} from '../scripts/build-static-site.js';
import { fetchOfficialSources } from '../scripts/fetch-official-sources.js';
import { disconnectedOwnedEvidence, importOwnedEvents } from '../scripts/import-owned-events.js';

function audienceSignal(id: string, theme: string, source = `https://example.test/${id}`) {
  return {
    signal_id: id,
    identity_redacted: true,
    theme,
    source_url: source,
    community: 'public-community',
    paraphrased_need: `Students describe ${theme} uncertainty.`,
    audience_segment: 'students',
    confidence: 0.8,
    published_at: '2026-07-17T00:00:00.000Z',
  };
}

function socialItem(id: string, contentType: string, velocity: number | null) {
  return {
    item_id: `item-${id}`,
    platform: 'instagram',
    platform_post_id: id,
    canonical_url: `https://www.instagram.com/p/${id}/`,
    account_handle: `account-${id}`,
    caption: `Internship ${contentType} evidence`,
    hashtags: ['internship'],
    content_type: contentType,
    last_seen_at: '2026-07-17T12:00:00.000Z',
    observation_count: velocity === null ? 1 : 2,
    observations: [{
      captured_at: '2026-07-17T12:00:00.000Z',
      source_reports: ['reviewed-us-collection'],
      views: 100,
    }],
    provenance: { source_reports: ['reviewed-us-collection'] },
    performance: {
      signal: 'promising',
      comparison_percentile: 0.8,
      observed_view_velocity_per_hour: velocity,
      observation_window_hours: velocity === null ? null : 24,
      comparison_metric: 'public_interactions',
    },
  };
}

test('audience themes deduplicate by signal id and enforce a privacy bucket of five', () => {
  const strong = Array.from({ length: 5 }, (_, index) => audienceSignal(`strong-${index}`, 'pay-and-housing'));
  const thin = Array.from({ length: 4 }, (_, index) => audienceSignal(`thin-${index}`, 'work-authorization'));
  const result = buildAgentCorpus({ generated_at: '2026-07-17T00:00:00Z', items: [] }, { records: [] }, {
    audienceInputs: [{ signals: [...strong, strong[0], ...thin] }],
  });
  const strongDocument = result.documents.find((item) => item.topic_tags.includes('pay-and-housing'));
  const thinDocument = result.documents.find((item) => item.topic_tags.includes('work-authorization'));
  assert.equal(strongDocument?.provenance.source_count, 5);
  assert.equal(strongDocument?.visibility, 'public_reviewed');
  assert.equal(thinDocument?.visibility, 'operator_provisional');
  assert.equal(createCorpusView(result, 'public_reviewed').documents.length, 1);
});

test('analysis fragments never create retrieval documents without a canonical social post', () => {
  const corpus = buildAgentCorpus({
    generated_at: '2026-07-17T00:00:00Z',
    items: [socialItem('canonical', 'short_video', null)],
  }, {
    records: [{
      candidate_id: 'analysis-only',
      platform: 'instagram',
      platform_post_id: 'not-in-library',
      canonical_url: 'https://www.instagram.com/p/not-in-library/',
      strategy: { data: { opening: { observed_words: 'Analysis-only wording' } } },
    }],
  });
  assert.equal(corpus.documents.filter((item) => item.evidence_type === 'social_post').length, 1);
  assert.equal(corpus.source_manifest.skipped_by_reason['dashboard:analysis_without_library_post'], 1);
});

test('official, owned, velocity, carousel, and cross-source routing stays intent-specific', () => {
  const audience = Array.from({ length: 5 }, (_, index) => audienceSignal(`aud-${index}`, 'internship-guidance'));
  const corpus = buildAgentCorpus({
    generated_at: '2026-07-17T00:00:00Z',
    items: [
      socialItem('carousel', 'carousel_post', null),
      socialItem('velocity', 'short_video', 12),
    ],
  }, { records: [] }, {
    audienceInputs: [{ signals: audience }],
    officialInput: {
      resources: [{
        resource_id: 'dol-internships',
        url: 'https://www.dol.gov/example',
        status: 'current',
        summary: 'Official internship pay guidance.',
        chunks: ['Official guidance for internship pay and workplace rights.'],
        publisher: 'Department of Labor',
        authority: 'federal',
        retrieved_at: '2026-07-17T00:00:00Z',
        semantic_topics: ['internship-guidance'],
      }],
    },
    ownedInput: disconnectedOwnedEvidence('2026-07-17T00:00:00Z'),
  });

  const official = retrieveEvidence({ corpus, query: 'What is the official unpaid internship guidance?' });
  assert.equal(official.query_intent, 'official_guidance');
  assert.deepEqual(new Set(official.evidence.map((item) => item.evidence_type)), new Set(['official_source']));

  const carousel = retrieveEvidence({ corpus, query: 'Show carousel slide mechanics' });
  assert.equal(carousel.query_intent, 'creative_mechanics');
  assert.ok(carousel.evidence.every((item) => item.content_type === 'carousel_post'));

  const velocity = retrieveEvidence({ corpus, query: 'Which posts have observed velocity?' });
  assert.equal(velocity.query_intent, 'observed_velocity');
  assert.ok(velocity.evidence.every((item) => item.measurement_state === 'observed'));

  const owned = retrieveEvidence({ corpus, query: 'What are our campaign outcomes?' });
  assert.equal(owned.query_intent, 'owned_outcomes');
  assert.equal(owned.evidence[0]?.measurement_state, 'not_connected');

  const cross = retrieveEvidence({ corpus, query: 'Cross-source internship guidance comparison' });
  assert.equal(cross.query_intent, 'cross_source');
  assert.ok(new Set(cross.evidence.map((item) => item.evidence_type)).size >= 2);
});

test('owned importer rejects personal fields and sub-five nonzero buckets', () => {
  const base = {
    schema_version: 2,
    bucket_start: '2026-07-01T00:00:00Z',
    bucket_end: '2026-07-02T00:00:00Z',
    account_id: 'aggregate-account',
    campaign_id: null,
    experiment_id: null,
    variant_id: null,
    post_id: null,
    audience_segment: 'students',
    event_name: 'listing_saved',
    count: 5,
    privacy: {
      aggregate_only: true,
      minimum_bucket_count: 5,
      prohibited_fields: ['resume_text', 'name', 'email', 'message', 'user_id', 'application_history'],
    },
  };
  assert.equal(importOwnedEvents([base]).connection_state, 'connected');
  assert.throws(() => importOwnedEvents([{ ...base, email: 'private@example.test' }]), /Prohibited/);
  assert.throws(() => importOwnedEvents([{ ...base, count: 4 }]), /below its privacy bucket/);
  assert.equal(disconnectedOwnedEvidence().connection_state, 'not_connected');
});

test('official fetch records both current and failed allowlisted resources', async () => {
  const report = await fetchOfficialSources({
    resources: [
      { resource_id: 'good', url: 'https://good.example/page', use_for: 'guidance' },
      { resource_id: 'failed', url: 'https://failed.example/page', use_for: 'guidance' },
    ],
  }, {
    now: () => new Date('2026-07-17T12:00:00Z'),
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('failed.example')) return new Response('failed', { status: 503 });
      return new Response(
        '<html><title>Official guidance</title><meta name="description" content="Current official internship guidance for students and employers."><p>This official page explains reviewed internship guidance and applicable responsibilities in sufficient detail.</p></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }) as typeof fetch,
  });
  assert.equal(report.summary.expected, 2);
  assert.equal(report.summary.current, 1);
  assert.equal(report.summary.failed, 1);
  assert.deepEqual(report.resources.map((item) => item.status), ['current', 'failed']);
});

test('local vectors are deterministic, complete, and need no remote embedding call', () => {
  const first = localHashEmbedding('internship pay housing');
  const second = localHashEmbedding('internship pay housing');
  assert.deepEqual(first, second);
  assert.equal(first.length, 768);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viralbench-vector-'));
  const serialized = serializeVectors([{
    document_id: 'evidence:one',
    content_hash: 'hash',
    values: first,
  }], 'index', '2026-07-17T00:00:00Z', 'viralbench-local-hash-v1');
  const manifestPath = path.join(root, 'vectors.json');
  const binaryPath = path.join(root, 'vectors.bin');
  fs.writeFileSync(manifestPath, JSON.stringify(serialized.manifest));
  fs.writeFileSync(binaryPath, serialized.binary);
  const loaded = loadVectorIndex(manifestPath, binaryPath);
  assert.equal(loaded?.manifest.model, 'viralbench-local-hash-v1');
  assert.equal(loaded?.vectors.size, 1);
});

test('release sanitizer strips server fields and detects blocked public content', () => {
  const sanitized = buildPublicLibrary({
    generated_at: '2026-07-17T00:00:00Z',
    sources: { discovery_files: ['/Users/private/source.json'] },
    items: [socialItem('public', 'image_post', null)],
  }) as { items: Array<Record<string, unknown>> };
  assert.equal(sanitized.items.length, 1);
  assert.equal('provenance' in sanitized.items[0]!, false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viralbench-public-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Safe public output</h1>');
  const first = scanPublicRelease(root);
  const second = scanPublicRelease(root);
  assert.equal(first.passed, true);
  assert.equal(first.release_hash, second.release_hash);
  assert.equal(first.release_hash, hashPublicRelease(root));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Changed public output</h1>');
  assert.notEqual(scanPublicRelease(root).release_hash, first.release_hash);
  fs.writeFileSync(path.join(root, 'index.html'), '<script src="/missing.js"></script>');
  assert.ok(scanPublicRelease(root).findings.some((item) => item.rule === 'missing_local_asset:/missing.js'));
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'lib/private.js'), 'const path = "/Users/private/source";');
  const failed = scanPublicRelease(root);
  assert.equal(failed.passed, false);
  assert.ok(failed.findings.some((item) => item.rule === 'blocked_path_published'));
  assert.ok(failed.findings.some((item) => item.rule === 'local_absolute_path'));
});

test('public analysis HTML withholds exact speech, on-screen text, and provider identifiers', () => {
  const source = `<script>
    const records = ${JSON.stringify([{
      candidate_id: 'candidate',
      platform: 'tiktok',
      platform_post_id: '123',
      canonical_url: 'https://www.tiktok.com/@safe/video/123',
      strategy: {
        data: {
          opening: {
            start_sec: 0,
            end_sec: 2,
            observed_words: 'Exact creator wording',
            observed_visual: 'A speaker uses a title card.',
            mechanism: 'Direct address',
          },
          content_arc: { audience_problem: 'Uncertainty', progression: 'Steps', payoff: 'Checklist' },
          cta: { requested_action: 'Save the checklist' },
          claims: [{ observed_claim: 'Unsupported source claim', evidence_status: 'spoken' }],
          transferable_structure: { hook_pattern: 'Question', beat_pattern: 'Steps', payoff_pattern: 'Checklist' },
          evidence_limitations: ['Observational evidence only.'],
        },
      },
      segmentation: {
        task_id: 'private-provider-task',
        segments: {
          visual_shots: [{ start_time: 0, end_time: 2, metadata: { visual_description: 'Speaker', on_screen_text_exact: 'Exact screen text' } }],
          audio_beats: [{ start_time: 0, end_time: 2, metadata: { delivery: 'fast', speech_exact: 'Exact speech' } }],
          editing_beats: [],
        },
      },
      media_src: './media/tiktok-123.mp4',
      duration_sec: 2,
      metrics: {},
      language: { basis: 'spoken' },
      company: {},
      paid: {},
    }])};
    const aiReportSnapshot = { reports: {} };</script>`;
  const output = buildPublicAnalysisHtml(source);
  assert.doesNotMatch(output, /Exact creator wording|Exact screen text|Exact speech|private-provider-task|Unsupported source claim/);
  assert.match(output, /exact source wording withheld/i);
  assert.match(output, /A speaker uses a title card/);
});

test('Marketplace KV environment aliases create a shared Redis state store', () => {
  assert.ok(createAgentStateStore({
    KV_REST_API_URL: 'https://example.upstash.io',
    KV_REST_API_TOKEN: 'test-token',
  }));
  assert.equal(createAgentStateStore({}), null);
});
