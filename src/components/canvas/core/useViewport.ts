/**
 * Canvas core — the single source of truth for pan & zoom.
 *
 * Design notes
 * ------------
 * The transform lives in a **ref** and is written straight to CSS custom
 * properties on the board element. Panning and zooming therefore never touch
 * React state on the hot path: a single `style.setProperty` call per frame, and
 * the browser keeps the whole board on the compositor.
 *
 * React state is synchronised at most **once per animation frame**, and only when
 * the transform actually changed. Consumers that genuinely need to re-render
 * (edge geometry, level-of-detail, culling) read `transform`; event handlers
 * read `get()`, which is always current and immune to stale closures.
 *
 * The CSS-variable indirection means the transform layer, the dot grid, and any
 * future consumer all derive from the same three values — there is no second
 * place to keep in sync.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FIT_PADDING, ZOOM } from './constants';
import {
  IDENTITY,
  clampScale,
  fitTransform,
  toWorld as screenToWorld,
  visibleRect,
  zoomAt,
  zoomBy,
  type Point,
  type Rect,
  type Size,
  type ViewportTransform,
} from './transform';

export interface ViewportOptions {
  initial?: Partial<ViewportTransform>;
  min?: number;
  max?: number;
  /** Called after each committed (frame-batched) transform change. */
  onChange?: (t: ViewportTransform) => void;
  /** Called when an interaction starts / ends — used to toggle `.is-interacting`. */
  onInteractionChange?: (interacting: boolean) => void;
}

export interface ViewportApi {
  /** Ref to the board element. Attach with `ref={viewportRef}`. */
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /**
   * The currently attached board element as *state*.
   *
   * `viewportRef.current` is not enough for consumers that install native
   * listeners: the board is a different DOM node after a fullscreen swap, and
   * an effect that only depends on the ref object would keep listening to the
   * detached one. Depending on this value re-binds them.
   */
  element: HTMLDivElement | null;
  /** Callback ref alternative (equivalent, picks whichever the host prefers). */
  setViewportEl: (el: HTMLDivElement | null) => void;
  /** Frame-synced transform. Safe to read during render. */
  transform: ViewportTransform;
  /** Current transform, always fresh — use this inside event handlers. */
  get: () => ViewportTransform;
  /** Viewport size in CSS px (tracked via ResizeObserver). */
  size: Size;
  /** World-space rectangle currently visible. */
  visible: Rect;
  /** Apply a transform. Always frame-synced into React; the DOM is updated now. */
  set: (next: ViewportTransform) => void;
  /** Zoom about a client point. */
  zoomTo: (k: number, clientPoint?: Point) => void;
  zoomBy: (factor: number, clientPoint?: Point) => void;
  zoomIn: (clientPoint?: Point) => void;
  zoomOut: (clientPoint?: Point) => void;
  panByScreen: (dx: number, dy: number) => void;
  /** Frame a world rect inside the viewport. */
  fitTo: (rect: Rect, opts?: { padding?: number; maxUpscale?: number }) => void;
  /** Reset to 100% at a given origin. */
  reset: (origin?: Point) => void;
  /** Centre a world point. */
  centerOn: (point: Point, k?: number) => void;
  /** Client coords -> world coords. */
  toWorld: (clientX: number, clientY: number) => Point;
  /** World coords -> client coords. */
  toClient: (x: number, y: number) => Point;
  /** Client coords -> screen coords relative to the viewport. */
  toViewport: (clientX: number, clientY: number) => Point;
  min: number;
  max: number;
  isInteracting: boolean;
  setInteracting: (v: boolean) => void;
}

const DEFAULT_SIZE: Size = { width: 1200, height: 800 };

