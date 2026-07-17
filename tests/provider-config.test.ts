import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditProviderConfiguration, verifyProviderConfiguration } from '../src/provider-config';

const optimizedEnv = {
  ALLOW_PAID_GENERATION: 'true',
  ALLOW_PUBLIC_URL_INGESTION: 'true',
  ALLOW_PUBLIC_SEO_RESEARCH: 'true',
  APIFY_TOKEN: 'test-apify-token',
  TWELVELABS_API_KEY: 'test-twelvelabs-key',
  APIFY_ACTOR_TIKTOK: 'clockworks/tiktok-scraper',
  APIFY_ACTOR_INSTAGRAM: 'apify/instagram-scraper',
  APIFY_ACTOR_YOUTUBE: 'streamers/youtube-scraper',
  APIFY_ACTOR_BUILD_TIKTOK: '0.0.561',
  APIFY_ACTOR_BUILD_INSTAGRAM: '0.0.690',
  APIFY_ACTOR_BUILD_YOUTUBE: '0.0.273',
  APIFY_INPUT_FIELD_TIKTOK: 'postURLs',
  APIFY_INPUT_FIELD_INSTAGRAM: 'directUrls',
  APIFY_INPUT_FIELD_YOUTUBE: 'startUrls',
  APIFY_INPUT_FORMAT_TIKTOK: 'string_array',
  APIFY_INPUT_FORMAT_INSTAGRAM: 'string_array',
  APIFY_INPUT_FORMAT_YOUTUBE: 'request_list',
  APIFY_INPUT_EXTRAS_TIKTOK_JSON: JSON.stringify({
    shouldDownloadVideos: true,
    shouldDownloadCovers: true,
    shouldDownloadSlideshowImages: true,
    downloadSubtitlesOptions: 'DOWNLOAD_SUBTITLES',
  }),
  APIFY_INPUT_EXTRAS_INSTAGRAM_JSON: JSON.stringify({ resultsType: 'posts', resultsLimit: 1 }),
  APIFY_INPUT_EXTRAS_YOUTUBE_JSON: JSON.stringify({ downloadSubtitles: true }),
  APIFY_USAGE_SETTLEMENT_MS: '10000',
};

test('provider configuration audit verifies full-fidelity settings without exposing credentials', () => {
  const audit = auditProviderConfiguration(optimizedEnv);
  assert.equal(audit.configuration_ready, true);
  assert.equal(audit.live_readiness.semantic_url_ingestion, true);
  assert.equal(audit.live_readiness.seo_discovery, true);
  assert.equal(audit.apify.actors.tiktok.enrichment.request_driven_comments, true);
  assert.equal(audit.apify.actors.instagram.enrichment.deep_comments, true);
  assert.equal(audit.apify.actors.instagram.enrichment.request_driven_top_and_recent_comments, true);
  assert.equal(audit.twelvelabs.separate_modality_embeddings_enabled_in_client, true);
  assert.equal(audit.warnings.some((warning) => warning.includes('separate comments run')), false);
  assert.equal(JSON.stringify(audit).includes('test-apify-token'), false);
  assert.equal(JSON.stringify(audit).includes('test-twelvelabs-key'), false);
  assert.equal(audit.external_calls_made, 0);
});

test('provider configuration audit reports missing build pins and invalid extras', () => {
  const audit = auditProviderConfiguration({
    ...optimizedEnv,
    APIFY_ACTOR_BUILD_TIKTOK: '',
    APIFY_INPUT_EXTRAS_INSTAGRAM_JSON: '[not-an-object]',
  });
  assert.equal(audit.configuration_ready, false);
  assert.ok(audit.blockers.includes('APIFY_ACTOR_BUILD_TIKTOK'));
  assert.ok(audit.blockers.includes('APIFY_INPUT_EXTRAS_INSTAGRAM_JSON:invalid_json_object'));
});

test('live-readonly verification authenticates providers and validates pinned builds without paid calls', async () => {
  const expectedPins = new Map([
    ['clockworks~tiktok-scraper', optimizedEnv.APIFY_ACTOR_BUILD_TIKTOK],
    ['apify~instagram-scraper', optimizedEnv.APIFY_ACTOR_BUILD_INSTAGRAM],
    ['streamers~youtube-scraper', optimizedEnv.APIFY_ACTOR_BUILD_YOUTUBE],
  ]);
  const requests: string[] = [];
  const verification = await verifyProviderConfiguration(optimizedEnv, 'full_fidelity_analysis', async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith('https://api.twelvelabs.io/')) {
      assert.equal(init?.headers && (init.headers as Record<string, string>)['x-api-key'], 'test-twelvelabs-key');
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    const actor = [...expectedPins.keys()].find((candidate) => url.includes(candidate));
    assert.ok(actor, `Unexpected verification URL: ${url}`);
    const pin = expectedPins.get(actor);
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer test-apify-token');
    return new Response(JSON.stringify({
      data: {
        total: 2,
        items: [
          { buildNumber: '0.99.9999', status: 'SUCCEEDED', startedAt: '2026-07-17T12:00:00.000Z' },
          { buildNumber: pin, status: 'SUCCEEDED', startedAt: '2026-07-16T12:00:00.000Z' },
        ],
      },
    }), { status: 200 });
  });

  assert.equal(verification.verified, true);
  assert.equal(verification.external_calls_made, 4);
  assert.equal(verification.paid_calls_made, 0);
  assert.equal(verification.apify.actors.instagram.pinned_build_found, true);
  assert.equal(verification.twelvelabs.authenticated, true);
  assert.ok(verification.warnings.some((warning) => warning.includes('one-item canary')));
  assert.equal(JSON.stringify(verification).includes('test-apify-token'), false);
  assert.equal(JSON.stringify(verification).includes('test-twelvelabs-key'), false);
  assert.equal(requests.length, 4);
});
