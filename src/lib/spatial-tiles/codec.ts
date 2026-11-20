/**
 * Spatial tiles — binary wire format ("GTL1").
 *
 * One tile is a fixed header followed by struct-of-arrays sections, each
 * starting on a 4-byte boundary so the decoder can wrap the received buffer in
 * typed-array views. Nothing is parsed character by character, and the decoder
 * output is laid out the way a GPU wants it.
 *
 * Size discipline (this is what a viewer downloads, so every byte is paid for
 * by every user on every pan):
 *
 *  - Point coordinates are 16-bit, quantised over the tile's square plus one
 *    tile of margin on each side (so aggregates and boundary items still fit).
 *    Resolution is tileSize * 3 / 65535 — a small fraction of a pixel at the
 *    sizes tiles are drawn. Rectangle tiles (canvas) keep float32 x/y/w/h.
 *  - An edge endpoint inside the tile is a node *index* (2 bytes), not a
 *    coordinate pair (8 bytes). Only endpoints in another tile carry float32
 *    coordinates. Most edges in a well-laid-out graph are local.
 *  - Edge weights are omitted when every edge in the tile has weight 1.
 *
 * Layout (little-endian):
 *
 *   0   u32  magic 'GTL1'
 *   4   u8   version          5  u8  flags (TileFlags)
 *   6   u8   z                7  u8  reserved
 *   8   u32  tile x          12  u32 tile y
 *  16   u32  node count      20  u32 edge count (local + external)
 *  24   u32  label count     28  u32 items represented
 *  32   f64  tile world x    40  f64 tile world y      48  f64 tile world size
 *  56   u32  external edge count                       60  u32 reserved
 *  64   nodes:  points: u16 qx[n] u16 qy[n] (pad 4) | rects: f32 x[n] y[n] w[n] h[n]
 *               u32 gid[n] u32 weight[n] u8 kind[n] u8 flags[n]                (pad 4)
 *       local edges (both ends in tile):   idx a[ml] idx b[ml]                 (pad 4)
 *       external edges (one end in tile):  idx local[me] f32 ox[me] f32 oy[me] (pad 4)
 *       edge attributes, local then external order:
 *               [u32 weight[m]] u8 kind[m] u8 flags[m] u8 minZ[m]               (pad 4)
 *       labels: u32 nodeIndex[l] u32 byteLength[l] utf8 bytes                  (pad 4)
 *
 *   idx is u16, or u32 when the tile has more than 65535 nodes (WIDE_INDEX).
 */

export const TILE_MAGIC = 0x314c5447; // "GTL1" read as little-endian u32
export const TILE_VERSION = 1;
export const HEADER_BYTES = 64;

export const TileFlags = {
  LEAF: 1,
  /** Nodes carry width/height (canvas rectangles) rather than being points. */
  RECTS: 2,
  /** The requested area holds nothing. Cached by clients so it is never re-asked. */
  EMPTY: 4,
  /** Edge endpoint indices are u32 rather than u16. */
  WIDE_INDEX: 8,
  /** Every edge has weight 1, so the weight array is omitted. */
  UNIT_EDGE_WEIGHT: 16,
} as const;

export const NodeFlags = {
  /** Stands in for several items; `weight` is how many. */
  AGGREGATE: 1,
  /** A high-weight item kept as itself at a coarse level so it can be labelled. */
  HUB: 2,
  /** Has an entry in the label table. */
  LABELLED: 4,
} as const;

export const EdgeFlags = {
  /** Second copy of an edge stored in the tile of its other endpoint. */
  MIRROR: 1,
  /** Bundles several underlying edges; `weight` is how many. */
  AGGREGATE: 2,
  /** Wire-only: for an external edge, the in-tile end is the target. */
  LOCAL_IS_TARGET: 128,
} as const;

export interface TileNodes {
  count: number;
  x: Float32Array;
  y: Float32Array;
  /** Present only for rectangle tiles (canvas nodes). */
  w?: Float32Array;
  h?: Float32Array;
  gid: Uint32Array;
  weight: Uint32Array;
  kind: Uint8Array;
  flags: Uint8Array;
}

