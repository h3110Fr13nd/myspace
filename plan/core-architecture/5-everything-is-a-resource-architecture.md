# Plan 5: "Everything is a Resource" (EiaR) Unified Architecture & Extensible Folder Structure

> **Document**: Master Architecture & Extensibility Specification  
> **Location**: `plan/initial/5-everything-is-a-resource-architecture.md`  
> **Status**: Approved Architectural Standard  
> **Core Concept**: Universal Graph Node Polymorphism & Modular Component Plugins  

---

## 🌐 1. The Core Paradigm: Everything is a Resource (EiaR)

In this system, **there are no second-class entities**. Whether it is a root workspace, a folder, a research note, a blog article, a PDF paper, an image asset, a spatial JSON canvas, an individual canvas node, a spreadsheet, a dynamic questionnaire form, a TODO item, a tag, or a collection — **every single entity is a first-class Resource Graph Node**.

```
                           ┌────────────────────────────────────────────────────────┐
                           │               UNIVERSAL RESOURCE NODE                  │
                           ├────────────────────────────────────────────────────────┤
                           │  • id: `${type}:${unique_slug_or_uuid}`                │
                           │  • type: resource_type enum (pluggable)                │
                           │  • owner_id: `user:${username}` / `group:${group}`     │
                           │  • parent_id: optional hierarchy link                  │
                           │  • path: materialized hierarchical path                │
                           │  • title: human-readable name                          │
                           │  • metadata: typed JSONB (Zod-validated per type)      │
                           │  • is_public: boolean                                  │
                           │  • is_draft: boolean                                   │
                           └──────────────────────────┬─────────────────────────────┘
                                                      │
         ┌──────────────────┬─────────────────┬───────┴──────────┬─────────────────┬──────────────────┐
         ▼                  ▼                 ▼                  ▼                 ▼                  ▼
    ┌──────────┐      ┌──────────┐      ┌───────────┐      ┌───────────┐     ┌───────────┐      ┌───────────┐
    │ Document │      │   PDF    │      │  Canvas   │      │   Sheet   │     │   TODO    │      │    Tag    │
    │  / Blog  │      │ / Media  │      │   Board   │      │  (Grid)   │     │  (Task)   │      │ (Taxonomy)│
    └──────────┘      └──────────┘      └───────────┘      └───────────┘     └───────────┘      └───────────┘
```

### 1.1 First-Class Properties of Every Resource
1. **Graph Interconnectivity**: Any resource can link to any other resource via `[[type:id]]` wikilinks or `![[type:id]]` embeds.
2. **ReBAC Security**: Every resource has fine-grained OpenFGA relations (`owner`, `editor`, `viewer`, `denied_viewer`, `tagged`).
3. **Shadow Resources & Component Attachments**: 
   - When attaching a binary PDF, interactive canvas, or data sheet to an article, the system creates a **shadow resource node**.
   - This shadow resource maintains its own metadata, backlinks, and access policies while seamlessly rendering inline or in full-screen studio mode.
4. **Polymorphic Rendering**: The UI uses a single dynamic dispatcher `<ResourceViewer resource={node} />` that delegates to specialized viewers.

---

## 📁 2. The Modular & Extensible Folder Structure

To ensure infinite scalability, maintainability, and clean separation of concerns, the workspace codebase is structured as follows:

