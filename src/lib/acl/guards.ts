/**
 * The single authorization chokepoint for every permission-sensitive operation.
 *
 * ── Why deny lives here and not in the model ───────────────────────────────
 *
 * The obvious place for a "Blocked here" rule is the authorization model, as
 * `viewer: (...) and not denied_viewer`. That is not expressible on the pinned
 * engine: OpenFGA v1.5's JSON model API rejects every `exclusion` userset shape
 * with "invalid userset rewrite definition" (verified against the running
 * server across base/child combinations and both schema versions), while
 * `union` and `intersection` validate normally.
 *
 * Attempting it anyway is the dangerous outcome — a model that either refuses to
 * deploy or, worse, deploys with the exclusion silently dropped, turning every
 * restriction into a no-op that fails OPEN. `denied_viewer` was already in that
 * exact state: declared on 11 types, referenced by zero unions.
 *
 * So denial is an explicit `check()` here instead. `denied_viewer` and
 * `denied_editor` remain ordinary assignable relations, the engine still owns
 * the decision, and this module is the one place the rule is applied. Do not
 * re-inline it into the model without re-testing engine support first.
 *
 * ── Precedence ──────────────────────────────────────────────────────────────
 *
 *   deny  >  every grant path
 *
 * Deny is fail-closed and wins unconditionally. This is deliberately stricter
 * than Google Drive, whose "Access removed" list loses to any direct grant and
 * therefore produces "I removed Anna and she still has access". The confusing
 * state Drive ships is prevented upstream instead — `preflightBlock()` refuses
 * to create a deny that contradicts a direct grant and tells the user which
 * grant to remove first.
 */
import { checkPermission, PUBLIC_USER } from '../openfga';
import { writeAudit } from '../audit';
import { consumeRateLimit } from '../rateLimit';
import { readParentObjects, readTuplesForObject, type FgaTuple } from './reader';
import { toFgaObjectId } from '../resourceId';

export const ANONYMOUS = 'user:anonymous';

/** Relations that expose the ACL itself, as opposed to the content it guards. */
export const ACL_RELATIONS = ['read_acl', 'manage_grants'] as const;

/** Content ladder, weakest → strongest. Mirrors `authz/model.fga`. */
export const CONTENT_LADDER = ['viewer', 'editor', 'owner'] as const;
export type ContentRole = (typeof CONTENT_LADDER)[number];

/**
 * Which deny relations block a given content relation.
 *
 * Cumulative down the ladder, and this ordering matters for correctness: a
 * subject blocked from *viewing* must also be unable to *edit*. Checking only
 * the deny that matches the requested relation exactly would let
 * `denied_viewer` pass straight through an `editor` check — write access
 * without read access, which is a fail-open.
 *
 * `read_acl` and `manage_grants` are administrative capabilities rather than
 * content rungs, so they are blocked by the same deny that removes visibility.
 */
const DENY_BLOCKS: Record<string, string[]> = {
  viewer: ['denied_viewer'],
  editor: ['denied_viewer', 'denied_editor'],
  owner: ['denied_viewer', 'denied_editor'],
  read_acl: ['denied_viewer'],
  manage_grants: ['denied_viewer'],
};

/** Deny relations that block `relation`, or [] if it cannot be denied. */
export function denyBlocks(relation: string): string[] {
  return DENY_BLOCKS[relation] ?? [];
}

export class AccessError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409,
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'AccessError';
  }
}

export interface AccessContext {
  /** Authenticated subject, or `user:anonymous`. */
  actor: string;
  /** Fully-qualified OpenFGA object id, e.g. `canvas:my-canvas`. */
  object: string;
  /** Client IP, for audit + rate limiting. */
  ip?: string;
}

/* ── Deny ──────────────────────────────────────────────────────────────────── */

/**
 * Whether a deny relation applies to this subject on this object, including
 * denies inherited from an ancestor.
 *
 * Inheritance matters: blocking someone on a folder must keep them out of every
 * descendant, which is the whole reason to prefer an explicit deny over trying
 * to subtract an inherited grant.
 */
export async function isDenied(actor: string, object: string, denyRelation: string): Promise<boolean> {
  const direct = await checkPermission({ user: actor, relation: denyRelation, object });
  if (direct) return true;

  // Walk the structural chain. Depth-capped: the resource tree is acyclic by
  // construction (parent_id has a self-FK), so this terminates.
  const MAX_DEPTH = 12;
  let frontier = await readParentObjects(object);
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const parent of frontier) {
      const parentObject = toFgaObjectId(parent.type, parent.id);
      if (await checkPermission({ user: actor, relation: denyRelation, object: parentObject })) return true;
      next.push(parentObject);
    }
    frontier = await readAncestors(next);
  }
  return false;
}

