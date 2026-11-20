/**
 * Tiled graph view — streams a graph of any size.
 *
 * What the browser holds is bounded by what is on screen: ~12 tiles per layer,
 * each at most ~1k nodes, plus an LRU of recently seen tiles under a byte
 * budget. Panning and zooming only move a camera; tiles stream in (fetched,
 * decoded and prepared in a worker), fade in over a coarser stand-in, and are
 * evicted when memory is needed. Nothing is laid out in the browser.
 *
 * UX notes:
 *  - Never blank: a missing tile shows its nearest loaded ancestor (clipped to
 *    the gap) or its loaded children until it arrives.
 *  - Idle costs nothing: frames are rendered only when something changed.
 *  - Labels thin out while the camera moves and fill back in when it settles.
 *  - Inertial pan, smoothed wheel zoom, pinch on touch, "fly to" that zooms out
 *    before travelling; all motion respects prefers-reduced-motion.
 *  - Clicking a cluster zooms into it; clicking a node opens it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '../../ui';
import {
  centerOn,
  fitRect,
  fitWorld,
  flyTo,
  levelFor,
  screenToWorld,
  viewCenter,
  visibleTiles,
  zoomAbout,
  type Camera,
  type World,
} from './camera';
import { TileStore, inlineLoader, workerLoader, type LayerSource } from './TileStore';
import { Canvas2DRenderer, GLRenderer, type DrawItem, type TileRenderer } from './GLRenderer';
import { LabelLayer, type LabelCandidate, type LabelPalette } from './labels';
import { prepareTile, visibleEdgePrefix, type RenderTile } from './prepareTile';
import { NodeFlags, decodeTile } from '../../../lib/spatial-tiles/codec';
import { kindName } from '../../../lib/graph-tiles/kinds';
import { ENTITY_META } from '../constants';
import { frameCanvasOptions } from '../../../lib/viewer/gpuTier';

export interface GraphMetaLayer {
  layer: string;
  generation: number;
  world: { x: number; y: number; size: number };
  content?: { x: number; y: number; width: number; height: number };
  maxZ: number;
  nodes: number;
  edges: number;
  dirty: boolean;
}

export interface GraphMetaResponse {
  version: 1;
  layers: GraphMetaLayer[];
  nodes: number;
  tileTemplate: string;
  /** The viewer has direct/group grants: fetch `overlayUrl` for the view. */
  overlay?: boolean;
  overlayUrl?: string;
}

export interface OpenedNode {
  gid: number;
  id: string;
  title: string;
  type: string;
  path: string;
}

export interface TiledGraphViewProps {
  meta: GraphMetaResponse;
  /** Resource to centre on when the view opens. */
  activeNodeId?: string;
  onOpenNode?: (node: OpenedNode) => void;
  /** Called when a layer's generation was replaced; the parent refetches meta. */
  onStaleMeta?: () => void;
  className?: string;
}

interface Hover {
  tileKey: string;
  index: number;
  sx: number;
  sy: number;
}

interface Tooltip {
  x: number;
  y: number;
  title: string;
  detail: string;
}

interface HudState {
  level: number;
  tiles: number;
  nodesDrawn: number;
  inflight: number;
  wireBytes: number;
  renderer: string;
}

const MAX_K = 8;
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function radiusPx(t: RenderTile, i: number, k: number): number {
  const r = t.nodeRadius[i] * k;
  return t.flags[i] & NodeFlags.AGGREGATE ? Math.min(22, Math.max(1.2, r)) : Math.min(14, Math.max(1.6, r));
}

function readPalette(): LabelPalette & { focus: string } {
  const css = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const v = (name: string) => css?.getPropertyValue(name).trim() || 'currentColor';
  return {
    text: v('--text-secondary'),
    hub: v('--text-primary'),
    mine: v('--status-warning'),
    halo: v('--bg-primary'),
    focus: v('--accent-cyan-bright'),
  };
}

const formatBytes = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;

