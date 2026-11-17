# Master Architecture & Implementation Plans Index

Welcome to the **FOSS Content Workspace Architecture & Planning Directory**. This directory houses the comprehensive architectural specifications, system designs, feature roadmaps, implementation audits, and historical design records for the platform.

---

## 🏛️ Directory Taxonomy & Governance

The planning directory is organized into distinct categories based on architectural maturity, implementation status, feasibility, and system priority:

```
plan/
├── README.md                     # Master index & categorization guide (this document)
├── core-architecture/            # Fundamental system architecture, security & foundational design
├── features/                     # Implemented, active & production-ready feature specifications
├── future-roadmap/               # High-impact future initiatives & competitive evaluations
├── deferred-low-priority/        # Rescheduled / deferred tracks (e.g., SPA router vs. SSR-first)
└── archive/                      # Historical records, initial brainstorming & superseded audit snapshots
```

### Categorization Criteria

1. **`core-architecture/`**
   - **Criteria**: Foundational design patterns that govern the entire workspace lifecycle. Must be strictly adhered to across all modules.
   - **Key Themes**: "Everything is a Resource" (EiaR) graph polymorphism, OpenFGA Relationship-Based Access Control (ReBAC), Multi-Provider AuthN, Scoped API Keys, Cloud-Native Zero-Inbound deployment, and Unified UI Design Systems.
2. **`features/`**
   - **Criteria**: Detailed specifications for features that are either actively deployed in production or fully implemented in the current codebase.
   - **Key Themes**: WYSIWYG editor (Novel/TipTap), Spatial Canvas Studio (JSON Canvas v1.0), Google Drive sync, ZIP/folder vault ingestion, SEO/OpenGraph engines, and E2E test suites.
3. **`future-roadmap/`**
   - **Criteria**: High-value forward-looking capabilities, evolutionary scale benchmarks, and comparative studies against industry benchmarks (Notion, Obsidian, Miro, FigJam).
   - **Key Themes**: 100k+ node WebGL graph engine, Cloudflare Durable Objects + Yjs real-time multiplayer collaboration, deep bi-directional Google Docs/Sheets AST sync, and generative canvas workflows.
4. **`deferred-low-priority/`**
   - **Criteria**: Ideas, feature proposals, or approaches that were evaluated and intentionally deferred due to architectural trade-offs, stability risks, or alternative paradigms.
   - **Special Notice on SPA Navigation**: Client-side DOM morphing (`micromorph` / Swup router) was intentionally **deferred to a distant future milestone after product stability**. The system prioritizes deterministic Server-Side Rendering (SSR) via Astro with isolated React interactive islands to prevent React island hydration desync, eliminate client-side parsing overhead, and guarantee per-request OpenFGA ReBAC enforcement.
5. **`archive/`**
   - **Criteria**: Early exploratory notes, initial scratch sessions, historical baseline audits (e.g., Phase 1 snapshot in `18-historical-audit-plan.md`), and raw draft notes. Retained for provenance and context.

---

## 📑 Master Plans Table

