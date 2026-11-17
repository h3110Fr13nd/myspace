import { expect, test } from '../fixtures/auth.fixture';

test.describe('Wikilink preview API', () => {
  test('returns a public preview without allowing shared-cache storage', async ({ request }) => {
    const response = await request.get('/api/v1/preview?doc=document%3Apublic_hello');

    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      id: 'document:public_hello',
      title: 'Hello World',
    });
  });

  test('does not disclose a private resource to anonymous users', async ({ request }) => {
    const response = await request.get('/api/v1/preview?doc=document%3Aprivate_secret');

    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    const body = await response.text();
    expect(body).not.toContain('Private Note');
    expect(body).not.toContain('This should NOT be visible');
  });

  test('does not disclose a draft even when its public flag is set', async ({ request }) => {
    const response = await request.get('/api/v1/preview?doc=document%3Adraft_wip');

    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('Work in Progress');
  });

  test('allows the resource owner to preview their private resource', async ({ sessionPage }) => {
    const response = await sessionPage.request.get('/api/v1/preview?doc=document%3Aprivate_secret');

    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      id: 'document:private_secret',
      title: 'Private Note',
    });
  });
});
