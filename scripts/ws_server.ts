import { Server } from '@hocuspocus/server';

const server = new Server({
  port: 1234,
  async onAuthenticate(data) {
    // In a real app, verify the token.
    // For now, accept all connections.
    return { user: 'anonymous' };
  },
  async onStoreDocument(data) {
    // In a real app, save the document state to the database.
    // For development, we'll just keep it in memory.
  },
});

server.listen();

console.log('✅ Hocuspocus WebSocket server running on ws://127.0.0.1:1234');
