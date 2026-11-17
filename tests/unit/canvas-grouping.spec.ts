import { expect, test } from '@playwright/test';
import {
  GROUP_PADDING,
  GroupIndex,
  buildOutline,
  childrenOutsideParent,
  enforceInvariants,
  enforceMembershipPolicy,
  groupBoundsIn,
  flattenOutline,
  groupNodes,
  isGroup,
  isStructural,
  membershipOf,
  normalise,
  refitGroups,
  reparent,
  resolveDropTarget,
  subtreeOf,
  toLocal,
  toWorldNodes,
  topLevelUnitOf,
  topLevelUnits,
  ungroup,
  worldBounds,
  worldOffsets,
  worldPosition,
  MAX_GROUP_DEPTH,
  type WorldNode,
} from '../../src/components/canvas/core/grouping';
import { rectFullyContains, nodeRect } from '../../src/components/canvas/core/geometry';
import type { CanvasEdge, CanvasNode } from '../../src/components/canvas/types';

/**
 * The group tree.
 *
 * These encode the rules from docs/canvas-grouping-design.md. The production
 * bug they exist to prevent: membership was re-derived from geometry by two
 * functions that disagreed, so a group drag moved every overlapping node while
 * the badge showed a third number.
 */

const n = (over: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'n',
  type: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...over,
});
const g = (over: Partial<CanvasNode> = {}): CanvasNode => n({ type: 'group', ...over });

test.describe('coordinates', () => {
  test('root nodes are already in world space', () => {
    const nodes = [n({ id: 'a', x: 10, y: 20 })];
    expect(worldPosition(nodes, 'a')).toEqual({ x: 10, y: 20 });
    expect(toWorldNodes(nodes)[0].x).toBe(10);
  });

  test('nesting does not shift a node: coordinates are absolute', () => {
    /**
     * The load-bearing property of the absolute model. A node's position is its
     * own `x`/`y` no matter how deeply it is nested, which is why reparenting
     * cannot drift and why a migration is a purely additive `parentId`.
     */
    const nodes = [
      g({ id: 'outer', x: 100, y: 100, width: 400, height: 400 }),
      g({ id: 'inner', x: 120, y: 130, width: 200, height: 200, parentId: 'outer' }),
      n({ id: 'leaf', x: 125, y: 137, width: 50, height: 50, parentId: 'inner' }),
    ];
    expect(worldPosition(nodes, 'leaf')).toEqual({ x: 125, y: 137 });
    expect(worldPosition(nodes, 'inner')).toEqual({ x: 120, y: 130 });
  });

  test('the projection is the identity, and toLocal matches it', () => {
    const nodes = [
      g({ id: 'outer', x: 100, y: 100, width: 400, height: 400 }),
      n({ id: 'leaf', x: 105, y: 107, parentId: 'outer' }),
    ];
    // Kept as the single documented conversion point. If these ever stop being
    // the identity, the model has changed and every consumer needs revisiting.
    expect(toWorldNodes(nodes).map((x) => [x.x, x.y])).toEqual([
      [100, 100],
      [105, 107],
    ]);
    expect(toLocal(nodes, 'leaf', 105, 107)).toEqual({ x: 105, y: 107 });
  });

  test('a malformed ancestry degrades to root instead of throwing', () => {
    // Missing parent, self-parent and a cycle must all still render.
    const broken = [
      n({ id: 'a', x: 1, y: 1, parentId: 'ghost' }),
      n({ id: 'b', x: 2, y: 2, parentId: 'b' }),
      g({ id: 'c', x: 0, y: 0, width: 10, height: 10, parentId: 'd' }),
      g({ id: 'd', x: 0, y: 0, width: 10, height: 10, parentId: 'c' }),
    ];
    expect(() => toWorldNodes(broken)).not.toThrow();
    expect(worldOffsets(broken).size).toBe(4);
  });

  test('worldBounds covers the projection', () => {
    const nodes: WorldNode[] = [
      { ...n({ id: 'a', x: 0, y: 0, width: 50, height: 50 }) },
      { ...n({ id: 'b', x: 200, y: 100, width: 50, height: 50 }) },
    ];
    expect(worldBounds(nodes)).toEqual({ x: 0, y: 0, width: 250, height: 150 });
  });

  test('groupBoundsIn pads and unions', () => {
    const children = [n({ x: 0, y: 0, width: 10, height: 10 }), n({ x: 90, y: 90, width: 10, height: 10 })];
    expect(groupBoundsIn(children, 5)).toEqual({ x: -5, y: -5, width: 110, height: 110 });
    expect(groupBoundsIn([], 5)).toBeNull();
  });
});

