# Plan 24: Cloudflare Workers & Durable Objects Real-Time Collaboration Architecture

> **Document**: Edge-Native CRDT Synchronization & WebSocket Hibernation Specification  
> **Location**: `plan/initial/24-cloudflare-durable-objects-collaboration-architecture.md`  
> **Status**: Approved Architectural Plan  
> **Builds On**: [Plan 17 (Cloud-Native R2 Storage)](17-cloud-native-r2-zero-inbound-tunnel-architecture.md), [Plan 21 (Canvas Studio)](21-canvas-editor-creator-studio.md) & [Plan 23 (Performance Optimization)](23-canvas-performance-and-feature-roadmap.md)  
> **Core Primitives**: Cloudflare Durable Objects (DO), Embedded SQLite, WebSocket Hibernation API, Yjs CRDTs

---

## 🌐 1. Executive Summary & Why Durable Objects

Real-time spatial canvas authoring and collaborative WYSIWYG note editing require **globally coordinated state with sub-50ms round-trip latency**.

### The Problem with Self-Hosted WebSocket Clusters
In traditional architectures (e.g. Node.js with `@hocuspocus/server` or Socket.io):
1. **Memory Drain**: Keeping 1,000 idle client WebSocket connections open requires dedicated VM memory (150–400 MB RAM), active event-loop polling, and socket descriptors.
2. **Horizontal Scaling Complexity**: When users connect to different servers across regions, you need Redis Pub/Sub, Redis adapter clusters, sticky load balancing, and complex split-brain resolution.
3. **Zero-Egress & Low Cost Conflict**: Running a 24/7 WebSocket daemon on low-resource VMs (< 1 GB RAM) compromises the memory budget of PostgreSQL and Meilisearch.

### The Cloudflare Durable Objects Solution
Cloudflare **Durable Objects (DO)** provide a stateful serverless actor model running on Cloudflare's global edge network:
- **Global Uniqueness**: Each room (e.g., `canvas:workspace-architecture` or `document:paper-01`) maps to a single globally unique actor instance. All users editing that board automatically connect to the exact same running instance.
- **WebSocket Hibernation API**: The DO accepts WebSockets and enters a dormant state when idle. **Zero CPU and zero memory are billed while connections are quiet**. When a user moves their cursor or edits a node, the DO wakes up in **< 1ms**, broadcasts the binary update, and sleeps again.
- **Native Embedded SQLite**: Each Durable Object includes its own ACID SQLite database (`state.storage.sql`). Yjs CRDT updates are committed to local SQLite with microsecond latency before being periodically snapshotted to **Cloudflare R2** or **PostgreSQL**.
- **Edge ReBAC Authorization**: Access tokens are validated at the edge before upgrading connections, enforcing OpenFGA viewer vs. editor permissions.

---

