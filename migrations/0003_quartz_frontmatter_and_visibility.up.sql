-- Migration: 0003_quartz_frontmatter_and_visibility.up.sql
-- Description: Enhancements for Quartz v5 frontmatter visibility (unlisted, draft, tier, search vector)

ALTER TABLE resources ADD COLUMN IF NOT EXISTS unlisted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS tier VARCHAR(32) NOT NULL DEFAULT 'free';

CREATE INDEX IF NOT EXISTS idx_resources_unlisted ON resources(unlisted);
CREATE INDEX IF NOT EXISTS idx_resources_tier ON resources(tier);
CREATE INDEX IF NOT EXISTS idx_resources_draft ON resources(is_draft);
