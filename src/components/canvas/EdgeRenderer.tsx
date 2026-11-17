/**
 * Canvas edge rendering.
 *
 * Public entry point for both the editor and the read-only viewer. This is a
 * thin adapter: all rendering lives in `core/EdgeRenderer`, and this file's job
 * is to keep the historical prop surface stable while the renderer moves to a
 * screen-space canvas.
 *
 * Migration note
 * --------------
 * The old renderer drew a canvas sized to the *content* bounding box and placed
 * it inside the transform layer. Two bugs fell out of that:
 *
 *  - Content outside the bounding box (or simply far from the origin) was
 *    cropped, so edges disappeared.
 *  - It reallocated the backing store on every redraw and called
 *    `ctx.scale(dpr, dpr)` without resetting the transform, so the context
 *    transform accumulated and edges drifted after a few updates.
 *
 * The renderer now fills the **viewport** and paints in screen coordinates.
 * Mount it as a sibling of the transform layer, not inside it:
 *
 *   <div class="viewport">
 *     <EdgeLayer />          // screen space, behind
 *     <div class="transform-layer">nodes</div>
 *   </div>
 */

import React, { useMemo } from 'react';
import {
  EdgeRenderer as CoreEdgeRenderer,
  type DraftEdgeSpec,
} from './core/EdgeRenderer';
import { visibleRect } from './core/transform';
import type { ViewportTransform } from './core/transform';
import type { CanvasEdge, CanvasNode } from './types';

/** Legacy draft-edge shape, still produced by `useCanvasEditor`. */
export interface DraftEdge {
  fromNode: string;
  fromSide: 'top' | 'right' | 'bottom' | 'left';
  currentX: number;
  currentY: number;
}

export interface EdgeRendererProps {
  edges: readonly CanvasEdge[];
  nodes: readonly CanvasNode[];
  /** Current pan/zoom. */
  transform: ViewportTransform;
  /** Viewport size in CSS px, from the shell's ResizeObserver. */
  size: { width: number; height: number };
  /** Single-selection highlight. Multi-selection is passed as a set. */
  selectedEdgeId?: string | null;
  selectedEdgeIds?: ReadonlySet<string>;
  /** Edge currently being re-pointed. */
  activeEdgeId?: string | null;
  onEdgeClick?: (edgeId: string) => void;
  onEdgeContextMenu?: (edgeId: string, e: React.MouseEvent) => void;
  draftEdge?: DraftEdge | null;
  routerId?: string;
}

export const EdgeRenderer: React.FC<EdgeRendererProps> = ({
  edges,
  nodes,
  transform,
  size,
  selectedEdgeId,
  selectedEdgeIds,
  activeEdgeId,
  onEdgeClick,
  onEdgeContextMenu,
  draftEdge,
  routerId,
}) => {
  // Culling rect: the world area currently on screen, padded a little so an
  // edge that is about to scroll in is already prepared.
  const view = useMemo(
    () => visibleRect(transform, size),
    [transform, size]
  );

  const selected = useMemo<ReadonlySet<string>>(() => {
    if (selectedEdgeIds) return selectedEdgeIds;
    return selectedEdgeId ? new Set([selectedEdgeId]) : new Set<string>();
  }, [selectedEdgeId, selectedEdgeIds]);

  return (
    <CoreEdgeRenderer
      edges={edges}
      nodes={nodes}
      transform={transform}
      size={size}
      visibleRect={view}
      selectedEdgeIds={selected}
      activeEdgeId={activeEdgeId}
      routerId={routerId}
      draftEdge={draftEdge ? toDraftSpec(draftEdge, nodes) : null}
      onEdgeClick={onEdgeClick}
      onEdgeContextMenu={onEdgeContextMenu}
    />
  );
};

function toDraftSpec(draft: DraftEdge, nodes: readonly CanvasNode[]): DraftEdgeSpec | null {
  const from = nodes.find((n) => n.id === draft.fromNode);
  if (!from) return null;

  const left = from.x;
  const right = from.x + from.width;
  const top = from.y;
  const bottom = from.y + from.height;

  const sx = draft.fromSide === 'left' ? left : draft.fromSide === 'right' ? right : from.x + from.width / 2;
  const sy = draft.fromSide === 'top' ? top : draft.fromSide === 'bottom' ? bottom : from.y + from.height / 2;
  const nx = draft.fromSide === 'left' ? -1 : draft.fromSide === 'right' ? 1 : 0;
  const ny = draft.fromSide === 'top' ? -1 : draft.fromSide === 'bottom' ? 1 : 0;

  const handle = Math.max(40, Math.min(160, Math.hypot(draft.currentX - sx, draft.currentY - sy) * 0.45));

  return {
    path: `M ${sx} ${sy} C ${sx + nx * handle} ${sy + ny * handle}, ${draft.currentX} ${draft.currentY}, ${draft.currentX} ${draft.currentY}`,
    from: { x: sx, y: sy },
    to: { x: draft.currentX, y: draft.currentY },
    isSnapped: false,
  };
}
