# Architectural Blueprint: Massive Scale (100,000+ Nodes) Knowledge Graph Engine

> **Status (2026-11-17): implemented in a different form — see
> [`docs/perf/SCALING.md`](../../docs/perf/SCALING.md).** Instead of streaming
> the whole graph as binary buffers and simulating it in the browser, positions
> are precomputed server-side (incremental, O(N)) and served as a level-of-detail
> tile pyramid; the browser draws only the tiles on screen (WebGL2, Canvas2D on
> software GPUs). Measured at 1M resources: ~0.85 ms server CPU per tile
> request (~1,100 tiles/s from one process), ~15 KB for the first view and
> ~45 KB per detail view. No new dependency or service (no PixiJS,
> Arrow or Cosmograph). Open items are listed under "Limits and next steps" there.

## Executive Summary
This document defines the architectural blueprint, memory models, rendering pipelines, and evolutionary roadmap for rendering **1 lakh+ (100,000+) to 1,000,000+ interactive nodes** in the FOSS Content Workspace.

---

## 1. Why Standard Architectures Fail at 100k Scale

| Layer | Traditional Paradigm (SVG / DOM) | Point of Failure at 100,000 Nodes |
|---|---|---|
| **DOM Tree** | SVG element per node (`<circle>`, `<line>`, `<text>`) | 100k nodes + 250k links = 350k DOM nodes. Browser layout tree, CSS style recalculations, and paint passes drop frame rates to **< 1 FPS** and consume >2 GB RAM. |
| **Physics Simulation** | Single-threaded JavaScript CPU loop ($O(N^2)$ or $O(N \log N)$) | Pairwise repulsion for 100k nodes is $\approx 5 \times 10^9$ operations per tick. Even with Barnes-Hut quadtrees, a single CPU physics tick takes 300ms–800ms, completely freezing the UI. |
| **V8 Heap & Garbage Collection** | JavaScript object references (`{ id, x, y, vx, vy, ... }`) | Allocating and iterating 100k objects triggers massive V8 Garbage Collection (GC) pauses every few seconds (jank). |
| **Perceptual Screen Density** | 1:1 Rendering of all nodes | A 1080p display has only 2,073,600 pixels. 100,000 nodes means dozens of nodes collide onto the exact same sub-pixel, creating an unreadable solid smudge. |

---

## 2. The 4 Engineering Pillars for 100,000+ Nodes

```
                               ┌────────────────────────────────────────────────────────┐
                               │                 BROWSER CLIENT (60 FPS)                │
                               ├───────────────────────────────────┬────────────────────┤
                               │         WebGL / WebGPU            │  Interactive DOM   │
                               │        Instanced Shaders          │     HTML/Canvas    │
┌────────────────────────┐     │  ┌─────────────────────────────┐  │  ┌──────────────┐  │
│  Binary Graph Stream   │────▶│  │  100,000 Quads / Points     │  │  │ Active Node  │  │
│  (Float32Array Buffers │     │  │  (Single GPU Draw Call)     │  │  │ 1-Hop Labels │  │
│   via Apache Arrow)    │     │  └─────────────────────────────┘  │  │ Focus Card   │  │
└────────────────────────┘     │                 ▲                 │  └──────────────┘  │
                               │                 │ (Zero-Copy)     │         ▲          │
                               │  ┌─────────────────────────────┐  │         │ (Pixel)  │
                               │  │ GPU Compute Shader / Worker │──┼─────────┴──────────┘
                               │  │ Barnes-Hut / Spatial Grid   │  │ Offscreen Color
                               │  └─────────────────────────────┘  │ Hit-Testing FBO
                               └───────────────────────────────────┴────────────────────┘
```

### Pillar 1: Instanced WebGL / WebGPU Rendering (Single Draw Call)
- **Instanced Drawing**: Geometry for a circle quad is uploaded to the GPU once. The GPU's vertex shader consumes packed `Float32Array` buffers containing `(x, y, radius, color)` and draws all 100,000 nodes in **a single draw call** (`gl.drawArraysInstanced` or `gl.drawElementsInstanced`).
- **Indexed Link Buffers**: Links are rendered as line primitives or thin textured quads directly on the GPU.
- **Result**: Native 60 FPS – 120 FPS camera panning and boundless zooming.

### Pillar 2: GPU-Resident Simulation or Precomputed Server Layouts
At 100,000 nodes, force calculations cannot run sequentially on the CPU:
1. **GPU Compute Shaders (WebGPU)**:
   - Modern engines like **Cosmograph** and **GraphWaGu** write the Barnes-Hut quadtree and N-body forces in **WGSL (WebGPU Shading Language)** compute shaders.
   - Thousands of GPU cores compute node positions in parallel.
   - **Zero-Copy Memory**: Node coordinates remain in GPU VRAM buffer between the physics step and the render step, eliminating CPU-GPU memory bus transfers.
2. **Server-Side / Native Offline Layouts (Gephi / Graphistry approach)**:
   - For static or semi-static enterprise knowledge graphs, physics is precomputed on the server using C++/CUDA/OpenMP (e.g. ForceAtlas2 or UMAP) in 2 seconds.
   - The server emits `x, y` coordinate vectors down to the client as a compact binary file. The client only handles hardware-accelerated pan and zoom.

