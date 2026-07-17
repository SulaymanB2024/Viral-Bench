import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  TwelveLabsClient,
  buildApifyActorInput,
  estimateTwelveLabsAnalysisCost,
  ingestSemanticFixture,
  mergeLinkedComments,
  normalizeProviderItemsWithReconciliation,
  runApifyActorForUrls,
} from '../src/semantic-pipeline';
import {
  SqliteSemanticStore,
  normalizeActorItems,
  storeContentAddressedMedia,
  type UrlIntakeRequest,
} from '../src/semantic-intelligence';

test('Apify input uses researched direct-URL shapes and rejects discovery extras', () => {
  const tiktok = buildApifyActorInput('tiktok', [
    'https://www.tiktok.com/@creator/video/1234567890?tracking=ignored',
  ], {
    APIFY_INPUT_EXTRAS_TIKTOK_JSON: JSON.stringify({ commentsPerPost: 100, maxRepliesPerComment: 5 }),
  });
  assert.deepEqual(tiktok, {
    commentsPerPost: 100,
    maxRepliesPerComment: 5,
    postURLs: ['https://www.tiktok.com/@creator/video/1234567890'],
  });
  const policyBounded = buildApifyActorInput('tiktok', [
    'https://www.tiktok.com/@creator/video/1234567890',
  ], {
    APIFY_INPUT_EXTRAS_TIKTOK_JSON: JSON.stringify({ commentsPerPost: 999, maxRepliesPerComment: 99 }),
  }, {
    enabled: true,
    max_high_engagement: 20,
    max_recent: 10,
    max_replies_per_thread: 3,
  });
  assert.equal(policyBounded.commentsPerPost, 30);
  assert.equal(policyBounded.topLevelCommentsPerPost, 30);
  assert.equal(policyBounded.maxRepliesPerComment, 3);

  const youtube = buildApifyActorInput('youtube_shorts', [
    'https://youtu.be/short-id',
  ], {});
  assert.deepEqual(youtube, {
    startUrls: [{ url: 'https://www.youtube.com/shorts/short-id' }],
  });

  assert.throws(() => buildApifyActorInput('instagram', [
    'https://www.instagram.com/reel/ABC123/',
  ], {
    APIFY_INPUT_EXTRAS_INSTAGRAM_JSON: JSON.stringify({ searchQueries: ['unapproved discovery'] }),
  }), /prohibited discovery/);
});

