import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { locateResource } from '../../../../lib/graph-tiles/store';

/** Position of a resource in the tiled graph ("fly to"), if the viewer may see it. */
export const GET: APIRoute = async ({ url, locals }) => {
  const currentUser = locals.user || 'user:anonymous';
  const id = url.searchParams.get('id') ?? '';
  try {
    const node = await locateResource(currentUser, id);
    if (!node) return json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return json(node, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch {
    return json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
