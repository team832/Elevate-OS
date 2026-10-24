#!/usr/bin/env node
/**
 * Start only the workspaces you need (D-072):
 *   npm run dev:business | dev:academic | dev:marketing | dev:platform | dev:all
 * Ports come from BUSINESS_OPS_OS_URL / ACADEMIC_OS_URL / MARKETING_OS_URL / PLATFORM_URL in the
 * root .env (defaults 3000 / 3001 / 3002 / 3003). The local PostgreSQL server is the only shared
 * dependency: if nothing listens on the DATABASE_URL port it is started once here (and stopped
 * with Ctrl+C); if it already runs (npm run db:start, or another dev command) it is reused.
 *
 * Office Wi-Fi mode (D-110): `npm run office` (after `npm run office:build`) runs the built apps
 * with `next start` on every network address, and points the four app URLs at this computer's
 * Wi-Fi address (or OFFICE_HOST from .env), so staff open http://<that address>:3000 on their own
 * devices. The database still listens on this computer only.
 */
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
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
const office = process.argv.includes('--office');
const names = process.argv.slice(2).filter((a) => a !== '--office').flatMap((a) => (a === 'all' ? ['business', 'academic', 'marketing'] : [a]));
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

/** The address this computer uses on the local network (a UDP "connect" sends nothing). */
const lanAddress = () =>
  new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.on('error', () => resolve(undefined));
    s.connect(80, '8.8.8.8', () => (resolve(s.address().address), s.close()));
  });
if (office) {
  const host = process.env.OFFICE_HOST || (await lanAddress());
  if (!host) {
    console.error('office — no network address found: connect to the Wi-Fi, or set OFFICE_HOST in .env.');
    process.exit(1);
  }
  for (const key of Object.keys(APP_URL_VARS)) {
    const port = new URL(process.env[APP_URL_VARS[key]] || APP_URL_DEFAULTS[key]).port;
    process.env[APP_URL_VARS[key]] = `http://${host}:${port}`;
  }
  const unbuilt = names.filter((n) => !existsSync(path.join(repoRoot, 'apps', APPS[n][1], '.next', 'BUILD_ID')));
  if (unbuilt.length) {
    console.error(`office — not built yet: ${unbuilt.join(', ')}. Run: npm run office:build`);
    process.exit(1);
  }
}

// Turbopack's native binary is blocked by Windows Application Control on the office PCs, so dev uses webpack.
const nextBin = path.join(repoRoot, 'node_modules/next/dist/bin/next');
for (const name of names) {
  const [key, dir] = APPS[name];
  const url = new URL(process.env[APP_URL_VARS[key]] || APP_URL_DEFAULTS[key]);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  console.log(`${office ? 'office' : 'dev'} — ${name}: ${url.origin}`);
  const mode = office ? ['start'] : ['dev', '--webpack'];
  run(name, [nextBin, ...mode, '--port', port], path.join(repoRoot, 'apps', dir));
}
