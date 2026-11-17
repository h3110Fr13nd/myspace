# Plan 21: Spatial Canvas Editor & Creator Studio (JSON Canvas v1.0)

> **Document**: Interactive Canvas Authoring, Visual Wiring & Studio Editor Specification  
> **Location**: `plan/initial/21-canvas-editor-creator-studio.md`  
> **Spec**: [JSON Canvas v1.0](https://jsoncanvas.org/spec/1.0/) Standard  
> **Builds On**: [Plan 5 (Everything is a Resource)](5-everything-is-a-resource-architecture.md) & [Plan 6 (Canvas Builder & Viewer)](6-canvas-builder-viewer.md)  
> **Status**: Ready for Implementation  

---

## 🎨 1. Executive Summary & Vision

We are expanding the workspace's spatial capabilities from a high-performance **Viewer** into a full-fledged **Spatial Canvas Studio & Editor**.

The Canvas Studio allows authors, researchers, and bloggers to:
1. **Create New Canvases** from scratch (`/studio/canvas/new` or `/studio/canvas/[id]`).
2. **Visually Orchestrate Any Workspace Resource**: Drag-and-drop Papers, nested Canvases, Documents, Blog Posts, PDFs, Spreadsheets, and Images onto an infinite spatial board.
3. **Draw Semantic Bezier Connections**: Interactive port-to-port edge wiring with customizable arrowheads, color presets (`1` to `6`), and relation labels (`"extends"`, `"benchmarks with"`, `"implements"`).
4. **Author Rich Nodes In-Place**: Double-click text nodes to edit Markdown and KaTeX math with live preview.
5. **Obsidian Compatibility**: Export and import standard `.canvas` files seamlessly to and from Obsidian vaults.
6. **Strict ReBAC Enforcement**: Only authorized users (`owner` or `editor` relation via OpenFGA) can modify or publish canvases.

---

## 🏛️ 2. Architectural Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                        SPATIAL CANVAS STUDIO ARCHITECTURE                                       │
│                                                                                                 │
│  [Top Toolbar]                                                                                  │
│  [ 🖱️ Select ] [ ✋ Pan ] [ ➕ Text ] [ 📦 Resource Picker ] [ 🗂️ Group ] [ 🔗 Edge Mode ]        │
│  [ ↩ Undo ] [ ↪ Redo ] | [ 🪄 Auto-Layout ] [ 💾 Save Canvas ] [ 📤 Export .canvas ] [ 👁️ Preview ] │
├─────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│                                             │  [Right Property & Entity Inspector]              │
│  ┌───────────────────────────────────────┐  │  ┌──────────────────────────────────────────────┐ │
│  │ Infinite Drag-and-Drop Canvas Board   │  │  │ Selected Node: paper:paper-01                │ │
│  │                                       │  │  │ Title: [Towards an Agentic AI Design...]     │ │
│  │   ┌─────────────┐                     │  │  │ Type:  ● Research Paper                      │ │
│  │   │ Text Node   │                     │  │  │ Dimensions: W: [340]  H: [200]               │ │
│  │   └──────┬──────┘                     │  │  │ Position:   X: [120]  Y: [240]               │ │
│  │          │ "defines" (bezier arrow)   │  │  │ Color:      [5: Cyan ▾]                      │ │
│  │          ▼                            │  │  │ ReBAC:      ● Public (Viewer: user:*)        │ │
│  │   ┌─────────────┐                     │  │  ├──────────────────────────────────────────────┤ │
│  │   │ 🎨 Canvas   │                     │  │  │ Edge Connection Inspector:                   │ │
│  │   │ Track Node  │                     │  │  │ From: Paper 01 (right port)                  │ │
│  │   └─────────────┘                     │  │  │ To:   Paper 05 (left port)                   │ │
│  │                                       │  │  │ Label: [evaluates against                  ] │ │
│  │   [Hover Port Circles ●]              │  │  │ Color: [6: Purple ▾]  Arrow: [-> Arrow]      │ │
│  └───────────────────────────────────────┘  │  └──────────────────────────────────────────────┘ │
├─────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│  [Bottom Mini-Map & Viewport Status]                                                            │
│  Viewport: X: 40px Y: 120px Zoom: 90% | Selected: 1 node, 0 edges | Auto-save: Saved 2s ago      │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                      │
                         CanvasStore (Undo/Redo Stack)
                                      ▼
        ┌────────────────────────────────────────────────────────┐
        │        Persistence & Synchronization Engine            │
        │  1. PostgreSQL `resources` table (metadata.canvasData) │
        │  2. Local Vault Disk: `content/{user}/canvas/*.canvas` │
        │  3. S3 / MinIO Object Storage (`canvas/{id}.canvas`)   │
        └────────────────────────────────────────────────────────┘
```

---

## 📐 3. Spec Compliance & Data Models

Strict compliance with the [JSON Canvas v1.0 Specification](https://jsoncanvas.org/spec/1.0/):

```typescript
// ─── Preset Color Mapping ─────────────────────────────────────────────────────
export type CanvasColorCode = '1' | '2' | '3' | '4' | '5' | '6' | `#${string}`;
// 1 = Red/Rose, 2 = Orange, 3 = Yellow, 4 = Green, 5 = Cyan, 6 = Purple

export type CanvasPortSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEndStyle = 'none' | 'arrow';

// ─── Polymorphic Canvas Nodes ─────────────────────────────────────────────────
export interface BaseCanvasNode {
  id: string;             // 16-character unique identifier
  type: 'text' | 'file' | 'link' | 'group' | 'resource';
  x: number;              // Absolute grid coordinate (px)
  y: number;
  width: number;
  height: number;
  color?: CanvasColorCode;
}

export interface TextCanvasNode extends BaseCanvasNode {
  type: 'text';
  text: string;           // Markdown and LaTeX supported
}

export interface GroupCanvasNode extends BaseCanvasNode {
  type: 'group';
  label?: string;
  background?: string;    // Image URL or texture
  backgroundStyle?: 'cover' | 'ratio' | 'repeat' | 'fill';
}

export interface LinkCanvasNode extends BaseCanvasNode {
  type: 'link';
  url: string;
}

export interface FileCanvasNode extends BaseCanvasNode {
  type: 'file';
  file: string;           // Vault relative path (e.g., "canvas/track-1.canvas")
  subpath?: string;
}

// Workspace First-Class Resource Extension (Plan 5 & 6)
export interface ResourceCanvasNode extends BaseCanvasNode {
  type: 'resource';
  resourceId: string;     // e.g., "paper:paper-01", "canvas:track-2", "document:arch"
  resourceType?: string;  // Hint: 'paper' | 'canvas' | 'document' | 'pdf' | 'sheet'
  label?: string;
  embedPreview?: boolean;
}

export type CanvasNode = TextCanvasNode | GroupCanvasNode | LinkCanvasNode | FileCanvasNode | ResourceCanvasNode;

// ─── Edges & Connections ──────────────────────────────────────────────────────
export interface CanvasEdge {
  id: string;             // e.g., "e_1726354891"
  fromNode: string;
  fromSide?: CanvasPortSide;
  fromEnd?: CanvasEndStyle;
  toNode: string;
  toSide?: CanvasPortSide;
  toEnd?: CanvasEndStyle;
  color?: CanvasColorCode;
  label?: string;         // Semantic relation description
}

export interface JsonCanvasFile {
  title?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
```

---

## 🛠️ 4. Interactive Studio Features

### 4.1 Resource Picker & Search Palette
When clicking **[ 📦 Resource Picker ]**:
- Opens a fuzzy search modal populated by `/api/v1/search`.
- Filter tabs: **All** | **Papers** | **Canvases** | **Documents** | **PDFs** | **Sheets**.
- Displays thumbnail, title, category, and author.
- Single-click drops the chosen resource onto the current viewport center with pre-configured width (340px) and height (200px).

### 4.2 Interactive Port Handles & Edge Wiring
- Hovering any node reveals 4 circular connection ports (Top, Right, Bottom, Left).
- **Drag-to-Connect**:
  1. Click and drag from any port circle.
  2. A live glowing bezier guide line follows the cursor.
  3. Valid target ports on other nodes pulse green.
  4. Releasing over a target port creates a new edge and immediately opens an inline relation label popover.

### 4.3 Node Manipulation & Grid Snapping
- **Pointer Capture Mechanics**: High-performance pointer tracking with 20px grid snapping.
- **Resize Handles**: 4 corner handles and 4 edge handles with minimum constraint (140px × 80px).
- **Multi-Selection**: Rubberband selection box or Shift+Click to select, drag, or delete multiple nodes together.
- **Z-Index Layering**: Group nodes automatically drop to background layer (`z-index: 1`), while content nodes remain on top (`z-index: 3`).

### 4.4 Automated Graph Layouts (DAG / Tree)
- Integrated graph layout algorithms (powered by `dagre` or `d3-hierarchy`):
  - **Hierarchical Top-to-Bottom**: Best for sequential reading tracks and workflow DAGs.
  - **Left-to-Right Pipeline**: Best for architectural offloading and data pipelines.
  - **Radial Cluster**: Groups related papers around central methodological hubs.

### 4.5 Undo/Redo Command Stack
- Full state history tracking up to 50 actions:
  - Add Node, Delete Node, Move Node, Resize Node
  - Connect Edge, Delete Edge, Edit Edge Label
  - Standard shortcuts: `Ctrl+Z` (Undo), `Ctrl+Y` / `Ctrl+Shift+Z` (Redo), `Ctrl+S` (Save).

---

## 🔌 5. API Endpoints Specification

### 1. `POST /api/v1/resources/canvas` (Create Canvas)
- **Body**: `{ title: string, parentId?: string, isPublic?: boolean, initialData?: JsonCanvasFile }`
- **ReBAC**: Requires authenticated user. Writes `owner` relation to OpenFGA.
- **Returns**: `{ id: "canvas:<slug>", url: "/studio/canvas/<slug>" }`

### 2. `PUT /api/v1/resources/canvas/[id]` (Save Canvas)
- **Body**: `{ nodes: CanvasNode[], edges: CanvasEdge[], title?: string }`
- **ReBAC**: Verifies `canUserEditResource(canvasId, currentUser)` (must be owner or editor).
- **Action**:
  - Updates PostgreSQL `resources.metadata->'canvasData'` and recalculates `nodeCount` and `edgeCount`.
  - Writes back to filesystem vault (`content/public_vault/canvas/<id>.canvas` or user vault).
  - Updates OpenFGA wikilinks graph.

### 3. `DELETE /api/v1/resources/canvas/[id]` (Delete Canvas)
- Requires `owner` relation. Deletes row, cleans up storage, and revokes OpenFGA tuples.

### 4. `GET /api/v1/resources/canvas/[id]/export` (Export .canvas)
- Downloads standard JSON Canvas file with `Content-Disposition: attachment; filename="<id>.canvas"`.

---

## 📋 6. Proposed Implementation Phases

### Phase 1: Core Studio Page & Infinite Viewport (`/studio/canvas/[id].astro`)
- Scaffold full-viewport Studio layout with dark glass aesthetic.
- Implement canvas store with pan, zoom, selection state, and undo/redo history.
- Port existing `JsonCanvasRenderer` node and edge drawing into editable equivalents.

### Phase 2: Node Creation & Resource Palette
- Add top toolbar with mode toggles (Select, Pan, Add Text, Add Resource, Add Group).
- Build `ResourcePickerModal.tsx` querying `/api/v1/search`.
- Double-click background to create quick text node; double-click text node to edit in-place.

### Phase 3: Visual Edge Connection & Port Handles
- Implement port hover circles on 4 sides of nodes.
- Pointer-drag line generator with snap-to-port detection.
- Floating popover for edge relation label and color picker.

### Phase 4: Persistence, Auto-Save & ReBAC Guardrails
- Implement `PUT /api/v1/resources/canvas/[id]` with schema validation.
- Auto-save debounced every 2 seconds with "All changes saved" indicator.
- OpenFGA editor permission enforcement.

### Phase 5: Auto-Layout & Obsidian Export
- Implement DAG auto-layout buttons (Hierarchy, Horizontal, Radial).
- Obsidian export button generating clean `.canvas` download.

---

## 🧪 7. Verification & Quality Gates
1. **Spec Validity**: All authored canvases validate against `scripts/validate_canvases.py` with 0 errors.
2. **ReBAC Integrity**: Unauthorized users cannot invoke `PUT` or `DELETE` endpoints.
3. **Round-Trip Fidelity**: Creating a canvas in Studio $\rightarrow$ saving $\rightarrow$ opening in Obsidian $\rightarrow$ editing $\rightarrow$ re-importing preserves all nodes, coordinates, colors, and edges without data loss.



---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Fully Implemented | **Feature Track**: Full-Viewport Spatial Canvas Studio

- [x] Dedicated studio route (`src/pages/studio/canvas/[id].astro`)
- [x] Full-viewport pan/zoom canvas board (`CanvasEditor.tsx`, `CanvasBoardShell.tsx`)
- [x] Node drag-to-move, resize handles, and cardinal edge connection ports
- [x] Creation toolbar for Text, File, Link, Group, and polymorphic Resource nodes
- [x] Live Excalidraw integration (`ExcalidrawViewer.tsx`)
- [x] ReBAC permission enforcement for studio editing and saving