| Document | Category | Scope / Core Concept | Implementation Status |
|:---|:---|:---|:---:|
| [5-everything-is-a-resource-architecture.md](core-architecture/5-everything-is-a-resource-architecture.md) | `core-architecture` | Universal Resource Node polymorphism & typed JSONB metadata | ✅ Active Standard |
| [14-multi-provider-auth-account-linking.md](core-architecture/14-multi-provider-auth-account-linking.md) | `core-architecture` | Google OAuth 2.0 PKCE, bcrypt credentials, and ReBAC vault provisioning | ✅ Fully Implemented |
| [16-scoped-personal-api-keys-system.md](core-architecture/16-scoped-personal-api-keys-system.md) | `core-architecture` | SHA-256 scoped token delegation (`fsk_live_...`) with rolling secrets | ✅ Fully Implemented |
| [17-cloud-native-r2-zero-inbound-tunnel-architecture.md](core-architecture/17-cloud-native-r2-zero-inbound-tunnel-architecture.md) | `core-architecture` | Zero-inbound Cloudflare Tunnel & Agnostic S3/R2 storage client | ✅ Fully Implemented |
| [28-ui-ux-system-redesign.md](core-architecture/28-ui-ux-system-redesign.md) | `core-architecture` | Historical UI audit; current design rules live in `docs/design-system.md` | 📜 Historical audit |
| [31-iam-access-visibility-and-policy-troubleshooter.md](core-architecture/31-iam-access-visibility-and-policy-troubleshooter.md) | `core-architecture` | **Access Control Architecture** — closes 4 verified auth bypasses, three-plane ReBAC design (`read_acl`/`manage_grants` capabilities, live inheritance, explicit deny precedence), Notion/Confluence-grade Share + "Shared by me" UX | ✅ Shipped · 6 vulns closed, caveats resolved, opaque ids, ACL projection, 46/46 engine assertions |
| [32-observability-and-telemetry-stack.md](core-architecture/32-observability-and-telemetry-stack.md) | `core-architecture` | **Observability & Telemetry** — local-first `infra` profile (Alloy + Prometheus + Loki + Tempo + Alertmanager + Grafana) with zero-click file provisioning, an opt-in OTel trace path, a fail-closed `/metrics` endpoint, and a documented migration to hosted backends | ✅ Phases 1–2 Shipped · error dashboard, delivery-ready alerts, degraded-mode counters |
| [4-seo-og-frontmatter.md](features/4-seo-og-frontmatter.md) | `features` | Resource SEO, dynamic OG images, sitemap, and RSS | 🟡 Core flows and write-path metadata validation shipped · static OG and dedicated Todos deferred |
| [6-canvas-builder-viewer.md](features/6-canvas-builder-viewer.md) | `features` | Obsidian JSON Canvas v1.0 viewer & pan/zoom matrix renderer | ✅ Fully Implemented |
| [8-google-drive-integration.md](features/8-google-drive-integration.md) | `features` | Google Drive listing/import, viewer, and OAuth token broker | 🟡 Core shipped · external permission sync deferred |
| [13-novel-tiptap-wysiwyg-editor.md](features/13-novel-tiptap-wysiwyg-editor.md) | `features` | TipTap WYSIWYG note authoring with slash commands & OFM serializer | ✅ Fully Implemented |
| [15-vault-sync-ui-zip-folder-ingestion.md](features/15-vault-sync-ui-zip-folder-ingestion.md) | `features` | Web drag-and-drop ZIP extraction and recursive folder sync | ✅ Fully Implemented |
| [19-easy-wins-implementation.md](features/19-easy-wins-implementation.md) | `features` | Note Properties Panel, dynamic folder index pages, and alias routing | ✅ Fully Implemented |
| [20-e2e-testing-suite.md](features/20-e2e-testing-suite.md) | `features` | Playwright test configuration with Testcontainers isolation | ✅ 100 pass / 1 destructive skip locally · CI runner still open |
| [21-canvas-editor-creator-studio.md](features/21-canvas-editor-creator-studio.md) | `features` | Dedicated `/studio/canvas/[id]` spatial creation workspace & Excalidraw | ✅ Fully Implemented |
| [9-pending-tasks-feature-gaps.md](future-roadmap/9-pending-tasks-feature-gaps.md) | `future-roadmap` | Selective Quartz compatibility audit with shipped, deferred, and remaining gaps | 🟡 Ongoing Audit |
| [10-comparison-notion.md](future-roadmap/10-comparison-notion.md) | `future-roadmap` | Architectural comparison and differentiation against Notion | 🔍 Comparative Study |
| [11-comparison-obsidian.md](future-roadmap/11-comparison-obsidian.md) | `future-roadmap` | Architectural comparison and differentiation against Obsidian | 🔍 Comparative Study |
| [12-easy-wins-roadmap.md](future-roadmap/12-easy-wins-roadmap.md) | `future-roadmap` | Complexity-ranked roadmap for incremental usability enhancements | 🟡 Phase 1 Completed |
| [22-massive-scale-100k-graph-architecture.md](future-roadmap/22-massive-scale-100k-graph-architecture.md) | `future-roadmap` | WebGL GPU instancing & WebGPU compute shaders for 100k+ node graphs | 🔭 Future Roadmap |
| [33-graph-canvas-typed-relationships.md](future-roadmap/33-graph-canvas-typed-relationships.md) | `future-roadmap` | First-class relationship resources, reusable link parser, Graph View and Canvas integration | 📝 Proposal |
| [23-canvas-performance-and-feature-roadmap.md](future-roadmap/23-canvas-performance-and-feature-roadmap.md) | `future-roadmap` | Canvas rendering performance benchmarks, spatial clustering, and sub-canvases | 🔭 Future Roadmap |
| [24-cloudflare-durable-objects-collaboration-architecture.md](future-roadmap/24-cloudflare-durable-objects-collaboration-architecture.md) | `future-roadmap` | Cloudflare DO + Yjs CRDT real-time multiplayer synchronization | 🔭 Future Roadmap |
| [25-next-gen-wysiwyg-component-editor-architecture.md](future-roadmap/25-next-gen-wysiwyg-component-editor-architecture.md) | `future-roadmap` | Tri-Mode editing, custom block extensions, and embedded dynamic nodes | 🔭 Active Evolution |
| [26-google-docs-and-sheets-deep-integration.md](future-roadmap/26-google-docs-and-sheets-deep-integration.md) | `future-roadmap` | Google Sheets API v4 tabular data ingestion & Google Docs bi-directional sync | 🔭 Phases 1-2 Active |
| [27-comparison-miro-figjam-and-canvas-evolution.md](future-roadmap/27-comparison-miro-figjam-and-canvas-evolution.md) | `future-roadmap` | Spatial whiteboard comparison and advanced facilitation roadmap | 🔍 Comparative Study |
| [32-platform-reference-content.md](future-roadmap/32-platform-reference-content.md) | `future-roadmap` | Decision doc: what the 175 `service_account:system` resources should *be* — first-run tour, public docs, templates, or a labelled sample vault | ✅ Option B shipped — `space:docs` |
| [stacked-pages-architecture.md](future-roadmap/stacked-pages-architecture.md) | `future-roadmap` | Andy Matuschak horizontal sliding note column layout | 🔭 Deferred (Post-v1.0) |
| [7-quartz-feature-gaps-todo.md](deferred-low-priority/7-quartz-feature-gaps-todo.md) | `deferred-low-priority` | Quartz feature gap audit (SPA router explicitly deferred to favor SSR) | 🟡 Deferred / Selective |
| [18-historical-audit-plan.md](archive/18-historical-audit-plan.md) | `archive` | Phase 1 baseline audit snapshot (~35% coverage baseline, now superseded) | 📜 Historical Snapshot |
| `archive/01` to `archive/05-early-session-notes.md` | `archive` | Early design sessions, Zanzibar mappings, and initial SSR framework selection | 📜 Historical Sessions |
| `archive/rough/` & `archive/issues/` | `archive` | Preliminary rough drafts, pivot matrices, and resolved security issue logs | 📜 Historical Drafts |

