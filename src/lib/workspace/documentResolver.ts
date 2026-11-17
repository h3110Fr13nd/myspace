import * as fs from 'fs';
import * as path from 'path';
import type { WorkspaceResource } from './treeBuilder';

const MAX_RESOLVED_PATHS = 512;
const MISSING_PATH_RETRY_MS = 1_000;
const resolvedPaths = new Map<string, { path: string | null; retryAt: number }>();

function rememberResolvedPath(key: string, resolvedPath: string | null): void {
  while (resolvedPaths.size >= MAX_RESOLVED_PATHS) {
    const oldestKey = resolvedPaths.keys().next().value;
    if (oldestKey === undefined) break;
    resolvedPaths.delete(oldestKey);
  }
  resolvedPaths.set(key, {
    path: resolvedPath,
    retryAt: resolvedPath ? Number.POSITIVE_INFINITY : Date.now() + MISSING_PATH_RETRY_MS,
  });
}

export function resolveActiveDoc(rawList: WorkspaceResource[], idParam: string | null): WorkspaceResource | null {
  if (!idParam) return null;
  const cleanId = decodeURIComponent(idParam);
  return (
    rawList.find((r) => r.id === cleanId) ||
    rawList.find((r) => Array.isArray(r.metadata?.aliases) && r.metadata.aliases.includes(cleanId)) ||
    rawList.find((r) => r.metadata?.slug === cleanId) ||
    rawList.find((r) => r.id === `folder:${cleanId}`) ||
    rawList.find((r) => r.id === `document:${cleanId}`) ||
    rawList.find((r) => r.id === `paper:${cleanId}`) ||
    rawList.find((r) => r.id === `blog:${cleanId}`) ||
    rawList.find((r) => r.id === `pdf:${cleanId}`) ||
    rawList.find((r) => r.id === `image:${cleanId}`) ||
    rawList.find((r) => r.id === `canvas:${cleanId}`) ||
    rawList.find((r) => r.id === `sheet:${cleanId}`) ||
    rawList.find((r) => r.id === `google_sheet:${cleanId}`) ||
    rawList.find((r) => r.id === `google_doc:${cleanId}`) ||
    rawList.find((r) => r.id === `drive:${cleanId}`) ||
    rawList.find((r) => r.id.endsWith(`:${cleanId}`)) ||
    null
  );
}

/**
 * Searches the content/ directory recursively for a matching markdown file.
 */
function findFileInDir(dir: string, fileName: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const res = findFileInDir(full, fileName);
        if (res) return res;
      } else if (entry.name === fileName) {
        return full;
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

/**
 * Resolves the physical Markdown file path on disk for a given document resource.
 */
export function resolveDocumentFilePath(activeDoc: WorkspaceResource): string | null {
  const configuredPath = activeDoc.metadata?.filePath;
  const catFolder = activeDoc.metadata?.category || '01_agentic_ai_systems';
  const slugName = activeDoc.metadata?.slug || activeDoc.id.replace('document:', '');
  const cacheKey = `${process.cwd()}\0${activeDoc.id}\0${configuredPath || ''}\0${catFolder}\0${slugName}`;
  const cached = resolvedPaths.get(cacheKey);
  if (cached) {
    if (cached.path && fs.existsSync(cached.path)) {
      resolvedPaths.delete(cacheKey);
      resolvedPaths.set(cacheKey, cached);
      return cached.path;
    }
    if (!cached.path && Date.now() < cached.retryAt) {
      resolvedPaths.delete(cacheKey);
      resolvedPaths.set(cacheKey, cached);
      return null;
    }
    resolvedPaths.delete(cacheKey);
  }

  let targetFilePath = configuredPath;
  if (targetFilePath && !fs.existsSync(targetFilePath)) {
    const relFromContent = targetFilePath.includes('/content/')
      ? targetFilePath.slice(targetFilePath.indexOf('/content/'))
      : null;
    if (relFromContent && fs.existsSync(path.join(process.cwd(), relFromContent))) {
      targetFilePath = path.join(process.cwd(), relFromContent);
    }
  }

  if (!targetFilePath || !fs.existsSync(targetFilePath)) {
    targetFilePath = path.join(process.cwd(), 'content', 'user_demo', catFolder, `${slugName}.md`);
  }

  if (!fs.existsSync(targetFilePath)) {
    const contentDir = path.join(process.cwd(), 'content');
    const slugName = activeDoc.metadata?.slug || activeDoc.id.replace('document:', '');
    const found = findFileInDir(contentDir, `${slugName}.md`);
    if (found) targetFilePath = found;
  }

  const resolvedPath = fs.existsSync(targetFilePath) ? targetFilePath : null;
  rememberResolvedPath(cacheKey, resolvedPath);
  return resolvedPath;
}
