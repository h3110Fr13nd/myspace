import { rm } from 'node:fs/promises';
import { test, expect } from '../fixtures/auth.fixture';

test.describe('Reader content on touch screens', () => {
  test.use({ isMobile: true, hasTouch: true });

  test('standalone mobile header keeps the brand, search, and actions in separate touch areas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tags');

    const topBar = page.locator('.top-bar');
    const brand = page.locator('.top-bar__left');
    const search = page.locator('.top-bar__center .search-input-shell');
    const actions = page.locator('.top-bar__right .action-rail--bar');
    await expect(search).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Register' })).toBeVisible();

    const bounds = await Promise.all([topBar, brand, search, actions].map((element) =>
      element.boundingBox()
    ));
    const [barBox, brandBox, searchBox, actionsBox] = bounds;
    expect(barBox && brandBox && searchBox && actionsBox).toBeTruthy();
    expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(actionsBox!.x);
    expect(searchBox!.y).toBeGreaterThan(brandBox!.y);
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(barBox!.x + barBox!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.setViewportSize({ width: 320, height: 700 });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    const drawer = page.locator('.ui-drawer');
    await expect(drawer.getByRole('link', { name: 'Sign In' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Register' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('mobile navigation puts common destinations first and closes after use', async ({ sessionPage }) => {
    await sessionPage.setViewportSize({ width: 390, height: 844 });
    await sessionPage.goto('/');
    await expect.poll(() => sessionPage.locator('.folder-tree').evaluateAll((trees) =>
      trees.length > 0 && trees.every((tree) => tree.getAttribute('data-ready') === 'true')
    )).toBe(true);

    const rowActions = sessionPage.locator('[data-testid="folder-node"] .tree-row-more');
    const firstRowAction = rowActions.first();
    await expect(firstRowAction).toBeVisible();
    expect(Number(await firstRowAction.evaluate((element) => getComputedStyle(element).opacity))).toBeGreaterThan(0.5);
    const actionTarget = await firstRowAction.boundingBox();
    expect(actionTarget?.width).toBeGreaterThanOrEqual(44);
    expect(actionTarget?.height).toBeGreaterThanOrEqual(44);
    const folderToggle = sessionPage.locator('[data-testid="folder-node"] .folder-tree-toggle').first();
    const toggleTarget = await folderToggle.boundingBox();
    expect(toggleTarget?.width).toBeGreaterThanOrEqual(44);
    expect(toggleTarget?.height).toBeGreaterThanOrEqual(44);
    await firstRowAction.tap();
    await expect(firstRowAction).toHaveAttribute('aria-expanded', 'true');
    await expect(sessionPage.getByTestId('tree-context-menu')).toBeVisible();
    await sessionPage.keyboard.press('Escape');

    const workspaceAccessCheck = sessionPage.waitForResponse((response) =>
      response.url().includes('/api/v1/permissions/workspace-access')
    );
    await sessionPage.getByRole('button', { name: 'Open navigation menu' }).click();
    const workspaceAccessResponse = await workspaceAccessCheck;
    expect(workspaceAccessResponse.status()).toBe(200);
    expect((await workspaceAccessResponse.json()).canManageWorkspaceAccess).toBe(false);
    const drawer = sessionPage.locator('.ui-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'New resource' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'All resources' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Browse tags' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Workspace access' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Theme' })).toHaveCount(0);
    await expect(sessionPage.locator('[data-action="create"]:visible')).toHaveAttribute('aria-label', 'New resource');

    await drawer.getByRole('link', { name: 'Browse tags' }).click();
    await expect(sessionPage).toHaveURL(/\/tags$/);
    await expect(drawer).toHaveCount(0);
    await expect(sessionPage.locator('[data-theme-icon]:visible')).toHaveCount(1);
    const themeBefore = await sessionPage.locator('html').getAttribute('data-theme');
    const expectedTheme = themeBefore === 'light' ? 'dark' : 'light';
    await sessionPage.locator('[data-action="theme"]:visible').click();
    await expect(sessionPage.locator('html')).toHaveAttribute('data-theme', expectedTheme);
    if (expectedTheme === 'light') {
      await expect(sessionPage.locator('[data-theme-icon]:visible')).toHaveClass(/is-light-theme/);
    } else {
      await expect(sessionPage.locator('[data-theme-icon]:visible')).not.toHaveClass(/is-light-theme/);
    }
    await sessionPage.locator('[data-action="theme"]:visible').click();
  });

  test('create flow has one clear way back to resource types', async ({ sessionPage }) => {
    await sessionPage.setViewportSize({ width: 390, height: 844 });
    await sessionPage.goto('/');
    await sessionPage.getByRole('button', { name: 'Open navigation menu' }).click();
    await sessionPage.locator('.ui-drawer').getByRole('button', { name: 'New resource' }).click();

    const dialog = sessionPage.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /New Note \/ Doc/ }).click();
    await expect(dialog.getByRole('button', { name: /Choose different type/ })).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'Change', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: /Choose different type/ }).click();
    await expect(dialog.getByRole('button', { name: /New Note \/ Doc/ })).toBeVisible();
  });

  test('keeps code actions visible and lets long table identifiers scroll', async ({
    sessionPage,
    request,
  }) => {
    await sessionPage.setViewportSize({ width: 390, height: 844 });
    const created = await request.post('/api/v1/resources/create', {
      data: { title: `Reader layout ${Date.now()}`, type: 'document' },
    });
    expect(created.status()).toBe(201);
    const resource = await created.json();

    try {
      const saved = await request.post('/api/v1/resources/save', {
        data: {
          id: resource.id,
          title: resource.title,
          content: [
            '# Reader layout',
            '',
            '| Scope | Tag ID | Access |',
            '| --- | --- | --- |',
            '| Vault | `tag:vault_research:public-access-control` | Granted |',
            '',
            '```ts',
            'const readable = true;',
            '```',
          ].join('\n'),
          is_public: false,
        },
      });
      expect(saved.status()).toBe(200);

      await sessionPage.goto(`/?doc=${encodeURIComponent(resource.id)}`);
      const title = sessionPage.locator('.workspace-resource-title');
      await expect(title).toBeVisible();
      expect(await title.evaluate((node) => getComputedStyle(node).overflowWrap)).toBe('anywhere');
      const copyButton = sessionPage.locator('.code-copy-btn').first();
      const table = sessionPage.locator('.prose-content table').first();
      const tableScroller = sessionPage.locator('.prose-table-scroll').first();
      const shikiCode = sessionPage.locator('.shiki-code-block .shiki').first();

      await expect(copyButton).toBeVisible();
      expect(await copyButton.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
      const copyButtonBox = await copyButton.boundingBox();
      const firstCodeLineTop = await sessionPage
        .locator('.shiki-code-block .shiki code span')
        .first()
        .evaluate((node) => node.getBoundingClientRect().top);
      expect(copyButtonBox).not.toBeNull();
      expect(firstCodeLineTop).toBeGreaterThan(copyButtonBox!.y + copyButtonBox!.height);
      await expect(tableScroller).toHaveAttribute('tabindex', '0');
      await expect(tableScroller).toHaveAccessibleName('Scrollable data table');
      await expect(tableScroller.locator('.prose-table-scroll__hint')).toBeVisible();
      expect(await tableScroller.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      expect(await tableScroller.evaluate((node) => {
        node.scrollLeft = node.scrollWidth;
        return node.scrollLeft;
      })).toBeGreaterThan(0);
      await expect(table).toBeVisible();
      expect(await shikiCode.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('0px');
      expect(await sessionPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      if (typeof resource.filePath === 'string') {
        await rm(resource.filePath, { force: true });
      }
    }
  });
});
