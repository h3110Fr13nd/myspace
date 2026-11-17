/**
 * One definition of "is this resource hidden from non-owners?".
 *
 * ## Why this exists
 *
 * Draft and unlisted are the two flags that decide whether a resource is
 * visible to someone who is not its owner. They were computed in five places
 * from the same metadata, and the five copies had drifted:
 *
 *   - `src/lib/vaultSync.ts` accepted `meta.unlisted === 'true'` (a string)
 *   - `permissions.ts`, `workspace/treeBuilder.ts`, `scripts/sync_meilisearch.ts`
 *     and `pages/api/v1/search.ts` accepted only `=== true`
 *
 * So a note whose frontmatter carried a *quoted* `unlisted: "true"` was treated
 * as unlisted when the vault was imported (and so was excluded from search) and
 * as ordinary content by the reader and the folder tree — the same "two sources
 * of truth" defect that `is_public` had before migration 0007, one layer down.
 * The failure is silent and one-directional: the resource stays visible.
 *
 * Coercion is deliberately generous on the input side and strict on the output
 * side. `unlisted: "true"`, `unlisted: true` and `unlisted: "True"` all mean
 * unlisted; anything else — including `"false"`, `1`, `"yes"`, `null` — does
 * not. Guessing at truthiness would let `"no"` hide a note, which is the worse
 * error.
 *
 * ## The `unlisted` column
 *
 * `migrations/0003` adds a real `resources.unlisted` column, and it is dead:
 * no write path populates it and no read path consults it. **Metadata is the
 * single source of truth for this flag.** The column is not read here, and
 * `tests/unit/visibility.spec.ts` asserts nothing starts reading it, because
 * `WHERE unlisted = false` on an always-`false` column silently matches every
 * row and would look like a correct filter. Dropping the column is a schema
 * change and is tracked separately; until then, do not query it.
 */

type Metadata = Record<string, any> | null | undefined;

/**
 * Interpret a frontmatter/JSON value as a boolean flag.
 *
 * Only the string `"true"` and the boolean `true` are truthy. Numeric and
 * arbitrary-string truthiness is rejected on purpose — see the note above.
 */
export function asBooleanFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

/** Any of `keys` present in metadata and set truthy. */
function anyFlag(metadata: Metadata, keys: string[]): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return keys.some((key) => asBooleanFlag(metadata[key]));
}

/**
 * Unlisted: reachable by direct link, but excluded from listings, the tree and
 * search. The owner still sees it.
 */
export function isUnlistedResource(resource: { metadata?: Metadata } | null | undefined): boolean {
  if (!resource) return false;
  return anyFlag(resource.metadata, ['unlisted', 'isUnlisted']);
}

/**
 * Draft: owner-only, and not exposed through any listing or feed.
 *
 * `is_draft` is a real column that *is* written and read, so it is honoured
 * here; the metadata spellings are the same flag as seen by older importers.
 */
export function isDraftResource(
  resource: { is_draft?: boolean | null; metadata?: Metadata } | null | undefined
): boolean {
  if (!resource) return false;
  if (resource.is_draft === true) return true;
  return anyFlag(resource.metadata, ['draft', 'isDraft']);
}
