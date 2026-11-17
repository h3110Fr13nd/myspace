/**
 * Canvas core — connection drag state machine.
 *
 * This is the single interaction that makes or breaks a node editor, so it is
 * modelled as an explicit state machine with one code path shared by three
 * gestures that all feel the same to the user:
 *
 *   1. **Create**   — press a port dot, drag, release on a node or a port.
 *   2. **Re-attach**— press a dot on an existing edge's endpoint, drag, release.
 *   3. **Detach**   — press an endpoint dot and release on empty board space.
 *
 * Intuitive rules, all of which fall out of the model rather than being special
 * cased per call site:
 *
 *   - Release over a **port dot** (within `PORT_SNAP_RADIUS`) → that exact side.
 *   - Release over **anywhere on a node** → best side chosen automatically, so
 *     users never have to aim at a 12px dot.
 *   - Release over **empty space** → the end is detached; the edge becomes a
 *     dangling stub that can be picked up again later (or is deleted by the
 *     host's policy).
 *   - Release over the **same node** → allowed. Self-loops are a real modelling
 *     need (a node that cites itself, a retry edge) and blocking them is a
 *     common source of "why won't this connect?" confusion.
 *   - **Escape** cancels and restores the original state.
 *   - **Backspace/Delete** while dragging removes the endpoint.
 *
 * Pointer position is only ever read from the event, so the drag stays correct
 * even if the board pans or zooms mid-gesture.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DROP_TOLERANCE, PORT_SNAP_RADIUS } from './constants';
import {
  anchorFor,
  bestPortForPoint,
  curveBetween,
  nearestPort,
  type Anchor,
  type PortSide,
} from './geometry';
import { NodeIndex } from './spatialIndex';
import type { Point } from './transform';
import { edgeEndFreePoint, type CanvasEdge, type CanvasNode } from '../types';

export type ConnectionOrigin =
  | { kind: 'create'; fromNode: string; fromSide: PortSide }
  | { kind: 'reattach'; edgeId: string; end: 'from' | 'to'; original: CanvasEdge };

export interface ConnectionTarget {
  nodeId: string;
  side: PortSide;
  /** World position of the resolved anchor. */
  point: Point;
}

export interface ConnectionDrag {
  origin: ConnectionOrigin;
  /** Live pointer position in world space. */
  pointer: Point;
  /** The anchor the edge is being pulled from. */
  source: Anchor;
  /** Currently hovered target, if any. */
  target: ConnectionTarget | null;
  /** Set once the drag has moved far enough to count as intentional. */
  active: boolean;
}

export interface ConnectionApi {
  drag: ConnectionDrag | null;
  /** Start pulling from a port on a node. */
  startFromPort: (nodeId: string, side: PortSide) => void;
  /** Start pulling an existing edge's endpoint. */
  startFromEdgeEnd: (edgeId: string, end: 'from' | 'to') => void;
  /** Update the pointer (client coords) mid-drag. */
  update: (clientX: number, clientY: number) => void;
  /**
   * Finish the drag. Returns the change to apply, or `null` if the drag was
   * cancelled / produced nothing.
   */
  finish: () => ConnectionResult | null;
  /** Abandon the drag, restoring the pre-drag state. */
  cancel: () => void;
  /** Node ids that would be a legal drop target right now. */
  isValidTarget: (nodeId: string) => boolean;
}

export type ConnectionResult =
  | { type: 'create'; edge: CanvasEdge }
  | { type: 'reattach'; edgeId: string; end: 'from' | 'to'; nodeId: string; side: PortSide }
  /**
   * Released over empty board. `point` is where it was let go, in world space:
   * the edge has to record it, otherwise the detached end has no position, the
   * edge stops rendering, and its handle vanishes with it — leaving the user no
   * way to pick it back up.
   */
  | { type: 'detach'; edgeId: string; end: 'from' | 'to'; point: Point }
  | { type: 'remove'; edgeId: string; end: 'from' | 'to' };

export interface UseConnectionOptions {
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  /**
   * Spatial index over `nodes`, used to resolve drop targets. Optional so a
   * host with a handful of nodes can skip building one; without it the lookup
   * falls back to a linear scan, which is what the editor did before.
   */
  index?: NodeIndex;
  /** Client coords -> world coords. */
  toWorld: (clientX: number, clientY: number) => Point;
  /** Enables re-attaching existing endpoints (edit mode only). */
  allowReattach?: boolean;
  /** Default label for created edges. */
  defaultLabel?: string;
  onChange?: (result: ConnectionResult) => void;
}

