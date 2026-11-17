# 02 - PDF & Media Asset Pipeline

**Module**: 02 PDF & Media Asset Pipeline  
**Parent Plan**: [Master Index](../1.md)

---

## 1. Overview & Security Architecture

Unlike static sites where uploads sit in public directories, all media assets (PDF documents, high-resolution figures, images, audio files) in this system are stored in a private **MinIO (S3-compatible)** bucket. 

No asset is directly accessible without passing through authorization verification.

```
┌──────────────┐     1. Request PDF asset        ┌───────────────────────────────┐
│ Browser Client│ ─────────────────────────────> │ Astro Middleware Stream Proxy │
│ (PDF.js / Web)│                                │ /api/v1/assets/pdf/[id]       │
└──────────────┘                                 └───────────────────────────────┘
       ▲                                                         │
       │                                                         │ 2. Check OpenFGA Permission
       │                                                         ▼
       │                                         ┌───────────────────────────────┐
       │                                         │ OpenFGA Engine                │
       │ 4. Streamed Byte-Ranges / Signed URL    │ (user:X viewer pdf:Y?)        │
       └──────────────────────────────────────── └───────────────────────────────┘
                                                                 │
                                                                 │ 3. Authorized -> Read Object
                                                                 ▼
                                                 ┌───────────────────────────────┐
                                                 │ MinIO Private S3 Storage      │
                                                 │ Bucket: workspace-private     │
                                                 └───────────────────────────────┘
```

---

## 2. Granular PDF Capabilities

### 2.1 PDF Resource Schema & Hierarchy
PDF documents are represented as first-class entries in the `resources` registry:

```json
{
  "id": "pdf:contract_2026_q3",
  "type": "pdf",
  "parentId": "folder:legal_docs",
  "tenantId": "tenant_acme",
  "ownerId": "user:alice",
  "path": "tenant_acme/space_main/folder_legal/pdf_contract_2026_q3",
  "metadata": {
    "fileName": "contract_q3.pdf",
    "pageCount": 42,
    "byteSize": 4194304,
    "mimeType": "application/pdf"
  }
}
```

### 2.2 Client-Side Rendering with PDF.js & `react-pdf`
- **Embedded Document Viewer**: Renders full PDF documents with page navigation, zoom, text search, and text layer selection.
- **Canvas Card Embedded Node**: In spatial canvas boards (JSON Canvas), a node can reference a PDF (`fileType: "pdf"`). The canvas viewer mounts a lightweight PDF.js viewport inside the canvas card node.
- **Dynamic Watermarking**: If a user has `viewer` rights but restricted export rights, the Astro SSR stream proxy injects custom watermarks (e.g. `CONFIDENTIAL - USER ALICE`) directly onto rendered canvas images or PDF layers.

---

## 3. Pivot Notice & Alternatives Matrix

### Pivot Option A: Storage Layer — Ceph / SeaweedFS / Local NVMe Storage
- **When to Pivot**: If MinIO AGPL licensing creates compliance concerns in strict commercial settings, or if petabyte-scale blob storage requires POSIX/block storage integration.
- **Alternatives**:
  1. **SeaweedFS** (Apache-2.0): Extremely fast blob/S3 storage with small file optimization.
  2. **Ceph / Rook** (LGPL-2.1): Kubernetes-native distributed block/file/object storage.
  3. **Local Encryption-at-Rest Storage**: POSIX filesystem with AES-256 encrypted volumes for simple single-node deployments.
- **Migration Cost**: Low (all present standard S3 or POSIX file interfaces).

### Pivot Option B: PDF Engine — Server-side Headless PDF Renderer (Chromium / PDFtk)
- **When to Pivot**: If client-side rendering via PDF.js is too heavy for mobile browsers or low-power client devices.
- **Alternative**: Pre-render PDF pages to PNG/WebP on the server using headless Chrome/PDFium and serve webp images on demand.
- **Migration Cost**: Moderate.

---

## 4. Next Steps & References
- Review authorization model in [03 Authorization, ReBAC & API](03_authorization_rebac_and_api.md).
- Review Canvas node embedding in [04 Canvas, Sheets & Forms](04_canvas_sheets_forms_nodes.md).
