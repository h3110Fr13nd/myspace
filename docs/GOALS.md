# Product and Engineering Goal

**Status:** Active source of truth
**Last reviewed:** 2026-11-12
**Applies to:** the FOSS Content Workspace application and its default runtime

### Current account-navigation evidence (2026-11-12)

The account dropdown now dismisses when keyboard focus leaves it and scrolls
within short viewports. Long account names and addresses wrap. The focused
browser check verifies link traversal, Escape focus restoration, focus-exit
dismissal, and reachable Sign Out at 390 × 400. TypeScript and production build
pass. Focused Hallmark source lint reports zero findings; its render tier did
not run because Puppeteer is unavailable. Personal-account identity and theme
screenshot review remain open; the synthetic fixture is not evidence for them.

### Sharing recovery evidence (2026-11-12)

The Share dialog shows a retryable load error instead of an empty permission
manager when access details cannot be read. Superseded permission responses
cannot replace the current selection. Copy Link uses an encoded resource route,
awaits the clipboard write, and reports clipboard failure through the shared
toast. The dialog title now names sharing and the resource. A browser harness
passes request-failure/retry, denied ACL, clipboard rejection, and successful
encoded-link checks. TypeScript and production build pass. Hallmark's standalone
component scan cannot see shared control states; scanning those dependencies
finds five existing failures and four reflex findings in primitives.css, still
requiring remediation. Its render tier is unavailable without Puppeteer. These
checks do not prove persisted grants or distinct-user access behavior.

### Shared-control polish (2026-11-12)

The five Hallmark failures and four reflex findings above are now resolved in
primitives.css: token-based shadows and spacing, sentence-case badges, and a
solid accent primary button. The scan including ShareModal, Button, and shared
primitive styles reports zero findings. TypeScript and production build pass.
Standalone Chromium previews were inspected in dark and light themes, including
keyboard focus, disabled buttons, badges, and selected resource cards. This is
component preview evidence; full-page and contrast review remain open. Hallmark's
own render tier remains unavailable without Puppeteer.

### Current verification rerun (2026-11-12)

The current worktree passes all 686 unit tests, all 106 non-destructive E2E
tests (one explicit opt-in test is skipped), `npx tsc --noEmit`, the Astro
production build, and `git diff --check`. The graph E2E confirms that the right
sidebar contextual graph appears without a Load Graph action or a full-graph
request; expanding the graph makes exactly one full-graph request. An idle host
PSI snapshot read `some avg10=2.46%` and `full avg10=0.00%`, with the live app
capped at 0.60 CPU and 256 MiB. This idle reading does not replace the 100-user
load result: app pressure under that workload remains above target.

Hallmark's app-scope source audit of UserMenu, MobileNavDrawer, ActionRail,
and chrome.css reports zero findings. Its render tier could not run because
`puppeteer-core` is not installed, and the available browser host is
unavailable. The actual personal-account browser pass-through remains open;
the passing account journeys use synthetic identities. The 390 × 400 synthetic
account-menu browser check passes focus-exit dismissal, Escape restoration, and
reachable Sign Out.

### Shared label contrast (2026-11-12)

Filled primary/danger actions now use darker accent-derived background tokens.
Badge labels use theme text while preserving colored fills and borders; badges
explicitly inherit the design-system body font. The Chromium contrast check
passes four resting button variants and eleven badge variants over the page
background in both themes and all five accent palettes (150 combinations), each
at least 4.5:1. Emerald light/dark previews were inspected. TypeScript and build
pass; focused primitive source lint is clean. This does not cover gradient
buttons, hover/disabled states, or every containing surface.

### Create-location recovery (2026-11-12)

Creation now exposes save-location loading and failure with Retry instead of
silently hiding the picker. When no location is selected, submission waits for
successful location loading. Existing choices survive retries, and cancelled
requests cannot change a later dialog. A browser harness verifies failed
location loading, retry to the personal folder, preserved title, and retained
title/location after a failed creation request. TypeScript, production build,
and focused Hallmark lint pass. This mocked recovery check does not prove real
resource persistence or the import journey.

### Reader-route anchor integration (2026-11-12)

The available in-app browser has no signed-in session; personal-account review
remains open. Its contents-link labels initially appeared absent, but Chromium's
accessibility snapshot confirmed their actual heading names. The route check
then reproduced a real defect: one contents click added two history entries.
The page delegate now honors already-handled and modified clicks, compares the
full path/query before treating a link as an in-page jump, safely handles invalid
fragment encoding, moves focus to the target, and respects reduced motion.
TypeScript and production build pass. The deployed Chromium check passes one
history entry/scroll, heading focus, instant reduced-motion scroll, and checked
new-tab cross-document/modified/malformed links. Same-tab navigation remains
part of the broader Astro-router journey review. The app health endpoint passes.

### Reader history and skip navigation (2026-11-12)

The deployed reader check now proves same-tab navigation to another public note
and restoration through Back/Forward. It also reproduced a skip-link defect:
the old target was an empty span before the workspace explorer. ResourceShell
now gives its main landmark the skip target and focusability; BaseLayout omits
the placeholder on workspace routes. The deployed check passes keyboard
activation, focus on the single main target, and subsequent Tab bypassing the
explorer. All three reader-route checks, TypeScript, and production build pass.
Folder/tag keyboard integration and broader visual review remain open.

### Folder/tag recovery (2026-11-12)

Empty folder/tag pages now provide a browse action; tag pages avoid duplicating
the empty-state action in the header. Candidate/permission-read failures are
classified as errors, with Retry and a 503 response, rather than empty content.
Missing folders return 404 and provide a workspace link. Folder/tag chrome uses
SVG icons while preserving custom folder icons. A browser check caught an
Astro-to-React action-prop rendering error introduced during this change; named
slots corrected it, including the existing tags-index empty-state pattern.
The deployed 390px check passes empty-tag links in both theme settings,
missing-folder recovery/status, and main-target keyboard focus on both routes.
TypeScript, build, and focused Hallmark lint pass; application health passes.
The tags-index empty branch, empty accessible-folder fixture, service fault
injection, and visual theme screenshots remain unverified.

### Import recovery and pending state (2026-11-12)

Creation/import now locks its fields, type switch, and Cancel while submitting.
A synchronous in-flight guard prevents duplicate form requests and replacement
through global open events. Escape/close during submission keeps the dialog open
and explains that the current request must finish. The browser harness passes
PDF file/title retention after a failed request, pending field locking, duplicate
submission prevention, and identical payload on retry followed by navigation.
Both create-recovery checks, TypeScript, production build, and focused Hallmark
lint pass. This harness mocks the API: backend file persistence, permission
failures, and recovery from a request that never settles remain open.

### PDF import/read integration (2026-11-12)

Inspection found that imports stored a vault-specific object key while the PDF
reader requested a legacy id.pdf key. A failed read generated and stored a
sample PDF, masking missing originals. The reader now resolves the registered
key and streams the object body, without accumulating the imported PDF in a
second application buffer or generating replacement content. Legacy local and
legacy object-key reads remain supported. Missing objects return 404; storage
or metadata failures return 503.

The disposable E2E environment now owns an in-memory S3 wire fixture and overrides
storage settings for both normal and constrained app runs; teardown closes it.
The UI import integration passes exact-byte upload/read comparison, reload,
anonymous denial of the private PDF, and missing-object 404 after deleting only
the fixture object. TypeScript and the production build pass. This verifies the
SDK/application pipeline against a disposable fixture, not external-provider
durability, service outage recovery, image/Google import, or hanging requests.

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
more than **832 MiB** and **0.98 CPU**:

| Service | Memory ceiling | CPU ceiling | Role |
|---|---:|---:|---|
| App | 256 MiB | 0.60 | Astro SSR, APIs, UI |
| PostgreSQL | 256 MiB | 0.20 | Durable application data and OpenFGA datastore |
| OpenFGA | 96 MiB | 0.08 | Relationship-based authorization |
| Meilisearch | 160 MiB | 0.05 | Full-text search |
| Valkey | 64 MiB | 0.05 | Cache, sessions, rate limits, optional jobs |
| **Total** | **832 MiB** | **0.98** | Reserves 192 MiB and 0.02 CPU for host/runtime |

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

## Current State (2026-11-12)

### Verified runtime

