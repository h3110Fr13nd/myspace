# 32 — Observability & Telemetry Stack

> Scope: give `mechanical-matter` a production-grade telemetry surface —
> **metrics, logs, traces and error visibility** — starting from a local Docker
> Compose profile that costs nothing when it is not running and migrates to real
> infrastructure by changing endpoints, not by rewriting instrumentation.
>
> Guiding principles: **additive**, **opt-in**, **profile-gated**, and
> **local-first**. The app must never require a collector to boot, and no
> observability dependency may appear on the request path in a way that costs
> something when telemetry is off.
>
> Companions: [docs/plans/multiuser-scale.md](../../docs/plans/multiuser-scale.md)
> (Phase 1.1–1.4 shipped the instrumentation this plan consumes),
> [docs/sync-to-azure-vm.md](../../docs/sync-to-azure-vm.md) (the deploy target).

---

## TL;DR

```bash
docker compose --profile infra up -d
# open http://localhost:3000 — anonymous Admin, no login, no clicks
```

Five containers, **~460 MB RSS idle**, short retention, no host ports beyond
Grafana. The app already emits Prometheus metrics (`src/lib/observe.ts`) and pino
JSON on stdout (`src/lib/logger.ts`); this plan adds the collector, the stores,
the UI, and the trace path, and nothing else has to change to go to production.

---

## The stack, and why each piece

| Component | Image | Role | Why this and not the alternative |
|---|---|---|---|
| **Grafana** | `grafana/grafana:12.1.0` | UI | Only UI where all three signals cross-link with no extra plugin |
| **Prometheus** | `prom/prometheus:v3.5.0` | Metrics store + rule engine | App already speaks `prom-client`; `--web.enable-remote-write-receiver` is pre-armed for Mimir |
| **Loki** | `grafana/loki:3.5.1` | Log store | Cheapest log backend that Grafana queries natively |
| **Tempo** | `grafana/tempo:2.8.2` | Trace store | OTLP in, TraceQL out; same vendor as the rest, one mental model |
| **Alloy** | `grafana/alloy:v1.9.1` | Single agent: docker-SD logs → Loki, OTLP → Tempo | **Replaces Promtail *and* the OTel Collector in one process.** Grafana's own supported production agent — the config written here is the config that ships as a DaemonSet |

### Deliberately rejected

- **Promtail** — same job as Alloy for logs, but adds a second process and cannot
  receive OTLP. Swapping to Alloy is what removed a container, not added one.
- **A separate OTel Collector** — Alloy already is one (it embeds the full
  `otelcol.*` component set). The app only knows OTLP/HTTP, so if we ever *do*
  want a standalone collector, only the endpoint changes.
- **Grafana Unified Alerting** — it duplicates the Prometheus rule file, and
  Grafana's built-in `DatasourceError` rule fires into an unconfigured SMTP
  contact point, producing a wall of errors on every boot. Prometheus evaluates
  the same rules and exposes them as the `ALERTS` metric, which the overview
  dashboard already surfaces. **Prometheus owns alerting; Grafana owns display.**
- **A `prometheus`-type Grafana datasource pointed at Alloy's `/metrics`** — the
  Prometheus datasource speaks the `/api/v1/query` HTTP API, which a bare
  exposition endpoint does not implement. Prometheus already scrapes
  `alloy:12345` under `job="alloy"`, so those panels query Prometheus.
- **Grafana Node Exporter / cAdvisor** — a laptop already has the numbers, and
  `prom-client` gives the Node process metrics that actually matter for SSR.

---

## Zero-click provisioning contract

The requirement: `docker compose --profile infra up` produces a Grafana you can
use immediately, with no login and no manual datasource entry. That is achieved
entirely with files on disk — the same pgAdmin-style approach used for
`docker/postgres/init.sql`, and the same reason it works in CI.

