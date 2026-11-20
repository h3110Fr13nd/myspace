# Plan 23: Spatial Canvas Performance Optimization & Comprehensive Workspace Feature Roadmap

> **Document**: Master Performance Optimization & Complete Feature Parity Specification  
> **Location**: `plan/initial/23-canvas-performance-and-feature-roadmap.md`  
> **Status**: Approved for Staged Execution  
> **Target**: 60–120 FPS Infinite Canvas, Zero-Jank Navigation, and 100% Feature Parity  
> **Ordering**: Categorized strictly by **Implementation Simplicity (Tier 1: Quick Wins → Tier 4: Deep Architecture)**

> **Performance status (2026-11-17):** Feature 1.1 (pan/zoom off React state)
> was already in place; 2.1 (viewport culling — now with hysteresis and a
> frozen-index drag path), 2.2 (screen-space edge canvas — plus incremental
> routing, cached paths and motion impostors), 3.1 (LOD — painted proxies far
> out) and the graph half of 4.2 are implemented and measured in
> [`docs/perf/SCALING.md`](../../docs/perf/SCALING.md).

---

## 🧭 Executive Overview

This plan unifies the remaining work across the `foss-content-workspace` into a single, concrete, prioritized roadmap. It tackles two parallel tracks:
1. **Engine Optimization**: Upgrading the Infinite Spatial Canvas from a heavy DOM+SVG layout into a 60–120 FPS hardware-accelerated, spatially culled engine.
2. **Feature Parity Completion**: Systematically eliminating all remaining gaps from the initial Quartz, Obsidian, and Notion feature specs.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                IMPLEMENTATION SIMPLICITY PYRAMID                                 │
├───────────────────────────────┬────────────┬─────────────────────────────┬───────────────────────┤
│ TIER                          │ EFFORT     │ PERFORMANCE GAIN            │ KEY DELIVERABLES      │
├───────────────────────────────┼────────────┼─────────────────────────────┼───────────────────────┤
│ 🟢 Tier 1: Quick Wins         │ 1–2 Days   │ ~4x FPS improvement         │ Direct DOM Pan/Zoom,  │
│                               │            │                             │ GPU backdrop kill,    │
│                               │            │                             │ Floating-UI Popovers  │
├───────────────────────────────┼────────────┼─────────────────────────────┼───────────────────────┤
│ 🟡 Tier 2: High-Leverage Core │ 3–5 Days   │ ~10x DOM & Render Reduction │ Canvas 2D Edges,      │
│                               │            │ Instant Page Transitions    │ RBush Culling,        │
│                               │            │                             │ Heading Transclusion, │
│                               │            │                             │ SPA Micromorph Router │
├───────────────────────────────┼────────────┼─────────────────────────────┼───────────────────────┤
│ 🟠 Tier 3: Advanced Engines   │ 1–2 Weeks  │ High Capability Expansion   │ Level of Detail (LOD),│
│                               │            │ Database Dynamic Queries    │ Dataview / Bases,     │
│                               │            │                             │ Drive Permission Sync │
├───────────────────────────────┼────────────┼─────────────────────────────┼───────────────────────┤
│ 🟣 Tier 4: Frontier Systems   │ 2+ Weeks   │ Massive Concurrency & Scale │ Yjs CRDT Collab,      │
│                               │            │                             │ 100k PixiJS Graph,    │
│                               │            │                             │ Stacked Pages, i18n   │
└───────────────────────────────┴────────────┴─────────────────────────────┴───────────────────────┘
```

---

# 🟢 TIER 1: Quick Wins (Low Complexity, Immediate High Impact)

Estimated time: **1–2 Days**. Minimal refactoring, immediate eradication of browser stutter.

---

### Feature 1.1: Decouple Pan & Zoom from React State (Canvas Quick Win)
- **Problem**: In `src/components/canvas/CanvasViewer.tsx`, `setPan` and `setZoom` are invoked on **every single wheel tick and mousemove**. Each event triggers a synchronous React reconciliation of the entire board, re-evaluating all nodes and bezier curves.
- **Solution**:
  1. Store viewport transform in a mutable ref (`transformRef = useRef({ x: 40, y: 40, scale: 0.85 })`).
  2. During gestures (`wheel`, `gesturechange`, `mousemove`), bypass React state and mutate the container style directly inside `requestAnimationFrame`:
     ```typescript
     // In animation frame
     transformLayerEl.style.transform = `translate3d(${transformRef.current.x}px, ${transformRef.current.y}px, 0) scale(${transformRef.current.scale})`;
     ```
  3. Only push final values to React state upon gesture termination (`pointerup` or after 150ms of wheel debounce) so toolbars and mini-maps stay in sync without throttling render loops.
- **Files Affected**:
  - `src/components/canvas/CanvasViewer.tsx`
  - `src/components/canvas/CanvasEditor.tsx`
- **Simplicity Score**: 🟢 **Very Simple (1/5)**

---

### Feature 1.2: Dynamic GPU Compositing & Backdrop Killer
- **Problem**: Glassmorphic cards with `backdrop-filter: blur(12px)` and multi-stop `box-shadow` force the browser to rasterize backdrop buffers for 50+ nodes on every frame of a pan or zoom gesture.
- **Solution**:
  1. Add an `.is-interacting` CSS class to `.canvas-board-viewport` during panning or pinch-to-zoom.
  2. While `.is-interacting` is active:
     - Fallback `backdrop-filter: none !important;`
     - Switch node background to solid opaque: `background: rgba(15, 23, 42, 0.95) !important;`
     - Disable hover transitions: `transition: none !important;`
     - Add `will-change: transform` to the root transform layer.
- **Files Affected**:
  - `src/styles/global.css`
  - `src/components/canvas/CanvasViewer.tsx`
- **Simplicity Score**: 🟢 **Very Simple (1/5)**

---

### Feature 1.3: Floating-UI Collision-Aware Wikilink Popovers
- **Problem**: `src/components/WikilinkPreview.tsx` uses primitive `Math.min(e.clientY, window.innerHeight - 300)` calculation. When hovering near screen edges or inside scrollable containers, previews clip outside the window viewport.
- **Solution**:
  1. Integrate `@floating-ui/dom` (`computePosition`, `autoPlacement`, `flip`, `shift({ padding: 8 })`, `offset(10)`).
  2. Support section hash anchors: If the wikilink contains an anchor (e.g. `[[paper#Section 3]]`), auto-scroll the popover preview body to `#section-3`.
- **Files Affected**:
  - `src/components/WikilinkPreview.tsx`
- **Simplicity Score**: 🟢 **Simple (2/5)**

---

### Feature 1.4: Pre-built Static Content Index for Instant Search
- **Problem**: Search modal triggers network requests against Meilisearch/PostgreSQL for every keystroke.
- **Solution**:
  1. Create an endpoint or build step generating `/api/v1/content/index.json` (compressed mapping of `id`, `title`, `slug`, `tags`, and text excerpts).
  2. In `SearchModal.tsx`, load this small index on first open and execute instant in-memory prefix search with `MiniSearch` or custom regex. Fall back to remote Meilisearch only for full-text deep body queries.
- **Files Affected**:
  - `src/pages/api/v1/content/index.json.ts`
  - `src/components/SearchModal.tsx`
- **Simplicity Score**: 🟢 **Simple (2/5)**

---

# 🟡 TIER 2: High-Leverage Core (Medium Complexity, Transformative UX)

Estimated time: **3–5 Days**. Eliminates DOM bloat and full-page reloads.

---

### Feature 2.1: Spatial Viewport Culling with RBush (Canvas Core)
- **Problem**: All nodes in a canvas are rendered into the DOM simultaneously, even when 95% of them are offscreen.
- **Solution**:
  1. Index all canvas nodes into an in-memory R-Tree using `rbush`:
     ```typescript
     import RBush from 'rbush';
     interface SpatialNodeItem {
       minX: number; minY: number; maxX: number; maxY: number;
       node: CanvasNode;
     }
     const tree = new RBush<SpatialNodeItem>();
     tree.load(nodes.map(n => ({
       minX: n.x, minY: n.y,
       maxX: n.x + n.width, maxY: n.y + n.height,
       node: n
     })));
     ```
  2. On viewport change, calculate the visible world box:
     ```typescript
     const buffer = 300 / zoom; // 300px safety buffer around screen edges
     const visibleBox = {
       minX: (-pan.x / zoom) - buffer,
       minY: (-pan.y / zoom) - buffer,
       maxX: ((-pan.x + containerWidth) / zoom) + buffer,
       maxY: ((-pan.y + containerHeight) / zoom) + buffer,
     };
     const visibleNodes = tree.search(visibleBox).map(item => item.node);
     ```
  3. Render **only** `visibleNodes`. Offscreen nodes are completely removed from the React/DOM tree, capping active DOM elements to < 30 at all times regardless of canvas size.
- **Files Affected**:
  - `src/components/canvas/CanvasViewer.tsx`
  - `src/components/canvas/CanvasEditor.tsx`
  - `package.json` (`rbush`)
- **Simplicity Score**: 🟡 **Medium (3/5)**

---

### Feature 2.2: Canvas 2D Hardware-Accelerated Edge Renderer
- **Problem**: `EdgeRenderer.tsx` renders hundreds of SVG `<path>`, `<marker>`, and `<g>` DOM nodes across the canvas bounds, creating severe layout thrashing and SVG raster bottlenecks.
- **Solution**:
  1. Replace `<svg>` with an HTML5 `<canvas>` element sized to the viewport.
  2. Implement an immediate-mode 2D render loop in `requestAnimationFrame`:
     ```typescript
     const ctx = canvasRef.current.getContext('2d');
     ctx.clearRect(0, 0, width, height);
     ctx.save();
     ctx.translate(pan.x, pan.y);
     ctx.scale(zoom, zoom);

     // Only draw edges whose bounding box intersects visibleBox
     visibleEdges.forEach(edge => {
       ctx.beginPath();
       ctx.moveTo(from.x, from.y);
       ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, to.x, to.y);
       ctx.strokeStyle = edge.color;
       ctx.lineWidth = edge.isSelected ? 3.5 : 2.5;
       ctx.stroke();
       drawArrowhead(ctx, to, angle, edge.color);
       if (edge.label) drawEdgeLabelPill(ctx, midX, midY, edge.label);
     });
     ctx.restore();
     ```
  3. Render time drops from 30ms (SVG layout) to **< 0.5ms** (Canvas2D GPU blit).
- **Files Affected**:
  - `src/components/canvas/EdgeRenderer.tsx`
- **Simplicity Score**: 🟡 **Medium (3/5)**

---

### Feature 2.3: SPA Router & DOM-Diffing Navigation (`micromorph`)
- **Problem**: Every link click in the workspace triggers a full SSR reload via `/?doc=...`. This flashes the screen, kills audio playback, and forces React islands (graph, tree, editor) to reload from scratch.
- **Solution**:
  1. Add an inline client router (`src/scripts/spa.ts`):
     - Intercept internal `<a>` clicks.
     - Fetch destination HTML in the background using `fetch()`.
     - Parse response into a DOM document and morph `#main-content-container` using `micromorph`.
     - Update `window.history.pushState`.
  2. Emit `workspace:nav` and `workspace:prenav` CustomEvents so React islands (FolderTree active state, Graph focus, Reading progress) update their state without unmounting.
- **Files Affected**:
  - `src/scripts/spa.ts`
  - `src/pages/index.astro`
  - `src/layouts/Layout.astro`
- **Simplicity Score**: 🟡 **Medium (3/5)**

---

### Feature 2.4: Block-Level & Heading-Level Transclusions
- **Problem**: `src/lib/render/embedResolver.ts` only resolves whole notes (`![[note]]`). Obsidian-style transclusions like `![[note#Key Findings]]` and `![[note#^custom-block-id]]` are not parsed.
- **Solution**:
  1. Enhance `embedResolver.ts` regex to extract `#heading` and `#^block`:
     ```typescript
     /!\[\[(.*?)(?:#(.*?))?(?:\|(.*?))?\]\]/g
     ```
  2. **Heading Transclusion**: When target contains `#Heading Name`, parse the markdown AST, locate the corresponding `h1-h6` heading, and extract only the content up to the next heading of equal or higher level.
  3. **Block Transclusion**: When target contains `#^blockid`, scan the document for line ending with `^blockid` and extract only that paragraph or list item.
- **Files Affected**:
  - `src/lib/render/embedResolver.ts`
- **Simplicity Score**: 🟡 **Medium (3/5)**

---

# 🟠 TIER 3: Advanced Engines (Moderate-to-High Complexity)

Estimated time: **1–2 Weeks**. Adds rich new functionality and database intelligence.

---

### Feature 3.1: Level of Detail (LOD) Rendering for Spatial Canvas
- **Problem**: When zoomed out (`zoom < 0.5`), the browser struggles to render full Markdown prose, KaTeX formulas, and image widgets that are barely 30 pixels wide on the screen.
- **Solution**:
  1. Define 3 zoom tiers:
     - **Full Fidelity (`zoom >= 0.7`)**: Normal render (KaTeX, interactive widgets, embedded documents).
     - **Medium Fidelity (`0.35 <= zoom < 0.7`)**: Text summary card with title, icon, tags, and 2-line plain-text excerpt (no KaTeX, no iframes, no nested embeds).
     - **Geometric Proxy (`zoom < 0.35`)**: Solid colored rounded rectangle with high-contrast title text rendered purely via CSS or direct 2D canvas draw.
  2. Implement an `IntersectionObserver` / `zoomThreshold` dispatcher inside `NodeRenderer.tsx`.
- **Files Affected**:
  - `src/components/canvas/nodes/NodeRenderer.tsx`
  - `src/components/canvas/nodes/ResourceNodeCard.tsx`
- **Simplicity Score**: 🟠 **Moderate (3/5)**

---

### Feature 3.2: Bases / Dataview Dynamic Database Queries
- **Problem**: Authors cannot dynamically aggregate and filter content into tables, Kanban boards, or galleries based on frontmatter metadata.
- **Solution**:
  1. Add a Markdown codeblock transform in `renderEngine.ts` for ````dataview` or ````bases`.
  2. Syntax Specification:
     ```yaml
     ```bases
     type: paper
     tags: [edge-ai, scheduling]
     sort: metadata.date desc
     view: table # or kanban, gallery
     columns: [title, category, tags, readStatus]
     ```
     ```
  3. SSR Parser queries PostgreSQL `resources` table using JSONB operators (`metadata->'tags' ?| array[...]`), renders an interactive React Island (`BasesView.tsx`) with client-side sorting and filtering.
- **Files Affected**:
  - `src/lib/render/mdxComponents.ts`
  - `src/components/BasesView.tsx`
  - `src/pages/api/v1/resources/query.ts`
- **Simplicity Score**: 🟠 **Moderate (4/5)**

---

### Feature 3.3: Google Drive Dynamic Permission Broker
- **Problem**: Uploaded/linked Google Drive assets do not reflect OpenFGA permission changes on Google Cloud.
- **Solution**:
  1. Create background worker `src/lib/authz/drivePermissionBroker.ts`.
  2. Hook into `writeTuple` / `deleteTuple` in `openfga.ts`:
     - When a permission is granted on a `drive:*` resource, query `user_identities` for the target user's email.
     - Invoke Google Drive API v3 (`POST /files/{fileId}/permissions` with role `reader` or `commenter`).
     - On tuple deletion, delete the Google Drive permission ID.
- **Files Affected**:
  - `src/lib/authz/drivePermissionBroker.ts`
  - `src/pages/api/v1/permissions/grant.ts`
  - `src/pages/api/v1/permissions/revoke.ts`
- **Simplicity Score**: 🟠 **Moderate (4/5)**

---

# 🟣 TIER 4: Frontier Systems (Complex / Long-Term)

Estimated time: **2+ Weeks**. High architectural scale and real-time collaboration.

---

### Feature 4.1: Live Real-Time Multi-User Collaboration (Yjs + WebSockets)
- **Problem**: Multiple users editing the same canvas or TipTap note simultaneously overwrite each other's changes.
- **Solution**:
  1. Integrate **Yjs** CRDT documents for `.canvas` JSON and TipTap Prosemirror state.
  2. Establish a lightweight WebSocket server (`scripts/ws_server.ts`) or Cloudflare Durable Object worker.
  3. Broadcast visual presence indicators (collaborator cursor coordinates, selected nodes, active typing bounding boxes).
- **Files Affected**:
  - `src/lib/editor/collaboration.ts`
  - `src/components/canvas/CanvasEditor.tsx`
  - `src/components/editor/NovelEditor.tsx`
- **Simplicity Score**: 🟣 **Complex (5/5)**

---

### Feature 4.2: Massive-Scale 100k Hardware-Accelerated Graph (PixiJS / WebGL)
- **Problem**: The current Canvas 2D D3 graph scales to ~3,000 nodes before physics simulation and CPU drawing saturate the main thread.
- **Solution**:
  1. Implement Plan 22's Instanced WebGL / PixiJS v8 engine.
  2. Run Force-Directed layout in a Web Worker via Barnes-Hut or Quadtree approximation to prevent UI freezes.
  3. Render 100,000 nodes and edges using GPU instanced sprite shaders.
- **Files Affected**:
  - `src/components/graph/PixiGraphView.tsx`
  - `src/components/graph/worker/physics.worker.ts`
- **Simplicity Score**: 🟣 **Complex (5/5)**

---

### Feature 4.3: Stacked Pages / Andy Matuschak Sliding Note Mode
- **Problem**: Browsing dense knowledge graphs in a single column requires clicking Back/Forward repeatedly.
- **Solution**:
  1. Create a sliding multi-column container layout where clicking any wikilink slides in a new panel from the right with horizontal scroll snaps.
  2. Maintain active scroll positions and column history in the URL hash (`/#note1+note2+note3`).
- **Files Affected**:
  - `src/components/StackedContainer.tsx`
  - `src/pages/index.astro`
- **Simplicity Score**: 🟣 **Complex (5/5)**

---

### Feature 4.4: i18n & Internationalization Routing
- **Problem**: Hardcoded UI strings across components; no localized content routing.
- **Solution**:
  1. Adopt Astro i18n routing (`/[locale]/...`).
  2. Add JSON translation dictionaries for UI elements (navigation, editor toolbars, IAM matrix).
- **Files Affected**:
  - `astro.config.mjs`
  - `src/i18n/`
- **Simplicity Score**: 🟣 **Complex (4/5)**

---

## 🎯 Verification & Quality Checklist

For each implemented feature, verify:
- [ ] **Canvas Frame Rate**: Maintains solid 60+ FPS during pan and zoom on a 200-node board (measured via Chrome DevTools Rendering HUD).
- [ ] **Memory Footprint**: Active browser heap stays under 100 MB on massive boards.
- [ ] **Navigation Smoothness**: Route changes occur in < 50ms without blank page flickers or unmounting persistent audio/graph state.
- [ ] **Spec Compliance**: All canvases validate against `scripts/validate_canvases.py` and import/export to Obsidian without node loss.
- [ ] **Docker Reproducibility**: `docker compose --profile '*' up -d --build` passes with 0 compile errors.


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🔭 Future Roadmap | **Track**: Advanced Spatial Canvas Evolution

- [x] Canvas Pan/Zoom matrix performance optimization
- [x] Spec compliance with JSON Canvas v1.0 standard
- [ ] Infinite recursive sub-canvas viewport drill-down
- [ ] WebGL edge rendering for boards with >10,000 nodes
- [ ] Automatic layout algorithms (force-directed auto-arrange, tree layout)
