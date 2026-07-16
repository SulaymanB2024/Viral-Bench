import {
  type CreativeJobManifest,
  type CreativeProviderName,
  assertProviderAllowed,
  validateCreativeJobManifest,
} from './job_schema';
import { renderLocalPostPackage, type LocalRenderResult } from './local_renderer';

export interface ProviderRouterOptions {
  env?: Record<string, string | undefined>;
  outDir?: string;
}

export type ProviderRouterResult =
  | {
      provider: 'local_renderer';
      status: 'rendered';
      render: LocalRenderResult;
    }
  | {
      provider: Exclude<CreativeProviderName, 'local_renderer'>;
      status: 'stubbed';
      message: string;
    };

export async function runCreativeProvider(
  provider: CreativeProviderName,
  input: CreativeJobManifest | unknown,
  options: ProviderRouterOptions = {},
): Promise<ProviderRouterResult> {
  const job = validateCreativeJobManifest(input);
  assertProviderAllowed(job, provider, options.env ?? process.env);

  switch (provider) {
    case 'local_renderer':
      return {
        provider,
        status: 'rendered',
        render: await renderLocalPostPackage(job, options.outDir),
      };

    case 'browser_manual':
      return {
        provider,
        status: 'stubbed',
        message: 'Browser workflow is manual-only. Record observations; do not scrape, bypass gates, or automate accounts.',
      };

    case 'gemini_image':
      return {
        provider,
        status: 'stubbed',
        message: 'Gemini image generation is an approved-provider stub. No live call is implemented in this scaffold.',
      };

    case 'gemini_video_understanding':
      return {
        provider,
        status: 'stubbed',
        message: 'Gemini video understanding is an approved-provider stub. Use only operator-approved media and keep outputs review-gated.',
      };

    case 'twelvelabs_analysis':
      return {
        provider,
        status: 'stubbed',
        message: 'TwelveLabs analysis is available only through the guarded provider workflow with operator-approved video evidence.',
      };

    case 'veo_video':
      return {
        provider,
        status: 'stubbed',
        message: 'Veo video generation is available only through the guarded provider workflow and always returns an unapproved draft.',
      };

    case 'openai_image':
      return {
        provider,
        status: 'stubbed',
        message: 'OpenAI image generation is an approved-provider stub. No live call is implemented in this scaffold.',
      };
  }
}
