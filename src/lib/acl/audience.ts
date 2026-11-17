/**
 * The audience slot: who, beyond named individuals, may reach a resource.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * Public access used to be a boolean in Postgres. `canUserViewResource` checked
 * `resource.is_public` and returned `true` *before* consulting OpenFGA, so public
 * access was a bypass of the authorization graph rather than a grant in it. At
 * the same time the model admitted no typed wildcard, so no `user:*` tuple could
 * ever be written — 101 resources were public in Postgres and private in the
 * graph. Two sources of truth, silently disagreeing.
 *
 * The audience slot fixes both. It mirrors Notion's "General access": a single
 * exclusive audience with its own role, composed additively with per-principal
 * grants. All three states are expressed IN the graph, so the troubleshooter can
 * explain them and the ACL can never be audited from the wrong place.
 *
 *   restricted   → no tuple at all. Only named grants apply.
 *   workspace    → `space:main#member [rung] object`
 *   public_link  → `user:* [rung] object`
 *
 * `resources.is_public` is retained ONLY as a derived cache, for the handful of
 * queries that filter on it. It is never read as an authorization input;
 * `tests/unit/acl-source-guards.spec.ts` enforces that.
 */
import { query } from '../db';
import { checkPermission, PUBLIC_USER } from '../openfga';
import { applyGrant, applyRevoke, revokePublicRead } from './projector';
import { toFgaObjectId } from '../resourceId';
import { reconcileNow } from './projection';

export const WORKSPACE_SUBJECT = 'space:main#member';

export type AudienceKind = 'restricted' | 'workspace' | 'public_link';

export interface Audience {
  kind: AudienceKind;
  rung: 'viewer' | 'editor' | null;
  expiresAt: Date | null;
}

const VALID_RANGS = new Set(['viewer', 'editor']);

function assertRung(rung: unknown): asserts rung is 'viewer' | 'editor' {
  if (typeof rung !== 'string' || !VALID_RANGS.has(rung)) {
    throw new Error(`Audience rung must be 'viewer' or 'editor', got ${JSON.stringify(rung)}`);
  }
}

/** The subject tuple that expresses each audience in the graph. */
function subjectFor(kind: AudienceKind): string | null {
  switch (kind) {
    case 'workspace':
      return WORKSPACE_SUBJECT;
    case 'public_link':
      return PUBLIC_USER;
    default:
      return null;
  }
}

/**
 * Read the audience slot.
 *
 * Falls back to the legacy `is_public` flag only to *report* what the graph does
 * not yet know, so a partially-migrated workspace still renders correctly
 * instead of silently appearing private.
 */
export async function getAudience(resourceId: string): Promise<Audience> {
  const res = await query(
    'SELECT audience, rung, expires_at FROM resource_audience WHERE resource_id = $1 LIMIT 1',
    [resourceId]
  );
  const row = res.rows?.[0];
  if (row) {
    return {
      kind: row.audience as AudienceKind,
      rung: (row.rung as 'viewer' | 'editor' | null) ?? null,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    };
  }

  // No row: restricted is the safe assumption. We deliberately do NOT fall back
  // to the legacy `is_public` flag here — reading it would reintroduce the
  // bypass this module exists to remove. `scripts/reconcile-acl.ts` reports rows
  // that are public in Postgres but have no audience slot, so the gap is visible
  // and repairable rather than silently honoured.
  return { kind: 'restricted', rung: null, expiresAt: null };
}

/**
 * Set the audience slot and reconcile the graph.
 *
 * Idempotent, and safe to call repeatedly: every prior subject for the previous
 * audience is revoked before the new one is granted, so switching from
 * `public_link` to `restricted` cannot leave a wildcard behind.
 */
export async function setAudience(input: {
  resourceId: string;
  kind: AudienceKind;
  rung?: 'viewer' | 'editor' | null;
  expiresAt?: Date | null;
  actor?: string;
}): Promise<Audience> {
  const { resourceId, kind, expiresAt = null, actor } = input;
  const rung = kind === 'restricted' ? null : (input.rung ?? 'viewer');
  if (rung !== null) assertRung(rung);

  const object = resourceId.includes(':')
    ? resourceId
    : toFgaObjectId('document', resourceId);

  // Revoke every audience subject that might have been granted previously, so a
  // downgrade cannot leave a wider audience in place.
  await Promise.all([
    revokePublicRead(object, 'viewer'),
    revokePublicRead(object, 'editor'),
    applyRevoke({ object, subject: WORKSPACE_SUBJECT, relation: 'viewer' }),
    applyRevoke({ object, subject: WORKSPACE_SUBJECT, relation: 'editor' }),
  ]).catch(() => {
    /* revoking an absent tuple is not an error */
  });

  if (rung) {
    // Checked, not assumed. Ignoring the result let `scripts/reconcile-acl.ts`
    // report "repaired 109, 0 failed" while 8 audience grants had in fact been
    // rejected — a repair job that reports success it did not achieve is worse
    // than no repair job, because it closes the alert.
    const granted = await applyGrant({ object, subject: subjectFor(kind)!, relation: rung });
    if (!granted) {
      throw new Error(
        `Failed to write the ${kind} grant for ${object}. The audience was not changed.`
      );
    }
  }

  await query(
    `INSERT INTO resource_audience (resource_id, audience, rung, expires_at, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (resource_id) DO UPDATE
       SET audience = EXCLUDED.audience,
           rung = EXCLUDED.rung,
           expires_at = EXCLUDED.expires_at,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [resourceId, kind, rung, expiresAt, actor ?? null]
  );

  // Derived cache. Written for indexed lookups only; never read for a decision.
  await query('UPDATE resources SET is_public = $2 WHERE id = $1', [resourceId, kind !== 'restricted'])
    .catch(() => {
      /* cache write is best-effort */
    });

  // A user-initiated change: the Share dialog re-reads immediately, so the read
  // model must be current before this returns. `scheduleReconcile` (debounced) is
  // for bulk writes; awaiting here is ~350ms and removes the "I changed it and
  // the old value is still showing" failure.
  await reconcileNow().catch(() => {
    /* the graph is authoritative; a stale read model is reported as stale */
  });

  return { kind, rung, expiresAt };
}

/**
 * Notion's 4-value exposure badge, with "most permissive wins".
 *
 * Security teams ask for exactly this, and it is cheap: it is derived from the
 * audience slot plus whether any non-internal principal holds a grant.
 */
export function exposureOf(audience: Audience, hasExternalGrant: boolean): AudienceKind | 'shared_externally' {
  if (audience.kind === 'public_link') return 'public_link';
  if (hasExternalGrant) return 'shared_externally';
  if (audience.kind === 'workspace') return 'workspace';
  return 'restricted';
}

/**
 * Whether an audience grant has lapsed.
 *
 * Expiry is checked here rather than by a sweeper, so a lapsed link stops
 * working on the next request instead of whenever a cron happens to run.
 */
export function isExpired(audience: Audience, now: Date = new Date()): boolean {
  return Boolean(audience.expiresAt && audience.expiresAt.getTime() <= now.getTime());
}
