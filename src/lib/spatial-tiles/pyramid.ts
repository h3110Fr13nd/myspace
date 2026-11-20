/**
 * Spatial tiles — level-of-detail pyramid builder.
 *
 * Turns N positioned items (graph nodes or canvas rectangles) and E edges into
 * an adaptive quadtree of tiles, each bounded in size, so a client can draw any
 * view of an arbitrarily large dataset by fetching only a handful of tiles:
 *
 *  - A tile holding <= `leafBudget` items is a **leaf** and contains them all,
 *    with labels and exact edges. Sparse regions therefore stop subdividing
 *    early, and dense regions subdivide until they fit.
 *  - A tile holding more is **internal**: its items are summarised on a
 *    `grid x grid` lattice (one aggregate point per occupied cell, weighted by
 *    how many items it stands for), plus the top `hubsPerTile` items by weight
 *    kept as themselves so the most important nodes stay visible and labelled at
 *    every zoom level. Edges are re-targeted to those representatives and
 *    bundled, so the zoomed-out view shows real structure, not noise.
 *
 * The work per level is O(N + E) and the tree has O(log4(N / leafBudget))
 * levels. Items are sorted once by Morton code (see `morton.ts`), which makes
 * each tile a contiguous slice of that order — the reason no per-tile filtering
 * pass is ever needed.
 *
 * Memory: everything is typed arrays sized O(N + E); there is no per-item
 * object. Tiles are handed to `onTile` as soon as their level is complete, so a
 * caller can encode and persist them without retaining the whole pyramid.
 */

import {
  GRID_BITS,
  GRID_SIZE,
  MAX_ZOOM,
  lowerBound,
  morton2,
  radixSortPermutation,
  tileCodeRange,
} from './morton';
import { EdgeFlags, NodeFlags, type TileData, type TileEdges, type TileNodes } from './codec';

export interface PyramidItems {
  count: number;
  /** Item anchor. Points: centre. Rectangles: top-left corner. */
  x: Float32Array;
  y: Float32Array;
  /** Rectangle extents. When present the pyramid is built in rect mode. */
  w?: Float32Array;
  h?: Float32Array;
  /** Stable numeric id, resolved to a resource by the serving layer. */
  gid: Uint32Array;
  /** Category code (entity type, canvas node type). */
  kind: Uint8Array;
  /** Importance — degree for graphs, area or priority for canvases. */
  weight: Uint32Array;
  /** Optional display label. Only called for items that will carry one. */
  label?: (index: number) => string | undefined;
}

export interface PyramidEdges {
  count: number;
  /**
   * Item indices (not gids). An index >= `items.count` refers to a *ghost*
   * endpoint: a position that is not an item of this pyramid (e.g. a public node
   * linked from a private layer). Ghost `g` is at
   * `(ghostX[g - items.count], ghostY[g - items.count])`. Edges to ghosts are
   * stored only in the tile of their real end and are never mirrored.
   */
  src: Uint32Array;
  dst: Uint32Array;
  kind?: Uint8Array;
  ghostX?: Float32Array;
  ghostY?: Float32Array;
}

export interface PyramidOptions {
  /** Max items in a leaf tile. Also the practical cap on what a tile costs to draw. */
  leafBudget?: number;
  /** Aggregation lattice per internal tile, per axis. Power of two. */
  grid?: number;
  /** Items kept as themselves (and labelled) in each internal tile. */
  hubsPerTile?: number;
  /** Max labels in an internal tile (hubs first, then heaviest singletons). */
  labelsPerTile?: number;
  /** Max edges stored per tile; the heaviest survive. */
  edgeBudget?: number;
  /**
   * Internal (aggregated) tiles keep at most this many edges per node. Bundles
   * between a few hundred representatives quickly become thousands of weight-1
   * strands that read as noise and were ~90% of an overview tile's bytes; the
   * heaviest bundles carry the structure.
   */
  internalEdgesPerNode?: number;
  /** Deepest level. Bounded by the 16-bit quantisation grid. */
  maxZoom?: number;
  /** Fraction of the content extent added around it. */
  padding?: number;
  /** Explicit world square, so layers built separately share one tiling. */
  world?: { x: number; y: number; size: number };
}

