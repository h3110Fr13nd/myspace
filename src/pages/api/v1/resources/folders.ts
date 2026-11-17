import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { filterViewableResources } from '../../../../lib/permissions';
import { json } from '../../../../lib/api';

/**
 * GET /api/v1/resources/folders
 * Lists the folder & space containers the current user can create inside.
 * Used by the CreateResourceModal location picker.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const currentUser = locals.user || 'user:anonymous';
  const includeRoot = url.searchParams.get('include_roots') !== 'false';

  try {
    const res = await query(
      `SELECT id, type, parent_id, owner_id, path, title, is_public, is_draft, metadata
       FROM resources
       WHERE type IN ('folder', 'space')
       ORDER BY type = 'space' DESC, title ASC`
    );

    const allowed = await filterViewableResources(res.rows || [], currentUser, { allowFoldersForTree: true });

    // Folders with no viewable parent but owned by the user (personal root) are attach points
    const viewableParentIds = new Set(allowed.map((r: any) => r.id));
    const containers = allowed
      .filter((r: any) => {
        const isRootlessOwner = !r.parent_id || !viewableParentIds.has(r.parent_id) ? r.owner_id === currentUser : true;
        if (!includeRoot && r.metadata?.isPersonalRoot) return false;
        return isRootlessOwner;
      })
      .map((r: any) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        path: r.path,
        isPersonalRoot: Boolean(r.metadata?.isPersonalRoot),
      }));

    return json({ containers }, { status: 200 });
  } catch (err: any) {
    return json({ error: err.message }, { status: 500 });
  }
};