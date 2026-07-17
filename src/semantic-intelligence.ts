import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import * as fs from 'node:fs';
import { isIP } from 'node:net';
import * as path from 'node:path';

export const SOCIAL_PLATFORMS = ['tiktok', 'instagram', 'youtube_shorts'] as const;
export const MARENGO_MODEL = 'marengo3.0' as const;
export const PEGASUS_MODEL = 'pegasus1.5' as const;
export const PROVIDER_MODEL_REVISION_UNKNOWN = 'provider_revision_unknown' as const;
export const MAX_LOCAL_SEMANTIC_ITEMS = 100_000;
export const DEFAULT_SEMANTIC_DB_PATH = 'semantic_corpus.sqlite';
export const DEFAULT_SEMANTIC_ARTIFACT_DIR = '.semantic-artifacts';

export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];
export type IntakeApprovalState = 'draft' | 'approved' | 'rejected';
export type CommentSelectionReason = 'high_engagement' | 'recent' | 'both';
export type SemanticItemType = 'video_segment' | 'caption' | 'pegasus_description' | 'comment' | 'account' | 'hashtag';
export type CoasCheckpoint = 'public_one_time' | '24h' | '72h' | '7d';

export interface UrlIntakeRequest {
  request_id: string;
  urls: string[];
  allowed_platforms: SocialPlatform[];
  comment_policy: {
    enabled: boolean;
    max_high_engagement: number;
    max_recent: number;
    max_replies_per_thread: number;
  };
  approval_state: IntakeApprovalState;
  cost_limits: {
    max_total_usd: number;
    max_apify_usd: number;
    max_twelvelabs_usd: number;
    max_gemini_usd: number;
  };
}

export interface SocialAccount {
  evidence_id: string;
  platform: SocialPlatform;
  platform_account_id: string | null;
  handle: string;
  display_name: string;
  bio: string;
  canonical_url: string | null;
}

export interface SocialComment {
  evidence_id: string;
  platform_comment_id: string;
  parent_comment_id: string | null;
  thread_root_id: string;
  author_handle: string;
  text: string;
  like_count: number;
  reply_count: number;
  created_at: string | null;
  selection_reason: CommentSelectionReason;
}

export interface SocialMetricSnapshot {
  captured_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows: number | null;
  profile_visits: number | null;
  dms: number | null;
  view_velocity: number | null;
  checkpoint: CoasCheckpoint;
  source_kind: 'public_snapshot' | 'owned_analytics';
}

export interface NormalizedSocialPost {
  evidence_id: string;
  request_id: string;
  platform: SocialPlatform;
  platform_post_id: string;
  canonical_url: string;
  content_type: 'short_video';
  caption: string;
  posted_at: string | null;
  collected_at: string;
  account: SocialAccount;
  hashtags: string[];
  comments: SocialComment[];
  metric_snapshot: SocialMetricSnapshot;
  media: {
    source_url: string | null;
    local_path: string | null;
    sha256: string | null;
    bytes: number | null;
    mime_type: string | null;
  };
  provenance: {
    apify_actor_id: string;
    apify_actor_build_id: string | null;
    apify_actor_build_number: string | null;
    apify_actor_input_sha256: string | null;
    apify_actor_input_mode: 'explicit_url' | 'search' | 'profile' | 'channel' | 'hashtag';
    apify_run_id: string;
    apify_dataset_id: string;
    apify_dataset_item_offset: number;
    raw_item_sha256: string;
    raw_artifact_path: string;
  };
  partial_text_only: boolean;
  evidence_limitations: string[];
}

export interface TimedCreativeBeat {
  start_sec: number;
  end_sec: number;
  label: string;
  description: string;
  evidence: string[];
}

export interface VideoCreativeAnalysis {
  analysis_id: string;
  video_asset_id: string;
  model_name: typeof PEGASUS_MODEL;
  model_version: string;
  model_revision?: string | null;
  provider_generation_id?: string | null;
  provider_asset_id?: string | null;
  provider_analysis_task_id?: string | null;
  finish_reason?: 'stop';
  usage?: { input_tokens: number | null; output_tokens: number | null };
  created_at: string;
  duration_sec: number;
  hook: {
    text: string;
    start_sec: number;
    end_sec: number;
  };
  creative_beats: TimedCreativeBeat[];
  visible_proof: Array<{ start_sec: number; end_sec: number; description: string }>;
  on_screen_text: Array<{ start_sec: number; end_sec: number; text: string }>;
  speech: Array<{ start_sec: number; end_sec: number; text: string }>;
  audio_cues: Array<{ start_sec: number; end_sec: number; description: string }>;
  pacing: {
    cuts_per_minute: number | null;
    pattern: string;
  };
  cta: {
    text: string;
    start_sec: number | null;
    end_sec: number | null;
  };
  claims: Array<{ text: string; start_sec: number; end_sec: number; support: 'visible' | 'spoken' | 'unsupported' }>;
  style: string[];
  evidence_limitations: string[];
}

export interface SemanticItem {
  item_id: string;
  evidence_id: string;
  post_id: string;
  item_type: SemanticItemType;
  text: string;
  embedding: number[];
  embedding_model: typeof MARENGO_MODEL;
  model_version: string;
  canonical_url: string;
  start_sec: number | null;
  end_sec: number | null;
  platform: SocialPlatform;
  account_handle: string;
  hashtags: string[];
  created_at: string;
  observed_coas: number | null;
  predicted_coas: number | null;
  confidence: number;
}

export interface SemanticSearchQuery {
  query: string;
  embedding_model: typeof MARENGO_MODEL;
  model_version: string;
  limit?: number;
  filters?: {
    platforms?: SocialPlatform[];
    accounts?: string[];
    hashtags?: string[];
    date_from?: string;
    date_to?: string;
  };
}

export interface SemanticSearchHit {
  item_id: string;
  evidence_id: string;
  post_id: string;
  item_type: SemanticItemType;
  text: string;
  canonical_url: string;
  timestamped_url: string;
  start_sec: number | null;
  end_sec: number | null;
  platform: SocialPlatform;
  account_handle: string;
  hashtags: string[];
  retrieval_relevance: number;
  semantic_similarity: number | null;
  observed_coas: number | null;
  predicted_coas: number | null;
  freshness: number;
  confidence: number;
  rank_sources: Array<'vector' | 'fts'>;
}

export interface CreativeEvaluation {
  evaluation_id: string;
  candidate_id: string;
  evaluated_at: string;
  observed_coas: null;
  predicted_coas: number;
  calibrated: boolean;
  confidence: number;
  rubric_alignment: number;
  qa_blockers: string[];
  evidence_ids: string[];
  status: 'draft_pending_human_review';
}

