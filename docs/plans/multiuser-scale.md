# Historical Scale Plan — Multi-Million-User Readiness

> **Not the active product roadmap.** The supported target is the modest,
> constrained deployment in [`../GOALS.md`](../GOALS.md). This document preserves
> historical ideas and implementation notes; its unchecked boxes are not
> commitments and must not justify adding services or work outside that goal.
> Reassess an item against current code and a real user need before scheduling it.

> Companion to `docs/design-system.md`. Scope: make `mechanical-matter` operate
> at multi-million-user, multi-MAU scale without a rewrite, and without breaking
> existing features.
>
> Guiding principles: **additive**, **flag-gated**, **dual-write**, and
> **single-region-first**. Nothing off the request path becomes synchronous.
> Every change ships behind an env flag or a profile so a feature can be
> disabled with one flip.

## Implementability Assessment (as of today)

| # | Item | Implementable now (no breakage) | Where it can run | Risk |
|---|------|---------------------------------|------------------|------|
| 1 | Structured logs + `/healthz` + metrics | ✅ additive | local | none |
| 2 | Rate limiting (per-IP/per-route, permissive default) | ✅ additive | local | none |
| 3 | Redis cache + sessions | ✅ (flag-gated; reuse JWT + denylist) | local via compose, **no profile** | low |
| 4 | Async queue for heavy paths (search index, ingestion) | ✅ one consumer first, dual-write | local via compose | low |
| 5 | Audit log table + consumer | ✅ additive | local | none |
| 6 | Migration consolidation (kill runtime DDL) | ✅ with care (baseline snapshot + go-forward) | local + deploy | medium |
| 7 | Cached OpenFGA checks | ✅ flag-gated wrapper in `permissions.ts` | local | medium |
| 8 | RLS tenant boundary under OpenFGA | ✅ flag-gated per table | local | medium |
| 9 | Collab fleet proof (2× Hocuspocus + minio + redis) | ✅ local proof only | local | medium |
| 10 | CSP security headers | ⛔ blocked until inline-style cleanup lands | local | high (breaks app today) |
| 11 | Multi-instance fleet / LB / zero-downtime deploys | ❌ needs deploy infra | prod | — |
| 12 | Managed PG replicas + PgBouncer | ❌ (local sim possible) | prod | — |
| 13 | CDN, WAF, multi-region, managed OIDC | ❌ needs cloud providers | prod | — |
| 14 | Distributed search tier (Typesense/OpenSearch) | ⏸ defer — Meilisearch is fine < ~1M docs | prod | — |

**Bottom line:** Phase 1 (~6 items) is fully local and low-risk. Roughly **80 % of
Phase 1**, **30 % of Phase 2**, and **50 % of Phase 3** can be implemented here
today. The remaining work is deployment/platform territory.

---

## Local, efficient stack additions (compose)

Keep the footprint minimal. One profile, three small services, reused where
possible:

- **Valkey** (`valkey/valkey:8`, drop-in Redis-compatible) — sessions, cache,
  queue, collab channel. *Redis-only alternative: `redis:7-alpine`.*
- **Reuse existing `minio`** (already in the `local-offline` profile) for
  Hocuspocus document persistence & search snapshots — no new storage service.
- **Skip** PgBouncer/Typesense locally — PgBouncer only pays off with many app
  instances; Meilisearch stays until the corpus demands more.
- App + everything enabled via `docker compose up -d`.
  (Valkey left the `scale` profile: `app` sets `REDIS_URL` unconditionally, so a
  profile-gated dependency meant the default deployment never started it. See the
  comment above the `valkey` service in `docker-compose.yml`.)

## Recommended libs (smallest, most efficient first)

| Need        | Choice                       | Why |
|-------------|------------------------------|-----|
| Logging     | `pino` + `pino-http`         | fastest JSON logger, one dependency |
| Metrics     | `prom-client` + `/metrics`   | no collector infra needed |
| Cache/Session | `ioredis` (Valkey-compatible) | minimal, battle-tested client |
| Queue       | `bullmq` on Valkey          | reliable, retries/DLQ, no new infra |
| Auth        | keep `jose`/`jsonwebtoken` + Redis denylist | revocation without full rewrite |

> **Update.** The "no collector infra needed" line is still true of the app itself,
> but a collector now exists and is one flag away:
> `docker compose --profile infra up -d` brings up Grafana + Prometheus + Loki +
> Tempo + Alloy with everything pre-provisioned. Traces, dashboards and alert
> rules are covered by
> [32-observability-and-telemetry-stack.md](../../plan/core-architecture/32-observability-and-telemetry-stack.md).
> That plan also produced the first hard measurement of item 8.1: a single `GET /`
> issued ~509 individual OpenFGA decisions before request batching and ACL cache
> work landed. This historical trace is not a current HTTP request count; see
> the status correction below.

