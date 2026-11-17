import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasNode, CanvasEdge } from './types';
import { Badge, IconButton } from '../ui';
import { X } from 'lucide-react';

interface CanvasBoardShellProps {
  mode: 'edit' | 'view';
  width: number;
  height: number;
  transform: { x: number; y: number; k: number };
  onTransform: (transform: { x: number; y: number; k: number }) => void;
  isPanning: boolean;
  isSpacePressed: boolean;
  isFullscreen: boolean;
  onCloseFullscreen: () => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** Node layer. Rendered inside the transform layer. */
  children: React.ReactNode;
  /**
   * Edge layer. Rendered in *screen space* as a sibling behind the node layer,
   * because a content-sized canvas inside the transform layer gets cropped by
   * its own bounding box and cannot have zoom-invariant strokes.
   */
  edgeLayer?: React.ReactNode;
  /** Extra screen-space overlays: marquee, port dots, endpoint handles. */
  overlay?: React.ReactNode;
  toolbar?: React.ReactNode;
  emptyState?: React.ReactNode;
  contextMenu?: React.ReactNode;
  selection?: { nodeIds: Set<string>; edgeIds: Set<string> };
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onViewportMounted?: (el: HTMLDivElement | null) => void;
  /**
   * Fires with the board's pixel size. The edge canvas needs this: it is sized
   * to the viewport, not to the content, so the renderer cannot infer it.
   */
  onSizeChange?: (size: { width: number; height: number }) => void;
  activeMode?: 'select' | 'pan';
  onModeChange?: (mode: 'select' | 'pan') => void;
  className?: string;
}

