import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteJson, sha256, stableJson } from './artifact-integrity';

export type DiscoveryScopeV1 = 'internship_early_career' | 'broader_job_search';
export type DiscoveryPlatformV1 = 'instagram' | 'tiktok' | 'youtube_shorts' | 'google_trends';
export type DiscoverySourceTypeV1 =
  | 'competitor_profile'
  | 'hashtag'
  | 'keyword'
  | 'popular_reels'
  | 'mention'
  | 'creator_adjacency'
  | 'audio'
  | 'youtube_query'
  | 'official_trend';
export type DiscoveryConfidenceV1 = 'high' | 'medium' | 'low';
export type DiscoveryVerificationStateV1 =
  | 'candidate_pending_registry_review'
  | 'access_limited';
export type DiscoveryCollectionReadinessV1 =
  | 'requires_registry_review'
  | 'access_limited'
  | 'not_authorized';

export interface DiscoverySeedV1 {
  schema_version: 'viralbench_discovery_seed_v1';
  seed_id: string;
  scope: DiscoveryScopeV1;
  platform: DiscoveryPlatformV1;
  source_type: DiscoverySourceTypeV1;
  locator: string;
  evidence_url: string;
  confidence: DiscoveryConfidenceV1;
  verification_state: DiscoveryVerificationStateV1;
  verified_at: string;
  provenance: {
    source_document: string;
    source_url: string;
    observed_at: string;
    note: string;
  };
  public_data: {
    classification: 'public_only';
    contains_private_data: false;
    contains_contact_data: false;
    declaration: string;
  };
  collection: {
    readiness: DiscoveryCollectionReadinessV1;
    reason: string;
  };
}

export interface DiscoverySeedCatalogV1 {
  schema_version: 'viralbench_discovery_seed_catalog_v1';
  generated_at: string;
  allocation: {
    target_total: number;
    internship_early_career: number;
    broader_job_search: number;
  };
  source_route_lineage: Array<{
    route: DiscoverySourceTypeV1;
    source_document: string;
    source_url: string;
    observed_at: string;
  }>;
  seeds: unknown[];
}

export interface DraftDiscoveryAcquisitionManifestV1 {
  schema_version: 'viralbench_discovery_acquisition_draft_v1';
  generated_at: string;
  status: 'draft_only';
  external_calls_authorized: false;
  source_registry_mutation_authorized: false;
  allocation: DiscoverySeedCatalogV1['allocation'] & {
    internship_share: number;
    broader_job_search_share: number;
  };
  seeds: DiscoverySeedV1[];
  registry_review_candidates: Array<{
    seed_id: string;
    platform: 'instagram' | 'tiktok' | 'youtube_shorts';
    handle: string;
    evidence_url: string;
    confidence: DiscoveryConfidenceV1;
    verification_state: DiscoveryVerificationStateV1;
    reason: string;
  }>;
  source_routes: Array<{
    scope: DiscoveryScopeV1;
    platform: DiscoveryPlatformV1;
    source_type: DiscoverySourceTypeV1;
    seeds: number;
    expected_unique_public_records_min: number;
    expected_unique_public_records_max: number;
    execution_state: 'draft_only_requires_separate_approval';
  }>;
  source_route_lineage: DiscoverySeedCatalogV1['source_route_lineage'];
  access_gaps: Array<{
    seed_id: string;
    platform: DiscoveryPlatformV1;
    source_type: DiscoverySourceTypeV1;
    reason: string;
    required_next_action: string;
  }>;
  evidence_boundaries: string[];
}

