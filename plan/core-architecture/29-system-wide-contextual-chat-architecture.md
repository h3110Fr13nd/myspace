# Plan 29: System-Wide Contextual Multi-Chat Architecture

> **Document**: System-Wide Multi-Thread Discussion & Ephemeral Collaboration Specification  
> **Location**: `plan/core-architecture/29-system-wide-contextual-chat-architecture.md`  
> **Status**: Proposal / unimplemented chat stubs; historical completion claims withdrawn
> **Builds On**: [Plan 5 (Everything is a Resource Architecture)](5-everything-is-a-resource-architecture.md), [Plan 14 (Multi-Provider Auth)](14-multi-provider-auth-account-linking.md), [Plan 27 (Miro/FigJam Whiteboard Evolution)](../future-roadmap/27-comparison-miro-figjam-and-canvas-evolution.md), [Plan 28 (UI/UX System Redesign)](28-ui-ux-system-redesign.md)  
> **Core Primitives**: PostgreSQL `chat_threads` & `chat_messages`, OpenFGA ReBAC Permission Enforcement, Floating Speech Bubbles, Drawer-based Multi-Topic Threading

---

## 💬 1. Executive Summary & Objective

Modern knowledge work is intensely collaborative. Users reviewing academic research notes, complex markdown articles, data-dense spreadsheets, or spatial canvas graphs need to **ask questions, debate methodologies, request reviews, and hold conversations directly attached to the context being discussed**.

Traditional solutions suffer from critical architectural flaws:
1. **Third-Party Bloat & Lock-in**: Services like Discord, Slack, Pusher, or Stream require external subscriptions, vendor lock-in, client tracking scripts, and disconnected permission models.
2. **Context Fragmentation**: Leaving comments in separate chat channels decouples conversation history from the specific note, lemma, or canvas node.
3. **Single-Thread Bottlenecks**: A single flat comment list becomes chaotic when multiple distinct discussions occur simultaneously on the same document (e.g. "Section 2 Proof Review" vs "Typo Corrections").

Plan 29 delivers a **zero-external-SaaS, high-speed, lightweight contextual multi-thread discussion and chat architecture**:
- **Multi-Thread Discussions Per Resource**: Users can spawn multiple topic-specific threads (`#thread-name`) on *any* resource (documents, canvases, sheets, or code).
- **Zero-SSR Bloat**: Discussion drawers load on-demand using React islands, adding 0KB to initial SSR payloads.
- **ReBAC Inheritance**: Chat threads strictly inherit the resource's OpenFGA security boundary (`viewer` and `owner` relations).
- **Ephemeral Cursor Chat & Persistent Threads**: Bridges quick spatial cursor shouts (`/` shortcut on spatial boards) with persistent discussion records.
- **Thread Lifecycle Management**: One-click resolution and reopening of discussion threads to track actionable peer feedback.

---

