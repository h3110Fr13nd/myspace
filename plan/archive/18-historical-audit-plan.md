# Historical Audit Snapshot: Plans vs. Reality (Phase 1 Baseline)

> [!NOTE]
> **Historical Archive Snapshot**:
> This document represents an early audit snapshot from initial development (approx. coverage 35%). It has been **superseded** by later implementation phases (e.g., Plan 19 Easy Wins, Plan 21 Canvas Editor Studio, Plan 28 UI/UX Redesign System, and the unified Resource Catalog).
> 
> **Key Status Evolutions Since This Snapshot**:
> - **SPA Navigation**: Evaluated and deferred (`plan/deferred-low-priority/7-quartz-feature-gaps-todo.md`). SSR-first architecture with React islands chosen for stability, OpenFGA ReBAC determinism, and zero memory leaks.
> - **Canvas Studio & Viewers**: Implemented and upgraded with Excalidraw, SVG/HTML5 renderers, full Zoom/Pan viewport matrix, and Studio creation workflows.
> - **UI / Theming**: Redesigned via comprehensive design tokens, UI primitives (`src/components/ui/`), and unified layouts.
> - **Properties Panel & Folder Indices**: Fully implemented under Plan 19.

---

# 📊 Executive Overview of Plans vs. Reality

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   IMPLEMENTATION MATRIX                                          │
├──────────────────────────┬──────────────────────┬────────────────────────────────────────────────┤
│ STATUS                   │ COVERAGE %           │ KEY AREAS                                      │
├──────────────────────────┼──────────────────────┼────────────────────────────────────────────────┤
│ ✅ Fully Implemented     │ ~35%                 │ Auth (Google+Pass), API Keys, Basic Vault Sync,│
│                          │                      │ Shiki/KaTeX SSR, Tags, Content Meta, OG Engine │
├──────────────────────────┼──────────────────────┼────────────────────────────────────────────────┤
│ 🟡 Minimal / Partial     │ ~30%                 │ Novel Editor, Wikilink Popovers, Search,       │
│                          │                      │ JSON Canvas Viewer, D3 Graph View, Folder Tree │
├──────────────────────────┼──────────────────────┼────────────────────────────────────────────────┤
│ 🔴 Completely Pending    │ ~35%                 │ SPA Micromorph Router, Block/Heading Embeds,   │
│                          │                      │ Dataview/Bases, Google Drive Sync Broker,      │
│                          │                      │ Canvas Studio Editor, i18n, Stacked Pages      │
└──────────────────────────┴──────────────────────┴────────────────────────────────────────────────┘
```

---

# 1. 🟡 Features with Minimal / Partial Implementation

These components exist in the codebase but are currently at an initial MVP or prototype stage:

### 1. [NovelEditor.tsx](file:///home/user/Desktop/dev/blog/template/src/components/editor/NovelEditor.tsx) (Plan 13)
- **Current State:** Basic TipTap instance with a custom slash menu (`/`), bubble menu, and tag manager.
- **What's Missing / Minimal:**
  - **No true bi-directional Markdown & Frontmatter serializer:** It saves raw HTML from TipTap directly to the backend (`content: htmlContent`) rather than preserving clean Obsidian-Flavored Markdown (OFM) with YAML frontmatter.
  - **No Drag Handles:** Block drag handles (Novel style) are missing.
  - **Custom Nodes Incomplete:** Callouts, Math formulas, and embed blocks are inserted as raw HTML strings (`<blockquote>`, `<pre>`) instead of native TipTap Node extensions that can be edited live.

### 2. [JsonCanvasRenderer.tsx](file:///home/user/Desktop/dev/blog/template/src/components/JsonCanvasRenderer.tsx) (Plans 5 & 6)
- **Current State:** Renders static nodes and SVG cubic bezier curves inside a scrollable box.
- **What's Missing / Minimal:**
  - **Read-only only:** No interactive Pan & Zoom (viewport transform matrix), no drag/resize, and no interactive edge drawing.
  - **Hardcoded Authorization Mock:** Lines 51–56 mock permissions (`currentUser !== 'user:alice'`) rather than calling the real OpenFGA API.
  - **No Dedicated Studio Route:** `/studio/canvas/[id]` is planned but not created.

### 3. [GraphView.tsx](file:///home/user/Desktop/dev/blog/template/src/components/GraphView.tsx) (Plan 7)
- **Current State:** D3 force simulation with local 1-hop view and full-screen modal.
- **What's Missing / Minimal:**
  - **Static Data Pipeline:** The graph receives nodes/links passed statically from [index.astro](file:///home/user/Desktop/dev/blog/template/src/pages/index.astro). As the vault grows, sending all nodes in the initial HTML payload degrades SSR performance.
  - **No Dynamic Filters:** Cannot filter graph by tag, directory, or resource type dynamically in the UI.

### 4. [SearchModal.tsx](file:///home/user/Desktop/dev/blog/template/src/components/SearchModal.tsx) & [search.ts](file:///home/user/Desktop/dev/blog/template/src/pages/api/v1/search.ts) (Plans 7 & 9)
- **Current State:** Cmd+K modal with 200ms debounce, querying Postgres `ILIKE` and Meilisearch.
- **What's Missing / Minimal:**
  - **No Offline/Client-side Index:** Does not support the pre-built static `contentIndex.json` pattern from Quartz for offline/instant search.
  - **No Tag Autocomplete Prefix:** `#tag:` search prefix queries are not yet tokenized in the backend.

