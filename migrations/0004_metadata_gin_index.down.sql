-- Migration: 0004_metadata_gin_index.down.sql
-- Description: Remove GIN index on resources.metadata

DROP INDEX IF EXISTS idx_resources_metadata_gin;
