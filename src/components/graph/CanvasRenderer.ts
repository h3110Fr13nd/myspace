import * as d3 from 'd3';
import type { GraphNode, GraphLink } from './constants';
import { ENTITY_META, normalizeEntityType, getNodeRadius as getBaseNodeRadius, getNodeColor as getBaseNodeColor } from './constants';
import { bindLinksToNodes, computeDegrees, createGraphSimulation } from './simulation';
import { frameCanvasOptions, isSoftwareRendering } from '../../lib/viewer/gpuTier';
import { centeredSlot, pairKey, slotsByKey } from '../../lib/viewer/parallel';
import { LabelLayer, type LabelCandidate } from './tiled/labels';

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

  // CPU-backed on software rendering (see lib/viewer/gpuTier): this canvas is
  // redrawn on every simulation tick, and an accelerated canvas there is read
  // back from the GPU process on every frame.
  const context2d = canvas.getContext('2d', frameCanvasOptions());
  // In software rasterisation, a stroke wider than one device pixel goes through
  // Skia's general stroker, which turns the whole (self-intersecting) link path
  // into a polygon fill; a 1-device-pixel stroke takes the hairline fast path.
  // Measured on a settled 1k-node graph: 4x less raster time per frame.
  const hairlineLinks = isSoftwareRendering();
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
    ...(l.label ? { label: l.label } : {}),
  }));
  // Several links between one pair (named relationships) fan out as curves:
  // each gets a bend, measured against the pair's canonical direction so
  // links in opposite directions do not overlap.
  slotsByKey(linksCopy as any[], (l) => pairKey(l.source, l.target)).forEach((slot, i) => {
    const l = linksCopy[i] as any;
    if (!slot || slot.total < 2) return;
    const flip = (l.source as string) < (l.target as string) ? 1 : -1;
    l.bend = centeredSlot(slot.index, slot.total) * 0.35 * flip;
  });
  const hasNamedLinks = linksCopy.some((l) => l.label);
  /** Quadratic control point of a bent link (world coords). */
  const ctrlOf = (l: any) => {
    const dx = l.target.x - l.source.x;
    const dy = l.target.y - l.source.y;
    return { x: (l.source.x + l.target.x) / 2 - dy * l.bend, y: (l.source.y + l.target.y) / 2 + dx * l.bend };
  };

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

  // The hit-test quadtree is rebuilt lazily — on the next pointer query after
  // the simulation moved nodes — instead of on every tick (O(n log n) per tick,
  // ~300 ticks per settle, for a structure only read on pointer events).
  let quadtreeDirty = true;
  const getQuadtree = (): d3.Quadtree<GraphNode> => {
    if (quadtreeDirty || !quadtreeRef.current) {
      quadtreeRef.current = d3.quadtree<GraphNode>().x((d) => d.x ?? 0).y((d) => d.y ?? 0).addAll(nodesCopy);
      quadtreeDirty = false;
    }
    return quadtreeRef.current;
  };
  getQuadtree();

  // Canvas cannot resolve CSS variables; `strokeStyle = 'var(--x)'` is
  // silently ignored. Resolve the tokens once.
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const accentBright = css?.getPropertyValue('--accent-cyan-bright').trim() || '#00f2fe';
  const lightTheme = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
  // Named-relationship labels: readable on either theme.
  const relText = lightTheme ? '#92400e' : 'rgba(253, 224, 71, 1)';
  const relHalo = lightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(8, 12, 24, 0.9)';
  const relLine = lightTheme ? 'rgba(217, 119, 6, 0.7)' : 'rgba(250, 204, 21, 0.75)';
  const labelPalette = {
    text: css?.getPropertyValue('--text-secondary').trim() || '#cbd5e1',
    hub: css?.getPropertyValue('--text-primary').trim() || '#ffffff',
    mine: css?.getPropertyValue('--status-warning').trim() || '#f59e0b',
    halo: css?.getPropertyValue('--bg-primary').trim() || '#0b0f19',
  };
  // Labels go through the same placer as the tiled view: a budget, heaviest
  // first, no overlaps. Drawing every label every tick was the renderer's
  // dominant cost (text is the most expensive thing a 2D canvas draws).
  const labels = new LabelLayer('600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
  let lastInteraction = 0;

  // Per-node values that do not change from frame to frame.
  const count = nodesCopy.length;
  const degreeOf = new Float64Array(count);
  const radiusOf = new Float64Array(count);
  const folderOf = new Uint8Array(count);
  const hubOf = new Uint8Array(count);
  const colorOf: string[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const n = nodesCopy[i];
    const deg = nodeDegrees.get(n.id) || 0;
    degreeOf[i] = deg;
    radiusOf[i] = getNodeRadius(n, deg);
    folderOf[i] = normalizeEntityType(n) === 'folder' ? 1 : 0;
    hubOf[i] = deg >= 3 || folderOf[i] || n.id === activeNodeId ? 1 : 0;
    colorOf[i] = getNodeColor(n);
  }

  let rafId: number | null = null;
  const render = () => {
    rafId = null;
    const transform = transformRef.current;
    const k = transform.k;
    const currentBp = zoomBreakpointRef.current;
    const counterScale = k > currentBp ? currentBp / k : 1;
    const hId = hoveredNodeIdRef.current;
    const neighborSet = hId ? adjacency.get(hId) || new Set([hId]) : null;

    // World rect on screen, padded so labels that start just off-screen and
    // links that cross the view are kept.
    const pad = 160 / k;
    const vx0 = -transform.x / k - pad;
    const vy0 = -transform.y / k - pad;
    const vx1 = (width - transform.x) / k + pad;
    const vy1 = (height - transform.y) / k + pad;
    const inView = (x: number, y: number) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;

    context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    context2d.clearRect(0, 0, width, height);

    context2d.save();
    context2d.translate(transform.x, transform.y);
    context2d.scale(k, k);

    // 1. Draw Links (culled: skip a link whose bounding box misses the view)
    context2d.beginPath();
    context2d.strokeStyle = hairlineLinks ? 'rgba(0, 242, 254, 0.45)' : 'rgba(0, 242, 254, 0.35)';
    context2d.lineWidth = hairlineLinks ? 1 / (k * dpr) : 1.2 / k;
    for (const l of linksCopy as any[]) {
      const sx = l.source.x;
      const tx = l.target.x;
      if (sx === undefined || tx === undefined) continue;
      const sy = l.source.y;
      const ty = l.target.y;
      if ((sx < vx0 && tx < vx0) || (sx > vx1 && tx > vx1) || (sy < vy0 && ty < vy0) || (sy > vy1 && ty > vy1)) continue;
      if (neighborSet && neighborSet.has(l.source.id) && neighborSet.has(l.target.id)) continue;
      if (l.label) continue; // drawn in the named-relationship pass
      context2d.moveTo(sx, sy);
      if (l.bend) {
        const c = ctrlOf(l);
        context2d.quadraticCurveTo(c.x, c.y, tx, ty);
      } else context2d.lineTo(tx, ty);
    }
    context2d.globalAlpha = neighborSet ? 0.08 : 1.0;
    context2d.stroke();

    // Highlighted Incident Links
    if (neighborSet && hId) {
      context2d.beginPath();
      context2d.strokeStyle = accentBright;
      context2d.lineWidth = 2.0 / k;
      context2d.globalAlpha = 1.0;
      for (const l of linksCopy as any[]) {
        if (l.source.x === undefined || l.target.x === undefined) continue;
        if (l.source.id === hId || l.target.id === hId) {
          context2d.moveTo(l.source.x, l.source.y);
          if (l.bend) {
            const c = ctrlOf(l);
            context2d.quadraticCurveTo(c.x, c.y, l.target.x, l.target.y);
          } else context2d.lineTo(l.target.x, l.target.y);
        }
      }
      context2d.stroke();
    }

    // Named relationships: a distinct colour, curved when a pair has several,
    // with the relationship name at the midpoint once zoomed in (or when the
    // link touches the hovered node).
    if (hasNamedLinks) {
      const named: any[] = [];
      context2d.beginPath();
      context2d.strokeStyle = relLine;
      context2d.lineWidth = 1.4 / k;
      for (const l of linksCopy as any[]) {
        if (!l.label || l.source.x === undefined || l.target.x === undefined) continue;
        const { x: sx, y: sy } = l.source;
        const { x: tx, y: ty } = l.target;
        if ((sx < vx0 && tx < vx0) || (sx > vx1 && tx > vx1) || (sy < vy0 && ty < vy0) || (sy > vy1 && ty > vy1)) continue;
        context2d.moveTo(sx, sy);
        if (l.bend) {
          const c = ctrlOf(l);
          context2d.quadraticCurveTo(c.x, c.y, tx, ty);
        } else context2d.lineTo(tx, ty);
        named.push(l);
      }
      context2d.globalAlpha = neighborSet ? 0.5 : 1.0;
      context2d.stroke();
      context2d.globalAlpha = 1.0;
      // Small previews (the sidebar) show names only on hover; the full view
      // once zoomed in.
      const showAll = k >= 0.9 && width >= 600;
      if (named.length && (showAll || hId)) {
        context2d.font = `${11 / k}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        context2d.textAlign = 'center';
        context2d.textBaseline = 'middle';
        context2d.lineWidth = 3 / k;
        context2d.strokeStyle = relHalo;
        context2d.fillStyle = relText;
        for (const l of named) {
          if (!showAll && l.source.id !== hId && l.target.id !== hId) continue;
          // Midpoint of the (possibly curved) link: the quadratic at t = 0.5.
          let mx = (l.source.x + l.target.x) / 2;
          let my = (l.source.y + l.target.y) / 2;
          if (l.bend) {
            const c = ctrlOf(l);
            mx = (mx + c.x) / 2;
            my = (my + c.y) / 2;
          }
          context2d.strokeText(l.label, mx, my);
          context2d.fillText(l.label, mx, my);
        }
      }
    }

    // 2. Draw Nodes & Hub Halos (culled to the view)
    const candidates: LabelCandidate[] = [];
    for (let i = 0; i < count; i++) {
      const n = nodesCopy[i] as any;
      if (n.x === undefined || n.y === undefined || !inView(n.x, n.y)) continue;
      const isHoveredOrNeighbor = !neighborSet || neighborSet.has(n.id);
      context2d.globalAlpha = isHoveredOrNeighbor ? 1.0 : 0.15;

      const deg = degreeOf[i];
      const baseR = radiusOf[i];
      const r = k > currentBp ? baseR * counterScale : Math.max(2.5 / k, baseR);
      const isFolder = folderOf[i] === 1;
      const isRead = readIdsRef.current.has(n.id);
      const isActive = n.id === activeNodeId;
      const isHub = hubOf[i] === 1;
      const color = colorOf[i];

      // Hub Aura Halo
      if (isHub) {
        context2d.beginPath();
        context2d.arc(n.x, n.y, r + (isActive ? 4.5 : 2.5) * counterScale, 0, Math.PI * 2);
        context2d.strokeStyle = color;
        context2d.lineWidth = (isActive ? 1.5 : 1.0) / k;
        context2d.globalAlpha = isHoveredOrNeighbor ? (isActive ? 0.85 : 0.35) : 0.08;
        if (isActive) context2d.setLineDash([3 * counterScale, 2 * counterScale]);
        context2d.stroke();
        if (isActive) context2d.setLineDash([]);
        context2d.globalAlpha = isHoveredOrNeighbor ? 1.0 : 0.15;
      }

      // Circle Fill
      context2d.fillStyle = color;
      context2d.beginPath();
      context2d.arc(n.x, n.y, r, 0, Math.PI * 2);
      context2d.fill();

      // Circle Border
      context2d.strokeStyle = isRead
        ? '#10b981'
        : isActive
        ? '#ffffff'
        : isFolder
        ? accentBright
        : isHub
        ? '#ffffff'
        : 'rgba(255, 255, 255, 0.85)';
      context2d.lineWidth = (isRead ? 2.2 : isFolder ? 1.8 : isHub ? 1.5 : 1.0) / k;
      context2d.stroke();

      // 3. Collect label candidates (placed and drawn after the nodes).
      const shouldShowLabel =
        showLabelsRef.current === 'always'
          ? isActive || (neighborSet ? isHoveredOrNeighbor : false) || (isHub ? k >= 0.4 : k >= 0.65)
          : isHoveredOrNeighbor && neighborSet !== null;

      if (shouldShowLabel) {
        candidates.push({
          sx: n.x * k + transform.x,
          sy: n.y * k + transform.y,
          r: r * k,
          text: getNodeLabel(n),
          priority:
            (isActive ? 4e9 : 0) + (neighborSet && isHoveredOrNeighbor ? 2e9 : 0) + (isFolder || isHub ? 1e9 : 0) + deg,
          hub: isHub || isActive,
          mine: false,
          color: isRead ? '#34d399' : isFolder ? accentBright : undefined,
        });
      }
    }

    context2d.restore();

    // Labels in screen space, within a budget; fewer while the simulation or
    // the camera is moving, all of the budget once things settle.
    const busy = simulation.alpha() > 0.05 || performance.now() - lastInteraction < 200;
    context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    labels.draw(context2d, candidates, { width, height }, busy ? 40 : 150, labelPalette);
    // Once the simulation stops ticking nothing else triggers a frame, so make
    // sure the settled view gets its full label budget.
    if (busy && settleTimer === null) {
      settleTimer = setTimeout(() => {
        settleTimer = null;
        requestRender();
      }, 250);
    }
  };
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const requestRender = () => {
    if (rafId === null) rafId = requestAnimationFrame(render);
  };
  requestRenderRef.current = requestRender;

  simulation.on('tick', () => {
    quadtreeDirty = true;
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
        return !getQuadtree().find(wx, wy, 20 / transformRef.current.k);
      }
      // We handle wheel events manually below for native 2-finger trackpad panning + pinch-to-zoom
      if (event.type === 'wheel') return false;
      return true;
    })
    .on('zoom', (event) => {
      lastInteraction = performance.now();
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
      const hit = getQuadtree().find(wx, wy, 25 / transform.k);
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
    const hit = getQuadtree().find(wx, wy, 20 / transform.k);

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
    if (settleTimer !== null) clearTimeout(settleTimer);
    simulation.stop();
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('gesturestart', preventGesture);
    canvas.removeEventListener('gesturechange', preventGesture);
    canvas.removeEventListener('gestureend', preventGesture);
  };
}