## 🏛️ 2. Architectural Topology

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLOUDFLARE EDGE COLLABORATION TOPOLOGY                             │
│                                                                                                   │
│  [User A: Safari / Canvas Studio]               [User B: Chrome / TipTap Note]                   │
│         │                                              │                                          │
│         │ wss://collab.workspace.dev/room/canvas:track-1  │ (JWT Session Token in Sec-WebSocket-Protocols)
│         ▼                                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              Cloudflare Worker (Edge Gateway)                               │  │
│  │  1. Authenticate user JWT from cookie or protocol header                                    │  │
│  │  2. OpenFGA / ReBAC Check: verify user is 'editor' or 'viewer' on target resource           │  │
│  │  3. Route to Durable Object: env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(roomId))        │  │
│  └──────────────────────────────────────────────┬──────────────────────────────────────────────┘  │
│                                                 │                                                 │
│                                                 ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                         Durable Object Actor Instance (Single Room)                         │  │
│  │                                                                                             │  │
│  │   ┌──────────────────────────────────────────────────────────────────────────────────────┐  │  │
│  │   │ In-Memory Y.Doc (CRDT Document State)                                                │  │  │
│  │   │  - SyncStep1 / SyncStep2 / Incremental Delta updates                                 │  │  │
│  │   │  - Awareness: Live Cursors, Selection Boxes, Active User Avatars                     │  │  │
│  │   └──────────────────────────────────────────┬───────────────────────────────────────────┘  │  │
│  │                                              │                                                 │
│  │   ┌──────────────────────────────────────────┴───────────────────────────────────────────┐  │  │
│  │   │ WebSocket Hibernation Manager (state.acceptWebSocket)                                │  │  │
│  │   │  - Zero CPU cost during idle periods                                                 │  │  │
│  │   │  - Immediate Wakeup on packet arrival (< 1ms)                                        │  │  │
│  │   │  - Read-Only enforcement for 'viewer' roles (drops rogue write frames)               │  │  │
│  │   └──────────────────────────────────────────┬───────────────────────────────────────────┘  │  │
│  │                                              │                                                 │
│  │   ┌──────────────────────────────────────────▼───────────────────────────────────────────┐  │  │
│  │   │ Embedded SQLite Storage Engine (state.storage.sql)                                   │  │  │
│  │   │  - Table: crdt_updates (id INTEGER PK, client_id INT, update_blob BLOB, created_at)  │  │  │
│  │   │  - Table: metadata (key TEXT PK, value TEXT)                                         │  │  │
│  │   └──────────────────────────────────────────┬───────────────────────────────────────────┘  │  │
│  │                                              │ (Debounced Alarm: 5s after last mutation)       │
│  │                                              ▼                                                 │
│  │                                [state.storage.setAlarm()]                                      │
│  └──────────────────────────────────────────────┬─────────────────────────────────────────────────┘  │
│                                                 │                                                 │
│                     ┌───────────────────────────┴───────────────────────────┐                     │
│                     ▼                                                       ▼                     │
│    ┌──────────────────────────────────┐                   ┌──────────────────────────────────┐    │
│    │ Cloudflare R2 Object Storage     │                   │ Astro Backend (PostgreSQL)       │    │
│    │  - Bucket: workspace-private     │                   │  - Webhook: /api/v1/sync/crdt    │    │
│    │  - Path: canvas/{slug}.canvas    │                   │  - Persists JSON & metadata      │    │
│    └──────────────────────────────────┘                   └──────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔌 3. Primitives & APIs Utilized

### 3.1 Location Hints for Lowest Latency
When routing to a Durable Object, Cloudflare allows specifying a `locationHint` to instantiate the actor physically close to the author or primary vault region:
```typescript
const id = env.COLLAB_ROOM.idFromName(roomId);
const stub = env.COLLAB_ROOM.get(id, { locationHint: 'wnam' }); // West North America, or 'eeur', 'apac'
```

### 3.2 WebSocket Hibernation API (Zero-Cost Idle Sockets)
Traditional WebSockets consume container RAM continuously. With the Hibernation API:
```typescript
export class CollabRoom implements DurableObject {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Parse role and user identity from Edge Worker
    const user = request.headers.get('X-User-Id') || 'user:anonymous';
    const role = request.headers.get('X-User-Role') || 'viewer';

    // Tag the socket with session metadata
    this.state.acceptWebSocket(server, [user, role]);

    // Send initial Yjs sync step 1
    this.sendInitialSync(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Invoked when an awake or hibernated socket receives data:
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const tags = this.state.getTags(ws);
    const isEditor = tags.includes('editor') || tags.includes('owner');

    // Decode Yjs protocol message
    const uint8Array = new Uint8Array(message as ArrayBuffer);
    const messageType = uint8Array[0];

    // Enforce read-only access for viewers: drop write messages
    if (!isEditor && (messageType === 0 || messageType === 2)) {
      console.warn(`[CollabRoom] Read-only user attempted mutation. Dropped.`);
      return;
    }

    // Apply mutation to in-memory Y.Doc and persist to SQLite
    this.applyUpdate(uint8Array);

    // Broadcast delta to all other connected clients
    this.state.getWebSockets().forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.READY_STATE_OPEN) {
        client.send(message);
      }
    });

    // Schedule debounced snapshot alarm (5 seconds)
    await this.state.storage.setAlarm(Date.now() + 5000);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    ws.close(code, reason);
  }
}
```

