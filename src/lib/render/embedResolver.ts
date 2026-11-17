/**
 * Embed & Wikilink Resolver
 *
 * Handles Obsidian-style link and transclusion syntaxes:
 *
 *  ![[target|alias]]           — Full file transclusion / embed
 *  ![[target#heading|alias]]   — Heading-level transclusion
 *  ![[target#^blockid|alias]]  — Block-level transclusion
 *  [[target|alias]]            — Navigable wikilink
 *  [[target#heading|alias]]    — Navigable wikilink with anchor target
 *
 * Embed resolution is bounded by MAX_EMBED_DEPTH to prevent circular recursion.
 */

import * as fs from 'fs';
import * as path from 'path';

export const MAX_EMBED_DEPTH = 3;

export type RenderFn = (raw: string, user: string, depth: number) => string;

/**
 * Recursively locates a markdown file across all content vaults
 */
function findMarkdownFile(cleanSlug: string): string | null {
  const contentRoot = path.join(process.cwd(), 'content');
  if (!fs.existsSync(contentRoot)) return null;

  function searchDir(dir: string): string | null {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = searchDir(fullPath);
          if (found) return found;
        } else if (entry.name === `${cleanSlug}.md` || entry.name === `${cleanSlug}.mdx`) {
          return fullPath;
        }
      }
    } catch {
      // ignore read error
    }
    return null;
  }

  return searchDir(contentRoot);
}

/**
 * Extracts content under a specific Markdown heading (e.g. ## Methodology)
 * up to the next heading of equal or higher level.
 */
export function extractHeadingContent(rawMarkdown: string, headingQuery: string): string {
  const cleanQuery = headingQuery.toLowerCase().replace(/[-_#]/g, ' ').trim();
  const lines = rawMarkdown.split('\n');
  let startIndex = -1;
  let targetLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].toLowerCase().replace(/[-_#]/g, ' ').trim();
      if (startIndex === -1 && (text === cleanQuery || text.includes(cleanQuery))) {
        startIndex = i;
        targetLevel = level;
      } else if (startIndex !== -1 && level <= targetLevel) {
        return lines.slice(startIndex, i).join('\n');
      }
    }
  }

  if (startIndex !== -1) {
    return lines.slice(startIndex).join('\n');
  }
  return rawMarkdown;
}

/**
 * Extracts a specific Obsidian block ending with `^blockid`.
 */
export function extractBlockContent(rawMarkdown: string, blockId: string): string {
  const cleanId = blockId.trim().replace(/^\^/, '');
  const lines = rawMarkdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`^${cleanId}`)) {
      return lines[i].replace(new RegExp(`\\s*\\^${cleanId}\\b`), '');
    }
  }
  return rawMarkdown;
}

