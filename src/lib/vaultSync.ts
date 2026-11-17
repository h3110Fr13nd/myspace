import JSZip from 'jszip';
import path from 'path';
import { query } from './db';
import { uploadAsset } from './storage';
import { importTuples } from './acl/projector';
import { isUnlistedResource } from './visibility';
import { validateResourceMetadata } from './types/metadata.schema';

export interface IngestFile {
  relativePath: string;
  data: Buffer | Uint8Array;
  mimeType?: string;
}

export interface SyncStats {
  vaultName: string;
  ownerId: string;
  totalFiles: number;
  documentsCount: number;
  canvasesCount: number;
  assetsCount: number;
  foldersCount: number;
  tagsCount: number;
  publicDocsCount: number;
  deletedCount?: number;
  errors: string[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
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

/**
 * Extracts all files from a ZIP buffer into a normalized IngestFile list
 */
export async function extractZipArchive(zipBuffer: Buffer | Uint8Array): Promise<IngestFile[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files: IngestFile[] = [];

  for (const [rawPath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    // Skip OS metadata files (.DS_Store, __MACOSX)
    if (rawPath.includes('__MACOSX') || rawPath.includes('.DS_Store') || rawPath.startsWith('.')) {
      continue;
    }

    const data = await zipEntry.async('nodebuffer');
    files.push({
      relativePath: rawPath.replace(/\\/g, '/'),
      data,
    });
  }

  return files;
}

/**
 * Core engine to synchronize a collection of files into a user's vault
 */
export async function syncVaultFiles(
  files: IngestFile[],
  ownerId: string,
  vaultNameInput?: string,
  tenantId: string = 'tenant_default',
  deletedPaths?: string[]
): Promise<SyncStats> {
  const emailSlug = ownerId.replace(/^user:/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const vaultName = vaultNameInput ? slugify(vaultNameInput) : `${emailSlug}_vault`;
  const spaceId = `space:${vaultName}`;

  const stats: SyncStats = {
    vaultName,
    ownerId,
    totalFiles: files.length,
    documentsCount: 0,
    canvasesCount: 0,
    assetsCount: 0,
    foldersCount: 0,
    tagsCount: 0,
    publicDocsCount: 0,
    deletedCount: 0,
    errors: [],
  };

  const fgaTuples: Array<{ user: string; relation: string; object: string }> = [];

  try {
    // 1. Ensure Root Space exists
    await query(
      `INSERT INTO resources (id, type, tenant_id, owner_id, path, title, metadata, is_public)
       VALUES ($1, 'space', $2, $3, $4, $5, '{"isPersonalVault": true}'::jsonb, false)
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [spaceId, tenantId, ownerId, spaceId, `${vaultName.replace(/_/g, ' ').toUpperCase()} Vault`]
    );
    fgaTuples.push({ user: ownerId, relation: 'owner', object: spaceId });

    // 2. Process each file
    const createdFolders = new Set<string>();

    for (const file of files) {
      try {
        const cleanRelPath = file.relativePath.replace(/^[./\\]+/, '');
        const ext = path.extname(cleanRelPath).toLowerCase();
        const parts = cleanRelPath.split('/');
        const fileName = parts[parts.length - 1].replace(/\.[^/.]+$/, '');
        // Create true hierarchical folder structure for nested paths
        const dirSegments = parts.slice(0, -1);
        let currentParentId = spaceId;
        let currentPathAccum = spaceId;

        if (dirSegments.length === 0) {
          // Top-level root file
          currentParentId = spaceId;
        } else {
          for (let i = 0; i < dirSegments.length; i++) {
            const segment = dirSegments[i];
            const accumulatedDir = dirSegments.slice(0, i + 1).join('/');
            const folderSlug = slugify(accumulatedDir);
            const folderId = `folder:${vaultName}_${folderSlug}`;
            const nextPathAccum = `${currentPathAccum}/${folderId}`;

            if (!createdFolders.has(folderId)) {
              const isFolderPublic = accumulatedDir.startsWith('open');
              const folderTitle = segment.replace(/[/_-]/g, ' ');
              await query(
                `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public)
                 VALUES ($1, 'folder', $2, $3, $4, $5, $6, '{}'::jsonb, $7)
                 ON CONFLICT (id) DO UPDATE SET
                   parent_id = EXCLUDED.parent_id,
                   title = EXCLUDED.title,
                   is_public = EXCLUDED.is_public,
                   updated_at = NOW()`,
                [folderId, tenantId, currentParentId, ownerId, nextPathAccum, folderTitle, isFolderPublic]
              );
              fgaTuples.push({
                user: currentParentId,
                relation: currentParentId.startsWith('space:') ? 'parent_space' : 'parent_folder',
                object: folderId,
              });
              fgaTuples.push({ user: ownerId, relation: 'owner', object: folderId });
              createdFolders.add(folderId);
              stats.foldersCount++;
            }

            currentParentId = folderId;
            currentPathAccum = nextPathAccum;
          }
        }

        const category = dirSegments.join('/') || 'general';
        const folderId = currentParentId;
        const folderPath = currentPathAccum;

        // Handle Markdown / MDX documents
        if (ext === '.md' || ext === '.mdx') {
          const rawText = Buffer.isBuffer(file.data)
            ? file.data.toString('utf-8')
            : new TextDecoder().decode(file.data);

          const { meta, body } = parseFrontmatter(rawText);
          const slug = meta.slug || slugify(fileName);
          const title = meta.title || fileName.replace(/[-_]/g, ' ');
          const tags: string[] = Array.isArray(meta.tags) ? meta.tags : [];
          const summary: string = meta.summary || '';

          // Quartz Frontmatter Rule Evaluation:
          // 1. Draft check: meta.draft === true, tag 'draft', status 'draft'
          const isDraft: boolean = Boolean(
            meta.draft === true || 
            meta.draft === 'true' || 
            meta.status === 'draft' || 
            tags.map(t => t.toLowerCase()).includes('draft')
          );

          // 2. Explicit publish check: meta.publish or meta.published
          const isExplicitlyPublished: boolean = Boolean(
            meta.publish === true || meta.publish === 'true' || 
            meta.published === true || meta.published === 'true'
          );
          const isExplicitlyUnpublished: boolean = Boolean(
            meta.publish === false || meta.publish === 'false' || 
            meta.published === false || meta.published === 'false'
          );

          // 3. Private check: meta.private, tier 'private', or path in private/research
          const isOpenFolder = cleanRelPath.startsWith('open/') || category.startsWith('open');
          const isPrivateFolder = cleanRelPath.startsWith('private/') || cleanRelPath.startsWith('research/') || category.startsWith('private') || category.startsWith('research');
          const isPrivateFlag: boolean = Boolean(
            meta.private === true || 
            meta.private === 'true' || 
            meta.tier === 'private' || 
            isPrivateFolder || 
            isExplicitlyUnpublished
          );

          // 4. Unlisted check — shared with the reader, the tree and the search
          // index so a note cannot be unlisted at import and listed at read.
          // See `src/lib/visibility.ts`.
          const isUnlisted: boolean = isUnlistedResource({ metadata: meta });

          // Resolve final Tier
          let tier: string = meta.tier || 'free';
          if (isPrivateFlag) {
            tier = 'private';
          } else if (isOpenFolder || isExplicitlyPublished) {
            tier = 'public';
          }

          // Final isPublic boolean (visible without authentication)
          const isPublic: boolean = !isDraft && !isPrivateFlag && (tier === 'public' || isExplicitlyPublished || (isOpenFolder && tier !== 'private'));

          const docId = `document:${vaultName}_${slug}`;
          const docPath = `${folderPath}/${docId}`;

          const docMeta = {
            slug,
            category,
            summary,
            description: meta.description || summary,
            socialDescription: meta.socialDescription || '',
            tags,
            draft: isDraft,
            isDraft,
            isPrivate: isPrivateFlag,
            unlisted: isUnlisted,
            isUnlisted,
            date: meta.date || new Date().toISOString(),
            updatedAt: meta.updatedAt || new Date().toISOString(),
            aliases: meta.aliases || [],
            author: meta.author || ownerId,
            ogImage: meta.ogImage || null,
            tier,
            isMdx: ext === '.mdx',
            wikilinks: meta.wikilinks || [],
            contentLength: body.length,
            previewText: body.slice(0, 300),
            contentHash: (await import('crypto')).createHash('sha256').update(file.data).digest('hex'),
          };

          const validatedMetadata = validateResourceMetadata('document', docMeta);
          if (!validatedMetadata.success) {
            const details = validatedMetadata.error.issues
              .map((issue) => `${issue.path.join('.') || 'metadata'}: ${issue.message}`)
              .join('; ');
            throw new Error(`Invalid metadata in ${cleanRelPath}: ${details}`);
          }

          await query(
            `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, content, metadata, is_public, is_draft)
             VALUES ($1, 'document', $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
             ON CONFLICT (id) DO UPDATE SET
               title = EXCLUDED.title,
               content = EXCLUDED.content,
               metadata = EXCLUDED.metadata,
               is_public = EXCLUDED.is_public,
               is_draft = EXCLUDED.is_draft,
               updated_at = NOW()`,
            [docId, tenantId, folderId, ownerId, docPath, title, body, JSON.stringify(validatedMetadata.data), isPublic, isDraft]
          );

          fgaTuples.push({ user: folderId, relation: 'parent_folder', object: docId });
          fgaTuples.push({ user: ownerId, relation: 'owner', object: docId });

          if (isPublic) {
            fgaTuples.push({ user: 'user:*', relation: 'viewer', object: docId });
            stats.publicDocsCount++;
          }

          // Link Tags
          for (const tagName of tags) {
            const tagId = buildTagId('user', ownerId, tagName);
            await query(
              `INSERT INTO tags (id, name, scope_type, scope_id, owner_id)
               VALUES ($1, $2, 'user', $3, $4)
               ON CONFLICT (scope_type, scope_id, name) DO UPDATE SET id = EXCLUDED.id`,
              [tagId, tagName, ownerId, ownerId]
            );
            await query(
              `INSERT INTO resource_tags (resource_id, tag_id, tagged_by)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING`,
              [docId, tagId, ownerId]
            );
            fgaTuples.push({ user: tagId, relation: 'tagged', object: docId });
            fgaTuples.push({ user: ownerId, relation: 'owner', object: tagId });
            stats.tagsCount++;
          }

          stats.documentsCount++;
        }
        // Handle JSON Canvas
        else if (ext === '.canvas') {
          const rawText = Buffer.isBuffer(file.data)
            ? file.data.toString('utf-8')
            : new TextDecoder().decode(file.data);

          let canvasJson: any = { nodes: [], edges: [] };
          try {
            canvasJson = JSON.parse(rawText);
          } catch {
            // invalid json ignored
          }

          const slug = slugify(fileName);
          const canvasId = `canvas:${vaultName}_${slug}`;
          const canvasPath = `${folderPath}/${canvasId}`;
          const title = fileName.replace(/[-_]/g, ' ');

          const canvasMeta = {
            slug,
            category,
            nodeCount: canvasJson.nodes?.length || 0,
            edgeCount: canvasJson.edges?.length || 0,
            canvasData: canvasJson,
          };

          await query(
            `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public)
             VALUES ($1, 'canvas', $2, $3, $4, $5, $6, $7::jsonb, true)
             ON CONFLICT (id) DO UPDATE SET
               title = EXCLUDED.title,
               metadata = EXCLUDED.metadata,
               updated_at = NOW()`,
            [canvasId, tenantId, folderId, ownerId, canvasPath, title, JSON.stringify(canvasMeta)]
          );

          fgaTuples.push({ user: folderId, relation: 'parent_folder', object: canvasId });
          fgaTuples.push({ user: ownerId, relation: 'owner', object: canvasId });
          fgaTuples.push({ user: 'user:*', relation: 'viewer', object: canvasId });
          stats.canvasesCount++;
        }
        // Handle Assets (PDFs, Images, Media)
        else if (['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext)) {
          const isPdf = ext === '.pdf';
          const type = isPdf ? 'pdf' : 'image';
          const slug = slugify(fileName);
          const assetId = `${type}:${vaultName}_${slug}`;
          const assetPath = `${folderPath}/${assetId}`;
          const storageKey = `vaults/${vaultName}/${type}/${slug}${ext}`;

          const contentType =
            file.mimeType ||
            (isPdf ? 'application/pdf' : `image/${ext.replace('.', '')}`);

          // Upload binary to R2 / S3 / MinIO storage
          try {
            await uploadAsset(storageKey, file.data, contentType);
          } catch (storageErr: any) {
            console.warn(`[VaultSync] Storage upload warning for ${cleanRelPath}:`, storageErr.message);
          }

          const assetMeta = {
            slug,
            category,
            fileName: path.basename(cleanRelPath),
            storageKey,
            contentType,
            sizeBytes: file.data.byteLength,
          };

          await query(
            `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, false)
             ON CONFLICT (id) DO UPDATE SET
               title = EXCLUDED.title,
               metadata = EXCLUDED.metadata,
               updated_at = NOW()`,
            [assetId, type, tenantId, folderId, ownerId, assetPath, fileName, JSON.stringify(assetMeta)]
          );

          fgaTuples.push({ user: folderId, relation: 'parent_folder', object: assetId });
          fgaTuples.push({ user: ownerId, relation: 'owner', object: assetId });
          stats.assetsCount++;
        }
      } catch (fileErr: any) {
        stats.errors.push(`Error processing ${file.relativePath}: ${fileErr.message}`);
      }
    }

    // 2b. Handle Deletions if requested
    if (deletedPaths && Array.isArray(deletedPaths) && deletedPaths.length > 0) {
      for (const delPath of deletedPaths) {
        try {
          const cleanRel = delPath.replace(/^[./\\]+/, '');
          const ext = path.extname(cleanRel).toLowerCase();
          const parts = cleanRel.split('/');
          const fileName = parts[parts.length - 1].replace(/\.[^/.]+$/, '');
          const slug = slugify(fileName);

          let targetId = '';
          if (ext === '.md' || ext === '.mdx') {
            targetId = `document:${vaultName}_${slug}`;
          } else if (ext === '.canvas') {
            targetId = `canvas:${vaultName}_${slug}`;
          } else if (['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext)) {
            const isPdf = ext === '.pdf';
            const type = isPdf ? 'pdf' : 'image';
            targetId = `${type}:${vaultName}_${slug}`;
          }

          if (targetId) {
            const delRes = await query(
              `DELETE FROM resources WHERE id = $1 AND owner_id = $2`,
              [targetId, ownerId]
            );
            if ((delRes.rowCount ?? 0) > 0) {
              stats.deletedCount = (stats.deletedCount || 0) + (delRes.rowCount ?? 0);
            }
          }
        } catch (delErr: any) {
          stats.errors.push(`Error deleting ${delPath}: ${delErr.message}`);
        }
      }
    }

    // 3. Batch write OpenFGA relationship tuples
    const seen = new Set<string>();
    const uniqueTuples = fgaTuples.filter((t) => {
      const key = `${t.user}|${t.relation}|${t.object}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const tuple of uniqueTuples) {
      try {
        await importTuples([{ subject: tuple.user, relation: tuple.relation, object: tuple.object }]);
      } catch {
        // tuple might already exist
      }
    }
  } catch (err: any) {
    stats.errors.push(`Vault sync failed: ${err.message}`);
  }

  return stats;
}
