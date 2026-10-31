import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { schema } from '../../src/schema/index';
import { createTestDb, type TestDatabase } from '../../src/testing';

let t: TestDatabase;
let rows: { tbl: string; def: string }[];
beforeAll(async () => {
  t = await createTestDb();
  ({ rows } = await t.pglite.query<{ tbl: string; def: string }>(
    `SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'c'`,
  ));
});
afterAll(() => t.close());

const vocabularyColumns = () =>
  (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .flatMap((table) => {
      const { schema: ns, name, columns } = getTableConfig(table);
      const checks = rows.filter((r) => r.tbl === `${ns}.${name}`).map((r) => r.def);
      return columns
        .filter((c) => c.columnType !== 'PgEnumColumn' && (c.enumValues?.length ?? 0) > 0)
        .map((c) => ({
          id: `${ns}.${name}.${c.name}`,
          name: c.name,
          values: c.enumValues!,
          checks,
        }));
    });

// A `text(..., { enum })` vocabulary is only a TypeScript type; without a CHECK the database accepts 'bogus'.
it('every text column with a TypeScript vocabulary has a CHECK that mentions it', () => {
  const missing = vocabularyColumns()
    .filter((c) => !c.checks.some((def) => new RegExp(`\\b${c.name}\\b`).test(def)))
    .map((c) => c.id);
  expect(missing).toEqual([]);
});

// Drift: the column's `col = ANY (ARRAY[...])` lists use only TypeScript values, and one of them (the
// vocabulary CHECK) is the whole vocabulary; narrower lists are conditional rules.
const NARROWED = ['marketing.placement_groups.platform']; // collabs: Instagram and YouTube only (BR-MKT-4)
it('the vocabulary CHECK lists exactly the TypeScript values', () => {
  const drift = vocabularyColumns().flatMap((c) => {
    const ts = [...c.values].sort().join('|');
    const lists = c.checks.flatMap((def) =>
      [...def.matchAll(new RegExp(`\\(${c.name} = ANY \\(ARRAY\\[([^\\]]*)\\]`, 'g'))].map((m) =>
        [...m[1]!.matchAll(/'((?:[^']|'')*)'::text/g)].map((v) => v[1]!).sort(),
      ),
    );
    const unknown = lists.flat().filter((v) => !c.values.includes(v));
    const noFullList =
      lists.length && !NARROWED.includes(c.id) && !lists.some((l) => l.join('|') === ts);
    return unknown.length || noFullList
      ? [`${c.id}: db [${lists.map((l) => l.join(',')).join(' / ')}] ts [${ts}]`]
      : [];
  });
  expect(drift).toEqual([]);
});
