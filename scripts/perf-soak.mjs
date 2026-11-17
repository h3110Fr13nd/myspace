#!/usr/bin/env node

// Closed-loop mixed-route load with configurable user think time.
// Sample the app's cgroup CPU pressure and container memory before and after
// running this script to distinguish realistic traffic from saturation tests.
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const baseUrl = process.env.LOAD_BASE_URL || 'http://localhost:4322';
const closeConnections = process.env.LOAD_CONNECTION_CLOSE === '1';
const withConnectionPolicy = (headers) => closeConnections
  ? { ...headers, connection: 'close' }
  : headers;
const rawLoadPaths = process.env.LOAD_PATHS_JSON;
let loadPaths;
if (rawLoadPaths) {
  try {
    loadPaths = JSON.parse(rawLoadPaths);
  } catch {
    throw new Error('LOAD_PATHS_JSON must be a JSON array of request paths.');
  }
} else {
  loadPaths = [process.env.LOAD_PATH || '/'];
}
if (!Array.isArray(loadPaths) || loadPaths.length < 1 || loadPaths.length > 20 ||
    loadPaths.some((path) => typeof path !== 'string' || !path.startsWith('/'))) {
  throw new Error('LOAD_PATHS_JSON must contain 1–20 paths beginning with /.');
}

function positiveInt(name, fallback, max) {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}.`);
  }
  return value;
}

function nonnegativeInt(name, fallback, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${name} must be an integer from 0 to ${max}.`);
  }
  return value;
}

const users = positiveInt('LOAD_USERS', 100, 500);
const durationMs = positiveInt('LOAD_DURATION_SECONDS', 60, 3600) * 1000;
const thinkTimeMs = positiveInt('LOAD_THINK_MS', 10_000, 60_000);
const requestTimeoutMs = positiveInt('LOAD_REQUEST_TIMEOUT_MS', 15_000, 120_000);
const warmupPerAuthMode = nonnegativeInt('LOAD_WARMUP_REQUESTS', 3, 100);
const email = process.env.LOAD_EMAIL;
const password = process.env.LOAD_PASSWORD;
const rawAuthenticatedUsers = process.env.LOAD_AUTH_USERS;
const rawAccounts = process.env.LOAD_ACCOUNTS_JSON;
const writeMix = process.env.LOAD_WRITE_MIX === '1';
const writePath = '/api/v1/resources/save';
const profileContainer = process.env.LOAD_PROFILE_CONTAINER;
const profileDir = process.env.LOAD_PROFILE_DIR;
const profileEnabled = Boolean(profileContainer && profileDir);
let accounts = [];
if (rawAccounts) {
  if (email || password) {
    throw new Error('Use LOAD_ACCOUNTS_JSON or LOAD_EMAIL/LOAD_PASSWORD, not both.');
  }
  try {
    accounts = JSON.parse(rawAccounts);
  } catch {
    throw new Error('LOAD_ACCOUNTS_JSON must contain a JSON array of account credentials.');
  }
  if (!Array.isArray(accounts) || accounts.length === 0 || accounts.length > 100 ||
      accounts.some((account) => typeof account?.email !== 'string' ||
        typeof account?.password !== 'string' || !account.email || !account.password)) {
    throw new Error('LOAD_ACCOUNTS_JSON must contain 1–100 accounts with email and password.');
  }
} else if (Boolean(email) !== Boolean(password)) {
  throw new Error('Set both LOAD_EMAIL and LOAD_PASSWORD, or neither.');
} else if (email && password) {
  accounts = [{ email, password }];
}
if (rawAuthenticatedUsers && accounts.length === 0) {
  throw new Error('LOAD_AUTH_USERS requires an authenticated account.');
}

