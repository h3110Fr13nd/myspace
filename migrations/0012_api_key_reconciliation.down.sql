-- 0012 down: drop the columns added by the expand half.
--
-- The indexes predate this migration (0001 and init.sql both create them), so
-- they are left alone; only the four columns go. `revoked_at` is untouched — it
-- belongs to 0001, and removing columns the previous revision still selects
-- would leave a rollback that cannot start.

ALTER TABLE api_keys
  DROP COLUMN IF EXISTS total_requests,
  DROP COLUMN IF EXISTS last_used_ip,
  DROP COLUMN IF EXISTS is_revoked,
  DROP COLUMN IF EXISTS updated_at;
