Architecture planning like this deserves accurate, current facts about the specific tools you named (not my best guess from memory) — especially licensing, since you said "product." Let me check a few things first.Merging three codebases literally doesn't make sense — Quartz, the HF template, and Obsidian Canvas are three different frameworks solving three different problems. What actually merges cleanly is the *concepts*: one content graph, three ways of viewing it (linked wiki notes, rich long-form articles, spatial boards), all server-rendered, sitting behind an authorization layer that works the way you described. Here's the concrete plan — and a couple of my assumptions turned out wrong until I actually checked, so this is grounded in what these things really are.

## Why SSR is the fork in the road

Quartz's whole model is: crawl the vault once, bake every page to static HTML, serve identical bytes to everyone forever. There's no request to intercept and no identity to check — the HTML for a restricted page already sits on disk, and anyone with the URL gets it. The moment you need "user A sees this note, user B doesn't," you need a server that runs *per request*, checks who's asking, and decides what to send back. SSR isn't a nice-to-have here — it's the only thing that makes RBAC possible at all. Good instinct.

## What you're actually reusing from each project

- **Quartz**: parses markdown with remark-parse into an AST, runs it through remark-rehype, then converts that into Preact JSX via hast-util-to-jsx-runtime and statically renders it with preact-render-to-string, all through a plugin pipeline (transformers/filters/emitters) using remark-parse to convert text to an AST, applying plugin-defined transformations, converting Markdown to HTML with remark-rehype, and finally converting the resulting HTML AST to JSX with hast-util-to-jsx-runtime before rendering it with preact-render-to-string. The reusable part is the *pipeline*, not the static build — unified/remark/rehype is a plain framework-agnostic npm dependency. Take: markdown+wikilink+frontmatter parsing, backlink/graph logic, the plugin pattern. Leave: the static build step and the Preact render target.
- **HF research-article-template**: turns out to actually be built with Astro, MDX, and D3.js, distill-inspired, with content and diagrams licensed CC-BY-4.0, with each article living as a single MDX file. The genuinely reusable part is its component library — figure/image handling, citations, accordions, glossary terms, callouts — literal Astro/MDX components, not something you'd rebuild from scratch.
- **Obsidian Canvas**: isn't an app to embed, it's an open, MIT-licensed spec called JSON Canvas — a JSON file consisting of just two arrays, nodes and edges. You implement a renderer against the spec; you don't extract code from Obsidian.

That HF finding actually changes the framework call: since the article template is Astro-based, and Astro natively does MDX + true SSR (`output: 'server'`) + islands (React/Preact/Vue components only where you need interactivity), it's a stronger unifying choice than defaulting to Next.js — you get direct reuse of the article components, the same remark/rehype ecosystem Quartz runs on, and per-request middleware for auth checks, in one framework.

## The permission model — GCP IAM, translated to content

You already had the right target. This is close to exactly how Cloud IAM's deny policies work, and it maps onto content resources almost one-to-one:

- **Allow** bindings attach to any node in a hierarchy (tenant → space → folder → document/canvas → block/node/image) and inherit downward as a union. Crucially, a lower-level allow can never narrow what was granted higher up — plain allow-policies at a lower level cannot strip an inherited grant from a higher level; only an explicit deny can block an inherited permission.
- **Deny** bindings inherit the same direction but always win, checked before any allow is even consulted — deny policies are inherited through the resource hierarchy just like allow policies, and deny policies override allow policies. That's what gives you "allow rules and deny rules" as separate, prioritized things instead of one flat role table. GCP even lets you exempt specific principals from a deny rule — a deny policy can specify exception principals who are excluded from an otherwise-denied set — worth copying; it's the difference between a "confidential folder" being usable in practice or just annoying.
- One place your system should go *further* than literal GCP: real Cloud IAM deny policies can only attach at org/folder/project level — Deny Policies can only be attached at the organization, folder, or project level, not on an individual resource like a single VM. You want deny (and allow) attachable on one image or one canvas card. That's fine — you're borrowing GCP's *evaluation model*, not its API surface. A Zanzibar-style relationship engine gives you that leaf-level granularity natively.Effective-permission check for "can user U do action A on resource R" becomes one algorithm: walk R up through its parent chain to the root, collecting every binding that matches U along the way (directly, via group, or via role). If any matching deny applies anywhere in that chain — and U isn't listed in its exceptions — access is denied, full stop. Otherwise, if any matching allow applies anywhere in the chain, access is granted. Otherwise, denied by default.

## Resource schema

Every "thing" — a document, a canvas, a single node on a canvas, an image, even one figure inside a long-form article — is a row in one `resources` table, not a special case:

```typescript
type ResourceType =
  | "space" | "folder" | "document"
  | "canvas" | "canvas_node" | "image" | "block"

interface Resource {
  id: string
  type: ResourceType
  parentId: string | null   // walk this chain for downward inheritance
  tenantId: string          // multi-tenant from day one — you're building a product
  ownerId: string
  path: string               // materialized path: "t1/space2/folder5/doc9"
}

interface Binding {
  resourceId: string
  principal: string          // "user:alice" | "group:interns" | "role:editor"
  role: "viewer" | "commenter" | "editor" | "owner"
  effect: "allow" | "deny"
  exceptions?: string[]      // principals exempt from a deny, mirrors GCP's exceptionPrincipals
}
```

