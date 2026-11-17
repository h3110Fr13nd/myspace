import { expect, test } from '@playwright/test';
import {
  aclCacheGet,
  aclCacheGetMany,
  aclCacheSet,
  aclCacheSetMany,
  bumpAclCacheEpoch,
  createMemoryAclStore,
  resetAclCacheEpochMemo,
  setAclCacheStore,
} from '../../src/lib/aclCache';

/**
 * Contract for the authorization cache's invalidation.
 *
 * This is the only part of the cache that is security-critical. Caching a `true`
 * means a revoked grant can outlive the revocation, so the property that has to
 * hold is not "the cache is fast" but "no answer written before a change is
 * still reachable after it". Everything here is asserted against an in-memory
 * store because that is the layer under test: a real Redis would tell you Redis
 * works, not that a write actually invalidates.
 *
 * The engine is stubbed the way `acl-guards.spec.ts` stubs it, and for the same
 * reason — the interesting logic is the interaction between the generation
 * counter and the cache key, not OpenFGA's semantics.
 */

const ALICE = { user: 'user:alice', relation: 'viewer', object: 'document:d1' };
const DOC2 = { user: 'user:alice', relation: 'viewer', object: 'document:d2' };

function useStore(initialEpoch: number | null = null) {
  const store = createMemoryAclStore(initialEpoch);
  setAclCacheStore(store);
  return store;
}

test.describe('aclCache generation-counter invalidation', () => {
  test.beforeEach(() => {
    resetAclCacheEpochMemo();
  });

  test.afterEach(() => {
    setAclCacheStore(null);
    resetAclCacheEpochMemo();
  });

  test('a miss is reported as a miss, not as a denial', async () => {
    useStore();
    expect(await aclCacheGet(ALICE)).toBeUndefined();
  });

  test('a decision round-trips, and `false` is distinguishable from a miss', async () => {
    useStore();
    await aclCacheSet(ALICE, true);
    await aclCacheSet(DOC2, false);

    expect(await aclCacheGet(ALICE)).toBe(true);
    // The whole reason `false` is stored as '0' rather than omitted: a cached
    // denial must be readable as a decision, or the cache would re-ask the
    // engine for every private resource on every request, which is the majority
    // of the corpus.
    expect(await aclCacheGet(DOC2)).toBe(false);
  });

  test('decisions are scoped per user, relation and object', async () => {
    useStore();
    await aclCacheSet(ALICE, true);

    expect(await aclCacheGet({ ...ALICE, user: 'user:bob' })).toBeUndefined();
    expect(await aclCacheGet({ ...ALICE, relation: 'editor' })).toBeUndefined();
    expect(await aclCacheGet({ ...ALICE, object: 'document:d2' })).toBeUndefined();
    expect(await aclCacheGet(ALICE)).toBe(true);
  });

  test('a revocation is unreachable immediately after the bump', async () => {
    // The security-critical case. A grant is cached, the grant is withdrawn, and
    // the next read must miss — not serve the stale `true`.
    useStore();
    await aclCacheSet(ALICE, true);
    expect(await aclCacheGet(ALICE)).toBe(true);

    await bumpAclCacheEpoch();

    expect(await aclCacheGet(ALICE)).toBeUndefined();
  });

  test('a new grant is not visible until the bump', async () => {
    useStore();
    expect(await aclCacheGet(ALICE)).toBeUndefined();

    await bumpAclCacheEpoch(); // the grant is written and the epoch moves together

    // Still a miss: the bump only invalidates. It must not publish a decision
    // that no engine call has made.
    expect(await aclCacheGet(ALICE)).toBeUndefined();
  });

  test('a bump invalidates every entry, not only the most recent one', async () => {
    useStore();
    await aclCacheSet(ALICE, true);
    await aclCacheSet(DOC2, true);

    await bumpAclCacheEpoch();

    expect(await aclCacheGet(ALICE)).toBeUndefined();
    expect(await aclCacheGet(DOC2)).toBeUndefined();
  });

  test('an epoch that never resets cannot be overtaken by a stale holder', async () => {
    // Start from a deployment that has already been written to, so the first bump
    // is 2 rather than 1. A process holding the old value must not be able to
    // make its entries reachable again.
    const store = useStore(1);
    await aclCacheSet(ALICE, true);
    await bumpAclCacheEpoch();
    expect(await aclCacheGet(ALICE)).toBeUndefined();

    // Someone still holding epoch 1 writes again: their entry is filed under 1,
    // while the live epoch is 2, so it stays invisible.
    resetAclCacheEpochMemo();
    expect(await aclCacheGet(ALICE)).toBeUndefined();

    await aclCacheSet(ALICE, true);
    expect(await aclCacheGet(ALICE)).toBe(true);
    expect(store.size()).toBeGreaterThan(0);
  });

  test('an unreachable store forces a miss rather than serving unverified data', async () => {
    // Redis down: `getCounter` returns null, which must surface as a miss so the
    // caller asks the engine. A cache that cannot prove its entries are current
    // has to fail toward the engine, never toward a remembered answer — that is
    // the difference between "slow" and "serving a revoked grant".
    const store = createMemoryAclStore(0);
    setAclCacheStore({
      get: store.get,
      set: async () => {},
      incr: async () => null,
      getCounter: async () => ({ reachable: false } as const),
    });

    await aclCacheSet(ALICE, true);
    expect(await aclCacheGet(ALICE)).toBeUndefined();
  });

  test('entries written before an outage stay unreachable after it', async () => {
    // Bump fails (Redis down), then Redis returns. The counter resumes from its
    // persisted value and still dominates every entry written before.
    let down = false;
    const backing = createMemoryAclStore(0);
    setAclCacheStore({
      get: backing.get,
      set: backing.set,
      incr: async (key: string) => (down ? null : backing.incr(key)),
      getCounter: async () =>
        down ? ({ reachable: false } as const) : { reachable: true, value: await backing.getCounter() },
    });

    await aclCacheSet(ALICE, true);
    down = true;
    await bumpAclCacheEpoch();
    expect(await aclCacheGet(ALICE)).toBeUndefined();

    down = false;
    expect(await aclCacheGet(ALICE)).toBe(true);
  });

  test('bulk reads and writes use one store operation and still obey epoch invalidation', async () => {
    const backing = createMemoryAclStore();
    let reads = 0;
    let writes = 0;
    setAclCacheStore({
      ...backing,
      async getMany(keys) {
        reads++;
        return Promise.all(keys.map((key) => backing.get(key)));
      },
      async setMany(entries) {
        writes++;
        await Promise.all(entries.map(([key, value]) => backing.set(key, value, 60)));
      },
    });

    await aclCacheSetMany([
      { key: ALICE, allowed: true },
      { key: DOC2, allowed: false },
    ]);
    expect(writes).toBe(1);
    expect(await aclCacheGetMany([ALICE, DOC2])).toEqual([true, false]);
    expect(reads).toBe(1);

    await bumpAclCacheEpoch();
    expect(await aclCacheGetMany([ALICE, DOC2])).toEqual([undefined, undefined]);
  });
});
