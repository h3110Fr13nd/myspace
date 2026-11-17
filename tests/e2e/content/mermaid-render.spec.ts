import { unlink } from 'node:fs/promises';
import { test, expect } from '../fixtures/auth.fixture';

test('Mermaid viewer loads its diagram engine on demand and renders', async ({
  sessionPage,
  request,
}) => {
  const created = await request.post('/api/v1/resources/create', {
    data: { title: `E2E Mermaid ${Date.now()}`, type: 'mermaid' },
  });
  expect(created.status()).toBe(201);
  const resource = await created.json();

  try {
    await sessionPage.goto(`/?doc=${encodeURIComponent(resource.id)}`);
    await expect(sessionPage.locator('.ui-viewer__diagram-stage svg')).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    if (typeof resource.filePath === 'string') {
      await unlink(resource.filePath).catch(() => {});
    }
  }
});
