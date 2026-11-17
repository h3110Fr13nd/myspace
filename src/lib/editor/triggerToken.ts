/**
 * Helpers for the inline autocomplete triggers (`/`, `[[`, `![[`).
 *
 * These deliberately operate on the *current text block* rather than a fixed
 * character count, so a trigger + its typed query are removed atomically no
 * matter how much the user typed after the trigger.
 */

/**
 * Deletes `token` (and anything typed after it up to the cursor) inside the
 * current text block. Returns `true` when something was deleted.
 *
 * @example
 * deleteTriggerToken(editor, '[[');  // removes "[[my note" before the caret
 */
export function deleteTriggerToken(editor: any, token: string): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const idx = textBefore.lastIndexOf(token);
  if (idx === -1) return false;

  const from = $from.start() + idx;
  const to = state.selection.from;
  if (from >= to) return false;

  editor.chain().focus().deleteRange({ from, to }).run();
  return true;
}

/** Reads the query typed after the most recent `token` before the caret. */
export function readTriggerQuery(editor: any, token: string): string | null {
  const { $from } = editor.state.selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const idx = textBefore.lastIndexOf(token);
  return idx === -1 ? null : textBefore.slice(idx + token.length);
}
