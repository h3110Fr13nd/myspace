/**
 * Tiled graph — serving side (runs in the app process).
 *
 * Per request this module does a primary-key read and copies pre-compressed
 * bytes to the socket. No graph is ever assembled in the app, so the cost of a
 * tile request does not depend on how many resources exist.
 *
 * Freshness and authorization: a pyramid is a snapshot. When source data or
 * authorization changed after it was built (`dirty_at > built_at`, or the ACL
 * projection is stale), tiles are decoded and every node is re-verified before
 * being served — public tiles against OpenFGA, owner tiles against ownership —
 * and the response is marked `no-store`. The worker rebuilds dirty scopes in
 * the background, which ends the slow path.
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import pool from '../db';
import { decodeTile, emptyTile, encodeTile, filterTile } from '../spatial-tiles/codec';
import { ancestorTiles, MAX_ZOOM } from '../spatial-tiles/morton';
import { asBooleanFlag } from '../visibility';
import {
  OWNER_SCOPE_PREFIX,
  PUBLIC_SCOPE,
  WORKSPACE_SCOPE,
  WORKSPACE_SUBJECT,
  scopeParam,
  scopesForUser,
} from './scopes';
import { CHANGE_MARGIN_MS } from './constants';

export interface ScopeRow {
  scope: string;
  generation: number;
  world_x: number;
  world_y: number;
  world_size: number;
  content_x: number;
  content_y: number;
  content_w: number;
  content_h: number;
  max_z: number;
  node_count: number;
  edge_count: number;
  tile_count: number;
  built_at: Date | null;
  dirty_at: Date | null;
}

/** Seconds a clean tile may be reused before revalidation (bounds revocation lag). */
const TILE_MAX_AGE = Number(process.env.GRAPH_TILE_MAX_AGE ?? 60);

// --- tiny TTL caches -------------------------------------------------------------
// Scope rows and projection state change rarely and are read on every tile, so
// a two-second memo removes two queries from the hot path.

const SCOPE_TTL_MS = 2000;
const scopeCache = new Map<string, { at: number; row: ScopeRow | null }>();
let aclState: { at: number; stale: boolean } | null = null;

export function clearGraphCaches(): void {
  memberCache.clear();
  overlayHint.clear();
  scopeCache.clear();
  aclState = null;
  verifiedTiles.clear();
  verifiedBytes = 0;
  changedCache.clear();
}

/** Above this many changed nodes since a build, every node is re-verified. */
const CHANGED_CAP = 50000;

interface ChangeSet {
  gids: Set<number> | 'all';
  /** Identifies this set, for keying caches of filtered tiles. */
  version: string;
}
const changedCache = new Map<string, { at: number; set: ChangeSet }>();

/**
 * Nodes changed since the scope's build (minus a late-commit margin), or 'all'
 * when nothing short of full verification is safe: a stale projection for the
 * public scope, a scope never built, or more changes than are worth tracking.
 *
 * This — not `dirty_at` — decides what a reader re-verifies, so a rebuild that
 * raced a late-committing write cannot make a tile skip verification.
 * Memoised per scope build for two seconds; one indexed query otherwise.
 */
async function changedSince(row: ScopeRow, aclStale: boolean): Promise<ChangeSet> {
  if (!row.built_at || (isShared(row.scope) && aclStale)) return { gids: 'all', version: 'all' };
  const builtAt = new Date(row.built_at).getTime();
  const key = `${row.scope}|${builtAt}`;
  const hit = changedCache.get(key);
  if (hit && Date.now() - hit.at < SCOPE_TTL_MS) return hit.set;
  const { rows } = await pool.query(
    `SELECT gid, changed_at FROM graph_dirty_gids WHERE changed_at > $1 LIMIT $2`,
    [new Date(builtAt - CHANGE_MARGIN_MS), CHANGED_CAP + 1]
  );
  let set: ChangeSet;
  if (rows.length > CHANGED_CAP) set = { gids: 'all', version: 'all' };
  else {
    let newest = 0;
    for (const r of rows) newest = Math.max(newest, new Date(r.changed_at).getTime());
    set = { gids: new Set(rows.map((r) => Number(r.gid))), version: `${rows.length}:${newest}` };
  }
  if (changedCache.size > 1000) changedCache.clear();
  changedCache.set(key, { at: Date.now(), set });
  return set;
}