export interface PyramidMeta {
  worldX: number;
  worldY: number;
  worldSize: number;
  /** Deepest tile level present. */
  maxZ: number;
  tileCount: number;
  leafCount: number;
  itemCount: number;
  edgeCount: number;
  rects: boolean;
  leafBudget: number;
  /** Tiles per level, index = z. */
  levels: number[];
}

const DEFAULTS: Required<Omit<PyramidOptions, 'world'>> = {
  // 1024 balances request count against tile size: measured on a 100k graph,
  // 2048 made detail views 43% heavier, 512 doubled the tile count.
  leafBudget: 1024,
  grid: 32,
  hubsPerTile: 48,
  labelsPerTile: 256,
  edgeBudget: 12000,
  internalEdgesPerNode: 4,
  maxZoom: MAX_ZOOM,
  padding: 0.02,
};

interface TileRecord {
  z: number;
  x: number;
  y: number;
  lo: number;
  hi: number;
  leaf: boolean;
}

/** Growable parallel typed arrays for edge output. */
class EdgeBuffer {
  x1: Float32Array;
  y1: Float32Array;
  x2: Float32Array;
  y2: Float32Array;
  weight: Uint32Array;
  kind: Uint8Array;
  flags: Uint8Array;
  minZ: Uint8Array;
  /** Owning tile (index into the level's / leaf tile list). */
  tile: Int32Array;
  /** In-tile node index of each end, or -1 when that end is in another tile. */
  a: Int32Array;
  b: Int32Array;
  length = 0;

  constructor(capacity = 1024) {
    this.x1 = new Float32Array(capacity);
    this.y1 = new Float32Array(capacity);
    this.x2 = new Float32Array(capacity);
    this.y2 = new Float32Array(capacity);
    this.weight = new Uint32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.minZ = new Uint8Array(capacity);
    this.tile = new Int32Array(capacity);
    this.a = new Int32Array(capacity);
    this.b = new Int32Array(capacity);
  }

  private grow() {
    const cap = this.x1.length * 2;
    const g = <T extends Float32Array | Uint32Array | Uint8Array | Int32Array>(a: T): T => {
      const next = new (a.constructor as { new (n: number): T })(cap);
      next.set(a);
      return next;
    };
    this.x1 = g(this.x1);
    this.y1 = g(this.y1);
    this.x2 = g(this.x2);
    this.y2 = g(this.y2);
    this.weight = g(this.weight);
    this.kind = g(this.kind);
    this.flags = g(this.flags);
    this.minZ = g(this.minZ);
    this.tile = g(this.tile);
    this.a = g(this.a);
    this.b = g(this.b);
  }

  push(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    weight: number,
    kind: number,
    flags: number,
    minZ: number,
    tile: number,
    a: number,
    b: number
  ) {
    if (this.length === this.x1.length) this.grow();
    const i = this.length++;
    this.x1[i] = x1;
    this.y1[i] = y1;
    this.x2[i] = x2;
    this.y2[i] = y2;
    this.weight[i] = weight;
    this.kind[i] = kind;
    this.flags[i] = flags;
    this.minZ[i] = minZ;
    this.tile[i] = tile;
    this.a[i] = a;
    this.b[i] = b;
  }

