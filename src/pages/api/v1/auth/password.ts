import type { APIRoute } from 'astro';
import { setUserPassword } from '../../../../lib/auth';
import { json } from '../../../../lib/api';
import { config } from '../../../../lib/config';
import { consumeRateLimit } from '../../../../lib/rateLimit';

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  if (config.rateLimitAuth) {
    const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
    const rule = await consumeRateLimit({ key: 'auth:password:' + ip, limit: 20, windowSec: 60 });
    if (!rule.allowed) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rule.retryAfterSec) },
      });
    }
  }

  const currentUser = locals.user;
  if (currentUser === 'user:anonymous' || !currentUser) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const password = body.password;

    if (!password || password.length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    await setUserPassword(currentUser, password);

    return json({ success: true, message: 'Password updated successfully' }, { status: 200 });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};
