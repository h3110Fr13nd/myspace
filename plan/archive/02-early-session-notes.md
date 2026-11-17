# Session 2 — Design Decisions & Architecture Record
> **Date:** 2026-08-11  
> **Scope:** Render engine, component rendering, layout, modularization, repository setup

---

## 1. SSR-first rendering strategy (confirmed)

**Decision:** All content rendering — Markdown parsing, math, syntax highlighting, component tag transforms, file-based embed resolution — runs exclusively on the Node.js SSR server (Astro `output: "server"` + `@astrojs/node`). No content rendering JS is shipped to the browser.

**Rationale:**
- KaTeX server-side → zero MathJax/KaTeX runtime bundle for the user; math arrives as fully rendered HTML+CSS
- Shiki server-side → zero PrismJS/highlight.js bundle; code arrives as pre-tokenised `<span>` elements
- `marked` server-side → zero client-side Markdown parser
- Embed resolution (`![[doc]]`) requires `fs.readFileSync` — only possible on the server
- Page arrives fully rendered; zero layout shift for content

**Client-side islands (hydrated with `client:*` directives):**
- `GraphView.tsx` — D3 force simulation, pointer events
- `SearchModal.tsx` — keyboard input, live search
- `TableOfContents.tsx` — `IntersectionObserver` for active heading tracking

---

## 2. Render pipeline stage order

**Decision:** The render pipeline applies transforms in a strict stage order before the final `marked.parse()` call:

```
Stage 1  MDX/JSX component tag transforms   (mdxComponents.ts)
Stage 2  KaTeX display + inline math        (mathRenderer.ts)
Stage 3  ![[embed]] transclusion            (embedResolver.ts)
Stage 4  [[wikilink]] resolution            (embedResolver.ts)
Stage 5  marked.parse()                     (renderEngine.ts — final Markdown→HTML)
Stage 6  Shiki fenced code block injection  (codeHighlighter.ts — async only)
```

**Rationale:** MDX components must be resolved before `marked` runs, because `marked` would otherwise treat their tags as raw HTML and misplace them in the output. Math must be resolved before `marked` so `\[` and `\(` delimiters aren't consumed by Markdown processing. Shiki runs last (async) by extracting fenced code blocks into `%%PLACEHOLDER%%` tokens before the sync pipeline, then substituting them after.

---

## 3. Bounded recursive transclusion depth

**Decision:** `MAX_EMBED_DEPTH = 3`. Recursive `![[document]]` embeds are capped at depth 3. When the cap is reached, a styled link-out card is shown instead of rendering the nested document.

**Rationale:** Without a cap, a note that embeds itself (or forms an embed cycle) would cause infinite recursion and an OOM crash on the SSR server. Depth 3 allows "note → section → sub-note" patterns while preventing unbounded recursion. The depth limit is exported from `renderEngine.ts` so it can be referenced in the depth-limit UI card without hard-coding.

---

## 4. MDX component tag handling strategy

**Decision:** Instead of using Astro's MDX compiler (which would require `.mdx` file format and a full Vite rebuild per note edit), custom MDX component tags embedded in `.md` content files are handled via regex string transforms in `mdxComponents.ts`.

**Supported tags and their rendered output:**

| Tag | Rendered As |
|:----|:------------|
| `<Accordion title="..." open>` | `<details>` (always closed on load — see §5) |
| `<Note variant="..." emoji="...">` | Bordered callout div |
| `<Quote source="...">` | `<blockquote>` with footer |
| `<Sidenote>` | Inline side-note callout |
| `<Glossary term="..." definition="..."/>` | `<span>` tooltip badge |
| `<Stack layout="...">` | CSS Grid container |
| `<Wide>` | Full-bleed margin container |
| `<FullWidth>` | Full-viewport-width section |
| `<Reference id="..." caption="...">` | `<figure>` + `<figcaption>` |
| `<HtmlEmbed src="..." title="..." desc="..."/>` | Placeholder card (no live iframe) |
| `<Image alt="..." caption="..."/>` | `<figure>` placeholder card |
| `{/* JSX comments */}` | Stripped entirely |
| `className=` | Replaced with `class=` |
| `prop={expression}` | Stripped (non-string JSX props) |

**Rationale:** Notes are `.md` files edited live without a build step. MDX compilation at request time for every note would be prohibitively slow and would require a Vite/Rollup instance to remain running inside the SSR server. Regex transforms are fast, predictable, and sufficient for the component vocabulary present in the research template inspiration content.

---

## 5. Accordion open-state default

**Decision:** All `<Accordion>` tags render as `<details>` with **no `open` attribute** regardless of whether the source tag includes `open`.

**Rationale:** The inspiration template demo content includes many accordions with `open` by default. When rendered, each open accordion expands immediately, flooding the page with large prop-tables and pushing subsequent content far down. Closing all accordions on load keeps the note readable; users can open them individually.

---

## 6. No `glass-card` (`backdrop-filter`) on inline prose components

**Decision:** Inline prose components (Accordion, Note, Quote, Sidenote, Reference, HtmlEmbed, Image placeholders) do **not** use the `.glass-card` CSS class. They use plain bordered divs with opaque/semi-transparent backgrounds.

