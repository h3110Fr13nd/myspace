/**
 * Canvas core — spatial index for viewport culling.
 *
 * A thin, allocation-light wrapper around RBush. The editor and viewer both need
 * "which nodes can the user currently see", and both need it to be O(log n)
 * rather than O(n) per frame once a board grows past a few hundred nodes.
 */

import RBush from 'rbush';
import type { CanvasNode } from '../types';
import { nodeRect } from './geometry';
import type { Rect } from './transform';
import { inflate, rectIntersects } from './transform';

interface Entry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

export class NodeIndex {
  private tree = new RBush<Entry>();
  private byId = new Map<string, CanvasNode>();
  private all: CanvasNode[] = [];
  /**
   * Nodes not yet indexed. Building is deferred to the first query: hosts
   * create an index per document revision (every drag frame), and most
   * revisions are never queried — building eagerly was an R-tree bulk load of
   * the whole board per frame.
   */
  private pending: readonly CanvasNode[] | null = null;

  constructor(nodes: readonly CanvasNode[] = []) {
    this.build(nodes);
  }

  /** (Re)index `nodes`. Cheap: the work happens on the first query. */
  build(nodes: readonly CanvasNode[]): void {
    this.pending = nodes;
  }

  private ensure(): void {
    const nodes = this.pending;
    if (nodes === null) return;
    this.pending = null;
    this.tree.clear();
    this.byId.clear();
    this.all = nodes.slice();
    if (nodes.length === 0) return;
    const entries: Entry[] = new Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const r = nodeRect(n);
      entries[i] = { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height, id: n.id };
      this.byId.set(n.id, n);
    }
    this.tree.load(entries);
  }

  get size(): number {
    return this.pending ? this.pending.length : this.all.length;
  }

  /** Every indexed node, in insertion order. */
  nodes(): readonly CanvasNode[] {
    this.ensure();
    return this.all;
  }

  get(id: string): CanvasNode | undefined {
    this.ensure();
    return this.byId.get(id);
  }

  has(id: string): boolean {
    this.ensure();
    return this.byId.has(id);
  }

  /** Nodes whose rect intersects `rect`. */
  search(rect: Rect): CanvasNode[] {
    this.ensure();
    if (this.all.length === 0) return [];
    const out: CanvasNode[] = [];
    for (const e of this.tree.search({
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.width,
      maxY: rect.y + rect.height,
    })) {
      const n = this.byId.get(e.id);
      if (n) out.push(n);
    }
    return out;
  }

  /**
   * Nodes intersecting `rect`, padded by `buffer` world units so partially
   * visible content never pops in during a pan.
   */
  searchBuffered(rect: Rect, buffer: number): CanvasNode[] {
    return this.search(inflate(rect, buffer));
  }

  /** First node whose rect contains `p`, topmost-first is caller's concern. */
  hitTest(p: { x: number; y: number }): CanvasNode | null {
    const found = this.search({ x: p.x, y: p.y, width: 0, height: 0 });
    let best: CanvasNode | null = null;
    for (const n of found) {
      const r = nodeRect(n);
      if (p.x < r.x || p.x > r.x + r.width || p.y < r.y || p.y > r.y + r.height) continue;
      // Prefer the smaller node so nested content wins over its group container.
      if (!best || r.width * r.height < nodeRect(best).width * nodeRect(best).height) best = n;
    }
    return best;
  }

  /** Nodes intersecting an inflated rect — used to find connection drop targets. */
  searchTolerant(p: { x: number; y: number }, tolerance: number): CanvasNode[] {
    return this.search({ x: p.x - tolerance, y: p.y - tolerance, width: tolerance * 2, height: tolerance * 2 });
  }

  /** Union of all node rects, or `null` when empty. */
  bounds(): Rect | null {
    this.ensure();
    if (this.all.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.all) {
      const r = nodeRect(n);
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}

/** Narrowing helper used by culling loops. */
export function intersectsRect(a: Rect, b: Rect): boolean {
  return rectIntersects(a, b);
}
