import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { injectSessionCookie } from './fixtures/auth.fixture';

// Run alone against the disposable E2E Testcontainers database:
// E2E_EMPTY_WORKSPACE=1 npx playwright test tests/e2e/empty-workspace.isolated.spec.ts
test.skip(process.env.E2E_EMPTY_WORKSPACE !== '1', 'Destructive fixture reset requires an isolated run.');

test('empty workspace shows an honest state for anonymous and signed-in users', async ({ page }) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.TEST_APP_URL) throw new Error('Requires the E2E Testcontainers app.');
  const parsed = new URL(databaseUrl);
  if (parsed.username !== 'test_user' || parsed.pathname !== '/test_e2e_db') {
    throw new Error('Refusing to reset a database outside the disposable E2E fixture.');
  }

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query('TRUNCATE TABLE resources CASCADE');
  } finally {
    await db.end();
  }

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No accessible documents');
  await expect(page.getByText('Sign in to create and organize your documents, or open a public resource from the explorer.')).toBeVisible();
  await expect(page.locator('.workspace-empty-state a[href="/login"]')).toBeVisible();
  await expect(page.locator('.sidebar-right')).toHaveCount(0);

  await injectSessionCookie(
    page.context(),
    'user:11111111-1111-4111-8111-111111111111',
    'dummy_mail',
    'DUMMY_NAME',
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No accessible documents');
  await expect(page.getByText('Create a note, organize it in a folder, or bring in an existing file.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New folder' })).toBeVisible();
  await expect(page.locator('.workspace-empty-state [data-create-mode="import"]')).toBeVisible();
  await expect(page.locator('[data-testid="header-create-btn"]:visible')).toBeVisible();
  await expect(page.locator('[data-action="share"]:visible')).toHaveCount(0);
});
