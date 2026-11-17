/**
 * Shared response helpers for API routes (src/pages/api/**).
 *
 * Single source of truth for JSON response shaping so routes stop
 * re-declaring `new Response(JSON.stringify(...), { headers: ... })`
 * inline (previously ~100 hand-rolled copies).
 */

export interface JsonInit {
  status?: number;
  headers?: Record<string, string>;
}

/** JSON response with the correct Content-Type header applied. */
export function json(data: unknown, init: JsonInit = {}): Response {
  const { status = 200, headers = {} } = init;
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Convenience for the common `{ error }` failure shape. */
export function apiError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return json({ error, ...extra }, { status });
}
