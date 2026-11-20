/**
 * Where does the main thread go during an interaction? Aggregates a Chrome
 * trace of a scripted drag by event name (renderer main thread), and a CPU
 * profile by function + hottest source lines.
 *
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE=... npx tsx bench/diagnostics/trace.ts <url> [drag|wheel] [--profile]
 *
 * This is how the bottlenecks in docs/perf/SCALING.md were found: GPU readback
 * (`GLES2::ReadPixels`, `ProduceCanvasResource`) on software-GPU machines, the
 * stroked-path raster cost of wide canvas lines, and an O(N²) commit that only
 * showed up as a hot line in a CPU profile of the dev build.
 */
import { chromium } from '@playwright/test';

const [url, mode = 'drag'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const profile = process.argv.includes('--profile');
if (!url) {
  console.error('usage: trace.ts <url> [drag|wheel] [--profile]');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.addInitScript({ content: 'window.__name = (f) => f;' });
await page.goto(url);
await page.waitForTimeout(5000);
const cdp = await page.context().newCDPSession(page);

const events: any[] = [];
cdp.on('Tracing.dataCollected', (e: any) => events.push(...e.value));
const done = new Promise((r) => cdp.on('Tracing.tracingComplete', r));
if (profile) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
} else {
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,gpu,v8',
    transferMode: 'ReportEvents',
  });
}

await page.mouse.move(800, 500);
if (mode === 'wheel') {
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(30, 20);
    await page.waitForTimeout(16);
  }
} else {
  await page.mouse.down();
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(800 - i * 6, 500 - i * 3);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

if (profile) {
  const { profile: p } = (await cdp.send('Profiler.stop')) as any;
  const byId = new Map<number, any>(p.nodes.map((n: any) => [n.id, n]));
  const self = new Map<string, number>();
  for (let i = 0; i < p.samples.length; i++) {
    const n = byId.get(p.samples[i]);
    const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
  }
  console.log('self time by function (ms):');
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v)}\t${k}`).join('\n'));
  const lines = new Map<string, number>();
  for (const n of p.nodes) {
    for (const pt of n.positionTicks ?? []) {
      const key = `${n.callFrame.url.split('/').pop()?.split('?')[0]}:${pt.line}`;
      lines.set(key, (lines.get(key) ?? 0) + pt.ticks);
    }
  }
  console.log('\nhottest lines (samples):');
  console.log([...lines].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v}\t${k}`).join('\n'));
} else {
  await cdp.send('Tracing.end');
  await done;
  const main = new Set<string>();
  for (const e of events) if (e.name === 'thread_name' && e.args?.name === 'CrRendererMain') main.add(`${e.pid}:${e.tid}`);
  const agg = new Map<string, number>();
  for (const e of events) {
    if (e.ph !== 'X' || !main.has(`${e.pid}:${e.tid}`)) continue;
    agg.set(e.name, (agg.get(e.name) ?? 0) + (e.dur ?? 0) / 1000);
  }
  console.log('renderer main thread, inclusive ms by event:');
  console.log([...agg].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${Math.round(v)}\t${k}`).join('\n'));
}
await browser.close();
