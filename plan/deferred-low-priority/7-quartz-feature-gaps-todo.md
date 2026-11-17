# Plan 7: Quartz Reference Inventory — Non-Binding Feature Ideas

> **Product source of truth:** [`docs/GOALS.md`](../../docs/GOALS.md).
> This file is a historical Quartz comparison, not an exhaustive audit or a
> commitment to implement Quartz features. Its old priority markers and
> unchecked boxes are unverified ideas, not current priorities. Before acting
> on an entry, check whether the behavior already exists, whether users need it,
> and whether it fits the product and runtime goal. Quartz is a structural
> reference, not a feature checklist.

> **Quartz source:** `inspiration/quartz` in this repository.

> [!WARNING]
> **Architectural Deferral Notice (SPA Navigation & Micromorph Router)**:
> The SPA router (`micromorph` / Swup client-side DOM morphing) was evaluated and intentionally **deferred to a distant future milestone after core product stability**. 
> 
> **Architectural Decision Rationale**:
> 1. **SSR-First Principle**: Astro's server-first SSR model (`output: 'server'`) ensures per-request OpenFGA ReBAC enforcement, fast initial byte delivery, zero client-side parser overhead, and deterministic server-side security.
> 2. **React Island Hydration Fragility**: Intercepting page changes via client DOM diffing introduces substantial hydration de-sync and memory leak risks across complex React interactive islands (D3 knowledge graph, Excalidraw, Canvas Studio, KaTeX SSR spans, CodeMirror/TipTap). Full SSR navigation guarantees clean component lifecycle mount/unmount and avoids state corruption.
> 3. **Rescheduling Priority**: The workspace operates with sub-100ms local SSR delivery. Native page navigation with standard HTTP caching provides rock-solid reliability without the fragile lifecycle hooks required by SPA DOM morphing.

---

## 🧭 1. SPA Navigation & Client-Side Routing (DEFERRED)

- [-] 🔴 **SPA Router with `micromorph` DOM diffing** (`spa.inline.ts`) `[DEFERRED - SSR-First Prioritized]`  
  Quartz intercepts all internal link clicks, fetches the target HTML, and morphs only the changed DOM regions. Currently we do full-page reloads between documents. Makes navigation feel instant.
  - Progress bar animation (`navigation-progress` div, 0→80% on fetch, removed on done)
  - `nav` custom event dispatched after every navigation for component re-initialization
  - `prenav` event dispatched before navigation for cleanup
  - `window.addCleanup(fn)` pattern for component teardown
  - `data-router-ignore` attr to opt-out links
  - `data-router-noscroll` attr to suppress scroll-reset
  - Accessibility `<route-announcer aria-live="assertive">` custom element for screen readers
  - Browser Back/Forward button support via `popstate`

---

## 🔍 2. Search — ideas beyond the existing search workflow

The workspace already uses Meilisearch with a PostgreSQL fallback. The
client-side prebuilt index below is an optional offline-search idea; the
historical SQL-per-keystroke description is obsolete.

- [ ] 🔴 **Full-text client-side search with pre-built index** (`contentIndex.json`)  
  Quartz pre-builds a `static/contentIndex.json` with all note titles, tags, aliases, and content snippets at build time. Search is entirely client-side with no API round-trip. We currently rely on a server-side SQL `ILIKE` call per keystroke.
- [ ] 🟠 **Search result score ranking** — title match > tag match > body match
- [ ] 🟠 **Alias-aware search** — searching an alias resolves to the original note
- [ ] 🟡 **Tag autocomplete in search** — `#tag:` prefix narrows results to tagged notes
- [ ] 🟡 **Search result preview highlighting** — highlight the matched term in the snippet

---

## 🪟 3. Link Popovers (Hover Previews)

Wikilink previews already exist in `src/components/WikilinkPreview.tsx`; this
section records possible parity refinements, not a missing feature.

