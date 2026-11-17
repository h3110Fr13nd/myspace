# Plan 25: Next-Generation WYSIWYG Component Editor Architecture

> **Document**: State-of-the-Art Visual Component Authoring & Ergonomic UX Specification  
> **Location**: `plan/initial/25-next-gen-wysiwyg-component-editor-architecture.md`  
> **Status**: Approved Architectural Plan  
> **Builds On**: [Plan 13 (Novel TipTap Editor)](13-novel-tiptap-wysiwyg-editor.md), [Plan 21 (Canvas Studio)](21-canvas-editor-creator-studio.md), [Plan 23 (Spatial Performance)](23-canvas-performance-and-feature-roadmap.md), [Plan 24 (Cloudflare DO Collaboration)](24-cloudflare-durable-objects-collaboration-architecture.md)  
> **Core Goal**: Transform the editing experience into an intuitive, Notion/Craft/Linear-tier visual workspace that effortlessly edits and previews custom workspace components (Bases queries, Infinite Canvases, Sheets, Mermaid diagrams, Transclusions, and ReBAC metadata).

---

## 🔍 1. Current State vs. Target State: Honest Audit

### Where We Are Today
1. **Rudimentary `MDXComponentNode`**: Shows only a static `<MyComponent />` pill with raw text inputs for props and a placeholder saying *"Visual preview would render here"*. No interactive preview, no prop validation, no visual component picker.
2. **Missing Workspace Component Nodes**:
   - **Bases / Dataview Queries**: No visual block to build dynamic queries; users must manually type complex code blocks.
   - **Spatial Canvas Embeds**: No native block to embed or preview interactive `.canvas` boards inside documents.
   - **Interactive Spreadsheets / Tables**: Missing rich table management (resizing columns, adding rows, formula headers).
   - **Mermaid Diagrams**: Plain code blocks without live interactive SVG rendering.
   - **PDF / Google Drive Resource Cards**: Embeds are basic text links without rich preview cards or modal viewers.
3. **Ergonomic Friction**:
   - Slash menu is positioned statically instead of anchoring to the caret using `@floating-ui/dom`.
   - Bubble menu only supports Bold, Italic, and Code (no Headings, Colors, Alignment, or "Turn into" conversion).
   - Missing Notion-style 6-dot drag handle (`::`) on hover for 1-click block dragging, copying block anchor IDs (`^blockid`), or deleting.
   - Metadata is an awkward form on top instead of an integrated Notion-style document header (icon, status, tags, ReBAC visibility).
   - No Split-View or Raw Markdown toggle for power users who want to review or tweak MDX code directly.

---

## 🎨 2. The Next-Gen Editor Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              NEXT-GEN WYSIWYG COMPONENT EDITOR                                          │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  [Document Header: Icon 🧠 | Title: Neural Attention Dynamics | Tags: #ai #research | 🌐 Public ]      │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│  [::]  # Neural Attention Dynamics                                                                     │
│                                                                                                        │
│  [::]  We analyze multi-head sparse attention across distributed tensor shards.                        │
│                                                                                                        │
│  [::]  ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │
│        │ 📊 BASES / DATAVIEW DYNAMIC QUERY                                          [⚙️ Configure] [⟳]│   │
│        │ FROM #agentic_ai WHERE type = 'canvas' SORT lastModified DESC LIMIT 3                    │   │
│        │ ┌──────────────────────┬──────────────────────┬──────────────────────┐                    │   │
│        │ │ 🗺️ System Arch      │ 🤖 Multi-Agent Loop  │ ⚡ Vector Pipeline   │                    │   │
│        │ │ 12 nodes · 8 edges   │ 24 nodes · 18 edges  │ 9 nodes · 6 edges    │                    │   │
│        │ └──────────────────────┴──────────────────────┴──────────────────────┘                    │   │
│        └──────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                        │
│  [::]  ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │
│        │ 🗺️ SPATIAL CANVAS EMBED: "Distributed Memory Graph"                       [🔍 Studio View]│   │
│        │ ┌────────────────────────────────────────────────────────────────────────────────────┐   │   │
│        │ │  [Interactive Mini-Canvas Viewport: Pan/Zoomable, Node Hover Cards]                │   │   │
│        │ └────────────────────────────────────────────────────────────────────────────────────┘   │   │
│        └──────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                        │
│  [::]  ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │
│        │ 📐 MERMAID ARCHITECTURE FLOW                                               [Toggle Source]│   │
│        │ graph TD: Client --> EdgeWorker --> DurableObject --> SQLite                                │   │
│        │ [Live Rendered Glassmorphic SVG Graph]                                                │   │
│        └──────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                        │
│  [::]  > [!NOTE]                                                                                       │
│        > All CRDT mutations persist in real time via Cloudflare Durable Objects.                       │
│                                                                                                        │
│        /|  <--- Caret Slash Trigger                                                                   │
│        ┌──────────────────────────────────────────────────┐                                           │
│        │ ⚡ INSERT COMPONENT OR BLOCK                      │                                           │
│        ├──────────────────────────────────────────────────┤                                           │
│        │ 📊 Bases Dynamic Query    - Embed filtered notes │                                           │
│        │ 🗺️ Spatial Canvas Board   - Embed interactive map│                                           │
│        │ 📐 Mermaid Diagram        - Live visual flowchart│                                           │
│        │ 💡 Callout Box            - Highlighted alert box│                                           │
│        │ 📄 PDF / Drive Embed      - Visual file card     │                                           │
│        │ 🧮 Math Formula (KaTeX)   - LaTeX equation       │                                           │
│        │ 📋 Interactive Sheet/Grid - Tabular data table   │                                           │
│        └──────────────────────────────────────────────────┘                                           │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 3. Custom Interactive Workspace Nodes

