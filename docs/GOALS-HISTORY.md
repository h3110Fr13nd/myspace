# Product and Engineering Goal

**Status:** Historical progress log; current targets and status are in [GOALS.md](GOALS.md)  
**Last reviewed:** 2026-11-12
**Applies to:** the FOSS Content Workspace application and its default runtime

## Outcome

Deliver a dependable, understandable, and maintainable multi-user knowledge
workspace that preserves its useful authoring, publishing, search, access
control, canvas, and sync workflows while serving a modest deployment of **10–100
active users** on a host budget of **1 GiB RAM and 1 vCPU**.

The product should be easy to operate and extend. Prefer the smallest complete
design that solves a real user need. Keep code modular where ownership or change
boundaries benefit from it; avoid abstractions, dependencies, background work,
and services that do not earn their maintenance and resource cost.

## Runtime budget

The normal `docker compose up` application stack is the supported constrained
deployment. Its five resident services have explicit hard limits totaling no
more than **832 MiB** and **1.0 CPU**:

| Service | Memory ceiling | CPU ceiling | Role |
|---|---:|---:|---|
| App | 256 MiB | 0.40 | Astro SSR, APIs, UI |
| PostgreSQL | 256 MiB | 0.25 | Durable application data and OpenFGA datastore |
| OpenFGA | 96 MiB | 0.10 | Relationship-based authorization |
| Meilisearch | 160 MiB | 0.15 | Full-text search |
| Valkey | 64 MiB | 0.10 | Cache, sessions, rate limits, optional jobs |
| **Total** | **832 MiB** | **1.00** | Reserves 192 MiB for host OS and container runtime |

These are ceilings, not performance claims. Real capacity must be measured with
representative content, permission complexity, and concurrent requests. The
192 MiB host reserve covers the OS and container runtime. Only the five resident
default serving services count against this shared budget. Optional `infra`,
`local-offline`, `tunnel`, and observability profiles are outside it and are not
required to serve requests; if enabled locally or operationally, their use is
accounted for separately. Build steps and restore drills are also not in the
steady-state runtime budget.

**CPU pressure is a separate success measure.** A 1 vCPU cap does not make a
busy service efficient; it only limits its share. For the default stack, aim for
host CPU PSI `some avg10` below 5% while idle and below 10% during representative
steady use. Any sustained value above that is an optimization issue even when
containers remain within their quotas. Measure with the constrained host and
record request latency alongside PSI so reducing CPU does not hide broken or
starved user requests. Optional tracing should be sampled; use 100% only for a
short, focused diagnosis.

## Product and engineering principles

1. **Keep working user workflows intact.** Before removing or disabling a
   feature, identify who uses it, its persisted data, dependencies, and a safe
   migration or replacement path.
2. **Make the common path cheap.** Keep expensive rendering, search indexing,
   graph work, file conversion, and network calls off hot request paths where
   the existing product contract allows it. Bound caches, queues, pools, and
   request concurrency.
3. **Use one clear source of truth.** Prefer canonical registries, schemas,
   tokens, and shared components over duplicated metadata or divergent plans.
4. **Keep modules legible.** Names should explain intent; files should have a
   clear responsibility; abstractions should remove actual duplication or
   complexity, not add indirection.
5. **Make failures understandable.** Optional services may degrade only where
   that preserves correct behavior. Authorization, persistence, and other
   correctness boundaries must fail closed and report actionable errors.
6. **Treat UI issues as product issues.** Navigation, labels, feedback, empty
   states, loading, errors, and responsive behavior should be predictable and
   follow `docs/design-system.md`.
7. **Prefer evidence over scale theater.** Optimize measured hot paths for this
   target. Defer million-user architecture and services until requirements or
   measurements justify them.

## Feature and plan hygiene

Before new feature work, reconcile `plan/`, `docs/plans/`, route/component
implementations, and runtime flags:

- Mark a plan item complete only when the behavior exists and is reachable.
- Mark implemented-but-unreachable behavior as an integration task.
- Mark intentionally unused behavior as deferred with a reason and owner/trigger.
- Retire duplicate or superseded plans by linking them to the surviving source;
  preserve useful history rather than deleting it casually.
- Do not expand a feature until its user journey, failure states, and resource
  cost are understood.

Quartz under `inspiration/quartz` is a reference for clear boundaries and a
composable content pipeline. Borrow the structural lessons that fit this
server-rendered, permission-aware product; do not copy Quartz's static-public
content assumptions into private resource paths.

## Priority order

1. Protect correctness, data, authorization, and operability.
2. Bound and measure the default runtime; fix demonstrable CPU/memory hotspots.
3. Fix confusing or broken user journeys and finish or explicitly defer
   currently exposed features.
4. Simplify duplicated, dead, or hard-to-follow code without broad rewrites.
5. Add capabilities only when they support the product outcome above.

## Completion criteria

A change is ready when it:

- preserves the relevant existing workflow and data contracts;
- follows the project design system for UI changes;
- has clear failure behavior and no unnecessary always-on work;
- fits within the runtime budgets or documents and measures the exception;
- updates the canonical plan/status so implemented work is not left looking
  unfinished; and
- has appropriate verification recorded (or a concrete reason verification
  could not run).

## Current baseline and next work

- Default Compose currently contains the five services above with hard resource
  ceilings in `docker-compose.yml`.
- On 2026-11-10, `docker compose up -d` started the default stack after removing
  an unnecessary external-network prerequisite. `docker inspect` confirmed the
  declared per-container limits. A startup snapshot showed about 299 MiB across
  those five containers (app 153 MiB); this is an early idle snapshot, not a
  10–100-user capacity result. Host CPU PSI `some avg10` was 4.68% during that
  short sample with unrelated workloads also running, so app-attributable
  pressure remains unmeasured. The refreshed production image is healthy:
  `/api/v1/health` reported all required dependencies healthy, and the homepage
  returned HTTP 200. An idle `docker stats` snapshot showed about 153 MiB across
  the five serving containers (app 70 MiB, PostgreSQL 39 MiB, OpenFGA 25 MiB,
  Meilisearch 12 MiB, Valkey 7 MiB); observed CPU was below 1% per service.
  This brief sample does not establish sustained CPU pressure or capacity. The
  homepage took 4.02 seconds in this cold-ish probe, so cold-path latency remains
  a concern.
- A later idle snapshot showed about 145 MiB across the serving containers;
  app cgroup CPU PSI was 0.00% and host PSI was 0.73% while optional profiles
  and unrelated workloads were also present. PostgreSQL and Valkey showed brief
  sub-3% cgroup `some avg10` waits. These snapshots are diagnostic only and do
  not establish concurrent-user capacity.
- The production app image now builds with an 803 KiB context (previously about
  890 MiB) because content is supplied by the Compose volume and plans/tests are
  not runtime image inputs. The production image was restarted and its health
  endpoint confirmed database, OpenFGA, and Redis healthy. The image build also
  exposed and fixed a root-level Astro/cookie version collision by declaring
  `cookie` 2.x explicitly; compile-only verification would not have caught the
  Node startup crash.
- A production homepage probe found a real cold-listing bottleneck: the database
  has 939 resources, only 16 public audience candidates, but the anonymous
  homepage checked the entire table. OpenFGA opened 28 idle PostgreSQL sessions
  against the 30-connection limit and the page returned no headers within 15s.
  The listing now uses the fresh effective-ACL projection only to prefilter
  candidates, then still checks every non-owner candidate against OpenFGA; stale
  or unavailable projection falls back to the full scan. The listing query now
  fetches only those candidates and their ancestor folders. The measured public
  candidate set is 16 resources plus 8 containers. OpenFGA/PostgreSQL concurrency
  and pool limits were tightened. The rebuilt production app returned healthy
  and database sessions stayed below the 30-connection limit.
- A small production Compose burst test returned HTTP 200 for every homepage
  request after the listing query was narrowed and memory ceilings reduced: 10
  concurrent warm-cache requests completed in 0.76s (p95 737ms), while 100
  concurrent warm-cache anonymous requests completed in 5.74s (p95 5.70s). The
  first request after service restart took 3.65s. After the 100-request burst,
  the five serving containers used about 203 MiB total; app cgroup CPU PSI
  `some avg10` was 6.65% and host CPU PSI was 6.51%. These are short-window
  samples, not a sustained load profile. This is only the anonymous homepage on
  a 16-logical-CPU host with per-container caps, not 10–100 distinct
  authenticated users or a one-vCPU host. The 100-request latency remains high
  and does not prove the capacity goal.
- The local machine has 16 logical CPUs, so it cannot validate one-vCPU
  contention. Per-container limits are applied. The anonymous homepage burst
  above is not a representative authenticated or sustained 10–100-user load
  test. Docker builds are a separate, one-time operational workload and are
  outside the steady serving budget.
- Verification now passes: unit suite 665/665, full E2E 65/65, canvas browser
  suite 68/68, `npx tsc --noEmit`, and `npm run build`. E2E fixtures now use
  isolated editor documents and local OAuth/collaboration endpoints, avoiding
  external auth traffic and cross-test mutation of public search fixtures. A
  canonical short-ID resource URL resolver is covered by the search journey.
- Added a bounded, 10-second positive identity lookup cache with in-flight
  coalescing. It caches only account-id resolution, never permissions; this
  bounds externally deleted-account session staleness to 10 seconds. Added the
  dependency-free `scripts/perf-smoke.mjs` probe for repeatable authenticated
  full-response timing under the Compose service caps. Run it with local
  credentials only; it never prints them.
- Load probing exposed first-use work and repeated authorization checks across
  accounts. The ACL candidate query now returns fresh wildcard-viewer hints;
  OpenFGA verifies those resources once as `user:*`, coalesces identical
  in-flight batches, and the listing falls back to the actual user for every
  denial or missing result. The projection still cannot grant access. Graph
  topology construction now indexes parents and exact slugs instead of scanning
  all resources repeatedly; exact slugs also win over accidental substring
  collisions.
- A stale ACL projection caused the listing prefilter to fall back to checking
  all 939 resources. Reconciliation used `pool.query()` for `BEGIN`, writes, and
  `COMMIT`, which does not pin those statements to one PostgreSQL connection.
  It now checks out one client for the whole replace transaction. After restart,
  reconciliation completed with 4,359 rows and `stale=false`. The authenticated
  single-account sweep then returned HTTP 200 at all tested levels: the first
  post-restart p95 was 4.10 s, 896 ms at concurrency 10, and 5.39 s at
  concurrency 100. An immediate warm repeat measured 72 ms at concurrency 1,
  996 ms at 10, and 4.79 s at 100. The 100-request run is a short burst on a
  16-logical-CPU host under per-service quotas, not a sustained one-vCPU test.
  App cgroup PSI `some avg10` reached 7.92% after the first sweep and 11.80%
  after the second. Container memory after the sweeps totaled about 320 MiB
  (app 144, PostgreSQL 78, OpenFGA 74, Meilisearch 15, Valkey 10 MiB). Keep
  investigating first-request and 100-way latency and validate on a real
  one-vCPU host.
- The homepage now holds one PostgreSQL pool connection while it runs the
  existing ACL candidate query and resource/ancestor query. A single merged
  recursive SQL experiment increased 100-request p95 to 13.1 s and was
  discarded. With the projection confirmed fresh (4,359 rows; this account
  selects 25 resources, including 16 wildcard candidates), the retained
  two-query path returned all HTTP 200: first sweep p95 was 789 ms at 10 and
  5.59 s at 100; an immediate warm repeat was 595 ms at 10 and 4.20 s at 100.
  A targeted stale-state check also returned all 939 resources with zero
  wildcard hints, then restored the projection state to fresh; this confirms
  the fallback remains complete and does not reuse stale hints.
  After two 100-request bursts, app cgroup CPU PSI `some avg10` was 13.28% and
  the five serving containers used about 300 MiB. This reduces queue handoffs
  and warm latency, but burst pressure remains above the <10% target; the local
  host has 16 logical CPUs and does not prove 1-vCPU capacity.
- The ancestor lookup now starts from candidate parent IDs and stored path
  segments, then follows indexed parent IDs. This avoids the recursive
  `OR`-join plan that was suspected of scanning resources repeatedly. On the
  live fresh projection, the new listing produced the same 24 anonymous
  candidate resource IDs as the previous ancestor-walk shape (zero missing or
  extra). TypeScript and all 656 unit tests pass; the production image rebuilt,
  the homepage returned 200, health checks were green, and projection state
  remained fresh (4,359 rows). This query change has not yet had an authenticated
  concurrency sweep, so no CPU or latency improvement is claimed. The local
  load-test credentials were not configured for this run. After the rebuild,
  the full Playwright E2E suite passed 61/61; `git diff --check` and Compose
  configuration validation also passed.
- A CPU profile of 100 concurrent anonymous homepage requests showed repeated
  Shiki `codeToHast` work and substantial garbage collection. The highlighter
  now caches only the rendered syntax HTML (bounded to about 1 MB / 256 entries)
  and coalesces identical in-flight blocks; viewer-independent highlighting is
  cached while the per-render markup is assembled normally. The previous
  profile sampled `codeToHast` 6 times in 1,281 samples; a post-cache profile
  sampled it zero times in 1,289. A warm anonymous sweep measured p95 572 ms at
  10 concurrent and 3.89 s at 100, versus the pre-cache sweep's 876 ms and
  4.98 s. All returned HTTP 200. A separate isolated 100-request run used
  about 1.62 CPU seconds total (16 ms/request) under the 0.40 CPU app limit;
  app PSI rose from 0.69% to 6.40% avg10 over that burst. Back-to-back 1/10/100
  sweeps still raised PSI to 16.33%, and the later profile remained GC-heavy,
  so this is a measured improvement candidate, not proof the CPU-pressure goal
  is met. These anonymous bursts on the 16-logical-CPU host do not represent
  distinct signed-in users or a sustained 1-vCPU deployment.
