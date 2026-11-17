import { startObjectStorageMock } from './object-storage-mock';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers';
import { readFileSync } from 'fs';
import { dirname, join, sep } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';
import { createServer, type Server } from 'node:http';
import { Server as HocuspocusServer } from '@hocuspocus/server';

/**
 * Repo root, resolved from this file rather than `process.cwd()`.
 *
 * `__dirname` does not exist here: Playwright loads setup files as ESM, so the
 * CommonJS global is undefined and every `join(__dirname, ...)` threw a
 * ReferenceError. That was previously invisible — both call sites sat inside
 * `try` blocks whose `catch` only logged a warning, so migrations silently never
 * ran and the suite failed much later, somewhere unrelated. `import.meta.url`
 * works in both module systems.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');

function firstAllowedCpu(): string {
  const allowed = readFileSync('/proc/self/status', 'utf8')
    .match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1]?.trim();
  if (!allowed) throw new Error('Could not determine the CPUs available to the capacity test.');
  return allowed.split(',')[0].split('-')[0];
}

/**
 * Global E2E Test Setup
 *
 * Spins up fresh containers for each test run:
 *   1. PostgreSQL (pgvector) — mirrors docker-compose
 *   2. Meilisearch v1.8
 *   3. OpenFGA v1.5 (migrate then run)
 *
 * Runs DB migrations, seeds fixture data, then writes connection
 * strings to process.env so playwright.config.ts webServer picks them up.
 *
 * Containers are stored on global for teardown.
 */

declare global {
  // eslint-disable-next-line no-var
  var __TEST_CONTAINERS__: {
    postgres: StartedPostgreSqlContainer;
    meili: StartedTestContainer;
    valkey: StartedTestContainer;
    openfgaMigrate: StartedTestContainer | null;
    openfga: StartedTestContainer;
    network: Network;
  };
  /** The app server this run started, killed in globalTeardown. */
  // eslint-disable-next-line no-var
  var __E2E_APP_SERVER__: import('node:child_process').ChildProcess | undefined;
  // eslint-disable-next-line no-var
  var __E2E_RUNTIME_DIR__: string | undefined;
  // eslint-disable-next-line no-var
  var __E2E_APP_CONTAINER_NAME__: string | undefined;
  // eslint-disable-next-line no-var
  var __E2E_APP_IMAGE__: string | undefined;
  // eslint-disable-next-line no-var
  var __E2E_APP_ENV_FILE__: string | undefined;
  // eslint-disable-next-line no-var
  var __E2E_CONTENT_DIR__: string | undefined;
  // eslint-disable-next-line no-var
  var __E2E_CPU_PROFILE_DIR__: string | undefined;
  // eslint-disable-next-line no-var
  var __GOOGLE_OAUTH_MOCK__: Server | undefined;
  // eslint-disable-next-line no-var
  var __OBJECT_STORAGE_MOCK__: Server | undefined;
  // eslint-disable-next-line no-var
  var __COLLAB_WS_SERVER__: HocuspocusServer | undefined;
}

