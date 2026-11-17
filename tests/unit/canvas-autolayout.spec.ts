import { expect, test } from '@playwright/test';
import { autoLayout } from '../../src/components/canvas/core/autoLayout';
import { GroupIndex, isStructural } from '../../src/components/canvas/core/grouping';
import type { CanvasEdge, CanvasNode } from '../../src/components/canvas/types';

/**
 * Auto-layout.
 *
 * These import the production module. The previous version of this file carried
 * its own copy of the layering loop, which is precisely why the group
 * behaviour below could regress unnoticed: the suite exercised a function
 * nothing shipped.
 */

function node(over: Partial<CanvasNode> = {}): CanvasNode {
  return { id: 'n', type: 'text', x: 0, y: 0, width: 200, height: 100, ...over };
}

function edge(fromNode: string, toNode: string, over: Partial<CanvasEdge> = {}): CanvasEdge {
  return { id: `${fromNode}->${toNode}`, fromNode, toNode, toEnd: 'arrow', ...over };
}

const at = (nodes: CanvasNode[], id: string) => {
  const found = nodes.find((n) => n.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
};

const overlaps = (a: CanvasNode, b: CanvasNode) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Containment is asserted on the tree, which is what layout now honours.
 * Asserting it geometrically would pass even for a group whose `parentId`
 * nothing had set, so it could not tell the two models apart.
 */
const memberOf = (nodes: CanvasNode[], childId: string, groupId: string) =>
  new GroupIndex(nodes).get(childId)?.parentId === groupId;

test.describe('layering', () => {
  test('a node sits to the right of everything pointing at it', () => {
    // a -> b -> c, plus a -> c
    const nodes = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')];
    const { nodes: out, levels } = autoLayout(nodes, edges);

    expect(levels.get('a')).toBe(0);
    expect(levels.get('b')).toBe(1);
    expect(levels.get('c')).toBe(2);
    expect(at(out, 'a').x).toBeLessThan(at(out, 'b').x);
    expect(at(out, 'b').x).toBeLessThan(at(out, 'c').x);
  });

  test('the longest path wins, not the first one found', () => {
    // a -> c and a -> b -> c: c must follow the longer chain.
    const nodes = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })];
    const edges = [edge('a', 'c'), edge('a', 'b'), edge('b', 'c')];
    expect(autoLayout(nodes, edges).levels.get('c')).toBe(2);
  });

  test('isolated nodes share the first column without overlapping', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })];
    const out = autoLayout(nodes, []).nodes;
    expect(at(out, 'a').x).toBe(at(out, 'b').x);
    expect(at(out, 'a').y).toBeLessThan(at(out, 'b').y);
    expect(overlaps(at(out, 'a'), at(out, 'b'))).toBe(false);
    expect(overlaps(at(out, 'b'), at(out, 'c'))).toBe(false);
  });

  test('the same input always produces the same output', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' }), node({ id: 'd' })];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('c', 'd')];
    const first = autoLayout(nodes, edges).nodes;
    const second = autoLayout(nodes, edges).nodes;
    expect(second.map((n) => [n.id, n.x, n.y])).toEqual(first.map((n) => [n.id, n.x, n.y]));
  });

  test('an empty board is a no-op rather than a crash', () => {
    const result = autoLayout([], []);
    expect(result.nodes).toEqual([]);
    expect(result.cycleBrokenEdgeIds).toEqual([]);
  });
});

