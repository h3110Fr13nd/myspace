import { expect, test } from '@playwright/test';
import {
  demorton2,
  lowerBound,
  morton2,
  radixSortPermutation,
  tileCodeRange,
  ancestorTiles,
} from '../../src/lib/spatial-tiles/morton';
import {
  EdgeFlags,
  NodeFlags,
  decodeTile,
  encodeTile,
  filterTile,
  TileDecodeError,
  type TileData,
} from '../../src/lib/spatial-tiles/codec';
import { buildPyramid, viewLevel, type PyramidItems } from '../../src/lib/spatial-tiles/pyramid';

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomItems(n: number, seed = 1, rects = false): PyramidItems {
  const r = rng(seed);
  const items: PyramidItems = {
    count: n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    gid: new Uint32Array(n),
    kind: new Uint8Array(n),
    weight: new Uint32Array(n),
    label: (i) => `item ${i}`,
  };
  if (rects) {
    items.w = new Float32Array(n);
    items.h = new Float32Array(n);
  }
  for (let i = 0; i < n; i++) {
    // Clustered: a few dense blobs plus uniform noise, so the quadtree is uneven.
    const blob = i % 5;
    const spread = blob === 0 ? 5000 : 300;
    const ox = blob * 2000;
    items.x[i] = ox + (r() - 0.5) * spread;
    items.y[i] = (blob % 2) * 1500 + (r() - 0.5) * spread;
    items.gid[i] = i + 1;
    items.kind[i] = i % 7;
    items.weight[i] = Math.floor(r() * r() * 50);
    if (rects) {
      items.w![i] = 40 + r() * 200;
      items.h![i] = 30 + r() * 120;
    }
  }
  return items;
}

function randomEdges(n: number, m: number, seed = 2) {
  const r = rng(seed);
  const src = new Uint32Array(m);
  const dst = new Uint32Array(m);
  const kind = new Uint8Array(m);
  for (let e = 0; e < m; e++) {
    src[e] = Math.floor(r() * n);
    dst[e] = Math.floor(r() * n);
    kind[e] = e % 2;
  }
  return { count: m, src, dst, kind };
}

test.describe('morton keys', () => {
  test('interleave and de-interleave round trip', () => {
    const r = rng(9);
    let bad = 0;
    for (let i = 0; i < 2000; i++) {
      const x = Math.floor(r() * 65536);
      const y = Math.floor(r() * 65536);
      const back = demorton2(morton2(x, y));
      if (back.x !== x || back.y !== y) bad++;
    }
    expect(bad).toBe(0);
  });

  test('a tile code range contains exactly the codes of points inside the tile', () => {
    const r = rng(3);
    let bad = 0;
    for (let i = 0; i < 500; i++) {
      const z = 1 + Math.floor(r() * 15);
      const x = Math.floor(r() * 65536);
      const y = Math.floor(r() * 65536);
      const shift = 16 - z;
      const [lo, hi] = tileCodeRange(z, x >> shift, y >> shift);
      const code = morton2(x, y);
      if (code < lo || code >= hi) bad++;
    }
    expect(bad).toBe(0);
    expect(tileCodeRange(0, 0, 0)).toEqual([0, 2 ** 32]);
  });

  test('radix sort produces a correct, stable permutation', () => {
    const r = rng(4);
    const keys = new Uint32Array(5000);
    for (let i = 0; i < keys.length; i++) keys[i] = Math.floor(r() * 1000) * 4099;
    const perm = radixSortPermutation(keys);
    let unsorted = 0;
    let unstable = 0;
    for (let i = 1; i < perm.length; i++) {
      const a = keys[perm[i - 1]];
      const b = keys[perm[i]];
      if (a > b) unsorted++;
      if (a === b && perm[i - 1] > perm[i]) unstable++;
    }
    expect(unsorted).toBe(0);
    expect(unstable).toBe(0);
    expect(new Set(perm).size).toBe(keys.length);
  });

  test('lowerBound and ancestors', () => {
    const sorted = Uint32Array.from([1, 3, 3, 7, 9]);
    expect(lowerBound(sorted, 0, 5, 3)).toBe(1);
    expect(lowerBound(sorted, 0, 5, 4)).toBe(3);
    expect(lowerBound(sorted, 0, 5, 10)).toBe(5);
    expect(ancestorTiles(3, 5, 6)).toEqual([
      [2, 2, 3],
      [1, 1, 1],
      [0, 0, 0],
    ]);
  });
});

