import type { APIRoute } from 'astro';
import { query } from '../../../../../lib/db';
import * as fs from 'fs';
import * as path from 'path';
import { json } from '../../../../../lib/api';

export const GET: APIRoute = async ({ locals }) => {
  try {
    const dbRes = await query(
      `SELECT id, type, owner_id, title, metadata, created_at, updated_at 
       FROM resources 
       WHERE type = 'canvas'
       ORDER BY updated_at DESC`
    );

    const canvases = (dbRes.rows || []).map((row) => ({
      id: row.id,
      title: row.title,
      owner_id: row.owner_id,
      nodeCount: row.metadata?.nodeCount || row.metadata?.canvasData?.nodes?.length || 0,
      edgeCount: row.metadata?.edgeCount || row.metadata?.canvasData?.edges?.length || 0,
      updated_at: row.updated_at,
    }));

    return json({ canvases }, { status: 200 });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'InternalError', message: err?.message || 'Failed to list canvases' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const currentUser = locals.user || 'user:anonymous';

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

    // Write to disk
    try {
      const vaultCanvasDir = path.join(process.cwd(), 'content', 'public_vault', 'canvas');
      if (!fs.existsSync(vaultCanvasDir)) {
        fs.mkdirSync(vaultCanvasDir, { recursive: true });
      }
      const targetFilePath = path.join(vaultCanvasDir, `${cleanSlug}.canvas`);
      fs.writeFileSync(
        targetFilePath,
        JSON.stringify({ title, nodes: defaultNodes, edges: defaultEdges }, null, 2),
        'utf-8'
      );
    } catch (fsErr: any) {
      console.warn(`[Canvas POST] Failed to write disk file:`, fsErr.message);
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
