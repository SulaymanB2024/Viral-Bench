import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteFile, hashFile } from './artifact-integrity';

type JsonRecord = Record<string, unknown>;

export interface SpendScenario {
  daily_budget_usd: number;
  cumulative_usd: number;
}

export interface ProductionEnvelope {
  kind: string;
  low_usd: number;
  high_usd: number;
  basis: string;
}

export interface PerceivedValueInputs {
  body: string;
  title: string;
  cta: string;
  linkUrl: string;
  format: string;
  analysisCta: string;
  analysisStyles: string[];
  visibleProofCount: number;
  claimCount: number;
  creativeBeatCount: number;
  websiteProofCount: number;
  websiteCtaCount: number;
}

export interface PerceivedValueScore {
  total: number;
  label: string;
  components: {
    offer_clarity: number;
    proof_density: number;
    value_exchange: number;
    cta_continuity: number;
    creative_craft: number;
  };
  basis: string;
}

const DAY_MS = 86_400_000;
const DEFAULT_DAILY_SCENARIOS = {
  lean: 25,
  working: 100,
  scaled: 500,
} as const;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function roundMoney(value: number): number {
  if (value >= 10_000) return Math.round(value / 100) * 100;
  if (value >= 1_000) return Math.round(value / 10) * 10;
  return Math.round(value);
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'High perceived value';
  if (score >= 65) return 'Strong perceived value';
  if (score >= 50) return 'Moderate perceived value';
  return 'Thin value case';
}

function realCopy(value: string): boolean {
  return Boolean(value && !/\{\{.+\}\}/.test(value));
}

export function observedActiveDays(start: string | number, capturedAt: string): number {
  const startMs = typeof start === 'number' ? start * 1_000 : Date.parse(start);
  const captureMs = Date.parse(capturedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(captureMs)) return 1;
  return Math.max(1, Math.ceil((captureMs - startMs) / DAY_MS));
}

export function buildSpendScenarios(activeDays: number): Record<keyof typeof DEFAULT_DAILY_SCENARIOS, SpendScenario> {
  return Object.fromEntries(
    Object.entries(DEFAULT_DAILY_SCENARIOS).map(([key, dailyBudget]) => [
      key,
      {
        daily_budget_usd: dailyBudget,
        cumulative_usd: roundMoney(activeDays * dailyBudget),
      },
    ]),
  ) as Record<keyof typeof DEFAULT_DAILY_SCENARIOS, SpendScenario>;
}

export function estimateProductionEnvelope(
  format: string,
  styles: string[] = [],
): ProductionEnvelope {
  const normalizedFormat = format.toLowerCase();
  const style = styles.join(' ').toLowerCase();
  if (normalizedFormat === 'image') {
    return {
      kind: 'Static social creative',
      low_usd: 50,
      high_usd: 500,
      basis: 'Template or light art direction.',
    };
  }
  if (normalizedFormat === 'dco') {
    return {
      kind: 'Dynamic catalog asset set',
      low_usd: 500,
      high_usd: 5_000,
      basis: 'Reusable asset set; not each render.',
    };
  }
  if (/montage|testimonial|lifestyle/.test(style)) {
    return {
      kind: 'Produced brand montage',
      low_usd: 3_000,
      high_usd: 12_000,
      basis: 'Multi-location or testimonial production.',
    };
  }
  if (/direct-to-camera|screen recording|text-based/.test(style)) {
    return {
      kind: 'Lean creator or product demo',
      low_usd: 300,
      high_usd: 1_500,
      basis: 'Creator, screen, or text-led.',
    };
  }
  return {
    kind: 'Edited short-form video',
    low_usd: 1_000,
    high_usd: 4_000,
    basis: 'Script, edit, and variants.',
  };
}

