import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import type { GraphNode, GraphLink, GraphViewProps } from './constants';
import { calculateFitTransform } from './simulation';
import { ENTITY_META, normalizeEntityType, getNodeRadius as getBaseNodeRadius, getNodeColor as getBaseNodeColor, getNodeLabel as getBaseNodeLabel } from './constants';
import type { HoveredInfo } from './GraphTooltip';
import { getReadSet } from '../ReadToggle';

export interface GraphEngineHandle {
  widgetRef: React.RefObject<SVGSVGElement | HTMLCanvasElement | null>;
  modalRef: React.RefObject<SVGSVGElement | HTMLCanvasElement | null>;
  widgetZoomBadgeRef: React.RefObject<HTMLSpanElement | HTMLDivElement | null>;
  modalZoomBadgeRef: React.RefObject<HTMLDivElement | null>;
  zoomIn: (isModal: boolean) => void;
  zoomOut: (isModal: boolean) => void;
  fit: (isModal: boolean) => void;
  resetZoom: (isModal: boolean) => void;
  requestRender: (isModal: boolean) => void;
  hoveredInfo: HoveredInfo | null;
  setHoveredInfo: React.Dispatch<React.SetStateAction<HoveredInfo | null>>;
  readIdsRef: React.MutableRefObject<Set<string>>;
  zoomBreakpointRef: React.MutableRefObject<number>;
  showLabelsRef: React.MutableRefObject<'always' | 'hover'>;
  handleNodeClickRef: React.MutableRefObject<(nodeId: string, event?: Event) => void>;
  activeNodeId: string | undefined;
  getNodeColor: (d: GraphNode) => string;
  getNodeRadius: (d: GraphNode, deg: number) => number;
  getNodeLabel: (d: GraphNode) => string;
  widgetWidth: number;
  widgetHeight: number;
  modalWidth: number;
  modalHeight: number;
  isExpanded: boolean;
  setIsExpanded: (val: boolean) => void;
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
  zoomBreakpoint: number;
  setZoomBreakpoint: (val: number) => void;
  showLabels: 'always' | 'hover';
  setShowLabels: (val: 'always' | 'hover') => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  hideOrphans: boolean;
  setHideOrphans: (val: boolean) => void;
  availableTypesWithCounts: Record<string, number>;
  selectedTypes: Set<string>;
  handleToggleType: (typeKey: string) => void;
  handleSelectAllTypes: () => void;
  handleClearAllTypes: () => void;
  handleResetPhysics: () => void;
  modalFilteredNodes: GraphNode[];
  modalFilteredLinks: GraphLink[];
  contextualNodes: GraphNode[];
  contextualLinks: GraphLink[];
  widgetSimulationRef: React.MutableRefObject<d3.Simulation<GraphNode, GraphLink> | null>;
  modalSimulationRef: React.MutableRefObject<d3.Simulation<GraphNode, GraphLink> | null>;
  widgetRenderDataRef: React.MutableRefObject<{ nodes: GraphNode[]; links: GraphLink[]; width: number; height: number }>;
  modalRenderDataRef: React.MutableRefObject<{ nodes: GraphNode[]; links: GraphLink[]; width: number; height: number }>;
  widgetTransformRef: React.MutableRefObject<d3.ZoomTransform>;
  modalTransformRef: React.MutableRefObject<d3.ZoomTransform>;
  widgetZoomRef: React.MutableRefObject<any>;
  modalZoomRef: React.MutableRefObject<any>;
  widgetQuadtreeRef: React.MutableRefObject<d3.Quadtree<GraphNode> | null>;
  modalQuadtreeRef: React.MutableRefObject<d3.Quadtree<GraphNode> | null>;
  hoveredNodeIdRef: React.MutableRefObject<string | null>;
  physicsRef: React.MutableRefObject<{ repulsion: number; gravity: number; linkDistance: number; collisionPadding: number }>;
  widgetRequestRenderRef: React.MutableRefObject<(() => void) | null>;
  modalRequestRenderRef: React.MutableRefObject<(() => void) | null>;
}

