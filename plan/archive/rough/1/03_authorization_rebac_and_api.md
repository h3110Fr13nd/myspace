# 03 - Authorization, ReBAC & Programmatic API

**Module**: 03 Authorization, ReBAC & Programmatic API  
**Parent Plan**: [Master Index](../1.md)

---

## 1. Authorization Core (OpenFGA & Zanzibar Model)

Fine-grained authorization (FGAC) and Relationship-Based Access Control (ReBAC) are enforced via **OpenFGA**, a CNCF open-source authorization engine based on Google Zanzibar.

### Key Inheritance Principles
1. **Hierarchical Allow Union**: Grants defined on parent containers (`space`, `folder`, `canvas`) flow down automatically to child items (`document`, `sheet`, `canvas_node`, `pdf`).
2. **Prioritized Deny Overrides**: Explicit `denied_viewer` bindings immediately block access regardless of higher-level inherited allows.
3. **Exception Principals**: Deny policies support explicit exception lists, enabling scenario rules like "Deny `group:contractors` EXCEPT `user:alice`".

```
                          ┌────────────────────────┐
                          │     Space: Main Space  │
                          │   (allow viewer: userA)│
                          └───────────┬────────────┘
                                      │
                                      ▼
                          ┌────────────────────────┐
                          │    Folder: Legal       │
                          │ (allow viewer: groupX) │
                          └───────────┬────────────┘
                                      │
                                      ▼
                          ┌────────────────────────┐
                          │  Canvas Node: Node #12 │
                          │(deny viewer: userA)    │ <--- Explicit Deny Wins!
                          └────────────────────────┘
```

---

## 2. Programmatic Authorization API Specification

The workspace provides REST and gRPC endpoints for real-time permission management and check evaluations.

### 2.1 Check Permission Endpoint
```http
POST /api/v1/permissions/check
Content-Type: application/json
Authorization: Bearer <service_account_token>

{
  "user": "user:carol",
  "action": "viewer",
  "resource": "sheet:q3_budget"
}
```

**Response**:
```json
{
  "allowed": true,
  "resource": "sheet:q3_budget",
  "user": "user:carol",
  "relation": "viewer",
  "resolution": "inherited_from_folder:finance"
}
```

### 2.2 Grant Permission Endpoint
```http
POST /api/v1/permissions/grant
Content-Type: application/json
Authorization: Bearer <service_account_token>

{
  "resource": "canvas_node:node_99",
  "principal": "group:analysts",
  "role": "editor",
  "effect": "allow"
}
```

### 2.3 Revoke / Deny Permission Endpoint
```http
POST /api/v1/permissions/revoke
Content-Type: application/json
Authorization: Bearer <service_account_token>

{
  "resource": "document:roadmap_2027",
  "principal": "user:dave",
  "role": "viewer",
  "effect": "deny",
  "exceptions": ["user:dave_admin_override"]
}
```

---

## 3. Pivot Notice & Alternatives Matrix

### Pivot Option A: AuthZ Engine — SpiceDB (Authzed)
- **When to Pivot**: If high-concurrency Zanzibar performance requires gRPC-first streaming, or if Google Zanzibar consistency levels (zedtokens) are strictly needed.
- **Comparison**: SpiceDB is functionally very similar to OpenFGA, also open-source (Apache-2.0), written in Go, and PostgreSQL-backed.
- **Migration Cost**: Low (DSL schema converts 1-to-1).

### Pivot Option B: Policy Engine — Cerbos (YAML Policy-as-Code)
- **When to Pivot**: If security policies are written and maintained by non-developer security teams who prefer YAML files over graph relationship tuples.
- **Comparison**: Cerbos relies on ABAC (Attribute-Based Access Control) with context payload attributes rather than graph tuple traversal.
- **Migration Cost**: Moderate.

### Pivot Option C: Hosted Hybrid — Permit.io / OPA (Cedar)
- **When to Pivot**: If a visual policy editor UI with instant audit logs and low-code policy builders is mandated by enterprise governance.
- **Migration Cost**: Moderate.

---

## 4. Next Steps & References
- Review UI Canvas & Sheets integration in [04 Canvas, Sheets & Forms](04_canvas_sheets_forms_nodes.md).
- Review Docker setup for OpenFGA in [05 Local Docker Environment](05_local_docker_environment.md).
