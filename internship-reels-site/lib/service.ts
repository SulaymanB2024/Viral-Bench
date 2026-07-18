import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  logResearchFailure,
  reportResearchFailure,
  type AgentDiagnosticLogger,
  type ResearchFailureStage,
} from './agent-diagnostics.js';
import { stableHash } from './corpus.js';
import {
  validateMarketingOutput,
  validateResearchOutput,
  type ValidatedMarketingOutput,
} from './evidence.js';
import {
  evidencePrompt,
  GeminiClient,
  MARKETING_RESPONSE_SCHEMA,
  marketingSystemInstruction,
  RESEARCH_RESPONSE_SCHEMA,
  researchSystemInstruction,
} from './gemini.js';
import { HttpError } from './http.js';
import { retrieveEvidence } from './retrieval.js';
import { createAgentStateStore, type AgentStateStore } from './state.js';
import type {
  AgentCorpus,
  AgentEvidence,
  AgentFilters,
  LoadedVectorIndex,
  MarketingBrief,
  PerformanceSignal,
  ResearchAnswer,
  SocialPlatform,
} from './types.js';
import { PERFORMANCE_SIGNALS, SOCIAL_PLATFORMS } from './types.js';
import { loadVectorIndex, localHashEmbedding } from './vectors.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;
const PUBLIC_CACHE_SECONDS = 24 * 60 * 60;
const CONTACT_OR_URL = /\b(?:https?:\/\/|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(?:\+?\d[\s().-]*){7,}/i;

export interface ResearchQueryInput {
  question: string;
  filters?: AgentFilters;
}

export interface OperatorBriefInput {
  objective: string;
  audience: string;
  platform: SocialPlatform;
  topic: string;
  constraints?: string;
}

interface AgentServiceOptions {
  corpus: AgentCorpus;
  vectorIndex?: LoadedVectorIndex | null;
  store?: AgentStateStore | null;
  gemini?: GeminiClient | null;
  enabled?: boolean;
  diagnosticLogger?: AgentDiagnosticLogger | null;
}

class ResearchStageError extends Error {
  constructor(readonly stage: ResearchFailureStage) {
    super(`Research stage failed: ${stage}`);
  }
}

export class AgentService {
  readonly #corpus: AgentCorpus;
  readonly #vectorIndex: LoadedVectorIndex | null;
  readonly #store: AgentStateStore | null;
  readonly #gemini: GeminiClient | null;
  readonly #enabled: boolean;
  readonly #diagnosticLogger: AgentDiagnosticLogger | null;

  constructor(options: AgentServiceOptions) {
    this.#corpus = options.corpus;
    this.#vectorIndex = options.vectorIndex ?? null;
    this.#store = options.store ?? null;
    this.#gemini = options.gemini ?? null;
    this.#enabled = options.enabled ?? false;
    this.#diagnosticLogger = options.diagnosticLogger ?? null;
  }

  async research(input: ResearchQueryInput, ipHash: string | null): Promise<ResearchAnswer> {
    const lexical = retrieveEvidence({
      corpus: this.#corpus,
      query: input.question,
      filters: input.filters,
    });
    const unavailable = this.#availabilityLimitation();
    if (lexical.query_intent === 'owned_outcomes' && !lexical.evidence.length) {
      return retrievalOnlyResearch(
        lexical,
        this.#corpus.index_version,
        'Privacy-safe owned marketing aggregates are not connected; no owned outcome is inferred.',
      );
    }
    if (unavailable) return retrievalOnlyResearch(lexical, this.#corpus.index_version, unavailable);
    if (!ipHash) {
      return retrievalOnlyResearch(
        lexical,
        this.#corpus.index_version,
        'Privacy-preserving request quota configuration is unavailable; showing reviewed retrieval only.',
      );
    }

    const cacheKey = `research:${stableHash({
      question: input.question.toLowerCase(),
      filters: input.filters ?? {},
      index_version: this.#corpus.index_version,
    })}`;

    try {
      const cached = await this.#runResearchStage('state_cache_read', () => (
        this.#store!.getJson<ResearchAnswer>(cacheKey)
      ));
      if (isCachedResearchAnswer(cached, this.#corpus.index_version)) {
        return { ...cached, mode: 'cached' };
      }

      const ipQuota = await this.#runResearchStage('state_rate_limit', () => (
        this.#store!.rateLimit(`public:ip:${ipHash}:day`, 5, DAY_MS)
      ));
      if (!ipQuota.allowed) {
        return retrievalOnlyResearch(
          lexical,
          this.#corpus.index_version,
          `Daily uncached-question limit reached. Retrieval remains available until ${ipQuota.reset_at}.`,
        );
      }
      const generationQuota = await this.#runResearchStage('state_rate_limit', () => (
        this.#consumePublicGenerationQuota()
      ));
      if (!generationQuota) {
        return retrievalOnlyResearch(
          lexical,
          this.#corpus.index_version,
          'Public generation capacity is temporarily exhausted; showing deterministic retrieval.',
        );
      }
      const queryVector = await this.#researchQueryVector(input.question);
      if (!queryVector) {
        return retrievalOnlyResearch(
          lexical,
          this.#corpus.index_version,
          'Embedding capacity is temporarily exhausted; showing deterministic lexical retrieval.',
        );
      }
      const hybrid = retrieveEvidence({
        corpus: this.#corpus,
        query: input.question,
        filters: input.filters,
        vectorIndex: this.#vectorIndex,
        queryVector,
        intent: lexical.query_intent,
      });
      if (!hybrid.evidence.length) {
        return retrievalOnlyResearch(
          hybrid,
          this.#corpus.index_version,
          'The reviewed corpus does not contain enough matching evidence for this question.',
        );
      }

      const generated = await this.#runResearchStage('gemini_generate', () => this.#gemini!.generateJson({
        model: 'gemini-3.1-flash-lite',
        systemInstruction: researchSystemInstruction(),
        prompt: [
          'Question:',
          input.question,
          '',
          'Active filters:',
          JSON.stringify(input.filters ?? {}),
          '',
          'Reviewed evidence package:',
          evidencePrompt(hybrid.evidence, 40_000),
        ].join('\n').slice(0, 48_000),
        responseSchema: RESEARCH_RESPONSE_SCHEMA,
        maxOutputTokens: 1_400,
        beforeRetry: () => this.#runResearchStage('state_rate_limit', () => (
          this.#consumePublicGenerationQuota()
        )),
      }));
      const validated = await this.#runResearchStage('output_validation', () => (
        validateResearchOutput(generated, hybrid.evidence)
      ));
      const answer: ResearchAnswer = {
        mode: 'generated',
        ...validated,
        evidence: hybrid.evidence,
        model: 'gemini-3.1-flash-lite',
        index_version: this.#corpus.index_version,
        query_intent: hybrid.query_intent,
        coverage: hybrid.coverage,
      };
      await this.#runResearchStage('state_cache_write', () => (
        this.#store!.setJson(cacheKey, answer, PUBLIC_CACHE_SECONDS)
      ));
      return answer;
    } catch {
      return retrievalOnlyResearch(
        lexical,
        this.#corpus.index_version,
        'Generation or shared quota state is unavailable; showing deterministic retrieval only.',
      );
    }
  }

  async marketingBrief(input: OperatorBriefInput): Promise<MarketingBrief> {
    const query = `${input.topic} ${input.audience} ${input.objective}`;
    const lexical = retrieveEvidence({ corpus: this.#corpus, query });
    const unavailable = this.#availabilityLimitation();
    if (unavailable) return retrievalOnlyMarketing(lexical, this.#corpus.index_version, unavailable);

    try {
      let model: 'gemini-3.5-flash' | 'gemini-3.1-flash-lite';
      let beforeRetry: () => Promise<boolean>;
      if (await this.#consumeOperatorGenerationQuota()) {
        model = 'gemini-3.5-flash';
        beforeRetry = () => this.#consumeOperatorGenerationQuota();
      } else if (await this.#consumePublicGenerationQuota()) {
        model = 'gemini-3.1-flash-lite';
        beforeRetry = () => this.#consumePublicGenerationQuota();
      } else {
        return retrievalOnlyMarketing(
          lexical,
          this.#corpus.index_version,
          'Operator generation capacity is exhausted and no public-first fallback capacity remains.',
        );
      }

      const queryVector = await this.#queryVector(query);
      if (!queryVector) {
        return retrievalOnlyMarketing(
          lexical,
          this.#corpus.index_version,
          'Embedding capacity is temporarily exhausted; showing matching evidence only.',
        );
      }
      const hybrid = retrieveEvidence({
        corpus: this.#corpus,
        query,
        vectorIndex: this.#vectorIndex,
        queryVector,
        intent: lexical.query_intent,
      });
      if (!hybrid.evidence.length) {
        return retrievalOnlyMarketing(
          hybrid,
          this.#corpus.index_version,
          'The reviewed corpus does not contain enough matching evidence to draft a brief.',
        );
      }
      const generated = await this.#gemini!.generateJson({
        model,
        systemInstruction: marketingSystemInstruction(),
        prompt: [
          'Internships.com operator request:',
          JSON.stringify(input),
          '',
          'Reviewed evidence package:',
          evidencePrompt(hybrid.evidence, 80_000),
          '',
          'Draft an original brief. Treat all performance language as a testable hypothesis.',
        ].join('\n').slice(0, 96_000),
        responseSchema: MARKETING_RESPONSE_SCHEMA,
        maxOutputTokens: 2_500,
        beforeRetry,
      });
      const validated = validateMarketingOutput(generated, hybrid.evidence);
      const downloads = buildDraftDownloads(validated, hybrid.evidence, input, this.#corpus);
      return {
        mode: 'generated',
        ...validated,
        evidence: hybrid.evidence,
        model,
        index_version: this.#corpus.index_version,
        query_intent: hybrid.query_intent,
        coverage: hybrid.coverage,
        downloads,
      };
    } catch {
      return retrievalOnlyMarketing(
        lexical,
        this.#corpus.index_version,
        'The provider response did not pass the evidence gate; showing matching evidence only.',
      );
    }
  }

  async #consumePublicGenerationQuota(): Promise<boolean> {
    const minute = await this.#store!.rateLimit('public:generation:minute', 10, MINUTE_MS);
    if (!minute.allowed) return false;
    const daily = await this.#store!.rateLimit('public:generation:day', 100, DAY_MS);
    return daily.allowed;
  }

  async #consumeOperatorGenerationQuota(): Promise<boolean> {
    const minute = await this.#store!.rateLimit('operator:generation:minute', 2, MINUTE_MS);
    if (!minute.allowed) return false;
    const daily = await this.#store!.rateLimit('operator:generation:day', 15, DAY_MS);
    return daily.allowed;
  }

  async #consumeEmbeddingQuota(): Promise<boolean> {
    const daily = await this.#store!.rateLimit('embedding:query:day', 150, DAY_MS);
    return daily.allowed;
  }

  async #researchQueryVector(value: string): Promise<number[] | null> {
    if (this.#vectorIndex?.manifest.model === 'viralbench-local-hash-v1') {
      return localHashEmbedding(value.slice(0, 8_000));
    }
    const embeddingQuota = await this.#runResearchStage('state_rate_limit', () => (
      this.#consumeEmbeddingQuota()
    ));
    if (!embeddingQuota) return null;
    return await this.#runResearchStage('gemini_embed', () => this.#gemini!.embedText(
      value.slice(0, 8_000),
      () => this.#runResearchStage('state_rate_limit', () => this.#consumeEmbeddingQuota()),
    ));
  }

  async #queryVector(value: string): Promise<number[] | null> {
    if (this.#vectorIndex?.manifest.model === 'viralbench-local-hash-v1') {
      return localHashEmbedding(value.slice(0, 8_000));
    }
    if (!(await this.#consumeEmbeddingQuota())) return null;
    return this.#gemini!.embedText(
      value.slice(0, 8_000),
      () => this.#consumeEmbeddingQuota(),
    );
  }

  async #runResearchStage<T>(
    stage: ResearchFailureStage,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ResearchStageError) throw error;
      reportResearchFailure(this.#diagnosticLogger, stage, error);
      throw new ResearchStageError(stage);
    }
  }

  #availabilityLimitation(): string | null {
    if (!this.#enabled) return 'The research copilot is in staged rollout mode; showing reviewed retrieval only.';
    if (!this.#store) return 'Shared quota and session state is unavailable; showing reviewed retrieval only.';
    if (!this.#gemini) return 'Gemini synthesis is unavailable; showing reviewed retrieval only.';
    if (
      !this.#vectorIndex
      || this.#corpus.documents.some((document) => !this.#vectorIndex!.vectors.has(document.document_id))
    ) {
      return 'Complete vector coverage is unavailable; showing deterministic retrieval without spending an embedding call.';
    }
    return null;
  }
}

export function parseResearchQuery(input: Record<string, unknown>): ResearchQueryInput {
  const question = boundedText(input.question, 'question', 8, 1_200);
  assertNoPersonalInput(question, 'question');
  const filters = input.filters === undefined ? undefined : parseFilters(input.filters);
  return { question, ...(filters ? { filters } : {}) };
}

export function parseOperatorBrief(input: Record<string, unknown>): OperatorBriefInput {
  const objective = boundedText(input.objective, 'objective', 3, 500);
  const audience = boundedText(input.audience, 'audience', 3, 300);
  const topic = boundedText(input.topic, 'topic', 3, 500);
  const constraints = input.constraints === undefined
    ? undefined
    : boundedText(input.constraints, 'constraints', 1, 1_000);
  for (const [field, value] of Object.entries({ objective, audience, topic, constraints })) {
    if (value) assertNoPersonalInput(value, field);
  }
  if (typeof input.platform !== 'string' || !(SOCIAL_PLATFORMS as readonly string[]).includes(input.platform)) {
    throw new HttpError(400, 'invalid_platform', `platform must be one of: ${SOCIAL_PLATFORMS.join(', ')}.`);
  }
  return {
    objective,
    audience,
    platform: input.platform as SocialPlatform,
    topic,
    ...(constraints ? { constraints } : {}),
  };
}

export function createDefaultAgentService(
  env: NodeJS.ProcessEnv = process.env,
  audience: 'public' | 'operator' = 'public',
): AgentService {
  const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
  const corpusFile = audience === 'operator' ? 'agent-corpus-operator.json' : 'agent-corpus-public.json';
  const corpusPath = fs.existsSync(`${dataDirectory}${corpusFile}`)
    ? `${dataDirectory}${corpusFile}`
    : `${dataDirectory}agent-corpus.json`;
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as AgentCorpus;
  const vectorIndex = loadVectorIndex(
    `${dataDirectory}agent-vectors.json`,
    `${dataDirectory}agent-vectors.bin`,
  );
  const apiKey = env.GEMINI_API_KEY?.trim();
  return new AgentService({
    corpus,
    vectorIndex,
    store: createAgentStateStore(env),
    gemini: apiKey ? new GeminiClient({ apiKey }) : null,
    enabled: env.AGENT_ENABLED?.toLowerCase() === 'true',
    diagnosticLogger: logResearchFailure,
  });
}

function parseFilters(value: unknown): AgentFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_filters', 'filters must be an object.');
  }
  const record = value as Record<string, unknown>;
  const platforms = optionalEnumArray(record.platforms, SOCIAL_PLATFORMS, 'platforms');
  const signals = optionalEnumArray(record.signals, PERFORMANCE_SIGNALS, 'signals');
  const dateFrom = optionalDate(record.date_from, 'date_from');
  const dateTo = optionalDate(record.date_to, 'date_to');
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new HttpError(400, 'invalid_date_range', 'date_from must not be after date_to.');
  }
  return {
    ...(platforms ? { platforms: platforms as SocialPlatform[] } : {}),
    ...(signals ? { signals: signals as PerformanceSignal[] } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  };
}

