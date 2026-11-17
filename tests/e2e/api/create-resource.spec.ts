import { test, expect } from '../fixtures/auth.fixture';
import { request as playwrightRequest } from '@playwright/test';

test.describe('Create Resource API — /api/v1/resources/create', () => {
  test('refreshes the user search index cache after a resource is created', async ({
    sessionPage,
    request,
  }) => {
    await expect(sessionPage).toHaveURL('/');
    const before = await request.get('/api/v1/content/index.json');
    expect(before.status()).toBe(200);
    expect(before.headers()['cache-control']).toBe('private, no-store');

    const created = await request.post('/api/v1/resources/create', {
      data: { title: `Index Refresh ${Date.now()}`, type: 'document' },
    });
    expect([200, 201]).toContain(created.status());
    const resource = await created.json();

    const after = await request.get('/api/v1/content/index.json');
    expect(after.status()).toBe(200);
    expect(after.headers()['cache-control']).toBe('private, no-store');
    const items = await after.json();
    expect(items.some((item: { id: string }) => item.id === resource.id)).toBe(true);
  });

  test('removes a revoked public resource from the anonymous search index immediately', async ({
    sessionPage,
    request,
  }) => {
    const anonymous = await playwrightRequest.newContext({
      baseURL: process.env.TEST_APP_URL ?? `http://localhost:${process.env.E2E_APP_PORT ?? '4321'}`,
    });

    try {
      const created = await request.post('/api/v1/resources/create', {
        data: { title: `Revocation Index ${Date.now()}`, type: 'document' },
      });
      expect(created.status()).toBe(201);
      const resource = await created.json();

      const warm = await anonymous.get('/api/v1/content/index.json');
      expect(warm.status()).toBe(200);
      expect(warm.headers()['cache-control']).toBe('private, no-store');
      expect((await warm.json()).some((item: { id: string }) => item.id === resource.id)).toBe(false);

      const granted = await request.put('/api/v1/permissions/audience', {
        data: { object: resource.id, kind: 'public_link', rung: 'viewer' },
      });
      expect(granted.status()).toBe(200);

      const visible = await anonymous.get('/api/v1/content/index.json');
      expect((await visible.json()).some((item: { id: string }) => item.id === resource.id)).toBe(true);

      const revoked = await request.put('/api/v1/permissions/audience', {
        data: { object: resource.id, kind: 'restricted' },
      });
      expect(revoked.status()).toBe(200);

      const hidden = await anonymous.get('/api/v1/content/index.json');
      expect(hidden.status()).toBe(200);
      expect((await hidden.json()).some((item: { id: string }) => item.id === resource.id)).toBe(false);
    } finally {
      await anonymous.dispose();
    }
  });

  test('authenticated POST creates a document and it is fetchable', async ({
    sessionPage,
    request,
  }) => {
    const uniqueTitle = `E2E Created Note ${Date.now()}`;

    const res = await request.post('/api/v1/resources/create', {
      data: {
        title: uniqueTitle,
        type: 'document',
        is_public: false,
        tags: ['e2e'],
      },
    });

    expect([200, 201]).toContain(res.status());
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.id).toMatch(/^document:/);
    expect(body.type).toBe('document');
    expect(body.route).toMatch(/^\/e2e-created-note-\d+-[a-z0-9]+$/);
    expect(body.title).toBe(uniqueTitle);

    // Round-trip verification: fetch the created resource back
    const fetchRes = await request.get(`/api/v1/resources/${encodeURIComponent(body.id)}`);
    expect(fetchRes.status()).toBe(200);
    const fetched = await fetchRes.json();
    expect(fetched.title).toBe(uniqueTitle);
  });

  test('authenticated POST can nest a document inside a created folder', async ({
    sessionPage,
    request,
  }) => {
    const folderTitle = `E2E Folder ${Date.now()}`;
    const folderRes = await request.post('/api/v1/resources/create', {
      data: { title: folderTitle, type: 'folder' },
    });
    expect(folderRes.status()).toBe(201);
    const folder = await folderRes.json();
    expect(folder.id).toMatch(/^folder:/);
    expect(folder.route).toContain('/folders/');

    // Create a document nested inside that folder
    const childRes = await request.post('/api/v1/resources/create', {
      data: {
        title: `E2E Nested Doc ${Date.now()}`,
        type: 'document',
        parent_folder: folder.id,
      },
    });
    expect(childRes.status()).toBe(201);
    const child = await childRes.json();
    expect(child.parentId).toBe(folder.id);
  });

  test('authenticated POST creates a canvas routed to studio', async ({
    sessionPage,
    request,
  }) => {
    const res = await request.post('/api/v1/resources/create', {
      data: { title: `E2E Canvas ${Date.now()}`, type: 'canvas' },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.id).toMatch(/^canvas:/);
    expect(body.route).toContain('/studio/canvas/');
  });

  test('unauthenticated POST → 401', async ({ request }) => {
    const res = await request.post('/api/v1/resources/create', {
      data: {
        title: 'Unauthorized Create',
        type: 'document',
        content: '# x',
      },
      headers: { Cookie: '' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('invalid type or missing title → 400', async ({ sessionPage, request }) => {
    const badType = await request.post('/api/v1/resources/create', {
      data: { title: 'Bad', type: 'not-a-real-type' },
    });
    expect(badType.status()).toBe(400);

    const noTitle = await request.post('/api/v1/resources/create', {
      data: { type: 'document' },
    });
    expect(noTitle.status()).toBe(400);
  });
});