- The default serving stack is app, PostgreSQL, OpenFGA, Meilisearch, and Valkey.
  Compose hard limits total **832 MiB and 0.98 CPU**; optional observability and
  infrastructure profiles are outside that serving budget.
- The live five-service stack enforces the rebalanced Compose limits: 832 MiB
  and 0.98 CPU total. App is 256 MiB / 0.60 CPU, PostgreSQL 256 MiB / 0.20 CPU,
  OpenFGA 96 MiB / 0.08 CPU, Meilisearch 160 MiB / 0.05 CPU, and Valkey 64 MiB /
  0.05 CPU. Docker inspection confirms these values; the app was rebuilt without
  recreating its database or content volumes. Health reports dependencies
  healthy, and `/` returns HTTP 200 with the contextual graph and no Load Graph
  action. Rechecked at 2026-11-11 12:16 UTC; the app container is healthy with no
  restarts or OOM kills.
- The standalone mobile top bar no longer overlaps the workspace name with
  search. Search occupies a full-width row; duplicate tag/shortcut controls are
  removed from the mobile bar, and guest sign-in/register remain in the drawer
  at 320px. A Playwright production screenshot was reviewed at 390px and the
  E2E regression covers both 390px and 320px.
- The right sidebar graph is rendered automatically with the page; its browser
  check confirms the contextual graph appears without a manual load action or
  duplicate full-graph API request. Fullscreen expansion fetches the full graph.
- The global “Workspace access” studio link is now shown only to accounts with
  workspace-level `manage_grants`. The capability is checked when an account
  or mobile navigation menu opens, so ordinary page loads do not add another
  authorization call. E2E covers both a regular account and a workspace admin.
- Current verification: 106 E2E tests pass (one explicit opt-in test is skipped)
  after the mixed-route capacity harness, OAuth chrome-readiness check, and
  editor save/exit coverage; all 686 unit tests pass. TypeScript, the production
  build, Compose config, and `git diff --check` pass. The full E2E suite also verifies the mobile header
  at 390px and 320px. Constrained runs cover 100 users and 500 resources with
  the live Compose quotas.
- IAM grant choices in both the Vault Matrix and Cloud IAM role filter now come
  from the resource's declared model relations. The Vault Matrix browser check
  confirms it offers viewer/editor/owner and omits invalid commenter/downloader
  choices.

### Capacity evidence

Earlier repeated isolated Testcontainers capacity runs used the original
candidate Compose hard limits, capping the app at 256 MiB / 0.50 CPU and the
four backing services at their original candidate ceilings. They used 500 synthetic
public resources and 100 virtual users, 33% authenticated traffic across 10
verified synthetic identities, 30 seconds of traffic, and a 10-second think
interval. All serving containers were pinned to CPU 1 on this 16-core host;
optional services and the load generator were outside the serving caps. The
monitor sampled resource usage every five seconds.

| Measure | Result |
|---|---:|
| Requests | 299–300 HTTP 200 across repeated candidate runs |
| Throughput | 9.97–10.00 requests/s |
| Authenticated p95 latency | 137–178 ms |
| Anonymous p95 latency | 115–127 ms |
| Mean app CPU | 21.64–23.51% of one core |
| Mean all serving services CPU | 29.41–31.86% of one core |
| Sum of each service's peak sampled memory | 357.5–393.2 MiB |
| App CPU PSI `some` max / `full` max | 18.99–19.58% / 10.20–10.41% |
| Host CPU PSI `some` max | 33.88–34.26% (shared host; not attributable to these containers) |
| App CFS throttled periods / total periods | 46–57 / 314–318 |
| App cumulative throttled time | 1.58–1.67 CPU-seconds |

These candidate results follow a controlled app quota rebalance from 0.40 to
0.50 CPU, reducing PostgreSQL from 0.25 to 0.20, OpenFGA from 0.15 to 0.10,
and Meilisearch from 0.10 to 0.08 (the total remains below 1 CPU). The baseline
single-core run had 92/321 throttled periods, 4.25 throttled CPU-seconds, and
app PSI `some`/`full` maxima of 30.28%/19.33%. Candidate repeats lowered those
to 46–57/314–318 periods, 1.58–1.67 throttled CPU-seconds, and
18.99–19.58%/10.20–10.41%. Candidate app memory peaked at 181–193 MiB versus
112 MiB in the baseline, still below the 256 MiB app cap. This is a promising
latency/throttling trade, not a completed target: app CPU `full` PSI remains
above 10%, the host was noisy, and a physical 1-vCPU/1-GiB validation is open.
The 500-resource run before the quota experiment returned 22.73% app CPU,
32.02% mean serving CPU, 305.4 MiB peak sampled memory, and app/host PSI of
14.70%/17.57%. Removing unused timestamps also eliminates `parseDate` from the
post-change V8 profile (the preceding profile sampled 0.51 s there), but no
overall CPU reduction has been established.

Ten synthetic
identities provide multi-account ACL coverage but do not represent real account
behavior or production data. The observed host/app PSI peaks exceed the stated
steady-use target. In particular, this run does not explain the previously
observed 20%+ observer pressure or prove that issue resolved. Earlier
100-client tight-loop profiles saturated the app quota with multi-second tail
latency; compare the current result before claiming that workload resolved.

The earlier 500-resource, 100-user mixed-auth run exposed excess server work:
the workspace explorer serialized every resource row on every page view. The
tree now sends a 25-sibling preview, keeps the active path in view, and loads
the full authorized tree only when someone asks to reveal more. E2E verifies
that the remainder stays reachable.

A paired V8 profile after lazy tree serialization sampled 30.3 seconds: about
3.7 seconds were garbage collection, 13.7 seconds idle, and Astro hydration
serialization about 0.3 seconds. An earlier profile with 50 initial tree rows
spent about 10.4 seconds in garbage collection, with row parsing and island
serialization next. Node permits an 8 MiB V8 semi-space within the 192 MiB
old-space ceiling. In the latest unprofiled load, app RSS peaked at 117.1 MiB;
keep measuring before raising any ceiling. The new profile's cumulative sampled
self time in permission filtering, tree preview, and graph-link resolution was
about 0.17s, 0.08s, and 0.09s respectively. These are small per-request costs;
avoid adding complexity to those paths until a tighter-load profile shows they
dominate.

The 2026-11-11 homepage listing change selects only metadata needed for
authorization, lookup, the contextual graph, backlinks, and the tree on other
resources. The active resource still loads its complete metadata, preserving
canvas and editor payloads. Under a profiled 100-user, 500-resource,
one-second-think workload, garbage collection fell from 14.1% to 8.6% of
sampled CPU ticks and PostgreSQL `parseRow` fell from 1.9% to 0.8%. The paired
unprofiled tight-load run returned 516/516 HTTP 200, used 27.34% mean app CPU,
and peaked at 367.6 MiB summed sampled serving memory. Its p95 was 6.38–6.70
seconds and app PSI peaked at 48.27% `some` / 27.86% `full`; this remains a
saturation failure. Host PSI reached 50.09%, so this comparison is noisy and
the CPU profile is diagnostic, not a capacity claim.

The paired paced run used 100 users, 500 resources, 33% authenticated traffic
across 10 synthetic identities, 30 seconds, and 10-second think time. It
returned 299/299 HTTP 200 at 9.97 requests/s; authenticated/anonymous p95 was
163/210 ms. Summed serving memory peaked at 324.9 MiB and mean app/all-serving
CPU was 24.62%/34.16% of one core. App PSI peaked at 22.13% `some` / 9.20%
`full`, while host PSI reached 25.38%. It fits the hard resource ceilings and
latency target, but app/host `some` pressure remains above target and needs a
quieter real 1-vCPU/1-GiB host run.

The next profiled paced run on the current worktree used the same 100 users,
500 resources, 33% authenticated traffic, 10 identities, and 10-second think
interval. It returned 299/299 HTTP 200 (9.92 requests/s), with authenticated
p95 193 ms and anonymous p95 282 ms. Mean app/all-serving CPU was
24.27%/35.62%; summed per-service sampled peak memory was 328.9 MiB. App PSI
peaked at 34.68% `some` / 14.79% `full`, and host PSI at 26.74%. Its 30.3-second
V8 profile contained 21,014 samples: 78.0% idle, 5.8% garbage collection,
5.8% React `writeChunk`, and 0.3% `parseRow`; permission filtering, sidebar
graph construction, and permission checks were each below 0.3%. This confirms
that garbage collection and SSR are the largest visible Node costs, but no
single application function dominates the active CPU samples. Profile output
is diagnostic; do not compare it as an unprofiled capacity result.

