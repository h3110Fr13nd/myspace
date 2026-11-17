import { rm } from 'node:fs/promises';

export default async function globalTeardown() {
  const containers = global.__TEST_CONTAINERS__;
  const { execFileSync } = await import('node:child_process');

  console.log('\n🧹 [E2E Teardown] Stopping test containers...');

  if (global.__E2E_APP_CONTAINER_NAME__) {
    try {
      execFileSync('docker', ['stop', global.__E2E_APP_CONTAINER_NAME__], { stdio: 'ignore' });
    } catch {
      // The capacity app may already have stopped itself after an OOM or error.
    }
  }

  // The app server first: it holds pooled connections to Postgres and OpenFGA,
  // and leaving it running while those are torn down only produces noisy errors.
  if (global.__E2E_APP_SERVER__) {
    const appServer = global.__E2E_APP_SERVER__;
    try {
      await new Promise<void>((resolve) => {
        const forceStop = setTimeout(() => {
          appServer.kill('SIGKILL');
          resolve();
        }, 5_000);
        forceStop.unref();
        appServer.once('exit', () => {
          clearTimeout(forceStop);
          resolve();
        });
        if (!appServer.kill('SIGTERM')) {
          clearTimeout(forceStop);
          resolve();
        }
      });
    } catch {
      // Already gone.
    }
  }

  if (global.__GOOGLE_OAUTH_MOCK__) {
    await new Promise<void>((resolve) => global.__GOOGLE_OAUTH_MOCK__!.close(() => resolve()));
  }
  if (global.__OBJECT_STORAGE_MOCK__) {
    global.__OBJECT_STORAGE_MOCK__.closeAllConnections();
    await new Promise<void>(resolve => global.__OBJECT_STORAGE_MOCK__!.close(() => resolve()));
  }
  await global.__COLLAB_WS_SERVER__?.destroy();

  if (containers) {
    await Promise.allSettled([
      containers.postgres?.stop(),
      containers.meili?.stop(),
      containers.valkey?.stop(),
      containers.openfgaMigrate?.stop(),
      containers.openfga?.stop(),
    ]);

    // Last: the network still has attached containers until the stops above settle.
    await Promise.allSettled([containers.network?.stop()]);
  }

  if (global.__E2E_RUNTIME_DIR__) {
    await rm(global.__E2E_RUNTIME_DIR__, { recursive: true, force: true });
  }
  if (global.__E2E_APP_ENV_FILE__) {
    await rm(global.__E2E_APP_ENV_FILE__, { force: true });
  }
  if (global.__E2E_CONTENT_DIR__) {
    await rm(global.__E2E_CONTENT_DIR__, { recursive: true, force: true });
  }
  if (global.__E2E_APP_IMAGE__) {
    try {
      execFileSync('docker', ['image', 'rm', global.__E2E_APP_IMAGE__], { stdio: 'ignore' });
    } catch {
      // Keep teardown best effort if Docker already removed the temporary tag.
    }
  }

  console.log('  ✅ All containers stopped.\n');
}
