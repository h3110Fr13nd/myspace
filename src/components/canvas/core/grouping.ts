/**
 * Canvas core — the group tree.
 *
 * One module owns the whole grouping vocabulary: what a node's parent is, where
 * it sits in the world, who its children are, whether a reparent is legal, and
 * what a group is allowed to look like. Nothing else in the codebase decides any
 * of these questions.
 *
 * ## Why this exists
 *
 * Grouping used to be re-derived from geometry on every read, by two functions
 * that disagreed: one tested the child's centre, the other (accidentally, by
 * passing a `Rect` where a `Point` was expected) tested only its top-left
 * corner. The result was that dragging a group moved every node that overlapped
 * it — including sibling groups — while the badge showed a different count
 * again. Membership is now a **stored parent pointer**, matching Figma, tldraw,
 * draw.io and Canva; geometry is only ever used to *offer* a reparent.
 *
 * ## Coordinates
 *
 * A node's `x`/`y` are **absolute world coordinates**, whether it is a root or
 * inside a group. Group membership is carried *only* by `parentId`; geometry is
 * never load-bearing for structure.
 *
 * Figma, tldraw, draw.io and Canva store children relative to their parent, and
 * that model was the original target here. It was dropped on purpose:
 *
 *  - Every consumer in this codebase — rendering, edge routing, ports, hit
 *    testing, marquee, spatial index, auto-layout — works in world space.
 *    Relative storage would force a projection into all of it, and the boundary
 *    adapter that does the projecting would hand them absolute numbers anyway.
 *    So the runtime ends up absolute under both models, and the only thing
 *    relative storage actually buys is convention fidelity.
 *  - Against that, it costs a rewrite of the `x`/`y` of every grouped node in
 *    every persisted document. Stated membership is a purely additive change
 *    (`parentId` appears, nothing else moves), so the migration diff stays small
 *    and reviewable instead of rewriting 130 coordinates across 13 files.
 *
 * Excalidraw is the counter-example that makes this a legitimate choice rather
 * than a shortcut: it has no relative coordinates at all.
 *
 * The projection helpers (`worldPosition`, `toWorldNodes`, `toLocal`) are kept
 * because they are the general, correct definition of the mapping, and they let
 * the index stay honest if a relative document ever turns up — hand-edited
 * JSON, or `CanvasJsonEditorModal`. With absolute storage they resolve to the
 * identity, which is exactly right.
 */

import { nodeRect, rectFullyContains } from './geometry';
import type { Rect } from './transform';
import type { CanvasEdge, CanvasNode } from '../types';

/** How far a group sits outside its children. */
export const GROUP_PADDING = 24;

/** Document-level marker: every node's `parentId` is stated, not inferred. */
export const GROUPING_VERSION = 1;

/**
 * Whether a document has already been converted, judged by its marker.
 *
 * The distinction is load-bearing rather than cosmetic. Re-deriving membership
 * from geometry is only correct for a document that has never stated it; doing
 * so to a converted document silently undoes a `structural` group, whose whole
 * purpose is to hold a member that sits outside its own frame.
 */
export function isMigrated(doc: { groupingVersion?: number } | null | undefined): boolean {
  return Number(doc?.groupingVersion ?? 0) >= GROUPING_VERSION;
}

/** Rendering guard only. No product ships a documented cap; this stops a cycle. */
export const MAX_GROUP_DEPTH = 8;

export type GroupId = string;

/** A node plus its resolved world position. */
export interface WorldNode extends CanvasNode {
  /** World-space x. */
  x: number;
  /** World-space y. */
  y: number;
}

export const isGroup = (node: Pick<CanvasNode, 'type'>): boolean => node.type === 'group';

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * The lookup every consumer needs, built once per document revision.
 *
 * Previously, resolving a group meant scanning every node for every call —
 * `O(nodes * groups)` on a group drag frame, and again per group per render for
 * the item-count badge.
 */
export class GroupIndex {
  readonly byId: Map<string, CanvasNode>;
  /** parentId -> child ids, in document order. */
  readonly childrenOf: Map<string, string[]>;
  /** Group id -> child ids that are still geometrically inside it. */
  private readonly groupChildren = new Map<string, string[]>();