```
src/
├── core/                                # 🧠 Pure Domain Logic & Universal Resource Contracts
│   ├── resources/                       # Polymorphic Resource Engine
│   │   ├── registry.ts                  # Central Resource Type Registry (Plugin Dispatcher)
│   │   ├── types.ts                     # Core TypeScript interfaces (IResource, IResourceHandler)
│   │   ├── schemas/                     # Zod metadata schemas for every resource type
│   │   │   ├── base.schema.ts           # BaseResourceMetadata (title, tags, draft, dates, aliases)
│   │   │   ├── document.schema.ts       # Document & Blog metadata (headings, math, wikilinks)
│   │   │   ├── pdf.schema.ts            # PDF metadata (pageCount, s3Key, fileSize)
│   │   │   ├── canvas.schema.ts         # JSON Canvas metadata (nodeCount, edgeCount, position)
│   │   │   ├── sheet.schema.ts          # Spreadsheet metadata (rowCount, colCount, schemaDefinition)
│   │   │   ├── form.schema.ts           # Dynamic Form metadata (jsonSchema, uiSchema)
│   │   │   ├── todo.schema.ts           # Task metadata (status, priority, assignee, dueDate)
│   │   │   └── collection.schema.ts     # Collection metadata (members, sortOrder)
│   │   └── handlers/                    # Pluggable Type Handlers (1 per resource type)
│   │       ├── document.handler.ts      # Markdown parser, embed resolver, frontmatter parser
│   │       ├── pdf.handler.ts           # PDF streaming headers, thumbnail extractor
│   │       ├── canvas.handler.ts        # JSON Canvas node/edge validator
│   │       ├── sheet.handler.ts         # Tabular data parser & formula validator
│   │       ├── todo.handler.ts          # Task lifecycle & state transition validator
│   │       └── tag.handler.ts           # Taxonomy indexer & OpenFGA tag tuple manager
│   │
│   ├── authz/                           # 🛡️ Authorization (OpenFGA ReBAC)
│   │   ├── client.ts                    # OpenFGA client singleton
│   │   ├── checks.ts                    # checkPermission, batchCheck, listObjects
│   │   └── tuples.ts                    # writeTuple, deleteTuple, batchWriteTuples
│   │
│   ├── db/                              # 🗄️ Database & Storage Engine
│   │   ├── pool.ts                      # PostgreSQL connection pool
│   │   ├── queries/                     # Domain-specific SQL queries
│   │   │   ├── resources.queries.ts     # Resource CRUD, path hierarchy, recursive trees
│   │   │   ├── tags.queries.ts          # Tag lookup & association queries
│   │   │   └── users.queries.ts         # User identity & profile queries
│   │   └── storage.ts                   # S3 / MinIO presigned URL & streaming proxies
│   │
│   └── stores/                          # ⚡ Framework-Agnostic Reactive State (Nano Stores)
│       ├── workspace.store.ts           # Active doc, active graph selection, sidebar toggle
│       └── search.store.ts              # Search query, selected result index, modal open state
│
├── components/                          # 🎨 UI Layer (Astro SSR + React Islands)
│   ├── layout/                          # Global Shell & Navigational Structure
│   │   ├── Header.astro                 # Sticky super-navigation bar & auth status
│   │   ├── WorkspaceShell.astro         # 3-Column Quartz layout container
│   │   └── SidebarLeft.astro            # Tree navigation & quick links container
│   │
│   ├── resources/                       # Polymorphic Resource UI Viewers & Cards
│   │   ├── ResourceViewer.astro         # Master Dispatcher (<ResourceViewer resource={r} />)
│   │   ├── viewers/                     # Dedicated Viewers per Type
│   │   │   ├── DocumentViewer.astro     # SSR Markdown + KaTeX + Shiki note renderer
│   │   │   ├── FolderViewer.astro       # Grid of subfolders & resource cards
│   │   │   ├── PdfViewer.tsx            # Interactive React PDF island (PDF.js + zoom + page nav)
│   │   │   ├── CanvasViewer.tsx         # Interactive JSON Canvas island (SVG/Canvas renderer)
│   │   │   ├── SheetViewer.tsx          # Interactive FortuneSheet / data grid island
│   │   │   ├── FormViewer.tsx           # Dynamic JSON Schema Form island
│   │   │   ├── ImageViewer.tsx          # Zoomable high-res image viewer island
│   │   │   └── TodoViewer.tsx           # Interactive task card & kanban list island
│   │   └── cards/                       # Reusable Resource Cards
│   │       ├── ResourceCard.astro       # Universal resource preview card
│   │       └── ShadowResourceCard.astro # Embedded shadow resource attachment card
│   │
│   ├── graph/                           # 🕸️ Graph & Spatial Knowledge Vis
│   │   ├── GraphView.tsx                # D3 Force Simulation 2D/3D knowledge graph
│   │   └── MiniGraph.tsx                # Local neighborhood 1-hop graph preview
│   │
│   ├── navigation/                      # 🧭 Navigation Widgets
│   │   ├── FolderTree.tsx               # Recursive collapsible tree sidebar
│   │   ├── TableOfContents.tsx          # Active scroll-tracking Table of Contents
│   │   ├── Backlinks.tsx                # Quartz incoming backlinks & linked references
│   │   └── Breadcrumbs.astro            # Hierarchical path breadcrumbs
│   │
│   ├── search/                          # 🔍 Search
│   │   └── SearchModal.tsx              # Cmd+K search dialog with keyboard navigation
│   │
│   ├── seo/                             # 🏷️ Metadata & Social Cards
│   │   └── ResourceHead.astro           # Dynamic <head> with OpenGraph & Twitter tags
│   │
│   └── research/                        # 🔬 Scientific Prose Components
│       ├── Callout.astro                # Alert & note boxes
│       ├── MathFormula.astro            # Block LaTeX equations
│       ├── Accordion.astro              # Animated details collapse
│       └── Quote.astro                  # Stylized academic blockquotes
│
├── lib/                                 # 🛠️ Server-side Rendering & Compilation Pipelines
│   └── render/                          # Modular Markdown Compilation
│       ├── renderEngine.ts              # Orchestrator (MDX → Math → Embeds → Marked → Shiki)
│       ├── mdxComponents.ts             # JSX component regex transforms
│       ├── mathRenderer.ts              # Server-side KaTeX rendering
│       ├── embedResolver.ts             # Recursive ![[embed]] & [[wikilink]] resolution
│       └── codeHighlighter.ts           # Server-side dual-theme Shiki syntax highlighting
│
├── pages/                               # 🚀 Astro SSR Routing Layer
│   ├── index.astro                      # Central 3-column workspace & active doc explorer
│   ├── login.astro                      # Session sign-in page
│   ├── register.astro                   # Account creation & vault provisioning page
│   ├── sitemap.xml.ts                   # Dynamic XML sitemap
│   ├── feed.xml.ts                      # Site-wide RSS feed
│   │
│   ├── blogs/                           # User Vaults & Blogs
│   │   ├── [user]/
│   │   │   ├── index.astro              # User's public vault & graph index
│   │   │   └── feed.xml.ts              # User-specific RSS feed
│   │
│   ├── studio/                          # Dedicated Full-Screen Tool Modes
│   │   ├── canvas/[id].astro            # Full-viewport JSON Canvas Studio
│   │   ├── sheet/[id].astro             # Full-viewport Spreadsheet Studio
│   │   └── editor/[id].astro            # Full-viewport WYSIWYG / Markdown Studio
│   │
│   ├── admin/                           # Administration & Security
│   │   └── permissions.astro            # Live OpenFGA IAM Console
│   │
│   └── api/v1/                          # Unified REST API Layer
│       ├── auth/                        # /login, /register, /logout, /me
│       ├── resources/                   # Polymorphic Resource CRUD & metadata endpoints
│       ├── permissions/                 # /grant, /revoke, /check
│       ├── search.ts                    # Permission-aware SQL & multi-vault search
│       └── assets/                      # Binary PDF & Image streaming proxies
```

