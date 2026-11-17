# Canvas Grouping — Audit, Gap Analysis, and Target Design

Status: proposal. Nothing in this document is implemented yet.

Scope: what "inside a group" means in `src/components/canvas`, whether that
behaves correctly, what the established tools do, and a concrete plan to replace
the current geometry-derived model with an explicit one.

---

## 1. Headline

**`isNodeInGroup` does not test containment.** It tests whether a node's
**top-left corner** lies inside the group, ignoring the node's own width and
height entirely.

`core/geometry.ts` calls `rectContains(g, c)` where `rectContains` is typed
`(r: Rect, p: Point) => boolean` — a **point-in-rectangle** test. A `Rect` is
structurally assignable to a `Point` (it has `x` and `y`; the extra `width` and
`height` are ignored for a non-literal), so TypeScript accepted it silently.

```ts
// core/transform.ts — a POINT test
export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

// core/geometry.ts — passes a RECT where a POINT is expected
export function isNodeInGroup(child, group): boolean {
  return rectContains(g, c);   // c.width / c.height are never read
}
```

Measured, with a group at `x 0..100, y 0..100`:

| node | `core/geometry` | `types.ts` |
|---|---|---|
| fully inside `(10,10) 50×50` | `true` | `true` |
| **top-left inside, body spills out** `(90,90) 9000×9000` | **`true`** | `false` |
| **body inside, top-left outside** `(-40,-40) 100×100` | **`false`** | `true` |
| top-left exactly on the right edge `(100,10)` | **`true`** | `false` |

The two functions disagree on three of four cases, and **different call sites use
different ones** (§2).

Consequence, measured on a live board: dragging one group moved **seven** nodes
including a *sibling* group, because all seven merely **overlap** it. A node
9000 units wide counts as a member of a 100-unit group.

---

## 2. Current model as built

There is no parent pointer. A group is an ordinary node with `type: 'group'` and
membership is **re-derived from geometry on every read**.

Two membership functions exist:

| function | location | semantics | callers |
|---|---|---|---|
| `isNodeInGroup` | `types.ts:136` | child **centre** inside group | group badge (`CanvasEditor:479`), viewer badge (`CanvasViewer:655`), Fit-Group-To-Contents (`useCanvasEditor:498`) |
| `isNodeInGroup` | `core/geometry.ts:306` | child **top-left corner** inside group | group drag (`usePointerInteraction:299`), auto-layout membership (`autoLayout:114`) |

So the badge and the drag behaviour are computed from **different definitions**,
and the unit test that claims to cover containment
(`canvas-geometry.spec.ts`, *"isNodeInGroup is plain rect containment"*) asserts
only on top-left positions, so it passes under either semantics and cannot fail.

Group-specific node fields: `label`, `background`, `backgroundStyle` (a
background **image**, with cover/contain/repeat/fill). Groups are therefore
styleable containers — closer to draw.io's model than to tldraw's or Figma's.

---

## 3. Verified defects

Everything in this section was measured in Chromium against a fixture board, not
inferred.

### D1 — Dragging a group drags everything that overlaps it
Fixture: `ga = (0,0) 600×400`, `gb = (400,0) 600×400` (overlapping sibling),
`shared`, `onlyA`, `onlyB`, `gc` (nested), `inNested`, `straddle`, `gempty`.

Dragging `ga` by (+150, +90) moved: `ga, gb, shared, onlyA, gc, inNested,
straddle`. It did **not** move `onlyB` or `gempty`. The moving set is exactly the
set of nodes whose **top-left corner** falls in `ga`. A group drag therefore
translates nodes that have nothing to do with it, and moves a sibling group.

### D2 — The badge disagrees with the drag
Same fixture, `ga` badge reads `3` while the drag moves 7 nodes. The count shown
to the user is not the set acted upon.

### D3 — The label and the badge contradict each other
`handleGroupSelected` bakes the count into the label (`Group (N items)`) and
never updates it, while `containedCount` is recomputed live. Observed on the
auto-layout fixture: label `Group (2 items)`, badge `7`. Two numbers for one
fact.

### D4 — Groups cannot be selected by clicking
`GroupNodeCard` sets `pointerEvents: 'none'` on the group body, and
`nodesInRect` (marquee) skips `type === 'group'` entirely. Verified: at a point
on the group body, `elementFromPoint` returns the board, not the group.

