import { test, expect, injectSessionCookie } from '../fixtures/auth.fixture';

test('workspace access navigation is available to workspace administrators', async ({ page, context }) => {
  await injectSessionCookie(
    context,
    'user:44444444-4444-4444-8444-444444444444',
    'dummy_mail',
    'DUMMY_NAME',
  );
  await page.goto('/');

  const workspaceAccessCheck = page.waitForResponse((response) =>
    response.url().includes('/api/v1/permissions/workspace-access')
  );
  await page.locator('[data-testid="user-menu-trigger"]:visible').click();
  const response = await workspaceAccessCheck;
  expect(response.status()).toBe(200);
  expect((await response.json()).canManageWorkspaceAccess).toBe(true);
  await expect(page.locator('.user-menu-dropdown').getByRole('link', { name: 'Workspace access' })).toBeVisible();
});

test('IAM role choices match the selected resource model', async ({ page, context }) => {
  await injectSessionCookie(
    context,
    'user:44444444-4444-4444-8444-444444444444',
    'dummy_mail',
    'DUMMY_NAME',
  );
  await page.goto('/admin/permissions');
  await expect(page.getByRole('heading', { name: /Access Control & IAM Studio/ })).toBeVisible();

  await page.getByRole('button', { name: /Vault Access Matrix/i }).click();
  const roleSelect = page.getByRole('combobox', { name: 'Role' });
  await expect(roleSelect).toBeVisible();
  const optionValues = await roleSelect.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value)
  );
  expect(optionValues).toContain('viewer');
  expect(optionValues).toContain('editor');
  expect(optionValues).toContain('owner');
  expect(optionValues).not.toContain('commenter');
  expect(optionValues).not.toContain('downloader');
});
