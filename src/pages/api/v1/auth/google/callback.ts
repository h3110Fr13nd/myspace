import type { APIRoute } from 'astro';
import { query } from '../../../../../lib/db';
import { signJwtToken, linkProviderIdentity, verifyGoogleOAuthStateCookie } from '../../../../../lib/auth';
import { safeLocalRedirect } from '../../../../../lib/authRedirect';
import { config } from '../../../../../lib/config';
import { consumeRateLimit } from '../../../../../lib/rateLimit';
import { ensureOwner } from '../../../../../lib/acl/projector';
import { ensureWorkspaceMember } from '../../../../../lib/acl/groups';
import { newUserId } from '../../../../../lib/userIds';

const GOOGLE_TOKEN_URL = process.env.E2E_TEST_MODE === '1' && process.env.GOOGLE_TOKEN_URL
  ? process.env.GOOGLE_TOKEN_URL
  : 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = process.env.E2E_TEST_MODE === '1' && process.env.GOOGLE_USERINFO_URL
  ? process.env.GOOGLE_USERINFO_URL
  : 'https://www.googleapis.com/oauth2/v2/userinfo';

function readCookie(request: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  return request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

export const GET: APIRoute = async ({ url, request, clientAddress }) => {
  if (config.rateLimitAuth) {
    const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
    const rule = await consumeRateLimit({ key: 'auth:google_callback:' + ip, limit: 20, windowSec: 60 });
    if (!rule.allowed) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rule.retryAfterSec) },
      });
    }
  }

  const secureCookie = url.protocol === 'https:' || request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
  const clearStateCookie = `google_oauth_state=; Path=${url.pathname}; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}`;
  const redirectAndClearState = (target: string, sessionCookie?: string) => {
    const headers = new Headers({ Location: target });
    if (sessionCookie) headers.append('Set-Cookie', sessionCookie);
    headers.append('Set-Cookie', clearStateCookie);
    return new Response(null, { status: 302, headers });
  };

  const oauthState = verifyGoogleOAuthStateCookie(
    readCookie(request, 'google_oauth_state'),
    url.searchParams.get('state')
  );
  if (!oauthState) {
    return redirectAndClearState('/login?error=oauth_state_invalid');
  }

  const loginError = (error: string) => {
    const params = new URLSearchParams({ error, redirect: safeLocalRedirect(oauthState.returnTo) });
    return `/login?${params.toString()}`;
  };

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return redirectAndClearState(loginError('oauth_cancelled'));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || import.meta.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || import.meta.env.GOOGLE_REDIRECT_URI || 'https://blog.example.com/auth/callback';

  try {
    // 1. Exchange authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const tokenErr = await tokenRes.text();
      console.error('[Google OAuth] Token exchange failed:', tokenErr);
      return redirectAndClearState(loginError('token_exchange_failed'));
    }

    const tokens = await tokenRes.json();
    const accessToken: string = tokens.access_token;

    // 2. Fetch user profile from Google
    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoRes.ok) {
      return redirectAndClearState(loginError('userinfo_failed'));
    }

    const googleUser = await userInfoRes.json();
    const email: string = (googleUser.email || '').toLowerCase().trim();
    const displayName: string = googleUser.name || email;
    const avatarUrl: string | undefined = googleUser.picture;
    const googleSubId: string = googleUser.id || email;

    if (!email) {
      return redirectAndClearState(loginError('no_email_scope'));
    }
    if (googleUser.verified_email !== true) {
      return redirectAndClearState(loginError('email_not_verified'));
    }

    // 3. Resolve or provision the user record.
    //
    // The principal id is opaque and is NOT derived from the email. Deriving it
    // (`user:${email}`) is the exact defect migrations/0009 and 0010 exist to
    // prevent: the database rejects any non-uuid id, so on a migrated stack this
    // INSERT always fails, and on an un-migrated one it mints a second principal
    // for a person who already owns resources — leaving the OAuth session
    // pointing at an owner with no content.
    //
    // So: look the account up by email, and only mint an id when the person is
    // genuinely new.
    const existing = await query('SELECT id, email, display_name, avatar_url FROM users WHERE email = $1', [email]);
    const isNewUser = !existing.rowCount || existing.rowCount === 0;
    const userId = isNewUser ? newUserId() : existing.rows[0].id;

    if (isNewUser) {
      await query(
        'INSERT INTO users (id, email, password_hash, display_name, avatar_url) VALUES ($1, $2, NULL, $3, $4)',
        [userId, email, displayName, avatarUrl || null]
      );

      // Provision personal root vault folder. Derived from the opaque id, not
      // the email local part, so two people sharing a local part cannot collide
      // on one vault. See the matching note in `register.ts`.
      const rootSegment = userId.replace(/^user:/, '').replace(/-/g, '');
      const rootFolderId = `folder:${rootSegment}_root`;
      await query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [
          rootFolderId,
          'folder',
          'tenant_default',
          userId,
          rootFolderId,
          `${displayName}'s Personal Root Vault`,
          JSON.stringify({ isPersonalRoot: true, provider: 'google' }),
        ]
      );

      // Write OpenFGA owner tuple
      await ensureOwner(rootFolderId, userId);
      // "Everyone in the workspace" resolves through `space:main#member`, so a
      // user without this tuple can never be granted the workspace audience.
      await ensureWorkspaceMember(userId).catch(() => {
        /* reconciled by scripts/reconcile-acl.ts */
      });
    } else {
      // Update avatar if provided. Keyed on the resolved id, which is now the
      // canonical uuid rather than a derived string.
      if (avatarUrl) {
        await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, userId]).catch(() => {});
      }
    }

    // 4. Link Google Identity in user_identities table (including Drive tokens)
    const refreshToken = tokens.refresh_token || null;
    const tokenMetadata: Record<string, any> = {
      name: displayName,
      picture: avatarUrl,
      verifiedEmail: googleUser.verified_email ?? true,
      accessToken,
      refreshToken,
      scopes: tokens.scope || '',
      expiresIn: tokens.expires_in,
      tokenIssuedAt: Date.now(),
    };

    await linkProviderIdentity(userId, 'google', googleSubId, email, tokenMetadata);

    // 5. Sign JWT session token
    const token = signJwtToken({ userId, email, displayName });

    // 6. Set secure session cookie and redirect based on OAuth purpose
    const redirectTarget = oauthState.purpose === 'drive_sync'
      ? '/vault/sync?source=google-drive&status=connected'
      : safeLocalRedirect(oauthState.returnTo);

    return redirectAndClearState(
      redirectTarget,
      `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
    );
  } catch (err: any) {
    console.error('[Google OAuth] Callback error:', err);
    return redirectAndClearState(loginError('server_error'));
  }
};
