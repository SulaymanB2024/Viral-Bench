import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('scheduled workflow preserves the accepted timing, cap, target branch, and provider secrets contract', () => {
  const workflow = fs.readFileSync(
    '.github/workflows/scheduled-semantic-refresh.yml',
    'utf8',
  );
  assert.match(workflow, /cron: '17 9 \* \* 1,4'/);
  assert.match(workflow, /timezone: America\/Chicago/);
  assert.match(workflow, /TARGET_REF: codex\/autonomous-harness-primitives/);
  assert.match(workflow, /--max-total-usd 5/);
  assert.match(workflow, /APIFY_TOKEN: \$\{\{ secrets\.APIFY_TOKEN \}\}/);
  assert.match(workflow, /TWELVELABS_API_KEY: \$\{\{ secrets\.TWELVELABS_API_KEY \}\}/);
  assert.match(workflow, /REMOTE_SHA.*INITIAL_SHA/s);
  assert.match(workflow, /vercel@54\.14\.0 --prod/);
});
