import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for profiler artifact: ${filePath}`);
}

function positiveIntegerEnv(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be between 1 and ${max}.`);
  }
  return value;
}

test('mixed load verifies the account and reports both traffic groups', async ({ request, page }) => {
  const users = positiveIntegerEnv('E2E_SOAK_USERS', 5, 100);
  if (users < 3) {
    throw new Error('E2E_SOAK_USERS must be at least 3.');
  }
  const authUsers = positiveIntegerEnv('E2E_SOAK_AUTH_USERS', Math.min(3, users - 2), users - 2);
  const identityCount = positiveIntegerEnv(
    'E2E_SOAK_AUTH_IDENTITIES',
    Math.min(authUsers, 3),
    authUsers,
  );
  const durationSeconds = positiveIntegerEnv('E2E_SOAK_DURATION_SECONDS', 3, 3600);
  const thinkMs = positiveIntegerEnv('E2E_SOAK_THINK_MS', 1000, 60_000);
  const resourceCount = positiveIntegerEnv('E2E_SOAK_RESOURCE_COUNT', 1, 5_000);
  const writeMix = process.env.E2E_SOAK_WRITE_MIX === '1';
  const capacityPaths = [
    '/', '/', '/', '/',
    '/?doc=document%3Apublic_hello', '/?doc=document%3Apublic_hello', '/?doc=document%3Apublic_hello',
    '/tags',
    '/api/v1/search?q=capacity',
    '/api/v1/workspace/graph',
  ];
  const paths = process.env.E2E_SOAK_PATHS_JSON
    ? JSON.parse(process.env.E2E_SOAK_PATHS_JSON) as string[]
    : process.env.E2E_SOAK_PATH
      ? [process.env.E2E_SOAK_PATH]
      : process.env.E2E_CAPACITY_MODE === '1'
        ? capacityPaths
        : ['/'];
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 20 ||
      paths.some((path) => typeof path !== 'string' || !path.startsWith('/'))) {
    throw new Error('E2E_SOAK_PATHS_JSON must contain 1–20 paths beginning with /.');
  }
  const timeoutMs = durationSeconds * 1000 + 30_000;
  test.setTimeout(timeoutMs + 70_000);

  const accounts: Array<{ email: string; password: string }> = [];
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let index = 0; index < identityCount; index++) {
    const account = {
      email: `dummy_mail_${runId}_${index}`,
      password: `PerfSoak-${runId}-${index}!Aa1`,
    };
    const response = await request.post('/api/v1/auth/register', {
      data: { ...account, displayName: `E2E Load Identity ${index + 1}` },
    });
    expect(response.status(), 'isolated load account registration').toBe(201);
    accounts.push(account);
  }

  if (resourceCount > 50) {
    await page.goto(paths[0]);
    const treeRows = page.locator('[data-testid="file-node"]');
    await expect(treeRows).toHaveCount(25, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Show 25 more resources' }).click();
    await expect(treeRows).toHaveCount(50);
  }

  const capacityContainers = process.env.E2E_CAPACITY_CONTAINERS_JSON
    ? JSON.parse(process.env.E2E_CAPACITY_CONTAINERS_JSON) as Array<{ service: string; container: string }>
    : [];
  const capacityTargets = await Promise.all(capacityContainers.map(async (entry) => {
    const { stdout } = await run('docker', ['inspect', '--format', '{{.Name}}', entry.container], {
      timeout: 5_000,
    });
    return { ...entry, name: stdout.trim().replace(/^\//, '') };
  }));
  const profileContainer = capacityContainers.find(({ service }) => service === 'app')?.container;
  const profileDir = process.env.E2E_CPU_PROFILE_DIR;
  const profileEnabled = process.env.E2E_CPU_PROFILE === '1' && Boolean(profileContainer && profileDir);
  const capacitySamples: Array<{
    cpuPercent: Record<string, number>;
    memoryMiB: Record<string, number>;
    appPressureSomeAvg10?: number;
    appPressureFullAvg10?: number;
    hostPressureSomeAvg10?: number;
    appCpuStat?: Record<string, number>;
  }> = [];
  let sampling = false;
  const sampleCapacity = async () => {
    if (capacityContainers.length === 0 || sampling) return;
    sampling = true;
    try {
      const { stdout } = await run('docker', [
        'stats', '--no-stream', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}',
        ...capacityTargets.map(({ container }) => container),
      ], { timeout: 5_000 });
      const cpuPercent: Record<string, number> = {};
      const memoryMiB: Record<string, number> = {};
      for (const line of stdout.trim().split('\n')) {
        const [name, cpu, memory] = line.split('|');
        const service = capacityTargets.find((target) =>
          name === target.name
        )?.service;
        if (!service) continue;
        cpuPercent[service] = Number.parseFloat(cpu);
        const usage = memory.match(/^([\d.]+)(B|kB|KiB|MB|MiB|GB|GiB)/)?.slice(1);
        if (usage) {
          const value = Number(usage[0]);
          const unit = usage[1];
          const bytes = unit === 'B' ? value
            : unit === 'kB' || unit === 'KiB' ? value * 1024
              : unit === 'MB' || unit === 'MiB' ? value * 1024 * 1024
                : value * 1024 * 1024 * 1024;
          memoryMiB[service] = bytes / (1024 * 1024);
        }
      }

      const appContainer = capacityContainers.find(({ service }) => service === 'app')?.container;
      let appPressureSomeAvg10: number | undefined;
      let appPressureFullAvg10: number | undefined;
      let appCpuStat: Record<string, number> | undefined;
      if (appContainer) {
        const { stdout: cgroup } = await run('docker', [
          'exec', appContainer, 'sh', '-lc',
          'cat /sys/fs/cgroup/cpu.pressure; printf "\\n--CPU-STAT--\\n"; cat /sys/fs/cgroup/cpu.stat',
        ], { timeout: 5_000 });
        const [pressure, stats] = cgroup.split('--CPU-STAT--');
        appPressureSomeAvg10 = Number(pressure.match(/^some avg10=([\d.]+)/m)?.[1]);
        appPressureFullAvg10 = Number(pressure.match(/^full avg10=([\d.]+)/m)?.[1]);
        appCpuStat = Object.fromEntries(
          [...(stats ?? '').matchAll(/^([a-z_]+)\s+(\d+)$/gm)].map(([, key, value]) => [key, Number(value)])
        );
      }
      const hostPressure = await import('node:fs/promises').then(({ readFile }) =>
        readFile('/proc/pressure/cpu', 'utf8')
      );
      const hostPressureSomeAvg10 = Number(hostPressure.match(/^some avg10=([\d.]+)/m)?.[1]);
      capacitySamples.push({
        cpuPercent,
        memoryMiB,
        appPressureSomeAvg10,
        appPressureFullAvg10,
        hostPressureSomeAvg10,
        appCpuStat,
      });
    } catch {
      // A missing sample is preferable to failing the load test because the
      // Docker stats endpoint had a brief read error.
    } finally {
      sampling = false;
    }
  };

  let loadOutput = '';
  const capacityStartedAt = Date.now();
  await sampleCapacity();
  const sampleTimer = capacityContainers.length > 0
    ? setInterval(() => void sampleCapacity(), 5_000)
    : undefined;
  try {
    const result = await run('node', ['scripts/perf-soak.mjs'], {
    cwd: process.cwd(),
      timeout: timeoutMs + 30_000,
    env: {
      ...process.env,
      LOAD_BASE_URL: process.env.TEST_APP_URL || `http://localhost:${process.env.E2E_APP_PORT || '4321'}`,
      LOAD_ACCOUNTS_JSON: JSON.stringify(accounts),
      LOAD_USERS: String(users),
      LOAD_AUTH_USERS: String(authUsers),
      LOAD_WARMUP_REQUESTS: '3',
      LOAD_DURATION_SECONDS: String(durationSeconds),
      LOAD_THINK_MS: String(thinkMs),
      LOAD_PATHS_JSON: JSON.stringify(paths),
      // Each virtual user is independent. Disable shared Undici keep-alive
      // pooling so one idle test client cannot reuse another client's stale
      // socket after Astro's 5-second server keep-alive timeout.
      LOAD_CONNECTION_CLOSE: '1',
      LOAD_WRITE_MIX: writeMix ? '1' : '0',
      LOAD_PROFILE_CONTAINER: profileEnabled ? profileContainer! : '',
      LOAD_PROFILE_DIR: profileEnabled ? profileDir! : '',
    },
  });
    loadOutput = result.stdout;
  } finally {
    if (sampleTimer) clearInterval(sampleTimer);
    if (profileEnabled && profileContainer && profileDir) {
      await waitForFile(join(profileDir, 'load.cpuprofile'));
      await waitForFile(join(profileDir, 'load.heapprofile'));
      console.log(`[cpu profile] ${join(profileDir, 'load.cpuprofile')}`);
      console.log(`[allocation profile] ${join(profileDir, 'load.heapprofile')}`);
    }
    await sampleCapacity();
  }

  const reportLine = loadOutput.trim().split(/\r?\n/).filter((line) => line.startsWith('{')).at(-1);
  if (!reportLine) throw new Error('The load generator did not return its JSON report.');
  const report = JSON.parse(reportLine);
  expect(report.authenticatedIdentityVerified).toBe(true);
  expect(report.authenticatedIdentityCount).toBe(identityCount);
  expect(report.writeMix).toBe(writeMix);
  expect(report.authentication).toContain(`${authUsers}/${users} authenticated via ${identityCount}`);
  expect(report.warmupRequests).toBe(paths.length * (identityCount > 0 ? 2 : 1) * 3);
  expect(report.statusByAuth.authenticated, JSON.stringify(report)).toEqual({ 200: expect.any(Number) });
  expect(report.statusByAuth.anonymous, JSON.stringify(report)).toEqual({ 200: expect.any(Number) });
  const measuredPaths = writeMix ? [...paths, 'POST /api/v1/resources/save'] : paths;
  for (const path of measuredPaths) {
    expect(report.statusByPath[path], JSON.stringify(report)).toEqual({ 200: expect.any(Number) });
    expect(report.latencyByPath[path]?.requests).toBeGreaterThan(0);
  }
  expect(report.latencyByAuth.authenticated.requests).toBeGreaterThan(0);
  expect(report.latencyByAuth.anonymous.requests).toBeGreaterThan(0);
  console.log('[mixed load]', JSON.stringify({
    authentication: report.authentication,
    authenticatedIdentityCount: report.authenticatedIdentityCount,
    durationSeconds: report.durationSeconds,
    paths: report.paths,
    writeMix: report.writeMix,
    requestsPerSecond: report.requestsPerSecond,
    statusByAuth: report.statusByAuth,
    statusByPath: report.statusByPath,
    latencyByAuth: report.latencyByAuth,
    latencyByPath: report.latencyByPath,
  }));

  if (capacitySamples.length > 0) {
    const services = capacityContainers.map(({ service }) => service);
    const mean = (values: number[]) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    const servingCpuMeanPercent = Object.fromEntries(services.map((service) => [
      service,
      +mean(capacitySamples.map((sample) => sample.cpuPercent[service]).filter(Number.isFinite)).toFixed(2),
    ]));
    const servingMemoryPeakMiB = Object.fromEntries(services.map((service) => [
      service,
      +Math.max(0, ...capacitySamples.map((sample) => sample.memoryMiB[service]).filter(Number.isFinite)).toFixed(1),
    ]));
    console.log('[capacity resources]', JSON.stringify({
      samples: capacitySamples.length,
      sampleIntervalSeconds: 5,
      measuredSeconds: Math.round((Date.now() - capacityStartedAt) / 1000),
      servingCpuMeanPercent,
      servingCpuMeanTotalPercent: +Object.values(servingCpuMeanPercent)
        .reduce((sum, value) => sum + value, 0).toFixed(2),
      servingMemoryPeakMiB,
      servingMemoryPeakTotalMiB: +Object.values(servingMemoryPeakMiB)
        .reduce((sum, value) => sum + value, 0).toFixed(1),
      appCpuPressureSomeAvg10MaxPercent: +Math.max(
        0, ...capacitySamples.map((sample) => sample.appPressureSomeAvg10).filter(Number.isFinite)
      ).toFixed(2),
      appCpuPressureFullAvg10MaxPercent: +Math.max(
        0, ...capacitySamples.map((sample) => sample.appPressureFullAvg10).filter(Number.isFinite)
      ).toFixed(2),
      appCpuStatDelta: Object.fromEntries(['usage_usec', 'nr_periods', 'nr_throttled', 'throttled_usec'].map((key) => [
        key,
        Math.max(0, (capacitySamples.at(-1)?.appCpuStat?.[key] ?? 0)
          - (capacitySamples[0]?.appCpuStat?.[key] ?? 0)),
      ])),
      hostCpuPressureSomeAvg10MaxPercent: +Math.max(
        0, ...capacitySamples.map((sample) => sample.hostPressureSomeAvg10).filter(Number.isFinite)
      ).toFixed(2),
    }));
  }
});
