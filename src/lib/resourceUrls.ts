import { createHash } from 'node:crypto';

/**
 * URL scheme for the "everything is a resource" workspace.
 *
 * Canonical pattern (Medium/GitHub/Notion model):
 *   /{slug-in-id}-{shortId}
 *
 * - shortId is a deterministic, URL-safe, fixed-length token derived from the
 *   immutable resource id, so URLs are permanent and never collide.
 * - The slug prefix is cosmetic (used for readability + keyword signal); the
 *   shortId is what resolution keys on.
 * - Legacy `/?doc=<id>` remains supported as the migration window.
 */
export const SHORT_ID_LENGTH = 10;

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Stable, collision-resistant short token derived from the immutable resource id. */
export function deriveShortId(id: string): string {
  const digest = createHash('sha256').update(id).digest();
  let bigint = 0n;
  for (const byte of digest.slice(0, 8)) {
    bigint = (bigint << 8n) | BigInt(byte);
  }
  const base = BigInt(BASE36.length);
  let out = '';
  while (bigint > 0n) {
    out = BASE36[Number(bigint % base)] + out;
    bigint /= base;
  }
  return out.padStart(SHORT_ID_LENGTH, '0').slice(0, SHORT_ID_LENGTH);
}

/** Inner slug portion of an id like `document:my-note` -> `my-note`. */
export function getResourceIdSlug(id: string): string {
  return id.replace(/^[^:]+:/, '');
}

/** Pretty, canonical application path for a resource node. */
export function buildResourcePath(r: { id: string; type?: string }, folderPath?: string): string {
  const type = r.type || String(r.id).replace(/:.*$/, '');
  const slug = getResourceIdSlug(r.id);

  if (type === 'folder' || type === 'space') {
    return `/folders/${encodeURIComponent(folderPath || r.id)}`;
  }
  if (type === 'canvas') {
    return `/studio/canvas/${encodeURIComponent(slug)}`;
  }
  return `/${encodeURIComponent(slug)}-${deriveShortId(r.id)}`;
}

/** Matches `/some-slug-d3k2m0x9vq` style paths; returns the trailing shortId token. */
const SHORT_PATH_RE = /^\/[a-z0-9_]+(?:-[a-z0-9_]+)*-([0-9a-z]{10})\/?$/;

export function parseShortIdFromPath(pathname: string): string | null {
  const m = pathname.match(SHORT_PATH_RE);
  return m ? m[1] : null;
}

/** Remove view/UI state flags (edit, etc.) that must never leak into a canonical URL. */
export function canonicalFromUrl(url: URL): string {
  const next = new URL(url.href);
  for (const key of ['edit']) next.searchParams.delete(key);
  return next.pathname + next.search;
}