test('Apify runner uses current route, charge caps, polling, and linked comment datasets', async () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-apify-run-'));
  const requests: Array<{ url: string; body: unknown }> = [];
  const responses = [
    new Response(JSON.stringify({ data: { id: 'run12345678' } }), { status: 201 }),
    new Response(JSON.stringify({
      data: {
        id: 'run12345678',
        status: 'SUCCEEDED',
        defaultDatasetId: 'primaryDataset123',
        usageTotalUsd: 0.012,
      },
    })),
    new Response(JSON.stringify([{
      url: 'https://www.tiktok.com/@creator/video/1234567890',
      commentsDatasetURL: 'https://api.apify.com/v2/datasets/commentsDataset123/items?clean=true',
    }]), { headers: { 'x-apify-pagination-total': '1' } }),
    new Response(JSON.stringify({
      data: {
        id: 'run12345678',
        status: 'SUCCEEDED',
        defaultDatasetId: 'primaryDataset123',
        buildId: 'build12345678',
        buildNumber: '0.1.2',
        usageTotalUsd: 0.012,
      },
    })),
    new Response(JSON.stringify([{ id: 'comment-1', text: 'Skeptical but curious.' }])),
  ];

  const result = await runApifyActorForUrls('tiktok', [
    'https://www.tiktok.com/@creator/video/1234567890',
  ], {
    dbPath: path.join(artifactDir, 'unused.sqlite'),
    artifactDir,
    env: {
      APIFY_TOKEN: 'test-token',
      APIFY_ACTOR_TIKTOK: 'operator/example-actor',
      APIFY_RUN_COST_CEILING_USD: '0.5',
      APIFY_ESTIMATED_RUN_COST_USD: '0.01',
    },
    maxPollAttempts: 1,
    pollIntervalMs: 0,
    apifyUsageSettlementMs: 0,
    apifyMaxRetryAttempts: 0,
    sleep: async () => undefined,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const response = responses.shift();
      assert.ok(response, `Unexpected external call: ${String(input)}`);
      return response;
    },
  }, { maxCostUsd: 0.2 });

  assert.equal(requests.length, 5);
  const startUrl = new URL(requests[0].url);
  assert.equal(startUrl.pathname, '/v2/actors/operator~example-actor/runs');
  assert.equal(startUrl.searchParams.get('waitForFinish'), '0');
  assert.equal(startUrl.searchParams.get('maxItems'), '1');
  assert.equal(startUrl.searchParams.get('maxTotalChargeUsd'), '0.2');
  assert.deepEqual(requests[0].body, {
    postURLs: ['https://www.tiktok.com/@creator/video/1234567890'],
  });
  assert.equal(result.actual_cost_usd, 0.012);
  assert.equal(result.external_calls_made, 5);
  assert.equal(result.actor_build_id, 'build12345678');
  assert.equal(result.actor_build_number, '0.1.2');
  assert.equal(result.usage_finalized, true);
  assert.equal(result.dataset_items_returned, 1);
  assert.equal(result.dataset_items_total_reported, 1);
  assert.equal(result.dataset_truncated, false);
  assert.equal(result.dataset_truncation_unknown, false);
  assert.equal(result.linked_datasets.length, 1);
  assert.deepEqual(
    (mergeLinkedComments(result.items, result.linked_datasets)[0] as Record<string, unknown>).comments,
    [{ id: 'comment-1', text: 'Skeptical but curious.' }],
  );
});

test('Instagram comment policy runs top and recent comment lanes within one cost ceiling', async () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-instagram-comments-'));
  const postUrl = 'https://www.instagram.com/reel/ABC123/';
  const providerPostUrl = 'https://www.instagram.com/p/ABC123/';
  const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const runResponses = (
    runId: string,
    datasetId: string,
    items: unknown[],
    cost: number,
  ): Response[] => [
    new Response(JSON.stringify({ data: { id: runId } }), { status: 201 }),
    new Response(JSON.stringify({ data: { id: runId, status: 'SUCCEEDED', defaultDatasetId: datasetId, usageTotalUsd: cost } })),
    new Response(JSON.stringify(items), { headers: { 'x-apify-pagination-total': String(items.length) } }),
    new Response(JSON.stringify({ data: { id: runId, status: 'SUCCEEDED', defaultDatasetId: datasetId, usageTotalUsd: cost } })),
  ];
  const responses = [
    ...runResponses('primary-run', 'primary-dataset', [{ url: providerPostUrl, caption: 'Internship advice' }], 0.01),
    ...runResponses('top-run', 'top-dataset', [
      { id: 'top-1', postUrl: providerPostUrl, text: 'Most liked question', likesCount: 20 },
      { id: 'top-2', postUrl: providerPostUrl, text: 'Second liked question', likesCount: 10 },
    ], 0.02),
    ...runResponses('recent-run', 'recent-dataset', [
      { id: 'recent-1', postUrl: providerPostUrl, text: 'Newest question', timestamp: '2026-07-17T12:00:00.000Z' },
    ], 0.03),
  ];

  const result = await runApifyActorForUrls('instagram', [postUrl], {
    dbPath: path.join(artifactDir, 'unused.sqlite'),
    artifactDir,
    env: {
      APIFY_TOKEN: 'test-token',
      APIFY_ACTOR_INSTAGRAM: 'apify/instagram-scraper',
      APIFY_INPUT_EXTRAS_INSTAGRAM_JSON: JSON.stringify({ resultsType: 'posts', resultsLimit: 1 }),
    },
    maxPollAttempts: 1,
    pollIntervalMs: 0,
    apifyUsageSettlementMs: 0,
    sleep: async () => undefined,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
      });
      const response = responses.shift();
      assert.ok(response, `Unexpected external call: ${String(input)}`);
      return response;
    },
  }, {
    maxCostUsd: 0.600002,
    commentPolicy: {
      enabled: true,
      max_high_engagement: 2,
      max_recent: 1,
      max_replies_per_thread: 1,
    },
  });

  assert.equal(requests.length, 12);
  const runChargeCaps = [0, 4, 8].map((index) => Number(new URL(requests[index].url).searchParams.get('maxTotalChargeUsd')));
  assert.deepEqual(runChargeCaps, [0.200001, 0.200001, 0.2]);
  assert.equal(runChargeCaps.reduce((sum, value) => sum + value, 0), 0.600002);
  assert.equal(new URL(requests[4].url).searchParams.get('maxItems'), '4');
  assert.equal(new URL(requests[8].url).searchParams.get('maxItems'), '2');
  assert.equal(requests[4].body?.resultsType, 'comments');
  assert.equal(requests[4].body?.isNewestComments, false);
  assert.equal(requests[8].body?.isNewestComments, true);
  assert.equal(result.supplemental_runs.length, 2);
  assert.equal(result.linked_datasets.length, 2);
  assert.equal(result.actual_cost_usd, 0.06);
  const [merged] = mergeLinkedComments(result.items, result.linked_datasets) as Array<Record<string, unknown>>;
  assert.equal((merged.comments as unknown[]).length, 3);
});