function optionalEnumArray<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): Array<T[number]> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > allowed.length) {
    throw new HttpError(400, 'invalid_filters', `${field} must be an array of supported values.`);
  }
  const unique = [...new Set(value)];
  if (unique.some((item) => typeof item !== 'string' || !allowed.includes(item as T[number]))) {
    throw new HttpError(400, 'invalid_filters', `${field} contains an unsupported value.`);
  }
  return unique as Array<T[number]>;
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, 'invalid_filters', `${field} must use YYYY-MM-DD.`);
  }
  return value;
}

function boundedText(value: unknown, field: string, minLength: number, maxLength: number): string {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_input', `${field} must be text.`);
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length < minLength || compact.length > maxLength) {
    throw new HttpError(400, 'invalid_input', `${field} must contain ${minLength} to ${maxLength} characters.`);
  }
  return compact;
}

function assertNoPersonalInput(value: string, field: string): void {
  if (CONTACT_OR_URL.test(value)) {
    throw new HttpError(
      400,
      'personal_or_url_input',
      `${field} cannot contain contact details or URLs. V1 accepts research questions, not personal records or URL ingestion.`,
    );
  }
}

function retrievalOnlyResearch(
  retrieval: ReturnType<typeof retrieveEvidence>,
  indexVersion: string,
  limitation: string,
): ResearchAnswer {
  const { evidence } = retrieval;
  const findings = evidence.slice(0, 4).map((item) => ({
    claim: `${evidenceLabel(item)} matched the question under the reviewed ${item.evidence_type.replaceAll('_', ' ')} contract.`,
    evidence_ids: [item.evidence_id],
  }));
  return {
    mode: 'retrieval_only',
    answer: evidence.length
      ? 'Showing the closest reviewed records without model synthesis.'
      : 'No matching reviewed records were found.',
    findings,
    evidence,
    limitations: [
      limitation,
      'Retrieval results are observations from reviewed snapshots, not causal conclusions or reusable creator assets.',
    ],
    followups: evidence.length
      ? ['Narrow the platform, signal, or date filters.', 'Ask about a specific hook, format, or audience tension.']
      : ['Broaden the wording or remove one filter.'],
    model: null,
    index_version: indexVersion,
    query_intent: retrieval.query_intent,
    coverage: retrieval.coverage,
  };
}

