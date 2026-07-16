import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  TwelveLabsClient,
  buildApifyActorInput,
  mergeLinkedComments,
  runApifyActorForUrls,
} from '../src/semantic-pipeline';

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
    }])),
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
  assert.equal(result.linked_datasets.length, 1);
  assert.deepEqual(
    (mergeLinkedComments(result.items, result.linked_datasets)[0] as Record<string, unknown>).comments,
    [{ id: 'comment-1', text: 'Skeptical but curious.' }],
  );
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
