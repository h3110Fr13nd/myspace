/**
 * Seed a scratch Postgres with a synthetic workspace for the scale benchmarks.
 *
 *   DATABASE_URL=postgresql://postgres@localhost:5435/bench_db \
 *     npx tsx bench/seed-db.ts 1000000 [--private 0.1] [--canvas 50000]
 *
 * Writes resources (with slugs and wikilinks in metadata, like imported vaults),
 * the ACL projection rows a real deployment would have (`user:*` viewer for the
 * public share), and marks the projection fresh. Refuses to run against a
 * database whose name does not contain "bench", because it truncates tables.
 */
import pg from 'pg';
import { KIND_NAMES, materialiseRows, synthCanvas, synthWorkspace } from './lib/synth';

const args = process.argv.slice(2);
const n = Number(args[0] ?? 100000);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const privateRatio = flag('private', 0.1);
const canvasNodes = flag('canvas', 0);

const url = process.env.DATABASE_URL ?? '';
if (!/bench/.test(new URL(url).pathname)) {
  console.error(`Refusing to seed ${url}: database name must contain "bench".`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 4 });

function ownerId(a: number) {
  return `user:00000000-0000-4000-8000-${a.toString(16).padStart(12, '0')}`;
}

async function main() {
  const t0 = Date.now();
  await pool.query(`TRUNCATE graph_tiles, graph_scopes, graph_nodes, resource_effective_acl RESTART IDENTITY`);
  await pool.query(`DELETE FROM resource_tags`);
  await pool.query(`DELETE FROM resource_audience`);
  // Disable the dirty triggers during the bulk load; they are statement-level
  // and cheap, but there is nothing to mark dirty in an empty pyramid anyway.
  await pool.query(`ALTER TABLE resources DISABLE TRIGGER USER`);
  await pool.query(`TRUNCATE resources CASCADE`);

  const ws = synthWorkspace(n);
  const rows = materialiseRows(ws);
  console.log(`generated ${n} resources, ${ws.linkSrc.length} links in ${Date.now() - t0} ms`);

  const chunk = 10000;
  let publicCount = 0;
  for (let a = 0; a < rows.length; a += chunk) {
    const part = rows.slice(a, a + chunk);
    const isPrivate = part.map((_, k) => ((a + k) * 2654435761 % 1000) / 1000 < privateRatio);
    await pool.query(
      `INSERT INTO resources (id, type, parent_id, owner_id, path, title, metadata, is_public, is_draft)
       SELECT * FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[], $5::text[],
                            $6::text[], $7::jsonb[], $8::boolean[], $9::boolean[])`,
      [
        part.map((r) => r.id),
        part.map((r) => r.type),
        part.map((r) => r.parent_id),
        part.map((_, k) => ownerId(ws.owner[a + k])),
        part.map((r) => r.path),
        part.map((r) => r.title),
        part.map((r) => JSON.stringify(r.metadata)),
        isPrivate.map((p) => !p),
        part.map((_, k) => (a + k) % 997 === 0),
      ]
    );
    const publicIds = part.filter((_, k) => !isPrivate[k]).map((r) => r.id);
    publicCount += publicIds.length;
    await pool.query(
      `INSERT INTO resource_effective_acl (resource_id, subject_type, subject_id, rung, source)
       SELECT id, 'audience', 'user:*', 'viewer', 'audience' FROM unnest($1::varchar[]) AS t(id)`,
      [publicIds]
    );
    if ((a / chunk) % 10 === 0) console.log(`  ${a + part.length} / ${n}`);
  }

  if (canvasNodes > 0) {
    const doc = synthCanvas(canvasNodes);
    await pool.query(
      `INSERT INTO resources (id, type, parent_id, owner_id, path, title, metadata, is_public)
       VALUES ('canvas:bench-huge', 'canvas', 'space:main', $1, 'space:main/canvas:bench-huge', $2, $3, true)
       ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [ownerId(0), doc.title, JSON.stringify({ slug: 'bench-huge', canvasData: { nodes: doc.nodes, edges: doc.edges } })]
    );
    await pool.query(
      `INSERT INTO resource_effective_acl (resource_id, subject_type, subject_id, rung, source)
       VALUES ('canvas:bench-huge', 'audience', 'user:*', 'viewer', 'audience') ON CONFLICT DO NOTHING`
    );
    console.log(`canvas:bench-huge with ${doc.nodes.length} nodes, ${doc.edges.length} edges`);
  }

  await pool.query(`ALTER TABLE resources ENABLE TRIGGER USER`);
  await pool.query(
    `UPDATE acl_projection_state SET stale = FALSE, last_reconcile_at = NOW(), last_change_at = NOW() WHERE id = 1`
  );
  await pool.query(`ANALYZE resources`);
  await pool.query(`ANALYZE resource_effective_acl`);
  console.log(
    `seeded ${n} resources (${publicCount} public, kinds: ${KIND_NAMES.join('/')}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
