# 06 - Multi-Tenant User Storage Engine & Subfolder Permission Delegation

**Module**: 06 Multi-Tenant User Storage Engine & Subfolder Permission Delegation  
**Parent Plan**: [Plan 2 Master Index](../2.md)

---

## 1. Executive Summary & Core Principles

This module defines the **Multi-Tenant User Storage Engine** and **Subfolder Access Control System**. It establishes how user content (Markdown documents, JSON Canvas files, FortuneSheet data grids, dynamic forms, PDFs, and uploaded media) is stored, path-managed, and programmatically permissioned.

### Core Architectural Guarantees
1. **Zero Dummy/Fallback Execution**: All authorization evaluations hit the live OpenFGA engine (`http://localhost:8085`), all metadata is queried from PostgreSQL (`localhost:5435`), and all file assets are streamed from MinIO S3 (`http://localhost:9005`).
2. **User Personal Root Folders**: Every user is assigned a personal root folder (`folder:user_<user_id>_root`) with full owner control.
3. **Subfolders as First-Class Resource Nodes**: Subfolders are individual rows in the `resources` table (`type = 'folder'`) and nodes in the OpenFGA authorization graph (`type folder`).
4. **Delegated Subfolder Access**: Users can delegate `editor` or `viewer` access to specific subfolders for individual users or groups. All nested child resources automatically inherit this access via OpenFGA Zanzibar tuple-to-userset propagation.
5. **Prioritized Deny Overrides**: Subfolder owners can attach explicit `denied_viewer` bindings on specific subfolders or leaf resources to override inherited access.

---

## 2. Storage Directory & Materialized Path Schema

### 2.1 MinIO S3 Object Key Conventions
Assets uploaded by users follow structured S3 key paths inside the private `workspace-private` bucket:

```
workspace-private/
  ├── users/
  │     ├── user_alice/
  │     │     ├── root/
  │     │     │     ├── projects/
  │     │     │     │     ├── 2026/
  │     │     │     │     │     ├── q3_contract.pdf
  │     │     │     │     │     └── financial_q3.sheet
  │     │     │     │     └── design/
  │     │     │     │           └── spatial_board.canvas
  │     │     └── uploads/
  │     │           └── header_image.png
  │     └── user_bob/
  │           └── root/
  │                 └── contractor_roadmap.md
```

### 2.2 Materialized Path Database Registry (`resources` table)

```sql
-- Example SQL rows demonstrating subfolder inheritance lineage
INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title) VALUES
  ('folder:alice_root', 'folder', 'tenant_acme', NULL, 'user:alice', 'folder:alice_root', 'DUMMY_NAME Root Vault'),
  ('folder:projects', 'folder', 'tenant_acme', 'folder:alice_root', 'user:alice', 'folder:alice_root/folder:projects', 'Projects 2026'),
  ('folder:financial_subfolder', 'folder', 'tenant_acme', 'folder:projects', 'user:alice', 'folder:alice_root/folder:projects/folder:financial_subfolder', 'Financial Reports Subfolder'),
  ('pdf:q3_contract', 'pdf', 'tenant_acme', 'folder:financial_subfolder', 'user:alice', 'folder:alice_root/folder:projects/folder:financial_subfolder/pdf:q3_contract', 'Q3 Contract PDF'),
  ('sheet:financial_q3', 'sheet', 'tenant_acme', 'folder:financial_subfolder', 'user:alice', 'folder:alice_root/folder:projects/folder:financial_subfolder/sheet:financial_q3', 'Financial Q3 Data Grid');
```

---

## 3. Subfolder Permission Delegation Engine

### 3.1 OpenFGA Relationship Tuples for Delegation

When `user:alice` delegates viewer access on `folder:financial_subfolder` to `group:finance_team`, the system writes a single OpenFGA relationship tuple:

```json
{
  "user": "group:finance_team#member",
  "relation": "viewer",
  "object": "folder:financial_subfolder"
}
```

### 3.2 Downward Inheritance Flow via OpenFGA TupleToUserset

Because the OpenFGA DSL defines:

```dsl
type document
  relation parent_folder: [folder]
  relation viewer: [user, group#member] or tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } }

type pdf
  relation parent_folder: [folder]
  relation viewer: [user, group#member] or tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } }

type sheet
  relation parent_folder: [folder]
  relation viewer: [user, group#member] or tupleToUserset: { tupleset: { relation: 'parent_folder' }, computedUserset: { relation: 'viewer' } }
```

Writing `folder:financial_subfolder` parent relationship tuples:
- `user:folder:financial_subfolder#parent_folder@pdf:q3_contract`
- `user:folder:financial_subfolder#parent_folder@sheet:financial_q3`

**automatically grants `group:finance_team` viewer access to `pdf:q3_contract` and `sheet:financial_q3` without needing individual per-file database updates!**

---

## 4. Zero-Placeholder Code Refactoring Implementation

1. **`src/lib/openfga.ts`**: Set default `OPENFGA_API_URL` to `http://localhost:8085`. Remove mock boolean overrides. If OpenFGA fails, return real error responses.
2. **`src/lib/storage.ts`**: Set default `MINIO_ENDPOINT` to `http://localhost:9005`. Direct S3 client connection.
3. **`src/pages/api/v1/assets/pdf/[id].ts`**: Fetch actual object stream from MinIO bucket `workspace-private`.
