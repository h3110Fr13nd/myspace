/**
 * Shiki Code Highlighter
 *
 * Provides async syntax highlighting for fenced code blocks using Shiki
 * (github-dark / github-light dual themes, matching the inspiration template).
 *
 * The async pipeline:
 *  1. Extract all ```lang\n...\n``` blocks from raw markdown, replace with %%ID%% placeholders
 *  2. Let the synchronous render engine process everything else
 *  3. Await codeToHtml() for each extracted block in parallel
 *  4. Substitute placeholders back with highlighted HTML
 *
 * Falls back to a styled plain <pre><code> block if Shiki cannot highlight
 * the given language.
 */

import { codeToHtml } from 'shiki';
import { renderBasesBlock } from './basesRenderer';

// Highlighted content is independent of the viewer and is expensive to rebuild
// on every SSR request. Keep only a small hot set; wrappers and copy IDs remain
// per-render. In-flight entries also make simultaneous views of the same code
// share one Shiki pass.
const MAX_HIGHLIGHT_CACHE_CHARS = 1_000_000;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 256;
const highlightedCache = new Map<string, { html: string; size: number }>();
const pendingHighlights = new Map<string, Promise<string>>();
let highlightedCacheSize = 0;

async function getHighlightedCode(lang: string, code: string): Promise<string> {
  const key = `${lang}\0${code}`;
  const cached = highlightedCache.get(key);
  if (cached) {
    highlightedCache.delete(key);
    highlightedCache.set(key, cached);
    return cached.html;
  }

  const pending = pendingHighlights.get(key);
  if (pending) return pending;

  const highlight = codeToHtml(code, {
    lang,
    themes: { dark: 'github-dark', light: 'github-light' },
    defaultColor: false,
  });
  pendingHighlights.set(key, highlight);

  try {
    const html = await highlight;
    const size = key.length + html.length;
    if (size <= MAX_HIGHLIGHT_CACHE_CHARS) {
      while (
        highlightedCache.size >= MAX_HIGHLIGHT_CACHE_ENTRIES ||
        highlightedCacheSize + size > MAX_HIGHLIGHT_CACHE_CHARS
      ) {
        const oldestKey = highlightedCache.keys().next().value;
        if (oldestKey === undefined) break;
        const oldest = highlightedCache.get(oldestKey)!;
        highlightedCache.delete(oldestKey);
        highlightedCacheSize -= oldest.size;
      }
      highlightedCache.set(key, { html, size });
      highlightedCacheSize += size;
    }
    return html;
  } finally {
    pendingHighlights.delete(key);
  }
}

export interface CodeBlock {
  id:    string;
  lang:  string;
  title?: string;
  code:  string;
}

/** Extract fenced code blocks from text, replacing them with %%SHIKI_N_lang%% placeholders. */
export function extractCodeBlocks(text: string): { text: string; blocks: CodeBlock[] } {
  const blocks: CodeBlock[] = [];
  let index = 0;
  // Match ```lang title="name" or ```lang
  const out = text.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, info, code) => {
    const infoStr = (info || '').trim();
    // Extract optional title="..." or title='...'
    const titleMatch = infoStr.match(/title=["']([^"']+)["']/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;
    
    // Extract language: first word in info string before any space or attribute
    const langMatch = infoStr.split(/[\s,{}]+/)[0];
    const language = (langMatch || 'text').trim() || 'text';

    const id = `SHIKI_${index++}_${language}`;
    blocks.push({ id, lang: language, title, code: code.trimEnd() });
    return `%%${id}%%`;
  });
  return { text: out, blocks };
}

/** Render a single code block with Shiki or dynamic Bases query engine. */
async function highlightBlock(block: CodeBlock): Promise<{ id: string; html: string }> {
  const { id, lang, title, code } = block;

  // Obsidian Dataview & Notion Bases dynamic queries
  if (lang === 'dataview' || lang === 'bases') {
    return {
      id,
      html: renderBasesBlock(code),
    };
  }

  const copyId    = `code-${Math.random().toString(36).slice(2, 9)}`;
  const titleHtml = title ? `<span class="code-title-badge">📄 ${escapeHtml(title)}</span>` : '';
  const langLabel = lang !== 'text' ? `<span class="code-lang-badge">${lang}</span>` : '';
  const headerHtml = (title || lang !== 'text')
    ? `<div class="code-header-bar" style="display: flex; align-items: center; justify-content: flex-start; gap: 6px; margin-bottom: -1px; position: relative; z-index: 2;">${titleHtml}${langLabel}</div>`
    : '';

  const copyBtn   = `<button class="code-copy-btn" aria-label="Copy code" onclick="(function(btn){btn.closest('.code-card').querySelector('.shiki-code-block code, .shiki-code-block')?.innerText&&navigator.clipboard.writeText(btn.closest('.code-card').querySelector('code')?.innerText||btn.closest('.code-card').querySelector('.shiki-code-block')?.innerText||'').then(function(){btn.textContent='✓ Copied!';setTimeout(function(){btn.textContent='Copy';},2000)})}).call(this,this)" style="position:absolute;top:8px;right:8px;z-index:5;font-size:0.7rem;padding:3px 10px;border-radius:6px;border:1px solid var(--border-glass);background:rgba(15,23,42,0.8);color:var(--text-secondary);cursor:pointer;font-family:var(--font-body);transition:all 0.2s ease;">Copy</button>`;

  try {
    const shikiHtml = await getHighlightedCode(lang, code);
    return {
      id,
      html: `<div class="code-card" style="position:relative;margin:1.25rem 0;">${headerHtml}${copyBtn}<div class="shiki-code-block" style="margin:0;overflow-x:auto;border-radius:12px;border:1px solid var(--border-glass);font-size:0.88rem;line-height:1.7;">${shikiHtml}</div></div>`,
    };
  } catch {
    return {
      id,
      html: `<div class="code-card" style="position:relative;margin:1.25rem 0;">${headerHtml}${copyBtn}<pre id="${copyId}" class="shiki-code-block" style="margin:0;padding:1rem;overflow-x:auto;border-radius:12px;border:1px solid var(--border-glass);background:rgba(13,17,27,0.95);font-size:0.88rem;line-height:1.7;"><code>${escapeHtml(code)}</code></pre></div>`,
    };
  }
}

/**
 * Substitute %%SHIKI_N_lang%% placeholders in `html` with Shiki-highlighted blocks.
 * All blocks are highlighted in parallel for efficiency.
 */
export async function injectHighlightedBlocks(
  html: string,
  blocks: CodeBlock[]
): Promise<string> {
  const results = await Promise.all(blocks.map(highlightBlock));
  for (const { id, html: highlighted } of results) {
    html = html.replace(`<p>%%${id}%%</p>`, highlighted).replace(`%%${id}%%`, highlighted);
  }
  return html;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strips all HTML tags (such as search highlight <mark> tags) from plain text labels/titles */
export function stripHtml(text?: string | null): string {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').trim();
}

