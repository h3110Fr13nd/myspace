I've gathered primary-source material. Here is the report.

---

# Group Semantics in Whiteboard / Design Tools

**Evidence grading used throughout:**
- **[DOC]** = official help centre / developer docs / official engineering blog
- **[SRC]** = official source code (repo) or official SDK reference
- **[2nd]** = third-party / community — flagged as such
- **[OBS]** = only observable in the product, not documented anywhere I could find
- **[ND]** = not documented (I searched and found nothing; absence of evidence, not evidence of absence)

---

## 1. Figma

### A. MEMBERSHIP — explicit parent pointer, *except* frames use a geometric-ish rule on drop

The scene graph stores the parent link **on the child**, not children on the parent:
> "The approach we settled on was to represent the parent-child relationship by storing a link to the parent as a property on the child. That way object identity is preserved. We also don't need to deal with the situation where an object somehow ends up with multiple parents…" — **[DOC]** https://www.figma.com/blog/how-figmas-multiplayer-technology-works/

`parent` is a **readonly** property on every node; reparenting must go through `appendChild` — **[DOC]** https://developers.figma.com/docs/plugins/api/properties/nodes-parent/

But Figma's *canvas* behaviour differs sharply between **groups** and **frames**:
- For **frames**, Figma decides on its own whether a moved/created object becomes a child, and the rule is **size comparison, not containment**: "If an object is smaller than a frame, we will make it a child of the frame. If an object is larger than a frame, then we will not make it a child element." Hold Space to override. — **[DOC]** https://help.figma.com/hc/en-us/articles/360039959014-Parent-child-and-sibling-relationships
- Figma states its own model is DOM-like, not OOP-inheritance-like: "In Figma, these relationships function more like the Document Object Model (DOM). That is, containers with elements inside them." — **[DOC]** same source

"Fully inside" vs "partially overlapping": **partially-overlapping-but-smaller-than-the-frame still becomes a child.** The documented rule is size, not geometric containment. **[DOC]**

### B. NESTING
- "You are allowed to nest groups inside other groups." — **[DOC]** https://help.figma.com/hc/en-us/articles/360039832054-The-difference-between-frames-and-groups
- Nested auto-layout frames are explicitly supported and documented as a core feature: "Nesting an auto layout frame within another auto layout frame allows you to combine horizontal, vertical, and grid auto layout options" — **[DOC]** https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout
- **Maximum nesting depth: [ND].** I found no documented depth cap for groups or frames anywhere in the help centre or plugin API. Cycle prevention exists server-side ("Figma's multiplayer servers reject parent property updates that would cause a cycle") but that is cycle rejection, not a depth limit — **[DOC]** multiplayer blog.

### C. MULTIPLE PARENTS — No
Single parent link by design, quoted above. Overlapping groups are impossible: the parent pointer is singular, and the server rejects any update creating ambiguity/cycles. **[DOC]**

### D. MEMBERSHIP MAINTENANCE

**Dragging out — asymmetric, and this is the single most important Figma detail:**
- **Groups:** you *cannot* drag a child out on canvas. "You can move things into and out of this group by dragging layers within the layers panel." — **[DOC]** frames-vs-groups article. A canvas drag changes x/y only; the parent pointer is untouched. **[DOC/derived from the above]**
- **Frames:** "To add layers to this group, just drag them in. To remove layers from this group, just drag them out." Plus Space to prevent leaving. — **[DOC]** same article + parent/child article

**Deleting a member — group shrinks, and can never be empty:**
- "As the layers within a group are moved around, the bounds of the group will adjust to fit the layers within." — **[DOC]** frames-vs-groups
- "In Figma, groups must always have children. **A group with no children will delete itself.**" — **[DOC]** https://developers.figma.com/docs/plugins/api/GroupNode/
- Corollary: there is no `figma.createGroup()`. "Why is there no `figma.createGroup()` function? It would create an empty group, and **empty groups are not supported in Figma**." — **[DOC]** https://developers.figma.com/docs/plugins/api/properties/figma-group/

**Undo/redo of a boundary-crossing move: [ND].** No Figma documentation addresses it. The multiplayer architecture implies the parent pointer is part of the atomically-synced property pair ("the parent link and this position must both be stored as a single property so they update atomically"), which would make an undo restore both — but that is inference, not a documented guarantee. **[DOC + inference]**

### E. SELECTION & TRANSFORMS
- "The first time you click on a layer in this group, the entire group will be selected. To select a single layer within this group, double-click the item, or choose it from the layers panel." — **[DOC]** frames-vs-groups
- "When you click on an object that is part of a group or frame, we'll select the parent by default. Double-click on the object - or press the enter key - to select one level of nesting down. Repeat this process until you select the correct child elements." — **[DOC]** https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects
- "It's possible to select nested objects without selecting the parent object. This is something to be mindful of, especially when selecting objects to move them!" — **[DOC]** same
- Deep-select with a modifier key to grab a deeply nested layer directly. — **[DOC]** same
- Figma explicitly warns children move with the parent on canvas drag — **[DOC]** same
- **Resizing a group:** "You can't apply constraints to groups. A group will inherit its bounds from the layers contained within it. **They aren't considered a single layer with bounds.** If you apply constraints to a group, Figma applies constraints to the individual layers." — **[DOC]** https://help.figma.com/hc/en-us/articles/360039957734-Apply-constraints-to-define-how-layers-resize
- API confirms: "Under the hood, Figma applies the provided constraints to each child of the group." — **[DOC]** GroupNode
- So group resize = per-child constraint resolution, **not** a uniform scale transform. Figma's own guidance: use groups "to group elements that will maintain a fixed relationship when scaled", use frames when you need the child to behave differently. — **[DOC]** https://www.figma.com/best-practices/groups-versus-frames/

### F. UNGROUP
- "Ungroups the given `node`, **moving all of `node`'s children into `node`'s parent** and removing `node`." — **[DOC]** https://developers.figma.com/docs/plugins/api/properties/figma-ungroup/
- **Absolute positions preserved.** Figma documents this for the inverse operation and it's symmetric: `figma.group()` requires the parent up front precisely because "It allows you to create the new group while **keeping all the grouped layers in the same absolute x/y locations**. The method `.appendChild` preserves the relative position of a node, so if you use `.appendChild` to populate a group, you would need to do additional work to put them back in their original location." — **[DOC]** https://developers.figma.com/docs/plugins/api/properties/figma-group/
- So: **reparent to grandparent + recompute local coords to keep absolute position. No re-layout.** **[DOC]**
- Ungrouping a frame is the same operation/shortcut. — **[DOC]** frames-vs-groups

### G. GROUP STYLING — no fill/stroke; opacity yes
- **Fills: NOT supported on groups.** Figma's `fills` property page lists the node types that support it; `GroupNode` is absent while `FrameNode`, `SectionNode`, `RectangleNode` etc. are present. — **[DOC]** https://developers.figma.com/docs/plugins/api/properties/nodes-fills/
- Strokes: `GroupNode` likewise has no `strokes` property documented on its page. **[DOC]** GroupNode
- **Opacity: supported.** `GroupNode` exposes `opacity: number` ("Opacity of the node, as shown in the Layer panel") and `blendMode` (including `PASS_THROUGH`). — **[DOC]** GroupNode
- Does group opacity cascade to children? Figma does not document this. A rendering-engine explainer states opacity < 1 on a node opens a compositing layer that composites the node's whole subtree (children included) as one unit, and "opacity isn't a per-element property—it's a grouping operation" — **[2nd, unofficial]** https://blog.form.dev/renderer/renderer-series-layer-opacity. Treat as unconfirmed.
- Verdict: **a Figma group is a bounds/transform/organisation container, not a styling container.** Only opacity/blend/effects propagate. **[DOC + inference]**

