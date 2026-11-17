import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { accessErrorResponse, requireReadAcl, ANONYMOUS } from '../../../../lib/acl/guards';
import { revocationImpact, projectionState } from '../../../../lib/acl/projection';
import { principalLabel } from '../../../../components/iam/types';

/**
 * Preview a revocation: who actually loses access, and what is unaffected.
 *
 * The answer comes from the projection, which is a cache, so it is reported with
 * the projection's own staleness rather than presented as certainty. The
 * revocation itself is still validated against the engine when it is committed.
 *
 * Gated on `read_acl`, the same capability as reading the ACL — you cannot ask
 * about the blast radius of a change you are not allowed to make.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const currentUser = locals.user || ANONYMOUS;
    if (currentUser === ANONYMOUS) return json({ error: 'Unauthorized.' }, { status: 401 });

    const { resource, subject } = await request.json();
    if (!resource || !subject) {
      return json({ error: 'Missing required parameters: resource, subject' }, { status: 400 });
    }

    try {
      await requireReadAcl({ actor: currentUser, object: resource });
    } catch (err) {
      const denied = accessErrorResponse(err);
      if (denied) return denied;
      throw err;
    }

    const impact = await revocationImpact({ resourceId: resource, subjectId: subject });
    const state = await projectionState();

    return json({
      impact,
      subject: { id: subject, label: principalLabel(subject) },
      // Explicit rather than implied: a stale projection means the count may be
      // low, and the UI says so instead of over-promising.
      approximate: state.stale,
      projectedAt: state.lastReconcileAt,
    });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
