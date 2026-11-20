/**
 * Shared 2D camera — one algebra for the canvas and the graph.
 *
 *   screen = world * k + (x, y)
 *   world  = (screen - (x, y)) / k
 *
 * The canvas (`components/canvas/core/transform.ts`, which adds its zoom
 * limits and rect helpers) and the streamed graph
 * (`components/graph/tiled/camera.ts`, which adds tile maths) both build on
 * this. Everything is pure and allocation-light: it runs in pointer, wheel and
 * animation hot paths.
 */

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface CameraPoint {
  x: number;
  y: number;
}

export interface CameraSize {
  width: number;
  height: number;
}

export interface CameraRect extends CameraPoint, CameraSize {}

export function clampK(k: number, min = 0, max = Infinity): number {
  return k < min ? min : k > max ? max : k;
}

export function worldToScreen(cam: Camera, p: CameraPoint): CameraPoint {
  return { x: p.x * cam.k + cam.x, y: p.y * cam.k + cam.y };
}

export function screenToWorld(cam: Camera, p: CameraPoint): CameraPoint {
  return { x: (p.x - cam.x) / cam.k, y: (p.y - cam.y) / cam.k };
}

/**
 * Zoom to `nextK` keeping the world point under `anchor` (screen px) fixed —
 * cursor-anchored zoom. Returns `cam` itself when the clamped zoom is unchanged.
 */
export function zoomAt(cam: Camera, anchor: CameraPoint, nextK: number, min = 0, max = Infinity): Camera {
  const k = clampK(nextK, min, max);
  if (k === cam.k) return cam;
  const f = k / cam.k;
  return { k, x: anchor.x - (anchor.x - cam.x) * f, y: anchor.y - (anchor.y - cam.y) * f };
}

/** Centre a world point in the view at zoom `k`. */
export function centerAt(point: CameraPoint, k: number, view: CameraSize): Camera {
  return { k, x: view.width / 2 - point.x * k, y: view.height / 2 - point.y * k };
}

/** World point at the centre of the view. */
export function viewCenter(cam: Camera, view: CameraSize): CameraPoint {
  return screenToWorld(cam, { x: view.width / 2, y: view.height / 2 });
}

/** World rectangle visible in a `view`-sized viewport. */
export function visibleWorldRect(cam: Camera, view: CameraSize): CameraRect {
  return { x: -cam.x / cam.k, y: -cam.y / cam.k, width: view.width / cam.k, height: view.height / cam.k };
}

export interface FitOptions {
  padding?: number;
  min?: number;
  max?: number;
  /** Cap on the zoom, e.g. 1 so "fit" never magnifies a tiny board. */
  maxUpscale?: number;
}

/** Camera that frames `rect` inside `view`, centred, with padding. */
export function fitRect(rect: CameraRect, view: CameraSize, options: FitOptions = {}): Camera {
  const { padding = 24, min = 0, max = Infinity, maxUpscale = Infinity } = options;
  const w = Math.max(rect.width, 1e-6);
  const h = Math.max(rect.height, 1e-6);
  const innerW = Math.max(view.width - padding * 2, 1);
  const innerH = Math.max(view.height - padding * 2, 1);
  const k = clampK(Math.min(innerW / w, innerH / h, maxUpscale), min, max);
  return { k, x: (view.width - w * k) / 2 - rect.x * k, y: (view.height - h * k) / 2 - rect.y * k };
}

/**
 * Smooth "fly to": zoom out, travel, zoom in, as one continuous motion (the
 * van Wijk & Nuij idea in its simplest form). Returns the camera at `t` in
 * [0, 1]. Travelling far at constant zoom sweeps everything in between past
 * the viewer (and, in the streamed graph, loads it); rising first keeps the
 * motion readable and cheap.
 */
export function flyTo(from: Camera, to: Camera | { x: number; y: number; k: number }, view: CameraSize, t: number): Camera {
  const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const a = viewCenter(from, view);
  const cx = a.x + (to.x - a.x) * ease;
  const cy = a.y + (to.y - a.y) * ease;
  const dist = Math.hypot(to.x - a.x, to.y - a.y);
  const span = Math.max(view.width, view.height);
  const peakK = Math.min(from.k, to.k, span / Math.max(dist * 1.4, 1e-6));
  const lowK = Math.min(from.k, peakK);
  const logK =
    t < 0.5
      ? Math.log(from.k) + (Math.log(lowK) - Math.log(from.k)) * (t * 2)
      : Math.log(lowK) + (Math.log(to.k) - Math.log(lowK)) * ((t - 0.5) * 2);
  return centerAt({ x: cx, y: cy }, Math.exp(logK), view);
}

/**
 * `flyTo` takes a *world* target centre; this converts a target camera (e.g.
 * the result of `fitRect`) into that form.
 */
export function flightTarget(target: Camera, view: CameraSize): { x: number; y: number; k: number } {
  const c = viewCenter(target, view);
  return { x: c.x, y: c.y, k: target.k };
}

/** Duration for a flight, longer for longer trips, within [min, max] ms. */
export function flightMs(from: Camera, target: Camera, view: CameraSize, min = 320, max = 900): number {
  const a = viewCenter(from, view);
  const b = viewCenter(target, view);
  const screens = Math.hypot(b.x - a.x, b.y - a.y) * Math.min(from.k, target.k) / Math.max(view.width, view.height, 1);
  const zoomSteps = Math.abs(Math.log2(target.k / from.k));
  return Math.round(Math.min(max, Math.max(min, 260 + 120 * Math.log2(1 + screens) + 90 * zoomSteps)));
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