export async function getScope(scope: string): Promise<ScopeRow | null> {
  const hit = scopeCache.get(scope);
  if (hit && Date.now() - hit.at < SCOPE_TTL_MS) return hit.row;
  const { rows } = await pool.query(
    `SELECT scope, generation, world_x, world_y, world_size, max_z, node_count, edge_count,
            tile_count, built_at, dirty_at, content_x, content_y, content_w, content_h
       FROM graph_scopes WHERE scope = $1`,
    [scope]
  );
  const row = (rows[0] as ScopeRow | undefined) ?? null;
  if (scopeCache.size > 5000) scopeCache.clear();
  scopeCache.set(scope, { at: Date.now(), row });
  return row;
}

async function projectionStale(): Promise<boolean> {
  if (aclState && Date.now() - aclState.at < SCOPE_TTL_MS) return aclState.stale;
  let stale = true;
  try {
    const { rows } = await pool.query(`SELECT stale FROM acl_projection_state WHERE id = 1`);
    stale = rows[0]?.stale !== false;
  } catch {
    stale = true;
  }
  aclState = { at: Date.now(), stale };
  return stale;
}

const isShared = (scope: string) => scope === PUBLIC_SCOPE || scope === WORKSPACE_SCOPE;

export function isDirty(row: ScopeRow, aclStale: boolean): boolean {
  if (isShared(row.scope) && aclStale) return true;
  if (!row.built_at) return true;
  return Boolean(row.dirty_at && new Date(row.dirty_at).getTime() > new Date(row.built_at).getTime());
}

// --- meta --------------------------------------------------------------------------

export interface GraphLayerMeta {
  layer: string;
  generation: number;
  world: { x: number; y: number; size: number };
  /** Bounding box of this layer's nodes. */
  content: { x: number; y: number; width: number; height: number };
  maxZ: number;
  nodes: number;
  edges: number;
  dirty: boolean;
}

export interface GraphMeta {
  version: 1;
  layers: GraphLayerMeta[];
  nodes: number;
  tileTemplate: string;
  /** The user has direct or group grants: fetch `overlayUrl` for the view. */
  overlay: boolean;
  overlayUrl: string;
}

export async function getGraphMeta(currentUser: string): Promise<GraphMeta> {
  const aclStale = await projectionStale();
  const layers: GraphLayerMeta[] = [];
  for (const scope of scopesForUser(currentUser)) {
    if (scope === WORKSPACE_SCOPE && !(await isWorkspaceMember(currentUser))) continue;
    const row = await getScope(scope);
    if (!row || !row.built_at || row.tile_count === 0) continue;
    layers.push({
      layer: scopeParam(scope),
      generation: row.generation,
      world: { x: row.world_x, y: row.world_y, size: row.world_size },
      content: { x: row.content_x, y: row.content_y, width: row.content_w, height: row.content_h },
      maxZ: row.max_z,
      nodes: row.node_count,
      edges: row.edge_count,
      dirty: isDirty(row, aclStale),
    });
  }
  let overlay = false;
  try {
    overlay = layers.length > 0 && (await hasSharedOverlay(currentUser));
  } catch {
    overlay = false;
  }
  return {
    version: 1,
    layers,
    nodes: layers.reduce((sum, l) => sum + l.nodes, 0),
    tileTemplate: '/api/v1/graph/tiles/{layer}/{generation}/{z}/{x}/{y}',
    overlay,
    overlayUrl: '/api/v1/graph/overlay',
  };
}