### 5. [WikilinkPreview.tsx](file:///home/user/Desktop/dev/blog/template/src/components/WikilinkPreview.tsx) (Plans 7 & 9)
- **Current State:** Renders on mouseover with 300ms delay and in-memory cache.
- **What's Missing / Minimal:**
  - **No Viewport Collision Logic:** Positions popover with simple `Math.min` instead of `@floating-ui/dom` smart positioning (flip, shift, arrow pointer).
  - **No Section Anchor Hash Resolution:** Hovering `[[note#Heading]]` does not scroll to that heading within the popup.

---

# 2. 🔴 Completely Pending / Not Implemented Features

### 1. SPA Navigation & Client-Side Router (`micromorph`) (Plan 7 - §1)
- **Current:** Every document click triggers a full-page SSR reload via `/?doc=...`.
- **Planned:** Intercept internal `<a>` clicks, fetch the target HTML, and morph only the changed DOM regions using `micromorph` or `@swup/astro` with progress bar animations and `nav`/`prenav` lifecycle events.

### 2. Block-Level & Heading Transclusions (Plans 2 & 7 - §26)
- **Current:** Embeds only support entire files (`![[note]]`).
- **Planned:** 
  - `![[note#Heading Name]]`: Transclude only that heading section up to the next equal heading level.
  - `![[note#^block-id]]`: Transclude a specific tagged paragraph or list item.

### 3. Bases / Dataview Dynamic Database Queries (Plans 7 & 12)
- **Planned:** Custom markdown code blocks (e.g. ````bases ... ```` or ````dataview ... ````) that dynamically query PostgreSQL `metadata` (JSONB) and render interactive Kanban boards, galleries, or filterable tables.