A subsequent unprofiled 100-user run with 5-second think time returned 517/517
HTTP 200 at 16.26 requests/s. Authenticated/anonymous p95 rose to 2,291/2,769
ms; mean app/all-serving CPU was 28.92%/43.47%, summed sampled peak memory was
352.3 MiB, and app PSI peaked at 47.93% `some` / 26.57% `full` (host `some`
37.11%). App CFS throttled 185 of 387 periods for 6.42 CPU-seconds. This is
within hard memory and CPU ceilings but misses the latency/pressure objective.
The host was shared and noisy, so rerun on a dedicated 1-vCPU host before
attributing all pressure to the application. The profile and this higher-rate
run make the paced-profile requirement complete, but demonstrate that the
100-user target is not yet proven for this request cadence.

The five-route 100-user / 5-second-think run then returned 535 requests at
17.81 requests/s on the 0.50/0.20/0.10/0.08/0.10 allocation. Authenticated and
anonymous p95 was 1,789/1,520 ms; mean app/all-serving CPU was 30.98%/48.32%,
sum peak memory 385.8 MiB, and app PSI peaked at 61.41% `some` / 34.09% `full`.
The app throttled 228/363 periods for 7.56 CPU-seconds.

Two isolated repetitions rebalanced the same 0.98 total CPU to
0.60/0.20/0.08/0.05/0.05 (app/PostgreSQL/OpenFGA/Meilisearch/Valkey), preserving
all memory ceilings. Throughput was 18.39 and 19.01 requests/s. Authenticated
p95 was 1,050 ms then 565 ms; anonymous p95 was 1,642 ms then 630 ms. App
throttling fell to 4.12 and 3.12 CPU-seconds; `nr_throttled` fell to 193/420
then 124/358 periods. App PSI `full` peaks fell to 22.73% and 16.60%, and
summed sampled peak memory was 355.5 and 363.0 MiB. App CPU increased to
35.06–36.17% of one core, as expected from the larger quota. Host PSI varied
from 23.31% to 30.59%; the repeats still miss the pressure target, but the
latency/throttling results support this reallocation.

A 10-user comparison used 1-second think time (about the same request rate as
the 100-user / 10-second run). It returned 269/269 HTTP 200 at 8.97 requests/s;
authenticated/anonymous p95 was 288/356 ms. Mean app/all-serving CPU was
26.13%/38.08%, and summed peak sampled memory was 306.5 MiB. App PSI still
peaked at 28.38% `some` / 11.94% `full`, while host `some` reached 25%. Since
the host PSI stays high at this low request concurrency and moderate CPU usage,
the shared host is a significant confounder for PSI. This run supports the
latency target near 9 requests/s for 10 users but does not prove the 100-user
target or explain the higher-cadence tail latency.

The capacity harness now cycles through a weighted read mix: homepage (40%),
public document (30%), tags (10%), Meilisearch (10%), and the full graph API
(10%). A constrained 100-user run at 10-second think time returned 300/300
HTTP 200 across all five paths at 10 requests/s, with 33 authenticated users
across 10 identities. Authenticated/anonymous p95 was 263/148 ms; per-route p95
was 188 ms homepage, 203 ms public document, 101 ms tags, 35 ms search, and
124 ms graph. Mean app/all-serving CPU was 18.31%/29.33%, and summed sampled
peak serving memory was 331.5 MiB. App PSI peaked at 26.54% `some` / 15.44%
`full`, with host PSI at 27.94%, so latency and resource ceilings passed while
the shared-host pressure measure remains inconclusive. These are mixed reads;
write/authoring workloads were not included in that run.

The opt-in write mode adds authenticated `/api/v1/resources/save` requests
against one disposable private document per identity. A constrained 100-user,
5-second-think read/write run returned 571/571 HTTP 200 at 19.03 requests/s,
including 66 saves. Authenticated/anonymous p95 was 807/685 ms and save p95 was
275 ms. Mean app/all-serving CPU was 25.90%/39.35%; summed peak serving memory
was 401.8 MiB. App PSI peaked at 36.62% `some` / 15.95% `full`, with 3.16
CPU-seconds throttled; host PSI peaked at 30.15% on the shared host. The run
meets request success, sub-second authenticated/anonymous p95, and resource
ceilings for this synthetic read/write workload, while CPU pressure remains
above target. Import traffic and editor-driven writes remain unmeasured.

A test-only 0.68/0.20/0.05/0.025/0.025 CPU allocation (app/Postgres/OpenFGA/
Meilisearch/Valkey; 0.98 total) ran the same read/write workload and returned
561/561 HTTP 200 at 18.54 requests/s, including 55 saves. Authenticated/
anonymous p95 was 1,132/1,196 ms and save p95 was 1,307 ms; mean serving CPU was
44.25%, summed sampled peak memory 371.3 MiB, app PSI `some`/`full` maxima
34.04%/12.71%, and host PSI 41.62%. A repeat with the existing 0.60 allocation
returned 552/552 HTTP 200 at 18.28 requests/s; authenticated/anonymous p95 was
1,855/1,932 ms and save p95 326 ms, while app PSI was 37.58%/17.28% and host
PSI 28.29%. These tails vary widely across same-quota runs, and host pressure
also moved; this does not establish a quota winner. Keep the live Compose
allocation unchanged pending controlled host validation.

A fresh 10-user run against the rebalanced quotas included three authenticated
users across two identities and the same weighted five-route mix. It completed
99 requests at 9.9 requests/s with HTTP 200 on every request; authenticated and
anonymous p95 was 26/33 ms. Sampled serving CPU averaged 8.35% of one core in
total; summed sampled peak memory was 251.2 MiB. App PSI peaked at 15.2% `some`
and 8.3% `full`, while host PSI peaked at 10.25%. This validates the revised
E2E harness connection policy at 10 users; it does not replace the earlier
100-user results or prove sustained capacity on a dedicated 1-vCPU host.

With the same revised connection policy, a fresh 100-user / 5-second-think
mixed-route run returned 586/586 HTTP 200 at 19.48 requests/s. Authenticated and
anonymous p95 was 365/398 ms; the full graph p95 was 283 ms. Mean app/serving CPU
was 26.38%/39.85%, summed peak serving memory was 395.4 MiB, and app cgroup PSI
peaked at 36.77% `some` / 14.16% `full`. App throttling totaled 2.52 CPU-seconds
over the 44-second sample; host PSI peaked at 41.83%. This is the strongest
current 100-user result, but app and host pressure remain above the goal's
thresholds, and the shared host prevents attributing host PSI to this stack.

A current-worktree repeat with 500 resources, 33 authenticated users across 10
identities, 30 seconds, a 5-second think time, and mixed saves returned 566/566
HTTP 200 at 18.63 requests/s. Authenticated/anonymous/save p95 was 709/733/729
ms. Mean app/all-serving CPU was 36.61%/52.78%; summed sampled peak serving
memory was 396.4 MiB. App PSI peaked at 45.63% `some` / 20.27% `full`, with
3.57 CPU-seconds throttled; host PSI peaked at 29.68%. This repeat meets the
latency and serving-memory limits, but fails the pressure target. Optional
observability containers were running on the shared host and are not included
in the five-service measurements.

A same-session Node young-generation comparison tested the existing 8 MiB
semi-space against 16 MiB on the same 100-user / 500-resource mixed read/write
workload. At 8 MiB, 573 requests completed at 18.99/s; authenticated/anonymous/
save p95 was 796/637/779 ms, app CPU was 32.95%, app PSI peaked at 40.02% `some`
/ 17.97% `full`, sampled peak serving memory was 372.5 MiB, and throttling was
3.65 CPU-seconds. At 16 MiB, 548 requests completed at 18.23/s; p95 was
1,293/1,139/751 ms, app CPU was 31.54%, PSI peaked at 37.35% / 16.54%, memory
was 408.3 MiB, and throttling was 2.79 CPU-seconds. Host PSI also fell from
29.11% to 24.97% between runs, so this is not a clean attribution. The small
CPU/pressure improvement came with worse read latency and higher memory; keep
the 8 MiB setting. The temporary test override was removed.

