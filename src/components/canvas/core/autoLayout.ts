/**
 * Canvas core — automatic layered layout.
 *
 * Arranges nodes into columns by longest-path depth, so a node always sits to
 * the right of everything that points at it. Pure and side-effect free, which is
 * the point: the previous implementation lived inside `useCanvasEditor` as a
 * closure, so the only way to test it was to copy it, and the copy drifted.
 *
 * Four properties this module is responsible for, each of which was a bug:
 *
 *  1. **Cycles are broken before layering.** Relaxation has no fixed point on a
 *     cyclic graph: every pass raises a level and the loop only stops when the
 *     pass cap runs out. On a five-edge board with one feedback edge that
 *     produced levels of 18, a 7560px-wide board, and edges drawn backwards.
 *     A DFS identifies back edges and drops exactly those.
 *  2. **Levels come from a topological order,** so layering is one pass and is
 *     exact rather than approximate.
 *  3. **Groups travel with their contents.** Groups are containers, not
 *     layout units: members are laid out and the group is then re-fitted around
 *     them. Skipping groups left them stranded at their old coordinates with
 *     every child teleported out from under them, which broke containment and
 *     with it "Fit Group to Contents" and group dragging.
 *  4. **Bands are packed from the real node sizes.** A fixed 280px row pitch
 *     overlapped 640px-tall resource nodes, and a fixed column pitch overlapped
 *     820px-wide ones.
 *
 * Deterministic by construction: levels ascend, and within a level nodes keep
 * their input order, so the same input always yields the same output.
 */

import type { Rect } from './transform';
import type { CanvasEdge, CanvasNode } from '../types';
import { GroupIndex, isGroup, isStructural, MAX_GROUP_DEPTH } from './grouping';

export interface AutoLayoutOptions {
  /** Top-left of the laid-out content. */
  originX?: number;
  originY?: number;
  /** Minimum space between two columns. */
  columnGap?: number;
  /** Minimum space between two rows. */
  rowGap?: number;
  /** Space between a group's edge and its contents. */
  groupPadding?: number;
}

export interface AutoLayoutResult {
  /** Every node, repositioned. Groups included. */
  nodes: CanvasNode[];
  /** Column index per node id. Groups are absent: they are not layout units. */
  levels: Map<string, number>;
  /** Edges dropped because they closed a cycle. */
  cycleBrokenEdgeIds: string[];
  /** Bounding box of everything placed. */
  bounds: Rect;
}

interface UnitEdge {
  edgeId: string;
  from: string;
  to: string;
}

const EMPTY: Rect = { x: 0, y: 0, width: 0, height: 0 };

