import { test, expect } from '../fixtures/auth.fixture';

test('workspace graph returns only resources visible to the requester', async ({ request }) => {
  const response = await request.get('/api/v1/workspace/graph');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('private');

  const graph = await response.json() as {
    nodes: Array<{ id: string }>;
    links: Array<{ source: string | { id: string }; target: string | { id: string } }>;
  };
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  expect(nodeIds).toContain('document:public_hello');
  expect(nodeIds).not.toContain('document:private_secret');
  for (const link of graph.links) {
    const source = typeof link.source === 'string' ? link.source : link.source.id;
    const target = typeof link.target === 'string' ? link.target : link.target.id;
    expect(nodeIds.has(source)).toBe(true);
    expect(nodeIds.has(target)).toBe(true);
  }
});

test('workspace graph includes the signed-in owner’s private resources', async ({ sessionPage }) => {
  const response = await sessionPage.request.get('/api/v1/workspace/graph');
  expect(response.status()).toBe(200);

  const graph = await response.json() as { nodes: Array<{ id: string }> };
  expect(graph.nodes.map((node) => node.id)).toContain('document:private_secret');
});
