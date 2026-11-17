/**
 * Prometheus metrics (prom-client) exposed at /api/v1/metrics.
 * Zero-dependency for the request path — only counters/histograms are updated.
 *
 * Registration goes through `./metrics` rather than calling `new promClient.Counter`
 * directly, because this module is evaluated more than once per process (the OTel
 * preload bundle and the app bundle each hold a copy) and prom-client throws on a
 * duplicate name. See the comment in `metrics.ts`.
 */
import { collectDefaultMetricsOnce, counterOrGet, histogramOrGet, register } from './metrics';
import { config } from './config';

collectDefaultMetricsOnce();

export const httpRequests = counterOrGet({
  name: 'foss_http_requests_total',
  help: 'HTTP requests by route, method and status',
  labelNames: ['route', 'method', 'status'],
});

export const httpRequestDuration = histogramOrGet({
  name: 'foss_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['route', 'method'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/**
 * Responses that reached the client as a failure (4xx/5xx).
 *
 * Deliberately a separate counter rather than a `sum(foss_http_requests_total{status=~"5.."})`
 * derivation: an error dashboard wants 5xx alone (low-noise alert signal), while
 * client-error rate needs 4xx too, and keeping the split out of the recording
 * path means one query change later rather than a label change to existing time
 * series.
 */
export const httpErrors = counterOrGet({
  name: 'foss_http_errors_total',
  help: 'HTTP error responses by route, method and class',
  labelNames: ['route', 'method', 'class'],
});

/** Failures that never became a response: unhandled rejections/throws, degraded deps. */
export const unhandledErrors = counterOrGet({
  name: 'foss_unhandled_errors_total',
  help: 'Process-level unhandled rejections and exceptions',
  labelNames: ['kind'],
});

let observeStarted = false;

/** Call once per request (idempotent guard inside Astro middleware). */
export function recordHttp(route: string, method: string, statusCode: number, durationMs: number): void {
  httpRequests.inc({ route, method, status: String(statusCode) });
  httpRequestDuration.observe({ route, method }, durationMs / 1000);
  if (statusCode >= 400) {
    httpErrors.inc({
      route,
      method,
      class: statusCode >= 500 ? 'server' : 'client',
    });
  }
}

export async function metricsText(): Promise<string> {
  if (!observeStarted) {
    // Default node metrics only start sampling once read; warm it.
    await register.metrics();
    observeStarted = true;
  }
  return register.metrics();
}

export { register, config };
