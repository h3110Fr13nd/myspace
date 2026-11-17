import type { APIRoute } from 'astro';
import { Readable } from 'node:stream';
import { getAssetStream } from '../../../../../lib/storage';
import { query } from '../../../../../lib/db';

/** Authorization is enforced by the asset middleware before this handler. */
export const GET: APIRoute = async ({ params, locals }) => {
  const cleanId = (params.id || '').replace(/^image:/, '').replace(/\.(jpg|jpeg|png|webp|svg)$/, '');
  if (!cleanId || cleanId.includes('/') || cleanId.includes('\\')) return new Response('Invalid image identifier', { status: 400 });
  let storageKey: string | undefined;
  let fileName = `${cleanId}.jpg`;
  try {
    const result = await query('SELECT metadata FROM resources WHERE id = $1 LIMIT 1', [`image:${cleanId}`]);
    const metadata = result.rows[0]?.metadata;
    if (typeof metadata?.storageKey === 'string' && metadata.storageKey) storageKey = metadata.storageKey;
    if (typeof metadata?.fileName === 'string' && metadata.fileName) fileName = metadata.fileName;
  } catch {
    return new Response('Image details are temporarily unavailable. Please retry.', { status: 503 });
  }
  try {
    const asset = await getAssetStream(storageKey || `${cleanId}.jpg`);
    if (!asset.stream) throw new Error('Missing image body');
    const headers: Record<string, string> = {
      'Content-Type': asset.contentType || 'image/jpeg',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store, private',
      'X-Authorized-User': locals.user || 'user:anonymous',
      'X-Source-Storage': 'R2-S3-Private-Bucket',
    };
    if (asset.contentLength !== undefined) headers['Content-Length'] = String(asset.contentLength);
    const body = Readable.toWeb(Readable.from(asset.stream as AsyncIterable<Uint8Array>)) as ReadableStream<Uint8Array>;
    return new Response(body, { headers });
  } catch (error: any) {
    const missing = error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404;
    return new Response(missing ? 'Image file is unavailable.' : 'Image storage is temporarily unavailable. Please retry.', { status: missing ? 404 : 503 });
  }
};