### 3.3 Embedded SQLite Storage Schema
Durable Objects include local embedded SQLite with zero network overhead:
```sql
CREATE TABLE IF NOT EXISTS crdt_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  clock INTEGER NOT NULL,
  update_blob BLOB NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crdt_clock ON crdt_updates (clock);
```

### 3.4 Alarm-Based Compaction & Cloudflare R2 Sync
When multiple collaborators are drawing nodes or typing simultaneously, writing to R2 or PostgreSQL on every keystroke would cause high IOPS. Instead, the DO buffers updates in SQLite and schedules a single alarm:
```typescript
async alarm() {
  // 1. Compact in-memory Y.Doc
  const snapshotUint8 = Y.encodeStateAsUpdate(this.ydoc);

  // 2. Export standard JSON Canvas or Markdown representation
  const serializedJson = this.exportRoomData();

  // 3. Write clean snapshot directly to Cloudflare R2
  const r2Key = `canvas/${this.roomId}.canvas`;
  await this.env.R2_BUCKET.put(r2Key, serializedJson, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      lastModified: Date.now().toString(),
      syncedBy: 'cloudflare-durable-object',
    },
  });

  // 4. Notify PostgreSQL backend of updated revision
  await fetch(`${this.env.ASTRO_BACKEND_URL}/api/v1/resources/sync-notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.env.INTERNAL_SYNC_SECRET}`,
    },
    body: JSON.stringify({
      resourceId: this.roomId,
      nodeCount: this.getNodeCount(),
      edgeCount: this.getEdgeCount(),
    }),
  });

  // 5. Prune SQLite incremental transaction log (compact into single base snapshot)
  this.state.storage.sql.exec(`
    DELETE FROM crdt_updates;
    INSERT INTO crdt_updates (client_id, clock, update_blob, timestamp)
    VALUES (0, 0, ?, ?);
  `, snapshotUint8, Date.now());
}
```

---

## 👥 4. Awareness: Live Spatial Cursors & Selection Bounding Boxes