/** Resolve all ![[...]] embed and transclusion syntax. */
export function resolveEmbeds(
  text: string,
  currentUser: string,
  depth: number,
  renderFn: RenderFn
): string {
  return text.replace(/!\[\[(.*?)(?:\|(.*?))?\]\]/g, (_match, target, alias) => {
    const cleanTarget = target.trim();
    const isPdfEmbed   = cleanTarget.startsWith('pdf:');
    const isImageEmbed = cleanTarget.startsWith('image:');

    let targetWithoutPrefix = cleanTarget.replace(/^(pdf|image|document):/, '');
    let heading: string | null = null;
    let blockId: string | null = null;

    if (targetWithoutPrefix.includes('#^')) {
      const parts = targetWithoutPrefix.split('#^');
      targetWithoutPrefix = parts[0];
      blockId = parts[1];
    } else if (targetWithoutPrefix.includes('#')) {
      const parts = targetWithoutPrefix.split('#');
      targetWithoutPrefix = parts[0];
      heading = parts[1];
    }

    const cleanSlug = targetWithoutPrefix.replace(/\.pdf$/, '');
    const caption   = alias ? alias.trim() : cleanSlug.replace(/_/g, ' ');

    // Image embed
    if (isImageEmbed) {
      const imgUrl = `/api/v1/assets/image/${encodeURIComponent(cleanSlug)}`;
      const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22350%22 viewBox=%220 0 600 350%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%230b0f19%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%2300f2fe%22 font-size=%2218%22 font-family=%22sans-serif%22>🖼️ ${caption}</text></svg>`;
      return `<div class="embedded-resource-card" style="margin:1.25rem 0;padding:1rem;text-align:center;background:rgba(5,8,20,0.8);border:1px solid var(--border-glass);border-radius:12px;"><img src="${imgUrl}" alt="${caption}" style="max-width:100%;height:auto;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.4);" onerror="this.src='${fallbackSvg}'" /><div style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">🖼️ Embedded Image: <strong>${caption}</strong></div></div>`;
    }

    // PDF embed
    if (isPdfEmbed) {
      const pdfUrl = `/api/v1/assets/pdf/${encodeURIComponent(cleanSlug)}`;
      return `<div class="embedded-resource-card" style="margin:1.25rem 0;padding:1rem;background:rgba(5,8,20,0.9);border:1px solid var(--border-glass);border-radius:12px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-weight:700;color:var(--accent-rose);font-size:0.9rem;">📕 Embedded PDF: ${caption}</span><a href="${pdfUrl}" target="_blank" style="color:var(--accent-cyan);font-size:0.8rem;text-decoration:none;">Download ⬇</a></div><iframe src="${pdfUrl}" width="100%" height="400px" style="border:none;border-radius:8px;"></iframe></div>`;
    }

    // Depth limit reached — show link instead of transcluding
    if (depth >= MAX_EMBED_DEPTH) {
      const docUrl = `/?doc=${encodeURIComponent('document:' + cleanSlug)}`;
      return `<div style="margin:0.75rem 0;padding:8px 12px;background:rgba(244,63,94,0.1);border:1px solid var(--accent-rose);border-radius:8px;font-size:0.85rem;"><span style="color:var(--accent-rose);font-weight:700;">🛑 Max Embed Depth (${MAX_EMBED_DEPTH}) Reached: </span> <a href="${docUrl}" style="color:var(--accent-cyan);text-decoration:underline;font-weight:600;">Open ${caption} ↗</a></div>`;
    }

    // Resolve document from disk across all vaults
    const embedFilePath = findMarkdownFile(cleanSlug);

    if (embedFilePath) {
      let childRaw = fs.readFileSync(embedFilePath, 'utf-8');
      let transcludeLabel = caption;

      if (heading) {
        childRaw = extractHeadingContent(childRaw, heading);
        transcludeLabel = `${caption} § ${heading.replace(/[-_]/g, ' ')}`;
      } else if (blockId) {
        childRaw = extractBlockContent(childRaw, blockId);
        transcludeLabel = `${caption} (Block: ${blockId})`;
      }

      const childHtml = renderFn(childRaw, currentUser, depth + 1);
      const docUrl = `/?doc=${encodeURIComponent('document:' + cleanSlug + (heading ? `#${heading}` : ''))}`;

      return `<div class="embedded-doc-card" style="margin:1.25rem 0;padding:1.25rem;border-left:4px solid var(--accent-cyan);background:rgba(6,182,212,0.05);border-radius:12px;max-height:380px;overflow-y:auto;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid var(--border-glass);padding-bottom:8px;position:sticky;top:0;background:rgba(8,12,24,0.95);backdrop-filter:blur(12px);z-index:10;padding-top:4px;"><div style="font-weight:700;color:#fff;font-size:1rem;">📄 Embedded Note (Depth ${depth + 1}/${MAX_EMBED_DEPTH}): ${transcludeLabel}</div><a href="${docUrl}" style="color:var(--accent-cyan);font-size:0.8rem;text-decoration:none;font-weight:600;background:rgba(0,242,254,0.1);padding:4px 10px;border-radius:6px;border:1px solid var(--border-glass);">Open Full Note ↗</a></div><div class="prose-content" style="font-size:0.92rem;line-height:1.6;color:var(--text-secondary);">${childHtml}</div></div>`;
    }

    return `<div class="embedded-resource-card" style="margin:1rem 0;padding:1rem;border-left:4px solid var(--accent-cyan);background:rgba(6,182,212,0.05);">📄 Embedded Document: <strong>${caption}</strong></div>`;
  });
}

/** Resolve all [[...]] wikilink syntax. */
export function resolveWikilinks(text: string): string {
  return text.replace(/\[\[(.*?)(?:\|(.*?))?\]\]/g, (_match, target, alias) => {
    const cleanTarget  = target.trim();
    const isPdfLink    = cleanTarget.startsWith('pdf:');
    const isImgLink    = cleanTarget.startsWith('image:');
    const isCanvasLink = cleanTarget.startsWith('canvas:');

    let targetWithoutPrefix = cleanTarget.replace(/^(pdf|image|canvas):/, '');
    let anchor: string | null = null;
    let isBlock = false;

    if (targetWithoutPrefix.includes('#^')) {
      const parts = targetWithoutPrefix.split('#^');
      targetWithoutPrefix = parts[0];
      anchor = parts[1];
      isBlock = true;
    } else if (targetWithoutPrefix.includes('#')) {
      const parts = targetWithoutPrefix.split('#');
      targetWithoutPrefix = parts[0];
      anchor = parts[1];
    }

    const cleanSlug   = targetWithoutPrefix;
    let anchorSuffix  = '';
    if (anchor) {
      anchorSuffix = isBlock ? `#^${anchor}` : `#${anchor}`;
    }

    const displayText = alias
      ? alias.trim()
      : isBlock && anchor
        ? `${cleanSlug.replace(/-/g, ' ')} (Block: ${anchor})`
        : anchor
          ? `${cleanSlug.replace(/-/g, ' ')} § ${anchor.replace(/[-_]/g, ' ')}`
          : cleanSlug.replace(/-/g, ' ');

    const docTarget   = isPdfLink || isImgLink || isCanvasLink ? cleanTarget : `document:${cleanSlug}${anchorSuffix}`;
    const docUrl      = `/?doc=${encodeURIComponent(docTarget)}`;
    const icon        = isPdfLink ? '📕 ' : isImgLink ? '🖼️ ' : isCanvasLink ? '🎨 ' : '';
    const color       = isPdfLink ? 'var(--accent-rose)' : isImgLink ? 'var(--accent-emerald)' : isCanvasLink ? 'var(--accent-primary)' : 'var(--accent-cyan)';

    return `<a href="${docUrl}" class="wikilink-item" style="color:${color};font-weight:600;text-decoration:none;border-bottom:1.5px solid ${color};transition:all 0.15s ease;">${icon}${displayText}</a>`;
  });
}
