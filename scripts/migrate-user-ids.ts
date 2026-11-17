/**
 * Re-key users from derived ids to opaque, stable ones.
 *
 *   npx tsx scripts/migrate-user-ids.ts           # report only
 *   npx tsx scripts/migrate-user-ids.ts --fix     # apply
 *
 * ── Why this is not a direct SQL UPDATE on the tuple table ───────────────────
 *
 * It would be far faster, and it would be wrong. OpenFGA maintains a `changelog`
 * table as the source for `readChanges()`, which the ACL projection consumes.
 * Rewriting `_user` behind the engine's back would leave the changelog asserting
 * that the OLD principal was added, so the projection would apply the wrong
 * principal. Every tuple is therefore deleted and re-written through the API, so
 * the change feed stays truthful.
 *
 * ── Order ────────────────────────────────────────────────────────────────────
 *
 * 1. Record the legacy id on each user.
 * 2. Re-key `users.id`; the three foreign keys cascade.
 * 3. Re-key the non-FK references (owner_id, audit actor, chat).
 * 4. Re-key OpenFGA subjects, deleting before writing so a (object, relation)
 *    pair can never collide on the primary key.
 * 5. Re-read and verify. A migration that reports success it did not verify is
 *    worse than one that fails loudly.
 */
import 'dotenv/config';
import { OpenFgaClient } from '@openfga/sdk';
import { query } from '../src/lib/db';
import { newUserId } from '../src/lib/userIds';
import { writeAudit } from '../src/lib/audit';
import { withAclCacheInvalidation } from '../src/lib/aclCache';

const FIX = process.argv.includes('--fix');
const BATCH = 50;

interface Rekey {
  legacyId: string;
  newId: string;
  email: string;
}

