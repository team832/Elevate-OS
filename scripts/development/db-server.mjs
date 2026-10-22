#!/usr/bin/env node
/**
 * Local development PostgreSQL server (D-006a) — `npm run db:start`.
 *
 * Runs real PostgreSQL binaries shipped by the `embedded-postgres` npm package
 * (no system install, no Docker). The cluster lives in `.data/postgres` and
 * persists between runs. User, password, port and database name are taken
 * from DATABASE_URL in the root .env, e.g.
 *   DATABASE_URL=postgres://elevate:<dev password>@127.0.0.1:54320/elevate
 *
 * Refuses to run unless the URL host is localhost/127.0.0.1. Listens on
 * 127.0.0.1 only. Keep this terminal open; Ctrl+C stops the server cleanly.
 *
 *   npm run db:start            start (initialising the cluster on first run)
 *   npm run db:start -- --stop  stop a server left running by a crashed session
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = path.join(repoRoot, '.data', 'postgres');

function loadRootEnv() {
  const file = path.join(repoRoot, '.env');
  if (!existsSync(file)) return;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function fail(message) {
  console.error(`db:start — ${message}`);
  process.exit(1);
}

loadRootEnv();
const raw = process.env.DATABASE_URL;
if (!raw) fail('DATABASE_URL is not set. Copy .env.example to .env and set it.');
let url;
try {
  url = new URL(raw);
} catch {
  fail('DATABASE_URL is not a valid URL.');
}
if (!/^postgres(ql)?:$/.test(url.protocol)) {
  fail(
    `DATABASE_URL uses ${url.protocol}// — db:start only serves postgres:// URLs (pglite:// needs no server).`,
  );
}
if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
  fail(`refusing to start: DATABASE_URL host is "${url.hostname}", not localhost/127.0.0.1.`);
}
const user = decodeURIComponent(url.username || 'postgres');
const password = decodeURIComponent(url.password || '');
const port = Number(url.port || 5432);
const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'elevate';
if (!password || /^replace-with/.test(password))
  fail('set a real local password in DATABASE_URL (it is only used on this machine).');
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database))
  fail(`database name "${database}" must be a simple identifier.`);

const { default: EmbeddedPostgres } = await import('embedded-postgres');
const binaries = await import(
  `@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
).catch(() => ({}));

function pgCtl(args) {
  if (!binaries.pg_ctl) return false;
  const result = spawnSync(binaries.pg_ctl, args, { stdio: 'inherit' });
  return result.status === 0;
}

if (process.argv.includes('--stop')) {
  if (!existsSync(path.join(dataDir, 'postmaster.pid'))) {
    console.log('db:start — no running server found (no postmaster.pid).');
    process.exit(0);
  }
  process.exit(pgCtl(['stop', '-D', dataDir, '-m', 'fast']) ? 0 : 1);
}

const pidFile = path.join(dataDir, 'postmaster.pid');
if (existsSync(pidFile)) {
  const listening = await new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
  if (listening) fail(`a server is already listening on port ${port}.`);
  // A crash leaves the pid file behind and Windows may reuse its PID, so pg_ctl can neither stop nor start.
  rmSync(pidFile);
  console.log(`db:start — removed a stale postmaster.pid (nothing listening on port ${port}).`);
}

const quiet = (message) => {
  const text = String(message).trim();
  if (/ERROR|FATAL|PANIC/.test(text)) console.error(text);
};

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  authMethod: 'scram-sha-256',
  persistent: true,
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  initdbFlags: ['--encoding=UTF8'],
  onLog: quiet,
  onError: (e) => console.error(String(e)),
});

const firstRun = !existsSync(path.join(dataDir, 'PG_VERSION'));
if (firstRun) {
  console.log(
    `db:start — initialising a new cluster in ${path.relative(repoRoot, dataDir)} (first run only)…`,
  );
  await server.initialise();
}
await server.start();

const client = new pg.Client({ host: '127.0.0.1', port, user, password, database: 'postgres' });
await client.connect();
const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
if (exists.rowCount === 0) {
  await client.query(`CREATE DATABASE "${database}"`);
  console.log(`db:start — created database "${database}".`);
}
const version = (await client.query('SHOW server_version')).rows[0]?.server_version;
await client.end();

console.log(
  `db:start — PostgreSQL ${version} ready on 127.0.0.1:${port}, database "${database}", user "${user}".`,
);
console.log('db:start — leave this running; press Ctrl+C to stop.');

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\ndb:start — stopping PostgreSQL…');
  // Prefer a clean shutdown; embedded-postgres' own stop() force-kills on Windows.
  if (!pgCtl(['stop', '-D', dataDir, '-m', 'fast', '-s'])) await server.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);
setInterval(() => {}, 1 << 30);