test.describe('cycles', () => {
  test('a feedback edge is dropped and the rest of the board still lays out', () => {
    // a -> b -> x -> a, the shape that used to inflate levels to 18.
    const nodes = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'x' })];
    const edges = [edge('a', 'b'), edge('b', 'x'), edge('x', 'a')];
    const result = autoLayout(nodes, edges);

    expect(result.cycleBrokenEdgeIds).toHaveLength(1);
    expect(result.cycleBrokenEdgeIds[0]).toBe('x->a');
    // Bounded by the node count: the old relaxation reached 18 here.
    for (const level of result.levels.values()) expect(level).toBeLessThanOrEqual(nodes.length);
  });

  test('a cycle produces a forward-pointing layout, not a reversed one', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'x' })];
    const edges = [edge('a', 'b'), edge('b', 'x'), edge('x', 'a')];
    const out = autoLayout(nodes, edges).nodes;
    // Every surviving edge must point rightwards. The old output put `a` to the
    // right of `b` while an edge ran from a to b.
    expect(at(out, 'a').x).toBeLessThan(at(out, 'b').x);
    expect(at(out, 'b').x).toBeLessThan(at(out, 'x').x);
  });

  test('a self-loop is not a constraint', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' })];
    const edges = [edge('a', 'a'), edge('a', 'b')];
    const result = autoLayout(nodes, edges);
    expect(result.cycleBrokenEdgeIds).toEqual(['a->a']);
    expect(result.levels.get('b')).toBe(1);
  });

  test('a long cycle still terminates', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const nodes = ids.map((id) => node({ id }));
    const edges = ids.map((id, i) => edge(id, ids[(i + 1) % ids.length]));
    const result = autoLayout(nodes, edges);
    expect(result.cycleBrokenEdgeIds.length).toBeGreaterThan(0);
    expect(new Set(result.levels.values()).size).toBeGreaterThan(1);
  });

  test('an edge to a deleted node is ignored', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' })];
    const edges = [edge('a', 'b'), edge('a', 'ghost')];
    expect(autoLayout(nodes, edges).levels.get('b')).toBe(1);
  });
});

test.describe('groups travel with their contents', () => {
  /** Two nodes inside a group that also encloses nothing else. */
  const groupedBoard = () => {
    const nodes = [
      node({ id: 'a', x: 0, y: 0, parentId: 'g' }),
      node({ id: 'b', x: 250, y: 0, parentId: 'g' }),
      node({ id: 'g', type: 'group', x: -50, y: -50, width: 600, height: 300, label: 'G' }),
    ];
    const edges = [edge('a', 'b')];
    return { nodes, edges };
  };

  test('containment survives the layout', () => {
    const { nodes, edges } = groupedBoard();
    const out = autoLayout(nodes, edges).nodes;
    // This is the regression: the old code skipped groups entirely, so both
    // children were teleported out and the group was left empty.
    expect(memberOf(out, 'a', 'g')).toBe(true);
    expect(memberOf(out, 'b', 'g')).toBe(true);
    // And the pointer is still the authority, so they are genuinely inside.
    const group = at(out, 'g');
    expect(overlaps(at(out, 'a'), group)).toBe(true);
  });

  test('the group is resized to fit, rather than keeping a stale size', () => {
    const { nodes, edges } = groupedBoard();
    const out = autoLayout(nodes, edges).nodes;
    const group = at(out, 'g');
    expect(group.width).toBeGreaterThan(0);
    // Tight around the contents, not the original 600.
    expect(group.width).toBeLessThan(600);
  });

  test('the group moves with its contents', () => {
    const { nodes, edges } = groupedBoard();
    const out = autoLayout(nodes, edges).nodes;
    const before = at(nodes, 'g');
    const after = at(out, 'g');
    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);
  });

  test('a group with no members keeps its own geometry', () => {
    // `a` is deliberately not a member: nothing states it as one.
    const nodes = [node({ id: 'a' }), node({ id: 'g', type: 'group', x: 900, y: 900, width: 400, height: 300 })];
    const out = autoLayout(nodes, []).nodes;
    const group = at(out, 'g');
    expect(group.x).toBe(900);
    expect(group.y).toBe(900);
    expect(group.width).toBe(400);
  });

  test('an edge into a group does not become a layout constraint', () => {
    // z -> g must not force the group's contents into a later column.
    const nodes = [
      node({ id: 'a', x: 0, y: 0, parentId: 'g' }),
      node({ id: 'b', x: 250, y: 0, parentId: 'g' }),
      node({ id: 'g', type: 'group', x: -50, y: -50, width: 600, height: 300 }),
      node({ id: 'z', x: 2000, y: 0 }),
    ];
    const edges = [edge('a', 'b'), edge('z', 'g')];
    const { levels } = autoLayout(nodes, edges);
    expect(levels.get('b')).toBe(1);
  });

  test('two groups whose members interleave end up not overlapping', () => {
    const nodes = [
      node({ id: 'a1', x: 0, y: 0, parentId: 'ga' }),
      node({ id: 'a2', x: 0, y: 150, parentId: 'ga' }),
      node({ id: 'b1', x: 400, y: 0, parentId: 'gb' }),
      node({ id: 'b2', x: 400, y: 150, parentId: 'gb' }),
      node({ id: 'ga', type: 'group', x: -40, y: -40, width: 300, height: 350 }),
      node({ id: 'gb', type: 'group', x: 360, y: -40, width: 300, height: 350 }),
    ];
    const out = autoLayout(nodes, []).nodes;
    expect(overlaps(at(out, 'ga'), at(out, 'gb'))).toBe(false);
  });

  test('nested groups keep their contents inside the outer one', () => {
    // `gi` is fully inside `go`, and both leaves are fully inside `gi`, so the
    // containment is unambiguous and the nesting has to survive the layout.
    const nodes = [
      node({ id: 'inner1', x: 120, y: 120, width: 100, height: 80, parentId: 'gi' }),
      node({ id: 'inner2', x: 240, y: 120, width: 100, height: 80, parentId: 'gi' }),
      node({ id: 'loose', x: 900, y: 400, width: 100, height: 80 }),
      node({ id: 'gi', type: 'group', x: 100, y: 100, width: 400, height: 300, parentId: 'go' }),
      node({ id: 'go', type: 'group', x: 0, y: 0, width: 800, height: 600 }),
    ];
    const out = autoLayout(nodes, []).nodes;
    // The chain survives, and both links still hold after the layout moved
    // three boxes.
    expect(memberOf(out, 'inner1', 'gi')).toBe(true);
    expect(memberOf(out, 'gi', 'go')).toBe(true);
    expect(memberOf(out, 'inner2', 'gi')).toBe(true);
    // And the inner group really is inside the outer one on screen.
    const outer = at(out, 'go');
    const inner = at(out, 'gi');
    expect(overlaps(inner, outer)).toBe(true);
  });
});