function retrievalOnlyMarketing(
  retrieval: ReturnType<typeof retrieveEvidence>,
  indexVersion: string,
  limitation: string,
): MarketingBrief {
  const { evidence } = retrieval;
  return {
    mode: 'retrieval_only',
    summary: evidence.length
      ? 'A grounded brief could not be generated. Review the matching evidence before drafting.'
      : 'No matching reviewed evidence was found, so no brief was drafted.',
    audience_tension: '',
    concepts: [],
    experiment: {
      hypothesis: '',
      control: '',
      variants: [],
      primary_metrics: [],
      checkpoints: [],
    },
    claim_risks: [],
    evidence,
    limitations: [
      limitation,
      'No creative job, asset, queue entry, social call, or publishing action was created.',
    ],
    model: 'retrieval-only',
    index_version: indexVersion,
    query_intent: retrieval.query_intent,
    coverage: retrieval.coverage,
    downloads: { markdown: '', json: {} },
  };
}

function buildDraftDownloads(
  brief: ValidatedMarketingOutput,
  evidence: AgentEvidence[],
  input: OperatorBriefInput,
  corpus: AgentCorpus,
): MarketingBrief['downloads'] {
  const shortId = stableHash({ brief, input, index_version: corpus.index_version }).slice(0, 12);
  const jobId = `internships_agent_draft_${shortId}`;
  const capturedAt = corpus.generated_at;
  const creativeJob = {
    job_id: jobId,
    brand: {
      id: 'internships_com',
      display_name: 'Internships.com',
      website_url: 'https://www.internships.com/',
      account_handle: null,
    },
    niche: `Internships.com ${input.topic}`,
    platform_targets: [platformLabel(input.platform)],
    content_type: 'evidence-grounded career guidance slideshow',
    output_mode: 'slideshow',
    source_inputs: [{
      kind: 'semantic_bundle',
      label: 'Transient operator brief and reviewed ViralBench evidence',
      value: JSON.stringify({
        objective: input.objective,
        audience: input.audience,
        topic: input.topic,
        constraints: input.constraints ?? null,
        evidence_ids: evidence.map((item) => item.evidence_id),
        index_version: corpus.index_version,
      }),
      notes: 'Downloaded draft only. The website did not persist the prompt or enqueue this artifact.',
    }],
    trend_examples: evidence.slice(0, 12).map((item) => ({
      id: item.evidence_id,
      source_name: 'Reviewed public evidence',
      source_url: item.source_url,
      captured_at: item.observed_at ?? item.posted_at ?? capturedAt,
      platform: platformLabel(item.platform),
      format: 'transferable mechanics reference',
      hook: 'Source wording intentionally excluded; use the cited mechanism only.',
      notes: item.evidence_limitations.join(' '),
    })),
    provider_policy: {
      approved_providers: ['local_renderer'],
      allow_paid_generation: false,
      allow_browser_ui: false,
      allow_social_publishing: false,
      account_automation_allowed: false,
      credentials_policy: 'no_credentials_in_repo',
      notes: [
        'This transient export is a draft specification only.',
        'All provider, browser, social publishing, and account automation gates are disabled.',
      ],
    },
    output_requirements: {
      aspect_ratio: '9:16',
      dimensions: { width: 1080, height: 1920 },
      slide_count: 5,
      required_outputs: ['slides', 'caption', 'hashtags', 'spoken_script', 'posting_notes'],
      house_style: {
        system: 'internships_signal_stack_v1',
        promise: 'Useful, truthful internship guidance before product promotion',
        recurring_devices: [
          'student tension first',
          'one falsifiable hypothesis',
          'specific truthful example',
          'human review before send',
        ],
        originality_rules: [
          'Use evidence for structure only; never reuse creator wording, footage, identity, or shot order.',
          'Never imply a guaranteed internship, interview, referral, response, or offer.',
          'Never imply account automation, auto-submission, or automatic publishing.',
        ],
        overlay_labels: {
          hero: 'THE STUDENT TENSION',
          checklist: 'MAKE IT SPECIFIC',
          comparison: 'BEFORE → AFTER',
          uncertainty: 'TEST, DO NOT PROMISE',
          decision: 'REVIEW BEFORE SEND',
          uncertainty_badge: 'DRAFT',
        },
        footer_note: 'Draft only. No internship, interview, referral, response, or offer is guaranteed.',
      },
      slides: draftSlides(brief),
      caption: `${brief.summary} ${brief.concepts[0]?.cta ?? ''}`.trim(),
      hashtags: ['internshiptips', 'careerprep', 'collegestudents'],
      spoken_script: [
        brief.audience_tension,
        ...(brief.concepts[0]?.script_beats ?? []),
        brief.concepts[0]?.cta ?? '',
      ].filter(Boolean).join(' '),
      posting_notes: [
        'Draft only; copy, claims, evidence links, and destination account require human review.',
        'Do not generate assets or publish from this file.',
        'Test only one changed dimension per non-control variant.',
      ],
    },
    video_requirements: null,
    generation_trace: [],
    video_qa_artifacts: [],
    approval_status: {
      state: 'draft',
      human_reviewer: null,
      reviewed_at: null,
      notes: ['Generated as an optional download; never enqueued or approved.'],
    },
    generated_assets: [],
    qa_notes: [
      'Evidence IDs must resolve to the bundled ViralBench index version.',
      'All concepts remain hypotheses until a controlled, human-reviewed experiment is measured.',
    ],
  };
  const tractionExperiment = {
    experiment_id: `traction_${shortId}`,
    job_id: jobId,
    objective: 'audience_traction',
    content_family: `Internships.com ${input.topic}`,
    creative_lane: 'image_slideshow',
    delivery_mode: 'native_carousel',
    hypothesis: brief.experiment.hypothesis,
    control_variant_id: `${shortId}_control`,
    primary_metrics: ['view_velocity', 'save_rate', 'share_rate'],
    variants: brief.concepts.map((concept, index) => ({
      variant_id: index === 0 ? `${shortId}_control` : `${shortId}_variant_${index + 1}`,
      label: concept.title,
      hook: concept.hook,
      changed_dimensions: index === 0 ? [] : ['hook'],
      audio_plan: {
        mode: 'platform_commercial_music',
        track_id: null,
        track_title: null,
        source_url: null,
        captured_at: null,
        region: null,
        commercial_use_status: 'requires_review',
        added_at_posting: true,
        notes: ['Select only a currently precleared commercial-use track during manual posting.'],
      },
      status: 'draft',
    })),
    decision_policy: {
      minimum_checkpoint: '24h',
      min_repeats_before_pattern: 3,
      max_changed_dimensions_per_variant: 1,
      stop_after_non_improving_variants: 2,
    },
    publishing_policy: {
      manual_only: true,
      human_approval_required: true,
      auto_posting_allowed: false,
    },
    notes: [
      'Review at 1h, 24h, 72h, and 7d; do not select a winner before the 24h checkpoint.',
      'The website exported this draft but did not save, enqueue, render, or publish it.',
    ],
  };
  return {
    markdown: marketingMarkdown(brief, evidence, input, corpus.index_version),
    json: {
      schema_version: 'viralbench_operator_download_v1',
      index_version: corpus.index_version,
      creative_job: creativeJob,
      traction_experiment: tractionExperiment,
    },
  };
}

