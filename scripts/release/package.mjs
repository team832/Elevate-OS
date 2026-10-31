#!/usr/bin/env node
/**
 * `npm run release:package`: builds the four apps and puts them, the database steps and the run
 * scripts into one self-contained folder plus one archive. Nothing goes on the internet.
 *
 * The four addresses come from the environment or from --urls-file. They are compiled into the
 * build, so a package only works at the addresses it was built for.
 *
 *   --urls-file <file>     read the four addresses from this file
 *   --secrets-file <file>  a file whose secret values must not appear in the output
 *                          (default: the root .env when there is one; no value is ever printed)
 *   --from <folder>        take the builds from this folder instead of building
 *   --out <folder>         where to write (default: dist)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { freemem } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { build as esbuild } from 'esbuild';
import { BLOCKERS } from './runtime/blockers.mjs';
import { APPS, portOpen } from './runtime/common.mjs';
import { exampleFile } from './runtime/env-rules.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = path.join(REPO, 'scripts', 'release');
const { values: args } = parseArgs({
  options: {
    'urls-file': { type: 'string' },
    'secrets-file': { type: 'string' },
    from: { type: 'string' },
    out: { type: 'string', default: path.join(REPO, 'dist') },
  },
});
const { version } = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const name = `elevate-os-${version}`;
const outDir = path.resolve(args.out);
const stage = path.join(outDir, name);
const archive = `${name}.tar.gz`;
const MB = 1024 * 1024;

function fail(message) {
  rmSync(stage, { recursive: true, force: true });
  rmSync(path.join(outDir, archive), { force: true });
  console.error(`release: ${message}\nrelease: nothing was packaged.`);
  process.exit(1);
}

/** Read by the seeds at run time. Everything else in data/ stays out of the package. */
const SEED_DATA = [
  'legacy/academic/ca-foundation-accountancy.json',
  'legacy/academic/class12-plan.json',
  'legacy/academic/concept-books.json',
  'legacy/academic/ipmat-baseline.json',
  'legacy/academic/online-class12-accountancy.json',
  'legacy/marketing/accounts.json',
  'legacy/marketing/content-rules.json',
  'legacy/marketing/ideas.json',
  'legacy/marketing/placements.json',
  'legacy/marketing/post-audit.json',
  'syllabus/syllabus-distribution-2026-10-21.json',
];

/** Release-spec §6. Paths use forward slashes, relative to the package root. */
const FORBIDDEN = [
  [/(^|\/)\.env(\.(?!.*example$).*)?$/, 'an environment file'],
  [/(^|\/)\.data(\/|$)/, 'local data'],
  [/data\/legacy\/_(private|extract)(\/|$)/, 'private legacy data'],
  [/(^|\/)seed\/(sample|clear-samples)/, 'sample seed code'],
  [/demo-accounts|seed-demo-accounts/, 'demo account code'],
  [/(^|\/)(apps|packages)\/[^/]+\/tests?\//, 'tests'],
  [/(^|\/)packages\/testing(\/|$)|@elevate\/testing(\/|$)/, 'test helpers'],
  [/(^|\/)@?embedded-postgres(\/|$)/, 'the development database server'],
  [/\.next\/cache(\/|$)/, 'a build cache'],
  [/(^|\/)(\.claude|marker_env|\.git)(\/|$)/, 'tool or repository files'],
  [/\.map$/, 'a source map'],
];
const SAMPLE_INPUT = /seed\/(sample|clear-samples)|demo-accounts|core-seed/;

function readUrls() {
  const file = args['urls-file'] ? parseEnv(readFileSync(args['urls-file'], 'utf8')) : {};
  const urls = {};
  for (const { env } of APPS) {
    urls[env] = (file[env] ?? process.env[env] ?? '').replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+$/.test(urls[env]))
      fail(`${env} must be an address such as http://localhost:3003. Set it in the environment or in --urls-file.`);
  }
  return urls;
}

/** npm is a script on Windows, so it needs a shell: fixed strings only. */
const npm = (command, options) => spawnSync(`npm ${command}`, { shell: true, encoding: 'utf8', ...options });

/** A build overwrites .next, which a running app is reading (COMMON rule 6). */
async function refuseIfServing() {
  for (const { port } of APPS)
    if (await portOpen('127.0.0.1', port))
      fail(`something is running on port ${port}. Stop the apps first: a build overwrites their .next folders.`);
}

