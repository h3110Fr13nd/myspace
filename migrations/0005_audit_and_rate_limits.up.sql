-- 0005_audit_and_rate_limits.up.sql
-- Audit log table used by src/lib/audit.ts (plan §5).

CREATE TABLE IF NOT EXISTS audit_events (
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
CREATE INDEX IF NOT EXISTS idx_audit_resource_created ON audit_events(resource_id, created_at DESC);