/**
 * Canvas core — pure geometry: rects, ports, bezier edges, hit testing.
 *
 * Nothing here touches React or the DOM, so every routine is unit-testable and
 * reusable by any renderer (Canvas2D, SVG, hit layers, exporters).
 */

import {
  EDGE_CURVATURE,
  EDGE_MAX_HANDLE,
  EDGE_MIN_HANDLE,
  PORT_SNAP_RADIUS,
} from './constants';
import type { CanvasNode, CanvasPortSide } from '../types';
import type { Point, Rect } from './transform';
import { rectContains, rectFullyContains, rectIntersects } from './transform';

export type { Point, Rect };
export type PortSide = CanvasPortSide;

/** The four cardinal connection points, in clockwise DOM order. */
export const PORTS: readonly PortSide[] = Object.freeze(['top', 'right', 'bottom', 'left'] as const);

export const OPPOSITE_PORT: Readonly<Record<PortSide, PortSide>> = Object.freeze({
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
});

export function nextPort(side: PortSide): PortSide {
  const i = PORTS.indexOf(side);
  return PORTS[(i + 1) % PORTS.length];
}

/** A point on a node's perimeter plus the outward unit normal. */
export interface Anchor extends Point {
  /** Outward unit normal (direction the edge leaves/enters the node). */
  nx: number;
  ny: number;
}

