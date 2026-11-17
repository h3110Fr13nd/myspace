import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';
import { checkPermission } from '../../../lib/openfga';
import { meiliClient, RESOURCES_INDEX, decodeMeiliId, type MeiliResourceDocument } from '../../../lib/meilisearch';
import * as fs from 'fs';
import * as path from 'path';
import { searchVaultContent } from '../../../lib/vaultContent';
import { buildResourcePath } from '../../../lib/resourceUrls';
import { isWorkspaceAdmin, can } from '../../../lib/acl/guards';
import { isOpaqueUserId } from '../../../lib/userIds';
import { isDraftResource, isUnlistedResource } from '../../../lib/visibility';
import { json } from '../../../lib/api';
import { vaultSearchCache } from '../../../lib/cache/searchCache';
import { config } from '../../../lib/config';
import { consumeRateLimit } from '../../../lib/rateLimit';

/**
 * Helper to recursively search markdown content files across all vaults in content/
 */
function searchVaultFiles(searchTerm: string): Map<string, string> {
  const matches = new Map<string, string>();
  const contentRoot = path.join(process.cwd(), 'content');
  if (!fs.existsSync(contentRoot)) return matches;

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const bodyOnly = raw.replace(/^---[\s\S]*?---\s*/, '');
          const matchPos = bodyOnly.toLowerCase().indexOf(searchTerm);
          if (matchPos !== -1) {
            const slug = entry.name.replace(/\.(md|mdx)$/, '');
            const startPos = Math.max(0, matchPos - 40);
            const endPos = Math.min(bodyOnly.length, matchPos + searchTerm.length + 90);
            const snippet = '...' + bodyOnly.substring(startPos, endPos).replace(/\s+/g, ' ').trim() + '...';
            matches.set(slug, snippet);
          }
        } catch {
          // ignore read errors
        }
      }
    }
  }

  walk(contentRoot);
  return matches;
}

/**
 * PostgreSQL / Local File Crawl Search Engine
 */
async function searchPostgres(q: string): Promise<any[]> {
  const searchTerm = q.trim().toLowerCase();
  const pgCacheKey = `raw_pg_${searchTerm}`;
  const cachedPg = vaultSearchCache.get(pgCacheKey);
  if (cachedPg) return cachedPg;

  const sqlSearchTerm = `%${q.trim()}%`;

  const dbRes = await query(
    `SELECT id, type, owner_id, title, path, metadata, is_public, is_draft 
     FROM resources 
     WHERE type NOT IN ('folder', 'space')
       AND (
         title ILIKE $1 
         OR metadata->>'summary' ILIKE $1
         OR metadata->>'tags' ILIKE $1
         OR metadata->>'category' ILIKE $1
         OR metadata->>'slug' ILIKE $1
         OR metadata->>'description' ILIKE $1
         OR metadata::text ILIKE $1
       )
     ORDER BY 
       CASE 
         WHEN LOWER(title) = LOWER($2) THEN 1
         WHEN title ILIKE $1 THEN 2
         WHEN metadata->>'summary' ILIKE $1 THEN 3
         ELSE 4 
       END,
       title ASC
     LIMIT 50`,
    [sqlSearchTerm, q.trim()]
  );

  const candidates = dbRes.rows || [];
  const matchedSlugsInDb = new Set(candidates.map((r) => r.metadata?.slug || r.id.replace(/^[^:]+:/, '')));

  const bodyMatches = searchVaultContent(searchTerm);

  const additionalSlugs = Array.from(bodyMatches.keys()).filter((s) => !matchedSlugsInDb.has(s));
  if (additionalSlugs.length > 0) {
    const extraRes = await query(
      `SELECT id, type, owner_id, title, path, metadata, is_public, is_draft
       FROM resources
       WHERE metadata->>'slug' = ANY($1) 
          OR id = ANY($2)
          OR metadata->>'filePath' = ANY($3)
       LIMIT 30`,
      [
        additionalSlugs,
        additionalSlugs.map((s) => `document:${s}`),
        additionalSlugs.map((s) => `/app/content/public_vault/research/${s}.md`),
      ]
    );
    if (extraRes.rows) {
      // Put exact file matches at the beginning
      candidates.unshift(...extraRes.rows);
    }
  }

  // Deduplicate and map
  const seenIds = new Set<string>();
  const finalCandidates: any[] = [];
  for (const c of candidates) {
    if (!seenIds.has(c.id)) {
      seenIds.add(c.id);
      finalCandidates.push(c);
    }
  }

  const mapped = finalCandidates.map((r) => {
    const slug = r.metadata?.slug || r.id.replace(/^[^:]+:/, '');
    const snippet = bodyMatches.get(slug) || r.metadata?.summary || r.metadata?.description || '';
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      url: buildResourcePath({ id: r.id, type: r.type }, r.path),
      path: r.path,
      slug,
      icon: r.metadata?.icon,
      aliases: r.metadata?.aliases || [],
      category: r.metadata?.category || 'Vault Note',
      summary: snippet,
      tags: r.metadata?.tags || [],
      owner_id: r.owner_id,
      is_public: r.is_public,
    is_draft: isDraftResource(r),
    // Shared with the reader and the tree — see `src/lib/visibility.ts`. If
    // this drifts from `isUnlistedResource`, a note can be hidden from search
    // while still being readable, which is the failure the helper exists to stop.
    unlisted: isUnlistedResource(r),
    };
  });

  vaultSearchCache.set(pgCacheKey, mapped, 60_000);
  return mapped;
}

