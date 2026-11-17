# Comparison & Evolution Plan: Our FOSS Spatial Canvas vs. Miro & FigJam

This document provides a comprehensive architectural and user-experience comparison between our open-source, Postgres-backed, JSON Canvas v1.0 spatial platform and leading proprietary infinite whiteboard tools (**Miro** and **FigJam**). It identifies high-impact features to adopt and details how our platform can leapfrog both by leveraging our unique computational and research-first architecture.

---

## 1. Executive Summary & Core Philosophy

| Dimension | Our FOSS Workspace Canvas | Miro | FigJam (Figma) |
| :--- | :--- | :--- | :--- |
| **Philosophy** | **Computational Knowledge Canvas**: Living research, code execution, open data formats, and self-hosted privacy. | **Enterprise Visual Workspace**: Heavy workshop facilitation, corporate diagramming, and agile workflows. | **Playful Multiplayer Whiteboard**: Lightweight, highly engaging team brainstorming and design handoff. |
| **Data Format** | **Open JSON Canvas v1.0** + Markdown + PostgreSQL (Git versionable). | Proprietary cloud JSON / binary format. | Proprietary Figma document scene graph. |
| **Hosting & Privacy** | **100% Self-hostable**, Dockerized, local-first, zero-telemetry. | Cloud SaaS only. | Cloud SaaS only. |
| **Security Model** | **OpenFGA ReBAC** (fine-grained resource & node-level access control). | Workspace / Board / Team level RBAC. | Figma team / file level permissions. |
| **Computational Depth** | **Live Execution**: Interactive Sheets, Excalidraw, Jupyter notebooks, KaTeX math, Mermaid diagrams. | Static widgets, iframe embeds, read-only charts. | Interactive mini-widgets (JS sandboxed), stickers. |
| **Nesting & Recursion** | **Recursive Sub-Canvases** (canvases inside canvases with depth control). | Frames only (no infinite sub-canvas recursion). | Section grouping (no nested canvases). |

---

## 2. In-Depth Comparative Matrix

### A. Canvas & Node Capabilities

| Feature | Ours | Miro | FigJam | Analysis |
| :--- | :---: | :---: | :---: | :--- |
| **JSON Canvas v1.0 Standard** | 🟢 **Native** | 🔴 No | 🔴 No | Our data is 100% portable and interoperable with Obsidian Canvas and plain text editors. |
| **Interactive Spreadsheets (Sheets)** | 🟢 **Native Grid** | 🟡 Basic Table | 🟡 Basic Table | Ours executes formulas, cell ranges, and CSV import/export directly inside the node card. |
| **Hand-drawn Whiteboard (Excalidraw)** | 🟢 **Integrated** | 🟡 Pen tool only | 🟡 Pen tool only | Full Excalidraw engine embedded as a node or standalone canvas tool. |
| **Nested Sub-Canvases** | 🟢 **Recursive** | 🔴 No | 🔴 No | Allows drill-down exploration of sub-topics without leaving the primary spatial board. |
| **Code & Notebook Execution** | 🟢 **Jupyter + KaTeX** | 🔴 No | 🟡 Mini-widget | We execute real Python cells, syntax highlighting via Shiki, and LaTeX equations. |
| **Sticky Notes & Clustering** | 🟡 Basic Text Notes | 🟢 **Advanced** | 🟢 **Advanced** | Miro/FigJam have rich sticky presets, auto-sorting, and clustering by color/tag. |
| **Frames & Slideshow Mode** | 🟡 Groups | 🟢 **Advanced Frames** | 🟢 **Section Containers** | Miro/FigJam allow sequencing frames into presentation pitch decks. |
| **Obstacle-Avoiding Connectors** | 🟡 Bezier Tangents | 🟢 **Orthogonal / Smart** | 🟢 **Smart Connectors** | Miro/FigJam automatically route edges around intervening cards. |

---

### B. Multiplayer & Facilitation (The Collaborative Experience)

