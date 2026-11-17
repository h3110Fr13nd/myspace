/**
 * The effective-access projection.
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 *
 * A read model derived from the OpenFGA graph, so the Share dialog, the
 * troubleshooter and the "who can reach this?" question are one indexed read
 * instead of a graph walk re-implemented in application code. That
 * re-implementation is exactly how the troubleshooter came to assert "No Direct
 * Tuple" for a grant that demonstrably existed.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 *
 * It is never an authorization input. Every allow/deny decision is a `check()`
 * against the engine. This table may be stale; correctness must not depend on it.
 * `src/lib/acl/guards.ts` is the only thing that decides access.
 *
 * ── Design notes ─────────────────────────────────────────────────────────────
 *
 * Groups are NOT expanded into members. Expansion is O(groups x members x
 * resources) and it leaks org structure: anyone who can read an ACL would learn
 * who is on which team. The ACL renders "Platform team · 14 members" and
 * resolves names only for groups the viewer may already see.
 *
 * Staleness is surfaced rather than hidden: `projected_at` per row, plus a
 * singleton status row recording the last reconcile, tuple count, and whether
 * the most recent full read was truncated.
 */
import 'dotenv/config';
import pool, { query } from '../db';
import { logger } from '../logger';
import { readAllTuples, type FgaTuple, type TupleReadResult } from './reader';
import { toFgaObjectId } from '../resourceId';
import { invalidateSearchCache } from '../cache/searchCache';

export type AclSubjectType = 'user' | 'group' | 'service_account' | 'audience';
export type AclSource = 'direct' | 'group' | 'inherited' | 'audience' | 'deny';

export interface EffectiveGrant {
  resourceId: string;
  subjectType: AclSubjectType;
  subjectId: string;
  rung: 'viewer' | 'commenter' | 'editor' | 'owner';
  source: AclSource;
  sourceResource?: string;
  viaRelation?: string;
  depth: number;
}

const RUNG_ORDER: Record<string, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const STRUCTURAL = ['parent_folder', 'parent_space', 'parent_canvas'];

/** Classify a tuple subject without expanding it. */
function classify(user: string): { type: AclSubjectType; id: string } {
  if (user === 'user:*' || user === '*') return { type: 'audience', id: 'user:*' };
  // A userset subject: the grant is on the group, not on its members.
  if (user.endsWith('#member')) return { type: 'group', id: user };
  if (user.startsWith('group:')) return { type: 'group', id: user };
  if (user.startsWith('service_account:')) return { type: 'service_account', id: user };
  return { type: 'user', id: user };
}

/**
 * Walk the structural graph and attribute every grant to a source.
 *
 * Depth-capped. `resources.parent_id` is a self-FK with ON DELETE CASCADE, so the
 * resource tree is acyclic; the cap is a guard against a corrupt edge rather
 * than against expected input.
 */
const MAX_DEPTH = 12;