export interface CreativeRevisionDirective {
  directive_id: string;
  candidate_id: string;
  created_at: string;
  objective: string;
  preserve: string[];
  change: Array<{
    field: 'hook' | 'beat' | 'proof' | 'on_screen_text' | 'speech' | 'audio' | 'pacing' | 'cta' | 'claim' | 'style';
    instruction: string;
    evidence_ids: string[];
  }>;
  target_predicted_coas_improvement: number;
  constraints: {
    target_duration_sec: number;
    aspect_ratio: '9:16';
    unapproved_draft_only: true;
    prohibited_claims: string[];
  };
}

export interface PerformanceRecord {
  post_id: string;
  platform: SocialPlatform;
  content_type: string;
  age_bucket: string;
  checkpoint: CoasCheckpoint;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  follows?: number | null;
  profile_visits?: number | null;
  dms?: number | null;
  view_velocity?: number | null;
}

export interface ObservedCoasResult {
  kind: 'observed';
  score: number | null;
  confidence: number;
  metric_coverage: number;
  cohort_size: number;
  checkpoint_maturity: number;
  component_percentiles: Partial<Record<CoasMetric, number>>;
  missing_metrics: CoasMetric[];
}

export interface PredictedCoasResult {
  kind: 'predicted';
  score: number;
  calibrated: boolean;
  confidence: number;
  mature_comparable_count: number;
  rubric_alignment: number;
  neighboring_outcome: number | null;
}

export interface PredictedCoasNeighbor {
  observed_coas: number;
  semantic_similarity: number;
  mature: boolean;
  comparable: boolean;
}

export interface SemanticStore {
  initialize(): void;
  countSemanticItems(): number;
  upsertPost(post: NormalizedSocialPost): void;
  upsertVideoAnalysis(analysis: VideoCreativeAnalysis): void;
  upsertSemanticItem(item: SemanticItem): void;
  search(query: SemanticSearchQuery, queryEmbedding: number[]): SemanticSearchHit[];
}

type CoasMetric = 'view_velocity' | 'likes' | 'comments' | 'shares' | 'saves' | 'follows' | 'profile_visits' | 'dms';

const COAS_WEIGHTS: Record<CoasMetric, number> = {
  view_velocity: 0.15,
  likes: 0.05,
  comments: 0.15,
  shares: 0.25,
  saves: 0.20,
  follows: 0.10,
  profile_visits: 0.05,
  dms: 0.05,
};

const CHECKPOINT_MATURITY: Record<CoasCheckpoint, number> = {
  public_one_time: 0.35,
  '24h': 0.55,
  '72h': 0.80,
  '7d': 1,
};

interface ActorProvenance {
  actor_id: string;
  actor_build_id?: string | null;
  actor_build_number?: string | null;
  actor_input_sha256?: string | null;
  actor_input_mode?: 'explicit_url' | 'search' | 'profile' | 'channel' | 'hashtag';
  run_id: string;
  dataset_id: string;
  dataset_item_offset?: number;
  raw_item_sha256?: string;
  raw_artifact_path: string;
  collected_at?: string;
}

interface SemanticRow {
  item_id: string;
  evidence_id: string;
  post_id: string;
  item_type: SemanticItemType;
  text: string;
  embedding_hex: string;
  embedding_model: string;
  model_version: string;
  canonical_url: string;
  start_sec: number | null;
  end_sec: number | null;
  platform: SocialPlatform;
  account_handle: string;
  hashtags_json: string;
  created_at: string;
  observed_coas: number | null;
  predicted_coas: number | null;
  confidence: number;
}

export function validateUrlIntakeRequest(input: unknown): UrlIntakeRequest {
  const record = expectRecord(input, 'URL intake request');
  const requestId = requiredText(record, 'request_id');
  const urls = requiredTextArray(record, 'urls').map((url) => normalizePublicPostUrl(url).canonical_url);
  const allowedPlatforms = requiredTextArray(record, 'allowed_platforms')
    .map((value) => oneOf(value, SOCIAL_PLATFORMS, 'allowed_platforms'));
  const policy = expectRecord(record.comment_policy, 'comment_policy');
  const limits = expectRecord(record.cost_limits, 'cost_limits');
  const request: UrlIntakeRequest = {
    request_id: requestId,
    urls: unique(urls),
    allowed_platforms: unique(allowedPlatforms),
    comment_policy: {
      enabled: requiredBoolean(policy, 'enabled'),
      max_high_engagement: boundedInteger(policy, 'max_high_engagement', 0, 50),
      max_recent: boundedInteger(policy, 'max_recent', 0, 50),
      max_replies_per_thread: boundedInteger(policy, 'max_replies_per_thread', 0, 5),
    },
    approval_state: oneOf(requiredText(record, 'approval_state'), ['draft', 'approved', 'rejected'] as const, 'approval_state'),
    cost_limits: {
      max_total_usd: nonNegativeNumber(limits, 'max_total_usd'),
      max_apify_usd: nonNegativeNumber(limits, 'max_apify_usd'),
      max_twelvelabs_usd: nonNegativeNumber(limits, 'max_twelvelabs_usd'),
      max_gemini_usd: nonNegativeNumber(limits, 'max_gemini_usd'),
    },
  };

  for (const url of request.urls) {
    const platform = normalizePublicPostUrl(url).platform;
    if (!request.allowed_platforms.includes(platform)) {
      throw new Error(`URL platform ${platform} is not included in allowed_platforms.`);
    }
  }
  const providerCeiling = request.cost_limits.max_apify_usd
    + request.cost_limits.max_twelvelabs_usd
    + request.cost_limits.max_gemini_usd;
  if (providerCeiling > request.cost_limits.max_total_usd + 1e-9) {
    throw new Error('Per-provider cost limits must not exceed max_total_usd in aggregate.');
  }
  return request;
}

export function assertPublicUrlIngestionAllowed(
  requestInput: UrlIntakeRequest | unknown,
  env: Record<string, string | undefined> = process.env,
): UrlIntakeRequest {
  const request = validateUrlIntakeRequest(requestInput);
  if (request.approval_state !== 'approved') {
    throw new Error('url_intake_not_approved');
  }
  if ((env.ALLOW_PUBLIC_URL_INGESTION ?? '').toLowerCase() !== 'true') {
    throw new Error('public URL ingestion is blocked unless ALLOW_PUBLIC_URL_INGESTION=true');
  }
  return request;
}