| Feature | Ours | Miro | FigJam | Analysis |
| :--- | :---: | :---: | :---: | :--- |
| **Real-time Collaboration** | 🟢 **Durable Objects + Yjs** | 🟢 WebSockets / CRDT | 🟢 Figma Engine | Real-time multi-cursor and state sync supported via our Cloudflare DO + Yjs workers. |
| **Cursor Chat** | 🔴 Not yet | 🟡 In-app chat | 🟢 **Pioneered / Best** | Typing `/` to display live ephemeral speech bubbles above the cursor creates immediate delight. |
| **Facilitation Kit (Timer, Voting)** | 🔴 Not yet | 🟢 **Best-in-class** | 🟢 Built-in Timer & Music | Crucial for timed sprint planning, design sprints, and academic workshops. |
| **Audio / Huddles** | 🔴 Not yet | 🟡 Video/Audio call | 🟢 Built-in Huddles | FigJam allows spontaneous voice rooms without opening Zoom/Meet. |
| **Spotlight / "Follow Me"** | 🔴 Not yet | 🟢 Presenter Mode | 🟢 Spotlight on User | Presenter can pull all participants' viewports to their screen location. |
| **Stickers, Stamps & Reactions** | 🔴 Not yet | 🟡 Emojis | 🟢 **Delightful / Animated** | FigJam's rubber stamps, confetti, and high-fives drive user engagement. |

---

## 3. High-Value Features to Adopt from Miro & FigJam

### 1. Multiplayer Cursor Chat (From FigJam)
- **Concept**: When a user presses `/`, a live input bubble appears directly attached to their cursor. What they type is broadcasted via Yjs awareness to all active viewers.
- **Why it matters**: Zero-friction micro-communication without opening a side chat drawer or switching windows.

### 2. Workshop Facilitation Kit (From Miro & FigJam)
- **Global Synced Countdown Timer**:
  - Floating widget with minutes/seconds, synced across all connected peers.
  - Optional sound or visual chime on zero.
- **Dot Voting (Upvoting / Polling)**:
  - Facilitator starts a 3-minute voting session with $N$ votes per user.
  - Users click on nodes to cast numbered dots. Results are revealed simultaneously at the end.
- **Presenter Spotlight / "Follow Me" Mode**:
  - One user clicks "Spotlight Me" $\rightarrow$ smooth camera tweening forces all follower viewports to track the presenter's pan and zoom coordinates.

### 3. Dedicated "Sticky Note" Node Primitive (From Miro)
- **Concept**: A distinct node type (`type: "sticky"`) alongside text and resource cards:
  - Square aspect ratio (e.g. 200x200), textured pastel backgrounds (yellow, pink, mint, sky blue, lavender).
  - Auto-shrinking text (font size automatically decreases as content grows so it never overflows).
  - Quick-spawn shortcut: Pressing `Tab` spawns a new sticky to the right; pressing `Enter` spawns one directly below.
  - Tagging and automatic clustering (e.g., "Group all blue stickies together").

### 4. Smart Orthogonal Edge Routing (From Miro & FigJam)
- **Concept**: In addition to smooth Bezier curves, provide **Orthogonal (manhattan-style) 90-degree elbow connectors** that calculate collision bounding boxes and route around intervening nodes.
- **Connection Handles**: 4 cardinal anchor points (Top, Bottom, Left, Right) with hover indicators that let users drag new arrows in one gesture.

### 5. Frames & Linear Presentation Mode (From Miro)
- **Concept**: A `FrameNode` that groups a region of the canvas and assigns it an index (`Frame 1`, `Frame 2`, `Frame 3`).
- **Presentation Player**: Clicking "Present" hides all UI chrome, enters full screen, and lets the user advance frame-by-frame with arrow keys, with cinematic camera pans between steps.

---

## 4. How We Leapfrog Miro and FigJam (Our Unfair Advantages)

Miro and FigJam are ultimately closed visual canvases designed for quick meetings. They lack depth when projects transition from ideation to **rigorous engineering, computation, data analysis, and academic research**. We can decisively outpace them in four key dimensions:

### 1. The "Executable Canvas": True Computational Nodes
- **Where Miro/FigJam fail**: A spreadsheet in Miro is an inert table. Code in Miro is non-executable plain text.
- **Our Edge**:
  - **Live Jupyter Notebooks**: Run Python/Pyodide or remote kernels directly on the canvas to execute machine learning models and data pipelines.
  - **Interactive Spreadsheets with Cross-Card Formulas**: A cell in a `SheetNode` can reference another node on the canvas (e.g. `=SUM(Node_A!B2:B10)`).
  - **Dynamic Mermaid & Graphviz**: Instant programmatic diagram compilation from markdown code.

