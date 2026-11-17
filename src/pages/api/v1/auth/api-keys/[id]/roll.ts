import type { APIRoute } from 'astro';
import { rollApiKey } from '../../../../../../lib/auth';
import { json } from '../../../../../../lib/api';

export const POST: APIRoute = async ({ params, locals }) => {
  const currentUser = locals.user;
  const keyId = params.id || '';

  if (currentUser === 'user:anonymous' || !currentUser) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { apiKey, rawSecret } = await rollApiKey(currentUser, keyId);
    return new Response(
      JSON.stringify({ success: true, apiKey, rawSecret }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