> **Status correction (2026-11-10):** This document contains historical
> checkboxes that have drifted from implementation. The ACL decision cache,
> bounded concurrency, and `BatchCheck` are implemented in `src/lib/openfga.ts`
> and `src/lib/aclCache.ts`. The earlier 509 span trace counted individual
> authorization decisions before batching; it does not mean 509 HTTP requests
> are still sent. Reconcile each item against code before treating an unchecked
> box as unimplemented. `docs/GOALS.md` owns the product and runtime target; this
> file is an implementation inventory, not a scale mandate.

---

## Phase 1 — Foundation (local, now)

**1. Observability & health**
- [x] Add `pino` JSON logging in `src/lib` (replace ad-hoc `console.log`).
- [x] `pino-http` middleware for request logs with trace id.
- [x] `/healthz` (liveness: process up) + `/readyz` (db/search/redis reachable).
- [x] `/metrics` with `prom-client` (request latency histogram, error rate,
      queue depth, DB pool stats).
      → Shipped. Consumption (collector, Grafana, dashboards, alerts, OTel traces)
      is tracked in
      [32-observability-and-telemetry-stack.md](../../plan/core-architecture/32-observability-and-telemetry-stack.md).

**2. Rate limiting & abuse**
- [x] Per-IP limiter on auth routes; enabled by `RATE_LIMIT_AUTH`.
- [ ] Per-user quota limiter on write endpoints (config-driven, permissive default).
- [x] Configurable caps on expensive routes (search / similar / export).

**3. Redis-backed session/cache (unconditional service)**
- [x] Add `valkey` service to compose (no profile — see the note at line 49).
- [x] `src/lib/cache.ts` — wrapper (`get/set/invalidate`, TTL, no-op fallback
      when redis is off → zero breakage).
- [~] Cache hot reads — `/api/v1/content/index.json` has bounded per-user in-process
      caching plus optional shared caching for anonymous results. Resource writes,
      permission-tuple writes, and ACL projection replaces invalidate local entries.
- [~] Redis-backed JWT denylist is behind `AUTH_SESSION_STORE`; short-lived
      access tokens and refresh rotation remain open.

**4. Async queue (BullMQ on Valkey)**
- [x] Queue abstraction `src/lib/queue.ts` (producer + worker, worker only runs
      when queue enabled).
- [~] Meilisearch indexing has a queue path; queue is off by default and falls
      back to synchronous handling.
- [ ] Queue PDF/rich-content preview generation. The former preview warm job
      only wrote cache entries that had no read path; it was removed. Preview
      generation remains request-driven, while Meilisearch indexing is the only
      current queue consumer.
- [ ] DLQ + retry with exponential backoff; dead-letter alert via health/metrics.

**5. Audit log**
- [~] `audit_events` table and IAM grant/revoke writer exist; object-storage
      flush is not implemented.

**6. Migration discipline**
- [ ] Introduce **expand/contract** convention (additive columns/backfill first,
      drop later) — going forward only.
- [x] Freeze new runtime DDL in `ensureDbInitialized`; keep it as a dev-only
      reconciler behind `NODE_ENV !== 'production'`.
- [ ] Document current schema as a `0000_baseline` snapshot in `migrations/`;
      route future changes through the existing `scripts/migrate.ts`.

## Phase 2 — Distribution (some local proofs, prod infra needed)

- [ ] **Collab fleet proof**: 2× `ws_server` instances sharing Valkey pub/sub +
      minio persistence; sticky routing; verify document merge correctness.
- [ ] Containerize app for multi-instance (Dockerfile exists — add multi-replica
      `app` via compose `--scale app=2`, load-balance through existing traefik
      local-offline profile).
- [ ] Seed the Qdrant-free plan: keep PG as source of truth; no local replica
      work (defer).
- [ ] CDN-ready: emit cache headers on public content routes; presigned R2
      uploads already in place — add GET cache-control.
- [ ] Zero-downtime deploy runbook (staged migrations → canary → rolling) as a
      doc in `docs/plans/`.
- [ ] Public API contract: stabilize a versioned JSON API layer for non-browser
      clients (via `src/lib/api.ts` or similar) so UI isn't the only consumer.

## Phase 3 — Efficiency & compliance (local, flag-gated)

- [ ] **Cached OpenFGA checks**: wrapper around `permissions.ts` checks with
      `cache.ts` TTL + explicit invalidation on tuple writes.
- [ ] **RLS under OpenFGA**: enable row-level security per table behind flag;
      parallel local dependency (no lock), verify both access paths.