export interface TileEdges {
  count: number;
  x1: Float32Array;
  y1: Float32Array;
  x2: Float32Array;
  y2: Float32Array;
  weight: Uint32Array;
  kind: Uint8Array;
  flags: Uint8Array;
  /**
   * Lowest view level at which this edge is drawn. Leaf tiles are displayed
   * across a range of zoom levels; an edge whose far end is still aggregated at
   * the current level is drawn by the aggregate tile instead, so the leaf copy
   * must stay hidden until both ends resolve to real items.
   */
  minZ: Uint8Array;
  /**
   * Endpoint as an index into this tile's nodes, or -1 when that end lies in
   * another tile. Lets the wire format send 2 bytes instead of 8 for the (very
   * common) in-tile endpoint, and lets `filterTile` drop edges exactly.
   */
  a?: Int32Array;
  b?: Int32Array;
}

export interface TileLabels {
  /** Index into the node arrays. */
  index: Uint32Array;
  text: string[];
}

export interface TileData {
  z: number;
  x: number;
  y: number;
  leaf: boolean;
  rects: boolean;
  empty: boolean;
  /** Number of underlying items this tile represents (aggregates counted fully). */
  represented: number;
  /** World-space square covered by this tile. */
  worldX: number;
  worldY: number;
  worldSize: number;
  nodes: TileNodes;
  edges: TileEdges;
  labels: TileLabels;
}

const pad4 = (n: number) => (n + 3) & ~3;
const utf8Encoder = /* @__PURE__ */ new TextEncoder();
const utf8Decoder = /* @__PURE__ */ new TextDecoder();

/** Quantisation frame: the tile square with one tile of margin on each side. */
function frame(tile: Pick<TileData, 'worldX' | 'worldY' | 'worldSize'>) {
  const span = tile.worldSize * 3;
  return { ox: tile.worldX - tile.worldSize, oy: tile.worldY - tile.worldSize, span };
}

/**
 * Resolve each edge end to an in-tile node index when possible. Pyramid output
 * supplies `a`/`b`; for hand-built tiles fall back to exact coordinate matching.
 */
function localEnds(tile: TileData): { a: Int32Array; b: Int32Array } {
  const m = tile.edges.count;
  if (tile.edges.a && tile.edges.b) return { a: tile.edges.a, b: tile.edges.b };
  const byPos = new Map<string, number>();
  for (let i = 0; i < tile.nodes.count; i++) {
    const cx = tile.rects ? tile.nodes.x[i] + tile.nodes.w![i] / 2 : tile.nodes.x[i];
    const cy = tile.rects ? tile.nodes.y[i] + tile.nodes.h![i] / 2 : tile.nodes.y[i];
    const k = `${cx},${cy}`;
    if (!byPos.has(k)) byPos.set(k, i);
  }
  const a = new Int32Array(m);
  const b = new Int32Array(m);
  for (let e = 0; e < m; e++) {
    a[e] = byPos.get(`${tile.edges.x1[e]},${tile.edges.y1[e]}`) ?? -1;
    b[e] = byPos.get(`${tile.edges.x2[e]},${tile.edges.y2[e]}`) ?? -1;
  }
  return { a, b };
}