export function nodeRect(node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

export function nodeCenter(node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

/** Anchor for an explicit side. */
export function anchorFor(
  node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>,
  side: PortSide,
  /**
   * Where along the side, 0..1 (left→right for top/bottom, top→bottom for
   * left/right). 0.5 — the side's midpoint — is the classic port.
   */
  t = 0.5
): Anchor {
  switch (side) {
    case 'top':
      return { x: node.x + node.width * t, y: node.y, nx: 0, ny: -1 };
    case 'bottom':
      return { x: node.x + node.width * t, y: node.y + node.height, nx: 0, ny: 1 };
    case 'left':
      return { x: node.x, y: node.y + node.height * t, nx: -1, ny: 0 };
    case 'right':
    default:
      return { x: node.x + node.width, y: node.y + node.height * t, nx: 1, ny: 0 };
  }
}

/** Within this distance of a side's midpoint (as a fraction of the side), snap to it. */
export const ANCHOR_CENTER_SNAP = 0.08;

/**
 * The border point nearest to `p`, Excalidraw-style binding: an edge can attach
 * anywhere on a node's outline, not only at the four midpoints. Returns the
 * side and the position along it (`t`, 0..1); `t` is `undefined` when it snaps
 * to the midpoint, so classic edges stay plain JSON Canvas.
 */
export function borderAnchorForPoint(
  node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>,
  p: Point
): { side: PortSide; t: number | undefined } {
  const cx = Math.min(node.x + node.width, Math.max(node.x, p.x));
  const cy = Math.min(node.y + node.height, Math.max(node.y, p.y));
  const dists: Array<[PortSide, number]> = [
    ['top', Math.abs(cy - node.y)],
    ['bottom', Math.abs(node.y + node.height - cy)],
    ['left', Math.abs(cx - node.x)],
    ['right', Math.abs(node.x + node.width - cx)],
  ];
  // Outside the box the clamped point already lies on the border; inside, the
  // nearest side wins.
  dists.sort((a, b) => a[1] - b[1]);
  const side = dists[0][0];
  const raw =
    side === 'top' || side === 'bottom'
      ? (cx - node.x) / Math.max(1e-9, node.width)
      : (cy - node.y) / Math.max(1e-9, node.height);
  const t = Math.min(1, Math.max(0, raw));
  return { side, t: Math.abs(t - 0.5) < ANCHOR_CENTER_SNAP ? undefined : +t.toFixed(4) };
}

/**
 * Pick the side pair that best faces `to` from `from`, Figma-style:
 * the dominant axis wins, and the sides are chosen so they point at each other.
 */
export function facingSides(
  from: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>,
  to: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>
): { from: PortSide; to: PortSide } {
  const fc = nodeCenter(from);
  const tc = nodeCenter(to);
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

/** Nearest port to `p`, within `maxDist` world units. `null` when nothing is close enough. */
export function nearestPort(
  node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>,
  p: Point,
  maxDist = PORT_SNAP_RADIUS
): { side: PortSide; dist: number; point: Point } | null {
  let best: { side: PortSide; dist: number; point: Point } | null = null;
  for (const side of PORTS) {
    const a = anchorFor(node, side);
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d <= maxDist && (!best || d < best.dist)) {
      best = { side, dist: d, point: { x: a.x, y: a.y } };
    }
  }
  return best;
}

/**
 * Best side to attach an edge to when the user drops anywhere on (or near) a node.
 * Returns `null` when `p` is nowhere near the node.
 */
export function bestPortForPoint(
  node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>,
  p: Point,
  tolerance = PORT_SNAP_RADIUS
): PortSide | null {
  const rect = nodeRect(node);
  const inside = rectContains(rect, p);
  if (!inside) {
    // Outside: still allow a drop if the pointer is within tolerance of the perimeter.
    const near = nearestPort(node, p, tolerance);
    return near ? near.side : null;
  }
  // Inside: pick the side whose inward distance is smallest, i.e. the nearest edge.
  const dists: Array<[PortSide, number]> = [
    ['top', p.y - rect.y],
    ['bottom', rect.y + rect.height - p.y],
    ['left', p.x - rect.x],
    ['right', rect.x + rect.width - p.x],
  ];
  dists.sort((a, b) => a[1] - b[1]);
  return dists[0][0];
}

// ---------------------------------------------------------------------------
// Bezier edges
// ---------------------------------------------------------------------------

export interface CubicCurve {
  p0: Point;
  c1: Point;
  c2: Point;
  p3: Point;
}

/** Point on a cubic bezier at parameter `t` in [0, 1]. */
export function cubicAt(c: CubicCurve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y,
  };
}

/**
 * Handle length for a bezier joining two anchors.
 * Scales with the gap (so short links stay tight and long links stay readable)
 * and is capped so back-to-back nodes don't produce absurd loops.
 */
export function handleLength(a: Anchor, b: Anchor): number {
  const gap = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.min(Math.max(gap * EDGE_CURVATURE, EDGE_MIN_HANDLE), EDGE_MAX_HANDLE);
}

/** Build the cubic curve joining two anchors, using their outward normals. */
export function curveBetween(a: Anchor, b: Anchor, handle = handleLength(a, b)): CubicCurve {
  return {
    p0: { x: a.x, y: a.y },
    c1: { x: a.x + a.nx * handle, y: a.y + a.ny * handle },
    c2: { x: b.x + b.nx * handle, y: b.y + b.ny * handle },
    p3: { x: b.x, y: b.y },
  };
}

/** Cheap, conservative bounds of a cubic (control-point hull) inflated by stroke width. */
export function curveBBox(c: CubicCurve, pad = 0): Rect {
  const minX = Math.min(c.p0.x, c.c1.x, c.c2.x, c.p3.x) - pad;
  const minY = Math.min(c.p0.y, c.c1.y, c.c2.y, c.p3.y) - pad;
  const maxX = Math.max(c.p0.x, c.c1.x, c.c2.x, c.p3.x) + pad;
  const maxY = Math.max(c.p0.y, c.c1.y, c.c2.y, c.p3.y) + pad;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Tangent angle (radians) at `t`, used to orient arrowheads. */
export function tangentAt(c: CubicCurve, t: number): number {
  const u = 1 - t;
  const dx = 3 * u * u * (c.c1.x - c.p0.x) + 6 * u * t * (c.c2.x - c.c1.x) + 3 * t * t * (c.p3.x - c.c2.x);
  const dy = 3 * u * u * (c.c1.y - c.p0.y) + 6 * u * t * (c.c2.y - c.c1.y) + 3 * t * t * (c.p3.y - c.c2.y);
  return Math.atan2(dy, dx);
}

// ---------------------------------------------------------------------------
// Path serialisation + hit testing
// ---------------------------------------------------------------------------

export function cubicPath(c: CubicCurve): string {
  return `M ${c.p0.x} ${c.p0.y} C ${c.c1.x} ${c.c1.y}, ${c.c2.x} ${c.c2.y}, ${c.p3.x} ${c.p3.y}`;
}

export function orthoPath(points: readonly Point[], radius = 12): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0.5) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const a = lerpToward(cur, prev, r);
    const b = lerpToward(cur, next, r);
    d += ` L ${a.x} ${a.y} Q ${cur.x} ${cur.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function lerpToward(from: Point, to: Point, dist: number): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const t = Math.min(dist / len, 1);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Distance from `p` to a polyline, plus the parameter along the flattened curve. */
export function polylineDistance(points: readonly Point[], p: Point): { dist: number; t: number } {
  let bestDist = Infinity;
  let bestT = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const denom = segLen * segLen || 1;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / denom));
    const cx = a.x + (b.x - a.x) * u;
    const cy = a.y + (b.y - a.y) * u;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestDist) {
      bestDist = d;
      bestT = (i + u) / (points.length - 1);
    }
  }
  return { dist: bestDist, t: bestT };
}

/** Flatten a cubic into `segments + 1` points for hit testing. */
export function flattenCubic(c: CubicCurve, segments = 24): Point[] {
  const out: Point[] = new Array(segments + 1);
  for (let i = 0; i <= segments; i++) out[i] = cubicAt(c, i / segments);
  return out;
}

/** Distance from `p` to a cubic, with the curve parameter of the closest point. */
export function cubicDistance(c: CubicCurve, p: Point): { dist: number; t: number } {
  // Coarse scan then refine — accurate to well under a pixel at typical zooms
  // while staying allocation-light and dependency-free.
  const COARSE = 20;
  let bestT = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= COARSE; i++) {
    const t = i / COARSE;
    const q = cubicAt(c, t);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
  }
  let step = 1 / COARSE;
  for (let pass = 0; pass < 3; pass++) {
    step /= 4;
    for (const t of [bestT - step, bestT + step]) {
      if (t < 0 || t > 1) continue;
      const q = cubicAt(c, t);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bestDist) {
        bestDist = d;
        bestT = t;
      }
    }
  }
  return { dist: bestDist, t: bestT };
}

export function pointOnNodeBoundary(node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>, p: Point): Point {
  const r = nodeRect(node);
  if (p.y < r.y) return { x: clamp(p.x, r.x, r.x + r.width), y: r.y };
  if (p.y > r.y + r.height) return { x: clamp(p.x, r.x, r.x + r.width), y: r.y + r.height };
  if (p.x < r.x) return { x: r.x, y: clamp(p.y, r.y, r.y + r.height) };
  if (p.x > r.x + r.width) return { x: r.x + r.width, y: clamp(p.y, r.y, r.y + r.height) };
  return { x: p.x, y: p.y };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * True when `child` sits inside the `group` node's rect. Groups are plain
 * rectangular nodes in this model, so containment is the whole test.
 */
/**
 * True when `child`'s rectangle lies entirely inside `group`'s.
 *
 * Full containment, not "top-left corner inside" and not "centre inside" — both
 * of those were shipped at some point and disagreed with each other and with
 * what the UI told the user. Groups that merely overlap are not related.
 *
 * A group is never a member of a group here; nesting is expressed by
 * `parentId` in `core/grouping`, not by geometry.
 */
export function isNodeInGroup(
  child: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height' | 'type'>,
  group: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>
): boolean {
  if (child.type === 'group') return false;
  return rectFullyContains(nodeRect(group), nodeRect(child));
}

export { rectContains, rectFullyContains, rectIntersects };
