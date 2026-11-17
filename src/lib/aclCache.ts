/**
 * Generation-counter cache for OpenFGA `Check` decisions.
 *
 * ── Why a cache at all, and why this shape ─────────────────────────────────
 *
 * Every listing route runs one `Check` per resource. The homepage selects the
 * whole `resources` table with no `LIMIT` and filters it in the application, so
 * an anonymous render is 939 engine calls. Those used to go out through a single
 * `Promise.all`, i.e. all at once, which saturates OpenFGA and the Postgres
 * instance behind it until every one of them hits the 10s client timeout —
 * ~300s per page load, far past any tunnel or browser timeout, which surfaced
 * publicly as a Cloudflare 502 rather than as a slow site.
 *
 * OpenFGA has no cache and no change feed. The application uses `BatchCheck` to
 * reduce engine requests and this generation cache to avoid repeating decisions
 * across requests. Cache reads and writes are pipelined so the optimization does
 * not replace one authorization fan-out with a Redis round-trip fan-out.
 *
 * ── Why a generation counter and not targeted deletion ──────────────────────
 *
 * A grant is not local to one key. Writing `(user, viewer, folder:F)` changes
 * the answer for `user` on every descendant of `F`, and it changes the answer
 * for every subject the model can reach, including `user:*`. Computing that
 * closure to delete "just the affected keys" is both expensive and — far worse
 * — easy to get subtly wrong, and a missed key is a stale authorization that
 * outlives the change that invalidated it.
 *
 * So the counter is the unit of invalidation. Every cached entry embeds the
 * epoch it was computed under; any tuple write bumps the epoch, which makes
 * every pre-existing entry unreachable in one atomic `INCR`. There is no
 * dependency graph to get wrong, no `SCAN` fan-out, and no window in which a
 * write has landed but the old answers are still reachable.
 *
 * ── What this costs, stated plainly ────────────────────────────────────────
 *
 * A cached `allowed: true` survives until the next bump or TTL. Revocations
 * performed through the application therefore take effect immediately, because
 * every runtime write funnels through `openfga.ts`. Revocations performed by an
 * out-of-band script do not, until the TTL expires — so out-of-band writers must
 * call {@link bumpAclCacheEpoch}, and {@link FGA_CACHE_TTL_SECONDS} is the
 * backstop for anything that forgets. Raising the TTL trades correctness for
 * load; that is the knob, deliberately, rather than a hidden default.
 */
import {
  cacheGet,
  cacheGetMany,
  cacheSet,
  cacheSetMany,
  cacheIncr,
  cacheGetCounter,
  cacheReachability,
} from './cache';
import { logger } from './logger';

/**
 * Redis key holding the current generation. Incremented, never reset — a
 * monotonically increasing counter means a stale process holding an old value
 * can never make a fresh entry look current.
 */
// One Redis may serve multiple OpenFGA stores (local dev, E2E, staging). Their
// decisions and invalidation generations must never share a namespace.
const CACHE_NAMESPACE = process.env.OPENFGA_STORE_ID || 'default';
const EPOCH_KEY = `acl:epoch:${CACHE_NAMESPACE}`;

/** Version tag: bump to abandon every entry written by an older key layout. */
const CACHE_VERSION = 'v1';

/**
 * Backstop TTL for entries whose epoch cannot be invalidated in time.
 *
 * Only ever binds entries written by writers that bypass `bumpAclCacheEpoch`,
 * which by design means out-of-band scripts. 60s is short enough that an
 * operator who forgets to bump recovers quickly, and long enough to absorb the
 * read traffic of a normal browsing session.
 */
export const FGA_CACHE_TTL_SECONDS = Number.parseInt(process.env.FGA_CACHE_TTL_SECONDS || '60', 10);

/**
 * TTL for entries whose writes all go through the epoch bump.
 *
 * Redis evicts on its own; a long TTL here is not a correctness risk because the
 * epoch, not the TTL, is what enforces invalidation. It bounds memory growth and
 * nothing else.
 */
const CACHE_TTL_HARD_SECONDS = 60 * 60 * 24;

/** Whether the epoch has been resolved in this process recently. */
let knownEpoch: number | null = null;
let knownEpochAt = 0;

/**
 * How long a resolved epoch may be reused in-process.
 *
 * Deliberately short. A local epoch lets the hot path skip a Redis round trip,
 * but reusing a stale one would delay a revocation by up to this interval — so
 * this is bounded by the same reasoning as the TTL, just tighter. Writes bump
 * the in-process copy immediately, so only out-of-band changes are affected.
 */
