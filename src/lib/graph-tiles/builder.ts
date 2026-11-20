/**
 * Graph tile builder — runs in the worker process or from the CLI, never in
 * the app process (it holds the whole graph in typed arrays while it works).
 *
 *   1. Load resources in keyset-paginated pages into typed arrays.
 *   2. Resolve wikilinks in SQL through the slug index, page by page.
 *   3. Give every resource a stable position: existing ones keep theirs, new
 *      ones are placed incrementally next to their parent or link neighbours.
 *   4. Decide scope membership (public is verified against OpenFGA).
 *   5. For each scope, build the LOD pyramid in one shared world square and
 *      write it as a new generation, then switch the scope row atomically.
 *
 * Memory is O(N) typed arrays plus one string per title; at one million
 * resources the measured peak is in docs/perf/SCALING.md.
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type pg from 'pg';
import { buildPyramid, type PyramidMeta } from '../spatial-tiles/pyramid';
import { encodeTile, type TileData } from '../spatial-tiles/codec';
import { adjacencyCSR, placeIncremental, structuralLayout } from '../spatial-tiles/layout';
import { EDGE_KIND, kindCode } from './kinds';
import {
  OWNER_CODE_BASE,
  PUBLIC_CODE,
  PUBLIC_SCOPE,
  WORKSPACE_CODE,
  WORKSPACE_SCOPE,
  WORKSPACE_SUBJECT,
  edgeScopeCode,
  ownerScope,
  scopeOf,
} from './scopes';
import { asBooleanFlag } from '../visibility';
import { CHANGE_MARGIN_MS } from './constants';

export interface BuildOptions {
  pool: pg.Pool;
  /** Which scopes to (re)build. Default: every scope whose data changed. */
  scopes?: 'all' | 'dirty' | string[];
  /** Recompute every position from scratch instead of placing only new items. */
  relayout?: boolean;
  /**
   * How public membership is decided.
   *  - 'openfga' (default): projection candidates, each verified by the engine.
   *  - 'projection': trust the projection. Only for benchmarks and offline
   *    tooling without an engine; refused when NODE_ENV=production.
   */
  verify?: 'openfga' | 'projection';
  pageSize?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  /** Injected for tests: `user:*` viewer decisions for a batch of objects. */
  checkPublic?: (objects: string[]) => Promise<Map<string, boolean>>;
  /** Injected for tests: `space:main#member` viewer decisions for a batch of objects. */
  checkWorkspace?: (objects: string[]) => Promise<Map<string, boolean>>;
}

export interface ScopeReport {
  scope: string;
  generation: number;
  nodes: number;
  edges: number;
  tiles: number;
  bytes: number;
  maxZ: number;
  ms: number;
}

export interface BuildReport {
  resources: number;
  links: number;
  placed: number;
  relayout: boolean;
  world: { x: number; y: number; size: number };
  scopes: ScopeReport[];
  loadMs: number;
  layoutMs: number;
  totalMs: number;
}

interface Source {
  n: number;
  ids: string[];
  titles: string[];
  parent: Int32Array;
  kind: Uint8Array;
  owner: Int32Array; // index into owners
  owners: string[];
  hidden: Uint8Array; // draft or unlisted
  linkSrc: Uint32Array;
  linkDst: Uint32Array;
}