### H. LAYOUT / AUTO-LAYOUT
- Auto layout is a **frame** feature. `GroupNode` documents no `layoutMode`, padding, or gap properties; those are on `FrameNode`. — **[DOC]** GroupNode vs FrameNode
- Constraints explicitly cannot be applied to groups. — **[DOC]** constraints article
- Strongly implied (not stated in one sentence) that **groups cannot host auto layout**. **[DOC + inference]**
- Frames do offer auto layout with nesting: "The nested frames will have both parent and child properties, each frame with its own separate padding and gap-between values." — **[DOC]** Guide to auto layout

---

## 2. Miro

Miro has **two entirely different containment systems** that are constantly conflated. Keep them apart.

### A. MEMBERSHIP

**Groups — explicit `groupId` on each item, group is its own board item:**
- A group is a board item of `type: 'group'` with `data.items: [ids]`. — **[SRC]** https://developers.miro.com/reference/creategroup
- "Each item will have its own `groupId` property equal to `undefined`." (after ungroup) — **[DOC]** https://developers.miro.com/docs/websdk-reference-group
- Group constraints: "Groups can only be created with at least two items. Locked elements cannot be grouped. Mindmaps and tags are not supported in groups. Groups do not support metadata as other board items." — **[DOC]** same

**Frames — explicit `parentId`, relative child coordinates:**
- "As long as a child item is inside a parent, its `x` and `y` positioning reference is relative to the containing parent item." — **[DOC]** https://developers.miro.com/docs/children-inside-parent-items
- "The `parentId` of the child item corresponds to the parent frame ID. The child item ID is added to the frame `childrenIds` array. The `x` and `y` coordinates of the child item are recalculated relative to the top-left corner of the parent frame." — **[DOC]** https://developers.miro.com/docs/websdk-reference-frame

**Full containment vs overlap — frames require FULL containment, and Miro enforces it:**
- "Adding a board item to a frame as a child can fail if: … **The child item is located outside the bounds of the parent frame.**" — **[DOC]** websdk-reference-frame
- "If an app attempts to programmatically update a parent item to resize it, the operation may fail if one or more children fall outside the parent item after resizing it. This isn't allowed, because it would break the parent/child relationship." — **[DOC]** children-inside-parent-items
- **Groups: containment-based membership is [ND].** Nothing documents any geometric test for group membership.
- Known lag: "Sometimes when adding a frame on top of objects they don't attach. Select the objects and slightly move them - this should attach them to the frame." — **[DOC]** https://help.miro.com/hc/en-us/articles/360018261813-Frames. This is evidence that frame attachment is a *detected* event, not purely stored.

### B. NESTING
- **Groups: strongly indicated NOT nestable via the API.** "**Previously grouped items cannot be grouped again, this will cause an error.** You can use the `groupId` property in the item to check whether it's already assigned to a group." — **[DOC]** websdk-reference-group
- Miro's help centre never mentions nested groups. **[ND]**
- **Conflict to flag:** a 2024 community thread contains a user reporting they had to *"ungroup a nested group"* to work around a layering bug — i.e. implying nesting *does* exist in the editor at least sometimes. — **[2nd]** https://community.miro.com/ask-the-community-45/objects-are-automatically-grouping-when-placed-together-and-cannot-be-ungrouped-15389 . Miro staff did not confirm. **Verdict: treat Miro group nesting as undocumented and contradictory.**
- **Frames: nestable.** Nested frames are routine in Miro, and frames-in-frames appear throughout the community/ideas forum. — **[2nd]** e.g. https://community.miro.com/ideas/automatically-embed-objects-in-nested-frame-7124 . **Maximum frame depth: [ND].**

### C. MULTIPLE PARENTS — no single-parent rule *across systems*
- An item has at most one `groupId` and at most one `parentId` → no multiple parents within either system. **[DOC]**
- **But Miro permits simultaneous group + frame membership, and it is transitive:** "If a group is added to a frame, **all the grouped items will also be attached to that frame.** The group must fit within the frame dimensions to be added." Code sample: `await frame.add(group)` → "shape, card and text will also be added to the frame; you can check their `parentId` property after this operation." — **[DOC]** websdk-reference-group. So an object in a group that is in a frame reports `parentId = frame` *and* `groupId = group`. This is the closest thing in the set to dual membership, and it is explicitly documented.

### D. MEMBERSHIP MAINTENANCE
- **Dragging out of a group: [ND].** Not documented either way. The help centre only documents moving *within* a group: "To move a single object within a group, double-click it and drag." — **[DOC]** https://help.miro.com/hc/en-us/articles/360017730973-Structuring-board-content
- **Dragging out of a frame: implied detach, never stated.** The "objects don't stick to my frame" FAQ is the only documented statement about the boundary. — **[DOC]** Frames article
- **Deleting a member: the group record does NOT auto-shrink or self-delete.** A Miro developer reports: "if I delete item in group in UI, 'group' object is not updated (when I do `board.get()` again) … because this item with this id no longer exists." Staff confirm the practical workaround is ungroup/regroup. — **[2nd, but from the Miro developer community with staff replies]** https://community.miro.com/developer-platform-and-apis-57/add-item-to-existing-group-16405
- REST API: `DELETE /v2/boards/{id}/groups/{group_id}?delete_items=true` deletes the group **and its items**; `false` ungroups only. So the group itself is never an empty container in the API — it's destroyed instead. — **[DOC]** https://developers.miro.com/reference/deletegroup, https://developers.miro.com/reference/ungroup
- **Undo/redo: [ND]** for membership specifically. Miro documents an Undo button and board history ("If you accidentally delete a frame you can always restore from your board history") but nothing about parent/group restoration. — **[DOC]** Frames article

### E. SELECTION & TRANSFORMS
- Group behaves as one object: "After that, they will behave as a single object (although you can still edit each object within the group)." — **[DOC]** Structuring board content
- Child selectability: "**Can I select and move individual objects inside a group? - Yes, double-click an object and drag.**" — **[DOC]** https://help.miro.com/hc/en-us/articles/360017730953-Working-with-objects
- Notable documented restriction: **"You can't align grouped objects"** — alignment is unavailable for grouped selections. — **[DOC]** Structuring board content
- Frames: "Selecting and moving items within a Frame works exactly the same way as groups." — **[DOC]** frames-vs-groups equivalent in Miro's Frames article: "Select the frame by clicking its border or title, then drag its borders to adjust the frame size."
- **Resizing a group: does it scale children proportionally, or resize them? [ND].** No Miro documentation addresses this. This is product-observable only.
- Drag a frame → children follow, because `x`/`y` are parent-relative. **[DOC]** children-inside-parent-items

