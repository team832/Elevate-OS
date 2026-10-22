import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { schema } from '../../src/schema/index';
import { createTestDb, type TestDatabase } from '../../src/testing';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

// A `text(..., { enum })` vocabulary is only a TypeScript type; without a CHECK the database accepts 'bogus'.
it('every text column with a TypeScript vocabulary has a CHECK that mentions it', async () => {
  const { rows } = await t.pglite.query<{ tbl: string; def: string }>(
    `SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'c'`,
  );
  const missing = (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .flatMap((table) => {
      const { schema: ns, name, columns } = getTableConfig(table);
      const checks = rows.filter((r) => r.tbl === `${ns}.${name}`).map((r) => r.def);
      return columns
        .filter((c) => c.columnType !== 'PgEnumColumn' && (c.enumValues?.length ?? 0) > 0)
        .filter((c) => !checks.some((def) => new RegExp(`\\b${c.name}\\b`).test(def)))
        .map((c) => `${ns}.${name}.${c.name}`);
    });
  expect(missing).toEqual([]);
});