let authenticatedUsers = 0;
let authenticatedIdentityVerified = false;
const sessions = [];
if (accounts.length > 0) {
  if (rawAuthenticatedUsers && !/^\d+$/.test(rawAuthenticatedUsers)) {
    throw new Error('LOAD_AUTH_USERS must be a positive integer.');
  }
  authenticatedUsers = rawAuthenticatedUsers ? Number.parseInt(rawAuthenticatedUsers, 10) : users;
  if (!Number.isInteger(authenticatedUsers) || authenticatedUsers < 1 || authenticatedUsers > users) {
    throw new Error(`LOAD_AUTH_USERS must be an integer from 1 to ${users}.`);
  }

  for (const account of accounts) {
    const login = await fetch(new URL('/api/v1/auth/login', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(account),
    });
    if (!login.ok) throw new Error(`Login failed with HTTP ${login.status}.`);
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('Login response did not set a session cookie.');
    const identityResponse = await fetch(new URL('/api/v1/auth/me', baseUrl), {
      headers: { cookie },
    });
    if (!identityResponse.ok) {
      throw new Error(`Identity check failed with HTTP ${identityResponse.status}.`);
    }
    const identity = await identityResponse.json();
    if (identity.authenticated !== true ||
        identity.user?.email?.toLowerCase() !== account.email.toLowerCase()) {
      throw new Error('Login session did not resolve to the requested account.');
    }
    sessions.push({ cookie });
  }
  authenticatedIdentityVerified = sessions.length === accounts.length;
}

