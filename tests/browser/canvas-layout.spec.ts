import { expect, test } from '@playwright/test';

/**
 * The Layout button, end to end.
 *
 * The algorithm itself is unit-tested against `core/autoLayout`. This covers
 * what only a browser can show: that the button is wired to it, that the
 * result is on screen, and that it is a single undo step.
 */

const LAYOUT = '/canvas-probe-layout';

const geom = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const el of document.querySelectorAll('[data-canvas-node-id]')) {
      out[el.getAttribute('data-canvas-node-id')!] = {
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: parseFloat(el.style.height),
      };
    }
    return out;
  });

const clickLayout = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: /^Layout$/ }).click();
  await page.waitForTimeout(500);
};

test.beforeEach(async ({ page }) => {
  await page.goto(LAYOUT);
  await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
  await page.waitForTimeout(1000);
});

test('Layout rearranges the board and nothing overlaps afterwards', async ({ page }) => {
  const before = await geom(page);
  await clickLayout(page);
  const after = await geom(page);

  expect(after).not.toEqual(before);

  const ids = Object.keys(after).filter((id) => id !== 'ga');
  const overlaps = ids.some((a, i) =>
    ids.some((b, j) => {
      if (j <= i) return false;
      const p = after[a];
      const q = after[b];
      return p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
    })
  );
  expect(overlaps).toBe(false);
});

test('a group keeps its members after Layout', async ({ page }) => {
  await clickLayout(page);
  const contained = await page.evaluate(() => {
    const box = (id: string) => {
      const el = document.querySelector(`[data-canvas-node-id="${id}"]`)!;
      return { x: +parseFloat(el.style.left), y: +parseFloat(el.style.top), w: +parseFloat(el.style.width), h: +parseFloat(el.style.height) };
    };
    const g = box('ga');
    return ['g1', 'g2'].filter((id) => {
      const n = box(id);
      return n.x >= g.x && n.x + n.w <= g.x + g.w && n.y >= g.y && n.y + n.h <= g.y + g.h;
    });
  });
  // The old implementation skipped groups, so both children were teleported out
  // and the group was left empty.
  expect(contained.sort()).toEqual(['g1', 'g2']);
});

test('a feedback cycle does not blow the board up', async ({ page }) => {
  await clickLayout(page);
  const after = await geom(page);
  // The old relaxation drove levels to 18 on this five-edge graph, producing a
  // 7560px-wide board.
  const rightEdge = Math.max(...Object.values(after).map((n) => n.x + n.w));
  expect(rightEdge).toBeLessThan(2500);
});

test('Layout is a single undo step', async ({ page }) => {
  const before = await geom(page);
  await clickLayout(page);
  expect(await geom(page)).not.toEqual(before);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  expect(await geom(page)).toEqual(before);
});

test('Layout is reachable from the toolbar', async ({ page }) => {
  const button = page.getByRole('button', { name: /^Layout$/ });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('title', /DAG hierarchy/i);
});