---

## 🧩 3. The Resource Registry Pattern: Adding New Resource Types in 3 Steps

The architecture is strictly **open for extension, closed for modification**. Adding a brand new resource type (e.g. `audio`, `model3d`, `jupyter_notebook`) requires only 3 isolated additions without touching the core routing or database tables.

```
                  ┌──────────────────────────────────────────────┐
                  │          HOW TO ADD A NEW RESOURCE           │
                  └──────────────────────┬───────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
  Step 1: Define Schema            Step 2: Create Handler          Step 3: Create UI Viewer
  `schemas/audio.schema.ts`        `handlers/audio.handler.ts`     `viewers/AudioViewer.tsx`
  - Zod metadata shape             - Validation & parsing logic    - Interactive UI component
  - Bitrate, duration, format      - OpenFGA relation mappings     - Waveform audio player
```

### Example: Adding an `Audio` Resource

#### Step 1: Define Schema (`src/core/resources/schemas/audio.schema.ts`)
```ts
import { z } from 'zod';
import { BaseResourceMetadataSchema } from './base.schema';

export const AudioMetadataSchema = BaseResourceMetadataSchema.extend({
  durationSeconds: z.number().optional(),
  bitrate: z.number().optional(),
  sampleRate: z.number().optional(),
  waveform: z.array(z.number()).optional(),
  s3Key: z.string().optional(),
});
export type AudioMetadata = z.infer<typeof AudioMetadataSchema>;
```

