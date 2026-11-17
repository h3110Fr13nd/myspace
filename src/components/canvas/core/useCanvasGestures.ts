/**
 * Canvas core — input gestures.
 *
 * One controller owns every way a user can move the viewport. Figma, Miro,
 * Excalidraw and tldraw all converge on roughly this model, so we do too:
 *
 *   two-finger scroll / trackpad swipe ......... pan
 *   pinch (trackpad or touchscreen) ........... zoom about the gesture centroid
 *   Ctrl/⌘ + wheel ............................ zoom about the cursor
 *   plain wheel ............................... pan, or zoom (user preference)
 *   Shift + wheel ............................. horizontal pan
 *   Space + drag, middle-drag, right-drag ..... pan
 *   one finger on empty space .................. pan
 *   one finger on a node ...................... drag the node (host decides)
 *   double-click empty space .................. zoom in / zoom out at point
 *
 * Everything is installed natively (non-passive listeners + Pointer Events)
 * rather than via React props, because `wheel` must be non-passive to
 * `preventDefault` and touch/pen need `setPointerCapture` for reliable tracking.
 *
 * The controller is *pluggable*: pass `enabled: false` to disable the wheel and
 * gesture layers, and use `beginPan` imperatively for pointer-initiated pans.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZOOM } from './constants';
import { clampScale, panBy, zoomAt, IDENTITY, type Point, type ViewportTransform } from './transform';
import type { ViewportApi } from './useViewport';

export type CanvasMode = 'select' | 'pan';

export type WheelBehavior = 'pan' | 'zoom';

export interface CanvasPrefs {
  wheel: WheelBehavior;
  /** Show the floating gesture hint on first use. */
  showHints: boolean;
}

const PREFS_KEY = 'canvas_prefs';

/** How long the board waits for another wheel tick before declaring itself idle. */
const WHEEL_IDLE_MS = 140;

export const DEFAULT_PREFS: CanvasPrefs = { wheel: 'pan', showHints: true };

export function readCanvasPrefs(): CanvasPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<CanvasPrefs>;
    return {
      wheel: parsed.wheel === 'zoom' ? 'zoom' : 'pan',
      showHints: parsed.showHints !== false,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writeCanvasPrefs(patch: Partial<CanvasPrefs>): CanvasPrefs {
  const next = { ...readCanvasPrefs(), ...patch };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* storage disabled — preferences stay in-memory only */
    }
  }
  return next;
}

export interface GestureOptions {
  viewport: ViewportApi;
  mode?: CanvasMode;
  /** Set false to detach the wheel/gesture/touch layers entirely. */
  enabled?: boolean;
  /** Ref that tracks whether Space is currently held (temporary hand pan). */
  spacePressedRef?: React.MutableRefObject<boolean>;
  /** Called when Space state changes, for cursor + hint UI. */
  onSpaceChange?: (pressed: boolean) => void;
  /** True when the pointer is over an interactive element that wants the event. */
  shouldIgnoreWheel?: (target: EventTarget | null) => boolean;
  /** Prevent the board from scrolling the page (embedded viewports). */
  stopPropagation?: boolean;
}

export interface GestureApi {
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
  isSpacePressed: boolean;
  isPanning: boolean;
  /** Begin a pointer-driven pan from an arbitrary mousedown (space/middle/right). */
  beginPan: (e: { clientX: number; clientY: number }) => void;
  /** Force-end the current pointer pan (e.g. on Escape or mode switch). */
  endPan: () => void;
  /**
   * `true` once the active pointer pan has moved. Read this in a `contextmenu`
   * handler to tell a right-drag pan apart from a right-click.
   */
  didPanRef: React.MutableRefObject<boolean>;
  /** True when the current pointer press should pan instead of interacting. */
  isPanGesture: (e: { button?: number; shiftKey?: boolean }) => boolean;
  prefs: CanvasPrefs;
  setWheelBehavior: (b: WheelBehavior) => void;
  /** Number of active touch points, for host affordances. */
  touchCount: number;
}

/**
 * Targets that always keep the wheel: real form fields, and anything the host
 * marked as natively scrollable.
 */
const NEVER_SCROLL_SELECTOR = 'textarea, input, select, [data-canvas-native-scroll]';

/**
 * Node bodies opt into `.canvas-node-scrollable`, but that class only means
 * "this region may scroll" — it is present on every node card whether or not
 * the content actually overflows. Bailing out on the class alone therefore
 * swallowed the wheel on every node body, so on a small screen the board could
 * not be panned from wherever a node happened to sit under the cursor.
 *
 * The wheel is only surrendered when the target really is scrollable in the
 * direction the user is scrolling and has somewhere to go.
 */
