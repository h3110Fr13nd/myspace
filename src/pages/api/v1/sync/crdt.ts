import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { json } from '../../../../lib/api';

export const POST: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get('Authorization') || '';
  const expectedSecret = process.env.INTERNAL_SYNC_SECRET || 'foss_collab_internal_secret_key';

  if (!authHeader.endsWith(expectedSecret)) {
    return json({ error: 'Unauthorized DO webhook' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { resourceId, activeUsers } = body;

    if (!resourceId) {
      return json({ error: 'Missing resourceId' }, { status: 400 });
    }

    // Update revision timestamp and metadata
    await query(
      `UPDATE resources 
       SET updated_at = NOW(),
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{lastSyncedBy}', '"cloudflare-durable-object"')
       WHERE id = $1 OR metadata->>'slug' = $1`,
      [resourceId]
    );

    return new Response(
      JSON.stringify({
        success: true,
        resourceId,
        activeUsers,
        syncedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[API /sync/crdt] Error:', err.message);
    return json({ error: err.message }, { status: 500 });
  }
};
