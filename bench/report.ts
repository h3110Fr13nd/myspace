/**
 * Render benchmark results as markdown tables for docs/perf/SCALING.md.
 *
 *   npx tsx bench/report.ts > /tmp/results.md
 *
 * Reads bench/results/{browser-compare.json, server-compare.jsonl,
 * graph-server-latest.md, graph-server-heap192-latest.md, first-paint.jsonl}.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = join(dirname(fileURLToPath(import.meta.url)), 'results');
const read = (f: string) => (existsSync(join(R, f)) ? readFileSync(join(R, f), 'utf8') : '');
const out: string[] = [];
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`);

// --- browser ---------------------------------------------------------------
const browser = read('browser-compare.json');
if (browser) {
  const rows: any[] = JSON.parse(browser);
  const by = new Map<string, { before?: any; after?: any }>();
  for (const r of rows) {
    const m = /^(.*) \[(before|after)\]$/.exec(r.scenario);
    if (!m) continue;
    const e = by.get(m[1]) ?? {};
    (e as any)[m[2]] = r;
    by.set(m[1], e);
  }
  const cell = (r: any, f: (r: any) => string) => (!r ? '—' : r.error ? `**${r.error}**` : f(r));
  out.push('### Browser (median of interleaved runs, production build)\n');
  out.push('| Scenario | Build | Ready | Frame p50 / p95 | Jank > 33 ms | Main thread busy | 3 s of scripted input took | JS heap | DOM nodes |');
  out.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [name, e] of by) {
    // At 50k the classic simulation had not produced a first frame within the
    // measurement window in either build, so its frame numbers are meaningless;
    // the first-paint table covers it instead.
    if (name === 'graph classic 50000') continue;
    for (const which of ['before', 'after'] as const) {
      const r = e[which];
      if (!r) continue;
      if (r.error) {
        out.push(`| ${name} | ${which} | **${r.error}** (all ${r.ofRuns ?? ""} runs) | — | — | — | — | — | — |`);
        continue;
      }
      const partial = r.ofRuns && r.runs < r.ofRuns ? ` (${r.runs} of ${r.ofRuns} runs finished)` : '';
      out.push(
        `| ${name} | ${which} | ${cell(r, (x) => `${Math.round(x.readyMs)} ms`)} | ${cell(r, (x) => `${x.p50} / ${x.p95} ms`)} | ${cell(
          r,
          (x) => `${x.jankPct}%`
        )} | ${cell(r, (x) => `${Math.round(x.mainMsPerS / 10)}%`)} | ${cell(r, (x) => `${x.interactionS} s`)} | ${cell(
          r,
          (x) => `${x.heapMb} MB`
        )} | ${cell(r, (x) => String(Math.round(x.dom)))}${partial} |`
      );
    }
  }
  out.push('');
}

const paint = read('first-paint.jsonl');
if (paint) {
  const rows = paint.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  out.push('### Classic view: time from "expand" to first painted graph\n');
  out.push('| Nodes | Before | After |');
  out.push('|---:|---:|---:|');
  const ns = [...new Set(rows.map((r) => r.n))];
  for (const n of ns) {
    const f = (t: string) => {
      const r = rows.find((x) => x.n === n && x.target === t);
      return !r ? '—' : r.firstPaintMs < 0 ? '> 60 s' : `${(r.firstPaintMs / 1000).toFixed(1)} s`;
    };
    out.push(`| ${n.toLocaleString()} | ${f('before')} | ${f('after')} |`);
  }
  out.push('');
}

// --- server -----------------------------------------------------------------
const server = read('server-compare.jsonl');
if (server) {
  const rows = server.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  out.push('### HTTP (1M-resource database, app process measured via /proc)\n');
  out.push('| Request | Concurrency | Throughput | p50 / p95 / p99 latency | App CPU per request | Bytes per response | App peak RSS | Statuses |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---|');
  for (const r of rows) {
    out.push(
      `| ${r.label} | ${r.concurrency} | ${r.rps} req/s | ${r.p50} / ${r.p95} / ${r.p99} ms | ${r.serverCpuMsPerRequest} ms | ${kb(
        r.kbPerRequest * 1024
      )} | ${r.serverPeakRssMb} MB | ${Object.entries(r.statuses)
        .map(([k, v]) => `${k}×${v}`)
        .join(' ')} |`
    );
  }
  out.push('');
}

for (const [title, file] of [
  ['Graph, in-process (legacy JSON vs tile pyramid; fresh process per row)', 'graph-server-latest.md'],
  ['Same, with the app container heap cap (`--max-old-space-size=192`)', 'graph-server-heap192-latest.md'],
] as const) {
  const md = read(file);
  if (md) out.push(`### ${title}\n\n${md}`);
}

process.stdout.write(out.join('\n') + '\n');
