import type { APIRoute } from 'astro';
import { applyGrant, applyRevoke } from '../../../../lib/acl/projector';
import { reconcileNow } from '../../../../lib/acl/projection';
import { json } from '../../../../lib/api';
import { writeAudit } from '../../../../lib/audit';
import { readTuplesForObject } from '../../../../lib/acl/reader';
import {
  accessErrorResponse,
  assertNotLastShareholder,
  requireManageGrants,
  resolveObjectId,
  ANONYMOUS,
} from '../../../../lib/acl/guards';
import { assignableRelations } from '../../../../lib/acl/compileModel';
import { MODEL } from '../../../../lib/acl/modelSpec';

/**
 * Remove access, or place an explicit block.
 *
 * SECURITY: like `grant.ts`, this previously had no authorization beyond
 * "is logged in", so any user could revoke anyone else's access. Its
 * `effect: 'deny'` branch also wrote `denied_<role>`, which on the old model
 * was a declared-but-unreferenced relation and therefore did nothing at all —
 * a restriction that silently failed open.
 *
 * Both problems are fixed here: grants are gated on `manage_grants`, and the
 * deny branch writes a real, checkable `denied_viewer` / `denied_editor`
 * relation that `guards.can()` actually consults.
 */
export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  try {
    const currentUser = locals.user || ANONYMOUS;
    if (currentUser === ANONYMOUS) {
      return json({ error: 'Unauthorized: You must be logged in to modify permissions.' }, { status: 401 });
    }

    const body = await request.json();
    const { resource, principal, role, effect } = body;

    if (!resource || !principal || !role) {
      return json({ error: 'Missing required parameters: resource, principal, role' }, { status: 400 });
    }

    const objectType = resource.includes(':') ? resource.split(':')[0] : undefined;
    const { object } = await resolveObjectId(objectType, resource);

    try {
      await requireManageGrants({ actor: currentUser, object, ip: clientAddress });
    } catch (err) {
      const denied = accessErrorResponse(err);
      if (denied) return denied;
      throw err;
    }

    if (!MODEL[objectType || '']) {
      return json({ error: `Unknown resource type '${objectType}'.`, code: 'unknown_type' }, { status: 400 });
    }

    const assignable = new Set(assignableRelations(objectType || ''));
    const targetRelation =
      effect === 'deny' ? (role === 'editor' ? 'denied_editor' : 'denied_viewer') : role;

    if (assignable.size > 0 && !assignable.has(targetRelation)) {
      return json(
        {
          error: `'${targetRelation}' is not a relation on type '${objectType}'.`,
          code: 'relation_not_found',
          available: [...assignable],
        },
        { status: 400 }
      );
    }

    // Removing the final grant-administrator would permanently lock the ACL.
    if (effect !== 'deny') {
      try {
        await assertNotLastShareholder({ object, subject: principal, relation: targetRelation });
      } catch (err) {
        const denied = accessErrorResponse(err);
        if (denied) return denied;
        throw err;
      }
    }

    const success =
      effect === 'deny'
        ? await applyGrant({ object, subject: principal, relation: targetRelation })
        : await applyRevoke({ object, subject: principal, relation: targetRelation });

    if (!success) {
      return json({ error: `OpenFGA rejected the operation for ${principal}.` }, { status: 500 });
    }

    void writeAudit({
      actor: currentUser,
      action: effect === 'deny' ? 'permission.block' : 'permission.revoke',
      resourceType: 'permission',
      resourceId: object,
      detail: { relation: targetRelation, user: principal, object, effect: effect || 'revoke' },
      ip: clientAddress,
    });

    // Flush the read model before responding, so the Share dialog does not
    // re-render from before the change the user just made.
    await reconcileNow().catch(() => {});

    return json(
      {
        success,
        revoked: { principal, role: targetRelation, resource: object, effect: effect || 'revoke' },
        directTuples: (await readTuplesForObject(object)).tuples,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