The **only** ways to select a group are its header pill, `Ctrl+G` on a node
selection, or the JSON editor. Every researched tool selects a container with a
single click.

### D5 — Empty groups are created and never cleaned up
`handleAddGroup` / `handleAddGroupAt` create a 520×380 group with no members.
Verified: after deleting every member of a group, the group persists, and the
fixture's pre-existing empty group also persists. Nothing in the codebase removes
a group when it loses its last member.

### D6 — A node can belong to two groups, and both act on it
`shared` is inside both `ga` and `gb` by the centre test. Dragging `ga` moves
it; dragging `gb` moves it. There is no conflict detection, so dragging `ga` one
way and `gb` the other moves the node twice and leaves both groups wrong.

### D7 — Duplicating a group creates an empty overlapping twin
`handleDuplicateSelected` copies any selected node, including groups, offset by
(+40, +40). The copy has no members and overlaps the original, so both now claim
the same children.

### D8 — "Nesting" is an accident, not a feature
`handleGroupSelected` filters out `type === 'group'`, so a group can never be
grouped. But `core/geometry.isNodeInGroup` has no such exclusion, so a group
*is* treated as a member of an enclosing group by the drag path and by
auto-layout. Nesting therefore half-exists, with different rules depending on
which code path you ask.

### D9 — O(G×N) membership scans on every drag frame
`beginMove` loops over every node for every selected group, and `containedCount`
is recomputed for every group on every render. On a 200-node board with 20
groups that is ~4,000 containment tests per frame during a group drag, plus
2,000 per render. There is a `NodeIndex` in `core/` for exactly this, and it is
not used here.

---

## 4. What the established tools actually do

Sources are in §7. Graded `[DOC]` official documentation, `[SRC]` official
source, `[ND]` not documented.

### Membership is a stored pointer, not a geometry query

Figma, tldraw, draw.io, Miro (frames), and Canva all store the relationship —
`parent` on the child, or `parentId`. Figma is explicit that this was chosen to
*avoid* multi-parent states: *"we don't need to deal with the situation where an
object somehow ends up with multiple parents"* `[DOC]`.

The notable exception is Excalidraw, which has **no group object at all** —
membership is `groupIds: GroupId[]` on each element, and an element is
legitimately in N groups `[SRC]`.

**Figma is the only tool that overlays a geometric rule, and only for frames,
never groups.** Its documented rule is *size*, not containment: *"If an object is
smaller than a frame, we will make it a child of the frame. If an object is
larger than a frame, then we will not"* `[DOC]`.

Geometry-at-drop-time is common as a *convenience*, never as the source of
truth: draw.io hit-tests a `dropTarget` on drop then stores an explicit parent
`[DOC]`; tldraw auto-assigns a parent on creation when none is given `[DOC]`.

### Comparison

| | Figma | Miro (group) | Canva | Excalidraw | tldraw | draw.io | **this repo** |
|---|---|---|---|---|---|---|---|
| Membership stored as | child→parent | per-item `groupId` | parent/child | `groupIds[]` on child | child→`parentId` | `parent` on cell | **re-derived from geometry** |
| Multiple parents | no | no | no | **yes, native** | no | no | **yes, undefined** |
| Nestable | yes | SDK says no | official says no | yes | **yes, documented** | yes | **accidental, inconsistent** |
| Max depth documented | none | none | none | none | none | none | n/a |
| Click selects group | yes | yes | yes | yes | yes, 3-step drill | yes, click-to-drill | **no — body is `pointer-events: none`** |
| Child selectable | double-click / Enter | double-click | double-click | double-click | click / Enter / Esc | Alt-click, or second click | single click always |
| Drag child out ⇒ leaves? | **groups: no** (layers panel only) | n/d | no (must Ungroup) | **no** | n/d | yes | yes, accidentally |
| Delete last member | group deletes itself | persists (community report) | n/d | dissolves below 2 | **dissolves at 1, deletes at 0** | auto-shrink; deletes at 0 | **never** |
| Ungroup keeps positions | yes | n/d | implied (`AbsoluteElement[]`) | yes | **yes, explicit** | n/d | yes (children untouched) |
| Ungroup recursive | yes | — | — | n/a | **no, explicit** | no | accidental |
| Group fill / stroke | **no** | n/d | n/d | impossible (no object) | **no, explicit** | **yes** | **yes (background image)** |
| Auto-layout respects groups | frames only | no | none | no | no | **yes (ELK, nested inside-out)** | no (re-fits groups) |

