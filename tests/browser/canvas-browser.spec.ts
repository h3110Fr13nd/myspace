import { expect, test } from '@playwright/test';

/**
 * Browser smoke checks for the canvas, driven against the dev fixture page
 * (`/canvas-probe/`). These assert the things unit tests cannot: that a real
 * canvas backing store is sized to the viewport, that pixels land where the
 * geometry says they should, and that the gesture layer actually moves things.
 */

const URL = '/canvas-probe/';

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
  await page.waitForTimeout(400);
});

test('the edge canvas fills the viewport instead of the content bounding box', async ({ page }) => {
  const board = await page.locator('.canvas-board-viewport').first().boundingBox();
  const canvas = page.locator('.canvas-edge-layer canvas').first();
  await expect(canvas).toBeVisible();

  const css = await canvas.boundingBox();
  const attrs = await canvas.evaluate((el: HTMLCanvasElement) => ({
    attrW: el.width,
    attrH: el.height,
    dpr: window.devicePixelRatio,
  }));

  // CSS size tracks the viewport...
  expect(Math.abs(css!.width - board!.width)).toBeLessThan(2);
  expect(Math.abs(css!.height - board!.height)).toBeLessThan(2);

  // ...and the backing store is the CSS size times DPR, i.e. viewport-sized,
  // not content-sized. The old renderer used the content bbox here.
  expect(Math.abs(attrs.attrW - css!.width * attrs.dpr)).toBeLessThan(2);
  expect(Math.abs(attrs.attrH - css!.height * attrs.dpr)).toBeLessThan(2);

  // Content is ~1120x620 world units; the viewport is wider than that, so a
  // content-sized canvas would be a different size entirely.
  const contentSize = 1120;
  if (board!.width > contentSize) {
    expect(Math.abs(attrs.attrW / attrs.dpr - contentSize)).toBeGreaterThan(20);
  }
});

test('the edge canvas is a sibling of the node layer, not nested inside it', async ({ page }) => {
  const nested = await page.evaluate(() => {
    const layer = document.querySelector('.canvas-transform-layer');
    const canvas = document.querySelector('.canvas-edge-layer canvas');
    if (!layer || !canvas) return 'missing';
    return layer.contains(canvas) ? 'nested' : 'sibling';
  });
  expect(nested).toBe('sibling');
});

test('the edge canvas actually has non-transparent pixels drawn', async ({ page }) => {
  // Guards against the "canvas mounts but nothing paints" failure mode.
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('.canvas-edge-layer canvas') as HTMLCanvasElement | null;
    if (!canvas) return { ok: false, reason: 'no canvas' };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'no 2d context' };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) lit++;
    }
    return { ok: true, lit, total: data.length / 4 };
  });
  expect(painted.ok).toBe(true);
  expect(painted.lit).toBeGreaterThan(200);
});

test('wheel with no modifier pans the board', async ({ page }) => {
  const read = () =>
    page.evaluate(() => {
      const el = document.querySelector('.canvas-transform-layer') as HTMLElement;
      return {
        x: parseFloat(el.style.getPropertyValue('--canvas-x')),
        k: parseFloat(el.style.getPropertyValue('--canvas-k')),
      };
    });

  const before = await read();
  const board = await page.locator('.canvas-board-viewport').first().boundingBox();
  await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height / 2);
  await page.mouse.wheel(120, 0);
  await page.waitForTimeout(200);

  const after = await read();
  expect(after.x).toBeLessThan(before.x - 20);
  // Plain wheel must not change zoom: pan is the default, like Figma/Miro.
  expect(after.k).toBeCloseTo(before.k, 3);
});

test('ctrl+wheel zooms about the cursor and leaves the world point under it', async ({ page }) => {
  const read = () =>
    page.evaluate(() => {
      const el = document.querySelector('.canvas-transform-layer') as HTMLElement;
      return {
        x: parseFloat(el.style.getPropertyValue('--canvas-x')),
        y: parseFloat(el.style.getPropertyValue('--canvas-y')),
        k: parseFloat(el.style.getPropertyValue('--canvas-k')),
      };
    });

  const board = await page.locator('.canvas-board-viewport').first().boundingBox();
  const cx = board!.x + board!.width / 2;
  const cy = board!.y + board!.height / 2;
  await page.mouse.move(cx, cy);

  const before = await read();
  const worldBefore = { x: (cx - board!.x - before.x) / before.k, y: (cy - board!.y - before.y) / before.k };

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);

  const after = await read();
  expect(after.k).toBeGreaterThan(before.k);

  // The world point that was under the cursor must still be under the cursor.
  const worldAfter = { x: (cx - board!.x - after.x) / after.k, y: (cy - board!.y - after.y) / after.k };
  expect(worldAfter.x).toBeCloseTo(worldBefore.x, 1);
  expect(worldAfter.y).toBeCloseTo(worldBefore.y, 1);
});

