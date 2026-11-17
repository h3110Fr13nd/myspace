import { expect, test } from '@playwright/test';
import {
  anchorFor,
  bestPortForPoint,
  curveBetween,
  cubicAt,
  cubicDistance,
  facingSides,
  handleLength,
  isNodeInGroup,
  nearestPort,
  nodeRect,
  orthoPath,
  pointOnNodeBoundary,
  tangentAt,
  type PortSide,
} from '../../src/components/canvas/core/geometry';
import { visibleRect, toScreen, toWorld, zoomAt, fitTransform, panBy, rectContains, rectFullyContains, rectOverlapRatio } from '../../src/components/canvas/core/transform';
import { resolveEdges } from '../../src/components/canvas/core/routing';
import { endpointPoint } from '../../src/components/canvas/core/EdgeEndpointLayer';
import { resolveEdgeEnd } from '../../src/components/canvas/core/routing';
import { edgeEndFreePoint, isEdgeEndDetached, type CanvasEdge, type CanvasNode } from '../../src/components/canvas/types';

function node(over: Partial<CanvasNode> = {}): CanvasNode {
  return { id: 'n', type: 'text', x: 0, y: 0, width: 200, height: 100, ...over };
}

function edge(over: Partial<CanvasEdge> = {}): CanvasEdge {
  return {
    id: 'e',
    fromNode: 'a',
    fromSide: 'right',
    toNode: 'b',
    toSide: 'left',
    toEnd: 'arrow',
    color: '5',
    ...over,
  };
}

test.describe('anchors and ports', () => {
  test('anchorFor places a point on the exact node edge with an outward normal', () => {
    const n = node({ x: 100, y: 200, width: 200, height: 100 });

    expect(anchorFor(n, 'left')).toEqual({ x: 100, y: 250, nx: -1, ny: 0 });
    expect(anchorFor(n, 'right')).toEqual({ x: 300, y: 250, nx: 1, ny: 0 });
    expect(anchorFor(n, 'top')).toEqual({ x: 200, y: 200, nx: 0, ny: -1 });
    expect(anchorFor(n, 'bottom')).toEqual({ x: 200, y: 300, nx: 0, ny: 1 });
  });

  test('facingSides picks the sides whose normals point at each other', () => {
    const left = node({ x: 0, y: 0 });
    const right = node({ x: 400, y: 0 });

    // Horizontal gap: right side of the left node faces the left side of the right one.
    expect(facingSides(left, right)).toEqual({ from: 'right', to: 'left' });
    // Same node: no meaningful facing, but the pair must stay distinct.
    const self = facingSides(left, left);
    expect(self.from).not.toBe(self.to);
  });

  test('nearestPort snaps to the closest port inside the snap radius, else null', () => {
    const n = node({ x: 0, y: 0, width: 200, height: 100 });
    // 30px from the right anchor: inside the 56-unit snap radius.
    const near = nearestPort(n, { x: 230, y: 50 });
    expect(near?.side).toBe('right');
    expect(near?.dist).toBeCloseTo(30, 6);

    // Far outside the radius: no port claims it, so the caller falls back to
    // "drop anywhere on the node" rather than snapping somewhere arbitrary.
    expect(nearestPort(n, { x: 500, y: 50 })).toBeNull();
  });

  test('bestPortForPoint prefers the side the pointer is actually over', () => {
    const n = node({ x: 0, y: 0, width: 200, height: 100 });
    // Pointer inside the node, in its lower half: the bottom port is closest.
    expect(bestPortForPoint(n, { x: 20, y: 95 })).toBe('bottom');
  });

  test('pointOnNodeBoundary clamps to the rect, including the corners', () => {
    const n = node({ x: 0, y: 0, width: 200, height: 100 });
    expect(pointOnNodeBoundary(n, { x: -50, y: 500 })).toEqual({ x: 0, y: 100 });
    expect(pointOnNodeBoundary(n, { x: 500, y: -50 })).toEqual({ x: 200, y: 0 });
  });
});

