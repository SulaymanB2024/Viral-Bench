import assert from 'node:assert/strict';
import test from 'node:test';

import { assertEvidenceSafe } from '../lib/evidence.js';
import type { GeminiClient } from '../lib/gemini.js';
import { AgentService } from '../lib/service.js';
import { MemoryAgentStateStore } from '../lib/state.js';
import { completeVectorIndex, corpus } from './helpers.js';

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

test('public research repairs one validation-rejected Gemini response', async () => {
  const library = corpus();
  const index = completeVectorIndex(library);
  const vectorIndex = {
    ...index,
    manifest: {
      ...index.manifest,
      model: 'viralbench-local-hash-v1' as const,
    },
  };
  const outputs = [
    {
      answer: 'This framing guarantees employment.',
      findings: [{
        claim: 'This guarantees a result.',
        evidence_ids: ['evidence:tiktok:alpha'],
      }],
      limitations: [],
      followups: [],
    },
    {
      answer: 'The reviewed records use bounded, actionable guidance.',
      findings: [{
        claim: 'Actionable guidance appears in the matching reviewed records.',
        evidence_ids: ['evidence:tiktok:alpha'],
      }],
      limitations: ['This is observational snapshot evidence.'],
      followups: ['Compare the matching formats.'],
    },
  ];
  let generateCalls = 0;
  const gemini = {
    async generateJson() {
      const output = outputs[Math.min(generateCalls, outputs.length - 1)];
      generateCalls += 1;
      return output;
    },
  } as unknown as GeminiClient;
  const service = new AgentService({
    corpus: library,
    vectorIndex,
    store: new MemoryAgentStateStore(),
    gemini,
    enabled: true,
  });

  const result = await service.research({ question: 'resume internship hook' }, 'ip-hash');

  assert.equal(generateCalls, 2);
  assert.equal(result.mode, 'generated');
  assert.equal(result.model, 'gemini-3.1-flash-lite');
  assert.match(result.answer, /bounded, actionable guidance/);
});