test('Apify downloaded mediaUrls are retained for semantic video analysis', async () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-apify-media-'));
  const embeddingInputs: string[] = [];
  const report = await ingestSemanticFixture({
    request_id: 'downloaded-media-fixture',
    urls: ['https://www.tiktok.com/@creator/video/1234567890'],
    allowed_platforms: ['tiktok'],
    comment_policy: {
      enabled: false,
      max_high_engagement: 0,
      max_recent: 0,
      max_replies_per_thread: 0,
    },
    approval_state: 'approved',
    cost_limits: {
      max_total_usd: 0,
      max_apify_usd: 0,
      max_twelvelabs_usd: 0,
      max_gemini_usd: 0,
    },
  }, {
    tiktok: [{
      id: '1234567890',
      webVideoUrl: 'https://www.tiktok.com/@creator/video/1234567890',
      text: `Internship advice. ${'specific evidence '.repeat(500)}`,
      authorMeta: { id: 'creator-1', name: 'creator' },
      mediaUrls: ['https://api.apify.com/v2/key-value-stores/store/records/video.mp4'],
      videoViewCount: 1234,
      likesCount: 56,
    }],
  }, {
    dbPath: path.join(artifactDir, 'semantic.sqlite'),
    artifactDir,
    embeddingForText: (text) => {
      embeddingInputs.push(text);
      return [1, 0];
    },
  });

  assert.equal(report.posts_ingested, 1);
  assert.equal(report.text_only_posts, 0);
  assert.ok(embeddingInputs.every((text) => text.length <= 1_400));
  const [metrics] = JSON.parse(execFileSync('sqlite3', [
    '-json',
    path.join(artifactDir, 'semantic.sqlite'),
    'SELECT views, likes FROM performance_observations;',
  ], { encoding: 'utf8' })) as Array<{ views: number; likes: number }>;
  assert.deepEqual(metrics, { views: 1234, likes: 56 });
});

