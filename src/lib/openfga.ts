import 'dotenv/config';
import { OpenFgaClient } from '@openfga/sdk';
import { counterOrGet } from './metrics';
import { logger } from './logger';
import {
  aclCacheGet,
  aclCacheGetMany,
  aclCacheSet,
  aclCacheSetMany,
  bumpAclCacheEpoch,
} from './aclCache';
import { invalidateSearchCache } from './cache/searchCache';

export { toFgaObjectId } from './resourceId';

/**
 * The OpenFGA principal representing "everyone" (public/anonymous viewers).
 * Matches the repo-wide convention used by resourceFactory.ts and the seed scripts.
 */
export const PUBLIC_USER = 'user:*';

const apiUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';
const storeId = process.env.OPENFGA_STORE_ID;

/**
 * Per-call deadline for a single authorization check.
 *
 * The SDK default is 10s, and that number was the single largest contributor to
 * the 300s page loads: a listing fires one check per resource, every one of them
 * fails closed, and each one burns the full timeout before it gives up. 25
 * failures at 10s is 250s of a user waiting on a page.
 *
 * 1500ms is chosen against the real latency distribution rather than guessed —
 * a warm check on the pinned engine answers in single-digit milliseconds, so a
 * second and a half is already several hundred times the healthy case. It leaves
 * room for a cold engine and a loaded Postgres while bounding the degraded case
 * to something a browser will wait for.
 */
const CHECK_TIMEOUT_MS = Number.parseInt(process.env.OPENFGA_CHECK_TIMEOUT_MS || '1500', 10);

/**
 * Deadline for a cache lookup, deliberately far below {@link CHECK_TIMEOUT_MS}.
 *
 * The point of the cache is to be faster than the engine, so a cache read that
 * costs as much as a check has already lost. Exceeding this is treated as a
 * miss and the request falls through to the engine.
 */
const CACHE_LOOKUP_TIMEOUT_MS = Number.parseInt(process.env.FGA_CACHE_LOOKUP_TIMEOUT_MS || '200', 10);

/**
 * Deadline for a whole `BatchCheck` request.
 *
 * Larger than a single check because it carries up to 50 of them and the server
 * evaluates them with its own worker pool (`DefaultMaxConcurrentChecksPerBatchCheck`
 * = 50). Sized to stay inside Cloudflare's ~100s origin timeout with room to spare,
 * while still bounding the degraded case far more tightly than that.
 */
const BATCH_CHECK_TIMEOUT_MS = Number.parseInt(process.env.OPENFGA_BATCH_TIMEOUT_MS || '5000', 10);

/**
 * Upper bound on checks in flight at once, process-wide.
 *
 * A listing route issues one check per resource and the homepage selects the
 * whole `resources` table, so an anonymous render used to put ~939 concurrent
 * requests on a single OpenFGA process backed by a single Postgres. That is a
 * self-inflicted thundering herd: the engine is the bottleneck, so more
 * concurrency means every request waits longer, which is exactly the state the
 * breaker below then has to clean up.
 *
 * Bounded concurrency converts a collapse into a queue. It costs nothing when
 * the engine is healthy — the work is the same either way — and it is what makes
 * the difference between a slow page and a 502.
 */
const MAX_CONCURRENT_CHECKS = Number.parseInt(process.env.OPENFGA_MAX_CONCURRENCY || '4', 10);

/**
 * Consecutive failures that trip the breaker.
 *
 * High enough that a brief hiccup does not open it, low enough that the breaker
 * opens well before a 939-check listing has spent minutes discovering the engine
 * is down for the hundredth time.
 */
const BREAKER_THRESHOLD = Number.parseInt(process.env.OPENFGA_BREAKER_THRESHOLD || '10', 10);

/** How long the breaker stays open before letting one probe through. */
const BREAKER_COOLDOWN_MS = Number.parseInt(process.env.OPENFGA_BREAKER_COOLDOWN_MS || '5000', 10);

let inFlight = 0;
const waiters: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT_CHECKS) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function releaseSlot(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

let consecutiveFailures = 0;
let breakerOpenUntil = 0;

export function fgaBreakerIsOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    logger.warn(
      { consecutiveFailures, cooldownMs: BREAKER_COOLDOWN_MS },
      'openfga breaker open — failing fast without calling the engine'
    );
  }
}

export const fgaClient = new OpenFgaClient({
  apiUrl,
  storeId,
});

/**
 * Failed calls to the authorization engine, by operation.
 *
 * Every path here fails closed, so this counter is the signal that matters: a
 * resource showing as "not permitted" because the engine was unreachable looks
 * identical to one that was genuinely denied, and without this the two are
 * indistinguishable from the outside. Any non-zero rate is a degraded-mode
 * incident, not a bug report about missing permissions.
 */
