Research complete. Here is the full report.

---

# Document & Folder Rendering Map — FOSS Content Workspace

**Repo root:** `/home/user/Desktop/dev/academic-research/foss-content-workspace`
Astro 5 SSR + React islands + PostgreSQL + OpenFGA ReBAC. Two distinct render paths exist for "content", plus a third for canvas studio.

---

## 1. Resource Model

### 1.1 Table: `resources`

There are **two competing schema definitions** — pick based on which bootstrap is in play:

| Definition | Location | Notes |
|---|---|---|
| Migration-set (canonical for the app) | `migrations/0001_initial_schema.up.sql:18-38` | `type VARCHAR(64)`, has a `content TEXT` column |
| Docker init (used by `docker-compose` / OpenFGA stack) | `docker/postgres/init.sql:28-48` | `type resource_type` **ENUM**, no `content` column, `parent_id` is a self-FK `ON DELETE CASCADE`, GIST trigram index on `path` |

`migrations/0001_initial_schema.up.sql:18-38`:
```sql
CREATE TABLE IF NOT EXISTS resources (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
  parent_id VARCHAR(255),
  owner_id VARCHAR(255) NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT false,
  is_draft BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Indexes: `idx_resources_owner`, `_parent`, `_path`, `_type`, `_public` (`0001:34-38`).

Later adds:
- `migrations/0003_quartz_frontmatter_and_visibility.up.sql:4-9` — `unlisted BOOLEAN`, `tier VARCHAR(32)` + indexes. **This is the only migration named after Quartz.**
- `docker/postgres/migrations/002_blog_platform.sql:29-34` — adds `slug`, `content_ref`, `published_at`, `depth`.

> **Important inconsistency:** `src/lib/resourceFactory.ts:534-535` has a comment stating *"the `resources` table has no `content` column — body text lives on disk (`metadata.filePath`) / object storage"*, yet `src/pages/api/v1/resources/[...id].ts:103,270` and `tests/fixtures/seed.sql:138` both read/write `content`. In practice: **`content` is vestigial; the markdown body is on disk.**

### 1.2 `metadata` JSONB shape

Canonical Zod contract: `src/lib/types/metadata.schema.ts:6-22`
```ts
export const BaseResourceMetadataSchema = z.object({
  title, description, socialDescription, summary, tags[], draft, date, updatedAt,
  aliases[], ogImage, slug, author, category, wikilinks[],
  tier: z.enum(['free','subscriber','restricted']),
}).catchall(z.any());
```
Per-type extensions at `:27-119`; dispatcher `validateResourceMetadata(type, raw)` at `:135-162`.
Non-schema keys added at runtime: `filePath`, `shortId`, `unlisted`/`isUnlisted`, `isPersonalRoot`, `canvasData`, `storageKey` (`src/lib/resourceFactory.ts:520-531`).

### 1.3 Where `folder` is defined

**`folder` is NOT in `RESOURCE_TYPE_CATALOG`** for *display* purposes — it *is*, at `src/lib/registry/resourceRegistry.ts:370`:
```ts
{ type: 'folder', mode: 'create', label: 'New Folder',
  hint: 'Organize resources into folders',
  description: 'Nested container for organizing vault resources', accent: '#f59e0b' },
```

The full type *definition* (with the container category) is at `src/lib/registry/resourceRegistry.ts:242-253`:
```ts
{
  type: 'folder',
  label: 'Folder Container',
  icon: '📁',
  accentColor: '#f59e0b',
  category: 'container',
  description: 'Hierarchical container holding nested notes, canvases, and assets.',
  canCollab: false,
  canEmbed: false,
  matcher: (item) => Boolean(item.type === 'folder' || item.id?.startsWith('folder:')),
}
```

Also in the DB enum: `docker/postgres/init.sql:9-14` — `'space', 'folder', 'document', 'canvas', 'canvas_node', 'sheet', 'form', 'pdf', 'image', 'block', 'blog', 'todo', 'collection', 'excalidraw', 'mermaid', 'google_doc', 'google_sheet', 'paper'`.

And in OpenFGA as a first-class type: `authz/model.fga:12-20` (`folder` with `parent_space`, `parent_folder`, `owner`, `editor`, `viewer`, `denied_viewer`, plus inheritance `editor from parent_folder`).

### 1.4 `RESOURCE_TYPE_CATALOG` values (`src/lib/registry/resourceRegistry.ts:368-379`)

`mode: 'create'` → `document`, **`folder`**, `canvas`, `sheet`, `excalidraw`, `mermaid`
`mode: 'import'` → `pdf`, `image`, `google_doc`, `google_sheet`

Runtime registry types (`BUILTIN_RESOURCE_TYPES`, `:40-266`): `document`, `canvas`, `sheet`, `paper`, `pdf`, `image`, `tex`, `google_doc`, `google_sheet`, `form`, `bases`, `excalidraw`, `jupyter`, `mermaid`, **`folder`** (`:242`), **`space`** (`:254`). Note `space` is a registry type but **not** in the catalog (not user-creatable).

Creatable-type union (API contract): `src/lib/resourceFactory.ts:28-38` and the Zod enum at `src/pages/api/v1/resources/create.ts:22-33` — the same 10 types as the catalog.

### 1.5 How folders are created

`src/lib/resourceFactory.ts`:
- `CreatableResourceType` includes `'folder'` — `:29`
- `scaffoldResource('folder', …)` returns **empty content, no file, no metadata** — `:203-209`:
  ```ts
  if (type === 'folder') {
    return { content: '', fileExt: '', metaAdjust: {} };
  }
  ```
  → folders are **DB-only**; nothing lands on disk.
- `computeRoute` special-cases folder → `/folders/${encodeURIComponent(resourcePath)}` — `:449-452`
- Personal root auto-creation: `ensurePersonalRoot()` — `:97-116` (`folder:<user>_root`, `metadata.isPersonalRoot: true`, `path === folderId`, tuple `owner`)
- Parent resolution + editor guard: `resolveParent()` — `:119-170` (calls `canUserEditResource`, rejects non-folder/space parents at `:137-139`)
- Path convention: `path = ${parent.path}/${id}` — `:517` (so paths are `folder:a_root/folder:x/document:note`)
- Hierarchy tuples: `parent_folder` / `parent_space` + `owner` + `user:* viewer` when public — `:546-554`
- Insert: `:536-540`

ZIP/dir vault ingestion creates folders too: `src/lib/vaultSync.ts:151-184` (`folder:${vaultName}_${slugify(accumulatedDir)}`).

---

## 2. The Two Render Paths

### 2.A `src/pages/index.astro` — the document viewer (473 lines)

**URL contract:** pretty `/slug-shortid` → 301 → `/?doc=<id>` (middleware `src/middleware.ts:109-130`); also legacy `?doc=` and `?edit=true`.

#### Resolution (`index.astro:28-84`)
```ts
const dbRes = await query(
  'SELECT id, type, parent_id, owner_id, path, title, metadata, is_public, is_draft FROM resources ORDER BY title ASC'
);
rawResources = await filterViewableResources(dbRes.rows || [], currentUser, { allowFoldersForTree: true });
```
- `:42` — `const docId = Astro.locals?.docId || Astro.url.searchParams.get('doc')`
- `:45` — `resolveActiveDoc(rawResources, docId)` → `src/lib/workspace/documentResolver.ts:5-26` (tries exact id → `metadata.aliases` → `metadata.slug` → 12 typed-prefix forms → `id.endsWith(':'+slug)`)
- `:47-53` — canonical-slug 301 redirect
- `:71-84` — **missing resource falls back silently**: picks the first `document|paper|blog`, else a **hardcoded fake note object** (`'document:agentic-ai-edge-cloud-continuum'`, `index.astro:72-84`). There is **no 404 / not-found state** on this route.

#### Type flags & chrome suppression (`index.astro:88-108`)
```ts
const isFolder   = activeDoc.type === 'folder';
const isCanvas   = activeDoc.type === 'canvas';
const isPdf      = activeDoc.type === 'pdf';
const isImage    = activeDoc.type === 'image';
const isGoogleDrive = /* drive | drive_* | google_doc | google_sheet (+ id prefixes) */;
const isPaper    = activeDoc.type === 'paper' || (type==='pdf' && (metadata.entityType==='paper' || tags includes 'research-paper'));
const canWysiwygEditActive = canWysiwygEdit(activeDoc);   // registry editMode === 'wysiwyg'
```

#### Chrome composition — `BaseLayout` + hand-inlined 3-column grid

`index.astro:140-149`:
```astro
<BaseLayout resource={activeDoc} currentUser={currentUser}
  activeResourceId={activeDoc.id} activeTitle={activeDoc.title} activeType={activeDoc.type}
  noMainWrapper={true} layoutVariant="workspace" canonicalUrl={canonicalResourcePath}>
