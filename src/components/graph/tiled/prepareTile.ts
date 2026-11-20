/**
 * Tiled graph — turn a decoded tile into renderer-ready buffers.
 *
 * Runs in the tile worker, so the main thread only ever uploads finished typed
 * arrays to the GPU. Everything here is O(tile size) and tile size is bounded by
 * the pyramid, which is what keeps frame cost independent of graph size.
 *
 *  - Positions are made relative to the tile's origin. WebGL works in float32;
 *    absolute world coordinates in a million-node layout are ~5e5, where
 *    float32 resolution is ~0.03 units — visible jitter when zoomed in. Tile-
 *    relative coordinates keep full precision at any zoom; the per-tile origin
 *    is applied as a uniform computed in float64 on the CPU.
 *  - Edges are sorted by `minZ`, so "edges visible at this level" is always a
 *    prefix and drawing it is one `drawArrays(0, count)` call.
 */
import { EdgeFlags, NodeFlags, type TileData } from '../../../lib/spatial-tiles/codec';
import { kindName } from '../../../lib/graph-tiles/kinds';
import { ENTITY_META } from '../constants';

/** Cells per internal tile side in the default pyramid (builder `grid`). */
export const AGG_GRID = 32;

/** Edge colours: wikilinks in the graph's cyan, containment in neutral slate. */
const LINK_RGB = [0, 242, 254] as const;
const PARENT_RGB = [148, 163, 184] as const;

export interface RenderTile {
  key: string;
  layer: string;
  z: number;
  x: number;
  y: number;
  leaf: boolean;
  empty: boolean;
  represented: number;
  worldX: number;
  worldY: number;
  worldSize: number;
  /** Node instances: [dx, dy] relative to the tile origin. */
  nodePos: Float32Array;
  /** World radius per node. */
  nodeRadius: Float32Array;
  /** RGBA per node, 0-255. */
  nodeColor: Uint8Array;
  /** NodeFlags per node (hub / aggregate / labelled), as float for the GPU. */
  nodeFlags: Float32Array;
  /** Picking data (absolute world coordinates). */
  gid: Uint32Array;
  weight: Uint32Array;
  kind: Uint8Array;
  flags: Uint8Array;
  absX: Float32Array;
  absY: Float32Array;
  /** Line vertices: [dx1, dy1, dx2, dy2] per edge, sorted by minZ. */
  edgePos: Float32Array;
  /** RGBA per vertex (two per edge). */
  edgeColor: Uint8Array;
  /** World length of each edge, per vertex (two per edge), for length fading. */
  edgeLen: Float32Array;
  /** minZ per edge (sorted ascending), for prefix drawing. */
  edgeMinZ: Uint8Array;
  /** Local node index of each edge end, or -1 (for hover highlighting). */
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeCount: number;
  /** Labelled nodes, heaviest first. */
  labelIndex: Uint32Array;
  labelText: string[];
  /** Approximate memory held (CPU side) — the cache budget unit. */
  bytes: number;
}

const rgbCache = new Map<string, [number, number, number]>();

function hexToRgb(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const rgb: [number, number, number] = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [129, 140, 248];
  rgbCache.set(hex, rgb);
  return rgb;
}

/** Colour per kind code, from the same table the classic graph uses. */
export function kindRgb(code: number): [number, number, number] {
  return hexToRgb(ENTITY_META[kindName(code)]?.color ?? '#818cf8');
}

/** World radius of a real node from its degree — the classic graph's curve. */
export function nodeWorldRadius(kindCode: number, degree: number): number {
  const base = ENTITY_META[kindName(kindCode)]?.defaultRadius ?? 4.5;
  return degree <= 0 ? base : base + Math.min(5.5, Math.sqrt(degree));
}