### Findings that should drive the design

1. **Nobody documents a nesting cap.** tldraw, draw.io and Excalidraw document
   nesting as unlimited; the rest do not address depth. Imposing a cap would be
   inventing a constraint none of them have — but a *rendering* guard is still
   worth having.
2. **Automatic empty-group collapse is documented in exactly two tools, and they
   chose opposite thresholds**: tldraw dissolves at 1 child and deletes at 0;
   draw.io deletes at 0 and auto-shrinks otherwise. Figma deletes at 0.
   Excalidraw dissolves below 2. Miro appears not to clean up at all. **There is
   no consensus** — this is a genuine product decision, not a lookup.
3. **Group styling is the cleanest dividing line.** tldraw: *"Groups have no
   visual properties."* Figma's `fills` page omits `GroupNode`. draw.io is the
   only tool where a group is a first-class styleable cell. This repo is on the
   draw.io side, with a background image. Worth keeping, but then the group is a
   **frame**, not a Figma-style group, and naming it "group" invites the wrong
   expectations.
4. **Undo atomicity across a membership change is undocumented in 8 of 9
   systems.** tldraw is the only one that documents the mechanism (diffs + marks,
   with `bailToMark` rolling back a cancelled drag) `[DOC]`.
5. **Nobody documents group opacity cascading to children.** Open question
   everywhere.
6. **Only draw.io has a container-aware layout engine**, and it is explicit:
   *"Shapes inside container shapes are arranged within their container"*,
   *"only the contents of that container are rearranged"*, *"Container shapes
   will always be resized to fit their laid-out contents"*, and nested containers
   lay out inside-out `[DOC]`. This is the behaviour `autoLayout` approximates.

### A naming problem worth resolving

The research splits the world into three incompatible answers to "what is a
group":

- **Container / frame** — has bounds, can be styled, holds children, clips:
  Miro frame, draw.io container, tldraw frame, Figma frame.
- **Selection convenience** — no bounds of its own, inherits from children, no
  styling, cannot be transformed independently: Figma group, tldraw group,
  Excalidraw group.
- **Annotation only** — no object at all: Excalidraw.

This repo's group is currently a **frame** (fixed bounds, background image) that
behaves like a **Figma group** for selection (click a child, not the group) and
like **nothing** for membership (geometry query). Picking one archetype is the
single highest-leverage decision here.

---

## 5. Target model

**Adopt the Figma/tldraw model: an explicit single-parent pointer, with geometry
used only to *offer* a reparent, never to define it.**

```
CanvasNode.parentId: string | null   // null = on the canvas root
```

### Rules

| Rule | Decision | Rationale |
|---|---|---|
| Source of truth | `parentId` | Figma/tldraw/draw.io/Canva all store it; it is the only way to make behaviour deterministic |
| Single parent | **yes** | Figma chose this deliberately; it makes delete/drag/duplicate total functions instead of conflict resolution |
| Nesting | allowed, guarded | Groups are a documented feature in tldraw/draw.io/Excalidraw; Figma allows it. Cap rendering depth at 8 as a safety valve, not a product rule |
| Cycle prevention | enforced on write | `reparent()` rejects a node into its own descendant. Figma's servers reject parent updates that would cycle `[DOC]` |
| Empty group | **delete at 0, dissolve at 1** | tldraw's documented behaviour, the only tool that specifies both thresholds with API names `[DOC]` |
| Child membership | **per group**, `membership?: 'spatial' \| 'structural'`, default `spatial` | The user decides per group whether it is a visual container or an organisational structure. See §5.1 |
| Drag child out | depends on `membership`: `spatial` auto-detaches, `structural` keeps the link and shows an "outside" marker | Preserves the majority behaviour (Figma groups, Miro, Excalidraw and Canva never silently unparent) while stopping a visual container from silently accumulating distant children |
| Group bounds | `spatial`: derived from contained children + padding. `structural`: fixed bound; far-flung children do not stretch it | tldraw/draw.io `transparentBounds`; Figma *"the bounds of the group will adjust to fit the layers within"* `[DOC]` |
| Group styling | keep the background image (draw.io archetype), document that it is a frame | This repo already has it; removing it would be a regression |
| Coordinates | **stay absolute** | Every node already carries absolute `x/y`. Converting to parent-relative (Figma/tldraw/Canva) would require a migration of all persisted `.canvas` files and all edge math. Absolute coords are legal — the Excalidraw model has no relative coords at all. This is a deliberate, documented divergence |
| Selection | click selects outermost group; double-click drills in; Esc pops out | tldraw's documented 3-step model `[DOC]`, mirrored by Figma and draw.io |
| Ungroup | children keep absolute positions, keep z-order, **not recursive** | tldraw: *"preserves their page positions and rotations"* and *"Ungrouping is not recursive"* `[DOC]` |
| Delete member | if it empties a group, the group goes; if one child remains, dissolve and reparent | tldraw `[DOC]` |
| Duplicate | duplicating a group duplicates the **whole subtree** with remapped ids; a duplicated child copies its `parentId` | mirrors Excalidraw's `getNewGroupIdsForDuplication` `[SRC]` |
| Layout | auto-layout must lay out **within** each group and then place group boxes | draw.io's documented behaviour `[DOC]` |

