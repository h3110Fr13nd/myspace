import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { readAllTuples, type FgaTuple } from '../../../../lib/acl/reader';
import { can, ANONYMOUS } from '../../../../lib/acl/guards';

/**
 * The whole relationship graph, for the workspace-level IAM studio.
 *
 * This data used to be read server-side in `admin/permissions.astro` and
 * embedded in the page HTML, which handed the complete authorization graph to
 * any authenticated user. It is now fetched on demand and gated on the ability
 * to change access at the workspace level, so the broad visibility the studio
 * genuinely needs is available only to people who administer access.
 *
 * Per-resource ACLs must NOT come from here — they go through
 * `/api/v1/permissions/resource`, which enforces `read_acl` per object.
 */
export const GET: APIRoute = async ({ locals }) => {
  try {
    const currentUser = locals.user || ANONYMOUS;
    if (currentUser === ANONYMOUS) {
      return json({ error: 'Unauthorized.' }, { status: 401 });
    }

    if (!(await can(currentUser, 'manage_grants', 'space:main'))) {
      return json(
        { error: 'The IAM studio is restricted to people who can change access.', code: 'forbidden' },
        { status: 403 }
      );
    }

    const res = await readAllTuples();

    // Structural edges are relationships, not grants, and rendering them in an
    // ACL list is how `folder:x [parent_folder]` appears as a person with access.
    const grants: FgaTuple[] = res.tuples.filter(
      (t) => !t.relation.startsWith('parent_') && t.relation !== 'tagged'
    );

    return json(
      {
        success: true,
        tuples: grants,
        truncated: res.truncated,
        scanned: res.scanned,
        readOk: true,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