test.describe('cubic curves', () => {
  test('the label anchor lies on the curve even when the ports are not facing', () => {
    // THE regression. The old code placed labels at the chord midpoint:
    //   midX = (fromAnchor.x + toAnchor.x) / 2
    // For a cubic that is only correct when the handles are symmetric, i.e.
    // when P1 + P2 === P0 + P3, which requires the two port normals to point
    // at each other. As soon as both anchors defaulted to the *same* side the
    // normals were parallel and the chord midpoint left the path entirely --
    // measured at 52.5 world units for the case below, which is exactly the
    // "label floats off the edge" report.
    const fromSide: PortSide = 'bottom';
    const toSide: PortSide = 'bottom';
    const a = anchorFor(node({ x: 0, y: 0 }), fromSide);
    const b = anchorFor(node({ x: 400, y: 0, width: 200, height: 100 }), toSide);
    const curve = curveBetween(a, b);

    const chordMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const onCurve = cubicAt(curve, 0.5);

    // The new anchor is provably on the path.
    expect(cubicDistance(curve, onCurve).dist).toBeLessThan(1e-6);

    // And it is far from where the old code drew the label.
    expect(Math.hypot(onCurve.x - chordMid.x, onCurve.y - chordMid.y)).toBeGreaterThan(10);
  });

  test('facing ports make the chord midpoint a valid point on the path', () => {
    // Sanity check on the other case: right -> left has opposing normals, so
    // B(0.5) coincides with the chord midpoint. This is why the old label
    // placement only *looked* correct on simple horizontal links.
    const curve = curveBetween(
      anchorFor(node({ x: 0, y: 0 }), 'right'),
      anchorFor(node({ x: 400, y: 0, width: 200, height: 100 }), 'left')
    );
    const mid = cubicAt(curve, 0.5);
    expect(Math.hypot(mid.x - 300, mid.y - 50)).toBeLessThan(1e-6);
    expect(cubicDistance(curve, mid).dist).toBeLessThan(1e-6);
  });

  test('cubicAt hits both endpoints exactly', () => {
    const curve = curveBetween(
      anchorFor(node({ x: 0, y: 0 }), 'bottom'),
      anchorFor(node({ x: 500, y: 300 }), 'top')
    );
    const p0 = cubicAt(curve, 0);
    const p1 = cubicAt(curve, 1);
    expect(p0.x).toBeCloseTo(curve.p0.x, 6);
    expect(p0.y).toBeCloseTo(curve.p0.y, 6);
    expect(p1.x).toBeCloseTo(curve.p3.x, 6);
    expect(p1.y).toBeCloseTo(curve.p3.y, 6);
  });

  test('cubicDistance returns ~0 for a point sampled from the same curve', () => {
    const curve = curveBetween(
      anchorFor(node({ x: 0, y: 0 }), 'right'),
      anchorFor(node({ x: 300, y: 220, width: 200, height: 120 }), 'left')
    );
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(cubicDistance(curve, cubicAt(curve, t)).dist).toBeLessThan(1);
    }
  });

  test('handleLength grows with the gap but stays clamped', () => {
    const a = { x: 0, y: 0, nx: 1, ny: 0 };
    const near = handleLength(a, { x: 50, y: 0, nx: -1, ny: 0 });
    const far = handleLength(a, { x: 5000, y: 0, nx: -1, ny: 0 });
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(160);
    expect(near).toBeGreaterThanOrEqual(24);
  });

  test('tangentAt points away from the source anchor', () => {
    const curve = curveBetween(
      anchorFor(node({ x: 0, y: 0 }), 'right'),
      anchorFor(node({ x: 400, y: 0 }), 'left')
    );
    const angle = tangentAt(curve, 0);
    expect(Math.abs(Math.cos(angle))).toBeCloseTo(1, 3);
    expect(Math.cos(angle)).toBeGreaterThan(0);
  });
});

test.describe('viewport transform', () => {
  test('toScreen and toWorld round-trip', () => {
    const t = { x: 137, y: -42, k: 1.75 };
    const world = { x: -12.5, y: 900 };
    const back = toWorld(t, toScreen(t, world));
    expect(back.x).toBeCloseTo(world.x, 9);
    expect(back.y).toBeCloseTo(world.y, 9);
  });

  test('zoomAt pins the world point under the anchor', () => {
    const t = { x: 0, y: 0, k: 1 };
    const anchor = { x: 400, y: 300 };
    const worldUnder = toWorld(t, anchor);
    const next = zoomAt(t, anchor, 2.5, 0.1, 4);
    const after = toScreen(next, worldUnder);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });

  test('zoomAt honours the clamps in both directions', () => {
    const t = { x: 0, y: 0, k: 1 };
    expect(zoomAt(t, { x: 0, y: 0 }, 99, 0.1, 4).k).toBe(4);
    expect(zoomAt(t, { x: 0, y: 0 }, 0.0001, 0.1, 4).k).toBe(0.1);
  });

  test('panBy is a pure screen-space translation and leaves zoom alone', () => {
    const t = { x: 10, y: 20, k: 0.5 };
    expect(panBy(t, -30, 15)).toEqual({ x: -20, y: 35, k: 0.5 });
  });

  test('visibleRect is the exact inverse of the screen rect', () => {
    const t = { x: 60, y: 90, k: 0.5 };
    const view = { width: 800, height: 600 };
    const v = visibleRect(t, view);
    expect(v.x).toBeCloseTo(-120, 9);
    expect(v.y).toBeCloseTo(-180, 9);
    expect(v.width).toBeCloseTo(1600, 9);
    expect(v.height).toBeCloseTo(1200, 9);
  });

  test('fitTransform centres content and never upscales past the cap', () => {
    const content = { x: 0, y: 0, width: 400, height: 300 };
    const view = { width: 1000, height: 800 };
    const t = fitTransform({ x: 0, y: 0, k: 1 }, content, view);
    expect(t.k).toBeLessThanOrEqual(1);

    const centre = toWorld(t, { x: view.width / 2, y: view.height / 2 });
    expect(centre.x).toBeCloseTo(200, 6);
    expect(centre.y).toBeCloseTo(150, 6);
  });
});

