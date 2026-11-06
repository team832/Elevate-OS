/**
 * scripts/backup/json-backup.ts (`npm run db:backup`, `npm run db:restore`) on two in-memory PGlite
 * databases built with the real migrations. Never the owner's database: the CLI cases use addresses
 * that cannot be reached.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDatabase, type DatabaseHandle } from '@elevate/database';
import { runMigrations } from '@elevate/database/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backup, notLocal, restore } from '../../../../scripts/backup/json-backup.ts';

const SCRIPT = path.resolve(import.meta.dirname, '../../../../scripts/backup/json-backup.ts');
const SCHEMAS = `('core', 'marketing', 'academic', 'ops', 'drizzle')`;
const work = mkdtempSync(path.join(tmpdir(), 'elevate-json-backup-'));
const handles: DatabaseHandle[] = [];
let source: PGlite;
let target: PGlite;
let folder: string;

async function migrated() {
  const handle = createDatabase('pglite://memory');
  handles.push(handle);
  await runMigrations(handle);
  return handle.pglite!;
}
const tables = async (db: PGlite) =>
  (
    await db.query<{ t: string }>(
      `select format('%I.%I', table_schema, table_name) t from information_schema.tables
       where table_type = 'BASE TABLE' and table_schema in ${SCHEMAS} order by 1`,
    )
  ).rows.map((r) => r.t);
/** Every row as PostgreSQL's own text form (bytea as hex): independent of the backup's JSON. */
const contents = async (db: PGlite) => {
  const out: Record<string, string[]> = {};
  for (const t of await tables(db))
    out[t] = (await db.query<{ r: string }>(`select x::text r from ${t} x order by 1`)).rows.map(
      (r) => r.r,
    );
  return out;
};
const constraints = async (db: PGlite) =>
  (
    await db.query(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
      union all select tgrelid::regclass::text, tgname, concat(tgdeferrable, tginitdeferred) from pg_trigger
      order by 1, 2`)
  ).rows;
const edit = (file: string, change: (text: string) => string) => {
  const before = readFileSync(file, 'utf8');
  writeFileSync(file, change(before));
  return () => writeFileSync(file, before);
};

beforeAll(async () => {
  [source, target] = [await migrated(), await migrated()];
  const [user, manager, teacher, programme, course, batch, account, snapshot] = Array.from(
    { length: 8 },
    () => randomUUID(),
  );
  const tricky = 'Sample "quoted" \\ back\nslash, नमस्ते 🎓, line separator   end';
  const steps: [string, unknown[]][] = [
    [
      `insert into core.users (id, email, display_name) values ($1, 'sample-backup@example.test', $2)`,
      [user, tricky],
    ],
    [
      `insert into core.user_preferences (user_id, settings) values ($1, $2::text::jsonb)`,
      [
        user,
        '{"paise": 12345678901234567890.123456789, "nested": {"list": [1, "two", null, true]}}',
      ],
    ],
    [
      `insert into core.staff_members (id, full_name, user_id) values ($1, 'Sample Manager', $3), ($2, 'Sample Teacher', null)`,
      [manager, teacher, user],
    ],
    // The parent row is rewritten, so it is stored (and backed up) after the row that points at it.
    [`update core.staff_members set manager_id = $1 where id = $2`, [manager, teacher]],
    [`update core.staff_members set full_name = 'Sample Manager Two' where id = $1`, [manager]],
    [
      `insert into core.programmes (id, code, name) values ($1, 'SAMPLE_BACKUP', 'Sample Programme')`,
      [programme],
    ],
    [
      `insert into academic.courses (id, programme_id, code, family_code, name) values ($1, $2, 'SAMPLE_C', 'SAMPLE', 'Sample Course')`,
      [course, programme],
    ],
    [
      `insert into academic.batches (id, code, name, course_id, programme_id) values ($1, 'SAMPLE_B', 'Sample Batch', $2, $3)`,
      [batch, course, programme],
    ],
    [
      `insert into academic.calendar_rules (batch_id, label, period_start, period_end, weekdays, slots_per_day)
       values ($1, 'Sample rule', '2026-11-01', '2027-03-31', '{1,3,5}', 2)`,
      [batch],
    ],
    [
      `insert into ops.fee_structures (programme_codes, label, mode, amount_paise, source, is_sample, updated_by)
       values ('{SAMPLE_BACKUP}', 'Sample fee', 'online', 9007199254740993, 'sample', true, $1)`,
      [user],
    ],
    [
      `insert into ops.lead_assignment_rules (counsellor_staff_ids, created_by) values (array[$1, $2]::uuid[], $3)`,
      [manager, teacher, user],
    ],
    [
      `insert into ops.leave_allowances (staff_id, leave_type, year_start, days, created_by) values ($1, 'casual', '2026-04-01', 1.5, $2)`,
      [teacher, user],
    ],
    [
      `insert into ops.staff_tasks (staff_id, title, due_on, original_due_on, due_time, created_by)
       values ($1, $2, '2026-11-07', '2026-11-07', '09:30:15.25', $3)`,
      [teacher, tricky, user],
    ],
    [
      `insert into marketing.social_accounts (id, code, platform, scope, status) values ($1, 'SBK', 'instagram', 'exam', 'later')`,
      [account],
    ],
    [
      `insert into marketing.metric_snapshots (id, source, source_label, account_id, match_status, post_key, captured_at)
       values ($1, 'manual_audit', 'Sample audit', $2, 'unmatched', 'sample-post', '2026-11-06 10:15:30.123456+05:30')`,
      [snapshot, account],
    ],
    [
      `insert into marketing.metric_values (snapshot_id, metric, state, value)
       values ($1, 'ctr_pct', 'reported', 0.1::float8 + 0.2::float8), ($1, 'views', 'missing', null)`,
      [snapshot],
    ],
    ...[3000, 8 * 1024 * 1024].map((size): [string, unknown[]] => [
      `insert into ops.attachment_files (key, bytes, size_bytes) values ($1, $2, $3)`,
      [randomUUID(), new Uint8Array(randomBytes(size)), size],
    ]),
  ];
  for (const [sql, params] of steps) await source.query(sql, params);
  folder = (await backup(source, work)).folder;
});

afterAll(async () => {
  for (const handle of handles) await handle.close();
  rmSync(work, { recursive: true, force: true });
});

describe('db:backup then db:restore', () => {
  it('the test rows hold a value in every kind of column the schema uses', async () => {
    const columns = (
      await source.query<{ t: string; c: string; type: string }>(
        `select attrelid::regclass::text t, quote_ident(attname) c, atttypid::regtype::text type
         from pg_attribute a join pg_class k on k.oid = a.attrelid
         where k.relkind = 'r' and k.relnamespace::regnamespace::text in ${SCHEMAS} and attnum > 0 and not attisdropped`,
      )
    ).rows;
    const filled = new Set<string>();
    for (const { t, c, type } of columns)
      if (
        !filled.has(type) &&
        (
          await source.query<{ x: boolean }>(
            `select exists (select from ${t} where ${c} is not null) x`,
          )
        ).rows[0]!.x
      )
        filled.add(type);
    expect([...new Set(columns.map((c) => c.type))].filter((type) => !filled.has(type))).toEqual(
      [],
    );
  });

  it('writes one checksummed file per table, bigint exact and files as base64', async () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
    expect(manifest.tables.map((t: { table: string }) => t.table)).toEqual(await tables(source));
    expect(manifest.migrations.length).toBe(
      (
        await source.query<{ n: number }>(
          `select count(*)::int n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]!.n,
    );
    const rows = (table: string) =>
      manifest.tables.find((t: { table: string }) => t.table === table);
    expect(rows('ops.attachment_files').rows).toBe(2);
    expect(rows('core.staff_members').rows).toBe(2);
    // The row that points at its manager comes first: no parent-first order exists.
    expect(readFileSync(path.join(folder, 'core.staff_members.ndjson'), 'utf8')).toMatch(
      /^.*Sample Teacher.*\n.*Sample Manager Two/,
    );
    expect(readFileSync(path.join(folder, 'ops.fee_structures.ndjson'), 'utf8')).toContain(
      '"amount_paise":9007199254740993',
    );
    // The old helper wrote ~3.6 characters per byte; base64 is ~1.37.
    expect(statSync(path.join(folder, 'ops.attachment_files.ndjson')).size).toBeLessThan(
      1.4 * 8 * 1024 * 1024,
    );
  });

  it('restores every row of every table exactly and leaves the foreign keys as they were', async () => {
    const before = await constraints(target);
    const result = await restore(target, folder);
    expect(result.rows).toBeGreaterThan(15);
    expect(await contents(target)).toEqual(await contents(source));
    expect(await constraints(target)).toEqual(before);
  });

  it('refuses a database that already has data, and --replace puts the backup in its place', async () => {
    await expect(restore(target, folder)).rejects.toThrow(
      /already has data.*--replace.*Nothing was changed/s,
    );
    await target.query(`update core.users set display_name = 'Sample Changed'`);
    await restore(target, folder, { replace: true });
    expect(await contents(target)).toEqual(await contents(source));
  });

  it.each([
    [
      'a table file was changed',
      'core.users.ndjson',
      (t: string) => t.replace('Sample', 'Simple'),
      /core\.users\.ndjson does not match/,
    ],
    [
      'a row count was changed',
      'manifest.json',
      (t: string) => t.replace(/("table": "core\.users",[^}]*"rows": )1/, '$12'),
      /core\.users: the backup lists 2 rows but 1 were loaded.*undone/s,
    ],
    [
      'the migration level differs',
      'manifest.json',
      (t: string) => t.replace(/,\s*\{\s*"hash"[^}]*\}\s*\]/, ']'),
      /database version.*db:migrate.*Nothing was changed/s,
    ],
  ])('refuses the backup when %s, and changes nothing', async (_, file, change, message) => {
    await target.query(`update core.users set display_name = 'Sample Kept'`);
    const undo = edit(path.join(folder, file), change);
    try {
      await expect(restore(target, folder, { replace: true })).rejects.toThrow(message);
    } finally {
      undo();
    }
    expect((await target.query(`select display_name from core.users`)).rows).toEqual([
      { display_name: 'Sample Kept' },
    ]);
  });
});