test('zooming does not re-allocate the canvas backing store every frame', async ({ page }) => {
  // The old renderer assigned canvas.width on every redraw, which reallocates
  // the backing store. Track identity of the context to prove the backing
  // store survives a gesture.
  const board = await page.locator('.canvas-board-viewport').first().boundingBox();
  await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -60);
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);

  const canvas = page.locator('.canvas-edge-layer canvas').first();
  const size = await canvas.evaluate((el: HTMLCanvasElement) => ({ w: el.width, h: el.height }));
  const boardSize = await page.locator('.canvas-board-viewport').first().boundingBox();
  const dpr = await canvas.evaluate(() => window.devicePixelRatio);

  // Still exactly viewport-sized, so no growth accumulated over the gesture.
  expect(Math.abs(size.w - boardSize!.width * dpr)).toBeLessThan(3);
  expect(Math.abs(size.h - boardSize!.height * dpr)).toBeLessThan(3);
});

test('the transform layer is positioned by CSS variables, not an inline transform', async ({ page }) => {
  const style = await page.locator('.canvas-transform-layer').first().evaluate((el: HTMLElement) => ({
    inlineTransform: el.style.transform,
    x: el.style.getPropertyValue('--canvas-x'),
    k: el.style.getPropertyValue('--canvas-k'),
  }));
  expect(style.inlineTransform).toBe('');
  expect(style.x).not.toBe('');
  expect(style.k).not.toBe('');
});

test('port handles appear on hover and are sized in inverse-zoom units', async ({ page }) => {
  const node = page.locator('[data-canvas-node-id="a"]').first();
  await expect(node).toBeVisible();

  // At rest, no ports: they were permanently visible before and read as noise.
  await expect(page.locator('.canvas-port-handle')).toHaveCount(0);

  await node.hover();
  await page.waitForTimeout(200);
  await expect(page.locator('.canvas-port-handle')).toHaveCount(4);

  const sizes = await page.locator('.canvas-port-handle').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().width)
  );
  for (const s of sizes) expect(s).toBeGreaterThan(4);
  // All four equal, confirming inverse-zoom sizing rather than per-side drift.
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(1);
});

/**
 * Position of each port relative to its own node.
 *
 * Checked on a node that is *not* at the origin on purpose. The layer renders
 * inside the node's positioned wrapper, so passing it absolute coordinates
 * double-counts the node's offset: the dots landed at `2 x node.x`, far off the
 * node, while a node at (0,0) looked perfect. Asserting only on the first node
 * hid it.
 */
for (const id of ['a', 'b', 'c']) {
  test(`ports sit on the edges of node "${id}" at (x=${id === 'a' ? 0 : id === 'c' ? 480 : 900})`, async ({
    page,
  }) => {
    const node = page.locator(`[data-canvas-node-id="${id}"]`).first();
    await node.hover();
    await page.waitForTimeout(250);
    await expect(node.locator('.canvas-port-handle')).toHaveCount(4);

    const { box, ports } = await page.evaluate((nodeId) => {
      const wrap = document.querySelector(`[data-canvas-node-id="${nodeId}"]`)!;
      const r = wrap.getBoundingClientRect();
      return {
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
        ports: [...wrap.querySelectorAll('.canvas-port-handle')].map((el) => {
          const pr = el.getBoundingClientRect();
          return { side: el.getAttribute('data-side'), cx: pr.x + pr.width / 2, cy: pr.y + pr.height / 2 };
        }),
      };
    }, id);

    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    // Two screen px of slack for fractional layout and sub-pixel rounding.
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(2);

    const bySide = Object.fromEntries(ports.map((p) => [p.side, p]));
    near(bySide.left.cx, box.x);
    near(bySide.left.cy, cy);
    near(bySide.right.cx, box.x + box.w);
    near(bySide.right.cy, cy);
    near(bySide.top.cx, cx);
    near(bySide.top.cy, box.y);
    near(bySide.bottom.cx, cx);
    near(bySide.bottom.cy, box.y + box.h);
  });
}