test.describe('routing', () => {
  const nodes: CanvasNode[] = [
    node({ id: 'a', x: 0, y: 0 }),
    node({ id: 'b', x: 500, y: 250 }),
  ];

  test('every resolved edge exposes path, mid, bbox and a usable arrow angle', () => {
    const result = resolveEdges({ edges: [edge()], nodes });
    expect(result).toHaveLength(1);
    const item = result[0];

    expect(item.route.path).toMatch(/^M /);
    expect(Number.isFinite(item.route.mid.x)).toBe(true);
    expect(Number.isFinite(item.route.mid.y)).toBe(true);
    expect(item.route.bbox.width).toBeGreaterThan(0);
    expect(item.route.bbox.height).toBeGreaterThan(0);
    expect(Number.isFinite(item.route.endAngle)).toBe(true);
  });

  test('the label anchor lies on the path, not on the chord', () => {
    const diagonal = resolveEdges({
      edges: [edge()],
      nodes: [node({ id: 'a', x: 0, y: 0 }), node({ id: 'b', x: 500, y: 250 })],
    });
    const curve = curveBetween(
      anchorFor(nodes[0], 'right'),
      anchorFor(nodes[1], 'left')
    );
    const dist = cubicDistance(curve, diagonal[0].route.mid).dist;
    expect(dist).toBeLessThan(0.5);
  });

  test('the router is pluggable: swapping it changes geometry but not the contract', () => {
    const bezier = resolveEdges({ edges: [edge()], nodes, routerId: 'bezier' });
    const ortho = resolveEdges({ edges: [edge()], nodes, routerId: 'orthogonal' });

    expect(bezier[0].route.path).not.toBe(ortho[0].route.path);
    for (const r of [bezier[0], ortho[0]]) {
      expect(r.route.path).toMatch(/^M /);
      expect(Number.isFinite(r.route.endAngle)).toBe(true);
    }
  });

  test('edges to a missing node are skipped, not crashed on', () => {
    const result = resolveEdges({ edges: [edge({ toNode: 'ghost' })], nodes });
    expect(result).toHaveLength(0);
  });

  test('self-connections still produce drawable geometry', () => {
    const one = node({ id: 'solo' });
    const result = resolveEdges({
      edges: [edge({ fromNode: 'solo', toNode: 'solo', fromSide: 'right', toSide: 'left' })],
      nodes: [one],
    });
    expect(result).toHaveLength(1);
    expect(result[0].route.path).toMatch(/^M /);
    expect(Number.isFinite(result[0].route.endAngle)).toBe(true);
  });

  test('edges sharing an anchor fan out instead of overlapping', () => {
    const shared: CanvasNode[] = [node({ id: 'a', x: 0, y: 0 }), node({ id: 'b', x: 500, y: 0 }), node({ id: 'c', x: 500, y: 300 })];
    const result = resolveEdges({
      edges: [edge({ toNode: 'b' }), edge({ id: 'e2', toNode: 'c' })],
      nodes: shared,
    });
    expect(result).toHaveLength(2);
    expect(result[0].route.path).not.toBe(result[1].route.path);
  });
});

test.describe('orthoPath', () => {
  test('produces only axis-aligned segments', () => {
    const d = orthoPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    // Every coordinate pair in the path must differ on exactly one axis.
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const dx = Math.abs(nums[i] - nums[i + 2]);
      const dy = Math.abs(nums[i + 1] - nums[i + 3]);
      if (dx > 0.001 && dy > 0.001) throw new Error(`diagonal segment at ${i}: ${d}`);
    }
  });
});

