# Roadmap: Easy Wins & Pending Tasks Ranked

Based on the pending features and feature gaps compared to Quartz, Notion, and Obsidian, here is a breakdown of the remaining tasks ordered from **Easiest (Quick Wins)** to **Hardest (Complex Architecture)**.

## 🟢 Quick & Easy Wins (1-2 Hours)

These are isolated features that don't require major architectural changes and offer immediate value.

1. **Comments System (Giscus/Utterances)**
   - **Why it's easy**: Just involves dropping a client-side script tag (configured for GitHub discussions) into the footer of the article layout.
   - **Impact**: Instant community interaction on public-facing notes.

2. **Note Properties Panel**
   - **Why it's easy**: We already parse and store `metadata` (JSONB). This just requires building a UI component to cleanly display properties (like tags, aliases, custom fields) in a stylized box next to or above the content.
   - **Impact**: Better visibility into the metadata of a document without reading the raw markdown frontmatter.

3. **Folder Index Pages**
   - **Why it's easy**: Requires creating a dynamic Astro route (e.g., `src/pages/folders/[...path].astro`) that queries PostgreSQL for all resources where the path matches the folder, and rendering them as a list of cards. Very similar to the Tag Index page we already built.
   - **Impact**: Improves navigation so users aren't met with a 404 if they navigate to a directory path instead of a specific file.

4. **Alias Redirects**
   - **Why it's easy**: We already added `?doc=` alias resolution in the main index. To make it robust, we can add a simple middleware or an Astro endpoint that intercepts URLs matching known aliases and issues a 301 redirect to the canonical URL.

## 🟡 Medium Complexity (2-5 Hours)

These require some new UI libraries, deeper database queries, or careful state management.

5. **Wikilink Hover Popovers**
   - **Why it's medium**: Requires parsing hovered `[[wikilinks]]` on the client side, fetching the target document via a lightweight API endpoint, extracting a preview snippet, and positioning a floating card using a library like `@floating-ui/dom`.

6. **File Explorer / Sidebar Navigation**
   - **Why it's medium**: We need to query the entire resource hierarchy from Postgres, build a recursive tree data structure, and render an interactive UI component (likely React) that remembers which folders are open/closed via `localStorage`.

7. **Git-based / DB-based Timestamps**
   - **Why it's medium**: If relying on Git, requires a Node `child_process` script to parse `git log` per file. If relying on the DB, requires updating our Postgres schema and insertion logic to accurately track `created_at` and `updated_at` without relying purely on frontmatter.

## 🟠 High Complexity (1-3 Days)

These are major features that fundamentally change how the application feels or require heavy data processing.

8. **SPA Router & Client-Side Navigation**
   - **Why it's hard**: Moving away from full page reloads requires integrating a DOM-diffing library (like `micromorph`, Swup, or Turbo). This often breaks client-side scripts (like Shiki, MathJax, or custom toggles) which must be carefully re-initialized on every navigation event.

9. **Full-Text Search Engine**
   - **Why it's hard**: Building a *good* search requires implementing Postgres `tsvector` / `pg_trgm` indexes for fast fuzzy matching across titles, tags, and body content, plus building an interactive client-side UI with debouncing and keyword highlighting. Alternatively, it requires generating a massive client-side index file at build time.

10. **Interactive Graph View**
   - **Why it's hard**: Requires querying all relationships (wikilinks) between all documents, serializing them into a node/edge graph, and rendering a highly interactive D3.js Force Simulation canvas with zoom, pan, and hover physics.

## 🔴 Very High Complexity / Architectural Shifts (1+ Weeks)

These features push the boundaries of our current Markdown-first architecture.

11. **Bases (Dataview-style Database Queries)**
   - **Why it's very hard**: Requires building a custom query language (or using SQL/JSONB heavily) to allow users to dynamically query and filter collections of notes. Then, building complex UI views (Kanban boards, interactive tables, galleries) to render that data, moving us closer to Notion's feature set.

12. **Block & Heading Transclusions**
   - **Why it's very hard**: Currently we parse whole files. To embed specific blocks (`![[note#^blockref]]`) or headings, we need to completely overhaul our `renderEngine.ts` to generate an Abstract Syntax Tree (AST), traverse it, isolate the specific section, and render only that section while handling circular dependencies.


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Phase 1 Wins Delivered | **Track**: Incremental Usability Roadmap

- [x] Note Properties Panel (Delivered in Plan 19)
- [x] Folder Index Pages (Delivered in Plan 19)
- [x] Alias Redirects (Delivered in Plan 19)
- [ ] Live Dataview / Bases queries
- [ ] Full-text search result preview term highlighting
