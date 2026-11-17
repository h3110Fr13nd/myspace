import { expect, test } from '@playwright/test';
import { createMemoryAclStore, setAclCacheStore } from '../../src/lib/aclCache';
import { deleteTuple, fgaClient } from '../../src/lib/openfga';

test('deleting an absent OpenFGA tuple is a quiet no-op', async () => {
  const client = fgaClient as unknown as {
    write: (input: unknown) => Promise<unknown>;
  };
  const originalWrite = client.write;
  let invalidationCalls = 0;

  setAclCacheStore({
    get: async () => undefined,
    set: async () => undefined,
    delete: async () => { invalidationCalls++; },
    clear: async () => { invalidationCalls++; },
    bumpEpoch: async () => { invalidationCalls++; return 1; },
  });
  client.write = async () => {
    throw new Error('FGA API Validation Error: cannot delete a tuple which does not exist');
  };

  try {
    const removed = await deleteTuple('user:missing', 'viewer', 'document:missing');
    expect(removed).toBe(false);
    expect(invalidationCalls).toBe(0);
  } finally {
    client.write = originalWrite;
    setAclCacheStore(null);
  }
});