const SCOPES = new Set<DiscoveryScopeV1>(['internship_early_career', 'broader_job_search']);
const PLATFORMS = new Set<DiscoveryPlatformV1>([
  'instagram', 'tiktok', 'youtube_shorts', 'google_trends',
]);
const SOURCE_TYPES = new Set<DiscoverySourceTypeV1>([
  'competitor_profile', 'hashtag', 'keyword', 'popular_reels', 'mention',
  'creator_adjacency', 'audio', 'youtube_query', 'official_trend',
]);
const CONFIDENCES = new Set<DiscoveryConfidenceV1>(['high', 'medium', 'low']);
const VERIFICATION_STATES = new Set<DiscoveryVerificationStateV1>([
  'candidate_pending_registry_review', 'access_limited',
]);
const READINESS_STATES = new Set<DiscoveryCollectionReadinessV1>([
  'requires_registry_review', 'access_limited', 'not_authorized',
]);
const CONTACT_PATTERN = /(?:\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|(?:mailto|tel):|\+?\d[\d(). -]{7,}\d)/i;

/** Canonical form used for handle identity; it is intentionally platform-agnostic. */
export function canonicalizeDiscoveryHandle(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/^@+/, '');
  const result = normalized.replace(/[^a-z0-9._-]/g, '');
  if (!result) throw new Error('Discovery handle must contain at least one supported character');
  return result;
}

export function canonicalizeDiscoveryHashtag(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/^#+/, '');
  const result = normalized.replace(/[^a-z0-9_]/g, '');
  if (!result) throw new Error('Discovery hashtag must contain at least one supported character');
  return result;
}

export function canonicalizeDiscoveryUrl(value: string): string {
  const url = httpsUrl(value, 'Discovery URL');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|igshid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function canonicalizeDiscoveryQuery(value: string): string {
  const result = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!result) throw new Error('Discovery query must not be empty');
  assertNoPrivateOrContactData(result, 'Discovery query');
  return result;
}

export function discoverySeedId(input: Pick<DiscoverySeedV1, 'scope' | 'platform' | 'source_type' | 'locator'>): string {
  return `seed_v1_${sha256(stableJson({
    scope: input.scope,
    platform: input.platform,
    source_type: input.source_type,
    locator: canonicalLocator(input.source_type, input.locator),
  })).slice(0, 20)}`;
}

/**
 * Validates, strips tracking-only URL variance, and returns the canonical seed.
 * A seed is never promoted to a production source registry by this operation.
 */
export function validateDiscoverySeedV1(value: unknown): DiscoverySeedV1 {
  const row = object(value, 'Discovery seed');
  if (text(row.schema_version) !== 'viralbench_discovery_seed_v1') {
    throw new Error('Discovery seed must use schema_version viralbench_discovery_seed_v1');
  }
  const scope = enumValue(row.scope, SCOPES, 'Discovery seed scope');
  const platform = enumValue(row.platform, PLATFORMS, 'Discovery seed platform');
  const sourceType = enumValue(row.source_type, SOURCE_TYPES, 'Discovery seed source_type');
  const locator = canonicalLocator(sourceType, requiredText(row.locator, 'Discovery seed locator'));
  const evidenceUrl = canonicalizeDiscoveryUrl(requiredText(row.evidence_url, 'Discovery seed evidence_url'));
  const confidence = enumValue(row.confidence, CONFIDENCES, 'Discovery seed confidence');
  const verificationState = enumValue(
    row.verification_state,
    VERIFICATION_STATES,
    'Discovery seed verification_state',
  );
  const verifiedAt = isoTimestamp(row.verified_at, 'Discovery seed verified_at');
  const provenanceRow = object(row.provenance, 'Discovery seed provenance');
  const provenance = {
    source_document: requiredText(provenanceRow.source_document, 'Discovery seed provenance source_document'),
    source_url: canonicalizeDiscoveryUrl(requiredText(provenanceRow.source_url, 'Discovery seed provenance source_url')),
    observed_at: isoTimestamp(provenanceRow.observed_at, 'Discovery seed provenance observed_at'),
    note: requiredText(provenanceRow.note, 'Discovery seed provenance note'),
  };
  const publicData = object(row.public_data, 'Discovery seed public_data');
  if (text(publicData.classification) !== 'public_only'
    || publicData.contains_private_data !== false
    || publicData.contains_contact_data !== false) {
    throw new Error('Discovery seed must explicitly declare public-only data with no private or contact data');
  }
  const declaration = requiredText(publicData.declaration, 'Discovery seed public-data declaration');
  const collection = object(row.collection, 'Discovery seed collection');
  const readiness = enumValue(collection.readiness, READINESS_STATES, 'Discovery seed collection readiness');
  const reason = requiredText(collection.reason, 'Discovery seed collection reason');
  if (verificationState === 'access_limited' && readiness !== 'access_limited') {
    throw new Error('Access-limited discovery seeds must preserve an access_limited readiness state');
  }
  if (verificationState === 'candidate_pending_registry_review' && readiness === 'access_limited') {
    throw new Error('Registry-review discovery seeds cannot be marked access_limited');
  }
  for (const [label, field] of Object.entries({
    locator,
    evidenceUrl,
    source_document: provenance.source_document,
    source_url: provenance.source_url,
    note: provenance.note,
    declaration,
    reason,
  })) {
    assertNoPrivateOrContactData(field, `Discovery seed ${label}`);
  }
  const seed: DiscoverySeedV1 = {
    schema_version: 'viralbench_discovery_seed_v1',
    seed_id: discoverySeedId({ scope, platform, source_type: sourceType, locator }),
    scope,
    platform,
    source_type: sourceType,
    locator,
    evidence_url: evidenceUrl,
    confidence,
    verification_state: verificationState,
    verified_at: verifiedAt,
    provenance,
    public_data: {
      classification: 'public_only',
      contains_private_data: false,
      contains_contact_data: false,
      declaration,
    },
    collection: { readiness, reason },
  };
  const providedId = requiredText(row.seed_id, 'Discovery seed seed_id');
  if (providedId !== seed.seed_id) {
    throw new Error(`Discovery seed id does not match canonical identity: expected ${seed.seed_id}`);
  }
  return seed;
}

