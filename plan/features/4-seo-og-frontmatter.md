# Frontmatter, SEO, and social metadata

> **Status (2026-11-10): partially implemented.** This file began as a proposal;
> the current implementation record is at the end. The per-resource social
> image path uses an on-demand endpoint rather than build-time SSG generation.
> Metadata schemas are applied to shared create, save, and vault-sync write
> paths. Current repository content was checked against the importer shape.

---

## 🔎 What We Learned From Quartz's Source

Studying `inspiration/quartz/quartz/components/Head.tsx` and `plugins/loader/conditions.ts` reveals a clean, robust pattern for frontmatter-driven SEO and social card generation. Key observations:

### Quartz Frontmatter Field Set
From `Head.tsx` and `conditions.ts`, Quartz reads these frontmatter fields per document:

| Field | Used For |
|-------|---------|
| `title` | Page `<title>`, `og:title`, `twitter:title` |
| `description` | `meta[name=description]`, `og:description`, `twitter:description` |
| `socialDescription` | Overrides `description` for social cards specifically |
| `tags` | Filterable taxonomy; used by `has-tags` condition matcher |
| `date` | Displayed via `<Date>` component; used for sorting |
| `aliases` | Alternate slugs/routes for the same content |
| `draft` | Filtered by `QuartzFilter` — excludes from published index |

Quartz also supports a **`CustomOgImages` emitter plugin** that generates static OG PNG images per page at build time (using satori/canvas). Their `og:image` fallback is a single `static/og-image.png` when the custom emitter isn't active.

### Our Equivalent: `metadata` JSONB Field
In our system everything is a resource node. The `metadata` JSONB column in `resources` is the equivalent of frontmatter, but it's live/dynamic and queryable. We should standardize the fields we store per type.

---

## Original proposal (historical; current status is at the end)

The tasks in this section are preserved to document the initial design. Their
unchecked boxes are not a current work queue; the audited implementation status
below records what is shipped, deferred, or still missing.

### 1. Standardize Frontmatter → `metadata` Field Contract

Define and document the canonical frontmatter fields per resource type:

```yaml
# All resource types (minimum set)
title: string                 # h1 / page title
description: string           # meta description
socialDescription?: string    # OG-specific override (if different from description)
tags: string[]                # taxonomy
draft: boolean                # excluded from all public indexes if true
date?: ISO-8601               # publication date
updatedAt?: ISO-8601          # last updated
aliases?: string[]            # alternate slugs

# document / blog / pdf specific
author?: string
category?: string
summary?: string              # short excerpt (used in search snippets)
wikilinks?: string[]          # outgoing [[links]]
tier?: 'free' | 'subscriber' | 'restricted'

# blog / pdf "shadow resource" attachment
attachedResourceId?: string   # e.g. "pdf:q3-report"
displayMode?: 'inline' | 'pdf-embed' | 'download'

# canvas / canvas_node
embeddedResourceId?: string   # resource this node represents
position?: { x: number, y: number, w: number, h: number }
connectedTo?: string[]        # IDs of connected nodes

# collection
members?: string[]            # IDs of member resources
sortOrder?: 'manual' | 'date' | 'alpha'
```

**Task:** Add a `metadata.schema.ts` under `src/lib/types/` with Zod schemas for each resource type. Validate on sync and on API write.

---

### 2. SEO Card Generation — Per-Resource Dynamic `<head>` 

**Inspired by Quartz `Head.tsx` — field priority chain:**

```
og:description priority:
  frontmatter.socialDescription
  ?? frontmatter.description
  ?? auto-generated excerpt (first 160 chars of body)
  ?? site default
```

**Tasks:**
- [ ] Create `src/components/ResourceHead.astro` — accepts a `resource` row and generates full SEO head:
  - `<title>`, `meta[name=description]`
  - `og:title`, `og:description`, `og:type`, `og:url`, `og:image`
  - `twitter:card` (summary_large_image), `twitter:title`, `twitter:description`, `twitter:image`
  - `link[rel=canonical]`
- [ ] Use `metadata.description` → `metadata.summary` → auto-excerpt fallback chain
- [ ] Replace inline `<head>` blocks in `index.astro`, `blogs/[user]/index.astro` with `<ResourceHead resource={activeDoc} />`

---

### 3. Static OG Image Generation (SSG Emitter Pattern from Quartz)

Quartz uses a `CustomOgImages` emitter that generates one PNG per page at build time via `satori` (JSX → SVG → PNG). We can replicate this as a Astro integration or build script.

**Approach:**

```
scripts/generate_og_images.ts
  → reads resources table
  → for each document/blog with is_public=true or explicit og_image request
  → renders a template (title + author + site logo + gradient bg) via satori
  → writes PNG to public/og/{resource-id}.png
  → updates resources.metadata.ogImage = "/og/{resource-id}.png"
```