export default async function globalSetup() {
  console.log('\n🧪 [E2E Setup] Starting test containers...\n');
  const appPort = Number(process.env.E2E_APP_PORT || 4321);
  if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535) {
    throw new Error('E2E_APP_PORT must be a valid TCP port between 1024 and 65535.');
  }

  // Created first so Postgres can join it: OpenFGA runs as a container and needs
  // to reach the database over a Docker network, not through a host port.
  const network = await new Network().start();

  // ─── 1. PostgreSQL (pgvector) ──────────────────────────────────────────────
  const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('test_e2e_db')
    .withUsername('test_user')
    .withPassword('test_pass')
    .withHealthCheck({
      test: ['CMD-SHELL', 'pg_isready -U test_user -d test_e2e_db'],
      interval: 2_000,
      timeout: 5_000,
      retries: 10,
      startPeriod: 3_000,
    })
    .withNetwork(network)
    .withNetworkAliases('postgres')
    .start();

  // Host-side DSN, for the app under test and the migration scripts below. This
  // is deliberately NOT what OpenFGA gets — see step 3.
  const pgUrl = postgres.getConnectionUri();
  console.log(`  ✅ Postgres ready: ${pgUrl}`);

  // ─── 2. Meilisearch ───────────────────────────────────────────────────────
  const meili = await new GenericContainer('getmeili/meilisearch:v1.8')
    .withEnvironment({
      MEILI_MASTER_KEY: 'test_meili_key',
      MEILI_ENV: 'development',
    })
    .withExposedPorts(7700)
    .withWaitStrategy(Wait.forHttp('/health', 7700).forStatusCode(200))
    .start();

  const meiliUrl = `http://localhost:${meili.getMappedPort(7700)}`;
  console.log(`  ✅ Meilisearch ready: ${meiliUrl}`);

  // Keep auth and ACL-cache tests on a disposable Valkey instance rather than
  // silently disabling cache paths or reusing the developer's Compose cache.
  const valkey = await new GenericContainer('redis:7-alpine')
    .withResourcesQuota({ memory: 0.0625, cpu: 0.10 })
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forListeningPorts())
    .withNetwork(network)
    .withNetworkAliases('valkey')
    .start();
  const valkeyUrl = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
  console.log(`  ✅ Valkey ready: ${valkeyUrl}`);

  // ─── 3. OpenFGA — migrate then start ─────────────────────────────────────
  //
  // OpenFGA is a *container* talking to Postgres, so it cannot use the host-side
  // DSN: `getHost()` returns `localhost` with a mapped port, which is correct for
  // the app (it runs on the host) but from inside the OpenFGA container resolves
  // to OpenFGA itself. The engine then loops "waiting for postgres" and its
  // /healthz never answers, so the whole suite fails in global setup with a
  // timeout that looks nothing like a networking bug. Hence the explicit shared
  // network and the in-network address below.
  // Keep the E2E engine aligned with Compose: the app's bounded listing path
  // uses OpenFGA BatchCheck, which is absent from the old v1.5 test image.
  const openfgaImage = 'openfga/openfga:v1.22.0';
  const pgDsn = 'postgres://' + 'test_user' + ':' + 'test_pass' + '@postgres:5432/test_e2e_db?sslmode=disable';

  // Run migration job (a one-shot container that exits when the schema is ready).
  let openfgaMigrate: StartedTestContainer | null = null;
  try {
    openfgaMigrate = await new GenericContainer(openfgaImage)
      .withCommand(['migrate'])
      .withEnvironment({
        OPENFGA_DATASTORE_ENGINE: 'postgres',
        OPENFGA_DATASTORE_URI: pgDsn,
      })
      .withNetwork(network)
      // This is a one-shot job; wait for its exit status instead of matching a
      // version-specific log line that may disappear between OpenFGA releases.
      .withWaitStrategy(Wait.forOneShotStartup())
      .start();
    console.log('  ✅ OpenFGA migrations complete');
  } catch (e) {
    console.warn('  ⚠️  OpenFGA migrate step failed (continuing with permissive mode):', e);
  }

  const openfga = await new GenericContainer(openfgaImage)
    .withCommand(['run'])
    .withEnvironment({
      OPENFGA_DATASTORE_ENGINE: 'postgres',
      OPENFGA_DATASTORE_URI: pgDsn,
      OPENFGA_LOG_LEVEL: 'warn',
    })
    .withExposedPorts(8080, 8081)
    .withNetwork(network)
    .withNetworkAliases('openfga')
    .withWaitStrategy(Wait.forHttp('/healthz', 8080).forStatusCode(200))
    .start();

  const openfgaUrl = `http://localhost:${openfga.getMappedPort(8080)}`;
  console.log(`  ✅ OpenFGA ready: ${openfgaUrl}`);

  // ─── 4. Provision OpenFGA store ───────────────────────────────────────────
  let openfgaStoreId = '';
  try {
    const storeRes = await fetch(`${openfgaUrl}/stores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test_store' }),
    });
    const storeData = await storeRes.json() as { id: string };
    openfgaStoreId = storeData.id;
    console.log(`  ✅ OpenFGA store created: ${openfgaStoreId}`);
  } catch (e) {
    console.warn('  ⚠️  OpenFGA store creation failed (tests will use permissive fallback):', e);
  }

  // ─── 5. Write the authorization model into that store ─────────────────────
  //
  // A store with no model makes every `check` fail with "No authorization models
  // found", and the app fails *closed* — so every resource reads as "not
  // permitted" and the permission tests fail in a way that looks like a broken
  // ReBAC model rather than a missing fixture.
  //
  // This was invisible while the app was (incorrectly) talking to the developer's
  // local OpenFGA, which already had a model deployed: the ReBAC e2e tests were
  // passing against a completely different authorization engine than the one the
  // suite started.
  if (openfgaStoreId) {
    try {
      const { OpenFgaClient } = await import('@openfga/sdk');
      const { compileModel, findDeadRelations } = await import(join(repoRoot, 'src/lib/acl/compileModel.ts'));
      const dead = findDeadRelations();
      if (dead.length > 0) {
        throw new Error(`unreachable relations in the model spec: ${dead.map((d: any) => `${d.type}#${d.relation}`).join(', ')}`);
      }
      const client = new OpenFgaClient({ apiUrl: openfgaUrl, storeId: openfgaStoreId });
      const written = await client.writeAuthorizationModel(compileModel() as any);
      console.log(`  ✅ OpenFGA authorization model written: ${written.authorization_model_id}`);
    } catch (e) {
      console.warn('  ⚠️  OpenFGA model write failed — permission tests will fail closed:', e);
    }
  }

  // ─── 5. Run DB Migrations ─────────────────────────────────────────────────
  //
  // The real Migrator, in-process. This used to shell out twice
  // (`node -e "require('./scripts/migrate.ts')"`, then `tsx scripts/migrate.ts`)
  // and then apply a hardcoded list of four migration files by hand. Every layer
  // of that was broken or incomplete:
  //   - `require()` of a `.ts` file throws, and the `|| true` swallowed it;
  //   - migrations 0005 through 0011 were never applied, so the audit, audience,
  //     service-account and ACL-projection tables the app queries did not exist;
  //   - a hand-maintained filename list silently rots as migrations are added.
  // It is now one call, so the test schema is whatever the repo actually defines.
  const storage = await startObjectStorageMock();
  global.__OBJECT_STORAGE_MOCK__ = storage.server;
  process.env.S3_ENDPOINT = storage.endpoint;
  process.env.S3_ACCESS_KEY_ID = 'e2e-storage';
  process.env.S3_SECRET_ACCESS_KEY = 'e2e-storage-secret';
  process.env.S3_BUCKET_NAME = 'e2e-assets';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.DATABASE_URL = pgUrl;
  const { Migrator } = await import(join(repoRoot, 'src/lib/migrator.ts'));
  const migrator = new Migrator(pgUrl, join(repoRoot, 'migrations'));
  try {
    const res = await migrator.up();
    console.log(`  ✅ Migrations applied: ${res.applied.length}`);
  } finally {
    await migrator.close();
  }

  // ─── 6. Seed Fixture Data ─────────────────────────────────────────────────
  const pgClient = new Client({ connectionString: pgUrl });
  await pgClient.connect();
  try {
    const seedSql = readFileSync(join(repoRoot, 'tests/fixtures/seed.sql'), 'utf-8');
    await pgClient.query(seedSql);
    console.log('  ✅ Fixture data seeded');
  } finally {
    await pgClient.end();
  }

  // Keep the graph in step with the audience rows. `is_public` alone is not an
  // authorization grant; anonymous resource reads must pass through OpenFGA.
  if (openfgaStoreId) {
    process.env.OPENFGA_API_URL = openfgaUrl;
    process.env.OPENFGA_STORE_ID = openfgaStoreId;
    // An E2E run must not reuse another developer environment's ACL cache.
    process.env.REDIS_URL = valkeyUrl;
    const { OpenFgaClient } = await import('@openfga/sdk');
    const fga = new OpenFgaClient({ apiUrl: openfgaUrl, storeId: openfgaStoreId });
    await fga.write({
      writes: [
        { user: 'user:*', relation: 'viewer', object: 'document:public_hello' },
        { user: 'user:*', relation: 'viewer', object: 'document:notes_child' },
        { user: 'user:*', relation: 'viewer', object: 'canvas:public_test_canvas' },
        { user: 'user:44444444-4444-4444-8444-444444444444', relation: 'manage_grants', object: 'space:main' },
      ],
    });
    const publicCheck = await fga.check({
      user: 'user:anonymous',
      relation: 'viewer',
      object: 'document:public_hello',
    });
    if (!publicCheck.allowed) throw new Error('OpenFGA rejected the seeded public fixture grant');
    const { checkPermissionsBatch } = await import(join(repoRoot, 'src/lib/openfga.ts'));
    const batch = await checkPermissionsBatch({
      user: 'user:anonymous',
      relation: 'viewer',
      objects: ['document:public_hello'],
    });
    if (batch.get('document:public_hello') !== true) {
      throw new Error('OpenFGA BatchCheck rejected the seeded public fixture grant');
    }
    console.log('  ✅ Public fixture audience grant passes Check and BatchCheck');

    const capacityResourceCount = Number(process.env.E2E_SOAK_RESOURCE_COUNT || '0');
    if (!Number.isSafeInteger(capacityResourceCount) || capacityResourceCount < 0 || capacityResourceCount > 5_000) {
      throw new Error('E2E_SOAK_RESOURCE_COUNT must be an integer from 0 to 5000.');
    }
    if (capacityResourceCount > 0) {
      if (process.env.E2E_CAPACITY_MODE !== '1') {
        throw new Error('E2E_SOAK_RESOURCE_COUNT requires E2E_CAPACITY_MODE=1.');
      }
      const { seedCapacityDataset } = await import(join(repoRoot, 'tests/fixtures/seed-capacity.ts'));
      await seedCapacityDataset(pgUrl, fga, capacityResourceCount);
      const { reconcileProjection } = await import(join(repoRoot, 'src/lib/acl/projection.ts'));
      const projection = await reconcileProjection();
      if (projection.truncated) throw new Error('Capacity fixture ACL projection was truncated.');
      console.log(`  ✅ Capacity dataset seeded (${capacityResourceCount} public notes; ACL projection ${projection.rows} rows)`);
    }
  }

  // ─── 7. Populate the search index ─────────────────────────────────────────
  //
  // Meilisearch was started but never given anything to search, so every search
  // assertion was testing an empty index: the suite could only ever have failed.
  //
  // Two env subtleties, both learned the hard way:
  //   - `MEILI_MASTER_KEY` is checked *before* `MEILISEARCH_KEY` in
  //     src/lib/meilisearch.ts, and a developer's local `.env` usually sets it.
  //     Setting only MEILISEARCH_KEY therefore authenticates with the wrong key and
  //     the sync dies on "API key is invalid". Set both.
  //   - the same module reads the URL at module scope, so the env must be assigned
  //     before the first import.
  process.env.MEILISEARCH_URL = meiliUrl;
  process.env.MEILISEARCH_KEY = 'test_meili_key';
  process.env.MEILI_MASTER_KEY = 'test_meili_key';
  let indexed = 0;
  try {
    const { syncMeilisearch } = await import(join(repoRoot, 'scripts/sync_meilisearch.ts'));
    await syncMeilisearch();

    // Two things make a naive check here report zero and look like a failure:
    //   - `syncMeilisearch` catches and logs its own errors, so it resolving does
    //     not mean it worked;
    //   - Meilisearch indexing is asynchronous. `addDocuments` returns a task, and
    //     the document count stays 0 until that task is processed. Asking straight
    //     away therefore reads 0 on a perfectly good index.
    // So poll the real count until it moves, bounded.
    const { meiliClient, RESOURCES_INDEX } = await import(join(repoRoot, 'src/lib/meilisearch.ts'));
    const index = meiliClient.index(RESOURCES_INDEX);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        indexed = (await index.getStats()).numberOfDocuments;
      } catch {
        // Index may not exist yet; the sync creates it.
      }
      if (indexed > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (e) {
    console.warn('  ⚠️  Search index sync threw (search tests will fail):', e);
  }
  if (indexed > 0) {
    console.log(`  ✅ Search index populated (${indexed} documents)`);
  } else {
    // Loud, because a silent zero here is what made these tests unfixable-looking.
    console.warn('  ⚠️  Search index is EMPTY — the ~10 search tests will fail');
  }

  // ─── 8. Write env vars for webServer + tests ─────────────────────────────
  process.env.DATABASE_URL = pgUrl;
  process.env.MEILISEARCH_URL = meiliUrl;
  process.env.MEILISEARCH_KEY = 'test_meili_key';
  process.env.OPENFGA_API_URL = openfgaUrl;
  process.env.OPENFGA_STORE_ID = openfgaStoreId;
  process.env.GOOGLE_CLIENT_ID = 'mock_client_id';
  process.env.GOOGLE_CLIENT_SECRET = 'mock_client_secret';
  process.env.GOOGLE_REDIRECT_URI = `http://localhost:${appPort}/auth/callback`;
  const oauthMock = createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (requestUrl.pathname === '/authorize') {
      const callback = new URL(requestUrl.searchParams.get('redirect_uri') || `http://localhost:${appPort}/auth/callback`);
      const email = (requestUrl.searchParams.get('login_hint') || 'dummy_mail').toLowerCase();
      const code = email === 'dummy_mail' ? 'mock_dual_code'
        : email === 'dummy_mail' ? 'mock_unverified_code'
        : 'mock_auth_code_e2e';
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', requestUrl.searchParams.get('state') || 'auth');
      res.writeHead(302, { Location: callback.toString() }).end();
      return;
    }
    if (requestUrl.pathname === '/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const code = new URLSearchParams(body).get('code') || '';
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        access_token: code,
        token_type: 'Bearer',
        expires_in: 3600,
      }));
      return;
    }
    if (requestUrl.pathname === '/userinfo') {
      const code = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
      const profile = code === 'mock_dual_code'
        ? { id: 'google_dual_user_456', email: 'dummy_mail', verified_email: true, name: 'DUMMY_NAME' }
        : code === 'mock_unverified_code'
          ? { id: 'unverified_google_user', email: 'dummy_mail', verified_email: false, name: 'DUMMY_NAME' }
          : { id: 'google_test_user_123', email: 'dummy_mail', verified_email: true, name: 'DUMMY_NAME' };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(profile));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    oauthMock.once('error', reject);
    oauthMock.listen(0, '127.0.0.1', resolve);
  });
  const oauthPort = (oauthMock.address() as import('node:net').AddressInfo).port;
  global.__GOOGLE_OAUTH_MOCK__ = oauthMock;
  process.env.GOOGLE_AUTH_URL = `http://127.0.0.1:${oauthPort}/authorize`;
  process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${oauthPort}/token`;
  process.env.GOOGLE_USERINFO_URL = `http://127.0.0.1:${oauthPort}/userinfo`;
  const collabServer = new HocuspocusServer({ port: 0, quiet: true });
  await collabServer.listen();
  const collabPort = collabServer.address.port;
  global.__COLLAB_WS_SERVER__ = collabServer;
  process.env.COLLAB_WS_URL = `ws://127.0.0.1:${collabPort}`;
  process.env.JWT_SECRET = 'mock_dev_jwt_secret_for_tests';
  process.env.SEARCH_ENGINE = 'meilisearch';
  // Set here rather than in playwright.config's webServer `env`, because the
  // config is evaluated before this function runs — anything read there is frozen
  // at its pre-globalSetup value. The webServer inherits from this process, so
  // assigning here is what actually reaches the app.
  // E2E exercises the same optimized client bundles as production. The explicit
  // flag keeps OAuth mock routing independent of NODE_ENV.
  process.env.NODE_ENV = 'production';
  process.env.E2E_TEST_MODE = '1';

  // Store refs for teardown
  global.__TEST_CONTAINERS__ = { postgres, meili, valkey, openfgaMigrate, openfga, network };

  // ─── 9. Start the app under test ──────────────────────────────────────────
  //
  // This has to happen here, not via Playwright's `webServer`, and the reason is
  // ordering: Playwright starts `webServer` *before* it runs `globalSetup`. So the
  // container URLs this function computes do not exist yet when the server is
  // spawned, and a `webServer.env` block can only carry values read from the
  // environment at config-load time — i.e. stale ones. In practice that produced
  // an app with `MEILISEARCH_URL` empty, which silently fell back to the
  // developer's own `.env` and ran the entire suite against their *local*
  // Postgres and Meilisearch instead of the containers. Search then reported
  // "API key is invalid" and the tests showed an empty result list, which pointed
  // nowhere near the real cause.
  //
  // Spawning here means the child inherits `process.env`, which by this point
  // holds the container URLs this function just resolved.
  if (process.env.TEST_APP_URL) {
    console.log(`\n🌐 Using an already-running app at ${process.env.TEST_APP_URL}\n`);
    return;
  }

  if (await isListening(appPort)) {
    // Refuse rather than reuse. Reusing is what made the wrong-database bug
    // invisible: a developer's own `astro dev` on 4321 was silently adopted, so
    // the suite passed or failed against an environment nobody was looking at.
    throw new Error(
      `Port ${appPort} is already in use, so the e2e suite cannot start its own app server.\n` +
        `Stop the process listening on ${appPort} or choose another E2E_APP_PORT and re-run.\n` +
        'If you want to test an already-running app, set TEST_APP_URL instead — but\n' +
        'note that app must already point at this run\'s containers, or the suite\n' +
        'will silently exercise your local database instead.',
    );
  }

  const { execFileSync, spawn } = await import('node:child_process');
  const astroCli = join(repoRoot, 'node_modules/astro/bin/astro.mjs');
  const appEnv = { ...process.env, HOST: '127.0.0.1' };
  const constrainedCapacityRun = process.env.E2E_CAPACITY_MODE === '1';
  let capacityAppCpuLimit = '0.60';
  console.log('\n🏗️ [E2E Setup] Building production client and server...\n');
  execFileSync(process.execPath, [astroCli, 'build'], {
    cwd: repoRoot,
    env: appEnv,
    stdio: 'inherit',
  });

  // Serve an immutable copy: a concurrent local build must not replace route
  // chunks while this E2E server is importing them. PDFs are user content, not
  // build output; copying the large, mutable directory was slow and could race
  // a content sync. Point the runtime copy at its canonical public directory.
  const runtimeDir = join(repoRoot, 'node_modules/.cache', `e2e-runtime-${process.pid}`);
  const fs = await import('node:fs/promises');
  await fs.rm(runtimeDir, { recursive: true, force: true });
  await fs.mkdir(runtimeDir, { recursive: true });
  const sourceDist = join(repoRoot, 'dist');
  const sourcePdfs = join(sourceDist, 'client/pdfs');
  const runtimeDist = join(runtimeDir, 'dist');
  await fs.cp(sourceDist, runtimeDist, {
    recursive: true,
    filter: (source) => source !== sourcePdfs && !source.startsWith(`${sourcePdfs}${sep}`),
  });
  const runtimePdfs = join(runtimeDist, 'client/pdfs');
  await fs.mkdir(dirname(runtimePdfs), { recursive: true });
  await fs.symlink(join(repoRoot, 'public/pdfs'), runtimePdfs, 'dir');
  await fs.access(join(runtimeDist, 'server/entry.mjs'));
  global.__E2E_RUNTIME_DIR__ = runtimeDir;

  let appServer: import('node:child_process').ChildProcess;
  if (constrainedCapacityRun) {
    // Capacity tests use the same per-service ceilings as the default Compose
    // stack, pinned to one CPU so host core count cannot hide serving contention.
    // Test data and volumes remain disposable Testcontainers resources.
    const capacityCpuSet = process.env.E2E_CAPACITY_CPUSET || firstAllowedCpu();
    if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(capacityCpuSet)) {
      throw new Error('E2E_CAPACITY_CPUSET must be a Docker CPU set such as "2" or "2-3".');
    }
    const cpuLimits = {
      app: process.env.E2E_APP_CPU_LIMIT || '0.60',
      postgres: process.env.E2E_POSTGRES_CPU_LIMIT || '0.20',
      openfga: process.env.E2E_OPENFGA_CPU_LIMIT || '0.08',
      meilisearch: process.env.E2E_MEILISEARCH_CPU_LIMIT || '0.05',
      valkey: process.env.E2E_VALKEY_CPU_LIMIT || '0.05',
    };
    capacityAppCpuLimit = cpuLimits.app;
    if (Object.values(cpuLimits).some((value) => !/^\d+(?:\.\d+)?$/.test(value)) ||
        Object.values(cpuLimits).reduce((sum, value) => sum + Number(value), 0) > 1) {
      throw new Error('Capacity CPU limits must be valid numbers totaling no more than 1.0.');
    }
    for (const [containerId, cpus, memory] of [
      [postgres.getId(), cpuLimits.postgres, '256m'],
      [openfga.getId(), cpuLimits.openfga, '96m'],
      [meili.getId(), cpuLimits.meilisearch, '160m'],
      [valkey.getId(), cpuLimits.valkey, '64m'],
    ]) {
      execFileSync('docker', [
        'update', `--cpus=${cpus}`, `--memory=${memory}`, `--memory-swap=${memory}`, containerId,
        `--cpuset-cpus=${capacityCpuSet}`,
      ], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
    }

    const image = `foss-content-workspace:e2e-capacity-${process.pid}`;
    const containerName = `workspace-e2e-capacity-${process.pid}`;
    const envFile = join(repoRoot, 'node_modules/.cache', `e2e-app-${process.pid}.env`);
    const writableContentDir = join(repoRoot, 'node_modules/.cache', `e2e-content-${process.pid}`);
    await fs.rm(writableContentDir, { recursive: true, force: true });
    await fs.mkdir(writableContentDir, { recursive: true, mode: 0o777 });
    await fs.chmod(writableContentDir, 0o777);
    global.__E2E_CONTENT_DIR__ = writableContentDir;
    const cpuProfileEnabled = process.env.E2E_CPU_PROFILE === '1';
    const cpuProfileDir = cpuProfileEnabled
      ? join(repoRoot, 'node_modules/.cache', `e2e-cpu-profile-${process.pid}`)
      : undefined;
    if (cpuProfileDir) {
      await fs.mkdir(cpuProfileDir, { recursive: true, mode: 0o777 });
      await fs.chmod(cpuProfileDir, 0o777);
      // This preload starts and stops V8's inspector profiler around the
      // traffic window. It is never loaded by the normal app.
      await fs.writeFile(
        join(cpuProfileDir, 'profile-control.cjs'),
        `const inspector = require('node:inspector');
const fs = require('node:fs');
const path = require('node:path');
const outputDir = '/tmp/e2e-cpu-profile';
let session;
const writeProfile = (name, profile) => {
  if (profile) fs.writeFileSync(path.join(outputDir, name), JSON.stringify(profile));
};
process.on('SIGUSR1', () => {
  if (session) return;
  session = new inspector.Session();
  session.connect();
  session.post('Profiler.enable', (enableError) => {
    if (enableError) { session.disconnect(); session = undefined; return; }
    session.post('HeapProfiler.startSampling', { samplingInterval: 32768 }, (heapError) => {
      if (heapError) { session.disconnect(); session = undefined; return; }
      session.post('Profiler.start', (startError) => {
        if (!startError) fs.writeFileSync(path.join(outputDir, 'started'), String(Date.now()));
      });
    });
  });
});
process.on('SIGUSR2', () => {
  if (!session) return;
  session.post('Profiler.stop', (stopError, result) => {
    if (!stopError) writeProfile('load.cpuprofile', result?.profile);
    session.post('HeapProfiler.stopSampling', (heapError, heapResult) => {
      if (!heapError) writeProfile('load.heapprofile', heapResult?.profile);
      session.post('Profiler.disable', () => { session.disconnect(); session = undefined; });
    });
  });
});
`,
      );
      global.__E2E_CPU_PROFILE_DIR__ = cpuProfileDir;
      process.env.E2E_CPU_PROFILE_DIR = cpuProfileDir;
    }
    const runtimeEnv = {
      NODE_ENV: 'production',
      NODE_OPTIONS: [
        '--max-old-space-size=192',
        '--max-semi-space-size=8',
        '--import=/app/dist/instrumentation.mjs',
        ...(cpuProfileEnabled ? ['--require=/tmp/e2e-cpu-profile/profile-control.cjs'] : []),
      ].join(' '),
      HOST: '127.0.0.1',
      PORT: String(appPort),
      S3_ENDPOINT: process.env.S3_ENDPOINT!,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID!,
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY!,
      S3_BUCKET_NAME: process.env.S3_BUCKET_NAME!,
      S3_REGION: process.env.S3_REGION!,
      S3_FORCE_PATH_STYLE: 'true',
      DATABASE_URL: process.env.DATABASE_URL!,
      OPENFGA_API_URL: process.env.OPENFGA_API_URL!,
      OPENFGA_STORE_ID: process.env.OPENFGA_STORE_ID!,
      MEILISEARCH_URL: process.env.MEILISEARCH_URL!,
      MEILISEARCH_KEY: process.env.MEILISEARCH_KEY!,
      REDIS_URL: process.env.REDIS_URL!,
      SEARCH_ENGINE: 'meilisearch',
      JWT_SECRET: process.env.JWT_SECRET!,
      E2E_TEST_MODE: '1',
      // Tracing is off in the constrained app test by default. Set
      // E2E_OTEL_ENABLED=1 to send sampled diagnostics to the optional local
      // collector; that collector is deliberately outside serving measurements.
      OTEL_ENABLED: process.env.E2E_OTEL_ENABLED === '1' ? 'true' : 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: process.env.E2E_OTEL_ENABLED === '1'
        ? process.env.E2E_OTEL_ENDPOINT || 'http://127.0.0.1:4318'
        : '',
      OTEL_TRACES_SAMPLER_ARG: process.env.E2E_OTEL_SAMPLE_RATIO || '0.05',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI!,
      GOOGLE_AUTH_URL: process.env.GOOGLE_AUTH_URL!,
      GOOGLE_TOKEN_URL: process.env.GOOGLE_TOKEN_URL!,
      GOOGLE_USERINFO_URL: process.env.GOOGLE_USERINFO_URL!,
      COLLAB_WS_URL: process.env.COLLAB_WS_URL!,
    };
    await fs.writeFile(
      envFile,
      Object.entries(runtimeEnv).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
      { mode: 0o600 },
    );
    global.__E2E_APP_ENV_FILE__ = envFile;
    global.__E2E_APP_IMAGE__ = image;
    global.__E2E_APP_CONTAINER_NAME__ = containerName;
    process.env.E2E_CAPACITY_CONTAINERS_JSON = JSON.stringify([
      { service: 'app', container: containerName },
      { service: 'postgres', container: postgres.getId() },
      { service: 'openfga', container: openfga.getId() },
      { service: 'meilisearch', container: meili.getId() },
      { service: 'valkey', container: valkey.getId() },
    ]);

    console.log('\n📦 [E2E Setup] Building the production app image for constrained capacity testing...\n');
    execFileSync('docker', ['build', '--target', 'runner', '--tag', image, repoRoot], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    appServer = spawn('docker', [
      'run', '--rm', '--init', '--network=host', `--cpus=${cpuLimits.app}`, '--memory=256m',
      `--cpuset-cpus=${capacityCpuSet}`, '--user', '1000:1000',
      ...(cpuProfileDir ? ['--mount', `type=bind,source=${cpuProfileDir},target=/tmp/e2e-cpu-profile`] : []),
      '--name', containerName, '--env-file', envFile,
      '--mount', `type=bind,source=${writableContentDir},target=/app/content`,
      image,
    ], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    appServer = spawn(process.execPath, [join(runtimeDir, 'dist/server/entry.mjs')], {
      cwd: repoRoot,
      env: { ...appEnv, HOST: '127.0.0.1', PORT: String(appPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  // Surface app output; otherwise a hydration or config failure inside the app is
  // invisible and shows up only as a mysterious assertion failure.
  const relay = (stream: NodeJS.ReadableStream, tag: string) => {
    stream.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) console.log(`[WebServer] ${tag} ${line}`);
      }
    });
  };
  relay(appServer.stdout, '');
  relay(appServer.stderr, '');

  const ready = await waitForListener(appPort, 120_000);
  if (!ready) {
    appServer.kill('SIGKILL');
    if (global.__E2E_APP_CONTAINER_NAME__) {
      execFileSync('docker', ['stop', global.__E2E_APP_CONTAINER_NAME__], { stdio: 'ignore' });
    }
    await fs.rm(runtimeDir, { recursive: true, force: true });
    await fs.rm(writableContentDir, { recursive: true, force: true });
    if (global.__E2E_APP_ENV_FILE__) await fs.rm(global.__E2E_APP_ENV_FILE__, { force: true });
    if (global.__E2E_APP_IMAGE__) {
      execFileSync('docker', ['image', 'rm', global.__E2E_APP_IMAGE__], { stdio: 'ignore' });
    }
    global.__E2E_RUNTIME_DIR__ = undefined;
    throw new Error(`The e2e app server did not start listening on ${appPort} within 120s.`);
  }
  global.__E2E_APP_SERVER__ = appServer;
  console.log(constrainedCapacityRun
    ? `  ✅ App container listening on ${appPort} (${capacityAppCpuLimit} CPU / 256 MiB; dependencies capped to the Compose budget; serving containers pinned to one CPU)`
    : `  ✅ App server listening on ${appPort} (pointed at the test containers)`);
  if (global.__E2E_CPU_PROFILE_DIR__) {
    console.log(`  📈 Node CPU profile will be saved under ${global.__E2E_CPU_PROFILE_DIR__}`);
  }
  console.log('\n🚀 [E2E Setup] All containers ready. Starting Playwright...\n');
}

/** True if something is already accepting connections on `port`. */
async function isListening(port: number): Promise<boolean> {
  const net = await import('net');
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (result: boolean) => {
      sock.destroy();
      resolve(result);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), 1_000);
  });
}

/** Poll until `port` accepts a connection, or the deadline passes. */
async function waitForListener(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isListening(port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
