-- Migration: 0003_quartz_frontmatter_and_visibility.down.sql
-- Description: Revert Quartz frontmatter columns

DROP INDEX IF EXISTS idx_resources_draft;
DROP INDEX IF EXISTS idx_resources_tier;
DROP INDEX IF EXISTS idx_resources_unlisted;

ALTER TABLE resources DROP COLUMN IF EXISTS tier;
ALTER TABLE resources DROP COLUMN IF EXISTS unlisted;
