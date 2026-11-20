/**
 * Client-side benchmark: drives real Chromium against the /bench/* pages and
 * measures what a user feels and what the browser pays.
 *
 *   BENCH_URL=http://localhost:4321 npx tsx bench/browser-bench.ts [scenario-filter]
 *
 * Per scenario, in a fresh browser context:
 *  - ready:     ms from navigation to first meaningful paint of the view
 *  - frames:    rAF intervals during a scripted pan and zoom (p50/p95/max,
 *               share of frames slower than 33 ms = visible jank)
 *  - longTasks: total main-thread long-task time during the interaction
 *  - heap:      JS heap after settling (CDP Performance.getMetrics)
 *  - dom:       DOM node count (CDP)
 *
 * Headless Chromium rasterises WebGL and compositing on the CPU (SwiftShader),
 * so absolute frame times are pessimistic; compare rows, not against 60 fps.
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BENCH_URL ?? 'http://localhost:4321';
const filter = process.argv[2] ?? '';

interface Scenario {
  name: string;
  path: string;
  kind: 'classic' | 'tiled' | 'canvas';
  n: number;
}

const scenarios: Scenario[] = [
  ...[1000, 5000, 20000, 50000].map((n) => ({ name: `graph classic ${n}`, path: `/bench/graph-classic?n=${n}`, kind: 'classic' as const, n })),
  { name: 'graph tiled (DB)', path: '/bench/graph', kind: 'tiled', n: 0 },
  ...[500, 2000, 10000, 50000].flatMap((n) => [
    { name: `canvas editor ${n}`, path: `/bench/canvas?n=${n}&mode=editor`, kind: 'canvas' as const, n },
    { name: `canvas viewer ${n}`, path: `/bench/canvas?n=${n}&mode=viewer`, kind: 'canvas' as const, n },
  ]),
].filter((s) => new RegExp(filter).test(s.name));

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const cdpSessions = new WeakMap<Page, import('@playwright/test').CDPSession>();

/**
 * One CDP session per page, enabled once: `Performance.enable` resets the
 * cumulative counters, so re-enabling per read would zero every delta.
 */
async function metrics(page: Page) {
  let cdp = cdpSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    cdpSessions.set(page, cdp);
  }
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return {
    heapMb: +(m.JSHeapUsedSize / 1048576).toFixed(1),
    dom: m.Nodes,
    // Cumulative main-thread seconds; deltas over the interaction are the
    // hardware-independent cost (no GPU rasterisation in them).
    taskS: m.TaskDuration,
    scriptS: m.ScriptDuration,
    layoutS: m.LayoutDuration + m.RecalcStyleDuration,
  };
}

async function startRecording(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    w.__long = [];
    w.__recording = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      w.__po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__long.push(e.duration);
      });
      w.__po.observe({ type: 'longtask', buffered: false });
    } catch {
      /* longtask unsupported */
    }
  });
}

async function stopRecording(page: Page) {
  return page.evaluate(() => {
    const w = window as any;
    w.__recording = false;
    w.__po?.disconnect();
    return { frames: (w.__frames as number[]).slice(1), long: w.__long as number[] };
  });
}

/** ~2 s of drag panning then ~1.5 s of wheel zooming out and back in. */
async function interact(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'left' });
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(cx - i * 6, cy - i * 3);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(30);
  }
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
}

const RUN_TIMEOUT_S = Number(process.env.BENCH_RUN_TIMEOUT_S ?? 240);

/** One scenario run, abandoned (and reported as such) after RUN_TIMEOUT_S. */
async function run(s: Scenario, base = BASE): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abandon: (() => void) | undefined;
  const timeout = new Promise<any>((resolve) => {
    timer = setTimeout(() => {
      abandon?.();
      resolve({ scenario: s.name, n: s.n, readyMs: -1, error: `did not finish within ${RUN_TIMEOUT_S} s` });
    }, RUN_TIMEOUT_S * 1000);
  });
  const result = await Promise.race([runOnce(s, base, (fn) => (abandon = fn)), timeout]);
  clearTimeout(timer);
  return result;
}