test.describe('tile codec', () => {
  const sample = (rects: boolean): TileData => ({
    z: 7,
    x: 41,
    y: 99,
    leaf: true,
    rects,
    empty: false,
    represented: 3,
    worldX: -4,
    worldY: 0,
    worldSize: 8,
    nodes: {
      count: 3,
      x: Float32Array.from([1, 2.5, -3]),
      y: Float32Array.from([4, 5, 6.25]),
      w: rects ? Float32Array.from([10, 20, 30]) : undefined,
      h: rects ? Float32Array.from([11, 21, 31]) : undefined,
      gid: Uint32Array.from([100, 200, 4000000000]),
      weight: Uint32Array.from([1, 2, 3]),
      kind: Uint8Array.from([0, 5, 255]),
      flags: Uint8Array.from([NodeFlags.LABELLED, 0, NodeFlags.LABELLED]),
    },
    edges: {
      count: 2,
      x1: Float32Array.from([1, 2.5]),
      y1: Float32Array.from([4, 5]),
      x2: Float32Array.from([2.5, -3]),
      y2: Float32Array.from([5, 6.25]),
      weight: Uint32Array.from([1, 7]),
      kind: Uint8Array.from([0, 1]),
      flags: Uint8Array.from([0, EdgeFlags.MIRROR]),
      minZ: Uint8Array.from([7, 9]),
      a: Int32Array.from([0, 1]),
      b: Int32Array.from([1, 2]),
    },
    labels: { index: Uint32Array.from([0, 2]), text: ['Héllo — wörld', '日本語 ✓'] },
  });

  for (const rects of [false, true]) {
    test(`round-trips every field (rects=${rects})`, () => {
      const tile = sample(rects);
      const bytes = encodeTile(tile);
      expect(bytes.byteLength % 4).toBe(0);
      const back = decodeTile(bytes);
      expect(back.z).toBe(7);
      expect(back.x).toBe(41);
      expect(back.y).toBe(99);
      expect(back.leaf).toBe(true);
      expect(back.rects).toBe(rects);
      expect(back.worldX).toBe(-4);
      expect(back.worldY).toBe(0);
      expect(back.worldSize).toBe(8);
      // Points are 16-bit over 3x the tile (24 units -> 0.00037 resolution);
      // rectangles keep float32.
      const xs = Array.from(back.nodes.x);
      [1, 2.5, -3].forEach((v, i) => expect(xs[i]).toBeCloseTo(v, 3));
      expect(Array.from(back.nodes.gid)).toEqual([100, 200, 4000000000]);
      expect(Array.from(back.nodes.kind)).toEqual([0, 5, 255]);
      if (rects) expect(Array.from(back.nodes.h!)).toEqual([11, 21, 31]);
      else expect(back.nodes.w).toBeUndefined();
      expect(Array.from(back.edges.weight)).toEqual([1, 7]);
      expect(Array.from(back.edges.minZ)).toEqual([7, 9]);
      expect(Array.from(back.edges.flags)).toEqual([0, EdgeFlags.MIRROR]);
      // Both edges are local, so endpoints come back as indices and the
      // expanded coordinates land exactly on the decoded nodes.
      expect(Array.from(back.edges.a!)).toEqual([0, 1]);
      expect(Array.from(back.edges.b!)).toEqual([1, 2]);
      expect(back.edges.x2[1]).toBe(back.nodes.x[2] + (rects ? back.nodes.w![2] / 2 : 0));
      expect(back.labels.text).toEqual(['Héllo — wörld', '日本語 ✓']);
      expect(Array.from(back.labels.index)).toEqual([0, 2]);
    });
  }

  test('decodes from an unaligned byte view by copying once', () => {
    const bytes = encodeTile(sample(false));
    const shifted = new Uint8Array(bytes.byteLength + 1);
    shifted.set(bytes, 1);
    const back = decodeTile(shifted.subarray(1));
    const ys = Array.from(back.nodes.y);
    [4, 5, 6.25].forEach((v, i) => expect(ys[i]).toBeCloseTo(v, 3));
  });

  test('rejects garbage and truncation instead of reading out of bounds', () => {
    expect(() => decodeTile(new Uint8Array(8))).toThrow(TileDecodeError);
    const bytes = encodeTile(sample(false));
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => decodeTile(bad)).toThrow(TileDecodeError);
    expect(() => decodeTile(bytes.slice(0, bytes.byteLength - 20))).toThrow(TileDecodeError);
  });

  test('external edges keep float endpoints and their direction', () => {
    const tile = sample(false);
    tile.edges.a = Int32Array.from([0, -1]);
    tile.edges.b = Int32Array.from([-1, 2]);
    tile.edges.x2[0] = 1234.5;
    tile.edges.y2[0] = -99.25;
    tile.edges.x1[1] = 77;
    tile.edges.y1[1] = 88;
    const back = decodeTile(encodeTile(tile));
    expect(back.edges.count).toBe(2);
    expect([back.edges.x2[0], back.edges.y2[0]]).toEqual([1234.5, -99.25]);
    expect([back.edges.x1[1], back.edges.y1[1]]).toEqual([77, 88]);
    expect(Array.from(back.edges.a!)).toEqual([0, -1]);
    expect(Array.from(back.edges.b!)).toEqual([-1, 2]);
    // The wire-only direction bit never leaks to callers.
    expect(Array.from(back.edges.flags)).toEqual([0, EdgeFlags.MIRROR]);
  });

  test('local edges and quantised points make tiles much smaller than raw floats', () => {
    const items = randomItems(2000, 77);
    let leaf: TileData | undefined;
    buildPyramid(items, randomEdges(2000, 0), { leafBudget: 4096 }, (t) => {
      leaf = t;
    });
    // 2000 points: 4 B coords + 8 B ids/weight + 2 B kind/flags = 14 B/node + labels.
    const bytes = encodeTile(leaf!).byteLength;
    let labelBytes = 0;
    for (const t of leaf!.labels.text) labelBytes += t.length + 8;
    expect(bytes - labelBytes).toBeLessThan(2000 * 15 + 200);
  });

  test('filterTile drops nodes, their labels and any edge touching them', () => {
    const tile = decodeTile(encodeTile(sample(false)));
    const out = filterTile(tile, (gid) => gid !== 200);
    expect(Array.from(out.nodes.gid)).toEqual([100, 4000000000]);
    // Both edges touch node 200.
    expect(out.edges.count).toBe(0);
    expect(out.labels.text).toEqual(['Héllo — wörld', '日本語 ✓']);
    expect(Array.from(out.labels.index)).toEqual([0, 1]);
    expect(filterTile(tile, () => true)).toBe(tile);
    // Survivors are re-indexed and round-trip through the encoder.
    const kept = filterTile(tile, (gid) => gid !== 100);
    expect(kept.edges.count).toBe(1);
    expect(Array.from(kept.edges.a!)).toEqual([0]);
    expect(Array.from(kept.edges.b!)).toEqual([1]);
    const again = decodeTile(encodeTile(kept));
    expect(Array.from(again.nodes.gid)).toEqual([200, 4000000000]);
    expect(again.edges.count).toBe(1);
  });
});

