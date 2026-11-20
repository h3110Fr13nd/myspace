/**
 * Parallel links — shared by the graph and the canvas.
 *
 * Both views draw several links between the same endpoints (named
 * relationships in the graph; several edges leaving one port on a canvas) and
 * both spread them symmetrically so each stays visible and grabbable. These
 * are the pure pieces they share.
 */

/** Offset of slot `index` among `total`, centred on 0 (e.g. -1, 0, 1 for three). */
export function centeredSlot(index: number, total: number): number {
  return total <= 1 ? 0 : index - (total - 1) / 2;
}

/** The same key for a→b and b→a. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export interface Slot {
  index: number;
  total: number;
}

/**
 * Slot of every item within its group (items with equal keys), in input order.
 * `null` keys are not grouped and get `null`.
 */
export function slotsByKey<T>(items: readonly T[], keyOf: (item: T) => string | null): Array<Slot | null> {
  const totals = new Map<string, number>();
  const keys = items.map((item) => {
    const k = keyOf(item);
    if (k !== null) totals.set(k, (totals.get(k) ?? 0) + 1);
    return k;
  });
  const seen = new Map<string, number>();
  return keys.map((k) => {
    if (k === null) return null;
    const index = seen.get(k) ?? 0;
    seen.set(k, index + 1);
    return { index, total: totals.get(k)! };
  });
}
