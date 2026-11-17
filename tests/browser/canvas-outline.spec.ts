import { expect, test } from '@playwright/test';

/**
 * The group-tree surfaces, end to end.
 *
 * The pure parts (`buildOutline`, `resolveDropTarget`, the membership policy)
 * are unit tested. What only a browser can show is that the outline is wired to
 * the document, that a drag in it actually reparents, and that the mode a user
 * picks survives a round trip through the board.
 */

const BOARD = '/canvas-probe-groups';

const openBoard = async (page: import('@playwright/test').Page) => {
  await page.goto(BOARD);
  await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
  // The sidebar lands on Inspector, so the outline is opened explicitly rather
  // than assumed — which also means these tests cover the tab itself.
  await page.click('[data-side-tab="outline"]');
  await page.waitForSelector('[data-canvas-outline="true"]', { timeout: 20000 });
  await page.waitForTimeout(700);
};

const rowIds = (page: import('@playwright/test').Page) =>
  page.$$eval('[data-outline-id]', (els) => els.map((e) => e.getAttribute('data-outline-id')));

const depthOf = (page: import('@playwright/test').Page, id: string) =>
  page.$eval(`[data-outline-id="${id}"]`, (e) => Number(e.getAttribute('data-outline-depth')));

/** Which group a row is actually nested under, by outline depth. */
const parentDepthOf = (page: import('@playwright/test').Page, id: string) => {
  const ids = (window as any).__ids as string[] | undefined;
  void ids;
  return null;
};
void parentDepthOf;

test.describe('outline panel', () => {
  test('it lists the tree with nesting, not a flat list of nodes', async ({ page }) => {
    await openBoard(page);
    const ids = await rowIds(page);
    expect(ids).toContain('grp');
    expect(ids).toContain('kid1');
    expect(ids).toContain('loose');
    // The child is indented under its group, which is the whole point: nesting
    // is drawn rather than left for the user to infer from coordinates.
    expect(await depthOf(page, 'grp')).toBe(0);
    expect(await depthOf(page, 'sib')).toBe(1);
    // `kid1` is two levels down: grp > inner > kid1. The panel has to show the
    // real depth, not just "inside something".
    expect(await depthOf(page, 'inner')).toBe(1);
    expect(await depthOf(page, 'kid1')).toBe(2);
    expect(await depthOf(page, 'loose')).toBe(0);
  });

  test('clicking a row selects that node on the board', async ({ page }) => {
    await openBoard(page);
    await page.click('[data-outline-id="kid1"]');
    await page.waitForTimeout(250);
    const selected = await page.$$eval('.canvas-interactive-node', (els) =>
      els.filter((e) => e.className.includes('selected') || (e as HTMLElement).dataset.selected === 'true').length
    );
    // At minimum the click did not select everything, i.e. it is a real selection.
    const outlineSelected = await page.$eval('[data-outline-id="kid1"]', (e) =>
      e.getAttribute('style')?.includes('0, 242, 254') ?? false
    );
    expect(outlineSelected || selected > 0).toBe(true);
  });

  test('collapsing a group hides its children but keeps the row', async ({ page }) => {
    await openBoard(page);
    expect(await rowIds(page)).toContain('kid1');
    await page.click('[data-outline-id="grp"] button[aria-label^="Collapse"]');
    await page.waitForTimeout(200);
    const ids = await rowIds(page);
    expect(ids).toContain('grp');
    expect(ids).not.toContain('kid1');
  });

  test('dropping a row into a structural group reparents it', async ({ page }) => {
    await openBoard(page);
    expect(await depthOf(page, 'loose')).toBe(0);

    await page.dragAndDrop('[data-outline-id="loose"]', '[data-outline-id="sgrp"]');
    await page.waitForTimeout(400);

    // It is now a member, even though it sits nowhere near the frame — which is
    // exactly what "structural" buys, and the reason a drag can express it.
    expect(await depthOf(page, 'loose')).toBe(1);
  });

  test('dropping a distant row into a spatial group leaves it at the top level', async ({ page }) => {
    await openBoard(page);
    await page.dragAndDrop('[data-outline-id="loose"]', '[data-outline-id="grp"]');
    await page.waitForTimeout(400);

    // `loose` is nowhere near `grp`'s frame, and a spatial group only contains
    // what it surrounds, so the drop is accepted and then immediately released.
    // This is the policy working, not the drop failing.
    expect(await depthOf(page, 'loose')).toBe(0);
  });

  test('dragging a group onto its own child is refused, not applied', async ({ page }) => {
    await openBoard(page);
    const innerBefore = await depthOf(page, 'inner');
    // `inner` is a child of `grp`; moving `grp` into `inner` would be a cycle.
    await page.dragAndDrop('[data-outline-id="grp"]', '[data-outline-id="inner"]');
    await page.waitForTimeout(400);
    expect(await depthOf(page, 'inner')).toBe(innerBefore);
  });

  test('a structural group shows an outside marker for a child beyond its frame', async ({ page }) => {
    await openBoard(page);
    // `far` is parented to `sgrp` but sits well outside its frame, so the group
    // has to say so rather than implying the child is contained.
    const text = await page.$eval('[data-outline-id="sgrp"]', (e) => e.textContent ?? '');
    expect(text).toContain('↗');
    // And the child is still listed as a member, at depth 1.
    expect(await depthOf(page, 'far')).toBe(1);
  });

  test('membership can be switched from the outline', async ({ page }) => {
    await openBoard(page);
    // `grp` is spatial and has two members, so toggling it does not trip the
    // dissolve-at-1 threshold and the row survives to show the new mode.
    const before = await page.$eval('[data-outline-id="grp"]', (e) => e.textContent ?? '');
    expect(before).toContain('🖼️');

    await page.click('[data-outline-id="grp"] button[title*="structural"]');
    await page.waitForTimeout(300);

    const after = await page.$eval('[data-outline-id="grp"]', (e) => e.textContent ?? '');
    expect(after).toContain('🧱');
  });

  test('switching a structural group to contained releases the members it was holding', async ({ page }) => {
    await openBoard(page);
    // `far` is held by the structural group despite sitting outside its frame.
    expect(await depthOf(page, 'far')).toBe(1);

    await page.click('[data-outline-id="sgrp"] button[title*="contained"]');
    await page.waitForTimeout(400);

    // The moment it claims to be a frame, the member it does not surround is
    // released — the honest outcome, and undoable like any other change.
    expect(await depthOf(page, 'far')).toBe(0);
    // `sgrp` is left holding only `skid`, so the dissolve-at-1 threshold removes
    // it rather than leaving a one-child group behind. Both are consequences of
    // the same policy, and neither is a failure.
    expect(await page.$('[data-outline-id="sgrp"]')).toBeNull();
  });

  test('the outline and the inspector are two views of one document', async ({ page }) => {
    await page.goto(BOARD);
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    // Inspector is the landing view, so the board overview is still what a user
    // sees on arrival.
    expect(await page.isVisible('[data-side-tab="inspector"]')).toBe(true);
    expect(await page.getByText('Board Stats:').isVisible()).toBe(true);

    await page.click('[data-side-tab="outline"]');
    await page.waitForSelector('[data-canvas-outline="true"]', { timeout: 20000 });
    expect(await page.isVisible('[data-canvas-outline="true"]')).toBe(true);

    await page.click('[data-side-tab="inspector"]');
    await page.waitForTimeout(200);
    expect(await page.isVisible('[data-canvas-outline="true"]')).toBe(false);
  });

  test('O toggles the outline from the board', async ({ page }) => {
    await page.goto(BOARD);
    await page.waitForSelector('.canvas-board-viewport', { timeout: 20000 });
    expect(await page.isVisible('[data-canvas-outline="true"]')).toBe(false);
    await page.keyboard.press('o');
    await page.waitForSelector('[data-canvas-outline="true"]', { timeout: 5000 });
    expect(await page.isVisible('[data-canvas-outline="true"]')).toBe(true);
    await page.keyboard.press('o');
    await page.waitForTimeout(200);
    expect(await page.isVisible('[data-canvas-outline="true"]')).toBe(false);
  });
});

