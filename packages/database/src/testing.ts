/**
 * Test database helper — `import { createTestDb } from '@elevate/database/testing'`.
 *
 * Builds the CURRENT schema from all four schema files (core, marketing,
 * academic, ops) in a fresh in-memory PGlite. It does not read generated
 * migrations: drizzle-kit's programmatic API diffs an empty snapshot against
 * the live TypeScript schema and the resulting DDL is executed directly. A table
 * a module team adds to its schema file is therefore available in tests at once.
 *
 * Never import this from application code (it pulls in drizzle-kit).
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from './client';
import { MANAGED_SCHEMAS, schema } from './schema/index';

export interface TestDatabase {
  db: Database;
  pglite: PGlite;
  /** DDL statements that were applied. */
  statements: readonly string[];
  close(): Promise<void>;
}

let ddlPromise: Promise<string[]> | undefined;

/** The DDL for the current schema (memoised per process). */
export function buildSchemaDdl(): Promise<string[]> {
  ddlPromise ??= (async () => {
    const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
    const filters = [...MANAGED_SCHEMAS];
    const empty = generateDrizzleJson({}, undefined, filters);
    const current = generateDrizzleJson(
      schema as unknown as Record<string, unknown>,
      empty.id,
      filters,
    );
    return generateMigration(empty, current);
  })();
  return ddlPromise;
}

/** Create a fresh in-memory PostgreSQL (PGlite) with the full current schema. */
export async function createTestDb(): Promise<TestDatabase> {
  const statements = await buildSchemaDdl();
  const pglite = new PGlite();
  for (const statement of statements) {
    await pglite.exec(statement);
  }
  const db = drizzle({ client: pglite, schema }) as unknown as Database;
  return { db, pglite, statements, close: () => pglite.close() };
}
