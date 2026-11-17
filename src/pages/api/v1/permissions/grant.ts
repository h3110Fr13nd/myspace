import type { APIRoute } from 'astro';
import { applyGrant, applyRevoke } from '../../../../lib/acl/projector';
import { reconcileNow } from '../../../../lib/acl/projection';
import { query } from '../../../../lib/db';
import { getValidGoogleAccessToken } from '../../../../lib/google/tokenBroker';
import {
  mirrorOpenFgaPermissionToGoogleDrive,
  listGoogleDrivePermissions,
  revokeGoogleDriveFilePermission,
  getGoogleDriveFileIdFromMetadata,
} from '../../../../lib/google/permissionsClient';
import { json } from '../../../../lib/api';
import { writeAudit } from '../../../../lib/audit';
import { readTuplesForObject } from '../../../../lib/acl/reader';
import {
  accessErrorResponse,
  can,
  preflightGrant,
  requireManageGrants,
  resolveObjectId,
  ANONYMOUS,
} from '../../../../lib/acl/guards';
import { assignableRelations } from '../../../../lib/acl/compileModel';
import { MODEL } from '../../../../lib/acl/modelSpec';

/** Roles that may be granted, per type, from the compiled model spec. */
function grantableRoles(type: string): string[] {
  const assignable = new Set(assignableRelations(type));
  return ['owner', 'editor', 'viewer', 'denied_viewer', 'denied_editor', 'read_acl', 'manage_grants'].filter((r) =>
    assignable.has(r)
  );
}

/**
 * Normalise a caller-supplied principal.
 *
 * The UI historically advertised `circle:engineering`, a type that has never
 * existed in the model — every such write was rejected by the engine. Circles
 * are `group` with `group#member`, so map the old spelling forward rather than
 * failing, and say so in the response.
 */
function normalizePrincipal(
  raw: string
): { principal: string; migratedFrom?: string } {
  if (raw.startsWith('circle:')) {
    return { principal: `group:${raw.slice('circle:'.length)}`, migratedFrom: raw };
  }
  if (raw.startsWith('group:')) {
    // A grant to a group must name the userset (`group:eng#member`), because the
    // model admits `group#member`, not a bare `group`.
    return { principal: raw.includes('#') ? raw : `${raw}#member` };
  }
  if (!raw.includes(':') && !raw.startsWith('*')) {
    return { principal: `user:${raw}` };
  }
  return { principal: raw };
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  try {
    const currentUser = locals.user || ANONYMOUS;
    if (currentUser === ANONYMOUS) {
      return json({ error: 'Unauthorized: You must be logged in to modify permissions.' }, { status: 401 });
    }

    const body = await request.json();
    const { resource, role, action } = body;
    let principal: string | undefined = body.principal;

    if (!resource || !principal || !role) {
      return json({ error: 'Missing required parameters: resource, principal, role' }, { status: 400 });
    }

    const normalized = normalizePrincipal(principal.trim());
    principal = normalized.principal;

    const objectType = resource.includes(':') ? resource.split(':')[0] : undefined;
    const { object: dbResourceId } = await resolveObjectId(objectType, resource);

    // ── Authorization ───────────────────────────────────────────────────────
    // Previously ANY authenticated user could write ACL tuples for ANY resource.
    try {
      await requireManageGrants({ actor: currentUser, object: dbResourceId, ip: clientAddress });
    } catch (err) {
      const denied = accessErrorResponse(err);
      if (denied) return denied;
      throw err;
    }

    // ── Model validation ────────────────────────────────────────────────────
    // Validate against the model instead of letting the engine 400 with a raw
    // message, which surfaced to users as "Failed to grant permission".
    const validRoles = objectType ? grantableRoles(objectType) : [];
    if (validRoles.length > 0 && !validRoles.includes(role)) {
      return json(
        {
          error: `'${role}' is not a grantable relation on type '${objectType}'.`,
          code: 'relation_not_grantable',
          available: validRoles,
        },
        { status: 400 }
      );
    }

    if (!MODEL[objectType || '']) {
      return json(
        { error: `Unknown resource type '${objectType}'.`, code: 'unknown_type' },
        { status: 400 }
      );
    }

    // ── Pre-flight ──────────────────────────────────────────────────────────
    // Refuse states the model cannot represent coherently, most importantly a
    // deny that contradicts a direct grant. Deny is fail-closed in `guards.ts`,
    // so allowing both would silently produce "blocked but still has access".
    const plan = await preflightGrant({ object: dbResourceId, subject: principal, relation: role });
    if (plan.errors.length > 0) {
      return json(
        { error: plan.errors[0], code: 'conflicting_grant', details: plan.errors },
        { status: 409 }
      );
    }

    // ── Apply ───────────────────────────────────────────────────────────────
    let success = false;
    if (action === 'revoke') {
      success = await applyRevoke({ object: dbResourceId, subject: principal, relation: role });
    } else {
      success = await applyGrant({ object: dbResourceId, subject: principal, relation: role });
    }

    if (!success) {
      return json(
        { error: `OpenFGA rejected the ${action || 'grant'} of '${role}' to ${principal}.` },
        { status: 500 }
      );
    }

    void writeAudit({
      actor: currentUser,
      action: action === 'revoke' ? 'permission.revoke' : 'permission.grant',
      resourceType: 'permission',
      resourceId: dbResourceId,
      detail: { relation: role, user: principal, object: dbResourceId },
      ip: clientAddress,
    });

    // Keep the legacy public flag in step with the actual grant, so the two do
    // not drift into disagreeing about whether a resource is public.
    if (principal === 'user:*' || principal === '*') {
      try {
        await query('UPDATE resources SET is_public = $2 WHERE id = $1', [
          dbResourceId,
          action === 'revoke' ? false : true,
        ]);
      } catch {}
    }

    // Google Drive mirroring: only meaningful for real user email addresses.
    try {
      const dbResource = await query('SELECT metadata FROM resources WHERE id = $1 LIMIT 1', [dbResourceId]);
      const driveFileId = getGoogleDriveFileIdFromMetadata(dbResource.rows?.[0]?.metadata);
      if (driveFileId && principal.startsWith('user:') && principal.includes('@')) {
        const userEmail = principal.replace(/^user:/, '');
        const googleToken = await getValidGoogleAccessToken(currentUser);
        if (googleToken) {
          if (action === 'revoke') {
            const existing = await listGoogleDrivePermissions(driveFileId, googleToken);
            const perm = existing.find((p) => p.emailAddress?.toLowerCase() === userEmail.toLowerCase());
            if (perm) await revokeGoogleDriveFilePermission(driveFileId, perm.id, googleToken);
          } else {
            await mirrorOpenFgaPermissionToGoogleDrive(driveFileId, userEmail, role as any, googleToken);
          }
        }
      }
    } catch (gSyncErr) {
      console.warn('[Permissions] Google Drive sync skipped or failed:', gSyncErr);
    }

    // Flush the read model before responding, so the Share dialog does not
    // re-render from before the change the user just made.
    await reconcileNow().catch(() => {});

    return json(
      {
        success: true,
        granted: { principal, role, resource: dbResourceId },
        action: action || 'grant',
        warnings: plan.warnings,
        migratedFrom: normalized.migratedFrom,
        canManageGrants: await can(currentUser, 'manage_grants', dbResourceId),
        // Re-read so the caller renders engine truth rather than an optimistic guess.
        directTuples: (await readTuplesForObject(dbResourceId)).tuples,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