export const TiledGraphView: React.FC<TiledGraphViewProps> = ({
  meta,
  activeNodeId,
  onOpenNode,
  onStaleMeta,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const camRef = useRef<Camera>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef({ width: 1, height: 1, dpr: 1 });
  const storeRef = useRef<TileStore | null>(null);
  const rendererRef = useRef<TileRenderer | null>(null);
  const labelsRef = useRef(new LabelLayer());
  const drawnRef = useRef<DrawItem[]>([]);
  const rafRef = useRef(0);
  const movingUntilRef = useRef(0);
  const hoverRef = useRef<Hover | null>(null);
  const inertiaRef = useRef<{ vx: number; vy: number; last: number } | null>(null);
  const zoomTargetRef = useRef<{ k: number; ax: number; ay: number } | null>(null);
  const flightRef = useRef<{ from: Camera; to: { x: number; y: number; k: number }; start: number; ms: number } | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const nodeInfoCache = useRef(new Map<number, OpenedNode | null>());
  // Resolved once and on theme/accent change — never per frame (it forces a style read).
  const paletteRef = useRef(readPalette());
  // "Shared with me" overlay: one tile for the settled view, replaced as it moves.
  const sharedRef = useRef<{ tile: RenderTile; rect: { x0: number; y0: number; x1: number; y1: number }; k: number } | null>(null);
  const overlayFetchRef = useRef<{ timer: number; ctrl: AbortController | null; seq: number }>({ timer: 0, ctrl: null, seq: 0 });
  const openNodeRef = useRef(onOpenNode);
  openNodeRef.current = onOpenNode;

  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [hud, setHud] = useState<HudState>({ level: 0, tiles: 0, nodesDrawn: 0, inflight: 0, wireBytes: 0, renderer: '' });
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const world: World | null = useMemo(() => {
    const first = meta.layers[0];
    if (!first) return null;
    return { ...first.world, maxZ: Math.max(...meta.layers.map((l) => l.maxZ)) };
  }, [meta]);
  const worldRef = useRef(world);
  worldRef.current = world;

  // Union of the layers' content boxes: what "fit" frames. The world square is
  // padded and rounded up to a power of two, so framing it wastes half the screen.
  const contentRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  contentRef.current = useMemo(() => {
    const boxes = meta.layers.map((l) => l.content).filter((c): c is NonNullable<typeof c> => !!c && c.width > 0);
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.width));
    const y1 = Math.max(...boxes.map((b) => b.y + b.height));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, [meta]);

  const fitCamera = useCallback((): Camera | null => {
    const w = worldRef.current;
    if (!w) return null;
    const c = contentRef.current;
    return c ? fitRect(c, viewRef.current, 32) : fitWorld(w, viewRef.current, 24);
  }, []);

  const layers: LayerSource[] = useMemo(
    () =>
      meta.layers
        .filter((l) => !hiddenLayers.has(l.layer))
        .map((l) => ({ id: `${l.layer}@${l.generation}`, param: l.layer, generation: l.generation })),
    [meta, hiddenLayers]
  );
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const minK = useCallback(() => {
    const w = worldRef.current;
    const v = viewRef.current;
    if (!w) return 1e-6;
    return (Math.min(v.width, v.height) / w.size) * 0.25;
  }, []);

  const schedule = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(() => renderRef.current());
  }, []);

  const markMoving = useCallback(() => {
    movingUntilRef.current = performance.now() + 160;
  }, []);

  // --- the frame ----------------------------------------------------------------
  const renderRef = useRef<() => void>(() => {});
  renderRef.current = () => {
    rafRef.current = 0;
    const store = storeRef.current;
    const renderer = rendererRef.current;
    const w = worldRef.current;
    if (!store || !renderer || !w) return;
    const t0 = performance.now();
    let animating = false;

    // Motion: fly-to, smoothed zoom, inertia.
    const flight = flightRef.current;
    if (flight) {
      const t = Math.min(1, (t0 - flight.start) / flight.ms);
      camRef.current = flyTo(flight.from, flight.to, viewRef.current, t);
      if (t >= 1) flightRef.current = null;
      animating = true;
      markMoving();
    }
    const zt = zoomTargetRef.current;
    if (zt) {
      const cam = camRef.current;
      const next = cam.k + (zt.k - cam.k) * 0.32;
      camRef.current = zoomAbout(cam, next / cam.k, { x: zt.ax, y: zt.ay }, minK(), MAX_K);
      if (Math.abs(zt.k - camRef.current.k) / zt.k < 0.002) zoomTargetRef.current = null;
      animating = true;
      markMoving();
    }
    const inertia = inertiaRef.current;
    if (inertia) {
      const dt = Math.min(48, t0 - inertia.last);
      inertia.last = t0;
      camRef.current = { ...camRef.current, x: camRef.current.x + inertia.vx * dt, y: camRef.current.y + inertia.vy * dt };
      const decay = Math.exp(-dt / 325);
      inertia.vx *= decay;
      inertia.vy *= decay;
      if (Math.hypot(inertia.vx, inertia.vy) < 0.015) inertiaRef.current = null;
      animating = true;
      markMoving();
    }

    const cam = camRef.current;
    const view = viewRef.current;
    const z = levelFor(cam.k, w);
    const moving = t0 < movingUntilRef.current;
    const tileSize = w.size / 2 ** z;
    const center = viewCenter(cam, view);

    store.beginFrame();
    const items = new Map<string, DrawItem>();
    for (const layer of layersRef.current) {
      const mine = layer.param === 'me';
      const r = visibleTiles(cam, view, w, z);
      for (let ty = r.y0; ty <= r.y1; ty++) {
        for (let tx = r.x0; tx <= r.x1; tx++) {
          const cx = w.x + (tx + 0.5) * tileSize;
          const cy = w.y + (ty + 0.5) * tileSize;
          const priority = Math.hypot(cx - center.x, cy - center.y) / tileSize - (mine ? 0.25 : 0);
          const drawables = store.want(layer, z, tx, ty, priority);
          for (const d of drawables) {
            if (d.exact) {
              items.set(d.tile.key, { tile: d.tile, fade: d.fade, privateLayer: mine });
            } else {
              const sx = (w.x + tx * tileSize) * cam.k + cam.x;
              const sy = (w.y + ty * tileSize) * cam.k + cam.y;
              items.set(`${d.tile.key}#${z}/${tx}/${ty}`, {
                tile: d.tile,
                fade: d.fade,
                privateLayer: mine,
                clip: { x: sx, y: sy, width: tileSize * cam.k, height: tileSize * cam.k },
              });
            }
          }
        }
      }
      // Prefetch while idle: one ring around the view, and the parent level so
      // zooming out is instant.
      if (!moving) {
        const ring = visibleTiles(cam, view, w, z, 1);
        for (let ty = ring.y0; ty <= ring.y1; ty++) {
          for (let tx = ring.x0; tx <= ring.x1; tx++) {
            if (tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1) continue;
            store.prefetch(layer, z, tx, ty, 20 + Math.abs(tx - (r.x0 + r.x1) / 2) + Math.abs(ty - (r.y0 + r.y1) / 2));
          }
        }
        if (z > 0) {
          const up = visibleTiles(cam, view, w, z - 1);
          for (let ty = up.y0; ty <= up.y1; ty++) for (let tx = up.x0; tx <= up.x1; tx++) store.prefetch(layer, z - 1, tx, ty, 10);
        }
      }
    }
    store.endFrame();

    // The shared-with-me overlay, drawn like the viewer's own private layer.
    if (sharedRef.current && !hiddenLayersRef.current.has('shared')) {
      items.set(sharedRef.current.tile.key, { tile: sharedRef.current.tile, fade: 1, privateLayer: true });
    }
    scheduleOverlay(moving);

    // Coarse first so finer tiles paint over their stand-ins; private layer on top.
    const drawList = [...items.values()].sort(
      (a, b) => Number(!!b.clip) - Number(!!a.clip) || a.tile.z - b.tile.z || Number(a.privateLayer) - Number(b.privateLayer)
    );
    let edgeTotal = 0;
    for (const it of drawList) edgeTotal += visibleEdgePrefix(it.tile, z);
    const edgeAlpha = Math.min(1, Math.max(0.2, 5000 / Math.max(1, edgeTotal)));
    const drawn = renderer.draw({ cam, viewZ: z, items: drawList, edgeAlpha });
    drawnRef.current = drawList;
    drawOverlay(drawList, z, moving);
    for (const it of drawList) if (it.fade < 1) animating = true;

    const ft = frameTimesRef.current;
    ft.push(performance.now() - t0);
    if (ft.length > 240) ft.shift();

    if (animating) schedule();
    else if (moving) setTimeout(schedule, movingUntilRef.current - t0 + 5);
    hudTick(z, drawList.length, drawn.nodes);
  };

  const hiddenLayersRef = useRef(hiddenLayers);
  hiddenLayersRef.current = hiddenLayers;

  /**
   * Fetch the overlay for the settled view — never mid-gesture — unless the
   * view is still inside the area (and near the zoom) of the last fetch.
   */
  const scheduleOverlay = (moving: boolean) => {
    if (!meta.overlay || !meta.overlayUrl) return;
    const f = overlayFetchRef.current;
    if (moving) return;
    const cam = camRef.current;
    const view = viewRef.current;
    const x0 = -cam.x / cam.k;
    const y0 = -cam.y / cam.k;
    const x1 = (view.width - cam.x) / cam.k;
    const y1 = (view.height - cam.y) / cam.k;
    const last = sharedRef.current;
    if (
      last &&
      x0 >= last.rect.x0 && y0 >= last.rect.y0 && x1 <= last.rect.x1 && y1 <= last.rect.y1 &&
      cam.k < last.k * 1.8 && cam.k > last.k / 1.8
    ) {
      return;
    }
    if (f.timer) return;
    f.timer = window.setTimeout(() => {
      f.timer = 0;
      f.ctrl?.abort();
      const ctrl = new AbortController();
      f.ctrl = ctrl;
      const padX = (x1 - x0) * 0.25;
      const padY = (y1 - y0) * 0.25;
      const rect = { x0: x0 - padX, y0: y0 - padY, x1: x1 + padX, y1: y1 + padY };
      const k = cam.k;
      const q = new URLSearchParams({
        x0: String(rect.x0), y0: String(rect.y0), x1: String(rect.x1), y1: String(rect.y1), limit: '1500',
      });
      fetch(`${meta.overlayUrl}?${q}`, { credentials: 'same-origin', signal: ctrl.signal })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => {
          if (!buf || ctrl.signal.aborted) return;
          const seq = ++f.seq;
          const tile = prepareTile(decodeTile(buf), `shared#${seq}`);
          const previous = sharedRef.current;
          sharedRef.current = { tile, rect, k };
          if (previous) rendererRef.current?.release(previous.tile.key);
          schedule();
        })
        .catch(() => {});
    }, 300);
  };

  // HUD updates are throttled: React state per frame would cost more than the frame.
  const hudLastRef = useRef(0);
  const hudTrailingRef = useRef(0);
  const hudLatestRef = useRef({ level: 0, tiles: 0, nodesDrawn: 0 });
  const hudTick = (level: number, tiles: number, nodesDrawn: number) => {
    hudLatestRef.current = { level, tiles, nodesDrawn };
    const now = performance.now();
    if (now - hudLastRef.current < 250) {
      // Throttled — but make sure the final state is shown once things settle,
      // since an idle view renders no further frames to update it.
      if (!hudTrailingRef.current) {
        hudTrailingRef.current = window.setTimeout(() => {
          hudTrailingRef.current = 0;
          const latest = hudLatestRef.current;
          hudTick(latest.level, latest.tiles, latest.nodesDrawn);
        }, 260);
      }
      return;
    }
    hudLastRef.current = now;
    const s = storeRef.current?.getStats();
    setHud({
      level,
      tiles,
      nodesDrawn,
      inflight: (s?.inflight ?? 0) + (s?.queued ?? 0),
      wireBytes: s?.wireBytes ?? 0,
      renderer: rendererRef.current?.kind ?? '',
    });
  };

  const drawOverlay = (drawList: DrawItem[], z: number, moving: boolean) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    // Match the graph renderer: on a software (CPU) renderer, keep the overlay
    // CPU-backed too, so labels are not rasterised in the GPU process and read
    // back every frame. The option only takes effect on the first call.
    const ctx = canvas.getContext('2d', frameCanvasOptions());
    if (!ctx) return;
    const { width, height, dpr } = viewRef.current;
    const cam = camRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const candidates: LabelCandidate[] = [];
    const seen = new Set<number>();
    for (const it of drawList) {
      const t = it.tile;
      const cap = Math.min(t.labelIndex.length, 400);
      for (let li = 0; li < cap; li++) {
        const i = t.labelIndex[li];
        const gid = t.gid[i];
        if (seen.has(gid)) continue;
        const sx = t.absX[i] * cam.k + cam.x;
        const sy = t.absY[i] * cam.k + cam.y;
        if (sx < -200 || sy < -20 || sx > width + 10 || sy > height + 20) continue;
        if (it.clip && (sx < it.clip.x || sy < it.clip.y || sx > it.clip.x + it.clip.width || sy > it.clip.y + it.clip.height)) continue;
        seen.add(gid);
        const hub = (t.flags[i] & NodeFlags.HUB) !== 0;
        candidates.push({
          sx,
          sy,
          r: radiusPx(t, i, cam.k),
          text: t.labelText[li],
          priority: (hub ? 1e9 : 0) + t.weight[i],
          hub,
          mine: it.privateLayer,
        });
      }
    }
    labelsRef.current.draw(ctx, candidates, { width, height }, moving ? 40 : 160, paletteRef.current, moving ? 0.75 : 1);

    // Hover focus: ring the node and brighten its edges within the tile.
    const hover = hoverRef.current;
    if (hover) {
      const it = drawList.find((d) => d.tile.key === hover.tileKey);
      if (it) {
        const t = it.tile;
        ctx.strokeStyle = paletteRef.current.focus;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.5;
        const ox = t.worldX * cam.k + cam.x;
        const oy = t.worldY * cam.k + cam.y;
        const count = visibleEdgePrefix(t, z);
        ctx.beginPath();
        for (let e = 0; e < count; e++) {
          if (t.edgeA[e] !== hover.index && t.edgeB[e] !== hover.index) continue;
          ctx.moveTo(t.edgePos[e * 4] * cam.k + ox, t.edgePos[e * 4 + 1] * cam.k + oy);
          ctx.lineTo(t.edgePos[e * 4 + 2] * cam.k + ox, t.edgePos[e * 4 + 3] * cam.k + oy);
        }
        ctx.stroke();
        const sx = t.absX[hover.index] * cam.k + cam.x;
        const sy = t.absY[hover.index] * cam.k + cam.y;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, radiusPx(t, hover.index, cam.k) + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  };

  // --- picking ---------------------------------------------------------------------
  const pick = useCallback((sx: number, sy: number): Hover | null => {
    const cam = camRef.current;
    let best: Hover | null = null;
    let bestD = Infinity;
    for (const it of drawnRef.current) {
      const t = it.tile;
      const n = t.gid.length;
      for (let i = 0; i < n; i++) {
        const px = t.absX[i] * cam.k + cam.x;
        const py = t.absY[i] * cam.k + cam.y;
        const dx = px - sx;
        const dy = py - sy;
        const d2 = dx * dx + dy * dy;
        const r = radiusPx(t, i, cam.k) + 4;
        if (d2 < r * r && d2 < bestD) {
          if (it.clip && (px < it.clip.x || py < it.clip.y || px > it.clip.x + it.clip.width || py > it.clip.y + it.clip.height)) continue;
          bestD = d2;
          best = { tileKey: t.key, index: i, sx: px, sy: py };
        }
      }
    }
    return best;
  }, []);

  const tileFor = (key: string) => drawnRef.current.find((d) => d.tile.key === key)?.tile;

  const labelOf = (t: RenderTile, i: number): string | null => {
    for (let li = 0; li < t.labelIndex.length; li++) if (t.labelIndex[li] === i) return t.labelText[li];
    return null;
  };

  const resolveGid = useCallback(async (gid: number): Promise<OpenedNode | null> => {
    const cache = nodeInfoCache.current;
    if (cache.has(gid)) return cache.get(gid)!;
    try {
      const res = await fetch(`/api/v1/graph/node/${gid}`, { credentials: 'same-origin' });
      const info = res.ok ? ((await res.json()) as OpenedNode) : null;
      if (cache.size > 2000) cache.clear();
      cache.set(gid, info);
      return info;
    } catch {
      return null;
    }
  }, []);

  const showTooltipFor = useCallback(
    (h: Hover | null) => {
      if (!h) {
        setTooltip(null);
        return;
      }
      const t = tileFor(h.tileKey);
      if (!t) return;
      const i = h.index;
      const agg = (t.flags[i] & NodeFlags.AGGREGATE) !== 0;
      const kind = ENTITY_META[kindName(t.kind[i])]?.label ?? 'Resource';
      const label = labelOf(t, i);
      const detail = agg
        ? `${t.weight[i].toLocaleString()} items here — click to zoom in`
        : `${kind} · ${t.weight[i]} connection${t.weight[i] === 1 ? '' : 's'}`;
      setTooltip({ x: h.sx, y: h.sy, title: label ?? (agg ? 'Cluster' : 'Loading…'), detail });
      if (!label && !agg) {
        const gid = t.gid[i];
        void resolveGid(gid).then((info) => {
          if (hoverRef.current?.tileKey === h.tileKey && hoverRef.current.index === i) {
            setTooltip({ x: h.sx, y: h.sy, title: info?.title ?? 'Untitled', detail });
          }
        });
      }
    },
    [resolveGid]
  );

  // --- camera helpers ------------------------------------------------------------
  const fit = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    flightRef.current = null;
    inertiaRef.current = null;
    zoomTargetRef.current = null;
    const target = fitCamera() ?? fitWorld(w, viewRef.current, 24);
    if (reducedMotion()) camRef.current = target;
    else {
      const c = viewCenter(target, viewRef.current);
      flightRef.current = { from: camRef.current, to: { x: c.x, y: c.y, k: target.k }, start: performance.now(), ms: 450 };
    }
    schedule();
  }, [fitCamera, schedule]);

  const flyToPoint = useCallback(
    (x: number, y: number, k: number) => {
      inertiaRef.current = null;
      zoomTargetRef.current = null;
      const target = Math.min(MAX_K, Math.max(minK(), k));
      if (reducedMotion()) {
        camRef.current = centerOn({ x, y }, target, viewRef.current);
        flightRef.current = null;
      } else {
        const from = camRef.current;
        const dist = Math.hypot(viewCenter(from, viewRef.current).x - x, viewCenter(from, viewRef.current).y - y) * from.k;
        const ms = Math.min(1400, 450 + Math.log2(1 + dist / 200) * 180);
        flightRef.current = { from, to: { x, y, k: target }, start: performance.now(), ms };
      }
      schedule();
    },
    [minK, schedule]
  );

  const zoomStep = useCallback(
    (factor: number) => {
      const v = viewRef.current;
      const base = zoomTargetRef.current?.k ?? camRef.current.k;
      zoomTargetRef.current = { k: Math.min(MAX_K, Math.max(minK(), base * factor)), ax: v.width / 2, ay: v.height / 2 };
      if (reducedMotion()) {
        camRef.current = zoomAbout(camRef.current, zoomTargetRef.current.k / camRef.current.k, { x: v.width / 2, y: v.height / 2 }, minK(), MAX_K);
        zoomTargetRef.current = null;
      }
      schedule();
    },
    [minK, schedule]
  );

  // --- lifecycle: renderer + store ---------------------------------------------
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    const gl = GLRenderer.create(canvas);
    let renderer: TileRenderer;
    if (gl) renderer = gl;
    else {
      const cpu = new Canvas2DRenderer(canvas);
      cpu.onSettle = () => schedule();
      renderer = cpu;
    }
    rendererRef.current = renderer;
    const loader = workerLoader() ?? inlineLoader();
    const store = new TileStore({
      template: meta.tileTemplate,
      loader,
      onChange: () => schedule(),
      onEvict: (key) => renderer.release(key),
      onGenerationGone: () => onStaleMeta?.(),
    });
    storeRef.current = store;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      clearTimeout(overlayFetchRef.current.timer);
      overlayFetchRef.current.ctrl?.abort();
      store.destroy();
      renderer.destroy();
      storeRef.current = null;
      rendererRef.current = null;
    };
    // The tile template is fixed for the lifetime of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme or accent switched: re-resolve label colours from tokens.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      paletteRef.current = readPalette();
      schedule();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
    return () => observer.disconnect();
  }, [schedule]);

  // Layers replaced (new generation) or toggled: drop what is gone, redraw.
  const prevLayerIds = useRef<string[]>([]);
  useEffect(() => {
    const ids = layers.map((l) => l.id);
    for (const old of prevLayerIds.current) if (!ids.includes(old)) storeRef.current?.dropLayer(old);
    prevLayerIds.current = ids;
    schedule();
  }, [layers, schedule]);

  // --- sizing ----------------------------------------------------------------------
  const initialisedRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const prev = viewRef.current;
      viewRef.current = { width, height, dpr };
      rendererRef.current?.resize(width, height, dpr);
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.width = Math.round(width * dpr);
        overlay.height = Math.round(height * dpr);
      }
      if (!initialisedRef.current && worldRef.current) {
        initialisedRef.current = true;
        camRef.current = fitCamera() ?? fitWorld(worldRef.current, viewRef.current, 24);
      } else if (prev.width > 1) {
        // Keep the same world point centred across a resize.
        const c = viewCenter(camRef.current, prev);
        camRef.current = centerOn(c, camRef.current.k, viewRef.current);
      }
      schedule();
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, [fitCamera, schedule]);

  // Centre on the active resource once, if it is in the graph.
  useEffect(() => {
    if (!activeNodeId) return;
    let cancelled = false;
    fetch(`/api/v1/graph/locate?id=${encodeURIComponent(activeNodeId)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((node: OpenedNode & { x: number; y: number } | null) => {
        if (!cancelled && node) flyToPoint(node.x, node.y, 1.4);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeNodeId, flyToPoint]);

  // --- input -----------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; y: number; moved: boolean } | null = null;
    let velocity = { vx: 0, vy: 0, t: 0 };
    let pinch: { dist: number; mx: number; my: number } | null = null;
    let hoverFrame = 0;
    let lastPointer: { x: number; y: number } | null = null;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewRef.current.height : 1;
      const dy = e.deltaY * unit;
      flightRef.current = null;
      inertiaRef.current = null;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel with small deltas: apply directly.
        camRef.current = zoomAbout(camRef.current, Math.exp(-dy * 0.01), p, minK(), MAX_K);
        zoomTargetRef.current = null;
      } else if (Math.abs(dy) >= 40 && !reducedMotion()) {
        // Notched mouse wheel: animate toward an accumulated target.
        const base = zoomTargetRef.current?.k ?? camRef.current.k;
        zoomTargetRef.current = {
          k: Math.min(MAX_K, Math.max(minK(), base * Math.exp(-dy * 0.0022))),
          ax: p.x,
          ay: p.y,
        };
      } else {
        camRef.current = zoomAbout(camRef.current, Math.exp(-dy * 0.0022), p, minK(), MAX_K);
        zoomTargetRef.current = null;
      }
      markMoving();
      schedule();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      el.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      flightRef.current = null;
      inertiaRef.current = null;
      zoomTargetRef.current = null;
      if (pointers.size === 1) {
        dragStart = { x: p.x, y: p.y, moved: false };
        velocity = { vx: 0, vy: 0, t: performance.now() };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        dragStart = null;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e);
      lastPointer = p;
      const prev = pointers.get(e.pointerId);
      if (prev) {
        pointers.set(e.pointerId, p);
        if (pointers.size === 2 && pinch) {
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          let cam = zoomAbout(camRef.current, dist / Math.max(1, pinch.dist), { x: mx, y: my }, minK(), MAX_K);
          cam = { ...cam, x: cam.x + mx - pinch.mx, y: cam.y + my - pinch.my };
          camRef.current = cam;
          pinch = { dist, mx, my };
          markMoving();
          schedule();
          return;
        }
        if (dragStart) {
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          if (!dragStart.moved && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 4) dragStart.moved = true;
          if (dragStart.moved) {
            camRef.current = { ...camRef.current, x: camRef.current.x + dx, y: camRef.current.y + dy };
            const now = performance.now();
            const dt = Math.max(1, now - velocity.t);
            // Exponentially weighted velocity so a flick, not a drift, sets inertia.
            velocity = { vx: velocity.vx * 0.6 + (dx / dt) * 0.4, vy: velocity.vy * 0.6 + (dy / dt) * 0.4, t: now };
            hoverRef.current = null;
            setTooltip(null);
            el.style.cursor = 'grabbing';
            markMoving();
            schedule();
          }
          return;
        }
      }
      // Hover picking, at most once per frame.
      if (!hoverFrame) {
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          if (!lastPointer || pointers.size) return;
          const h = pick(lastPointer.x, lastPointer.y);
          const prevHover = hoverRef.current;
          if (h?.tileKey !== prevHover?.tileKey || h?.index !== prevHover?.index) {
            hoverRef.current = h;
            el.style.cursor = h ? 'pointer' : 'grab';
            showTooltipFor(h);
            schedule();
          }
        });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const p = local(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      el.style.cursor = hoverRef.current ? 'pointer' : 'grab';
      if (dragStart && !dragStart.moved) {
        // A click: open a node, or zoom into a cluster.
        const h = pick(p.x, p.y);
        if (h) {
          const t = tileFor(h.tileKey);
          if (t) {
            const i = h.index;
            if (t.flags[i] & NodeFlags.AGGREGATE) {
              flyToPoint(t.absX[i], t.absY[i], camRef.current.k * 3);
            } else {
              void resolveGid(t.gid[i]).then((info) => {
                if (!info) return;
                if (openNodeRef.current) openNodeRef.current(info);
                else window.location.href = info.path;
              });
            }
          }
        }
      } else if (dragStart?.moved && !reducedMotion()) {
        const speed = Math.hypot(velocity.vx, velocity.vy);
        if (speed > 0.25 && performance.now() - velocity.t < 80) {
          inertiaRef.current = { vx: velocity.vx, vy: velocity.vy, last: performance.now() };
          schedule();
        }
      }
      dragStart = null;
    };

    const onDblClick = (e: MouseEvent) => {
      const p = local(e);
      const wpt = screenToWorld(camRef.current, p.x, p.y);
      flyToPoint(wpt.x, wpt.y, camRef.current.k * 2);
    };

    const onLeave = () => {
      lastPointer = null;
      if (hoverRef.current) {
        hoverRef.current = null;
        setTooltip(null);
        schedule();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const step = 90;
      const pan = (dx: number, dy: number) => {
        inertiaRef.current = null;
        camRef.current = { ...camRef.current, x: camRef.current.x + dx, y: camRef.current.y + dy };
        markMoving();
        schedule();
      };
      if (e.key === '+' || e.key === '=') zoomStep(1.5);
      else if (e.key === '-' || e.key === '_') zoomStep(1 / 1.5);
      else if (e.key === '0') fit();
      else if (e.key === 'ArrowLeft') pan(step, 0);
      else if (e.key === 'ArrowRight') pan(-step, 0);
      else if (e.key === 'ArrowUp') pan(0, step);
      else if (e.key === 'ArrowDown') pan(0, -step);
      else return;
      e.preventDefault();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('keydown', onKey);
    return () => {
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('keydown', onKey);
    };
  }, [fit, flyToPoint, markMoving, minK, pick, resolveGid, schedule, showTooltipFor, zoomStep]);

  // Benchmark / debugging handle. Read-only except for camera control.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handle = {
      stats: () => ({
        ...storeRef.current?.getStats(),
        frameMs: [...frameTimesRef.current],
        gpuBytes: rendererRef.current instanceof GLRenderer ? rendererRef.current.gpuBytes() : 0,
        renderer: rendererRef.current?.kind,
        camera: { ...camRef.current },
        tilesDrawn: drawnRef.current.length,
      }),
      setCamera: (c: Camera) => {
        camRef.current = { ...c };
        markMoving();
        schedule();
      },
      panBy: (dx: number, dy: number) => {
        camRef.current = { ...camRef.current, x: camRef.current.x + dx, y: camRef.current.y + dy };
        markMoving();
        schedule();
      },
      zoomBy: (f: number) => {
        const v = viewRef.current;
        camRef.current = zoomAbout(camRef.current, f, { x: v.width / 2, y: v.height / 2 }, minK(), MAX_K);
        markMoving();
        schedule();
      },
      flyTo: flyToPoint,
      fit,
    };
    (window as unknown as { __tiledGraph?: typeof handle }).__tiledGraph = handle;
    return () => {
      delete (window as unknown as { __tiledGraph?: typeof handle }).__tiledGraph;
    };
  }, [fit, flyToPoint, markMoving, minK, schedule]);

  // --- search ("fly to") ------------------------------------------------------
  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
      const data = res.ok ? await res.json() : { results: [] };
      for (const hit of (data.results ?? []).slice(0, 5)) {
        const loc = await fetch(`/api/v1/graph/locate?id=${encodeURIComponent(hit.id)}`, { credentials: 'same-origin' });
        if (!loc.ok) continue;
        const node = (await loc.json()) as { x: number; y: number };
        flyToPoint(node.x, node.y, 1.6);
        return;
      }
      setSearchError('No match in this graph');
    } catch {
      setSearchError('Search is unavailable');
    } finally {
      setSearching(false);
    }
  };

  const toggleLayer = (layer: string) =>
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });

  if (!world) {
    return <div className="tiled-graph tiled-graph--empty">The graph has not been built yet.</div>;
  }

  return (
    <div className={['tiled-graph', className ?? ''].filter(Boolean).join(' ')}>
      <div
        ref={containerRef}
        className="tiled-graph__stage"
        tabIndex={0}
        role="application"
        aria-roledescription="zoomable graph"
        aria-label={`Knowledge graph with ${meta.nodes.toLocaleString()} nodes. Drag to pan, scroll to zoom, arrow keys to move, plus and minus to zoom, 0 to fit.`}
      >
        <canvas ref={glCanvasRef} className="tiled-graph__canvas" aria-hidden="true" />
        <canvas ref={overlayRef} className="tiled-graph__overlay" aria-hidden="true" />
        {tooltip && (
          <div className="tiled-graph__tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="status">
            <strong>{tooltip.title}</strong>
            <span>{tooltip.detail}</span>
          </div>
        )}
      </div>

      <form className="tiled-graph__search" onSubmit={onSearch} role="search">
        <input
          className="ui-input"
          type="search"
          placeholder="Fly to…"
          aria-label="Find a node and fly to it"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchError(null);
          }}
        />
        {searchError && <span className="tiled-graph__search-error" role="alert">{searchError}</span>}
        {searching && <span className="tiled-graph__spinner" aria-label="Searching" />}
      </form>

      <div className="tiled-graph__controls">
        <IconButton label="Zoom in" onClick={() => zoomStep(1.5)}>+</IconButton>
        <IconButton label="Zoom out" onClick={() => zoomStep(1 / 1.5)}>−</IconButton>
        <IconButton label="Fit whole graph" onClick={fit}>⤢</IconButton>
      </div>

      <div className="tiled-graph__hud" aria-live="off">
        <span>{meta.nodes.toLocaleString()} nodes</span>
        <span>level {hud.level}</span>
        <span>{hud.tiles} tiles · {hud.nodesDrawn.toLocaleString()} drawn</span>
        <span>{formatBytes(hud.wireBytes)} streamed</span>
        {hud.inflight > 0 && <span className="tiled-graph__streaming">streaming {hud.inflight}</span>}
        {meta.overlay && (
          <label className="tiled-graph__layer">
            <input type="checkbox" checked={!hiddenLayers.has('shared')} onChange={() => toggleLayer('shared')} />
            Shared with me
          </label>
        )}
        {meta.layers.length > 1 &&
          meta.layers.map((l) => (
            <label key={l.layer} className="tiled-graph__layer">
              <input type="checkbox" checked={!hiddenLayers.has(l.layer)} onChange={() => toggleLayer(l.layer)} />
              {l.layer === 'me' ? 'Mine (private)' : l.layer === 'workspace' ? 'Workspace' : 'Public'}
            </label>
          ))}
      </div>
    </div>
  );
};
