/**
 * Normalise resource ownership.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * 896 of 913 resources were owned by ids that do not exist in `users`:
 *
 *   user:demo          678   a truncated form of a real account
 *   user:system         175   the public vault — reference content, not a person
 *   user:researcher      42   a placeholder from a seed script
 *   user:testpassword     1   junk
 *   user:tex              1   junk
 *
 * Because they were typed `user:*`, they were indistinguishable from a person
 * whose account had gone missing, and `scripts/reconcile-acl.ts` correctly
 * reported them as phantom owners. It also explains why 748 resources had no
 * `owner` tuple: the seeding scripts wrote the row and not the grant.
 *
 * ── The resolution ──────────────────────────────────────────────────────────
 *
 * 1. The truncated and placeholder ids are folded into one real account.
 * 2. `user:system` becomes `service_account:system` — a first-class,
 *    non-authenticating principal that owns the platform's own reference
 *    content. It belongs to no user, team, or group and holds no workspace
 *    membership, which is exactly what it was always meant to be.
 * 3. The human administrator gets an explicit `manage_grants` on the
 *    service-account-owned resources, so that content is reachable and
 *    shareable by a person.
 *
 *   npx tsx scripts/normalize-owners.ts           # report only
 *   npx tsx scripts/normalize-owners.ts --fix     # apply
 */
import 'dotenv/config';
import { query } from '../src/lib/db';
import { readAllTuples } from '../src/lib/acl/reader';
import { applyGrant, applyRevoke } from '../src/lib/acl/projector';
import { invalidateOwnerCache } from '../src/lib/acl/guards';
import { writeAudit } from '../src/lib/audit';
import { userIdForEmail } from '../src/lib/userIds';

const FIX = process.argv.includes('--fix');

/**
 * The account that stands in for the truncated/placeholder ids.
 *
 * Resolved from an EMAIL, never a literal id: ids became opaque uuids in
 * migration 0009, and a hardcoded id here would silently target nobody.
 */
const CANONICAL_EMAIL = 'dummy_mail';

/** The platform's own reference content, and its real principal id. */
const LEGACY_SYSTEM = 'user:system';
const SERVICE_PRINCIPAL = 'service_account:system';

/** Placeholder owners that were really the canonical user. */
const FOLD_INTO_CANONICAL = ['user:demo', 'user:researcher', 'user:testpassword', 'user:tex'];

interface Plan {
  resourceId: string;
  from: string;
  to: string;
}

