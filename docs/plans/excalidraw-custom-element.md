# Plan — Fork Excalidraw & Add a "Render-Anything" Custom Node

> Status: **future work — planning only** (no implementation started).
> Goal: give the canvas a first-class node that can render *anything* our app
> can render (notes, embeds, live viewers, gadgets) inside an Excalidraw canvas,
> backed by a **pinned, forked, version-locked Excalidraw** so behavior is always
> consistent — never following upstream in-place.

## 1. Why a fork (honest current-state audit)

- Installed: `@excalidraw/excalidraw@0.18.1`. Audit of its public types:
  - `element.customData: Record<string, any>` ✅ **exists & stable** — our data
    channel for "our node".
  - `ActiveTool.type = "custom"` + `customType: string` ✅ plumbing exists in the
    type system.
  - **No public registration/render API** for custom element types exposed from
    the package in 0.18.1.
- Upstream: `excalidraw/excalidraw` issue **#4957 ("Support custom elements") is
  still OPEN** (activity into Feb 2026). PRs #4963 / #5164 / #8184 proposed
  implementations (render-a-widget-above-the-canvas, `displayData`,
  `onScrollChange`, coord-sync helpers) but none merged into a release. The
  "peculiar element" framework fork was halted mid-work.
- **Conclusion:** waiting upstream is unbounded-risk. Forking at a pinned release
  + cherry-picking the custom-element work = the only way to get stable behavior
  today. Fork cost is real (bypass-exempt internal API surface); mitigated below.

## 2. Fork tree & submodule protocol

```
repo root
 ├── vendor/excalidraw          # git submodule → our fork (locked commit SHA)
 │    └── packages/excalidraw   # the @excalidraw/excalidraw package source
 ├── patches/excalidraw/        # dumps of our fork diffs on top of upstream tag
 └── package.json               # "@excalidraw/excalidraw": "file:./vendor/excalidraw/packages/excalidraw"
```

1. **Fork** `excalidraw/excalidraw` → `our-org/excalidraw` (new branch
   `foss/custom-node` seeded at upstream tag `v0.18.1`).
2. **Pin** a known base: record `UPSTREAM_BASE.txt` = the upstream commit SHA.
3. **Add submodule**: `git submodule add https://github.com/our-org/excalidraw vendor/excalidraw`
   and commit with `gitlink` at a specific SHA → every checkout is identical.
4. **Expose to app** as a local package (`file:`) so bundlers resolve the locked
   source, OR publish as `@our-org/excalidraw@0.18.1-foss.X` (alias in
   package.json). Prefer `file:` initially (no publish step; CI is a clean
   `submodule update`).
5. **Change-surface guardrail:** every upstream-capable change lives in a tracked
   diff (`patches/`) reviewed on its own; the fork's `foss/*` commits are kept
   separable (rebase-friendly) so upstream merges stay clean.

