# Alertmanager — the delivery half of alerting.
#
# Prometheus evaluating an alert rule only produces a series (`ALERTS`). With no
# Alertmanager, "the app is down" is visible on a dashboard nobody is looking at.
# This file is the other half: it decides where a firing alert goes, how often it
# may repeat itself, and which alerts are noise to be suppressed.
#
# THIS IS A TEMPLATE, not the running config. `entrypoint.sh` fills in the
# receiver placeholders below and splices the optional receivers in at the
# marked line, then writes the result to /tmp. A receiver whose delivery target
# is unset cannot be expressed in YAML (Alertmanager has no conditional config),
# so the receivers list has to be built at boot — which is what keeps a bare
# `docker compose --profile infra up` valid while still allowing a real webhook
# or SMTP once an operator sets one variable.
#
# Nothing is delivered anywhere by default, and that is deliberate: this repo
# holds a FOSS / zero-telemetry stance, so a preconfigured webhook would ship
# internal route names and error text to a third party the moment anyone ran the
# profile. Alerts are still fully visible without delivery — on the dashboards
# (`Firing alerts` reads ALERTS from Prometheus) and in Grafana's alert list.
#
# See plan/core-architecture/32-observability-and-telemetry-stack.md §2.5
global:
  # Wait before notifying about a newly firing alert. Long enough that a rolling
  # deploy's restart blip does not page anyone.
  resolve_timeout: 5m

  http_config:
    follow_redirects: true
    enable_http2: true

route:
  # Group by (alertname, route) so a burst of 5xx on one endpoint is one page,
  # not one page per failing request. `route` is the coarse path the middleware
  # records, so it stays low-cardinality.
  group_by: ['alertname', 'route']
  group_wait: 30s
  group_interval: 5m
  # Ceiling on repeat notifications for a still-firing alert. Without it, a
  # six-hour outage re-notifies every group_interval for six hours.
  repeat_interval: 4h

  # Always a real receiver, never a dead end: if external delivery is configured
  # it becomes the target, otherwise alerts terminate at `workspace-log` and are
  # marked delivered rather than retried forever.
  receiver: {{PRIMARY_RECEIVER}}

  routes:
    # Degraded authorization is security-relevant, not just an outage: while
    # OpenFGA is unreachable every check denies, so a resource the owner can
    # legitimately see reads as "no permission". Faster and noisier, because
    # "I can't see my own vault" is worth waking someone for.
    - matchers:
        - alertname = OpenFGADegraded
      receiver: {{PRIMARY_RECEIVER}}
      group_wait: 10s
      repeat_interval: 30m
      continue: true

    - matchers:
        - severity = critical
      receiver: {{PRIMARY_RECEIVER}}
      group_wait: 10s
      repeat_interval: 1h

receivers:
  # Always-present sink. It has no external delivery target, so its only job is
  # to terminate the route tree when nothing external is configured.
  - name: workspace-log
# {{RECEIVERS}}
inhibit_rules:
  # A dead process produces AppDown *and* a pile of 5xx. Only the root cause is
  # worth a page; the rest is noise that trains people to ignore alerts.
  - source_matchers:
      - alertname = AppDown
    target_matchers:
      - severity =~ "warning|critical"
    equal: ['job']