test('provider normalization reconciles accepted, excluded, quarantined, truncated, and unmatched rows', () => {
  const request: UrlIntakeRequest = {
    request_id: 'reconciliation-request',
    urls: [
      'https://www.tiktok.com/@creator/video/1234567890',
      'https://www.tiktok.com/@creator/video/9999999999',
    ],
    allowed_platforms: ['tiktok'],
    comment_policy: {
      enabled: false,
      max_high_engagement: 0,
      max_recent: 0,
      max_replies_per_thread: 0,
    },
    approval_state: 'approved',
    cost_limits: {
      max_total_usd: 0,
      max_apify_usd: 0,
      max_twelvelabs_usd: 0,
      max_gemini_usd: 0,
    },
  };
  const result = normalizeProviderItemsWithReconciliation(request, 'tiktok', [
    {
      id: '1234567890',
      webVideoUrl: request.urls[0],
      text: 'Observed public post.',
      authorMeta: { id: 'creator-1', name: 'creator' },
      videoViewCount: 100,
    },
    { errorCode: 'ITEM_NOT_FOUND', errorMessage: 'Provider could not resolve this item.' },
    42,
  ], {
    actor_id: 'fixture:tiktok',
    run_id: 'run-1',
    dataset_id: 'dataset-1',
    raw_artifact_path: '/tmp/raw.json',
    collected_at: '2026-07-17T00:00:00.000Z',
  }, {
    dataset_items_total_reported: 4,
    dataset_truncated: true,
    dataset_truncation_unknown: false,
  });

  assert.equal(result.posts.length, 1);
  assert.deepEqual({
    accepted: result.reconciliation.accepted,
    excluded: result.reconciliation.excluded,
    quarantined: result.reconciliation.quarantined,
  }, { accepted: 1, excluded: 1, quarantined: 1 });
  assert.equal(result.reconciliation.reconciliation_passed, true);
  assert.equal(result.reconciliation.dataset_truncated, true);
  assert.equal(result.reconciliation.provider_items_total_reported, 4);
  assert.deepEqual(result.reconciliation.unmatched_requested_urls, [
    'https://www.tiktok.com/@creator/video/9999999999',
  ]);
  assert.equal(result.reconciliation.exclusions[0]?.dataset_item_offset, 1);
  assert.equal(result.reconciliation.quarantines[0]?.dataset_item_offset, 2);
});

test('semantic store preserves source, metric, and comment history across post refreshes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-semantic-history-'));
  const dbPath = path.join(root, 'semantic.sqlite');
  const request: UrlIntakeRequest = {
    request_id: 'history-request',
    urls: ['https://www.tiktok.com/@creator/video/1234567890'],
    allowed_platforms: ['tiktok'],
    comment_policy: {
      enabled: true,
      max_high_engagement: 5,
      max_recent: 5,
      max_replies_per_thread: 2,
    },
    approval_state: 'approved',
    cost_limits: {
      max_total_usd: 0,
      max_apify_usd: 0,
      max_twelvelabs_usd: 0,
      max_gemini_usd: 0,
    },
  };
  const provenance = {
    actor_id: 'fixture:tiktok',
    run_id: 'run-1',
    dataset_id: 'dataset-1',
    raw_artifact_path: path.join(root, 'raw.json'),
    collected_at: '2026-07-17T00:00:00.000Z',
  };
  const [first] = normalizeActorItems(request, 'tiktok', [{
    id: '1234567890',
    webVideoUrl: request.urls[0],
    text: 'First observed caption.',
    authorMeta: { id: 'creator-1', name: 'creator' },
    videoViewCount: 100,
    likesCount: 10,
    comments: [{ id: 'comment-1', text: 'Useful checklist', diggCount: 4 }],
  }], provenance);
  const [second] = normalizeActorItems(request, 'tiktok', [{
    id: '1234567890',
    webVideoUrl: request.urls[0],
    text: 'Updated observed caption.',
    authorMeta: { id: 'creator-1', name: 'creator' },
    videoViewCount: 200,
    likesCount: 20,
    comments: [],
  }], {
    ...provenance,
    run_id: 'run-2',
    dataset_id: 'dataset-2',
    collected_at: '2026-07-18T00:00:00.000Z',
  });
  const store = new SqliteSemanticStore(dbPath);
  store.upsertPost(first);
  store.upsertPost(second);

  const [counts] = JSON.parse(execFileSync('sqlite3', [
    '-json',
    dbPath,
    `SELECT
      (SELECT COUNT(*) FROM performance_observations) AS metrics,
      (SELECT COUNT(*) FROM post_source_observations) AS sources,
      (SELECT COUNT(*) FROM social_comments) AS comments;`,
  ], { encoding: 'utf8' })) as Array<{ metrics: number; sources: number; comments: number }>;
  assert.deepEqual(counts, { metrics: 2, sources: 2, comments: 1 });
});