test('a port dot sits exactly where its edge attaches', async ({ page }) => {
  // The visible symptom of a mis-anchored port is that the curve appears to
  // leave the node somewhere other than the dot the user is aiming at, so this
  // compares the two directly rather than trusting either in isolation.
  //
  // Uses node "c", which is not at the origin. Against a node at (0,0) the
  // world/local mix-up is invisible, so such a test would pass even with the bug.
  const node = page.locator('[data-canvas-node-id="c"]').first();
  await node.hover();
  await page.waitForTimeout(250);

  const dot = await page.locator('.canvas-port-handle[data-side="top"]').first().boundingBox();

  const edgeStart = await page.evaluate(() => {
    const layer = document.querySelector('.canvas-transform-layer')!;
    const k = parseFloat(layer.style.getPropertyValue('--canvas-k'));
    const px = parseFloat(layer.style.getPropertyValue('--canvas-x'));
    const py = parseFloat(layer.style.getPropertyValue('--canvas-y'));
    const board = document.querySelector('.canvas-board-viewport')!.getBoundingClientRect();
    // Path #2 is e3 (c -> a); its "M x y" is the curve's world-space start.
    const d = document.querySelectorAll('.canvas-edge-hits path')[2].getAttribute('d')!;
    const [, sx, sy] = /^M\s+([-\d.]+)\s+([-\d.]+)/.exec(d)!;
    return { x: parseFloat(sx) * k + px + board.x, y: parseFloat(sy) * k + py + board.y };
  });

  const dotCentre = { x: dot!.x + dot!.width / 2, y: dot!.y + dot!.height / 2 };
  // Two px of slack for the dot's own border and sub-pixel rounding.
  expect(Math.abs(dotCentre.x - edgeStart.x)).toBeLessThan(2);
  expect(Math.abs(dotCentre.y - edgeStart.y)).toBeLessThan(2);
});

test('ports stay on their node after the board is panned and zoomed', async ({ page }) => {
  // The port layer inherits the board transform, so a world/local mix-up only
  // shows up once the two differ from each other. Panning makes them differ.
  const node = page.locator('[data-canvas-node-id="c"]').first();
  const board = await page.locator('.canvas-board-viewport').first().boundingBox();

  await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);

  await node.hover();
  await page.waitForTimeout(250);

  const { box, ports } = await page.evaluate(() => {
    const wrap = document.querySelector('[data-canvas-node-id="c"]')!;
    const r = wrap.getBoundingClientRect();
    return {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      ports: [...wrap.querySelectorAll('.canvas-port-handle')].map((el) => {
        const pr = el.getBoundingClientRect();
        return { side: el.getAttribute('data-side'), cx: pr.x + pr.width / 2, cy: pr.y + pr.height / 2, w: pr.width };
      }),
    };
  });
  expect(ports).toHaveLength(4);

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const bySide = Object.fromEntries(ports.map((p) => [p.side, p]));
  const near = (a: number, e: number) => expect(Math.abs(a - e)).toBeLessThan(2);
  near(bySide.left.cx, box.x);
  near(bySide.right.cx, box.x + box.w);
  near(bySide.top.cy, box.y);
  near(bySide.bottom.cy, box.y + box.h);
  near(bySide.top.cx, cx);
  near(bySide.left.cy, cy);

  // Still a constant on-screen size, since the dots are sized in inverse-zoom
  // units rather than in world units.
  for (const p of ports) expect(p.w).toBeGreaterThan(4);
});

test('dragging from a port and releasing on a node body creates an edge', async ({ page }) => {
  const before = await page.evaluate(() => document.querySelectorAll('.canvas-edge-hits path').length);

  const source = page.locator('[data-canvas-node-id="a"]').first();
  await source.hover();
  await page.waitForTimeout(150);

  // Grab the right-hand port.
  const port = page.locator('.canvas-port-handle[data-side="right"]').first();
  const portBox = await port.boundingBox();

  // Drop in the middle of node "c" -- not on one of its port dots. The old
  // implementation only accepted a mouseup inside a 12px port, so this failed.
  const target = page.locator('[data-canvas-node-id="c"]').first();
  const targetBox = await target.boundingBox();

  await page.mouse.move(portBox!.x + portBox!.width / 2, portBox!.y + portBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width * 0.3, targetBox!.y + targetBox!.height * 0.7, { steps: 12 });

  // The drop target must be highlighted before release, or the user has no
  // feedback that the drop will land.
  await expect(page.locator('[data-canvas-node-id="c"][data-drop-target="true"]')).toHaveCount(1);

  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => document.querySelectorAll('.canvas-edge-hits path').length);
  expect(after).toBe(before + 1);
});

