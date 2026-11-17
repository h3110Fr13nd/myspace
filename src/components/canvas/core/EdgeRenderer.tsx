/**
 * Canvas core — edge renderer.
 *
 * Rendering model
 * ---------------
 * One `<canvas>` the size of the **viewport**, positioned in screen space as a
 * sibling *behind* the node layer. This is how Figma and Miro do it, and it
 * fixes three problems at once:
 *
 *  1. **No clipping.** A content-sized canvas inside the transform layer gets
 *     cropped the moment content extends past its own bounding box, which is
 *     why edges used to vanish when a node was far from the origin. A
 *     viewport-sized canvas has no such edge case.
 *  2. **Constant memory.** The backing store is `viewport × DPR`, allocated
 *     once per resize instead of being reallocated (and re-zeroed) on every
 *     node move.
 *  3. **Correct scaling.** Strokes, arrowheads and label pills are divided by
 *     zoom so they stay visually constant, the way real diagram tools behave.
 *
 * Labels are anchored to `route.mid` — a point that provably lies on the drawn
 * curve — rather than to the chord midpoint.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { resolveEdges, type ResolvedEdge } from './routing';
import type { ViewportTransform } from './transform';
import { resolveColor } from '../types';
import type { CanvasEdge, CanvasNode } from '../types';

export interface DraftEdgeSpec {
  /** SVG path data in world space. */
  path: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Set when the pointer is snapped to a valid target. */
  isSnapped: boolean;
}

export interface EdgeRendererProps {
  edges: readonly CanvasEdge[];
  nodes: readonly CanvasNode[];
  transform: ViewportTransform;
  /** Viewport size in CSS px. */
  size: { width: number; height: number };
  /** World rect currently visible; edges outside are skipped. */
  visibleRect: { x: number; y: number; width: number; height: number };
  selectedEdgeIds?: ReadonlySet<string>;
  /** Edge the user is currently re-pointing, drawn emphasised. */
  activeEdgeId?: string | null;
  routerId?: string;
  draftEdge?: DraftEdgeSpec | null;
  onEdgeClick?: (edgeId: string) => void;
  onEdgeContextMenu?: (edgeId: string, e: React.MouseEvent) => void;
  /** Called when the rendered geometry is ready, for the DOM hit layer. */
  onGeometryChange?: (resolved: ResolvedEdge[]) => void;
}

const SELECT_COLOR = '#38bdf8';

interface Frame {
  dpr: number;
  k: number;
}

