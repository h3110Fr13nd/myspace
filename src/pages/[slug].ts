import type { APIRoute } from 'astro';
import { query } from '../lib/db';
import { deriveShortId, parseShortIdFromPath } from '../lib/resourceUrls';
import { listResourceTypes } from '../lib/registry/resourceRegistry';

/** Resolve canonical resource paths, then hand authorization/rendering to `/`. */
export const GET: APIRoute = async ({ url, redirect }) => {
  const shortId = parseShortIdFromPath(url.pathname);
  if (!shortId) return new Response('Not found', { status: 404 });

  const separatorIndex = url.pathname.length - shortId.length - 1;
  if (url.pathname[separatorIndex] !== '-') return new Response('Not found', { status: 404 });
  const slug = decodeURIComponent(url.pathname.slice(1, separatorIndex));
  const candidateIds = listResourceTypes().map(({ type }) => `${type}:${slug}`);

  try {
    const result = await query(
      'SELECT id FROM resources WHERE id = ANY($1::varchar[]) LIMIT 2',
      [candidateIds]
    );
    const resource = result.rows.find((row: { id: string }) => deriveShortId(row.id) === shortId);
    if (!resource) return new Response('Not found', { status: 404 });
    const destination = new URL('/', url);
    destination.searchParams.set('doc', resource.id);
    if (url.searchParams.get('edit') === 'true') destination.searchParams.set('edit', 'true');
    return redirect(`${destination.pathname}${destination.search}`, 302);
  } catch {
    return new Response('Resource unavailable', { status: 503 });
  }
};