/** A build under about 800 MB free can stop the database or crash the computer's other programs. */
async function enoughMemory() {
  for (let waited = 0; freemem() < 800 * MB; waited += 1) {
    if (waited === 10) fail(`only ${Math.round(freemem() / MB)} MB of memory is free. Close some programs and try again.`);
    console.log(`release: waiting a minute for free memory (${Math.round(freemem() / MB)} MB free)`);
    await sleep(60_000);
  }
}

async function buildApps(urls) {
  // next.config.ts fills unset variables from the root .env: blank them all, so none reaches a build.
  const rootEnv = path.join(REPO, '.env');
  const blanks = existsSync(rootEnv)
    ? Object.fromEntries(Object.keys(parseEnv(readFileSync(rootEnv, 'utf8'))).map((key) => [key, '']))
    : {};
  const env = {
    ...process.env,
    ...blanks,
    ...urls,
    NODE_ENV: 'production',
    ELEVATE_RELEASE_STANDALONE: '1',
    DATABASE_URL: 'postgres://build:unused@127.0.0.1:1/unused',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('hex'),
  };
  for (const app of APPS) {
    await enoughMemory();
    console.log(`release: building ${app.dir} (${Math.round(freemem() / MB)} MB free)`);
    const { status } = npm(`run build -w @elevate/${app.dir} -- --webpack`, {
      cwd: REPO,
      env,
      stdio: 'inherit',
    });
    if (status !== 0) fail(`the build of ${app.dir} failed.`);
  }
}

// Workspace links become real files, so the archive unpacks anywhere without link rights.
const copy = (from, to) => cpSync(from, to, { recursive: true, dereference: true });

function assembleApps(from) {
  for (const app of APPS) {
    const source = path.join(from, 'apps', app.dir);
    const standalone = path.join(source, '.next', 'standalone');
    if (!existsSync(standalone))
      fail(`no standalone build at ${standalone}. Is output: 'standalone' set for ELEVATE_RELEASE_STANDALONE?`);
    const root = path.join(stage, 'apps', app.key);
    copy(standalone, root);
    copy(path.join(source, '.next', 'static'), path.join(root, 'apps', app.dir, '.next', 'static'));
    if (existsSync(path.join(source, 'public')))
      copy(path.join(source, 'public'), path.join(root, 'apps', app.dir, 'public'));
    if (app.pdfFonts)
      copy(
        path.join(from, 'apps', 'business-ops-os', 'assets', 'fonts'),
        path.join(root, 'apps', 'business-ops-os', 'assets', 'fonts'),
      );
  }
}

const BUNDLE = {
  absWorkingDir: REPO,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outExtension: { '.js': '.mjs' },
  outdir: stage,
  outbase: stage,
  external: ['pg-native'],
  minifyWhitespace: true,
  legalComments: 'none',
  logLevel: 'error',
};
const REQUIRE = "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);";

async function bundleScripts() {
  const demoLogins = readFileSync(path.join(REPO, 'packages/database/src/seed/demo-accounts.ts'), 'utf8')
    .match(/[\w.-]+@[\w.-]+\.\w+/g);
  const runtime = (file) => path.join(HERE, 'runtime', file);
  await esbuild({
    ...BUNDLE,
    entryPoints: [
      { in: runtime('preflight.mjs'), out: 'bin/preflight' },
      { in: runtime('start.mjs'), out: 'bin/start' },
      { in: runtime('stop.mjs'), out: 'bin/stop' },
      { in: runtime('smoke.mjs'), out: 'bin/smoke' },
      { in: runtime('migrate.mjs'), out: 'db/migrate' },
    ],
    define: { DEMO_LOGINS: JSON.stringify([...new Set(demoLogins)]) },
    banner: { js: REQUIRE },
  });
  const { metafile } = await esbuild({
    ...BUNDLE,
    entryPoints: [{ in: path.join(HERE, 'seed-reference.ts'), out: 'db/seed-reference' }],
    metafile: true,
    loader: { '.css': 'empty' },
    alias: {
      '@elevate/database/seed': path.join(REPO, 'packages/database/src/seed/reference-entry.ts'),
      '@electric-sql/pglite': runtime('no-pglite.mjs'),
    },
    // The seeds find data/ at ../../../data next to their source files: db/data from this bundle.
    define: { 'import.meta.url': 'SEED_SOURCE_URL' },
    banner: { js: `${REQUIRE}const SEED_SOURCE_URL=new URL('./_/_/_/seed.mjs',import.meta.url).href;` },
  });
  const samples = Object.values(metafile.outputs)
    .flatMap((output) => Object.entries(output.inputs))
    .filter(([input, { bytesInOutput }]) => bytesInOutput > 0 && SAMPLE_INPUT.test(input))
    .map(([input]) => input);
  if (samples.length) fail(`the reference seed bundle holds sample code: ${samples.join(', ')}`);
  const seedText = readFileSync(path.join(stage, 'db', 'seed-reference.mjs'), 'utf8');
  if (/[\w.-]+@example\.test/.test(seedText)) fail('the reference seed bundle holds a sample address.');
}

