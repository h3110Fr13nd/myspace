/**
 * Build or refresh the tiled graph.
 *
 *   npm run graph:build                      # dirty scopes only (incremental)
 *   npm run graph:build -- --all             # every scope
 *   npm run graph:build -- --relayout        # recompute every position
 *   npm run graph:build -- --scope public
 *
 * Public membership is verified against OpenFGA. `--trust-projection` skips the
 * engine and trusts the ACL projection; it exists for benchmarks on a scratch
 * database and is refused when NODE_ENV=production.
 *
 * Runs outside the app process by design: a full build holds the graph in
 * memory, which must not compete with request handling for the app's budget.
 */
import 'dotenv/config';
import pg from 'pg';
import { buildGraphTiles } from '../src/lib/graph-tiles/builder';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const scopeIdx = args.indexOf('--scope');

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@localhost:5435/workspace_db`;

async function main() {
  const pool = new pg.Pool({ connectionString, max: 2 });
  try {
    const report = await buildGraphTiles({
      pool,
      scopes: scopeIdx >= 0 ? [args[scopeIdx + 1]] : has('--all') ? 'all' : 'dirty',
      relayout: has('--relayout'),
      verify: has('--trust-projection') ? 'projection' : 'openfga',
      log: (msg, extra) => console.log(`[graph-build] ${msg}`, extra ? JSON.stringify(extra) : ''),
    });
    const rss = Math.round(process.resourceUsage().maxRSS / 1024);
    console.log(JSON.stringify({ ...report, scopes: report.scopes.length, peakRssMb: rss }, null, 2));
    const top = [...report.scopes].sort((a, b) => b.nodes - a.nodes).slice(0, 5);
    console.table(top);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[graph-build] failed:', err?.message ?? err);
  process.exit(1);
});