export function normalizePublicPostUrl(input: string): { platform: SocialPlatform; canonical_url: string; platform_post_id: string } {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid public post URL: ${input}`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Only credential-free HTTPS public post URLs are allowed.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const videoIndex = parts.indexOf('video');
    const postId = videoIndex >= 0 ? parts[videoIndex + 1] : undefined;
    if (!postId || !/^\d+$/.test(postId)) {
      throw new Error('TikTok intake requires a direct public /video/<id> URL.');
    }
    const account = videoIndex > 0 && parts[videoIndex - 1].startsWith('@') ? `/${parts[videoIndex - 1]}` : '';
    return {
      platform: 'tiktok',
      platform_post_id: postId,
      canonical_url: `https://www.tiktok.com${account}/video/${postId}`,
    };
  }

  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    if (!['reel', 'p', 'tv'].includes(parts[0] ?? '') || !parts[1]) {
      throw new Error('Instagram intake requires a direct public reel or post URL.');
    }
    return {
      platform: 'instagram',
      platform_post_id: parts[1],
      canonical_url: `https://www.instagram.com/${parts[0]}/${parts[1]}/`,
    };
  }

  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (parts[0] !== 'shorts' || !parts[1]) {
      throw new Error('YouTube intake requires a direct public /shorts/<id> URL.');
    }
    return {
      platform: 'youtube_shorts',
      platform_post_id: parts[1],
      canonical_url: `https://www.youtube.com/shorts/${parts[1]}`,
    };
  }

  if (host === 'youtu.be' && parts[0]) {
    return {
      platform: 'youtube_shorts',
      platform_post_id: parts[0],
      canonical_url: `https://www.youtube.com/shorts/${parts[0]}`,
    };
  }

  throw new Error(`Unsupported public post URL host: ${parsed.hostname}`);
}

export function actorIdForPlatform(platform: SocialPlatform, env: Record<string, string | undefined> = process.env): string {
  const key = platform === 'tiktok'
    ? 'APIFY_ACTOR_TIKTOK'
    : platform === 'instagram'
      ? 'APIFY_ACTOR_INSTAGRAM'
      : 'APIFY_ACTOR_YOUTUBE';
  const value = nonEmpty(env[key]);
  if (!value) throw new Error(`${key} is required; marketplace Actor IDs are never hardcoded.`);
  return value;
}

export function normalizeActorItems(
  requestInput: UrlIntakeRequest | unknown,
  platform: SocialPlatform,
  items: unknown[],
  provenance: ActorProvenance,
): NormalizedSocialPost[] {
  const request = validateUrlIntakeRequest(requestInput);
  if (!request.allowed_platforms.includes(platform)) throw new Error(`Platform ${platform} is not approved for this request.`);
  return items.map((item, index) => normalizeActorItem(
    request,
    platform,
    expectRecord(item, `dataset item ${index}`),
    {
      ...provenance,
      dataset_item_offset: (provenance.dataset_item_offset ?? 0) + index,
      raw_item_sha256: crypto.createHash('sha256').update(canonicalJson(item)).digest('hex'),
    },
  ));
}

export function selectComments(
  input: unknown[],
  policy: UrlIntakeRequest['comment_policy'],
  postEvidenceId = 'post',
): SocialComment[] {
  if (!policy.enabled) return [];
  const normalized = deduplicateComments(flattenComments(input, postEvidenceId));
  const byEngagement = [...normalized].sort((a, b) => (
    (b.like_count + b.reply_count * 2) - (a.like_count + a.reply_count * 2)
    || stableTextCompare(a.evidence_id, b.evidence_id)
  ));
  const byRecent = [...normalized].sort((a, b) => (
    timestamp(b.created_at) - timestamp(a.created_at)
    || stableTextCompare(a.evidence_id, b.evidence_id)
  ));
  const highIds = new Set(byEngagement.slice(0, policy.max_high_engagement).map((comment) => comment.evidence_id));
  const recentIds = new Set(byRecent.slice(0, policy.max_recent).map((comment) => comment.evidence_id));
  const selected = normalized
    .filter((comment) => highIds.has(comment.evidence_id) || recentIds.has(comment.evidence_id))
    .map((comment): SocialComment => ({
      ...comment,
      selection_reason: highIds.has(comment.evidence_id) && recentIds.has(comment.evidence_id)
        ? 'both'
        : highIds.has(comment.evidence_id) ? 'high_engagement' : 'recent',
    }));

  const repliesPerThread = new Map<string, number>();
  return selected
    .sort((a, b) => stableTextCompare(a.evidence_id, b.evidence_id))
    .filter((comment) => {
      if (!comment.parent_comment_id) return true;
      const count = repliesPerThread.get(comment.thread_root_id) ?? 0;
      if (count >= policy.max_replies_per_thread) return false;
      repliesPerThread.set(comment.thread_root_id, count + 1);
      return true;
    });
}

export function serializeEmbedding(values: number[]): Buffer {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding must contain finite Float32 values.');
  }
  const buffer = Buffer.allocUnsafe(8 + values.length * 4);
  buffer.write('VBF1', 0, 4, 'ascii');
  buffer.writeUInt32LE(values.length, 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, 8 + index * 4));
  return buffer;
}

