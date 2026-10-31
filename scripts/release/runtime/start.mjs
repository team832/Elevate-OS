/** Source of bin/start.mjs: starts the four apps in the background, each logging to logs/<app>.log. */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { APPS, ROOT, appFolder, isAlive, loadEnvFile, originOf, pidFile, portOpen, readPids, stopAll } from './common.mjs';

const WAIT_MS = 120_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function becameHealthy(app) {
  for (const end = Date.now() + WAIT_MS; Date.now() < end; await sleep(250)) {
    const res = await fetch(originOf(app) + app.health, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (res?.status === 200) return true;
  }
  return false;
}

/** The problem that stops a start, or null. */
async function refusal() {
  const missing = [...APPS.map((app) => app.env), 'DATABASE_URL'].filter((name) => !process.env[name]);
  if (missing.length) return `${missing.join(', ')} not set. Run node bin/preflight.mjs and fix what it says.`;
  const running = Object.entries(readPids()).filter(([, pid]) => isAlive(pid)).map(([key]) => key);
  if (running.length) return `already running: ${running.join(', ')}. Run node bin/stop.mjs first.`;
  for (const app of APPS) {
    const url = new URL(originOf(app));
    if (await portOpen(url.hostname, url.port || app.port))
      return `something is already using ${url.host}. Stop it first. Nothing was started.`;
  }
  return null;
}

async function startAll() {
  mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  mkdirSync(path.dirname(pidFile), { recursive: true });
  const pids = {};
  for (const app of APPS) {
    const url = new URL(originOf(app));
    const log = openSync(path.join(ROOT, 'logs', `${app.key}.log`), 'a');
    const started = Date.now();
    const child = spawn(process.execPath, ['server.js'], {
      cwd: appFolder(app),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: url.port || String(app.port),
        HOSTNAME: LOCAL_HOSTS.has(url.hostname) ? '127.0.0.1' : '0.0.0.0',
      },
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
    });
    child.unref();
    pids[app.key] = child.pid;
    writeFileSync(pidFile, JSON.stringify(pids));
    if (!(await becameHealthy(app))) {
      console.error(`start: ${app.key} did not answer within ${WAIT_MS / 1000} seconds. See logs/${app.key}.log. Stopping everything.`);
      await stopAll();
      return false;
    }
    console.log(`${app.key}: ready at ${originOf(app)} in ${Date.now() - started} ms (process ${child.pid})`);
  }
  console.log('All four apps answer. Next: node bin/smoke.mjs');
  return true;
}

loadEnvFile();
const problem = await refusal();
if (problem) console.error(`start: ${problem}`);
// exitCode, not exit(): on Windows, process.exit right after fetch trips a libuv assertion.
process.exitCode = !problem && (await startAll()) ? 0 : 1;
