#!/bin/sh
# Prometheus entrypoint wrapper: materialise the metrics bearer token, then hand
# over to the real binary with the original arguments.
#
# Why: the app serves /api/v1/metrics only to a caller presenting METRICS_TOKEN
# (src/lib/metricsAuth.ts), and Prometheus reads a bearer token from a *file*.
# Prometheus does not expand environment variables in its config, so the token
# has to be written to disk somewhere between here and the scrape. Writing it
# here keeps it out of prometheus.yml and out of the image: it exists only in
# this container's /tmp, from the same environment variable the app already has.
#
# An unset token yields an empty file, which Prometheus treats as "send no
# Authorization header" — the same as before this existed. That is correct for
# local development, where the app does not require a token. In production the
# app refuses scrapes when METRICS_TOKEN is absent (503), so a missing token
# shows up as AppDown rather than as an open endpoint.
set -e

if [ -n "${METRICS_TOKEN}" ]; then
  umask 077
  printf '%s' "${METRICS_TOKEN}" > /tmp/.metrics_token
else
  : > /tmp/.metrics_token
fi

exec /bin/prometheus "$@"