async function runOnce(s: Scenario, base: string, onAbandon: (fn: () => void) => void) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    // Chromium defaults: in a GPU-less container WebGL and compositing fall
    // back to SwiftShader either way; forcing ANGLE/SwiftShader flags measured
    // ~2.5x slower frames than the defaults.
    args: ['--enable-precise-memory-info'],
  });
  onAbandon(() => void browser.close().catch(() => {}));
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  // tsx/esbuild (keepNames) wraps functions passed to page.evaluate in a
  // `__name(...)` helper that does not exist in the page.
  await context.addInitScript({ content: 'window.__name = (f) => f;' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  let ready = -1;
  try {
    await page.goto(base + s.path, { waitUntil: 'load', timeout: 180_000 });
    let box: { x: number; y: number; width: number; height: number } | null = null;
    if (s.kind === 'tiled') {
      await page.waitForFunction(() => (window as any).__tiledGraph?.stats().tilesDrawn > 0, null, { timeout: 120_000 });
      ready = Date.now() - t0;
      box = await page.locator('.tiled-graph__stage').boundingBox();
    } else if (s.kind === 'classic') {
      await page.waitForSelector('.graph-viewport-bar__expand', { timeout: 120_000 });
      await page.click('.graph-viewport-bar__expand');
      await page.waitForSelector('.graph-modal-full canvas', { timeout: 120_000 });
      // First paint of the full graph happens after the warm-up ticks.
      await page.waitForTimeout(50);
      ready = Date.now() - t0;
      box = await page.locator('.graph-modal-full canvas').first().boundingBox();
    } else {
      await page.waitForSelector('.canvas-board-viewport', { timeout: 180_000 });
      await page.waitForFunction(() => document.querySelectorAll('.canvas-interactive-node, .canvas-lod-layer').length > 0, null, {
        timeout: 180_000,
      });
      ready = Date.now() - t0;
      box = await page.locator('.canvas-board-viewport').first().boundingBox();
    }
    // Let initial streaming / simulation warm-up settle before measuring.
    await metrics(page);
    await page.waitForTimeout(s.kind === 'classic' ? 3000 : 1500);
    const before = await metrics(page);
    await startRecording(page);
    await interact(page, box!);
    const rec = await stopRecording(page);
    const after = await metrics(page);
    const extra = s.kind === 'tiled' ? await page.evaluate(() => {
      const st = (window as any).__tiledGraph.stats();
      return { tilesLoaded: st.loaded, wireKb: Math.round(st.wireBytes / 1024), cacheMb: +(st.bytes / 1048576).toFixed(1), gpuMb: +(st.gpuBytes / 1048576).toFixed(1) };
    }) : {};
    const frames = rec.frames;
    const seconds = frames.reduce((a, b) => a + b, 0) / 1000 || 1;
    return {
      scenario: s.name,
      n: s.n,
      readyMs: ready,
      p50: +pct(frames, 50).toFixed(1),
      p95: +pct(frames, 95).toFixed(1),
      max: +Math.max(0, ...frames).toFixed(1),
      jankPct: +((frames.filter((f) => f > 33.4).length / Math.max(1, frames.length)) * 100).toFixed(1),
      frames: frames.length,
      interactionS: +seconds.toFixed(1),
      longTaskMs: Math.round(rec.long.reduce((a, b) => a + b, 0)),
      // Main-thread work per second of interaction (1000 = fully saturated).
      mainMsPerS: Math.round(((after.taskS - before.taskS) * 1000) / seconds),
      scriptMsPerS: Math.round(((after.scriptS - before.scriptS) * 1000) / seconds),
      layoutMsPerS: Math.round(((after.layoutS - before.layoutS) * 1000) / seconds),
      heapMb: after.heapMb,
      heapBeforeMb: before.heapMb,
      dom: after.dom,
      ...extra,
      errors: errors.slice(0, 3),
    };
  } catch (err) {
    return { scenario: s.name, n: s.n, readyMs: ready, error: String((err as Error).message).slice(0, 200), errors: errors.slice(0, 3) };
  } finally {
    await browser.close();
  }
}

/**
 * Compare mode: BENCH_TARGETS="before=http://host:4600,after=http://host:4500"
 * runs every scenario against each target, interleaved, BENCH_REPEAT times,
 * and reports the median per (scenario, target). Interleaving matters on
 * shared hosts: CPU steal then affects both sides equally.
 */
const targets = (process.env.BENCH_TARGETS ?? '')
  .split(',')
  .filter(Boolean)
  .map((t) => {
    const [name, url] = t.split('=');
    return { name, url };
  });
const repeat = Number(process.env.BENCH_REPEAT ?? 1);

const median = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};

