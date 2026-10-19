/**
 * Helpers to recognise PostgreSQL errors through Drizzle's wrappers
 * (DrizzleQueryError keeps the driver error in `cause`).
 */
export interface PgErrorLike {
  code: string;
  constraint?: string;
  detail?: string;
  message: string;
}

export function findPgError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return current as PgErrorLike;
    }
    current =
      typeof current === 'object' && current !== null
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return undefined;
}

/** 23505 unique_violation */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  return pg?.code === '23505' && (constraint === undefined || pg.constraint === constraint);
}

/** 23503 foreign_key_violation */
export function isForeignKeyViolation(error: unknown): boolean {
  return findPgError(error)?.code === '23503';
}

/** 23514 check_violation */
export function isCheckViolation(error: unknown): boolean {
  return findPgError(error)?.code === '23514';
}
