# 08 - Master Pivot Matrix & Architectural Decision Records (ADRs)

**Module**: 08 Master Pivot Matrix & Architectural Decision Records  
**Parent Plan**: [Master Index](../1.md)

---

## 1. Master Architectural Pivot Matrix

This matrix serves as the executive guide for pivoting technology layers if requirements, licensing, performance bottlenecks, or team skills change during implementation.

| Subsystem Layer | Default FOSS Selection | Pivot Trigger / Notice | Alternative Option 1 | Alternative Option 2 | Pivot Impact & Migration Complexity |
|---|---|---|---|---|---|
| **App Framework** | **Astro (SSR)** | Requirement for heavy client state synchronization or team React exclusivity. | Next.js (App Router) | SvelteKit | **Moderate**: Requires component adaptation for MDX research widgets. |
| **Authorization Engine** | **OpenFGA** | Need for strict gRPC-first performance or YAML policy-as-code format. | SpiceDB | Cerbos | **Low**: Data model converts 1-to-1 via relationship tuples. |
| **Object Storage** | **MinIO** | AGPL licensing concerns or petabyte-scale POSIX/block storage requirement. | SeaweedFS | Ceph / Rook | **Low**: Both implement standard S3 API interfaces. |
| **Spreadsheet Engine** | **FortuneSheet** | Need for enterprise formulas, multi-user cursors, or combined document-sheet suites. | Univer | Luckysheet / Handsontable | **Moderate**: Data schema conversion required for cell state payload. |
| **Canvas Engine** | **JSON Canvas Spec + Viewer** | Need for freeform drawing, whiteboarding, or established DAG layout algorithms. | React Flow | tldraw Core | **Low**: Node metadata format remains standard JSON. |
| **Identity Provider** | **Authentik** | Need for cloud-native Go binary or headless API-first identity workflows. | Keycloak | Zitadel / Ory Kratos | **Low**: Standard OIDC protocol guarantees drop-in replacement. |
| **Search Engine** | **Meilisearch** | High RAM consumption or preference for zero external service overhead. | Typesense | PostgreSQL FTS + pgvector | **Low**: Search client wrapper abstracts backend query. |
| **Deployment Target** | **Docker Compose** | High traffic requiring multi-zone failover, pod auto-scaling, or GitOps pipelines. | Kubernetes (Helm) | Docker Swarm / Nomad | **Moderate**: Infrastructure-as-code manifests required. |

---

## 2. Key Architectural Decision Records (ADRs)

### ADR-001: 100% Server-Side Authorization Filtering
- **Decision**: All authorization checks must be performed on the server side prior to rendering HTML or JSON data payloads to clients.
- **Rationale**: Preventing data exposure requires that restricted canvas nodes, sheets, forms, or documents are never sent over the network to unauthorized clients.

### ADR-002: Decoupling Authorization (OpenFGA) from Identity (Authentik)
- **Decision**: Identity provider (Authentik) manages users and group memberships, while OpenFGA manages resource relationship tuples.
- **Rationale**: Separation of concerns allows changing identity providers without refactoring fine-grained resource permission logic.

### ADR-003: First-Class PDF Resource Management
- **Decision**: PDFs are stored in private storage (MinIO) and streamed via authenticated SSR proxy routes with byte-range support.
- **Rationale**: Enables granular page/document access control, dynamic watermarking, and canvas node embedding without exposing static file paths.
