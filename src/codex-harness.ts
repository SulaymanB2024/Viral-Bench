import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  type CreativeJobManifest,
  type CreativeProviderName,
  loadCreativeJobManifest,
  scanRepositoryForSecrets,
} from '../packages/creative/job_schema';
import type { LocalRenderResult } from '../packages/creative/local_renderer';
import { runCreativeProvider } from '../packages/creative/provider_router';
import {
  mergeEnvWithFile,
  type EnvMap,
  type LoadedEnvFile,
  type MergedEnvFileReport,
} from './env-loader';
import {
  loadBrowserCapture,
  type BrowserCapture,
} from './browser-capture';
import {
  latestMetricSnapshot,
  loadPostMetricsStore,
} from './post-metrics';
import {
  loadProviderRequestManifest,
  runProviderDryRun,
  type ProviderDryRunResult,
  type ProviderRequestManifest,
} from './provider-workflow';

export const DEFAULT_HARNESS_RUNS_DIR = path.join(process.cwd(), '.ops', 'harness', 'runs');
export const DEFAULT_SOURCE_PACKAGES_DIR = path.join(process.cwd(), '.ops', 'harness', 'source_packages');

export interface HarnessCredentialProfile {
  openai_api_key_available: boolean;
  gemini_api_key_available: boolean;
  lightreel_api_key_available: boolean;
  scrape_creators_api_key_available: boolean;
  doublespeed_tokens_available: boolean;
}

export interface HarnessCapabilityProfile {
  autonomy_level: 'local_only' | 'browser_enabled' | 'provider_enabled' | 'publishing_enabled';
  gates: {
    allow_paid_generation: boolean;
    allow_browser_ui: boolean;
    allow_social_publishing: boolean;
  };
  credentials: HarnessCredentialProfile;
  credential_policy: 'available_flags_only_no_secret_values';
}

export interface HarnessEnvFileSummary {
  path: string;
  absolute_path: string;
  exists: boolean;
  loaded_key_count: number;
  keys: string[];
  ignored_line_count: number;
  warnings: string[];
}

export interface HarnessCapabilityEnvKey {
  key: string;
  present: boolean;
  source: 'process_env' | 'env_file' | 'both' | 'none';
  used_for: string[];
}

export interface HarnessCapabilityEnvPlan {
  created_at: string;
  root_dir: string;
  env_file: HarnessEnvFileSummary | null;
  key_count: number;
  keys: HarnessCapabilityEnvKey[];
  capability_profile: HarnessCapabilityProfile;
  provider_live_ready_request_count: number;
  secret_policy: HarnessCapabilityProfile['credential_policy'];
  warnings: string[];
  next_commands: string[];
}

export interface HarnessCredentialCoverageKey {
  key: string;
  present: boolean;
  source: 'process_env' | 'env_file' | 'both' | 'local_file' | 'none';
  provider_or_surface: string;
  current_binding: 'live_provider' | 'provider_handoff' | 'research_or_legacy' | 'local_token_file' | 'unbound';
  status: 'usable_now' | 'present_but_gated' | 'present_but_unimplemented' | 'present_but_unbound' | 'missing_required' | 'not_configured';
  required_by_request_ids: string[];
  ready_request_ids: string[];
  blocked_request_ids: string[];
  blockers: string[];
}

export interface HarnessCredentialCoverageMap {
  created_at: string;
  root_dir: string;
  env_file: HarnessEnvFileSummary | null;
  credential_policy: HarnessCapabilityProfile['credential_policy'];
  gates: HarnessCapabilityProfile['gates'];
  key_count: number;
  keys: HarnessCredentialCoverageKey[];
  summary: {
    usable_now_count: number;
    missing_required_count: number;
    present_but_unbound_count: number;
    present_but_gated_count: number;
    present_but_unimplemented_count: number;
  };
  next_commands: string[];
}

export interface HarnessProviderRoute {
  request_id: string;
  provider: CreativeProviderName;
  request_path: string;
  job_id: string;
  route_type: 'live_provider' | 'provider_handoff' | 'browser_manual' | 'unsupported_live_provider';
  status: 'ready_for_live' | 'ready_for_handoff' | 'needs_local_input' | 'needs_credential' | 'needs_gate' | 'needs_adapter' | 'blocked';
  score: number;
  ready_for_provider_handoff: boolean;
  ready_for_live_request: boolean;
  existing_handoff_count: number;
  latest_handoff_path: string | null;
  latest_handoff_created_at: string | null;
  would_api_key_help: boolean;
  credential_available: boolean;
  recommended_credentials: string[];
  required_env: string[];
  blockers: string[];
  next_action: string;
  safe_probe_commands: string[];
  activation_commands: string[];
  writes: string[];
}

export interface HarnessProviderRouteMap {
  created_at: string;
  root_dir: string;
  credential_policy: HarnessCapabilityProfile['credential_policy'];
  capability_profile: HarnessCapabilityProfile;
  summary: {
    request_count: number;
    live_ready_count: number;
    handoff_ready_count: number;
    existing_handoff_count: number;
    handoff_missing_count: number;
    api_key_would_help_count: number;
    recommended_route_id: string | null;
    recommended_credential: string | null;
    external_calls_made: 0;
  };
  routes: HarnessProviderRoute[];
  next_commands: string[];
}

export interface HarnessProviderActivationRequest {
  request_id: string;
  provider: CreativeProviderName;
  request_path: string;
  job_id: string;
  route_type: HarnessProviderRoute['route_type'];
  route_status: HarnessProviderRoute['status'];
  activation_status: 'ready_for_live' | 'needs_api_key' | 'needs_gate' | 'needs_policy' | 'needs_adapter' | 'needs_local_input' | 'handoff_only' | 'blocked';
  would_api_key_help: boolean;
  credential_available: boolean;
  missing_credentials: string[];
  required_env: string[];
  missing_env: string[];
  policy_blockers: string[];
  adapter_blockers: string[];
  local_input_blockers: string[];
  live_blockers: string[];
  existing_handoff_count: number;
  latest_handoff_path: string | null;
  activation_command: string | null;
  dry_run_command: string;
  handoff_command: string | null;
  safe_probe_commands: string[];
  verification_commands: string[];
  external_call_boundary: {
    external_calls_made: 0;
    live_external_call_allowed: boolean;
    requires_explicit_command: true;
    writes: string[];
  };
  next_action: string;
}

export interface HarnessProviderActivationPlan {
  created_at: string;
  root_dir: string;
  env_file: HarnessEnvFileSummary | null;
  credential_policy: HarnessCapabilityProfile['credential_policy'];
  gates: HarnessCapabilityProfile['gates'];
  summary: {
    request_count: number;
    ready_for_live_count: number;
    api_key_unlockable_count: number;
    missing_credential_count: number;
    missing_env_count: number;
    needs_adapter_count: number;
    handoff_only_count: number;
    existing_handoff_count: number;
    recommended_request_id: string | null;
    recommended_credential: string | null;
    external_calls_made: 0;
  };
  credential_setup: {
    secret_policy: HarnessCapabilityProfile['credential_policy'];
    env_file_path: string | null;
    required_missing_keys: string[];
    required_env_flags: string[];
    confirmation_required_before_external_call: true;
  };
  requests: HarnessProviderActivationRequest[];
  next_commands: string[];
}

export interface HarnessBrowserCaptureEntry {
  path: string;
  bucket: 'sample' | 'raw' | 'reviewed' | 'rejected';
  valid: boolean;
  capture_id: string | null;
  source_name: string | null;
  source_url: string | null;
  captured_at: string | null;
  niche: string | null;
  platform: string | null;
  observed_format: string | null;
  human_review_status: BrowserCapture['human_review_status'] | null;
  ingest_ready: boolean;
  validation_command: string;
  ingest_command: string | null;
  blockers: string[];
  error: string | null;
}

export interface HarnessBrowserResearchPlan {
  created_at: string;
  root_dir: string;
  env_file: HarnessEnvFileSummary | null;
  gates: {
    allow_browser_ui: boolean;
    required_env: string[];
    missing_env: string[];
  };
  operating_docs: {
    mcp_setup_path: string | null;
    allowed_tasks_path: string | null;
    blocked_tasks_path: string | null;
    protocol_path: string | null;
    capture_template_path: string | null;
    schema_path: string | null;
  };
  browser_request: {
    request_id: string | null;
    request_path: string | null;
    policy_allows_browser_ui: boolean;
    ready_for_provider_handoff: boolean;
    blockers: string[];
  };
  summary: {
    capture_count: number;
    valid_capture_count: number;
    approved_capture_count: number;
    pending_review_capture_count: number;
    rejected_capture_count: number;
    invalid_capture_count: number;
    ingest_ready_count: number;
    raw_capture_count: number;
    reviewed_capture_count: number;
    sample_capture_count: number;
    recommended_capture_path: string | null;
    external_calls_made: 0;
  };
  captures: HarnessBrowserCaptureEntry[];
  next_commands: string[];
  safety_notes: string[];
}

export interface HarnessCapabilityPlanLane {
  id: 'local' | 'provider' | 'browser' | 'publishing';
  status: 'ready' | 'blocked' | 'needs_gate' | 'needs_credential' | 'human_boundary';
  evidence: string[];
  next_commands: string[];
}

export interface HarnessProviderRequestPlan {
  request_id: string;
  provider: CreativeProviderName;
  provider_mode: ProviderRequestManifest['provider_mode'];
  path: string;
  status: ProviderRequestManifest['status'];
  dry_run_status: ProviderDryRunResult['status'];
  input_assets_ready: boolean;
  missing_input_assets: string[];
  missing_prompt: string | null;
  prepare_command: string | null;
  credential_available: boolean;
  required_env: string[];
  missing_gates: string[];
  policy_allows_requested_capability: boolean;
  live_external_call_allowed: boolean;
  next_action: string;
}

export interface HarnessCapabilityPlan {
  created_at: string;
  root_dir: string;
  capability_profile: HarnessCapabilityProfile;
  lanes: HarnessCapabilityPlanLane[];
  provider_requests: HarnessProviderRequestPlan[];
  browser: {
    allowed_tasks_path: string | null;
    blocked_tasks_path: string | null;
    reviewed_capture_count: number;
    raw_capture_count: number;
  };
  publishing: {
    launch_queue_path: string | null;
    jobs_allowing_social_publishing: string[];
    approved_jobs_ready_for_posting: string[];
  };
}

export interface HarnessCapabilityUnlockRequest {
  request_id: string;
  provider: CreativeProviderName;
  request_path: string;
  ready_for_provider_handoff: boolean;
  ready_for_live_request: boolean;
  live_blockers: string[];
}

export interface HarnessCapabilityUnlockJob {
  job_id: string;
  manual_handoff_ready: boolean;
  autonomous_publish_ready: boolean;
  blockers: string[];
}

export interface HarnessCapabilityUnlockLane {
  id: 'local' | 'paid_provider_generation' | 'browser_research' | 'social_publishing';
  status: 'ready' | 'locked' | 'partially_ready' | 'human_boundary';
  current_enabled: boolean;
  required_env: string[];
  required_credentials: string[];
  policy_preconditions: string[];
  related_requests: HarnessCapabilityUnlockRequest[];
  related_jobs: HarnessCapabilityUnlockJob[];
  safe_probe_commands: string[];
  activation_commands: string[];
  verification_commands: string[];
  blockers: string[];
}

export interface HarnessCapabilityUnlockMap {
  created_at: string;
  root_dir: string;
  capability_profile: HarnessCapabilityProfile;
  credential_policy: HarnessCapabilityProfile['credential_policy'];
  lanes: HarnessCapabilityUnlockLane[];
  next_commands: string[];
}

export interface HarnessProviderPreflightAsset {
  role: 'prompt' | 'input_asset' | 'declared_output';
  path: string;
  absolute_path: string;
  exists: boolean;
  kind: HarnessArtifactInventoryItem['kind'] | ProviderRequestManifest['output_requirements']['files'][number]['kind'];
  description?: string;
}

export interface HarnessProviderPreflight {
  request_id: string;
  request_path: string;
  provider: CreativeProviderName;
  provider_mode: ProviderRequestManifest['provider_mode'];
  status: ProviderRequestManifest['status'];
  job_id: string;
  job_path: string;
  job_exists: boolean;
  prompt: HarnessProviderPreflightAsset;
  input_assets: HarnessProviderPreflightAsset[];
  declared_outputs: HarnessProviderPreflightAsset[];
  missing_prompt: string | null;
  missing_input_assets: string[];
  dry_run: ProviderDryRunResult;
  renderable_job_available: boolean;
  suggested_prepare_command: string | null;
  ready_for_dry_run: boolean;
  ready_for_provider_handoff: boolean;
  ready_for_live_request: boolean;
  live_blockers: string[];
  next_action: string;
}

export interface HarnessProviderPreflightReport {
  created_at: string;
  root_dir: string;
  request_count: number;
  prepared_request_count: number;
  preflights: HarnessProviderPreflight[];
}

export interface HarnessProviderHandoffAsset {
  role: 'prompt' | 'input_asset';
  path: string;
  absolute_path: string;
  exists: boolean;
  kind: HarnessProviderPreflightAsset['kind'];
  size_bytes: number | null;
  sha256: string | null;
  text_excerpt?: string;
  truncated?: boolean;
}

export interface HarnessProviderHandoffPacket {
  created_at: string;
  root_dir: string;
  packet_dir: string;
  manifest_path: string;
  request_id: string;
  provider: CreativeProviderName;
  job_id: string;
  request_path: string;
  request: ProviderRequestManifest;
  job_path: string;
  job_manifest: CreativeJobManifest | null;
  capability_profile: HarnessCapabilityProfile;
  provider_preflight: HarnessProviderPreflight;
  prompt: HarnessProviderHandoffAsset;
  input_assets: HarnessProviderHandoffAsset[];
  declared_outputs: HarnessProviderPreflightAsset[];
  external_call_policy: {
    external_calls_made: 0;
    live_external_call_allowed: boolean;
    credential_policy: HarnessCapabilityProfile['credential_policy'];
    live_blockers: string[];
  };
  files: {
    manifest_path: string;
    request_copy_path: string;
    job_copy_path: string | null;
    prompt_copy_path: string | null;
    asset_manifest_path: string;
  };
  next_commands: string[];
}

interface HarnessProviderHandoffHistoryEntry {
  created_at: string | null;
  packet_dir: string;
  manifest_path: string;
  request_id: string;
  provider: CreativeProviderName | null;
  job_id: string | null;
  request_path: string | null;
}

export interface CodexPrimitive {
  id: string;
  kind: 'auto' | 'doctor' | 'reproducibility' | 'inspect' | 'rank' | 'context' | 'trend' | 'creative' | 'provider' | 'browser' | 'metrics' | 'publish';
  command: string;
  purpose: string;
  writes: string[];
  required_gates: string[];
  autonomy: 'safe_default' | 'capability_gated' | 'human_boundary';
}

export interface HarnessInformationSource {
  id: string;
  kind: 'source' | 'schema' | 'test' | 'job' | 'provider_request' | 'ops_doc' | 'skill' | 'report';
  path: string;
  role: string;
}

export interface HarnessJobRanking {
  rank: number;
  job_id: string;
  path: string;
  score: number;
  runnable_now: boolean;
  reasons: string[];
  blockers: string[];
}

export interface HarnessJobMatrixProviderRequest {
  request_id: string;
  provider: CreativeProviderName;
  path: string;
  status: ProviderRequestManifest['status'];
  ready_for_provider_handoff: boolean;
  ready_for_live_request: boolean;
  missing_input_assets: string[];
  live_blockers: string[];
}

export interface HarnessJobMatrixRow {
  job_id: string;
  path: string;
  rank: number | null;
  score: number | null;
  runnable_now: boolean;
  approval_state: CreativeJobManifest['approval_status']['state'];
  provider_policy: {
    approved_providers: CreativeProviderName[];
    allow_paid_generation: boolean;
    allow_browser_ui: boolean;
    allow_social_publishing: boolean;
  };
  render_package: {
    path: string;
    exists: boolean;
    manifest_exists: boolean;
    caption_exists: boolean;
    slide_count: number;
  };
  provider_requests: HarnessJobMatrixProviderRequest[];
  launch_queue: {
    mentioned: boolean;
    order: number | null;
  };
  metrics: {
    record_count: number;
    latest_snapshot_at: string | null;
  };
  blockers: string[];
  reasons: string[];
  next_commands: string[];
}

export interface HarnessJobMatrix {
  created_at: string;
  root_dir: string;
  job_count: number;
  rendered_job_count: number;
  provider_linked_job_count: number;
  launch_queue_job_count: number;
  metrics_job_count: number;
  jobs: HarnessJobMatrixRow[];
  next_commands: string[];
}

export interface HarnessEvidenceSourceInput {
  kind: CreativeJobManifest['source_inputs'][number]['kind'];
  label: string;
  value_present: boolean;
  path: string | null;
  path_exists: boolean | null;
  url: string | null;
  captured_at: string | null;
  notes_present: boolean;
}

export interface HarnessEvidenceTrendExample {
  id: string;
  source_name: string;
  platform: string;
  format: string;
  hook: string;
  source_url: string;
  captured_at: string;
}

export interface HarnessClaimSafety {
  disclaimer_present: boolean;
  range_language_present: boolean;
  exact_value_claim_present: boolean;
  guarantee_claim_present: boolean;
  comparison_language_present: boolean;
  risk_language_present: boolean;
  manual_review_required: boolean;
  blockers: string[];
}

export interface HarnessJobEvidenceRow {
  job_id: string;
  path: string;
  niche: string;
  content_type: string;
  source_inputs: HarnessEvidenceSourceInput[];
  trend_examples: HarnessEvidenceTrendExample[];
  evidence_counts: {
    source_input_count: number;
    trend_example_count: number;
    unique_source_url_count: number;
    source_path_count: number;
    existing_source_path_count: number;
  };
  manual_boundary_declared: boolean;
  rendered_evidence: {
    package_path: string;
    manifest_exists: boolean;
    trend_examples_exists: boolean;
    research_notes_exists: boolean;
    qa_checklist_exists: boolean;
    approval_exists: boolean;
  };
  claim_safety: HarnessClaimSafety;
  next_commands: string[];
}

export interface HarnessEvidenceMap {
  created_at: string;
  root_dir: string;
  job_count: number;
  jobs_with_trend_examples: number;
  jobs_with_manual_boundary: number;
  jobs_with_rendered_evidence: number;
  jobs_with_claim_blockers: number;
  jobs: HarnessJobEvidenceRow[];
  next_commands: string[];
}

export interface HarnessLaunchDocStatus {
  path: string;
  exists: boolean;
}

export interface HarnessLaunchMapRequiredFile {
  role: 'manifest' | 'caption' | 'hashtags' | 'posting_notes' | 'qa_checklist' | 'approval' | 'slides';
  path: string;
  exists: boolean;
  count?: number;
  required_count?: number;
}

export interface HarnessLaunchMapCopyStatus {
  section_present: boolean;
  tiktok_caption: boolean;
  instagram_caption: boolean;
  youtube_title: boolean;
  youtube_description: boolean;
  hashtags: boolean;
  first_comment: boolean;
  posting_checklist: boolean;
  metric_schedule: boolean;
}

export interface HarnessLaunchMapJob {
  job_id: string;
  order: number | null;
  job_path: string;
  package_path: string;
  launch_section_present: boolean;
  approval_state: CreativeJobManifest['approval_status']['state'];
  job_allows_social_publishing: boolean;
  generated_asset_count: number;
  approved_generated_asset_count: number;
  required_files: HarnessLaunchMapRequiredFile[];
  launch_copy: HarnessLaunchMapCopyStatus;
  metrics: {
    record_count: number;
    latest_snapshot_at: string | null;
  };
  manual_handoff_ready: boolean;
  autonomous_publish_ready: boolean;
  blockers: string[];
  next_commands: string[];
}

export interface HarnessLaunchMap {
  created_at: string;
  root_dir: string;
  launch_docs: HarnessLaunchDocStatus[];
  queued_job_count: number;
  manual_handoff_ready_job_count: number;
  autonomous_publish_ready_job_count: number;
  metrics_job_count: number;
  jobs: HarnessLaunchMapJob[];
  next_commands: string[];
}

export interface HarnessPublishingHandoffJob {
  job_id: string;
  launch_order: number | null;
  job_path: string;
  rendered_package_path: string;
  manifest_path: string | null;
  caption_path: string | null;
  hashtags_path: string | null;
  posting_notes_path: string | null;
  qa_checklist_path: string | null;
  approval_path: string | null;
  slides_path: string | null;
  approval_state: CreativeJobManifest['approval_status']['state'];
  job_allows_social_publishing: boolean;
  generated_asset_count: number;
  approved_generated_asset_count: number;
  manual_handoff_ready: boolean;
  autonomous_publish_ready: boolean;
  blockers: string[];
  manual_review_commands: string[];
  manual_post_boundary: {
    external_calls_made: 0;
    auto_post_allowed: false;
    manual_post_allowed_after_confirmation: boolean;
    requires_account_owner_confirmation: true;
    requires_human_approval: true;
    requires_approved_generated_assets: true;
    writes: [];
    blocked_by: string[];
  };
  metrics_commands: string[];
  next_action: string;
}

export interface HarnessPublishingHandoffPlan {
  created_at: string;
  root_dir: string;
  env_file: HarnessEnvFileSummary | null;
  gates: {
    allow_social_publishing: boolean;
    required_env: string[];
    missing_env: string[];
  };
  operating_docs: {
    account_setup_checklist_path: string | null;
    socials_path: string | null;
    launch_checklist_path: string | null;
    launch_queue_path: string | null;
    manual_launch_packet_path: string | null;
    posting_qa_checklist_path: string | null;
    metrics_tracking_template_path: string | null;
    first_10_posts_path: string | null;
    launch_calendar_path: string | null;
    dm_response_templates_path: string | null;
    pinned_comment_templates_path: string | null;
  };
  summary: {
    job_count: number;
    queued_job_count: number;
    manual_handoff_ready_job_count: number;
    autonomous_publish_ready_job_count: number;
    blocked_job_count: number;
    metrics_job_count: number;
    recommended_job_id: string | null;
    external_calls_made: 0;
  };
  jobs: HarnessPublishingHandoffJob[];
  next_commands: string[];
  safety_notes: string[];
}

export interface HarnessVerificationChangedFile {
  path: string;
  status: 'modified_or_staged' | 'untracked';
  source_of_truth: boolean;
  role: string;
  validation_target_ids: string[];
}

export interface HarnessVerificationTarget {
  id: string;
  reason: string;
  commands: string[];
  matched_paths: string[];
}

export interface HarnessVerificationMap {
  created_at: string;
  root_dir: string;
  dirty: boolean;
  changed_file_count: number;
  changed_source_of_truth_count: number;
  changed_files: HarnessVerificationChangedFile[];
  validation_targets: HarnessVerificationTarget[];
  recommended_commands: string[];
  stage_source_command: string | null;
  notes: string[];
}

export interface HarnessContextPackSource {
  id: string;
  kind: HarnessInformationSource['kind'];
  path: string;
  role: string;
  size_bytes: number;
  sha256: string;
  excerpt: string;
  truncated: boolean;
}

export interface HarnessContextPack {
  created_at: string;
  root_dir: string;
  max_files: number;
  max_chars_per_file: number;
  source_count: number;
  sources: HarnessContextPackSource[];
}

export interface HarnessArtifactInventoryItem {
  path: string;
  relative_path: string;
  kind: 'json' | 'markdown' | 'text' | 'image' | 'other';
  size_bytes: number;
  sha256: string;
}

export interface HarnessArtifactInventory {
  root_dir: string;
  created_at: string;
  artifact_count: number;
  artifacts: HarnessArtifactInventoryItem[];
}

export interface HarnessBlocker {
  id: string;
  severity: 'blocker' | 'high' | 'medium' | 'low';
  status: 'open' | 'resolved';
  evidence: string[];
  next_action: string;
}

export interface HarnessBlockerLedger {
  created_at: string;
  root_dir: string;
  blockers: HarnessBlocker[];
}

export interface HarnessResumeReport {
  run_id: string;
  run_dir: string;
  status: HarnessRunRecord['status'];
  selected_job: HarnessRunRecord['selected_job'];
  missing_artifacts: string[];
  artifact_inventory_path: string;
  blocker_ledger_path: string;
  reproducibility_manifest_path?: string;
  autonomy_audit_path?: string;
  next_commands: string[];
}

export interface HarnessRunBriefArtifact {
  role: string;
  path: string;
  absolute_path: string;
  exists: boolean;
  kind: HarnessArtifactInventoryItem['kind'];
  size_bytes: number | null;
  sha256: string | null;
  excerpt?: string;
  truncated?: boolean;
}

export interface HarnessRunBrief {
  created_at: string;
  root_dir: string;
  run_dir: string | null;
  run_id: string | null;
  status: HarnessRunRecord['status'] | 'no_run' | 'unreadable';
  selected_job: HarnessRunRecord['selected_job'] | null;
  missing_artifacts: string[];
  stage_status_counts: Record<HarnessStage['status'], number>;
  stages: HarnessStage[];
  provider_gate_summary: {
    request_count: number;
    blocked_count: number;
    external_calls_made: number;
    results: ProviderDryRunResult[];
  };
  next_actions: string[];
  artifacts: HarnessRunBriefArtifact[];
  resume_commands: string[];
  next_commands: string[];
  error: string | null;
}

export interface HarnessRunHistoryEntry {
  run_id: string;
  run_dir: string;
  created_at: string | null;
  goal: string | null;
  status: HarnessRunRecord['status'] | 'unreadable';
  selected_job: HarnessRunRecord['selected_job'] | null;
  artifact_count: number | null;
  missing_artifact_count: number | null;
  missing_artifacts: string[];
  provider_dry_run_count: number | null;
  provider_blocked_count: number | null;
  external_calls_made: number | null;
  stage_status_counts: Record<HarnessStage['status'], number>;
  next_actions: string[];
  resume_commands: string[];
  error: string | null;
}

export interface HarnessRunHistory {
  created_at: string;
  root_dir: string;
  runs_dir: string;
  exists: boolean;
  run_count: number;
  returned_count: number;
  limit: number;
  runs: HarnessRunHistoryEntry[];
  next_commands: string[];
}

export interface HarnessRepoStatus {
  root_dir: string;
  git_root: string | null;
  branch: string | null;
  upstream: string | null;
  remotes: string[];
  is_git_repo: boolean;
  dirty: boolean;
  modified: string[];
  modified_count: number;
  modified_source_of_truth_count: number;
  modified_source_of_truth: string[];
  untracked: string[];
  untracked_count: number;
  untracked_source_of_truth_count: number;
  untracked_source_of_truth: string[];
}

export interface HarnessReproducibilityFile {
  path: string;
  status: 'tracked_or_modified' | 'untracked';
  role: string;
}

export interface HarnessReproducibilityManifest {
  created_at: string;
  root_dir: string;
  repo_status: HarnessRepoStatus;
  source_of_truth: {
    file_count: number;
    tracked_or_modified_count: number;
    modified_count: number;
    untracked_count: number;
    dirty_count: number;
    files: HarnessReproducibilityFile[];
  };
  generated_artifacts: {
    ignored_or_runtime_paths: string[];
    notes: string[];
  };
  commands: {
    inspect: string[];
    stage_source_of_truth: string | null;
    verify: string[];
  };
}

export interface HarnessStageSourceReport {
  created_at: string;
  root_dir: string;
  dry_run: boolean;
  applied: boolean;
  before: {
    modified_source_of_truth_count: number;
    untracked_source_of_truth_count: number;
    dirty_source_of_truth_count: number;
  };
  after?: {
    modified_source_of_truth_count: number;
    untracked_source_of_truth_count: number;
    dirty_source_of_truth_count: number;
  };
  staged_paths: string[];
  excluded_generated_paths: string[];
  command: string | null;
  warnings: string[];
}

export interface HarnessSourcePackageFile {
  source_path: string;
  package_path: string;
  role: string;
  size_bytes: number;
  sha256: string;
}

export interface HarnessSourcePackageReport {
  created_at: string;
  root_dir: string;
  package_dir: string;
  files_dir: string;
  manifest_path: string;
  reproducibility_manifest_path: string;
  source_file_count: number;
  dirty_source_file_count: number;
  aggregate_sha256: string;
  files: HarnessSourcePackageFile[];
  excluded_generated_paths: string[];
  verify_command: string;
}

export interface HarnessSourcePackageVerification {
  package_dir: string;
  manifest_path: string;
  ok: boolean;
  source_file_count: number;
  aggregate_sha256: string | null;
  missing_files: string[];
  hash_mismatches: Array<{ path: string; expected_sha256: string; actual_sha256: string }>;
}

export interface HarnessAutonomyAuditCriterion {
  id: string;
  status: 'passed' | 'open' | 'blocked';
  evidence: string[];
  next_action: string;
}

export interface HarnessAutonomyAudit {
  created_at: string;
  goal: string;
  root_dir: string;
  summary_status: 'local_autonomy_ready' | 'needs_reproducibility' | 'needs_capability' | 'blocked';
  criteria: HarnessAutonomyAuditCriterion[];
  next_commands: string[];
}

export interface HarnessGoalCompletionRequirement {
  id: string;
  requirement: string;
  status: 'passed' | 'open' | 'blocked';
  evidence: string[];
  blockers: string[];
  proof_commands: string[];
  next_action: string;
}

export interface HarnessGoalCompletionAudit {
  created_at: string;
  goal: string;
  root_dir: string;
  summary_status: 'achieved' | 'incomplete' | 'blocked';
  can_mark_goal_complete: boolean;
  requirements: HarnessGoalCompletionRequirement[];
  next_commands: string[];
}

export interface HarnessDoctorReport {
  created_at: string;
  root_dir: string;
  repo_status: HarnessRepoStatus;
  reproducibility_manifest: HarnessReproducibilityManifest;
  autonomy_audit: HarnessAutonomyAudit;
  goal_completion_audit: HarnessGoalCompletionAudit;
  capability_plan: HarnessCapabilityPlan;
  capability_unlock_map: HarnessCapabilityUnlockMap;
  credential_coverage: HarnessCredentialCoverageMap;
  provider_route_map: HarnessProviderRouteMap;
  provider_activation_plan: HarnessProviderActivationPlan;
  browser_research_plan: HarnessBrowserResearchPlan;
  publishing_handoff_plan: HarnessPublishingHandoffPlan;
  capability_profile: HarnessCapabilityProfile;
  blocker_ledger: HarnessBlockerLedger;
  information_surface: {
    source_count: number;
    by_kind: Record<HarnessInformationSource['kind'], number>;
  };
  incoming_job_count: number;
  provider_request_count: number;
  provider_preflight: HarnessProviderPreflightReport;
  latest_run: HarnessResumeReport | null;
  latest_run_brief: HarnessRunBrief;
  run_history: HarnessRunHistory;
  secret_scan: {
    status: 'clear' | 'blocked';
    finding_count: number;
  };
  readiness: {
    local_autonomy: boolean;
    browser_autonomy: boolean;
    provider_autonomy: boolean;
    publishing_autonomy: boolean;
  };
  recommended_commands: string[];
}

export interface HarnessAutonomyPlanStep {
  id: string;
  priority: number;
  lane: 'reproducibility' | 'local' | 'provider' | 'browser' | 'publishing' | 'information' | 'verification';
  status: 'ready' | 'blocked' | 'needs_capability' | 'human_boundary';
  safe_to_run_now: boolean;
  command: string | null;
  reason: string;
  evidence: string[];
  required_gates: string[];
  writes: string[];
}

export interface HarnessAutonomyPlan {
  created_at: string;
  goal: string;
  root_dir: string;
  summary_status: HarnessAutonomyAudit['summary_status'];
  selected_next_step: HarnessAutonomyPlanStep | null;
  steps: HarnessAutonomyPlanStep[];
  readiness: HarnessDoctorReport['readiness'];
  capability_profile: HarnessCapabilityProfile;
  source_of_truth_dirty_count: number;
  provider_live_ready_request_count: number;
  information_surface: HarnessDoctorReport['information_surface'];
  top_ranked_jobs: HarnessJobRanking[];
  open_blockers: HarnessBlocker[];
  command_policy: {
    safe_default_commands: string[];
    capability_gated_commands: string[];
    human_boundary_commands: string[];
    secret_policy: HarnessCapabilityProfile['credential_policy'];
  };
}

export interface HarnessDecisionSurfaceAction {
  id: string;
  queue: 'safe_now' | 'capability_gated' | 'human_boundary' | 'blocked';
  lane: HarnessAutonomyPlanStep['lane'];
  readiness_status: HarnessAutonomyPlanStep['status'];
  command: string | null;
  reason: string;
  evidence: string[];
  required_gates: string[];
  writes: string[];
  source_ids: string[];
}

export interface HarnessDecisionSurface {
  created_at: string;
  goal: string;
  root_dir: string;
  summary: {
    selected_safe_action_id: string | null;
    safe_now_count: number;
    capability_gated_count: number;
    human_boundary_count: number;
    blocked_count: number;
    can_mark_goal_complete: boolean;
    goal_summary_status: HarnessGoalCompletionAudit['summary_status'];
    autonomy_summary_status: HarnessAutonomyAudit['summary_status'];
    dirty_source_of_truth_count: number;
  };
  current_state: {
    latest_run_id: string | null;
    run_count: number;
    provider_request_count: number;
    provider_live_ready_request_count: number;
    missing_required_credential_count: number;
    manual_handoff_ready_job_count: number;
    autonomous_publish_ready_job_count: number;
  };
  selected_safe_action: HarnessDecisionSurfaceAction | null;
  queues: {
    safe_now: HarnessDecisionSurfaceAction[];
    capability_gated: HarnessDecisionSurfaceAction[];
    human_boundary: HarnessDecisionSurfaceAction[];
    blocked: HarnessDecisionSurfaceAction[];
  };
  active_blockers: HarnessBlocker[];
  next_commands: string[];
}

export interface HarnessNextActionReport {
  created_at: string;
  goal: string;
  root_dir: string;
  summary: {
    orientation_action_id: string | null;
    progress_action_id: string | null;
    capability_unlock_action_id: string | null;
    human_boundary_action_id: string | null;
    blocked_action_count: number;
    can_mark_goal_complete: boolean;
    goal_summary_status: HarnessGoalCompletionAudit['summary_status'];
    autonomy_summary_status: HarnessAutonomyAudit['summary_status'];
    dirty_source_of_truth_count: number;
  };
  current_state: HarnessDecisionSurface['current_state'];
  orientation_action: HarnessDecisionSurfaceAction | null;
  progress_action: HarnessDecisionSurfaceAction | null;
  capability_unlock_action: HarnessDecisionSurfaceAction | null;
  human_boundary_action: HarnessDecisionSurfaceAction | null;
  blocked_actions: HarnessDecisionSurfaceAction[];
  next_commands: string[];
}

export interface HarnessAutoResult {
  created_at: string;
  goal: string;
  status: HarnessRunRecord['status'];
  auto_result_path: string;
  decision: {
    action: 'ran_local_harness';
    reason: string;
    stop_reason: string;
  };
  doctor: HarnessDoctorReport;
  run: HarnessRunRecord;
  resume: HarnessResumeReport;
  next_commands: string[];
}

export interface HarnessRunOptions {
  goal: string;
  jobPath?: string;
  runId?: string;
  outDir?: string;
  env?: Record<string, string | undefined>;
  maxContextFiles?: number;
  maxContextCharsPerFile?: number;
}

export interface HarnessStage {
  name: string;
  status: 'completed' | 'skipped' | 'blocked';
  evidence: string[];
  artifacts: string[];
}

export interface HarnessRunRecord {
  run_id: string;
  goal: string;
  created_at: string;
  status: 'advanced' | 'needs_capability' | 'blocked';
  selected_job: {
    path: string;
    job_id: string;
    reason: string;
  };
  capability_profile: HarnessCapabilityProfile;
  primitives_path: string;
  capabilities_path: string;
  information_index_path: string;
  context_pack_path: string;
  job_rankings_path: string;
  evidence_map_path: string;
  launch_map_path: string;
  verification_map_path: string;
  capability_unlock_map_path: string;
  provider_route_map_path?: string;
  provider_activation_plan_path?: string;
  browser_research_plan_path?: string;
  publishing_handoff_plan_path?: string;
  reproducibility_manifest_path: string;
  autonomy_audit_path: string;
  next_action_path?: string;
  artifact_inventory_path: string;
  blocker_ledger_path: string;
  provider_preflight_path?: string;
  next_actions_path: string;
  prompt_packet_path: string;
  render_output_dir: string;
  provider_dry_runs: ProviderDryRunResult[];
  stages: HarnessStage[];
  next_actions: string[];
}

interface CliArgs {
  command: string;
  options: Record<string, string | boolean>;
}

