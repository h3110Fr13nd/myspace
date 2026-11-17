# Plan 20: E2E Testing Suite

> **Implementation status (2026-11-11):** The implementation and current test
> results are authoritative over the original illustrative snippets below.
> Full E2E passes 100 tests with one destructive opt-in case skipped against
> isolated test services (verified 2026-11-11). The default configuration uses
> one worker to avoid load-related flakes. Historical snippets and defect notes
> below are design history, not current setup instructions. Run
> `npx playwright test` for the full suite; set `E2E_APP_PORT` when the default
> local port is already in use.

Playwright-based, Testcontainers-backed end-to-end testing infrastructure for the workspace blog. Designed so that adding new features doesn't break existing auth, vault, search, or content flows.

---

## Design Philosophy

| Concern | Choice | Rationale |
|---|---|---|
| Browser automation | **Playwright** (`@playwright/test`) | First-class SSR support, parallel workers, built-in HTML reports |
| Isolated data | **Testcontainers (Node.js)** | Fresh Postgres + Meilisearch containers per run — no shared state between runs |
| Google OAuth testing | **Mock OIDC server** | Real Google OAuth requires a browser interacting with Google servers; a local OIDC provider covers the callback flow end-to-end |
| Config separation | **`.env.test`** | Overrides for test containers — doesn't pollute `.env` dev config |
| API contract tests | **`fetch` inside Playwright** | No extra runner needed; Playwright can drive HTTP requests directly |
| OpenFGA (initial) | **Permissive stub** | Skip container startup cost initially; add OpenFGA container in follow-up once suite is stable |

---

## Directory Structure

```
tests/
├── e2e/
│   ├── fixtures/
│   │   ├── auth.fixture.ts        # Playwright page fixtures: logged-in (password), logged-in (google-mock)
│   │   └── db.fixture.ts          # Per-test DB seeding helpers (direct pg connection to test container)
│   ├── auth/
│   │   ├── login.spec.ts
│   │   ├── register.spec.ts
│   │   └── google-oauth.spec.ts
│   ├── vault/
│   │   ├── folder-tree.spec.ts
│   │   └── search.spec.ts
│   ├── content/
│   │   ├── render.spec.ts
│   │   └── properties.spec.ts
│   └── api/
│       ├── auth-api.spec.ts
│       └── vault-api.spec.ts
├── setup/
│   ├── global-setup.ts            # Spin up containers, run migrations, seed, start mock OIDC + app
│   ├── global-teardown.ts         # Stop all containers
│   └── mock-oidc-server.ts        # Minimal Express OIDC provider for Google OAuth flow
├── fixtures/
│   └── seed.sql                   # Deterministic test data: users, resources, tags, auth_settings
├── playwright.config.ts
└── .env.test                      # Test-specific env (ports set dynamically by global-setup)
```

---

## Infrastructure: Testcontainers

### `tests/setup/global-setup.ts`

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export default async function globalSetup() {
  // 1. Start fresh Postgres (same image as docker-compose)
  const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('test_db')
    .withUsername('test_user')
    .withPassword('test_pass')
    .withHealthCheck({ test: ['CMD-SHELL', 'pg_isready -U test_user'], interval: 2000, timeout: 3000, retries: 10 })
    .start();

  // 2. Start fresh Meilisearch
  const meili = await new GenericContainer('getmeili/meilisearch:v1.8')
    .withEnvironment({ MEILI_MASTER_KEY: 'test_master_key', MEILI_ENV: 'development' })
    .withExposedPorts(7700)
    .withWaitStrategy(Wait.forHttp('/health', 7700))
    .start();

  // 3. Run DB migrations against fresh Postgres
  const dbUrl = postgres.getConnectionUri();
  execSync(`DATABASE_URL="${dbUrl}" npm run migrate:up`, { stdio: 'inherit' });

  // 4. Seed fixture data
  const seed = fs.readFileSync(path.join(__dirname, '../fixtures/seed.sql'), 'utf-8');
  // connect to postgres and execute seed SQL...

  // 5. Start mock OIDC server
  const { startMockOidc } = await import('./mock-oidc-server');
  const oidcPort = await startMockOidc();

  // 6. Write dynamic values to process.env (picked up by Playwright webServer + tests)
  process.env.DATABASE_URL = dbUrl;
  process.env.MEILISEARCH_URL = `http://localhost:${meili.getMappedPort(7700)}`;
  process.env.MEILISEARCH_KEY = 'test_master_key';
  process.env.GOOGLE_CLIENT_ID = 'mock_client_id';
  process.env.GOOGLE_CLIENT_SECRET = 'mock_client_secret';
  process.env.GOOGLE_REDIRECT_URI = `http://localhost:4321/auth/callback`;
  process.env.MOCK_OIDC_URL = `http://localhost:${oidcPort}`;
  process.env.JWT_SECRET = 'mock_dev_jwt_secret_for_tests';

  // 7. Store container references for teardown
  (global as any).__TEST_CONTAINERS__ = { postgres, meili };
}
```

### `tests/setup/global-teardown.ts`

```typescript
export default async function globalTeardown() {
  const { postgres, meili } = (global as any).__TEST_CONTAINERS__ ?? {};
  await postgres?.stop();
  await meili?.stop();
}
```

---

## Mock OIDC Server (Google OAuth)

### `tests/setup/mock-oidc-server.ts`

A minimal Express server that impersonates Google's OAuth endpoints, allowing the app's full callback flow to be tested without hitting `accounts.google.com`.

```typescript
import express from 'express';
import * as http from 'http';