test('authenticated Apify media downloads do not forward credentials across origins', async () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-apify-auth-'));
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const media = await storeContentAddressedMedia(
    'https://api.apify.com/v2/key-value-stores/store/records/video.mp4',
    {
      rootDir: artifactDir,
      bearerAuthorization: {
        origin: 'https://api.apify.com',
        token: 'secret-token',
      },
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          authorization: new Headers(init?.headers).get('authorization'),
        });
        if (requests.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://cdn.example.com/video.mp4' },
          });
        }
        return new Response(new Uint8Array([0, 1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        });
      },
    },
  );

  assert.equal(requests[0].authorization, 'Bearer secret-token');
  assert.equal(requests[1].authorization, null);
  assert.equal(media.source_url, 'https://cdn.example.com/video.mp4');
  assert.equal(media.bytes, 4);
});

test('TwelveLabs client emits live-validated Marengo and Pegasus contracts', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const analysisPayload = {
    duration_sec: 4,
    hook: { text: 'A flower opens in close-up.', start_sec: 0, end_sec: 4 },
    creative_beats: [{
      start_sec: 0,
      end_sec: 4,
      label: 'transformation',
      description: 'The bud opens.',
      evidence: ['Petals visibly move outward.'],
    }],
    visible_proof: [{ start_sec: 0, end_sec: 4, description: 'The petals open.' }],
    on_screen_text: [],
    speech: [],
    audio_cues: [{ start_sec: 0, end_sec: 4, description: 'No distinct audio evidence.' }],
    pacing: { cuts_per_minute: 0, pattern: 'single continuous shot' },
    cta: { text: '', start_sec: null, end_sec: null },
    claims: [{ text: 'A flower opens.', start_sec: 0, end_sec: 4, support: 'visible' }],
    style: ['macro', 'serene'],
    evidence_limitations: ['Only four seconds were analyzed.'],
  };
  const responses = [
    new Response(JSON.stringify({
      data: [
        { embedding: [0.5, 0.5], start_sec: 0, end_sec: 4, embedding_scope: 'clip', embedding_option: 'fused' },
        { embedding: [0.5, 0.5], start_sec: 0, end_sec: 4, embedding_scope: 'asset', embedding_option: 'fused' },
      ],
    })),
    new Response(JSON.stringify({
      id: 'generation-123',
      data: JSON.stringify(analysisPayload),
      finish_reason: 'stop',
      usage: { output_tokens: 321 },
    })),
  ];
  const client = new TwelveLabsClient({
    apiKey: 'test-key',
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });

  const segments = await client.embedVideo({ url: 'https://example.com/video.mp4', startSec: 0, endSec: 4 });
  const analysis = await client.analyzeVideo({
    videoAssetId: 'video-asset-1',
    url: 'https://example.com/video.mp4',
    startSec: 0,
    endSec: 4,
    maxTokens: 1500,
  });

  assert.equal(segments.length, 2);
  assert.deepEqual((bodies[0].video as Record<string, unknown>).segmentation, {
    strategy: 'dynamic',
    dynamic: { min_duration_sec: 3 },
  });
  assert.deepEqual((bodies[0].video as Record<string, unknown>).embedding_type, [
    'separate_embedding',
    'fused_embedding',
  ]);
  assert.deepEqual(bodies[1].video, { type: 'url', url: 'https://example.com/video.mp4' });
  assert.equal(bodies[1].start_time, 0);
  assert.equal(bodies[1].end_time, 4);
  const schemaText = JSON.stringify((bodies[1].response_format as Record<string, unknown>).json_schema);
  assert.doesNotMatch(schemaText, /additionalProperties/);
  assert.doesNotMatch(schemaText, /"type":\[/);
  assert.equal(analysis.model_name, 'pegasus1.5');
  assert.equal(analysis.duration_sec, 4);
  assert.equal(analysis.evidence_limitations.length, 1);
});

