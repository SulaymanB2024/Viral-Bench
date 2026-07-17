import { APIFY_API_BASE, canonicalActorId } from './apify-api';
import { MARENGO_MODEL, PEGASUS_MODEL, type SocialPlatform } from './semantic-intelligence';

export type ProviderOptimizationProfile = 'metadata_discovery' | 'full_fidelity_analysis';

export interface ProviderConfigurationAudit {
  profile: ProviderOptimizationProfile;
  configuration_ready: boolean;
  live_readiness: {
    semantic_url_ingestion: boolean;
    seo_discovery: boolean;
    twelvelabs_analysis: boolean;
  };
  credentials: {
    apify_token_available: boolean;
    twelvelabs_api_key_available: boolean;
  };
  gates: {
    paid_calls_enabled: boolean;
    public_url_ingestion_enabled: boolean;
    public_seo_research_enabled: boolean;
  };
  apify: {
    api_base: typeof APIFY_API_BASE;
    usage_settlement_ms: number;
    actors: Record<SocialPlatform, {
      actor_id: string | null;
      allowlisted: boolean;
      build: string | null;
      build_pinned: boolean;
      input_field: string;
      input_format: string;
      extras_valid: boolean;
      enrichment: Record<string, boolean>;
    }>;
  };
  twelvelabs: {
    api_base: 'https://api.twelvelabs.io/v1.3';
    embeddings_model: typeof MARENGO_MODEL;
    analysis_model: typeof PEGASUS_MODEL;
    fused_multimodal_embeddings_enabled_in_client: true;
    separate_modality_embeddings_enabled_in_client: true;
    asset_reuse_enabled_in_client: true;
    batch_analysis_adapter_implemented: false;
  };
  blockers: string[];
  warnings: string[];
  recommendations: string[];
  external_calls_made: 0;
  credential_policy: 'presence_only_no_values';
}

export interface ProviderLiveVerification {
  audit: ProviderConfigurationAudit;
  verified: boolean;
  apify: {
    authenticated: boolean;
    actors: Record<SocialPlatform, {
      actor_id: string | null;
      pinned_build: string | null;
      pinned_build_found: boolean | null;
      pinned_build_status: string | null;
      pinned_build_started_at: string | null;
      latest_succeeded_build: string | null;
      latest_succeeded_started_at: string | null;
      builds_examined: number;
      total_builds_reported: number | null;
    }>;
  };
  twelvelabs: {
    authenticated: boolean;
    api_status: number | null;
  };
  blockers: string[];
  warnings: string[];
  external_calls_made: number;
  credential_policy: 'presence_only_no_values';
  paid_calls_made: 0;
}

const ACTORS: Record<SocialPlatform, {
  env: string;
  expected: string;
  buildEnv: string;
  inputFieldEnv: string;
  defaultInputField: string;
  inputFormatEnv: string;
  defaultInputFormat: 'string_array' | 'request_list';
  extrasEnv: string;
}> = {
  tiktok: {
    env: 'APIFY_ACTOR_TIKTOK',
    expected: 'clockworks/tiktok-scraper',
    buildEnv: 'APIFY_ACTOR_BUILD_TIKTOK',
    inputFieldEnv: 'APIFY_INPUT_FIELD_TIKTOK',
    defaultInputField: 'postURLs',
    inputFormatEnv: 'APIFY_INPUT_FORMAT_TIKTOK',
    defaultInputFormat: 'string_array',
    extrasEnv: 'APIFY_INPUT_EXTRAS_TIKTOK_JSON',
  },
  instagram: {
    env: 'APIFY_ACTOR_INSTAGRAM',
    expected: 'apify/instagram-scraper',
    buildEnv: 'APIFY_ACTOR_BUILD_INSTAGRAM',
    inputFieldEnv: 'APIFY_INPUT_FIELD_INSTAGRAM',
    defaultInputField: 'directUrls',
    inputFormatEnv: 'APIFY_INPUT_FORMAT_INSTAGRAM',
    defaultInputFormat: 'string_array',
    extrasEnv: 'APIFY_INPUT_EXTRAS_INSTAGRAM_JSON',
  },
  youtube_shorts: {
    env: 'APIFY_ACTOR_YOUTUBE',
    expected: 'streamers/youtube-scraper',
    buildEnv: 'APIFY_ACTOR_BUILD_YOUTUBE',
    inputFieldEnv: 'APIFY_INPUT_FIELD_YOUTUBE',
    defaultInputField: 'startUrls',
    inputFormatEnv: 'APIFY_INPUT_FORMAT_YOUTUBE',
    defaultInputFormat: 'request_list',
    extrasEnv: 'APIFY_INPUT_EXTRAS_YOUTUBE_JSON',
  },
};

