import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { json } from '../../../../lib/api';
import { readTuplesForObject, type FgaTuple } from '../../../../lib/acl/reader';
import {
  accessErrorResponse,
  can,
  effectiveRole,
  requireReadAcl,
  resolveObjectId,
  ANONYMOUS,
} from '../../../../lib/acl/guards';
import { getAudience, exposureOf } from '../../../../lib/acl/audience';
import { describeGroups, groupIdsIn } from '../../../../lib/acl/groups';
import { displayForPrincipals } from '../../../../lib/userIds';
import { projectionState, effectiveAclFor } from '../../../../lib/acl/projection';

/**
 * Read the access-control list for a single resource.
 *
 * SECURITY: this endpoint used to require no authentication at all and returned
 * `directTuples` / `inheritedTuples` / `isOwner` to anyone who asked. It only
 * *appeared* to return nothing because an unpaginated `fgaClient.read()` was
 * silently returning 1.5% of the store — so fixing that read without adding this
 * guard would have converted a cosmetic bug into a full ACL disclosure.
 *
 * Reading the ACL is now gated on the `read_acl` capability, which the model
 * grants to editors and owners (and their inheritors) but explicitly NOT to
 * viewers, commenters, or the `user:*` public wildcard. See
 * plan/core-architecture/31-iam-access-visibility-and-policy-troubleshooter.md §1 (V3).
 */
export const GET: APIRoute = async ({ request, locals, clientAddress }) => {
  try {
    const currentUser = locals.user || ANONYMOUS;
    const url = new URL(request.url);
    const rawId = url.searchParams.get('id');

    if (!rawId) {
      return json({ error: 'Missing required query param: id' }, { status: 400 });
    }

    const typeParam = url.searchParams.get('type') || undefined;
    const { object: fgaObjectId, found } = await resolveObjectId(typeParam, rawId);

    let resourceRow: any = null;
    try {
      const dbRes = await query(
        `SELECT id, type, title, owner_id, parent_id, is_public, path
         FROM resources
         WHERE id = $1 OR id = $2
         LIMIT 1`,
        [rawId, fgaObjectId]
      );
      resourceRow = dbRes.rows?.[0] ?? null;
    } catch (e: any) {
      console.warn('[Permissions Resource API] DB lookup error:', e.message);
    }

    const ctx = { actor: currentUser, object: fgaObjectId, ip: clientAddress };

    try {
      await requireReadAcl(ctx);
    } catch (err) {
      const denied = accessErrorResponse(err);
      if (denied) return denied;
      throw err;
    }

    // Direct grants on this object. The reader paginates to exhaustion and
    // reports truncation instead of returning a partial set silently.
    const direct = await readTuplesForObject(fgaObjectId);

    // Inherited grants, read from the structural tuples rather than from
    // `resources.parent_id`, so a disagreement between the database hierarchy
    // and the relationship graph cannot produce a wrong answer.
    const inheritedTuples: Array<FgaTuple & { sourceTitle?: string }> = [];
    if (resourceRow?.parent_id) {
      const parentObject = resourceRow.parent_id;
      const parentRead = await readTuplesForObject(parentObject);
      let parentTitle: string | undefined;
      try {
        const p = await query('SELECT title FROM resources WHERE id = $1 LIMIT 1', [parentObject]);
        parentTitle = p.rows?.[0]?.title;
      } catch {}

      for (const t of parentRead.tuples) {
        inheritedTuples.push({ ...t, sourceTitle: parentTitle || parentObject });
      }
    }

    const isPublic = direct.tuples.some(
      (t) => (t.user === 'user:*' || t.user === '*') && (t.relation === 'viewer' || t.relation === 'editor')
    );

    const myRole = await effectiveRole(currentUser, fgaObjectId);
    const isOwner = myRole === 'owner';

    // The audience slot, so the UI can render one exclusive "General access"
    // control instead of guessing from tuples. Publicness is a real grant now,
    // so it is explainable by the troubleshooter rather than invisible to it.
    const audience = await getAudience(fgaObjectId);

    // Principals are rendered, not shown as ids. Ids became opaque uuids in
    // migration 0009, so `user:1f93…` in an ACL row would be unreadable — and
    // before that, `user:dummy_mail` put a live email into audit
    // records. Groups report a member COUNT and never their member list, because
    // expanding a group into an ACL leaks org structure.
    const grantTuples = [...direct.tuples, ...inheritedTuples];
    const groupMeta = await describeGroups(groupIdsIn(grantTuples));

    const serviceRows = await query('SELECT id, name FROM service_accounts');
    const serviceMeta = new Map((serviceRows.rows || []).map((r: any) => [r.id, r.name]));

    const display = await displayForPrincipals(grantTuples.map((t) => t.user), {
      groupMeta,
      serviceMeta,
    });

    const decorate = (t: any) => {
      const info = display.get(t.user.replace(/#.*$/, ''));
      if (!info) return t;
      const groupBase = t.user.startsWith('group:') ? t.user.split('#')[0] : null;
      const group = groupBase ? groupMeta.get(groupBase) : null;
      return {
        ...t,
        label: info.label,
        principalKind: info.kind,
        ...(group ? { groupName: group.name, memberCount: group.memberCount } : {}),
      };
    };

    const hasExternalGrant = direct.tuples.some(
      (t) =>
        t.user !== currentUser &&
        (t.user === 'user:*' || t.user === '*' || t.user.startsWith('group:'))
    );

    return new Response(
      JSON.stringify({
        success: true,
        resourceId: rawId,
        fgaObjectId,
        resource: resourceRow || null,
        directTuples: direct.tuples.map(decorate),
        inheritedTuples: inheritedTuples.map(decorate),
        isPublic,
        isOwner,
        currentUser,
        myRole,
        audience,
        exposure: exposureOf(audience, hasExternalGrant),
        // The projection, with per-row provenance ("via Research", depth). The
        // Share dialog renders inherited rows as ghosted and links the source, so
        // "who can see this" stops requiring the reader to walk the tree.
        effectiveAcl: await effectiveAclFor(fgaObjectId),
        // Surfaced so a stale read model is visible rather than silently wrong.
        projection: await projectionState(),
        canManageGrants: await can(currentUser, 'manage_grants', fgaObjectId),
        // Surfaced so the UI can distinguish "no grants" from "could not read".
        readOk: true,
        truncated: direct.truncated,
        found,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
