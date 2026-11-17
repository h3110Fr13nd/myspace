/**
 * Obsidian-Flavored Callouts / Admonitions Parser
 *
 * Supports all 12 standard Obsidian callout types and their aliases:
 *   note, abstract (summary, tldr), info, todo, tip (hint, important),
 *   success (check, done), question (help, faq), warning (attention, caution),
 *   failure (missing, fail), danger (error), bug, example, quote (cite).
 *
 * Also supports:
 *   - Foldable callouts:
 *       > [!type]- Collapsed by default
 *       > [!type]+ Expanded by default
 *   - Custom titles
 *   - Nested markdown rendering within callout body
 */

import { marked } from 'marked';

export interface CalloutMeta {
  type: string;
  icon: string;
  colorVar: string;
  bgVar: string;
  borderVar: string;
  defaultTitle: string;
}

const CALLOUT_TYPES: Record<string, CalloutMeta> = {
  note: {
    type: 'note',
    icon: '📝',
    colorVar: 'var(--accent-cyan)',
    bgVar: 'rgba(6, 182, 212, 0.08)',
    borderVar: 'rgba(6, 182, 212, 0.35)',
    defaultTitle: 'Note',
  },
  abstract: {
    type: 'abstract',
    icon: '📋',
    colorVar: 'var(--accent-cyan)',
    bgVar: 'rgba(6, 182, 212, 0.08)',
    borderVar: 'rgba(6, 182, 212, 0.35)',
    defaultTitle: 'Abstract',
  },
  summary: {
    type: 'abstract',
    icon: '📋',
    colorVar: 'var(--accent-cyan)',
    bgVar: 'rgba(6, 182, 212, 0.08)',
    borderVar: 'rgba(6, 182, 212, 0.35)',
    defaultTitle: 'Summary',
  },
  tldr: {
    type: 'abstract',
    icon: '📋',
    colorVar: 'var(--accent-cyan)',
    bgVar: 'rgba(6, 182, 212, 0.08)',
    borderVar: 'rgba(6, 182, 212, 0.35)',
    defaultTitle: 'TL;DR',
  },
  info: {
    type: 'info',
    icon: 'ℹ️',
    colorVar: 'var(--accent-cyan)',
    bgVar: 'rgba(6, 182, 212, 0.08)',
    borderVar: 'rgba(6, 182, 212, 0.35)',
    defaultTitle: 'Info',
  },
  todo: {
    type: 'todo',
    icon: '☑️',
    colorVar: 'var(--accent-cyan)',
    bgVar: 'rgba(6, 182, 212, 0.08)',
    borderVar: 'rgba(6, 182, 212, 0.35)',
    defaultTitle: 'Todo',
  },
  tip: {
    type: 'tip',
    icon: '💡',
    colorVar: 'var(--accent-emerald)',
    bgVar: 'rgba(16, 185, 129, 0.08)',
    borderVar: 'rgba(16, 185, 129, 0.35)',
    defaultTitle: 'Tip',
  },
  hint: {
    type: 'tip',
    icon: '💡',
    colorVar: 'var(--accent-emerald)',
    bgVar: 'rgba(16, 185, 129, 0.08)',
    borderVar: 'rgba(16, 185, 129, 0.35)',
    defaultTitle: 'Hint',
  },
  important: {
    type: 'important',
    icon: '📌',
    colorVar: 'var(--accent-primary)',
    bgVar: 'rgba(99, 102, 241, 0.08)',
    borderVar: 'rgba(99, 102, 241, 0.35)',
    defaultTitle: 'Important',
  },
  success: {
    type: 'success',
    icon: '✅',
    colorVar: 'var(--accent-emerald)',
    bgVar: 'rgba(16, 185, 129, 0.08)',
    borderVar: 'rgba(16, 185, 129, 0.35)',
    defaultTitle: 'Success',
  },
  check: {
    type: 'success',
    icon: '✅',
    colorVar: 'var(--accent-emerald)',
    bgVar: 'rgba(16, 185, 129, 0.08)',
    borderVar: 'rgba(16, 185, 129, 0.35)',
    defaultTitle: 'Check',
  },
  done: {
    type: 'success',
    icon: '✅',
    colorVar: 'var(--accent-emerald)',
    bgVar: 'rgba(16, 185, 129, 0.08)',
    borderVar: 'rgba(16, 185, 129, 0.35)',
    defaultTitle: 'Done',
  },
  question: {
    type: 'question',
    icon: '❓',
    colorVar: 'var(--accent-amber)',
    bgVar: 'rgba(245, 158, 11, 0.08)',
    borderVar: 'rgba(245, 158, 11, 0.35)',
    defaultTitle: 'Question',
  },
  help: {
    type: 'question',
    icon: '❓',
    colorVar: 'var(--accent-amber)',
    bgVar: 'rgba(245, 158, 11, 0.08)',
    borderVar: 'rgba(245, 158, 11, 0.35)',
    defaultTitle: 'Help',
  },
  faq: {
    type: 'question',
    icon: '❓',
    colorVar: 'var(--accent-amber)',
    bgVar: 'rgba(245, 158, 11, 0.08)',
    borderVar: 'rgba(245, 158, 11, 0.35)',
    defaultTitle: 'FAQ',
  },
  warning: {
    type: 'warning',
    icon: '⚠️',
    colorVar: 'var(--accent-amber)',
    bgVar: 'rgba(245, 158, 11, 0.08)',
    borderVar: 'rgba(245, 158, 11, 0.35)',
    defaultTitle: 'Warning',
  },
  attention: {
    type: 'warning',
    icon: '⚠️',
    colorVar: 'var(--accent-amber)',
    bgVar: 'rgba(245, 158, 11, 0.08)',
    borderVar: 'rgba(245, 158, 11, 0.35)',
    defaultTitle: 'Attention',
  },
  caution: {
    type: 'warning',
    icon: '🚨',
    colorVar: 'var(--accent-rose)',
    bgVar: 'rgba(244, 63, 94, 0.08)',
    borderVar: 'rgba(244, 63, 94, 0.35)',
    defaultTitle: 'Caution',
  },
  failure: {
    type: 'failure',
    icon: '❌',
    colorVar: 'var(--accent-rose)',
    bgVar: 'rgba(244, 63, 94, 0.08)',
    borderVar: 'rgba(244, 63, 94, 0.35)',
    defaultTitle: 'Failure',
  },
  missing: {
    type: 'failure',
    icon: '❌',
    colorVar: 'var(--accent-rose)',
    bgVar: 'rgba(244, 63, 94, 0.08)',
    borderVar: 'rgba(244, 63, 94, 0.35)',
    defaultTitle: 'Missing',
  },
  fail: {
    type: 'failure',
    icon: '❌',
    colorVar: 'var(--accent-rose)',
    bgVar: 'rgba(244, 63, 94, 0.08)',
    borderVar: 'rgba(244, 63, 94, 0.35)',
    defaultTitle: 'Fail',
  },
  danger: {
    type: 'danger',
    icon: '⚡',
    colorVar: 'var(--accent-rose)',
    bgVar: 'rgba(244, 63, 94, 0.08)',
    borderVar: 'rgba(244, 63, 94, 0.35)',
    defaultTitle: 'Danger',
  },
  error: {
    type: 'danger',
    icon: '⚡',
    colorVar: 'var(--accent-rose)',
    bgVar: 'rgba(244, 63, 94, 0.08)',
    borderVar: 'rgba(244, 63, 94, 0.35)',
    defaultTitle: 'Error',
  },
  bug: {
    type: 'bug',
    icon: '🐛',
    colorVar: 'var(--accent-rose)',
    bgVar: 'rgba(244, 63, 94, 0.08)',
    borderVar: 'rgba(244, 63, 94, 0.35)',
    defaultTitle: 'Bug',
  },
  example: {
    type: 'example',
    icon: '🧪',
    colorVar: 'var(--accent-primary)',
    bgVar: 'rgba(99, 102, 241, 0.08)',
    borderVar: 'rgba(99, 102, 241, 0.35)',
    defaultTitle: 'Example',
  },
  quote: {
    type: 'quote',
    icon: '💬',
    colorVar: 'var(--text-secondary)',
    bgVar: 'rgba(255, 255, 255, 0.04)',
    borderVar: 'rgba(255, 255, 255, 0.15)',
    defaultTitle: 'Quote',
  },
  cite: {
    type: 'quote',
    icon: '💬',
    colorVar: 'var(--text-secondary)',
    bgVar: 'rgba(255, 255, 255, 0.04)',
    borderVar: 'rgba(255, 255, 255, 0.15)',
    defaultTitle: 'Cite',
  },
};

