import { expect, test } from '@playwright/test';
import { computeEffectiveAclFromTuples } from '../../src/lib/acl/projection';

test('inherits direct grants through indexed structural parents', () => {
  const result = computeEffectiveAclFromTuples({
    tuples: [
      { user: 'group:research#member', relation: 'viewer', object: 'folder:library' },
      { user: 'user:alice', relation: 'viewer', object: 'document:note' },
      { user: 'folder:library', relation: 'parent_folder', object: 'document:note' },
      { user: 'user:bob', relation: 'denied_viewer', object: 'document:note' },
      { user: 'user:*', relation: 'viewer', object: 'folder:library' },
    ],
    truncated: true,
    scanned: 5,
  });

  expect(result.truncated).toBe(true);
  expect(result.grants).toContainEqual(expect.objectContaining({
    resourceId: 'document:note',
    subjectType: 'group',
    subjectId: 'group:research#member',
    rung: 'viewer',
    source: 'inherited',
    sourceResource: 'folder:library',
  }));
  expect(result.grants).toContainEqual(expect.objectContaining({
    resourceId: 'document:note',
    subjectId: 'user:bob',
    source: 'deny',
  }));
  expect(result.grants.some((grant) =>
    grant.resourceId === 'document:note' && grant.subjectId === 'user:*'
  )).toBe(false);
});
