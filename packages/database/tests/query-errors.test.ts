import type { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createLogger } from '@elevate/configuration';
import { createDatabase, findPgError, programmes, type Database } from '../src/index';
import { createTestDb, type TestDatabase } from '../src/testing';

/** A failed query must not carry its values, into any log (API-009). */
const MARKER = 'MARKER_98765_43210';
let t: TestDatabase;
let db: Database;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  await db.insert(programmes).values({ code: MARKER, name: 'Sample programme' });
});
afterAll(() => t.close());

const failing = (run: () => Promise<unknown>) =>
  run().then(
    () => {
      throw new Error('expected the query to fail');
    },
    (error: unknown) => error,
  );

describe('a failed query keeps no values', () => {
  it.each<[string, string, () => Promise<unknown>]>([
    ['a bound value', '22012', () => db.execute(sql`select 1 / 0 where ${MARKER} = ${MARKER}`)],
    ['a NUL beside it', '22021', () => db.select().from(programmes).where(eq(programmes.name, `${MARKER}\0`))],
    ['the value PostgreSQL quotes in its detail', '23505', () => db.insert(programmes).values({ code: MARKER, name: 'Again' })],
    ['the whole row PostgreSQL quotes on a rule it refuses', '23514', () => db.insert(programmes).values({ code: `${MARKER}-x`, name: 'Sample' })],
    ['the value PostgreSQL quotes in its message', '22P02', () => db.execute(sql`select ${MARKER}::uuid`)],
    ['inside a transaction', '22012', () => db.transaction((tx) => tx.execute(sql`select 1 / 0 where ${MARKER} = ${MARKER}`))],
  ])('%s', async (_name, code, run) => {
    const error = await failing(run);
    const lines: string[] = [];
    createLogger({}, (line) => lines.push(line)).error('request failed', { error });
    // The logger's line, and what console.error or Next itself would print.
    for (const shown of [lines[0]!, inspect(error, { depth: 5 }), String((error as Error).stack)])
      expect(shown).not.toContain(MARKER);
    expect(findPgError(error)?.code).toBe(code);
    expect(JSON.parse(lines[0]!).error).toMatchObject({ code });
  });

  it('keeps the statement and the constraint, so the log stays useful', async () => {
    const error = await failing(() => db.insert(programmes).values({ code: MARKER, name: 'Again' }));
    const lines: string[] = [];
    createLogger({}, (line) => lines.push(line)).error('request failed', { error });
    const logged = JSON.parse(lines[0]!).error;
    expect(logged.message).toContain('insert into');
    expect(logged.constraint).toBe(findPgError(error)?.constraint);
    expect(logged.constraint).toBeTruthy();
  });
});

it('a dropped idle connection is not an uncaught exception (database restart, FEE-008)', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const handle = createDatabase('postgres://nobody@127.0.0.1:1/none');
  const pool = (handle.db as unknown as { $client: EventEmitter }).$client;
  expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
  await handle.close();
});