export function deserializeEmbedding(buffer: Buffer): number[] {
  if (buffer.length < 12 || buffer.subarray(0, 4).toString('ascii') !== 'VBF1') {
    throw new Error('Unsupported embedding blob version.');
  }
  const dimensions = buffer.readUInt32LE(4);
  if (buffer.length !== 8 + dimensions * 4) throw new Error('Embedding blob length does not match its versioned header.');
  return Array.from({ length: dimensions }, (_, index) => buffer.readFloatLE(8 + index * 4));
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) throw new Error('Embedding dimensions must match.');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export class SqliteSemanticStore implements SemanticStore {
  readonly dbPath: string;

  constructor(dbPath = DEFAULT_SEMANTIC_DB_PATH) {
    this.dbPath = path.resolve(dbPath);
  }

  initialize(): void {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    sqliteExec(this.dbPath, `
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS social_accounts (
        evidence_id TEXT PRIMARY KEY, platform TEXT NOT NULL, platform_account_id TEXT,
        handle TEXT NOT NULL, display_name TEXT NOT NULL, bio TEXT NOT NULL, canonical_url TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS social_posts (
        evidence_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, platform TEXT NOT NULL,
        platform_post_id TEXT NOT NULL, canonical_url TEXT NOT NULL, content_type TEXT NOT NULL,
        caption TEXT NOT NULL, posted_at TEXT, collected_at TEXT NOT NULL, account_id TEXT NOT NULL,
        hashtags_json TEXT NOT NULL, partial_text_only INTEGER NOT NULL, raw_artifact_path TEXT NOT NULL,
        apify_actor_id TEXT NOT NULL, apify_run_id TEXT NOT NULL, apify_dataset_id TEXT NOT NULL,
        evidence_limitations_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(account_id) REFERENCES social_accounts(evidence_id)
      );
      CREATE TABLE IF NOT EXISTS social_comments (
        evidence_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, platform_comment_id TEXT NOT NULL,
        parent_comment_id TEXT, thread_root_id TEXT NOT NULL, author_handle TEXT NOT NULL,
        text TEXT NOT NULL, like_count INTEGER NOT NULL, reply_count INTEGER NOT NULL,
        created_at TEXT, selection_reason TEXT NOT NULL,
        FOREIGN KEY(post_id) REFERENCES social_posts(evidence_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS social_hashtags (
        evidence_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, platform TEXT NOT NULL,
        normalized_tag TEXT NOT NULL, display_tag TEXT NOT NULL, surrounding_context TEXT NOT NULL,
        FOREIGN KEY(post_id) REFERENCES social_posts(evidence_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS performance_observations (
        observation_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, captured_at TEXT NOT NULL,
        views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
        follows INTEGER, profile_visits INTEGER, dms INTEGER, view_velocity REAL,
        checkpoint TEXT NOT NULL, source_kind TEXT NOT NULL,
        FOREIGN KEY(post_id) REFERENCES social_posts(evidence_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS post_source_observations (
        source_observation_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, request_id TEXT NOT NULL,
        collected_at TEXT NOT NULL, metric_captured_at TEXT NOT NULL, account_json TEXT NOT NULL,
        post_json TEXT NOT NULL, comments_json TEXT NOT NULL, hashtags_json TEXT NOT NULL,
        media_json TEXT NOT NULL, provenance_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(post_id) REFERENCES social_posts(evidence_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS post_source_observations_post_idx
        ON post_source_observations(post_id, collected_at);
      CREATE TABLE IF NOT EXISTS video_assets (
        asset_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, source_url TEXT, local_path TEXT,
        sha256 TEXT, bytes INTEGER, mime_type TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(post_id) REFERENCES social_posts(evidence_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS video_analyses (
        analysis_id TEXT PRIMARY KEY, video_asset_id TEXT NOT NULL, model_name TEXT NOT NULL,
        model_version TEXT NOT NULL, analysis_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS semantic_items (
        item_id TEXT PRIMARY KEY, evidence_id TEXT NOT NULL, post_id TEXT NOT NULL,
        item_type TEXT NOT NULL, text TEXT NOT NULL, embedding BLOB NOT NULL,
        embedding_dimensions INTEGER NOT NULL, embedding_model TEXT NOT NULL, model_version TEXT NOT NULL,
        canonical_url TEXT NOT NULL, start_sec REAL, end_sec REAL, platform TEXT NOT NULL,
        account_handle TEXT NOT NULL, hashtags_json TEXT NOT NULL, created_at TEXT NOT NULL,
        observed_coas REAL, predicted_coas REAL, confidence REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS semantic_items_model_idx ON semantic_items(embedding_model, model_version);
      CREATE INDEX IF NOT EXISTS semantic_items_post_idx ON semantic_items(post_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS semantic_items_fts USING fts5(
        item_id UNINDEXED, text, tokenize = 'unicode61'
      );
    `);
  }

  countSemanticItems(): number {
    this.initialize();
    const [row] = sqliteJson<{ count: number }>(this.dbPath, 'SELECT COUNT(*) AS count FROM semantic_items;');
    return Number(row?.count ?? 0);
  }

  upsertPost(post: NormalizedSocialPost): void {
    this.initialize();
    const sourceObservationId = `${post.evidence_id}:source:${post.provenance.raw_item_sha256}`;
    const observationId = `${post.evidence_id}:${post.metric_snapshot.captured_at}:${post.provenance.raw_item_sha256.slice(0, 16)}`;
    const assetId = `${post.evidence_id}:video`;
    const statements: string[] = [
      `INSERT INTO social_accounts VALUES (${sqlValues([
        post.account.evidence_id, post.platform, post.account.platform_account_id, post.account.handle,
        post.account.display_name, post.account.bio, post.account.canonical_url, post.collected_at,
      ])}) ON CONFLICT(evidence_id) DO UPDATE SET
        platform=excluded.platform, platform_account_id=excluded.platform_account_id,
        handle=excluded.handle, display_name=excluded.display_name, bio=excluded.bio,
        canonical_url=excluded.canonical_url, updated_at=excluded.updated_at;`,
      `INSERT INTO social_posts VALUES (${sqlValues([
        post.evidence_id, post.request_id, post.platform, post.platform_post_id, post.canonical_url,
        post.content_type, post.caption, post.posted_at, post.collected_at, post.account.evidence_id,
        JSON.stringify(post.hashtags), post.partial_text_only ? 1 : 0, post.provenance.raw_artifact_path,
        post.provenance.apify_actor_id, post.provenance.apify_run_id, post.provenance.apify_dataset_id,
        JSON.stringify(post.evidence_limitations), post.collected_at,
      ])}) ON CONFLICT(evidence_id) DO UPDATE SET
        request_id=excluded.request_id, platform=excluded.platform,
        platform_post_id=excluded.platform_post_id, canonical_url=excluded.canonical_url,
        content_type=excluded.content_type, caption=excluded.caption, posted_at=excluded.posted_at,
        collected_at=excluded.collected_at, account_id=excluded.account_id,
        hashtags_json=excluded.hashtags_json, partial_text_only=excluded.partial_text_only,
        raw_artifact_path=excluded.raw_artifact_path, apify_actor_id=excluded.apify_actor_id,
        apify_run_id=excluded.apify_run_id, apify_dataset_id=excluded.apify_dataset_id,
        evidence_limitations_json=excluded.evidence_limitations_json, updated_at=excluded.updated_at;`,
      ...post.comments.map((comment) => `INSERT INTO social_comments VALUES (${sqlValues([
        comment.evidence_id, post.evidence_id, comment.platform_comment_id, comment.parent_comment_id,
        comment.thread_root_id, comment.author_handle, comment.text, comment.like_count, comment.reply_count,
        comment.created_at, comment.selection_reason,
      ])}) ON CONFLICT(evidence_id) DO UPDATE SET
        post_id=excluded.post_id, platform_comment_id=excluded.platform_comment_id,
        parent_comment_id=excluded.parent_comment_id, thread_root_id=excluded.thread_root_id,
        author_handle=excluded.author_handle, text=excluded.text, like_count=excluded.like_count,
        reply_count=excluded.reply_count, created_at=excluded.created_at,
        selection_reason=excluded.selection_reason;`),
      ...post.hashtags.map((tag) => `INSERT INTO social_hashtags VALUES (${sqlValues([
        `${post.evidence_id}:hashtag:${normalizedHashtag(tag)}`, post.evidence_id, post.platform,
        normalizedHashtag(tag), tag, post.caption,
      ])}) ON CONFLICT(evidence_id) DO UPDATE SET
        post_id=excluded.post_id, platform=excluded.platform, normalized_tag=excluded.normalized_tag,
        display_tag=excluded.display_tag, surrounding_context=excluded.surrounding_context;`),
      `INSERT INTO performance_observations VALUES (${sqlValues([
        observationId, post.evidence_id, post.metric_snapshot.captured_at, post.metric_snapshot.views,
        post.metric_snapshot.likes, post.metric_snapshot.comments, post.metric_snapshot.shares,
        post.metric_snapshot.saves, post.metric_snapshot.follows, post.metric_snapshot.profile_visits,
        post.metric_snapshot.dms, post.metric_snapshot.view_velocity, post.metric_snapshot.checkpoint,
        post.metric_snapshot.source_kind,
      ])}) ON CONFLICT(observation_id) DO NOTHING;`,
      `INSERT INTO video_assets VALUES (${sqlValues([
        assetId, post.evidence_id, post.media.source_url, post.media.local_path, post.media.sha256,
        post.media.bytes, post.media.mime_type, post.collected_at,
      ])}) ON CONFLICT(asset_id) DO UPDATE SET
        source_url=excluded.source_url, local_path=excluded.local_path, sha256=excluded.sha256,
        bytes=excluded.bytes, mime_type=excluded.mime_type, created_at=excluded.created_at;`,
      `INSERT INTO post_source_observations VALUES (${sqlValues([
        sourceObservationId, post.evidence_id, post.request_id, post.collected_at,
        post.metric_snapshot.captured_at, JSON.stringify(post.account), JSON.stringify({
          evidence_id: post.evidence_id,
          platform: post.platform,
          platform_post_id: post.platform_post_id,
          canonical_url: post.canonical_url,
          content_type: post.content_type,
          caption: post.caption,
          posted_at: post.posted_at,
          partial_text_only: post.partial_text_only,
          evidence_limitations: post.evidence_limitations,
        }), JSON.stringify(post.comments), JSON.stringify(post.hashtags), JSON.stringify(post.media),
        JSON.stringify(post.provenance), post.collected_at,
      ])}) ON CONFLICT(source_observation_id) DO NOTHING;`,
    ];
    sqliteExec(this.dbPath, `BEGIN; ${statements.join('\n')} COMMIT;`);
  }

  upsertVideoAnalysis(analysisInput: VideoCreativeAnalysis): void {
    const analysis = validateVideoCreativeAnalysis(analysisInput);
    this.initialize();
    sqliteExec(this.dbPath, `INSERT OR REPLACE INTO video_analyses VALUES (${sqlValues([
      analysis.analysis_id, analysis.video_asset_id, analysis.model_name, analysis.model_version,
      JSON.stringify(analysis), analysis.created_at,
    ])});`);
  }

  upsertSemanticItem(item: SemanticItem): void {
    if (item.embedding_model !== MARENGO_MODEL) throw new Error(`unsupported_embedding_model:${item.embedding_model}`);
    this.initialize();
    const exists = sqliteJson<{ present: number }>(this.dbPath, `SELECT 1 AS present FROM semantic_items WHERE item_id=${sqlString(item.item_id)};`).length > 0;
    if (!exists && this.countSemanticItems() >= MAX_LOCAL_SEMANTIC_ITEMS) {
      throw new Error('managed_vector_backend_required');
    }
    const embedding = serializeEmbedding(item.embedding);
    sqliteExec(this.dbPath, `
      BEGIN;
      INSERT OR REPLACE INTO semantic_items VALUES (${sqlValues([
        item.item_id, item.evidence_id, item.post_id, item.item_type, item.text,
        { blob: embedding }, item.embedding.length, item.embedding_model, item.model_version,
        item.canonical_url, item.start_sec, item.end_sec, item.platform, item.account_handle,
        JSON.stringify(item.hashtags), item.created_at, item.observed_coas, item.predicted_coas,
        clamp01(item.confidence),
      ])});
      DELETE FROM semantic_items_fts WHERE item_id=${sqlString(item.item_id)};
      INSERT INTO semantic_items_fts(item_id, text) VALUES (${sqlString(item.item_id)}, ${sqlString(item.text)});
      COMMIT;
    `);
  }

  search(query: SemanticSearchQuery, queryEmbedding: number[]): SemanticSearchHit[] {
    if (query.embedding_model !== MARENGO_MODEL) throw new Error(`unsupported_embedding_model:${query.embedding_model}`);
    this.initialize();
    const count = this.countSemanticItems();
    if (count > MAX_LOCAL_SEMANTIC_ITEMS) throw new Error('managed_vector_backend_required');
    const rows = sqliteJson<SemanticRow>(this.dbPath, `
      SELECT item_id, evidence_id, post_id, item_type, text, hex(embedding) AS embedding_hex,
        embedding_model, model_version, canonical_url, start_sec, end_sec, platform,
        account_handle, hashtags_json, created_at, observed_coas, predicted_coas, confidence
      FROM semantic_items WHERE embedding_model=${sqlString(query.embedding_model)};
    `);
    const versionRows = rows.filter((row) => row.model_version === query.model_version);
    if (rows.length && !versionRows.length) throw new Error('semantic_model_version_mismatch');
    const vectorRanks = versionRows
      .map((row) => ({ row, similarity: cosineSimilarity(queryEmbedding, deserializeEmbedding(Buffer.from(row.embedding_hex, 'hex'))) }))
      .sort((a, b) => b.similarity - a.similarity || stableTextCompare(a.row.item_id, b.row.item_id))
      .slice(0, 200);
    const ftsRanks = ftsQuery(this.dbPath, query.query)
      .filter((row) => versionRows.some((candidate) => candidate.item_id === row.item_id))
      .slice(0, 200);
    const fused = new Map<string, { score: number; sources: Set<'vector' | 'fts'>; similarity: number | null }>();
    vectorRanks.forEach(({ row, similarity }, index) => {
      fused.set(row.item_id, { score: 1 / (60 + index + 1), sources: new Set(['vector']), similarity });
    });
    ftsRanks.forEach((row, index) => {
      const current = fused.get(row.item_id) ?? { score: 0, sources: new Set<'vector' | 'fts'>(), similarity: null };
      current.score += 1 / (60 + index + 1);
      current.sources.add('fts');
      fused.set(row.item_id, current);
    });
    const maxScore = Math.max(0, ...[...fused.values()].map((value) => value.score));
    const rowById = new Map(versionRows.map((row) => [row.item_id, row]));
    return [...fused.entries()]
      .map(([itemId, rank]) => ({ row: rowById.get(itemId), rank }))
      .filter((entry): entry is { row: SemanticRow; rank: typeof entry.rank } => Boolean(entry.row))
      .filter(({ row }) => matchesSemanticFilters(row, query.filters))
      .sort((a, b) => b.rank.score - a.rank.score || stableTextCompare(a.row.item_id, b.row.item_id))
      .slice(0, Math.min(Math.max(query.limit ?? 20, 1), 200))
      .map(({ row, rank }): SemanticSearchHit => ({
        item_id: row.item_id,
        evidence_id: row.evidence_id,
        post_id: row.post_id,
        item_type: row.item_type,
        text: row.text,
        canonical_url: row.canonical_url,
        timestamped_url: timestampedUrl(row.canonical_url, row.start_sec),
        start_sec: row.start_sec,
        end_sec: row.end_sec,
        platform: row.platform,
        account_handle: row.account_handle,
        hashtags: parseStringArray(row.hashtags_json),
        retrieval_relevance: maxScore ? rank.score / maxScore : 0,
        semantic_similarity: rank.similarity,
        observed_coas: nullableNumber(row.observed_coas),
        predicted_coas: nullableNumber(row.predicted_coas),
        freshness: freshnessScore(row.created_at),
        confidence: clamp01(Number(row.confidence)),
        rank_sources: [...rank.sources].sort(),
      }));
  }
}

