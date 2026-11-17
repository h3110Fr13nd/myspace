import { deleteTriggerToken } from './triggerToken';

export type WikilinkMode = 'link' | 'embed';

export interface WikilinkCandidate {
  id: string;
  slug: string;
  title: string;
  type?: string;
  category?: string;
  icon?: string;
}

/** Normalizes any resource id (`document:foo`) down to its slug (`foo`). */
export function toSlug(idOrSlug: string): string {
  return idOrSlug.replace(/^[^:]+:/, '');
}

/**
 * Fetches wikilink/embed suggestions. Returns a normalized, UI-ready shape and
 * tolerates both the Meilisearch and PostgreSQL response variants.
 */
export async function fetchWikilinkCandidates(
  query: string,
  signal?: AbortSignal
): Promise<WikilinkCandidate[]> {
  const term = query.trim();
  const res = await fetch(`/api/v1/search?q=${encodeURIComponent(term || 'a')}`, { signal });
  if (!res.ok) return [];

  const data = await res.json();
  const results: any[] = Array.isArray(data.results) ? data.results : [];

  return results.map((r) => ({
    id: r.id,
    slug: r.slug || r.metadata?.slug || toSlug(r.id),
    title: r.title || toSlug(r.id),
    type: r.type,
    category: r.category || r.metadata?.category,
    icon: r.icon || r.metadata?.icon,
  }));
}

/** Replaces the active `[[` / `![[` trigger with the chosen note. */
export function insertWikilink(editor: any, candidate: WikilinkCandidate, mode: WikilinkMode): void {
  const target = candidate.slug || toSlug(candidate.id);
  const token = mode === 'embed' ? '![[' : '[[';

  if (!deleteTriggerToken(editor, token)) return;

  if (mode === 'embed') {
    editor.chain().focus().insertEmbedBlock(target).run();
  } else {
    editor.chain().focus().insertContent(`[[${target}]] `).run();
  }
}