### F. UNGROUP
- "Ungroups and returns all currently grouped items. **Once ungrouped, the `group` object is invalidated.** Each item will have its own `groupId` property equal to `undefined`." — **[DOC]** websdk-reference-group
- **Positions: [ND].** Not stated. Given absolute child coordinates and no layout engine, positions almost certainly do not move, but this is inference.
- Notable: the REST ungroup endpoint can optionally **delete the members** (`delete_items`), so ungroup ≠ always non-destructive. — **[DOC]** https://developers.miro.com/reference/ungroup

### G. GROUP STYLING
- **Group: [ND].** No documentation of any group-level visual property.
- **Frame: yes, documented.** "The default color of a frame is white. You can change the size and color of the frame in the context toolbar." — **[DOC]** Frames article
- Whether frame colour or any opacity cascades to children: **[ND]**.
- Groups have no metadata support at all: "Groups do not support metadata as other board items." — **[DOC]**

### H. LAYOUT / AUTO-LAYOUT — **no flow layout; only align & distribute**
- Miro's feature is literally called "Auto layout" but is a **smart alignment/distribution tool**, not a container layout system: "Select the widgets you need to align. Click on the grey icon in the upper right corner and drag it horizontally." — **[DOC]** Structuring board content
- This is a one-shot operation on a selection; it does not maintain a container's children. **No group- or frame-scoped automatic layout exists. [ND]**

---

## 3. Canva

> ⚠️ **Evidence warning: Canva's official consumer help centre is thin on groups, and the one authoritative technical doc (Apps SDK) contradicts several third-party guides. I've marked the conflict explicitly.**

### A. MEMBERSHIP
- A group is a real element with children: `addElementAtPoint({ type: "group", children: [...] })` — **[DOC]** https://www.canva.dev/docs/apps/grouping-elements/
- Child coordinates are **relative to the group**: "Each element within a group must have dimensions and a position. The dimensions and positions are **relative to the dimensions and positions of the group**." — **[DOC]** https://www.canva.dev/docs/apps/api/latest/design-add-native-element/
- So: **explicit parent-child with parent-relative coordinates.** Membership is set by explicit selection, never by overlap. **[DOC]**
- Canva explicitly warns about *visual* overlap being a different thing: "Make sure that your elements don't overlap. Overlapping elements will shrink in mobile view." — **[DOC]** https://www.canva.com/help/layer-group-align/ . This confirms geometric overlap carries no membership semantics.

### B. NESTING — **official docs say NO**
> "The following types of elements **cannot** be organized into groups:
> - App elements
> - **Groups**
> - Tables" — **[DOC]** https://www.canva.dev/docs/apps/grouping-elements/

**This is the strongest and only official statement I found, and it says groups are not groupable.**

- **Conflict, flagged:** multiple third-party guides assert nesting works in the editor (e.g. techpoint.africa "Canva supports nested grouping"; gurusoftware.com "Yes, you can have groups inside of groups"). — **[2nd, contradicting official]** I could not find any Canva-official source confirming nesting, and no documented maximum depth either way. **Verdict: no nesting, per official docs; third-party claims unverified.**
- Note the group element type is documented as containing two or more elements with no mention of a group child type. **[DOC]**

### C. MULTIPLE PARENTS
**[ND].** No Canva documentation or SDK reference addresses multiple parents. Canva's `GroupElement` shape implies a strict single parent. **[DOC-inferred]**

### D. MEMBERSHIP MAINTENANCE
- **Removal is explicit, not geometric:** "**To remove a single element from the group, choose one element to remove, then select Ungroup.**" — **[DOC]** https://www.canva.com/en_gb/help/layer-group-align/
- The same doc's troubleshooting flow confirms a group blocks independent movement: "If you can't move a specific element, it's probably locked, **part of a group**, or both… To ungroup them, select them and click or tap on Ungroup." — **[DOC]** https://www.canva.com/help/layer-group-align/
- This strongly implies **dragging an element away does not remove it from the group**; you must ungroup. Not stated in those words, but it is the only documented removal path. **[DOC + inference]**
- **Deleting a member: [ND].** No documentation of group shrink, empty-group behaviour, or group self-deletion.
- **Undo/redo: [ND].**

### E. SELECTION & TRANSFORMS
- "Click on the group to select it. Then select an element in the group. You can: Use corner handles to resize; Rotate using the rotate handle; Drag to move the element. **Note: The group stays intact while individual changes are applied.**" — **[DOC]** canva.com/en_gb/help/layer-group-align/
- **That single sentence is the clearest documented statement of "editing a child does not dissolve the group" in this whole tool set.**
- Canva also documents that grouping is *why* elements stay coherent: "Group elements. If you want certain elements to stay together, group them. Otherwise, they might separate in mobile view." — **[DOC]** canva.com/help/layer-group-align/
- **Resizing the group: does it scale or reposition children? [ND].** No official statement. The `GroupElement` API exposes child `width`/`height`/`top`/`left` and an aspect-ratio constraint applies to the group box, which implies group resize is a real transform — but the consumer behaviour is not documented.
- Canva documents that a group is one layer for z-ordering purposes, i.e. no per-child reordering without ungrouping. — **[2nd]** gurusoftware.com (not official; flagged)

### F. UNGROUP
- "To ungroup all elements, select the entire group, and then select Ungroup from the floating toolbar." — **[DOC]** canva.com/en_gb/help/layer-group-align/
- Apps SDK: `ungroup` "Ungroup a group element… resolves with `new elements that are ungrouped from the given group` as an `AbsoluteElement[]`" — note the return type is **AbsoluteElement**, i.e. absolute coordinates, strongly implying position preservation. — **[DOC]** https://www.canva.dev/docs/apps/api/preview/design-types-page-helpers/
- **Re-layout: no.** There is no layout engine, so ungrouping cannot re-flow anything. **[DOC + inference]**
- Canva's own dev example warns apps must "support proper ungrouping functionality" and that "Element hierarchy handling is simplified for demonstration purposes" — i.e. real nesting/ungroup nesting is not a solved problem in their SDK. — **[DOC]** https://www.canva.dev/docs/apps/examples/group-elements/

### G. GROUP STYLING
**[ND].** No Canva documentation of a group-level fill, stroke, or opacity, and no documentation of opacity inheritance. Canva documents per-element opacity only. Do not assume cascade.

### H. LAYOUT / AUTO-LAYOUT
**[ND].** No auto-layout or container-driven layout feature found in any Canva source. Canva has position/size/alignment tools, but nothing that arranges a container's children. **Treat as absent.**

---

## 4. Excalidraw

**Key structural fact, and the reason Excalidraw is the odd one out: there is no group object.** A group is a bare string ID; the only thing that exists is a list of IDs on each element.

### A. MEMBERSHIP — explicit, purely logical, and **multi-valued**
The element type definition:
```ts
/** List of groups the element belongs to.
    Ordered from deepest to shallowest. */
groupIds: readonly GroupId[];
frameId: string | null;
/** other elements that are bound to this element */
boundElements: readonly BoundElement[] | null;
```
— **[SRC]** https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/types.ts

Membership test and enumeration are pure array operations, no geometry whatsoever:
```ts
export const isElementInGroup = (element, groupId) => element.groupIds.includes(groupId);
export const getElementsInGroup = (elements, groupId) => { /* scan all elements, filter by groupIds.includes */ }
```
— **[SRC]** https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/groups.ts