// --- verification --------------------------------------------------------------------

type AudienceCheck = (objects: string[]) => Promise<Map<string, boolean>>;
let publicCheckOverride: AudienceCheck | null = null;
let workspaceCheckOverride: AudienceCheck | null = null;
let memberCheckOverride: ((user: string) => Promise<boolean>) | null = null;

/** Test seam: replace the engine call used to verify public tiles. */
export function setPublicCheckForTests(check: AudienceCheck | null): void {
  publicCheckOverride = check;
}

/** Test seams for the workspace layer: object checks and membership. */
export function setWorkspaceChecksForTests(
  check: AudienceCheck | null,
  member: ((user: string) => Promise<boolean>) | null
): void {
  workspaceCheckOverride = check;
  memberCheckOverride = member;
  memberCache.clear();
}

async function checkAudience(scope: string, objects: string[]): Promise<Map<string, boolean>> {
  const override = scope === PUBLIC_SCOPE ? publicCheckOverride : workspaceCheckOverride;
  if (override) return override(objects);
  const { checkPermissionsBatch } = await import('../openfga');
  return checkPermissionsBatch({
    user: scope === PUBLIC_SCOPE ? 'user:*' : WORKSPACE_SUBJECT,
    relation: 'viewer',
    objects,
  });
}

// Membership of space:main, memoised briefly: a view fetches dozens of tiles
// and each must not cost an engine round trip. Fails closed.
const MEMBER_TTL_MS = 30_000;
const memberCache = new Map<string, { at: number; ok: boolean }>();

/** Whether `user` may read the workspace layer (a verified space:main member). */
export async function isWorkspaceMember(user: string): Promise<boolean> {
  if (!user || user === 'user:anonymous') return false;
  const hit = memberCache.get(user);
  if (hit && Date.now() - hit.at < MEMBER_TTL_MS) return hit.ok;
  let ok = false;
  try {
    if (memberCheckOverride) ok = await memberCheckOverride(user);
    else {
      const { checkPermission } = await import('../openfga');
      ok = await checkPermission({ user, relation: 'member', object: 'space:main' });
    }
  } catch {
    ok = false;
  }
  if (memberCache.size > 10000) memberCache.clear();
  memberCache.set(user, { at: Date.now(), ok });
  return ok;
}

/** The subset of `gids` that may still appear in `scope`. */
export async function verifyGids(scope: string, gids: number[]): Promise<Set<number>> {
  const allowed = new Set<number>();
  if (gids.length === 0) return allowed;
  const unique = [...new Set(gids)];
  const { rows } = await pool.query(
    `SELECT g.gid, r.id, r.owner_id, r.is_draft,
            r.metadata->'draft' AS m_draft, r.metadata->'isDraft' AS m_is_draft,
            r.metadata->'unlisted' AS m_unlisted, r.metadata->'isUnlisted' AS m_is_unlisted
       FROM graph_nodes g JOIN resources r ON r.id = g.resource_id
      WHERE g.gid = ANY($1::bigint[])`,
    [unique]
  );
  if (isShared(scope)) {
    const candidates = rows.filter(
      (r) =>
        r.is_draft !== true &&
        !asBooleanFlag(r.m_draft) &&
        !asBooleanFlag(r.m_is_draft) &&
        !asBooleanFlag(r.m_unlisted) &&
        !asBooleanFlag(r.m_is_unlisted)
    );
    let decisions = new Map<string, boolean>();
    try {
      decisions = await checkAudience(scope, candidates.map((r) => r.id));
    } catch {
      // Engine unreachable: fail closed — changed nodes in a shared tile are hidden.
      decisions = new Map();
    }
    for (const r of candidates) if (decisions.get(r.id) === true) allowed.add(Number(r.gid));
    return allowed;
  }
  if (scope.startsWith(OWNER_SCOPE_PREFIX)) {
    const owner = scope.slice(OWNER_SCOPE_PREFIX.length);
    for (const r of rows) if (r.owner_id === owner) allowed.add(Number(r.gid));
  }
  return allowed;
}

