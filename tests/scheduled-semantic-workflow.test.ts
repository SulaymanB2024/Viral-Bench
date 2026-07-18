import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('semantic refresh stays manual-only while preserving its cap, branch, and provider contract', () => {
  const workflow = fs.readFileSync(
    '.github/workflows/scheduled-semantic-refresh.yml',
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.doesNotMatch(workflow, /^\s*-\s*cron:/m);
  assert.match(workflow, /TARGET_REF: codex\/autonomous-harness-primitives/);
  assert.match(workflow, /--max-total-usd 4\.5/);
  assert.match(workflow, /APIFY_TOKEN: \$\{\{ secrets\.APIFY_TOKEN \}\}/);
  assert.match(workflow, /TWELVELABS_API_KEY: \$\{\{ secrets\.TWELVELABS_API_KEY \}\}/);
  assert.match(workflow, /REMOTE_SHA.*INITIAL_SHA/s);
  assert.match(workflow, /vercel@54\.14\.0 --prod/);
});
