import { checkPermission, checkPermissionsBatch } from './openfga';
import pool from './db';
import { isDraftResource, isUnlistedResource } from './visibility';

/**
 * Load ACL candidates and visible resources on one connection. Keeping the two
 * proven query plans avoids an expensive combined recursive query, while a
 * single pool checkout avoids waiting twice for a connection per render. The
 * projection remains a prefilter: every non-owner is still checked by OpenFGA.
 */
export async function listWorkspaceResourceCandidates(
  currentUser: string,
  options: { includeTimestamps?: boolean; metadataFields?: readonly string[] } = {}
): Promise<{
  rows: any[];
  wildcardViewerIds: string[];
}> {
  const client = await pool.connect();
  const timestamps = options.includeTimestamps === false ? '' : ', created_at, updated_at';
  const metadata = selectMetadataFields(options.metadataFields);
  try {
    let candidate: any;
    try {
      const result = await client.query(
        `SELECT state.stale,
                COALESCE(
                  array_agg(DISTINCT acl.resource_id)
                    FILTER (WHERE acl.resource_id IS NOT NULL),
                  ARRAY[]::varchar[]
                ) AS resource_ids,
                COALESCE(
                  array_agg(DISTINCT acl.resource_id ORDER BY acl.resource_id)
                    FILTER (
                      WHERE acl.resource_id IS NOT NULL
                        AND acl.subject_id = 'user:*'
                        AND acl.rung IN ('viewer', 'editor')
                    ),
                  ARRAY[]::varchar[]
                ) AS wildcard_viewer_ids
         FROM acl_projection_state state
         LEFT JOIN resource_effective_acl acl
           ON state.stale = FALSE
          AND acl.source <> 'deny'
          AND acl.rung IN ('viewer', 'commenter', 'editor', 'owner')
          AND (
            acl.subject_id = 'user:*'
            OR acl.subject_id = $1
            OR (
              $1 <> 'user:anonymous'
              AND (
                acl.subject_id = 'space:main#member'
                OR acl.subject_id = ANY (
                  SELECT group_id || '#member'
                  FROM group_memberships
                  WHERE user_id = $1
                )
              )
            )
          )
         WHERE state.id = 1
         GROUP BY state.stale`,
        [currentUser]
      );
      candidate = result.rows?.[0];
    } catch {
      candidate = null;
    }

    if (
      candidate?.stale !== false ||
      !Array.isArray(candidate.resource_ids) ||
      !Array.isArray(candidate.wildcard_viewer_ids)
    ) {
      const result = await client.query(
        `SELECT id, type, parent_id, owner_id, path, title, is_public, is_draft${timestamps}, ${metadata} FROM resources ORDER BY title ASC`
      );
      return { rows: result.rows || [], wildcardViewerIds: [] };
    }

    const result = await client.query(
      `WITH RECURSIVE candidates AS (
         SELECT id, parent_id, path
         FROM resources
         WHERE owner_id = $1 OR id = ANY($2::varchar[])
       ), ancestor_ids(id) AS (
         SELECT parent_id
         FROM candidates
         WHERE parent_id IS NOT NULL
         UNION
         SELECT path_segment.id
         FROM candidates child
         CROSS JOIN LATERAL unnest(string_to_array(child.path, '/')) AS path_segment(id)
         WHERE path_segment.id <> ''
         UNION
         SELECT parent.parent_id
         FROM resources parent
         JOIN ancestor_ids ancestor ON ancestor.id = parent.id
         WHERE parent.type IN ('folder', 'space')
           AND parent.parent_id IS NOT NULL
       )
       SELECT id, type, parent_id, owner_id, path, title, is_public, is_draft${timestamps}, ${metadata}
       FROM resources
       WHERE owner_id = $1
          OR id = ANY($2::varchar[])
          OR (
            type IN ('folder', 'space')
            AND id IN (SELECT id FROM ancestor_ids)
          )
       ORDER BY title ASC`,
      [currentUser, candidate.resource_ids]
    );
    return {
      rows: result.rows || [],
      wildcardViewerIds: candidate.wildcard_viewer_ids,
    };
  } finally {
    client.release();
  }
}

/**
 * Select only metadata needed for a workspace listing. Canvas payloads and
 * editor-specific metadata belong to the active resource, not every row in the
 * sidebar query. Keys are validated before being embedded as SQL string literals.
 */
function selectMetadataFields(fields?: readonly string[]): string {
  if (!fields) return 'metadata';
  const uniqueFields = [...new Set(fields)];
  if (uniqueFields.some((field) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(field))) {
    throw new Error('Workspace metadata projection contains an invalid field name.');
  }
  if (uniqueFields.length === 0) return "'{}'::jsonb AS metadata";
  const entries = uniqueFields.map((field) => `'${field}', metadata -> '${field}'`).join(', ');
  return `jsonb_strip_nulls(jsonb_build_object(${entries})) AS metadata`;
}

