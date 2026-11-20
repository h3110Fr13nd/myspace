import type { APIRoute } from 'astro';
import { isWorkspaceMember, readTile } from '../../../../../../../../../lib/graph-tiles/store';
import { WORKSPACE_SCOPE, resolveScopeParam } from '../../../../../../../../../lib/graph-tiles/scopes';

/**
 * One binary graph tile (GTL1, see lib/spatial-tiles/codec.ts).
 *
 * `layer` is `public`, `workspace` or `me`; a user id never appears in a URL. Anything else
 * is a 404 rather than a 403 so probing cannot enumerate scopes. The payload is
 * stored gzip-compressed and passed through untouched.
 */
export const GET: APIRoute = async ({ params, locals, request }) => {
  const currentUser = locals.user || 'user:anonymous';
  const scope = resolveScopeParam(params.layer, currentUser);
  if (!scope) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  // The workspace layer is for verified members only (checked, memoised briefly).
  if (scope === WORKSPACE_SCOPE && !(await isWorkspaceMember(currentUser))) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const int = (v: string | undefined) => (v !== undefined && /^\d{1,10}$/.test(v) ? Number(v) : NaN);
  try {
    const result = await readTile({
      scope,
      generation: int(params.generation),
      z: int(params.z),
      x: int(params.x),
      y: int(params.y),
      ifNoneMatch: request.headers.get('if-none-match'),
    });
    return new Response(result.body ? (result.body as BodyInit) : null, {
      status: result.status,
      headers: result.headers,
    });
  } catch {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } });
  }
};