export function calculateObservedCoas(target: PerformanceRecord, cohort: PerformanceRecord[]): ObservedCoasResult {
  const comparable = cohort.filter((row) => row.platform === target.platform
    && row.content_type === target.content_type
    && row.age_bucket === target.age_bucket);
  const componentPercentiles: Partial<Record<CoasMetric, number>> = {};
  const missingMetrics: CoasMetric[] = [];
  let includedWeight = 0;
  let weightedScore = 0;

  for (const metric of Object.keys(COAS_WEIGHTS) as CoasMetric[]) {
    const targetValue = metricValue(target, metric);
    const values = comparable.map((row) => metricValue(row, metric)).filter(isNumber);
    if (targetValue === null || values.length === 0) {
      missingMetrics.push(metric);
      continue;
    }
    const percentile = percentileRank(targetValue, values);
    componentPercentiles[metric] = percentile;
    includedWeight += COAS_WEIGHTS[metric];
    weightedScore += percentile * COAS_WEIGHTS[metric];
  }

  const maturity = CHECKPOINT_MATURITY[target.checkpoint];
  const confidence = includedWeight * Math.min(1, comparable.length / 30) * maturity;
  return {
    kind: 'observed',
    score: includedWeight ? weightedScore / includedWeight : null,
    confidence: clamp01(confidence),
    metric_coverage: includedWeight,
    cohort_size: comparable.length,
    checkpoint_maturity: maturity,
    component_percentiles: componentPercentiles,
    missing_metrics: missingMetrics,
  };
}