/**
 * Metadata used by the workspace tree, contextual graph, backlinks, and lookup.
 * The active resource's full metadata is fetched separately, so tags and editor
 * fields do not travel with every candidate row on a homepage request.
 */
export const WORKSPACE_LIST_METADATA_FIELDS = [
  'aliases',
  'description',
  'draft',
  'entityType',
  'isDraft',
  'isUnlisted',
  'slug',
  'summary',
  'unlisted',
  'wikilinks',
] as const;

/** Resources visible to an unauthenticated visitor, verified by OpenFGA. */
export async function listAnonymousVisibleResources(): Promise<any[]> {
  const { rows, wildcardViewerIds } = await listWorkspaceResourceCandidates('user:anonymous');
  return filterViewableResources(rows, 'user:anonymous', {
    allowFoldersForTree: true,
    wildcardViewerIds,
  });
}

export interface ResourcePermissionItem {
  id: string;
  type?: string;
  owner_id?: string;
  is_public?: boolean;
  is_draft?: boolean;
  metadata?: any;
  parent_id?: string | null;
  path?: string | null;
}

/**
 * Universal ReBAC Permission Checker.
 *
 * Two layers, both inside the authorization graph:
 *   1. Owner privilege (the owner sees everything, including drafts & unlisted)
 *   2. OpenFGA ReBAC — direct grants, group membership, folder inheritance, the
 *      audience slot (`user:*` for public links, `space:main#member` for the
 *      workspace), and tag grants.
 *
 * Layer 2 used to be preceded by a `resource.is_public` short-circuit, which
 * returned `true` *before* OpenFGA was consulted. That made public access a
 * bypass of the graph rather than a grant in it: the troubleshooter could not
 * explain it, auditing via OpenFGA under-reported every public resource, and 101
 * resources sat public in Postgres and private in the model. Publicness is now
 * expressed as a real grant, via `resource_audience` → `user:*` / `space:main#member`.
 *
 * `is_public` survives on the row purely as a derived cache for indexed queries
 * and is never read here.
 */
export async function canUserViewResource(resource: ResourcePermissionItem, currentUser: string): Promise<boolean> {
  if (!resource) return false;

  const isOwner = resource.owner_id === currentUser;
  // Shared with the tree, the search index and the importer so a note cannot be
  // hidden from a listing while staying readable, or the reverse. See
  // `src/lib/visibility.ts` for the coercion rules and why they matter.
  const isDraft = isDraftResource(resource);
  const isUnlisted = isUnlistedResource(resource);

  // 1. Owner always has full access to their own resources
  if (isOwner) {
    return true;
  }

  // Drafts & unlisted items are strictly hidden from non-owners
  if (isDraft || isUnlisted) {
    return false;
  }

  // 2. Anonymous callers still go through the graph: a `user:*` wildcard grant
  //    resolves for them, and nothing else does. Evaluating as the literal
  //    anonymous subject is what makes "anyone with the link" expressible at all.
  // 3. Evaluate the OpenFGA graph (direct grant, group, folder inheritance,
  //    audience, tag grants).
  try {
    return await checkPermission({
      user: currentUser || 'user:anonymous',
      relation: 'viewer',
      object: resource.id,
    });
  } catch (err: any) {
    console.warn(`[canUserViewResource] OpenFGA evaluation failed for ${currentUser} on ${resource.id}:`, err?.message);
    return false; // Secure default: deny on failure
  }
}

export async function canUserEditResource(resource: ResourcePermissionItem, currentUser: string): Promise<boolean> {
  if (!resource) return false;
  const isOwner = resource.owner_id === currentUser;
  if (isOwner) return true;
  if (!currentUser || currentUser === 'user:anonymous') return false;

  // SECURITY: there was a `currentUser === 'user:admin'` short-circuit here that
  // returned true for every resource. `user:admin` was not a privileged account,
  // it was a guessable string — registration derives the user id from the email
  // local part, so `dummy_mail` produced `user:admin` and this branch gave
  // them write access to the entire workspace, bypassing ReBAC. Verified live.
  // Workspace-wide administration is now `manage_grants` on `space:main`; see
  // `isWorkspaceAdmin` in src/lib/acl/guards.ts.

  try {
    return await checkPermission({
      user: currentUser,
      relation: 'editor',
      object: resource.id,
    });
  } catch (err: any) {
    console.warn(`[canUserEditResource] OpenFGA evaluation failed for ${currentUser} on ${resource.id}:`, err?.message);
    return false;
  }
}