export const EdgeRenderer: React.FC<EdgeRendererProps> = ({
  edges,
  nodes,
  transform,
  size,
  visibleRect,
  selectedEdgeIds,
  activeEdgeId,
  routerId,
  draftEdge,
  onEdgeClick,
  onEdgeContextMenu,
  onGeometryChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameRef = useRef<Frame>({ dpr: 1, k: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Geometry is derived from (edges, nodes, router, selection) only — not from
  // the transform — so panning and zooming reuse the same computed paths.
  const resolved = useMemo(
    () => resolveEdges({ edges, nodes, routerId }),
    [edges, nodes, routerId]
  );

  // Publishing geometry is a side effect of a render, not of the paint loop.
  const publish = onGeometryChange;
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  useEffect(() => {
    publish?.(resolved);
  }, [publish, resolved]);

  const selected = selectedEdgeIds;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const activeRef = useRef(activeEdgeId);
  activeRef.current = activeEdgeId;
  const draftRef = useRef(draftEdge);
  draftRef.current = draftEdge;
  const visibleRef = useRef(visibleRect);
  visibleRef.current = visibleRect;

  const sizeRef = useRef(size);
  sizeRef.current = size;

  // --- Backing store management (resize only, not per frame) ----------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(size.width));
    const h = Math.max(1, Math.round(size.height));
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    frameRef.current = { dpr, k: transform.k };
    const ctx = canvas.getContext('2d');
    if (ctx) ctxRef.current = ctx;
  }, [size.width, size.height, transform.k]);

  // --- Paint loop -----------------------------------------------------------

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const dpr = frameRef.current.dpr;
    const t = transformRef.current;
    const k = t.k;
    const inv = 1 / k;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Work in screen pixels; translate so world (0,0) lands under (t.x, t.y).
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * t.x, dpr * t.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.font = `${11 * inv}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const view = visibleRef.current;
    const sel = selectedRef.current;

    for (const item of resolvedRef.current) {
      if (!intersects(item.route.bbox, view)) continue;
      drawEdge(ctx, item, {
        color: resolveColor(item.edge.color, '#06b6d4'),
        isSelected: sel?.has(item.id) ?? false,
        isActive: activeRef.current === item.id,
        inv,
      });
    }

    const draft = draftRef.current;
    if (draft) {
      ctx.save();
      ctx.strokeStyle = draft.isSnapped ? SELECT_COLOR : '#06b6d4';
      ctx.lineWidth = (draft.isSnapped ? 3 : 2.5) * inv;
      ctx.setLineDash([6 * inv, 5 * inv]);
      ctx.stroke(new Path2D(draft.path));
      ctx.restore();
    }
  }, []);

  // Repaint whenever anything pixel-visible changes, coalesced to one frame.
  // Reads live values through refs, so the closure never needs re-binding.
  useEffect(() => {
    const raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [paint, transform, size, resolved, selectedEdgeIds, activeEdgeId, draftEdge, onEdgeClick, onEdgeContextMenu]);

  const interactive = Boolean(onEdgeClick || onEdgeContextMenu);

  return (
    <div
      className="canvas-edge-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
        overflow: 'hidden',
        contain: 'strict',
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          display: 'block',
        }}
      />

      {/*
        Transparent SVG hit layer. Stroke width is divided by zoom so the grab
        area is a constant number of *screen* pixels at any zoom level — the
        old fixed 18 world units collapsed to 4.5px at 25% zoom.
      */}
      {interactive && (
        <svg
          className="canvas-edge-hits"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          shapeRendering="geometricPrecision"
        >
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {resolved.map((item) => (
              <path
                key={item.id}
                d={item.route.path}
                stroke="transparent"
                strokeWidth={HIT_WIDTH / Math.max(transform.k, 0.01)}
                fill="none"
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdgeClick?.(item.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEdgeContextMenu?.(item.id, e);
                }}
              />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
};

/** Screen-constant grab width for the invisible hit stroke. */
const HIT_WIDTH = 18;

function intersects(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

interface DrawOptions {
  color: string;
  isSelected: boolean;
  isActive: boolean;
  /** 1 / zoom — convert screen-constant sizes into world units. */
  inv: number;
}

function drawEdge(ctx: CanvasRenderingContext2D, item: ResolvedEdge, o: DrawOptions) {
  const { route, edge } = item;
  const path = new Path2D(route.path);
  const emphasised = o.isSelected || o.isActive;

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = emphasised ? SELECT_COLOR : o.color;
  ctx.lineWidth = (emphasised ? 3.5 : 2) * o.inv;
  if (!emphasised) ctx.globalAlpha = 0.85;
  if (edge.label) ctx.setLineDash([6 * o.inv, 4 * o.inv]);
  ctx.stroke(path);
  ctx.restore();

  if (edge.toEnd !== 'none') {
    ctx.save();
    const len = (emphasised ? 10 : 9) * o.inv;
    const a = route.endAngle;
    ctx.fillStyle = emphasised ? SELECT_COLOR : o.color;
    ctx.beginPath();
    ctx.moveTo(route.to.x, route.to.y);
    ctx.lineTo(
      route.to.x - len * Math.cos(a - Math.PI / 7),
      route.to.y - len * Math.sin(a - Math.PI / 7)
    );
    ctx.lineTo(
      route.to.x - len * Math.cos(a + Math.PI / 7),
      route.to.y - len * Math.sin(a + Math.PI / 7)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  if (edge.label) {
    const text = edge.label.length > 26 ? `${edge.label.slice(0, 24)}…` : edge.label;
    const metrics = ctx.measureText(text);
    const padX = 8 * o.inv;
    const h = 20 * o.inv;
    const w = Math.max(metrics.width + padX * 2, 48 * o.inv);
    const x = route.mid.x - w / 2;
    const y = route.mid.y - h / 2;
    const r = h / 2;

    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = o.color;
    ctx.lineWidth = (emphasised ? 2 : 1.25) * o.inv;
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(5, 8, 16, 0.94)';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, route.mid.x, route.mid.y);
    ctx.restore();
  }
}

/** `roundRect` with a manual fallback for older engines. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