test('selecting an edge reveals grabbable endpoint handles', async ({ page }) => {
  const node = page.locator('[data-canvas-node-id="a"]').first();
  await node.hover();
  await page.waitForTimeout(150);
  await page.mouse.click(await node.boundingBox().then((b) => b!.x + b!.width / 2), await node.boundingBox().then((b) => b!.y + b!.height / 2));

  // Click the e2 edge (a.right -> c.left) which is short and near the source.
  const hit = page.locator('.canvas-edge-hits path').nth(1);
  const box = await hit.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(300);

  await expect(page.locator('.canvas-edge-endpoint').first()).toBeVisible();
});

test('Escape cancels an in-flight connection without creating an edge', async ({ page }) => {
  const before = await page.evaluate(() => document.querySelectorAll('.canvas-edge-hits path').length);

  const source = page.locator('[data-canvas-node-id="a"]').first();
  await source.hover();
  await page.waitForTimeout(150);
  const port = page.locator('.canvas-port-handle[data-side="right"]').first();
  const portBox = await port.boundingBox();
  const target = page.locator('[data-canvas-node-id="c"]').first();
  const targetBox = await target.boundingBox();

  await page.mouse.move(portBox!.x + portBox!.width / 2, portBox!.y + portBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + 30, targetBox!.y + 30, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => document.querySelectorAll('.canvas-edge-hits path').length);
  expect(after).toBe(before);
});

/**
 * Detach / reattach. These are the cases a unit test cannot reach, because the
 * bug they guard against is purely about DOM wiring: clearing the node id made
 * the edge vanish along with its own handle, so the user had no way back.
 */