- [ ] 🔴 **Wikilink hover popover** (`popover.inline.ts` + `@floating-ui/dom`)  
  Hovering any internal `[[wikilink]]` fetches the target page HTML and shows a floating preview card positioned with collision detection (flip, shift, inline strategies). Currently we have no hover previews at all.
  - Supports image popovers (renders `<img>`)
  - Supports PDF popovers (renders `<iframe>`)
  - Supports page popovers (renders `.popover-hint` sections from the target page)
  - Position computed with `@floating-ui/dom` for smart viewport collision avoidance
  - Caches fetched pages — no re-fetch on second hover
  - Scroll-into-view for `#heading` anchor hash fragments inside the popover
  - `data-no-popover="true"` to opt-out individual links

---

## 🌳 4. File Explorer / Folder Tree

The workspace already has a permission-filtered folder tree in
`src/components/FolderTree.tsx`. Only independently verified usability gaps
belong in a future task.

- [ ] 🔴 **Quartz-style left sidebar file explorer** (`@quartz-community/explorer`)  
  Collapsible tree with folders and files. Features:
  - Persist open/close state per folder in `localStorage`
  - Auto-expand folders containing the current active page
  - Sorted: folders first, then alphabetically by title
  - Keyboard navigable (focus, Enter to expand, arrow keys)
  - Mobile-responsive collapsible sidebar
  - Custom sort function support (by date, title, custom frontmatter)

---

## 🗂️ 5. Folder Index Pages

**Status: shipped.** `src/pages/folders/[...path].astro` resolves an accessible
`index`/`README` document when present and otherwise renders a generated prose
listing from permission-filtered resources. Folders are listed before notes;
notes sort by most recently updated/created. `tests/e2e/vault/folder-tree.spec.ts`
covers folder navigation, generated listing, the shared shell, and the
preloaded contextual graph. Do not track this as an unfinished Quartz gap.

Remaining difference from Quartz: the listing is an SSR prose list rather than
a card grid. This is a presentation choice, not missing folder-index behavior;
revisit only if user feedback identifies a navigation problem.

---

## 🏷️ 6. Tag Index Pages

**Status: core routes shipped.** `/tags` builds an access-filtered topic index
and `/tags/[tag]` renders a permission-filtered, generated prose listing (or a
tagged `index`/`README` document). The latter shares the folder/tag dynamic-body
resolver and is covered by `tests/e2e/vault/tag-page.spec.ts`. Do not implement
a parallel tag index without a demonstrated gap.

Remaining follow-up: verify whether tag autocomplete is needed in the current
editor workflow; the feature gap has not been confirmed by user evidence.

---

## 📊 7. Graph View

- [ ] 🔴 **Interactive D3 Force Simulation Knowledge Graph** (`@quartz-community/graph`)  
  Quartz renders a full interactive backlink graph showing every note and its wikilink connections. Currently we have the JSON Canvas viewer but no global/local force-directed graph.
  - Local graph: shows only neighbors (depth 1–3 hops) of the active document
  - Global graph: all nodes and edges across the vault
  - Node labels, hover highlights, click to navigate
  - Color by tag, folder, or resource type
  - Zoom, pan, node drag
  - Configurable depth, focus node, repel force, link distance

---

## 📄 8. Content Meta & Article Title Component

- [ ] 🟠 **Article title rendered from frontmatter** (`@quartz-community/article-title`)  
  Rendered as `<h1>` above article body, separate from `<title>` tag, with alias display support.
- [ ] 🟠 **Content metadata bar** (`@quartz-community/content-meta`)  
  Displays: created date, modified date, reading time estimate, word count, file path breadcrumb.
  - Reading time: word count / 200 wpm
  - Created/Modified: from git log, frontmatter, or filesystem (priority chain)

---

## 📅 9. Created / Modified Dates from Git

