import { request as playwrightRequest } from '@playwright/test';
import { expect, test } from '../fixtures/auth.fixture';

test('public feeds follow anonymous OpenFGA access, not the derived is_public flag', async ({
  sessionPage,
  request,
}) => {
  const anonymous = await playwrightRequest.newContext({
    baseURL: process.env.TEST_APP_URL ?? `http://localhost:${process.env.E2E_APP_PORT ?? '4321'}`,
  });
  const title = `Feed Audience ${Date.now()}`;
  let resourceId: string | undefined;

  try {
    const created = await request.post('/api/v1/resources/create', {
      data: { title, type: 'document' },
    });
    expect(created.status()).toBe(201);
    const resource = await created.json();
    resourceId = resource.id;

    const setAudience = (kind: 'workspace' | 'public_link' | 'restricted') =>
      request.put('/api/v1/permissions/audience', {
        data: { object: resourceId, kind, rung: kind === 'restricted' ? null : 'viewer' },
      });

    expect((await setAudience('workspace')).status()).toBe(200);
    for (const path of ['/sitemap.xml', '/feed.xml', '/blogs/11111111-1111-4111-8111-111111111111/feed.xml']) {
      const response = await anonymous.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await response.text()).not.toContain(title);
    }

    expect((await setAudience('public_link')).status()).toBe(200);
    for (const path of ['/sitemap.xml', '/feed.xml', '/blogs/11111111-1111-4111-8111-111111111111/feed.xml']) {
      const response = await anonymous.get(path);
      expect(response.status()).toBe(200);
      const body = await response.text();
      expect(body).toContain(path === '/sitemap.xml' ? resource.route : title);
      if (path === '/sitemap.xml') {
        const resourceUrl = body.indexOf(resource.route);
        expect(body.slice(resourceUrl, body.indexOf('</url>', resourceUrl))).toContain('<lastmod>');
      } else {
        const itemStart = body.indexOf(title);
        expect(body.slice(itemStart, body.indexOf('</item>', itemStart))).toContain('<pubDate>');
      }
    }
  } finally {
    if (resourceId) {
      await request.put('/api/v1/permissions/audience', {
        data: { object: resourceId, kind: 'restricted' },
      }).catch(() => {});
    }
    await anonymous.dispose();
  }
});
