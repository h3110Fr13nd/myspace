import React, { useEffect, useRef, useCallback } from 'react';
import { useGraphEngine } from './useGraphEngine';
import { setupCanvasEngine } from './CanvasRenderer';
import { setupSVGEngine } from './SVGRenderer';
import { GraphToolbar } from './GraphToolbar';
import { GraphLegend } from './GraphLegend';
import { GraphModal } from './GraphModal';
import { updateSimulationPhysics } from './simulation';
import type { GraphViewProps } from './constants';

interface GraphShellProps extends GraphViewProps {
  host: 'svg' | 'canvas';
}

export const GraphShell: React.FC<GraphShellProps> = (props) => {
  const { host, ...rest } = props;

  const engine = useGraphEngine({ ...rest, host });

  const widgetCleanupRef = useRef<(() => void) | null>(null);
  const modalCleanupRef = useRef<(() => void) | null>(null);

  const widgetRequestRender = useCallback(() => {
    engine.requestRender(false);
  }, [engine]);

  const modalRequestRender = useCallback(() => {
    engine.requestRender(true);
  }, [engine]);

  // Mount Sidebar Widget View
  useEffect(() => {
    const el = engine.widgetRef.current;
    if (!el) return;

    if (host === 'canvas') {
      const canvas = el as HTMLCanvasElement;
      widgetCleanupRef.current = setupCanvasEngine({
        canvas,
        nodes: engine.contextualNodes,
        links: engine.contextualLinks,
        width: engine.widgetWidth,
        height: engine.widgetHeight,
        isModal: false,
        activeNodeId: engine.activeNodeId,
        getNodeColor: engine.getNodeColor,
        getNodeRadius: engine.getNodeRadius,
        getNodeLabel: engine.getNodeLabel,
        transformRef: engine.widgetTransformRef,
        zoomRef: engine.widgetZoomRef,
        quadtreeRef: engine.widgetQuadtreeRef,
        requestRenderRef: engine.widgetRequestRenderRef,
        simulationRef: engine.widgetSimulationRef,
        renderDataRef: engine.widgetRenderDataRef,
        hoveredNodeIdRef: engine.hoveredNodeIdRef,
        physicsRef: engine.physicsRef,
        zoomBreakpointRef: engine.zoomBreakpointRef,
        showLabelsRef: engine.showLabelsRef,
        readIdsRef: engine.readIdsRef,
        handleNodeClickRef: engine.handleNodeClickRef,
        hoveredInfoSetter: engine.setHoveredInfo,
        zoomBadgeRef: engine.widgetZoomBadgeRef,
      });
    } else {
      const svg = el as SVGSVGElement;
      widgetCleanupRef.current = setupSVGEngine({
        svgEl: svg,
        nodes: engine.contextualNodes,
        links: engine.contextualLinks,
        width: engine.widgetWidth,
        height: engine.widgetHeight,
        isModal: false,
        activeNodeId: engine.activeNodeId,
        getNodeColor: engine.getNodeColor,
        getNodeRadius: engine.getNodeRadius,
        getNodeLabel: engine.getNodeLabel,
        zoomRef: engine.widgetZoomRef,
        simulationRef: engine.widgetSimulationRef,
        renderDataRef: engine.widgetRenderDataRef,
        hoveredNodeIdRef: engine.hoveredNodeIdRef,
        physicsRef: engine.physicsRef,
        zoomBreakpointRef: engine.zoomBreakpointRef,
        showLabelsRef: engine.showLabelsRef,
        readIdsRef: engine.readIdsRef,
        handleNodeClickRef: engine.handleNodeClickRef,
        hoveredInfoSetter: engine.setHoveredInfo,
        zoomBadgeRef: engine.widgetZoomBadgeRef,
        currentKRef: engine.widgetTransformRef as any, // SVG uses currentKRef for scale tracking
      });
    }

    return () => {
      if (widgetCleanupRef.current) {
        widgetCleanupRef.current();
        widgetCleanupRef.current = null;
      }
    };
  }, [
    engine.contextualNodes,
    engine.contextualLinks,
    host,
    engine.widgetWidth,
    engine.widgetHeight,
    engine.activeNodeId,
    engine.getNodeColor,
    engine.getNodeRadius,
    engine.getNodeLabel,
  ]);

  // Mount Fullscreen Modal View
  useEffect(() => {
    if (!engine.isExpanded) return;
    const el = engine.modalRef.current;
    if (!el) return;

    if (host === 'canvas') {
      const canvas = el as HTMLCanvasElement;
      modalCleanupRef.current = setupCanvasEngine({
        canvas,
        nodes: engine.modalFilteredNodes,
        links: engine.modalFilteredLinks,
        width: engine.modalWidth,
        height: engine.modalHeight,
        isModal: true,
        activeNodeId: engine.activeNodeId,
        getNodeColor: engine.getNodeColor,
        getNodeRadius: engine.getNodeRadius,
        getNodeLabel: engine.getNodeLabel,
        transformRef: engine.modalTransformRef,
        zoomRef: engine.modalZoomRef,
        quadtreeRef: engine.modalQuadtreeRef,
        requestRenderRef: engine.modalRequestRenderRef,
        simulationRef: engine.modalSimulationRef,
        renderDataRef: engine.modalRenderDataRef,
        hoveredNodeIdRef: engine.hoveredNodeIdRef,
        physicsRef: engine.physicsRef,
        zoomBreakpointRef: engine.zoomBreakpointRef,
        showLabelsRef: engine.showLabelsRef,
        readIdsRef: engine.readIdsRef,
        handleNodeClickRef: engine.handleNodeClickRef,
        hoveredInfoSetter: engine.setHoveredInfo,
        zoomBadgeRef: engine.modalZoomBadgeRef,
      });
    } else {
      const svg = el as SVGSVGElement;
      modalCleanupRef.current = setupSVGEngine({
        svgEl: svg,
        nodes: engine.modalFilteredNodes,
        links: engine.modalFilteredLinks,
        width: engine.modalWidth,
        height: engine.modalHeight,
        isModal: true,
        activeNodeId: engine.activeNodeId,
        getNodeColor: engine.getNodeColor,
        getNodeRadius: engine.getNodeRadius,
        getNodeLabel: engine.getNodeLabel,
        zoomRef: engine.modalZoomRef,
        simulationRef: engine.modalSimulationRef,
        renderDataRef: engine.modalRenderDataRef,
        hoveredNodeIdRef: engine.hoveredNodeIdRef,
        physicsRef: engine.physicsRef,
        zoomBreakpointRef: engine.zoomBreakpointRef,
        showLabelsRef: engine.showLabelsRef,
        readIdsRef: engine.readIdsRef,
        handleNodeClickRef: engine.handleNodeClickRef,
        hoveredInfoSetter: engine.setHoveredInfo,
        zoomBadgeRef: engine.modalZoomBadgeRef,
        currentKRef: engine.modalTransformRef as any,
      });
    }

    return () => {
      if (modalCleanupRef.current) {
        modalCleanupRef.current();
        modalCleanupRef.current = null;
      }
    };
  }, [
    engine.isExpanded,
    engine.modalFilteredNodes,
    engine.modalFilteredLinks,
    host,
    engine.modalWidth,
    engine.modalHeight,
    engine.activeNodeId,
    engine.getNodeColor,
    engine.getNodeRadius,
    engine.getNodeLabel,
  ]);

  // Live Physics Slider Adjustment (Modal only)
  useEffect(() => {
    const sim = engine.modalSimulationRef.current;
    if (!sim) return;
    const w = engine.modalWidth;
    const h = engine.modalHeight;
    const links = engine.modalRenderDataRef.current.links;
    updateSimulationPhysics(sim, w, h, engine.physicsRef.current, engine.activeNodeId, links);
  }, [
    engine.repulsion,
    engine.gravity,
    engine.linkDistance,
    engine.collisionPadding,
    engine.activeNodeId,
    engine.modalWidth,
    engine.modalHeight,
    engine.modalRenderDataRef.current.links,
  ]);

  const isCanvas = host === 'canvas';

  return (
    <div style={{ position: 'relative' }}>
      {/* Widget Viewport */}
      <div className="graph-viewport">
        {isCanvas ? (
          <canvas
            ref={engine.widgetRef as React.RefObject<HTMLCanvasElement | null>}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'block',
              cursor: 'grab',
            }}
          />
        ) : (
          <svg ref={engine.widgetRef as React.RefObject<SVGSVGElement | null>} width="100%" height="100%" />
        )}

        {/* Label + expand live inside the graph window so nothing sits above
            it, and the chrome rail can never overlap the expand control. */}
        <div className="graph-viewport-bar">
          <span className="graph-viewport-bar__label">Graph view</span>
          <button
            type="button"
            className="graph-viewport-bar__expand"
            onClick={() => {
              engine.setIsExpanded(true);
              void props.onExpand?.();
            }}
            title="Expand Graph View (Fullscreen)"
            aria-label="Expand graph view fullscreen"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h6v6"></path>
              <path d="M9 21H3v-6"></path>
              <path d="M21 3l-7 7"></path>
              <path d="M3 21l7-7"></path>
            </svg>
          </button>
        </div>

        <GraphToolbar
          isModal={false}
          onZoomIn={() => engine.zoomIn(false)}
          onZoomOut={() => engine.zoomOut(false)}
          onFit={() => engine.fit(false)}
          badgeRef={engine.widgetZoomBadgeRef}
        />
      </div>

      {/* Fullscreen Portal Modal */}
      <GraphModal
        host={host}
        isOpen={engine.isExpanded}
        onClose={() => engine.setIsExpanded(false)}
        filteredNodes={engine.modalFilteredNodes}
        filteredLinks={engine.modalFilteredLinks}
        hostRef={engine.modalRef}
        zoomBadgeRef={engine.modalZoomBadgeRef}
        onZoomIn={() => engine.zoomIn(true)}
        onZoomOut={() => engine.zoomOut(true)}
        onFit={() => engine.fit(true)}
        onResetZoom={() => engine.resetZoom(true)}
        isDrawerOpen={engine.isDrawerOpen}
        setIsDrawerOpen={engine.setIsDrawerOpen}
        activeTab={engine.activeTab}
        setActiveTab={engine.setActiveTab}
        repulsion={engine.repulsion}
        setRepulsion={engine.setRepulsion}
        gravity={engine.gravity}
        setGravity={engine.setGravity}
        linkDistance={engine.linkDistance}
        setLinkDistance={engine.setLinkDistance}
        collisionPadding={engine.collisionPadding}
        setCollisionPadding={engine.setCollisionPadding}
        onResetPhysics={engine.handleResetPhysics}
        searchQuery={engine.searchQuery}
        setSearchQuery={engine.setSearchQuery}
        hideOrphans={engine.hideOrphans}
        setHideOrphans={engine.setHideOrphans}
        availableTypesWithCounts={engine.availableTypesWithCounts}
        selectedTypes={engine.selectedTypes}
        onToggleType={engine.handleToggleType}
        onSelectAllTypes={engine.handleSelectAllTypes}
        onClearAllTypes={engine.handleClearAllTypes}
        zoomBreakpoint={engine.zoomBreakpoint}
        setZoomBreakpoint={engine.setZoomBreakpoint}
        showLabels={engine.showLabels}
        setShowLabels={engine.setShowLabels}
        hoveredInfo={engine.hoveredInfo}
        readIds={engine.readIdsRef.current}
        fullGraphLoading={props.fullGraphLoading ?? false}
        fullGraphError={props.fullGraphError ?? null}
        onRetryFullGraph={props.onExpand}
      />
    </div>
  );
};
