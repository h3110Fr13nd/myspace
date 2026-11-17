import type { APIRoute } from 'astro';
import { getValidGoogleAccessToken } from '../../../../../lib/google/tokenBroker';
import { fetchDocumentAst, convertGoogleDocToMarkdown } from '../../../../../lib/google/docsClient';
import { json } from '../../../../../lib/api';

export const GET: APIRoute = async ({ locals, url }) => {
  const currentUser = locals.user || 'user:anonymous';
  if (currentUser === 'user:anonymous') {
    return json({ error: 'Unauthorized: login required' }, { status: 401 });
  }

  const documentId = url.searchParams.get('id');
  if (!documentId) {
    return json({ error: 'Missing required query parameter: id' }, { status: 400 });
  }

  const accessToken = await getValidGoogleAccessToken(currentUser);
  if (!accessToken) {
    return new Response(
      JSON.stringify({
        connected: false,
        error: 'Google Workspace not connected or missing permissions',
        authUrl: '/api/v1/auth/google?drive=true',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const docAst = await fetchDocumentAst(documentId, accessToken);
    const parsed = convertGoogleDocToMarkdown(docAst);

    return json(parsed, { status: 200 });
  } catch (err: any) {
    console.error('[API /google/docs/import] Error:', err.message);
    return json({ error: err.message }, { status: 500 });
  }
};
