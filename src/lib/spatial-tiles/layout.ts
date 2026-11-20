/**
 * Spatial tiles — scalable graph layout.
 *
 * A force simulation over the whole graph is O(N log N) *per tick* and needs
 * hundreds of ticks; at a million nodes that is minutes of CPU per rebuild and
 * impossible in a browser. This module instead computes positions that are
 * stored once and served as data:
 *
 *  - `structuralLayout` — ~O(N). Uses the containment hierarchy (`parent`) the
 *    workspace already has. Every subtree becomes a disk whose area is
 *    proportional to its size, so density is uniform at every scale: leaf
 *    children fill a golden-angle sunflower around their parent, and larger
 *    subtrees are circle-packed tightly around that sunflower (front-chain
 *    packing, d3.packSiblings). Folders read as visible clusters, there are no
 *    empty rings between them, and the zoomed-out pyramid levels look like the
 *    hierarchy.
 *  - `placeIncremental` — O(new + their links). New items are placed next to
 *    their parent or the centroid of what they link to, and nothing already
 *    placed moves. Tiles that did not gain an item stay byte-identical, so
 *    client and CDN caches survive a content edit.
 *
 * Items whose parent chain loops, or points at an item that does not exist,
 * are treated as roots rather than dropped.
 */

import { packSiblings } from 'd3';

export interface LayoutInput {
  count: number;
  /** Parent item index, or -1 for a root. */
  parent: Int32Array;
  /**
   * Optional undirected adjacency (CSR) used to place parentless items near
   * what they link to. `linkStart` has `count + 1` entries.
   */
  linkStart?: Uint32Array;
  linkTargets?: Uint32Array;
}

export interface LayoutOptions {
  /** Target distance between neighbouring leaves, in world units. */
  spacing?: number;
  /** Gap between sibling subtree disks. */
  gap?: number;
}

export interface LayoutResult {
  x: Float32Array;
  y: Float32Array;
  /** Radius of each item's subtree disk (0 for leaves). */
  radius: Float32Array;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Children lists in CSR form, plus the roots, with parent cycles broken. */
function hierarchy(count: number, parent: Int32Array) {
  const valid = (p: number) => p >= 0 && p < count;
  // Break cycles: walk each chain with a visit stamp; a chain that revisits
  // itself has its entry item promoted to a root.
  const effParent = new Int32Array(count);
  for (let i = 0; i < count; i++) effParent[i] = valid(parent[i]) && parent[i] !== i ? parent[i] : -1;
  const state = new Uint8Array(count); // 0 new, 1 on current path, 2 done
  const path: number[] = [];
  for (let i = 0; i < count; i++) {
    if (state[i] !== 0) continue;
    let v = i;
    while (v >= 0 && state[v] === 0) {
      state[v] = 1;
      path.push(v);
      v = effParent[v];
    }
    if (v >= 0 && state[v] === 1) {
      // `v` closes a loop on the current path: cut it there.
      effParent[v] = -1;
    }
    for (const p of path) state[p] = 2;
    path.length = 0;
  }

  const childCount = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) if (effParent[i] >= 0) childCount[effParent[i] + 1]++;
  for (let i = 0; i < count; i++) childCount[i + 1] += childCount[i];
  const childStart = childCount.slice();
  const children = new Uint32Array(childStart[count]);
  const cursor = childStart.slice(0, count);
  for (let i = 0; i < count; i++) {
    const p = effParent[i];
    if (p >= 0) children[cursor[p]++] = i;
  }
  const roots: number[] = [];
  for (let i = 0; i < count; i++) if (effParent[i] < 0) roots.push(i);
  return { effParent, childStart, children, roots };
}

/** Above this many subtree children, packing falls back to rings (O(n) guaranteed). */
const PACK_LIMIT = 2000;

/**
 * Place `big` child disks (sorted largest first) around a central disk of
 * radius `inner` centred on the parent. Writes each child's offset from the
 * parent into `offX`/`offY` and returns the radius of the whole arrangement,
 * measured from the parent.
 *
 * Front-chain circle packing leaves no empty annuli between clusters; for very
 * large sibling sets it can go quadratic, so beyond PACK_LIMIT children the
 * arrangement uses concentric rings instead.
 */
