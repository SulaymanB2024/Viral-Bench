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

export type ResearchValidationRule =
  | 'audience_effect'
  | 'audience_state_change'
  | 'audience_theme_scope'
  | 'citation_scope'
  | 'copied_source'
  | 'cross_platform_ranking'
  | 'effectiveness_claim'
  | 'outcome_likelihood'
  | 'performance_attribution'
  | 'repeated_pattern_scope'
  | 'schema_contract'
  | 'unsupported_causality'
  | 'unsupported_generalization';

export interface ResearchFailureDiagnostic {
  event: 'viralbench.agent_failure';
  operation: 'research';
  stage: ResearchFailureStage;
  failure_class: 'state_unavailable' | 'gemini_http' | 'validation_rejected' | 'unexpected';
  model?: 'gemini-3.1-flash-lite';
  provider_status?: number;
  retryable?: boolean;
  validation_rule?: ResearchValidationRule;
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
  if (stage === 'output_validation') {
    diagnostic.validation_rule = classifyValidationRule(error);
  }
  logger(diagnostic);
}

function classifyValidationRule(error: unknown): ResearchValidationRule {
  const message = error instanceof Error ? error.message : '';
  if (/causal or guaranteed/i.test(message)) return 'unsupported_causality';
  if (/effectiveness or conversion/i.test(message)) return 'effectiveness_claim';
  if (/frequency or audience-preference/i.test(message)) return 'unsupported_generalization';
  if (/audience-state change/i.test(message)) return 'audience_state_change';
  if (/audience effect/i.test(message)) return 'audience_effect';
  if (/outcome-likelihood/i.test(message)) return 'outcome_likelihood';
  if (/cohort standing/i.test(message)) return 'performance_attribution';
  if (/cross-platform raw-view/i.test(message)) return 'cross_platform_ranking';
  if (/long source phrase/i.test(message)) return 'copied_source';
  if (/outside the retrieval package/i.test(message)) return 'citation_scope';
  if (/repeated pattern/i.test(message)) return 'repeated_pattern_scope';
  if (/measured population claim/i.test(message)) return 'audience_theme_scope';
  return 'schema_contract';
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
