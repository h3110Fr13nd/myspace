-- 0011: effective access read model
--
-- The Share dialog, the troubleshooter and the "who can reach this?" question all
-- need the same thing: for one resource, who has access, by which path, and at
-- what strength. Answering that from the relationship graph meant re-deriving
-- ReBAC in application code — which is how the troubleshooter came to assert
-- "No Direct Tuple" for a grant that demonstrably existed.
--
-- This table is a PROJECTION of the OpenFGA graph, not a source of truth. It
-- exists so those surfaces are a single indexed read instead of a graph walk.
--
-- ── Properties that matter ───────────────────────────────────────────────────
--
--  * Never an authorization input. Every allow/deny decision is a `check()`
--    against the engine. This table may be stale; the guard layer may not care.
--  * Groups are NOT expanded into members. Expansion is O(groups x members x
--    resources) and it leaks org structure — a viewer of the ACL would learn
--    who is in which team. The ACL renders "Platform team · 14 members".
--  * `depth` records how far the grant was inherited, and `source_resource`
--    names the ancestor, so the UI can say "via Research" instead of leaving the
--    user to work it out.
--  * Staleness is visible: `projected_at` per row, and the projector records its
--    change-feed cursor so reconciliation can tell "up to date" from "stalled".

CREATE TABLE IF NOT EXISTS resource_effective_acl (
  resource_id      VARCHAR(512) NOT NULL,
  subject_type     VARCHAR(16)  NOT NULL,   -- user | group | service_account | audience
  subject_id       VARCHAR(256) NOT NULL,   -- opaque id, group:<id>, or user:*
  rung             VARCHAR(16)  NOT NULL,   -- viewer | editor | owner
  -- How the grant arrived. Drives the provenance chip in the Share dialog.
  source           VARCHAR(16)  NOT NULL,   -- direct | group | inherited | audience | deny
  -- The ancestor that granted it, for inherited rows.
  source_resource  VARCHAR(512),
  -- Which structural relation carried the inheritance.
  via_relation     VARCHAR(32),             -- parent_folder | parent_space | parent_canvas
  depth            SMALLINT     NOT NULL DEFAULT 0,
  projected_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (resource_id, subject_type, subject_id, rung, source),

  CONSTRAINT resource_effective_acl_rung
    CHECK (rung IN ('viewer', 'commenter', 'editor', 'owner')),
  CONSTRAINT resource_effective_acl_source
    CHECK (source IN ('direct', 'group', 'inherited', 'audience', 'deny'))
);

-- "Shared by me": everything I hold a direct grant on, across all resources.
CREATE INDEX IF NOT EXISTS idx_eacl_subject
  ON resource_effective_acl (subject_type, subject_id, rung);

-- Per-resource ACL listing.
CREATE INDEX IF NOT EXISTS idx_eacl_resource
  ON resource_effective_acl (resource_id, rung DESC);

-- Drives the exposure badge, and the "N people can see this" count.
CREATE INDEX IF NOT EXISTS idx_eacl_audience
  ON resource_effective_acl (source, rung)
  WHERE source = 'audience';

-- Change-feed cursor. One row; tells reconciliation whether the projector is
-- keeping up or has silently stalled.
CREATE TABLE IF NOT EXISTS acl_projection_state (
  id                SMALLINT PRIMARY KEY DEFAULT 1,
  cursor            TEXT,             -- OpenFGA readChanges ULID
  last_reconcile_at TIMESTAMPTZ,
  last_change_at    TIMESTAMPTZ,
  tuples_seen       BIGINT NOT NULL DEFAULT 0,
  stale             BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT acl_projection_state_singleton CHECK (id = 1)
);

INSERT INTO acl_projection_state (id) VALUES (1) ON CONFLICT DO NOTHING;

COMMENT ON TABLE resource_effective_acl IS
  'Projection of the OpenFGA graph for fast ACL reads. NEVER an authorization input — decisions are made by check() against the engine. Groups are not expanded into members.';
COMMENT ON COLUMN resource_effective_acl.source IS
  'direct | group | inherited | audience | deny. Renders as the provenance chip in the Share dialog.';