  constructor(nodes: readonly CanvasNode[]) {
    this.byId = new Map(nodes.map((n) => [n.id, n]));
    this.childrenOf = new Map();
    for (const n of nodes) {
      const key = n.parentId ?? ROOT;
      const list = this.childrenOf.get(key);
      if (list) list.push(n.id);
      else this.childrenOf.set(key, [n.id]);
    }
    for (const n of nodes) {
      if (!isGroup(n)) continue;
      const direct = (this.childrenOf.get(n.id) ?? []).filter((id) => {
        const c = this.byId.get(id);
        return c !== undefined && this.contains(n, c);
      });
      this.groupChildren.set(n.id, direct);
    }
  }

  /**
   * World-space rect of a node.
   *
   * The stored rect *is* the world rect under the absolute model. This must not
   * add an ancestor offset: a zero offset is not a substitute for reading the
   * node's own position, and treating it as one silently reports every node as
   * sitting at the origin, which makes containment always pass.
   */
  worldRect(node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>): Rect {
    return { x: node.x, y: node.y, width: node.width, height: node.height };
  }

  /**
   * Is `child` geometrically inside `group`?
   *
   * Both rects are resolved to **world** space first. A group's own `x`/`y` are
   * relative to *its* parent while its children's are relative to *it*, so
   * comparing the stored numbers directly tests two different coordinate spaces
   * and silently finds nothing (or the wrong thing) as soon as nesting exists.
   */
  private contains(group: CanvasNode, child: CanvasNode): boolean {
    return rectFullyContains(this.worldRect(group), this.worldRect(child));
  }

  get(id: string): CanvasNode | undefined {
    return this.byId.get(id);
  }

  /** World position of a node. Absolute storage, so this is its own `x`/`y`. */
  worldOffsetOf(id: string): { x: number; y: number } {
    const node = this.byId.get(id);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  }

  /** Direct children, document order. Undefined for an unknown id. */
  childIds(parentId: string | null): readonly string[] {
    return this.childrenOf.get(parentId ?? ROOT) ?? [];
  }

  /**
   * Direct children that are fully inside `groupId`.
   *
   * Containment is still checked here even though `parentId` is authoritative.
   * That is deliberate: a child whose rect has been dragged outside its group
   * is no longer visually inside it, so the badge, the drag set and the layout
   * all agree. The pointer is unchanged, so the state is recoverable.
   */
  containedIds(groupId: string): readonly string[] {
    return this.groupChildren.get(groupId) ?? [];
  }

  /** Direct children of a group, as nodes. */
  members(groupId: string): CanvasNode[] {
    return this.containedIds(groupId)
      .map((id) => this.byId.get(id))
      .filter((n): n is CanvasNode => n !== undefined);
  }

  /** All descendants, deepest first. Empty if `id` is not in a cycle-free tree. */
  descendantIds(id: string): string[] {
    const out: string[] = [];
    const stack = [...this.childIds(id)];
    const seen = new Set<string>([id]);
    while (stack.length) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      for (const c of this.childIds(next)) stack.push(c);
    }
    return out;
  }

  /** Ancestors from the immediate parent upwards. */
  ancestorIds(id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let cur = this.byId.get(id)?.parentId ?? null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = this.byId.get(cur)?.parentId ?? null;
    }
    return out;
  }

  depth(id: string): number {
    return this.ancestorIds(id).length;
  }

  /** True when `maybeAncestor` is `id` or contains it, directly or not. */
  isDescendantOf(maybeAncestor: string, id: string): boolean {
    return this.ancestorIds(id).includes(maybeAncestor);
  }

  /** Would setting `parentId` on `ids` create a cycle? */
  wouldCreateCycle(ids: readonly string[], parentId: string | null): boolean {
    if (parentId === null) return false;
    for (const id of ids) {
      if (id === parentId) return true;
      if (this.isDescendantOf(id, parentId)) return true;
    }
    return false;
  }
}

/** Sentinel key for "no parent" in the children index. */
const ROOT = '\u0000root';

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

/**
 * World offset of every node.
 *
 * Identity under the absolute-coordinate model: a node's `x`/`y` are already
 * world coordinates whether it is a root or nested, so every offset is zero.
 *
 * This deliberately does *not* walk the parent chain. That walk belonged to the
 * parent-relative model that was tried and dropped, and leaving it in place is
 * not a harmless leftover: summing a parent's offset into a child that is
 * already absolute double-counts the ancestor, which silently breaks every
 * containment test downstream (groups report zero members and dissolve).
 *
 * The function is kept because callers should not have to know which model is in
 * force, and because it is the single place that would change if a document ever
 * arrived using parent-relative coordinates.
 */
