# UI / UX Design System — Policy

> **This document is mandatory.** Every UI surface in this repository — pages,
> components, layouts, server-rendered markup, and any markup generated from
> content (prose, embeds, renderers) — **MUST** follow the design system defined
> here and implemented in `src/`. There is no exception for "quick" or
> "one-off" UI. Contributions that violate this policy will be rejected.

## 1. The Rule

The design system is the **single source of truth** for visual and interaction
design. It has exactly four layers, in dependency order. Lower layers may never
depend on higher layers.

| Layer  | Authority                         | Location(s)                                        |
| ------ | --------------------------------- | -------------------------------------------------- |
| 1. Tokens | CSS custom properties only    | `src/styles/tokens.css`                            |
| 2. Primitives | The `.ui-*` class system | `src/styles/primitives.css`, `src/styles/global.css` |
| 3. Components | Typed React/`.astro` components | `src/components/ui/*`                              |
| 4. Surfaces | Pages built from 1–3        | `src/pages/*`, `src/layouts/*`                     |

Anything not reachable from these layers is **legacy** and MUST be migrated or
removed. New legacy code is not allowed to be introduced.

## 2. Source-of-Truth Locations

- `src/styles/tokens.css` — colors, spacing, type scale, elevation, motion,
  z-index, radii, fonts, theme/density/accent overrides. Nothing else may define
  these values.
- `src/styles/primitives.css` — `.ui-*` classes backing the components
  (`.ui-button`, `.ui-card`, `.ui-modal`, `.ui-badge`, …) plus the shared
  cross-page widgets (`.db-error`). `.glass-button` remains as a **delegation
  shim** only until its usages are migrated; it MUST NOT be extended. The former
  `.glass-card` and `.badge` alias shims have been **removed** (0 markup
  references); do not reintroduce them.
- `src/components/ui/` — the canonical components: `Button`, `IconButton`,
  `Badge`, `Card`, `Modal`, `Drawer`, `Tabs`, `Stack`, `Flex`, `SectionHeader`,
  `Toast`/`showToast`, `Tooltip`, `Input`, `EmptyState`, `ResourceViewerFrame`.
- `src/lib/prefs.ts` — user preferences (`data-theme`, `data-accent`,
  `data-density`, `data-mode`). Surfaces MUST respect these attributes and MUST
  NOT hard-code theme decisions.
- `src/lib/registry/resourceRegistry.ts` — resource-type metadata. Use
  `RESOURCE_TYPE_CATALOG`, `resolveResourceType`, `getResourceIcon`. Never
  re-declare ad-hoc `TYPE_META` / `TYPE_LABELS` / `CREATE_COMMANDS` arrays.

## 3. Mandatory Rules

1. **Tokens only for look-and-feel.** Use CSS variables from `tokens.css`.
   Hard-coded `hex`/`rgba`/`hsl` color literals are **banned** in component and
   page styles (design tokens may carry their initial literal values; nothing
   else may).
2. **No raw `style="..."` / `style={{...}}` for layout, typography, or
   theming.** These must be expressed through tokens + utility/primitive
   classes. (Notes: dynamic pixel math for JS-driven sizing, element geometry,
   and drag/zoom transforms are the allowed exceptions.)
3. **Use the primitives, not bespoke chrome.** Do not hand-roll buttons, icon
   buttons, badges, modals, drawers, cards, inputs, toasts, or tabs. Compose the
   `src/components/ui/` components and `.ui-*` primitives. Spacing goes through
   the `--space-*` scale via `Stack`/`Flex`/`.ui-gap-*`.
4. **One class per concern.** Never redefine a token or `ui-*` rule locally.
   If a primitive is missing capability, extend the primitive or component in
   the layers above, not in page CSS.
5. **Respect user preferences.** Always honor `data-theme`, `data-accent`,
   `data-density`, and `data-mode`. Verify both dark and light themes before
   shipping a surface.
6. **Surface palette via registry.** Use `resourceRegistry.ts` for resource
   type icons, labels, and creation commands.
7. **Wire feedback to `showToast`.** Save, copy, and error states must go through
   `src/components/ui/Toast`.

## 4. Adding or Modifying a UI Surface — Checklist

- [ ] Uses CSS variables for all colors, spacing, and surface elevations.
- [ ] Uses `src/components/ui/` primitives instead of bespoke buttons, modals,
      or badges.
- [ ] Respects user preferences from `src/lib/prefs.ts` (`data-theme`,
      `data-accent`, `data-density`, `data-mode`).
- [ ] Wires save, copy, and error states to `showToast` from
      `src/components/ui/Toast`.
- [ ] Verifies clean TypeScript build: `npx tsc --noEmit`.
- [ ] Verifies clean production build: `npx astro build`.

## 5. Migrating Legacy Classes

The following class names are legacy delegation shims and MUST be treated as
deprecated. New code must use the canonical names on the right:

| Legacy (deprecated)         | Canonical                                      |
| --------------------------- | ---------------------------------------------- |
| `glass-button`              | `ui-button ui-button--primary ui-button--<size>` |
| ~~`glass-card`~~ (removed)  | `ui-card`                                      |
| ~~`badge badge-info`~~ (removed) | `ui-badge ui-badge--info`                 |
| ~~`badge badge-allow`~~ (removed) | `ui-badge ui-badge--success`             |
| ~~`badge badge-deny`~~ (removed) | `ui-badge ui-badge--danger`              |
| ~~`badge badge-rose`~~ (removed) | `ui-badge ui-badge--danger`              |
| ~~`badge badge-purple`~~ (removed) | `ui-badge ui-badge--owner`              |
| ~~`badge badge-danger`~~ (removed) | `ui-badge ui-badge--danger`             |
| page-scoped `<style>` blocks | Consolidate into shared tokens/primitives or a layout-level stylesheet |

Rows marked *(removed)* had zero markup references and their CSS shims were
deleted; the mapping is kept for historical reference only.

`.db-error` is a shared primitive: page-level `.db-error { … }` `<style>` blocks
are a violation. The single rule lives in `primitives.css`.

## 6. Undefined-Token Guard

A selector that references a token that does not exist in `tokens.css` is a
defect. Before merging UI work, run:

```sh
rg -o 'var\(--[a-z0-9-]+\)' src --glob '*.{css,astro,tsx,ts}' | sort -u
```

and confirm every referenced variable is defined in `tokens.css`.

The following are **not** defects and must not be "fixed" by inventing tokens:

- `--shiki-dark` — injected per-`<span>` at runtime by the Shiki dual-theme
  transformer in `src/lib/render/codeHighlighter.ts`.
- `--ui-drawer-from` — set inline by `src/components/ui/Drawer.tsx`; the CSS
  reference always carries a fallback value.

`--accent-amber` is a **defined alias** of `--status-warning`. It exists so code
that addresses the warning hue as an accent (IAM role colours in
`src/components/iam/types.ts`, Obsidian callout warning/attention/tip/failure
variants in `src/lib/render/calloutParser.ts`, `CalloutNode.tsx`) can stay on the
`--accent-*` scale without re-declaring the hue. Changing `--status-warning`
retunes all of them at once.

## 7. Relationship to Other Docs

- `AGENTS.md` — carries the working checklist; this document is the normative
  specification it references.
- `README.md` — entry point; link targets this document.