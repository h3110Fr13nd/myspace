import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { getGraphMeta } from '../../../../lib/graph-tiles/store';

/**
 * Which tile layers make up this viewer's graph, and where they live.
 *
 * Cheap (two cached row reads) and small; the client calls it once when the
 * graph opens and again only if a tile answers 410 (generation replaced).
 * An empty `layers` list means no pyramid has been built yet, and the client
 * falls back to the classic whole-graph view.
 */
export const GET: APIRoute = async ({ locals }) => {
  const currentUser = locals.user || 'user:anonymous';
  try {
    return json(await getGraphMeta(currentUser), {
      headers: { 'Cache-Control': 'private, max-age=5' },
    });
  } catch {
    return json({ version: 1, layers: [], nodes: 0, error: 'unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
    });
  }
};