export function perceivedValueScore(input: PerceivedValueInputs): PerceivedValueScore {
  const offerText = `${input.body} ${input.title}`.toLowerCase();
  const outcomeHits = [
    'internship',
    'job search',
    'hire',
    'candidate',
    'experience',
    'remote',
    'apply',
    'resume',
    'profile',
    'interview',
  ].filter((term) => offerText.includes(term)).length;

  const offerClarity = clamp(
    (realCopy(input.body) && input.body.length >= 24 ? 6 : 1)
      + (realCopy(input.title) ? 4 : 0)
      + Math.min(6, outcomeHits * 2)
      + (/\$|\d/.test(offerText) ? 4 : 0),
    0,
    20,
  );

  const proofMarkers = [
    /\d/,
    /award|voted|trusted|guarantee|paid|fortune|harvard|qualified|support/,
  ].filter((pattern) => pattern.test(offerText)).length;
  const proofDensity = clamp(
    Math.min(10, input.visibleProofCount * 2)
      + Math.min(4, input.claimCount)
      + proofMarkers * 2
      + Math.min(4, input.websiteProofCount),
    0,
    20,
  );

  const valueExchange = clamp(
    (/guarantee/.test(offerText) ? 8 : 0)
      + (/free/.test(offerText) ? 7 : 0)
      + (/\$\s?\d|under \$|paid/.test(offerText) ? 6 : 0)
      + (/limited|instant|faster|more interview|save time/.test(offerText) ? 3 : 0),
    0,
    20,
  );

  const explicitAnalysisCta = Boolean(
    input.analysisCta
      && !/no explicit|none visible|none$/i.test(input.analysisCta),
  );
  const ctaContinuity = clamp(
    (realCopy(input.cta) ? 5 : 0)
      + (Boolean(input.linkUrl) ? 5 : 0)
      + (explicitAnalysisCta ? 5 : 0)
      + Math.min(5, input.websiteCtaCount * 2),
    0,
    20,
  );

  const normalizedFormat = input.format.toLowerCase();
  const formatBase = normalizedFormat === 'video' ? 8 : normalizedFormat === 'dco' ? 8 : 6;
  const creativeCraft = clamp(
    formatBase
      + Math.min(6, input.analysisStyles.length * 2)
      + Math.min(4, input.creativeBeatCount)
      + (input.visibleProofCount > 0 ? 2 : 0),
    0,
    20,
  );

  const components = {
    offer_clarity: offerClarity,
    proof_density: proofDensity,
    value_exchange: valueExchange,
    cta_continuity: ctaContinuity,
    creative_craft: creativeCraft,
  };
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  return {
    total,
    label: scoreLabel(total),
    components,
    basis: 'Heuristic; not performance.',
  };
}

