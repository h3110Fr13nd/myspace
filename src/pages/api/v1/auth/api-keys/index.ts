import type { APIRoute } from 'astro';
import { listUserApiKeys, createApiKey, DEFAULT_SCOPES } from '../../../../../lib/auth';
import { json } from '../../../../../lib/api';

export const GET: APIRoute = async ({ locals }) => {
  const currentUser = locals.user;
  if (currentUser === 'user:anonymous' || !currentUser) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const keys = await listUserApiKeys(currentUser);
    return json({ keys }, { status: 200 });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const currentUser = locals.user;
  if (currentUser === 'user:anonymous' || !currentUser) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const name = (body.name || 'Personal Sync Key').trim();
    const scopes = Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : [...DEFAULT_SCOPES];
    const expiresInDays = body.expiresInDays === null ? null : (Number(body.expiresInDays) || 90);

    const { apiKey, rawSecret } = await createApiKey(currentUser, name, scopes, expiresInDays);

    return new Response(
      JSON.stringify({
        success: true,
        apiKey,
        rawSecret, // Only returned once upon creation!
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
