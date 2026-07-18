import assert from 'node:assert/strict';
import test from 'node:test';

import { assertEvidenceSafe } from '../lib/evidence.js';

test('evidence safety accepts explicit non-guarantee language', () => {
  assert.doesNotThrow(() => assertEvidenceSafe({
    answer: 'The reviewed examples cannot guarantee employment and are guidance rather than a guarantee.',
    limitations: ['The evidence does not directly prove that the framing reduces anxiety.'],
  }, []));
});

test('evidence safety still rejects affirmative causal and guarantee claims', () => {
  assert.throws(
    () => assertEvidenceSafe({
      answer: 'This framing guarantees employment and will increase applications.',
    }, []),
    /unsupported causal or guaranteed language/,
  );
});