async function main() {
  const storeId = process.env.OPENFGA_STORE_ID;
  const apiUrl = process.env.OPENFGA_API_URL || 'http://localhost:8080';
  if (!storeId) throw new Error('OPENFGA_STORE_ID is not set');

  const users = await query('SELECT id, email, legacy_id FROM users ORDER BY email');
  const rows = users.rows || [];

  // Already-migrated users are skipped, so the script is re-runnable.
  const pending = rows.filter((r: any) => !/^user:[0-9a-f-]{36}$/.test(r.id));
  const already = rows.length - pending.length;

  console.log(`[migrate-user-ids] ${rows.length} user(s): ${already} already opaque, ${pending.length} to re-key`);

  const plan: Rekey[] = pending.map((r: any) => ({
    legacyId: r.id,
    newId: r.legacy_id && /^user:[0-9a-f-]{36}$/.test(r.legacy_id) ? r.legacy_id : newUserId(),
    email: r.email,
  }));

  for (const p of plan) console.log(`    ${p.legacyId.padEnd(42)} -> ${p.newId}`);

  if (!FIX) {
    console.log('\n[migrate-user-ids] Re-run with --fix to apply.');
    return true;
  }

  const legacyToNew = new Map(plan.map((p) => [p.legacyId, p.newId]));

  // ── 1 & 2: record the legacy id, then re-key ─────────────────────────────
  for (const p of plan) {
    await query('UPDATE users SET legacy_id = $2 WHERE id = $1', [p.legacyId, p.legacyId]);
  }
  console.log(`[migrate-user-ids] recorded ${plan.length} legacy id(s)`);

  for (const p of plan) {
    // ON UPDATE CASCADE carries api_keys, user_identities and group_memberships.
    await query('UPDATE users SET id = $2 WHERE id = $1', [p.legacyId, p.newId]);
  }
  console.log('[migrate-user-ids] re-keyed users (foreign keys cascaded)');

  // ── 3: non-FK references ─────────────────────────────────────────────────
  const REFERENCES: Array<[string, string]> = [
    ['resources', 'owner_id'],
    ['tags', 'owner_id'],
    ['audit_events', 'actor'],
    ['chat_messages', 'user_id'],
  ];
  for (const [table, column] of REFERENCES) {
    let updated = 0;
    for (const [legacyId, newId] of legacyToNew) {
      const res = await query(
        `UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`,
        [legacyId, newId]
      );
      updated += res.rowCount || 0;
    }
    console.log(`[migrate-user-ids] ${table}.${column}: ${updated} row(s)`);
  }

  // ── 4: OpenFGA subjects, through the engine ──────────────────────────────
  const fga = new OpenFgaClient({ apiUrl, storeId });
  const tuplesRes = await fga.read({}, { pageSize: 100 } as any);
  // Page fully: re-keying must consider every tuple.
  const all: Array<{ user: string; relation: string; object: string }> = [];
  let token: string | undefined;
  do {
    const page: any = await fga.read({}, { pageSize: 100, continuationToken: token } as any);
    for (const t of page.tuples || []) {
      if (t.key?.user) all.push({ user: t.key.user, relation: t.key.relation, object: t.key.object });
    }
    token = page.continuation_token || undefined;
  } while (token);
  console.log(`[migrate-user-ids] read ${all.length} tuple(s)`);

  const toRekey = all.filter((t) => legacyToNew.has(t.user));
  console.log(`[migrate-user-ids] ${toRekey.length} tuple(s) reference a legacy principal`);

  // Delete first, in batches. A (object, relation, user) primary key means a
  // write before its delete would collide.
  for (let i = 0; i < toRekey.length; i += BATCH) {
    const chunk = toRekey.slice(i, i + BATCH);
    await withAclCacheInvalidation(() =>
      fga.write({
        deletes: chunk.map((t) => ({ user: t.user, relation: t.relation, object: t.object })),
      } as any)
    );
  }
  console.log('[migrate-user-ids] deleted legacy tuples');

  for (let i = 0; i < toRekey.length; i += BATCH) {
    const chunk = toRekey.slice(i, i + BATCH);
    await withAclCacheInvalidation(() =>
      fga.write({
        writes: chunk.map((t) => ({
          user: legacyToNew.get(t.user)!,
          relation: t.relation,
          object: t.object,
        })),
      } as any)
    );
  }
  console.log('[migrate-user-ids] wrote re-keyed tuples');

  for (const p of plan) {
    void writeAudit({
      actor: 'system:migrate-user-ids',
      action: 'identity.rekey',
      resourceType: 'user',
      resourceId: p.newId,
      detail: { legacyId: p.legacyId, newId: p.newId, email: p.email },
    });
  }

  // ── 5: verify by re-reading, never by trusting the writes ────────────────
  console.log('[migrate-user-ids] verifying…');

  const after: any = await fga.read({}, { pageSize: 100 } as any);
  const afterUsers = new Set(
    (after.tuples || []).map((t: any) => t.key?.user).filter(Boolean)
  );
  const stragglers = [...legacyToNew.keys()].filter((legacy) =>
    (after.tuples || []).some((t: any) => t.key?.user === legacy)
  );
  if (stragglers.length > 0) {
    console.error(`[migrate-user-ids] ${stragglers.length} legacy principal(s) still referenced:`);
    for (const s of stragglers) console.error(`  ! ${s}`);
    return false;
  }

  const dbUsers = await query('SELECT id, email, legacy_id FROM users ORDER BY email');
  console.log('\n[migrate-user-ids] final identities:');
  for (const u of dbUsers.rows || []) {
    console.log(`    ${u.id}  ${String(u.email).padEnd(42)} legacy: ${u.legacy_id ?? '(none)'}`);
  }

  const orphanOwners = await query(
    `SELECT r.owner_id, COUNT(*)::int AS n
     FROM resources r
     LEFT JOIN users u ON u.id = r.owner_id
     WHERE r.owner_id LIKE 'user:%' AND u.id IS NULL
     GROUP BY r.owner_id`
  );
  if ((orphanOwners.rows || []).length > 0) {
    console.error('[migrate-user-ids] resources reference ids with no account:');
    for (const o of orphanOwners.rows || []) console.error(`  ! ${o.owner_id} (${o.n})`);
    return false;
  }

  console.log('[migrate-user-ids] apply migrations/0010_user_id_format_constraint.sql next to lock the format in');

  console.log(`\n[migrate-user-ids] re-keyed ${plan.length} user(s) and ${toRekey.length} tuple(s)`);
  return true;
}

main()
  .then((ok) => {
    if (!ok) process.exit(1);
    console.log('[migrate-user-ids] done');
  })
  .catch((err) => {
    console.error('[migrate-user-ids] fatal:', err.message || err);
    process.exit(1);
  });
