import { expect, test } from '@playwright/test';
import {
  createMemoryAclStore,
  setAclCacheStore,
} from '../../src/lib/aclCache';
import { checkPermissionsBatch, fgaClient } from '../../src/lib/openfga';

test('batch authorization pipelines cached reads and writes across requests', async () => {
  const memory = createMemoryAclStore();
  let cacheReads = 0;
  let cacheWrites = 0;
  const engine = fgaClient as unknown as {
    batchCheck: (input: { checks: Array<{ correlationId: string; object: string }> }) => Promise<any>;
  };
  const originalBatchCheck = engine.batchCheck;
  let engineCalls = 0;
  const objects = ['document:a', 'document:b', 'document:c'];

  setAclCacheStore({
    ...memory,
    async getMany(keys) {
      cacheReads++;
      return Promise.all(keys.map((key) => memory.get(key)));
    },
    async setMany(entries) {
      cacheWrites++;
      await Promise.all(entries.map(([key, value]) => memory.set(key, value, 60)));
    },
  });
  engine.batchCheck = async ({ checks }) => {
    engineCalls++;
    return {
      result: checks.map(({ correlationId, object }) => ({
        correlationId,
        allowed: object !== 'document:b',
      })),
    };
  };

  try {
    const first = await checkPermissionsBatch({ user: 'user:reader', relation: 'viewer', objects });
    expect([...first]).toEqual([
      ['document:a', true],
      ['document:b', false],
      ['document:c', true],
    ]);
    expect(engineCalls).toBe(1);
    expect(cacheReads).toBe(1);
    expect(cacheWrites).toBe(1);

    const second = await checkPermissionsBatch({ user: 'user:reader', relation: 'viewer', objects });
    expect([...second]).toEqual([...first]);
    expect(engineCalls).toBe(1);
    expect(cacheReads).toBe(2);
    expect(cacheWrites).toBe(1);
  } finally {
    engine.batchCheck = originalBatchCheck;
    setAclCacheStore(null);
  }
});
