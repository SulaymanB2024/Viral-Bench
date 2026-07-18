import { randomUUID } from 'node:crypto';

import { Redis } from '@upstash/redis';

import type { RateLimitResult } from './types.js';

const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset = now + window
  if oldest[2] then reset = tonumber(oldest[2]) + window end
  return {0, count, reset}
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, math.ceil(window / 1000))
return {1, count + 1, now + window}
`;

export interface AgentStateStore {
  rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  revokeSession(jti: string, ttlSeconds: number): Promise<void>;
  isSessionRevoked(jti: string): Promise<boolean>;
}

export class RedisAgentStateStore implements AgentStateStore {
  readonly #redis: Redis;
  readonly #namespace: string;

  constructor(redis: Redis, namespace = 'viralbench:agent') {
    this.#redis = redis;
    this.#namespace = namespace;
  }

  async rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const result = await this.#redis.eval(
      RATE_LIMIT_SCRIPT,
      [`${this.#namespace}:rate:${key}`],
      [now, windowMs, limit, `${now}:${randomUUID()}`],
    ) as Array<number | string>;
    const allowed = Number(result[0]) === 1;
    const count = Number(result[1] ?? limit);
    const reset = Number(result[2] ?? now + windowMs);
    return {
      allowed,
      count,
      remaining: Math.max(0, limit - count),
      reset_at: new Date(reset).toISOString(),
    };
  }

  async getJson<T>(key: string): Promise<T | null> {
    return await this.#redis.get<T>(`${this.#namespace}:cache:${key}`);
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.#redis.set(`${this.#namespace}:cache:${key}`, value, { ex: ttlSeconds });
  }

  async revokeSession(jti: string, ttlSeconds: number): Promise<void> {
    await this.#redis.set(`${this.#namespace}:revoked:${jti}`, '1', { ex: ttlSeconds });
  }

  async isSessionRevoked(jti: string): Promise<boolean> {
    return Boolean(await this.#redis.exists(`${this.#namespace}:revoked:${jti}`));
  }
}

export function createAgentStateStore(
  env: NodeJS.ProcessEnv = process.env,
): AgentStateStore | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() || env.KV_REST_API_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() || env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) return null;
  return new RedisAgentStateStore(new Redis({ url, token }));
}

export class MemoryAgentStateStore implements AgentStateStore {
  readonly #windows = new Map<string, number[]>();
  readonly #cache = new Map<string, { expires: number; value: unknown }>();
  readonly #revoked = new Map<string, number>();

  async rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const active = (this.#windows.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
    const allowed = active.length < limit;
    if (allowed) active.push(now);
    this.#windows.set(key, active);
    return {
      allowed,
      count: active.length,
      remaining: Math.max(0, limit - active.length),
      reset_at: new Date((active[0] ?? now) + windowMs).toISOString(),
    };
  }

  async getJson<T>(key: string): Promise<T | null> {
    const entry = this.#cache.get(key);
    if (!entry || entry.expires <= Date.now()) {
      this.#cache.delete(key);
      return null;
    }
    return structuredClone(entry.value) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.#cache.set(key, { expires: Date.now() + ttlSeconds * 1_000, value: structuredClone(value) });
  }

  async revokeSession(jti: string, ttlSeconds: number): Promise<void> {
    this.#revoked.set(jti, Date.now() + ttlSeconds * 1_000);
  }

  async isSessionRevoked(jti: string): Promise<boolean> {
    const expires = this.#revoked.get(jti) ?? 0;
    if (expires <= Date.now()) {
      this.#revoked.delete(jti);
      return false;
    }
    return true;
  }
}
