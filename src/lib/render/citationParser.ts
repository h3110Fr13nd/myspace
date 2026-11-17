/**
 * Academic Citation & BibTeX Parser
 *
 * Supports citation keys in Markdown:
 *   [@smith2024]
 *   [@smith2024; @doe2023]
 *   [@smith2024, p. 45]
 *
 * Resolves against bibliography files in the workspace (references.bib, content/public_vault/references.bib)
 * or inline frontmatter `references`.
 *
 * Generates interactive citation badges and an auto-generated Bibliography list at the end of the note.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface BibEntry {
  key: string;
  type: string;
  title: string;
  author: string;
  year: string;
  journal?: string;
  booktitle?: string;
  url?: string;
  doi?: string;
}

// In-memory cache for parsed bib files
const bibCache = new Map<string, { mtime: number; entries: Map<string, BibEntry> }>();

/**
 * Very lightweight, robust BibTeX parser without heavy dependencies
 */
export function parseBibTeX(bibContent: string): Map<string, BibEntry> {
  const entries = new Map<string, BibEntry>();
  // Match @article{key, ...} or @inproceedings{key, ...}
  const entryRegex = /@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|\s*$)/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(bibContent)) !== null) {
    const type = match[1].toLowerCase();
    const key = match[2].trim();
    const body = match[3];

    const entry: BibEntry = {
      key,
      type,
      title: '',
      author: '',
      year: '',
    };

    // Extract fields
    const fieldRegex = /([a-zA-Z_]+)\s*=\s*(?:\{([\s\S]*?)\}|"([\s\S]*?)"|(\d+))/g;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const fieldName = fieldMatch[1].toLowerCase();
      const val = (fieldMatch[2] || fieldMatch[3] || fieldMatch[4] || '')
        .replace(/\s+/g, ' ')
        .replace(/[\{\}]/g, '')
        .trim();

      if (fieldName === 'title') entry.title = val;
      else if (fieldName === 'author') entry.author = val;
      else if (fieldName === 'year') entry.year = val;
      else if (fieldName === 'journal') entry.journal = val;
      else if (fieldName === 'booktitle') entry.booktitle = val;
      else if (fieldName === 'url') entry.url = val;
      else if (fieldName === 'doi') entry.doi = val;
    }

    if (!entry.title) entry.title = key;
    entries.set(key, entry);
  }

  return entries;
}

/**
 * Locate and load BibTeX entries across default workspace paths
 */
