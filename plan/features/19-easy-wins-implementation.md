# Plan 19: Easy Wins Implementation

Based on [12-easy-wins-roadmap.md](file:///home/user/Desktop/dev/blog/template/plan/initial/12-easy-wins-roadmap.md) and the audit in [18-plan.md](file:///home/user/Desktop/dev/blog/template/plan/initial/18-plan.md).

Four isolated, zero-architectural-risk features that can be shipped without touching core infrastructure.

---

## #1 — Note Properties Panel

**Why:** We already store `metadata` (JSONB) per resource. This is a pure UI addition with no DB changes.

### New File: `src/components/PropertiesPanel.astro`
- Accepts `metadata: Record<string, any>` prop
- Renders each key/value pair in a clean 2-column property grid (Notion-style)
- Type-aware rendering:
  - **Arrays** (tags, aliases) → inline pill list
  - **Booleans** (is_draft, is_public) → colored badge
  - **Dates** → formatted string
  - **Strings/numbers** → plain text
- Collapsible via native `<details>/<summary>` — no JS required
- Filters out internal keys (`content`, `password_hash`, etc.)

### Modify: [`ContentMeta.astro`](file:///home/user/Desktop/dev/blog/template/src/components/ContentMeta.astro)
- Import and render `<PropertiesPanel metadata={resource.metadata} />` in the frontmatter section

---

## #2 — Folder Index Pages

**Why:** Currently navigating to a folder path hits a 404. The Tag index (`/tags/[tag].astro`) already demonstrates the pattern.

### New File: `src/pages/folders/[...path].astro`
- Receives folder path from `Astro.params`
- Queries Postgres: `SELECT * FROM resources WHERE path LIKE $1 AND type != 'folder'` (immediate children only, or recursive)
- Respects visibility: same `checkPermission` + `is_public` + `is_draft` logic as `index.astro`
- Renders a `<ResourceCard>` grid (reusing existing component) with folder breadcrumbs at top
- Shows empty state if no accessible resources under this folder

### Modify: [`FolderTree.tsx`](file:///home/user/Desktop/dev/blog/template/src/components/FolderTree.tsx)
- Add `href={/folders/${node.path}}` to folder nodes as a secondary navigation link
- Keep existing expand/collapse behavior; clicking the folder icon navigates, clicking the arrow toggles

> **Conflict — needs decision before implementing:**
> Current sidebar folder clicks use `/?doc=folder:xxx`. New `/folders/[path]` is a parallel route.
> **Q: Should folder clicks navigate to `/folders/[path]`, or should we improve the `/?doc=folder:xxx` view instead?**

---

## #3 — Alias Redirects (Middleware)

**Why:** Aliases are already stored in `metadata.aliases[]` (JSONB). Making them navigable as clean URLs just requires a middleware intercept + migration.

### New Migration: `migrations/0004_metadata_gin_index.up.sql`
```sql
-- Enables fast JSONB containment queries used by alias lookup
CREATE INDEX IF NOT EXISTS idx_resources_metadata_gin
  ON resources USING GIN (metadata jsonb_path_ops);
```

### New Migration: `migrations/0004_metadata_gin_index.down.sql`
```sql
DROP INDEX IF EXISTS idx_resources_metadata_gin;
```

### Modify: [`src/middleware.ts`](file:///home/user/Desktop/dev/blog/template/src/middleware.ts)

Add alias resolution **before** the auth block. Logic:

1. Skip if pathname starts with `/api/`, `/admin/`, `/settings/`, `/auth/`, or has a file extension (assets)
2. Treat the last path segment as a candidate alias slug
3. Query: `SELECT id FROM resources WHERE metadata @> $1` where `$1 = JSON.stringify({ aliases: [slug] })`
4. If found → issue `301` to `/?doc=${resource.id}`
5. If not found → `next()` as usual

> **Conflict — needs decision before implementing:**
> A DB query on every page navigation adds latency.
> **Q: Cache the alias→id map in a module-level `Map` with a 60s TTL to avoid per-request hits?**
> This is straightforward but means aliases added at runtime take up to 60s to become active.

---

## #4 — Comments System (Giscus)

**Why:** Giscus is a zero-backend comments widget backed by GitHub Discussions — purely a `<script>` embed.

### New File: `src/components/GiscusComments.astro`

```astro
---
const repo = import.meta.env.PUBLIC_GISCUS_REPO;
const repoId = import.meta.env.PUBLIC_GISCUS_REPO_ID;
const category = import.meta.env.PUBLIC_GISCUS_CATEGORY;
const categoryId = import.meta.env.PUBLIC_GISCUS_CATEGORY_ID;

// No-op if env vars not configured
if (!repo || !repoId) return;

const { resourceId } = Astro.props;
---

<div class="giscus-wrapper">
  <script src="https://giscus.app/client.js"
    data-repo={repo}
    data-repo-id={repoId}
    data-category={category}
    data-category-id={categoryId}
    data-mapping="specific"
    data-term={resourceId}
    data-reactions-enabled="1"
    data-emit-metadata="0"
    data-input-position="top"
    data-theme="preferred_color_scheme"
    data-lang="en"
    crossorigin="anonymous"
    async>
  </script>
</div>
```

### Modify: [`src/pages/index.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/index.astro)
- Import `GiscusComments.astro`
- Render after the main content block, **only when** `resource.is_public && !resource.is_draft`

### Required env vars (add to `.env.example`):
```
PUBLIC_GISCUS_REPO=owner/repo-name
PUBLIC_GISCUS_REPO_ID=         # from giscus.app configurator
PUBLIC_GISCUS_CATEGORY=General
PUBLIC_GISCUS_CATEGORY_ID=     # from giscus.app configurator
```

> If env vars are absent, `GiscusComments` renders nothing — safe to deploy without a Giscus repo configured.

---

## Files Changed Summary

| Action | File |
|---|---|
| **NEW** | `src/components/PropertiesPanel.astro` |
| **NEW** | `src/pages/folders/[...path].astro` |
| **NEW** | `src/components/GiscusComments.astro` |
| **NEW** | `migrations/0004_metadata_gin_index.up.sql` |
| **NEW** | `migrations/0004_metadata_gin_index.down.sql` |
| **MODIFY** | `src/components/ContentMeta.astro` |
| **MODIFY** | `src/components/FolderTree.tsx` |
| **MODIFY** | `src/middleware.ts` |
| **MODIFY** | `src/pages/index.astro` |
| **MODIFY** | `.env.example` |

---

## Open Questions Before Proceeding

1. **Folder URL strategy** — `/folders/[path]` vs improving `/?doc=folder:xxx`?
2. **Alias cache TTL** — module-level in-memory cache (60s TTL) or per-request DB query?
3. **Giscus repo** — do you have a GitHub repo with Discussions enabled, or should Giscus be a no-op placeholder for now?


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Fully Implemented | **Feature Track**: Quick Win Usability Enhancements

- [x] Note Properties Panel (`src/components/PropertiesPanel.astro` rendering typed JSONB metadata)
- [x] Dynamic Folder Index Pages (`src/pages/folders/[...path].astro` with breadcrumb navigation and resource cards)
- [x] Dynamic Alias Redirects (canonical alias resolution in `src/pages/index.astro`)
- [x] Giscus comments integration placeholder