### 2. Multi-Agent AI Canvas Co-Workers
- **Where Miro/FigJam fail**: Generic "generate sticky notes" AI prompt boxes that dump text on the board.
- **Our Edge**:
  - **Autonomous Research Agent Node**: Drop an AI Agent node onto the canvas, wire it to 3 research paper cards and a Jupyter node, and prompt it: *"Synthesize a comparative literature review and run a benchmark script."*
  - The agent reads connected inputs, queries vector stores / arXiv, executes code in the notebook node, and outputs structured synthesis cards and Mermaid flowcharts directly onto the graph.

### 3. Open Data Ownership & The JSON Canvas Standard
- **Where Miro/FigJam fail**: Complete SaaS vendor lock-in. If Miro raises prices or shuts down, your team's visual institutional knowledge is locked behind export limitations or static image dumps.
- **Our Edge**:
  - **Pure JSON Canvas v1.0**: Standardized JSON format fully compatible with Obsidian Canvas and versionable in Git.
  - **Bidirectional Document Linking**: Wikilinks (`[[Note Title]]`) inside canvas notes automatically update the global knowledge graph and document backlinks.

### 4. Enterprise ReBAC Security (OpenFGA)
- **Where Miro/FigJam fail**: Coarse "Editor / Viewer" permissions on an entire board.
- **Our Edge**:
  - **Node-level & Resource-level permissions**: On a single canvas board, a contractor can view public architecture nodes while confidential financial sheet nodes or private research notes are automatically redacted based on OpenFGA tuples.

---

## 5. Phased Roadmap

```mermaid
timeline
    title Spatial Canvas Strategic Roadmap
    section Phase 1 : Quick Delights
      Cursor Chat (Yjs) : Press / to chat
      Sticky Note Primitive : Auto-font sizing & pastel colors
      Quick Cardinal Anchors : 4-point drag-to-connect handles
    section Phase 2 : Facilitation & Layout
      Synced Workshop Timer : Floating shared countdown
      Dot Voting Sessions : Interactive polling on nodes
      Orthogonal Edge Routing : Manhattan collision avoidance
      Frames & Presentation Mode : Step-through slide show
    section Phase 3 : Computational Supremacy
      Cross-Card Sheet Formulas : Node-to-node data linking
      Multi-Agent Canvas Node : AI co-workers executing tasks
      Full Git Bi-directional Sync : Commit & pull canvas graphs
```

### Phase 1: High-Delight Multiplayer & Whiteboarding Additions
- [ ] **Cursor Chat**: Add keyboard hook for `/` to render ephemeral floating speech bubbles attached to client cursors in Yjs awareness.
- [ ] **Sticky Note Primitive**: Add dedicated square sticky card with pastel presets (`#fef08a`, `#fbcfe8`, `#bbf7d0`, `#bae6fd`) and auto-scaling typography.
- [ ] **Cardinal Drag Connectors**: 4 hover dots on node edges allowing 1-click arrow dragging to connect nodes.

### Phase 2: Facilitation & Workshop Engine
- [ ] **Shared Timer & Stopwatch**: Floating overlay widget synced across clients via DO/WebSocket.
- [ ] **Dot Voting Engine**: Start timed voting round, cast tokens, reveal totals with celebratory confetti.
- [ ] **Presentation Frames**: Sequence canvas regions and step through them with full-screen transitions.
- [ ] **Smart Edge Routing**: Implement A* / Manhattan path routing around intervening nodes.

### Phase 3: Unmatched Computational & AI Capabilities
- [ ] **Live Agentic Canvas Workers**: Background workers that execute tasks across connected nodes.
- [ ] **Cross-Resource Formula Engine**: Link Sheet cells to other spatial nodes and database entities.


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🔍 Comparative Analysis & Roadmap | **Track**: Whiteboard Evolution

- [x] JSON Canvas v1.0 computational knowledge model vs proprietary Miro/FigJam format
- [x] Excalidraw freeform sketching integration
- [ ] Ephemeral cursor chat (`/` trigger with speech bubbles)
- [ ] Sticky note primitives with color presets
- [ ] Cardinal drag connectors with smart Manhattan path routing
- [ ] Facilitation tools (voting tokens, synchronized timers)