export function calculatePredictedCoas(
  rubricAlignment: number,
  neighbors: PredictedCoasNeighbor[],
  rubricConfidence = 0.5,
): PredictedCoasResult {
  const rubric = clampScore(rubricAlignment);
  const mature = neighbors.filter((neighbor) => neighbor.mature && neighbor.comparable);
  const calibrated = mature.length >= 30;
  const similarityWeight = mature.reduce((sum, neighbor) => sum + Math.max(0, neighbor.semantic_similarity), 0);
  const neighboringOutcome = similarityWeight > 0
    ? mature.reduce((sum, neighbor) => sum + clampScore(neighbor.observed_coas) * Math.max(0, neighbor.semantic_similarity), 0) / similarityWeight
    : null;
  const score = calibrated && neighboringOutcome !== null ? neighboringOutcome * 0.60 + rubric * 0.40 : rubric;
  const neighborConfidence = calibrated
    ? Math.min(1, mature.length / 100) * (mature.reduce((sum, row) => sum + clamp01(row.semantic_similarity), 0) / mature.length)
    : 0;
  return {
    kind: 'predicted',
    score,
    calibrated,
    confidence: clamp01(calibrated ? neighborConfidence * 0.60 + clamp01(rubricConfidence) * 0.40 : clamp01(rubricConfidence)),
    mature_comparable_count: mature.length,
    rubric_alignment: rubric,
    neighboring_outcome: neighboringOutcome,
  };
}

export function validateVideoCreativeAnalysis(input: unknown): VideoCreativeAnalysis {
  const record = expectRecord(input, 'VideoCreativeAnalysis');
  if (record.model_name !== PEGASUS_MODEL) throw new Error(`VideoCreativeAnalysis.model_name must be ${PEGASUS_MODEL}.`);
  const analysis = record as unknown as VideoCreativeAnalysis;
  if (!analysis.analysis_id || !analysis.video_asset_id || !analysis.model_version || !analysis.created_at) {
    throw new Error('VideoCreativeAnalysis identifiers and model trace are required.');
  }
  if (!Number.isFinite(analysis.duration_sec) || analysis.duration_sec <= 0) throw new Error('VideoCreativeAnalysis.duration_sec must be positive.');
  validateTimedRange(analysis.hook, analysis.duration_sec, 'hook');
  for (const [field, entries] of Object.entries({
    creative_beats: analysis.creative_beats,
    visible_proof: analysis.visible_proof,
    on_screen_text: analysis.on_screen_text,
    speech: analysis.speech,
    audio_cues: analysis.audio_cues,
    claims: analysis.claims,
  })) {
    if (!Array.isArray(entries)) throw new Error(`VideoCreativeAnalysis.${field} must be an array.`);
    entries.forEach((entry, index) => validateTimedRange(entry, analysis.duration_sec, `${field}[${index}]`));
  }
  if (!Array.isArray(analysis.style) || !Array.isArray(analysis.evidence_limitations)) {
    throw new Error('VideoCreativeAnalysis style and evidence_limitations must be arrays.');
  }
  return analysis;
}

