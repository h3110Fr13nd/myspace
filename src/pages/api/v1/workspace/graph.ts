import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { filterViewableResources, listWorkspaceResourceCandidates } from '../../../../lib/permissions';
import { buildGraphData } from '../../../../lib/workspace/graphTopology';

/** Serve a viewer-filtered graph snapshot to clients that request it directly. */
export const GET: APIRoute = async ({ locals }) => {
  const currentUser = locals.user || 'user:anonymous';

  try {
    const candidates = await listWorkspaceResourceCandidates(currentUser, { includeTimestamps: false });
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