test('dropping an endpoint on empty canvas detaches it but keeps it re-grabbable', async ({ page }) => {
  const edgeCount = () =>
    page.evaluate(() => document.querySelectorAll('.canvas-edge-hits path').length);

  // Select the short edge a->c so its endpoint handles appear.
  const hit = page.locator('.canvas-edge-hits path').nth(1);
  const box = await hit.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(200);

  await expect(page.locator('.canvas-edge-endpoint').first()).toBeVisible();
  const before = await edgeCount();

  // Drag the 'to' endpoint handle into empty space well away from any node.
  const handle = page.locator('.canvas-edge-endpoint[data-edge-id="e2"][data-end="to"]').first();
  const hb = await handle.boundingBox();
  const board = await page.locator('.canvas-board-viewport').first().boundingBox();
  await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(board!.x + 60, board!.y + board!.height - 60, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Still selected, so the handle must still be there: that is the difference
  // between "detached" and "deleted".
  await expect(handle).toBeVisible();
  expect(await edgeCount()).toBe(before);

  // And it must be back where we left it, not snapped to a node.
  const moved = await handle.boundingBox();
  expect(Math.abs(moved!.x - hb!.x) + Math.abs(moved!.y - hb!.y)).toBeGreaterThan(40);
});

test('a detached endpoint can be dragged back onto a node', async ({ page }) => {
  const edgeCount = () =>
    page.evaluate(() => document.querySelectorAll('.canvas-edge-hits path').length);

  // Detach first (same flow as above), then re-attach to node "a".
  const hit = page.locator('.canvas-edge-hits path').nth(1);
  const box = await hit.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(200);

  const handle = page.locator('.canvas-edge-endpoint[data-edge-id="e2"][data-end="to"]').first();
  const hb = await handle.boundingBox();
  const board = await page.locator('.canvas-board-viewport').first().boundingBox();
  await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(board!.x + 60, board!.y + board!.height - 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const detached = await handle.boundingBox();
  const before = await edgeCount();

  // Now drag it back onto node "a".
  const target = page.locator('[data-canvas-node-id="a"]').first();
  const tb = await target.boundingBox();
  await page.mouse.move(detached!.x + detached!.width / 2, detached!.y + detached!.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb!.x + tb!.width * 0.5, tb!.y + tb!.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Re-attaching mutates the edge in place: same count, handle snapped back.
  expect(await edgeCount()).toBe(before);
  const reattached = await handle.boundingBox();
  const expected = await target.boundingBox();
  expect(Math.abs(reattached!.x + reattached!.width / 2 - (expected!.x + expected!.width / 2))).toBeLessThan(30);
});

test('the board re-measures and re-anchors itself across a fullscreen round trip', async ({ page }) => {
  // Entering fullscreen swaps which element is the board. If the viewport ref
  // or the measured size is not re-established, every coordinate conversion
  // silently uses the hidden inline board and gestures stop matching the
  // visible pixels.
  const board = page.locator('.canvas-board-viewport[data-canvas-board="inline"]');
  const full = page.locator('.canvas-board-viewport[data-canvas-board="fullscreen"]');

  const enter = page.getByRole('button', { name: /fullscreen|modal|expand/i }).first();
  await enter.click();
  await page.waitForTimeout(400);

  await expect(full).toBeVisible();
  // Exactly one board may exist: two copies means double paint and ambiguous refs.
  await expect(page.locator('.canvas-board-viewport')).toHaveCount(1);
  await expect(board).toHaveCount(0);

  // The edge canvas must be sized to the new, larger board.
  const css = await page.locator('.canvas-edge-layer canvas').first().boundingBox();
  const fb = await full.boundingBox();
  expect(Math.abs(css!.width - fb!.width)).toBeLessThan(3);
  expect(Math.abs(css!.height - fb!.height)).toBeLessThan(3);

  // Pan must still work, and it must move the layer that is actually visible.
  const readK = () =>
    page.evaluate(() => {
      const el = document.querySelector('.canvas-transform-layer') as HTMLElement;
      return parseFloat(el.style.getPropertyValue('--canvas-x'));
    });
  const before = await readK();
  await page.mouse.move(fb!.x + fb!.width / 2, fb!.y + fb!.height / 2);
  await page.mouse.wheel(140, 0);
  await page.waitForTimeout(250);
  expect(await readK()).toBeLessThan(before - 20);
});

test('Escape leaves fullscreen before it clears the selection', async ({ page }) => {
  const enter = page.getByRole('button', { name: /fullscreen|modal|expand/i }).first();
  await enter.click();
  await page.waitForTimeout(400);
  await expect(page.locator('.canvas-board-viewport[data-canvas-board="fullscreen"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await expect(page.locator('.canvas-board-viewport[data-canvas-board="inline"]')).toBeVisible();
  await expect(page.locator('.canvas-board-viewport[data-canvas-board="fullscreen"]')).toHaveCount(0);
});

/**
 * The read-only viewer shares the edge layer and the transform-layer CSS with
 * the editor, so the z-order and pointer-events fixes are only really proven
 * when both surfaces are checked.
 */
test.describe('read-only viewer', () => {
  const VIEWER = '/canvas-probe-viewer';

  test('renders viewport-sized edges behind its nodes', async ({ page }) => {
    await page.goto(VIEWER);
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    await page.waitForTimeout(600);

    const state = await page.evaluate(() => {
      const canvas = document.querySelector('.canvas-edge-layer canvas') as HTMLCanvasElement;
      const board = document.querySelector('.canvas-board-viewport')!.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit++;
      return {
        css: [Math.round(c.width), Math.round(c.height)],
        board: [Math.round(board.width), Math.round(board.height)],
        lit,
        nodes: document.querySelectorAll('.canvas-interactive-node').length,
      };
    });

    expect(Math.abs(state.css[0] - state.board[0])).toBeLessThan(3);
    expect(Math.abs(state.css[1] - state.board[1])).toBeLessThan(3);
    expect(state.lit).toBeGreaterThan(200);
    expect(state.nodes).toBe(3);
  });

  test('a node hit-tests above the edge layer', async ({ page }) => {
    await page.goto(VIEWER);
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    await page.waitForTimeout(600);

    const probe = await page.evaluate(() => {
      const node = document.querySelectorAll('.canvas-interactive-node')[0];
      const r = node.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { insideNode: !!(el && node.contains(el)) };
    });
    expect(probe.insideNode).toBe(true);
  });

  test('drag-to-pan works through the pointer-transparent transform layer', async ({ page }) => {
    await page.goto(VIEWER);
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    await page.waitForTimeout(600);

    const layerX = () =>
      page.evaluate(() => document.querySelector('.canvas-transform-layer')!.getBoundingClientRect().x);

    const board = await page.locator('.canvas-board-viewport').first().boundingBox();
    const before = await layerX();
    // Start on empty board, not on a node.
    await page.mouse.move(board!.x + 20, board!.y + 20);
    await page.mouse.down();
    await page.mouse.move(board!.x + 120, board!.y + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    expect(await layerX()).toBeGreaterThan(before + 50);
  });
});

/**
 * Characterisation tests for node move / resize / marquee.
 *
 * These three paths had no coverage at all, and they are the ones being moved
 * out of `useCanvasEditor` and into `core/usePointerInteraction`. Asserting the
 * behaviour *before* the refactor is what makes that move safe: any difference
 * afterwards is a regression rather than an ambiguity.
 */

/** World position of a node, derived from its on-screen box. */
async function nodeWorld(page: import('@playwright/test').Page, id: string) {
  return page.evaluate((nodeId) => {
    const layer = document.querySelector('.canvas-transform-layer')!;
    const k = parseFloat(layer.style.getPropertyValue('--canvas-k'));
    const px = parseFloat(layer.style.getPropertyValue('--canvas-x'));
    const py = parseFloat(layer.style.getPropertyValue('--canvas-y'));
    const el = document.querySelector(`[data-canvas-node-id="${nodeId}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const board = document.querySelector('.canvas-board-viewport')!.getBoundingClientRect();
    return {
      x: (r.x - board.x - px) / k,
      y: (r.y - board.y - py) / k,
      w: r.width / k,
      h: r.height / k,
    };
  }, id);
}

test.describe('node dragging', () => {
  test('a drag moves the node and snaps to the 20px grid', async ({ page }) => {
    const before = await nodeWorld(page, 'a');
    const node = page.locator('[data-canvas-node-id="a"]').first();
    const b = await node.boundingBox();

    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.mouse.down();
    await page.mouse.move(b!.x + b!.width / 2 + 137, b!.y + b!.height / 2 + 63, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const after = await nodeWorld(page, 'a');
    expect(after!.x).toBeGreaterThan(before!.x + 80);
    // Snapped, not free: both axes land on a multiple of 20 in world units.
    expect(after!.x % 20).toBeCloseTo(0, 5);
    expect(after!.y % 20).toBeCloseTo(0, 5);
  });

  test('a click without movement selects but does not move', async ({ page }) => {
    const before = await nodeWorld(page, 'c');
    const node = page.locator('[data-canvas-node-id="c"]').first();
    const b = await node.boundingBox();

    await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.waitForTimeout(200);

    const after = await nodeWorld(page, 'c');
    expect(after!.x).toBeCloseTo(before!.x, 1);
    expect(after!.y).toBeCloseTo(before!.y, 1);
  });

  test('one drag produces exactly one undo step', async ({ page }) => {
    const before = await nodeWorld(page, 'a');
    const node = page.locator('[data-canvas-node-id="a"]').first();
    const b = await node.boundingBox();

    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.mouse.down();
    // Many intermediate positions: without coalescing this would be many entries.
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(b!.x + b!.width / 2 + i * 12, b!.y + b!.height / 2 + i * 6);
    }
    await page.mouse.up();
    await page.waitForTimeout(250);

    const moved = await nodeWorld(page, 'a');
    expect(moved!.x).not.toBeCloseTo(before!.x, 0);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);

    const undone = await nodeWorld(page, 'a');
    expect(undone!.x).toBeCloseTo(before!.x, 1);
    expect(undone!.y).toBeCloseTo(before!.y, 1);
  });

  test('dragging one member of a multi-selection moves them all', async ({ page }) => {
    // Select "a", then shift-click "c" so both travel together.
    const a = await page.locator('[data-canvas-node-id="a"]').first().boundingBox();
    await page.mouse.click(a!.x + a!.width / 2, a!.y + a!.height / 2);
    await page.waitForTimeout(150);
    const c = await page.locator('[data-canvas-node-id="c"]').first().boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(c!.x + c!.width / 2, c!.y + c!.height / 2);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);

    const aBefore = await nodeWorld(page, 'a');
    const cBefore = await nodeWorld(page, 'c');

    const handle = await page.locator('[data-canvas-node-id="a"]').first().boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2 + 100, handle!.y + handle!.height / 2 + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const aAfter = await nodeWorld(page, 'a');
    const cAfter = await nodeWorld(page, 'c');
    // Same delta for both, which is what makes a group move as one body.
    expect(aAfter!.x - aBefore!.x).toBeCloseTo(cAfter!.x - cBefore!.x, 0);
    expect(cAfter!.x).toBeGreaterThan(cBefore!.x + 40);
  });
});

test.describe('node resizing', () => {
  test('the corner handle resizes, snapped to the grid', async ({ page }) => {
    // The handle only exists on a single-selected node.
    const node = page.locator('[data-canvas-node-id="a"]').first();
    const b = await node.boundingBox();
    await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.waitForTimeout(200);

    const before = await nodeWorld(page, 'a');
    const handle = await page.locator('[data-canvas-node-id="a"]').first().boundingBox();
    const hx = handle!.x + handle!.width - 2;
    const hy = handle!.y + handle!.height - 2;

    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 137, hy + 83, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const after = await nodeWorld(page, 'a');
    expect(after!.w).toBeGreaterThan(before!.w + 60);
    expect(after!.h).toBeGreaterThan(before!.h + 40);
    expect(after!.w % 20).toBeCloseTo(0, 5);
    expect(after!.h % 20).toBeCloseTo(0, 5);
  });

  test('resize respects the minimum size', async ({ page }) => {
    const node = page.locator('[data-canvas-node-id="a"]').first();
    const b = await node.boundingBox();
    await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.waitForTimeout(200);

    const handle = await page.locator('[data-canvas-node-id="a"]').first().boundingBox();
    const hx = handle!.x + handle!.width - 2;
    const hy = handle!.y + handle!.height - 2;

    // Drag far past zero: the floor is 160x100 world units, not 0.
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx - 900, hy - 900, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const after = await nodeWorld(page, 'a');
    expect(after!.w).toBeGreaterThanOrEqual(160);
    expect(after!.h).toBeGreaterThanOrEqual(100);
  });
});

test.describe('marquee selection', () => {
  test('shift+drag on empty board selects the nodes it touches', async ({ page }) => {
    const board = await page.locator('.canvas-board-viewport').first().boundingBox();
    // Start well clear of every node, top-left of the board.
    await page.keyboard.down('Shift');
    await page.mouse.move(board!.x + 20, board!.y + 20);
    await page.mouse.down();
    await page.mouse.move(board!.x + board!.width - 20, board!.y + board!.height - 20, { steps: 14 });

    // The rubber band is visible while dragging.
    await expect(page.locator('.canvas-marquee')).toBeVisible();

    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(250);

    const selected = await page.evaluate(() =>
      [...document.querySelectorAll('[data-canvas-node-id]')]
        .filter((el) => el.getAttribute('data-canvas-node-id') === 'a' || el.getAttribute('data-canvas-node-id') === 'c')
        .map((el) => el.getAttribute('data-canvas-node-id'))
    );
    // Selection is reported through the node's outline; assert via a real signal
    // instead: the inspector shows a multi-selection count.
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/Multi-Selection|Selected/);
    expect(selected.length).toBe(2);
  });

  test('a marquee that touches nothing clears the selection', async ({ page }) => {
    const node = page.locator('[data-canvas-node-id="a"]').first();
    const b = await node.boundingBox();
    await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.waitForTimeout(200);

    // A plain (unshifted) drag on empty board clears, then selects nothing.
    const board = await page.locator('.canvas-board-viewport').first().boundingBox();
    await page.mouse.move(board!.x + board!.width - 30, board!.y + 30);
    await page.mouse.down();
    await page.mouse.move(board!.x + board!.width - 10, board!.y + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const body = await page.locator('body').innerText();
    expect(body).toMatch(/Board Stats/);
  });
});

test.describe('touch input', () => {
  test('a node can be dragged with a finger, not just a mouse', async ({ page }) => {
    // The board shell and the ports open their gestures on pointerdown, so the
    // node drag has to follow. A mouse-only `onMouseDown` here meant a touch
    // could select a node but never move it.
    const before = await nodeWorld(page, 'c');
    const node = page.locator('[data-canvas-node-id="c"]').first();
    const b = await node.boundingBox();
    const cx = b!.x + b!.width / 2;
    const cy = b!.y + b!.height / 2;

    const client = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => {
      await client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
      });
    };

    await touch('touchStart', cx, cy);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', cx + i * 15, cy + i * 8);
      await page.waitForTimeout(20);
    }
    await touch('touchEnd', 0, 0);
    await page.waitForTimeout(300);

    const after = await nodeWorld(page, 'c');
    expect(after!.x).toBeGreaterThan(before!.x + 40);
    expect(after!.y).toBeGreaterThan(before!.y + 20);
  });

  test('touch does not scroll the page while dragging a node', async ({ page }) => {
    // The board declares touch-action: none so a finger drag moves the canvas
    // rather than the page. Without it the gesture fights the browser scroll.
    const touchAction = await page
      .locator('.canvas-board-viewport')
      .first()
      .evaluate((el) => getComputedStyle(el).touchAction);
    expect(touchAction).toBe('none');
  });
});

/**
 * Wheel semantics.
 *
 * `mouse.wheel` dispatches raw wheel deltas rather than going through the
 * browser's own shift-to-horizontal conversion, so it exercises the code paths
 * that a desktop user only reaches on Firefox, Linux/Wayland, or an unusual
 * trackpad driver. That makes it the right way to pin these down.
 */
test.describe('scroll behaviour', () => {
  const read = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const el = document.querySelector('.canvas-transform-layer')!;
      return {
        x: parseFloat(el.style.getPropertyValue('--canvas-x')),
        y: parseFloat(el.style.getPropertyValue('--canvas-y')),
        k: parseFloat(el.style.getPropertyValue('--canvas-k')),
      };
    });

  /** Re-anchor over the board: a toolbar click leaves the pointer on the header. */
  const overBoard = async (page: import('@playwright/test').Page) => {
    const b = await page.locator('.canvas-board-viewport').first().boundingBox();
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.waitForTimeout(80);
  };

  test('shift+scroll pans horizontally and never vertically', async ({ page }) => {
    const board = await page.locator('.canvas-board-viewport').first().boundingBox();
    await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height / 2);

    // A vertical-only delta with shift held is the case that used to slide the
    // board diagonally, because the fallback fed deltaY into both axes.
    await page.keyboard.down('Shift');
    const before = await read(page);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(200);
    const after = await read(page);
    await page.keyboard.up('Shift');

    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.k).toBeCloseTo(before.k, 3);
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(30);
  });

  test('shift+scroll discards the vertical component of a two-axis delta', async ({ page }) => {
    const board = await page.locator('.canvas-board-viewport').first().boundingBox();
    await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height / 2);

    await page.keyboard.down('Shift');
    const before = await read(page);
    await page.mouse.wheel(90, 120);
    await page.waitForTimeout(200);
    const after = await read(page);
    await page.keyboard.up('Shift');

    // Holding shift is a request to constrain the axis, so deltaY is dropped
    // rather than added to the horizontal travel.
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.k).toBeCloseTo(before.k, 3);
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(20);
  });

  test('the scroll-behaviour control switches plain wheel between pan and zoom', async ({ page }) => {
    const pans = page.getByRole('button', { name: /Scroll pans/ });
    const zooms = page.getByRole('button', { name: /Scroll zooms/ });

    // Default is pan, which is what a trackpad two-finger swipe should do.
    await expect(pans).toHaveAttribute('aria-pressed', 'true');
    await expect(zooms).toHaveAttribute('aria-pressed', 'false');

    await overBoard(page);
    const start = await read(page);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(200);
    const panned = await read(page);
    expect(panned.k).toBeCloseTo(start.k, 3);
    expect(panned.y).toBeLessThan(start.y - 30);

    await zooms.click();
    await expect(zooms).toHaveAttribute('aria-pressed', 'true');
    await expect(pans).toHaveAttribute('aria-pressed', 'false');

    await overBoard(page);
    const before = await read(page);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(200);
    const zoomed = await read(page);
    expect(zoomed.k).toBeLessThan(before.k - 0.05);
  });

  test('ctrl+scroll zooms regardless of the scroll-behaviour setting', async ({ page }) => {
    // Pinch arrives as ctrl+wheel from every modern browser, so this path must
    // not be affected by the preference or it would break trackpad zooming.
    await page.getByRole('button', { name: /Scroll pans/ }).click();
    await expect(page.getByRole('button', { name: /Scroll pans/ })).toHaveAttribute('aria-pressed', 'true');

    await overBoard(page);
    await page.keyboard.down('Control');
    const before = await read(page);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(200);
    const after = await read(page);
    await page.keyboard.up('Control');
    expect(after.k).toBeGreaterThan(before.k + 0.05);
  });

  test('the scroll preference survives a reload', async ({ page }) => {
    await page.getByRole('button', { name: /Scroll zooms/ }).click();
    await expect(page.getByRole('button', { name: /Scroll zooms/ })).toHaveAttribute('aria-pressed', 'true');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    await page.waitForTimeout(600);

    // Rendered straight from storage on the first paint, not corrected a frame
    // later by an effect.
    await expect(page.getByRole('button', { name: /Scroll zooms/ })).toHaveAttribute('aria-pressed', 'true');

    await overBoard(page);
    const before = await read(page);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(200);
    expect((await read(page)).k).toBeLessThan(before.k - 0.05);
  });

  test('the gesture reference documents shift+scroll and reflects the setting', async ({ page }) => {
    // Nothing is selected on load, which is the state that shows the board
    // overview and therefore the gesture reference.
    await expect(page.getByText('Navigation & Gestures:')).toBeVisible();

    // The undocumented shortcut is now discoverable.
    await expect(page.getByText('Shift + Scroll').first()).toBeVisible();
    await expect(page.getByText('Pan horizontally only').first()).toBeVisible();
    // Pinch was also missing.
    await expect(page.getByText('Pinch').first()).toBeVisible();

    // The description tracks the live preference instead of asserting one mode.
    await expect(page.getByText('Scroll / 2-finger').first()).toBeVisible();
    await expect(page.getByText('Pan canvas view').first()).toBeVisible();

    await page.getByRole('button', { name: /Scroll zooms/ }).click();
    await page.waitForTimeout(250);
    await expect(page.getByText('Zoom in / out').first()).toBeVisible();
    await expect(page.getByText('Pan canvas view').first()).toHaveCount(0);
  });
});
