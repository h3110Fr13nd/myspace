/**
 * Classic graph view: time from clicking "expand" until the modal canvas shows
 * pixels, before vs after (two running servers with ENABLE_BENCH_PAGES=1).
 *
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE=... BEFORE_URL=http://localhost:4600 AFTER_URL=http://localhost:4500 \
 *     npx tsx bench/first-paint.ts > bench/results/first-paint.jsonl
 */
import { chromium } from '@playwright/test';

const targets: Array<[string, string]> = [
  ['before', process.env.BEFORE_URL ?? 'http://localhost:4600'],
  ['after', process.env.AFTER_URL ?? 'http://localhost:4500'],
];
for (const n of [5000, 20000, 50000]) {
  for (const [name, base] of targets) {
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript({ content: 'window.__name = (f) => f;' });
    await page.goto(`${base}/bench/graph-classic?n=${n}`);
    await page.waitForSelector('.graph-viewport-bar__expand', { timeout: 120000 });
    const t0 = Date.now();
    await page.click('.graph-viewport-bar__expand');
    await page.waitForSelector('.graph-modal-full canvas');
    let painted = -1;
    for (let i = 0; i < 240; i++) {
      const lit = await page.evaluate(() => {
        const c = document.querySelector('.graph-modal-full canvas') as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let p = 3; p < d.length; p += 4 * 16) if (d[p] > 0) n++;
        return n;
      });
      if (lit > 200) { painted = Date.now() - t0; break; }
      await page.waitForTimeout(250);
    }
    console.log(JSON.stringify({ n, target: name, firstPaintMs: painted }));
    await browser.close();
  }
}
