import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { requireManageGrants, requireReadAcl, accessErrorResponse, ANONYMOUS } from '../../../../lib/acl/guards';
import { getAudience, setAudience, exposureOf, isExpired, type AudienceKind } from '../../../../lib/acl/audience';
import { readTuplesForObject } from '../../../../lib/acl/reader';
import { describeGroups, groupIdsIn } from '../../../../lib/acl/groups';
import { query } from '../../../../lib/db';
import { writeAudit } from '../../../../lib/audit';

/**
 * Read or change a resource's audience slot.
 *
 * GET  → the current audience plus its exposure classification.
 * PUT  → set it. Writes the graph grant, the audience row, and the derived
 *         `is_public` cache together, and revokes every prior audience subject
 *         first so downgrading can never leave a wider audience behind.
 *
 * Modifying requires `manage_grants`; reading requires `read_acl`, matching the
 * rest of the permission surface. Anonymous callers are never served here — the
 * graph answers their access questions directly.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const currentUser = locals.user || ANONYMOUS;
  if (currentUser === ANONYMOUS) return json({ error: 'Unauthorized.' }, { status: 401 });

  const object = new URL(request.url).searchParams.get('object');
  if (!object) return json({ error: 'Missing required query param: object' }, { status: 400 });

  try {
    await requireReadAcl({ actor: currentUser, object });
  } catch (err) {
    const denied = accessErrorResponse(err);
    if (denied) return denied;
    throw err;
  }

  const audience = await getAudience(object);
  const tuples = await readTuplesForObject(object);
  const hasExternal = tuples.tuples.some(
    (t) => t.user !== currentUser && (t.user === 'user:*' || t.user === '*' || t.user.startsWith('group:'))
  );

  return json({
    audience,
    exposure: exposureOf(audience, hasExternal),
    expired: isExpired(audience),
  });
};

export const PUT: APIRoute = async ({ request, locals, clientAddress }) => {
  try {
    const currentUser = locals.user || ANONYMOUS;
    if (currentUser === ANONYMOUS) {
      return json({ error: 'Unauthorized: You must be logged in to change access.' }, { status: 401 });
    }

    const body = await request.json();
    const { object, kind, rung, expiresAt } = body;

    if (!object || !kind) {
      return json({ error: 'Missing required parameters: object, kind' }, { status: 400 });
    }
    if (!['restricted', 'workspace', 'public_link'].includes(kind)) {
      return json(
        { error: `Unknown audience '${kind}'.`, code: 'invalid_audience' },
        { status: 400 }
      );
    }
    if (rung != null && !['viewer', 'editor'].includes(rung)) {
      return json(
        { error: `Audience rung must be 'viewer' or 'editor', got '${rung}'.`, code: 'invalid_rung' },
        { status: 400 }
      );
    }

    try {
      await requireManageGrants({ actor: currentUser, object, ip: clientAddress });
    } catch (err) {
      const denied = accessErrorResponse(err);
      if (denied) return denied;
      throw err;
    }

    const saved = await setAudience({
      resourceId: object,
      kind: kind as AudienceKind,
      rung: rung ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      actor: currentUser,
    });

    void writeAudit({
      actor: currentUser,
      action: 'permission.audience',
      resourceType: 'permission',
      resourceId: object,
      detail: { kind: saved.kind, rung: saved.rung, expiresAt: saved.expiresAt },
      ip: clientAddress,
    });

    return json({ success: true, audience: saved, exposure: exposureOf(saved, false) });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
