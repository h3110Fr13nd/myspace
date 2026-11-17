# FOSS Platform — Ground-Up Product Design

## What This Actually Is

A **permission-native publishing platform**. The core primitive is simple:

> **Everything is a resource. Every resource can be allowed or denied to any principal, at any granularity, with inheritance from parent resources.**

This is Google Zanzibar (OpenFGA), applied to a *blog / knowledge base* instead of Google Drive. You are building the permission-aware version of Notion/Substack/Obsidian Publish — where an author controls exactly who sees what, down to a single paragraph block, media file, or PDF.

---

## Mental Model: The Resource Graph

```
Platform (tenant)
 └── Space              ← A named publishing zone ("Research", "Personal Blog")
      ├── Collection     ← Groups of posts ("Deep Learning Series", "Papers 2024")
      │    ├── Post       ← A blog post / article / research note (markdown)
      │    │    ├── Block  ← Optional: named section / callout / embed within a post
      │    │    ├── Media  ← Images / videos embedded in a post
      │    │    └── Asset  ← PDFs, files attached to a post
      │    └── Post ...
      ├── Page            ← Standalone non-series content (About, Landing, etc.)
      ├── Asset           ← Top-level files: PDFs, datasets, etc.
      └── Canvas          ← JSON Canvas board (spatial knowledge graph)
```

Every node is a **Resource row** in PostgreSQL and a **relationship tuple subject** in OpenFGA.

---

## The Zanzibar Permission Model (OpenFGA)

### Relations (Roles)

| Relation        | Inherits From | Meaning                                     |
|-----------------|---------------|---------------------------------------------|
| `owner`         | —             | Full control: edit, delete, grant to others |
| `editor`        | `owner`       | Read + write content                        |
| `commenter`     | `viewer`      | Read + leave comments                       |
| `viewer`        | —             | Read-only access                            |
| `denied_viewer` | —             | **Explicit deny**: beats all inherited allows |

### Hierarchy Inheritance

```
Space viewer ──inherits──▶ Collection viewer ──inherits──▶ Post viewer
                                                             └── Asset viewer
```

A `denied_viewer` on any resource **overrides all inherited allows**, regardless of what parent says.

### Evaluation Algorithm (Deny > Allow > Default-Deny)

1. Walk the resource ancestor chain, collecting all tuples matching the user (direct, via group, via inherited role).
2. If ANY `denied_viewer` tuple matches → **DENY** (always wins, no exceptions).
3. Otherwise if any `viewer` or higher tuple matches → **ALLOW**.
4. Default: **DENY**.

---

## Principal Types

```
user:<email>            # Authenticated Google OAuth user
user:public             # Unauthenticated / anonymous visitor
group:<slug>            # User group (e.g. group:subscribers, group:team)
service_account:<id>    # API integrations, bots, export jobs
```

Examples:
- **Public post**: `viewer: user:public` → anyone reads it
- **Subscriber-only series**: `viewer: group:subscribers` on Collection
- **Draft**: no `viewer` tuple → only `owner/editor` can see it
- **Hidden from one person**: `denied_viewer: user:dummy_mail` on that Post

---

## User Stories

### 🖊️ Author (owns a Space)

1. Create a post → starts as draft (no viewer tuples)
2. Publish publicly → write `viewer: user:public` on the Post
3. Publish to subscribers only → write `viewer: group:subscribers` instead
4. Keep a Collection private → no viewer tuple → only me
5. Attach a PDF → PDF Resource inherits Post's viewer automatically
6. Revoke one reader → write `denied_viewer: user:dummy_mail` on the Post
7. Collaborate → write `editor: user:dummy_mail` on Collection
8. Embed a canvas board → Canvas Resource, viewer inherits from parent Collection

### 👤 Reader (authenticated)

1. Browse a Space → list-objects query returns only posts they have `viewer` on
2. Read a post → SSR middleware checks `viewer` before rendering
3. Search → Meilisearch pre-filtered by accessible post IDs
4. See paywall → viewer check fails → teaser page, not content
5. Comment → requires `commenter` relation

### 🌐 Anonymous Visitor (`user:public`)

1. Read a published post → `viewer: user:public` exists → full content
2. Hit a subscriber post → `viewer: user:public` absent → paywall/teaser page
3. Search → only `user:public` viewable posts appear

### 🛡️ Admin (IAM Console)

1. View all resources → `/admin/iam` resource tree
2. Inspect tuples for a resource → click any resource → list allow/deny tuples
3. Grant or revoke → add/delete tuple (user, relation, resource)
4. Effective permissions view → "What can user X do?" (OpenFGA list-objects)
5. Manage groups → create groups, add/remove members

---

## URL Routing

