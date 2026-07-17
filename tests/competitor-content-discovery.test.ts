import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateDiscoveryConfig } from '../src/competitor-content-discovery';

function config(maxTotalChargeUsd: number, runCaps: number[]) {
  return {
    research_id: 'internship-us-live-discovery-test',
    purpose: 'public_competitor_content_research',
    publishing_in_scope: false,
    max_total_charge_usd: maxTotalChargeUsd,
    runs: runCaps.map((maxChargeUsd, index) => ({
      id: `run-${index}`,
      actor_id: 'clockworks/tiktok-scraper',
      input_mode: 'search',
      input: { searchQueries: ['internship'] },
      max_charge_usd: maxChargeUsd,
      max_items: 8,
    })),
  };
}

test('discovery config accepts run ceilings at the batch cap', () => {
  const value = validateDiscoveryConfig(config(5, [1.5, 1.5, 2]));

  assert.equal(value.max_total_charge_usd, 5);
  assert.equal(value.runs.reduce((sum, run) => sum + run.max_charge_usd, 0), 5);
});

test('discovery config rejects run ceilings above the batch cap before execution', () => {
  assert.throws(
    () => validateDiscoveryConfig(config(5, [1.5, 1.5, 2.01])),
    /exceed batch cap/,
  );
});

test('discovery config preserves the public research and no-publishing boundary', () => {
  assert.throws(
    () => validateDiscoveryConfig({ ...config(1, [1]), publishing_in_scope: true }),
    /publishing disabled/,
  );
});

test('discovery config accepts current Instagram general-post source lanes', () => {
  const value = validateDiscoveryConfig({
    research_id: 'instagram-general-posts-test',
    purpose: 'public_competitor_content_research',
    publishing_in_scope: false,
    max_total_charge_usd: 3,
    runs: [
      {
        id: 'instagram-profile-feed',
        actor_id: 'apify/instagram-scraper',
        input_mode: 'profile',
        input: {
          directUrls: ['https://www.instagram.com/joinhandshake/'],
          resultsType: 'posts',
          resultsLimit: 8,
        },
        max_charge_usd: 1,
        max_items: 8,
      },
      {
        id: 'instagram-hashtag-feed',
        actor_id: 'apify/instagram-scraper',
        input_mode: 'hashtag',
        input: {
          search: '#internshiptips,#careeradvice',
          searchType: 'hashtag',
          searchLimit: 5,
          resultsType: 'posts',
          resultsLimit: 8,
        },
        max_charge_usd: 1,
        max_items: 40,
      },
      {
        id: 'instagram-mentions-feed',
        actor_id: 'apify/instagram-scraper',
        input_mode: 'profile',
        input: {
          directUrls: ['https://www.instagram.com/joinhandshake/'],
          resultsType: 'mentions',
          resultsLimit: 8,
        },
        max_charge_usd: 1,
        max_items: 8,
      },
    ],
  });

  assert.equal(value.runs.length, 3);
});

test('discovery config rejects stale Instagram search fields', () => {
  assert.throws(
    () => validateDiscoveryConfig({
      ...config(1, [1]),
      runs: [{
        id: 'instagram-stale-search',
        actor_id: 'apify/instagram-scraper',
        input_mode: 'search',
        input: {
          search: 'internship tips',
          searchType: 'popular',
          resultsType: 'posts',
        },
        max_charge_usd: 1,
        max_items: 8,
      }],
    }),
    /searchType is not supported/,
  );
});

test('discovery config rejects mixed Instagram URL and search modes', () => {
  assert.throws(
    () => validateDiscoveryConfig({
      ...config(1, [1]),
      runs: [{
        id: 'instagram-mixed-input',
        actor_id: 'apify/instagram-scraper',
        input_mode: 'search',
        input: {
          directUrls: ['https://www.instagram.com/joinhandshake/'],
          search: '#internshiptips',
          searchType: 'hashtag',
          resultsType: 'posts',
        },
        max_charge_usd: 1,
        max_items: 8,
      }],
    }),
    /cannot combine directUrls and search/,
  );
});
