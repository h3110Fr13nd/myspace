import { test, expect } from '../fixtures/auth.fixture';

test.describe('Folder Tree Navigation', () => {
  test('anonymous user sees only public resources in sidebar', async ({ page }) => {
    await page.goto('/');

    // Folder tree should render
    const tree = page.locator('[data-testid="folder-node"], [data-testid="file-node"]');
    const count = await tree.count();

    // Sidebar should have at most public resources (private ones filtered server-side)
    // The exact count depends on seed, but we know 'document:private_secret' should NOT appear
    const fileLinks = page.locator('[data-testid="file-link"]');
    const allHrefs = await fileLinks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-resource-id'))
    );
    expect(allHrefs).not.toContain('document:private_secret');
    expect(allHrefs).not.toContain('document:draft_wip');
  });

  test('authenticated user sees their own resources (including private)', async ({
    sessionPage: page,
  }) => {
    // Open the nested private note so its ancestor folder is expanded. Other
    // parallel specs create root-level resources and can change the default doc.
    await page.goto('/?doc=document%3Aprivate_secret');

    const fileLinks = page.locator('[data-testid="file-link"]');
    await expect(fileLinks.first()).toBeVisible({ timeout: 10_000 });

    const allIds = await fileLinks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-resource-id'))
    );
    // Owner should see their private note
    expect(allIds).toContain('document:private_secret');
    // And their public note
    expect(allIds).toContain('document:public_hello');
  });

  test('clicking a folder navigates to /folders/[path]', async ({
    sessionPage: page,
  }) => {
    // Wait for the folder tree to render
    const folderLink = page.locator('[data-testid="folder-link"]').first();
    await expect(folderLink).toBeVisible({ timeout: 10_000 });

    const href = await folderLink.getAttribute('href');
    expect(href).toMatch(/^\/folders\//);

    await folderLink.click();
    await expect(page).toHaveURL(/\/folders\//);
  });

  test('folder index page renders its body as a prose listing', async ({ sessionPage: page }) => {
    let graphApiRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/workspace/graph')) graphApiRequests += 1;
    });

    // Navigate to the notes subfolder index
    await page.goto('/folders/folder%3Atestpassword_root%2Fnotes');

    await expect(page.locator('[data-testid="folder-index-title"]')).toBeVisible({ timeout: 10_000 });

    // The body is a resolved note (index document or generated listing), never
    // a bespoke card grid, and it lives inside the shared workspace shell.
    const body = page.locator('main.center-content article.prose-content');
    await expect(body).toBeVisible();
    await expect(page.locator('[data-testid="folder-resource-card"]')).toHaveCount(0);

    // The seeded child note is listed as a prose link.
    const links = body.locator('a[href]');
    await expect(links.first()).toBeVisible();

    await expect(page.locator('aside.sidebar-right canvas, aside.sidebar-right svg').first())
      .toBeVisible({ timeout: 15_000 });
    expect(graphApiRequests).toBe(0);
  });

  test('create and import actions keep the open folder as their destination', async ({ sessionPage: page }) => {
    const folderId = 'folder:testpassword_notes';
    await page.goto('/folders/folder%3Atestpassword_root%2Fnotes');

    const dialog = page.getByRole('dialog');
    await page.getByTestId('tree-new-btn').click();
    await dialog.getByRole('button', { name: 'New Note / Doc' }).click();
    await expect(dialog.locator('#create-location')).toHaveValue(folderId);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByTestId('tree-import-btn').click();
    await dialog.getByRole('button', { name: 'Upload PDF' }).click();
    await expect(dialog.locator('#create-location')).toHaveValue(folderId);
  });

  test('anonymous accessing private folder → redirected to login', async ({ page }) => {
    await page.goto('/folders/folder%3Atestpassword_root');
    await expect(page).toHaveURL(/\/login/);
  });
});