const EPOCH_LOCAL_TTL_MS = 5_000;

export interface AclCacheKey {
  user: string;
  relation: string;
  object: string;
}

function encodeKey(epoch: number, { user, relation, object }: AclCacheKey): string {
  return `aclc:${CACHE_VERSION}:${CACHE_NAMESPACE}:${epoch}:${relation}:${user}|${object}`;
}

/**
 * Current epoch, or `null` when it cannot be established.
 *
 * `null` is the load-bearing case: it means "I cannot prove these entries are
 * still valid", and every caller treats it as a full cache bypass. Falling back
 * to a remembered epoch on Redis failure would quietly resurrect answers that a
 * revocation may have already invalidated, which is the one failure mode this
 * module exists to prevent — a cache that fails open.
 */
async function currentEpoch(): Promise<number | null> {
  const now = Date.now();
  if (knownEpoch !== null && now - knownEpochAt < EPOCH_LOCAL_TTL_MS) {
    return knownEpoch;
  }
  const read = await store.getCounter(EPOCH_KEY);
  if (!read.reachable) {
    // Redis is unreachable. `null` is the load-bearing answer here: it means
    // "these entries cannot be proven current", and every caller treats it as a
    // full cache bypass so the engine is consulted instead.
    //
    // Returning a remembered epoch instead — or collapsing "unreachable" into
    // "absent, therefore 0" — would resurrect answers computed before an outage
    // that may have spanned a revocation. That is a cache that fails OPEN, which
    // is the one failure mode this module exists to prevent.
    knownEpoch = null;
    return null;
  }
  // Absent is a legitimate epoch: `INCR` creates the key at 1, so 0 is the state
  // before anything has ever been written.
  knownEpoch = read.value ?? 0;
  knownEpochAt = now;
  return knownEpoch;
}

/**
 * The primitives `aclCache` needs from its backing store.
 *
 * Exists as an explicit seam for the same reason `FilterViewableOptions.check`
 * does: the behaviour that matters here — that a write makes every prior answer
 * unreachable — lives in the interaction between the epoch and the key, and can
 * only be asserted against a store whose contents the test can read back. The
 * alternative, standing up a real Redis, tests the Redis client rather than the
 * invalidation.
 */
export type CounterRead =
  /** Store answered. `value: null` means the key is absent, i.e. epoch 0. */
  | { reachable: true; value: number | null }
  /** Store could not be reached. Entries written earlier cannot be verified. */
  | { reachable: false };

export interface AclCacheStore {
  get(key: string): Promise<string | undefined>;
  getMany?(keys: string[]): Promise<(string | undefined)[]>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  setMany?(entries: Array<[key: string, value: string]>, ttlSec: number): Promise<void>;
  incr(key: string): Promise<number | null>;
  getCounter(key: string): Promise<CounterRead>;
}

const redisStore: AclCacheStore = {
  get: cacheGet,
  getMany: cacheGetMany,
  set: cacheSet,
  setMany: cacheSetMany,
  incr: cacheIncr,
  async getCounter(key) {
    const value = await cacheGetCounter(key);
    // `cacheGetCounter` collapses "absent" and "unreachable" into one null,
    // which is not good enough here: absent is a legitimate epoch (0), while
    // unreachable means the cache must not be trusted at all. It is re-read
    // directly for that distinction, at the cost of one extra round trip on a
    // path whose result is memoised for several seconds.
    const { available } = await cacheReachability();
    if (!available) return { reachable: false };
    return { reachable: true, value };
  },
};

let store: AclCacheStore = redisStore;

/** Test seam: swap the backing store. Pass `null` to restore Redis. */
export function setAclCacheStore(next: AclCacheStore | null): void {
  store = next ?? redisStore;
  resetAclCacheEpochMemo();
}

/** Test seam: forget the locally remembered epoch so the next read re-resolves. */
export function resetAclCacheEpochMemo(): void {
  knownEpoch = null;
  knownEpochAt = 0;
}

/**
 * In-memory {@link AclCacheStore}, for tests.
 *
 * `initialEpoch` starts from `null` (key never written) or a number, which is
 * the state that distinguishes "counter absent" from "counter at zero".
 */
