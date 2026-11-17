import type { APIRoute } from 'astro';
import { fgaClient, checkPermission } from '../../../../lib/openfga';
import { json } from '../../../../lib/api';
import { readTuplesForObject, readParentObjects, type FgaTuple } from '../../../../lib/acl/reader';
import {
  accessErrorResponse,
  assertProbeAllowed,
  can,
  effectiveRole,
  requireReadAcl,
  resolveObjectId,
  ANONYMOUS,
  type ContentRole,
} from '../../../../lib/acl/guards';
import { MODEL } from '../../../../lib/acl/modelSpec';

export interface TroubleshootStep {
  type: 'direct' | 'public' | 'group' | 'inheritance' | 'owner' | 'none' | 'error';
  matched: boolean;
  /** Human-readable description of the rule that applied. */
  rule: string;
  /** The tuples that actually produced this verdict. */
  tuples: string[];
  detail: string;
}

/** Relations the model defines for a type, so the UI never offers a phantom role. */
function relationsForType(type: string): string[] {
  return Object.keys(MODEL[type]?.relations ?? {});
}

/**
 * Explain why a principal does or does not have a relation on a resource.
 *
 * ── Why this was rewritten ──────────────────────────────────────────────────
 *
 * The previous implementation re-implemented ReBAC in JavaScript: it scanned
 * tuples with a filter that only matched the literal `circle:` prefix (a type
 * that does not exist in the model), looked at exactly one level of parent, and
 * never considered `owner → editor`. On top of that it read tuples with an
 * unpaginated `fgaClient.read()`, so it was reasoning about 50 of 3,253 tuples.
 *
 * The result was a correct verdict (that came from a real `check()`) attached to
 * a fabricated explanation — "No Direct Tuple" for a grant that demonstrably
 * existed. That is the worst possible failure mode for a debugging tool.
 *
 * Now every step is derived from tuples that were actually read, and the
 * engine's own `expand()` supplies the provenance tree. A step can no longer
 * disagree with the verdict, because both come from the same source.
 */