### 3.1 Bases Query Node (`BasesNode.tsx`)
- **Visual Appearance**: Glassmorphic block with an interactive query builder toolbar and live preview table/grid.
- **In-Editor Controls**:
  - Filter by `Category`, `Tags` (multi-select), `Type` (`document`, `canvas`, `pdf`, `sheet`).
  - Layout Selector: `Table`, `Grid Cards`, or `Bullet List`.
  - Field Selector: Toggle columns (`title`, `category`, `tags`, `lastModified`, `author`).
- **Storage Serialization**: Serializes cleanly to standard Markdown code blocks:
  ````markdown
  ```bases
  from: #agentic_ai
  type: canvas
  layout: grid
  limit: 6
  ```
  ````

### 3.2 Spatial Canvas Node (`CanvasNode.tsx`)
- **Visual Appearance**: Embeds a live, interactive mini-viewport of any `.canvas` board in the workspace.
- **Features**:
  - Live preview rendered using our ultra-fast `EdgeRenderer` (Canvas 2D) and `rbush` spatial culling engine.
  - Interactive pan/zoom directly inside the note or fixed thumbnail snapshot.
  - Quick action: **"Open in Spatial Studio"** button opening the full editor in a side drawer or new tab.
  - Dropdown to select existing canvas boards or create a new board in 1 click.
- **Storage Serialization**:
  ```markdown
  ![[SystemArchitecture.canvas]]
  ```

### 3.3 Mermaid Diagram Node (`MermaidNode.tsx`)
- **Visual Appearance**: Dual-tab block displaying **Live SVG Diagram** with an instant toggle to **Source Code**.
- **Features**:
  - Live syntax validation with helpful error tooltips.
  - Export diagram as SVG / PNG.
  - Zoom & pan controls for complex flowcharts and sequence diagrams.
- **Storage Serialization**:
  ````markdown
  ```mermaid
  graph LR
    User --> EdgeWorker
    EdgeWorker --> DurableObject
  ```
  ````

### 3.4 Interactive Sheet / Table Node (`SheetNode.tsx`)
- **Visual Appearance**: Spreadsheet grid powered by `SheetGrid.tsx`.
- **Features**:
  - Add / remove columns and rows with hover `+` buttons.
  - Column data typing: `Text`, `Number`, `Tag`, `Date`, `Checkbox`.
  - Inline sorting and CSV export.
- **Storage Serialization**: Standard GitHub Flavored Markdown (GFM) tables or embedded JSON.

### 3.5 Rich Callout Node (`CalloutNode.tsx` Redesign)
- **Visual Appearance**: Modern glassmorphic callout box with vibrant colored border, custom emoji picker, and expandable title.
- **Features**:
  - 5 presets: `Note` (Cyan), `Tip` (Emerald), `Warning` (Amber), `Danger` (Rose), `Important` (Indigo).
  - 1-click type switcher dropdown.
  - Collapsible callout toggle (`> [!note]- Collapsible Title`).

### 3.6 Transclusion & Block Embed Node (`TransclusionNode.tsx`)
- **Visual Appearance**: Clean embedded card transcluding another note, section, or block.
- **Features**:
  - Supports `![[note]]` (full note), `![[note#Heading]]` (specific section), and `![[note#^blockid]]` (single paragraph or block).
  - Visual breadcrumb linking back to the source note.
  - Live editable transclusions (bi-directional sync) or read-only badge.

---

## ⚡ 4. Ergonomic UX & Interaction Polish

### 4.1 Caret-Anchored Floating Slash Menu (`/`)
- Powered by `@floating-ui/dom`:
  - Dynamically calculates the exact cursor bounding box using `window.getSelection()`.
  - Flips and shifts automatically so it never clips off-screen.
  - Grouped categories:
    - **Common**: Paragraph, H1, H2, H3, Bullet List, Numbered List, Checklist.
    - **Workspace Components**: Bases Dynamic Query, Spatial Canvas, Interactive Sheet, Mermaid Flowchart.
    - **Media & Embeds**: Upload Image (MinIO), Embed PDF, Google Drive Doc, Vault Note Embed.
    - **Advanced**: KaTeX Math, Code Block, Callout Alert, Divider.
  - Full keyboard navigation: `↑` / `↓` arrow keys, `Enter` to insert, `Esc` to dismiss.