### 5.1 Child membership: `spatial` vs `structural`

A group is used for two different jobs, and they want opposite behaviour when a
child is dragged away from it:

- **As a visual container** — a frame that hugs what you put in it. If a child
  leaves the frame, the container should let it go, or the frame is lying about
  its own extent.
- **As an organisational structure** — a folder that exists so the tree is
  meaningful when exported or processed. A child must never fall out of it
  because someone nudged it 20px.

Rather than model these as two node types (which doubles the state space and
makes every consumer handle both), there is one tree and one optional field on
the **group**:

```ts
CanvasNode.membership?: 'spatial' | 'structural';   // groups only; absent = 'spatial'
```

| | `spatial` (default) | `structural` |
|---|---|---|
| Frame | hugs its contained children | fixed bound; distant children ignored |
| Drag a child out | **auto-detaches** (undoable) | stays a child, shows an "outside" marker |
| Frame refit | on every mutation | only on explicit resize |
| Purpose | visual container, like a frame | organisation, export, navigation |
| Precedent | tldraw, draw.io | Figma layers, file-system folders |

**Why the default is `spatial`:** every group produced by the Phase 1 migration
was a hand-drawn visual container. Defaulting to `spatial` means the migration
changes no behaviour — badges, layout and group-drag all keep agreeing with what
the author drew — and `structural` becomes a deliberate opt-in per group.

**"Outside" is derived, not stored.** A child whose `parentId` is set but whose
rect escapes the parent's frame is simply
`!rectFullyContains(parentRect, childRect)`. No flag is needed, so the indicator
costs nothing and cannot drift out of sync with the geometry.

**This resolves two of the open decisions in §8** (drag-out semantics, and
derived-vs-manual bounds) with one field, rather than as two separate mechanisms.

### Why single-parent, given the user asked about "nodes in multiple groups"

Multiple parents is the one place the tools genuinely diverge: Excalidraw allows
it structurally, Miro allows group+frame to coexist and propagate, everyone else
forbids it. Single-parent is the right default here because:

- it makes "which set moves with this group" a total function — D1/D6 disappear;
- delete, duplicate, and ungroup all become simple;
- it matches the mental model users arrive with from Figma.

If multi-parent is ever genuinely needed, the escape hatch is Excalidraw's
`groupIds[]` array, which is a storage change behind the same interface — worth
keeping in mind, not building now.

---

## 6. Migration plan

Phased so each step is independently shippable and independently reversible.

### Phase 0 — Stop the bleeding (no behaviour change, ~1 hour)

- Delete `isNodeInGroup` from `core/geometry.ts`; it is the broken one.
- Make `core/geometry` re-export the `types.ts` implementation, or move the
  single correct implementation to `core/grouping.ts` and re-export from both
  paths. **One definition, one import site.**
- Fix the containment test: full-rect, with an explicit `rectFullyContains(a, b)`
  that is type-checked against `Rect` (not `Point`) so this class of bug cannot
  recur.
- Replace the unit test that cannot fail with a table that distinguishes
  centre / top-left / full-rect, so the semantics are pinned deliberately.

Result: D1, D2, D7 stop immediately. No migration needed.

### Phase 1 — `parentId` as an additive field (~half a day) — **DONE**

- `CanvasNode.parentId?: string` added. Absent means "derive from geometry once,
  then treat as authoritative" — old files keep working.
