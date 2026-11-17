/**
 * Identity primitives.
 *
 * ── Why ids are opaque ───────────────────────────────────────────────────────
 *
 * Ids used to be minted as `user:${email.split('@')[0]}`. That single line was
 * the root cause of the phantom owners: it produced `user:demo` (owning 678
 * resources), `user:researcher` (42), and assorted junk. It also permitted two
 * distinct emails to collide on one id, let a human exist as two principals, and
 * meant an email change silently discarded every grant.
 *
 * The rule now: **the id is opaque and immutable; the email is a mutable
 * attribute.** Nothing outside this module should construct a `user:` id.
 *
 *   id         user:<uuid>          stable forever, no PII in the ACL
 *   email      dummy_mail              login handle, UNIQUE, mutable
 *   legacy_id  user:demo           pre-migration id, still resolvable
 */
import crypto from 'crypto';
import { query } from './db';

/** Mint a fresh, opaque user id. The only sanctioned way to create one. */
export function newUserId(): string {
  return `user:${crypto.randomUUID()}`;
}

const UUID_USER = /^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Session middleware resolves the same opaque id on every page and API request.
// Keep only successful resolutions briefly so a burst from one signed-in user
// does not turn into a burst of identical PostgreSQL lookups. The short TTL
// bounds how long an externally deleted account can retain an existing session;
// no session or permission decision is cached here.
const USER_ID_CACHE_TTL_MS = 10_000;
const USER_ID_CACHE_MAX = 256;
const resolvedUserIds = new Map<string, { id: string; expiresAt: number }>();
const pendingUserIdLookups = new Map<string, Promise<string | null>>();

function getCachedUserId(key: string): string | null {
  const entry = resolvedUserIds.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    resolvedUserIds.delete(key);
    return null;
  }
  // Refresh insertion order to keep the map least-recently-used and bounded.
  resolvedUserIds.delete(key);
  resolvedUserIds.set(key, entry);
  return entry.id;
}

function cacheUserId(key: string, id: string): string {
  resolvedUserIds.delete(key);
  resolvedUserIds.set(key, { id, expiresAt: Date.now() + USER_ID_CACHE_TTL_MS });
  if (resolvedUserIds.size > USER_ID_CACHE_MAX) {
    const oldest = resolvedUserIds.keys().next().value;
    if (oldest !== undefined) resolvedUserIds.delete(oldest);
  }
  return id;
}

/** True when `id` is a well-formed opaque user id. */
export function isOpaqueUserId(id: string): boolean {
  return UUID_USER.test(id);
}

/** Ids that must never be minted for an account. See `register.ts`. */
const RESERVED_USER_IDS = new Set([
  'user:admin',
  'admin',
  'user:administrator',
  'user:root',
  'user:superuser',
  'user:super',
  'user:system',
  'user:service',
  'user:service_account',
  'user:sa',
]);

export function isReservedUserId(id: string): boolean {
  return RESERVED_USER_IDS.has(id.toLowerCase());
}

/**
 * Resolve any reference to a user to its canonical id.
 *
 * Accepts, in order: an opaque id (returned as-is), an email, or a legacy
 * pre-migration id. This is what keeps API keys, bookmarks and internal
 * `x-user-id` callers working across the migration instead of hard-failing.
 *
 * Returns null when nothing matches — callers must treat that as anonymous
 * rather than inventing an identity.
 */
async function lookupUserId(value: string): Promise<string | null> {
  // Already canonical.
  if (isOpaqueUserId(value)) {
    const res = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [value]);
    return res.rows?.length ? cacheUserId(value, value) : null;
  }

  // An email, or a legacy `user:<email>` principal minted before the id
  // migration. Strip the `user:` wrapper before matching on the email column,
  // otherwise a pre-migration session cookie resolves to anonymous.
  if (value.includes('@')) {
    const email = value.startsWith('user:') ? value.slice(5) : value;
    const res = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    const id = res.rows?.[0]?.id;
    return id ? cacheUserId(value, id) : null;
  }

  // A bare local part, as older callers and URLs still use ("demo" → the vault
  // path, for example). This is a display convenience, not an identity.
  const candidates = [value, value.startsWith('user:') ? value : `user:${value}`];
  for (const candidate of candidates) {
    const byLegacy = await query('SELECT id FROM users WHERE legacy_id = $1 LIMIT 1', [candidate]);
    if (byLegacy.rows?.length) return cacheUserId(value, byLegacy.rows[0].id);
    const byId = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [candidate]);
    if (byId.rows?.length) return cacheUserId(value, byId.rows[0].id);
  }
  return null;
}

