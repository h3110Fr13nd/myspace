import { test, expect } from '@playwright/test';
import { buildTree } from '../../src/lib/workspace/treeBuilder';

test('tree payload keeps folder paths and omits fields the client does not use', () => {
  const tree = buildTree([
    {
      id: 'folder:notes',
      type: 'folder',
      title: 'Notes',
      path: 'vault/notes',
      metadata: { slug: 'notes' },
    },
    {
      id: 'document:note',
      type: 'document',
      title: 'A note',
      path: 'vault/notes/a-note.md',
      parent_id: 'folder:notes',
      metadata: { slug: 'a-note' },
    },
  ]);

  expect(tree).toHaveLength(1);
  expect(tree[0]).toMatchObject({ id: 'folder:notes', path: 'vault/notes' });
  expect(tree[0].children[0]).toMatchObject({ id: 'document:note', title: 'A note' });
  expect(tree[0].children[0]).not.toHaveProperty('path');
  expect(tree[0].children[0]).not.toHaveProperty('slug');
  expect(tree[0].children[0]).not.toHaveProperty('isDraft');
});
