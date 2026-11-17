# Phase B — Folders and tags as resources

**Status:** complete for folder/tag resource routes; `/tags` overview remains
an intentionally separate discovery surface.
**Branch:** `feature/resources-as-notes`
**Supersedes:** the bespoke folder/tag pages and the folder-only special case.

## Goal

A folder and a tag are resource types, so they are *read* like any other
resource: same shell, same chrome, same content column. The only thing that
differs is where the body comes from.

Body resolution, for both kinds:

1. **An index document exists** → render that document. A folder's index is its
   `index`/`readme` child; a tag's index is a note carrying that tag whose
   `metadata.slug` is `index` (or `readme`).
2. **No index** → render a generated listing as a *note*: a prose document with
   sections and links, not a card grid.

Non-goals: changing how notes render, adding a new resource type to the
registry, or removing the standalone `/tags` overview page's route.

## Why the listing is prose, not cards

Cards are a layout, and a listing is content. Rendering the listing through the
markdown pipeline means it inherits callouts, wikilinks, syntax highlighting,
citations and every future prose feature, and it can be *linked to* like any
other note. It also removes the last bespoke card CSS.

## Current state

| Surface | Lines | Shell | Body | Problems |
|---|---|---|---|---|
| `src/pages/index.astro` | Workspace shell | `ResourceShell` | note markdown | Folder routes resolve to resource pages |
| `src/pages/folders/[...path].astro` | Workspace shell | `ResourceShell` | index note or generated prose listing | Implemented; shared permission filtering |
| `src/pages/tags/index.astro` | Discovery page | `BaseLayout` | permission-aware tag counts and tag cloud | Intentionally remains a distinct navigation surface |
| `src/pages/tags/[tag].astro` | Workspace shell | `ResourceShell` | index note or generated prose listing | Implemented; shared permission filtering |

The previous authenticated `/tags` N+1 permission check has been replaced with
`filterViewableResources`. The overview counts only resources the current user
can view. Historical latency figures below describe the old implementation.

## Target architecture

```
BaseLayout
└── ResourceShell.astro          ← extracted from index.astro, unchanged markup
    ├── slot explorer            ← FolderTree (or a tag-aware variant)
    ├── slot content             ← ResourceContentRenderer / prose body
    └── slot context             ← graph + TOC + backlinks
```

```
resolveDynamicBody({ kind, resource, candidates })
  → { kind: 'index', html }        index document rendered as prose
  → { kind: 'listing', html }      generated markdown → prose
```

Both folder and tag routes call the same resolver, so the two kinds cannot
drift apart.

## Permission rules (non-negotiable)

1. The listing is built **only** from `filterViewableResources` output. Never
   from a raw query.
2. `allowFoldersForTree` is **not** used for listings: it bypasses the
   draft/unlisted check, so a private container's name would leak as a row.
3. Counts (on the tag overview) count **viewable** resources only.
4. An index document is used only if the user can view it; otherwise the
   listing is rendered, so an index can never become a side channel.
5. A tag with zero viewable resources renders an empty note, not a 403 — the
   existence of the tag is not secret, its contents are.

## Phases

### B.1 — Extract the shell
- [x] Create `src/components/ResourceShell.astro` from the inline markup in
      `index.astro`; identical ids/classes so behaviour and CSS are unchanged.
- [x] `index.astro` uses the shell and passes its existing slots.
- [x] Verify the workspace viewer is byte-identical in behaviour (browser).

### B.2 — Dynamic body resolver
- [x] `src/lib/resources/dynamicBody.ts`: `resolveDynamicBody()`.
- [x] Index detection for both kinds, from already-filtered candidates.
- [x] Listing generator emits markdown (heading, grouped links, counts), which
      is rendered through the normal pipeline.
- [x] Empty result renders an explicit empty note.

### B.3 — Folders become resources
- [x] `/folders/[...path]` uses `ResourceShell` + the resolver.
- [x] Explorer highlights the current folder; TOC and backlinks work.
- [x] Remove the folder page's bespoke grid CSS.
- [x] Keep the `canUserViewResource` gate and the virtual-folder fallback.

### B.4 — Tags become resources
- [x] `/tags/[tag]` uses `ResourceShell` + the resolver.
- [x] Decision: keep `/tags` as a navigation and discovery surface with
      permission-aware counts, not as a resource-style note. It has no
      resource index/listing semantics; the distinct tag cloud is its purpose.
- [x] Fix the N+1 permission reimplementation (use `filterViewableResources`).
- [x] Tag with no viewable notes → empty note, not an error.

### B.5 — Verification and docs
- [x] Browser checks per surface: shell present, body kind, no card grids.
- [x] Permission test: a private note never appears in a listing or a count.
- [x] `npx tsc --noEmit` and `npx astro build`.
- [x] Update `docs/design-system.md` and the README surface list.
- [x] `/tags` overview remains a dedicated navigation surface. This is an
      intentional product decision, not unfinished Phase B work.

## Risks

- **Shell extraction is the risky part**: `index.astro` is the most-used page.
  Mitigation: mechanical move, identical ids, browser-checked before/after.
- **Listing as markdown** means a listing can be long. Mitigation: group by
  folder (folders) / by type (tags) so it stays scannable, and the TOC picks up
  the group headings for free.
- **Touching `layout.css` risks conflicting with in-flight canvas CSS.** Keep
  Phase B styles in new files; only touch `layout.css` if unavoidable.