export interface FilterViewableOptions {
  allowFoldersForTree?: boolean;
  /**
   * Candidate hints from a fresh ACL projection. OpenFGA still verifies each
   * wildcard decision; denied or unhinted resources are checked as the user.
   */
  wildcardViewerIds?: string[];
  /**
   * Authorization engine seam. Defaults to the real `checkPermission`.
   *
   * This exists because `checkPermission` is a module-level import with no
   * injection point, and `src/lib/openfga.ts` captures its endpoint and store id
   * at import time. A unit test cannot therefore point the filter at a stub
   * engine by setting an env var: Playwright reuses worker processes, so if any
   * earlier spec in the same worker already imported the module, the client is
   * already bound to the real engine and the env var is silently ignored — the
   * test then answers "public?" with production data and fails for reasons that
   * have nothing to do with the code under test. Overriding the function
   * directly does not work either: ES module namespaces are read-only.
   */
  check?: (params: { user: string; relation: string; object: string }) => Promise<boolean>;
  /**
   * Authorization-engine seam for the batched path, paired with `check`.
   *
   * `check` is still honoured and still wins when supplied alone, because the
   * existing specs inject only that. When neither is supplied the real batched
   * engine is used, which is the whole point: a listing is one decision per
   * resource, and issuing them one at a time turns a page render into hundreds
   * of round trips that all queue behind the same engine.
   */
  checkBatch?: (params: { user: string; relation: string; objects: string[] }) => Promise<Map<string, boolean>>;
}

/**
 * Every ancestor id of `resource`, nearest-first.
 *
 * Prefers `parent_id` and falls back to the `path` chain, because imported
 * content carries its hierarchy in `path` while rows created through the app
 * only get `parent_id`. A container is addressable by either, so the leak
 * surface has to be computed from both or it is only half closed.
 */
function ancestorIds(resource: ResourcePermissionItem): string[] {
  const ids: string[] = [];
  const seen = new Set<string>([resource.id]);

  const push = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  push(resource.parent_id);

  const path = resource.path;
  if (path) {
    // Walk backwards without allocating split/filter arrays. The final path
    // segment is the resource itself; only its ancestors belong in the result.
    let segmentEnd = path.length;
    while (segmentEnd > 0 && path[segmentEnd - 1] === '/') segmentEnd--;
    segmentEnd = path.lastIndexOf('/', segmentEnd - 1);

    while (segmentEnd >= 0) {
      const segmentStart = path.lastIndexOf('/', segmentEnd - 1) + 1;
      if (segmentEnd > segmentStart) push(path.slice(segmentStart, segmentEnd));
      segmentEnd = segmentStart - 1;
    }
  }

  return ids;
}

/**
 * Universal Batch ReBAC Permission Filter
 * Triage algorithm:
 * 1. In-memory triage (0 network latency):
 *    - Owner always allowed.
 *    - Drafts / unlisted for non-owners always denied.
 *    - Folders / spaces are evaluated through the graph like everything else,
 *      then re-admitted when they are an ancestor of something already allowed.
 *    - Public non-draft, non-unlisted items always allowed.
 * 2. Parallel evaluation:
 *    - Anonymous users cannot evaluate private items -> denied.
 *    - Remaining private non-draft items evaluated concurrently with Promise.all to avoid sequential HTTP waterfalls.
 * 3. Ancestor closure (only when allowFoldersForTree):
 *    - Containers reachable from an allowed resource are re-added, so the tree
 *      still nests a shared document under a folder the viewer cannot open.
 *
 * SECURITY: step 1 used to short-circuit *every* folder and space into the
 * allowed set whenever `allowFoldersForTree` was set. That flag exists to keep
 * the sidebar's shape intact, not to disclose names, and the reader, the folder
 * page, the folder API and the tag pages all pass it. So a private container's
 * title and its existence were serialized into the anonymous homepage payload —
 * `Academic Research Vault`, `77 Research Papers` and the rest of a user's
 * private hierarchy — while its children stayed correctly denied. Data stayed
 * private and the directory of it did not. Containers now have to earn their
 * place in the tree the same way content does.
 */