#### Step 2: Register Type Handler (`src/core/resources/handlers/audio.handler.ts`)
```ts
import type { IResourceHandler } from '../types';
import { AudioMetadataSchema } from '../schemas/audio.schema';

export const AudioHandler: IResourceHandler = {
  type: 'audio',
  icon: '🎵',
  badgeClass: 'badge-info',
  schema: AudioMetadataSchema,
  fgaRelations: ['owner', 'editor', 'viewer', 'downloader', 'denied_viewer'],
};
```

#### Step 3: Register in Dispatcher (`src/components/resources/ResourceViewer.astro`)
```astro
---
import DocumentViewer from './viewers/DocumentViewer.astro';
import PdfViewer from './viewers/PdfViewer';
import CanvasViewer from './viewers/CanvasViewer';
import AudioViewer from './viewers/AudioViewer'; // <-- New Viewer

const { resource, currentUser } = Astro.props;
---

{resource.type === 'document' && <DocumentViewer resource={resource} currentUser={currentUser} />}
{resource.type === 'pdf'      && <PdfViewer client:load resource={resource} />}
{resource.type === 'canvas'   && <CanvasViewer client:load resource={resource} />}
{resource.type === 'audio'    && <AudioViewer client:load resource={resource} />}
```

---

## 🔗 4. Shadow Resources & Hyper-Linking Everything

A major requirement of our system is that **any sub-component or binary file can be referenced, tagged, and permissioned as a discrete node**:

| Resource Scenario | Implementation Model |
|:---|:---|
| **Attaching a PDF to a Note** | The PDF is stored as `pdf:report-q3`. The note creates a reference `![[pdf:report-q3]]`. In the graph, a directed edge connects `document:note` → `pdf:report-q3`. |
| **A Node Inside a Spatial Canvas** | Every node on a canvas can optionally have its own resource ID `canvas_node:node-42` pointing to an embedded note `document:agentic-ai`. Clicking the node in the canvas opens the note, and backlinks track where the note is embedded. |
| **A Tag as a Node** | A tag `tag:user_demo_agentic-ai` is a resource. Querying the graph for this tag returns all connected documents, PDFs, and canvases. |
| **A Sheet Grid as a Node** | A financial table is stored as `sheet:budget-2026`. It can be embedded in 5 different articles while having its permissions independently managed via OpenFGA. |

---

## 🚀 5. Implementation Roadmap for this Architecture

1. **Phase 1 (Directory Reorganization)**:
   - Establish `src/core/resources/`, `src/core/authz/`, `src/core/db/` modular directories.
   - Centralize resource metadata schemas under `src/core/resources/schemas/`.
2. **Phase 2 (Polymorphic Viewers)**:
   - Refactor `src/components/` into `layout/`, `resources/viewers/`, `graph/`, and `navigation/`.
   - Implement `<ResourceViewer />` dynamic dispatcher in `src/pages/index.astro`.
3. **Phase 3 (Studio Full-App Modes)**:
   - Create `/studio/canvas/[id]` and `/studio/sheet/[id]` routes for full-viewport interactive tools.
4. **Phase 4 (Tag & Collection Pages)**:
   - Add `/tags/[tag].astro` and `/collections/[collection].astro` to browse graph neighborhoods by taxonomy and curated groups.


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Completed & Architecturally Active | **Core Standard**: Universal Resource Polymorphism

- [x] Universal Resource Node schema with typed JSONB metadata (`resources` table in PostgreSQL)
- [x] Polymorphic Resource Type Registry (`src/lib/registry/resourceRegistry.ts`)
- [x] Pluggable Resource Viewers (`ResourceContentRenderer.astro`, `PdfViewer`, `JsonCanvasRenderer`, `SheetGrid`, `JupyterViewer`)
- [x] Fine-grained OpenFGA ReBAC integration on all resources (`src/lib/openfga.ts`, `src/lib/permissions.ts`)
- [x] Shadow resources and discrete node hyper-linking (`embedResolver.ts`)
- [x] Dedicated Full-Studio routes (`src/pages/studio/canvas/[id].astro`)
- [x] Taxonomy & Tag graph traversal pages (`src/pages/tags/[tag].astro`)
- [ ] Pluggable runtime community extension loader