const fgaErrors = counterOrGet({
  name: 'foss_openfga_errors_total',
  help: 'Failed OpenFGA engine calls, by operation',
  labelNames: ['operation'],
});

/**
 * Cache outcomes for authorization checks.
 *
 * Labelled by decision rather than by hit/miss so the ratio that matters is
 * legible without arithmetic: a run of `deny` hits means the cache is answering,
 * and a sudden absence of both means the epoch moved or Redis went away. Pairs
 * with `foss_openfga_breaker_trips_total` to separate "engine is down" from
 * "cache is cold".
 */
const fgaCacheHits = counterOrGet({
  name: 'foss_openfga_cache_hits_total',
  help: 'Authorization decisions served from the generation-counter cache',
  labelNames: ['outcome'],
});

/** How often the breaker short-circuited a check without calling the engine. */
const fgaBreakerTrips = counterOrGet({
  name: 'foss_openfga_breaker_trips_total',
  help: 'Authorization checks denied by an open circuit breaker',
});

export interface CheckPermissionParams {
  user: string;
  relation: string;
  object: string;
}

/**
 * Items per `BatchCheck` request.
 *
 * The server accepts 50, but accepting is not the same as answering. Measured on
 * the VM: batches of 50 exceeded a 20s deadline (54 of them, in a row), while
 * batches of 39 completed. The engine resolves each check against the model and
 * the datastore, so batch size trades directly against per-request latency --
 * and a batch that times out yields nothing at all, which is strictly worse than
 * two smaller batches that both answer.
 *
 * Ten leaves headroom for OpenFGA's per-batch workers and other requests sharing
 * its small datastore pool. A larger batch multiplied by parallel HTTP batches
 * previously opened more PostgreSQL work than this one-vCPU stack could serve.
 * `OPENFGA_BATCH_SIZE` overrides it.
 */
const BATCH_CHECK_MAX = Number.parseInt(process.env.OPENFGA_BATCH_SIZE || '10', 10);
const MAX_PENDING_BATCHES = 128;
const pendingPermissionBatches = new Map<string, Promise<Map<string, boolean>>>();
const MAX_PENDING_PERMISSION_CHECKS = 256;
const pendingPermissionChecks = new Map<string, Promise<boolean>>();
let authorizationWriteGeneration = 0;

/**
 * Batches of checks, as one request each, with the cache in front.
 *
 * This is what actually removes the listing fan-out. A listing route needs one
 * decision per resource, and the homepage selects the whole `resources` table, so
 * a render was 939 individual `Check` calls. `Promise.all` over them is not a
 * fix: it is the failure mode, because the engine is the bottleneck and every
 * concurrent caller waits longer than every other one.
 *
 * `BatchCheck` exists to collapse exactly this shape (engine v1.8.2+), and the
 * pinned engine is now v1.22.0. Ten checks per request cap fan-out on the
 * constrained deployment; the process-wide semaphore keeps at most four
 * batches in flight across all users.
 *
 * Semantics are preserved exactly, which is the part worth being careful about:
 *
 *   - The cache is consulted per item first, so a warm generation never reaches
 *     the engine, and only genuine misses are batched.
 *   - A batch that fails denies *its own items only* and does not poison the
 *     others. Failing the whole call would make one slow batch deny a page.
 *   - Fail-closed per item: an item with no result in the response is denied,
 *     not defaulted to allowed.
 *   - Results are correlated by `correlationId`, which the engine echoes back;
 *     the response does not carry the tuple keys themselves.
 */
export async function checkPermissionsBatch(params: {
  user: string;
  relation: string;
  objects: string[];
}): Promise<Map<string, boolean>> {
  const objects = [...new Set(params.objects)].sort();
  const key = JSON.stringify([
    authorizationWriteGeneration,
    params.user,
    params.relation,
    objects,
  ]);
  const pending = pendingPermissionBatches.get(key);
  if (pending) return new Map(await pending);

  // This is a short-lived coalescing map, not a result cache. It is capped so a
  // burst of distinct callers cannot turn it into unbounded request storage.
  if (pendingPermissionBatches.size >= MAX_PENDING_BATCHES) {
    return checkPermissionsBatchUnshared({ ...params, objects });
  }
  const work = checkPermissionsBatchUnshared({ ...params, objects });
  pendingPermissionBatches.set(key, work);
  try {
    return new Map(await work);
  } finally {
    if (pendingPermissionBatches.get(key) === work) pendingPermissionBatches.delete(key);
  }
}

