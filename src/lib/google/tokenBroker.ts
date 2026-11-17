import { query } from '../db';

export interface GoogleIdentityMetadata {
  accessToken?: string;
  refreshToken?: string;
  tokenIssuedAt?: number;
  expiresIn?: number;
  expiryDate?: number;
  email?: string;
  scope?: string;
  [key: string]: any;
}

/**
 * Unified, centralized Google OAuth Token Broker.
 * Handles automatic token expiration checks, refresh token exchanges,
 * and persistence in PostgreSQL user_identities table.
 */
export async function getValidGoogleAccessToken(userId: string): Promise<string | null> {
  if (!userId || userId === 'user:anonymous') {
    return null;
  }

  try {
    const res = await query(
      `SELECT metadata FROM user_identities WHERE user_id = $1 AND provider = 'google'`,
      [userId]
    );

    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    const meta: GoogleIdentityMetadata = res.rows[0].metadata || {};
    let accessToken = meta.accessToken;
    const refreshToken = meta.refreshToken;
    const tokenIssuedAt = meta.tokenIssuedAt || 0;
    const expiresIn = (meta.expiresIn || 3600) * 1000;
    const isExpired = !accessToken || Date.now() - tokenIssuedAt > expiresIn - 120000; // 2 minute buffer

    if (!isExpired) {
      return accessToken ?? null;
    }

    // Refresh access token using refresh_token
    if (!refreshToken) {
      console.warn(`[TokenBroker] User ${userId} has no refresh token to renew Google access`);
      return null;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || (import.meta as any).env?.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (import.meta as any).env?.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('[TokenBroker] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment');
      return null;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[TokenBroker] Failed to refresh Google access token: ${tokenRes.status} ${errBody}`);
      return null;
    }

    const tokens = await tokenRes.json();
    accessToken = tokens.access_token;
    meta.accessToken = accessToken;
    meta.tokenIssuedAt = Date.now();
    if (tokens.expires_in) {
      meta.expiresIn = tokens.expires_in;
    }

    await query(
      `UPDATE user_identities SET metadata = $1, updated_at = NOW() WHERE user_id = $2 AND provider = 'google'`,
      [JSON.stringify(meta), userId]
    );

    return accessToken ?? null;
  } catch (err: any) {
    console.error(`[TokenBroker] Error obtaining Google access token for user ${userId}:`, err.message);
    return null;
  }
}