## 🏛️ 2. Architectural Topology

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              SYSTEM-WIDE CONTEXTUAL MULTI-CHAT TOPOLOGY                                │
│                                                                                                        │
│  [Note Reader / WYSIWYG]              [Spatial Canvas Studio]                [Spreadsheet / Viewer]     │
│        │ NoteChatToggle                      │ NoteChatToggle / Cursor Chat          │ Chat Action      │
│        ▼                                     ▼                                       ▼                 │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                        ContextualChatDrawer Island (React + CSS Tokens)                          │  │
│  │                                                                                                  │  │
│  │  - Thread Switcher: Tab bar displaying active threads (#general, #proof-review) & message counts │  │
│  │  - Thread Status Bar: Open vs Resolved indicator with CheckCircle2 toggle action                 │  │
│  │  - Message Stream: Color-coded user bubbles, relative timestamps, auto-scrolling                 │  │
│  │  - New Thread Creator: Instant thread creation with initial comment injection                    │  │
│  └───────────────────────────────────┬───────────────────────────────────┬──────────────────────────┘  │
│                                      │                                   │                             │
│                                      ▼                                   ▼                             │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                             Astro REST API & OpenFGA Authorization Layer                         │  │
│  │                                                                                                  │  │
│  │  - /api/v1/chat/threads: GET (list with counts), POST (create thread), PATCH (resolve/reopen)    │  │
│  │  - /api/v1/chat/messages: GET (poll/stream messages), POST (post message)                        │  │
│  │  - ReBAC Guard: checkPermission(currentUser, 'viewer', resourceId)                              │  │
│  └───────────────────────────────────┬───────────────────────────────────┬──────────────────────────┘  │
│                                      │                                                                 │
│                                      ▼                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                             PostgreSQL Unified Persistence Engine                                │  │
│  │                                                                                                  │  │
│  │  - chat_threads (id, resource_id, title, created_by, is_resolved, metadata, created_at)          │  │
│  │  - chat_messages (id, thread_id, resource_id, user_id, user_name, user_color, content)           │  │
│  │  - Indexes: idx_chat_threads_resource_id, idx_chat_messages_thread_id, created_at                │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ 3. Database Schema

Tables defined in [`src/lib/db.ts`](../../src/lib/db.ts):

```sql
-- Discussion Threads
CREATE TABLE IF NOT EXISTS chat_threads (
  id VARCHAR(64) PRIMARY KEY,
  resource_id VARCHAR(128) NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  is_resolved BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_resource ON chat_threads(resource_id);

-- Discussion Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(64) PRIMARY KEY,
  thread_id VARCHAR(64) NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  resource_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  user_name VARCHAR(128) NOT NULL,
  user_color VARCHAR(32) DEFAULT '#00f2fe',
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at ASC);
```

---

## 🔌 4. API Endpoints

1. **`GET /api/v1/chat/threads?resourceId={id}`**:
   - Evaluates ReBAC permission on the resource (`is_public`, `owner_id`, or OpenFGA `viewer`).
   - Returns array of threads with `message_count` and `last_message_at`.
2. **`POST /api/v1/chat/threads`**:
   - Creates a new discussion thread for the target resource.
   - Accepts optional `initialMessage` to seed the conversation.
3. **`PATCH /api/v1/chat/threads`**:
   - Updates `is_resolved` boolean (allows marking threads as resolved or reopening them).
4. **`GET /api/v1/chat/messages?threadId={id}`**:
   - Fetches ordered messages for the active thread.
5. **`POST /api/v1/chat/messages`**:
   - Posts a new comment into the active thread.

---

## 🎨 5. UI Integration & Surfaces

- **`ContextualChatDrawer.tsx`**: High-performance right-side drawer using `src/components/ui/` primitives (`Drawer`, `Button`, `Badge`, `Flex`). Provides tab-based thread switching, live polling, resolution toggles, and rich message bubble rendering.
- **`NoteChatToggle.tsx`**: Lightweight trigger button mounted directly in the document header ([`src/pages/index.astro`](../../src/pages/index.astro)) and the spatial studio toolbar ([`src/components/canvas/CanvasEditor.tsx`](../../src/components/canvas/CanvasEditor.tsx)).
- **Ephemeral Cursor Chat**: Activated via `/` keypress anywhere on a spatial canvas to display a real-time speech bubble attached to the user's cursor.

---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Fully Implemented | **Architecture Track**: Collaboration & Communication

- [ ] Database schema migrations for `chat_threads` and `chat_messages` (`src/lib/db.ts`)
- [ ] REST API endpoints with OpenFGA authorization (`/api/v1/chat/threads`, `/api/v1/chat/messages`)
- [ ] Thread resolution toggle API (`PATCH /api/v1/chat/threads`)
- [ ] ContextualChatDrawer component with thread switcher and resolution indicator (`ContextualChatDrawer.tsx`)
- [ ] Note header trigger integration (`NoteChatToggle.tsx`, `index.astro`)
- [ ] Canvas Studio toolbar discussion toggle (`CanvasEditor.tsx`)
- [ ] Ephemeral cursor chat speech bubbles (`useCanvasEditor.ts`)
# Current implementation status

The historical checklist above is not current implementation evidence. Items are
unverified and must not be treated as shipped.
Source audit found `NoteChatToggle.tsx` and `ContextualChatDrawer.tsx` empty and
unreferenced from application source. Both chat API route files are also empty.
No chat table references were found in application source or migrations.
Chat UI, API, and schema claims are **not implemented by these sources**.
Reconcile backend readiness and the intended product scope before restoring the
UI or marking the checked items complete. See [UX journeys](../../docs/UX-JOURNEYS.md).