function arrangeAround(
  inner: number,
  big: number[],
  radius: Float32Array,
  gap: number,
  offX: Float32Array,
  offY: Float32Array
): number {
  if (big.length <= PACK_LIMIT) {
    const circles = [{ r: Math.max(inner, 1e-3), id: -1, x: 0, y: 0 }].concat(
      big.map((id) => ({ r: radius[id] + gap / 2, id, x: 0, y: 0 }))
    );
    packSiblings(circles);
    const cx = circles[0].x;
    const cy = circles[0].y;
    let outer = inner;
    for (let i = 1; i < circles.length; i++) {
      const cc = circles[i];
      const dx = cc.x - cx;
      const dy = cc.y - cy;
      offX[cc.id] = dx;
      offY[cc.id] = dy;
      const reach = Math.hypot(dx, dy) + radius[cc.id];
      if (reach > outer) outer = reach;
    }
    return outer;
  }
  let rho = inner + gap + radius[big[0]];
  let used = 0;
  let ringMax = 0;
  let outer = rho;
  for (const ch of big) {
    const rc = radius[ch];
    let theta = 2 * Math.asin(Math.min(1, (rc + gap / 2) / rho));
    if (used + theta > 2 * Math.PI && used > 0) {
      rho += ringMax + gap + rc;
      used = 0;
      ringMax = 0;
      theta = 2 * Math.asin(Math.min(1, (rc + gap / 2) / rho));
    }
    const a = used + theta / 2;
    offX[ch] = Math.cos(a) * rho;
    offY[ch] = Math.sin(a) * rho;
    used += theta;
    if (rc > ringMax) ringMax = rc;
    outer = rho + ringMax;
  }
  return outer;
}

/**
 * Hierarchical layout, ~O(N). Returns positions centred near the origin.
 */
