import { expect, test } from '@playwright/test';
import { collectRelationships, extractInlineRelationships, metadataRelationships } from '../../src/lib/relationships';
import { buildGraphData, buildSidebarGraphData } from '../../src/lib/workspace/graphTopology';
import { resolveWikilinks } from '../../src/lib/render/embedResolver';

test('inline [[target|alias|type]] declares a named relationship; plain links do not', () => {
  const md = 'See [[b|Bee|cites]], [[b||supports]], [[c|Sea]], [[d]] and ![[b|x|embeds]].';
  expect(extractInlineRelationships(md)).toEqual([
    { target: 'b', type: 'cites' },
    { target: 'b', type: 'supports' },
  ]);
});

test('metadata relationships accept array and map forms', () => {
  expect(metadataRelationships({ relationships: [{ target: 'b', type: 'cites' }, { to: 'c', label: 'refutes' }] })).toEqual([
    { target: 'b', type: 'cites' },
    { target: 'c', type: 'refutes' },
  ]);
  expect(metadataRelationships({ relationships: { supports: ['b', 'c'], cites: 'b' } })).toEqual([
    { target: 'b', type: 'supports' },
    { target: 'c', type: 'supports' },
    { target: 'b', type: 'cites' },
  ]);
  expect(collectRelationships({ relationships: { cites: 'b' } }, '[[b|B|cites]] [[b|B|extends]]')).toEqual([
    { target: 'b', type: 'cites' },
    { target: 'b', type: 'extends' },
  ]);
});

test('the graph gets one labelled link per relationship, replacing the plain wikilink', () => {
  const resources = [
    { id: 'document:a', type: 'document', title: 'A', metadata: { slug: 'a', wikilinks: ['b', 'c'], linkRelationships: [{ target: 'b', type: 'cites' }], relationships: { supports: 'b' } } },
    { id: 'document:b', type: 'document', title: 'B', metadata: { slug: 'b' } },
    { id: 'document:c', type: 'document', title: 'C', metadata: { slug: 'c' } },
  ];
  const { links } = buildGraphData(resources as any);
  expect(links).toEqual(
    expect.arrayContaining([
      { source: 'document:a', target: 'document:b', label: 'supports' },
      { source: 'document:a', target: 'document:b', label: 'cites' },
      { source: 'document:a', target: 'document:c' },
    ])
  );
  expect(links.filter((l) => l.target === 'document:b')).toHaveLength(2);
  const local = buildSidebarGraphData(resources as any, 'document:b');
  expect(local.links.filter((l) => l.label)).toHaveLength(2);
});

test('the relationship part is not shown in rendered links', () => {
  expect(resolveWikilinks('[[b|Bee|cites]]')).toContain('>Bee</a>');
  expect(resolveWikilinks('[[b||cites]]')).toContain('>b</a>');
});

test('links inside code are examples, not relationships', () => {
  const md = 'Use `[[a|b|cites]]` like this:\n\n```md\n[[x|y|extends]]\n```\n\nReal: [[c|C|refines]]';
  expect(extractInlineRelationships(md)).toEqual([{ target: 'c', type: 'refines' }]);
});

test('inline code stays literal in rendered notes', async () => {
  const { renderMarkdownWithEmbeds } = await import('../../src/lib/renderEngine');
  const html = renderMarkdownWithEmbeds('| a | b |\n|---|---|\n| `[[note\\|x\\|cites]]` | `$x$` |\n\nText `==not mark==`.');
  expect(html).toContain('<code>[[note|x|cites]]</code>');
  expect(html).toContain('<code>$x$</code>');
  expect(html).toContain('<code>==not mark==</code>');
  expect(html).not.toContain('wikilink-item');
});

test('labelled canvas edges between resource cards become graph relationships', async () => {
  const { canvasEdgeRelationships } = await import('../../src/lib/relationships');
  const doc = {
    nodes: [
      { id: 'n1', type: 'resource', resourceId: 'document:a' },
      { id: 'n2', type: 'file', file: 'notes/b.md' },
      { id: 'n3', type: 'text', text: 'just text' },
    ],
    edges: [
      { id: 'e1', fromNode: 'n1', toNode: 'n2', label: 'cites' },
      { id: 'e2', fromNode: 'n1', toNode: 'n2', label: 'extends' },
      { id: 'e3', fromNode: 'n1', toNode: 'n2' },
      { id: 'e4', fromNode: 'n1', toNode: 'n3', label: 'ignored' },
    ],
  };
  const rels = canvasEdgeRelationships(doc);
  expect(rels).toEqual([
    { source: 'document:a', target: 'b', type: 'cites' },
    { source: 'document:a', target: 'b', type: 'extends' },
  ]);
  const resources = [
    { id: 'document:a', type: 'document', title: 'A', metadata: { slug: 'a' } },
    { id: 'document:b', type: 'document', title: 'B', metadata: { slug: 'b' } },
    { id: 'canvas:c', type: 'canvas', title: 'C', metadata: { edgeRelationships: rels } },
  ];
  const { links } = buildGraphData(resources as any);
  expect(links.filter((l) => l.source === 'document:a' && l.target === 'document:b').map((l) => l.label)).toEqual(['cites', 'extends']);
  // Without the canvas in the viewer's list, nothing is drawn.
  expect(buildGraphData(resources.slice(0, 2) as any).links.filter((l) => l.label)).toHaveLength(0);
  expect(buildSidebarGraphData(resources as any, 'document:b').nodes.map((n) => n.id)).toContain('document:a');
});
