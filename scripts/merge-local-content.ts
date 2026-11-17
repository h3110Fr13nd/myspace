/**
 * Additive merge of a local content export into a running database + OpenFGA.
 *
 * Run this ON THE VM. It reads CSV exports produced by the local machine and
 * folds them in without touching a single row that already exists there.
 *
 * ── Why additive-only ───────────────────────────────────────────────────────
 *
 * The two machines hold genuinely different states, and neither is a superset:
 * the local database has ~930 resources the VM has never seen, and the VM has
 * ~180 (plus 10 image rows and extra PDFs) that local has never seen. All seven
 * ids present on both sides differ in content. A dump-and-restore in either
 * direction would silently delete one side's work, so this script only ever
 * ADDS, using `ON CONFLICT DO NOTHING` everywhere — including for the shared ids,
 * where the live VM copy is kept untouched.
 *
 * ── Why the OpenFGA half is not optional ────────────────────────────────────
 *
 * A resource row with no tuple in the authorization graph is invisible: the
 * engine fails closed, so a merged vault would render empty with no error
 * anywhere. Postgres alone is not the content. For every resource this writes:
 *
 *   - `owner`          so the resource's own owner can reach it
 *   - `parent_folder`  for nested resources, so folder-inherited grants resolve
 *
 * Both are written only where a tuple is missing, so re-running is cheap and
 * cannot disturb grants a user made by hand.
 *
 * Usage (on the VM):
 *   DATABASE_URL=... OPENFGA_API_URL=... OPENFGA_STORE_ID=... \
 *     npx tsx scripts/merge-local-content.ts --dir ~/merge-in
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fgaClient } from '../src/lib/openfga';
import { withAclCacheInvalidation } from '../src/lib/aclCache';
import { readAllTuples } from '../src/lib/acl/reader';
import { MODEL } from '../src/lib/acl/modelSpec';

const { Pool } = pg;

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) {
    console.error(`missing required argument ${name}`);
    process.exit(2);
  }
  return process.argv[i + 1];
}

const dir = arg('--dir');
const apply = process.argv.includes('--apply');
const dryRun = !apply;

/** Minimal RFC4180 CSV row splitter — the export uses no embedded quotes in ids. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '');
}

function loadCsv(name: string): string[][] {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) {
    console.warn(`  (no ${name} — skipping)`);
    return [];
  }
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const resources = loadCsv('resources.csv');
  const users = loadCsv('users.csv');
  const tags = loadCsv('tags.csv');
  const resourceTags = loadCsv('resource_tags.csv');

  console.log(`export: ${resources.length} resources, ${users.length} users, ${tags.length} tags, ${resourceTags.length} resource_tags`);
  if (dryRun) console.log('\nDRY RUN — pass --apply to write. Re-run with --apply to perform the merge.\n');

  // ── Postgres: additive only ──────────────────────────────────────────────
  //
  // Two passes through a staging table, because `resources_parent_id_fkey`
  // enforces that a child's parent already exists. A single INSERT ... SELECT in
  // export order trips that the moment a child precedes its parent — which it
  // does, because the export is not depth-ordered. Pass 1 lands every row with
  // parent_id NULL (parents first becomes irrelevant), pass 2 fills in the
  // edges once every parent is present. A parent that exists on neither side
  // leaves the edge NULL and is reported, rather than aborting the merge.
  try {
    await client.query('BEGIN');
    await client.query('DROP TABLE IF EXISTS merge_stage_resources');
    await client.query(`
      CREATE TEMP TABLE merge_stage_resources (
        id text, type text, tenant_id text, parent_id text, owner_id text,
        path text, title text, metadata text, is_public text, is_draft text,
        created_at text, updated_at text
      )`);

    // users: bare ON CONFLICT DO NOTHING, because `email` is UNIQUE — a bare
    // target (ON CONFLICT (id)) would still raise on an email collision.
    for (const [id, email, hash, name, active, created, avatar] of users) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, is_active, created_at, avatar_url)
         VALUES ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7)
         ON CONFLICT DO NOTHING`,
        [id, email || null, hash || null, name || null, active === 'true', created || null, avatar || null],
      );
    }

    for (const [id, name, scopeType, scopeId, ownerId, created] of tags) {
      await client.query(
        `INSERT INTO tags (id, name, scope_type, scope_id, owner_id, created_at)
         VALUES ($1,$2,$3,$4,$5,coalesce($6::timestamptz,now())) ON CONFLICT (id) DO NOTHING`,
        [id, name, scopeType || null, scopeId || null, ownerId || null, created || null],
      );
    }

    for (const row of resources) {
      await client.query(
        `INSERT INTO merge_stage_resources VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        row.length >= 12 ? row : row.concat(new Array(12 - row.length).fill('')),
      );
    }

    // `type` is the `resource_type` enum, not text, and Postgres will not
    // implicitly cast text into an enum on INSERT ... SELECT. The explicit
    // `::text::resource_type` hop is what makes the staging table's text column
    // assignable; a value the enum does not contain fails loudly, which is the
    // behaviour we want rather than a silent skip.
    //
    // `tier` and `unlisted` exist only on the migrated schema; both are NOT NULL
    // with defaults, so they are left to their defaults rather than supplied.
    const ins = await client.query(
      `INSERT INTO resources (id,type,tenant_id,parent_id,owner_id,path,title,metadata,is_public,is_draft,created_at,updated_at)
       SELECT id, type::text::resource_type, coalesce(nullif(tenant_id,''),'tenant_default'), NULL, owner_id, path, title,
              coalesce(nullif(metadata,'')::jsonb,'{}'::jsonb),
              coalesce(nullif(is_public,'')::boolean,false), coalesce(nullif(is_draft,'')::boolean,false),
              coalesce(nullif(created_at,'')::timestamptz, now()), coalesce(nullif(updated_at,'')::timestamptz, now())
       FROM merge_stage_resources
       ON CONFLICT (id) DO NOTHING`,
    );

    // Pass 2: attach parents that now exist. Rows whose parent is missing on both
    // sides keep parent_id NULL and are counted, so a dangling edge is visible
    // instead of silently producing an orphaned subtree.
    const upd = await client.query(
      `UPDATE resources r
          SET parent_id = s.parent_id
         FROM merge_stage_resources s
        WHERE r.id = s.id
          AND s.parent_id IS NOT NULL AND s.parent_id <> ''
          AND r.parent_id IS DISTINCT FROM s.parent_id
          AND EXISTS (SELECT 1 FROM resources p WHERE p.id = s.parent_id)`,
    );
    const orphan = await client.query(
      `SELECT count(*)::int AS n FROM merge_stage_resources s
        WHERE s.parent_id IS NOT NULL AND s.parent_id <> ''
          AND NOT EXISTS (SELECT 1 FROM resources p WHERE p.id = s.parent_id)`,
    );
    console.log(`  inserted ${ins.rowCount} new resources; linked ${upd.rowCount} parent edges; ${orphan.rows[0].n} dangling parents left unlinked`);

    for (const [resourceId, tagId, taggedBy, created] of resourceTags) {
      await client.query(
        `INSERT INTO resource_tags (resource_id, tag_id, tagged_by, created_at)
         VALUES ($1,$2,$3,coalesce($4::timestamptz,now())) ON CONFLICT DO NOTHING`,
        [resourceId, tagId, taggedBy || null, created || null],
      );
    }

    if (dryRun) {
      const probe = await client.query('SELECT count(*)::int AS n FROM resources');
      console.log(`  [dry] resources in DB right now: ${probe.rows[0].n} (unchanged — rolled back)`);
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
      const after = await client.query('SELECT count(*)::int AS n FROM resources');
      console.log(`  resources after merge: ${after.rows[0].n}`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('postgres merge failed, rolled back:', e);
    process.exit(1);
  } finally {
    client.release();
  }

  // ── OpenFGA: the part that makes the merged rows actually reachable ──────
  // Skip in dry run: nothing has been written, so the graph is untouched.
  if (dryRun) {
    await pool.end();
    return;
  }

  const { tuples: existing, truncated } = await readAllTuples();
  if (truncated) {
    // Reading a partial graph and then "filling gaps" would write tuples that
    // already exist. Refuse rather than guess.
    console.error('openfga: tuple read was truncated; refusing to backfill from a partial graph');
    await pool.end();
    process.exit(1);
  }
  const has = new Set(existing.map((t) => `${t.object}#${t.relation}`));

  const rows = await pool.query(
    `SELECT r.id, r.type, r.owner_id, r.parent_id,
            (SELECT p.type FROM resources p WHERE p.id = r.parent_id) AS parent_type
     FROM resources r
     WHERE r.owner_id IS NOT NULL`,
  );

  // Build the full set of tuples that are missing, then write them in batches.
  // Deliberately NOT the repo's `importTuples`: that loops one API call per
  // tuple, which for a ~1800-tuple merge over an SSH-forwarded tunnel means
  // thousands of round trips and a high chance of dying halfway. OpenFGA accepts
  // up to 100 writes per request, so this is ~18 calls instead.
  const wanted: Array<{ user: string; relation: string; object: string }> = [];
  for (const r of rows.rows) {
    if (!has.has(`${r.id}#owner`)) {
      wanted.push({ user: r.owner_id, relation: 'owner', object: r.id });
    }
    // Structural edge. Inherited grants read these tuples directly rather than
    // trusting resources.parent_id, so without them a nested note is reachable
    // only by its owner.
    //
    // Only offer a tupleset the child's type actually declares. `canvas` and
    // `sheet` declare `parent_folder` but not `parent_space`, so offering
    // `parent_space` for a resource whose parent happens to be a space produces
    // `relation 'canvas#parent_space' not found` — a request the engine can
    // never accept, whatever the database says about the parent. Checking the
    // model keeps the report honest: a resource with no expressible edge is left
    // to its owner tuple rather than reported as a merge failure.
    if (r.parent_id && r.parent_type) {
      const declared = (MODEL as Record<string, any>)[r.type]?.links;
      const via = declared?.parent_space && r.parent_type === 'space'
        ? 'parent_space'
        : declared?.parent_folder && r.parent_type === 'folder'
          ? 'parent_folder'
          : null;
      if (via && !has.has(`${r.id}#${via}`)) {
        wanted.push({ user: r.parent_id, relation: via, object: r.id });
      }
    }
  }

  const BATCH = 50;
  let written = 0;
  let failed = 0;
  for (let i = 0; i < wanted.length; i += BATCH) {
    const chunk = wanted.slice(i, i + BATCH);
    try {
      await withAclCacheInvalidation(() =>
        fgaClient.write({ writes: chunk })
      );
      written += chunk.length;
    } catch (e: any) {
      // Fall back to one-by-one for this chunk so a single poisoned tuple cannot
      // cost us the whole batch, and so the failing tuple is identifiable.
      console.warn(`  batch at ${i} failed (${e?.message}); retrying individually`);
      for (const t of chunk) {
        try {
          await withAclCacheInvalidation(() =>
            fgaClient.write({ writes: [t] })
          );
          written++;
        } catch (e2: any) {
          failed++;
          console.warn(`    failed: ${t.object} ${t.relation} -> ${e2?.message}`);
        }
      }
    }
  }
  console.log(`  openfga: wrote ${written} tuples (${failed} failed)`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});