export function loadWorkspaceBibEntries(): Map<string, BibEntry> {
  const possiblePaths = [
    path.join(process.cwd(), 'references.bib'),
    path.join(process.cwd(), 'content', 'references.bib'),
    path.join(process.cwd(), 'content', 'public_vault', 'references.bib'),
  ];

  const merged = new Map<string, BibEntry>();

  for (const bibPath of possiblePaths) {
    if (fs.existsSync(bibPath)) {
      try {
        const stats = fs.statSync(bibPath);
        const cached = bibCache.get(bibPath);
        if (cached && cached.mtime === stats.mtimeMs) {
          cached.entries.forEach((v, k) => merged.set(k, v));
        } else {
          const content = fs.readFileSync(bibPath, 'utf-8');
          const entries = parseBibTeX(content);
          bibCache.set(bibPath, { mtime: stats.mtimeMs, entries });
          entries.forEach((v, k) => merged.set(k, v));
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return merged;
}

/**
 * Format author string to academic short format (e.g. "Smith et al." or "Smith & Doe")
 */
function formatAuthorShort(authorStr: string): string {
  if (!authorStr) return 'Unknown';
  const authors = authorStr.split(/\s+and\s+/i).map((a) => {
    // "LastName, FirstName" or "FirstName LastName"
    if (a.includes(',')) {
      return a.split(',')[0].trim();
    }
    const parts = a.trim().split(/\s+/);
    return parts[parts.length - 1];
  });

  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  return `${authors[0]} et al.`;
}

/**
 * Replace [@key] and [@key1; @key2] with formatted citations and append bibliography
 */
export function applyCitations(markdown: string): string {
  const bibEntries = loadWorkspaceBibEntries();
  const citedKeys = new Set<string>();

  // Match citation groups like [@key] or [@key, p. 12] or [@key1; @key2]
  const citationRegex = /\[@([a-zA-Z0-9_:-]+(?:\s*,\s*[^;\]]+)?(?:;\s*@[a-zA-Z0-9_:-]+(?:\s*,\s*[^;\]]+)?)*)\]/g;

  // Protect code spans (`...` and ```...```) so documentation mentioning [@citationKey] isn't transformed
  const codeSpans: string[] = [];
  const placeholderPrefix = '%%CITATION_CODE_SPAN_';
  let placeholderIndex = 0;

  // Protect multi-backtick or single-backtick code blocks/spans
  const codeProtectedMarkdown = markdown.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    const ph = `${placeholderPrefix}${placeholderIndex++}%%`;
    codeSpans.push(match);
    return ph;
  });

  let transformed = codeProtectedMarkdown.replace(citationRegex, (fullMatch, innerContent) => {
    const rawItems = innerContent.split(';');
    const renderedBadges: string[] = [];

    for (const rawItem of rawItems) {
      const cleanItem = rawItem.trim().replace(/^@/, '');
      const [key, ...pageParts] = cleanItem.split(',');
      const cleanKey = key.trim();
      const pageInfo = pageParts.join(',').trim();

      citedKeys.add(cleanKey);
      const bib = bibEntries.get(cleanKey);

      const authorShort = bib ? formatAuthorShort(bib.author) : cleanKey;
      const year = bib?.year ? bib.year : '';
      const displayLabel = year ? `${authorShort}, ${year}` : authorShort;
      const fullLabel = pageInfo ? `${displayLabel}, ${pageInfo}` : displayLabel;
      const titleTooltip = bib ? `${bib.title} (${bib.author})` : `Citation: ${cleanKey}`;

      renderedBadges.push(
        `<a href="#bib-${cleanKey}" class="citation-ref-badge" title="${titleTooltip.replace(/"/g, '&quot;')}" style="display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; margin: 0 2px; border-radius: 6px; font-size: 0.82em; font-family: inherit; font-weight: 600; color: var(--accent-cyan); background: rgba(6, 182, 212, 0.12); border: 1px solid rgba(6, 182, 212, 0.25); text-decoration: none; transition: all 0.15s ease;">` +
        `<span style="opacity: 0.7; font-size: 0.85em;">📚</span> ${fullLabel}</a>`
      );
    }

    return renderedBadges.join(' ');
  });

  // Restore protected code spans
  for (let i = 0; i < codeSpans.length; i++) {
    transformed = transformed.replace(`${placeholderPrefix}${i}%%`, () => codeSpans[i]);
  }

  // If citations were used, append Bibliography section
  if (citedKeys.size > 0) {
    const bibItemsHtml: string[] = [];

    citedKeys.forEach((key) => {
      const bib = bibEntries.get(key);
      if (bib) {
        const venue = bib.journal || bib.booktitle || '';
        const linkHtml = bib.url ? ` <a href="${bib.url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-cyan); text-decoration: none; font-size: 0.85rem;">[Link ↗]</a>` : '';
        const doiHtml = bib.doi ? ` <a href="https://doi.org/${bib.doi}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary); text-decoration: none; font-size: 0.85rem;">[DOI]</a>` : '';

        bibItemsHtml.push(
          `<li id="bib-${key}" class="bibliography-item" style="margin-bottom: 0.75rem; line-height: 1.5; font-size: 0.92rem; color: var(--text-secondary);">` +
          `<strong style="color: #fff;">${bib.author || 'Unknown'}</strong> (${bib.year || 'n.d.'}). ` +
          `<em>${bib.title}</em>. ` +
          (venue ? `<span style="color: var(--text-muted);">${venue}. </span>` : '') +
          `${doiHtml}${linkHtml}` +
          `</li>`
        );
      } else {
        bibItemsHtml.push(
          `<li id="bib-${key}" class="bibliography-item" style="margin-bottom: 0.75rem; line-height: 1.5; font-size: 0.92rem; color: var(--text-secondary);">` +
          `<code style="color: var(--accent-cyan);">${key}</code> <span style="color: var(--text-muted);">(Unresolved citation entry)</span>` +
          `</li>`
        );
      }
    });

    const bibliographySection =
      `\n\n<section class="research-bibliography ui-card" style="margin-top: 3rem; padding: 1.5rem 2rem; border-radius: 12px; border: 1px solid var(--border-glass); background: rgba(8, 12, 24, 0.85);">` +
      `<h3 style="font-size: 1.25rem; font-weight: 700; color: #fff; margin-top: 0; margin-bottom: 1.25rem; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-glass); padding-bottom: 0.75rem;">` +
      `<span>📚</span> References & Citations</h3>` +
      `<ol style="padding-left: 1.5rem; margin: 0;">${bibItemsHtml.join('\n')}</ol>` +
      `</section>`;

    return transformed + bibliographySection;
  }

  return transformed;
}
