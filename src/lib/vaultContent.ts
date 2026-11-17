import * as fs from 'fs';
import * as path from 'path';

export interface VaultSnippetInfo {
  slug: string;
  frontmatterTitle?: string;
  snippet: string;
}

let cachedSnippets: Map<string, string> | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute in-memory cache

/**
 * Fast in-memory cached content reader for Markdown/MDX/Canvas files in content/
 * Maps both slug, frontmatter slug, and basename to text content / snippets.
 */
export function getVaultContentSnippets(): Map<string, string> {
  const now = Date.now();
  if (cachedSnippets && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedSnippets;
  }

  const snippetMap = new Map<string, string>();
  const contentRoot = path.join(process.cwd(), 'content');
  if (!fs.existsSync(contentRoot)) {
    cachedSnippets = snippetMap;
    lastCacheTime = now;
    return snippetMap;
  }

  function walk(dir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
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

          const bodyOnly = raw.replace(/^---[\s\S]*?---\s*/, '').replace(/\s+/g, ' ').trim();
          const excerpt = bodyOnly.slice(0, 300);
          const baseSlug = entry.name.replace(/\.(md|mdx)$/, '');

          if (excerpt) {
            snippetMap.set(baseSlug, excerpt);
            snippetMap.set(fullPath, excerpt);
            if (fmSlug) snippetMap.set(fmSlug, excerpt);
          }
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
          const excerpt = textSnippets.join(' ').replace(/\s+/g, ' ').slice(0, 300);
          const baseSlug = entry.name.replace(/\.canvas$/, '');
          if (excerpt) {
            snippetMap.set(baseSlug, excerpt);
            snippetMap.set(fullPath, excerpt);
          }
        } catch {
          // ignore read error
        }
      }
    }
  }

  walk(contentRoot);
  cachedSnippets = snippetMap;
  lastCacheTime = now;
  return snippetMap;
}

/**
 * Searches vault files for a search query and returns matched slugs and context snippets.
 */
export function searchVaultContent(searchTerm: string): Map<string, string> {
  const matches = new Map<string, string>();
  const contentRoot = path.join(process.cwd(), 'content');
  if (!fs.existsSync(contentRoot)) return matches;

  const normalizedQuery = searchTerm.trim().toLowerCase();
  if (!normalizedQuery) return matches;

  function walk(dir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
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

          const bodyOnly = raw.replace(/^---[\s\S]*?---\s*/, '');
          const matchPos = bodyOnly.toLowerCase().indexOf(normalizedQuery);
          if (matchPos !== -1) {
            const baseSlug = entry.name.replace(/\.(md|mdx)$/, '');
            const startPos = Math.max(0, matchPos - 40);
            const endPos = Math.min(bodyOnly.length, matchPos + normalizedQuery.length + 90);
            const snippet = '...' + bodyOnly.substring(startPos, endPos).replace(/\s+/g, ' ').trim() + '...';
            
            // Map both the filename slug and frontmatter slug
            matches.set(baseSlug, snippet);
            if (fmSlug) matches.set(fmSlug, snippet);
          }
        } catch {
          // ignore read errors
        }
      } else if (entry.name.endsWith('.canvas')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const matchPos = raw.toLowerCase().indexOf(normalizedQuery);
          if (matchPos !== -1) {
            const baseSlug = entry.name.replace(/\.canvas$/, '');
            matches.set(baseSlug, 'Canvas spatial board match');
          }
        } catch {
          // ignore read error
        }
      }
    }
  }

  walk(contentRoot);
  return matches;
}