/** Returns one deterministic representative for exact canonical seed duplicates. */
export function canonicalizeAndDeduplicateDiscoverySeeds(values: unknown[]): DiscoverySeedV1[] {
  const byId = new Map<string, DiscoverySeedV1>();
  for (const value of values) {
    const seed = validateDiscoverySeedV1(value);
    const existing = byId.get(seed.seed_id);
    if (!existing) {
      byId.set(seed.seed_id, seed);
      continue;
    }
    if (stableJson(existing) !== stableJson(seed)) {
      throw new Error(`Conflicting discovery seed records share canonical identity: ${seed.seed_id}`);
    }
  }
  return [...byId.values()].sort(compareSeeds);
}

export function buildDraftDiscoveryAcquisitionManifest(input: unknown): DraftDiscoveryAcquisitionManifestV1 {
  const catalog = object(input, 'Discovery seed catalog') as unknown as DiscoverySeedCatalogV1;
  if (catalog.schema_version !== 'viralbench_discovery_seed_catalog_v1') {
    throw new Error('Discovery seed catalog must use schema_version viralbench_discovery_seed_catalog_v1');
  }
  const generatedAt = isoTimestamp(catalog.generated_at, 'Discovery seed catalog generated_at');
  const allocation = validateAllocation(catalog.allocation);
  if (!Array.isArray(catalog.seeds)) throw new Error('Discovery seed catalog seeds must be an array');
  const seeds = canonicalizeAndDeduplicateDiscoverySeeds(catalog.seeds);
  const actual = countScopes(seeds);
  if (actual.internship_early_career !== allocation.internship_early_career
    || actual.broader_job_search !== allocation.broader_job_search
    || seeds.length !== allocation.target_total) {
    throw new Error(`Discovery allocation mismatch: expected ${allocation.internship_early_career}/${allocation.broader_job_search}/${allocation.target_total}, received ${actual.internship_early_career}/${actual.broader_job_search}/${seeds.length}`);
  }
  const registryReviewCandidates = seeds
    .filter((seed) => seed.source_type === 'competitor_profile'
      && seed.verification_state === 'candidate_pending_registry_review')
    .map((seed) => ({
      seed_id: seed.seed_id,
      platform: seed.platform as 'instagram' | 'tiktok' | 'youtube_shorts',
      handle: seed.locator,
      evidence_url: seed.evidence_url,
      confidence: seed.confidence,
      verification_state: seed.verification_state,
      reason: 'Public evidence supports a candidate identity, but registry review remains required before any collection identity is accepted.',
    }));
  const sourceRoutes = groupRoutes(seeds);
  const accessGaps = seeds.filter((seed) => seed.verification_state === 'access_limited')
    .map((seed) => ({
      seed_id: seed.seed_id,
      platform: seed.platform,
      source_type: seed.source_type,
      reason: seed.collection.reason,
      required_next_action: 'Record a dated manual observation only when the applicable browser/UI authorization is present; stop at login, CAPTCHA, verification, region, or terms gates.',
    }));
  return {
    schema_version: 'viralbench_discovery_acquisition_draft_v1',
    generated_at: generatedAt,
    status: 'draft_only',
    external_calls_authorized: false,
    source_registry_mutation_authorized: false,
    allocation: {
      ...allocation,
      internship_share: round(allocation.internship_early_career / allocation.target_total),
      broader_job_search_share: round(allocation.broader_job_search / allocation.target_total),
    },
    seeds,
    registry_review_candidates: registryReviewCandidates,
    source_routes: sourceRoutes,
    source_route_lineage: validateLineage(catalog.source_route_lineage),
    access_gaps: accessGaps,
    evidence_boundaries: [
      'This is a draft discovery manifest. It authorizes zero provider, platform, API, browser-automation, account, publication, or paid calls.',
      'A candidate profile with public evidence is not a reviewed production source. Registry review and a separately approved collection manifest remain required.',
      'Seeds describe public discovery locators only. They must not retain private-account material, contact information, credentials, or creator personal data.',
      'Expected yield is planning capacity only; it is not a performance claim, a provider quote, or permission to collect.',
      'TikTok Creative Center and Google Trends access gaps remain explicit and must not be bypassed with login, CAPTCHA, verification, region, or terms workarounds.',
    ],
  };
}

