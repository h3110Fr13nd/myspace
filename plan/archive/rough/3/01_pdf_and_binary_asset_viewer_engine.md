# 01 - PDF & Binary Asset Streaming Engine Architecture

**Module**: 01 PDF & Binary Asset Streaming Engine  
**Parent Plan**: [Plan 3 Master Index](../3.md)

---

## 1. Executive Summary & Core Requirements

This module specifies the architecture for rendering **PDF binary assets** and media resources directly inside the main workspace content area.

### Core Architectural Guarantees
1. **Unified Resource Node Model**: PDF files are first-class resource nodes (`type = 'pdf'`) registered in the PostgreSQL `resources` table and OpenFGA graph (`pdf:q3_contract`).
2. **ReBAC Protected S3 Byte Streaming**: PDF binary bytes are fetched through Astro SSR proxy endpoints (`/api/v1/assets/pdf/[id]`) backed by MinIO S3 bucket `workspace-private`. Streaming is authorized via OpenFGA checks.
3. **Main Content Workspace Integration**: Selecting a PDF resource node renders the interactive `PdfViewer` component directly in the main reading area, displaying metadata, title, category tags, executive summary callout, incoming backlinks, and contextual knowledge graph nodes.
4. **Interactive Viewer Controls**: Includes page zooming (50% to 200%), page navigation, and download capabilities.

---

## 2. API & Data Flow Diagram

```
  ┌────────────────────────────────────────────────────────┐
  │ User Browser / Main Workspace Reading Area            │
  └───────────────────────────┬────────────────────────────┘
                              │ GET /api/v1/assets/pdf/q3_contract?as_user=user:demo
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │ Astro SSR Proxy Endpoint (src/pages/api/v1/assets/pdf)│
  │  1. Check OpenFGA ReBAC permission: user:demo viewer  │
  │     pdf:q3_contract                                    │
  │  2. Fetch Object Stream from MinIO (port 9005)         │
  └───────────────────────────┬────────────────────────────┘
                              │ Binary Stream
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │ PdfViewer Component (object / iframe / PDF.js)          │
  └────────────────────────────────────────────────────────┘
```