export function buildCapabilityProfile(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessCapabilityProfile {
  const gates = {
    allow_paid_generation: envEnabled(env, 'ALLOW_PAID_GENERATION'),
    allow_browser_ui: envEnabled(env, 'ALLOW_BROWSER_UI'),
    allow_social_publishing: envEnabled(env, 'ALLOW_SOCIAL_PUBLISHING'),
  };
  const credentials: HarnessCredentialProfile = {
    openai_api_key_available: Boolean(nonEmpty(env.OPENAI_API_KEY)),
    gemini_api_key_available: Boolean(nonEmpty(env.GEMINI_API_KEY) || nonEmpty(env.GOOGLE_API_KEY)),
    lightreel_api_key_available: Boolean(nonEmpty(env.LIGHTREEL_API_KEY)),
    scrape_creators_api_key_available: Boolean(nonEmpty(env.SCRAPE_CREATORS_API_KEY)),
    doublespeed_tokens_available: fs.existsSync(path.join(rootDir, '.doublespeed-tokens.json')),
  };

  return {
    autonomy_level: gates.allow_social_publishing
      ? 'publishing_enabled'
      : gates.allow_paid_generation
        ? 'provider_enabled'
        : gates.allow_browser_ui
          ? 'browser_enabled'
          : 'local_only',
    gates,
    credentials,
    credential_policy: 'available_flags_only_no_secret_values',
  };
}

export function buildCapabilityEnvPlan(
  options: {
    env?: EnvMap;
    rootDir?: string;
    envFile?: string;
  } = {},
): HarnessCapabilityEnvPlan {
  const rootDir = options.rootDir ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const merged = mergeEnvWithFile(baseEnv, { envFile: options.envFile, rootDir });
  const capabilityProfile = buildCapabilityProfile(merged.effective_env, rootDir);
  const providerPreflight = preflightProviderRequests(merged.effective_env, rootDir);
  const envFileSummary = merged.env_file ? redactEnvFile(merged.env_file) : null;
  const keys = capabilityEnvKeys().map((key): HarnessCapabilityEnvKey => {
    const processPresent = Boolean(nonEmpty(baseEnv[key]));
    const filePresent = Boolean(nonEmpty(merged.env_file?.values[key]));
    return {
      key,
      present: processPresent || filePresent,
      source: processPresent && filePresent
        ? 'both'
        : processPresent
          ? 'process_env'
          : filePresent
            ? 'env_file'
            : 'none',
      used_for: capabilityEnvKeyPurpose(key),
    };
  });

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    env_file: envFileSummary,
    key_count: keys.length,
    keys,
    capability_profile: capabilityProfile,
    provider_live_ready_request_count: providerPreflight.preflights.filter((preflight) => preflight.ready_for_live_request).length,
    secret_policy: capabilityProfile.credential_policy,
    warnings: envFileSummary?.warnings ?? [],
    next_commands: [
      'npm run harness -- capability-plan --env-file .env',
      'npm run harness -- provider-preflight --env-file .env',
      'npm run harness -- provider-activation-plan --env-file .env',
      'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-live --env-file .env --file .ops/provider_requests/sample_openai_image_live_request.json --package-dir .ops/creative_jobs/rendered/scan_bike_001',
    ],
  };
}

export function buildCredentialCoverageMap(
  options: {
    env?: EnvMap;
    rootDir?: string;
    envFile?: string;
  } = {},
): HarnessCredentialCoverageMap {
  const rootDir = options.rootDir ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const merged = mergeEnvWithFile(baseEnv, { envFile: options.envFile, rootDir });
  const capabilityProfile = buildCapabilityProfile(merged.effective_env, rootDir);
  const providerPreflight = preflightProviderRequests(merged.effective_env, rootDir);
  const envFileSummary = merged.env_file ? redactEnvFile(merged.env_file) : null;
  const keys = credentialCoverageDefinitions().map((definition) => credentialCoverageForDefinition({
    definition,
    baseEnv,
    mergedEnv: merged.effective_env,
    envFile: merged.env_file,
    rootDir,
    providerPreflight,
  }));

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    env_file: envFileSummary,
    credential_policy: capabilityProfile.credential_policy,
    gates: capabilityProfile.gates,
    key_count: keys.length,
    keys,
    summary: {
      usable_now_count: keys.filter((key) => key.status === 'usable_now').length,
      missing_required_count: keys.filter((key) => key.status === 'missing_required').length,
      present_but_unbound_count: keys.filter((key) => key.status === 'present_but_unbound').length,
      present_but_gated_count: keys.filter((key) => key.status === 'present_but_gated').length,
      present_but_unimplemented_count: keys.filter((key) => key.status === 'present_but_unimplemented').length,
    },
    next_commands: [
      'npm run harness -- capability-env --env-file .env',
      'npm run harness -- credential-coverage --env-file .env',
      'npm run harness -- provider-preflight --env-file .env',
      'npm run harness -- provider-activation-plan --env-file .env',
      'npm run harness -- capability-unlock-map --env-file .env',
      'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-live --env-file .env --file .ops/provider_requests/sample_openai_image_live_request.json --package-dir .ops/creative_jobs/rendered/scan_bike_001',
    ],
  };
}

export function buildProviderRouteMap(
  options: {
    env?: EnvMap;
    rootDir?: string;
    envFile?: string;
  } = {},
): HarnessProviderRouteMap {
  const rootDir = options.rootDir ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const merged = mergeEnvWithFile(baseEnv, { envFile: options.envFile, rootDir });
  const capabilityProfile = buildCapabilityProfile(merged.effective_env, rootDir);
  const providerPreflight = preflightProviderRequests(merged.effective_env, rootDir);
  const handoffHistory = listProviderHandoffHistory(rootDir);
  const routes = providerPreflight.preflights
    .map((preflight) => providerRouteForPreflight(preflight, capabilityProfile, handoffHistory))
    .sort((a, b) => b.score - a.score || a.request_id.localeCompare(b.request_id));
  const recommendedRoute = routes.find((route) => route.would_api_key_help)
    ?? routes.find((route) => route.ready_for_live_request)
    ?? routes.find((route) => route.ready_for_provider_handoff)
    ?? routes[0]
    ?? null;

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    credential_policy: capabilityProfile.credential_policy,
    capability_profile: capabilityProfile,
    summary: {
      request_count: routes.length,
      live_ready_count: routes.filter((route) => route.ready_for_live_request).length,
      handoff_ready_count: routes.filter((route) => route.ready_for_provider_handoff).length,
      existing_handoff_count: routes.reduce((count, route) => count + route.existing_handoff_count, 0),
      handoff_missing_count: routes.filter((route) => (
        route.ready_for_provider_handoff
        && route.existing_handoff_count === 0
        && route.status !== 'needs_adapter'
      )).length,
      api_key_would_help_count: routes.filter((route) => route.would_api_key_help).length,
      recommended_route_id: recommendedRoute?.request_id ?? null,
      recommended_credential: recommendedRoute?.recommended_credentials[0] ?? null,
      external_calls_made: 0,
    },
    routes,
    next_commands: uniqueSorted([
      'npm run harness -- provider-route-map --env-file .env',
      'npm run harness -- provider-activation-plan --env-file .env',
      'npm run harness -- provider-preflight --env-file .env',
      'npm run harness -- credential-coverage --env-file .env',
      'npm run harness -- capability-unlock-map --env-file .env',
      ...(recommendedRoute?.safe_probe_commands ?? []),
      ...(recommendedRoute?.activation_commands ?? []),
    ]),
  };
}

export function buildProviderActivationPlan(
  options: {
    env?: EnvMap;
    rootDir?: string;
    envFile?: string;
  } = {},
): HarnessProviderActivationPlan {
  const rootDir = options.rootDir ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const merged = mergeEnvWithFile(baseEnv, { envFile: options.envFile, rootDir });
  const providerRouteMap = buildProviderRouteMap({ env: merged.effective_env, rootDir });
  const providerPreflight = preflightProviderRequests(merged.effective_env, rootDir);
  const preflightByRequestId = new Map(providerPreflight.preflights.map((preflight) => [preflight.request_id, preflight]));
  const envFileSummary = merged.env_file ? redactEnvFile(merged.env_file) : null;
  const requests = providerRouteMap.routes.map((route) => providerActivationRequest(
    route,
    preflightByRequestId.get(route.request_id) ?? null,
    providerRouteMap.capability_profile,
  ));
  const recommendedRequest = requests.find((request) => request.activation_status === 'ready_for_live')
    ?? requests.find((request) => request.activation_status === 'needs_api_key')
    ?? requests.find((request) => request.activation_status === 'needs_gate')
    ?? requests.find((request) => request.activation_status === 'handoff_only')
    ?? requests[0]
    ?? null;
  const credentialSetupRequests = requests.filter((request) => (
    request.missing_credentials.length > 0
    || request.would_api_key_help
    || request.activation_status === 'ready_for_live'
  ));
  const requiredMissingKeys = uniqueSorted(credentialSetupRequests.flatMap((request) => request.missing_credentials));
  const requiredEnvFlags = uniqueSorted(credentialSetupRequests.flatMap((request) => request.missing_env));

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    env_file: envFileSummary,
    credential_policy: providerRouteMap.credential_policy,
    gates: providerRouteMap.capability_profile.gates,
    summary: {
      request_count: requests.length,
      ready_for_live_count: requests.filter((request) => request.activation_status === 'ready_for_live').length,
      api_key_unlockable_count: requests.filter((request) => request.activation_status === 'needs_api_key' && request.would_api_key_help).length,
      missing_credential_count: requests.filter((request) => request.missing_credentials.length > 0).length,
      missing_env_count: requests.filter((request) => request.missing_env.length > 0).length,
      needs_adapter_count: requests.filter((request) => request.activation_status === 'needs_adapter').length,
      handoff_only_count: requests.filter((request) => request.activation_status === 'handoff_only').length,
      existing_handoff_count: requests.reduce((count, request) => count + request.existing_handoff_count, 0),
      recommended_request_id: recommendedRequest?.request_id ?? null,
      recommended_credential: recommendedRequest?.missing_credentials[0] ?? null,
      external_calls_made: 0,
    },
    credential_setup: {
      secret_policy: providerRouteMap.credential_policy,
      env_file_path: envFileSummary?.path ?? options.envFile ?? null,
      required_missing_keys: requiredMissingKeys,
      required_env_flags: requiredEnvFlags,
      confirmation_required_before_external_call: true,
    },
    requests,
    next_commands: uniqueSorted([
      'npm run harness -- provider-activation-plan --env-file .env',
      'npm run harness -- provider-route-map --env-file .env',
      'npm run harness -- credential-coverage --env-file .env',
      'npm run harness -- provider-preflight --env-file .env',
      ...(recommendedRequest?.safe_probe_commands ?? []),
      ...(recommendedRequest?.activation_command ? [recommendedRequest.activation_command] : []),
    ]),
  };
}

export function buildBrowserResearchPlan(
  options: {
    env?: EnvMap;
    rootDir?: string;
    envFile?: string;
  } = {},
): HarnessBrowserResearchPlan {
  const rootDir = options.rootDir ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const merged = mergeEnvWithFile(baseEnv, { envFile: options.envFile, rootDir });
  const capabilityProfile = buildCapabilityProfile(merged.effective_env, rootDir);
  const providerPreflight = preflightProviderRequests(merged.effective_env, rootDir);
  const browserPreflight = providerPreflight.preflights.find((preflight) => preflight.provider === 'browser_manual') ?? null;
  const envFileSummary = merged.env_file ? redactEnvFile(merged.env_file) : null;
  const captures = browserCaptureFiles(rootDir).map((capture) => browserCaptureEntry(rootDir, capture));
  const recommendedCapture = captures.find((capture) => capture.ingest_ready)
    ?? captures.find((capture) => capture.valid && capture.human_review_status === 'pending_review')
    ?? captures.find((capture) => capture.valid)
    ?? null;
  const browserRequest = browserPreflight ? browserRequestSummary(rootDir, browserPreflight) : null;

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    env_file: envFileSummary,
    gates: {
      allow_browser_ui: capabilityProfile.gates.allow_browser_ui,
      required_env: ['ALLOW_BROWSER_UI=true'],
      missing_env: capabilityProfile.gates.allow_browser_ui ? [] : ['ALLOW_BROWSER_UI=true'],
    },
    operating_docs: {
      mcp_setup_path: filePathIfExists(rootDir, '.ops/browser/mcp_setup.md'),
      allowed_tasks_path: filePathIfExists(rootDir, '.ops/browser/allowed_browser_tasks.md'),
      blocked_tasks_path: filePathIfExists(rootDir, '.ops/browser/blocked_browser_tasks.md'),
      protocol_path: filePathIfExists(rootDir, '.ops/browser/creative_center_research_protocol.md'),
      capture_template_path: filePathIfExists(rootDir, '.ops/browser/browser_capture_template.md'),
      schema_path: filePathIfExists(rootDir, 'schemas/browser-capture.schema.json'),
    },
    browser_request: browserRequest ?? {
      request_id: null,
      request_path: null,
      policy_allows_browser_ui: false,
      ready_for_provider_handoff: false,
      blockers: ['browser_manual provider request missing'],
    },
    summary: {
      capture_count: captures.length,
      valid_capture_count: captures.filter((capture) => capture.valid).length,
      approved_capture_count: captures.filter((capture) => capture.human_review_status === 'approved').length,
      pending_review_capture_count: captures.filter((capture) => capture.human_review_status === 'pending_review').length,
      rejected_capture_count: captures.filter((capture) => capture.human_review_status === 'rejected').length,
      invalid_capture_count: captures.filter((capture) => !capture.valid).length,
      ingest_ready_count: captures.filter((capture) => capture.ingest_ready).length,
      raw_capture_count: captures.filter((capture) => capture.bucket === 'raw').length,
      reviewed_capture_count: captures.filter((capture) => capture.bucket === 'reviewed').length,
      sample_capture_count: captures.filter((capture) => capture.bucket === 'sample').length,
      recommended_capture_path: recommendedCapture?.path ?? null,
      external_calls_made: 0,
    },
    captures,
    next_commands: uniqueSorted([
      'npm run harness -- browser-research-plan --env-file .env',
      'npm run harness -- capability-unlock-map --env-file .env',
      'npm exec tsx -- --test tests/browser-capture.test.ts --runInBand',
      ...(recommendedCapture ? [recommendedCapture.validation_command] : []),
      ...(recommendedCapture?.ingest_command ? [recommendedCapture.ingest_command] : []),
      'ALLOW_BROWSER_UI=true npm run harness -- browser-research-plan --env-file .env',
    ]),
    safety_notes: [
      'No browser UI action is run by this report.',
      'Only visible UI facts belong in capture JSON.',
      'Do not automate login, account creation, CAPTCHA, posting, hidden endpoints, or platform bypasses.',
      'Ingest only approved captures; pending, rejected, or invalid captures remain local review artifacts.',
    ],
  };
}

export function buildPublishingHandoffPlan(
  options: {
    env?: EnvMap;
    rootDir?: string;
    envFile?: string;
  } = {},
): HarnessPublishingHandoffPlan {
  const rootDir = options.rootDir ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const merged = mergeEnvWithFile(baseEnv, { envFile: options.envFile, rootDir });
  const capabilityProfile = buildCapabilityProfile(merged.effective_env, rootDir);
  const launchMap = buildLaunchMap(merged.effective_env, rootDir);
  const envFileSummary = merged.env_file ? redactEnvFile(merged.env_file) : null;
  const jobs = launchMap.jobs.map((job) => publishingHandoffJob(job));
  const recommendedJob = jobs.find((job) => job.manual_handoff_ready && !job.autonomous_publish_ready)
    ?? jobs.find((job) => job.manual_handoff_ready)
    ?? jobs[0]
    ?? null;

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    env_file: envFileSummary,
    gates: {
      allow_social_publishing: capabilityProfile.gates.allow_social_publishing,
      required_env: ['ALLOW_SOCIAL_PUBLISHING=true'],
      missing_env: capabilityProfile.gates.allow_social_publishing ? [] : ['ALLOW_SOCIAL_PUBLISHING=true'],
    },
    operating_docs: {
      account_setup_checklist_path: filePathIfExists(rootDir, '.ops/accounts/account_setup_checklist.md'),
      socials_path: filePathIfExists(rootDir, '.ops/accounts/socials.md'),
      launch_checklist_path: filePathIfExists(rootDir, '.ops/accounts/launch_checklist.md'),
      launch_queue_path: filePathIfExists(rootDir, '.ops/launch/launch_queue.md'),
      manual_launch_packet_path: filePathIfExists(rootDir, '.ops/launch/manual_launch_packet.md'),
      posting_qa_checklist_path: filePathIfExists(rootDir, '.ops/launch/posting_qa_checklist.md'),
      metrics_tracking_template_path: filePathIfExists(rootDir, '.ops/launch/metrics_tracking_template.md'),
      first_10_posts_path: filePathIfExists(rootDir, '.ops/launch/first_10_posts.md'),
      launch_calendar_path: filePathIfExists(rootDir, '.ops/launch/launch_calendar.md'),
      dm_response_templates_path: filePathIfExists(rootDir, '.ops/launch/dm_response_templates.md'),
      pinned_comment_templates_path: filePathIfExists(rootDir, '.ops/launch/pinned_comment_templates.md'),
    },
    summary: {
      job_count: jobs.length,
      queued_job_count: launchMap.queued_job_count,
      manual_handoff_ready_job_count: launchMap.manual_handoff_ready_job_count,
      autonomous_publish_ready_job_count: launchMap.autonomous_publish_ready_job_count,
      blocked_job_count: jobs.filter((job) => job.blockers.length > 0).length,
      metrics_job_count: launchMap.metrics_job_count,
      recommended_job_id: recommendedJob?.job_id ?? null,
      external_calls_made: 0,
    },
    jobs,
    next_commands: uniqueSorted([
      'npm run harness -- publishing-handoff-plan --env-file .env',
      'npm run harness -- launch-map',
      'npm run harness -- capability-unlock-map --env-file .env',
      'npm run harness -- blockers',
      ...(recommendedJob?.manual_review_commands ?? []),
      ...(recommendedJob?.metrics_commands ?? []),
    ]),
    safety_notes: [
      'No social platform login, upload, post, DM, comment, or browser action is run by this report.',
      'Autonomous posting remains disabled; account-owner confirmation is required even when package files are ready.',
      'Metrics commands are local recordkeeping commands and require a real posted URL from a manual post.',
      'Do not treat missing social-publishing evidence as negative performance evidence; it is a manual execution gap.',
    ],
  };
}