test.describe('GroupIndex', () => {
  const tree = () => [
    g({ id: 'outer', x: 0, y: 0, width: 600, height: 600 }),
    g({ id: 'inner', x: 50, y: 50, width: 300, height: 300, parentId: 'outer' }),
    n({ id: 'a', x: 60, y: 60, width: 50, height: 50, parentId: 'inner' }),
    n({ id: 'b', x: 400, y: 400, width: 50, height: 50, parentId: 'outer' }),
  ];

  test('child ids are direct only, in document order', () => {
    const idx = new GroupIndex(tree());
    expect([...idx.childIds('outer')].sort()).toEqual(['b', 'inner']);
    expect([...idx.childIds('inner')]).toEqual(['a']);
    expect([...idx.childIds(null)]).toEqual(['outer']);
  });

  test('ancestors and depth', () => {
    const idx = new GroupIndex(tree());
    expect(idx.ancestorIds('a')).toEqual(['inner', 'outer']);
    expect(idx.depth('a')).toBe(2);
    expect(idx.depth('outer')).toBe(0);
  });

  test('descendants include nested groups', () => {
    const idx = new GroupIndex(tree());
    expect(idx.descendantIds('outer').sort()).toEqual(['a', 'b', 'inner']);
    expect(idx.isDescendantOf('outer', 'a')).toBe(true);
    expect(idx.isDescendantOf('inner', 'outer')).toBe(false);
  });

  test('a child dragged outside its group is not counted as a member', () => {
    // The pointer is authoritative, so the *view* follows geometry. This is
    // what stops the badge and the drag set disagreeing.
    const idx = new GroupIndex([g({ id: 'g1', x: 0, y: 0, width: 100, height: 100 }), n({ id: 'c', x: 10, y: 10, width: 20, height: 20, parentId: 'g1' })]);
    expect(idx.containedIds('g1')).toEqual(['c']);
    const moved = new GroupIndex([
      g({ id: 'g1', x: 0, y: 0, width: 100, height: 100 }),
      n({ id: 'c', x: 500, y: 500, width: 20, height: 20, parentId: 'g1' }),
    ]);
    expect(moved.containedIds('g1')).toEqual([]);
  });

  test('cycle detection rejects self-parenting and descendant reparenting', () => {
    const idx = new GroupIndex(tree());
    expect(idx.wouldCreateCycle(['inner'], 'a')).toBe(true);
    expect(idx.wouldCreateCycle(['outer'], 'a')).toBe(true);
    expect(idx.wouldCreateCycle(['b'], 'inner')).toBe(false);
    expect(idx.wouldCreateCycle(['outer'], null)).toBe(false);
  });
});

test.describe('reparent', () => {
  test('preserves world position when the parent changes', () => {
    const nodes = [g({ id: 'g1', x: 100, y: 100, width: 400, height: 400 }), n({ id: 'a', x: 250, y: 250, width: 50, height: 50 })];
    const { nodes: out } = reparent(nodes, ['a'], 'g1');
    // Absolute coordinates mean a reparent is a single pointer write: the node
    // cannot drift, because nothing about its position is recomputed.
    expect(worldPosition(out, 'a')).toEqual({ x: 250, y: 250 });
    expect(out.find((x) => x.id === 'a')!.x).toBe(250);
    expect(out.find((x) => x.id === 'a')!.parentId).toBe('g1');
  });

  test('refuses a cycle and reports why', () => {
    const nodes = [g({ id: 'g1', x: 0, y: 0, width: 400, height: 400 }), g({ id: 'g2', x: 10, y: 10, width: 200, height: 200, parentId: 'g1' })];
    const res = reparent(nodes, ['g1'], 'g2');
    expect(res.changed).toBe(false);
    expect(res.rejected).toBe('cycle');
  });

  test('refuses an unknown parent', () => {
    const res = reparent([n({ id: 'a' })], ['a'], 'ghost');
    expect(res.rejected).toBe('unknown-parent');
  });

  test('reports the groups whose membership changed', () => {
    const nodes = [g({ id: 'g1', x: 0, y: 0, width: 400, height: 400 }), n({ id: 'a', x: 10, y: 10, width: 20, height: 20 })];
    const res = reparent(nodes, ['a'], 'g1');
    expect(res.touchedGroups).toContain('g1');
  });
});

