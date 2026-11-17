# Homepage workspace scaling

> **Status (2026-11-10): investigated; optimization remains active.** This note
> tracks homepage work. [`../GOALS.md`](../GOALS.md) owns the serving budget and
> success criteria. Historical figures below are not current request counts.

## Current behavior

`src/pages/index.astro` prepares the visible workspace tree, backlinks, active
document, and a contextual graph of at most 25 nodes on each request. The
contextual graph is serialized with the page and appears without a click. The
complete workspace graph is fetched only when a reader expands the panel through
`/api/v1/workspace/graph`. Both paths use
`listWorkspaceResourceCandidates()` which uses
the effective-ACL projection to select likely-visible resources, owners'
resources, and ancestors. If the projection is stale or unavailable it safely
falls back to the full resource list. `filterViewableResources()` verifies
candidate access through OpenFGA; projection hints do not grant access.

It is therefore no longer accurate to say every healthy anonymous request makes
939 individual authorization decisions. Request work still grows with the
candidate workspace, and tree data is assembled and serialized per render.
Graph cost is now on-demand and remains proportional to the visible candidate
workspace. Stale projection fallback can still require a full scan by design.

The original production incident had page renders over 100 seconds and health
checks up to 350 seconds / 503. That incident predates candidate narrowing,
batched authorization, ACL caching, and current resource limits; do not use it
as a current baseline.

## Changes already in place

- Bounded OpenFGA batch checks, a process-wide concurrency cap, a circuit
  breaker, and fail-closed behavior for errors or missing decisions.
- Generation-counter ACL cache with explicit invalidation on runtime tuple
  writes, bounded cache lookups, and short-lived in-flight request coalescing.
- Effective-ACL projection used only as a candidate prefilter; stale or missing
  projection falls back to complete resource enumeration.
- Indexed resource/slug/parent lookups for graph topology, plus per-build
  memoization for repeated wikilink targets.
- Bounded Markdown rendering, code-highlighting, and file-path lookup caches.
- The bounded contextual graph is built server-side from already-authorized
  listing candidates. The full graph is fetched on demand from a private API
  response; that API repeats the workspace ACL filter and never trusts
  client-supplied resource lists.

## Evidence (latest run 2026-11-11; historical runs retain their dates)

- On 2026-11-11, repeated the homepage soak against the rebuilt constrained
  Compose app: 100 anonymous users, 10-second think time, 60 seconds. It returned
  600/600 HTTP 200 at 10 requests/second (p50 11 ms, p95 25 ms, p99 89 ms,
  max 156 ms). App cgroup CPU increased by about 8.19 seconds (~13.7% of one
  core); app PSI `some avg10` was 0.41% at completion, and the serving containers
  used about 153 MiB after the run. This is anonymous homepage traffic on a
  16-logical-CPU host with per-container quotas, not distinct authenticated
  traffic or proof of physical one-vCPU capacity. The host had no configured
  local account credentials, so only the separate seeded-account E2E proves
  authenticated pass-through.
- Also exercised the deferred graph API with 100 anonymous users, 10-second
  think time, for 60 seconds. All 600 requests returned HTTP 200 at 10
  requests/second (p50 7 ms, p95 13 ms, p99 45 ms, max 92 ms). App CPU increased
  by about 2.94 seconds (~4.9% of one core); cgroup PSI `some avg10` was 0.50%
  after the run, and serving memory was about 161 MiB. This supports the
  on-demand graph design for anonymous traffic under the Compose quotas, but
  does not establish authenticated or physical one-vCPU capacity.

- Authenticated 100-user think-time soak used one account and completed 600
  requests in 60 seconds, all HTTP 200, at about 10 requests/second. p95 was
  60 ms, app CPU about 16% of one core, and app cgroup PSI stayed around 2–4%.
- A separate authenticated 100-way same-account burst after an aged ACL cache
  returned all HTTP 200 but reached roughly 12.2 seconds p95 and 19–22% app PSI.
  It followed a long browser run, so host noise prevents causal attribution.
- An anonymous CPU profile of 40 concurrent homepage requests took 2.47 seconds;
  garbage collection accounted for 81/463 samples and Astro prop serialization
  appeared in 5/463. This is diagnostic evidence, not full CPU attribution.
- A synthetic 1,000-resource topology case with 20,000 duplicate unresolved
  links took 24.7 ms for five memoized full graph builds. The old repeated-scan
  resolution loop alone took 430.4 ms. This is a favorable synthetic case, not
  a production CPU result.
- Probes ran on a 16-logical-CPU host with Compose quotas. They do not establish
  distinct-user capacity or behavior on a real 1-vCPU host. Full evidence and
  acceptance criteria remain in [`../GOALS.md`](../GOALS.md).
- After graph deferral, a one-minute anonymous homepage soak completed 600
  requests at 10 requests/s with p95 17 ms; app CPU rose about 9.36 seconds.
  A separate graph-endpoint soak completed 600 requests at 10 requests/s with
  p95 9 ms; app CPU rose about 3.01 seconds. These are not a paired before/after
  comparison, so they do not establish a CPU reduction. Full suite and access
  filtering evidence are in [`../GOALS.md`](../GOALS.md).
- Removed the page's blocking dependency on Google Fonts. The remote endpoint
  timed out in the local environment, while the page already had tokenized
  system fallbacks. The five ACL route checks that had taken 12–23 seconds each
  now complete in 0.3–3.1 seconds; the full E2E suite passes 83 cases with one
  destructive opt-in skip. Pinned the Node and Bun bases to their verified
  image digests and removed the separately fetched Dockerfile frontend after
  Docker Hub lookups intermittently failed. The rebuilt Compose app now serves
  the system-font version and is healthy; see the goal file for runtime limits.
- The mixed-load E2E soak is configurable. With 100 virtual users, one seeded
  owner session centered among 99 anonymous users, and 10-second think time, it
  completed 599/599 HTTP 200 requests at 9.98 requests/s. Authenticated p95 was
  46 ms and anonymous p95 was 36 ms. This used the testcontainers/dev-server
  setup without serving quotas; it validates pass-through but not capacity.

## Next steps

1. Profile representative authenticated content at concurrency 1, 10, and 100
   after cache expiry; record latency, app CPU, PSI, and memory together. The
   centered fixture account now has 100-user pass-through evidence, but that
   isolated test did not run under the Compose quotas, use distinct accounts,
   or use the local user's actual credentials.
2. Attribute remaining work across PostgreSQL, authorization, Markdown, tree
   and backlink construction, Astro serialization, and browser hydration.
3. Profile fullscreen expansion of the complete graph separately, then use
   attribution to pick the next measured hot path. Do not move work to a second
   request unless it is truly optional, and never allow stale authorization
   decisions.
4. Run full unit, E2E, and relevant browser suites after implementation, then
   repeat the same load probes. Keep the real 1-vCPU capacity claim open until
   measured on that budget. Re-run the serving soak after future performance
   changes; current response and app CPU samples are not a paired comparison.

## Product decision

The root route is the workspace. Preserve the resource tree, document navigation,
search, graph, and backlinks. Improve initial render cost by loading expensive
workspace views only when the user needs them, while ensuring every response is
filtered for that viewer and permission changes take effect correctly.
