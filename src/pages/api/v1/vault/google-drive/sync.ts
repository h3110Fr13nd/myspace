import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '../../../../../lib/db';
import { getValidGoogleAccessToken } from '../../../../../lib/google/tokenBroker';
import { json } from '../../../../../lib/api';
import { ensureOwner, linkParent } from '../../../../../lib/acl/projector';

export const POST: APIRoute = async ({ locals, request }) => {
  const currentUser = locals.user || 'user:anonymous';
  if (currentUser === 'user:anonymous') {
    return json({ error: 'Unauthorized: login required' }, { status: 401 });
  }

  const accessToken = await getValidGoogleAccessToken(currentUser);
  if (!accessToken) {
    return new Response(
      JSON.stringify({
        error: 'Google Drive access token missing or expired. Please re-authenticate.',
        authUrl: '/api/v1/auth/google?drive=true',
      }),
      { status: 403 }
    );
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const folderId = body.folderId || 'root';
  const targetVaultId = body.targetVaultId || 'space:demo-vault';
  const targetSubFolder = body.targetSubFolder || 'research/main';
  const isPrivate = body.isPrivate !== undefined ? body.isPrivate : true;

  try {
    // 1. Ensure target folder structure exists
    const researchParentFolderId = `folder:demo-vault_research`;
    const mainSubFolderId = `folder:demo-vault_research-main`;

    await query(
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, is_public, is_draft, metadata)
       VALUES ($1, 'folder', 'tenant_default', $2, $3, $4, $5, false, false, $6)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
      [
        researchParentFolderId,
        targetVaultId,
        currentUser,
        'research',
        'Research (Private)',
        JSON.stringify({ vaultId: targetVaultId, subfolder: 'research', visibility: 'private' }),
      ]
    );
    await ensureOwner(researchParentFolderId, currentUser);
    await linkParent(researchParentFolderId, 'folder', targetVaultId, 'parent_folder');

    await query(
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, is_public, is_draft, metadata)
       VALUES ($1, 'folder', 'tenant_default', $2, $3, $4, $5, false, false, $6)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
      [
        mainSubFolderId,
        researchParentFolderId,
        currentUser,
        'research/main',
        'Main Research Documents & PDFs (Private)',
        JSON.stringify({ vaultId: targetVaultId, subfolder: 'research/main', visibility: 'private' }),
      ]
    );
    await ensureOwner(mainSubFolderId, currentUser);
    await linkParent(mainSubFolderId, 'folder', researchParentFolderId, 'parent_folder');

    // 2. Fetch PDF files from Google Drive
    const driveQuery = `'${folderId}' in parents and trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'text/markdown')`;
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        driveQuery
      )}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listRes.ok) {
      const err = await listRes.text();
      return json({ error: 'Failed to list Google Drive files', details: err }, { status: 502 });
    }

    const driveData = await listRes.json();
    const filesToSync = driveData.files || [];
    const syncedPdfs: any[] = [];

    // Ensure local assets storage directory exists
    const storageDir = path.resolve(process.cwd(), 'storage/assets/pdf');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    for (const driveFile of filesToSync) {
      const isPdf = driveFile.mimeType === 'application/pdf' || driveFile.name.toLowerCase().endsWith('.pdf');
      const cleanFileName = driveFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const assetId = `pdf:${driveFile.id}`;
      const filePath = path.join(storageDir, `${driveFile.id}.pdf`);

      // Download file content from Google Drive
      const downloadRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveFile.id}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (downloadRes.ok) {
        const fileBuffer = Buffer.from(await downloadRes.arrayBuffer());
        fs.writeFileSync(filePath, fileBuffer);

        const pdfMetadata = {
          driveId: driveFile.id,
          mimeType: driveFile.mimeType,
          originalName: driveFile.name,
          fileSize: fileBuffer.length,
          storagePath: `/storage/assets/pdf/${driveFile.id}.pdf`,
          embedUrl: `/api/v1/assets/pdf/${driveFile.id}.pdf`,
          component: 'PdfViewer',
          syncedAt: new Date().toISOString(),
          targetFolder: targetSubFolder,
          visibility: isPrivate ? 'private' : 'public',
        };

        const resourcePath = `${targetSubFolder}/${cleanFileName.replace(/\.pdf$/i, '')}`;

        // Insert into resources
        await query(
          `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, is_public, is_draft, metadata)
           VALUES ($1, 'pdf', 'tenant_default', $2, $3, $4, $5, $6, false, $7)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             metadata = EXCLUDED.metadata,
             updated_at = NOW()`,
          [
            assetId,
            mainSubFolderId,
            currentUser,
            resourcePath,
            driveFile.name.replace(/\.pdf$/i, ''),
            !isPrivate,
            JSON.stringify(pdfMetadata),
          ]
        );

        // Set OpenFGA permissions: private to owner
        await ensureOwner(assetId, currentUser);
        await linkParent(assetId, 'folder', mainSubFolderId, 'parent_folder');

        syncedPdfs.push({
          id: assetId,
          name: driveFile.name,
          path: resourcePath,
          size: fileBuffer.length,
          embedUrl: pdfMetadata.embedUrl,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        folderId,
        targetSubFolder,
        count: syncedPdfs.length,
        syncedPdfs,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[Google Drive Sync] Error:', err);
    return json({ error: err.message }, { status: 500 });
  }
};
