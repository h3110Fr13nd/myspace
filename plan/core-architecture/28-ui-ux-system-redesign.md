# UI/UX System Redesign: Design Foundation, Consistency, and Theming

> **Status (2026-11-11): Historical audit, superseded as an implementation
> checklist.** This snapshot predates the current token system, shared UI
> primitives, and toast infrastructure; its “Current State Audit” must not be
> treated as a description of the live application. The normative UI rules are
> in [`docs/design-system.md`](../../docs/design-system.md), and current UX
> progress belongs in [`docs/GOALS.md`](../../docs/GOALS.md). The original
> findings below are retained as historical context; re-audit an individual
> item against current code before reopening it.

> **Document**: `plan/initial/28-ui-ux-system-redesign.md`
> **Scope**: Full application sweep — design foundation (tokens/theming), component primitives, shared layout, resource viewer chrome, graph engine unification, canvas studio shell, registry-driven catalogs
> **Goal state**: Consistent, clean, non-cluttered, intuitive, modern, maintainable, DRY, modular, reusable, fixable-in-one-place UI with user-customizable theming
> **Non-negotiable**: Preserve the dark-glass aesthetic and all existing behavior; nothing here is a visual rebrand — it is a systematization.

---

## 1. Executive Summary & Core Philosophy

The app has grown fast and the UI has grown with it. The result is functionally rich but structurally inconsistent:

- **1,317 inline `style={{...}}` literals** across 65 component files (vs. 654 `var(--…)` usages).
- **1,207 hardcoded colors** (503 hex + 704 `rgba`) vs. 654 token references — the most common being `#fff` × 212.
- **Two competing "cyans"**: token `--accent-cyan = #06b6d4` vs. de-facto `#00f2fe` × 170, used interchangeably *within the same components*.
- **Zero spacing/type tokens**, yet **40+ padding values**, ~25 margin values, 20 font sizes, 11 radii are repeated by hand.
- **No shared Layout** — 11 pages each hand-roll `<html>/<head>/<body>` and import `global.css`.
- **No UI primitives** exist (`Button`, `Modal`, `Tooltip`…) — the orphaned `.btn-*` / `.badge-*` class family is consumed 32+ times but **styled nowhere**.
- **File-level duplication**: `GraphModal.tsx` ↔ `CanvasGraphModal.tsx` are 94.3% identical; `GraphView.tsx` (SVG) ↔ `CanvasGraphView.tsx` (canvas) are 43.6% identical; both modals, every viewer, and both graph engines re-implement the same orchestrator.
- **No toast/notification system**; status feedback is ad-hoc inline strings.
- **Light theme is structurally broken** — modals/header/viewers hardcode dark values and never flip.

### Core Philosophy

Build a **small, token-driven, primitive-first design system** and then **refactor every surface onto it**. Every UI decision lives in exactly one place: a token, a primitive component, or a shared hook. Theming becomes a *utility* rather than a promise: because everything resolves through CSS variables, a user picking an accent color or a "compact" density just flips `data-theme` attributes — no component changes.

### The One-Place Rule

> Every visual property and every repeated interaction pattern must be resolvable from exactly one source of truth. If a change requires editing more than one file, the refactor is incomplete.

---

## 2. Current State Audit (The Problem)

