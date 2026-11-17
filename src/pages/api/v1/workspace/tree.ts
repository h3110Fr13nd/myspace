import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { filterViewableResources, listWorkspaceResourceCandidates } from '../../../../lib/permissions';
import { buildTree } from '../../../../lib/workspace/treeBuilder';

/** Load the complete authorized explorer only when someone expands its list. */
export const GET: APIRoute = async ({ locals }) => {
  const currentUser = locals.user || 'user:anonymous';
  try {
    const candidates = await listWorkspaceResourceCandidates(currentUser, { includeTimestamps: false });
    const resources = await filterViewableResources(candidates.rows, currentUser, {
      allowFoldersForTree: true,
      wildcardViewerIds: candidates.wildcardViewerIds,
    });
    return json({ treeData: buildTree(resources, currentUser) }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return json({ error: 'The workspace resources are temporarily unavailable.' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' },
    });
  }
};
