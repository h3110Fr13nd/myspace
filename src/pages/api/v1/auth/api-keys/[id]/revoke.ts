import type { APIRoute } from 'astro';
import { revokeApiKey } from '../../../../../../lib/auth';
import { json } from '../../../../../../lib/api';

export const POST: APIRoute = async ({ params, locals }) => {
  const currentUser = locals.user;
  const keyId = params.id || '';

  if (currentUser === 'user:anonymous' || !currentUser) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const success = await revokeApiKey(currentUser, keyId);
    if (!success) {
      return json({ error: 'API key not found or already revoked' }, { status: 404 });
    }

    return json({ success: true, message: 'API key revoked' }, { status: 200 });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