export function writeDraftDiscoveryAcquisitionManifest(options: {
  root?: string;
  output_path?: string;
  manifest: DraftDiscoveryAcquisitionManifestV1;
}): string {
  const root = path.resolve(options.root ?? process.cwd());
  const output = path.resolve(root, options.output_path
    ?? '.ops/competitor_research/internship-discovery-acquisition-draft-v1-20260718.json');
  atomicWriteJson(output, options.manifest);
  return path.relative(root, output);
}

function groupRoutes(seeds: DiscoverySeedV1[]): DraftDiscoveryAcquisitionManifestV1['source_routes'] {
  const grouped = new Map<string, DiscoverySeedV1[]>();
  for (const seed of seeds) {
    const key = [seed.scope, seed.platform, seed.source_type].join(':');
    grouped.set(key, [...(grouped.get(key) ?? []), seed]);
  }
  return [...grouped.entries()].map(([key, values]) => {
    const [scope, platform, sourceType] = key.split(':') as [
      DiscoveryScopeV1, DiscoveryPlatformV1, DiscoverySourceTypeV1,
    ];
    return {
      scope,
      platform,
      source_type: sourceType,
      seeds: values.length,
      expected_unique_public_records_min: values.length,
      expected_unique_public_records_max: values.length * expectedYieldMultiplier(sourceType),
      execution_state: 'draft_only_requires_separate_approval' as const,
    };
  }).sort((left, right) => (
    left.scope.localeCompare(right.scope)
    || left.platform.localeCompare(right.platform)
    || left.source_type.localeCompare(right.source_type)
  ));
}

function expectedYieldMultiplier(sourceType: DiscoverySourceTypeV1): number {
  if (sourceType === 'competitor_profile') return 6;
  if (sourceType === 'official_trend') return 5;
  return 10;
}

