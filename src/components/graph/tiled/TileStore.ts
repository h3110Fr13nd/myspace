/**
 * Tiled graph — client tile cache and request scheduler.
 *
 * Contract with the view, once per rendered frame:
 *
 *   store.beginFrame();
 *   for each tile the viewport covers: store.want(layer, z, x, y, priority)
 *   store.endFrame();
 *
 * `want` returns what can be drawn *right now* for that area — the exact tile,
 * a leaf ancestor that already holds everything below it, or (while the exact
 * tile streams in) a coarser ancestor or the finer children. The screen is
 * therefore never blank during a pan or zoom, which is most of what makes a
 * streamed view feel smooth.
 *
 * Memory is bounded by `maxBytes` (LRU over tiles not used in the current
 * frame); network by `concurrency`; and requests for tiles that left the
 * viewport before they arrived are cancelled.
 */
import type { RenderTile } from './prepareTile';
import { prepareTile } from './prepareTile';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { decodeTile } from '../../../lib/spatial-tiles/codec';

export interface LayerSource {
  /** Stable id including generation, e.g. `public@3`. */
  id: string;
  /** URL segment: `public` or `me`. */
  param: string;
  generation: number;
}

export interface TileLoader {
  load(id: number, url: string, layer: string): void;
  cancel(id: number): void;
  onMessage: ((msg: WorkerResponse) => void) | null;
  destroy(): void;
}

/** Loader backed by the tile worker (the normal browser path). */
export function workerLoader(): TileLoader | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  const loader: TileLoader = {
    onMessage: null,
    load(id, url, layer) {
      worker.postMessage({ type: 'load', id, url, layer } satisfies WorkerRequest);
    },
    cancel(id) {
      worker.postMessage({ type: 'cancel', id } satisfies WorkerRequest);
    },
    destroy() {
      worker.terminate();
    },
  };
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => loader.onMessage?.(e.data);
  return loader;
}

/** Loader on the calling thread — fallback without Worker support, and for tests. */
export function inlineLoader(fetchImpl: typeof fetch = fetch): TileLoader {
  const controllers = new Map<number, AbortController>();
  const loader: TileLoader = {
    onMessage: null,
    load(id, url, layer) {
      const ctrl = new AbortController();
      controllers.set(id, ctrl);
      const started = performance.now();
      fetchImpl(url, { credentials: 'same-origin', signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) {
            loader.onMessage?.({ type: 'error', id, status: res.status });
            return;
          }
          const buf = await res.arrayBuffer();
          const tile = prepareTile(decodeTile(buf), layer);
          loader.onMessage?.({ type: 'tile', id, tile, wireBytes: buf.byteLength, ms: performance.now() - started });
        })
        .catch((err) => {
          loader.onMessage?.({ type: (err as Error)?.name === 'AbortError' ? 'aborted' : 'error', id, status: 0 });
        })
        .finally(() => controllers.delete(id));
    },
    cancel(id) {
      controllers.get(id)?.abort();
      controllers.delete(id);
    },
    destroy() {
      for (const c of controllers.values()) c.abort();
      controllers.clear();
    },
  };
  return loader;
}

type Slot =
  | { state: 'loaded'; tile: RenderTile; lastUsed: number; arrivedAt: number }
  | { state: 'empty'; lastUsed: number }
  | { state: 'queued'; priority: number; url: string; layer: string; wantedAt: number }
  | { state: 'loading'; id: number; wantedAt: number }
  | { state: 'failed'; retryAt: number; attempts: number };

export interface Drawable {
  tile: RenderTile;
  /** 0..1 fade-in progress, for a soft arrival instead of a pop. */
  fade: number;
  /** True when this is the exact tile (or its leaf ancestor), not a stand-in. */
  exact: boolean;
}

export interface TileStoreStats {
  loaded: number;
  bytes: number;
  inflight: number;
  queued: number;
  fetched: number;
  wireBytes: number;
  cancelled: number;
}

export interface TileStoreOptions {
  template: string;
  loader: TileLoader;
  maxBytes?: number;
  concurrency?: number;
  fadeMs?: number;
  onChange?: () => void;
  onEvict?: (key: string) => void;
  onGenerationGone?: (layerParam: string) => void;
  now?: () => number;
}

const key = (layer: string, z: number, x: number, y: number) => `${layer}/${z}/${x}/${y}`;

export class TileStore {
  private slots = new Map<string, Slot>();
  /** Requested key -> key of the leaf that answered it. */
  private alias = new Map<string, string>();
  private byId = new Map<number, string>();
  private frame = 0;
  private nextId = 1;
  private bytes = 0;
  private stats = { fetched: 0, wireBytes: 0, cancelled: 0 };
  private readonly opt: Required<Omit<TileStoreOptions, 'onEvict' | 'onChange' | 'onGenerationGone'>> &
    Pick<TileStoreOptions, 'onEvict' | 'onChange' | 'onGenerationGone'>;