A test-only quota candidate of 0.68/0.18/0.06/0.03/0.03 CPU (app/PostgreSQL/
OpenFGA/Meilisearch/Valkey) reduced app `full` PSI to 10.95% and throttled time
to 1.04s, but increased authenticated/anonymous p95 to 912/866ms. A second
candidate preserved PostgreSQL at 0.20 CPU and used 0.68/0.20/0.05/0.025/0.025;
it returned 590/590 HTTP 200 at 19.61 requests/s, with 513/340ms auth/anonymous
p95 and 9.82% app `full` PSI. These measurements overlap within shared-host
variation and the candidate has a worse authenticated tail than the current
allocation. The live Compose allocation therefore remains 0.60/0.20/0.08/0.05/
0.05 pending a dedicated-host repeat.

A focused V8 CPU profile of the same 100-user mix sampled 30.46 CPU-seconds:
5.07s were garbage collection, 0.37s React response writes, 0.23s PostgreSQL
row parsing, 0.15s permission filtering, 0.13s tree construction, and 0.09s
backlink construction. No individual application helper dominates; the profile
itself raises app CPU and memory, so its latency and PSI are diagnostic only.
The profile motivated a direct tree-preview builder, but an unprofiled 100-user
repeat did not improve CPU or memory and had variable tail latency. That added
complexity was reverted. Keep the simpler full-tree-then-trim implementation
until a future larger-corpus measurement makes its cost material.

A matched 30-second profiled read/write repeat returned 528/528 HTTP 200, but
profiling raised authenticated/anonymous/save p95 to 2,306/1,605/2,950 ms and
app PSI to 52.28% `some` / 25.87% `full`; do not use it as a capacity result.
The V8 profile was 44.19% idle and 10.36% garbage collection. PostgreSQL row
parsing and React server rendering were the largest application samples at
1.08% and 1.02% each; no function dominated. The allocation profile was
dominated by inspector `post` stacks and is not reliable for application
attribution.

The V8 heap sampling extension captured allocations during that diagnostic
profile. The profile contains substantial inspector overhead; after excluding
that, sampled allocations are spread across Redis protocol/cache work, React
SSR, and graph/tree helpers, with no single application allocation hotspot.
Treat these samples as directional because of sampling and profiler overhead.
The workspace-list query no longer selects `tags`: active-resource metadata is
loaded separately, while listing helpers do not consume candidate-row tags.
A focused invariant test protects that projection. Two subsequent unprofiled
100-user repeats returned 590 and 579 successful requests at 19.62 and 19.22
requests/s. Their mean app/serving CPU was 25.83%/38.34% and 17.49%/30.52%;
summed sampled peak serving memory was 359.1 and 397.5 MiB. Authenticated p95
was 374 and 584 ms; app `some`/`full` PSI maxima were 32.53%/11.60% and
34.48%/13.30%. These noisy shared-host runs do not establish an improvement
from dropping the unused projection field, and CPU pressure remains above the
goal. Full unit tests now pass 686 tests, E2E passes 100 with one destructive
opt-in skipped, and TypeScript passes.

Membership tuple writes no longer schedule the unrelated full resource ACL
projection. They still use the central tuple writer and invalidate decision
caches. The reconcile scheduler now resets its timer on each content ACL
mutation, matching the documented trailing debounce. The homepage only checks
editor permission when edit mode is requested, removing an unnecessary OpenFGA
call on ordinary reads.

A host-run Astro dev server was briefly used for a UI review. Its first request
triggered an ACL projection reconciliation of 4,359 rows that took 6.379 s.
During that startup sample, the dev process showed about 78% CPU and 2.2 GiB
RSS; concurrently sampled default serving containers totaled about 216 MiB and
used negligible CPU. The host was already under unrelated pressure, so the CPU
PSI samples are not attributed to this request. This development-only sample
does not represent production serving, but it is a signal to profile startup
reconciliation separately and avoid running the dev server during constrained
serving measurements. The dev server was stopped after the sample.

## Open Requirements

1. Prove the 10–100 user target with a repeatable mixed-authentication workload,
   representative read and write route mix, and the serving CPU/memory limits.
   Current capacity soaks mix homepage, document, tags, search, graph, and
   authenticated save requests across multiple identities. Create provisions
   isolated save fixtures; import traffic remains unmeasured. Keep credentials
   out of logs.
2. Validate on a real 1-vCPU/1-GiB host when one is available. The current
   single-core affinity simulation does not reproduce a physical host's kernel,
   memory pressure, or noisy-neighbor behavior.
3. Continue the route/feature inventory across `plan/`, `docs/plans/`, feature
   flags, and reachable UI. Mark each item shipped, integration work, or deferred
   with a reason. Keep the open Hallmark UI findings and their verification
   status visible here. This pass corrected stale Quartz gap entries for folder
   indexes and tag routes, which already exist and have E2E coverage; the
   `/tags` resource-style note remains an explicit non-goal, and the scaling
   plan distinguishes the preloaded sidebar graph from fullscreen graph
   loading.
4. Audit and simplify navigation toward a single obvious next action. The
   workspace empty state now prioritizes creating a first note; folder/import
   remain in the explorer. Hallmark scoped audit and UI build verification pass;
   broader Hallmark findings remain open and need focused journeys and visual
   review.
5. Keep primary navigation actions directly tappable on touch devices. The
   guest mobile drawer (search, all resources, tags, sign-in, and registration),
   signed-in account drawer, and create/import flows are verified at 390px.
   The guest drawer's Search action hands focus to the existing workspace search
   field. A real-account review and the remaining authenticated navigation
   surfaces are still open.

## Next Work

0. Reduce app CPU pressure for the measured 100-user, 5-second think workload
   while retaining successful requests, sub-second p95 latency, and the hard
   resource ceilings. The latest run still shows app and host PSI above target.
1. Paced and 5-second-think read/write profiles are complete, but broad sampling
   found no dominant application function. The 5-second-think profile itself
   pushed p95 beyond the goal and is diagnostic only. A 16 MiB young-generation
   candidate modestly reduced app CPU and throttling but increased memory and
   missed read p95; keep 8 MiB. Next compare route and database timings on a
   quieter host, keeping profiler and tracing overhead separate from serving
   claims.
2. Continue the route/feature inventory across `plan/`, `docs/plans/`, feature
   flags, and reachable UI. Fix the highest-impact unfinished journey and
   update each plan's status. This pass corrected stale folder-index, tag-route,
   tag-resource, and graph-loading descriptions; remaining plans still need
   current-code review.
3. Review remaining authenticated journeys using the available seeded fixture.
   Synthetic-account checks confirm the application pass-through contract but
   do not confirm personal account claims. Continue focused Hallmark reviews
   and preserve the established token system.

## Decision Log

- Editor exit now flushes a queued or in-flight save before navigation and keeps
  the editor open when that save fails. The dirty-state ref updates synchronously
  so a stale `beforeunload` closure cannot block successful navigation. Browser
  coverage verifies repeated Ctrl+S shares one request, Exit waits on both save
  outcomes, and source edits persist after switching views. The focused editor
  E2E suite passes 14/14; TypeScript passes.

- Captured and inspected the 390px light-theme reader Properties screenshot:
  the button and stacked metadata rows are readable without duplicate disclosure
  or clipping. The fixture note body contains accumulated prior test edits, so
  this review covers metadata presentation only. Isolate editor test content
  before relying on broader fixture-body visual comparisons.

- Reader Properties route E2E passes at 390px: one button toggles the named
  panel and its aria-expanded state, no inner summary remains, property keys
  stack above values, and rows fit the viewport. This verifies disclosure and
  layout behavior; visual contrast/content review remains open.

- Reader property styling now lives in a token-based module using shared badge
  primitives. Keys and values wrap, and rows stack below 641px rather than
  truncating property names. Tag links have keyboard focus feedback. TypeScript,
  Astro build, and focused Hallmark scan pass; full disclosure render review
  remains open.

- Reader Properties now has one disclosure control. The inner details/summary
  and duplicate toggle hint were removed; the outer labelled button owns the
  hidden panel state. PropertiesPanel has only this caller. TypeScript and Astro
  build pass; remaining property-value styling and rendered disclosure review
  remain open.

- Chat reconciliation also found empty threads/messages API files and no
  chat-table references in application source/migrations. Plan 29's unsupported
  completion checkboxes are now unchecked and its status identifies unimplemented
  stubs. The journey inventory records the missing backend/schema evidence;
  source files and data were preserved.

