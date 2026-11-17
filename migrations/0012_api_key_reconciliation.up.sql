-- 0012: reconcile the api_keys table with the code that reads it
--
-- `src/lib/auth.ts` has always selected `is_revoked`, `last_used_ip` and
-- `total_requests` from `api_keys`, and `docker/postgres/init.sql` has always
-- created them. But no migration did. 0001 creates the table with `revoked_at`
-- instead, so on a database built from the migration files — which is what a
-- fresh deploy, a CI database, and the e2e suite all get — every scoped
-- personal-API-key request failed with
-- `column "is_revoked" of relation "api_keys" does not exist`.
--
-- That failure is invisible locally: `src/lib/db.ts` carries a dev-only
-- reconciler that adds the missing columns at runtime, so the two paths
-- disagreed and only the migration path was broken.
--
-- Additive only. `revoked_at` is left in place rather than dropped, because
-- dropping a column is a contract step and this migration is the expand half;
-- nothing reads it (`is_revoked` is the flag the code checks). The backfill makes
-- the two representations agree for any key revoked before this ran, so a key
-- cannot be simultaneously "revoked" and "valid" depending on which column a
-- given query happens to read.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_used_ip    VARCHAR(64),
  ADD COLUMN IF NOT EXISTS total_requests  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- `is_revoked` is authoritative going forward; keep the legacy timestamp in step
-- for anything still reading it.
UPDATE api_keys
   SET is_revoked = true
 WHERE revoked_at IS NOT NULL
   AND is_revoked = false;

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id  ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix   ON api_keys (key_prefix);
