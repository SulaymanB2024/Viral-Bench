import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDraftDiscoveryAcquisitionManifest,
  canonicalizeAndDeduplicateDiscoverySeeds,
  canonicalizeDiscoveryHandle,
  canonicalizeDiscoveryHashtag,
  canonicalizeDiscoveryQuery,
  canonicalizeDiscoveryUrl,
  discoverySeedId,
  validateDiscoverySeedV1,
} from '../src/competitor-discovery-seeds';

const at = '2026-07-18T12:00:00.000Z';

function seed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    schema_version: 'viralbench_discovery_seed_v1',
    scope: 'internship_early_career',
    platform: 'instagram',
    source_type: 'competitor_profile',
    locator: 'early-career-source',
    evidence_url: 'https://www.instagram.com/early-career-source/',
    confidence: 'high',
    verification_state: 'candidate_pending_registry_review',
    verified_at: at,
    provenance: {
      source_document: 'docs/INTERNSHIP_COMPETITOR_UNIVERSE_20260716.md',
      source_url: 'https://www.example.com/source',
      observed_at: at,
      note: 'Public candidate recorded for deterministic validation.',
    },
    public_data: {
      classification: 'public_only',
      contains_private_data: false,
      contains_contact_data: false,
      declaration: 'Public discovery metadata only; no private or contact data.',
    },
    collection: {
      readiness: 'requires_registry_review',
      reason: 'Registry review and a separate collection approval are required.',
    },
    ...overrides,
  };
  return {
    ...base,
    seed_id: discoverySeedId(base as Parameters<typeof discoverySeedId>[0]),
  };
}

function catalog(seeds: unknown[], early = 7, broader = 3): Record<string, unknown> {
  return {
    schema_version: 'viralbench_discovery_seed_catalog_v1',
    generated_at: at,
    allocation: {
      target_total: early + broader,
      internship_early_career: early,
      broader_job_search: broader,
    },
    source_route_lineage: [{
      route: 'competitor_profile',
      source_document: 'docs/INTERNSHIP_COMPETITOR_UNIVERSE_20260716.md',
      source_url: 'https://www.example.com/source',
      observed_at: at,
    }],
    seeds,
  };
}

test('canonicalizes discovery handles, hashtags, URLs, and query seeds', () => {
  assert.equal(canonicalizeDiscoveryHandle('@JobRight.AI '), 'jobright.ai');
  assert.equal(canonicalizeDiscoveryHashtag(' #Internship_Tips '), 'internship_tips');
  assert.equal(
    canonicalizeDiscoveryUrl('https://EXAMPLE.com/path/?utm_source=test&b=2&a=1#ignore'),
    'https://example.com/path?a=1&b=2',
  );
  assert.equal(canonicalizeDiscoveryQuery('  Internship   Advice  Creators '), 'internship advice creators');
});

test('deduplicates exact canonical identities and preserves the 70/30 allocation deterministically', () => {
  const early = Array.from({ length: 7 }, (_, index) => seed({
    locator: `early-${index}`,
    evidence_url: `https://www.instagram.com/early-${index}/`,
    provenance: {
      source_document: 'docs/INTERNSHIP_COMPETITOR_UNIVERSE_20260716.md',
      source_url: 'https://www.example.com/source',
      observed_at: at,
      note: 'Public candidate recorded for deterministic validation.',
    },
  }));
  const broader = Array.from({ length: 3 }, (_, index) => seed({
    scope: 'broader_job_search',
    locator: `broader-${index}`,
  }));
  const duplicate = seed({
    locator: '@EARLY-0',
    evidence_url: 'https://www.instagram.com/early-0/?utm_source=test',
    provenance: {
      source_document: 'docs/INTERNSHIP_COMPETITOR_UNIVERSE_20260716.md',
      source_url: 'https://www.example.com/source?utm_source=test',
      observed_at: at,
      note: 'Public candidate recorded for deterministic validation.',
    },
  });
  const deduped = canonicalizeAndDeduplicateDiscoverySeeds([...early, ...broader, duplicate]);
  const manifest = buildDraftDiscoveryAcquisitionManifest(catalog([...early, ...broader, duplicate]));

  assert.equal(deduped.length, 10);
  assert.equal(manifest.seeds.length, 10);
  assert.deepEqual(manifest.allocation, {
    target_total: 10,
    internship_early_career: 7,
    broader_job_search: 3,
    internship_share: 0.7,
    broader_job_search_share: 0.3,
  });
  assert.equal(manifest.external_calls_authorized, false);
  assert.equal(manifest.source_registry_mutation_authorized, false);
});

test('requires dated provenance and public-only declarations', () => {
  const missingProvenance = seed({
    provenance: {
      source_document: 'docs/INTERNSHIP_COMPETITOR_UNIVERSE_20260716.md',
      source_url: '',
      observed_at: at,
      note: 'Missing source URL must fail.',
    },
  });
  assert.throws(() => validateDiscoverySeedV1(missingProvenance), /provenance source_url/);
  assert.throws(() => validateDiscoverySeedV1(seed({
    public_data: {
      classification: 'public_only',
      contains_private_data: true,
      contains_contact_data: false,
      declaration: 'Invalid declaration.',
    },
  })), /public-only data/);
});

test('records manual/API access gaps without authorizing a bypass', () => {
  const accessLimited = seed({
    platform: 'tiktok',
    source_type: 'official_trend',
    locator: 'internship trends',
    evidence_url: 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en',
    verification_state: 'access_limited',
    collection: {
      readiness: 'access_limited',
      reason: 'Manual UI evaluation only; stop at all access gates.',
    },
  });
  const validated = validateDiscoverySeedV1(accessLimited);
  assert.equal(validated.verification_state, 'access_limited');
  assert.equal(validated.collection.readiness, 'access_limited');
  assert.throws(() => validateDiscoverySeedV1(seed({
    source_type: 'keyword',
    locator: 'contact me at person@example.com',
    seed_id: 'seed_v1_not_checked_before_privacy_rejection',
  })), /private or contact data/);
});