export async function filterViewableResources<T extends ResourcePermissionItem>(
  resources: T[],
  currentUser: string,
  options?: FilterViewableOptions
): Promise<T[]> {
  if (!resources || resources.length === 0) return [];

  const allowFolders = options?.allowFoldersForTree ?? false;
  const canView = options?.check;
  // Batch only when the caller did not inject a single-item engine: a test
  // stub's contract is one call per object, and silently re-interpreting it as a
  // bulk query would test the adapter rather than the filter.
  const canViewBatch = options?.check ? undefined : options?.checkBatch ?? checkPermissionsBatch;
  const wildcardViewerIds = new Set(options?.wildcardViewerIds ?? []);

  const pendingChecks: { resource: T; promise: Promise<boolean> }[] = [];
  const allowedImmediate: T[] = [];
  const wildcardCandidates: T[] = [];
  /** Non-owner candidates, held back so they can be settled in one batch. */
  const batched: T[] = [];

  for (const r of resources) {
    const isOwner = r.owner_id === currentUser;
    const isDraft = isDraftResource(r);
    const isUnlisted = isUnlistedResource(r);

    if (isOwner) {
      allowedImmediate.push(r);
    } else if (isDraft || isUnlisted) {
      continue;
    } else {
      // SECURITY: this branch used to be `else if (r.is_public)`, which listed a
      // resource as viewable from a Postgres flag without consulting the graph —
      // the same bypass as `canUserViewResource`, in the listing path. Everything
      // else now goes through the engine, including public resources, because a
      // public link IS a `user:*` grant and the engine can say so.
      //
      // Anonymous callers are evaluated too, for the same reason: a wildcard
      // grant must resolve for them, or "anyone with the link" cannot work.
      if (canViewBatch) {
        if (
          currentUser &&
          currentUser !== 'user:anonymous' &&
          wildcardViewerIds.has(r.id)
        ) {
          wildcardCandidates.push(r);
        } else {
          batched.push(r);
        }
      } else {
        const promise = canView!({
          user: currentUser || 'user:anonymous',
          relation: 'viewer',
          object: r.id,
        }).catch((err) => {
          console.warn(`[filterViewableResources] OpenFGA check failed for ${r.id}:`, err?.message);
          return false;
        });
        pendingChecks.push({ resource: r, promise });
      }
    }
  }

  if (wildcardCandidates.length > 0 && canViewBatch) {
    let wildcardDecisions = new Map<string, boolean>();
    try {
      wildcardDecisions = await canViewBatch({
        user: 'user:*',
        relation: 'viewer',
        objects: wildcardCandidates.map((r) => r.id),
      });
    } catch (err: any) {
      console.warn('[filterViewableResources] wildcard OpenFGA check failed:', err?.message);
    }
    for (const resource of wildcardCandidates) {
      if (wildcardDecisions.get(resource.id) === true) {
        allowedImmediate.push(resource);
      } else {
        // The projection only selected a candidate. A negative or missing FGA
        // answer falls back to the real subject so private grants still work.
        batched.push(resource);
      }
    }
  }

  if (batched.length > 0 && canViewBatch) {
    // One engine call for the whole listing instead of one per resource. Items
    // missing from the returned map are denied, which is the fail-closed reading:
    // absence means "no decision", never "allowed".
    let decisions: Map<string, boolean>;
    try {
      decisions = await canViewBatch({
        user: currentUser || 'user:anonymous',
        relation: 'viewer',
        objects: batched.map((r) => r.id),
      });
    } catch (err: any) {
      console.warn('[filterViewableResources] batched OpenFGA check failed:', err?.message);
      decisions = new Map();
    }
    for (const r of batched) {
      if (decisions.get(r.id) === true) allowedImmediate.push(r);
    }
  }

  if (pendingChecks.length > 0) {
    const results = await Promise.all(pendingChecks.map((item) => item.promise));
    results.forEach((allowed, index) => {
      if (allowed) {
        allowedImmediate.push(pendingChecks[index].resource);
      }
    });
  }

  if (!allowFolders || allowedImmediate.length === 0) {
    return allowedImmediate;
  }

  const byId = new Map(resources.map((r) => [r.id, r]));
  const allowedIds = new Set(allowedImmediate.map((r) => r.id));
  const queue: ResourcePermissionItem[] = [...allowedImmediate];
  const reAdmitted: T[] = [];
  // Keep traversal linear: Array.shift() moves every remaining item and turns
  // large folder trees into quadratic work on each workspace render.
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = queue[queueIndex];
    for (const ancestorId of ancestorIds(current)) {
      if (allowedIds.has(ancestorId)) continue;
      const ancestor = byId.get(ancestorId);
      if (!ancestor) continue;
      if (ancestor.type !== 'folder' && ancestor.type !== 'space') continue;
      allowedIds.add(ancestorId);
      reAdmitted.push(ancestor);
      queue.push(ancestor);
    }
  }

  if (reAdmitted.length === 0) return allowedImmediate;

  return resources.filter((r) => allowedIds.has(r.id));
}