- `core/grouping.ts` owns the whole vocabulary: `GroupIndex` (byId, childIds,
  containedIds, members, ancestorIds, descendantIds, depth, isDescendantOf,
  wouldCreateCycle, worldRect), plus `reparent`, `ungroup`, `groupNodes`,
  `enforceInvariants`, `refitGroups`, `normalise`, `groupBoundsIn`.
- `normalise` runs on load, on import, and from the migration CLI: derive
  `parentId` from geometry, pick the **innermost** group when a node is inside several,
  and log how many nodes were reparented so the decision is auditable.
- Migration applied to all 13 `.canvas` files via
  `scripts/migrate_canvas_groups.ts` (dry-run by default, idempotent via a
  `groupingVersion` marker, per-file serialisation preserved byte-for-byte).
  Net effect: 107 `parentId` added, 21 group frames re-fitted, 2 empty groups
  removed, 0 content moved.

> **Status note.** The *data* half landed first and the *runtime* half followed in
> Phase 1b, so for a while the app carried a `parentId` it never read. Five call
> sites were inferring membership geometrically and ignoring the field just
> written: the two `containedCount` badges (`CanvasEditor.tsx`,
> `CanvasViewer.tsx`), "Fit Group to Contents" (`useCanvasEditor.ts`), the
> click-group-to-select-children path (`usePointerInteraction.ts`), and
> `autoLayout.ts`. Until they are switched over, a manually assigned child would
> not be counted, would not move with its group, and "Fit Group to Contents"
> would shrink the frame and orphan it — the UI would actively contradict the
> stored tree.

### Phase 1b — Runtime adopts the tree (~half a day) — **DONE**

- Replace all five `isNodeInGroup` call sites with the `parentId` tree via a
  single `GroupIndex` built once per commit (`useMemo`), which also retires the
  O(G×N) badge scan from Phase 4.
- `normalise` must actually run on document load, not only in the CLI, so a
  hand-edited or newly authored document is converted on the way in.
- Every membership write routes through `reparent` / `groupNodes` / `ungroup`;
  no component sets `parentId` directly.
- Done when: the badge count, group-drag selection, fit-to-contents and layout
  all agree with the outline, and a node assigned to a group it does not sit
  inside still behaves as a member.

### Phase 2 — Invariants on write (~1 day) — **DONE**

- Every mutation routes through a single `applyNodes` reducer that enforces:
  no cycles, no self-parent, no dangling `parentId`, dissolve-at-1 /
  delete-at-0, and group bounds derived from children unless manually pinned.
- Replaces the ad-hoc post-hoc cleanup currently missing (D5, D8).
- Ungroup becomes a real operation: keep positions and z-order, non-recursive,
  reparent children to the grandparent (D-none currently, but needed before
  nesting is real).

### Phase 3 — Interaction (largest UX change, ~2 days) — **DONE**

- Click selects the outermost group; double-click drills in; `Esc` pops out;
  `Enter` drills in. tldraw's model.
- Group body becomes hit-testable for selection; a modifier bypasses to the child.
- Group bounds become derived, with a resize handle that **moves** the group and
  an explicit "unpin bounds" affordance for the manual case.
