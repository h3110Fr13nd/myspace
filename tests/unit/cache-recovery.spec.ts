import { expect, test } from '@playwright/test';
import { EventEmitter } from 'events';

/**
 * Contract for the cache's behaviour when its dependency is down.
 *
 * Scope note, because the first version of this file was wrong about why. The
 * old `unavailable` flag was *not* a one-way door: ioredis retried the socket on
 * its own schedule, fired `ready` when the dependency returned, and that cleared
 * the flag. Verified against the running VM, which logged `redis ready` shortly
 * after `workspace_valkey` came back, with no restart.
 *
 * What the flag did get wrong is narrower, and this file pins the parts that
 * matter: reads degrade to a miss rather than throwing while the dependency is
 * gone, repeated lookups do not each provoke a connection attempt, the failing
 * client is actually disconnected rather than left retrying forever, and the
 * delay grows and is capped.
 */

/** Just enough of an ioredis client for the connection lifecycle under test. */
class FakeRedis extends EventEmitter {
  static shouldConnect = true;
  static connectAttempts = 0;

  status = 'wait';
  private readonly store = new Map<string, string>();

  constructor(public readonly url: string) {
    super();
  }

  async connect(): Promise<void> {
    FakeRedis.connectAttempts++;
    if (!FakeRedis.shouldConnect) throw new Error('ECONNREFUSED');
    this.status = 'ready';
    // ioredis emits `ready` asynchronously once the handshake completes.
    queueMicrotask(() => this.emit('ready'));
  }

  disconnect(): void {
    this.status = 'end';
  }

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]) {
    keys.forEach((k) => this.store.delete(k));
    return keys.length;
  }

  async incr(key: string) {
    const next = Number.parseInt(this.store.get(key) ?? '0', 10) + 1;
    this.store.set(key, String(next));
    return next;
  }

  async ping() {
    return 'PONG';
  }
}

const cache = await import('../../src/lib/cache');
const { config } = await import('../../src/lib/config');

/** The real module captures `config.redisUrl` at call time, so it can be set. */
function withRedisUrl(): void {
  Object.defineProperty(config, 'redisUrl', { value: 'redis://fake:6379', configurable: true });
}

test.describe('cache dependency recovery', () => {
  test.beforeEach(() => {
    FakeRedis.shouldConnect = true;
    FakeRedis.connectAttempts = 0;
    withRedisUrl();
    cache.setCacheConnectorForTests((url) => new FakeRedis(url) as any);
  });

  test.afterEach(() => {
    cache.setCacheConnectorForTests(null);
  });

  test('serves values while the dependency is healthy', async () => {
    await cache.cacheSet('k', 'v');
    expect(await cache.cacheGet('k')).toBe('v');
  });

  test('a failed connection degrades to a miss instead of throwing', async () => {
    FakeRedis.shouldConnect = false;

    // The whole point of the no-op fallback: callers must not have to guard.
    await expect(cache.cacheSet('k', 'v')).resolves.toBeUndefined();
    await expect(cache.cacheGet('k')).resolves.toBeUndefined();

    // `cachePing` deliberately reports ready when Redis is absent: the cache is
    // an optimisation, never a readiness gate, and failing the pod over a missing
    // cache would turn a performance dependency into an availability one. So a
    // miss, not a `false`, is the correct degraded signal here.
    expect(await cache.cachePing()).toBe(true);
  });

  test('a failure schedules a retry rather than disabling the cache forever', async () => {
    FakeRedis.shouldConnect = false;
    await cache.cacheGet('absent');

    expect(cache.cacheRetryDelayMs()).toBeGreaterThan(0);
    expect(FakeRedis.connectAttempts).toBe(1);

    // The defining property of the bug: a second call must not re-attempt while
    // the backoff is in force. Retrying on every lookup turns a dependency outage
    // into a connection storm.
    await cache.cacheGet('absent');
    expect(FakeRedis.connectAttempts).toBe(1);
  });

  test('the cache resumes once the dependency comes back, without a restart', async () => {
    FakeRedis.shouldConnect = false;
    await cache.cacheSet('k', 'v');
    expect(await cache.cacheGet('k')).toBeUndefined();

    // Dependency recovers. The backoff has to be the only thing in the way.
    FakeRedis.shouldConnect = true;
    cache.resetCacheConnectionForTests();

    await cache.cacheSet('k', 'v');
    expect(await cache.cacheGet('k')).toBe('v');
    expect(FakeRedis.connectAttempts).toBeGreaterThan(1);
  });

  test('a failed client is disconnected rather than left retrying', async () => {
    // The orphaned-client defect: the old code nulled its reference and set a
    // flag but never disconnected, so that ioredis instance kept its own retry
    // loop alive while new clients were created beside it — one leaked connection
    // per outage cycle, never reclaimed.
    FakeRedis.shouldConnect = false;
    const made: FakeRedis[] = [];
    cache.setCacheConnectorForTests((url) => {
      const c = new FakeRedis(url);
      made.push(c);
      return c as any;
    });

    await cache.cacheGet('absent');
    cache.clearCacheClientForTests();
    await cache.cacheGet('absent');

    expect(made.length).toBeGreaterThan(0);
    expect(
      made.every((c) => c.status === 'end'),
      'every abandoned client must be disconnected'
    ).toBe(true);
  });

  test('backoff grows and is capped, rather than retrying flat out', async () => {
    // Shrink the schedule so the policy is observable without ~90s of waiting.
    cache.setCacheBackoffForTests(10, 40);
    FakeRedis.shouldConnect = false;

    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      // Clear only the client, so the backoff state survives between attempts.
      cache.clearCacheClientForTests();
      // Wait out the installed delay, which is what a real caller experiences.
      await new Promise((r) => setTimeout(r, cache.cacheRetryDelayMs() + 5));
      await cache.cacheGet('absent');
      delays.push(cache.cacheRetryDelayMs());
    }

    // Exponential while it is still under the ceiling...
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
    // ...and capped once it reaches it.
    expect(Math.max(...delays)).toBeLessThanOrEqual(40);

    cache.setCacheBackoffForTests(500, 30_000);
  });
});