import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { canUserViewResource } from '../../../../lib/permissions';
import { json } from '../../../../lib/api';
import { config } from '../../../../lib/config';
import { consumeRateLimit } from '../../../../lib/rateLimit';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, clientAddress }) => {
  const url = new URL(request.url);
  const resourceId = url.searchParams.get('id');
  const limitParam = parseInt(url.searchParams.get('limit') || '4', 10);
  const limit = Math.min(Math.max(1, limitParam), 10);
  const currentUser = locals.user || 'user:anonymous';

  if (config.rateLimit) {
    const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
    const actor = currentUser !== 'user:anonymous' ? currentUser : ip;
    const rule = await consumeRateLimit({ key: 'expensive:similar:' + actor, limit: 30, windowSec: 60 });
    if (!rule.allowed) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rule.retryAfterSec) },
      });
    }
  }

  if (!resourceId) {
    return json({ error: 'Missing required query parameter "id"' }, { status: 400 });
  }

  try {
    // 1. Fetch top candidates by cosine similarity from pgvector
    const sql = `
      WITH target AS (
        SELECT embedding FROM resource_embeddings WHERE resource_id = $1 LIMIT 1
      )
      SELECT r.id, r.type, r.title, r.owner_id, r.metadata, r.is_public, r.is_draft,
             ROUND((1 - (re.embedding <=> target.embedding))::numeric * 100, 1) as similarity_pct
      FROM resource_embeddings re
      JOIN resources r ON r.id = re.resource_id
      CROSS JOIN target
      WHERE re.resource_id != $1
      ORDER BY re.embedding <=> target.embedding ASC
      LIMIT 25;
    `;

    const dbRes = await query(sql, [resourceId]);
    const candidates = dbRes.rows || [];

    // 2. Strict ReBAC permission filtering: never leak private/draft items
    const permittedItems: any[] = [];
    for (const item of candidates) {
      const allowed = await canUserViewResource(item, currentUser);
      if (allowed) {
        permittedItems.push({
          id: item.id,
          type: item.type,
          title: item.title,
          similarityPct: parseFloat(item.similarity_pct),
          summary: item.metadata?.summary || item.metadata?.description || '',
          tags: item.metadata?.tags || [],
          category: item.metadata?.category || '',
          url: `/?doc=${encodeURIComponent(item.metadata?.slug || item.id)}`,
        });
        if (permittedItems.length >= limit) {
          break;
        }
      }
    }

    return json({ items: permittedItems }, { status: 200 });
  } catch (error: any) {
    console.error('[API Similar Content Error]:', error.message);
    return json({ error: 'Failed to retrieve recommendations', details: error.message }, { status: 500 });
  }
};