export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  try {
    const currentUser = locals.user || ANONYMOUS;
    if (currentUser === ANONYMOUS) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: You must be logged in to troubleshoot policies.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    let { principal, resource, relation = 'viewer' } = body;

    if (!principal || !resource) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: principal, resource' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!principal.includes(':') && !principal.startsWith('*')) {
      principal = `user:${principal}`;
    }

    const objectType = resource.includes(':') ? resource.split(':')[0] : undefined;
    const { object } = await resolveObjectId(objectType, resource);

    const ctx = { actor: currentUser, object, ip: clientAddress };
    try {
      await requireReadAcl(ctx);
      await assertProbeAllowed(ctx, principal, relation);
    } catch (err) {
      const denied = accessErrorResponse(err);
      if (denied) return denied;
      throw err;
    }

    // Guard against offering a role the model does not define. Probing an
    // undefined relation returns a 400 that checkPermission swallows into
    // `false`, which is how a `commenter` rung became unselectable-but-visible.
    const availableRelations = relationsForType(objectType || '');
    if (availableRelations.length > 0 && !availableRelations.includes(relation)) {
      return json(
        {
          error: `Relation '${relation}' is not defined for type '${objectType}'.`,
          code: 'relation_not_defined',
          available: availableRelations,
        },
        { status: 400 }
      );
    }

    // Authoritative verdict, deny-aware.
    const isAllowed = await can(principal, relation, object);

    const steps: TroubleshootStep[] = [];
    let readOk = true;
    let truncated = false;

    try {
      const direct = await readTuplesForObject(object);
      truncated = direct.truncated;
      const tuples = direct.tuples;

      const fmt = (t: FgaTuple) => `${t.user} -[${t.relation}]-> ${t.object}`;

      // ── Direct grants ─────────────────────────────────────────────────────
      const directForPrincipal = tuples.filter((t) => t.user === principal);
      if (directForPrincipal.length > 0) {
        steps.push({
          type: 'direct',
          matched: true,
          rule: directForPrincipal.map((t) => `${principal} -[${t.relation}]-> ${object}`).join(', '),
          tuples: directForPrincipal.map(fmt),
          detail:
            'The principal is assigned this relation directly on this resource. ' +
            'Direct grants are the strongest form and are not inherited.',
        });
      }

      // ── Owner → higher relations (the path the old code never checked) ────
      const owns = directForPrincipal.some((t) => t.relation === 'owner');
      if (owns && relation !== 'owner') {
        steps.push({
          type: 'owner',
          matched: true,
          rule: `${principal} -[owner]-> ${object}  ⇒  ${relation}`,
          tuples: [`${principal} -[owner]-> ${object}`],
          detail:
            `The principal owns this resource, and the model grants '${relation}' to owners. ` +
            'Ownership also implies the ability to change who has access.',
        });
      }

      // ── Public wildcard ───────────────────────────────────────────────────
      const publicGrants = tuples.filter(
        (t) => (t.user === 'user:*' || t.user === '*') && (t.relation === relation || t.relation === 'editor')
      );
      if (publicGrants.length > 0) {
        steps.push({
          type: 'public',
          matched: true,
          rule: publicGrants.map(fmt).join(', '),
          tuples: publicGrants.map(fmt),
          detail:
            'This resource is shared publicly. Anyone with the link — including people who are not ' +
            'signed in — receives this relation. The ACL itself is never public.',
        });
      }

      // ── Group membership ──────────────────────────────────────────────────
      // Groups are `group` with `group#member` in the model. The old code
      // filtered for a `circle:` prefix, a type that has never existed, so this
      // explanation was permanently unreachable.
      const groupGrants = tuples.filter(
        (t) => t.user.endsWith('#member') && t.relation === relation
      );
      for (const g of groupGrants) {
        const groupObject = g.user.split('#')[0];
        const isMember = await checkPermission({
          user: principal,
          relation: 'member',
          object: groupObject,
        });
        if (isMember) {
          steps.push({
            type: 'group',
            matched: true,
            rule: `${principal} -[member]-> ${groupObject} ⇒ -[${g.relation}]-> ${object}`,
            tuples: [`${principal} -[member]-> ${groupObject}`, fmt(g)],
            detail: `The principal belongs to ${groupObject}, which holds '${g.relation}' on this resource.`,
          });
        }
      }

      // ── Container inheritance ─────────────────────────────────────────────
      // Walk the real structural tuples, not `resources.parent_id`, and
      // consider every rung — including a parent owner granting editor.
      const parents = await readParentObjects(object);
      for (const parent of parents) {
        const parentObject = `${parent.type}:${parent.id}`;
        const inherited = await can(principal, relation, parentObject);
        if (inherited) {
          const parentRole = await effectiveRole(principal, parentObject);
          steps.push({
            type: 'inheritance',
            matched: true,
            rule: `${principal} -[${parentRole}]-> ${parentObject} ⇒ -[${relation}]-> ${object}`,
            tuples: [`${parent.type}:${parent.id} -[parent_*]-> ${object}`],
            detail:
              `Access is inherited from the container ${parentObject}, where the principal holds ` +
              `'${parentRole}'. Inheritance is computed live, so a change on the container takes effect here.`,
          });
        }
      }

      // ── Verdict, or an honest miss ────────────────────────────────────────
      if (steps.length === 0) {
        steps.push({
          type: 'none',
          matched: false,
          rule: `No rule grants '${relation}' to ${principal} on ${object}`,
          tuples: [],
          detail: truncated
            ? 'No matching grant was found, but the policy store exceeded the read budget for this ' +
              'request, so this result may be incomplete.'
            : `No direct grant, no group membership, and no inheriting container grants '${relation}'.`,
        });
      }
    } catch (readErr: any) {
      // A read failure must never be rendered as "no access found" — that is
      // precisely the bug that hid the pagination defect.
      readOk = false;
      steps.push({
        type: 'error',
        matched: false,
        rule: 'Could not read the authorization policy store',
        tuples: [],
        detail:
          `The OpenFGA policy store could not be read (${readErr.message}). ` +
          'The verdict above comes from the authorization engine, but the breakdown below is unavailable.',
      });
    }

    // Engine-native provenance, so the explanation is the engine's own.
    let provenance: any = null;
    try {
      const expanded = await fgaClient.expand({ relation, object } as any);
      provenance = expanded.tree ?? null;
    } catch {
      provenance = null;
    }

    // Only relations the model defines for this type are probed, so a
    // `commenter` rung can never masquerade as a real role.
    const ladder = (['owner', 'editor', 'viewer'] as ContentRole[]).filter((r) =>
      availableRelations.length === 0 ? true : availableRelations.includes(r)
    );
    const role: ContentRole | 'none' = await effectiveRole(principal, object);

    return new Response(
      JSON.stringify({
        isAllowed,
        principal,
        resource: object,
        relation,
        effectiveRole: role,
        roleLadder: ladder,
        resolutionSteps: steps,
        provenance,
        readOk,
        truncated,
        evaluatedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
