/**
 * Canvas core — edge endpoint handles.
 *
 * The affordance that makes "unlink and relink" discoverable. When an edge is
 * selected (or the pointer is hovering it), a grabbable dot appears on each
 * endpoint. Dragging one detaches that end; releasing over a node reattaches it
 * to the nearest port, and releasing over empty canvas leaves it detached.
 *
 * Handles are rendered in screen space inside the transform layer and sized in
 * inverse-zoom units, so they stay a constant size on screen at any zoom while
 * still tracking their world position exactly.
 */

import React, { memo, useMemo } from 'react';
import { resolveEdgeEnd } from './routing';
import type { PortSide } from './geometry';
import type { Point } from './transform';
import type { CanvasEdge, CanvasNode } from '../types';

export type EndpointRef = 'from' | 'to';

export interface EndpointHandleProps {
  edge: CanvasEdge;
  end: EndpointRef;
  /** All board nodes, so a detached end can still be located. */
  nodes: readonly CanvasNode[];
  /** 1 / zoom, so the dot keeps a constant screen size. */
  inv: number;
  isSelected: boolean;
  onPointerDown: (edgeId: string, end: EndpointRef, e: React.PointerEvent) => void;
  onContextMenu?: (edgeId: string, end: EndpointRef, e: React.MouseEvent) => void;
}

/**
 * Resolve the world position of an edge endpoint.
 *
 * Delegates to `resolveEdgeEnd` so the handle, the renderer and the connection
 * drag can never disagree about where an end is — including while it is
 * detached, where the answer comes from the stored free coordinates rather than
 * from a node.
 */
export function endpointPoint(
  edge: Pick<
    CanvasEdge,
    'fromNode' | 'fromSide' | 'toNode' | 'toSide' | 'fromX' | 'fromY' | 'toX' | 'toY'
  >,
  end: EndpointRef,
  nodes: readonly CanvasNode[]
): { point: Point; side: PortSide; nodeId: string } | null {
  const resolved = resolveEdgeEnd(edge as CanvasEdge, end, nodes);
  if (!resolved) return null;
  return { point: resolved.point, side: resolved.side, nodeId: resolved.nodeId };
}

export const EndpointHandle = memo(function EndpointHandle({
  edge,
  end,
  nodes,
  inv,
  isSelected,
  onPointerDown,
  onContextMenu,
}: EndpointHandleProps) {
  const resolved = useMemo(() => endpointPoint(edge, end, nodes), [edge, end, nodes]);
  if (!resolved) return null;
  const size = 11 * inv;

  return (
    <div
      className={`canvas-edge-endpoint${isSelected ? ' is-selected' : ''}`}
      data-edge-id={edge.id}
      data-end={end}
      style={{
        position: 'absolute',
        left: resolved.point.x,
        top: resolved.point.y,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: '50%',
        background: 'var(--accent-cyan-bright, #00f2fe)',
        border: `${2 * inv}px solid var(--surface-1, #0b0f19)`,
        boxShadow: `0 0 ${6 * inv}px rgba(0, 242, 254, 0.8)`,
        cursor: 'grab',
        touchAction: 'none',
        zIndex: 20,
        pointerEvents: 'auto',
      }}
      title={
        end === 'from'
          ? 'Drag to re-point this edge’s start, or drop on empty space to detach'
          : 'Drag to re-point this edge’s end, or drop on empty space to detach'
      }
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onPointerDown(edge.id, end, e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(edge.id, end, e);
      }}
    />
  );
});

export interface EdgeEndpointLayerProps {
  edges: readonly CanvasEdge[];
  nodes: readonly CanvasNode[];
  selectedEdgeIds: ReadonlySet<string>;
  hoveredEdgeId?: string | null;
  /** The edge whose endpoint is being dragged (kept visible). */
  activeEdgeId?: string | null;
  inv: number;
  onPointerDown: (edgeId: string, end: EndpointRef, e: React.PointerEvent) => void;
  onContextMenu?: (edgeId: string, end: EndpointRef, e: React.MouseEvent) => void;
}

/**
 * Renders endpoint handles for the selected edge only. Showing them on hover
 * too would double the interactive element count on dense boards; selection is
 * the standard, predictable trigger (Figma, Miro and tldraw all behave this way).
 */
export const EdgeEndpointLayer: React.FC<EdgeEndpointLayerProps> = ({
  edges,
  nodes,
  selectedEdgeIds,
  hoveredEdgeId,
  activeEdgeId,
  inv,
  onPointerDown,
  onContextMenu,
}) => {
  const placeable = (edge: CanvasEdge) =>
    resolveEdgeEnd(edge, 'from', nodes) !== null && resolveEdgeEnd(edge, 'to', nodes) !== null;

  const visible = edges.filter(
    (e) =>
      (selectedEdgeIds.has(e.id) || hoveredEdgeId === e.id || activeEdgeId === e.id) &&
      placeable(e)
  );

  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((edge) => {
        const isSelected = selectedEdgeIds.has(edge.id) || activeEdgeId === edge.id;
        return (
          <React.Fragment key={`${edge.id}-handles`}>
            <EndpointHandle
              edge={edge}
              end="from"
              nodes={nodes}
              inv={inv}
              isSelected={isSelected}
              onPointerDown={onPointerDown}
              onContextMenu={onContextMenu}
            />
            <EndpointHandle
              edge={edge}
              end="to"
              nodes={nodes}
              inv={inv}
              isSelected={isSelected}
              onPointerDown={onPointerDown}
              onContextMenu={onContextMenu}
            />
          </React.Fragment>
        );
      })}
    </>
  );
};