test.describe('grouping and ungrouping', () => {
  test('groupNodes wraps members without moving them', () => {
    const nodes = [n({ id: 'a', x: 0, y: 0, width: 50, height: 50 }), n({ id: 'b', x: 200, y: 100, width: 50, height: 50 })];
    const before = new Map(nodes.map((x) => [x.id, worldPosition(nodes, x.id)!]));
    const { nodes: out, group } = groupNodes(nodes, ['a', 'b'], { id: 'g1' });
    for (const id of ['a', 'b']) {
      expect(worldPosition(out, id)).toEqual(before.get(id));
    }
    expect(out[0].id).toBe('g1');
    expect(group.type).toBe('group');
    // The group is laid behind its members, so it leads the document.
    expect(out.indexOf(out.find((x) => x.id === 'a')!)).toBeGreaterThan(0);
  });

  test('groupNodes needs at least two nodes', () => {
    expect(() => groupNodes([n({ id: 'a' })], ['a'], { id: 'g1' })).toThrow();
  });

  test('ungroup keeps children, their positions and their order', () => {
    const nodes = [
      g({ id: 'g1', x: 100, y: 100, width: 400, height: 400 }),
      n({ id: 'a', x: 150, y: 150, width: 50, height: 50, parentId: 'g1' }),
      n({ id: 'b', x: 200, y: 200, width: 50, height: 50, parentId: 'g1' }),
    ];
    const before = worldPosition(nodes, 'a')!;
    const out = ungroup(nodes, 'g1').nodes;
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
    expect(worldPosition(out, 'a')).toEqual(before);
    expect(out.every((x) => !x.parentId)).toBe(true);
  });

  test('ungroup is not recursive: an inner group survives', () => {
    const nodes = [
      g({ id: 'outer', x: 0, y: 0, width: 600, height: 600 }),
      g({ id: 'inner', x: 50, y: 50, width: 300, height: 300, parentId: 'outer' }),
      n({ id: 'a', x: 60, y: 60, width: 40, height: 40, parentId: 'inner' }),
      n({ id: 'b', x: 120, y: 120, width: 40, height: 40, parentId: 'inner' }),
    ];
    const out = ungroup(nodes, 'outer').nodes;
    // The outer group is gone; the inner one and its subtree are not.
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b', 'inner']);
    expect(out.find((x) => x.id === 'a')!.parentId).toBe('inner');
  });
});