export function auditProviderConfiguration(
  env: Record<string, string | undefined> = process.env,
  profile: ProviderOptimizationProfile = 'full_fidelity_analysis',
): ProviderConfigurationAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const actorAudit = {} as ProviderConfigurationAudit['apify']['actors'];

  for (const platform of Object.keys(ACTORS) as SocialPlatform[]) {
    const config = ACTORS[platform];
    const actorId = text(env[config.env]);
    const build = text(env[config.buildEnv]);
    const inputField = text(env[config.inputFieldEnv]) ?? config.defaultInputField;
    const inputFormat = text(env[config.inputFormatEnv]) ?? config.defaultInputFormat;
    const extras = jsonObject(env[config.extrasEnv]);
    const enrichment = enrichmentFlags(platform, extras.value);

    if (!actorId) blockers.push(config.env);
    else if (actorId !== config.expected) blockers.push(`${config.env}:reviewed_actor_required`);
    if (!build) blockers.push(config.buildEnv);
    if (inputField !== config.defaultInputField) blockers.push(`${config.inputFieldEnv}:${config.defaultInputField}`);
    if (inputFormat !== config.defaultInputFormat) blockers.push(`${config.inputFormatEnv}:${config.defaultInputFormat}`);
    if (extras.error) blockers.push(`${config.extrasEnv}:invalid_json_object`);

    if (profile === 'full_fidelity_analysis' && !extras.error) {
      if (platform === 'tiktok') {
        if (!enrichment.raw_media) recommendations.push('Enable TikTok video download for durable full-fidelity media recovery.');
        if (!enrichment.subtitles) recommendations.push('Enable TikTok subtitle collection without paid transcription fallback.');
        if (!enrichment.slideshow_media) recommendations.push('Enable TikTok slideshow image collection for non-video posts.');
      } else if (platform === 'instagram') {
        if (!enrichment.post_details) recommendations.push('Set Instagram direct-URL runs to resultsType=posts with resultsLimit>=1.');
      } else if (!enrichment.subtitles) {
        recommendations.push('Enable YouTube subtitle collection for transcript-grounded enrichment.');
      }
    }

    actorAudit[platform] = {
      actor_id: actorId,
      allowlisted: actorId === config.expected,
      build,
      build_pinned: Boolean(build),
      input_field: inputField,
      input_format: inputFormat,
      extras_valid: !extras.error,
      enrichment,
    };
  }

  const usageSettlementMs = nonNegativeNumber(env.APIFY_USAGE_SETTLEMENT_MS, 10_000);
  if (usageSettlementMs < 10_000) {
    warnings.push('APIFY_USAGE_SETTLEMENT_MS is below the documented ten-second usage reconciliation window.');
  }
  recommendations.push('Run a one-item canary after changing any Actor build, then pin the observed build before a larger collection.');
  recommendations.push('Use request cost caps and inspect dataset truncation telemetry before interpreting a collection as complete.');
  recommendations.push('Adopt TwelveLabs batch analysis for repeated cohort-wide schemas after a focused canary validates result parity.');

  const credentials = {
    apify_token_available: Boolean(text(env.APIFY_TOKEN)),
    twelvelabs_api_key_available: Boolean(text(env.TWELVELABS_API_KEY)),
  };
  const gates = {
    paid_calls_enabled: enabled(env.ALLOW_PAID_GENERATION),
    public_url_ingestion_enabled: enabled(env.ALLOW_PUBLIC_URL_INGESTION),
    public_seo_research_enabled: enabled(env.ALLOW_PUBLIC_SEO_RESEARCH),
  };
  const configurationReady = blockers.length === 0;
  return {
    profile,
    configuration_ready: configurationReady,
    live_readiness: {
      semantic_url_ingestion: configurationReady
        && credentials.apify_token_available
        && credentials.twelvelabs_api_key_available
        && gates.paid_calls_enabled
        && gates.public_url_ingestion_enabled,
      seo_discovery: configurationReady
        && credentials.apify_token_available
        && gates.paid_calls_enabled
        && gates.public_seo_research_enabled,
      twelvelabs_analysis: credentials.twelvelabs_api_key_available && gates.paid_calls_enabled,
    },
    credentials,
    gates,
    apify: {
      api_base: APIFY_API_BASE,
      usage_settlement_ms: usageSettlementMs,
      actors: actorAudit,
    },
    twelvelabs: {
      api_base: 'https://api.twelvelabs.io/v1.3',
      embeddings_model: MARENGO_MODEL,
      analysis_model: PEGASUS_MODEL,
      fused_multimodal_embeddings_enabled_in_client: true,
      separate_modality_embeddings_enabled_in_client: true,
      asset_reuse_enabled_in_client: true,
      batch_analysis_adapter_implemented: false,
    },
    blockers,
    warnings: unique(warnings),
    recommendations: unique(recommendations),
    external_calls_made: 0,
    credential_policy: 'presence_only_no_values',
  };
}

