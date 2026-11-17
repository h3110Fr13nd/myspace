/**
 * Group membership: the Postgres rows → OpenFGA projection.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * `groups` and `group_memberships` have always existed, but nothing ever wrote
 * the `group:X#member` tuples the model needs. So a grant to a group **succeeded
 * and resolved to nobody**:
 *
 *   POST grant { principal: "group:engineers", role: "viewer" }  → 200 "success"
 *   check(user:alice, viewer, …)                                 → false
 *
 * The write looked like it worked, which is the worst failure mode available.
 * Production store: 0 member tuples, 0 group grants.
 *
 * `group_memberships` stays authoritative; the tuples are a projection of it.
 * `synced_at` makes an unprojected row *visible* to reconciliation instead of
 * silently granting nothing.
 */
import { query } from '../db';
import { checkPermission } from '../openfga';
import { applyMembership, removeMembership } from './projector';
import { toFgaObjectId } from '../resourceId';

/** `group:engineers` → `group:engineers#member`, the userset the model admits. */
export function toMemberUserset(groupId: string): string {
  return groupId.includes('#') ? groupId : `${groupId}#member`;
}

export interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
}

/** Every group with its member count. Does not enumerate who the members are. */
export async function listGroups(): Promise<GroupRow[]> {
  const res = await query(
    `SELECT g.id, g.name, COUNT(m.user_id)::int AS member_count
     FROM groups g
     LEFT JOIN group_memberships m ON m.group_id = g.id
     GROUP BY g.id, g.name
     ORDER BY g.name ASC`
  );
  return (res.rows || []).map((r: any) => ({ id: r.id, name: r.name, memberCount: r.member_count }));
}

/**
 * Display metadata for a group principal, for the ACL list.
 *
 * Deliberately returns a COUNT and not the member list. Fully expanding group
 * membership into an ACL view leaks org structure — Confluence's "People who can
 * view" lists every member of every group, which tells an insider who reports to
 * whom. The Share dialog shows "Platform team · 14 members"; names are available
 * only to someone who can already read that group's roster.
 */
export async function describeGroups(groupIds: string[]): Promise<Map<string, GroupRow>> {
  const out = new Map<string, GroupRow>();
  if (groupIds.length === 0) return out;

  const res = await query(
    `SELECT g.id, g.name, COUNT(m.user_id)::int AS member_count
     FROM groups g
     LEFT JOIN group_memberships m ON m.group_id = g.id
     WHERE g.id = ANY($1)
     GROUP BY g.id, g.name`,
    [groupIds]
  );
  for (const r of res.rows || []) out.set(r.id, { id: r.id, name: r.name, memberCount: r.member_count });
  return out;
}

/** Group ids that appear as subjects in the given tuples. */
export function groupIdsIn(tuples: Array<{ user: string }>): string[] {
  const ids = new Set<string>();
  for (const t of tuples) {
    if (!t.user.startsWith('group:')) continue;
    ids.add(t.user.split('#')[0]);
  }
  return [...ids];
}

/* ── Projection ────────────────────────────────────────────────────────────── */

/**
 * Project one membership row into the graph.
 *
 * Idempotent, and records `synced_at` so reconciliation can tell "projected" from
 * "written but the write silently did nothing".
 */
export async function projectMembership(groupId: string, userId: string): Promise<boolean> {
  const object = toFgaObjectId('group', groupId);
  const ok = await applyMembership({ object, subject: userId, relation: 'member' });
  if (ok) {
    await query('UPDATE group_memberships SET synced_at = NOW() WHERE group_id = $1 AND user_id = $2', [
      groupId,
      userId,
    ]).catch(() => {});
  }
  return ok;
}

/** Remove one membership from the graph. */
export async function unprojectMembership(groupId: string, userId: string): Promise<boolean> {
  const object = toFgaObjectId('group', groupId);
  const ok = await removeMembership({ object, subject: userId, relation: 'member' });
  await query('UPDATE group_memberships SET synced_at = NOW() WHERE group_id = $1 AND user_id = $2', [
    groupId,
    userId,
  ]).catch(() => {});
  return ok;
}

/**
 * Reconcile every membership row into the graph.
 *
 * Idempotent and safe to run repeatedly — this is the backfill, the repair path,
 * and the periodic consistency check in one function.
 */
export async function syncAllMemberships(): Promise<{ projected: number; failed: number }> {
  const res = await query('SELECT group_id, user_id FROM group_memberships');
  const rows = res.rows || [];

  let projected = 0;
  let failed = 0;

  for (const row of rows) {
    const ok = await projectMembership(row.group_id, row.user_id);
    if (ok) projected++;
    else failed++;
  }

  // Drop graph memberships whose Postgres row is gone, so a deleted member does
  // not keep access through a tuple nobody remembers writing.
  //
  // The object is the fully-qualified `group:<id>`; splitting it and taking [1]
  // yields `<id>` without the prefix, which never matches an expected key and
  // makes this loop delete the very tuples it just projected. Compare the whole
  // object string instead.
  const expected = new Set(rows.map((r: any) => `${r.group_id}|${r.user_id}`));
  const { readAllTuplesForRelation } = await import('./reader');
  const graphMembers = await readAllTuplesForRelation('member');
  for (const t of graphMembers) {
    if (!t.object.startsWith('group:')) continue;
    if (expected.has(`${t.object}|${t.user}`)) continue;
    await unprojectMembership(t.object, t.user);
  }

  return { projected, failed };
}

/** Whether a subject is a member of a group, per the graph. */
export function isGroupMember(userId: string, groupId: string): Promise<boolean> {
  return checkPermission({ user: userId, relation: 'member', object: toFgaObjectId('group', groupId) });
}

/** Add a member to a group (Postgres + graph). */
export async function addMember(groupId: string, userId: string): Promise<boolean> {
  await query(
    `INSERT INTO group_memberships (group_id, user_id) VALUES ($1, $2)
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [groupId, userId]
  );
  return projectMembership(groupId, userId);
}

/** Remove a member from a group (Postgres + graph). */
export async function removeMember(groupId: string, userId: string): Promise<boolean> {
  await query('DELETE FROM group_memberships WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return unprojectMembership(groupId, userId);
}

/* ── Workspace membership ──────────────────────────────────────────────────── */

/**
 * Ensure every user is a member of the workspace space.
 *
 * "Everyone in the workspace" is expressed as `space:main#member` in the graph,
 * so this membership is what makes the workspace audience resolvable at all.
 */
export async function syncWorkspaceMemberships(): Promise<{ projected: number; failed: number }> {
  const res = await query('SELECT id FROM users');
  const rows = res.rows || [];

  let projected = 0;
  let failed = 0;

  for (const row of rows) {
    const ok = await applyMembership({ object: 'space:main', subject: row.id, relation: 'member' });
    if (ok) {
      projected++;
      await query('UPDATE users SET space_member_synced_at = NOW() WHERE id = $1', [row.id]).catch(() => {});
    } else {
      failed++;
    }
  }

  return { projected, failed };
}

/** Ensure one user is a workspace member. Called on registration and login. */
export async function ensureWorkspaceMember(userId: string): Promise<boolean> {
  const ok = await applyMembership({ object: 'space:main', subject: userId, relation: 'member' });
  if (ok) {
    await query('UPDATE users SET space_member_synced_at = NOW() WHERE id = $1', [userId]).catch(() => {});
  }
  return ok;
}