test.describe('invariants', () => {
  test('a group with no members is removed', () => {
    const out = enforceInvariants([g({ id: 'g1', x: 0, y: 0, width: 100, height: 100 })]);
    expect(out).toEqual([]);
  });

  test('a member outside the frame still counts as a member', () => {
    /**
     * Membership is the pointer; geometry only decides whether the child is
     * inside the *frame*. Counting by containment dissolved any structural group
     * with one inside and one outside child — the exact arrangement the mode
     * exists to allow — on the following commit.
     */
    const nodes = [
      g({ id: 's', x: 0, y: 0, width: 200, height: 200, membership: 'structural' }),
      n({ id: 'in', x: 20, y: 20, width: 40, height: 40, parentId: 's' }),
      n({ id: 'out', x: 900, y: 900, width: 40, height: 40, parentId: 's' }),
    ];
    const out = enforceInvariants(nodes);
    expect(out.map((x) => x.id).sort()).toEqual(['in', 'out', 's']);
    expect(out.find((x) => x.id === 'out')!.parentId).toBe('s');
  });

  test('a group with one member dissolves and reparents it', () => {
    // tldraw's documented threshold pair: delete at 0, dissolve at 1.
    const nodes = [g({ id: 'g1', x: 0, y: 0, width: 200, height: 200 }), n({ id: 'a', x: 20, y: 20, width: 40, height: 40, parentId: 'g1' })];
    const out = enforceInvariants(nodes);
    expect(out.map((x) => x.id)).toEqual(['a']);
    expect(out[0].parentId).toBeUndefined();
  });

  test('a dissolved group hands its survivor to the grandparent', () => {
    const nodes = [
      g({ id: 'outer', x: 0, y: 0, width: 600, height: 600 }),
      g({ id: 'mid', x: 50, y: 50, width: 300, height: 300, parentId: 'outer' }),
      n({ id: 'a', x: 60, y: 60, width: 40, height: 40, parentId: 'mid' }),
      n({ id: 'b', x: 120, y: 120, width: 40, height: 40, parentId: 'mid' }),
      n({ id: 'c', x: 400, y: 400, width: 40, height: 40, parentId: 'outer' }),
      n({ id: 'd', x: 450, y: 450, width: 40, height: 40, parentId: 'outer' }),
    ];
    // `mid` has two members, so refit it; make it a single member to dissolve.
    const oneMember = nodes.map((x) => (x.id === 'b' ? { ...x, parentId: 'outer' as string } : x));
    const out = enforceInvariants(oneMember);
    const midGone = !out.some((x) => x.id === 'mid');
    expect(midGone).toBe(true);
    expect(out.find((x) => x.id === 'a')!.parentId).toBe('outer');
  });

  test('a surviving group is re-fitted to its members', () => {
    // The group starts larger than its contents and is tightened to fit.
    const nodes = [
      g({ id: 'g1', x: 0, y: 0, width: 900, height: 900 }),
      n({ id: 'a', x: 100, y: 100, width: 40, height: 40, parentId: 'g1' }),
      n({ id: 'b', x: 300, y: 200, width: 40, height: 40, parentId: 'g1' }),
    ];
    const out = enforceInvariants(nodes);
    const group = out.find((x) => x.id === 'g1')!;
    // Bounds derived from members plus padding, in the group's own local space
    // (it is a root, so that space is world space here).
    expect(group.x).toBe(100 - GROUP_PADDING);
    expect(group.y).toBe(100 - GROUP_PADDING);
    expect(group.width).toBe(340 - 100 + GROUP_PADDING * 2);
    expect(group.height).toBe(240 - 100 + GROUP_PADDING * 2);
  });

  test('manual bounds are respected when pinned', () => {
    const nodes = [
      g({ id: 'g1', x: 0, y: 0, width: 900, height: 900 }),
      n({ id: 'a', x: 20, y: 20, width: 40, height: 40, parentId: 'g1' }),
      n({ id: 'b', x: 60, y: 60, width: 40, height: 40, parentId: 'g1' }),
    ];
    const out = enforceInvariants(nodes, { manualGroupBounds: new Set(['g1']) });
    expect(out.find((x) => x.id === 'g1')!.width).toBe(900);
  });

  test('a parent that is not a group is dropped', () => {
    const out = enforceInvariants([
      n({ id: 'host', x: 0, y: 0, width: 400, height: 400 }),
      n({ id: 'child', x: 10, y: 10, width: 40, height: 40, parentId: 'host' }),
    ]);
    expect(out.find((x) => x.id === 'child')!.parentId).toBeUndefined();
  });

  test('a cycle is broken rather than hanging', () => {
    const out = enforceInvariants([
      g({ id: 'g1', x: 0, y: 0, width: 400, height: 400, parentId: 'g2' }),
      g({ id: 'g2', x: 10, y: 10, width: 200, height: 200, parentId: 'g1' }),
      n({ id: 'a', x: 20, y: 20, width: 40, height: 40, parentId: 'g1' }),
      n({ id: 'b', x: 80, y: 80, width: 40, height: 40, parentId: 'g2' }),
    ]);
    expect(() => out).not.toThrow();
    // Every surviving parent link is acyclic.
    const idx = new GroupIndex(out);
    for (const node of out) {
      if (node.parentId) expect(idx.isDescendantOf(node.id, node.parentId)).toBe(false);
    }
  });

  test('a self-parent is dropped', () => {
    const out = enforceInvariants([
      g({ id: 'g1', x: 0, y: 0, width: 200, height: 200, parentId: 'g1' }),
      n({ id: 'a', x: 20, y: 20, width: 40, height: 40, parentId: 'g1' }),
      n({ id: 'b', x: 80, y: 80, width: 40, height: 40, parentId: 'g1' }),
    ]);
    const self = out.find((x) => x.id === 'g1')!;
    expect(self.parentId).toBeUndefined();
  });
});

