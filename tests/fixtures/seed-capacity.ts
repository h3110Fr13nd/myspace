import { Client } from 'pg';
import type { OpenFgaClient } from '@openfga/sdk';

/** Seed a deterministic, public content graph for capped performance runs. */
export async function seedCapacityDataset(
  databaseUrl: string,
  fga: OpenFgaClient,
  resourceCount: number,
): Promise<void> {
  if (!Number.isSafeInteger(resourceCount) || resourceCount < 1 || resourceCount > 5_000) {
    throw new Error('Capacity resource count must be between 1 and 5000.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO resources
         (id, type, tenant_id, owner_id, path, title, content, metadata, is_public, is_draft)
       SELECT
         'document:capacity_' || lpad(n::text, 6, '0'),
         'document',
         'tenant_default',
         'user:11111111-1111-4111-8111-111111111111',
         'capacity/note-' || lpad(n::text, 6, '0'),
         'Capacity note ' || n,
         '# Capacity note ' || n || chr(10) || chr(10) || 'Synthetic workspace capacity fixture.' || chr(10),
         jsonb_build_object(
           'slug', 'capacity-note-' || lpad(n::text, 6, '0'),
           'category', 'Capacity fixture',
           'wikilinks', CASE WHEN n > 1
             THEN ARRAY['capacity-note-' || lpad((n - 1)::text, 6, '0')]
             ELSE ARRAY[]::text[]
           END
         ),
         TRUE,
         FALSE
       FROM generate_series(1, $1::integer) AS notes(n)`,
      [resourceCount],
    );
    await client.query(
      `INSERT INTO resource_audience (resource_id, audience, rung, updated_at)
       SELECT 'document:capacity_' || lpad(n::text, 6, '0'), 'public_link', 'viewer', NOW()
       FROM generate_series(1, $1::integer) AS notes(n)`,
      [resourceCount],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  const tuples = Array.from({ length: resourceCount }, (_, index) => ({
    user: 'user:*',
    relation: 'viewer',
    object: `document:capacity_${String(index + 1).padStart(6, '0')}`,
  }));
  for (let index = 0; index < tuples.length; index += 50) {
    await fga.write({ writes: tuples.slice(index, index + 50) });
  }
}
