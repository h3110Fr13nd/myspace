/**
 * Canvas core — impostor rendering for screen-space layers during motion.
 *
 * A layer that paints everything in view (all edges, all far-zoom node
 * proxies) costs O(items in view) per frame, and far out that is the whole
 * board. During a pan or zoom the picture only moves, so this keeps a snapshot
 * of the last full paint — with overscan, so a pan does not reveal blank
 * edges — and while the camera is moving draws just that snapshot, scaled and
 * offset: one `drawImage` per frame regardless of board size. A full-quality
 * repaint happens once the camera has been still for `settleMs`, or as soon as
 * the layer's content (not the camera) changes.
 *
 * Trade-off: during a zoom gesture the snapshot is briefly resampled (slightly
 * soft) until it settles; Figma, Miro and map engines do the same.
 */
import type { ViewportTransform } from './transform';

export interface FullPaint {
  /**
   * Paint the complete layer into `ctx`, whose backing store is `width x height`
   * CSS px at `dpr`, for camera `t` (already offset for the overscan margin).
   * The callee sets its own transform and clears.
   */
  (ctx: CanvasRenderingContext2D, t: ViewportTransform, width: number, height: number): void;
}

export class MotionRaster {
  private snap: HTMLCanvasElement | null = null;
  private snapCtx: CanvasRenderingContext2D | null = null;
  private snapT: ViewportTransform | null = null;
  private snapW = 0;
  private snapH = 0;
  private lastT: ViewportTransform | null = null;
  private lastChange = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      /** Overscan on each side, as a fraction of the viewport. */
      margin?: number;
      settleMs?: number;
      /** Below this many items the layer is cheap enough to always paint fully. */
      minItems?: number;
      contextOptions?: CanvasRenderingContext2DSettings;
    } = {}
  ) {}

  /** Content (not camera) changed: the next frame must be a full paint. */
  invalidate(): void {
    this.snapT = null;
  }

  dispose(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.snap = null;
    this.snapCtx = null;
    this.lastFull = null;
  }

  /**
   * Paint one frame into `target`. `itemCount` is how much a full paint would
   * draw; small layers always paint fully. `onSettle` is called once the camera
   * stops, so the host can schedule the full-quality repaint.
   *
   * Frame kinds:
   *  - camera moving, fresh snapshot: blit the snapshot (O(1));
   *  - camera moving, no snapshot: full paint into the snapshot, then blit
   *    (once, at the start of a gesture);
   *  - otherwise (still camera, or content changing under it — a marquee, a
   *    draft connection): full paint straight into the target, and refresh the
   *    snapshot when the browser is idle so the next gesture starts cheap.
   */
  frame(
    target: CanvasRenderingContext2D,
    t: ViewportTransform,
    width: number,
    height: number,
    dpr: number,
    itemCount: number,
    full: FullPaint,
    onSettle: () => void
  ): 'full' | 'impostor' | 'snapshot' {
    const now = performance.now();
    const moved = !this.lastT || this.lastT.x !== t.x || this.lastT.y !== t.y || this.lastT.k !== t.k;
    if (moved) this.lastChange = now;
    this.lastT = t;
    const settleMs = this.options.settleMs ?? 140;
    const moving = now - this.lastChange < settleMs;
    const big = itemCount >= (this.options.minItems ?? 1500);
    this.lastFull = full;
    this.lastDpr = dpr;

    if (!big) {
      this.snapT = null;
      full(target, t, width, height);
      return 'full';
    }

    if (moving) {
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        onSettle();
      }, settleMs + 10);
      let snap = this.snapT;
      const scale = snap ? t.k / snap.k : 1;
      if (!snap || scale <= 0.6 || scale >= 1.7 || this.snapW !== width || this.snapH !== height) {
        if (!this.paintSnapshot(t, width, height, dpr, full)) {
          full(target, t, width, height);
          return 'full';
        }
        snap = this.snapT!;
      }
      this.blit(target, t, width, height, dpr);
      return snap === t ? 'snapshot' : 'impostor';
    }

    // Still: paint at full quality, directly. The snapshot is stale from here
    // on; rebuild it off the critical path.
    this.snapT = null;
    full(target, t, width, height);
    this.scheduleIdleSnapshot(width, height);
    return 'full';
  }

  private lastFull: FullPaint | null = null;
  private lastDpr = 1;
  private idleHandle: number | null = null;

  private scheduleIdleSnapshot(width: number, height: number) {
    if (this.idleHandle !== null || typeof window === 'undefined') return;
    const ric =
      (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    this.idleHandle = ric(() => {
      this.idleHandle = null;
      // Only if nothing newer happened: a moving camera paints its own.
      if (this.snapT || !this.lastT || !this.lastFull) return;
      this.paintSnapshot(this.lastT, width, height, this.lastDpr, this.lastFull);
    }, { timeout: 1000 });
  }

  private paintSnapshot(t: ViewportTransform, width: number, height: number, dpr: number, full: FullPaint): boolean {
    const m = this.options.margin ?? 0.25;
    const sw = Math.round(width * (1 + 2 * m));
    const sh = Math.round(height * (1 + 2 * m));
    if (!this.snap) this.snap = document.createElement('canvas');
    if (this.snap.width !== Math.round(sw * dpr) || this.snap.height !== Math.round(sh * dpr)) {
      this.snap.width = Math.round(sw * dpr);
      this.snap.height = Math.round(sh * dpr);
      this.snapCtx = null;
    }
    this.snapCtx ??= this.snap.getContext('2d', this.options.contextOptions);
    if (!this.snapCtx) return false;
    full(this.snapCtx, { x: t.x + m * width, y: t.y + m * height, k: t.k }, sw, sh);
    this.snapT = t;
    this.snapW = width;
    this.snapH = height;
    return true;
  }

  private blit(target: CanvasRenderingContext2D, t: ViewportTransform, width: number, height: number, dpr: number) {
    const snap = this.snapT!;
    const m = this.options.margin ?? 0.25;
    const scale = t.k / snap.k;
    // Snapshot pixel (0,0) was screen (-m*w, -m*h) at camera `snap`.
    const ox = (-m * width - snap.x) * scale + t.x;
    const oy = (-m * height - snap.y) * scale + t.y;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, target.canvas.width, target.canvas.height);
    target.imageSmoothingEnabled = true;
    target.drawImage(this.snap!, ox * dpr, oy * dpr, this.snap!.width * scale, this.snap!.height * scale);
  }
}