### Pillar 3: Flat Binary TypedArrays (Zero Garbage Collection)
Instead of JavaScript object arrays:
```typescript
// ❌ Naive: 100,000 heap objects, heavy GC pauses
const nodes = [{ id: "n1", x: 12.4, y: 55.1 }, ...];

// ✅ 100k Scale: Contiguous TypedArrays (Apache Arrow / FlatBuffers)
const nodeCount = 100_000;
const positions = new Float32Array(nodeCount * 2); // [x0, y0, x1, y1, x2, y2, ...]
const colors    = new Uint8Array(nodeCount * 4);   // [r0, g0, b0, a0, ...]
const radii     = new Float32Array(nodeCount);     // [r0, r1, ...]
```
- **Total Memory**: 100,000 nodes consume just **~2.5 MB of RAM** instead of 80+ MB of V8 object heap.
- **Zero-Copy Worker Transfer**: When physics is run in a Web Worker, transferable `ArrayBuffer` objects are transferred across threads with zero serialization overhead:
  ```typescript
  worker.postMessage({ buffer: positions.buffer }, [positions.buffer]);
  ```

### Pillar 4: Hierarchical Clustering & Viewport Culling ("Google Maps for Graphs")
Just like Google Maps does not render every house on Earth when viewing a whole continent:
1. **Community Clustering (Louvain / Leiden Aggregation)**:
   - When zoomed out, 100,000 nodes are grouped into 500 macro-clusters (super-nodes).
   - As the user zooms into a cluster, it dynamically expands into its constituent nodes.
2. **Viewport Frustum Culling**:
   - A fast spatial index (Quadtree, BVH, or Flatbush) tests the viewport bounding box. Only nodes within `[minX, minY, maxX, maxY]` are submitted to the GPU.
3. **Off-Screen Color-Picking Hit-Testing**:
   - You cannot attach `onClick` event listeners to 100,000 nodes.
   - Instead, the graph is rendered to an invisible off-screen Framebuffer (FBO) where each node's color corresponds to its binary numeric ID (`RGB(ID & 0xFF, (ID >> 8) & 0xFF, (ID >> 16) & 0xFF)`).
   - On mouse click at `(x, y)`, `gl.readPixels(x, y, 1, 1)` reads the color under the cursor in $O(1)$ time, instantly identifying the clicked node without searching.
4. **Decoupled Text Overlay**:
   - Text is never rendered for 100,000 nodes.
   - Text labels are only rendered dynamically for:
     - The currently active node.
     - The hovered node and its 1-hop connected neighbors.
     - Top connected hubs visible inside the current viewport.

---

## 3. Comparative Library Evaluation

| Technology | Max Practical Nodes | Tech Stack | Rendering Method | Physics Engine |
|---|---|---|---|---|
| **Current SVG D3** | ~1,500 | SVG DOM | Browser DOM | CPU Single-Thread |
| **HTML5 Canvas 2D** | ~25,000 | Canvas 2D | Direct Pixel Buffering | CPU / Web Worker |
| **Sigma.js v3** | ~100,000 | WebGL | Instanced GPU Quads | Web Worker / Precomputed |
| **Cosmograph (Cosmos)** | **500,000+** | WebGL / WebGPU | GPU Shaders | GPU Compute Shaders |
| **deck.gl** | **1,000,000+** | WebGL 2 / WebGPU | GPU Instancing | Static / External Layout |

---

## 4. Multi-Phase Implementation Roadmap

### Phase 1: SVG D3 Stabilized (Current Baseline)
- High visual fidelity with rich SVG filters, active cyan glow ring, live semantic zoom breakpoint, and Quartz 1-hop local neighborhood.
- Ideal for personal/vault graphs up to 1,500 nodes.

### Phase 2: Hardware-Accelerated Canvas Engine (`CanvasGraphView.tsx`)
- Zero DOM overhead: 1 `<canvas>` element replaces thousands of SVG nodes.
- Direct 2D canvas drawing: single-batch link path rendering (`ctx.beginPath()`), batch circle fills.
- Spatial Quadtree indexing (`d3.quadtree`): $O(\log N)$ hit-testing for mouse hover and click.
- Shares the exact same props, `ENTITY_META`, colors, physics drawer, and toolbar controls.
- Scales comfortably from 1,000 to 25,000 dynamic nodes at 60 FPS.

### Phase 3: WebGL GPU Instancing & WebGPU Compute (`CosmoGraphView.tsx`)
- WebGL instanced rendering with `Float32Array` attribute buffers.
- GPU-accelerated force-directed layout on compute shaders.
- Off-screen color-picking for $O(1)$ node selection.
- Hierarchical Louvain clustering for 100,000+ to 1,000,000 nodes.



---

## 📋 Implementation Status & Audit Checklist

**Status**: 🔭 Future Roadmap (Phase 2 & 3 Planned) | **Track**: 100k+ Node Graph Engine

- [x] Phase 1 SVG Graph Engine (`GraphView.tsx` with D3 force layout for up to 1,000 nodes)
- [x] Phase 2 HTML5 Canvas & Quadtree Engine (`CanvasGraphView.tsx` supporting up to 25,000 nodes)
- [ ] Phase 3 WebGL GPU Instancing & WebGPU Compute Shaders (`CosmoGraphView.tsx` for 100,000+ nodes)
- [ ] Web Worker multi-threaded force simulation
- [ ] Spatial Hierarchical Louvain cluster reduction
