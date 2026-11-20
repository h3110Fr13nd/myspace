/**
 * Canvas core — viewport virtualisation for node DOM.
 *
 * The board used to mount every node as DOM and re-render all of them on every
 * pan frame and every drag frame. This hook returns only the nodes near the
 * viewport, and keeps that list *stable* while the user pans within a padded
 * "render rect", so panning re-renders nothing until the view actually leaves
 * the area that was prepared.
 *
 * Costs per frame:
 *  - pan/zoom inside the render rect: O(1) (memoised list returned as-is);
 *  - leaving it: one R-tree query, O(log n + visible);
 *  - drag preview frames: O(visible). The R-tree is *not* rebuilt mid-gesture —
 *    it is rebuilt once when the gesture commits. Moved nodes are resolved to
 *    their live objects through an id -> array-position map, which stays valid
 *    during previews because they map the array without reordering it.
 */
import { useMemo, useRef } from 'react';
import type { CanvasNode } from '../types';
import { NodeIndex } from './spatialIndex';
import type { Rect } from './transform';

export interface VirtualNodesOptions {
  nodes: readonly CanvasNode[];
  /** World-space visible rect. */
  view: Rect;
  /** Ids that must render regardless of position (editing, drop/connection target). Keep small. */
  pinned?: ReadonlySet<string>;
  /**
   * Ids whose *live* position is checked against the render rect on every
   * recompute — the selection while a gesture moves it, because the index is
   * frozen mid-gesture. O(tracked); off-screen tracked nodes stay unmounted, so
   * a 10k-node selection does not mount 10k nodes.
   */
  tracked?: ReadonlySet<string>;
  /** True while a gesture previews positions; the index is frozen until it ends. */
  interacting?: boolean;
  /** Padding added around the view, as a fraction of its larger side. */
  margin?: number;
  /** At or below this many nodes everything renders; culling would not pay for itself. */
  threshold?: number;
}

export interface VirtualNodes {
  /** Nodes to mount, in document order (which is also stacking order). */
  visible: readonly CanvasNode[];
  /** The spatial index (as of the last committed document). */
  index: NodeIndex;
  /** The world rect the current list was prepared for. */
  renderRect: Rect;
  culled: boolean;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export interface RenderRectState {
  rect: Rect;
  zoomSpan: number;
}

/**
 * The padded rect the mounted list is prepared for. Returns `prev` unchanged
 * (same object) while the view stays inside it and the zoom has not changed by
 * more than 1.5x either way — that identity is what lets a pan skip work.
 */
export function nextRenderRect(prev: RenderRectState | null, view: Rect, margin: number): RenderRectState {
  const span = Math.max(view.width, view.height);
  if (prev && span <= prev.zoomSpan * 1.5 && span >= prev.zoomSpan / 1.5 && contains(prev.rect, view)) return prev;
  const pad = span * margin;
  return {
    rect: { x: view.x - pad, y: view.y - pad, width: view.width + pad * 2, height: view.height + pad * 2 },
    zoomSpan: span,
  };
}

/**
 * Live node objects for `found` ∪ `pinned`, in document order. `pos` maps ids to
 * array positions as of the last index build; each lookup is verified and falls
 * back to a scan if the array was reordered underneath it.
 */
export function pickVisible(
  found: readonly string[],
  pinned: ReadonlySet<string>,
  nodes: readonly CanvasNode[],
  pos: ReadonlyMap<string, number>,
  tracked: ReadonlySet<string> = EMPTY_SET,
  renderRect?: Rect
): CanvasNode[] {
  const picked = new Set<number>();
  const live = (id: string): number => {
    const i = pos.get(id);
    if (i !== undefined && nodes[i]?.id === id) return i;
    for (let j = 0; j < nodes.length; j++) if (nodes[j].id === id) return j;
    return -1;
  };
  for (const id of found) {
    const i = live(id);
    if (i >= 0) picked.add(i);
  }
  for (const id of pinned) {
    const i = live(id);
    if (i >= 0) picked.add(i);
  }
  if (renderRect) {
    for (const id of tracked) {
      const i = live(id);
      if (i < 0) continue;
      const n = nodes[i];
      if (
        n.x <= renderRect.x + renderRect.width &&
        n.x + n.width >= renderRect.x &&
        n.y <= renderRect.y + renderRect.height &&
        n.y + n.height >= renderRect.y
      ) {
        picked.add(i);
      }
    }
  }
  return Array.from(picked)
    .sort((a, b) => a - b)
    .map((i) => nodes[i]);
}

export function useVirtualNodes({
  nodes,
  view,
  pinned = EMPTY_SET,
  tracked = EMPTY_SET,
  interacting = false,
  margin = 0.5,
  threshold = 300,
}: VirtualNodesOptions): VirtualNodes {
  // --- index, rebuilt only on committed documents ---------------------------
  const indexState = useRef<{ index: NodeIndex; source: readonly CanvasNode[] | null; pos: Map<string, number> }>({
    index: new NodeIndex([]),
    source: null,
    pos: new Map(),
  });
  const st = indexState.current;
  if (st.source !== nodes && (!interacting || st.source === null || st.source.length !== nodes.length)) {
    st.index = new NodeIndex(nodes);
    st.source = nodes;
    st.pos = new Map();
    for (let i = 0; i < nodes.length; i++) st.pos.set(nodes[i].id, i);
  }
  const indexVersion = st.source;

  // --- render rect with hysteresis -----------------------------------------
  const rectState = useRef<RenderRectState | null>(null);
  rectState.current = nextRenderRect(rectState.current, view, margin);
  const renderRect = rectState.current.rect;

  // --- the list ---------------------------------------------------------------
  // Recomputed when the render rect moves, the committed index changes, the
  // pinned set changes, or (during a gesture) the live array changes — the last
  // only swaps in live objects for already-found ids, O(visible).
  const found = useMemo(() => {
    if (nodes.length <= threshold) return null;
    return st.index.search(renderRect).map((n) => n.id);
    // indexVersion stands in for the index object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderRect, indexVersion, nodes.length <= threshold]);

  const visible = useMemo(
    () => (found ? pickVisible(found, pinned, nodes, st.pos, interacting ? tracked : EMPTY_SET, renderRect) : nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [found, nodes, pinned, interacting, interacting ? tracked : null, renderRect]
  );

  return { visible, index: st.index, renderRect, culled: found !== null };
}