```
`noMainWrapper` bypasses `<main class="page-shell">` — `src/layouts/BaseLayout.astro:60-66`. So the **page supplies its own grid**.

Layout tree (`index.astro:154-294`):

```
#reading-progress (.reading-progress-bar)              :151
.workspace-container                                    :154
  .workspace-grid                                       :155
    aside.sidebar-left                                  :158
      .sidebar-left-inner.custom-scrollbar              :159
        #sidebar-left-mobile-header                      :161
        "USER VAULT" + currentUser block                :166-169
        <FolderTree client:load …/>                     :171
      #sidebar-left-toggle.sidebar-toggle-btn           :175
    main.center-content.ui-card                         :179
      article
        nav.breadcrumbs-trail                           :182
        h1 title (+ ReadToggle / reader / edit)         :205-235
        read-only notice                                :238-246
        <ContentMeta/>                                  :250
        <ResourceContentRenderer …/>                    :254-264
    aside.sidebar-right.custom-scrollbar                :269
      section.sidebar-panel → <GraphContainer client:idle …/>  :271-276   ALWAYS
      section.sidebar-panel → <TableOfContents client:idle/>     :279-283  CONDITIONAL
      section.sidebar-panel → <Backlinks client:idle …/>         :286-290  CONDITIONAL
<WikilinkPreview client:idle/>                          :297
#back-to-top.back-to-top-btn                            :300
<script> …workspace interactivity, sidebar collapse, reader mode, hash scroll… </script>  :307-472
```

**Show/hide decision points:**
- TOC: `index.astro:279` — `{((!isFolder && !isPdf && !isImage && !isGoogleDrive) || isPaper) && (…)}` (note: `isCanvas` is *not* excluded → TOC renders on canvas, but `TableOfContents.tsx:15` scopes to `.prose-content`/`article` and `TableOfContents.tsx:51` returns `null` when no headings, so it self-suppresses).
- Backlinks: `index.astro:286` — `{backlinks.length > 0 && …}`.
- Graph: **unconditional** (`index.astro:271-276`) — always hydrated.
- Right sidebar entirely hidden below 1024px via CSS: `src/styles/layout.css:429-437` (`@media (max-width: 1023px) { .sidebar-right { display: none !important } }`).
- Reader mode hides both sidebars: `index.astro:459-467` toggles `body.reader-mode-active`; CSS `src/styles/layout.css:462-465`.

#### Body/content production (`index.astro:110-123`)
```ts
let docBodyHtml = ''; let rawFileContent = '';
if (isFolder) {
  docBodyHtml = renderFolderDirectoryHtml(activeDoc, rawResources);      // :114
} else if (!isPdf && !isImage && !isGoogleDrive && !isCanvas) {
  const targetFilePath = resolveDocumentFilePath(activeDoc);              // :116
  if (targetFilePath) {
    rawFileContent = fs.readFileSync(targetFilePath, 'utf-8');            // :118
    docBodyHtml = await renderMarkdownWithEmbedsAsync(rawFileContent, currentUser, 0);  // :119
  } else {
    docBodyHtml = `<p>${activeDoc.metadata?.summary || activeDoc.title}</p>`;  // :121  ← fallback
  }
}
```
- **No `getContentHtml` exists anywhere in the repo.** The function is `renderMarkdownWithEmbedsAsync(raw, currentUser, depth=0, filePath?)` — `src/lib/renderEngine.ts:147-172`, wrapping the sync `renderMarkdownWithEmbeds` (`:109-141`). Pipeline (`:122-138`): MDX components → custom editor blocks → callouts → citations → KaTeX math → embeds (`MAX_EMBED_DEPTH = 3`) → wikilinks → OFM highlight/strikethrough/task-lists → `marked.parse` (isolated instance, `:55-101`). Async path swaps in Shiki (`:160-171`).
- **File resolution:** `resolveDocumentFilePath` — `src/lib/workspace/documentResolver.ts:51-76`. Order: `metadata.filePath` → `/content/`-relative rewrite → fallback guess `content/user_demo/<category>/<slug>.md` (`:63-66`) → recursive `findFileInDir(content/, '<slug>.md')` (`:31-46, 68-73`). Returns `null` on total miss → the `<p>summary</p>` fallback.
- **Viewer dispatch:** `src/components/ResourceContentRenderer.astro:57-81` — `resolveViewerKind()` maps flags + `resolveResourceType()` to one of `edit|pdf|image|google_drive|canvas|excalidraw|jupyter|mermaid|form|sheet|prose`. `prose` is the final `else` at `:170-176` (`<div class="prose-content" set:html={docBodyHtml} />`).

#### Breadcrumbs
`index.astro:132-137` → `buildBreadcrumbs(activeDoc, rawResources, {isFolder,isPdf,isImage,isGoogleDrive})` at `src/lib/workspace/breadcrumbs.ts:17-61`.
- Always starts `{ title:'Vault', href:'/', icon:'🏠' }` (`:24-26`)
- If `parent_id`: emits grandparent then parent, both `buildResourcePath()`-linked (`:28-46`) — **hard-capped at 3 levels**
- Else if `metadata.category`: a single pseudo-crumb linking to `/?doc=<category>` (`:47-53`)
- Terminal crumb icon chosen by type (`:55-58`); **terminal crumb has no `href`** (correctly rendered as `<span class="breadcrumb-current">` at `index.astro:186-190`)

#### CSS containers (`src/styles/layout.css`)
| Selector | Line | Definition |
|---|---|---|
| `--workspace-header-height: 58px` | `288-292` | offsets |
| `.workspace-container` | `295-301` | full width, padded |
| `.workspace-grid` | `303-310` | `grid-template-columns: 264px minmax(0,1fr) 292px` |
| `.sidebar-left` | `314-330` | sticky <1024, **fixed** ≥1024, 264px |
| `.sidebar-left-inner` | `332-338` | `overflow-y:auto` |
| `.center-content` | `341-349` | `min-height:80vh`, forced `grid-column: 2` at `352-356` |
| `.sidebar-right` | `359-380` | sticky flex column, **fixed** ≥1024, 292px |
| ≥1680px bump | `382-390`, `411-420` | 288 / 320px |
| 1024–1280px | `392-400`, `422-427` | 232 / 260px |
| `.sidebar-panel` | `402-409` | padded, bottom border |
| <1023px | `429-437` | right sidebar `display:none` |
| <768px | `439-460` | 1 col; left collapses to 48px + tap-to-expand |
| `body.reader-mode-active` | `462-465` | hides both sidebars |
| `.breadcrumbs-trail` | `697-729` | + `__separator`, `.breadcrumb-current` |
| `.reading-progress-bar` | `683-694` | fixed top 3px |
| `.workspace-grid.sidebar-left-collapsed` | `732-757` | `48px minmax(0,1fr) 292px`, persisted in `localStorage` (`index.astro:436,441`) |
| `.sidebar-left-mobile-header` | `757-775` | mobile-only |

> `layoutVariant="workspace"` only adds a body class `layout--workspace` (`BaseLayout.astro:51`) — **no CSS rule matches `layout--workspace` / `layout--contained` / `layout--canvas`**. Cosmetic only.

---

### 2.B `src/pages/folders/[...path].astro` — folder view (404 lines)

**This route is a completely separate, much simpler page. It has NO vault explorer, NO TOC, NO graph, NO backlinks.**

#### Path decode (`folders/[...path].astro:12-15`)
```ts
const pathSegments = Astro.params.path ?? '';
const folderPath = decodeURIComponent(pathSegments).replace(/^\//, '');
// e.g. "space%3Amain%2Ffolder%3Apublic_vault_canvas" -> "space:main/folder:public_vault_canvas"
```

#### Resolution — a 3-way branch (`:23-92`)

**(a) Explicit DB folder row** (`:25-31`):
```sql
SELECT id, type, title, path, owner_id, metadata, is_public
FROM resources
WHERE (path = $1 OR id = $1) AND (type = 'folder' OR type = 'space')
LIMIT 1
```
Then a **hard permission gate** (`:67-74`):
```ts
const canViewFolder = await canUserViewResource(folderResource, currentUser);
if (!canViewFolder) {
  if (currentUser === 'user:anonymous') {
    return Astro.redirect(`/login?redirect=${encodeURIComponent(Astro.url.pathname)}`);
  }
  return new Response(null, { status: 403 });     // bare 403, no body
}
```

**(b) Virtual folder fallback** when no row matches but descendants exist (`:33-62`):
```sql
SELECT id, type, title, path, owner_id, metadata, is_draft, created_at, updated_at
FROM resources
WHERE path LIKE $1 AND type != 'folder' AND type != 'space'
ORDER BY title ASC
-- [ `${folderPath}/%` ]
```
→ synthesizes an in-memory folder (`:48-56`): `id: virtual:<path with / → _>`, `type:'folder'`, `owner_id:''`, `is_public:false`, title = last segment with `[-_]→' '`. Children ReBAC-filtered at `:59`.

**(c) `folderNotFound = true`** (`:60-62`).

**(d) `dbError = true`** on exception (`:89-92`).

⚠️ Note: branch (b) runs on a **path-prefix match with no parent permission check** — only `filterViewableResources` on the children. A private folder whose children are all public would still not be listed (children are private), but the *hero/title* would render.

#### Child query (`:77-84`)
```sql
SELECT id, type, title, path, owner_id, metadata, is_draft, created_at, updated_at
FROM resources
WHERE (parent_id = $1 OR path LIKE $2)
  AND type != 'folder' AND type != 'space'
ORDER BY title ASC
-- [folderResource.id, `${folderResource.path}/%`]
```
Then `:87` — `childResources = await filterViewableResources(childRes.rows || [], currentUser);`

> **This is the single most important limitation for a folder-page redesign:** `AND type != 'folder' AND type != 'space'` means **subfolders are excluded from the child list entirely.** The folder grid can never show nested folders today. The `parent_id = $1 OR path LIKE …` disjunction also means the list is **recursive** (all descendants), not just direct children.

#### Breadcrumbs (`:95-106`) — local, not shared
```ts
function buildBreadcrumbs(path: string) {
  const parts = path.split('/').filter(Boolean);
  const crumbs = [{ label: '/', href: '/' }];
  let accumulated = '';
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    crumbs.push({ label: part, href: `/folders/${accumulated}` });
  }
  return crumbs;
}
const breadcrumbs = buildBreadcrumbs(folderPath);
```
This is a **completely separate implementation** from `src/lib/workspace/breadcrumbs.ts` (which `index.astro` uses). It is *better* (unbounded depth, always a valid href) but is duplicated logic.

#### Chrome (`:137-141`)
```astro
<BaseLayout
  title={`${folderTitle} · Folder · FOSS Content Workspace`}
  description={`Contents of the ${folderTitle} vault folder — ${childResources.length} resource${…}s.`}
  currentUser={currentUser}