let edgeSeq = 0;
function nextEdgeId(): string {
  edgeSeq += 1;
  return `e_${Date.now().toString(36)}_${edgeSeq.toString(36)}`;
}

export function useConnection(options: UseConnectionOptions): ConnectionApi {
  const {
    nodes,
    edges,
    index,
    toWorld,
    allowReattach = true,
    defaultLabel,
    onChange,
  } = options;

  const [drag, setDrag] = useState<ConnectionDrag | null>(null);

  // Refs mirror the latest inputs so the imperative drag handlers never close
  // over stale node lists mid-gesture.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const indexRef = useRef(index);
  const toWorldRef = useRef(toWorld);
  const defaultLabelRef = useRef(defaultLabel);
  const onChangeRef = useRef(onChange);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  indexRef.current = index;
  toWorldRef.current = toWorld;
  defaultLabelRef.current = defaultLabel;
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const findNode = useCallback((id: string) => nodesRef.current.find((n) => n.id === id), []);

  /** Nodes near a point: the spatial index when there is one, else a scan. */
  const nodesNear = useCallback((world: Point, tolerance: number): readonly CanvasNode[] => {
    const idx = indexRef.current;
    if (idx) return idx.searchTolerant(world, tolerance);
    const out: CanvasNode[] = [];
    for (const n of nodesRef.current) {
      if (
        n.x - tolerance <= world.x &&
        world.x <= n.x + n.width + tolerance &&
        n.y - tolerance <= world.y &&
        world.y <= n.y + n.height + tolerance
      ) {
        out.push(n);
      }
    }
    return out;
  }, []);

  /** Resolve what the pointer is currently over: a precise port, a node body, or nothing. */
  const resolveTarget = useCallback(
    (world: Point): ConnectionTarget | null => {
      // 1. Precise port wins, even if the pointer is slightly off the dot.
      let best: ConnectionTarget | null = null;
      let bestDist = PORT_SNAP_RADIUS;
      for (const node of nodesNear(world, PORT_SNAP_RADIUS)) {
        const near = nearestPort(node, world, PORT_SNAP_RADIUS);
        if (near && near.dist < bestDist) {
          bestDist = near.dist;
          const a = anchorFor(node, near.side);
          best = { nodeId: node.id, side: near.side, point: { x: a.x, y: a.y } };
        }
      }
      if (best) return best;

      // 2. Anywhere on a node's body still counts, with an automatic side.
      //    Groups are containers, not connection targets.
      let fallback: ConnectionTarget | null = null;
      let fallbackArea = Infinity;
      for (const node of nodesNear(world, DROP_TOLERANCE)) {
        if (node.type === 'group') continue;
        const side = bestPortForPoint(node, world, DROP_TOLERANCE);
        if (!side) continue;
        const a = anchorFor(node, side);
        // Overlapping nodes: the smallest is the visually topmost, so it wins.
        const area = node.width * node.height;
        if (!fallback || area < fallbackArea) {
          fallback = { nodeId: node.id, side, point: { x: a.x, y: a.y } };
          fallbackArea = area;
        }
      }
      return fallback;
    },
    [nodesNear]
  );

  const startFromPort = useCallback(
    (nodeId: string, side: PortSide) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      const a = anchorFor(node, side);
      setDrag({
        origin: { kind: 'create', fromNode: nodeId, fromSide: side },
        pointer: { x: a.x, y: a.y },
        source: a,
        target: null,
        active: false,
      });
    },
    []
  );

  const startFromEdgeEnd = useCallback(
    (edgeId: string, end: 'from' | 'to') => {
      if (!allowReattach) return;
      const edge = edgesRef.current.find((e) => e.id === edgeId);
      if (!edge) return;

      const nodeId = end === 'from' ? edge.fromNode : edge.toNode;
      const node = nodeId ? findNode(nodeId) : undefined;
      if (node) {
        const side = (end === 'from' ? edge.fromSide : edge.toSide) ?? 'right';
        const a = anchorFor(node, side);
        setDrag({
          origin: { kind: 'reattach', edgeId, end, original: edge },
          pointer: { x: a.x, y: a.y },
          source: a,
          target: { nodeId: node.id, side, point: { x: a.x, y: a.y } },
          active: false,
        });
        return;
      }

      /**
       * This end is already detached. Its free position is the only anchor
       * there is, so the drag has to start from there — refusing here would
       * strand every detached endpoint permanently.
       */
      const point = edgeEndFreePoint(edge, end);
      if (!point) return;
      setDrag({
        origin: { kind: 'reattach', edgeId, end, original: edge },
        pointer: { x: point.x, y: point.y },
        source: { x: point.x, y: point.y, nx: 0, ny: 0 },
        target: null,
        active: false,
      });
    },
    [allowReattach, findNode]
  );

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const world = toWorldRef.current(clientX, clientY);
      setDrag((prev) => {
        if (!prev) return prev;
        const target = resolveTarget(world);
        const moved =
          prev.active || Math.hypot(world.x - prev.source.x, world.y - prev.source.y) > 2;
        return { ...prev, pointer: world, target, active: moved };
      });
    },
    [resolveTarget]
  );

  const cancel = useCallback(() => setDrag(null), []);

  const finish = useCallback((): ConnectionResult | null => {
    const d = drag;
    setDrag(null);
    if (!d || !d.active) return null;

    const { origin, target } = d;
    const end = origin.kind === 'reattach' ? origin.end : null;

    if (origin.kind === 'create') {
      if (!target) return null;
      // Self-connection is legitimate; keep the sides distinguishable.
      const label = defaultLabelRef.current;
      const edge: CanvasEdge = {
        id: nextEdgeId(),
        fromNode: origin.fromNode,
        fromSide: origin.fromSide,
        toNode: target.nodeId,
        toSide: target.side,
        ...(label ? { label } : {}),
        toEnd: 'arrow',
        color: '5',
      };
      const result: ConnectionResult = { type: 'create', edge };
      onChangeRef.current?.(result);
      return result;
    }

    // Re-attach. Released over empty space: the end goes free, and the release
    // point has to travel with the result so the edge keeps a drawable anchor.
    if (!target) {
      const result: ConnectionResult = {
        type: 'detach',
        edgeId: origin.edgeId,
        end: origin.end,
        point: { x: d.pointer.x, y: d.pointer.y },
      };
      onChangeRef.current?.(result);
      return result;
    }

    /**
     * Released exactly where it started. Checked for *both* ends: the original
     * only compared `from`, so re-pointing a `to` endpoint back onto its own
     * anchor produced a redundant change and a history entry that did nothing.
     */
    const sameNode = end === 'from' ? origin.original.fromNode : origin.original.toNode;
    const sameSide = end === 'from' ? origin.original.fromSide : origin.original.toSide;
    if (target.nodeId === sameNode && target.side === sameSide) return null;

    const result: ConnectionResult = {
      type: 'reattach',
      edgeId: origin.edgeId,
      end: origin.end,
      nodeId: target.nodeId,
      side: target.side,
    };
    onChangeRef.current?.(result);
    return result;
  }, [drag]);

  const isValidTarget = useCallback(
    (nodeId: string) => {
      if (!drag) return true;
      // Every node is a legal target; highlighting communicates this rather than
      // blocking the interaction, which is what makes self-loops discoverable.
      return nodesRef.current.some((n) => n.id === nodeId);
    },
    [drag]
  );

  return useMemo<ConnectionApi>(
    () => ({ drag, startFromPort, startFromEdgeEnd, update, finish, cancel, isValidTarget }),
    [cancel, drag, finish, isValidTarget, startFromEdgeEnd, startFromPort, update]
  );
}

/**
 * Geometry for the live preview curve while dragging a connection.
 * Exported so the renderer and the drag state can never disagree about where
 * the line goes.
 */
export function draftCurve(source: Anchor, target: { point: Point } | null, pointer: Point) {
  const end: Anchor = target
    ? { x: target.point.x, y: target.point.y, nx: 0, ny: 0 }
    : { x: pointer.x, y: pointer.y, nx: -source.nx, ny: -source.ny };
  return curveBetween(source, end);
}
