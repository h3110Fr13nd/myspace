import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from './db';
import { config } from './config';
import { denyJwt, isJwtDenied } from './cache';
import { safeLocalRedirect } from './authRedirect';

const JWT_SECRET = process.env.JWT_SECRET || 'foss_workspace_jwt_secret_key_2026';

const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

export interface UserPayload {
  userId: string;
  email: string;
  displayName: string;
}

export interface UserIdentity {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  email: string | null;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface AuthSettings {
  enableGoogleOauth: boolean;
  enablePasswordAuth: boolean;
  enableRegistration: boolean;
  autoLinkSameEmail: boolean;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  totalRequests: number;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Passwords & JWT ─────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

export function signJwtToken(payload: UserPayload): string {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyJwtToken(token: string): UserPayload | null {
  try {
    const { jti: _jti, ...rest } = jwt.verify(token, JWT_SECRET) as UserPayload & { jti?: string };
    return rest;
  } catch {
    return null;
  }
}

export type GoogleOAuthPurpose = 'auth' | 'drive_sync';

export interface GoogleOAuthState {
  purpose: GoogleOAuthPurpose;
  returnTo: string;
}

/** Sign short-lived OAuth context stored in an HttpOnly cookie, not sent to Google. */
export function signGoogleOAuthStateCookie(
  nonce: string,
  purpose: GoogleOAuthPurpose,
  returnTo: string
): string {
  return jwt.sign(
    { nonce, purpose, returnTo: safeLocalRedirect(returnTo) },
    JWT_SECRET,
    { expiresIn: '10m', audience: 'google-oauth-state' }
  );
}

/** Verify callback state against the browser nonce and return its same-site intent. */
export function verifyGoogleOAuthStateCookie(
  token: string | undefined,
  nonce: string | null
): GoogleOAuthState | null {
  if (!token || !nonce) return null;
  try {
    const claims = jwt.verify(token, JWT_SECRET, { audience: 'google-oauth-state' }) as {
      nonce?: unknown;
      purpose?: unknown;
      returnTo?: unknown;
    };
    if (
      claims.nonce !== nonce ||
      (claims.purpose !== 'auth' && claims.purpose !== 'drive_sync') ||
      typeof claims.returnTo !== 'string'
    ) return null;
    return {
      purpose: claims.purpose,
      returnTo: safeLocalRedirect(claims.returnTo),
    };
  } catch {
    return null;
  }
}

/** Unverified `jti` read — denylist key only, never an auth decision. */
export function extractJti(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { jti?: unknown };
    return typeof claims.jti === 'string' && claims.jti ? claims.jti : null;
  } catch {
    return null;
  }
}

/** `verifyJwtToken` + Redis denylist check, active only when `config.sessionStore` is set. */
export async function verifySessionToken(token: string): Promise<UserPayload | null> {
  const payload = verifyJwtToken(token);
  if (!config.sessionStore || !payload) return payload;
  try {
    const jti = extractJti(token);
    if (jti && (await isJwtDenied(jti))) return null;
  } catch {
    /* fail open — denylist is an optimization, not a hard dependency */
  }
  return payload;
}

/** Denylist a session's `jti` until its natural expiry. No-op without `config.sessionStore`. */
export async function revokeSessionToken(token: string): Promise<void> {
  if (!config.sessionStore) return;
  try {
    const jti = extractJti(token);
    if (jti) await denyJwt(jti, SESSION_TTL_SEC);
  } catch {
    /* no-op */
  }
}

// ─── Multi-Provider Identity & Account Linking ───────────────────────────────

export async function getAuthSettings(): Promise<AuthSettings> {
  try {
    const res = await query('SELECT * FROM auth_settings WHERE id = $1', ['default']);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        enableGoogleOauth: row.enable_google_oauth ?? true,
        enablePasswordAuth: row.enable_password_auth ?? true,
        enableRegistration: row.enable_registration ?? true,
        autoLinkSameEmail: row.auto_link_same_email ?? true,
      };
    }
  } catch (e) {
    console.warn('[getAuthSettings] Falling back to default settings:', e);
  }
  return {
    enableGoogleOauth: true,
    enablePasswordAuth: true,
    enableRegistration: true,
    autoLinkSameEmail: true,
  };
}