test.describe('bands are packed from real node sizes', () => {
  test('a tall node does not overlap the row beneath it', () => {
    // The old fixed 280px row pitch overlapped a 640px-tall resource node.
    const nodes = [
      node({ id: 'tall', width: 300, height: 640 }),
      node({ id: 'short', width: 300, height: 120 }),
    ];
    const out = autoLayout(nodes, []).nodes;
    expect(overlaps(at(out, 'tall'), at(out, 'short'))).toBe(false);
  });

  test('a wide node pushes the rest of its column along', () => {
    // The old fixed 420px column pitch overlapped an 820px-wide node.
    const nodes = [
      node({ id: 'wide', width: 820, height: 200 }),
      node({ id: 'narrow', width: 200, height: 200 }),
    ];
    const out = autoLayout(nodes, []).nodes;
    expect(overlaps(at(out, 'wide'), at(out, 'narrow'))).toBe(false);
  });

  test('nothing overlaps anything in a mixed-size board', () => {
    const nodes = [
      node({ id: 'a', width: 820, height: 640 }),
      node({ id: 'b', width: 200, height: 120 }),
      node({ id: 'c', width: 300, height: 400 }),
      node({ id: 'd', width: 200, height: 200 }),
    ];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('c', 'd')];
    const out = autoLayout(nodes, edges).nodes;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(overlaps(out[i], out[j])).toBe(false);
      }
    }
  });

  test('gaps are configurable', () => {
    // Column gap shows up between columns, row gap between rows of one column.
    const chained = [node({ id: 'a' }), node({ id: 'b' })];
    const tightCol = autoLayout(chained, [edge('a', 'b')], { columnGap: 10 }).nodes;
    const looseCol = autoLayout(chained, [edge('a', 'b')], { columnGap: 200 }).nodes;
    expect(at(looseCol, 'b').x - at(looseCol, 'a').x).toBeGreaterThan(
      at(tightCol, 'b').x - at(tightCol, 'a').x
    );

    const stacked = [node({ id: 'a' }), node({ id: 'b' })];
    const tightRow = autoLayout(stacked, [], { rowGap: 10 }).nodes;
    const looseRow = autoLayout(stacked, [], { rowGap: 200 }).nodes;
    expect(at(looseRow, 'b').y - at(looseRow, 'a').y).toBeGreaterThan(
      at(tightRow, 'b').y - at(tightRow, 'a').y
    );
  });
});

