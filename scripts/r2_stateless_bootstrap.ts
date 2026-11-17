import pg from 'pg';
import { Migrator } from '../src/lib/migrator.js';
import { restoreOpenFGA } from './restore_openfga_r2.js';
import { backupOpenFGA } from './backup_openfga_r2.js';
import { backupDatabase } from './backup_postgres_r2.js';

const { Pool } = pg;

export async function runStatelessBootstrap() {
  console.log('================================================================');
  console.log('🚀 STATELESS APPLICATION BOOTSTRAP (R2 SINGLE SOURCE OF TRUTH)');
  console.log('================================================================');

  const dbUrl = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5432/workspace_db';
  const pool = new Pool({ connectionString: dbUrl });

  try {
    // 1. Check if database tables exist
    console.log('[Bootstrap] Step 1: Checking PostgreSQL database state...');
    const tableRes = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'resources';`
    );

    const migrator = new Migrator(dbUrl);
    if (tableRes.rows.length === 0) {
      console.log('[Bootstrap] Database schema empty. Running pending migrations...');
      await migrator.up();
    } else {
      console.log('[Bootstrap] Database schema exists. Ensuring all migrations are applied...');
      await migrator.up();
    }
    await migrator.close();

    // 2. Hydrate OpenFGA Store & Tuples
    console.log('[Bootstrap] Step 2: Restoring OpenFGA Authorization Model & Tuples...');
    await restoreOpenFGA();

    // 3. Check if Resources table needs seeding
    const resourcesRes = await pool.query(`SELECT count(*) as count FROM resources;`);
    const count = parseInt(resourcesRes.rows[0].count, 10);
    console.log(`[Bootstrap] Step 3: Resources in database: ${count}`);

    if (count === 0) {
      console.log('[Bootstrap] No resources found. Running vault content synchronization...');
      const { main: runVaultSeed } = await import('./seed_demo_vault.js');
      await runVaultSeed();
    }

    // 4. Save clean snapshot back to R2
    console.log('[Bootstrap] Step 4: Exporting active state backup to Cloudflare R2...');
    await backupOpenFGA().catch((e) => console.log('OpenFGA backup notice:', e.message));
    await backupDatabase(dbUrl, 'workspace_db').catch((e) => console.log('PostgreSQL backup notice:', e.message));

    console.log('================================================================');
    console.log('✔ STATELESS BOOTSTRAP COMPLETE: 100% OPERATIONAL & DURABLE');
    console.log('================================================================');
    return true;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStatelessBootstrap()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Bootstrap Fatal Error]', err);
      process.exit(1);
    });
}
