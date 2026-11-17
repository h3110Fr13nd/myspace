import { test, expect } from '../fixtures/auth.fixture';
import { injectSessionCookie } from '../fixtures/auth.fixture';

test.describe('ReBAC Permissions & Access Control Verification', () => {
  test('anonymous user can access public note', async ({ page }) => {
    await page.goto('/?doc=document%3Apublic_hello');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('h1').first()).toContainText(/Hello World/i, { timeout: 10_000 });
  });

  test('anonymous user is redirected to /login when requesting private note', async ({ page }) => {
    await page.goto('/?doc=document%3Aprivate_secret');
    await expect(page).toHaveURL(/\/login/);
  });

  test('anonymous user lacks edit access and cannot see WYSIWYG editor', async ({ page }) => {
    await page.goto('/?doc=document%3Apublic_hello&edit=true');
    // Editor should not be rendered; read-only lock banner is shown
    await expect(page.locator('.novel-editor-body .tiptap')).not.toBeVisible();
    await expect(page.locator('text=Read-only')).toBeVisible();
  });

  test('authenticated owner has full edit access to note', async ({ sessionPage }) => {
    // sessionPage is authenticated as user:testpassword (the owner of document:public_hello)
    await sessionPage.goto('/?doc=document%3Apublic_hello&edit=true');
    const editorBody = sessionPage.locator('.novel-editor-body .tiptap');
    await expect(editorBody).toBeVisible({ timeout: 10_000 });
  });

  test('authenticated viewer without editor grant sees read-only notice on edit attempt', async ({ browser }) => {
    // Create new context for viewer user (user:testgoogle is not the owner of document:public_hello)
    const context = await browser.newContext();
    await injectSessionCookie(
      context,
      'user:22222222-2222-4222-8222-222222222222',
      'dummy_mail',
      'DUMMY_NAME'
    );
    const viewerPage = await context.newPage();

    // document:public_hello is public, so viewer can read it
    await viewerPage.goto('/?doc=document%3Apublic_hello');
    await expect(viewerPage.locator('h1').first()).toContainText(/Hello World/i, { timeout: 10_000 });

    // But viewer cannot edit it because user:testpassword is owner and no OpenFGA editor tuple exists
    await viewerPage.goto('/?doc=document%3Apublic_hello&edit=true');
    await expect(viewerPage.locator('.novel-editor-body .tiptap')).not.toBeVisible();
    await expect(viewerPage.locator('text=Read-only')).toBeVisible();
    await expect(viewerPage.getByRole('status')).toContainText('Read-only.');
    await context.close();
  });
});