test.describe('grouping', () => {
  /**
   * Full containment, and specifically *not* the two rules this function has
   * shipped under before: "centre is inside" and "top-left corner is inside".
   * Both accepted or rejected nodes the other did not, and different call sites
   * used different ones -- so the count in a group's badge disagreed with the
   * set of nodes that actually moved with it.
   *
   * The assertions below are chosen so each of the three rules gives a different
   * answer, which is what makes this test able to fail.
   */
  const group = () => node({ x: 0, y: 0, width: 500, height: 500 });

  test('accepts a node fully inside', () => {
    expect(isNodeInGroup(node({ x: 10, y: 10, width: 50, height: 50 }), group())).toBe(true);
    expect(isNodeInGroup(node({ x: 450, y: 450, width: 50, height: 50 }), group())).toBe(true);
  });

  test('rejects a node whose top-left is inside but whose body spills out', () => {
    // Centre and top-left rules both said yes; full containment says no.
    expect(isNodeInGroup(node({ x: 400, y: 400, width: 400, height: 400 }), group())).toBe(false);
    expect(isNodeInGroup(node({ x: 0, y: 0, width: 900, height: 900 }), group())).toBe(false);
  });

  test('rejects a node whose body is inside but whose top-left is outside', () => {
    // The top-left rule said no here, which is how nodes escaped their group.
    expect(isNodeInGroup(node({ x: -50, y: -50, width: 200, height: 200 }), group())).toBe(false);
  });

  test('rejects a node that merely overlaps the group', () => {
    // The bug in production: dragging a group moved every overlapping node,
    // including a sibling group it had nothing to do with.
    const overlapping = node({ x: 400, y: 0, width: 400, height: 100 });
    expect(isNodeInGroup(overlapping, group())).toBe(false);
  });

  test('treats the boundary as inclusive', () => {
    expect(isNodeInGroup(node({ x: 0, y: 0, width: 500, height: 500 }), group())).toBe(true);
  });

  test('a group is never a member of a group', () => {
    // Nesting is expressed by parentId, not by geometry.
    expect(isNodeInGroup(node({ type: 'group', x: 10, y: 10, width: 50, height: 50 }), group())).toBe(false);
  });
});

test.describe('rectFullyContains', () => {
  const outer = { x: 0, y: 0, width: 100, height: 100 };

  test('is distinct from the point test it replaced', () => {
    // This is the exact defect: a Rect satisfies Point structurally, so
    // rectContains(g, c) used to compile and silently ignore c.width/height.
    expect(rectContains(outer, { x: 90, y: 90, width: 9000, height: 9000 })).toBe(true);
    expect(rectFullyContains(outer, { x: 90, y: 90, width: 9000, height: 9000 })).toBe(false);
  });

  test('includes the top-left edges but not the bottom-right', () => {
    expect(rectFullyContains(outer, outer)).toBe(true);
    // Flush to the far edge: one pixel over is outside.
    expect(rectFullyContains(outer, { x: 100, y: 100, width: 1, height: 1 })).toBe(false);
    expect(rectFullyContains(outer, { x: 99, y: 99, width: 1, height: 1 })).toBe(true);
  });
});

test.describe('rectOverlapRatio', () => {
  test('is 1 when the first rect sits wholly inside the second', () => {
    // Ratio is measured against the *first* rect's area.
    expect(rectOverlapRatio({ x: 2, y: 2, width: 10, height: 10 }, { x: 0, y: 0, width: 20, height: 20 })).toBe(1);
    expect(rectOverlapRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 50, width: 10, height: 10 })).toBe(0);
  });

  test('a large rect containing a small one is not fully covered by it', () => {
    expect(rectOverlapRatio({ x: 0, y: 0, width: 20, height: 20 }, { x: 2, y: 2, width: 10, height: 10 })).toBeCloseTo(0.25, 5);
  });

  test('is the covered fraction for a partial overlap', () => {
    // Half covered: 10x10 with 5x10 of it inside.
    expect(rectOverlapRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 0, width: 10, height: 10 })).toBeCloseTo(0.5, 5);
  });
});

test.describe('nodeRect', () => {
  test('is a thin pass-through that never allocates a new shape per call site', () => {
    expect(nodeRect(node({ x: 5, y: 7, width: 20, height: 30 }))).toEqual({
      x: 5,
      y: 7,
      width: 20,
      height: 30,
    });
  });
});