export function encodeTile(tile: TileData): Uint8Array {
  const n = tile.nodes.count;
  const m = tile.edges.count;
  const l = tile.labels.index.length;
  const rects = tile.rects;
  const wide = n > 0xffff;
  const idxBytes = wide ? 4 : 2;

  // Partition edges: local (both ends in tile), external (one end), orphan
  // (neither — cannot be drawn from this tile, dropped).
  const { a, b } = localEnds(tile);
  const local: number[] = [];
  const external: number[] = [];
  let unitWeight = true;
  for (let e = 0; e < m; e++) {
    if (a[e] >= 0 && b[e] >= 0) local.push(e);
    else if (a[e] >= 0 || b[e] >= 0) external.push(e);
    else continue;
    if (tile.edges.weight[e] !== 1) unitWeight = false;
  }
  const ml = local.length;
  const me = external.length;
  const mt = ml + me;
  const encodedLabels = tile.labels.text.map((t) => utf8Encoder.encode(t));
  let labelBytes = 0;
  for (const bytes of encodedLabels) labelBytes += bytes.byteLength;

  let size = HEADER_BYTES;
  size += rects ? n * 16 : pad4(n * 4);
  size += n * 8 + pad4(n * 2);
  size += pad4(ml * 2 * idxBytes);
  size += pad4(me * idxBytes) + me * 8;
  size += (unitWeight ? 0 : mt * 4) + pad4(mt * 3);
  size += l * 8 + pad4(labelBytes);

  const buf = new ArrayBuffer(size);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  let flags = 0;
  if (tile.leaf) flags |= TileFlags.LEAF;
  if (rects) flags |= TileFlags.RECTS;
  if (tile.empty || (n === 0 && mt === 0)) flags |= TileFlags.EMPTY;
  if (wide) flags |= TileFlags.WIDE_INDEX;
  if (unitWeight) flags |= TileFlags.UNIT_EDGE_WEIGHT;

  view.setUint32(0, TILE_MAGIC, true);
  view.setUint8(4, TILE_VERSION);
  view.setUint8(5, flags);
  view.setUint8(6, tile.z);
  view.setUint32(8, tile.x, true);
  view.setUint32(12, tile.y, true);
  view.setUint32(16, n, true);
  view.setUint32(20, mt, true);
  view.setUint32(24, l, true);
  view.setUint32(28, tile.represented >>> 0, true);
  view.setFloat64(32, tile.worldX, true);
  view.setFloat64(40, tile.worldY, true);
  view.setFloat64(48, tile.worldSize, true);
  view.setUint32(56, me, true);

  let off = HEADER_BYTES;
  const align = () => {
    off = pad4(off);
  };

  // Nodes
  if (rects) {
    for (const src of [tile.nodes.x, tile.nodes.y, tile.nodes.w!, tile.nodes.h!]) {
      if (n) new Float32Array(buf, off, n).set(src.subarray(0, n));
      off += n * 4;
    }
  } else if (n) {
    const { ox, oy, span } = frame(tile);
    const qx = new Uint16Array(buf, off, n);
    const qy = new Uint16Array(buf, off + n * 2, n);
    const s = 65535 / span;
    for (let i = 0; i < n; i++) {
      const vx = Math.round((tile.nodes.x[i] - ox) * s);
      const vy = Math.round((tile.nodes.y[i] - oy) * s);
      qx[i] = vx < 0 ? 0 : vx > 65535 ? 65535 : vx;
      qy[i] = vy < 0 ? 0 : vy > 65535 ? 65535 : vy;
    }
    off += n * 4;
    align();
  }
  if (n) {
    new Uint32Array(buf, off, n).set(tile.nodes.gid.subarray(0, n));
    off += n * 4;
    new Uint32Array(buf, off, n).set(tile.nodes.weight.subarray(0, n));
    off += n * 4;
    bytes.set(tile.nodes.kind.subarray(0, n), off);
    off += n;
    bytes.set(tile.nodes.flags.subarray(0, n), off);
    off += n;
  }
  align();

  // Local edges
  if (ml) {
    const A = wide ? new Uint32Array(buf, off, ml) : new Uint16Array(buf, off, ml);
    const B = wide ? new Uint32Array(buf, off + ml * idxBytes, ml) : new Uint16Array(buf, off + ml * idxBytes, ml);
    local.forEach((e, j) => {
      A[j] = a[e];
      B[j] = b[e];
    });
    off += ml * 2 * idxBytes;
    align();
  }

  // External edges
  const edgeFlagsOut = new Uint8Array(mt);
  if (me) {
    const L = wide ? new Uint32Array(buf, off, me) : new Uint16Array(buf, off, me);
    off += me * idxBytes;
    align();
    const OX = new Float32Array(buf, off, me);
    const OY = new Float32Array(buf, off + me * 4, me);
    off += me * 8;
    external.forEach((e, j) => {
      const sourceLocal = a[e] >= 0;
      L[j] = sourceLocal ? a[e] : b[e];
      OX[j] = sourceLocal ? tile.edges.x2[e] : tile.edges.x1[e];
      OY[j] = sourceLocal ? tile.edges.y2[e] : tile.edges.y1[e];
      edgeFlagsOut[ml + j] = (tile.edges.flags[e] & 0x7f) | (sourceLocal ? 0 : EdgeFlags.LOCAL_IS_TARGET);
    });
  }
  local.forEach((e, j) => {
    edgeFlagsOut[j] = tile.edges.flags[e] & 0x7f;
  });

  // Edge attributes in (local, external) order
  const ordered = local.concat(external);
  if (mt) {
    if (!unitWeight) {
      const W = new Uint32Array(buf, off, mt);
      ordered.forEach((e, j) => {
        W[j] = tile.edges.weight[e];
      });
      off += mt * 4;
    }
    ordered.forEach((e, j) => {
      bytes[off + j] = tile.edges.kind[e];
    });
    off += mt;
    bytes.set(edgeFlagsOut, off);
    off += mt;
    ordered.forEach((e, j) => {
      bytes[off + j] = tile.edges.minZ[e];
    });
    off += mt;
  }
  align();

  // Labels
  if (l) {
    new Uint32Array(buf, off, l).set(tile.labels.index);
    off += l * 4;
    const lengths = new Uint32Array(buf, off, l);
    encodedLabels.forEach((b2, i) => {
      lengths[i] = b2.byteLength;
    });
    off += l * 4;
    for (const b2 of encodedLabels) {
      bytes.set(b2, off);
      off += b2.byteLength;
    }
    align();
  }

  if (off !== size) throw new Error(`encodeTile: wrote ${off} bytes, expected ${size}`);
  return bytes;
}

