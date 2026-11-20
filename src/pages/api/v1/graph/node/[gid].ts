import type { APIRoute } from 'astro';
import { json } from '../../../../../lib/api';
import { resolveNode } from '../../../../../lib/graph-tiles/store';

/** Resolve a tile node id to a resource (id, title, path) the viewer may open. */
export const GET: APIRoute = async ({ params, locals }) => {
  const currentUser = locals.user || 'user:anonymous';
  const gid = Number(params.gid);
  try {
    const node = await resolveNode(currentUser, gid);
    if (!node) return json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return json(node, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch {
    return json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
