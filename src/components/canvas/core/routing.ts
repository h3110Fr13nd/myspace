/**
 * Canvas core — pluggable edge routing.
 *
 * A router turns a logical connection (node A, side, node B, side) into drawable
 * geometry. Routers are pure and registered in `EDGE_ROUTERS`, so adding a new
 * routing style (orthogonal elbows, splines, waypoints) is a single object with
 * a `route()` method — no renderer or editor changes.
 *
 * Every router returns a `RoutedEdge` with the same contract:
 *   - `path`   SVG path data, usable verbatim for SVG and for Path2D in Canvas2D
 *   - `mid`    a point that provably lies ON the path (label anchor)
 *   - `endAngle` tangent angle at the target anchor (arrowhead orientation)
 */

import type { CanvasNode, CanvasPortSide } from '../types';
import {
  anchorFor,
  curveBetween,
  curveBBox,
  cubicAt,
  cubicDistance,
  facingSides,
  flattenCubic,
  nodeRect,
  orthoPath,
  tangentAt,
  type Anchor,
  type CubicCurve,
  type PortSide,
} from './geometry';
import type { Point, Rect } from './transform';

export type { PortSide };

export interface RouteContext {
  fromNode: CanvasNode;
  toNode: CanvasNode;
  fromSide: PortSide;
  toSide: PortSide;
  /** Index of this edge among those sharing the same (from, fromSide) pair. */
  fanIndex: number;
  /** How many edges share the (from, fromSide) pair. */
  fanTotal: number;
  /** Whether the route is currently being dragged (dashed preview). */
  isDraft?: boolean;
}

export interface RoutedEdge {
  path: string;
  /** Point guaranteed to lie on the path — the correct label anchor. */
  mid: Point;
  /** Tangent angle (rad) arriving at the target anchor. */
  endAngle: number;
  /** Tangent angle (rad) leaving the source anchor. */
  startAngle: number;
  /** Conservative bounds for culling. */
  bbox: Rect;
  from: Anchor;
  to: Anchor;
  /** Flattened polyline (cached) for hit testing. */
  points: Point[];
  /** Present when the route is a bezier; enables exact distance queries. */
  curve?: CubicCurve;
}

export interface EdgeRouter {
  id: string;
  label: string;
  route(ctx: RouteContext): RoutedEdge;
}

/** Spreads parallel edges leaving the same port so they stay individually grabbable. */
function fanOffset(ctx: RouteContext, anchor: Anchor): number {
  if (ctx.fanTotal <= 1) return 0;
  const spread = 22;
  const centered = ctx.fanIndex - (ctx.fanTotal - 1) / 2;
  // Offset perpendicular to the exit normal.
  return -anchor.ny * centered * spread + anchor.nx * centered * spread;
}

function offsetAnchor(a: Anchor, amount: number): Anchor {
  if (amount === 0) return a;
  const len = Math.hypot(a.nx, a.ny) || 1;
  return {
    x: a.x + (a.ny / len) * amount * -1,
    y: a.y + (a.nx / len) * amount,
    nx: a.nx,
    ny: a.ny,
  };
}

function bezierRouter(ctx: RouteContext): RoutedEdge {
  const rawFrom = anchorFor(ctx.fromNode, ctx.fromSide);
  const rawTo = anchorFor(ctx.toNode, ctx.toSide);
  const from = offsetAnchor(rawFrom, fanOffset(ctx, rawFrom));
  const to = rawTo;
  const curve = curveBetween(from, to);

  return {
    path: `M ${curve.p0.x} ${curve.p0.y} C ${curve.c1.x} ${curve.c1.y}, ${curve.c2.x} ${curve.c2.y}, ${curve.p3.x} ${curve.p3.y}`,
    // The true point on the curve at t = 0.5. Using the chord midpoint here is
    // what made labels drift off their edges.
    mid: cubicAt(curve, 0.5),
    endAngle: tangentAt(curve, 1),
    startAngle: tangentAt(curve, 0),
    bbox: curveBBox(curve, 32),
    from,
    to,
    points: flattenCubic(curve),
    curve,
  };
}

/**
 * Manhattan router: horizontal-then-vertical elbow with a rounded corner.
 * Reads better for dense, layered boards where beziers become visual noise.
 */
