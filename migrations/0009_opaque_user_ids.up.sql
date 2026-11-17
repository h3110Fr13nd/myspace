-- 0009: opaque, stable user identifiers
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--
-- `register.ts` minted every id as `user:${email.split('@')[0]}`. That one line
-- was the root cause of the phantom owners this workspace spent a day cleaning up:
-- it produced `user:demo` (678 resources), `user:researcher` (42), and two
-- pieces of junk. It also has two defects that would keep producing them:
--
--   Collision     two users with name 'admin' both mint `user:admin`; the
--                 second registration fails on the primary key, not on identity.
--   Instability   changing identity changes your id, silently dropping every
--                 grant, ACL row, and audit link you had.
--
-- It also let one human exist as two principals — `user:demo` and
-- `user:admin_principal` — which nothing prevented recurring.
--
-- ── The shape ────────────────────────────────────────────────────────────────
--
--   id     = user:<uuid>   stable forever, opaque, carries no PII into the ACL
--   email  = the login handle, already UNIQUE, now explicitly mutable
--   legacy_id = the pre-migration id, so API keys, bookmarks and `x-user-id`
--                callers keep resolving instead of hard-failing
--
-- ── Foreign keys ─────────────────────────────────────────────────────────────
--
-- `user_identities`, `api_keys` and `group_memberships` reference `users(id)`
-- with ON UPDATE NO ACTION, so the re-key script could not run without either a
-- two-phase swap or cascading updates. CASCADE is the honest expression of
-- intent: a principal's id changing must carry its references with it.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS legacy_id VARCHAR(128);

-- Resolvable, so a caller holding a pre-migration id still resolves to a user.
-- Partial: null for anyone registered after the migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_legacy_id
  ON users (legacy_id)
  WHERE legacy_id IS NOT NULL;

-- The `users_id_format` constraint lives in `0010_user_id_format_constraint.sql`,
-- not here. NOT VALID does not help: it skips the initial scan but is still
-- enforced on UPDATE, so it would block the very re-key it was meant to guard.
-- The invariant can only be asserted once the data conforms, so it is asserted
-- after — by a separate migration, so the ordering is explicit rather than a
-- comment asking the reader to remember.

-- ── Let the re-key cascade ───────────────────────────────────────────────────

-- Plain statements rather than a DO block: the constraint names are fixed, and
-- a loop over three of them buys nothing but a parsing failure waiting to happen.
ALTER TABLE user_identities DROP CONSTRAINT IF EXISTS user_identities_user_id_fkey;
ALTER TABLE user_identities
  ADD CONSTRAINT user_identities_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS fk_apikeys_user;
ALTER TABLE api_keys
  ADD CONSTRAINT fk_apikeys_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE group_memberships DROP CONSTRAINT IF EXISTS group_memberships_user_id_fkey;
ALTER TABLE group_memberships
  ADD CONSTRAINT group_memberships_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON COLUMN users.legacy_id IS
  'Pre-migration id (user:<email local part>). Retained so API keys, bookmarks and internal callers resolve. Never minted for new users.';
COMMENT ON COLUMN users.id IS
  'Opaque, immutable principal id. Not derived from the email, so it survives an email change and cannot collide.';
