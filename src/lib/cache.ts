/**
 * Redis/Valkey cache with a transparent no-op fallback.
 *
 * When `config.redisUrl` is unset OR the connection is unavailable, every call
 * degrades to a near-zero-cost no-op so existing features are unaffected — the
 * cache is a pure optimization and never a hard dependency.
 */
import Redis from 'ioredis';
import { config } from './config';
import { logger } from './logger';

let client: Redis | null = null;
let connecting: Promise<boolean> | null = null;

/**
 * When the next connection attempt is allowed, or 0 for "now".
 *
 * This replaces a plain `unavailable` flag. Worth being precise about what that
 * flag actually did, because the obvious reading of it ("the cache is disabled
 * forever once it fails") is wrong and has been observed to be wrong: ioredis
 * retries the existing socket on its own `retryStrategy`, fires `ready` when the
 * dependency returns, and that event cleared the flag. The deployed app recovered
 * on its own after `workspace_valkey` came back.
 *
 * So the flag was doing its job — suppressing new connection attempts while the
 * dependency was down — and the real defects were narrower:
 *
 *   1. The failing client was never disconnected. It kept its retry loop alive
 *      after the flag was cleared, orphaning one live ioredis instance per outage
 *      cycle while new clients were being created alongside it. `disconnect()` on
 *      failure is what actually ends it.
 *   2. No `connectTimeout` and no `commandTimeout`. A socket that accepts and
 *      then stalls is not a failed connection, so the retry policy never saw it
 *      and the caller's own deadline was the only thing bounding it.
 *   3. Backoff lived in ioredis's `retryStrategy` rather than in this module, so
 *      it was not observable, not assertable, and not shared with the code that
 *      decides whether to attempt a connection at all.
 *
 * The backoff is exponential with a ceiling because a Redis that is down should
 * not be probed once per cache lookup — that turns a dependency outage into a
 * connection-storm amplifier.
 */
let retryAfter = 0;
let failureCount = 0;

/**
 * How long until the next connection attempt is allowed, or 0 for "now".
 *
 * Exposed for tests: recovering after a failure is the behaviour most likely to
 * regress, because the regression is invisible while the dependency happens to be
 * up. A test that brings a fake Redis back mid-run and asserts the cache resumes
 * is the only thing that keeps the backoff from quietly becoming permanent again.
 */
export function cacheRetryDelayMs(): number {
  return Math.max(0, retryAfter - Date.now());
}

/** Test seam: forget the client and the backoff, as a fresh process would. */
export function resetCacheConnectionForTests(): void {
  client?.disconnect();
  client = null;
  connecting = null;
  retryAfter = 0;
  failureCount = 0;
}

/**
 * Test seam: drop the client but keep the backoff state.
 *
 * Separate from {@link resetCacheConnectionForTests} because the two test
 * different things. Resetting everything models a restart, which is how the
 * recovery test brings the dependency back. Keeping the backoff models another
 * attempt against a dependency that is still down — which is the only way to
 * observe the delay actually growing, since a full reset would zero the counter
 * being measured.
 */
export function clearCacheClientForTests(): void {
  client?.disconnect();
  client = null;
  connecting = null;
}

/**
 * Test seam: replace the connection factory.
 *
 * The retry policy is the part under test; ioredis is not. Substituting the
 * constructor keeps the assertion about backoff and recovery rather than about
 * whether a real server accepted a TCP connection.
 */
export function setCacheConnectorForTests(
  factory: (url: string) => Redis | null
): void {
  connectFactory = factory;
  resetCacheConnectionForTests();
}