/**
 * Transforms Obsidian-style callout blockquotes into HTML blocks.
 */
export function applyCallouts(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Match callout header line: > [!type][+-]? [Title]
    const headerMatch = line.match(/^>\s*\[!([a-zA-Z0-9_-]+)\]([+-]?)(?:\s+(.*))?$/);

    if (headerMatch) {
      const rawType = headerMatch[1].toLowerCase();
      const foldChar = headerMatch[2]; // '+' or '-' or ''
      const customTitle = headerMatch[3]?.trim();

      const meta = CALLOUT_TYPES[rawType] || {
        type: rawType,
        icon: '📝',
        colorVar: 'var(--accent-cyan)',
        bgVar: 'rgba(6, 182, 212, 0.08)',
        borderVar: 'rgba(6, 182, 212, 0.35)',
        defaultTitle: rawType.charAt(0).toUpperCase() + rawType.slice(1),
      };

      const title = customTitle || meta.defaultTitle;
      const isFoldable = foldChar === '+' || foldChar === '-';
      const isDefaultOpen = foldChar !== '-';

      // Collect callout body lines (all contiguous lines starting with '>')
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length) {
        const bl = lines[i];
        if (bl.match(/^>\s*\[!([a-zA-Z0-9_-]+)\]/)) {
          // Reached a new callout header - stop collecting body
          break;
        }
        if (bl.startsWith('>')) {
          bodyLines.push(bl.replace(/^>\s?/, ''));
          i++;
        } else if (bl.trim() === '' && i + 1 < lines.length && lines[i + 1].startsWith('>')) {
          bodyLines.push('');
          i++;
        } else {
          break;
        }
      }

      const bodyMarkdown = bodyLines.join('\n').trim();
      const bodyHtml = bodyMarkdown ? (marked.parse(bodyMarkdown) as string) : '';

      if (isFoldable) {
        result.push(
          `<details class="obsidian-callout obsidian-callout--${meta.type}" data-callout="${meta.type}" ${isDefaultOpen ? 'open' : ''} style="margin: 1.25rem 0; border-radius: 10px; border-left: 4px solid ${meta.colorVar}; border-top: 1px solid ${meta.borderVar}; border-right: 1px solid ${meta.borderVar}; border-bottom: 1px solid ${meta.borderVar}; background: ${meta.bgVar};">` +
          `<summary class="callout-title" style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #fff; cursor: pointer; padding: 10px 14px; list-style: none; user-select: none;">` +
          `<span class="callout-icon" style="font-size: 1.05rem;">${meta.icon}</span>` +
          `<span class="callout-label" style="flex: 1;">${title}</span>` +
          `<span class="callout-fold-indicator" style="font-size: 0.75rem; color: var(--text-muted); transition: transform 0.2s ease;">▼</span>` +
          `</summary>` +
          `<div class="callout-content" style="padding: 0 14px 12px 14px; font-size: 0.92rem; color: var(--text-secondary); line-height: 1.6;">${bodyHtml}</div>` +
          `</details>`
        );
      } else {
        result.push(
          `<div class="obsidian-callout obsidian-callout--${meta.type}" data-callout="${meta.type}" style="margin: 1.25rem 0; border-radius: 10px; border-left: 4px solid ${meta.colorVar}; border-top: 1px solid ${meta.borderVar}; border-right: 1px solid ${meta.borderVar}; border-bottom: 1px solid ${meta.borderVar}; background: ${meta.bgVar};">` +
          `<div class="callout-title" style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #fff; padding: 10px 14px 6px 14px;">` +
          `<span class="callout-icon" style="font-size: 1.05rem;">${meta.icon}</span>` +
          `<span class="callout-label">${title}</span>` +
          `</div>` +
          `<div class="callout-content" style="padding: 0 14px 12px 14px; font-size: 0.92rem; color: var(--text-secondary); line-height: 1.6;">${bodyHtml}</div>` +
          `</div>`
        );
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}
