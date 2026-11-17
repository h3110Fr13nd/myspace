import { expect, test } from '@playwright/test';
import { buildGraphData, buildSidebarGraphData } from '../../src/lib/workspace/graphTopology';
import type { WorkspaceResource } from '../../src/lib/workspace/treeBuilder';

const resource = (
  id: string,
  extra: Partial<WorkspaceResource> = {}
): WorkspaceResource => ({
  id,
  type: 'document',
  title: id,
  ...extra,
});

test.describe('workspace graph topology', () => {
  test('resolves exact slugs before substring matches', () => {
    const resources = [
      resource('document:target-introduction', { metadata: { slug: 'target-introduction' } }),
      resource('document:target', { metadata: { slug: 'target' } }),
      resource('document:source', { metadata: { wikilinks: ['target'] } }),
    ];

    const { links } = buildGraphData(resources);

    expect(links).toContainEqual({ source: 'document:source', target: 'document:target' });
    expect(links).not.toContainEqual({ source: 'document:source', target: 'document:target-introduction' });
  });

  test('uses the first resource for duplicate slugs and includes known parents', () => {
    const resources = [
      resource('folder:notes', { type: 'folder' }),
      resource('document:first', { parent_id: 'folder:notes', metadata: { slug: 'shared' } }),
      resource('document:second', { metadata: { slug: 'shared' } }),
      resource('document:source', { metadata: { wikilinks: ['shared'] } }),
      resource('document:orphan', { parent_id: 'folder:missing' }),
    ];

    const { links } = buildGraphData(resources);

    expect(links).toContainEqual({ source: 'folder:notes', target: 'document:first' });
    expect(links).toContainEqual({ source: 'document:source', target: 'document:first' });
    expect(links).not.toContainEqual({ source: 'document:source', target: 'document:second' });
    expect(links).not.toContainEqual({ source: 'folder:missing', target: 'document:orphan' });
  });

  test('retains legacy id-substring resolution as a fallback', () => {
    const resources = [
      resource('document:legacy-target'),
      resource('document:source', { metadata: { wikilinks: ['legacy-target'] } }),
    ];

    expect(buildGraphData(resources).links).toContainEqual({
      source: 'document:source',
      target: 'document:legacy-target',
    });
  });

  test('builds only the active resource and its one-hop neighbourhood for the sidebar', () => {
    const resources = [
      resource('folder:notes', { type: 'folder' }),
      resource('document:active', {
        parent_id: 'folder:notes',
        metadata: { slug: 'active', wikilinks: ['outgoing'] },
      }),
      resource('document:child', { parent_id: 'document:active' }),
      resource('document:outgoing', { metadata: { slug: 'outgoing' } }),
      resource('document:incoming', { metadata: { wikilinks: ['active'] } }),
      resource('document:unrelated'),
    ];

    const graph = buildSidebarGraphData(resources, 'document:active');

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'document:active',
      'folder:notes',
      'document:child',
      'document:outgoing',
      'document:incoming',
    ]);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes.some((node) => node.id === 'document:unrelated')).toBe(false);
    expect(graph.links).toContainEqual({ source: 'folder:notes', target: 'document:active' });
    expect(graph.links).toContainEqual({ source: 'document:active', target: 'document:outgoing' });
    expect(graph.links).toContainEqual({ source: 'document:incoming', target: 'document:active' });
  });

  test('always keeps the active resource when limiting a large neighbourhood', () => {
    const resources = [
      resource('document:active'),
      ...Array.from({ length: 30 }, (_, index) =>
        resource(`document:child-${index}`, { parent_id: 'document:active' })
      ),
    ];

    const graph = buildSidebarGraphData(resources, 'document:active', 4);

    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes[0].id).toBe('document:active');
  });
});
