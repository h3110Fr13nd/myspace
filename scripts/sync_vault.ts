/**
 * scripts/sync_vault.ts
 *
 * Vault Auto-Discovery & Sync Worker
 * ------------------------------------
 * Idempotently scans content/<vault_dir>/ for markdown files,
 * extracts YAML frontmatter (title, slug, tags, category, summary, tier),
 * upserts records into the resources + tags + resource_tags tables,
 * and syncs corresponding OpenFGA relationship tuples.
 *
 * Usage:
 *   uv run --with tsx tsx scripts/sync_vault.ts
 *   or: npx tsx scripts/sync_vault.ts
 *
 * Env required:
 *   DATABASE_URL, OPENFGA_API_URL, OPENFGA_STORE_ID
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import { OpenFgaClient } from '@openfga/sdk';
import { withAclCacheInvalidation } from '../src/lib/aclCache';

// ─── Config ──────────────────────────────────────────────────────────────────

const DB_URL = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';
const OPENFGA_URL = process.env.OPENFGA_API_URL || 'http://localhost:8085';
const OPENFGA_STORE_ID = process.env.OPENFGA_STORE_ID;
const CONTENT_ROOT = path.join(process.cwd(), 'content');

function resolveVaultOwner(vaultName: string): string {
  if (vaultName === 'public_vault') return 'user:system';
  if (vaultName.startsWith('user_')) {
    return `user:${vaultName.replace(/^user_/, '')}`;
  }
  return `user:${vaultName}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Minimal YAML frontmatter parser.
 * Handles string, array, and boolean values.
 */
function parseFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const yamlBlock = match[1];
  const body = match[2];
  const meta: Record<string, any> = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();

    if (rawVal.startsWith('[')) {
      // Inline YAML array
      meta[key] = rawVal
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (rawVal === 'true' || rawVal === 'false') {
      meta[key] = rawVal === 'true';
    } else {
      meta[key] = rawVal.replace(/^['"]|['"]$/g, '');
    }
  }

  return { meta, body };
}

function buildTagId(scopeType: string, scopeId: string, tagName: string): string {
  const cleanScope = scopeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `tag:${scopeType}_${cleanScope}_${slugify(tagName)}`;
}

// ─── Core Sync ───────────────────────────────────────────────────────────────

async function syncVault(
  db: pg.Pool,
  fga: OpenFgaClient,
  vaultDir: string,
  ownerId: string,
  spaceId: string,
  tenantId: string
) {
  const vaultName = path.basename(vaultDir);
  console.log(`\n[sync_vault] Scanning vault: ${vaultDir} → owner: ${ownerId}`);

  // Collect all content files recursively
  const files: Array<{ path: string; ext: string }> = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.md', '.mdx', '.canvas', '.pdf'].includes(ext)) {
          files.push({ path: full, ext });
        }
      }
    }
  }
  walk(vaultDir);
  console.log(`[sync_vault] Found ${files.length} content files (.md, .mdx, .canvas, .pdf)`);

  const fgaTuples: Array<{ user: string; relation: string; object: string }> = [];

  // Ensure space exists
  await db.query(
    `INSERT INTO resources (id, type, tenant_id, owner_id, path, title, metadata, is_public)
     VALUES ($1, 'space', $2, $3, $4, $5, '{"isPersonalVault": true}'::jsonb, false)
     ON CONFLICT (id) DO NOTHING`,
    [spaceId, tenantId, ownerId, spaceId, `${vaultName} Vault`]
  );
  fgaTuples.push({ user: ownerId, relation: 'owner', object: spaceId });

  for (const fileObj of files) {
    const { path: filePath, ext } = fileObj;
    const relPath = path.relative(vaultDir, filePath);
    const parts = relPath.split(path.sep);
    const fileName = parts[parts.length - 1].replace(/\.(md|mdx|canvas|pdf)$/i, '');
    const category = parts.length > 1 ? parts.slice(0, -1).join('/') : 'general';
    const folderId = `folder:${vaultName}_${slugify(category)}`;
    const folderPath = `${spaceId}/${folderId}`;

    // Upsert folder
    await db.query(
      `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public)
       VALUES ($1, 'folder', $2, $3, $4, $5, $6, '{}'::jsonb, false)
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [folderId, tenantId, spaceId, ownerId, folderPath, category.replace(/_/g, ' ')]
    );
    fgaTuples.push({ user: spaceId, relation: 'parent_space', object: folderId });
    fgaTuples.push({ user: ownerId, relation: 'owner', object: folderId });

    if (ext === '.md' || ext === '.mdx') {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { meta } = parseFrontmatter(raw);
      const slug = meta.slug || slugify(fileName);
      const title = meta.title || fileName;
      const tags: string[] = Array.isArray(meta.tags) ? meta.tags : [];
      const summary: string = meta.summary || '';
      const tier: string = meta.tier || 'free';
      const draft: boolean = meta.draft === true;
      const isPublic: boolean = !draft && (meta.is_public === true || meta.tier === 'public');
      const docId = `document:${slug}`;
      const docPath = `${folderPath}/${docId}`;

      const docMeta = JSON.stringify({
        slug,
        category,
        summary,
        description: meta.description || summary,
        socialDescription: meta.socialDescription || '',
        tags,
        draft,
        date: meta.date || null,
        updatedAt: meta.updatedAt || null,
        aliases: meta.aliases || [],
        author: meta.author || ownerId,
        ogImage: meta.ogImage || null,
        filePath,
        tier,
        isMdx: ext === '.mdx',
        wikilinks: meta.wikilinks || [],
      });

      await db.query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public)
         VALUES ($1, 'document', $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           metadata = EXCLUDED.metadata,
           is_public = EXCLUDED.is_public,
           updated_at = NOW()`,
        [docId, tenantId, folderId, ownerId, docPath, title, docMeta, isPublic]
      );
      fgaTuples.push({ user: folderId, relation: 'parent_folder', object: docId });
      fgaTuples.push({ user: ownerId, relation: 'owner', object: docId });

      for (const tagName of tags) {
        const tagId = buildTagId('user', ownerId, tagName);
        await db.query(
          `INSERT INTO tags (id, name, scope_type, scope_id, owner_id)
           VALUES ($1, $2, 'user', $3, $4)
           ON CONFLICT (scope_type, scope_id, name) DO UPDATE SET id = EXCLUDED.id`,
          [tagId, tagName, ownerId, ownerId]
        );
        await db.query(
          `INSERT INTO resource_tags (resource_id, tag_id, tagged_by)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [docId, tagId, ownerId]
        );
        fgaTuples.push({ user: tagId, relation: 'tagged', object: docId });
        fgaTuples.push({ user: ownerId, relation: 'owner', object: tagId });
      }

      if (isPublic) {
        fgaTuples.push({ user: 'user:*', relation: 'viewer', object: docId });
      }
      console.log(`  [sync:doc] ${docId} | tags: [${tags.join(', ')}] | public: ${isPublic}`);
    } else if (ext === '.canvas') {
      const raw = fs.readFileSync(filePath, 'utf-8');
      let canvasJson: any = { nodes: [], edges: [] };
      try {
        canvasJson = JSON.parse(raw);
      } catch (e) {
        console.warn(`[sync_vault] Invalid JSON in ${filePath}`);
      }

      const slug = slugify(fileName);
      const canvasId = `canvas:${slug}`;
      const canvasPath = `${folderPath}/${canvasId}`;
      const title = fileName.replace(/[-_]/g, ' ');

      const canvasMeta = JSON.stringify({
        slug,
        category,
        filePath,
        nodeCount: canvasJson.nodes?.length || 0,
        edgeCount: canvasJson.edges?.length || 0,
      });

      await db.query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public)
         VALUES ($1, 'canvas', $2, $3, $4, $5, $6, $7::jsonb, true)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [canvasId, tenantId, folderId, ownerId, canvasPath, title, canvasMeta]
      );
      fgaTuples.push({ user: folderId, relation: 'parent_folder', object: canvasId });
      fgaTuples.push({ user: ownerId, relation: 'owner', object: canvasId });
      fgaTuples.push({ user: 'user:*', relation: 'viewer', object: canvasId });
      console.log(`  [sync:canvas] ${canvasId} | nodes: ${canvasJson.nodes?.length || 0} | edges: ${canvasJson.edges?.length || 0}`);
    } else if (ext === '.pdf') {
      const slug = slugify(fileName);
      const pdfId = `pdf:${slug}`;
      const pdfPath = `${folderPath}/${pdfId}`;
      const title = fileName.replace(/[-_]/g, ' ');

      const pdfMeta = JSON.stringify({
        slug,
        category,
        filePath,
      });

      await db.query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public)
         VALUES ($1, 'pdf', $2, $3, $4, $5, $6, $7::jsonb, false)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [pdfId, tenantId, folderId, ownerId, pdfPath, title, pdfMeta]
      );
      fgaTuples.push({ user: folderId, relation: 'parent_folder', object: pdfId });
      fgaTuples.push({ user: ownerId, relation: 'owner', object: pdfId });
      console.log(`  [sync:pdf] ${pdfId}`);
    }
  }

  // Batch-write FGA tuples (deduplicate first)
  const seen = new Set<string>();
  const uniqueTuples = fgaTuples.filter((t) => {
    const key = `${t.user}|${t.relation}|${t.object}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const BATCH_SIZE = 50; // OpenFGA max per write call
  for (let i = 0; i < uniqueTuples.length; i += BATCH_SIZE) {
    const batch = uniqueTuples.slice(i, i + BATCH_SIZE);
    try {
      await withAclCacheInvalidation(() =>
        fga.write({ writes: batch })
      );
      console.log(`[sync_vault] FGA batch write ${i / BATCH_SIZE + 1}: ${batch.length} tuples`);
    } catch (err: any) {
      // Skip already-existing tuple errors (409 Conflict is OK)
      if (!err.message?.includes('already exists')) {
        console.warn(`[sync_vault] FGA write warning:`, err.message);
      }
    }
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main() {
  const db = new pg.Pool({ connectionString: DB_URL });
  const fga = new OpenFgaClient({ apiUrl: OPENFGA_URL, storeId: OPENFGA_STORE_ID });

  const tenantId = 'tenant_default';
  const targetVault = process.argv[2]; // optional: sync single vault

  try {
    const vaultDirs = fs.readdirSync(CONTENT_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => !targetVault || name === targetVault);

    for (const vaultName of vaultDirs) {
      const ownerId = resolveVaultOwner(vaultName);
      const spaceId = `space:${vaultName}`;
      await syncVault(db, fga, path.join(CONTENT_ROOT, vaultName), ownerId, spaceId, tenantId);
    }

    console.log('\n[sync_vault] ✓ All vaults synchronized successfully.');

    // Auto-trigger Meilisearch indexing
    try {
      const { syncMeilisearch } = await import('./sync_meilisearch');
      await syncMeilisearch();
    } catch (meiliErr: any) {
      console.log('[sync_vault] Meilisearch sync skipped or unavailable:', meiliErr.message);
    }
  } catch (err: any) {
    console.error('[sync_vault] Fatal error:', err.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