export const CanvasBoardShell: React.FC<CanvasBoardShellProps> = ({
  mode,
  width,
  height,
  transform,
  onTransform,
  isPanning,
  isSpacePressed,
  isFullscreen,
  onCloseFullscreen,
  viewportRef,
  children,
  edgeLayer,
  overlay,
  toolbar,
  emptyState,
  contextMenu,
  selection,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
  onViewportMounted,
  onSizeChange,
  activeMode = 'select',
  onModeChange,
  className,
}) => {
  // The fullscreen portal replaces the inline board rather than mounting a
  // second copy alongside it. Two simultaneous copies meant the nodes, the edge
  // canvas and the endpoint handles were all rendered twice, the hidden one
  // still burning paint work, and whichever element the viewport ref last
  // pointed at could be the one the user could not see. Exactly one board is
  // live at a time, so the ref, the measured size and the gesture listeners all
  // describe the board that is actually on screen.
  const boardRef = useRef<HTMLDivElement>(null);
  const transformLayerRef = useRef<HTMLDivElement>(null);

  // The board sizes itself to the window, so the edge canvas needs the real
  // pixel size. ResizeObserver beats a window resize listener: it also fires
  // when a flex sibling, a sidebar or a fullscreen transition changes the box.
  const sizeRef = useRef({ width: 0, height: 0 });

  /**
   * The transform is kept in a ref as well as state, because the layer element
   * is not stable: entering fullscreen unmounts the inline board and mounts a
   * new one, and a transform written only by an effect keyed on the transform
   * value would never reach that new element. The callback ref re-applies the
   * current transform the moment an element is attached.
   */
  const transformRef = useRef(transform);
  const sizeRefWH = useRef({ width, height });
  transformRef.current = transform;
  sizeRefWH.current = { width, height };

  const applyTransform = useCallback((layer: HTMLDivElement | null, board: HTMLDivElement | null) => {
    const t = transformRef.current;
    if (layer) {
      layer.style.setProperty('--canvas-x', `${t.x}px`);
      layer.style.setProperty('--canvas-y', `${t.y}px`);
      layer.style.setProperty('--canvas-k', String(t.k));
      layer.style.width = `${sizeRefWH.current.width}px`;
      layer.style.height = `${sizeRefWH.current.height}px`;
    }
    if (board) {
      board.style.setProperty('--grid-major', `${120 * t.k}px`);
      board.style.setProperty('--grid-minor', `${24 * t.k}px`);
      board.style.setProperty('--grid-x', `${t.x}px`);
      board.style.setProperty('--grid-y', `${t.y}px`);
    }
  }, []);

  const attachTransformLayer = useCallback(
    (el: HTMLDivElement | null) => {
      transformLayerRef.current = el;
      applyTransform(el, boardRef.current);
    },
    [applyTransform]
  );

  const attachBoard = useCallback(
    (el: HTMLDivElement | null) => {
      boardRef.current = el;
      applyTransform(transformLayerRef.current, el);
      boardRef.current = el;
    },
    [applyTransform]
  );

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    if (viewportRef) viewportRef.current = el;
    onViewportMounted?.(el);

    const publish = (w: number, h: number) => {
      const next = { width: Math.round(w), height: Math.round(h) };
      const prev = sizeRef.current;
      if (prev.width === next.width && prev.height === next.height) return;
      sizeRef.current = next;
      onSizeChange?.(next);
    };

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) publish(box.width, box.height);
    });
    ro.observe(el);
    publish(el.clientWidth, el.clientHeight);
    return () => {
      ro.disconnect();
      if (viewportRef && viewportRef.current === el) viewportRef.current = null;
    };
    // `isFullscreen` is a dependency because it swaps which element is the
    // board: entering fullscreen unmounts the inline board and mounts the
    // portal one, so the ref and the measured size have to be re-established
    // against the element the user can now actually see.
  }, [viewportRef, onViewportMounted, onSizeChange, isFullscreen]);

  // Apply the transform imperatively. Panning writes three custom properties
  // and never re-renders React, so dragging stays on the compositor regardless
  // of how many nodes and edges the board holds.
  useEffect(() => {
    applyTransform(transformLayerRef.current, boardRef.current);
  }, [applyTransform, transform, width, height]);

  // `is-interacting` lets CSS drop shadows and hide hints during a gesture.
  useEffect(() => {
    boardRef.current?.classList.toggle('is-interacting', isPanning);
  }, [isPanning]);

  /**
   * Elements that own their own pointer press. The board must ignore them or a
   * click on one starts a marquee instead.
   *
   * `pointerdown` and `mousedown` are separate dispatches, so a handle that
   * calls `stopPropagation()` on its pointer event still lets the board see the
   * compatibility mouse event. The class check is the only reliable guard.
   */
  const OWNED_POINTER_SELECTOR = '.canvas-interactive-node, .canvas-port-handle, .canvas-edge-endpoint';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest(OWNED_POINTER_SELECTOR)) {
        return;
      }
      onPointerDown?.(e);
    },
    [onPointerDown]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Escape' && isFullscreen) {
        onCloseFullscreen();
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'v' && onModeChange) onModeChange('select');
      else if (key === 'h' && onModeChange) onModeChange('pan');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, onModeChange, onCloseFullscreen]);

  const cursor = isPanning
    ? 'grabbing'
    : isSpacePressed || activeMode === 'pan'
      ? 'grab'
      : 'default';

  const renderBoard = (isPortal: boolean) => (
    <div
      ref={attachBoard}
      className="canvas-board-viewport"
      data-canvas-board={isPortal ? 'fullscreen' : 'inline'}
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        flex: 1,
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor,
        overflow: 'hidden',
        overscrollBehavior: 'none',
        touchAction: 'none',
      }}
    >
      {edgeLayer}

      <div ref={attachTransformLayer} className="canvas-transform-layer">
        {children}
      </div>

      {overlay}
      {emptyState}
      {contextMenu}
    </div>
  );
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
      }}
      className={className}
    >
      <header className="canvas-board-header">
        {toolbar ? (
          toolbar
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.2rem' }} aria-hidden="true">
              🎨
            </span>
            <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
              {mode === 'edit' ? 'Canvas Studio' : 'Canvas Viewer'}
            </span>
          </div>
        )}
      </header>

      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {isFullscreen ? null : renderBoard(false)}
      </div>

      {isFullscreen && typeof document !== 'undefined' && createPortal(
        <div className="canvas-board-fullscreen">
          <div className="canvas-board-fullscreen__bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '1.5rem' }} aria-hidden="true">
                🎨
              </span>
              <div>
                <h2 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', margin: 0, fontWeight: 800 }}>
                  {mode === 'edit' ? 'Canvas Studio (Fullscreen)' : 'Spatial Canvas Board (Fullscreen)'}
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                  {mode === 'edit' ? 'Full-screen spatial authoring' : 'Full-screen spatial exploration'}
                </p>
              </div>
              <Badge tone="info">JSON Canvas v1.0</Badge>
            </div>
            <IconButton label="Close fullscreen" ghost onClick={onCloseFullscreen}>
              <X size={20} />
            </IconButton>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {renderBoard(true)}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export type { CanvasNode, CanvasEdge };
