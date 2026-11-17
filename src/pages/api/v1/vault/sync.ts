import type { APIRoute } from 'astro';
import { extractZipArchive, syncVaultFiles, type IngestFile } from '../../../../lib/vaultSync';
import { query } from '../../../../lib/db';
import { json } from '../../../../lib/api';

export const GET: APIRoute = async ({ url, locals }) => {
  const currentUser = locals.user;
  const scopes = locals.scopes || [];

  if (currentUser === 'user:anonymous' || !currentUser) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (locals.authType === 'api_key') {
    const hasScope = scopes.includes('*') || scopes.includes('vault:sync') || scopes.includes('vault:read') || scopes.includes('vault:write');
    if (!hasScope) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', message: "API key lacks 'vault:read' or 'vault:sync' scope" }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  try {
    const emailSlug = currentUser.replace(/^user:/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const customVaultName = url.searchParams.get('vaultName');
    const vaultPrefix = customVaultName ? customVaultName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : `${emailSlug}_vault`;

    // Fetch existing non-container resources owned by user in this vault
    const res = await query(
      `SELECT id, type, title, path, metadata, updated_at
       FROM resources
       WHERE owner_id = $1 AND type NOT IN ('folder', 'space')`,
      [currentUser]
    );

    const items = (res.rows || []).map((r) => {
      const meta = r.metadata || {};
      return {
        id: r.id,
        type: r.type,
        title: r.title,
        path: r.path,
        slug: meta.slug || r.id.replace(/^[^:]+:/, ''),
        contentHash: meta.contentHash || null,
        sizeBytes: meta.sizeBytes || null,
        updatedAt: r.updated_at,
        category: meta.category,
      };
    });

    return json({
      success: true,
      vaultName: vaultPrefix,
      ownerId: currentUser,
      count: items.length,
      resources: items,
    }, { status: 200 });
  } catch (err: any) {
    console.error('[Vault Sync GET Manifest Error]', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error', message: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const currentUser = locals.user;
  const scopes = locals.scopes || [];

  if (currentUser === 'user:anonymous' || !currentUser) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'Authentication required to sync vault' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Verify scope if API key was used
  if (locals.authType === 'api_key') {
    const hasScope = scopes.includes('*') || scopes.includes('vault:sync') || scopes.includes('vault:write');
    if (!hasScope) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', message: "API key lacks 'vault:sync' or 'vault:write' scope" }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    let files: IngestFile[] = [];
    let customVaultName: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      customVaultName = (formData.get('vaultName') as string) || undefined;

      const zipFile = formData.get('zip') as File | null;
      const uploadedFiles = formData.getAll('files') as File[];
      const relativePaths = formData.getAll('paths') as string[];
      const deletedPathsRaw = formData.getAll('deleted') as string[];
      const deletedPaths = deletedPathsRaw.length > 0
        ? deletedPathsRaw
        : ((formData.get('deletedPaths') as string) ? JSON.parse(formData.get('deletedPaths') as string) : []);

      if (zipFile && typeof zipFile.arrayBuffer === 'function') {
        const buffer = Buffer.from(await zipFile.arrayBuffer());
        files = await extractZipArchive(buffer);
      } else if (uploadedFiles && uploadedFiles.length > 0) {
        for (let i = 0; i < uploadedFiles.length; i++) {
          const f = uploadedFiles[i];
          if (typeof f.arrayBuffer !== 'function') continue;
          const buffer = Buffer.from(await f.arrayBuffer());
          const relPath = (relativePaths[i] as string) || f.name;
          files.push({
            relativePath: relPath,
            data: buffer,
            mimeType: f.type,
          });
        }
      }

      if (files.length === 0 && deletedPaths.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Bad Request', message: 'No valid content files or deletions found in upload' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Execute synchronization
      const stats = await syncVaultFiles(files, currentUser, customVaultName, 'tenant_default', deletedPaths);
      return json({ success: true, stats }, { status: 200 });
    } else if (contentType.includes('application/zip') || contentType.includes('application/x-zip-compressed')) {
      const arrayBuf = await request.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      files = await extractZipArchive(buffer);

      if (files.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Bad Request', message: 'No valid content files found in upload' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Execute synchronization
      const stats = await syncVaultFiles(files, currentUser, customVaultName);
      return json({ success: true, stats }, { status: 200 });
    } else {
      return new Response(
        JSON.stringify({ error: 'Bad Request', message: 'Expected multipart/form-data or application/zip' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (err: any) {
    console.error('[Vault Sync API Error]', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error', message: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