### 2.1. Custom-element code to carry in the fork
The authoritative pieces to cherry-pick / reimplement on top of `v0.18.1`
(reference: upstream PRs #4963/#5164, issue #4957):
- `registerCustomType(name, { render, displayData, onPointerDown/Up, onCreate,
  transformHandles?, stackedOnTop?, disableContextMenu? })`
- Render via **React portal layered over the canvas** (host supplies
  `renderCustomElementWidget`), with Excalidraw exposing coordinate conversion
  (`sceneCoordsToViewportCoords`, `onScrollChange`) so the widget tracks the
  element while panning/zooming.
- Hit-testing, selection, and optional resize/rotate toggles.

## 3. "Our node" — the render-anything node

### 3.1. Data contract (`element.customData`)
```ts
interface FossNodeData {
  nodeType: 'foss-node';
  /**
   * Which renderer to use. Values come from our renderer/viewer registry,
   * NOT ad-hoc strings (single source of truth pattern from resourceRegistry).
   */
  view: 'doc' | 'pdf' | 'canvas' | 'table' | 'mermaid' | 'excalidraw' | 'embed' | 'gadget';
  /** Resource this node renders (optional → allow ad-hoc gadgets). */
  resourceId?: string;
  options?: Record<string, any>; // view-mode flags (dark, readOnly), padding, refresh
  /** Cache key so re-render is cheap when source content changes. */
  contentHash?: string;
}
```

### 3.2. Render bridge (the actual "render anything")
- Our app imports the fork and provides a `renderCustomElementWidget` that
  dispatches to a `FossNodeRenderer` component.
- `FossNodeRenderer` resolves `data.view` + `data.resourceId` through the
  existing pipeline: `src/lib/renderEngine.ts`, `src/lib/viewer/*`,
  `src/lib/registry/resourceRegistry.ts` → renders the same components the
  reader/viewer uses (notes, PDFs, live canvas, mermaid, embeds, mini-dashboards).
- Live/linked gadgets re-render when source changes via the queue + contentHash
  (see `docs/plans/multiuser-scale.md` §4) or an edit-aware invalidation hook.
- Editor/non-editor parity: `h0` side (viewer) and `i` side (editor) share
  `FossNodeRenderer`; editing mode adds the PropertiesPanel editor wired per view.

### 3.3. Editing
- `PropertiesPanel.tsx` gains a "node" tab driven by a registry of the node
  views: pick view type → pick resource → set options. Same pattern as the
  existing IAM/resource forms (tokenized, ui-* primitives — see
  `docs/design-system.md`).

### 3.4. Serialization & compatibility
- Canvas files gain `customData`-carrying elements. Storage/save path unchanged
  (`resources/canvas/[id].ts`, `resources/save.ts`) — customData is part of the
  element JSON today.
- **Backward compat:** existing `.excalidraw` canvas files with no `foss-node`s
  load unchanged (nothing to migrate).
- **Forward/unknown compat:** if an element with `nodeType: 'foss-node'` is
  opened in a non-fork Excalidraw, render a graceful fallback (it's just an
  element with customData) — design this deliberately.
- **Export:** SVG/PNG export renders the widget as a snapshot image (fetch a
  cached rendered image, or render-to-canvas) since live widgets can't go into
  the static SVG export.

## 4. Version consistency & maintenance runbook

- **Locked behavior:** `vendor/excalidraw` gitlink = single source of truth for
  the JS bundle; `npm ci` + `submodule update --init --recursive` in CI; no
  floating `^0.18.x`.
- **Upstream sync cadence:** quarterly (or on security advisories): merge latest
  upstream tag onto a `foss/rebase` branch, re-verify `patches/`, update
  `UPSTREAM_BASE.txt`, bump to new pinned SHA, run full canvas + node test suite.
- **Keep the surface minimal:** only the custom-element feature + any patches we
  already need (e.g. dark theme fixes the viewer currently hacks around) live in
  the fork; everything else must be contributed upstream.
- **Contribute back:** submit/rebase the custom-element PR (or a trimmed version)
  upstream so the fork eventually shrinks to a thin patch.
- **Security:** track `@excalidraw/excalidraw` releases for CVEs; the fork inherits
  them only when we sync, so schedule syncs on release watch.

## 5. Risks & guardrails
| Risk | Guardrail |
|---|---|
| Internal API churn on rebase | Keep fork diffs isolated in `patches/`; rebase only on tags |
| Hit-test/collision regressions | Dedicated Playwright canvas tests for node select/drag/resize |
| Stale upstream = stale CVEs | Release-watch + quarterly sync gate |
| Unknown widgets in non-fork tools | `customData` fallback rendering (documented) |
| Fork effort duplicated upstream | Budget for one upstream contribution pass |

---

## 6. Todos (future work)

### Phase A — Fork & lock (infra)
- [ ] Research upstream #4957/#4963/#5164 latest state; record whether anything merged (Feb 2026 or later)
- [ ] Create `our-org/excalidraw` fork; branch `foss/custom-node` seeded at `v0.18.1`
- [ ] Add submodule `vendor/excalidraw` (gitlink pinned at fork SHA)
- [ ] Write `vendor/excalidraw/UPSTREAM_BASE.txt` + `patches/` diff dump process (`git diff upstream/v0.18.1 > patches/foss-custom-node.patch`)
- [ ] Swap dependency: `"@excalidraw/excalidraw": "file:vendor/excalidraw/packages/excalidraw"` (or alias)
- [ ] CI: `submodule update --init --recursive` + build step; verify same bundle hash on two clean machines
- [ ] Port currently-needed viewer dark-theme fixes into the fork (stop relying on app-side hacks)

### Phase B — Custom element feature in the fork
- [ ] Cherry-pick/reimplement upstream #5164 (registerCustomType + widget layer + coord sync)
- [ ] Add tests upstream-style: widget render, scroll/zoom tracking, hit-test, selection, resize/rotate toggles
- [ ] Export path: snapshot-widget-to-image for SVG/PNG export

### Phase C — The render-anything node in our app
- [ ] Define `FossNodeData` type + our node `view` registry (from `resourceRegistry` patterns)
- [ ] Implement `FossNodeRenderer` dispatching to `renderEngine.ts`/`viewer/*`
- [ ] Wire `renderCustomElementWidget` in `src/components/ExcalidrawViewer.tsx` and canvas editor
- [ ] Viewer-editor parity + `PropertiesPanel` "node" tab (tokenized/ui-* per design system)
- [ ] Live-refresh on source change via queue + `contentHash`
- [ ] Fallback rendering for non-fork tools; fixture canvas files with `foss-node`s
- [ ] E2E coverage for create → edit → save → reload round-trip

### Phase D — Maintenance
- [ ] Document the sync runbook in this file (quarterly rebase + patch re-verify + SHA bump)
- [ ] Set release-watch on `@excalidraw/excalidraw` (CVE + new releases)
- [ ] Submit a trimmed custom-element PR upstream (shrinks fork over time)