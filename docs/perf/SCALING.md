# Scaling the graph and canvas views

**Goal:** keep the graph and canvas views smooth, and the server inside its
runtime budget (app: 256 MiB / 0.6 CPU, see `docs/GOALS.md`), at a million
nodes and beyond — with per-view cost that does not grow with the size of the
workspace.

**Status:** implemented and measured. Numbers below come from the benchmark
suite in `bench/` (see `bench/README.md`); raw output is in `bench/results/`.

## TL;DR

Medians of interleaved before/after runs on the same machine (original code vs
this branch, same database, production builds); full tables in
[§5](#5-benchmarks).

| | Before | After |
|---|---|---|
| Server cost of opening the graph, 1M resources | **18 s CPU and 2.2 GB RSS per request** in-process (OOM under the app's 192 MB heap cap); 273 s wall through the real app | a tile read: **0.85 ms CPU**, ~1,100 tiles/s from one process; pyramid built once, off the request path |
| Bytes to open the graph, 1M resources | 36 MB gzipped JSON, per view | **~15 KB** first view, **~45 KB** per detail view |
| Browser, graph of 900k nodes | — (the legacy view cannot load it) | frame p50 16.7 ms, p95 83 ms, 3.8 MB JS heap, ~250 DOM nodes, ready in ~1.6 s |
| Browser, classic graph 1k / 20k nodes | 3 s of scripted input took 44 s / 165 s to process | 17 s / 27 s (software-rendered container; see §5) |
| Canvas editor, 10k nodes | 283k DOM nodes, 113 MB heap, 3 s of input took **6 min** to process | 1.9k DOM nodes, 39 MB, **32 s** |
| Canvas editor, 50k nodes | not interactive (> 12 min) | ready in ~7 s, input processed in 49 s, 2k DOM nodes |
| Canvas viewer, 10k / 50k nodes | frame p95 983 ms / 2,550 ms | p95 **33 ms** / **33 ms**, 52 DOM nodes |
| Canvas API, 20k-node board | owner read 3.7 req/s, 12.5 MB; denied read 17 req/s | 5.7 req/s, 6.7 MB; denied read **209 req/s** |
| Home page, 1M resources | 127 s | 25 s (listing query 168 s → 8 s; still O(N), see §7) |

Along the way the work found and fixed several **security defects** (anonymous
canvas overwrite/delete/create, a private-title leak in the canvas list, and
per-viewer data leaking through stored canvas documents) — see
[Security fixes](#4-security-fixes).

---

## 1. What was slow, and why

Findings, each backed by a measurement or a trace:

**Graph, server.** `GET /api/v1/workspace/graph` loaded every visible
resource *with full metadata* (canvas payloads included), resolved every
wikilink and serialised the whole graph as one JSON document, on every
request. Cost is O(N) CPU and memory per view: 1.3 s / 319 MB at 100k, 18 s /
2.2 GB at 1M in-process (273 s through the real app) — it cannot run inside
the app's memory budget at all.

**Graph, browser.** The client laid the graph out with a live d3-force
simulation and redrew every node, halo and label on each tick. Even at 1k
nodes the main thread was saturated (99% busy, 333 ms median frames): the
renderer set `context.font` per label per frame, drew every label and
off-screen node, rebuilt a quadtree on every simulation tick, and a logic slip
(`isHoveredOrNeighbor` is true for every node when nothing is hovered) meant
the zoom-dependent label thresholds never applied.

**Canvas editor.** Every node was mounted as DOM (~28 DOM nodes per card) and
re-rendered on every pan frame and every drag frame (inline `{...node}` props
defeated memoisation); the edge hit layer mounted an SVG path per edge;
each visible edge re-parsed its SVG path string per paint; each drag frame
re-built an R-tree over the whole board and re-routed every edge; and
`commit()` — run by every move, resize and recolour — computed removed nodes
with a nested `filter/some`, **O(N²)** (10⁸ comparisons per edit at 10k
nodes). `enforceInvariants` deep-copied every node on every commit, so every
memoised consumer saw a "changed" board after each edit.

**Canvas viewer.** Pan/zoom are React state; each frame re-ran the spatial
query and re-rendered every visible card, and at fit zoom repainted every edge
and card. Traced during a pan on a 10k board, `ProduceCanvasResource` (2D
canvas raster + readback) was 92% of main-thread time.

**Page shell.** The home page took **127 s** at 1M resources, in
PostgreSQL: the visible-resource listing (`listWorkspaceResourceCandidates`)
tested "is an ancestor folder" as `OR id IN (SELECT id FROM ancestor_ids)`,
which the planner cannot hash inside an `OR`, so it rescanned the 540k-row
ancestor CTE once per folder (2,481 × 40 ms). Rewritten as a union of id sets
(same rows — pinned by an integration test that runs the original SQL as the
oracle): **168 s → 8 s** for the query, home page 127 s → 25 s. The page is
still O(N) by design; see §7.

**Canvas API.** One sequential OpenFGA check per resource node, synchronous
`fs.existsSync`/`readFileSync` per node on the event loop, a full markdown
render per document node, and the stored document echoed twice in every
response.

---

## 2. Graph: tiled level-of-detail streaming

The core idea is the one map engines use: **positions become data**, computed
once; the graph is cut into a pyramid of bounded-size tiles; a viewer fetches
only the tiles that cover its screen at its zoom. Every per-view cost is then
bounded by the screen, not by the graph.

```
 resources ──► builder (worker) ──► graph_nodes (x, y, gid)       stable positions
                 │                   graph_tiles (gzip, per layer) LOD pyramid
                 │                   graph_scopes (world, generation, dirty)
                 ▼
 app: GET /api/v1/graph/meta            which layers, where
      GET /api/v1/graph/tiles/{layer}/{gen}/{z}/{x}/{y}   PK read + byte copy
      GET /api/v1/graph/node/{gid}       click → resource (ACL-checked)
      GET /api/v1/graph/locate?id=        fly-to (ACL-checked)
                 ▼
 browser: tile worker (fetch + decode + prepare) ► LRU tile cache ► WebGL2 / Canvas2D
```

### 2.1 Layout — `src/lib/spatial-tiles/layout.ts`

- **`structuralLayout`, ~O(N).** Uses the containment hierarchy the workspace
  already has. Each subtree becomes a disk whose area is proportional to its
  size (uniform density at every scale): leaf children fill a golden-angle
  sunflower around their parent, larger subtrees are circle-packed around it
  (`d3.packSiblings`; rings beyond 2,000 siblings to stay linear).
  Parentless linked notes are placed beside what they link to. 1M nodes lay
  out in ~1 s.
- **`placeIncremental`.** New resources are placed next to their parent or
  link neighbours; **nothing already placed moves**, so unaffected tiles stay
  byte-identical and HTTP/CDN caches survive edits.

### 2.2 Pyramid — `src/lib/spatial-tiles/pyramid.ts`

- Items are sorted once by 32-bit **Morton code** (O(n) radix sort); every
  quadtree tile at every level is then a contiguous slice of that order, so
  building is O(N) per level with no per-tile filtering.
- **Adaptive quadtree:** a tile with ≤ `leafBudget` (1,024) items is a *leaf*
  holding all of them with labels and exact edges; denser regions subdivide.
- **Internal tiles** summarise on a 32×32 lattice (one aggregate per occupied
  cell, weighted by count) plus the top 48 items by degree kept as labelled
  *hubs*, so important nodes stay visible and named at every zoom.
- **Edges are re-targeted per level** to whatever represents each end there
  (aggregate, hub or item), bundled (sort + run-length instead of a `Map`,
  which cost ~60 B per entry), capped at 4 per node with the heaviest bundles
  kept. Leaf edges carry `minZ`, the level from which both ends are real, so
  an edge is never drawn twice with different endpoints.
- **Ghost endpoints** let a private layer draw an edge to a shared node
  without containing it (position only, never a title).

### 2.3 Wire format — `src/lib/spatial-tiles/codec.ts` ("GTL1")

Struct-of-arrays, 4-byte aligned, decoded into typed-array views. Point
coordinates are 16-bit over the tile (plus a margin); an in-tile edge endpoint
is a 2-byte node index, not an 8-byte coordinate pair; unit edge weights are
omitted. Leaf tiles went from 58 to **41 gzipped bytes per node** with these
changes. Tiles are stored **pre-gzipped**, so serving one is a primary-key
read plus a byte copy — zero compression CPU in the app.

### 2.4 Layers and authorization — `src/lib/graph-tiles/scopes.ts`

A viewer's graph is composed client-side from independent layers, so the
shared layers are identical for every reader and cache well:

| Layer (`{layer}` in the URL) | Contains | Readable by |
|---|---|---|
| `public` | resources the engine grants to `user:*`, minus drafts/unlisted | anyone (shared HTTP caches OK) |
| `workspace` | granted to `space:main#member` (workspace audience), not public | verified workspace members (membership checked per request, memoised 30 s, fail-closed) |
| `me` → `owner:<you>` | your resources in neither shared layer, drafts included | you |
| overlay (`/api/v1/graph/overlay?x0&y0&x1&y1`) | resources shared with you *by name or group* only, inside the view | you — every node checked against the engine as you |

User ids never appear in URLs; unknown layers answer 404, not 403. The
overlay is per request (no pyramid): candidates from the projection for your
own and group subjects, bounded by the view rectangle and a limit, verified in
one batched engine call, returned as a single leaf tile; the client fetches it
only when the camera settles and only if `meta.overlay` says you have such
grants. A resource
is in exactly one layer (the widest audience that may see it). An edge is
stored in its *narrower* endpoint's layer; an edge between two different
owners' private nodes is never stored.

**Shared-layer membership is verified against OpenFGA** when a pyramid is
built (projection candidates → `checkPermissionsBatch` as `user:*` /
`space:main#member`), consistent with the rule that the ACL projection is never
an authorization input by itself. A stale projection refuses the build.

### 2.5 Freshness without losing the fast path

A pyramid is a snapshot. Statement-level triggers (transition tables — never
per row) record *which nodes changed* in `graph_dirty_gids` (updates, ACL
changes, and deletes via the `graph_nodes` cascade) and mark the scope for
rebuild (`dirty_at`, throttled to once per second per scope to avoid a lock
hot spot).

On read, the tile's nodes are intersected with the changed set. **A tile that
contains no changed node is served untouched** (normal caching); otherwise
only the changed nodes are re-verified (engine for shared layers, ownership
for owner layers) and filtered out if they no longer qualify. Changes are
compared against the build snapshot minus a 60 s margin, because trigger
timestamps are statement time, not commit time — an integration test commits
a privacy change *after* a build's snapshot and asserts it is still caught.
The worker (`startGraphMaintenance`) rebuilds scopes that stay dirty past a
20 s settle window. Engine unreachable ⇒ changed nodes are hidden (fail
closed).

### 2.6 Client — `src/components/graph/tiled/`

- **Tile worker** fetches, decodes and prepares tiles (tile-relative float32
  coordinates so precision holds at any zoom; edges sorted by `minZ` so
  "visible at this level" is a prefix), transferring buffers zero-copy.
  Requests that leave the view before arriving are aborted.
- **`TileStore`**: priority queue (distance from view centre; own layer
  first), concurrency 6, LRU under a 96 MB budget, leaf aliasing (a request
  below a leaf resolves to it), generation handling (410 → re-read meta).
- **Never blank:** a missing tile shows its nearest loaded ancestor,
  scissor-clipped to the gap, or its loaded children; arrivals fade in.
- **WebGL2 renderer:** buffers uploaded once per tile; a frame is uniforms and
  two draw calls per visible tile. Instanced anti-aliased discs (hub and
  "mine" rings, aggregates as density glows), edges dimmed by on-screen
  density and **faded by on-screen length** so local structure stays crisp.
- **Software-GPU aware:** where WebGL is CPU-emulated (SwiftShader, llvmpipe —
  VMs, blocklisted drivers), every frame would be read back to the CPU;
  traced, that readback was 87% of main-thread time while the renderer's own
  script was ~2%. Such browsers get a batched Canvas2D renderer on CPU-backed
  canvases instead: **4.3 s → 0.15 s** of main-thread time for the same pan
  (`src/lib/viewer/gpuTier.ts`). While the camera moves over an unchanged
  set of tiles, that renderer blits an overscanned snapshot of its last full
  paint (the canvas *motion raster*, §3) instead of re-rasterising every edge;
  full quality returns when the camera settles or any tile changes. In the
  browser benchmark this cut the time to process the scripted input from
  21–23 s to 15–17 s and p95 frames from ~130 ms to 83 ms
  (`bench/results/browser-tiled-pre-impostor.log` vs `-runs-3.log`).
  Tried and reverted: drawing labels onto the graph canvas to save one
  canvas upload per frame — measured 2× *slower* in Chromium's software
  compositor, so labels keep their own canvas.
- **Labels:** greedy placement on an occupancy grid, heaviest first; each
  label (text + halo) is rendered once into a sprite held in a byte-bounded
  LRU and blitted afterwards — stroking the halo was ~2 ms per label per frame
  in software rasterisation. Fewer labels while moving, the full set after the
  camera settles. Colours come from design tokens and follow theme switches.
- **Interaction:** inertial pan, smoothed wheel zoom, trackpad/touch pinch,
  keyboard, "fly to" (zooms out, travels, zooms in), click a cluster to zoom
  into it, click a node to open it, hover tooltips. Idle costs nothing (frames
  render only when something changed). `prefers-reduced-motion` respected.
- **Loaded lazily:** the tiled view (~16 KB gz) and its worker (3.5 KB gz)
  are only downloaded when a large graph is expanded.

`GraphContainer` picks the view: graphs with a built pyramid and ≥ 2,000
nodes open the tiled view; smaller ones keep the classic live force layout
(`?graph=tiled|classic` forces either). The legacy whole-graph endpoint now
answers **413** when the viewer's graph is larger than
`LEGACY_GRAPH_MAX_NODES` (default 20,000) instead of exhausting the app.

### 2.7 The classic view (small graphs)

Kept for < 2,000 nodes, and made cheaper: per-node values precomputed once,
viewport culling of nodes/links/labels, font set only when it changes, the
hit-test quadtree rebuilt lazily instead of on every tick, CSS-variable
colours resolved (canvas cannot read `var(--x)`), CPU-backed canvas on
software GPUs. Labels now follow the zoom thresholds the code intended
(hubs from 40% zoom, everything from 65%; in "hover" mode, on hover).

---

## 3. Canvas

| Change | Where | Effect |
|---|---|---|
| Viewport virtualisation with hysteresis | `core/useVirtualNodes.ts` | Only nodes near the view are mounted; the list is prepared for a padded rect and reused until the view leaves it, so a pan usually re-renders nothing. The index is frozen mid-gesture; the moving selection is located by live position, O(selection). |
| Memoised node shells | `CanvasEditor.tsx`, `CanvasViewer.tsx` | Handlers through a ref; a drag re-renders only moved nodes. |
| Painted far-zoom LOD | `core/LodNodeLayer.tsx` | Below 30% zoom with > 600 nodes in view, cards are rectangles on one canvas (batched by colour, titles where legible); presses are hit-tested against the spatial index, selected nodes stay DOM. |
| Motion raster (impostors) | `core/motionRaster.ts` | While the camera moves, dense screen-space layers (edges, painted proxies) blit an overscanned snapshot instead of repainting everything; full quality on settle; snapshot refreshed at idle. |
| Incremental edge routing | `core/routing.ts` `createEdgeResolver` | Same output as `resolveEdges`; routes cached by node identity; with an unchanged edge list a drag frame is two O(1) lookups per edge and re-routes only edges on moved nodes. |
| Culled, non-scaling hit layer | `core/EdgeRenderer.tsx` | SVG hit paths only near the view, `vector-effect: non-scaling-stroke`, memoised; `Path2D` cached per route; label pills hidden below 35% zoom. |
| O(N²) → O(N) commit | `useCanvasEditor.ts` | Every edit on a 10k board was 10⁸ comparisons. |
| Identity-preserving invariants | `core/grouping.ts` | `enforceInvariants` no longer deep-copies every node per commit. |
| Lazy spatial index | `core/spatialIndex.ts` | The R-tree is bulk-loaded on first query, not per drag frame. |
| Canvas API | `api/v1/resources/canvas/[id].ts` | One batched engine check for all resource nodes; async file I/O with bounded concurrency; heavy enrichment skipped above 300 resource nodes (`enrichment: 'lite'`; cards self-hydrate when they scroll into view, `?lite=1` forces it); the stored document is no longer echoed in `metadata`. The permission check runs *before* the stored document is loaded (a denied read used to parse the whole board first: 64 ms CPU per 403 at 20k nodes, now 1.5 ms), and a save no longer loads the document it replaces. |
| Canvas list | `api/v1/resources/canvas/index.ts` | Counts computed in SQL instead of loading every canvas's payload. |

---

## 4. Security fixes

Found while profiling the canvas endpoints; all are closed:

1. **Anonymous canvas overwrite / delete / create.** `PUT` and `DELETE
   /api/v1/resources/canvas/:id` skipped the edit/owner check when the caller
   was anonymous (`if (currentUser !== 'user:anonymous' && …)`), and no
   middleware guards these routes; `POST /api/v1/resources/canvas` created
   canvases owned by `user:anonymous`, which were then writable by anyone.
   Writes now require a signed-in user with edit rights (owner for delete).
   *Behaviour change:* canvases previously owned by `user:anonymous` are no
   longer editable by arbitrary signed-in users without an editor grant.
2. **Private canvas titles listed to anyone.** `GET /api/v1/resources/canvas`
   returned every canvas; it now filters through `filterViewableResources`.
3. **Per-viewer data persisted and re-served.** The canvas GET echoed
   `metadata` wholesale — including the stored `canvasData`, bypassing per-node
   redaction — and the editor could save enriched nodes (`resolvedMetadata`
   with rendered HTML of resources only the saver could read) back into the
   shared document. Derived fields are now stripped on save and on read, and
   the stored document is no longer echoed.

---

## 5. Benchmarks

Environment: 4 vCPU container, **no GPU** (Chromium rasterises WebGL and
compositing in software), PostgreSQL 16 local. Browser numbers are from a
production build. In a GPU-less container absolute frame intervals are
pessimistic; the *main-thread* columns (from CDP) are the hardware-independent
cost. Methodology and commands: `bench/README.md`.

How to read these:

- **"3 s of scripted input took"** — each scenario plays the same script of
  drag-pans and wheel zooms (nominally ~3 s of input) and records frames
  until it is done. Input is dispatched through the DevTools protocol, which
  waits for the page to handle each event, so a busy main thread stretches
  the window: the quickest pages finish in ~7–8 s in this container, and
  anything beyond that is input backlog — what a user feels as lag. "Main
  thread busy" is CDP main-thread time per wall second during that window.
- The host has no GPU and ~13% CPU steal, so runs are interleaved
  (before, after, before, …) and medians of 3 are reported (2 for editor
  50k). Frame times are software-composited and pessimistic in absolute
  terms; compare before against after.
- HTTP rows: one process per build, both on the same 1M-resource database;
  server CPU and RSS read from `/proc` for the app process. "Peak RSS" is the
  process high-water mark, so it includes whatever ran earlier in the same
  process. The original code's whole-graph request did not finish inside its
  60 s window (one request, 273 s). Without OpenFGA in the benchmark
  environment the engine calls fail fast; the *before* canvas and home rows
  therefore under-state the real engine cost of the original per-node checks.
- Graph tables are in-process (`bench/graph-server.bench.ts`): synthetic
  workspaces, fresh process per row, with and without the app's heap cap.

### Browser (median of interleaved runs, production build)

| Scenario | Build | Ready | Frame p50 / p95 | Jank > 33 ms | Main thread busy | 3 s of scripted input took | JS heap | DOM nodes |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| graph classic 1000 | before | 2632 ms | 16.7 / 466.7 ms | 34.6% | 97% | 43.7 s | 4.2 MB | 158 |
| graph classic 1000 | after | 2018 ms | 16.8 / 116.7 ms | 41.4% | 87% | 16.9 s | 4.6 MB | 464 |
| graph classic 5000 | before | 1105 ms | 699.9 / 916.7 ms | 77.4% | 100% | 128.6 s | 7.2 MB | 170 |
| graph classic 5000 | after | 1197 ms | 116.6 / 216.8 ms | 93% | 100% | 39.4 s | 7.7 MB | 540 |
| graph classic 20000 | before | 1296 ms | 16.7 / 2699.9 ms | 26.4% | 99% | 165.3 s | 18.4 MB | 158 |
| graph classic 20000 | after | 1584 ms | 16.7 / 416.7 ms | 17.4% | 89% | 27.2 s | 18.8 MB | 281 |
| graph tiled (DB) | after | 1602 ms | 16.7 / 83.4 ms | 28.8% | 84% | 16.1 s | 3.8 MB | 254 |
| canvas editor 500 | before | 1920 ms | 50 / 166.8 ms | 53.3% | 87% | 27.5 s | 12.6 MB | 14365 |
| canvas editor 500 | after | 1286 ms | 33.3 / 66.7 ms | 34.7% | 34% | 12 s | 9.3 MB | 1861 |
| canvas editor 2000 | before | 5265 ms | 133.3 / 1033.3 ms | 74.4% | 101% | 129.9 s | 28.7 MB | 56777 |
| canvas editor 2000 | after | 2585 ms | 66.7 / 150 ms | 69.1% | 52% | 24.6 s | 13.8 MB | 1896 |
| canvas editor 10000 | before | **did not finish within 240 s** (all 3 runs) | — | — | — | — | — | — |
| canvas editor 10000 | after | 4727 ms | 83.3 / 216.6 ms | 70.6% | 64% | 31.7 s | 38.6 MB | 1944 |
| canvas editor 50000 | before | **did not finish within 240 s** (all 2 runs) | — | — | — | — | — | — |
| canvas editor 50000 | after | 6743 ms | 99.9 / 300 ms | 66.4% | 75% | 49.2 s | 159.7 MB | 1985 |
| canvas viewer 500 | before | 3817 ms | 16.7 / 100 ms | 16.5% | 72% | 15 s | 8.8 MB | 2094 |
| canvas viewer 500 | after | 2028 ms | 16.7 / 66.7 ms | 10.7% | 65% | 12.1 s | 8.5 MB | 984 |
| canvas viewer 2000 | before | 2652 ms | 16.7 / 333.4 ms | 40.4% | 93% | 30.7 s | 15.2 MB | 7222 |
| canvas viewer 2000 | after | 2168 ms | 16.7 / 33.3 ms | 3% | 43% | 7.6 s | 12.4 MB | 51 |
| canvas viewer 10000 | before | 6449 ms | 16.7 / 983.3 ms | 42.8% | 101% | 100.5 s | 40.3 MB | 15445 |
| canvas viewer 10000 | after | 6979 ms | 16.7 / 33.4 ms | 5.3% | 57% | 13.4 s | 35.1 MB | 52 |
| canvas viewer 50000 | before | 16123 ms | 16.7 / 2550 ms | 36.8% | 101% | 196.6 s | 146.9 MB | 18410 (2 of 3 runs finished) |
| canvas viewer 50000 | after | 10779 ms | 16.7 / 33.4 ms | 8.7% | 60% | 23.4 s | 150 MB | 52 |

### Classic view: time from "expand" to first painted graph

| Nodes | Before | After |
|---:|---:|---:|
| 5,000 | 4.6 s | 2.6 s |
| 20,000 | 32.7 s | 16.6 s |
| 50,000 | 108.2 s | 44.1 s |

### HTTP (1M-resource database, app process measured via /proc)

| Request | Concurrency | Throughput | p50 / p95 / p99 latency | App CPU per request | Bytes per response | App peak RSS | Statuses |
|---|---:|---:|---:|---:|---:|---:|---|
| tiles after | 16 | 1133.2 req/s | 13.1 / 23.4 / 33.4 ms | 0.85 ms | 28.3 KB | 245 MB | 200×22671 |
| workspace/graph before | 1 | 0 req/s | 272749.7 / 272749.7 / 272749.7 ms | 39990 ms | 0.0 KB | 1027 MB | 200×1 |
| workspace/graph after | 1 | 903 req/s | 0.8 / 2.2 / 5.4 ms | 0.85 ms | 0.1 KB | 136 MB | 413×9027 |
| canvas-2000 anonymous before | 4 | 124.3 req/s | 28.9 / 46.9 / 67.5 ms | 6.7 ms | 0.1 KB | 1057 MB | 403×2488 |
| canvas-2000 anonymous after | 4 | 940.1 req/s | 3.9 / 6.9 / 9.6 ms | 0.82 ms | 0.1 KB | 215 MB | 403×18802 |
| canvas-2000 owner before | 4 | 30.2 req/s | 105.5 / 215.9 / 310.2 ms | 30.69 ms | 1.2 MB | 1194 MB | 200×606 |
| canvas-2000 owner after | 4 | 53 req/s | 73.2 / 110.5 / 147 ms | 18.53 ms | 671.7 KB | 311 MB | 200×1063 |
| canvas-20000 anonymous before | 4 | 17 req/s | 228.6 / 304.1 / 371.6 ms | 64.37 ms | 0.1 KB | 415 MB | 403×343 |
| canvas-20000 anonymous after | 4 | 208.7 req/s | 18.4 / 26.2 / 31.5 ms | 1.45 ms | 0.1 KB | 151 MB | 403×4178 |
| canvas-20000 owner before | 4 | 3.7 req/s | 983.9 / 1756.9 / 1878.6 ms | 304.62 ms | 12.5 MB | 411 MB | 200×78 |
| canvas-20000 owner after | 4 | 5.7 req/s | 690.7 / 993.4 / 1069.7 ms | 191.37 ms | 6.7 MB | 417 MB | 200×117 |
| home before | 1 | 0 req/s | 127444.5 / 127444.5 / 127444.5 ms | 18260 ms | 31.5 KB | 1054 MB | 200×1 |
| home after | 1 | 0 req/s | 24564.3 / 25426 / 25426 ms | 14286.67 ms | 31.5 KB | 1427 MB | 200×3 |

### Graph, in-process (legacy JSON vs tile pyramid; fresh process per row)

| Variant | Nodes | Server work | Peak RSS | First view (gz) | Detail view (gz) | Notes |
|---|---:|---:|---:|---:|---:|---|
| legacy JSON | 10,000 | 140 ms **per request** | 130 MB | 341.2 KB | (same) | 2.3 MB raw JSON, 29,596 links |
| tiled | 10,000 | 198 ms **once** (layout 18, pyramid 112, encode+gz 68) | 113 MB | 4.4 KB | 40.5 KB | 33 tiles / 5 levels, max tile 43.2 KB (988 nodes), total 482.3 KB |
| legacy JSON | 100,000 | 1328 ms **per request** | 319 MB | 3.5 MB | (same) | 23.9 MB raw JSON, 294,855 links |
| tiled | 100,000 | 1359 ms **once** (layout 101, pyramid 866, encode+gz 392) | 175 MB | 7.9 KB | 39.6 KB | 367 tiles / 7 levels, max tile 72.7 KB (1012 nodes), total 4.8 MB |
| legacy JSON | 1,000,000 | 18035 ms **per request** | 2248 MB | 36.3 MB | (same) | 247.9 MB raw JSON, 2,949,627 links |
| tiled | 1,000,000 | 11759 ms **once** (layout 456, pyramid 7901, encode+gz 3402) | 558 MB | 14.7 KB | 43.0 KB | 3533 tiles / 9 levels, max tile 96.4 KB (1024 nodes), total 48.5 MB |

### Same, with the app container heap cap (`--max-old-space-size=192`)

| Variant | Nodes | Server work | Peak RSS | First view (gz) | Detail view (gz) | Notes |
|---|---:|---:|---:|---:|---:|---|
| legacy JSON | 10,000 | 185 ms **per request** | 128 MB | 341.2 KB | (same) | 2.3 MB raw JSON, 29,596 links |
| tiled | 10,000 | 192 ms **once** (layout 19, pyramid 122, encode+gz 51) | 109 MB | 4.4 KB | 40.5 KB | 33 tiles / 5 levels, max tile 43.2 KB (988 nodes), total 482.3 KB |
| legacy JSON | 100,000 | 1465 ms **per request** | 291 MB | 3.5 MB | (same) | 23.9 MB raw JSON, 294,855 links |
| tiled | 100,000 | 1305 ms **once** (layout 89, pyramid 841, encode+gz 375) | 178 MB | 7.9 KB | 39.6 KB | 367 tiles / 7 levels, max tile 72.7 KB (1012 nodes), total 4.8 MB |
| legacy | 1,000,000 | — | — | — | — | **OOM (heap cap 192 MB)** |
| tiled | 1,000,000 | 12480 ms **once** (layout 520, pyramid 8408, encode+gz 3552) | 542 MB | 14.7 KB | 43.0 KB | 3533 tiles / 9 levels, max tile 96.4 KB (1024 nodes), total 48.5 MB |

---

## 6. Operating it

```sh
npm run migrate:up        # 0016_graph_tiles: graph_nodes, graph_scopes, graph_tiles,
                          # graph_dirty_gids, slug index, change-tracking triggers
npm run graph:build       # first build (or let the worker do it)
npm run worker            # keeps pyramids fresh (startGraphMaintenance)
```

| Variable | Default | Meaning |
|---|---|---|
| `GRAPH_TILES` | on | `off` disables the worker's maintenance loop |
| `GRAPH_TILES_INTERVAL_MS` | 30000 | how often the worker checks for dirty scopes |
| `GRAPH_TILES_SETTLE_MS` | 20000 | a scope must be dirty this long before a rebuild (debounce) |
| `GRAPH_TILE_MAX_AGE` | 60 | seconds a clean tile may be reused before revalidation |
| `LEGACY_GRAPH_MAX_NODES` | 20000 | above this the whole-graph JSON endpoint answers 413 |
| `CANVAS_ENRICH_LIMIT` | 300 | resource nodes above which canvas responses are `lite` |

Builds never run in the app process: `enqueue()` falls back to running jobs
inline when the queue is off, so the graph refresh is a poll in the worker,
not a queue job. Without a worker the graph simply stays in the classic view
(no pyramid, `meta.layers` empty).

---

## 7. Limits and next steps

Honest boundaries of what is implemented:

- **Rebuilds are O(N).** Any change eventually triggers a full rebuild of the
  affected scope (~30 s for the 900k-node public layer, ~100 s cold including
  layout). Reads stay correct and fast meanwhile (§2.5), so this is freshness
  latency, not a correctness issue. Next: *incremental subtree rebuilds* —
  Morton tiles make a change's affected region explicit (its leaf, its
  ancestors, tiles holding its edges), and internal-tile aggregates are
  additive, so ancestors can be recomputed from their children in
  O(depth × lattice) instead of from all items.
- **Builder memory** is ~0.8 GB at 1M resources (titles, ids and maps as JS
  strings). It runs in the worker, not the app; a streaming per-region build
  would bound it.
- **Shared-with-me overlay is nodes only.** Edges are not persisted (the
  builder computes them per build), so overlay nodes have no links drawn. A
  persisted edge table (also needed for the page shell, below) fixes both.
  A group that shares a very large subtree would be better served by a
  per-group pyramid than by the per-request overlay.
- **Page shell is still O(N) — the largest remaining cost.** The home,
  folder and tag pages load every visible resource to build the sidebar tree,
  backlinks and contextual graph (`listWorkspaceResourceCandidates` +
  `filterViewableResources`), although they render ~30 KB of HTML from it. At
  1M resources, after the query fix above, a home view is still ~25 s and
  ~1.4 GB peak RSS (8 s SQL, ~3 s row parsing, the rest engine batch checks
  and tree building), so **at that size the graph is reached through a page
  that does not fit the app's budget.** The fix is structural and follows the
  graph's: the tree becomes lazy per-folder listings (children of one folder,
  engine-checked, with "has visible descendants" from the scope projection);
  the contextual graph and backlinks become indexed lookups on `graph_nodes`
  plus a persisted edge table; the active document is resolved by id/slug
  index. Each is then O(page), not O(workspace).
- **Canvases above ~200k nodes.** The editor keeps the document in memory
  (virtualisation makes rendering O(view), but load/save/history are O(N)).
  The spatial pyramid already supports rectangles (`rects` mode, tested), so
  the path to streaming very large boards is: index nodes into a
  `canvas_items` table on save, serve far-zoom tiles from a rect pyramid and
  near-zoom detail by bounding-box query, and save diffs instead of documents.
- **Labels** in the tiled view are drawn with Canvas 2D text; a glyph-atlas
  WebGL label pass would remove the last per-frame text cost on slow devices.