export async function verifyProviderConfiguration(
  env: Record<string, string | undefined> = process.env,
  profile: ProviderOptimizationProfile = 'full_fidelity_analysis',
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderLiveVerification> {
  const audit = auditProviderConfiguration(env, profile);
  const blockers = [...audit.blockers];
  const warnings = [...audit.warnings];
  const actorVerification = {} as ProviderLiveVerification['apify']['actors'];
  const apifyToken = text(env.APIFY_TOKEN);
  let externalCalls = 0;
  let apifyAuthenticated = Boolean(apifyToken);

  for (const platform of Object.keys(ACTORS) as SocialPlatform[]) {
    const actor = audit.apify.actors[platform];
    const empty = {
      actor_id: actor.actor_id,
      pinned_build: actor.build,
      pinned_build_found: null,
      pinned_build_status: null,
      pinned_build_started_at: null,
      latest_succeeded_build: null,
      latest_succeeded_started_at: null,
      builds_examined: 0,
      total_builds_reported: null,
    };
    if (!apifyToken || !actor.actor_id || !actor.build) {
      actorVerification[platform] = empty;
      if (!apifyToken) blockers.push('APIFY_TOKEN:live_verification');
      continue;
    }
    try {
      externalCalls += 1;
      const response = await fetchImpl(
        `${APIFY_API_BASE}/actors/${encodeURIComponent(canonicalActorId(actor.actor_id))}/builds?desc=1&limit=1000`,
        { headers: { Authorization: `Bearer ${apifyToken}`, Accept: 'application/json' } },
      );
      if (!response.ok) {
        apifyAuthenticated = response.status !== 401 && response.status !== 403;
        blockers.push(`apify_build_verification:${platform}:http_${response.status}`);
        actorVerification[platform] = empty;
        continue;
      }
      const body = await response.json() as unknown;
      const data = objectAt(body, 'data');
      const builds = Array.isArray(data?.items)
        ? data.items.filter((value): value is Record<string, unknown> => isRecord(value))
        : [];
      const total = finiteInteger(data?.total);
      const pinned = builds.find((build) => stringAt(build, 'buildNumber') === actor.build);
      const latestSucceeded = builds.find((build) => stringAt(build, 'status') === 'SUCCEEDED');
      const pinFound = Boolean(pinned);
      actorVerification[platform] = {
        actor_id: actor.actor_id,
        pinned_build: actor.build,
        pinned_build_found: pinFound || (total !== null && total <= builds.length) ? pinFound : null,
        pinned_build_status: pinned ? stringAt(pinned, 'status') : null,
        pinned_build_started_at: pinned ? stringAt(pinned, 'startedAt') : null,
        latest_succeeded_build: latestSucceeded ? stringAt(latestSucceeded, 'buildNumber') : null,
        latest_succeeded_started_at: latestSucceeded ? stringAt(latestSucceeded, 'startedAt') : null,
        builds_examined: builds.length,
        total_builds_reported: total,
      };
      if (!pinned && total !== null && total <= builds.length) {
        blockers.push(`apify_build_verification:${platform}:pinned_build_not_found`);
      } else if (!pinned) {
        warnings.push(`Apify ${platform} pin was not present in the newest ${builds.length} builds; verify it before a paid run.`);
      } else if (stringAt(pinned, 'status') !== 'SUCCEEDED') {
        blockers.push(`apify_build_verification:${platform}:pinned_build_not_succeeded`);
      }
      const latestBuild = latestSucceeded ? stringAt(latestSucceeded, 'buildNumber') : null;
      if (latestBuild && latestBuild !== actor.build) {
        warnings.push(`Apify ${platform} has a newer successful build (${latestBuild}); keep ${actor.build} pinned until a one-item canary passes.`);
      }
    } catch {
      blockers.push(`apify_build_verification:${platform}:network_error`);
      actorVerification[platform] = empty;
    }
  }

  const twelveLabsKey = text(env.TWELVELABS_API_KEY);
  let twelveLabsAuthenticated = false;
  let twelveLabsStatus: number | null = null;
  if (!twelveLabsKey) {
    blockers.push('TWELVELABS_API_KEY:live_verification');
  } else {
    try {
      externalCalls += 1;
      const response = await fetchImpl('https://api.twelvelabs.io/v1.3/assets?page=1&page_limit=1', {
        headers: { 'x-api-key': twelveLabsKey, Accept: 'application/json' },
      });
      twelveLabsStatus = response.status;
      twelveLabsAuthenticated = response.ok;
      if (!response.ok) blockers.push(`twelvelabs_auth_verification:http_${response.status}`);
    } catch {
      blockers.push('twelvelabs_auth_verification:network_error');
    }
  }

  const uniqueBlockers = unique(blockers);
  return {
    audit,
    verified: uniqueBlockers.length === 0 && apifyAuthenticated && twelveLabsAuthenticated,
    apify: {
      authenticated: apifyAuthenticated,
      actors: actorVerification,
    },
    twelvelabs: {
      authenticated: twelveLabsAuthenticated,
      api_status: twelveLabsStatus,
    },
    blockers: uniqueBlockers,
    warnings: unique(warnings),
    external_calls_made: externalCalls,
    credential_policy: 'presence_only_no_values',
    paid_calls_made: 0,
  };
}

function enrichmentFlags(platform: SocialPlatform, extras: Record<string, unknown>): Record<string, boolean> {
  if (platform === 'tiktok') {
    return {
      raw_media: extras.shouldDownloadVideos === true,
      cover_media: extras.shouldDownloadCovers === true,
      slideshow_media: extras.shouldDownloadSlideshowImages === true,
      subtitles: typeof extras.downloadSubtitlesOptions === 'string'
        && extras.downloadSubtitlesOptions !== 'NEVER_DOWNLOAD_SUBTITLES',
      request_driven_comments: true,
    };
  }
  if (platform === 'instagram') {
    return {
      post_details: extras.resultsType === 'posts'
        && typeof extras.resultsLimit === 'number'
        && extras.resultsLimit >= 1,
      latest_comments_sample: true,
      deep_comments: true,
      request_driven_top_and_recent_comments: true,
    };
  }
  return {
    subtitles: extras.downloadSubtitles === true,
    provider_ai_description: extras.aiVideoDescription === true,
    provider_ai_summary: extras.aiVideoSummary === true,
  };
}

function jsonObject(value: string | undefined): { value: Record<string, unknown>; error: boolean } {
  if (!text(value)) return { value: {}, error: false };
  try {
    const parsed = JSON.parse(value!);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: {}, error: true };
    return { value: parsed as Record<string, unknown>, error: false };
  } catch {
    return { value: {}, error: true };
  }
}

function nonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function text(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function objectAt(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value[key]) ? value[key] : null;
}

function stringAt(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