export function structuralLayout(input: LayoutInput, options: LayoutOptions = {}): LayoutResult {
  const N = input.count;
  const spacing = options.spacing ?? 24;
  const gap = options.gap ?? spacing * 2;
  const { childStart, children, roots } = hierarchy(N, input.parent);

  // Post-order via an explicit stack (trees can be deeper than the JS stack).
  const post: number[] = [];
  {
    const stack: number[] = [];
    const expanded = new Uint8Array(N);
    for (const r of roots) {
      stack.push(r);
      while (stack.length) {
        const v = stack[stack.length - 1];
        if (!expanded[v]) {
          expanded[v] = 1;
          for (let c = childStart[v]; c < childStart[v + 1]; c++) stack.push(children[c]);
        } else {
          stack.pop();
          post.push(v);
        }
      }
    }
  }

  // Sunflower radius for k leaves: point k sits at c * sqrt(k), so the disk of
  // k points has radius ~ c * sqrt(k). c chosen so neighbours are ~spacing apart.
  const c = spacing * 0.56;
  const sunflowerRadius = (k: number) => (k <= 0 ? 0 : c * Math.sqrt(k) + spacing * 0.5);

  const radius = new Float32Array(N);
  // Per item, offset of a non-leaf child from its parent, filled bottom-up so
  // the placement pass is pure addition.
  const offX = new Float32Array(N);
  const offY = new Float32Array(N);

  const bigScratch: number[] = [];
  for (const v of post) {
    let leaves = 0;
    bigScratch.length = 0;
    for (let ci = childStart[v]; ci < childStart[v + 1]; ci++) {
      const ch = children[ci];
      if (childStart[ch + 1] === childStart[ch]) leaves++;
      else bigScratch.push(ch);
    }
    const inner = Math.max(sunflowerRadius(leaves), spacing * 0.75);
    if (bigScratch.length === 0) {
      radius[v] = leaves > 0 ? inner : 0;
      continue;
    }
    bigScratch.sort((a, b) => radius[b] - radius[a]);
    radius[v] = arrangeAround(inner, bigScratch, radius, gap, offX, offY);
  }

  // Roots behave like the children of one virtual centre.
  const x = new Float32Array(N);
  const y = new Float32Array(N);
  {
    const leafRoots: number[] = [];
    const bigRoots: number[] = [];
    for (const r of roots) (childStart[r + 1] === childStart[r] ? leafRoots : bigRoots).push(r);
    leafRoots.forEach((r, k) => {
      const rr = c * Math.sqrt(k + 0.5);
      x[r] = Math.cos(k * GOLDEN_ANGLE) * rr;
      y[r] = Math.sin(k * GOLDEN_ANGLE) * rr;
    });
    if (bigRoots.length) {
      bigRoots.sort((a, b) => radius[b] - radius[a]);
      const inner = leafRoots.length ? sunflowerRadius(leafRoots.length) : 0;
      arrangeAround(inner, bigRoots, radius, gap, offX, offY);
      for (const r of bigRoots) {
        x[r] = offX[r];
        y[r] = offY[r];
      }
    }
  }

  // Pre-order placement of children relative to their parent.
  for (let p = post.length - 1; p >= 0; p--) {
    const v = post[p];
    let k = 0;
    // Rotate each parent's sunflower by a hash of its index so sibling
    // clusters do not all share the same visual "seam".
    const twist = ((v * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
    for (let ci = childStart[v]; ci < childStart[v + 1]; ci++) {
      const ch = children[ci];
      if (childStart[ch + 1] === childStart[ch]) {
        const rr = c * Math.sqrt(k + 0.5) + spacing * 0.5;
        const a = k * GOLDEN_ANGLE + twist;
        x[ch] = x[v] + Math.cos(a) * rr;
        y[ch] = y[v] + Math.sin(a) * rr;
        k++;
      } else {
        // Rotate the packed arrangement by the same twist as the sunflower.
        const cos = Math.cos(twist);
        const sin = Math.sin(twist);
        x[ch] = x[v] + offX[ch] * cos - offY[ch] * sin;
        y[ch] = y[v] + offX[ch] * sin + offY[ch] * cos;
      }
    }
  }

  // Parentless singletons that link somewhere: move them beside the centroid of
  // their placed neighbours, so an orphan note sits next to what it cites
  // instead of in an unrelated central cloud.
  if (input.linkStart && input.linkTargets) {
    for (const r of roots) {
      if (childStart[r + 1] !== childStart[r]) continue;
      const a = input.linkStart[r];
      const b = input.linkStart[r + 1];
      if (b === a) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let e = a; e < b; e++) {
        const t = input.linkTargets[e];
        if (t === r) continue;
        sx += x[t];
        sy += y[t];
        n++;
      }
      if (n === 0) continue;
      const jitter = ((r * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
      x[r] = sx / n + Math.cos(jitter) * spacing * 1.5;
      y[r] = sy / n + Math.sin(jitter) * spacing * 1.5;
    }
  }

  return { x, y, radius };
}

export interface IncrementalInput extends LayoutInput {
  /** Current positions; NaN marks an item that still needs placing. */
  x: Float32Array;
  y: Float32Array;
}

/**
 * Place only the items whose position is NaN, leaving every placed item where
 * it is. Items are placed in dependency order (a new child of a new folder
 * waits for its folder), next to their parent when it has one, else beside the
 * centroid of their placed link neighbours, else on a spiral around the origin.
 *
 * Returns the indices that were placed.
 */
export function placeIncremental(input: IncrementalInput, options: LayoutOptions = {}): number[] {
  const N = input.count;
  const spacing = options.spacing ?? 24;
  const c = spacing * 0.56;
  const { x, y } = input;
  const { effParent } = hierarchy(N, input.parent);

  // How many children each parent already has placed, so a new child takes the
  // next free sunflower slot instead of landing on an existing sibling.
  const slot = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    const p = effParent[i];
    if (p >= 0 && !Number.isNaN(x[i])) slot[p]++;
  }

  const pending: number[] = [];
  for (let i = 0; i < N; i++) if (Number.isNaN(x[i]) || Number.isNaN(y[i])) pending.push(i);
  const placed: number[] = [];
  let originSlot = 0;

  // Repeat passes until no progress; each pass places everything whose anchor
  // is now known. Depth of new chains bounds the number of passes.
  let remaining = pending;
  while (remaining.length) {
    const next: number[] = [];
    for (const i of remaining) {
      const p = effParent[i];
      if (p >= 0) {
        if (Number.isNaN(x[p])) {
          next.push(i);
          continue;
        }
        const k = slot[p]++;
        const rr = c * Math.sqrt(k + 0.5) + spacing * 0.5;
        const a = k * GOLDEN_ANGLE;
        x[i] = x[p] + Math.cos(a) * rr;
        y[i] = y[p] + Math.sin(a) * rr;
        placed.push(i);
        continue;
      }
      let sx = 0;
      let sy = 0;
      let n = 0;
      if (input.linkStart && input.linkTargets) {
        for (let e = input.linkStart[i]; e < input.linkStart[i + 1]; e++) {
          const t = input.linkTargets[e];
          if (t === i || Number.isNaN(x[t])) continue;
          sx += x[t];
          sy += y[t];
          n++;
        }
      }
      if (n > 0) {
        const jitter = ((i * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
        x[i] = sx / n + Math.cos(jitter) * spacing * 1.5;
        y[i] = sy / n + Math.sin(jitter) * spacing * 1.5;
      } else {
        const k = originSlot++;
        const rr = c * Math.sqrt(k + 0.5);
        x[i] = Math.cos(k * GOLDEN_ANGLE) * rr;
        y[i] = Math.sin(k * GOLDEN_ANGLE) * rr;
      }
      placed.push(i);
    }
    if (next.length === remaining.length) {
      // Only unreachable anchors remain (parent itself unplaceable): put them at
      // the origin spiral so the loop terminates.
      for (const i of next) {
        const k = originSlot++;
        const rr = c * Math.sqrt(k + 0.5);
        x[i] = Math.cos(k * GOLDEN_ANGLE) * rr;
        y[i] = Math.sin(k * GOLDEN_ANGLE) * rr;
        placed.push(i);
      }
      break;
    }
    remaining = next;
  }
  return placed;
}

/** Build an undirected CSR adjacency from an edge list, for layout input. */
export function adjacencyCSR(count: number, src: Uint32Array, dst: Uint32Array, m = src.length) {
  const deg = new Uint32Array(count + 1);
  for (let e = 0; e < m; e++) {
    deg[src[e] + 1]++;
    deg[dst[e] + 1]++;
  }
  for (let i = 0; i < count; i++) deg[i + 1] += deg[i];
  const linkStart = deg.slice();
  const linkTargets = new Uint32Array(linkStart[count]);
  const cursor = linkStart.slice(0, count);
  for (let e = 0; e < m; e++) {
    linkTargets[cursor[src[e]]++] = dst[e];
    linkTargets[cursor[dst[e]]++] = src[e];
  }
  return { linkStart, linkTargets };
}
