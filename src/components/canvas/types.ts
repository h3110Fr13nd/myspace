/**
 * Universal JSON Canvas v1.0 Types & Geometry Helpers
 * Location: src/components/canvas/types.ts
 */

import { isNodeInGroup } from './core/geometry';

export type CanvasPortSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEndStyle = 'none' | 'arrow';
export type CanvasColorCode = '1' | '2' | '3' | '4' | '5' | '6' | `#${string}`;

export interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group' | 'resource' | string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColorCode;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat' | 'fill';
  resourceId?: string;
  resourceType?: string;
  /**
   * The group this node belongs to, or `undefined` for the canvas root.
   *
   * Membership is a stored pointer, not a geometric query. Figma, tldraw,
   * draw.io and Canva all do it this way; deriving it from geometry is what
   * made a group drag every node it overlapped.
   *
   * `x`/`y` stay **absolute** whether or not this is set. Parent-relative
   * storage was implemented and then dropped: every consumer works in world
   * space, so a projection would hand them absolute numbers regardless, while
   * a reparent becomes a pure pointer write that cannot drift. See
   * `docs/canvas-grouping-design.md` §5 and open decision #2.
   */
  parentId?: string;
  /**
   * How tightly a **group** binds its children. Declared here so the schema is
   * in one place; consumed from Phase 1b/Phase 3, not yet branched on.
   *
   * - `spatial` (default, and what an absent value means): a visual container.
   *   The frame hugs its contained children, and dragging a child clear of the
   *   frame detaches it.
   * - `structural`: an organisational container. The frame is a fixed bound that
   *   a distant child cannot stretch, and dragging out never detaches — the
   *   child is marked "outside" instead, and only an explicit
   *   "Remove from group" unlinks it.
   *
   * Only meaningful on `type: 'group'`. "Outside" is derived from geometry
   * rather than stored, so this stays a single optional field.
   */
  membership?: 'spatial' | 'structural';
  isAllowed?: boolean;
  resolvedTitle?: string;
  resolvedSummary?: string;
  resolvedMetadata?: any;
}

export interface CanvasEdge {
  id: string;
  /**
   * Endpoint node ids. An empty string means the end is **detached**: the edge
   * still exists and is still drawn, but that end floats at a free world
   * position. `fromX`/`fromY` (or `toX`/`toY`) hold that position so the edge
   * does not collapse and so the user always has a handle to drag back onto a
   * node. Detached ends are not persisted.
   */
  fromNode: string;
  fromSide?: CanvasPortSide;
  fromEnd?: CanvasEndStyle;
  /**
   * Where along `fromSide` the edge attaches, 0..1 (default 0.5, the midpoint).
   * Lets an edge bind anywhere on a node's border; ignored by plain JSON Canvas
   * readers, which fall back to the side's midpoint.
   */
  fromAnchor?: number;
  /** Free world position of the `from` end while it is detached. */
  fromX?: number;
  fromY?: number;
  toNode: string;
  toSide?: CanvasPortSide;
  toEnd?: CanvasEndStyle;
  /** Where along `toSide` the edge attaches, 0..1 (see `fromAnchor`). */
  toAnchor?: number;
  /** Free world position of the `to` end while it is detached. */
  toX?: number;
  toY?: number;
  label?: string;
  color?: CanvasColorCode;
}

/**
 * True when this end of the edge is floating free of any node.
 *
 * This is a pure test of the edge record, so it answers "was this end
 * deliberately detached?" — an end still naming a node that has since been
 * deleted reads as attached here. Callers that have the node list should also
 * check membership, which is what the router and the endpoint layer do.
 */
export function isEdgeEndDetached(
  edge: Pick<CanvasEdge, 'fromNode' | 'toNode'>,
  end: 'from' | 'to'
): boolean {
  return end === 'from' ? !edge.fromNode : !edge.toNode;
}

/** Free world position of a detached end, or null when it is still attached. */
export function edgeEndFreePoint(
  edge: Pick<CanvasEdge, 'fromNode' | 'fromX' | 'fromY' | 'toNode' | 'toX' | 'toY'>,
  end: 'from' | 'to'
): { x: number; y: number } | null {
  if (!isEdgeEndDetached(edge, end)) return null;
  const x = end === 'from' ? edge.fromX : edge.toX;
  const y = end === 'from' ? edge.fromY : edge.toY;
  return x === undefined || y === undefined ? null : { x, y };
}

export interface JsonCanvasSpec {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  title?: string;
  resourceId?: string;
  metadata?: any;
  /**
   * Set to 1 by the canvas grouping migration, meaning every node's `parentId`
   * is stated rather than inferred.
   *
   * Load-bearing on load. Without it a document cannot be told apart from a
   * pre-migration one, and re-deriving membership from geometry would silently
   * undo the one thing a `structural` group exists to express — a member that
   * deliberately sits outside its own frame. See `core/grouping.normalise`.
   */
  groupingVersion?: number;
}

export const COLOR_MAP: Record<string, string> = {
  '1': '#f43f5e', // Red / Rose
  '2': '#f97316', // Orange
  '3': '#eab308', // Yellow
  '4': '#10b981', // Green / Emerald
  '5': '#00f2fe', // Cyan
  '6': '#a855f7', // Purple
};

export function resolveColor(c?: CanvasColorCode, fallback = 'rgba(255,255,255,0.15)'): string {
  if (!c) return fallback;
  if (COLOR_MAP[c]) return COLOR_MAP[c];
  if (c.startsWith('#') || c.startsWith('rgb')) return c;
  return fallback;
}

export interface AnchorPoint {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
}

/**
 * Computes side-aware connection anchor coordinates and exit normal vector
 */
export function getAnchor(node: CanvasNode, side?: CanvasPortSide, defaultSide: CanvasPortSide = 'bottom'): AnchorPoint {
  const s = side || defaultSide;
  switch (s) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y, dirX: 0, dirY: -1 };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height, dirX: 0, dirY: 1 };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2, dirX: -1, dirY: 0 };
    case 'right':
    default:
      return { x: node.x + node.width, y: node.y + node.height / 2, dirX: 1, dirY: 0 };
  }
}

/**
 * Checks whether a node sits inside a group.
 *
 * Re-exported from `core/geometry` so there is exactly one definition. Two
 * implementations used to coexist -- one testing the child's centre, one
 * (accidentally) testing only its top-left corner -- and different call sites
 * used different ones, so the item count shown to a user and the set of nodes
 * that moved with a group disagreed.
 */
export { isNodeInGroup };

/**
 * Computes bounding box enclosing an array of nodes with optional padding
 */
export function computeBoundingBox(
  nodes: CanvasNode[],
  padding = { x: 30, y: 50 }
): { x: number; y: number; width: number; height: number } {
  if (nodes.length === 0) return { x: 100, y: 100, width: 400, height: 300 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  });

  return {
    x: Math.round((minX - padding.x) / 20) * 20,
    y: Math.round((minY - padding.y) / 20) * 20,
    width: Math.round((maxX - minX + padding.x * 2) / 20) * 20,
    height: Math.round((maxY - minY + padding.y * 2) / 20) * 20,
  };
}


