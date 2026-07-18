import { GeminiRequestError } from './gemini.js';

export const RESEARCH_FAILURE_STAGES = [
  'state_cache_read',
  'state_rate_limit',
  'gemini_embed',
  'gemini_generate',
  'output_validation',
  'state_cache_write',
] as const;

export type ResearchFailureStage = typeof RESEARCH_FAILURE_STAGES[number];

export interface ResearchFailureDiagnostic {
  event: 'viralbench.agent_failure';
  operation: 'research';
  stage: ResearchFailureStage;
  failure_class: 'state_unavailable' | 'gemini_http' | 'validation_rejected' | 'unexpected';
  model?: 'gemini-3.1-flash-lite';
  provider_status?: number;
  retryable?: boolean;
}

export type AgentDiagnosticLogger = (diagnostic: ResearchFailureDiagnostic) => void;

export function reportResearchFailure(
  logger: AgentDiagnosticLogger | null,
  stage: ResearchFailureStage,
  error: unknown,
): void {
  if (!logger) return;

  const diagnostic: ResearchFailureDiagnostic = {
    event: 'viralbench.agent_failure',
    operation: 'research',
    stage,
    failure_class: classifyFailure(stage, error),
    ...(stage.startsWith('gemini_') ? { model: 'gemini-3.1-flash-lite' as const } : {}),
  };
  if (error instanceof GeminiRequestError) {
    diagnostic.provider_status = error.status;
    diagnostic.retryable = error.retryable;
  }
  logger(diagnostic);
}

export const logResearchFailure: AgentDiagnosticLogger = (diagnostic) => {
  // Deliberately log only the allowlisted diagnostic shape. Never include prompts,
  // evidence, cache keys, provider bodies, error messages, or environment values.
  console.error(JSON.stringify(diagnostic));
};

function classifyFailure(
  stage: ResearchFailureStage,
  error: unknown,
): ResearchFailureDiagnostic['failure_class'] {
  if (stage.startsWith('state_')) return 'state_unavailable';
  if (stage === 'output_validation') return 'validation_rejected';
  if (error instanceof GeminiRequestError) return 'gemini_http';
  return 'unexpected';
}
