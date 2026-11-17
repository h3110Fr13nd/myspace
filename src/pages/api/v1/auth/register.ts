import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { hashPassword, signJwtToken } from '../../../../lib/auth';
import { json } from '../../../../lib/api';
import { config } from '../../../../lib/config';
import { consumeRateLimit } from '../../../../lib/rateLimit';
import { ensureOwner } from '../../../../lib/acl/projector';
import { ensureWorkspaceMember } from '../../../../lib/acl/groups';

/** Id minting and the reserved-name policy live in `src/lib/userIds.ts`, so every
 *  caller that creates or validates an id enforces the same rules. */
import { isReservedUserId, newUserId } from '../../../../lib/userIds';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (config.rateLimitAuth) {
    const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
    const rule = await consumeRateLimit({ key: 'auth:register:' + ip, limit: 20, windowSec: 60 });
    if (!rule.allowed) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rule.retryAfterSec) },
      });
    }
  }

  try {
    const body = await request.json();
    const { email, password, displayName } = body;

    if (!email || !password || !displayName) {
      return json({ error: 'Email, password, and display name are required.' }, { status: 400 });
    }

    // Check existing user
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      return json({ error: 'User with this email already exists.' }, { status: 409 });
    }

    // The id is opaque and is NOT derived from the email. Deriving it is what
    // produced `user:demo` (owning 678 resources), `user:researcher` (42) and
    // assorted junk: it collided across domains, it broke on an email change, and
    // it let one human exist as two principals. See migrations/0009 and
    // `src/lib/userIds.ts`. The database now rejects any non-uuid id outright.
    const userId = newUserId();

    // The id is now a uuid, so it cannot collide with anything. The reserved-name
    // check is retained because the *email* still chooses a display name, and a
    // request for `dummy_mail` should be refused rather than create an account
    // that reads like an administrator in audit rows.
    const emailLocalPart = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '');
    if (isReservedUserId(`user:${emailLocalPart}`)) {
      return json(
        { error: 'That email address is reserved. Please use a different one.' },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    // Insert user into PostgreSQL
    await query(
      'INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)',
      [userId, email, passwordHash, displayName]
    );

    // Provision the personal root folder.
    //
    // Derived from the opaque id, not the email local part: the old form
    // (`folder:${emailPrefix}_root`) collided the same way the user id did, so
    // two people with the same local part would have shared one vault. Existing
    // users keep the folders they already have; this only affects new signups.
    const rootSegment = userId.replace(/^user:/, '').replace(/-/g, '');
    const rootFolderId = `folder:${rootSegment}_root`;
    const rootFolderPath = rootFolderId;
    await query(
      'INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
      [
        rootFolderId,
        'folder',
        'tenant_default',
        userId,
        rootFolderPath,
        `${displayName}'s Personal Root Vault`,
        JSON.stringify({ isPersonalRoot: true }),
      ]
    );

    // Write OpenFGA owner tuple for personal root folder
    await ensureOwner(rootFolderId, userId);
    // "Everyone in the workspace" resolves through `space:main#member`, so a
    // user without this tuple can never be granted the workspace audience.
    await ensureWorkspaceMember(userId).catch(() => {
      /* reconciled by scripts/reconcile-acl.ts */
    });

    // Sign JWT token
    const token = signJwtToken({ userId, email, displayName });

    return new Response(
      JSON.stringify({
        message: 'User registered successfully',
        user: { userId, email, displayName, rootFolderId },
      }),
      {
        status: 201,
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