function orthogonalRouter(ctx: RouteContext): RoutedEdge {
  const fromAnchor = anchorFor(ctx.fromNode, ctx.fromSide);
  const from = offsetAnchor(fromAnchor, fanOffset(ctx, fromAnchor));
  const to = anchorFor(ctx.toNode, ctx.toSide);

  const horizontal = from.nx !== 0;
  let pts: Point[];
  if (horizontal) {
    const midX = (from.x + to.x) / 2;
    pts = [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
  } else {
    const midY = (from.y + to.y) / 2;
    pts = [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to];
  }

  return {
    path: orthoPath(pts),
    mid: pts[Math.floor(pts.length / 2)],
    endAngle: horizontal ? 0 : Math.PI / 2,
    startAngle: horizontal ? 0 : Math.PI / 2,
    bbox: boundsOf(pts, 16),
    from,
    to,
    points: pts,
  };
}

function boundsOf(points: readonly Point[], pad: number): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/**
 * Registry. Extend by adding an entry — the editor surfaces these in a picker,
 * and any router implementing `EdgeRouter` works with every renderer.
 */
export const EDGE_ROUTERS: Readonly<Record<string, EdgeRouter>> = Object.freeze({
  bezier: { id: 'bezier', label: 'Curved', route: bezierRouter },
  orthogonal: { id: 'orthogonal', label: 'Elbow', route: orthogonalRouter },
});

export const DEFAULT_ROUTER_ID = 'bezier';

export function getEdgeRouter(id?: string): EdgeRouter {
  return (id && EDGE_ROUTERS[id]) || EDGE_ROUTERS[DEFAULT_ROUTER_ID];
}

export function listEdgeRouters(): EdgeRouter[] {
  return Object.values(EDGE_ROUTERS);
}

// ---------------------------------------------------------------------------
// Batch resolution
// ---------------------------------------------------------------------------

export interface ResolvedEdge {
  id: string;
  edge: import('../types').CanvasEdge;
  route: RoutedEdge;
  /** Sides actually used, after defaults were resolved. */
  fromSide: PortSide;
  toSide: PortSide;
  fromNode: CanvasNode;
  toNode: CanvasNode;
}

export interface ResolveEdgesInput {
  edges: readonly import('../types').CanvasEdge[];
  nodes: readonly CanvasNode[];
  routerId?: string;
}

/**
 * Resolve every edge to drawable geometry in one pass, dropping edges whose
 * endpoints no longer exist and computing fan indices so parallel edges fan out.
 */
/**
 * A detached end has no node behind it, but the router contract is defined in
 * terms of nodes. Rather than teach every router about a second case, we hand
 * it a zero-size stand-in node centred on the free position. Anchors then
 * resolve to exactly that point, and the side is picked to face the other end
 * so the curve leaves and arrives pointing the right way.
 */
function detachedStub(id: string, x: number, y: number, toward: Point): CanvasNode {
  const dx = toward.x - x;
  const dy = toward.y - y;
  // Tie-break on exact axis alignment so a straight horizontal/vertical drop
  // does not flip between 'left' and 'top' between frames.
  const side: PortSide =
    Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
  return {
    id,
    type: 'text',
    x: x - 0.5,
    y: y - 0.5,
    width: 1,
    height: 1,
    _detachedSide: side,
  } as CanvasNode & { _detachedSide: PortSide };
}

function stubSide(node: CanvasNode, fallback: PortSide): PortSide {
  return (node as CanvasNode & { _detachedSide?: PortSide })._detachedSide ?? fallback;
}

/**
 * Resolve every edge into drawable geometry.
 *
 * Detached ends are handled by `resolveEdgeEnd`, which substitutes a stand-in
 * node; an end that is both detached and missing its free coordinates cannot be
 * placed, so its edge is skipped rather than drawn from a guessed position.
 *
 * `resolveEdgeEnd` rebuilds a `Map` per call, which would be wasteful inside this
 * loop, so the node lookup is hoisted and passed in.
 */
export function resolveEdges({ edges, nodes, routerId }: ResolveEdgesInput): ResolvedEdge[] {
  const byId = new Map<string, CanvasNode>();
  for (const n of nodes) byId.set(n.id, n);

  const endsOf = (e: import('../types').CanvasEdge) => {
    const from = resolveEdgeEndIn(byId, e, 'from');
    const to = resolveEdgeEndIn(byId, e, 'to');
    if (!from || !to) return null;
    return { from, to };
  };

  // Count how many edges leave each (node, side) so the router can fan them.
  const fanCount = new Map<string, number>();
  for (const e of edges) {
    const ends = endsOf(e);
    if (!ends) continue;
    const key = `${ends.from.node.id}:${ends.from.side}`;
    fanCount.set(key, (fanCount.get(key) ?? 0) + 1);
  }
  const fanSeen = new Map<string, number>();

  const router = getEdgeRouter(routerId);
  const out: ResolvedEdge[] = [];

  for (const e of edges) {
    const ends = endsOf(e);
    if (!ends) continue;
    const { from, to } = ends;

    const key = `${from.node.id}:${from.side}`;
    const fanIndex = fanSeen.get(key) ?? 0;
    fanSeen.set(key, fanIndex + 1);

    out.push({
      id: e.id,
      edge: e,
      route: router.route({
        fromNode: from.node,
        toNode: to.node,
        fromSide: from.side,
        toSide: to.side,
        fanIndex,
        fanTotal: fanCount.get(key) ?? 1,
      }),
      fromSide: from.side,
      toSide: to.side,
      fromNode: from.node,
      toNode: to.node,
    });
  }

  return out;
}

/** Explicit sides win; otherwise pick the pair that faces each other. */
export function resolveSides(
  edge: Pick<import('../types').CanvasEdge, 'fromSide' | 'toSide'>,
  fromNode: CanvasNode,
  toNode: CanvasNode
): { from: CanvasPortSide; to: CanvasPortSide } {
  const facing = facingSides(fromNode, toNode);
  return { from: edge.fromSide ?? facing.from, to: edge.toSide ?? facing.to };
}

export interface ResolvedEdgeEnd {
  /** World position of the end. */
  point: Point;
  side: PortSide;
  /** Node the end belongs to, or `''` while it is detached. */
  nodeId: string;
  /** True when the end is floating free of any node. */
  detached: boolean;
  /** The node standing in for a detached end, so callers can anchor geometry. */
  node: CanvasNode;
}

/**
 * Resolve one end of an edge to a world position, node and side.
 *
 * This is the single place that knows how to locate an edge end, because three
 * different call sites need it and all of them must agree: the renderer (where
 * does the curve start), the endpoint handles (where is the grabbable dot), and
 * the connection drag (where does the rubber band anchor). A detached end falls
 * back to its stored free coordinates via a stand-in node, so all three keep
 * working on an edge that is currently half-unplugged.
 */
export function resolveEdgeEnd(
  edge: import('../types').CanvasEdge,
  end: 'from' | 'to',
  nodes: readonly CanvasNode[]
): ResolvedEdgeEnd | null {
  const byId = new Map<string, CanvasNode>();
  for (const n of nodes) byId.set(n.id, n);
  return resolveEdgeEndIn(byId, edge, end);
}

/** `resolveEdgeEnd` against a prebuilt lookup, for callers resolving many ends. */
function resolveEdgeEndIn(
  byId: ReadonlyMap<string, CanvasNode>,
  edge: import('../types').CanvasEdge,
  end: 'from' | 'to'
): ResolvedEdgeEnd | null {
  const nodeId = end === 'from' ? edge.fromNode : edge.toNode;
  const freeX = end === 'from' ? edge.fromX : edge.toX;
  const freeY = end === 'from' ? edge.fromY : edge.toY;

  const real = nodeId ? byId.get(nodeId) : undefined;
  if (real) {
    const side =
      (end === 'from' ? edge.fromSide : edge.toSide) ?? (end === 'from' ? 'right' : 'left');
    const a = anchorFor(real, side);
    return { point: { x: a.x, y: a.y }, side, nodeId, detached: false, node: real };
  }

  // Detached: placeable only if it carries a free position.
  if (freeX === undefined || freeY === undefined) return null;

  const otherId = end === 'from' ? edge.toNode : edge.fromNode;
  const other = otherId ? byId.get(otherId) : undefined;
  const otherFreeX = end === 'from' ? edge.toX : edge.fromX;
  const otherFreeY = end === 'from' ? edge.toY : edge.fromY;
  const toward: Point = other
    ? { x: other.x + other.width / 2, y: other.y + other.height / 2 }
    : otherFreeX !== undefined && otherFreeY !== undefined
      ? { x: otherFreeX, y: otherFreeY }
      : { x: freeX + 1, y: freeY };

  const stub = detachedStub(`${nodeId || 'detached'}-${end}`, freeX, freeY, toward);
  const side = stubSide(stub, end === 'from' ? 'right' : 'left');
  const a = anchorFor(stub, side);
  return { point: { x: a.x, y: a.y }, side, nodeId, detached: true, node: stub };
}

/** Distance from a world point to a resolved edge, for hit testing. */
export function distanceToEdge(resolved: ResolvedEdge, p: Point): number {
  const { curve, points } = resolved.route;
  if (curve) return cubicDistance(curve, p).dist;
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * u), p.y - (a.y + dy * u)));
  }
  return best;
}

export { nodeRect };
