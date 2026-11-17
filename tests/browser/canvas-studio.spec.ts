import { expect, test } from '@playwright/test';

/**
 * The real studio route, as opposed to the in-memory probe page.
 *
 * The two differ in exactly the way that made this bug possible: the probe gets
 * its canvas from props, while the studio page resolves it from a database row
 * or a file on disk. A blank board is the only symptom either way, so these
 * assert on what the user can actually see.
 */

const studio = (slug: string) => `/studio/canvas/${slug}`;

test.describe('studio route', () => {
  test('a canvas stored on disk loads into an editable board', async ({ page }) => {
    await page.goto(studio('my-canvas'));
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    await page.waitForTimeout(1200);

    await expect(page).toHaveTitle(/my canvas/);
    // The board must be laid out, not collapsed to nothing.
    const board = await page.locator('.canvas-board-viewport').first().boundingBox();
    expect(board!.width).toBeGreaterThan(400);
    expect(board!.height).toBeGreaterThan(300);

    // Look for the note by content rather than by position. This canvas is real
    // content that gets edited, so a group or another node can legitimately end
    // up first in the DOM; asserting on "[0]" made the test fail the moment the
    // canvas changed, which says nothing about loading.
    const note = page.locator('[data-canvas-node-id]', { hasText: 'my canvas' }).first();
    await expect(note).toBeVisible();
    const n = await note.boundingBox();
    expect(n!.width).toBeGreaterThan(50);

    // And the board genuinely has content on it.
    expect(await page.locator('[data-canvas-node-id]').count()).toBeGreaterThan(0);
  });

  test('edges are actually painted, not just mounted', async ({ page }) => {
    await page.goto(studio('my-canvas'));
    await page.waitForSelector('.canvas-edge-layer canvas', { timeout: 20000 });
    await page.waitForTimeout(1200);

    const lit = await page.evaluate(() => {
      const c = document.querySelector('.canvas-edge-layer canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
      return n;
    });
    expect(lit).toBeGreaterThan(100);
  });

  test('an unresolvable canvas says so instead of showing a blank board', async ({ page }) => {
    await page.goto(studio('definitely-not-a-real-canvas'));
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    await page.waitForTimeout(1000);

    // The single most important assertion here: a missing canvas must be
    // legible as missing. An empty rectangle is indistinguishable from a board
    // that failed to load, and is what makes it look like your work vanished.
    const notice = page.locator('.canvas-empty-state__title');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('definitely-not-a-real-canvas');
  });

  test('a canvas with content never shows the empty state', async ({ page }) => {
    await page.goto(studio('my-canvas'));
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('.canvas-empty-state')).toHaveCount(0);
  });

  test('the studio board pans', async ({ page }) => {
    await page.goto(studio('my-canvas'));
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    await page.waitForTimeout(1200);

    const layerX = () =>
      page.evaluate(() => {
        const el = document.querySelector('.canvas-transform-layer')!;
        return parseFloat(el.style.getPropertyValue('--canvas-x'));
      });
    const before = await layerX();
    const board = await page.locator('.canvas-board-viewport').first().boundingBox();
    await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height / 2);
    await page.mouse.wheel(140, 0);
    await page.waitForTimeout(250);
    expect(await layerX()).toBeLessThan(before - 20);
  });
});
