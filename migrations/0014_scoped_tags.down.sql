-- Refuse to collapse scopes if that would create duplicate global names.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM tags
    GROUP BY name
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot revert scoped tags while duplicate tag names exist';
  END IF;
END $$;

DROP INDEX IF EXISTS tags_scoped_name_unique;
ALTER TABLE tags ADD CONSTRAINT tags_name_key UNIQUE (name);
ALTER TABLE resource_tags DROP COLUMN IF EXISTS tagged_by;
ALTER TABLE tags
  DROP COLUMN IF EXISTS owner_id,
  DROP COLUMN IF EXISTS scope_id,
  DROP COLUMN IF EXISTS scope_type;
