# Relationship resources across Graph View, backlinks, and Canvas

> Status: proposal, planning only. No application behavior has changed.
> Goal: let people and agents create, read, and traverse multiple named relationships between the same resources. Each relationship is itself a resource with a page and content, while Graph View can draw it as an edge.

## Decision

Introduce a first-class `relationship` resource (`relationship:<stable-id>`) in `resources`, with ownership, ACL, title, metadata, editable body content, search identity, canonical URL, backlinks, and a resource page. Its typed fields identify the source, target, predicate, direction, provenance, and status. Graph View projects it as an **edge when it connects its source and target**, and as a **node when another resource or relationship uses it as an endpoint**. These are contextual representations of one resource, and both may appear in the same view. Keep `metadata.wikilinks: string[]` as the existing target index. Build Graph View and the relationship panel from a unified, permission-filtered projection. Add inline relationship notation through a shared, extensible parser.

Canvas edges remain canvas-local layout data. A Canvas edge can be explicitly **published as a relationship resource** when both endpoints resolve to resources; its label and direction seed the new resource. This avoids silently turning a sketch or an edge to a text/group node into a workspace fact. The relationship retains its Canvas origin so a user can return to the board. Editing/deleting the Canvas edge must have an explicit sync rule rather than silently deleting the relationship page or its content.

## Current state and compatibility audit

| Surface | Current behavior | Gap |
|---|---|---|
| Canvas | `CanvasEdge` has unique `id`, `fromNode`, `toNode`, optional `label`, and styling. The editor exposes a semantic label field; routing fans parallel edges. | Edges belong to one `.canvas` document and are not projected into the workspace graph. |
| Resource framework | `resources` stores typed rows; `resourceRegistry.ts`, metadata validation, creation, canonical URLs, rendering, search, and OpenFGA each recognize resource types. Folder and tag pages show how a resource can have generated content. | `relationship` is not registered across these surfaces. A graph-only record would be a second-class entity. |
| Graph topology | `buildGraphData` and `buildSidebarGraphData` add hierarchy links and `metadata.wikilinks` as `{source,target}`. The sidebar is one hop and capped at 25 nodes. | No edge identity, predicate, provenance, or parallel-edge presentation. |
| Graph rendering | Canvas and SVG graph renderers draw straight lines between endpoints; simulations count each link. | Parallel relationships overlap visually; duplicate edges can inflate degree/force. |
| Backlinks | `buildBacklinks` finds incoming `metadata.wikilinks` and returns source resources, one row per source. | It cannot distinguish “cites”, “extends”, and other relations from the same source. |
| Persistence | Save and creation extract targets with `[[...]]` and `split('|')[0]`, then deduplicate into `metadata.wikilinks`. Vault sync copies frontmatter `wikilinks` and uses a simple line-based frontmatter parser. | Relation labels and repeated links are lost; nested YAML relationship objects cannot be ingested by that parser. |
| Permissions | `/api/v1/workspace/graph` filters resources by viewer before topology generation. | Any new relation read path must apply the same endpoint visibility rule. Canvas read permissions do not automatically grant access to each referenced resource. |

