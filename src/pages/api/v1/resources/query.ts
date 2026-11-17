import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { filterViewableResources } from '../../../../lib/permissions';
import { json } from '../../../../lib/api';

export const GET: APIRoute = async ({ url, locals }) => {
  const currentUser = locals.user || 'user:anonymous';

  const type = url.searchParams.get('type');
  const tag = url.searchParams.get('tag');
  const category = url.searchParams.get('category');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);

  const conditions: string[] = ["type NOT IN ('folder', 'space')"];
  const params: any[] = [];

  if (type && type !== 'all') {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }

  if (category) {
    params.push(category);
    conditions.push(`metadata->>'category' = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  try {
    const res = await query(
      `SELECT id, type, title, metadata, is_public, is_draft, owner_id, updated_at
       FROM resources
       WHERE ${whereClause}
       ORDER BY updated_at DESC
       LIMIT ${limit}`,
      params
    );

    let rows = res.rows || [];

    // Filter by tag if requested
    if (tag) {
      const cleanTag = tag.toLowerCase().replace(/^#/, '');
      rows = rows.filter((r) => {
        const metaTags = r.metadata?.tags;
        if (Array.isArray(metaTags)) {
          return metaTags.some((t: string) => t.toLowerCase() === cleanTag);
        }
        return false;
      });
    }

    const viewable = await filterViewableResources(rows, currentUser);

    return new Response(
      JSON.stringify({
        count: viewable.length,
        results: viewable.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          category: r.metadata?.category || 'General',
          tags: r.metadata?.tags || [],
          updatedAt: r.updated_at,
          slug: r.metadata?.slug || r.id,
          summary: (r.metadata?.summary || '').slice(0, 160),
        })),
        items: viewable.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          category: r.metadata?.category || 'General',
          tags: r.metadata?.tags || [],
          updated_at: r.updated_at,
          updatedAt: r.updated_at,
          slug: r.metadata?.slug || r.id,
          summary: (r.metadata?.summary || '').slice(0, 160),
        })),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
