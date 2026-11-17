import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { canUserViewResource, canUserEditResource } from '../../../../lib/permissions';
import { renderMarkdownWithEmbedsAsync } from '../../../../lib/renderEngine';
import { resolveResourceType } from '../../../../lib/registry/resourceRegistry';
import * as fs from 'fs';
import * as path from 'path';
import { json } from '../../../../lib/api';
import { auditContent } from '../../../../lib/acl/auditContent';

/**
 * Universal Workspace Resource API Endpoint
 * Handles GET (fetch/enrich) and PUT (save/update) for any workspace resource:
 * - Mermaid Diagrams (.mmd)
 * - Excalidraw Sketches (.excalidraw)
 * - Jupyter Notebooks (.ipynb)
 * - Academic Research Papers (.md)
 * - Tabular Spreadsheets (.csv)
 */

function findResourceOnDisk(target: string): string | null {
  if (!target) return null;
  const cleanTarget = decodeURIComponent(target)
    .replace(/^paper:/, '')
    .replace(/^excalidraw:/, '')
    .replace(/^diagram:/, '')
    .replace(/^jupyter:/, '')
    .replace(/^sheet:/, '')
    .replace(/^\/+/, '');

  const candidates: string[] = [
    path.join(process.cwd(), cleanTarget),
    path.join(process.cwd(), 'content', 'public_vault', cleanTarget),
    path.join(process.cwd(), 'content', cleanTarget),
    path.join(process.cwd(), 'public', cleanTarget),
  ];

  const searchSubdirs = [
    'diagrams',
    'sketches',
    'notebooks',
    'research/papers',
    'research',
    'sheets',
    'canvas',
  ];

  const base = path.basename(cleanTarget);
  for (const dir of searchSubdirs) {
    candidates.push(path.join(process.cwd(), 'content', 'public_vault', dir, base));
    candidates.push(path.join(process.cwd(), 'content', 'public_vault', dir, `${base}.md`));
    candidates.push(path.join(process.cwd(), 'content', 'public_vault', dir, `${base}.mmd`));
    candidates.push(path.join(process.cwd(), 'content', 'public_vault', dir, `${base}.excalidraw`));
    candidates.push(path.join(process.cwd(), 'content', 'public_vault', dir, `${base}.ipynb`));
    candidates.push(path.join(process.cwd(), 'content', 'public_vault', dir, `${base}.csv`));
  }

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }

  return null;
}

