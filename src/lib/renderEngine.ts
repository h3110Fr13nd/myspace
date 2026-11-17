/**
 * Render Engine — Orchestrator
 *
 * Composes the modular render pipeline for Markdown notes:
 *
 *   Step 1  MDX component tags  → render/mdxComponents.ts
 *   Step 2  KaTeX math          → render/mathRenderer.ts
 *   Step 3  Embeds + wikilinks  → render/embedResolver.ts
 *   Step 4  markedInstance.parse() (isolated per-request Markdown → HTML pass)
 *   Step 5  Shiki code blocks   → render/codeHighlighter.ts  (async only)
 *
 * Two public exports:
 *   renderMarkdownWithEmbeds()       — synchronous (no Shiki, fallback plain code)
 *   renderMarkdownWithEmbedsAsync()  — async, uses Shiki for full syntax highlighting
 *
 * Design decision: MAX_EMBED_DEPTH = 3 caps recursive transclusion to avoid
 * infinite loops and excessive server-side rendering depth.
 */

import { Marked, Renderer, type Tokens } from 'marked';
import * as fs from 'fs';
import { applyMdxComponents } from './render/mdxComponents';
import { applyMathRendering } from './render/mathRenderer';
import { resolveEmbeds, resolveWikilinks, MAX_EMBED_DEPTH } from './render/embedResolver';
import { extractCodeBlocks, injectHighlightedBlocks, escapeHtml } from './render/codeHighlighter';
import { renderBasesBlock } from './render/basesRenderer';
import { applyCustomEditorBlocks } from './render/customBlocks';
import { applyCallouts } from './render/calloutParser';
import { applyCitations } from './render/citationParser';

export { MAX_EMBED_DEPTH };

/**
 * Resolve raw MDX source from disk: read the file, strip the YAML frontmatter
 * and any bare `import ... from '...'` lines that Marked would not handle.
 */
function resolveMdxFileImports(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const stripped = raw.replace(/^---[\s\S]*?---\s*/, '');
  return stripped.replace(/^import\s.+$/gm, '');
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Isolated Marked instance with safe code block renderer to prevent SSR mutation race conditions,
 * plus custom heading and paragraph block id support.
 */
function createMarkedInstance() {
  const tableRenderer = new Renderer();

  return new Marked({
    renderer: {
      table(token: Tokens.Table): string {
        tableRenderer.parser = this.parser;
        const tableHtml = tableRenderer.table(token);
        const needsHint = token.header.length > 2 ||
          token.rows.some((row) => row.some((cell) => cell.text.length > 32));
        const hint = needsHint
          ? '<span class="prose-table-scroll__hint" aria-hidden="true">Scroll horizontally to see all columns</span>'
          : '';
        return `<div class="prose-table-scroll" role="region" tabindex="0" aria-label="Scrollable data table">${hint}${tableHtml}</div>\n`;
      },
      heading({ tokens, depth }: { tokens: any[]; depth: number }): string {
        const inlineText = this.parser.parseInline(tokens);
        const rawText = tokens.map((t) => ('text' in t ? t.text : '')).join('');
        const id = slugifyHeading(rawText);
        return `<h${depth}${id ? ` id="${id}"` : ''}>${inlineText}</h${depth}>\n`;
      },
      paragraph({ tokens }: { tokens: any[] }): string {
        const lastToken = tokens[tokens.length - 1];
        if (lastToken && lastToken.type === 'text') {
          const match = lastToken.text.match(/\s*\^([a-zA-Z0-9_-]+)\s*$/);
          if (match) {
            const blockId = match[1].replace(/^\^/, '');
            lastToken.text = lastToken.text.replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, '');
            if ('raw' in lastToken) {
              lastToken.raw = lastToken.raw.replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, '');
            }
            const inlineText = this.parser.parseInline(tokens);
            return `<p id="block-${blockId}" data-block-id="${blockId}">${inlineText}</p>\n`;
          }
        }
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      code({ text: code, lang }: { text: string; lang?: string }): string {
        const infoStr = (lang || '').trim();
        const titleMatch = infoStr.match(/title=["']([^"']+)["']/i);
        const title = titleMatch ? titleMatch[1].trim() : undefined;
        const language = infoStr.split(/[\s,{}]+/)[0] || 'text';

        if (language === 'dataview' || language === 'bases') {
          return renderBasesBlock(code);
        }

        const titleHtml = title ? `<span class="code-title-badge">📄 ${escapeHtml(title)}</span>` : '';
        const langLabel = language !== 'text' ? `<span class="code-lang-badge">${language}</span>` : '';
        const headerHtml = (title || language !== 'text')
          ? `<div class="code-header-bar" style="display: flex; align-items: center; justify-content: flex-start; gap: 6px; margin-bottom: -1px; position: relative; z-index: 2;">${titleHtml}${langLabel}</div>`
          : '';

        const copyId = `code-${Math.random().toString(36).slice(2, 9)}`;
        return `<div class="code-card" style="position:relative;margin:1.25rem 0;">${headerHtml}<button class="code-copy-btn" aria-label="Copy code" onclick="(function(btn){var p=document.getElementById('${copyId}');if(p)navigator.clipboard.writeText(p.innerText).then(function(){btn.textContent='✓ Copied!';setTimeout(function(){btn.textContent='Copy';},2000)})}).call(this,this)" style="position:absolute;top:8px;right:8px;z-index:5;font-size:0.7rem;padding:3px 10px;border-radius:6px;border:1px solid var(--border-glass);background:rgba(15,23,42,0.8);color:var(--text-secondary);cursor:pointer;font-family:var(--font-body);transition:all 0.2s ease;">Copy</button><pre id="${copyId}" class="shiki-code-block" data-language="${language}" style="margin:0;padding:1rem;overflow-x:auto;border-radius:12px;border:1px solid var(--border-glass);background:rgba(13,17,27,0.95);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Courier New',monospace;font-size:0.88rem;line-height:1.7;"><code>${escapeHtml(code)}</code></pre></div>`;
      },
    },
  });
}

