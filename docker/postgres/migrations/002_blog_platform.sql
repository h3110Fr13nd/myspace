-- Phase 1 Migration: Permission-native blog platform schema
-- Adds slug, published_at, is_public, content_ref, depth to resources
-- Supports ARBITRARY nesting: collection under collection, any depth
-- Adds comments table
-- Adds avatar_url to users
-- Adds slug + owner_id to groups

-- Step 1: Extend the resource_type enum with new blog-native types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'collection' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'resource_type')) THEN
    ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'collection';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'post' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'resource_type')) THEN
    ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'post';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'page' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'resource_type')) THEN
    ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'page';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'asset' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'resource_type')) THEN
    ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'asset';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'media' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'resource_type')) THEN
    ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'media';
  END IF;
END $$;

-- Step 2: Add new columns to resources table
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS slug         TEXT,
  ADD COLUMN IF NOT EXISTS is_public    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS content_ref  TEXT,         -- MinIO object key for post body / file
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,  -- NULL = draft
  ADD COLUMN IF NOT EXISTS depth        INTEGER NOT NULL DEFAULT 0;  -- 0=space, 1=collection, 2+=nested

-- depth is maintained by trigger or application logic on insert/update
-- path column (already exists) stores materialized path for fast ancestor queries
-- e.g. "space:my-blog/collection:tech/collection:ai/post:gpt5"

-- Unique slug per parent (no two siblings can share a slug)
CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_slug_parent
  ON resources (parent_id, slug)
  WHERE slug IS NOT NULL;

-- Index for public content queries
CREATE INDEX IF NOT EXISTS idx_resources_is_public ON resources (is_public, type);
CREATE INDEX IF NOT EXISTS idx_resources_published  ON resources (published_at DESC, type);
CREATE INDEX IF NOT EXISTS idx_resources_owner      ON resources (owner_id);

-- Full text search on path (for ancestor prefix lookups)
CREATE INDEX IF NOT EXISTS idx_resources_path_prefix ON resources (path text_pattern_ops);

-- Step 3: Augment users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Step 4: Augment groups table with slug and owner
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS slug     TEXT,
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_slug ON groups (slug) WHERE slug IS NOT NULL;

-- Step 5: Comments table
CREATE TABLE IF NOT EXISTS comments (
  id          BIGSERIAL PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_resource ON comments (resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_author   ON comments (author_id);

-- Step 6: Seed a default Space for the superadmin user (if exists)
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, slug, is_public, metadata)
SELECT
  'space:main-blog',
  'space',
  'tenant_default',
  NULL,
  u.id,
  'space:main-blog',
  'My Blog',
  'main-blog',
  TRUE,
  '{"description": "Primary publishing space"}'::jsonb
FROM users u
WHERE u.email = 'dummy_mail'
  AND NOT EXISTS (SELECT 1 FROM resources WHERE id = 'space:main-blog')
LIMIT 1;