function draftSlides(brief: ValidatedMarketingOutput): Array<Record<string, unknown>> {
  const concept = brief.concepts[0]!;
  const beat = (index: number, fallback: string) => concept.script_beats[index] ?? fallback;
  return [
    {
      slide_number: 1,
      on_screen_text: concept.hook,
      visual_direction: 'Open with the student tension in original brand-owned typography.',
      visual_mode: 'hero',
      proof_cues: ['audience', 'tension', 'hypothesis'],
    },
    {
      slide_number: 2,
      on_screen_text: beat(0, 'Name the specific problem.'),
      visual_direction: 'Break the guidance into a short, truthful checklist.',
      visual_mode: 'checklist',
      proof_cues: ['specific', 'truthful'],
    },
    {
      slide_number: 3,
      on_screen_text: beat(1, 'Show one accurate example.'),
      visual_direction: 'Contrast a vague approach with a more specific approach.',
      visual_mode: 'comparison',
      proof_cues: ['before', 'after'],
    },
    {
      slide_number: 4,
      on_screen_text: beat(2, 'Frame the outcome as a test.'),
      visual_direction: 'State uncertainty and avoid outcome promises.',
      visual_mode: 'uncertainty',
      proof_cues: ['hypothesis', 'no guarantee'],
    },
    {
      slide_number: 5,
      on_screen_text: concept.cta,
      visual_direction: 'Close with an explicit student-review boundary.',
      visual_mode: 'decision',
      proof_cues: ['review', 'manual send'],
    },
  ];
}

