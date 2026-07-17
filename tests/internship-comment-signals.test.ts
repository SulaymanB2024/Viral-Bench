import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { buildCommentRunSpecs, chooseCommentPosts } from '../src/internship-comment-signals';
import type { LiveCandidateReport } from '../src/internship-live-reconciliation';
import type { SelectionLedger } from '../src/internship-research-batch';

test('comment collection deterministically targets six posts per platform under the $4 ceiling', () => {
  const selection = JSON.parse(fs.readFileSync(path.resolve('.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-selection.json'), 'utf8')) as SelectionLedger;
  const candidates = JSON.parse(fs.readFileSync(path.resolve('.semantic-artifacts/competitor-content/reports/internship-us-content-expansion-20260716-live-candidates.json'), 'utf8')) as LiveCandidateReport;
  const posts = chooseCommentPosts(selection, candidates);
  const specs = buildCommentRunSpecs(posts);

  assert.equal(posts.length, 18);
  assert.deepEqual(Object.fromEntries(['tiktok', 'instagram', 'youtube_shorts'].map((platform) => [platform, posts.filter((post) => post.platform === platform).length])), {
    tiktok: 6, instagram: 6, youtube_shorts: 6,
  });
  assert.equal(specs.reduce((sum, spec) => sum + spec.max_charge_usd, 0), 4);
});