>
```
**No `noMainWrapper`, no `layoutVariant`, no `resource`, no `activeResourceId`.** So `BaseLayout.astro:60-66` emits `<main class="page-shell">` and the page nests `<div class="container folder-page">` inside it (`:313`) — double-narrowing (`page-shell` max 1100 + `.container` max 1440, `layout.css:518-522` / `878-882`).

Only chrome present: `BaseLayout` → `Header.astro` (with SearchModal / ShareModal / CreateResourceModal / Toaster portals — `Header.astro:76, 138, 152, 163, 166, 172`). **No `FolderTree`.** All styling is a **167-line inline `<style>` in `extraHead`** (`:143-310`) — the only page besides `tags/*` that does this.

#### Other notable bits
- `getTypeIcon(type)` — a **local hardcoded switch** (`:108-118`) that ignores `resourceRegistry`, and notably maps `'md'` (the seeded type in `tests/fixtures/seed.sql:140`) but **not** `'document'`, `'folder'`, `'excalidraw'`, `'jupyter'`, `'mermaid'`, `'form'`, `'space'`. Violates the AGENTS.md single-source-of-truth rule.
- `formatDate()` local helper — `:120-125`
- `humanizeFolderTitle(path)` local helper — `:128-132`
- `folderTitle = folderResource?.title ?? humanizeFolderTitle(folderPath)` — `:134`
- `ReadToggle` is rendered **only for real DB folders** (`:356-358`), skipped for virtual folders.

---

## 3. Folder Specifics — Index-File Detection

### 3.1 `folders/[...path].astro`: **there is NO index-file detection. None.**

The route does not read, look for, or know about `index.md`, `README.md`, `index.mdx`, `README`, or any folder-index convention. Verified by grep — the only `index.md` hit in the whole app is unrelated:

```
scripts/seed_papers_vault.ts:102:    const masterPath = path.join(RESEARCH_DIR, 'index.md');
```

And the only `index`-ish identifiers in `folders/[...path].astro` are the CSS class `.folder-page` (`:144`, `:313`) — a layout class, not a content file.

**Exact render decision tree (`folders/[...path].astro:315-401`):**

```astro
{dbError && (
  <div class="db-error">⚠️ Database error — unable to load folder contents.</div>
)}

{folderNotFound && (
  <div class="ui-card folder-not-found-card">
    <div class="folder-not-found-icon">📁</div>
    <h1 class="folder-not-found-title">Folder not found</h1>
    <p class="folder-not-found-text">
      No folder matches <code class="folder-not-found-code">{folderPath}</code>
    </p>
    <a href="/" class="glass-button folder-not-found-action">← Back to Vault</a>
  </div>
)}

{!folderNotFound && !dbError && (
  <>
    <nav class="breadcrumb" aria-label="Folder path"> … </nav>          {/* :335-345 */}

    <div class="ui-card folder-hero">                                    {/* :348-363 */}
      <div class="folder-hero-row">
        <div class="folder-hero-heading">
          <span class="folder-hero-icon">📂</span>
          <h1 class="folder-hero-title" data-testid="folder-index-title">{folderTitle}</h1>
        </div>
        {folderResource && !virtualFolder && (
          <ReadToggle client:load resourceId={folderResource.id} currentUser={currentUser} title={folderTitle} />
        )}
      </div>
      <p class="folder-hero-count">
        {childResources.length} accessible resource{childResources.length !== 1 ? 's' : ''} in this folder
      </p>
    </div>

    {childResources.length === 0 ? (                                    {/* :366-370 */}
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p class="empty-state-text">This folder is empty or you don't have access to any resources here.</p>
      </div>
    ) : (
      <div class="resource-grid" data-testid="folder-resource-grid">    {/* :372-398 */}
        {childResources.map((r) => { … })}
      </div>
    )}
  </>
)}
```

**Bottom line: `folders/[...path].astro` is *always* the auto-generated fallback.** It is *not* used when an index file exists, because it never looks. And it *is* used even when one exists.

### 3.2 `index.astro`'s folder branch: also **no** index-file detection

`index.astro:88` + `:113-114`:
```ts
const isFolder = activeDoc.type === 'folder';
…
if (isFolder) {
  docBodyHtml = renderFolderDirectoryHtml(activeDoc, rawResources);
}
```
`renderFolderDirectoryHtml` — `src/lib/workspace/directoryView.ts:8-53`:
```ts
export function renderFolderDirectoryHtml(activeDoc, rawResources): string {
  const childResources = rawResources.filter((r) => r.parent_id === activeDoc.id);
  const childFolders   = childResources.filter((r) => r.type === 'folder');
  const childDocs      = childResources.filter((r) => r.type !== 'folder');
  …
  return `
    <p class="dir-intro-text">Browsing resource node directory <code>${activeDoc.path || activeDoc.id}</code> containing ${childResources.length} total items.</p>
    ${folderCardsHtml}
    ${docCardsHtml}
  `;
}
```
- **Strictly `parent_id === activeDoc.id`** — direct children only (unlike the folders route's recursive `path LIKE`).
- **This IS the only place that renders subfolders** (`:10, 14-27` → `.dir-folder-grid` / `.dir-folder-card`).
- Interpolates `f.title` / `d.title` / `d.metadata.summary` **unescaped** into an HTML string (XSS surface, unlike the Astro-templated `folders/[...path].astro` grid).
- CSS for these classes: `src/styles/layout.css:980-1050`.
- **Reachability:** `buildResourcePath()` routes folders to `/folders/...` (`src/lib/resourceUrls.ts:45-47`) and `FolderTree` does too (`src/components/FolderTree.tsx:155-158`). So this branch is only reachable via a hand-crafted `/?doc=folder:<slug>` (which `resolveActiveDoc` matches at `documentResolver.ts:12`). It is effectively **dead/legacy code today**.

### 3.3 The gap is documented as a known TODO

`plan/deferred-low-priority/7-quartz-feature-gaps-todo.md:71-74`:
```
## 🗂️ 5. Folder Index Pages

