import type { APIRoute } from 'astro';
import { query } from '../../../../../lib/db';
import * as fs from 'fs';
import * as path from 'path';
import { json } from '../../../../../lib/api';
import { filterViewableResources } from '../../../../../lib/permissions';

export const GET: APIRoute = async ({ locals }) => {
  const currentUser = locals.user || 'user:anonymous';
  try {
    // Counts come from the database; the documents themselves stay there. This
    // used to select full metadata — every canvas's entire node/edge payload —
    // to read two lengths.
    const dbRes = await query(
      `SELECT id, type, owner_id, title, parent_id, path, is_public, is_draft, updated_at,
              jsonb_build_object(
                'draft', metadata->'draft', 'isDraft', metadata->'isDraft',
                'unlisted', metadata->'unlisted', 'isUnlisted', metadata->'isUnlisted'
              ) AS metadata,
              COALESCE((metadata->>'nodeCount')::int,
                       jsonb_array_length(CASE WHEN jsonb_typeof(metadata->'canvasData'->'nodes') = 'array'
                                               THEN metadata->'canvasData'->'nodes' ELSE '[]'::jsonb END)) AS node_count,
              COALESCE((metadata->>'edgeCount')::int,
                       jsonb_array_length(CASE WHEN jsonb_typeof(metadata->'canvasData'->'edges') = 'array'
                                               THEN metadata->'canvasData'->'edges' ELSE '[]'::jsonb END)) AS edge_count
         FROM resources
        WHERE type = 'canvas'
        ORDER BY updated_at DESC`
    );

    // SECURITY: this listing returned every canvas — private titles included —
    // to any caller. It now lists only what the caller may view.
    const visible = await filterViewableResources(dbRes.rows || [], currentUser);

    const canvases = visible.map((row: any) => ({
      id: row.id,
      title: row.title,
      owner_id: row.owner_id,
      nodeCount: row.node_count || 0,
      edgeCount: row.edge_count || 0,
      updated_at: row.updated_at,
    }));

    return json({ canvases }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'InternalError', message: err?.message || 'Failed to list canvases' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const currentUser = locals.user || 'user:anonymous';

  // Creating a canvas makes the caller its owner; an anonymous owner meant a
  // canvas anyone could later rewrite.
  if (!currentUser || currentUser === 'user:anonymous') {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'Sign in to create canvases' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const payload = await request.json();
    const { title, slug, isPublic = true, initialData } = payload;

    if (!title) {
      return new Response(
        JSON.stringify({ error: 'BadRequest', message: 'Title is required to create a canvas' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cleanSlug = (slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || 'new-canvas';
    const canvasResourceId = `canvas:${cleanSlug}`;

    // Verify doesn't already exist
    const existing = await query(`SELECT id FROM resources WHERE id = $1 LIMIT 1`, [canvasResourceId]);
    if (existing.rows.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Conflict', message: `Canvas '${canvasResourceId}' already exists` }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const defaultNodes = initialData?.nodes || [
      {
        id: 'node_welcome',
        type: 'text',
        x: 100,
        y: 100,
        width: 320,
        height: 180,
        color: '5',
        text: `# ${title}\nWelcome to your new spatial canvas! Double click to edit or insert resources.`,
      },
    ];

    const defaultEdges = initialData?.edges || [];

    const metadata = {
      slug: cleanSlug,
      nodeCount: defaultNodes.length,
      edgeCount: defaultEdges.length,
      lastSavedBy: currentUser,
      canvasData: {
        nodes: defaultNodes,
        edges: defaultEdges,
      },
    };

    const pathVal = `space:main/folder:public_vault_canvas/${canvasResourceId}`;

    await query(
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft, created_at, updated_at) 
       VALUES ($1, 'canvas', 'tenant:default', 'folder:public_vault_canvas', $2, $3, $4, $5, $6, false, NOW(), NOW())`,
      [canvasResourceId, currentUser, pathVal, title, JSON.stringify(metadata), Boolean(isPublic)]
    );

    // Mirror to disk off the request path (see the PUT handler).
    {
      const vaultCanvasDir = path.join(process.cwd(), 'content', 'public_vault', 'canvas');
      const targetFilePath = path.join(vaultCanvasDir, `${cleanSlug}.canvas`);
      void fs.promises
        .mkdir(vaultCanvasDir, { recursive: true })
        .then(() =>
          fs.promises.writeFile(
            targetFilePath,
            JSON.stringify({ title, nodes: defaultNodes, edges: defaultEdges }, null, 2),
            'utf-8'
          )
        )
        .catch((fsErr: any) => console.warn(`[Canvas POST] Failed to write disk file:`, fsErr?.message));
    }

    return new Response(
      JSON.stringify({
        success: true,
        id: canvasResourceId,
        slug: cleanSlug,
        url: `/studio/canvas/${encodeURIComponent(cleanSlug)}`,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'InternalError', message: err?.message || 'Failed to create canvas' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