| Preseed | Mechanism | File |
|---|---|---|
| Datasources (Prometheus, Loki, Tempo) | File provisioning, pinned UIDs | `docker/observability/grafana/provisioning/datasources/datasources.yml` |
| Dashboards (4) | File provider, `updateIntervalSeconds: 30`, `allowUiUpdates: true` | `.../provisioning/dashboards/{dashboards.yml,json/*.json}` |
| Admin user | `GF_SECURITY_ADMIN_USER` / `_PASSWORD` from env | `docker-compose.yml` |
| **No login at all** | `GF_AUTH_ANONYMOUS_ENABLED=true` + `GF_AUTH_ANONYMOUS_ORG_ROLE=Admin` + `GF_AUTH_DISABLE_LOGIN_FORM=true` | `docker-compose.yml` |
| Landing dashboard | `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH` | `docker-compose.yml` |
| Recording + alerting rules | `rule_files` | `docker/observability/prometheus/rules/app.yml` |
| Logs ↔ traces correlation | Loki `derivedFields` → Tempo, Tempo `tracesToLogsV2` → Loki | `datasources.yml` |
| pino JSON → Loki fields | Alloy `stage.json` + `stage.labels` | `docker/observability/alloy/config.alloy` |

Datasources are wired by **service name over `workspace_net`**, never by host
port, so nothing breaks when a port collides. UIDs are pinned (`foss-prometheus`,
`foss-loki`, `foss-tempo`) because the cross-links and every dashboard reference
them by UID.

Analytics, update checks and the news feed are hard-disabled
(`GF_ANALYTICS_*=false`, `GF_NEWS_NEWS_FEED_ENABLED=false`), as is Tempo's
`usage_report`. Loki's `analytics.reporting_enabled: false` likewise. This stack
should not phone home — the same zero-telemetry stance taken in
[27-comparison-miro-figjam-and-canvas-evolution.md](../future-roadmap/27-comparison-miro-figjam-and-canvas-evolution.md).

### Production flip

| Concern | Local | Production |
|---|---|---|
| Browser login | anonymous Admin, login form hidden | `GRAFANA_ANON_ENABLED=false`, `GRAFANA_DISABLE_LOGIN_FORM=false`, real `GRAFANA_ADMIN_PASSWORD` via secrets |
| Host exposure | Grafana `:3000`; all other backends on `127.0.0.1` | Put Grafana behind the Cloudflare Tunnel (`tunnel` profile) + Access |
| Storage | local volumes, 48 h retention | Object storage, `replication_factor: 3`, weeks of retention |
| Agent | one container, whole-stack docker SD | one Alloy DaemonSet per node, k8s SD |
| Metrics fan-out | none | `remote_write` → Mimir (server is already a remote-write receiver) |
| Logs | direct `loki.write` | `loki.write` → object storage, or Grafana Cloud Logs |
| Traces | 6 h retention | Tempo Cluster + Query-Frontend, or Grafana Cloud Traces |
| Alerts | `ALERTS` metric on a dashboard | Prometheus `alertmanager` block → Alertmanager → Slack/email |

None of these touch application code. That is the whole point of the layout.

---

## The `OTEL_ENABLED` contract

`src/lib/otel.ts` never imports the OTel SDK statically — the SDK is behind
`import()` and is only loaded when tracing is on. `OTEL_ENABLED` accepts:

| Value | Behaviour |
|---|---|
| `false` *(constrained Compose default)* | Do not load the SDK or instrument request/datastore calls. |
| `auto` | Probe `OTEL_EXPORTER_OTLP_ENDPOINT` once at boot (300 ms timeout). Collector answers → tracing on. Otherwise off, silently. |
| `true` | Always start the SDK. Use in production where a collector is guaranteed. |

Tracing is deliberately opt-in in Compose because tracing adds work to every
request and datastore call. Start the separate `infra` profile and set
`OTEL_ENABLED=true` when traces are needed. `auto` remains available for
deployments that explicitly prefer collector discovery; a deployment without
an endpoint silently skips loading the SDK.

**Preload is mandatory, not stylistic.** The HTTP server instrumentation patches
`node:http` through `require-in-the-middle`, which never fires for an
already-loaded core module. An in-app `import` therefore produces *zero* server
spans — verified, not assumed:

```js
// probe: start the SDK after `node:http` is already in the require cache
sdk.start(); http.createServer(...).listen();
// → active span during request: null, spans exported: []
```

So the bootstrap is bundled to a standalone module and preloaded:

- `instrumentation.ts` (root, 4 lines) → esbuild → `dist/instrumentation.mjs`
- `Dockerfile`: `ENV NODE_OPTIONS=--import=/app/dist/instrumentation.mjs`
- `src/middleware.ts` also awaits `ensureOtel()`, which is what covers
  `astro dev` where nothing is preloaded. In dev, HTTP *server* spans are
  missing for the reason above; `pg`, `ioredis` and `undici` client spans still
  appear. For full dev fidelity: `npm run dev:otel`.

### What the SDK instruments

`http` (inbound/outbound, `/api/v1/health*` ignored), `pg`, `undici` (global
`fetch`), `ioredis`. Deliberately **not** `fs`, `dns` or the
`@opentelemetry/auto-instrumentations-node` meta-package — 50 instrumentations
to cover 4 that this app actually uses. Sampling is
`parentbased_traceidratio` at `OTEL_TRACES_SAMPLER_ARG`: Compose samples 5% by
default; direct local runs without the Compose setting retain the SDK's default
unless the variable is set. Raise it briefly for diagnosis, and measure before
increasing it on constrained hosts.

### Log/trace correlation

`src/lib/logger.ts` adds a pino `mixin` that stamps `trace_id` / `span_id` from
`@opentelemetry/api`'s active span — **absent when tracing is off**, so the
`logger.ts` change is safe unconditionally. `src/middleware.ts` echoes
`X-Trace-Id` on the response. Together they give:

- `curl -I http://localhost:4322/` → `x-trace-id: 7650a57c…`
- `{project="workspace-stack"} | json | trace_id="7650a57c…"` → every line of that request
- click the **TraceID** link on any log line → the trace in Tempo
- **Logs** button on a Tempo trace → the lines for that trace

---

## Cost, measured

Idle RSS with the `infra` profile up and the app under light local traffic:

| Service | RSS | Hard limit |
|---|---|---|
| Loki | 119 MB | 512 MB |
| Tempo | 117 MB | 384 MB |
| Alloy | 93 MB | 384 MB |
| Grafana | 89 MB | 384 MB |
| Prometheus | 44 MB | 512 MB |
| **Total** | **~462 MB** | 2.1 GB ceiling |

Every service has a `deploy.resources.limits` memory cap (Compose v2 honours
this outside swarm), a 5 MB × 2 `json-file` log cap, and short retention:
`PROMETHEUS_RETENTION_TIME=48h` / `PROMETHEUS_RETENTION_SIZE=2GB`, Loki 48 h,
Tempo 6 h. The five observability volumes are disposable —
`docker compose --profile infra down -v` is always safe.

Only Grafana binds a non-loopback port. Prometheus, Loki, Tempo and Alloy are on
`127.0.0.1`; OTLP is on `127.0.0.1:4318` for `astro dev` running outside Docker.

---

## Findings from the first hour of running it

The stack immediately paid for itself. One `GET /` produces a trace with:

```
GET (SERVER)
└── pg-pool.connect (CLIENT)
└── pg.query:SELECT workspace_db (CLIENT)
└── POST ×509  http://openfga:8080/stores/01M2R8C…/check   ← 509 ReBAC checks, one page render
```

**Historical baseline:** the first trace showed ~509 individual OpenFGA
decisions for one homepage render. The application now caches decisions,
coalesces them through `BatchCheck`, and bounds concurrent engine requests. The
509 count describes decisions, not current HTTP requests. Compare current
`foss_openfga_checks_total` and latency metrics before reopening the original
P1; tracing samples 5% by default in the constrained Compose runtime.

---

## Checklist

Legend: `[ ]` open, `[x]` done, `[~]` partial (see note).