- Added UX-JOURNEYS.md as a journey-level evidence ledger linked to this goal.
  It distinguishes component checks from complete flows and records note chat
  as an unintegrated stub: both reader chat components are empty and have no
  source references. No chat control was exposed or backend/data removed.

- Reader mode now exposes aria-pressed and synchronizes its styling/state on
  shell initialization. An isolated route-level browser check passes entering
  and leaving reader mode with matching body and accessibility state.
  TypeScript and production build pass.

- Contents activation now transfers focus to its heading without an extra
  scroll jump, enabling keyboard reading to continue at the selected section.
  Modified clicks retain native browser behavior. The focused browser check
  includes target focus and passes; TypeScript and Astro build pass.

- Two contextual-navigation browser harnesses pass together. Linked references
  retain explicit paths, provide an encoded document fallback, support Enter
  activation, and omit empty navigation panels. Contents navigation still
  verifies active location and reduced-motion behavior. Application-route ACL
  integration and visual review remain separate open checks.

- A focused browser harness now verifies contents navigation: clicking a long
  heading updates the URL fragment and aria-current, reduced motion selects
  instant scrolling, and the link stays within a narrow panel. The check passes
  without app/database fixtures. Reader-route integration and visual review
  remain open.

- Contents navigation now wraps long headings, exposes the active location with
  aria-current, and respects reduced motion when scrolling. Inline presentation
  moved to token-based CSS with keyboard focus feedback. TypeScript, Astro
  build, and focused Hallmark scan pass; rendered contents navigation remains open.

- Linked references now have named navigation, tokenized focus/hover/press
  styles, and a document-route fallback when no path is provided. Removed the
  unrelated Quartz badge. TypeScript, Astro build, and focused Hallmark scan
  pass; rendered backlink navigation verification remains open.

- On 2026-11-12, an isolated browser check verified reading-status storage
  failure and recovery: blocked writes preserve Read and show the error toast;
  restoring storage lets retry mark the resource unread. The check passes and
  changes only browser-local reading preferences.

- Reading-status storage failures now return a distinct failure result and
  show a shared error toast. The reader button retains its prior state when
  storage fails instead of falsely displaying unread. The tree uses the same
  helper and receives the same error feedback. TypeScript, Astro build, and
  focused Hallmark scan pass; blocked-storage browser verification remains open.

- Read/unread now uses shared buttons and Lucide status icons with token-based
  read styling, replacing inline colors and transition-all behavior. Existing
  local read-state storage behavior remains. TypeScript, Astro build, and focused
  Hallmark scan pass; storage failure feedback and rendered interaction review
  remain open.

- The complete editor E2E file passes all 11 tests on the isolated production
  fixture stack, including two-browser live synchronization, source switching,
  icon focus, properties, mobile/theme structure, save failure/retry, and exit
  cancellation. The sync contexts share one synthetic identity; distinct-user
  permissions and production transport configuration remain unverified. The run
  used E2E_APP_PORT=4324 because another process owned 4321 and was preserved.

- Full editor failure/retry E2E now passes: the first manual save returns 503,
  error feedback appears, source text remains, and success is absent. A second
  Save sends the retained text and reports success after the mocked response.
  Requests are intercepted; persistence and multi-viewer save integration remain
  open.

- A full editor E2E check now verifies unsaved exit cancellation: save requests
  return 503, source text is edited, Exit prompts, and dismissing the prompt
  preserves the source text and edit route. The isolated browser check passes.
  This describes the earlier flow; exit during a save is now covered by the
  flush-before-navigation checks above. Embedded callback integration remains
  open.

- The public-access checkbox browser check passes both directions: checked
  sends is_public=true and unchecked sends false through Save. Requests are
  intercepted, so no fixture is published. Database persistence and anonymous
  visibility after saving remain separate open verification requirements.

- A 390px editor E2E check passes in dark and light themes: the shell fits the
  viewport, split panes stack, Save remains visible, and title color responds
  to theme changes. Screenshots are attached to the test report. This is
  structural/theme behavior verification; full visual review remains open.

- Four focused editor integration checks pass on the isolated fixture stack:
  accessible property fields/public checkbox and tag add/remove, icon-picker
  selection and focus return, source-mode preservation, and import addition.
  The properties check intercepts saves; it verifies control interactions, not
  public-access persistence. Visual theme/mobile and permission persistence
  checks remain open.

- Icon-picker E2E exposed missing focus restoration in the shared Modal. Modal
  cleanup now restores the connected opener without scrolling. The isolated
  editor browser check passes selection, selected-state reopening, Escape, and
  focus return after both close paths. Broader modal regression review remains
  open.

- Three focused editor E2E checks pass on an isolated production fixture stack:
  source text survives Source-to-Split-to-Visual switching, MDX import addition
  works, and manual Save reports success. The mode-switch check intercepts save
  requests so its temporary text is not persisted. Updated test selectors match
  current Save and Keep live editing on labels; multi-viewer sync was not run.

- Editor footer guidance now wraps as three concise shortcut hints and omits
  the internal resource ID. Remaining heading/source wrappers use stylesheet
  classes. TypeScript and Astro build pass. Hallmark's selectable emoji-content
  findings are retained as intentional note icon choices; full rendered editor
  review remains open.

- Note icon selection now uses the shared modal and buttons, with labelled
  choices and selected state. This replaces the custom fixed-dark popup and
  inherits shared Escape/focus behavior. Existing user icon choices remain.
  TypeScript and Astro build pass; icon-picker integration review remains open.

- Visual and split editor panes now use theme surfaces and token spacing.
  Split view stacks below 768px and identifies its source pane as read-only.
  Source preview text wraps within its pane. TypeScript, Astro build, and
  stylesheet Hallmark scan pass; full editor responsive/theme review remains open.

- MDX imports now use shared labelled fields and explicit add/remove buttons.
  Enter and Add share one handler; blank and duplicate imports are not added.
  The advanced field is identified plainly and long entries can wrap.
  TypeScript and Astro build pass; rendered import interactions remain open.

- Tag editing now uses shared labelled input, badge, and button components.
  Add tag is explicit, blank input disables its button, and each remove action
  names its tag. Layout wraps with token spacing. TypeScript, Astro build, and
  stylesheet Hallmark scan pass; tag interaction/render verification remains open.

- Note visibility now uses a labelled public-access checkbox instead of calling
  every non-public note Private. Help text explains that disabling public access
  does not remove existing sharing grants. No permission semantics changed.
  TypeScript, Astro build, and stylesheet Hallmark scan pass; rendered properties
  and public-access persistence checks remain open.

- Category and Summary now use labelled shared field components, including
  associated summary help text. The properties panel uses theme tokens and a
  grid that fits narrow containers. TypeScript, Astro build, and stylesheet
  Hallmark scan pass; visibility, tags, imports, and rendered properties review
  remain open.

- The note title now has an accessible name and shared input focus/theme
  behavior. Its heading typography uses responsive tokens instead of white
  text and a removed outline. TypeScript, Astro build, and stylesheet Hallmark
  scan pass; rendered title and remaining properties-field review remain open.

- The editor shell now inherits its shared card surface rather than overriding
  it with a fixed dark palette and glow. Toolbar spacing and wrapping live in
  editor.css, with reduced shell padding on narrow screens. TypeScript, Astro
  build, and stylesheet Hallmark scan pass; rendered editor theme review remains
  open.

- The Markdown source field now has an accessible name and uses the shared
  input surface/focus styling, replacing its hard-coded dark palette and
  removed outline. Editor-specific typography and sizing use CSS tokens.
  TypeScript and Astro build pass; source-mode visual review remains open.

- Editor view and Properties controls now use shared buttons with selected and
  expanded states, replacing inline colors and emoji labels. Source-to-Split
  switching applies the source buffer instead of replacing it with stale visual
  content. TypeScript and Astro build pass; mode-switch browser coverage remains
  open.

- Collaboration's explicit keep-live preference is now exposed in presence
  state. The editor action alternates between Keep live editing on and Use
  automatic live editing, with pressed state tied to that preference rather
  than transport mode. Connection status remains separate. TypeScript and Astro
  build pass; multi-viewer transport and rendered interaction checks remain open.

