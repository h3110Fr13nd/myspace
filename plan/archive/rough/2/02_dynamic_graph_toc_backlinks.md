# 02 - Dynamic Quartz Features: Interactive Graph, TOC & Backlinks

**Module**: 02 Dynamic Quartz Features: Interactive Graph, TOC & Backlinks  
**Parent Plan**: [Plan 2 Master Index](../2.md)

---

## 1. Dynamic Interactive Graph View

Quartz statically generates force graphs at build time. In this architecture, the **Graph View is generated dynamically per request** based on the logged-in user's active session permissions.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Dynamic D3.js Force-Directed Graph                        │
│                                                                             │
│         (Doc: Architecture) ─────────────────► (Doc: Storage Engine)        │
│                  │                                    │                     │
│                  ▼                                    ▼                     │
│         (PDF: Contract Q3)                   (Sheet: Financials)            │
│                                                                             │
│ * Nodes rendered dynamically based on OpenFGA ListObjects per user session *│
└─────────────────────────────────────────────────────────────────────────────┘
```

### Features
- **D3.js Force Layout**: Physics-based node repulsion and spring links.
- **Node Filtering**: Restricted resources for the active user are omitted from the graph visualization.

---

## 2. Dynamic Table of Contents (TOC)

- AST heading extractor scans rendered HTML headings (`h1` through `h6`) and builds a collapsible sidebar TOC.
- Active Scroll Spy highlights the currently viewed section as the user scrolls.

---

## 3. Dynamic Backlinks & Forward-links Engine

- **Incoming References**: Scans the database `resources` table for all documents containing wikilinks pointing to the active document (`SELECT * FROM resources WHERE metadata->'wikilinks' ? current_doc_id`).
- Filters incoming backlinks through OpenFGA permissions so private referencing notes are not leaked.