export const GET: APIRoute = async ({ params, url, locals }) => {
  const rawId = params.id || '';
  const cleanId = decodeURIComponent(rawId);
  const currentUser = locals.user || 'user:anonymous';
  // SECURITY: `as_user` was accepted here as a request parameter —
  // `url.searchParams.get('as_user') || locals.user || 'user:anonymous'` — and
  // the value was passed straight into `canUserViewResource()` and into embed
  // rendering, so it *was* the authorization identity.
  //
  // It was a complete unauthenticated read bypass. Verified live:
  //   GET /api/v1/resources/<private>?as_user=<owner>  -> 200, content served
  //   GET /api/v1/resources/canvas/my-canvas?as_user=<owner> -> 200, 4 nodes
  // without the parameter the same requests returned 403.
  //
  // The identity now comes only from the session, which the middleware has
  // already resolved (to `user:anonymous` when there is none). There is no
  // request-shaped way to assert an identity.


  try {
    let dbRow: any = null;
    const dbRes = await query(
      `SELECT id, type, parent_id, owner_id, path, title, content, metadata, is_public, is_draft
       FROM resources 
       WHERE id = $1 OR id = $2 OR metadata->>'slug' = $3 LIMIT 1`,
      [cleanId, `paper:${cleanId}`, cleanId]
    );

    if (dbRes.rows && dbRes.rows.length > 0) {
      dbRow = dbRes.rows[0];
      const allowed = await canUserViewResource(dbRow, currentUser);
      if (!allowed) {
        return json({ error: 'Access denied to this resource' }, { status: 403 });
      }
    }

    const storedFilePath = dbRow?.metadata?.filePath;
    const diskPath = storedFilePath && fs.existsSync(storedFilePath)
      ? storedFilePath
      : findResourceOnDisk(cleanId);
    if (!dbRow && !diskPath) {
      return json({ error: `Resource not found: ${cleanId}` }, { status: 404 });
    }

    const typeDef = resolveResourceType({
      type: dbRow?.type,
      id: cleanId,
      file: diskPath ? path.basename(diskPath) : undefined,
    });

    let rawContent: string = dbRow?.content || '';
    if (diskPath && (!rawContent || diskPath.endsWith('.excalidraw') || diskPath.endsWith('.mmd') || diskPath.endsWith('.ipynb') || diskPath.endsWith('.csv'))) {
      try {
        rawContent = fs.readFileSync(diskPath, 'utf-8');
      } catch (e) {
        console.warn('[Resource API] Failed to read file from disk:', diskPath, e);
      }
    }

    const responsePayload: any = {
      id: dbRow?.id || cleanId,
      title: dbRow?.title || (diskPath ? path.basename(diskPath, path.extname(diskPath)).replace(/[-_]/g, ' ') : cleanId),
      type: typeDef.type,
      category: typeDef.category,
      filePath: diskPath || dbRow?.metadata?.filePath,
      content: rawContent,
      metadata: dbRow?.metadata || {},
    };

    // 1. Enrich Research Papers with frontmatter, abstract, authors, and rendered HTML
    if (typeDef.type === 'paper' || (diskPath && diskPath.endsWith('.md')) || cleanId.startsWith('paper:')) {
      const fileRaw = rawContent;
      const fmMatch = fileRaw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      const yaml = fmMatch ? fmMatch[1] : '';
      const body = fmMatch ? fmMatch[2] : fileRaw;

      const parsedFm: Record<string, any> = {};
      yaml.split(/\r?\n/).forEach((line) => {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const k = line.slice(0, idx).trim();
          let v = line.slice(idx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (/^\d+$/.test(v)) parsedFm[k] = parseInt(v, 10);
          else if (/^\d+\.\d+$/.test(v)) parsedFm[k] = parseFloat(v);
          else parsedFm[k] = v;
        }
      });

      const authorsMatch = body.match(/\*\*Authors\*\*:\s*([^\n]+)/);
      const venueMatch = body.match(/\*\*Venue\*\*:\s*([^\n]+)/);
      const publisherMatch = body.match(/\*\*Publisher\*\*:\s*([^\n]+)/);
      const doiMatch = body.match(/\*\*DOI\*\*:\s*([^\n]+)/);
      const trackMatch = body.match(/\*\*Research Track\*\*:\s*([^\n]+)/);
      const abstractMatch = body.match(/##\s*📖\s*Abstract\s*\r?\n+>\s*([^\n#]+(?:\r?\n>[^\n#]+)*)/);
      const pdfMatch = body.match(/!\[\[(pdf:[^\]]+)\]\]/);

      const cleanAbstract = abstractMatch ? abstractMatch[1].replace(/\r?\n>\s*/g, ' ').trim() : '';

      responsePayload.paperDetails = {
        paperIndex: parsedFm.paper_index,
        year: parsedFm.year,
        citations: parsedFm.citations,
        fwci: parsedFm.fwci,
        openAccess: parsedFm.open_access_status,
        track: parsedFm.track || (trackMatch ? trackMatch[1] : ''),
        authors: authorsMatch ? authorsMatch[1] : '',
        venue: venueMatch ? venueMatch[1] : parsedFm.venue,
        publisher: publisherMatch ? publisherMatch[1] : parsedFm.publisher,
        doi: doiMatch ? doiMatch[1] : parsedFm.doi,
        abstract: cleanAbstract || responsePayload.metadata?.summary || '',
        pdfAssetId: pdfMatch ? pdfMatch[1] : null,
        readingStage: parsedFm.reading_stage,
      };

      responsePayload.summary = cleanAbstract || responsePayload.metadata?.summary || '';
      responsePayload.renderedHtml = await renderMarkdownWithEmbedsAsync(fileRaw, currentUser);
    }

    // 2. Enrich Excalidraw Sketches
    if (typeDef.type === 'excalidraw' || (diskPath && diskPath.endsWith('.excalidraw'))) {
      try {
        const parsed = JSON.parse(rawContent);
        responsePayload.elements = parsed.elements || parsed;
        responsePayload.appState = parsed.appState || { theme: 'dark' };
      } catch (e) {
        console.warn('[Resource API] Failed to parse excalidraw JSON:', e);
      }
    }

    // 3. Enrich Mermaid Diagrams
    if (typeDef.type === 'mermaid' || (diskPath && (diskPath.endsWith('.mmd') || diskPath.endsWith('.mermaid')))) {
      responsePayload.chart = rawContent;
    }

    // 4. Enrich Jupyter Notebooks
    if (typeDef.type === 'jupyter' || (diskPath && diskPath.endsWith('.ipynb'))) {
      try {
        const parsed = JSON.parse(rawContent);
        responsePayload.cells = parsed.cells || [];
        responsePayload.notebookMetadata = parsed.metadata || {};
      } catch (e) {
        console.warn('[Resource API] Failed to parse ipynb JSON:', e);
      }
    }

    // 5. Enrich Spreadsheets
    if (typeDef.type === 'sheet' || (diskPath && diskPath.endsWith('.csv'))) {
      responsePayload.csvData = rawContent;
    }

    return json(responsePayload, { status: 200, headers: { 'Cache-Control': 'no-cache' } });
  } catch (err: any) {
    console.error('[Resource API] GET Error:', err);
    return json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
};

export const PUT: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const rawId = params.id || '';
  const cleanId = decodeURIComponent(rawId);
  const currentUser = locals.user || 'user:anonymous';

  try {
    const payload = await request.json();
    const content = payload.content !== undefined ? payload.content : payload.chart;
    const elements = payload.elements;
    const appState = payload.appState;
    const title = payload.title;

    let diskPath = findResourceOnDisk(cleanId);
    let resolvedContent = '';

    if (elements && Array.isArray(elements)) {
      // Excalidraw Sketch Payload
      const sketchSpec = {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        elements,
        appState: appState || { theme: 'dark', viewBackgroundColor: '#0f172a' },
      };
      resolvedContent = JSON.stringify(sketchSpec, null, 2);
      if (!diskPath) {
        const baseName = path.basename(cleanId.replace(/^excalidraw:/, ''), '.excalidraw');
        diskPath = path.join(process.cwd(), 'content', 'public_vault', 'sketches', `${baseName}.excalidraw`);
      }
    } else if (content !== undefined) {
      resolvedContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      if (!diskPath) {
        if (cleanId.includes('diagram') || cleanId.endsWith('.mmd')) {
          const baseName = path.basename(cleanId.replace(/^diagram:/, ''), '.mmd');
          diskPath = path.join(process.cwd(), 'content', 'public_vault', 'diagrams', `${baseName}.mmd`);
        } else if (cleanId.includes('sketch') || cleanId.endsWith('.excalidraw')) {
          const baseName = path.basename(cleanId.replace(/^excalidraw:/, ''), '.excalidraw');
          diskPath = path.join(process.cwd(), 'content', 'public_vault', 'sketches', `${baseName}.excalidraw`);
        } else {
          const baseName = path.basename(cleanId, '.md');
          diskPath = path.join(process.cwd(), 'content', 'public_vault', 'research', 'papers', `${baseName}.md`);
        }
      }
    }

    if (diskPath && resolvedContent !== undefined) {
      const dir = path.dirname(diskPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(diskPath, resolvedContent, 'utf-8');
    }

    // Also update PostgreSQL resources table if registered
    try {
      await query(
        `UPDATE resources 
         SET content = COALESCE($1, content),
             title = COALESCE($2, title),
             updated_at = NOW() 
         WHERE id = $3 OR id = $4 OR metadata->>'slug' = $5`,
        [resolvedContent, title, cleanId, `paper:${cleanId}`, cleanId]
      );
    } catch (dbErr) {
      console.warn('[Resource API] DB update skipped or not applicable:', dbErr);
    }

    // Content mutations are audited. They were not: the V5 intrusion (a
    // self-registered `user:admin` writing to another user's canvas) and the V6
    // `?as_user=` read bypass both left zero rows in the audit log. Field NAMES
    // are recorded, never their contents — content does not belong in a log.
    auditContent({
      actor: currentUser,
      action: 'content.update',
      resourceId: cleanId,
      fields: ['content', 'title'],
      detail: { bytes: typeof resolvedContent === 'string' ? resolvedContent.length : undefined },
      ip: clientAddress,
    });

    return new Response(
      JSON.stringify({
        success: true,
        id: cleanId,
        filePath: diskPath,
        message: 'Resource saved and persisted successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    console.error('[Resource API] PUT Error:', err);
    return json({ error: err.message || 'Failed to save resource' }, { status: 500 });
  }
};