test('TwelveLabs client rejects truncated structured analysis', async () => {
  const client = new TwelveLabsClient({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(JSON.stringify({
      data: '{"duration_sec":4',
      finish_reason: 'length',
      usage: { output_tokens: 512 },
    })),
  });

  await assert.rejects(() => client.analyzeVideo({
    videoAssetId: 'video-asset-1',
    url: 'https://example.com/video.mp4',
    startSec: 0,
    endSec: 4,
    maxTokens: 512,
  }), /truncated/);
});

test('TwelveLabs focused analysis uses the caller schema without the legacy broad schema', async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const client = new TwelveLabsClient({
    apiKey: 'test-key',
    fetchImpl: async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        id: 'focused-generation-1',
        data: JSON.stringify({ summary: 'Observed summary.' }),
        finish_reason: 'stop',
        usage: { input_tokens: 80, output_tokens: 20 },
      }));
    },
  });

  const result = await client.analyzeStructured<{ summary: string }>({
    assetId: 'asset-123',
    prompt: 'Return one observed summary.',
    jsonSchema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
    maxTokens: 1024,
  });

  const requestBody = requestBodies[0];
  assert.ok(requestBody);
  assert.equal(requestBody.max_tokens, 1024);
  assert.equal(requestBody.prompt, 'Return one observed summary.');
  assert.deepEqual(requestBody.video, { type: 'asset_id', asset_id: 'asset-123' });
  const responseFormat = requestBody.response_format as Record<string, unknown>;
  assert.deepEqual(responseFormat.json_schema, {
    type: 'object',
    properties: { summary: { type: 'string' } },
    required: ['summary'],
  });
  assert.equal(result.data.summary, 'Observed summary.');
  assert.equal(result.provider_generation_id, 'focused-generation-1');
});

test('TwelveLabs segmentation uses async time-based metadata without a prompt', async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const responses = [
    new Response(JSON.stringify({ task_id: 'segment-task-1', status: 'pending' }), { status: 202 }),
    new Response(JSON.stringify({ task_id: 'segment-task-1', status: 'processing' })),
    new Response(JSON.stringify({
      task_id: 'segment-task-1',
      status: 'ready',
      result: {
        generation_id: 'segment-generation-1',
        data: JSON.stringify({
          visual_shots: [{
            start_time: 0,
            end_time: 4,
            metadata: { visual_description: 'A student points to a checklist.' },
          }],
        }),
        finish_reason: 'stop',
        usage: { input_tokens: 100, output_tokens: 40 },
      },
    })),
  ];
  const client = new TwelveLabsClient({
    apiKey: 'test-key',
    pollIntervalMs: 0,
    maxPollAttempts: 3,
    sleep: async () => undefined,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });

  const result = await client.segmentVideo({
    assetId: 'asset-123',
    customId: 'deep_visual_1',
    minSegmentDuration: 2,
    maxSegmentDuration: 4,
    segmentDefinitions: [{
      id: 'visual_shots',
      description: 'Partition the full video into visual shots.',
      fields: [{
        name: 'visual_description',
        type: 'string',
        description: 'Describe visible evidence.',
      }],
    }],
  });

  const createBody = JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>;
  assert.equal(requests[0].url.endsWith('/analyze/tasks'), true);
  assert.equal(createBody.analysis_mode, 'time_based_metadata');
  assert.equal(createBody.prompt, undefined);
  assert.equal(createBody.min_segment_duration, 2);
  assert.equal(createBody.max_segment_duration, 4);
  assert.equal((createBody.response_format as Record<string, unknown>).type, 'segment_definitions');
  assert.match(String((requests[0].init?.headers as Record<string, string>)['Idempotency-Key']), /^segment-/);
  assert.equal(requests[1].url.endsWith('/analyze/tasks/segment-task-1'), true);
  assert.equal(result.task_id, 'segment-task-1');
  assert.equal(result.segments.visual_shots.length, 1);
  assert.equal(client.externalCallsMade, 3);
});

