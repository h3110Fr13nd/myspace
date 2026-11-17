import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api';

interface PresenceEntry {
  userId: string;
  userName: string;
  color: string;
  lastSeen: number;
}

// In-memory active presence registry (keyed by resourceId)
// With automatic 45-second TTL expiration
const presenceRegistry = new Map<string, Map<string, PresenceEntry>>();

function cleanExpiredEntries() {
  const now = Date.now();
  const TTL = 45000; // 45 seconds

  for (const [resourceId, users] of presenceRegistry.entries()) {
    for (const [userId, entry] of users.entries()) {
      if (now - entry.lastSeen > TTL) {
        users.delete(userId);
      }
    }
    if (users.size === 0) {
      presenceRegistry.delete(resourceId);
    }
  }
}

export const POST: APIRoute = async ({ locals, request }) => {
  cleanExpiredEntries();

  const currentUser = locals.user || 'user:anonymous';
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const resourceId = body.resourceId;
  if (!resourceId) {
    return json({ error: 'Missing resourceId' }, { status: 400 });
  }

  const userId = body.userId || currentUser;
  const userName = body.userName || 'Anonymous Collaborator';
  const color = body.color || '#00f2fe';

  // Get or create room map
  if (!presenceRegistry.has(resourceId)) {
    presenceRegistry.set(resourceId, new Map());
  }
  const roomUsers = presenceRegistry.get(resourceId)!;

  // Record presence heartbeat
  roomUsers.set(userId, {
    userId,
    userName,
    color,
    lastSeen: Date.now(),
  });

  const activeViewers = roomUsers.size;
  const peers = Array.from(roomUsers.values()).map((u) => ({
    userId: u.userId,
    userName: u.userName,
    color: u.color,
  }));

  // JIT Optimization Rule:
  // Collab is ONLY recommended when 2 or more distinct users are viewing/editing the same document
  const collabRecommended = activeViewers >= 2;

  // Endpoint configuration
  const collabEndpoint = process.env.COLLAB_WS_URL || 'ws://127.0.0.1:1234';
  const collabUrl = `${collabEndpoint}/room/${encodeURIComponent(resourceId)}`;

  return new Response(
    JSON.stringify({
      resourceId,
      activeViewers,
      peers,
      collabRecommended,
      collabUrl,
      mode: collabRecommended ? 'collab' : 'solo',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

export const GET: APIRoute = async ({ url }) => {
  cleanExpiredEntries();
  const resourceId = url.searchParams.get('resourceId');
  if (!resourceId) {
    return json({ error: 'Missing resourceId' }, { status: 400 });
  }

  const roomUsers = presenceRegistry.get(resourceId);
  const activeViewers = roomUsers ? roomUsers.size : 0;
  const peers = roomUsers ? Array.from(roomUsers.values()) : [];

  return new Response(
    JSON.stringify({
      resourceId,
      activeViewers,
      peers,
      collabRecommended: activeViewers >= 2,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
