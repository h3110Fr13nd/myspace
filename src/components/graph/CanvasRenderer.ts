import * as d3 from 'd3';
import type { GraphNode, GraphLink } from './constants';
import { ENTITY_META, normalizeEntityType, getNodeRadius as getBaseNodeRadius, getNodeColor as getBaseNodeColor } from './constants';
import { bindLinksToNodes, computeDegrees, createGraphSimulation } from './simulation';

export interface CanvasRendererContext {
  canvas: HTMLCanvasElement;
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
  isModal: boolean;
  activeNodeId: string | undefined;
  getNodeColor: (d: GraphNode) => string;
  getNodeRadius: (d: GraphNode, deg: number) => number;
  getNodeLabel: (d: GraphNode) => string;
  transformRef: React.MutableRefObject<d3.ZoomTransform>;
  zoomRef: React.MutableRefObject<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>;
  quadtreeRef: React.MutableRefObject<d3.Quadtree<GraphNode> | null>;
  requestRenderRef: React.MutableRefObject<(() => void) | null>;
  simulationRef: React.MutableRefObject<d3.Simulation<GraphNode, GraphLink> | null>;
  renderDataRef: React.MutableRefObject<{ nodes: GraphNode[]; links: GraphLink[]; width: number; height: number }>;
  hoveredNodeIdRef: React.MutableRefObject<string | null>;
  physicsRef: React.MutableRefObject<{ repulsion: number; gravity: number; linkDistance: number; collisionPadding: number }>;
  zoomBreakpointRef: React.MutableRefObject<number>;
  showLabelsRef: React.MutableRefObject<'always' | 'hover'>;
  readIdsRef: React.MutableRefObject<Set<string>>;
  handleNodeClickRef: React.MutableRefObject<(nodeId: string, event?: Event) => void>;
  hoveredInfoSetter: (info: { node: GraphNode; screenX: number; screenY: number; degree: number } | null) => void;
  zoomBadgeRef: React.MutableRefObject<HTMLDivElement | HTMLSpanElement | null>;
}

