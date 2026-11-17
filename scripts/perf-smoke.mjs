#!/usr/bin/env node

// Small dependency-free authenticated SSR load probe for a deployment already
// running under its normal Compose CPU and memory limits.
const baseUrl = process.env.LOAD_BASE_URL || 'http://localhost:4322';
const email = process.env.LOAD_EMAIL;
const password = process.env.LOAD_PASSWORD;
const concurrency = (process.env.LOAD_CONCURRENCY || '1,10,100')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value > 0 && value <= 100);

if (!email || !password) {
  console.error('Set LOAD_EMAIL and LOAD_PASSWORD for a local test account.');
  process.exit(2);
}
if (concurrency.length === 0) {
  console.error('LOAD_CONCURRENCY must contain values from 1 to 100.');
  process.exit(2);
}

const login = await fetch(new URL('/api/v1/auth/login', baseUrl), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error(`Login failed with HTTP ${login.status}.`);
  process.exit(1);
}

const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
if (!cookie) {
  console.error('Login response did not set a session cookie.');
  process.exit(1);
}

for (const count of concurrency) {
  const durations = [];
  const startedAt = performance.now();
  const statuses = await Promise.all(
    Array.from({ length: count }, async () => {
      const requestStartedAt = performance.now();
      const response = await fetch(new URL('/', baseUrl), {
        headers: { cookie },
        redirect: 'manual',
      });
      await response.arrayBuffer();
      durations.push(performance.now() - requestStartedAt);
      return response.status;
    })
  );

  durations.sort((a, b) => a - b);
  const percentile = (fraction) => Math.round(durations[Math.ceil(durations.length * fraction) - 1]);
  console.log(JSON.stringify({
    concurrency: count,
    allOk: statuses.every((status) => status === 200),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: Math.round(durations.at(-1)),
    wallMs: Math.round(performance.now() - startedAt),
  }));
}
