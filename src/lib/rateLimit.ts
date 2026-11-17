/**
 * Token-bucket rate limiter.
 *
 * - Uses Redis (INCR + EXPIRE) for correctness across instances.
 * - Falls back to an in-process fixed-window when Redis is unavailable, which
 *   keeps local/non-scale deployments working with a per-process guarantee.
 * - Never throws — on any failure the request is allowed through.
 */
import Redis from 'ioredis';
import { config } from './config';
import { cachePing } from './cache';
import { logger } from './logger';

let redis: Redis | null = null;

async function getRedis(): Promise<Redis | null> {
  if (redis) return redis;
  if (!config.redisUrl || !(await cachePing())) return null;
  redis = new Redis(config.redisUrl, {
    keyPrefix: 'ws:rl:',
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('error', () => {
    redis = null;
  });
  await redis.connect().catch(() => {
    redis = null;
  });
  return redis;
}

// In-memory fallback (per-process window approximation)
const memory: Map<string, { count: number; resetAt: number }> = new Map();

export interface RateLimitDecision {
  allowed: boolean;
  /** seconds until the bucket resets (for Retry-After) */
  retryAfterSec: number;
  remaining: number;
}

export interface RateLimitRule {
  /** unique rule key, e.g. 'auth:login:ip' */
  key: string;
  limit: number;
  windowSec: number;
}

export async function consumeRateLimit(rule: RateLimitRule): Promise<RateLimitDecision> {
  try {
    const r = await getRedis();
    if (r) {
      const fullKey = rule.key;
      const now = Math.floor(Date.now() / 1000);
      const res = await r
        .multi()
        .incr(fullKey)
        .expire(fullKey, rule.windowSec, 'NX')
        .ttl(fullKey)
        .exec();
      const count = Number(res?.[0]?.[1] ?? 0);
      const ttl = Number(res?.[2]?.[1] ?? rule.windowSec);
      return {
        allowed: count <= rule.limit,
        retryAfterSec: Math.max(1, ttl),
        remaining: Math.max(0, rule.limit - count),
      };
    }
  } catch (err) {
    logger.debug({ err: (err as Error).message, key: rule.key }, '[rate-limit] redis failed — fallback');
  }

  // In-memory fallback
  const now = Date.now();
  const existing = memory.get(rule.key);
  if (!existing || existing.resetAt <= now) {
    memory.set(rule.key, { count: 1, resetAt: now + rule.windowSec * 1000 });
    return { allowed: true, retryAfterSec: rule.windowSec, remaining: rule.limit - 1 };
  }
  existing.count += 1;
  if (existing.count > 5000) memory.clear(); // guard against unbounded growth
  return {
    allowed: existing.count <= rule.limit,
    retryAfterSec: Math.max(1, Math.round((existing.resetAt - now) / 1000)),
    remaining: Math.max(0, rule.limit - existing.count),
  };
}