test.describe('repeated layout converges', () => {
  /**
   * Re-fitting a group to its contents can leave it covering a node that was
   * not previously a member, which makes that node a member on the next pass.
   * That is self-consistent rather than wrong — geometry and membership agree —
   * but it must not keep growing, so the sequence is pinned to settling.
   */
  test('applying layout to its own output reaches a fixed point', () => {
    const nodes = [
      node({ id: 'inner', x: 0, y: 0, width: 100, height: 100 }),
      node({ id: 'outer', x: 0, y: 900, width: 200, height: 100 }),
      node({ id: 'far', x: 0, y: 400, width: 200, height: 100 }),
      node({ id: 'g', type: 'group', x: -20, y: -20, width: 260, height: 140 }),
    ];
    const edges = [edge('inner', 'outer'), edge('inner', 'far')];

    let current = nodes;
    const widths: number[] = [];
    for (let i = 0; i < 6; i++) {
      current = autoLayout(current, edges).nodes;
      widths.push(at(current, 'g').width);
    }
    const last = widths[widths.length - 1];
    expect(widths[widths.length - 1]).toBe(widths[widths.length - 2]);
    for (const w of widths) expect(w).toBeLessThanOrEqual(last);
  });

  test('containment still holds at the fixed point', () => {
    const nodes = [
      node({ id: 'inner', x: 0, y: 0, width: 100, height: 100, parentId: 'g' }),
      node({ id: 'outer', x: 0, y: 900, width: 200, height: 100, parentId: 'g' }),
      node({ id: 'far', x: 0, y: 400, width: 200, height: 100, parentId: 'g' }),
      node({ id: 'g', type: 'group', x: -20, y: -20, width: 260, height: 140 }),
    ];
    const edges = [edge('inner', 'outer'), edge('inner', 'far')];

    let current = nodes;
    for (let i = 0; i < 4; i++) current = autoLayout(current, edges).nodes;
    expect(memberOf(current, 'inner', 'g')).toBe(true);
  });
});