The current renderer recognizes `[[target|alias]]`. Obsidian documents a single pipe for display text ([Internal links](https://obsidian.md/help/links)); a second pipe is not part of that documented contract. The local resolver captures everything after the first pipe as the alias. A direct check against its regex gave:

| Input | Current visible label | Current extracted target |
|---|---|---|
| `[[target|Alias]]` | `Alias` | `target` |
| `[[target|Alias|extends]]` | `Alias|extends` | `target` |
| `[[target||rel:extends]]` | `|rel:extends` | `target` |

Thus an unmarked extra pipe would **change visible content now** and cannot be treated as compatible by only modifying Graph View. A repository scan found no existing two-pipe content in `content/**/*.md` or `content/**/*.mdx` at planning time, but imported and future content can still contain it. Do not infer that every second pipe is a relation. Also keep `![[...]]` embed semantics separate from ordinary links.

JSON Canvas v1.0 already defines a unique edge ID and optional label ([specification](https://jsoncanvas.org/spec/1.0/)). A relationship resource can link back to a Canvas edge without changing the `.canvas` format.

## First-class resource contract

`relationship:<stable-id>` is a resource ID, not merely a graph edge ID. It has a `resources` row (`type = 'relationship'`), owner/tenant/parent, visibility and draft state, title, created/updated times, metadata, and a Markdown/MDX body. The body can describe evidence, rationale, caveats, citations, and discussion. A relationship page uses the shared `ResourceShell`, showing its endpoints, predicate, incoming links, provenance, body, and related resources. If it has no authored body, render a generated summary like a folder or tag listing; do not invent explanatory prose.

Use a typed companion table keyed by `relationship_id` for the queryable relationship fields, with foreign keys to the relationship resource and its endpoint resources. Keep `resources` as the identity/ACL/content authority and the companion table as the authority for endpoints and predicate. Metadata may hold display options and source hints, but must not become a second, divergent copy of the endpoints. The exact storage migration should be designed together with the existing `resources.content`/file-backed content paths.

Application-level read shape, for example:

```ts
interface RelationshipResource {
  id: `relationship:${string}`;  // stable across reads and edits
  title: string;
  body?: string;                 // authored page content, not an edge label
  sourceId: string;              // canonical resource ID
  targetId: string;              // canonical resource ID
  predicate: string;             // e.g. "cites", "extends", "contradicts"
  label?: string;                // optional human wording, separate from predicate
  origin: {
    kind: 'metadata' | 'wikilink' | 'canvas';
    resourceId: string;          // owning note/blog/canvas
    anchor?: string;             // source position or block ID when available
    canvasEdgeId?: string;
  };
  status: 'asserted' | 'suggested';
}
```

- **Direction matters.** `A --cites--> B` means A cites B; the reverse read is “cited by”. Reversing the predicate text is a display concern, not a second stored edge. Bidirectional concepts can have a symmetric predicate or two explicit directional assertions.
- **Multiple edges are valid.** `A --cites--> B` and `A --extends--> B` are separate relationship resources with distinct pages and IDs. Two “cites” assertions can also coexist if they have different evidence or context. Repeated mentions of the *same* relationship in a note point to one ID and can retain multiple citation locations; the graph may group them visually without merging resources.
- **Predicates need stable keys.** Begin with free text plus normalization and a small suggested vocabulary, not a rigid ontology. Preserve the author's exact label. A later registry can add descriptions, inverse phrases, colors, and agent-facing semantics without migrating every edge.
- **Plain links still work.** A normal `[[target]]` remains a generic reference. A link to `[[relationship:<id>]]` opens the relationship resource like any other. Hierarchy remains a structural edge, distinct from an authored assertion. Do not turn OpenFGA authorization tuples into content relationships.
- **Resource IDs are canonical.** Resolve slugs at write/index time using the existing exact-slug/exact-ID policy; record unresolved targets as diagnostics, never guess a relationship via substring matching. Keep a compatibility read path for existing `wikilinks` until records are backfilled.
- **Source ownership is explicit.** The relationship resource has its own owner and ACL. Its `origin` records the note/blog/Canvas that created it and never substitutes for its identity. Define whether the creator, source editor, or Canvas editor may modify it through ordinary resource permissions; an edit to the originating content must not bypass its ACL.
- **Relationships can be related.** A relationship resource may itself be an endpoint of another relationship or be placed on a Canvas. Cap traversal depth in UI/API queries so this does not recursively expand forever.
- **Edge and node roles stay distinct.** The relationship's own assertion is projected as an edge (`sourceId → targetId`). When a second relationship targets that relationship ID, the first relationship is also projected as a node so the second edge has a visible endpoint. A Canvas resource card or direct link likewise uses the node/page representation. Neither projection creates a second resource or changes its identity. A graph may show both roles at once, with separate hit targets and a shared resource link.

Adding the type requires coordinated changes to the PostgreSQL `resource_type` enum/migrations, `src/lib/registry/resourceRegistry.ts` and its catalog, `src/lib/types/metadata.schema.ts`, `src/lib/resourceFactory.ts`, OpenFGA `src/lib/acl/modelSpec.ts`, search indexing, canonical route resolution, resource rendering, and save/read APIs. Follow the actual current content path rather than assuming all resource bodies live only on disk or only in `resources.content`. Do not make the full graph read every Canvas file to discover relationships.

## Authoring routes and syntax

1. **Relationship creation/editor.** Add `relationship` to the resource catalog and creation API. A user can choose source, target, predicate, title, and body; add another relationship with the same endpoints; then open its own page to edit evidence and explanation. The source and target may be notes, blogs, PDFs, folders, tags, Canvases, or other relationships when those IDs resolve to actual resources. Use the normal resource permissions and feedback primitives.
2. **Canvas promotion.** Offer “Create relationship resource” on an edge whose endpoints resolve to resources. Require edit permission on the Canvas and view permission on both endpoint resources; the user need not edit the target. Copy its direction and label into a new resource with Canvas provenance. Multiple Canvas edges between the same nodes create distinct resources unless the user explicitly links an edge to an existing relationship ID. Specify how subsequent Canvas label edits update the resource and how unlinking differs from deleting either one. Do not expose unpublished Canvas edges in Graph View.
3. **Inline authoring.** Support an explicitly marked suffix as an optional authoring route. A proposed v2 form is `[[target|Alias|rel:extends;id:relationship:<uuid>]]`, with `[[target||rel:extends;id:relationship:<uuid>]]` for no alias. The relationship ID binds the mention to a first-class resource. When a user types a new `rel:extends` without an ID, the editor/save flow allocates a resource ID and writes it back into source content atomically; a read-only render must never create resources. Imported/unversioned notes retain legacy pipe behavior until opted into v2. `![[...]]` embeds never create assertions.

## Reusable parser plan

The current rendering path uses `resolveEmbeds` and `resolveWikilinks` regex replacements; save and factory creation each use a separate regex, and vault sync has a simple frontmatter parser. Replace the duplicated reference parsing with a small, pure, versioned parser plus adapters. The parser is a shared library, **not** a Graph View helper: any resource content type that embeds Markdown, including relationship pages, folder/tag generated bodies, and Canvas text nodes, can call it. Structured Canvas edges use a separate adapter that emits the same relationship intent model without parsing JSON as prose.

### Contract and extension points

```ts
interface ReferenceToken {
  kind: 'link' | 'embed' | 'relationship';
  raw: string;
  range: { start: number; end: number }; // source offsets for diagnostics/edits
  target: { raw: string; anchor?: string; blockId?: string };
  alias?: string;
  relationship?: { predicate: string; id?: string };
}

interface ContentSyntaxAdapter {
  format: string; // markdown, mdx, canvas-text, generated-markdown, ...
  scan(source: string, syntaxVersion: number): {
    tokens: ReferenceToken[];
    diagnostics: Array<{ range: ReferenceToken['range']; message: string }>;
  };
  serialize?(token: ReferenceToken): string;
}
```

- Keep the **core scan pure and deterministic**: no database calls, file access, permission checks, or HTML generation. Separate target resolution, permission filtering, resource materialization, and rendering into explicit stages. Use batched resolution of exact ID/slug/alias with ambiguity diagnostics; never let a parser guess via substring matching.
- Register syntax adapters through a small typed registry, analogous to the resource registry. Include a Markdown/MDX adapter, a generated-Markdown adapter, and an adapter for Markdown text fields inside Canvas nodes. Other content types can contribute adapters without adding cases to Graph View. Registered extensions must declare precedence and supported syntax versions; reject conflicting grammars at registration.
- The Markdown scanner must skip fenced code, inline code, escaped delimiters, and frontmatter; distinguish `[[...]]` from `![[...]]`; retain raw source spans; and preserve heading/block targets. Rendering should consume tokens through the existing Markdown pipeline without replacing link-shaped text inside code or HTML attributes. All output is escaped/sanitized at render time.
- `parseFrontmatter` is a separate layer. Replace or extend its line-based parser before accepting nested relationship frontmatter or plugin metadata. It must return validated structured values and the body; reference scanning operates on that body. Frontmatter relationships, if supported for import/export, create or update **relationship resources**, never remain a hidden `metadata.relationships` array.
- The v1 adapter preserves existing `[[target|alias]]` behavior, including literal extra pipes in the alias. The v2 adapter recognizes only a trailing `rel:` field with the exact grammar above, validates predicate and ID, and treats malformed fields as diagnostics plus legacy display text. An unversioned external document stays v1. Define escaping for literal `|`, `]`, and `;`, and keep a serializer that round trips tokens without rewriting unrelated prose.
- On writes, diff parsed relationship intents against existing IDs for that source. Create missing resources and update retained ones in a transaction; never merge solely on `(source,target,predicate)` because parallel assertions are valid. Removing an inline mention removes its origin citation, but should not delete a relationship page with independent body content or other mentions. Require explicit deletion or an orphan cleanup policy. Concurrent edits must not allocate two IDs for one intent.
- Expose one parse result to save, import, preview, graph indexing, editor completion, and rendering. Keep `metadata.wikilinks` as a compatibility projection of target IDs until all consumers migrate. Cache by content hash and syntax version, not by viewer identity; apply ACL only after parsing/resolution.

### Parser rollout and acceptance cases

1. Extract the current v1 behavior into a shared parser and use it for rendering plus target extraction with no syntax change. Golden fixtures cover links, aliases with two pipes, typed IDs, headings/blocks, embeds, code, escaped brackets, and malformed input.
2. Introduce the adapter registry and syntax version per document/resource. Migrate Markdown, MDX, generated prose, and Canvas text through the same contract; use explicit adapters for structured Canvas edges and any future content format.
3. Add v2 marked relationship parsing and serialization. Opt in newly authored content first. Existing content remains byte-for-byte stable until a controlled migration or explicit opt-in. Verify render/save/import/preview parity and allocate persistent relationship IDs on write.
4. Replace the vault sync frontmatter parser with structured parsing and validation. Run a dry-run import report for unresolved IDs, malformed predicates, and old extra-pipe aliases before changing stored content.

The `rel:` spelling is a proposed workspace extension, not part of the documented Obsidian wikilink syntax. Finalize its exact escaping and opt-in marker with corpus tests before implementation.

## Graph and backlink experience

- Extend `GraphLink` with `id`, `kind` (`hierarchy`, `reference`, `relationship`), `relationshipId`, predicate/label, direction, and origin. Return the same typed payload from the full graph endpoint and the local sidebar projection. Project each relationship resource as an edge for its assertion; independently include it as a `GraphNode` when it is referenced or selected as a resource. Thus a relationship between `A` and `B` can be shown as `A → B`, while another relationship can connect `C → relationship:R` in the same graph. Both the edge and node open `R`'s resource page, with interaction labels explaining which role was selected.
- In the compact sidebar, group parallel assertions into one visible connection and show a count or relation list on hover/selection. In the expanded graph, fan or curve parallel edges, draw arrow direction, and expose labels on demand. Provide a relation filter in addition to node-type filters. Both Canvas and SVG renderers must agree.
- Compute connectedness from unique neighbor IDs; decide separately whether edge count is displayed. A node with three relationships to one neighbor should not appear to have three neighbors or receive three times the graph force unless that weighting is deliberate.
- Add an accessible relation list for selected nodes or edge groups. Show “source —predicate→ target”, provenance, and a jump to the relationship page, source note, or Canvas when authorized. Give keyboard users the same information as hover users.
- Keep legacy backlinks as incoming generic references. Add named incoming and outgoing assertions to the resource context; do not silently merge different predicates into a single “linked reference”.
- For humans and agents, expose an authorized, stable read API returning relationship resource IDs, typed edges, content links, and provenance. Check the relationship resource **and both endpoints** for every read, list, search result, graph edge, count, and page; otherwise a public relationship page could reveal a private endpoint through its title or body. Only show provenance details when the viewer can access that source, including an originating Canvas. Agents may create private suggestions as relationship resources, but suggestions require review before publication. Never imply that a graph edge proves the claim in its label; the source and context remain inspectable.

## Incremental delivery

### Phase 1 — Resource type and data model

- [ ] Add `relationship` to the resource type enum, registry/catalog, metadata validation, creation/save/read paths, OpenFGA model, search index, and canonical URL resolver.
- [ ] Create the relationship-specific table keyed by the resource ID, with indexed source/target/predicate fields and explicit delete/update semantics. Add content storage and a relationship page using the shared resource shell; verify editable body round trips.
- [ ] Build a permission-filtered projector over current `wikilinks`, hierarchy, and relationship resources; retain existing graph results for users without typed relationships.
- [ ] Add tests for parallel resources, directional pairs, relationship-as-endpoint, unresolved targets, repeated mentions, and mixed resource types (including blogs, folders, tags, and Canvases).
- [ ] Add authorization tests: an otherwise visible relationship must not reveal a hidden endpoint through its page, body, label, count, search, tooltip, backlinks, or API response.

### Phase 2 — Human authoring and reading

- [ ] Add a relationship resource editor and incoming/outgoing relation lists using `src/components/ui/` primitives, design tokens, preferences, and `showToast`.
- [ ] Extend both graph renderers, modal filters, sidebar summary, and backlinks; render relationship resources as edges for assertions and as nodes when used as resources, including both roles simultaneously. Preserve performance at current graph sizes.
- [ ] Add Canvas edge promotion and explicit unlink/update behavior; verify two distinct Canvas edges between the same resource nodes remain distinct relationship resources.

### Phase 3 — Shared parser and optional inline notation

- [ ] Move v1 reference parsing into a pure shared parser and add the adapter registry, source spans, diagnostics, serializer, and golden fixtures described above.
- [ ] Wire rendering, save, scaffold extraction, vault ingestion, preview, and editor to the shared parse result. Confirm v1 output and extracted targets are unchanged before enabling v2.
- [ ] Add v2 marked relationship syntax with stable relationship IDs, write-path materialization, opt-in versioning, and compatibility fixtures. Test that an old two-pipe alias stays an alias in v1.
- [ ] Backfill/index existing notes incrementally, with a dry-run report and no destructive overwrite of user-authored relationship pages or content.

### Phase 4 — Agent use and scale

- [ ] Add a viewer-scoped relationship resource query API (neighbors, predicate, direction, content, provenance) and reviewed suggestion flow.
- [ ] Measure large-graph and high-degree behavior; introduce indexed relationship storage or aggregation only when data warrants it. This is separate from the long-term 100k-node renderer roadmap.

## Verification gates

- Unit tests for parser v1 compatibility, v2 round trips, plugin registration conflicts, source spans, and graph projection; integration tests for relationship page content, save/reload, vault sync, and Canvas promotion.
- Browser checks for relationship creation/page editing, parallel-edge selection, edge and node representations of the same relationship in one view, relation labels, filters, keyboard access, both renderer modes, light/dark themes, and compact/mobile layouts.
- Permission tests on relationship resource, both endpoints, body, search results, and provenance links, including Canvas-origin relationships and anonymous users.
- `npx tsc --noEmit` and `npx astro build` before shipping UI or API changes, per `docs/design-system.md`.

## Relevant code and adjacent plans

- Topology and backlinks: `src/lib/workspace/graphTopology.ts`, `src/components/Backlinks.tsx`.
- Graph API, types, and rendering: `src/pages/api/v1/workspace/graph.ts`, `src/components/graph/`.
- Wikilink rendering/extraction: `src/lib/render/embedResolver.ts`, `src/lib/renderEngine.ts`, `src/lib/resourceFactory.ts`, `src/pages/api/v1/resources/save.ts`, `src/lib/vaultSync.ts`.
- Resource lifecycle: `src/lib/registry/resourceRegistry.ts`, `src/lib/types/metadata.schema.ts`, `src/lib/acl/modelSpec.ts`, `src/lib/resourceUrls.ts`, `src/pages/[slug].ts`, `src/components/ResourceShell.astro`.
- Canvas schema and authoring: `src/components/canvas/types.ts`, `src/components/canvas/CanvasEditor.tsx`, `src/components/canvas/core/routing.ts`.
- Related architecture: `plan/core-architecture/5-everything-is-a-resource-architecture.md`, `plan/future-roadmap/22-massive-scale-100k-graph-architecture.md`, `docs/design-system.md`.
