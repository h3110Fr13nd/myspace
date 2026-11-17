/**
 * Canvas source resolution.
 *
 * A canvas can live in more than one place, and they do not agree:
 *
 *  - a `resources` row, whose `metadata.canvasData` is often empty or stale
 *    because a row is created by the resource picker long before anyone draws;
 *  - a `content/public_vault/canvas/<slug>.canvas` file, which is the durable
 *    copy the content index and resource listings read.
 *
 * The rule this module encodes exists because getting it wrong is invisible: the
 * board still mounts, still pans and zooms, and simply has nothing on it. A user
 * reads that as "my canvas is gone" rather than "the wrong source won".
 *
 * Kept as a pure function, with no filesystem or database access, so the
 * precedence is unit-testable. The Astro page does the I/O and passes the
 * results in.
 */

export interface CanvasSourceDbRow {
  title?: string | null;
  metadata?: { canvasData?: { nodes?: unknown; edges?: unknown } | null } | null;
}

export interface ResolvedCanvasSource<TNodes = unknown, TEdges = unknown> {
  /** The geometry to edit, or null when nothing could be resolved. */
  data: { nodes: TNodes[]; edges: TEdges[]; title?: string } | null;
  /** Where the geometry came from. */
  origin: 'db' | 'disk' | 'none';
  /**
   * The DB row existed and was readable but carried no nodes. Worth surfacing:
   * it means the DB copy and the durable copy have diverged, which is a data
   * problem someone needs to know about rather than a rendering one.
   */
  dbRowWasEmpty: boolean;
  /** Preferred title: the row's when it has one, else the content's. */
  title: string | null;
}

function isNonEmptyNodeList<T>(value: unknown): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

export function resolveCanvasSource<
  TNode = unknown,
  TEdge = unknown,
  TDisk extends { nodes?: TNode[]; edges?: TEdge[]; title?: string } | null = null
>(input: {
  /** The row from `resources`, or null when there is none / it was unreadable. */
  dbRow?: CanvasSourceDbRow | null;
  /** The parsed `.canvas` file, or null when it is absent or malformed. */
  disk?: TDisk;
  /** Title derived from the slug, used when no source supplies one. */
  fallbackTitle?: string | null;
}): ResolvedCanvasSource<TNode, TEdge> {
  const { dbRow, disk, fallbackTitle } = input;

  const dbNodes = dbRow?.metadata?.canvasData?.nodes;
  const dbHasCanvas = isNonEmptyNodeList<TNode>(dbNodes);

  if (dbHasCanvas) {
    const dbCanvas = dbRow!.metadata!.canvasData!;
    const title = dbRow!.title ?? disk?.title ?? fallbackTitle ?? undefined;
    return {
      data: {
        nodes: dbNodes,
        edges: (dbCanvas.edges as TEdge[]) ?? [],
        ...(title ? { title } : {}),
      },
      origin: 'db',
      dbRowWasEmpty: false,
      title: title ?? null,
    };
  }

  /**
   * The row is missing, unreadable, or has no canvas. Fall through to disk: a
   * populated `.canvas` file is strictly better than an empty board, and this is
   * the case the old `if (!initialData)` check missed, because it had already
   * been handed a truthy object built from an empty array.
   */
  if (disk && Array.isArray(disk.nodes) && disk.nodes.length > 0) {
    return {
      data: { nodes: disk.nodes, edges: disk.edges ?? [], title: disk.title },
      origin: 'disk',
      dbRowWasEmpty: !!dbRow,
      title: disk.title ?? dbRow?.title ?? fallbackTitle ?? null,
    };
  }

  return {
    data: null,
    origin: 'none',
    dbRowWasEmpty: !!dbRow && !dbHasCanvas,
    title: dbRow?.title ?? disk?.title ?? fallbackTitle ?? null,
  };
}

/** Message shown when nothing could be resolved, so the board is not just blank. */
export function describeMissingCanvas(slug: string): string {
  return `No canvas named “${slug}” was found. It may have been deleted, or the link may be wrong.`;
}
