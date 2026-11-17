import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { revokeSessionToken } from '../../../../lib/auth';

export const GET: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get('session_token')?.value;
  if (token) await revokeSessionToken(token);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
};

export const POST: APIRoute = async ({ cookies }) => {
  const token = cookies.get('session_token')?.value;
  if (token) await revokeSessionToken(token);
  return json({ message: 'Logged out' }, { status: 200, headers: { 'Set-Cookie': `session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
};