export function prepareTile(tile: TileData, layer: string): RenderTile {
  const n = tile.nodes.count;
  const ox = tile.worldX;
  const oy = tile.worldY;
  const cell = tile.worldSize / AGG_GRID;

  // Aggregates are sized relative to the densest cell in this tile, so every
  // level reads as a density map regardless of how many items a cell holds.
  let maxCount = 1;
  for (let i = 0; i < n; i++) {
    if (tile.nodes.flags[i] & NodeFlags.AGGREGATE && tile.nodes.weight[i] > maxCount) maxCount = tile.nodes.weight[i];
  }

  const nodePos = new Float32Array(n * 2);
  const nodeRadius = new Float32Array(n);
  const nodeColor = new Uint8Array(n * 4);
  const nodeFlags = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = tile.nodes.flags[i];
    const rect = tile.rects;
    const cx = rect ? tile.nodes.x[i] + tile.nodes.w![i] / 2 : tile.nodes.x[i];
    const cy = rect ? tile.nodes.y[i] + tile.nodes.h![i] / 2 : tile.nodes.y[i];
    nodePos[i * 2] = cx - ox;
    nodePos[i * 2 + 1] = cy - oy;
    const [r, g, b] = kindRgb(tile.nodes.kind[i]);
    nodeColor[i * 4] = r;
    nodeColor[i * 4 + 1] = g;
    nodeColor[i * 4 + 2] = b;
    if (f & NodeFlags.AGGREGATE) {
      // A soft disc whose area tracks how many items it stands for, never wider
      // than its lattice cell, so density reads at a glance at every level.
      const count = tile.nodes.weight[i];
      nodeRadius[i] = cell * (0.14 + 0.36 * Math.sqrt(count / maxCount));
      nodeColor[i * 4 + 3] = Math.round(255 * Math.min(0.9, 0.45 + 0.06 * Math.log2(1 + count)));
    } else {
      nodeRadius[i] = nodeWorldRadius(tile.nodes.kind[i], tile.nodes.weight[i]);
      nodeColor[i * 4 + 3] = 255;
    }
    nodeFlags[i] = f;
  }

  // Edges, sorted by minZ (stable within equal minZ).
  const m = tile.edges.count;
  let maxBundle = 1;
  for (let e = 0; e < m; e++) if (tile.edges.weight[e] > maxBundle) maxBundle = tile.edges.weight[e];
  const logMax = Math.log2(1 + maxBundle);
  const order = Array.from({ length: m }, (_, e) => e);
  order.sort((a, b) => tile.edges.minZ[a] - tile.edges.minZ[b] || a - b);
  const edgePos = new Float32Array(m * 4);
  const edgeColor = new Uint8Array(m * 8);
  const edgeLen = new Float32Array(m * 2);
  const edgeMinZ = new Uint8Array(m);
  const edgeA = new Int32Array(m);
  const edgeB = new Int32Array(m);
  for (let j = 0; j < m; j++) {
    const e = order[j];
    edgePos[j * 4] = tile.edges.x1[e] - ox;
    edgePos[j * 4 + 1] = tile.edges.y1[e] - oy;
    edgePos[j * 4 + 2] = tile.edges.x2[e] - ox;
    edgePos[j * 4 + 3] = tile.edges.y2[e] - oy;
    edgeMinZ[j] = tile.edges.minZ[e];
    const len = Math.hypot(tile.edges.x2[e] - tile.edges.x1[e], tile.edges.y2[e] - tile.edges.y1[e]);
    edgeLen[j * 2] = len;
    edgeLen[j * 2 + 1] = len;
    edgeA[j] = tile.edges.a ? tile.edges.a[e] : -1;
    edgeB[j] = tile.edges.b ? tile.edges.b[e] : -1;
    const bundled = (tile.edges.flags[e] & EdgeFlags.AGGREGATE) !== 0;
    const link = tile.edges.kind[e] === 1;
    // Containment edges stay quiet; wikilinks carry the structure. A bundle
    // brightens with the number of links it stands for, so the overview shows
    // where connections concentrate instead of a uniform hairball.
    const base = link ? LINK_RGB : PARENT_RGB;
    // Relative to the heaviest bundle in this tile: in an overview, single
    // cross-links fade to a haze and the dominant flows stand out.
    const rel = tile.leaf ? 1 : Math.log2(1 + tile.edges.weight[e]) / logMax;
    const alpha = link
      ? bundled || !tile.leaf
        ? Math.round(10 + 170 * rel * rel)
        : 70
      : bundled || !tile.leaf
        ? Math.round(8 + 100 * rel * rel)
        : 40;
    for (let v = 0; v < 2; v++) {
      const o = j * 8 + v * 4;
      edgeColor[o] = base[0];
      edgeColor[o + 1] = base[1];
      edgeColor[o + 2] = base[2];
      edgeColor[o + 3] = alpha;
    }
  }

  // Labels heaviest-first, so placement can stop early.
  const l = tile.labels.index.length;
  const lorder = Array.from({ length: l }, (_, i) => i);
  const hub = (i: number) => (tile.nodes.flags[tile.labels.index[i]] & NodeFlags.HUB ? 1 : 0);
  lorder.sort(
    (a, b) => hub(b) - hub(a) || tile.nodes.weight[tile.labels.index[b]] - tile.nodes.weight[tile.labels.index[a]]
  );
  const labelIndex = Uint32Array.from(lorder, (i) => tile.labels.index[i]);
  const labelText = lorder.map((i) => tile.labels.text[i]);

  const absX = new Float32Array(n);
  const absY = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    absX[i] = nodePos[i * 2] + ox;
    absY[i] = nodePos[i * 2 + 1] + oy;
  }

  let labelBytes = 0;
  for (const t of labelText) labelBytes += t.length * 2 + 32;
  const bytes =
    n * (8 + 4 + 4 + 4 + 4 + 4 + 1 + 1 + 8) + m * (16 + 8 + 8 + 1 + 8) + labelBytes + l * 4 + 512;

  return {
    key: `${layer}/${tile.z}/${tile.x}/${tile.y}`,
    layer,
    z: tile.z,
    x: tile.x,
    y: tile.y,
    leaf: tile.leaf,
    empty: tile.empty,
    represented: tile.represented,
    worldX: tile.worldX,
    worldY: tile.worldY,
    worldSize: tile.worldSize,
    nodePos,
    nodeRadius,
    nodeColor,
    nodeFlags,
    gid: tile.nodes.gid.slice(),
    weight: tile.nodes.weight.slice(),
    kind: tile.nodes.kind.slice(),
    flags: tile.nodes.flags.slice(),
    absX,
    absY,
    edgePos,
    edgeColor,
    edgeLen,
    edgeMinZ,
    edgeA,
    edgeB,
    edgeCount: m,
    labelIndex,
    labelText,
    bytes,
  };
}

/** Number of leading edges visible at view level `z` (edges are sorted by minZ). */
export function visibleEdgePrefix(tile: RenderTile, z: number): number {
  if (!tile.leaf) return tile.edgeCount;
  let lo = 0;
  let hi = tile.edgeCount;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tile.edgeMinZ[mid] <= z) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Typed arrays of a render tile, for zero-copy `postMessage` transfer. */
export function transferables(tile: RenderTile): ArrayBuffer[] {
  return [
    tile.nodePos,
    tile.nodeRadius,
    tile.nodeColor,
    tile.nodeFlags,
    tile.gid,
    tile.weight,
    tile.kind,
    tile.flags,
    tile.absX,
    tile.absY,
    tile.edgePos,
    tile.edgeColor,
    tile.edgeLen,
    tile.edgeMinZ,
    tile.edgeA,
    tile.edgeB,
    tile.labelIndex,
  ].map((a) => a.buffer as ArrayBuffer);
}