/** Append to a typed array, doubling capacity. */
class U32List {
  data = new Uint32Array(1024);
  length = 0;
  push(v: number) {
    if (this.length === this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  toArray() {
    return this.data.slice(0, this.length);
  }
}

async function loadSource(pool: pg.Pool, pageSize: number): Promise<Source & { rowsMs: number; linksMs: number }> {
  const loadStarted = performance.now();
  const ids: string[] = [];
  const titles: string[] = [];
  const parentIds: (string | null)[] = [];
  const kinds: number[] = [];
  const ownerOf: number[] = [];
  const owners: string[] = [];
  const ownerIndex = new Map<string, number>();
  const hiddenList: number[] = [];
  const index = new Map<string, number>();
  // slug -> holder. The classic graph resolves a slug to its first holder in
  // title order; ties broken by id here so the choice is deterministic.
  const bySlug = new Map<string, number>();
  const linkFrom = new U32List();
  const linkSlug: string[] = [];

  let after = '';
  for (;;) {
    // Only what the graph needs: no content, no canvas payloads.
    const { rows } = await pool.query(
      `SELECT id, type, parent_id, owner_id, title, is_draft,
              metadata->>'entityType' AS entity_type,
              metadata->'draft' AS m_draft, metadata->'isDraft' AS m_is_draft,
              metadata->'unlisted' AS m_unlisted, metadata->'isUnlisted' AS m_is_unlisted,
              metadata->>'slug' AS slug,
              CASE WHEN jsonb_typeof(metadata->'wikilinks') = 'array'
                   THEN metadata->'wikilinks' END AS wikilinks
         FROM resources
        WHERE id > $1
        ORDER BY id
        LIMIT $2`,
      [after, pageSize]
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      const i = ids.length;
      ids.push(r.id);
      index.set(r.id, i);
      titles.push(String(r.title ?? r.id).slice(0, 120));
      parentIds.push(r.parent_id);
      kinds.push(kindCode({ id: r.id, type: r.type, entityType: r.entity_type }));
      let o = ownerIndex.get(r.owner_id);
      if (o === undefined) {
        o = owners.length;
        owners.push(r.owner_id);
        ownerIndex.set(r.owner_id, o);
      }
      ownerOf.push(o);
      const hidden =
        r.is_draft === true ||
        asBooleanFlag(r.m_draft) ||
        asBooleanFlag(r.m_is_draft) ||
        asBooleanFlag(r.m_unlisted) ||
        asBooleanFlag(r.m_is_unlisted);
      hiddenList.push(hidden ? 1 : 0);
      if (typeof r.slug === 'string' && r.slug) {
        const prev = bySlug.get(r.slug);
        if (
          prev === undefined ||
          titles[i] < titles[prev] ||
          (titles[i] === titles[prev] && r.id < ids[prev])
        ) {
          bySlug.set(r.slug, i);
        }
      }
      if (Array.isArray(r.wikilinks)) {
        for (const target of r.wikilinks) {
          if (typeof target !== 'string' || !target) continue;
          linkFrom.push(i);
          linkSlug.push(target);
        }
      }
    }
    after = rows[rows.length - 1].id;
    if (rows.length < pageSize) break;
  }

  const n = ids.length;
  const rowsMs = performance.now() - loadStarted;
  const linksStarted = performance.now();
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const p = parentIds[i];
    parent[i] = p ? index.get(p) ?? -1 : -1;
  }

  // Wikilinks: slug first, then exact id — the classic graph's precedence. Its
  // last-resort substring match is not reproduced: it is O(N) per unresolved
  // link and ambiguous by design. Resolved in memory after the scan, because a
  // per-link SQL lookup measured ~35 us/link (71 s at two million links).
  const src = new U32List();
  const dst = new U32List();
  for (let k = 0; k < linkSlug.length; k++) {
    const s = linkFrom.data[k];
    const t = bySlug.get(linkSlug[k]) ?? index.get(linkSlug[k]);
    if (t === undefined || t === s) continue;
    src.push(s);
    dst.push(t);
  }
  linkSlug.length = 0;

  return {
    rowsMs: Math.round(rowsMs),
    linksMs: Math.round(performance.now() - linksStarted),
    n,
    ids,
    titles,
    parent,
    kind: Uint8Array.from(kinds),
    owner: Int32Array.from(ownerOf),
    owners,
    hidden: Uint8Array.from(hiddenList),
    linkSrc: src.toArray(),
    linkDst: dst.toArray(),
  };
}

/** Load stored positions; returns gid per item (0 = none yet). */
async function loadPositions(pool: pg.Pool, src: Source, pageSize: number) {
  const x = new Float32Array(src.n).fill(NaN);
  const y = new Float32Array(src.n).fill(NaN);
  const gid = new Uint32Array(src.n);
  const index = new Map<string, number>();
  src.ids.forEach((id, i) => index.set(id, i));
  let after = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT gid, resource_id, x, y FROM graph_nodes WHERE gid > $1 ORDER BY gid LIMIT $2`,
      [after, pageSize]
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      const i = index.get(r.resource_id);
      if (i === undefined) continue;
      gid[i] = Number(r.gid);
      x[i] = r.x;
      y[i] = r.y;
    }
    after = Number(rows[rows.length - 1].gid);
    if (rows.length < pageSize) break;
  }
  return { x, y, gid };
}

/**
 * Persist positions for `which` items, assigning gids to new rows.
 *
 * Existing rows are updated through an unnest join on the primary key; no
 * indexed column changes, so Postgres can do heap-only (HOT) updates. New rows
 * get gids drawn from the sequence in one round trip and are plain-inserted.
 * Together this took a million-row relayout from ~58 s to a few seconds.
 */
async function savePositions(
  pool: pg.Pool,
  src: Source,
  pos: { x: Float32Array; y: Float32Array; gid: Uint32Array },
  which: number[],
  // Large batches: each UPDATE...FROM unnest hash-joins against the table, so
  // fewer statements means fewer full scans (a full relayout is rare; the
  // common incremental path only inserts the handful of new rows).
  chunk = 250000
) {
  const existing = which.filter((i) => pos.gid[i] !== 0);
  const fresh = which.filter((i) => pos.gid[i] === 0);
  for (let a = 0; a < existing.length; a += chunk) {
    const part = existing.slice(a, a + chunk);
    await pool.query(
      `UPDATE graph_nodes g SET x = u.x, y = u.y, placed_at = NOW()
         FROM unnest($1::bigint[], $2::real[], $3::real[]) AS u(gid, x, y)
        WHERE g.gid = u.gid`,
      [part.map((i) => pos.gid[i]), part.map((i) => pos.x[i]), part.map((i) => pos.y[i])]
    );
  }
  if (fresh.length === 0) return;
  const { rows } = await pool.query(
    `SELECT nextval(pg_get_serial_sequence('graph_nodes', 'gid')) AS gid FROM generate_series(1, $1)`,
    [fresh.length]
  );
  fresh.forEach((i, k) => {
    pos.gid[i] = Number(rows[k].gid);
  });
  for (let a = 0; a < fresh.length; a += chunk) {
    const part = fresh.slice(a, a + chunk);
    await pool.query(
      `INSERT INTO graph_nodes (gid, resource_id, x, y)
       SELECT * FROM unnest($1::bigint[], $2::varchar[], $3::real[], $4::real[])
       ON CONFLICT (resource_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, placed_at = NOW()`,
      [part.map((i) => pos.gid[i]), part.map((i) => src.ids[i]), part.map((i) => pos.x[i]), part.map((i) => pos.y[i])]
    );
  }
}

/**
 * Shared-layer membership: projection candidates for an audience subject
 * (`user:*` or `space:main#member`), each verified by the engine.
 */
async function audienceMembers(
  opts: BuildOptions,
  src: Source,
  subject: string,
  exclude: Uint8Array | null,
  check: (objects: string[]) => Promise<Map<string, boolean>>
): Promise<Uint8Array> {
  const members = new Uint8Array(src.n);
  const { rows } = await opts.pool.query(
    `SELECT DISTINCT resource_id FROM resource_effective_acl
      WHERE subject_id = $1 AND source <> 'deny'
        AND rung IN ('viewer', 'commenter', 'editor', 'owner')`,
    [subject]
  );
  const index = new Map<string, number>();
  src.ids.forEach((id, i) => index.set(id, i));
  const candidates: number[] = [];
  for (const r of rows) {
    const i = index.get(r.resource_id);
    if (i !== undefined && !src.hidden[i] && !(exclude && exclude[i])) candidates.push(i);
  }

  if (opts.verify === 'projection') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error("verify: 'projection' is not allowed in production");
    }
    for (const i of candidates) members[i] = 1;
    return members;
  }

  const batch = 500;
  for (let a = 0; a < candidates.length; a += batch) {
    const part = candidates.slice(a, a + batch);
    const decisions = await check(part.map((i) => src.ids[i]));
    // Absent means "no decision" and is treated as denied (fail closed).
    for (const i of part) if (decisions.get(src.ids[i]) === true) members[i] = 1;
  }
  return members;
}

/** Public and workspace layer membership. */
async function sharedMembers(opts: BuildOptions, src: Source) {
  const state = await opts.pool.query(`SELECT stale FROM acl_projection_state WHERE id = 1`);
  if (state.rows[0]?.stale !== false) {
    // The candidate lists cannot be trusted; building would either leak or
    // silently drop content. Leave the previous generation in place.
    throw new Error('ACL projection is stale; refusing to build shared graph layers');
  }
  const engine = (user: string) => async (objects: string[]) => {
    const { checkPermissionsBatch } = await import('../openfga');
    return checkPermissionsBatch({ user, relation: 'viewer', objects });
  };
  const isPublic = await audienceMembers(opts, src, 'user:*', null, opts.checkPublic ?? engine('user:*'));
  // "Everyone in the workspace" is checked as the userset itself, which is how
  // the grant is written; a resource already public stays in the public layer.
  const isWorkspace = await audienceMembers(
    opts,
    src,
    WORKSPACE_SUBJECT,
    isPublic,
    opts.checkWorkspace ?? engine(WORKSPACE_SUBJECT)
  );
  return { isPublic, isWorkspace };
}

/** World square shared by every scope so layers tile identically. */
function chooseWorld(
  x: Float32Array,
  y: Float32Array,
  previous: { x: number; y: number; size: number } | null
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < x.length; i++) {
    if (x[i] < minX) minX = x[i];
    if (y[i] < minY) minY = y[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] > maxY) maxY = y[i];
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, size: 1 };
  // Keep the previous square while everything still fits inside it with some
  // margin: an unchanged square keeps unchanged tiles byte-identical, so HTTP
  // caches survive incremental builds.
  if (previous && previous.size > 0) {
    const m = previous.size * 0.02;
    if (
      minX >= previous.x + m &&
      minY >= previous.y + m &&
      maxX <= previous.x + previous.size - m &&
      maxY <= previous.y + previous.size - m
    ) {
      return previous;
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  // Headroom so incremental growth rarely forces a new square.
  const size = 2 ** Math.ceil(Math.log2(extent * 1.25));
  return { x: (minX + maxX) / 2 - size / 2, y: (minY + maxY) / 2 - size / 2, size };
}

async function writeScope(
  pool: pg.Pool,
  scope: string,
  build: (onTile: (t: TileData) => void) => PyramidMeta,
  world: { x: number; y: number; size: number },
  stats: { nodes: number; edges: number; content: { x: number; y: number; w: number; h: number } },
  snapshotAt: Date
): Promise<ScopeReport> {
  const started = performance.now();
  const current = await pool.query(`SELECT generation FROM graph_scopes WHERE scope = $1`, [scope]);
  const generation = (current.rows[0]?.generation ?? 0) + 1;

  const client = await pool.connect();
  let tiles = 0;
  let bytes = 0;
  try {
    // Tiles of the new generation are invisible until the scope row points at
    // it, so readers never observe a half-written pyramid. The pyramid build is
    // synchronous; compressed tiles (~40-60 B per node) are collected and then
    // written in batches, which is smaller than the build's own working set.
    const rows: unknown[][] = [];
    const meta = build((tile) => {
      const raw = encodeTile(tile);
      const gz = gzipSync(raw, { level: 6 });
      const etag = createHash('sha1').update(raw).digest('hex');
      tiles++;
      bytes += gz.byteLength;
      rows.push([scope, generation, tile.z, tile.x, tile.y, tile.leaf, tile.nodes.count, etag, gz]);
    });
    const BATCH = 64;
    for (let a = 0; a < rows.length; a += BATCH) {
      const batch = rows.slice(a, a + BATCH);
      const values: string[] = [];
      const params: unknown[] = [];
      batch.forEach((row, r) => {
        const base = r * 9;
        values.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`
        );
        params.push(...row);
      });
      await client.query(
        `INSERT INTO graph_tiles (scope, generation, z, x, y, leaf, node_count, etag, payload)
         VALUES ${values.join(',')}
         ON CONFLICT (scope, generation, z, x, y) DO UPDATE
           SET leaf = EXCLUDED.leaf, node_count = EXCLUDED.node_count,
               etag = EXCLUDED.etag, payload = EXCLUDED.payload`,
        params
      );
      // Release each batch's buffers as soon as they are written.
      for (let r = a; r < a + batch.length; r++) rows[r] = [];
    }

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO graph_scopes (scope, generation, world_x, world_y, world_size, max_z,
                                 node_count, edge_count, tile_count, bytes, build_ms, built_at, dirty_at,
                                 content_x, content_y, content_w, content_h)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13, $14, $15, $16)
       ON CONFLICT (scope) DO UPDATE SET
         generation = EXCLUDED.generation, world_x = EXCLUDED.world_x, world_y = EXCLUDED.world_y,
         world_size = EXCLUDED.world_size, max_z = EXCLUDED.max_z, node_count = EXCLUDED.node_count,
         content_x = EXCLUDED.content_x, content_y = EXCLUDED.content_y,
         content_w = EXCLUDED.content_w, content_h = EXCLUDED.content_h,
         edge_count = EXCLUDED.edge_count, tile_count = EXCLUDED.tile_count, bytes = EXCLUDED.bytes,
         build_ms = EXCLUDED.build_ms, built_at = EXCLUDED.built_at,
         -- built_at is the *snapshot* time (when loading began), not now. A
         -- change near or after it may not be in these tiles, so the scope
         -- stays dirty and is rebuilt again. The margin covers the trigger's
         -- once-per-second throttle. (Readers do not rely on this for
         -- authorization; they consult graph_dirty_gids.)
         dirty_at = CASE WHEN graph_scopes.dirty_at > $12::timestamptz - interval '5 seconds'
                         THEN graph_scopes.dirty_at ELSE NULL END`,
      [
        scope,
        generation,
        world.x,
        world.y,
        world.size,
        meta.maxZ,
        stats.nodes,
        stats.edges,
        tiles,
        bytes,
        Math.round(performance.now() - started),
        snapshotAt,
        stats.content.x,
        stats.content.y,
        stats.content.w,
        stats.content.h,
      ]
    );
    await client.query('COMMIT');
    // Keep the previous generation for viewers mid-session; drop older ones.
    await client.query(`DELETE FROM graph_tiles WHERE scope = $1 AND generation < $2`, [scope, generation - 1]);
    return {
      scope,
      generation,
      nodes: stats.nodes,
      edges: stats.edges,
      tiles,
      bytes,
      maxZ: meta.maxZ,
      ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query(`DELETE FROM graph_tiles WHERE scope = $1 AND generation = $2`, [scope, generation]).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function buildGraphTiles(opts: BuildOptions): Promise<BuildReport> {
  const t0 = performance.now();
  const pool = opts.pool;
  // Database clock, so it compares correctly with trigger-written dirty_at.
  const snapshotAt: Date = (await pool.query(`SELECT clock_timestamp() AS now`)).rows[0].now;
  const pageSize = opts.pageSize ?? 20000;
  const log = opts.log ?? (() => {});

  const src = await loadSource(pool, pageSize);
  const t1 = performance.now();
  log('loaded resources', {
    resources: src.n,
    links: src.linkSrc.length,
    rowsMs: src.rowsMs,
    linksMs: src.linksMs,
  });

  // --- positions ---------------------------------------------------------------
  const pos = await loadPositions(pool, src, pageSize);
  const { linkStart, linkTargets } = adjacencyCSR(src.n, src.linkSrc, src.linkDst);
  let placed: number[];
  let relayout = Boolean(opts.relayout);
  let unplaced = 0;
  for (let i = 0; i < src.n; i++) if (Number.isNaN(pos.x[i])) unplaced++;
  if (unplaced === src.n) relayout = true;
  if (relayout) {
    const layout = structuralLayout({ count: src.n, parent: src.parent, linkStart, linkTargets });
    pos.x.set(layout.x);
    pos.y.set(layout.y);
    placed = Array.from({ length: src.n }, (_, i) => i);
  } else {
    placed = placeIncremental({ count: src.n, parent: src.parent, linkStart, linkTargets, x: pos.x, y: pos.y });
  }
  await savePositions(pool, src, pos, placed);
  const t2 = performance.now();
  log('positions', { placed: placed.length, relayout, ms: Math.round(t2 - t1) });

  // --- scopes ------------------------------------------------------------------
  // Scope per item as a small integer (0 = public, 1 = workspace, 2 + owner
  // index = that owner's layer, -1 = none) so a million items cost 4 MB, not a
  // million strings.
  const { isPublic, isWorkspace } = await sharedMembers(opts, src);
  const scopeCode = new Int32Array(src.n);
  const scopeName = (code: number) =>
    code === PUBLIC_CODE ? PUBLIC_SCOPE : code === WORKSPACE_CODE ? WORKSPACE_SCOPE : ownerScope(src.owners[code - OWNER_CODE_BASE]);
  for (let i = 0; i < src.n; i++) {
    const name = scopeOf({
      ownerId: src.owners[src.owner[i]],
      hidden: src.hidden[i] === 1,
      publicVerified: isPublic[i] === 1,
      workspaceVerified: isWorkspace[i] === 1,
    });
    scopeCode[i] =
      name === null
        ? -1
        : name === PUBLIC_SCOPE
          ? PUBLIC_CODE
          : name === WORKSPACE_SCOPE
            ? WORKSPACE_CODE
            : OWNER_CODE_BASE + src.owner[i];
  }

  const prevWorld = await pool.query(
    `SELECT world_x, world_y, world_size FROM graph_scopes WHERE scope = $1`,
    [PUBLIC_SCOPE]
  );
  const prev = prevWorld.rows[0]
    ? { x: prevWorld.rows[0].world_x, y: prevWorld.rows[0].world_y, size: prevWorld.rows[0].world_size }
    : null;
  const world = chooseWorld(pos.x, pos.y, prev);
  const worldChanged = !prev || prev.x !== world.x || prev.y !== world.y || prev.size !== world.size;

  // Members per scope, one pass. The shared layers always exist (possibly
  // empty), so a scope that lost every member is rebuilt empty, not left stale.
  const members = new Map<number, number[]>();
  members.set(PUBLIC_CODE, []);
  members.set(WORKSPACE_CODE, []);
  for (let i = 0; i < src.n; i++) {
    const c = scopeCode[i];
    if (c < 0) continue;
    let list = members.get(c);
    if (!list) members.set(c, (list = []));
    list.push(i);
  }
  const allScopes = new Set<string>([...members.keys()].map(scopeName));

  // Which scopes to build.
  let targets: string[];
  if (Array.isArray(opts.scopes)) targets = opts.scopes;
  else if (opts.scopes === 'all' || relayout || worldChanged) targets = [...allScopes];
  else {
    const { rows } = await pool.query(
      `SELECT scope FROM graph_scopes WHERE built_at IS NULL OR dirty_at > built_at`
    );
    const existing = await pool.query(`SELECT scope FROM graph_scopes`);
    const known = new Set(existing.rows.map((r) => r.scope));
    targets = rows.map((r) => r.scope).filter((sc) => allScopes.has(sc));
    for (const sc of allScopes) if (!known.has(sc)) targets.push(sc);
  }
  const wanted = new Set(targets);

  // Degree over every edge, used as node importance in all layers.
  const degree = new Uint32Array(src.n);
  for (let i = 0; i < src.n; i++) {
    if (src.parent[i] >= 0) {
      degree[i]++;
      degree[src.parent[i]]++;
    }
  }
  for (let e = 0; e < src.linkSrc.length; e++) {
    degree[src.linkSrc[e]]++;
    degree[src.linkDst[e]]++;
  }

  // Edges per scope, one pass. Stored as global item indices + kind.
  const scopeEdges = new Map<number, { a: U32List; b: U32List; kind: number[] }>();
  const route = (a: number, b: number, kind: number) => {
    const c = edgeScopeCode(scopeCode[a], scopeCode[b]);
    if (c < 0 || !wanted.has(scopeName(c))) return;
    let bucket = scopeEdges.get(c);
    if (!bucket) scopeEdges.set(c, (bucket = { a: new U32List(), b: new U32List(), kind: [] }));
    bucket.a.push(a);
    bucket.b.push(b);
    bucket.kind.push(kind);
  };
  for (let i = 0; i < src.n; i++) if (src.parent[i] >= 0) route(src.parent[i], i, EDGE_KIND.PARENT);
  for (let e = 0; e < src.linkSrc.length; e++) route(src.linkSrc[e], src.linkDst[e], EDGE_KIND.LINK);

  const local = new Int32Array(src.n).fill(-1);
  const reports: ScopeReport[] = [];
  for (const [code, list] of members) {
    const scope = scopeName(code);
    if (!wanted.has(scope)) continue;
    const m = list.length;
    list.forEach((i, j) => {
      local[i] = j;
    });

    // Ends outside this scope become ghost endpoints.
    const bucket = scopeEdges.get(code);
    const ghostIndex = new Map<number, number>();
    const ghostX: number[] = [];
    const ghostY: number[] = [];
    const endpoint = (i: number) => {
      if (local[i] >= 0) return local[i];
      let g = ghostIndex.get(i);
      if (g === undefined) {
        g = ghostX.length;
        ghostIndex.set(i, g);
        ghostX.push(pos.x[i]);
        ghostY.push(pos.y[i]);
      }
      return m + g;
    };
    const count = bucket ? bucket.a.length : 0;
    const eSrc = new Uint32Array(count);
    const eDst = new Uint32Array(count);
    for (let e = 0; e < count; e++) {
      eSrc[e] = endpoint(bucket!.a.data[e]);
      eDst[e] = endpoint(bucket!.b.data[e]);
    }

    const items = {
      count: m,
      x: Float32Array.from(list, (i) => pos.x[i]),
      y: Float32Array.from(list, (i) => pos.y[i]),
      gid: Uint32Array.from(list, (i) => pos.gid[i]),
      kind: Uint8Array.from(list, (i) => src.kind[i]),
      weight: Uint32Array.from(list, (i) => degree[i]),
      label: (j: number) => src.titles[list[j]],
    };
    const edges = {
      count,
      src: eSrc,
      dst: eDst,
      kind: Uint8Array.from(bucket ? bucket.kind : []),
      ghostX: Float32Array.from(ghostX),
      ghostY: Float32Array.from(ghostY),
    };
    for (const i of list) local[i] = -1;
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    for (let j = 0; j < m; j++) {
      if (items.x[j] < cx0) cx0 = items.x[j];
      if (items.y[j] < cy0) cy0 = items.y[j];
      if (items.x[j] > cx1) cx1 = items.x[j];
      if (items.y[j] > cy1) cy1 = items.y[j];
    }
    const content = m ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : { x: world.x, y: world.y, w: world.size, h: world.size };
    const report = await writeScope(
      pool,
      scope,
      (onTile) => buildPyramid(items, edges, { world }, onTile),
      world,
      { nodes: m, edges: count, content },
      snapshotAt
    );
    reports.push(report);
    if (code < OWNER_CODE_BASE || m > 10000) log('scope built', { ...report });
  }
  log('scopes built', { count: reports.length });

  // Change records older than every scope's snapshot (minus the readers'
  // late-commit margin) are no longer needed.
  await pool.query(
    `DELETE FROM graph_dirty_gids
      WHERE changed_at <= (SELECT min(built_at) FROM graph_scopes WHERE built_at IS NOT NULL)
                          - ($1::int * interval '1 millisecond')`,
    [CHANGE_MARGIN_MS]
  );

  // Scopes whose owner has no private resources left: drop their pyramid.
  const stale = await pool.query(`SELECT scope FROM graph_scopes WHERE scope NOT IN ($1, $2)`, [
    PUBLIC_SCOPE,
    WORKSPACE_SCOPE,
  ]);
  for (const r of stale.rows) {
    if (!allScopes.has(r.scope)) {
      await pool.query(`DELETE FROM graph_tiles WHERE scope = $1`, [r.scope]);
      await pool.query(`DELETE FROM graph_scopes WHERE scope = $1`, [r.scope]);
    }
  }

  return {
    resources: src.n,
    links: src.linkSrc.length,
    placed: placed.length,
    relayout,
    world,
    scopes: reports,
    loadMs: Math.round(t1 - t0),
    layoutMs: Math.round(t2 - t1),
    totalMs: Math.round(performance.now() - t0),
  };
}

export { ownerScope };