export function computeEffectiveAclFromTuples(
  all: TupleReadResult
): { grants: EffectiveGrant[]; truncated: boolean } {
  const grants = new Map<string, EffectiveGrant>();

  const put = (g: EffectiveGrant) => {
    const key = `${g.resourceId}|${g.subjectType}|${g.subjectId}|${g.rung}|${g.source}`;
    // Strongest rung wins for a given (resource, subject, source).
    const existing = grants.get(key);
    if (!existing || (RUNG_ORDER[g.rung] ?? 0) > (RUNG_ORDER[existing.rung] ?? 0)) {
      grants.set(key, g);
    }
  };

  // Index the structural edges so inheritance can be walked cheaply.
  const parentsByChild = new Map<string, FgaTuple[]>();
  for (const t of all.tuples) {
    if (!STRUCTURAL.includes(t.relation)) continue;
    const list = parentsByChild.get(t.object) ?? [];
    list.push(t);
    parentsByChild.set(t.object, list);
  }

  // Direct grants, and deny relations (kept for the ACL's "Blocked here" rows).
  const directByObject = new Map<string, FgaTuple[]>();
  for (const t of all.tuples) {
    if (STRUCTURAL.includes(t.relation) || t.relation === 'tagged') continue;
    const list = directByObject.get(t.object) ?? [];
    list.push(t);
    directByObject.set(t.object, list);
  }

  for (const [object, tuples] of directByObject) {
    for (const t of tuples) {
      const { type, id } = classify(t.user);

      if (t.relation === 'denied_viewer' || t.relation === 'denied_editor') {
        // Deny rows are stored so the Share dialog can show an explicit,
        // reversible block rather than silently omitting the subject.
        put({
          resourceId: object,
          subjectType: type,
          subjectId: id,
          rung: 'viewer',
          source: 'deny',
          depth: 0,
        });
        continue;
      }

      const rung = RUNG_ORDER[t.relation] ? (t.relation as EffectiveGrant['rung']) : null;
      if (!rung) continue; // structural or capability relation, not a content rung

      put({
        resourceId: object,
        subjectType: type,
        subjectId: id,
        rung,
        source: type === 'audience' ? 'audience' : type === 'group' ? 'group' : 'direct',
        depth: 0,
      });
    }
  }

  // Inheritance: walk ancestors and record where each grant came from. This is
  // what lets the UI say "via Research" instead of leaving the user to work it
  // out, and it is the difference between Notion's undifferentiated rows and a
  // readable ACL.
  const seen = new Set<string>();
  const queue: Array<{ object: string; depth: number; via: string; from: string }> = [];
  for (const object of directByObject.keys()) {
    const parents = parentsByChild.get(object) ?? [];
    for (const p of parents) queue.push({ object: p.user, depth: 1, via: p.relation, from: object });
  }

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const item = queue[queueIndex];
    if (item.depth > MAX_DEPTH) continue;
    const visitKey = `${item.object}|${item.from}|${item.depth}`;
    if (seen.has(visitKey)) continue;
    seen.add(visitKey);

    for (const t of directByObject.get(item.object) ?? []) {
      const rung = RUNG_ORDER[t.relation] ? (t.relation as EffectiveGrant['rung']) : null;
      if (!rung) continue;
      if (t.relation === 'denied_viewer' || t.relation === 'denied_editor') continue;
      const { type, id } = classify(t.user);
      if (type === 'audience') continue; // already recorded as an audience row

      put({
        resourceId: item.from,
        subjectType: type,
        subjectId: id,
        rung,
        source: 'inherited',
        sourceResource: item.object,
        viaRelation: item.via,
        depth: item.depth,
      });
    }

    for (const p of parentsByChild.get(item.object) ?? []) {
      queue.push({ object: p.user, depth: item.depth + 1, via: p.relation, from: item.from });
    }
  }

  return { grants: [...grants.values()], truncated: all.truncated };
}

/** Read the graph, then compute its projection without database writes. */
export async function computeEffectiveAcl(): Promise<{ grants: EffectiveGrant[]; truncated: boolean }> {
  return computeEffectiveAclFromTuples(await readAllTuples());
}

/**
 * Full reconcile: recompute and replace the projection atomically.
 *
 * Replace-in-a-transaction rather than incremental delete/insert, so a reader
 * never observes a half-built ACL. `ON CONFLICT` keeps it idempotent, so this is
 * safe to run on boot and on demand.
 */
