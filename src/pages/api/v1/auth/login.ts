import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { comparePassword, signJwtToken } from '../../../../lib/auth';
import { json } from '../../../../lib/api';
import { config } from '../../../../lib/config';
import { consumeRateLimit } from '../../../../lib/rateLimit';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (config.rateLimitAuth) {
    const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
    const rule = await consumeRateLimit({ key: 'auth:login:' + ip, limit: 20, windowSec: 60 });
    if (!rule.allowed) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rule.retryAfterSec) },
      });
    }
  }

  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return json({ error: 'Email and password are required.' }, { status: 400 });
    }

    // Query user by email
    const res = await query('SELECT id, email, password_hash, display_name FROM users WHERE email = $1', [email]);
    if (!res.rowCount || res.rowCount === 0) {
      return json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    const user = res.rows[0];

    // Enforce strict password comparison
    if (!user.password_hash) {
      return json({ error: 'Account has no password set. Please use OAuth or reset your password.' }, { status: 401 });
    }

    const match = await comparePassword(password, user.password_hash);
    if (!match) {
      return json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    const token = signJwtToken({
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
    });

    return new Response(
      JSON.stringify({
        message: 'Login successful',
        user: { userId: user.id, email: user.email, displayName: user.display_name },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
        },
      }
    );
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