**Rationale:** `backdrop-filter: blur()` creates a new CSS stacking context on every element it is applied to. When multiple stacking contexts are present inside a scrollable article column, browsers paint them according to stacking order rather than document flow. This caused accordion tables to render visually on top of the article title and adjacent paragraphs — a z-index bug that `isolation: isolate` alone cannot fully prevent when `backdrop-filter` is present on child elements. The `glass-card` class is appropriate for top-level UI cards (sidebar panels, modal dialogs, graph container) but not for inline paragraph-level content components.

**Additional CSS guard added:**
```css
.prose-content {
  isolation: isolate;
  position: relative;
  overflow-x: hidden;
}
```

---

## 7. Shiki dual-theme code highlighting

**Decision:** Fenced code blocks use Shiki with `github-dark` as the primary theme and `github-light` as the alternate, using CSS variable dual-theme mode (`defaultColor: false`).

**Implementation details:**
- Shiki runs fully server-side (async, `codeToHtml()`)
- All blocks in a single render call are highlighted in parallel (`Promise.all`)
- Each block gets a language badge (top-left) and a hover-reveal copy button (top-right)
- Falls back to a styled plain `<pre><code>` if Shiki can't recognise the language
- The dark theme's token colors are applied via `.shiki span { color: var(--shiki-dark) !important }`

**Rationale:** Matches the inspiration template's code block aesthetic. Server-side Shiki means zero highlight.js/PrismJS bundle shipped to the browser, and consistent token coloring across all languages (TypeScript, Python, Bash, JSON, MDX, etc.).

---

## 8. Table of Contents placement

**Decision:** The Table of Contents (TOC) lives in the **right sidebar column**, between the graph view and the backlinks panel.

**Position in column:** `GraphView` → `TableOfContents` → `Backlinks`

**Implementation:** Headings (`h1`–`h4`) are parsed from the rendered HTML at mount time using `querySelectorAll`. Active section is tracked via `IntersectionObserver`.

**Rationale:** This matches the Quartz convention (right-column TOC) which the user referenced. Placing it between the graph (global context) and backlinks (related documents) creates a logical hierarchy: where you are globally → where you are in this document → what else is connected.

---

## 9. Layout grid: constrained column widths

**Decision:** The three-column layout uses fixed sidebar widths with `minmax(0, 1fr)` for the content column:

```css
grid-template-columns: 280px minmax(0, 1fr) 300px;
```

`min-width: 0` is also applied to the content column container.

**Rationale:** Without `minmax(0, 1fr)` (i.e. using plain `1fr`), CSS Grid tracks have an implicit minimum size of `auto`, which means the content column grows to fit its widest child — tables, wide code blocks, or `<Wide>` containers can cause the column to expand beyond the viewport. `minmax(0, 1fr)` collapses the minimum to 0, allowing overflow-x to take effect on children instead.

---

## 10. Render engine modularization

**Decision:** `renderEngine.ts` is split into four focused modules under `src/lib/render/`:

| Module | Responsibility |
|:-------|:---------------|
| `mdxComponents.ts` | All MDX/JSX component tag transforms |
| `mathRenderer.ts` | KaTeX display + inline rendering |
| `embedResolver.ts` | `![[]]` transclusion + `[[]]` wikilinks |
| `codeHighlighter.ts` | Shiki async pipeline, `escapeHtml` |

`renderEngine.ts` becomes a ~70-line orchestrator that imports from all four and exports only the public API: `renderMarkdownWithEmbeds`, `renderMarkdownWithEmbedsAsync`, `MAX_EMBED_DEPTH`.

**Public API is unchanged** — all callers (`index.astro`, `preview.ts`) import from `renderEngine.ts` as before.

**Rationale:** The original 340-line file mixed five distinct concerns. Each module is now independently testable, has a clear single responsibility, and can be modified without reading the entire pipeline.

---

## 11. Git repository setup

**Decision:** The project is hosted as a **private** GitHub repository at `example-org/foss-content-workspace`.

**Included (previously gitignored):**
- `temp/` — extracted research PDFs, parsed JSON, working images
- `.env` — environment variables (kept private by repo visibility)

**Submodules** (pointing to their upstream public repos):

| Path | Remote | Purpose |
|:-----|:-------|:--------|
| `inspiration/jsoncanvas` | `github.com/obsidianmd/jsoncanvas` | Canvas spec reference |
| `inspiration/quartz` | `github.com/jackyzha0/quartz` | Navigation/backlink inspiration |
| `inspiration/research-article-template` | `huggingface.co/spaces/example-author/research-article-template` | Component library source |

**Git LFS:** `*.pdf` and `*.zip` files are tracked via Git LFS to avoid GitHub's 50 MB single-file warning. The `temp/` content is intended to be removed from the repo once the project reaches a stable state.

**Clone note:** `git clone --recurse-submodules` required to get the inspiration content.

---

## 12. HtmlEmbed rendering (no live iframe)

**Decision:** `<HtmlEmbed src="..."/>` tags render as a **placeholder card** (title, description, filename label) rather than a live `<iframe>` or `<object>` embed.

**Rationale:** The `src` paths in the inspiration content (e.g. `smol-playbook/generic-d3-line-chart.html`) refer to static HTML files in the HuggingFace Spaces asset directory — they are not reachable from this server. Rendering an `<iframe>` pointing to a non-existent path would produce a broken embed (404 frame). The placeholder card clearly communicates the embed's intent without a broken UI element. Live HtmlEmbed support can be added later if the actual asset files are made available.