export function listCodexPrimitives(): CodexPrimitive[] {
  return [
    {
      id: 'harness.auto',
      kind: 'auto',
      command: 'npm run harness -- auto --goal "<goal>"',
      purpose: 'Run the safest local autonomous loop: diagnose the repo, select and render work, write durable artifacts, then stop at explicit capability or reproducibility gates.',
      writes: ['.ops/harness/runs/<run_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.doctor',
      kind: 'doctor',
      command: 'npm run harness -- doctor',
      purpose: 'Return a machine-readable readiness report covering repo reproducibility, capability gates, information surface, latest run, secrets, and next commands.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.repo_status',
      kind: 'inspect',
      command: 'npm run harness -- repo-status',
      purpose: 'Return branch, remote, dirty state, and untracked source-of-truth files without shelling through ad hoc status commands.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.capability_plan',
      kind: 'doctor',
      command: 'npm run harness -- capability-plan',
      purpose: 'Explain what local, provider, browser, and publishing lanes can do now, which gates or credentials are missing, and which request manifests are ready only for dry-run.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.capability_unlock_map',
      kind: 'doctor',
      command: 'npm run harness -- capability-unlock-map',
      purpose: 'Map each closed autonomy gate to required env flags, credential presence, policy preconditions, affected requests/jobs, safe probes, activation commands, verification commands, and blockers.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.capability_env',
      kind: 'doctor',
      command: 'npm run harness -- capability-env --env-file .env',
      purpose: 'Inspect a local ignored env file and process env as redacted key-presence flags for capability gates and provider credentials.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.credential_coverage',
      kind: 'doctor',
      command: 'npm run harness -- credential-coverage --env-file .env',
      purpose: 'Map redacted credential presence to current provider requests, live readiness, unbound keys, missing required credentials, and gate blockers.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.provider_route_map',
      kind: 'provider',
      command: 'npm run harness -- provider-route-map --env-file .env',
      purpose: 'Rank provider request routes and report whether an API key, env gate, local input, or adapter would move each route toward live execution.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.provider_activation_plan',
      kind: 'provider',
      command: 'npm run harness -- provider-activation-plan --env-file .env',
      purpose: 'Combine provider routes, redacted credential coverage, handoff history, and live-run commands into a single API-key activation boundary for Codex.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.browser_research_plan',
      kind: 'browser',
      command: 'npm run harness -- browser-research-plan --env-file .env',
      purpose: 'Inventory browser research docs, reviewed/manual capture files, validation/ingestion commands, and browser gate blockers without running browser UI.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.publishing_handoff_plan',
      kind: 'publish',
      command: 'npm run harness -- publishing-handoff-plan --env-file .env',
      purpose: 'Consolidate launch docs, manual handoff-ready jobs, account-owner confirmation, local metrics commands, and social-publishing blockers without posting.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.reproducibility_manifest',
      kind: 'reproducibility',
      command: 'npm run harness -- reproducibility-manifest',
      purpose: 'Return the tracked/untracked source-of-truth boundary, generated artifact boundary, exact git add command, and verification commands for portable Codex work.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.verification_map',
      kind: 'reproducibility',
      command: 'npm run harness -- verification-map',
      purpose: 'Map current changed files to targeted validation commands, baseline checks, reproducibility staging, and why each command is required.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.stage_source',
      kind: 'reproducibility',
      command: 'npm run harness -- stage-source --dry-run',
      purpose: 'Preview or apply a git add operation for only manifest-classified source-of-truth files; generated artifacts remain excluded.',
      writes: ['git index when --apply is supplied'],
      required_gates: ['--apply for real git index changes'],
      autonomy: 'capability_gated',
    },
    {
      id: 'harness.source_package',
      kind: 'reproducibility',
      command: 'npm run harness -- source-package',
      purpose: 'Copy manifest-classified source-of-truth files into an ignored package directory with hashes and a verification manifest.',
      writes: ['.ops/harness/source_packages/<package_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.verify_source_package',
      kind: 'reproducibility',
      command: 'npm run harness -- verify-source-package --package .ops/harness/source_packages/<package_id>',
      purpose: 'Verify a source package by checking every copied file hash and aggregate package hash.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.autonomy_audit',
      kind: 'doctor',
      command: 'npm run harness -- autonomy-audit --goal "<goal>"',
      purpose: 'Audit the full autonomy objective against current evidence, including information primitives, local execution, reproducibility, provider, browser, and publishing gates.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.goal_completion_audit',
      kind: 'doctor',
      command: 'npm run harness -- goal-completion-audit --goal "<goal>" --env-file .env',
      purpose: 'Audit the active autonomy goal requirement by requirement, with proof commands, blockers, and whether the thread goal can be marked complete.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.autonomy_plan',
      kind: 'doctor',
      command: 'npm run harness -- autonomy-plan --goal "<goal>"',
      purpose: 'Return an ordered Codex execution queue with safe-to-run commands, capability-gated commands, evidence, writes, and selected next step.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.next_action',
      kind: 'doctor',
      command: 'npm run harness -- next-action --goal "<goal>" --env-file .env',
      purpose: 'Return the next orientation, progress, capability-unlock, and human-boundary actions as a compact Codex control report.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.decision_surface',
      kind: 'doctor',
      command: 'npm run harness -- decision-surface --goal "<goal>" --env-file .env',
      purpose: 'Merge plan, goal audit, blockers, provider readiness, credential coverage, launch state, and run history into safe-now, capability-gated, human-boundary, and blocked action queues.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.inspect',
      kind: 'inspect',
      command: 'npm run harness -- inspect',
      purpose: 'Return available jobs, provider requests, capability gates, credential availability flags, and callable primitives.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.run',
      kind: 'inspect',
      command: 'npm run harness -- run --goal "<goal>"',
      purpose: 'Create a durable autonomous run folder with selected job context, rendered package, provider dry-runs, next actions, and a Codex prompt packet.',
      writes: ['.ops/harness/runs/<run_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.rank_jobs',
      kind: 'rank',
      command: 'npm run harness -- rank-jobs',
      purpose: 'Rank incoming creative jobs by local runnability, evidence density, hook specificity, risk/comparison clarity, and output completeness.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.job_matrix',
      kind: 'rank',
      command: 'npm run harness -- job-matrix',
      purpose: 'Return per-job readiness across ranking, rendered package files, provider requests, launch queue presence, metrics records, blockers, and next commands.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.evidence_map',
      kind: 'context',
      command: 'npm run harness -- evidence-map',
      purpose: 'Return per-job source inputs, trend references, rendered evidence files, valuation claim-safety flags, blockers, and next commands.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.launch_map',
      kind: 'publish',
      command: 'npm run harness -- launch-map',
      purpose: 'Return launch docs, queued jobs, rendered posting files, platform copy coverage, human approval gates, metrics follow-up, and autonomous publishing blockers.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.context_pack',
      kind: 'context',
      command: 'npm run harness -- context-pack --out .ops/harness/context_pack.json',
      purpose: 'Write a bounded, hashed context pack of source, schema, job, provider, ops, skill, report, and test excerpts for Codex to inspect.',
      writes: ['.ops/harness/context_pack.json or caller-provided --out path'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.information_index',
      kind: 'context',
      command: 'npm run harness -- information-index',
      purpose: 'Return the complete information-source map across source files, schemas, tests, jobs, provider requests, ops docs, skills, and reports.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.inventory',
      kind: 'inspect',
      command: 'npm run harness -- inventory --run .ops/harness/runs/<run_id>',
      purpose: 'Inventory a run folder with file kinds, byte sizes, and hashes so Codex can reason over existing artifacts.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.resume',
      kind: 'inspect',
      command: 'npm run harness -- resume --run .ops/harness/runs/<run_id>',
      purpose: 'Read an existing run, verify expected artifacts, and return next executable commands without recreating the run.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.run_history',
      kind: 'inspect',
      command: 'npm run harness -- run-history',
      purpose: 'Summarize recent durable harness runs, selected jobs, statuses, missing artifacts, provider dry-run counts, next actions, and resume commands.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.run_brief',
      kind: 'inspect',
      command: 'npm run harness -- run-brief --run .ops/harness/runs/<run_id>',
      purpose: 'Return a compact Codex handoff for the latest or specified run, including stage counts, provider gate results, next actions, artifact hashes, and bounded excerpts.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.latest_run',
      kind: 'inspect',
      command: 'npm run harness -- latest-run',
      purpose: 'Find and summarize the most recent harness run without requiring the caller to know its run id.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.blockers',
      kind: 'inspect',
      command: 'npm run harness -- blockers',
      purpose: 'Return a current blocker ledger for reproducibility, provider gates, browser gates, publishing gates, and credential availability.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'trend.research',
      kind: 'trend',
      command: 'npm run trend -- research --niche "<niche>" --format slideshow --db trend_examples.sqlite',
      purpose: 'Produce citation-backed trend claims from locally saved examples; returns insufficient_examples instead of inventing claims.',
      writes: ['trend_examples.sqlite when initialized or ingested separately'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'trend.brief',
      kind: 'trend',
      command: 'npm run trend -- brief --niche "<niche>" --item "<item>" --out trend_outputs/<slug> --db trend_examples.sqlite',
      purpose: 'Generate and render a local scan/value content brief when enough grounded examples exist.',
      writes: ['trend_outputs/<slug>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'creative.validate',
      kind: 'creative',
      command: 'npm run creative -- validate --job .ops/creative_jobs/incoming/<job>.json',
      purpose: 'Validate a creative job manifest and its provider, approval, and output requirements.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'creative.render',
      kind: 'creative',
      command: 'npm run creative -- render --job .ops/creative_jobs/incoming/<job>.json',
      purpose: 'Render a deterministic local review package with slides, captions, prompts, QA, and approval artifacts.',
      writes: ['.ops/creative_jobs/rendered/<job_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'provider.dry_run',
      kind: 'provider',
      command: 'npm run trend -- provider:run-dry --file .ops/provider_requests/<request>.json',
      purpose: 'Evaluate provider intent and capability gates without making external calls.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.provider_preflight',
      kind: 'provider',
      command: 'npm run harness -- provider-preflight',
      purpose: 'Check every provider request prompt, input asset, declared output path, dry-run result, and local preparation command before any provider handoff.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.prepare_provider_inputs',
      kind: 'provider',
      command: 'npm run harness -- prepare-provider-inputs --request .ops/provider_requests/<request>.json',
      purpose: 'Render the canonical local package for a provider request job so declared input assets exist before provider dry-run or handoff.',
      writes: ['.ops/creative_jobs/rendered/<job_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'harness.provider_handoff',
      kind: 'provider',
      command: 'npm run harness -- provider-handoff --request .ops/provider_requests/<request>.json',
      purpose: 'Write a bounded provider handoff packet with request, job, prompt, asset hashes, dry-run status, output targets, live-call eligibility, and blockers.',
      writes: ['.ops/harness/provider_handoffs/<packet_id>/'],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'provider.live_run',
      kind: 'provider',
      command: 'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-live --file .ops/provider_requests/<request>.json --package-dir .ops/creative_jobs/rendered/<job_id>',
      purpose: 'Run a reviewed live provider adapter for an explicit generation request; currently supports OpenAI image generation and writes only declared local outputs.',
      writes: ['declared files under .ops/creative_jobs/rendered/<job_id>/provider_outputs/<provider>/'],
      required_gates: ['ALLOW_PAID_GENERATION=true', 'OPENAI_API_KEY available for openai_image', 'request.provider_mode=generation', 'request.cost_policy.allow_paid_generation=true', 'request.cost_policy.external_calls_allowed=true', 'request.cost_policy.max_cost_usd>0'],
      autonomy: 'capability_gated',
    },
    {
      id: 'browser.capture_validate',
      kind: 'browser',
      command: 'npm run trend -- browser:validate-capture --file .ops/browser/captures/reviewed/<capture>.json',
      purpose: 'Validate manual or browser-assisted research captures before ingesting them as trend examples.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'metrics.compare',
      kind: 'metrics',
      command: 'npm run metrics:compare -- --metric saves',
      purpose: 'Rank posted content by latest manually recorded metric snapshots with small-sample caveats.',
      writes: [],
      required_gates: [],
      autonomy: 'safe_default',
    },
    {
      id: 'publish.boundary',
      kind: 'publish',
      command: 'ALLOW_SOCIAL_PUBLISHING=true npm run harness -- inspect',
      purpose: 'Expose that publishing remains outside the default harness until job policy, environment gate, approved assets, and account ownership are all true.',
      writes: [],
      required_gates: ['ALLOW_SOCIAL_PUBLISHING=true', 'job.provider_policy.allow_social_publishing=true', 'human-approved generated assets'],
      autonomy: 'human_boundary',
    },
  ];
}

export function buildInformationIndex(rootDir = process.cwd()): HarnessInformationSource[] {
  const sources: HarnessInformationSource[] = [];

  addKnownSource(sources, rootDir, 'source.trend_research', 'source', 'src/trend-research.ts', 'SQLite-backed trend intake, FTS search, grounded research answers, and content brief rendering.');
  addKnownSource(sources, rootDir, 'source.harness', 'source', 'src/codex-harness.ts', 'Codex-facing autonomous runner, capability profiler, primitive menu, and durable run artifact writer.');
  addKnownSource(sources, rootDir, 'source.provider_workflow', 'source', 'src/provider-workflow.ts', 'Provider request manifests, gate evaluation, dry-runs, and controlled provider output writes.');
  addKnownSource(sources, rootDir, 'source.browser_capture', 'source', 'src/browser-capture.ts', 'Manual/browser-assisted capture validation and approved capture ingestion.');
  addKnownSource(sources, rootDir, 'source.post_metrics', 'source', 'src/post-metrics.ts', 'Posted-content metric store, snapshots, comparisons, and CSV/JSON export.');
  addKnownSource(sources, rootDir, 'source.valuation_card', 'source', 'src/valuation-card.ts', 'Range-based valuation cards and unsupported exact-value claim rejection.');
  addKnownSource(sources, rootDir, 'source.env_loader', 'source', 'src/env-loader.ts', 'Ignored env-file parser and redacted capability key-presence reporting for Codex/provider gates.');
  addKnownSource(sources, rootDir, 'source.creative_schema', 'source', 'packages/creative/job_schema.ts', 'Creative job schema, provider policy gates, posting gates, and secret scanning.');
  addKnownSource(sources, rootDir, 'source.local_renderer', 'source', 'packages/creative/local_renderer.ts', 'Deterministic local package renderer for slides, prompts, QA, and approval artifacts.');
  addKnownSource(sources, rootDir, 'source.provider_router', 'source', 'packages/creative/provider_router.ts', 'Creative provider router for local renderer and gated provider stubs.');

  addGlobSources(sources, rootDir, 'schema', 'schemas', '.json', 'schema', 'JSON schemas for trend examples, browser captures, providers, metrics, and valuation cards.');
  addGlobSources(sources, rootDir, 'test', 'tests', '.ts', 'test', 'Node test coverage for Codex harness, creative gates, trend research, metrics, provider workflow, and launch kit.');
  addGlobSources(sources, rootDir, 'job', path.join('.ops', 'creative_jobs', 'incoming'), '.json', 'job', 'Incoming creative job manifest Codex can validate, select, render, and continue.');
  addGlobSources(sources, rootDir, 'provider_request', path.join('.ops', 'provider_requests'), '.json', 'provider_request', 'Provider intent manifest for browser, Gemini, OpenAI, or local provider work.');
  addGlobSources(sources, rootDir, 'ops_launch', path.join('.ops', 'launch'), '.md', 'ops_doc', 'Launch, posting, metric, DM, pinned-comment, and QA operating docs.');
  addGlobSources(sources, rootDir, 'ops_browser', path.join('.ops', 'browser'), '.md', 'ops_doc', 'Browser workflow boundaries, capture template, and Creative Center protocol.');
  addGlobSources(sources, rootDir, 'ops_accounts', path.join('.ops', 'accounts'), '.md', 'ops_doc', 'Account setup, handle, profile, and launch checklist docs.');
  addGlobSources(sources, rootDir, 'skill', path.join('.codex', 'skills'), '.md', 'skill', 'Local Codex skills for creative browser research, image planning, rendering, and social setup.');
  addGlobSources(sources, rootDir, 'report', 'reports', '.md', 'report', 'Readiness audits and evidence reports.');

  return sources;
}

export function rankIncomingJobs(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessJobRanking[] {
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  return listIncomingJobs(rootDir)
    .map((item) => scoreCreativeJob(loadCreativeJobManifest(item.path), item.path, capabilityProfile))
    .sort((a, b) => b.score - a.score || a.job_id.localeCompare(b.job_id))
    .map((ranking, index) => ({ ...ranking, rank: index + 1 }));
}

export function buildJobReadinessMatrix(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessJobMatrix {
  const jobs = listIncomingJobs(rootDir);
  const rankings = new Map(rankIncomingJobs(env, rootDir).map((ranking) => [ranking.job_id, ranking]));
  const providerPreflight = preflightProviderRequests(env, rootDir);
  const providerByJob = new Map<string, HarnessProviderPreflight[]>();
  for (const preflight of providerPreflight.preflights) {
    const existing = providerByJob.get(preflight.job_id) ?? [];
    existing.push(preflight);
    providerByJob.set(preflight.job_id, existing);
  }
  const launchQueue = readLaunchQueue(rootDir);
  const metricsStore = loadPostMetricsStore(path.join(rootDir, '.ops', 'metrics', 'post_metrics.json'));
  const metricsByJob = new Map<string, ReturnType<typeof loadPostMetricsStore>['records']>();
  for (const record of metricsStore.records) {
    const existing = metricsByJob.get(record.job_id) ?? [];
    existing.push(record);
    metricsByJob.set(record.job_id, existing);
  }

  const rows = jobs.map(({ job_id: jobId, path: jobPath }): HarnessJobMatrixRow => {
    const job = loadCreativeJobManifest(jobPath);
    const ranking = rankings.get(jobId);
    const packageDir = providerPackageDir(rootDir, jobId);
    const outputDir = path.join(packageDir, 'output');
    const slideCount = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((file) => /^slide_\d+\.png$/.test(file)).length
      : 0;
    const jobProviderRequests = (providerByJob.get(jobId) ?? []).sort((a, b) => a.request_id.localeCompare(b.request_id));
    const metrics = metricsByJob.get(jobId) ?? [];
    const latestSnapshotAt = metrics
      .map((record) => latestMetricSnapshot(record)?.captured_at ?? null)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
    const launchOrder = launchQueue.orders.get(jobId) ?? null;
    const launchMentioned = launchOrder !== null || launchQueue.text.includes(jobId);
    const manifestExists = fs.existsSync(path.join(packageDir, 'manifest.json'));
    const captionExists = fs.existsSync(path.join(outputDir, 'caption.txt'));
    const blockers = Array.from(new Set([
      ...(ranking?.blockers ?? []),
      ...(manifestExists ? [] : ['rendered package missing']),
      ...(captionExists ? [] : ['rendered caption missing']),
      ...(slideCount >= job.output_requirements.slide_count ? [] : [`rendered slide count ${slideCount}/${job.output_requirements.slide_count}`]),
      ...jobProviderRequests.flatMap((request) => request.ready_for_provider_handoff ? [] : request.live_blockers),
    ])).sort();
    const nextCommands = Array.from(new Set([
      `npm run creative -- validate --job ${shellQuote(relativeToRoot(rootDir, jobPath))}`,
      ...(manifestExists ? [] : [`npm run creative -- render --job ${shellQuote(relativeToRoot(rootDir, jobPath))}`]),
      ...(jobProviderRequests.length
        ? jobProviderRequests.map((request) => `npm run harness -- provider-preflight --request ${shellQuote(request.request_path)}`)
        : []),
      ...(launchMentioned && metrics.length === 0
        ? [`npm run metrics:create-post -- --job-id ${shellQuote(jobId)} --platform <platform> --account-handle <handle> --posted-url <url> --content-type ${shellQuote(job.content_type)} --hook ${shellQuote(job.output_requirements.slides[0]?.on_screen_text ?? job.content_type)} --format slideshow --cta scan`]
        : []),
    ]));

    return {
      job_id: jobId,
      path: relativeToRoot(rootDir, jobPath),
      rank: ranking?.rank ?? null,
      score: ranking?.score ?? null,
      runnable_now: ranking?.runnable_now ?? false,
      approval_state: job.approval_status.state,
      provider_policy: {
        approved_providers: job.provider_policy.approved_providers,
        allow_paid_generation: job.provider_policy.allow_paid_generation,
        allow_browser_ui: job.provider_policy.allow_browser_ui,
        allow_social_publishing: job.provider_policy.allow_social_publishing,
      },
      render_package: {
        path: relativeToRoot(rootDir, packageDir),
        exists: fs.existsSync(packageDir),
        manifest_exists: manifestExists,
        caption_exists: captionExists,
        slide_count: slideCount,
      },
      provider_requests: jobProviderRequests.map((request) => ({
        request_id: request.request_id,
        provider: request.provider,
        path: request.request_path,
        status: request.status,
        ready_for_provider_handoff: request.ready_for_provider_handoff,
        ready_for_live_request: request.ready_for_live_request,
        missing_input_assets: request.missing_input_assets,
        live_blockers: request.live_blockers,
      })),
      launch_queue: {
        mentioned: launchMentioned,
        order: launchOrder,
      },
      metrics: {
        record_count: metrics.length,
        latest_snapshot_at: latestSnapshotAt,
      },
      blockers,
      reasons: ranking?.reasons ?? [],
      next_commands: nextCommands,
    };
  }).sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.job_id.localeCompare(b.job_id));

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    job_count: rows.length,
    rendered_job_count: rows.filter((row) => row.render_package.manifest_exists).length,
    provider_linked_job_count: rows.filter((row) => row.provider_requests.length > 0).length,
    launch_queue_job_count: rows.filter((row) => row.launch_queue.mentioned).length,
    metrics_job_count: rows.filter((row) => row.metrics.record_count > 0).length,
    jobs: rows,
    next_commands: [
      'npm run harness -- rank-jobs',
      'npm run harness -- auto --goal "<goal>"',
      'npm run harness -- provider-preflight',
      'npm run metrics:list',
    ],
  };
}

export function buildEvidenceMap(rootDir = process.cwd()): HarnessEvidenceMap {
  const rows = listIncomingJobs(rootDir)
    .map(({ job_id: jobId, path: jobPath }): HarnessJobEvidenceRow => {
      const job = loadCreativeJobManifest(jobPath);
      const packageDir = providerPackageDir(rootDir, jobId);
      const sourceInputs = job.source_inputs.map((input): HarnessEvidenceSourceInput => {
        const inputPath = input.path ? resolveFromRoot(rootDir, input.path) : null;
        return {
          kind: input.kind,
          label: input.label,
          value_present: Boolean(input.value),
          path: input.path ?? null,
          path_exists: inputPath ? fs.existsSync(inputPath) : null,
          url: input.url ?? null,
          captured_at: input.captured_at ?? null,
          notes_present: Boolean(input.notes),
        };
      });
      const trendExamples = job.trend_examples.map((example): HarnessEvidenceTrendExample => ({
        id: example.id,
        source_name: example.source_name,
        platform: example.platform,
        format: example.format,
        hook: example.hook,
        source_url: example.source_url,
        captured_at: example.captured_at,
      }));
      const claimSafety = evaluateClaimSafety(job);
      const sourcePathInputs = sourceInputs.filter((input) => input.path);
      const nextCommands = Array.from(new Set([
        `npm run creative -- validate --job ${shellQuote(relativeToRoot(rootDir, jobPath))}`,
        `npm run harness -- job-matrix`,
        ...(fs.existsSync(path.join(packageDir, 'manifest.json'))
          ? []
          : [`npm run creative -- render --job ${shellQuote(relativeToRoot(rootDir, jobPath))}`]),
        ...(claimSafety.blockers.length ? ['Review claim_safety.blockers before provider handoff or posting.'] : []),
      ]));

      return {
        job_id: jobId,
        path: relativeToRoot(rootDir, jobPath),
        niche: job.niche,
        content_type: job.content_type,
        source_inputs: sourceInputs,
        trend_examples: trendExamples,
        evidence_counts: {
          source_input_count: sourceInputs.length,
          trend_example_count: trendExamples.length,
          unique_source_url_count: new Set(trendExamples.map((example) => example.source_url)).size,
          source_path_count: sourcePathInputs.length,
          existing_source_path_count: sourcePathInputs.filter((input) => input.path_exists).length,
        },
        manual_boundary_declared: hasManualBoundary(job),
        rendered_evidence: {
          package_path: relativeToRoot(rootDir, packageDir),
          manifest_exists: fs.existsSync(path.join(packageDir, 'manifest.json')),
          trend_examples_exists: fs.existsSync(path.join(packageDir, 'research', 'trend_examples.json')),
          research_notes_exists: fs.existsSync(path.join(packageDir, 'research', 'notes.md')),
          qa_checklist_exists: fs.existsSync(path.join(packageDir, 'qa', 'checklist.md')),
          approval_exists: fs.existsSync(path.join(packageDir, 'qa', 'approval.md')),
        },
        claim_safety: claimSafety,
        next_commands: nextCommands,
      };
    })
    .sort((a, b) => a.job_id.localeCompare(b.job_id));

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    job_count: rows.length,
    jobs_with_trend_examples: rows.filter((row) => row.evidence_counts.trend_example_count > 0).length,
    jobs_with_manual_boundary: rows.filter((row) => row.manual_boundary_declared).length,
    jobs_with_rendered_evidence: rows.filter((row) => row.rendered_evidence.manifest_exists).length,
    jobs_with_claim_blockers: rows.filter((row) => row.claim_safety.blockers.length > 0).length,
    jobs: rows,
    next_commands: [
      'npm run harness -- job-matrix',
      'npm run harness -- context-pack --out .ops/harness/context_pack.json',
      'npm run harness -- provider-preflight',
      'npm run harness -- auto --goal "<goal>"',
    ],
  };
}

export function buildLaunchMap(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessLaunchMap {
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const launchQueue = readLaunchQueue(rootDir);
  const evidenceByJob = new Map(buildEvidenceMap(rootDir).jobs.map((row) => [row.job_id, row]));
  const metricsStore = loadPostMetricsStore(path.join(rootDir, '.ops', 'metrics', 'post_metrics.json'));
  const metricsByJob = new Map<string, ReturnType<typeof loadPostMetricsStore>['records']>();
  for (const record of metricsStore.records) {
    const existing = metricsByJob.get(record.job_id) ?? [];
    existing.push(record);
    metricsByJob.set(record.job_id, existing);
  }

  const launchDocs = launchDocPaths().map((docPath): HarnessLaunchDocStatus => ({
    path: docPath,
    exists: fs.existsSync(path.join(rootDir, docPath)),
  }));

  const jobs = Array.from(launchQueue.orders.entries())
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([jobId, order]): HarnessLaunchMapJob => {
      const jobPath = incomingJobPath(rootDir, jobId);
      const packageDir = providerPackageDir(rootDir, jobId);
      const renderedManifestPath = path.join(packageDir, 'manifest.json');
      const job = fs.existsSync(renderedManifestPath)
        ? loadCreativeJobManifest(renderedManifestPath)
        : loadCreativeJobManifest(jobPath);
      const outputDir = path.join(packageDir, 'output');
      const qaDir = path.join(packageDir, 'qa');
      const slideCount = fs.existsSync(outputDir)
        ? fs.readdirSync(outputDir).filter((file) => /^slide_\d+\.png$/.test(file)).length
        : 0;
      const section = launchQueueSection(launchQueue.text, jobId);
      const launchCopy = launchCopyStatus(section);
      const metrics = metricsByJob.get(jobId) ?? [];
      const latestSnapshotAt = metrics
        .map((record) => latestMetricSnapshot(record)?.captured_at ?? null)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
      const requiredFiles: HarnessLaunchMapRequiredFile[] = [
        launchRequiredFile(rootDir, 'manifest', path.join(packageDir, 'manifest.json')),
        launchRequiredFile(rootDir, 'caption', path.join(outputDir, 'caption.txt')),
        launchRequiredFile(rootDir, 'hashtags', path.join(outputDir, 'hashtags.txt')),
        launchRequiredFile(rootDir, 'posting_notes', path.join(outputDir, 'posting_notes.md')),
        launchRequiredFile(rootDir, 'qa_checklist', path.join(qaDir, 'checklist.md')),
        launchRequiredFile(rootDir, 'approval', path.join(qaDir, 'approval.md')),
        {
          role: 'slides',
          path: relativeToRoot(rootDir, outputDir),
          exists: slideCount >= job.output_requirements.slide_count,
          count: slideCount,
          required_count: job.output_requirements.slide_count,
        },
      ];
      const missingRequiredFiles = requiredFiles.filter((file) => !file.exists);
      const missingCopy = launchCopyMissingFields(launchCopy);
      const evidence = evidenceByJob.get(jobId);
      const evidenceBlockers = evidence?.claim_safety.blockers ?? [];
      const humanApprovalBlockers = [
        ...(job.approval_status.state === 'approved' && job.approval_status.human_reviewer
          ? []
          : ['human approval missing']),
        ...(job.generated_assets.length && job.generated_assets.every((asset) => asset.approved_for_posting)
          ? []
          : ['generated assets are not approved for posting']),
      ];
      const autonomousBlockers = [
        ...(capabilityProfile.gates.allow_social_publishing ? [] : ['ALLOW_SOCIAL_PUBLISHING=false']),
        ...(job.provider_policy.allow_social_publishing ? [] : ['job policy disallows social publishing']),
        ...humanApprovalBlockers,
      ];
      const blockers = Array.from(new Set([
        ...missingRequiredFiles.map((file) => `${file.role} missing`),
        ...missingCopy.map((field) => `launch copy missing ${field}`),
        ...evidenceBlockers,
        ...autonomousBlockers,
      ])).sort();
      const manualHandoffReady = missingRequiredFiles.length === 0
        && missingCopy.length === 0
        && evidenceBlockers.length === 0
        && launchDocs.every((doc) => doc.exists);
      const autonomousPublishReady = manualHandoffReady && autonomousBlockers.length === 0;

      return {
        job_id: jobId,
        order,
        job_path: relativeToRoot(rootDir, jobPath),
        package_path: relativeToRoot(rootDir, packageDir),
        launch_section_present: section.length > 0,
        approval_state: job.approval_status.state,
        job_allows_social_publishing: job.provider_policy.allow_social_publishing,
        generated_asset_count: job.generated_assets.length,
        approved_generated_asset_count: job.generated_assets.filter((asset) => asset.approved_for_posting).length,
        required_files: requiredFiles,
        launch_copy: launchCopy,
        metrics: {
          record_count: metrics.length,
          latest_snapshot_at: latestSnapshotAt,
        },
        manual_handoff_ready: manualHandoffReady,
        autonomous_publish_ready: autonomousPublishReady,
        blockers,
        next_commands: launchNextCommands(rootDir, job, metrics.length, manualHandoffReady),
      };
    });

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    launch_docs: launchDocs,
    queued_job_count: jobs.length,
    manual_handoff_ready_job_count: jobs.filter((job) => job.manual_handoff_ready).length,
    autonomous_publish_ready_job_count: jobs.filter((job) => job.autonomous_publish_ready).length,
    metrics_job_count: jobs.filter((job) => job.metrics.record_count > 0).length,
    jobs,
    next_commands: [
      'npm run harness -- evidence-map',
      'npm run harness -- job-matrix',
      'npm run harness -- blockers',
      'npm run metrics:list',
    ],
  };
}

export function buildContextPack(
  rootDir = process.cwd(),
  options: { maxFiles?: number; maxCharsPerFile?: number } = {},
): HarnessContextPack {
  const maxFiles = options.maxFiles ?? 80;
  const maxCharsPerFile = options.maxCharsPerFile ?? 2400;
  const sources = buildInformationIndex(rootDir)
    .sort((a, b) => contextKindPriority(a.kind) - contextKindPriority(b.kind) || a.id.localeCompare(b.id))
    .slice(0, maxFiles)
    .map((source) => packSource(source, maxCharsPerFile));

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    max_files: maxFiles,
    max_chars_per_file: maxCharsPerFile,
    source_count: sources.length,
    sources,
  };
}

export function preflightProviderRequests(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessProviderPreflightReport {
  const preflights = listProviderRequests(rootDir)
    .map((request) => buildProviderPreflight(request.path, env, rootDir));

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    request_count: preflights.length,
    prepared_request_count: preflights.filter((preflight) => preflight.ready_for_provider_handoff).length,
    preflights,
  };
}

export async function prepareProviderInputs(
  requestPath: string,
  options: { rootDir?: string; outDir?: string; env?: Record<string, string | undefined> } = {},
): Promise<{
  created_at: string;
  root_dir: string;
  request_id: string;
  request_path: string;
  job_id: string;
  job_path: string;
  render_output_dir: string;
  created_paths: string[];
  still_missing_inputs: string[];
  provider_preflight: HarnessProviderPreflight;
  next_commands: string[];
}> {
  const rootDir = options.rootDir ?? process.cwd();
  const resolvedRequestPath = resolveFromRoot(rootDir, requestPath);
  const request = loadProviderRequestManifest(resolvedRequestPath);
  const jobPath = incomingJobPath(rootDir, request.job_id);
  if (!fs.existsSync(jobPath)) {
    throw new Error(`Cannot prepare provider inputs; incoming job manifest is missing: ${jobPath}`);
  }

  const job = loadCreativeJobManifest(jobPath);
  const renderOutputDir = path.resolve(options.outDir ?? providerPackageDir(rootDir, request.job_id));
  const renderResult = await runCreativeProvider('local_renderer', job, {
    outDir: renderOutputDir,
    env: options.env ?? process.env,
  });
  if (renderResult.status !== 'rendered') {
    throw new Error(`local renderer returned unexpected status: ${renderResult.status}`);
  }

  const preflight = buildProviderPreflight(resolvedRequestPath, options.env ?? process.env, rootDir);
  const requestDisplayPath = relativeToRoot(rootDir, resolvedRequestPath);

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    request_id: request.request_id,
    request_path: requestDisplayPath,
    job_id: request.job_id,
    job_path: relativeToRoot(rootDir, jobPath),
    render_output_dir: renderResult.render.output_dir,
    created_paths: localRenderCreatedPaths(renderResult.render).sort(),
    still_missing_inputs: preflight.missing_input_assets,
    provider_preflight: preflight,
    next_commands: [
      `npm run harness -- provider-preflight --request ${shellQuote(requestDisplayPath)}`,
      `npm run trend -- provider:run-dry --file ${shellQuote(requestDisplayPath)}`,
    ],
  };
}

export function exportProviderHandoffPacket(
  requestPath: string,
  options: {
    rootDir?: string;
    outDir?: string;
    env?: Record<string, string | undefined>;
    maxTextChars?: number;
  } = {},
): HarnessProviderHandoffPacket {
  const rootDir = options.rootDir ?? process.cwd();
  const env = options.env ?? process.env;
  const maxTextChars = options.maxTextChars ?? 8000;
  const createdAt = new Date().toISOString();
  const resolvedRequestPath = resolveFromRoot(rootDir, requestPath);
  const request = loadProviderRequestManifest(resolvedRequestPath);
  const preflight = buildProviderPreflight(resolvedRequestPath, env, rootDir);
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const jobPath = incomingJobPath(rootDir, request.job_id);
  const jobManifest = fs.existsSync(jobPath) ? loadCreativeJobManifest(jobPath) : null;
  const packetId = createProviderHandoffId(createdAt, request.request_id);
  const packetDir = path.resolve(options.outDir ?? path.join(rootDir, '.ops', 'harness', 'provider_handoffs', packetId));

  if (fs.existsSync(packetDir) && fs.readdirSync(packetDir).length > 0) {
    throw new Error(`provider handoff output directory already exists and is not empty: ${packetDir}`);
  }
  fs.mkdirSync(packetDir, { recursive: true });

  const requestCopyPath = path.join(packetDir, 'request.json');
  const jobCopyPath = jobManifest ? path.join(packetDir, 'job.json') : null;
  const promptCopyPath = preflight.prompt.exists ? path.join(packetDir, 'prompt.md') : null;
  const assetManifestPath = path.join(packetDir, 'input_assets.json');
  const manifestPath = path.join(packetDir, 'provider_handoff.json');
  const prompt = providerHandoffAsset(preflight.prompt, maxTextChars);
  const inputAssets = preflight.input_assets.map((asset) => providerHandoffAsset(asset, maxTextChars));
  const requestDisplayPath = relativeToRoot(rootDir, resolvedRequestPath);
  const packageDir = providerPackageDir(rootDir, request.job_id);
  const packageDisplayPath = relativeToRoot(rootDir, packageDir);

  fs.writeFileSync(requestCopyPath, `${JSON.stringify(request, null, 2)}\n`);
  if (jobManifest && jobCopyPath) {
    fs.writeFileSync(jobCopyPath, `${JSON.stringify(jobManifest, null, 2)}\n`);
  }
  if (promptCopyPath && prompt.text_excerpt !== undefined) {
    fs.writeFileSync(promptCopyPath, `${prompt.text_excerpt}${prompt.truncated ? '\n\n[truncated]\n' : '\n'}`);
  }
  fs.writeFileSync(assetManifestPath, `${JSON.stringify(inputAssets, null, 2)}\n`);

  const packet: HarnessProviderHandoffPacket = {
    created_at: createdAt,
    root_dir: rootDir,
    packet_dir: packetDir,
    manifest_path: manifestPath,
    request_id: request.request_id,
    provider: request.provider,
    job_id: request.job_id,
    request_path: requestDisplayPath,
    request,
    job_path: relativeToRoot(rootDir, jobPath),
    job_manifest: jobManifest,
    capability_profile: capabilityProfile,
    provider_preflight: preflight,
    prompt,
    input_assets: inputAssets,
    declared_outputs: preflight.declared_outputs,
    external_call_policy: {
      external_calls_made: preflight.dry_run.external_calls_made,
      live_external_call_allowed: preflight.ready_for_live_request,
      credential_policy: capabilityProfile.credential_policy,
      live_blockers: preflight.live_blockers,
    },
    files: {
      manifest_path: manifestPath,
      request_copy_path: requestCopyPath,
      job_copy_path: jobCopyPath,
      prompt_copy_path: promptCopyPath,
      asset_manifest_path: assetManifestPath,
    },
    next_commands: [
      `npm run harness -- provider-preflight --request ${shellQuote(requestDisplayPath)}`,
      ...(preflight.suggested_prepare_command ? [preflight.suggested_prepare_command] : []),
      `npm run trend -- provider:run-dry --file ${shellQuote(requestDisplayPath)}`,
      ...(preflight.ready_for_live_request
        ? [`npm run trend -- provider:run-live --file ${shellQuote(requestDisplayPath)} --package-dir ${shellQuote(packageDisplayPath)}`]
        : []),
      'npm run harness -- capability-plan',
    ],
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(packet, null, 2)}\n`);
  return packet;
}

function listProviderHandoffHistory(rootDir: string): HarnessProviderHandoffHistoryEntry[] {
  const handoffRoot = path.join(path.resolve(rootDir), '.ops', 'harness', 'provider_handoffs');
  if (!fs.existsSync(handoffRoot)) return [];

  return fs.readdirSync(handoffRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(handoffRoot, entry.name, 'provider_handoff.json'))
    .flatMap((manifestPath) => {
      const historyEntry = readProviderHandoffHistoryEntry(rootDir, manifestPath);
      return historyEntry ? [historyEntry] : [];
    })
    .sort((a, b) => (
      (b.created_at ?? '').localeCompare(a.created_at ?? '')
      || b.manifest_path.localeCompare(a.manifest_path)
    ));
}

function readProviderHandoffHistoryEntry(
  rootDir: string,
  manifestPath: string,
): HarnessProviderHandoffHistoryEntry | null {
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const requestId = typeof manifest.request_id === 'string' ? manifest.request_id : null;
    if (!requestId) return null;

    const packetDir = typeof manifest.packet_dir === 'string'
      ? resolveFromRoot(rootDir, manifest.packet_dir)
      : path.dirname(manifestPath);

    return {
      created_at: typeof manifest.created_at === 'string' ? manifest.created_at : null,
      packet_dir: relativeToRoot(rootDir, packetDir),
      manifest_path: relativeToRoot(rootDir, manifestPath),
      request_id: requestId,
      provider: typeof manifest.provider === 'string' ? manifest.provider as CreativeProviderName : null,
      job_id: typeof manifest.job_id === 'string' ? manifest.job_id : null,
      request_path: typeof manifest.request_path === 'string' ? manifest.request_path : null,
    };
  } catch {
    return null;
  }
}

export function buildArtifactInventory(rootDir: string): HarnessArtifactInventory {
  const resolvedRoot = path.resolve(rootDir);
  const artifacts = fs.existsSync(resolvedRoot)
    ? walkFiles(resolvedRoot)
      .filter((filePath) => fs.statSync(filePath).isFile())
      .sort()
      .map((filePath) => inventoryFile(resolvedRoot, filePath))
    : [];

  return {
    root_dir: resolvedRoot,
    created_at: new Date().toISOString(),
    artifact_count: artifacts.length,
    artifacts,
  };
}

export function buildBlockerLedger(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessBlockerLedger {
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const blockers: HarnessBlocker[] = [];
  const repoStatus = buildRepoStatus(rootDir);
  const dirtySource = Array.from(new Set([
    ...repoStatus.modified_source_of_truth,
    ...repoStatus.untracked_source_of_truth,
  ])).sort();

  blockers.push({
    id: 'git.reproducibility',
    severity: dirtySource.length ? 'blocker' : 'low',
    status: dirtySource.length ? 'open' : 'resolved',
    evidence: dirtySource.length
      ? [
        `${repoStatus.modified_source_of_truth_count} source-of-truth file(s) are modified or staged.`,
        `${repoStatus.untracked_source_of_truth_count} source-of-truth file(s) are untracked.`,
        ...dirtySource.slice(0, 12),
      ]
      : ['No dirty source-of-truth files found by git status.'],
    next_action: dirtySource.length
      ? 'Stage and commit the WorthScan/harness source, schemas, docs, tests, manifests, package files, and package lock before treating the harness as reproducible.'
      : 'No action needed.',
  });

  blockers.push({
    id: 'provider.paid_generation',
    severity: capabilityProfile.gates.allow_paid_generation ? 'low' : 'high',
    status: capabilityProfile.gates.allow_paid_generation ? 'resolved' : 'open',
    evidence: [
      `ALLOW_PAID_GENERATION=${capabilityProfile.gates.allow_paid_generation}`,
      `openai_api_key_available=${capabilityProfile.credentials.openai_api_key_available}`,
      `gemini_api_key_available=${capabilityProfile.credentials.gemini_api_key_available}`,
    ],
    next_action: capabilityProfile.gates.allow_paid_generation
      ? 'Route any live provider work through request manifests and keep secret values out of artifacts.'
      : 'Enable only when needed with explicit request policy, env gate, and provider credential availability.',
  });

  blockers.push({
    id: 'browser.research',
    severity: capabilityProfile.gates.allow_browser_ui ? 'low' : 'medium',
    status: capabilityProfile.gates.allow_browser_ui ? 'resolved' : 'open',
    evidence: [`ALLOW_BROWSER_UI=${capabilityProfile.gates.allow_browser_ui}`],
    next_action: capabilityProfile.gates.allow_browser_ui
      ? 'Use browser capture validation before ingesting any research evidence.'
      : 'Keep research to local/manual captures until browser UI is explicitly enabled and request policy allows it.',
  });

  blockers.push({
    id: 'publishing.social',
    severity: capabilityProfile.gates.allow_social_publishing ? 'medium' : 'high',
    status: capabilityProfile.gates.allow_social_publishing ? 'resolved' : 'open',
    evidence: [`ALLOW_SOCIAL_PUBLISHING=${capabilityProfile.gates.allow_social_publishing}`],
    next_action: capabilityProfile.gates.allow_social_publishing
      ? 'Confirm job policy, generated asset approval, and account-owner confirmation before posted ledger moves.'
      : 'Do not publish or move assets to posted until publishing is explicitly enabled and all approval gates pass.',
  });

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    blockers,
  };
}

export function resumeHarnessRun(runDir: string): HarnessResumeReport {
  const resolvedRunDir = path.resolve(runDir);
  const runPath = path.join(resolvedRunDir, 'run.json');
  if (!fs.existsSync(runPath)) {
    throw new Error(`run.json not found: ${runPath}`);
  }

  const record = JSON.parse(fs.readFileSync(runPath, 'utf8')) as HarnessRunRecord;
  const expectedArtifacts = [
    record.primitives_path,
    record.capabilities_path,
    record.information_index_path,
    record.context_pack_path,
    record.job_rankings_path,
    record.evidence_map_path,
    record.launch_map_path,
    record.verification_map_path,
    record.capability_unlock_map_path,
    record.provider_route_map_path,
    record.provider_activation_plan_path,
    record.browser_research_plan_path,
    record.publishing_handoff_plan_path,
    record.reproducibility_manifest_path,
    record.autonomy_audit_path,
    record.provider_preflight_path,
    record.artifact_inventory_path,
    record.blocker_ledger_path,
    record.next_actions_path,
    record.prompt_packet_path,
    path.join(record.render_output_dir, 'manifest.json'),
  ].filter((artifactPath): artifactPath is string => typeof artifactPath === 'string' && artifactPath.length > 0);
  const missingArtifacts = expectedArtifacts.filter((artifactPath) => !fs.existsSync(artifactPath));

  return {
    run_id: record.run_id,
    run_dir: resolvedRunDir,
    status: record.status,
    selected_job: record.selected_job,
    missing_artifacts: missingArtifacts,
    artifact_inventory_path: record.artifact_inventory_path,
    blocker_ledger_path: record.blocker_ledger_path,
    reproducibility_manifest_path: record.reproducibility_manifest_path,
    autonomy_audit_path: record.autonomy_audit_path,
    next_commands: [
      `npm run harness -- inventory --run ${resolvedRunDir}`,
      `npm run harness -- run-brief --run ${resolvedRunDir}`,
      `npm run harness -- run-history`,
      `npm run harness -- evidence-map`,
      `npm run harness -- launch-map`,
      `npm run harness -- verification-map`,
      `npm run harness -- capability-unlock-map`,
      `npm run harness -- autonomy-audit --goal "${record.goal.replace(/"/g, '\\"')}"`,
      `npm run harness -- reproducibility-manifest`,
      `npm run harness -- provider-preflight`,
      `npm run harness -- provider-handoff --request .ops/provider_requests/sample_openai_image_request.json`,
      `npm run harness -- source-package`,
      `npm run harness -- blockers`,
      `npm run creative -- validate --job ${record.selected_job.path}`,
      `npm run creative -- render --job ${record.selected_job.path}`,
    ],
  };
}

