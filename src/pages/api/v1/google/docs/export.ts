import type { APIRoute } from 'astro';
import { getValidGoogleAccessToken } from '../../../../../lib/google/tokenBroker';
import { exportMarkdownToGoogleDoc } from '../../../../../lib/google/docsClient';
import { json } from '../../../../../lib/api';
import { config } from '../../../../../lib/config';
import { consumeRateLimit } from '../../../../../lib/rateLimit';

export const POST: APIRoute = async ({ locals, request, clientAddress }) => {
  const currentUser = locals.user || 'user:anonymous';
  if (currentUser === 'user:anonymous') {
    return json({ error: 'Unauthorized: login required' }, { status: 401 });
  }

  if (config.rateLimit) {
    const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
    const actor = currentUser !== 'user:anonymous' ? currentUser : ip;
    const rule = await consumeRateLimit({ key: 'expensive:export:' + actor, limit: 10, windowSec: 60 });
    if (!rule.allowed) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rule.retryAfterSec) },
      });
    }
  }

  const body = await request.json();
  const { documentId, markdown } = body;

  if (!documentId || !markdown) {
    return json({ error: 'Missing documentId or markdown' }, { status: 400 });
  }

  const accessToken = await getValidGoogleAccessToken(currentUser);
  if (!accessToken) {
    return json({ error: 'Google Workspace not connected' }, { status: 403 });
  }

  try {
    const result = await exportMarkdownToGoogleDoc(documentId, markdown, accessToken);
    return json({ success: true, result }, { status: 200 });
  } catch (err: any) {
    console.error('[API /google/docs/export] Error:', err.message);
    return json({ error: err.message }, { status: 500 });
  }
};
