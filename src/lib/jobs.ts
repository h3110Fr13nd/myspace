/**
 * Job consumers for the `foss-jobs` queue.
 *
 * Importing this module registers every consumer (top-level side effect), so
 * the standalone worker (scripts/worker.ts) gets the same handlers that `enqueue`
 * runs inline when the queue/Redis is unavailable.
 */
import { registerWorker, enqueue, JOB_INDEX_RESOURCE } from './queue';
import { meiliClient, RESOURCES_INDEX, type MeiliResourceDocument } from './meilisearch';
import { logger } from './logger';

type IndexResourcePayload = {
  indexOperation: 'add' | 'delete';
  meiliDoc?: MeiliResourceDocument;
};

registerWorker<IndexResourcePayload>(JOB_INDEX_RESOURCE, async (payload) => {
  const { indexOperation, meiliDoc } = payload;
  if (!meiliDoc) {
    logger.warn({ indexOperation }, '[jobs] index-resource payload has no meiliDoc — skipped');
    return;
  }
  try {
    const index = meiliClient.index(RESOURCES_INDEX);
    if (indexOperation === 'add') {
      await index.addDocuments([meiliDoc]);
    } else {
      await index.deleteDocument(meiliDoc.raw_id);
    }
  } catch (err) {
    logger.error(
      { err: (err as Error).message, indexOperation, id: meiliDoc.raw_id },
      '[jobs] meilisearch operation failed'
    );
  }
});

export async function enqueueIndexOperation(op: IndexResourcePayload): Promise<void> {
  await enqueue(JOB_INDEX_RESOURCE, op);
}
