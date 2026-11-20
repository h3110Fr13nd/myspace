# Scale benchmarks

Reproducible measurements for the graph and canvas views, server and browser.
Results and their interpretation live in [`docs/perf/SCALING.md`](../docs/perf/SCALING.md);
raw output lands in `bench/results/`.

All synthetic data is deterministic (`bench/lib/synth.ts`): a multi-author
knowledge base with nested folders, Zipf-skewed folder sizes and power-law
wikilinks (75% within an author, 25% to globally popular notes).

## 1. Server, in-process (no database)

Legacy "whole graph as JSON" vs the tile pyramid, each in a fresh Node process
so peak RSS is attributable:

```sh
npm run bench:graph-server                     # 10k, 100k, 1M
npm run bench:graph-server -- 50000 500000     # custom sizes
BENCH_HEAP_MB=192 npm run bench:graph-server   # with the app container's heap cap
```

## 2. Server, real database

Needs a scratch Postgres (the seed script refuses databases whose name does not
contain `bench`):

```sh
export DATABASE_URL=postgresql://postgres@localhost:5435/bench_db
npm run migrate:up
npm run bench:seed -- 1000000 --private 0.1          # 1M resources + ACL projection
npx tsx bench/seed-canvas.ts 20000                  # a 20k-node canvas
npm run graph:build -- --trust-projection --all     # layout + pyramids (no OpenFGA)
```

`--trust-projection` skips OpenFGA verification of the public layer and is
refused when `NODE_ENV=production`; use it only on scratch databases.

Then, against a running server (`SERVER_PID` lets the script read the server's
own CPU time and RSS from `/proc`):

```sh
SERVER_PID=<pid> BENCH_URL=http://localhost:4321 npx tsx bench/http-bench.ts tiles 20 16
SERVER_PID=<pid> BENCH_URL=http://localhost:4321 npx tsx bench/http-bench.ts url /api/v1/resources/canvas/bench-20000 20 4
```

To act as a signed-in user (e.g. a canvas owner), start the server with
`INTERNAL_SERVICE_TOKEN=<t>` and pass `BENCH_USER=user:<uuid>
BENCH_INTERNAL_TOKEN=<t>`; requests then carry the service identity headers.

Before/after comparison of two servers on the same database (original code
on :4600, this branch on :4500 — e.g. a `git worktree` of the base commit):

```sh
DATABASE_URL=... BENCH_INTERNAL_TOKEN=<t> BEFORE_PID=<pid> AFTER_PID=<pid> \
  bench/server-compare.sh          # -> bench/results/server-compare.jsonl
```

Without an OpenFGA engine the app marks the ACL projection stale at boot, and
public tiles then (correctly) fail closed. For benchmarking only:
`UPDATE acl_projection_state SET stale = false` after the server has booted.

## 3. Browser

Dev-only pages under `/bench/*` (404 in production unless `ENABLE_BENCH_PAGES=1`):

| Page | What it renders |
|---|---|
| `/bench/graph` | the streamed graph, from the real tile API |
| `/bench/graph-classic?n=20000` | the classic force-directed view on N synthetic nodes |
| `/bench/canvas?n=10000&mode=editor\|viewer` | the canvas editor / viewer on a synthetic board |

```sh
npm run build
ENABLE_BENCH_PAGES=1 NODE_ENV=production PORT=4321 DATABASE_URL=... node dist/server/entry.mjs &
PLAYWRIGHT_CHROMIUM_EXECUTABLE=... BENCH_URL=http://localhost:4321 BENCH_TAG=run \
  npx tsx bench/browser-bench.ts            # all scenarios
  npx tsx bench/browser-bench.ts "^canvas"  # regex filter
```

Before/after in one interleaved run (medians; robust to a noisy host):

```sh
BENCH_TARGETS="before=http://localhost:4600,after=http://localhost:4500" BENCH_REPEAT=3 \
  npx tsx bench/browser-bench.ts
npx tsx bench/merge-compare.ts run1.log run2.log   # if split across sessions
npx tsx bench/report.ts                            # markdown tables for SCALING.md
```

Per scenario: time to first content, rAF frame intervals during a scripted pan
and zoom, main-thread busy time / script / layout+style per second of
interaction (from CDP, hardware-independent), long tasks, JS heap and DOM node
count. In a GPU-less container, WebGL and compositing are rasterised on the
CPU, so absolute frame intervals are pessimistic — compare rows, and prefer the
main-thread columns.

`bench/first-paint.ts` times the classic view from "expand" to first painted
graph for both servers (`BEFORE_URL`, `AFTER_URL`).

## 4. Diagnostics

`bench/diagnostics/trace.ts <url> [drag|wheel] [--profile]` aggregates a
Chrome trace (or a CPU profile, with hottest source lines) of a scripted
interaction. Against a dev server, function names and lines are readable.