// Verified (filtered) tiles, keyed by content version, so a hot tile in a dirty
// scope is verified once per change rather than once per request. Bounded by
// bytes; entries are keyed on dirty_at so any new change misses the cache.
const VERIFIED_CACHE_BYTES = 8 * 1024 * 1024;
const verifiedTiles = new Map<string, { body: Uint8Array; etag: string; clean: boolean }>();
let verifiedBytes = 0;

function rememberVerified(key: string, value: { body: Uint8Array; etag: string; clean: boolean }) {
  verifiedTiles.set(key, value);
  verifiedBytes += value.body.byteLength;
  while (verifiedBytes > VERIFIED_CACHE_BYTES && verifiedTiles.size) {
    const oldest = verifiedTiles.keys().next().value as string;
    verifiedBytes -= verifiedTiles.get(oldest)!.body.byteLength;
    verifiedTiles.delete(oldest);
  }
}

// --- tiles ---------------------------------------------------------------------------

export interface TileRequest {
  scope: string;
  generation: number;
  z: number;
  x: number;
  y: number;
  ifNoneMatch?: string | null;
}

export interface TileResult {
  status: 200 | 304 | 400 | 404 | 410;
  body?: Uint8Array;
  headers: Record<string, string>;
}

const BINARY = 'application/vnd.graph-tile';

function validCoords(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > MAX_ZOOM) return false;
  const side = 2 ** z;
  return x >= 0 && y >= 0 && x < side && y < side;
}