describe('the npm commands', () => {
  // Same rule as isLocalDatabaseUrl (packages/configuration/tests/env.test.ts).
  it.each([
    ['postgres://u:p@localhost/elevate', null],
    ['postgres://u:p@127.0.0.1:54320/elevate', null],
    ['postgres://u:p@localhost:5432/elevate?host=db.example.com', /\?host= or \?hostaddr=/],
    ['postgres://u:p@127.0.0.1:54320/elevate?hostaddr=203.0.113.5', /\?host= or \?hostaddr=/],
    ['postgres://u:p@db.example.com/elevate', /another computer \(db\.example\.com\)/],
    ['pglite://memory', /must be a postgres:\/\/ address/],
  ])('%s is this computer unless refused with %s', (url, refusal) =>
    refusal ? expect(notLocal(url)).toMatch(refusal) : expect(notLocal(url)).toBeNull(),
  );

  it.each([
    [
      'a backup of another computer',
      ['backup'],
      'postgres://u:test-only@db.example.com:5432/elevate',
      /another computer \(db\.example\.com\).*Nothing was changed/s,
    ],
    [
      'a restore into another computer',
      ['restore', 'x'],
      'postgres://u:test-only@db.example.com:5432/elevate',
      /another computer \(db\.example\.com\).*Nothing was changed/s,
    ],
    [
      'a run without backup or restore',
      [],
      'postgres://u:test-only@127.0.0.1:1/x',
      /npm run db:backup.*npm run db:restore/s,
    ],
  ])('refuse %s before connecting', (_, args, url, message) => {
    const run = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(message);
  });
});
