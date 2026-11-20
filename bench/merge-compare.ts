/**
 * Rebuild bench/results/browser-compare.json from the per-run lines that
 * `browser-bench.ts` prints in compare mode (one JSON object per run, with
 * `target` and `rep`). Used when a long comparison is split across sessions.
 *
 *   npx tsx bench/merge-compare.ts run1.log run2.log ...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runs: any[] = [];
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const r = JSON.parse(line);
    if (r.target) runs.push(r);
  }
}
const median = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
const groups = new Map<string, any[]>();
for (const r of runs) {
  const key = `${r.scenario}\u0000${r.target}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(r);
}
const order = ['graph classic', 'graph tiled', 'canvas editor', 'canvas viewer'];
const rows = [...groups.entries()]
  .map(([key, list]) => {
    const [scenario, target] = key.split('\u0000');
    const ok = list.filter((x) => !x.error);
    if (!ok.length) return { scenario: `${scenario} [${target}]`, n: list[0].n, error: list[0].error, runs: 0, ofRuns: list.length };
    const pick = (k: string) => median(ok.map((x) => x[k]));
    return {
      scenario: `${scenario} [${target}]`,
      n: list[0].n,
      readyMs: pick('readyMs'),
      p50: pick('p50'),
      p95: pick('p95'),
      jankPct: pick('jankPct'),
      mainMsPerS: pick('mainMsPerS'),
      scriptMsPerS: pick('scriptMsPerS'),
      layoutMsPerS: pick('layoutMsPerS'),
      interactionS: pick('interactionS'),
      heapMb: pick('heapMb'),
      dom: pick('dom'),
      tilesLoaded: ok[0].tilesLoaded,
      wireKb: ok[0].wireKb,
      runs: ok.length,
      ofRuns: list.length,
    };
  })
  .sort((a, b) => {
    const ka = order.findIndex((o) => a.scenario.startsWith(o));
    const kb = order.findIndex((o) => b.scenario.startsWith(o));
    return ka - kb || (a.n ?? 0) - (b.n ?? 0) || (a.scenario.includes('[before]') ? -1 : 1);
  });
const out = join(dirname(fileURLToPath(import.meta.url)), 'results', 'browser-compare.json');
writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`${rows.length} rows -> ${out}`);
