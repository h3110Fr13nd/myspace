import { expect, test } from '@playwright/test';
import { anchorFor, borderAnchorForPoint } from '../../src/components/canvas/core/geometry';
import { resolveEdges, createEdgeResolver } from '../../src/components/canvas/core/routing';
import { centeredSlot, pairKey, slotsByKey } from '../../src/lib/viewer/parallel';

const node = { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100 } as any;
const other = { id: 'b', type: 'text', x: 400, y: 0, width: 200, height: 100 } as any;

test('a drop binds to the nearest border point, snapping to the midpoint', () => {
  expect(borderAnchorForPoint(node, { x: 50, y: -10 })).toEqual({ side: 'top', t: 0.25 });
  expect(borderAnchorForPoint(node, { x: 190, y: 80 })).toEqual({ side: 'right', t: 0.8 });
  expect(borderAnchorForPoint(node, { x: 103, y: 2 })).toEqual({ side: 'top', t: undefined });
  expect(anchorFor(node, 'bottom', 0.25)).toMatchObject({ x: 50, y: 100, nx: 0, ny: 1 });
});

test('edges start and end at their stored anchors; plain edges are unchanged', () => {
  const plain = { id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' } as any;
  const placed = { ...plain, id: 'e2', fromAnchor: 0.2, toAnchor: 0.9 };
  const [r1, r2] = resolveEdges({ edges: [plain, placed], nodes: [node, other] });
  expect(r1.route.to).toMatchObject({ x: 400, y: 50 });
  expect(r2.route.from).toMatchObject({ x: 200, y: 20 });
  expect(r2.route.to).toMatchObject({ x: 400, y: 90 });
  // The incremental resolver agrees.
  const inc = createEdgeResolver()({ edges: [plain, placed], nodes: [node, other] });
  expect(inc.map((r) => r.route.path)).toEqual([r1.route.path, r2.route.path]);
});

test('parallel-link slots are shared by graph and canvas', () => {
  expect([0, 1, 2].map((i) => centeredSlot(i, 3))).toEqual([-1, 0, 1]);
  expect(pairKey('x', 'y')).toBe(pairKey('y', 'x'));
  expect(slotsByKey(['a', 'b', 'a', null], (k) => k)).toEqual([
    { index: 0, total: 2 },
    { index: 0, total: 1 },
    { index: 1, total: 2 },
    null,
  ]);
});

test('one camera: canvas transforms and graph camera agree', async () => {
  const shared = await import('../../src/lib/viewer/camera');
  const canvas = await import('../../src/components/canvas/core/transform');
  const graph = await import('../../src/components/graph/tiled/camera');
  const cam = { x: 10, y: -20, k: 2 };
  const view = { width: 800, height: 600 };
  expect(canvas.zoomAt(cam, { x: 100, y: 50 }, 3)).toEqual(graph.zoomAbout(cam, 1.5, { x: 100, y: 50 }, 0.01, 10));
  expect(canvas.toWorld(cam, { x: 110, y: 80 })).toEqual(graph.screenToWorld(cam, 110, 80));
  expect(canvas.fitTransform(cam, { x: 0, y: 0, width: 400, height: 300 }, view, { padding: 0, maxUpscale: 10 })).toEqual({ k: 2, x: 0, y: 0 });
  // A flight starts where it is and ends exactly on target.
  const to = shared.flightTarget({ x: -400, y: -300, k: 4 }, view);
  expect(shared.flyTo(cam, to, view, 0)).toMatchObject({ k: 2 });
  const end = shared.flyTo(cam, to, view, 1);
  expect(end.k).toBeCloseTo(4);
  expect(end.x).toBeCloseTo(-400);
  expect(end.y).toBeCloseTo(-300);
});