/**
 * Meilisearch Full-Text Search Engine with Highlighted Snippets & Permission Pre-Filtering
 */
async function searchMeilisearch(q: string, currentUser: string = 'user:anonymous'): Promise<any[]> {
  const index = meiliClient.index<MeiliResourceDocument>(RESOURCES_INDEX);
  
  // Fast Rust-level Roaring Bitmap Pre-filter
  let filter: string | undefined;
  // SECURITY: this branch used to be `currentUser === 'user:admin'`, which set
  // `filter = undefined` and returned EVERY indexed document — private and draft
  // content included — to anyone who registered as admin@anything. Since that id
  // is derived from the email local part, it was self-issued. Workspace
  // administration is now an OpenFGA capability, resolved below.
  const isAdmin = await isWorkspaceAdmin(currentUser);
  if (isAdmin) {
    filter = undefined;
  } else if (!currentUser || currentUser === 'user:anonymous') {
    filter = 'is_public = true AND (is_draft = false OR is_draft IS NULL) AND (unlisted = false OR unlisted IS NULL)';
  } else if (isOpaqueUserId(currentUser)) {
    // No escaping. `replace(/'/g, "\\'")` is not a valid Meilisearch filter
    // escape, so the old code was relying on the principal being unable to
    // contain a quote — true only since ids became opaque uuids, and a property
    // of the id format rather than of this filter.
    //
    // Validating the shape instead is unconditional: an id that is not a
    // well-formed principal cannot have grants, so it falls through to the
    // public-only filter below. Fail closed, no escaping to get wrong.
    filter = `((is_public = true AND (is_draft = false OR is_draft IS NULL) AND (unlisted = false OR unlisted IS NULL)) OR owner_id = '${currentUser}' OR allowed_users = '${currentUser}')`;
  } else {
    // Unrecognised principal: public results only. Never interpolate it.
    filter = 'is_public = true AND (is_draft = false OR is_draft IS NULL) AND (unlisted = false OR unlisted IS NULL)';
  }

  const searchRes = await index.search(q, {
    limit: 40,
    filter,
    attributesToHighlight: ['title', 'summary', 'content'],
    attributesToCrop: ['content', 'summary'],
    cropLength: 35,
    highlightPreTag: '<mark style="background: rgba(0, 242, 254, 0.25); color: #00f2fe; padding: 1px 3px; border-radius: 3px;">',
    highlightPostTag: '</mark>',
  });

  return searchRes.hits.map((hit: any) => {
    const formatted = hit._formatted || {};
    // Extract highlighted match: prefer content snippet if matched, fallback to summary
    const snippet = formatted.content || formatted.summary || hit.summary || '';
    const id = hit.raw_id || decodeMeiliId(hit.id);

    return {
      id,
      type: hit.type,
      title: formatted.title || hit.title,
      url: buildResourcePath({ id, type: hit.type }, hit.path),
      path: hit.path,
      slug: hit.slug || id.replace(/^[^:]+:/, ''),
      icon: hit.icon,
      aliases: hit.aliases || [],
      category: hit.category || 'Vault Note',
      summary: snippet,
      tags: hit.tags || [],
      owner_id: hit.owner_id,
      is_public: hit.is_public,
      is_draft: hit.is_draft,
      unlisted: hit.unlisted,
    };
  });
}

