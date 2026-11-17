import type { APIRoute } from 'astro';
import { verifySessionToken } from '../../../../lib/auth';
import { json } from '../../../../lib/api';

export const GET: APIRoute = async ({ cookies }) => {
  const token = cookies.get('session_token')?.value;

  if (!token) {
    return json({ authenticated: false, user: null }, { status: 200 });
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    return json({ authenticated: false, user: null }, { status: 200 });
  }

  return json({ authenticated: true, user: payload }, { status: 200 });
};