**Tasks:**
- [ ] Install `satori`, `@resvg/resvg-js` as dev deps
- [ ] Create `scripts/generate_og_images.ts` with a JSX template for the OG card design
- [ ] Hook into `npm run build` via `astro:build:done` integration hook
- [ ] Serve from `public/og/` (static, no auth needed — OG scrapers don't send cookies)
- [ ] `ResourceHead.astro`: use `metadata.ogImage ?? /static/og-default.png` for og:image

**OG Card Design Spec (inspired by modern ghost/quartz style):**
- 1200×630px dark gradient background matching site palette
- Resource title (large, bold, white)
- Author display name + resource type badge
- Site logo + "FOSS Workspace" wordmark bottom-right
- Tags as chips bottom-left

---

### 4. TODO as a Resource Type ✅

Per the system model: **a TODO/task is itself a resource node**. This means:

- Type: `document` with `metadata.resourceKind = 'todo'` (or a dedicated `todo` type)
- It can be linked to any other resource via `metadata.wikilinks`
- It can be assigned via OpenFGA tuples: `user:X` → `submitter` → `todo:task-123`
- It can have `metadata.status: 'open' | 'in-progress' | 'done' | 'blocked'`
- It can be part of a `collection:sprint-1` resource
- The graph view will show todos as nodes connected to the resources they reference

**Future task:** Add a `todo` resource type to the sync pipeline and a `/todos` page that renders the task graph filtered by `status` and `assignee`.

---

### 5. Sitemap + RSS Feed with Frontmatter Data

**Tasks:**
- [ ] `src/pages/sitemap.xml.ts` — query all `is_public=true` resources, generate XML sitemap with `<lastmod>` from `updated_at`
- [ ] `src/pages/blogs/[user]/feed.xml.ts` — generate per-user Atom/RSS feed from their `blog` + `document` resources, using `metadata.title`, `metadata.description`, `metadata.date`
- [ ] Include `<media:content>` for image-type resources

---

### 6. `draft` Flag Support in Sync and Rendering

From Quartz: `draft: true` in frontmatter excludes a file from the published content index.

**Tasks:**
- [ ] Add `is_draft BOOLEAN DEFAULT FALSE` column to `resources` table migration
- [ ] `sync_vault.ts`: read `draft:` from YAML frontmatter, set `is_draft = true` on the record
- [ ] Filter `is_draft = true` resources from: search results, blog index, graph view, sitemap, RSS
- [ ] `/admin` page shows draft resources to owner only

---

## References

- Quartz `Head.tsx`: [`inspiration/quartz/quartz/components/Head.tsx`](file:///home/user/Desktop/dev/blog/template/inspiration/quartz/quartz/components/Head.tsx)
- Quartz `conditions.ts` (frontmatter-based conditional rendering): [`inspiration/quartz/quartz/plugins/loader/conditions.ts`](file:///home/user/Desktop/dev/blog/template/inspiration/quartz/quartz/plugins/loader/conditions.ts)
- Quartz `matchers.ts` (frontmatter matchers): [`inspiration/quartz/quartz/plugins/pageTypes/matchers.ts`](file:///home/user/Desktop/dev/blog/template/inspiration/quartz/quartz/plugins/pageTypes/matchers.ts)
- Quartz `cfg.ts` (global config including baseUrl for OG): [`inspiration/quartz/quartz/cfg.ts`](file:///home/user/Desktop/dev/blog/template/inspiration/quartz/quartz/cfg.ts)


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🟡 Core SEO, feeds, and metadata validation shipped; dedicated
static OG generation and Todos remain deferred | **Feature Track**: SEO & OpenGraph Generation

- [x] Typed metadata schema definitions in `src/lib/types/metadata.schema.ts`
      and validation in shared create, save, and vault-sync write paths
- [x] Dynamic OpenGraph image generator API endpoint (`src/pages/api/v1/og.png.ts`)
- [x] ResourceHead SEO tags component (`ResourceHead.astro` with canonical URL, Twitter card, OG tags)
- [x] Canonical URL resolution and query-parameter stripping (`canonicalFromUrl`)
- [x] Automated title, description, and summary fallback cascades
- [x] Public sitemap and global/per-user RSS feeds
- [~] Draft/public/unlisted filtering on sitemap and feeds (implemented in SQL; keep parity covered by tests)
- [ ] Build-time static OG image generation — deferred while the dynamic OG
      endpoint meets current sharing needs; revisit only if measured crawl or
      request cost justifies a generated asset pipeline.
- [ ] Dedicated `/todos` workflow — `TodoMetadataSchema` exists, but no dedicated
      task UI or lifecycle is currently part of the supported product goal.
