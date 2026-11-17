-- =============================================================================
-- E2E Test Fixture Seed Data
-- Applied by global-setup.ts after running all migrations on the test container.
-- Idempotent — all inserts use ON CONFLICT DO NOTHING.
-- =============================================================================

-- Auth Settings
--
-- Only the columns that migration 0001 actually creates are written here. The
-- enable_* / auto_link_* columns exist solely in the legacy bootstrap DDL in
-- src/lib/db.ts, so naming them here fails against a migrations-built database
-- with `column "enable_google_oauth" ... does not exist`. That failure aborted
-- global setup, and because the seeding step has no fallback the whole suite
-- never started. It is also unnecessary: `getAuthSettings()` reads `SELECT *`
-- and falls back to `true` for every unset flag, so the row below is equivalent
-- to the row the bootstrap would have inserted.
INSERT INTO auth_settings (id, allow_registration, default_role)
VALUES ('default', true, 'viewer')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Users
-- =============================================================================
--
-- Ids are opaque UUIDs, not readable slugs. Migration 0010 added a CHECK
-- constraint (`users_id_format`) that rejects anything but `user:<uuid>`, on the
-- principle that an id derived from an email is an id that breaks when the email
-- changes. These three are fixed, memorable values so the specs can name them:
--   1111...  password user      2222...  google-only user
--   3333...  dual-identity user
-- They are also what `tests/e2e/fixtures/auth.fixture.ts` injects as session
-- cookies, so the two must be changed together.

-- Password-based test user (password: TestPassword123!)
-- bcrypt hash generated at fixture creation time — do NOT change unless password changes
INSERT INTO users (id, email, password_hash, display_name)
VALUES (
  'user:11111111-1111-4111-8111-111111111111',
  'dummy_mail',
  '$2b$10$7.aizTRw2.7x2meyDKROB.1RpLR3.N0a.Q3eqll0aDWNJrtLoOtDy',
  'DUMMY_NAME'
)
ON CONFLICT (id) DO NOTHING;

-- Google OAuth test user (no password — only OAuth identity)
INSERT INTO users (id, email, display_name)
VALUES (
  'user:22222222-2222-4222-8222-222222222222',
  'dummy_mail',
  'DUMMY_NAME'
)
ON CONFLICT (id) DO NOTHING;

-- Dual-identity test user: has both password AND Google linked
-- Used to test auto-linking behaviour
INSERT INTO users (id, email, password_hash, display_name)
VALUES (
  'user:33333333-3333-4333-8333-333333333333',
  'dummy_mail',
  '$2b$10$7.aizTRw2.7x2meyDKROB.1RpLR3.N0a.Q3eqll0aDWNJrtLoOtDy',
  'DUMMY_NAME'
)
ON CONFLICT (id) DO NOTHING;

