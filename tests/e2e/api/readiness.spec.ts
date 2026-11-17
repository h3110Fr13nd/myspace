import { expect, test } from '@playwright/test';

test.describe('Readiness API', () => {
  test('reports the migrated audit store without blocking on optional dependencies', async ({ request }) => {
    const response = await request.get('/api/v1/readyz');

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ready',
      checks: {
        database: { status: 'healthy' },
        openfga: { status: 'healthy' },
        audit: { status: 'healthy' },
      },
    });
  });
});
