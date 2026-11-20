import 'dotenv/config';
import { extractInlineRelationships } from './relationships';
import * as fs from 'fs';
import * as path from 'path';
import { query } from './db';
import { canUserEditResource } from './permissions';
import { uploadAsset } from './storage';
import { encodeMeiliId, type MeiliResourceDocument } from './meilisearch';
import { enqueueIndexOperation } from './jobs';
import { deriveShortId, buildResourcePath } from './resourceUrls';
import { ensureOwner, grantPublicRead, linkParent } from './acl/projector';
import { validateResourceMetadata } from './types/metadata.schema';

/**
 * Unified Resource Creation Factory
 *
 * A single, reusable ingestion pipeline shared by every creation surface
 * (Sidebar Folder Tree, Command Palette, Canvas toolbar, Global Header, API).
 *
 * Pipeline:
 *   1. Permission Guard  -> OpenFGA/owner editor check on the target parent
 *   2. ID Resolution     -> unique slugified `type:<slug>` resource id
 *   3. File Scaffolding  -> boilerplate frontmatter / JSON / CSV written to disk
 *   4. PostgreSQL        -> INSERT into the `resources` table
 *   5. OpenFGA Tuples    -> owner + parent hierarchy tuples written best-effort
 *   6. Meilisearch       -> real-time upsert so the item is searchable instantly
 */

export type CreatableResourceType =
  | 'folder'
  | 'document'
  | 'canvas'
  | 'sheet'
  | 'excalidraw'
  | 'mermaid'
  | 'pdf'
  | 'image'
  | 'google_doc'
  | 'google_sheet';

export interface ImportSource {
  googleFileId?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  data?: string; // base64-encoded binary payload for pdf/image uploads
}

export interface CreateResourceInput {
  title: string;
  type: CreatableResourceType;
  parentFolder?: string;
  spaceId?: string;
  template?: string;
  importSource?: ImportSource;
  isPublic?: boolean;
  tags?: string[];
  summary?: string;
  currentUser: string;
}

export interface CreateResourceResult {
  id: string;
  slug: string;
  type: CreatableResourceType;
  route: string;
  filePath?: string;
  parentId?: string;
  title: string;
}

interface ResolvedParent {
  id: string;
  type: 'folder' | 'space';
  title: string;
  path: string;
  relation: 'parent_folder' | 'parent_space' | null;
}

/** Slugify any title into a URL-safe, DB-friendly slug */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

export function sanitizeUserSegment(userId: string): string {
  return userId.replace(/^user:/, '').replace(/[^a-zA-Z0-9]/g, '_');
}

export function buildResourceId(type: string, slug: string): string {
  return `${type}:${slug}`;
}

/** Manager folders `.request` style: resolve the user's personal root folder lazily */
export async function ensurePersonalRoot(currentUser: string, tenantId = 'tenant_default'): Promise<ResolvedParent> {
  if (!currentUser || currentUser === 'user:anonymous') {
    throw new Error('Authentication required to create a personal vault root');
  }
  const segment = sanitizeUserSegment(currentUser);
  const folderId = `folder:${segment}_root`;
  const pathVal = folderId;
  const title = `${currentUser.replace(/^user:/, '')}'s Personal Root Vault`;

  await query(
    `INSERT INTO resources (id, type, tenant_id, owner_id, path, title, metadata, is_public, is_draft)
     VALUES ($1, 'folder', $2, $3, $4, $5, '{"isPersonalRoot": true}'::jsonb, false, false)
     ON CONFLICT (id) DO NOTHING`,
    [folderId, tenantId, currentUser, pathVal, title]
  );

  await ensureOwner(folderId, currentUser).catch(() => {});

  return { id: folderId, type: 'folder', title, path: pathVal, relation: 'parent_folder' };
}