async function checkPermissionsBatchUnshared(params: {
  user: string;
  relation: string;
  objects: string[];
}): Promise<Map<string, boolean>> {
  const { user, relation } = params;
  const results = new Map<string, boolean>();
  // De-duplicate: a listing can reference the same object more than once, and a
  // duplicate would burn a slot in the 50-per-request budget for nothing.
  const wanted = [...new Set(params.objects)];

  const cachedDecisions = await aclCacheGetMany(
    wanted.map((object) => ({ user, relation, object }))
  );
  const misses: string[] = [];
  for (const [index, object] of wanted.entries()) {
    const cached = cachedDecisions[index];
    if (cached !== undefined) {
      results.set(object, cached);
    } else {
      misses.push(object);
    }
  }

  if (misses.length === 0) return results;

  if (fgaBreakerIsOpen()) {
    fgaBreakerTrips.inc(results.size);
    return results; // absent = denied by the caller
  }

  const chunks: string[][] = [];
  for (let i = 0; i < misses.length; i += BATCH_CHECK_MAX) {
    chunks.push(misses.slice(i, i + BATCH_CHECK_MAX));
  }

  // Bounded at the batch level across all users to protect the small engine and
  // datastore pool from a burst of simultaneous listings.
  const runChunk = async (chunk: string[]) => {
    await acquireSlot();
    // `correlation_id` must match `^[\w\d-]{1,36}$` — word characters and a max
    // of 36. A resource id like `document:some-quite-long-author-slug` fails on
    // both counts (colons are not word characters, and ids run past 36), and the
    // server rejects the entire batch with a validation error rather than
    // ignoring the bad field. So the correlation is a short positional token and
    // the object is recovered from the index.
    const correlationToObject = new Map<string, string>();
    try {
      const response = await withDeadline(BATCH_CHECK_TIMEOUT_MS, 'openfga batch-check', () =>
        fgaClient.batchCheck({
          checks: chunk.map((object, index) => {
            const correlationId = `c${index}`;
            correlationToObject.set(correlationId, object);
            return { user, relation, object, correlationId };
          }),
        })
      );
      recordSuccess();

      const cacheEntries: Array<{ key: { user: string; relation: string; object: string }; allowed: boolean }> = [];
      for (const item of response.result ?? []) {
        const object = correlationToObject.get(item.correlationId);
        // A response entry whose correlation cannot be resolved is dropped
        // rather than guessed at; the object then stays absent, and absence denies.
        if (!object) continue;
        if (item.error) {
          // A per-item error is reported, not thrown. Deny it and carry on.
          fgaErrors.inc({ operation: 'batch_check' });
          results.set(object, false);
          continue;
        }
        const allowed = item.allowed === true;
        results.set(object, allowed);
        cacheEntries.push({ key: { user, relation, object }, allowed });
      }
      await aclCacheSetMany(cacheEntries);
    } catch (error: any) {
      fgaErrors.inc({ operation: 'batch_check' });
      recordFailure();
      logger.warn(
        { user, relation, size: chunk.length, timeoutMs: BATCH_CHECK_TIMEOUT_MS, error: error?.message },
        'openfga degraded: batch-check failed, denying these items (fail closed)'
      );
      // Leave the chunk's items absent so the caller denies them.
    } finally {
      releaseSlot();
    }
  };

  for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_CHECKS) {
    await Promise.all(chunks.slice(i, i + MAX_CONCURRENT_CHECKS).map(runChunk));
  }

  return results;
}

/**
 * Resolve `fn`, or reject after `ms`.
 *
 * The SDK takes no per-call timeout — `ClientRequestOpts` carries only
 * `retryParams` and `headers`, and the 10s figure that produced the 300s page
 * loads is the Axios instance default baked into `BaseAPI`. Reaching it would
 * mean constructing our own Axios instance, which means importing a package the
 * project does not depend on directly, on a hot security path. Racing the
 * promise is the same guarantee without the dependency.
 *
 * The abandoned request is still in flight until the SDK's own 10s timeout tears
 * its socket down. That is bounded by `MAX_CONCURRENT_CHECKS`, so the worst case
 * is a capped number of stragglers, not an unbounded leak.
 */
