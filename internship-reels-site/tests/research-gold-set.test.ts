import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyQueryIntent } from '../lib/retrieval.js';
import type { QueryIntent } from '../lib/types.js';

interface GoldCase {
  case_id: string;
  query: string;
  expected_intent: QueryIntent;
}

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/research-gold-set.json',
);
const cases = JSON.parse(fs.readFileSync(fixture, 'utf8')) as GoldCase[];

test('research gold set covers required topics and routes each query deterministically', () => {
  assert.deepEqual(new Set(cases.map((item) => item.case_id)), new Set([
    'audience-worries',
    'pay-and-housing',
    'search-uncertainty',
    'unpaid-internships',
    'cpt-opt',
    'scams',
    'carousels',
    'observed-velocity',
    'owned-outcomes',
    'no-evidence',
  ]));
  for (const item of cases) {
    assert.equal(classifyQueryIntent(item.query), item.expected_intent, item.case_id);
  }
});