let connectFactory: (url: string) => Redis | null = () => new Redis(config.redisUrl, {
  keyPrefix: 'ws:',
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  // The caller bounds its own deadline as well; this only stops ioredis from
  // parking a socket open on its own schedule.
  commandTimeout: 1000,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

let retryBaseMs = 500;
let retryMaxMs = 30_000;

/**
 * Test seam: shrink the backoff schedule.
 *
 * The growth of the schedule is real behaviour worth asserting, but asserting it
 * through wall-clock waits costs ~90s for eight attempts because each attempt has
 * to outlast the delay the previous one installed. Making the schedule injectable
 * keeps the assertion about the policy — exponential, then capped — instead of
 * about how long the test is willing to sleep.
 */
export function setCacheBackoffForTests(baseMs: number, maxMs: number): void {
  retryBaseMs = baseMs;
  retryMaxMs = maxMs;
  retryAfter = 0;
  failureCount = 0;
}

function scheduleRetry(): void {
  failureCount++;
  const delay = Math.min(retryBaseMs * 2 ** (failureCount - 1), retryMaxMs);
  retryAfter = Date.now() + delay;
}

async function redis(): Promise<Redis | null> {
  if (!config.redisUrl) return null;
  const now = Date.now();
  if (client) return client;
  if (now < retryAfter) return null;
  if (connecting) return (await connecting) ? client : null;

  connecting = (async () => {
    const c = connectFactory(config.redisUrl);
    if (!c) {
      scheduleRetry();
      return false;
    }
    c.on('error', (err: Error) => {
      client = null;
      logger.warn({ err: err.message }, '[cache] redis unavailable — degrading to no-op');
    });
    c.on('ready', () => {
      client = c;
      failureCount = 0;
      retryAfter = 0;
      logger.info('[cache] redis ready');
    });
    try {
      await c.connect();
      if (c.status === 'ready') client = c;
      return true;
    } catch {
      scheduleRetry();
      c.disconnect();
      return false;
    } finally {
      connecting = null;
    }
  })();

  const ok = await connecting;
  return ok ? client : null;
}

/** Get a cached string value (undefined = miss). Never throws. */
export async function cacheGet(key: string): Promise<string | undefined> {
  const c = await redis();
  if (!c) return undefined;
  try {
    return (await c.get(key)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Read multiple cached strings in one Redis pipeline. Never throws. */
export async function cacheGetMany(keys: string[]): Promise<(string | undefined)[]> {
  if (keys.length === 0) return [];
  const c = await redis();
  if (!c) return keys.map(() => undefined);
  try {
    const pipeline = c.pipeline();
    for (const key of keys) pipeline.get(key);
    const results = await pipeline.exec();
    if (!results) return keys.map(() => undefined);
    return keys.map((_, index) => {
      const [error, value] = results[index] ?? [];
      return error || value == null ? undefined : String(value);
    });
  } catch {
    return keys.map(() => undefined);
  }
}

/** Set a cache entry with TTL seconds. Never throws. */
export async function cacheSet(key: string, value: string, ttlSec = 60): Promise<void> {
  const c = await redis();
  if (!c) return;
  try {
    await c.set(key, value, 'EX', ttlSec);
  } catch {
    /* no-op */
  }
}

/** Write multiple cached strings with one Redis pipeline. Never throws. */
export async function cacheSetMany(
  entries: Array<[key: string, value: string]>,
  ttlSec = 60
): Promise<void> {
  if (entries.length === 0) return;
  const c = await redis();
  if (!c) return;
  try {
    const pipeline = c.pipeline();
    for (const [key, value] of entries) pipeline.set(key, value, 'EX', ttlSec);
    await pipeline.exec();
  } catch {
    /* no-op */
  }
}

/**
 * Atomically increment a counter, returning the new value (`null` when Redis is
 * unavailable).
 *
 * Exists for generation-counter cache invalidation, where the counter is part of
 * the cache key and a read-modify-write in the application would lose
 * concurrent bumps. `INCR` is the only way to make "invalidate everything"
 * atomic against writers that overlap.
 *
 * Never throws, and never returns a value the caller could mistake for a real
 * one: on failure it returns `null` rather than `0`, because `0` is a legitimate
 * epoch.
 */
export async function cacheIncr(key: string): Promise<number | null> {
  const c = await redis();
  if (!c) return null;
  try {
    return await c.incr(key);
  } catch {
    return null;
  }
}

/** Read a counter written by {@link cacheIncr}. `null` when absent or unavailable. */
export async function cacheGetCounter(key: string): Promise<number | null> {
  const c = await redis();
  if (!c) return null;
  try {
    const raw = await c.get(key);
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Whether the backing store is usable right now.
 *
 * Distinct from {@link cacheGetCounter}, which answers "what is the counter" and
 * reports absent and unreachable identically. Callers that must tell those apart
 * — anything deciding whether a cached value can still be trusted — need this
 * instead of inferring reachability from a null value, because `null` is itself a
 * perfectly valid counter state.
 */
export async function cacheReachability(): Promise<{ available: boolean }> {
  const c = await redis();
  if (!c) return { available: false };
  try {
    return { available: (await c.ping()) === 'PONG' };
  } catch {
    return { available: false };
  }
}

/** Invalidate one or more keys. Never throws. */
export async function cacheDel(...keys: string[]): Promise<void> {
  const c = await redis();
  if (!c) return;
  try {
    if (keys.length) await c.del(...keys);
  } catch {
    /* no-op */
  }
}

/** Invalidate all keys with a shared prefix (e.g. `folder:list:`). Never throws. */
export async function cacheDelByPrefix(prefix: string): Promise<void> {
  const c = await redis();
  if (!c) return;
  try {
    const stream = c.scanStream({ match: `${prefix}*`, count: 100 });
    const keys: string[] = [];
    for await (const batch of stream) keys.push(...(batch as string[]));
    if (keys.length) await c.del(...keys);
  } catch {
    /* no-op */
  }
}

/** JSON helpers with same no-op semantics. */
export async function cacheGetJson<T>(key: string): Promise<T | undefined> {
  const raw = await cacheGet(key);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function cacheSetJson<T>(key: string, value: T, ttlSec = 60): Promise<void> {
  try {
    await cacheSet(key, JSON.stringify(value), ttlSec);
  } catch {
    /* no-op */
  }
}

/** Session denylist: record a revoked token `jti` until it would expire. */
export async function denyJwt(jti: string, ttlSec: number): Promise<void> {
  const c = await redis();
  if (!c) return;
  try {
    await c.set(`deny:jti:${jti}`, '1', 'EX', Math.min(ttlSec, 60 * 60 * 24));
  } catch {
    /* no-op */
  }
}

export async function isJwtDenied(jti: string): Promise<boolean> {
  const c = await redis();
  if (!c) return false;
  try {
    return (await c.exists(`deny:jti:${jti}`)) === 1;
  } catch {
    return false;
  }
}

/** Connection status for /readyz. */
export async function cachePing(): Promise<boolean> {
  const c = await redis();
  if (!c) return true; // cache is optional — not a blocker
  try {
    return (await c.ping()) === 'PONG';
  } catch {
    return false;
  }
}
