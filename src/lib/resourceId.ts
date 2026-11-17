/**
 * Canonical OpenFGA object id for a resource.
 *
 * The database stores fully-qualified ids (e.g. "google_sheet:my-sheet"),
 * while some UI callers hold the bare slug and the type separately. Passing
 * both through this helper prevents the double-prefix bug
 * ("google_sheet:google_sheet:my-sheet") that OpenFGA rejects with
 * `invalid 'object' field format`.
 *
 * This module is intentionally dependency-free so it can be imported from
 * both server code and hydrated React components.
 */
export function toFgaObjectId(type: string | undefined | null, id: string | undefined | null): string {
  if (!id) return '';
  return id.includes(':') ? id : `${type}:${id}`;
}
