/**
 * Helpers to recognise PostgreSQL errors through Drizzle's wrappers
 * (DrizzleQueryError keeps the driver error in `cause`).
 */
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { PgPreparedQuery } from 'drizzle-orm/pg-core';

/**
 * Drizzle writes every bound value into a failed query's message, and PostgreSQL quotes values in
 * `detail`, `where`, `hint` and some messages. Whatever handles the error next (our logger,
 * console.error, Next itself, an event's stored last error) prints that, so it goes here, where the
 * error is made. The statement holds only placeholders; code, constraint, table and column stay.
 */
function withoutValues(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error;
  const retitle = (e: { message: string; stack?: string }, message: string) => {
    if (e.stack) e.stack = e.stack.replace(e.message, () => message);
    e.message = message;
  };
  retitle(error, `Failed query: ${error.query}`);
  (error as unknown as { params: unknown[] }).params = [];
  const pg = findPgError(error.cause);
  if (pg) {
    retitle(pg, `PostgreSQL error ${pg.code}`);
    // `params` and `queryOptions` are PGlite's own copies.
    for (const field of ['detail', 'hint', 'where', 'internalQuery', 'params', 'queryOptions'])
      delete (pg as unknown as Record<string, unknown>)[field];
  }
  return error;
}

// shortcut: patches an @internal Drizzle method, pinned by the exact version; query-errors.test.ts fails if it moves.
const prepared = PgPreparedQuery.prototype as unknown as {
  queryWithCache(...args: unknown[]): Promise<unknown>;
};
const runQuery = prepared.queryWithCache;
prepared.queryWithCache = function (this: unknown, ...args: unknown[]) {
  return runQuery.apply(this, args).catch((error: unknown) => {
    throw withoutValues(error);
  });
};

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
