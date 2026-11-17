import { defineMiddleware } from 'astro:middleware';
import crypto from 'crypto';
import { trace } from '@opentelemetry/api';
import { checkPermission } from './lib/openfga';
import { verifySessionToken, validateApiKey } from './lib/auth';
import { resolveUserId } from './lib/userIds';
import { query } from './lib/db';
import { deriveShortId, buildResourcePath, parseShortIdFromPath } from './lib/resourceUrls';
import { logger } from './lib/logger';
import { recordHttp } from './lib/observe';
import { ensureOtel } from './lib/otel';
import { installProcessErrorHandlers } from './lib/processErrors';
import { config } from './lib/config';
import { reconcileOnBoot } from './lib/acl/projection';

// ─── Alias Redirect Cache (60s TTL) ──────────────────────────────────────────
// Maps alias slug → { resourceId, expiresAt } to avoid per-request DB hits.
// Stale entries are lazily evicted on next lookup.
const aliasCache = new Map<string, { resourceId: string; expiresAt: number }>();
const ALIAS_TTL_MS = 60_000;

/**
 * Constant-time string comparison for shared secrets.
 *
 * A plain `===` on a token leaks its prefix through response timing, which is
 * enough to recover it byte by byte. Length is compared first because
 * `timingSafeEqual` throws on a length mismatch, and the length of a shared
 * secret is not itself secret.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function resolveAlias(slug: string): Promise<string | null> {
  const now = Date.now();
  const cached = aliasCache.get(slug);
  if (cached && cached.expiresAt > now) {
    return cached.resourceId;
  }
  // Evict stale entry
  if (cached) aliasCache.delete(slug);

  try {
    // GIN-accelerated JSONB containment query (requires 0004 migration)
    const res = await query(
      `SELECT id FROM resources WHERE metadata @> $1::jsonb LIMIT 1`,
      [JSON.stringify({ aliases: [slug] })]
    );
    if (res.rows.length > 0) {
      const resourceId = res.rows[0].id as string;
      aliasCache.set(slug, { resourceId, expiresAt: now + ALIAS_TTL_MS });
      return resourceId;
    }
  } catch (e: any) {
    // Non-fatal — alias resolution is best-effort
    console.warn('[Alias Resolver] DB query failed:', e.message);
  }
  return null;
}

// ─── Pretty URL Resolver ─────────────────────────────────────────────────────
// Canonical form: /{slug-in-id}-{shortId}  (shortId indexed in metadata JSONB,
// GIN-accelerated by the 0004 migration — same pattern as alias lookup).

function isRoutablePath(url: URL): boolean {
  if (url.pathname === '/') return false;
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/settings/') ||
    url.pathname.startsWith('/folders/') ||
    url.pathname.startsWith('/tags/') ||
    url.pathname.startsWith('/blogs/') ||
    url.pathname.startsWith('/studio/') ||
    url.pathname.startsWith('/vault/')
  ) {
    return false;
  }
  // Static assets / XML feeds have a file extension
  if (/\.[a-zA-Z0-9]{1,8}$/.test(url.pathname)) return false;
  // Only single-segment canonical paths participate
  return url.pathname.split('/').filter(Boolean).length === 1;
}

async function resolveByShortId(shortId: string): Promise<any | null> {
  try {
    const res = await query(
      `SELECT id, type, parent_id, owner_id, path, title, metadata, is_public, is_draft
       FROM resources WHERE metadata @> $1::jsonb LIMIT 1`,
      [JSON.stringify({ shortId })]
    );
    return res.rows[0] || null;
  } catch (e: any) {
    console.warn('[Pretty URL Resolver] DB query failed:', e.message);
    return null;
  }
}

async function persistShortId(row: any): Promise<void> {
  if (row.metadata?.shortId) return;
  const shortId = deriveShortId(row.id);
  try {
    await query(
      `UPDATE resources SET metadata = metadata || $2::jsonb, updated_at = updated_at WHERE id = $1`,
      [row.id, JSON.stringify({ shortId })]
    );
  } catch (e: any) {
    console.warn('[Pretty URL Resolver] shortId backfill failed:', e.message);
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  // ─── 0.5 ACL projection ───────────────────────────────────────────────────
  // Build the effective-access read model once per process. It is a cache, never
  // an authorization input, so a failure here must not stop the request: every
  // decision still goes to the engine.
  void reconcileOnBoot();

  // `astro dev` runs no preload, so the process handlers are installed on the
  // first request here as well. Idempotent, so the preload case is unaffected.
  installProcessErrorHandlers();

  // One-time OTel bootstrap, awaited before the first span so a live collector
  // never receives a partial trace. No-op when tracing is disabled.
  await ensureOtel();
  const startTime = performance.now();
  const url = new URL(context.request.url);
  if (logger.isLevelEnabled('debug')) {
    logger.debug(
      { method: context.request.method, url: url.pathname + url.search, ip: context.clientAddress },
      'request start'
    );
  }

  // ─── 0. Pretty URL resolution: /{slug-in-id}-{shortId} ────────────────────
  // Resolve via the indexed shortId, 301 to the canonical pretty path on any
  // stale/cosmetic slug mismatch, otherwise REWRITE to the legacy ?doc=<id>
  // workspace renderer (SSR stays single-source-of-truth) while pinning the
  // SEO canonical to the pretty URL.
  if (isRoutablePath(url)) {
    const shortId = parseShortIdFromPath(url.pathname);
    if (shortId) {
      const row = await resolveByShortId(shortId);
      if (row && row.id) {
        await persistShortId(row);
        const canonical = buildResourcePath(row, row.path);
        if (url.pathname.replace(/\/$/, '') !== canonical) {
          const dest = new URL(canonical, url);
          return context.redirect(dest.toString(), 301);
        }
        context.locals.canonicalUrl = canonical;
        context.locals.docId = row.id;

        // Use redirect so the ?doc=<id> parameter is visible to the page SSR
        const docTarget = new URL('/?doc=' + row.id, url);
        const edit = url.searchParams.get('edit');
        if (edit) docTarget.searchParams.set('edit', edit);
        return context.redirect(docTarget.toString(), 301);
      }
    }
  }

  // ─── 1. Alias Redirect ────────────────────────────────────────────────────
  // Skip: API routes, auth routes, static assets (have a file extension),
  //       admin/settings (handled below), and folder index pages themselves.
  const skipAlias =
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/settings/') ||
    url.pathname.startsWith('/folders/') ||
    url.pathname.startsWith('/tags/') ||
    url.pathname.startsWith('/blogs/') ||
    url.pathname.startsWith('/studio/') ||
    url.pathname.startsWith('/vault/') ||
    url.pathname === '/' ||
    /\.[a-zA-Z0-9]{1,8}$/.test(url.pathname); // has file extension

  if (!skipAlias) {
    // Last path segment as candidate alias slug
    const slug = url.pathname.split('/').filter(Boolean).pop() ?? '';
    if (slug) {
      const resourceId = await resolveAlias(slug);
      if (resourceId) {
        return context.redirect(`/?doc=${encodeURIComponent(resourceId)}`, 301);
      }
    }
  }

  // ─── 2. Authentication ────────────────────────────────────────────────────
  // Priority A: Scoped Personal API Key (Bearer token or x-api-key header)
  // Priority B: JWT Session Cookie (Web UI user)
  // Priority C: INTERNAL_SERVICE_TOKEN-gated service header
  // Priority D: user:anonymous
  let currentUser = 'user:anonymous';
  let authType = 'anonymous';
  let userScopes: string[] = ['*'];

  const authHeader = context.request.headers.get('authorization') || '';
  const apiKeyHeader = context.request.headers.get('x-api-key') || '';

  const rawBearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const candidateApiKey = rawBearerKey.startsWith('workspace_key_') ? rawBearerKey : (apiKeyHeader.startsWith('workspace_key_') ? apiKeyHeader : null);

  if (candidateApiKey) {
    const clientIp = context.clientAddress || context.request.headers.get('x-forwarded-for') || undefined;
    const apiResult = await validateApiKey(candidateApiKey, undefined, clientIp);
    if (apiResult.valid && apiResult.userId) {
      currentUser = apiResult.userId;
      authType = 'api_key';
      userScopes = apiResult.scopes || [];
    }
  }

  if (currentUser === 'user:anonymous') {
    const cookieToken = context.cookies.get('session_token')?.value;
    const decodedPayload = cookieToken ? await verifySessionToken(cookieToken) : null;
    if (decodedPayload?.userId) {
      // Canonicalise the principal before it authorises anything.
      //
      // Cookies minted before the id migration carry `user:<email>`; the
      // resources carry `user:<uuid>`. Nothing downstream would ever match, so
      // such a session silently saw an empty vault while reporting itself
      // logged in. `resolveUserId` maps an email or a legacy id onto the
      // canonical uuid, so an un-migrated cookie keeps working instead of
      // needing a re-login.
      //
      // It returns null when nothing matches, and null must not become an
      // identity: an unresolvable principal is anonymous, never a fabricated
      // one.
      const canonical = await resolveUserId(decodedPayload.userId);
      currentUser = canonical ?? 'user:anonymous';
      authType = canonical ? 'session' : 'anonymous';
      // Chrome (account menu) needs the real identity, not the derived id.
      context.locals.session = canonical
        ? {
            userId: canonical,
            email: decodedPayload.email,
            displayName: decodedPayload.displayName,
          }
        : null;
    } else {
      // ── Service-header impersonation ───────────────────────────────────────
      // SECURITY: this header grants the ability to act AS another user, so it
      // is only honoured for callers that present the shared internal secret.
      //
      // It previously trusted any caller, which meant an unauthenticated client
      // could set `x-user-id: user:<owner>` and write ACL tuples for themselves:
      // a complete authentication bypass. Verified live, then fixed here.
      //
      // See plan/core-architecture/31-iam-access-visibility-and-policy-troubleshooter.md §1 (V1).
      const serviceUser = context.request.headers.get('x-user-id');
      const serviceToken = context.request.headers.get('x-internal-token');
      const expectedToken = process.env.INTERNAL_SERVICE_TOKEN || '';

      if (serviceUser) {
        if (!expectedToken) {
          logger.warn(
            { url: url.pathname, claimedUser: serviceUser },
            'x-user-id rejected: INTERNAL_SERVICE_TOKEN is not configured'
          );
        } else if (!serviceToken || !timingSafeEqualString(serviceToken, expectedToken)) {
          logger.warn(
            { url: url.pathname, claimedUser: serviceUser },
            'x-user-id rejected: invalid internal service token'
          );
        } else {
          currentUser = serviceUser;
          authType = 'service';
        }
      }
    }
  }

  // Attach auth context to locals
  context.locals.user = currentUser;
  context.locals.authType = authType;
  context.locals.scopes = userScopes;

  // Protect /admin routes (require authenticated user)
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/settings')) {
    if (currentUser === 'user:anonymous') {
      return context.redirect(`/login?redirect=${encodeURIComponent(url.pathname)}`);
    }
  }

  // Protect asset routes with OpenFGA check
  if (url.pathname.startsWith('/api/v1/assets/pdf/') || url.pathname.startsWith('/api/v1/assets/image/')) {
    const isPdf = url.pathname.startsWith('/api/v1/assets/pdf/');
    const rawAssetId = url.pathname.split('/').pop() || '';
    const cleanId = rawAssetId.replace(/^(pdf|image):/, '').replace(/\.(pdf|png|jpg|jpeg|svg|webp)$/, '');
    const object = isPdf ? `pdf:${cleanId}` : `image:${cleanId}`;

    let isAllowed = false;
    // Check if asset is registered as public in DB or is in public_vault / public/pdfs
    try {
      const dbCheck = await query('SELECT is_public FROM resources WHERE id = $1', [object]);
      if (dbCheck.rows.length > 0 && dbCheck.rows[0].is_public) {
        isAllowed = true;
      }
    } catch {
      // fallback
    }

    if (!isAllowed) {
      // If the file exists in public/pdfs or temp/extra/docs/papers/pdfs/, allow viewer access
      const fs = await import('fs');
      const path = await import('path');
      const publicPdf = path.join(process.cwd(), 'public', 'pdfs', `${cleanId}.pdf`);
      if (fs.existsSync(publicPdf)) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      try {
        isAllowed = await checkPermission({
          user: currentUser,
          relation: 'viewer',
          object: object,
        });
      } catch {
        isAllowed = false;
      }
    }

    if (!isAllowed) {
      return new Response(JSON.stringify({
        error: 'Forbidden',
        message: `User ${currentUser} is not authorized to access asset ${object}`,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const response = await next();

  // ─── 4. Observability (metrics + opt-in structured request log) ───────────
  const durationMs = performance.now() - startTime;
  const coarse = url.pathname
    .split('/')
    .map((seg) => (/^[0-9a-f]{8,}$/i.test(seg) || seg.includes(':') ? ':id' : seg))
    .join('/');
  recordHttp(coarse || '/', context.request.method, response.status, durationMs);
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  if (traceId) response.headers.set('X-Trace-Id', traceId);
  if (logger.isLevelEnabled('debug')) {
    logger.debug(
      { method: context.request.method, url: url.pathname, status: response.status, durationMs, user: context.locals.user },
      'request end'
    );
  }

  // ─── 5. Security headers (opt-in; CSP deferred — see scale plan) ──────────
  if (config.securityHeaders) {
    if (!response.headers.has('X-Content-Type-Options')) response.headers.set('X-Content-Type-Options', 'nosniff');
    if (!response.headers.has('X-Frame-Options')) response.headers.set('X-Frame-Options', 'DENY');
    if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!response.headers.has('Permissions-Policy')) response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.isProd && !response.headers.has('Strict-Transport-Security')) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  response.headers.set('X-Middleware-Test', 'ok');
  return response;
});
