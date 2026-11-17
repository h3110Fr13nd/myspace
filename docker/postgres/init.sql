-- Enable pgvector & trigram extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Resource Type Enum
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_type') THEN
        CREATE TYPE resource_type AS ENUM (
          'space', 'folder', 'document', 'canvas', 
          'canvas_node', 'sheet', 'form', 'pdf', 'image', 'block',
          'blog', 'todo', 'collection',
          'excalidraw', 'mermaid', 'google_doc', 'google_sheet', 'paper'
        );
    END IF;
END $$;

ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'blog';
ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'todo';
ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'collection';
ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'excalidraw';
ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'mermaid';
ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'google_doc';
ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'google_sheet';
ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'paper';

-- Centralized Resources Table
CREATE TABLE IF NOT EXISTS resources (
    id VARCHAR(512) PRIMARY KEY,
    type resource_type NOT NULL,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
    parent_id VARCHAR(512) REFERENCES resources(id) ON DELETE CASCADE,
    owner_id VARCHAR(512) NOT NULL,
    path TEXT NOT NULL,
    title VARCHAR(512) NOT NULL,
    content TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_public BOOLEAN DEFAULT FALSE,
    is_draft BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_resources_tenant_parent ON resources(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_resources_path ON resources USING GIST (path gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_resources_public ON resources(is_public);

-- Tags Table
CREATE TABLE IF NOT EXISTS tags (
    id VARCHAR(512) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    scope_type VARCHAR(64) NOT NULL DEFAULT 'global',
    scope_id VARCHAR(512) NOT NULL DEFAULT 'global',
    owner_id VARCHAR(512) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scope_type, scope_id, name)
);

-- Resource Tags Association Table
CREATE TABLE IF NOT EXISTS resource_tags (
    resource_id VARCHAR(512) REFERENCES resources(id) ON DELETE CASCADE ON UPDATE CASCADE,
    tag_id VARCHAR(512) REFERENCES tags(id) ON DELETE CASCADE ON UPDATE CASCADE,
    tagged_by VARCHAR(512) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(resource_id, tag_id)
);

-- Users Table (Identity Sync & Passwords)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(128) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    display_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Add password_hash & avatar_url column if missing in existing table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Multi-Provider User Identities Table (Account Linking)
CREATE TABLE IF NOT EXISTS user_identities (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL, -- 'google', 'password', 'github', etc.
    provider_account_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_email ON user_identities(email);

-- Site-Wide Authentication Configuration
CREATE TABLE IF NOT EXISTS auth_settings (
    id VARCHAR(64) PRIMARY KEY DEFAULT 'default',
    enable_google_oauth BOOLEAN DEFAULT TRUE,
    enable_password_auth BOOLEAN DEFAULT TRUE,
    enable_registration BOOLEAN DEFAULT TRUE,
    auto_link_same_email BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO auth_settings (id, enable_google_oauth, enable_password_auth, enable_registration, auto_link_same_email)
VALUES ('default', TRUE, TRUE, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Scoped Personal API Keys (Fine-Grained Vault & API Access)
CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    scopes TEXT[] DEFAULT ARRAY['vault:sync', 'vault:read', 'vault:write', 'assets:upload'],
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    last_used_ip VARCHAR(64),
    total_requests INT DEFAULT 0,
    is_revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- Groups Table
CREATE TABLE IF NOT EXISTS groups (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default'
);

-- Group Memberships Table
CREATE TABLE IF NOT EXISTS group_memberships (
    group_id VARCHAR(128) REFERENCES groups(id) ON DELETE CASCADE,
    user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

-- Seed Initial Users & Demo Resources
INSERT INTO users (id, email, display_name) VALUES
    ('user:alice', 'dummy_mail', 'DUMMY_NAME'),
    ('user:bob', 'dummy_mail', 'DUMMY_NAME'),
    ('user:carol', 'dummy_mail', 'DUMMY_NAME')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_identities (id, user_id, provider, provider_account_id, email) VALUES
    ('ident_alice_pwd', 'user:alice', 'password', 'dummy_mail', 'dummy_mail'),
    ('ident_bob_pwd', 'user:bob', 'password', 'dummy_mail', 'dummy_mail'),
    ('ident_carol_pwd', 'user:carol', 'password', 'dummy_mail', 'dummy_mail')
ON CONFLICT DO NOTHING;

INSERT INTO groups (id, name) VALUES
    ('group:engineers', 'Engineering Team'),
    ('group:contractors', 'External Contractors')
ON CONFLICT (id) DO NOTHING;

INSERT INTO group_memberships (group_id, user_id) VALUES
    ('group:engineers', 'user:alice'),
    ('group:contractors', 'user:bob')
ON CONFLICT DO NOTHING;

INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata) VALUES
    ('space:main', 'space', 'tenant_default', NULL, 'user:alice', 'space:main', 'Main Workspace', '{"description": "Root workspace space"}'::jsonb),
    ('folder:docs', 'folder', 'tenant_default', 'space:main', 'user:alice', 'space:main/folder:docs', 'Documentation Vault', '{"description": "General docs folder"}'::jsonb),
    ('document:arch_doc', 'document', 'tenant_default', 'folder:docs', 'user:alice', 'space:main/folder:docs/document:arch_doc', 'Architecture Specification 2026', '{"format": "markdown"}'::jsonb),
    ('pdf:q3_contract', 'pdf', 'tenant_default', 'folder:docs', 'user:alice', 'space:main/folder:docs/pdf:q3_contract', 'Q3 Master Service Agreement', '{"fileName": "q3_contract.pdf", "pageCount": 12}'::jsonb),
    ('canvas:spatial_board', 'canvas', 'tenant_default', 'space:main', 'user:alice', 'space:main/canvas:spatial_board', 'System Knowledge Graph Board', '{"specVersion": "1.0"}'::jsonb),
    ('sheet:financial_q3', 'sheet', 'tenant_default', 'space:main', 'user:alice', 'space:main/sheet:financial_q3', 'Financial Q3 Budget Sheet', '{"rows": 50, "cols": 10}'::jsonb)
ON CONFLICT (id) DO NOTHING;