export const GET: APIRoute = async ({ url, locals, request, clientAddress }) => {
  const currentUser = locals.user || 'user:anonymous';

  if (config.rateLimit) {
    const ip = clientAddress || request.headers.get('x-forwarded-for') || 'unknown';
    const actor = currentUser !== 'user:anonymous' ? currentUser : ip;
    const rule = await consumeRateLimit({ key: 'expensive:search:' + actor, limit: 30, windowSec: 60 });
    if (!rule.allowed) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rule.retryAfterSec) },
      });
    }
  }

  const q = url.searchParams.get('q') || '';

  if (!q || q.trim().length < 2) {
    return json({ results: [] }, { status: 200 });
  }

  const userSearchCacheKey = `user_search_${currentUser}_${q.trim().toLowerCase()}`;
  const cachedUserSearch = vaultSearchCache.get(userSearchCacheKey);
  if (cachedUserSearch) {
    return new Response(JSON.stringify(cachedUserSearch), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Cache': 'HIT',
      },
    });
  }

  const configuredEngine = (process.env.SEARCH_ENGINE || 'meilisearch').toLowerCase();
  let usedEngine = configuredEngine;
  let candidates: any[] = [];

  try {
    if (configuredEngine === 'meilisearch') {
      try {
        candidates = await searchMeilisearch(q, currentUser);
      } catch (meiliErr: any) {
        console.warn(`[Search Warning] Meilisearch query failed (${meiliErr.message}), falling back to PostgreSQL search.`);
        usedEngine = 'postgres (fallback)';
        candidates = await searchPostgres(q);
      }
    } else {
      candidates = await searchPostgres(q);
    }

    // Zero-Data-Leak: OpenFGA & Public Permission Filter with Draft & Unlisted handling
    const matchedItems: any[] = [];

    for (const item of candidates) {
      const isOwner = currentUser === item.owner_id;
      const isDraft = item.is_draft === true;
      const isUnlisted = item.unlisted === true;

      let isAllowed = false;
      if (isOwner) {
        // Owner sees all their documents
        isAllowed = true;
      } else if (item.is_public && !isDraft && !isUnlisted) {
        // Public search returns non-draft, non-unlisted public resources
        isAllowed = true;
      } else if (currentUser !== 'user:anonymous' && !isDraft) {
        try {
          // `can()`, not `checkPermission()`: the guard layer applies deny
          // precedence and falls back to `resources.owner_id`. The raw engine
          // call let a subject with an explicit `denied_viewer` still match
          // their own search results, and excluded a Postgres owner whose
          // `owner` tuple was missing.
          isAllowed = await can(currentUser, 'viewer', item.id);
        } catch {
          isAllowed = false;
        }
      }

      if (isAllowed) {
        matchedItems.push({
          id: item.id,
          type: item.type,
          title: item.title,
          url: buildResourcePath({ id: item.id, type: item.type }, item.path),
          path: item.path,
          slug: item.slug || item.id.replace(/^[^:]+:/, ''),
          icon: item.icon,
          aliases: item.aliases,
          category: item.category,
          summary: item.summary,
          tags: item.tags,
          metadata: {
            slug: item.slug || item.id.replace(/^[^:]+:/, ''),
            icon: item.icon,
            aliases: item.aliases,
            category: item.category,
          },
        });
      }
    }

    const responsePayload = {
      query: q,
      engine: usedEngine,
      user: currentUser,
      count: matchedItems.length,
      results: matchedItems.slice(0, 30),
    };

    vaultSearchCache.set(userSearchCacheKey, responsePayload, 60_000);

    return new Response(
      JSON.stringify(responsePayload),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Cache': 'MISS' },
      }
    );
  } catch (err: any) {
    console.error(`[Search API Error]:`, err.message);
    return json({ error: err.message, results: [] }, { status: 500 });
  }
};
