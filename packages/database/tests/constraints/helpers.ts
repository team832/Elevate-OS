/**
 * Shared helpers for the constraint suite: raw-SQL inserts against a PGlite, each attempt in a
 * transaction that is always rolled back, reporting which constraint (if any) refused the row.
 */
import type { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { findPgError } from '../../src/errors';
import { createTestDb, type TestDatabase } from '../../src/testing';

export type Row = Record<string, unknown>;
export const NOW = '2026-10-21T04:30:00Z';
export const LATER = '2026-10-21T05:30:00Z';
export const FUTURE = '2099-01-01T00:00:00Z';

export function insertSql(table: string, row: Row): [string, unknown[]] {
  const cols = Object.keys(row);
  return [
    `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row),
  ];
}

/** Insert and commit; returns the new row's `id`. */
export async function insert(pg: PGlite, table: string, row: Row): Promise<string> {
  const result = await pg.query<{ id: string }>(...insertSql(table, row));
  return result.rows[0]!.id;
}

/** Runs `work` in a rolled-back transaction: its result, or the refusing constraint / SQLSTATE. */
export async function rolledBack<T>(pg: PGlite, work: () => Promise<T>): Promise<T | string> {
  await pg.exec('BEGIN');
  try {
    return await work();
  } catch (error) {
    const pgError = findPgError(error);
    return pgError?.constraint ?? pgError?.code ?? String(error);
  } finally {
    await pg.exec('ROLLBACK');
  }
}

/** Insert in a rolled-back transaction: `'ok'`, the refusing constraint, or the SQLSTATE. */
export async function attempt(pg: PGlite, table: string, row: Row): Promise<string> {
  return rolledBack(pg, async () => {
    await pg.query(...insertSql(table, row));
    return 'ok';
  });
}

/**
 * One rule: a row is built per value (values are text; Postgres casts them to the column type)
 * and each must end as `expected[value]`.
 */
export interface Case {
  rule: string;
  table: string;
  values: readonly string[];
  build: (value: string) => Row;
  expected: Record<string, string>;
}

/** A rule checked with a single row. */
export const one = (rule: string, table: string, build: () => Row, expected: string): Case => ({
  rule,
  table,
  values: ['row'],
  build,
  expected: { row: expected },
});

/** Every value of a TS vocabulary is accepted and `'bogus'` is refused by `constraint`. */
export const vocab = (
  rule: string,
  table: string,
  values: readonly string[],
  constraint: string,
  build: (value: string) => Row,
): Case => ({
  rule,
  table,
  values: [...values, 'bogus'],
  build,
  expected: { ...Object.fromEntries(values.map((v) => [v, 'ok'])), bogus: constraint },
});

/**
 * Named variants of one row: `rows[name] = [overrides, expected]`, merged into `base(overrides)`.
 * An override given as a function is read at run time (for ids created in beforeAll).
 */
export const variants = (
  rule: string,
  table: string,
  base: (overrides: Row) => Row,
  rows: Record<string, [Row, string]>,
): Case => ({
  rule,
  table,
  values: Object.keys(rows),
  build: (name) =>
    base(
      Object.fromEntries(
        Object.entries(rows[name]![0]).map(([k, v]) => [k, typeof v === 'function' ? v() : v]),
      ),
    ),
  expected: Object.fromEntries(
    Object.entries(rows).map(([name, [, expected]]) => [name, expected]),
  ),
});

/** Registers one test per case. */
export function runCases(pg: () => PGlite, cases: Case[]) {
  it.each(cases)('$rule', async ({ table, values, build, expected }) => {
    const actual: Record<string, string> = {};
    for (const value of values) actual[value] = await attempt(pg(), table, build(value));
    expect(actual).toEqual(expected);
  });
}

/** Rows every file builds on. Uses only columns that already existed before migration 0007. */
export async function seedBase(pg: PGlite) {
  const user = await insert(pg, 'core.users', {
    email: 'tester@example.test',
    display_name: 'Tester (fictional)',
  });
  const user2 = await insert(pg, 'core.users', {
    email: 'checker@example.test',
    display_name: 'Checker (fictional)',
  });
  const staff = await insert(pg, 'core.staff_members', { full_name: 'Sample Teacher' });
  const student = await insert(pg, 'core.students', {
    full_name: 'Sample Student',
    is_sample: true,
  });
  const student2 = await insert(pg, 'core.students', {
    full_name: 'Sample Sibling',
    is_sample: true,
  });
  const lead = await insert(pg, 'ops.leads', {
    code: 'LEAD-000001',
    student_name: 'Sample Student',
    guardian_email: 'guardian@example.test',
    first_received_at: NOW,
    created_by: user,
  });
  const admission = await insert(pg, 'ops.admissions', {
    code: 'ADM-000001',
    lead_id: lead,
    student_id: student,
    created_by: user,
  });
  const demo = await insert(pg, 'ops.demos', {
    admission_id: admission,
    lead_id: lead,
    fee_terms_state: 'approved',
    planned_session_count: 3,
    created_by: user,
  });
  return { user, user2, staff, student, student2, lead, admission, demo };
}

export type BaseIds = Awaited<ReturnType<typeof seedBase>>;

/** One fresh schema (createTestDb) with the base rows, for a test file's beforeAll. */
export async function setup(): Promise<{ t: TestDatabase; pg: PGlite; ids: BaseIds }> {
  const t = await createTestDb();
  return { t, pg: t.pglite, ids: await seedBase(t.pglite) };
}
