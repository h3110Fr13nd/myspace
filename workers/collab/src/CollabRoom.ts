import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

export interface Env {
  COLLAB_ROOM: DurableObjectNamespace;
  R2_BUCKET: R2Bucket;
  ASTRO_BACKEND_URL: string;
  INTERNAL_SYNC_SECRET: string;
  JWT_SECRET: string;
}

export class CollabRoom implements DurableObject {
  state: DurableObjectState;
  env: Env;
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  roomId: string;
  isInitialized: boolean = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.ydoc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    this.roomId = '';
  }

  private async initialize(roomId: string) {
    if (this.isInitialized) return;
    this.roomId = roomId;

    // 1. Initialize SQLite tables for local CRDT log
    this.state.storage.sql.exec(`
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
    `);

    // 2. Hydrate in-memory Y.Doc from SQLite
    try {
      const rows = this.state.storage.sql.exec(`SELECT update_blob FROM crdt_updates ORDER BY id ASC`);
      for (const row of rows) {
        if (row.update_blob) {
          const blob = new Uint8Array(row.update_blob as ArrayBuffer);
          Y.applyUpdate(this.ydoc, blob);
        }
      }
    } catch (err) {
      console.error(`[CollabRoom:${this.roomId}] SQLite hydration error:`, err);
    }

    // 3. Listen to internal Y.Doc updates and save to SQLite
    this.ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== 'sqlite_load') {
        try {
          this.state.storage.sql.exec(
            `INSERT INTO crdt_updates (client_id, clock, update_blob, timestamp) VALUES (?, ?, ?, ?)`,
            this.ydoc.clientID,
            Date.now(),
            update,
            Date.now()
          );
        } catch (err) {
          console.error(`[CollabRoom:${this.roomId}] SQLite write error:`, err);
        }
      }
    });

    this.isInitialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.pathname.replace(/^\/room\//, '') || 'default';
    await this.initialize(roomId);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({
        roomId: this.roomId,
        activeWebSockets: this.state.getWebSockets().length,
        persistedUpdates: this.getUpdateCount(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const userId = request.headers.get('X-User-Id') || 'user:anonymous';
    const userRole = request.headers.get('X-User-Role') || 'viewer';
    const userName = request.headers.get('X-User-Name') || 'Guest Collaborator';

    // Accept WebSocket into hibernation manager with session tags
    this.state.acceptWebSocket(server, [userId, userRole, userName]);

    // Send initial Yjs sync step 1
    const encoder = new Uint8Array(syncProtocol.readSyncMessage(
      new syncProtocol.Decoder(new Uint8Array(0)),
      syncProtocol.createEncoder(),
      this.ydoc,
      null
    ));

    // Send SyncStep 1 to newly connected peer
    const syncStep1Encoder = syncProtocol.createEncoder();
    syncProtocol.writeSyncStep1(syncStep1Encoder, this.ydoc);
    server.send(syncProtocol.toUint8Array(syncStep1Encoder));

    // Send current awareness states
    const awarenessStates = awarenessProtocol.encodeAwarenessUpdate(
      this.awareness,
      Array.from(this.awareness.getStates().keys())
    );
    if (awarenessStates.byteLength > 0) {
      server.send(awarenessStates);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    if (typeof message === 'string') return;

    const tags = this.state.getTags(ws);
    const isEditor = tags.includes('editor') || tags.includes('owner');
    const uint8Array = new Uint8Array(message);

    // Simple Yjs protocol packet inspection
    // If packet is sync mutation (messageType 2 / update) and user is reader only, drop frame
    const messageType = uint8Array[0];
    if (!isEditor && (messageType === 0 || messageType === 2)) {
      console.warn(`[CollabRoom:${this.roomId}] Blocked write from read-only client`);
      return;
    }

    // Apply delta to in-memory Y.Doc
    try {
      if (messageType === 0 || messageType === 1 || messageType === 2) {
        Y.applyUpdate(this.ydoc, uint8Array);
      }
    } catch {
      // Ignored for awareness messages
    }

    // Broadcast update to all other connected clients
    const sockets = this.state.getWebSockets();
    for (const client of sockets) {
      if (client !== ws && client.readyState === WebSocket.READY_STATE_OPEN) {
        try {
          client.send(message);
        } catch {
          // Socket write error handled by hibernation
        }
      }
    }

    // Schedule debounced snapshot alarm (5 seconds after last mutation)
    await this.state.storage.setAlarm(Date.now() + 5000);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    ws.close(code, reason);

    // If zero remaining connections, trigger immediate compaction and snapshot
    const remaining = this.state.getWebSockets().length;
    if (remaining === 0) {
      console.log(`[CollabRoom:${this.roomId}] All peers disconnected. Scheduling auto-hibernation compaction.`);
      await this.state.storage.setAlarm(Date.now() + 1000);
    }
  }

  async alarm() {
    // 1. Compact in-memory Y.Doc
    const snapshotUint8 = Y.encodeStateAsUpdate(this.ydoc);

    // 2. Persist snapshot directly to Cloudflare R2
    if (this.env.R2_BUCKET && this.roomId) {
      try {
        const r2Key = `collab/snapshots/${this.roomId}.crdt`;
        await this.env.R2_BUCKET.put(r2Key, snapshotUint8, {
          customMetadata: {
            roomId: this.roomId,
            compactedAt: Date.now().toString(),
          },
        });
        console.log(`[CollabRoom:${this.roomId}] Snapshotted to R2: ${r2Key}`);
      } catch (err) {
        console.error(`[CollabRoom:${this.roomId}] R2 snapshot error:`, err);
      }
    }

    // 3. Compact SQLite crdt_updates table to single baseline snapshot
    try {
      this.state.storage.sql.exec(`DELETE FROM crdt_updates;`);
      this.state.storage.sql.exec(
        `INSERT INTO crdt_updates (client_id, clock, update_blob, timestamp) VALUES (0, 0, ?, ?);`,
        snapshotUint8,
        Date.now()
      );
    } catch (err) {
      console.error(`[CollabRoom:${this.roomId}] SQLite compaction error:`, err);
    }

    // 4. Notify Astro Backend
    if (this.env.ASTRO_BACKEND_URL) {
      try {
        await fetch(`${this.env.ASTRO_BACKEND_URL}/api/v1/sync/crdt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.env.INTERNAL_SYNC_SECRET}`,
          },
          body: JSON.stringify({
            resourceId: this.roomId,
            timestamp: Date.now(),
            activeUsers: this.state.getWebSockets().length,
          }),
        });
      } catch {
        // Backend notification non-fatal
      }
    }
  }

  private getUpdateCount(): number {
    try {
      const res = this.state.storage.sql.exec(`SELECT COUNT(*) as count FROM crdt_updates`);
      for (const row of res) {
        return Number(row.count || 0);
      }
    } catch {
      return 0;
    }
    return 0;
  }
}