test.describe('refitGroups', () => {
  /**
   * Regression guard for the two ways the previous delta-shifting
   * implementation failed. Both produced plausible-looking documents that were
   * only wrong in ways the migration assertions did not reach:
   *
   *  1. Nested groups drifted, because a group was re-based once by its own
   *     frame and again by its ancestor, and the second re-base moved it
   *     without re-basing its children.
   *  2. It never converged, because a parent unioned its child's *incoming*
   *     extent, so the frame moved again on the next pass.
   */
  test('settles in a single pass and is idempotent', () => {
    const nodes = [
      g({ id: 'outer', x: 0, y: 0, width: 800, height: 800 }),
      g({ id: 'inner', x: 100, y: 100, width: 400, height: 400, parentId: 'outer' }),
      n({ id: 'a', x: 50, y: 50, width: 50, height: 50, parentId: 'inner' }),
      n({ id: 'b', x: 150, y: 150, width: 50, height: 50, parentId: 'inner' }),
      n({ id: 'c', x: 600, y: 600, width: 50, height: 50, parentId: 'outer' }),
    ];
    const key = (list: readonly CanvasNode[]) =>
      JSON.stringify(list.map((x) => [x.id, x.parentId ?? null, x.x, x.y, x.width, x.height]));

    const first = refitGroups(nodes);
    // One pass is already the fixed point.
    expect(key(refitGroups(first))).toBe(key(first));
    expect(key(refitGroups(refitGroups(first)))).toBe(key(first));
  });

  test('preserves every leaf world position through a nested refit', () => {
    const nodes = [
      g({ id: 'outer', x: 0, y: 0, width: 800, height: 800 }),
      g({ id: 'inner', x: 100, y: 100, width: 400, height: 400, parentId: 'outer' }),
      n({ id: 'a', x: 150, y: 150, width: 50, height: 50, parentId: 'inner' }),
      n({ id: 'b', x: 250, y: 250, width: 50, height: 50, parentId: 'inner' }),
      n({ id: 'c', x: 600, y: 600, width: 50, height: 50, parentId: 'outer' }),
    ];
    const before = new Map(nodes.map((x) => [x.id, worldPosition(nodes, x.id)]));
    const after = refitGroups(nodes);
    for (const node of after) {
      if (isGroup(node)) continue;
      expect(worldPosition(after, node.id)).toEqual(before.get(node.id));
    }
  });

  test('a child dragged outside stays parented but does not stretch the group', () => {
    const nodes = [
      g({ id: 'grp', x: 0, y: 0, width: 200, height: 200 }),
      n({ id: 'in1', x: 20, y: 20, width: 50, height: 50, parentId: 'grp' }),
      n({ id: 'in2', x: 90, y: 90, width: 50, height: 50, parentId: 'grp' }),
      n({ id: 'stray', x: 900, y: 900, width: 50, height: 50, parentId: 'grp' }),
    ];
    const after = refitGroups(nodes);
    // Parentage is untouched.
    expect(after.find((x) => x.id === 'stray')!.parentId).toBe('grp');
    // The frame hugs only what is actually inside it.
    expect(after.find((x) => x.id === 'grp')!.width).toBeLessThan(200);
  });
});