async function main() {
  console.log(`[normalize-owners] mode: ${FIX ? 'APPLY' : 'report-only'}`);

  const CANONICAL_USER = await userIdForEmail(CANONICAL_EMAIL);
  if (!CANONICAL_USER) {
    throw new Error(
      `No account for ${CANONICAL_EMAIL}. Create it first — refusing to reassign ownership to a non-account.`
    );
  }
  console.log(`[normalize-owners] canonical account verified: ${CANONICAL_USER}`);

  const plans: Plan[] = [];

  // 1. Fold the truncated / placeholder owners into the real account.
  const foldable = await query(
    `SELECT id, owner_id FROM resources WHERE owner_id = ANY($1) ORDER BY id`,
    [FOLD_INTO_CANONICAL]
  );
  for (const row of foldable.rows || []) {
    plans.push({ resourceId: row.id, from: row.owner_id, to: CANONICAL_USER });
  }
  console.log(`[normalize-owners] ${plans.length} resource(s) to fold into ${CANONICAL_USER}`);

  // 2. Convert the platform's own content to a real service principal.
  const systemOwned = await query(
    `SELECT id, owner_id FROM resources WHERE owner_id = $1 ORDER BY id`,
    [LEGACY_SYSTEM]
  );
  for (const row of systemOwned.rows || []) {
    plans.push({ resourceId: row.id, from: row.owner_id, to: SERVICE_PRINCIPAL });
  }
  console.log(`[normalize-owners] ${(systemOwned.rows || []).length} resource(s) to move to ${SERVICE_PRINCIPAL}`);

  const byTarget = plans.reduce<Record<string, number>>((acc, p) => {
    acc[p.to] = (acc[p.to] || 0) + 1;
    return acc;
  }, {});
  for (const [to, n] of Object.entries(byTarget)) console.log(`    → ${to}: ${n}`);

  if (!FIX) {
    console.log('\n[normalize-owners] Re-run with --fix to apply.');
    return true;
  }

  // ── Apply: database first, then the graph ────────────────────────────────
  // The graph is written after the row so a crash mid-run leaves the database
  // authoritative, which is what `isDatabaseOwner` falls back to.
  for (const p of plans) {
    await query('UPDATE resources SET owner_id = $2 WHERE id = $1', [p.resourceId, p.to]);
  }
  console.log(`[normalize-owners] updated ${plans.length} resource row(s)`);

  // Rewrite the graph: drop the placeholder owner edge, add the real one.
  let rewritten = 0;
  for (const p of plans) {
    await applyRevoke({ object: p.resourceId, subject: p.from, relation: 'owner' }).catch(() => {});
    if (await applyGrant({ object: p.resourceId, subject: p.to, relation: 'owner' })) rewritten++;
  }
  console.log(`[normalize-owners] rewrote ${rewritten} owner tuple(s)`);

  // ── Make the service account's content administrable ─────────────────────
  // `manage_grants` deliberately does not inherit, and a service account cannot
  // be logged into, so without this its content would have no reachable
  // administrator — the same dead end the phantom-owner audit found.
  const serviceResources = (systemOwned.rows || []).map((r: any) => r.id);
  let administered = 0;
  for (const id of serviceResources) {
    const ok =
      (await applyGrant({ object: id, subject: CANONICAL_USER, relation: 'manage_grants' })) &&
      (await applyGrant({ object: id, subject: CANONICAL_USER, relation: 'editor' }));
    if (ok) administered++;
  }
  console.log(
    `[normalize-owners] granted ${CANONICAL_USER} manage_grants+editor on ${administered}/${serviceResources.length} service-owned resource(s)`
  );

  await query(
    `INSERT INTO service_account_principals (service_account_id, principal_id, role)
     SELECT $1, $2, role
     FROM (VALUES ('manage_grants'::varchar), ('editor'::varchar), ('viewer'::varchar)) AS r(role)
     ON CONFLICT DO NOTHING`,
    [SERVICE_PRINCIPAL, CANONICAL_USER]
  );

  // A service account is not a workspace member. Assert it, because if it ever
  // became one it would inherit the workspace audience for no reason.
  const spaceLeak = await readAllTuples({ object: 'space:main' });
  const leaked = spaceLeak.tuples.filter(
    (t) => t.relation === 'member' && (t.user === SERVICE_PRINCIPAL || t.user === LEGACY_SYSTEM)
  );
  if (leaked.length > 0) {
    for (const t of leaked) {
      await applyRevoke({ object: 'space:main', subject: t.user, relation: 'member' }).catch(() => {});
    }
    console.log(`[normalize-owners] removed ${leaked.length} stray workspace membership(s) for the service account`);
  }

  void writeAudit({
    actor: 'system:normalize-owners',
    action: 'permission.normalize_owners',
    resourceType: 'permission',
    resourceId: '*',
    detail: {
      folded: FOLD_INTO_CANONICAL.length,
      toCanonical: plans.length - serviceResources.length,
      toServiceAccount: serviceResources.length,
      serviceAccount: SERVICE_PRINCIPAL,
    },
  });

  invalidateOwnerCache();

  // ── Verify by re-reading, never by trusting the writes ───────────────────
  console.log('[normalize-owners] verifying…');
  const remaining = await query(
    `SELECT r.owner_id, COUNT(*)::int AS n
     FROM resources r
     LEFT JOIN users u ON u.id = r.owner_id
     LEFT JOIN service_accounts s ON s.id = r.owner_id
     WHERE r.owner_id IS NOT NULL AND u.id IS NULL AND s.id IS NULL
     GROUP BY r.owner_id`
  );
  if ((remaining.rows || []).length > 0) {
    console.error('[normalize-owners] unresolvable owners remain:');
    for (const row of remaining.rows || []) {
      console.error(`  ! ${row.owner_id} (${row.n} resources)`);
    }
    return false;
  }

  const sample = await query(
    `SELECT owner_id, COUNT(*)::int AS n FROM resources GROUP BY owner_id ORDER BY n DESC`
  );
  console.log('\n[normalize-owners] final ownership:');
  for (const row of sample.rows || []) {
    console.log(`    ${String(row.n).padStart(4)}  ${row.owner_id}`);
  }

  return true;
}

main()
  .then((ok) => {
    if (!ok) process.exit(1);
    console.log('\n[normalize-owners] done');
  })
  .catch((err) => {
    console.error('[normalize-owners] fatal:', err.message || err);
    process.exit(1);
  });
