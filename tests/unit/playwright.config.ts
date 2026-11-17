import { defineConfig } from '@playwright/test';

/**
 * Unit test configuration.
 *
 * Separate from `playwright.config.ts` on purpose: the e2e suite boots
 * Postgres/Meilisearch/OpenFGA containers in global setup, which is absurd
 * overhead for pure-function checks. These specs import modules directly and
 * run in Node with no server, no browser, and no fixtures.
 *
 * Canvas interaction checks live in `tests/browser`, which owns its own dev
 * server via `webServer` -- an option this config must not use, since these
 * tests never need one.
 */
export default defineConfig({
  // testDir is resolved relative to this config file, so '.' is tests/unit.
  testDir: '.',
  fullyParallel: true,
  reporter: [['list']],
  projects: [{ name: 'unit', use: {} }],
});
