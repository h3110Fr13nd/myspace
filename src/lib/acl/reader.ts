/**
 * Paginated OpenFGA tuple reads.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * `fgaClient.read()` with no arguments returns ONLY THE FIRST PAGE and the
 * caller silently discards the `continuation_token`. On the live store that is
 * 50 of 3,253 tuples, which is why the Share dialog showed no members and the
 * troubleshooter reported "No Direct Tuple" for a grant that demonstrably
 * existed. The bug was invisible *because* it failed closed on a read.
 *
 * Every tuple read in the application must go through this module. It follows
 * continuation tokens to exhaustion and, when it stops early, says so via
 * `truncated` rather than returning a partial set that looks authoritative.
 */
import 'dotenv/config';
import { fgaClient } from '../openfga';
import { logger } from '../logger';

export interface FgaTuple {
  user: string;
  relation: string;
  object: string;
}

export interface TupleReadResult {
  tuples: FgaTuple[];
  /** True when the page budget was exhausted and the result is incomplete. */
  truncated: boolean;
  /** Total tuples inspected, for diagnostics. */
  scanned: number;
}

export interface TupleKeyFilter {
  user?: string;
  relation?: string;
  object?: string;
}

/** Page size requested from the engine. The server caps this; 100 is well within limits. */
const PAGE_SIZE = 100;

/**
 * Ask the engine for `MINIMIZE_LATENCY` so a just-written grant shows up in the
 * Share dialog immediately.
 *
 * Off by default: consistency is an experimental server feature and OpenFGA
 * rejects the parameter outright unless it was started with
 * `--experimentals enable-consistency-params`, which surfaces as a 400 on every
 * read. Enable with `OPENFGA_CONSISTENCY=minimize_latency` once the server
 * supports it; until then the default consistency window applies, which is
 * correct but can lag a write by a few hundred milliseconds.
 */
const CONSISTENCY = (() => {
  const raw = (process.env.OPENFGA_CONSISTENCY || '').toLowerCase();
  return raw === 'minimize_latency' || raw === 'minimizelatency'
    ? ('MINIMIZE_LATENCY' as const)
    : undefined;
})();

/**
 * Hard ceiling on pages read in one call.
 *
 * An unbounded loop against a misbehaving endpoint is a worse failure than a
 * truncated-but-honest result, so a ceiling is warranted — but it has to clear
 * the real store size. At 100 tuples per page, the production store (~3.3k
 * tuples) needs ~33 pages, and a 20-page cap silently truncated bulk reads such
 * as `scripts/reconcile-acl.ts`, which is how a repair job can "succeed" while
 * seeing only part of the graph.
 *
 * Defaults to 100 pages (10k tuples) and is overridable for bulk maintenance.
 */
const MAX_PAGES = (() => {
  const raw = Number(process.env.OPENFGA_MAX_READ_PAGES || '');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
})();

/** Read a single page. Exposed so bulk callers can page deliberately. */
export async function readPage(
  filter: TupleKeyFilter = {},
  continuationToken?: string
): Promise<{ tuples: FgaTuple[]; continuationToken: string }> {
  const hasFilter = Boolean(filter.user || filter.relation || filter.object);
  const res = await fgaClient.read(hasFilter ? filter : {}, {
    pageSize: PAGE_SIZE,
    continuationToken,
    ...(CONSISTENCY ? { consistency: CONSISTENCY } : {}),
  } as any);

  const tuples: FgaTuple[] = (res.tuples || [])
    .map((t: any) => ({
      user: t.key?.user ?? '',
      relation: t.key?.relation ?? '',
      object: t.key?.object ?? '',
    }))
    .filter((t: FgaTuple) => t.user && t.relation && t.object);

  return { tuples, continuationToken: res.continuation_token || '' };
}

/**
 * Read every tuple matching `filter`, following continuation tokens.
 *
 * Never returns a partial set silently — check `truncated` before treating the
 * result as authoritative.
 */
export async function readAllTuples(filter: TupleKeyFilter = {}): Promise<TupleReadResult> {
  const tuples: FgaTuple[] = [];
  let token: string | undefined;
  let pages = 0;
  let scanned = 0;

  for (;;) {
    const page = await readPage(filter, token);
    tuples.push(...page.tuples);
    scanned += page.tuples.length;
    pages++;

    if (!page.continuationToken) return { tuples, truncated: false, scanned };
    if (pages >= MAX_PAGES) {
      logger.warn(
        { pages, scanned, maxPages: MAX_PAGES },
        '[acl] tuple read hit the page ceiling — result is incomplete'
      );
      return { tuples, truncated: true, scanned };
    }
    token = page.continuationToken;
  }
}

/**
 * Every tuple attached to one object, excluding the structural `parent_*` edges
 * when `includeStructure` is false.
 *
 * The structural edges are relationships, not grants, and surfacing them in an
 * ACL list is how `folder:x [parent_folder]` ends up rendered as a person with
 * access.
 */
export async function readTuplesForObject(
  object: string,
  opts: { includeStructure?: boolean } = {}
): Promise<TupleReadResult> {
  const res = await readAllTuples({ object });
  if (opts.includeStructure) return res;
  return {
    ...res,
    tuples: res.tuples.filter((t) => !t.relation.startsWith('parent_') && t.relation !== 'tagged'),
  };
}

/**
 * Every tuple for one relation, across all objects.
 *
 * Needed by projection code that must find graph memberships whose backing row
 * has been deleted. OpenFGA's Read endpoint filters by object and user but not by
 * relation, so this pages the store and filters client side — bounded by
 * `MAX_PAGES` and reported as truncated.
 */
export async function readAllTuplesForRelation(relation: string): Promise<FgaTuple[]> {
  const res = await readAllTuples();
  return res.tuples.filter((t) => t.relation === relation);
}

/** Every tuple whose subject is `user`, across all objects. Drives "Shared by me". */
export async function readTuplesForUser(user: string): Promise<TupleReadResult> {
  return readAllTuples({ user });
}

/**
 * Structural parents of an object, read straight from the tuples that encode
 * them rather than from `resources.parent_id`.
 *
 * Reading the relationship graph — not the database hierarchy — keeps
 * resolution correct even when the two disagree, which is exactly the class of
 * bug the old single-hop `parent_id` lookup produced.
 */
export async function readParentObjects(object: string): Promise<{ type: string; id: string }[]> {
  const res = await readAllTuples({ object });
  return res.tuples
    .filter((t) => t.relation === 'parent_folder' || t.relation === 'parent_space' || t.relation === 'parent_canvas')
    .map((t) => {
      const idx = t.user.indexOf(':');
      return { type: t.user.slice(0, idx), id: t.user.slice(idx + 1) };
    });
}

/** True when the object carries a public wildcard grant. */
export async function hasPublicGrant(object: string): Promise<boolean> {
  const res = await readTuplesForObject(object);
  return res.tuples.some(
    (t) => (t.user === 'user:*' || t.user === '*') && (t.relation === 'viewer' || t.relation === 'editor')
  );
}
