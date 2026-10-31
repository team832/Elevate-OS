/**
 * scripts/release/package.mjs and the scripts it ships, on a folder arranged like the standalone
 * builds: no real build, no real database (the database address is a closed port). Also db-server's
 * pid-file rule (SCR-009), on a temp data folder: this file never touches a real cluster.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = path.resolve(import.meta.dirname, '../../../..');
const APPS = [
  ['business-ops-os', 'ops', 4110, '/ops/api/v1/health'],
  ['academic-os', 'academic', 4111, '/academic/api/v1/health'],
  ['marketing-os', 'marketing', 4112, '/marketing/api/v1/health'],
  ['platform', 'platform', 4113, '/api/health'],
] as const;
const URLS = {
  BUSINESS_OPS_OS_URL: 'http://localhost:4110',
  ACADEMIC_OS_URL: 'http://localhost:4111',
  MARKETING_OS_URL: 'http://localhost:4112',
  PLATFORM_URL: 'http://localhost:4113',
};
const SECRET = 'test-only-fixture-secret-value-0123456789';
const GOOD_ENV = {
  ...URLS,
  DATABASE_URL: 'postgres://u:test-only-password@127.0.0.1:1/elevate_fixture',
  SESSION_SECRET: 'test-only-session-value-long-enough-0123456789',
  INTERNAL_SERVICE_TOKEN: 'test-only-internal-value-long-enough-0123456789',
};

const work = mkdtempSync(path.join(tmpdir(), 'elevate-release-'));
const builds = path.join(work, 'builds');
const out = path.join(work, 'dist');
const pkg = path.join(out, 'elevate-os-0.1.0');
const put = (file: string, text = 'x') => {
  mkdirSync(path.dirname(path.join(builds, file)), { recursive: true });
  writeFileSync(path.join(builds, file), text);
};
const standalone = (dir: string) => `apps/${dir}/.next/standalone`;

function makeBuilds() {
  rmSync(builds, { recursive: true, force: true });
  for (const [dir, , , health] of APPS) {
    const b = standalone(dir);
    put(
      `${b}/apps/${dir}/server.js`,
      `require('node:http').createServer((q, s) => { s.statusCode = q.url === '${health}' ? 200 : 404; s.end('{"data":{"status":"ok"}}'); }).listen(Number(process.env.PORT), process.env.HOSTNAME);`,
    );
    put(`${b}/apps/${dir}/.next/BUILD_ID`);
    put(`${b}/apps/${dir}/.next/server/page.js.map`, '{}');
    put(`${b}/apps/${dir}/.next/cache/entry`);
    put(`${b}/node_modules/real/index.js`, 'module.exports = 1;');
    mkdirSync(path.join(builds, b, 'node_modules/@elevate'), { recursive: true });
    symlinkSync(
      path.join(builds, b, 'node_modules/real'),
      path.join(builds, b, 'node_modules/@elevate/linked'),
      'junction',
    );
    put(`apps/${dir}/.next/static/css/a.css`);
  }
  put('apps/platform/public/favicon.ico');
  put('apps/business-ops-os/assets/fonts/NotoSans-Regular.ttf');
  put('apps/business-ops-os/assets/fonts/NotoSans-Bold.ttf');
  put('apps/business-ops-os/assets/fonts/NotoSansDevanagari-Regular.ttf');
  put('apps/business-ops-os/assets/fonts/NotoSansDevanagari-Bold.ttf');
}

function packageIt(extra: string[] = []) {
  const urls = path.join(work, 'urls.env');
  const secrets = path.join(work, 'secrets.env');
  writeFileSync(urls, Object.entries(URLS).map(([k, v]) => `${k}=${v}`).join('\n'));
  writeFileSync(secrets, `SESSION_SECRET=${SECRET}\nLOG_LEVEL=info\n`);
  return spawnSync(
    process.execPath,
    ['scripts/release/package.mjs', '--from', builds, '--out', out, '--urls-file', urls, '--secrets-file', secrets, ...extra],
    { cwd: REPO, encoding: 'utf8' },
  );
}

/** Only what a child process needs to run: nothing from this test run's environment leaks in. */
const bareEnv = (extra: Record<string, string> = {}) =>
  ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra }) as unknown as NodeJS.ProcessEnv;

const inPackage = (script: string, env: Record<string, string>, ...args: string[]) =>
  spawnSync(process.execPath, [path.join(pkg, script), ...args], {
    cwd: pkg,
    encoding: 'utf8',
    env: bareEnv(env),
  });

afterAll(() => {
  inPackage('bin/stop.mjs', {});
  rmSync(work, { recursive: true, force: true });
});