function copyDatabaseFiles() {
  const migrations = path.join(REPO, 'packages', 'database', 'migrations');
  const target = path.join(stage, 'db', 'migrations');
  mkdirSync(path.join(target, 'meta'), { recursive: true });
  for (const file of readdirSync(migrations).filter((f) => f.endsWith('.sql')))
    copy(path.join(migrations, file), path.join(target, file));
  copy(path.join(migrations, 'meta', '_journal.json'), path.join(target, 'meta', '_journal.json'));
  for (const file of SEED_DATA) {
    mkdirSync(path.dirname(path.join(stage, 'db', 'data', file)), { recursive: true });
    copy(path.join(REPO, 'data', file), path.join(stage, 'db', 'data', file));
  }
  // Ships as it stands: at this depth its own root is the package root.
  copy(path.join(REPO, 'scripts/backup/pg-backup.mjs'), path.join(stage, 'scripts/backup/pg-backup.mjs'));
}

const list = () =>
  readdirSync(stage, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(stage, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();

function prune() {
  for (const file of list().filter((f) => f.endsWith('.map'))) rmSync(path.join(stage, file));
  for (const app of APPS)
    rmSync(path.join(stage, 'apps', app.key, 'apps', app.dir, '.next', 'cache'), { recursive: true, force: true });
}

function assertNothingForbidden(files) {
  const found = files.flatMap((file) =>
    FORBIDDEN.filter(([re]) => re.test(file)).map(([, what]) => `${file} (${what})`),
  );
  if (found.length) fail(`forbidden files in the output:\n  ${found.slice(0, 30).join('\n  ')}`);
}

function assertComplete(files) {
  const has = (wanted) => files.some((f) => f === wanted || f.startsWith(`${wanted}/`));
  const missing = [
    ...APPS.flatMap((app) => {
      const folder = `apps/${app.key}/apps/${app.dir}`;
      return [
        `${folder}/server.js`,
        `${folder}/.next/BUILD_ID`,
        `${folder}/.next/static`,
        ...(app.pdfFonts
          ? ['NotoSans-Regular', 'NotoSans-Bold', 'NotoSansDevanagari-Regular', 'NotoSansDevanagari-Bold'].map(
              (font) => `apps/${app.key}/apps/business-ops-os/assets/fonts/${font}.ttf`,
            )
          : []),
      ];
    }),
    'apps/platform/apps/platform/public/favicon.ico',
    ...['bin/preflight.mjs', 'bin/start.mjs', 'bin/stop.mjs', 'bin/smoke.mjs'],
    ...['db/migrate.mjs', 'db/seed-reference.mjs', 'db/migrations/meta/_journal.json'],
    ...SEED_DATA.map((file) => `db/data/${file}`),
  ].filter((wanted) => !has(wanted));
  if (missing.length) fail(`incomplete package, missing:\n  ${missing.join('\n  ')}`);
}

/** [variable name, value] of every secret to look for. Printing names is fine; values never. */
function secretsToFind() {
  const file = args['secrets-file'] ?? path.join(REPO, '.env');
  if (!existsSync(file)) return [];
  const real = (value) => value.length >= 8 && !/^replace-with/i.test(value);
  return Object.entries(parseEnv(readFileSync(file, 'utf8')))
    .filter(([key]) => /SECRET|TOKEN|PASSWORD|PASSWD|KEY|DATABASE_URL|CLIENT_ID/i.test(key))
    .flatMap(([key, value]) => {
      if (key === 'DATABASE_URL' && URL.canParse(value))
        return [[key, value], [key, decodeURIComponent(new URL(value).password)]];
      if (key === 'INTERNAL_SERVICE_TOKENS')
        return value.split(',').map((pair) => [key, pair.slice(pair.indexOf(':') + 1)]);
      return [[key, value]];
    })
    .filter(([, value]) => real(value));
}

function hashAndSearch(files) {
  const secrets = secretsToFind();
  const hashes = {};
  const leaks = new Set();
  for (const file of files) {
    const bytes = readFileSync(path.join(stage, file));
    hashes[file] = createHash('sha256').update(bytes).digest('hex');
    for (const [key, value] of secrets)
      if (bytes.includes(value)) leaks.add(`${file} holds the value of ${key}`);
  }
  if (leaks.size) fail(`secret values in the output:\n  ${[...leaks].slice(0, 30).join('\n  ')}`);
  return hashes;
}

function git() {
  const say = (...argv) => execFileSync('git', argv, { cwd: REPO, encoding: 'utf8' }).trim();
  try {
    return { sha: say('rev-parse', 'HEAD'), dirty: say('status', '--porcelain') !== '' };
  } catch {
    return { sha: null, dirty: null };
  }
}

function writeReadme(urls, builtAt, gitInfo) {
  const template = readFileSync(path.join(HERE, 'README-RUN.template.md'), 'utf8');
  const fill = {
    VERSION: version,
    NODE: process.versions.node,
    BUILT: `${builtAt.slice(0, 10)} from ${gitInfo.sha?.slice(0, 7) ?? 'an unknown commit'}${gitInfo.dirty ? ' with uncommitted changes' : ''}`,
    URLS: APPS.map((app) => `- ${app.env}: ${urls[app.env]}`).join('\n'),
    BLOCKERS: BLOCKERS.map((b) => `- **${b.title}.** ${b.why}`).join('\n'),
  };
  writeFileSync(
    path.join(stage, 'README-RUN.md'),
    template.replace(/\{\{(\w+)\}\}/g, (_, key) => fill[key]),
  );
}

const urls = readUrls();
if (args.from) {
  if (!existsSync(args.from)) fail(`--from folder not found: ${args.from}`);
} else {
  await refuseIfServing();
  await buildApps(urls);
}
rmSync(stage, { recursive: true, force: true });
rmSync(path.join(outDir, archive), { force: true });
mkdirSync(stage, { recursive: true });

assembleApps(path.resolve(args.from ?? REPO));
await bundleScripts();
copyDatabaseFiles();
const builtAt = new Date().toISOString();
const gitInfo = git();
writeFileSync(path.join(stage, '.env.production.example'), exampleFile(urls));
writeReadme(urls, builtAt, gitInfo);
prune();

const files = list();
assertNothingForbidden(files);
assertComplete(files);
const scan = spawnSync(process.execPath, [path.join(REPO, 'scripts/validation/secret-scan.mjs'), '--path', stage], {
  stdio: 'inherit',
});
if (scan.status !== 0) fail('the secret scan found something in the output.');
const hashes = hashAndSearch(files);

const journal = JSON.parse(readFileSync(path.join(stage, 'db/migrations/meta/_journal.json'), 'utf8'));
writeFileSync(
  path.join(stage, 'manifest.json'),
  `${JSON.stringify(
    {
      name: 'elevate-os',
      version,
      builtAt,
      git: gitInfo,
      urls,
      node: process.versions.node,
      npm: npm('--version').stdout.trim(),
      platform: process.platform,
      arch: process.arch,
      migrations: journal.entries.map((entry) => entry.tag),
      files: hashes,
    },
    null,
    1,
  )}\n`,
);

const tar = spawnSync('tar', ['-czf', archive, name], { cwd: outDir, stdio: 'inherit' });
if (tar.status !== 0) fail('tar could not make the archive.');

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const size = files.reduce((sum, file) => sum + statSync(path.join(stage, file)).size, 0);
console.log(`release: ${stage}`);
console.log(`release: ${files.length} files, ${megabytes(size)}; archive ${archive} ${megabytes(statSync(path.join(outDir, archive)).size)}`);
console.log('release: packaged, not deployed. Next steps are in README-RUN.md inside the folder.');
if (!args.from)
  console.log('release: the apps\' .next folders now hold this build. Run npm run office:build before npm run office.');
