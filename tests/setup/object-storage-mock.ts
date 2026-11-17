import { createServer } from 'node:http';

/** Disposable S3 wire fixture: exercises SDK upload/read paths without remote accounts. */
export async function startObjectStorageMock() {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      objects.set(pathname, { body: Buffer.concat(chunks), type: String(request.headers['content-type'] || 'application/octet-stream') });
      response.writeHead(200, { ETag: '"fixture"' });response.end();return;
    }
    if (request.method === 'DELETE') {
      objects.delete(pathname);response.writeHead(204);response.end();return;
    }
    if (request.method === 'HEAD' && pathname.split('/').filter(Boolean).length === 1) {
      response.writeHead(200);response.end();return;
    }
    const object = objects.get(pathname);
    if (!object) {
      response.writeHead(404, { 'Content-Type': 'application/xml' });
      response.end('<Error><Code>NoSuchKey</Code><Message>Missing fixture object</Message></Error>');return;
    }
    response.writeHead(200, { 'Content-Type': object.type, 'Content-Length': object.body.length });response.end(object.body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Object storage mock did not bind');
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}