  /**
   * Edge indices grouped by tile, heaviest first, each group capped at `budget`.
   * Primary copies sort ahead of mirrors at equal weight so a capped tile keeps
   * the edges it owns.
   */
  groupByTile(tileCount: number, budgetFor: (tile: number) => number): { start: Uint32Array; order: Uint32Array } {
    const counts = new Uint32Array(tileCount + 1);
    for (let i = 0; i < this.length; i++) counts[this.tile[i] + 1]++;
    for (let t = 0; t < tileCount; t++) counts[t + 1] += counts[t];
    const start = counts.slice();
    const order = new Uint32Array(this.length);
    const cursor = counts.slice(0, tileCount);
    for (let i = 0; i < this.length; i++) order[cursor[this.tile[i]]++] = i;

    for (let t = 0; t < tileCount; t++) {
      const a = start[t];
      const b = start[t + 1];
      if (b - a <= budgetFor(t)) continue;
      const slice = Array.from(order.subarray(a, b));
      slice.sort((p, q) => {
        const mp = this.flags[p] & EdgeFlags.MIRROR;
        const mq = this.flags[q] & EdgeFlags.MIRROR;
        if (mp !== mq) return mp - mq;
        return this.weight[q] - this.weight[p];
      });
      order.set(slice, a);
    }
    return { start, order };
  }

  slice(indices: ArrayLike<number>, from: number, to: number): TileEdges {
    const m = to - from;
    const out: TileEdges = {
      count: m,
      x1: new Float32Array(m),
      y1: new Float32Array(m),
      x2: new Float32Array(m),
      y2: new Float32Array(m),
      weight: new Uint32Array(m),
      kind: new Uint8Array(m),
      flags: new Uint8Array(m),
      minZ: new Uint8Array(m),
      a: new Int32Array(m),
      b: new Int32Array(m),
    };
    for (let j = 0; j < m; j++) {
      const i = indices[from + j];
      out.a![j] = this.a[i];
      out.b![j] = this.b[i];
      out.x1[j] = this.x1[i];
      out.y1[j] = this.y1[i];
      out.x2[j] = this.x2[i];
      out.y2[j] = this.y2[i];
      out.weight[j] = this.weight[i];
      out.kind[j] = this.kind[i];
      out.flags[j] = this.flags[i];
      out.minZ[j] = this.minZ[i];
    }
    return out;
  }
}

/** Top-`k` indices of `idx[lo, hi)` by `weight`, heaviest first. O(n log k). */
function topK(order: Uint32Array, lo: number, hi: number, weight: Uint32Array, k: number): number[] {
  if (k <= 0 || hi <= lo) return [];
  const heap: number[] = []; // min-heap of item indices by weight
  const less = (a: number, b: number) => weight[a] < weight[b] || (weight[a] === weight[b] && a > b);
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let s = i;
      if (l < heap.length && less(heap[l], heap[s])) s = l;
      if (r < heap.length && less(heap[r], heap[s])) s = r;
      if (s === i) break;
      [heap[i], heap[s]] = [heap[s], heap[i]];
      i = s;
    }
  };
  for (let j = lo; j < hi; j++) {
    const item = order[j];
    if (heap.length < k) {
      heap.push(item);
      up(heap.length - 1);
    } else if (less(heap[0], item)) {
      heap[0] = item;
      down(0);
    }
  }
  return heap.sort((a, b) => weight[b] - weight[a] || a - b);
}

/**
 * Build the pyramid. Tiles are emitted through `onTile` level by level, root
 * first; leaf tiles of every depth are emitted last (they need every edge).
 */
