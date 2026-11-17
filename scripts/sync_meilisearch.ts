/**
 * scripts/sync_meilisearch.ts
 *
 * Full Sync of Resources & Content to Meilisearch Index
 * -----------------------------------------------------
 * Reads all resource nodes from PostgreSQL, attaches full markdown content from content/,
 * and indexes them into the Meilisearch `resources` index.
 *
 * Usage:
 *   npx tsx scripts/sync_meilisearch.ts
 *   or: uv run --with tsx tsx scripts/sync_meilisearch.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import { meiliClient, setupMeilisearchIndex, encodeMeiliId, RESOURCES_INDEX, type MeiliResourceDocument } from '../src/lib/meilisearch';
import { isDraftResource, isUnlistedResource } from '../src/lib/visibility';

const DB_URL = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';
const CONTENT_ROOT = path.join(process.cwd(), 'content');

function loadContentBodyMap(): Map<string, string> {
  const contentMap = new Map<string, string>();
  if (!fs.existsSync(CONTENT_ROOT)) return contentMap;

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const frontmatterMatch = raw.match(/^---[\s\S]*?---\s*/);
          let fmSlug = '';
          if (frontmatterMatch) {
            const slugMatch = frontmatterMatch[0].match(/slug:\s*["']?([^"'\r\n]+)["']?/);
            if (slugMatch) fmSlug = slugMatch[1].trim();
          }
          const bodyOnly = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
          const slug = entry.name.replace(/\.(md|mdx)$/, '');
          contentMap.set(slug, bodyOnly);
          contentMap.set(entry.name, bodyOnly);
          contentMap.set(fullPath, bodyOnly);
          if (fmSlug) contentMap.set(fmSlug, bodyOnly);
        } catch {
          // ignore read error
        }
      } else if (entry.name.endsWith('.canvas')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const parsed = JSON.parse(raw);
          const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
          const textSnippets: string[] = [];
          for (const node of nodes) {
            if (node.text) textSnippets.push(String(node.text).trim());
            if (node.label) textSnippets.push(String(node.label).trim());
          }
          const canvasBody = textSnippets.join('\n\n');
          const slug = entry.name.replace(/\.canvas$/, '');
          contentMap.set(slug, canvasBody);
          contentMap.set(entry.name, canvasBody);
        } catch {
          // ignore read error
        }
      }
    }
  }

  walk(CONTENT_ROOT);
  return contentMap;
}

export async function syncMeilisearch(): Promise<void> {
  console.log('🚀 [Meilisearch Sync] Initializing index settings...');
  const setupOk = await setupMeilisearchIndex();
  if (!setupOk) {
    console.error('❌ [Meilisearch Sync] Could not connect to Meilisearch at', process.env.MEILISEARCH_URL || 'http://localhost:7705');
    return;
  }

  console.log('📦 [Meilisearch Sync] Connecting to PostgreSQL...');
  const pool = new pg.Pool({ connectionString: DB_URL });
  
  try {
    const res = await pool.query(`
      SELECT id, type, owner_id, title, path, metadata, is_public, is_draft, created_at, updated_at
      FROM resources
      WHERE type != 'folder'
      ORDER BY title ASC
    `);

    const rows = res.rows || [];
    console.log(`🔍 [Meilisearch Sync] Found ${rows.length} resources to index.`);

    const bodyMap = loadContentBodyMap();

    const documents: MeiliResourceDocument[] = rows.map((r) => {
      const slug = r.metadata?.slug || r.id.replace(/^[^:]+:/, '');
      const filePath = r.metadata?.filePath;
      const bodyContent =
        bodyMap.get(slug) ||
        (filePath ? bodyMap.get(filePath) : undefined) ||
        bodyMap.get(`${slug}.md`) ||
        bodyMap.get(`${slug}.canvas`) ||
        r.metadata?.content ||
        r.metadata?.summary ||
        '';
      
      const tags = Array.isArray(r.metadata?.tags) ? r.metadata.tags : [];
      const aliases = Array.isArray(r.metadata?.aliases) ? r.metadata.aliases : [];
      const allowedUsers = Array.isArray(r.metadata?.allowed_users) ? r.metadata.allowed_users : [];
      const summary = r.metadata?.summary || r.metadata?.description || '';
      const category = r.metadata?.category || (r.type === 'canvas' ? 'Canvas' : 'Vault Note');
      // Shared with the reader and the tree — see `src/lib/visibility.ts`. The
      // indexed `unlisted` field is what the `unlisted = false` filter in
      // search.ts actually matches, so it must agree with the reader exactly.
      const isDraft = isDraftResource(r);
      const isUnlisted = isUnlistedResource(r);

      return {
        id: encodeMeiliId(r.id),
        raw_id: r.id,
        type: r.type,
        title: r.title || slug,
        path: r.path || '',
        category,
        summary,
        content: bodyContent,
        tags,
        aliases,
        owner_id: r.owner_id || 'user:anonymous',
        allowed_users: allowedUsers,
        is_public: Boolean(r.is_public),
        is_draft: isDraft,
        unlisted: isUnlisted,
        slug,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : undefined,
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
      };
    });

    const index = meiliClient.index<MeiliResourceDocument>(RESOURCES_INDEX);
    const task = await index.addDocuments(documents, { primaryKey: 'id' });
    console.log(`✅ [Meilisearch Sync] Queued batch indexing task UID: ${task.taskUid}. Indexed ${documents.length} documents.`);
  } catch (err: any) {
    console.error('❌ [Meilisearch Sync Error]:', err.message);
  } finally {
    await pool.end();
  }
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  syncMeilisearch().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