function targetOwnsWheel(e: WheelEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.(NEVER_SCROLL_SELECTOR)) return true;

  const scroller = target?.closest?.('.canvas-node-scrollable') as HTMLElement | null;
  if (!scroller) return false;

  const canScrollY = scroller.scrollHeight - scroller.clientHeight > 1;
  const canScrollX = scroller.scrollWidth - scroller.clientWidth > 1;
  if (canScrollY && Math.abs(e.deltaY) > 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) return true;
  if (canScrollX && Math.abs(e.deltaX) > 0 && !e.ctrlKey && !e.metaKey) return true;

  return false;
}

interface ActivePointer {
  id: number;
  /** Live client position for this frame. */
  x: number;
  y: number;
  /** Position at the previous frame, so single-finger pan can use a delta. */
  prevX: number;
  prevY: number;
  type: 'touch' | 'mouse' | 'pen';
}

export function useCanvasGestures(options: GestureOptions): GestureApi {
  const {
    viewport,
    mode = 'select',
    enabled = true,
    spacePressedRef,
    onSpaceChange,
    shouldIgnoreWheel,
    stopPropagation = false,
  } = options;

  const [currentMode, setCurrentMode] = useState<CanvasMode>(mode);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [touchCount, setTouchCount] = useState(0);
  /**
   * Seeded from storage during the initial render rather than in an effect, so
   * a control bound to this never renders the default and then flips a frame
   * later. The lazy initialiser is only reached on the server-render pass,
   * where `readCanvasPrefs` safely returns the defaults.
   */
  const [prefs, setPrefs] = useState<CanvasPrefs>(() => readCanvasPrefs());

  // Live mirrors so native listeners (registered once) never read stale state.
  const modeRef = useRef<CanvasMode>(currentMode);
  const enabledRef = useRef(enabled);
  const prefsRef = useRef<CanvasPrefs>(prefs);
  const ignoreWheelRef = useRef(shouldIgnoreWheel);
  const onSpaceChangeRef = useRef(onSpaceChange);

  modeRef.current = currentMode;
  enabledRef.current = enabled;
  prefsRef.current = prefs;
  ignoreWheelRef.current = shouldIgnoreWheel;

  // `mode` is a controlled prop as far as this hook is concerned: the host
  // owns the state (the V/H shortcuts live on the board shell), so the internal
  // mirror has to follow it. Without this, `useState(mode)` would freeze on the
  // first value and `isPanGesture` would keep testing a stale mode forever.
  useEffect(() => {
    setCurrentMode(mode);
  }, [mode]);

  // Every method we call from native listeners is referentially stable, so
  // destructuring them here keeps the effect dependency lists from re-running
  // on every committed transform frame.
  const {
    element: vpElement,
    viewportRef,
    min: vpMin,
    max: vpMax,
    get: vpGet,
    set: vpSet,
    toViewport: vpToViewport,
    panByScreen: vpPanByScreen,
    setInteracting: vpSetInteracting,
  } = viewport;

  useEffect(() => {
    onSpaceChangeRef.current = onSpaceChange;
  });


  const setWheelBehavior = useCallback((wheel: WheelBehavior) => {
    setPrefs(writeCanvasPrefs({ wheel }));
  }, []);

  // -------------------------------------------------------------------------
  // Space-held temporary hand pan
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el || !el.tagName) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (spacePressedRef) spacePressedRef.current = true;
      setIsSpacePressed(true);
      onSpaceChangeRef.current?.(true);
    };

    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (spacePressedRef) spacePressedRef.current = false;
      setIsSpacePressed(false);
      onSpaceChangeRef.current?.(false);
    };

    // A lost window focus while Space is held would otherwise strand the hand mode.
    const blur = () => {
      if (spacePressedRef) spacePressedRef.current = false;
      setIsSpacePressed(false);
      onSpaceChangeRef.current?.(false);
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled, spacePressedRef]);

  // -------------------------------------------------------------------------
  // Wheel: trackpad pan + pinch zoom + configurable plain-wheel behaviour
  // -------------------------------------------------------------------------

  useEffect(() => {
    const el = vpElement;
    if (!el || !enabled) return;

    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const onWheel = (e: WheelEvent) => {
      if (!enabledRef.current) return;
      const target = e.target as HTMLElement | null;
      if (targetOwnsWheel(e)) return;
      if (ignoreWheelRef.current?.(e.target)) return;

      e.preventDefault();
    if (stopPropagation) e.stopPropagation();
    // The board marks itself "interacting" while a gesture is live so CSS can
    // hide hints and soften shadows. Wheel has no end event, so re-arm a timer
    // on every tick and clear the flag once input goes quiet.
    vpSetInteracting(true);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      vpSetInteracting(false);
    }, WHEEL_IDLE_MS);

      const t = vpGet();
      const anchor = vpToViewport(e.clientX, e.clientY);

      // 1. Pinch (trackpad) reports as ctrl+wheel in every modern browser;
      //    ⌘+wheel is treated the same so muscle memory transfers.
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * ZOOM.sensitivity);
        vpSet(zoomAt(t, anchor, t.k * factor, vpMin, vpMax));
        return;
      }

      // 2. Shift + wheel constrains panning to the horizontal axis. Chromium
      //    already converts a shift-wheel into `deltaX` with `deltaY === 0`, but
      //    not every browser or input driver does, so a vertical-only delta is
      //    treated as horizontal travel. The vertical component is dropped
      //    either way: adding `deltaY` to the y axis as well made the board slide
      //    diagonally, which is not what holding shift is asking for.
      if (e.shiftKey) {
        const travel = e.deltaX || e.deltaY;
        vpPanByScreen(-travel, 0);
        return;
      }

      // 3. Everything else follows the user's preference. Pan is the default
      //    because it matches Figma/Miro and is what a trackpad two-finger
      //    swipe should do; plain-wheel users can switch to zoom in settings.
      if (prefsRef.current.wheel === 'zoom') {
        const factor = Math.exp(-e.deltaY * ZOOM.sensitivity);
        vpSet(zoomAt(t, anchor, t.k * factor, vpMin, vpMax));
        return;
      }

      vpPanByScreen(-e.deltaX, -e.deltaY);
    };

    // Safari pinch emits gesture* events instead of ctrl+wheel. The browser
    // also tries to page-zoom, so these must be preventDefault'd.
    let gestureBase: ViewportTransform | null = null;

    const onGestureStart = (e: Event) => {
      if (!enabledRef.current) return;
      e.preventDefault();
      gestureBase = vpGet();
      vpSetInteracting(true);
    };

    const onGestureChange = (e: Event) => {
      if (!enabledRef.current) return;
      e.preventDefault();
      const ge = e as unknown as { scale: number; clientX: number; clientY: number };
      if (!gestureBase) return;
      const anchor = vpToViewport(ge.clientX ?? 0, ge.clientY ?? 0);
      const scale = ge.scale || 1;
      vpSet(zoomAt(gestureBase, anchor, gestureBase.k * scale, vpMin, vpMax));
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureBase = null;
      vpSetInteracting(false);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
      if (idleTimer) clearTimeout(idleTimer);
      vpSetInteracting(false);
    };
  }, [enabled, stopPropagation, vpElement, vpGet, vpMax, vpMin, vpPanByScreen, vpSet, vpSetInteracting, vpToViewport]);

  // -------------------------------------------------------------------------
  // Touch: one finger pans the board, two fingers pinch-zoom + pan together
  // -------------------------------------------------------------------------

  useEffect(() => {
    const el = vpElement;
    if (!el || !enabled) return;

    const active = new Map<number, ActivePointer>();
    let panning = false;
    let pinching = false;
    let suppressClick = false;

    // Incremental pinch state. Every pointer's position is refreshed to the
    // *current* frame before these are recomputed, so `dist` and `centroid`
    // always describe this frame rather than a stale mix of two fingers.
    let prevDist = 0;
    let prevCentroid: Point = { x: 0, y: 0 };
    let prevTransform: ViewportTransform = IDENTITY;

    const centroid = (): Point => {
      let sx = 0;
      let sy = 0;
      for (const p of active.values()) {
        sx += p.x;
        sy += p.y;
      }
      const n = active.size || 1;
      return { x: sx / n, y: sy / n };
    };

    const spread = (): number => {
      const pts = Array.from(active.values());
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      active.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, prevX: e.clientX, prevY: e.clientY, type: 'touch' });
      setTouchCount(active.size);

      if (active.size === 1) {
        // One finger pans the board, except when it lands on a node in select
        // mode \u2014 there the host's own drag handler takes over.
        panning =
          modeRef.current === 'pan' ||
          !(e.target as HTMLElement | null)?.closest?.('.canvas-interactive-node');
        if (panning) {
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* capture unsupported */
          }
          vpSetInteracting(true);
        }
        return;
      }

      if (active.size === 2) {
        // A second finger promotes the gesture to a pinch.
        panning = true;
        pinching = true;
        prevDist = spread();
        prevCentroid = centroid();
        prevTransform = vpGet();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* capture unsupported */
        }
        vpSetInteracting(true);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rec = active.get(e.pointerId);
      if (!rec) return;
      // Always track the live position first: the pinch maths reads spread()
      // and centroid() across *all* active fingers, so a record left at its
      // previous value would collapse the measured distance.
      rec.x = e.clientX;
      rec.y = e.clientY;
      if (!panning) return;

      if (pinching && active.size >= 2) {
        const dist = spread();
        const c = centroid();
        if (prevDist > 8 && dist > 8) {
          // Zoom about the *previous* centroid, then translate by how far the
          // centroid travelled. Doing both in one step is what lets a
          // two-finger drag pinch and pan together with no visible jump \u2014
          // and it stays correct when the fingers move at different rates.
          const anchor = vpToViewport(prevCentroid.x, prevCentroid.y);
          const zoomed = zoomAt(prevTransform, anchor, prevTransform.k * (dist / prevDist), vpMin, vpMax);
          vpSet(panBy(zoomed, c.x - prevCentroid.x, c.y - prevCentroid.y));
        }
        prevDist = dist;
        prevCentroid = c;
        prevTransform = vpGet();
        suppressClick = true;
        return;
      }

      vpPanByScreen(e.clientX - rec.prevX, e.clientY - rec.prevY);
      rec.prevX = e.clientX;
      rec.prevY = e.clientY;
      suppressClick = true;
    };

    const endPointer = (e: PointerEvent) => {
      if (!active.has(e.pointerId)) return;
      active.delete(e.pointerId);
      setTouchCount(active.size);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }

      if (active.size === 1) {
        // Dropping from a pinch back to one finger continues as a pan from the
        // remaining finger with no visual jump: its position is already
        // current, so the next delta is measured from exactly where it is.
        pinching = false;
        prevDist = 0;
        return;
      }

      if (active.size === 0) {
        panning = false;
        pinching = false;
        prevDist = 0;
        vpSetInteracting(false);
      }
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('click', onClickCapture, true);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPointer);
      el.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, [enabled, vpElement, vpGet, vpMax, vpMin, vpPanByScreen, vpSet, vpSetInteracting, vpToViewport]);

  // -------------------------------------------------------------------------
  // Pointer-initiated pan (Space + drag, middle-drag, right-drag, pan mode)
  // -------------------------------------------------------------------------

  const panStateRef = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({ active: false, lastX: 0, lastY: 0, moved: false });

  /**
   * Flips to `true` once a pointer-initiated pan has actually moved. Hosts read
   * it in their `contextmenu` handler to distinguish "right-dragged to pan" from
   * "right-clicked for a menu" — both produce a `contextmenu` event.
   */
  const didPanRef = useRef(false);

  const beginPan = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const s = panStateRef.current;
      if (s.active) return;
      s.active = true;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.moved = false;
      didPanRef.current = false;
      setIsPanning(true);
      vpSetInteracting(true);
    },
    [vpSetInteracting]
  );

  const endPan = useCallback(() => {
    panStateRef.current.active = false;
    setIsPanning(false);
    vpSetInteracting(false);
  }, [vpSetInteracting]);

  // One global move/up pair services every pointer-initiated pan, so we only
  // ever hold a single listener set regardless of how the pan started.
  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: MouseEvent) => {
      const s = panStateRef.current;
      if (!s.active) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      if (dx === 0 && dy === 0) return;
      if (!s.moved) {
        s.moved = true;
        didPanRef.current = true;
      }
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      vpPanByScreen(dx, dy);
    };

    const onUp = () => {
      if (!panStateRef.current.active) return;
      endPan();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [enabled, endPan, vpPanByScreen]);

  const isPanGesture = useCallback(
    (e: { button?: number; shiftKey?: boolean }) => {
      if (e.button === 1 || e.button === 2) return true;
      if (spacePressedRef?.current) return true;
      if (modeRef.current === 'pan' && e.button === 0 && !e.shiftKey) return true;
      return false;
    },
    [spacePressedRef]
  );

  return useMemo<GestureApi>(
    () => ({
      mode: currentMode,
      setMode: setCurrentMode,
      isSpacePressed,
      isPanning,
      beginPan,
      endPan,
      didPanRef,
      isPanGesture,
      prefs,
      setWheelBehavior,
      touchCount,
    }),
    [
      beginPan,
      currentMode,
      endPan,
      isPanning,
      isSpacePressed,
      isPanGesture,
      prefs,
      setWheelBehavior,
      touchCount,
    ]
  );
}

/** Clamp helper re-exported for hosts building custom zoom affordances. */
export { clampScale };