export class TileDecodeError extends Error {}

/**
 * Decode a tile into renderer-ready arrays. Ids, weights and rectangle extents
 * are zero-copy views when the input is 4-byte aligned; point coordinates and
 * edge endpoints are expanded (they are quantised / indexed on the wire).
 */
export function decodeTile(input: ArrayBuffer | Uint8Array): TileData {
  let buf: ArrayBuffer;
  let base = 0;
  let length: number;
  if (input instanceof Uint8Array) {
    if (input.byteOffset % 4 === 0 && input.buffer instanceof ArrayBuffer) {
      buf = input.buffer;
      base = input.byteOffset;
    } else {
      const copy = new Uint8Array(input.byteLength);
      copy.set(input);
      buf = copy.buffer;
    }
    length = input.byteLength;
  } else {
    buf = input;
    length = input.byteLength;
  }
  if (length < HEADER_BYTES) throw new TileDecodeError('tile shorter than its header');

  const view = new DataView(buf, base, length);
  if (view.getUint32(0, true) !== TILE_MAGIC) throw new TileDecodeError('bad tile magic');
  const version = view.getUint8(4);
  if (version !== TILE_VERSION) throw new TileDecodeError(`unsupported tile version ${version}`);

  const flags = view.getUint8(5);
  const z = view.getUint8(6);
  const tx = view.getUint32(8, true);
  const ty = view.getUint32(12, true);
  const n = view.getUint32(16, true);
  const mt = view.getUint32(20, true);
  const l = view.getUint32(24, true);
  const represented = view.getUint32(28, true);
  const worldX = view.getFloat64(32, true);
  const worldY = view.getFloat64(40, true);
  const worldSize = view.getFloat64(48, true);
  const me = view.getUint32(56, true);
  if (me > mt) throw new TileDecodeError('external edge count exceeds edge count');
  const ml = mt - me;
  const rects = (flags & TileFlags.RECTS) !== 0;
  const wide = (flags & TileFlags.WIDE_INDEX) !== 0;
  const unitWeight = (flags & TileFlags.UNIT_EDGE_WEIGHT) !== 0;

  let off = base + HEADER_BYTES;
  const end = base + length;
  const need = (bytes: number) => {
    if (off + bytes > end) throw new TileDecodeError('tile truncated');
  };
  const align = () => {
    off = base + pad4(off - base);
  };
  const f32 = (count: number) => {
    need(count * 4);
    const v = new Float32Array(buf, off, count);
    off += count * 4;
    return v;
  };
  const u32 = (count: number) => {
    need(count * 4);
    const v = new Uint32Array(buf, off, count);
    off += count * 4;
    return v;
  };
  const u16 = (count: number) => {
    need(count * 2);
    const v = new Uint16Array(buf, off, count);
    off += count * 2;
    return v;
  };
  const u8 = (count: number) => {
    need(count);
    const v = new Uint8Array(buf, off, count);
    off += count;
    return v;
  };
  const idx = (count: number) => (wide ? u32(count) : u16(count));

  // Nodes
  let x: Float32Array;
  let y: Float32Array;
  let w: Float32Array | undefined;
  let h: Float32Array | undefined;
  if (rects) {
    x = f32(n);
    y = f32(n);
    w = f32(n);
    h = f32(n);
  } else {
    const qx = u16(n);
    const qy = u16(n);
    align();
    const { ox, oy, span } = frame({ worldX, worldY, worldSize });
    const s = span / 65535;
    x = new Float32Array(n);
    y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = ox + qx[i] * s;
      y[i] = oy + qy[i] * s;
    }
  }
  const nodes: TileNodes = {
    count: n,
    x,
    y,
    w,
    h,
    gid: u32(n),
    weight: u32(n),
    kind: u8(n),
    flags: u8(n),
  };
  align();

  const cx = (i: number) => (rects ? x[i] + w![i] / 2 : x[i]);
  const cy = (i: number) => (rects ? y[i] + h![i] / 2 : y[i]);
  const checkIndex = (i: number) => {
    if (i >= n) throw new TileDecodeError('edge endpoint index out of range');
    return i;
  };

  const x1 = new Float32Array(mt);
  const y1 = new Float32Array(mt);
  const x2 = new Float32Array(mt);
  const y2 = new Float32Array(mt);
  const ea = new Int32Array(mt);
  const eb = new Int32Array(mt);

  if (ml) {
    const A = idx(ml);
    const B = idx(ml);
    align();
    for (let j = 0; j < ml; j++) {
      const ia = checkIndex(A[j]);
      const ib = checkIndex(B[j]);
      ea[j] = ia;
      eb[j] = ib;
      x1[j] = cx(ia);
      y1[j] = cy(ia);
      x2[j] = cx(ib);
      y2[j] = cy(ib);
    }
  }
  let externalLocal: Uint16Array | Uint32Array | null = null;
  let OX: Float32Array | null = null;
  let OY: Float32Array | null = null;
  if (me) {
    externalLocal = idx(me);
    align();
    OX = f32(me);
    OY = f32(me);
  }

  const weight = unitWeight ? new Uint32Array(mt).fill(1) : u32(mt);
  const kind = u8(mt);
  const eflags = u8(mt);
  const minZ = u8(mt);
  align();

  if (me) {
    for (let j = 0; j < me; j++) {
      const e = ml + j;
      const li = checkIndex(externalLocal![j]);
      if (eflags[e] & EdgeFlags.LOCAL_IS_TARGET) {
        ea[e] = -1;
        eb[e] = li;
        x1[e] = OX![j];
        y1[e] = OY![j];
        x2[e] = cx(li);
        y2[e] = cy(li);
      } else {
        ea[e] = li;
        eb[e] = -1;
        x1[e] = cx(li);
        y1[e] = cy(li);
        x2[e] = OX![j];
        y2[e] = OY![j];
      }
    }
  }
  // Strip the wire-only bit so callers see the same flags they encoded.
  const cleanFlags = new Uint8Array(mt);
  for (let e = 0; e < mt; e++) cleanFlags[e] = eflags[e] & 0x7f;

  const edges: TileEdges = {
    count: mt,
    x1,
    y1,
    x2,
    y2,
    weight,
    kind,
    flags: cleanFlags,
    minZ,
    a: ea,
    b: eb,
  };

  let labels: TileLabels = { index: new Uint32Array(0), text: [] };
  if (l > 0) {
    const index = u32(l);
    const lengths = u32(l);
    const text: string[] = new Array(l);
    for (let i = 0; i < l; i++) {
      if (index[i] >= n) throw new TileDecodeError('label index out of range');
      const len = lengths[i];
      need(len);
      text[i] = utf8Decoder.decode(new Uint8Array(buf, off, len));
      off += len;
    }
    labels = { index, text };
  }

  return {
    z,
    x: tx,
    y: ty,
    leaf: (flags & TileFlags.LEAF) !== 0,
    rects,
    empty: (flags & TileFlags.EMPTY) !== 0,
    represented,
    worldX,
    worldY,
    worldSize,
    nodes,
    edges,
    labels,
  };
}