  constructor(options: TileStoreOptions) {
    this.opt = {
      maxBytes: 96 * 1024 * 1024,
      concurrency: 6,
      fadeMs: 180,
      now: () => performance.now(),
      ...options,
    };
    this.opt.loader.onMessage = (msg) => this.receive(msg);
  }

  destroy(): void {
    for (const [k, s] of this.slots) {
      if (s.state === 'loading') this.opt.loader.cancel(s.id);
      if (s.state === 'loaded') this.opt.onEvict?.(k);
    }
    this.slots.clear();
    this.opt.loader.destroy();
  }

  getStats(): TileStoreStats {
    let loaded = 0;
    let inflight = 0;
    let queued = 0;
    for (const s of this.slots.values()) {
      if (s.state === 'loaded') loaded++;
      else if (s.state === 'loading') inflight++;
      else if (s.state === 'queued') queued++;
    }
    return { loaded, bytes: this.bytes, inflight, queued, ...this.stats };
  }

  /** Drop everything for a layer (e.g. its generation was replaced). */
  dropLayer(layerId: string): void {
    for (const [k, s] of [...this.slots]) {
      if (!k.startsWith(`${layerId}/`)) continue;
      if (s.state === 'loading') this.opt.loader.cancel(s.id);
      if (s.state === 'loaded') {
        this.bytes -= s.tile.bytes;
        this.opt.onEvict?.(k);
      }
      this.slots.delete(k);
    }
    for (const k of [...this.alias.keys()]) if (k.startsWith(`${layerId}/`)) this.alias.delete(k);
  }

  beginFrame(): void {
    this.frame++;
  }

  /**
   * What to draw for tile `(z, x, y)` of `layer`, requesting it if needed.
   * Lower `priority` is fetched sooner.
   */
  want(layer: LayerSource, z: number, x: number, y: number, priority: number): Drawable[] {
    const now = this.opt.now();
    const exactKey = key(layer.id, z, x, y);

    // A loaded leaf at or above this tile already contains everything here.
    for (let az = z, ax = x, ay = y; az >= 0; az--, ax >>>= 1, ay >>>= 1) {
      const k = key(layer.id, az, ax, ay);
      const s = this.slots.get(k);
      if (s?.state === 'loaded' && (s.tile.leaf || az === z)) {
        s.lastUsed = this.frame;
        return [{ tile: s.tile, fade: this.fade(s.arrivedAt, now), exact: true }];
      }
      if (az === z && s?.state === 'empty') {
        s.lastUsed = this.frame;
        return [];
      }
      if (az === z) {
        const aliased = this.alias.get(k);
        const target = aliased ? this.slots.get(aliased) : undefined;
        if (target?.state === 'loaded') {
          target.lastUsed = this.frame;
          return [{ tile: target.tile, fade: this.fade(target.arrivedAt, now), exact: true }];
        }
      }
    }

    this.request(layer, z, x, y, priority, exactKey);

    // Stand-ins while it streams: the nearest loaded ancestor...
    for (let az = z - 1, ax = x >>> 1, ay = y >>> 1; az >= 0; az--, ax >>>= 1, ay >>>= 1) {
      const s = this.slots.get(key(layer.id, az, ax, ay));
      if (s?.state === 'loaded') {
        s.lastUsed = this.frame;
        return [{ tile: s.tile, fade: 1, exact: false }];
      }
    }
    // ...or, when zooming out, the finer children that are already here.
    const children: Drawable[] = [];
    for (let c = 0; c < 4; c++) {
      const s = this.slots.get(key(layer.id, z + 1, x * 2 + (c & 1), y * 2 + (c >> 1)));
      if (s?.state === 'loaded') {
        s.lastUsed = this.frame;
        children.push({ tile: s.tile, fade: 1, exact: false });
      }
    }
    return children;
  }

  /** Queue a tile without drawing it (prefetch). */
  prefetch(layer: LayerSource, z: number, x: number, y: number, priority: number): void {
    const k = key(layer.id, z, x, y);
    const s = this.slots.get(k);
    if (s?.state === 'loaded' || s?.state === 'empty' || this.alias.has(k)) return;
    // Skip if covered by a loaded leaf ancestor.
    for (let az = z - 1, ax = x >>> 1, ay = y >>> 1; az >= 0; az--, ax >>>= 1, ay >>>= 1) {
      const a = this.slots.get(key(layer.id, az, ax, ay));
      if (a?.state === 'loaded' && a.tile.leaf) return;
    }
    this.request(layer, z, x, y, priority, k);
  }

  /** Cancel what is no longer wanted, start what is, and trim memory. */
  endFrame(): void {
    for (const [k, s] of this.slots) {
      if (s.state === 'queued' && s.wantedAt < this.frame) {
        this.slots.delete(k);
      } else if (s.state === 'loading' && s.wantedAt < this.frame - 1) {
        // In flight but off screen for two frames: abort rather than parse it.
        this.opt.loader.cancel(s.id);
        this.byId.delete(s.id);
        this.slots.delete(k);
        this.stats.cancelled++;
      }
    }
    this.pump();
    this.evict();
  }