function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function autoLayout(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: AutoLayoutOptions = {}
): AutoLayoutResult {
  const {
    originX = 100,
    originY = 100,
    columnGap = 80,
    rowGap = 60,
    groupPadding = 24,
  } = options;

  if (nodes.length === 0) {
    return { nodes: [], levels: new Map(), cycleBrokenEdgeIds: [], bounds: { ...EMPTY } };
  }

  // --- Group membership, from the tree ---------------------------------------
  // `parentId`, not containment. A geometric owner map meant a node could be
  // laid out inside one group while the badge counted it in another, and a
  // structural child sitting outside its frame would be laid out as a root.

  const index = new GroupIndex(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  /**
   * Sizes, as packing needs them. A group is a box of its own size, which is
   * why this has to be filled bottom-up: a parent cannot reserve room for a
   * child group until that group knows how big its own contents make it.
   */
  const sizes = new Map<string, { width: number; height: number }>(
    nodes.map((n) => [n.id, { width: n.width, height: n.height }])
  );
  const sizeOf = (id: string) => sizes.get(id) ?? { width: 0, height: 0 };

  /** Position of each id *relative to its own parent*, or to the board for roots. */
  const local = new Map<string, { x: number; y: number }>();
  /** Child positions of each group, relative to that group's own top-left. */
  const childrenLayout = new Map<string, Map<string, { x: number; y: number }>>();

  const cycleBrokenEdgeIds: string[] = [];
  const levels = new Map<string, number>();

  /**
   * Assign every id a position within one scope, packed into columns from
   * `origin`.
   *
   * An edge is a constraint only when **both** endpoints are in the same scope.
   * That single rule is what makes the layout container-scoped: an edge from a
   * node inside a group to a node outside it says nothing about ordering inside
   * the group, and previously it dragged the whole board into one flat
   * arrangement so a group's contents were placed by edges that had nothing to
   * do with them.
   */
  const packScope = (requested: readonly string[], origin: { x: number; y: number }) => {
    /**
     * A group with no children is not a layout unit and keeps its own geometry.
     *
     * It has nothing to arrange, so there is no extent to derive and no reason
     * to move it: inventing a position for an empty box would drag invisible
     * furniture across the board. Uniform at every scope, so the rule cannot
     * differ between the top level and inside another group.
     */
    const scope = requested.filter((id) => {
      const node = byId.get(id);
      if (!node || !isGroup(node)) return true;
      return index.childIds(id).length > 0;
    });
    if (scope.length === 0) return;
    const inScope = new Set(scope);

    // --- Break cycles within this scope ---
    const outEdges = new Map<string, UnitEdge[]>(scope.map((id) => [id, []]));
    for (const e of edges) {
      if (!inScope.has(e.fromNode) || !inScope.has(e.toNode)) continue;
      // A group is a box to place, not a column to constrain.
      if (isGroup(byId.get(e.fromNode)!) || isGroup(byId.get(e.toNode)!)) continue;
      outEdges.get(e.fromNode)!.push({ edgeId: e.id, from: e.fromNode, to: e.toNode });
    }

    // Iterative DFS marking back edges: an edge into a node currently on the
    // stack would close a cycle. Dropping exactly those leaves a DAG that keeps
    // as much of the author's ordering as possible, and is deterministic.
    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;
    const colour = new Map(scope.map((id) => [id, WHITE]));
    for (const start of scope) {
      if (colour.get(start) !== WHITE) continue;
      colour.set(start, GREY);
      const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        const list = outEdges.get(top.id)!;
        if (top.i < list.length) {
          const edge = list[top.i++];
          const state = colour.get(edge.to) ?? WHITE;
          if (state === GREY) {
            cycleBrokenEdgeIds.push(edge.edgeId);
          } else if (state === WHITE) {
            colour.set(edge.to, GREY);
            stack.push({ id: edge.to, i: 0 });
          }
        } else {
          colour.set(top.id, BLACK);
          stack.pop();
        }
      }
    }

    const broken = new Set(cycleBrokenEdgeIds);
    const dag = new Map<string, UnitEdge[]>();
    for (const [id, list] of outEdges) {
      dag.set(
        id,
        list.filter((e) => !broken.has(e.edgeId) && e.to !== id)
      );
    }

    // --- Topological order, then exact levels ---
    const indegree = new Map(scope.map((id) => [id, 0]));
    for (const list of dag.values()) {
      for (const e of list) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    }
    const queue = scope.filter((id) => (indegree.get(id) ?? 0) === 0);
    const topo: string[] = [];
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      topo.push(id);
      for (const e of dag.get(id) ?? []) {
        const next = (indegree.get(e.to) ?? 0) - 1;
        indegree.set(e.to, next);
        if (next === 0) queue.push(e.to);
      }
    }
    for (const id of scope) if (!topo.includes(id)) topo.push(id);

    for (const id of scope) levels.set(id, 0);
    for (const id of topo) {
      const from = levels.get(id) ?? 0;
      for (const e of dag.get(id) ?? []) {
        levels.set(e.to, Math.max(levels.get(e.to) ?? 0, from + 1));
      }
    }

    // --- Pack columns and rows from real sizes ---
    const byLevel = new Map<number, string[]>();
    for (const id of scope) {
      const level = levels.get(id) ?? 0;
      const list = byLevel.get(level);
      if (list) list.push(id);
      else byLevel.set(level, [id]);
    }

    let columnX = origin.x;
    for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
      let y = origin.y;
      let widest = 0;
      for (const id of byLevel.get(level)!) {
        const size = sizeOf(id);
        local.set(id, { x: columnX, y });
        y += size.height + rowGap;
        widest = Math.max(widest, size.width);
      }
      columnX += widest + columnGap;
    }
  };

  /**
   * Lay out one group's children inside it, and settle the group's own size.
   *
   * Bottom-up by construction: a nested group is resolved before its parent
   * reads its size, so a parent always reserves the real extent of its child.
   * Depth is capped as a guard against a cyclic `parentId` in a hand-edited
   * document.
   */
  const layoutGroup = (groupId: string, depth: number): void => {
    if (depth > MAX_GROUP_DEPTH) return;
    const group = byId.get(groupId);
    if (!group || !isGroup(group)) return;
    const childIds = index.childIds(groupId).filter((id) => byId.has(id));
    // A group with nothing in it keeps its own geometry: there is nothing to
    // lay out, and resizing it would be inventing content.
    if (childIds.length === 0) return;

    for (const childId of childIds) {
      if (isGroup(byId.get(childId)!)) layoutGroup(childId, depth + 1);
    }

    // Children are packed relative to (0, 0) and translated onto the group once
    // the group itself has been placed by its own scope.
    packScope(childIds, { x: 0, y: 0 });
    const childMap = new Map(childIds.map((id) => [id, local.get(id) ?? { x: 0, y: 0 }]));
    childrenLayout.set(groupId, childMap);

    // A structural group keeps the bound the author chose; only a spatial one
    // resizes to hug what it actually contains.
    if (isStructural(group)) return;
    const rects = childIds.map((id) => {
      const p = childMap.get(id)!;
      const size = sizeOf(id);
      return { x: p.x, y: p.y, width: size.width, height: size.height };
    });
    const extent = unionRect(rects);
    if (!extent) return;
    sizes.set(groupId, {
      width: extent.width + groupPadding * 2,
      height: extent.height + groupPadding * 2,
    });
  };

  // --- Resolve every group bottom-up, then place the top-level scope --------

  for (const g of nodes) {
    if (isGroup(g)) layoutGroup(g.id, 0);
  }
  packScope(index.childIds(null).filter((id) => byId.has(id)), { x: originX, y: originY });

  // --- Emit -----------------------------------------------------------------
  // Absolute position = the sum of local offsets down the parent chain, so a
  // group moving in its parent's scope carries its whole subtree with it.

  const finalPosition = (id: string): { x: number; y: number } => {
    const node = byId.get(id);
    const parentId = node?.parentId;
    const own =
      parentId && byId.has(parentId)
        ? (childrenLayout.get(parentId)?.get(id) ?? local.get(id) ?? { x: 0, y: 0 })
        : (local.get(id) ?? { x: node?.x ?? 0, y: node?.y ?? 0 });
    if (!parentId || !byId.has(parentId)) return own;
    const base = finalPosition(parentId);
    return { x: base.x + own.x, y: base.y + own.y };
  };

  const out = nodes.map((n) => {
    const position = finalPosition(n.id);
    const size = sizes.get(n.id) ?? { width: n.width, height: n.height };
    if (
      position.x === n.x &&
      position.y === n.y &&
      size.width === n.width &&
      size.height === n.height
    ) {
      return n;
    }
    return { ...n, x: position.x, y: position.y, width: size.width, height: size.height };
  });

  const bounds = unionRect(out.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })));

  return {
    nodes: out,
    levels,
    cycleBrokenEdgeIds,
    bounds: bounds ?? { ...EMPTY },
  };
}