test.describe('bounds', () => {
  test('cover everything that was placed', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b', width: 400, height: 300 })];
    const edges = [edge('a', 'b')];
    const { nodes: out, bounds } = autoLayout(nodes, edges);
    for (const n of out) {
      expect(n.x).toBeGreaterThanOrEqual(bounds.x);
      expect(n.y).toBeGreaterThanOrEqual(bounds.y);
      expect(n.x + n.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(n.y + n.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });
});

/**
 * Container-scoped layout (Phase 5).
 *
 * The distinction these pin down: a group is a *scope*, not a bag of nodes that
 * happen to be nearby. Its contents are arranged by edges among themselves, and
 * only then does the group take part in its parent's flow.
 */
test.describe('layout is container-scoped', () => {
  /** A group of three chained nodes, plus an unrelated root node. */
  const scopedBoard = () => ({
    nodes: [
      node({ id: 'g1', x: 0, y: 0, width: 100, height: 100, parentId: 'grp' }),
      node({ id: 'g2', x: 0, y: 0, width: 100, height: 100, parentId: 'grp' }),
      node({ id: 'g3', x: 0, y: 0, width: 100, height: 100, parentId: 'grp' }),
      node({ id: 'loose', x: 0, y: 0, width: 100, height: 100 }),
      node({ id: 'grp', type: 'group', x: 0, y: 0, width: 400, height: 300 }),
    ],
    edges: [edge('g1', 'g2'), edge('g2', 'g3'), edge('loose', 'g1')],
  });

  test('an edge leaving a group does not order the group\'s own contents', () => {
    // `loose -> g1` crosses the boundary. Under the old flat layout it pulled
    // the whole board into one arrangement; now it is simply not a constraint
    // inside `grp`, so the in-group chain is the only thing that positions them.
    const { nodes, edges } = scopedBoard();
    const { levels } = autoLayout(nodes, edges);
    expect(levels.get('g2')).toBe(1);
    expect(levels.get('g3')).toBe(2);
    // `loose` is in the parent scope, so it starts its own flow at level 0.
    expect(levels.get('loose')).toBe(0);
  });

  test('a group\'s contents stay inside it after layout', () => {
    const { nodes, edges } = scopedBoard();
    const out = autoLayout(nodes, edges).nodes;
    const group = at(out, 'grp');
    for (const id of ['g1', 'g2', 'g3']) {
      expect(memberOf(out, id, 'grp')).toBe(true);
      const child = at(out, id);
      expect(
        child.x >= group.x &&
          child.y >= group.y &&
          child.x + child.width <= group.x + group.width &&
          child.y + child.height <= group.y + group.height
      ).toBe(true);
    }
  });

  test('the group and an unrelated root do not overlap', () => {
    const { nodes, edges } = scopedBoard();
    const out = autoLayout(nodes, edges).nodes;
    expect(overlaps(at(out, 'grp'), at(out, 'loose'))).toBe(false);
  });

  test('a structural group keeps the bound the author chose', () => {
    const nodes = [
      node({ id: 'a', x: 0, y: 0, width: 100, height: 100, parentId: 's' }),
      node({ id: 'b', x: 0, y: 0, width: 100, height: 100, parentId: 's' }),
      node({ id: 's', type: 'group', x: 500, y: 500, width: 640, height: 480, membership: 'structural' }),
    ];
    const out = autoLayout(nodes, []).nodes;
    const group = at(out, 's');
    // A spatial group would tighten to its two children; a structural one keeps
    // the frame the author sized, which is the entire point of the mode.
    expect(group.width).toBe(640);
    expect(group.height).toBe(480);
    expect(isStructural(group)).toBe(true);
  });

  test('a spatial group does tighten to its contents', () => {
    const nodes = [
      node({ id: 'a', x: 0, y: 0, width: 100, height: 100, parentId: 'sp' }),
      node({ id: 'b', x: 0, y: 0, width: 100, height: 100, parentId: 'sp' }),
      node({ id: 'sp', type: 'group', x: 0, y: 0, width: 900, height: 700 }),
    ];
    const out = autoLayout(nodes, []).nodes;
    expect(at(out, 'sp').width).toBeLessThan(900);
  });

  test('a cycle inside a group is broken without affecting the parent scope', () => {
    const nodes = [
      node({ id: 'a', x: 0, y: 0, parentId: 'g' }),
      node({ id: 'b', x: 0, y: 0, parentId: 'g' }),
      node({ id: 'g', type: 'group', x: 0, y: 0, width: 300, height: 200 }),
      node({ id: 'out', x: 0, y: 0 }),
    ];
    const result = autoLayout(nodes, [edge('a', 'b'), edge('b', 'a')]);
    expect(result.cycleBrokenEdgeIds).toEqual(['b->a']);
    // The outside node still gets a level, i.e. the parent scope still ran.
    expect(result.levels.has('out')).toBe(true);
  });

  test('layout is deterministic with nesting', () => {
    const { nodes, edges } = scopedBoard();
    const first = autoLayout(nodes, edges).nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]);
    const second = autoLayout(nodes, edges).nodes.map((n) => [n.id, n.x, n.y, n.width, n.height]);
    expect(second).toEqual(first);
  });
});