export async function readTile(req: TileRequest): Promise<TileResult> {
  const { scope, generation, z, x, y } = req;
  if (!validCoords(z, x, y) || !Number.isInteger(generation)) {
    return { status: 400, headers: { 'Cache-Control': 'no-store' } };
  }
  const row = await getScope(scope);
  if (!row || !row.built_at) return { status: 404, headers: { 'Cache-Control': 'no-store' } };
  // The previous generation is kept for viewers mid-session; anything older is
  // gone and the client should re-read meta.
  if (generation !== row.generation && generation !== row.generation - 1) {
    return {
      status: 410,
      headers: { 'Cache-Control': 'no-store', 'X-Graph-Generation': String(row.generation) },
    };
  }

  // Only the public layer may sit in shared HTTP caches; workspace tiles need
  // membership and owner tiles belong to one user.
  const privacy = scope === PUBLIC_SCOPE ? 'public' : 'private';
  const changes = await changedSince(row, await projectionStale());
  const dirty = changes.gids === 'all' || changes.gids.size > 0;

  // Exact tile, else the deepest existing ancestor. A leaf ancestor already
  // holds everything in this area (the client aliases to it); an internal
  // ancestor means the area is empty at this level.
  const ancestors = ancestorTiles(z, x, y);
  const zs = [z, ...ancestors.map((a) => a[0])];
  const xs = [x, ...ancestors.map((a) => a[1])];
  const ys = [y, ...ancestors.map((a) => a[2])];
  const found = await pool.query(
    `SELECT t.z, t.x, t.y, t.leaf, t.etag
       FROM graph_tiles t
       JOIN unnest($3::smallint[], $4::int[], $5::int[]) AS want(z, x, y)
         ON t.z = want.z AND t.x = want.x AND t.y = want.y
      WHERE t.scope = $1 AND t.generation = $2
      ORDER BY t.z DESC
      LIMIT 1`,
    [scope, generation, zs, xs, ys]
  );
  const hit = found.rows[0];

  if (!hit || (hit.z !== z && !hit.leaf)) {
    const size = row.world_size / 2 ** z;
    const body = encodeTile(
      emptyTile(z, x, y, { worldX: row.world_x + x * size, worldY: row.world_y + y * size, worldSize: size })
    );
    return {
      status: 200,
      body,
      headers: {
        'Content-Type': BINARY,
        'Cache-Control': dirty ? 'private, no-store' : `${privacy}, max-age=${TILE_MAX_AGE}`,
        'X-Graph-Tile': `${z}/${x}/${y}`,
      },
    };
  }

  const actual = `${hit.z}/${hit.x}/${hit.y}`;
  if (!dirty) {
    const etag = `"${hit.etag}"`;
    const base = {
      ETag: etag,
      'Cache-Control': `${privacy}, max-age=${TILE_MAX_AGE}`,
      'X-Graph-Tile': actual,
      Vary: 'Accept-Encoding',
    };
    if (req.ifNoneMatch && req.ifNoneMatch.split(/\s*,\s*/).includes(etag)) {
      return { status: 304, headers: base };
    }
    const { rows } = await pool.query(
      `SELECT payload FROM graph_tiles WHERE scope = $1 AND generation = $2 AND z = $3 AND x = $4 AND y = $5`,
      [scope, generation, hit.z, hit.x, hit.y]
    );
    if (!rows[0]) return { status: 404, headers: { 'Cache-Control': 'no-store' } };
    return {
      status: 200,
      body: rows[0].payload as Uint8Array,
      headers: { ...base, 'Content-Type': BINARY, 'Content-Encoding': 'gzip' },
    };
  }

  // Dirty: only nodes that changed since the build need re-checking. A tile
  // holding none of them is still exact and is served as stored; otherwise the
  // changed nodes are verified (public: engine; owner: ownership) and filtered.
  const cacheKey = `${scope}|${generation}|${actual}|${changes.version}`;
  let verified = verifiedTiles.get(cacheKey);
  if (!verified) {
    const { rows } = await pool.query(
      `SELECT payload, etag FROM graph_tiles WHERE scope = $1 AND generation = $2 AND z = $3 AND x = $4 AND y = $5`,
      [scope, generation, hit.z, hit.x, hit.y]
    );
    if (!rows[0]) return { status: 404, headers: { 'Cache-Control': 'no-store' } };
    const changed = changes.gids;
    const tile = decodeTile(gunzipSync(rows[0].payload));
    const gids = Array.from(tile.nodes.gid);
    const suspect = changed === 'all' ? gids : gids.filter((g) => changed.has(g));
    if (suspect.length === 0) {
      verified = { body: rows[0].payload as Uint8Array, etag: rows[0].etag, clean: true };
    } else {
      const allowed = await verifyGids(scope, suspect);
      const check = changed === 'all' ? (g: number) => allowed.has(g) : (g: number) => !changed.has(g) || allowed.has(g);
      const raw = encodeTile(filterTile(tile, check));
      verified = { body: gzipSync(raw, { level: 4 }), etag: createHash('sha1').update(raw).digest('hex'), clean: false };
    }
    rememberVerified(cacheKey, verified);
  }
  if (verified.clean) {
    const etag = `"${verified.etag}"`;
    const headers = {
      ETag: etag,
      'Cache-Control': `${privacy}, max-age=${TILE_MAX_AGE}`,
      'X-Graph-Tile': actual,
      Vary: 'Accept-Encoding',
    };
    if (req.ifNoneMatch && req.ifNoneMatch.split(/\s*,\s*/).includes(etag)) return { status: 304, headers };
    return { status: 200, body: verified.body, headers: { ...headers, 'Content-Type': BINARY, 'Content-Encoding': 'gzip' } };
  }
  return {
    status: 200,
    body: verified.body,
    headers: {
      'Content-Type': BINARY,
      'Content-Encoding': 'gzip',
      'Cache-Control': 'private, no-store',
      ETag: `"${verified.etag}"`,
      'X-Graph-Tile': actual,
      'X-Graph-Verified': '1',
    },
  };
}

// --- node lookup -------------------------------------------------------------------

