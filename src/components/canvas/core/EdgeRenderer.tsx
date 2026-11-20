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

import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { createEdgeResolver, type ResolvedEdge, type RoutedEdge } from './routing';
import type { ViewportTransform } from './transform';
import { resolveColor } from '../types';
import type { CanvasEdge, CanvasNode } from '../types';
import { frameCanvasOptions } from '../../../lib/viewer/gpuTier';
import { MotionRaster } from './motionRaster';

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

  // Geometry is derived from (edges, nodes, router) only — not from the
  // transform — so panning and zooming reuse the same computed paths. The
  // resolver is incremental: a drag frame re-routes only edges whose endpoint
  // nodes changed, instead of every edge on the board.
  const resolverRef = useRef<ReturnType<typeof createEdgeResolver> | null>(null);
  if (!resolverRef.current) resolverRef.current = createEdgeResolver();
  const resolved = useMemo(
    () => resolverRef.current!({ edges, nodes, routerId }),
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
    const ctx = canvas.getContext('2d', frameCanvasOptions());
    if (ctx) ctxRef.current = ctx;
  }, [size.width, size.height, transform.k]);

  // --- Paint loop -----------------------------------------------------------

  /** Paint every edge in view into `ctx` for camera `t` (canvas `w x h` CSS px). */
  const drawAll = useCallback((ctx: CanvasRenderingContext2D, t: ViewportTransform, w: number, h: number) => {
    const dpr = frameRef.current.dpr;
    const k = t.k;
    const inv = 1 / k;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // Work in screen pixels; translate so world (0,0) lands under (t.x, t.y).
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * t.x, dpr * t.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.font = `${11 * inv}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // The area this paint covers (the snapshot is larger than the viewport).
    const view = { x: -t.x / k, y: -t.y / k, width: w / k, height: h / k };
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

  // While the camera moves, a dense edge layer is shown as a scaled snapshot
  // and repainted in full once it settles (see core/motionRaster).
  const rasterRef = useRef<MotionRaster | null>(null);
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    rasterRef.current ??= new MotionRaster({ contextOptions: frameCanvasOptions() });
    const s = sizeRef.current;
    rasterRef.current.frame(
      ctx,
      transformRef.current,
      Math.max(1, Math.round(s.width)),
      Math.max(1, Math.round(s.height)),
      frameRef.current.dpr,
      resolvedRef.current.length,
      drawAll,
      () => requestAnimationFrame(paint)
    );
  }, [drawAll]);

  useEffect(() => () => rasterRef.current?.dispose(), []);

  // Repaint whenever anything pixel-visible changes, coalesced to one frame.
  // Reads live values through refs, so the closure never needs re-binding.
  // Anything other than the camera changing invalidates the motion snapshot.
  const contentRef = useRef<unknown[]>([]);
  useEffect(() => {
    const content = [size.width, size.height, resolved, selectedEdgeIds, activeEdgeId, draftEdge];
    const prev = contentRef.current;
    if (draftEdge || content.some((v, i) => v !== prev[i])) rasterRef.current?.invalidate();
    contentRef.current = content;
    const raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [paint, transform, size, resolved, selectedEdgeIds, activeEdgeId, draftEdge, onEdgeClick, onEdgeContextMenu]);

  const interactive = Boolean(onEdgeClick || onEdgeContextMenu);

  // Hit paths for edges near the view. The padded rect is kept until the view
  // leaves it (or the zoom changes a lot), so a pan does not re-render the list.
  const hitRectRef = useRef<{ rect: Rect; span: number } | null>(null);
  const span = Math.max(visibleRect.width, visibleRect.height);
  let hr = hitRectRef.current;
  if (!hr || span > hr.span * 1.5 || span < hr.span / 1.5 || !containsRect(hr.rect, visibleRect)) {
    const pad = span * 0.5;
    hr = {
      rect: { x: visibleRect.x - pad, y: visibleRect.y - pad, width: visibleRect.width + pad * 2, height: visibleRect.height + pad * 2 },
      span,
    };
    hitRectRef.current = hr;
  }
  const hitRect = hr.rect;
  const hitItems = useMemo(
    () => (interactive ? resolved.filter((item) => intersects(item.route.bbox, hitRect)) : []),
    [interactive, resolved, hitRect]
  );

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
        Transparent SVG hit layer, for edges near the view only. Paths use a
        non-scaling stroke, so the grab width is a constant number of screen
        pixels at any zoom without re-rendering a path when the zoom changes;
        panning only rewrites the group transform.
      */}
      {interactive && (
        <svg
          className="canvas-edge-hits"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          shapeRendering="geometricPrecision"
        >
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            <HitPaths items={hitItems} onEdgeClick={onEdgeClick} onEdgeContextMenu={onEdgeContextMenu} />
          </g>
        </svg>
      )}
    </div>
  );
};

/** Screen-constant grab width for the invisible hit stroke. */
const HIT_WIDTH = 18;

type Rect = { x: number; y: number; width: number; height: number };

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

interface HitPathsProps {
  items: readonly ResolvedEdge[];
  onEdgeClick?: (edgeId: string) => void;
  onEdgeContextMenu?: (edgeId: string, e: React.MouseEvent) => void;
}

/** Memoised so a pan (new transform, same items) skips every path. */
const HitPaths = memo(function HitPaths({ items, onEdgeClick, onEdgeContextMenu }: HitPathsProps) {
  return (
    <>
      {items.map((item) => (
        <path
          key={item.id}
          d={item.route.path}
          stroke="transparent"
          strokeWidth={HIT_WIDTH}
          vectorEffect="non-scaling-stroke"
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
    </>
  );
});

/**
 * Parsed paths, per route object. Routes are cached by the incremental
 * resolver, so an unchanged edge keeps its Path2D across frames instead of
 * re-parsing its SVG string on every paint.
 */
const pathCache = new WeakMap<RoutedEdge, Path2D>();
function pathFor(route: RoutedEdge): Path2D {
  let p = pathCache.get(route);
  if (!p) {
    p = new Path2D(route.path);
    pathCache.set(route, p);
  }
  return p;
}

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
  const path = pathFor(route);
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

  // Label pills are a constant screen size, so far out they only clutter (and
  // each costs a measureText). Show them from 35% zoom, or when emphasised.
  if (edge.label && (o.inv <= 1 / 0.35 || emphasised)) {
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