test('TwelveLabs uploads a lawful local asset once and preserves provider identifiers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-bench-twelvelabs-'));
  const videoPath = path.join(root, 'owned-draft.mp4');
  fs.writeFileSync(videoPath, Buffer.from('test-owned-video'));
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const payload = {
    duration_sec: 4,
    hook: { text: 'A scooter appears.', start_sec: 0, end_sec: 4 },
    creative_beats: [{ start_sec: 0, end_sec: 4, label: 'inspection', description: 'Scooter shown.', evidence: ['Scooter is visible.'] }],
    visible_proof: [{ start_sec: 0, end_sec: 4, description: 'Scooter is visible.' }],
    on_screen_text: [], speech: [], audio_cues: [],
    pacing: { cuts_per_minute: 0, pattern: 'single shot' },
    cta: { text: '', start_sec: null, end_sec: null },
    claims: [{ text: 'A scooter appears.', start_sec: 0, end_sec: 4, support: 'visible' }],
    style: ['inspection'], evidence_limitations: ['No condition test is visible.'],
  };
  const responses = [
    new Response(JSON.stringify({ _id: 'asset-123', status: 'processing', method: 'direct', filename: 'owned-draft.mp4' }), { status: 201 }),
    new Response(JSON.stringify({ _id: 'asset-123', status: 'processing', method: 'direct', filename: 'owned-draft.mp4' })),
    new Response(JSON.stringify({ _id: 'asset-123', status: 'ready', method: 'direct', filename: 'owned-draft.mp4', duration: 4, size: 16 })),
    new Response(JSON.stringify({ id: 'generation-456', data: JSON.stringify(payload), finish_reason: 'stop', usage: { input_tokens: 12, output_tokens: 34 } })),
  ];
  const client = new TwelveLabsClient({
    apiKey: 'test-key',
    pollIntervalMs: 0,
    sleep: async () => undefined,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });
  const asset = await client.createAsset({ localPath: videoPath, userMetadata: { evidence_id: 'owned-draft' } });
  const analysis = await client.analyzeVideo({ videoAssetId: 'owned-draft', assetId: asset._id, maxTokens: 1024 });
  assert.equal(asset.status, 'ready');
  assert.equal(client.externalCallsMade, 4);
  assert.ok(requests[0].init?.body instanceof FormData);
  assert.equal((requests[0].init?.headers as Record<string, string>)['Content-Type'], undefined);
  const analyzeBody = JSON.parse(String(requests[3].init?.body)) as Record<string, unknown>;
  assert.deepEqual(analyzeBody.video, { type: 'asset_id', asset_id: 'asset-123' });
  assert.equal(analysis.provider_asset_id, 'asset-123');
  assert.equal(analysis.provider_generation_id, 'generation-456');
  assert.equal(analysis.model_version, 'provider_revision_unknown');
  assert.equal(analysis.model_revision, null);
});

test('TwelveLabs rejects social page URLs as media sources', async () => {
  const client = new TwelveLabsClient({ apiKey: 'test-key', fetchImpl: async () => {
    throw new Error('fetch should not be called');
  } });
  await assert.rejects(
    () => client.embedVideo({ url: 'https://www.youtube.com/shorts/not-raw-media' }),
    /raw media URLs, not social-platform page URLs/,
  );
  assert.equal(client.externalCallsMade, 0);
});

test('TwelveLabs analysis pricing estimate uses returned video duration and output tokens', () => {
  assert.equal(estimateTwelveLabsAnalysisCost(24, 825), 0.0178675);
  assert.throws(() => estimateTwelveLabsAnalysisCost(-1, 825), /non-negative/);
});
