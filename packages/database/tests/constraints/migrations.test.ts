import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/migrate';
import { createTestDb } from '../../src/testing';
import { NOW, insert, seedBase } from './helpers';

const { entries } = JSON.parse(
  readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
) as { entries: { idx: number; tag: string }[] };
const pad = (n: number) => String(n).padStart(4, '0');

/** Applies one migration file the way drizzle's migrator does (statement by statement). */
async function apply(pg: PGlite, tag: string) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await pg.exec(statement);
  }
}

const SCHEMAS = `('core', 'marketing', 'academic', 'ops')`;
/** Columns, constraint definitions and index definitions (column order ignored). */
async function shape(pg: PGlite) {
  const result = await pg.query<{ s: string }>(`
    SELECT 'col ' || table_schema || '.' || table_name || '.' || column_name || ' ' || data_type
      || ' nullable=' || is_nullable || ' default=' || coalesce(column_default, '') AS s
      FROM information_schema.columns WHERE table_schema IN ${SCHEMAS}
    UNION ALL SELECT 'con ' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname IN ${SCHEMAS}
    UNION ALL SELECT 'idx ' || indexdef FROM pg_indexes WHERE schemaname IN ${SCHEMAS}
    ORDER BY 1`);
  return result.rows.map((r) => r.s);
}

describe('migration journal', () => {
  it('numbers entries 0..n in order and each tag starts with its number', () => {
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    expect(entries.map((e) => e.tag.slice(0, 5))).toEqual(entries.map((e) => `${pad(e.idx)}_`));
  });

  it('matches the .sql files and snapshots one to one', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(entries.map((e) => `${e.tag}.sql`)).toEqual(files);
    const snapshots = readdirSync(path.join(MIGRATIONS_DIR, 'meta'))
      .filter((f) => f.endsWith('_snapshot.json'))
      .sort();
    expect(snapshots).toEqual(entries.map((e) => `${pad(e.idx)}_snapshot.json`));
  });
});

describe('migrations apply in order on a fresh database', () => {
  const pg = new PGlite();
  afterAll(() => pg.close());

  it.each(entries)('applies $tag', async ({ tag }) => {
    await expect(apply(pg, tag)).resolves.toBeUndefined();
  });

  it('end in exactly the schema createTestDb builds from the TypeScript files (no drift)', async () => {
    const fresh = await createTestDb();
    try {
      const migrated = await shape(pg);
      expect(migrated.length).toBeGreaterThan(1000); // not vacuous: every column/constraint/index
      expect(migrated).toEqual(await shape(fresh.pglite));
    } finally {
      await fresh.close();
    }
  });
});

describe('0007 backfill', () => {
  const pg = new PGlite();
  const at0007 = entries.findIndex((e) => e.tag === '0007_admissions_lifecycle');
  let demo = '';
  beforeAll(async () => {
    for (const { tag } of entries.slice(0, at0007)) await apply(pg, tag);
    ({ demo } = await seedBase(pg));
    for (const n of [1, 2, 3]) {
      await insert(pg, 'ops.demo_sessions', { demo_id: demo, session_number: n, starts_at: NOW });
    }
    await apply(pg, entries[at0007]!.tag);
  });
  afterAll(() => pg.close());

  it('gives each legacy demo session day_number = session_number and the demo planned_day_count = sessions', async () => {
    const sessions = await pg.query(
      `SELECT session_number, day_number FROM ops.demo_sessions ORDER BY 1`,
    );
    expect(sessions.rows).toEqual([1, 2, 3].map((n) => ({ session_number: n, day_number: n })));
    const demos = await pg.query(`SELECT planned_day_count FROM ops.demos WHERE id = $1`, [demo]);
    expect(demos.rows).toEqual([{ planned_day_count: 3 }]);
  });
});
