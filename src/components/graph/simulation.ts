import * as d3 from 'd3';
import type { GraphNode, GraphLink } from './constants';
import { getNodeRadius } from './constants';

export interface PhysicsParams {
  repulsion: number;
  gravity: number;
  linkDistance: number;
  collisionPadding: number;
}

/**
 * Rebinds link source/target endpoints to their live node objects.
 * The worker-backed simulation never runs d3.forceLink on the main thread,
 * so links keep plain id strings that renderers can't read coordinates from.
 */
export function bindLinksToNodes(nodes: GraphNode[], links: GraphLink[]): void {
  const byId = new Map<string, GraphNode>();
  nodes.forEach((n) => byId.set(n.id, n));
  links.forEach((l) => {
    const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string);
    const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string);
    const sn = byId.get(sId);
    const tn = byId.get(tId);
    if (sn) (l as any).source = sn;
    if (tn) (l as any).target = tn;
  });
}

/**
 * Pre-computes degree (connection count) for all nodes in O(E + V) time.
 */
export function computeDegrees(nodes: GraphNode[], links: GraphLink[]): Map<string, number> {
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

/**
 * Calculates zoom transform to fit graph nodes centered in the given viewport.
 */
export function calculateFitTransform(
  nodes: GraphNode[],
  width: number,
  height: number,
  paddingPercent: number = 0.82
): { scale: number; translate: [number, number] } | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  nodes.forEach((n) => {
    if (n.x !== undefined) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
    }
    if (n.y !== undefined) {
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
  });

  if (!isFinite(minX) || !isFinite(maxX)) return null;

  const dx = Math.max(20, maxX - minX);
  const dy = Math.max(20, maxY - minY);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const scale = Math.max(0.05, Math.min(3.0, paddingPercent / Math.max(dx / width, dy / height)));
  const translate: [number, number] = [width / 2 - scale * midX, height / 2 - scale * midY];

  return { scale, translate };
}

export interface SimulationConfig {
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
  physics: PhysicsParams;
  activeNodeId?: string;
  nodeDegrees: Map<string, number>;
  warmupTicks?: number;
  useWorker?: boolean;
}

/**
 * Worker-backed simulation controller providing identical interface to d3.Simulation
 * for rendering engines while keeping heavy numerical integration off the main thread.
 */
export class WorkerSimulationController {
  public isWorker = true;
  private worker: Worker | null = null;
  private listeners = new Map<string, Set<Function>>();
  private nodes: GraphNode[];
  private _alpha = 1;
  private _alphaTarget = 0;

  constructor(worker: Worker, nodes: GraphNode[]) {
    this.worker = worker;
    this.nodes = nodes;

    this.worker.onmessage = (e: MessageEvent) => {
      const { type, coords, alpha } = e.data;
      if (type === 'TICK' && coords) {
        this._alpha = alpha ?? 0;
        const count = this.nodes.length;
        const arr = coords instanceof Float32Array ? coords : new Float32Array(coords);
        for (let i = 0; i < count; i++) {
          this.nodes[i].x = arr[i * 2];
          this.nodes[i].y = arr[i * 2 + 1];
        }
        this.emit('tick');
      } else if (type === 'END') {
        this._alpha = 0;
        this.emit('end');
      }
    };

    this.worker.onerror = (err) => {
      console.warn('[WorkerSimulation] Web Worker error, stopping worker:', err);
    };
  }

  on(event: string, listener?: Function): any {
    if (!listener) return this.listeners.get(event);
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  private emit(event: string): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.error('[WorkerSimulation] Listener error:', e);
        }
      });
    }
  }

  alpha(val?: number): any {
    if (val === undefined) return this._alpha;
    this._alpha = val;
    this.worker?.postMessage({ type: 'RESTART', payload: { alpha: val } });
    return this;
  }

  alphaTarget(val?: number): any {
    if (val === undefined) return this._alphaTarget;
    this._alphaTarget = val;
    this.worker?.postMessage({ type: 'ALPHA_TARGET', payload: { value: val, restart: val > 0 } });
    return this;
  }

  restart(): this {
    this.worker?.postMessage({ type: 'RESTART', payload: { alpha: 0.2 } });
    return this;
  }

  stop(): this {
    if (this.worker) {
      this.worker.postMessage({ type: 'STOP' });
      this.worker.terminate();
      this.worker = null;
    }
    this.listeners.clear();
    return this;
  }

  tick(): void {
    // Handled in worker
  }

  pinNode(nodeId: string, fx: number | null, fy: number | null): void {
    this.worker?.postMessage({
      type: 'PIN_NODE',
      payload: { nodeId, fx, fy },
    });
  }

  updatePhysics(
    width: number,
    height: number,
    physics: PhysicsParams,
    activeNodeId?: string,
    links?: GraphLink[]
  ): void {
    this.worker?.postMessage({
      type: 'UPDATE_PHYSICS',
      payload: {
        width,
        height,
        physics,
        activeNodeId,
        links: links?.map((l) => ({
          source: typeof l.source === 'object' ? (l.source as any).id : l.source,
          target: typeof l.target === 'object' ? (l.target as any).id : l.target,
        })),
      },
    });
  }
}

