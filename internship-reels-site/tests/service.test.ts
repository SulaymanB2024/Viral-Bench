import assert from 'node:assert/strict';
import test from 'node:test';

import type { ResearchFailureDiagnostic } from '../lib/agent-diagnostics.js';
import { GeminiRequestError, type GeminiClient } from '../lib/gemini.js';
import {
  AgentService,
  parseOperatorBrief,
  parseResearchQuery,
} from '../lib/service.js';
import { MemoryAgentStateStore } from '../lib/state.js';
import { validateCreativeJobManifest } from '../../packages/creative/job_schema.js';
import { validateTractionExperimentManifest } from '../../src/traction-experiment.js';
import { completeVectorIndex, corpus } from './helpers.js';

class FakeGemini {
  embedCalls = 0;
  generateCalls = 0;
  fail = false;
  generateError: Error | null = null;
  generatedOutput: unknown | null = null;

  async embedText(): Promise<number[]> {
    this.embedCalls += 1;
    if (this.fail) throw new Error('provider unavailable');
    return Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
  }

  async generateJson(options: { model: string }): Promise<unknown> {
    this.generateCalls += 1;
    if (this.fail) throw new Error('provider unavailable');
    if (this.generateError) throw this.generateError;
    if (this.generatedOutput) return this.generatedOutput;
    if (options.model === 'gemini-3.5-flash') {
      return {
        summary: 'Use a practical student tension as the starting point for a controlled draft.',
        audience_tension: 'Students struggle to translate coursework into specific, relevant experience.',
        concepts: [
          {
            title: 'Coursework to proof',
            hypothesis: 'A concrete coursework example may improve saves among early-career viewers.',
            hook: 'Your coursework already contains a stronger example.',
            format: 'Five-slide checklist',
            script_beats: ['Name one course outcome.', 'Connect it to a role need.', 'Review the wording for accuracy.'],
            cta: 'Build and review one truthful example.',
            evidence_ids: ['evidence:tiktok:alpha'],
          },
          {
            title: 'Vague to specific',
            hypothesis: 'A before-and-after structure may make the guidance easier to apply.',
            hook: 'Replace one vague resume line.',
            format: 'Before-and-after carousel',
            script_beats: ['Show a vague phrase.', 'Add a specific action.', 'Keep the result accurate.'],
            cta: 'Save the comparison for your next edit.',
            evidence_ids: ['evidence:tiktok:beta'],
          },
          {
            title: 'Review boundary',
            hypothesis: 'An explicit review boundary may increase trust without promising outcomes.',
            hook: 'Nothing should be sent before you review it.',
            format: 'Myth and boundary carousel',
            script_beats: ['State the misconception.', 'Show the human review step.', 'Close with a manual action.'],
            cta: 'Review every tailored draft before sending.',
            evidence_ids: ['evidence:tiktok:alpha'],
          },
        ],
        experiment: {
          hypothesis: 'Specific examples may improve useful engagement.',
          control: 'Coursework to proof',
          variants: ['Vague to specific', 'Review boundary'],
          primary_metrics: ['view_velocity', 'save_rate', 'share_rate'],
          checkpoints: ['1h', '24h', '72h', '7d'],
        },
        claim_risks: [{
          claim: 'Tailoring improves outcomes.',
          risk: 'The reviewed corpus does not establish causality.',
          mitigation: 'Frame tailoring as a testable workflow and do not promise responses.',
        }],
        limitations: ['Reviewed snapshots do not establish causal performance.'],
      };
    }
    return {
      answer: 'The reviewed records use a problem-first opening followed by a concrete example and a bounded next step.',
      findings: [{
        claim: 'Problem-first openings appear in the matching reviewed records.',
        evidence_ids: ['evidence:tiktok:alpha'],
      }],
      limitations: ['This is observational snapshot evidence.'],
      followups: ['Compare checklist and before-and-after formats.'],
    };
  }
}

