import type { APIRoute } from 'astro';
import { APP_VERSION, BUILD_TIMESTAMP, getGitCommitSha } from '../../../lib/version';
import { query } from '../../../lib/db';
import { fgaClient } from '../../../lib/openfga';
import { cachePing } from '../../../lib/cache';
import { config } from '../../../lib/config';

export const GET: APIRoute = async () => {
  const startTime = Date.now();

  // 1. Check Database
  let dbStatus = 'down';
  let dbLatencyMs: number | null = null;
  try {
    const dbStart = Date.now();
    await query('SELECT 1');
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = 'healthy';
  } catch (e: any) {
    dbStatus = `error: ${e.message}`;
  }

  // 2. Check OpenFGA
  let fgaStatus = 'down';
  let fgaLatencyMs: number | null = null;
  try {
    const fgaStart = Date.now();
    await fgaClient.read({}, { pageSize: 1 });
    fgaLatencyMs = Date.now() - fgaStart;
    fgaStatus = 'healthy';
  } catch (e: any) {
    fgaStatus = `error: ${e.message}`;
  }

  const isHealthy = dbStatus === 'healthy' && (fgaStatus === 'healthy' || fgaStatus === 'down');
  const commit = getGitCommitSha();

  const redisStatus = config.redisUrl
    ? (await cachePing()) ? 'healthy' : 'down'
    : 'disabled';

  return new Response(
    JSON.stringify({
      status: isHealthy ? 'ok' : 'degraded',
      version: APP_VERSION,
      commit,
      buildTime: BUILD_TIMESTAMP,
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'production',
      services: {
        database: { status: dbStatus, latencyMs: dbLatencyMs },
        openfga: { status: fgaStatus, latencyMs: fgaLatencyMs },
        redis: { status: redisStatus },
      },
      responseLatencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }),
    {
      status: isHealthy ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  );
};
