/**
 * One measurement, in its own process so peak RSS is attributable.
 *
 *   node --import tsx bench/graph-server.worker.ts legacy 100000
 *   node --import tsx bench/graph-server.worker.ts tiled  1000000
 *
 * Prints one JSON line on stdout.
 */
import { gzipSync } from 'node:zlib';
import { buildGraphData } from '../src/lib/workspace/graphTopology';
import { structuralLayout, adjacencyCSR } from '../src/lib/spatial-tiles/layout';
import { buildPyramid, viewLevel } from '../src/lib/spatial-tiles/pyramid';
import { encodeTile } from '../src/lib/spatial-tiles/codec';
import { degrees, graphEdges, materialiseRows, synthWorkspace } from './lib/synth';

const [, , variant, nArg] = process.argv;
const n = Number(nArg);

function peakRssMb() {
  // maxRSS is reported in kilobytes.
  return Math.round(process.resourceUsage().maxRSS / 1024);
}

function emit(result: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ variant, n, ...result, peakRssMb: peakRssMb() }) + '\n');
}

async function legacy() {
  const ws = synthWorkspace(n);
  const rssBeforeRows = peakRssMb();
  const t0 = performance.now();
  // What `pg` hands the endpoint: one object per resource. Included in the
  // measurement because the endpoint holds all of them at once.
  const rows = materialiseRows(ws);
  const t1 = performance.now();
  const graph = buildGraphData(rows as any);
  const t2 = performance.now();
  const body = JSON.stringify(graph);
  const t3 = performance.now();
  const gz = gzipSync(body, { level: 6 });
  const t4 = performance.now();
  emit({
    nodes: graph.nodes.length,
    links: graph.links.length,
    rowsMs: Math.round(t1 - t0),
    buildMs: Math.round(t2 - t1),
    stringifyMs: Math.round(t3 - t2),
    gzipMs: Math.round(t4 - t3),
    serverMsPerRequest: Math.round(t4 - t1),
    payloadBytes: Buffer.byteLength(body),
    payloadGzBytes: gz.byteLength,
    firstViewGzBytes: gz.byteLength,
    rssBeforeRowsMb: rssBeforeRows,
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
  });
}

async function tiled() {
  const ws = synthWorkspace(n);
  const edges = graphEdges(ws);
  const deg = degrees(n, edges.src, edges.dst);
  const t0 = performance.now();
  const { linkStart, linkTargets } = adjacencyCSR(n, ws.linkSrc, ws.linkDst);
  const layout = structuralLayout({ count: n, parent: ws.parent, linkStart, linkTargets });
  const t1 = performance.now();

  const gid = new Uint32Array(n);
  for (let i = 0; i < n; i++) gid[i] = i + 1;

  let tiles = 0;
  let rawBytes = 0;
  let gzBytes = 0;
  let maxTileGz = 0;
  let maxTileNodes = 0;
  let encodeMs = 0;
  let rootGz = 0;
  const byLevel = new Map<number, { count: number; gz: number }>();
  const index = new Map<string, { leaf: boolean; gz: number; wx: number; wy: number; ws: number }>();
  const meta = buildPyramid(
    { count: n, x: layout.x, y: layout.y, gid, kind: ws.kind, weight: deg, label: (i) => ws.title(i) },
    edges,
    { leafBudget: Number(process.env.BENCH_LEAF ?? 1024) },
    (tile) => {
      const e0 = performance.now();
      const raw = encodeTile(tile);
      const gz = gzipSync(raw, { level: 6 });
      encodeMs += performance.now() - e0;
      tiles++;
      rawBytes += raw.byteLength;
      gzBytes += gz.byteLength;
      if (gz.byteLength > maxTileGz) maxTileGz = gz.byteLength;
      if (tile.nodes.count > maxTileNodes) maxTileNodes = tile.nodes.count;
      if (tile.z === 0) rootGz = gz.byteLength;
      index.set(`${tile.z}/${tile.x}/${tile.y}`, {
        leaf: tile.leaf,
        gz: gz.byteLength,
        wx: tile.worldX,
        wy: tile.worldY,
        ws: tile.worldSize,
      });
      const level = byLevel.get(tile.z) ?? { count: 0, gz: 0 };
      level.count++;
      level.gz += gz.byteLength;
      byLevel.set(tile.z, level);
    }
  );
  const t2 = performance.now();

  // Simulate what a client fetches for a 1600x1000 viewport: walk from the
  // root, take a tile when it is a leaf or at the view level, else descend.
  const W = 1600;
  const H = 1000;
  const viewBytes = (cx: number, cy: number, k: number) => {
    const z = viewLevel(k, meta.worldSize, 512, meta.maxZ);
    const vx0 = cx - W / 2 / k;
    const vy0 = cy - H / 2 / k;
    const vx1 = cx + W / 2 / k;
    const vy1 = cy + H / 2 / k;
    let bytes = 0;
    let count = 0;
    const stack: Array<[number, number, number]> = [[0, 0, 0]];
    while (stack.length) {
      const [tz, tx, ty] = stack.pop()!;
      const t = index.get(`${tz}/${tx}/${ty}`);
      if (!t) continue;
      if (t.wx > vx1 || t.wy > vy1 || t.wx + t.ws < vx0 || t.wy + t.ws < vy0) continue;
      if (t.leaf || tz >= z) {
        bytes += t.gz;
        count++;
        continue;
      }
      for (let c = 0; c < 4; c++) stack.push([tz + 1, tx * 2 + (c & 1), ty * 2 + (c >> 1)]);
    }
    return { bytes, count };
  };
  // Overview: the whole world fits the screen.
  const fitK = Math.min(W, H) / meta.worldSize;
  const overview = viewBytes(meta.worldX + meta.worldSize / 2, meta.worldY + meta.worldSize / 2, fitK);
  // Detail: zoomed so nodes are ~24 world units apart at ~40 px (labels legible),
  // centred on 20 random nodes.
  let detailBytes = 0;
  let detailTiles = 0;
  const samples = 20;
  for (let s = 0; s < samples; s++) {
    const i = Math.floor(((s * 2654435761) >>> 0) / 4294967296 * n);
    const v = viewBytes(layout.x[i], layout.y[i], 1.6);
    detailBytes += v.bytes;
    detailTiles += v.count;
  }
  const detailViewGz = Math.round(detailBytes / samples);

  emit({
    nodes: n,
    links: edges.count,
    layoutMs: Math.round(t1 - t0),
    pyramidMs: Math.round(t2 - t1 - encodeMs),
    encodeGzipMs: Math.round(encodeMs),
    buildTotalMs: Math.round(t2 - t0),
    tiles,
    levels: meta.maxZ + 1,
    rawBytes,
    gzBytes,
    maxTileGzBytes: maxTileGz,
    maxTileNodes,
    firstViewGzBytes: overview.bytes,
    firstViewTiles: overview.count,
    rootGzBytes: rootGz,
    detailViewGzBytes: detailViewGz,
    detailViewTiles: +(detailTiles / samples).toFixed(1),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
  });
}

(variant === 'legacy' ? legacy() : tiled()).catch((err) => {
  emit({ error: String(err?.message ?? err) });
  process.exit(1);
});