### 4. Google Drive Dynamic Permission Broker (Plan 8)
- **Current:** [google-drive/sync.ts](file:///home/user/Desktop/dev/blog/template/src/pages/api/v1/vault/google-drive/sync.ts) and [GoogleDriveViewer.tsx](file:///home/user/Desktop/dev/blog/template/src/components/GoogleDriveViewer.tsx) allow viewing and importing Drive files.
- **Pending:** The background **Permission Broker** (`drivePermissionBroker.ts`) that automatically calls Google Drive v3 API (`POST /files/[id]/permissions`) to grant/revoke access to target users when OpenFGA permissions change.

### 5. Canvas Studio Builder Mode (Plan 6 - §6)
- **Pending:** Interactive authoring studio at `/studio/canvas/[id]` with full drag-and-drop, node creation (Text, File, Link, Group, Resource), edge creation from ports, and JSON export.

### 6. i18n & Reader Mode (Plan 7 - §11, §20)
- **Pending:** Multi-language UI translation bundles and a distraction-free Reader Mode button that toggles left/right sidebars.

### 7. Stacked Pages / Andy Matuschak Mode (Plan 7 - §19)
- **Pending:** Horizontal sliding note columns when clicking wikilinks.

---

# 3. ⚠️ Architectural Conflicts & Risks

| Potential Conflict | Details | Resolution / Best Approach |
|:---|:---|:---|
| **SSR vs. SPA Navigation** | Adding an SPA router (`micromorph` / Swup) will break client-side React islands (D3 graph, KaTeX re-rendering, ToC scroll listeners) unless each component hooks into `window.addEventListener('nav', ...)` for proper rehydration. | Standardize a global lifecycle hook (`onPageMount` / `onPageCleanup`) across all React islands. |
| **HTML Storage vs. Markdown Pipeline** | Saving rich text as HTML from TipTap conflicts with the unified Markdown render pipeline (`renderEngine.ts` expects raw Markdown with YAML frontmatter). | Implement a TipTap-to-Markdown export serializer (e.g., `tiptap-markdown`) so documents in the database/storage remain Markdown. |
| **OpenFGA Permission Granularity vs. SQL Performance** | Checking OpenFGA ReBAC on every single node/image/embed in a single request can cause latency (e.g., a note with 30 embeds firing 30 OpenFGA checks). | Use OpenFGA `BatchCheck` or subquery cached accessible resource IDs per user session. |
| **Google OAuth Linking vs. Password-Only Security** | Auto-linking accounts by matching email could allow unauthorized linking if an email provider does not verify emails. | Enforce `email_verified: true` validation on Google profile data before linking identities in `user_identities`. |

---

# 4. 🚀 Enhancements to Maximize the System

### 1. High-Performance Client-Side Cache & Offline Mode
- Pre-generate an encrypted or public `contentIndex.json` at sync time.
- Implement a Service Worker to cache visited research notes, enabling instant offline reading.

### 2. AI Semantic Search & Vector Embeddings
- Integrate Cloudflare Vectorize or local pgvector to enable **semantic search** ("find notes about consensus algorithms without using the word consensus") alongside lexical Meilisearch.

### 3. Live Real-Time Collaboration on Canvases and Notes
- Integrate **Yjs** with WebSockets over Cloudflare Durable Objects to allow real-time collaborative editing on both TipTap documents and JSON Canvases.

### 4. Interactive Data Sheets (FortuneSheet / Luckysheet)
- Expand `sheet:` resources into full interactive spreadsheet studios with formula calculation, charting, and live embedding into research notes.

### 5. Automated Vault Syncing from Git & Obsidian Plugins
- Build a dedicated Obsidian community plugin or GitHub Action that connects to `/api/v1/vault/sync` using Scoped Personal API Keys (`fsk_live_...`) to auto-sync on every local file save or git commit.

---

### Recommended Next Steps (Historical Perspective)
1. **TipTap Markdown Serializer:** Ensure [NovelEditor.tsx](file:///home/user/Desktop/dev/blog/template/src/components/editor/NovelEditor.tsx) serializes cleanly back to Markdown + YAML frontmatter.
2. **SPA Navigation Layer:** *(Superseded: Re-evaluated & Deferred in favor of SSR-first)*.
3. **Block & Heading Transclusion:** Upgrade [embedResolver.ts](file:///home/user/Desktop/dev/blog/template/src/lib/render/embedResolver.ts) to parse `![[note#heading]]` and `![[note#^block]]`.

---

## 📋 Implementation Status & Audit Checklist

**Status**: 📜 Superseded Historical Snapshot | **Current Reference**: Plan 19, Plan 21, Plan 28 & Current Workspace Codebase

- [x] Multi-Provider Authentication & Account Linking (Plan 14 implemented)
- [x] Scoped Personal API Keys (Plan 16 implemented)
- [x] Cloudflare R2 & Zero-Inbound Tunnel Architecture (Plan 17 implemented)
- [x] Note Properties Panel (`PropertiesPanel.astro` under Plan 19 implemented)
- [x] Dynamic Folder Index Pages (`src/pages/folders/[...path].astro` under Plan 19 implemented)
- [x] Dynamic OG Image & ResourceHead metadata (Plan 4 implemented)
- [x] D3 Knowledge Graph View (`GraphView.tsx`, `CanvasGraphView.tsx` with modal)
- [x] File Explorer & Recursive Directory Tree (`FolderTree.tsx`)
- [x] Canvas Studio Editor (`/studio/canvas/[id]` and Excalidraw integration under Plan 21)
- [x] UI/UX Redesign System (`src/styles/global.css`, `src/components/ui/`, Plan 28)
- [ ] Bi-directional TipTap Markdown Serializer with OFM Frontmatter preservation
- [ ] Block & Heading transclusion (`![[note#heading]]`, `![[note#^block]]`)
- [ ] Dynamic Google Drive Permission Broker daemon
- [-] Client-Side SPA micromorph navigation (Deferred in favor of SSR-first stability)