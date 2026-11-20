/**
 * Readers treat a node as changed if its change record is newer than the
 * build's snapshot minus this margin. Trigger timestamps are taken at
 * statement time, not commit time, so a transaction that commits after a
 * build snapshot can carry an earlier timestamp; the margin bounds how long a
 * write transaction may stay open and still be caught. Over-verifying inside
 * the margin is harmless.
 */
export const CHANGE_MARGIN_MS = 60_000;
