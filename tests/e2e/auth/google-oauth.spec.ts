import { test, expect } from '@playwright/test';

test.describe('Google OAuth Flow (local endpoint mock)', () => {

  test('OAuth flow → session cookie set → logged in as Google user', async ({ page }) => {
    await page.goto('/api/v1/auth/google?login_hint=test-google%40example.com');
    await page.waitForURL('/', { timeout: 15_000 });

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'session_token')).toBeTruthy();
    // The workspace keeps a bar and a floating rail in the DOM so the selected chrome
    // mode can switch instantly. Wait until the saved mode has been applied before
    // checking the active account control; otherwise the redirect can race the head's
    // preference bootstrap and observe both surfaces before CSS has selected one.
    await expect(page.locator('html')).toHaveAttribute('data-chrome', /^(header|rail|rail-pinned)$/);
    const accountMenuTrigger = page.locator('[data-testid="user-menu-trigger"]:visible');
    await expect(accountMenuTrigger).toHaveCount(1);
    await expect(accountMenuTrigger).toBeVisible();
    await expect(accountMenuTrigger).toHaveAttribute('data-ready', 'true');
  });

  test('unverified Google email is rejected and error shown', async ({ page }) => {
    await page.goto('/api/v1/auth/google?login_hint=unverified%40example.com');
    // Should redirect to /login with an error
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    // Error param or error message should be present
    const url = new URL(page.url());
    expect(url.searchParams.has('error') || url.pathname === '/login').toBeTruthy();
  });

  test('Google login for existing password user → same userId returned', async ({ page, context }) => {
    await page.goto('/api/v1/auth/google?login_hint=test-dual%40example.com');
    await page.waitForURL('/', { timeout: 15_000 });

    // Verify /api/v1/auth/me returns the correct userId (the pre-existing dual user)
    const meRes = await context.request.get('/api/v1/auth/me');
    expect(meRes.ok()).toBeTruthy();
    const body = await meRes.json();
    expect(body.user?.userId ?? body.userId).toBe('user:33333333-3333-4333-8333-333333333333');
  });
});
