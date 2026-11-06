/**
 * Backup and restore of the local database without pg_dump (D-024).
 *   npm run db:backup                              (also: node .data/json-backup.mjs)
 *   npm run db:restore -- <backup folder> [--replace]
 *
 * Backup: one read-only snapshot of every table in the Elevate schemas, one NDJSON file per table in
 * .data/backups/<date_time>/ plus manifest.json (rows and sha256 per file, applied migrations). Each
 * line is PostgreSQL's own row_to_json, so bigint, numeric, timestamps and jsonb stay exact; bytea is
 * base64. Rows come through a cursor, so only disk space limits the size.
 *
 * Restore refuses unless the database is on this computer, at the same migration level, empty (or
 * --replace, which saves the current data first) and every file matches its checksum. It loads all
 * tables in one transaction with foreign keys checked at the end (18 tables point at themselves, so
 * no parent-first table order exists), compares row counts with the manifest, and undoes everything
 * on any failure. Runs with plain `node` (type stripping): no imports from the workspace packages.
 */
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

/** node-postgres Client and PGlite both fit. */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
interface Migration {
  hash: string;
  created_at: string;
  tag: string | null;
}
interface Manifest {
  format: 'elevate-json-backup/1';
  createdAt: string;
  tables: { table: string; file: string; rows: number; sha256: string }[];
  migrations: Migration[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMAS = `('core', 'marketing', 'academic', 'ops', 'drizzle')`;
const MIGRATIONS = 'drizzle.__drizzle_migrations';
const UNCHANGED = 'Nothing was changed.';
const count = (n: number) => n.toLocaleString('en-IN');

async function tablesOf(c: SqlClient): Promise<string[]> {
  const { rows } = await c.query(`select format('%I.%I', table_schema, table_name) t
    from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ${SCHEMAS} order by 1`);
  return rows.map((r) => String(r.t));
}

async function columnsOf(c: SqlClient, table: string) {
  const { rows } = await c.query(
    `select quote_ident(attname) id, quote_literal(attname) key, atttypid = 'bytea'::regtype bytes
     from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`,
    [table],
  );
  return rows as { id: string; key: string; bytes: boolean }[];
}

async function migrationsOf(c: SqlClient): Promise<Migration[]> {
  if (!(await c.query(`select to_regclass('${MIGRATIONS}') t`)).rows[0]?.t) return [];
  const journal: { tag: string; when: number }[] = JSON.parse(
    readFileSync(path.join(ROOT, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
  ).entries;
  const { rows } = await c.query(
    `select hash, created_at::text created_at from ${MIGRATIONS} order by created_at, id`,
  );
  return rows.map((r) => ({
    hash: String(r.hash),
    created_at: String(r.created_at),
    tag: journal.find((e) => String(e.when) === r.created_at)?.tag ?? null,
  }));
}

export async function backup(c: SqlClient, parent = path.join(ROOT, '.data', 'backups')) {
  mkdirSync(parent, { recursive: true });
  const stamp = new Date().toLocaleString('sv-SE').replace(' ', '_').replaceAll(':', '-');
  const folder = path.join(parent, stamp);
  mkdirSync(folder); // fails rather than mix two backups made in the same second
  const tables: Manifest['tables'] = [];
  await c.query('begin isolation level repeatable read read only');
  try {
    for (const table of await tablesOf(c)) {
      const columns = await columnsOf(c, table);
      const list = columns.map((x) => (x.bytes ? `encode(${x.id}, 'base64') ${x.id}` : x.id));
      await c.query(
        `declare backup_rows no scroll cursor for select row_to_json(x)::text j from (select ${list.join(', ')} from ${table}) x`,
      );
      const file = `${table.replaceAll('"', '')}.ndjson`;
      const out = createWriteStream(path.join(folder, file));
      const hash = createHash('sha256');
      let rows = 0;
      for (;;) {
        const batch = (
          await c.query(`fetch ${columns.some((x) => x.bytes) ? 4 : 1000} from backup_rows`)
        ).rows;
        if (!batch.length) break;
        const text = batch.map((r) => `${r.j}\n`).join('');
        hash.update(text);
        rows += batch.length;
        if (!out.write(text)) await once(out, 'drain');
      }
      await c.query('close backup_rows');
      out.end();
      await once(out, 'finish');
      tables.push({ table, file, rows, sha256: hash.digest('hex') });
    }
    const manifest: Manifest = {
      format: 'elevate-json-backup/1',
      createdAt: new Date().toISOString(),
      tables,
      migrations: await migrationsOf(c),
    };
    writeFileSync(path.join(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return { folder, manifest };
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  } finally {
    await c.query('rollback');
  }
}

const sha256 = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

// shortcut: a jsonb value that is JSON null comes back as SQL NULL (the app reads both as null); keep the value apart if a column ever needs the difference.
async function load(c: SqlClient, folder: string, { table, file }: Manifest['tables'][number]) {
  const columns = await columnsOf(c, table);
  const values = columns.map((x) => (x.bytes ? `decode(e->>${x.key}, 'base64')` : `r.${x.id}`));
  const insert = `insert into ${table} (${columns.map((x) => x.id).join(', ')}) select ${values.join(', ')}
    from json_array_elements($1::json) e, json_populate_record(null::${table}, e) r`;
  let batch: string[] = [];
  let size = 0;
  const flush = async () => {
    if (batch.length) await c.query(insert, [`[${batch.join(',')}]`]);
    [batch, size] = [[], 0];
  };
  // Not readline: it also splits at U+2028/U+2029, which JSON strings may hold unescaped.
  let rest = '';
  const input = createReadStream(path.join(folder, file), {
    encoding: 'utf8',
    highWaterMark: 1 << 20,
  });
  for await (const chunk of input) {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop()!;
    for (const line of lines) {
      batch.push(line);
      size += line.length;
      if (batch.length >= 500 || size > 4_000_000) await flush();
    }
  }
  if (rest) batch.push(rest);
  await flush();
}

export async function restore(c: SqlClient, folder: string, { replace = false } = {}) {
  const manifestFile = path.join(folder, 'manifest.json');
  if (!existsSync(manifestFile))
    throw new Error(`${folder} is not a finished backup (it has no manifest.json). ${UNCHANGED}`);
  const manifest: Manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  for (const { file, sha256: expected } of manifest.tables)
    if (
      !existsSync(path.join(folder, file)) ||
      (await sha256(path.join(folder, file))) !== expected
    )
      throw new Error(
        `the backup is damaged or was edited: ${file} does not match manifest.json. ${UNCHANGED}`,
      );

  const level = (list: Migration[]) => list.map((m) => `${m.hash}@${m.created_at}`).join();
  const named = (list: Migration[]) => list.at(-1)?.tag ?? `${list.length} updates`;
  const here = await migrationsOf(c);
  if (level(here) !== level(manifest.migrations))
    throw new Error(
      `the backup was taken at database version ${named(manifest.migrations)}, but this database is at ${named(here)}. ` +
        `They must be the same; if this database is older, run npm run db:migrate first. ${UNCHANGED}`,
    );
  const data = manifest.tables.filter((t) => t.table !== MIGRATIONS);
  const tables = (await tablesOf(c)).filter((t) => t !== MIGRATIONS);
  if (
    [...tables].sort().join() !==
    data
      .map((t) => t.table)
      .sort()
      .join()
  )
    throw new Error(`this database does not have the same tables as the backup. ${UNCHANGED}`);
  const filled: string[] = [];
  for (const t of tables)
    if ((await c.query(`select exists (select from ${t}) x`)).rows[0]?.x) filled.push(t);
  if (filled.length && !replace)
    throw new Error(
      `this database already has data (${filled.slice(0, 3).join(', ')}${filled.length > 3 ? ', …' : ''}). ` +
        `To throw it away and put the backup in its place, run the same command with --replace at the end ` +
        `(what is there now is backed up first). ${UNCHANGED}`,
    );

  await c.query('begin');
  try {
    if (filled.length) await c.query(`truncate ${tables.join(', ')}`);
    const keys = (
      await c.query(`select format('%I.%I', n.nspname, r.relname) t, quote_ident(conname) k
        from pg_constraint join pg_class r on r.oid = conrelid join pg_namespace n on n.oid = r.relnamespace
        where contype = 'f' and not condeferrable and n.nspname in ${SCHEMAS}`)
    ).rows;
    for (const { t, k } of keys)
      await c.query(`alter table ${t} alter constraint ${k} deferrable initially deferred`);
    for (const t of data) await load(c, folder, t);
    await c.query('set constraints all immediate'); // every foreign key is checked here
    for (const { t, k } of keys)
      await c.query(`alter table ${t} alter constraint ${k} not deferrable`);
    for (const t of data) {
      const n = Number((await c.query(`select count(*) n from ${t.table}`)).rows[0]?.n);
      if (n !== t.rows)
        throw new Error(`${t.table}: the backup lists ${t.rows} rows but ${n} were loaded`);
    }
    await c.query('commit');
  } catch (error) {
    await c.query('rollback');
    throw new Error(
      `restore stopped: ${(error as Error).message}. Everything was undone. ${UNCHANGED}`,
      { cause: error },
    );
  }
  // Same totals as the backup printed; the migration list was compared above rather than loaded.
  return {
    tables: manifest.tables.length,
    rows: manifest.tables.reduce((sum, t) => sum + t.rows, 0),
  };
}

/**
 * Why a database address is not this computer's PostgreSQL, or null when it is. Same rule as
 * isLocalDatabaseUrl in @elevate/configuration, which this file cannot import (plain node).
 */
export function notLocal(databaseUrl: string): string | null {
  const url = URL.parse(databaseUrl);
  if (!url || !/^postgres(ql)?:$/.test(url.protocol))
    return 'DATABASE_URL in .env must be a postgres:// address.';
  // node-postgres connects to ?host= instead of the address; libpq also reads ?hostaddr=.
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr'))
    return 'refusing: DATABASE_URL has a ?host= or ?hostaddr= part, which can send the connection to another computer. Remove that part and point it at 127.0.0.1 (this computer).';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return `refusing: DATABASE_URL points at another computer (${url.hostname}). This only works with the database on this computer.`;
  return null;
}

const USAGE = `say what to do:
  npm run db:backup
  npm run db:restore -- .data/backups/<folder> [--replace]`;

export async function main(args: string[]) {
  const [command, ...rest] = args;
  const name = command === 'restore' ? 'db:restore' : 'db:backup';
  const say = (text: string) => console.log(`${name} — ${text}`);
  try {
    if (command !== 'backup' && command !== 'restore') throw new Error(USAGE);
    const folder = rest.find((a) => !a.startsWith('--'));
    if (command === 'restore' && !folder) throw new Error(USAGE);
    const envFile = path.join(ROOT, '.env');
    if (existsSync(envFile))
      for (const [k, v] of Object.entries(parseEnv(readFileSync(envFile, 'utf8'))))
        process.env[k] ??= v;
    const refusal = notLocal(process.env.DATABASE_URL ?? '');
    if (refusal) throw new Error(`${refusal} ${UNCHANGED}`);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const saved = async () => {
        const { folder: out, manifest } = await backup(client);
        const rows = manifest.tables.reduce((sum, t) => sum + t.rows, 0);
        const mb =
          manifest.tables.reduce((sum, t) => sum + statSync(path.join(out, t.file)).size, 0) / 1e6;
        return `${manifest.tables.length} tables, ${count(rows)} rows (${mb.toFixed(1)} MB) in ${path.relative(ROOT, out)}`;
      };
      if (command === 'backup') {
        say(`saved ${await saved()}.`);
        say(
          'it holds personal data and password hashes: keep it on this computer; never share, upload or commit it.',
        );
        return;
      }
      const replace = rest.includes('--replace');
      if (replace) say(`your current data was saved first: ${await saved()}.`);
      const done = await restore(client, path.resolve(folder!), { replace });
      say(
        `restored ${done.tables} tables, ${count(done.rows)} rows from ${folder}; every row count matches the backup.`,
      );
      say('next: npm run db:check');
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error(`${name} — ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main(process.argv.slice(2));
