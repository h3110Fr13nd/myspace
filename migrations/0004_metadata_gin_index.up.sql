-- Migration: 0004_metadata_gin_index.up.sql
-- Description: GIN index on resources.metadata for fast JSONB containment
--              queries (e.g. alias lookup: metadata @> '{"aliases":["slug"]}')

CREATE INDEX IF NOT EXISTS idx_resources_metadata_gin
  ON resources USING GIN (metadata jsonb_path_ops);
