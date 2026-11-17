# Stacked Pages / Andy Matuschak Sliding Columns Architectural Proposal

> **Status**: `[DEFERRED - REQUIRES HEAVY ARCHITECTURAL DESIGN]`  
> **Topic**: Horizontal sliding panels / cascaded note columns navigation pattern  
> **Inspiration**: Andy Matuschak's working notes (`notes.andymatuschak.org`), Obsidian Sliding Panes plugin, Roam Research / Logseq page stacks.  
> **Workspace Context**: FOSS Content Workspace (`mechanical-matter`)

---

## 1. Overview & Conceptual Model

The "Stacked Pages" (or Sliding Columns / Andy Matuschak mode) user experience departs from traditional single-page document navigation. Instead of replacing the active document when the user clicks an internal link (wikilink or citation), a new column is appended to the right. As the user traverses down a research rabbit hole, the browser window forms a horizontal scroll container housing an ordered stack of open documents:

```
+------------------------------------------------------------------------------------------+
|  [Left Sidebar]  |  Column 1 (Root)  |  Column 2 (Sub-note)  |  Column 3 (Paper Detail)  |
|  - Explorer      |  # Agentic AI     |  # Toolformer         |  # ReAct Framework       |
|  - Tags          |  ...content...    |  ...content...        |  ...content...            |
|                  |                   |                       |                           |
+------------------------------------------------------------------------------------------+
<================================= Horizontal Scroll Runway ===============================>
```

When columns exceed the available viewport width, earlier columns slide out to the left, leaving sticky spine headers (like spines on a bookshelf), while the active reading column remains in focus.

---

## 2. In-Depth Architectural Analysis

### 2.1 DOM Footprint & Memory Management

#### The Problem:
- A user exploring deeply connected knowledge graphs or academic papers can traverse 15–30 notes in a single exploration session.
- In this workspace, notes can contain heavy rich interactive primitives:
  - Interactive TipTap / ProseMirror instances with collaborative Yjs providers.
  - Excalidraw whiteboards (`@excalidraw/excalidraw`) with WebGL/Canvas rendering.
  - Interactive Mermaid charts (`mermaid.js`).
  - KaTeX math formulas with deeply nested HTML spans.
  - Embedded PDF viewers (`<iframe>` or `pdf-lib` renders).
- Retaining 20+ active, fully hydrated document trees in the DOM results in linear memory consumption (~150MB - 500MB+ RAM), multiple RAF (requestAnimationFrame) loops, duplicated listeners, and substantial scroll hitching.

#### Architectural Requirements:
1. **Window Virtualization (Horizontal Windowing)**:
   - Only the currently visible columns (typically 1 to 3 depending on viewport width) plus a buffer of 1 off-screen column on each flank should remain fully mounted and rendered.
   - Off-screen columns outside the virtual window should be reduced to skeleton placeholders that preserve exact measured widths and scroll offset anchors.
2. **Heavy Surface Freezing**:
   - Complex interactive elements (Excalidraw canvas, TipTap editor instances, Mermaid SVGs) must be unmounted or converted into static image snapshots when their hosting column is inactive/scrolled out of view.
   - Interactive re-hydration must be lazy (triggered only upon column re-focus or click).

---

### 2.2 Virtualization Strategy & Layout Geometry

#### Layout CSS Mechanics:
- Container:
  ```css
  .stacked-runway {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x proximity;
    overscroll-behavior-x: contain;
    height: 100vh;
  }
  ```
- Individual Column:
  ```css
  .stacked-column {
    flex: 0 0 clamp(480px, 45vw, 750px);
    height: 100%;
    position: sticky;
    /* CSS Sticky Spines */
    left: calc(var(--col-index) * var(--spine-width));
    overflow-y: auto;
    background: var(--surface-1);
    border-right: 1px solid var(--border-glass);
    box-shadow: -10px 0 25px rgba(0, 0, 0, 0.25);
  }
  ```
- **Virtualization Challenge**:
  - Unlike flat lists virtualized via `tanstack-virtual` or `react-window` where elements have uniform or predictable 1D heights, stacked columns have dynamic content heights and horizontal sticky stacking contexts.
  - If an off-screen column is pruned from the DOM, sticky positioning offsets (`calc(index * spineWidth)`) can collapse unless static spacer divs are inserted to maintain horizontal scroll runway dimensions.

---

### 2.3 Scroll Synchronization & State Tracking

1. **Dual-Axis Independent Scrolling**:
   - Each column scrolls vertically independently.
   - The master outer container scrolls horizontally.
   - Mouse wheel events over a column must default to vertical scrolling within that column until boundaries are hit, avoiding accidental horizontal jumps.
2. **Active Column Tracking**:
   - Utilizes an `IntersectionObserver` observing all active column boundaries against the horizontal viewport container.
   - Updates the active URL/history state and sidebar table-of-contents highlight according to which column currently possesses central visual focus.