  private fade(arrivedAt: number, now: number): number {
    if (this.opt.fadeMs <= 0) return 1;
    const t = (now - arrivedAt) / this.opt.fadeMs;
    return t >= 1 ? 1 : t <= 0 ? 0 : t;
  }

  private request(layer: LayerSource, z: number, x: number, y: number, priority: number, k: string): void {
    const s = this.slots.get(k);
    if (s?.state === 'loading') {
      s.wantedAt = this.frame;
      return;
    }
    if (s?.state === 'queued') {
      s.wantedAt = this.frame;
      if (priority < s.priority) s.priority = priority;
      return;
    }
    if (s?.state === 'failed' && s.retryAt > this.opt.now()) return;
    const url = this.opt.template
      .replace('{layer}', layer.param)
      .replace('{generation}', String(layer.generation))
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    this.slots.set(k, { state: 'queued', priority, url, layer: layer.id, wantedAt: this.frame });
  }

  private pump(): void {
    let inflight = 0;
    for (const s of this.slots.values()) if (s.state === 'loading') inflight++;
    if (inflight >= this.opt.concurrency) return;
    const queued: Array<[string, Extract<Slot, { state: 'queued' }>]> = [];
    for (const [k, s] of this.slots) if (s.state === 'queued') queued.push([k, s]);
    queued.sort((a, b) => a[1].priority - b[1].priority);
    for (const [k, s] of queued) {
      if (inflight >= this.opt.concurrency) break;
      const id = this.nextId++;
      this.byId.set(id, k);
      this.slots.set(k, { state: 'loading', id, wantedAt: s.wantedAt });
      this.opt.loader.load(id, s.url, s.layer);
      inflight++;
    }
  }

  private receive(msg: WorkerResponse): void {
    const requested = this.byId.get(msg.id);
    this.byId.delete(msg.id);
    if (!requested) return;
    const slot = this.slots.get(requested);
    if (slot?.state !== 'loading' || slot.id !== msg.id) return;

    if (msg.type === 'aborted') {
      this.slots.delete(requested);
    } else if (msg.type === 'error') {
      if (msg.status === 410) {
        this.slots.delete(requested);
        const param = requested.split('@')[0];
        this.opt.onGenerationGone?.(param);
      } else {
        const prev = this.slots.get(requested);
        const attempts = prev && prev.state === 'failed' ? prev.attempts + 1 : 1;
        this.slots.set(requested, {
          state: 'failed',
          attempts,
          retryAt: this.opt.now() + Math.min(30000, 1000 * 2 ** attempts),
        });
      }
    } else {
      const tile = msg.tile;
      this.stats.fetched++;
      this.stats.wireBytes += msg.wireBytes;
      if (tile.empty) {
        this.slots.set(requested, { state: 'empty', lastUsed: this.frame });
      } else {
        const layerId = requested.slice(0, requested.indexOf('/'));
        const actual = key(layerId, tile.z, tile.x, tile.y);
        if (actual !== requested) {
          this.alias.set(requested, actual);
          this.slots.delete(requested);
        }
        const existing = this.slots.get(actual);
        if (existing?.state === 'loaded') {
          // Two requests resolved to the same leaf; keep the first copy.
          existing.lastUsed = this.frame;
        } else {
          if (existing?.state === 'loading') {
            this.opt.loader.cancel(existing.id);
            this.byId.delete(existing.id);
          }
          this.slots.set(actual, { state: 'loaded', tile, lastUsed: this.frame, arrivedAt: this.opt.now() });
          this.bytes += tile.bytes;
        }
      }
    }
    this.pump();
    this.opt.onChange?.();
  }

  private evict(): void {
    if (this.bytes <= this.opt.maxBytes) {
      // Empty markers are tiny, but bound them too.
      if (this.slots.size < 50000) return;
    }
    const candidates: Array<[string, number, number]> = [];
    for (const [k, s] of this.slots) {
      if (s.state === 'loaded' && s.lastUsed < this.frame) candidates.push([k, s.lastUsed, s.tile.bytes]);
      else if (s.state === 'empty' && s.lastUsed < this.frame - 600) candidates.push([k, s.lastUsed, 0]);
    }
    candidates.sort((a, b) => a[1] - b[1]);
    for (const [k, , bytes] of candidates) {
      if (this.bytes <= this.opt.maxBytes * 0.85 && this.slots.size < 50000) break;
      this.slots.delete(k);
      if (bytes > 0) {
        this.bytes -= bytes;
        this.opt.onEvict?.(k);
      }
    }
    // Aliases pointing at evicted tiles are dropped lazily.
    if (this.alias.size > 20000) {
      for (const [from, to] of this.alias) if (!this.slots.has(to)) this.alias.delete(from);
    }
  }
}
