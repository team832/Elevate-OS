/** A value-or-error union for domain functions that should not throw. */
export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

/** Return the value or throw the error (wrapped in an Error when it is not one). */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  const { error } = result;
  throw error instanceof Error ? error : new Error(String(error));
}
