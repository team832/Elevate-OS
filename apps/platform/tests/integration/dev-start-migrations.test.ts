/**
 * The start script (scripts/development/dev.mjs) must not start the apps while a database update
 * (migration) is waiting. Runs a copy of the script beside a fake `pg` and a fake `next`, with a
 * plain TCP listener standing in for the database port: no real database or server is started.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pendingTags } from '../../../../scripts/development/migration-status.ts';

const REPO = path.resolve(import.meta.dirname, '../../../..');
const entries = [1, 2, 3].map((when) => ({ tag: `000${when}_x`, when }));

describe('pendingTags: what npm run db:migrate would still apply', () => {
  it.each([
    ['none pending', [1, 2, 3], []],
    ['one pending', [1, 2], ['0003_x']],
    ['several pending', [1], ['0002_x', '0003_x']],
    ['all pending on a new database', [], ['0001_x', '0002_x', '0003_x']],
  ])('%s', (_, applied, pending) => expect(pendingTags(entries, applied)).toEqual(pending));
});

describe('dev.mjs start path', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'elevate-dev-'));
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    writeFileSync(path.join(work, file), text);
  };
  const listen = () =>
    new Promise<Server>((resolve) => {
      const s = createServer((socket) => socket.end()).listen(0, '127.0.0.1', () => resolve(s));
    });
  const portOf = (s: Server) => (s.address() as AddressInfo).port;
  let db: Server;
  let appPort: number;

  beforeAll(async () => {
    for (const file of [
      'scripts/development/dev.mjs',
      'scripts/development/migration-status.ts',
      'packages/configuration/src/workspaces.ts',
    ])
      cpSync(path.join(REPO, file), path.join(work, file));
    put('package.json', '{"type":"module"}');
    put('packages/database/migrations/meta/_journal.json', JSON.stringify({ entries }));
    put(
      'node_modules/next/dist/bin/next',
      `console.log('FAKE NEXT', process.argv.slice(2).join(' '));`,
    );
    put('node_modules/pg/package.json', '{"name":"pg","type":"module","main":"index.js"}');
    put(
      'node_modules/pg/index.js',
      `const applied = JSON.parse(process.env.FAKE_APPLIED);
export default { Client: class {
  async connect() { if (!applied) throw new Error('connect ECONNREFUSED'); }
  async query(sql) { return { rows: sql.includes('to_regclass') ? [{ t: 'x' }] : applied.map((n) => ({ created_at: String(n) })) }; }
  async end() {}
} };`,
    );
    mkdirSync(path.join(work, 'apps/platform'), { recursive: true });
    db = await listen();
    const free = await listen();
    appPort = portOf(free);
    free.close();
  });
  afterAll(() => {
    db.close();
    rmSync(work, { recursive: true, force: true });
  });

  const runDev = (applied: number[] | null) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(work, 'scripts/development/dev.mjs'), 'platform'],
        {
          env: {
            // Windows env names ignore case, so an inherited NPM_LIFECYCLE_EVENT would win over ours.
            ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k))),
            NODE_ENV: 'test',
            DATABASE_URL: `postgres://u:test-only-password@127.0.0.1:${portOf(db)}/x`,
            PLATFORM_URL: `http://localhost:${appPort}`,
            npm_lifecycle_event: 'dev:platform',
            npm_lifecycle_script: 'node scripts/development/dev.mjs platform',
            FAKE_APPLIED: JSON.stringify(applied),
          },
        },
      );
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code, out }));
    });

  it('refuses to start while updates wait, and names the two commands', async () => {
    const { code, out } = await runDev([1]);
    expect(out).not.toContain('FAKE NEXT');
    expect(out).toMatch(/2 database updates are waiting/);
    expect(out).toMatch(/npm run db:migrate\r?\n\s+npm run dev:platform/);
    expect(code).toBe(1);
  });

  it.each([
    ['nothing waits', [1, 2, 3]],
    ['the database cannot be asked (as before)', null],
  ])('starts the apps when %s', async (_, applied) => {
    const { code, out } = await runDev(applied);
    expect(out).toContain(`FAKE NEXT dev --webpack --port ${appPort}`);
    expect(code).toBe(0);
  });
});
