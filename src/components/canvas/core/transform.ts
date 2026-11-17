/**
 * Canvas core — viewport transform algebra.
 *
 * The transform maps world (canvas/document) space to screen (viewport) space:
 *
 *   screen = world * k + (x, y)
 *   world  = (screen - (x, y)) / k
 *
 * Every function here is pure and allocation-cheap: these run inside the
 * pointer/wheel hot path, potentially 120+ times per second.
 */

import { ZOOM } from './constants';

export interface ViewportTransform {
  x: number;
  y: number;
  k: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export const IDENTITY: ViewportTransform = Object.freeze({ x: 0, y: 0, k: 1 });

export function makeTransform(x = 0, y = 0, k = 1): ViewportTransform {
  return { x, y, k };
}

export function transformsEqual(a: ViewportTransform, b: ViewportTransform, epsilon = 0.0001): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.k - b.k) < epsilon
  );
}

export function clampScale(k: number, min: number = ZOOM.min, max: number = ZOOM.max): number {
  return k < min ? min : k > max ? max : k;
}

/** Serialise to a CSS `transform` value. Uses translate3d to stay on the compositor. */
export function cssTransform(t: ViewportTransform): string {
  return `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.k})`;
}

/** World point -> screen point. `p` must be relative to the viewport's top-left. */
export function toScreen(t: ViewportTransform, p: Point): Point {
  return { x: p.x * t.k + t.x, y: p.y * t.k + t.y };
}

/** Screen point (viewport-relative) -> world point. */
export function toWorld(t: ViewportTransform, p: Point): Point {
  return { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
}

/** Screen-space delta -> world-space delta (translation only, no origin shift). */
export function screenDeltaToWorld(t: ViewportTransform, dx: number, dy: number): Point {
  return { x: dx / t.k, y: dy / t.k };
}

export function panBy(t: ViewportTransform, dx: number, dy: number): ViewportTransform {
  return { x: t.x + dx, y: t.y + dy, k: t.k };
}

/**
 * Zoom about a fixed screen point (cursor-anchored / focal-point zoom).
 * The world point under `anchor` stays pinned under `anchor` across the zoom.
 */
export function zoomAt(
  t: ViewportTransform,
  anchor: Point,
  nextK: number,
  min: number = ZOOM.min,
  max: number = ZOOM.max
): ViewportTransform {
  const k = clampScale(nextK, min, max);
  if (k === t.k) return t;
  return {
    k,
    x: anchor.x - ((anchor.x - t.x) / t.k) * k,
    y: anchor.y - ((anchor.y - t.y) / t.k) * k,
  };
}

export function zoomBy(
  t: ViewportTransform,
  factor: number,
  anchor: Point,
  min?: number,
  max?: number
): ViewportTransform {
  return zoomAt(t, anchor, t.k * factor, min, max);
}

/** The world-space rectangle currently visible inside a `view`-sized viewport. */
export function visibleRect(t: ViewportTransform, view: Size): Rect {
  return {
    x: -t.x / t.k,
    y: -t.y / t.k,
    width: view.width / t.k,
    height: view.height / t.k,
  };
}

/** Screen-space rectangle currently visible (inverse of `visibleRect`). */
export function visibleScreenRect(t: ViewportTransform, view: Size): Rect {
  return { x: t.x, y: t.y, width: view.width, height: view.height };
}

export interface FitOptions {
  padding?: number;
  min?: number;
  max?: number;
  /** Cap the upscale so "fit" never zooms past 1:1 on tiny boards. */
  maxUpscale?: number;
}

/**
 * Compute the transform that frames `content` inside `view`, centred, with padding.
 * Returns the current transform unchanged when there is nothing to frame.
 */
export function fitTransform(
  t: ViewportTransform,
  content: Rect,
  view: Size,
  options: FitOptions = {}
): ViewportTransform {
  const { padding = 48, min = ZOOM.min, max = ZOOM.max, maxUpscale = 1 } = options;

  const w = Math.max(content.width, 1);
  const h = Math.max(content.height, 1);
  const innerW = Math.max(view.width - padding * 2, 1);
  const innerH = Math.max(view.height - padding * 2, 1);

  const k = clampScale(Math.min(innerW / w, innerH / h, maxUpscale), min, max);

  return {
    k,
    x: (view.width - w * k) / 2 - content.x * k,
    y: (view.height - h * k) / 2 - content.y * k,
  };
}

/** Centre a world-space point in the viewport, optionally at a given zoom. */
export function centerOn(t: ViewportTransform, point: Point, view: Size, k = t.k): ViewportTransform {
  return { k, x: view.width / 2 - point.x * k, y: view.height / 2 - point.y * k };
}

/** Union of a list of rects, or `null` when the list is empty. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/**
 * True when `inner` lies entirely within `outer`, edges included.
 *
 * Deliberately typed `(outer: Rect, inner: Rect)` rather than reusing
 * `rectContains`, which takes a `Point`. Passing a `Rect` where a `Point` is
 * expected used to compile — a `Rect` structurally satisfies `Point`, and the
 * extra `width`/`height` were silently ignored. That turned "is this node in
 * this group" into "is this node's *top-left corner* in this group", which
 * dragged every overlapping node along with the group. Distinct signatures make
 * that mistake a type error instead of a silent one.
 */
export function rectFullyContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Fraction of `inner` that lies within `outer`; 1 when fully contained. */
export function rectOverlapRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const area = a.width * a.height;
  return area <= 0 ? 0 : (w * h) / area;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}