export function useViewport(options: ViewportOptions = {}): ViewportApi {
  const { onChange, onInteractionChange } = options;
  const min: number = options.min ?? ZOOM.min;
  const max: number = options.max ?? ZOOM.max;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ViewportTransform>({ ...IDENTITY, ...options.initial });
  const sizeRef = useRef<Size>({ ...DEFAULT_SIZE });
  const interactingRef = useRef(false);
  const frameRef = useRef(0);
  const dirtyRef = useRef(false);

  // Frame-synced mirror for React consumers.
  const [transform, setTransform] = useState<ViewportTransform>(transformRef.current);
  const [size, setSize] = useState<Size>({ ...DEFAULT_SIZE });
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [isInteracting, setIsInteractingState] = useState(false);

  // Keep callbacks in refs so the hot path never closes over stale props.
  const onChangeRef = useRef(onChange);
  const onInteractionChangeRef = useRef(onInteractionChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onInteractionChangeRef.current = onInteractionChange;
  });

  /** Write the transform to CSS custom properties. One style write, no React. */
  const paint = useCallback((t: ViewportTransform) => {
    const el = viewportRef.current;
    if (!el) return;
    const s = el.style;
    s.setProperty('--canvas-x', `${t.x}px`);
    s.setProperty('--canvas-y', `${t.y}px`);
    s.setProperty('--canvas-k', String(t.k));
  }, []);

  /** Schedule a React sync for the next frame, coalescing repeated sets. */
  const scheduleCommit = useCallback(() => {
    dirtyRef.current = true;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const t = transformRef.current;
      setTransform((prev) =>
        prev.x === t.x && prev.y === t.y && prev.k === t.k ? prev : t
      );
      onChangeRef.current?.(t);
    });
  }, []);

  /** Apply a transform. Always frame-synced into React; the DOM is updated now. */
  const set = useCallback(
    (next: ViewportTransform) => {
      const k = clampScale(next.k, min, max);
      const t: ViewportTransform = { x: next.x, y: next.y, k };
      const prev = transformRef.current;
      if (prev.x === t.x && prev.y === t.y && prev.k === t.k) return;
      transformRef.current = t;
      paint(t);
      scheduleCommit();
    },
    [min, max, paint, scheduleCommit]
  );

  const setInteracting = useCallback((v: boolean) => {
    if (interactingRef.current === v) return;
    interactingRef.current = v;
    setIsInteractingState(v);
    onInteractionChangeRef.current?.(v);
  }, []);

  const get = useCallback(() => transformRef.current, []);

  // --- Coordinate conversions ------------------------------------------------

  const toViewport = useCallback((clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: clientX, y: clientY };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: clientX, y: clientY };
    const r = el.getBoundingClientRect();
    return screenToWorld(transformRef.current, { x: clientX - r.left, y: clientY - r.top });
  }, []);

  const toClient = useCallback((x: number, y: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x, y };
    const r = el.getBoundingClientRect();
    const t = transformRef.current;
    return { x: x * t.k + t.x + r.left, y: y * t.k + t.y + r.top };
  }, []);

  // --- Imperative viewport commands ------------------------------------------

  const zoomTo = useCallback(
    (k: number, clientPoint?: Point) => {
      const anchor = clientPoint ? toViewport(clientPoint.x, clientPoint.y) : { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 };
      set(zoomAt(transformRef.current, anchor, k, min, max));
    },
    [max, min, set, toViewport]
  );

  const zoomByFactor = useCallback(
    (factor: number, clientPoint?: Point) => {
      const anchor = clientPoint ? toViewport(clientPoint.x, clientPoint.y) : { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 };
      set(zoomBy(transformRef.current, factor, anchor, min, max));
    },
    [max, min, set, toViewport]
  );

  const zoomIn = useCallback((clientPoint?: Point) => zoomByFactor(ZOOM.step, clientPoint), [zoomByFactor]);
  const zoomOut = useCallback((clientPoint?: Point) => zoomByFactor(1 / ZOOM.step, clientPoint), [zoomByFactor]);

  const panByScreen = useCallback(
    (dx: number, dy: number) => {
      const t = transformRef.current;
      set({ x: t.x + dx, y: t.y + dy, k: t.k });
    },
    [set]
  );

  const fitTo = useCallback(
    (rect: Rect | null, opts?: { padding?: number; maxUpscale?: number }) => {
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      set(
        fitTransform(transformRef.current, rect, sizeRef.current, {
          padding: opts?.padding ?? FIT_PADDING,
          min,
          max,
          maxUpscale: opts?.maxUpscale ?? 1,
        })
      );
    },
    [max, min, set]
  );

  const reset = useCallback(
    (origin?: Point) => {
      const t = transformRef.current;
      const anchor = origin ? toViewport(origin.x, origin.y) : { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 };
      set(zoomAt(t, anchor, 1, min, max));
    },
    [max, min, set, toViewport]
  );

  const centerOn = useCallback(
    (point: Point, k?: number) => {
      const t = transformRef.current;
      const s = sizeRef.current;
      const nextK = clampScale(k ?? t.k, min, max);
      set({
        k: nextK,
        x: s.width / 2 - point.x * nextK,
        y: s.height / 2 - point.y * nextK,
      });
    },
    [max, min, set]
  );

  const visible = useMemo<Rect>(
    () => visibleRect(transform, size),
    [transform, size]
  );

  // --- Viewport measurement --------------------------------------------------

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === sizeRef.current.width && h === sizeRef.current.height) return;
    sizeRef.current = { width: w, height: h };
    setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  }, []);

  const setViewportEl = useCallback(
    (el: HTMLDivElement | null) => {
      viewportRef.current = el;
      setElement((prev) => (prev === el ? prev : el));
      if (!el) return;
      paint(transformRef.current);
      measure();
    },
    [measure, paint]
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    paint(transformRef.current);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, paint]);

  // Cancel any pending frame on unmount.
  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    []
  );  return useMemo<ViewportApi>(
    () => ({
      viewportRef,
      element,
      setViewportEl,
      transform,
      get,
      size,
      visible,
      set,
      zoomTo,
      zoomBy: zoomByFactor,
      zoomIn,
      zoomOut,
      panByScreen,
      fitTo,
      reset,
      centerOn,
      toWorld,
      toClient,
      toViewport,
      min,
      max,
      isInteracting,
      setInteracting,
    }),
    [
      transform,
      get,
      size,
      visible,
      set,
      zoomTo,
      zoomByFactor,
      zoomIn,
      zoomOut,
      panByScreen,
      fitTo,
      reset,
      centerOn,
      toWorld,
      toClient,
      toViewport,
      min,
      max,
      isInteracting,
      setViewportEl,
      setInteracting,
    ]
  );
}
