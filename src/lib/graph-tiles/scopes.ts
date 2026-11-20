/**
 * Tile scopes: which pyramid a resource lives in, and who may read it.
 *
 * A viewer's graph is composed client-side from independent layers, each its
 * own pyramid, so the shared layers are identical for everyone who may read
 * them and can be cached by HTTP caches:
 *
 *   - `public`         resources the engine grants to `user:*`, minus drafts
 *                      and unlisted. Readable by anyone.
 *   - `workspace`      resources the engine grants to `space:main#member` (the
 *                      "everyone in the workspace" audience) that are not
 *                      already public. Readable by verified workspace members.
 *   - `owner:<userId>` a user's own resources not in either shared layer,
 *                      drafts and unlisted included. Readable by that user only.
 *
 * Shared-layer membership is verified against OpenFGA when a pyramid is built
 * and re-verified on read for anything that changed since. Resources visible to
 * a user only through a direct or group grant are not in any pyramid yet (see
 * docs/perf/SCALING.md, "shared-with-me overlay").
 *
 * Layer access is deliberately trivial so it can be audited at a glance.
 */

export const PUBLIC_SCOPE = 'public';
export const WORKSPACE_SCOPE = 'workspace';
export const OWNER_SCOPE_PREFIX = 'owner:';

/** The userset whose `viewer` grant puts a resource in the workspace layer. */
export const WORKSPACE_SUBJECT = 'space:main#member';

export function ownerScope(userId: string): string {
  return `${OWNER_SCOPE_PREFIX}${userId}`;
}

const isAuthenticated = (user: string) => Boolean(user) && user !== 'user:anonymous';

/**
 * URL segment -> stored scope, for the requesting user. Clients never put a
 * user id in a tile URL: they ask for `me`, which resolves to their own owner
 * scope. `workspace` additionally requires verified membership, which the
 * caller checks (it needs the engine). Returns null for anything else (callers
 * answer 404, not 403, so a probe cannot learn which scopes exist).
 */
export function resolveScopeParam(param: string | undefined, currentUser: string): string | null {
  if (param === PUBLIC_SCOPE) return PUBLIC_SCOPE;
  if (!isAuthenticated(currentUser)) return null;
  if (param === WORKSPACE_SCOPE) return WORKSPACE_SCOPE;
  if (param === 'me') return ownerScope(currentUser);
  return null;
}

/**
 * Scopes the user's graph may be composed from, in draw order (bottom first).
 * `workspace` is a candidate: callers drop it unless membership is verified.
 */
export function scopesForUser(currentUser: string): string[] {
  if (!isAuthenticated(currentUser)) return [PUBLIC_SCOPE];
  return [PUBLIC_SCOPE, WORKSPACE_SCOPE, ownerScope(currentUser)];
}

/** Public URL segment for a stored scope, from the perspective of its reader. */
export function scopeParam(scope: string): string {
  if (scope === PUBLIC_SCOPE || scope === WORKSPACE_SCOPE) return scope;
  return 'me';
}

export interface ScopeMembershipInput {
  ownerId: string;
  hidden: boolean; // draft or unlisted
  publicVerified: boolean; // engine says user:* may view
  workspaceVerified?: boolean; // engine says space:main#member may view
}

/**
 * Which pyramid a resource belongs to, or null for "none". A resource is in
 * exactly one scope — the widest audience that may see it — so layers never
 * double-draw it.
 */
export function scopeOf(input: ScopeMembershipInput): string | null {
  if (!input.hidden && input.publicVerified) return PUBLIC_SCOPE;
  if (!input.hidden && input.workspaceVerified) return WORKSPACE_SCOPE;
  if (input.ownerId) return ownerScope(input.ownerId);
  return null;
}

/** Narrowness rank: an edge is stored in its narrower end's layer. */
function rank(scope: string): number {
  if (scope === PUBLIC_SCOPE) return 0;
  if (scope === WORKSPACE_SCOPE) return 1;
  return 2;
}

/**
 * Which pyramid stores an edge between resources in scopes `a` and `b`, or
 * null when no single reader could see both ends. The narrower layer stores
 * it, drawing the wider end as a ghost endpoint (a position, never a title):
 *
 *   public    + public    -> public
 *   public    + workspace -> workspace
 *   owner:X   + public    -> owner:X
 *   owner:X   + workspace -> owner:X
 *   owner:X   + owner:X   -> owner:X
 *   owner:X   + owner:Y   -> null  (nobody's layer may reveal the other's node)
 */
export function edgeScope(a: string, b: string): string | null {
  if (a === b) return a;
  const ra = rank(a);
  const rb = rank(b);
  if (ra === 2 && rb === 2) return null;
  return ra >= rb ? a : b;
}

/** Integer code of the shared scopes; owner scopes are OWNER_CODE_BASE + index. */
export const PUBLIC_CODE = 0;
export const WORKSPACE_CODE = 1;
export const OWNER_CODE_BASE = 2;

/**
 * {@link edgeScope} on integer scope codes, for the builder's hot loop:
 * 0 = public, 1 = workspace, >= 2 = an owner scope, -1 = none. Same rules.
 */
export function edgeScopeCode(a: number, b: number): number {
  if (a < 0 || b < 0) return -1;
  if (a === b) return a;
  if (a >= OWNER_CODE_BASE && b >= OWNER_CODE_BASE) return -1;
  return a > b ? a : b;
}