describe('a package that can be made', () => {
  beforeAll(() => {
    makeBuilds();
    const made = packageIt();
    if (made.status !== 0) throw new Error(made.stderr);
  }, 120_000);

  const manifest = () => JSON.parse(readFileSync(path.join(pkg, 'manifest.json'), 'utf8'));

  it('records what it was built from, and hashes every file', () => {
    const m = manifest();
    expect(m.urls).toEqual(URLS);
    expect(m.node).toBe(process.versions.node);
    expect(m.git).toHaveProperty('dirty');
    expect(m.migrations.at(-1)).toMatch(/^\d{4}_/);
    expect(Object.keys(m.files)).toContain('db/migrate.mjs');
    expect(m.files['manifest.json']).toBeUndefined();
    for (const hash of Object.values(m.files)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves no source map and no build cache, and turns links into real files', () => {
    const files = Object.keys(manifest().files);
    expect(files.filter((f) => f.endsWith('.map') || f.includes('.next/cache'))).toEqual([]);
    expect(files).toContain('apps/ops/node_modules/@elevate/linked/index.js');
  });

  it.each(['ops', 'academic', 'marketing'])('puts the PDF fonts where %s looks for them', (key) => {
    const dir = APPS.find((a) => a[1] === key)![0];
    const from = path.join(pkg, 'apps', key, 'apps', dir);
    const lookup = key === 'ops' ? 'assets/fonts' : '../business-ops-os/assets/fonts';
    expect(existsSync(path.join(from, lookup, 'NotoSans-Regular.ttf'))).toBe(true);
  });

  it('ships settings with names and rules only, and a README that names the blockers', () => {
    const lines = readFileSync(path.join(pkg, '.env.production.example'), 'utf8').split('\n');
    expect(lines.filter((l) => l && !l.startsWith('#') && !l.endsWith('='))).toEqual([]);
    const readme = readFileSync(path.join(pkg, 'README-RUN.md'), 'utf8');
    for (const words of ['sign in without Google', 'admission cannot be confirmed', 'uploads and downloads refuse', 'pg_dump'])
      expect(readme).toContain(words);
    expect(readme).toContain(URLS.PLATFORM_URL);
    expect(readme).not.toMatch(/\{\{|\bdeployed\b/i);
  });

  it('refuses without the addresses, naming the one that is missing', () => {
    const urls = path.join(work, 'short.env');
    writeFileSync(urls, 'PLATFORM_URL=http://localhost:4113\n');
    const r = spawnSync(process.execPath, ['scripts/release/package.mjs', '--from', builds, '--out', path.join(work, 'x'), '--urls-file', urls, '--secrets-file', urls], {
      cwd: REPO,
      encoding: 'utf8',
      env: bareEnv(),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('BUSINESS_OPS_OS_URL');
  });

  describe('preflight', () => {
    const preflight = (env: Record<string, string>) => inPackage('bin/preflight.mjs', { ...GOOD_ENV, ...env });

    it.each([
      ['a weak secret', { SESSION_SECRET: 'short' }, 'SESSION_SECRET must be at least 32'],
      ['a placeholder', { INTERNAL_SERVICE_TOKEN: 'replace-with-at-least-32-random-characters' }, 'INTERNAL_SERVICE_TOKEN still looks like a placeholder'],
      ['a missing secret', { SESSION_SECRET: '' }, 'SESSION_SECRET is missing'],
      ['the test database', { DATABASE_URL: 'pglite://memory' }, 'DATABASE_URL must start with postgres://'],
      ['another address', { PLATFORM_URL: 'http://localhost:9' }, `PLATFORM_URL must be ${URLS.PLATFORM_URL}`],
      ['only half of Google', { GOOGLE_CLIENT_ID: 'x' }, 'needs GOOGLE_CLIENT_SECRET'],
      ['a bad owner email', { BOOTSTRAP_OWNER_EMAILS: 'someone@gmail.com' }, 'BOOTSTRAP_OWNER_EMAILS may list only'],
      ['bad module tokens', { INTERNAL_SERVICE_TOKENS: 'ops:short' }, 'INTERNAL_SERVICE_TOKENS must be'],
      ['a closed database port', {}, 'The database cannot be reached'],
    ])('fails on %s, plainly, and prints no value', (_name, env, message) => {
      const r = preflight(env);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(message);
      for (const value of ['test-only-password', GOOD_ENV.SESSION_SECRET])
        expect(r.stdout + r.stderr).not.toContain(value);
    });

    it.each([
      ['Google is not set', {}, 'Real staff cannot sign in without Google', true],
      ['Google is set', { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }, 'Real staff cannot sign in without Google', false],
      ['always', {}, 'A real admission cannot be confirmed yet', true],
      ['always', {}, 'File uploads and downloads refuse until storage is chosen', true],
    ])('says which blockers apply: %s', (_when, env, title, shown) => {
      expect(preflight(env).stdout.includes(title)).toBe(shown);
    });

    it('fails when a package file was changed', () => {
      const file = path.join(pkg, 'README-RUN.md');
      const before = readFileSync(file);
      writeFileSync(file, 'changed');
      const r = preflight({});
      writeFileSync(file, before);
      expect(r.stdout).toContain('1 package file(s) are missing or changed');
      expect(r.stdout).toContain('README-RUN.md');
    });

    it('fails on another Node version', () => {
      const file = path.join(pkg, 'manifest.json');
      const before = readFileSync(file);
      writeFileSync(file, JSON.stringify({ ...manifest(), node: '1.2.3' }));
      const r = preflight({});
      writeFileSync(file, before);
      expect(r.stdout).toContain('built with Node 1.2.3');
    });
  });

  describe('start and stop', () => {
    const env = { ...GOOD_ENV, NODE_ENV: 'production' };

    it('starts four servers from their own folders, refuses a second start, stops them all', async () => {
      const started = inPackage('bin/start.mjs', env);
      expect(started.stdout + started.stderr).toContain('All four apps answer');
      for (const [, , port, health] of APPS)
        expect((await fetch(`http://127.0.0.1:${port}${health}`)).status).toBe(200);

      const again = inPackage('bin/start.mjs', env);
      expect(again.status).toBe(1);
      expect(again.stderr).toContain('already running');

      const smoke = inPackage('bin/smoke.mjs', env);
      expect(smoke.status).toBe(1);
      expect(smoke.stdout).toMatch(/FAIL {2}ops: sign-in page/);

      const stopped = inPackage('bin/stop.mjs', {});
      expect(stopped.status).toBe(0);
      expect(stopped.stdout).toContain('ops: stopped');
      const down = await fetch(`http://127.0.0.1:4110/`).catch(() => null);
      expect(down).toBeNull();
      expect(inPackage('bin/stop.mjs', {}).stdout).toContain('Nothing to stop');
    }, 90_000);
  });
});

describe('a package that must not be made', () => {
  const b = standalone('business-ops-os');
  const FORBIDDEN = [
    `${b}/.env`,
    `${b}/.env.local`,
    `${b}/.data/postgres/x`,
    `${b}/data/legacy/_private/x`,
    `${b}/apps/business-ops-os/seed/samples.ts`,
    `${b}/apps/business-ops-os/seed/clear-samples.ts`,
    `${b}/packages/database/src/seed/demo-accounts.ts`,
    `${b}/scripts/development/seed-demo-accounts.ts`,
    `${b}/apps/business-ops-os/tests/x.test.ts`,
    `${b}/packages/testing/x.js`,
    `${b}/node_modules/embedded-postgres/x.js`,
    `${b}/.claude/x`,
    `${b}/marker_env/x`,
    `${b}/.git/HEAD`,
  ];

  describe('with forbidden files', () => {
    let result: ReturnType<typeof packageIt>;
    beforeAll(() => {
      makeBuilds();
      FORBIDDEN.forEach((file) => put(file));
      result = packageIt();
    }, 60_000);

    it('fails and leaves nothing behind', () => {
      expect(result.status).toBe(1);
      expect(existsSync(pkg)).toBe(false);
    });
    it.each(FORBIDDEN)('names %s', (file) => {
      expect(result.stderr).toContain(file.replace(`${b}/`, ''));
    });
  });

  it.each([
    ['a secret value from the named file', () => put(`${b}/apps/business-ops-os/.next/server/s.js`, `const a = "${SECRET}";`), 'holds the value of SESSION_SECRET'],
    ['something the secret-scan rules catch', () => put(`${b}/apps/business-ops-os/.next/server/k.js`, `-----BEGIN ${'PRIVATE'} KEY-----`), 'the secret scan found something'],
    ['a missing font', () => rmSync(path.join(builds, 'apps/business-ops-os/assets/fonts/NotoSans-Bold.ttf')), 'NotoSans-Bold.ttf'],
    ['a missing standalone build', () => rmSync(path.join(builds, standalone('platform')), { recursive: true }), 'no standalone build'],
  ])('refuses %s, and never prints a secret', (_name, plant, message) => {
    makeBuilds();
    plant();
    const r = packageIt();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
    expect(r.stdout + r.stderr).not.toContain(SECRET);
    expect(existsSync(pkg)).toBe(false);
  }, 60_000);
});

describe('db:start with a data folder whose server runs on another port (SCR-009)', () => {
  it('keeps the pid file and refuses, naming the port', async () => {
    const data = path.join(work, 'pgdata');
    mkdirSync(data, { recursive: true });
    const live = createServer().listen(0, '127.0.0.1');
    await new Promise((resolve) => live.once('listening', resolve));
    const port = (live.address() as { port: number }).port;
    const pidFile = path.join(data, 'postmaster.pid');
    writeFileSync(pidFile, `1234\n${data}\n1700000000\n${port}\n\n127.0.0.1\n`);
    const r = spawnSync(process.execPath, ['scripts/development/db-server.mjs'], {
      cwd: REPO,
      encoding: 'utf8',
      env: {
        ...process.env,
        ELEVATE_PG_DATA: data,
        DATABASE_URL: 'postgres://u:test-only-password@127.0.0.1:1/fixture',
      },
    });
    live.close();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`running on port ${port}`);
    expect(existsSync(pidFile)).toBe(true);
  }, 30_000);
});
