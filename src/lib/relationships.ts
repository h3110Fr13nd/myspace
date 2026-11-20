/**
 * Named relationships between resources (proof of concept).
 *
 * Two ways to declare one, both allowing several relationships between the
 * same pair of notes:
 *
 *  1. Inline, Obsidian-style with an extra pipe:
 *       [[target|what to show|relationship]]
 *     `[[target||cites]]` (empty alias) shows the target's own name.
 *     Plain `[[target]]` / `[[target|alias]]` stay ordinary, unnamed links.
 *
 *  2. Metadata / frontmatter, any of these forms:
 *       relationships: [cites:other-note, extends:third-note]
 *       relationships:
 *         - { target: other-note, type: supports }
 *         - { target: other-note, type: cites }
 *       relationships:
 *         supports: [other-note, third-note]
 *         cites: other-note
 *
 * Both are normalised to `{ target, type }` pairs and stored in
 * `metadata.relationships` (deduplicated per target + type).
 */

export interface Relationship {
  /** Slug or id, resolved like a wikilink target. */
  target: string;
  /** Relationship name, e.g. "cites", "contradicts". */
  type: string;
}

const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

/** Markdown without fenced code blocks and inline code (examples are not links). */
export function stripMarkdownCode(md: string): string {
  return md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** `[[target|alias|type]]` occurrences in markdown (outside code). */
export function extractInlineRelationships(content: string | undefined | null): Relationship[] {
  if (!content) return [];
  const out: Relationship[] = [];
  for (const m of stripMarkdownCode(content).matchAll(/(?<!!)\[\[([^\]]*?)\]\]/g)) {
    const parts = m[1].split('|');
    if (parts.length < 3) continue;
    const target = clean(parts[0]).split('#')[0].trim();
    const type = clean(parts.slice(2).join('|'));
    if (target && type) out.push({ target, type });
  }
  return dedupe(out);
}

/** Normalise `metadata.relationships` (array or map form). */
export function metadataRelationships(metadata: any): Relationship[] {
  const raw = metadata?.relationships;
  const out: Relationship[] = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      // Compact frontmatter form: `relationships: [cites:other-note, extends:third]`.
      if (typeof r === 'string') {
        const i = r.indexOf(':');
        const type = clean(r.slice(0, i));
        const target = clean(r.slice(i + 1));
        if (i > 0 && type && target) out.push({ target, type });
        continue;
      }
      if (!r || typeof r !== 'object') continue;
      const target = clean(r.target ?? r.to ?? r.id);
      const type = clean(r.type ?? r.label ?? r.relation ?? r.name);
      if (target && type) out.push({ target, type });
    }
  } else if (raw && typeof raw === 'object') {
    for (const [type, targets] of Object.entries(raw)) {
      for (const t of Array.isArray(targets) ? targets : [targets]) {
        const target = clean(t);
        if (target && clean(type)) out.push({ target, type: clean(type) });
      }
    }
  }
  return dedupe(out);
}

/** Metadata relationships plus inline ones, deduplicated. */
export function collectRelationships(metadata: any, content?: string | null): Relationship[] {
  return dedupe([...metadataRelationships(metadata), ...extractInlineRelationships(content)]);
}

function dedupe(list: Relationship[]): Relationship[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = `${r.target}\u0000${r.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A relationship a canvas draws between two other resources. */
export interface EdgeRelationship extends Relationship {
  /** Slug or id of the resource the edge starts at. */
  source: string;
}

/** The resource a canvas node stands for: a resource card, or a file card's note. */
function canvasNodeRef(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.resourceId === 'string' && node.resourceId) return node.resourceId;
  if (typeof node.file === 'string' && /\.(md|mdx|canvas)$/i.test(node.file)) {
    // Resolved like a wikilink: the file's basename is the note's slug.
    return node.file.split('/').pop()!.replace(/\.(md|mdx|canvas)$/i, '') || null;
  }
  return null;
}

/**
 * Canvas edges as graph relationships: a labelled edge between two cards that
 * stand for resources says "source —label→ target", the same statement as an
 * inline `[[target|…|label]]` in the source note. Unlabelled edges and edges
 * touching plain text/link/group cards are not relationships.
 */
export function canvasEdgeRelationships(doc: { nodes?: any[]; edges?: any[] } | null | undefined): EdgeRelationship[] {
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return [];
  const refs = new Map<string, string>();
  for (const n of doc.nodes) {
    const ref = canvasNodeRef(n);
    if (ref && typeof n.id === 'string') refs.set(n.id, ref);
  }
  const out: EdgeRelationship[] = [];
  const seen = new Set<string>();
  for (const e of doc.edges) {
    const type = clean(e?.label);
    const source = refs.get(e?.fromNode);
    const target = refs.get(e?.toNode);
    if (!type || !source || !target || source === target) continue;
    const k = `${source}\u0000${target}\u0000${type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ source, target, type });
  }
  return out;
}
