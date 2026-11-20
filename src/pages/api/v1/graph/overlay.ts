import type { APIRoute } from 'astro';
import { readOverlay } from '../../../../lib/graph-tiles/store';

/**
 * Nodes shared with the viewer by name or through a group (not in any layer
 * pyramid), inside the requested view rectangle, as one binary leaf tile.
 * Every node is verified against the engine as the viewer.
 *
 *   GET /api/v1/graph/overlay?x0=&y0=&x1=&y1=&limit=
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const currentUser = locals.user || 'user:anonymous';
  const num = (k: string) => Number(url.searchParams.get(k));
  const [x0, y0, x1, y1] = ['x0', 'y0', 'x1', 'y1'].map(num);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
    return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const body = await readOverlay({ currentUser, x0, y0, x1, y1, limit: num('limit') || 1500 });
    if (!body) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return new Response(body as BodyInit, {
      headers: { 'Content-Type': 'application/vnd.graph-tile', 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } });
  }
};
