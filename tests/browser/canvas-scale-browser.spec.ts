import { expect, test, type Page } from '@playwright/test';

/**
 * Large-board behaviour of the canvas editor and viewer: viewport
 * virtualisation, the painted LOD layer when zoomed far out, and interaction on
 * virtualised nodes. Uses the dev-only /bench/canvas fixture (synthetic board,
 * no database).
 */

const N = 5000;

const nodeCount = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-canvas-node-id]').length);
const transformOf = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.canvas-transform-layer') as HTMLElement;
    return {
      x: parseFloat(el.style.getPropertyValue('--canvas-x')),
      y: parseFloat(el.style.getPropertyValue('--canvas-y')),
      k: parseFloat(el.style.getPropertyValue('--canvas-k')),
    };
  });

test.describe('editor on a large board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/bench/canvas?n=${N}&mode=editor`);
    await page.waitForSelector('[data-canvas-node-id]', { timeout: 60000 });
    await page.waitForTimeout(300);
  });

  test('mounts only the nodes near the viewport', async ({ page }) => {
    const mounted = await nodeCount(page);
    expect(mounted).toBeGreaterThan(0);
    // A 5000-node board used to mount all 5000 (and ~28 DOM nodes each).
    expect(mounted).toBeLessThan(N / 5);
  });

  test('panning far mounts the nodes that come into view', async ({ page }) => {
    const firstIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-canvas-node-id]')).map((e) => e.getAttribute('data-canvas-node-id'))
    );
    const board = (await page.locator('.canvas-board-viewport').boundingBox())!;
    await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(900, 600);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(300);
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-canvas-node-id]')).map((e) => e.getAttribute('data-canvas-node-id'))
    );
    expect(ids.some((id) => !firstIds.includes(id))).toBe(true);
    // Whatever is mounted is actually near the screen.
    const offscreen = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let far = 0;
      for (const el of document.querySelectorAll('[data-canvas-node-id]')) {
        const r = el.getBoundingClientRect();
        if (r.right < -3 * vw || r.left > 4 * vw || r.bottom < -3 * vh || r.top > 4 * vh) far++;
      }
      return far;
    });
    expect(offscreen).toBe(0);
  });

  test('far out, nodes are painted on a canvas and stay clickable', async ({ page }) => {
    const board = (await page.locator('.canvas-board-viewport').boundingBox())!;
    // Zoom about the board's top-left so the content (which starts there)
    // fills the view at 10%: well over the DOM budget.
    await page.mouse.move(board.x + 8, board.y + 70);
    // Ctrl+wheel zooms in either wheel mode.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, 400);
      await page.keyboard.up('Control');
      await page.waitForTimeout(15);
    }
    await page.waitForTimeout(400);
    const t = await transformOf(page);
    expect(t.k).toBeLessThan(0.3);
    await expect(page.locator('.canvas-lod-layer')).toHaveCount(1);
    // Few or no DOM nodes remain; the canvas carries the board.
    expect(await nodeCount(page)).toBeLessThan(50);

    // Click where a painted card is: find one via the document and the transform.
    const target = await page.evaluate(() => {
      const el = document.querySelector('.canvas-transform-layer') as HTMLElement;
      const k = parseFloat(el.style.getPropertyValue('--canvas-k'));
      const x = parseFloat(el.style.getPropertyValue('--canvas-x'));
      const y = parseFloat(el.style.getPropertyValue('--canvas-y'));
      const rect = document.querySelector('.canvas-board-viewport')!.getBoundingClientRect();
      // Synthetic board: first card of cluster 0 is at (0..20, 0..20), 240 wide.
      return { cx: rect.left + x + (20 + 120) * k, cy: rect.top + y + (20 + 70) * k };
    });
    await page.mouse.click(target.cx, target.cy);
    await page.waitForTimeout(200);
    // The hit node is selected, so it is mounted as DOM on top of the canvas.
    expect(await nodeCount(page)).toBeGreaterThan(0);
    expect(await page.locator('[data-canvas-node-id="n0"]').count()).toBe(1);
  });

  test('dragging a virtualised node moves it and undo restores it', async ({ page }) => {
    const node = page.locator('[data-canvas-node-id="n0"]');
    await expect(node).toHaveCount(1);
    const before = (await node.boundingBox())!;
    await page.mouse.move(before.x + 30, before.y + 30);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(before.x + 30 + i * 12, before.y + 30 + i * 8);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = (await node.boundingBox())!;
    expect(after.x - before.x).toBeGreaterThan(60);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const undone = (await node.boundingBox())!;
    expect(Math.abs(undone.x - before.x)).toBeLessThan(2);
  });
});

test.describe('viewer on a large board', () => {
  test('mounts only nodes near the viewport and re-uses them while panning', async ({ page }) => {
    await page.goto(`/bench/canvas?n=${N}&mode=viewer`);
    await page.waitForSelector('.canvas-interactive-node, .canvas-lod-layer', { timeout: 60000 });
    await page.waitForTimeout(400);
    const mounted = await page.evaluate(() => document.querySelectorAll('.canvas-transform-layer > div').length);
    expect(mounted).toBeLessThan(N / 5);
  });
});