/** Expand a frontier of objects into their structural parents. */
async function readAncestors(objects: string[]): Promise<{ type: string; id: string }[]> {
  const results = await Promise.all(objects.map((o) => readParentObjects(o)));
  return results.flat();
}

/* ── Root of trust: resources.owner_id ─────────────────────────────────────── */

/**
 * Short-lived cache of ownership lookups.
 *
 * The DB is consulted only when the graph says no, so the allow path stays a
 * single engine call. The cache exists because the deny path would otherwise add
 * a query per check, and the Share dialog issues several checks per render.
 */
const ownerCache = new Map<string, { isOwner: boolean; expiresAt: number }>();
const OWNER_CACHE_TTL_MS = 60_000;

/**
 * Whether `resources.owner_id` names this subject.
 *
 * `owner_id` is the declared root of trust for ownership: it is written from the
 * authenticated session at creation (`resourceFactory.createResource` takes
 * `currentUser` from `locals.user`, never from a request body), so it cannot be
 * claimed by a client.
 *
 * This check exists because ownership was being enforced from two places that
 * disagreed. The edit path consulted Postgres; the guard layer consulted only
 * OpenFGA. 748 of 913 resources had an `owner_id` but no `owner` tuple — created
 * by seed scripts, vault sync, and migrations, which write the row but not the
 * grant. The result was that you could open and edit your own resource and then
 * be told you were not allowed to see its access list, and worse, received a 404
 * for a resource that plainly exists.
 *
 * FGA-first, then this: the engine stays the hot path, and the database is the
 * authority when the two disagree.
 */
export async function isDatabaseOwner(actor: string, object: string): Promise<boolean> {
  if (!actor || actor === ANONYMOUS || !object) return false;

  const key = `${actor}|${object}`;
  const cached = ownerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.isOwner;

  let isOwner = false;
  try {
    const { query } = await import('../db');
    const res = await query('SELECT owner_id FROM resources WHERE id = $1 LIMIT 1', [object]);
    isOwner = res.rows?.[0]?.owner_id === actor;
  } catch {
    // A lookup failure must not grant access. Leave `isOwner` false and let the
    // engine's answer stand.
    isOwner = false;
  }

  ownerCache.set(key, { isOwner, expiresAt: Date.now() + OWNER_CACHE_TTL_MS });
  return isOwner;
}

/** Drop cached ownership lookups. Called after ownership changes. */
export function invalidateOwnerCache(object?: string): void {
  if (!object) {
    ownerCache.clear();
    return;
  }
  for (const key of [...ownerCache.keys()]) {
    if (key.endsWith(`|${object}`)) ownerCache.delete(key);
  }
}

/* ── Core decision ─────────────────────────────────────────────────────────── */

/**
 * The one authorization decision function.
 *
 * Deny is evaluated first and wins. Content relations additionally require the
 * implied weaker relations to be satisfied, so a denied editor cannot retain
 * write access through a different path.
 */
export async function can(actor: string, relation: string, object: string): Promise<boolean> {
  if (!actor || actor === ANONYMOUS) return false;

  // Deny first, and it wins. Evaluated across every deny that blocks this
  // relation, so a viewer-block cannot slip through an editor check.
  for (const denyRelation of denyBlocks(relation)) {
    if (await isDenied(actor, object, denyRelation)) return false;
  }

  if (await checkPermission({ user: actor, relation, object })) return true;

  // The graph does not know this subject owns the object, but the database does.
  // Ownership is the root of trust, so the owner is never locked out of their own
  // access list by a missing grant.
  return isDatabaseOwner(actor, object);
}

/** May the subject enumerate who else has access to this object? */
export function canReadAcl(actor: string, object: string): Promise<boolean> {
  return can(actor, 'read_acl', object);
}

/** May the subject change who has access to this object? */
export function canManageGrants(actor: string, object: string): Promise<boolean> {
  return can(actor, 'manage_grants', object);
}

/**
 * Highest role the subject holds, by testing the ladder strongest → weakest.
 *
 * Only relations the model actually defines for this type are probed. Probing
 * an undefined relation returns a 400 that `checkPermission` swallows into
 * `false`, which is how a `commenter` rung silently became unselectable while
 * still being offered in the UI.
 */