test.describe('normalise (migration)', () => {
  test('derives parentId from containment', () => {
    // Two members: a group with a single child dissolves by design, so a
    // one-child fixture would not survive long enough to assert anything.
    const nodes = [
      g({ id: 'g1', x: 0, y: 0, width: 500, height: 500 }),
      n({ id: 'a', x: 100, y: 100, width: 50, height: 50 }),
      n({ id: 'b', x: 200, y: 200, width: 50, height: 50 }),
      n({ id: 'far', x: 900, y: 900, width: 50, height: 50 }),
    ];
    const r = normalise(nodes);
    expect(r.nodes.find((x) => x.id === 'a')!.parentId).toBe('g1');
    expect(r.nodes.find((x) => x.id === 'b')!.parentId).toBe('g1');
    expect(r.nodes.find((x) => x.id === 'far')!.parentId).toBeUndefined();
    expect(r.adopted).toBe(2);
  });

  test('leaves coordinates completely alone', () => {
    /**
     * The whole point of keeping `x`/`y` absolute: converting a document is a
     * purely additive change. If this test ever starts failing because
     * "something had to be adjusted", the model has drifted back toward
     * parent-relative storage and the migration is no longer reviewable.
     */
    const nodes = [
      g({ id: 'g1', x: 100, y: 100, width: 500, height: 500 }),
      n({ id: 'a', x: 250, y: 260, width: 50, height: 50 }),
      n({ id: 'b', x: 400, y: 300, width: 50, height: 50 }),
    ];
    const r = normalise(nodes);

    // Content is not touched at all, not merely preserved in world space.
    for (const id of ['a', 'b']) {
      const before = nodes.find((x) => x.id === id)!;
      const after = r.nodes.find((x) => x.id === id)!;
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
    }

    // Group frames are still re-derived, so a group that started larger than its
    // contents tightens around them.
    const group = r.nodes.find((x) => x.id === 'g1')!;
    expect(group.width).toBeLessThan(500);
  });

  test('nested groups survive, via the innermost container', () => {
    const nodes = [
      g({ id: 'outer', x: 0, y: 0, width: 800, height: 800 }),
      g({ id: 'inner', x: 100, y: 100, width: 400, height: 400 }),
      n({ id: 'a', x: 150, y: 150, width: 50, height: 50 }),
      n({ id: 'b', x: 250, y: 250, width: 50, height: 50 }),
      // A third node in `outer` but outside `inner`, so `outer` is not itself
      // a single-child group and dissolves.
      n({ id: 'c', x: 600, y: 600, width: 50, height: 50 }),
    ];
    const r = normalise(nodes);
    expect(r.nodes.find((x) => x.id === 'inner')!.parentId).toBe('outer');
    expect(r.nodes.find((x) => x.id === 'a')!.parentId).toBe('inner');
    expect(r.nodes.find((x) => x.id === 'b')!.parentId).toBe('inner');
    expect(r.nodes.find((x) => x.id === 'c')!.parentId).toBe('outer');
    // The chain is intact after the coordinate rewrite.
    const idx = new GroupIndex(r.nodes);
    expect(idx.ancestorIds('a')).toEqual(['inner', 'outer']);
  });

  test('an ambiguous node joins the smaller group, not both', () => {
    // Two overlapping groups. Single-parent membership has to pick a winner.
    const nodes = [
      g({ id: 'big', x: 0, y: 0, width: 800, height: 800 }),
      g({ id: 'small', x: 100, y: 100, width: 300, height: 300 }),
      n({ id: 'a', x: 150, y: 150, width: 50, height: 50 }),
      n({ id: 'b', x: 220, y: 220, width: 50, height: 50 }),
    ];
    const r = normalise(nodes);
    // Both of the overlapping nodes resolve to the smaller group.
    expect(r.nodes.find((x) => x.id === 'a')!.parentId).toBe('small');
    expect(r.nodes.find((x) => x.id === 'b')!.parentId).toBe('small');
  });

  test('a node that merely overlaps a group does not join it', () => {
    const nodes = [g({ id: 'g1', x: 0, y: 0, width: 200, height: 200 }), n({ id: 'a', x: 150, y: 150, width: 300, height: 300 })];
    const r = normalise(nodes);
    expect(r.nodes.find((x) => x.id === 'a')!.parentId).toBeUndefined();
  });

  test('an empty group is dropped', () => {
    const r = normalise([g({ id: 'g1', x: 0, y: 0, width: 100, height: 100 })]);
    expect(r.nodes).toEqual([]);
    expect(r.groupsRemoved).toBe(1);
  });

  test('is idempotent: normalising twice changes nothing', () => {
    const nodes = [
      g({ id: 'outer', x: 0, y: 0, width: 800, height: 800 }),
      g({ id: 'inner', x: 100, y: 100, width: 400, height: 400 }),
      n({ id: 'a', x: 150, y: 150, width: 50, height: 50 }),
      n({ id: 'b', x: 600, y: 600, width: 50, height: 50 }),
    ];
    const first = normalise(nodes);
    const second = normalise(first.nodes, { alreadyHasParentId: true });
    expect(second.alreadyCurrent).toBe(true);
    const key = (list: readonly CanvasNode[]) =>
      list.map((x) => `${x.id}:${x.parentId ?? '-'}:${x.x},${y_(x)}`).join('|');
    const y_ = (x: CanvasNode) => x.y;
    expect(key(second.nodes)).toBe(key(first.nodes));
  });

  test('every child ends up inside its parent in world space', () => {
    const nodes = [
      g({ id: 'outer', x: -300, y: -200, width: 900, height: 700 }),
      g({ id: 'inner', x: 100, y: 100, width: 400, height: 300 }),
      n({ id: 'a', x: 150, y: 150, width: 200, height: 100 }),
      n({ id: 'b', x: 200, y: 250, width: 100, height: 100 }),
      n({ id: 'c', x: 400, y: 400, width: 100, height: 100 }),
    ];
    const r = normalise(nodes);
    const world = new Map(toWorldNodes(r.nodes).map((x) => [x.id, x]));
    for (const node of r.nodes) {
      if (!node.parentId) continue;
      const parent = world.get(node.parentId)!;
      const child = world.get(node.id)!;
      expect(rectFullyContains(nodeRect(parent), nodeRect(child))).toBe(true);
    }
  });
});

test.describe('isGroup', () => {
  test('is a type check, not a geometry check', () => {
    expect(isGroup(g())).toBe(true);
    expect(isGroup(n())).toBe(false);
  });
});