```
/                                          # Home: list accessible Spaces
/s/<space-slug>                            # Space index: Collections + standalone Posts
/s/<space-slug>/<post-slug>                # Post reader
/s/<space-slug>/<collection-slug>/         # Collection index
/s/<space-slug>/<collection-slug>/<post>   # Post in Collection
/canvas/<canvas-slug>                      # Canvas board viewer
/assets/<asset-id>                         # Authenticated asset proxy (MinIO + FGA check)
/search                                    # Permission-filtered search
/write                                     # New post editor (auth required)
/write/<post-id>                           # Edit existing post
/admin/iam                                 # IAM console
/admin/groups                              # Group management
/login                                     # Google OAuth
/logout                                    # Clear session
```

---

## PostgreSQL Schema (Target)

```sql
CREATE TABLE resources (
  id           TEXT PRIMARY KEY,            -- "post:my-slug", "pdf:paper-2024"
  type         TEXT NOT NULL,               -- space|collection|post|page|asset|canvas|media|block
  slug         TEXT,
  title        TEXT NOT NULL,
  parent_id    TEXT REFERENCES resources(id) ON DELETE CASCADE,
  owner_id     TEXT NOT NULL REFERENCES users(id),
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  path         TEXT,                        -- "space:blog/collection:dl/post:gpt5"
  is_public    BOOLEAN NOT NULL DEFAULT FALSE,
  content_ref  TEXT,                        -- MinIO object key for markdown/file body
  metadata     JSONB NOT NULL DEFAULT '{}', -- tags, cover_image, reading_time, etc.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ                  -- NULL = draft
);

CREATE TABLE users (
  id           TEXT PRIMARY KEY,            -- "user:dummy_mail"
  email        TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE groups (
  id         TEXT PRIMARY KEY,              -- "group:subscribers"
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_memberships (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE comments (
  id          SERIAL PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## OpenFGA Model (Target authz/model.fga)

```
model
  schema 1.1

type user
type service_account

type group
  relations
    define member: [user, group#member]

type space
  relations
    define owner: [user, service_account]
    define editor: [user, group#member, service_account] or owner
    define commenter: [user, group#member] or editor
    define viewer: [user, group#member, service_account] or commenter
    define denied_viewer: [user, group#member]

type collection
  relations
    define parent: [space]
    define owner: [user, service_account] or owner from parent
    define editor: [user, group#member, service_account] or owner or editor from parent
    define commenter: [user, group#member] or editor or commenter from parent
    define viewer: [user, group#member, service_account] or commenter or viewer from parent
    define denied_viewer: [user, group#member]

type post
  relations
    define parent: [collection, space]
    define owner: [user, service_account] or owner from parent
    define editor: [user, group#member, service_account] or owner or editor from parent
    define commenter: [user, group#member] or editor or commenter from parent
    define viewer: [user, group#member, service_account] or commenter or viewer from parent
    define denied_viewer: [user, group#member]

type asset
  relations
    define parent: [post, collection, space]
    define owner: [user, service_account] or owner from parent
    define editor: [user, group#member, service_account] or owner or editor from parent
    define viewer: [user, group#member, service_account] or editor or viewer from parent
    define denied_viewer: [user, group#member]

type canvas
  relations
    define parent: [collection, space]
    define owner: [user, service_account] or owner from parent
    define editor: [user, group#member, service_account] or owner or editor from parent
    define viewer: [user, group#member, service_account] or editor or viewer from parent
    define denied_viewer: [user, group#member]
```

---

## Middleware Permission Logic

```typescript
// For every /s/<space>/<post> request:
const isDenied = await fga.check({ user, relation: 'denied_viewer', object: `post:${slug}` });
const canView  = await fga.check({ user, relation: 'viewer',        object: `post:${slug}` });

if (isDenied || !canView) {
  // Render paywall / teaser. NEVER serialize content to the response.
  return renderPaywall(post.title, post.teaserText);
}
// Only here does content go into the HTML response
```

**Rule**: Permission check happens server-side before content is serialized. Never send restricted content to the client and hide it with CSS.

---

## Implementation Phases

### Phase 1 — Foundation
- [ ] New `resources` schema migration (slugs, `is_public`, `published_at`, `content_ref`)
- [ ] Deploy new OpenFGA model
- [ ] Routes: Space index, Collection index, Post reader
- [ ] Markdown render: frontmatter, wikilinks, callouts, KaTeX, Shiki
- [ ] Middleware: `denied_viewer` + `viewer` check on every content route
- [ ] Asset proxy: `/assets/<id>` checks FGA, streams from MinIO (signed URL)
- [ ] `user:public` semantics: `is_public` toggle writes/deletes the tuple

### Phase 2 — Publishing Workflow
- [ ] `/write` markdown editor with live preview
- [ ] Draft/publish toggle
- [ ] Group management + subscriber groups
- [ ] Comment system

### Phase 3 — IAM Console
- [ ] Resource tree + tuple inspector
- [ ] Grant/revoke UI → `writeTuple` / `deleteTuple`
- [ ] "Effective permissions" viewer (OpenFGA list-objects per user)
- [ ] Audit log

### Phase 4 — Discovery
- [ ] Meilisearch indexer (only index `user:public viewer` posts)
- [ ] Per-user search (FGA-filtered)
- [ ] RSS feed (public posts only)
- [ ] SEO: Open Graph, sitemap (public only)
