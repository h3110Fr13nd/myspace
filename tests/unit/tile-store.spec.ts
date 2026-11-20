import { expect, test } from '@playwright/test';
import { TileStore, type LayerSource, type TileLoader } from '../../src/components/graph/tiled/TileStore';
import type { WorkerResponse } from '../../src/components/graph/tiled/protocol';
import { prepareTile } from '../../src/components/graph/tiled/prepareTile';
import { emptyTile } from '../../src/lib/spatial-tiles/codec';
import type { TileData } from '../../src/lib/spatial-tiles/codec';

/** A loader that records requests and lets the test answer them. */
class FakeLoader implements TileLoader {
  onMessage: ((msg: WorkerResponse) => void) | null = null;
  requests = new Map<number, string>();
  cancelled: number[] = [];
  load(id: number, url: string) {
    this.requests.set(id, url);
  }
  cancel(id: number) {
    this.cancelled.push(id);
    this.requests.delete(id);
  }
  destroy() {}
  /** Answer the request for `url` with a tile (or an error status). */
  answer(url: string, tile: TileData | number) {
    const entry = [...this.requests.entries()].find(([, u]) => u === url);
    if (!entry) throw new Error(`no pending request for ${url}`);
    const [id] = entry;
    this.requests.delete(id);
    if (typeof tile === 'number') {
      this.onMessage?.({ type: 'error', id, status: tile });
    } else {
      this.onMessage?.({ type: 'tile', id, tile: prepareTile(tile, 'public@1'), wireBytes: 100, ms: 1 });
    }
  }
}

const WORLD = { worldX: 0, worldY: 0, worldSize: 1024 };
const layer: LayerSource = { id: 'public@1', param: 'public', generation: 1 };
const url = (z: number, x: number, y: number) => `/t/public/1/${z}/${x}/${y}`;

function tile(z: number, x: number, y: number, leaf: boolean, nodes = 3): TileData {
  const size = WORLD.worldSize / 2 ** z;
  const t = emptyTile(z, x, y, { worldX: x * size, worldY: y * size, worldSize: size }, leaf);
  t.empty = false;
  t.represented = nodes;
  t.nodes = {
    count: nodes,
    x: Float32Array.from({ length: nodes }, (_, i) => x * size + i),
    y: Float32Array.from({ length: nodes }, () => y * size + 1),
    gid: Uint32Array.from({ length: nodes }, (_, i) => i + 1),
    weight: new Uint32Array(nodes),
    kind: new Uint8Array(nodes),
    flags: new Uint8Array(nodes),
  };
  return t;
}

function setup(opts: { concurrency?: number; maxBytes?: number } = {}) {
  const loader = new FakeLoader();
  let now = 0;
  let gone = 0;
  const evicted: string[] = [];
  const store = new TileStore({
    template: '/t/{layer}/{generation}/{z}/{x}/{y}',
    loader,
    concurrency: opts.concurrency ?? 2,
    maxBytes: opts.maxBytes,
    fadeMs: 0,
    now: () => now,
    onEvict: (k) => evicted.push(k),
    onGenerationGone: () => gone++,
  });
  return {
    store,
    loader,
    evicted,
    gone: () => gone,
    advance: (ms: number) => (now += ms),
    frame: (wants: Array<[number, number, number]>) => {
      store.beginFrame();
      const out = wants.map(([z, x, y], i) => store.want(layer, z, x, y, i));
      store.endFrame();
      return out;
    },
  };
}

test.describe('tile store', () => {
  test('requests at most `concurrency` tiles at once, nearest first', () => {
    const s = setup({ concurrency: 2 });
    s.frame([
      [2, 0, 0],
      [2, 1, 0],
      [2, 2, 0],
    ]);
    expect([...s.loader.requests.values()]).toEqual([url(2, 0, 0), url(2, 1, 0)]);
    s.loader.answer(url(2, 0, 0), tile(2, 0, 0, false));
    // Finishing one starts the next.
    expect([...s.loader.requests.values()]).toContain(url(2, 2, 0));
  });

  test('a leaf answering a deeper request covers its whole area without more requests', () => {
    const s = setup({ concurrency: 4 });
    s.frame([[3, 4, 4]]);
    // The server resolves the deep request to the leaf at 1/1/1.
    s.loader.answer(url(3, 4, 4), tile(1, 1, 1, true));
    const drawn = s.frame([
      [3, 4, 4],
      [3, 5, 5],
      [3, 7, 6],
    ]);
    expect(drawn.every((d) => d.length === 1 && d[0].tile.z === 1 && d[0].exact)).toBe(true);
    expect(s.loader.requests.size).toBe(0);
  });

  test('while a tile streams in, its nearest loaded ancestor stands in', () => {
    const s = setup({ concurrency: 4 });
    s.frame([[0, 0, 0]]);
    s.loader.answer(url(0, 0, 0), tile(0, 0, 0, false));
    const drawn = s.frame([[2, 3, 1]]);
    expect(drawn[0]).toHaveLength(1);
    expect(drawn[0][0].tile.z).toBe(0);
    expect(drawn[0][0].exact).toBe(false);
    expect([...s.loader.requests.values()]).toContain(url(2, 3, 1));
  });

  test('empty answers are remembered, not re-requested', () => {
    const s = setup();
    s.frame([[2, 3, 3]]);
    const e = emptyTile(2, 3, 3, { worldX: 768, worldY: 768, worldSize: 256 });
    s.loader.answer(url(2, 3, 3), e);
    expect(s.frame([[2, 3, 3]])[0]).toEqual([]);
    expect(s.loader.requests.size).toBe(0);
  });

  test('tiles that leave the view are dropped from the queue and aborted in flight', () => {
    const s = setup({ concurrency: 1 });
    s.frame([
      [2, 0, 0],
      [2, 1, 0],
    ]);
    expect(s.loader.requests.size).toBe(1);
    // Two frames elsewhere: the queued one is forgotten, the in-flight one aborted.
    s.frame([[2, 3, 3]]);
    s.frame([[2, 3, 3]]);
    expect(s.loader.cancelled.length).toBe(1);
    expect([...s.loader.requests.values()]).toEqual([url(2, 3, 3)]);
    expect(s.store.getStats().cancelled).toBe(1);
  });

  test('evicts least recently used tiles beyond the byte budget, never ones in view', () => {
    const s = setup({ concurrency: 8, maxBytes: 1 });
    s.frame([
      [1, 0, 0],
      [1, 1, 0],
    ]);
    s.loader.answer(url(1, 0, 0), tile(1, 0, 0, true));
    s.loader.answer(url(1, 1, 0), tile(1, 1, 0, true));
    // Both in view: over budget, but nothing in view is evicted.
    s.frame([
      [1, 0, 0],
      [1, 1, 0],
    ]);
    expect(s.evicted).toEqual([]);
    // Only one stays in view: the other goes.
    s.frame([[1, 0, 0]]);
    expect(s.evicted).toEqual(['public@1/1/1/0']);
  });

  test('a replaced generation (410) asks the host to refresh meta', () => {
    const s = setup();
    s.frame([[1, 0, 0]]);
    s.loader.answer(url(1, 0, 0), 410);
    expect(s.gone()).toBe(1);
  });

  test('failures back off before retrying', () => {
    const s = setup();
    s.frame([[1, 0, 0]]);
    s.loader.answer(url(1, 0, 0), 503);
    s.frame([[1, 0, 0]]);
    expect(s.loader.requests.size).toBe(0);
    s.advance(2500);
    s.frame([[1, 0, 0]]);
    expect([...s.loader.requests.values()]).toEqual([url(1, 0, 0)]);
  });
});