- Marquee selects groups, and selects the top-level unit rather than a
  half-selected group (Excalidraw's `getRootElements` approach `[SRC]`).

**Child membership (§5.1).**

- `membership?: 'spatial' | 'structural'` on group nodes, default `spatial`,
  absent on non-groups. Set in the inspector, toggled from the context menu, and
  rendered in the group header pill as a glyph so the mode is visible on canvas
  without opening anything.
- `spatial`: frame is derived on every mutation; dragging a child fully outside
  auto-detaches it (single undo step).
- `structural`: frame is a fixed bound that a distant child cannot stretch;
  dragging out never detaches, and the child gets the derived "outside" marker.
- The "outside" marker is derived (`!rectFullyContains(parent, child)`), never
  stored, so it cannot drift out of sync with the geometry.

**Manual assignment (open decision #5).**

- Context menu header for a node shows its real parent (`↳ in Frontend`) or
  `Top level`, so the tree is legible from the canvas without a panel.
- `Move to ▸` submenu: recent groups first, then all, with a filter past eight
  entries. Plus `Top level` and `Remove from group` (the latter disabled when
  the node is already top level).
- On a group: `Children: Contained / Structural` toggle, `Select all members`.
- Keyboard: `⌘G` group, `⌘⇧G` ungroup (both exist), `⌘⌥G` reparent into the
  group under the cursor, `⇧⌘↑`/`⇧⌘↓` move out of / into a group, `Tab`/`⇧Tab`
  drill, `Esc` pop, `⌘⌥S` toggle membership. All reversible and discoverable
  through the menu labels, which is where the shortcuts are documented.

### Phase 4 — Performance (~half a day) — **DONE**

- Build the `parentId → children` index once per commit in a `useMemo`, not per
  frame. Replaces D9.
- Reuse `NodeIndex` for marquee and hit-testing; it already exists and is unused
  by these paths.
- Derive `containedCount` from the children index, killing the O(G×N) render scan.

### Phase 5 — Layout respects groups (~1 day) — **DONE**

`autoLayout` already refits groups around their members. It should become
genuinely container-scoped, per draw.io: lay out each group's children inside
its own box, then place the boxes. That also removes the two-press wobble
currently pinned by a test. `spatial` groups refit their box to the result;
`structural` groups keep their bound and lay out inside it.

### Phase 6 — Outline panel (~1 day) — **DONE**

The tree exists on disk and, after Phase 1b, in the runtime, but a canvas with
nesting has no way to *see* or *edit* the hierarchy. This is the surface that
answers "is this parent or manual assign".

- A tab in the existing 320px sidebar, alongside the Inspector. No new chrome.
- Renders the `parentId` tree: indent by depth, group glyph, label, child count,
  and the derived "outside" dot on any child that escapes its parent's frame.
- Click a row to select on canvas; canvas selection highlights the row.
  Bidirectional, and scoped to the drill-down level so it stays comprehensible.
- Drag a row onto a group to reparent; drop in the root strip to unparent.
  Refuses cycles with the same reason strings `reparent` already returns.
- Inline rename, and the membership toggle on group rows.
- "Copy subtree JSON" on a group row, mirroring the existing "Copy Node JSON", so
  a subtree can be lifted out for programmatic use.

**Modularity constraints, so this stays cheap to maintain:**

- `buildOutline(nodes, index): OutlineNode[]` is a pure function in
  `core/grouping` — cycle-safe, depth-capped, unit tested with no DOM.
- `OutlinePanel.tsx` is purely presentational: tree in, callbacks out. The same
  component can render in the studio sidebar or a future command palette.
- `resolveDropTarget(nodes, draggedIds, worldPoint)` is also pure and in
  `core/grouping`, so drag-to-group and outline drag-to-reparent share one
  implementation and one set of tests.
- Renders off a `GroupIndex` built once per commit. The corpus is 168 nodes
  today so no virtualisation is needed; the pure builder keeps it optional.

---

## 7. Non-clutter UX rules

Derived from what the research shows users tolerate, and from the two clutter
problems this board has today (D3's contradictory counts, D4's invisible
affordance):

- **One number per fact.** The group label must not embed a count. The badge is
  live and derives from the children index. Kill `Group (N items)`.
- **Group chrome only on demand.** Dashed outline when the group is focused or
  a descendant is selected — tldraw *"draw nothing of their own apart from a
  dashed outline while the group is focused"* `[DOC]`, draw.io's *"dashed
  selection bounds … whenever the group or any descendant is selected"* `[DOC]`.
- **No per-node badges.** The "N items" pill is group-level chrome and should not
  be duplicated in the layers list and the canvas.
- **Depth cue on nested focus.** A small breadcrumb (`Alpha › Gamma`) while
  drilled in, so a deep click is recoverable — Escape alone is not discoverable.
- **Empty groups are invisible.** Never render a group with no children; delete
  it instead (Phase 2), so the board cannot accumulate invisible furniture.
- **Membership is legible.** When a node is a member, say so on hover; when a
  drag would move it out, offer the removal explicitly rather than doing it
  silently. Silence is what makes D1 feel like a bug.

---

## 8. Open decisions

These need a product answer; the research does not settle them.

1. **Frame or Figma-group?** Keeping the background image makes this a frame
   (draw.io archetype). A frame clips and scrolls its children, which is a
   larger behavioural change. If we keep the background without clipping, we are
   a hybrid and should document it as one.
2. **Absolute or parent-relative coordinates? — RESOLVED: absolute.**
   Parent-relative storage was implemented first and then dropped. The deciding
   argument: every consumer here (rendering, edge routing, ports, hit-testing,
   marquee, spatial index, auto-layout) works in world space, so relative
   storage needs a projection into all of it — and the boundary adapter doing
   the projecting hands them absolute numbers regardless. The runtime is
   therefore absolute under *both* models, and relative storage buys only
   convention fidelity while costing a rewrite of every grouped node's `x`/`y`
   in every persisted file. Absolute keeps the migration purely additive
   (107 `parentId` fields added, 21 group frames re-fitted, 2 empty groups
   removed) instead of rewriting 130 coordinates. Excalidraw is the precedent
   for absolute being legitimate. This is the one deliberate divergence from
   Figma/tldraw/Canva, and it is now the implemented behaviour.
3. **Should dragging a node out of a group ever remove it? — RESOLVED: it
   depends on the group's `membership`.** A `spatial` group auto-detaches
   (a frame should not claim to contain what is visibly outside it); a
   `structural` group never does (an explicit "Remove from group" action is
   always available instead). This keeps the 4-of-5-tools behaviour as the
   *structural* default while giving visual containers the honesty draw.io has.
   See §5.1.
4. **Does a group keep a manual size, or is it always derived? — RESOLVED: by
   `membership` too.** `spatial` derives its frame from contained children
   (tldraw/draw.io/Figma all derive, and deriving removes a class of bug);
   `structural` keeps a fixed bound that distant children cannot stretch. One
   field answers both this and #3, instead of a separate pin/unpin mechanism.
5. **Does the user need a UI that shows the tree and lets them reparent by
   hand? — RESOLVED: yes, and it is the main missing surface.**
   The premise was "grouping is for moving and containing things structurally,
   easier to process when exported or programmatically". The `parentId` tree
   already serves that on disk, but the UI never exposes it. Two additions, in
   plan order:

   - An **assign submenu** in the existing context menu: show the current
     parent in the header, offer `Move to ▸` (recents first, search past 8),
     `Top level`, `Remove from group`, plus the membership toggle on groups.
   - An **Outline panel** in the 320px sidebar rendering the `parentId` tree
     with drag-to-reparent and a derived "outside" marker per child.

   Both extend surfaces that already exist rather than introducing new
   subsystems. See Phase 3 and Phase 6.
6. **Undo across membership changes.** We already snapshot whole node arrays, so
   membership is atomic with position in our history by construction. Worth
   asserting, since tldraw is the only tool that documents the guarantee.

---

## 9. Sources

- Figma — parent/child model: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- Figma — frames vs groups: https://help.figma.com/hc/en-us/articles/360039832054-The-difference-between-frames-and-groups
- Figma — parent-child relationships, frame size rule: https://help.figma.com/hc/en-us/articles/360039959014-Parent-child-and-sibling-relationships
- Figma — selecting layers: https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects
- Figma — `GroupNode`, empty groups unsupported: https://developers.figma.com/docs/plugins/api/GroupNode/
- Figma — `ungroup`: https://developers.figma.com/docs/plugins/api/properties/figma-ungroup/
- Figma — `fills` (GroupNode absent): https://developers.figma.com/docs/plugins/api/properties/nodes-fills/
- Figma — constraints on groups: https://help.figma.com/hc/en-us/articles/360039957734-Apply-constraints-to-define-how-layers-resize
- Figma — auto layout: https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout
- Miro — groups: https://developers.miro.com/docs/websdk-reference-group
- Miro — frames / children: https://developers.miro.com/docs/children-inside-parent-items
- Miro — group into frame propagation: https://developers.miro.com/reference/creategroup
- Miro — frames FAQ: https://help.miro.com/hc/en-us/articles/360018261813-Frames
- Canva — grouping: https://www.canva.dev/docs/apps/grouping-elements/
- Canva — element hierarchy: https://www.canva.com/help/layer-group-align/
- Excalidraw — element types (`groupIds`): https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/types.ts
- Excalidraw — groups: https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/groups.ts
- Excalidraw — `actionGroup`/`actionUngroup`: https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/actions/actionGroup.tsx
- Excalidraw — dissolve below 2 members: https://github.com/excalidraw/excalidraw/pull/11741
- tldraw — parenting: https://tldraw.dev/sdk-features/parenting
- tldraw — groups: https://tldraw.dev/sdk-features/groups
- tldraw — history: https://tldraw.dev/sdk-features/history
- draw.io — groups/containers: https://www.drawio.com/doc/faq/containers
- draw.io — layouts: https://www.drawio.com/doc/faq/layouts
- Apple Freeform — arrange items: https://support.apple.com/guide/freeform/arrange-items-frfm6cb2dcdd/mac
