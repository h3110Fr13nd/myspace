import { defineConfig } from '@playwright/test';

/**
 * Integration tests that need a real PostgreSQL (but no app server, browser,
 * OpenFGA or Meilisearch). Point GRAPH_TEST_DATABASE_URL at a server where the
 * test may create and drop the `graph_tiles_test` database:
 *
 *   GRAPH_TEST_DATABASE_URL=postgresql://postgres@localhost:5435/postgres \
 *     npx playwright test --config=tests/integration/playwright.config.ts
 *
 * Without it, the suite is skipped rather than failed.
 */
export default defineConfig({
  testDir: '.',
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  projects: [{ name: 'integration', use: {} }],
});
