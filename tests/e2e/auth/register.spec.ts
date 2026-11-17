import { test, expect } from '@playwright/test';

test.describe('Registration Flow', () => {
  // Generate a unique email per test run to avoid conflicts
  const uniqueEmail = () => `e2e-test-${Date.now()}@example.com`;

  test('uses labeled autocomplete fields and shared token-based auth styles', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('.auth-icon svg')).toBeVisible();
    await expect(page.locator('label[for="displayName"]')).toHaveText('Display name');
    await expect(page.locator('label[for="email"]')).toHaveText('Email address');
    await expect(page.getByTestId('display-name')).toHaveAttribute('autocomplete', 'name');
    await expect(page.getByTestId('email')).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByTestId('password')).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.locator('.auth-card [style]')).toHaveCount(0);
  });

  test('new user registers → auto-logged in → root folder created', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/register');
    await page.fill('[data-testid="display-name"]', 'E2E New User');
    await page.fill('[data-testid="email"]', email);
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.fill('[data-testid="confirm-password"]', 'TestPassword123!');
    await page.click('[data-testid="register-submit"]');

    // Should redirect to / after successful registration
    await page.waitForURL('/');

    // Session cookie should be set
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'session_token')).toBeTruthy();

    // User should be authenticated
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

  test('duplicate email → 409 error shown', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[data-testid="display-name"]', 'Duplicate User');
    await page.fill('[data-testid="email"]', 'dummy_mail'); // already seeded
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.fill('[data-testid="confirm-password"]', 'TestPassword123!');
    await page.click('[data-testid="register-submit"]');

    await expect(page).toHaveURL('/register');
    const errorEl = page.locator('[data-testid="error-message"]');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText(/already exists/i);
  });

  test('password mismatch → client-side error before submit', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[data-testid="display-name"]', 'Mismatch User');
    await page.fill('[data-testid="email"]', uniqueEmail());
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.fill('[data-testid="confirm-password"]', 'DifferentPassword!');
    await page.click('[data-testid="register-submit"]');

    // Client-side check fires before API call
    await expect(page).toHaveURL('/register');
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/do not match/i);
  });

  test('missing required fields → HTML5 validation prevents submit', async ({ page }) => {
    await page.goto('/register');
    // Only fill email, leave others blank
    await page.fill('[data-testid="email"]', uniqueEmail());
    await page.click('[data-testid="register-submit"]');
    await expect(page).toHaveURL('/register');
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible();
  });
});