In an infinite spatial canvas, awareness protocol (`y-protocols/awareness`) must track:
1. **World Coordinates**: Cursor `(x, y)` in canvas space (independent of the user's viewport pan/zoom).
2. **Selection State**: Set of currently selected node IDs (`selectedNodeIds: string[]`).
3. **Live User Profile**: Display name, avatar URL, and assigned vibrant color code (`#06b6d4`, `#f43f5e`, `#10b981`).

```typescript
export interface CanvasCollaboratorAwareness {
  user: {
    id: string;
    displayName: string;
    avatarUrl?: string;
    color: string;
  };
  cursor: {
    x: number; // In canvas grid coordinates
    y: number;
    viewportZoom: number;
  } | null;
  selection: string[]; // IDs of nodes selected by this user
  activePort?: {
    nodeId: string;
    side: 'top' | 'right' | 'bottom' | 'left';
  } | null;
}
```

### Rendering Remote Cursors on Canvas
The Canvas 2D EdgeRenderer or React layer draws a glowing cursor and name badge for each active peer:
```tsx
{Array.from(collaborators.entries()).map(([peerId, state]) => {
  if (!state.cursor) return null;
  return (
    <div
      key={peerId}
      style={{
        position: 'absolute',
        left: `${state.cursor.x}px`,
        top: `${state.cursor.y}px`,
        pointerEvents: 'none',
        zIndex: 9999,
        transition: 'transform 0.04s linear',
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z" fill={state.user.color} stroke="#050810" strokeWidth="1.5" />
      </svg>
      <div style={{ background: state.user.color, color: '#050810', fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', marginTop: '-4px', marginLeft: '12px' }}>
        {state.user.displayName}
      </div>
    </div>
  );
})}
```

---

## 🔒 5. Edge Security & ReBAC Integration

Before any client reaches the Durable Object, the Cloudflare Worker validates authorization:

```typescript
// workers/collab/src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // 1. Extract session token
    const cookies = request.headers.get('Cookie') || '';
    const token = extractSessionToken(cookies) || url.searchParams.get('token');
    const user = await verifyJwt(token, env.JWT_SECRET);

    // 2. Extract Target Room
    const roomId = url.pathname.replace(/^\/room\//, '');
    if (!roomId) return new Response('Missing roomId', { status: 400 });

    // 3. ReBAC check against OpenFGA
    const isEditor = await checkOpenFgaPermission(user.id, 'editor', roomId, env);
    const isViewer = isEditor || await checkOpenFgaPermission(user.id, 'viewer', roomId, env);

    if (!isViewer) {
      return new Response(JSON.stringify({ error: 'Unauthorized room access' }), { status: 403 });
    }

    // 4. Pass authorization context to Durable Object
    const id = env.COLLAB_ROOM.idFromName(roomId);
    const stub = env.COLLAB_ROOM.get(id);

    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('X-User-Id', user.id);
    forwardHeaders.set('X-User-Role', isEditor ? 'editor' : 'viewer');
    forwardHeaders.set('X-User-Name', user.displayName || user.email);

    return stub.fetch(new Request(request.url, { headers: forwardHeaders }));
  },
};
```

---

## 🔄 6. Dual Deployment Architecture: Edge vs. Local Offline

To preserve the zero-configuration local development philosophy of the workspace:

| Capability | Cloud Production (Cloudflare) | Local Development (`docker compose`) |
|:---|:---|:---|
| **Actor Engine** | Cloudflare Workers + Durable Objects | `@hocuspocus/server` in Node container |
| **Transport** | Cloudflare WebSocket Hibernation | Standard `ws` Node.js WebSocket |
| **Persistence** | Embedded SQLite + Cloudflare R2 | PostgreSQL `resources` table + Local Disk |
| **Idle Cost** | **$0.00 / hour** (Automated Hibernation) | Local Container (~20 MB RAM) |
| **Protocol** | Standard Yjs Binary Sync Protocol | Standard Yjs Binary Sync Protocol |
| **Frontend Client** | [collaboration.ts](file:///home/user/workspace/src/lib/editor/collaboration.ts) | [collaboration.ts](file:///home/user/workspace/src/lib/editor/collaboration.ts) |

Because the frontend connects via standard Yjs protocol (`HocuspocusProvider` or `y-websocket`), **the exact same client code works seamlessly in both Cloudflare production and offline Docker development** without conditional branching in UI components.

---

## 🚀 7. Step-by-Step Implementation Roadmap

### Phase 1: Cloudflare Worker & DO Scaffold (`workers/collab/`)
1. Create `wrangler.toml` configuring the Durable Object binding `COLLAB_ROOM`.
2. Implement `CollabRoom.ts` with `state.acceptWebSocket` and SQLite persistence.
3. Bind the `R2_BUCKET` for snapshot synchronization.

### Phase 2: OpenFGA ReBAC Verification Hook
1. Implement edge-cached JWT verification using Web Crypto API.
2. Check OpenFGA check endpoint (`/stores/{id}/check`) with 30-second edge cache.
3. Tag sockets as `editor` or `viewer`.

### Phase 3: Spatial Canvas Awareness & Visual Cursors
1. Connect `src/lib/editor/collaboration.ts` to `wss://collab.workspace.dev/room/canvas:{id}`.
2. In [CanvasEditor.tsx](file:///home/user/workspace/src/components/canvas/CanvasEditor.tsx), bind mouse movement to `awareness.setLocalStateField('cursor', { x, y })`.
3. Render collaborator colored cursors and selection bounding boxes in real time.

### Phase 4: TipTap Note Collaboration Binding
1. Bind TipTap ProseMirror instance in [NovelEditor.tsx](file:///home/user/workspace/src/components/editor/NovelEditor.tsx) to `y-prosemirror` extension.
2. Display remote inline user carets and text selections.


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🔭 Future Roadmap | **Track**: Real-Time Collaborative Architecture

- [x] Adaptive JIT client-side collaboration hooks (`useCollaboration.ts`)
- [ ] Cloudflare Durable Object worker room deployment (`collab.workspace.dev`)
- [ ] Yjs CRDT WebSocket synchronization with embedded SQLite persistence
- [ ] Real-time multiplayer visual cursors on spatial canvases
- [ ] TipTap live multi-user caret and text collaborative editing
