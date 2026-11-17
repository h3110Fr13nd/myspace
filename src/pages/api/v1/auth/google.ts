import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { signGoogleOAuthStateCookie } from '../../../../lib/auth';
import { safeLocalRedirect } from '../../../../lib/authRedirect';
import { config } from '../../../../lib/config';
import { consumeRateLimit } from '../../../../lib/rateLimit';

const GOOGLE_AUTH_URL = process.env.E2E_TEST_MODE === '1' && process.env.GOOGLE_AUTH_URL
  ? process.env.GOOGLE_AUTH_URL
  : 'https://accounts.google.com/o/oauth2/v2/auth';

export const GET: APIRoute = async ({ url, redirect, request, clientAddress }) => {
  if (config.rateLimitAuth) {
    const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
    const rule = await consumeRateLimit({ key: 'auth:google:' + ip, limit: 20, windowSec: 60 });
    if (!rule.allowed) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rule.retryAfterSec) },
      });
    }
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || import.meta.env.GOOGLE_REDIRECT_URI || 'https://blog.example.com/auth/callback';
  const callbackPath = new URL(redirectUri, url).pathname;
  const returnTo = safeLocalRedirect(url.searchParams.get('redirect'));

  if (!clientId) {
    console.error('[Google OAuth] Missing GOOGLE_CLIENT_ID in environment.');
    const login = new URL('/login', url);
    login.searchParams.set('error', 'oauth_not_configured');
    login.searchParams.set('redirect', returnTo);
    return redirect(`${login.pathname}${login.search}`);
  }

  const includeDrive = url.searchParams.get('drive') === 'true' || url.searchParams.get('scope') === 'drive' || url.searchParams.get('scope') === 'workspace';
  const purpose = includeDrive ? 'drive_sync' : 'auth';
  const state = randomUUID();
  const stateCookie = signGoogleOAuthStateCookie(state, purpose, returnTo);
  const secureCookie = url.protocol === 'https:' || request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';

  const scopes = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: includeDrive ? 'consent select_account' : 'select_account',
    state,
  });
  const loginHint = url.searchParams.get('login_hint');
  if (loginHint) params.set('login_hint', loginHint);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${GOOGLE_AUTH_URL}?${params.toString()}`,
      'Set-Cookie': `google_oauth_state=${stateCookie}; Path=${callbackPath}; HttpOnly; SameSite=Lax; Max-Age=600${secureCookie ? '; Secure' : ''}`,
    },
  });
};
