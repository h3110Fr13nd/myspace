import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';
import { renderMarkdownWithEmbedsAsync } from '../../../lib/renderEngine';
import * as fs from 'fs';
import { json } from '../../../lib/api';
import { canUserViewResource } from '../../../lib/permissions';
import { resolveDocumentFilePath } from '../../../lib/workspace/documentResolver';

export const GET: APIRoute = async ({ url, locals }) => {
  const rawDoc = url.searchParams.get('doc');
  if (!rawDoc) {
    return json({ error: 'Missing doc parameter' }, { status: 400 });
  }

  const cleanId = decodeURIComponent(rawDoc);
  // Identity comes only from the session. This previously fell back to a hardcoded
  // `user:demo` — a specific person named in an authorization path, so every
  // unauthenticated request was attributed to them. See the note in
  // src/pages/api/v1/assets/pdf/[id].ts.
  const currentUser = locals.user || 'user:anonymous';

  try {
    const dbRes = await query(
      `SELECT id, type, title, metadata, owner_id, is_draft, parent_id, path
       FROM resources
       WHERE id = $1 OR metadata->>'slug' = $2 OR id = $3
       LIMIT 1`,
      [cleanId, cleanId, `document:${cleanId}`]
    );

    const doc = dbRes.rows[0];
    if (!doc) {
      return json({ error: 'Resource not found' }, { status: 404 });
    }

    if (!(await canUserViewResource(doc, currentUser))) {
      return json(
        { error: 'Resource not found' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    let htmlBody = '';

    if (doc.type === 'document') {
      const targetFilePath = resolveDocumentFilePath(doc);
      if (targetFilePath && fs.existsSync(targetFilePath)) {
        const fileRaw = fs.readFileSync(targetFilePath, 'utf-8');
        htmlBody = await renderMarkdownWithEmbedsAsync(fileRaw, currentUser, 1);
      } else {
        htmlBody = `<p>${doc.metadata?.summary || doc.title}</p>`;
      }
    } else if (doc.type === 'pdf') {
      const cleanSlug = doc.id.replace(/^pdf:/, '').replace(/\.pdf$/, '');
      const pdfUrl = `/api/v1/assets/pdf/${encodeURIComponent(cleanSlug)}`;
      htmlBody = `
        <div style="width: 100%; height: 360px; border-radius: 8px; overflow: hidden; background: rgba(5, 8, 20, 0.9);">
          <iframe src="${pdfUrl}" width="100%" height="100%" style="border: none;" />
        </div>
      `;
    } else if (doc.type === 'image') {
      const cleanSlug = doc.id.replace(/^image:/, '');
      const imageUrl = doc.metadata?.url || `/api/v1/assets/image/${encodeURIComponent(cleanSlug)}`;
      htmlBody = `
        <div style="width: 100%; text-align: center; padding: 0.5rem 0;">
          <img src="${imageUrl}" alt="${doc.title}" style="max-width: 100%; max-height: 360px; height: auto; border-radius: 8px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);" />
        </div>
      `;
    } else {
      htmlBody = `<p style="color: var(--text-secondary);">${doc.metadata?.summary || doc.title}</p>`;
    }

    const body = JSON.stringify({
      id: doc.id,
      type: doc.type,
      title: doc.title,
      category: doc.metadata?.category || 'Research Note',
      tags: doc.metadata?.tags || [],
      htmlBody,
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