- [ ] 🔴 **Git-based date extraction** (`@quartz-community/created-modified-date`)  
  Reads real creation and modification timestamps from `git log` per file. Falls back to frontmatter `created`/`modified` fields, then to filesystem `mtime`. We currently use only frontmatter dates.
  - Priority chain: `frontmatter` → `git` → `filesystem`
  - Exposed in content meta bar and RSS feeds

---

## 🌙 10. Dark Mode Toggle

- [ ] 🔴 **Persistent dark/light/system theme toggle** (`@quartz-community/darkmode`)  
  Currently we have a hardcoded dark theme with no user toggle. Quartz supports:
  - Three states: Dark / Light / System (auto)
  - Persisted in `localStorage` across sessions
  - Smooth CSS variable transition (no flash on load via `preact-iso` prescript)
  - Sync with `prefers-color-scheme` media query

---

## 📖 11. Reader Mode

- [ ] 🟡 **Reader Mode toggle** (`@quartz-community/reader-mode`)  
  Hides the left/right sidebars and centers the article in a maximum-width reading column for distraction-free reading.

---

## 🔗 12. Alias Redirects

- [ ] 🟡 **Frontmatter aliases generate redirect pages** (`@quartz-community/alias-redirects`)  
  Notes with `aliases: [old-name, short-name]` in frontmatter get auto-generated redirect HTML pages that point to the canonical slug. We have aliases in our schema but no redirect pages.

---

## 🔒 13. Encrypted Pages

- [ ] 🟡 **Password-protected content with AES encryption** (`@quartz-community/encrypted-pages`)  
  Notes with a `password` frontmatter field are encrypted at build time (PBKDF2 + AES-GCM, 600k iterations). A client-side decryption UI prompts for password on page load. Encrypted notes are excluded from the content index.

---

## 💬 14. Comments

- [ ] 🟢 **Giscus / Utterances GitHub-based commenting** (`@quartz-community/comments`)  
  Embeds a Giscus comment widget at the bottom of each page, backed by GitHub Discussions. Configurable per page type.

---

## 🧩 15. Bases (Dataview-style Database Queries)

- [ ] 🔴 **Bases page type — queryable content database** (`@quartz-community/bases-page`)  
  Render content as filterable tables, Kanban boards, or gallery views using frontmatter properties as the data source. Similar to Obsidian Bases / Dataview.
  - Filter by tag, property, type, date range
  - Sort by any frontmatter field
  - Group by tag or folder
  - Render modes: Table, List, Gallery, Kanban

---

## 📋 16. Note Properties Panel

- [ ] 🟠 **Frontmatter properties panel** (`@quartz-community/note-properties`)  
  Renders selected frontmatter fields (description, tags, aliases) in a structured panel above or beside the article body. Configurable include/exclude lists.

---

## 📢 17. Unlisted Pages

- [ ] 🟡 **`unlisted: true` frontmatter flag** (`@quartz-community/unlisted-pages`)  
  Notes with `unlisted: true` are accessible via direct URL but excluded from the content index, search, sitemap, tag pages, and folder listings.

---

## 📑 18. Recent Notes Widget

- [ ] 🟡 **Recent notes sidebar widget** (`@quartz-community/recent-notes`)  
  Shows the N most recently modified notes in a sidebar widget. Configurable count, filter by tag/folder, show date.

---

## 📚 19. Stacked Pages (Andy Matuschak Mode)

- [ ] 🟢 **Stacked side-by-side note navigation** (`@quartz-community/stacked-pages`)  
  Clicking a wikilink opens the target note as an additional stacked column to the right rather than replacing the current page. Creates a horizontal "note stack" navigation UX inspired by Andy Matuschak's notes site.

---

## 🌐 20. Internationalization (i18n)

- [ ] 🟡 **Full i18n locale system** (`quartz/i18n/locales/`)  
  Quartz has translations for 31 locales (en-US, zh-CN, ja-JP, ar-SA, de-DE, fr-FR, etc.). All UI strings (search placeholder, "table of contents", "backlinks", "tags", date formats) are locale-aware. We hard-code English everywhere.

