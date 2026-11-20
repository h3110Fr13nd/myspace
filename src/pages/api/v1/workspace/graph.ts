import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { query } from '../../../../lib/db';
import {
  WORKSPACE_LIST_METADATA_FIELDS,
  filterViewableResources,
  listWorkspaceResourceCandidates,
} from '../../../../lib/permissions';
import { buildGraphData } from '../../../../lib/workspace/graphTopology';
import { getGraphMeta } from '../../../../lib/graph-tiles/store';

/**
 * Largest graph served as one JSON document. Past this the classic view is
 * the wrong tool: measured at 100k resources it cost ~3 s of app CPU and ~300
 * MB RSS per request, and at 1M it exhausts the app's heap. Larger graphs are
 * served as tiles (`/api/v1/graph/*`).
 */
const LEGACY_GRAPH_MAX_NODES = Number(process.env.LEGACY_GRAPH_MAX_NODES ?? 20000);

async function tooLargeForClassicView(currentUser: string): Promise<boolean> {
  try {
    const meta = await getGraphMeta(currentUser);
    if (meta.layers.length > 0) return meta.nodes > LEGACY_GRAPH_MAX_NODES;
  } catch {
    // Tiles unavailable: fall through to the table-size guard.
  }
  // No pyramid yet. The planner's row estimate is O(1) and an upper bound on
  // what any viewer can see; only refuse when it is far past the limit.
  try {
    const { rows } = await query(`SELECT reltuples::bigint AS n FROM pg_class WHERE oid = 'resources'::regclass`);
    return Number(rows[0]?.n ?? 0) > LEGACY_GRAPH_MAX_NODES * 5;
  } catch {
    return false;
  }
}

/** Serve a viewer-filtered graph snapshot to clients that request it directly. */
export const GET: APIRoute = async ({ locals }) => {
  const currentUser = locals.user || 'user:anonymous';

  if (await tooLargeForClassicView(currentUser)) {
    return json(
      {
        error: 'This graph is too large to load at once. Use the streamed graph.',
        tiled: '/api/v1/graph/meta',
      },
      { status: 413, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  try {
    // Only the metadata the graph and the visibility checks read — not canvas
    // payloads or editor state, which used to ride along with every row.
    const candidates = await listWorkspaceResourceCandidates(currentUser, {
      includeTimestamps: false,
      metadataFields: WORKSPACE_LIST_METADATA_FIELDS,
    });
    const visibleResources = await filterViewableResources(candidates.rows, currentUser, {
      allowFoldersForTree: true,
      wildcardViewerIds: candidates.wildcardViewerIds,
    });
    return json(buildGraphData(visibleResources), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return json({ error: 'The workspace graph is temporarily unavailable.' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' },
    });
  }
};