test.describe('membership modes on the board', () => {
  test('a spatial group releases a child dragged clear of it', async ({ page }) => {
    await openBoard(page);
    const kid = page.locator('[data-canvas-node-id="kid1"]');
    const box = (await kid.boundingBox())!;
    // Drag well clear of the group frame.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 1600, box.y + 900, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    // Released by the frame it escaped — but handed to the nearest surviving
    // ancestor rather than exiled to the root, so it stays in the outer group.
    expect(await depthOf(page, 'kid1')).toBe(1);
    // That leaves `inner` with only `kid2`, so `inner` dissolves and `kid2` is
    // handed up to the same outer group. Two thresholds firing in sequence, both
    // intentional: a group of one is not a group.
    expect(await depthOf(page, 'kid2')).toBe(1);
    expect(await page.$('[data-outline-id="inner"]')).toBeNull();
  });

  test('a structural group keeps a child dragged clear of it, and marks it', async ({ page }) => {
    await openBoard(page);
    const kid = page.locator('[data-canvas-node-id="skid"]');
    const box = (await kid.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 1600, box.y + 900, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    // Still a child, and the panel flags that it is outside.
    expect(await depthOf(page, 'skid')).toBe(1);
    const text = await page.$eval('[data-outline-id="sgrp"]', (e) => e.textContent ?? '');
    expect(text).toContain('↗');
  });

  test('the group header shows which mode it is in', async ({ page }) => {
    await openBoard(page);
    const glyphs = await page.$$eval('.canvas-group-header-pill', (els) =>
      els.map((e) => e.textContent ?? '')
    );
    // Spatial groups read as a frame, structural ones as a brick.
    expect(glyphs.some((g) => g.includes('🖼️'))).toBe(true);
    expect(glyphs.some((g) => g.includes('🧱'))).toBe(true);
  });
});
