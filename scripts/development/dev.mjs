#!/usr/bin/env node
/**
 * Start only the workspaces you need (D-072):
 *   npm run dev:business | dev:academic | dev:marketing | dev:platform | dev:all
 * Ports come from BUSINESS_OPS_OS_URL / ACADEMIC_OS_URL / MARKETING_OS_URL / PLATFORM_URL in the
 * root .env (defaults 3000 / 3001 / 3002 / 3003). The local PostgreSQL server is the only shared
 * dependency: if nothing listens on the DATABASE_URL port it is started once here (and stopped
 * with Ctrl+C); if it already runs (npm run db:start, or another dev command) it is reused.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { APP_URL_DEFAULTS, APP_URL_VARS } from '../../packages/configuration/src/workspaces.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync(envFile, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const APPS = { business: ['ops', 'business-ops-os'], academic: ['academic', 'academic-os'], marketing: ['marketing', 'marketing-os'], platform: ['platform', 'platform'] };
const names = process.argv.slice(2).flatMap((a) => (a === 'all' ? ['business', 'academic', 'marketing'] : [a]));
const unknown = names.filter((n) => !(n in APPS));
if (names.length === 0 || unknown.length > 0) {
  console.error(`dev — usage: dev.mjs <${Object.keys(APPS).join('|')}|all>...${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}`);
  process.exit(1);
}

const children = [];
const run = (label, args, cwd = repoRoot) => {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`dev — ${label} exited (${code ?? 'signal'}); stopping the rest.`);
    stop();
  });
  children.push(child);
};
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGINT');
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, stop);

const listening = (host, port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => (socket.end(), resolve(true)));
    socket.on('error', () => resolve(false));
  });

const db = new URL(process.env.DATABASE_URL ?? 'pglite://memory');
if (/^postgres(ql)?:$/.test(db.protocol) && ['localhost', '127.0.0.1'].includes(db.hostname)) {
  const port = Number(db.port || 5432);
  if (await listening('127.0.0.1', port)) console.log(`dev — reusing the database already running on port ${port}.`);
  else run('database', [path.join(repoRoot, 'scripts/development/db-server.mjs')]);
}

// Turbopack's native binary is blocked by Windows Application Control on the office PCs, so dev uses webpack.
const nextBin = path.join(repoRoot, 'node_modules/next/dist/bin/next');
for (const name of names) {
  const [key, dir] = APPS[name];
  const url = new URL(process.env[APP_URL_VARS[key]] || APP_URL_DEFAULTS[key]);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  console.log(`dev — ${name}: ${url.origin}`);
  run(name, [nextBin, 'dev', '--webpack', '--port', port], path.join(repoRoot, 'apps', dir));
}