- Collaboration feedback now distinguishes solo, connecting, and connected
  states. Viewer counts are labelled viewing, not connected peers. The control
  says Toggle live editing because the manager changes a preference and may
  automatically collaborate when others are present; it no longer promises an
  unconditional disconnect. TypeScript and Astro build pass; clearer explicit
  collaboration preference controls and live transport verification remain open.

- Editor collaboration now offers Start/Stop live editing instead of provider
  and billing jargon, using a shared button with pressed state. Save-bar controls
  wrap using token-based spacing. TypeScript and Astro build pass; live-session
  integration and signed-in mobile review remain open.

- The save coordinator browser regression now also rejects an in-flight save,
  checks that manual flush receives the failure without firing the saved
  callback, and retries the same pending edit successfully. The test passes
  with a maximum of one persistence request in flight throughout recovery.
  Full editor UI and exit integration verification remain open.

- A React-in-Chromium regression now verifies shared save serialization: an
  autosave is held in flight, a newer edit is submitted through manual flush,
  and flush resolves only after the latest snapshot saves. Peak concurrent
  persistence calls is one. The focused browser test passes without database
  fixtures or a development server. Failure/retry and editor exit integration
  coverage remain open.

- Manual Save and autosave now share the hook's in-flight promise. Flush waits
  for any current save and persists newer snapshots serially before resolving;
  errors propagate to manual save feedback. Retry uses the same handler. The
  separate manual snapshot acknowledgement path was removed. TypeScript and
  Astro build pass; delayed-save regression coverage is still required.

- Editor exit now checks unsaved changes before invoking an embedding parent's
  cancellation callback. Manual-save success callbacks run only when the
  submitted snapshot is still current, preserving newer edits in embedded
  editor flows. TypeScript and Astro build pass; callback/exit browser coverage
  remains open.

- Manual editor saves now acknowledge the submitted snapshot rather than
  treating edits made during the request as already persisted. Newer edits
  retain their dirty state and queue autosave; success text appears only when
  the submitted snapshot is still current. TypeScript and Astro build pass;
  delayed-save browser coverage remains open.

- Editor save feedback now uses token-based classes and a persistent polite
  status region. Saving, unsaved changes, save errors, and autosave completion
  can be announced without moving focus. TypeScript and Astro build pass;
  full editor Hallmark cleanup and signed-in render review remain open.

- Editor Save, Exit editor, and Retry save now use shared button primitives,
  replacing inline button styling. Save exposes Ctrl/Cmd+S through accessible
  shortcut metadata, and the footer describes both platforms. TypeScript and
  Astro build pass. The wider editor still contains legacy inline presentation;
  its Hallmark findings and rendered signed-in review remain open.

- Delayed-response search coverage now passes against the deployed app: an old
  request is held while a newer query completes, then released before checking
  that the new query and results remain. Together with recovery and dismissal,
  all three focused search browser checks pass. Real-account and broader route
  journey review remain open.

- Two focused production-browser checks pass for search recovery and dismissal:
  retry retains the query, Escape removes the result popup, Enter does not
  navigate from its closed state, and Arrow Down reopens the existing results.
  These checks use intercepted search responses and do not alter user content.
  Delayed-response race coverage and real-account journeys remain open.

- A focused browser regression check now forces search to return 503, verifies
  the error replaces “No matches,” and retries successfully with the original
  query retained. It passes against the production app. Search hints now direct
  error-state users to the retry button instead of describing hidden results.
  Broader keyboard cancellation and real-account review remain open.

- Search failures now clear cached result selection, preventing Enter from
  opening a result hidden by the error state. Enter also yields when Escape
  has closed the popup. Aborted response parsing cannot publish stale results.
  TypeScript, Astro build, and focused Hallmark scan pass; interactive failure
  and retry review remains open.

- Search now distinguishes request failures from genuine empty results and
  offers an in-place retry. Query changes cancel obsolete requests and pending
  debounce timers so old responses cannot replace newer results. TypeScript
  and Astro build pass; failure-state browser verification remains open.

- Fixed the anonymous document route's login return parameter: it now sends
  `redirect`, matching login and registration, instead of the unused `next`.
  This retains the requested document and edit intent through authentication.
  The redirect is relative so container ports cannot leak into browser navigation.
  The rebuilt app's HTTP 302 preserves both the document query and `edit=true`.
  TypeScript and Astro production build pass; live sign-in verification remains
  open for a real account.

- At that point, the 0.50/0.20/0.10/0.08/0.10 CPU caps were live on the five
  serving containers. The app was rebuilt from this checkout without recreating its
  content bind mounts or database containers. Health reports the database,
  OpenFGA, and Redis healthy; the homepage returns HTTP 200. The first request
  after the rebuild coincided with the boot ACL projection reconcile (4,359
  rows, 1.344 s); the next warm homepage request returned HTTP 200 in 23 ms.
  This startup cost is separate from the steady paced capacity sample.
- The homepage now projects listing metadata for non-active resources and
  loads complete metadata only for the active resource. The app was rebuilt
  with this source while preserving data mounts; health and the preloaded
  contextual graph were verified. On the paced 100-user run, p95 was 163/210 ms
  and summed sampled serving memory peaked at 324.9 MiB. The one-second-think
  overload still produced 6.38–6.70 s p95 and remains an open saturation issue.
  A paired profile showed GC share fall from 14.1% to 8.6% and PG `parseRow`
  from 1.9% to 0.8%; host pressure varied substantially between runs.
- Visual review of `/tags` found the mobile top bar's search island overlapped
  the brand while the action rail overflowed its container. The mobile header
  now places search on a full-width row, removes duplicate tag/shortcut controls
  from the bar, and keeps the action rail inside the viewport; sign-in/register
  remain in the drawer at 320px. Production screenshot review and a new 390px /
  320px E2E test pass. Full suite now reports 90 passed and one destructive
  opt-in skipped.
- Reworked the tag index around a token-based stylesheet and shared empty-state,
  button, and badge primitives. The page now uses a plain-language heading,
  tap-sized topic links, a responsive examples column, and distinct next steps
  for guests and signed-in users when no tags are visible. Database errors no
  longer appear as a misleading empty tag list. Hallmark app-scope scan is
  clean; its render tier remains unavailable because `puppeteer-core` is not
  installed. Manual CUA review at 390px in dark and light themes confirmed the
  layout; a live computed-style check confirmed count labels remain sentence
  case and the examples column hides at the narrow breakpoint. TypeScript,
  Astro build, and `git diff --check` pass. The app health check is `ok` under
  its existing 256 MiB / 0.50 CPU limit.
- Hallmark app-scope scan of the desktop/mobile account navigation and their
  CSS found 0 FAIL, 0 REFLEX, and 0 WARN across four files. Its render tier could
  not run because `puppeteer-core` is not installed. Guest mobile and auth-page
  journeys have since been reviewed with CUA; real-account identity and
  signed-in navigation review remain open. The earlier Playwright pass-through
  review used a seeded synthetic account.
- An early capped Testcontainers load ran 100 virtual users with 33% authenticated
  traffic distributed across 10 synthetic identities. All 300 requests returned
  HTTP 200; measured serving memory peaked at 325.3 MiB and mean serving CPU was
  15.63% of one core. The short sample recorded host/app CPU PSI peaks of
  11.45% / 13.73%, so it verifies the workload and memory envelope but does not
  meet the steady-use pressure target or explain the earlier 20%+ observer
  reading. Physical 1-vCPU/1-GiB validation remains open.
- A pre-rebalance 500-resource capacity run verified 100 synthetic users with
  authenticated requests distributed across 10 verified identities. The
  30s paced run returned 300/300 HTTP 200 at 10 requests/s and stayed
  below 304 MiB when summing sampled per-service peak usage. App and host PSI
  remained above target (14.15% / 17.52% peaks); continue optimizing and do not
  treat this simulation as meeting the final target.
- In the latest after-change paired profile, `parseDate` no longer appears in
  the sampled hot functions after listing queries stopped selecting unused
  timestamps. That profile also sampled 5.72 seconds in garbage collection and
  induced higher latency/memory than the unprofiled run; profiler-enabled
  results are diagnostic only and do not establish capacity improvement.
- Hot workspace, tree, graph, and tag listing paths no longer ask PostgreSQL
  to decode unused `created_at` and `updated_at` values into per-row JavaScript
  `Date` objects. Feed and sitemap paths retain timestamps. The full 685-test
  unit suite, TypeScript, full 89-test E2E suite, and public feed date checks
  pass after this change.
