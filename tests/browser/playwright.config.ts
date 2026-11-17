import { defineConfig } from '@playwright/test';

/**
 * Canvas browser checks.
 *
 * These drive a real Chromium against a running Astro dev server, so they need
 * one. Two reasons this is a separate config rather than a project inside
 * `tests/unit/playwright.config.ts`:
 *
 *  1. `webServer` is a top-level-only option, and the unit suite must stay
 *     server-free — booting Astro to check pure functions would be absurd.
 *  2. A hand-started dev server goes stale. Vite's SSR module graph breaks after
 *     a burst of edits and the page starts returning 500, which reads exactly
 *     like a product bug. Letting Playwright own the process removes that whole
 *     class of false failure.
 *
 * The port is deliberately *not* 4321. The Astro VS Code extension starts its
 * own `astro dev` on the default port, so a run that assumed 4321 would either
 * race that server or silently reuse it and inherit whatever state it was in.
 * A dedicated port makes the suite independent of the editor.
 *
 * No testcontainers here: the fixtures are static in-memory canvases, so the
 * canvas needs no database.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

const PORT = Number(process.env.CANVAS_PROBE_PORT ?? 4399);
const EXTERNAL = !!process.env.CANVAS_PROBE_URL;
const APP_URL = process.env.CANVAS_PROBE_URL ?? `http://localhost:${PORT}`;
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Gestures are timing-sensitive: a starved CPU shows up as dropped pointer
  // events, so run one worker rather than mis-reporting a flake as a bug.
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    ...(CHROMIUM_EXECUTABLE
      ? { launchOptions: { executablePath: CHROMIUM_EXECUTABLE } }
      : {}),
  },

  projects: [{ name: 'browser', use: {} }],

  // Reuse an already-running server when one is provided (CI), otherwise boot
  // our own. `reuseExistingServer` keeps local iteration fast.
  webServer: EXTERNAL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        // Playwright runs webServer with cwd set to *this config's* directory.
        // Without this, `npm run dev` looks for tests/browser/package.json and
        // exits 254 before the URL is ever reachable.
        cwd: REPO_ROOT,
        env: { CANVAS_PROBE_PORT: String(PORT), ASTRO_DEV_BACKGROUND: '1' },
        url: APP_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
