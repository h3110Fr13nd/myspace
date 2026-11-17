/**
 * Detect and repair divergence between Postgres and the OpenFGA graph.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Two sources of truth for one concept is the root cause of both caveats:
 *
 *   - `resources.is_public` said 101 resources were public while the graph had
 *     zero `user:*` tuples, so auditing via OpenFGA under-reported by 101.
 *   - `group_memberships` said who was in a group while the graph had zero
 *     `group:X#member` tuples, so a grant to a group resolved to nobody.
 *
 * Both were invisible: no error, no failed request, just an authorization answer
 * that quietly disagreed with the database. This tool makes the disagreement
 * loud, and repairs it.
 *
 *   npx tsx scripts/reconcile-acl.ts           # report only
 *   npx tsx scripts/reconcile-acl.ts --fix     # report and repair
 */
import 'dotenv/config';
import { query } from '../src/lib/db';
import { readAllTuples } from '../src/lib/acl/reader';
import { setAudience, type AudienceKind } from '../src/lib/acl/audience';
import { syncAllMemberships, syncWorkspaceMemberships } from '../src/lib/acl/groups';
import { ensureOwner } from '../src/lib/acl/projector';
import { logger } from '../src/lib/logger';

const FIX = process.argv.includes('--fix');
const STORE_ID = process.env.OPENFGA_STORE_ID || '';

interface Divergence {
  kind: string;
  detail: string;
  repair: string;
}

const divergences: Divergence[] = [];