const rows: any[] = [];
if (targets.length) {
  for (const s of scenarios) {
    const runs = new Map<string, any[]>();
    for (let r = 0; r < repeat; r++) {
      for (const t of targets) {
        if (s.kind === 'tiled' && t.name === 'before') continue; // did not exist
        const result = await run(s, t.url);
        console.log(JSON.stringify({ target: t.name, rep: r, ...result }));
        if (!runs.has(t.name)) runs.set(t.name, []);
        runs.get(t.name)!.push(result);
      }
    }
    for (const [target, list] of runs) {
      const ok = list.filter((x) => !x.error);
      if (!ok.length) {
        rows.push({ ...list[0], scenario: `${s.name} [${target}]` });
        continue;
      }
      const pick = (k: string) => median(ok.map((x) => x[k]));
      rows.push({
        scenario: `${s.name} [${target}]`,
        n: s.n,
        readyMs: pick('readyMs'),
        p50: pick('p50'),
        p95: pick('p95'),
        max: pick('max'),
        jankPct: pick('jankPct'),
        mainMsPerS: pick('mainMsPerS'),
        scriptMsPerS: pick('scriptMsPerS'),
        layoutMsPerS: pick('layoutMsPerS'),
        longTaskMs: pick('longTaskMs'),
        interactionS: pick('interactionS'),
        heapMb: pick('heapMb'),
        dom: pick('dom'),
        tilesLoaded: ok[0].tilesLoaded,
        wireKb: ok[0].wireKb,
        cacheMb: ok[0].cacheMb,
        gpuMb: ok[0].gpuMb,
        runs: ok.length,
      });
    }
  }
} else {
  for (const s of scenarios) {
    const r = await run(s);
    rows.push(r);
    console.log(JSON.stringify(r));
  }
}

const lines = [
  '| Scenario | Ready | Frame p50 | p95 | Jank >33ms | Main thread busy | Script | Layout+style | Scripted input took | JS heap | DOM nodes | Notes |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ...rows.map((r) =>
    r.error
      ? `| ${r.scenario} | ${r.readyMs > 0 ? `${r.readyMs} ms` : '—'} | — | — | — | — | — | — | — | — | — | **${r.error}** |`
      : `| ${r.scenario} | ${r.readyMs} ms | ${r.p50} ms | ${r.p95} ms | ${r.jankPct}% | ${Math.round(r.mainMsPerS / 10)}% | ${r.scriptMsPerS} ms/s | ${r.layoutMsPerS} ms/s | ${r.interactionS} s | ${r.heapMb} MB | ${r.dom} | ${
          r.tilesLoaded !== undefined ? `${r.tilesLoaded} tiles, ${r.wireKb} KB streamed, cache ${r.cacheMb} MB, GPU ${r.gpuMb} MB` : ''
        }${r.errors?.length ? ` errors: ${r.errors.join('; ').slice(0, 120)}` : ''} |`
  ),
];
console.log('\n' + lines.join('\n'));
const out = join(HERE, 'results');
mkdirSync(out, { recursive: true });
const tag = process.env.BENCH_TAG ?? 'run';
writeFileSync(join(out, `browser-${tag}.json`), JSON.stringify(rows, null, 2));
writeFileSync(join(out, `browser-${tag}.md`), lines.join('\n') + '\n');
