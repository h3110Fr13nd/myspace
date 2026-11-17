import type { APIRoute } from 'astro';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { getAssetStream } from '../../../../../lib/storage';
import { query } from '../../../../../lib/db';

/** Authorization is enforced by the asset middleware before this handler. */
export const GET: APIRoute = async ({ params, locals }) => {
  const cleanId = (params.id || '').replace(/^pdf:/, '').replace(/\.pdf$/, '');
  if (!cleanId || cleanId.includes('/') || cleanId.includes('\\')) {
    return new Response('Invalid PDF identifier', { status: 400 });
  }
  const fileName = `${cleanId}.pdf`;
  let storageKey: string | undefined;
  try {
    const result = await query('SELECT metadata FROM resources WHERE id = $1 LIMIT 1', [`pdf:${cleanId}`]);
    const registeredKey = result.rows[0]?.metadata?.storageKey;
    if (typeof registeredKey === 'string' && registeredKey) storageKey = registeredKey;
  } catch {
    return new Response('PDF details are temporarily unavailable. Please retry.', { status: 503 });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'no-store, private',
    'X-Authorized-User': locals.user || 'user:anonymous',
  };

  // Retain legacy local PDFs, while registered uploads always use their own key.
  if (!storageKey) {
    for (const directory of ['public/pdfs', 'temp/extra/docs/papers/pdfs']) {
      try {
        const buffer = await readFile(path.join(process.cwd(), directory, fileName));
        return new Response(buffer, { headers: { ...headers, 'Content-Length': String(buffer.length), 'X-Source-Storage': 'Local-PDF-Repository' } });
      } catch (error: any) {
        if (error.code !== 'ENOENT') return new Response('PDF could not be read. Please retry.', { status: 503 });
      }
    }
  }

  try {
    const asset = await getAssetStream(storageKey || fileName);
    if (!asset.stream) throw new Error('Missing asset body');
    const body = Readable.toWeb(Readable.from(asset.stream as AsyncIterable<Uint8Array>)) as ReadableStream<Uint8Array>;
    if (asset.contentLength !== undefined) headers['Content-Length'] = String(asset.contentLength);
    headers['X-Source-Storage'] = 'R2-S3-Private-Bucket';
    return new Response(body, { headers });
  } catch (error: any) {
    const missing = error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404;
    return new Response(missing ? 'PDF file is unavailable.' : 'PDF storage is temporarily unavailable. Please retry.', { status: missing ? 404 : 503 });
  }
};