### 4.2 Floating Bubble Formatting Toolbar
- Appears smoothly when text is highlighted:
  - **Text Formatting**: Bold, Italic, Strikethrough, Inline Code, Highlight (color picker).
  - **Turn Into Dropdown**: Instantly convert a paragraph into H1, H2, H3, Bullet, Task, or Callout.
  - **Wikilink Insertion**: Search notes with instant preview.
  - **Create Block Anchor**: Automatically assigns a unique `^block-id` to the current paragraph.

### 4.3 Notion-Style 6-Dot Drag Handle (`::`)
- Appears in the left margin when hovering over any block:
  - **Drag**: Reorder blocks with smooth drop indicators.
  - **Click**: Opens contextual Block Menu:
    - 🗑️ Delete Block
    - 📋 Duplicate Block
    - 🔗 Copy Block Anchor Link (`#^blockid`)
    - 🔄 Turn Into...
    - 🎨 Background Color / Highlight

### 4.4 Notion-Style Integrated Document Header
- Replaces the cluttered form at the top with a sleek document header:
  - **Icon**: Clickable emoji picker (e.g. 🧠, ⚡, 📝).
  - **Title**: Large, borderless, auto-expanding title (`font-size: 2.2rem; font-weight: 800`).
  - **Properties Drawer**: Collapsible properties table:
    - **Category**: Dropdown selector.
    - **Tags**: Multi-select pills with instant autocomplete.
    - **Visibility**: 1-click ReBAC toggle (`🌐 Public` vs `🔒 Private`).
    - **Backlinks & Canvas References**: Shows all canvases and notes referencing this document.

### 4.5 Tri-Mode Editor Views (WYSIWYG / Split / Source)
- Header mode switcher:
  1. **Visual Mode (Default)**: 100% rich visual WYSIWYG editing with all custom component blocks rendered.
  2. **Split Mode**: Side-by-side view with visual editor on the left and live-synced Raw Markdown/MDX on the right.
  3. **Raw Source Mode**: Fullscreen editor with syntax highlighting for power users.

---

## 🔒 5. Real-Time Collaboration & Cloudflare DO Integration

- Integrates with **Plan 24** (Cloudflare Durable Objects):
  - **Yjs ProseMirror Binding**: Uses `@tiptap/extension-collaboration` and `@tiptap/extension-collaboration-cursor`.
  - **Live Remote Cursors**: Displays collaborators' colored carets and real-time selection highlights.
  - **Awareness Bar**: Top right displays active collaborator avatars (`User A`, `User B`) with live editing indicators.
  - **Conflict-Free Convergence**: Simultaneous typing, block dragging, and property changes merge cleanly with zero race conditions.

---

## 🛠️ 6. Implementation Roadmap

### Phase 1: Core UX Polish & Menu Anchoring
1. Anchor `SlashCommandMenu` and `BubbleMenu` using `@floating-ui/dom`.
2. Add Notion-style 6-dot drag handle (`GlobalDragHandle`) with block actions.
3. Redesign Document Header into a Notion-style property inspector (Icon, Title, Tags, Visibility).

### Phase 2: Custom Component Nodes
1. **Bases Node**: Implement `BasesNode.tsx` with visual query builder and live table/grid preview.
2. **Canvas Embed Node**: Implement `CanvasNode.tsx` rendering interactive canvas mini-maps.
3. **Mermaid Node**: Implement `MermaidNode.tsx` with live SVG rendering and source editor toggle.
4. **Interactive Sheet Node**: Implement `SheetNode.tsx` wrapping `SheetGrid.tsx`.
5. **Transclusion Node**: Implement `TransclusionNode.tsx` resolving `#Heading` and `#^blockid` transclusions.

### Phase 3: Tri-Mode View & Markdown Roundtrip
1. Add Tri-Mode toggle (Visual / Split / Raw Source) in editor toolbar.
2. Ensure lossless bi-directional serialization between TipTap AST and Obsidian/MDX Markdown.

### Phase 4: Durable Object Collaboration Binding
1. Connect `NovelEditor` to Cloudflare DO room (`note:{resourceId}`).
2. Verify multi-tab real-time typing and cursor awareness.

---

## 🧪 7. Verification & Success Metrics

1. **Component Insertion**: Type `/bases`, configure a query in the UI, and verify the live table renders immediately.
2. **Canvas Embed**: Type `/canvas`, pick an existing board, and verify interactive pan/zoom works inside the note.
3. **Ergonomic Test**: Highlight text, verify the bubble menu appears smoothly without jitter. Drag a block with `::` and verify order updates.
4. **Lossless Roundtrip**: Save a document containing all custom blocks, reload the page, and verify all components rehydrate perfectly without syntax corruption.


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🔭 Future Roadmap (Active Evolution) | **Track**: Extensible Component Authoring

- [x] Tri-Mode Editor (Visual / Split / Raw Source)
- [x] Bi-directional Markdown serializer with YAML frontmatter preservation
- [x] Custom slash menu extensions for callouts, math, and code
- [ ] Interactive live Bases/Dataview block editor inside TipTap
- [ ] Direct interactive canvas embedding inside note blocks
- [ ] Real-time multiplayer collaboration integration (via Plan 24)
