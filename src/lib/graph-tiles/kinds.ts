/**
 * Entity kinds as one-byte codes, shared by the tile builder (server) and the
 * tile renderer (browser). The order is part of the wire format: append new
 * kinds, never reorder, or existing tiles would recolour.
 *
 * Normalisation mirrors `normalizeEntityType` in `components/graph/constants`,
 * so a node looks the same in the tiled view as in the classic force view.
 */
export const GRAPH_KINDS = [
  'document',
  'folder',
  'space',
  'canvas',
  'sheet',
  'form',
  'pdf',
  'image',
  'paper',
  'author',
  'venue',
  'institution',
  'methodology',
  'track',
  'google_sheet',
  'google_doc',
] as const;

export type GraphKind = (typeof GRAPH_KINDS)[number];

const CODE = new Map<string, number>(GRAPH_KINDS.map((k, i) => [k, i]));

/** Code for a resource row, following the same precedence as the classic graph. */
export function kindCode(resource: { id: string; type?: string | null; entityType?: string | null }): number {
  if (resource.type === 'folder' || resource.id.startsWith('folder:')) return CODE.get('folder')!;
  const name = resource.entityType || resource.type || 'document';
  return CODE.get(name) ?? 0;
}

export function kindName(code: number): GraphKind {
  return GRAPH_KINDS[code] ?? 'document';
}

/** Edge kinds. */
export const EDGE_KIND = {
  /** Containment: folder -> child. */
  PARENT: 0,
  /** Wikilink: note -> note. */
  LINK: 1,
} as const;
