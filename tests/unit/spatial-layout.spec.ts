import { expect, test } from '@playwright/test';
import { adjacencyCSR, placeIncremental, structuralLayout } from '../../src/lib/spatial-tiles/layout';

/** A synthetic workspace: root -> users -> folders -> docs, with uneven fan-out. */
function tree(users: number, foldersPerUser: number, docsPerFolder: (f: number) => number) {
  const parent: number[] = [-1]; // 0 = space root
  const userIds: number[] = [];
  for (let u = 0; u < users; u++) {
    userIds.push(parent.length);
    parent.push(0);
  }
  for (const u of userIds) {
    for (let f = 0; f < foldersPerUser; f++) {
      const folder = parent.length;
      parent.push(u);
      const docs = docsPerFolder(f);
      for (let d = 0; d < docs; d++) parent.push(folder);
    }
  }
  return Int32Array.from(parent);
}

test.describe('structural layout', () => {
  test('places every item at a finite position', () => {
    const parent = tree(20, 8, (f) => (f === 0 ? 400 : 10 + f * 7));
    const { x, y } = structuralLayout({ count: parent.length, parent });
    let bad = 0;
    for (let i = 0; i < parent.length; i++) if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) bad++;
    expect(bad).toBe(0);
  });

  test('sibling subtrees occupy disjoint disks', () => {
    const parent = tree(12, 6, (f) => 5 + f * 30);
    const { x, y, radius } = structuralLayout({ count: parent.length, parent }, { spacing: 20 });
    // Group non-leaf children by parent.
    const byParent = new Map<number, number[]>();
    for (let i = 0; i < parent.length; i++) {
      if (parent[i] < 0 || radius[i] === 0) continue;
      const list = byParent.get(parent[i]) ?? [];
      list.push(i);
      byParent.set(parent[i], list);
    }
    let overlaps = 0;
    let pairs = 0;
    for (const list of byParent.values()) {
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          pairs++;
          const i = list[a];
          const j = list[b];
          const d = Math.hypot(x[i] - x[j], y[i] - y[j]);
          if (d + 1e-3 < radius[i] + radius[j]) overlaps++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(50);
    expect(overlaps).toBe(0);
  });

  test('leaf children sit around their parent, within its disk', () => {
    const parent = tree(1, 1, () => 500);
    const { x, y, radius } = structuralLayout({ count: parent.length, parent });
    const folder = 2;
    let outside = 0;
    for (let i = 3; i < parent.length; i++) {
      if (Math.hypot(x[i] - x[folder], y[i] - y[folder]) > radius[folder] + 1e-3) outside++;
    }
    expect(outside).toBe(0);
    // Area grows with the number of leaves: ~sqrt scaling, not linear.
    const small = structuralLayout({ count: tree(1, 1, () => 100).length, parent: tree(1, 1, () => 100) });
    expect(radius[folder] / small.radius[folder]).toBeGreaterThan(1.8);
    expect(radius[folder] / small.radius[folder]).toBeLessThan(2.6);
  });

  test('survives parent cycles and dangling parents', () => {
    const parent = Int32Array.from([1, 2, 0, 99, -1, 4, 5]);
    const { x, y } = structuralLayout({ count: parent.length, parent });
    expect(Array.from(x).every(Number.isFinite)).toBe(true);
    expect(Array.from(y).every(Number.isFinite)).toBe(true);
  });

  test('is deterministic', () => {
    const parent = tree(5, 3, (f) => 20 + f);
    const a = structuralLayout({ count: parent.length, parent });
    const b = structuralLayout({ count: parent.length, parent });
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
  });

  test('parentless linked items move beside what they link to', () => {
    const parent = Int32Array.from([-1, 0, 0, 0, -1]);
    const src = Uint32Array.from([4]);
    const dst = Uint32Array.from([2]);
    const { linkStart, linkTargets } = adjacencyCSR(5, src, dst);
    const { x, y } = structuralLayout({ count: 5, parent, linkStart, linkTargets }, { spacing: 24 });
    expect(Math.hypot(x[4] - x[2], y[4] - y[2])).toBeLessThan(24 * 2);
  });

  test('handles a million-item tree in linear time', () => {
    const parent = tree(1000, 10, (f) => (f === 0 ? 50 : 95));
    expect(parent.length).toBeGreaterThan(900000);
    const started = performance.now();
    const { x } = structuralLayout({ count: parent.length, parent });
    const elapsed = performance.now() - started;
    expect(x.length).toBe(parent.length);
    // Generous: a linear pass is ~100-300 ms here; quadratic would be hours.
    expect(elapsed).toBeLessThan(10000);
  });
});

test.describe('incremental placement', () => {
  test('moves nothing that was already placed', () => {
    const parent = tree(4, 3, () => 30);
    const base = structuralLayout({ count: parent.length, parent });
    // Append new children to folder 5 and a new folder with its own child.
    const extra = Int32Array.from([...parent, 5, 5, parent.length + 3, parent.length + 2, -1]);
    const x = new Float32Array(extra.length).fill(NaN);
    const y = new Float32Array(extra.length).fill(NaN);
    x.set(base.x);
    y.set(base.y);
    const before = x.slice(0, parent.length);
    const placed = placeIncremental({ count: extra.length, parent: extra, x, y });
    expect(placed.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4].map((k) => parent.length + k));
    expect(Array.from(x.slice(0, parent.length))).toEqual(Array.from(before));
    expect(Array.from(x).every(Number.isFinite)).toBe(true);
    // New children land near their parent.
    const folder = 5;
    const d = Math.hypot(x[parent.length] - x[folder], y[parent.length] - y[folder]);
    expect(d).toBeLessThan(base.radius[folder] + 200);
  });

  test('terminates when an anchor can never be placed', () => {
    // 0 -> 1 -> 0 cycle, both unplaced: cycle is broken, both get positions.
    const parent = Int32Array.from([1, 0]);
    const x = Float32Array.from([NaN, NaN]);
    const y = Float32Array.from([NaN, NaN]);
    placeIncremental({ count: 2, parent, x, y });
    expect(Number.isFinite(x[0]) && Number.isFinite(x[1])).toBe(true);
  });
});
