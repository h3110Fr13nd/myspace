/**
 * Standalone queue worker process.
 * Run with: npm run worker
 * Consumers (src/lib/jobs.ts) must be imported for their top-level
 * `registerWorker` side effects to take effect.
 */
import 'dotenv/config';
import { startWorkers } from '../src/lib/queue';
import { logger } from '../src/lib/logger';
import { startGraphMaintenance } from '../src/lib/graph-tiles/maintenance';

// Import job consumers — their `registerWorker` calls run on import.
import '../src/lib/jobs';

async function main(): Promise<void> {
  logger.info('[worker] booting');
  await startWorkers();
  // Tiled graph refresh runs here, never in the app process (see maintenance.ts).
  startGraphMaintenance();
  logger.info('[worker] draining foss-jobs queue (ctrl-c to stop)');
}

main().catch((err) => {
  logger.error({ err }, '[worker] fatal error');
  process.exit(1);
});