import { defineConfig, devices } from '@playwright/test';

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const e2eAppPort = process.env.E2E_APP_PORT || '4321';

/**
 * E2E Test Configuration
 *
 * - Uses Testcontainers (Postgres + Meilisearch + OpenFGA) spun up in global-setup.ts
 * - Google OAuth endpoints use a local HTTP mock started by globalSetup
 * - Set TEST_APP_URL env var to run tests against an already-running app instance
 *   (skips the webServer block) — useful for CI with a pre-built Docker image
 */
export default defineConfig({
  testDir: './tests/e2e',

  globalSetup: './tests/setup/global-setup.ts',
  globalTeardown: './tests/setup/global-teardown.ts',

  // Keep the local E2E server and fixture services responsive on small machines.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.TEST_APP_URL ?? `http://localhost:${e2eAppPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    ...(chromiumExecutable
      ? { launchOptions: { executablePath: chromiumExecutable } }
      : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to enable multi-browser
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],

  // No `webServer` block: Playwright starts it *before* globalSetup, so it cannot
  // know the Testcontainers' mapped ports, and any env block here silently ships
  // the app pointing at the developer's local Postgres/Meilisearch instead. The
  // server is spawned from global-setup.ts, after the containers exist, and torn
  // down in global-teardown.ts. `TEST_APP_URL` still short-circuits both.
  webServer: undefined,
});
