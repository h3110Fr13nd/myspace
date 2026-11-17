import type { APIRoute } from 'astro';
import { query } from '../../../../../lib/db';
import { canUserViewResource, canUserEditResource } from '../../../../../lib/permissions';
import { renderMarkdownWithEmbedsAsync } from '../../../../../lib/renderEngine';
import { resolveResourceType } from '../../../../../lib/registry/resourceRegistry';
import { stripHtml } from '../../../../../lib/render/codeHighlighter';
import * as fs from 'fs';
import * as path from 'path';
import { auditContent } from '../../../../../lib/acl/auditContent';

export const GET: APIRoute = async ({ params, url, locals }) => {
  const rawId = params.id || '';
  const cleanId = decodeURIComponent(rawId)
    .replace(/^canvas[:\/]/, '')
    .replace(/^public_vault\/canvas\//, '')
    .replace(/\.canvas$/, '');
  const canvasResourceId = `canvas:${cleanId}`;

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
    // 1. Fetch canvas resource from PostgreSQL
    let canvasRow: any = null;
    const dbRes = await query(
      `SELECT id, type, parent_id, owner_id, path, title, metadata, is_public, is_draft 
       FROM resources 
       WHERE id = $1 OR id = $2 OR metadata->>'slug' = $3 OR metadata->>'slug' = $4 
       LIMIT 1`,
      [canvasResourceId, cleanId, cleanId, `canvas_${cleanId}`]
    );

    if (dbRes.rows && dbRes.rows.length > 0) {
      canvasRow = dbRes.rows[0];
    }

    // 2. Fallback: Search filesystem for .canvas file if not yet registered in DB
    let diskData: any = null;
    let canvasTitle = cleanId.replace(/[-_]/g, ' ');
    const candidateFiles = [
      path.join(process.cwd(), 'content', 'public_vault', 'canvas', `${cleanId}.canvas`),
      path.join(process.cwd(), 'content', 'public_vault', 'canvas', `${cleanId.replace(/^track-/, '')}.canvas`),
      path.join(process.cwd(), 'public', `${cleanId}.canvas`),
    ];

    for (const p of candidateFiles) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf-8');
          diskData = JSON.parse(raw);
          break;
        } catch (e) {
          console.warn(`[Canvas API] Failed to parse disk file ${p}:`, e);
        }
      }
    }

    if (!canvasRow && !diskData) {
      return new Response(
        JSON.stringify({ error: 'NotFound', message: `Canvas '${canvasResourceId}' not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Evaluate canvas-level ReBAC permissions
    if (canvasRow) {
      const isAllowed = await canUserViewResource(canvasRow, currentUser);
      if (!isAllowed) {
        return new Response(
          JSON.stringify({ error: 'Forbidden', message: `Access denied to canvas '${canvasResourceId}' for ${currentUser}` }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      canvasTitle = canvasRow.title || canvasTitle;
    }

    // 4. Resolve raw canvas data
    let rawCanvas = canvasRow?.metadata?.canvasData || diskData || { nodes: [], edges: [] };
    const nodes: any[] = Array.isArray(rawCanvas.nodes) ? [...rawCanvas.nodes] : [];
    const edges: any[] = Array.isArray(rawCanvas.edges) ? [...rawCanvas.edges] : [];

    // 5. Gather all resource IDs referenced by nodes to evaluate node-level permissions & metadata
    const resourceIds = nodes
      .map((n) => n.resourceId || (typeof n.file === 'string' && n.file.includes(':') ? n.file : undefined))
      .filter((id): id is string => Boolean(id && typeof id === 'string'));

    const resourceMetaMap = new Map<string, any>();
    if (resourceIds.length > 0) {
      const resQuery = await query(
        `SELECT id, type, owner_id, title, metadata, is_public, is_draft 
         FROM resources 
         WHERE id = ANY($1)`,
        [resourceIds]
      );
      (resQuery.rows || []).forEach((row) => {
        resourceMetaMap.set(row.id, row);
      });
    }

    // Helper to search candidate files across workspace directories
    const findFileOnDisk = (relPath: string, subdirs: string[] = ['']): string | null => {
      if (!relPath) return null;
      const cleanRel = relPath.replace(/^\/+/, '');
      const candidates = [
        path.join(process.cwd(), cleanRel),
        path.join(process.cwd(), 'content', 'public_vault', cleanRel),
        path.join(process.cwd(), 'public', cleanRel),
      ];
      for (const s of subdirs) {
        if (s) {
          candidates.push(path.join(process.cwd(), 'content', 'public_vault', s, path.basename(cleanRel)));
          candidates.push(path.join(process.cwd(), 'public', s, path.basename(cleanRel)));
        }
      }
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
      return null;
    };

    // 6. Enforce Node-Level Authorization & Universal Polymorphic Enrichment
    const sanitizedNodes: any[] = [];
    for (const node of nodes) {
      const typeDef = resolveResourceType({
        type: node.resourceType || node.type,
        id: node.resourceId,
        file: node.file,
      });

      const isResourceOrFile = Boolean(
        node.resourceId ||
        node.file ||
        node.type === 'resource' ||
        node.type === 'file'
      );

      if (isResourceOrFile) {
        const targetResId = node.resourceId || (typeof node.file === 'string' && node.file.includes(':') ? node.file : null);
        const targetRes = targetResId ? resourceMetaMap.get(targetResId) : null;

        let allowed = true;
        if (targetRes) {
          allowed = await canUserViewResource(targetRes, currentUser);
        } else {
          // If resource not in DB, evaluate default open access unless explicitly flagged
          allowed = true;
        }

        if (allowed) {
          const resType = typeDef.type;
          let resolvedMeta: any = targetRes?.metadata ? { ...targetRes.metadata } : {};

          // 1. Enrich Research Papers with full frontmatter, abstract, authors, and methodologies
          if (resType === 'paper' || (node.resourceId && node.resourceId.startsWith('paper:'))) {
            let targetPath = resolvedMeta?.filePath;
            if (targetPath && !fs.existsSync(targetPath)) {
              const rel = targetPath.includes('/content/') ? targetPath.slice(targetPath.indexOf('/content/')) : null;
              if (rel && fs.existsSync(path.join(process.cwd(), rel))) {
                targetPath = path.join(process.cwd(), rel);
              }
            }
            if (!targetPath || !fs.existsSync(targetPath)) {
              const slug = resolvedMeta?.slug || (node.resourceId ? node.resourceId.replace('paper:', '') : node.file?.replace(/\.md$/, ''));
              if (slug) {
                const candidate = findFileOnDisk(`${slug}.md`, ['research/papers', 'research']);
                if (candidate) targetPath = candidate;
              }
            }

            if (targetPath && fs.existsSync(targetPath)) {
              try {
                const fileRaw = fs.readFileSync(targetPath, 'utf-8');
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

                resolvedMeta.paperDetails = {
                  paperIndex: parsedFm.paper_index,
                  year: parsedFm.year,
                  citations: parsedFm.citations,
                  fwci: parsedFm.fwci,
                  openAccess: parsedFm.open_access_status,
                  track: parsedFm.track || (trackMatch ? trackMatch[1] : ''),
                  authors: authorsMatch ? authorsMatch[1] : '',
                  venue: venueMatch ? venueMatch[1] : (parsedFm.venue || resolvedMeta.venue),
                  publisher: publisherMatch ? publisherMatch[1] : parsedFm.publisher,
                  doi: doiMatch ? doiMatch[1] : parsedFm.doi,
                  abstract: cleanAbstract || resolvedMeta.summary || node.text || '',
                  pdfAssetId: pdfMatch ? pdfMatch[1] : null,
                  readingStage: parsedFm.reading_stage,
                };

                // Generate rich pre-rendered HTML with full math & embeds
                resolvedMeta.renderedHtml = await renderMarkdownWithEmbedsAsync(fileRaw, currentUser);
              } catch (e) {
                console.warn('[Canvas API] Failed to parse paper file:', e);
              }
            }
          }

          // 2. Enrich Markdown Documents with full renderedHtml
          if (resType === 'document' || (node.file && node.file.endsWith('.md') && !resType.includes('paper'))) {
            let docPath = resolvedMeta?.filePath;
            if (docPath && !fs.existsSync(docPath)) {
              const rel = docPath.includes('/content/') ? docPath.slice(docPath.indexOf('/content/')) : null;
              if (rel && fs.existsSync(path.join(process.cwd(), rel))) {
                docPath = path.join(process.cwd(), rel);
              }
            }
            if (!docPath || !fs.existsSync(docPath)) {
              const fileTarget = node.file || (node.resourceId ? node.resourceId.replace(/^doc:/, '') : '');
              if (fileTarget) {
                docPath = findFileOnDisk(fileTarget.endsWith('.md') ? fileTarget : `${fileTarget}.md`);
              }
            }
            if (docPath && fs.existsSync(docPath)) {
              try {
                const docRaw = fs.readFileSync(docPath, 'utf-8');
                resolvedMeta.renderedHtml = await renderMarkdownWithEmbedsAsync(docRaw, currentUser);
              } catch (e) {
                console.warn('[Canvas API] Failed to parse document file:', e);
              }
            }
          }

          // 3. Enrich Sub-Canvases with live canvasData (nodes, edges)
          if (resType === 'canvas' || (node.resourceId && node.resourceId.startsWith('canvas:')) || (node.file && node.file.endsWith('.canvas'))) {
            if (!resolvedMeta.canvasData) {
              const subId = (node.resourceId || node.file || node.id).replace(/^canvas:/, '').replace(/\.canvas$/, '');
              const candidate = findFileOnDisk(`${subId}.canvas`, ['canvas']);
              if (candidate) {
                try {
                  const raw = fs.readFileSync(candidate, 'utf-8');
                  resolvedMeta.canvasData = JSON.parse(raw);
                } catch (e) {
                  console.warn(`[Canvas API] Failed to parse sub-canvas ${subId}:`, e);
                }
              }
            }
          }

          // 4. Enrich Excalidraw Sketches with elements and appState
          if (resType === 'excalidraw' || (node.file && node.file.includes('.excalidraw'))) {
            if (!resolvedMeta.elements) {
              const fileTarget = node.file || (node.resourceId ? node.resourceId.replace(/^excalidraw:/, '') : '');
              const candidate = fileTarget ? findFileOnDisk(fileTarget.endsWith('.excalidraw') ? fileTarget : `${fileTarget}.excalidraw`, ['sketches']) : null;
              if (candidate) {
                try {
                  const raw = fs.readFileSync(candidate, 'utf-8');
                  const parsed = JSON.parse(raw);
                  resolvedMeta.elements = parsed.elements || parsed;
                  if (parsed.appState) resolvedMeta.appState = parsed.appState;
                } catch (e) {
                  console.warn('[Canvas API] Failed to parse excalidraw file:', e);
                }
              }
            }
          }

          // 5. Enrich Jupyter Notebooks with cells and metadata
          if (resType === 'jupyter' || (node.file && node.file.endsWith('.ipynb'))) {
            if (!resolvedMeta.cells) {
              const fileTarget = node.file || (node.resourceId ? node.resourceId.replace(/^jupyter:/, '') : '');
              const candidate = fileTarget ? findFileOnDisk(fileTarget.endsWith('.ipynb') ? fileTarget : `${fileTarget}.ipynb`, ['notebooks']) : null;
              if (candidate) {
                try {
                  const raw = fs.readFileSync(candidate, 'utf-8');
                  const parsed = JSON.parse(raw);
                  resolvedMeta.cells = parsed.cells || [];
                  resolvedMeta.metadata = parsed.metadata || {};
                  resolvedMeta.nbformat = parsed.nbformat;
                } catch (e) {
                  console.warn('[Canvas API] Failed to parse jupyter file:', e);
                }
              }
            }
          }

          // 6. Enrich Mermaid Diagrams with chart source code
          if (resType === 'mermaid' || (node.file && (node.file.endsWith('.mmd') || node.file.endsWith('.mermaid')))) {
            if (!resolvedMeta.chart) {
              const fileTarget = node.file || (node.resourceId ? node.resourceId.replace(/^mermaid:/, '') : '');
              const candidate = fileTarget ? findFileOnDisk(fileTarget.endsWith('.mmd') || fileTarget.endsWith('.mermaid') ? fileTarget : `${fileTarget}.mmd`, ['diagrams']) : null;
              if (candidate) {
                try {
                  resolvedMeta.chart = fs.readFileSync(candidate, 'utf-8');
                } catch (e) {
                  console.warn('[Canvas API] Failed to parse mermaid file:', e);
                }
              }
            }
          }

          // 7. Enrich Relational Spreadsheets with CSV data
          if (resType === 'sheet' || (node.file && (node.file.endsWith('.csv') || node.file.endsWith('.tsv')))) {
            if (!resolvedMeta.csvData) {
              const fileTarget = node.file || (node.resourceId ? node.resourceId.replace(/^sheet:/, '') : '');
              const candidate = fileTarget ? findFileOnDisk(fileTarget, ['sheets']) : null;
              if (candidate) {
                try {
                  resolvedMeta.csvData = fs.readFileSync(candidate, 'utf-8');
                } catch (e) {
                  console.warn('[Canvas API] Failed to parse sheet file:', e);
                }
              }
            }
          }

          // 8. Enrich PDFs
          if (resType === 'pdf' || (node.file && node.file.endsWith('.pdf'))) {
            const cleanPdfId = (node.resourceId || node.file || '').replace(/^pdf:/, '').replace(/\.pdf$/, '').replace(/^.*\//, '');
            resolvedMeta.pdfAssetId = cleanPdfId;
          }

          const rawFallback = node.label || (node.file ? path.basename(node.file).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') : node.id);
          const fallbackTitle = stripHtml(rawFallback);
          const rawResolvedTitle = targetRes?.title || node.label || fallbackTitle;

          sanitizedNodes.push({
            ...node,
            isAllowed: true,
            resourceType: resType,
            resolvedTitle: stripHtml(rawResolvedTitle),
            resolvedSummary: resolvedMeta?.paperDetails?.abstract || targetRes?.metadata?.summary || targetRes?.metadata?.description || node.text || '',
            resolvedMetadata: resolvedMeta,
          });
        } else {
          // SERVER-SIDE REDACTION: completely strip sensitive data from payload
          sanitizedNodes.push({
            id: node.id,
            type: node.type,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            color: '1', // Red color indicator
            resourceId: node.resourceId,
            resourceType: typeDef.type,
            isAllowed: false,
            label: '🔒 Access Restricted',
            text: `Sensitive node data redacted. User ${currentUser} lacks explicit permission to view this resource.`,
          });
        }
      } else {
        // Standard text, link, group nodes
        sanitizedNodes.push({
          ...node,
          isAllowed: true,
        });
      }
    }

    return new Response(
      JSON.stringify({
        resourceId: canvasResourceId,
        title: canvasTitle,
        metadata: canvasRow?.metadata || {},
        nodes: sanitizedNodes,
        edges: edges,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store',
          'X-Authorized-User': currentUser,
        },
      }
    );
  } catch (err: any) {
    console.error(`[Canvas API Error] Failed to retrieve canvas '${canvasResourceId}':`, err);
    return new Response(
      JSON.stringify({ error: 'InternalError', message: err?.message || 'Failed to retrieve canvas' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const PUT: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const rawId = params.id || '';
  const cleanId = decodeURIComponent(rawId)
    .replace(/^canvas[:\/]/, '')
    .replace(/^public_vault\/canvas\//, '')
    .replace(/\.canvas$/, '');
  const canvasResourceId = `canvas:${cleanId}`;
  const currentUser = locals.user || 'user:anonymous';

  try {
    const payload = await request.json();
    const { title, nodes = [], edges = [], metadata = {} } = payload;

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return new Response(
        JSON.stringify({ error: 'BadRequest', message: 'Payload must include nodes and edges arrays' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Fetch current canvas from DB to check existence and edit permissions
    const dbRes = await query(
      `SELECT id, owner_id, title, metadata, is_public FROM resources WHERE id = $1 LIMIT 1`,
      [canvasResourceId]
    );

    let canvasRow = dbRes.rows?.[0];
    if (canvasRow) {
      // Check ReBAC edit permission if not anonymous or if an owner is recorded
      if (currentUser !== 'user:anonymous' && canvasRow.owner_id && canvasRow.owner_id !== 'user:anonymous') {
        const canEdit = await canUserEditResource(canvasRow, currentUser);
        if (!canEdit) {
          return new Response(
            JSON.stringify({ error: 'Forbidden', message: `User ${currentUser} cannot edit ${canvasResourceId}` }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    const canvasTitle = title || canvasRow?.title || cleanId.replace(/[-_]/g, ' ');

    // 2. Prepare updated metadata with canvasData
    const updatedMetadata = {
      ...(canvasRow?.metadata || {}),
      ...metadata,
      slug: cleanId,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      lastSavedBy: currentUser,
      canvasData: {
        nodes,
        edges,
      },
    };

    // 3. Upsert into PostgreSQL
    if (canvasRow) {
      await query(
        `UPDATE resources 
         SET title = $1, metadata = $2, updated_at = NOW() 
         WHERE id = $3`,
        [canvasTitle, JSON.stringify(updatedMetadata), canvasResourceId]
      );
    } else {
      const pathVal = `space:main/folder:public_vault_canvas/${canvasResourceId}`;
      await query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft, created_at, updated_at) 
         VALUES ($1, 'canvas', 'tenant:default', 'folder:public_vault_canvas', $2, $3, $4, $5, true, false, NOW(), NOW())`,
        [canvasResourceId, currentUser, pathVal, canvasTitle, JSON.stringify(updatedMetadata)]
      );
    }

    // Invalidate in-memory search index & query caches

    // 4. Sync to filesystem in standard JSON Canvas v1.0 format
    try {
      const vaultCanvasDir = path.join(process.cwd(), 'content', 'public_vault', 'canvas');
      if (!fs.existsSync(vaultCanvasDir)) {
        fs.mkdirSync(vaultCanvasDir, { recursive: true });
      }
      const targetFilePath = path.join(vaultCanvasDir, `${cleanId}.canvas`);
      const fileData = {
        title: canvasTitle,
        nodes: nodes.map((n: any) => ({
          id: n.id,
          type: n.type,
          x: Math.round(n.x),
          y: Math.round(n.y),
          width: Math.round(n.width),
          height: Math.round(n.height),
          color: n.color || undefined,
          text: n.text || undefined,
          file: n.file || undefined,
          url: n.url || undefined,
          label: n.label || undefined,
          resourceId: n.resourceId || undefined,
          resourceType: n.resourceType || undefined,
        })),
        edges: edges.map((e: any) => ({
          id: e.id,
          fromNode: e.fromNode,
          fromSide: e.fromSide || undefined,
          fromEnd: e.fromEnd || undefined,
          toNode: e.toNode,
          toSide: e.toSide || undefined,
          toEnd: e.toEnd || undefined,
          label: e.label || undefined,
          color: e.color || undefined,
        })),
      };
      fs.writeFileSync(targetFilePath, JSON.stringify(fileData, null, 2), 'utf-8');
    } catch (fsErr: any) {
      console.warn(`[Canvas API Warning] Failed to sync to filesystem:`, fsErr.message);
    }

    auditContent({
      actor: currentUser,
      action: 'content.update',
      resourceId: canvasResourceId,
      resourceType: 'canvas',
      fields: ['canvasData'],
      detail: { nodeCount: nodes.length, edgeCount: edges.length },
      ip: clientAddress,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Canvas saved successfully',
        resourceId: canvasResourceId,
        title: canvasTitle,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        updatedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error(`[Canvas API Error] Failed to save canvas '${canvasResourceId}':`, err);
    return new Response(
      JSON.stringify({ error: 'InternalError', message: err?.message || 'Failed to save canvas' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const DELETE: APIRoute = async ({ params, locals, clientAddress }) => {
  const rawId = params.id || '';
  const cleanId = decodeURIComponent(rawId)
    .replace(/^canvas[:\/]/, '')
    .replace(/^public_vault\/canvas\//, '')
    .replace(/\.canvas$/, '');
  const canvasResourceId = `canvas:${cleanId}`;
  const currentUser = locals.user || 'user:anonymous';

  try {
    const dbRes = await query(`SELECT id, owner_id FROM resources WHERE id = $1 LIMIT 1`, [canvasResourceId]);
    if (dbRes.rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'NotFound', message: `Canvas '${canvasResourceId}' not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const canvasRow = dbRes.rows[0];
    if (currentUser !== 'user:anonymous' && canvasRow.owner_id && canvasRow.owner_id !== currentUser) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', message: `Only owner can delete this canvas` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await query(`DELETE FROM resources WHERE id = $1`, [canvasResourceId]);

    // Invalidate in-memory search index & query caches

    // Optional disk file removal
    const diskPath = path.join(process.cwd(), 'content', 'public_vault', 'canvas', `${cleanId}.canvas`);
    if (fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath);
      } catch (e) {
        // ignore
      }
    }

    auditContent({
      actor: currentUser,
      action: 'content.delete',
      resourceId: canvasResourceId,
      resourceType: 'canvas',
      ip: clientAddress,
    });

    return new Response(
      JSON.stringify({ success: true, message: `Canvas ${canvasResourceId} deleted` }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'InternalError', message: err?.message || 'Failed to delete canvas' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};


