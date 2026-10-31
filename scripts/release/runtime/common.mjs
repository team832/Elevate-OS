import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { uptime } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

// These scripts are bundled into bin/ and db/, one folder below the package root.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = '.env.production';
const PID_FILE = path.join(ROOT, 'run', 'pids.json');

/** In start order: the Platform last, because it forwards to the other three (release-spec §4). */
export const APPS = [
  { key: 'ops', dir: 'business-ops-os', base: '/ops', env: 'BUSINESS_OPS_OS_URL', port: 3000, health: '/ops/api/v1/health', pdfFonts: true },
  { key: 'academic', dir: 'academic-os', base: '/academic', env: 'ACADEMIC_OS_URL', port: 3001, health: '/academic/api/v1/health', pdfFonts: true },
  { key: 'marketing', dir: 'marketing-os', base: '/marketing', env: 'MARKETING_OS_URL', port: 3002, health: '/marketing/api/v1/health', pdfFonts: true },
  { key: 'platform', dir: 'platform', base: '', env: 'PLATFORM_URL', port: 3003, health: '/api/health', pdfFonts: false },
];

export const fontFile = (app) =>
  path.join(ROOT, 'apps', app.key, 'apps', 'business-ops-os', 'assets', 'fonts', 'NotoSans-Regular.ttf');
export const appFolder = (app) => path.join(ROOT, 'apps', app.key, 'apps', app.dir);
export const originOf = (app) => process.env[app.env].replace(/\/+$/, '');
export const readManifest = () => JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

export function loadEnvFile() {
  const file = path.join(ROOT, ENV_FILE);
  if (existsSync(file)) process.loadEnvFile(file);
}

export const portOpen = (host, port) =>
  new Promise((resolve) => {
    const socket = connect({ host: host.replace(/^\[|\]$/g, ''), port: Number(port), timeout: 1500 });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });

export const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** {key: pid} from the PID file. Ignored after a restart: those numbers may now be other programs. */
export function readPids() {
  if (!existsSync(PID_FILE) || statSync(PID_FILE).mtimeMs < Date.now() - uptime() * 1000) return {};
  return JSON.parse(readFileSync(PID_FILE, 'utf8'));
}
export const pidFile = PID_FILE;

/** Stops what the PID file names, Platform first. Returns true when nothing is left running. */
export async function stopAll() {
  const pids = readPids();
  let clean = true;
  for (const [key, pid] of Object.entries(pids).reverse()) {
    if (isAlive(pid)) {
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-pid, 'SIGTERM');
      for (let i = 0; i < 50 && isAlive(pid); i += 1) await sleep(200);
      if (isAlive(pid) && process.platform !== 'win32') {
        process.kill(-pid, 'SIGKILL');
        await sleep(500);
      }
    }
    const left = isAlive(pid);
    clean &&= !left;
    console.log(`${key}: ${left ? `still running (process ${pid})` : 'stopped'}`);
  }
  if (clean) rmSync(PID_FILE, { force: true });
  return clean;
}
