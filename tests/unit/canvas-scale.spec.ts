import { expect, test } from '@playwright/test';
import { createEdgeResolver, resolveEdges } from '../../src/components/canvas/core/routing';
import type { CanvasEdge, CanvasNode } from '../../src/components/canvas/types';

function board(n: number) {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `n${i}`, type: 'text', x: (i % 20) * 300, y: Math.floor(i / 20) * 220, width: 240, height: 140 });
    if (i > 0) edges.push({ id: `e${i}`, fromNode: `n${i}`, fromSide: 'left', toNode: `n${i - 1}`, toSide: 'right' });
    if (i > 5 && i % 3 === 0) edges.push({ id: `x${i}`, fromNode: `n${i}`, toNode: `n${i - 5}` });
  }
  // Fan-out from one port and a detached end, to exercise every branch.
  edges.push({ id: 'fan1', fromNode: 'n0', fromSide: 'bottom', toNode: 'n7' });
  edges.push({ id: 'fan2', fromNode: 'n0', fromSide: 'bottom', toNode: 'n9' });
  edges.push({ id: 'det', fromNode: 'n3', toNode: '', toX: 5000, toY: -200 });
  return { nodes, edges };
}

const strip = (rs: ReturnType<typeof resolveEdges>) =>
  rs.map((r) => ({ id: r.id, path: r.route.path, from: r.fromNode.id, to: r.toNode.id, sides: [r.fromSide, r.toSide] }));

test.describe('incremental edge resolution', () => {
  test('matches resolveEdges exactly, frame after frame', () => {
    const resolve = createEdgeResolver();
    let { nodes, edges } = board(200);
    expect(strip(resolve({ edges, nodes }))).toEqual(strip(resolveEdges({ edges, nodes })));

    // A drag frame: a few nodes move (immutable update, same order).
    nodes = nodes.map((n) => (n.id === 'n7' || n.id === 'n50' ? { ...n, x: n.x + 37, y: n.y - 11 } : n));
    expect(strip(resolve({ edges, nodes }))).toEqual(strip(resolveEdges({ edges, nodes })));

    // Structural edits: an edge removed, a node deleted, an end re-attached.
    edges = edges.filter((e) => e.id !== 'e10');
    nodes = nodes.filter((n) => n.id !== 'n99');
    edges = edges.map((e) => (e.id === 'det' ? { ...e, toNode: 'n4', toX: undefined, toY: undefined } : e));
    expect(strip(resolve({ edges, nodes }))).toEqual(strip(resolveEdges({ edges, nodes })));

    // Reordered array of the same length (e.g. bring-to-front).
    nodes = [...nodes.slice(10), ...nodes.slice(0, 10)];
    expect(strip(resolve({ edges, nodes }))).toEqual(strip(resolveEdges({ edges, nodes })));
  });

  test('reuses routes whose endpoints did not move', () => {
    const resolve = createEdgeResolver();
    const { nodes, edges } = board(100);
    const first = resolve({ edges, nodes });
    const moved = nodes.map((n) => (n.id === 'n42' ? { ...n, x: n.x + 5 } : n));
    const second = resolve({ edges, nodes: moved });
    const byId = new Map(first.map((r) => [r.id, r]));
    let reused = 0;
    let rerouted = 0;
    for (const r of second) {
      if (byId.get(r.id) === r) reused++;
      else rerouted++;
    }
    // Only edges touching n42 (and the always-fresh detached one) re-route.
    const touching = edges.filter((e) => e.fromNode === 'n42' || e.toNode === 'n42').length;
    expect(rerouted).toBe(touching + 1);
    expect(reused).toBe(second.length - rerouted);
  });
});

import { nextRenderRect, pickVisible } from '../../src/components/canvas/core/useVirtualNodes';

test.describe('viewport virtualisation', () => {
  const view = { x: 0, y: 0, width: 1000, height: 600 };

  test('a pan inside the padded rect keeps the same prepared rect (no re-render)', () => {
    const first = nextRenderRect(null, view, 0.5);
    expect(first.rect).toEqual({ x: -500, y: -500, width: 2000, height: 1600 });
    const panned = nextRenderRect(first, { ...view, x: 300, y: -200 }, 0.5);
    expect(panned).toBe(first);
    // Leaving it prepares a new rect around the new view.
    const left = nextRenderRect(first, { ...view, x: 600 }, 0.5);
    expect(left).not.toBe(first);
    expect(left.rect.x).toBe(100);
  });

  test('a large zoom change re-prepares even inside the rect', () => {
    const first = nextRenderRect(null, view, 0.5);
    // Zooming in 2x: the view shrinks inside the rect, but the prepared list
    // would mount far more than is visible, so it is rebuilt.
    const zoomedIn = nextRenderRect(first, { x: 250, y: 150, width: 500, height: 300 }, 0.5);
    expect(zoomedIn).not.toBe(first);
    const nudged = nextRenderRect(first, { x: 10, y: 10, width: 900, height: 540 }, 0.5);
    expect(nudged).toBe(first);
  });

  test('visible nodes are live objects, in document order, with pinned ones added', () => {
    const nodes: CanvasNode[] = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`, type: 'text', x: i * 100, y: 0, width: 50, height: 50,
    }));
    const pos = new Map(nodes.map((n, i) => [n.id, i]));
    // A drag frame: n3 moved (new object), order unchanged.
    const live = nodes.map((n) => (n.id === 'n3' ? { ...n, x: 999 } : n));
    const out = pickVisible(['n5', 'n3', 'n1'], new Set(['n8']), live, pos);
    expect(out.map((n) => n.id)).toEqual(['n1', 'n3', 'n5', 'n8']);
    expect(out[1]).toBe(live[3]);
    // Reordered underneath (a delete mid-gesture): still resolves correctly.
    const shifted = live.slice(1);
    expect(pickVisible(['n5'], new Set(), shifted, pos).map((n) => n.id)).toEqual(['n5']);
    expect(pickVisible(['gone'], new Set(), shifted, pos)).toEqual([]);
  });
});
