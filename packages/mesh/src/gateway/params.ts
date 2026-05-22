/**
 * Helpers for safely reading Express route parameters.
 *
 * Express 5's typings widen `req.params[x]` to `string | string[]`, but route
 * params are always strings at runtime. These helpers narrow the type safely
 * without requiring callers to repeat the same coercion logic.
 */

/**
 * Coerce an Express route parameter to a single string. Returns an empty
 * string if the value is `undefined`, and the first element if the value is
 * (unexpectedly) an array.
 */
export function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
