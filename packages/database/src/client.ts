import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import { schema, type Schema } from './schema/index';

/**
 * The Drizzle database type used everywhere. A transaction (`tx` inside
 * `db.transaction(async (tx) => …)`) is also a `Database`, so service
 * functions take `Database` and work inside or outside a transaction.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export type DatabaseDriver = 'node-postgres' | 'pglite';

export interface DatabaseHandle {
  readonly db: Database;
  readonly driver: DatabaseDriver;
  /** Close the pool / PGlite instance. */
  close(): Promise<void>;
  /** The underlying PGlite instance (pglite driver only) — used by tests. */
  readonly pglite?: PGlite;
}

export interface CreateDatabaseOptions {
  /** node-postgres pool size (default 10). */
  maxConnections?: number;
}

/**
 * Create a database handle from a URL (D-006):
 *   postgres://… | postgresql://…  → node-postgres pool
 *   pglite://memory                → in-memory PGlite
 *   pglite://<dir>                 → PGlite persisted in <dir> (relative to cwd)
 */
export function createDatabase(url: string, options: CreateDatabaseOptions = {}): DatabaseHandle {
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    const client =
      target === '' || target === 'memory' ? new PGlite() : new PGlite(path.resolve(target));
    const db = drizzlePglite({ client, schema }) as unknown as Database;
    return { db, driver: 'pglite', pglite: client, close: () => client.close() };
  }
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url, max: options.maxConnections ?? 10 });
    const db = drizzleNodePg({ client: pool, schema }) as unknown as Database;
    return { db, driver: 'node-postgres', close: () => pool.end() };
  }
  throw new Error('DATABASE_URL must start with postgres://, postgresql:// or pglite://');
}

// --- process-wide default handle -----------------------------------------------------------

type GlobalCache = { handle?: DatabaseHandle; url?: string; override?: Database };
const globalKey = Symbol.for('elevate.database');
function cache(): GlobalCache {
  const g = globalThis as unknown as Record<symbol, GlobalCache | undefined>;
  return (g[globalKey] ??= {});
}

/**
 * The process-wide database, created lazily from `DATABASE_URL`. Cached on
 * `globalThis` so Next.js hot reloads do not open a new pool each time.
 * Tests replace it with `setDatabaseForTesting()`.
 */
export function getDb(): Database {
  const c = cache();
  if (c.override) return c.override;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env in the repository root.');
  }
  if (!c.handle || c.url !== url) {
    c.handle = createDatabase(url);
    c.url = url;
  }
  return c.handle.db;
}

/** Make `getDb()` return `db` (pass undefined to restore). Test-only. */
export function setDatabaseForTesting(db: Database | undefined): void {
  cache().override = db;
}

/** Close the process-wide handle (scripts call this before exiting). */
export async function closeDb(): Promise<void> {
  const c = cache();
  const handle = c.handle;
  c.handle = undefined;
  c.url = undefined;
  if (handle) await handle.close();
}