- [ ] Quota & tenant budget telemetry (per-workspace row/CPU/search quotas).
- [ ] CSP + security headers — **blocked until scoped `<style>` blocks and inline
      `style=` are consolidated** (see `docs/design-system.md` migration table);
      then enable policy and tighten.
- [ ] Secrets manager integration (e.g. sops/1Password CLI) replacing `.env`
      values at deploy time; `.env` stays for local dev.
- [ ] Restore drills: nightly automated R2-backup restore test into a throwaway
      PG; verify checksums.
- [ ] Multi-region design doc (region affinity, GLOBAL identity tier only) — no
      code until a real second region is funded.

---

## Checklist (todos)

Legend: `[ ]` open, `[x]` done in this pass, `[~]` partially done (see note).

### Phase 1 — Foundation (local)
- [x] 1.1 Add `pino` + structured JSON logging (`src/lib/logger.ts`) (::local)
- [x] 1.2 `pino-http` request middleware + trace id (::local)
- [x] 1.3 `/healthz` + `/readyz` endpoints (`api/v1/health.ts` extended, `api/v1/readyz.ts`) (::local)
- [x] 1.4 `/metrics` (prom-client) on app + workers (`api/v1/metrics.ts`, `src/lib/observe.ts`) (::local)
- [x] 2.1 Auth/register rate limiter (per-IP) (::local)
- [ ] 2.2 User quota limiter on writes — deferred (per-workspace quota needs tenant model; only auth + expensive routes covered) (::local)
- [x] 2.3 Expensive-route cap + 429 (search / similar / docs export) (::local)
- [x] 3.1 Compose Valkey service (::local) — later moved out of the `scale` profile
- [x] 3.2 `src/lib/cache.ts` with redis-optional no-op fallback (::local)
- [~] 3.3 Cache hot reads — `/api/v1/content/index.json` has bounded per-user
      in-process results plus optional anonymous Valkey caching; resource and ACL
      mutations clear in-process entries (::local)
- [~] 3.4 JWT short-TTL + Redis denylist + rotation — denylist shipped (`AUTH_SESSION_STORE`); short-TTL/refresh rotation still open (::local)
- [x] 4.1 `src/lib/queue.ts` (BullMQ producer/worker) (::local)
- [x] 4.2 Meilisearch reindexing moved to queue (dual-write; delete branch in consumer, no caller yet) (::local)
- [ ] 4.3 Queue PDF/rich-content preview generation — the old cache-warm writer
      had no reader and was removed; generation stays synchronous. Meilisearch
      indexing is the only current queue consumer (::local)
- [x] 4.4 DLQ + retry/backoff — BullMQ attempts/backoff/removal policies configured (::local)
- [x] 5.1 `audit_events` table + IAM write logger (migration 0005, `src/lib/audit.ts`, IAM grant/revoke hooks) (::local)
- [ ] 5.2 Audit consumer/flush — rows written inline; object-storage flush not implemented (::local)
- [x] 6.1 Freeze new runtime DDL; `ensureDbInitialized` gated to non-production (::local)
- [ ] 6.2 `0000_baseline` schema snapshot — deferred until schema stabilizes (regenerate via pg_dump) (::local)

### Phase 2 — Distribution
- [ ] 7.1 2× Hocuspocus fleet over Valkey pub/sub + minio (::local proof)
- [ ] 7.2 Multi-replica `app` via compose `--scale app=2` + traefik LB (::local proof)
- [~] 7.3 Cache-Control headers on public content — `max-age=15` on cached public index (::local)
- [ ] 7.4 Zero-downtime deploy runbook (::doc)
- [ ] 7.5 Versioned public API contract for non-browser clients (::local)

### Phase 3 — Efficiency & compliance
- [x] 8.1 Cached OpenFGA checks + generation invalidation, batched checks, and
      bounded concurrency (`src/lib/openfga.ts`, `src/lib/aclCache.ts`).
- [ ] 8.2 RLS policies per table under OpenFGA (::local, flag-gated)
- [ ] 8.3 Tenant quota/budget telemetry (::local)
- [ ] 8.4 CSP + security headers — `SECURITY_HEADERS` middleware shipped (non-CSP headers); CSP blocked on design-system inline cleanup
- [ ] 8.5 Secrets manager at deploy; `.env` dev-only (::prod)
- [ ] 8.6 Automated nightly R2 restore drills (::local + prod)
- [ ] 8.7 Multi-region design doc (::doc)

---

## Non-goals (out of scope)
- Schema/DDL added at runtime in production (replaced by expand/contract).
- Replacing Meilisearch until corpus > ~1M docs or SLA forces it.
- Multi-region code before a funded second region.
- Any synchronous call to a queue, worker, or search engine from a hot path.
