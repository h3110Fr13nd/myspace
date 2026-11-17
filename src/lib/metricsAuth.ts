/**
 * Scrape authentication for `/api/v1/metrics`.
 *
 * Prometheus exposes process internals by default: route names (including the
 * `:id` segments, which are derived from real resource ids), connection-pool
 * sizes, heap usage, and every label the app attaches. That is reconnaissance
 * for free, and the endpoint was reachable on the same public listener as the
 * rest of the app.
 *
 * The gate is a single shared bearer secret rather than a user session, because
 * a scraper has no user and the endpoint is not user-scoped. It is deliberately
 * fail-closed in production: an unset token in a production process returns 503
 * rather than serving the scrape, so a deploy cannot silently regress into an
 * open endpoint. Development keeps working with no configuration at all.
 *
 * See plan/core-architecture/32-observability-and-telemetry-stack.md §3.6
 */
import crypto from 'crypto';
import { config } from './config';
import { logger } from './logger';

/**
 * Constant-time compare. A plain `===` on a bearer token leaks its prefix
 * through response timing, which is enough to recover it byte by byte.
 * Length is compared first because `timingSafeEqual` throws on a mismatch, and
 * the length of a shared secret is not itself secret.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

let warnedMissing = false;

/**
 * The whole decision, as a pure function of its inputs.
 *
 * Split out from the `Headers`/env plumbing so it can be tested across all
 * four combinations of (token configured, production) without mutating module
 * state, and so the rule is readable in one place.
 */
export function decideMetricsAccess(expectedToken: string, presentedToken: string, isProd: boolean): boolean {
  if (!expectedToken) {
    // No secret means there is nothing to check a caller against. In production
    // that is a deploy mistake, and the safe reading of "I cannot verify you" is
    // "no" — serving here is what made the endpoint public in the first place.
    return !isProd;
  }
  if (!presentedToken) return false;
  return safeEqual(presentedToken, expectedToken);
}

/** Pull the bearer value out of an Authorization header, ignoring other schemes. */
export function readBearerToken(headers: Headers): string {
  const header = headers.get('authorization') || '';
  if (!/^bearer\s+/i.test(header)) return '';
  return header.replace(/^bearer\s+/i, '').trim();
}

/**
 * `true` when the caller may read the metrics body.
 *
 * Failure responses deliberately say nothing about *why* — a wrong token and a
 * missing token must be indistinguishable, or this becomes an oracle for
 * whether a guessed secret was close.
 */
export function authorizeMetricsRequest(headers: Headers): boolean {
  const expected = process.env.METRICS_TOKEN || '';
  const allowed = decideMetricsAccess(expected, readBearerToken(headers), config.isProd);

  if (!allowed && !expected && config.isProd && !warnedMissing) {
    warnedMissing = true;
    logger.error(
      'METRICS_TOKEN is not set, so /api/v1/metrics is refusing scrapes. ' +
        'Set METRICS_TOKEN and give Prometheus the same value as a bearer token.'
    );
  }
  return allowed;
}

export function metricsDeniedResponse(): Response {
  // 503 vs 401 tells a scraper whether to fix its token or the deployment. That
  // distinction is safe: it is about this process's configuration, not the
  // secret's value.
  const unconfigured = config.isProd && !process.env.METRICS_TOKEN;
  const body = unconfigured
    ? 'metrics endpoint is not configured\n'
    : 'metrics scrape requires a bearer token\n';
  return new Response(body, {
    status: unconfigured ? 503 : 401,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
