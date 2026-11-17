import { test, expect } from '@playwright/test';

test.describe('Email/Password Login Flow', () => {
  test('auth heading and OAuth error use accessible line icons', async ({ page }) => {
    await page.goto('/login?error=oauth_cancelled');
    await expect(page.locator('.auth-icon svg')).toBeVisible();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Google Sign-In was cancelled.');
    await expect(alert.locator('svg')).toBeVisible();
  });

  test('uses labeled autocomplete fields and theme-aware shared auth styles', async ({ page }) => {
    await page.goto('/login');
    const email = page.getByTestId('email');
    const password = page.getByTestId('password');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.locator('label[for="email"]')).toHaveText('Email address');
    await expect(page.locator('label[for="password"]')).toHaveText('Password');
    await expect(page.locator('.auth-card [style]')).toHaveCount(0);

    const googleButton = page.getByRole('link', { name: 'Continue with Google' });
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => {
        localStorage.setItem('workspace_prefs', JSON.stringify({ theme: value }));
        location.reload();
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const colors = await googleButton.evaluate((node) => {
        const tokenValue = getComputedStyle(document.documentElement)
          .getPropertyValue('--control-bg')
          .trim();
        const probe = document.createElement('span');
        probe.style.backgroundColor = tokenValue;
        document.body.append(probe);
        const tokenColor = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { button: getComputedStyle(node).backgroundColor, token: tokenColor };
      });
      expect(colors.button).toBe(colors.token);
    }
  });

  test('keyboard navigation keeps a visible focus ring on the next field', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/login');
    const email = page.getByTestId('email');
    const password = page.getByTestId('password');

    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
      await email.focus();
      await page.keyboard.press('Tab');
      await expect(password).toBeFocused();
      const ring = await password.evaluate((node) => {
        const style = getComputedStyle(node);
        return { width: style.outlineWidth, outline: style.outlineStyle, color: style.outlineColor };
      });
      expect(Number.parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
      expect(ring.outline).toBe('solid');
      expect(ring.color).not.toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('valid credentials → session_token cookie set → redirect to /', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-submit"]');

    await page.waitForURL('/');

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session_token');
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie?.httpOnly).toBe(true);

    // The workspace renders TWO copies of the account menu and the search box: one in
    // the top bar, one in the floating rail. Both stay in the DOM at all times and CSS
    // picks the active one from `data-chrome`, so switching modes is instant. Verified in
    // a real browser: exactly one copy is ever laid out, and the other is `display:none`
    // via an ancestor, i.e. out of the tab order and the accessibility tree. So this is a
    // test-scoping problem, not a duplicate control a user can reach. `:visible` picks the
    // active copy in any chrome mode, where naming a surface (`.top-bar` / `.action-rail`)
    // would hardcode one mode and break the moment the preference changes.
    const accountMenuTrigger = page.locator('[data-testid="user-menu-trigger"]:visible');
    await expect(accountMenuTrigger).toBeVisible();
    await expect(accountMenuTrigger).toHaveAttribute('data-ready', 'true');
  });

  test('wrong password → error message shown', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'WrongPassword!');
    await page.click('[data-testid="login-submit"]');

    // Should stay on /login
    await expect(page).toHaveURL('/login');
    const errorEl = page.locator('[data-testid="error-message"]');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText(/invalid credentials/i);
  });

  test('unknown email → error message shown', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'AnyPassword!');
    await page.click('[data-testid="login-submit"]');

    await expect(page).toHaveURL('/login');
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
  });

  test('missing fields → browser validation fires (does not reach server)', async ({ page }) => {
    await page.goto('/login');
    // Click submit without filling anything
    await page.click('[data-testid="login-submit"]');
    // HTML5 required validation prevents submission
    await expect(page).toHaveURL('/login');
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible();
  });

  test('logout → session_token cookie cleared', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('/');
    const accountMenuTrigger = page.locator('[data-testid="user-menu-trigger"]:visible');
    await expect(accountMenuTrigger).toBeVisible();
    await expect(accountMenuTrigger).toHaveAttribute('data-ready', 'true');

    // Logout
    await accountMenuTrigger.click();
    const accountMenu = page.getByRole('navigation', { name: 'Account' });
    await expect(accountMenu).toBeVisible();
    const logoutResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/auth/logout'
    );
    await accountMenu.getByTestId('logout-btn').click();
    const logoutResponse = await logoutResponsePromise;
    expect(logoutResponse.status()).toBe(302);
    // The logout route clears the session and returns to the public homepage.
    await page.waitForURL('/');

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session_token');
    expect(!sessionCookie || sessionCookie.value === '').toBeTruthy();

    // User menu should no longer be visible
    await page.goto('/');
    await expect(page.locator('[data-testid="user-menu-trigger"]:visible')).not.toBeVisible();
  });

  test('protected route redirects anonymous user to /login', async ({ page }) => {
    await page.goto('/admin/permissions');
    await expect(page).toHaveURL(/\/login/);
  });
});