/** Resolve the parent folder/space a new resource should hang under */
async function resolveParent(
  currentUser: string,
  parentFolder?: string,
  spaceId?: string
): Promise<ResolvedParent> {
  // Personal root is the default target when no folder/space context is supplied
  if (!parentFolder && !spaceId) {
    return ensurePersonalRoot(currentUser);
  }

  const targetId = parentFolder || spaceId || '';
  const res = await query('SELECT id, type, owner_id, title, path, is_public, is_draft, metadata FROM resources WHERE id = $1 LIMIT 1', [targetId]);

  if (res.rows.length === 0) {
    throw new Error(`Parent container '${targetId}' not found`);
  }

  const row = res.rows[0];
  if (row.type !== 'folder' && row.type !== 'space') {
    throw new Error(`Parent '${targetId}' is not a folder or space container`);
  }

  const permissionResource = {
    id: row.id,
    type: row.type,
    owner_id: row.owner_id,
    is_public: row.is_public,
    is_draft: row.is_draft,
    metadata: row.metadata,
  };

  const allowed = await canUserEditResource(permissionResource, currentUser);
  if (!allowed) {
    throw new Error(`Forbidden: you do not have editor permissions on ${targetId}`);
  }

  const ownerPath = typeof row.path === 'string' && row.path.startsWith('folder:') || row.path.startsWith('space:')
    ? row.path
    : targetId;

  let relation: ResolvedParent['relation'] = null;
  if (row.type === 'folder') relation = 'parent_folder';
  else if (row.type === 'space') relation = 'parent_space';

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    path: ownerPath,
    relation,
  };
}

/** Generate a unique `type:<slug>` id, appending a numeric suffix on collision */
async function ensureUniqueId(type: string, baseSlug: string): Promise<string> {
  const candidates: string[] = [];
  for (let i = 1; i <= 10; i++) {
    candidates.push(buildResourceId(type, i === 1 ? baseSlug : `${baseSlug}-${i}`));
  }
  const res = await query('SELECT id FROM resources WHERE id = ANY($1::text[])', [candidates]);
  const existing = new Set((res.rows || []).map((r) => r.id));
  const found = candidates.find((c) => !existing.has(c));
  return found || buildResourceId(type, `${baseSlug}-${Date.now().toString(36)}`);
}

export interface ScaffoldOutput {
  content: string;
  fileExt: string;
  metaAdjust: Record<string, any>;
  storageKey?: string;
  storageMimeType?: string;
  storageSizeBytes?: number;
  storageFileName?: string;
}

