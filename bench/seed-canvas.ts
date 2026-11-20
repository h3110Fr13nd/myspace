/**
 * Add a large canvas to the benchmark database.
 *
 *   DATABASE_URL=.../bench_db npx tsx bench/seed-canvas.ts 20000 [slug]
 *
 * 30% of nodes reference existing resources, so the endpoint's per-node
 * permission and enrichment path is exercised, not just plain text cards.
 */
import pg from 'pg';
import { synthCanvas } from './lib/synth';

const n = Number(process.argv[2] ?? 20000);
const slug = process.argv[3] ?? `bench-${n}`;
const url = process.env.DATABASE_URL ?? '';
if (!/bench/.test(new URL(url).pathname)) {
  console.error('Refusing: database name must contain "bench".');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
const { rows } = await pool.query(`SELECT count(*)::int AS c FROM resources WHERE type = 'document'`);
const docs = Math.max(1, rows[0].c);
const doc = synthCanvas(n, 7, { resourceRatio: 0.3, resourceIds: (i) => `document:n${1 + ((i * 7919) % Math.min(docs, 900000))}` });
const id = `canvas:${slug}`;
await pool.query(
  `INSERT INTO resources (id, type, parent_id, owner_id, path, title, metadata, is_public)
   VALUES ($1, 'canvas', 'space:main', 'user:00000000-0000-4000-8000-000000000000', $2, $3, $4, true)
   ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, title = EXCLUDED.title`,
  [id, `space:main/${id}`, `Bench canvas ${n}`, JSON.stringify({ slug, canvasData: { nodes: doc.nodes, edges: doc.edges } })]
);
await pool.query(
  `INSERT INTO resource_effective_acl (resource_id, subject_type, subject_id, rung, source)
   VALUES ($1, 'audience', 'user:*', 'viewer', 'audience') ON CONFLICT DO NOTHING`,
  [id]
);
console.log(`${id}: ${doc.nodes.length} nodes, ${doc.edges.length} edges, ${doc.nodes.filter((x: any) => x.resourceId).length} resource nodes`);
await pool.end();