function readJson(filePath: string): JsonRecord {
  return record(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function extractActiveMetaAds(discovery: JsonRecord): JsonRecord[] {
  const deduplicated = new Map<string, JsonRecord>();
  for (const rawRun of array(discovery.runs)) {
    const run = record(rawRun);
    if (!text(run.actor_id).includes('facebook-ads-scraper')) continue;
    for (const rawItem of array(run.items)) {
      const item = record(rawItem);
      if (item.isActive !== true || item.error || item.errorDescription) continue;
      const id = text(item.adArchiveID) || text(item.adArchiveId) || text(item.adId);
      if (id) deduplicated.set(id, item);
    }
  }
  return [...deduplicated.values()];
}

function formatForAd(snapshot: JsonRecord): 'video' | 'image' | 'dco' {
  if (array(snapshot.videos).length > 0) return 'video';
  if (array(snapshot.cards).length > 0) return 'dco';
  return 'image';
}

function websiteCompanyMap(registry: JsonRecord): Map<string, JsonRecord> {
  return new Map(
    array(registry.companies).map((value) => {
      const company = record(value);
      return [text(company.company).toLowerCase(), company];
    }),
  );
}

function analysisMap(report: JsonRecord): Map<string, JsonRecord> {
  return new Map(
    array(report.items).map((value) => {
      const item = record(value);
      return [text(item.ad_archive_id), item];
    }),
  );
}

function publicMetaUrl(adId: string): string {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adId)}`;
}

function ensureVideoAsset(siteRoot: string, adId: string, analysisItem: JsonRecord): string | null {
  const media = record(analysisItem.media);
  const sourcePath = text(media.local_path);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  const mediaDir = path.join(siteRoot, 'media', 'ads');
  const targetPath = path.join(mediaDir, `${adId}.mp4`);
  fs.mkdirSync(mediaDir, { recursive: true });
  const sourceHash = hashFile(sourcePath);
  if (!fs.existsSync(targetPath) || hashFile(targetPath) !== sourceHash) {
    atomicWriteFile(targetPath, fs.readFileSync(sourcePath));
  }
  return `/media/ads/${adId}.mp4`;
}

function startDate(item: JsonRecord): string {
  const formatted = text(item.startDateFormatted);
  if (formatted) return formatted;
  const timestamp = numberValue(item.startDate);
  return timestamp ? new Date(timestamp * 1_000).toISOString() : '';
}

function imageUrl(snapshot: JsonRecord): string | null {
  const firstImage = record(array(snapshot.images)[0]);
  return text(firstImage.originalImageUrl) || text(firstImage.resizedImageUrl) || null;
}

function cleanAnalysis(analysisItem: JsonRecord): JsonRecord | null {
  if (!Object.keys(analysisItem).length) return null;
  const analysis = record(analysisItem.analysis);
  const hook = record(analysis.hook);
  const cta = record(analysis.cta);
  const pacing = record(analysis.pacing);
  return {
    provider: 'TwelveLabs',
    model: text(analysis.model_name) || 'pegasus1.5',
    hook: {
      text: text(hook.text),
      start_sec: numberValue(hook.start_sec),
      end_sec: numberValue(hook.end_sec),
    },
    cta: {
      text: text(cta.text),
      start_sec: numberValue(cta.start_sec),
      end_sec: numberValue(cta.end_sec),
    },
    duration_sec: numberValue(analysis.duration_sec),
    styles: array(analysis.style).map(text).filter(Boolean),
    pacing: {
      pattern: text(pacing.pattern),
      cuts_per_minute: numberValue(pacing.cuts_per_minute),
    },
    visible_proof: array(analysis.visible_proof).map((value) => {
      const proof = record(value);
      return {
        description: text(proof.description),
        start_sec: numberValue(proof.start_sec),
        end_sec: numberValue(proof.end_sec),
      };
    }),
    creative_beats: array(analysis.creative_beats).map((value) => {
      const beat = record(value);
      return {
        label: text(beat.label) || text(beat.description) || text(beat.text),
        start_sec: numberValue(beat.start_sec),
        end_sec: numberValue(beat.end_sec),
      };
    }),
    claims: array(analysis.claims).map((value) => {
      const claim = record(value);
      return {
        text: text(claim.text),
        support: text(claim.support),
        start_sec: numberValue(claim.start_sec),
        end_sec: numberValue(claim.end_sec),
      };
    }),
    evidence_limitations: array(analysis.evidence_limitations).map(text).filter(Boolean),
    estimated_analysis_cost_usd: numberValue(analysisItem.estimated_cost_usd),
  };
}

function buildDataset(
  discovery: JsonRecord,
  report: JsonRecord,
  registry: JsonRecord,
  siteRoot: string,
): JsonRecord {
  const captureDate = text(discovery.created_at) || new Date().toISOString();
  const activeAds = extractActiveMetaAds(discovery);
  const websiteByCompany = websiteCompanyMap(registry);
  const semanticById = analysisMap(report);

  const companyGroups = new Map<string, JsonRecord[]>();
  for (const item of activeAds) {
    const companyName = text(item.pageName) || text(record(item.snapshot).pageName) || 'Unknown advertiser';
    const group = companyGroups.get(companyName) ?? [];
    group.push(item);
    companyGroups.set(companyName, group);
  }

  const advertiserScenarios = new Map<string, {
    activeDays: number;
    count: number;
    scenarios: Record<keyof typeof DEFAULT_DAILY_SCENARIOS, SpendScenario>;
  }>();
  for (const [company, items] of companyGroups) {
    const starts = items.map(startDate).filter(Boolean).sort();
    const activeDays = observedActiveDays(starts[0] ?? captureDate, captureDate);
    advertiserScenarios.set(company, {
      activeDays,
      count: items.length,
      scenarios: buildSpendScenarios(activeDays),
    });
  }

  const ads = activeAds.map((item) => {
    const snapshot = record(item.snapshot);
    const body = text(record(snapshot.body).text) || text(snapshot.body);
    const title = text(snapshot.title);
    const company = text(item.pageName) || text(snapshot.pageName) || 'Unknown advertiser';
    const adId = text(item.adArchiveID) || text(item.adArchiveId) || text(item.adId);
    const format = formatForAd(snapshot);
    const analysisItem = record(semanticById.get(adId));
    const analysis = cleanAnalysis(analysisItem);
    const analysisRecord = record(analysis);
    const website = record(websiteByCompany.get(company.toLowerCase()));
    const websitePages = array(website.website_pages).map(record);
    const primaryCtas = websitePages.flatMap((page) => array(page.primary_ctas).map(text).filter(Boolean));
    const websiteProof = array(website.website_offer_and_proof).map(text).filter(Boolean);
    const styles = array(analysisRecord.styles).map(text).filter(Boolean);
    const production = estimateProductionEnvelope(format, styles);
    const value = perceivedValueScore({
      body,
      title,
      cta: text(snapshot.ctaText),
      linkUrl: text(snapshot.linkUrl),
      format,
      analysisCta: text(record(analysisRecord.cta).text),
      analysisStyles: styles,
      visibleProofCount: array(analysisRecord.visible_proof).length,
      claimCount: array(analysisRecord.claims).length,
      creativeBeatCount: array(analysisRecord.creative_beats).length,
      websiteProofCount: websiteProof.length,
      websiteCtaCount: primaryCtas.length,
    });
    const advertiserScenario = advertiserScenarios.get(company)!;
    const perAdShare = Object.fromEntries(
      Object.entries(advertiserScenario.scenarios).map(([key, scenario]) => [
        key,
        roundMoney(scenario.cumulative_usd / advertiserScenario.count),
      ]),
    );

    return {
      ad_id: adId,
      company,
      format,
      status: 'active',
      start_date: startDate(item),
      publisher_platforms: array(item.publisherPlatform).map(text).filter(Boolean),
      body,
      title,
      caption: text(snapshot.caption),
      cta: text(snapshot.ctaText),
      destination_url: text(snapshot.linkUrl),
      meta_library_url: publicMetaUrl(adId),
      media: {
        video_url: analysis ? ensureVideoAsset(siteRoot, adId, analysisItem) : null,
        image_url: imageUrl(snapshot),
        card_count: array(snapshot.cards).length,
      },
      analysis,
      analysis_status: analysis ? 'twelvelabs_complete' : 'metadata_only',
      production_cost: production,
      media_spend_equal_share_scenario_usd: perAdShare,
      perceived_value: value,
      website_context: {
        title: text(record(websitePages[0]).title),
        meta_description: text(record(websitePages[0]).meta_description),
        primary_ctas: primaryCtas,
        offer_and_proof: websiteProof,
        tracking_signals: array(website.tracking_signals).map(text).filter(Boolean),
        message_match: text(website.message_match),
      },
      public_delivery_fields: {
        spend: item.spend ?? null,
        reach_estimate: item.reachEstimate ?? null,
        total_active_time: item.totalActiveTime ?? null,
        targeted_or_reached_countries: array(item.targetedOrReachedCountries),
      },
    };
  }).sort((a, b) => {
    const scoreDelta = record(b.perceived_value).total as number - (record(a.perceived_value).total as number);
    return scoreDelta || text(a.company).localeCompare(text(b.company));
  });

  const advertisers = [...companyGroups.entries()].map(([company, items]) => {
    const companyAds = ads.filter((ad) => ad.company === company);
    const scenario = advertiserScenarios.get(company)!;
    const formats = {
      video: companyAds.filter((ad) => ad.format === 'video').length,
      image: companyAds.filter((ad) => ad.format === 'image').length,
      dco: companyAds.filter((ad) => ad.format === 'dco').length,
    };
    const productionAssets = new Map<string, ProductionEnvelope>();
    for (const ad of companyAds) {
      const media = record(ad.media);
      const analysis = record(ad.analysis);
      const analysisMediaKey = text(record(semanticById.get(text(ad.ad_id))).media && record(record(semanticById.get(text(ad.ad_id))).media).sha256);
      const key = analysisMediaKey
        || text(media.image_url)
        || `${text(ad.format)}:${text(ad.ad_id)}`;
      productionAssets.set(key, ad.production_cost as ProductionEnvelope);
      void analysis;
    }
    const portfolioLow = [...productionAssets.values()].reduce((sum, value) => sum + value.low_usd, 0);
    const portfolioHigh = [...productionAssets.values()].reduce((sum, value) => sum + value.high_usd, 0);
    const website = record(websiteByCompany.get(company.toLowerCase()));
    const scores = companyAds.map((ad) => numberValue(record(ad.perceived_value).total) ?? 0);
    return {
      company,
      active_ads: items.length,
      formats,
      oldest_active_start: items.map(startDate).filter(Boolean).sort()[0] ?? null,
      observed_active_days: scenario.activeDays,
      media_spend_scenarios: scenario.scenarios,
      production_portfolio_envelope_usd: {
        low: roundMoney(portfolioLow),
        high: roundMoney(portfolioHigh),
        unique_observed_assets: productionAssets.size,
      },
      average_perceived_value: Math.round(scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length)),
      strategy: array(website.meta_strategy).map(text).filter(Boolean),
      website_message_match: text(website.message_match),
    };
  }).sort((a, b) => b.active_ads - a.active_ads || a.company.localeCompare(b.company));

  const analyzedCount = ads.filter((ad) => ad.analysis_status === 'twelvelabs_complete').length;
  const formatCounts = {
    video: ads.filter((ad) => ad.format === 'video').length,
    image: ads.filter((ad) => ad.format === 'image').length,
    dco: ads.filter((ad) => ad.format === 'dco').length,
  };

  return {
    generated_at: new Date().toISOString(),
    captured_at: captureDate,
    summary: {
      active_ads: ads.length,
      advertisers: advertisers.length,
      formats: formatCounts,
      twelvelabs_analyzed_videos: analyzedCount,
      twelvelabs_errors: array(report.errors).length,
      semantic_report_cost_usd: numberValue(report.estimated_cost_usd),
      actual_media_spend_observed: 0,
    },
    evidence_boundary: {
      actual_spend_available: false,
      statement: 'The ordinary public Meta Ad Library fields in this collection expose no spend, reach, targeting, delivery, conversion, or ROAS values.',
      spend_method: 'Scenario planning only: each advertiser cohort is modeled at $25, $100, and $500 per day from its oldest observed active start. Per-ad figures assume equal allocation across active creatives.',
      production_method: 'Internal planning envelopes based on observed format and TwelveLabs-detected production style. These are not vendor quotes or invoices.',
      value_method: 'A 0–100 research heuristic across offer clarity, observable proof, value exchange, CTA continuity, and creative craft. It does not measure performance.',
      static_analysis: 'Static image and DCO records remain metadata-only because the current TwelveLabs pipeline is video-specific.',
    },
    assumptions: {
      daily_media_budget_scenarios_usd: DEFAULT_DAILY_SCENARIOS,
      production_envelopes_usd: {
        static_social_creative: [50, 500],
        dynamic_catalog_asset_set: [500, 5_000],
        lean_creator_or_product_demo: [300, 1_500],
        edited_short_form_video: [1_000, 4_000],
        produced_brand_montage: [3_000, 12_000],
      },
    },
    source: {
      discovery_research_id: text(discovery.research_id),
      semantic_report_id: text(report.report_id),
      semantic_models: report.models ?? null,
      website_registry_id: text(registry.research_id),
      website_collection: 'Apify Website Content Crawler',
    },
    advertisers,
    ads,
  };
}

export interface BuildPaidAdSiteOptions {
  discoveryPath: string;
  semanticReportPath: string;
  websiteRegistryPath: string;
  siteRoot: string;
  outputPath?: string;
}

export function buildPaidAdSiteData(options: BuildPaidAdSiteOptions): JsonRecord {
  const discovery = readJson(path.resolve(options.discoveryPath));
  const report = readJson(path.resolve(options.semanticReportPath));
  const registry = readJson(path.resolve(options.websiteRegistryPath));
  const siteRoot = path.resolve(options.siteRoot);
  const dataset = buildDataset(discovery, report, registry, siteRoot);
  const outputPath = path.resolve(options.outputPath ?? path.join(siteRoot, 'ads-data.js'));
  atomicWriteFile(outputPath, `window.__VIRALBENCH_ADS__ = ${JSON.stringify(dataset, null, 2)};\n`);
  return dataset;
}

function main(): void {
  const repoRoot = path.resolve(__dirname, '..');
  const siteRoot = path.join(repoRoot, 'internship-reels-site');
  const dataset = buildPaidAdSiteData({
    discoveryPath: path.join(
      repoRoot,
      '.semantic-artifacts/competitor-content/discovery/internship-paid-ads-reels-expansion-20260717.json',
    ),
    semanticReportPath: path.join(
      repoRoot,
      '.semantic-artifacts/competitor-content/reports/internship-paid-meta-all-video-ads-semantic-20260717.json',
    ),
    websiteRegistryPath: path.join(
      repoRoot,
      '.ops/competitor_research/internship-paid-ad-website-metadata-20260717.json',
    ),
    siteRoot,
  });
  process.stdout.write(`${JSON.stringify({
    output: path.relative(repoRoot, path.join(siteRoot, 'ads-data.js')),
    summary: dataset.summary,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
