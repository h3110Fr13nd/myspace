# Implementation Plan - Revised Open-Source Architecture Plan (plan/initial/rough/1.md)

This plan outlines the creation of a comprehensive architectural document `plan/initial/rough/1.md`. It builds upon `plan/initial/1.md` by transitioning entirely to **100% open-source software (FOSS)**, detailing a **Docker Compose local environment**, establishing a **stable production deployment strategy**, incorporating **PDF handling and access control**, and expanding **programmatic fine-grained authorization (ReBAC/FGAC)** for sheets, docs, forms, JSON canvas nodes, and assets.

## Proposed Changes

### Plan Documentation

#### [NEW] [1.md](file:///home/user/Desktop/dev/blog/template/plan/initial/rough/1.md)

Create a detailed, production-grade architectural plan covering:

1. **100% Open-Source Stack Definition**:
   - **Frontend / SSR Framework**: Astro (SSR mode) with React/Preact islands for interactive UI components.
   - **Content & AST Engine**: `unified` / `remark` / `rehype` pipeline (Quartz-compatible parsing for markdown, wikilinks, frontmatter).
   - **Canvas Render & Editor**: `JSON Canvas` spec parser + open-source Canvas editor/viewer (e.g. `react-json-canvas` / custom SVG-HTML5 canvas renderer / open-source `tldraw` community core or custom node editor without proprietary SDK constraints).
   - **AuthN (Identity)**: Authentik or Keycloak (open-source OIDC/OAuth2/SAML provider).
   - **AuthZ (ReBAC / FGAC Engine)**: OpenFGA (CNCF open-source Zanzibar engine) running locally & in production.
   - **Object Storage**: MinIO (S3-compatible, self-hosted open-source object storage).
   - **Database**: PostgreSQL (with pgvector & full-text search extensions).
   - **Search**: Meilisearch / PostgreSQL FTS with permission-aware search filtering.
   - **PDF Engine**: PDF.js / `react-pdf` for canvas-embedded PDF rendering, page-range access, and server-side PDF stream authorization.
   - **Forms & Sheets**: Open-source JSON Schema form builders (`@rjsf/core`) and canvas sheet grids (`luckysheet` / `fortune-sheet` / custom data-grid nodes).

2. **PDF Integration & Resource Management**:
   - Elevate PDFs to first-class `resources` in the IAM hierarchy (`pdf`, `pdf_page`, `pdf_annotation`).
   - Secure PDF streaming architecture: Node/Astro middleware verifies OpenFGA access before generating signed MinIO URLs or piping byte-range streams.
   - Embedding PDFs inside JSON Canvas nodes (`type: "file"`, `fileType: "pdf"`).

3. **Programmatic Permission Engine (ReBAC / FGAC for Individuals & Groups)**:
   - Unified `resources` registry: docs, canvas nodes, sheets, forms, blocks, PDFs, images.
   - OpenFGA DSL model defining fine-grained relations:
     - `user`, `group`, `service_account` principals.
     - `parent` inheritance (`space -> folder -> document/canvas -> node/sheet/form`).
     - Prioritized Allow and Deny policies with explicit exception lists.
   - Programmatic API & SDK endpoints (`/api/v1/permissions/grant`, `/api/v1/permissions/revoke`, `/api/v1/permissions/check`) for programmatic access management on any node/doc/sheet/form.

4. **Local Infrastructure via Docker Compose**:
   - Complete `docker-compose.yml` service definition (Astro SSR app, OpenFGA, PostgreSQL, MinIO, Authentik/Keycloak, Meilisearch, Traefik proxy).
   - Health checks, network isolation, volume mounts, and environment configuration.

5. **Stable Production Deployment Strategy**:
   - Deployment options: Production Docker Compose with Traefik/TLS + MinIO + Postgres clustering, or Kubernetes Helm manifests.
   - Security hardening (mTLS, non-root containers, secret management via Doppler/Vault/Env).
   - Backup/Restore strategies for Postgres DB, MinIO buckets, and OpenFGA tuple stores.

## Verification Plan

### Automated Verification
- Validate markdown syntax and file structure of `plan/initial/rough/1.md`.
- Verify relative file paths and code block formatting within the document.

### Manual Verification
- Review the generated plan to ensure all user requirements (Open-source, Docker Compose, Stable deployment plan, PDF support, Programmatic FGAC for groups/individuals on docs/canvas nodes/sheets/forms) are fully satisfied.