export async function storeContentAddressedMedia(
  mediaUrl: string,
  options: {
    rootDir?: string;
    fetchImpl?: typeof fetch;
    lookupHost?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
    maxBytes?: number;
    bearerAuthorization?: {
      origin: string;
      token: string;
    };
  } = {},
): Promise<NormalizedSocialPost['media']> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupHost = options.lookupHost ?? (async (hostname) => lookup(hostname, { all: true }));
  const maxBytes = options.maxBytes ?? 250 * 1024 * 1024;
  let parsed = new URL(mediaUrl);
  let response: Response | null = null;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicDownloadUrl(parsed, lookupHost);
    const authorized = options.bearerAuthorization
      && parsed.origin === options.bearerAuthorization.origin
      && options.bearerAuthorization.token.trim();
    response = await fetchImpl(parsed, {
      redirect: 'manual',
      ...(authorized ? { headers: { Authorization: `Bearer ${options.bearerAuthorization!.token.trim()}` } } : {}),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('media_redirect_missing_location');
    parsed = new URL(location, parsed);
    if (redirect === 3) throw new Error('media_redirect_limit_exceeded');
  }
  if (!response) throw new Error('media_download_failed:no_response');
  if (!response.ok) throw new Error(`media_download_failed:${response.status}`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('media_download_exceeds_byte_limit');
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? 'application/octet-stream';
  if (!mimeType.startsWith('video/') && mimeType !== 'application/octet-stream') {
    throw new Error(`media_download_rejected_mime_type:${mimeType}`);
  }
  const bytes = await readResponseWithLimit(response, maxBytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const extension = mediaExtension(mimeType);
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_SEMANTIC_ARTIFACT_DIR);
  const target = path.join(rootDir, 'media', sha256.slice(0, 2), `${sha256}${extension}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: 'wx' });
  return { source_url: parsed.toString(), local_path: target, sha256, bytes: bytes.length, mime_type: mimeType };
}

export function writeRawActorArtifact(
  requestId: string,
  platform: SocialPlatform,
  value: unknown,
  rootDir = DEFAULT_SEMANTIC_ARTIFACT_DIR,
): string {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  const target = path.resolve(rootDir, 'raw', safePathSegment(requestId), platform, `${hash}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, serialized, { flag: 'wx' });
  return target;
}

function normalizeActorItem(
  request: UrlIntakeRequest,
  platform: SocialPlatform,
  item: Record<string, unknown>,
  provenance: ActorProvenance,
): NormalizedSocialPost {
  const supplied = firstText(item, ['url', 'postUrl', 'webVideoUrl', 'canonicalUrl', 'videoUrl'])
    ?? request.urls.find((url) => normalizePublicPostUrl(url).platform === platform);
  if (!supplied) throw new Error('Actor item is missing a supplied post URL.');
  const normalizedUrl = normalizePublicPostUrl(supplied);
  if (normalizedUrl.platform !== platform) throw new Error('Actor result platform does not match the requested platform.');
  if (!request.urls.includes(normalizedUrl.canonical_url)) {
    throw new Error('Actor returned a post outside the operator-supplied URL set. Discovery crawling is not allowed.');
  }
  const collectedAt = provenance.collected_at ?? new Date().toISOString();
  const evidenceId = `${platform}:post:${normalizedUrl.platform_post_id}`;
  const author = expectOptionalRecord(firstValue(item, ['authorMeta', 'author', 'owner', 'channel']));
  const handle = firstText(author, ['name', 'uniqueId', 'username', 'handle', 'channelTitle'])
    ?? firstText(item, ['authorName', 'username', 'ownerUsername', 'channelTitle'])
    ?? 'unknown';
  const comments = firstArray(item, ['comments', 'latestComments', 'commentList', 'topComments']) ?? [];
  const caption = firstText(item, ['text', 'caption', 'description', 'title']) ?? '';
  const mediaUrl = firstText(item, ['videoUrl', 'video_url', 'downloadUrl', 'downloadAddr', 'mediaUrl', 'videoPlayUrl'])
    ?? firstTextFromArray(item, ['mediaUrls', 'media_urls']);
  const hashtags = unique([
    ...extractHashtags(caption),
    ...(firstArray(item, ['hashtags', 'tags']) ?? []).flatMap((tag) => typeof tag === 'string'
      ? [tag]
      : [firstText(expectOptionalRecord(tag), ['name', 'title', 'hashtag']) ?? '']),
  ].filter(Boolean).map((tag) => normalizedHashtag(tag)));
  const accountId = firstText(author, ['id', 'userId', 'channelId']) ?? null;
  const metricSnapshot: SocialMetricSnapshot = {
    captured_at: collectedAt,
    views: firstNumber(item, ['playCount', 'viewCount', 'views', 'videoPlayCount', 'videoViewCount']),
    likes: firstNumber(item, ['diggCount', 'likeCount', 'likes', 'likesCount']),
    comments: firstNumber(item, ['commentCount', 'commentsCount']),
    shares: firstNumber(item, ['shareCount', 'shares']),
    saves: firstNumber(item, ['collectCount', 'saveCount', 'saves']),
    follows: firstNumber(item, ['followCount', 'follows']),
    profile_visits: firstNumber(item, ['profileVisitCount', 'profileVisits']),
    dms: firstNumber(item, ['dmCount', 'dms']),
    view_velocity: firstNumber(item, ['viewVelocity', 'viewsPerHour']),
    checkpoint: 'public_one_time',
    source_kind: 'public_snapshot',
  };
  const post: NormalizedSocialPost = {
    evidence_id: evidenceId,
    request_id: request.request_id,
    platform,
    platform_post_id: normalizedUrl.platform_post_id,
    canonical_url: normalizedUrl.canonical_url,
    content_type: 'short_video',
    caption,
    posted_at: normalizeDate(firstValue(item, ['createTimeISO', 'publishedAt', 'timestamp', 'takenAt', 'createTime'])),
    collected_at: collectedAt,
    account: {
      evidence_id: `${platform}:account:${accountId ?? handle.toLowerCase()}`,
      platform,
      platform_account_id: accountId,
      handle,
      display_name: firstText(author, ['nickName', 'nickname', 'displayName', 'name', 'channelTitle']) ?? handle,
      bio: firstText(author, ['signature', 'bio', 'description']) ?? '',
      canonical_url: firstText(author, ['profileUrl', 'url', 'channelUrl']) ?? null,
    },
    hashtags,
    comments: selectComments(comments, request.comment_policy, evidenceId),
    metric_snapshot: metricSnapshot,
    media: {
      source_url: mediaUrl ?? null,
      local_path: null,
      sha256: null,
      bytes: null,
      mime_type: null,
    },
    provenance: {
      apify_actor_id: provenance.actor_id,
      apify_actor_build_id: provenance.actor_build_id ?? null,
      apify_actor_build_number: provenance.actor_build_number ?? null,
      apify_actor_input_sha256: provenance.actor_input_sha256 ?? null,
      apify_actor_input_mode: provenance.actor_input_mode ?? 'explicit_url',
      apify_run_id: provenance.run_id,
      apify_dataset_id: provenance.dataset_id,
      apify_dataset_item_offset: provenance.dataset_item_offset ?? 0,
      raw_item_sha256: provenance.raw_item_sha256 ?? crypto.createHash('sha256').update(canonicalJson(item)).digest('hex'),
      raw_artifact_path: provenance.raw_artifact_path,
    },
    partial_text_only: !mediaUrl,
    evidence_limitations: mediaUrl ? [] : ['Actor result did not include a direct video asset; text evidence was retained.'],
  };
  return post;
}

function flattenComments(input: unknown[], postEvidenceId: string): SocialComment[] {
  const output: SocialComment[] = [];
  const visit = (raw: unknown, parentId: string | null, rootId: string | null): void => {
    const record = expectOptionalRecord(raw);
    const text = firstText(record, ['text', 'comment', 'content', 'message']);
    if (!text) return;
    const sourceId = firstText(record, ['id', 'commentId', 'cid'])
      ?? crypto.createHash('sha256').update(`${firstText(record, ['username', 'authorName']) ?? ''}:${text}`).digest('hex').slice(0, 20);
    const currentRoot = rootId ?? sourceId;
    output.push({
      evidence_id: `${postEvidenceId}:comment:${sourceId}`,
      platform_comment_id: sourceId,
      parent_comment_id: parentId,
      thread_root_id: currentRoot,
      author_handle: firstText(record, ['username', 'authorName', 'author', 'ownerUsername']) ?? 'unknown',
      text,
      like_count: firstNumber(record, ['diggCount', 'likeCount', 'likes', 'likesCount']) ?? 0,
      reply_count: firstNumber(record, ['replyCount', 'repliesCount']) ?? 0,
      created_at: normalizeDate(firstValue(record, ['createTimeISO', 'createdAtIso', 'createdAt', 'timestamp', 'createTime'])),
      selection_reason: 'recent',
    });
    const replies = firstArray(record, ['replies', 'replyComments', 'children']) ?? [];
    replies.forEach((reply) => visit(reply, sourceId, currentRoot));
  };
  input.forEach((comment) => visit(comment, null, null));
  return output;
}

function deduplicateComments(comments: SocialComment[]): SocialComment[] {
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  return comments.filter((comment) => {
    const contentKey = `${comment.author_handle.trim().toLowerCase()}|${comment.text.trim().toLowerCase().replace(/\s+/g, ' ')}|${comment.parent_comment_id ?? ''}`;
    if (seenIds.has(comment.platform_comment_id) || seenContent.has(contentKey)) return false;
    seenIds.add(comment.platform_comment_id);
    seenContent.add(contentKey);
    return true;
  });
}

function metricValue(row: PerformanceRecord, metric: CoasMetric): number | null {
  const raw = row[metric];
  if (!isNumber(raw) || raw < 0) return null;
  if (metric === 'view_velocity') return raw;
  if (!isNumber(row.views) || row.views <= 0) return null;
  return raw / row.views;
}

function percentileRank(target: number, values: number[]): number {
  const less = values.filter((value) => value < target).length;
  const equal = values.filter((value) => value === target).length;
  return ((less + equal * 0.5) / values.length) * 100;
}

function ftsQuery(dbPath: string, query: string): Array<{ item_id: string; score: number }> {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!tokens.length) return [];
  const expression = unique(tokens).map((token) => `\"${token.replace(/\"/g, '\"\"')}\"`).join(' OR ');
  try {
    return sqliteJson<{ item_id: string; score: number }>(dbPath, `
      SELECT item_id, bm25(semantic_items_fts) AS score
      FROM semantic_items_fts WHERE semantic_items_fts MATCH ${sqlString(expression)}
      ORDER BY score ASC, item_id ASC LIMIT 200;
    `);
  } catch {
    return [];
  }
}