- Three idle snapshots five seconds apart, taken while optional observability
  was running, showed host CPU PSI `some avg10` falling from 1.42% to 0.58%.
  Alloy, Grafana, Loki, Prometheus, and Tempo each stayed below 1% CPU in those
  samples. This does not measure observer overhead during an actual constrained
  host workload, but it gives no evidence that the observer alone caused the
  earlier pressure report.
- Removed the unreferenced `src/components/graph/useGraphState.ts`; the live
  graph uses `useGraphEngine` / `GraphShell` for UI state and
  `graphTopology.ts` for data. Updated the folder/graph implementation notes so
  they describe the automatic contextual sidebar and on-expand full graph.
- Rechecked the production reader page: its contextual graph is already visible
  in the right sidebar at initial load, with no “Load graph” action or duplicate
  full-graph request. The fullscreen control remains the explicit action for
  opening the larger graph. On the 390px mobile view, the guest navigation
  drawer exposes Search resources, All resources, Browse tags, Sign In, and
  Register; choosing Search closes the drawer and focuses the existing search
  field. No extra guest navigation code change was needed. Personal-account
  claims and remaining signed-in mobile journeys remain open.
- The shared sign-in and registration header repeated auth actions already
  offered beside the sign-in and registration forms. Guest auth pages now omit
  those header shortcuts and keep one clear cross-link beside the active form;
  signed-in account menus remain available. The form links preserve the
  validated same-site return destination.
- The create/import plus action in auth-page search linked a guest on `/login`
  back to the same sign-in page. Guest auth pages now keep public resource
  search but hide that create/import action and remove create/sign-in prompts
  from empty search states. Workspace search and creation behavior remain
  available elsewhere.
- Workspace search is available directly from the floating action rail and via
  `/` or `Ctrl/Cmd+K`; the existing search island opens in place and expands
  the explorer when needed, avoiding a separate load step or duplicate search
  implementation. TypeScript and Astro production build passed on 2026-11-11.
- The authenticated empty workspace now recommends one first step, “Create your
  first note”; folder and import actions remain one click away in the explorer.
  The explorer action row uses shared button primitives and token-based CSS
  instead of inline presentation. Hallmark app-scope scan and TypeScript pass;
  Astro production build and `git diff --check` pass on 2026-11-11. A rendered
  browser review confirmed the anonymous empty state and its sign-in action.
  CUA timed out on the search-button interaction. The dev app also logged
  OpenFGA DNS failures because its Compose service hostname is unavailable from
  the host-run dev server; the observer-visible empty state was therefore
  fail-closed and is not a valid authenticated empty-workspace review. Browser
  interaction verification is still outstanding.
- The live anonymous empty state showed a misleading sidebar heading (“Your
  resources”) and instructed visitors to use create actions they cannot access.
  The explorer now labels anonymous content “Shared resources” and gives an
  access-appropriate empty message; authenticated users get a prompt matching
  the visible create/import actions. TypeScript, production build, and focused
  Hallmark app-scope scan pass on 2026-11-11. The serving container still runs
  the prior build, so this source fix awaits a deployment-level visual check.
- The shortcut guide claimed R/E/G actions that had no matching global
  handlers and visually combined `/` with `Ctrl/⌘ K` as if all were required.
  It now lists only wired shortcuts and groups search alternatives as `/` or
  `Ctrl/⌘ + K`. TypeScript, production build, `git diff --check`, and focused
  Hallmark app-scope audit pass on 2026-11-11.
- The default floating action rail used to become transparent and ignore input
  after idle on touch devices, making the first tap wake the rail rather than
  activate a control. Coarse-pointer devices now keep it available; desktop
  auto-hide remains. Search hit-area styling now lives with application chrome,
  and the Hallmark scan findings in that stylesheet were resolved with existing
  elevation and spacing tokens. TypeScript, Astro production build,
  `git diff --check`, and focused Hallmark app-scope audit pass on 2026-11-11.
- Narrow authenticated mobile layouts could overflow because the rail contains
  several 44px controls. It now wraps within the viewport under 768px and gives
  all rail actions 44px targets. The chrome stylesheet also now has reduced
  motion, active/disabled states, and a Hallmark check stamp. Focused Hallmark
  app-scope scan, TypeScript, Astro production build, and `git diff --check` pass
  on 2026-11-11. Visual mobile verification remains outstanding because the
  running Compose image predates this source and host dev rendering caused
  significant resource overhead.
- Account identity is already passed from the verified session-cookie claims:
  login and OAuth sign in the email and display name, middleware resolves the
  canonical user ID while retaining those claims, and BaseLayout passes the
  resulting session to the desktop account menu and mobile drawer. This confirms
  the identity pass-through path in source. A 390px production-browser check
  using the seeded local synthetic account confirmed its name and email appear
  in the workspace, desktop account trigger, and mobile drawer; create/share
  actions are visible and the workspace-access link stays hidden for this
  non-admin. The seed has an odd display name (“Duplicate”), which is fixture
  data and not a real-account review. A real account visual check remains open.
- Guest sign-in/register actions from the account menu, mobile drawer, and
  search now retain the current same-site page through email login or
  registration. The return destination is validated to prevent external
  redirects, and the login/register cross-links preserve it. TypeScript and
  production build pass. No live browser review was possible because no app
  server is running. Google OAuth now keeps its return destination in a
  short-lived signed HttpOnly cookie, binds it to a random OAuth state nonce,
  validates that state on callback, and returns users to the originating
  same-site path. The OAuth state cookie is cleared on callback. The local app
  is running an older image, so a signed-in browser review of the current auth
  source is still outstanding.
- Search previously hid create/import behind typing `>` into the search box.
  The input now includes a visible plus action that opens the existing command
  list, while preserving the keyboard path. Its 44px target uses the shared
  icon-button primitive and the chrome stylesheet. Focused Hallmark component
  scan reports 0 FAIL, 0 REFLEX, and 0 WARN.
- The create/import form could create an empty PDF/image asset or an unlinked
  Google resource when its source was omitted. The form now explains and checks
  required sources before submission, while the create API rejects missing
  files and invalid Google IDs for every caller. Source errors now appear before
  title errors and clear as users correct the fields. Importing has accurate
  progress/error wording. TypeScript, production build, and `git diff --check`
  pass. Hallmark's component-only scan notes interaction styling is supplied
  by shared UI primitives, which that isolated scan does not include.
- The shortcut guide said `?` worked “anytime” even though global shortcuts
  should not interrupt form entry. Its helper copy now says where the shortcut
  works, and the guard also yields to native select controls and editable
  content. Focused Hallmark app-scope scan, TypeScript, production build, and
  `git diff --check` pass on 2026-11-11. The render tier is unavailable because
  `puppeteer-core` is not installed; the running app is an older image, so it
  does not contain the current source fixes.
- Opening search used to fetch the complete permission-filtered client index
  before the user entered a query. The index now loads only for a resource
  query of at least two characters, and stays idle for empty search and
  create/import commands. The search shell also shows a token-based keyboard
  focus ring. Focused Hallmark scan of `SearchModal.tsx` plus `chrome.css` is
  clean (0 FAIL/REFLEX/WARN); TypeScript, production build, and
  `git diff --check` pass on 2026-11-11. The reduction in abandoned index
  requests is structurally verified, not load-measured.
- Google import asked users to choose between separate link and file-ID fields,
  even though the API accepts either source form. It now uses one input and
  preserves pasted URLs or raw IDs in the existing request contract. The shared
  `Input`, `Select`, and `TextArea` primitives now connect visible labels to
  explicit or generated control IDs, and associate helper/error text through
  `aria-describedby` while marking invalid fields. The Hallmark component-scope
  scan reports missing focus/active/disabled rules when run on isolated React
  files; the shared rules are present in `primitives.css`. The allowed-format
  helper moved outside the upload button, and its focused app-scope scan now
  reports 1 FAIL, 2 REFLEX, and 0 WARN. A seven-file Hallmark scan of desktop
  and mobile navigation reports 0 findings. Render review remains pending
  because `puppeteer-core` is unavailable and the serving image predates the
  current source. TypeScript, production build, and `git diff --check` pass on
  2026-11-11.
- A newly created note previously opened in read mode, requiring a second click
  to begin writing. The create modal now opens new documents directly in edit
  mode, and canonical resource routing preserves that explicit `edit=true`
  intent while resolving the document. API route output remains unchanged.
