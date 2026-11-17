import type { APIRoute } from 'astro';
import { getValidGoogleAccessToken } from '../../../../../lib/google/tokenBroker';
import { fetchSheetValues, updateSheetValues } from '../../../../../lib/google/sheetsClient';
import { json } from '../../../../../lib/api';

export const GET: APIRoute = async ({ locals, url }) => {
  const currentUser = locals.user || 'user:anonymous';
  if (currentUser === 'user:anonymous') {
    return json({ error: 'Unauthorized: login required' }, { status: 401 });
  }

  const spreadsheetId = url.searchParams.get('id');
  const range = url.searchParams.get('range') || 'A1:Z50';

  if (!spreadsheetId) {
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
    const data = await fetchSheetValues(spreadsheetId, range, accessToken);
    return json(data, { status: 200 });
  } catch (err: any) {
    console.error('[API /google/sheets/values] Error:', err.message);
    return json({ error: err.message }, { status: 500 });
  }
};

export const PUT: APIRoute = async ({ locals, request }) => {
  const currentUser = locals.user || 'user:anonymous';
  if (currentUser === 'user:anonymous') {
    return json({ error: 'Unauthorized: login required' }, { status: 401 });
  }

  const body = await request.json();
  const { spreadsheetId, range, values } = body;

  if (!spreadsheetId || !range || !Array.isArray(values)) {
    return json({ error: 'Missing spreadsheetId, range, or values array' }, { status: 400 });
  }

  const accessToken = await getValidGoogleAccessToken(currentUser);
  if (!accessToken) {
    return json({ error: 'Google Workspace not connected' }, { status: 403 });
  }

  try {
    const result = await updateSheetValues(spreadsheetId, range, values, accessToken);
    return json(result, { status: 200 });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