| # | Finding | Evidence | Blocker for |
| :-- | :-- | :-- | :-- |
| 1 | Inline style soup | 1,317 `style={{` (65 files); top: `iam/GcpStylePermissionManager.tsx` (101), `canvas/CanvasEditor.tsx` (87), `canvas/CanvasViewer.tsx` (65), `graph/GraphDrawer.tsx` (56) | Consistency, theming, DRY |
| 2 | Hardcoded colors beat tokens 1.2k : 654 | `#fff` ×212, `#00f2fe` ×45, `#10b981` ×31; 704 rgba | Theming, light mode |
| 3 | Two "cyan" accents | `--accent-cyan=#06b6d4` vs `#00f2fe` (e.g. `GraphTooltip.tsx:37,41` mixes both) | Brand consistency |
| 4 | No spacing/type-scale tokens | 40+ paddings, 20 font sizes, 11 radii inline (`global.css` has only 2 space-ish values) | Layout rhythm |
| 5 | No shared Layout | 11 pages self-host `<html>` + import `global.css`; no `src/layouts/` | Consistency, SSR/theme init |
| 6 | No `ui/*` primitives; orphaned classes | `.btn .btn-primary …` used 32× in 5 files but styled nowhere; `.badge-true/false` re-defined *inside* `PropertiesPanel.astro:261-267` | DRY, fixability |
| 7 | 7+ bespoke modal shells | Fixed overlays re-invented per component (`zIndex` 99999→99999999, near-identical backdrops; no portal primitive, no focus trap) | Consistency, a11y |
| 8 | Graph engine duplicated | `GraphView`/`CanvasGraphView` 43.6% identical; `GraphModal`/`CanvasGraphModal` 94.3% identical; both mount widget+modal duplicated | DRY |
| 9 | `GraphLegend` duplicates `ENTITY_META` | `GraphLegend.tsx` hardcodes the 8-color palette already in `graph/constants.ts:24-37` | Consistency |
| 10 | Viewer chrome repeated ×7 | `PdfViewer/ImageViewer/GoogleDriveViewer/MermaidViewer/ExcalidrawViewer/JupyterViewer/SheetGrid` each inline their own header, zoom controls, `isEmbedded` branch | Modularity |
| 11 | Resource-type catalog duplicated | `SearchModal` `CREATE_COMMANDS` ↔ `CreateResourceModal` `CREATE_TYPES` ↔ `blogs/[user]/index.astro` `TYPE_META` | DRY |
| 12 | `CanvasEditor` (2004 lines) + `CanvasViewer` (1023) re-implement board shell | Pan loop, transform state, modal board, hit-testing written twice | Maintainability |
| 13 | Icons are emoji/spans | `⚡ 🎛️ ⤢ ↗ ⛶ …` vs installed-but-unused `lucide-react` | Polish, consistency |
| 14 | No toast system | Save status is a string (`CanvasEditor.tsx`); no global feedback | UX quality |
| 15 | Light theme broken | Header hardcodes `rgba(10,15,30,0.85)` (`Header.astro:31`); modals always dark; 212 `#fff` never flip | Theming |
| 16 | Theme init bug | `ResourceHead.astro:111`: `prefDark ? 'dark' : 'dark'` — `prefers-color-scheme` is dead | User trust |
| 17 | Dead code | `SimilarContent.tsx` never imported | Cleanliness |

Historical note: `graph/useGraphState.ts` was later found to have no code imports
and was removed. Current graph state/render orchestration lives in
`graph/useGraphEngine.ts` and `graph/GraphShell.tsx`; graph topology lives in
`src/lib/workspace/graphTopology.ts`. This old audit's other findings need the
same current-code verification before they are treated as open work.

---

## 3. Design Principles (The North Stars)

The user-facing qualities this plan optimizes for, each mapped to a concrete mechanism:

| Principle | Mechanism |
| :-- | :-- |
| **Consistent** | Every visual decision resolves through tokens + primitives. Zero inline hex/spacing in `src/components` after migration. |
| **Clean / non-cluttery** | One `resource-visual-consistency` layer: uniform viewer chrome, spacing scale (4px grid), max 2 emphasis levels per surface, single badge/button language. |
| **Intuitive / user-friendly** | Universal patterns: one Modal primitive (Escape, focus trap, scroll lock), keyboard parity everywhere, hover-reveal controls, consistent empty/loading/error states. |
| **Modern** | Dark-glass refinement: consistent blur/elevation, micro-motion via one timing system, `lucide-react` icon set, accessible focus rings. |
| **Maintainable / easily fixable** | One-Place Rule: tokens in `global.css`, primitives in `src/components/ui/`, engines behind hooks, catalogs in the registry. Fixing a color/radius/behavior = one file. |
| **DRY** | Collapse the 4 verified duplication clusters (graph orchestrator, modal pair, viewer chrome, resource-type catalog) plus the orphaned class family. |
| **Modular / reusable** | Every engine behind a hook (`useGraphEngine`, `useZoomPan`, `useCanvasBoard`); every UI piece behind a primitive; every catalog behind the existing `resourceRegistry`. |
| **User-customizable** | Full token theming via CSS variables; `data-theme` dimensions (accent, radius, density, type-scale) exposed in a new `/settings/appearance` page; persisted to `localStorage` like today. |

---

## 4. Foundation A — Design Tokens & Theming System

### 4.1 Token Architecture

