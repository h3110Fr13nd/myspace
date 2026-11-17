-- 0008: first-class service principals
--
-- The workspace had non-human content owners that were indistinguishable from
-- people: `user:system` owned 175 resources (the public vault — reference
-- papers, example chapters, showcase canvases) and was typed as a `user`, so it
-- looked like an account that had simply gone missing. `scripts/reconcile-acl.ts`
-- reported it as a "phantom owner": 896 of 913 resources were owned by ids that
-- do not exist in `users`, so none of them had a reachable administrator.
--
-- A service account is a different thing from a missing user. It is a principal
-- that owns content without being a person, belonging to no user, team, or
-- group, and holding no workspace membership. Registering it explicitly makes
-- that a fact the system knows rather than a corruption it has to detect.
--
-- The OpenFGA model already had a `service_account` type; it was simply unused.

CREATE TABLE IF NOT EXISTS service_accounts (
  id            VARCHAR(128) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  -- Why this principal exists, so it is not mistaken for an abandoned user.
  kind          VARCHAR(32)  NOT NULL DEFAULT 'platform',
  -- A service account holds no workspace membership and cannot be logged into.
  can_authenticate BOOLEAN   NOT NULL DEFAULT FALSE,
  created_by    VARCHAR(256),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT service_accounts_id_prefix CHECK (id LIKE 'service_account:%')
);

-- Who administers a service account's content. Without this, content owned by a
-- principal nobody can log in as has no reachable administrator — the exact
-- problem the phantom-owner audit surfaced.
CREATE TABLE IF NOT EXISTS service_account_principals (
  service_account_id VARCHAR(128) NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
  principal_id       VARCHAR(256) NOT NULL,
  role               VARCHAR(16)  NOT NULL DEFAULT 'manage_grants',
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (service_account_id, principal_id, role),
  CONSTRAINT service_account_principals_role CHECK (role IN ('manage_grants', 'editor', 'viewer'))
);

CREATE INDEX IF NOT EXISTS idx_service_accounts_kind ON service_accounts (kind);
CREATE INDEX IF NOT EXISTS idx_sa_principals_principal ON service_account_principals (principal_id);

-- The platform's own reference content: self-contained documentation, worked
-- examples, and how-tos. Deliberately ownerless in the human sense — it is the
-- platform demonstrating itself, not a user's work.
INSERT INTO service_accounts (id, name, description, kind, can_authenticate, created_by)
VALUES (
  'service_account:system',
  'Platform Reference Content',
  'Self-contained reference material owned by the platform itself: worked examples, ' ||
  'how-tos, sample vaults and showcase boards. Belongs to no user, team, or group, and ' ||
  'holds no workspace membership. Administered by an explicit human principal.',
  'platform',
  FALSE,
  'system:bootstrap'
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at = NOW();

COMMENT ON TABLE service_accounts IS
  'Non-human principals that own content. Distinct from a user: they cannot authenticate, hold no workspace membership, and are never granted to a person''s content.';
