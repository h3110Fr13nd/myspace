#!/usr/bin/env bash
# Server-side before/after comparison against two running app servers that
# share one benchmark database (see bench/README.md).
#
#   DATABASE_URL=<bench db> BEFORE_PID=<pid> AFTER_PID=<pid> bench/server-compare.sh
#
# BEFORE serves the original code on :4600, AFTER this branch on :4500.
set -u
BEFORE=${BEFORE_URL:-http://localhost:4600}
AFTER=${AFTER_URL:-http://localhost:4500}
OUT=${OUT:-bench/results/server-compare.jsonl}
: > "$OUT"

run() { # label pid url-mode args...
  local label=$1 pid=$2 base=$3; shift 3
  SERVER_PID=$pid BENCH_URL=$base npx tsx bench/http-bench.ts "$@" \
    | sed "s|^{|{\"label\":\"$label\",|" | tee -a "$OUT"
}

# 1. Tile serving under load (new code only: the route did not exist).
run "tiles after" "$AFTER_PID" "$AFTER" tiles 20 16

# 2. The whole-graph JSON endpoint at 1M resources.
run "workspace/graph before" "$BEFORE_PID" "$BEFORE" url /api/v1/workspace/graph 60 1
run "workspace/graph after" "$AFTER_PID" "$AFTER" url /api/v1/workspace/graph 10 1

# 3. The canvas document endpoint: a denied (anonymous) read, then the owner's
#    read via the service header (both servers must run with
#    INTERNAL_SERVICE_TOKEN=$BENCH_INTERNAL_TOKEN).
for n in 2000 20000; do
  run "canvas-$n anonymous before" "$BEFORE_PID" "$BEFORE" url /api/v1/resources/canvas/bench-$n 20 4
  run "canvas-$n anonymous after" "$AFTER_PID" "$AFTER" url /api/v1/resources/canvas/bench-$n 20 4
  if [ -n "${BENCH_INTERNAL_TOKEN:-}" ]; then
    export BENCH_USER=${BENCH_USER:-user:00000000-0000-4000-8000-000000000000}
    run "canvas-$n owner before" "$BEFORE_PID" "$BEFORE" url /api/v1/resources/canvas/bench-$n 20 4
    run "canvas-$n owner after" "$AFTER_PID" "$AFTER" url /api/v1/resources/canvas/bench-$n 20 4
    unset BENCH_USER
  fi
done

# 4. The page shell (home page), unchanged by this work: measured to record
#    its remaining O(N) cost.
run "home before" "$BEFORE_PID" "$BEFORE" url / 60 1
run "home after" "$AFTER_PID" "$AFTER" url / 60 1
