import * as d3 from 'd3';
import type { GraphNode, GraphLink } from './constants';
import { ENTITY_META, normalizeEntityType, getNodeRadius as getBaseNodeRadius, getNodeColor as getBaseNodeColor } from './constants';
import { bindLinksToNodes, computeDegrees, createGraphSimulation } from './simulation';

export interface SVGRendererContext {
  svgEl: SVGSVGElement;
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
  isModal: boolean;
  activeNodeId: string | undefined;
  getNodeColor: (d: GraphNode) => string;
  getNodeRadius: (d: GraphNode, deg: number) => number;
  getNodeLabel: (d: GraphNode) => string;
  zoomRef: React.MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
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
  currentKRef: React.MutableRefObject<number>;
}

export function setupSVGEngine(ctx: SVGRendererContext): () => void {
  const {
    svgEl,
    nodes,
    links,
    width,
    height,
    isModal,
    activeNodeId,
    getNodeColor,
    getNodeRadius,
    getNodeLabel,
    zoomRef,
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
    currentKRef,
  } = ctx;

  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();

  if (nodes.length === 0) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '14px')
      .text('No nodes match the selected filters');
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

  const g = svg.append('g');

  // Boundless Zoom with semantic counter-scaling
  let zoomRafId: number | null = null;
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.01, Infinity])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
      const k = event.transform.k;
      currentKRef.current = k;

      const badgeEl = zoomBadgeRef.current;
      if (badgeEl) badgeEl.textContent = `${Math.round(k * 100)}%`;

      if (zoomRafId === null) {
        zoomRafId = requestAnimationFrame(() => {
          zoomRafId = null;
          const currentBp = zoomBreakpointRef.current;
          const counterScale = k > currentBp ? currentBp / k : 1;

          nodeCircles.attr('r', (d) => {
            const deg = nodeDegrees.get(d.id) || 0;
            const baseR = getNodeRadius(d, deg);
            return k > currentBp ? baseR * counterScale : Math.max(2.5 / k, baseR);
          });

          nodeGroup.selectAll('.hub-halo').attr('r', (d: any) => {
            const deg = nodeDegrees.get(d.id) || 0;
            return (getNodeRadius(d, deg) + (d.id === activeNodeId ? 6 : 3.5)) * counterScale;
          });

          nodeLabels
            .attr('font-size', (d) => {
              const deg = nodeDegrees.get(d.id) || 0;
              const baseSize = normalizeEntityType(d) === 'folder' ? 12 : deg >= 3 ? Math.min(13, 10.5 + Math.sqrt(deg) * 0.7) : 10.5;
              return `${baseSize * counterScale}px`;
            })
            .attr('dx', (d) => {
              const deg = nodeDegrees.get(d.id) || 0;
              return (getNodeRadius(d, deg) + 5) * counterScale;
            })
            .attr('dy', 4 * counterScale)
            .style('display', (d) => {
              if (showLabelsRef.current === 'hover') return 'none';
              const deg = nodeDegrees.get(d.id) || 0;
              const isHub = deg >= 3 || normalizeEntityType(d) === 'folder' || d.id === activeNodeId;
              if (k < (isHub ? 0.4 : 0.65) && d.id !== activeNodeId) return 'none';
              return '';
            });
        });
      }
    });

  svg.call(zoom);
  zoomRef.current = zoom;

  // Render Links
  const linkLines = g
    .append('g')
    .selectAll('line')
    .data(linksCopy)
    .enter()
    .append('line')
    .attr('class', 'graph-link-line')
    .attr('stroke', 'rgba(0, 242, 254, 0.35)')
    .attr('stroke-width', 1.2)
    .attr('vector-effect', 'non-scaling-stroke')
    .style('transition', 'stroke 0.2s ease, opacity 0.2s ease');

  // Drag Behavior
  let dragStartX = 0;
  let dragStartY = 0;
  const drag = d3
    .drag<SVGGElement, GraphNode>()
    .on('start', (event, d) => {
      dragStartX = event.x;
      dragStartY = event.y;
      if (!event.active) simulation.alphaTarget(0.15).restart();
      d.fx = d.x;
      d.fy = d.y;
      (simulation as any).pinNode?.(d.id, d.x, d.y);
    })
    .on('drag', (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
      (simulation as any).pinNode?.(d.id, event.x, event.y);
    })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
      (simulation as any).pinNode?.(d.id, null, null);
      if (Math.hypot(event.x - dragStartX, event.y - dragStartY) < 5) {
        handleNodeClickRef.current(d.id, event.sourceEvent);
      }
    });

  // Render Node Groups
  const nodeGroup = g
    .append('g')
    .selectAll('g')
    .data(nodesCopy)
    .enter()
    .append('g')
    .style('cursor', 'pointer')
    .style('transition', 'opacity 0.2s ease')
    .call(drag as any)
    .on('click', (event, d) => handleNodeClickRef.current(d.id, event));

  // Node Circles with degree scaling
  const nodeCircles = nodeGroup
    .append('circle')
    .attr('class', 'node-circle')
    .attr('r', (d) => {
      const deg = nodeDegrees.get(d.id) || 0;
      return getNodeRadius(d, deg);
    })
    .attr('fill', getNodeColor)
    .attr('stroke', (d) => {
      const deg = nodeDegrees.get(d.id) || 0;
      return readIdsRef.current.has(d.id)
        ? '#10b981'
        : d.id === activeNodeId
        ? '#fff'
        : normalizeEntityType(d) === 'folder'
        ? 'var(--accent-cyan-bright)'
        : deg >= 3
        ? '#fff'
        : 'rgba(255, 255, 255, 0.85)';
    })
    .attr('stroke-width', (d) => {
      const deg = nodeDegrees.get(d.id) || 0;
      return readIdsRef.current.has(d.id) ? 2.2 : normalizeEntityType(d) === 'folder' ? 1.8 : deg >= 3 ? 1.5 : 1.0;
    })
    .attr('vector-effect', 'non-scaling-stroke');

  // Hub Outer Halos
  nodeGroup
    .filter((d) => (nodeDegrees.get(d.id) || 0) >= 3 || d.id === activeNodeId)
    .append('circle')
    .attr('class', 'hub-halo')
    .attr('r', (d) => {
      const deg = nodeDegrees.get(d.id) || 0;
      return getNodeRadius(d, deg) + (d.id === activeNodeId ? 4.5 : 2.5);
    })
    .attr('fill', 'none')
    .attr('stroke', (d) => (d.id === activeNodeId ? 'var(--accent-cyan-bright)' : getNodeColor(d)))
    .attr('stroke-width', (d) => (d.id === activeNodeId ? 1.5 : 1.0))
    .attr('stroke-dasharray', (d) => (d.id === activeNodeId ? '3 2' : 'none'))
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('opacity', (d) => (d.id === activeNodeId ? 0.85 : 0.25));

  // Node Text Labels
  const nodeLabels = nodeGroup
    .append('text')
    .attr('class', 'node-label')
    .text(getNodeLabel)
    .attr('font-size', (d) => {
      const deg = nodeDegrees.get(d.id) || 0;
      return normalizeEntityType(d) === 'folder'
        ? '11px'
        : deg >= 3
        ? `${Math.min(12, 9.5 + Math.sqrt(deg) * 0.6)}px`
        : '9.5px';
    })
    .attr('font-weight', (d) => {
      const deg = nodeDegrees.get(d.id) || 0;
      return normalizeEntityType(d) === 'folder' || d.id === activeNodeId || deg >= 3 ? '700' : '500';
    })
    .attr('fill', (d) => {
      const deg = nodeDegrees.get(d.id) || 0;
      return readIdsRef.current.has(d.id)
        ? '#34d399'
        : normalizeEntityType(d) === 'folder'
        ? 'var(--accent-cyan-bright)'
        : deg >= 3
        ? '#ffffff'
        : '#e2e8f0';
    })
    .attr('dx', (d) => {
      const deg = nodeDegrees.get(d.id) || 0;
      return getNodeRadius(d, deg) + 4;
    })
    .attr('dy', 4)
    .style('user-select', 'none')
    .style('pointer-events', 'auto')
    .style('display', (d) => {
      if (showLabelsRef.current === 'hover') return 'none';
      const deg = nodeDegrees.get(d.id) || 0;
      const isHub = deg >= 3 || normalizeEntityType(d) === 'folder' || d.id === activeNodeId;
      if (currentKRef.current < (isHub ? 0.4 : 0.65) && d.id !== activeNodeId) return 'none';
      return '';
    });

  // Interactive 1-Hop Hover Focus
  nodeGroup
    .on('mouseenter', (event, d) => {
      const neighborSet = new Set<string>([d.id]);
      linksCopy.forEach((l) => {
        const s = typeof l.source === 'object' ? l.source.id : (l.source as string);
        const t = typeof l.target === 'object' ? l.target.id : (l.target as string);
        if (s === d.id) neighborSet.add(t);
        if (t === d.id) neighborSet.add(s);
      });

      nodeGroup.style('opacity', (n) => (neighborSet.has(n.id) ? 1 : 0.15));

      linkLines
        .style('opacity', (l) => {
          const s = typeof l.source === 'object' ? l.source.id : (l.source as string);
          const t = typeof l.target === 'object' ? l.target.id : (l.target as string);
          return s === d.id || t === d.id ? 1 : 0.05;
        })
        .attr('stroke', (l) => {
          const s = typeof l.source === 'object' ? l.source.id : (l.source as string);
          const t = typeof l.target === 'object' ? l.target.id : (l.target as string);
          return s === d.id || t === d.id ? 'var(--accent-cyan-bright)' : 'rgba(0, 242, 254, 0.35)';
        })
        .attr('stroke-width', (l) => {
          const s = typeof l.source === 'object' ? l.source.id : (l.source as string);
          const t = typeof l.target === 'object' ? l.target.id : (l.target as string);
          return s === d.id || t === d.id ? 2.0 : 1.2;
        });

      nodeGroup.selectAll('text').style('display', (n: any) => {
        if (neighborSet.has(n.id)) return '';
        if (showLabelsRef.current === 'hover') return 'none';
        const deg = nodeDegrees.get(n.id) || 0;
        const isHub = deg >= 3 || normalizeEntityType(n) === 'folder' || n.id === activeNodeId;
        if (currentKRef.current < (isHub ? 0.4 : 0.65) && n.id !== activeNodeId) return 'none';
        return '';
      });

      hoveredInfoSetter({
        node: d,
        screenX: event.clientX,
        screenY: event.clientY,
        degree: neighborSet.size - 1,
      });
    })
    .on('mouseleave', () => {
      nodeGroup.style('opacity', 1);
      linkLines.style('opacity', 1).attr('stroke', 'rgba(0, 242, 254, 0.35)').attr('stroke-width', 1.2);
      nodeGroup.selectAll('text').style('display', (n: any) => {
        if (showLabelsRef.current === 'hover') return 'none';
        const deg = nodeDegrees.get(n.id) || 0;
        const isHub = deg >= 3 || normalizeEntityType(n) === 'folder' || n.id === activeNodeId;
        if (currentKRef.current < (isHub ? 0.4 : 0.65) && n.id !== activeNodeId) return 'none';
        return '';
      });
      hoveredInfoSetter(null);
    });

  // Simulation RAF Tick
  let tickRafId: number | null = null;
  simulation.on('tick', () => {
    if (tickRafId !== null) return;
    tickRafId = requestAnimationFrame(() => {
      tickRafId = null;
      linkLines
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);
      nodeGroup.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });
  });

  return () => {
    if (tickRafId !== null) cancelAnimationFrame(tickRafId);
    if (zoomRafId !== null) cancelAnimationFrame(zoomRafId);
    simulation.stop();
  };
}