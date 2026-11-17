-- Scope tag names by workspace/user and record the actor who attached them.
-- Existing tags remain in the default workspace scope during the backfill.
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS scope_type VARCHAR(32) NOT NULL DEFAULT 'workspace',
  ADD COLUMN IF NOT EXISTS scope_id VARCHAR(255) NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS owner_id VARCHAR(255);

ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;
ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_scope_type_scope_id_name_key;
DROP INDEX IF EXISTS tags_scope_type_scope_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS tags_scoped_name_unique
  ON tags (scope_type, scope_id, name);

ALTER TABLE resource_tags
  ADD COLUMN IF NOT EXISTS tagged_by VARCHAR(255);
