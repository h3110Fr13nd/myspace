/**
 * Server-side graph benchmark: legacy "whole graph as JSON" vs tiled pyramid.
 *
 *   npx tsx bench/graph-server.bench.ts                   # default sizes
 *   npx tsx bench/graph-server.bench.ts 10000 100000      # custom sizes
 *   BENCH_HEAP_MB=192 npx tsx bench/graph-server.bench.ts # app-container heap cap
 *
 * Each (variant, size) runs in a fresh Node process so peak RSS belongs to that
 * measurement alone. With BENCH_HEAP_MB set, V8's old space is capped the way
 * the production app container caps it, so "does this fit" is measured rather
 * than guessed; an out-of-memory crash is reported as such.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const SIZES = sizes.length ? sizes : [10_000, 100_000, 1_000_000];
const HEAP = process.env.BENCH_HEAP_MB;
const VARIANTS = (process.env.BENCH_VARIANTS ?? 'legacy,tiled').split(',');

type Row = Record<string, any>;
const results: Row[] = [];

for (const n of SIZES) {
  for (const variant of VARIANTS) {
    const args = [
      ...(HEAP ? [`--max-old-space-size=${HEAP}`] : []),
      '--import',
      'tsx',
      join(HERE, 'graph-server.worker.ts'),
      variant,
      String(n),
    ];
    const started = Date.now();
    const child = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 30 * 60_000 });
    const line = child.stdout.trim().split('\n').filter(Boolean).pop();
    let row: Row;
    try {
      row = JSON.parse(line ?? '');
    } catch {
      const oom = /heap out of memory|Allocation failed/i.test(child.stderr);
      row = {
        variant,
        n,
        error: oom ? `OOM (heap cap ${HEAP ?? 'default'} MB)` : `exit ${child.status}: ${child.stderr.slice(-300)}`,
      };
    }
    row.wallMs = Date.now() - started;
    results.push(row);
    console.log(JSON.stringify(row));
  }
}

const kb = (b?: number) => (b === undefined ? '—' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`);
const lines: string[] = [];
lines.push(`| Variant | Nodes | Server work | Peak RSS | First view (gz) | Detail view (gz) | Notes |`);
lines.push(`|---|---:|---:|---:|---:|---:|---|`);
for (const r of results) {
  if (r.error) {
    lines.push(`| ${r.variant} | ${r.n.toLocaleString()} | — | — | — | — | **${r.error}** |`);
    continue;
  }
  if (r.variant === 'legacy') {
    lines.push(
      `| legacy JSON | ${r.n.toLocaleString()} | ${r.serverMsPerRequest} ms **per request** | ${r.peakRssMb} MB | ${kb(r.payloadGzBytes)} | (same) | ${kb(r.payloadBytes)} raw JSON, ${r.links.toLocaleString()} links |`
    );
  } else {
    lines.push(
      `| tiled | ${r.n.toLocaleString()} | ${r.buildTotalMs} ms **once** (layout ${r.layoutMs}, pyramid ${r.pyramidMs}, encode+gz ${r.encodeGzipMs}) | ${r.peakRssMb} MB | ${kb(r.firstViewGzBytes)} | ${kb(r.detailViewGzBytes)} | ${r.tiles} tiles / ${r.levels} levels, max tile ${kb(r.maxTileGzBytes)} (${r.maxTileNodes} nodes), total ${kb(r.gzBytes)} |`
    );
  }
}
const table = lines.join('\n');
console.log('\n' + table);

const outDir = join(HERE, 'results');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(join(outDir, `graph-server-${HEAP ? `heap${HEAP}-` : ''}${stamp}.json`), JSON.stringify(results, null, 2));
writeFileSync(join(outDir, `graph-server-${HEAP ? `heap${HEAP}-` : ''}latest.md`), table + '\n');
