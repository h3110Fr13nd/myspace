/**
 * Audit trail for content mutations.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `writeAudit` was called by the permission endpoints and nowhere else, so the
 * two real intrusions found in this workspace left no trace:
 *
 *   V5  a self-registered `user:admin` wrote to another user's canvas — the audit
 *       log had zero rows for that actor
 *   V6  `?as_user=` served private resources anonymously — also unlogged
 *
 * A permission change without a content change is not an attack; a content change
 * without a record is an attack nobody can investigate. Read paths are
 * deliberately NOT audited: auditing every read would be unauditable itself, and
 * the interesting reads (ACL enumeration, privilege probing) are already audited
 * by the permission layer.
 */
import { writeAudit } from '../audit';
import { logger } from '../logger';

/** Coarse, stable action names so the log can be filtered without parsing prose. */
export type ContentAction =
  | 'content.create'
  | 'content.update'
  | 'content.delete'
  | 'content.publish'
  | 'content.move';

export interface ContentAuditInput {
  /** The authenticated subject. Never a request-supplied value. */
  actor: string;
  action: ContentAction;
  resourceId: string;
  resourceType?: string;
  /** Field names touched, not their contents — content does not belong in a log. */
  fields?: string[];
  /** Small, non-sensitive specifics: byte counts, node counts, old→new visibility. */
  detail?: Record<string, unknown>;
  ip?: string;
}

/**
 * Record a content mutation.
 *
 * Fire-and-forget: an audit failure must never fail the user's write, but it is
 * logged so a silently broken audit trail is visible in the application log
 * rather than discovered during an incident.
 */
export function auditContent(input: ContentAuditInput): void {
  void writeAudit({
    actor: input.actor,
    action: input.action,
    resourceType: input.resourceType ?? 'resource',
    resourceId: input.resourceId,
    detail: {
      ...(input.fields?.length ? { fields: input.fields } : {}),
      ...(input.detail ?? {}),
    },
    ip: input.ip,
  }).catch((err) => {
    logger.error(
      { err: (err as Error).message, action: input.action, resource: input.resourceId },
      '[audit] content mutation was NOT recorded'
    );
  });
}