const MOCK_USER = {
  sub: 'google_test_user_123',
  email: 'dummy_mail',
  email_verified: true,
  name: 'DUMMY_NAME',
  picture: 'https://example.com/avatar.jpg',
};

export async function startMockOidc(): Promise<number> {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Redirect to callback with a mock auth code
  app.get('/authorize', (req, res) => {
    const { redirect_uri, state } = req.query as Record<string, string>;
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', 'mock_auth_code_12345');
    if (state) callbackUrl.searchParams.set('state', state);
    res.redirect(callbackUrl.toString());
  });

  // Exchange code for tokens
  app.post('/token', (_req, res) => {
    res.json({
      access_token: 'mock_access_token',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: 'mock_id_token',
    });
  });

  // Return mock user profile
  app.get('/userinfo', (_req, res) => res.json(MOCK_USER));

  // OpenID configuration endpoint (if app discovers it)
  app.get('/.well-known/openid-configuration', (req, res) => {
    const base = `http://localhost:${(server.address() as any).port}`;
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      userinfo_endpoint: `${base}/userinfo`,
    });
  });

  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      resolve((server.address() as any).port);
    });
  });
}
```

> **Note:** The app's `src/pages/api/v1/auth/google` and the Google callback handler must read `GOOGLE_OAUTH_BASE_URL` (or equivalent) from env so they can be pointed at the mock server in test mode. This requires a small change to those route handlers.

---

## Auth Fixtures

### `tests/e2e/fixtures/auth.fixture.ts`

```typescript
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

type AuthFixtures = {
  passwordAuthPage: Page;   // page pre-authenticated via email+password
  googleAuthPage: Page;     // page pre-authenticated via mock Google OAuth
};

export const test = base.extend<AuthFixtures>({
  passwordAuthPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('/');
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
    await use(page);
  },

  googleAuthPage: async ({ page }, use) => {
    // Navigate to the Google OAuth initiation endpoint
    // Mock OIDC server intercepts and redirects back with mock code
    // App callback handler exchanges code → sets session_token cookie
    await page.goto('/api/v1/auth/google');
    await page.waitForURL('/');
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
    await use(page);
  },
});

export { expect };
```

---

## Seed Data

### `tests/fixtures/seed.sql`

```sql
-- Auth settings
INSERT INTO auth_settings (id, enable_google_oauth, enable_password_auth, enable_registration, auto_link_same_email)
VALUES ('default', true, true, true, true)
ON CONFLICT (id) DO NOTHING;

-- Password test user (password: TestPassword123! — bcrypt hash)
INSERT INTO users (id, email, password_hash, display_name)
VALUES (
  'user:testpassword',
  'dummy_mail',
  '$2b$10$...',   -- bcrypt('TestPassword123!')
  'DUMMY_NAME'
) ON CONFLICT DO NOTHING;

-- Google OAuth test user (no password)
INSERT INTO users (id, email, display_name)
VALUES (
  'user:testgoogle',
  'dummy_mail',
  'DUMMY_NAME'
) ON CONFLICT DO NOTHING;

