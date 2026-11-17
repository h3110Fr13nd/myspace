/**
 * Process-level error handlers: the only errors in the system that never pass
 * through a route, a try/catch, or the middleware `recordHttp` hook.
 *
 * Without these, Node's default is to print a bare stack to stderr and — since
 * Node 15 — terminate the process on an unhandled rejection. A rejection in a
 * detached promise (a fire-and-forget cache write, a queue publish) therefore
 * takes the whole app down with a line that never reaches Loki, so the
 * container restarts and the operator sees a crash loop with no cause. Here the
 * event is logged as `fatal` with its stack, counted, and the process is kept
 * alive, so the failure is visible in the `foss_unhandled_errors_total` rate and
 * in the error dashboard instead of in a restart count.
 *
 * Set `PROCESS_FATAL_ERRORS=1` to restore Node's crash-on-rejection default
 * once a deployment has decided a rejection should take the process down.
 *
 * Installed once from `src/middleware.ts` (first request) and from
 * `instrumentation.ts` (process preload). The guard is on `globalThis`, not on a
 * module-level flag, because those two callers are separate bundles and would
 * otherwise each install a handler — double-counting every event.
 *
 * `unhandledErrors` is imported from `./observe`, which is deliberate but has a
 * cost worth knowing: the preload bundle therefore pulls in prom-client and
 * registers the default metrics before the app does. That is safe only because
 * metric registration is idempotent (see `./metrics`), which this file is the
 * reason that exists.
 *
 * See plan/core-architecture/32-observability-and-telemetry-stack.md §2.2
 */
import { logger } from './logger';
import { unhandledErrors } from './observe';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

const g = globalThis as { __fossProcessErrorHandlersInstalled?: boolean };

function describe(err: unknown): { type: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { type: err.name || 'Error', message: err.message, stack: err.stack };
  }
  return { type: typeof err, message: String(err) };
}

export function installProcessErrorHandlers(): void {
  if (g.__fossProcessErrorHandlersInstalled) return;
  g.__fossProcessErrorHandlersInstalled = true;

  const fatal = bool(process.env.PROCESS_FATAL_ERRORS);

  process.on('unhandledRejection', (reason) => {
    const { type, message, stack } = describe(reason);
    unhandledErrors.inc({ kind: 'unhandledRejection' });
    logger.fatal({ type, message, stack }, 'unhandled promise rejection');
    if (fatal) process.exitCode = 1;
  });

  process.on('uncaughtException', (err) => {
    const { type, message, stack } = describe(err);
    unhandledErrors.inc({ kind: 'uncaughtException' });
    logger.fatal({ type, message, stack }, 'uncaught exception');
    // Continuing after an uncaughtException is unsound in general — the process
    // state is unknown — so this one always stops, unlike a rejection.
    process.exit(1);
  });
}

function bool(value: string | undefined): boolean {
  if (!value) return false;
  return TRUTHY.has(value.toLowerCase());
}