export function setupCanvasEngine(ctx: CanvasRendererContext): () => void {
  const {
    canvas,
    nodes,
    links,
    width,
    height,
    isModal,
    activeNodeId,
    getNodeColor,
    getNodeRadius,
    getNodeLabel,
    transformRef,
    zoomRef,
    quadtreeRef,
    requestRenderRef,
    simulationRef,
    renderDataRef,
    hoveredNodeIdRef,
    physicsRef,
    zoomBreakpointRef,
    showLabelsRef,
    readIdsRef,
    handleNodeClickRef,
    hoveredInfoSetter,
    zoomBadgeRef,
  } = ctx;

  const context2d = canvas.getContext('2d');
  if (!context2d) return () => {};

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  if (nodes.length === 0) {
    context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    context2d.clearRect(0, 0, width, height);
    context2d.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    context2d.fillStyle = '#64748b';
    context2d.textAlign = 'center';
    context2d.fillText('No nodes match the selected filters', width / 2, height / 2);
    return () => {};
  }

  const nodesCopy: GraphNode[] = nodes.map((n) => ({ ...n }));
  const linksCopy: GraphLink[] = links.map((l) => ({
    source: typeof l.source === 'object' ? l.source.id : l.source,
    target: typeof l.target === 'object' ? l.target.id : l.target,
  }));

  bindLinksToNodes(nodesCopy, linksCopy);

  renderDataRef.current = { nodes: nodesCopy, links: linksCopy, width, height };

  const nodeDegrees = computeDegrees(nodesCopy, linksCopy);
  const adjacency = new Map<string, Set<string>>();
  nodesCopy.forEach((n) => adjacency.set(n.id, new Set([n.id])));
  linksCopy.forEach((l) => {
    const s = typeof l.source === 'object' ? l.source.id : (l.source as string);
    const t = typeof l.target === 'object' ? l.target.id : (l.target as string);
    if (!adjacency.has(s)) adjacency.set(s, new Set([s]));
    if (!adjacency.has(t)) adjacency.set(t, new Set([t]));
    adjacency.get(s)!.add(t);
    adjacency.get(t)!.add(s);
  });

  const simulation = createGraphSimulation({
    nodes: nodesCopy,
    links: linksCopy,
    width,
    height,
    physics: physicsRef.current,
    activeNodeId,
    nodeDegrees,
    warmupTicks: 12,
  });
  simulationRef.current = simulation;

  const quadtree = d3.quadtree<GraphNode>().x((d) => d.x ?? 0).y((d) => d.y ?? 0).addAll(nodesCopy);
  quadtreeRef.current = quadtree;

  let rafId: number | null = null;
  const render = () => {
    rafId = null;
    const transform = transformRef.current;
    const k = transform.k;
    const currentBp = zoomBreakpointRef.current;
    const counterScale = k > currentBp ? currentBp / k : 1;
    const hId = hoveredNodeIdRef.current;
    const neighborSet = hId ? adjacency.get(hId) || new Set([hId]) : null;

    context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    context2d.clearRect(0, 0, width, height);

    context2d.save();
    context2d.translate(transform.x, transform.y);
    context2d.scale(k, k);

    // 1. Draw Links
    context2d.beginPath();
    context2d.strokeStyle = 'rgba(0, 242, 254, 0.35)';
    context2d.lineWidth = 1.2 / k;
    linksCopy.forEach((l: any) => {
      if (l.source.x === undefined || l.target.x === undefined) return;
      if (neighborSet && neighborSet.has(l.source.id) && neighborSet.has(l.target.id)) return;
      context2d.moveTo(l.source.x, l.source.y);
      context2d.lineTo(l.target.x, l.target.y);
    });
    context2d.globalAlpha = neighborSet ? 0.08 : 1.0;
    context2d.stroke();

    // Highlighted Incident Links
    if (neighborSet && hId) {
      context2d.beginPath();
      context2d.strokeStyle = 'var(--accent-cyan-bright)';
      context2d.lineWidth = 2.0 / k;
      context2d.globalAlpha = 1.0;
      linksCopy.forEach((l: any) => {
        if (l.source.x === undefined || l.target.x === undefined) return;
        if (l.source.id === hId || l.target.id === hId) {
          context2d.moveTo(l.source.x, l.source.y);
          context2d.lineTo(l.target.x, l.target.y);
        }
      });
      context2d.stroke();
    }

    // 2. Draw Nodes & Hub Halos
    nodesCopy.forEach((n: any) => {
      if (n.x === undefined || n.y === undefined) return;
      const isHoveredOrNeighbor = !neighborSet || neighborSet.has(n.id);
      context2d.globalAlpha = isHoveredOrNeighbor ? 1.0 : 0.15;

      const deg = nodeDegrees.get(n.id) || 0;
      const baseR = getNodeRadius(n, deg);
      const r = k > currentBp ? baseR * counterScale : Math.max(2.5 / k, baseR);
      const isFolder = normalizeEntityType(n) === 'folder';
      const isRead = readIdsRef.current.has(n.id);
      const isActive = n.id === activeNodeId;
      const isHub = deg >= 3 || isFolder || isActive;

      // Hub Aura Halo
      if (isHub) {
        context2d.beginPath();
        context2d.arc(n.x, n.y, r + (isActive ? 4.5 : 2.5) * counterScale, 0, Math.PI * 2);
        context2d.strokeStyle = getNodeColor(n);
        context2d.lineWidth = (isActive ? 1.5 : 1.0) / k;
        context2d.globalAlpha = isHoveredOrNeighbor ? (isActive ? 0.85 : 0.35) : 0.08;
        if (isActive) context2d.setLineDash([3 * counterScale, 2 * counterScale]);
        context2d.stroke();
        if (isActive) context2d.setLineDash([]);
        context2d.globalAlpha = isHoveredOrNeighbor ? 1.0 : 0.15;
      }

      // Circle Fill
      context2d.fillStyle = getNodeColor(n);
      context2d.beginPath();
      context2d.arc(n.x, n.y, r, 0, Math.PI * 2);
      context2d.fill();

      // Circle Border
      context2d.strokeStyle = isRead
        ? '#10b981'
        : isActive
        ? '#ffffff'
        : isFolder
        ? 'var(--accent-cyan-bright)'
        : isHub
        ? '#ffffff'
        : 'rgba(255, 255, 255, 0.85)';
      context2d.lineWidth = (isRead ? 2.2 : isFolder ? 1.8 : isHub ? 1.5 : 1.0) / k;
      context2d.stroke();

      // 3. Draw Labels
      const shouldShowLabel =
        showLabelsRef.current === 'always'
          ? isActive || isHoveredOrNeighbor || (isHub ? k >= 0.4 : k >= 0.65)
          : isHoveredOrNeighbor;

      if (shouldShowLabel) {
        const labelText = getNodeLabel(n);
        const fontSize = (isFolder ? 11 : isHub ? Math.min(12, 9.5 + Math.sqrt(deg) * 0.6) : 9.5) * counterScale;
        context2d.font = `${isFolder || isActive || isHub ? '700' : '500'} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        context2d.fillStyle = isRead ? '#34d399' : isFolder ? 'var(--accent-cyan-bright)' : isHub ? '#ffffff' : '#e2e8f0';
        context2d.textAlign = 'left';
        context2d.textBaseline = 'middle';
        context2d.fillText(labelText, n.x + (r + 4) * counterScale, n.y + 1 * counterScale);
      }
    });

    context2d.restore();
  };

  const requestRender = () => {
    if (rafId === null) rafId = requestAnimationFrame(render);
  };
  requestRenderRef.current = requestRender;

  simulation.on('tick', () => {
    const qt = d3.quadtree<GraphNode>().x((d) => d.x ?? 0).y((d) => d.y ?? 0).addAll(nodesCopy);
    quadtreeRef.current = qt;
    requestRender();
  });

  // Boundless Zoom & Pan Setup
  const zoom = d3
    .zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.01, Infinity])
    .filter((event) => {
      // Allow mousedown on empty canvas background (not on a node)
      if (event.type === 'mousedown') {
        const rect = canvas.getBoundingClientRect();
        const [wx, wy] = transformRef.current.invert([event.clientX - rect.left, event.clientY - rect.top]);
        const qt = quadtreeRef.current;
        return !qt?.find(wx, wy, 20 / transformRef.current.k);
      }
      // We handle wheel events manually below for native 2-finger trackpad panning + pinch-to-zoom
      if (event.type === 'wheel') return false;
      return true;
    })
    .on('zoom', (event) => {
      transformRef.current = event.transform;
      if (zoomBadgeRef.current) zoomBadgeRef.current.textContent = `${Math.round(event.transform.k * 100)}%`;
      requestRender();
    });

  d3.select(canvas).call(zoom);
  zoomRef.current = zoom;

  // Trackpad 2-finger swipe up/down zoom, pinch-to-zoom, and mouse wheel handling
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const currentTransform = transformRef.current;

    // 1. Two-finger swipe up/down (or pinch / mouse wheel scroll) -> Zoom in and out anchored at cursor
    if (Math.abs(e.deltaY) > 0 || e.ctrlKey || e.metaKey || e.altKey) {
      // Smooth natural zoom factor
      const zoomIntensity = e.ctrlKey || e.metaKey ? 0.005 : 0.0025;
      const zoomFactor = Math.exp(-e.deltaY * zoomIntensity);
      const newK = Math.max(0.01, currentTransform.k * zoomFactor);

      // Anchor zoom around the mouse/trackpad pointer position
      const newX = mouseX - (mouseX - currentTransform.x) * (newK / currentTransform.k);
      const newY = mouseY - (mouseY - currentTransform.y) * (newK / currentTransform.k);

      // If there's horizontal delta (e.g. slight diagonal swipe), apply subtle horizontal translation
      const deltaXOffset = Math.abs(e.deltaX) > 2 ? -e.deltaX / newK : 0;

      const nextTransform = d3.zoomIdentity.translate(newX + deltaXOffset, newY).scale(newK);
      d3.select(canvas).call(zoom.transform, nextTransform);
      return;
    }

    // 2. Pure horizontal swipe (two-finger sideways)
    if (Math.abs(e.deltaX) > 0) {
      const nextTransform = currentTransform.translate(-e.deltaX / currentTransform.k, 0);
      d3.select(canvas).call(zoom.transform, nextTransform);
    }
  };

  const preventGesture = (e: Event) => e.preventDefault();
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('gesturestart', preventGesture, { passive: false });
  canvas.addEventListener('gesturechange', preventGesture, { passive: false });
  canvas.addEventListener('gestureend', preventGesture, { passive: false });

  // D3 Drag with drag-after-zoom fix
  let dragStartX = 0;
  let dragStartY = 0;

  const drag = d3
    .drag<HTMLCanvasElement, GraphNode>()
    .container(() => canvas)
    .subject((event) => {
      const transform = transformRef.current;
      const [wx, wy] = transform.invert([event.x, event.y]);
      const qt = quadtreeRef.current;
      const hit = qt?.find(wx, wy, 25 / transform.k);
      if (!hit) return null;
      const [sx, sy] = transform.apply([hit.x ?? 0, hit.y ?? 0]);
      return { ...hit, x: sx, y: sy, targetNode: hit } as any;
    })
    .on('start', (event) => {
      const subject = event.subject as any;
      if (!subject?.targetNode) return;
      dragStartX = event.x;
      dragStartY = event.y;
      if (!event.active) simulation.alphaTarget(0.15).restart();
      const transform = transformRef.current;
      const [wx, wy] = transform.invert([event.x, event.y]);
      subject.targetNode.fx = wx;
      subject.targetNode.fy = wy;
      (simulation as any).pinNode?.(subject.targetNode.id, wx, wy);
    })
    .on('drag', (event) => {
      const subject = event.subject as any;
      if (!subject?.targetNode) return;
      const transform = transformRef.current;
      const [wx, wy] = transform.invert([event.x, event.y]);
      subject.targetNode.fx = wx;
      subject.targetNode.fy = wy;
      (simulation as any).pinNode?.(subject.targetNode.id, wx, wy);
      requestRender();
    })
    .on('end', (event) => {
      const subject = event.subject as any;
      if (!subject?.targetNode) return;
      if (!event.active) simulation.alphaTarget(0);
      const target = subject.targetNode;
      target.fx = null;
      target.fy = null;
      (simulation as any).pinNode?.(target.id, null, null);
      if (Math.hypot(event.x - dragStartX, event.y - dragStartY) < 5) {
        handleNodeClickRef.current(target.id);
      }
    });

  d3.select(canvas).call(drag as any);

  // Mouse Hover Hit Testing
  const handleMouseMove = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const transform = transformRef.current;
    const [wx, wy] = transform.invert([event.clientX - rect.left, event.clientY - rect.top]);
    const qt = quadtreeRef.current;
    const hit = qt?.find(wx, wy, 20 / transform.k);

    if (hit) {
      canvas.style.cursor = 'pointer';
      if (hoveredNodeIdRef.current !== hit.id) {
        hoveredNodeIdRef.current = hit.id;
        requestRender();
        hoveredInfoSetter({
          node: hit,
          screenX: event.clientX,
          screenY: event.clientY,
          degree: (adjacency.get(hit.id)?.size || 1) - 1,
        });
      }
    } else {
      canvas.style.cursor = 'grab';
      if (hoveredNodeIdRef.current !== null) {
        hoveredNodeIdRef.current = null;
        requestRender();
        hoveredInfoSetter(null);
      }
    }
  };

  const handleMouseLeave = () => {
    canvas.style.cursor = 'default';
    if (hoveredNodeIdRef.current !== null) {
      hoveredNodeIdRef.current = null;
      requestRender();
      hoveredInfoSetter(null);
    }
  };

  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseleave', handleMouseLeave);
  requestRender();

  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    simulation.stop();
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('gesturestart', preventGesture);
    canvas.removeEventListener('gesturechange', preventGesture);
    canvas.removeEventListener('gestureend', preventGesture);
  };
}