const authStart = Math.floor((users - authenticatedUsers) / 2);
const writeResourceIds = new Map();
if (writeMix) {
  if (sessions.length === 0) throw new Error('LOAD_WRITE_MIX requires authenticated accounts.');
  for (let accountIndex = 0; accountIndex < sessions.length; accountIndex++) {
    const response = await fetch(new URL('/api/v1/resources/create', baseUrl), {
      method: 'POST',
      headers: withConnectionPolicy({
        cookie: sessions[accountIndex].cookie,
        'content-type': 'application/json',
      }),
      body: JSON.stringify({
        title: `Capacity write fixture ${accountIndex}`,
        type: 'document',
        is_public: false,
        tags: ['capacity'],
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const resource = await response.json();
    if (response.status !== 201 || typeof resource.id !== 'string') {
      throw new Error(`Could not prepare isolated save fixture (HTTP ${response.status}).`);
    }
    writeResourceIds.set(accountIndex, resource.id);
  }
  console.log(`[load setup] prepared ${writeResourceIds.size} isolated save fixtures for ${sessions.length} authenticated identities`);
}

// Prime each route for anonymous traffic and one verified account. The measured
// run still exercises every configured identity; repeatedly warming every
// identity would add setup traffic without improving shared-resource coverage.
let warmupRequests = 0;
const warmupHeaders = sessions.length > 0
  ? [undefined, { cookie: sessions[0].cookie }]
  : [undefined];
for (const headers of warmupHeaders) {
  for (const path of loadPaths) {
    for (let requestNumber = 0; requestNumber < warmupPerAuthMode; requestNumber++) {
      const response = await fetch(new URL(path, baseUrl), {
        headers: withConnectionPolicy(headers),
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      await response.arrayBuffer();
      warmupRequests++;
      if (!response.ok) {
        throw new Error(`Warm-up request to ${path} failed with HTTP ${response.status}.`);
      }
    }
  }
}

const samples = [];
const statuses = new Map();
const statusByAuth = new Map([
  ['authenticated', new Map()],
  ['anonymous', new Map()],
]);
const samplesByAuth = new Map([
  ['authenticated', []],
  ['anonymous', []],
]);
const statusByPath = new Map(loadPaths.map((path) => [path, new Map()]));
const samplesByPath = new Map(loadPaths.map((path) => [path, []]));
const errorsByPath = new Map(loadPaths.map((path) => [path, new Map()]));
if (writeMix) {
  statusByPath.set(`POST ${writePath}`, new Map());
  samplesByPath.set(`POST ${writePath}`, []);
  errorsByPath.set(`POST ${writePath}`, new Map());
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForFile = async (filePath, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Timed out waiting for profiler artifact: ${filePath}`);
};
const signalProfiler = async (signal) => {
  await run('docker', ['kill', `--signal=${signal}`, profileContainer], { timeout: 5_000 });
};

if (profileEnabled) {
  await signalProfiler('SIGUSR1');
  await waitForFile(`${profileDir}/started`);
}
const end = Date.now() + durationMs;

try {
  await Promise.all(Array.from({ length: users }, async (_, index) => {
    const isAuthenticated = sessions.length > 0 && index >= authStart && index < authStart + authenticatedUsers;
    const authKind = isAuthenticated ? 'authenticated' : 'anonymous';
    const accountIndex = isAuthenticated ? (index - authStart) % sessions.length : 0;
    const headers = isAuthenticated ? { cookie: sessions[accountIndex].cookie } : undefined;
    await sleep(Math.min(Math.floor((index * thinkTimeMs) / users), durationMs));
    let requestNumber = 0;
    while (Date.now() < end) {
      const requestIndex = requestNumber++;
      const shouldSave = writeMix && isAuthenticated && requestIndex % 3 === 2;
      const path = shouldSave ? writePath : loadPaths[(index + requestIndex) % loadPaths.length];
      const pathKey = shouldSave ? `POST ${writePath}` : path;
      const requestHeaders = withConnectionPolicy(shouldSave
        ? { ...headers, 'content-type': 'application/json' }
        : headers);
      const requestBody = shouldSave
        ? JSON.stringify({
            id: writeResourceIds.get(accountIndex),
            title: `Capacity write ${index}`,
            content: `# Capacity write ${index}\n\nUpdated ${new Date().toISOString()}\n`,
            tags: ['capacity'],
            summary: 'Synthetic capacity write fixture',
          })
        : undefined;
      const started = performance.now();
      try {
        const response = await fetch(new URL(path, baseUrl), {
          method: shouldSave ? 'POST' : 'GET',
          headers: requestHeaders,
          body: requestBody,
          redirect: 'manual',
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        await response.arrayBuffer();
        for (const bucket of [statuses, statusByAuth.get(authKind), statusByPath.get(pathKey)]) {
          bucket.set(response.status, (bucket.get(response.status) || 0) + 1);
        }
      } catch (error) {
        for (const bucket of [statuses, statusByAuth.get(authKind), statusByPath.get(pathKey)]) {
          bucket.set('error', (bucket.get('error') || 0) + 1);
        }
        const reason = error?.cause?.code || error?.name || 'UnknownError';
        const errors = errorsByPath.get(pathKey);
        errors.set(reason, (errors.get(reason) || 0) + 1);
      }
      const duration = performance.now() - started;
      samples.push(duration);
      samplesByAuth.get(authKind).push(duration);
      samplesByPath.get(pathKey).push(duration);

      const remaining = end - Date.now();
      if (remaining > 0) await sleep(Math.min(thinkTimeMs, remaining));
    }
  }));
} finally {
  if (profileEnabled) {
    await signalProfiler('SIGUSR2');
    await waitForFile(`${profileDir}/load.cpuprofile`);
    await waitForFile(`${profileDir}/load.heapprofile`);
  }
}

function latencySummary(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const percentile = (fraction) => Math.round(values[Math.ceil(values.length * fraction) - 1]);
  return { requests: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
    p99Ms: percentile(0.99), maxMs: Math.round(values.at(-1)) };
}
const latency = latencySummary(samples);
const elapsedMs = Date.now() - end + durationMs;
console.log(JSON.stringify({
  virtualUsers: users,
  authentication: authenticatedUsers
    ? `${authenticatedUsers}/${users} authenticated via ${sessions.length} identity/identities (centered among anonymous users)`
    : 'anonymous',
  authenticatedIdentityVerified,
  authenticatedIdentityCount: sessions.length,
  warmupRequests,
  paths: loadPaths,
  writeMix,
  closeConnections,
  thinkTimeMs,
  durationSeconds: Math.round(elapsedMs / 1000),
  requests: samples.length,
  requestsPerSecond: +(samples.length / (elapsedMs / 1000)).toFixed(2),
  statuses: Object.fromEntries(statuses),
  statusByAuth: Object.fromEntries(
    [...statusByAuth].map(([kind, counts]) => [kind, Object.fromEntries(counts)])
  ),
  statusByPath: Object.fromEntries(
    [...statusByPath].map(([path, counts]) => [path, Object.fromEntries(counts)])
  ),
  errorsByPath: Object.fromEntries(
    [...errorsByPath].filter(([, errors]) => errors.size > 0)
      .map(([path, errors]) => [path, Object.fromEntries(errors)])
  ),
  latencyByAuth: Object.fromEntries(
    [...samplesByAuth].map(([kind, values]) => [kind, latencySummary(values)])
  ),
  latencyByPath: Object.fromEntries(
    [...samplesByPath].map(([path, values]) => [path, latencySummary(values)])
  ),
  p50Ms: latency?.p50Ms ?? null,
  p95Ms: latency?.p95Ms ?? null,
  p99Ms: latency?.p99Ms ?? null,
  maxMs: latency?.maxMs ?? null,
}));
