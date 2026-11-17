import * as d3 from 'd3';
import type { GraphNode, GraphLink } from './constants';
import { getNodeRadius } from './constants';
import type { PhysicsParams } from './simulation';

interface WorkerInitPayload {
  nodes: Array<{ id: string; x?: number; y?: number; fx?: number | null; fy?: number | null }>;
  links: Array<{ source: string; target: string }>;
  width: number;
  height: number;
  physics: PhysicsParams;
  activeNodeId?: string;
  warmupTicks?: number;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: any, transfer?: Transferable[]) => void;
};

let simulation: d3.Simulation<GraphNode, GraphLink> | null = null;
let nodeMap = new Map<string, GraphNode>();
let orderedNodes: GraphNode[] = [];
let linksList: GraphLink[] = [];
let isRunning = false;

function buildDegrees(nodes: GraphNode[], links: GraphLink[]): Map<string, number> {
  const degrees = new Map<string, number>();
  nodes.forEach((n) => degrees.set(n.id, 0));
  links.forEach((l) => {
    const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string);
    const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string);
    degrees.set(sId, (degrees.get(sId) || 0) + 1);
    degrees.set(tId, (degrees.get(tId) || 0) + 1);
  });
  return degrees;
}

ctx.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT': {
      if (simulation) {
        simulation.stop();
        simulation = null;
      }

      const { nodes, links, width, height, physics, activeNodeId, warmupTicks = 12 } = payload as WorkerInitPayload;

      orderedNodes = nodes.map((n) => ({ ...n } as GraphNode));
      nodeMap = new Map();
      orderedNodes.forEach((n) => nodeMap.set(n.id, n));

      linksList = links.map((l) => ({
        source: l.source,
        target: l.target,
      }));

      const nodeDegrees = buildDegrees(orderedNodes, linksList);

      simulation = d3
        .forceSimulation<GraphNode>(orderedNodes)
        .velocityDecay(0.42)
        .alphaDecay(0.025)
        .alphaMin(0.001)
        .force(
          'link',
          d3
            .forceLink<GraphNode, GraphLink>(linksList)
            .id((d) => d.id)
            .distance((l) => {
              const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string);
              const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string);
              const maxDeg = Math.max(nodeDegrees.get(sId) || 0, nodeDegrees.get(tId) || 0);
              return physics.linkDistance + Math.min(30, maxDeg * 2);
            })
        )
        .force(
          'charge',
          d3
            .forceManyBody<GraphNode>()
            .strength((d) => {
              const deg = nodeDegrees.get(d.id) || 0;
              return physics.repulsion * (1 + Math.min(2.0, Math.sqrt(deg) * 0.35));
            })
            .distanceMax(800)
            .distanceMin(15)
        )
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.8))
        .force('radial', d3.forceRadial(0, width / 2, height / 2).strength(physics.gravity * 0.45))
        .force(
          'collision',
          d3
            .forceCollide<GraphNode>()
            .radius((d) => {
              const deg = nodeDegrees.get(d.id) || 0;
              return getNodeRadius(d, activeNodeId, deg) + physics.collisionPadding;
            })
            .strength(0.75)
            .iterations(1)
        );

      // Pre-warm ticks
      for (let i = 0; i < warmupTicks; ++i) {
        simulation.tick();
      }

      isRunning = true;

      simulation.on('tick', () => {
        const count = orderedNodes.length;
        const coords = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
          coords[i * 2] = orderedNodes[i].x ?? 0;
          coords[i * 2 + 1] = orderedNodes[i].y ?? 0;
        }

        ctx.postMessage(
          {
            type: 'TICK',
            coords,
            alpha: simulation?.alpha() ?? 0,
          },
          [coords.buffer]
        );
      });

      simulation.on('end', () => {
        isRunning = false;
        ctx.postMessage({ type: 'END' });
      });

      // Send initial warmed-up positions immediately
      const initialCoords = new Float32Array(orderedNodes.length * 2);
      for (let i = 0; i < orderedNodes.length; i++) {
        initialCoords[i * 2] = orderedNodes[i].x ?? 0;
        initialCoords[i * 2 + 1] = orderedNodes[i].y ?? 0;
      }
      ctx.postMessage(
        {
          type: 'TICK',
          coords: initialCoords,
          alpha: simulation.alpha(),
        },
        [initialCoords.buffer]
      );

      break;
    }

    case 'PIN_NODE': {
      const { nodeId, fx, fy } = payload;
      const target = nodeMap.get(nodeId);
      if (target) {
        target.fx = fx;
        target.fy = fy;
      }
      break;
    }

    case 'ALPHA_TARGET': {
      const { value, restart } = payload;
      if (simulation) {
        simulation.alphaTarget(value);
        if (restart) simulation.restart();
      }
      break;
    }

    case 'RESTART': {
      const { alpha = 0.2 } = payload || {};
      if (simulation) {
        simulation.alpha(alpha).restart();
      }
      break;
    }

    case 'UPDATE_PHYSICS': {
      if (!simulation) break;
      const { width, height, physics, activeNodeId, links } = payload;

      const activeLinks = links && links.length > 0 ? links : linksList;
      const degMap = buildDegrees(orderedNodes, activeLinks);

      simulation.force(
        'charge',
        d3
          .forceManyBody<GraphNode>()
          .strength((d) => {
            const deg = degMap.get(d.id) || 0;
            return physics.repulsion * (1 + Math.min(2.0, Math.sqrt(deg) * 0.35));
          })
          .distanceMax(800)
          .distanceMin(15)
      );

      simulation.force('radial', d3.forceRadial(0, width / 2, height / 2).strength(physics.gravity * 0.45));

      const linkForce = simulation.force('link') as d3.ForceLink<GraphNode, GraphLink> | undefined;
      if (linkForce) {
        linkForce.distance((l) => {
          const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string);
          const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string);
          const maxDeg = Math.max(degMap.get(sId) || 0, degMap.get(tId) || 0);
          return physics.linkDistance + Math.min(30, maxDeg * 2);
        });
      }

      simulation.force(
        'collision',
        d3
          .forceCollide<GraphNode>()
          .radius((d) => {
            const deg = degMap.get(d.id) || 0;
            return getNodeRadius(d, activeNodeId, deg) + physics.collisionPadding;
          })
          .strength(0.75)
          .iterations(1)
      );

      simulation.alpha(0.2).restart();
      break;
    }

    case 'STOP': {
      if (simulation) {
        simulation.stop();
      }
      isRunning = false;
      break;
    }
  }
};