- A closed-loop read soak kept 10 anonymous workers continuously requesting the
  homepage for 60 seconds. It completed 2,309 requests (all HTTP 200), with
  p50 200 ms, p95 496 ms, p99 592 ms, and max 1,004 ms. The app reached its
  0.40-CPU limit; app cgroup PSI `some avg10` rose from 0.00% before the run to
  31.68% at completion. A sampled `docker stats` snapshot during the run showed
  about 130 MiB app memory and 235 MiB across the five serving services. This
  workload intentionally keeps every worker busy (roughly 38 requests/s), so it
  is a saturation test rather than a realistic think-time model. It confirms
  the stack stays within memory limits, but CPU pressure still fails the goal
  under sustained hot-read traffic. The local host has 16 logical CPUs, so it
  cannot validate real one-vCPU scheduling behavior.
- A second read soak modeled 100 anonymous virtual users with a 10-second
  think time and staggered starts. It completed 599 requests during the 60-second
  load window (about 10 requests/s, all HTTP 200; workers then drained their
  final think-time delay), with p50 12 ms, p95 60 ms, p99 134 ms, and
  max 174 ms. App CPU use increased by about 9.8 seconds over the run (about
  16% of one core during the load window, or 41% of the app's 0.40-CPU ceiling);
  app cgroup PSI peaked
  around 3.9% avg10 and finished at 3.45%. A mid-run memory sample showed about
  214 MiB across the five serving services. This is a warm, anonymous workload
  on a 16-logical-CPU host with the full Compose CPU quotas applied; it does not
  prove authenticated-user capacity or real one-vCPU host contention. The
  repeatable runner is `scripts/perf-soak.mjs` (`LOAD_USERS`,
  `LOAD_DURATION_SECONDS`, and `LOAD_THINK_MS` configure the model).
- A 100-response heap-allocation sample after the bounded highlighter cache
  showed Astro island serialization (`generateHydrateScript`) as a measurable
  allocation site (about 164 KiB total across the sample); the graph island
  serialized about 9.4 KiB of props and the folder tree about 8.2 KiB. These
  datasets retain the complete searchable fullscreen graph and expandable
  folder tree. The sample alone does not show that removing or deferring either
  feature would materially reduce CPU pressure, so keep their payloads intact
  until a before/after request CPU profile demonstrates a worthwhile gain.
  The temporary Node inspector was closed by restarting the app; health and
  homepage probes returned healthy / HTTP 200 afterward.
- A 100-way authenticated profile attributed about 1.81 CPU seconds of a
  5.40-second profile to garbage collection; Marked parsing accounted for
  about 161 ms. The render pipeline now keeps a bounded 1 MB / 64-entry LRU
  cache for deterministic top-level Markdown output and coalesces matching
  in-flight renders. It bypasses content with embeds, citations, dynamic Bases
  or Dataview blocks, nested renders, and explicit file-path imports. This keeps
  user-dependent and live rendering on the original path. The focused unit
  test verifies concurrent coalescing and subsequent cache reuse.
- After a production rebuild, a warmed authenticated burst of 100 requests to
  one account returned all HTTP 200 at p95 3.60 s. App CPU increased by 1.58
  CPU seconds total (about 15.8 ms/request), and app PSI `some avg10` ended at
  7.34%. In a CPU profile collected after warming the render cache, Marked
  parsing was no longer a leading frame; garbage collection remained high
  (about 1.85 CPU seconds of a 5.59-second profiled interval), with database
  query and Astro prop serialization next. The inspector overhead makes that
  profiled latency unsuitable for a direct latency comparison. A preceding
  1/10/30/100 sweep included a 4.00-second cold single request; the 100-way
  step measured p95 4.00 s, and combined app PSI `some avg10` ended at 24.30%.
  These mixed cold/warm and sequential samples show the cache is a promising
  hot-render reduction, but repeated bursts can still exceed the CPU-pressure
  goal. They use one test account and a 16-logical-CPU host, so do not prove a
  representative 10–100-user or real one-vCPU outcome.
- The active authenticated document's configured and fallback file paths were
  both absent, so `resolveDocumentFilePath()` recursively traversed the content
  tree on every request looking for a same-slug file. A diagnostic matching
  that resolver path scanned 1,272 directory entries and took 4.48 ms before
  returning a miss. The resolver now keeps a bounded 512-entry path cache,
  rechecks successful paths for deletion, and retries misses after one second
  so newly synced files appear promptly. Its unit test adds a file during the
  miss window and verifies it is found after expiry.
- The production image containing both caches passed another authenticated
  100-user think-time soak: 600 requests in 60 seconds, all HTTP 200, at 10
  requests/s; p50 13 ms, p95 60 ms, p99 95 ms, max 160 ms. App CPU increased by
  9.70 seconds (about 16% of one core), app PSI `some avg10` ended at 2.86% and
  stayed around 2.0–4.0% during the run, and app cgroup memory peaked near
  181 MiB. A post-run Docker stats snapshot showed about 235 MiB across the five
  serving services. The run followed an authenticated warm-up and used one
  account; the earlier 589-request run reached 21.38 CPU seconds, p95 570 ms,
  and PSI 24.18%. Because authorization caches and host load differed between
  runs, this is encouraging evidence for the current warm path, not a clean
  causal before/after comparison or proof of 100 distinct users.
- The soak runner now accepts an optional `LOAD_EMAIL` / `LOAD_PASSWORD` pair
  to exercise authenticated SSR while keeping credentials out of its output;
  omitting both continues to run the anonymous workload. Current verification
  after the render and path cache changes: TypeScript passes, production build
  passes, all 660 unit tests pass, full E2E passes 61/61, and canvas browser
  coverage passes 68/68. The production app was rebuilt and health checks were
  green after deployment.
- The heap allocation sample also showed temporary allocation in the
  permission-tree ancestor walk. The implementation now scans stored path
  segments backwards rather than allocating `split()` and `filter()` arrays;
  unit coverage includes trailing slashes and duplicate parent IDs. The full
  E2E suite passed 61/61 after the implementation. No standalone CPU reduction
  is attributed to this small change.
- The search control was visibly rendered before its idle-hydrated handlers
  were ready, making early typing vulnerable to lost input. Both responsive
  placements now use `client:visible`, so the active placement hydrates when it
  enters view and the hidden duplicate stays unloaded. It exposes readiness for
  reliable tests and combobox/listbox semantics. The focused search E2E suite
  passed 6/6 and the full suite passed 61/61.
- The historical scale checklist and Quartz comparison both contained stale
  claims or unverified feature gaps. Their headers now state that they are
  non-binding inventories and defer product/runtime priorities to this file;
  known existing Meilisearch search, wikilink previews, folder routes, and tag
  routes are called out so the old wishlists are not mistaken for missing
  functionality.
- Before the projection transaction fix below, the dependency-free
  `scripts/perf-smoke.mjs` probe measured full responses. A burst from 28
  distinct existing accounts
  returned HTTP 200 for all requests: the first run after app restart had p95
  6.50 s; an immediate warm repeat had p95 2.50 s. App cgroup CPU PSI
  `some avg10` reached 20.59% after the two back-to-back bursts. The five
  serving containers used about 318 MiB after the load. A cold profile showed
  runtime module/WASM compilation and garbage collection; a warm profile no
  longer listed `buildGraphData` among its hot functions after the indexing
  change. The burst is still too slow and the pressure sample exceeds the
  target; this does not establish the 10–100-user goal. After restarting the
  production image, the idle serving stack used about 144 MiB, and health
  reported PostgreSQL, OpenFGA, and Valkey healthy.
  Reproduce the single-account timing with:

  ```sh
  LOAD_EMAIL=... LOAD_PASSWORD=... node scripts/perf-smoke.mjs
  ```

  Sample app pressure with `docker exec workspace_app cat /sys/fs/cgroup/cpu.pressure`
  and memory with `docker stats` immediately before and after.
- The Hallmark-guided UI review removed the duplicate resource heading, replaced
  emoji-only controls with labeled/icon controls, and changed the mobile explorer
  disclosure to a semantic button with expanded state. Code highlighting now
  uses the light Shiki palette in light mode; a browser computed-style check
  confirmed readable dark text against the code surface. The final production
  image returned HTTP 200 and health reported database, OpenFGA, and Valkey
  healthy. Focused public/private/draft rendering E2E checks passed 3/3.
- Compose tracing now samples 5% by default when a collector is running; raise
  `OTEL_TRACES_SAMPLER_ARG` temporarily for a focused trace capture.
- The scale plans contain stale checkboxes and competing long-range ambitions.
  Reconcile their Phase 1 state against the code before using them to justify new
  services or dependencies. Optional profiles, including observability, are
  excluded from the constrained serving budget and may be run independently.
- ACL reads and writes are batched around OpenFGA checks, wildcard checks are
  shared across signed-in listings, and graph building uses indexed lookups.
  Unit, full E2E, and canvas browser suites pass. Authenticated bursts still
  show high cold-load latency and CPU pressure above target; continue profiling
  those paths before changing concurrency limits or adding caches that could
  delay revocation.
- Added bounded in-flight coalescing for repeated single-resource OpenFGA
  permission checks. This complements batch coalescing without caching
  decisions; the key includes authorization write generation, and the map is
  capped at 256 pending checks. Unit coverage confirms 25 simultaneous
  identical checks make one engine call. The latest aged-cache 100-request
  authenticated same-account burst still returned all 200 responses but had
  p95 latency around 12.2 seconds and app CPU PSI near 19–22% across cold and
  immediate warm runs. Those runs followed a long browser suite and are
  affected by host load, so they do not isolate the change's effect. They do
  confirm that the 100-way cold/warm burst target remains unmet. The 10
  requests/second think-time soak remains materially better (about 16% of one
  core, 2–4% app PSI), but is one account on a 16-core host. Keep the CPU PSI
  and 100-way latency criteria open; do not present the 1-vCPU/100-user goal as
  achieved.
- Next: repeat the authenticated probe against representative content and
  distinct users on an actual one-vCPU host, then profile and improve cold
  authorization/listing latency. Keep the 10–100-user target open until
  sustained latency, CPU PSI, and memory meet the stated goals. Host PSI from
  this 16-CPU machine includes unrelated workload and is not app-attributable.
- A local anonymous CPU profile of 40 simultaneous homepage responses took
  2.47 seconds and recorded 463 profiler samples. Garbage collection accounted
  for 81 samples; Astro prop serialization appeared in 5. This profile did not
  include authenticated authorization or report cgroup PSI, so it is diagnostic
  only and cannot establish the CPU-pressure target. Graph topology now memoizes
  repeated wikilink target resolution within a build, preserving canonical
  slug/id precedence and the legacy first substring match while avoiding
  repeated full-resource scans for duplicate targets. The 3 focused topology
  tests pass. A synthetic 1,000-resource dataset with 20,000 repeated unresolved
  legacy references took 24.7 ms for five full graph builds with memoization;
  the previous repeated-scan resolution loop alone took 430.4 ms. This isolates
  a favorable duplicate-reference case, not a representative production CPU
  result, and does not establish the capacity goal.
  Production build, TypeScript, full E2E (63/63), full unit suite (665/665),
  and canvas browser suite (68/68) pass; the canvas dev suite continues to log
  a non-fatal Vite dynamic-import warning while its studio tests pass.
- Plan hygiene audit corrected two stale status records: homepage corpus
  scaling is now marked investigated with current candidate-prefilter behavior
  and load evidence; the E2E plan/index now reflect 63/63 local passes while
  leaving CI execution open. The SEO plan now distinguishes shipped metadata
  head/OG/feed/sitemap paths from metadata validation,
  deferred static OG generation, and the unsupported dedicated Todos workflow.
  Shared create, save, and vault-sync write paths now validate metadata while
  preserving extension fields. A read-only compatibility pass validated all
  862 current Markdown/MDX files using importer-shaped metadata after aligning
  nullable OG images and public/private tiers. Migration `0014_scoped_tags`
  adds the scoped columns already expected by the importer and preserves
  existing tags in the default workspace scope. The importer E2E caught and
  verified this real schema drift. Save now treats submitted empty tags,
  summaries, and extracted links as deliberate clears. Four schema unit tests
  pass; build, TypeScript, the full unit suite (665/665), and E2E (63/63) pass.
  Validation runs on writes, not page reads.
- After rebuilding and restarting the app, the five serving containers were
  healthy and used about 266 MiB combined (app 151, PostgreSQL 48, OpenFGA 47,
  Meilisearch 16, Valkey 4.5 MiB). One instantaneous `docker stats` sample showed
  under 1% CPU per service; this is an idle snapshot, not a load or 1-vCPU
  capacity result. Optional observability containers were not included.
- The persistent local Compose database has no `_schema_migrations` ledger, so
  the app does not auto-apply project SQL migrations on startup. Migration
  `0014_scoped_tags` was applied directly with its idempotent SQL to this
  database; the fresh-container E2E migration path also passes. Treat migration
  deployment as an explicit operational step until a safe baseline/runner is
  established; do not assume rebuilding or restarting the app applies SQL.
- After the latest image restart and homepage/health probes, the five serving
  containers used about 189 MiB combined (app 103, PostgreSQL 36, OpenFGA 31,
  Meilisearch 16, Valkey 4 MiB). The sample showed less than 1% CPU per service;
  it is a brief light-traffic snapshot and does not change the unmet burst or
  real 1-vCPU capacity status.
- Folder pages and both tag routes now reuse `listWorkspaceResourceCandidates`,
  the ACL projection prefilter already used by the homepage. Folder pages reuse
  one permission-filtered result for the explorer and listing body instead of
  reading the full resource table twice and checking overlapping rows twice.
  Tag pages and the tag index no longer issue their own full-vault read/check;
  tag pages now match exact case-insensitive labels (including legacy
  comma-separated tag strings), rather than arbitrary substrings. E2E coverage
  verifies exact matching and excludes private results. On the current local DB,
  the projection is fresh and the anonymous candidate query narrows 939 rows to
  16 ACL candidates (plus the required ancestor folders); stale projection still
  falls back to the full scan for correctness.
- Added `LOAD_PATH` to `scripts/perf-soak.mjs` and tested the production Compose
  image under its existing per-service CPU quotas. For each of `/tags/test`,
  `/folders/folder%3Atestpassword_root%2Fnotes`, and `/tags`, 100 anonymous
  virtual users at 10-second think time completed 600 requests in 60 seconds;
  every response was HTTP 200. Their p95 latencies were 32 ms, 18 ms, and 11 ms
  respectively. Sampled app memory peaked around 184 MiB; the five services
  together were around 272 MiB at the sampled peak. App cgroup PSI ended at
  1.37% after the first route and 0.85% after the final route (avg10). These are
  warm anonymous requests on a 16-logical-CPU host, not authenticated distinct
  users or proof of physical 1-vCPU capacity. The home route's cold request
  after restart still took about 4.09 seconds and briefly raised app PSI, so
  cold-start/page cost remains open.
- Current verification: TypeScript, production build, all 665 unit tests, and
  all 65 E2E tests pass. The rebuilt Compose app is healthy and its health route
  returns HTTP 200. The 10–100-user CPU target remains active; next validate
  authenticated distinct-user traffic and the local single-core results on an
  actual 1-vCPU host, then continue profiling any path that exceeds the PSI or
  latency goals.
- To approximate single-vCPU scheduling on this 16-CPU host, the five serving
  containers were temporarily pinned together to CPU 9; their configured CPU
  quotas still summed to exactly 1.0 vCPU and no optional observability service
  was included. A 100-user, 10-second-think-time homepage soak completed 600/600
  HTTP 200 responses at 10 requests/s. The first homepage-cold run had p50 16 ms,
  p95 402 ms, p99 2.20 s, max 2.41 s, and app cgroup `some avg10` peaked at
  21.46% early in cache warm-up (later samples declined to 6.65%). An immediate
  warm repeat completed 600/600 with p50 13 ms, p95 58 ms, p99 100 ms, max
  156 ms. App CPU usage increased by about 8.0 seconds over the 60-second warm
  window (~13% of one core); app cgroup `some avg10` ended at 6.00% and `full`
  at 2.27%. Sampled memory during the warm test was about 232 MiB across all
  five services (app 138 MiB). This is stronger single-core scheduling evidence
  for a warm anonymous homepage than the prior 16-core runs, but it is not a
  real one-vCPU VM and does not cover authenticated users. The initial cache
  pressure and tail latency remain optimization targets. Container affinity
  was restored to all currently available CPUs (0–15) after the experiment;
  per-service Compose quotas remain unchanged.
- After the Mermaid dynamic-import change, a follow-up homepage request on a
  freshly restarted app process returned HTTP 200 in 20 ms. Its V8 CPU profile
  contained 21 samples and about 216 ms of profiled wall time (including idle
  time); Mermaid did not appear among sampled functions. This is a small,
  single-request sample after the app health checks had completed, so it is not
  directly comparable to the earlier 3.7–4.1 second first-start probes and does
  not settle cold-start cost. Continue to keep diagram rendering lazy and repeat
  first-boot measurements under controlled single-core conditions.
- Latest verified source state: TypeScript and production build passed, with
  666/666 unit tests and 66/66 E2E tests passing. The image built from that
  source is running healthy in Compose. Optional observability containers are
  running locally for diagnosis, but are excluded from the serving budget and
  all capacity figures above.
- Hallmark's app-surface audit was run against the current routes/components;
  its baseline findings are saved in `.hallmark/before.txt` and source inventory
  in `.hallmark/before.json`. The static scan reports 470 FAIL, 46 REFLEX, and
  26 WARN across 125 files, so this is a backlog signal, not a claim that every
  finding is a confirmed defect. Desktop and phone captures are in
  `.hallmark/audit-desktop.png` and `.hallmark/audit-phone.png`. The audit
  exposed horizontal overflow clipping implemented with `hidden`; replaced
  the document-level rule with `overflow-x: clip` for both `html` and `body`.
  TypeScript and the production build pass after this change. Next UI pass
  should prioritize keyboard focus visibility, mobile code/table overflow, and
  reducing nested borders in the resource reader, validating each targeted
  slice against the design-system tokens and real screenshots.
- The constrained Compose default now sets `OTEL_ENABLED=false`: the optional
  infra profile can run outside the serving budget, while app-side tracing is
  also opt-in (`OTEL_ENABLED=true`) so normal serving does not instrument every
  HTTP, PostgreSQL, Redis, and outbound request. The observability plan was
  updated to match. With the same five serving containers pinned to one host
  core, the 100-user, 10-second-think-time anonymous homepage run before this
  change completed 599/599 requests (p95 714 ms, p99 2.91 s); after it, 600/600
  (p95 496 ms, p99 2.59 s). App cgroup PSI was still about 8.6% `some` and 3.9%
  `full` at the end of the second run, so tracing opt-out did not remove CPU
  contention. These short runs suggest a modest latency improvement but are
  not a controlled CPU-use comparison; authenticated traffic and real 1-vCPU
  capacity remain unverified. Affinity was restored to CPUs 0–15.
- Revalidation after the opt-in tracing change passed the full unit suite
  (666/666), E2E suite (66/66), canvas browser suite (68/68), and TypeScript
  check. `npm run build`, Compose config validation, and app health also pass.
  The running app reports `OTEL_ENABLED=false`, and all five serving containers
  are restored to CPUs 0–15 with their budgeted per-service caps.
- Continued the reader UI pass using the captured Hallmark baseline. Shared
  prose styles now keep Shiki's inner `<pre>` from drawing a second border,
  reserve space so the copy action does not cover code, keep copy visible for
  touch/keyboard users, prevent identifiers from wrapping mid-token in tables,
  and use clipped rather than hidden horizontal overflow for prose. Added
  `tests/e2e/content/reader-mobile.spec.ts` to verify the touch layout, scrollable
  table, single code border, clear copy button, and no page-level horizontal
  overflow. Production capture at 390 px confirms a 390 px document width, a
  308 px table viewport with 717 px scrollable content, one code border, and
  code text beginning below the copy control; desktop remains 1440 px wide with
  no document overflow. Captures are `.hallmark/reader-after-phone.png` and
  `.hallmark/reader-after-desktop.png`.
- Latest full verification after these changes: 666/666 unit tests, 67/67 E2E
  tests, TypeScript, and production build passed. The focused reader E2E passed,
  and the production Compose image was rebuilt and its health endpoint returned
  HTTP 200 with database, OpenFGA, and Redis healthy. Capacity optimization,
  authenticated load, and broader Hallmark issues remain active work.
- Hallmark keyboard-focus findings were addressed centrally in the primitive
  stylesheet: native links, controls, summaries, editable surfaces, and custom
  tab stops receive a 2 px theme-aware focus outline. Component-specific
  `outline: none` rules in buttons, inputs, the dropzone, appearance tabs, and
  viewer editor were reconciled so they preserve that indication. A new E2E
  check tabs from email to password and verifies the ring in dark and light
  themes. It passed in the full suite; production-browser verification reports
  a solid 2 px ring in both themes (`--text-primary` resolves to light text on
  dark and dark text on light). Latest verification: 666/666 unit, 68/68 E2E,
  and 68/68 canvas browser tests; TypeScript and build pass. The canvas browser
  suite was rerun alone after a parallel Vite build invalidated its dev-server
  dependency cache and caused two studio timeouts; the isolated run passed all
  68 tests. The production image was rebuilt and is healthy with all serving
  container CPU affinities restored.
- A 65-second V8 profile during the warm 100-user homepage soak showed the
  process idle for about 45 seconds, GC for 6.45 seconds, Astro prop
  serialization for about 1 second, and graph topology construction for 0.25
  seconds. The workspace contains 939 resources, so per-request tree and graph
  work remains scale-sensitive, but the profile does not show graph building
  as the dominant cost. Replaced the visibility filter's repeated
  `Array.shift()` ancestor traversal with a linear cursor, and removed an
  unused graph mount-state update. TypeScript, 22 focused permission/tree
  tests, and the production build pass.
- Rebuilt the production image and repeated the 100-user, 10-second-think-time
  anonymous homepage soak with the five serving containers sharing one host
  core and retaining their combined one-vCPU quota. It returned 599/599 HTTP
  200 responses at 9.98 requests/s; p50 was 17 ms, p95 684 ms, p99 2.88 s,
  max 3.20 s. App CPU usage rose by about 9 seconds over the 60-second test;
  cgroup pressure ended at 10.88% `some avg10` and 4.39% `full avg10`, slightly
  above the steady-use target. The five services used about 255 MiB together
  (app 117 MiB). These figures do not show a clear latency gain from the small
  cleanup; further optimization should target request fan-out and serialization
  with authenticated workloads before claiming success. Container affinity
  was restored to CPUs 0–15. The optional observability profile is excluded
  from the serving budget; local diagnostic services were running separately
  during measurement.
- A 25-second profile under a saturated 100-client anonymous loop (about
  34 requests/s) attributed roughly 9.45 seconds to V8 garbage collection,
  2.45 seconds to socket writes, 0.80 seconds to `ContentMeta` date formatting,
  and about 1 second to Astro prop serialization. Moved the reusable en-US date
  formatter into a shared module singleton and used it in both content metadata
  and the properties panel. The function now avoids constructing two date
  formatters per page render. This is a targeted allocation reduction; the
  subsequent stress run was too noisy to claim an overall latency improvement.
- Full post-change verification passed: 669/669 unit tests, 68/68 E2E tests,
  68/68 canvas browser tests, TypeScript, and the production build. A follow-up
  single-core warm run at 100 users with 10-second think time returned 594/594
  HTTP 200 responses (9.87 requests/s, p50 146 ms, p95 381 ms, p99 577 ms).
  App CPU usage rose about 20.5 seconds during the 60-second run; measured
  serving memory was about 241 MiB across five containers (app 149 MiB). The
  PSI sample remained elevated after the preceding saturation runs and local
  host work, so this is not a clean before/after CPU comparison. A separate
  100-client tight loop still saturated the app's 0.40 CPU cap: about 36
  requests/s, p95 4.92 s, app cgroup `some avg10` 83.84%. The app stayed within
  its memory cap. The 10–100-user target therefore remains unproven, especially
  for authenticated traffic; the next pass should reduce SSR allocation/output
  and repeat the same isolated single-core profile before changing quotas.
  Container affinity was restored after each run.
- Removed FolderTree fields the client never reads (`slug`, `isDraft`, and
  leaf-resource `path`) while retaining folder paths, hierarchy, labels, IDs,
  and tree actions. A production response confirms the FolderTree island props
  fell from 8,234 to 4,975 bytes (39.6%); full HTML fell from 68,255 to 64,997
  bytes (4.8%). A unit test locks the payload contract. Final verification on
  this source passed 670/670 unit tests, 68/68 E2E tests, 68/68 canvas browser
  tests, TypeScript, and production build.
- Repeated the warm 100-user homepage run with all five serving containers
  sharing one host core: 600/600 HTTP 200 at 10 requests/s, p50 13 ms, p95 44
  ms, p99 90 ms, max 130 ms. App CPU rose about 7.8 seconds over 60 seconds;
  app cgroup pressure was 7.97% `some avg10` and 1.95% `full avg10`. Serving
  memory was about 264 MiB across the five containers (app 170 MiB). This meets
  the warm anonymous steady-use target in this run; it is not authenticated
  capacity evidence.
- The same 100-client tight loop (1 ms think time) returned 1,248/1,248 HTTP
  200 at 39 requests/s, with p95 2.99 s, p99 3.32 s, and app `some avg10`
  pressure 83.26%. Memory stayed around 311 MiB across the serving containers.
  The small payload reduction did not remove the app's 0.40 CPU saturation at
  this burst rate; continue optimizing SSR and test realistic authenticated
  load. Added mixed-auth support to `scripts/perf-soak.mjs`: `LOAD_AUTH_USERS=1`
  centers one authenticated session among anonymous clients and reports each
  group's status counts. No load credentials are configured locally, so the
  user's real-account mixed run awaits a safe local credential source. The
  optional observability profile remains outside the serving resource budget.
- A bounded file-source cache prototype was removed after a profiled run
  increased `stat` samples without reducing reads; no filesystem cache remains
  in the serving path. The mixed-auth runner rejects `LOAD_AUTH_USERS` without
  credentials instead of silently reporting anonymous traffic.
- The mixed-auth runner now checks `/api/v1/auth/me` after login and requires
  the returned session email to match the requested account before measuring
  pages. Its output includes `authenticatedIdentityVerified`, separate status
  counts, and separate p50/p95/p99/max latency for authenticated and anonymous
  users. A 2-user anonymous smoke run returned 2/2 HTTP 200 and confirmed the
  report shape; the first cold response took 2.9 seconds, while a follow-up
  direct warm homepage request took 16 ms. The real-account branch remains
  unmeasured until credentials are supplied locally.
- The homepage now returns HTTP 503 with `Retry-After: 5` if its resource
  listing fails, instead of silently rendering a built-in article as HTTP 200.
  TypeScript, production build, and all 68 E2E cases passed after this change.
  The zero-accessible-document success path now shows a clear empty message
  inside the workspace, without a fake sample article, resource read control,
  metadata, share target, or empty context panel. The create action remains
  available to signed-in users. TypeScript, production build, and all 68 E2E
  cases passed for the main change; TypeScript passed again after hiding the
  empty context panel. A direct empty-database browser check is still needed.
  The final Compose image was rebuilt and restarted; `/api/v1/health` and `/`
  returned HTTP 200, the app was healthy under its 0.40 CPU / 256 MiB limits,
  and the first homepage request after restart took 3.91 seconds. This cold
  latency remains above the desired user experience and needs profiling.
- The zero-resource UI was verified in an isolated browser run against a fresh
  disposable E2E database after clearing its resource fixtures. Anonymous and
  signed-in sessions both showed the empty heading; the signed-in session kept
  New available and had no share action for a nonexistent resource. The
  isolated case passed 1/1. It is opt-in because it resets fixture resources;
  the normal full E2E suite passed 70/70 with that case skipped. TypeScript
  passed. This closes the direct empty-state verification gap above.
- Added an isolated E2E mixed-load case using the suite's fixture account. It
  verifies login, `/api/v1/auth/me`, one centered authenticated user among two
  anonymous users, HTTP 200 counts for both groups, and separate latency data.
  The focused case passed, then the full E2E suite passed 69/69 with the case
  included. This proves the runner's authenticated branch in the test stack;
  it does not measure the user's real account or 100-user production capacity.
- The graph panel now renders in the browser because its canvas/SVG content is
  produced by client effects. Its SSR React shell was server work on every
  homepage request. The production graph island fell from 11,286 to 9,689
  bytes; full homepage HTML fell from 64,997 to 63,547 bytes. On the same
  Compose app cap and 100-user/10-second-think-time anonymous model, 300/300
  requests returned HTTP 200 at 10 requests/s; p95 was 34 ms versus 65 ms in
  the immediately preceding run, and app `some avg10` ended at 2.22% versus
  2.67%. These short multicore-host runs show a modest direction, not a
  single-core or authenticated capacity proof. A 100-client 1 ms-think-time
  burst still saturated: 1,300/1,300 HTTP 200 at 40.29 requests/s, p95 2.99 s,
  and app `some avg10` 24.40%; its pressure is not comparable to the earlier
  pinned-single-core burst. Focused graph E2E tests passed 3/3, then the full
  E2E suite passed 69/69. The rebuilt Compose app is healthy; a post-burst idle
  sample used about 157 MiB across the five serving containers.
- The workspace intentionally keeps both header and sidebar search controls
  mounted for instant chrome-mode switching. Once both islands hydrate, their
  global Ctrl+K listeners could both focus an input, including the hidden one.
  The handler now ignores a search control with no layout box. A browser E2E
  case switches header → rail, then confirms Ctrl+K focuses the visible input;
  the search E2E file passed 7/7, TypeScript and production build passed. This
  is a navigation correctness fix; it does not claim a CPU reduction. The
  refreshed local Compose app is healthy at its 0.40 CPU / 256 MiB cap, and
  the homepage and dependency health endpoint both returned HTTP 200.
- A live 35-second V8 profile of the 0.40-CPU app during a 100-client tight
  burst sampled 17,378 ticks: 11,745 idle, about 2,500 garbage collection,
  and the remaining active work spread across React SSR, Astro island prop
  serialization, response writes, and PostgreSQL row decoding. The profiling
  run itself returned 739/739 HTTP 200 at 32.95 requests/s with p95 4.68 s;
  profiler overhead makes that a hotspot sample, not a capacity measurement.
  `deriveShortId` and graph topology had few self samples, so no hash cache or
  graph algorithm rewrite is justified by this trace.
- Removed the unused `group` field from graph nodes and its type: graph code
  never read it, but Astro serialized it for every node on every page. The
  production graph island fell from 9,689 to 8,699 bytes and full homepage
  HTML from 63,547 to 62,557 bytes. TypeScript, production build, graph unit
  tests (3/3), and graph E2E tests (3/3) passed. The refreshed Compose app is
  healthy and the temporary Node inspector is closed. A 100-user/10-second-
  think-time follow-up returned 300/300 HTTP 200 at 10 requests/s, p95 64 ms,
  app `some avg10` 1.93%. The prior run's p95 was 34 ms, so these short noisy
  runs do not establish a latency improvement from this small payload change.
- Raea 0.1.0 and its matching agent skill are installed on the development
  machine for Codex, OpenCode, and Agy. It can produce optional video, motion,
  and 3D assets for product communication or content, but is not a web UX audit
  or a serving CPU optimization tool. Keep Raea renders and GPU work outside
  the default Compose serving stack and its 1 vCPU / 1 GiB budget. A small
  standalone TSX composition rendered a 320×180 PNG successfully; no app
  dependency or always-on service was added.
- Repeated the intended 100-user warm homepage model for 60 seconds with all
  five serving containers pinned to one host CPU and their Compose quotas
  retained. The runner completed 599/599 HTTP 200 (9.98 requests/s), p50 16 ms,
  p95 353 ms, p99 2.32 s, max 2.63 s. App cgroup CPU usage increased by 8.50
  seconds (about 14% of one core and 35% of its 0.40-core quota); final app CPU
  pressure was 9.66% `some` and 3.76% `full`. The post-run serving memory
  snapshot totaled about 227 MiB across app, PostgreSQL, OpenFGA, Meilisearch,
  and Valkey. This supports the target steady-use rate on a single pinned core,
  with a long-tail latency issue still visible. It is an anonymous run; no
  account credentials were present in the local environment, so authenticated
  load remains unmeasured until the owner supplies a local `LOAD_EMAIL` /
  `LOAD_PASSWORD` pair. No fixture account is substituted for the owner's
  account.
- Repeated the same single-core workload after the process and caches were
  warm: 600/600 HTTP 200 at 10 requests/s, p50 12 ms, p95 33 ms, p99 89 ms,
  max 119 ms. App CPU increased 7.16 seconds (about 12% of one core); final
  app pressure was 7.31% `some` and 1.87% `full`. Serving memory totaled about
  210 MiB in the final snapshot. This repeat indicates the prior 2.32-second
  p99 was a cold-start outlier, not a steady-use tail. All containers were
  restored to their normal CPU set afterward; the app and health endpoint
  remain healthy.
- Removed the unused `AUDIT_FLUSH` config switch and `audit-flush` job name:
  neither had a consumer, while audit writes already persist to PostgreSQL.
  Production audit writes now rely on migration `0005` instead of issuing
  `CREATE TABLE` / `CREATE INDEX` from the request path; local development keeps
  its table bootstrap. `/readyz` reports audit-table failures as degraded while
  preserving its optional-service readiness policy. Corrected the config
  module's stale claim that every flag defaults off. `npx tsc --noEmit`,
  `npx astro build`, all 670 unit tests, and the full E2E suite passed: 71 passed
  with one destructive empty-workspace case skipped by its opt-in policy. A new
  readiness test covers the migrated audit store. The rebuilt production
  container is healthy; homepage, health, and readiness all return HTTP 200, and
  the serving CPU/memory caps remain unchanged.
- Fixed the wikilink preview API boundary: it now uses `canUserViewResource`
  (including draft and unlisted rules), returns 404 for inaccessible resources,
  and marks preview responses `private, no-store` because embed rendering is
  user-scoped. It also resolves Markdown through the shared document resolver
  instead of a hard-coded `user_demo` directory. Removed preview cache warming:
  it only wrote keys with no reader, blocked the request when the queue was
  disabled, and was the only consumer of the `generate-preview` job. Removed
  that unused worker handler and the inert `START_WORKER` and
  `PUBLIC_CACHE_HEADERS` flags. The standalone worker is now described
  accurately. Four focused preview E2E cases passed (public, private denial,
  draft denial, owner access); after the cleanup, TypeScript/build and all 670
  unit tests passed, and the full E2E suite passed 75 tests with one destructive
  case skipped by policy. This is an authorization and dead-work fix; no CPU
  reduction is claimed without a before/after workload measurement.
- Centralized search-cache invalidation: successful SQL mutations to resources,
  audience/tag/group ACL data, and projection state clear the bounded in-process
  search caches; successful OpenFGA tuple writes and projection replacement do
  the same. This closes the stale per-user search-index window after a grant,
  revoke, or resource mutation. Added unit coverage for the mutation classifier
  and all cache namespaces, plus an E2E case proving a newly created resource
  appears immediately after an index cache hit. ACL projection now indexes
  parent edges once and walks with a head-index queue; this removes repeated full
  tuple scans, an unused child map, and `Array.shift()` from reconciliation.
  TypeScript, production build, 674 unit tests, and the full E2E suite passed
  (76 passed; the opt-in destructive case skipped). The rebuilt 1-core soak
  returned 600/600 HTTP 200 at 10 requests/s, p50 12 ms, p95 40 ms, p99 87 ms.
  App CPU rose 7.25 seconds (about 12% of one core); final app pressure was
  6.25% `some` and 1.50% `full`. Serving memory was about 227 MiB. This is
  comparable to the earlier warm run (p95 33 ms, p99 89 ms, about 12% CPU);
  the difference is within run-to-run noise, so no CPU reduction is claimed.
- Fixed search-index cache freshness at the HTTP and shared-cache boundaries.
  User-scoped index responses now use `private, no-store`; the optional Valkey
  copy was removed because ACL revocations did not invalidate it. The bounded
  in-process cache remains and is cleared by the existing resource and ACL
  mutation hooks. An E2E test warms the anonymous index, grants public access,
  revokes it, and verifies the resource appears and disappears immediately.
  TypeScript and production build pass, all 674 unit tests pass, and the full
  E2E suite passes 77 tests (the destructive empty-workspace case remains
  opt-in and skipped). This improves permission freshness; no CPU reduction is
  claimed without a before/after workload measurement.
- Closed a public-feed authorization gap: the sitemap, global RSS, and per-user
  RSS previously treated derived `resources.is_public` as proof of anonymous
  visibility, even though that flag is also true for workspace sharing. They
  now select anonymous-visible resources through the shared OpenFGA-verified
  listing filter, and return `Cache-Control: no-store` so revoked public grants
  are not retained by clients. E2E coverage verifies workspace-only resources
  stay out of all three feeds and public-link resources appear in them. The
  Quartz gap tracker was reconciled with the implemented search, hover preview,
  tree, graph, and transclusion paths, and now separates shipped work from
  intentionally deferred scope. TypeScript, build, 674 unit tests, and the full
  E2E suite pass (78 passed; one destructive test skipped by its opt-in policy).
  This closes a visibility correctness issue; no CPU improvement is claimed.
- Hardened the Bases/Dataview renderer: user-authored query config is HTML- and
  script-safe, resource values are built with DOM text nodes instead of
  `innerHTML`, query limits are clamped to 1–100, and the unsupported `kanban`
  label now falls back to the table view it actually renders. Styling moved to
  token-based viewer CSS. Added unit and browser regression coverage with a
  hostile resource title. Also made the folder-tree owner E2E open its nested
  private fixture explicitly; parallel root-level resource creation had made
  the default document nondeterministic and intermittently collapsed its
  ancestor folder. TypeScript/build, 676 unit tests, and full E2E pass (79
  passed; one destructive test skipped). This improves safe rendering and test
  determinism; no CPU change is claimed.
- Rechecked the production Compose app on a single pinned host CPU with 100
  anonymous virtual users at a 10-second think time. The first run immediately
  after app restart returned 599/599 HTTP 200 but had p95 409 ms and p99 2.35 s;
  after five warm-up requests, the repeated 60-second run returned 600/600,
  p50 12 ms, p95 33 ms, p99 77 ms, max 104 ms. App CPU rose 7.12 seconds
  (11.9% of one core); app PSI ended at 7.07% `some` / 1.85% `full`. Serving
  memory was about 210 MiB. The large cold-to-warm latency difference showed
  the soak runner should report cache warm-up separately, so it now warms both
  anonymous and verified authenticated modes before starting its timer. Its
  E2E case checks the warm-up count and mixed identity path. This is still a
  local 10 requests/s homepage run, not a real-account or internet deployment
  capacity claim. The updated runner then completed a 60-second pinned-core
  anonymous soak with 3 warm-up requests and 600/600 HTTP 200; p50 was 12 ms,
  p95 39 ms, p99 82 ms, max 106 ms. App CPU rose 7.02 seconds (11.7% of one
  core), app PSI ended at 7.72% `some` / 2.48% `full`, and serving memory was
  about 212 MiB. This corroborates the earlier warm run within normal latency
  variation and stays below the target steady-use pressure threshold.
  After this runner update, all 676 unit tests and the full E2E suite passed
  (79 passed, one destructive case skipped by policy); TypeScript, script syntax,
  Compose validation, and `git diff --check` are clean. All five serving
  containers were restored to their normal `0-15` CPU set after the isolated
  measurement.
- Repeated that same 100-user / 10-second-think-time workload against the
  currently running production image, with all five serving containers pinned
  to one host CPU and observability pinned to the other CPUs. The 60-second
  anonymous run returned 599/599 HTTP 200 at 9.98 requests/s; p50 was 12 ms,
  p95 40 ms, p99 84 ms, and max 141 ms. App cgroup CPU increased 6.85 seconds
  (about 11.4% of the pinned core); final app PSI was 7.17% `some` / 2.14%
  `full`. `docker stats` showed about 178 MiB across the five serving
  containers after the run, within their 832 MiB combined memory ceilings.
  Host CPU PSI ended at 5.13% `some` during the burst. Serving cpusets were
  verified restored to `0-15`. This corroborates warm anonymous homepage
  capacity on the local single-core simulation; it still does not establish
  authenticated-user capacity or cold-start latency. The owner account was not
  included because `LOAD_EMAIL` and `LOAD_PASSWORD` are unset; the runner's
  E2E verifies a centered authenticated fixture account, but that is not a
  substitute for the owner's account.
  The current app log also records a 1.487-second boot reconciliation of 4,359
  effective-ACL rows. This is a one-off startup cost, not part of the warm soak;
  avoid suppressing it until tuple-change freshness can be proven across app
  restarts and external OpenFGA edits.
- A pre-layout-migration local desktop browser trace of the previous running
  production image measured 14 ms
  TTFB, 1.216 s first paint/LCP, 0.039 CLS, 62.9 KiB document transfer, and
  753 KiB total initial resource transfer, with no client errors. This is a
  warm, local 1440×900 browser sample, not field data. The main resource page
  still had eight inline style attributes, so its static layout and typography
  now live in token-based classes in `layout.css`; the read-only notice uses a
  status role. The page has no remaining inline style attributes. TypeScript,
  production build, and all 676 unit tests pass; full E2E passed 79 tests with
  the destructive opt-in case skipped, and the focused responsive-title and
  read-only status E2E checks passed 6/6. A mobile browser check verifies the
  title wraps without horizontal overflow. The direct local browser trace does
  not verify the deployment's CDN compression or real-device vitals.
- Rebuilt and restarted only the Compose app from the current worktree as
  `ghcr.io/example-org/foss-content-workspace:goal-work`; its existing CPU and
  memory quotas were retained. On this image, the one-core 100-user,
  10-second-think-time soak returned 600/600 HTTP 200 at 10 requests/s, with
  p50 13 ms, p95 38 ms, p99 86 ms, and max 106 ms. App CPU increased 7.39
  seconds over 60 seconds (about 12.3% of one core); final app PSI was 7.46%
  `some` / 2.02% `full`. `docker stats` showed about 248 MiB across the serving
  containers immediately after the run. The first homepage request after the
  rebuild took 2.33 seconds following a health probe; a later warm browser
  visit returned HTTP 200 with no console errors. At 390 px, document width
  stayed 390 px, the title used token sizing and wrapped, and the light theme
  resolved to its light tokens. All serving containers were restored to
  `0-15`; the rebuilt app remains healthy. The account in this soak is still
  anonymous because no local owner credentials are configured. This remains a
  local simulation, not a deployment capacity guarantee.
- Cleaned up login and registration surfaces with shared token-based form and
  button primitives, associated labels, correct browser autocomplete hints,
  accessible error states, and a single shared Google mark. The login page no
  longer decodes an error query value twice, avoiding malformed-percent input
  exceptions. Focused auth UI E2E checks verify no inline styles, persisted
  dark/light theme tokens, accessible labels, and the account menu after
  authentication. A mixed-load E2E test verifies its fixture login resolves to
  the requested identity and returns successful anonymous and authenticated
  traffic from the same run. `npx tsc --noEmit` and `npx astro build` passed
  after these UI changes. The full 82-case E2E suite passed 81 tests with the
  destructive empty-workspace case skipped by policy. It ran at two workers;
  the keyboard focus check requires a visible, solid outline of at least 2px
  and has a 45-second allowance for the cold browser path. After the auth
  edits, the full unit suite passes 677/677; `git diff --check` is clean. No
  owner account credentials were configured or used. The refreshed `goal-work`
  image was rebuilt and restarted after the auth changes; `/api/v1/health` reports the
  app, PostgreSQL, OpenFGA, and Valkey healthy, and `/login` returns HTTP 200.
  The five serving containers report 212 MiB total immediately after restart
  and about 98 MiB in a later idle Docker stats snapshot. Effective NanoCPU
  limits are 0.40, 0.25, 0.10, 0.15, and
  0.10 respectively, with memory ceilings totaling 832 MiB. Observability
  containers remain outside this serving budget. The app has no fixed CPU-set
  mask in normal operation; supporting containers retain `0-15`. No new CPU
  soak was run after these UI-only changes.
- Improved mobile discovery and keyboard access for wide Markdown tables. The
  renderer now wraps tables in a named, focusable region and shows a concise
  horizontal-scroll hint on narrow screens when the table is likely to exceed
  the viewport. The table keeps native semantics and the wrapper owns
  horizontal scrolling. The focused mobile E2E check verifies the region name,
  hint, and actual horizontal movement. `npx tsc --noEmit`, `npx astro build`,
  all 677 unit tests, the focused E2E test, and the complete E2E suite pass;
  the suite reports 81 passed and one destructive opt-in scenario skipped.
  `git diff --check` is clean.
- Rebuilt and restarted only the production app image after the table change.
  `/api/v1/health` reports database, OpenFGA, and Valkey healthy; `/login`
  returns HTTP 200. The app remains capped at 256 MiB and 0.40 CPU.
- A separate 30-second 100-VU tight-loop overload run returned 1,199/1,199
  successful responses at 37.27 requests/s. It measured p50 2,514 ms, p95
  3,000 ms, p99 7,563 ms, and max 9,068 ms. App cgroup CPU consumed about
  12.98 seconds over 32 seconds (roughly 0.406 core, saturating its 0.40
  quota); after-load app PSI reached 8.29% `some` / 8.26% `full`, and serving
  memory was about 215 MiB. This is an overload ceiling, not a realistic
  browsing pattern. The prior 100-user workload with 10 seconds of think time
  remained near 10 requests/s, p95 38 ms, and roughly 12% app CPU. Keep those
  two workload profiles distinct in capacity reporting.
- The E2E mixed-load scenario validates a centered authenticated fixture
  account alongside anonymous requests and confirms successful pass-through
  for both groups. Owner credentials remain unset, so no request was made as
  the user's real account.
- An interim lazy-load experiment removed graph props from homepage SSR and
  added a “Load graph” action. That contradicted the requested preloaded
  sidebar, so it was replaced by the automatic preloaded graph path below. The
  private, no-store graph API remains available; E2E security assertions
  confirm it includes public resources without exposing private ones.
- During the interim lazy-load version, the constrained app was rebuilt and
  restarted. The
  one-minute anonymous homepage soak completed 600/600 HTTP 200 at 10 requests/s
  (p50 11 ms, p95 17 ms, p99 82 ms, max 144 ms); app cgroup CPU rose about 9.36
  seconds and app PSI ended at 0.18% `some` / `full` avg10. A separate
  one-minute 100-user think-time run against the graph API completed 600/600
  HTTP 200 at 10 requests/s (p50 7 ms, p95 9 ms, p99 33 ms, max 83 ms); CPU
  rose about 3.01 seconds and app PSI ended at 0.12% avg10. These are two
  separate endpoint runs, not a simultaneous mixed workload or real one-vCPU
  host. Run-to-run noise and the lack of an immediately paired pre-change
  profile mean no CPU reduction is claimed. After both runs, serving memory
  was about 162 MiB combined; app memory was 77 MiB. `/api/v1/health` and
  `/login` return HTTP 200, and configured limits remain 832 MiB / 1.0 CPU
  across the five serving containers.
- A later complete E2E run initially had 7 navigation timeouts even though
  Playwright snapshots showed the expected page content. The shared head was
  waiting on Google Fonts, whose endpoint timed out from this environment. The
  app now uses tokenized system font stacks and has no required third-party
  font request. The same five ACL route tests then passed in 5.8 seconds of test
  time (individual cases 0.3–3.1 seconds, versus 12–23 seconds in the earlier
  run). The full suite now passes 83 tests with one destructive opt-in scenario
  skipped, in 59.9 seconds. TypeScript, Astro production build, 678 unit tests,
  and `git diff --check` pass. Docker Hub tag and Dockerfile frontend lookups
  failed intermittently, so the build now pins the Node and Bun base images to
  the digests already used by the running image and uses BuildKit's built-in
  Dockerfile frontend. The updated image built and the app was restarted.
  Health reports PostgreSQL, OpenFGA, and Valkey healthy; `/login` returns 200,
  the homepage is 53,802 bytes and has no remote font reference, and the app
  remains at 256 MiB / 0.40 CPU. The five serving containers used about 175 MiB
  combined in the post-restart snapshot. A production GET of the deferred graph
  endpoint returns HTTP 200 with 24 nodes, 21 links, and `private, no-store`.
- Made the mixed-load E2E soak configurable and ran 100 virtual users for 60
  seconds with one authenticated seeded owner identity centered between 99
  anonymous users (49 before, 50 after). `/auth/me` verified the requested
  identity. The run completed 599 requests at 9.98 requests/s; all 599 returned
  HTTP 200. Authenticated traffic: 6 requests, p50 34 ms, p95 46 ms. Anonymous
  traffic: 593 requests, p50 31 ms, p95 36 ms. This confirms the authenticated
  route passes through alongside anonymous traffic; it reuses one account and
  ran against isolated Testcontainers with an Astro dev server, without the
  Compose CPU/memory quotas. It is not evidence of distinct-account capacity or
  the serving budget. Actual owner credentials remain unset.
- Removed the unused `CACHE_ENABLED` environment flag from Compose and central
  config. A repository-wide consumer check found no code reading
  `config.cache`; the comment implied endpoint caching could be switched on,
  while actual caches have independent bounded implementations and correctness
  paths. This removes an operator-facing no-op setting without changing cache
  behavior. `npx tsc --noEmit`, Compose config resolution, `git diff --check`,
  and all 678 unit tests pass. An unconstrained 8-worker E2E run passed 82
  tests, skipped the destructive opt-in case, and had one transient editor
  selector timeout under parallel load; that collaboration test passed alone,
  then the complete suite passed 83 tests with the destructive case skipped at
  2 workers. Keep the lower parallelism when running the whole E2E suite on a
  constrained development machine.
- The default serving containers were exited at the start of this follow-up;
  `docker compose up -d` restored them, and rebuilding the app image incorporated
  the dead-flag cleanup. The app is published at host port 4322 on this machine.
  After rebuild, health reports PostgreSQL, OpenFGA, and Valkey healthy; `/`
  and `/login` return HTTP 200. The immediate post-restart snapshot used about
  159 MiB across the five serving containers (app 78 MiB), with the app capped
  at 256 MiB / 0.40 CPU and all declared service limits totaling 832 MiB / 1.0
  CPU. This brief idle snapshot is not a CPU-pressure or user-capacity result.
- Repeated the anonymous production homepage soak against the rebuilt image with
  100 virtual users and 10 seconds of think time for 60 seconds. It returned
  600/600 HTTP 200 (10 requests/s), with p50 11 ms, p95 25 ms, p99 89 ms, and
  max 156 ms. App cgroup CPU usage increased by about 8.19 seconds during the
  run (roughly 13.7% of one core); cgroup CPU PSI `some avg10` was 0.41% at the
  end. Serving containers used about 153 MiB in the post-run snapshot. This is
  one anonymous homepage workload on a 16-logical-CPU host with Compose quotas,
  not an authenticated mixed load or proof of physical 1-vCPU capacity. No
  local account credentials were configured, so this run did not use the user's
  account; the seeded-account pass-through is covered separately by E2E.
- Ran the same 100-user, 10-second think-time profile against the deferred graph
  API for 60 seconds. It returned 600/600 HTTP 200 at 10 requests/second (p50
  7 ms, p95 13 ms, p99 45 ms, max 92 ms). App cgroup CPU increased by about
  2.94 seconds during the run (~4.9% of one core); PSI `some avg10` was 0.50%
  at completion. Serving containers used about 161 MiB afterward and health
  remained green. This is anonymous on-demand graph traffic under Compose
  quotas on the local 16-logical-CPU host; it does not prove authenticated mixed
  load or physical one-vCPU capacity.
- Wired the existing non-CSP security-header middleware into the supported
  Compose runtime. The feature was implemented but not passed by Compose, so
  operators could not activate it through the standard deployment. Compose now
  defaults `SECURITY_HEADERS` to true while allowing an explicit override. The
  rebuilt production response includes `nosniff`, `X-Frame-Options: DENY`,
  Referrer-Policy, Permissions-Policy, and HSTS. The complete E2E suite passed
  with the middleware explicitly enabled: 83 passed, one destructive opt-in
  case skipped. A repeated 100-user homepage soak returned 600/600 HTTP 200 at
  10 requests/second (p50 11 ms, p95 25 ms, p99 81 ms, max 130 ms); app CPU
  increased about 7.96 seconds in 60 seconds (~13.3% of one core), and cgroup
  `some avg10` was 1.00% at completion. The serving containers used about 164
  MiB in Docker stats afterward. This is similar to the previous anonymous
  run; it is not a paired CPU benchmark and does not establish physical
  one-vCPU capacity. CSP remains deferred pending removal of remaining inline
  styles.
- Marked the original UI redesign checklist as historical: it still described
  tokens, shared primitives, and global feedback as absent even though those
  foundations now exist. `docs/design-system.md` is the live UI standard and
  this goal log tracks current UX work; the old audit remains for provenance,
  with each proposed follow-up requiring a check against current code.
- Removed the unused ACL projection `applyChanges()` stub. A repository-wide
  caller search found no consumer; the stub filtered only document changes and
  did not persist its returned cursor, so wiring it would not safely track the
  complete OpenFGA graph. The projection continues to use its existing full
  reconcile on boot and after app-driven ACL writes. Historical migration
  columns are retained; no data or schema was changed.
- Restored automatic right-sidebar graph rendering after a lazy-load change
  had required an explicit click. An interim version fetched the viewer-filtered
  graph API after hydration; the later entry below replaces that approach with
  graph data derived from the page's existing authorized resource set.
  TypeScript and all three canvas/graph E2E cases pass, and the rebuilt
  production app is healthy. Tightened `.dockerignore` to
  omit mounted research PDFs, temporary copies, and nested worktrees: the next
  production build context measured 178 KiB, down from 498.5 MiB. Because Astro
  serves static assets from `dist/client`, Compose also mounts `public/pdfs`
  read-only at `dist/client/pdfs`; a follow-up direct request confirmed the
  sample PDF returns HTTP 200 as `application/pdf` (923,319 bytes). The public
  PDF remains available without baking user data into the image.
- Verified the interim API-loaded production browser path: opening `/` rendered the
  sidebar graph without interaction; its viewer-filtered API returned HTTP 200
  with a 4.7 KiB graph payload, and the graph became visible in about 202 ms.
  App cgroup CPU increased about 0.11 seconds over this single-page probe and
  `some avg10` remained below 0.1% at completion. This is a one-browser check,
  not an aggregate capacity or CPU comparison.
- Initially removed redundant server-side graph construction from folder and
  tag routes, then replaced the duplicate API pass with the shared preloaded
  graph snapshot described below.
- Preserved the graph's per-user read-marker behavior through the lazy loader:
  the wrapper now forwards the current account to the canvas and SVG renderers
  on the homepage, folder, and tag routes. Full E2E initially had one
  parallel-hydration timeout opening the second collaboration editor; the
  focused collaboration test passed in isolation. Raised only that second
  editor's visibility wait to 15 seconds, then reran the full suite at two
  workers: 83 passed and one destructive opt-in case was skipped. TypeScript
  and all 678 unit tests also pass. This is a test robustness adjustment, not
  evidence of a production performance change. The latest production rebuild
  is healthy; both the health endpoint and homepage return HTTP 200, with the
  app still capped at 256 MiB / 0.40 CPU.
- Avoided duplicate authorization work during graph hydration. The homepage,
  folder, and tag routes already load the viewer-filtered resource set for their
  content and explorer; they now build the graph from that same set and pass
  the compact graph nodes/links to the client island. The sidebar remains
  automatic and preloaded, while a browser check confirms page load no longer
  calls the graph API and repeats the resource query/OpenFGA checks. The direct
  viewer-filtered graph API remains available. `npx tsc --noEmit`, Astro
  production build, 678 unit tests, and full E2E (83 passed, one destructive
  opt-in skipped) pass. This removes an avoidable second listing/authorization
  pass per graph page view.
  The rebuilt production browser check rendered the graph with zero graph API
  requests (cold first-load graph visible in 2.9 s); `/` and `/api/v1/health`
  returned HTTP 200. After that single-browser check, serving containers used
  about 142 MiB, app memory was 74.6 MiB, and app cgroup PSI was 0.35% `some`
  avg10. This is a cold single-browser check and idle snapshot, not a load or
  CPU-improvement benchmark.
- Hallmark is available locally at `/home/user/.agents/skills/hallmark`;
  the navigation pass also follows `docs/design-system.md`. Simplified the
  mobile drawer around the common resource destinations and workspace tasks,
  removed duplicate theme/shortcut actions already in the action rail, renamed
  internal-facing navigation labels, and moved its layout styling into token-
  based CSS classes. Mobile E2E exposed a first-tap race: the global menu button
  could dispatch before the idle React island listened. The drawer now hydrates
  on load and preserves the open intent across hydration. TypeScript, all 678
  unit tests, focused mobile E2E (2/2), and full E2E (84 passed, one destructive
  opt-in skipped) pass. The production browser smoke opened the drawer on first
  tap, showed only the two workspace destinations, reported zero duplicate
  theme controls, and navigated to `/tags`; health and homepage return HTTP 200.
  The production app is healthy under its existing 256 MiB / 0.40 CPU cap.
- Exercised the current preloaded-graph production build with 100 anonymous
  virtual users and 10 seconds of think time for 60 seconds, with the five
  serving containers sharing one pinned host CPU and optional monitoring and
  infrastructure containers on other CPUs. It returned 599/599 HTTP 200 at
  9.98 requests/s (p50 13 ms, p95 41 ms, p99 72 ms, max 97 ms). App cgroup CPU
  increased 7.56 seconds (~12.6% of that core); app PSI at the sample endpoint
  was 8.28% `some avg10` / 2.80% `full avg10`, below the 10% steady-use `some`
  target. App cgroup memory accounted 198 MB at the endpoint; Docker stats
  shortly after showed about 157 MiB across the five serving containers. All
  temporary CPU sets were restored to `0-15`. This is anonymous closed-loop
  traffic on a 16-core development host, not distinct authenticated users or
  proof of physical one-vCPU capacity. No local account load credentials are
  configured; account pass-through remains covered in the mixed-identity E2E.
- Continued the Hallmark-guided first-use pass on the create-resource flow.
  Removed the duplicate “Change” control, clarified the first-step prompt and
  destination label, and made the title sentence case. The mobile E2E exposed
  the same idle-hydration race in the create modal. It stays idle-loaded, and
  the shared event helper queues an early open intent until the modal listener
  mounts. The mobile test opens it from the navigation drawer, covering the
  first-tap path. TypeScript, production build, and all 3 focused mobile E2E
  cases pass. The serving image was rebuilt and is healthy; homepage and health
  endpoint return HTTP 200. The app used about 76 MiB of its 256 MiB memory cap
  in the immediate post-restart snapshot.
- Continued the Hallmark app-surface pass across mobile navigation, the
  workspace action rail, and the empty-workspace state. Replaced ambiguous
  create/theme/keyboard glyphs with line icons, labelled the primary create
  action “New resource,” kept theme state synchronized with the SVG icon, and
  made the empty state point directly to creating a note, organizing a folder,
  or importing a file. Updated the isolated empty-workspace expectations; its
  guarded Testcontainers run passes, as do all 3 mobile E2E cases, TypeScript,
  and the production build. Production rebuild is healthy: homepage and health
  return HTTP 200, with the app at 84 MiB / 256 MiB at the sample point. A
  browser check at 390 px confirms the mobile rail renders and theme toggling
  changes both the theme and icon state. Hallmark's targeted scan still reports
  broader inherited CSS findings (32 FAIL, 13 REFLEX, 5 WARN across the
  selected app files/styles); these are tracked as ongoing UI debt, not treated
  as fixed by this focused pass. Full E2E and broader Hallmark cleanup remain.
- Fixed a touch usability gap in the vault explorer: row action menus were
  effectively hover-only and the expand controls were too small for reliable
  tapping. Added a shared 44px hit-target token and a coarse-pointer rule that
  keeps these actions visible at touch sizes while preserving desktop hover and
  focus behavior. The mobile E2E verifies the first row action stays visible
  and measures at least 44×44px; all 3 focused mobile E2E cases pass, as do
  TypeScript and the production build. The serving image was rebuilt and is
  healthy; homepage and health return HTTP 200. A post-start snapshot showed
  96.9 MiB app memory / 256 MiB and 6.4% instantaneous CPU. This is an idle
  snapshot after a few smoke requests, not a load result. Other explorer
  affordances and the larger Hallmark audit backlog remain open.
- The collaboration E2E used a fixed seeded resource and wrote test text into
  the mounted user-content tree on every run. It now creates a temporary
  resource and removes only that test-created file; the unused fixed seed was
  removed. An existing generated content file remains untouched. Local
  Playwright runs are capped at one worker by default; CI remains at two. The
  full suite passes 85 tests with one destructive opt-in skipped, and the
  seeded account passes requests while anonymous users run alongside it.
- Removed the per-request `pino-http` wrapper and disabled detailed request
  start/end logs at the default `info` level. The shared Pino logger keeps
  warnings and errors; operators can enable per-request diagnostics with
  `LOG_LEVEL=debug`. Metrics and trace headers remain on the request path. The
  100-user, 10-second-think-time production soak after rebuilding returned
  599/599 HTTP 200 (9.98 requests/s), p50 14 ms, p95 59 ms, p99 97 ms, and
  max 161 ms. With all five serving containers pinned to one host CPU, app CPU
  rose 8.02 seconds over 60 seconds (~13.4% of one core); app cgroup pressure at
  completion was 9.76% `some avg10` / 3.77% `full avg10`. Docker stats showed
  about 207 MiB across serving containers. The app health endpoint reports all
  required dependencies healthy. Earlier equivalent runs ranged from 7.56 to
  8.77 app CPU seconds and p95 41–46 ms, so this sample does not prove a CPU
  reduction. Continue measuring before claiming an improvement. The tight-loop
  100-user overload case still saturates the app quota and remains open.
- Made the homepage graph shell server-rendered and eagerly hydrated (`client:load`)
  so the right sidebar has its graph panel in the initial HTML and initializes
  without a manual load action. Strengthened the graph E2E check to assert the
  server response contains the graph shell, the accessible graph region and
  canvas/SVG render, no “Load graph” button exists, no page errors occur, and no
  duplicate graph API request is made. The focused graph/canvas E2E suite passes
  (3/3), TypeScript passes, and `astro build` completes. Rebuilt and restarted
  only the app container with the existing data volumes attached; the live
  homepage and health endpoint both return HTTP 200, and the served homepage
  includes the graph shell. The app sampled at 158 MiB of its 256 MiB limit.
  This is not a CPU benchmark.
- Hallmark-guided navigation review found the workspace sidebar and mobile
  drawer exposing the internal `user:<id>` value as the user's account context.
  The verified session already has a display name and email, but `ResourceShell`
  dropped that session before rendering its floating action rail. The shell now
  labels the scope as “Your workspace” or “Public workspace,” shows the
  display name and verified email when signed in, and forwards the same session
  into the rail. The mobile drawer now shows that same human-readable identity
  instead of the internal ID. TypeScript and the production Astro build pass;
  no browser test was run in this pass. Hallmark's source scan still reports
  older findings elsewhere in the shared layout styles; its render tier needs
  a running URL and was not run here. Broader navigation and first-use review
  remain active.
- Continued that pass on the explorer toggle: it now uses a directional SVG,
  a 44px hit target, and an `aria-expanded` value and accessible label that
  track the persisted collapsed state. Its motion and shadow use the existing
  design tokens. TypeScript, the production build, and `git diff --check` pass.
  A Hallmark source scan of the five touched UI files reports 26 FAIL, 10
  REFLEX, and 3 WARN, down from 30 FAIL in the preceding scan; the remaining
  findings are mostly pre-existing rules elsewhere in the shared layout CSS.
  The render tier is still pending because no dev server was running and this
  workspace has no matching local port allocation in `PORTS.md`; no listener
  was started outside the project's port policy.
- Re-measured the rebuilt serving app with 100 anonymous virtual users, a
  10-second think time, and 60 seconds of traffic. All 600 requests returned
  HTTP 200 at 10 requests/second; p50/p95/p99/max were 12/40/75/162 ms. The
  app used 8.92 CPU seconds during the minute (~14.9% of one core); the five
  serving containers together used about 11.86 CPU seconds (~19.8% of one
  core). Host CPU PSI was 1.66% `some avg10` / 1.79% `some avg60`, and serving
  memory sampled at about 142 MiB total (app 72 MiB). Compose caps remain
  832 MiB and 1.0 CPU across the five serving services. This run used aggregate
  container CPU quotas on a 16-core development host, without pinning all
  containers to one physical core; it does not prove physical one-vCPU
  capacity. There is no paired run showing CPU improvement from the graph
  hydration change.
- Repeated the same 100-user / 10-second-think-time workload with all five
  serving containers pinned to one host CPU and monitoring services moved to
  the other 15 CPUs. It returned 599/599 HTTP 200 (9.98 requests/second),
  p50/p95/p99/max 14/56/97/105 ms. App CPU was 8.743 seconds and total serving
  CPU 11.177 seconds over 60 seconds (~18.6% of one core); host CPU PSI rose
  from 0.84% to 3.77% `some avg60` and remained below the 10% steady-use target.
  Post-run Docker memory was about 253 MiB total across serving services; app
  used 157 MiB of its 256 MiB cap. The temporary affinity changes were restored
  for all Compose containers and verified; app health and homepage HTTP 200
  were rechecked. This supports the paced anonymous workload on one pinned core,
  but does not validate authenticated 100-user throughput or burst saturation.
- Full Playwright E2E after the graph island change passes 85 tests, with one
  destructive opt-in skipped. The mixed-load E2E confirms three requests from
  the centered seeded authenticated fixture and six anonymous requests all
  returned HTTP 200. This verifies the pass-through path for the fixture
  account; it does not use or validate the owner's real account credentials.
- Removed the deprecated `WysiwygEditor` and `JsonCanvasRenderer` wrappers after
  confirming neither was imported anywhere in application or test code; their
  replacements (`NovelEditor` and `CanvasViewer`) are used directly. This trims
  two compatibility-only files from the maintenance surface without changing
  shipped behavior. TypeScript, 676 unit tests, and the Astro production build
  pass. The full E2E suite passed immediately before this removal; the deleted
  wrappers had no runtime imports.
- Hallmark's auth-page scan found emoji used as the login lock, signup, and
  OAuth error icons. Replaced them with accessible Lucide line icons and kept
  the existing token-based auth layout. Added browser checks for both heading
  icons and the OAuth alert icon/text. The focused login/register E2E suite
  passes 14/14, TypeScript and the Astro production build pass, and the rebuilt
  Compose app serves `/login` and `/register` with HTTP 200. The targeted
  scanner's page-only focus-ring warning comes from not including imported
  shared CSS; `primitives.css` already defines a shared `:focus-visible` rule.
  Hallmark render checks could not run because `puppeteer-core` is unavailable
  in this environment.
- The next Hallmark explorer pass replaced resource and context-menu emoji
  with category-consistent Lucide SVGs derived from the central resource
  registry, clarified action labels, made the explorer heading plain language,
  and added a labeled chevron plus visible keyboard focus for folder controls.
  The registry remains the source of resource type/category metadata. TypeScript
  and the Astro production build pass. The Hallmark scan of `FolderTree.tsx`
  reports no icon or color-literal failures; its remaining focus-style finding
  is because the component's focus rule lives in shared `layout.css`, alongside
  the global focus primitive. The larger `layout.css` audit still reports 23
  legacy FAIL, 8 REFLEX, and 2 WARN. Browser rendering and interaction checks
  remain pending because this workspace has no port allocation for a dev server.
- Continued the explorer-to-create journey. A folder's “Import or upload”
  action now opens the full import chooser with the target folder preselected,
  instead of silently forcing PDF or Google Sheets. The registry-backed
  category icon is now one shared UI component used in both the folder tree and
  create dialog; location options use plain text, and an unused location
  lookup was removed. TypeScript and the production Astro build pass. Hallmark's
  focused scan has no icon or color literal findings; it still reports the
  component-scoped focus style as a FAIL because the selector is in shared
  `layout.css`, plus generic `:active`/`:disabled` reflexes and one long dropzone
  label warning. No browser test was run in this pass.
- Continued the search-to-action journey. Search now advertises `>` for
  create/import commands, shows the platform's actual Ctrl/Cmd shortcut, and
  uses the shared resource SVGs. The command palette no longer displays a
  resource-search empty result under its command list. Its combobox now links
  to the popup and active option for assistive technology. Signed-out visitors
  see a direct sign-in action instead of commands they cannot use. TypeScript
  and the Astro production build pass. Hallmark's source scan still reports
  legacy copy/focus heuristics in `SearchModal.tsx`; the visible focus treatment
  is implemented in shared `layout.css`. Browser interaction checks remain
  pending because no dev-server port is registered and render dependencies are
  unavailable.
- Improved search recovery: an authenticated no-results state now offers a
  primary “Create note” action that opens the existing create flow with the
  searched phrase prefilled as its title. Anonymous visitors see a direct
  sign-in path, and both states suggest trying fewer words. The create modal
  accepts an optional initial title through the existing typed event contract.
  TypeScript, Astro production build, and `git diff --check` pass. Hallmark's
  focused scan reports 2 FAIL, 2 REFLEX, and 2 WARN across the search/create
  components, mostly existing copy/focus/dropzone heuristics. Browser
  interaction checks remain unavailable without the registered dev port and
  Hallmark render dependency.
- Fixed the homepage's advertised `/` search shortcut, which had no matching
  key handler. Pressing `/` outside a form field or editor now focuses the
  visible workspace search; Ctrl/Cmd+K remains supported, and both shortcuts
  are listed in the keyboard guide and exposed on the search combobox. TypeScript
  and the production Astro build pass. Hallmark's focused scan reports 2 FAIL,
  2 REFLEX, and 1 WARN, matching existing copy/focus heuristics; focus styling
  is shared in `layout.css`. No browser interaction check was run.
- Resource breadcrumbs previously showed only a resource's parent and
  grandparent. They now include every accessible ancestor, so deeply nested
  resources retain direct navigation to each containing folder. The walk stops
  safely on missing or cyclic parent references. TypeScript and the production
  Astro build pass; no browser interaction check was run.
- Fixed the editor's shared keyboard menu handler so Escape always dismisses an
  open suggestion menu, including when filtering leaves zero results. Arrow and
  Enter keys remain untouched when there are no choices. The slash-command
  empty state now announces that there are no matches and explains how to close
  it. The menu uses the shared Button primitive, Lucide category icons, and a
  token-based stylesheet with keyboard focus, active, disabled, and reduced-
  motion states. Loading/error/success are waived because commands are local,
  synchronous editor actions. Removed the now-unused emoji icon field from the
  editor command registry. TypeScript, production build, and Hallmark's focused
  source scan pass. No targeted browser assertion for the empty-menu Escape
  path was run.
- Added additive migration `0015_resources_content` and aligned the fresh-DB
  initializer with it. The persistent local database was backed up and the
  missing `resources.content` column was applied directly because that database
  has no migration ledger and cannot safely replay `0001` through `0014`. The
  resource GET query now selects stored content, with a vault-sync round-trip
  E2E assertion. The full E2E suite applied all 14 migrations to its disposable
  database. TypeScript and Astro build pass; the production image was rebuilt
  and restarted without replacing data volumes. Its health endpoint and
  homepage return HTTP 200, the homepage response includes the automatic
  right-sidebar graph, and the persistent database reports the content column.
  The complete unit suite passes 677/677.
- Re-ran the complete Playwright suite: 86 passed and one destructive opt-in was
  skipped. The Mermaid render test that failed once in the preceding full run
  passed in isolation and in this full run. Re-ran the paced 100-user homepage
  workload against the rebuilt production app with all five serving containers
  pinned to one host CPU and optional observability containers moved to the
  other CPUs. It returned 599/599 HTTP 200 at 9.98 requests/s (p50/p95/p99/max
  14/57/104/129 ms). App cgroup CPU increased by 8.15 seconds over the minute
  (~13.6% of one core); host CPU PSI `some avg10` peaked near 5.1% and ended at
  2.86%. The five serving containers used about 184 MiB in the post-run sample.
  All container CPU sets were restored to `0-15`. This is a paced anonymous
  workload on a 16-core development host, not distinct-account capacity or
  proof of a physical one-vCPU deployment. The tight-loop overload and
  authenticated multi-account checks remain open.
- The default Compose app has queueing disabled and no worker service, but its
  resource create/save route chunks eagerly imported BullMQ. Queue and worker
  imports are now dynamic and occur only when queueing is enabled or the
  standalone worker starts; queue-off writes retain the synchronous Meilisearch
  handler. A focused unit test covers that fallback, and the E2E create, save,
  and vault-sync journeys pass. No CPU reduction is claimed without a paired
  workload result. The E2E harness now starts Astro directly in the foreground
  and waits for process exit before tearing down test databases, preventing the
  previous agent-auto-background behavior from leaving a server on port 4321.
  Verification after these changes: TypeScript, Astro production build, 678
  unit tests, and 86 E2E tests pass (one destructive opt-in skipped). The
  production app image was rebuilt and is healthy; homepage and health return
  HTTP 200, and the existing database volume still contains `resources.content`.
  A post-start sample showed 154 MiB app memory / 256 MiB and <1% instantaneous
  app CPU after 20 seconds; this is an idle snapshot, not an optimization
  benchmark.
- The explorer's top-level New, Folder, and Import actions now target the open
  folder automatically. On a note page, the destination is its accessible
  parent folder; on a folder page, it is that folder. The modal still uses the
  vault default when no folder context exists. TypeScript and Astro build pass.
  Hallmark's focused FolderTree scan reports the existing shared-focus rule as
  out of scope and active/disabled state reflexes; no browser action check was
  run.
- Fixed folder-tree row hover feedback that inline backgrounds had suppressed.
  The context menu now remains open for inside clicks, focuses its first item,
  supports arrow/Home/End navigation, and returns focus to its trigger on
  Escape. Copy-link now reports success or clipboard failure. Context-menu
  styling uses workspace tokens and 44px action targets. TypeScript, Astro
  build, and `git diff --check` pass. Hallmark's combined scan still reports
  legacy findings elsewhere in the large `layout.css`; no browser interaction
  check was run.
- Moved all folder-tree-only visual rules out of `layout.css` into the stamped,
  token-based `tree.css` module. This keeps future tree work isolated from
  unrelated layout debt. The focused Hallmark scan now reports 0 FAIL, 0
  REFLEX, and 0 WARN; TypeScript, production build, and `git diff --check`
  pass. No browser interaction check was run.
- Simplified the PDF annotation-note path: one linked-note action replaces two
  duplicate open controls; note creation has one shared handler, a visible
  retryable error, an inline fallback link when popups are blocked, and a
  sign-in action for anonymous viewers. The create tab opens within the click
  gesture to avoid popup blocking. Notes styles now use their own token-based
  module and honor reduced motion. Hallmark's focused component scan reports
  0 FAIL, 0 REFLEX, and 0 WARN; TypeScript, Astro production build, and
  `git diff --check` pass. Hallmark render checks could not run because
  `puppeteer-core` is not installed; no browser interaction test was run.
- Fixed account navigation's RSS target to derive the feed from the canonical
  authenticated subject instead of the display name, which could resolve to a
  different/nonexistent owner. Refactored the account popover from inline style
  and ARIA menu semantics without arrow-key behavior into a styled navigation
  popover with normal Tab flow, Escape focus restoration, unique IDs for the
  two rail instances, 44px targets, and the verified name/email instead of an
  internal subject ID. Moved its styles into `user-menu.css`. TypeScript, Astro
  production build, `git diff --check`, and the focused Hallmark static scan
  pass (0 FAIL, 0 REFLEX, 0 WARN); `/` returns HTTP 200. The browser snapshot
  timed out and Hallmark render checks remain unavailable without
  `puppeteer-core`, so visual/interactions are not fully verified.
- Mobile folder actions now remain fully visible on touch devices and stop
  fading while a finger is targeting them. The folder tree exposes an
  interaction-ready marker and More actions buttons expose menu semantics and
  expanded state. Preventing the menu's initial focus from scrolling the page
  fixed the mobile bug where its scroll listener immediately dismissed the
  menu. The test harness now builds and serves the production output, avoiding
  dev-server dependency-optimizer reload races and exercising the deployed
  client chunks. OAuth mocks use an explicit `E2E_TEST_MODE` flag. Updated
  account-menu assertions to match its accessible navigation semantics and
  normalized the CSS token before comparing it with the browser's computed
  color. Completed the missing closing element in the account feed link that
  was exposed by a concurrent edit during the first production build attempt.
  Verification: all 87 E2E tests pass (one destructive opt-in skipped), all
  678 unit tests pass, TypeScript and production build pass, `git diff --check`
  passes, and Compose configuration validates. The app image was rebuilt and
  replaced with `docker compose up -d --no-deps app`; its existing service
  volumes were retained. Live `/api/v1/health` returned `ok` with database,
  OpenFGA, and Redis healthy. Docker confirms the running app's 256 MiB / 0.40
  CPU limit, and the live homepage contains the graph viewport without a Load
  Graph control. Re-ran the 100-user, 10-second-think-time anonymous workload
  against this live Compose app for 60 seconds, with all five serving services
  pinned to one host CPU, optional services pinned to the other 15 CPUs, and
  the load generator pinned away from the serving core. It returned 599/599
  HTTP 200 at 9.98 requests/s (p50/p95/p99/max 14/53/87/116 ms). App CPU use
  was 8.25 seconds (~13.7% of one core); all five serving containers together
  used 10.67 CPU seconds (~17.8% of one core) and about 356 MiB after the run.
  Host CPU PSI `some avg10` was 3.75% in the final sample. Every container's
  affinity was restored to CPUs 0–15, then the app health endpoint was checked
  again. This is a paced anonymous workload on a 16-core host; the mixed
  authenticated fixture remains test-only and distinct live accounts were not
  exercised.
- The shared Drawer now moves focus to its first action on open, traps Tab and
  Shift+Tab inside the modal, closes on Escape, and restores focus to the
  opener. TypeScript and Astro production build pass. The focused Hallmark scan
  reports 0 FAIL, 0 REFLEX, and 0 WARN; its render tier could not run because
  `puppeteer-core` is unavailable. Rebuilt the production app with existing
  data volumes and manually verified at 390px as a guest: opening focuses
  “Close panel,” Shift+Tab wraps to the last link, Tab wraps back, and Escape
  closes and restores focus to “Open navigation menu.” The app health endpoint
  reports required dependencies healthy; cgroups enforce 256 MiB / 0.40 CPU.
  The signed-in identity fallback no longer displays internal auth subjects when
  verified claims have no name; it uses “Your account.” The mobile account panel
  adds “Signed in as” for parity with desktop. A 390px production-browser check
  using the seeded local synthetic account confirmed its name/email are visible
  in the workspace, desktop account trigger, and mobile drawer; create/share
  actions show and workspace access stays hidden for the non-admin. The fixture
  has an unusual display name (“Duplicate”), so this does not substitute for a
  real-account review. TypeScript, Astro build, focused Hallmark scan, and
  `git diff --check` pass; the app was rebuilt with existing volumes.
- Production review of the authenticated create/import modal at 390px found two
  concrete problems: the shared Modal focused its container after the first
  resource choice, and the create footer clipped the primary action. The Modal
  now honors explicit initial-focus refs and uses a stable close callback; the
  create flow focuses the first type choice, then the title for new resources,
  the dropzone for PDF/image imports, or the Google link/ID field for Google
  imports. The narrow footer puts “Choose different type” on its own row and
  lays Cancel and the concise Create/Import action out in two equal columns.
  Manual browser review confirmed the first choice focus, title focus, PDF
  dropzone focus, Google-source focus, and a fully visible mobile footer. The
  CSS-only Hallmark scan reports 0 FAIL/REFLEX/WARN; the earlier broader scan
  surfaced unrelated legacy findings in `primitives.css`. TypeScript, Astro
  build, and `git diff --check` pass. Rebuilt only the app container with
  existing data volumes, verified its health and runtime limits, then logged
  out of the seeded fixture session and closed the temporary browser tab.
- Reviewed the live guest navigation and auth journeys. The reader's contextual
  graph is present on first render, without a Load Graph action. The guest
  mobile drawer offers Search resources, All resources, Browse tags, Sign In,
  and Register; choosing Search closes the drawer and focuses the existing
  search field. On `/login` and `/register`, the header had duplicated auth
  shortcuts already offered by each form. Guest auth pages now omit those
  shortcuts and keep one cross-link beside the form; signed-in account menus are
  unaffected. Production browser checks on both routes confirmed the cross-links
  preserve `redirect=/tags`. TypeScript, Astro production build, focused
  Hallmark scan (0 FAIL/REFLEX/WARN), and `git diff --check` pass. Rebuilt only
  the app container with existing volumes; health is `ok`, and Docker still
  enforces 256 MiB / 0.50 CPU. Personal account claims remain unverified.
- The create/import action in the shared search bar led guests on `/login` back
  to that same route. Auth-page search now keeps public search, hides create and
  import for guests, and omits sign-in/create calls to action from no-result
  states. The input's accessible name reflects the available actions. TypeScript
  and Astro builds pass, the focused Hallmark audit reports 0 findings, the
  production browser confirms “Search resources” remains available without the
  plus action, and the rebuilt app is healthy under the same container limits.
- The tag index's prior inline style block contained hard-coded colors,
  typography set through inline style, an emoji icon, uppercase labels, and no
  useful empty state. Hallmark scan surfaced those issues. The redesigned page
  uses token-based CSS and the shared EmptyState, Button, and Badge components;
  guest and signed-in empty states now offer an appropriate next step, and DB
  errors are distinct from a genuinely empty tag list. At 390px the sample
  column hides while tag links and counts remain available. Manual CUA review
  in dark and light themes confirmed the visual layout; a computed-style check
  caught and fixed uppercase table counts. Final Hallmark scan reports 0
  FAIL/REFLEX/WARN; TypeScript, Astro build, `git diff --check`, and production
  health checks pass with the app at 256 MiB / 0.50 CPU. Hallmark's Puppeteer
  render tier remains unavailable, so browser review was manual CUA.
- 2026-11-11: The homepage now asks PostgreSQL to project only metadata needed
  for listing work on non-active rows, then loads complete metadata for the
  active resource. E2E confirms aliases, canvas data, graph rendering, and
  permissions still work. In a profiled 100-user / 500-resource tight run,
  garbage collector samples fell from 14.1% to 8.6% and `parseRow` from 1.9% to
  0.8%; the unprofiled overload still had 6.38–6.70s p95 and remains unresolved.
  A 10-second-think paced run returned 299/299 HTTP 200 at 100 users, with
  163/210ms authenticated/anonymous p95 and 324.9MiB summed sampled peak serving
  memory. App/host PSI remain above target; physical 1-vCPU/1-GiB validation is
  still required.
- 2026-11-11: Restored the missing token-based tag-index stylesheet referenced
  by the current page work. A production screenshot found the mobile top bar
  search overlapped the brand; it now uses a dedicated full-width row and keeps
  controls within the viewport. The new E2E checks 390px and 320px, and the full
  suite passes 90 tests with one destructive opt-in skipped. The app was rebuilt
  with the current source without recreating database or content mounts; health
  is `ok` and the five service limits remain 832MiB / 0.98 CPU.
- 2026-11-11: Verified raea 0.1.0 and its skill are installed for Codex,
  OpenCode, and Antigravity through the canonical shared skills directory. Raea
  is for GPU-rendered video, motion graphics, 3D, and games; it does not address
  this web application's CPU capacity work.
- 2026-11-11: A profiled paced run with 100 users, 500 resources, 33% mixed
  authenticated traffic, 10 identities, and 10-second think time returned
  299/299 HTTP 200 with 193/282ms auth/anonymous p95. Mean app/serving CPU was
  24.27%/35.62%, and sampled peak serving memory summed to 328.9MiB. The profile
  shows 5.8% GC and 5.8% React response writes among 21,014 samples; no single
  application function dominates active CPU samples. An unprofiled 5-second
  think run returned 517/517 HTTP 200 but p95 rose to 2.29/2.77s and app PSI
  reached 47.93% `some` / 26.57% `full`; this cadence remains unresolved.
- 2026-11-11: Reconciled stale plan notes with current routes: the initial
  contextual graph is SSR-preloaded and bounded, while fullscreen graph loading
  remains on demand; folder and tag resource routes use `ResourceShell`, and
  `/tags` remains a permission-aware discovery page by design. Corrected the
  local E2E count in the plan index to 90 passing / 1 destructive opt-in skipped.
- 2026-11-11: A 10-user / 500-resource run at 1-second think time returned
  269/269 HTTP 200 (8.97 requests/s), with 288/356ms auth/anonymous p95 and
  306.5MiB summed sampled peak serving memory. App/serving CPU averaged
  26.13%/38.08%; app/host PSI peaked at 28.38% `some` / 25%. Host PSI remained
  high at moderate serving CPU, so shared-host pressure cannot isolate
  application contention.
- 2026-11-11: Extended the constrained load generator to cycle across homepage,
  public document, tags, search, and full graph reads, reporting status and
  latency per route. At 100 users and 10-second think time, it returned 300/300
  HTTP 200 at 10 requests/s; auth/anonymous p95 was 263/148ms, mean
  app/serving CPU was 18.31%/29.33%, and summed peak serving memory was
  331.5MiB. The full route suite now passes 93 tests with one destructive
  opt-in skipped; all 686 unit tests pass and TypeScript is clean. App/host PSI
  remained high on this shared host. The default short smoke uses only `/` so
  every configured path gets measured coverage in the capacity mode.
- 2026-11-11: Rebalanced serving CPU limits to app/PostgreSQL/OpenFGA/
  Meilisearch/Valkey CPU limits (0.98 total), keeping all
  memory ceilings unchanged. Two isolated 100-user mixed-route 5-second-think
  runs improved to 18.39 and 19.01 requests/s; auth/anonymous p95 was 1,050/
  1,642ms then 565/630ms. App throttled time fell from the 0.50-CPU baseline's
  7.56s to 4.12s and 3.12s; app PSI `full` maxima fell from 34.09% to 22.73%
  and 16.60%. Shared host PSI remains noisy. Applied the new CPU ceilings to
  the local Compose services and rebuilt only the app; database and content
  volumes were retained. `docker inspect` confirms each live limit and health
  is `ok`.
- 2026-11-11: A 10-user constrained mixed-route run on the rebalanced quota
  completed 99/99 HTTP 200 requests at 9.9 requests/s with three authenticated
  users across two identities. Authenticated/anonymous p95 was 26/33ms; sampled
  serving CPU averaged 8.35% total and sampled peak serving memory summed to
  251.2MiB. App PSI peaked at 15.2% `some` / 8.3% `full`; host PSI peaked at
  10.25%. This validates the load harness connection policy at 10 users but
  does not prove sustained 100-user capacity on a dedicated 1-vCPU host.
- 2026-11-11: Full E2E first exposed an OAuth test race before the chrome
  preference bootstrap settled. The test now waits for the selected chrome
  mode and a single visible account control; focused OAuth passed 3/3 and full
  E2E passed 100/100 with one destructive opt-in skipped. Unit tests passed
  685/685, TypeScript, Compose validation, and `git diff --check` passed.
- 2026-11-11: Repeated a 100-user mixed-route, 5-second-think run with the
  revised independent-connection harness and live quota allocation. It returned
  586/586 HTTP 200 at 19.48 requests/s; auth/anonymous p95 was 365/398ms, app
  cgroup PSI peaked at 36.77% `some` / 14.16% `full`, and throttled time was
  2.52s. Mean serving CPU was 39.85% of one core and summed sampled peak memory
  was 395.4MiB. Two test-only quota candidates lowered app `full` PSI to 10.95%
  and 9.82%, but their mixed p95 trade-offs do not justify changing the live
  allocation on this noisy shared host. Dedicated 1-vCPU validation remains
  open.
- 2026-11-11: A diagnostic V8 profile of that mixed route sampled 30.46 CPU
  seconds, including 5.07s GC, 0.37s React stream writes, 0.23s PostgreSQL row
  parsing, 0.15s permission filtering, 0.13s tree building, and 0.09s backlink
  building. A specialized tree-preview implementation was tested and then
  reverted because an unprofiled 100-user repeat did not improve CPU or memory;
  the profile shows this helper is a small share of app CPU at the measured
  500-resource corpus size. Full unit/E2E suites and TypeScript passed with the
  optimization before it was reverted; the simpler implementation was already
  covered by the prior full passing suites.
- 2026-11-11: Extended opt-in V8 profiling to capture heap allocation samples.
  Inspector overhead accounted for a large part of sampled allocations; after
  excluding it, allocations were distributed across Redis/cache protocol,
  React SSR, and graph/tree helpers, without a clear application hotspot. Also
  removed the unused `tags` metadata field from workspace-list candidate rows
  and added a projection invariant test. Two 100-user unprofiled repeats passed
  590 and 579 requests at 19.62 and 19.22 requests/s, with mean app/serving CPU
  25.83%/38.34% and 17.49%/30.52%, and summed sampled peak memory of 359.1 and
  397.5MiB. Authenticated p95 was 374 and 584ms, so the variable tail and noisy
  host do not prove a win for the field projection change. Full E2E passed
  100/100 with one destructive opt-in skipped; unit tests passed 686/686 and
  TypeScript, Compose validation, and `git diff --check` passed.
- 2026-11-11: Reconciled the Quartz gap ledger with current routes and E2E
  evidence. Folder index generation and both tag routes were incorrectly still
  marked as missing even though they ship; the plan now records them as shipped
  and retains only tag autocomplete as an unverified follow-up. The right
  sidebar graph remains preloaded with page data; fullscreen expansion alone
  requests the full graph.
- 2026-11-12: Added opt-in authenticated saves to the isolated capacity harness,
  provisioning one private note per synthetic identity on a temporary writable
  content mount. Corrected per-user route offsets and parsed the final JSON
  report line so the harness verifies every weighted route. A 100-user,
  5-second-think mixed read/write run returned 571/571 HTTP 200 at 19.03
  requests/s, including 66 saves. Authenticated/anonymous p95 was 807/685ms;
  save p95 was 275ms. Mean app/all-serving CPU was 25.90%/39.35%, summed peak
  sampled memory was 401.8MiB, app PSI peaked at 36.62% `some` / 15.95% `full`,
  and app throttling totaled 3.16 CPU-seconds. The focused capacity E2E passed;
  the test app runs as Compose's `1000:1000` user and removes its temporary
  content mount during teardown. App pressure remains above target; import
  traffic and dedicated-host validation remain open.
- 2026-11-12: Compared the same write mix against a test-only 0.68/0.20/0.05/
  0.025/0.025 CPU allocation. The candidate returned all 561 requests at
  18.54/s, with auth/anonymous p95 1,132/1,196ms and save p95 1,307ms. A repeat
  at the current 0.60/0.20/0.08/0.05/0.05 allocation returned all 552 requests
  at 18.28/s, but p95 varied to 1,855/1,932ms and save p95 326ms. Shared-host
  PSI moved from 41.62% on the candidate to 28.29% on the baseline, and same
  quota latency varied substantially. No quota change is justified by this
  comparison; real-host validation remains open.
- 2026-11-12: Closed the editor save/exit integration gap. Exit flushes pending
  or in-flight saves before navigating and keeps the editor open when saving
  fails. A synchronous dirty-state ref prevents a stale `beforeunload` handler
  from blocking the successful navigation. E2E now verifies repeated Ctrl+S
  shares one request, exit waits on success or failure, and source edits remain
  in the saved payload after changing views. The focused editor suite passes
  14/14; TypeScript passes.
- 2026-11-12: Re-ran verification on the current worktree: 686 unit tests and
  106 E2E tests passed, with one explicit opt-in test skipped; TypeScript,
  production build, and `git diff --check` passed. The graph browser check
  confirms the contextual right-sidebar graph appears automatically without a
  Load Graph action or full-graph request; fullscreen expansion makes one full
  graph request. An idle host snapshot showed 2.46% CPU PSI `some avg10` and
  0% `full avg10` with the app constrained to 0.60 CPU / 256 MiB. This does
  not establish the 100-user pressure target, which remains open.
- 2026-11-12: A constrained 100-user, 500-resource mixed read/write repeat
  returned 566/566 HTTP 200 at 18.63 requests/s. With 33 authenticated users
  across 10 identities, p95 was 709/733/729 ms for authenticated/anonymous/save
  requests. Mean app/all-serving CPU was 36.61%/52.78%, sampled peak serving
  memory 396.4 MiB, app PSI 45.63% `some` / 20.27% `full`, and throttled time
  3.57 CPU-seconds. Host PSI peaked at 29.68%; optional observability containers
  were running and remain outside the serving measurements. The repeat meets
  latency and memory limits but not the CPU-pressure target.
- 2026-11-12: A matched profiled run returned 528/528 HTTP 200 but degraded
  authenticated/anonymous/save p95 to 2,306/1,605/2,950 ms due to profiler
  overhead. The CPU profile was 44.19% idle and 10.36% GC; PostgreSQL parsing
  and React SSR were each about 1% of samples, with no dominant application
  function. Allocation samples were inspector-dominated and are inconclusive.
- 2026-11-12: Hallmark app-scope source audit of UserMenu, MobileNavDrawer,
  ActionRail, and chrome.css reports zero findings. Render review could not run
  without `puppeteer-core`; the browser automation host was unavailable. Keep
  the real-account visual review open because synthetic fixture evidence does
  not prove personal-account claims.
- 2026-11-12: Re-ran the synthetic account-menu browser check at 390 × 400;
  Escape focus restoration, focus-exit dismissal, and reachable Sign Out pass.
  The browser automation host is unavailable, so this does not close the real
  personal-account verification item.
- 2026-11-12: Compared Node's 8 MiB and 16 MiB young-generation semi-space on
  the same constrained 100-user / 500-resource mixed read/write workload. The
  16 MiB candidate slightly reduced app CPU/PSI and throttling, but its
  authenticated/anonymous p95 rose to 1,293/1,139 ms and sampled serving memory
  grew from 372.5 to 408.3 MiB. Host PSI also varied between runs. No production
  tuning change is justified; the temporary capacity-test override was removed.