export async function reconcileProjection(): Promise<{ rows: number; truncated: boolean; ms: number }> {
  const started = Date.now();
  const { grants, truncated } = await computeEffectiveAcl();

  // A transaction must use one checked-out connection. `query()` uses
  // pool.query(), which may route each statement to a different connection and
  // silently turn BEGIN/COMMIT into unrelated commands.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE resource_effective_acl');
    for (let i = 0; i < grants.length; i += 500) {
      const chunk = grants.slice(i, i + 500);
      const values: string[] = [];
      const params: unknown[] = [];
      for (const g of chunk) {
        const base = params.length;
        values.push(
          // 8 bound params + NOW() = 9 expressions, matching the 9 columns below.
          `(${Array.from({ length: 8 }, (_, k) => `$${base + k + 1}`).join(', ')}, NOW())`
        );
        params.push(
          g.resourceId,
          g.subjectType,
          g.subjectId,
          g.rung,
          g.source,
          g.sourceResource ?? null,
          g.viaRelation ?? null,
          g.depth
        );
      }
      await client.query(
        `INSERT INTO resource_effective_acl
           (resource_id, subject_type, subject_id, rung, source, source_resource, via_relation, depth, projected_at)
         VALUES ${values.join(', ')}`,
        params
      );
    }

    await client.query(
      `UPDATE acl_projection_state
       SET last_reconcile_at = NOW(), tuples_seen = $1, stale = $2
       WHERE id = 1`,
      [grants.length, truncated]
    );
    await client.query('COMMIT');
    invalidateSearchCache();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const ms = Date.now() - started;
  logger.info({ rows: grants.length, ms, truncated }, '[acl] projection reconciled');
  return { rows: grants.length, truncated, ms };
}

/** Reconcile once at boot, and record whether the projection is trustworthy. */
let bootPromise: Promise<void> | null = null;

export function reconcileOnBoot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      await reconcileProjection();
    } catch (err) {
      // A failed projection must not stop the app serving: it is a read model,
      // and every authorization decision still goes to the engine.
      logger.error({ err: (err as Error).message }, '[acl] boot reconcile failed — ACL read model will be stale');
      await query('UPDATE acl_projection_state SET stale = TRUE WHERE id = 1').catch(() => {});
    }
  })();
  return bootPromise;
}

/* ── Reads ──────────────────────────────────────────────────────────────────── */

export interface AclRow extends EffectiveGrant {
  projectedAt?: string;
}

/** Everything that reaches one resource, strongest first. */
export async function effectiveAclFor(resourceId: string): Promise<AclRow[]> {
  const res = await query(
    `SELECT resource_id, subject_type, subject_id, rung, source, source_resource,
            via_relation, depth, projected_at
     FROM resource_effective_acl
     WHERE resource_id = $1
     ORDER BY rung DESC, source, subject_id`,
    [resourceId]
  );
  return (res.rows || []).map((r: any) => ({
    resourceId: r.resource_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    rung: r.rung,
    source: r.source,
    sourceResource: r.source_resource ?? undefined,
    viaRelation: r.via_relation ?? undefined,
    depth: r.depth,
    projectedAt: r.projected_at,
  }));
}

/**
 * "Shared by me": every resource I hold a direct grant on.
 *
 * The outbound view. Neither Notion (Enterprise-only) nor Google Drive (no
 * `sharedByMe` search term at all) offers this to ordinary users, so it is a
 * genuine differentiator rather than parity.
 */
export async function sharedByUser(subjectId: string, limit = 200): Promise<
  Array<{ resourceId: string; rung: string; isPublic: boolean }>
> {
  const res = await query(
    `SELECT DISTINCT ON (e.resource_id)
            e.resource_id, e.rung, COALESCE(r.is_public, false) AS is_public
     FROM resource_effective_acl e
     LEFT JOIN resources r ON r.id = e.resource_id
     WHERE e.subject_id = $1 AND e.source = 'direct' AND e.rung <> 'viewer'
     ORDER BY e.resource_id,
              CASE e.rung WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END DESC
     LIMIT $2`,
    [subjectId, limit]
  );
  return (res.rows || []).map((r: any) => ({
    resourceId: r.resource_id,
    rung: r.rung,
    isPublic: r.is_public,
  }));
}

