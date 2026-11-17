import type { APIRoute } from 'astro';
import { getValidGoogleAccessToken } from '../../../../../lib/google/tokenBroker';
import { json } from '../../../../../lib/api';

export const GET: APIRoute = async ({ locals, url }) => {
  const currentUser = locals.user || 'user:anonymous';
  if (currentUser === 'user:anonymous') {
    return json({ error: 'Unauthorized: login required' }, { status: 401 });
  }

  const accessToken = await getValidGoogleAccessToken(currentUser);
  if (!accessToken) {
    return new Response(
      JSON.stringify({
        connected: false,
        error: 'Google Drive not connected or missing drive permissions',
        authUrl: '/api/v1/auth/google?drive=true',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parentFolderId = url.searchParams.get('folderId') || 'root';
  const queryFilter = `'${parentFolderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/pdf' or mimeType = 'text/markdown' or mimeType = 'application/octet-stream')`;

  try {
    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      queryFilter
    )}&fields=files(id,name,mimeType,size,modifiedTime,parents,webViewLink,iconLink)&pageSize=100&orderBy=folder,name`;

    const driveRes = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!driveRes.ok) {
      const errText = await driveRes.text();
      return json({ error: 'Google Drive API error', details: errText }, { status: 502 });
    }

    const data = await driveRes.json();
    const files = (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      isPdf: f.mimeType === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      size: f.size ? parseInt(f.size, 10) : 0,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
    }));

    return new Response(
      JSON.stringify({
        connected: true,
        parentFolderId,
        files,
        total: files.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
