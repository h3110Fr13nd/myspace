import { CollabRoom, type Env } from './CollabRoom';

export { CollabRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ status: 'ok', service: 'collab-edge-worker' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Room routing: /room/{roomId}
    if (!url.pathname.startsWith('/room/')) {
      return new Response('Not found', { status: 404 });
    }

    const roomId = url.pathname.replace(/^\/room\//, '');
    if (!roomId) {
      return new Response('Missing roomId in path', { status: 400 });
    }

    // Extract authorization from query token or cookie
    const token = url.searchParams.get('token') || extractCookieToken(request.headers.get('Cookie') || '');
    const userRole = url.searchParams.get('role') || 'editor'; // Default or verify via JWT
    const userName = url.searchParams.get('name') || 'Peer Collaborator';
    const userId = url.searchParams.get('userId') || 'user:anonymous';

    // Route to globally unique Durable Object instance for this room
    const doId = env.COLLAB_ROOM.idFromName(roomId);
    const stub = env.COLLAB_ROOM.get(doId);

    // Forward request with injected authentication headers
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('X-User-Id', userId);
    forwardHeaders.set('X-User-Role', userRole);
    forwardHeaders.set('X-User-Name', userName);

    const forwardRequest = new Request(request.url, {
      method: request.method,
      headers: forwardHeaders,
      body: request.body,
    });

    return stub.fetch(forwardRequest);
  },
};

function extractCookieToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)session_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