test.describe('child membership', () => {
  /** Three children, two of them inside a 100x100 frame. */
  const groupWith = (extra: Partial<CanvasNode>) => [
    g({ id: 'box', x: 0, y: 0, width: 100, height: 100, ...extra }),
    n({ id: 'out', x: 500, y: 500, width: 50, height: 50, parentId: 'box' }),
    n({ id: 'in1', x: 10, y: 10, width: 50, height: 50, parentId: 'box' }),
    n({ id: 'in2', x: 20, y: 20, width: 40, height: 40, parentId: 'box' }),
  ];

  test('membership defaults to spatial', () => {
    expect(membershipOf({})).toBe('spatial');
    expect(membershipOf({ membership: 'structural' })).toBe('structural');
    expect(isStructural(g({ id: 'x' }))).toBe(false);
    expect(isStructural(g({ id: 'x', membership: 'structural' }))).toBe(true);
    // Only groups have a meaningful mode.
    expect(isStructural(n({ id: 'x', membership: 'structural' } as Partial<CanvasNode>))).toBe(false);
  });

  test('a spatial group releases a child dragged clear of its frame', () => {
    const r = enforceMembershipPolicy(groupWith({}));
    expect(r.detached).toEqual(['out']);
    const by = new Map(r.nodes.map((x) => [x.id, x]));
    expect(by.get('out')!.parentId).toBeUndefined();
    expect(by.get('in1')!.parentId).toBe('box');
    expect(by.get('in2')!.parentId).toBe('box');
    // Two children remain, so the group survives the dissolve-at-1 threshold.
    expect(by.get('box')).toBeDefined();
  });

  test('a structural group never releases implicitly', () => {
    const r = enforceMembershipPolicy(groupWith({ membership: 'structural' }));
    expect(r.detached).toEqual([]);
    expect(r.nodes.find((x) => x.id === 'out')!.parentId).toBe('box');
  });

  test('the outside marker is derived, and only structural groups keep one', () => {
    const structural = enforceMembershipPolicy(groupWith({ membership: 'structural' })).nodes;
    expect(childrenOutsideParent(new GroupIndex(structural), 'box')).toEqual(['out']);
    // A spatial document can never rest in that state, so the marker is empty.
    const spatial = enforceMembershipPolicy(groupWith({})).nodes;
    expect(childrenOutsideParent(new GroupIndex(spatial), 'box')).toEqual([]);
  });

  test('an unknown group has no members to report', () => {
    expect(childrenOutsideParent(new GroupIndex(groupWith({})), 'ghost')).toEqual([]);
  });

  test('releasing a child cannot leave a dangling pointer', () => {
    // The child is handed to the nearest surviving ancestor, not to a parent
    // that is about to be dissolved.
    const nested: CanvasNode[] = [
      g({ id: 'outer', x: 0, y: 0, width: 400, height: 400 }),
      g({ id: 'mid', x: 50, y: 50, width: 200, height: 200, parentId: 'outer' }),
      n({ id: 'escapee', x: 900, y: 900, parentId: 'mid' }),
    ];
    const r = enforceMembershipPolicy(nested);
    for (const node of r.nodes) {
      if (node.parentId) expect(r.nodes.some((p) => p.id === node.parentId)).toBe(true);
    }
  });
});

test.describe('buildOutline', () => {
  const tree = (): CanvasNode[] => [
    g({ id: 'outer', x: 0, y: 0, width: 400, height: 400 }),
    g({ id: 'inner', x: 50, y: 50, width: 200, height: 200, parentId: 'outer' }),
    n({ id: 'a', x: 60, y: 60, parentId: 'inner' }),
    n({ id: 'b', x: 250, y: 250, parentId: 'outer' }),
    n({ id: 'loose', x: 900, y: 900 }),
  ];

  test('mirrors the parent tree, in document order, with depth', () => {
    expect(flattenOutline(buildOutline(tree())).map((e) => `${'  '.repeat(e.depth)}${e.id}`)).toEqual([
      'outer',
      '  inner',
      '    a',
      '  b',
      'loose',
    ]);
  });

  test('reports containment and the outside marker per group', () => {
    const outer = buildOutline(tree())[0];
    expect(outer.containedCount).toBe(2);
    expect(outer.outsideChildIds).toEqual([]);
  });

  test('collapse hides a subtree without losing it', () => {
    const roots = buildOutline(tree());
    // The collapsed row is still listed — it is the header that can be
    // expanded again — only its children are hidden.
    expect(flattenOutline(roots, new Set(['inner'])).map((e) => e.id)).toEqual([
      'outer',
      'inner',
      'b',
      'loose',
    ]);
    // Expanding again still reaches the hidden node.
    expect(flattenOutline(roots).map((e) => e.id)).toContain('a');
  });

  test('a cycle is cut instead of recursing forever', () => {
    const cyclic: CanvasNode[] = [
      g({ id: 'x', parentId: 'y' }),
      g({ id: 'y', parentId: 'x' }),
    ];
    expect(() => buildOutline(cyclic)).not.toThrow();
    // A pure cycle has no root, so nothing is listed; the point is that it
    // terminates and the document still renders.
    expect(flattenOutline(buildOutline(cyclic))).toEqual([]);
  });

  test('a deep chain is capped rather than overflowing the stack', () => {
    const deep: CanvasNode[] = [];
    for (let i = 0; i < MAX_GROUP_DEPTH + 12; i++) {
      deep.push(g({ id: `g${i}`, x: i, y: i, width: 100, height: 100, parentId: i === 0 ? undefined : `g${i - 1}` }));
    }
    expect(() => buildOutline(deep)).not.toThrow();
    expect(flattenOutline(buildOutline(deep)).length).toBeLessThan(deep.length);
  });
});