export interface GraphNodeInfo {
  gid: number;
  id: string;
  title: string;
  type: string;
  path: string;
  x: number;
  y: number;
}

async function toInfo(row: any, currentUser: string): Promise<GraphNodeInfo | null> {
  if (!row) return null;
  const [{ canUserViewResource }, { buildResourcePath }] = await Promise.all([
    import('../permissions'),
    import('../resourceUrls'),
  ]);
  const allowed = await canUserViewResource(row, currentUser);
  if (!allowed) return null;
  return {
    gid: Number(row.gid),
    id: row.id,
    title: row.title,
    type: row.type,
    path: buildResourcePath(row, row.path || undefined),
    x: row.x,
    y: row.y,
  };
}

const NODE_COLUMNS = `g.gid, g.x, g.y, r.id, r.type, r.title, r.path, r.owner_id, r.parent_id,
                      r.is_public, r.is_draft, r.metadata`;

/** A node by gid, if the user may view it. Used for click/hover resolution. */
export async function resolveNode(currentUser: string, gid: number): Promise<GraphNodeInfo | null> {
  if (!Number.isInteger(gid) || gid <= 0) return null;
  const { rows } = await pool.query(
    `SELECT ${NODE_COLUMNS} FROM graph_nodes g JOIN resources r ON r.id = g.resource_id WHERE g.gid = $1`,
    [gid]
  );
  return toInfo(rows[0], currentUser);
}

/** Where a resource sits in the graph, if the user may view it. Used for "fly to". */
export async function locateResource(currentUser: string, resourceId: string): Promise<GraphNodeInfo | null> {
  if (!resourceId) return null;
  const { rows } = await pool.query(
    `SELECT ${NODE_COLUMNS} FROM graph_nodes g JOIN resources r ON r.id = g.resource_id WHERE g.resource_id = $1`,
    [resourceId]
  );
  return toInfo(rows[0], currentUser);
}

// --- "shared with me" overlay ------------------------------------------------