function marketingMarkdown(
  brief: ValidatedMarketingOutput,
  evidence: AgentEvidence[],
  input: OperatorBriefInput,
  indexVersion: string,
): string {
  const concepts = brief.concepts.map((concept, index) => [
    `### ${index + 1}. ${concept.title}`,
    '',
    `- Hypothesis: ${concept.hypothesis}`,
    `- Hook: ${concept.hook}`,
    `- Format: ${concept.format}`,
    `- Script beats: ${concept.script_beats.join(' → ')}`,
    `- CTA: ${concept.cta}`,
    `- Evidence: ${concept.evidence_ids.join(', ')}`,
  ].join('\n')).join('\n\n');
  const sources = evidence.map((item) => (
    `- [${item.evidence_id}](${item.source_url}) — ${item.platform}; ${item.evidence_limitations.join(' ')}`
  )).join('\n');
  return [
    '# Internships.com marketing brief',
    '',
    `- Objective: ${input.objective}`,
    `- Audience: ${input.audience}`,
    `- Platform: ${platformLabel(input.platform)}`,
    `- Topic: ${input.topic}`,
    `- Index version: ${indexVersion}`,
    '',
    '## Strategy',
    '',
    brief.summary,
    '',
    `Audience tension: ${brief.audience_tension}`,
    '',
    '## Concepts',
    '',
    concepts,
    '',
    '## Controlled experiment',
    '',
    `- Hypothesis: ${brief.experiment.hypothesis}`,
    `- Control: ${brief.experiment.control}`,
    `- Variants: ${brief.experiment.variants.join('; ')}`,
    `- Primary metrics: ${brief.experiment.primary_metrics.join(', ')}`,
    `- Checkpoints: ${brief.experiment.checkpoints.join(', ')}`,
    '',
    '## Evidence',
    '',
    sources,
    '',
    '## Safety boundary',
    '',
    'Draft only. Nothing was persisted, enqueued, rendered, sent to a creative provider, or published.',
  ].join('\n');
}

function platformLabel(platform: SocialPlatform | null): string {
  if (!platform) return 'Cross-source';
  return {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube_shorts: 'YouTube Shorts',
  }[platform];
}

function evidenceLabel(item: AgentEvidence): string {
  if (item.evidence_type === 'official_source') return 'Official source';
  if (item.evidence_type === 'audience_theme') return 'Audience theme';
  if (item.evidence_type === 'owned_aggregate') return 'Owned aggregate';
  return `${platformLabel(item.platform)} record`;
}

function isCachedResearchAnswer(value: ResearchAnswer | null, indexVersion: string): value is ResearchAnswer {
  return Boolean(
    value
    && value.index_version === indexVersion
    && value.mode === 'generated'
    && typeof value.answer === 'string'
    && Array.isArray(value.evidence)
    && Array.isArray(value.findings),
  );
}
