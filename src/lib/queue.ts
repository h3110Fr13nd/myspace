/**
 * Async job queue on BullMQ (Valkey/Redis-backed).
 *
 * - `config.queue` OFF (default): `enqueue` falls back to synchronous execution
 *   so behavior is identical to today.
 * - `config.queue` ON: jobs go to the queue; the standalone `scripts/worker.ts`
 *   process drains them.
 * Every consumer must be registered via `registerWorker` so the standalone
 * worker and synchronous fallback use the same handlers.
 */
import type { Queue, JobsOptions, ConnectionOptions } from 'bullmq';
import { config } from './config';
import { logger } from './logger';

export const JOB_INDEX_RESOURCE = 'index-resource';

/** Always returns an object so BullMQ types stay happy; only used when enabled. */
function bullConnection(): ConnectionOptions {
  if (config.redisUrl) {
    try {
      const u = new URL(config.redisUrl);
      return {
        host: u.hostname,
        port: Number(u.port || 6379),
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
      };
    } catch {
      /* fall through to safe default */
    }
  }
  return { host: '127.0.0.1', port: 6379 };
}

const connection = bullConnection();

let queuePromise: Promise<Queue> | null = null;

function getQueue(): Promise<Queue> | null {
  if (!config.queue || !config.redisUrl) return null;
  if (!queuePromise) {
    queuePromise = import('bullmq').then(({ Queue: BullQueue }) => new BullQueue('foss-jobs', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 60 * 60 * 24 }, // keep 24h for DLQ-review
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    }));
  }
  return queuePromise;
}

type JobHandler<T> = (payload: T) => Promise<void>;
const handlers = new Map<string, JobHandler<any>>();

/** Register a job consumer. Idempotent. */
export function registerWorker<T extends Record<string, unknown>>(
  name: string,
  handler: JobHandler<T>
): void {
  handlers.set(name, handler);
}

/**
 * Enqueue a job for processing. If the queue is disabled or Redis is down,
 * runs the handler inline (synchronous fallback = existing behavior). Never
 * throws — failures are logged and swallowed.
 */
export async function enqueue<T extends Record<string, unknown>>(
  name: string,
  payload: T,
  options?: JobsOptions
): Promise<void> {
  const handler = handlers.get(name);
  let q: Queue | null;
  try {
    q = await getQueue();
  } catch (err) {
    logger.warn({ err: (err as Error).message, name }, '[queue] initialization failed — sync fallback');
    q = null;
  }

  if (!q) {
    if (handler) {
      // Synchronous fallback — keep the request path working without Redis.
      try {
        await handler(payload);
      } catch (err) {
        logger.warn({ err: (err as Error).message, name }, '[queue] sync fallback failed');
      }
    }
    return;
  }

  try {
    await q.add(name, payload, options);
  } catch (err) {
    logger.warn({ err: (err as Error).message, name }, '[queue] enqueue failed — sync fallback');
    if (handler) {
      try {
        await handler(payload);
      } catch {
        /* already logged */
      }
    }
  }
}

/** Start the worker drain loop in the standalone worker process. */
export async function startWorkers(): Promise<void> {
  if (!config.redisUrl) {
    logger.warn('[queue] no REDIS_URL — worker disabled (sync fallback active)');
    return;
  }
  const { Worker } = await import('bullmq');
  const worker = new Worker(
    'foss-jobs',
    async (job) => {
      const handler = handlers.get(job.name);
      if (!handler) {
        logger.warn({ name: job.name }, '[queue] no handler registered — dropping job');
        return;
      }
      try {
        await handler(job.data);
      } catch (err) {
        logger.error({ err: (err as Error).message, name: job.name }, '[queue] job failed');
        throw err; // BullMQ retry/backoff/DLQ semantics
      }
    },
    {
      connection,
      concurrency: 8,
    }
  );
  worker.on('error', (err) => logger.warn({ err: err.message }, '[queue] worker error'));
  logger.info('[queue] worker started');
}
