/**
 * Audit log — best-effort PostgreSQL writes. Object-storage export is not enabled.
 *
 * Fire-and-forget: writes never block or fail the request path. When the table
 * doesn't exist yet (pre-migration dev DB) the insert is skipped silently.
 */
import { query } from './db';
import { config } from './config';
import { logger } from './logger';
import crypto from 'crypto';

export interface AuditEntry {
  actor: string;
  action: string;
  /** Short human type, e.g. 'resource' | 'user' | 'api_key' */
  resourceType: string;
  resourceId?: string | null;
  /** Detail JSON — must be JSON-serializable. */
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

let tableReady = false;

async function ensureTable(): Promise<boolean> {
  // Production schema changes belong to migrations, never the request path.
  // Keep the convenience DDL only for local development databases.
  if (tableReady || config.isProd) return true;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS audit_events (
        id VARCHAR(64) PRIMARY KEY,
        actor VARCHAR(128) NOT NULL,
        action VARCHAR(64) NOT NULL,
        resource_type VARCHAR(64) NOT NULL,
        resource_id VARCHAR(256),
        detail JSONB DEFAULT '{}'::jsonb,
        ip VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_actor_created ON audit_events(actor, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_resource_created ON audit_events(resource_id, created_at DESC);`
    );
    tableReady = true;
  } catch {
    tableReady = true; // assume table exists already (migration 0005)
  }
  return true;
}

/** Write an audit row. Best-effort; never throws. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  if (!config.audit) return;
  try {
    await ensureTable();
    const id = `aud_${crypto.randomBytes(8).toString('hex')}`;
    await query(
      `INSERT INTO audit_events (id, actor, action, resource_type, resource_id, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        entry.actor,
        entry.action,
        entry.resourceType,
        entry.resourceId || null,
        JSON.stringify(entry.detail || {}),
        entry.ip || null,
      ]
    );
  } catch (err) {
    logger.debug({ err: (err as Error).message, action: entry.action }, '[audit] write skipped');
  }
}

/** Connection/table status for /readyz (false only if the write path is broken). */
export async function auditReady(): Promise<boolean> {
  if (!config.audit) return true;
  try {
    await ensureTable();
    await query('SELECT 1 FROM audit_events LIMIT 1');
    return true;
  } catch {
    return false;
  }
}
