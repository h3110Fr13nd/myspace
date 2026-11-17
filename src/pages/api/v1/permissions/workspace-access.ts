import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';
import { ANONYMOUS, canManageGrants } from '../../../../lib/acl/guards';

/** Reveal only whether the signed-in principal can open the workspace IAM studio. */
export const GET: APIRoute = async ({ locals }) => {
  const currentUser = locals.user || ANONYMOUS;
  if (currentUser === ANONYMOUS) {
    return json({ canManageWorkspaceAccess: false }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  try {
    const canManageWorkspaceAccess = await canManageGrants(currentUser, 'space:main');
    return json({ canManageWorkspaceAccess }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return json({ error: 'Workspace access could not be checked.' }, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' },
    });
  }
};
