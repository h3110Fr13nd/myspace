# Plan 16: Scoped Personal API Keys Lifecycle & Authorization System

## Overview
This specification details the fine-grained personal API key system implemented in the FOSS Content Workspace. It enables users to generate cryptographically secure, scoped tokens (`fsk_live_...`) to automate vault synchronization, query documents, and manage assets from headless environments (CLI, Obsidian desktop plugins, GitHub Actions, cron jobs).

---

## 1. Security Architecture

### Key Storage & Validation (Zero-Knowledge Secret Storage)
- **Token Format**: `fsk_live_<48_hex_chars>` (e.g., `fsk_live_8f3a91c0e7b4...`).
- **Database Representation**:
  - The raw secret is **never stored** in the database.
  - The database stores only `key_prefix` (e.g. `fsk_8f3a91c0`) for UI display and identification, and `key_hash = SHA256(rawSecret)` for constant-time lookup.
  - The raw secret is shown **exactly once** in the UI immediately after creation.

```sql
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
```

---

## 2. Fine-Grained Permission Scopes

| Scope | Description | Target Endpoints |
| :--- | :--- | :--- |
| `vault:sync` | Ingest ZIP archives or folders into the user's vault | `POST /api/v1/vault/sync` |
| `vault:read` | Read user's vault hierarchy, notes, and metadata | `GET /api/v1/vault/*`, `GET /api/v1/resources/*` |
| `vault:write` | Create, update, or delete markdown documents and canvases | `POST/PUT/DELETE /api/v1/resources/*` |
| `assets:upload` | Upload binary attachments (PDFs, images) to R2/S3 | `POST /api/v1/assets/*` |
| `admin:iam` | Modify OpenFGA authorization relationship tuples | `POST /api/v1/permissions/*` |
| `*` | Full superuser access to all authorized endpoints | All API routes |

---

## 3. Key Lifecycle Operations

1. **Creation (`createApiKey`)**:
   - Accepts custom label/name, array of scopes, and expiration period (30 days, 90 days, 1 year, or Never).
   - Generates random 24-byte crypto entropy, hashes with SHA-256, writes to DB, returns raw secret once.
2. **Authentication Middleware (`src/middleware.ts`)**:
   - Detects `Authorization: Bearer fsk_live_...` or `x-api-key: fsk_live_...` in request headers.
   - Computes SHA-256 hash, validates expiration date and revocation status.
   - Updates `last_used_at`, `last_used_ip`, and increments `total_requests`.
   - Attaches `locals.user = key.user_id`, `locals.authType = 'api_key'`, and `locals.scopes = key.scopes`.
3. **Revocation (`revokeApiKey`)**:
   - Instantly sets `is_revoked = TRUE`. Any future requests with this key are rejected with `401 Unauthorized`.
4. **Secret Rolling (`rollApiKey`)**:
   - Invalidates the current secret hash and generates a brand new secret string while preserving the key name, assigned scopes, and creation history.

---

## 4. Implemented Files & UI

- `src/lib/auth.ts`: Functions for `createApiKey`, `validateApiKey`, `listUserApiKeys`, `revokeApiKey`, `rollApiKey`.
- `src/pages/api/v1/auth/api-keys/index.ts`: `GET` list keys, `POST` create key.
- `src/pages/api/v1/auth/api-keys/[id]/revoke.ts`: `POST` revoke key.
- `src/pages/api/v1/auth/api-keys/[id]/roll.ts`: `POST` roll secret.
- `src/pages/settings/security.astro`: Complete Security & API Keys Console:
  - Generate modal with checkboxes for fine-grained scopes and expiration select.
  - One-time Secret Copy banner with clipboard helper.
  - Keys table with prefix preview, scopes tags, status badges, request counts, and Roll/Revoke action buttons.


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Fully Implemented | **Security Model**: SHA-256 Scoped Token Delegation

- [x] `api_keys` database schema with SHA-256 hash storage, scopes array, and expiration
- [x] Key generation modal with granular permission scopes (`vault:read`, `vault:write`, `resources:read`, etc.)
- [x] Cryptographic key generation (`fsk_live_...`) with one-time secret display banner
- [x] Middleware API key authentication & header inspection (`src/middleware.ts`)
- [x] Scoped authorization enforcement in API routes (`src/pages/api/v1/vault/sync.ts`, etc.)
- [x] Key revocation (`revokeApiKey`) and secret rolling (`rollApiKey`)
- [x] API Key usage metrics tracking (`last_used_at`, `last_used_ip`, `total_requests`)