- Shared UI primitives now add press feedback to buttons, resource cards, and
  upload dropzones, and give disabled icon buttons the same clear disabled
  treatment as regular buttons. This covers the create/import controls at the
  design-system layer, rather than duplicating styles in the modal.
- Binary upload failures were previously logged and swallowed, leaving a
  database resource with a missing object. The resource factory now validates
  import sources directly and stops creation if file preparation or object
  storage fails, returning a retryable error to the still-open form. Empty or
  unreadable file payloads are rejected before storage. Scaffold disk-write
  failures also stop creation with a user-safe recovery message instead of
  leaving a database row without its content file.
- The import picker previously accepted every `image/*` type while its help
  text and resource registry described a narrower format set (and omitted GIF,
  which the app supports). It now derives its accepted and displayed formats
  from the registry and validates both picker and dropped files against that
  list before upload.
- A rendered homepage showed the internal owner id `user:system` as the note
  author. The homepage byline now labels system-owned content “FOSS Workspace,”
  uses the verified session display name for the signed-in user’s own content,
  and hides other account identifiers behind “Workspace member.” The properties
  disclosure now uses the shared button, accessible iconography, tokenized CSS,
  and the native `hidden` state. The focused Hallmark scan reports 0 FAIL and
  0 WARN; its one disabled-state REFLEX is covered by the shared button primitive.
  TypeScript, production build, and `git diff --check` pass. A wider scan still
  reports legacy findings in the shared primitives and token palette, which
  need separate triage against the established design system.
- Shared motion styles used `transition: all`, including on the workspace grid;
  two nested property transitions were invalid. The fast token now lists only
  color, surface, shadow, opacity, and transform changes, uses the 120 ms motion
  token, and no longer animates grid or listing-card layout. A source search
  found no remaining `transition: all` declarations or nested fast-token
  transitions. This is a structural motion cleanup, not a measured CPU
  improvement.
- The 390px runtime image (commit `256da79`) had no rail search action, and its
  explorer search field was clipped while the explorer was collapsed. Current
  source already has a rail search action; the mobile drawer now also puts
  “Search resources” first in Quick actions. Both controls and the keyboard
  shortcut use the same focus request, which expands the explorer and focuses
  the field. The app container was rebuilt from the current worktree without
  recreating its database or content mounts; at 390px the updated drawer shows
  Search resources first, selecting it closes the drawer, expands the explorer,
  and focuses the search field. The same render shows the system byline as
  “FOSS Workspace.” Health reports the database, OpenFGA, and Valkey healthy.
  The health commit label remains `256da79` from the existing Compose
  `GIT_COMMIT_SHA`; use the rendered source behavior, not that label, to identify
  this local worktree build. Hallmark mobile-navigation scan is clean
  (0 FAIL/REFLEX/WARN); TypeScript, production build, and `git diff --check`
  pass.
- The shared Drawer declared modal semantics but did not place, contain, or
  restore keyboard focus. It now focuses its first action when opened, traps
  Tab and Shift+Tab inside, closes on Escape, and restores focus to the opener.
  TypeScript and Astro production build pass, and the focused Hallmark scan is
  clean (0 FAIL/REFLEX/WARN). Hallmark's render tier could not run because
  `puppeteer-core` is unavailable. The production app was rebuilt with its
  existing content/database volumes and manually checked at 390px as a guest:
  opening focuses “Close panel,” Shift+Tab wraps to the last link, Tab wraps
  back, and Escape closes and restores focus to “Open navigation menu.” Health
  is good and cgroups enforce the app's 256 MiB and 0.60 CPU limits.
  The verified signed-in fixture is reviewed below.
- The shared identity helper previously fell back to displaying the internal
  auth subject when a session lacked a display name. It now uses “Your account”
  instead and trims empty display-name/email claims. The mobile account panel
  now labels the identity “Signed in as,” matching the desktop account menu.
  The signed-in synthetic-fixture browser review confirms the name/email
  pass-through and role-appropriate actions. TypeScript, Astro production build,
  and focused Hallmark scan pass; the app container was rebuilt with existing
  data volumes.
- Create/import now focuses the first available resource choice when its type
  picker opens. File-derived titles are tracked separately from titles typed by
  the user: replacing a file updates only an untouched generated title, and an
  invalid replacement clears stale generated title state. The template choices
  are now exposed as a labelled button group. A production review at 390px found
  the modal focus landing on the dialog container instead of a choice and its
  detail footer clipping the primary action. The shared modal now honors
  explicit initial-focus targets and keeps its close handler stable; the
  create/import flow focuses the first choice, then the title for new resources,
  the dropzone for PDF/image imports, or the Google link field for Google
  imports. The footer wraps on narrow screens and uses concise Create/Import
  labels. A signed-in seeded-account browser review confirms those focus paths
  and shows the complete footer without horizontal clipping. TypeScript and
  Astro builds pass; focused Hallmark scan of the modal stylesheet reports 0
  findings. The render tier remains unavailable because `puppeteer-core` is not
  installed; the manual browser review confirmed layout and focus at 390px.
- The global Register action on the sign-in page previously dropped the
  incoming `redirect` destination even though the form's account-creation link
  preserved it. `authReturnPath` now carries a validated local destination
  across login/register pages and falls back to `/` if it points back to an auth
  route. Desktop and mobile account action labels now match, and the account
  trigger has a useful accessible fallback when no display name is present.
  After rebuilding the local app, the rendered flow from
  `/login?redirect=/folders/space:main` through the global Register action
  retained that destination on registration, sign-in, and Google links.
  Hallmark's focused account/mobile navigation scan reports 0
  FAIL/REFLEX/WARN; TypeScript, Astro production build, and `git diff --check`
  pass.
- The keyboard guide listed Reader Mode on routes that have no reader control,
  and the explorer shortcut worked only on the home page while being absent
  from the guide. The guide now shows those shortcuts only when their controls
  exist; `[` now toggles the explorer from the shared workspace shell and is
  ignored in editable fields and open dialogs. Shortcut rows and keycaps now
  have tokenized, responsive styling. Rendered checks confirm the note page
  shows `M` and `[`, while the login page omits both; pressing `[` collapses
  the explorer. Computed styles confirm the tokenized row and keycap surfaces.
  Hallmark focused scan reports 0 findings; TypeScript, Astro build, and
  `git diff --check` pass. The local app was rebuilt and the serving health
  endpoint is healthy.
- The common search/create palette used inline visual styles, including
  `transition: all`, and its guest command panel said “Enter to create” while
  requiring sign-in. Palette presentation now uses tokenized responsive CSS
  with reduced-motion support; guest guidance says “Sign in to continue.”
  Search instances now have unique listbox IDs and their combobox controls point
  to the actual list, while guest status content no longer claims to open a
  listbox. The rebuilt guest UI shows the correct sign-in action and status;
  computed styles confirm the tokenized popup surface. Hallmark focused scan
  reports 0 findings; TypeScript, Astro build, and `git diff --check` pass. The
  local app remains healthy after rebuild.
- The registration page previously led with internal terms (“root vault” and
  “OpenFGA authorization graph”) and called its primary action “Create Account
  & Vault.” It now explains the user outcome in plain language and uses
  “Create account”; sign-in copy states the next step. When a protected page
  requested authentication, both pages now reassure users that they will be
  returned there. `safeLocalRedirect` now rejects `/login` and `/register` as
  post-auth destinations, preventing a loop. Rendered checks confirm that
  normal registration, sign-in, and Google links preserve
  `/folders/space:main`, while a `/login` redirect falls back to `/`. TypeScript
  and Astro builds pass and the app was rebuilt. The page-only Hallmark scan
  reports missing focus/active/disabled rules because those come from shared
  primitives; scanning the full legacy `layout.css` also surfaces unrelated
  older findings. Broader rendered/mobile auth review remains open.
- Keep the default product workflow permission-aware and server-rendered; a
  faster path may not bypass OpenFGA checks for private resources.
- Keep the contextual graph visible automatically in the right sidebar; the
  full workspace graph remains available through fullscreen expansion.
- Optional observability must remain outside the five-service serving budget;
  it may be enabled separately for diagnosis.
- Preserve user content, history, database dumps, and volumes until recovery is
  established. Historical measurements and implementation notes are preserved
  in [GOALS-HISTORY.md](GOALS-HISTORY.md).
