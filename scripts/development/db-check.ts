/**
 * `npm run db:check` — READ-ONLY health check of the local database: the live schema must equal
 * the code's schema (tables, columns, defaults, constraints, indexes, enums, as built by
 * createTestDb), every journal migration is applied, indexes and constraints are valid, and
 * sample rows follow D-036 (@example.test emails, no phone numbers). Refuses non-local URLs.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { isLocalDatabaseUrl, loadEnv } from '@elevate/configuration';
import { loadRootEnv } from '@elevate/configuration/node';
import { createTestDb } from '@elevate/database/testing';

loadRootEnv();
const env = loadEnv('database');
if (!isLocalDatabaseUrl(env.DATABASE_URL) || env.DATABASE_URL.startsWith('pglite')) {
  console.error('db:check — refusing: DATABASE_URL must be a local postgres:// URL.');
  process.exit(1);
}

const SCHEMAS = `('core','marketing','academic','ops')`;
const live = new pg.Client({ connectionString: env.DATABASE_URL });
await live.connect();
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
const journal = JSON.parse(readFileSync('packages/database/migrations/meta/_journal.json', 'utf8'))
  .entries.length;
const [{ n: applied }] = (await q('select count(*)::int n from drizzle.__drizzle_migrations')) as [
  { n: number },
];
check('every journal migration is applied', applied === journal, `${applied}/${journal}`);
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
  'user emails are @example.test or @elevateeducation.in',
  `select 1 from core.users where email !~ '@(example\\.test|elevateeducation\\.in)$'`,
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
        `${s}.${t}.${c}: sample rows have no phone`,
        `select 1 ${where} "${c}"::text <> ''`,
      );
  }

await live.query('ROLLBACK');
await live.end();
await code.close();
for (const [name, ok, detail] of results)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — ${detail}`}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(`db:check — ${results.length - failed}/${results.length} checks passed.`);
process.exitCode = failed ? 1 : 0;
