import { expect, test } from '@playwright/test';
import { createMemoryAclStore, setAclCacheStore } from '../../src/lib/aclCache';
import { checkPermission, fgaClient } from '../../src/lib/openfga';

test('concurrent identical permission checks share one engine request', async () => {
  const client = fgaClient as unknown as {
    check: (input: { user: string; relation: string; object: string }) => Promise<{ allowed: boolean }>;
  };
  const originalCheck = client.check;
  const memory = createMemoryAclStore();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let engineCalls = 0;

  setAclCacheStore(memory);
  client.check = async () => {
    engineCalls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { allowed: true };
  };

  try {
    const params = {
      user: `user:coalesce-${suffix}`,
      relation: 'editor',
      object: `document:coalesce-${suffix}`,
    };
    const results = await Promise.all(Array.from({ length: 25 }, () => checkPermission(params)));

    expect(results.every(Boolean)).toBe(true);
    expect(engineCalls).toBe(1);
    expect(memory.size()).toBe(1);
    expect(await checkPermission(params)).toBe(true);
    expect(engineCalls).toBe(1);
  } finally {
    client.check = originalCheck;
    setAclCacheStore(null);
  }
});
