/**
 * HTTP load benchmark against a running app server.
 *
 *   SERVER_PID=<pid> BENCH_URL=http://localhost:4321 DATABASE_URL=... \
 *     npx tsx bench/http-bench.ts tiles [seconds] [concurrency]
 *   ... npx tsx bench/http-bench.ts url /api/v1/resources/canvas/bench-2000 [seconds] [concurrency]
 *
 * `tiles` samples real tile coordinates from the database (plus deeper-than-
 * leaf requests, which exercise alias resolution) and hammers the tile route.
 * The server's CPU time and RSS are read from /proc/<SERVER_PID> while it runs,
 * so the cost is attributed to the app process itself.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const [, , mode = 'tiles', ...rest] = process.argv;
const BASE = process.env.BENCH_URL ?? 'http://localhost:4321';
// Act as a signed-in user through the service header (the server must run with
// the same INTERNAL_SERVICE_TOKEN). Without it requests are anonymous.
const headers: Record<string, string> = { 'Accept-Encoding': 'gzip' };
if (process.env.BENCH_USER) {
  headers['x-user-id'] = process.env.BENCH_USER;
  headers['x-internal-token'] = process.env.BENCH_INTERNAL_TOKEN ?? '';
}
const PID = Number(process.env.SERVER_PID ?? 0);

function procSample() {
  if (!PID) return null;
  try {
    const stat = readFileSync(`/proc/${PID}/stat`, 'utf8').split(') ')[1].split(' ');
    const ticks = Number(stat[11]) + Number(stat[12]); // utime + stime
    const status = readFileSync(`/proc/${PID}/status`, 'utf8');
    const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
    return { ticks, rss };
  } catch {
    return null;
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

async function run(urls: string[], seconds: number, concurrency: number) {
  const lat: number[] = [];
  let bytes = 0;
  let errors = 0;
  const statuses = new Map<number, number>();
  const until = Date.now() + seconds * 1000;
  let peakRss = 0;
  const start = procSample();
  const sampler = setInterval(() => {
    const s = procSample();
    if (s && s.rss > peakRss) peakRss = s.rss;
  }, 100);
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async (_, w) => {
      let i = w;
      while (Date.now() < until) {
        const url = urls[(i = (i * 1103515245 + 12345) >>> 0) % urls.length];
        const s = performance.now();
        try {
          const res = await fetch(BASE + url, { headers });
          const buf = await res.arrayBuffer();
          bytes += buf.byteLength;
          statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
          if (res.status >= 500) errors++;
        } catch {
          errors++;
        }
        lat.push(performance.now() - s);
      }
    })
  );
  clearInterval(sampler);
  const elapsed = (performance.now() - t0) / 1000;
  const end = procSample();
  const cpuS = start && end ? (end.ticks - start.ticks) / 100 : NaN; // CLK_TCK = 100
  return {
    requests: lat.length,
    rps: +(lat.length / elapsed).toFixed(1),
    p50: +pct(lat, 50).toFixed(1),
    p95: +pct(lat, 95).toFixed(1),
    p99: +pct(lat, 99).toFixed(1),
    max: +Math.max(...lat).toFixed(1),
    mbPerS: +(bytes / 1048576 / elapsed).toFixed(2),
    kbPerRequest: +(bytes / 1024 / Math.max(1, lat.length)).toFixed(1),
    errors,
    statuses: Object.fromEntries(statuses),
    serverCpuPct: +((cpuS / elapsed) * 100).toFixed(1),
    serverCpuMsPerRequest: +((cpuS * 1000) / Math.max(1, lat.length)).toFixed(2),
    serverPeakRssMb: Math.round(peakRss),
  };
}

async function tileUrls(): Promise<string[]> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows: scopes } = await pool.query(`SELECT generation FROM graph_scopes WHERE scope = 'public'`);
  if (!scopes.length) throw new Error('no public graph scope in DATABASE_URL; run npm run graph:build against the bench database first');
  const gen = scopes[0].generation;
  const { rows } = await pool.query(
    `SELECT z, x, y, leaf FROM graph_tiles WHERE scope = 'public' AND generation = $1 ORDER BY random() LIMIT 3000`,
    [gen]
  );
  await pool.end();
  const urls: string[] = [];
  for (const r of rows) {
    urls.push(`/api/v1/graph/tiles/public/${gen}/${r.z}/${r.x}/${r.y}`);
    // Requests below a leaf resolve to it server-side (the client's common case
    // when zoomed in past the deepest tile).
    if (r.leaf && urls.length % 6 === 0) urls.push(`/api/v1/graph/tiles/public/${gen}/${r.z + 2}/${r.x * 4 + 1}/${r.y * 4 + 2}`);
  }
  return urls;
}

const seconds = Number(rest[mode === 'url' ? 1 : 0] ?? 20);
const concurrency = Number(rest[mode === 'url' ? 2 : 1] ?? 16);
const urls = mode === 'url' ? [rest[0]] : await tileUrls();
const result = await run(urls, seconds, concurrency);
console.log(JSON.stringify({ mode, target: mode === 'url' ? rest[0] : `${urls.length} tile urls`, seconds, concurrency, ...result }));