/** An empty tile for `(z, x, y)`, so "nothing here" is cacheable like any tile. */
export function emptyTile(
  z: number,
  x: number,
  y: number,
  world: { worldX: number; worldY: number; worldSize: number },
  leaf = true
): TileData {
  return {
    z,
    x,
    y,
    leaf,
    rects: false,
    empty: true,
    represented: 0,
    ...world,
    nodes: {
      count: 0,
      x: new Float32Array(0),
      y: new Float32Array(0),
      gid: new Uint32Array(0),
      weight: new Uint32Array(0),
      kind: new Uint8Array(0),
      flags: new Uint8Array(0),
    },
    edges: {
      count: 0,
      x1: new Float32Array(0),
      y1: new Float32Array(0),
      x2: new Float32Array(0),
      y2: new Float32Array(0),
      weight: new Uint32Array(0),
      kind: new Uint8Array(0),
      flags: new Uint8Array(0),
      minZ: new Uint8Array(0),
      a: new Int32Array(0),
      b: new Int32Array(0),
    },
    labels: { index: new Uint32Array(0), text: [] },
  };
}

/**
 * Keep only the nodes for which `keep(gid)` is true, the edges whose in-tile
 * endpoints survive, and the labels of surviving nodes. Used by the server to
 * re-verify a tile whose source data changed after it was built, without
 * rebuilding the pyramid.
 *
 * An external endpoint (in another tile) cannot be verified from here, so an
 * edge is dropped if its external end sits exactly on a removed node of this
 * tile — and otherwise kept; the far tile performs its own filtering.
 */
