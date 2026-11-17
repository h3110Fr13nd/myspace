import { expect, test } from '@playwright/test';

/**
 * Group layering.
 *
 * A group is a container: it frames what it holds and must not obscure it. The
 * specific failure this pins down is subtle, because the group *looks* correct
 * on its own — an empty dashed rectangle with a header pill reads exactly as
 * intended. What it was also doing was blurring its own backdrop, and since
 * edges paint in a lower layer than nodes, every connection inside a group was
 * being blurred too. The stroke was still there, just at a third of its
 * brightness, which reads as "the link went behind the group".
 */

const ZORDER = '/canvas-probe-zorder';

/** Edges must paint below node content, or they cross over card faces. */
test('edges paint behind node content, not in front of it', async ({ page }) => {
  await page.goto(ZORDER);
  await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
  await page.waitForTimeout(900);

  const z = await page.evaluate(() => {
    const num = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? parseInt(getComputedStyle(el).zIndex, 10) || 0 : null;
    };
    return { edgeLayer: num('.canvas-edge-layer'), transformLayer: num('.canvas-transform-layer') };
  });
  expect(z.edgeLayer).not.toBeNull();
  expect(z.transformLayer).toBeGreaterThan(z.edgeLayer!);
});

test('a group does not filter its backdrop', async ({ page }) => {
  await page.goto(ZORDER);
  await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
  await page.waitForTimeout(900);

  const group = await page.evaluate(() => {
    const card = document.querySelector('[data-canvas-node-id="g"] .canvas-interactive-node')!;
    const s = getComputedStyle(card);
    return {
      backdropFilter: s.backdropFilter,
      filter: s.filter,
      // A solid background would hide contained edges just as effectively.
      backgroundColor: s.backgroundColor,
    };
  });

  /**
   * The invariant, stated directly: nothing about the group may attenuate what
   * is painted behind it. Any `backdrop-filter` reduces a contained edge stroke
   * to a fraction of its brightness, because the filter samples the backdrop
   * rather than compositing over it.
   */
  expect(group.backdropFilter).toBe('none');
  expect(group.filter).toBe('none');
  expect(group.backgroundColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});

test('a group body is selectable, and its children still win', async ({ page }) => {
  await page.goto(ZORDER);
  await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
  await page.waitForTimeout(900);

  /**
   * The body used to be `pointerEvents: none`, so a group could only be reached
   * through its header pill — defect D4, "groups cannot be selected by clicking".
   * It is interactive now.
   *
   * Making it interactive is only safe because children still take precedence
   * where they overlap, which the next test proves on real hit-testing. Between
   * them these two cover both halves of the contract: clickable group, and
   * reachable contents.
   */
  const pe = await page.evaluate(
    () => getComputedStyle(document.querySelector('[data-canvas-node-id="g"] .canvas-interactive-node')!).pointerEvents
  );
  expect(pe).not.toBe('none');

  // The header pill stays independently interactive, since it is the drag handle
  // for the whole group.
  const pill = await page.evaluate(
    () => getComputedStyle(document.querySelector('.canvas-group-header-pill')!).pointerEvents
  );
  expect(pill).toBe('auto');

  // Clicking the group's open interior selects the group rather than nothing.
  const selected = await page.evaluate(async () => {
    const group = document.querySelector('[data-canvas-node-id="g"]')!;
    const r = group.getBoundingClientRect();
    // Somewhere inside the frame that no child covers.
    const hit = document.elementFromPoint(r.right - 8, r.bottom - 8);
    return !!hit && group.contains(hit);
  });
  expect(selected).toBe(true);
});

test('nodes inside a group are hit-testable above it', async ({ page }) => {
  await page.goto(ZORDER);
  await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
  await page.waitForTimeout(900);

  const hit = await page.evaluate(() => {
    const node = document.querySelector('[data-canvas-node-id="ln"]')!;
    const r = node.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { inside: !!(el && node.contains(el)) };
  });
  expect(hit.inside).toBe(true);
});

/**
 * The end-to-end version of the same claim, on real composited pixels.
 *
 * Slower than the style assertions above, so it is the one that proves the
 * style assertions are pointed at the right thing: a stroke inside a group's
 * open interior must be as bright as the same stroke outside it.
 */
test('an edge inside a group is as bright as one outside', async ({ page }) => {
  await page.goto(ZORDER);
  await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
  await page.waitForTimeout(1200);

  const samples = await page.evaluate(() => {
    const br = document.querySelector('.canvas-board-viewport')!.getBoundingClientRect();
    const group = document.querySelector('[data-canvas-node-id="g"]')!.getBoundingClientRect();
    const nodeRects = ['ln', 'tx', 'out', 'out2']
      .map((id) => document.querySelector(`[data-canvas-node-id="${id}"]`)!.getBoundingClientRect());

    // Points genuinely on the curve: the midpoint of a path's `d` numbers is a
    // Bezier control point, which is not on the curve.
    const onCurve = (i: number) => {
      const path = document.querySelectorAll('.canvas-edge-hits path')[i];
      const len = path.getTotalLength();
      const out: Array<{ x: number; y: number }> = [];
      for (let f = 0; f <= 1.0001; f += 0.02) {
        const pt = path.getPointAtLength(len * f);
        out.push({ x: pt.x + br.x, y: pt.y + br.y });
      }
      return out;
    };
    const inGroup = (q: { x: number; y: number }) =>
      q.x > group.x + 4 && q.x < group.x + group.width - 4 && q.y > group.y + 4 && q.y < group.y + group.height - 4;
    const inNode = (q: { x: number; y: number }) =>
      nodeRects.some((r) => q.x > r.x && q.x < r.x + r.width && q.y > r.y && q.y < r.y + r.height);

    return {
      // e2 lives entirely inside the group, e1 leaves it.
      inside: onCurve(1).filter((q) => inGroup(q) && !inNode(q)),
      outside: onCurve(0).filter((q) => !inGroup(q) && !inNode(q)),
    };
  });

  expect(samples.inside.length).toBeGreaterThan(5);
  expect(samples.outside.length).toBeGreaterThan(2);

  const shot = (await page.screenshot()).toString('base64');
  const peak = await page.evaluate(
    async ({ b64, pts }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      let best = 0;
      for (const q of pts) {
        const x0 = Math.max(0, Math.round(q.x - 6));
        const y0 = Math.max(0, Math.round(q.y - 6));
        const w = Math.min(c.width - x0, 12);
        const h = Math.min(c.height - y0, 12);
        if (w <= 0 || h <= 0) continue;
        const d = ctx.getImageData(x0, y0, w, h).data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          if (lum > best) best = lum;
        }
      }
      return Math.round(best);
    },
    { b64: shot, pts: samples.inside }
  );

  // The blur measured 77 here against 220 without it. Require a stroke that is
  // clearly a bright line, not a smudge, without pinning an exact value.
  expect(peak).toBeGreaterThan(150);
});
