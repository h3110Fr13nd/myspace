/**
 * The single writer of OpenFGA relationship tuples.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * Tuple writes were scattered across eight modules — resource provisioning,
 * vault sync, the Google Drive bridge, and the permission endpoints. That is
 * how a second write path appears which skips authorization, skips the
 * pre-flight that prevents contradictory deny/grant state, and leaves the
 * effective-access read model stale with no way to notice.
 *
 * Every application-level tuple write goes through here. `src/lib/openfga.ts`
 * remains the low-level primitive and is the only module that touches the SDK's
 * write API; nothing else imports `writeTuple` / `deleteTuple` directly.
 *
 * `tests/unit/acl-source-guards.spec.ts` fails the build if that regresses.
 */
import { writeTuple, writeTuples, deleteTuple } from '../openfga';
import { logger } from '../logger';
import { toFgaObjectId } from '../resourceId';
import { scheduleReconcile } from './projection';

export interface TupleInput {
  object: string;
  subject: string;
  relation: string;
}

/**
 * Grant one relation.
 *
 * @returns true when the tuple exists afterwards. OpenFGA treats a duplicate
 *          write as an error, which `writeTuple` normalises to success so
 *          callers can be idempotent.
 */
export async function applyGrant({ object, subject, relation }: TupleInput): Promise<boolean> {
  const ok = await writeTuple(subject, relation, object);
  if (ok) scheduleReconcile();
  return ok;
}

/** Revoke one relation. */
export async function applyRevoke({ object, subject, relation }: TupleInput): Promise<boolean> {
  const ok = await deleteTuple(subject, relation, object);
  // Revoking is not a write to the graph, but it is a change to effective
  // access, so the read model has to hear about it too.
  if (ok) scheduleReconcile();
  return ok;
}

/**
 * Write or remove a membership edge without rebuilding the effective ACL.
 * Membership is resolved by OpenFGA at check time; the ACL read model keeps
 * group principals compact and does not expand membership. The low-level
 * writer still invalidates authorization caches for immediate correctness.
 */
export async function applyMembership({ object, subject, relation }: TupleInput): Promise<boolean> {
  if (relation !== 'member') throw new Error('applyMembership only accepts the member relation');
  return writeTuple(subject, relation, object);
}

export async function removeMembership({ object, subject, relation }: TupleInput): Promise<boolean> {
  if (relation !== 'member') throw new Error('removeMembership only accepts the member relation');
  return deleteTuple(subject, relation, object);
}

/**
 * Make a subject the owner of an object, if not already.
 *
 * Used by every provisioning path (resource creation, user registration,
 * vault sync). `resources.owner_id` is the root of trust for ACL
 * recoverability, so this must run whenever an owner is established.
 */
export async function ensureOwner(object: string, subject: string): Promise<boolean> {
  return writeTuple(subject, 'owner', object);
}

/**
 * Record the structural edge a child hangs from.
 *
 * `via` must name a real tupleset on the child's type (`parent_folder`,
 * `parent_space`, `parent_canvas`); inheritance resolution reads these tuples
 * directly rather than trusting `resources.parent_id`, so a missing or wrong
 * edge here changes who can see the child.
 */
export async function linkParent(
  childObject: string,
  parentType: string,
  parentId: string,
  via: 'parent_folder' | 'parent_space' | 'parent_canvas'
): Promise<boolean> {
  return writeTuple(toFgaObjectId(parentType, parentId), via, childObject);
}

/**
 * Make a resource publicly readable.
 *
 * The model admits `user:*` on `viewer` and `editor` only, so this is the only
 * way to express "anyone with the link". Note it does NOT grant `read_acl`: the
 * ACL of a public resource stays private.
 */
export async function grantPublicRead(object: string, relation: 'viewer' | 'editor' = 'viewer'): Promise<boolean> {
  return writeTuple('user:*', relation, object);
}

/** Withdraw public access. */
export async function revokePublicRead(object: string, relation: 'viewer' | 'editor' = 'viewer'): Promise<boolean> {
  return deleteTuple('user:*', relation, object);
}

/**
 * Seed the full role set for a newly created resource.
 *
 * The creator gets `owner` only — `owner` already implies `editor` and
 * `viewer` through the model, so writing all three is redundant and makes
 * "who changed this role" ambiguous in the audit log.
 */
export async function seedCreatorGrants(object: string, subject: string): Promise<boolean> {
  return ensureOwner(object, subject);
}

/**
 * Bulk import, for vault sync and migration scripts.
 *
 * These paths are trusted and pre-validated; they still route through the acl
 * layer so there is exactly one place that knows how tuples are written.
 */
export async function importTuples(tuples: TupleInput[]): Promise<boolean> {
  const ok = await writeTuples(
    tuples.map((t) => ({ user: t.subject, relation: t.relation, object: t.object }))
  );
  if (!ok) {
    logger.warn({ count: tuples.length }, '[acl] bulk tuple import reported failures');
  }
  return ok;
}