-- Workspace-level administrator used only by access-navigation E2E coverage.
INSERT INTO users (id, email, display_name)
VALUES (
  'user:44444444-4444-4444-8444-444444444444',
  'dummy_mail',
  'DUMMY_NAME'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- User Identities (OAuth Links)
-- =============================================================================

-- Google identity for test-google user
INSERT INTO user_identities (id, user_id, provider, provider_account_id, email, metadata)
VALUES (
  'ident_google_testgoogle',
  'user:22222222-2222-4222-8222-222222222222',
  'google',
  'google_test_user_123',
  'dummy_mail',
  '{"email_verified": true}'
)
ON CONFLICT (provider, provider_account_id) DO NOTHING;

-- Google identity for dual-auth user
INSERT INTO user_identities (id, user_id, provider, provider_account_id, email, metadata)
VALUES (
  'ident_google_testdual',
  'user:33333333-3333-4333-8333-333333333333',
  'google',
  'google_dual_user_456',
  'dummy_mail',
  '{"email_verified": true}'
)
ON CONFLICT (provider, provider_account_id) DO NOTHING;

-- Password identity for dual-auth user
INSERT INTO user_identities (id, user_id, provider, provider_account_id, email, metadata)
VALUES (
  'ident_password_testdual',
  'user:33333333-3333-4333-8333-333333333333',
  'password',
  'dummy_mail',
  'dummy_mail',
  '{"hasPassword": true}'
)
ON CONFLICT (provider, provider_account_id) DO NOTHING;

-- =============================================================================
-- Personal Root Folders
-- =============================================================================

INSERT INTO resources (id, type, tenant_id, owner_id, path, title, metadata, is_public, is_draft)
VALUES
  (
    'folder:testpassword_root',
    'folder', 'tenant_default', 'user:11111111-1111-4111-8111-111111111111',
    'folder:testpassword_root',
    'DUMMY_NAME Root Vault',
    '{"isPersonalRoot": true}',
    false, false
  ),
  (
    'folder:testgoogle_root',
    'folder', 'tenant_default', 'user:22222222-2222-4222-8222-222222222222',
    'folder:testgoogle_root',
    'DUMMY_NAME Root Vault',
    '{"isPersonalRoot": true}',
    false, false
  ),
  (
    'folder:testdual_root',
    'folder', 'tenant_default', 'user:33333333-3333-4333-8333-333333333333',
    'folder:testdual_root',
    'DUMMY_NAME Root Vault',
    '{"isPersonalRoot": true}',
    false, false
  )
ON CONFLICT (id) DO NOTHING;

-- Subfolder for folder index page tests
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
VALUES (
  'folder:testpassword_notes',
  'folder', 'tenant_default',
  'folder:testpassword_root',
  'user:11111111-1111-4111-8111-111111111111',
  'folder:testpassword_root/notes',
  'Notes',
  '{}',
  false, false
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Resources (Test Content)
-- =============================================================================

-- Public markdown note with aliases, tags, KaTeX content
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, content, metadata, is_public, is_draft)
VALUES (
  'document:public_hello',
  'document', 'tenant_default',
  'folder:testpassword_root',
  'user:11111111-1111-4111-8111-111111111111',
  'folder:testpassword_root/hello-world',
  'Hello World',
  E'# Hello World\n\nThis is a **public** test note.\n\nMath: $E = mc^2$ and display math:\n\n$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$\n\nWikilink: [[private-secret]]\n',
  '{"slug": "e2e-public-hello", "tags": ["test", "public"], "aliases": ["hello", "hello-world"], "author": "testpassword", "category": "Test Notes"}',
  true, false
)
ON CONFLICT (id) DO NOTHING;

-- Isolated editable document for editor E2E so save tests cannot mutate the
-- public search/rendering fixture.
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, content, metadata, is_public, is_draft)
VALUES (
  'document:editor_test',
  'document', 'tenant_default',
  'folder:testpassword_root',
  'user:11111111-1111-4111-8111-111111111111',
  'folder:testpassword_root/editor-test',
  'Editor Test',
  E'# Editor Test\n\nEditable workspace fixture.\n',
  '{"slug": "e2e-editor-test", "tags": ["test"], "author": "testpassword"}',
  false, false
)
ON CONFLICT (id) DO NOTHING;

-- Private markdown note (only owner can see)
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, content, metadata, is_public, is_draft)
VALUES (
  'document:private_secret',
  'document', 'tenant_default',
  'folder:testpassword_root',
  'user:11111111-1111-4111-8111-111111111111',
  'folder:testpassword_root/private-secret',
  'Private Note',
  E'# Secret\n\nThis should NOT be visible to anonymous users or other authenticated users without explicit permission.',
  '{"tags": ["private"]}',
  false, false
)
ON CONFLICT (id) DO NOTHING;