export function buildRunBrief(
  options: { runDir?: string; rootDir?: string; maxTextChars?: number } = {},
): HarnessRunBrief {
  const rootDir = options.rootDir ?? process.cwd();
  const maxTextChars = options.maxTextChars ?? 1200;
  const resume = options.runDir
    ? resumeHarnessRun(options.runDir)
    : findLatestHarnessRun(rootDir);
  if (!resume) {
    return {
      created_at: new Date().toISOString(),
      root_dir: rootDir,
      run_dir: null,
      run_id: null,
      status: 'no_run',
      selected_job: null,
      missing_artifacts: [],
      stage_status_counts: emptyStageStatusCounts(),
      stages: [],
      provider_gate_summary: {
        request_count: 0,
        blocked_count: 0,
        external_calls_made: 0,
        results: [],
      },
      next_actions: [],
      artifacts: [],
      resume_commands: [],
      next_commands: [
        'npm run harness -- auto --goal "<goal>"',
        'npm run harness -- run-history',
        'npm run harness -- decision-surface --goal "Make WorthScan autonomous for Codex" --env-file .env',
      ],
      error: null,
    };
  }

  try {
    const runPath = path.join(resume.run_dir, 'run.json');
    const record = JSON.parse(fs.readFileSync(runPath, 'utf8')) as HarnessRunRecord;
    const stageStatusCounts = record.stages.reduce((counts, stage) => {
      counts[stage.status] += 1;
      return counts;
    }, emptyStageStatusCounts());
    const providerResults = Array.isArray(record.provider_dry_runs) ? record.provider_dry_runs : [];

    return {
      created_at: new Date().toISOString(),
      root_dir: rootDir,
      run_dir: resume.run_dir,
      run_id: record.run_id,
      status: record.status,
      selected_job: record.selected_job,
      missing_artifacts: resume.missing_artifacts,
      stage_status_counts: stageStatusCounts,
      stages: record.stages,
      provider_gate_summary: {
        request_count: providerResults.length,
        blocked_count: providerResults.filter((result) => result.status === 'blocked').length,
        external_calls_made: providerResults.reduce((total, result) => total + result.external_calls_made, 0),
        results: providerResults,
      },
      next_actions: record.next_actions,
      artifacts: runBriefArtifacts(record, resume.run_dir, rootDir, maxTextChars),
      resume_commands: resume.next_commands,
      next_commands: uniqueSorted([
        `npm run harness -- run-brief --run ${shellQuote(resume.run_dir)}`,
        `npm run harness -- resume --run ${shellQuote(resume.run_dir)}`,
        `npm run harness -- inventory --run ${shellQuote(resume.run_dir)}`,
        'npm run harness -- run-history',
        'npm run harness -- decision-surface --goal "Make WorthScan autonomous for Codex" --env-file .env',
        'npm run harness -- provider-preflight --env-file .env',
        'npm run harness -- provider-activation-plan --env-file .env',
        'npm run harness -- browser-research-plan --env-file .env',
        'npm run harness -- publishing-handoff-plan --env-file .env',
        'npm run harness -- capability-unlock-map --env-file .env',
        ...resume.next_commands,
      ]),
      error: null,
    };
  } catch (error) {
    return {
      created_at: new Date().toISOString(),
      root_dir: rootDir,
      run_dir: resume.run_dir,
      run_id: resume.run_id,
      status: 'unreadable',
      selected_job: resume.selected_job,
      missing_artifacts: resume.missing_artifacts,
      stage_status_counts: emptyStageStatusCounts(),
      stages: [],
      provider_gate_summary: {
        request_count: 0,
        blocked_count: 0,
        external_calls_made: 0,
        results: [],
      },
      next_actions: [],
      artifacts: [],
      resume_commands: resume.next_commands,
      next_commands: [
        `npm run harness -- resume --run ${shellQuote(resume.run_dir)}`,
        'npm run harness -- run-history',
      ],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runBriefArtifacts(
  record: HarnessRunRecord,
  runDir: string,
  rootDir: string,
  maxTextChars: number,
): HarnessRunBriefArtifact[] {
  const artifactSpecs: Array<{ role: string; filePath: string | undefined }> = [
    { role: 'run_record', filePath: path.join(runDir, 'run.json') },
    { role: 'primitives', filePath: record.primitives_path },
    { role: 'capabilities', filePath: record.capabilities_path },
    { role: 'information_index', filePath: record.information_index_path },
    { role: 'context_pack', filePath: record.context_pack_path },
    { role: 'job_rankings', filePath: record.job_rankings_path },
    { role: 'evidence_map', filePath: record.evidence_map_path },
    { role: 'launch_map', filePath: record.launch_map_path },
    { role: 'verification_map', filePath: record.verification_map_path },
    { role: 'capability_unlock_map', filePath: record.capability_unlock_map_path },
    { role: 'provider_route_map', filePath: record.provider_route_map_path },
    { role: 'provider_activation_plan', filePath: record.provider_activation_plan_path },
    { role: 'browser_research_plan', filePath: record.browser_research_plan_path },
    { role: 'publishing_handoff_plan', filePath: record.publishing_handoff_plan_path },
    { role: 'reproducibility_manifest', filePath: record.reproducibility_manifest_path },
    { role: 'autonomy_audit', filePath: record.autonomy_audit_path },
    { role: 'next_action', filePath: record.next_action_path },
    { role: 'provider_preflight', filePath: record.provider_preflight_path },
    { role: 'artifact_inventory', filePath: record.artifact_inventory_path },
    { role: 'blocker_ledger', filePath: record.blocker_ledger_path },
    { role: 'next_actions', filePath: record.next_actions_path },
    { role: 'prompt_packet', filePath: record.prompt_packet_path },
    { role: 'render_manifest', filePath: path.join(record.render_output_dir, 'manifest.json') },
    { role: 'render_caption', filePath: path.join(record.render_output_dir, 'output', 'caption.txt') },
    { role: 'render_posting_notes', filePath: path.join(record.render_output_dir, 'output', 'posting_notes.md') },
    { role: 'render_qa_checklist', filePath: path.join(record.render_output_dir, 'qa', 'checklist.md') },
  ];
  const seen = new Set<string>();
  return artifactSpecs
    .filter((spec): spec is { role: string; filePath: string } => typeof spec.filePath === 'string' && spec.filePath.length > 0)
    .map((spec) => ({ role: spec.role, absolutePath: path.isAbsolute(spec.filePath) ? spec.filePath : path.join(rootDir, spec.filePath) }))
    .filter((spec) => {
      if (seen.has(spec.absolutePath)) return false;
      seen.add(spec.absolutePath);
      return true;
    })
    .map((spec) => runBriefArtifact(spec.role, spec.absolutePath, rootDir, maxTextChars));
}

function runBriefArtifact(
  role: string,
  filePath: string,
  rootDir: string,
  maxTextChars: number,
): HarnessRunBriefArtifact {
  const exists = fs.existsSync(filePath);
  const kind = artifactKind(filePath);
  if (!exists) {
    return {
      role,
      path: relativeToRoot(rootDir, filePath),
      absolute_path: filePath,
      exists: false,
      kind,
      size_bytes: null,
      sha256: null,
    };
  }

  const content = fs.readFileSync(filePath);
  const artifact: HarnessRunBriefArtifact = {
    role,
    path: relativeToRoot(rootDir, filePath),
    absolute_path: filePath,
    exists: true,
    kind,
    size_bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
  if (kind === 'json' || kind === 'markdown' || kind === 'text') {
    const text = content.toString('utf8');
    artifact.excerpt = text.slice(0, maxTextChars);
    artifact.truncated = text.length > maxTextChars;
  }
  return artifact;
}

export function buildHarnessRunHistory(
  options: { rootDir?: string; limit?: number } = {},
): HarnessRunHistory {
  const rootDir = options.rootDir ?? process.cwd();
  const runsDir = path.join(rootDir, '.ops', 'harness', 'runs');
  const limit = Math.max(1, Math.floor(options.limit ?? 20));
  if (!fs.existsSync(runsDir)) {
    return {
      created_at: new Date().toISOString(),
      root_dir: rootDir,
      runs_dir: runsDir,
      exists: false,
      run_count: 0,
      returned_count: 0,
      limit,
      runs: [],
      next_commands: [
        'npm run harness -- auto --goal "<goal>"',
        'npm run harness -- run --goal "<goal>"',
      ],
    };
  }

  const candidates = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(runsDir, entry.name);
      const runPath = path.join(dir, 'run.json');
      const statPath = fs.existsSync(runPath) ? runPath : dir;
      return { dir, mtimeMs: fs.statSync(statPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.dir.localeCompare(b.dir));
  const runs = candidates.slice(0, limit).map((candidate) => runHistoryEntry(candidate.dir, rootDir));
  const latestUsable = runs.find((run) => run.status !== 'unreadable');

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    runs_dir: runsDir,
    exists: true,
    run_count: candidates.length,
    returned_count: runs.length,
    limit,
    runs,
    next_commands: [
      'npm run harness -- run-history',
      'npm run harness -- latest-run',
      ...(latestUsable ? [`npm run harness -- resume --run ${latestUsable.run_dir}`] : ['npm run harness -- auto --goal "<goal>"']),
      ...(latestUsable ? [`npm run harness -- run-brief --run ${latestUsable.run_dir}`] : []),
      'npm run harness -- inventory --run .ops/harness/runs/<run_id>',
    ],
  };
}

export function buildRepoStatus(rootDir = process.cwd()): HarnessRepoStatus {
  const gitRoot = gitOutput(rootDir, ['rev-parse', '--show-toplevel']);
  const branch = gitOutput(rootDir, ['branch', '--show-current']);
  const upstream = gitOutput(rootDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const remoteOutput = gitOutput(rootDir, ['remote', '-v']) ?? '';
  const statusOutput = gitOutput(rootDir, ['status', '--porcelain=v1', '-uall']) ?? '';
  const statusLines = statusOutput.split(/\r?\n/).filter((line) => line.trim());
  const modified = statusLines
    .filter((line) => !line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .sort();
  const modifiedSourceOfTruth = modified.filter((filePath) => isSourceOfTruthPath(filePath));
  const untracked = statusLines
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3))
    .sort();
  const untrackedSourceOfTruth = untracked.filter((filePath) => isSourceOfTruthPath(filePath));

  return {
    root_dir: rootDir,
    git_root: gitRoot?.trim() || null,
    branch: branch?.trim() || null,
    upstream: upstream?.trim() || null,
    remotes: remoteOutput.split(/\r?\n/).filter((line) => line.trim()).sort(),
    is_git_repo: Boolean(gitRoot?.trim()),
    dirty: statusLines.length > 0,
    modified,
    modified_count: modified.length,
    modified_source_of_truth_count: modifiedSourceOfTruth.length,
    modified_source_of_truth: modifiedSourceOfTruth,
    untracked,
    untracked_count: untracked.length,
    untracked_source_of_truth_count: untrackedSourceOfTruth.length,
    untracked_source_of_truth: untrackedSourceOfTruth,
  };
}

export function buildReproducibilityManifest(rootDir = process.cwd()): HarnessReproducibilityManifest {
  const repoStatus = buildRepoStatus(rootDir);
  const trackedSource = listTrackedSourceFiles(rootDir);
  const trackedOrModified = Array.from(new Set([
    ...trackedSource,
    ...repoStatus.modified.filter((filePath) => isSourceOfTruthPath(filePath)),
  ])).sort();
  const dirtySource = Array.from(new Set([
    ...repoStatus.modified_source_of_truth,
    ...repoStatus.untracked_source_of_truth,
  ])).sort();
  const files: HarnessReproducibilityFile[] = [
    ...trackedOrModified.map((filePath) => ({
      path: filePath,
      status: 'tracked_or_modified' as const,
      role: sourceOfTruthRole(filePath),
    })),
    ...repoStatus.untracked_source_of_truth.map((filePath) => ({
      path: filePath,
      status: 'untracked' as const,
      role: sourceOfTruthRole(filePath),
    })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const stagePaths = dirtySource;

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    repo_status: repoStatus,
    source_of_truth: {
      file_count: files.length,
      tracked_or_modified_count: trackedOrModified.length,
      modified_count: repoStatus.modified_source_of_truth_count,
      untracked_count: repoStatus.untracked_source_of_truth_count,
      dirty_count: dirtySource.length,
      files,
    },
    generated_artifacts: {
      ignored_or_runtime_paths: [
        '.ops/creative_jobs/rendered/',
        '.ops/harness/',
        '.ops/harness/runs/',
        '.ops/harness/source_packages/',
        'trend_outputs/',
        'trend_examples.sqlite',
        'node_modules/',
        'dist/',
        'build/',
        'output/',
      ],
      notes: [
        'Rendered creative packages are local review artifacts and should not be required for source reproducibility.',
        'Harness run folders are durable local evidence but can be regenerated from tracked source-of-truth inputs.',
        'Database files and trend outputs are runtime artifacts unless explicitly promoted into fixtures or manifests.',
      ],
    },
    commands: {
      inspect: [
        'npm run harness -- repo-status',
        'npm run harness -- reproducibility-manifest',
        'npm run harness -- stage-source --dry-run',
        'npm run harness -- source-package',
        'npm run harness -- provider-preflight',
        'git status --short --untracked-files=all',
      ],
      stage_source_of_truth: stagePaths.length ? `git add ${stagePaths.map(shellQuote).join(' ')}` : null,
      verify: [
        'npm run typecheck -- --pretty false',
        'npm test -- --runInBand',
        'npm run harness -- doctor',
      ],
    },
  };
}

export function buildVerificationMap(rootDir = process.cwd()): HarnessVerificationMap {
  const repoStatus = buildRepoStatus(rootDir);
  const reproducibility = buildReproducibilityManifest(rootDir);
  const changedFiles = [
    ...repoStatus.modified.map((filePath): HarnessVerificationChangedFile => {
      const targetIds = validationTargetIdsForPath(filePath);
      return {
        path: filePath,
        status: 'modified_or_staged',
        source_of_truth: isSourceOfTruthPath(filePath),
        role: sourceOfTruthRole(filePath),
        validation_target_ids: targetIds,
      };
    }),
    ...repoStatus.untracked.map((filePath): HarnessVerificationChangedFile => {
      const targetIds = validationTargetIdsForPath(filePath);
      return {
        path: filePath,
        status: 'untracked',
        source_of_truth: isSourceOfTruthPath(filePath),
        role: sourceOfTruthRole(filePath),
        validation_target_ids: targetIds,
      };
    }),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const targetIds = Array.from(new Set([
    ...changedFiles.flatMap((file) => file.validation_target_ids),
    ...(changedFiles.length ? ['typescript.typecheck'] : []),
    ...(changedFiles.some((file) => file.source_of_truth) ? ['harness.stage_source_dry_run'] : []),
    'harness.autonomy_audit',
    'harness.doctor',
    ...(changedFiles.length ? ['test.full_suite'] : []),
  ]));
  const targets = targetIds
    .map((id) => verificationTargetForId(id, changedFiles))
    .filter((target): target is HarnessVerificationTarget => Boolean(target));
  const recommendedCommands = Array.from(new Set(targets.flatMap((target) => target.commands)));

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    dirty: repoStatus.dirty,
    changed_file_count: changedFiles.length,
    changed_source_of_truth_count: changedFiles.filter((file) => file.source_of_truth).length,
    changed_files: changedFiles,
    validation_targets: targets,
    recommended_commands: recommendedCommands,
    stage_source_command: reproducibility.commands.stage_source_of_truth,
    notes: repoStatus.dirty
      ? [
        'Run targeted checks first, then the full suite before committing.',
        'Use stage-source --dry-run before staging to keep generated artifacts out of git.',
      ]
      : [
        'No changed files are currently reported by git.',
        'Use the baseline audit and doctor commands before claiming the autonomy goal is complete.',
      ],
  };
}

export function buildCapabilityPlan(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessCapabilityPlan {
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const incomingJobs = listIncomingJobs(rootDir).map((item) => ({
    ...item,
    job: loadCreativeJobManifest(item.path),
  }));
  const providerRequests = listProviderRequests(rootDir).map((item) => {
    const request = loadProviderRequestManifest(item.path);
    const preflight = buildProviderPreflight(item.path, env, rootDir);
    const dryRun = runProviderDryRun(request, { env });
    const credentialAvailable = providerCredentialAvailable(request.provider, capabilityProfile);
    const requiredEnv = requiredEnvForProvider(request.provider);
    const missingGates = missingGatesForProviderRequest(request, capabilityProfile, credentialAvailable);
    return {
      request_id: request.request_id,
      provider: request.provider,
      provider_mode: request.provider_mode,
      path: item.path,
      status: request.status,
      dry_run_status: dryRun.status,
      input_assets_ready: preflight.ready_for_provider_handoff,
      missing_input_assets: preflight.missing_input_assets,
      missing_prompt: preflight.missing_prompt,
      prepare_command: preflight.suggested_prepare_command,
      credential_available: credentialAvailable,
      required_env: requiredEnv,
      missing_gates: missingGates,
      policy_allows_requested_capability: providerRequestPolicyAllowsCapability(request),
      live_external_call_allowed: providerLiveCallAllowed(request, capabilityProfile, credentialAvailable),
      next_action: capabilityNextAction(request, missingGates, credentialAvailable),
    };
  });
  const anyLiveProviderReady = providerRequests.some((request) => request.live_external_call_allowed);
  const providerLaneStatus = anyLiveProviderReady
    ? 'ready'
    : providerRequests.some((request) => request.missing_gates.includes('provider credential'))
    ? 'needs_credential'
    : capabilityProfile.gates.allow_paid_generation
      ? 'ready'
      : 'needs_gate';
  const preparedProviderRequestCount = providerRequests.filter((request) => request.input_assets_ready).length;
  const browserReviewedDir = path.join(rootDir, '.ops', 'browser', 'captures', 'reviewed');
  const browserRawDir = path.join(rootDir, '.ops', 'browser', 'captures', 'raw');
  const publishingJobs = incomingJobs.filter(({ job }) => job.provider_policy.allow_social_publishing);
  const approvedJobsReadyForPosting = publishingJobs
    .filter(({ job }) => {
      const assetsApproved = job.generated_assets.length > 0 && job.generated_assets.every((asset) => asset.approved_for_posting);
      return job.approval_status.state === 'approved' && Boolean(job.approval_status.human_reviewer) && assetsApproved;
    })
    .map(({ job_id }) => job_id);

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    capability_profile: capabilityProfile,
    lanes: [
      {
        id: 'local',
        status: incomingJobs.length ? 'ready' : 'blocked',
        evidence: [
          `incoming_job_count=${incomingJobs.length}`,
          `top_ranked_job=${rankIncomingJobs(env, rootDir)[0]?.job_id ?? 'none'}`,
        ],
        next_commands: [
          'npm run harness -- rank-jobs',
          'npm run harness -- auto --goal "<goal>"',
        ],
      },
      {
        id: 'provider',
        status: providerLaneStatus,
        evidence: [
          `ALLOW_PAID_GENERATION=${capabilityProfile.gates.allow_paid_generation}`,
          `openai_api_key_available=${capabilityProfile.credentials.openai_api_key_available}`,
          `gemini_api_key_available=${capabilityProfile.credentials.gemini_api_key_available}`,
          `provider_request_count=${providerRequests.length}`,
          `prepared_provider_request_count=${preparedProviderRequestCount}`,
          `live_external_call_allowed=${anyLiveProviderReady}`,
        ],
        next_commands: [
          'npm run harness -- capability-plan',
          'npm run harness -- provider-preflight',
          'npm run harness -- prepare-provider-inputs --request .ops/provider_requests/sample_openai_image_request.json',
          'npm run harness -- provider-handoff --request .ops/provider_requests/sample_openai_image_request.json',
          'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-dry --file .ops/provider_requests/sample_openai_image_request.json',
          'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-live --file .ops/provider_requests/sample_openai_image_live_request.json --package-dir .ops/creative_jobs/rendered/scan_bike_001',
        ],
      },
      {
        id: 'browser',
        status: capabilityProfile.gates.allow_browser_ui ? 'ready' : 'needs_gate',
        evidence: [
          `ALLOW_BROWSER_UI=${capabilityProfile.gates.allow_browser_ui}`,
          `reviewed_capture_count=${countJsonFiles(browserReviewedDir)}`,
          `raw_capture_count=${countJsonFiles(browserRawDir)}`,
        ],
        next_commands: [
          'npm run harness -- browser-research-plan --env-file .env',
          'npm run trend -- browser:validate-capture --file .ops/browser/captures/reviewed/<capture>.json',
          'ALLOW_BROWSER_UI=true npm run harness -- capability-plan',
        ],
      },
      {
        id: 'publishing',
        status: approvedJobsReadyForPosting.length && capabilityProfile.gates.allow_social_publishing ? 'ready' : 'human_boundary',
        evidence: [
          `ALLOW_SOCIAL_PUBLISHING=${capabilityProfile.gates.allow_social_publishing}`,
          `jobs_allowing_social_publishing=${publishingJobs.length}`,
          `approved_jobs_ready_for_posting=${approvedJobsReadyForPosting.length}`,
        ],
        next_commands: [
          'npm run harness -- publishing-handoff-plan --env-file .env',
          'npm run harness -- blockers',
          'ALLOW_SOCIAL_PUBLISHING=true npm run harness -- capability-plan',
        ],
      },
    ],
    provider_requests: providerRequests,
    browser: {
      allowed_tasks_path: filePathIfExists(rootDir, '.ops/browser/allowed_browser_tasks.md'),
      blocked_tasks_path: filePathIfExists(rootDir, '.ops/browser/blocked_browser_tasks.md'),
      reviewed_capture_count: countJsonFiles(browserReviewedDir),
      raw_capture_count: countJsonFiles(browserRawDir),
    },
    publishing: {
      launch_queue_path: filePathIfExists(rootDir, '.ops/launch/launch_queue.md'),
      jobs_allowing_social_publishing: publishingJobs.map(({ job_id }) => job_id),
      approved_jobs_ready_for_posting: approvedJobsReadyForPosting,
    },
  };
}

export function buildCapabilityUnlockMap(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessCapabilityUnlockMap {
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const providerPreflight = preflightProviderRequests(env, rootDir);
  const launchMap = buildLaunchMap(env, rootDir);
  const paidRequests = providerPreflight.preflights.filter((request) => (
    request.provider === 'openai_image'
    || request.provider === 'gemini_image'
    || request.provider === 'gemini_video_understanding'
  ));
  const browserRequests = providerPreflight.preflights.filter((request) => request.provider === 'browser_manual');
  const providerCredentials = uniqueSorted(paidRequests.flatMap((request) => {
    if (request.provider === 'openai_image') return ['OPENAI_API_KEY'];
    if (request.provider === 'gemini_image' || request.provider === 'gemini_video_understanding') {
      return ['GEMINI_API_KEY or GOOGLE_API_KEY'];
    }
    return [];
  }));
  const providerLiveReady = paidRequests.some((request) => request.ready_for_live_request);
  const providerHandoffReady = paidRequests.some((request) => request.ready_for_provider_handoff);
  const browserEnabled = capabilityProfile.gates.allow_browser_ui;
  const publishingEnabled = capabilityProfile.gates.allow_social_publishing;
  const providerBlockers = uniqueSorted(paidRequests.flatMap((request) => request.live_blockers));
  const browserBlockers = uniqueSorted(browserRequests.flatMap((request) => request.live_blockers));
  const publishingBlockers = uniqueSorted(launchMap.jobs.flatMap((job) => job.blockers));
  const lanes: HarnessCapabilityUnlockLane[] = [
    {
      id: 'local',
      status: 'ready',
      current_enabled: true,
      required_env: [],
      required_credentials: [],
      policy_preconditions: [
        'incoming creative job exists',
        'secret scan clear',
        'local renderer approved',
      ],
      related_requests: [],
      related_jobs: [],
      safe_probe_commands: [
        'npm run harness -- rank-jobs',
        'npm run harness -- evidence-map',
        'npm run harness -- verification-map',
      ],
      activation_commands: ['npm run harness -- auto --goal "<goal>"'],
      verification_commands: [
        'npm run harness -- autonomy-audit --goal "Make WorthScan autonomous for Codex"',
        'npm run harness -- doctor',
      ],
      blockers: [],
    },
    {
      id: 'paid_provider_generation',
      status: providerLiveReady ? 'ready' : providerHandoffReady ? 'partially_ready' : 'locked',
      current_enabled: capabilityProfile.gates.allow_paid_generation,
      required_env: ['ALLOW_PAID_GENERATION=true'],
      required_credentials: providerCredentials,
      policy_preconditions: [
        'provider request status is draft',
        'provider request mode is generation for live OpenAI image calls',
        'provider request cost policy allows paid generation and external calls',
        'declared input assets exist',
      ],
      related_requests: paidRequests.map(capabilityUnlockRequest),
      related_jobs: [],
      safe_probe_commands: [
        'npm run harness -- capability-env --env-file .env',
        'npm run harness -- provider-preflight --env-file .env',
        'npm run harness -- provider-activation-plan --env-file .env',
        'npm run harness -- provider-handoff --request .ops/provider_requests/sample_openai_image_live_request.json --env-file .env',
      ],
      activation_commands: [
        'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-dry --env-file .env --file .ops/provider_requests/sample_openai_image_live_request.json',
        'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-live --env-file .env --file .ops/provider_requests/sample_openai_image_live_request.json --package-dir .ops/creative_jobs/rendered/scan_bike_001',
      ],
      verification_commands: [
        'npm run harness -- provider-preflight --env-file .env',
        'npm run harness -- capability-plan --env-file .env',
        'npm run harness -- autonomy-audit --goal "Make WorthScan autonomous for Codex" --env-file .env',
      ],
      blockers: providerBlockers,
    },
    {
      id: 'browser_research',
      status: browserEnabled && browserRequests.every((request) => request.ready_for_live_request) ? 'ready' : 'locked',
      current_enabled: browserEnabled,
      required_env: ['ALLOW_BROWSER_UI=true'],
      required_credentials: [],
      policy_preconditions: [
        'browser task is listed as allowed',
        'capture is reviewed before ingestion',
        'no account automation or scraping beyond approved capture workflow',
      ],
      related_requests: browserRequests.map(capabilityUnlockRequest),
      related_jobs: [],
      safe_probe_commands: [
        'npm run harness -- browser-research-plan --env-file .env',
        'npm run harness -- capability-plan --env-file .env',
        'npm run trend -- browser:validate-capture --file .ops/browser/captures/reviewed/<capture>.json',
      ],
      activation_commands: [
        'ALLOW_BROWSER_UI=true npm run harness -- capability-plan --env-file .env',
      ],
      verification_commands: [
        'npm run harness -- browser-research-plan --env-file .env',
        'npm run harness -- capability-plan --env-file .env',
        'npm exec tsx -- --test tests/browser-capture.test.ts --runInBand',
      ],
      blockers: browserBlockers,
    },
    {
      id: 'social_publishing',
      status: publishingEnabled && launchMap.autonomous_publish_ready_job_count > 0 ? 'ready' : 'human_boundary',
      current_enabled: publishingEnabled,
      required_env: ['ALLOW_SOCIAL_PUBLISHING=true'],
      required_credentials: [],
      policy_preconditions: [
        'job policy allows social publishing',
        'human reviewer approved the job',
        'all generated assets are approved for posting',
        'account owner confirms platform account ownership and final post',
      ],
      related_requests: [],
      related_jobs: launchMap.jobs.map((job) => ({
        job_id: job.job_id,
        manual_handoff_ready: job.manual_handoff_ready,
        autonomous_publish_ready: job.autonomous_publish_ready,
        blockers: job.blockers,
      })),
      safe_probe_commands: [
        'npm run harness -- publishing-handoff-plan --env-file .env',
        'npm run harness -- launch-map',
        'npm run harness -- blockers',
      ],
      activation_commands: [
        'ALLOW_SOCIAL_PUBLISHING=true npm run harness -- capability-plan --env-file .env',
      ],
      verification_commands: [
        'npm run harness -- publishing-handoff-plan --env-file .env',
        'npm run harness -- launch-map',
        'npm exec tsx -- --test tests/launch-kit.test.ts --runInBand',
      ],
      blockers: publishingBlockers,
    },
  ];

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    capability_profile: capabilityProfile,
    credential_policy: capabilityProfile.credential_policy,
    lanes,
    next_commands: [
      'npm run harness -- capability-env --env-file .env',
      'npm run harness -- capability-plan --env-file .env',
      'npm run harness -- provider-preflight --env-file .env',
      'npm run harness -- provider-activation-plan --env-file .env',
      'npm run harness -- publishing-handoff-plan --env-file .env',
      'npm run harness -- launch-map',
      'npm run harness -- verification-map',
    ],
  };
}

export function stageSourceOfTruth(
  options: { apply?: boolean; rootDir?: string } = {},
): HarnessStageSourceReport {
  const rootDir = options.rootDir ?? process.cwd();
  const beforeManifest = buildReproducibilityManifest(rootDir);
  const stagePaths = Array.from(new Set([
    ...beforeManifest.repo_status.modified_source_of_truth,
    ...beforeManifest.repo_status.untracked_source_of_truth,
  ])).sort();
  const warnings: string[] = [];

  if (!beforeManifest.repo_status.is_git_repo) {
    warnings.push('Not a git repository; no staging command can be applied.');
  }
  if (!stagePaths.length) {
    warnings.push('No dirty source-of-truth files found.');
  }

  const command = stagePaths.length ? `git add ${stagePaths.map(shellQuote).join(' ')}` : null;
  if (options.apply && stagePaths.length) {
    execFileSync('git', ['add', ...stagePaths], {
      cwd: rootDir,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  }

  const afterManifest = options.apply ? buildReproducibilityManifest(rootDir) : undefined;
  const result: HarnessStageSourceReport = {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    dry_run: !options.apply,
    applied: Boolean(options.apply && stagePaths.length),
    before: {
      modified_source_of_truth_count: beforeManifest.repo_status.modified_source_of_truth_count,
      untracked_source_of_truth_count: beforeManifest.repo_status.untracked_source_of_truth_count,
      dirty_source_of_truth_count: beforeManifest.source_of_truth.dirty_count,
    },
    staged_paths: stagePaths,
    excluded_generated_paths: beforeManifest.generated_artifacts.ignored_or_runtime_paths,
    command,
    warnings,
  };

  if (afterManifest) {
    result.after = {
      modified_source_of_truth_count: afterManifest.repo_status.modified_source_of_truth_count,
      untracked_source_of_truth_count: afterManifest.repo_status.untracked_source_of_truth_count,
      dirty_source_of_truth_count: afterManifest.source_of_truth.dirty_count,
    };
  }

  return result;
}

export function exportSourcePackage(
  options: { rootDir?: string; outDir?: string; packageId?: string } = {},
): HarnessSourcePackageReport {
  const rootDir = options.rootDir ?? process.cwd();
  const createdAt = new Date().toISOString();
  const packageId = options.packageId ?? createPackageId(createdAt);
  const packageDir = path.resolve(options.outDir ?? path.join(rootDir, '.ops', 'harness', 'source_packages', packageId));
  const filesDir = path.join(packageDir, 'files');

  if (fs.existsSync(packageDir) && fs.readdirSync(packageDir).length > 0) {
    throw new Error(`source package output directory already exists and is not empty: ${packageDir}`);
  }

  const reproducibilityManifest = buildReproducibilityManifest(rootDir);
  const sourceFiles = reproducibilityManifest.source_of_truth.files;
  fs.mkdirSync(filesDir, { recursive: true });

  const files: HarnessSourcePackageFile[] = [];
  for (const sourceFile of sourceFiles) {
    const sourcePath = path.join(rootDir, sourceFile.path);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`source-of-truth file is missing and cannot be packaged: ${sourceFile.path}`);
    }
    const packagePath = path.join(filesDir, sourceFile.path);
    fs.mkdirSync(path.dirname(packagePath), { recursive: true });
    fs.copyFileSync(sourcePath, packagePath);
    const content = fs.readFileSync(packagePath);
    files.push({
      source_path: sourceFile.path,
      package_path: path.relative(packageDir, packagePath),
      role: sourceFile.role,
      size_bytes: content.byteLength,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    });
  }

  const aggregateSha256 = aggregateFileHashes(files);
  const reproducibilityManifestPath = path.join(packageDir, 'reproducibility_manifest.json');
  const manifestPath = path.join(packageDir, 'source_package.json');
  const report: HarnessSourcePackageReport = {
    created_at: createdAt,
    root_dir: rootDir,
    package_dir: packageDir,
    files_dir: filesDir,
    manifest_path: manifestPath,
    reproducibility_manifest_path: reproducibilityManifestPath,
    source_file_count: files.length,
    dirty_source_file_count: reproducibilityManifest.source_of_truth.dirty_count,
    aggregate_sha256: aggregateSha256,
    files,
    excluded_generated_paths: reproducibilityManifest.generated_artifacts.ignored_or_runtime_paths,
    verify_command: `npm run harness -- verify-source-package --package ${shellQuote(packageDir)}`,
  };

  fs.writeFileSync(reproducibilityManifestPath, `${JSON.stringify(reproducibilityManifest, null, 2)}\n`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifySourcePackage(packageDir: string): HarnessSourcePackageVerification {
  const resolvedPackageDir = path.resolve(packageDir);
  const manifestPath = path.join(resolvedPackageDir, 'source_package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`source_package.json not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as HarnessSourcePackageReport;
  const missingFiles: string[] = [];
  const hashMismatches: HarnessSourcePackageVerification['hash_mismatches'] = [];
  const actualFiles: HarnessSourcePackageFile[] = [];

  for (const file of manifest.files) {
    const packagePath = path.join(resolvedPackageDir, file.package_path);
    if (!fs.existsSync(packagePath)) {
      missingFiles.push(file.package_path);
      continue;
    }
    const content = fs.readFileSync(packagePath);
    const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
    actualFiles.push({ ...file, size_bytes: content.byteLength, sha256: actualSha256 });
    if (actualSha256 !== file.sha256) {
      hashMismatches.push({
        path: file.package_path,
        expected_sha256: file.sha256,
        actual_sha256: actualSha256,
      });
    }
  }

  const aggregateSha256 = missingFiles.length ? null : aggregateFileHashes(actualFiles);
  if (aggregateSha256 && aggregateSha256 !== manifest.aggregate_sha256) {
    hashMismatches.push({
      path: 'source_package.aggregate',
      expected_sha256: manifest.aggregate_sha256,
      actual_sha256: aggregateSha256,
    });
  }

  return {
    package_dir: resolvedPackageDir,
    manifest_path: manifestPath,
    ok: missingFiles.length === 0 && hashMismatches.length === 0,
    source_file_count: manifest.source_file_count,
    aggregate_sha256: aggregateSha256,
    missing_files: missingFiles,
    hash_mismatches: hashMismatches,
  };
}

export function buildAutonomyAudit(
  goal = 'Make WorthScan autonomous for Codex',
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessAutonomyAudit {
  const repoStatus = buildRepoStatus(rootDir);
  const reproducibility = buildReproducibilityManifest(rootDir);
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const primitives = listCodexPrimitives();
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  const incomingJobs = listIncomingJobs(rootDir);
  const providerRequests = listProviderRequests(rootDir);
  const providerPreflight = preflightProviderRequests(env, rootDir);
  const liveReadyProviderRequestCount = providerPreflight.preflights.filter((preflight) => preflight.ready_for_live_request).length;
  const informationSources = buildInformationIndex(rootDir);
  const secretFindings = scanRepositoryForSecrets(rootDir);
  const dirtySourceCount = reproducibility.source_of_truth.dirty_count;
  const hasProviderCredential = capabilityProfile.credentials.openai_api_key_available
    || capabilityProfile.credentials.gemini_api_key_available
    || capabilityProfile.credentials.lightreel_api_key_available
    || capabilityProfile.credentials.scrape_creators_api_key_available;
  const requiredInformationPrimitives = [
    'harness.inspect',
    'harness.doctor',
    'harness.repo_status',
    'harness.capability_plan',
    'harness.capability_unlock_map',
    'harness.capability_env',
    'harness.credential_coverage',
    'harness.provider_route_map',
    'harness.reproducibility_manifest',
    'harness.verification_map',
    'harness.autonomy_audit',
    'harness.goal_completion_audit',
    'harness.autonomy_plan',
    'harness.next_action',
    'harness.decision_surface',
    'harness.source_package',
    'harness.verify_source_package',
    'harness.information_index',
    'harness.context_pack',
    'harness.rank_jobs',
    'harness.job_matrix',
    'harness.evidence_map',
    'harness.launch_map',
    'harness.resume',
    'harness.run_history',
    'harness.run_brief',
    'harness.inventory',
    'harness.blockers',
    'harness.provider_preflight',
    'harness.prepare_provider_inputs',
    'harness.provider_handoff',
    'provider.live_run',
  ];
  const missingInformationPrimitives = requiredInformationPrimitives.filter((id) => !primitiveIds.has(id));
  const criteria: HarnessAutonomyAuditCriterion[] = [
    {
      id: 'codex.information_primitives',
      status: missingInformationPrimitives.length ? 'open' : 'passed',
      evidence: missingInformationPrimitives.length
        ? [`Missing primitive id(s): ${missingInformationPrimitives.join(', ')}`]
        : [`${requiredInformationPrimitives.length} required information primitive(s) are available.`],
      next_action: missingInformationPrimitives.length
        ? 'Add missing primitive commands before treating the harness as Codex-operable.'
        : 'Use npm run harness -- primitives for the callable command menu.',
    },
    {
      id: 'codex.local_execution',
      status: incomingJobs.length && secretFindings.length === 0 ? 'passed' : 'blocked',
      evidence: [
        `incoming_job_count=${incomingJobs.length}`,
        `secret_finding_count=${secretFindings.length}`,
        `top_ranked_job=${rankIncomingJobs(env, rootDir)[0]?.job_id ?? 'none'}`,
      ],
      next_action: incomingJobs.length && secretFindings.length === 0
        ? 'Run npm run harness -- auto --goal "<goal>" for the next bounded local pass.'
        : 'Add at least one valid incoming job and clear secret findings before autonomous local execution.',
    },
    {
      id: 'codex.reproducibility',
      status: dirtySourceCount ? 'blocked' : 'passed',
      evidence: dirtySourceCount
        ? [
          `${repoStatus.modified_source_of_truth_count} source-of-truth file(s) are modified or staged.`,
          `${repoStatus.untracked_source_of_truth_count} source-of-truth file(s) are untracked.`,
          `stage_source_of_truth=${reproducibility.commands.stage_source_of_truth}`,
        ]
        : ['No dirty source-of-truth files found.'],
      next_action: dirtySourceCount
        ? 'Stage and commit the manifest-listed source-of-truth files, then rerun npm run harness -- autonomy-audit --goal "<goal>".'
        : 'Keep generated artifacts out of git unless intentionally promoted.',
    },
    {
      id: 'codex.provider_autonomy',
      status: liveReadyProviderRequestCount > 0 ? 'passed' : 'open',
      evidence: [
        `ALLOW_PAID_GENERATION=${capabilityProfile.gates.allow_paid_generation}`,
        `provider_credential_available=${hasProviderCredential}`,
        `provider_request_count=${providerRequests.length}`,
        `prepared_provider_request_count=${providerPreflight.prepared_request_count}`,
        `live_ready_provider_request_count=${liveReadyProviderRequestCount}`,
      ],
      next_action: liveReadyProviderRequestCount > 0
        ? 'Route live provider work through provider:run-live and declared package outputs; keep secret values and b64 payloads out of artifacts.'
        : 'Use provider-preflight and prepare-provider-inputs locally, then stay in dry-run mode until a live request, provider key, and explicit ALLOW_PAID_GENERATION gate are present.',
    },
    {
      id: 'codex.browser_autonomy',
      status: capabilityProfile.gates.allow_browser_ui ? 'passed' : 'open',
      evidence: [`ALLOW_BROWSER_UI=${capabilityProfile.gates.allow_browser_ui}`],
      next_action: capabilityProfile.gates.allow_browser_ui
        ? 'Validate browser captures before ingesting them into trend evidence.'
        : 'Use local/manual capture files until browser UI automation is explicitly enabled.',
    },
    {
      id: 'codex.publishing_autonomy',
      status: capabilityProfile.gates.allow_social_publishing ? 'passed' : 'open',
      evidence: [`ALLOW_SOCIAL_PUBLISHING=${capabilityProfile.gates.allow_social_publishing}`],
      next_action: capabilityProfile.gates.allow_social_publishing
        ? 'Require approved assets, job policy approval, and account-owner confirmation before marking items posted.'
        : 'Keep social publishing at the human confirmation boundary.',
    },
    {
      id: 'codex.information_surface',
      status: informationSources.length >= 20 ? 'passed' : 'open',
      evidence: [
        `information_source_count=${informationSources.length}`,
        `schema_count=${informationSources.filter((source) => source.kind === 'schema').length}`,
        `test_count=${informationSources.filter((source) => source.kind === 'test').length}`,
      ],
      next_action: informationSources.length >= 20
        ? 'Use npm run harness -- context-pack for bounded source excerpts.'
        : 'Add more schemas, ops docs, provider requests, or tests to improve Codex context.',
    },
  ];
  const hasBlocked = criteria.some((criterion) => criterion.status === 'blocked');
  const hasOpenCapability = criteria.some((criterion) => criterion.status === 'open' && criterion.id.includes('autonomy'));
  const summaryStatus: HarnessAutonomyAudit['summary_status'] = hasBlocked
    ? dirtySourceCount
      ? 'needs_reproducibility'
      : 'blocked'
    : hasOpenCapability
      ? 'needs_capability'
      : 'local_autonomy_ready';

  return {
    created_at: new Date().toISOString(),
    goal,
    root_dir: rootDir,
    summary_status: summaryStatus,
    criteria,
    next_commands: [
      'npm run harness -- reproducibility-manifest',
      'npm run harness -- stage-source --dry-run',
      'npm run harness -- source-package',
      'npm run harness -- provider-preflight',
    'npm run harness -- provider-route-map --env-file .env',
    'npm run harness -- provider-activation-plan --env-file .env',
    'npm run harness -- browser-research-plan --env-file .env',
    'npm run harness -- provider-handoff --request .ops/provider_requests/sample_openai_image_request.json',
      'npm run harness -- capability-plan',
      'npm run harness -- capability-unlock-map',
      'npm run harness -- credential-coverage --env-file .env',
      'npm run harness -- goal-completion-audit --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- next-action --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- decision-surface --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- run-history',
      'npm run harness -- run-brief',
      'npm run harness -- doctor',
      'npm run harness -- auto --goal "<goal>"',
      ...reproducibility.commands.verify,
    ],
  };
}

export function findLatestHarnessRun(rootDir = process.cwd()): HarnessResumeReport | null {
  const runsDir = path.join(rootDir, '.ops', 'harness', 'runs');
  if (!fs.existsSync(runsDir)) return null;

  const candidates = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'run.json')))
    .map((dir) => ({ dir, mtimeMs: fs.statSync(path.join(dir, 'run.json')).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const candidate of candidates) {
    try {
      return resumeHarnessRun(candidate.dir);
    } catch {
      // Ignore malformed run folders; the doctor should still report the best usable run.
    }
  }
  return null;
}

export function buildGoalCompletionAudit(
  goal = 'Make WorthScan autonomous for Codex',
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessGoalCompletionAudit {
  const repoStatus = buildRepoStatus(rootDir);
  const reproducibility = buildReproducibilityManifest(rootDir);
  const autonomyAudit = buildAutonomyAudit(goal, env, rootDir);
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const capabilityPlan = buildCapabilityPlan(env, rootDir);
  const credentialCoverage = buildCredentialCoverageMap({ env, rootDir });
  const providerActivationPlan = buildProviderActivationPlan({ env, rootDir });
  const browserResearchPlan = buildBrowserResearchPlan({ env, rootDir });
  const publishingHandoffPlan = buildPublishingHandoffPlan({ env, rootDir });
  const providerPreflight = preflightProviderRequests(env, rootDir);
  const launchMap = buildLaunchMap(env, rootDir);
  const runHistory = buildHarnessRunHistory({ rootDir });
  const primitives = listCodexPrimitives();
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  const secretFindings = scanRepositoryForSecrets(rootDir);
  const providerLiveReadyCount = providerPreflight.preflights.filter((preflight) => preflight.ready_for_live_request).length;
  const localLane = capabilityPlan.lanes.find((lane) => lane.id === 'local');
  const providerLane = capabilityPlan.lanes.find((lane) => lane.id === 'provider');
  const browserLane = capabilityPlan.lanes.find((lane) => lane.id === 'browser');
  const publishingLane = capabilityPlan.lanes.find((lane) => lane.id === 'publishing');
  const requiredGoalPrimitives = [
    'harness.autonomy_audit',
    'harness.goal_completion_audit',
    'harness.autonomy_plan',
    'harness.next_action',
    'harness.decision_surface',
    'harness.capability_plan',
    'harness.capability_unlock_map',
    'harness.credential_coverage',
    'harness.provider_route_map',
    'harness.provider_activation_plan',
    'harness.browser_research_plan',
    'harness.publishing_handoff_plan',
    'harness.provider_preflight',
    'harness.run_history',
    'harness.run_brief',
    'harness.verification_map',
    'harness.stage_source',
  ];
  const missingGoalPrimitives = requiredGoalPrimitives.filter((id) => !primitiveIds.has(id));
  const requirements: HarnessGoalCompletionRequirement[] = [
    {
      id: 'goal.repo_reproducibility',
      requirement: 'The current checkout is reproducible and has no dirty source-of-truth changes.',
      status: reproducibility.source_of_truth.dirty_count === 0 && repoStatus.is_git_repo ? 'passed' : 'blocked',
      evidence: [
        `is_git_repo=${repoStatus.is_git_repo}`,
        `dirty_source_of_truth_count=${reproducibility.source_of_truth.dirty_count}`,
        `branch=${repoStatus.branch ?? 'unknown'}`,
      ],
      blockers: reproducibility.source_of_truth.dirty_count
        ? [`stage_source_of_truth=${reproducibility.commands.stage_source_of_truth ?? 'unavailable'}`]
        : [],
      proof_commands: [
        'git status --short --branch --untracked-files=all',
        'npm run harness -- reproducibility-manifest',
        'npm run harness -- stage-source --dry-run',
      ],
      next_action: reproducibility.source_of_truth.dirty_count
        ? 'Stage and commit source-of-truth changes before claiming the goal is complete.'
        : 'Keep generated artifacts ignored and rerun reproducibility checks after each edit.',
    },
    {
      id: 'goal.codex_information_primitives',
      requirement: 'Codex has callable, machine-readable primitives for repo state, plans, context, jobs, evidence, launches, credentials, providers, runs, and verification.',
      status: missingGoalPrimitives.length ? 'open' : 'passed',
      evidence: [
        `primitive_count=${primitives.length}`,
        `required_goal_primitive_count=${requiredGoalPrimitives.length}`,
      ],
      blockers: missingGoalPrimitives.map((id) => `missing primitive: ${id}`),
      proof_commands: [
        'npm run harness -- primitives',
        'npm run harness -- inspect',
        'npm run harness -- goal-completion-audit --goal "<goal>" --env-file .env',
        'npm run harness -- decision-surface --goal "<goal>" --env-file .env',
      ],
      next_action: missingGoalPrimitives.length
        ? 'Add any missing primitive before treating the harness as complete for Codex.'
        : 'Use primitives, inspect, and context-pack as the standard Codex information entrypoints.',
    },
    {
      id: 'goal.local_autonomous_loop',
      requirement: 'Codex can safely run a bounded local autonomous loop that selects work, renders artifacts, persists context, and stops at explicit gates.',
      status: localLane?.status === 'ready' && secretFindings.length === 0 ? 'passed' : 'blocked',
      evidence: [
        `local_lane_status=${localLane?.status ?? 'missing'}`,
        `incoming_job_count=${listIncomingJobs(rootDir).length}`,
        `secret_finding_count=${secretFindings.length}`,
        `run_history_exists=${runHistory.exists}`,
        `run_count=${runHistory.run_count}`,
      ],
      blockers: [
        ...(localLane?.status === 'ready' ? [] : [`local_lane_status=${localLane?.status ?? 'missing'}`]),
        ...(secretFindings.length ? [`secret_finding_count=${secretFindings.length}`] : []),
      ],
      proof_commands: [
        'npm run harness -- auto --goal "<goal>"',
        'npm run harness -- run-history',
        'npm run harness -- latest-run',
      ],
      next_action: localLane?.status === 'ready' && secretFindings.length === 0
        ? 'Run auto when a fresh durable local pass is useful; inspect run-history before rerunning work.'
        : 'Restore local runnable jobs and clear secret findings before running auto.',
    },
    {
      id: 'goal.api_key_provider_path',
      requirement: 'If an API key is available, Codex can determine whether it is usable for current provider requests and can run only through reviewed, gated provider commands.',
      status: providerLiveReadyCount > 0
        ? 'passed'
        : credentialCoverage.summary.missing_required_count || !capabilityProfile.gates.allow_paid_generation
          ? 'open'
          : 'blocked',
      evidence: [
        `provider_lane_status=${providerLane?.status ?? 'missing'}`,
        `ALLOW_PAID_GENERATION=${capabilityProfile.gates.allow_paid_generation}`,
        `provider_request_count=${providerPreflight.request_count}`,
        `prepared_provider_request_count=${providerPreflight.prepared_request_count}`,
        `live_ready_provider_request_count=${providerLiveReadyCount}`,
        `provider_activation_ready_for_live_count=${providerActivationPlan.summary.ready_for_live_count}`,
        `provider_activation_api_key_unlockable_count=${providerActivationPlan.summary.api_key_unlockable_count}`,
        `provider_activation_recommended_request_id=${providerActivationPlan.summary.recommended_request_id ?? 'none'}`,
        `usable_credential_count=${credentialCoverage.summary.usable_now_count}`,
        `missing_required_credential_count=${credentialCoverage.summary.missing_required_count}`,
      ],
      blockers: uniqueSorted([
        ...credentialCoverage.keys
          .filter((key) => key.status === 'missing_required')
          .map((key) => `${key.key} missing for ${key.required_by_request_ids.join(', ')}`),
        ...providerPreflight.preflights.flatMap((preflight) => preflight.ready_for_live_request ? [] : preflight.live_blockers),
      ]),
      proof_commands: [
        'npm run harness -- provider-activation-plan --env-file .env',
        'npm run harness -- credential-coverage --env-file .env',
        'npm run harness -- provider-preflight --env-file .env',
        'npm run harness -- provider-handoff --request .ops/provider_requests/sample_openai_image_live_request.json --env-file .env',
        'ALLOW_PAID_GENERATION=true npm run trend -- provider:run-live --env-file .env --file .ops/provider_requests/sample_openai_image_live_request.json --package-dir .ops/creative_jobs/rendered/scan_bike_001',
      ],
      next_action: providerLiveReadyCount > 0
        ? 'Use provider:run-live only for ready requests and keep outputs in declared package paths.'
        : 'Use provider-activation-plan to confirm the exact missing key/env gates, then provide the required key and explicit ALLOW_PAID_GENERATION=true before live provider execution.',
    },
    {
      id: 'goal.browser_research_boundary',
      requirement: 'Browser-assisted research is explicit, reviewed, and gated before any browser capture becomes trend evidence.',
      status: capabilityProfile.gates.allow_browser_ui ? 'passed' : 'open',
      evidence: [
        `browser_lane_status=${browserLane?.status ?? 'missing'}`,
        `ALLOW_BROWSER_UI=${capabilityProfile.gates.allow_browser_ui}`,
        `browser_capture_count=${browserResearchPlan.summary.capture_count}`,
        `browser_ingest_ready_count=${browserResearchPlan.summary.ingest_ready_count}`,
        `browser_recommended_capture_path=${browserResearchPlan.summary.recommended_capture_path ?? 'none'}`,
      ],
      blockers: capabilityProfile.gates.allow_browser_ui ? [] : ['ALLOW_BROWSER_UI=true'],
      proof_commands: [
        'npm run harness -- browser-research-plan --env-file .env',
        'npm run harness -- capability-unlock-map --env-file .env',
        'npm run trend -- browser:validate-capture --file .ops/browser/captures/reviewed/<capture>.json',
      ],
      next_action: capabilityProfile.gates.allow_browser_ui
        ? 'Validate reviewed captures before ingestion.'
        : 'Use browser-research-plan to inspect reviewed/manual captures, then keep browser UI work gated until ALLOW_BROWSER_UI=true is explicit.',
    },
    {
      id: 'goal.publishing_boundary',
      requirement: 'Publishing remains bounded by explicit gates, job policy, human approval, approved assets, and account-owner confirmation.',
      status: capabilityProfile.gates.allow_social_publishing && launchMap.autonomous_publish_ready_job_count > 0 ? 'passed' : 'open',
      evidence: [
        `publishing_lane_status=${publishingLane?.status ?? 'missing'}`,
        `ALLOW_SOCIAL_PUBLISHING=${capabilityProfile.gates.allow_social_publishing}`,
        `manual_handoff_ready_job_count=${launchMap.manual_handoff_ready_job_count}`,
        `autonomous_publish_ready_job_count=${launchMap.autonomous_publish_ready_job_count}`,
        `publishing_handoff_recommended_job_id=${publishingHandoffPlan.summary.recommended_job_id ?? 'none'}`,
        `publishing_handoff_external_calls_made=${publishingHandoffPlan.summary.external_calls_made}`,
      ],
      blockers: uniqueSorted(launchMap.jobs.flatMap((job) => job.blockers)),
      proof_commands: [
        'npm run harness -- publishing-handoff-plan --env-file .env',
        'npm run harness -- launch-map',
        'npm run harness -- blockers',
      ],
      next_action: launchMap.autonomous_publish_ready_job_count
        ? 'Use manual account-owner confirmation before any external publishing action.'
        : 'Use publishing-handoff-plan to keep launch work at manual handoff until social publishing policy, approvals, assets, and account-owner confirmation are ready.',
    },
    {
      id: 'goal.completion_claim',
      requirement: 'The active thread goal can be marked complete only when every requirement is proven passed by current evidence.',
      status: autonomyAudit.summary_status === 'local_autonomy_ready' && providerLiveReadyCount > 0 && capabilityProfile.gates.allow_browser_ui
        ? 'passed'
        : 'open',
      evidence: [
        `autonomy_audit_summary=${autonomyAudit.summary_status}`,
        `provider_live_ready_request_count=${providerLiveReadyCount}`,
        `browser_autonomy=${capabilityProfile.gates.allow_browser_ui}`,
        `publishing_autonomy=${capabilityProfile.gates.allow_social_publishing}`,
      ],
      blockers: autonomyAudit.criteria
        .filter((criterion) => criterion.status !== 'passed')
        .map((criterion) => `${criterion.id}=${criterion.status}`),
      proof_commands: [
        'npm run harness -- goal-completion-audit --goal "Make WorthScan autonomous for Codex" --env-file .env',
        'npm run harness -- autonomy-audit --goal "Make WorthScan autonomous for Codex" --env-file .env',
        'npm test -- --runInBand',
      ],
      next_action: 'Do not mark the thread goal complete until this audit returns can_mark_goal_complete=true.',
    },
  ];
  const hasBlocked = requirements.some((requirement) => requirement.status === 'blocked');
  const allPassed = requirements.every((requirement) => requirement.status === 'passed');

  return {
    created_at: new Date().toISOString(),
    goal,
    root_dir: rootDir,
    summary_status: allPassed ? 'achieved' : hasBlocked ? 'blocked' : 'incomplete',
    can_mark_goal_complete: allPassed,
    requirements,
    next_commands: [
      'npm run harness -- goal-completion-audit --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- next-action --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- decision-surface --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- autonomy-audit --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- autonomy-plan --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- credential-coverage --env-file .env',
      'npm run harness -- provider-route-map --env-file .env',
      'npm run harness -- provider-activation-plan --env-file .env',
      'npm run harness -- browser-research-plan --env-file .env',
      'npm run harness -- publishing-handoff-plan --env-file .env',
      'npm run harness -- capability-unlock-map --env-file .env',
      'npm test -- --runInBand',
    ],
  };
}

export function buildHarnessDoctor(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessDoctorReport {
  const repoStatus = buildRepoStatus(rootDir);
  const reproducibilityManifest = buildReproducibilityManifest(rootDir);
  const autonomyAudit = buildAutonomyAudit('Make WorthScan autonomous for Codex', env, rootDir);
  const goalCompletionAudit = buildGoalCompletionAudit('Make WorthScan autonomous for Codex', env, rootDir);
  const capabilityPlan = buildCapabilityPlan(env, rootDir);
  const capabilityUnlockMap = buildCapabilityUnlockMap(env, rootDir);
  const credentialCoverage = buildCredentialCoverageMap({ env, rootDir });
  const providerActivationPlan = buildProviderActivationPlan({ env, rootDir });
  const browserResearchPlan = buildBrowserResearchPlan({ env, rootDir });
  const publishingHandoffPlan = buildPublishingHandoffPlan({ env, rootDir });
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const blockerLedger = buildBlockerLedger(env, rootDir);
  const providerPreflight = preflightProviderRequests(env, rootDir);
  const informationSources = buildInformationIndex(rootDir);
  const incomingJobs = listIncomingJobs(rootDir);
  const providerRequests = listProviderRequests(rootDir);
  const secretFindings = scanRepositoryForSecrets(rootDir);
  const runHistory = buildHarnessRunHistory({ rootDir });
  const byKind = informationSources.reduce(
    (counts, source) => {
      counts[source.kind] = (counts[source.kind] ?? 0) + 1;
      return counts;
    },
    {} as Record<HarnessInformationSource['kind'], number>,
  );
  const hasProviderCredential = capabilityProfile.credentials.openai_api_key_available
    || capabilityProfile.credentials.gemini_api_key_available
    || capabilityProfile.credentials.lightreel_api_key_available
    || capabilityProfile.credentials.scrape_creators_api_key_available;
  const localAutonomy = incomingJobs.length > 0 && secretFindings.length === 0;
  const providerAutonomy = localAutonomy && providerPreflight.preflights.some((preflight) => preflight.ready_for_live_request);
  const recommendedCommands = [
    'npm run harness -- autonomy-audit --goal "<goal>"',
    'npm run harness -- goal-completion-audit --goal "<goal>" --env-file .env',
    'npm run harness -- next-action --goal "<goal>" --env-file .env',
    'npm run harness -- decision-surface --goal "<goal>" --env-file .env',
    'npm run harness -- autonomy-plan --goal "<goal>"',
    'npm run harness -- capability-plan',
    'npm run harness -- capability-unlock-map',
    'npm run harness -- credential-coverage --env-file .env',
    'npm run harness -- provider-route-map --env-file .env',
    'npm run harness -- provider-activation-plan --env-file .env',
    'npm run harness -- browser-research-plan --env-file .env',
    'npm run harness -- publishing-handoff-plan --env-file .env',
    'npm run harness -- reproducibility-manifest',
    'npm run harness -- verification-map',
    'npm run harness -- stage-source --dry-run',
    'npm run harness -- source-package',
    'npm run harness -- provider-preflight',
    'npm run harness -- provider-handoff --request .ops/provider_requests/sample_openai_image_request.json',
    'npm run harness -- rank-jobs',
    'npm run harness -- job-matrix',
    'npm run harness -- evidence-map',
    'npm run harness -- launch-map',
    'npm run harness -- run-history',
    'npm run harness -- run-brief',
    'npm run harness -- run --goal "<goal>"',
    'npm run harness -- blockers',
  ];

  if (repoStatus.untracked_source_of_truth_count) {
    recommendedCommands.unshift('git status --short --untracked-files=all');
  }
  const latestRun = findLatestHarnessRun(rootDir);
  if (latestRun) {
    recommendedCommands.push(`npm run harness -- run-brief --run ${latestRun.run_dir}`);
    recommendedCommands.push(`npm run harness -- resume --run ${latestRun.run_dir}`);
  }

  return {
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    repo_status: repoStatus,
    reproducibility_manifest: reproducibilityManifest,
    autonomy_audit: autonomyAudit,
    goal_completion_audit: goalCompletionAudit,
    capability_plan: capabilityPlan,
    capability_unlock_map: capabilityUnlockMap,
    credential_coverage: credentialCoverage,
    provider_route_map: buildProviderRouteMap({ env, rootDir }),
    provider_activation_plan: providerActivationPlan,
    browser_research_plan: browserResearchPlan,
    publishing_handoff_plan: publishingHandoffPlan,
    capability_profile: capabilityProfile,
    blocker_ledger: blockerLedger,
    provider_preflight: providerPreflight,
    information_surface: {
      source_count: informationSources.length,
      by_kind: byKind,
    },
    incoming_job_count: incomingJobs.length,
    provider_request_count: providerRequests.length,
    latest_run: latestRun,
    latest_run_brief: buildRunBrief({ rootDir }),
    run_history: runHistory,
    secret_scan: {
      status: secretFindings.length ? 'blocked' : 'clear',
      finding_count: secretFindings.length,
    },
    readiness: {
      local_autonomy: localAutonomy,
      browser_autonomy: localAutonomy && capabilityProfile.gates.allow_browser_ui,
      provider_autonomy: providerAutonomy,
      publishing_autonomy: localAutonomy && capabilityProfile.gates.allow_social_publishing,
    },
    recommended_commands: recommendedCommands,
  };
}

export function buildAutonomyPlan(
  goal = 'Make WorthScan autonomous for Codex',
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessAutonomyPlan {
  const doctor = buildHarnessDoctor(env, rootDir);
  const rankings = rankIncomingJobs(env, rootDir).slice(0, 5);
  const primitives = listCodexPrimitives();
  const dirtySourceCount = doctor.reproducibility_manifest.source_of_truth.dirty_count;
  const providerLiveReadyCount = doctor.provider_preflight.preflights.filter((preflight) => preflight.ready_for_live_request).length;
  const auditById = new Map(doctor.autonomy_audit.criteria.map((criterion) => [criterion.id, criterion]));
  const openBlockers = doctor.blocker_ledger.blockers.filter((blocker) => blocker.status === 'open');
  const providerRouteByRequestId = new Map(doctor.provider_route_map.routes.map((route) => [route.request_id, route]));
  const steps: HarnessAutonomyPlanStep[] = [];
  const goalArg = shellQuote(goal);

  const addStep = (step: HarnessAutonomyPlanStep): void => {
    steps.push(step);
  };

  addStep({
    id: 'reproducibility.stage_source_dry_run',
    priority: dirtySourceCount ? 10 : 90,
    lane: 'reproducibility',
    status: dirtySourceCount ? 'blocked' : 'ready',
    safe_to_run_now: true,
    command: dirtySourceCount ? 'npm run harness -- stage-source --dry-run' : 'npm run harness -- reproducibility-manifest',
    reason: dirtySourceCount
      ? 'Source-of-truth changes block strong autonomy claims until Codex reviews the stage manifest.'
      : 'Source-of-truth is clean; keep the reproducibility manifest available as proof.',
    evidence: auditById.get('codex.reproducibility')?.evidence ?? [],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'local.auto',
    priority: dirtySourceCount ? 80 : 20,
    lane: 'local',
    status: doctor.readiness.local_autonomy && !dirtySourceCount ? 'ready' : 'blocked',
    safe_to_run_now: doctor.readiness.local_autonomy && !dirtySourceCount,
    command: `npm run harness -- auto --goal ${goalArg}`,
    reason: doctor.readiness.local_autonomy
      ? 'Run the bounded local autonomous loop: select work, render artifacts, persist context, and stop at explicit gates.'
      : 'Local autonomous execution needs a clear secret scan and at least one incoming job.',
    evidence: auditById.get('codex.local_execution')?.evidence ?? [],
    required_gates: [],
    writes: ['.ops/harness/runs/<run_id>/'],
  });

  addStep({
    id: 'information.context_pack',
    priority: 40,
    lane: 'information',
    status: 'ready',
    safe_to_run_now: true,
    command: 'npm run harness -- context-pack --out .ops/harness/context_pack.json',
    reason: 'Write a bounded, hashed source/context bundle so Codex can inspect repo facts without broad ad hoc reads.',
    evidence: auditById.get('codex.information_surface')?.evidence ?? [],
    required_gates: [],
    writes: ['.ops/harness/context_pack.json'],
  });

  addStep({
    id: 'goal.completion_audit',
    priority: 37,
    lane: 'information',
    status: doctor.goal_completion_audit.can_mark_goal_complete ? 'ready' : 'needs_capability',
    safe_to_run_now: true,
    command: `npm run harness -- goal-completion-audit --goal ${goalArg} --env-file .env`,
    reason: 'Audit the full thread objective requirement by requirement before deciding whether the goal can be marked complete.',
    evidence: [
      `summary_status=${doctor.goal_completion_audit.summary_status}`,
      `can_mark_goal_complete=${doctor.goal_completion_audit.can_mark_goal_complete}`,
      `open_requirement_count=${doctor.goal_completion_audit.requirements.filter((requirement) => requirement.status !== 'passed').length}`,
    ],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'information.job_matrix',
    priority: 38,
    lane: 'information',
    status: 'ready',
    safe_to_run_now: true,
    command: 'npm run harness -- job-matrix',
    reason: 'Inspect every incoming job across rank, rendered package, provider requests, launch queue, metrics, blockers, and next commands.',
    evidence: [
      `job_count=${doctor.incoming_job_count}`,
      `provider_request_count=${doctor.provider_request_count}`,
    ],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'information.evidence_map',
    priority: 39,
    lane: 'information',
    status: 'ready',
    safe_to_run_now: true,
    command: 'npm run harness -- evidence-map',
    reason: 'Inspect job source inputs, trend references, rendered evidence files, and valuation claim-safety blockers before provider handoff or posting.',
    evidence: auditById.get('codex.information_surface')?.evidence ?? [],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'information.launch_map',
    priority: 41,
    lane: 'information',
    status: 'ready',
    safe_to_run_now: true,
    command: 'npm run harness -- launch-map',
    reason: 'Inspect queued launch jobs, rendered posting files, platform copy coverage, human approval gates, publishing blockers, and metrics follow-up commands.',
    evidence: auditById.get('codex.publishing_autonomy')?.evidence ?? [],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'publishing.handoff_plan',
    priority: 43,
    lane: 'publishing',
    status: doctor.publishing_handoff_plan.summary.autonomous_publish_ready_job_count ? 'ready' : 'needs_capability',
    safe_to_run_now: true,
    command: 'npm run harness -- publishing-handoff-plan --env-file .env',
    reason: 'Inspect manual launch packets, account-owner confirmation requirements, local metrics commands, and social-publishing blockers without posting.',
    evidence: [
      `ALLOW_SOCIAL_PUBLISHING=${doctor.publishing_handoff_plan.gates.allow_social_publishing}`,
      `manual_handoff_ready_job_count=${doctor.publishing_handoff_plan.summary.manual_handoff_ready_job_count}`,
      `autonomous_publish_ready_job_count=${doctor.publishing_handoff_plan.summary.autonomous_publish_ready_job_count}`,
      `recommended_job_id=${doctor.publishing_handoff_plan.summary.recommended_job_id ?? 'none'}`,
      `external_calls_made=${doctor.publishing_handoff_plan.summary.external_calls_made}`,
    ],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'information.run_history',
    priority: 42,
    lane: 'information',
    status: 'ready',
    safe_to_run_now: true,
    command: 'npm run harness -- run-history',
    reason: 'Inspect recent durable harness runs, selected jobs, missing artifacts, provider dry-run counts, and resume commands before rerunning work.',
    evidence: [
      `run_count=${doctor.run_history.run_count}`,
      `latest_run=${doctor.latest_run?.run_id ?? 'none'}`,
    ],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'verification.map',
    priority: dirtySourceCount ? 12 : 92,
    lane: 'verification',
    status: 'ready',
    safe_to_run_now: true,
    command: 'npm run harness -- verification-map',
    reason: dirtySourceCount
      ? 'Map the current source changes to targeted validation commands before staging or committing.'
      : 'No source changes are dirty; keep the validation map available for the next autonomous edit cycle.',
    evidence: auditById.get('codex.reproducibility')?.evidence ?? [],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'provider.preflight_all',
    priority: providerLiveReadyCount ? 35 : 30,
    lane: 'provider',
    status: providerLiveReadyCount ? 'ready' : 'needs_capability',
    safe_to_run_now: true,
    command: 'npm run harness -- provider-preflight',
    reason: 'Check request prompts, local inputs, declared outputs, dry-run state, and live blockers before any provider action.',
    evidence: auditById.get('codex.provider_autonomy')?.evidence ?? [],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'capability.unlock_map',
    priority: 34,
    lane: 'information',
    status: providerLiveReadyCount ? 'ready' : 'needs_capability',
    safe_to_run_now: true,
    command: 'npm run harness -- capability-unlock-map',
    reason: 'Inspect exact env, credential, policy, request, job, activation, and verification requirements before opening external gates.',
    evidence: auditById.get('codex.provider_autonomy')?.evidence ?? [],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'capability.credential_coverage',
    priority: 36,
    lane: 'information',
    status: doctor.credential_coverage.summary.missing_required_count ? 'needs_capability' : 'ready',
    safe_to_run_now: true,
    command: 'npm run harness -- credential-coverage --env-file .env',
    reason: 'Map redacted API key presence to current provider requests so Codex can distinguish usable, gated, missing, unimplemented, and unbound credentials.',
    evidence: [
      `usable_now_count=${doctor.credential_coverage.summary.usable_now_count}`,
      `missing_required_count=${doctor.credential_coverage.summary.missing_required_count}`,
      `present_but_unbound_count=${doctor.credential_coverage.summary.present_but_unbound_count}`,
    ],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'provider.activation_plan',
    priority: 32,
    lane: 'provider',
    status: doctor.provider_activation_plan.summary.ready_for_live_count ? 'ready' : 'needs_capability',
    safe_to_run_now: true,
    command: 'npm run harness -- provider-activation-plan --env-file .env',
    reason: 'Combine route ranking, credential availability, env gates, handoff history, and exact live-run boundaries before using any provider API key.',
    evidence: [
      `request_count=${doctor.provider_activation_plan.summary.request_count}`,
      `ready_for_live_count=${doctor.provider_activation_plan.summary.ready_for_live_count}`,
      `api_key_unlockable_count=${doctor.provider_activation_plan.summary.api_key_unlockable_count}`,
      `missing_credential_count=${doctor.provider_activation_plan.summary.missing_credential_count}`,
      `recommended_request_id=${doctor.provider_activation_plan.summary.recommended_request_id ?? 'none'}`,
      `recommended_credential=${doctor.provider_activation_plan.summary.recommended_credential ?? 'none'}`,
    ],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'provider.route_map',
    priority: 33,
    lane: 'provider',
    status: doctor.provider_route_map.summary.live_ready_count ? 'ready' : 'needs_capability',
    safe_to_run_now: true,
    command: 'npm run harness -- provider-route-map --env-file .env',
    reason: 'Rank provider request routes and identify whether an API key, env gate, local input, or adapter is the next unlock for each route.',
    evidence: [
      `request_count=${doctor.provider_route_map.summary.request_count}`,
      `live_ready_count=${doctor.provider_route_map.summary.live_ready_count}`,
      `existing_handoff_count=${doctor.provider_route_map.summary.existing_handoff_count}`,
      `handoff_missing_count=${doctor.provider_route_map.summary.handoff_missing_count}`,
      `api_key_would_help_count=${doctor.provider_route_map.summary.api_key_would_help_count}`,
      `recommended_route_id=${doctor.provider_route_map.summary.recommended_route_id ?? 'none'}`,
      `recommended_credential=${doctor.provider_route_map.summary.recommended_credential ?? 'none'}`,
    ],
    required_gates: [],
    writes: [],
  });

  for (const preflight of doctor.provider_preflight.preflights) {
    const packageDir = `.ops/creative_jobs/rendered/${preflight.job_id}`;
    const providerRoute = providerRouteByRequestId.get(preflight.request_id);
    const handoffAlreadyExists = Boolean(providerRoute?.latest_handoff_path);
    if (preflight.ready_for_live_request) {
      addStep({
        id: `provider.live_run.${preflight.request_id}`,
        priority: dirtySourceCount ? 85 : 15,
        lane: 'provider',
        status: dirtySourceCount ? 'blocked' : 'ready',
        safe_to_run_now: !dirtySourceCount,
        command: `npm run trend -- provider:run-live --file ${shellQuote(preflight.request_path)} --package-dir ${shellQuote(packageDir)}`,
        reason: 'A live provider request has all local inputs, explicit external-call policy, env gate, and credential presence.',
        evidence: [
          `provider=${preflight.provider}`,
          `provider_mode=${preflight.provider_mode}`,
          `request_path=${preflight.request_path}`,
          `ready_for_live_request=${preflight.ready_for_live_request}`,
        ],
        required_gates: [
          ...requiredEnvForProvider(preflight.provider),
          ...(preflight.provider === 'openai_image' ? ['OPENAI_API_KEY available'] : []),
        ],
        writes: preflight.declared_outputs.map((output) => output.path),
      });
      continue;
    }

    if (preflight.suggested_prepare_command) {
      addStep({
        id: `provider.prepare_inputs.${preflight.request_id}`,
        priority: 25,
        lane: 'provider',
        status: 'ready',
        safe_to_run_now: true,
        command: preflight.suggested_prepare_command,
        reason: 'Local provider input assets are missing but can be produced by the deterministic local renderer.',
        evidence: preflight.missing_input_assets,
        required_gates: [],
        writes: [packageDir],
      });
      continue;
    }

    addStep({
      id: `provider.handoff.${preflight.request_id}`,
      priority: handoffAlreadyExists ? 68 : preflight.ready_for_provider_handoff ? 32 : 70,
      lane: 'provider',
      status: preflight.ready_for_provider_handoff ? 'ready' : 'needs_capability',
      safe_to_run_now: preflight.ready_for_provider_handoff,
      command: handoffAlreadyExists
        ? 'npm run harness -- provider-route-map --env-file .env'
        : preflight.ready_for_provider_handoff
        ? `npm run harness -- provider-handoff --request ${shellQuote(preflight.request_path)}`
        : 'npm run harness -- provider-preflight',
      reason: handoffAlreadyExists
        ? `Provider handoff packet already exists at ${providerRoute?.latest_handoff_path}; inspect route history before regenerating it.`
        : preflight.ready_for_provider_handoff
        ? 'Write a bounded provider handoff packet before external provider execution.'
        : preflight.next_action,
      evidence: uniqueSorted([
        ...(preflight.live_blockers.length ? preflight.live_blockers : [`ready_for_provider_handoff=${preflight.ready_for_provider_handoff}`]),
        ...(providerRoute ? [
          `existing_handoff_count=${providerRoute.existing_handoff_count}`,
          ...(providerRoute.latest_handoff_path ? [`latest_handoff_path=${providerRoute.latest_handoff_path}`] : []),
        ] : []),
      ]),
      required_gates: requiredEnvForProvider(preflight.provider),
      writes: preflight.ready_for_provider_handoff && !handoffAlreadyExists ? ['.ops/harness/provider_handoffs/<packet_id>/'] : [],
    });
  }

  addStep({
    id: 'browser.research_plan',
    priority: 44,
    lane: 'browser',
    status: doctor.browser_research_plan.gates.allow_browser_ui ? 'ready' : 'needs_capability',
    safe_to_run_now: true,
    command: 'npm run harness -- browser-research-plan --env-file .env',
    reason: 'Inspect browser operating docs, manual capture inventory, review status, validation commands, and ingestion boundary before any browser UI work.',
    evidence: [
      `ALLOW_BROWSER_UI=${doctor.browser_research_plan.gates.allow_browser_ui}`,
      `capture_count=${doctor.browser_research_plan.summary.capture_count}`,
      `approved_capture_count=${doctor.browser_research_plan.summary.approved_capture_count}`,
      `ingest_ready_count=${doctor.browser_research_plan.summary.ingest_ready_count}`,
      `recommended_capture_path=${doctor.browser_research_plan.summary.recommended_capture_path ?? 'none'}`,
    ],
    required_gates: [],
    writes: [],
  });

  addStep({
    id: 'browser.capture_validation',
    priority: doctor.readiness.browser_autonomy ? 45 : 75,
    lane: 'browser',
    status: doctor.readiness.browser_autonomy ? 'ready' : 'needs_capability',
    safe_to_run_now: doctor.readiness.browser_autonomy,
    command: 'npm run trend -- browser:validate-capture --file .ops/browser/captures/reviewed/<capture>.json',
    reason: doctor.readiness.browser_autonomy
      ? 'Browser UI is enabled; validate reviewed captures before trend ingestion.'
      : 'Browser research remains gated; use reviewed local capture files until ALLOW_BROWSER_UI=true is explicit.',
    evidence: auditById.get('codex.browser_autonomy')?.evidence ?? [],
    required_gates: ['ALLOW_BROWSER_UI=true'],
    writes: [],
  });

  addStep({
    id: 'publishing.boundary',
    priority: 95,
    lane: 'publishing',
    status: 'human_boundary',
    safe_to_run_now: false,
    command: null,
    reason: 'Publishing stays outside autonomous execution until env, job policy, human approval, and account-owner confirmation are all present.',
    evidence: auditById.get('codex.publishing_autonomy')?.evidence ?? [],
    required_gates: ['ALLOW_SOCIAL_PUBLISHING=true', 'human-approved generated assets', 'account-owner confirmation'],
    writes: [],
  });

  const orderedSteps = steps.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const selectedNextStep = orderedSteps.find((step) => step.safe_to_run_now && step.command) ?? null;
  const commandsByAutonomy = (autonomy: CodexPrimitive['autonomy']) => primitives
    .filter((primitive) => primitive.autonomy === autonomy)
    .map((primitive) => primitive.command);

  return {
    created_at: new Date().toISOString(),
    goal,
    root_dir: rootDir,
    summary_status: doctor.autonomy_audit.summary_status,
    selected_next_step: selectedNextStep,
    steps: orderedSteps,
    readiness: doctor.readiness,
    capability_profile: doctor.capability_profile,
    source_of_truth_dirty_count: dirtySourceCount,
    provider_live_ready_request_count: providerLiveReadyCount,
    information_surface: doctor.information_surface,
    top_ranked_jobs: rankings,
    open_blockers: openBlockers,
    command_policy: {
      safe_default_commands: commandsByAutonomy('safe_default'),
      capability_gated_commands: commandsByAutonomy('capability_gated'),
      human_boundary_commands: commandsByAutonomy('human_boundary'),
      secret_policy: doctor.capability_profile.credential_policy,
    },
  };
}

export function buildDecisionSurface(
  goal = 'Make WorthScan autonomous for Codex',
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessDecisionSurface {
  const plan = buildAutonomyPlan(goal, env, rootDir);
  const goalAudit = buildGoalCompletionAudit(goal, env, rootDir);
  const credentialCoverage = buildCredentialCoverageMap({ env, rootDir });
  const launchMap = buildLaunchMap(env, rootDir);
  const providerPreflight = preflightProviderRequests(env, rootDir);
  const runHistory = buildHarnessRunHistory({ rootDir, limit: 5 });
  const latestRun = findLatestHarnessRun(rootDir);
  const actions = [
    ...(latestRun ? decisionSurfaceLatestRunActions(latestRun) : []),
    ...plan.steps.map((step) => decisionSurfaceAction(step)),
  ];
  const safeNow = actions.filter((action) => action.queue === 'safe_now');
  const capabilityGated = actions.filter((action) => action.queue === 'capability_gated');
  const humanBoundary = actions.filter((action) => action.queue === 'human_boundary');
  const blocked = actions.filter((action) => action.queue === 'blocked');
  const selectedSafeAction = safeNow.find((action) => action.command) ?? null;

  return {
    created_at: new Date().toISOString(),
    goal,
    root_dir: rootDir,
    summary: {
      selected_safe_action_id: selectedSafeAction?.id ?? null,
      safe_now_count: safeNow.length,
      capability_gated_count: capabilityGated.length,
      human_boundary_count: humanBoundary.length,
      blocked_count: blocked.length,
      can_mark_goal_complete: goalAudit.can_mark_goal_complete,
      goal_summary_status: goalAudit.summary_status,
      autonomy_summary_status: plan.summary_status,
      dirty_source_of_truth_count: plan.source_of_truth_dirty_count,
    },
    current_state: {
      latest_run_id: latestRun?.run_id ?? null,
      run_count: runHistory.run_count,
      provider_request_count: providerPreflight.request_count,
      provider_live_ready_request_count: plan.provider_live_ready_request_count,
      missing_required_credential_count: credentialCoverage.summary.missing_required_count,
      manual_handoff_ready_job_count: launchMap.manual_handoff_ready_job_count,
      autonomous_publish_ready_job_count: launchMap.autonomous_publish_ready_job_count,
    },
    selected_safe_action: selectedSafeAction,
    queues: {
      safe_now: safeNow,
      capability_gated: capabilityGated,
      human_boundary: humanBoundary,
      blocked,
    },
    active_blockers: plan.open_blockers,
    next_commands: uniqueSorted([
      ...(selectedSafeAction?.command ? [selectedSafeAction.command] : []),
      'npm run harness -- next-action --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- decision-surface --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- goal-completion-audit --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- autonomy-plan --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- provider-preflight --env-file .env',
      'npm run harness -- provider-route-map --env-file .env',
      'npm run harness -- credential-coverage --env-file .env',
      'npm run harness -- publishing-handoff-plan --env-file .env',
      'npm run harness -- capability-unlock-map --env-file .env',
      'npm run harness -- run-history',
      'npm run harness -- run-brief',
    ]),
  };
}

export function buildNextActionReport(
  goal = 'Make WorthScan autonomous for Codex',
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): HarnessNextActionReport {
  const surface = buildDecisionSurface(goal, env, rootDir);
  const providerRouteMap = buildProviderRouteMap({ env, rootDir });
  const safeActions = surface.queues.safe_now.filter((action) => action.command);
  const readOnlyActions = safeActions.filter((action) => action.writes.length === 0);
  const routeByHandoffActionId = new Map(providerRouteMap.routes.map((route) => [`provider.handoff.${route.request_id}`, route]));
  const routeNeedsFreshHandoff = (route: HarnessProviderRoute): boolean => (
    route.ready_for_provider_handoff
    && route.existing_handoff_count === 0
    && route.status !== 'needs_adapter'
    && (route.route_type === 'live_provider' || route.route_type === 'provider_handoff')
  );
  const latestRunIsUsable = Boolean(surface.current_state.latest_run_id)
    && surface.summary.dirty_source_of_truth_count === 0;
  const orientationAction = safeActions.find((action) => action.id === 'run.brief_latest')
    ?? readOnlyActions.find((action) => action.id === 'provider.preflight_all')
    ?? readOnlyActions.find((action) => action.id === 'goal.completion_audit')
    ?? readOnlyActions[0]
    ?? surface.selected_safe_action;
  const recommendedProviderRoute = providerRouteMap.routes.find((route) => (
    route.request_id === providerRouteMap.summary.recommended_route_id
  )) ?? null;
  const providerRouteNeedingHandoff = recommendedProviderRoute && routeNeedsFreshHandoff(recommendedProviderRoute)
    ? recommendedProviderRoute
    : providerRouteMap.routes.find(routeNeedsFreshHandoff) ?? null;
  const preferredProviderHandoffAction = providerRouteNeedingHandoff
    ? safeActions.find((action) => action.id === `provider.handoff.${providerRouteNeedingHandoff.request_id}`)
    : null;
  const progressCandidates = safeActions.filter((action) => (
    action.id !== orientationAction?.id
    && !['run.brief_latest', 'run.resume_latest'].includes(action.id)
    && (!latestRunIsUsable || action.id !== 'local.auto')
    && (!routeByHandoffActionId.has(action.id) || routeNeedsFreshHandoff(routeByHandoffActionId.get(action.id)!))
  ));
  const capabilityUnlockAction = safeActions.find((action) => action.id === 'provider.activation_plan')
    ?? safeActions.find((action) => action.id === 'provider.route_map')
    ?? safeActions.find((action) => action.id === 'capability.unlock_map')
    ?? safeActions.find((action) => action.id === 'capability.credential_coverage')
    ?? safeActions.find((action) => action.id === 'provider.preflight_all')
    ?? surface.queues.capability_gated.find((action) => action.command)
    ?? null;
  const providerWriteProgressAction = progressCandidates.find((action) => action.lane === 'provider' && action.writes.length > 0);
  const progressAction = preferredProviderHandoffAction
    ?? providerWriteProgressAction
    ?? (latestRunIsUsable ? capabilityUnlockAction : null)
    ?? progressCandidates.find((action) => action.writes.length > 0)
    ?? progressCandidates[0]
    ?? (!latestRunIsUsable ? safeActions.find((action) => action.id === 'local.auto') ?? null : null);
  const humanBoundaryAction = surface.queues.human_boundary.find((action) => action.command || action.required_gates.length)
    ?? null;

  return {
    created_at: new Date().toISOString(),
    goal,
    root_dir: rootDir,
    summary: {
      orientation_action_id: orientationAction?.id ?? null,
      progress_action_id: progressAction?.id ?? null,
      capability_unlock_action_id: capabilityUnlockAction?.id ?? null,
      human_boundary_action_id: humanBoundaryAction?.id ?? null,
      blocked_action_count: surface.queues.blocked.length,
      can_mark_goal_complete: surface.summary.can_mark_goal_complete,
      goal_summary_status: surface.summary.goal_summary_status,
      autonomy_summary_status: surface.summary.autonomy_summary_status,
      dirty_source_of_truth_count: surface.summary.dirty_source_of_truth_count,
    },
    current_state: surface.current_state,
    orientation_action: orientationAction,
    progress_action: progressAction,
    capability_unlock_action: capabilityUnlockAction,
    human_boundary_action: humanBoundaryAction,
    blocked_actions: surface.queues.blocked,
    next_commands: uniqueSorted([
      ...(orientationAction?.command ? [orientationAction.command] : []),
      ...(progressAction?.command ? [progressAction.command] : []),
      ...(capabilityUnlockAction?.command ? [capabilityUnlockAction.command] : []),
      'npm run harness -- next-action --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- decision-surface --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- goal-completion-audit --goal "Make WorthScan autonomous for Codex" --env-file .env',
      'npm run harness -- publishing-handoff-plan --env-file .env',
      'npm run harness -- capability-unlock-map --env-file .env',
    ]),
  };
}

function decisionSurfaceAction(step: HarnessAutonomyPlanStep): HarnessDecisionSurfaceAction {
  const queue = decisionSurfaceQueue(step);
  return {
    id: step.id,
    queue,
    lane: step.lane,
    readiness_status: step.status,
    command: step.command,
    reason: step.reason,
    evidence: step.evidence,
    required_gates: step.required_gates,
    writes: step.writes,
    source_ids: [`autonomy_plan.${step.id}`],
  };
}

function decisionSurfaceLatestRunActions(latestRun: HarnessResumeReport): HarnessDecisionSurfaceAction[] {
  const evidence = [
    `run_id=${latestRun.run_id}`,
    `status=${latestRun.status}`,
    `selected_job=${latestRun.selected_job.job_id}`,
    `missing_artifact_count=${latestRun.missing_artifacts.length}`,
  ];
  return [
    {
      id: 'run.brief_latest',
      queue: 'safe_now',
      lane: 'local',
      readiness_status: latestRun.missing_artifacts.length ? 'blocked' : 'ready',
      command: `npm run harness -- run-brief --run ${shellQuote(latestRun.run_dir)}`,
      reason: 'Read the compact latest-run handoff before opening individual run artifacts or creating another auto run.',
      evidence,
      required_gates: [],
      writes: [],
      source_ids: ['latest_run', 'harness.run_brief'],
    },
    {
      id: 'run.resume_latest',
      queue: 'safe_now',
      lane: 'local',
      readiness_status: latestRun.missing_artifacts.length ? 'blocked' : 'ready',
      command: `npm run harness -- resume --run ${shellQuote(latestRun.run_dir)}`,
      reason: 'Inspect the latest durable harness run before creating another local auto run.',
      evidence,
      required_gates: [],
      writes: [],
      source_ids: ['latest_run'],
    },
  ];
}

function decisionSurfaceQueue(step: HarnessAutonomyPlanStep): HarnessDecisionSurfaceAction['queue'] {
  const command = step.command ?? '';
  const externalCapabilityCommand = /provider:run-live|ALLOW_[A-Z_]+=true/.test(command);
  if (step.status === 'human_boundary') return 'human_boundary';
  if (externalCapabilityCommand) return step.lane === 'publishing' ? 'human_boundary' : 'capability_gated';
  if (step.safe_to_run_now && step.command && step.required_gates.length === 0) return 'safe_now';
  if (step.safe_to_run_now && step.command) return 'safe_now';
  if (step.required_gates.length > 0) {
    return step.lane === 'publishing' ? 'human_boundary' : 'capability_gated';
  }
  return 'blocked';
}

export function inspectHarness(
  env: Record<string, string | undefined> = process.env,
  rootDir = process.cwd(),
): {
  repo_status: HarnessRepoStatus;
  reproducibility_manifest: HarnessReproducibilityManifest;
  autonomy_audit: HarnessAutonomyAudit;
  goal_completion_audit: HarnessGoalCompletionAudit;
  decision_surface: HarnessDecisionSurface;
  capability_plan: HarnessCapabilityPlan;
  capability_unlock_map: HarnessCapabilityUnlockMap;
  credential_coverage: HarnessCredentialCoverageMap;
  provider_route_map: HarnessProviderRouteMap;
  provider_activation_plan: HarnessProviderActivationPlan;
  browser_research_plan: HarnessBrowserResearchPlan;
  publishing_handoff_plan: HarnessPublishingHandoffPlan;
  next_action: HarnessNextActionReport;
  capability_profile: HarnessCapabilityProfile;
  primitives: CodexPrimitive[];
  information_sources: HarnessInformationSource[];
  job_rankings: HarnessJobRanking[];
  evidence_map: HarnessEvidenceMap;
  launch_map: HarnessLaunchMap;
  verification_map: HarnessVerificationMap;
  blocker_ledger: HarnessBlockerLedger;
  provider_preflight: HarnessProviderPreflightReport;
  latest_run: HarnessResumeReport | null;
  latest_run_brief: HarnessRunBrief;
  run_history: HarnessRunHistory;
  incoming_jobs: Array<{ job_id: string; path: string }>;
  provider_requests: Array<{ request_id: string; provider: CreativeProviderName; path: string; status: string }>;
} {
  return {
    repo_status: buildRepoStatus(rootDir),
    reproducibility_manifest: buildReproducibilityManifest(rootDir),
    autonomy_audit: buildAutonomyAudit('Make WorthScan autonomous for Codex', env, rootDir),
    goal_completion_audit: buildGoalCompletionAudit('Make WorthScan autonomous for Codex', env, rootDir),
    decision_surface: buildDecisionSurface('Make WorthScan autonomous for Codex', env, rootDir),
    capability_plan: buildCapabilityPlan(env, rootDir),
    capability_unlock_map: buildCapabilityUnlockMap(env, rootDir),
    credential_coverage: buildCredentialCoverageMap({ env, rootDir }),
    provider_route_map: buildProviderRouteMap({ env, rootDir }),
    provider_activation_plan: buildProviderActivationPlan({ env, rootDir }),
    browser_research_plan: buildBrowserResearchPlan({ env, rootDir }),
    publishing_handoff_plan: buildPublishingHandoffPlan({ env, rootDir }),
    next_action: buildNextActionReport('Make WorthScan autonomous for Codex', env, rootDir),
    capability_profile: buildCapabilityProfile(env, rootDir),
    primitives: listCodexPrimitives(),
    information_sources: buildInformationIndex(rootDir),
    job_rankings: rankIncomingJobs(env, rootDir),
    evidence_map: buildEvidenceMap(rootDir),
    launch_map: buildLaunchMap(env, rootDir),
    verification_map: buildVerificationMap(rootDir),
    blocker_ledger: buildBlockerLedger(env, rootDir),
    provider_preflight: preflightProviderRequests(env, rootDir),
    latest_run: findLatestHarnessRun(rootDir),
    latest_run_brief: buildRunBrief({ rootDir }),
    run_history: buildHarnessRunHistory({ rootDir }),
    incoming_jobs: listIncomingJobs(rootDir),
    provider_requests: listProviderRequests(rootDir),
  };
}

export async function runCodexHarness(options: HarnessRunOptions): Promise<HarnessRunRecord> {
  if (!options.goal.trim()) throw new Error('goal must be a non-empty string.');

  const rootDir = process.cwd();
  const createdAt = new Date().toISOString();
  const runId = options.runId || createRunId(options.goal, createdAt);
  const runDir = path.resolve(options.outDir || path.join(DEFAULT_HARNESS_RUNS_DIR, runId));
  fs.mkdirSync(runDir, { recursive: true });

  const capabilityProfile = buildCapabilityProfile(options.env ?? process.env, rootDir);
  const selected = selectCreativeJob(options.jobPath, rootDir, capabilityProfile);
  const stages: HarnessStage[] = [];

  const contextDir = path.join(runDir, 'context');
  const providerDir = path.join(runDir, 'providers');
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(providerDir, { recursive: true });

  const selectedJobPath = path.join(contextDir, 'selected_job.json');
  fs.writeFileSync(selectedJobPath, `${JSON.stringify(selected.job, null, 2)}\n`);
  stages.push({
    name: 'select_job',
    status: 'completed',
    evidence: [`Selected ${selected.job.job_id}: ${selected.reason}`],
    artifacts: [selectedJobPath],
  });

  const secretFindings = scanRepositoryForSecrets(rootDir);
  const secretScanPath = path.join(contextDir, 'secret_scan.json');
  fs.writeFileSync(secretScanPath, `${JSON.stringify({ findings: secretFindings }, null, 2)}\n`);
  stages.push({
    name: 'secret_scan',
    status: secretFindings.length ? 'blocked' : 'completed',
    evidence: secretFindings.length
      ? [`Found ${secretFindings.length} secret-like value(s); inspect ${secretScanPath}.`]
      : ['No secret-like values found in git candidate text files.'],
    artifacts: [secretScanPath],
  });

  const renderDir = path.join(runDir, 'rendered', selected.job.job_id);
  const renderResult = await runCreativeProvider('local_renderer', selected.job, {
    outDir: renderDir,
    env: options.env ?? process.env,
  });
  if (renderResult.status !== 'rendered') {
    throw new Error(`local renderer returned unexpected status: ${renderResult.status}`);
  }
  stages.push({
    name: 'render_local_package',
    status: 'completed',
    evidence: [`Rendered ${selected.job.job_id} into ${renderResult.render.output_dir}.`],
    artifacts: [
      renderResult.render.rendered_manifest_path,
      renderResult.render.caption_path,
      renderResult.render.posting_notes_path,
      renderResult.render.qa_checklist_path,
    ],
  });

  const providerDryRuns = runProviderRequests(providerDir, options.env ?? process.env, rootDir);
  stages.push({
    name: 'provider_gate_evaluation',
    status: providerDryRuns.some((result) => result.status === 'blocked') ? 'blocked' : 'completed',
    evidence: providerDryRuns.length
      ? providerDryRuns.map((result) => `${result.request_id}: ${result.status}; external_calls_made=${result.external_calls_made}`)
      : ['No provider request manifests found.'],
    artifacts: providerDryRuns.map((result) => path.join(providerDir, `${result.request_id}.json`)),
  });

  const primitivesPath = path.join(runDir, 'primitives.json');
  const capabilitiesPath = path.join(runDir, 'capabilities.json');
  const informationIndexPath = path.join(runDir, 'information_index.json');
  const contextPackPath = path.join(runDir, 'context_pack.json');
  const jobRankingsPath = path.join(runDir, 'job_rankings.json');
  const evidenceMapPath = path.join(runDir, 'evidence_map.json');
  const launchMapPath = path.join(runDir, 'launch_map.json');
  const verificationMapPath = path.join(runDir, 'verification_map.json');
  const capabilityUnlockMapPath = path.join(runDir, 'capability_unlock_map.json');
  const providerRouteMapPath = path.join(runDir, 'provider_route_map.json');
  const providerActivationPlanPath = path.join(runDir, 'provider_activation_plan.json');
  const browserResearchPlanPath = path.join(runDir, 'browser_research_plan.json');
  const publishingHandoffPlanPath = path.join(runDir, 'publishing_handoff_plan.json');
  const reproducibilityManifestPath = path.join(runDir, 'reproducibility_manifest.json');
  const autonomyAuditPath = path.join(runDir, 'autonomy_audit.json');
  const nextActionPath = path.join(runDir, 'next_action.json');
  const providerPreflightPath = path.join(runDir, 'provider_preflight.json');
  const artifactInventoryPath = path.join(runDir, 'artifact_inventory.json');
  const blockerLedgerPath = path.join(runDir, 'blocker_ledger.json');
  const nextActionsPath = path.join(runDir, 'next_actions.json');
  const promptPacketPath = path.join(runDir, 'codex_next_prompt.md');
  const nextActions = buildNextActions(selected.job, capabilityProfile, providerDryRuns, secretFindings.length);
  const informationIndex = buildInformationIndex(rootDir);
  const contextPack = buildContextPack(rootDir, {
    maxFiles: options.maxContextFiles,
    maxCharsPerFile: options.maxContextCharsPerFile,
  });
  const jobRankings = rankIncomingJobs(options.env ?? process.env, rootDir);
  const evidenceMap = buildEvidenceMap(rootDir);
  const launchMap = buildLaunchMap(options.env ?? process.env, rootDir);
  const verificationMap = buildVerificationMap(rootDir);
  const capabilityUnlockMap = buildCapabilityUnlockMap(options.env ?? process.env, rootDir);
  const providerRouteMap = buildProviderRouteMap({ env: options.env ?? process.env, rootDir });
  const providerActivationPlan = buildProviderActivationPlan({ env: options.env ?? process.env, rootDir });
  const browserResearchPlan = buildBrowserResearchPlan({ env: options.env ?? process.env, rootDir });
  const publishingHandoffPlan = buildPublishingHandoffPlan({ env: options.env ?? process.env, rootDir });
  const reproducibilityManifest = buildReproducibilityManifest(rootDir);
  const autonomyAudit = buildAutonomyAudit(options.goal, options.env ?? process.env, rootDir);
  const providerPreflight = preflightProviderRequests(options.env ?? process.env, rootDir);
  const blockerLedger = buildBlockerLedger(options.env ?? process.env, rootDir);

  fs.writeFileSync(primitivesPath, `${JSON.stringify(listCodexPrimitives(), null, 2)}\n`);
  fs.writeFileSync(capabilitiesPath, `${JSON.stringify(capabilityProfile, null, 2)}\n`);
  fs.writeFileSync(informationIndexPath, `${JSON.stringify(informationIndex, null, 2)}\n`);
  fs.writeFileSync(contextPackPath, `${JSON.stringify(contextPack, null, 2)}\n`);
  fs.writeFileSync(jobRankingsPath, `${JSON.stringify(jobRankings, null, 2)}\n`);
  fs.writeFileSync(evidenceMapPath, `${JSON.stringify(evidenceMap, null, 2)}\n`);
  fs.writeFileSync(launchMapPath, `${JSON.stringify(launchMap, null, 2)}\n`);
  fs.writeFileSync(verificationMapPath, `${JSON.stringify(verificationMap, null, 2)}\n`);
  fs.writeFileSync(capabilityUnlockMapPath, `${JSON.stringify(capabilityUnlockMap, null, 2)}\n`);
  fs.writeFileSync(providerRouteMapPath, `${JSON.stringify(providerRouteMap, null, 2)}\n`);
  fs.writeFileSync(providerActivationPlanPath, `${JSON.stringify(providerActivationPlan, null, 2)}\n`);
  fs.writeFileSync(browserResearchPlanPath, `${JSON.stringify(browserResearchPlan, null, 2)}\n`);
  fs.writeFileSync(publishingHandoffPlanPath, `${JSON.stringify(publishingHandoffPlan, null, 2)}\n`);
  fs.writeFileSync(reproducibilityManifestPath, `${JSON.stringify(reproducibilityManifest, null, 2)}\n`);
  fs.writeFileSync(autonomyAuditPath, `${JSON.stringify(autonomyAudit, null, 2)}\n`);
  fs.writeFileSync(providerPreflightPath, `${JSON.stringify(providerPreflight, null, 2)}\n`);
  fs.writeFileSync(blockerLedgerPath, `${JSON.stringify(blockerLedger, null, 2)}\n`);
  fs.writeFileSync(nextActionsPath, `${JSON.stringify({ run_id: runId, next_actions: nextActions }, null, 2)}\n`);
  fs.writeFileSync(promptPacketPath, renderPromptPacket(options.goal, selected.job, nextActions, capabilityProfile));
  const artifactInventory = buildArtifactInventory(runDir);
  fs.writeFileSync(artifactInventoryPath, `${JSON.stringify(artifactInventory, null, 2)}\n`);

  const record: HarnessRunRecord = {
    run_id: runId,
    goal: options.goal,
    created_at: createdAt,
    status: secretFindings.length ? 'blocked' : providerDryRuns.some((result) => result.status === 'blocked') ? 'needs_capability' : 'advanced',
    selected_job: {
      path: selected.path,
      job_id: selected.job.job_id,
      reason: selected.reason,
    },
    capability_profile: capabilityProfile,
    primitives_path: primitivesPath,
    capabilities_path: capabilitiesPath,
    information_index_path: informationIndexPath,
    context_pack_path: contextPackPath,
    job_rankings_path: jobRankingsPath,
    evidence_map_path: evidenceMapPath,
    launch_map_path: launchMapPath,
    verification_map_path: verificationMapPath,
    capability_unlock_map_path: capabilityUnlockMapPath,
    provider_route_map_path: providerRouteMapPath,
    provider_activation_plan_path: providerActivationPlanPath,
    browser_research_plan_path: browserResearchPlanPath,
    publishing_handoff_plan_path: publishingHandoffPlanPath,
    reproducibility_manifest_path: reproducibilityManifestPath,
    autonomy_audit_path: autonomyAuditPath,
    next_action_path: nextActionPath,
    provider_preflight_path: providerPreflightPath,
    artifact_inventory_path: artifactInventoryPath,
    blocker_ledger_path: blockerLedgerPath,
    next_actions_path: nextActionsPath,
    prompt_packet_path: promptPacketPath,
    render_output_dir: renderDir,
    provider_dry_runs: providerDryRuns,
    stages,
    next_actions: nextActions,
  };

  const runPath = path.join(runDir, 'run.json');
  fs.writeFileSync(runPath, `${JSON.stringify(record, null, 2)}\n`);
  const nextAction = buildNextActionReport(options.goal, options.env ?? process.env, rootDir);
  fs.writeFileSync(nextActionPath, `${JSON.stringify(nextAction, null, 2)}\n`);
  fs.writeFileSync(record.artifact_inventory_path, `${JSON.stringify(buildArtifactInventory(runDir), null, 2)}\n`);
  return record;
}

export async function runCodexAutonomy(options: HarnessRunOptions): Promise<HarnessAutoResult> {
  if (!options.goal.trim()) throw new Error('goal must be a non-empty string.');

  const run = await runCodexHarness(options);
  const runDir = path.dirname(run.prompt_packet_path);
  const resume = resumeHarnessRun(runDir);
  const doctor = buildHarnessDoctor(options.env ?? process.env, process.cwd());
  const openBlockers = doctor.blocker_ledger.blockers.filter((blocker) => blocker.status === 'open');
  const hasHardOpenBlocker = openBlockers.some((blocker) => blocker.severity === 'blocker' || blocker.severity === 'high');
  const status: HarnessRunRecord['status'] = run.status === 'blocked'
    ? 'blocked'
    : hasHardOpenBlocker
      ? 'needs_capability'
      : run.status;
  const stopReason = openBlockers.length
    ? `Stopped at open gates: ${openBlockers.map((blocker) => blocker.id).join(', ')}.`
    : 'No open blocker ledger entries after the local harness run.';
  const nextCommands = [
    `npm run harness -- resume --run ${runDir}`,
    `npm run harness -- run-brief --run ${runDir}`,
    `npm run harness -- inventory --run ${runDir}`,
    'npm run harness -- run-history',
    `npm run harness -- autonomy-audit --goal "${options.goal.replace(/"/g, '\\"')}"`,
    `npm run harness -- goal-completion-audit --goal "${options.goal.replace(/"/g, '\\"')}" --env-file .env`,
    `npm run harness -- next-action --goal "${options.goal.replace(/"/g, '\\"')}" --env-file .env`,
    `npm run harness -- decision-surface --goal "${options.goal.replace(/"/g, '\\"')}" --env-file .env`,
    'npm run harness -- reproducibility-manifest',
    'npm run harness -- stage-source --dry-run',
    'npm run harness -- source-package',
    'npm run harness -- provider-preflight',
    'npm run harness -- provider-route-map --env-file .env',
    'npm run harness -- provider-activation-plan --env-file .env',
    'npm run harness -- browser-research-plan --env-file .env',
    'npm run harness -- publishing-handoff-plan --env-file .env',
    'npm run harness -- capability-unlock-map',
    'npm run harness -- provider-handoff --request .ops/provider_requests/sample_openai_image_request.json',
    'npm run harness -- doctor',
    ...resume.next_commands,
  ];
  if (doctor.repo_status.untracked_source_of_truth_count) {
    nextCommands.unshift('git status --short --untracked-files=all');
  }

  const autoResultPath = path.join(runDir, 'auto_result.json');
  const result: HarnessAutoResult = {
    created_at: new Date().toISOString(),
    goal: options.goal,
    status,
    auto_result_path: autoResultPath,
    decision: {
      action: 'ran_local_harness',
      reason: `Selected ${run.selected_job.job_id} and completed the local render/provider-gate pass.`,
      stop_reason: stopReason,
    },
    doctor,
    run,
    resume,
    next_commands: Array.from(new Set(nextCommands)),
  };

  fs.writeFileSync(autoResultPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(run.artifact_inventory_path, `${JSON.stringify(buildArtifactInventory(runDir), null, 2)}\n`);
  return result;
}

function selectCreativeJob(
  jobPath: string | undefined,
  rootDir: string,
  capabilityProfile: HarnessCapabilityProfile,
): { path: string; job: CreativeJobManifest; reason: string } {
  if (jobPath) {
    const resolved = path.resolve(jobPath);
    return {
      path: resolved,
      job: loadCreativeJobManifest(resolved),
      reason: 'explicit job path supplied by caller',
    };
  }

  const rankings = rankIncomingJobs({
    ALLOW_PAID_GENERATION: String(capabilityProfile.gates.allow_paid_generation),
    ALLOW_BROWSER_UI: String(capabilityProfile.gates.allow_browser_ui),
    ALLOW_SOCIAL_PUBLISHING: String(capabilityProfile.gates.allow_social_publishing),
  }, rootDir);
  const best = rankings[0];
  if (best) {
    return {
      path: best.path,
      job: loadCreativeJobManifest(best.path),
      reason: `highest harness rank (${best.score}): ${best.reasons.slice(0, 3).join('; ')}`,
    };
  }

  const jobs = listIncomingJobs(rootDir);
  if (!jobs.length) throw new Error('No incoming creative job manifests found.');
  return {
    path: jobs[0].path,
    job: loadCreativeJobManifest(jobs[0].path),
    reason: 'first sorted incoming job manifest',
  };
}

function listIncomingJobs(rootDir: string): Array<{ job_id: string; path: string }> {
  const incomingDir = path.join(rootDir, '.ops', 'creative_jobs', 'incoming');
  if (!fs.existsSync(incomingDir)) return [];
  return fs.readdirSync(incomingDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const filePath = path.join(incomingDir, file);
      const job = loadCreativeJobManifest(filePath);
      return { job_id: job.job_id, path: filePath };
    });
}

function listProviderRequests(rootDir: string): Array<{ request_id: string; provider: CreativeProviderName; path: string; status: string }> {
  const requestDir = path.join(rootDir, '.ops', 'provider_requests');
  if (!fs.existsSync(requestDir)) return [];
  return fs.readdirSync(requestDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const filePath = path.join(requestDir, file);
      const request = loadProviderRequestManifest(filePath);
      return {
        request_id: request.request_id,
        provider: request.provider,
        path: filePath,
        status: request.status,
      };
    });
}

function buildProviderPreflight(
  requestPath: string,
  env: Record<string, string | undefined>,
  rootDir: string,
): HarnessProviderPreflight {
  const resolvedRequestPath = resolveFromRoot(rootDir, requestPath);
  const request = loadProviderRequestManifest(resolvedRequestPath);
  const capabilityProfile = buildCapabilityProfile(env, rootDir);
  const credentialAvailable = providerCredentialAvailable(request.provider, capabilityProfile);
  const capabilityMissingGates = missingGatesForProviderRequest(request, capabilityProfile, credentialAvailable);
  const dryRun = runProviderDryRun(request, { env });
  const jobPath = incomingJobPath(rootDir, request.job_id);
  const jobExists = fs.existsSync(jobPath);
  let renderableJobAvailable = false;
  if (jobExists) {
    const job = loadCreativeJobManifest(jobPath);
    renderableJobAvailable = job.provider_policy.approved_providers.includes('local_renderer');
  }

  const prompt = providerPreflightAsset(rootDir, 'prompt', request.prompt_path, artifactKind(request.prompt_path));
  const inputAssets = request.input_assets.map((assetPath) => (
    providerPreflightAsset(rootDir, 'input_asset', assetPath, artifactKind(assetPath))
  ));
  const packageDir = providerPackageDir(rootDir, request.job_id);
  const declaredOutputs = request.output_requirements.files.map((file) => providerPreflightAsset(
    rootDir,
    'declared_output',
    path.join(packageDir, request.output_requirements.package_subdir, file.path),
    file.kind,
    file.description,
  ));
  const missingInputAssets = inputAssets.filter((asset) => !asset.exists);
  const missingInputPaths = missingInputAssets.map((asset) => asset.path);
  const missingPrompt = prompt.exists ? null : prompt.path;
  const canPrepareMissingInputs = missingInputAssets.length > 0
    && renderableJobAvailable
    && missingInputAssets.every((asset) => path.resolve(asset.absolute_path).startsWith(`${packageDir}${path.sep}`));
  const requestDisplayPath = relativeToRoot(rootDir, resolvedRequestPath);
  const suggestedPrepareCommand = canPrepareMissingInputs
    ? `npm run harness -- prepare-provider-inputs --request ${shellQuote(requestDisplayPath)}`
    : null;
  const readyForProviderHandoff = !missingPrompt && missingInputPaths.length === 0 && dryRun.external_calls_made === 0;
  const liveExternalCallAllowed = providerLiveCallAllowed(request, capabilityProfile, credentialAvailable);
  const readyForLiveRequest = readyForProviderHandoff && liveExternalCallAllowed;
  const liveBlockers = Array.from(new Set([
    ...(missingPrompt ? [`missing prompt_path: ${missingPrompt}`] : []),
    ...(missingInputPaths.length ? [`missing input_assets: ${missingInputPaths.join(', ')}`] : []),
    ...capabilityMissingGates,
  ]));
  const nextAction = missingPrompt
    ? `Restore or create the prompt file before provider handoff: ${missingPrompt}.`
    : missingInputPaths.length && suggestedPrepareCommand
      ? `Run ${suggestedPrepareCommand} to create the local provider input assets.`
      : missingInputPaths.length
        ? `Create or attach missing input asset(s): ${missingInputPaths.join(', ')}.`
        : readyForLiveRequest
          ? `Live request is ready; run npm run trend -- provider:run-live --file ${shellQuote(requestDisplayPath)} --package-dir ${shellQuote(relativeToRoot(rootDir, packageDir))}.`
          : capabilityNextAction(request, capabilityMissingGates, credentialAvailable);

  return {
    request_id: request.request_id,
    request_path: requestDisplayPath,
    provider: request.provider,
    provider_mode: request.provider_mode,
    status: request.status,
    job_id: request.job_id,
    job_path: relativeToRoot(rootDir, jobPath),
    job_exists: jobExists,
    prompt,
    input_assets: inputAssets,
    declared_outputs: declaredOutputs,
    missing_prompt: missingPrompt,
    missing_input_assets: missingInputPaths,
    dry_run: dryRun,
    renderable_job_available: renderableJobAvailable,
    suggested_prepare_command: suggestedPrepareCommand,
    ready_for_dry_run: !missingPrompt && dryRun.external_calls_made === 0,
    ready_for_provider_handoff: readyForProviderHandoff,
    ready_for_live_request: readyForLiveRequest,
    live_blockers: liveBlockers,
    next_action: nextAction,
  };
}

function runProviderRequests(
  providerDir: string,
  env: Record<string, string | undefined>,
  rootDir: string,
): ProviderDryRunResult[] {
  const requestDir = path.join(rootDir, '.ops', 'provider_requests');
  if (!fs.existsSync(requestDir)) return [];

  const results: ProviderDryRunResult[] = [];
  for (const file of fs.readdirSync(requestDir).filter((entry) => entry.endsWith('.json')).sort()) {
    const requestPath = path.join(requestDir, file);
    const request: ProviderRequestManifest = loadProviderRequestManifest(requestPath);
    const result = runProviderDryRun(request, { env });
    fs.writeFileSync(path.join(providerDir, `${request.request_id}.json`), `${JSON.stringify(result, null, 2)}\n`);
    results.push(result);
  }
  return results;
}

function scoreCreativeJob(
  job: CreativeJobManifest,
  filePath: string,
  capabilityProfile: HarnessCapabilityProfile,
): HarnessJobRanking {
  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = 0;

  if (job.provider_policy.approved_providers.includes('local_renderer')) {
    score += 25;
    reasons.push('local renderer approved');
  } else {
    blockers.push('local renderer is not approved');
  }

  if (job.trend_examples.length >= 3) {
    score += 18;
    reasons.push(`${job.trend_examples.length} trend examples`);
  } else {
    blockers.push('fewer than 3 trend examples');
    score += job.trend_examples.length * 4;
  }

  if (job.source_inputs.length >= 3) {
    score += 10;
    reasons.push(`${job.source_inputs.length} source inputs`);
  }

  if (job.output_requirements.slide_count === 5 && job.output_requirements.slides.length === 5) {
    score += 12;
    reasons.push('complete 5-slide output plan');
  }

  if (job.job_id.startsWith('worthscan_')) {
    score += 8;
    reasons.push('campaign-specific WorthScan manifest');
  }

  const combinedText = [
    job.niche,
    job.content_type,
    ...job.source_inputs.map((input) => `${input.label} ${input.value ?? ''} ${input.notes ?? ''}`),
    ...job.trend_examples.map((example) => `${example.hook} ${example.notes}`),
    ...job.output_requirements.slides.map((slide) => `${slide.on_screen_text} ${slide.visual_direction}`),
    job.output_requirements.caption,
    job.output_requirements.spoken_script,
    ...job.output_requirements.posting_notes,
    ...job.qa_notes,
  ].join('\n').toLowerCase();

  const concreteRiskCount = countMatches(
    combinedText,
    /\b(?:battery|charger|lock|authenticity|serial|fret|pickup|smell|odor|stain|missing|wear|repair|risk)\b/g,
  );
  if (concreteRiskCount > 0) {
    const points = Math.min(concreteRiskCount, 24);
    score += points;
    reasons.push(`${concreteRiskCount} concrete risk signal${concreteRiskCount === 1 ? '' : 's'}`);
  }

  const scoredSignals: Array<[RegExp, number, string]> = [
    [/\bbattery\b|\bcharger\b|\block\b|\bauthenticity\b|\bserial\b/, 12, 'specific hidden-risk hook'],
    [/\brisk\b|\bsubtract\b|\bmissing\b|\bwear\b|\brepair\b/, 10, 'explicit risk subtraction'],
    [/\bcomp\b|\bcompare\b|\bthree local\b/, 10, 'comparison proof'],
    [/\brange\b|\bconfidence\b|\bnot a guarantee\b|\bestimate\b/, 8, 'range-based valuation boundary'],
    [/\bcomment\b|\bscan\b/, 6, 'viewer CTA present'],
    [/\bbefore\b|\btrap\b|\bfools you\b|\beats the deal\b/, 6, 'first-frame tension'],
  ];
  for (const [pattern, points, reason] of scoredSignals) {
    if (pattern.test(combinedText)) {
      score += points;
      reasons.push(reason);
    }
  }

  if (job.provider_policy.allow_paid_generation && !capabilityProfile.gates.allow_paid_generation) {
    blockers.push('paid generation policy needs ALLOW_PAID_GENERATION=true');
    score -= 20;
  }
  if (job.provider_policy.allow_browser_ui && !capabilityProfile.gates.allow_browser_ui) {
    blockers.push('browser UI policy needs ALLOW_BROWSER_UI=true');
    score -= 12;
  }
  if (job.provider_policy.allow_social_publishing && !capabilityProfile.gates.allow_social_publishing) {
    blockers.push('social publishing policy needs ALLOW_SOCIAL_PUBLISHING=true');
    score -= 18;
  }
  if (job.provider_policy.account_automation_allowed !== false) {
    blockers.push('account automation policy is not false');
    score -= 50;
  }
  if (job.approval_status.state !== 'draft') {
    score -= 5;
    reasons.push(`approval state is ${job.approval_status.state}`);
  }

  return {
    rank: 0,
    job_id: job.job_id,
    path: filePath,
    score,
    runnable_now: blockers.length === 0,
    reasons,
    blockers,
  };
}

function addKnownSource(
  sources: HarnessInformationSource[],
  rootDir: string,
  id: string,
  kind: HarnessInformationSource['kind'],
  relativePath: string,
  role: string,
): void {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  sources.push({ id, kind, path: absolutePath, role });
}

function addGlobSources(
  sources: HarnessInformationSource[],
  rootDir: string,
  idPrefix: string,
  relativeDir: string,
  extension: string,
  kind: HarnessInformationSource['kind'],
  role: string,
): void {
  const dir = path.join(rootDir, relativeDir);
  if (!fs.existsSync(dir)) return;

  for (const file of walkFiles(dir).filter((filePath) => filePath.endsWith(extension)).sort()) {
    const relativePath = path.relative(rootDir, file);
    const slug = relativePath.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
    sources.push({
      id: `${idPrefix}.${slug}`,
      kind,
      path: file,
      role,
    });
  }
}

function walkFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function inventoryFile(rootDir: string, filePath: string): HarnessArtifactInventoryItem {
  const content = fs.readFileSync(filePath);
  const relativePath = path.relative(rootDir, filePath);
  return {
    path: filePath,
    relative_path: relativePath,
    kind: artifactKind(filePath),
    size_bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

function artifactKind(filePath: string): HarnessArtifactInventoryItem['kind'] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.md') return 'markdown';
  if (extension === '.txt') return 'text';
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return 'image';
  return 'other';
}

function gitOutput(rootDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function listTrackedSourceFiles(rootDir: string): string[] {
  const output = gitOutput(rootDir, ['ls-files']) ?? '';
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((filePath) => isSourceOfTruthPath(filePath))
    .sort();
}

function listUntrackedSourceFiles(rootDir: string): string[] {
  let output = '';
  try {
    output = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return ['git status failed; reproducibility could not be verified'];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3))
    .filter((filePath) => isSourceOfTruthPath(filePath))
    .sort();
}

function isSourceOfTruthPath(filePath: string): boolean {
  if (filePath === '.ops/creative_jobs/rendered/.gitignore') {
    return true;
  }

  if (
    filePath.includes('/rendered/')
    || filePath.startsWith('.ops/harness/')
    || filePath.startsWith('trend_outputs/')
    || filePath === 'trend_examples.sqlite'
    || filePath.includes('/node_modules/')
    || filePath.includes('/dist/')
    || filePath.includes('/build/')
    || filePath.includes('/output/')
  ) {
    return false;
  }

  return (
    filePath.startsWith('.ops/')
    || filePath.startsWith('.codex/skills/')
    || filePath.startsWith('src/')
    || filePath.startsWith('packages/')
    || filePath.startsWith('schemas/')
    || filePath.startsWith('tests/')
    || filePath.startsWith('reports/')
    || ['.env.example', '.gitignore', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json'].includes(filePath)
  );
}

function sourceOfTruthRole(filePath: string): string {
  if (filePath.startsWith('src/')) return 'application and harness source';
  if (filePath.startsWith('packages/')) return 'creative package source';
  if (filePath.startsWith('schemas/')) return 'validation schema';
  if (filePath.startsWith('tests/')) return 'verification test';
  if (filePath.startsWith('.ops/creative_jobs/incoming/')) return 'incoming creative job manifest';
  if (filePath === '.ops/creative_jobs/rendered/.gitignore') return 'generated render output boundary';
  if (filePath.startsWith('.ops/provider_requests/')) return 'provider request manifest';
  if (filePath.startsWith('.ops/launch/')) return 'launch operating document';
  if (filePath.startsWith('.ops/accounts/')) return 'account setup operating document';
  if (filePath.startsWith('.ops/browser/')) return 'browser research operating document or fixture';
  if (filePath.startsWith('.ops/prompts/')) return 'provider prompt template';
  if (filePath.startsWith('.ops/trend_seeds/')) return 'trend seed documentation';
  if (filePath.startsWith('.ops/')) return 'operations source';
  if (filePath.startsWith('.codex/skills/')) return 'local Codex skill';
  if (filePath.startsWith('reports/')) return 'readiness or evidence report';
  if (filePath === '.env.example') return 'redacted capability env template';
  if (filePath === '.gitignore') return 'generated artifact boundary';
  if (filePath === 'README.md') return 'operator documentation';
  if (filePath === 'package.json') return 'package scripts and dependency manifest';
  if (filePath === 'package-lock.json') return 'dependency lockfile';
  if (filePath === 'tsconfig.json') return 'TypeScript project config';
  return 'repository source';
}

function validationTargetIdsForPath(filePath: string): string[] {
  const ids = new Set<string>();
  if (/\.(ts|tsx)$/.test(filePath) || filePath === 'tsconfig.json') ids.add('typescript.typecheck');
  if (filePath === 'src/codex-harness.ts' || filePath === 'tests/codex-harness.test.ts' || filePath === 'README.md') {
    ids.add('harness.focused');
    ids.add('harness.information_maps');
  }
  if (
    filePath === 'src/provider-workflow.ts'
    || filePath === 'tests/provider-workflow.test.ts'
    || filePath.startsWith('.ops/provider_requests/')
    || filePath.startsWith('.ops/prompts/')
    || filePath === 'schemas/provider-request.schema.json'
  ) {
    ids.add('provider.focused');
  }
  if (
    filePath === 'src/browser-capture.ts'
    || filePath === 'tests/browser-capture.test.ts'
    || filePath === 'schemas/browser-capture.schema.json'
    || filePath.startsWith('.ops/browser/')
  ) {
    ids.add('browser.focused');
  }
  if (
    filePath === 'src/trend-research.ts'
    || filePath === 'src/trend-cli.ts'
    || filePath === 'tests/trend-research.test.ts'
    || filePath === 'schemas/trend-example.schema.json'
    || filePath.startsWith('.ops/trend_seeds/')
  ) {
    ids.add('trend.focused');
  }
  if (
    filePath === 'src/post-metrics.ts'
    || filePath === 'schemas/post-metrics.schema.json'
  ) {
    ids.add('metrics.focused');
  }
  if (
    filePath === 'src/valuation-card.ts'
    || filePath === 'schemas/valuation-card.schema.json'
  ) {
    ids.add('worthscan.focused');
  }
  if (
    filePath.startsWith('packages/creative/')
    || filePath.startsWith('.ops/creative_jobs/incoming/')
    || filePath === 'tests/creative-job-schema.test.ts'
  ) {
    ids.add('creative.focused');
    ids.add('worthscan.focused');
  }
  if (
    filePath.startsWith('.ops/launch/')
    || filePath.startsWith('.ops/accounts/')
    || filePath === 'tests/launch-kit.test.ts'
  ) {
    ids.add('launch.focused');
    ids.add('harness.information_maps');
  }
  if (filePath === 'package.json' || filePath === 'package-lock.json' || filePath === '.env.example') {
    ids.add('harness.focused');
    ids.add('test.full_suite');
  }
  if (!ids.size && isSourceOfTruthPath(filePath)) ids.add('test.full_suite');
  return Array.from(ids).sort();
}

function verificationTargetForId(
  id: string,
  changedFiles: HarnessVerificationChangedFile[],
): HarnessVerificationTarget | null {
  const matchedPaths = changedFiles
    .filter((file) => file.validation_target_ids.includes(id))
    .map((file) => file.path);
  const target = verificationTargetDefinition(id);
  if (!target) return null;
  return {
    id,
    reason: target.reason,
    commands: target.commands,
    matched_paths: matchedPaths,
  };
}

function verificationTargetDefinition(id: string): { reason: string; commands: string[] } | null {
  switch (id) {
    case 'typescript.typecheck':
      return {
        reason: 'TypeScript or config changed; compile-time contracts must still hold.',
        commands: ['npm run typecheck -- --pretty false'],
      };
    case 'harness.focused':
      return {
        reason: 'Codex harness, docs, package scripts, or harness tests changed.',
        commands: [
          'npm exec tsx -- --test tests/codex-harness.test.ts --runInBand',
          'npm run harness -- autonomy-audit --goal "Make WorthScan autonomous for Codex"',
        ],
      };
    case 'harness.information_maps':
      return {
        reason: 'Information surfaces, launch docs, or harness docs changed; smoke the Codex-readable maps.',
        commands: [
          'npm run harness -- job-matrix',
          'npm run harness -- evidence-map',
          'npm run harness -- launch-map',
          'npm run harness -- verification-map',
        ],
      };
    case 'provider.focused':
      return {
        reason: 'Provider request, prompt, schema, or workflow changed.',
        commands: [
          'npm exec tsx -- --test tests/provider-workflow.test.ts --runInBand',
          'npm run harness -- provider-preflight',
        ],
      };
    case 'browser.focused':
      return {
        reason: 'Browser capture protocol, schema, sample, or code changed.',
        commands: ['npm exec tsx -- --test tests/browser-capture.test.ts --runInBand'],
      };
    case 'trend.focused':
      return {
        reason: 'Trend research intake, search, brief generation, or seed data changed.',
        commands: ['npm exec tsx -- --test tests/trend-research.test.ts --runInBand'],
      };
    case 'metrics.focused':
      return {
        reason: 'Post metrics schema or storage changed.',
        commands: ['npm exec tsx -- --test tests/worthscan-pilot.test.ts --runInBand'],
      };
    case 'creative.focused':
      return {
        reason: 'Creative job schema, renderer, provider router, or incoming manifests changed.',
        commands: [
          'npm exec tsx -- --test tests/creative-job-schema.test.ts tests/worthscan-pilot.test.ts --runInBand',
          'npm run harness -- job-matrix',
        ],
      };
    case 'worthscan.focused':
      return {
        reason: 'WorthScan valuation, job manifests, local render package, or pilot metrics changed.',
        commands: [
          'npm exec tsx -- --test tests/worthscan-pilot.test.ts --runInBand',
          'npm run harness -- evidence-map',
        ],
      };
    case 'launch.focused':
      return {
        reason: 'Manual launch docs, account docs, queue, or launch tests changed.',
        commands: [
          'npm exec tsx -- --test tests/launch-kit.test.ts --runInBand',
          'npm run harness -- launch-map',
        ],
      };
    case 'harness.stage_source_dry_run':
      return {
        reason: 'Source-of-truth files changed; preview staging before committing to keep generated artifacts out of git.',
        commands: ['npm run harness -- stage-source --dry-run'],
      };
    case 'harness.autonomy_audit':
      return {
        reason: 'Re-check the objective-level autonomy gates against current repo evidence.',
        commands: ['npm run harness -- autonomy-audit --goal "Make WorthScan autonomous for Codex"'],
      };
    case 'harness.doctor':
      return {
        reason: 'Refresh the aggregate readiness report after targeted validation.',
        commands: ['npm run harness -- doctor'],
      };
    case 'test.full_suite':
      return {
        reason: 'Run the full suite before committing or claiming a broad autonomy improvement.',
        commands: ['npm test -- --runInBand'],
      };
    default:
      return null;
  }
}

function providerCredentialAvailable(
  provider: CreativeProviderName,
  capabilityProfile: HarnessCapabilityProfile,
): boolean {
  if (provider === 'openai_image') return capabilityProfile.credentials.openai_api_key_available;
  if (provider === 'gemini_image' || provider === 'gemini_video_understanding') {
    return capabilityProfile.credentials.gemini_api_key_available;
  }
  return true;
}

function providerRouteForPreflight(
  preflight: HarnessProviderPreflight,
  capabilityProfile: HarnessCapabilityProfile,
  handoffHistory: HarnessProviderHandoffHistoryEntry[] = [],
): HarnessProviderRoute {
  const credentialAvailable = providerCredentialAvailable(preflight.provider, capabilityProfile);
  const recommendedCredentials = recommendedCredentialsForProvider(preflight.provider);
  const requiredEnv = requiredEnvForProvider(preflight.provider);
  const blockers = uniqueSorted(preflight.live_blockers);
  const hasMissingLocalInput = Boolean(preflight.missing_prompt || preflight.missing_input_assets.length);
  const hasMissingCredential = blockers.includes('provider credential') && !credentialAvailable;
  const hasMissingAdapter = blockers.includes('live provider implementation');
  const routeType = providerRouteType(preflight);
  const isHandoffOnlyRoute = routeType === 'provider_handoff';
  const existingHandoffs = handoffHistory.filter((entry) => entry.request_id === preflight.request_id);
  const latestHandoff = existingHandoffs[0] ?? null;
  const wouldApiKeyHelp = hasMissingCredential
    && preflight.ready_for_provider_handoff
    && routeType === 'live_provider'
    && recommendedCredentials.length > 0
    && !hasMissingAdapter;
  const status: HarnessProviderRoute['status'] = preflight.ready_for_live_request
    ? 'ready_for_live'
    : hasMissingLocalInput
      ? 'needs_local_input'
      : isHandoffOnlyRoute && preflight.ready_for_provider_handoff
        ? 'ready_for_handoff'
      : hasMissingAdapter
        ? 'needs_adapter'
        : hasMissingCredential
          ? 'needs_credential'
          : blockers.length
            ? 'needs_gate'
            : 'ready_for_handoff';
  const packageDir = `.ops/creative_jobs/rendered/${preflight.job_id}`;

  return {
    request_id: preflight.request_id,
    provider: preflight.provider,
    request_path: preflight.request_path,
    job_id: preflight.job_id,
    route_type: routeType,
    status,
    score: providerRouteScore({
      routeType,
      status,
      blockerCount: blockers.length,
      wouldApiKeyHelp,
      readyForProviderHandoff: preflight.ready_for_provider_handoff,
      readyForLiveRequest: preflight.ready_for_live_request,
    }),
    ready_for_provider_handoff: preflight.ready_for_provider_handoff,
    ready_for_live_request: preflight.ready_for_live_request,
    existing_handoff_count: existingHandoffs.length,
    latest_handoff_path: latestHandoff?.manifest_path ?? null,
    latest_handoff_created_at: latestHandoff?.created_at ?? null,
    would_api_key_help: wouldApiKeyHelp,
    credential_available: credentialAvailable,
    recommended_credentials: recommendedCredentials,
    required_env: requiredEnv,
    blockers,
    next_action: providerRouteNextAction(preflight, status, routeType, recommendedCredentials, requiredEnv, latestHandoff),
    safe_probe_commands: uniqueSorted([
      `npm run harness -- provider-preflight --request ${shellQuote(preflight.request_path)}`,
      'npm run harness -- provider-route-map --env-file .env',
      'npm run harness -- credential-coverage --env-file .env',
      ...(preflight.ready_for_provider_handoff && !latestHandoff
        ? [`npm run harness -- provider-handoff --request ${shellQuote(preflight.request_path)} --env-file .env`]
        : preflight.suggested_prepare_command ? [preflight.suggested_prepare_command] : []),
    ]),
    activation_commands: providerRouteActivationCommands(preflight, status, requiredEnv, packageDir),
    writes: preflight.ready_for_live_request
      ? preflight.declared_outputs.map((output) => output.path)
      : preflight.ready_for_provider_handoff && !latestHandoff
        ? ['.ops/harness/provider_handoffs/<packet_id>/']
        : preflight.suggested_prepare_command
          ? [packageDir]
          : [],
  };
}

function providerRouteType(preflight: HarnessProviderPreflight): HarnessProviderRoute['route_type'] {
  if (preflight.provider === 'browser_manual') return 'browser_manual';
  if (preflight.provider === 'openai_image' && preflight.provider_mode === 'generation') return 'live_provider';
  if (preflight.provider === 'gemini_image' || preflight.provider === 'gemini_video_understanding') return 'unsupported_live_provider';
  return 'provider_handoff';
}

function recommendedCredentialsForProvider(provider: CreativeProviderName): string[] {
  if (provider === 'openai_image') return ['OPENAI_API_KEY'];
  if (provider === 'gemini_image' || provider === 'gemini_video_understanding') return ['GEMINI_API_KEY or GOOGLE_API_KEY'];
  return [];
}

function providerRouteScore(input: {
  routeType: HarnessProviderRoute['route_type'];
  status: HarnessProviderRoute['status'];
  blockerCount: number;
  wouldApiKeyHelp: boolean;
  readyForProviderHandoff: boolean;
  readyForLiveRequest: boolean;
}): number {
  let score = input.readyForLiveRequest ? 100 : input.readyForProviderHandoff ? 55 : 20;
  if (input.routeType === 'live_provider') score += 20;
  if (input.routeType === 'provider_handoff') score += 8;
  if (input.wouldApiKeyHelp) score += 15;
  if (input.status === 'needs_adapter') score -= 35;
  if (input.status === 'needs_local_input') score -= 20;
  if (input.status === 'needs_gate') score -= 8;
  score -= input.blockerCount * 2;
  return score;
}

function providerRouteNextAction(
  preflight: HarnessProviderPreflight,
  status: HarnessProviderRoute['status'],
  routeType: HarnessProviderRoute['route_type'],
  recommendedCredentials: string[],
  requiredEnv: string[],
  latestHandoff: HarnessProviderHandoffHistoryEntry | null = null,
): string {
  if (status === 'ready_for_live') {
    return `Run provider:run-live for ${preflight.request_id} only through its reviewed request manifest and declared package output paths.`;
  }
  if (latestHandoff && preflight.ready_for_provider_handoff) {
    if (routeType === 'live_provider') {
      return `Latest provider handoff already exists at ${latestHandoff.manifest_path}; resolve ${requiredEnv.join(' and ')}${recommendedCredentials.length ? ` plus ${recommendedCredentials.join(' or ')}` : ''} before live execution, and do not write another handoff unless the request or inputs change.`;
    }
    return `Latest provider handoff already exists at ${latestHandoff.manifest_path}; inspect provider-route-map or update request inputs before regenerating it.`;
  }
  if (status === 'ready_for_handoff') {
    return `Write a provider handoff packet for ${preflight.request_id} before considering any external provider execution.`;
  }
  if (status === 'needs_local_input') return preflight.next_action;
  if (status === 'needs_adapter') {
    return `Do not provision a key for ${preflight.request_id} as the next step; this provider route still needs a reviewed live adapter or should remain a handoff.`;
  }
  if (status === 'needs_credential') {
    if (routeType !== 'live_provider') {
      return `Keep ${preflight.request_id} as a provider handoff until its request policy and live adapter path are explicit; do not provision a key as the next step.`;
    }
    return `A ${recommendedCredentials.join(' or ')} presence flag plus ${requiredEnv.join(' and ')} would move ${preflight.request_id} closer to live execution.`;
  }
  if (status === 'needs_gate') {
    return `Resolve request policy and env gates for ${preflight.request_id} before using provider credentials.`;
  }
  return preflight.next_action;
}

function providerRouteActivationCommands(
  preflight: HarnessProviderPreflight,
  status: HarnessProviderRoute['status'],
  requiredEnv: string[],
  packageDir: string,
): string[] {
  if (preflight.provider !== 'openai_image' || preflight.provider_mode !== 'generation') return [];
  const envPrefix = requiredEnv.includes('ALLOW_PAID_GENERATION=true') ? 'ALLOW_PAID_GENERATION=true ' : '';
  const command = `${envPrefix}npm run trend -- provider:run-live --env-file .env --file ${shellQuote(preflight.request_path)} --package-dir ${shellQuote(packageDir)}`;
  return status === 'ready_for_live' || status === 'needs_credential' || status === 'needs_gate'
    ? [command]
    : [];
}

function providerActivationRequest(
  route: HarnessProviderRoute,
  preflight: HarnessProviderPreflight | null,
  capabilityProfile: HarnessCapabilityProfile,
): HarnessProviderActivationRequest {
  const missingCredentials = route.route_type === 'live_provider' && !route.credential_available
    ? route.recommended_credentials
    : [];
  const missingEnv = route.required_env.filter((required) => !providerActivationEnvSatisfied(required, capabilityProfile));
  const policyBlockers = route.blockers.filter((blocker) => blocker.startsWith('request.'));
  const adapterBlockers = route.blockers.filter((blocker) => blocker === 'live provider implementation');
  const localInputBlockers = uniqueSorted([
    ...(preflight?.missing_prompt ? [preflight.missing_prompt] : []),
    ...(preflight?.missing_input_assets ?? []),
  ]);
  const activationStatus = providerActivationStatus({
    route,
    missingCredentials,
    missingEnv,
    policyBlockers,
    adapterBlockers,
    localInputBlockers,
  });
  const dryRunCommand = `npm run trend -- provider:run-dry --env-file .env --file ${shellQuote(route.request_path)}`;
  const handoffCommand = route.ready_for_provider_handoff && route.existing_handoff_count === 0 && activationStatus !== 'needs_adapter'
    ? `npm run harness -- provider-handoff --request ${shellQuote(route.request_path)} --env-file .env`
    : null;
  const activationCommand = route.activation_commands[0] ?? null;
  const liveWrites = route.route_type === 'live_provider'
    ? preflight?.declared_outputs.map((output) => output.path) ?? []
    : [];

  return {
    request_id: route.request_id,
    provider: route.provider,
    request_path: route.request_path,
    job_id: route.job_id,
    route_type: route.route_type,
    route_status: route.status,
    activation_status: activationStatus,
    would_api_key_help: route.would_api_key_help,
    credential_available: route.credential_available,
    missing_credentials: missingCredentials,
    required_env: route.required_env,
    missing_env: missingEnv,
    policy_blockers: policyBlockers,
    adapter_blockers: adapterBlockers,
    local_input_blockers: localInputBlockers,
    live_blockers: route.blockers,
    existing_handoff_count: route.existing_handoff_count,
    latest_handoff_path: route.latest_handoff_path,
    activation_command: activationCommand,
    dry_run_command: dryRunCommand,
    handoff_command: handoffCommand,
    safe_probe_commands: uniqueSorted([
      ...route.safe_probe_commands,
      dryRunCommand,
    ]),
    verification_commands: uniqueSorted([
      `npm run harness -- provider-preflight --request ${shellQuote(route.request_path)} --env-file .env`,
      'npm run harness -- provider-route-map --env-file .env',
      'npm run harness -- provider-activation-plan --env-file .env',
      'npm run harness -- credential-coverage --env-file .env',
      ...(activationCommand ? [activationCommand] : []),
    ]),
    external_call_boundary: {
      external_calls_made: 0,
      live_external_call_allowed: route.ready_for_live_request,
      requires_explicit_command: true,
      writes: route.ready_for_live_request ? route.writes : liveWrites,
    },
    next_action: providerActivationNextAction({
      route,
      activationStatus,
      missingCredentials,
      missingEnv,
      policyBlockers,
      adapterBlockers,
      localInputBlockers,
      activationCommand,
    }),
  };
}

function providerActivationStatus(input: {
  route: HarnessProviderRoute;
  missingCredentials: string[];
  missingEnv: string[];
  policyBlockers: string[];
  adapterBlockers: string[];
  localInputBlockers: string[];
}): HarnessProviderActivationRequest['activation_status'] {
  if (input.route.ready_for_live_request) return 'ready_for_live';
  if (input.localInputBlockers.length) return 'needs_local_input';
  if (input.adapterBlockers.length) return 'needs_adapter';
  if (input.route.route_type === 'provider_handoff' && input.route.ready_for_provider_handoff) return 'handoff_only';
  if (input.missingCredentials.length || input.route.would_api_key_help) return 'needs_api_key';
  if (input.missingEnv.length) return 'needs_gate';
  if (input.policyBlockers.length) return 'needs_policy';
  return 'blocked';
}

function providerActivationEnvSatisfied(
  required: string,
  capabilityProfile: HarnessCapabilityProfile,
): boolean {
  if (required === 'ALLOW_PAID_GENERATION=true') return capabilityProfile.gates.allow_paid_generation;
  if (required === 'ALLOW_BROWSER_UI=true') return capabilityProfile.gates.allow_browser_ui;
  if (required === 'ALLOW_SOCIAL_PUBLISHING=true') return capabilityProfile.gates.allow_social_publishing;
  return false;
}

function providerActivationNextAction(input: {
  route: HarnessProviderRoute;
  activationStatus: HarnessProviderActivationRequest['activation_status'];
  missingCredentials: string[];
  missingEnv: string[];
  policyBlockers: string[];
  adapterBlockers: string[];
  localInputBlockers: string[];
  activationCommand: string | null;
}): string {
  if (input.activationStatus === 'ready_for_live') {
    return `Run ${input.route.request_id} only through the reviewed activation command and declared output paths: ${input.activationCommand ?? 'missing activation command'}.`;
  }
  if (input.activationStatus === 'needs_api_key') {
    return `Provide ${input.missingCredentials.join(' or ')} and ${input.missingEnv.join(' and ') || 'required env gates'}, then rerun provider-activation-plan before any live call.`;
  }
  if (input.activationStatus === 'needs_gate') {
    return `Set ${input.missingEnv.join(' and ')} only for a reviewed provider command, then rerun provider-activation-plan.`;
  }
  if (input.activationStatus === 'needs_policy') {
    return `Keep ${input.route.request_id} out of live execution until request policy is reviewed: ${input.policyBlockers.join(', ')}.`;
  }
  if (input.activationStatus === 'needs_adapter') {
    return `Do not provision a key for ${input.route.request_id} as the next step; live execution still needs a reviewed adapter or should remain manual/handoff.`;
  }
  if (input.activationStatus === 'needs_local_input') {
    return `Prepare local inputs for ${input.route.request_id}: ${input.localInputBlockers.join(', ')}.`;
  }
  if (input.activationStatus === 'handoff_only') {
    return input.route.latest_handoff_path
      ? `Use existing handoff evidence at ${input.route.latest_handoff_path}; this route is not a live API-key activation target.`
      : `Write a provider handoff for ${input.route.request_id}; this route is not a live API-key activation target.`;
  }
  return input.route.next_action;
}

function browserCaptureFiles(rootDir: string): Array<{ bucket: HarnessBrowserCaptureEntry['bucket']; filePath: string }> {
  const specs: Array<{ bucket: HarnessBrowserCaptureEntry['bucket']; dir: string }> = [
    { bucket: 'sample', dir: path.join(rootDir, '.ops', 'browser', 'samples') },
    { bucket: 'raw', dir: path.join(rootDir, '.ops', 'browser', 'captures', 'raw') },
    { bucket: 'reviewed', dir: path.join(rootDir, '.ops', 'browser', 'captures', 'reviewed') },
    { bucket: 'rejected', dir: path.join(rootDir, '.ops', 'browser', 'captures', 'rejected') },
  ];

  return specs.flatMap((spec) => {
    if (!fs.existsSync(spec.dir)) return [];
    return fs.readdirSync(spec.dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => ({ bucket: spec.bucket, filePath: path.join(spec.dir, file) }));
  });
}

function browserCaptureEntry(
  rootDir: string,
  captureFile: { bucket: HarnessBrowserCaptureEntry['bucket']; filePath: string },
): HarnessBrowserCaptureEntry {
  const capturePath = relativeToRoot(rootDir, captureFile.filePath);
  const validationCommand = `npm run trend -- browser:validate-capture --file ${shellQuote(capturePath)}`;
  try {
    const capture = loadBrowserCapture(captureFile.filePath);
    const ingestReady = capture.human_review_status === 'approved';
    return {
      path: capturePath,
      bucket: captureFile.bucket,
      valid: true,
      capture_id: capture.capture_id,
      source_name: capture.source_name,
      source_url: capture.source_url,
      captured_at: capture.captured_at,
      niche: capture.niche,
      platform: capture.platform,
      observed_format: capture.observed_format,
      human_review_status: capture.human_review_status,
      ingest_ready: ingestReady,
      validation_command: validationCommand,
      ingest_command: ingestReady
        ? `npm run trend -- browser:ingest-capture --file ${shellQuote(capturePath)} --db trend_examples.sqlite`
        : null,
      blockers: browserCaptureBlockers(capture, captureFile.bucket),
      error: null,
    };
  } catch (error) {
    return {
      path: capturePath,
      bucket: captureFile.bucket,
      valid: false,
      capture_id: null,
      source_name: null,
      source_url: null,
      captured_at: null,
      niche: null,
      platform: null,
      observed_format: null,
      human_review_status: null,
      ingest_ready: false,
      validation_command: validationCommand,
      ingest_command: null,
      blockers: ['capture validation failed'],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function browserCaptureBlockers(
  capture: BrowserCapture,
  bucket: HarnessBrowserCaptureEntry['bucket'],
): string[] {
  const blockers: string[] = [];
  if (capture.human_review_status !== 'approved') {
    blockers.push(`human_review_status=${capture.human_review_status}`);
  }
  if (bucket === 'raw') {
    blockers.push('capture remains in raw review folder');
  }
  if (bucket === 'rejected') {
    blockers.push('capture is in rejected folder');
  }
  return blockers;
}

function browserRequestSummary(
  rootDir: string,
  preflight: HarnessProviderPreflight,
): HarnessBrowserResearchPlan['browser_request'] {
  let policyAllowsBrowserUi = false;
  try {
    const request = loadProviderRequestManifest(resolveFromRoot(rootDir, preflight.request_path));
    policyAllowsBrowserUi = request.cost_policy.allow_browser_ui;
  } catch {
    policyAllowsBrowserUi = false;
  }
  return {
    request_id: preflight.request_id,
    request_path: preflight.request_path,
    policy_allows_browser_ui: policyAllowsBrowserUi,
    ready_for_provider_handoff: preflight.ready_for_provider_handoff,
    blockers: preflight.live_blockers,
  };
}

function capabilityUnlockRequest(preflight: HarnessProviderPreflight): HarnessCapabilityUnlockRequest {
  return {
    request_id: preflight.request_id,
    provider: preflight.provider,
    request_path: preflight.request_path,
    ready_for_provider_handoff: preflight.ready_for_provider_handoff,
    ready_for_live_request: preflight.ready_for_live_request,
    live_blockers: preflight.live_blockers,
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function runHistoryEntry(runDir: string, rootDir: string): HarnessRunHistoryEntry {
  const runPath = path.join(runDir, 'run.json');
  const fallbackCounts = emptyStageStatusCounts();
  if (!fs.existsSync(runPath)) {
    return unreadableRunHistoryEntry(runDir, 'run.json not found');
  }

  try {
    const record = JSON.parse(fs.readFileSync(runPath, 'utf8')) as Partial<HarnessRunRecord>;
    const resume = (() => {
      try {
        return resumeHarnessRun(runDir);
      } catch {
        return null;
      }
    })();
    const inventory = (() => {
      try {
        return buildArtifactInventory(runDir);
      } catch {
        return null;
      }
    })();
    const providerDryRuns = Array.isArray(record.provider_dry_runs) ? record.provider_dry_runs : [];
    const stages = Array.isArray(record.stages) ? record.stages : [];
    const stageStatusCounts = stages.reduce((counts, stage) => {
      if (stage.status in counts) counts[stage.status] += 1;
      return counts;
    }, emptyStageStatusCounts());
    const missingArtifacts = resume?.missing_artifacts ?? [];

    return {
      run_id: typeof record.run_id === 'string' && record.run_id ? record.run_id : path.basename(runDir),
      run_dir: path.resolve(runDir),
      created_at: typeof record.created_at === 'string' ? record.created_at : null,
      goal: typeof record.goal === 'string' ? record.goal : null,
      status: isHarnessRunStatus(record.status) ? record.status : 'unreadable',
      selected_job: record.selected_job && typeof record.selected_job.job_id === 'string'
        ? record.selected_job
        : null,
      artifact_count: inventory?.artifact_count ?? null,
      missing_artifact_count: missingArtifacts.length,
      missing_artifacts: missingArtifacts.map((artifactPath) => relativeToRoot(rootDir, artifactPath)),
      provider_dry_run_count: providerDryRuns.length,
      provider_blocked_count: providerDryRuns.filter((result) => result.status === 'blocked').length,
      external_calls_made: providerDryRuns.reduce((total, result) => total + result.external_calls_made, 0),
      stage_status_counts: stageStatusCounts,
      next_actions: Array.isArray(record.next_actions) ? record.next_actions : [],
      resume_commands: resume?.next_commands ?? [],
      error: null,
    };
  } catch (error) {
    return {
      ...unreadableRunHistoryEntry(runDir, error instanceof Error ? error.message : String(error)),
      stage_status_counts: fallbackCounts,
    };
  }
}

function unreadableRunHistoryEntry(runDir: string, error: string): HarnessRunHistoryEntry {
  return {
    run_id: path.basename(runDir),
    run_dir: path.resolve(runDir),
    created_at: null,
    goal: null,
    status: 'unreadable',
    selected_job: null,
    artifact_count: null,
    missing_artifact_count: null,
    missing_artifacts: [],
    provider_dry_run_count: null,
    provider_blocked_count: null,
    external_calls_made: null,
    stage_status_counts: emptyStageStatusCounts(),
    next_actions: [],
    resume_commands: [],
    error,
  };
}

function emptyStageStatusCounts(): Record<HarnessStage['status'], number> {
  return {
    completed: 0,
    skipped: 0,
    blocked: 0,
  };
}

function isHarnessRunStatus(value: unknown): value is HarnessRunRecord['status'] {
  return value === 'advanced' || value === 'needs_capability' || value === 'blocked';
}

interface CredentialCoverageDefinition {
  key: string;
  provider_or_surface: string;
  current_binding: HarnessCredentialCoverageKey['current_binding'];
  requestProviders: CreativeProviderName[];
  filePath?: string;
}

function credentialCoverageDefinitions(): CredentialCoverageDefinition[] {
  return [
    {
      key: 'OPENAI_API_KEY',
      provider_or_surface: 'OpenAI image live generation',
      current_binding: 'live_provider',
      requestProviders: ['openai_image'],
    },
    {
      key: 'GEMINI_API_KEY',
      provider_or_surface: 'Gemini image or video provider requests',
      current_binding: 'provider_handoff',
      requestProviders: ['gemini_image', 'gemini_video_understanding'],
    },
    {
      key: 'GOOGLE_API_KEY',
      provider_or_surface: 'Gemini image or video provider requests',
      current_binding: 'provider_handoff',
      requestProviders: ['gemini_image', 'gemini_video_understanding'],
    },
    {
      key: 'LIGHTREEL_API_KEY',
      provider_or_surface: 'legacy Lightreel media-generation seam',
      current_binding: 'research_or_legacy',
      requestProviders: [],
    },
    {
      key: 'SCRAPE_CREATORS_API_KEY',
      provider_or_surface: 'legacy creator-scrape research seam',
      current_binding: 'research_or_legacy',
      requestProviders: [],
    },
    {
      key: 'OPENROUTER_API_KEY',
      provider_or_surface: 'unbound LLM routing key',
      current_binding: 'unbound',
      requestProviders: [],
    },
    {
      key: 'DOUBLESPEED_TOKENS_FILE',
      provider_or_surface: 'local Doublespeed token file',
      current_binding: 'local_token_file',
      requestProviders: [],
      filePath: '.doublespeed-tokens.json',
    },
  ];
}

function credentialCoverageForDefinition(input: {
  definition: CredentialCoverageDefinition;
  baseEnv: EnvMap;
  mergedEnv: EnvMap;
  envFile: LoadedEnvFile | null;
  rootDir: string;
  providerPreflight: HarnessProviderPreflightReport;
}): HarnessCredentialCoverageKey {
  const { definition, baseEnv, mergedEnv, envFile, rootDir, providerPreflight } = input;
  const presence = definition.filePath
    ? localFileCredentialPresence(rootDir, definition.filePath)
    : envCredentialPresence(definition.key, baseEnv, envFile);
  const relevantRequests = providerPreflight.preflights.filter((preflight) => (
    definition.requestProviders.includes(preflight.provider)
  ));
  const providerCredentialSatisfied = definition.key === 'GEMINI_API_KEY' || definition.key === 'GOOGLE_API_KEY'
    ? Boolean(nonEmpty(mergedEnv.GEMINI_API_KEY) || nonEmpty(mergedEnv.GOOGLE_API_KEY))
    : presence.present;
  const readyRequestIds = relevantRequests
    .filter((preflight) => preflight.ready_for_live_request && providerCredentialSatisfied)
    .map((preflight) => preflight.request_id);
  const blockedRequests = relevantRequests.filter((preflight) => !preflight.ready_for_live_request);
  const blockers = uniqueSorted(blockedRequests.flatMap((preflight) => preflight.live_blockers));

  return {
    key: definition.key,
    present: presence.present,
    source: presence.source,
    provider_or_surface: definition.provider_or_surface,
    current_binding: definition.current_binding,
    status: credentialCoverageStatus({
      present: presence.present,
      providerCredentialSatisfied,
      relevantRequests,
      readyRequestIds,
      blockers,
      currentBinding: definition.current_binding,
    }),
    required_by_request_ids: relevantRequests.map((preflight) => preflight.request_id),
    ready_request_ids: readyRequestIds,
    blocked_request_ids: blockedRequests.map((preflight) => preflight.request_id),
    blockers,
  };
}

function credentialCoverageStatus(input: {
  present: boolean;
  providerCredentialSatisfied: boolean;
  relevantRequests: HarnessProviderPreflight[];
  readyRequestIds: string[];
  blockers: string[];
  currentBinding: HarnessCredentialCoverageKey['current_binding'];
}): HarnessCredentialCoverageKey['status'] {
  if (input.readyRequestIds.length) return 'usable_now';
  if (input.relevantRequests.length && !input.providerCredentialSatisfied && input.blockers.includes('provider credential')) {
    return 'missing_required';
  }
  if (input.present && input.blockers.some((blocker) => blocker.includes('ALLOW_'))) return 'present_but_gated';
  if (input.present && input.blockers.includes('live provider implementation')) return 'present_but_unimplemented';
  if (input.present && (input.relevantRequests.length === 0 || input.currentBinding !== 'live_provider')) return 'present_but_unbound';
  return 'not_configured';
}

function envCredentialPresence(
  key: string,
  baseEnv: EnvMap,
  envFile: LoadedEnvFile | null,
): { present: boolean; source: HarnessCredentialCoverageKey['source'] } {
  const processPresent = Boolean(nonEmpty(baseEnv[key]));
  const filePresent = Boolean(nonEmpty(envFile?.values[key]));
  return {
    present: processPresent || filePresent,
    source: processPresent && filePresent
      ? 'both'
      : processPresent
        ? 'process_env'
        : filePresent
          ? 'env_file'
          : 'none',
  };
}

function localFileCredentialPresence(
  rootDir: string,
  filePath: string,
): { present: boolean; source: HarnessCredentialCoverageKey['source'] } {
  return fs.existsSync(path.join(rootDir, filePath))
    ? { present: true, source: 'local_file' }
    : { present: false, source: 'none' };
}

function requiredEnvForProvider(provider: CreativeProviderName): string[] {
  if (provider === 'browser_manual') return ['ALLOW_BROWSER_UI=true'];
  if (provider === 'openai_image' || provider === 'gemini_image' || provider === 'gemini_video_understanding') {
    return ['ALLOW_PAID_GENERATION=true'];
  }
  return [];
}

function providerDisplayName(provider: CreativeProviderName): string {
  if (provider === 'openai_image') return 'OpenAI image';
  if (provider === 'gemini_image') return 'Gemini image';
  if (provider === 'gemini_video_understanding') return 'Gemini video-understanding';
  if (provider === 'browser_manual') return 'browser manual';
  return 'local renderer';
}

function providerRequestPolicyAllowsCapability(request: ProviderRequestManifest): boolean {
  if (request.provider === 'browser_manual') return request.cost_policy.allow_browser_ui;
  if (request.provider === 'openai_image' || request.provider === 'gemini_image' || request.provider === 'gemini_video_understanding') {
    return request.cost_policy.allow_paid_generation;
  }
  return true;
}

function missingGatesForProviderRequest(
  request: ProviderRequestManifest,
  capabilityProfile: HarnessCapabilityProfile,
  credentialAvailable: boolean,
): string[] {
  const missing: string[] = [];
  if (request.status !== 'draft') missing.push(`request.status=${request.status}`);
  if (!providerRequestPolicyAllowsCapability(request)) missing.push('request cost policy');
  if (request.provider === 'browser_manual' && !capabilityProfile.gates.allow_browser_ui) missing.push('ALLOW_BROWSER_UI=true');
  if ((request.provider === 'openai_image' || request.provider === 'gemini_image' || request.provider === 'gemini_video_understanding')
    && !capabilityProfile.gates.allow_paid_generation) {
    missing.push('ALLOW_PAID_GENERATION=true');
  }
  if (!credentialAvailable) missing.push('provider credential');
  if (request.provider === 'openai_image') {
    if (request.provider_mode !== 'generation') missing.push('request.provider_mode=generation');
    if (!request.cost_policy.external_calls_allowed) missing.push('request.cost_policy.external_calls_allowed=true');
    if (request.cost_policy.max_cost_usd <= 0) missing.push('request.cost_policy.max_cost_usd>0');
  } else if (request.provider !== 'local_renderer') {
    missing.push('live provider implementation');
  }
  return missing;
}

function providerLiveCallAllowed(
  request: ProviderRequestManifest,
  capabilityProfile: HarnessCapabilityProfile,
  credentialAvailable: boolean,
): boolean {
  return request.provider === 'openai_image'
    && request.status === 'draft'
    && request.provider_mode === 'generation'
    && request.cost_policy.allow_paid_generation
    && request.cost_policy.external_calls_allowed
    && request.cost_policy.max_cost_usd > 0
    && capabilityProfile.gates.allow_paid_generation
    && credentialAvailable;
}

function capabilityNextAction(
  request: ProviderRequestManifest,
  missingGates: string[],
  credentialAvailable: boolean,
): string {
  if (!missingGates.length && request.provider === 'openai_image') {
    return `OpenAI image live adapter is ready for ${request.request_id}; run provider:run-live with the rendered package directory.`;
  }
  if (!missingGates.length) return `Dry-run gate is clear for ${request.request_id}; live external calls remain disabled until a reviewed adapter exists.`;
  if (missingGates.includes('provider credential') && !credentialAvailable) {
    return `Provide ${providerDisplayName(request.provider)} credentials through environment or platform tooling, then rerun capability-plan.`;
  }
  if (missingGates.includes('live provider implementation')) {
    return 'Keep this request in dry-run/manual mode until a reviewed live adapter exists and external-call policy changes.';
  }
  return `Resolve missing gate(s): ${missingGates.join(', ')}.`;
}

function countJsonFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((file) => file.endsWith('.json')).length;
}

function filePathIfExists(rootDir: string, relativePath: string): string | null {
  const absolutePath = path.join(rootDir, relativePath);
  return fs.existsSync(absolutePath) ? absolutePath : null;
}

function providerPreflightAsset(
  rootDir: string,
  role: HarnessProviderPreflightAsset['role'],
  filePath: string,
  kind: HarnessProviderPreflightAsset['kind'],
  description?: string,
): HarnessProviderPreflightAsset {
  const absolutePath = resolveFromRoot(rootDir, filePath);
  return {
    role,
    path: relativeToRoot(rootDir, absolutePath),
    absolute_path: absolutePath,
    exists: fs.existsSync(absolutePath),
    kind,
    ...(description ? { description } : {}),
  };
}

function providerHandoffAsset(
  asset: HarnessProviderPreflightAsset,
  maxTextChars: number,
): HarnessProviderHandoffAsset {
  const role = providerHandoffAssetRole(asset.role);
  if (!asset.exists) {
    return {
      role,
      path: asset.path,
      absolute_path: asset.absolute_path,
      exists: false,
      kind: asset.kind,
      size_bytes: null,
      sha256: null,
    };
  }

  const content = fs.readFileSync(asset.absolute_path);
  const handoffAsset: HarnessProviderHandoffAsset = {
    role,
    path: asset.path,
    absolute_path: asset.absolute_path,
    exists: true,
    kind: asset.kind,
    size_bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };

  if (['markdown', 'text', 'json', 'research', 'manifest', 'qa'].includes(asset.kind)) {
    const text = content.toString('utf8');
    handoffAsset.text_excerpt = text.slice(0, maxTextChars);
    handoffAsset.truncated = text.length > maxTextChars;
  }

  return handoffAsset;
}

function providerHandoffAssetRole(role: HarnessProviderPreflightAsset['role']): HarnessProviderHandoffAsset['role'] {
  if (role === 'declared_output') {
    throw new Error('Declared outputs are targets and cannot be serialized as provider handoff input assets.');
  }
  return role;
}

function incomingJobPath(rootDir: string, jobId: string): string {
  return path.join(path.resolve(rootDir), '.ops', 'creative_jobs', 'incoming', `${jobId}.json`);
}

function providerPackageDir(rootDir: string, jobId: string): string {
  return path.join(path.resolve(rootDir), '.ops', 'creative_jobs', 'rendered', jobId);
}

function resolveFromRoot(rootDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(rootDir, filePath);
}

function relativeToRoot(rootDir: string, filePath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (!relativePath) return '.';
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return resolvedPath.replace(/\\/g, '/');
  }
  return relativePath.replace(/\\/g, '/');
}

function localRenderCreatedPaths(render: LocalRenderResult): string[] {
  return [
    render.source_image_path,
    render.listing_path,
    render.trend_examples_path,
    render.research_notes_path,
    render.gemini_image_prompt_path,
    render.openai_image_prompt_path,
    render.caption_prompt_path,
    render.caption_path,
    render.hashtags_path,
    render.spoken_script_path,
    render.posting_notes_path,
    render.qa_checklist_path,
    render.approval_path,
    render.rendered_manifest_path,
    ...render.slide_paths,
  ];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function packSource(source: HarnessInformationSource, maxCharsPerFile: number): HarnessContextPackSource {
  const content = fs.readFileSync(source.path);
  const text = content.toString('utf8');
  const excerpt = text.slice(0, maxCharsPerFile);
  return {
    id: source.id,
    kind: source.kind,
    path: source.path,
    role: source.role,
    size_bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    excerpt,
    truncated: text.length > excerpt.length,
  };
}

function contextKindPriority(kind: HarnessInformationSource['kind']): number {
  const order: Record<HarnessInformationSource['kind'], number> = {
    source: 0,
    schema: 1,
    job: 2,
    provider_request: 3,
    ops_doc: 4,
    skill: 5,
    report: 6,
    test: 7,
  };
  return order[kind];
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

function readLaunchQueue(rootDir: string): { path: string; text: string; orders: Map<string, number> } {
  const launchQueuePath = path.join(rootDir, '.ops', 'launch', 'launch_queue.md');
  if (!fs.existsSync(launchQueuePath)) {
    return { path: launchQueuePath, text: '', orders: new Map() };
  }

  const text = fs.readFileSync(launchQueuePath, 'utf8');
  const orders = new Map<string, number>();
  for (const match of text.matchAll(/\|\s*(\d+)\s*\|\s*`([^`]+)`/g)) {
    orders.set(match[2], Number(match[1]));
  }
  return { path: launchQueuePath, text, orders };
}

function launchDocPaths(): string[] {
  return [
    '.ops/accounts/account_setup_checklist.md',
    '.ops/accounts/socials.md',
    '.ops/accounts/handle_ideas.md',
    '.ops/accounts/profile_copy.md',
    '.ops/accounts/launch_checklist.md',
    '.ops/launch/launch_queue.md',
    '.ops/launch/manual_launch_packet.md',
    '.ops/launch/posting_qa_checklist.md',
    '.ops/launch/metrics_tracking_template.md',
  ];
}

function publishingHandoffJob(job: HarnessLaunchMapJob): HarnessPublishingHandoffJob {
  const requiredPath = (role: HarnessLaunchMapRequiredFile['role']): string | null => (
    job.required_files.find((file) => file.role === role)?.path ?? null
  );
  const metricsCommands = job.next_commands.filter((command) => command.includes('npm run metrics:'));
  const manualReviewCommands = uniqueSorted([
    `npm run creative -- validate --job ${shellQuote(job.job_path)}`,
    'npm run harness -- evidence-map',
    'npm run harness -- launch-map',
    'npm run harness -- publishing-handoff-plan --env-file .env',
    ...job.next_commands.filter((command) => !command.includes('npm run metrics:')),
  ]);
  const postingBlockers = uniqueSorted([
    ...job.blockers,
    ...(!job.manual_handoff_ready ? ['manual launch handoff files are incomplete'] : []),
    'account-owner confirmation required',
  ]);

  return {
    job_id: job.job_id,
    launch_order: job.order,
    job_path: job.job_path,
    rendered_package_path: job.package_path,
    manifest_path: requiredPath('manifest'),
    caption_path: requiredPath('caption'),
    hashtags_path: requiredPath('hashtags'),
    posting_notes_path: requiredPath('posting_notes'),
    qa_checklist_path: requiredPath('qa_checklist'),
    approval_path: requiredPath('approval'),
    slides_path: requiredPath('slides'),
    approval_state: job.approval_state,
    job_allows_social_publishing: job.job_allows_social_publishing,
    generated_asset_count: job.generated_asset_count,
    approved_generated_asset_count: job.approved_generated_asset_count,
    manual_handoff_ready: job.manual_handoff_ready,
    autonomous_publish_ready: job.autonomous_publish_ready,
    blockers: job.blockers,
    manual_review_commands: manualReviewCommands,
    manual_post_boundary: {
      external_calls_made: 0,
      auto_post_allowed: false,
      manual_post_allowed_after_confirmation: job.manual_handoff_ready,
      requires_account_owner_confirmation: true,
      requires_human_approval: true,
      requires_approved_generated_assets: true,
      writes: [],
      blocked_by: postingBlockers,
    },
    metrics_commands: metricsCommands,
    next_action: job.manual_handoff_ready
      ? 'Have the account owner review the package, post manually if approved, then record the posted URL with the metrics command.'
      : 'Complete the missing launch package files and copy before manual account-owner review.',
  };
}

function launchRequiredFile(
  rootDir: string,
  role: Exclude<HarnessLaunchMapRequiredFile['role'], 'slides'>,
  filePath: string,
): HarnessLaunchMapRequiredFile {
  return {
    role,
    path: relativeToRoot(rootDir, filePath),
    exists: fs.existsSync(filePath),
  };
}

function launchQueueSection(queueText: string, jobId: string): string {
  const heading = new RegExp(`^## \\d+\\. \`${escapeRegExp(jobId)}\`$`, 'm');
  const match = heading.exec(queueText);
  if (!match) return '';

  const start = match.index;
  const afterHeading = start + match[0].length;
  const next = /\n## \d+\. `/.exec(queueText.slice(afterHeading));
  return queueText.slice(start, next ? afterHeading + next.index : queueText.length);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function launchCopyStatus(section: string): HarnessLaunchMapCopyStatus {
  return {
    section_present: section.length > 0,
    tiktok_caption: section.includes('TikTok caption:'),
    instagram_caption: section.includes('Instagram caption:'),
    youtube_title: section.includes('YouTube Shorts title:'),
    youtube_description: section.includes('YouTube Shorts description:'),
    hashtags: section.includes('Hashtags:'),
    first_comment: section.includes('First comment:'),
    posting_checklist: section.includes('Posting checklist:'),
    metric_schedule: ['1-hour:', '24-hour:', '72-hour:', '7-day:'].every((marker) => section.includes(marker)),
  };
}

function launchCopyMissingFields(status: HarnessLaunchMapCopyStatus): string[] {
  const missing: string[] = [];
  if (!status.section_present) missing.push('section');
  if (!status.tiktok_caption) missing.push('TikTok caption');
  if (!status.instagram_caption) missing.push('Instagram caption');
  if (!status.youtube_title) missing.push('YouTube Shorts title');
  if (!status.youtube_description) missing.push('YouTube Shorts description');
  if (!status.hashtags) missing.push('hashtags');
  if (!status.first_comment) missing.push('first comment');
  if (!status.posting_checklist) missing.push('posting checklist');
  if (!status.metric_schedule) missing.push('metric schedule');
  return missing;
}

function launchNextCommands(
  rootDir: string,
  job: CreativeJobManifest,
  metricsRecordCount: number,
  manualHandoffReady: boolean,
): string[] {
  return Array.from(new Set([
    `npm run creative -- validate --job ${shellQuote(relativeToRoot(rootDir, incomingJobPath(rootDir, job.job_id)))}`,
    `npm run harness -- evidence-map`,
    ...(manualHandoffReady && metricsRecordCount === 0
      ? [`npm run metrics:create-post -- --job-id ${shellQuote(job.job_id)} --platform <platform> --account-handle <handle> --posted-url <url> --content-type ${shellQuote(job.content_type)} --hook ${shellQuote(job.output_requirements.slides[0]?.on_screen_text ?? job.content_type)} --format slideshow --cta scan`]
      : []),
    ...(metricsRecordCount > 0 ? ['npm run metrics:add-snapshot -- --post-id <post-id> --views 0 --likes 0 --comments 0 --shares 0 --saves 0 --follows 0 --profile-visits 0 --dms 0 --notes "<snapshot note>"'] : []),
  ]));
}

function evaluateClaimSafety(job: CreativeJobManifest): HarnessClaimSafety {
  const text = jobTextCorpus(job);
  const disclaimerPresent = /estimate|range|not a guarantee|not guaranteed|not an appraisal|not official/i.test(text);
  const rangeLanguagePresent = /\brange\b|\blow(?:er)? half\b|\bhigh(?:er)? half\b|\bbuy, bargain, or pass\b/i.test(text);
  const exactValueLanguagePresent = /\bexact(?:ly)?\s+(?:value|worth|price)\b|\bappraised at\b|\bworth\s+\$?\d[\d,]*(?:\.\d{2})?\b/i.test(text);
  const exactValueClaimPresent = exactValueLanguagePresent
    && !/\b(?:do not|don't|never|avoid)\s+claim(?:ing)?\b[^.\n]*(?:exact(?:ly)?\s+(?:value|worth|price)|appraised at|worth\s+\$?\d)/i.test(text);
  const guaranteeClaimPresent = /guaranteed value|certified appraisal|official appraisal/i.test(text)
    && !/not (?:a )?(?:guarantee|guaranteed|an appraisal|official appraisal)/i.test(text);
  const comparisonLanguagePresent = /\bcomp(?:s|arable|are)?\b|\bcompare\b|\blisting(?:s)?\b/i.test(text);
  const riskLanguagePresent = /\brisk\b|\brepair\b|\bmissing\b|\bcondition\b|\bsubtract\b|\bbattery\b|\btuneup\b/i.test(text);
  const manualReviewRequired = job.approval_status.state !== 'approved'
    || !job.approval_status.human_reviewer
    || job.generated_assets.some((asset) => !asset.approved_for_posting);
  const blockers = [
    ...(job.source_inputs.length ? [] : ['no source inputs recorded']),
    ...(job.trend_examples.length ? [] : ['no trend examples recorded']),
    ...(disclaimerPresent ? [] : ['valuation disclaimer language missing']),
    ...(rangeLanguagePresent ? [] : ['range-based valuation language missing']),
    ...(exactValueClaimPresent ? ['exact value claim requires high-confidence valuation evidence'] : []),
    ...(guaranteeClaimPresent ? ['guaranteed or official appraisal language is not allowed'] : []),
  ];

  return {
    disclaimer_present: disclaimerPresent,
    range_language_present: rangeLanguagePresent,
    exact_value_claim_present: exactValueClaimPresent,
    guarantee_claim_present: guaranteeClaimPresent,
    comparison_language_present: comparisonLanguagePresent,
    risk_language_present: riskLanguagePresent,
    manual_review_required: manualReviewRequired,
    blockers,
  };
}

function hasManualBoundary(job: CreativeJobManifest): boolean {
  return /manual|human|no scraping|no browser|no social publishing|post manually|approval/i.test(jobTextCorpus(job));
}

function jobTextCorpus(job: CreativeJobManifest): string {
  return [
    job.niche,
    job.content_type,
    ...job.source_inputs.flatMap((input) => [
      input.label,
      input.value ?? '',
      input.notes ?? '',
      input.url ?? '',
    ]),
    ...job.trend_examples.flatMap((example) => [
      example.hook,
      example.notes,
      example.source_name,
    ]),
    ...job.provider_policy.notes,
    ...job.output_requirements.slides.flatMap((slide) => [
      slide.on_screen_text,
      slide.visual_direction,
    ]),
    job.output_requirements.caption,
    job.output_requirements.spoken_script,
    ...job.output_requirements.posting_notes,
    ...job.approval_status.notes,
    ...job.generated_assets.map((asset) => asset.notes ?? ''),
    ...job.qa_notes,
  ].join('\n');
}

function buildNextActions(
  job: CreativeJobManifest,
  capabilities: HarnessCapabilityProfile,
  providerDryRuns: ProviderDryRunResult[],
  secretFindingCount: number,
): string[] {
  const actions: string[] = [];
  if (secretFindingCount) {
    actions.push('Inspect context/secret_scan.json and remove or quarantine secret-like values before autonomous provider work.');
  }

  actions.push(`Review rendered package for ${job.job_id}; replace placeholder visuals with real approved item media if the local render is not sufficient.`);
  actions.push('Use primitives.json as the callable Codex command menu for the next autonomous step.');

  const blockedProviders = providerDryRuns.filter((result) => result.status === 'blocked');
  if (blockedProviders.length) {
    actions.push('Run npm run harness -- provider-preflight and prepare any missing local provider inputs before considering env gates or live adapters.');
  }

  if (capabilities.credentials.openai_api_key_available || capabilities.credentials.gemini_api_key_available) {
    actions.push('A provider API key appears available by presence flag; keep values out of artifacts and route live calls through provider manifests and provider:run-live only.');
  } else {
    actions.push('No paid provider API key was detected; continue with local renderer, browser captures, and stored trend evidence.');
  }

  if (!capabilities.gates.allow_social_publishing || !job.provider_policy.allow_social_publishing) {
    actions.push('Publishing remains outside this run: social publishing requires env gate, job policy approval, human-approved assets, and account-owner confirmation.');
  }

  return actions;
}

function renderPromptPacket(
  goal: string,
  job: CreativeJobManifest,
  nextActions: string[],
  capabilities: HarnessCapabilityProfile,
): string {
  return [
    `# Codex Harness Packet: ${job.job_id}`,
    '',
    '## Goal',
    goal,
    '',
    '## Selected Job',
    `- job_id: ${job.job_id}`,
    `- niche: ${job.niche}`,
    `- content_type: ${job.content_type}`,
    `- platforms: ${job.platform_targets.join(', ')}`,
    '',
    '## Capability Profile',
    `- autonomy_level: ${capabilities.autonomy_level}`,
    `- allow_paid_generation: ${capabilities.gates.allow_paid_generation}`,
    `- allow_browser_ui: ${capabilities.gates.allow_browser_ui}`,
    `- allow_social_publishing: ${capabilities.gates.allow_social_publishing}`,
    `- openai_api_key_available: ${capabilities.credentials.openai_api_key_available}`,
    `- gemini_api_key_available: ${capabilities.credentials.gemini_api_key_available}`,
    '',
    '## Next Actions',
    ...nextActions.map((action) => `- ${action}`),
    '',
  ].join('\n');
}

function createRunId(goal: string, createdAt: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || 'codex-harness-run';
  const hash = crypto.createHash('sha256').update(`${goal}:${createdAt}`).digest('hex').slice(0, 8);
  return `${createdAt.replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')}-${slug}-${hash}`;
}

function createPackageId(createdAt: string): string {
  return `${createdAt.replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')}-source-package`;
}

function createProviderHandoffId(createdAt: string, requestId: string): string {
  const safeRequestId = requestId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'provider-request';
  return `${createdAt.replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')}-${safeRequestId}-handoff`;
}

function aggregateFileHashes(files: HarnessSourcePackageFile[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of files.slice().sort((a, b) => a.source_path.localeCompare(b.source_path))) {
    hash.update(file.source_path);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function capabilityEnvKeys(): string[] {
  return [
    'ALLOW_PAID_GENERATION',
    'ALLOW_BROWSER_UI',
    'ALLOW_SOCIAL_PUBLISHING',
    'OPENAI_API_KEY',
    'OPENAI_IMAGE_MODEL',
    'OPENAI_IMAGE_SIZE',
    'OPENAI_IMAGE_QUALITY',
    'OPENAI_IMAGE_OUTPUT_FORMAT',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'OPENROUTER_API_KEY',
    'LIGHTREEL_API_KEY',
    'SCRAPE_CREATORS_API_KEY',
  ];
}

function capabilityEnvKeyPurpose(key: string): string[] {
  if (key === 'ALLOW_PAID_GENERATION') return ['provider live generation gate'];
  if (key === 'ALLOW_BROWSER_UI') return ['browser research gate'];
  if (key === 'ALLOW_SOCIAL_PUBLISHING') return ['publishing gate'];
  if (key === 'OPENAI_API_KEY') return ['openai_image provider credential'];
  if (key.startsWith('OPENAI_IMAGE_')) return ['openai_image live generation option'];
  if (key === 'GEMINI_API_KEY' || key === 'GOOGLE_API_KEY') return ['gemini provider credential'];
  if (key === 'OPENROUTER_API_KEY') return ['unbound OpenRouter credential'];
  if (key === 'LIGHTREEL_API_KEY') return ['legacy Lightreel provider credential'];
  if (key === 'SCRAPE_CREATORS_API_KEY') return ['legacy ScrapeCreators provider credential'];
  return ['capability environment'];
}

function redactEnvFile(envFile: LoadedEnvFile): HarnessEnvFileSummary {
  return {
    path: envFile.path,
    absolute_path: envFile.absolute_path,
    exists: envFile.exists,
    loaded_key_count: envFile.loaded_key_count,
    keys: envFile.keys,
    ignored_line_count: envFile.ignored_line_count,
    warnings: envFile.warnings,
  };
}

function envEnabled(env: Record<string, string | undefined>, key: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env[key] ?? '').toLowerCase());
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const [command = 'help', ...rest] = argv;
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }

  return { command, options };
}

function stringOpt(options: Record<string, string | boolean>, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredStringOpt(options: Record<string, string | boolean>, key: string): string {
  const value = stringOpt(options, key);
  if (!value) throw new Error(`Missing required option --${key}`);
  return value;
}

function numberOpt(options: Record<string, string | boolean>, key: string): number | undefined {
  const value = stringOpt(options, key);
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`--${key} must be a positive number`);
  return number;
}

function flagEnabled(options: Record<string, string | boolean>, key: string): boolean {
  const value = options[key];
  return value === true || (typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()));
}

function cliEnv(options: Record<string, string | boolean>): MergedEnvFileReport {
  return mergeEnvWithFile(process.env, {
    envFile: stringOpt(options, 'env-file'),
    rootDir: process.cwd(),
  });
}

function printHelp(): void {
  console.log(`Viral-Bench Codex harness

Commands:
  auto --goal "<goal>" [--job .ops/creative_jobs/incoming/<job>.json] [--out .ops/harness/runs/<id>] [--run-id <id>]
    Run one bounded local autonomous pass, persist artifacts, and report stop gates.

  doctor
    Print a readiness report with repo status, information surface, latest run, blockers, and recommended commands.

  repo-status
    Print branch, remote, dirty state, and untracked source-of-truth files.

  capability-plan
    Print local/provider/browser/publishing readiness with missing gates, credentials, and request-level next actions.

  capability-unlock-map [--env-file .env]
    Print required env, credential, policy, request/job, activation, and verification steps for each closed autonomy gate.

  capability-env [--env-file .env]
    Print redacted key-presence and source information for capability gates and provider credentials.

  credential-coverage [--env-file .env]
    Print redacted credential usefulness across provider requests, live readiness, missing requirements, and unbound keys.

  provider-route-map [--env-file .env]
    Rank provider request routes and report whether an API key, env gate, local input, or adapter would unlock each route.

  provider-activation-plan [--env-file .env]
    Print the API-key/live-provider activation boundary across route ranking, credential presence, handoff history, and exact commands.

  browser-research-plan [--env-file .env]
    Print browser research docs, capture inventory, review/ingestion readiness, and browser UI gate blockers.

  publishing-handoff-plan [--env-file .env]
    Print manual launch docs, ready packages, account-owner confirmation, local metrics commands, and social-publishing blockers.

  provider-preflight [--request .ops/provider_requests/<request>.json] [--out .ops/harness/provider_preflight.json] [--env-file .env]
    Check provider request prompts, input assets, declared outputs, dry-runs, and local preparation commands.

  prepare-provider-inputs --request .ops/provider_requests/<request>.json [--out .ops/creative_jobs/rendered/<job_id>]
    Render the canonical local package for a provider request job so declared input assets exist.

  provider-handoff --request .ops/provider_requests/<request>.json [--out .ops/harness/provider_handoffs/<packet_id>] [--env-file .env]
    Write a bounded provider handoff packet with request, job, prompt, asset hashes, dry-run status, live-call eligibility, and blockers.

  reproducibility-manifest [--out .ops/harness/reproducibility_manifest.json]
    Print or write the source-of-truth boundary, generated artifact boundary, stage command, and verification commands.

  verification-map
    Print changed files, matched validation targets, exact commands, staging command, and verification notes.

  stage-source [--dry-run] [--apply]
    Preview or apply git staging for manifest-classified source-of-truth files only.

  source-package [--out .ops/harness/source_packages/<package_id>]
    Copy source-of-truth files into an ignored package directory with hashes and a verifier manifest.

  verify-source-package --package .ops/harness/source_packages/<package_id>
    Verify every copied source package file hash and aggregate package hash.

  autonomy-audit --goal "<goal>" [--out .ops/harness/autonomy_audit.json] [--env-file .env]
    Audit the autonomy objective against current repo evidence and capability gates.

  goal-completion-audit --goal "<goal>" [--out .ops/harness/goal_completion_audit.json] [--env-file .env]
    Audit the full thread objective requirement by requirement and report whether it can be marked complete.

  autonomy-plan --goal "<goal>" [--out .ops/harness/autonomy_plan.json] [--env-file .env]
    Print or write an ordered Codex execution queue with selected next step, evidence, gates, and writes.

  next-action --goal "<goal>" [--out .ops/harness/next_action.json] [--env-file .env]
    Print or write the next orientation, progress, capability-unlock, and human-boundary actions for Codex.

  decision-surface --goal "<goal>" [--out .ops/harness/decision_surface.json] [--env-file .env]
    Merge plan, goal audit, blockers, providers, credentials, launch state, and run history into action queues.

  inspect
    Print capability flags, incoming jobs, provider requests, and Codex primitives.

  primitives
    Print the callable primitive command menu.

  information-index
    Print the complete information source map.

  rank-jobs
    Rank incoming creative jobs for autonomous selection.

  job-matrix
    Print per-job readiness across rank, rendered package, providers, launch queue, metrics, blockers, and next commands.

  evidence-map
    Print per-job source inputs, trend references, rendered evidence files, claim-safety flags, blockers, and next commands.

  launch-map
    Print launch docs, queued jobs, rendered posting files, platform copy coverage, approval gates, metrics follow-up, and publishing blockers.

  context-pack [--out .ops/harness/context_pack.json] [--max-files 80] [--max-chars-per-file 2400]
    Write a bounded context pack with hashed file excerpts for Codex.

  inventory --run .ops/harness/runs/<run_id>
    Inventory a run folder with artifact hashes.

  resume --run .ops/harness/runs/<run_id>
    Inspect an existing run and return missing artifacts plus next commands.

  run-brief [--run .ops/harness/runs/<run_id>] [--out .ops/harness/run_brief.json] [--max-chars 1200]
    Summarize the latest or specified run with stage counts, provider gates, next actions, artifact hashes, and bounded excerpts.

  run-history [--limit 20]
    Summarize recent durable run folders, selected jobs, statuses, missing artifacts, provider dry-run counts, and resume commands.

  latest-run
    Find and summarize the newest valid harness run.

  blockers
    Print the current autonomy blocker ledger.

  run --goal "<goal>" [--job .ops/creative_jobs/incoming/<job>.json] [--out .ops/harness/runs/<id>] [--run-id <id>] [--env-file .env]
    Select a job, render a local package, evaluate provider gates, and write durable Codex run artifacts.
`);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const envReport = cliEnv(options);
  const effectiveEnv = envReport.effective_env;

  switch (command) {
    case 'auto': {
      const result = await runCodexAutonomy({
        goal: requiredStringOpt(options, 'goal'),
        jobPath: stringOpt(options, 'job'),
        outDir: stringOpt(options, 'out'),
        runId: stringOpt(options, 'run-id'),
        maxContextFiles: numberOpt(options, 'max-context-files'),
        maxContextCharsPerFile: numberOpt(options, 'max-context-chars-per-file'),
        env: effectiveEnv,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'doctor':
      console.log(JSON.stringify(buildHarnessDoctor(effectiveEnv), null, 2));
      return;

    case 'repo-status':
      console.log(JSON.stringify(buildRepoStatus(), null, 2));
      return;

    case 'capability-plan':
      console.log(JSON.stringify(buildCapabilityPlan(effectiveEnv), null, 2));
      return;

    case 'capability-unlock-map':
      console.log(JSON.stringify(buildCapabilityUnlockMap(effectiveEnv), null, 2));
      return;

    case 'capability-env':
      console.log(JSON.stringify(buildCapabilityEnvPlan({
        env: process.env,
        envFile: stringOpt(options, 'env-file'),
        rootDir: process.cwd(),
      }), null, 2));
      return;

    case 'credential-coverage':
      console.log(JSON.stringify(buildCredentialCoverageMap({
        env: process.env,
        envFile: stringOpt(options, 'env-file'),
        rootDir: process.cwd(),
      }), null, 2));
      return;

    case 'provider-route-map':
      console.log(JSON.stringify(buildProviderRouteMap({
        env: process.env,
        envFile: stringOpt(options, 'env-file'),
        rootDir: process.cwd(),
      }), null, 2));
      return;

    case 'provider-activation-plan':
      console.log(JSON.stringify(buildProviderActivationPlan({
        env: process.env,
        envFile: stringOpt(options, 'env-file'),
        rootDir: process.cwd(),
      }), null, 2));
      return;

    case 'browser-research-plan':
      console.log(JSON.stringify(buildBrowserResearchPlan({
        env: process.env,
        envFile: stringOpt(options, 'env-file'),
        rootDir: process.cwd(),
      }), null, 2));
      return;

    case 'publishing-handoff-plan':
      console.log(JSON.stringify(buildPublishingHandoffPlan({
        env: process.env,
        envFile: stringOpt(options, 'env-file'),
        rootDir: process.cwd(),
      }), null, 2));
      return;

    case 'autonomy-plan': {
      const plan = buildAutonomyPlan(requiredStringOpt(options, 'goal'), effectiveEnv);
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`);
        console.log(JSON.stringify({
          ok: true,
          path: outPath,
          selected_next_step: plan.selected_next_step?.id ?? null,
          step_count: plan.steps.length,
        }, null, 2));
        return;
      }
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    case 'next-action': {
      const report = buildNextActionReport(stringOpt(options, 'goal') ?? 'Make WorthScan autonomous for Codex', effectiveEnv);
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify({
          ok: true,
          path: outPath,
          orientation_action_id: report.summary.orientation_action_id,
          progress_action_id: report.summary.progress_action_id,
          capability_unlock_action_id: report.summary.capability_unlock_action_id,
        }, null, 2));
        return;
      }
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    case 'provider-preflight': {
      const requestPath = stringOpt(options, 'request');
      const report = requestPath
        ? (() => {
          const preflight = buildProviderPreflight(requestPath, effectiveEnv, process.cwd());
          return {
            created_at: new Date().toISOString(),
            root_dir: process.cwd(),
            request_count: 1,
            prepared_request_count: preflight.ready_for_provider_handoff ? 1 : 0,
            preflights: [preflight],
          } satisfies HarnessProviderPreflightReport;
        })()
        : preflightProviderRequests(effectiveEnv);
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify({ ok: true, path: outPath, request_count: report.request_count }, null, 2));
        return;
      }
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    case 'prepare-provider-inputs':
      console.log(JSON.stringify(await prepareProviderInputs(requiredStringOpt(options, 'request'), {
        outDir: stringOpt(options, 'out'),
        env: effectiveEnv,
      }), null, 2));
      return;

    case 'provider-handoff':
      console.log(JSON.stringify(exportProviderHandoffPacket(requiredStringOpt(options, 'request'), {
        outDir: stringOpt(options, 'out'),
        maxTextChars: numberOpt(options, 'max-text-chars'),
        env: effectiveEnv,
      }), null, 2));
      return;

    case 'reproducibility-manifest': {
      const manifest = buildReproducibilityManifest();
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(JSON.stringify({ ok: true, path: outPath, source_file_count: manifest.source_of_truth.file_count }, null, 2));
        return;
      }
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }

    case 'verification-map':
      console.log(JSON.stringify(buildVerificationMap(), null, 2));
      return;

    case 'stage-source':
      console.log(JSON.stringify(stageSourceOfTruth({ apply: flagEnabled(options, 'apply') }), null, 2));
      return;

    case 'source-package': {
      const report = exportSourcePackage({ outDir: stringOpt(options, 'out') });
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    case 'verify-source-package':
      console.log(JSON.stringify(verifySourcePackage(requiredStringOpt(options, 'package')), null, 2));
      return;

    case 'autonomy-audit': {
      const audit = buildAutonomyAudit(stringOpt(options, 'goal') ?? 'Make WorthScan autonomous for Codex', effectiveEnv);
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`);
        console.log(JSON.stringify({ ok: true, path: outPath, summary_status: audit.summary_status }, null, 2));
        return;
      }
      console.log(JSON.stringify(audit, null, 2));
      return;
    }

    case 'goal-completion-audit': {
      const audit = buildGoalCompletionAudit(stringOpt(options, 'goal') ?? 'Make WorthScan autonomous for Codex', effectiveEnv);
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`);
        console.log(JSON.stringify({
          ok: true,
          path: outPath,
          summary_status: audit.summary_status,
          can_mark_goal_complete: audit.can_mark_goal_complete,
        }, null, 2));
        return;
      }
      console.log(JSON.stringify(audit, null, 2));
      return;
    }

    case 'decision-surface': {
      const surface = buildDecisionSurface(stringOpt(options, 'goal') ?? 'Make WorthScan autonomous for Codex', effectiveEnv);
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(surface, null, 2)}\n`);
        console.log(JSON.stringify({
          ok: true,
          path: outPath,
          selected_safe_action_id: surface.summary.selected_safe_action_id,
          safe_now_count: surface.summary.safe_now_count,
          capability_gated_count: surface.summary.capability_gated_count,
          human_boundary_count: surface.summary.human_boundary_count,
        }, null, 2));
        return;
      }
      console.log(JSON.stringify(surface, null, 2));
      return;
    }

    case 'inspect':
      console.log(JSON.stringify(inspectHarness(effectiveEnv), null, 2));
      return;

    case 'primitives':
      console.log(JSON.stringify(listCodexPrimitives(), null, 2));
      return;

    case 'information-index':
      console.log(JSON.stringify(buildInformationIndex(), null, 2));
      return;

    case 'blockers':
      console.log(JSON.stringify(buildBlockerLedger(effectiveEnv), null, 2));
      return;

    case 'rank-jobs':
      console.log(JSON.stringify(rankIncomingJobs(effectiveEnv), null, 2));
      return;

    case 'job-matrix':
      console.log(JSON.stringify(buildJobReadinessMatrix(effectiveEnv), null, 2));
      return;

    case 'evidence-map':
      console.log(JSON.stringify(buildEvidenceMap(), null, 2));
      return;

    case 'launch-map':
      console.log(JSON.stringify(buildLaunchMap(effectiveEnv), null, 2));
      return;

    case 'inventory':
      console.log(JSON.stringify(buildArtifactInventory(requiredStringOpt(options, 'run')), null, 2));
      return;

    case 'resume':
      console.log(JSON.stringify(resumeHarnessRun(requiredStringOpt(options, 'run')), null, 2));
      return;

    case 'run-brief': {
      const brief = buildRunBrief({
        runDir: stringOpt(options, 'run'),
        rootDir: process.cwd(),
        maxTextChars: numberOpt(options, 'max-chars'),
      });
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(brief, null, 2)}\n`);
        console.log(JSON.stringify({
          ok: true,
          path: outPath,
          run_id: brief.run_id,
          status: brief.status,
          artifact_count: brief.artifacts.length,
        }, null, 2));
        return;
      }
      console.log(JSON.stringify(brief, null, 2));
      return;
    }

    case 'run-history':
      console.log(JSON.stringify(buildHarnessRunHistory({ limit: numberOpt(options, 'limit') }), null, 2));
      return;

    case 'latest-run':
      console.log(JSON.stringify(findLatestHarnessRun(), null, 2));
      return;

    case 'context-pack': {
      const pack = buildContextPack(process.cwd(), {
        maxFiles: numberOpt(options, 'max-files'),
        maxCharsPerFile: numberOpt(options, 'max-chars-per-file'),
      });
      const outPath = stringOpt(options, 'out');
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`);
        console.log(JSON.stringify({ ok: true, path: outPath, source_count: pack.source_count }, null, 2));
        return;
      }
      console.log(JSON.stringify(pack, null, 2));
      return;
    }

    case 'run': {
      const record = await runCodexHarness({
        goal: requiredStringOpt(options, 'goal'),
        jobPath: stringOpt(options, 'job'),
        outDir: stringOpt(options, 'out'),
        runId: stringOpt(options, 'run-id'),
        maxContextFiles: numberOpt(options, 'max-context-files'),
        maxContextCharsPerFile: numberOpt(options, 'max-context-chars-per-file'),
        env: effectiveEnv,
      });
      console.log(JSON.stringify(record, null, 2));
      return;
    }

    case 'help':
    default:
      printHelp();
      process.exit(command === 'help' ? 0 : 1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
