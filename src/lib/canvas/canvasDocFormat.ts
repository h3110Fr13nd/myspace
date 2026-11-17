/**
 * Document-level migration for `.canvas` files: the format concerns (encoding,
 * indentation, trailing newline, migration marker) that sit *around* the
 * grouping algorithm in `core/grouping.ts`.
 *
 * Kept separate from the CLI in `scripts/migrate_canvas_groups.ts` so it can be
 * unit tested without touching the filesystem.
 */
import { normalise, type NormaliseReport } from '../../components/canvas/core/grouping';
import type { CanvasNode } from '../../components/canvas/types';

/**
 * Document-level marker recording that group membership has been converted.
 * Without it a migrated document is indistinguishable from a fresh one, and
 * membership would be re-derived from geometry on every run.
 */
export const GROUPING_VERSION = 1;
export const GROUPING_MARKER = 'groupingVersion';

export interface CanvasDoc {
  title?: string;
  nodes?: CanvasNode[];
  edges?: unknown[];
  [key: string]: unknown;
}

export interface CanvasStyle {
  label: string;
  /** Escape non-ASCII as `\uXXXX` rather than emitting literal characters. */
  ascii: boolean;
  /** Verbatim trailing whitespace of the original file. */
  eol: string;
}

const INDENT = 2;

/**
 * Two encodings are in use across the corpus. Most files store text as literal
 * UTF-8, but a few were written by a serialiser that escaped every non-ASCII
 * character, so their emoji appear as surrogate pairs (`\ud83c\udf1f`).
 *
 * `JSON.stringify` has no `ensure_ascii` option, so the escaped form is
 * produced by walking the finished string by UTF-16 code unit and escaping
 * anything above 0x7f. Iterating by code unit is what makes a surrogate pair
 * come out as two escapes, matching the original bytes.
 */
export function serialise(doc: unknown, ascii: boolean, eol: string): string {
  const text = JSON.stringify(doc, null, INDENT);
  const encoded = ascii
    ? text.replace(/[\u0080-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
    : text;
  return encoded + eol;
}

export const CANVAS_ENCODINGS = [
  { label: 'unicode', ascii: false },
  { label: 'ascii-escaped', ascii: true },
] as const;

/**
 * The style that reproduces `original`, or `null` if none does.
 *
 * The body is matched exactly, and the original's trailing whitespace is then
 * carried over verbatim rather than guessed from a fixed list. One file in the
 * corpus ends in a blank line while others end in nothing, so enumerating
 * trailing-newline variants would be a losing game; preserving whatever was
 * there is simpler and more faithful.
 *
 * A null result means the body's formatting is not one this module can write,
 * so writing it would reflow the whole document. That is reported rather than
 * forced, because a data migration that also reformats its file is
 * unreviewable and can mangle stored escapes.
 */
export function detectStyle(original: string, doc: unknown): CanvasStyle | null {
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  const stem = original.slice(0, original.length - trailing.length);
  for (const encoding of CANVAS_ENCODINGS) {
    if (serialise(doc, encoding.ascii, '') === stem) {
      return {
        label: `indent2, ${encoding.label}, trailing ${JSON.stringify(trailing)}`,
        ascii: encoding.ascii,
        eol: trailing,
      };
    }
  }
  return null;
}

export interface MigratedDoc {
  doc: CanvasDoc;
  report: NormaliseReport;
  /** Ids of groups the migration removed, for auditing. */
  dissolvedGroupIds: string[];
  /** True when the input already carried `groupingVersion`. */
  wasStamped: boolean;
}

/**
 * Applies the grouping migration to a parsed document, preserving every
 * unrelated field and every per-node field the algorithm does not understand.
 */
export function migrateCanvasDoc(doc: CanvasDoc): MigratedDoc {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const wasStamped = Number(doc[GROUPING_MARKER] ?? 0) >= GROUPING_VERSION;

  // A stamped document already states its membership, so membership is not
  // re-derived from geometry; only group frames are re-fitted.
  const report = normalise(nodes, { alreadyHasParentId: wasStamped });

  const before = new Set(nodes.filter((n) => n.type === 'group').map((n) => n.id));
  const after = new Set(report.nodes.map((n) => n.id));
  const dissolvedGroupIds = [...before].filter((id) => !after.has(id));

  return {
    doc: { ...doc, nodes: report.nodes, [GROUPING_MARKER]: GROUPING_VERSION },
    report,
    dissolvedGroupIds,
    wasStamped,
  };
}

/** `true` when re-serialising the migrated document would change nothing. */
export function isSettled(original: string, doc: unknown, style: CanvasStyle): boolean {
  return serialise(doc, style.ascii, style.eol) === original;
}