-- Draft note (only owner can see, regardless of is_public)
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, content, metadata, is_public, is_draft)
VALUES (
  'document:draft_wip',
  'document', 'tenant_default',
  'folder:testpassword_root',
  'user:11111111-1111-4111-8111-111111111111',
  'folder:testpassword_root/draft-wip',
  'Draft WIP',
  E'# Work in Progress\n\nThis is a draft and should not be visible to others.',
  '{}',
  true, true
)
ON CONFLICT (id) DO NOTHING;

-- Note inside the /notes subfolder (for folder index page tests)
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, content, metadata, is_public, is_draft)
VALUES (
  'document:notes_child',
  'document', 'tenant_default',
  'folder:testpassword_notes',
  'user:11111111-1111-4111-8111-111111111111',
  'folder:testpassword_root/notes/child-note',
  'Child Note in Notes',
  E'# Child Note\n\nThis note lives inside the notes subfolder.',
  '{"tags": ["subfolder"]}',
  true, false
)
ON CONFLICT (id) DO NOTHING;

-- Public JSON Canvas fixture for E2E interaction sanity tests
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, content, metadata, is_public, is_draft)
VALUES (
  'canvas:public_test_canvas',
  'canvas', 'tenant_default',
  'folder:testpassword_root',
  'user:11111111-1111-4111-8111-111111111111',
  'folder:testpassword_root/test-canvas',
  'Architecture Canvas',
  '',
  '{
    "title": "Architecture Canvas",
    "canvasData": {
      "nodes": [
        { "id": "node-1", "type": "text", "text": "## Microservice A\nCore API service", "x": 100, "y": 100, "width": 260, "height": 140, "color": "1" },
        { "id": "node-2", "type": "text", "text": "## Database Node\nPostgreSQL storage", "x": 450, "y": 100, "width": 260, "height": 140, "color": "4" }
      ],
      "edges": [
        { "id": "edge-1", "fromNode": "node-1", "fromSide": "right", "toNode": "node-2", "toSide": "left", "label": "queries" }
      ]
    }
  }',
  true, false
)
ON CONFLICT (id) DO NOTHING;

-- Publicness is a ReBAC audience grant, not a trusted `is_public` shortcut.
-- These rows mirror the public wildcard tuples provisioned by global-setup.
INSERT INTO resource_audience (resource_id, audience, rung, updated_at)
VALUES
  ('document:public_hello', 'public_link', 'viewer', NOW()),
  ('document:notes_child', 'public_link', 'viewer', NOW()),
  ('canvas:public_test_canvas', 'public_link', 'viewer', NOW())
ON CONFLICT (resource_id) DO UPDATE
  SET audience = EXCLUDED.audience, rung = EXCLUDED.rung, updated_at = NOW();

-- =============================================================================
-- Tags
-- =============================================================================

INSERT INTO tags (id, name) VALUES
  ('tag:test',      'test'),
  ('tag:public',    'public'),
  ('tag:private',   'private'),
  ('tag:subfolder', 'subfolder')
ON CONFLICT (id) DO NOTHING;

INSERT INTO resource_tags (resource_id, tag_id) VALUES
  ('document:public_hello',  'tag:test'),
  ('document:public_hello',  'tag:public'),
  ('document:private_secret', 'tag:private'),
  ('document:notes_child',   'tag:subfolder')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Seeded API Key (for vault-api.spec.ts)
-- Raw key: workspace_key_test_api_key_12345678901234567890123456789012
-- SHA-256: pre-computed, matches validateApiKey() logic
-- =============================================================================

INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes, expires_at, is_revoked)
VALUES (
  'key_test_seeded_001',
  'user:11111111-1111-4111-8111-111111111111',
  'E2E Test API Key',
  'workspace_key',
  -- SHA-256 of 'workspace_key_test_api_key_12345678901234567890123456789012'
  '4afedb01a12dbde48b6c81aa6631bf28856fb94754836e06f532f05ae8dcb90c',
  '["vault:sync", "vault:read", "vault:write", "assets:upload"]',
  NOW() + INTERVAL '90 days',
  false
)
ON CONFLICT (id) DO NOTHING;
