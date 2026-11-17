import React from 'react';
import type { GraphNode, GraphLink } from './constants';
import { GraphToolbar } from './GraphToolbar';
import { GraphDrawer } from './GraphDrawer';
import { GraphTooltip } from './GraphTooltip';
import type { HoveredInfo } from './GraphTooltip';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Flex } from '../ui/Stack';
import { ENTITY_META, normalizeEntityType } from './constants';

interface GraphModalProps {
  host: 'svg' | 'canvas';
  isOpen: boolean;
  onClose: () => void;
  filteredNodes: GraphNode[];
  filteredLinks: GraphLink[];
  hostRef: React.RefObject<SVGSVGElement | HTMLCanvasElement | null>;
  zoomBadgeRef: React.RefObject<HTMLDivElement | HTMLSpanElement | null>;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onResetZoom: () => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (val: boolean) => void;
  activeTab: 'physics' | 'filters' | 'display';
  setActiveTab: (tab: 'physics' | 'filters' | 'display') => void;
  repulsion: number;
  setRepulsion: (val: number) => void;
  gravity: number;
  setGravity: (val: number) => void;
  linkDistance: number;
  setLinkDistance: (val: number) => void;
  collisionPadding: number;
  setCollisionPadding: (val: number) => void;
  onResetPhysics: () => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  hideOrphans: boolean;
  setHideOrphans: (val: boolean) => void;
  availableTypesWithCounts: Record<string, number>;
  selectedTypes: Set<string>;
  onToggleType: (typeKey: string) => void;
  onSelectAllTypes: () => void;
  onClearAllTypes: () => void;
  zoomBreakpoint: number;
  setZoomBreakpoint: (val: number) => void;
  showLabels: 'always' | 'hover';
  setShowLabels: (val: 'always' | 'hover') => void;
  hoveredInfo: HoveredInfo | null;
  readIds: Set<string>;
  fullGraphLoading: boolean;
  fullGraphError: string | null;
  onRetryFullGraph?: () => void;
}

export const GraphModal: React.FC<GraphModalProps> = ({
  host,
  isOpen,
  onClose,
  filteredNodes,
  filteredLinks,
  hostRef,
  zoomBadgeRef,
  onZoomIn,
  onZoomOut,
  onFit,
  onResetZoom,
  isDrawerOpen,
  setIsDrawerOpen,
  activeTab,
  setActiveTab,
  repulsion,
  setRepulsion,
  gravity,
  setGravity,
  linkDistance,
  setLinkDistance,
  collisionPadding,
  setCollisionPadding,
  onResetPhysics,
  searchQuery,
  setSearchQuery,
  hideOrphans,
  setHideOrphans,
  availableTypesWithCounts,
  selectedTypes,
  onToggleType,
  onSelectAllTypes,
  onClearAllTypes,
  zoomBreakpoint,
  setZoomBreakpoint,
  showLabels,
  setShowLabels,
  hoveredInfo,
  readIds,
  fullGraphLoading,
  fullGraphError,
  onRetryFullGraph,
}) => {
  if (!isOpen) return null;

  const isCanvas = host === 'canvas';

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="full"
      showClose={false}
      className="graph-modal-full"
      bodyClassName="graph-modal-body"
    >
      <div className="graph-modal-header">
        <Flex align="center" gap={3} wrap>
          <div>
            <h2 className="graph-modal-title">Full Knowledge Graph</h2>
            <p className="graph-modal-subtitle">
              Drag nodes • Scroll to zoom with Semantic Breakpoint • Hover to focus 1-hop connections • ESC to close
            </p>
          </div>
          <Badge tone="info" className="graph-modal-badge">
            {filteredNodes.length} nodes • {filteredLinks.length} edges
          </Badge>
          {isCanvas && (
            <Badge tone="info" className="graph-modal-engine-badge">
              ⚡ Canvas Engine
            </Badge>
          )}
        </Flex>
        <Flex align="center" gap={2}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
            className="graph-modal-drawer-toggle"
          >
            🎛️ {isDrawerOpen ? 'Hide Controls' : 'Show Controls'}
          </Button>
          <Button variant="danger" size="sm" onClick={onClose} className="graph-modal-close">
            Close (ESC) ✕
          </Button>
        </Flex>
      </div>

      <div className="graph-modal-canvas-area">
        {fullGraphLoading && (
          <p className="graph-data-message" role="status">Loading the full workspace graph…</p>
        )}
        {fullGraphError && (
          <div className="graph-data-message" role="alert">
            <span>{fullGraphError}</span>
            {onRetryFullGraph && <Button variant="secondary" size="sm" onClick={onRetryFullGraph}>Retry</Button>}
          </div>
        )}
        {isCanvas ? (
          <canvas
            ref={hostRef as React.RefObject<HTMLCanvasElement | null>}
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
          <svg ref={hostRef as React.RefObject<SVGSVGElement | null>} width="100%" height="100%" />
        )}

        <GraphToolbar
          isModal={true}
          isDrawerOpen={isDrawerOpen}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFit={onFit}
          onResetZoom={onResetZoom}
          badgeRef={zoomBadgeRef}
        />

        {isDrawerOpen && (
          <div className="graph-controls-card">
            <div className="graph-controls-card-header">
              <span className="graph-controls-card-title">🎛️ Graph Controls</span>
              <button
                className="graph-controls-card-close"
                onClick={() => setIsDrawerOpen(false)}
                title="Close Controls"
                aria-label="Close Controls"
              >
                ✕
              </button>
            </div>
            <div className="graph-controls-card-body">
              <GraphDrawer
                isOpen={isDrawerOpen}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                repulsion={repulsion}
                setRepulsion={setRepulsion}
                gravity={gravity}
                setGravity={setGravity}
                linkDistance={linkDistance}
                setLinkDistance={setLinkDistance}
                collisionPadding={collisionPadding}
                setCollisionPadding={setCollisionPadding}
                onResetPhysics={onResetPhysics}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                hideOrphans={hideOrphans}
                setHideOrphans={setHideOrphans}
                availableTypesWithCounts={availableTypesWithCounts}
                selectedTypes={selectedTypes}
                onToggleType={onToggleType}
                onSelectAllTypes={onSelectAllTypes}
                onClearAllTypes={onClearAllTypes}
                zoomBreakpoint={zoomBreakpoint}
                setZoomBreakpoint={setZoomBreakpoint}
                showLabels={showLabels}
                setShowLabels={setShowLabels}
              />
            </div>
          </div>
        )}

        <GraphTooltip hoveredInfo={hoveredInfo} readIds={readIds} />
      </div>
    </Modal>
  );
};