---

## 📰 21. Citations & Academic References

- [ ] 🟡 **`[[@bibtex-key]]` citation syntax** (`@quartz-community/citations`)  
  Parses BibTeX `.bib` files and renders inline citations with hover popover previews of the full reference. Generates a "References" section at the bottom of each note.

---

## ➡️ 22. Hard Line Breaks

- [ ] 🟢 **GitHub-style hard line breaks** (`@quartz-community/hard-line-breaks`)  
  Configurable whether single newlines in Markdown create `<br>` tags. Currently we follow default Markdown (requires double newline or trailing `\\`).

---

## 🖼️ 23. Auto-generated OG Social Images

- [ ] 🟠 **Programmatic OpenGraph image generation** (`@quartz-community/og-image`)  
  Generates a unique OG social preview image per note at build time using the note title and optional cover image baked into a template. We currently use a single fallback `/og-default.png` for all pages.

---

## 🤖 24. Robots.txt & CNAME

- [ ] 🟢 **Auto-generated `robots.txt`** — included with sitemap reference  
- [ ] 🟢 **`CNAME` file emitter** (`@quartz-community/cname`) — auto-generates `CNAME` from `baseUrl` for GitHub Pages

---

## 📐 25. Multi-Frame Layout System

- [ ] 🟠 **Pluggable page layout frames** (`quartz/components/frames/`)  
  Quartz supports multiple layout frames per page type:
  - `DefaultFrame` — 3-column layout (left sidebar, content, right sidebar)
  - `FullWidthFrame` — no sidebars, full-width content
  - `MinimalFrame` — header + content only
  - Per page type overrides: folder pages have no right sidebar, tag pages suppress reader mode
  - `byPageType` layout config in YAML to customize component placement per page type

---

## 🔁 26. Block & Heading Transclusions

- [ ] 🔴 **Block-level transclusion** (`![[note#^blockref]]`)  
  Quartz supports embedding specific paragraphs or list items identified by a `^block-id` suffix. We only support full-note embedding with `![[note]]`.
- [ ] 🔴 **Heading-section transclusion** (`![[note#Heading Name]]`)  
  Embeds only the section under a specific heading (up to the next same-level heading). Quartz walks the HAST AST to extract the exact section. We do full-file embedding only.
- [ ] 🟡 **Circular transclusion detection** — Quartz detects and breaks cycles with a `visited` set

---

## 🎨 27. Theme System

- [ ] 🟠 **`@quartz-themes` community plugin** (`@quartz-themes/core`)  
  Drop-in CSS themes (tokyo-night, catppuccin, gruvbox, etc.) configurable per light/dark mode with a `theme:` YAML key.
- [ ] 🟡 **Per-note `cssclasses` frontmatter** — apply arbitrary CSS classes to individual notes for custom per-note layouts

---

## 🖋️ 28. Content Authoring Helpers

- [ ] 🟡 **Obsidian Flavored Markdown (OFM) full spec** (`@quartz-community/obsidian-flavored-markdown`)  
  Beyond basic wikilinks and embeds, full OFM includes:
  - Interactive task checkboxes (`- [x]`)
  - Highlight syntax (`==highlighted text==`)
  - Strikethrough (`~~text~~`)
  - Custom callout blocks (`> [!note]`, `> [!warning]`, `> [!info]`, etc. — 13 types)
  - In-HTML embed support for raw HTML blocks
- [ ] 🟡 **GitHub Flavored Markdown (GFM)** (`@quartz-community/github-flavored-markdown`)  
  Tables, task lists, autolinks, footnotes — we have basic marked.js but not all GFM extensions.
- [ ] 🟢 **Footnotes with backlinks** — `[^1]` references jump to bottom footnote, footnote links back to reference

---

## 🏃 29. Performance & Build Optimization

- [ ] 🟠 **Static content index (`contentIndex.json`)** pre-built at sync/deploy time  
  Enables instant client-side search and graph rendering without server round-trips.