/** Build type/template specific boilerplate content that lands on disk + DB */
export function scaffoldResource(
  type: CreatableResourceType,
  title: string,
  template?: string,
  importSource?: ImportSource
): ScaffoldOutput {
  const shortTitle = title.replace(/"/g, '\\"');

  if (type === 'folder') {
    return {
      content: '',
      fileExt: '',
      metaAdjust: {},
    };
  }

  if (type === 'document') {
    if (template === 'academic_paper') {
      const content = [
        '---',
        `title: "${shortTitle}"`,
        'tags: [research, paper]',
        'is_public: false',
        '---',
        '',
        `**Title**: ${title}`,
        '',
        '**Authors**: ',
        '',
        '**Venue**: ',
        '',
        '**DOI**: ',
        '',
        '## 📖 Abstract',
        '',
        '> *Paste your abstract here.*',
        '',
        '## 1. Introduction',
        '',
        '## 2. Methodology',
        '',
        '## 3. Results',
        '',
        '## 4. Discussion & Conclusion',
        '',
        '## References',
        '',
        '<!-- Type with [[wikilinks]] to interlink your knowledge graph. -->',
      ].join('\n');
      return { content, fileExt: '.md', metaAdjust: { category: 'research-papers' } };
    }
    const content = [
      '---',
      `title: "${shortTitle}"`,
      'is_public: false',
      '---',
      '',
      `# ${title}`,
      '',
      '> *New note scaffolded from the workspace creation pipeline. Start writing below.*',
      '',
      '<!-- Link related notes with [[wikilinks]] to grow the knowledge graph. -->',
      '',
    ].join('\n');
    return { content, fileExt: '.md', metaAdjust: {} };
  }

  if (type === 'canvas') {
    const nodes = [
      {
        id: `node_welcome_${Date.now()}`,
        type: 'text',
        x: 100,
        y: 100,
        width: 420,
        height: 200,
        color: '5',
        text: `# ${title}\n\nDouble-click to edit this text node. Use the toolbar to add notes, groups, or insert existing resources.`,
      },
    ];
    const spec = { title, nodes, edges: [] };
    const content = JSON.stringify(spec, null, 2);
    return {
      content,
      fileExt: '.canvas',
      metaAdjust: {
        canvasData: { nodes, edges: [] },
        nodeCount: nodes.length,
        edgeCount: 0,
      },
    };
  }

  if (type === 'sheet') {
    const grids: Record<string, string> = {
      task_matrix: [
        'Task,Owner,Priority,Status,Due Date',
        'Define requirements,,High,Todo,2026-01-10',
        'Draft architecture,,High,In Progress,2026-01-17',
        'Implementation sprint 1,,Medium,Todo,2026-02-01',
        'Review & ship,,Low,Blocked,2026-03-01',
      ].join('\n'),
      budget: [
        'Category,Q1 Actual,Q2 Actual,Q3 Forecast,Variance',
        'Engineering Salaries,$120,000,$125,000,$130,000,+$5,000',
        'Cloud Infrastructure (S3/PG),$8,500,$9,200,$9,800,+$600',
        'OpenFGA Security Audit,$15,000,$0,$0,$0',
        'Total Operating Expense,$143,500,$134,200,$139,800,+$5,600',
      ].join('\n'),
      blank: [
        'A,B,C,D,E,F',
        ', , , , , ',
        ', , , , , ',
        ', , , , , ',
        ', , , , , ',
        ', , , , , ',
      ].join('\n'),
    };
    return { content: grids[template || 'blank'] || grids.blank, fileExt: '.csv', metaAdjust: { template: template || 'blank' } };
  }

  if (type === 'excalidraw') {
    const spec = {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [],
      appState: { viewBackgroundColor: '#0f172a', theme: 'dark' },
    };
    return {
      content: JSON.stringify(spec, null, 2),
      fileExt: '.excalidraw',
      metaAdjust: { template: template || 'blank' },
    };
  }

  if (type === 'mermaid') {
    const content = [
      'flowchart TD',
      `    A["${title}"] --> B["Concept"]`,
      '    B --> C["Design"]',
      '    C --> D["Implement"]',
      '    D --> E["Ship"]',
      '',
    ].join('\n');
    return { content, fileExt: '.mmd', metaAdjust: { template: template || 'blank' } };
  }

  if (type === 'pdf' || type === 'image') {
    const fileName = importSource?.fileName || slugify(title) + (type === 'pdf' ? '.pdf' : '.png');
    const storageMimeType =
      importSource?.mimeType ||
      (type === 'pdf' ? 'application/pdf' : guessImageMime(fileName));
    return {
      content: '',
      fileExt: path.extname(fileName) || (type === 'pdf' ? '.pdf' : '.png'),
      metaAdjust: {
        fileName,
        storageKey: '', // filled in with the actual user vault by createResource()
        contentType: storageMimeType,
        sizeBytes: importSource?.data ? estimateBase64Bytes(importSource.data) : 0,
      },
      storageKey: '',
      storageMimeType,
      storageSizeBytes: importSource?.data ? estimateBase64Bytes(importSource.data) : 0,
      storageFileName: fileName,
    };
  }

  if (type === 'google_doc' || type === 'google_sheet') {
    const googleFileId = importSource?.googleFileId || extractGoogleFileId(importSource?.url) || '';
    const meta: Record<string, any> = {};
    if (type === 'google_doc') meta.googleDocId = googleFileId;
    else meta.googleSpreadsheetId = googleFileId;
    if (importSource?.url) meta.googleUrl = importSource.url;
    return {
      content: '',
      fileExt: '',
      metaAdjust: meta,
    };
  }

  // Fallback: treat like a document
  return {
    content: `# ${title}\n\n`,
    fileExt: '.md',
    metaAdjust: {},
  };
}

function guessImageMime(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };
  return map[ext] || 'application/octet-stream';
}