export interface OverlayRequest {
  currentUser: string;
  /** World-space rectangle of the view. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  limit: number;
}

type UserCheck = (user: string, objects: string[]) => Promise<Map<string, boolean>>;
let overlayCheckOverride: UserCheck | null = null;

/** Test seam: replace the engine call used to verify overlay nodes. */
export function setOverlayCheckForTests(check: UserCheck | null): void {
  overlayCheckOverride = check;
}

const overlayHint = new Map<string, { at: number; has: boolean }>();

/**
 * Does the user have any direct or group grant that could put nodes in an
 * overlay? Cheap indexed EXISTS, memoised 30 s, so clients only fetch overlays
 * when there can be something in them.
 */
export async function hasSharedOverlay(currentUser: string): Promise<boolean> {
  if (!currentUser || currentUser === 'user:anonymous') return false;
  const hit = overlayHint.get(currentUser);
  if (hit && Date.now() - hit.at < MEMBER_TTL_MS) return hit.has;
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM resource_effective_acl a
        WHERE a.source <> 'deny' AND a.rung IN ('viewer', 'commenter', 'editor', 'owner')
          AND (a.subject_id = $1 OR a.subject_id IN (
                SELECT group_id || '#member' FROM group_memberships WHERE user_id = $1))
     ) AS has`,
    [currentUser]
  );
  const has = rows[0]?.has === true;
  if (overlayHint.size > 10000) overlayHint.clear();
  overlayHint.set(currentUser, { at: Date.now(), has });
  return has;
}

/**
 * Nodes the user may see *only* through a direct or group grant — not their
 * own and not in the public or workspace layer — inside a view rectangle, as a
 * single leaf tile (nodes only). Candidates come from the ACL projection; each
 * is verified against the engine as the user (fail closed), and drafts and
 * unlisted resources are excluded exactly as in `canUserViewResource`.
 *
 * Bounded by the rectangle and `limit`; the candidate scan is bounded by the
 * user's own grants, which is small for direct shares. (A group sharing a huge
 * subtree is the case a per-group pyramid would serve better.)
 */
export async function readOverlay(req: OverlayRequest): Promise<Uint8Array | null> {
  const { currentUser } = req;
  if (!currentUser || currentUser === 'user:anonymous') return null;
  const limit = Math.max(1, Math.min(5000, Math.floor(req.limit)));
  const { rows } = await pool.query(
    `WITH subjects AS (
       SELECT $1::varchar AS s
       UNION SELECT group_id || '#member' FROM group_memberships WHERE user_id = $1
     ), shared AS (
       SELECT DISTINCT a.resource_id
         FROM resource_effective_acl a
        WHERE a.subject_id IN (SELECT s FROM subjects)
          AND a.source <> 'deny'
          AND a.rung IN ('viewer', 'commenter', 'editor', 'owner')
     )
     SELECT g.gid, g.x, g.y, r.id, r.type, r.title, r.owner_id, r.is_draft,
            r.metadata->>'entityType' AS entity_type,
            r.metadata->'draft' AS m_draft, r.metadata->'isDraft' AS m_is_draft,
            r.metadata->'unlisted' AS m_unlisted, r.metadata->'isUnlisted' AS m_is_unlisted
       FROM shared s
       JOIN graph_nodes g ON g.resource_id = s.resource_id
       JOIN resources r ON r.id = s.resource_id
      WHERE r.owner_id <> $1
        AND g.x BETWEEN $2 AND $3 AND g.y BETWEEN $4 AND $5
        AND NOT EXISTS (
          SELECT 1 FROM resource_effective_acl p
           WHERE p.resource_id = s.resource_id AND p.source <> 'deny'
             AND p.subject_id IN ('user:*', $6))
      LIMIT $7`,
    [currentUser, req.x0, req.x1, req.y0, req.y1, WORKSPACE_SUBJECT, limit]
  );
  const candidates = rows.filter(
    (r) =>
      r.is_draft !== true &&
      !asBooleanFlag(r.m_draft) &&
      !asBooleanFlag(r.m_is_draft) &&
      !asBooleanFlag(r.m_unlisted) &&
      !asBooleanFlag(r.m_is_unlisted)
  );
  let decisions = new Map<string, boolean>();
  if (candidates.length) {
    try {
      if (overlayCheckOverride) decisions = await overlayCheckOverride(currentUser, candidates.map((r) => r.id));
      else {
        const { checkPermissionsBatch } = await import('../openfga');
        decisions = await checkPermissionsBatch({
          user: currentUser,
          relation: 'viewer',
          objects: candidates.map((r) => r.id),
        });
      }
    } catch {
      decisions = new Map();
    }
  }
  const visible = candidates.filter((r) => decisions.get(r.id) === true);
  const { kindCode } = await import('./kinds');
  const n = visible.length;
  const span = Math.max(req.x1 - req.x0, req.y1 - req.y0, 1);
  const tile = emptyTile(0, 0, 0, { worldX: req.x0, worldY: req.y0, worldSize: span }, true);
  tile.empty = n === 0;
  tile.represented = n;
  tile.rects = false;
  tile.nodes = {
    count: n,
    x: Float32Array.from(visible, (r) => r.x),
    y: Float32Array.from(visible, (r) => r.y),
    gid: Uint32Array.from(visible, (r) => Number(r.gid)),
    weight: new Uint32Array(n),
    kind: Uint8Array.from(visible, (r) => kindCode({ id: r.id, type: r.type, entityType: r.entity_type })),
    flags: new Uint8Array(n).fill(4), // LABELLED
  };
  tile.labels = {
    index: Uint32Array.from(visible, (_, i) => i),
    text: visible.map((r) => String(r.title ?? r.id).slice(0, 120)),
  };
  return encodeTile(tile);
}
