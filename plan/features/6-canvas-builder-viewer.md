# Plan 6: Obsidian-Style Canvas Builder & Viewer

> **Document**: Canvas Studio Full Architecture  
> **Location**: `plan/initial/6-canvas-builder-viewer.md`  
> **Spec**: [JSON Canvas v1.0](https://jsoncanvas.org/spec/1.0/) — compatible  
> **Status**: Ready for Implementation  
> **Builds On**: Plan 5 (Everything is a Resource) — a canvas `canvas:id` is itself a Resource node  

---

## 🗺️ 1. What We're Building

An Obsidian-compatible **spatial canvas system** consisting of:

| Layer | What | Where |
|:---|:---|:---|
| **Viewer** | Read-only zoomable/pannable canvas with rendered nodes, bezier edges, edge labels | `src/components/resources/viewers/CanvasViewer.tsx` |
| **Editor / Studio** | Full interactive drag-and-drop canvas builder (create/move/resize nodes, draw edges, edit labels) | `src/pages/studio/canvas/[id].astro` |
| **API** | CRUD endpoints to read/write `.canvas` JSON from S3/MinIO or filesystem | `src/pages/api/v1/resources/canvas/[id].ts` |
| **Resource Integration** | Each node can be a full workspace Resource (`document:`, `pdf:`, `sheet:`, `image:`, `link:`, `text:`) with inline preview | `src/core/resources/handlers/canvas.handler.ts` |
| **OpenFGA ReBAC** | Node-level permission checks: viewers see redacted card for unauthorized nodes | `src/core/authz/checks.ts` |

---

## 📐 2. JSON Canvas Spec v1.0 (Obsidian Standard)

The system is **100% compatible** with the [JSON Canvas 1.0 spec](https://jsoncanvas.org/spec/1.0/) — `.canvas` files from Obsidian open directly.

### 2.1 Complete Type Model

```typescript
// ─── Color Presets (spec §Color) ──────────────────────────────────────────────
// "1" = Red, "2" = Orange, "3" = Yellow, "4" = Green, "5" = Cyan, "6" = Purple
type CanvasColor = '1' | '2' | '3' | '4' | '5' | '6' | `#${string}`;

// ─── Side / End Enums ─────────────────────────────────────────────────────────
type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
type CanvasEnd  = 'none' | 'arrow';

// ─── Base Node (spec §Generic node) ──────────────────────────────────────────
interface BaseNode {
  id:     string;          // unique 16-char hex recommended
  type:   NodeType;
  x:      number;          // top-left x (infinite canvas, px)
  y:      number;          // top-left y
  width:  number;
  height: number;
  color?: CanvasColor;
}

// ─── Node Types (spec §Nodes) ─────────────────────────────────────────────────
type NodeType = 'text' | 'file' | 'link' | 'group' | 'resource';
//                                                      ^ our extension

interface TextNode extends BaseNode {
  type: 'text';
  text: string;            // Markdown supported
}

interface FileNode extends BaseNode {
  type:     'file';
  file:     string;        // vault-relative path (e.g. "research/paper.md")
  subpath?: string;        // optional heading anchor (#section)
}

interface LinkNode extends BaseNode {
  type: 'link';
  url:  string;            // external URL
}

interface GroupNode extends BaseNode {
  type:             'group';
  label?:           string;
  background?:      string;   // image path
  backgroundStyle?: 'cover' | 'ratio' | 'repeat' | 'fill';
}

// OUR EXTENSION: A node that is a first-class workspace Resource
interface ResourceNode extends BaseNode {
  type:           'resource';
  resourceId:     string;      // e.g. "document:arch-doc", "pdf:q3-report"
  resourceType?:  string;      // hint for icon: 'document' | 'pdf' | 'image' | 'sheet' | 'todo'
  label?:         string;
  embedPreview?:  boolean;     // render inline content preview inside node
}

type CanvasNode = TextNode | FileNode | LinkNode | GroupNode | ResourceNode;

// ─── Edges (spec §Edges) ──────────────────────────────────────────────────────
interface CanvasEdge {
  id:        string;
  fromNode:  string;
  toNode:    string;
  fromSide?: CanvasSide;      // which side of source node the edge exits
  toSide?:   CanvasSide;      // which side of target node the edge enters
  fromEnd?:  CanvasEnd;       // default: 'none'
  toEnd?:    CanvasEnd;       // default: 'arrow'
  color?:    CanvasColor;
  label?:    string;          // relation label on arrow (e.g. "depends on", "cites")
}

// ─── Top-Level Canvas File ────────────────────────────────────────────────────
interface JsonCanvasFile {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
```

---

## 🏗️ 3. Architecture Overview

```
                        .canvas JSON file (S3/MinIO or filesystem)
                                        │
                              CanvasAPI.load(id)
                                        │
                         ┌──────────────▼──────────────┐
                         │      CanvasStore (Zustand)   │
                         │  nodes[], edges[], viewport  │
                         │  selectedIds, dragState      │
                         └──────────────┬──────────────┘
                                        │
              ┌─────────────────────────┼──────────────────────────┐
              │                         │                          │
              ▼                         ▼                          ▼
    ┌──────────────────┐    ┌──────────────────────┐   ┌────────────────────┐
    │  CanvasViewer    │    │   CanvasEditor        │   │ NodePermissionGate │
    │  (read-only)     │    │   (Studio, full CRUD) │   │ (OpenFGA per-node) │
    │  Pan & Zoom      │    │   Drag, Resize, Draw  │   │ Authorize each     │
    │  SVG edges       │    │   Edge connection     │   │ ResourceNode       │
    │  Node cards      │    │   Property inspector  │   │ redact if denied   │
    └──────────────────┘    └──────────────────────┘   └────────────────────┘
              │                         │
              └──────────┬──────────────┘
                         ▼
              ┌──────────────────────────┐
              │   NodeRenderer           │   Polymorphic: renders node based on type
              │   ├── TextNodeCard       │   Markdown → HTML mini-render
              │   ├── FileNodeCard       │   Resolve vault path → ResourceCard
              │   ├── LinkNodeCard       │   OG preview card for URL
              │   ├── GroupNodeCard      │   Visual container rectangle
              │   └── ResourceNodeCard  │   Full Resource integration
              │       ├── DocumentPreview│   First 200 chars rendered md
              │       ├── PdfThumb       │   PDF.js page 1 thumbnail
              │       ├── ImagePreview   │   img with max-height
              │       └── SheetPreview   │   First 5 rows table
              └──────────────────────────┘
```

---

## 📦 4. New Files to Create

```
src/
├── core/
│   └── resources/
│       ├── schemas/
│       │   └── canvas.schema.ts          [NEW] Zod schema for canvas metadata
│       └── handlers/
│           └── canvas.handler.ts         [NEW] Canvas load/save/validate logic
│
├── components/
│   ├── canvas/                           [NEW] Canvas-specific component family
│   │   ├── CanvasStore.ts                [NEW] Zustand store: viewport, selection, drag state
│   │   ├── CanvasViewer.tsx              [REPLACE] Full-featured viewer (pan/zoom/click)
│   │   ├── CanvasEditor.tsx              [NEW] Studio editor (drag, resize, edge draw)
│   │   ├── CanvasToolbar.tsx             [NEW] Mode toggles, add-node buttons, export
│   │   ├── EdgeRenderer.tsx              [NEW] SVG bezier edges with labeled arrows
│   │   ├── NodePermissionGate.tsx        [NEW] OpenFGA check wrapper per node
│   │   └── nodes/                        [NEW] Node-type renderers
│   │       ├── TextNodeCard.tsx
│   │       ├── FileNodeCard.tsx
│   │       ├── LinkNodeCard.tsx
│   │       ├── GroupNodeCard.tsx
│   │       └── ResourceNodeCard.tsx      [NEW] Resource integration node
│   │
│   └── resources/
│       └── viewers/
│           └── CanvasViewer.astro        [MODIFY] Wraps React CanvasViewer island
│
├── pages/
│   ├── studio/
│   │   └── canvas/
│   │       └── [id].astro                [NEW] Full-viewport studio page
│   └── api/v1/
│       └── resources/
│           └── canvas/
│               └── [id].ts               [NEW] Read/write canvas JSON API
```

---

## 🎨 5. CanvasViewer Component Design

### 5.1 Viewport: Pan & Zoom

The canvas must support an **infinite viewport** with pointer events for pan and wheel-zoom:

```typescript
// CanvasStore.ts — Zustand
interface CanvasState {
  // Viewport Transform
  pan:   { x: number; y: number };
  zoom:  number;  // 0.1 → 3.0
  
  // Data
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  
  // Selection (Editor only)
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  
  // Edit Mode
  mode: 'view' | 'select' | 'draw-edge' | 'add-text' | 'add-resource';
  pendingEdge: { fromNodeId: string; fromSide: CanvasSide } | null;
  
  // Actions
  setPan(dx: number, dy: number): void;
  setZoom(z: number, origin?: { x: number; y: number }): void;
  selectNode(id: string, additive?: boolean): void;
  moveNode(id: string, dx: number, dy: number): void;
  resizeNode(id: string, dw: number, dh: number): void;
  addNode(node: CanvasNode): void;
  deleteNode(id: string): void;
  addEdge(edge: CanvasEdge): void;
  deleteEdge(id: string): void;
  updateEdgeLabel(id: string, label: string): void;
}
```

### 5.2 Edge Rendering Strategy

Edges use **cubic bezier curves** with port-aware anchor points based on `fromSide`/`toSide`:

```
Node anchor calculation by side:
  top:    (x + w/2,  y        )
  right:  (x + w,   y + h/2  )
  bottom: (x + w/2, y + h    )
  left:   (x,       y + h/2  )

Bezier control points (distance = 80px in the exit/enter direction):
  CP1 = anchor1 + direction_vector(fromSide) * 80
  CP2 = anchor2 + direction_vector(toSide)   * 80

  SVG: <path d="M x1 y1 C cx1 cy1, cx2 cy2, x2 y2" />
```

**Edge label positioning**: Midpoint of bezier curve (t=0.5), with a glass background pill.

**Arrow heads**: `<marker>` defs with both `'none'` and `'arrow'` styles, colored per `edge.color`.

**Color presets** mapped to our design tokens:
```ts
const COLOR_MAP: Record<string, string> = {
  '1': 'var(--accent-rose)',    // Red
  '2': '#f97316',               // Orange
  '3': '#eab308',               // Yellow
  '4': 'var(--accent-emerald)', // Green
  '5': 'var(--accent-cyan)',    // Cyan
  '6': 'var(--accent-primary)', // Purple
};
```

### 5.3 Node Cards per Type

| Node Type | Card Appearance | Click Action |
|:---|:---|:---|
| `text` | Dark glass card, markdown mini-rendered via `marked` | Expand full panel |
| `file` | Icon + vault filename + first 100 chars | Navigate to `/?doc=document:slug` |
| `link` | OG image preview + domain badge + truncated title | Open URL in new tab |
| `group` | Semi-transparent rectangle w/ dashed border + centered label | Acts as container (no click) |
| `resource` (document) | `📄` icon + title + first 200 char excerpt | Open resource in right panel |
| `resource` (pdf) | `📕` icon + PDF page-1 thumbnail (generated via API) | Open PdfViewer modal |
| `resource` (image) | `🖼️` icon + inline `<img>` preview | Open ImageViewer lightbox |
| `resource` (sheet) | `📊` icon + first 3 rows mini-table | Open SheetViewer |
| `resource` (todo) | `✅` icon + task title + status badge | Open TodoViewer |
| `resource` (canvas) | `🎨` icon + recursive mini canvas thumbnail | Open nested canvas |
| **LOCKED** (no permission) | 🔒 Redacted card, type badge, "Unauthorized" message | No action |

---

## ✏️ 6. Canvas Editor (Studio Mode) Design

The studio (`/studio/canvas/[id]`) is a **full-viewport interactive editor** with:

### 6.1 Toolbar Modes (Top Bar)
```
[ 🖱️ Select ] [ ✋ Pan ] [ ➕ Text ] [ 📄 Resource ] [ 🔗 Link ] [ 🗂️ Group ] | 
[ ↩ Undo ] [ ↪ Redo ] | [ 📤 Export .canvas ] [ 💾 Save ] [ 👁️ Preview Mode ]
```

### 6.2 Interaction Model

| Interaction | Behavior |
|:---|:---|
| **Click background** | Deselect all |
| **Click node** | Select node, show property inspector |
| **Double-click background** | Create new text node at cursor |
| **Double-click text node** | Open inline text editor |
| **Drag node** | Move with snapping to 20px grid |
| **Drag node edge** | Resize node (min 80×40px) |
| **Drag from port circle** | Begin edge draw: highlight valid target ports |
| **Drop edge on port** | Create edge, open edge label popover |
| **Click edge** | Select edge, show edge inspector (label, color, end style) |
| **Delete key** | Delete selected nodes/edges |
| **Ctrl+Z / Ctrl+Y** | Undo/Redo (command history stack) |
| **Ctrl+A** | Select all |
| **Ctrl+D** | Duplicate selected |
| **Scroll wheel** | Zoom in/out at cursor position |
| **Middle-drag / Space+drag** | Pan viewport |
| **Ctrl+0** | Fit all nodes to viewport |
| **Ctrl+Shift+F** | Focus selected node |

### 6.3 Resource Node Picker

When adding a `resource` node, a **Resource Picker Modal** opens:
- Search by title/type with the existing `/api/v1/search` API.
- Filter by type: All / Document / PDF / Image / Sheet / Canvas / Todo.
- Preview card on hover.
- Click to place node at cursor with `embedPreview: true` by default.

### 6.4 Edge Label Editing

Click any edge → inline label input appears at midpoint. The label represents the **semantic relation** between nodes (e.g. "depends on", "cites", "implements", "blocks").

### 6.5 Property Inspector (Right Panel)

```
┌─────────────────────────────────┐
│  Node Properties                │
├─────────────────────────────────┤
│  ID:      node_a3f2b1c4         │
│  Type:    ● resource            │
│  Resource: document:arch-doc    │
│  Label:   [Architecture Doc  ] │
│  Color:   [🟣 Purple ▾]        │
│  Embed:   [✓] Show preview      │
│  W: [320] H: [200]              │
├─────────────────────────────────┤
│  Position                       │
│  X: [40]  Y: [80]               │
└─────────────────────────────────┘
```

---

## 🔌 7. Canvas API Endpoints

### `GET /api/v1/resources/canvas/[id]`
- Loads the `.canvas` JSON from MinIO/S3 or filesystem.
- Checks `viewer` permission on the parent `canvas:id` resource via OpenFGA.
- Returns `{ nodes, edges, resourceId, title, metadata }`.

### `PUT /api/v1/resources/canvas/[id]`
- Requires `editor` permission on `canvas:id`.
- Validates the full canvas JSON against the Zod schema.
- Writes back to storage.
- Updates the `resources` DB row metadata (nodeCount, edgeCount, lastModified).

### `POST /api/v1/resources/canvas/[id]/nodes/permissions`
- Batch-checks OpenFGA `viewer` relations for a list of `resourceId` node IDs.
- Returns `{ [nodeId]: boolean }` permission map for client-side filtering.

---

## 🧠 8. Resource Node Integration

When a `ResourceNode` has `embedPreview: true`, the node body renders a **live inline preview**:

```
Document node (document:arch-doc):
  ┌────────────────────────────────┐
  │ 📄 Architecture Doc            │ ← Title
  │ ─────────────────────────────  │
  │ The workspace is built on an  │ ← First 200 chars (stripped Markdown)
  │ Everything-is-a-Resource       │
  │ paradigm where...              │
  │                                │
  │ [Open Full Document →]         │ ← CTA link
  └────────────────────────────────┘

PDF node (pdf:q3-report):
  ┌────────────────────────────────┐
  │ 📕 Q3 Research Report          │ ← Title
  │ ┌──────────────────────────┐   │
  │ │  [PDF Page 1 Thumbnail]  │   │ ← img from /api/v1/assets/pdf/thumb
  │ └──────────────────────────┘   │
  │ 18 pages · PDF · 2.4 MB        │ ← metadata
  │ [View PDF →]                   │
  └────────────────────────────────┘
```

---

## 📋 9. Implementation Phases

### Phase 1 — Full-featured CanvasViewer (No Editor) 
- Migrate `JsonCanvasRenderer.tsx` → `CanvasViewer.tsx` under `src/components/canvas/`.
- Implement proper pan/zoom via `onPointerDown`/`onWheel`.
- Implement proper port-aware bezier edges with all `fromSide`/`toSide` combos.
- Implement all 5 node types + our `resource` extension.
- Implement `NodePermissionGate` with real `/api/v1/resources/canvas/[id]/nodes/permissions`.
- Wire into `ResourceViewer.astro` dispatcher.

### Phase 2 — Canvas Studio Editor
- Build `CanvasEditor.tsx` with Zustand store.
- Implement node drag/resize with pointer capture API.
- Implement edge draw mode (port circles on hover, drag to target).
- Implement toolbar, undo/redo history stack.
- Build `ResourceNodePicker.tsx` using existing search API.
- Build edge label inline editor and property inspector.
- Create `/studio/canvas/[id].astro` full-viewport page.

### Phase 3 — Persistence & API
- Build `GET/PUT /api/v1/resources/canvas/[id]`.
- Store canvas JSON in MinIO (`canvas/{id}.canvas`).
- Sync canvas metadata to PostgreSQL `resources` table (nodeCount, edgeCount).
- Add `canvas` thumbnail generation API (first-paint SVG snapshot).

### Phase 4 — Nested Canvases & Graph Connections
- `ResourceNode` of `resourceType: 'canvas'` renders a mini recursive thumbnail.
- Backlinks track which canvases embed a given resource node.
- Graph view (`GraphView.tsx`) shows canvas → resource edges from all canvases.

---

## ✅ 10. Open Questions for User

> [!IMPORTANT]  
> Please confirm design choices before Phase 1 implementation begins:

1. **Drag library**: Should we build native pointer-event drag (zero deps) or use a lightweight lib like `@use-gesture/react`?
2. **Storage backend**: Canvas JSON → MinIO bucket (`canvas-files`) or keep in filesystem under `content/{user}/canvas/`?
3. **Editor access**: Is the Studio editor accessible to all authenticated `editor` role users, or only the `owner`?
4. **Nested canvas depth**: Should embedded canvas nodes render a thumbnail or just a link card (prevents infinite recursion)?
5. **Collaboration**: Single-user edit with save button, or future-flag for real-time collaborative editing (Yjs/CRDTs)?


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Core Implemented | **Feature Track**: Spatial JSON Canvas Specification v1.0

- [x] JSON Canvas v1.0 standard node types (`text`, `file`, `link`, `group`, `resource`)
- [x] Interactive Zoom & Pan matrix navigation (`useZoomPan.ts`, `CanvasBoardShell.tsx`)
- [x] Cubic bezier connector curves with arrow markers (`EdgeRenderer.tsx`)
- [x] ReBAC node authorization filtering (hidden or redacted cards for unauthorized entities)
- [x] Studio editor route (`src/pages/studio/canvas/[id].astro`)
- [x] Canvas JSON import/export modal (`CanvasJsonEditorModal.tsx`)
- [ ] Live real-time multiplayer cursor synchronization (Covered under Plan 24)
