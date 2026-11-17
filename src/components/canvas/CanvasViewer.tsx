import React, { useEffect, useState, useRef, useMemo } from 'react';
import { GroupIndex } from './core/grouping';
import ReactDOM from 'react-dom';
import RBush from 'rbush';
import type { JsonCanvasSpec, CanvasNode } from './types';
import { EdgeRenderer } from './EdgeRenderer';
import { CanvasToolbar } from './CanvasToolbar';
import { NodeRenderer } from './nodes/NodeRenderer';
import { CanvasJsonEditorModal } from './CanvasJsonEditorModal';
import { getRandomColor } from '../../lib/editor/collaboration';
import { useCollaboration } from '../../lib/editor/useCollaboration';

interface SpatialNodeItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  node: CanvasNode;
}

export interface CanvasViewerProps {
  canvasId?: string;
  canvasUrl?: string;
  initialData?: JsonCanvasSpec;
  currentUser: string;
  isEmbedded?: boolean;
  depth?: number;
}

export const CanvasViewer: React.FC<CanvasViewerProps> = ({
  canvasId,
  canvasUrl,
  initialData,
  currentUser,
  isEmbedded = false,
  depth = 0,
}) => {
  const [canvasData, setCanvasData] = useState<JsonCanvasSpec | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  // Viewport Transform: pan & zoom
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const [boardEl, setBoardEl] = useState<HTMLDivElement | null>(null);
  const [modalBoardEl, setModalBoardEl] = useState<HTMLDivElement | null>(null);

  // Full-page Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

  // Selected Node State (Read-only focus highlight)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Track active viewport dimensions accurately for both inline and fullscreen modal views
  const [viewportDims, setViewportDims] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
  });

  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const hasAutoFittedRef = useRef(false);
  const interactionTimerRef = useRef<any>(null);

  // Adaptive JIT Real-Time Collaboration (Only for standalone viewers, skip for embedded to eliminate overhead)
  const effectiveCollabId = canvasId ? `canvas:${canvasId}` : 'canvas:master-research-walkthrough';
  const collabColor = useRef(getRandomColor());
  const { state } = useCollaboration(
    effectiveCollabId,
    { name: currentUser, color: collabColor.current, userId: currentUser },
    !isEmbedded
  );
  const collabState = state ?? { activeViewers: 1, mode: 'solo' as const, peers: [], isConnectedToDO: false };

  // Compute spatial bounding box
  const bounds = useMemo(() => {
    if (!canvasData?.nodes || canvasData.nodes.length === 0) {
      return { minX: 0, minY: 0, maxX: 1200, maxY: 800, width: 1200, height: 800 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    canvasData.nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    });

    return {
      minX,
      minY,
      maxX: maxX + 120,
      maxY: maxY + 120,
      width: Math.max(maxX - minX + 240, 1100),
      height: Math.max(maxY - minY + 240, 750),
    };
  }, [canvasData]);

  // Spatial Index (R-Tree) for O(log N) Viewport Frustum Culling
  const spatialTree = useMemo(() => {
    const tree = new RBush<SpatialNodeItem>();
    if (canvasData?.nodes && canvasData.nodes.length > 0) {
      tree.load(
        canvasData.nodes.map((n) => ({
          minX: n.x,
          minY: n.y,
          maxX: n.x + n.width,
          maxY: n.y + n.height,
          node: n,
        }))
      );
    }
    return tree;
  }, [canvasData?.nodes]);

  // Viewport Level of Detail (LOD)
  const lodLevel: 'full' | 'medium' | 'minimal' =
    zoom >= 0.65 ? 'full' : zoom >= 0.35 ? 'medium' : 'minimal';

  // Resolved viewport pixel size, shared by culling and the edge canvas.
  const activeViewportWidth =
    (isModalOpen ? modalBoardEl : boardEl)?.clientWidth ||
    viewportDims.width ||
    (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const activeViewportHeight =
    (isModalOpen ? modalBoardEl : boardEl)?.clientHeight ||
    viewportDims.height ||
    (typeof window !== 'undefined' ? window.innerHeight : 1080);

  // Viewport Spatial Bounding Box for O(1) Culling
  const viewportBounds = useMemo(() => {
    const vWidth = activeViewportWidth;
    const vHeight = activeViewportHeight;

    // Generous buffer in canvas coordinates: ensures nodes remain 100% visible
    // until every pixel has left the screen, with zero pop-in during panning.
    const buffer = Math.max(1000 / Math.max(zoom, 0.15), 1000);

    return {
      minX: (-pan.x / zoom) - buffer,
      minY: (-pan.y / zoom) - buffer,
      maxX: ((-pan.x + vWidth) / zoom) + buffer,
      maxY: ((-pan.y + vHeight) / zoom) + buffer,
    };
  }, [pan.x, pan.y, zoom, activeViewportWidth, activeViewportHeight]);

  // Visible Nodes (Spatially Culled via RBush)
  const visibleNodes = useMemo(() => {
    if (!canvasData?.nodes || canvasData.nodes.length <= 50) {
      return canvasData?.nodes || [];
    }
    const results = spatialTree.search(viewportBounds).map((item) => item.node);
    // Always preserve group nodes so bounding outlines don't pop out
    const groupNodes = canvasData.nodes.filter((n) => n.type === 'group');
    const uniqueSet = new Set(results.map((n) => n.id));
    groupNodes.forEach((g) => {
      if (!uniqueSet.has(g.id)) results.push(g);
    });
    return results;
  }, [canvasData?.nodes, spatialTree, viewportBounds]);

  const selectedNode = useMemo(() => {
    return canvasData?.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [canvasData?.nodes, selectedNodeId]);

  /**
   * The group tree for the whole document, built once per revision rather than
   * per badge per frame. The viewer does not edit membership, but it does have
   * to agree with the editor about what a group contains.
   */
  const viewerIndex = useMemo(
    () => new GroupIndex(canvasData?.nodes ?? []),
    [canvasData?.nodes]
  );

  const handleNodeClick = (nodeId: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, a, select, .canvas-node-scrollable')) {
      return;
    }
    e.stopPropagation();
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  };

  // Viewport Controls
  const handleZoomIn = () => setZoom((z) => Math.min(Number((z + 0.15).toFixed(2)), 2.2));
  const handleZoomOut = () => setZoom((z) => Math.max(Number((z - 0.15).toFixed(2)), 0.25));
  const handleResetZoom = () => {
    setZoom(0.85);
    setPan({ x: 40, y: 40 });
  };

  const handleFitToBounds = (isModal = false) => {
    const el = isModal ? modalBoardEl : boardEl;
    const containerWidth = el?.clientWidth || (isModal ? window.innerWidth - 60 : isEmbedded ? 500 : 1000);
    const containerHeight = el?.clientHeight || (isModal ? window.innerHeight - 140 : isEmbedded ? 320 : 650);
    const scaleX = (containerWidth - 30) / bounds.width;
    const scaleY = (containerHeight - 30) / bounds.height;
    const fitScale = Math.min(scaleX, scaleY, 1.0);
    const finalZoom = Math.max(Number(fitScale.toFixed(2)), 0.15);
    setZoom(finalZoom);
    setPan({
      x: Math.round(-bounds.minX * finalZoom + (containerWidth - bounds.width * finalZoom) / 2),
      y: Math.round(-bounds.minY * finalZoom + (containerHeight - bounds.height * finalZoom) / 2),
    });
  };

  const markInteracting = (targetEl?: HTMLElement | null) => {
    if (targetEl) targetEl.classList.add('is-interacting');
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = setTimeout(() => {
      if (boardEl) boardEl.classList.remove('is-interacting');
      if (modalBoardEl) modalBoardEl.classList.remove('is-interacting');
    }, 120);
  };

  useEffect(() => {
    const activeEl = isModalOpen ? modalBoardEl : boardEl;
    const updateDimensions = () => {
      const w =
        activeEl?.clientWidth ||
        (isModalOpen && typeof window !== 'undefined' ? window.innerWidth : 0) ||
        (typeof window !== 'undefined' ? window.innerWidth : 1920);
      const h =
        activeEl?.clientHeight ||
        (isModalOpen && typeof window !== 'undefined' ? window.innerHeight : 0) ||
        (typeof window !== 'undefined' ? window.innerHeight : 1080);
      if (w > 0 && h > 0) {
        setViewportDims((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    };

    updateDimensions();

    window.addEventListener('resize', updateDimensions);
    let resizeObserver: ResizeObserver | null = null;
    if (activeEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(activeEl);
    }

    return () => {
      window.removeEventListener('resize', updateDimensions);
      resizeObserver?.disconnect();
    };
  }, [isModalOpen, modalBoardEl, boardEl]);

  // Listen for Escape key and zoom shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
      const isMeta = e.ctrlKey || e.metaKey;
      if (isMeta && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0')) {
        e.preventDefault();
        if (e.key === '=' || e.key === '+') {
          handleZoomIn();
        } else if (e.key === '-' || e.key === '_') {
          handleZoomOut();
        } else if (e.key === '0') {
          handleResetZoom();
        }
      }
    };
    if (isModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      document.body.style.overscrollBehavior = '';
    };
  }, [isModalOpen]);

  // Load Canvas Data via ReBAC-protected API
  useEffect(() => {
    if (initialData) {
      setCanvasData((prev) => (prev === initialData ? prev : initialData));
      setLoading(false);
      return;
    }

    let isMounted = true;
    async function fetchCanvas() {
      setLoading(true);
      setError(null);
      try {
        const cleanTargetId = canvasId
          ? canvasId.replace(/^canvas[:\/]/, '').replace(/^public_vault\/canvas\//, '').replace(/\.canvas$/, '')
          : '';

        const targetUrl =
          canvasUrl ||
          (cleanTargetId
            ? `/api/v1/resources/canvas/${encodeURIComponent(cleanTargetId)}`
            : '/api/v1/resources/canvas/master-research-walkthrough');

        const res = await fetch(targetUrl);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data: JsonCanvasSpec = await res.json();
        if (isMounted) {
          setCanvasData(data);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to load canvas data');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchCanvas();
    return () => {
      isMounted = false;
    };
  }, [canvasId, canvasUrl]);

  // Auto-fit bounds on mount when embedded or when canvas data loads
  useEffect(() => {
    if (isEmbedded && canvasData?.nodes && canvasData.nodes.length > 0 && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      const timer = setTimeout(() => {
        handleFitToBounds(false);
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isEmbedded, canvasData]);

  // Native non-passive Wheel & Trackpad Listener (Two-Finger Drag & Focal Point Pinch-to-Zoom)
  useEffect(() => {
    const targets = [boardEl, modalBoardEl].filter(Boolean) as HTMLDivElement[];
    if (targets.length === 0) return;

    const cleanupFns = targets.map((el) => {
      const onWheel = (e: WheelEvent) => {
        // Allow scrolling inside card text boxes
        if ((e.target as HTMLElement).closest('.canvas-node-scrollable')) {
          return;
        }
        e.preventDefault();
        if (isEmbedded) {
          e.stopPropagation();
        }
        markInteracting(el);

        const rect = el.getBoundingClientRect();
        const currentZoom = zoomRef.current;
        const currentPan = panRef.current;

        // 1. Pinch-to-Zoom or Ctrl/Cmd/Alt + Wheel (Cursor-Anchored Focal Point Zoom)
        if (e.ctrlKey || e.metaKey || e.altKey) {
          const zoomIntensity = 0.003;
          const factor = Math.exp(-e.deltaY * zoomIntensity);
          const targetZoom = Math.min(Math.max(currentZoom * factor, 0.2), 2.5);

          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          const canvasX = (mouseX - currentPan.x) / currentZoom;
          const canvasY = (mouseY - currentPan.y) / currentZoom;

          const newPanX = mouseX - canvasX * targetZoom;
          const newPanY = mouseY - canvasY * targetZoom;

          setZoom(Number(targetZoom.toFixed(3)));
          setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
          return;
        }

        // 2. Shift + Wheel (Horizontal pan)
        if (e.shiftKey) {
          setPan((p) => ({
            x: p.x - (e.deltaY || e.deltaX),
            y: p.y,
          }));
          return;
        }

        // 3. Two-Finger Trackpad Drag / Wheel Pan
        setPan((p) => ({
          x: p.x - e.deltaX,
          y: p.y - e.deltaY,
        }));
      };

      const preventGesture = (e: Event) => e.preventDefault();

      el.addEventListener('wheel', onWheel, { passive: false });
      el.addEventListener('gesturestart', preventGesture, { passive: false });
      el.addEventListener('gesturechange', preventGesture, { passive: false });
      el.addEventListener('gestureend', preventGesture, { passive: false });

      return () => {
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('gesturestart', preventGesture);
        el.removeEventListener('gesturechange', preventGesture);
        el.removeEventListener('gestureend', preventGesture);
      };
    });

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
  }, [boardEl, modalBoardEl]);

  // Double Click on Background to Smart-Zoom
  const handleDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.canvas-interactive-node')) return;
    if (isEmbedded) {
      e.stopPropagation();
    }
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const canvasX = (mouseX - pan.x) / zoom;
    const canvasY = (mouseY - pan.y) / zoom;

    const targetZoom = zoom >= 1.2 ? 0.85 : Math.min(zoom * 1.5, 2.2);

    const newPanX = mouseX - canvasX * targetZoom;
    const newPanY = mouseY - canvasY * targetZoom;

    setZoom(Number(targetZoom.toFixed(3)));
    setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
  };

  // Pan & Node Drag Gestures
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.canvas-interactive-node')) return;
    if (isEmbedded) {
      e.stopPropagation();
    }
    setSelectedNodeId(null);
    setIsPanning(true);
    markInteracting(boardEl || modalBoardEl);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    markInteracting(boardEl || modalBoardEl);
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    boardEl?.classList.remove('is-interacting');
    modalBoardEl?.classList.remove('is-interacting');
  };

  // Recursion safeguard: cap nested sub-canvas depth
  if (depth >= 2) {
    const title = canvasData?.title || canvasId?.replace(/^canvas:/, '').replace(/[-_]/g, ' ') || 'Sub-Canvas';
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          textAlign: 'center',
          boxSizing: 'border-box',
          background: 'rgba(15, 23, 42, 0.6)',
          borderRadius: '8px',
          border: '1px dashed var(--border-glass)',
        }}
      >
        <span style={{ fontSize: '1.4rem', marginBottom: '4px' }}>🎨</span>
        <h5 style={{ color: '#fff', margin: '0 0 4px 0', fontSize: '0.85rem' }}>{title}</h5>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
          Recursive depth limit reached
        </span>
        <a
          href={`/?doc=${encodeURIComponent(canvasId || '')}`}
          style={{
            fontSize: '0.74rem',
            color: 'var(--accent-cyan)',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Open Sub-Canvas ↗
        </a>
      </div>
    );
  }

  if (loading) {
    if (isEmbedded) {
      return (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '1.2rem', marginBottom: '0.5rem', animation: 'spin 1.5s linear infinite' }}>🎨</div>
          <span style={{ fontSize: '0.78rem' }}>Loading Sub-Canvas...</span>
        </div>
      );
    }
    return (
      <div className="ui-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem', animation: 'spin 1.5s linear infinite' }}>🎨</div>
        <h4 style={{ color: '#fff' }}>Loading Spatial JSON Canvas Board...</h4>
        <p style={{ fontSize: '0.85rem' }}>Resolving dynamic node coordinates and ReBAC authorization policies.</p>
      </div>
    );
  }

  if (error || !canvasData) {
    if (isEmbedded) {
      return (
        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--accent-rose)' }}>
          <span style={{ fontSize: '1.2rem' }}>⚠️</span>
          <p style={{ fontSize: '0.78rem', margin: '4px 0 0 0' }}>{error || 'Sub-canvas not accessible.'}</p>
        </div>
      );
    }
    return (
      <div className="ui-card" style={{ padding: '2.5rem', textAlign: 'center', borderColor: 'var(--accent-rose)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
        <h4 style={{ color: 'var(--accent-rose)' }}>Failed to Load Canvas</h4>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{error || 'Canvas resource not found or access denied.'}</p>
      </div>
    );
  }

  // Common Viewport Renderer
  const renderCanvasBoard = (viewportHeight: string, isModal = false) => (
    <div
      ref={isModal ? setModalBoardEl : setBoardEl}
      className="canvas-board-viewport"
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        position: 'relative',
        width: '100%',
        height: viewportHeight,
        background: 'radial-gradient(circle at 50% 50%, rgba(15, 23, 42, 0.92) 0%, rgba(5, 8, 16, 0.98) 100%)',
        borderRadius: isModal ? '16px' : isEmbedded ? '8px' : '12px',
        border: isEmbedded && !isModal ? 'none' : '1px solid var(--border-glass)',
        overflow: 'hidden',
        overscrollBehavior: 'none',
        touchAction: 'none',
        cursor: isPanning ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      {/*
        Edges paint in screen space. Sizing the canvas to the viewport instead
        of the content bounding box is what stops edges from being cropped once
        content extends past the box, and it lets strokes and label pills hold a
        constant on-screen size at any zoom.
      */}
      <EdgeRenderer
        edges={canvasData.edges}
        nodes={canvasData.nodes}
        transform={{ x: pan.x, y: pan.y, k: zoom }}
        size={{ width: activeViewportWidth, height: activeViewportHeight }}
      />

      {/* Transform Layer */}
      <div
        className="canvas-transform-layer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isPanning ? 'none' : 'transform 0.08s ease-out',
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
        }}
      >
        {/* Selected Node Floating Action (Read-Only Focus & Quick Studio Link) */}
        {selectedNode && (
          <div
            style={{
              position: 'absolute',
              left: `${selectedNode.x}px`,
              top: `${selectedNode.y - 34}px`,
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '8px',
              background: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid rgba(0, 242, 254, 0.4)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(16px)',
              pointerEvents: 'auto',
              fontSize: '0.74rem',
              color: 'var(--text-secondary)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
              {selectedNode.resolvedTitle || selectedNode.id}
            </span>
            {canvasId && (
              <a
                href={`/studio/canvas/${encodeURIComponent(canvasId.replace(/^canvas:/, ''))}`}
                style={{
                  color: 'var(--accent-cyan)',
                  textDecoration: 'none',
                  marginLeft: '4px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '2px',
                }}
              >
                ✏️ Edit in Studio ↗
              </a>
            )}
            <button
              onClick={() => setSelectedNodeId(null)}
              title="Deselect"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                padding: '0 2px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                marginLeft: '4px',
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Group Nodes (Background Layer: z-index 1) */}
        {visibleNodes
          .filter((n) => n.type === 'group')
          .map((group) => {
            // Same tree the editor uses, so the viewer cannot report a
            // different count than the board it is mirroring.
            const count = viewerIndex.containedIds(group.id).length;
            return (
              <div
                key={group.id}
                onClick={(e) => handleNodeClick(group.id, e)}
                style={{ display: 'contents' }}
              >
                <NodeRenderer
                  node={group}
                  currentUser={currentUser}
                  containedCount={count}
                  depth={depth}
                  lod={lodLevel}
                  isSelected={selectedNodeId === group.id}
                />
              </div>
            );
          })}

        {/* Content & Resource Nodes (Top Layer: z-index 3) */}
        {visibleNodes
          .filter((n) => n.type !== 'group')
          .map((node) => (
            <div
              key={node.id}
              onClick={(e) => handleNodeClick(node.id, e)}
              style={{ display: 'contents' }}
            >
              <NodeRenderer
                node={node}
                currentUser={currentUser}
                depth={depth}
                lod={lodLevel}
                isSelected={selectedNodeId === node.id}
              />
            </div>
          ))}
      </div>
    </div>
  );

  // Embedded Sub-Canvas Render Layout
  if (isEmbedded) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {/* Compact Sub-Canvas Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 8px',
            background: 'rgba(15, 23, 42, 0.85)',
            borderBottom: '1px solid var(--border-glass)',
            flexShrink: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
            <span style={{ fontSize: '0.9rem' }}>🎨</span>
            <span
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                color: '#fff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={canvasData.title || canvasId}
            >
              {canvasData.title || canvasId?.replace(/^canvas:/, '').replace(/[-_]/g, ' ') || 'Sub-Canvas'}
            </span>
            <span
              style={{
                fontSize: '0.62rem',
                background: 'rgba(0, 242, 254, 0.15)',
                color: 'var(--accent-cyan)',
                padding: '1px 5px',
                borderRadius: '4px',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {canvasData.nodes.length}N · {canvasData.edges.length}E
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <button
              onClick={() => handleResetZoom()}
              className="glass-button"
              style={{ padding: '2px 6px', fontSize: '0.7rem' }}
              title="Reset Zoom"
            >
              ⊙
            </button>
            <button
              onClick={() => handleFitToBounds(false)}
              className="glass-button"
              style={{ padding: '2px 6px', fontSize: '0.7rem' }}
              title="Fit to Content"
            >
              ⛶ Fit
            </button>
            <button
              onClick={() => {
                setIsModalOpen(true);
                setTimeout(() => handleFitToBounds(true), 50);
              }}
              className="glass-button"
              style={{ padding: '2px 6px', fontSize: '0.7rem' }}
              title="Expand to Fullscreen Modal"
            >
              ↗
            </button>
            {canvasId && (
              <a
                href={`/studio/canvas/${encodeURIComponent(canvasId.replace(/^canvas:/, ''))}`}
                className="glass-button"
                style={{ padding: '2px 6px', fontSize: '0.7rem', color: 'var(--accent-cyan)', textDecoration: 'none' }}
                title="Edit in Canvas Studio"
              >
                ✏️
              </a>
            )}
          </div>
        </div>

        {/* Embedded Viewport */}
        <div style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative' }}>
          {renderCanvasBoard('100%', false)}
        </div>

        {/* Live .canvas JSON File Viewer Modal */}
        <CanvasJsonEditorModal
          isOpen={isJsonModalOpen}
          onClose={() => setIsJsonModalOpen(false)}
          nodes={canvasData.nodes}
          edges={canvasData.edges}
          title={canvasData.title}
          onApply={(newNodes, newEdges, newTitle) => {
            setCanvasData({
              ...canvasData,
              nodes: newNodes,
              edges: newEdges,
              title: newTitle || canvasData.title,
            });
          }}
        />

        {/* Full-Page Modal Portal */}
        {isModalOpen &&
          typeof document !== 'undefined' &&
          ReactDOM.createPortal(
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 999999,
                background: 'rgba(5, 8, 16, 0.96)',
                backdropFilter: 'blur(20px)',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px 24px',
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  borderBottom: '1px solid var(--border-glass)',
                  paddingBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '1.5rem' }}>🎨</span>
                  <div>
                    <h2 style={{ fontSize: '1.4rem', color: '#fff', margin: 0, fontWeight: 800 }}>
                      {canvasData.title || canvasId?.replace(/^canvas:/, '').replace(/[-_]/g, ' ') || 'Spatial Canvas Board'}
                    </h2>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                      Sub-canvas exploration · {canvasData.nodes.length} nodes · {canvasData.edges.length} edges
                    </p>
                  </div>
                  <span className="ui-badge ui-badge--info">JSON Canvas v1.0</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <CanvasToolbar
                    zoom={zoom}
                    onZoomIn={handleZoomIn}
                    onZoomOut={handleZoomOut}
                    onResetZoom={handleResetZoom}
                    onFitToBounds={() => handleFitToBounds(true)}
                    isModal={true}
                    onOpenJsonEditor={() => setIsJsonModalOpen(true)}
                    onToggleModal={() => setIsModalOpen(false)}
                  />
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>{renderCanvasBoard('100%', true)}</div>
            </div>,
            document.body
          )}
      </div>
    );
  }

  return (
    <div className="ui-card" style={{ padding: '1.25rem', marginTop: '1.5rem', position: 'relative' }}>
      {/* Top Header & Integrated Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1rem',
          borderBottom: '1px solid var(--border-glass)',
          paddingBottom: '0.75rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>🎨</span>
            <h3 style={{ fontSize: '1.25rem', color: '#fff', margin: 0 }}>
              {canvasData.title || canvasId?.replace(/^canvas:/, '').replace(/[-_]/g, ' ') || 'Spatial Canvas Board'}
            </h3>
            <span className="ui-badge ui-badge--info" style={{ fontSize: '0.7rem' }}>JSON Canvas v1.0</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            Spatial graph with {canvasData.nodes.length} nodes and {canvasData.edges.length} edges.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Presence Indicator */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '0.75rem',
              fontWeight: 600,
              background: collabState.mode === 'collab' ? 'rgba(0, 242, 254, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              border: `1px solid ${collabState.mode === 'collab' ? 'var(--accent-cyan)' : 'rgba(16, 185, 129, 0.4)'}`,
              color: collabState.mode === 'collab' ? 'var(--accent-cyan)' : 'var(--accent-emerald)',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: collabState.mode === 'collab' ? 'var(--accent-cyan)' : 'var(--accent-emerald)',
                boxShadow: `0 0 8px ${collabState.mode === 'collab' ? '#00f2fe' : '#10b981'}`,
              }}
            />
            <span>
              {collabState.mode === 'collab'
                ? `⚡ ${collabState.activeViewers} Collaborators (DO Live)`
                : '🟢 Solo (Zero-Cost)'}
            </span>
          </div>

          {/* Viewport Toolbar */}
          <CanvasToolbar
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={handleResetZoom}
            onFitToBounds={() => handleFitToBounds(false)}
            canvasId={canvasId}
            onOpenJsonEditor={() => setIsJsonModalOpen(true)}
            onToggleModal={() => {
              setIsModalOpen(true);
              setTimeout(() => handleFitToBounds(true), 50);
            }}
          />
        </div>
      </div>

      {/* Inline Viewport */}
      {renderCanvasBoard('720px', false)}

      {/* Live .canvas JSON File Viewer Modal (Read-Only) */}
      <CanvasJsonEditorModal
        isOpen={isJsonModalOpen}
        onClose={() => setIsJsonModalOpen(false)}
        nodes={canvasData.nodes}
        edges={canvasData.edges}
        title={canvasData.title}
        readOnly={true}
      />

      {/* Full-Page Modal Portal */}
      {isModalOpen &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999999,
              background: 'rgba(5, 8, 16, 0.96)',
              backdropFilter: 'blur(20px)',
              display: 'flex',
              flexDirection: 'column',
              padding: '16px 24px',
              boxSizing: 'border-box',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                borderBottom: '1px solid var(--border-glass)',
                paddingBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.5rem' }}>🎨</span>
                <div>
                  <h2 style={{ fontSize: '1.4rem', color: '#fff', margin: 0, fontWeight: 800 }}>
                    {canvasData.title || canvasId?.replace(/^canvas:/, '').replace(/[-_]/g, ' ') || 'Spatial Canvas Board'}
                  </h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                    Full-screen spatial exploration · {canvasData.nodes.length} nodes · {canvasData.edges.length} edges
                  </p>
                </div>
                <span className="ui-badge ui-badge--info">JSON Canvas v1.0</span>
              </div>

              {/* Modal Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CanvasToolbar
                  zoom={zoom}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onResetZoom={handleResetZoom}
                  onFitToBounds={() => handleFitToBounds(true)}
                  isModal={true}
                  onOpenJsonEditor={() => setIsJsonModalOpen(true)}
                  onToggleModal={() => setIsModalOpen(false)}
                />
              </div>
            </div>

            {/* Modal Canvas Viewport */}
            <div style={{ flex: 1, minHeight: 0 }}>{renderCanvasBoard('100%', true)}</div>
          </div>,
          document.body
        )}
    </div>
  );
};

