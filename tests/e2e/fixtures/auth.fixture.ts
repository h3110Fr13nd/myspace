import { test as base, expect, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test';
// Default import, not `import * as`. Playwright transpiles specs to CJS, where a
// namespace import of a CommonJS module yields a namespace object whose
// `sign` is undefined — the callable API lives on `.default`. That surfaced as
// `TypeError: jwt.sign is not a function` and failed every test that injects a
// session cookie directly.
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test_jwt_secret_e2e_key';

// ─── Shared Helper: Login via Email/Password ──────────────────────────────────
export async function loginWithPassword(
  page: Page,
  email = 'dummy_mail',
  password = 'TestPassword123!'
) {
  await page.goto('/login');
  await page.fill('[data-testid="email"]', email);
  await page.fill('[data-testid="password"]', password);
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL('/');
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
}

// Google endpoints are served by the local HTTP mock started in globalSetup.
export async function loginWithGoogle(page: Page) {
  await page.goto('/api/v1/auth/google?login_hint=test-google%40example.com');
  await page.waitForURL('/', { timeout: 15_000 });
  const accountMenuTrigger = page.locator('[data-testid="user-menu-trigger"]:visible');
  await expect(accountMenuTrigger).toBeVisible();
  await expect(accountMenuTrigger).toHaveAttribute('data-ready', 'true');
}

// ─── Fixture: Cookie Injection (fast path for tests that just need a session) ─
//
// For tests that don't care about the login UI, inject a valid session cookie
// directly without going through the browser flow. Faster and more isolated.
export async function injectSessionCookie(
  context: BrowserContext,
  userId: string,
  email: string,
  displayName: string
) {
  const token = jwt.sign({ userId, email, displayName }, JWT_SECRET, { expiresIn: '7d' });
  await context.addCookies([
    {
      name: 'session_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
  ]);
}

// ─── Extended Test Fixtures ───────────────────────────────────────────────────

type AuthFixtures = {
  /** Page authenticated as the email/password test user (via UI flow) */
  passwordPage: Page;
  /** Page authenticated as the Google OAuth test user (via route mock) */
  googlePage: Page;
  /** Page with a directly-injected session cookie for the password user (fast) */
  sessionPage: Page;
  /** API requests sharing the test browser context's cookie jar. */
  request: APIRequestContext;
};

export const test = base.extend<AuthFixtures>({
  request: async ({ context }, use) => {
    await use(context.request);
  },

  passwordPage: async ({ page }, use) => {
    await loginWithPassword(page);
    await use(page);
  },

  googlePage: async ({ page }, use) => {
    await loginWithGoogle(page);
    await use(page);
  },

  sessionPage: async ({ page, context }, use) => {
    // Fast: inject cookie directly, no UI login needed
    await injectSessionCookie(
      context,
      'user:11111111-1111-4111-8111-111111111111',
      'dummy_mail',
      'DUMMY_NAME'
    );
    await page.goto('/');
    await use(page);
  },
});

export { expect };