export function createMemoryAclStore(initialEpoch: number | null = null): AclCacheStore & { size(): number } {
  const data = new Map<string, string>();
  let counter = initialEpoch;
  return {
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      data.set(key, value);
    },
    async getMany(keys) {
      return keys.map((key) => data.get(key));
    },
    async setMany(entries) {
      for (const [key, value] of entries) data.set(key, value);
    },
    async incr(key) {
      if (counter === null) counter = 0;
      counter += 1;
      void key;
      return counter;
    },
    async getCounter() {
      return { reachable: true, value: counter } as const;
    },
    size() {
      return data.size;
    },
  };
}

/**
 * Run an out-of-band tuple write and invalidate the cache afterwards.
 *
 * Application code does not need this: everything routed through
 * `openfga.ts` bumps the epoch itself. This exists for the one-off scripts that
 * construct their own `OpenFgaClient` and write tuples directly, which would
 * otherwise leave the cache serving answers that predate their change until the
 * TTL expired.
 *
 * Invalidates in a `finally`, so a write that throws after partially applying
 * still forces a flush. That is the expensive direction: a needless flush costs
 * one `INCR` and a cold cache, whereas a skipped one after a partial write
 * serves stale authorization.
 */
export async function withAclCacheInvalidation<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } finally {
    await bumpAclCacheEpoch();
  }
}

/**
 * Cached decision for a `Check`, or `undefined` on miss.
 *
 * `undefined` is ambiguous by design between "no entry" and "cannot verify",
 * because both must produce the same outcome: ask the engine.
 */
export async function aclCacheGet(key: AclCacheKey): Promise<boolean | undefined> {
  const epoch = await currentEpoch();
  if (epoch === null) return undefined;
  const raw = await store.get(encodeKey(epoch, key));
  if (raw === undefined) return undefined;
  if (raw === '1') return true;
  if (raw === '0') return false;
  return undefined;
}

/** Resolve many cached decisions against one epoch and one store round trip. */
export async function aclCacheGetMany(
  keys: AclCacheKey[]
): Promise<(boolean | undefined)[]> {
  if (keys.length === 0) return [];
  const epoch = await currentEpoch();
  if (epoch === null) return keys.map(() => undefined);

  const encoded = keys.map((key) => encodeKey(epoch, key));
  try {
    const values = store.getMany
      ? await store.getMany(encoded)
      : await Promise.all(encoded.map((key) => store.get(key)));
    return keys.map((_, index) => {
      const value = values[index];
      return value === '1' ? true : value === '0' ? false : undefined;
    });
  } catch {
    return keys.map(() => undefined);
  }
}

/**
 * Record an engine decision.
 *
 * Only called with results the engine actually returned. A failure is never
 * cached: caching a failure would pin "deny" in place for the whole TTL after a
 * transient outage, turning a blip into an access outage.
 */
export async function aclCacheSet(key: AclCacheKey, allowed: boolean): Promise<void> {
  const epoch = await currentEpoch();
  if (epoch === null) return;
  await store.set(encodeKey(epoch, key), allowed ? '1' : '0', CACHE_TTL_HARD_SECONDS);
}

/** Store many engine decisions under one epoch with a pipelined write. */
export async function aclCacheSetMany(
  entries: Array<{ key: AclCacheKey; allowed: boolean }>
): Promise<void> {
  if (entries.length === 0) return;
  const epoch = await currentEpoch();
  if (epoch === null) return;

  const encoded = entries.map(({ key, allowed }) => [
    encodeKey(epoch, key),
    allowed ? '1' : '0',
  ] as [string, string]);
  try {
    if (store.setMany) {
      await store.setMany(encoded, CACHE_TTL_HARD_SECONDS);
    } else {
      await Promise.all(encoded.map(([key, value]) => store.set(key, value, CACHE_TTL_HARD_SECONDS)));
    }
  } catch {
    // A cache write failure must never turn a successful engine result into denial.
  }
}

/**
 * Invalidate every cached decision, everywhere, in one atomic operation.
 *
 * Call this after any tuple write — including from scripts and one-off admin
 * commands that bypass `openfga.ts`. Application writes call it automatically.
 */
export async function bumpAclCacheEpoch(): Promise<void> {
  const next = await store.incr(EPOCH_KEY);
  if (next === null) {
    // Redis is down. The local epoch is deliberately NOT advanced: entries keyed
    // under the old epoch are still reachable, but so is the next read that
    // cannot verify anything, and that read bypasses the cache entirely. Once
    // Redis returns, the counter resumes from its persisted value, which still
    // dominates every entry written before the outage.
    logger.warn('[aclCache] could not bump epoch — redis unavailable, reads will bypass the cache');
    knownEpoch = null;
    return;
  }
  knownEpoch = next;
  knownEpochAt = Date.now();
}
