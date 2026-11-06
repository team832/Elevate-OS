/**
 * `npm run db:check` — READ-ONLY health check of the local database: the live schema must equal
 * the code's schema (tables, columns, defaults, constraints, indexes, enums, as built by
 * createTestDb), every journal migration is applied, indexes and constraints are valid, and
 * sample rows follow D-036 (@example.test emails, phones only from the fake block). Refuses non-local URLs.
 */
import pg from 'pg';
import { isLocalDatabaseUrl, loadEnv } from '@elevate/configuration';
import { loadRootEnv } from '@elevate/configuration/node';
import { FAKE_PHONE_PATTERN } from '@elevate/database/seed';
import { createTestDb } from '@elevate/database/testing';
import { pendingMigrations } from './migration-status.ts';

loadRootEnv();
const env = loadEnv('database');
if (!isLocalDatabaseUrl(env.DATABASE_URL) || env.DATABASE_URL.startsWith('pglite')) {
  console.error('db:check — refusing: DATABASE_URL must be a local postgres:// URL.');
  process.exit(1);
}

const SCHEMAS = `('core','marketing','academic','ops')`;
const live = new pg.Client({ connectionString: env.DATABASE_URL });
await live.connect();
const { rows: tracking } = await live.query(`select to_regclass('drizzle.__drizzle_migrations') t`);
if (!tracking[0].t) {
  console.error('db:check — no migrations applied on this database. Run: npm run db:migrate');
  await live.end();
  process.exit(1);
}
await live.query('BEGIN READ ONLY');
const code = await createTestDb();
type Rows = Record<string, unknown>[];
const q = async (sql: string): Promise<Rows> => (await live.query(sql)).rows;
const results: [name: string, ok: boolean, detail: string][] = [];
const check = (name: string, ok: boolean, detail = '') => results.push([name, ok, detail]);
const none = async (name: string, sql: string) => check(name, !(await q(sql)).length, sql);

/** The same catalogue query on both databases must return identical rows. */
async function same(name: string, sql: string) {
  const keys = (rows: Rows) => rows.map((r) => Object.values(r).join('|'));
  const [a, b] = [keys(await q(sql)), keys((await code.pglite.query(sql)).rows as Rows)];
  const onlyLive = a.filter((x) => !b.includes(x));
  const onlyCode = b.filter((x) => !a.includes(x));
  check(
    name,
    !onlyLive.length && !onlyCode.length,
    `only live: ${onlyLive.slice(0, 5)} | only code: ${onlyCode.slice(0, 5)}`,
  );
}

const [{ server_version: version }] = (await q('show server_version')) as [
  { server_version: string },
];
check('server is PostgreSQL 18', version.startsWith('18'), version);
const waiting = await pendingMigrations(live);
check('every journal migration is applied', !waiting.length, `waiting: ${waiting.join(', ')}`);
await same(
  'tables match code',
  `select table_schema, table_name from information_schema.tables where table_schema in ${SCHEMAS} and table_type='BASE TABLE' order by 1,2`,
);
await same(
  'columns, types, nullability, defaults match code',
  `select table_schema, table_name, column_name, data_type, is_nullable, coalesce(column_default,'') from information_schema.columns where table_schema in ${SCHEMAS} order by 1,2,3`,
);
await same(
  'constraints match code',
  `select n.nspname, conname, pg_get_constraintdef(c.oid) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ${SCHEMAS} order by 1,2`,
);
await same(
  'indexes match code',
  `select schemaname, indexname, indexdef from pg_indexes where schemaname in ${SCHEMAS} order by 1,2`,
);
await same(
  'enum types match code',
  `select n.nspname, t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace order by 1,2,3`,
);
await none('no invalid indexes', 'select 1 from pg_index where not indisvalid');
await none(
  'all constraints validated',
  `select 1 from pg_constraint c join pg_namespace n on n.oid=c.connamespace where not convalidated and n.nspname in ${SCHEMAS}`,
);
await none(
  'user emails are @example.test, @elevateeducation.in or portal logins (@portal.invalid)',
  `select 1 from core.users where email !~ '@(example\\.test|elevateeducation\\.in|portal\\.invalid)$'`,
);

const columns = (await q(
  `select table_schema s, table_name t, string_agg(column_name, ',') cols from information_schema.columns where table_schema in ${SCHEMAS} group by 1,2 having bool_or(column_name='is_sample')`,
)) as { s: string; t: string; cols: string }[];
for (const { s, t, cols } of columns)
  for (const c of cols.split(',')) {
    const where = `from "${s}"."${t}" where is_sample and "${c}" is not null and`;
    if (/email/.test(c))
      await none(
        `${s}.${t}.${c}: sample emails are @example.test`,
        `select 1 ${where} "${c}" not like '%@example.test'`,
      );
    if (/phone|mobile|whatsapp/.test(c) && !/verified|consent|_at$/.test(c))
      await none(
        `${s}.${t}.${c}: sample phones are from the fake block`,
        `select 1 ${where} "${c}"::text !~ '${FAKE_PHONE_PATTERN}'`,
      );
  }
// These two have no is_sample column: they follow their owner.
for (const [name, sql] of [
  ['ops.guardians.phone', `select g.phone p from ops.guardians g join core.students s on s.id = g.student_id where s.is_sample`],
  ...['personal_phone', 'emergency_contact_phone'].map((c) => [
    `ops.staff_private_details.${c}`,
    `select d.${c} p from ops.staff_private_details d join ops.staff_profiles f on f.staff_id = d.staff_id where f.is_sample`,
  ]),
] as const)
  await none(
    `${name}: sample phones are from the fake block`,
    `select 1 from (${sql}) x where p is not null and p !~ '${FAKE_PHONE_PATTERN}'`,
  );

await live.query('ROLLBACK');
await live.end();
await code.close();
for (const [name, ok, detail] of results)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — ${detail}`}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(`db:check — ${results.length - failed}/${results.length} checks passed.`);
process.exitCode = failed ? 1 : 0;
