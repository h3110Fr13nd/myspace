import { expect, test } from '../fixtures/auth.fixture';

test('Bases results render hostile resource titles as plain text', async ({ sessionPage, request }) => {
  const hostileTitle = `<img src=x onerror="window.__basesXss = true"> ${Date.now()}`;
  const itemResponse = await request.post('/api/v1/resources/create', {
    data: { title: hostileTitle, type: 'document' },
  });
  expect(itemResponse.status()).toBe(201);

  const queryResponse = await request.post('/api/v1/resources/create', {
    data: { title: `Bases test ${Date.now()}`, type: 'document' },
  });
  expect(queryResponse.status()).toBe(201);
  const queryResource = await queryResponse.json();

  const saved = await request.post('/api/v1/resources/save', {
    data: {
      id: queryResource.id,
      title: queryResource.title,
      content: '```bases\ntype: all\nview: cards\nlimit: 100\n```',
    },
  });
  expect(saved.status()).toBe(200);

  await sessionPage.goto(`/?doc=${encodeURIComponent(queryResource.id)}`);
  const result = sessionPage.locator('.bases-result-card__title', { hasText: hostileTitle });
  await expect(result).toHaveText(hostileTitle);
  await expect(result.locator('img')).toHaveCount(0);
  expect(await sessionPage.evaluate(() => (window as any).__basesXss)).toBeUndefined();
});