- [ ] 🟠 **Auto-generated folder index pages** (`@quartz-community/folder-page`)
  When navigating to a folder path with no `index.md`, Quartz auto-generates a
  listing page with all contained notes sorted by date. We currently show a raw
  tree without this fallback.
```

**So the Quartz behavior the user references is unimplemented.** A Quartz-faithful implementation needs, at minimum:
1. In `folders/[...path].astro`, probe for a folder-index resource (e.g. `parent_id = folder.id AND (metadata->>'slug' = 'index' OR title IN ('index','README'))`, or `${folderPath}/index.md` on disk via a `resolveDocumentFilePath`-style resolver).
2. If found → render it through the same `renderMarkdownWithEmbedsAsync` + `ResourceContentRenderer` path as `index.astro`, **with the workspace chrome** (left explorer / right graph+TOC+backlinks), likely by extracting `index.astro:154-294` into a shared layout component (e.g. `WorkspaceShell.astro`, already envisioned at `plan/core-architecture/5-everything-is-a-resource-architecture.md:94`).
3. If not found → the existing auto-generated grid (today's behavior).

---

## 4. Grids of Notes — what exists today

**There is no reusable, permission-aware grid component.** Four separate hand-rolled implementations exist, none shared:

| # | Location | Markup | Data source | Permission filter | Reused? |
|---|---|---|---|---|---|
| 1 | `src/pages/folders/[...path].astro:366-399`, CSS `:199-259` | `.resource-grid` / `.resource-card` / `.resource-card-icon` / `.resource-type-badge` / `.resource-card-tag` | SQL `parent_id = $1 OR path LIKE $2`, **excludes folders** (`:77-84`) | ✅ `filterViewableResources` `:87` | One-off, inline CSS |
| 2 | `src/pages/tags/[tag].astro:239-295`, CSS `:126-203` | `.resource-grid` / `.resource-card ui-card` (identical class names, different styles) | SQL `metadata->'tags' ? $1` (`:18-28`) | ✅ `filterViewableResources` `:36` | One-off, inline CSS |
| 3 | `src/lib/workspace/directoryView.ts:8-53` | `.dir-folder-grid`/`.dir-folder-card`, `.dir-doc-list`/`.dir-doc-card` | in-memory `parent_id === id` (`:9`) | ✅ (uses `rawResources` which was pre-filtered in `index.astro:33`) | String-template HTML, only via `index.astro:114` |
| 4 | `src/lib/render/basesRenderer.ts:50-119` | Inline `display:grid; minmax(220px,1fr)` `cardsHtml` in a `<script>` | `fetch('/api/v1/resources/query?…')` (`:85`) | ✅ server-side in `query.ts:53` | Dataview/Bases fenced blocks only |
| 5 | `src/components/ResourceCard.tsx:1-122` | `ui-card` + grant/deny buttons | — | — | **DEAD CODE — zero references anywhere in `src/` or `tests/`** |
| 6 | `src/components/CreateResourceModal.tsx:276-291`, CSS `src/styles/primitives.css:226-292` | `.ui-resource-grid` / `.ui-resource-card` | `RESOURCE_TYPE_CATALOG` (type picker, not notes) | n/a | The only *tokenized* grid primitive |

**There is no `ResourceGrid`, `CardsGrid`, or `DirectoryLinkCard` component.** Grep confirms:
```
src/components/ResourceCard.tsx:12:export const ResourceCard: React.FC<ResourceProps> = ({   ← only occurrence
```

**Where a folder's children as a grid is *closest* to existing:** `folders/[...path].astro:372-398` is already a working, permission-filtered, Astro-templated grid — it's just missing subfolders, has no shared component, and is wrapped in 167 lines of inline CSS instead of the tokenized `ui-*` primitives required by `AGENTS.md`.

**Primitive grid CSS** (the one to reuse per the design system): `src/styles/primitives.css:226-292` — `.ui-resource-grid`, `.ui-resource-card`, `.ui-resource-card--selected`, `.ui-resource-card__icon/__body/__title/__desc`; `.ui-card` at `:114-126`.

---

## 5. Permissions

### 5.1 Signatures

`src/lib/permissions.ts` (the app-level policy layer; note: `filterViewableResources` lives **here**, not in `openfga.ts`):

```ts
// :19
export async function canUserViewResource(
  resource: ResourcePermissionItem, currentUser: string
): Promise<boolean>

// :59
export async function canUserEditResource(
  resource: ResourcePermissionItem, currentUser: string
): Promise<boolean>

// :94
export async function filterViewableResources<T extends ResourcePermissionItem>(
  resources: T[],
  currentUser: string,
  options?: { allowFoldersForTree?: boolean }
): Promise<T[]>

// :3
export interface ResourcePermissionItem {
  id: string; type?: string; owner_id?: string;
  is_public?: boolean; is_draft?: boolean; metadata?: any;
}
```

`src/lib/openfga.ts` (the transport):
```ts
// :30
export async function checkPermission({ user, relation, object }: CheckPermissionParams): Promise<boolean>
export const PUBLIC_USER = 'user:*';                       // :10
export const fgaClient = new OpenFgaClient({ apiUrl, storeId });  // :15
export async function writeTuple(user, relation, object): Promise<boolean>   // :47
export async function writeTuples(tuples): Promise<boolean>                // :65
export async function deleteTuple(user, relation, object): Promise<boolean> // :76
export { toFgaObjectId } from './resourceId';                               // :4
```
`checkPermission` **fails closed** — engine unreachable ⇒ `false` (`openfga.ts:38-41`).

### 5.2 The 3-layer policy (`src/lib/permissions.ts:19-57`)

1. **Owner** (`owner_id === currentUser`) ⇒ `true` — includes drafts & unlisted (`:26-29`)
2. **Draft or unlisted** for non-owners ⇒ `false` (`:31-34`). Draft = `is_draft === true || metadata.draft || metadata.isDraft`; unlisted = `metadata.unlisted || metadata.isUnlisted`
3. **`is_public`** ⇒ `true` (`:36-39`)
4. **Anonymous** ⇒ `false` — no custom ReBAC grants (`:41-44`)
5. Else `checkPermission({user, relation: 'viewer', object: resource.id})` (`:46-56`)

> Note: the DB has a real `unlisted` **column** (`migrations/0003:4`) but this code only ever reads the **JSONB `metadata.unlisted`** key. Inconsistent.

### 5.3 Batch filter triage (`src/lib/permissions.ts:94-145`)

The docstring at `:82-93` describes it, and the code at `:107-133` does 0-network triage first, then `Promise.all` the OpenFGA calls (`:135-142`):
```ts
if (isOwner)                                   allowedImmediate.push(r);
else if (allowFolders && (r.type==='folder' || r.type==='space'))  allowedImmediate.push(r);
else if (isDraft || isUnlisted)                continue;   // hard-drop
else if (r.is_public)                          allowedImmediate.push(r);
else if (isAnon)                               continue;
else                                           pendingChecks.push({ resource: r, promise: checkPermission(…'viewer'…) });
```
⚠️ `allowFoldersForTree` (`:114`) **bypasses** the public/draft check for containers — so the *tree* shows folder names for containers the user can't actually view. `pruneEmptyFolders` (`treeBuilder.ts:26-34`) then drops leaf folders, which is why that leak is mostly invisible.

### 5.4 Where each route uses it

| Call site | Line | Context |
|---|---|---|
| `src/pages/index.astro` | `:33` | `filterViewableResources(all, user, { allowFoldersForTree: true })` — feeds `rawResources` → tree, graph, backlinks, breadcrumbs, folder directory |
| `src/pages/index.astro` | `:63` | `checkPermission({user, relation:'editor', object: activeDoc.id})` for edit gating (`:57-69`) |
| `src/pages/folders/[...path].astro` | `:67` | `canUserViewResource(folderResource, user)` → login-redirect / bare 403 |
| `src/pages/folders/[...path].astro` | `:59`, `:87` | `filterViewableResources(children, user)` — **no `allowFoldersForTree`** (correct, folders are excluded from the query anyway) |
| `src/pages/tags/[tag].astro` | `:36` | `filterViewableResources` |
| `src/pages/tags/index.astro` | `:28-68` | **Hand-rolled inline reimplementation** of the policy, one `await` per row (N+1 waterfall) — uses `checkPermission` directly |
| `src/pages/blogs/[user]/index.astro` | `:41` | `filterViewableResources` |
| `src/pages/api/v1/resources/query.ts` | `:53` | `filterViewableResources` |
| `src/pages/api/v1/resources/folders.ts` | `:23` | `filterViewableResources(…, { allowFoldersForTree: true })` + rootless-owner attach-point logic (`:26-32`) |
| `src/pages/api/v1/resources/[...id].ts` | `:83` | `canUserViewResource` → 403 |
| `src/pages/api/v1/content/index.json.ts` | `:69` | `filterViewableResources`, per-user cache keyed by `currentUser` (`:27, 99`) |
| `src/pages/api/v1/content/similar.ts` | `:55` | `canUserViewResource` per candidate |
| `src/lib/resourceFactory.ts` | `:150` | `canUserEditResource` → throws `Forbidden…` |
| `src/middleware.ts` | `:241-249` | `checkPermission 'viewer'` for `/api/v1/assets/{pdf,image}/` (with `is_public` + `public/pdfs/*.pdf` filesystem escape hatches at `:220-237`) |
| `src/pages/admin/permissions.astro` | `:19-32` | `checkPermission('owner','space:main')` → `isAdmin`; naive `owner_id === user \|\| anonymous` row filter |

### 5.5 Where per-user filtering would hook in for a folder's children

The hook **already exists** and is already called — `folders/[...path].astro:87` (and `:59` for the virtual branch). It is applied **after** the SQL. The things you would change when adding a folder-index / subfolder listing:

1. **The `AND type != 'folder' AND type != 'space'` predicate** at `:81` and `:40` must be relaxed (or a second query added) to surface subfolders.
2. `filterViewableResources(..., { allowFoldersForTree: true })` will then be needed for the subfolder rows — **but that flag bypasses the draft/unlisted check** (`permissions.ts:114`), so subfolder names of private containers would leak into the grid. This is the trap.
3. `canUserViewResource` on the *parent* (`:67`) still gates the page itself.
4. `directoryView.ts:9` (`r.parent_id === activeDoc.id`) needs no permission work — it consumes pre-filtered `rawResources`.
5. `treeBuilder.ts:46-48` applies a *second* unlisted filter on top: `if (isUnlisted && !isOwner) return;`

### 5.6 Public/draft visibility in directory listings

- **Explorer tree** — `buildTree` (`treeBuilder.ts:40-72`): drops unlisted for non-owners (`:46-48`), prefixes `[Draft] ` to titles (`:53`), sets `isDraft` (`:56`), nests by `parent_id` (`:61-69`), then `pruneEmptyFolders` removes container leaves (`:26-34`, `:71`).
- **Folder grid** — pure `filterViewableResources`; drafts/unlisted vanish silently (no "[Draft]" marker, unlike the tree).
- **Tag pages / blogs / query API** — same `filterViewableResources`.

---

## 6. Backlinks & Graph

### 6.1 Backlinks

**Computation is in-memory over the already-filtered `rawResources`** — not a DB query, not the `/content/similar` API.

`src/lib/workspace/graphTopology.ts:56-70`:
```ts
export function buildBacklinks(activeDoc, rawResources): Backlink[] {
  return rawResources
    .filter((r) => r.metadata?.wikilinks?.some(
      (slug: string) => activeDoc.id.includes(slug) || activeDoc.metadata?.slug === slug || slug === activeDoc.id
    ))
    .map((r) => ({
      id: r.id, title: r.title,
      path: buildResourcePath(r, r.path || undefined),
      excerpt: r.metadata?.summary || r.metadata?.description || `Linked reference from ${r.type}`,
      slug: r.metadata?.slug,
    }));
}
```
- Sources of truth: the `metadata.wikilinks[]` array (populated at ingest by `resourceFactory.extractWikilinks`, `resourceFactory.ts:416-420, 530`) **and/or** the SQL sub-count trick at `blogs/[user]/index.astro:26-27` (`r2.metadata->'wikilinks' ? split_part(r.id,':',2)`).
- Weak matching: `activeDoc.id.includes(slug)` will false-positive on substrings.
- Backlink type: `Backlinks.tsx:3-9`.

**Rendering:** `index.astro:129` computes it; `:286-290` renders:
```astro
{backlinks.length > 0 && (
  <section class="sidebar-panel">
    <Backlinks client:idle documentId={activeDocId} backlinks={backlinks} />
  </section>
)}
```
`src/components/Backlinks.tsx:11-46` — self-guards with `if (!backlinks || backlinks.length === 0) return null;` (`:12`), so the panel is doubly suppressed. Has a literal `Quartz` badge at `:19`.

**Not involved:** `/api/v1/content/similar.ts` is *semantic similarity* (pgvector cosine, `:35-47`), not backlinks; it is rate-limited (`:17-27`) and hard-filters candidates through `canUserViewResource` (`:52-71`). No page currently calls it.

### 6.2 Graph (current implementation, 2026-11-11)

`src/lib/workspace/graphTopology.ts` owns graph construction:
- `buildGraphData` builds all nodes and structural (`parent_id`) and semantic
  (`metadata.wikilinks`) links for the full graph.
- `buildSidebarGraphData` builds the page's local graph: active resource plus
  one-hop parent, child, and wikilink neighbors, capped at 25 nodes. Without an
  active resource it uses up to 20 resources.
- Wikilinks resolve by canonical slug/id first, with legacy substring matching
  as a fallback.

`index.astro` renders the sidebar graph with `client:load`; folder and tag pages
render it with `client:idle`. The page receives and draws its contextual graph
automatically; there is no Load Graph action. `GraphContainer` defaults to the
canvas renderer and honors `localStorage.preferred_graph_engine` for SVG. The
fullscreen expand action fetches `/api/v1/workspace/graph`, whose server route
filters the full graph to resources visible to the requester.

The former `src/components/graph/useGraphState.ts` was unreferenced and has been
removed. Live graph state and render lifecycle belong to `useGraphEngine` and
`GraphShell`; graph topology stays in the workspace library.

### 6.3 Folder and tag sidebars

Folder pages now use the shared `ResourceShell` right column with the automatic
context graph and table of contents; backlinks render when matching resources
exist. Tag pages use the graph and table of contents but do not render
backlinks. These routes are separate from the document page route, so their
sidebar composition is explicit in each route's `context` slot.

---

## 7. Quartz References

### 7.1 Code (only 12 real hits, almost all comments)

| File:line | Content |
|---|---|
| `migrations/0003_quartz_frontmatter_and_visibility.up.sql:1-9` | **The only Quartz-named migration.** Adds `unlisted BOOLEAN`, `tier VARCHAR(32)`, indexes. Header: *"Enhancements for Quartz v5 frontmatter visibility (unlisted, draft, tier, search vector)"* |
| `migrations/0003_quartz_frontmatter_and_visibility.down.sql:1-2` | Revert stub |
| `tests/setup/global-setup.ts:143` | Migration ordering list includes `'0003_quartz_frontmatter_and_visibility.up.sql'` |
| `src/pages/index.astro:153` | `<!-- Quartz 3-Column Workspace Layout -->` |
| `src/pages/index.astro:157` | `<!-- LEFT COLUMN: Quartz Folder Tree Explorer -->` |
| `src/pages/index.astro:278` | `<!-- 2. Quartz-Style Sidebar Table of Contents … -->` |
| `src/components/Backlinks.tsx:19` | `<span className="ui-badge ui-badge--info">Quartz</span>` — a literal UI badge on the Linked References panel |
| `src/components/graph/GraphShell.tsx:214` | `{/* Minimal Quartz-Style Widget Header */}` |
| `src/lib/workspace/graphTopology.ts` | Builds the contextual page graph and full graph from permission-filtered workspace resources. |
| `src/components/ResourceHead.astro:30` | `// Quartz-style description resolution priority chain` (chain at `:31-36`: `customDescription → meta.socialDescription → meta.description → meta.summary → default`) |
| `src/lib/vaultSync.ts:202` | `// Quartz Frontmatter Rule Evaluation:` → draft/publish/private/unlisted rules at `:203-245` |
| `src/styles/graph.css:119` | `/* Graph Controls Floating Card (Quartz style - Top-Right in Expanded Modal) */` |
| `src/pages/vault/sync.astro:15, 112` | Copy: *"Synchronize your Obsidian, Quartz, or markdown vault…"*, *"Supports Obsidian Vaults, Quartz content trees…"* |
| `src/pages/index.json.ts` (`/api/v1/content/index.json.ts:23-115`) | The Quartz `contentIndex.json` analog — 500-row ReBAC-filtered index, per-user TTL cache (120s), consumed by `SearchModal.tsx:84`. **Server-side, not build-time static** as in real Quartz. |
| `src/lib/workspace/graphTopology.ts` + `TableOfContents.tsx` + `breadcrumbs.ts` | The whole "Quartz chrome" (graph / TOC / breadcrumbs) |

**No `docker/postgres/init.sql` Quartz handling.** `inspiration/quartz` is a declared-but-**unpopulated git submodule** (`.gitmodules:4-6` → `https://github.com/jackyzha0/quartz.git`; the `inspiration/quartz/` directory is empty). A full clone of real Quartz v4/v5 *does* exist at `temp/extra/research/` (with `quartz.config.default.yaml`, `docs/`, etc.) — i.e. a scratch reference checkout, not part of the build.

### 7.2 Planning docs (the spec-vs-reality ledger)

- **`plan/deferred-low-priority/7-quartz-feature-gaps-todo.md`** — the canonical gap list. The directly relevant entries:
  - `:71-74` **§5 Folder Index Pages** — *"Auto-generated folder index pages … When navigating to a folder path with no `index.md`, Quartz auto-generates a listing page with all contained notes sorted by date. We currently show a raw tree without this fallback."* ← **the user's question, explicitly TODO**
  - `:58-68` §4 File Explorer / Folder Tree
  - `:87-96` §7 Graph View (local 1-3 hop + global)
  - `:138-142` §12 Alias Redirects (partially done — `middleware.ts:16-41, 148-157`)
  - `:131-135` §11 Reader Mode (done — `index.astro:459-467`)
  - `:159-167` §15 Bases (done — `basesRenderer.ts`)
- `plan/features/4-seo-og-frontmatter.md:6-23, 74, 95-97, 152-167` — Quartz `Head.tsx` / `conditions.ts` / `matchers.ts` / `cfg.ts` frontmatter study (→ `ResourceHead.astro`)
- `plan/core-architecture/5-everything-is-a-resource-architecture.md:94` — **`WorkspaceShell.astro # 3-Column Quartz layout container`** — the planned extraction that would unify the two render paths; `:119` describes `Backlinks.tsx`
- `plan/future-roadmap/12-easy-wins-roadmap.md:3`, `9-pending-tasks-feature-gaps.md:3,9,25`, `11-comparison-obsidian.md:17,33`, `22-massive-scale-…:108`, `23-canvas-performance-…:15`, `stacked-pages-architecture.md:107`, `plan/features/15-vault-sync-ui-zip-folder-ingestion.md:4`
- `scripts/register_benchmark_note.ts:15, 29-33` — seeds `document:huggingface-quartz-workspace-capability-verification`
- `content/user_demo/01_agentic_ai_systems/huggingface-quartz-workspace-capability-verification.md` — a content note that happens to be about Quartz

---

## 8. Decision-Point Summary (for the folder-index feature)

| # | Decision | Where | Current state |
|---|---|---|---|
| 1 | Folder-index file detection | **nowhere** | Must be added to `folders/[...path].astro` (SQL on `parent_id`+slug/title, and/or disk probe like `documentResolver.ts:31-46`) |
| 2 | Chrome reuse across both routes | `index.astro:154-294` is inlined; `folders/[...path].astro:137-141` uses default `BaseLayout` | Extract to a `WorkspaceShell.astro` (per `plan/core-architecture/5-…:94`) with `showExplorer/showGraph/showToc/showBacklinks` flags |
| 3 | Subfolders in the child list | `folders/[...path].astro:40, 81` — `AND type != 'folder' AND type != 'space'` | Must relax; watch the `allowFoldersForTree` draft-bypass at `permissions.ts:114` |
| 4 | Direct children vs. all descendants | `:80` — `parent_id = $1 OR path LIKE $2` | Recursive today; `directoryView.ts:9` is direct-only. Pick one |
| 5 | Breadcrumb implementation | duplicated: `breadcrumbs.ts:17` (3-level cap) vs. `[...path].astro:95-104` (unbounded) | Unify on the unbounded one |
| 6 | Type icons | `[...path].astro:108-118` hardcoded switch, missing `document`/`excalidraw`/`jupyter`/`mermaid`/`form`/`space` | Replace with `getResourceIcon` from `resourceRegistry.ts:323` (AGENTS.md mandate) |
| 7 | Grid component | 4 hand-rolled copies; `ResourceCard.tsx` is dead code | Extract a tokenized `ResourceGrid`/`ResourceCard` over `primitives.css:226-292` |
| 8 | Backlinks on folder pages | `index.astro:129, 286` | `folders/*` has none already; if chrome is unified, guard with `isFolder ? [] : …` |
| 9 | 404 behavior | `index.astro:71-84` silently substitutes a hardcoded fake note | `folders/[...path].astro:321-330` has a proper not-found card — index.astro does not |

### Incidental findings (not asked, but relevant to any refactor here)
- `src/lib/canvas/canvasResolver.ts` is a **0-byte file** imported by `src/pages/studio/canvas/[id].astro:4` — that route is broken.
- ~~`src/components/ResourceCard.tsx` is unreferenced dead code~~ — **deleted.** It
  hardcoded `rgba(...)` / `#e11d48` inline styles, violating the token rules in
  `AGENTS.md`, and had zero references, so removing it is a pure loss of a
  design-system violation. Note this does *not* complete item 7 above: the shared
  `ResourceGrid` is still unbuilt, and what was deleted was not a candidate for
  it as written (it is a permissions card, not a listing tile).
- `src/pages/tags/index.astro:28-68` re-implements the permission policy with a sequential `await` per row — an N+1 network waterfall that should be `filterViewableResources`.
- `resourceFactory.ts:534-535`'s comment ("no `content` column") contradicts `[...id].ts:103,270` and `tests/fixtures/seed.sql:138`.
- `migrations/0003:4` adds a real `unlisted` column; `permissions.ts:24` and `treeBuilder.ts:46` only read `metadata.unlisted`.
- `layout--workspace` / `layout--contained` body classes (`BaseLayout.astro:51`) and `.site-container` (`admin/permissions.astro:60`) have **no matching CSS rules**.
