import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertEvidenceSafe,
  normalizeResearchOutput,
  validateResearchOutput,
} from '../lib/evidence.js';
import type { GeminiClient } from '../lib/gemini.js';
import { AgentService } from '../lib/service.js';
import { MemoryAgentStateStore } from '../lib/state.js';
import { completeVectorIndex, corpus, evidence } from './helpers.js';

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

test('evidence safety rejects unmeasured effectiveness and conversion language', () => {
  assert.throws(
    () => assertEvidenceSafe({
      answer: 'The most effective posts consistently use this sequence.',
      followups: ['Which version has the highest conversion rate?'],
    }, []),
    /effectiveness or conversion/,
  );
});

test('evidence safety rejects unsupported frequency and audience preference language', () => {
  assert.throws(
    () => assertEvidenceSafe({
      answer: 'These posts typically address uncertainty.',
      findings: ['Students demonstrate a preference for numbered lists.'],
    }, []),
    /frequency or audience-preference/,
  );
  assert.throws(
    () => assertEvidenceSafe({
      answer: 'The format reduces search uncertainty.',
    }, []),
    /audience-state change/,
  );
  assert.doesNotThrow(
    () => assertEvidenceSafe({
      answer: 'The reviewed record frames uncertainty as a next action.',
      followups: ['Which tools are typically present in the reviewed records?'],
    }, []),
  );
  assert.throws(
    () => assertEvidenceSafe({
      answer: 'This structure helps viewers move from uncertainty to action.',
    }, []),
    /unmeasured audience effect/,
  );
  assert.throws(
    () => assertEvidenceSafe({
      findings: ['The post presents a tool to resolve it.'],
    }, []),
    /unmeasured audience effect/,
  );
});

test('research findings enforce repeated-record and audience-theme citation scope', () => {
  const social = evidence('social');
  assert.throws(
    () => validateResearchOutput({
      answer: 'A bounded answer.',
      findings: [{
        claim: 'A repeated pattern appears across several records.',
        evidence_ids: [social.evidence_id],
      }],
      limitations: [],
      followups: [],
    }, [social]),
    /without at least two evidence IDs/,
  );

  const audience = {
    ...evidence('audience'),
    evidence_type: 'audience_theme' as const,
    content_type: 'audience_aggregate' as const,
    platform: null,
  };
  assert.throws(
    () => validateResearchOutput({
      answer: 'A bounded answer.',
      findings: [{
        claim: 'Job seekers demonstrate a need for one next step.',
        evidence_ids: [audience.evidence_id],
      }],
      limitations: [],
      followups: [],
    }, [audience]),
    /paraphrased audience theme/,
  );
});

test('research normalization bounds audience-theme claims and removes unavailable followups', () => {
  const audience = {
    ...evidence('audience'),
    evidence_type: 'audience_theme' as const,
    content_type: 'audience_aggregate' as const,
    platform: null,
    title: 'General early career uncertainty',
  };
  const normalized = normalizeResearchOutput({
    answer: 'The reviewed records frame uncertainty with a concrete next action.',
    findings: [{
      claim: 'Early-career seekers prioritize one specific action.',
      evidence_ids: [audience.evidence_id],
    }],
    limitations: [],
    followups: [
      'Which format has the highest retention?',
      'Which hook differences appear across the cited records?',
    ],
  }, [audience]);

  const validated = validateResearchOutput(normalized, [audience]);
  assert.equal(
    validated.findings[0]?.claim,
    'One paraphrased audience theme names general early career uncertainty as context.',
  );
  assert.deepEqual(validated.followups, ['Which hook differences appear across the cited records?']);
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
