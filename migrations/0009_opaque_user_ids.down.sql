-- 0009 down: opaque user identifiers
--
-- The id is NOT restored to its legacy value automatically: doing so would
-- require re-deriving it from the email, which is the behaviour this migration
-- exists to remove, and it would break any id minted after the migration.
-- `legacy_id` is retained, so a rollback is a deliberate re-key per user.

-- Drop the format constraint first so a partially-migrated table can be repaired.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_format;
DROP INDEX IF EXISTS idx_users_legacy_id;

-- Plain statements, matching the up migration.
ALTER TABLE user_identities DROP CONSTRAINT IF EXISTS user_identities_user_id_fkey;
ALTER TABLE user_identities
  ADD CONSTRAINT user_identities_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS fk_apikeys_user;
ALTER TABLE api_keys
  ADD CONSTRAINT fk_apikeys_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE group_memberships DROP CONSTRAINT IF EXISTS group_memberships_user_id_fkey;
ALTER TABLE group_memberships
  ADD CONSTRAINT group_memberships_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- legacy_id is intentionally kept: it is the only record of the pre-migration id.
