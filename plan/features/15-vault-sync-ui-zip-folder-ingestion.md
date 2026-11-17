# Plan 15: In-Browser Vault Synchronization (ZIP Archive & Folder Ingestion Engine)

## Overview
This specification details the browser-based and programmatic Vault Synchronization Engine that allows users to ingest Obsidian vaults, Quartz markdown repositories, JSON Canvases, PDFs, and image attachments directly into their cloud workspace.

---

## 1. Synchronization Capabilities

### Supported Ingestion Sources
1. **ZIP Archive Upload (`.zip`)**:
   - User drags and drops or selects a `.zip` archive in the UI.
   - Decompressed in-memory on the server using `jszip`.
   - Filters out OS metadata (`.DS_Store`, `__MACOSX`, `.git`).
2. **Recursive Folder Upload (`webkitdirectory`)**:
   - User selects an entire local directory directly from their filesystem using HTML5 folder selection.
   - Preserves relative paths (e.g., `work/projects/architecture.md`).
3. **Headless Programmatic Ingestion (API / cURL / Python)**:
   - Endpoint `POST /api/v1/vault/sync` authenticated via Scoped Personal API Keys (`fsk_live_...`).

---

## 2. File Type Processing Pipeline

```mermaid
graph TD
    A[Incoming Vault Files] --> B{Extension Switch}
    
    B -->|.md / .mdx| C[Markdown Engine]
    C --> C1[Parse YAML Frontmatter]
    C1 --> C2[Extract Slug, Title, Tags, Tier, Draft, Wikilinks]
    C2 --> C3[Upsert into resources & tags & resource_tags]
    C3 --> C4[Write OpenFGA Relationship Tuples]

    B -->|.canvas| D[JSON Canvas Engine]
    D --> D1[Parse Nodes, Edges, Spatial Coordinates]
    D1 --> D2[Insert into resources type='canvas']
    D2 --> D3[Write OpenFGA Relationship Tuples]

    B -->|.pdf / .png / .jpg / .webp| E[Asset Storage Engine]
    E --> E1[Upload Binary to Cloudflare R2 / S3 / MinIO]
    E1 --> E2[Insert into resources type='pdf'|'image']
    E2 --> E3[Write OpenFGA Viewer/Owner Tuples]

    B -->|Directories| F[Folder Hierarchy Engine]
    F --> F1[Create Parent folder Resources in DB]
    F1 --> F2[Write OpenFGA Parent Space Tuples]
```

---

## 3. Database & Storage Mapping

### Resources Table Upsert
- `spaceId`: `space:<vault_name>`
- `folderId`: `folder:<vault_name>_<folder_slug>`
- `docId`: `document:<vault_name>_<slug>`
- `canvasId`: `canvas:<vault_name>_<slug>`
- `assetId`: `<type>:<vault_name>_<slug>`

### Frontmatter Schema Ingested
```yaml
---
title: "Distributed Consensus in 2026"
slug: "distributed-consensus-2026"
tags: ["distributed-systems", "raft", "databases"]
category: "engineering/architecture"
summary: "An in-depth analysis of consensus protocols."
tier: "public" # 'public' or 'free' or 'member'
draft: false
date: "2026-08-25"
aliases: ["consensus-guide", "raft-spec"]
wikilinks: ["document:paxos_spec", "document:byzantine_faults"]
---
```

---

## 4. Implemented Files & UI

- `src/lib/vaultSync.ts`: Core processing library with `extractZipArchive`, `parseFrontmatter`, and `syncVaultFiles`.
- `src/pages/api/v1/vault/sync.ts`: Multipurpose API endpoint handling `multipart/form-data` and `application/zip`.
- `src/pages/vault/sync.astro`: Complete web UI featuring:
  - Drag-and-drop file target.
  - ZIP vs Folder picker buttons.
  - Live progress animation bar.
  - Post-sync metrics dashboard (Documents, Canvases, Media/PDFs, Tags created, Public posts).
  - One-click copyable cURL & Python integration snippets with API key placeholders.


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Fully Implemented | **Feature Track**: Vault Import & Sync Engine

- [x] Drag-and-drop web UI for ZIP archive upload (`src/pages/vault/sync.astro`)
- [x] Recursive folder ingestion via browser webkitdirectory
- [x] Server-side ZIP decompression and stream extraction (`src/lib/vaultSync.ts`)
- [x] Automatic folder hierarchy tree construction and resource records creation
- [x] Scoped Personal API key authentication support (`vault:sync`, `vault:write`)
- [x] Vault ingestion statistics and conflict resolution
