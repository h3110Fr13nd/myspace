import type { APIRoute } from 'astro';
import { checkPermission } from '../../../../lib/openfga';
import { json } from '../../../../lib/api';
import {
  accessErrorResponse,
  assertProbeAllowed,
  can,
  effectiveRole,
  resolveObjectId,
  ANONYMOUS,
} from '../../../../lib/acl/guards';

/**
 * Evaluate one (subject, relation, object) authorization question.
 *
 * SECURITY: this endpoint previously had no authentication and no `locals`
 * parameter at all, making it a free oracle over the entire authorization
 * graph — "does user X have relation R on object O" for any X and O, with both
 * parameters attacker-controlled. See
 * plan/core-architecture/31-iam-access-visibility-and-policy-troubleshooter.md §1 (V2).
 *
 * It is now:
 *   - authenticated,
 *   - self-only by default; asking about another subject requires `read_acl`
 *     on the object, is rate limited, and is audited as `permission.probe`,
 *   - answered through the deny-aware `can()` path rather than the raw engine,
 *     so a blocked subject reads as denied instead of allowed.
 */
export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  try {
    const currentUser = locals.user || ANONYMOUS;
    if (currentUser === ANONYMOUS) {
      return json({ error: 'Unauthorized: you must be logged in.' }, { status: 401 });
    }

    const body = await request.json();
    const { user, action, resource } = body;

    if (!user || !action || !resource) {
      return json({ error: 'Missing required parameters: user, action, resource' }, { status: 400 });
    }

    const subject = user.includes(':') ? user : `user:${user}`;
    const { object } = await resolveObjectId(
      resource.includes(':') ? resource.split(':')[0] : undefined,
      resource
    );

    const ctx = { actor: currentUser, object, ip: clientAddress };
    try {
      await assertProbeAllowed(ctx, subject, action);
    } catch (err) {
      const denied = accessErrorResponse(err);
      if (denied) return denied;
      throw err;
    }

    // `can` applies deny precedence; the raw engine call is kept for the
    // self-check path where no deny tuple can be in play and an exact engine
    // answer is preferable.
    const allowed =
      subject === currentUser
        ? await checkPermission({ user: subject, relation: action, object })
        : await can(subject, action, object);

    return json(
      {
        allowed,
        user: subject,
        action,
        resource: object,
        // Only disclose the subject's own standing on the object.
        subjectRole: subject === currentUser ? await effectiveRole(subject, object) : undefined,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