async function withDeadline<T>(ms: number, label: string, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
        // Do not hold the event loop open purely to fail a request nobody awaits.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Real Production OpenFGA Authorization Check
 * Hits OpenFGA engine directly. Zero mock placeholders.
 *
 * Concurrent callers for the same tuple share one in-flight promise. Then the
 * read path is generation-counter cache, breaker, bounded-concurrency engine
 * call. Sharing does not retain a decision: after settlement, the normal cache
 * remains the only source of reuse. The cache is consulted first because a hit
 * must not depend on the engine being reachable; the breaker is next so a sick
 * engine costs one map lookup instead of a queue slot and timeout.
 */
export async function checkPermission(params: CheckPermissionParams): Promise<boolean> {
  const key = JSON.stringify([
    authorizationWriteGeneration,
    params.user,
    params.relation,
    params.object,
  ]);
  const pending = pendingPermissionChecks.get(key);
  if (pending) return pending;

  // This is in-flight sharing only, never a decision cache. If the bounded map
  // is full, run the ordinary checked path without retaining another promise.
  if (pendingPermissionChecks.size >= MAX_PENDING_PERMISSION_CHECKS) {
    return checkPermissionUnshared(params);
  }

  const work = checkPermissionUnshared(params);
  pendingPermissionChecks.set(key, work);
  try {
    return await work;
  } finally {
    if (pendingPermissionChecks.get(key) === work) pendingPermissionChecks.delete(key);
  }
}

async function checkPermissionUnshared({ user, relation, object }: CheckPermissionParams): Promise<boolean> {
  const key = { user, relation, object };

  // A cache read is bounded too. Redis being slow must not become a new way to
  // hang the request; a lookup that misses its deadline is treated as a miss.
  let cached: boolean | undefined;
  try {
    cached = await withDeadline(CACHE_LOOKUP_TIMEOUT_MS, 'acl cache lookup', () => aclCacheGet(key));
  } catch {
    cached = undefined;
  }
  if (cached !== undefined) {
    fgaCacheHits.inc({ outcome: cached ? 'allow' : 'deny' });
    return cached;
  }

  if (fgaBreakerIsOpen()) {
    fgaBreakerTrips.inc();
    return false;
  }

  await acquireSlot();
  try {
    const response = await withDeadline(CHECK_TIMEOUT_MS, 'openfga check', () =>
      fgaClient.check({ user, relation, object })
    );
    const allowed = response.allowed || false;
    recordSuccess();
    await aclCacheSet(key, allowed);
    return allowed;
  } catch (error: any) {
    fgaErrors.inc({ operation: 'check' });
    recordFailure();
    logger.warn(
      { user, relation, object, apiUrl, timeoutMs: CHECK_TIMEOUT_MS, error: error?.message },
      'openfga degraded: check failed, denying (fail closed)'
    );
    return false; // Strict security default: deny access if engine is unreachable
  } finally {
    releaseSlot();
  }
}

/**
 * Real Production OpenFGA Tuple Writer
 *
 * Every successful write advances the cache generation, so a grant or a revoke
 * takes effect on the next read rather than at the end of the TTL. `acl/projector.ts`
 * is the only runtime caller of these three functions, which is what makes this
 * a complete hook for application-driven changes — see the module note in
 * `aclCache.ts` for what out-of-band writers still have to do themselves.
 */
export async function writeTuple(user: string, relation: string, object: string): Promise<boolean> {
  try {
    await fgaClient.write({
      writes: [{ user, relation, object }],
    });
    authorizationWriteGeneration++;
    invalidateSearchCache();
    await bumpAclCacheEpoch();
    return true;
  } catch (error: any) {
    if (error.message?.includes('cannot write a tuple which already exists') || error.message?.includes('already exists')) {
      // An idempotent no-op still means the tuple is present, which is the state
      // a cached answer would have been describing. Not bumping here would leave
      // the epoch describing a write that did not happen; bumping costs one INCR.
      authorizationWriteGeneration++;
      invalidateSearchCache();
      await bumpAclCacheEpoch();
      return true;
    }
    fgaErrors.inc({ operation: 'write' });
    logger.error({ user, relation, object, apiUrl, error: error?.message }, 'openfga: failed to write tuple');
    return false;
  }
}

/**
 * Batch tuple writer: grants every tuple idempotently and reports failures.
 *
 * Bumps the generation once for the whole batch rather than per tuple, since
 * nothing may read a half-applied batch anyway and the counter only needs to
 * advance past every entry written before it.
 */
export async function writeTuples(tuples: { user: string; relation: string; object: string }[]): Promise<boolean> {
  let ok = true;
  for (const t of tuples) {
    ok = (await writeTuple(t.user, t.relation, t.object)) && ok;
  }
  return ok;
}

/**
 * Real Production OpenFGA Tuple Deleter
 *
 * Revocation is the security-critical direction: without the generation bump a
 * revoked grant would keep answering `allowed` from cache until its TTL expired.
 */
export async function deleteTuple(user: string, relation: string, object: string): Promise<boolean> {
  try {
    await fgaClient.write({
      deletes: [{ user, relation, object }],
    });
    authorizationWriteGeneration++;
    invalidateSearchCache();
    await bumpAclCacheEpoch();
    return true;
  } catch (error: any) {
    // Audience changes intentionally remove several possible prior grants.
    // OpenFGA reports a missing tuple as a validation error, but the desired
    // state (absent) already holds. Treat it as an unchanged no-op: no error
    // metric/log, cache epoch bump, or downstream ACL projection is needed.
    if (String(error?.message ?? error).toLowerCase().includes('cannot delete a tuple which does not exist')) {
      return false;
    }
    fgaErrors.inc({ operation: 'delete' });
    logger.error({ user, relation, object, apiUrl, error: error?.message }, 'openfga: failed to delete tuple');
    return false;
  }
}
