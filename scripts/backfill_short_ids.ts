/**
 * scripts/backfill_short_ids.ts
 *
 * Backfills the `metadata.shortId` token for every existing resource so the
 * pretty `/ {slug}-{shortId}` URLs resolve via the GIN-indexed JSONB lookup.
 *
 * Idempotent: skips rows that already have a shortId.
 *
 * Usage:
 *   npx tsx scripts/backfill_short_ids.ts
 */

import 'dotenv/config';
import pg from 'pg';
import { deriveShortId } from '../src/lib/resourceUrls';

const DB_URL = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';

async function backfillShortIds(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DB_URL });

  try {
    const res = await pool.query(
      `SELECT id FROM resources WHERE metadata->>'shortId' IS NULL`
    );
    const rows = res.rows || [];
    console.log(`🔍 [ShortId Backfill] ${rows.length} resource(s) missing a shortId.`);

    let updated = 0;
    for (const row of rows) {
      const shortId = deriveShortId(row.id as string);
      await pool.query(
        `UPDATE resources SET metadata = metadata || $2::jsonb WHERE id = $1`,
        [row.id, JSON.stringify({ shortId })]
      );
      updated += 1;
    }

    console.log(`✅ [ShortId Backfill] Persisted ${updated} shortId token(s).`);
  } catch (err: any) {
    console.error('❌ [ShortId Backfill Error]:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillShortIds();
}