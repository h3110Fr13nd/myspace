/**
 * Canvas core — pointer interactions on nodes.
 *
 * A single rAF-throttled controller services node dragging, resizing, and
 * marquee selection. Consolidating them means:
 *
 *  - one set of window listeners, regardless of how many interaction kinds exist;
 *  - one animation frame per gesture instead of one per pointer event, so a
 *    1000 Hz mouse can't outrun the compositor;
 *  - one place where snapping and threshold logic live.
 *
 * Node positions are written through `onPreview` during the gesture (so edges
 * follow live) and committed once via `onEnd` on release — one history entry
 * per gesture, not per frame.
 *
 * Deltas are always measured in the transform captured when the gesture began,
 * so a zoom that happens mid-drag (keyboard shortcut, a second finger) cannot
 * teleport the node out from under the cursor.
 *
 * Two details that are easy to get wrong and were wrong here before:
 *
 *  - **The gesture owns a working copy of the nodes.** Deriving each frame from
 *    a prop that only updates on re-render means a fast drag re-applies stale
 *    positions, because two frames can land inside one render.
 *  - **The final frame is applied before the commit.** Cancelling a pending
 *    `requestAnimationFrame` on release silently discards the last delta, so a
 *    node ends up a few pixels short of where the user let go of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GRID } from './constants';
import { nodeRect } from './geometry';
import { GroupIndex, isGroup, topLevelUnitOf } from './grouping';
import type { Point, Rect, ViewportTransform } from './transform';
import type { CanvasNode } from '../types';

export type InteractionKind = 'move' | 'resize' | 'marquee';

interface Base {
  kind: InteractionKind;
  /** The pointer that owns this gesture; other pointers are ignored. */
  pointerId: number;
  startClient: Point;
  startTransform: ViewportTransform;
  moved: boolean;
  /**
   * The node array this gesture is editing. Captured at press time and updated
   * in place, so every frame composes from this gesture's own history rather
   * than from whatever React last rendered.
   */
  working: CanvasNode[];
}

interface MoveInteraction extends Base {
  kind: 'move';
  /** Every node id that travels together (selection + group children). */
  ids: Set<string>;
  startPositions: Map<string, Point>;
}

interface ResizeInteraction extends Base {
  kind: 'resize';
  nodeId: string;
  start: { width: number; height: number };
}

interface MarqueeInteraction extends Base {
  kind: 'marquee';
  /**
   * Built once when the gesture starts. `nodesInRect` needs the tree to resolve
   * hits to top-level units, and the working document cannot change mid-sweep,
   * so rebuilding it per frame would be pure waste.
   */
  index: GroupIndex;
  /** Selection to keep, unioned with whatever the rubber band touches. */
  baseSelection: Set<string>;
  originWorld: Point;
}

type Interaction = MoveInteraction | ResizeInteraction | MarqueeInteraction;

export interface UsePointerInteractionOptions {
  /** Live node list. Captured at press time; mid-gesture it comes from `working`. */
  nodes: readonly CanvasNode[];
  /** Current transform, read once per gesture rather than per frame. */
  getTransform: () => ViewportTransform;
  toWorld: (clientX: number, clientY: number) => Point;
  /** Live-preview node updates during a drag or resize. */
  onPreview: (nodes: CanvasNode[]) => void;
  /** A gesture began. Set cursor / interaction state here. */
  onBegin?: (kind: InteractionKind) => void;
  /**
   * A gesture ended. `moved` is false for a press that never travelled, which
   * is how the host distinguishes a click from a drag.
   */
  onEnd: (kind: InteractionKind, nodes: CanvasNode[], moved: boolean) => void;
  /**
   * Live marquee feedback, called on every frame of the sweep. Only ever called
   * with a real rect, so a host can treat it purely as "this is the selection
   * under the band right now".
   */
  onMarquee?: (ids: ReadonlySet<string>, rect: Rect) => void;
  /**
   * The sweep finished, carrying the selection it settled on — or, when the user
   * pressed Escape, the selection it started from.
   *
   * This is deliberately separate from `onMarquee`: signalling "the band is gone"
   * by passing a null rect meant a host reading that as "the selection is empty"
   * wiped the selection on the very frame the user finished drawing it.
   */
  onMarqueeEnd?: (ids: ReadonlySet<string>) => void;
  /** Escape mid-gesture: discard the preview and restore the starting state. */
  onCancel?: (kind: InteractionKind, nodes: CanvasNode[]) => void;
  /** Overridable for tests. */
  dragThreshold?: number;
  snap?: number;
  minNodeWidth?: number;
  minNodeHeight?: number;
}