export interface UseGraphEngineOptions extends GraphViewProps {
  host: 'svg' | 'canvas';
  widgetWidth?: number;
  widgetHeight?: number;
}

export function useGraphEngine({
  nodes,
  links,
  activeNodeId,
  currentUser,
  onNodeClick,
  host,
  widgetWidth = 280,
  widgetHeight = 240,
}: UseGraphEngineOptions): GraphEngineHandle {
  const [isExpanded, setIsExpanded] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'physics' | 'filters' | 'display'>('physics');
  const [repulsion, setRepulsion] = useState(-200);
  const [gravity, setGravity] = useState(0.05);
  const [linkDistance, setLinkDistance] = useState(70);
  const [collisionPadding, setCollisionPadding] = useState(4);
  const [zoomBreakpoint, setZoomBreakpoint] = useState(1.0);
  const [showLabels, setShowLabels] = useState<'always' | 'hover'>('always');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideOrphans, setHideOrphans] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(() => {
    const all = new Set<string>();
    nodes.forEach((n) => all.add(normalizeEntityType(n)));
    return all;
  });
  const [hoveredInfo, setHoveredInfo] = useState<HoveredInfo | null>(null);

  const availableTypesWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    nodes.forEach((n) => {
      const type = normalizeEntityType(n);
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [nodes]);

  useEffect(() => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      Object.keys(availableTypesWithCounts).forEach((t) => next.add(t));
      return next;
    });
  }, [availableTypesWithCounts]);

  useEffect(() => {
    setReadIds(getReadSet(currentUser));
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string; user?: string; isRead: boolean }>;
      if (!customEvent.detail.user || customEvent.detail.user === (currentUser || 'anonymous')) {
        setReadIds((prev) => {
          const next = new Set(prev);
          if (customEvent.detail.isRead) next.add(customEvent.detail.id);
          else next.delete(customEvent.detail.id);
          return next;
        });
      }
    };
    window.addEventListener('resource-read-status-changed', handleUpdate);
    return () => window.removeEventListener('resource-read-status-changed', handleUpdate);
  }, [currentUser]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    if (isExpanded) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  const { modalFilteredNodes, modalFilteredLinks } = useMemo(() => {
    let nList = nodes.filter((n) => selectedTypes.has(normalizeEntityType(n)));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      nList = nList.filter((n) => n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
    }
    const nodeIds = new Set(nList.map((n) => n.id));
    let lList = links.filter((l) => {
      const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
      const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
      return nodeIds.has(sId) && nodeIds.has(tId);
    });
    if (hideOrphans) {
      const connectedIds = new Set<string>();
      lList.forEach((l) => {
        const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
        const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
        connectedIds.add(sId);
        connectedIds.add(tId);
      });
      nList = nList.filter((n) => connectedIds.has(n.id) || n.id === activeNodeId);
    }
    return { modalFilteredNodes: nList, modalFilteredLinks: lList };
  }, [nodes, links, selectedTypes, searchQuery, hideOrphans, activeNodeId]);

  const contextualNodes = useMemo(() => {
    if (!activeNodeId) return nodes.slice(0, 20);
    const connectedIds = new Set<string>([activeNodeId]);
    links.forEach((l) => {
      const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
      const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
      if (sId === activeNodeId) connectedIds.add(tId);
      if (tId === activeNodeId) connectedIds.add(sId);
    });
    const matched = nodes.filter((n) => connectedIds.has(n.id));
    if (matched.length > 25) {
      const activeItem = matched.find((n) => n.id === activeNodeId);
      const others = matched.filter((n) => n.id !== activeNodeId).slice(0, 24);
      return activeItem ? [activeItem, ...others] : matched.slice(0, 25);
    }
    return matched;
  }, [nodes, links, activeNodeId]);

  const contextualLinks = useMemo(() => {
    const nodeSet = new Set(contextualNodes.map((n) => n.id));
    return links.filter((l) => {
      const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
      const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
      return nodeSet.has(sId) && nodeSet.has(tId);
    });
  }, [links, contextualNodes]);

  const handleNodeClick = useCallback(
    (nodeId: string, event?: Event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (onNodeClick) {
        setIsExpanded(false);
        onNodeClick(nodeId);
      } else {
        const target = nodes.find((n) => n.id === nodeId);
        window.location.href = target?.path || `/?doc=${encodeURIComponent(nodeId)}`;
      }
    },
    [onNodeClick, nodes]
  );

  const handleResetPhysics = useCallback(() => {
    setRepulsion(-200);
    setGravity(0.05);
    setLinkDistance(70);
    setCollisionPadding(4);
    setZoomBreakpoint(1.0);
  }, []);

  const handleToggleType = useCallback((typeKey: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeKey)) next.delete(typeKey);
      else next.add(typeKey);
      return next;
    });
  }, []);

  const handleSelectAllTypes = useCallback(() => {
    setSelectedTypes(new Set(Object.keys(availableTypesWithCounts)));
  }, [availableTypesWithCounts]);

  const handleClearAllTypes = useCallback(() => {
    setSelectedTypes(new Set());
  }, []);

  const widgetRef = useRef<SVGSVGElement | HTMLCanvasElement | null>(null);
  const modalRef = useRef<SVGSVGElement | HTMLCanvasElement | null>(null);

  const widgetZoomRef = useRef<d3.ZoomBehavior<SVGSVGElement | HTMLCanvasElement, unknown> | null>(null);
  const modalZoomRef = useRef<d3.ZoomBehavior<SVGSVGElement | HTMLCanvasElement, unknown> | null>(null);

  const widgetTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const modalTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  const widgetSimulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const modalSimulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  const widgetRenderDataRef = useRef<{ nodes: GraphNode[]; links: GraphLink[]; width: number; height: number }>({
    nodes: [],
    links: [],
    width: 0,
    height: 0,
  });
  const modalRenderDataRef = useRef<{ nodes: GraphNode[]; links: GraphLink[]; width: number; height: number }>({
    nodes: [],
    links: [],
    width: 0,
    height: 0,
  });

  const widgetZoomBadgeRef = useRef<HTMLSpanElement | HTMLDivElement | null>(null);
  const modalZoomBadgeRef = useRef<HTMLDivElement | null>(null);

  const widgetQuadtreeRef = useRef<d3.Quadtree<GraphNode> | null>(null);
  const modalQuadtreeRef = useRef<d3.Quadtree<GraphNode> | null>(null);

  const widgetRequestRenderRef = useRef<(() => void) | null>(null);
  const modalRequestRenderRef = useRef<(() => void) | null>(null);

  const hoveredNodeIdRef = useRef<string | null>(null);

  const physicsRef = useRef({
    repulsion,
    gravity,
    linkDistance,
    collisionPadding,
  });
  physicsRef.current = { repulsion, gravity, linkDistance, collisionPadding };

  const zoomBreakpointRef = useRef(zoomBreakpoint);
  zoomBreakpointRef.current = zoomBreakpoint;

  const showLabelsRef = useRef(showLabels);
  showLabelsRef.current = showLabels;

  const readIdsRef = useRef(readIds);
  readIdsRef.current = readIds;

  const handleNodeClickRef = useRef(handleNodeClick);
  handleNodeClickRef.current = handleNodeClick;

  const getNodeColor = useCallback(
    (d: GraphNode) => getBaseNodeColor(d, activeNodeId),
    [activeNodeId]
  );

  const getNodeRadius = useCallback(
    (d: GraphNode, deg: number = 0) => getBaseNodeRadius(d, activeNodeId, deg),
    [activeNodeId]
  );

  const getNodeLabel = useCallback(
    (d: GraphNode) => getBaseNodeLabel(d, readIdsRef.current),
    []
  );

  const handleFit = useCallback(
    (isModal: boolean) => {
      const el = isModal ? modalRef.current : widgetRef.current;
      const zoomObj = isModal ? modalZoomRef.current : widgetZoomRef.current;
      const data = isModal ? modalRenderDataRef.current : widgetRenderDataRef.current;
      if (!el || !zoomObj || data.nodes.length === 0) return;

      const fit = calculateFitTransform(data.nodes, data.width, data.height);
      if (!fit) return;

      const badgeEl = isModal ? modalZoomBadgeRef.current : widgetZoomBadgeRef.current;
      if (badgeEl) badgeEl.textContent = `${Math.round(fit.scale * 100)}%`;

      const targetTransform = d3.zoomIdentity.translate(fit.translate[0], fit.translate[1]).scale(fit.scale);
      d3.select(el).transition().duration(650).call(zoomObj.transform, targetTransform);
    },
    []
  );

  const handleZoomIn = useCallback((isModal: boolean) => {
    const el = isModal ? modalRef.current : widgetRef.current;
    const zoomObj = isModal ? modalZoomRef.current : widgetZoomRef.current;
    if (el && zoomObj) d3.select(el).transition().duration(250).call(zoomObj.scaleBy, 1.35);
  }, []);

  const handleZoomOut = useCallback((isModal: boolean) => {
    const el = isModal ? modalRef.current : widgetRef.current;
    const zoomObj = isModal ? modalZoomRef.current : widgetZoomRef.current;
    if (el && zoomObj) d3.select(el).transition().duration(250).call(zoomObj.scaleBy, 0.74);
  }, []);

  const handleResetZoom = useCallback((isModal: boolean) => {
    const el = isModal ? modalRef.current : widgetRef.current;
    const zoomObj = isModal ? modalZoomRef.current : widgetZoomRef.current;
    const badgeEl = isModal ? modalZoomBadgeRef.current : widgetZoomBadgeRef.current;
    if (el && zoomObj) {
      d3.select(el).transition().duration(350).call(zoomObj.transform, d3.zoomIdentity);
      if (badgeEl) badgeEl.textContent = '100%';
    }
  }, []);

  const requestRender = useCallback((isModal: boolean) => {
    const req = isModal ? modalRequestRenderRef.current : widgetRequestRenderRef.current;
    if (req) req();
  }, []);

  const modalWidth = typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.95) : 1200;
  const modalHeight = typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.85) : 800;

  return {
    widgetRef,
    modalRef,
    widgetZoomBadgeRef,
    modalZoomBadgeRef,
    zoomIn: handleZoomIn,
    zoomOut: handleZoomOut,
    fit: handleFit,
    resetZoom: handleResetZoom,
    requestRender,
    hoveredInfo,
    setHoveredInfo,
    readIdsRef,
    zoomBreakpointRef,
    showLabelsRef,
    handleNodeClickRef,
    activeNodeId,
    getNodeColor,
    getNodeRadius,
    getNodeLabel,
    widgetWidth,
    widgetHeight,
    modalWidth,
    modalHeight,
    // State for modal UI
    isExpanded,
    setIsExpanded,
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
    zoomBreakpoint,
    setZoomBreakpoint,
    showLabels,
    setShowLabels,
    searchQuery,
    setSearchQuery,
    hideOrphans,
    setHideOrphans,
    availableTypesWithCounts,
    selectedTypes,
    handleToggleType,
    handleSelectAllTypes,
    handleClearAllTypes,
    handleResetPhysics,
    modalFilteredNodes,
    modalFilteredLinks,
    contextualNodes,
    contextualLinks,
    // Simulation & render data refs
    widgetSimulationRef,
    modalSimulationRef,
    widgetRenderDataRef,
    modalRenderDataRef,
    widgetTransformRef,
    modalTransformRef,
    widgetZoomRef,
    modalZoomRef,
    widgetQuadtreeRef,
    modalQuadtreeRef,
    hoveredNodeIdRef,
    physicsRef,
    widgetRequestRenderRef,
    modalRequestRenderRef,
  };
}