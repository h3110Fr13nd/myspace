/**
 * Dynamic resource bodies.
 *
 * A folder and a tag are resources whose text is not stored: it is either an
 * index document that already exists, or a listing generated on read. Both
 * kinds go through this one resolver so they cannot drift apart.
 *
 * The generated listing is *markdown*, not a card grid, so it is rendered by
 * the normal pipeline and therefore inherits wikilinks, callouts, citations and
 * every future prose feature — and can be linked to like any other note.
 *
 * SECURITY: callers must pass candidates that have already been through
 * `filterViewableResources`. Nothing here widens visibility, and an index
 * document is only used when the caller could see it, so an index can never act
 * as a side channel.
 */
import * as fs from 'fs';
import { renderMarkdownWithEmbedsAsync } from '../renderEngine';
import { buildResourcePath } from '../resourceUrls';
import { resolveResourceType } from '../registry/resourceRegistry';

export type DynamicKind = 'folder' | 'tag';
export type DynamicBodyKind = 'index' | 'listing' | 'empty';

export interface DynamicCandidate {
  id: string;
  type?: string;
  title?: string;
  path?: string;
  created_at?: string;
  updated_at?: string;
  parent_id?: string | null;
  metadata?: Record<string, any> | null;
}

export interface DynamicBodyInput {
  kind: DynamicKind;
  /** Heading used when the body is generated. */
  title: string;
  /** Permission-filtered resources that belong to this folder / tag. */
  candidates: DynamicCandidate[];
  /** Permission-filtered index document, if one exists. */
  indexDoc?: DynamicCandidate | null;
  currentUser?: string;
}

export interface DynamicBody {
  kind: DynamicBodyKind;
  html: string;
  /** How many resources the body represents (0 for an index or empty body). */
  count: number;
}

const INDEX_STEMS = new Set(['index', 'readme']);

function normalizeStem(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function escapeMarkdown(text: string): string {
  return text.replace(/[[\]]/g, '').replace(/([*_`])/g, '\\$1');
}

function label(resource: DynamicCandidate): string {
  if (resource.type === 'folder' || resource.type === 'space') return 'Folder';
  try {
    return resolveResourceType(resource as any).label;
  } catch {
    return resource.type || 'Note';
  }
}

/** Detect the index document among already-filtered candidates. */
export function findIndexDoc(candidates: DynamicCandidate[]): DynamicCandidate | null {
  return (
    candidates.find((r) => {
      if (r.type !== 'document' && r.type !== 'md') return false;
      if (INDEX_STEMS.has(normalizeStem(r.title))) return true;
      if (INDEX_STEMS.has(normalizeStem(r.metadata?.slug))) return true;
      if (INDEX_STEMS.has(normalizeStem(r.metadata?.filename))) return true;
      const base = normalizeStem(String(r.path || '').split('/').pop())
        .replace(/\.(md|mdx|markdown)$/, '');
      return INDEX_STEMS.has(base);
    }) || null
  );
}

/**
 * Read an index document's body. The markdown may live in the `content` column
 * (migrations schema) or on disk via `metadata.filePath` (docker init schema).
 */
async function readIndexBody(doc: DynamicCandidate): Promise<string | null> {
  const meta = (doc.metadata || {}) as Record<string, any>;
  const filePath = typeof meta.filePath === 'string' ? meta.filePath : '';
  const inline = typeof meta.content === 'string' ? meta.content : '';

  if (inline.trim()) return inline;

  if (filePath) {
    try {
      if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
    } catch {
      /* fall through to null */
    }
  }

  // Last resort: the resource row may still carry the body.
  try {
    const { query } = await import('../db');
    const res = await query('SELECT content FROM resources WHERE id = $1', [doc.id]);
    const content = res.rows?.[0]?.content;
    if (typeof content === 'string' && content.trim()) return content;
  } catch {
    /* no content column on this schema */
  }

  return null;
}

function bullet(resource: DynamicCandidate, heading: string): string {
  const title = escapeMarkdown(resource.title || resource.path || resource.id);
  const href = buildResourcePath(resource as any, resource.path || undefined);
  const parts = [`- [${title}](${href})`];
  const summary =
    (typeof resource.metadata?.summary === 'string' && resource.metadata.summary.trim()) ||
    (typeof resource.metadata?.description === 'string' && resource.metadata.description.trim());
  if (summary) parts.push(` — ${escapeMarkdown(summary.slice(0, 160))}`);
  else if (heading) parts.push(` _(${heading})_`);
  return parts.join('');
}

/** Build the listing markdown for a set of viewable resources. */
export function buildListingMarkdown(
  kind: DynamicKind,
  title: string,
  candidates: DynamicCandidate[]
): string {
  const notes = candidates.filter((r) => r.type !== 'folder' && r.type !== 'space');
  const folders = candidates.filter((r) => r.type === 'folder' || r.type === 'space');

  const sections: string[] = [];

  if (folders.length) {
    sections.push(
      ['## Folders', folders
        .slice()
        .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
        .map((f) => bullet(f, ''))
        .join('\n')].join('\n\n')
    );
  }

  if (kind === 'tag') {
    // Group a tag by resource type so the note stays scannable.
    const byType = new Map<string, DynamicCandidate[]>();
    for (const n of notes) {
      const key = label(n);
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(n);
    }
    const ordered = [...byType.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [typeLabel, group] of ordered) {
      sections.push(
        [`## ${typeLabel} (${group.length})`, group
          .slice()
          .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
          .map((n) => bullet(n, ''))
          .join('\n')].join('\n\n')
      );
    }
  } else {
    // A folder lists its notes newest first, the way a vault index reads.
    const ordered = notes.slice().sort((a, b) => {
      const at = new Date(a.updated_at || a.created_at || 0).getTime();
      const bt = new Date(b.updated_at || b.created_at || 0).getTime();
      return bt - at;
    });
    sections.push(
      [`## Notes (${ordered.length})`, ordered.map((n) => bullet(n, '')).join('\n')].join('\n\n')
    );
  }

  const noun = kind === 'tag' ? 'tagged resource' : 'note';
  const intro = `_${candidates.length} viewable ${noun}${candidates.length === 1 ? '' : 's'} in **${escapeMarkdown(title)}**._`;

  return [intro, ...sections].filter(Boolean).join('\n\n');
}

export async function resolveDynamicBody(input: DynamicBodyInput): Promise<DynamicBody> {
  const { kind, title, candidates, indexDoc, currentUser = 'user:anonymous' } = input;

  if (indexDoc) {
    const body = await readIndexBody(indexDoc);
    if (body && body.trim()) {
      const html = await renderMarkdownWithEmbedsAsync(body, currentUser, 0);
      return { kind: 'index', html, count: candidates.length };
    }
  }

  if (candidates.length === 0) {
    const html = await renderMarkdownWithEmbedsAsync(
      kind === 'tag'
        ? `_No resources with this tag are visible to you._`
        : `_This folder is empty, or nothing in it is visible to you._`,
      currentUser,
      0
    );
    return { kind: 'empty', html, count: 0 };
  }

  const markdown = buildListingMarkdown(kind, title, candidates);
  const html = await renderMarkdownWithEmbedsAsync(markdown, currentUser, 0);
  return { kind: 'listing', html, count: candidates.length };
}