3. **Sticky Spines Collapsing**:
   - Columns scrolled past the left edge collapse into vertical sticky spine headers showing the note title rotated 90 degrees (`writing-mode: vertical-rl; transform: rotate(180deg)`).
   - Clicking a spine scrolls the runway smoothly to restore that column into primary focus.

---

### 2.4 Mobile Responsiveness & Viewport Breakpoints

Stacked pages are fundamentally designed for widescreen viewports (`>= 1280px`). On mobile devices:
- Viewports (`< 768px`) can only comfortably host a single 100vw column.
- **Fallback Strategy**:
  - Below `768px` (or `1024px`), stacked pages must disable horizontal multi-column layout and downgrade to standard drill-down navigation (like iOS NavigationStack / mobile Quartz):
    - Sliding transitions (slide left on open, slide right on back).
    - Top breadcrumb bar displaying the traversal path: `Root > Note A > Note B`.
    - Gestural edge swipe to pop the top note from the stack.
  - Middle viewports (`768px - 1279px`): Display 1 primary column + 1 preview column with auto-folding spine headers.

---

### 2.5 SSR vs Client State & Hydration (Astro Context)

1. **The Astro Static/SSR Paradigm**:
   - Our application runs Astro with SSR (`@astrojs/node` output). Initial page render must deliver standard server-rendered HTML for search crawlers, SEO previews, and zero-JS clients.
   - The root document requested in the initial URL (`/?doc=<id>` or `/notes/<slug>`) is generated on the server.
2. **Client-Side Stack State Management**:
   - The stack cannot be fully server-rendered if dynamically accumulated via user clicks.
   - State representation:
     - The stack state can be reflected in URL query parameters (e.g., `?stack=docA,docB,docC` or path hierarchy) to make sessions shareable and reloadable.
     - However, deep stacks generate massive URLs and need sanitization/truncation.
3. **Data Fetching for Subsequent Stack Items**:
   - Secondary and tertiary columns must be fetched via lightweight JSON/HTML APIs (e.g. `/api/v1/resources/[...id]` or dedicated fragment route) rather than requesting full HTML documents with duplicated layouts and headers.
   - Astro Islands: Each column can host a React island (`<ResourceViewer client:visible />`) that lazily mounts upon entering the viewport.

---

## 3. Open Design Questions

> [!WARNING]
> The following architectural decisions are deliberately unresolved and require formal RFC consensus before implementation begins.

### Question 1: URL Structure & Shareability
- **Option A (Query Array)**: `/?stack=doc:root,doc:child,doc:grandchild`
  - *Pros*: Completely shareable, exact state preserved on refresh.
  - *Cons*: Long URLs; browser history stack pollution on every horizontal click; cache fragmentation.
- **Option B (Ephemerality with Top-Level Canonical)**: URL reflects only the active focused column (`/?doc=doc:child`), stack is retained in `sessionStorage`.
  - *Pros*: Clean URLs, standard SEO canonicals.
  - *Cons*: Refreshing or sharing a link drops all previous columns from the session.

### Question 2: Collaborative Yjs Document Binding
- When multiple stacked columns are in edit mode (TipTap wysiwyg editor):
  - Can multiple Yjs WebSockets be open simultaneously within one browser tab?
  - Does having 3 concurrent Hocuspocus providers overwhelm client WebSocket connections and backend worker memory?
  - *Recommendation*: Limit edit mode to strictly one column at a time; stacked companion columns must remain read-only rendered snapshots.

### Question 3: Workspace Design Token & UI Primitive Integration
- How does the stacked runway interact with existing drawer and modal primitives (`src/components/ui/Drawer`, `Modal`)?
- Does the sliding column stack replace the full-width workspace view or should it be an explicit user toggle (e.g. "Stacked Mode" vs "Default Focus Mode")?
- *Preliminary Consensus*: Andy Matuschak mode should be an opt-in reading layout toggle in `src/lib/prefs.ts` (`data-mode="stacked"`), keeping standard single-note reader mode as default.

---

## 4. Final Classification

```
================================================================================
STATUS: [DEFERRED - REQUIRES HEAVY ARCHITECTURAL DESIGN]
NEXT MILESTONE: RFC & Prototype Sandbox (Post-v1.0 Core Release)
LEAD ENGINEER / REVIEWER: Core Systems Architect & UX Committee
================================================================================
```


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🔭 Future Roadmap (Deferred to Post-v1.0) | **Track**: Andy Matuschak Sliding Note Runway

- [ ] Horizontal sliding note stack CSS container and scroll physics
- [ ] Stacked page history management and URL hash synchronizer
- [ ] Focus and fold controls for background stack panels
- [ ] Mobile responsive responsive fallback for multi-column stacks
- [-] Priority deferred to preserve single-page SSR simplicity and drawer layout stability