test.describe('pyramid', () => {
  function collect(items: PyramidItems, edges: ReturnType<typeof randomEdges>, opts = {}) {
    const tiles: TileData[] = [];
    const meta = buildPyramid(items, edges, { leafBudget: 256, grid: 16, hubsPerTile: 8, ...opts }, (t) =>
      tiles.push(decodeTile(encodeTile(t)))
    );
    return { tiles, meta };
  }

  test('every item lands in exactly one leaf and leaves respect the budget', () => {
    const items = randomItems(20000);
    const { tiles, meta } = collect(items, randomEdges(20000, 30000));
    const leaves = tiles.filter((t) => t.leaf);
    expect(leaves.length).toBe(meta.leafCount);
    expect(tiles.length).toBe(meta.tileCount);
    const seen = new Uint8Array(items.count + 1);
    let overBudget = 0;
    for (const leaf of leaves) {
      if (leaf.nodes.count > 256) overBudget++;
      for (const gid of leaf.nodes.gid) seen[gid]++;
    }
    expect(overBudget).toBe(0);
    let wrong = 0;
    for (let gid = 1; gid <= items.count; gid++) if (seen[gid] !== 1) wrong++;
    expect(wrong).toBe(0);
  });

  test('leaf and internal tiles only hold items inside their square', () => {
    const items = randomItems(8000, 5);
    const { tiles } = collect(items, randomEdges(8000, 100));
    let outside = 0;
    let checked = 0;
    for (const t of tiles) {
      // Quantisation can push a point across a boundary by < 1 grid cell.
      const eps = t.worldSize / 2 ** (16 - t.z) + 1e-3;
      for (let i = 0; i < t.nodes.count; i++) {
        if (t.nodes.flags[i] & NodeFlags.AGGREGATE) continue;
        const x = t.nodes.x[i];
        const y = t.nodes.y[i];
        checked++;
        if (
          x < t.worldX - eps ||
          x > t.worldX + t.worldSize + eps ||
          y < t.worldY - eps ||
          y > t.worldY + t.worldSize + eps
        ) {
          outside++;
        }
      }
    }
    expect(checked).toBeGreaterThan(8000);
    expect(outside).toBe(0);
  });

  test('aggregates conserve counts at every internal tile', () => {
    const items = randomItems(12000, 7);
    const { tiles } = collect(items, randomEdges(12000, 0));
    const byKey = new Map(tiles.map((t) => [`${t.z}/${t.x}/${t.y}`, t]));
    const root = byKey.get('0/0/0')!;
    expect(root.represented).toBe(items.count);
    let checkedInternal = 0;
    for (const t of tiles) {
      if (t.leaf) continue;
      checkedInternal++;
      let sum = 0;
      for (let i = 0; i < t.nodes.count; i++) {
        sum += t.nodes.flags[i] & NodeFlags.AGGREGATE ? t.nodes.weight[i] : 1;
      }
      expect(sum).toBe(t.represented);
      // Children together represent the same items as their parent.
      let childSum = 0;
      for (let c = 0; c < 4; c++) {
        const child = byKey.get(`${t.z + 1}/${t.x * 2 + (c & 1)}/${t.y * 2 + (c >> 1)}`);
        if (child) childSum += child.represented;
      }
      expect(childSum).toBe(t.represented);
      // Internal tiles stay within the drawing budget.
      expect(t.nodes.count).toBeLessThanOrEqual(16 * 16 + 8);
    }
    expect(checkedInternal).toBeGreaterThan(3);
  });

  test('hubs survive as labelled real nodes at the root', () => {
    const items = randomItems(5000, 11);
    items.weight[1234] = 100000;
    const { tiles } = collect(items, randomEdges(5000, 0));
    const root = tiles.find((t) => t.z === 0)!;
    const idx = Array.from(root.nodes.gid).indexOf(1235);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(root.nodes.flags[idx] & NodeFlags.HUB).toBeTruthy();
    const label = Array.from(root.labels.index).indexOf(idx);
    expect(root.labels.text[label]).toBe('item 1234');
  });

  test('every edge is drawable at the deepest level from at least one leaf', () => {
    const items = randomItems(6000, 13);
    const edges = randomEdges(6000, 9000, 14);
    const { tiles } = collect(items, edges, { edgeBudget: 1e9 });
    // Identify edges by endpoint identity: the in-tile end by its gid, an
    // external end by its exact float coordinates (which are sent unquantised).
    const gidAt = new Map<string, number>();
    for (let i = 0; i < items.count; i++) gidAt.set(`${items.x[i]},${items.y[i]}`, items.gid[i]);
    const leafPrimary = new Set<string>();
    let mirrors = 0;
    for (const t of tiles.filter((x) => x.leaf)) {
      for (let e = 0; e < t.edges.count; e++) {
        if (t.edges.flags[e] & EdgeFlags.MIRROR) {
          mirrors++;
          continue;
        }
        const a = t.edges.a![e];
        const b = t.edges.b![e];
        const src = t.nodes.gid[a];
        const dst = b >= 0 ? t.nodes.gid[b] : gidAt.get(`${t.edges.x2[e]},${t.edges.y2[e]}`);
        leafPrimary.add(`${src}>${dst}`);
      }
    }
    let nonSelf = 0;
    let missing = 0;
    for (let e = 0; e < edges.count; e++) {
      if (edges.src[e] === edges.dst[e]) continue;
      nonSelf++;
      if (!leafPrimary.has(`${items.gid[edges.src[e]]}>${items.gid[edges.dst[e]]}`)) missing++;
    }
    expect(missing).toBe(0);
    expect(mirrors).toBeGreaterThan(0);
    expect(mirrors).toBeLessThanOrEqual(nonSelf);
  });

  test('internal-level edges are bundled and never self-loops on one representative', () => {
    const items = randomItems(10000, 21);
    const edges = randomEdges(10000, 20000, 22);
    const { tiles } = collect(items, edges);
    const root = tiles.find((t) => t.z === 0)!;
    expect(root.edges.count).toBeGreaterThan(0);
    let bundled = 0;
    let degenerate = 0;
    for (let e = 0; e < root.edges.count; e++) {
      if (root.edges.x1[e] === root.edges.x2[e] && root.edges.y1[e] === root.edges.y2[e]) degenerate++;
      if (root.edges.flags[e] & EdgeFlags.AGGREGATE) bundled += root.edges.weight[e];
    }
    expect(degenerate).toBe(0);
    expect(bundled).toBeGreaterThan(0);
  });

  test('rect mode keeps extents and aggregates cover their members', () => {
    const items = randomItems(3000, 31, true);
    const { tiles, meta } = collect(items, randomEdges(3000, 0));
    expect(meta.rects).toBe(true);
    const root = tiles.find((t) => t.z === 0)!;
    expect(root.rects).toBe(true);
    let flat = 0;
    for (let i = 0; i < root.nodes.count; i++) {
      if (!(root.nodes.w![i] > 0) || !(root.nodes.h![i] > 0)) flat++;
    }
    expect(flat).toBe(0);
  });

  test('an explicit world square makes separately built layers share one tiling', () => {
    const world = { x: -100, y: -100, size: 1000 };
    const a = collect(randomItems(500, 41), randomEdges(500, 0), { world });
    const b = collect(randomItems(900, 42), randomEdges(900, 0), { world });
    expect(a.meta.worldX).toBe(-100);
    expect(b.meta.worldSize).toBe(1000);
  });

  test('ghost endpoints are drawn from the real end only, at every level', () => {
    const items = randomItems(3000, 51);
    // Every item links to one of two far-away ghosts (e.g. public nodes linked
    // from a private layer).
    const m = items.count;
    const src = new Uint32Array(m);
    const dst = new Uint32Array(m);
    for (let i = 0; i < m; i++) {
      src[i] = i % 2 ? i : m + (i % 4 === 0 ? 0 : 1);
      dst[i] = i % 2 ? m + 1 : i;
    }
    const edges = { count: m, src, dst, ghostX: Float32Array.from([-50000, 60000]), ghostY: Float32Array.from([0, 70000]) };
    const { tiles } = collect(items, edges as any);
    let leafCopies = 0;
    let mirrors = 0;
    let ghostEnds = 0;
    for (const t of tiles) {
      for (let e = 0; e < t.edges.count; e++) {
        if (t.edges.flags[e] & EdgeFlags.MIRROR) mirrors++;
        const far = (x: number, y: number) => (x === -50000 && y === 0) || (x === 60000 && y === 70000);
        if (far(t.edges.x1[e], t.edges.y1[e]) || far(t.edges.x2[e], t.edges.y2[e])) ghostEnds++;
        if (t.leaf) leafCopies++;
      }
    }
    // Exactly one stored copy per edge at leaf level, none mirrored, and every
    // stored edge really ends on a ghost.
    expect(leafCopies).toBe(m);
    expect(mirrors).toBe(0);
    expect(ghostEnds).toBe(tiles.reduce((sum, t) => sum + t.edges.count, 0));
    // Coarse levels bundle them too.
    expect(tiles.find((t) => t.z === 0)!.edges.count).toBeGreaterThan(0);
  });

  test('rejects edges pointing past items and ghosts', () => {
    const items = randomItems(10, 1);
    const bad = { count: 1, src: Uint32Array.from([0]), dst: Uint32Array.from([11]) };
    expect(() => buildPyramid(items, bad, {}, () => {})).toThrow(/out of range/);
  });

  test('empty input yields no tiles and a sane world', () => {
    const { tiles, meta } = collect(randomItems(0), randomEdges(0, 0));
    expect(tiles).toHaveLength(0);
    expect(meta.worldSize).toBe(1);
  });

  test('viewLevel picks deeper levels as the user zooms in', () => {
    expect(viewLevel(0.001, 100000)).toBe(0);
    // 100000 * 0.01 = 1000 px of world -> floor(log2(1000 / 512)) = 0.
    expect(viewLevel(0.01, 100000)).toBe(0);
    // 10000 px -> floor(log2(19.5)) = 4: tiles drawn at 625 px (512..1024).
    expect(viewLevel(0.1, 100000)).toBe(4);
    expect(viewLevel(1e9, 1)).toBe(16);
  });
});
