import 'dotenv/config';
import pg from 'pg';
import { config } from './config';
import { invalidateSearchCache, isSearchStateMutation } from './cache/searchCache';

const connectionString = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';

const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

let dbInitialized = false;

/**
 * Runtime schema reconciler — DEV ONLY.
 *
 * Scale policy (docs/plans/multiuser-scale.md §6): schema changes must go
 * through `migrations/*` with expand/contract semantics. This function is
 * frozen — no new DDL additions — and is gated to non-production so it can
 * never run `ALTER`/`CREATE TABLE` against a hot production database.
 */
export async function ensureDbInitialized() {
  if (config.isProd) return;
  if (dbInitialized) return;
  try {
    // 1. Column additions
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
      ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT FALSE;
    `);

    // 2. User Identities (Multi-Provider Account Linking)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_identities (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(128) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(64) NOT NULL,
        provider_account_id VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, provider_account_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_identities_email ON user_identities(email);
    `);

    // 3. Auth Settings
    await pool.query(`
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
    `);

    // 4. API Keys
    await pool.query(`
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
    `);

    dbInitialized = true;
  } catch (err: any) {
    console.warn('[DB Init Warning]', err.message);
  }
}

export async function query(text: string, params?: any[]) {
  if (!dbInitialized) {
    await ensureDbInitialized();
  }
  const res = await pool.query(text, params);
  if (isSearchStateMutation(text)) invalidateSearchCache();
  return res;
}

export default pool;