- [ ] 🟡 **CSS hashing & cache-busting** — Quartz hashes all CSS/JS filenames for long-term browser cache
- [ ] 🟡 **Extracted inline resources** — inline `<style>` and `<script>` blocks extracted to files for CDN caching
- [ ] 🟡 **Parallel worker build** (`quartz/worker.ts`) — builds pages in parallel with a worker thread pool

---

## ♿ 30. Accessibility

- [ ] 🟠 **ARIA live region route announcer** — screen reader announces page title on SPA navigation
- [ ] 🟡 **Focus management on navigation** — restore focus to main content heading after nav
- [ ] 🟡 **Keyboard-navigable file explorer** — arrow keys, Enter, Escape
- [x] 🟡 **Skip-to-content link** — shipped in `BaseLayout.astro` as the first tab
      stop, off-screen until focused, targeting `#main-content`. Full-bleed routes
      (`noMainWrapper`: the workspace shell, canvas studio) get a zero-size anchor
      rather than a wrapper `<main>`, so their box tree is unchanged.
- [x] 🟡 **Proper `lang` attribute** — `<html lang="en">` was already set in
      `BaseLayout.astro:53`; verified rather than added. Per-locale routing stays
      open behind i18n below.

---

## 📊 31. Analytics

- [ ] 🟢 **Plausible / Umami / Fathom / Google Analytics integration** (`analytics.provider` config)  
  Configurable privacy-first analytics providers. Quartz injects the provider script at build time based on YAML config.

---

## 🔧 32. Developer Experience

- [ ] 🟡 **Pluggable transformer/emitter/filter architecture** — any feature can be installed as a versioned npm package from GitHub (e.g. `github:user/quartz-plugin`)
- [ ] 🟡 **Per-component CSS isolation** — each component has a companion `.scss` file; unused component CSS is tree-shaken
- [ ] 🟡 **`data-persist` attribute** — mark `<script>` and `<meta>` tags to survive SPA page transitions without re-execution
- [ ] 🟢 **Favicon auto-generation from SVG** (`@quartz-community/favicon`) — generates `.ico`, `192×192`, `512×512`, and Apple touch icon from a single source SVG

---

## 📋 Implementation Status & Audit Checklist

**Status**: 🟡 Deferred & Partially Backported | **Active Track**: Selective SSR-First Backporting

- [x] Folders & File Explorer (`FolderTree.tsx` implemented with recursive trees, active document highlight, collapsible nodes)
- [x] Local & Global Knowledge Graph (`GraphView.tsx` & `CanvasGraphView.tsx` with D3 force simulation and modal views)
- [x] Table of Contents (`TableOfContents.tsx` with intersection observer, reading progress bar)
- [x] Wikilinks, Backlinks & Embeds (`Backlinks.tsx`, `WikilinkPreview.tsx`, `renderEngine.ts`)
- [x] Content Meta, Word Count & Reading Time (`ContentMeta.astro`)
- [x] Dark / Light Mode & Theming System (`prefs.ts`, `ThemeToggle`, CSS variables)
- [x] LaTeX / Math SSR rendering (KaTeX server-side rendering in `renderEngine.ts`)
- [x] Code Syntax Highlighting (Shiki server-side rendering)
- [x] Dynamic OG Image & Metadata Generation (`ResourceHead.astro`)
- [x] Tag System & Tag Navigation (`/tags/[tag].astro`)
- [ ] Client-side Pre-indexed Search (`contentIndex.json` offline search engine; currently backend PostgreSQL/Meilisearch)
- [ ] Block & Heading Transclusions (`![[note#heading]]` and `![[note#^block]]`)
- [ ] Stacked Sliding Panes (Andy Matuschak mode)
- [-] SPA Navigation & Micromorph Router (Deferred in favor of deterministic SSR-first architecture with React interactive islands)
- [-] `data-persist` SPA transition state preservation (Deferred with SPA router)