export function worldOffsets(nodes: readonly CanvasNode[]): Map<string, { x: number; y: number }> {
  return new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
}

/** One node's world position, or null if there is no such node. */
export function worldPosition(nodes: readonly CanvasNode[], id: string): { x: number; y: number } | null {
  const node = nodes.find((n) => n.id === id);
  return node ? { x: node.x, y: node.y } : null;
}

/**
 * The world-space projection that geometry, routing, hit-testing and layout
 * consume. Under the absolute model the document already *is* world space, so
 * this is a pass-through kept as the single documented conversion point.
 */
export function toWorldNodes(nodes: readonly CanvasNode[]): WorldNode[] {
  return nodes.map((n) => n as WorldNode);
}

/** Absolute coordinates need no conversion; this is the inverse of {@link toWorldNodes}. */
export function toLocal(
  nodes: readonly CanvasNode[],
  nodeId: string,
  worldX: number,
  worldY: number
): { x: number; y: number } {
  void nodes;
  void nodeId;
  return { x: worldX, y: worldY };
}

/**
 * Union of child rects plus padding.
 *
 * Takes rects rather than nodes because that is all it reads, which keeps it
 * usable for both nodes and already-computed frames.
 */
export function groupBoundsIn(
  children: readonly Rect[],
  padding = GROUP_PADDING
): Rect | null {
  if (children.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of children) {
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + c.width);
    y1 = Math.max(y1, c.y + c.height);
  }
  return {
    x: x0 - padding,
    y: y0 - padding,
    width: x1 - x0 + padding * 2,
    height: y1 - y0 + padding * 2,
  };
}

