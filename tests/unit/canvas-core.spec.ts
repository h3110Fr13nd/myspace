import { expect, test } from '@playwright/test';
import { nodesInRect } from '../../src/components/canvas/core/usePointerInteraction';
import { NodeIndex } from '../../src/components/canvas/core/spatialIndex';
import { resolveEdgeEnd, resolveEdges } from '../../src/components/canvas/core/routing';
import { edgeEndFreePoint, isEdgeEndDetached, type CanvasEdge, type CanvasNode } from '../../src/components/canvas/types';

function node(over: Partial<CanvasNode> = {}): CanvasNode {
  return { id: 'n', type: 'text', x: 0, y: 0, width: 100, height: 100, ...over };
}

/**
 * These cover the pure parts of the interaction core. The gesture wiring itself
 * needs a real event stream and is covered by `tests/browser`, which drives
 * Chromium; duplicating that here would only test a mock.
 */
test.describe('nodesInRect', () => {
  const nodes = [
    node({ id: 'inside', x: 20, y: 20 }),
    node({ id: 'straddle', x: 90, y: 90, width: 100, height: 100 }),
    node({ id: 'outside', x: 400, y: 400 }),
    node({ id: 'group', type: 'group', x: 10, y: 10, width: 300, height: 300 }),
  ];

  test('returns every node the band touches, including partial overlaps', () => {
    const hits = nodesInRect(nodes, { x: 0, y: 0, width: 200, height: 200 });
    expect(hits).toContain('inside');
    expect(hits).toContain('straddle');
    expect(hits).not.toContain('outside');
  });

  test('a group is selectable in its own right', () => {
    // Previously groups were skipped, so a band drawn around a group selected
    // nothing: the band hit the group's rect and none of its children. That is
    // defect D4 — groups could not be selected at all.
    expect(nodesInRect(nodes, { x: 0, y: 0, width: 400, height: 400 })).toContain('group');
  });

  test('a hit inside a group resolves to the group, not the child', () => {
    // A rubber band over part of a group must select the whole group, never a
    // fragment of it.
    const nested = [
      node({ id: 'grp', type: 'group', x: 0, y: 0, width: 400, height: 400 }),
      node({ id: 'child', x: 20, y: 20, parentId: 'grp' }),
    ];
    expect(nodesInRect(nested, { x: 0, y: 0, width: 100, height: 100 })).toEqual(['grp']);
  });

  test('an ungrouped node is still its own unit', () => {
    // No parent pointer, so nothing to resolve to.
    expect(nodesInRect(nodes, { x: 0, y: 0, width: 200, height: 200 })).toContain('inside');
  });

  test('a node that only touches the band edge is excluded', () => {
    // The band ends exactly at x=20, where `inside` starts, so nothing overlaps.
    expect(nodesInRect([node({ x: 20, y: 0 })], { x: 0, y: 0, width: 20, height: 100 })).toEqual([]);
  });
});

test.describe('NodeIndex', () => {
  const nodes = [node({ id: 'a', x: 0, y: 0 }), node({ id: 'b', x: 500, y: 500 })];

  test('finds the node containing a point', () => {
    const idx = new NodeIndex(nodes);
    expect(idx.hitTest({ x: 50, y: 50 })?.id).toBe('a');
    expect(idx.hitTest({ x: 550, y: 550 })?.id).toBe('b');
    expect(idx.hitTest({ x: 300, y: 300 })).toBeNull();
  });

  test('prefers the smaller node when containers overlap', () => {
    const idx = new NodeIndex([
      node({ id: 'group', type: 'group', x: 0, y: 0, width: 500, height: 500 }),
      node({ id: 'child', x: 100, y: 100, width: 50, height: 50 }),
    ]);
    expect(idx.hitTest({ x: 120, y: 120 })?.id).toBe('child');
  });

  test('tolerant search reaches just outside a node, for drop targets', () => {
    const idx = new NodeIndex([node({ id: 'a', x: 0, y: 0, width: 100, height: 100 })]);
    expect(idx.searchTolerant({ x: 110, y: 50 }, 24).map((n) => n.id)).toEqual(['a']);
    expect(idx.searchTolerant({ x: 200, y: 50 }, 24)).toEqual([]);
  });

  test('rebuild clears stale entries', () => {
    const idx = new NodeIndex(nodes);
    expect(idx.size).toBe(2);
    idx.build([node({ id: 'c', x: 0, y: 0 })]);
    expect(idx.size).toBe(1);
    expect(idx.has('a')).toBe(false);
    expect(idx.has('c')).toBe(true);
  });

  test('bounds is null for an empty board rather than a zero rect', () => {
    expect(new NodeIndex([]).bounds()).toBeNull();
  });
});

test.describe('detached ends stay placeable everywhere', () => {
  const nodes = [node({ id: 'a', x: 0, y: 0 }), node({ id: 'b', x: 400, y: 300 })];
  const detached: CanvasEdge = {
    id: 'e',
    fromNode: '',
    fromX: 700,
    fromY: 40,
    toNode: 'b',
    toSide: 'left',
  };

  test('the renderer still emits geometry for a half-unplugged edge', () => {
    const [resolved] = resolveEdges({ edges: [detached], nodes });
    expect(resolved).toBeDefined();
  });

  test('the end resolver and the renderer agree on the position', () => {
    const [resolved] = resolveEdges({ edges: [detached], nodes });
    const end = resolveEdgeEnd(detached, 'from', nodes)!;
    expect(resolved!.route.from.x).toBeCloseTo(end.point.x, 5);
    expect(resolved!.route.from.y).toBeCloseTo(end.point.y, 5);
  });

  test('isEdgeEndDetached and edgeEndFreePoint tell the same story', () => {
    expect(isEdgeEndDetached(detached, 'from')).toBe(true);
    expect(isEdgeEndDetached(detached, 'to')).toBe(false);
    expect(edgeEndFreePoint(detached, 'from')).toEqual({ x: 700, y: 40 });
    expect(edgeEndFreePoint(detached, 'to')).toBeNull();
  });
});
