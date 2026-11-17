import 'dotenv/config';
import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const connectionString = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';

async function migrate() {
  console.log(`[DB Migrate] Connecting to PostgreSQL database at ${connectionString}...`);
  const pool = new pg.Pool({ connectionString });

  try {
    const initSqlPath = path.join(process.cwd(), 'docker', 'postgres', 'init.sql');
    const sql = fs.readFileSync(initSqlPath, 'utf-8');

    console.log(`[DB Migrate] Executing SQL script...`);
    await pool.query(sql);
    console.log(`[DB Migrate Success] Database schema and user tables updated successfully.`);
  } catch (error: any) {
    console.error(`[DB Migrate Error]:`, error.message);
  } finally {
    await pool.end();
  }
}

migrate();
