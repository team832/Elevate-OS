import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { departments, users } from '../src/index';
import { isUniqueViolation } from '../src/errors';
import { createTestDb, type TestDatabase } from '../src/testing';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe('createTestDb', () => {
  it('creates all four schemas', async () => {
    const result = await t.pglite.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('core','marketing','academic','ops') ORDER BY 1`,
    );
    expect(result.rows.map((r) => r.schema_name)).toEqual(['academic', 'core', 'marketing', 'ops']);
  });

  it('creates every core table', async () => {
    const result = await t.pglite.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'core' ORDER BY 1`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      'approvals',
      'audit_events',
      'branches',
      'departments',
      'event_deliveries',
      'idempotency_keys',
      'integration_events',
      'notifications',
      'programmes',
      'sessions',
      'staff_members',
      'students',
      'user_preferences',
      'user_roles',
      'users',
    ]);
  });

  it('enforces constraints (unique email, lower-case email, code format)', async () => {
    await t.db.insert(users).values({ email: 'one@example.test', displayName: 'One (fictional)' });
    await expect(
      t.db.insert(users).values({ email: 'one@example.test', displayName: 'Dup (fictional)' }),
    ).rejects.toSatisfy((e: unknown) => isUniqueViolation(e, 'users_email_key'));
    await expect(
      t.db.insert(users).values({ email: 'Upper@Example.test', displayName: 'X' }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(departments).values({ code: 'bad code', name: 'X' }),
    ).rejects.toThrow();
    const result = await t.pglite.query<{ id: string }>('SELECT gen_random_uuid() AS id');
    expect(result.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives each call an isolated database', async () => {
    const other = await createTestDb();
    try {
      const rows = await other.db.select().from(users);
      expect(rows).toHaveLength(0);
    } finally {
      await other.close();
    }
  });
});

describe('schema discovery', () => {
  it('creates a table for EVERY table exported by the four schema files (module tables included)', async () => {
    const { is } = await import('drizzle-orm');
    const { PgTable, getTableConfig } = await import('drizzle-orm/pg-core');
    const { schema } = await import('../src/schema/index');
    const expected = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((table) => {
        const config = getTableConfig(table as InstanceType<typeof PgTable>);
        return `${config.schema ?? 'public'}.${config.name}`;
      })
      .sort();
    const result = await t.pglite.query<{ name: string }>(
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
       WHERE table_schema IN ('core','marketing','academic','ops') ORDER BY 1`,
    );
    expect(result.rows.map((r) => r.name)).toEqual(expected);
  });

  it('turns a table declared with a module pgSchema into DDL (what createTestDb does with module files)', async () => {
    // Simulates a module team adding a table to src/schema/ops.ts: the same
    // generateDrizzleJson/generateMigration path must emit CREATE TABLE in that schema.
    const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
    const opsLike = pgSchema('ops');
    const opsProbe = opsLike.table('probe_items', {
      id: uuid('id').primaryKey().defaultRandom(),
      name: text('name').notNull(),
    });
    const empty = generateDrizzleJson({}, undefined, ['ops']);
    const current = generateDrizzleJson({ opsLike, opsProbe }, empty.id, ['ops']);
    const ddl = (await generateMigration(empty, current)).join('\n');
    expect(ddl).toContain('CREATE SCHEMA "ops"');
    expect(ddl).toContain('CREATE TABLE "ops"."probe_items"');
  });
});