**Fully-inside vs partially-overlapping: not a distinction that exists for groups.** There is no bounding test anywhere in `groups.ts`. **[SRC]**

**Frames are different** and are where geometry enters:
- Frame membership is a single `frameId` — "This assigns membership only; it does not offset child coordinates." — **[DOC]** https://plus.excalidraw.com/docs/api/scene-content-schema
- But membership *detection* is geometric, and distinguishes full containment from intersection: `elementsAreInFrameBounds`, `isElementIntersectingFrame`, `isElementContainingFrame`, `elementOverlapsWithFrame` — **[SRC]** `packages/element/src/frame.ts`
- Even the marquee has an explicit two-mode geometry switch: "`boxSelectionMode` (either `"contain"` or `"overlap"`)" — **[SRC]** `packages/element/src/selection.ts`

So Excalidraw is the one tool in this set that has an **explicit contain-vs-overlap distinction**, and it applies it to frames, not groups.

### B. NESTING
- Native and load-bearing: `groupIds` is "Ordered from deepest to shallowest" — **[SRC]** types.ts
- `addToGroup` inserts the new ID at the correct depth, before `editingGroupId` if you're inside a group: — **[SRC]** groups.ts
- Selection code explicitly handles nesting: "// handle the case where a group is nested within a group" — **[SRC]** groups.ts
- **Maximum depth: [ND].** No cap in the type, the code, or docs.
- Groups cannot be nested directly *into* a group object because there is no group object — nesting is purely "an element's `groupIds` array has >1 entry".

### C. MULTIPLE PARENTS — **YES. This is Excalidraw's native model.**
An element in a nested group is simultaneously in N groups; `groupIds: ["inner", "outer"]` means the element is a member of both. Downstream code reads the *outermost* relevant group as `groupIds[groupIds.length - 1]` for selection, and `groupIds[0]` as the deepest for `editingGroupId`:
```ts
editingGroupId: element.groupIds.length ? element.groupIds[0] : null
```
— **[SRC]** groups.ts

**Overlapping groups and an object in the intersection:** not applicable — groups are logical tags, not regions, so there is no "intersection" to resolve. If you group A+B then group B+C, B has `groupIds: [g1, g2]` and is legally in both. **[SRC]**

