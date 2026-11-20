/**
 * Spatial tiles — Morton (Z-order) keys and an O(n) radix sort.
 *
 * Why Morton order: once items are sorted by their interleaved 16-bit grid
 * coordinates, every quadtree tile at every zoom level is a *contiguous range*
 * of the sorted array. Building a pyramid then never needs per-tile filtering or
 * re-bucketing — a child tile is found with two binary searches on the parent's
 * range. That property is what keeps the build at O(n) per level and lets the
 * pyramid scale to millions of items inside a fixed memory envelope.
 *
 * Everything here is allocation-light and works on typed arrays, so it runs the
 * same in Node (tile builder) and in a browser worker (client-side pyramids for
 * in-memory canvases).
 */

/** Grid resolution per axis. 16 bits gives 65 536 cells per side at z = 16. */
export const GRID_BITS = 16;
export const GRID_SIZE = 1 << GRID_BITS; // 65536
export const MAX_ZOOM = GRID_BITS;

/** Spread the low 16 bits of `n` so there is a zero bit between each. */
export function part1by1(n: number): number {
  n &= 0x0000ffff;
  n = (n | (n << 8)) & 0x00ff00ff;
  n = (n | (n << 4)) & 0x0f0f0f0f;
  n = (n | (n << 2)) & 0x33333333;
  n = (n | (n << 1)) & 0x55555555;
  return n >>> 0;
}

/** Inverse of {@link part1by1}. */
export function compact1by1(n: number): number {
  n &= 0x55555555;
  n = (n ^ (n >>> 1)) & 0x33333333;
  n = (n ^ (n >>> 2)) & 0x0f0f0f0f;
  n = (n ^ (n >>> 4)) & 0x00ff00ff;
  n = (n ^ (n >>> 8)) & 0x0000ffff;
  return n >>> 0;
}

/** Interleave x (even bits) and y (odd bits) into one unsigned 32-bit key. */
export function morton2(x: number, y: number): number {
  return (part1by1(x) | (part1by1(y) << 1)) >>> 0;
}

export function demorton2(code: number): { x: number; y: number } {
  return { x: compact1by1(code), y: compact1by1(code >>> 1) };
}

/**
 * The half-open code range `[lo, hi)` covered by tile `(z, tx, ty)`.
 *
 * Returned as plain numbers (not 32-bit ints) because `hi` of the last tile is
 * exactly 2^32, which does not fit in a uint32.
 */
export function tileCodeRange(z: number, tx: number, ty: number): [number, number] {
  const shift = 2 * (GRID_BITS - z);
  const prefix = z === 0 ? 0 : morton2(tx, ty);
  const span = 2 ** shift;
  return [prefix * span, (prefix + 1) * span];
}

/** First index in sorted `codes[lo, hi)` whose value is `>= value`. */
export function lowerBound(codes: Uint32Array, lo: number, hi: number, value: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (codes[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * LSD radix sort of `keys` (uint32), returning the sorting permutation.
 *
 * Four 8-bit passes, O(n) time, two scratch arrays. `Array.prototype.sort` on
 * an index array with a comparator is ~20x slower at a million items and
 * allocates boxed numbers; this stays in typed memory throughout.
 */
export function radixSortPermutation(keys: Uint32Array, count = keys.length): Uint32Array {
  let idx = new Uint32Array(count);
  let tmp = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  const counts = new Uint32Array(256);

  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);
    for (let i = 0; i < count; i++) counts[(keys[idx[i]] >>> shift) & 0xff]++;
    // Skip a pass whose byte is identical for every key — common for the high
    // bytes of small worlds and worth ~25% of the sort on sparse data.
    let single = false;
    for (let b = 0; b < 256; b++) {
      if (counts[b] === count) {
        single = true;
        break;
      }
      if (counts[b] !== 0) break;
    }
    if (single) continue;
    let sum = 0;
    for (let b = 0; b < 256; b++) {
      const c = counts[b];
      counts[b] = sum;
      sum += c;
    }
    for (let i = 0; i < count; i++) {
      const id = idx[i];
      tmp[counts[(keys[id] >>> shift) & 0xff]++] = id;
    }
    const swap = idx;
    idx = tmp;
    tmp = swap;
  }
  return idx;
}

/** Stable string key for a tile, used by caches on both ends. */
export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

export function parentTile(z: number, x: number, y: number): [number, number, number] | null {
  if (z <= 0) return null;
  return [z - 1, x >>> 1, y >>> 1];
}

/** Ancestors of a tile from its parent up to the root, deepest first. */
export function ancestorTiles(z: number, x: number, y: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  let cz = z;
  let cx = x;
  let cy = y;
  while (cz > 0) {
    cz -= 1;
    cx >>>= 1;
    cy >>>= 1;
    out.push([cz, cx, cy]);
  }
  return out;
}