type StateFailure = 'cache_read' | 'rate_limit' | 'cache_write';

class FailingStateStore extends MemoryAgentStateStore {
  readonly #failure: StateFailure;

  constructor(failure: StateFailure) {
    super();
    this.#failure = failure;
  }

  override async getJson<T>(key: string): Promise<T | null> {
    if (this.#failure === 'cache_read') throw new Error('state-token-marker');
    return await super.getJson<T>(key);
  }

  override async rateLimit(key: string, limit: number, windowMs: number) {
    if (this.#failure === 'rate_limit') throw new Error('state-token-marker');
    return await super.rateLimit(key, limit, windowMs);
  }

  override async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.#failure === 'cache_write') throw new Error('state-token-marker');
    await super.setJson(key, value, ttlSeconds);
  }
}

class RecordingStateStore extends MemoryAgentStateStore {
  readonly cacheReadKeys: string[] = [];

  override async getJson<T>(key: string): Promise<T | null> {
    this.cacheReadKeys.push(key);
    return await super.getJson<T>(key);
  }
}

function localVectorIndex(library = corpus()) {
  const index = completeVectorIndex(library);
  return {
    ...index,
    manifest: {
      ...index.manifest,
      model: 'viralbench-local-hash-v1' as const,
    },
  };
}

test('input contracts reject URL/contact ingestion and unsupported filters', () => {
  assert.throws(
    () => parseResearchQuery({ question: 'Analyze https://example.com/post' }),
    /cannot contain contact details or URLs/,
  );
  assert.throws(
    () => parseResearchQuery({ question: 'What hooks work?', filters: { platforms: ['facebook'] } }),
    /unsupported/,
  );
  assert.throws(
    () => parseOperatorBrief({
      objective: 'Create awareness',
      audience: 'College students',
      platform: 'facebook',
      topic: 'Resume proof',
    }),
    /platform must be one of/,
  );
});

test('disabled or failed providers return explicit retrieval-only evidence', async () => {
  const disabled = new AgentService({ corpus: corpus(), enabled: false });
  const disabledResult = await disabled.research({ question: 'resume internship hook' }, 'ip-hash');
  assert.equal(disabledResult.mode, 'retrieval_only');
  assert.equal(disabledResult.model, null);

  const fake = new FakeGemini();
  fake.fail = true;
  const failed = new AgentService({
    corpus: corpus(),
    enabled: true,
    store: new MemoryAgentStateStore(),
    gemini: fake as unknown as GeminiClient,
  });
  const failedResult = await failed.research({ question: 'resume internship hook' }, 'ip-hash');
  assert.equal(failedResult.mode, 'retrieval_only');
  assert.match(failedResult.limitations.join(' '), /unavailable/i);
});

test('research diagnostics classify failures without recording prompts or provider details', async () => {
  const library = corpus();
  const cases: Array<{
    expectedStage: ResearchFailureDiagnostic['stage'];
    expectedClass: ResearchFailureDiagnostic['failure_class'];
    store: MemoryAgentStateStore;
    gemini: FakeGemini;
    expectedStatus?: number;
  }> = [];

  cases.push({
    expectedStage: 'state_cache_read',
    expectedClass: 'state_unavailable',
    store: new FailingStateStore('cache_read'),
    gemini: new FakeGemini(),
  });
  cases.push({
    expectedStage: 'state_rate_limit',
    expectedClass: 'state_unavailable',
    store: new FailingStateStore('rate_limit'),
    gemini: new FakeGemini(),
  });
  const providerFailure = new FakeGemini();
  providerFailure.generateError = new GeminiRequestError(403, false);
  cases.push({
    expectedStage: 'gemini_generate',
    expectedClass: 'gemini_http',
    expectedStatus: 403,
    store: new MemoryAgentStateStore(),
    gemini: providerFailure,
  });
  const invalidOutput = new FakeGemini();
  invalidOutput.generatedOutput = {
    answer: 'A valid-looking response with an invalid evidence reference.',
    findings: [{ claim: 'A bounded observation.', evidence_ids: ['evidence:outside:package'] }],
    limitations: [],
    followups: [],
  };
  cases.push({
    expectedStage: 'output_validation',
    expectedClass: 'validation_rejected',
    store: new MemoryAgentStateStore(),
    gemini: invalidOutput,
  });
  cases.push({
    expectedStage: 'state_cache_write',
    expectedClass: 'state_unavailable',
    store: new FailingStateStore('cache_write'),
    gemini: new FakeGemini(),
  });

  for (const scenario of cases) {
    const diagnostics: ResearchFailureDiagnostic[] = [];
    const service = new AgentService({
      corpus: library,
      vectorIndex: localVectorIndex(library),
      enabled: true,
      store: scenario.store,
      gemini: scenario.gemini as unknown as GeminiClient,
      diagnosticLogger: (diagnostic) => diagnostics.push(diagnostic),
    });
    const result = await service.research({
      question: 'resume internship hook PRIVATE_PROMPT_MARKER',
    }, 'ip-hash');

    assert.equal(result.mode, 'retrieval_only');
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.stage, scenario.expectedStage);
    assert.equal(diagnostics[0]?.failure_class, scenario.expectedClass);
    assert.equal(diagnostics[0]?.provider_status, scenario.expectedStatus);
    const observable = JSON.stringify({ diagnostics, result });
    assert.doesNotMatch(observable, /PRIVATE_PROMPT_MARKER|state-token-marker/);
  }
});