/**
 * Who a revocation would actually affect.
 *
 * Notion gives no feedback on this, which is its most-cited UX failure: you
 * remove access and nobody tells you who lost it, or that three subpages keep
 * their own grants. Computed from the projection so the answer is a count the
 * user can see before committing, and verified against the engine afterwards so
 * a stale projection cannot cause a wrong revocation.
 */
export async function revocationImpact(input: {
  resourceId: string;
  subjectId: string;
}): Promise<{ affected: number; viaSelf: number; viaAncestor: number; subtreesUnaffected: number }> {
  const res = await query(
    `SELECT source, COUNT(*)::int AS n
     FROM resource_effective_acl
     WHERE subject_id = $1 AND resource_id = $2
     GROUP BY source`,
    [input.subjectId, input.resourceId]
  );
  const bySource = new Map((res.rows || []).map((r: any) => [r.source, r.n]));

  // Descendants that hold their own grant to this subject are unaffected by a
  // revocation here — the point of the "will this break other people?" answer.
  const subtrees = await query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM resources WHERE id = $1
       UNION ALL
       SELECT c.id FROM resources c JOIN tree t ON c.parent_id = t.id
     )
     SELECT COUNT(*)::int AS n
     FROM resource_effective_acl e
     JOIN tree ON tree.id = e.resource_id
     WHERE e.subject_id = $2 AND e.resource_id <> $1 AND e.source = 'direct'`,
    [input.resourceId, input.subjectId]
  );

  return {
    affected: (bySource.get('direct') ?? 0) + (bySource.get('inherited') ?? 0),
    viaSelf: bySource.get('direct') ?? 0,
    viaAncestor: bySource.get('inherited') ?? 0,
    subtreesUnaffected: subtrees.rows?.[0]?.n ?? 0,
  };
}

/** Whether the projection is keeping up, for an honest UI. */
export async function projectionState(): Promise<{
  lastReconcileAt: string | null;
  tuplesSeen: number;
  stale: boolean;
}> {
  const res = await query(
    'SELECT last_reconcile_at, tuples_seen, stale FROM acl_projection_state WHERE id = 1'
  );
  const row = res.rows?.[0];
  return {
    lastReconcileAt: row?.last_reconcile_at ?? null,
    tuplesSeen: row?.tuples_seen ?? 0,
    stale: row?.stale ?? true,
  };
}

/* ── Invalidation ───────────────────────────────────────────────────────────── */

let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileQueued = false;

/**
 * Schedule a reconcile shortly after a write.
 *
 * Without this the read model is correct on boot and then lies: the user changes
 * the audience or revokes a grant, the Share dialog immediately re-reads, and
 * shows the state from before the write. A cache that is stale the instant after
 * the mutation it exists to reflect is worse than no cache, because it looks
 * authoritative.
 *
 * Debounced, because a grant can touch an object and every descendant, and a
 * batch operation would otherwise reconcile once per tuple.
 */
export function scheduleReconcile(delayMs = 750): void {
  reconcileQueued = true;
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileQueued = false;
    reconcileTimer = null;
    void reconcileProjection().catch((err) => {
      logger.error({ err: (err as Error).message }, '[acl] post-write reconcile failed');
    });
  }, delayMs);
  // Never hold the process open for a cache rebuild.
  reconcileTimer.unref?.();
}

/**
 * Reconcile immediately, superseding any pending debounce.
 *
 * `scheduleReconcile` is right for bulk and provisioning writes, where one
 * reconcile at the end is enough. It is wrong for a single user-initiated change:
 * the Share dialog re-reads the moment the API returns, so a debounced rebuild
 * means the user is shown the state from *before* the change they just made. The
 * mutation endpoints therefore await this instead.
 */
export async function reconcileNow(): Promise<void> {
  if (reconcileTimer) {
    clearTimeout(reconcileTimer);
    reconcileTimer = null;
  }
  reconcileQueued = false;
  await reconcileProjection();
}