---

## 🧭 Design Principles & Standards

Every implementation plan follows the workspace core standards:
1. **Security First (ReBAC)**: Fine-grained OpenFGA relationship tuples are checked at every layer (SSR route, API handler, graph node render, and canvas node embed).
2. **SSR-First Delivery**: Content arrives from Astro pre-parsed with syntax highlighting and KaTeX formulas. Client JS is strictly reserved for interactive islands (`GraphView`, `CanvasEditor`, `NovelEditor`, `FolderTree`).
3. **Open Standards**: Built on open specifications (Obsidian-Flavored Markdown, JSON Canvas v1.0, CNCF OpenFGA, PostgreSQL JSONB).
4. **Single Source of Truth**: Unified catalogs (`src/lib/registry/resourceRegistry.ts`) and global CSS design tokens (`src/styles/global.css`) prevent duplication and style drift.
5. **No Silent Partial Reads**: Every call to a paginated or streaming external API (OpenFGA `read`, Google Drive list endpoints) must go through a shared helper that follows continuation tokens to exhaustion and reports truncation explicitly. A partial read must never be rendered as an authoritative empty result. See [31-iam-access-visibility-and-policy-troubleshooter.md](core-architecture/31-iam-access-visibility-and-policy-troubleshooter.md).
6. **Authorization Before Readability**: Security fixes land before correctness fixes. Never make data *visible* until the endpoint that exposes it is authorized — a masked bug is not a fixed bug, and un-masking it first turns a cosmetic defect into a disclosure. Every permissions endpoint declares its required relation in one shared guard table.
7. **The Engine Is the Only Judge**: Authorization decisions and their human-readable explanations both come from the OpenFGA engine (`check`, `expand`, `listUsers`). Never re-implement ReBAC resolution in application code, and never let a UI's explanation of a decision disagree with the decision itself.