export async function resolveUserId(input: string | null | undefined): Promise<string | null> {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  if (value === 'user:anonymous' || value === 'user:*') return value;

  const cached = getCachedUserId(value);
  if (cached) return cached;

  // Coalesce concurrent requests for the same identity. A burst of requests
  // from one session now performs one existence lookup, then shares its result.
  const pending = pendingUserIdLookups.get(value);
  if (pending) return pending;

  const lookup = lookupUserId(value);
  pendingUserIdLookups.set(value, lookup);
  try {
    return await lookup;
  } finally {
    if (pendingUserIdLookups.get(value) === lookup) pendingUserIdLookups.delete(value);
  }
}

/** Look up the canonical id for an email. Used by scripts instead of hardcoding. */
export async function userIdForEmail(email: string): Promise<string | null> {
  const res = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
  return res.rows?.[0]?.id ?? null;
}

export interface PrincipalDisplay {
  id: string;
  /** Human-facing name: email, group name, service-account name, or a label. */
  label: string;
  kind: 'user' | 'group' | 'service_account' | 'public';
  /** For groups, how many members — a count, never the list. */
  memberCount?: number;
}

/**
 * Resolve display metadata for ACL rows.
 *
 * The ACL must not show raw ids: an opaque `user:<uuid>` is unreadable, and a
 * `user:dummy_mail` string leaks an email into audit records. Display
 * names are therefore joined here, once, rather than in each component.
 *
 * Groups report a member COUNT and not their members — expanding a group into an
 * ACL view leaks org structure.
 */
export async function displayForPrincipals(
  ids: string[],
  opts: { groupMeta?: Map<string, { name: string; memberCount: number }>; serviceMeta?: Map<string, string> } = {}
): Promise<Map<string, PrincipalDisplay>> {
  const out = new Map<string, PrincipalDisplay>();
  const users: string[] = [];
  const groups: string[] = [];
  const services: string[] = [];
  const publics: string[] = [];

  for (const raw of ids) {
    // Strip a userset suffix: `group:eng#member` displays as `group:eng`.
    const id = raw.replace(/#.*$/, '');
    if (id === 'user:*' || id === '*') publics.push(raw);
    else if (id.startsWith('group:')) groups.push(id);
    else if (id.startsWith('service_account:')) services.push(id);
    else users.push(id);
  }

  if (users.length) {
    const res = await query('SELECT id, email, display_name FROM users WHERE id = ANY($1)', [users]);
    const byId = new Map((res.rows || []).map((r: any) => [r.id, r]));
    for (const id of users) {
      const row: any = byId.get(id);
      out.set(id, {
        id,
        label: row?.display_name || row?.email || id,
        kind: 'user',
      });
    }
    // An id with no account row is a real problem, not a display quirk.
    for (const id of users) {
      if (!byId.has(id)) out.set(id, { id, label: `${id} (unknown account)`, kind: 'user' });
    }
  }

  for (const id of groups) {
    const meta = opts.groupMeta?.get(id);
    out.set(id, {
      id,
      label: meta ? `${meta.name} · ${meta.memberCount} member${meta.memberCount === 1 ? '' : 's'}` : id,
      kind: 'group',
      memberCount: meta?.memberCount,
    });
  }

  for (const id of services) {
    out.set(id, {
      id,
      label: opts.serviceMeta?.get(id) ?? id.replace(/^service_account:/, ''),
      kind: 'service_account',
    });
  }

  for (const id of publics) {
    out.set(id, { id, label: 'Anyone with the link', kind: 'public' });
  }

  return out;
}
