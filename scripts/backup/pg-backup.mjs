#!/usr/bin/env node
/**
 * PostgreSQL backup — `npm run db:backup`.
 *
 * Wraps `pg_dump --format=custom` for the Elevate schemas (core, marketing,
 * academic, ops, drizzle) of DATABASE_URL and writes
 *   .data/backups/<database>-<YYYYMMDD-HHMMSS>.dump
 * The password is passed through PGPASSWORD (never on the command line).
 *
 * pg_dump is NOT bundled with embedded-postgres on Windows. Install the
 * PostgreSQL client tools (same or newer major version than the server, i.e.
 * 18 for the dev server) and either put their bin folder on PATH or set
 * PG_BIN_DIR, e.g.  PG_BIN_DIR="C:\Program Files\PostgreSQL\18\bin".
 *
 * Options:
 *   --out <dir>    output directory (default .data/backups)
 *
 * Restore (see infrastructure/database/README.md):
 *   pg_restore --clean --if-exists --no-owner --dbname "<DATABASE_URL>" <file>.dump
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync(envFile, 'utf8'))))
    if (process.env[k] === undefined) process.env[k] = v;
}

function fail(message, code = 1) {
  console.error(`db:backup — ${message}`);
  process.exit(code);
}

const raw = process.env.DATABASE_URL;
if (!raw || !/^postgres(ql)?:\/\//.test(raw))
  fail(
    'DATABASE_URL must be a postgres:// URL (PGlite directories are backed up by copying the folder while no app is running).',
  );
const url = new URL(raw);
const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
function findPgDump() {
  if (process.env.PG_BIN_DIR) {
    const candidate = path.join(process.env.PG_BIN_DIR, exe);
    return existsSync(candidate) ? candidate : null;
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump'], {
    encoding: 'utf8',
  });
  if (which.status === 0) return which.stdout.split(/\r?\n/).find(Boolean) ?? null;
  return null;
}
const pgDump = findPgDump();
if (!pgDump) {
  fail(
    'pg_dump was not found. Install the PostgreSQL 18 client tools and add their bin folder to PATH, or set PG_BIN_DIR. ' +
      'Nothing was backed up.',
    2,
  );
}

const outIndex = process.argv.indexOf('--out');
const outDir = path.resolve(
  root,
  outIndex > -1 && process.argv[outIndex + 1] ? process.argv[outIndex + 1] : '.data/backups',
);
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = path.join(outDir, `${database}-${stamp}.dump`);

const args = [
  '--format=custom',
  '--no-owner',
  '--no-privileges',
  `--host=${url.hostname}`,
  `--port=${url.port || 5432}`,
  `--username=${decodeURIComponent(url.username)}`,
  `--dbname=${database}`,
  `--file=${file}`,
  ...['core', 'marketing', 'academic', 'ops', 'drizzle'].map((s) => `--schema=${s}`),
];
console.log(`db:backup — ${pgDump} → ${path.relative(root, file)}`);
const result = spawnSync(pgDump, args, {
  stdio: 'inherit',
  env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
});
if (result.status !== 0)
  fail(`pg_dump exited with ${result.status}. The partial file (if any) is not a valid backup.`);
console.log(
  `db:backup — done: ${path.relative(root, file)} (${statSync(file).size} bytes). Verify with: pg_restore --list "${file}"`,
);