-- Google identity link
INSERT INTO user_identities (id, user_id, provider, provider_account_id, email, metadata)
VALUES (
  'ident_google_test',
  'user:testgoogle',
  'google',
  'google_test_user_123',
  'dummy_mail',
  '{}'
) ON CONFLICT DO NOTHING;

-- Personal root folders
INSERT INTO resources (id, type, tenant_id, owner_id, path, title, metadata, is_public)
VALUES
  ('folder:testpassword_root', 'folder', 'tenant_default', 'user:testpassword', 'folder:testpassword_root', 'Test Vault Root', '{"isPersonalRoot": true}', false),
  ('folder:testgoogle_root', 'folder', 'tenant_default', 'user:testgoogle', 'folder:testgoogle_root', 'Google User Vault', '{"isPersonalRoot": true}', false)
ON CONFLICT DO NOTHING;

-- Sample public resource (markdown)
INSERT INTO resources (id, type, tenant_id, owner_id, path, title, content, metadata, is_public)
VALUES (
  'md:public_hello',
  'md',
  'tenant_default',
  'user:testpassword',
  'md:public_hello',
  'Hello World',
  '# Hello World\n\nThis is a **public** test note with $E = mc^2$ math.\n\n[[private-note]] is a wikilink.',
  '{"tags": ["test", "public"], "aliases": ["hello", "hello-world"]}',
  true
) ON CONFLICT DO NOTHING;

-- Sample private resource
INSERT INTO resources (id, type, tenant_id, owner_id, path, title, content, metadata, is_public)
VALUES (
  'md:private_secret',
  'md',
  'tenant_default',
  'user:testpassword',
  'md:private_secret',
  'Private Note',
  '# Secret\n\nThis should not be visible to anonymous users.',
  '{}',
  false
) ON CONFLICT DO NOTHING;

-- Tags
INSERT INTO tags (id, name) VALUES ('tag:test', 'test'), ('tag:public', 'public') ON CONFLICT DO NOTHING;
INSERT INTO resource_tags (resource_id, tag_id) VALUES ('md:public_hello', 'tag:test'), ('md:public_hello', 'tag:public') ON CONFLICT DO NOTHING;
```

> **Note:** The `bcrypt` hash for `TestPassword123!` must be pre-computed and inserted literally. Use `node -e "require('bcryptjs').hash('TestPassword123!', 10).then(console.log)"` to generate it.

---

## Playwright Config

### `playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/setup/global-setup.ts',
  globalTeardown: './tests/setup/global-teardown.ts',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],

  use: {
    baseURL: process.env.TEST_APP_URL ?? 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },  // enable as needed
  ],

  // Auto-start dev server against test containers if TEST_APP_URL is not set
  webServer: process.env.TEST_APP_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