/** Union of world rects, used for "fit to bounds". */
export function worldBounds(nodes: readonly WorldNode[]): Rect | null {
  if (nodes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.width);
    y1 = Math.max(y1, n.y + n.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

export interface ReparentResult {
  nodes: CanvasNode[];
  changed: boolean;
  /** Groups that lost or gained a child and must be re-fitted. */
  touchedGroups: string[];
  /** Reason the request was refused, if it was. */
  rejected?: 'cycle' | 'unknown-parent';
}

/**
 * Move `ids` under `parentId`.
 *
 * Coordinates are absolute, so this is a single pointer write per node: nothing
 * about a node's position is recomputed, and it therefore cannot drift. That is
 * the main practical argument for the absolute model — a reparent has no
 * arithmetic in it to get wrong.
 *
 * Refuses anything that would create a cycle, so the invariant is enforced at
 * the only place membership changes rather than being re-checked at each read.
 */
export function reparent(
  nodes: readonly CanvasNode[],
  ids: readonly string[],
  parentId: string | null
): ReparentResult {
  const index = new GroupIndex(nodes);
  if (parentId !== null && !index.get(parentId)) {
    return { nodes: [...nodes], changed: false, touchedGroups: [], rejected: 'unknown-parent' };
  }
  if (index.wouldCreateCycle(ids, parentId)) {
    return { nodes: [...nodes], changed: false, touchedGroups: [], rejected: 'cycle' };
  }

  const idSet = new Set(ids);
  const next = parentId ?? undefined;
  const touched = new Set<string>();
  if (parentId) touched.add(parentId);
  for (const id of ids) {
    const prev = index.get(id)?.parentId;
    if (prev) touched.add(prev);
  }

  const out = nodes.map((n) => {
    if (!idSet.has(n.id)) return n;
    if (n.parentId === next) return n;
    return { ...n, parentId: next };
  });

  return { nodes: out, changed: true, touchedGroups: [...touched] };
}

/** Put nodes directly on the canvas. */
export function ungroup(nodes: readonly CanvasNode[], groupId: string): ReparentResult {
  const index = new GroupIndex(nodes);
  const childIds = index.childIds(groupId).filter((id) => index.get(id)?.type !== 'group');
  const grandParentId = index.get(groupId)?.parentId ?? null;
  const result = reparent(nodes, childIds, grandParentId);

  // The group itself goes; nested groups inside it are reparented, not deleted,
  // so their own subtrees survive. Matches tldraw's documented "ungrouping is
  // not recursive" behaviour for the children it does not touch.
  const kept = result.nodes.filter((n) => n.id !== groupId);
  return { ...result, nodes: kept, changed: true };
}

/** Group a set of nodes around a new group, preserving world positions. */
export function groupNodes(
  nodes: readonly CanvasNode[],
  ids: readonly string[],
  options: { id: string; label?: string; color?: CanvasNode['color'] }
): { nodes: CanvasNode[]; group: CanvasNode } {
  const idSet = new Set(ids);
  const members = nodes.filter((n) => idSet.has(n.id));
  if (members.length < 2) {
    throw new Error(`groupNodes needs at least two nodes, got ${members.length}`);
  }

  const x0 = Math.min(...members.map((n) => n.x));
  const y0 = Math.min(...members.map((n) => n.y));
  const x1 = Math.max(...members.map((n) => n.x + n.width));
  const y1 = Math.max(...members.map((n) => n.y + n.height));

  const group: CanvasNode = {
    id: options.id,
    type: 'group',
    x: x0 - GROUP_PADDING,
    y: y0 - GROUP_PADDING,
    width: x1 - x0 + GROUP_PADDING * 2,
    height: y1 - y0 + GROUP_PADDING * 2,
    label: options.label ?? 'Group',
    ...(options.color ? { color: options.color } : {}),
  };

  // Members keep their absolute positions and only gain a parent pointer.
  const memberIds = new Set(ids);
  const out = nodes.map((n) => {
    if (!memberIds.has(n.id)) return n;
    return { ...n, parentId: group.id };
  });
  // Groups render behind their members, so the group leads the list.
  return { nodes: [group, ...out], group };
}

/**
 * The invariants, applied to a whole document.
 *
 * Every write goes through this, so membership cannot reach a state the rest of
 * the app has to defend against. It is deliberately total: a malformed input
 * produces a repaired document rather than a thrown error.
 */
/**
 * Re-derive every group's frame from its members, innermost first.
 *
 * This is the one place group bounds are computed. With absolute coordinates it
 * is deliberately boring: a group's frame is the union of its children's rects
 * plus padding, and nothing has to be converted between coordinate spaces.
 *
 * Innermost-first is still required, because a parent must union its child's
 * *fitted* rect. Fitting a child group changes its extent, so a parent that
 * unioned the incoming extents would build a frame one pass stale and then
 * move again on the next — which is exactly the non-convergent behaviour an
 * earlier parent-relative implementation had. Doing it deepest-first makes a
 * single pass the fixed point.
 */
export function refitGroups(
  nodes: readonly CanvasNode[],
  opts: { padding?: number; skip?: ReadonlySet<string> } = {}
): CanvasNode[] {
  const { padding = GROUP_PADDING, skip } = opts;
  if (nodes.length === 0) return [];

  const index = new GroupIndex(nodes);
  const frames = new Map<string, Rect>();
  for (const node of nodes) frames.set(node.id, nodeRect(node));

  /**
   * Deepest first, and a `structural` group is never re-fitted.
   *
   * Skipping structural groups is what makes the mode mean something: a
   * structural group's frame is a bound the author chose, so no automatic pass
   * may resize it. Without this, `enforceInvariants` would quietly re-fit a
   * structural group on every commit and the setting would have no effect.
   */
  const deepestFirst = nodes
    .filter((g) => isGroup(g) && !isStructural(g) && !skip?.has(g.id))
    .sort((a, b) => index.depth(b.id) - index.depth(a.id));

  for (const g of deepestFirst) {
    // Membership is decided by `parentId`, but a child dragged outside its
    // group is still parented to it. Such a child must not stretch the frame,
    // so containment is still checked — using the frame as it currently stands.
    const members = index.childIds(g.id).filter((id) => {
      const child = frames.get(id);
      return child ? rectFullyContains(frames.get(g.id)!, child) : false;
    });
    if (members.length === 0) continue;
    const bounds = groupBoundsIn(members.map((id) => frames.get(id)!), padding);
    if (bounds) frames.set(g.id, bounds);
  }

  let changed = false;
  const out = nodes.map((node) => {
    const next = frames.get(node.id)!;
    if (next.x === node.x && next.y === node.y && next.width === node.width && next.height === node.height) {
      return node;
    }
    changed = true;
    return { ...node, x: next.x, y: next.y, width: next.width, height: next.height };
  });

  return changed ? out : [...nodes];
}

export function enforceInvariants(
  nodes: readonly CanvasNode[],
  opts: { padding?: number; manualGroupBounds?: ReadonlySet<string> } = {}
): CanvasNode[] {
  const { padding = GROUP_PADDING, manualGroupBounds } = opts;
  let current = nodes.map((n) => ({ ...n }));

  /**
   * Bounded rather than `while (true)`: each pass either settles or removes at
   * least one group, so a document cannot spin. A dissolved group's child may
   * be handed to a group that dissolves on the next pass, and so on down the
   * chain, which is why this needs a few passes rather than one.
   */
  for (let pass = 0; pass <= MAX_GROUP_DEPTH + 1; pass++) {
    // 1. A parent must exist, be a group, and not be a descendant of this node.
    const index = new GroupIndex(current);
    current = current.map((n) => {
      if (!n.parentId) return n;
      const parent = index.get(n.parentId);
      if (!parent || !isGroup(parent)) return { ...n, parentId: undefined };
      if (n.parentId === n.id || index.isDescendantOf(n.id, n.parentId)) {
        return { ...n, parentId: undefined };
      }
      return n;
    });

    // 2. Collapse degenerate groups, then re-fit the survivors to their members.
    const index2 = new GroupIndex(current);
    const dissolve = new Map<string, string | null>();
    const kept: CanvasNode[] = [];

    for (const n of current) {
      if (!isGroup(n)) {
        kept.push(n);
        continue;
      }
      /**
       * Counted from the stated tree, not from geometry.
       *
       * `members()` filters by containment, which is right for "what does this
       * frame surround" and wrong for "does this group exist". Using it here
       * dissolved any structural group that had a member outside its frame —
       * precisely the arrangement the mode exists to allow — on the next commit.
       */
      const members = index2.childIds(n.id).filter((id) => index2.get(id));
      // tldraw's documented thresholds: delete at zero members, dissolve at one.
      if (members.length === 0) continue;
      if (members.length === 1) {
        dissolve.set(members[0], n.parentId ?? null);
        continue;
      }
      if (manualGroupBounds?.has(n.id)) {
        kept.push(n);
        continue;
      }
      // Bounds are re-derived by `refitGroups` below, in world space. Doing it
      // here with `groupBoundsIn` would compare a group's own coordinates
      // (relative to *its* parent) against its children's (relative to *it*) —
      // two different spaces — and move the subtree.
      kept.push(n);
    }

    if (dissolve.size === 0) return refitGroups(kept, { padding, skip: manualGroupBounds });

    current = kept.map((n) => {
      const next = dissolve.get(n.id);
      // A child handed to a group that also dissolved now has a dangling
      // parent; the next pass resolves it, eventually to the root.
      return next === undefined ? n : { ...n, parentId: next ?? undefined };
    });
  }

  return current;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export interface NormaliseReport {
  nodes: CanvasNode[];
  /** Nodes that gained a parent. */
  adopted: number;
  /** Nodes that became roots because containment was ambiguous. */
  promotedToRoot: number;
  /** Groups removed for having no members. */
  groupsRemoved: number;
  /** Groups whose size was re-derived. */
  groupsRefitted: number;
  /** True when the input was already normalised. */
  alreadyCurrent: boolean;
}

/**
 * Derive `parentId` from geometry. Coordinates are left alone.
 *
 * This is the whole migration: membership becomes a stored fact, and because
 * `x`/`y` are absolute the conversion is purely additive. No content moves, so
 * the diff on a persisted document is a `parentId` appearing on the nodes that
 * belong to a group.
 *
 * Runs once per document, at load and on import. After it, the file is in the
 * new model and re-running it is a no-op, which is what makes it safe to call
 * unconditionally.
 *
 * Ambiguity is resolved by taking the **innermost** containing group, so nesting
 * survives. A node inside two overlapping groups joins the smaller one: the
 * other is left without it rather than leaving the node in two groups, which is
 * the state nothing downstream could resolve.
 */
export function normalise(
  nodes: readonly CanvasNode[],
  opts: { padding?: number; alreadyHasParentId?: boolean } = {}
): NormaliseReport {
  const { padding = GROUP_PADDING, alreadyHasParentId = false } = opts;
  const input = nodes.map((n) => ({ ...n }));
  const groups = input.filter(isGroup);

  /**
   * The innermost group fully containing `world`, or null.
   *
   * Innermost is what makes nesting survive, and it also resolves the ambiguous
   * case of two overlapping groups deterministically: the node joins the smaller
   * one and the larger is simply left without it. Membership has to be a single
   * parent, so there is no alternative to picking a winner.
   */
  const innermostContainer = (world: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height' | 'id'>): CanvasNode | null => {
    let best: CanvasNode | null = null;
    let bestArea = Infinity;
    for (const g of groups) {
      if (g.id === world.id) continue;
      if (!rectFullyContains({ x: g.x, y: g.y, width: g.width, height: g.height }, nodeRect(world))) {
        continue;
      }
      const area = g.width * g.height;
      if (area < bestArea) {
        best = g;
        bestArea = area;
      }
    }
    return best;
  };

  /**
   * Stamping is what makes this safe to run unconditionally. A document that
   * already states its membership is trusted and only re-fitted, because
   * re-deriving would let geometry overrule a decision the user already made:
   * a node deliberately dragged out of a group would be pulled straight back in.
   */
  let adopted = 0;
  const out = alreadyHasParentId
    ? input
    : input.map((n) => {
        const container = innermostContainer(n);
        const parentId = container?.id ?? null;
        if (parentId) adopted++;
        return parentId ? { ...n, parentId } : { ...n, parentId: undefined };
      });

  const refitted = refitGroups(out, { padding });
  const groupsRefitted = refitted.filter((n, i) => {
    const b = out[i];
    return n.x !== b.x || n.y !== b.y || n.width !== b.width || n.height !== b.height;
  }).length;

  const enforced = enforceInvariants(refitted, { padding });
  const groupsRemoved = refitted.filter(isGroup).length - enforced.filter(isGroup).length;

  const alreadyCurrent =
    alreadyHasParentId &&
    enforced.length === input.length &&
    enforced.every((n, i) => {
      const b = input[i];
      return (
        n.id === b.id &&
        n.x === b.x &&
        n.y === b.y &&
        n.width === b.width &&
        n.height === b.height &&
        n.parentId === b.parentId
      );
    });

  return {
    nodes: enforced,
    adopted,
    promotedToRoot: enforced.filter((n) => !n.parentId && n.type !== 'group').length,
    groupsRemoved,
    groupsRefitted,
    alreadyCurrent,
  };
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * An edge endpoint is only meaningful relative to a node that exists, so a
 * node leaving the document takes its edges with it — the same rule the editor
 * applied by hand.
 */
export function edgesForNodes(
  edges: readonly CanvasEdge[],
  removedIds: ReadonlySet<string>
): CanvasEdge[] {
  return edges.filter((e) => !removedIds.has(e.fromNode) && !removedIds.has(e.toNode));
}

/** Re-point an edge endpoint at a node, keeping its free position coherent. */
export function retargetEdgeEnd(
  edge: CanvasEdge,
  end: 'from' | 'to',
  nodeId: string
): CanvasEdge {
  return end === 'from'
    ? { ...edge, fromNode: nodeId, fromX: undefined, fromY: undefined }
    : { ...edge, toNode: nodeId, toX: undefined, toY: undefined };
}

// ---------------------------------------------------------------------------
// Child membership: spatial vs structural
// ---------------------------------------------------------------------------

/**
 * How a group binds its children. Absent means `spatial`.
 *
 * Kept as a function rather than a bare `?? 'spatial'` at each call site so
 * there is exactly one definition of the default, and so the eventual
 * persisted default cannot drift between call sites.
 */
export type ChildMembership = 'spatial' | 'structural';

export function membershipOf(node: Pick<CanvasNode, 'membership'>): ChildMembership {
  return node.membership ?? 'spatial';
}

/** Does this group keep its children when they are dragged clear of its frame? */
export function isStructural(node: Pick<CanvasNode, 'type' | 'membership'>): boolean {
  return node.type === 'group' && membershipOf(node) === 'structural';
}

/**
 * Children of `groupId` whose rect has escaped the group's frame.
 *
 * This is derived rather than stored: a child is "outside" exactly when its
 * parent pointer is set and containment fails. Nothing can write the flag, so
 * it cannot disagree with the geometry — which is the failure mode the old
 * badge-vs-drag split had.
 *
 * Only ever non-empty for a `structural` group: `spatial` groups detach these
 * on commit (see {@link enforceMembershipPolicy}), so an outside child of a
 * spatial group is a transient mid-drag state, not a resting one.
 */
export function childrenOutsideParent(index: GroupIndex, groupId: string): string[] {
  const group = index.get(groupId);
  if (!group) return [];
  const frame = index.worldRect(group);
  return index.childIds(groupId).filter((id) => {
    const child = index.get(id);
    return child ? !rectFullyContains(frame, index.worldRect(child)) : false;
  });
}

export interface MembershipPolicyResult {
  nodes: CanvasNode[];
  /** Ids detached because they left a `spatial` group. */
  detached: string[];
}

/**
 * Apply the per-group child policy to a document.
 *
 * `spatial` groups are visual containers, so a child dragged clear of the frame
 * is released — a frame should not claim to contain what is visibly outside it.
 * `structural` groups are organisational, so their children are never released
 * implicitly; only an explicit unlink does that.
 *
 * Runs on commit rather than during the drag, so a drag is one undo step and the
 * detach cannot fire on a transient pointer position.
 *
 * Children of a dissolved group are handed to the grandparent, mirroring
 * `enforceInvariants`, so a detach never produces a dangling pointer.
 */
export function enforceMembershipPolicy(
  nodes: readonly CanvasNode[],
  opts: { padding?: number } = {}
): MembershipPolicyResult {
  const { padding = GROUP_PADDING } = opts;
  const index = new GroupIndex(nodes);

  /** parentId overrides for nodes that must be released or promoted. */
  const reparent = new Map<string, string | undefined>();
  for (const group of nodes) {
    if (!isGroup(group) || isStructural(group)) continue;
    for (const id of childrenOutsideParent(index, group.id)) {
      const child = index.get(id);
      if (!child) continue;
      // Grandparent may be gone by the time invariants run, so hand the child
      // to the nearest surviving ancestor rather than a pointer that will dangle.
      const grandparent = group.parentId && index.get(group.parentId)?.type === 'group'
        ? group.parentId
        : undefined;
      reparent.set(id, grandparent);
    }
  }

  if (reparent.size === 0) return { nodes: [...nodes], detached: [] };

  const detached = [...reparent.keys()];
  const moved = nodes.map((n) => {
    if (!reparent.has(n.id)) return n;
    return { ...n, parentId: reparent.get(n.id) };
  });
  return { nodes: enforceInvariants(refitGroups(moved, { padding }), { padding }), detached };
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

export interface OutlineNode {
  id: string;
  node: CanvasNode;
  depth: number;
  /** Direct children, in document order. */
  children: OutlineNode[];
  /** Child count actually inside the parent's frame (groups only). */
  containedCount: number;
  /** Ids of this node's children that have escaped the parent's frame. */
  outsideChildIds: string[];
}

/**
 * The `parentId` tree, as data.
 *
 * Pure and DOM-free so it can be unit tested directly and reused by any surface
 * that wants to show structure — the sidebar outline today, a command palette
 * or an export later. Deliberately not a React concern.
 *
 * Defensive in two ways, because a malformed document must still render: cycles
 * are cut (a node already on the current path is not re-entered), and depth is
 * capped at {@link MAX_GROUP_DEPTH} for the same reason.
 */
export function buildOutline(
  nodes: readonly CanvasNode[],
  index: GroupIndex = new GroupIndex(nodes)
): OutlineNode[] {
  const build = (parentId: string | null, depth: number, path: ReadonlySet<string>): OutlineNode[] => {
    if (depth > MAX_GROUP_DEPTH) return [];
    return index.childIds(parentId).flatMap((id) => {
      const node = index.get(id);
      if (!node || path.has(id)) return [];
      const nextPath = new Set(path);
      nextPath.add(id);
      const children = build(id, depth + 1, nextPath);
      const group = isGroup(node);
      return [{
        id,
        node,
        depth,
        children,
        containedCount: group ? index.containedIds(id).length : children.length,
        outsideChildIds: group ? childrenOutsideParent(index, id) : [],
      }];
    });
  };
  return build(null, 0, new Set());
}

/** Flatten an outline depth-first, honouring a set of collapsed ids. */
export function flattenOutline(
  roots: readonly OutlineNode[],
  collapsed: ReadonlySet<string> = new Set()
): OutlineNode[] {
  const out: OutlineNode[] = [];
  const walk = (list: readonly OutlineNode[]) => {
    for (const entry of list) {
      out.push(entry);
      if (!collapsed.has(entry.id)) walk(entry.children);
    }
  };
  walk(roots);
  return out;
}

// ---------------------------------------------------------------------------
// Drop targets
// ---------------------------------------------------------------------------

export interface DropTarget {
  groupId: string;
  /** How the candidate was found, for the hint copy. */
  kind: 'innermost' | 'only';
}

/**
 * Which group would receive a drop of `draggedIds` released at `point`, if any.
 *
 * Shared by canvas drag-to-group and outline drag-to-reparent so both agree on
 * the answer and both are covered by one set of tests.
 *
 * The test is on the **release point**, not on where the dragged nodes happen to
 * be right now. They are, by definition, somewhere else — that is the entire
 * point of the drag — so requiring their current box to be contained would
 * never match and the affordance would never appear.
 *
 * Overlapping candidates resolve to the **innermost** (then smallest), the same
 * rule the migration used to infer membership, so dropping onto nested groups
 * behaves identically to how those groups were originally populated.
 */
export function resolveDropTarget(
  nodes: readonly CanvasNode[],
  draggedIds: ReadonlySet<string>,
  point: { x: number; y: number },
  index: GroupIndex = new GroupIndex(nodes)
): DropTarget | null {
  if (draggedIds.size === 0) return null;
  const probe: Rect = { x: point.x, y: point.y, width: 0, height: 0 };

  const candidates = nodes.filter((g) => {
    if (!isGroup(g) || draggedIds.has(g.id)) return false;
    // A group is never a valid target for its own subtree: that is a cycle.
    for (const id of draggedIds) {
      if (index.isDescendantOf(g.id, id)) return false;
    }
    return rectFullyContains(index.worldRect(g), probe);
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { groupId: candidates[0].id, kind: 'only' };

  const best = candidates.reduce((a, b) => {
    const byDepth = index.depth(b.id) - index.depth(a.id);
    if (byDepth !== 0) return byDepth > 0 ? b : a;
    return b.width * b.height < a.width * a.height ? b : a;
  });
  return { groupId: best.id, kind: 'innermost' };
}

// ---------------------------------------------------------------------------
// Selection units
// ---------------------------------------------------------------------------

/**
 * The outermost group (or the node itself) that `id` belongs to.
 *
 * Marquee and group-drag act on whole top-level units rather than whatever
 * rects the rubber band happened to touch, so dragging a group never grabs a
 * fragment of it. Excalidraw's `getRootElements` `[SRC]`.
 */
export function topLevelUnitOf(index: GroupIndex, id: string): string {
  let current = id;
  for (let guard = 0; guard <= MAX_GROUP_DEPTH; guard++) {
    const parentId = index.get(current)?.parentId;
    if (!parentId) return current;
    current = parentId;
  }
  return current;
}

/** The set of top-level units covering `ids`, for a marquee or a group drag. */
export function topLevelUnits(index: GroupIndex, ids: Iterable<string>): Set<string> {
  return new Set([...ids].map((id) => topLevelUnitOf(index, id)));
}

/**
 * A group and everything under it, as a document.
 *
 * The programmatic half of "grouping is for structure": a subtree can be lifted
 * out of a board whole, rather than reassembled by hand. Ids are preserved, so
 * the result is a drop-in fragment — the `edges` argument lets a caller keep
 * only the connections that live entirely inside the subtree.
 */
export function subtreeOf(
  nodes: readonly CanvasNode[],
  groupId: string,
  edges: readonly CanvasEdge[] = []
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const index = new GroupIndex(nodes);
  if (!index.get(groupId)) return { nodes: [], edges: [] };
  const ids = new Set([groupId, ...index.descendantIds(groupId)]);
  return {
    nodes: nodes.filter((n) => ids.has(n.id)),
    edges: edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)),
  };
}
