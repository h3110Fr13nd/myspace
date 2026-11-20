/**
 * Canvas core — zoomed-out node proxies drawn on a canvas instead of DOM.
 *
 * Far out, a node is a coloured rectangle a few dozen pixels wide; mounting a
 * DOM subtree (markdown, KaTeX, embeds) for each of thousands of them is what
 * made zooming out on a large board freeze. This layer paints the same
 * rectangles into one viewport-sized canvas: one fill per colour batch, titles
 * only where a box is big enough to read one.
 *
 * Interaction still works: the host hit-tests the spatial index on pointer down
 * (see CanvasEditor), and selected nodes stay mounted as DOM on top of this
 * layer so their handles remain usable.
 */
import React, { useEffect, useRef } from 'react';
import type { CanvasNode } from '../types';
import { resolveColor } from '../types';
import type { ViewportTransform } from './transform';
import { frameCanvasOptions } from '../../../lib/viewer/gpuTier';
import { MotionRaster } from './motionRaster';

export interface LodNodeLayerProps {
  nodes: readonly CanvasNode[];
  transform: ViewportTransform;
  size: { width: number; height: number };
  /** Not drawn here; the host renders these as DOM on top. */
  skip?: ReadonlySet<string>;
}

function titleOf(node: CanvasNode): string {
  return (
    node.resolvedTitle ||
    node.label ||
    node.file ||
    node.text?.split('\n')[0].replace(/^#+\s*/, '') ||
    node.id
  );
}

function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    card: v('--surface-3', 'rgba(17, 24, 39, 0.85)'),
    text: v('--text-primary', '#f9fafb'),
    groupFill: v('--surface-subtle', 'rgba(255, 255, 255, 0.04)'),
    groupStroke: v('--border-strong', 'rgba(255, 255, 255, 0.16)'),
    accent: v('--accent-cyan', '#06b6d4'),
  };
}

export const LodNodeLayer: React.FC<LodNodeLayerProps> = ({ nodes, transform, size, skip }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<ReturnType<typeof tokens> | null>(null);

  const rasterRef = useRef<MotionRaster | null>(null);
  const latest = useRef({ nodes, transform, size, skip });
  latest.current = { nodes, transform, size, skip };

  /** Paint every proxy in view into `ctx` for camera `t` (canvas `w x h` CSS px). */
  const drawAll = (ctx: CanvasRenderingContext2D, t: ViewportTransform, w: number, h: number) => {
    const { nodes: list, skip: hidden } = latest.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const palette = (paletteRef.current ??= tokens());
    const { x: tx, y: ty, k } = t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Groups first (behind), then cards batched by accent colour.
    const batches = new Map<string, number[]>();
    ctx.lineWidth = 1;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (hidden?.has(n.id)) continue;
      const sx = n.x * k + tx;
      const sy = n.y * k + ty;
      const sw = n.width * k;
      const sh = n.height * k;
      if (sx > w || sy > h || sx + sw < 0 || sy + sh < 0) continue;
      if (n.type === 'group') {
        ctx.fillStyle = palette.groupFill;
        ctx.strokeStyle = resolveColor(n.color, palette.groupStroke);
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
        continue;
      }
      const c = resolveColor(n.color, palette.accent);
      let batch = batches.get(c);
      if (!batch) batches.set(c, (batch = []));
      batch.push(i);
    }
    for (const [color, batch] of batches) {
      ctx.fillStyle = palette.card;
      ctx.beginPath();
      for (const i of batch) {
        const n = list[i];
        ctx.rect(n.x * k + tx, n.y * k + ty, Math.max(1, n.width * k), Math.max(1, n.height * k));
      }
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    // Titles where they can be read.
    if (k * 240 >= 48) {
      ctx.fillStyle = palette.text;
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (const batch of batches.values()) {
        for (const i of batch) {
          const n = list[i];
          const sw = n.width * k;
          if (sw < 48 || n.height * k < 16) continue;
          const text = titleOf(n);
          const max = Math.floor((sw - 10) / 6.2);
          ctx.fillText(
            text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text,
            n.x * k + tx + 5,
            n.y * k + ty + Math.min(12, (n.height * k) / 2)
          );
        }
      }
    }
  };

  const paint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { transform: t, size: s, nodes: list } = latest.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(s.width));
    const h = Math.max(1, Math.round(s.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      rasterRef.current?.invalidate();
    }
    const ctx = canvas.getContext('2d', frameCanvasOptions());
    if (!ctx) return;
    rasterRef.current ??= new MotionRaster({ contextOptions: frameCanvasOptions(), minItems: 800 });
    rasterRef.current.frame(ctx, t, w, h, dpr, list.length, drawAll, () => requestAnimationFrame(paint));
  };

  // New content invalidates the motion snapshot; a camera change alone reuses it.
  useEffect(() => {
    rasterRef.current?.invalidate();
  }, [nodes, skip]);

  useEffect(() => {
    const raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
    // `paint` reads everything through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, transform, size, skip]);

  useEffect(() => () => rasterRef.current?.dispose(), []);

  return (
    <canvas
      ref={canvasRef}
      className="canvas-lod-layer"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}
    />
  );
};
