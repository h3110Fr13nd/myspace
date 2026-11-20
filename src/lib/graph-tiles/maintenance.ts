/**
 * Background refresh of the tiled graph, run by the standalone worker.
 *
 * Deliberately *not* a queue job: `enqueue` falls back to running handlers
 * inline in the caller when the queue is off, and a graph build must never run
 * inside the app process. The worker polls instead — one tiny indexed query
 * per interval — and rebuilds scopes that have been dirty for longer than the
 * settle window, so a burst of edits costs one build, not one per edit.
 *
 * Disable with GRAPH_TILES=off.
 */
import pool from '../db';
import { logger } from '../logger';
import { buildGraphTiles } from './builder';

export interface MaintenanceOptions {
  intervalMs?: number;
  /** How long a scope must stay dirty before it is rebuilt (debounce). */
  settleMs?: number;
}

export function startGraphMaintenance(options: MaintenanceOptions = {}): () => void {
  if (process.env.GRAPH_TILES === 'off') {
    logger.info('[graph-tiles] maintenance disabled (GRAPH_TILES=off)');
    return () => {};
  }
  const interval = options.intervalMs ?? Number(process.env.GRAPH_TILES_INTERVAL_MS ?? 30_000);
  const settle = options.settleMs ?? Number(process.env.GRAPH_TILES_SETTLE_MS ?? 20_000);
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*) FROM graph_scopes) AS scopes,
           (SELECT count(*) FROM graph_scopes
             WHERE built_at IS NULL
                OR (dirty_at > built_at AND dirty_at < NOW() - ($1::int * interval '1 millisecond'))) AS due,
           EXISTS (SELECT 1 FROM resources LIMIT 1) AS has_resources`,
        [settle]
      );
      const { scopes, due, has_resources: hasResources } = rows[0] ?? {};
      const firstBuild = Number(scopes) === 0 && hasResources;
      if (!firstBuild && Number(due) === 0) return;
      const report = await buildGraphTiles({ pool, scopes: 'dirty' });
      logger.info(
        {
          resources: report.resources,
          placed: report.placed,
          scopes: report.scopes.map((s) => `${s.scope.startsWith('owner:') ? 'owner' : s.scope}:${s.nodes}`),
          ms: report.totalMs,
        },
        '[graph-tiles] rebuilt'
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[graph-tiles] rebuild skipped');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), interval);
  timer.unref?.();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