```

---

## Test Specs

### `tests/e2e/auth/login.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Email/Password Login', () => {
  test('valid credentials → session cookie set → redirect to /', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('/');
    const cookie = await page.context().cookies();
    expect(cookie.find(c => c.name === 'session_token')).toBeTruthy();
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
  });

  test('wrong password → 401 error shown', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'WrongPassword!');
    await page.click('[data-testid="login-submit"]');
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText('Invalid credentials');
  });

  test('missing fields → validation error', async ({ page }) => {
    await page.goto('/login');
    await page.click('[data-testid="login-submit"]');
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
  });

  test('logout → cookie cleared → anonymous state', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('/');

    // Logout
    await page.click('[data-testid="logout-btn"]');
    const cookies = await page.context().cookies();
    expect(cookies.find(c => c.name === 'session_token')).toBeFalsy();
  });
});
```

### `tests/e2e/auth/google-oauth.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Google OAuth (Mock OIDC)', () => {
  test('OAuth flow → session set → logged in as Google user', async ({ page }) => {
    // Initiating the Google OAuth flow will redirect to mock OIDC server
    // which auto-redirects back to /auth/callback with mock code
    await page.goto('/api/v1/auth/google');
    await page.waitForURL('/');
    const cookie = await page.context().cookies();
    expect(cookie.find(c => c.name === 'session_token')).toBeTruthy();
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
  });

  test('auto-linking: Google email matches existing password account', async ({ page }) => {
    // This test uses a special fixture user where email matches both identities
    // After OAuth, only ONE user record should exist with both identities linked
    // Verify via /api/v1/auth/me that userId is consistent
    const res = await page.request.get('/api/v1/auth/me', {
      headers: { Cookie: 'session_token=<token>' } // seeded token
    });
    // assert single userId in DB with multiple user_identities rows
  });
});
```

### `tests/e2e/api/auth-api.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Auth API — email/password', () => {
  test('POST /api/v1/auth/register → 201 + session cookie', async ({ request }) => {
    const res = await request.post('/api/v1/auth/register', {
      data: {
        email: `new-${Date.now()}@example.com`,
        password: 'NewUser123!',
        displayName: 'New User',
      },
    });
    expect(res.status()).toBe(201);
    const setCookie = res.headers()['set-cookie'];
    expect(setCookie).toContain('session_token');
  });

  test('POST /api/v1/auth/login → 200 + session cookie', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'dummy_mail', password: 'TestPassword123!' },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['set-cookie']).toContain('session_token');
  });

  test('GET /api/v1/auth/me with valid cookie → user payload', async ({ page }) => {
    // Login to get cookie
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('/');

    const res = await page.request.get('/api/v1/auth/me');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('dummy_mail');
  });

  test('duplicate email on register → 409', async ({ request }) => {
    const res = await request.post('/api/v1/auth/register', {
      data: {
        email: 'dummy_mail',
        password: 'AnotherPass123!',
        displayName: 'Duplicate',
      },
    });
    expect(res.status()).toBe(409);
  });
});
```

### `tests/e2e/api/vault-api.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { createApiKey } from '../../../src/lib/auth'; // or via API endpoint