export async function getUserIdentities(userId: string): Promise<UserIdentity[]> {
  const res = await query(
    'SELECT * FROM user_identities WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    email: row.email,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }));
}

export async function linkProviderIdentity(
  userId: string,
  provider: string,
  providerAccountId: string,
  email?: string,
  metadata: Record<string, any> = {}
): Promise<void> {
  const identityId = `ident_${provider}_${crypto.randomBytes(6).toString('hex')}`;
  await query(
    `INSERT INTO user_identities (id, user_id, provider, provider_account_id, email, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, provider_account_id)
     DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = NOW()`,
    [identityId, userId, provider, providerAccountId, email || null, JSON.stringify(metadata)]
  );
}

export async function unlinkProviderIdentity(userId: string, provider: string): Promise<boolean> {
  // Ensure user has at least one other login method or a password before unlinking
  const identities = await getUserIdentities(userId);
  const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const hasPassword = !!userRes.rows[0]?.password_hash;

  if (identities.length <= 1 && !hasPassword) {
    throw new Error('Cannot unlink the only active authentication method on your account.');
  }

  const res = await query(
    'DELETE FROM user_identities WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  return (res.rowCount || 0) > 0;
}

export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

  // Ensure 'password' identity is recorded in user_identities
  const userRes = await query('SELECT email FROM users WHERE id = $1', [userId]);
  const email = userRes.rows[0]?.email;
  if (email) {
    await linkProviderIdentity(userId, 'password', email, email, { hasPassword: true });
  }
}

// ─── Scoped API Key Management ───────────────────────────────────────────────

export const DEFAULT_SCOPES = [
  'vault:sync',
  'vault:read',
  'vault:write',
  'assets:upload',
] as const;

export function hashApiKeySecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export async function createApiKey(
  userId: string,
  name: string,
  scopes: string[] = [...DEFAULT_SCOPES],
  expiresInDays: number | null = 90
): Promise<{ apiKey: ApiKeyRecord; rawSecret: string }> {
  const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;
  const randomSecret = crypto.randomBytes(24).toString('hex');
  const keyPrefix = `fsk_${randomSecret.slice(0, 8)}`;
  const rawSecret = `workspace_key_${randomSecret}`;
  const keyHash = hashApiKeySecret(rawSecret);

  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;

  const res = await query(
    `INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [keyId, userId, name, keyPrefix, keyHash, scopes, expiresAt]
  );

  const row = res.rows[0];
  const apiKey: ApiKeyRecord = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
    totalRequests: row.total_requests,
    isRevoked: row.is_revoked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  return { apiKey, rawSecret };
}

export async function validateApiKey(
  rawKey: string,
  requiredScope?: string,
  clientIp?: string
): Promise<{ valid: boolean; userId?: string; scopes?: string[]; error?: string }> {
  if (!rawKey || !rawKey.startsWith('workspace_key_')) {
    return { valid: false, error: 'Invalid API key format' };
  }

  const keyHash = hashApiKeySecret(rawKey);
  const res = await query(
    `SELECT * FROM api_keys WHERE key_hash = $1 AND is_revoked = FALSE`,
    [keyHash]
  );

  if (res.rows.length === 0) {
    return { valid: false, error: 'API key not found or revoked' };
  }

  const row = res.rows[0];

  // Check expiration
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { valid: false, error: 'API key has expired' };
  }

  // Check required scope
  const scopes: string[] = row.scopes || [];
  if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*')) {
    return { valid: false, error: `API key lacks required scope: '${requiredScope}'` };
  }

  // Update telemetry asynchronously
  query(
    `UPDATE api_keys 
     SET last_used_at = NOW(), 
         last_used_ip = $1, 
         total_requests = total_requests + 1 
     WHERE id = $2`,
    [clientIp || null, row.id]
  ).catch((e) => console.warn('[validateApiKey] Telemetry update failed:', e.message));

  return {
    valid: true,
    userId: row.user_id,
    scopes,
  };
}

export async function listUserApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const res = await query(
    `SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
    totalRequests: row.total_requests,
    isRevoked: row.is_revoked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const res = await query(
    `UPDATE api_keys SET is_revoked = TRUE, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [keyId, userId]
  );
  return (res.rowCount || 0) > 0;
}

export async function rollApiKey(
  userId: string,
  keyId: string
): Promise<{ apiKey: ApiKeyRecord; rawSecret: string }> {
  const randomSecret = crypto.randomBytes(24).toString('hex');
  const keyPrefix = `fsk_${randomSecret.slice(0, 8)}`;
  const rawSecret = `workspace_key_${randomSecret}`;
  const keyHash = hashApiKeySecret(rawSecret);

  const res = await query(
    `UPDATE api_keys 
     SET key_prefix = $1, key_hash = $2, is_revoked = FALSE, updated_at = NOW() 
     WHERE id = $3 AND user_id = $4 
     RETURNING *`,
    [keyPrefix, keyHash, keyId, userId]
  );

  if (res.rows.length === 0) {
    throw new Error('API key not found or access denied');
  }

  const row = res.rows[0];
  const apiKey: ApiKeyRecord = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
    totalRequests: row.total_requests,
    isRevoked: row.is_revoked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  return { apiKey, rawSecret };
}