export async function effectiveRole(actor: string, object: string): Promise<ContentRole | 'none'> {
  for (const role of [...CONTENT_LADDER].reverse()) {
    if (await can(actor, role, object)) return role;
  }
  return 'none';
}

/* ── Non-existence signalling ──────────────────────────────────────────────── */

/**
 * Resolve a user-supplied resource reference to a canonical FGA object id.
 *
 * Ids are stored fully qualified (`canvas:my-canvas`) while some callers hold a
 * bare slug, so a plain equality lookup misses and yields a fabricated resource
 * with no owner — which is how an ACL endpoint ended up reporting
 * `owner_id: null` for a resource that has one.
 */
export async function resolveObjectId(
  type: string | undefined,
  id: string
): Promise<{ object: string; found: boolean }> {
  if (!id) return { object: '', found: false };
  if (id.includes(':')) return { object: id, found: true };

  const { query } = await import('../db');
  const res = await query('SELECT id, type FROM resources WHERE id = $1 OR id LIKE $2 LIMIT 1', [
    `${type}:${id}`,
    `%:${id}`,
  ]);
  const row = res.rows?.[0];
  if (!row) return { object: toFgaObjectId(type, id), found: false };
  return { object: toFgaObjectId(row.type, row.id), found: true };
}

/* ── Guards ────────────────────────────────────────────────────────────────── */

/**
 * Require that the actor may read the ACL, and fail with the correct
 * non-existence signal.
 *
 * 404 vs 403 is not cosmetic. Confluence separates them deliberately so a
 * prober cannot distinguish "this space exists" from "this page exists"; a
 * blanket 403 leaks the existence of every object id an attacker can guess.
 */
export async function requireReadAcl(ctx: AccessContext): Promise<void> {
  const { actor, object } = ctx;
  if (!actor || actor === ANONYMOUS) {
    throw new AccessError(401, 'Authentication required.', 'unauthenticated');
  }
  if (await canReadAcl(actor, object)) return;

  // Do not confirm existence to someone who cannot even see the object.
  if (!(await can(actor, 'viewer', object))) {
    throw new AccessError(404, 'Not found.', 'not_found');
  }
  throw new AccessError(
    403,
    'You do not have permission to view who has access to this resource.',
    'forbidden'
  );
}

/** Require that the actor may change grants. */
export async function requireManageGrants(ctx: AccessContext): Promise<void> {
  const { actor, object } = ctx;
  if (!actor || actor === ANONYMOUS) {
    throw new AccessError(401, 'Authentication required.', 'unauthenticated');
  }
  if (await canManageGrants(actor, object)) return;

  if (!(await can(actor, 'viewer', object))) {
    throw new AccessError(404, 'Not found.', 'not_found');
  }
  throw new AccessError(403, 'Only the owner of this resource can change who has access.', 'forbidden');
}

/* ── Probe containment ──────────────────────────────────────────────────────── */

/**
 * Rate-limit and audit authorization probes.
 *
 * Even correctly gated, "does subject S have relation R on object O" is a
 * membership oracle: an owner asking about `intern@x` learns whether that
 * person exists in the workspace. Constrain the subject, bound the rate, and
 * record every probe.
 */
export async function assertProbeAllowed(
  ctx: AccessContext,
  subject: string,
  relation: string
): Promise<void> {
  if (ctx.actor === subject) return; // asking about yourself is always fine

  if (!(await canReadAcl(ctx.actor, ctx.object))) {
    throw new AccessError(403, 'You may only evaluate your own access.', 'forbidden');
  }

  const decision = await consumeRateLimit({
    key: `acl:probe:${ctx.actor}:${subject}:${ctx.object}`,
    limit: 30,
    windowSec: 60,
  });
  if (!decision.allowed) {
    throw new AccessError(403, 'Too many authorization queries. Try again shortly.', 'rate_limited');
  }

  void writeAudit({
    actor: ctx.actor,
    action: 'permission.probe',
    resourceType: 'permission',
    resourceId: ctx.object,
    detail: { subject, relation },
    ip: ctx.ip,
  });
}

/* ── Pre-flight ────────────────────────────────────────────────────────────── */

