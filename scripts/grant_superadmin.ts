import 'dotenv/config';
import pg from 'pg';
import { OpenFgaClient } from '@openfga/sdk';
import { withAclCacheInvalidation } from '../src/lib/aclCache';

const dbUrl = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';
const fgaUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';
const storeId = process.env.OPENFGA_STORE_ID;

async function main() {
  console.log(`[SuperAdmin Grant] Connecting to PostgreSQL at ${dbUrl}...`);
  const pool = new pg.Pool({ connectionString: dbUrl });
  const fgaClient = new OpenFgaClient({ apiUrl: fgaUrl, storeId });

  const email = 'dummy_mail';
  const userId = `user:${email}`;
  const displayName = 'DUMMY_NAME';

  try {
    // 1. Upsert SuperAdmin user in PostgreSQL
    await pool.query(
      `INSERT INTO users (id, email, display_name, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (email) DO UPDATE SET id = $1, display_name = $3, is_active = TRUE`,
      [userId, email, displayName]
    );
    console.log(`✓ SuperAdmin user ${userId} ensured in PostgreSQL.`);

    // 2. Fetch all spaces and root folders to grant owner tuple
    const res = await pool.query(`SELECT id, type FROM resources`);
    const allResources = res.rows || [];

    console.log(`[SuperAdmin Grant] Writing OpenFGA owner/editor/viewer tuples for ${allResources.length} resources...`);

    const writes: Array<{ user: string; relation: string; object: string }> = [
      { user: userId, relation: 'owner', object: 'space:main' },
      { user: userId, relation: 'owner', object: 'folder:user_demo_root' },
      { user: userId, relation: 'owner', object: 'folder:docs' },
    ];

    allResources.forEach((r) => {
      if (r.type === 'space' || r.type === 'folder') {
        writes.push({ user: userId, relation: 'owner', object: r.id });
      } else {
        writes.push({ user: userId, relation: 'owner', object: r.id });
        writes.push({ user: userId, relation: 'editor', object: r.id });
        writes.push({ user: userId, relation: 'viewer', object: r.id });
      }
    });

    // Batch write to OpenFGA (chunks of 10 to prevent exceeding batch limits)
    for (let i = 0; i < writes.length; i += 10) {
      const chunk = writes.slice(i, i + 10);
      try {
        await withAclCacheInvalidation(() =>
          fgaClient.write({ writes: chunk })
        );
      } catch (e: any) {
        // Continue even if some tuples already exist
      }
    }

    console.log(`✓ Successfully granted full max permissions to ${userId} in OpenFGA & PostgreSQL!`);
  } catch (error: any) {
    console.error(`[Error granting permissions]:`, error.message);
  } finally {
    await pool.end();
  }
}

main();