export interface PointerInteractionApi {
  /** Live marquee rect in world space, or `null`. */
  marquee: Rect | null;
  /** Ids the marquee currently touches, unioned with the base selection. */
  marqueeSelection: Set<string>;
  isActive: () => boolean;
  beginMove: (e: { clientX: number; clientY: number; pointerId?: number }, nodeId: string, selectedIds: Iterable<string>) => void;
  beginResize: (e: { clientX: number; clientY: number; pointerId?: number }, nodeId: string) => void;
  beginMarquee: (
    e: { clientX: number; clientY: number; shiftKey?: boolean; pointerId?: number },
    baseSelection: Iterable<string>
  ) => void;
  cancel: () => void;
  /** Read the live interaction from an event handler without waiting for a render. */
  kind: () => InteractionKind | null;
}

function snapTo(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

export function usePointerInteraction(options: UsePointerInteractionOptions): PointerInteractionApi {
  const {
    nodes,
    getTransform,
    toWorld,
    onPreview,
    onBegin,
    onEnd,
    onMarquee,
    onMarqueeEnd,
    onCancel,
    dragThreshold = GRID.dragThreshold,
    snap = GRID.snap,
    minNodeWidth = GRID.minNodeWidth,
    minNodeHeight = GRID.minNodeHeight,
  } = options;

  const interactionRef = useRef<Interaction | null>(null);
  const frameRef = useRef(0);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });

  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<Set<string>>(() => new Set());

  // The host's node list. Only read at press time: after that the gesture's own
  // `working` copy is authoritative.
  const nodesRef = useRef<CanvasNode[]>(nodes as CanvasNode[]);
  nodesRef.current = nodes as CanvasNode[];

  // Stable mirrors so the imperative window handlers never read stale props.
  const handlersRef = useRef({
    getTransform,
    toWorld,
    onPreview,
    onEnd,
    onMarquee,
    onMarqueeEnd,
    onCancel,
    onBegin,
  });
  useEffect(() => {
    handlersRef.current = {
      getTransform,
      toWorld,
      onPreview,
      onEnd,
      onMarquee,
      onMarqueeEnd,
      onCancel,
      onBegin,
    };
  });

  const configRef = useRef({ dragThreshold, snap, minNodeWidth, minNodeHeight });
  configRef.current = { dragThreshold, snap, minNodeWidth, minNodeHeight };

  /** World-space delta, measured in the transform captured at gesture start. */
  const worldDelta = (it: Base): Point => {
    const s = it.startTransform;
    return {
      x: (pointerRef.current.x - it.startClient.x) / s.k,
      y: (pointerRef.current.y - it.startClient.y) / s.k,
    };
  };

  /** Past the press threshold yet? Sets `moved` on the first frame that is. */
  const passesThreshold = (it: Base): boolean => {
    if (it.moved) return true;
    const d = worldDelta(it);
    if (Math.hypot(d.x, d.y) * it.startTransform.k < configRef.current.dragThreshold) return false;
    it.moved = true;
    return true;
  };

  const applyMove = (it: MoveInteraction) => {
    if (!passesThreshold(it)) return;
    const { snap: step } = configRef.current;
    const d = worldDelta(it);
    const dx = snapTo(d.x, step);
    const dy = snapTo(d.y, step);
    it.working = it.working.map((n) => {
      if (!it.ids.has(n.id)) return n;
      const start = it.startPositions.get(n.id);
      if (!start) return n;
      return { ...n, x: start.x + dx, y: start.y + dy };
    });
    handlersRef.current.onPreview(it.working);
  };

  const applyResize = (it: ResizeInteraction) => {
    if (!passesThreshold(it)) return;
    const { snap: step, minNodeWidth: minW, minNodeHeight: minH } = configRef.current;
    const d = worldDelta(it);
    const width = Math.max(snapTo(it.start.width + d.x, step), minW);
    const height = Math.max(snapTo(it.start.height + d.y, step), minH);
    it.working = it.working.map((n) => (n.id === it.nodeId ? { ...n, width, height } : n));
    handlersRef.current.onPreview(it.working);
  };

  const applyMarquee = (it: MarqueeInteraction): Set<string> => {
    const world = handlersRef.current.toWorld(pointerRef.current.x, pointerRef.current.y);
    it.moved = true;
    const origin = it.originWorld;
    const rect: Rect = {
      x: Math.min(origin.x, world.x),
      y: Math.min(origin.y, world.y),
      width: Math.abs(world.x - origin.x),
      height: Math.abs(world.y - origin.y),
    };
    /**
     * The base selection is unioned in, not replaced: Shift+drag is how a user
     * adds to a selection, and dropping the base would make the modifier
     * meaningless.
     */
    const selection = new Set(it.baseSelection);
    for (const id of nodesInRect(it.working, rect, it.index)) selection.add(id);
    setMarquee(rect);
    setMarqueeSelection(selection);
    handlersRef.current.onMarquee?.(selection, rect);
    return selection;
  };

  const tick = useCallback(() => {
    frameRef.current = 0;
    const it = interactionRef.current;
    if (!it) return;
    if (it.kind === 'move') applyMove(it);
    else if (it.kind === 'resize') applyResize(it);
    else if (it.kind === 'marquee') applyMarquee(it);
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(tick);
  }, [tick]);

  /**
   * Drop the rubber band without touching the selection. The visual is this
   * hook's own `marquee` state; the selection is the host's, and clearing one
   * must never imply clearing the other.
   */
  const clearMarquee = useCallback(() => {
    setMarquee(null);
    setMarqueeSelection(new Set());
  }, []);

  const begin = (it: Interaction) => {
    interactionRef.current = it;
    pointerRef.current = { x: it.startClient.x, y: it.startClient.y };
    handlersRef.current.onBegin?.(it.kind);
  };

  const beginMove: PointerInteractionApi['beginMove'] = useCallback(
    (e, nodeId, selectedIds) => {
      const ids = new Set<string>(selectedIds);
      if (!ids.has(nodeId)) ids.add(nodeId);

      const working = nodesRef.current.slice();
      const index = new GroupIndex(working);

      /**
       * A group carries its whole subtree, taken from `parentId` rather than
       * from a containment test.
       *
       * The geometric version picked up every node whose rect happened to
       * overlap the group — including a sibling group sitting inside it — so
       * dragging one group teleported unrelated nodes across the board. Worse,
       * the badge counted a different set again, so the three disagreed (D1/D2).
       * `descendantIds` is the same answer the badge uses, by construction.
       *
       * Structural groups keep far-flung children too, which is the point: the
       * link is stated, so the subtree travels together regardless of geometry.
       */
      for (const id of Array.from(ids)) {
        if (isGroup(index.get(id) ?? { type: 'group' })) {
          for (const child of index.descendantIds(id)) ids.add(child);
        }
      }

      const startPositions = new Map<string, Point>();
      for (const n of working) {
        if (ids.has(n.id)) startPositions.set(n.id, { x: n.x, y: n.y });
      }

      begin({
        kind: 'move',
        ids,
        startPositions,
        working,
        pointerId: e.pointerId ?? -1,
        startClient: { x: e.clientX, y: e.clientY },
        startTransform: handlersRef.current.getTransform(),
        moved: false,
      });
      schedule();
    },
    [schedule]
  );

  const beginResize: PointerInteractionApi['beginResize'] = useCallback(
    (e, nodeId) => {
      const working = nodesRef.current.slice();
      const node = working.find((n) => n.id === nodeId);
      if (!node) return;
      begin({
        kind: 'resize',
        nodeId,
        start: { width: node.width, height: node.height },
        working,
        pointerId: e.pointerId ?? -1,
        startClient: { x: e.clientX, y: e.clientY },
        startTransform: handlersRef.current.getTransform(),
        moved: false,
      });
      schedule();
    },
    [schedule]
  );

  const beginMarquee: PointerInteractionApi['beginMarquee'] = useCallback((e, baseSelection) => {
    const world = handlersRef.current.toWorld(e.clientX, e.clientY);
    begin({
      kind: 'marquee',
      index: new GroupIndex(nodesRef.current),
      baseSelection: new Set(baseSelection),
      originWorld: world,
      working: nodesRef.current.slice(),
      pointerId: e.pointerId ?? -1,
      startClient: { x: e.clientX, y: e.clientY },
      startTransform: handlersRef.current.getTransform(),
      moved: false,
    });
    setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const cancel = useCallback(() => {
    const it = interactionRef.current;
    interactionRef.current = null;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (it && it.kind === 'marquee') {
      // Escape abandons the sweep: keep whatever was selected beforehand.
      clearMarquee();
      handlersRef.current.onMarqueeEnd?.(it.baseSelection);
      return;
    }
    if (it) {
      /**
       * Hand back the untouched array. During a move or resize `working` has
       * been rewritten in place, so the pre-gesture state has to be the host's
       * list, not a copy of the mutated one.
       */
      handlersRef.current.onCancel?.(it.kind, nodesRef.current);
    }
  }, [clearMarquee]);

  // --- Window-level tracking -------------------------------------------------

  useEffect(() => {
    const active = (e: PointerEvent) => {
      const it = interactionRef.current;
      return !!it && (it.pointerId < 0 || it.pointerId === e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!active(e)) return;
      pointerRef.current = { x: e.clientX, y: e.clientY };
      schedule();
    };

    /**
     * Apply the release position before committing. Cancelling the pending frame
     * first would drop the last delta and leave the node short of where the
     * user actually let go.
     */
    const finish = (e: PointerEvent) => {
      if (!active(e)) return;
      const it = interactionRef.current;
      if (!it) return;
      pointerRef.current = { x: e.clientX, y: e.clientY };

      if (it.kind === 'marquee') {
        // One last evaluation so a fast flick still selects what it swept over,
        // and so the settled selection is reported even if no frame ever ran.
        const settled = it.moved ? applyMarquee(it) : new Set(it.baseSelection);
        interactionRef.current = null;
        if (frameRef.current) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = 0;
        }
        clearMarquee();
        handlersRef.current.onMarqueeEnd?.(settled);
        handlersRef.current.onEnd('marquee', it.working, it.moved);
        return;
      }

      if (it.kind === 'move') applyMove(it);
      else applyResize(it);

      interactionRef.current = null;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      handlersRef.current.onEnd(it.kind, it.working, it.moved);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !interactionRef.current) return;
      e.preventDefault();
      cancel();
    };

    /**
     * Pointer Events, not mouse events: a node press can begin on touch (the
     * board shell wires `onPointerDown`), and a mouse-only stream would leave
     * the gesture with no moves or release to finish it.
     */
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [cancel, clearMarquee, schedule]);

  const isActive = useCallback(() => interactionRef.current !== null, []);
  const kind = useCallback(() => interactionRef.current?.kind ?? null, []);

  return useMemo<PointerInteractionApi>(
    () => ({ marquee, marqueeSelection, isActive, beginMove, beginResize, beginMarquee, cancel, kind }),
    [beginMarquee, beginMove, beginResize, cancel, isActive, kind, marquee, marqueeSelection]
  );
}

/**
 * Nodes intersecting a marquee rect, reported as whole top-level units.
 *
 * Two rules, both from the plan:
 *
 *  - Groups are matched by their own frame, not skipped. Skipping them meant a
 *    rubber band drawn around a group selected nothing at all, because the band
 *    touched the group's rect and none of its children.
 *  - A hit resolves to the outermost group containing it, so a band drawn over
 *    part of a group selects the whole group rather than a fragment of it.
 *    Excalidraw's `getRootElements` `[SRC]`.
 */
export function nodesInRect(
  nodes: readonly CanvasNode[],
  rect: Rect,
  /** Supply the caller's index: a marquee calls this every frame. */
  index: GroupIndex = new GroupIndex(nodes)
): string[] {
  const hits: string[] = [];
  for (const n of nodes) {
    const r = nodeRect(n);
    const intersects =
      r.x < rect.x + rect.width &&
      r.x + r.width > rect.x &&
      r.y < rect.y + rect.height &&
      r.y + r.height > rect.y;
    if (!intersects) continue;
    // A group nested in another group is represented by that outer group.
    if (n.parentId && index.get(n.parentId)) continue;
    hits.push(topLevelUnitOf(index, n.id));
  }
  return [...new Set(hits)];
}