/**
 * Creates a D3 force simulation engineered for organic, springy graph clustering.
 * Automatically offloads computation to a Web Worker for larger node sets (>= 80 nodes)
 * with zero-copy Float32Array coordinate streaming, while gracefully falling back to
 * the main thread for small graphs or environments without Web Worker support.
 */
export function createGraphSimulation(config: SimulationConfig): d3.Simulation<GraphNode, GraphLink> {
  const { nodes, links, width, height, physics, activeNodeId, nodeDegrees, warmupTicks = 12, useWorker } = config;

  // Adaptive threshold: graphs with >= 80 nodes benefit from worker offloading to protect 60fps render budget
  const shouldTryWorker =
    useWorker ??
    (typeof window !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      nodes.length >= 80);

  if (shouldTryWorker) {
    try {
      const worker = new Worker(new URL('./graphSimulation.worker.ts', import.meta.url), {
        type: 'module',
      });

      const workerController = new WorkerSimulationController(worker, nodes);

      worker.postMessage({
        type: 'INIT',
        payload: {
          nodes: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, fx: n.fx, fy: n.fy })),
          links: links.map((l) => ({
            source: typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string),
            target: typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string),
          })),
          width,
          height,
          physics,
          activeNodeId,
          warmupTicks,
        },
      });

      return workerController as unknown as d3.Simulation<GraphNode, GraphLink>;
    } catch (workerErr) {
      console.warn('[Simulation] Web Worker setup skipped or failed, falling back to main-thread D3:', workerErr);
    }
  }

  // Main-thread D3 fallback
  const simulation = d3
    .forceSimulation<GraphNode>(nodes)
    .velocityDecay(0.42) // Natural springy fluidity
    .alphaDecay(0.025)   // Smooth and graceful settling
    .alphaMin(0.001)     // Enters 0% CPU sleep once settled
    .force(
      'link',
      d3
        .forceLink<GraphNode, GraphLink>(links)
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

  // Soft in-memory pre-warming to avoid frame-0 explosion while preserving animated entry
  for (let i = 0; i < warmupTicks; ++i) {
    simulation.tick();
  }

  return simulation;
}

/**
 * Updates physics parameters of an active simulation in-place without rebuilding.
 * Gracefully branches between Worker-backed simulation controller and native D3 instance.
 */
export function updateSimulationPhysics(
  sim: d3.Simulation<GraphNode, GraphLink>,
  width: number,
  height: number,
  physics: PhysicsParams,
  activeNodeId?: string,
  links: GraphLink[] = []
): void {
  if (!sim) return;

  const maybeWorker = sim as unknown as { isWorker?: boolean; updatePhysics?: Function };
  if (maybeWorker.isWorker && typeof maybeWorker.updatePhysics === 'function') {
    maybeWorker.updatePhysics(width, height, physics, activeNodeId, links);
    return;
  }

  const degMap = new Map<string, number>();
  links.forEach((l) => {
    const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string);
    const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string);
    degMap.set(sId, (degMap.get(sId) || 0) + 1);
    degMap.set(tId, (degMap.get(tId) || 0) + 1);
  });

  sim.force(
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

  sim.force('radial', d3.forceRadial(0, width / 2, height / 2).strength(physics.gravity * 0.45));

  const linkForce = sim.force('link') as d3.ForceLink<GraphNode, GraphLink> | undefined;
  if (linkForce) {
    linkForce.distance((l) => {
      const sId = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string);
      const tId = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string);
      const maxDeg = Math.max(degMap.get(sId) || 0, degMap.get(tId) || 0);
      return physics.linkDistance + Math.min(30, maxDeg * 2);
    });
  }

  sim.force(
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

  sim.alpha(0.2).restart();
}
