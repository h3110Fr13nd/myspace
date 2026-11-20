import { expect, test, type Page, type Route } from '@playwright/test';
import { encodeTile, emptyTile } from '../../src/lib/spatial-tiles/codec';
import { buildPyramid } from '../../src/lib/spatial-tiles/pyramid';
import { adjacencyCSR, structuralLayout } from '../../src/lib/spatial-tiles/layout';
import { degrees, graphEdges, synthWorkspace } from '../../bench/lib/synth';

/**
 * The streamed graph view, driven in a real browser against an in-memory
 * pyramid served through request interception — no database, no tile build.
 * The route handler mirrors the server's contract: exact tile, else the
 * deepest leaf ancestor, else an empty tile.
 */

const N = 20000;
const ws = synthWorkspace(N, 3);
const edges = graphEdges(ws);
const deg = degrees(N, edges.src, edges.dst);
const { linkStart, linkTargets } = adjacencyCSR(N, ws.linkSrc, ws.linkDst);
const layout = structuralLayout({ count: N, parent: ws.parent, linkStart, linkTargets });
const tiles = new Map<string, { bytes: Uint8Array; leaf: boolean }>();
const meta = buildPyramid(
  {
    count: N,
    x: layout.x,
    y: layout.y,
    gid: Uint32Array.from({ length: N }, (_, i) => i + 1),
    kind: ws.kind,
    weight: deg,
    label: (i) => ws.title(i),
  },
  edges,
  { leafBudget: 512 },
  (t) => tiles.set(`${t.z}/${t.x}/${t.y}`, { bytes: encodeTile(t), leaf: t.leaf })
);
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (let i = 0; i < N; i++) {
  minX = Math.min(minX, layout.x[i]);
  minY = Math.min(minY, layout.y[i]);
  maxX = Math.max(maxX, layout.x[i]);
  maxY = Math.max(maxY, layout.y[i]);
}

interface Served {
  requests: string[];
}

async function serveGraph(page: Page): Promise<Served> {
  const served: Served = { requests: [] };
  await page.route('**/api/v1/graph/meta', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        nodes: N,
        tileTemplate: '/api/v1/graph/tiles/{layer}/{generation}/{z}/{x}/{y}',
        layers: [
          {
            layer: 'public',
            generation: 1,
            world: { x: meta.worldX, y: meta.worldY, size: meta.worldSize },
            content: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
            maxZ: meta.maxZ,
            nodes: N,
            edges: edges.count,
            dirty: false,
          },
        ],
      }),
    })
  );
  await page.route('**/api/v1/graph/tiles/**', (route: Route) => {
    const m = /\/tiles\/public\/1\/(\d+)\/(\d+)\/(\d+)$/.exec(route.request().url());
    if (!m) return route.fulfill({ status: 404 });
    let [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    served.requests.push(`${z}/${x}/${y}`);
    const exact = tiles.get(`${z}/${x}/${y}`);
    if (exact) return route.fulfill({ contentType: 'application/vnd.graph-tile', body: Buffer.from(exact.bytes) });
    const rz = z;
    const rx = x;
    const ry = y;
    while (z > 0) {
      z -= 1;
      x >>>= 1;
      y >>>= 1;
      const t = tiles.get(`${z}/${x}/${y}`);
      if (t) {
        if (t.leaf) return route.fulfill({ contentType: 'application/vnd.graph-tile', body: Buffer.from(t.bytes) });
        break;
      }
    }
    const size = meta.worldSize / 2 ** rz;
    const body = encodeTile(
      emptyTile(rz, rx, ry, { worldX: meta.worldX + rx * size, worldY: meta.worldY + ry * size, worldSize: size })
    );
    return route.fulfill({ contentType: 'application/vnd.graph-tile', body: Buffer.from(body) });
  });
  return served;
}

const stats = (page: Page) => page.evaluate(() => (window as any).__tiledGraph.stats());

async function open(page: Page) {
  const served = await serveGraph(page);
  await page.goto('/bench/graph');
  await page.waitForFunction(() => (window as any).__tiledGraph?.stats().tilesDrawn > 0, null, { timeout: 30000 });
  return served;
}

test('streams only the tiles the viewport needs and draws them', async ({ page }) => {
  const served = await open(page);
  await page.waitForTimeout(600);
  const s = await stats(page);
  expect(['webgl2', 'canvas2d']).toContain(s.renderer);
  // The whole 20k-node graph at fit zoom needs a handful of tiles, not the graph.
  expect(s.tilesDrawn).toBeGreaterThan(0);
  expect(s.tilesDrawn).toBeLessThanOrEqual(16);
  expect(served.requests.length).toBeLessThan(40);
  await expect(page.locator('.tiled-graph__hud')).toContainText('20,000 nodes');
});

test('zooming in swaps coarse tiles for detailed ones', async ({ page }) => {
  const served = await open(page);
  const before = await stats(page);
  await page.evaluate(() => (window as any).__tiledGraph.zoomBy(16));
  await page.waitForFunction((k) => (window as any).__tiledGraph.stats().camera.k > k * 10, before.camera.k);
  await page.waitForTimeout(800);
  const deepest = Math.max(...served.requests.map((r) => Number(r.split('/')[0])));
  expect(deepest).toBeGreaterThan(1);
  const after = await stats(page);
  expect(after.tilesDrawn).toBeGreaterThan(0);
});

test('memory stays bounded while panning across the whole graph', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).__tiledGraph.zoomBy(20));
  for (let i = 0; i < 30; i++) {
    await page.evaluate((d) => (window as any).__tiledGraph.panBy(d, d / 2), 300);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500);
  const s = await stats(page);
  // The cache budget is 96 MB; a 20k graph never comes close, but the point is
  // that the loaded set tracks the view, not the graph.
  expect(s.bytes).toBeLessThan(96 * 1024 * 1024);
  expect(s.tilesDrawn).toBeLessThanOrEqual(16);
});

test('keyboard zoom and fit work from the focused stage', async ({ page }) => {
  await open(page);
  const k0 = (await stats(page)).camera.k;
  await page.locator('.tiled-graph__stage').focus();
  await page.keyboard.press('+');
  await page.waitForFunction((k) => (window as any).__tiledGraph.stats().camera.k > k * 1.2, k0);
  await page.keyboard.press('0');
  await page.waitForFunction((k) => Math.abs((window as any).__tiledGraph.stats().camera.k - k) / k < 0.05, k0, {
    timeout: 5000,
  });
});

test('clicking a cluster zooms into it; hovering a node names it', async ({ page }) => {
  await open(page);
  await page.waitForTimeout(600);
  // Find an aggregate and a labelled node on screen through the debug handle's
  // camera and the drawn tiles, by probing the canvas for hover tooltips.
  const box = (await page.locator('.tiled-graph__stage').boundingBox())!;
  let tooltip: string | null = null;
  for (let gy = 0.3; gy <= 0.7 && !tooltip; gy += 0.05) {
    for (let gx = 0.3; gx <= 0.7 && !tooltip; gx += 0.02) {
      await page.mouse.move(box.x + box.width * gx, box.y + box.height * gy);
      await page.waitForTimeout(20);
      if (await page.locator('.tiled-graph__tooltip').isVisible()) {
        tooltip = await page.locator('.tiled-graph__tooltip').innerText();
      }
    }
  }
  expect(tooltip).not.toBeNull();
  const k0 = (await stats(page)).camera.k;
  if (tooltip!.includes('click to zoom in')) {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction((k) => (window as any).__tiledGraph.stats().camera.k > k * 2, k0, { timeout: 5000 });
  }
});