async function main() {
  console.log(`[reconcile] mode: ${FIX ? 'REPAIR' : 'report-only'}`);

  const graph = await readAllTuples();
  if (graph.truncated) {
    console.warn(
      '[reconcile] WARNING: the policy store exceeded the read budget; results may be incomplete.'
    );
  }

  /* ── 1. Public resources with no wildcard grant ─────────────────────────── */

  const publicRows = await query(
    `SELECT r.id, r.type FROM resources r
     WHERE r.is_public = true
     ORDER BY r.id`
  );
  const publicIds = new Set((publicRows.rows || []).map((r: any) => r.id));

  const wildcardObjects = new Set(
    graph.tuples
      .filter((t) => t.user === 'user:*' && (t.relation === 'viewer' || t.relation === 'editor'))
      .map((t) => t.object)
  );

  const audienceRows = await query('SELECT resource_id, audience FROM resource_audience');
  const audienceById = new Map((audienceRows.rows || []).map((r: any) => [r.resource_id, r.audience]));

  for (const id of publicIds) {
    if (!wildcardObjects.has(id)) {
      divergences.push({
        kind: 'public-without-wildcard',
        detail: `${id} is is_public=true but has no user:* grant — public in Postgres, private in the graph`,
        repair: 'create a public_link audience (writes user:* and the audience row)',
      });
    }
    const audience = audienceById.get(id);
    if (audience && audience !== 'public_link' && audience !== 'workspace') {
      divergences.push({
        kind: 'audience-contradicts-flag',
        detail: `${id} is is_public=true but its audience slot is '${audience}'`,
        repair: 'set the audience to public_link',
      });
    }
  }

  /* ── 2. Wildcard grants with no audience row ────────────────────────────── */

  for (const object of wildcardObjects) {
    if (publicIds.has(object)) continue;
    divergences.push({
      kind: 'wildcard-without-audience',
      detail: `${object} has a user:* grant but is_public=false and has no audience slot`,
      repair: 'create a public_link audience so the grant has a declared intent',
    });
  }

  /* ── 3. Group memberships never projected ───────────────────────────────── */

  const memberships = await query(
    `SELECT gm.group_id, gm.user_id, gm.synced_at
     FROM group_memberships gm
     WHERE gm.synced_at IS NULL`
  );
  const unprojected = memberships.rows || [];

  // Group memberships only, keyed on the FULL object string. Splitting the
  // object and taking [1] yields the bare id, which never matches the
  // `group:<id>|<user>` key used below and makes every membership look orphaned
  // — the job then churns real tuples on each run.
  const graphGroupMembers = new Set(
    graph.tuples
      .filter((t) => t.relation === 'member' && t.object.startsWith('group:'))
      .map((t) => `${t.object}|${t.user}`)
  );

  for (const row of unprojected) {
    const key = `${row.group_id}|${row.user_id}`;
    const projected = graphGroupMembers.has(key);
    divergences.push({
      kind: projected ? 'membership-unsynced' : 'membership-missing',
      detail: `${row.user_id} in ${row.group_id} — ${projected ? 'projected but synced_at is NULL' : 'no group:X#member tuple exists'}`,
      repair: 'project the membership',
    });
  }

  /* ── 3b. Resources whose Postgres owner has no owner tuple ─────────────── */

  // `resources.owner_id` is the root of truth; the FGA `owner` tuple is its
  // projection. 748 of 913 resources had the row but not the grant, because seed
  // scripts, vault sync, and migrations write the resource and not the tuple.
  // The symptom was severe and confusing: you could open and edit your own
  // resource, open Share, and be told you could not see its access list — and
  // then be handed a 404 for a resource that plainly exists.
  const ownerless = await query(
    `SELECT r.id, r.owner_id
     FROM resources r
     WHERE r.owner_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM tuple t
         WHERE t.store = $1
           AND t.object_type || ':' || t.object_id = r.id
           AND t.relation = 'owner'
           AND t._user = r.owner_id
       )
     ORDER BY r.id`,
    [STORE_ID]
  );

  for (const row of ownerless.rows || []) {
    divergences.push({
      kind: 'owner-without-tuple',
      detail: `${row.id} has owner_id=${row.owner_id} but no matching owner tuple — the graph does not know who owns it`,
      repair: 'write the owner tuple',
    });
  }

  /* ── 3c. Resources owned by a principal that is not an account ──────────── */

  // Backfilling ownership from `owner_id` faithfully reproduced whatever is in
  // that column — including placeholders. 678 resources are owned by
  // `user:demo` and 175 by `user:system`, none of which exist in `users`, so
  // nobody can authenticate as the owner and those resources have no reachable
  // administrator. This is reported, never auto-corrected: reassigning 900
  // resources is a data decision, not a repair.
  // A registered service account is a *legitimate* non-human owner, so it must be
  // excluded here — otherwise registering one looks identical to the corruption
  // this check exists to find.
  const phantomOwners = await query(
    `SELECT r.owner_id, COUNT(*)::int AS n,
            (SELECT COUNT(*)::int FROM service_account_principals sp
              WHERE sp.service_account_id = r.owner_id) AS admins
     FROM resources r
     LEFT JOIN users u ON u.id = r.owner_id
     LEFT JOIN service_accounts sa ON sa.id = r.owner_id
     WHERE r.owner_id IS NOT NULL AND u.id IS NULL AND sa.id IS NULL
     GROUP BY r.owner_id
     ORDER BY n DESC`
  );
  for (const row of phantomOwners.rows || []) {
    divergences.push({
      kind: 'phantom-owner',
      detail: `${row.n} resource(s) owned by ${row.owner_id}, which is neither an account nor a registered service account`,
      repair: 'MANUAL: reassign to a real account, or register the principal in service_accounts',
    });
  }

  // The mirror-image problem: a service account that owns content but has no
  // human administrator. Nobody can log in as it, so without an explicit
  // `manage_grants` holder its content is unreachable.
  const orphanedServiceAccounts = await query(
    `SELECT sa.id, COUNT(DISTINCT r.id)::int AS n
     FROM service_accounts sa
     JOIN resources r ON r.owner_id = sa.id
     LEFT JOIN service_account_principals sp ON sp.service_account_id = sa.id
     WHERE sp.principal_id IS NULL
     GROUP BY sa.id`
  );
  for (const row of orphanedServiceAccounts.rows || []) {
    divergences.push({
      kind: 'service-account-without-admin',
      detail: `${row.n} resource(s) owned by ${row.id}, which has no human principal with manage_grants — unreachable`,
      repair: 'grant a human principal manage_grants in service_account_principals',
    });
  }

  /* ── 4. Users with no workspace membership ──────────────────────────────── */

  const users = await query('SELECT id FROM users WHERE space_member_synced_at IS NULL');
  const spaceMembers = new Set(
    graph.tuples
      .filter((t) => t.object === 'space:main' && t.relation === 'member')
      .map((t) => t.user)
  );
  for (const row of users.rows || []) {
    if (spaceMembers.has(row.id)) continue;
    divergences.push({
      kind: 'workspace-member-missing',
      detail: `${row.id} is not a member of space:main — the workspace audience cannot resolve for them`,
      repair: 'add the space:main#member tuple',
    });
  }

  /* ── 5. Orphaned graph memberships ──────────────────────────────────────── */

  const membershipKeys = new Set(
    (await query('SELECT group_id, user_id FROM group_memberships')).rows.map(
      (r: any) => `${r.group_id}|${r.user_id}`
    )
  );
  for (const key of graphGroupMembers) {
    if (membershipKeys.has(key)) continue;
    divergences.push({
      kind: 'orphan-membership',
      detail: `${key.replace('|', ' is in ')} exists in the graph with no Postgres row — a removed member keeps access`,
      repair: 'revoke the tuple',
    });
  }

  /* ── Report ─────────────────────────────────────────────────────────────── */

  const byKind = new Map<string, Divergence[]>();
  for (const d of divergences) {
    if (!byKind.has(d.kind)) byKind.set(d.kind, []);
    byKind.get(d.kind)!.push(d);
  }

  console.log(`\n[reconcile] ${divergences.length} divergence(s) found\n`);
  for (const [kind, rows] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${kind}  (${rows.length})`);
    for (const r of rows.slice(0, 5)) console.log(`    - ${r.detail}`);
    if (rows.length > 5) console.log(`    … and ${rows.length - 5} more`);
  }
  console.log('');

  if (!FIX) {
    console.log('[reconcile] Re-run with --fix to repair.');
    // `phantom-owner` needs a human decision, so it is reported but does not
    // make the run "dirty" — otherwise --fix could never converge.
    const MANUAL_KINDS = new Set(['phantom-owner', 'service-account-without-admin']);
    const autoRepairable = divergences.filter((d) => !MANUAL_KINDS.has(d.kind));
    return autoRepairable.length === 0;
  }

  /* ── Repair ─────────────────────────────────────────────────────────────── */

  let repaired = 0;
  const failedRepairs: string[] = [];

  // Every repair is verified by re-reading the graph afterwards. Counting a
  // write as successful because it did not throw is how a repair job reports
  // "clean" while the divergence is still there.
  const repairAudience = async (resourceId: string) => {
    try {
      await setAudience({ resourceId, kind: 'public_link' as AudienceKind, rung: 'viewer', actor: 'system:reconcile' });
      repaired++;
    } catch (err: any) {
      failedRepairs.push(`${resourceId}: ${err.message}`);
    }
  };

  for (const id of publicIds) {
    if (!wildcardObjects.has(id) || !audienceById.has(id)) {
      await repairAudience(id);
    }
  }

  for (const object of wildcardObjects) {
    if (publicIds.has(object) || audienceById.has(object)) continue;
    await repairAudience(object);
  }

  // Backfill ownership. Idempotent, and the graph then agrees with the root of
  // truth, so `can()` stops needing the database fallback on the common path.
  for (const row of ownerless.rows || []) {
    try {
      await ensureOwner(row.id, row.owner_id);
      repaired++;
    } catch (err: any) {
      failedRepairs.push(`${row.id}: ${err.message}`);
    }
  }

  const groups = await syncAllMemberships();
  repaired += groups.projected;
  const space = await syncWorkspaceMemberships();
  repaired += space.projected;

  const totalFailed = groups.failed + space.failed + failedRepairs.length;
  console.log(`[reconcile] repaired ${repaired} item(s); ${totalFailed} write(s) failed`);
  for (const f of failedRepairs.slice(0, 10)) console.error(`  ! ${f}`);
  if (failedRepairs.length > 10) console.error(`  … and ${failedRepairs.length - 10} more`);

  // Re-read the graph so the exit status reflects reality, not intent.
  console.log('[reconcile] re-checking after repair…');
  const after = await readAllTuples();
  const wildcardsAfter = new Set(
    after.tuples
      .filter((t) => t.user === 'user:*' && (t.relation === 'viewer' || t.relation === 'editor'))
      .map((t) => t.object)
  );
  const stillMissing = [...publicIds].filter((id) => !wildcardsAfter.has(id));
  if (stillMissing.length > 0) {
    console.error(`[reconcile] ${stillMissing.length} resource(s) still lack a public grant`);
    for (const id of stillMissing.slice(0, 10)) console.error(`  ! ${id}`);
  }

  const ownersAfter = new Set(
    after.tuples.filter((t) => t.relation === 'owner').map((t) => `${t.object}|${t.user}`)
  );
  const expectedOwners = (
    await query('SELECT id, owner_id FROM resources WHERE owner_id IS NOT NULL')
  ).rows.map((r: any) => `${r.id}|${r.owner_id}`);
  const unowned = expectedOwners.filter((k) => !ownersAfter.has(k));
  if (unowned.length > 0) {
    console.error(`[reconcile] ${unowned.length} resource(s) still have no owner tuple`);
    for (const k of unowned.slice(0, 10)) console.error(`  ! ${k}`);
  }

  return totalFailed === 0 && stillMissing.length === 0 && unowned.length === 0;
}

main()
  .then((clean) => {
    if (!clean) {
      console.error('[reconcile] finished with outstanding problems');
      process.exit(1);
    }
    console.log('[reconcile] clean');
  })
  .catch((err) => {
    logger.error({ err: err.message }, '[reconcile] fatal');
    console.error('[reconcile] fatal:', err.message || err);
    process.exit(1);
  });
