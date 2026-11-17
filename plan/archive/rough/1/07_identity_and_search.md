# 07 - Identity Management & Permission-Aware Search

**Module**: 07 Identity Management & Permission-Aware Search  
**Parent Plan**: [Master Index](../1.md)

---

## 1. Identity Authentication & Group Synchronization

Identity management (AuthN) is decoupled from authorization (AuthZ). **Authentik** (or **Keycloak**) acts as the central OpenSource OIDC/OAuth2 Provider.

```
┌─────────────────┐    1. Login (OIDC)    ┌─────────────────────────────────┐
│ User Browser    │ ────────────────────> │ Authentik / Keycloak IDP        │
└─────────────────┘                       └─────────────────────────────────┘
         │                                                 │
         │ 2. Issues JWT (claims: user_id, groups)         │ 3. Sync User & Group Memberships
         ▼                                                 ▼
┌─────────────────┐                       ┌─────────────────────────────────┐
│ Astro Middleware│                       │ OpenFGA Tuple Sync Worker       │
│ Authentication  │                       │ (writes group:X#member@user:Y)  │
└─────────────────┘                       └─────────────────────────────────┘
```

---

## 2. Permission-Aware Search Engine

Traditional search indexes (e.g. static Quartz client indexes) expose metadata publicly. This system mandates **permission-filtered search queries**.

```sql
-- Step 1: Fetch accessible resource IDs for user from OpenFGA
-- OpenFGA ListObjects(user="user:alice", relation="viewer", type="document") -> ["doc_1", "doc_5", "doc_8"]

-- Step 2: Query Meilisearch or PostgreSQL with accessible ID filter
SELECT id, title, ts_headline(content, query) 
FROM documents 
WHERE id IN ('doc_1', 'doc_5', 'doc_8') 
  AND to_tsvector('english', content) @@ to_tsquery('english', 'search_term');
```

---

## 3. Pivot Notice & Alternatives Matrix

### Pivot Option A: Identity Engine — Keycloak vs. Zitadel vs. Ory Kratos
- **When to Pivot**: 
  - **Keycloak** (Apache-2.0): Enterprise battle-tested default, heavy Java footprint.
  - **Zitadel** (Apache-2.0): Cloud-native Go-based OIDC provider with multi-tenancy.
  - **Ory Kratos & Hydra** (Apache-2.0): API-first headless identity framework.
- **Migration Cost**: Low (all export standard OIDC/OAuth2 endpoints).

### Pivot Option B: Search Engine — Meilisearch vs. Typesense vs. PostgreSQL FTS
- **When to Pivot**: If Meilisearch memory usage grows large, or if pure zero-dependency Postgres FTS handles initial scale.
- **Alternatives**:
  1. **Typesense** (GPL-3.0): Extremely fast C++ search engine with built-in ACL filter fields.
  2. **PostgreSQL FTS + pgvector**: Zero extra services required; hybrid lexical + semantic search.
- **Migration Cost**: Low to Moderate.

---

## 4. Next Steps & References
- Review summary matrix in [08 Pivot Matrix & ADRs](08_pivot_matrix_and_adrs.md).