### Phase 1 — Local stack (shipped)
- [x] 1.1 `infra` profile: grafana, prometheus, loki, tempo, alloy — additive, off by default (::local)
- [x] 1.2 File-provisioned datasources with pinned UIDs + cross-links (::local)
- [x] 1.3 Four file-provisioned dashboards, home dashboard preset, anonymous Admin (::local)
- [x] 1.4 Alloy: docker SD → relabel to `service`/`project` → `loki.process` → Loki (::local)
- [x] 1.5 Pino JSON parsed to `level` + `status` labels; high-cardinality fields left query-time (::local)
- [x] 1.6 Prometheus scrapes `app:4321/api/v1/metrics` + `openfga` + `alloy` + itself (::local)
- [x] 1.7 Recording + alerting rules (`AppDown`, `AppHighErrorRate`, `AppHighP95Latency`) (::local)
- [x] 1.8 Retention caps + per-service memory limits; only Grafana publicly bound (::local)
- [x] 1.9 OTel SDK behind dynamic import, `OTEL_ENABLED=auto` endpoint probe (::local)
- [x] 1.10 `instrumentation.ts` → esbuild → `NODE_OPTIONS=--import` preload (::local)
- [x] 1.11 Trace-aware pino `mixin` + `X-Trace-Id` response header (::local)
- [x] 1.12 `dev:otel` script for full-fidelity dev tracing (::local)
- [x] 1.13 `npx tsc --noEmit` and `npx astro build` clean; `alloy validate` + `promtool check` clean (::local)
- [x] 1.14 Bounded `json-file` log rotation for **all** services (shared
      `x-logging` anchor), not just the observability profile (::local)
- [x] 1.15 Fixed the app `HEALTHCHECK` — it probed `http://localhost:4321/`,
      which resolves to `::1` while the server binds IPv4, so the container was
      permanently `unhealthy` against a fully working process. Now probes
      `http://127.0.0.1:4321/api/v1/health` with a 20 s start period. Any
      orchestrator (or a future `depends_on: service_healthy`) inherits this
      correctness, so it had to be fixed before anything automated depends on it
      (::local)

### Phase 2 — Errors (shipped)
- [x] 2.1 Error backend decided: **stay on logs + metrics** (::decision)
      Chosen over Sentry and over Tempo error-events because the "error→trace"
      path already exists and works: pino puts `trace_id` on every line, the Loki
      datasource turns that into a link into Tempo, and 2.4's dashboard puts the
      two side by side. A third store would have to re-derive the same join. The
      gap this leaves is a *signal* gap, not a *correlation* gap: nothing decides
      that a 500 000-messages-per-minute is worth waking someone, which is what
      2.5's alert rules and 2.6's counters are for. Revisit if error volume ever
      outgrows what a dashboard and two thresholds can carry.
- [x] 2.2 Unhandled rejections / `uncaughtException` → structured `logger.fatal`
      with stack, plus an `UnhandledError` counter in `src/lib/observe.ts`
      (`src/lib/processErrors.ts`, installed from both the preload and the
      middleware; a rejection no longer terminates the process, and
      `PROCESS_FATAL_ERRORS=1` restores that if a deployment wants it) (::local)
- [x] 2.3 Replace the silent `ECONNREFUSED` / `ENOTFOUND` catch in
      `src/lib/openfga.ts` with an explicit degraded log + counter
      (`foss_openfga_errors_total{operation}`, `logger.warn` not `console.warn`) (::local)
- [x] 2.4 Error dashboard: 5xx by route, top error messages, error→trace links
      (`docker/observability/grafana/provisioning/dashboards/json/errors.json`,
      "Errors & Degraded Mode". It leads with the two degraded-mode counters,
      because a check that failed closed is indistinguishable from a correct
      refusal unless you know to look for it.) (::local)
- [x] 2.5 Alert → contact point: Prometheus `alertmanager` + Alertmanager
      container, so a page is actually delivered (`docker/observability/alertmanager/`;
      the config is rendered at boot because a receiver with an unset target is
      invalid YAML, and it ships with no external receiver so the default profile
      still sends nothing anywhere) (::local)
- [x] 2.6 `foss_http_errors_total` counter alongside the existing
      `foss_http_requests_total{status}` derivation (split client/server at write
      time rather than derived, so a 5xx alert is not drowned by a 4xx storm) (::local)