test.describe('Vault API — resource CRUD + API Keys', () => {
  test('authenticated save creates resource', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'dummy_mail');
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL('/');

    const res = await page.request.post('/api/v1/resources/save', {
      data: {
        path: 'md:e2e_test_note',
        title: 'E2E Test Note',
        content: '# E2E\nCreated by Playwright.',
        type: 'md',
        metadata: {},
      },
    });
    expect(res.status()).toBe(200);
  });

  test('API key (fsk_live_...) authenticates vault sync', async ({ request }) => {
    // Create an API key via the auth API (authenticated)
    // then use it as Bearer token for a vault operation
    const res = await request.post('/api/v1/vault/sync', {
      headers: { Authorization: 'Bearer fsk_live_<seeded_test_key>' },
      data: { resources: [] },
    });
    // Should not be 401
    expect(res.status()).not.toBe(401);
  });

  test('expired/revoked API key → 401', async ({ request }) => {
    const res = await request.get('/api/v1/auth/me', {
      headers: { Authorization: 'Bearer fsk_live_invalid_or_revoked_key' },
    });
    expect(res.status()).toBe(401);
  });
});
```

---

## `data-testid` Instrumentation Required

These attributes need to be added to existing pages/components before browser tests can run. They are **non-breaking** production-safe additions.

| File | Attributes to Add |
|---|---|
| [`login.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/login.astro) | `data-testid="email"`, `data-testid="password"`, `data-testid="login-submit"`, `data-testid="error-message"` |
| [`register.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/register.astro) | `data-testid="email"`, `data-testid="password"`, `data-testid="display-name"`, `data-testid="register-submit"`, `data-testid="error-message"` |
| [`Header.astro`](file:///home/user/Desktop/dev/blog/template/src/components/Header.astro) | `data-testid="user-menu"`, `data-testid="logout-btn"` |
| [`SearchModal.tsx`](file:///home/user/Desktop/dev/blog/template/src/components/SearchModal.tsx) | `data-testid="search-input"`, `data-testid="search-result"` |
| [`FolderTree.tsx`](file:///home/user/Desktop/dev/blog/template/src/components/FolderTree.tsx) | `data-testid="folder-node"`, `data-testid="file-node"` |

---

## Google OAuth Callback Handler Change

The mock OIDC approach requires the Google OAuth callback at `src/pages/auth/callback.ts` to read the token/userinfo endpoints from env instead of hardcoding `googleapis.com`. The existing file at [`src/pages/auth/callback.ts`](file:///home/user/Desktop/dev/blog/template/src/pages/auth/callback.ts) needs to:

```typescript
const OAUTH_TOKEN_URL = process.env.MOCK_OIDC_URL
  ? `${process.env.MOCK_OIDC_URL}/token`
  : 'https://oauth2.googleapis.com/token';

const OAUTH_USERINFO_URL = process.env.MOCK_OIDC_URL
  ? `${process.env.MOCK_OIDC_URL}/userinfo`
  : 'https://www.googleapis.com/oauth2/v3/userinfo';
```

This is **backwards-compatible** — when `MOCK_OIDC_URL` is not set (production), behaviour is identical to today.

---

## New Dependencies

```bash
npm install --save-dev \
  @playwright/test \
  testcontainers \
  @testcontainers/postgresql \
  express \
  @types/express
```

---

## npm Scripts to Add to `package.json`

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:report": "playwright show-report"
  }
}
```

---

## CI Integration (`.github/workflows/e2e.yml` — optional)

```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env:
          CI: true
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

> Docker must be available on the CI runner for Testcontainers to work. `ubuntu-latest` GitHub runners have Docker pre-installed.

---

## Open Questions

1. **Google OAuth mock strategy**: The mock OIDC approach tests the full callback flow but skips the real Google consent screen (unavoidable). Acceptable, or do you want tests to also inject a cookie directly (bypassing the browser flow) for speed in some fixture cases?

2. **OpenFGA in tests**: Permissive stub (all permission checks pass) for now, or spin up a real OpenFGA container from the start? Stub is faster; container is more faithful.

3. **Bcrypt hash in seed.sql**: Should we pre-compute the hash at build time (e.g., a small `tsx` script that generates `seed.sql` from a template), or hard-code the hash literal for `TestPassword123!` directly in the file?


---

## 📋 Implementation Status & Audit Checklist

**Historical status (superseded 2026-11-10)**: suite initially booted against
real containers with 30/60 green. The harness defects and remaining assertion
work listed in this original audit have since been resolved. The repaired suite
passed 65/65 at that point; see the implementation status at the top for the
latest result. **Testing Track**: E2E Quality Assurance.

- [x] Playwright test suite configuration (`playwright.config.ts`)
- [x] Testcontainers setup for PostgreSQL and Meilisearch isolation
- [x] Auth flow and session cookie simulation
- [x] API route contract testing fixtures
- [x] Global setup actually completes (see "Harness defects fixed" below) — it
      previously crashed before the first test, so no e2e result of any kind had
      been produced since the suite was written
- [x] The app under test is genuinely pointed at the Testcontainers (see
      "The suite was testing the developer's machine" below) — before this, every
      result was measured against a local database
- [x] Repair stale assertions and test-authoring defects; the repaired suite
      passed 65/65 on the local headless Chromium runner on 2026-11-10.
- [ ] Add a stable CI runner for this suite; no CI execution is claimed by the
      local test result.

### The suite was testing the developer's machine

The most consequential finding, and the reason 30 specs are green that were
previously red for the wrong reason.

Playwright starts `webServer` **before** it runs `globalSetup`. The container
ports are mapped at runtime, so they do not exist when the server is spawned, and
a `webServer.env` block can only carry values read from the environment at
config-load time. Every entry was therefore `process.env.X ?? ''` — frozen at its
pre-`globalSetup` value, i.e. empty. Observed in the spawned process:

```
MEILISEARCH_URL=          <- empty
DATABASE_URL=             <- empty
```

Empty is not inert. `src/lib/db.ts` and `src/lib/meilisearch.ts` both fall back to
the developer's own `.env`, so the app under test ran against the **local**
Postgres and Meilisearch rather than the containers. It then sent the container's
`MEILI_MASTER_KEY` to the local server, which rejected it, and search degraded
silently to a Postgres fallback. The visible symptom was an empty search result
list — nothing pointing at a wiring problem.

Two further consequences of the same root cause:

- The ReBAC e2e tests were passing against the developer's local OpenFGA, which
  already had a model deployed. The suite's own store had **no authorization
  model at all**, so every `check` failed with "No authorization models found" and
  the app failed *closed*. The suite had never once exercised its own engine.
- `reuseExistingServer: true` silently adopted a developer's own `astro dev` on
  4321, which is how the wrong-database bug stayed invisible. The suite now
  refuses to start if 4321 is occupied, and says why.

**Fix:** `globalSetup` spawns the app itself, after the containers exist, so the
child inherits the resolved ports; `globalTeardown` kills it. It also now writes
the OpenFGA authorization model and populates the Meilisearch index — both of
which had been assumed rather than done, and both of which are now verified by
reading back the document count and the model id.

### Harness defects fixed (all found by running the suite, none visible from reading it)

Every one of these presented as a *test* failure or a timeout somewhere unrelated
to itself:

1. **`Wait.withStatusCode` did not exist.** testcontainers renamed it to
   `forStatusCode`; the call threw `is not a function` in global setup.
2. **`__dirname` is undefined** — Playwright loads setup files as ESM. Both
   `join(__dirname, ...)` call sites were inside `try` blocks that only logged a
   warning, so migrations silently never ran and the first hard failure was a
   missing table much later.
3. **OpenFGA could not reach Postgres.** The DSN was built from
   `postgres.getHost()`, which is `localhost` — correct for the app on the host,
   wrong for a container, which resolves `localhost` to itself. It looped
   "waiting for postgres" until the 60 s wait strategy gave up.
4. **Only 4 of 12 migrations ran.** The list of migration filenames was
   hardcoded and had not been updated since 0005. Replaced with one
   `Migrator.up()` call.
5. **The one-shot `migrate` container was never awaited**, so `run` raced schema
   creation.
6. **`jwt.sign` was not a function.** `import * as jwt` over a CommonJS module
   in Playwright's CJS transpile puts the callable API on `.default`.
7. **The search index was never populated.** Meilisearch was started and left
   empty, so every search assertion was testing nothing. The sync also has to
   *wait* for the index task, since `addDocuments` is asynchronous.
8. **Fixtures violated the `users_id_format` CHECK** added by migration 0010 by
   using readable `user:testpassword` slugs.
9. **Fixtures seeded a resource type that does not exist.** `md` appears in no
   authorization model, no registry entry, and no production row (752 `document`,
   0 `md`), so every `check` against a seeded note failed with
   `type 'md' not found`. Renamed to `document`.
10. **Two real schema gaps**, found because the suite builds a database from
    `migrations/` alone:
    - `0007` did `ALTER TABLE groups` / `group_memberships`, but **no migration
      created them** — only `docker/postgres/init.sql` did. The migration chain
      could not build a schema from scratch.
    - `api_keys.is_revoked`, `last_used_ip` and `total_requests` existed only in
      the dev-only bootstrap DDL, while `validateApiKey` selects all three, so
      scoped API-key auth failed on any migrated database. Fixed by `0012`.

### Chrome duplication: verified, and the hypothesis was wrong

The chrome refactor renders the account menu and the search box twice — once in
the top bar, once in the sidebar/rail — and CSS picks the active one from
`data-chrome`. That made ~40 tests fail on strict-mode violations, and the
hypothesis was that a keyboard or screen-reader user also met each control twice.

**It is not true.** Measured in Chromium, authenticated, in all three chrome
modes: exactly one copy is ever laid out, and the other is `display:none` via an
ancestor — `offsetParent === null`, zero box, and `checkVisibility()` false, i.e.
removed from the tab order and the accessibility tree. The duplication is a *test*
concern only, so the tests use Playwright's `:visible` (mode-agnostic) instead of
naming a surface, and the shipped chrome was left alone.

Two things were found along the way, both real and both independent of the
duplication:

- **Ctrl+K was dead for the first ~500 ms of a page's life in `astro dev`**, where
  the `client:idle` island hydrates late. The production build binds immediately.
  The tests now retry the shortcut rather than sleeping, which keeps the fast path
  fast and stops the suite depending on a hydration latency nobody controls.
- **The account menu is stop #208 of 209 in the default chrome mode.** The exposed
  copy lives in the rail, which comes after the sidebar in DOM order, and the
  sidebar contains ~200 focusable stops (every folder and file has a "More
  actions" button). A keyboard user needs ~211 Tab presses to reach logout,
  account settings or the security controls. In `header` mode it is 11 presses.
  This is a genuine keyboard-accessibility defect and is still **open** — the
  standard fix is a roving tabindex on the explorer, which is also the
  "keyboard-navigable file explorer" item in the Quartz gap audit.
