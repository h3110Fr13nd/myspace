/**
 * Single source of truth for "who is this request" chrome concerns.
 * The rail, the top bar and the portal host all need the same derived
 * auth state; deriving it once keeps the headerless shell consistent.
 *
 * The session claims come from the middleware's verified cookie decode, so the
 * account menu can show the user's real email instead of the mangled user id.
 */

export const ANONYMOUS = 'user:anonymous';

export interface SessionClaims {
  userId: string;
  email?: string;
  displayName?: string;
}

export interface UserIdentity {
  currentUser: string;
  displayName: string | null;
  email: string | null;
  isAuthenticated: boolean;
}

export function getUserIdentity(
  currentUser?: string | null,
  session?: SessionClaims | null
): UserIdentity {
  const resolved = currentUser || ANONYMOUS;
  const isAuthenticated = resolved !== ANONYMOUS && resolved !== '';
  return {
    currentUser: resolved,
    // Prefer verified session claims; never expose the internal auth subject as
    // display copy when older or partial sessions lack a display name.
    displayName: isAuthenticated
      ? session?.displayName?.trim() || 'Your account'
      : null,
    email: isAuthenticated ? session?.email?.trim() || null : null,
    isAuthenticated,
  };
}

/** Build the owner's public feed path from the canonical auth subject. */
export function getUserFeedPath(currentUser: string): string {
  const ownerSlug = currentUser.replace(/^user:/, '');
  return `/blogs/${encodeURIComponent(ownerSlug)}/feed.xml`;
}
