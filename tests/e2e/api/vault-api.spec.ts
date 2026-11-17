import { test, expect } from '../fixtures/auth.fixture';
import { rm } from 'node:fs/promises';

// Pre-computed SHA-256 of 'workspace_key_test_api_key_12345678901234567890123456789012'
// This matches what's inserted in seed.sql
const SEEDED_API_KEY = 'workspace_key_test_api_key_12345678901234567890123456789012';
const INVALID_API_KEY = 'workspace_key_totally_invalid_key_that_does_not_exist_xyz';

test.describe('Vault API — resource CRUD + API Keys', () => {
  test('resource save clears tags, summary, and links when the editor submits empty values', async ({
    sessionPage,
    request,
  }) => {
    const created = await request.post('/api/v1/resources/create', {
      data: {
        title: `E2E Save Metadata ${Date.now()}`,
        type: 'document',
        tags: ['old-tag'],
        summary: 'old summary',
      },
    });
    expect(created.status()).toBe(201);
    const resource = await created.json();

    try {
      const saved = await request.post('/api/v1/resources/save', {
        data: {
          id: resource.id,
          title: resource.title,
          content: '# Updated note\n\nNo links here.',
          tags: [],
          summary: '',
          is_public: false,
        },
      });
      expect(saved.status()).toBe(200);

      const fetched = await request.get(`/api/v1/resources/${encodeURIComponent(resource.id)}`);
      expect(fetched.status()).toBe(200);
      const body = await fetched.json();
      expect(body.metadata.tags).toEqual([]);
      expect(body.metadata.summary).toBe('');
      expect(body.metadata.wikilinks).toEqual([]);
    } finally {
      if (typeof resource.filePath === 'string') {
        await rm(resource.filePath, { force: true });
      }
    }
  });

  test('vault sync accepts its current typed metadata and indexes the imported note', async ({
    sessionPage,
    request,
  }) => {
    const vaultName = `e2e-metadata-${Date.now()}`;
    const sync = await request.post('/api/v1/vault/sync', {
      multipart: {
        vaultName,
        paths: 'imported-note.md',
        files: {
          name: 'imported-note.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from([
            '---',
            'title: Imported note',
            'tier: public',
            'ogImage: null',
            'tags: [e2e, metadata]',
            'wikilinks: [related-note]',
            '---',
            '',
            '# Imported note',
          ].join('\n')),
        },
      },
    });

    expect(sync.status()).toBe(200);
    const result = await sync.json();
    expect(result.stats.errors).toEqual([]);
    expect(result.stats.documentsCount).toBe(1);

    const id = `document:${vaultName.replace(/[^a-z0-9]+/g, '-')}_imported-note`;
    const fetched = await request.get(`/api/v1/resources/${encodeURIComponent(id)}`);
    expect(fetched.status()).toBe(200);
    const resource = await fetched.json();
    expect(resource.metadata.tier).toBe('public');
    expect(resource.metadata.tags).toEqual(['e2e', 'metadata']);
    expect(resource.metadata.wikilinks).toEqual(['related-note']);
    expect(resource.content).toContain('# Imported note');
  });

  test('POST /api/v1/resources/save requires an existing resource id', async ({
    sessionPage,
    request,
  }) => {
    const res = await request.post('/api/v1/resources/save', {
      data: {
        path: `md:e2e_test_${Date.now()}`,
        title: 'E2E Created Resource',
        content: '# E2E\n\nCreated by Playwright vault API test.',
        type: 'md',
        metadata: { tags: ['e2e'] },
        is_public: false,
      },
    });

    expect(res.status()).toBe(400);
  });

  test('unauthenticated POST /api/v1/resources/save → 401', async ({ request }) => {
    // Use a fresh context without cookies
    const res = await request.post('/api/v1/resources/save', {
      data: {
        path: 'document:unauthorized_attempt',
        title: 'Unauthorized',
        content: '# Unauthorized',
        type: 'md',
        metadata: {},
      },
      // Explicitly remove any cookies
      headers: { Cookie: '' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('seeded API key authenticates protected resource endpoint', async ({ request }) => {
    const res = await request.post('/api/v1/resources/save', {
      data: { id: 'document:missing_api_key_test', title: 'API key test', content: '# test' },
      headers: {
        Authorization: `Bearer ${SEEDED_API_KEY}`,
      },
    });
    expect(res.status()).toBe(404);
  });

  test('invalid/revoked API key → 401', async ({ request }) => {
    // Try using a completely fake key for a protected endpoint
    const res = await request.post('/api/v1/resources/save', {
      data: { path: 'document:test', title: 'test', content: '# test', type: 'md', metadata: {} },
      headers: {
        Authorization: `Bearer ${INVALID_API_KEY}`,
        Cookie: '', // no session cookie
      },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('API key with wrong format → 401 (not workspace_key_ prefix)', async ({ request }) => {
    const res = await request.post('/api/v1/resources/save', {
      data: { id: 'document:missing_api_key_test', title: 'API key test', content: '# test' },
      headers: {
        Authorization: 'Bearer wrong_format_key_12345',
        Cookie: '',
      },
    });
    expect([401, 403]).toContain(res.status());
  });
});
