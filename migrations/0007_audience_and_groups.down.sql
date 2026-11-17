-- 0007 down: audience slot + group membership support
--
-- Order matters: drop the audience table before the index it owns, and drop the
-- added columns explicitly rather than relying on IF EXISTS semantics.

DROP TABLE IF EXISTS resource_audience;

DROP INDEX IF EXISTS idx_group_memberships_user;

-- Only the columns are dropped, not the group tables themselves. The `up` half
-- creates them `IF NOT EXISTS`, so on a database that already had them from
-- docker/postgres/init.sql a rollback must not delete real group data — and on a
-- database that did not, there is nothing to undo. Symmetric with the fact that
-- `up` is additive.

ALTER TABLE users          DROP COLUMN IF EXISTS space_member_synced_at;
ALTER TABLE groups         DROP COLUMN IF EXISTS synced_at;
ALTER TABLE groups         DROP COLUMN IF EXISTS created_by;
ALTER TABLE group_memberships DROP COLUMN IF EXISTS synced_at;

DROP INDEX IF EXISTS idx_resources_public_listing;
DROP INDEX IF EXISTS idx_resources_public;
DROP INDEX IF EXISTS idx_resources_owner;
DROP INDEX IF EXISTS idx_audience_kind;
