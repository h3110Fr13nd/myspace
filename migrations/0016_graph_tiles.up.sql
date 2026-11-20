-- Tiled graph: stable node positions and pre-built level-of-detail tiles.
--
-- Why: the graph endpoint used to load every visible resource, build the whole
-- node/link list in the app process and ship it as one JSON document, which the
-- browser then laid out with a live force simulation. Both ends were O(N) per
-- view. Positions are now data (computed once, incrementally), and a viewer
-- fetches only the handful of bounded-size tiles covering its screen.
-- See docs/perf/SCALING.md.

-- Stable layout. `gid` is the compact numeric id carried inside tiles; it is
-- resolved back to a resource only when a user clicks or hovers.
CREATE TABLE IF NOT EXISTS graph_nodes (
  gid          BIGSERIAL PRIMARY KEY,
  resource_id  VARCHAR(255) NOT NULL UNIQUE REFERENCES resources(id) ON DELETE CASCADE,
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  placed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No spatial index on (x, y): tiles are the spatial index. A GiST index here
-- measured ~55 s of index maintenance per million-row relayout, and per-request
-- viewport lookups only ever filter small candidate sets.

-- One row per pyramid. Scope is 'public' (visible to user:*) or
-- 'owner:<user id>' (that user's own resources not already public).
CREATE TABLE IF NOT EXISTS graph_scopes (
  scope        VARCHAR(300) PRIMARY KEY,
  generation   INTEGER NOT NULL DEFAULT 0,
  world_x      DOUBLE PRECISION NOT NULL DEFAULT 0,
  world_y      DOUBLE PRECISION NOT NULL DEFAULT 0,
  world_size   DOUBLE PRECISION NOT NULL DEFAULT 1,
  -- Bounding box of the scope's nodes, so clients can frame the content rather
  -- than the (padded, power-of-two) world square.
  content_x    DOUBLE PRECISION NOT NULL DEFAULT 0,
  content_y    DOUBLE PRECISION NOT NULL DEFAULT 0,
  content_w    DOUBLE PRECISION NOT NULL DEFAULT 0,
  content_h    DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_z        SMALLINT NOT NULL DEFAULT 0,
  node_count   INTEGER NOT NULL DEFAULT 0,
  edge_count   INTEGER NOT NULL DEFAULT 0,
  tile_count   INTEGER NOT NULL DEFAULT 0,
  bytes        BIGINT NOT NULL DEFAULT 0,
  build_ms     INTEGER,
  built_at     TIMESTAMPTZ,
  -- Set when source data or authorization changed after `built_at`. While set,
  -- tiles from this scope are re-verified on read before being served.
  dirty_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS graph_tiles (
  scope        VARCHAR(300) NOT NULL,
  generation   INTEGER NOT NULL,
  z            SMALLINT NOT NULL,
  x            INTEGER NOT NULL,
  y            INTEGER NOT NULL,
  leaf         BOOLEAN NOT NULL,
  node_count   INTEGER NOT NULL,
  etag         VARCHAR(40) NOT NULL,
  -- gzip-compressed GTL1 tile. Served as-is with Content-Encoding: gzip, so a
  -- tile request costs the app a primary-key read and a byte copy — no CPU.
  payload      BYTEA NOT NULL,
  PRIMARY KEY (scope, generation, z, x, y)
);
-- Payloads are already compressed; skip TOAST's pglz attempt.
ALTER TABLE graph_tiles ALTER COLUMN payload SET STORAGE EXTERNAL;

-- Slug lookups (canvas and resource routes filter on metadata->>'slug') use an
-- index instead of a sequential scan over every resource.
CREATE INDEX IF NOT EXISTS idx_resources_slug ON resources ((metadata->>'slug'));

-- Change tracking.
--
-- A pyramid is a snapshot, so anything that changed since it was built must be
-- re-checked before a tile containing it is served. Two levels:
--
--   graph_scopes.dirty_at  "something in this scope changed" — schedules a
--                          rebuild. Bumped at most once per second, so the
--                          shared scope row is not a lock hot spot for writers.
--   graph_dirty_gids       *which* nodes changed. Readers re-verify a tile's
--                          nodes that appear here (changed since the build, with
--                          a safety margin for transactions that commit late)
--                          and serve every other tile untouched. This — not
--                          dirty_at — is the authorization signal.
--
-- All triggers are statement-level with transition tables: one statement per
-- write statement, never a per-row trigger on the hot path. Transition tables
-- allow one event per trigger, hence several triggers sharing functions.
CREATE TABLE IF NOT EXISTS graph_dirty_gids (
  gid         BIGINT PRIMARY KEY,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_graph_dirty_gids_changed ON graph_dirty_gids (changed_at);

CREATE OR REPLACE FUNCTION graph_mark_resources_dirty() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The node rows cascade away with the resource; graph_nodes' own delete
    -- trigger records their gids.
    UPDATE graph_scopes SET dirty_at = clock_timestamp()
     WHERE built_at IS NOT NULL
       AND (dirty_at IS NULL OR dirty_at <= built_at OR dirty_at < clock_timestamp() - interval '1 second')
       AND (scope = 'public' OR scope IN (SELECT DISTINCT 'owner:' || owner_id FROM old_rows));
  ELSE
    IF TG_OP = 'UPDATE' THEN
      INSERT INTO graph_dirty_gids (gid, changed_at)
      SELECT g.gid, clock_timestamp() FROM new_rows r JOIN graph_nodes g ON g.resource_id = r.id
      ON CONFLICT (gid) DO UPDATE SET changed_at = EXCLUDED.changed_at;
    END IF;
    UPDATE graph_scopes SET dirty_at = clock_timestamp()
     WHERE built_at IS NOT NULL
       AND (dirty_at IS NULL OR dirty_at <= built_at OR dirty_at < clock_timestamp() - interval '1 second')
       AND (scope = 'public' OR scope IN (SELECT DISTINCT 'owner:' || owner_id FROM new_rows));
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS resources_graph_dirty_ins ON resources;
DROP TRIGGER IF EXISTS resources_graph_dirty_upd ON resources;
DROP TRIGGER IF EXISTS resources_graph_dirty_del ON resources;
CREATE TRIGGER resources_graph_dirty_ins AFTER INSERT ON resources
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION graph_mark_resources_dirty();
CREATE TRIGGER resources_graph_dirty_upd AFTER UPDATE ON resources
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION graph_mark_resources_dirty();
CREATE TRIGGER resources_graph_dirty_del AFTER DELETE ON resources
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION graph_mark_resources_dirty();

-- Deleted resources: record the gids of the cascaded node rows.
CREATE OR REPLACE FUNCTION graph_mark_nodes_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO graph_dirty_gids (gid, changed_at)
  SELECT gid, clock_timestamp() FROM old_rows
  ON CONFLICT (gid) DO UPDATE SET changed_at = EXCLUDED.changed_at;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS graph_nodes_deleted ON graph_nodes;
CREATE TRIGGER graph_nodes_deleted AFTER DELETE ON graph_nodes
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION graph_mark_nodes_deleted();

-- Authorization changes (the projection mirrors OpenFGA) can revoke public
-- visibility: record the affected nodes and dirty the public pyramid.
CREATE OR REPLACE FUNCTION graph_mark_acl_dirty() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO graph_dirty_gids (gid, changed_at)
    SELECT g.gid, clock_timestamp() FROM (SELECT DISTINCT resource_id FROM old_rows) a
      JOIN graph_nodes g ON g.resource_id = a.resource_id
    ON CONFLICT (gid) DO UPDATE SET changed_at = EXCLUDED.changed_at;
  ELSE
    INSERT INTO graph_dirty_gids (gid, changed_at)
    SELECT g.gid, clock_timestamp() FROM (SELECT DISTINCT resource_id FROM new_rows) a
      JOIN graph_nodes g ON g.resource_id = a.resource_id
    ON CONFLICT (gid) DO UPDATE SET changed_at = EXCLUDED.changed_at;
  END IF;
  UPDATE graph_scopes SET dirty_at = clock_timestamp()
   WHERE scope = 'public' AND built_at IS NOT NULL
     AND (dirty_at IS NULL OR dirty_at <= built_at OR dirty_at < clock_timestamp() - interval '1 second');
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS acl_graph_dirty ON resource_effective_acl;
DROP TRIGGER IF EXISTS acl_graph_dirty_ins ON resource_effective_acl;
DROP TRIGGER IF EXISTS acl_graph_dirty_upd ON resource_effective_acl;
DROP TRIGGER IF EXISTS acl_graph_dirty_del ON resource_effective_acl;
CREATE TRIGGER acl_graph_dirty_ins AFTER INSERT ON resource_effective_acl
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION graph_mark_acl_dirty();
CREATE TRIGGER acl_graph_dirty_upd AFTER UPDATE ON resource_effective_acl
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION graph_mark_acl_dirty();
CREATE TRIGGER acl_graph_dirty_del AFTER DELETE ON resource_effective_acl
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION graph_mark_acl_dirty();