export interface GrantPlan {
  object: string;
  subject: string;
  relation: string;
  /** Existing grants on the object for this subject, excluding structure. */
  existing: FgaTuple[];
  /** Non-blocking problems the UI should surface. */
  warnings: string[];
  /** Blocking problems; the grant must not be written. */
  errors: string[];
}

/**
 * Validate a grant before writing it, and refuse states the model cannot
 * represent or that would surprise the user.
 *
 * This is the upstream half of "deny wins unconditionally": rather than letting
 * a deny silently lose to a contradictory direct grant, the contradictory
 * combination is never creatable.
 */
export async function preflightGrant(input: {
  object: string;
  subject: string;
  relation: string;
}): Promise<GrantPlan> {
  const { object, subject, relation } = input;
  const errors: string[] = [];
  const warnings: string[] = [];

  const tuples = await readTuplesForObject(object);
  const existing = tuples.tuples.filter((t) => t.user === subject);

  if (relation === 'denied_viewer' || relation === 'denied_editor') {
    const direct = existing.filter((t) => !t.relation.startsWith('denied_'));
    if (direct.length > 0) {
      errors.push(
        `${subject} has a direct ${direct.map((d) => d.relation).join('/')} grant on this resource. ` +
          `Remove it before blocking access, otherwise the two rules contradict each other.`
      );
    }
  }

  if (subject === PUBLIC_USER || subject === '*') {
    if (!['viewer', 'editor'].includes(relation)) {
      errors.push(`Public access only supports 'viewer' or 'editor', not '${relation}'.`);
    } else {
      warnings.push(
        'Public access means anyone with the link, including people who are not signed in. ' +
          'The ACL itself stays private.'
      );
    }
  }

  if (relation === 'manage_grants') {
    warnings.push('This grants the ability to re-share. It is deliberately not inherited by child resources.');
  }

  if (tuples.truncated) {
    warnings.push(
      'The policy store is larger than this tool reads in one pass; the list below may be incomplete.'
    );
  }

  return { object, subject, relation, existing, warnings, errors };
}

/* ── Workspace administration ──────────────────────────────────────────────── */

/**
 * Whether the subject administers access for the whole workspace.
 *
 * Anchored on `manage_grants` over `space:main`, which is the same root of trust
 * the rest of the system uses.
 *
 * This replaced a hardcoded `currentUser === 'user:admin'` comparison in two
 * places. That was not a privileged account — it was a *guessable string*.
 * Because registration derives the user id from the email local part
 * (`dummy_mail` → `user:admin`), anyone could claim it by signing up, and
 * then bypass the authorization graph entirely: full edit on every resource,
 * and unfiltered search across every private and draft document. Verified live
 * before the fix. See
 * plan/core-architecture/31-iam-access-visibility-and-policy-troubleshooter.md §1 (V5).
 */
export function isWorkspaceAdmin(actor: string): Promise<boolean> {
  return canManageGrants(actor, 'space:main');
}

/** Render an `AccessError` as a JSON `Response`. */
export function accessErrorResponse(err: unknown): Response | null {
  if (!(err instanceof AccessError)) return null;
  return new Response(
    JSON.stringify({ error: err.message, code: err.code }),
    { status: err.status, headers: { 'Content-Type': 'application/json' } }
  );
}

/* ── Last-shareholder guard ─────────────────────────────────────────────────── */

/**
 * Refuse to remove the final principal who can change grants.
 *
 * Without this, revoking the last `owner` (or `manage_grants` delegate) leaves
 * an object whose ACL nobody may read or repair — a permanent lockout, since
 * `read_acl` is itself gated on that same capability. Notion enforces the
 * equivalent rule and it is correct.
 *
 * `resources.owner_id` is the root of trust precisely so this state stays
 * recoverable, but the guard prevents creating it in the first place.
 */
export async function assertNotLastShareholder(input: {
  object: string;
  subject: string;
  relation: string;
}): Promise<void> {
  const { object, subject, relation } = input;
  if (relation !== 'owner' && relation !== 'manage_grants') return;

  const res = await readTuplesForObject(object);
  const holders = res.tuples
    .filter(
      (t) =>
        t.user !== subject &&
        (t.relation === 'owner' || t.relation === 'manage_grants') &&
        !t.user.includes('*')
    )
    .map((t) => t.user);

  if (holders.length === 0) {
    throw new AccessError(
      409,
      'This is the last person who can change access to this resource. ' +
        'Grant someone else owner access before removing your own.',
      'last_shareholder'
    );
  }
}