function estimateBase64Bytes(base64: string): number {
  if (!base64) return 0;
  const raw = base64.replace(/^data:[^;]+;base64,/, '');
  return Math.floor((raw.length * 3) / 4);
}

export function extractGoogleFileId(url?: string): string {
  if (!url) return '';
  const sheet = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheet) return sheet[1];
  const doc = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  if (doc) return doc[1];
  const form = url.match(/\/forms\/d\/e\/([a-zA-Z0-9-_]+)/);
  if (form) return form[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(url.trim())) return url.trim();
  return '';
}

export function extractWikilinks(content: string): string[] {
  if (!content) return [];
  const matches = Array.from(content.matchAll(/\[\[(.*?)\]\]/g)).map((m) => m[1].split('|')[0].trim());
  return Array.from(new Set(matches));
}

function writeDiskFile(
  filePath: string,
  content: string
): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err: any) {
    console.warn('[ResourceFactory] Failed to write scaffold file to disk:', err.message);
    throw new Error('The resource could not be saved, so it was not created. Check available storage and retry.');
  }
}

async function persistBinaryImport(
  scaffold: ScaffoldOutput,
  importSource?: ImportSource
): Promise<void> {
  if (!scaffold.storageKey || !importSource?.data) {
    throw new Error('The file upload could not be prepared. Please choose the file again and retry.');
  }
  const base64 = importSource.data.replace(/^data:[^;]+;base64,/, '');
  const binary = Buffer.from(base64, 'base64');
  if (binary.byteLength === 0) {
    throw new Error('The selected file is empty or unreadable. Choose another file and retry.');
  }

  try {
    await uploadAsset(scaffold.storageKey, binary, scaffold.storageMimeType || 'application/octet-stream');
  } catch (err: any) {
    console.warn('[ResourceFactory] Failed to persist binary import:', err.message);
    throw new Error('The file could not be stored, so the resource was not created. Please retry shortly.');
  }
}

function computeRoute(type: CreatableResourceType, id: string, slug: string, resourcePath: string): string {
  if (type === 'folder') return `/folders/${encodeURIComponent(resourcePath)}`;
  return buildResourcePath({ id, type });
}

async function upsertMeilisearch(doc: MeiliResourceDocument): Promise<void> {
  try {
    await enqueueIndexOperation({ indexOperation: 'add', meiliDoc: doc });
  } catch (err: any) {
    console.warn('[ResourceFactory] Meilisearch upsert failed:', err.message);
  }
}

/**
 * Core ingestion entrypoint — used by POST /api/v1/resources/create and reusable
 * from any future creation surface.
 */