export function buildPyramid(
  items: PyramidItems,
  edges: PyramidEdges,
  options: PyramidOptions,
  onTile: (tile: TileData) => void
): PyramidMeta {
  const opt = { ...DEFAULTS, ...options };
  const N = items.count;
  const rects = Boolean(items.w && items.h);
  const grid = Math.max(1, opt.grid | 0);
  const gridBits = Math.round(Math.log2(grid));
  if (1 << gridBits !== grid) throw new Error('grid must be a power of two');
  const maxZoom = Math.min(MAX_ZOOM, Math.max(0, opt.maxZoom | 0));

  // --- 1. World square ------------------------------------------------------
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    const x0 = items.x[i];
    const y0 = items.y[i];
    const x1 = rects ? x0 + items.w![i] : x0;
    const y1 = rects ? y0 + items.h![i] : y0;
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  }
  let worldX: number;
  let worldY: number;
  let worldSize: number;
  if (opt.world) {
    worldX = opt.world.x;
    worldY = opt.world.y;
    worldSize = opt.world.size;
  } else if (N === 0) {
    worldX = 0;
    worldY = 0;
    worldSize = 1;
  } else {
    const extent = Math.max(maxX - minX, maxY - minY, 1);
    worldSize = extent * (1 + 2 * opt.padding);
    worldX = (minX + maxX) / 2 - worldSize / 2;
    worldY = (minY + maxY) / 2 - worldSize / 2;
  }

  // Centre of each item (or ghost endpoint), used for placement and edges.
  const cxOf = (i: number) =>
    i >= N ? edges.ghostX![i - N] : rects ? items.x[i] + items.w![i] / 2 : items.x[i];
  const cyOf = (i: number) =>
    i >= N ? edges.ghostY![i - N] : rects ? items.y[i] + items.h![i] / 2 : items.y[i];
  const repOf = (rep: Int32Array, i: number) => (i >= N ? -1 : rep[i]);
  const ghostCount = edges.ghostX ? edges.ghostX.length : 0;
  for (let e = 0; e < edges.count; e++) {
    if (edges.src[e] >= N + ghostCount || edges.dst[e] >= N + ghostCount) {
      throw new Error('buildPyramid: edge endpoint out of range');
    }
  }

  // --- 2. Quantise + Morton sort -------------------------------------------
  const qx = new Uint16Array(N);
  const qy = new Uint16Array(N);
  const codes = new Uint32Array(N);
  const scale = GRID_SIZE / worldSize;
  for (let i = 0; i < N; i++) {
    let gx = Math.floor((cxOf(i) - worldX) * scale);
    let gy = Math.floor((cyOf(i) - worldY) * scale);
    gx = gx < 0 ? 0 : gx >= GRID_SIZE ? GRID_SIZE - 1 : gx;
    gy = gy < 0 ? 0 : gy >= GRID_SIZE ? GRID_SIZE - 1 : gy;
    qx[i] = gx;
    qy[i] = gy;
    codes[i] = morton2(gx, gy);
  }
  const order = radixSortPermutation(codes, N);
  const sorted = new Uint32Array(N);
  const rankOf = new Uint32Array(N);
  for (let j = 0; j < N; j++) {
    sorted[j] = codes[order[j]];
    rankOf[order[j]] = j;
  }

  // --- 3. Adaptive quadtree over the sorted order ----------------------------
  const tiles: TileRecord[] = [];
  const leafOf = new Int32Array(N).fill(-1); // index into `leaves`
  const leafDepth = new Uint8Array(N);
  const leaves: TileRecord[] = [];
  if (N > 0) {
    const stack: TileRecord[] = [{ z: 0, x: 0, y: 0, lo: 0, hi: N, leaf: false }];
    while (stack.length) {
      const t = stack.pop()!;
      const count = t.hi - t.lo;
      t.leaf = count <= opt.leafBudget || t.z >= maxZoom;
      tiles.push(t);
      if (t.leaf) {
        const li = leaves.length;
        leaves.push(t);
        for (let j = t.lo; j < t.hi; j++) {
          leafOf[order[j]] = li;
          leafDepth[order[j]] = t.z;
        }
        continue;
      }
      const cz = t.z + 1;
      // Children in reverse so the stack pops them in Morton order.
      for (let c = 3; c >= 0; c--) {
        const cx = t.x * 2 + (c & 1);
        const cy = t.y * 2 + (c >> 1);
        const [a, b] = tileCodeRange(cz, cx, cy);
        const lo = lowerBound(sorted, t.lo, t.hi, a);
        const hi = b > 0xffffffff ? t.hi : lowerBound(sorted, lo, t.hi, b);
        if (hi > lo) stack.push({ z: cz, x: cx, y: cy, lo, hi, leaf: false });
      }
    }
  }

  let maxZ = 0;
  for (const t of tiles) if (t.z > maxZ) maxZ = t.z;
  const levels = new Array(maxZ + 1).fill(0);
  for (const t of tiles) levels[t.z]++;

  const tileWorld = (z: number, x: number, y: number) => {
    const size = worldSize / 2 ** z;
    return { worldX: worldX + x * size, worldY: worldY + y * size, worldSize: size };
  };

  // --- 4. Internal levels ----------------------------------------------------
  // rep[i] >= 0: index of the representative node in this level's node list.
  // rep[i] = -1: the item is already resolved (its leaf is at or above z).
  const rep = new Int32Array(N);
  const cellCount = grid * grid;
  const cCount = new Uint32Array(cellCount);
  const cSumX = new Float64Array(cellCount);
  const cSumY = new Float64Array(cellCount);
  const cMinX = new Float64Array(cellCount);
  const cMinY = new Float64Array(cellCount);
  const cMaxX = new Float64Array(cellCount);
  const cMaxY = new Float64Array(cellCount);
  const cRep = new Int32Array(cellCount);
  const cNode = new Int32Array(cellCount);
  const isHub = new Uint8Array(N);

  const edgeKind = (e: number) => (edges.kind ? edges.kind[e] : 0);

  for (let z = 0; z <= maxZ; z++) {
    const internal = tiles.filter((t) => t.z === z && !t.leaf);
    if (internal.length === 0) continue;

    rep.fill(-1);
    // Level node list, as growable plain arrays (bounded by tiles * grid^2).
    const lx: number[] = [];
    const ly: number[] = [];
    const lw: number[] = [];
    const lh: number[] = [];
    const lgid: number[] = [];
    const lweight: number[] = [];
    const lkind: number[] = [];
    const lflags: number[] = [];
    const ltile: number[] = [];
    const lsource: number[] = []; // item index for labelled nodes, else -1
    const tileNodeStart: number[] = [];

    const cellShift = GRID_BITS - z - Math.min(gridBits, GRID_BITS - z);
    const cellMask = (1 << Math.min(gridBits, GRID_BITS - z)) - 1;
    const cellsPerAxis = cellMask + 1;

    internal.forEach((t, ti) => {
      tileNodeStart.push(lx.length);
      const hubs = topK(order, t.lo, t.hi, items.weight, opt.hubsPerTile);
      for (const item of hubs) {
        isHub[item] = 1;
        rep[item] = lx.length;
        lx.push(items.x[item]);
        ly.push(items.y[item]);
        lw.push(rects ? items.w![item] : 0);
        lh.push(rects ? items.h![item] : 0);
        lgid.push(items.gid[item]);
        lweight.push(items.weight[item]);
        lkind.push(items.kind[item]);
        lflags.push(NodeFlags.HUB);
        ltile.push(ti);
        lsource.push(item);
      }

      const touched: number[] = [];
      for (let j = t.lo; j < t.hi; j++) {
        const item = order[j];
        if (isHub[item]) continue;
        const c = ((qy[item] >> cellShift) & cellMask) * cellsPerAxis + ((qx[item] >> cellShift) & cellMask);
        const x0 = items.x[item];
        const y0 = items.y[item];
        const x1 = rects ? x0 + items.w![item] : x0;
        const y1 = rects ? y0 + items.h![item] : y0;
        if (cCount[c] === 0) {
          touched.push(c);
          cSumX[c] = 0;
          cSumY[c] = 0;
          cMinX[c] = x0;
          cMinY[c] = y0;
          cMaxX[c] = x1;
          cMaxY[c] = y1;
          cRep[c] = item;
        } else {
          if (x0 < cMinX[c]) cMinX[c] = x0;
          if (y0 < cMinY[c]) cMinY[c] = y0;
          if (x1 > cMaxX[c]) cMaxX[c] = x1;
          if (y1 > cMaxY[c]) cMaxY[c] = y1;
          if (items.weight[item] > items.weight[cRep[c]]) cRep[c] = item;
        }
        cCount[c]++;
        cSumX[c] += cxOf(item);
        cSumY[c] += cyOf(item);
      }

      for (const c of touched) {
        const count = cCount[c];
        const r = cRep[c];
        cNode[c] = lx.length;
        if (count === 1) {
          lx.push(items.x[r]);
          ly.push(items.y[r]);
          lw.push(rects ? items.w![r] : 0);
          lh.push(rects ? items.h![r] : 0);
          lweight.push(items.weight[r]);
          lflags.push(0);
          lsource.push(r);
        } else if (rects) {
          lx.push(cMinX[c]);
          ly.push(cMinY[c]);
          lw.push(cMaxX[c] - cMinX[c]);
          lh.push(cMaxY[c] - cMinY[c]);
          lweight.push(count);
          lflags.push(NodeFlags.AGGREGATE);
          lsource.push(-1);
        } else {
          lx.push(cSumX[c] / count);
          ly.push(cSumY[c] / count);
          lw.push(0);
          lh.push(0);
          lweight.push(count);
          lflags.push(NodeFlags.AGGREGATE);
          lsource.push(-1);
        }
        lgid.push(items.gid[r]);
        lkind.push(items.kind[r]);
        ltile.push(ti);
      }
      for (let j = t.lo; j < t.hi; j++) {
        const item = order[j];
        if (isHub[item]) continue;
        const c = ((qy[item] >> cellShift) & cellMask) * cellsPerAxis + ((qx[item] >> cellShift) & cellMask);
        rep[item] = cNode[c];
      }
      for (const c of touched) cCount[c] = 0;
      for (const item of hubs) isHub[item] = 0;
    });
    tileNodeStart.push(lx.length);

    // Re-target every edge that touches an aggregated endpoint at this level.
    const A = lx.length;
    const span = A + N + ghostCount;
    const keyCount = (() => {
      let k = 0;
      for (let e = 0; e < edges.count; e++) {
        const rs = repOf(rep, edges.src[e]);
        const rt = repOf(rep, edges.dst[e]);
        if (rs < 0 && rt < 0) continue;
        if (rs >= 0 && rs === rt) continue;
        k++;
      }
      return k;
    })();
    // Key = unordered representative pair, with the edge kind packed into the
    // low 4 bits so one native numeric sort groups pairs and keeps a kind.
    // Max key ~ (A + N)^2 * 16, exact in a float64 up to several million items.
    // Sort + run-length replaces a Map of pair -> weight, which costs ~60 bytes
    // per entry and dominated build memory at a million edges.
    const keys = new Float64Array(keyCount);
    {
      let k = 0;
      for (let e = 0; e < edges.count; e++) {
        const s = edges.src[e];
        const t = edges.dst[e];
        const rs = repOf(rep, s);
        const rt = repOf(rep, t);
        if (rs < 0 && rt < 0) continue;
        if (rs >= 0 && rs === rt) continue;
        const a = rs >= 0 ? rs : A + s;
        const b = rt >= 0 ? rt : A + t;
        keys[k++] = (a < b ? a * span + b : b * span + a) * 16 + (edgeKind(e) & 15);
      }
    }
    keys.sort();

    const levelEdges = new EdgeBuffer(Math.max(16, Math.min(keyCount * 2, 1 << 20)));
    // [centre x, centre y, owning tile or -1, index within that tile]
    const endpoint = (id: number): [number, number, number, number] => {
      if (id < A) {
        const cx = rects ? lx[id] + lw[id] / 2 : lx[id];
        const cy = rects ? ly[id] + lh[id] / 2 : ly[id];
        return [cx, cy, ltile[id], id - tileNodeStart[ltile[id]]];
      }
      const item = id - A;
      return [cxOf(item), cyOf(item), -1, -1];
    };
    for (let p = 0; p < keyCount; ) {
      const pair = Math.floor(keys[p] / 16);
      const kind = keys[p] - pair * 16;
      let q = p + 1;
      while (q < keyCount && Math.floor(keys[q] / 16) === pair) q++;
      const weight = q - p;
      const a = Math.floor(pair / span);
      const b = pair - a * span;
      const [ax, ay, at, al] = endpoint(a);
      const [bx, by, bt, bl] = endpoint(b);
      const flags = weight > 1 ? EdgeFlags.AGGREGATE : 0;
      if (at >= 0) levelEdges.push(ax, ay, bx, by, weight, kind, flags, z, at, al, bt === at ? bl : -1);
      if (bt >= 0 && bt !== at) {
        levelEdges.push(ax, ay, bx, by, weight, kind, flags | (at >= 0 ? EdgeFlags.MIRROR : 0), z, bt, -1, bl);
      }
      p = q;
    }
    const internalBudget = (ti: number) =>
      Math.min(
        opt.edgeBudget,
        Math.max(64, Math.round(opt.internalEdgesPerNode * (tileNodeStart[ti + 1] - tileNodeStart[ti])))
      );
    const grouped = levelEdges.groupByTile(internal.length, internalBudget);

    internal.forEach((t, ti) => {
      const a = tileNodeStart[ti];
      const b = tileNodeStart[ti + 1];
      const n = b - a;
      const nodes: TileNodes = {
        count: n,
        x: new Float32Array(n),
        y: new Float32Array(n),
        w: rects ? new Float32Array(n) : undefined,
        h: rects ? new Float32Array(n) : undefined,
        gid: new Uint32Array(n),
        weight: new Uint32Array(n),
        kind: new Uint8Array(n),
        flags: new Uint8Array(n),
      };
      let represented = 0;
      for (let j = 0; j < n; j++) {
        const s = a + j;
        nodes.x[j] = lx[s];
        nodes.y[j] = ly[s];
        if (rects) {
          nodes.w![j] = lw[s];
          nodes.h![j] = lh[s];
        }
        nodes.gid[j] = lgid[s];
        nodes.weight[j] = lweight[s];
        nodes.kind[j] = lkind[s];
        nodes.flags[j] = lflags[s];
        represented += lflags[s] & NodeFlags.AGGREGATE ? lweight[s] : 1;
      }

      // Labels: hubs first (they lead the node list), then the heaviest singletons.
      const labelIndex: number[] = [];
      const labelText: string[] = [];
      if (items.label) {
        const candidates: number[] = [];
        for (let j = 0; j < n; j++) if (lsource[a + j] >= 0) candidates.push(j);
        candidates.sort((p, q) => {
          const hp = nodes.flags[p] & NodeFlags.HUB;
          const hq = nodes.flags[q] & NodeFlags.HUB;
          if (hp !== hq) return hq - hp;
          return nodes.weight[q] - nodes.weight[p];
        });
        for (const j of candidates) {
          if (labelIndex.length >= opt.labelsPerTile) break;
          const text = items.label(lsource[a + j]);
          if (!text) continue;
          labelIndex.push(j);
          labelText.push(text);
          nodes.flags[j] |= NodeFlags.LABELLED;
        }
      }

      const from = grouped.start[ti];
      const to = Math.min(grouped.start[ti + 1], from + internalBudget(ti));
      onTile({
        z: t.z,
        x: t.x,
        y: t.y,
        leaf: false,
        rects,
        empty: false,
        represented,
        ...tileWorld(t.z, t.x, t.y),
        nodes,
        edges: levelEdges.slice(grouped.order, from, to),
        labels: { index: Uint32Array.from(labelIndex), text: labelText },
      });
    });
  }

  // --- 5. Leaves ---------------------------------------------------------------
  const leafEdges = new EdgeBuffer(Math.max(16, Math.min(edges.count * 2, 1 << 20)));
  for (let e = 0; e < edges.count; e++) {
    const s = edges.src[e];
    const t = edges.dst[e];
    if (s === t) continue;
    const ls = s < N ? leafOf[s] : -1;
    const lt = t < N ? leafOf[t] : -1;
    if (ls < 0 && lt < 0) continue;
    const minZ = Math.max(s < N ? leafDepth[s] : 0, t < N ? leafDepth[t] : 0);
    const kind = edgeKind(e);
    const x1 = cxOf(s);
    const y1 = cyOf(s);
    const x2 = cxOf(t);
    const y2 = cyOf(t);
    // Weight doubles as draw priority when a tile is over budget: edges between
    // important items survive the cap.
    const w = Math.max(s < N ? items.weight[s] : 0, t < N ? items.weight[t] : 0) + 1;
    const sl = ls >= 0 ? rankOf[s] - leaves[ls].lo : -1;
    const tl = lt >= 0 ? rankOf[t] - leaves[lt].lo : -1;
    if (ls < 0) {
      // Source is a ghost: the target's tile owns the only copy.
      leafEdges.push(x1, y1, x2, y2, w, kind, 0, minZ, lt, -1, tl);
      continue;
    }
    leafEdges.push(x1, y1, x2, y2, w, kind, 0, minZ, ls, sl, lt === ls ? tl : -1);
    if (lt >= 0 && lt !== ls) leafEdges.push(x1, y1, x2, y2, w, kind, EdgeFlags.MIRROR, minZ, lt, -1, tl);
  }
  const leafGrouped = leafEdges.groupByTile(leaves.length, () => opt.edgeBudget);
  // Real edges have weight 1 on the wire; the priority above was build-only.
  for (let i = 0; i < leafEdges.length; i++) leafEdges.weight[i] = 1;

  leaves.forEach((t, li) => {
    const n = t.hi - t.lo;
    const nodes: TileNodes = {
      count: n,
      x: new Float32Array(n),
      y: new Float32Array(n),
      w: rects ? new Float32Array(n) : undefined,
      h: rects ? new Float32Array(n) : undefined,
      gid: new Uint32Array(n),
      weight: new Uint32Array(n),
      kind: new Uint8Array(n),
      flags: new Uint8Array(n),
    };
    const labelIndex: number[] = [];
    const labelText: string[] = [];
    const labelCap = Math.max(opt.leafBudget, opt.labelsPerTile);
    for (let j = 0; j < n; j++) {
      const item = order[t.lo + j];
      nodes.x[j] = items.x[item];
      nodes.y[j] = items.y[item];
      if (rects) {
        nodes.w![j] = items.w![item];
        nodes.h![j] = items.h![item];
      }
      nodes.gid[j] = items.gid[item];
      nodes.weight[j] = items.weight[item];
      nodes.kind[j] = items.kind[item];
      if (items.label && labelIndex.length < labelCap) {
        const text = items.label(item);
        if (text) {
          labelIndex.push(j);
          labelText.push(text);
          nodes.flags[j] = NodeFlags.LABELLED;
        }
      }
    }
    const from = leafGrouped.start[li];
    const to = Math.min(leafGrouped.start[li + 1], from + opt.edgeBudget);
    onTile({
      z: t.z,
      x: t.x,
      y: t.y,
      leaf: true,
      rects,
      empty: false,
      represented: n,
      ...tileWorld(t.z, t.x, t.y),
      nodes,
      edges: leafEdges.slice(leafGrouped.order, from, to),
      labels: { index: Uint32Array.from(labelIndex), text: labelText },
    });
  });

  return {
    worldX,
    worldY,
    worldSize,
    maxZ,
    tileCount: tiles.length,
    leafCount: leaves.length,
    itemCount: N,
    edgeCount: edges.count,
    rects,
    leafBudget: opt.leafBudget,
    levels,
  };
}

/**
 * The level a client shows for a world scale of `k` (screen px per world
 * unit): the deepest level whose tiles are still at least `tilePx` on screen,
 * so tiles are drawn between `tilePx` and `2 * tilePx` pixels. Mirrors
 * `levelFor` in the browser client so benchmarks and prefetch agree with it.
 */
export function viewLevel(k: number, worldSize: number, tilePx = 512, maxZ = MAX_ZOOM): number {
  if (!(k > 0) || !(worldSize > 0)) return 0;
  const z = Math.floor(Math.log2((worldSize * k) / tilePx));
  return z < 0 ? 0 : z > maxZ ? maxZ : z;
}
