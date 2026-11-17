import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

export interface MigrationFile {
  version: string;
  name: string;
  upFile: string;
  downFile: string;
  upSql: string;
  downSql: string;
  checksum: string;
}

export interface AppliedMigration {
  id: number;
  version: string;
  name: string;
  applied_at: Date;
  checksum: string;
}

export class Migrator {
  private pool: pg.Pool;
  private migrationsDir: string;

  constructor(dbUrl?: string, migrationsDir?: string) {
    const connectionString = dbUrl || process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5432/workspace_db';
    this.pool = new Pool({ connectionString });
    this.migrationsDir = migrationsDir || path.resolve(process.cwd(), 'migrations');
  }

  async close() {
    await this.pool.end();
  }

  async initTrackingTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL
      );
    `);
  }

  async getAppliedMigrations(): Promise<AppliedMigration[]> {
    await this.initTrackingTable();
    const res = await this.pool.query<AppliedMigration>(
      `SELECT id, version, name, applied_at, checksum FROM _schema_migrations ORDER BY version ASC;`
    );
    return res.rows;
  }

  getAvailableMigrations(): MigrationFile[] {
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir);
    const upFiles = files.filter((f) => f.endsWith('.up.sql')).sort();

    return upFiles.map((upFile) => {
      const match = upFile.match(/^(\d+)_(.+)\.up\.sql$/);
      if (!match) {
        throw new Error(`Invalid migration filename format: ${upFile}. Expected format: 0001_name.up.sql`);
      }
      const [, version, name] = match;
      const downFile = `${version}_${name}.down.sql`;
      const upFilePath = path.join(this.migrationsDir, upFile);
      const downFilePath = path.join(this.migrationsDir, downFile);

      if (!fs.existsSync(downFilePath)) {
        throw new Error(`Missing corresponding rollback file for ${upFile}: expected ${downFile}`);
      }

      const upSql = fs.readFileSync(upFilePath, 'utf8');
      const downSql = fs.readFileSync(downFilePath, 'utf8');
      const checksum = crypto.createHash('sha256').update(upSql).digest('hex');

      return {
        version,
        name,
        upFile,
        downFile,
        upSql,
        downSql,
        checksum,
      };
    });
  }

  async up(): Promise<{ applied: string[] }> {
    await this.initTrackingTable();
    const applied = await this.getAppliedMigrations();
    const available = this.getAvailableMigrations();
    const appliedVersions = new Set(applied.map((a) => a.version));

    const pending = available.filter((m) => !appliedVersions.has(m.version));
    if (pending.length === 0) {
      console.log('✓ Database schema is already up to date. No pending migrations.');
      return { applied: [] };
    }

    const appliedNames: string[] = [];

    for (const migration of pending) {
      console.log(`[Migration] Applying ${migration.version}_${migration.name}...`);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.upSql);
        await client.query(
          `INSERT INTO _schema_migrations (version, name, checksum) VALUES ($1, $2, $3);`,
          [migration.version, migration.name, migration.checksum]
        );
        await client.query('COMMIT');
        appliedNames.push(`${migration.version}_${migration.name}`);
        console.log(`✓ Applied ${migration.version}_${migration.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ Migration failed at ${migration.version}_${migration.name}:`, err);
        throw err;
      } finally {
        client.release();
      }
    }

    return { applied: appliedNames };
  }

  async down(steps = 1): Promise<{ rolledBack: string[] }> {
    await this.initTrackingTable();
    const applied = await this.getAppliedMigrations();
    const available = this.getAvailableMigrations();
    const availableMap = new Map(available.map((m) => [m.version, m]));

    if (applied.length === 0) {
      console.log('No applied migrations to roll back.');
      return { rolledBack: [] };
    }

    const toRollback = applied.slice(-steps).reverse();
    const rolledBackNames: string[] = [];

    for (const appliedMig of toRollback) {
      const migrationFile = availableMap.get(appliedMig.version);
      if (!migrationFile) {
        throw new Error(`Cannot rollback version ${appliedMig.version}: migration file not found on disk.`);
      }

      console.log(`[Migration Rollback] Reverting ${appliedMig.version}_${appliedMig.name}...`);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migrationFile.downSql);
        await client.query(`DELETE FROM _schema_migrations WHERE version = $1;`, [appliedMig.version]);
        await client.query('COMMIT');
        rolledBackNames.push(`${appliedMig.version}_${appliedMig.name}`);
        console.log(`✓ Rolled back ${appliedMig.version}_${appliedMig.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ Rollback failed at ${appliedMig.version}_${appliedMig.name}:`, err);
        throw err;
      } finally {
        client.release();
      }
    }

    return { rolledBack: rolledBackNames };
  }

  async status(): Promise<void> {
    await this.initTrackingTable();
    const applied = await this.getAppliedMigrations();
    const available = this.getAvailableMigrations();
    const appliedMap = new Map(applied.map((a) => [a.version, a]));

    console.log('==================== SCHEMA MIGRATION STATUS ====================');
    for (const m of available) {
      const app = appliedMap.get(m.version);
      if (app) {
        const isChecksumMatch = app.checksum === m.checksum;
        const checkStr = isChecksumMatch ? '✔' : '⚠ CHECKSUM MISMATCH';
        console.log(` [APPLIED] ${m.version}_${m.name} (Applied at: ${app.applied_at.toISOString()}) ${checkStr}`);
      } else {
        console.log(` [PENDING] ${m.version}_${m.name}`);
      }
    }
    console.log('================================================================');
  }

  createMigration(name: string): { upFile: string; downFile: string } {
    const available = this.getAvailableMigrations();
    const lastVersionNum = available.length > 0 ? parseInt(available[available.length - 1].version, 10) : 0;
    const nextVersion = String(lastVersionNum + 1).padStart(4, '0');
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    const upFile = `${nextVersion}_${sanitizedName}.up.sql`;
    const downFile = `${nextVersion}_${sanitizedName}.down.sql`;

    const upFilePath = path.join(this.migrationsDir, upFile);
    const downFilePath = path.join(this.migrationsDir, downFile);

    fs.writeFileSync(
      upFilePath,
      `-- Migration: ${upFile}\n-- Description: Describe schema changes here\n\n`
    );

    fs.writeFileSync(
      downFilePath,
      `-- Migration: ${downFile}\n-- Description: Revert changes from ${upFile}\n\n`
    );

    console.log(`Created new migration templates:\n  - migrations/${upFile}\n  - migrations/${downFile}`);
    return { upFile, downFile };
  }
}