const localMarked = createMarkedInstance();

// Re-rendering the same static note for concurrent readers repeats the entire
// Markdown pipeline and creates substantial short-lived HTML/token garbage.
// Cache only deterministic top-level notes; user-dependent embeds, citations,
// and live query blocks keep their existing per-request behavior.
const MAX_RENDER_CACHE_ENTRIES = 64;
const MAX_RENDER_CACHE_CHARS = 1_000_000;
const MAX_RENDER_ENTRY_CHARS = 200_000;
const MAX_PENDING_RENDERS = 128;
const renderedMarkdown = new Map<string, { html: string; size: number }>();
const pendingMarkdown = new Map<string, Promise<string>>();
let renderedMarkdownChars = 0;

function canCacheMarkdown(source: string, depth: number, filePath?: string): boolean {
  return depth === 0 && !filePath && source.length <= MAX_RENDER_ENTRY_CHARS &&
    !source.includes('![[') && !source.includes('[@') &&
    !/```\s*(?:dataview|bases)\b/i.test(source);
}

function rememberRenderedMarkdown(source: string, html: string): void {
  const size = source.length + html.length;
  if (size > MAX_RENDER_ENTRY_CHARS || size > MAX_RENDER_CACHE_CHARS) return;

  while (
    renderedMarkdown.size >= MAX_RENDER_CACHE_ENTRIES ||
    renderedMarkdownChars + size > MAX_RENDER_CACHE_CHARS
  ) {
    const oldestSource = renderedMarkdown.keys().next().value;
    if (oldestSource === undefined) break;
    const oldest = renderedMarkdown.get(oldestSource)!;
    renderedMarkdown.delete(oldestSource);
    renderedMarkdownChars -= oldest.size;
  }

  renderedMarkdown.set(source, { html, size });
  renderedMarkdownChars += size;
}

// ---------------------------------------------------------------------------
// Synchronous render (no Shiki — plain styled code blocks)
// ---------------------------------------------------------------------------

export function renderMarkdownWithEmbeds(
  rawBody: string,
  currentUser: string = 'user:anonymous',
  depth: number = 0,
  filePath?: string
): string {
  let text = rawBody;
  if (filePath && (filePath.endsWith('.mdx') || filePath.endsWith('.md')) && fs.existsSync(filePath)) {
    text = resolveMdxFileImports(filePath);
  } else {
    text = text.replace(/^---[\s\S]*?---\s*/, '');
  }

  text = applyMdxComponents(text);
  text = applyCustomEditorBlocks(text);
  text = applyCallouts(text);
  text = applyCitations(text);
  text = applyMathRendering(text);
  text = resolveEmbeds(text, currentUser, depth, renderMarkdownWithEmbeds);
  text = resolveWikilinks(text);

  // Obsidian Flavored Markdown: ==highlight==
  text = text.replace(/==([^=\n]+)==/g, '<mark class="highlight">$1</mark>');

  // Strikethrough: ~~text~~
  text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Interactive Task List items
  text = text.replace(/^(\s*)-\s+\[ \]\s+(.*)$/gm, '$1<li class="task-list-item"><input type="checkbox" disabled /> <span>$2</span></li>');
  text = text.replace(/^(\s*)-\s+\[[xX]\]\s+(.*)$/gm, '$1<li class="task-list-item"><input type="checkbox" checked disabled /> <span>$2</span></li>');

  return localMarked.parse(text) as string;
}

// ---------------------------------------------------------------------------
// Async render (with Shiki syntax highlighting)
// ---------------------------------------------------------------------------

export async function renderMarkdownWithEmbedsAsync(
  rawBody: string,
  currentUser: string = 'user:anonymous',
  depth: number = 0,
  filePath?: string
): Promise<string> {
  let sourceText = rawBody;
  if (filePath && (filePath.endsWith('.mdx') || filePath.endsWith('.md')) && fs.existsSync(filePath)) {
    sourceText = resolveMdxFileImports(filePath);
  } else {
    sourceText = sourceText.replace(/^---[\s\S]*?---\s*/, '');
  }

  const cacheable = canCacheMarkdown(sourceText, depth, filePath);
  if (cacheable) {
    const cached = renderedMarkdown.get(sourceText);
    if (cached) {
      renderedMarkdown.delete(sourceText);
      renderedMarkdown.set(sourceText, cached);
      return cached.html;
    }

    const pending = pendingMarkdown.get(sourceText);
    if (pending) return pending;
  }

  const render = async () => {
    // Extract fenced code blocks before the synchronous pipeline touches them
    const { text: textWithPlaceholders, blocks } = extractCodeBlocks(sourceText);

    // Run the synchronous pipeline (MDX → math → embeds → wikilinks → marked)
    const html = renderMarkdownWithEmbeds(
      `---\n---\n${textWithPlaceholders}`,
      currentUser,
      depth
    );

    // Substitute placeholders with Shiki-highlighted blocks (parallel)
    return injectHighlightedBlocks(html, blocks);
  };

  const work = render();
  if (!cacheable || pendingMarkdown.size >= MAX_PENDING_RENDERS) return work;

  pendingMarkdown.set(sourceText, work);
  try {
    const html = await work;
    rememberRenderedMarkdown(sourceText, html);
    return html;
  } finally {
    if (pendingMarkdown.get(sourceText) === work) pendingMarkdown.delete(sourceText);
  }
}