function validateAllocation(value: unknown): DiscoverySeedCatalogV1['allocation'] {
  const row = object(value, 'Discovery allocation');
  const targetTotal = positiveInteger(row.target_total, 'Discovery allocation target_total');
  const internship = positiveInteger(row.internship_early_career, 'Discovery allocation internship_early_career');
  const broader = positiveInteger(row.broader_job_search, 'Discovery allocation broader_job_search');
  if (targetTotal !== internship + broader) throw new Error('Discovery allocation target_total must equal scope quotas');
  if (internship / targetTotal < 0.7 || broader / targetTotal > 0.3) {
    throw new Error('Discovery allocation must preserve at least 70% internship/early-career and at most 30% broader job-search');
  }
  return { target_total: targetTotal, internship_early_career: internship, broader_job_search: broader };
}

function validateLineage(value: unknown): DiscoverySeedCatalogV1['source_route_lineage'] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Discovery source-route lineage must be a non-empty array');
  return value.map((entry, index) => {
    const row = object(entry, `Discovery source-route lineage ${index}`);
    return {
      route: enumValue(row.route, SOURCE_TYPES, `Discovery source-route lineage ${index} route`),
      source_document: requiredText(row.source_document, `Discovery source-route lineage ${index} source_document`),
      source_url: canonicalizeDiscoveryUrl(requiredText(row.source_url, `Discovery source-route lineage ${index} source_url`)),
      observed_at: isoTimestamp(row.observed_at, `Discovery source-route lineage ${index} observed_at`),
    };
  });
}

function canonicalLocator(sourceType: DiscoverySourceTypeV1, value: string): string {
  assertNoPrivateOrContactData(value, 'Discovery locator');
  if (sourceType === 'competitor_profile') return canonicalizeDiscoveryHandle(value);
  if (sourceType === 'hashtag') return canonicalizeDiscoveryHashtag(value);
  return canonicalizeDiscoveryQuery(value);
}

function compareSeeds(left: DiscoverySeedV1, right: DiscoverySeedV1): number {
  return left.scope.localeCompare(right.scope)
    || left.platform.localeCompare(right.platform)
    || left.source_type.localeCompare(right.source_type)
    || left.locator.localeCompare(right.locator);
}

function countScopes(seeds: DiscoverySeedV1[]): Record<DiscoveryScopeV1, number> {
  return seeds.reduce<Record<DiscoveryScopeV1, number>>((counts, seed) => {
    counts[seed.scope] += 1;
    return counts;
  }, { internship_early_career: 0, broader_job_search: 0 });
}

function assertNoPrivateOrContactData(value: string, label: string): void {
  if (CONTACT_PATTERN.test(value)) throw new Error(`${label} must not contain private or contact data`);
}

function ensureUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, label: string): T {
  const result = text(value) as T;
  if (!allowed.has(result)) throw new Error(`${label} is invalid: ${text(value)}`);
  return result;
}

function httpsUrl(value: string, label: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('not HTTPS');
    return url;
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
}

function isoTimestamp(value: unknown, label: string): string {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredText(value: unknown, label: string): string {
  const result = text(value);
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${token}`);
    result[token.slice(2)] = next;
    index += 1;
  }
  return result;
}

function runCli(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'build') throw new Error('Usage: competitor-discovery-seeds.ts build --input <catalog> [--output <manifest>]');
  const args = parseArgs(rest);
  const root = path.resolve(args.root ?? process.cwd());
  if (!args.input) throw new Error('Missing --input');
  const manifest = buildDraftDiscoveryAcquisitionManifest(JSON.parse(fs.readFileSync(path.resolve(root, args.input), 'utf8')));
  const output = writeDraftDiscoveryAcquisitionManifest({ root, output_path: args.output, manifest });
  process.stdout.write(`${JSON.stringify({
    schema_version: manifest.schema_version,
    status: manifest.status,
    external_calls_authorized: manifest.external_calls_authorized,
    allocation: manifest.allocation,
    seeds: manifest.seeds.length,
    output,
  }, null, 2)}\n`);
}

if (require.main === module) runCli();