### Phase 3 — Production migration
- [ ] 3.1 `GRAFANA_ANON_ENABLED=false` + real admin secret in the deploy env (::prod)
- [ ] 3.2 `OTEL_ENABLED=true` on the VM; a real collector behind the tunnel (::prod)
- [ ] 3.3 `remote_write` → Mimir/Grafana Cloud from the existing Prometheus (::prod)
- [ ] 3.4 Alloy config to k8s SD, shipped as a DaemonSet; drop the docker SD block (::prod)
- [ ] 3.5 Object storage for Loki + Tempo, `replication_factor: 3`, weeks of retention (::prod)
- [x] 3.6 Bake the `/metrics` endpoint behind a bearer token, and fail closed in
      production (`src/lib/metricsAuth.ts`; the token is `METRICS_TOKEN` on the app
      and a file Prometheus reads via `bearer_token_file`, written by
      `docker/observability/prometheus/entrypoint.sh`. Production returns **503**
      when the token is unset, so a missing secret is a visible deploy error
      rather than an open endpoint; dev stays open so `--profile infra` needs no
      setup. 7 assertions in `tests/unit/metrics-auth.spec.ts`.) (::security)
- [~] 3.7 Sampling is 5% by default in the constrained Compose runtime; tune
      against real traffic before increasing it. Span and collector limits still
      need production measurements. (::local, ::prod)
- [x] 3.8 Docker log rotation for the non-`infra` services (`traefik`, `minio`,
      `meilisearch`, `openfga`, `app`) — the `json-file` driver has no default
      cap, which is how a first Alloy run tried to ship a 7-day archive (::local)
- [x] 3.9 Cached ACL decisions, `BatchCheck`, and bounded concurrency reduce the
      original authorization fan-out (::local; see `src/lib/openfga.ts`)

---

## Operational notes (things that will bite again)

- **Bind-mount whole directories, never single files.** `config.alloy` mounted
  as a file keeps the *old inode* after a host-side rewrite, so the running
  container silently serves stale config. Directory mounts do not have this
  problem. All five services use directory mounts for this reason.
- **Alloy's `stage.json` does not create labels.** It fills the extracted map
  only — Promtail's implicit promotion is gone. A `stage.labels` block is
  required. Promoting `trace_id`, `url` or `durationMs` would create one Loki
  stream per request, so only `level` and `status` are promoted.
- **Validate configs in CI, not at boot.** `alloy validate <file>` and
  `promtool check config|rules` run against the real files in seconds. A bad
  Alloy config is a crash-looping container, not a warning.
- **`loki.source.docker` has no `relabel_rules` array.** Its `relabel_rules` is a
  capsule and rejects the Promtail array form. Use `discovery.relabel` and pass
  `.output` as `targets`.
- **Loki `reject_old_samples`.** Alloy tails whole container log files, so a first
  run replays whatever history docker still holds. Left at the default, every
  batch 400s. Set `reject_old_samples: false` and let the compactor age it out.
  A single hot container can still exceed the 3 MB/s *per-stream* default during
  that backfill, hence the raised `per_stream_rate_limit` — but the real fix is
  log rotation (3.8), which bounds the archive to 10 MB × 3 in the first place.
- **Transient startup errors are normal.** Loki logs `empty ring` while the
  ingester ring settles, and Alloy logs `error inspecting Docker container` for
  up to one `refresh_interval` after any container is recreated. Both clear on
  their own; judge the stack on a 60-second steady-state window, not on the
  first minute of logs.
- **A parsed Loki query echoes extracted fields into the response's `stream`
  object.** A `| json | trace_id="…"` query returns far more keys than the
  stream actually has. Check `/loki/api/v1/labels` or `index/stats` for real
  cardinality — the pipeline holds **10 streams** for the whole stack.
- **Grafana 12.1 logs `plugin table is already registered` on every boot.** A
  core-plugin double-registration bug in the image. Harmless; ignore it rather
  than chasing it.

---

## Non-goals

- Requiring a collector for the app to boot, or any request-path work when
  tracing is disabled.
- Full-coverage auto-instrumentation (`auto-instrumentations-node`) for
  libraries this app does not use.
- Node/system metrics beyond what `prom-client` already exposes for the SSR
  process.
- Any card ever stored in this stack: sampled traces only, no PII in span
  attributes, and the existing pino redaction of `authorization` / `cookie` /
  `x-api-key` applies to logs and traces alike.
- Shipping local retention data anywhere. The stack is offline by default.
