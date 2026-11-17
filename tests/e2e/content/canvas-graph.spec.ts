import { test, expect } from '@playwright/test';

test.describe('JSON Canvas & Graph Interaction Sanity', () => {
  test('renders JSON Canvas board and nodes', async ({ page }) => {
    await page.goto('/?doc=canvas%3Apublic_test_canvas');

    // Canvas board viewport should be present
    const canvasBoard = page.locator('.canvas-board-viewport');
    await expect(canvasBoard).toBeVisible({ timeout: 10_000 });

    // Text nodes from seed data should render
    const nodeA = page.locator('.canvas-text-node', { hasText: 'Microservice A' });
    await expect(nodeA).toBeVisible();

    const nodeB = page.locator('.canvas-text-node', { hasText: 'Database Node' });
    await expect(nodeB).toBeVisible();
  });

  test('canvas zoom and toolbar controls are interactive', async ({ page }) => {
    await page.goto('/?doc=canvas%3Apublic_test_canvas');

    // Verify canvas toolbar
    const toolbar = page.locator('.canvas-toolbar');
    await expect(toolbar).toBeVisible();

    // Zoom in button
    const zoomInBtn = toolbar.locator('button[title*="Zoom In"]');
    await expect(zoomInBtn).toBeVisible();
    await zoomInBtn.click();

    // Zoom out button
    const zoomOutBtn = toolbar.locator('button[title*="Zoom Out"]');
    await expect(zoomOutBtn).toBeVisible();
    await zoomOutBtn.click();

    // Fit to bounds button
    const fitBtn = toolbar.locator('button[title*="Fit"]');
    if (await fitBtn.count() > 0) {
      await fitBtn.first().click();
    }
  });

  test('sidebar graph view renders canvas or svg element', async ({ page }) => {
    let graphRequestCount = 0;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/workspace/graph')) graphRequestCount += 1;
    });

    const response = await page.goto('/?doc=document%3Apublic_hello');
    expect(response?.status()).toBe(200);
    expect(await response?.text()).toContain('graph-viewport-bar__label');

    // The graph arrives with the page and renders without a manual load action.
    const graphSection = page.getByRole('region', { name: 'Workspace graph' });
    await expect(graphSection).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /load graph/i })).toHaveCount(0);

    // The prefiltered graph arrives with the page; opening the sidebar does not
    // trigger a duplicate resource listing and authorization pass.

    // The graph viewport should contain either a canvas or svg element
    const graphCanvasOrSvg = page.locator('aside.sidebar-right canvas, aside.sidebar-right svg');
    await expect(graphCanvasOrSvg.first()).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(graphRequestCount).toBe(0);

    const graphResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/v1/workspace/graph')
    );
    await page.getByRole('button', { name: 'Expand graph view fullscreen' }).click();
    const graphResponse = await graphResponsePromise;
    expect(graphResponse.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Full Knowledge Graph' })).toBeVisible();
    expect(graphRequestCount).toBe(1);
  });
});
