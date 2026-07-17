import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { reconcileLiveDiscovery } from '../src/internship-live-reconciliation';

const manifest = JSON.parse(fs.readFileSync(path.resolve(
  '.ops/competitor_research/internship-us-content-expansion-20260716.json',
), 'utf8')) as unknown;

test('live reconciliation separates valid candidates, provider gaps, and scope exclusions', () => {
  const result = reconcileLiveDiscovery({
    manifest,
    generic: {
      research_id: 'generic',
      created_at: '2026-07-17T00:00:00.000Z',
      runs: [{
        id: 'tiktok-competitor-profiles-recent',
        actor_id: 'clockworks/tiktok-scraper',
        item_count: 3,
        actual_cost_usd: 0.1,
        external_calls_made: 3,
        items: [
          {
            id: '7600000000000000001',
            text: 'US college internship proof checklist',
            createTimeISO: '2026-07-01T00:00:00.000Z',
            webVideoUrl: 'https://www.tiktok.com/@brand/video/7600000000000000001',
            authorMeta: { name: 'brand' },
            playCount: 100,
          },
          { error: 'profile unavailable', url: 'https://www.tiktok.com/@missing' },
          {
            id: '7600000000000000002',
            text: 'High school college admissions advice',
            webVideoUrl: 'https://www.tiktok.com/@brand/video/7600000000000000002',
            authorMeta: { name: 'brand' },
          },
        ],
      }],
      errors: [{ id: 'instagram-search', message: 'apify_run_failed:FAILED' }],
      totals: {
        items: 3,
        actual_cost_usd_reported: 0.1,
        configured_max_charge_usd: 0.5,
        conservative_spend_usd: 0.2,
        external_calls_made: 3,
      },
    },
    proof: {
      research_id: 'proof',
      created_at: '2026-07-17T00:00:00.000Z',
      candidates: [],
      provider_gaps: [],
      runs: [],
      external_calls_made: 0,
      total_usage_usd: 0,
      errors: [],
    },
    access: {
      research_id: 'access',
      created_at: '2026-07-17T00:00:00.000Z',
      candidates: [],
      provider_gaps: [],
      runs: [],
      external_calls_made: 0,
      total_usage_usd: 0,
      errors: [],
    },
    now: () => new Date('2026-07-17T01:00:00.000Z'),
  });

  assert.equal(result.candidates.output_counts.normalized_candidates, 1);
  assert.equal(result.candidates.exclusions.provider_gap_row, 1);
  assert.equal(result.candidates.exclusions.high_school_or_admissions, 1);
  assert.equal(result.coverage.costs.actual_cost_usd_reported, 0.1);
  assert.equal(result.coverage.costs.conservative_spend_usd, 0.2);
  assert.match(result.coverage.blockers.join('\n'), /multimodal analysis is blocked/i);
});