function matchesSemanticFilters(row: SemanticRow, filters: SemanticSearchQuery['filters']): boolean {
  if (!filters) return true;
  if (filters.platforms?.length && !filters.platforms.includes(row.platform)) return false;
  if (filters.accounts?.length && !filters.accounts.some((account) => account.toLowerCase() === row.account_handle.toLowerCase())) return false;
  const tags = parseStringArray(row.hashtags_json).map(normalizedHashtag);
  if (filters.hashtags?.length && !filters.hashtags.every((tag) => tags.includes(normalizedHashtag(tag)))) return false;
  const created = timestamp(row.created_at);
  if (filters.date_from && created < timestamp(filters.date_from)) return false;
  if (filters.date_to && created > timestamp(filters.date_to)) return false;
  return true;
}

function timestampedUrl(url: string, startSec: number | null): string {
  if (startSec === null || startSec <= 0) return url;
  const separator = url.includes('#') ? '&' : '#';
  return `${url}${separator}t=${Math.floor(startSec)}s`;
}

function freshnessScore(createdAt: string, now = Date.now()): number {
  const ageDays = Math.max(0, (now - timestamp(createdAt)) / 86_400_000);
  return clamp01(Math.exp(-ageDays / 30));
}

function validateTimedRange(value: unknown, duration: number, field: string): void {
  const record = expectRecord(value, field);
  const start = Number(record.start_sec);
  const end = Number(record.end_sec);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + 0.01) {
    throw new Error(`${field} must have a valid timestamp range within the video duration.`);
  }
}

function sqliteExec(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function sqliteJson<T>(dbPath: string, sql: string): T[] {
  const output = execFileSync('sqlite3', ['-json', dbPath], { input: sql, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }).trim();
  return output ? JSON.parse(output) as T[] : [];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sqlValues(values: Array<unknown | { blob: Buffer }>): string {
  return values.map((value) => {
    if (value && typeof value === 'object' && 'blob' in value) {
      return `X'${(value as { blob: Buffer }).blob.toString('hex')}'`;
    }
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
    return sqlString(value);
  }).join(', ');
}

function sqlString(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function expectOptionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function requiredTextArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || !value.length) throw new Error(`${field} must be a non-empty array.`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) throw new Error(`${field}[${index}] must be a non-empty string.`);
    return entry.trim();
  });
}

function requiredBoolean(record: Record<string, unknown>, field: string): boolean {
  if (typeof record[field] !== 'boolean') throw new Error(`${field} must be a boolean.`);
  return record[field] as boolean;
}

function boundedInteger(record: Record<string, unknown>, field: string, min: number, max: number): number {
  const value = Number(record[field]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer between ${min} and ${max}.`);
  return value;
}

function nonNegativeNumber(record: Record<string, unknown>, field: string): number {
  const value = Number(record[field]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number.`);
  return value;
}

function oneOf<const T extends readonly string[]>(value: string, choices: T, field: string): T[number] {
  if (!choices.includes(value as T[number])) throw new Error(`${field} must be one of: ${choices.join(', ')}.`);
  return value as T[number];
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function firstText(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = firstValue(record, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  const value = firstValue(record, keys);
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstArray(record: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  const value = firstValue(record, keys);
  return Array.isArray(value) ? value : undefined;
}

function firstTextFromArray(record: Record<string, unknown>, keys: string[]): string | undefined {
  const values = firstArray(record, keys);
  if (!values) return undefined;
  return values.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))?.trim();
}

function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => match[1]);
}

function normalizedHashtag(value: string): string {
  return value.trim().replace(/^#+/, '').toLowerCase();
}

function normalizeDate(value: unknown): string | null {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
    const numeric = Number(value);
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function mediaExtension(mimeType: string): string {
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'video/webm') return '.webm';
  if (mimeType === 'video/quicktime') return '.mov';
  return '.bin';
}

async function assertPublicDownloadUrl(
  url: URL,
  lookupHost: (hostname: string) => Promise<Array<{ address: string; family: number }>>,
): Promise<void> {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Media downloads require a credential-free public HTTPS URL on the default port.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('media_download_private_host_blocked');
  }
  const literal = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookupHost(hostname);
  if (!literal.length || literal.some((record) => isPrivateAddress(record.address))) {
    throw new Error('media_download_private_address_blocked');
  }
}

function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true;
  }
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const candidate = mapped ?? address;
  if (isIP(candidate) !== 4) return false;
  const parts = candidate.split('.').map(Number);
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('media byte limit exceeded');
      throw new Error('media_download_exceeds_byte_limit');
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function nonEmpty(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function safePathSegment(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!clean || clean === '.' || clean === '..') throw new Error('Artifact identifier has no safe path representation.');
  return clean;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function stableTextCompare(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableNumber(value: unknown): number | null {
  return isNumber(value) ? value : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
