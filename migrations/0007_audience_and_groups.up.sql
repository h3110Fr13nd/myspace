-- 0007: audience slot + group membership support
--
-- Replaces two sources of truth with one.
--
-- BEFORE: `resources.is_public` decided public access in application code
-- (src/lib/permissions.ts returned true on that flag BEFORE consulting OpenFGA),
-- while the authorization model admitted no typed wildcard, so no `user:*` tuple
-- could ever be written. Result: 101 resources were "public" in Postgres and
-- private in the graph. Auditing via OpenFGA under-reported by 101, and revoking
-- public access required remembering to clear two things in two systems.
--
-- AFTER: the audience slot in this table is the declarative intent; the OpenFGA
-- graph is the enforcement; `resources.is_public` becomes a derived cache that
-- is never read as an authorization input (guarded by a test).
--
-- The group tables already existed but nothing ever wrote `group:X#member`
-- tuples, so a grant to a group succeeded and resolved to nobody.

-- ─── Audience ────────────────────────────────────────────────────────────────
-- Exactly one row per resource. Mirrors Notion's "General access" slot: a single
-- exclusive audience plus its own role, composed additively with per-principal
-- grants.
CREATE TABLE IF NOT EXISTS resource_audience (
  resource_id  VARCHAR(512) PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  audience     VARCHAR(16)  NOT NULL DEFAULT 'restricted',
  rung         VARCHAR(16),
  expires_at   TIMESTAMPTZ,
  updated_by   VARCHAR(256),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT resource_audience_kind
    CHECK (audience IN ('restricted', 'workspace', 'public_link')),

  -- An audience only carries a role when it is actually open to someone.
  CONSTRAINT resource_audience_rung_required
    CHECK ((audience = 'restricted' AND rung IS NULL)
        OR (audience <> 'restricted' AND rung IN ('viewer', 'editor')))
);

CREATE INDEX IF NOT EXISTS idx_audience_kind ON resource_audience (audience);

-- ─── Group membership provenance ─────────────────────────────────────────────
-- `group_memberships` is authoritative for who is in a group; the FGA tuples are
-- a projection of it. `synced_at` lets reconciliation find rows that were never
-- projected, so a failed write is visible instead of silently granting nothing.
--
-- The two group tables are created here, `IF NOT EXISTS`, because until now the
-- only place they existed was docker/postgres/init.sql — so this migration's
-- `ALTER TABLE`s succeeded on any database Docker had provisioned and failed
-- with `relation "group_memberships" does not exist` on any database built from
-- the migration files alone. That is a real gap, not a test artefact: it is the
-- difference between the schema being reproducible and being a side effect of the
-- image. Column shapes match init.sql exactly, so an existing database is
-- untouched and a fresh one comes out the same either way.
CREATE TABLE IF NOT EXISTS groups (
  id        VARCHAR(128) PRIMARY KEY,
  name      VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(64)  NOT NULL DEFAULT 'tenant_default'
);

CREATE TABLE IF NOT EXISTS group_memberships (
  group_id VARCHAR(128) REFERENCES groups(id) ON DELETE CASCADE,
  user_id  VARCHAR(128) REFERENCES users(id)  ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS created_by  VARCHAR(256),
  ADD COLUMN IF NOT EXISTS synced_at   TIMESTAMPTZ;

-- ─── Supporting indexes ──────────────────────────────────────────────────────
-- The live schema had no index on owner_id, so "what has this user shared?"
-- was a full table scan over 913 rows and counting.
CREATE INDEX IF NOT EXISTS idx_resources_owner ON resources (owner_id);
CREATE INDEX IF NOT EXISTS idx_resources_public ON resources (is_public);

-- Listing the public surface must not require scanning every resource.
CREATE INDEX IF NOT EXISTS idx_resources_public_listing
  ON resources (is_public, type)
  WHERE is_public = true;

-- Group lookups by member, for the "groups am I in?" path.
CREATE INDEX IF NOT EXISTS idx_group_memberships_user ON group_memberships (user_id);

-- ─── Workspace membership ────────────────────────────────────────────────────
-- "Everyone in the workspace" is expressed as `space:main#member` in the graph,
-- so every user needs a membership tuple. Tracking the projection time lets
-- reconciliation find users who were never added.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS space_member_synced_at TIMESTAMPTZ;
