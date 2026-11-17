import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { filterViewableResources } from '../../../../lib/permissions';
import { buildResourcePath } from '../../../../lib/resourceUrls';
import { json } from '../../../../lib/api';
import { contentIndexCache, rawDbResourcesCache } from '../../../../lib/cache/searchCache';

export interface SearchIndexItem {
  id: string;
  type: string;
  title: string;
  url: string;
  slug: string;
  category: string;
  tags: string[];
  summary: string;
}

export const GET: APIRoute = async ({ locals }) => {
  const currentUser = locals.user || 'user:anonymous';

  // 1. Check user-specific search index cache
  const cachedItems = contentIndexCache.get(currentUser) as SearchIndexItem[] | null;
  if (cachedItems) {
    return json(cachedItems, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Cache': 'HIT',
      },
    });
  }

  try {
    // 3. Fetch raw resource records from DB cache or execute query
    let rows = rawDbResourcesCache.get('raw_resources_500');
    if (!rows) {
      const res = await query(
        `SELECT id, type, title, metadata, is_public, is_draft, owner_id 
         FROM resources 
         WHERE type NOT IN ('folder', 'space')
         ORDER BY updated_at DESC, title ASC
         LIMIT 500`
      );
      rows = res.rows || [];
      rawDbResourcesCache.set('raw_resources_500', rows, 120_000);
    }

    const allowed = await filterViewableResources(rows, currentUser);

    const snippets = (await import('../../../../lib/vaultContent')).getVaultContentSnippets();

    const indexItems: SearchIndexItem[] = allowed.map((r) => {
      const meta = r.metadata || {};
      const slug = meta.slug || r.id.replace(/^[^:]+:/, '');
      const tags = Array.isArray(meta.tags)
        ? meta.tags
        : typeof meta.tags === 'string'
          ? [meta.tags]
          : [];

      // Prefer explicit summary -> fallback to body snippet -> metadata description
      const snippet = snippets.get(slug) || (meta.filePath ? snippets.get(meta.filePath) : '') || '';
      const summary = (meta.summary || meta.description || snippet).slice(0, 220);

      return {
        id: r.id,
        type: r.type,
        title: r.title,
        url: buildResourcePath({ id: r.id, type: r.type }, r.path),
        slug,
        category: meta.category || 'General',
        tags,
        summary,
      };
    });

    // 4. Cache processed search index for this user
    contentIndexCache.set(currentUser, indexItems, 120_000);

    return json(indexItems, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Cache': 'MISS',
      },
    });
  } catch (error: any) {
    return json({ error: error.message }, {
      status: 500,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
};
