import { expect, test } from '@playwright/test';
import {
  contentIndexCache,
  invalidateSearchCache,
  isSearchStateMutation,
  rawDbResourcesCache,
  vaultSearchCache,
} from '../../src/lib/cache/searchCache';

test('resource and ACL table writes invalidate search state', () => {
  for (const sql of [
    'INSERT INTO resources (id) VALUES ($1)',
    'UPDATE public.resources SET title = $1 WHERE id = $2',
    'DELETE FROM resource_audience WHERE resource_id = $1',
    'INSERT INTO group_memberships (group_id, user_id) VALUES ($1, $2)',
    'WITH changed AS (DELETE FROM resource_tags WHERE resource_id = $1) SELECT 1',
    'UPDATE resource_effective_acl SET rung = $1 WHERE resource_id = $2',
    'UPDATE acl_projection_state SET stale = true WHERE id = 1',
    'TRUNCATE TABLE resources',
  ]) {
    expect(isSearchStateMutation(sql), sql).toBe(true);
  }
});

test('unrelated queries do not invalidate search state', () => {
  for (const sql of [
    'SELECT * FROM resources',
    'UPDATE users SET display_name = $1 WHERE id = $2',
    'INSERT INTO audit_events (id) VALUES ($1)',
  ]) {
    expect(isSearchStateMutation(sql), sql).toBe(false);
  }
});

test('invalidation clears every in-process search cache', () => {
  contentIndexCache.set('user:alice', []);
  rawDbResourcesCache.set('raw_resources_500', []);
  vaultSearchCache.set('user:alice:query', []);

  invalidateSearchCache();

  expect(contentIndexCache.get('user:alice')).toBeNull();
  expect(rawDbResourcesCache.get('raw_resources_500')).toBeNull();
  expect(vaultSearchCache.get('user:alice:query')).toBeNull();
});