test.describe('resolveDropTarget', () => {
  const nested = (): CanvasNode[] => [
    g({ id: 'outer', x: 0, y: 0, width: 400, height: 400 }),
    g({ id: 'inner', x: 50, y: 50, width: 200, height: 200, parentId: 'outer' }),
    n({ id: 'far', x: 900, y: 900 }),
  ];

  test('overlapping candidates resolve to the innermost group', () => {
    // This matches how the migration originally inferred membership, so
    // dropping onto nested groups behaves the same as it did before.
    expect(resolveDropTarget(nested(), new Set(['far']), { x: 100, y: 100 })?.groupId).toBe('inner');
  });

  test('a lone candidate is reported as such', () => {
    expect(resolveDropTarget(nested(), new Set(['far']), { x: 380, y: 380 })).toEqual({
      groupId: 'outer',
      kind: 'only',
    });
  });

  test('empty space is not a target', () => {
    expect(resolveDropTarget(nested(), new Set(['far']), { x: 500, y: 500 })).toBeNull();
    expect(resolveDropTarget(nested(), new Set(), { x: 100, y: 100 })).toBeNull();
  });

  test('a group is never a target for its own subtree', () => {
    expect(resolveDropTarget(nested(), new Set(['inner']), { x: 100, y: 100 })).toBeNull();
  });

  test('the dragged node is not its own drop target', () => {
    const solo: CanvasNode[] = [g({ id: 'only', x: 0, y: 0, width: 100, height: 100 })];
    expect(resolveDropTarget(solo, new Set(['only']), { x: 50, y: 50 })).toBeNull();
  });
});

test.describe('top-level units', () => {
  const tree = (): CanvasNode[] => [
    g({ id: 'outer', x: 0, y: 0, width: 400, height: 400 }),
    g({ id: 'inner', x: 50, y: 50, width: 200, height: 200, parentId: 'outer' }),
    n({ id: 'a', x: 60, y: 60, parentId: 'inner' }),
    n({ id: 'loose', x: 900, y: 900 }),
  ];

  test('a nested node resolves to its outermost group', () => {
    const index = new GroupIndex(tree());
    expect(topLevelUnitOf(index, 'a')).toBe('outer');
    expect(topLevelUnitOf(index, 'inner')).toBe('outer');
    expect(topLevelUnitOf(index, 'loose')).toBe('loose');
    expect(topLevelUnitOf(index, 'ghost')).toBe('ghost');
  });

  test('a selection collapses to whole units, deduplicated', () => {
    // Dragging a group must never grab a fragment of it.
    expect([...topLevelUnits(new GroupIndex(tree()), ['a', 'inner', 'loose'])].sort()).toEqual([
      'loose',
      'outer',
    ]);
  });
});

test.describe('subtreeOf', () => {
  const tree = (): CanvasNode[] => [
    g({ id: 'outer', x: 0, y: 0, width: 400, height: 400 }),
    g({ id: 'inner', x: 50, y: 50, width: 200, height: 200, parentId: 'outer' }),
    n({ id: 'a', x: 60, y: 60, parentId: 'inner' }),
    n({ id: 'b', x: 250, y: 250, parentId: 'outer' }),
    n({ id: 'loose', x: 900, y: 900 }),
  ];
  const edges: CanvasEdge[] = [
    { id: 'e1', fromNode: 'a', toNode: 'b' },
    { id: 'e2', fromNode: 'a', toNode: 'loose' },
    { id: 'e3', fromNode: 'loose', toNode: 'b' },
  ];

  test('lifts a group and its whole subtree', () => {
    const { nodes } = subtreeOf(tree(), 'inner');
    expect(nodes.map((x) => x.id).sort()).toEqual(['a', 'inner']);
  });

  test('keeps only the edges wholly inside the subtree', () => {
    // An edge leaving the subtree would dangle in the extracted document.
    const { edges: kept } = subtreeOf(tree(), 'outer', edges);
    expect(kept.map((e) => e.id)).toEqual(['e1']);
  });

  test('an unknown group yields nothing rather than throwing', () => {
    expect(subtreeOf(tree(), 'ghost')).toEqual({ nodes: [], edges: [] });
  });

  test('a leaf group is just itself', () => {
    const { nodes } = subtreeOf(tree(), 'a');
    expect(nodes.map((x) => x.id)).toEqual(['a']);
  });
});
