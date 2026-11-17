import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';
import { fgaClient } from '../../../lib/openfga';
import { cachePing } from '../../../lib/cache';
import { auditReady } from '../../../lib/audit';
import { config } from '../../../lib/config';

/**
 * Readiness probe for orchestrators (k8s/ECS/compose healthcheck).
 * 200 when db + openfga are reachable; redis/audit are optional and reported.
 */
export const GET: APIRoute = async () => {
  const checks: Record<string, { status: string }> = {};

  try {
    await query('SELECT 1');
    checks.database = { status: 'healthy' };
  } catch {
    checks.database = { status: 'down' };
  }

  try {
    await fgaClient.read({}, { pageSize: 1 });
    checks.openfga = { status: 'healthy' };
  } catch {
    checks.openfga = { status: 'down' };
  }

  if (config.redisUrl) {
    checks.redis = { status: (await cachePing()) ? 'healthy' : 'down' };
  } else {
    checks.redis = { status: 'skipped' };
  }

  checks.audit = { status: (await auditReady()) ? 'healthy' : 'degraded' };

  const ready =
    checks.database.status === 'healthy' && checks.openfga.status === 'healthy';

  return new Response(
    JSON.stringify({ status: ready ? 'ready' : 'not_ready', checks, ts: new Date().toISOString() }),
    {
      status: ready ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  );
};