# 01 - System Architecture & Tech Stack

**Module**: 01 Architecture & Core Framework  
**Parent Plan**: [Master Index](../1.md)

---

## 1. Core Framework Architecture

The core web framework is built using **Astro in Server-Side Rendering (SSR) mode** (`output: 'server'`). Astro provides an optimal foundation by enabling static zero-JS HTML rendering by default while supporting interactive "UI Islands" powered by React or Preact when stateful interactivity is required.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Astro SSR Web Application                          │
├───────────────────────────────┬─────────────────────────────────────────────┤
│  Zero-JS Core Pages           │  Interactive React/Preact Islands           │
│  - Document Viewers           │  - JSON Canvas Editor (Canvas Node Views)   │
│  - Wikilink Graph Renderers   │  - FortuneSheet Data Grids                  │
│  - Static HF Article Layouts  │  - Dynamic Form Builders (@rjsf/core)       │
│  - Backlink & Search Result   │  - AuthZ Permission Admin Console           │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

### Key Framework Capabilities
- **Quartz Content Pipeline Compatibility**: Utilizes the `unified` ecosystem (`remark-parse`, `remark-rehype`, `rehype-stringify`, `remark-wiki-link`) to transform raw Markdown into standard HTML/JSX ASTs.
- **HuggingFace Research Article Components**: Direct inclusion of MDX components inspired by HF research templates—interactive callouts, figures, mathematical formulas (KaTeX), citations, and collapsible accordions.
- **Per-Request Middleware Execution**: Every request passes through Astro SSR middleware (`src/middleware.ts`) which authenticates session tokens and queries the authorization service (OpenFGA) before rendering bytes to the client.

---

## 2. Content AST Processing Flow & Bounded Transclusion Pipeline

```
┌──────────────┐     remark-parse      ┌──────────────┐    remark-wiki-link    ┌──────────────┐
│ Raw Markdown │ ────────────────────> │ Markdown AST │ ─────────────────────> │ AST with     │
│ & Frontmatter│                       │   (mdast)    │                        │ Wikilinks    │
└──────────────┘                       └──────────────┘                        └──────────────┘
                                                                                       │
                                                                                       │ remark-rehype
                                                                                       ▼
┌──────────────┐      Astro SSR        ┌──────────────┐    hast-util-to-jsx    ┌──────────────┐
│ Rendered     │ <──────────────────── │ Astro / MDX  │ <───────────────────── │ HTML AST     │
│ Response     │    Pre-Request Auth   │ Components   │                        │   (hast)     │
└──────────────┘                       └──────────────┘                        └──────────────┘
```

### ADR 2.1: Bounded Recursive Transclusion / Embed Pipeline (`MAX_EMBED_DEPTH = 3`)
- **Design Decision**: Embedded resources (`![[target]]`) are processed recursively up to a configurable maximum depth limit (`MAX_EMBED_DEPTH = 3`).
- **Transclusion Engine**:
  - **Embedded Images (`![[image:slug]]`)**: Renders raw image viewports directly inline inside note text without article metadata headers.
  - **Embedded PDFs (`![[pdf:slug]]`)**: Renders interactive PDF stream viewports directly inline inside note text.
  - **Embedded Sub-Notes (`![[document:slug]]`)**: Recursively renders child Markdown content, LaTeX math formulas, and HTML bodies inside scrollable glass containers at `depth < MAX_EMBED_DEPTH`.
  - **Loop Prevention**: When `depth >= MAX_EMBED_DEPTH`, further recursive note embeds are capped and replaced with a clean warning badge (`🛑 Max Embed Depth (3) Reached - Open Note ↗`) to prevent infinite recursion loops and layout degradation.

---

## 3. Pivot Notice & Alternatives Matrix

If the architectural constraints or team requirements shift, the following framework pivots are pre-evaluated:

### Pivot Option A: Next.js (App Router)
- **When to Pivot**: If the engineering team is exclusively React-native, requires heavy client-side state synchronization, or heavily utilizes React Server Components (RSC).
- **Trade-offs**: Slightly larger bundle sizes; requires rewriting HuggingFace Astro components to React/MDX components; relies on Node server or Vercel hosting.
- **Migration Cost**: Low to Moderate.

### Pivot Option B: SvelteKit
- **When to Pivot**: If extreme client performance, minimal memory footprint, and reactive state management without virtual DOM overhead are prioritized.
- **Trade-offs**: Smaller ecosystem for MDX research widgets compared to React; requires custom wrapper components for PDF.js and canvas nodes.
- **Migration Cost**: Moderate.

---

## 4. Next Steps & References
- Proceed to [02 PDF & Media Asset Pipeline](02_pdf_and_media_pipeline.md) for media asset handling.
- Review overall authorization engine in [03 Authorization, ReBAC & API](03_authorization_rebac_and_api.md).