test('public answers are evidence-validated and safely cached without storing the question', async () => {
  const fake = new FakeGemini();
  const library = corpus();
  const store = new RecordingStateStore();
  const service = new AgentService({
    corpus: library,
    vectorIndex: completeVectorIndex(library),
    enabled: true,
    store,
    gemini: fake as unknown as GeminiClient,
  });
  const first = await service.research({ question: 'resume internship hook' }, 'ip-hash');
  const second = await service.research({ question: 'resume internship hook' }, 'ip-hash');
  assert.equal(first.mode, 'generated');
  assert.equal(second.mode, 'cached');
  assert.equal(fake.embedCalls, 1);
  assert.equal(fake.generateCalls, 1);
  assert.match(store.cacheReadKeys[0] ?? '', /^research:v2:/);
  assert.ok(first.findings.every((finding) => finding.evidence_ids.length > 0));
});

test('operator generation exports schema-valid inert drafts only', async () => {
  const fake = new FakeGemini();
  const library = corpus();
  const service = new AgentService({
    corpus: library,
    vectorIndex: completeVectorIndex(library),
    enabled: true,
    store: new MemoryAgentStateStore(),
    gemini: fake as unknown as GeminiClient,
  });
  const result = await service.marketingBrief({
    objective: 'Increase useful awareness',
    audience: 'College students seeking internships',
    platform: 'tiktok',
    topic: 'Turning coursework into role-relevant proof',
    constraints: 'Keep it truthful and practical',
  });
  assert.equal(result.mode, 'generated');
  assert.equal(result.model, 'gemini-3.5-flash');
  const creative = validateCreativeJobManifest(result.downloads.json.creative_job);
  const traction = validateTractionExperimentManifest(result.downloads.json.traction_experiment);
  assert.equal(creative.approval_status.state, 'draft');
  assert.deepEqual(creative.generated_assets, []);
  assert.equal(creative.provider_policy.allow_paid_generation, false);
  assert.equal(creative.provider_policy.allow_browser_ui, false);
  assert.equal(creative.provider_policy.allow_social_publishing, false);
  assert.equal(traction.variants.every((variant) => variant.status === 'draft'), true);
  assert.deepEqual(traction.publishing_policy, {
    manual_only: true,
    human_approval_required: true,
    auto_posting_allowed: false,
  });
});