test.describe('detached edge ends', () => {
  const nodes = [node({ id: 'a', x: 0, y: 0 }), node({ id: 'b', x: 400, y: 300 })];

  test('an end with a free position still resolves, so the edge stays drawn', () => {
    const [resolved] = resolveEdges({
      edges: [edge({ id: 'e1', fromNode: '', fromX: 700, fromY: 40, toNode: 'b', toSide: 'left' })],
      nodes,
    });
    expect(resolved).toBeDefined();
    // The curve must start at the free position. The stand-in node is 1x1
    // centred on that position, so the anchor lands on its edge: exact along
    // the exit axis, half a pixel off on the perpendicular one.
    expect(resolved!.route.from.x).toBeCloseTo(700, 5);
    expect(Math.abs(resolved!.route.from.y - 40)).toBeLessThanOrEqual(0.5);
  });

  test('a detached end faces the node it is attached to', () => {
    const [resolved] = resolveEdges({
      edges: [edge({ id: 'e1', fromNode: '', fromX: 700, fromY: 40, toNode: 'b', toSide: 'left' })],
      nodes,
    });
    // 'b' is below the free point and further away in y than in x, so the
    // stub exits downward, which is what makes the curve leave the handle
    // towards its target instead of doubling back.
    expect(resolved!.fromSide).toBe('bottom');
  });

  test('both ends detached resolves using only the stored coordinates', () => {
    const [resolved] = resolveEdges({
      edges: [edge({ id: 'e1', fromNode: '', fromX: 0, fromY: 0, toNode: '', toX: 200, toY: 120 })],
      nodes,
    });
    expect(resolved).toBeDefined();
    // Purely horizontal run, so both stubs exit along the x axis.
    expect(resolved!.fromSide).toBe('right');
    expect(resolved!.toSide).toBe('left');
  });

  test('a missing end with no coordinates is skipped rather than drawn from a guess', () => {
    expect(
      resolveEdges({ edges: [edge({ id: 'e1', fromNode: 'ghost' })], nodes })
    ).toHaveLength(0);
  });

  test('isEdgeEndDetached distinguishes attached from free ends', () => {
    const attached = edge({ fromNode: 'a', toNode: 'b' });
    const free = edge({ fromNode: '', fromX: 10, fromY: 10, toNode: 'b' });
    expect(isEdgeEndDetached(attached, 'from')).toBe(false);
    expect(isEdgeEndDetached(free, 'from')).toBe(true);
    expect(isEdgeEndDetached(free, 'to')).toBe(false);

    expect(edgeEndFreePoint(free, 'from')).toEqual({ x: 10, y: 10 });
    expect(edgeEndFreePoint(attached, 'from')).toBeNull();
    // Detached but unplaced: there is nothing to draw or drag.
    expect(edgeEndFreePoint(edge({ fromNode: '', toNode: 'b' }), 'from')).toBeNull();
  });
});

test.describe('resolveEdgeEnd', () => {
  const nodes = [node({ id: 'a' }), node({ id: 'b', x: 400 })];

  test('resolves from the node anchor when attached', () => {
    const end = resolveEdgeEnd(
      { id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' },
      'from',
      nodes
    );
    expect(end!.point.x).toBeCloseTo(200, 5);
    expect(end!.side).toBe('right');
    expect(end!.detached).toBe(false);
  });

  test('falls back to the stored free position when the node is gone', () => {
    const end = resolveEdgeEnd(
      { id: 'e', fromNode: '', fromX: 33, fromY: 44, toNode: 'b', toSide: 'left' },
      'from',
      nodes
    );
    expect(end!.detached).toBe(true);
    // The stand-in node is 1x1 centred on the free point, so the anchor lands on
    // its edge: exact along the exit axis, half a pixel off across it.
    expect(Math.abs(end!.point.x - 33)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(end!.point.y - 44)).toBeLessThanOrEqual(0.5);
  });

  test('an end naming a node that was deleted is treated as detached', () => {
    const end = resolveEdgeEnd(
      { id: 'e', fromNode: 'ghost', toNode: 'b', toSide: 'left' },
      'from',
      nodes
    );
    // No node and no free coordinates: there is nowhere to put it.
    expect(end).toBeNull();
  });

  test('endpointPoint is the handle-layer view of the same resolver', () => {
    const edge = { id: 'e', fromNode: 'a', fromSide: 'right' as const, toNode: 'b', toSide: 'left' as const };
    expect(endpointPoint(edge, 'from', nodes)!.point.x).toBeCloseTo(200, 5);
    // Unplaceable end: the handle layer must decline rather than draw at 0,0.
    expect(endpointPoint({ id: 'x', fromNode: 'ghost', toNode: 'b' }, 'from', nodes)).toBeNull();
  });
});