export async function createResource(input: CreateResourceInput): Promise<CreateResourceResult> {
  const { title, type, currentUser } = input;

  if (!title || !title.trim()) {
    throw new Error('Title is required to create a resource');
  }
  if (!currentUser || currentUser === 'user:anonymous') {
    throw new Error('Authentication required to create resources');
  }
  if ((type === 'pdf' || type === 'image') && !input.importSource?.data) {
    throw new Error(`A ${type === 'pdf' ? 'PDF' : 'image'} file is required.`);
  }
  if (
    (type === 'google_doc' || type === 'google_sheet') &&
    !extractGoogleFileId(input.importSource?.googleFileId) &&
    !extractGoogleFileId(input.importSource?.url)
  ) {
    throw new Error('Provide a valid Google Docs or Sheets link or file ID.');
  }

  // ── 1. Permission Guard + Parent Resolution ───────────────────────────────
  const parent = await resolveParent(currentUser, input.parentFolder, input.spaceId);

  // ── 2. Unique ID Resolution ───────────────────────────────────────────────
  const baseSlug = slugify(title);
  const id = await ensureUniqueId(type, baseSlug);
  const slug = id.replace(/^[^:]+:/, '');
  const isPublic = Boolean(input.isPublic);
  const tags = Array.isArray(input.tags) ? input.tags : [];

  // ── 3. Scaffold content / marshall binary import ──────────────────────────
  const scaffold = scaffoldResource(type, title, input.template, input.importSource);

  const userVault = `user_${sanitizeUserSegment(currentUser)}`;
  const categoryDir = slugify(parent.title) || 'general';
  let targetFilePath: string | undefined;

  if (scaffold.fileExt && type !== 'pdf' && type !== 'image') {
    targetFilePath = path.join(process.cwd(), 'content', userVault, categoryDir, `${slug}${scaffold.fileExt}`);
  }

  // Assets live in object storage (R2/S3/MinIO) keyed by the user's vault
  if (type === 'pdf' || type === 'image') {
    const fileName = scaffold.storageFileName || `${slug}${scaffold.fileExt || (type === 'pdf' ? '.pdf' : '.png')}`;
    const storageExt = path.extname(fileName) || (type === 'pdf' ? '.pdf' : '.png');
    const storageKey = `vaults/${userVault}/${type}/${slug}${storageExt}`;
    scaffold.storageKey = storageKey;
    scaffold.metaAdjust.storageKey = storageKey;
    targetFilePath = path.join(process.cwd(), 'content', userVault, categoryDir, fileName);
  }

  const resourcePath = `${parent.path}/${id}`;
  const wikilinks = extractWikilinks(scaffold.content);

  const metadata: Record<string, any> = {
    slug,
    shortId: deriveShortId(id),
    category: categoryDir,
    summary: input.summary || scaffold.metaAdjust.summary || '',
    ...scaffold.metaAdjust,
  };
  if (tags.length > 0) metadata.tags = tags;
  if (input.template) metadata.template = input.template;
  if (targetFilePath) metadata.filePath = targetFilePath;
  if (wikilinks.length > 0) metadata.wikilinks = wikilinks;
  const linkRelationships = extractInlineRelationships(scaffold.content);
  if (linkRelationships.length > 0) metadata.linkRelationships = linkRelationships;
  metadata.createdBy = currentUser;

  const validatedMetadata = validateResourceMetadata(type, metadata);
  if (!validatedMetadata.success) {
    throw new Error(`Invalid metadata for ${type}: ${validatedMetadata.error.issues
      .map((issue) => `${issue.path.join('.') || 'metadata'}: ${issue.message}`)
      .join('; ')}`);
  }

  if (scaffold.content && targetFilePath) {
    writeDiskFile(targetFilePath, scaffold.content);
  }

  if (type === 'pdf' || type === 'image') {
    await persistBinaryImport(scaffold, input.importSource);
  }

  // ── 4. PostgreSQL Registration ────────────────────────────────────────────
  // NOTE: the `resources` table has no `content` column — body text lives on
  // disk (metadata.filePath) / object storage, consistent with the rest of the app.
  await query(
    `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft, created_at, updated_at)
     VALUES ($1, $2, 'tenant_default', $3, $4, $5, $6, $7::jsonb, $8, false, NOW(), NOW())`,
    [id, type, parent.id, currentUser, resourcePath, title, JSON.stringify(validatedMetadata.data), isPublic]
  );

  // Invalidate in-memory search index & query caches

  // ── 5. OpenFGA Authorization Tuples (best-effort) ─────────────────────────
  if (parent.relation === 'parent_folder') {
    await linkParent(id, 'folder', parent.id, 'parent_folder').catch(() => {});
  } else if (parent.relation === 'parent_space' && type === 'folder') {
    await linkParent(id, 'space', parent.id, 'parent_space').catch(() => {});
  }
  await ensureOwner(id, currentUser).catch(() => {});
  if (isPublic) {
    await grantPublicRead(id).catch(() => {});
  }

  // ── 6. Meilisearch Real-Time Upsert ───────────────────────────────────────
  await upsertMeilisearch({
    id: encodeMeiliId(id),
    raw_id: id,
    type,
    title,
    path: resourcePath,
    category: metadata.category,
    summary: metadata.summary || '',
    content: scaffold.content || '',
    tags,
    aliases: [],
    owner_id: currentUser,
    allowed_users: [],
    is_public: isPublic,
    is_draft: false,
    slug,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return {
    id,
    slug,
    type,
    route: computeRoute(type, id, slug, resourcePath),
    filePath: targetFilePath,
    parentId: parent.id,
    title,
  };
}