Extend `global.css` from 27 to a complete, tiered set. Tokens are **semantic** (what it's for) layered on **primitive** (the raw scale). Components reference only semantic tokens.

```css
:root {
  /* Primitive scales */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 24px; --space-6: 32px; --space-8: 48px;
  --text-xs: 0.75rem; --text-sm: 0.85rem; --text-md: 1rem;
  --text-lg: 1.25rem; --text-xl: 1.5rem; --text-2xl: 1.75rem;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-xl: 22px; --radius-pill: 9999px;
  --elevation-1: 0 2px 8px rgba(0,0,0,.3); --elevation-2: 0 8px 32px rgba(0,0,0,.37);
  --motion-fast: 120ms; --motion-base: 200ms; --motion-slow: 320ms;
  --ease-out: cubic-bezier(.4,0,.2,1);
  --z-overlay: 1000; --z-modal: 2000; --z-toast: 3000;
}
[data-theme="light"], [data-theme="violet"], [data-theme="emerald"] { /* theme overlays */ }
```

### 4.2 Semantic vs. Primitive Rule

- Components/UI primitives use **semantic tokens only**: `var(--surface-1)`, `var(--border-subtle)`, `var(--text-brand)`, `var(--control-bg)`.
- Dark/light and user themes override **primitive+semantic values** — never component styles.
- New semantic families to add (each with dark + light values):

| Family | Example tokens | Replaces |
| :-- | :-- | :-- |
| Surfaces | `--surface-1/-2/-3`, `--surface-overlay` | `#0f172a`, `rgba(10,15,30,…)` ×100 |
| Text/copy | `--text-primary/-secondary/-muted/-inverse` | `#fff` ×212, `#94a3b8`, `#64748b` |
| Accents | `--accent-cyan/-primary/-rose/…` + `--accent-cyan-soft/-strong` | `#00f2fe` vs `--accent-cyan` fork |
| Semantic status | `--success/--warning/--danger/--info` + soft variants | `#10b981`, `#f43f5e`, `#06b6d4` inline |
| Controls | `--control-bg`, `--control-border`, `--control-hover` | `.btn-*` orphan + input styles |
| Graph palette | `--graph-<entity>` (derived from `ENTITY_META`) | `constants.ts` hex + `GraphLegend` duplicate |

### 4.3 Reconcile the Two-Cyan Problem

Decision (see ADR-002): **`#06b6d4` stays as the canonical brand cyan.** Introduce `--accent-cyan-bright: #00f2fe` as the explicit "glow/active/highlight" variant so both existing usages survive but are *named*. Migrate all 170 `#00f2fe` literals to `var(--accent-cyan-bright)` and the 152 `var(--accent-cyan)` usages to their intended semantic token.

### 4.4 User-Customizable Theming

Reuse and generalize the existing `workspace_theme` mechanism (already functional in `Header.astro:184-201` / `ResourceHead.astro:105-117`):

1. **Theme dimensions** (each an independent selector on `<html>` `data-theme`):
   - `data-theme="dark|light"` — existing base.
   - `data-accent="brand|violet|emerald|rose|ocean"` — accent palette overlays (5 curated sets; brand = current).
   - `data-density="comfortable|compact"` — remaps `--space-*`, `--text-*` via `:root[data-density] { --space-…: … }`.
   - `data-mode="glass|flat"` — glass blur/elevation on/off for perf-sensitive users (already hinted by `.canvas-board-viewport.is-interacting` rules).
2. **Selection UI**: new `src/pages/settings/appearance.astro` (gated like `security.astro`), persisting an object:
   ```
   workspace_prefs = { theme:'dark', accent:'brand', density:'comfortable', mode:'glass' }
   ```
   Same `localStorage` key pattern; the existing inline init script grows to apply all four attributes so there is **no flash on load** (and finally honors `prefers-color-scheme` per ADR-003).
3. **Admin app** untouched — this is purely client presentation and stays off the DB.

---

## 5. Foundation B — Component Primitive Library (`src/components/ui/`)

A new, tiny, dependency-free-on-CSS-lib layer. Every primitive is built on `global.css` tokens + classes, typed, and gets a Storybook-less doc comment. Do **not** introduce Tailwind or a CSS-in-JS library.

| Primitive | API (highlights) | Collapses |
| :-- | :-- | :-- |
| `Button` | `variant {'primary','secondary','ghost','danger'}`, `size {'sm','md','lg'}`, `icon`, `loading`, `disabled` | The `.btn-*` orphans + 13 bespoke `glass-button` overrides in `Header.astro` |
| `IconButton` | `icon`, `label` (a11y `aria-label`), `active`, `size` | Zoom controls, close buttons, toolbars |
| `Input` / `Select` / `TextArea` | label, `hint`, `error`, `prefixIcon` | Input/select styling re-invented per modal |
| `Badge` | `tone {'default','success','danger','info','warn','neutral'}`, `dot` | `.badge-*`, `badge-true/false`, `badge-scope/active/revoked` |
| `Card` | as `div` with `--surface` semantics; no hardcoded glass inline | Viewer wrappers, folder cards |
| `Modal` | `open,onClose,title,footer,size {'sm','md','lg','full'},portal` — Escape, focus trap, scroll lock, backdrop click, `role="dialog" aria-modal` | **All 7+ bespoke overlays** + the `GraphModal`/`CanvasGraphModal` pair |
| `Drawer` | `open,side {'left','right'},width` | Modal-as-drawer patterns in studio |
| `Tooltip` | `content,side,delay` (use `@floating-ui/dom` — already a dependency) | Inline title/`:hover` hacks |
| `Toast` | `showToast(msg,{tone})` via one module-level store + `<Toaster/>` in Header | The no-feedback gap (save states, copy confirmations) |
| `Stack` / `Flex` | `gap`, `align`, `justify`, `wrap` | 100× repeated `display:'flex',alignItems:'center',gap:'8px'` |
| `Icon` | thin wrapper over installed `lucide-react` with `size`,`tone` | Emoji/span icon soup; enables dark/light correct icons |
| `SectionHeader` | `title,subtitle,actions` | 13+ repeated space-between header rows |
| `Empty/Error/Loading` | `empty(title,desc,action)`, `skeleton`, `error(retry)` | The per-viewer "No nodes match…" strings |
| `Tabs` | `items,value,onChange` | GraphDrawer's bespoke tab bar |

### 5.1 Migration contract

- Every primitive ships with a **CSS class in `global.css`** (`ui-button`, `ui-modal-backdrop`, …) so Astro pages and React islands share one style source. React components get the classes; `.astro` files can use the same classes directly.
- **No component may set `color`/`background`/`padding`/`font-size`/`border-radius` via inline `style`** once migrated (target = 0 in `src/components`; measured by a lint rule, see §11).
- IAM workspace (`iam/*`, 200+ inline styles) migrates last, after patterns are proven.

---

## 6. Foundation C — Layout System

### 6.1 `src/layouts/BaseLayout.astro`

Create the missing shared layout. It owns `<html>`, `<ResourceHead/>`, theme-init script, `<Header/>`, `<Toaster/>`, `<section>` scaffolding, and the single `global.css` import. All 11 pages collapse to:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
---
<BaseLayout title="…" description="…">
  <!-- page body -->
</BaseLayout>
```

This kills finding #5 and makes the theme-init + header consistent in one place. The `workspace-grid` (global.css:92-137) stays but moves into a layout-framed component or a plain section so pages can't drift.

### 6.2 Keyboard & Focus System

Centralize hotkeys (`Ctrl+K`, `R`, `E`, `G`, `M`, `T`, `?`) currently scattered in `KeyboardShortcutsModal.tsx` + per-page listeners into one hook `useShortcuts(registry)` consumed by `BaseLayout`. Establish focus management: Focus trap in `ui/Modal`, `:focus-visible` ring token (`--ring`), skip-to-content link.

---

## 7. Refactor R1 — Unified Resource Viewer Chrome

All 7 viewers share the same skeleton: icon-box + title + subtitle, zoom/action cluster, `isEmbedded` branch, fullscreen modal. Extract:

### 7.1 `src/components/ui/ResourceViewerFrame.tsx`

```tsx
<ResourceViewerFrame
  icon={<FileText />}
  title={...}
  subtitle={{ label: "Key — Authorized for", value }}
  actions={[<IconButton/>, <Button/>...]}   // slotted
  mode={isEmbedded ? 'embedded' : 'standalone'}
  viewport={/* children */}
/>
```

Equals the current `PdfViewer.tsx:26-141` / `ImageViewer.tsx:22-78` / `GoogleDriveViewer.tsx:102-146` chrome, expressed once. A `ResourceViewerHeader` sub-primitive backs `WikilinkPreview.tsx:171-200` too.

### 7.2 `src/lib/viewer/useZoomPan.ts`

One file replacing three divergent implementations:
- iframe `scale(zoom/100)` (`PdfViewer.tsx:157-169`),
- `<img>` scale (`ImageViewer.tsx:98-114`),
- SVG `translate+scale` (`ExcalidrawViewer.tsx:601-611`, `MermaidViewer.tsx:323-349`).

`useZoomPan({ min, max, step, resetTarget })` returns `{ scale, onIn, onOut, onReset, onFit, style }`. Canvas viewers keep their 2D transforms but accept the same hook contract.

### 7.3 `ResourceContentRenderer.astro`

Becomes the *only* place that picks a viewer (it already is — `:52-109`). The duplicate type-switch inside `canvas/nodes/ResourceNodeCard.tsx:35-40` ("mirror ResourceContentRenderer") is eliminated by hoisting a single `renderResourceContent(props)` helper from `src/lib/resourceFactory.ts` / `registry/resourceRegistry.ts` and calling it from both.

---

## 8. Refactor R2 — Graph System Unification

### 8.1 `useGraphEngine` hook

Extract the 43.6%-duplicated orchestrator shared by `GraphView.tsx` and `CanvasGraphView.tsx` (device setup, zoom/fit lifecycle, drag, hover, simulation wiring, widget+modal mounting) into:

```ts
function useGraphEngine(props, host: 'svg' | 'canvas'): GraphEngineHandle {
  // owns deviceRefs, zoomRefs, transformRefs, simulationRefs, quadtreeRefs, renderData
  // exposes attachWidget(el), attachModal(el), fit(), zoomIn(), zoomOut(), resetZoom()
}
```

The two views use shared `GraphShell` orchestration and `useGraphEngine`; the
SVG and canvas render loops remain host-specific. `constants.ts` and
`simulation.ts` provide shared graph types and physics behavior.

### 8.2 Collapse the modal pair

`GraphModal.tsx` and `CanvasGraphModal.tsx` (94.3% identical) merge into a single modal built on `ui/Modal` + `ui/Drawer`: `GraphModal({ canvasRef, zoomBadgeRef, host, …children })`. The only structural difference (SVG vs canvas element) becomes a `host` prop.

### 8.3 Derive `GraphLegend` from `ENTITY_META`

`GraphLegend.tsx` gets its 8 color/label pairs from `entityMetaList()` in `constants.ts` instead of hardcoding (finding #9). New entity types then appear in the legend automatically.

### 8.4 Fix the zoom-drag regression permanently

Keep the container-space subject fix from `CanvasGraphView.tsx` (subject `x/y` = `transform.apply(node)`), and **move it into `useGraphEngine`** so both engines share the corrected behavior and unit tests.

---

## 9. Refactor R3 — Canvas Studio Shell

`CanvasEditor.tsx` is 2,004 lines; `CanvasViewer.tsx` is 1,023 and re-implements the same board shell. Split on the existing seam:

### 9.1 `canvas/CanvasBoardShell.tsx` + `useCanvasBoard.ts`

One shared component owning: viewport div, transform state (`{x,y,k}`), wheel/pinch/spacebar-pan, key handlers, RBush culling, fullscreen board modal, `.is-interacting` classes. Props:

```tsx
<CanvasBoardShell
  mode="edit" | "view"
  canEdit={...}
  onRender={drawFn}      // called per frame with culled nodes/edges
  toolbar={<CanvasToolbar …/>}
  contextMenu={canEdit && <CanvasContextMenu …/>}
  selection={canEdit ? selectionState : undefined}
>
```

- `CanvasViewer` = `<CanvasBoardShell mode="view">` + ~150 lines of render-only logic.
- `CanvasEditor` = `<CanvasBoardShell mode="edit">` + an **`editor/useCanvasEditor.ts`** hook holding selection, marquee, history, grouping (≈600 lines of pure logic isolated from presentation). Target: `CanvasEditor.tsx` shrinks to a composition, not a monolith.

### 9.2 `CanvasToolbar` operator landing

Keeps its ~28 props (already shared) but children/actions rendered through `ui/Button`/`ui/IconButton` instead of the orphan `.btn-*` inline overrides.

---

## 10. Refactor R4 — Registry-Driven Catalogs

### 10.1 One resource-type source

`SearchModal.tsx` `CREATE_COMMANDS`, `CreateResourceModal.tsx` `CREATE_TYPES`, `blogs/[user]/index.astro` `TYPE_META`, and `ResourcePickerModal`'s quick-create strip all encode the same 10-type taxonomy. Collapse into the existing `src/lib/registry/resourceRegistry.ts`:

```ts
export const RESOURCE_TYPE_CATALOG: { type, label, icon, group:'create'|'import', template? }[]
```

Consumers map over it; adding a resource type becomes a **one-file change** (also rendering in legend + graph via `ENTITY_META` linkage).

### 10.2 Tidy-ups folded in

- Delete dead `SimilarContent.tsx` (finding #17); keep `/api/v1/content/similar` for future use.
- Centralize modal **open events** (already centralized in `src/lib/createResourceEvents.ts` + `Header.astro` CustomEvents) — no change, just documented as the contract for `ui/Modal`.
- Replace per-page inline `style="…"` strings in `index.astro:171-207` (folder/doc card grids) with tokens plus a real `<style>` block or `ui/` classes.

---

## 11. Guardrails — Lint, A11y, and Verification

### 11.1 Enforcement (so it stays fixed)

| Check | Mechanism |
| :-- | :-- |
| No inline `style` in `src/components` | ESLint rule `react/forbid-component-props` scoped to `style` (or the Astro equivalent check); CI-gated, count visible in PRs |
| No bare hex/rgba in components | Custom ESLint rule allowing only `var(--…)` in style props/constants files |
| No import of the removed modal/viewer internals | `no-restricted-imports` for merged files |
| No duplicate static catalogs | A unit test asserts `RESOURCE_TYPE_CATALOG` is the only source (no string duplicates) |

### 11.2 A11y baseline

- `ui/Modal`: focus trap, initial focus, `aria-modal`, restore focus on close, scroll lock.
- `ui/IconButton` requires `label`; decorative emoji icons replaced by aria-hidden lucide icons.
- Color contrast pass on both themes for `--text-muted` and `--status-*` soft colors.
- Keyboard parity: every toolbar action reachable; graph/canvas basics operable via keyboard (Enter on node, arrows pan).

### 11.3 Responsive/motion

- Preserve the 1200px/768px grid rules; the layout refactor must not regress mobile.
- One motion system: `--motion-fast/base/slow` + `--ease-out`, replaced for the ad-hoc `0.2s ease` strings.
- `prefers-reduced-motion: reduce` globally disables transforms/transitions.

---

## 12. Migration Strategy (Phased Roadmap)

Order = highest leverage & lowest risk first; each phase ends with **all tests green + `astro build` clean** (or documented pre-existing warnings).

### Phase 0 — Foundations (no visual change)
- [ ] Add spacing/type/elevation/motion/z tokens to `global.css` (§4.1)
- [ ] Reconcile cyan: introduce `--accent-cyan-bright`; migrate the 170 `#00f2fe` literals → var
- [ ] Fix theme-init bug (`ResourceHead.astro:111`) + `prefers-color-scheme`
- [ ] Stand up `src/components/ui/` with `Stack/Flex`, `SectionHeader`, `Icon` (lucide), `Badge`
- **Verify**: token audit script (grep) shows 0 new hex in `ui/*`; light theme toggle works from first paint; $ no bundle regression.

### Phase 1 — Modal + Toast primitives
- [ ] `ui/Modal` (portal, focus trap, ESC, scroll lock)
- [ ] Migrate `ShareModal`, `CreateResourceModal`, `KeyboardShortcutsModal`, `ResourcePickerModal`, `CanvasJsonEditorModal` onto it
- [ ] Merge `GraphModal`/`CanvasGraphModal` → one modal on `ui/Modal`
- [ ] `ui/Toast` + `<Toaster/>` in `BaseLayout`; wire `CanvasEditor` save status as the first consumer
- **Verify**: delete ~5 bespoke overlay blocks; modal a11y test; e2e suite passes.

### Phase 2 — Layout + BaseLayout
- [ ] `src/layouts/BaseLayout.astro`; collapse all 11 pages onto it
- [ ] Move header + theme-init + `<Toaster/>` into layout
- [ ] `Button`, `IconButton`, `Input`, `Select`, `Tabs`, `Tooltip` primitives
- [ ] Migrate Header's 13 `glass-button` overrides → `ui/Button`
- **Verify**: every page shares CSS import exactly once; no visual regression on `/`, `/login`, `/studio/canvas/*`.

### Phase 3 — Viewer chrome + zoom
- [ ] `ResourceViewerFrame` + `useZoomPan`
- [ ] Migrate `PdfViewer`, `ImageViewer`, `GoogleDriveViewer`, `SheetGrid`, `MermaidViewer`, `ExcalidrawViewer`, `JupyterViewer` onto both
- [ ] Delete `PdfViewer.astro` non-delegate duplication; hoist shared viewport renderer
- **Verify**: three zoom implementations removed; per-viewer `isEmbedded` branches gone; embed tests pass.

### Phase 4 — Graph engine unification
- [ ] Extract `useGraphEngine` + `SVGRenderer`/`CanvasRenderer`
- [ ] Rewire `GraphView`/`CanvasGraphView` as thin shells; repoint `GraphContainer` (keeps its `preferred_graph_engine` control)
- [ ] Port the zoom-drag fix into the hook; derive `GraphLegend`
- **Verify**: canvas/SVG toggle still works; drag-after-zoom regression test added (Playwright: zoom in → drag node → assert no jump).

### Phase 5 — Canvas studio shell
- [ ] `useCanvasBoard` + `CanvasBoardShell(mode)`
- [ ] `CanvasViewer` onto shell (view mode)
- [ ] Extract `useCanvasEditor`; `CanvasEditor` becomes composition
- **Verify**: create/edit/save/undo/read-only flows e2e green; editor line-count target < 400.

### Phase 6 — Catalogs, cleanup, IAM, polish
- [ ] `RESOURCE_TYPE_CATALOG` in `resourceRegistry.ts`; migrate `SearchModal`/`CreateResourceModal`/`blogs/*`
- [ ] Migrate `iam/*` + `graph/GraphDrawer` (last inline-storm files) onto primitives/tokens
- [ ] Delete `SimilarContent.tsx`; convert `index.astro` card-grid inline strings to tokens
- [ ] `/settings/appearance` page: theme + accent + density + mode; wire 4 `data-*` attributes
- **Verify**: `style={{` count in `src/components` ≈ 0 (only justified micro-offsets remain); settings prefs persist + no flash on reload.

### Phase 7 — Lint + hardening + docs
- [ ] ESLint/CI guards (§11), a11y + responsive + reduced-motion pass
- [ ] README/AGENTS doc: "Adding a surface" checklist (token → primitive → composition)
- [ ] Full Playwright suite + manual pass on both themes, 4 accents, both densities
- **Verify**: metrics snapshot (inline styles, hardcoded colors, duplication ratios, bundle size) — target ≥90% reduction on inline styles/hex; graph dup ratio 43.6%→<10%; modal pair 94.3%→single file.

---

## 13. ADRs

### ADR-001: Primitive-first styling, no CSS framework
- **Decision**: Build `src/components/ui/*` on `global.css` tokens + classes; do **not** adopt Tailwind or CSS-in-JS.
- **Rationale**: The token layer already exists; per-file CSS modules across Astro+React islands fragment styling; a framework adds build/config surface for no benefit over 20 utility classes. One stylesheet keeps the One-Place Rule literal.

### ADR-002: Canonical cyan is `#06b6d4`; `#00f2fe` becomes `--accent-cyan-bright`
- **Decision**: Brand token stays `#06b6d4`. All `#00f2fe` → `var(--accent-cyan-bright)` (explicit "glow/active" semantic).
- **Rationale**: Renaming the brand to `#00f2fe` would invalidate 150+ usages that mean "highlight"; splitting lets both meanings survive named and themeable.

### ADR-003: Theme persistence stays client-side `localStorage`; no DB
- **Decision**: Extend `workspace_theme` → `workspace_prefs` object with `{theme, accent, density, mode}`; apply in the inline init script; fix reading `prefers-color-scheme` (fallback now `prefDark ? 'dark' : 'light'`).
- **Rationale**: Theming is presentation-only; keeping it off the database avoids schema/permission churn and matches the existing side-bar/graph-engine prefs which are already localStorage. If server-side prefs are wanted later, this is a contained swap behind one module (`src/lib/prefs.ts`).

### ADR-004: Engines are hooks, not components
- **Decision**: `useGraphEngine`, `useZoomPan`, `useCanvasBoard` own all imperative state; views/components are thin render shells.
- **Rationale**: The duplication measured (43.6% / 94.3% / inline pan-loops) is all imperative orchestrator code. Hooks make it testable (Playwright + node tests), host-agnostic (svg/canvas), and reusable without remount risk.

---

## 14. Non-Goals & Risks

### Non-goals (this plan)
- ❌ No visual rebrand: dark glass stays; typography/colors only tokenized, not redesigned.
- ❌ No new tech: no Tailwind/CSS-in-JS/storybook; `lucide-react` is already installed.
- ❌ No backend/API changes; no schema/permission changes; no new resource types.
- ❌ No cross-engine rewrite: SVG graph engine remains a supported option behind the toggle.

### Risks & mitigations
| Risk | Mitigation |
| :-- | :-- |
| Light theme surfaces errors mid-refactor | Phase 0 fixes init + cyan; primitives are theme-correct from the start; visual regression check per phase |
| Astro+React style divergence | All primitives expose classes usable by both; lint guard in Phase 7 |
| Graph canvas regression (drag/zoom) | Zoom-drag fix ported into the shared hook + Playwright regression test in Phase 4 |
| 2,004-line editor refactor risk | Shell-first (Phase 5) — editor shrinks naturally, editor logic extracted behind a hook while open questions stay in place |
| Migration fatigue across 65 files | Phased + metric-gated; IAM stored to last; each phase independently shippable |
| Bundle/perf regression | `lucide-react` tree-shakes; per-primitive import; RAF render loops untouched by token work |

---

## 15. Success Metrics

| Metric | Current | Target after Phase 7 |
| :-- | :-- | :-- |
| `style={{` in `src/components` | 1,317 | ~0 (whitelist of justified outliers) |
| Hardcoded hex/rgba in components | 1,207 | ~0 (constants palettes → tokens/registry) |
| Duplication ratio `GraphView`↔`CanvasGraphView` | 43.6% | <10% (one hook + two renderers) |
| Modal overlay implementations | 7+ | 1 (`ui/Modal`) |
| Resource-type catalogs | 4 copies | 1 (`RESOURCE_TYPE_CATALOG`) |
| Viewer zoom implementations | 3 divergent | 1 (`useZoomPan`) |
| Settings coverage (appearance) | 0 prefs | 4 dimensions persisted, no flash |
| Inline-style top offenders | GcpStyle(101), Editor(87) | ≤5 each |
| Pages importing `global.css` directly | 11 | 0 (via `BaseLayout`) |

---

## Appendix — Quick file map for the refactor

| Concern | Today (root cause) | After (one place) |
| :-- | :-- | :-- |
| Colors/radii/spacing | 65 files inline | `src/styles/global.css` (+ `data-theme` overlays) |
| Buttons/badges/modals | orphaned `.btn-*` + 7 overlays | `src/components/ui/*` |
| Page chrome/layout | 11 self-hosted pages | `src/layouts/BaseLayout.astro` |
| Viewer chrome | 7 viewer headers | `ui/ResourceViewerFrame.tsx` |
| Zoom | 3 implementations | `src/lib/viewer/useZoomPan.ts` |
| Graph orchestrator | GraphView + CanvasGraphView | `useGraphEngine` + 2 renderers |
| Graph modal | 2 files (94.3% dup) | 1 modal on `ui/Modal` |
| Canvas board shell | Editor + Viewer | `CanvasBoardShell` + 2 hooks |
| Resource-type catalog | 4 copies | `registry/resourceRegistry.ts` |
| Icons | emoji spans | `ui/Icon` (lucide-react) |
| Feedback/save status | inline strings | `ui/Toast` |

---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Core Framework Implemented & Active | **Design System**: Dark-Glass & Design Tokens

- [x] Unified design tokens in `src/styles/global.css` (surfaces, borders, typography, cyans)
- [x] Reusable UI Primitives (`Button`, `IconButton`, `Badge`, `Card`, `Modal`, `Drawer`, `Tabs`, `Stack`, `Flex`, `SectionHeader`, `Toast`)
- [x] Single source of truth Resource Catalog (`src/lib/registry/resourceRegistry.ts`)
- [x] Base layout standardization (`src/layouts/BaseLayout.astro`)
- [x] Elimination of redundant modal overlay implementations (`ShareModal`, `SearchModal`, `KeyboardShortcutsModal`)
- [x] Preferences persistence in `src/lib/prefs.ts` (`data-theme`, `data-accent`, `data-density`, `data-mode`)
- [x] Resource viewer chrome unification (`src/components/ui/ResourceViewerFrame.tsx`)
- [ ] Full elimination of legacy inline styles in complex tertiary components
