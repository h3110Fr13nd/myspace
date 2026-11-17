import { expect, test } from '@playwright/test';
import {
  decideMetricsAccess,
  readBearerToken,
} from '../../src/lib/metricsAuth';

/**
 * Behavioural contract for the /api/v1/metrics gate.
 *
 * The endpoint hands out process internals — route names, pool sizes, heap — and
 * it used to do that to anyone who asked. Two properties make it safe to leave
 * reachable, and they are the ones asserted here:
 *
 *   1. With a token configured, only the exact bearer value is accepted.
 *   2. With no token configured, production refuses rather than serving. A
 *      missing secret is a deploy error, and defaulting to "open" would turn
 *      that mistake into a silent information disclosure.
 */

const TOKEN = 'mock-metrics-auth-token-for-unit-test';
const header = (value: string) => new Headers({ authorization: value });

test.describe('token parsing', () => {
  test('reads a bearer value, case-insensitively on the scheme', () => {
    expect(readBearerToken(header(`Bearer ${TOKEN}`))).toBe(TOKEN);
    expect(readBearerToken(header(`bearer ${TOKEN}`))).toBe(TOKEN);
    expect(readBearerToken(header(`BEARER  ${TOKEN}  `))).toBe(TOKEN);
  });

  test('ignores other schemes and empty headers', () => {
    // Otherwise the secret is just a password: accepted from any Basic/custom
    // scheme, and liable to land in a proxy access log that never redacts it.
    expect(readBearerToken(header(`Basic ${Buffer.from(TOKEN).toString('base64')}`))).toBe('');
    expect(readBearerToken(header(TOKEN))).toBe('');
    expect(readBearerToken(new Headers())).toBe('');
  });
});

test.describe('with a token configured', () => {
  test('accepts only the exact token, in any environment', () => {
    expect(decideMetricsAccess(TOKEN, TOKEN, true)).toBe(true);
    expect(decideMetricsAccess(TOKEN, TOKEN, false)).toBe(true);
  });

  test('rejects a missing or wrong token', () => {
    expect(decideMetricsAccess(TOKEN, '', true)).toBe(false);
    expect(decideMetricsAccess(TOKEN, 'nope', true)).toBe(false);
  });

  test('rejects near misses in both directions', () => {
    // A prefix/extension match would let a guess be confirmed byte by byte.
    expect(decideMetricsAccess(TOKEN, TOKEN.slice(0, -1), true)).toBe(false);
    expect(decideMetricsAccess(TOKEN, TOKEN + 'x', true)).toBe(false);
    expect(decideMetricsAccess(TOKEN, TOKEN.toUpperCase(), true)).toBe(false);
  });
});

test.describe('with no token configured', () => {
  test('production refuses the scrape rather than serving it open', () => {
    expect(decideMetricsAccess('', '', true)).toBe(false);
    // A caller offering a token does not make an unconfigured endpoint serve.
    expect(decideMetricsAccess('', 'anything', true)).toBe(false);
  });

  test('development stays open so `--profile infra` needs no setup', () => {
    expect(decideMetricsAccess('', '', false)).toBe(true);
  });
});