In practice you won't hand-roll the recursive ancestor walk — you write `Binding` rows as relationship tuples into a Zanzibar-style engine (`document:123#parent@folder:45`, `folder:45#viewer@user:alice`, `canvas_node:9#denied_viewer@user:carol`), and it answers "check" and "list every object user X can view" queries in milliseconds, hierarchy walk included.

One nice detail specifically for the canvas: the JSON Canvas spec is deliberately built to be extended — you can add your own custom fields to a node, and any other app reading the file simply ignores fields it doesn't recognize. So a canvas node stays a spec-valid `.canvas` file while carrying something like `"resourceId": "canvas_node:9"` pointing into your permission system — you don't fork the format to add ACLs.

## Request flow, and the rule that matters mostThe rule that most RBAC retrofits get wrong: filter server-side before data is ever serialized into the page — never hide-with-CSS or conditionally-render client-side. If a restricted canvas node's data is sitting in the page's JSON payload or React props, it's already leaked the moment someone opens devtools, regardless of what the UI shows. The permission check has to shrink what the server sends, not just what the client displays.

Two corollaries that follow directly:

- **Images can't be static public assets anymore.** Serve them from a private bucket (S3/R2/GCS) behind an authenticated route that checks `asset.read` before streaming or redirecting to a short-lived signed URL. A page with 40 embedded images means 40 checks — batch them (a "list objects this user can view" call is built for exactly this) or cache the accessible-resource set per user per space for a short TTL.
- **Search has to be permission-aware too.** Quartz's default is a public client-side search index built at compile time — great for a digital garden, a real leak here, since it hands out titles and content regardless of access. Start with Postgres full-text search filtered by a subquery of accessible resource IDs; move to Typesense/Meilisearch with an ACL field once you need it faster at scale.

## The stack

| Layer | Pick | Why | Alternatives |
|---|---|---|---|
| App framework | Astro, server output mode | Native MDX, islands for React/Preact widgets, direct reuse of the article template's components, real per-request middleware | Next.js (App Router) if the team is React-first; SvelteKit |
| Content pipeline | unified / remark / rehype + MDX | Same engine Quartz runs on — markdown, wikilinks, frontmatter — framework-agnostic | contentlayer, velite |
| Canvas viewer (read) | json-canvas-viewer | Purpose-built JSON Canvas renderer with SSR/prerendering support and React, Vue, and Preact bindings | react-jsoncanvas (reference code, not a packaged library) |
| Canvas editor (full authoring) | tldraw SDK | Closest to Obsidian Canvas's actual drag/resize/draw editing feel | React Flow (more diagram/DAG-flavored than freeform boards) |
| AuthN | Auth.js / Clerk / WorkOS | Standard session/identity, SSO later if needed | Ory Kratos, Authentik (self-host) |
| AuthZ — the IAM engine | OpenFGA, self-hosted | CNCF incubating project, Zanzibar-style ReBAC+ABAC, built by Auth0/Okta specifically for folder-contains-document style inheritance, free | SpiceDB (same lineage); Permit.io (hosted, visual policy editor, built on OPA/Cedar — good if non-engineers need to edit policy); Cerbos (self-hosted, YAML policy-as-code, simpler mental model, but hierarchy is checked via attributes rather than native relationships) |
| Primary DB | Postgres | resources, documents, canvases, and a mirror of your bindings | — |
| Object storage | S3 / R2 / GCS, private bucket + signed URLs | never publicly serve unauthenticated files | — |
| Search | Postgres full-text → Typesense/Meilisearch | must be filtered through authz, not just indexed openly | Elasticsearch/OpenSearch |
| Hosting | Fly.io / Vercel / self-hosted Node | needs a persistent server for per-request auth — not static hosting | Render, Railway, your own k8s |

## License check before this becomes a product

JSON Canvas is MIT — implementing the spec is unencumbered. The HF template's content and diagrams are explicitly CC-BY-4.0 — check the license on the component *code* itself (separate from the content license) before shipping it inside something commercial. Quartz has historically shipped MIT — worth a quick confirm on the exact version you pull from. And if you go the tldraw route for the canvas editor: the SDK needs a license key to even run in production, the free/hobby path requires displaying a "Made with tldraw" watermark, and removing it means a paid Business License — budget for that if full drag/resize/create editing is a real requirement, or lean on the lighter `json-canvas-viewer` for the read-mostly case, which is already built for server-side rendering and carries no such cost.

## Build order

0. Nail the schema and pick the authz engine — hardest thing to retrofit later.
1. Private "Quartz" MVP: Astro SSR, markdown/MDX docs, login, coarse per-space viewer/editor roles. No canvas, no leaf-level deny yet.
2. Wire in real fine-grained permissions: OpenFGA, hierarchy + deny + exceptions, authenticated image serving.
3. Pull in the article component library for rich long-form pieces — figures, citations, math, D3 embeds.
4. Add the canvas board view: JSON Canvas renderer, node-level resources, docs/images embeddable as canvas nodes.
5. Permission-aware search, graph/backlinks view, and an admin UI for managing bindings — your own mini IAM console. This matters more than it sounds like, or you're the only person who can ever grant access.Happy to go deeper on any single piece next — the actual OpenFGA authorization model (the DSL that encodes this hierarchy), the Astro project scaffold, or the resource/binding schema as real SQL.
