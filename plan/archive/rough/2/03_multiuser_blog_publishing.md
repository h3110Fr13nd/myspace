# 03 - Multi-User Blog Publishing & Vault Spaces

**Module**: 03 Multi-User Blog Publishing & Vault Spaces  
**Parent Plan**: [Plan 2 Master Index](../2.md)

---

## 1. Multi-Tenant User Spaces

Every user in the system receives a dedicated content space (`space:user_<id>`). Users can create multiple public or private blogs, technical digital gardens, or team documentation hubs.

```
/blogs/
  ├── alice/ (User Space: space:user_alice)
  │     ├── architecture-2026.md [Public]
  │     └── internal-notes.md [Private]
  └── bob/ (User Space: space:user_bob)
        └── contractor-roadmap.md [Group: Engineers]
```

---

## 2. Publishing Workflow & RSS/Atom Feed Generation

1. **Draft State**: Saved to database, visible only to author.
2. **Publish Action**: Author triggers "Publish Blog Post". Astro SSR updates OpenFGA relation tuple `user:*#viewer@document:post_id`.
3. **RSS / Atom Feed**: Dynamically generated per user at `/blogs/[user_id]/feed.xml`.