### D. MEMBERSHIP MAINTENANCE
- **Group membership persists through drags.** `groupIds` are only mutated by `actionGroup` / `actionUngroup` / duplication (`getNewGroupIdsForDuplication`) / frame operations. There is no geometric re-check on move.
- Frames *do* re-evaluate, but only during drags: `isElementInFrame` contains `if (appState.selectedElementsAreBeingDragged)` gating, and the comment "if the element is outside the frame, but is part of a group that has some elements 'in' the frame, we should clip the element" plus "if no elements are being dragged, we can skip the geometry check because we know if the element is in the given frame or not" → `shouldClip = element.frameId === frame.id` — **[SRC]** frame.ts. So **stored `frameId` is authoritative; geometry is only re-consulted mid-drag.**
- **Deleting a member → automatic dissolution below 2 members.** A regression fix describes "the **'fewer than two members' cleanup** that ungrouped the remaining elements" — **[SRC]** https://github.com/excalidraw/excalidraw/pull/11741. Corroborated in the type definitions exposing `getMaximumGroups` for exactly this purpose — **[SRC]** groups.d.ts
- Selecting a group with <2 surviving members is also refused: `if (Object.keys(elementsInGroup).length < 2) { … }` — **[SRC]** groups.ts
- Known bug class worth knowing: bound-text labels get stale `groupIds` and block the cleanup — PRs [#9426](https://github.com/excalidraw/excalidraw/pull/9426), [#9436](https://github.com/excalidraw/excalidraw/pull/9436), [#11741](https://github.com/excalidraw/excalidraw/pull/11741), issue [#9411](https://github.com/excalidraw/excalidraw/issues/9411).
- **Undo/redo: [ND]** for group semantics specifically. Elements carry `version`, `versionNonce`, and a fractional `index` "for ordering in multiplayer scenarios, such as during reconciliation or **undo / redo**" — **[SRC]** types.ts, so a real undo system exists, but no doc describes how a boundary-crossing drag is reverted.

### E. SELECTION & TRANSFORMS
- **Selecting a member selects the whole group.** "When you select an element, you often want to actually select the whole group it's in, unless you're currently editing that group." — **[SRC]** groups.ts (function docstring)
- **The group outline replaces child outlines.** "If the element's group is selected, **don't render an individual selection border around it.**" (`isSelectedViaGroup`) — **[SRC]** groups.ts
- Grouping explicitly uses `getRootElements(...)` so you group the outermost units, not a partially-selected group. — **[SRC]** https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/actions/actionGroup.tsx
- Double-click enters the group (`editGroupForSelectedElement` sets `editingGroupId` to the deepest group). — **[SRC]** groups.ts
- `isSelectedViaGroup` is used by `getSelectedElementsByGroup` so transforms apply per inner group when a single group is selected. — **[SRC]** groups.ts
- **Dragging the group moves children: yes** — mechanically, because there is no group transform; every member's `x`/`y` is mutated. **[SRC, derived]**
- **Resizing: group has no transform, so resizing a group selection rescales the member elements individually. [OBS]** Not documented; no group-level scale factor exists in the data model, so this is structural rather than documented.
- Arrows can bind to group members but *not* to groups (`frameAndChildrenSelectedTogether` guard on grouping) — **[SRC]** actionGroup.tsx

### F. UNGROUP
`actionUngroup` is a pure array filter — no object is created or destroyed, because there is no group object:
```ts
const nextGroupIds = removeFromSelectedGroups(element.groupIds, appState.selectedGroupIds);
```
— **[SRC]** https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/actions/actionGroup.tsx

- **No re-layout, no position change** — the code touches only `groupIds` and selection state. **[SRC]**
- Side effect worth noting: after ungrouping, it re-runs frame membership (`getElementsInResizingFrame` / `replaceAllElementsInFrame`) for the affected frames, and it strips bound-text elements out of the resulting selection. **[SRC]** same
- Capture mode is `IMMEDIATELY` → one undo step. **[SRC]** same

### G. GROUP STYLING
**Impossible by construction.** No group object exists, so there is nothing to carry a fill, stroke, or opacity. `opacity` is a per-element field on the element base type. **[SRC]** types.ts

### H. LAYOUT / AUTO-LAYOUT
**Absent.** No auto-layout feature exists in Excalidraw. This is widely reported in third-party comparisons but I found **no official Excalidraw statement** — so: *not documented, universally reported absent.* **[2nd]**
For contrast, Excalidraw does support Mermaid → diagram conversion (`text-to-diagram`), where the *renderer* computes layout and the output is still free-positioned elements with no runtime layout. **[DOC]** https://docs.excalidraw.com/docs/mermaid

---

## 5. tldraw

**Best-documented tool in this set.** Nearly every question has a direct answer in the SDK docs.

### A. MEMBERSHIP — explicit `parentId`; the group is a real shape record
- "Every shape in tldraw has a parent: either the page it lives on or another shape that contains it." "Every shape record has a `parentId` property that points to its parent. For shapes directly on the canvas, this is a page ID. For shapes inside groups or frames, it's the containing shape's ID." — **[DOC]** https://tldraw.dev/sdk-features/parenting
- A group's child coordinates are **parent-relative**: "A child shape's `x` and `y` are relative to its parent, not the page." — **[DOC]** same
- **The group is a real shape**: "The only core shape (always present) is the group." — **[DOC]** https://tldraw.dev/docs/shapes
- Fully inside vs partially overlapping: **no geometric test for groups.** Group membership is `parentId` only. The closest geometric behaviour is container drop-targeting: "When you omit `parentId` from `Editor.createShapes`, the editor picks one for you: the focused group, **or a container such as a frame under the shape's `x` and `y`**." — **[DOC]** parenting. So *frames* get a geometric auto-parent on creation; *groups* get the focused group. **[DOC]**

### B. NESTING — yes, explicitly, with a worked example
- "Groups can contain other groups, creating hierarchies" — **[DOC]** https://tldraw.dev/sdk-features/groups
- The docs include a literal example:
```
// outerGroup
// ├── innerGroup
// │   ├── boxA
// │   └── boxB
// ├── boxC
// └── boxD
```
— **[DOC]** same
- Ancestor traversal is a first-class API: `getShapeAncestors` returns "all ancestors in order from the root to the immediate parent" — **[DOC]** parenting
- "When grouping shapes that already have different parents, the editor finds their common ancestor and creates the group there. This prevents orphaning shapes from their natural hierarchy." — **[DOC]** groups
- **Maximum depth: [ND].** No cap documented. Arbitrary depth is supported by design.

### C. MULTIPLE PARENTS — No
Single `parentId`. The common-ancestor rule above exists specifically to prevent a shape ending up with two parents. **[DOC]**

### D. MEMBERSHIP MAINTENANCE — the most precisely specified in this set
- **Deleting a member — fully documented, two separate rules:**
  > "Groups maintain themselves through the `ShapeUtil.onChildrenChange` lifecycle hook. **If you delete all children of a group, the group is removed. If a group ends up with only one child, it dissolves and reparents that child to the group's parent's.** This cleanup happens immediately when children change, so you never end up with degenerate groups." — **[DOC]** groups
  Code sample given: `editor.deleteShapes([boxA])` → "Group now has only boxB, so it auto-ungroups."
- Minimum size at creation: "**Grouping requires at least two shapes.** The method does nothing if you pass fewer" — **[DOC]** same
- **Dragging out: [ND].** There is a `reparentShapes` API and a drag-and-drop contract (`canReceiveNewChildrenOfType`, `onDragShapesIn`), but the docs do not state whether a group member dragged far outside its group is evicted. — **[DOC, unspecified]** https://tldraw.dev/examples/shapes/tools/drag-and-drop
- **Undo/redo: documented at the mechanism level.** History is diffs + marks; a drag is a single batched entry. `markHistoryStoppingPoint('begin drag')` … `bailToMark(markId)` "Roll back and discard all changes since mark" — used "When this changes, we bail on the changes since the interaction started". So a cancelled drag reverts wholesale including any reparenting. — **[DOC]** https://tldraw.dev/sdk-features/history
- Also inherited: "A shape is effectively locked if any of its ancestors are locked" (`isShapeOrAncestorLocked`) — **[DOC]** parenting

### E. SELECTION & TRANSFORMS — documented as a 3-step drill-down
- "Without focus, clicking a shape inside a group selects the group itself, not the individual shape." — **[DOC]** groups
- **Layered selection:**
  > "1. First click selects the outermost group
  > 2. Second click focuses the group and selects the parent of the target shape (or the shape if directly inside)
  > 3. Further clicks drill down through nested groups" — **[DOC]** same
- Keyboard: "Pressing Escape pops focus one level up… Pressing Enter with only groups selected selects their children." — **[DOC]** same
- **Dragging/rotating/resizing the group transforms children:** "When you transform a group (move, rotate, resize), **all children transform with it.** The group's position and rotation are applied to children through the standard parent-child transform composition." — **[DOC]** same. So resize is a **composed transform** (children scale), not per-child constraint logic.
- Rendering: "Unlike frames, groups **draw nothing of their own apart from a dashed outline while the group is focused**." — **[DOC]** same

### F. UNGROUP — precise, including the non-recursive caveat
> "Ungrouping moves children to the group's parent and **preserves their page positions and rotations.** Layer order is maintained: children appear where the group was in the z-stack." — **[DOC]** groups

> "**Ungrouping is not recursive.** If a group contains other groups, those inner groups remain intact. Ungroup them separately if needed." — **[DOC]** same

- Symmetric guarantee on grouping: "When you group shapes, their page positions are preserved—only their `parentId` and local coordinates change. When you ungroup, shapes return to their original page positions even if the group was rotated." — **[DOC]** same
- **Pure reparent + coordinate rebasing. No re-layout.** **[DOC]**

### G. GROUP STYLING — explicitly denied
> "**Groups have no visual properties. You can't style a group itself, only its children.**" — **[DOC]** groups

Reinforced by: "groups draw nothing of their own apart from a dashed outline while the group is focused." — **[DOC]** same
(Contrast with frames, which do have `props` for styling.)

### H. LAYOUT / AUTO-LAYOUT
**None.** No auto-layout, flow layout, or constraint system is documented anywhere in the tldraw SDK feature list (I read the full sidebar: Frame shape, Geo shape, Note shape, Group shape, Bindings, Shape transforms, Shape clipping, Snapping — no layout engine). — **[DOC]** tldraw.dev
tldraw has *frames* (containers with their own bounds/clipping) and *bindings* (connector attachment), but neither is a layout system. **[DOC]**

---

## 6. draw.io / diagrams.net

**Second-best documented.** draw.io has the richest group-behaviour surface of any tool here, and the maintainer has formalised it.

### A. MEMBERSHIP — explicit `parent` on `mxCell`
- "The diagram inside a `.drawio` file is structured into cells in a tree-like structure. The diagram itself is the topmost single cell, the layers in a diagram form the next level of cells, then each element on a layer is a cell nested within its layer cell." — **[DOC]** https://www.drawio.com/docs/manual/layers/how-layers-work/
- ASCII structure given, with container/group as a nesting level.
- Children use **relative coordinates** to their parent. — **[DOC]** https://www.drawio.com/docs/reference/diagram-generation/ ("Children of groups use relative coordinates — positions are relative to the parent container, not the canvas")
- **Geometric on drop:** "**Add a cell to a group** — drag the cell over the group. **A green outline indicates a valid drop target.** The dropped cell becomes a child of the group." Gated by style: "a group accepts drops when `dropTarget=1` is set in its style (the default). Set `dropTarget=0` to block drops." — **[DOC]** https://www.drawio.com/docs/manual/editor/group-shapes-connectors/
- **So: geometric hit-testing at drop time, then stored as an explicit parent pointer.**
- **`transparentBounds=1` is a genuine bounds-derived container:** "turns a group or swimlane into an auto-sized container whose bounds are derived from the **union of its children's bounds** — the cell itself has no fixed size." — **[DOC]** same

### B. NESTING
- Yes, unrestricted. "Nested containers are laid out from the inside out, so an outer container sees the final size of the containers it contains." — **[DOC]** https://www.drawio.com/docs/reference/diagram-generation/
- Per-cell `collapsible=1` opt-in for the fold toggle; "containers and swimlanes are foldable by default". — **[DOC]** group-shapes-connectors
- Nested collapsible containers are a supported pattern, exercised in community Q&A. — **[2nd]** https://stackoverflow.com/questions/62142219
- **Maximum depth: [ND].** mxGraph's internal limits are not documented by draw.io.

### C. MULTIPLE PARENTS — No
Single `parent` attribute. draw.io documents a *consequence* of this that is worth knowing: "Each object in a diagram … 'lives' on a single layer. Connectors live on one layer but also can link to source and target shapes on different layers." and:

> "**When you have a container shape or group of shapes, this is also a cell** — every child object in that group or container is contained within that cell, which, with all its child elements lives only on one layer. Therefore, **assigning an element that was inside a container shape or group of shapes to a different layer will also remove that element from the container/group.**"

— **[DOC]** how-layers-work. So moving a child to another layer is an implicit **destructive reparent** out of its group. That is a real, documented, and fairly surprising semantic.

### D. MEMBERSHIP MAINTENANCE
- **Drag out — supported, with one hard exception:**
  > "**Remove from group** — drag the cell out of the group bounds, or use *Arrange > Remove from Group*." — **[DOC]** group-shapes-connectors
  > "**Drag out of the group — blocked.** To remove a child, use *Arrange > Remove from Group*." (this is specifically the `transparentBounds=1` case) — **[DOC]** same
- **Deleting a member — auto-shrink and auto-delete, both documented:**
  > "`expand` / `contract` — Whether the group auto-extends or auto-shrinks when children change." — **[DOC]** same
  > "For non-transparent groups, `groupPadding` is the buffer used by `extendParent`/`contractParent` **when resizing to fit children**." — **[DOC]** same
  > "**Empty groups auto-delete** — when the last child is removed, the group cell is deleted in the same edit." (transparentBounds groups) — **[DOC]** same
  > "**No resize handles** — the group is never directly resizable; it tracks its children." (transparentBounds) — **[DOC]** same
- **Undo/redo: documented as standard.** "If you don't like the layout, undo it with the keyboard shortcut `Ctrl+Z` / `Cmd+Z` or click the *Undo* button in the toolbar." — **[DOC]** https://www.drawio.com/docs/manual/layouts/ . Group-specific revert semantics: **[ND]**.

### E. SELECTION & TRANSFORMS — the most explicitly specified here
- **Click-to-drill-down, walking the parent chain:**
  > "**Plain group cell** — the first click selects the group; a second click selects the child underneath. **Each click 'drills down' by one level, walking up the parent chain.**" — **[DOC]** group-shapes-connectors
- "**Swimlane** — clicking a child selects it directly; the swimlane itself is selected by clicking its title bar or its background." (containers deliberately differ from plain groups) — **[DOC]** same
- "**`Alt`-click** — bypasses the group and selects the topmost cell at the click position, regardless of parents." — **[DOC]** same
- "`selectParentFirst=1` (any group or swimlane) — flips the order: clicking a child first selects the parent, then a second click drills down to the child." — **[DOC]** same
- "**`lockedGroup=1`** on a group — The group's **descendants are not selectable** — clicks on a child pass through to the group, treating it as a single visual unit." — **[DOC]** same
- "`part` — `0`/`1` — When set on a child, **selecting/dragging it acts on the parent**." — **[DOC]** same
- **Group outline when a descendant is selected — explicitly documented:**
  > "**Dashed selection bounds** — visible whenever the group **or any descendant** is selected. The dashed outline is drawn by the editor and does not require setting `strokeColor` / `dashed` in the cell style." — **[DOC]** same (transparentBounds section)
- **Drag group → children translate together:** "Dragging it moves the entire group, with the children translating together." — **[DOC]** same
- **Resize/rotate group → children transform relatively:** "you can drag the corner or side grab handles to **resize all of the shapes within the group, relative to each other**"; "Drag the rotate symbol in the top right corner to **rotate all of the shapes in the group around a central point**." — **[DOC]** same
- Connector behaviour across boundaries: "Connectors can connect to shapes across the boundaries of their parent containers." — **[DOC]** https://www.drawio.com/docs/manual/shapes/container-shapes/

### F. UNGROUP
- "Select the grouped shapes. Click on *Ungroup* in the *Arrange* tab… press the `Ctrl+Shift+U`/`Cmd+Shift+U` keyboard shortcut to break apart the group." — **[DOC]** group-shapes-connectors
- **Position preservation: [ND].** Not stated. Given children are stored in parent-relative coordinates, ungrouping must rebase them to absolute — the docs do not confirm whether any re-layout occurs. Flag as an evidence gap.
- Note: draw.io also has "break apart" as a *separate* concept (for multi-part shapes) — don't conflate.

### G. GROUP STYLING
- A group is a styled cell. Default style is literally named `group`: "`group` — (style name) — Default style for groups created via `Ctrl+G`." — **[DOC]** same
- Full style reference is published: `group`, `swimlane`, `container`, `dropTarget`, `collapsible`, `expand`/`contract`, `groupPadding`, `transparentBounds`, `selectParentFirst`, `locked`, `lockedGroup`, `lockedGroupIcon`, `editIcon`, `moveIcon`, `connectIcon`, `part`. — **[DOC]** same
- "All of these keys can be set via *Edit Style…* (`Ctrl+E`) or the **Properties** section of the *Arrange* tab for a selected cell." — **[DOC]** same
- Important nuance: for `transparentBounds=1`, the dashed outline is editor chrome, "does not require setting `strokeColor` / `dashed` in the cell style" — so group visuals and group *chrome* are separable. — **[DOC]** same
- **Does group fill/opacity cascade to children? [ND].** No documentation. I could not find any statement about group opacity inheritance. **Do not assume it.**

### H. LAYOUT / AUTO-LAYOUT — **the strongest auto-layout story of any tool here**
- **Layout respects container boundaries, by design:**
  > "Connectors to and from shapes drive each of the layouts… **Shapes inside container shapes are arranged within their container when a layout is applied** when you click *Apply*." — **[DOC]** https://www.drawio.com/docs/manual/layouts/
  > "**What gets laid out:** All shapes on the current page are included in the layout. **If a single container holding at least two shapes (for example a group) is selected when you pick the menu item, only the contents of that container are rearranged.**" — **[DOC]** same
- **Engines:** "All of them except Org Chart are powered by the **Eclipse Layout Kernel (ELK)** layout engine." Presets: Flow (vertical/horizontal), Tree, Radial Tree, Organic, Org Chart. Plus legacy Circle/Parallel. — **[DOC]** same
- **Containers auto-size to their laid-out contents:** "**Container shapes will always be resized to fit their laid-out contents.**" (this is not gated behind the optional "Resize Nodes" setting) — **[DOC]** same
- **Persistent per-container layout via style:** "A diagram can also carry its layouts in the shape styles: a cell whose style defines a `childLayout` (for example `childLayout=flowLayout;flowOrientation=west;`) **lays out its children automatically**." And: "**Nested containers are laid out from the inside out**, so an outer container sees the final size of the containers it contains." — **[DOC]** https://www.drawio.com/docs/reference/diagram-generation/
- **Caveat documented:** "These layouts run in response to changes **while the diagram is edited, but not when it is opened**" — so a generated diagram relying on `childLayout` displays at stored coordinates (often all `0,0`) until first edit. — **[DOC]** same
- Also: "automated layout shapes for diagram portions within a container shape" — **[DOC]** layouts

---

## 7. Apple Freeform

**Heavily under-documented. Apple documents grouping as a UI affordance, not a data model.** I want to be blunt about this section: most of your questions cannot be answered from Apple's documentation, and I would not build a semantic model on Freeform as a reference.

### A. MEMBERSHIP — no documented parent pointer, no documented containment
- The entire Apple documentation of grouping is: "You can arrange items on top of (or behind) other items on your Freeform boards and group them so they're easier to move around." — **[DOC]** https://support.apple.com/guide/freeform/arrange-items-frfm6cb2dcdd/mac
- Procedure: "Select multiple items. **Some items—such as 3D objects—can't be grouped.** Choose Arrange > Group. **Tip: You can also click to group items on the board.**" — **[DOC]** same
- Child access: "**After items are grouped together, you can still format each independently—double-click the item in the group to use the formatting tools.**" — **[DOC]** same
- **No mention anywhere of a parent pointer, a container, or a membership test.** Apple never documents what makes an item "in" a group.
- **Tell-tale absence — Apple has no container concept at all.** Compare Miro, which has Frames as a first-class documented feature. Freeform's own workaround advice is to fake one: "**If you want to define a workspace for the participants (rather than having a wide open canvas), try adding a large rectangle shape.** Select the shape… tap Back, then lock it." and "**Add a large rectangle shape and change its colour, so it acts as a background colour.** Position items on top of it… then lock it." — **[DOC]** https://support.apple.com/guide/freeform/position-items-on-a-board-iph5e1a18c04/ios and https://support.apple.com/en-au/guide/freeform/frfm8479c716/mac
- **That workaround is the strongest available evidence that Freeform has no spatial containment semantics** — if it did, Apple would use it.
- Fully inside vs partially overlapping: **[ND]**. `Tip: You can also click to group items on the board` is the only hint of a geometric path, and it is not specified.

### B. NESTING
**[ND] — no Apple documentation mentions nested groups.** I searched Apple's Freeform user guide and the wider web; the only nesting-related Freeform feature documented is `View > Use Groups`, which groups **boards in the sidebar**, not objects on a canvas: "To organize your boards into groups, choose View > Use Groups. For example, you can see all the boards shared by each person in separate groups in the Shared category." — **[DOC]** https://support.apple.com/guide/freeform/create-a-board-frfm9474646a9/mac . Don't confuse this with object grouping.
- Maximum depth: **[ND]**.
- Community evidence that users expect containers and don't find them — Apple staff direct them to separate boards: "It looks like the only thing you can do in it is create a new board." — **[2nd]** https://discussions.apple.com/thread/254604329

### C. MULTIPLE PARENTS
**[ND].** No documentation. Given the flat-canvas reading, almost certainly not possible — but this is **[OBS]**, not documented.

### D. MEMBERSHIP MAINTENANCE
- **Dragging out: [ND].** Not documented either way.
- **Deleting a member: [ND].** No statement about group shrink, empty groups, or group self-deletion.
- **Undo/redo: [ND]** for membership.
- Undo is only mentioned generically: "If you accidentally delete a frame you can always restore from your board history" (that's Miro, not Freeform — Miro's Frames article). Freeform's history/undo is **[ND]** with respect to grouping.
- One real documented data point about automatic grouping: Apple Pencil/freehand drawings get auto-grouped. An Apple community thread reports "When drawing with the pencil, the drawings are automatically grouped together. The only way to separate them is by using the marking pen." — **[2nd, unconfirmed by Apple]** https://discussions.apple.com/thread/255740552

### E. SELECTION & TRANSFORMS
- **Group = single unit for move/rotate/resize:** "You can also group several items to more easily **move, rotate, or resize them as a single unit**." — **[DOC]** iphone/ipad guide
- **Can you select a child independently?** "After items are grouped together, you can still format each independently—**double-click the item in the group** to use the formatting tools." — **[DOC]** arrange-items
- **Dragging the group moves children:** implied by "as a single unit". **[DOC + inference]**
- **Resizing — the one hard documented constraint:**
  > "**Groups containing certain items can only be resized proportionally.** These items include **images and movies that have been rotated**, and **shapes that have a green dot when selected**." — **[DOC]** https://support.apple.com/guide/freeform/resize-items-frfmaec1128f/mac
  Also: "Text boxes always resize proportionally."
  This is important: **Freeform resizing a group can be forced to proportional-only depending on member content.** No other tool in this set documents this.
- **What happens to the group outline when a child is selected: [ND].** Not documented. (Contrast tldraw "dashed outline while the group is focused", draw.io "dashed selection bounds whenever the group or any descendant is selected", Excalidraw "don't render an individual selection border".)
- Non-groupable item types are documented: 3D objects. — **[DOC]**

### F. UNGROUP
- **Only the shortcut is documented:** "**Ungroup a selected group of items to become individual items** — `Option-Shift-Command-G`" — **[DOC]** https://support.apple.com/guide/freeform/keyboard-shortcuts-and-gestures-frfm46c25187e/mac (and identically on the en-gb / en-ca variants)
- **The phrase "to become individual items" is the only semantic statement.** Whether absolute positions are preserved, whether z-order is preserved, whether nested groups exist at all: **[ND]**.

### G. GROUP STYLING
**[ND].** No documentation of group-level fill, stroke, or opacity. No statement about inheritance. Given Apple documents *per-item* formatting extensively (shapes and lines guide, "Change border thickness, colour and more, select the shape or line, then use the formatting tools") but never group-level styling, treat group styling as **absent in practice — [OBS]**, not documented.

### H. LAYOUT / AUTO-LAYOUT
**No auto-layout.** What Freeform *does* have, documented:
- "you can turn on the background dot grid and **automatically align items to it**" — **[DOC]** iphone guide. That's **grid snapping**, not layout.
- Connectors: "Use connection lines, with a common point to indicate that a shape or text is part of a diagram" — **[DOC]** https://support.apple.com/guide/freeform/add-a-diagram-frfm1e6c3d3e/mac
- Scenes (iOS 18 / macOS Sequoia), sticky notes, shape Boolean ops (`Break Apart`, `unite`, `intersect`, `subtract`, `exclude`) — **[DOC]** https://support.apple.com/guide/ipad/add-shapes-lines-and-arrows-ipadb96d65cb/ipados . Note these Booleans produce a **new shape**, not a group.
- No automatic child arrangement inside any container: **[ND]**.

---

## Cross-tool summary

| | Figma | Miro (group) | Miro (frame) | Canva | Excalidraw (group) | Excalidraw (frame) | tldraw | draw.io | Freeform |
|---|---|---|---|---|---|---|---|---|---|
| **A. Membership stored as…** | child→parent link | per-item `groupId` | child→`parentId` | parent-child, relative coords | `groupIds[]` on child (no group object) | `frameId` on child | `parentId` on child | `parent` on `mxCell` | **not documented** |
| **Geometric test on drop?** | frames only (size, not containment) | no | API requires full containment | no | **never** | yes (contain vs intersect) | frames only | yes (`dropTarget` hit test) | no |
| **"Partially overlapping" distinct?** | no (size rule) | no | yes (must be fully inside) | no | n/a | **yes** (`boxSelectionMode`) | no | yes (drag out of bounds) | no |
| **B. Nestable** | yes | **SDK says no**; UI contradictory | yes | **official says no**; 3rd-party says yes | yes (by design) | yes | **yes, documented** | **yes, documented** | **not documented** |
| **Documented max depth** | none | none | none | none | none | none | none | none | none |
| **C. Multiple parents** | no | no | no (but group+frame coexist) | — | **YES (native)** | no (single `frameId`) | no | no | — |
| **D. Drag out ⇒ leaves?** | **group: NO** (layers panel only) / frame: yes | [ND] | implied | no (must Ungroup) | **NO** | recomputed on drag | [ND] | yes (blocked if `transparentBounds`) | [ND] |
| **Delete member** | group auto-deletes when empty | group persists (bug report) | [ND] | [ND] | dissolves below 2 | [ND] | **auto-ungroup at 1 child, remove at 0** | auto-shrink; auto-delete when empty | [ND] |
| **Undo/redo** | [ND] | [ND] | [ND] | [ND] | [ND] | [ND] | **documented (marks/diffs/bail)** | standard, group-specific [ND] | [ND] |
| **E. Click selects group** | yes | yes | yes | yes | yes | — | yes (3-step drill) | yes (click-to-drill) | yes |
| **Child outline suppressed** | [ND] | [ND] | [ND] | [ND] | **yes, documented** | — | dashed only when focused | **yes, documented** | [ND] |
| **Resize ⇒ child** | per-child constraints | [ND] | [ND] | [ND] | rescale each element | — | **composed transform** | **relative resize + rotate** | **proportional-only sometimes** |
| **F. Ungroup preserves position** | **yes** | [ND] | [ND] | implied (`AbsoluteElement[]`) | **yes** (no object) | [ND] | **yes, explicit** | [ND] | [ND] |
| **Ungroup recursive?** | yes (children of children) | — | — | no nesting | n/a | — | **NO, explicit** | no | [ND] |
| **G. Group fill/stroke** | **NO** (absent from `fills` list) | [ND] | **yes** (colour) | [ND] | **impossible (no object)** | frame has own style | **NO, explicit** | **yes** (style keys) | [ND] |
| **Group opacity** | **yes** (`opacity` prop) | [ND] | [ND] | [ND] | **NO** (per-element only) | per-element | **NO, explicit** | key exists, cascade **[ND]** | [ND] |
| **H. Auto-layout** | frames only, not groups | no (align/distribute only) | no | none | no | no | no | **YES — ELK, container-scoped, nested inside-out** | no (grid snap only) |

---

## Where the evidence actually ends — read this before relying on any row

1. **No tool in this set documents a maximum group nesting depth.** Not one. tldraw, draw.io, and Excalidraw document nesting as unlimited; Figma, Miro, and Canva don't address depth at all. If your design needs a depth cap, you're inventing a constraint none of them impose.

2. **Three distinct answers to "what is a group", and only two are the same shape:**
   - *Tree node with a real object* — Figma (`GROUP`), tldraw (`type: 'group'`), draw.io (`mxCell`), Miro (`type: 'group'`), Canva (`GroupElement`)
   - *Pure annotation on the child, no object* — Excalidraw (`groupIds[]`)
   - *Unknown / not a data model* — Freeform
   Figma, tldraw, and draw.io are closest; Excalidraw is genuinely different in that a group **cannot** hold properties, be bound to, or be independently transformed, because it does not exist.

3. **Membership is a stored pointer in 5 of 6 modelled tools.** Only Figma overlays a geometric/size heuristic — and *only for frames*, never for groups. Figma is also the only tool where dragging a canvas object out of a group is impossible without the layers panel, which is a genuinely surprising asymmetry that its own help centre states plainly.

4. **Only Excalidraw permits multiple simultaneous parents**, and it does so structurally rather than as a feature. Figma's engineering blog explicitly frames the child-side parent pointer as a *deliberate* choice to avoid multi-parent states. Miro gets a unique hybrid: an item can carry both a `groupId` and a `parentId`, and group-into-frame membership is transitive and auto-propagated.

5. **Automatic empty-group collapse is documented in exactly two tools**, and they chose opposite thresholds: tldraw dissolves at **1** child and deletes at **0** (both documented, with API names); draw.io deletes at **0** for `transparentBounds` groups and auto-shrinks via `expand`/`contract` otherwise. Figma deletes at 0. Excalidraw dissolves below 2. Miro appears **not** to clean up at all (community report). Canva and Freeform: silent.

6. **Group styling is the cleanest dividing line in the whole comparison.** tldraw states flatly "Groups have no visual properties." Figma's `fills` property page omits `GroupNode` from the supported-types list, so no fill/stroke — but Figma *does* keep `opacity` and `blendMode` on groups. draw.io is the only tool where a group is a first-class styleable cell. **Nobody in this set documents that group opacity cascades to children.** The only affirmative statement anywhere is a third-party Figma rendering explainer. **Treat group-level opacity inheritance as an open question across the board.**

7. **draw.io is the only tool with a real container-aware layout engine.** ELK-backed, and explicitly scoped: "Shapes inside container shapes are arranged within their container," "only the contents of that container are rearranged," "container shapes will always be resized to fit their laid-out contents," and `childLayout` styles give persistent nested layouts. Its one documented trap: `childLayout` runs on edit, **not on open**, so generated diagrams sit at stored coordinates (often all `0,0`) until touched.

8. **Miro's "Auto layout" is a misnomer** and will mislead you. It is a one-shot align/distribute tool over a selection. It has nothing to do with container children.

9. **Freeform is the weakest documented tool in the set by a wide margin.** Apple's entire treatment of grouping is ~5 sentences across the user guide, with no parent pointer, no nesting, no membership rule, no empty-group behaviour, and no group styling. Two useful facts *are* documented and are the only ones worth designing around: the proportional-resize restriction tied to rotated images/movies and green-dot shapes, and Apple's own recommendation to fake a workspace with a large locked rectangle — which tells you it has no real container. The only nesting-ish feature it has, `View > Use Groups`, groups **boards in the sidebar**, not objects on canvas.

10. **Canva's official position is "groups cannot be grouped"** — the Apps SDK doc lists `Groups` among the element types that cannot be organized into groups. Multiple third-party guides contradict this. I could find no Canva-official source supporting nesting, and no documented depth. I'd treat nesting as unsupported until you verify in-product.

11. **Undo/redo of a boundary-crossing move is undocumented in 8 of 9 systems.** tldraw is the only one that documents the mechanism (history diffs + marks, with `bailToMark` for cancelled drags, which would revert any reparenting). draw.io documents that undo exists; the rest are silent on whether a reparent is atomic with the move. If your spec needs undo to restore membership atomically, **tldraw is the only one you can cite.**