export function filterTile(tile: TileData, keep: (gid: number) => boolean): TileData {
  const n = tile.nodes.count;
  const remap = new Int32Array(n).fill(-1);
  const keepIdx: number[] = [];
  const removedPos = new Set<string>();
  for (let i = 0; i < n; i++) {
    // Aggregates are verified through their representative gid, which is the
    // item whose title would be shown for them.
    if (keep(tile.nodes.gid[i])) {
      remap[i] = keepIdx.length;
      keepIdx.push(i);
    } else {
      const cx = tile.rects ? tile.nodes.x[i] + tile.nodes.w![i] / 2 : tile.nodes.x[i];
      const cy = tile.rects ? tile.nodes.y[i] + tile.nodes.h![i] / 2 : tile.nodes.y[i];
      removedPos.add(`${cx},${cy}`);
    }
  }
  if (keepIdx.length === n) return tile;

  const k = keepIdx.length;
  const pick = <T extends Float32Array | Uint32Array | Uint8Array>(src: T | undefined): T | undefined => {
    if (!src) return undefined;
    const out = new (src.constructor as { new (len: number): T })(k);
    for (let j = 0; j < k; j++) out[j] = src[keepIdx[j]];
    return out;
  };
  const nodes: TileNodes = {
    count: k,
    x: pick(tile.nodes.x)!,
    y: pick(tile.nodes.y)!,
    w: pick(tile.nodes.w),
    h: pick(tile.nodes.h),
    gid: pick(tile.nodes.gid)!,
    weight: pick(tile.nodes.weight)!,
    kind: pick(tile.nodes.kind)!,
    flags: pick(tile.nodes.flags)!,
  };

  const { a, b } = localEnds(tile);
  const keepEdge: number[] = [];
  for (let e = 0; e < tile.edges.count; e++) {
    const aGone = a[e] >= 0 ? remap[a[e]] < 0 : removedPos.has(`${tile.edges.x1[e]},${tile.edges.y1[e]}`);
    const bGone = b[e] >= 0 ? remap[b[e]] < 0 : removedPos.has(`${tile.edges.x2[e]},${tile.edges.y2[e]}`);
    if (!aGone && !bGone) keepEdge.push(e);
  }
  const em = keepEdge.length;
  const pickE = <T extends Float32Array | Uint32Array | Uint8Array | Int32Array>(src: T): T => {
    const out = new (src.constructor as { new (len: number): T })(em);
    for (let j = 0; j < em; j++) out[j] = src[keepEdge[j]];
    return out;
  };
  const na = new Int32Array(em);
  const nb = new Int32Array(em);
  keepEdge.forEach((e, j) => {
    na[j] = a[e] >= 0 ? remap[a[e]] : -1;
    nb[j] = b[e] >= 0 ? remap[b[e]] : -1;
  });
  const edges: TileEdges = {
    count: em,
    x1: pickE(tile.edges.x1),
    y1: pickE(tile.edges.y1),
    x2: pickE(tile.edges.x2),
    y2: pickE(tile.edges.y2),
    weight: pickE(tile.edges.weight),
    kind: pickE(tile.edges.kind),
    flags: pickE(tile.edges.flags),
    minZ: pickE(tile.edges.minZ),
    a: na,
    b: nb,
  };

  const labelIndex: number[] = [];
  const labelText: string[] = [];
  for (let i = 0; i < tile.labels.index.length; i++) {
    const ni = remap[tile.labels.index[i]];
    if (ni >= 0) {
      labelIndex.push(ni);
      labelText.push(tile.labels.text[i]);
    }
  }

  // Aggregates stand for `weight` items; a real node stands for itself (its
  // weight is an importance score such as degree, not a count).
  let represented = 0;
  for (let j = 0; j < k; j++) {
    represented += nodes.flags[j] & NodeFlags.AGGREGATE ? nodes.weight[j] : 1;
  }

  return {
    ...tile,
    empty: k === 0 && em === 0,
    represented,
    nodes,
    edges,
    labels: { index: Uint32Array.from(labelIndex), text: labelText },
  };
}
