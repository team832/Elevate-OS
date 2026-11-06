/** Source of bin/preflight.mjs: may this package start here? Exit 1 on any FAIL. Prints no secret. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { BLOCKERS } from './blockers.mjs';
import { ROOT, ENV_FILE, loadEnvFile, readManifest } from './common.mjs';
import { NEVER_IN_PRODUCTION, envProblems } from './env-rules.mjs';

/* global DEMO_LOGINS */
loadEnvFile();
const manifest = readManifest();
const env = process.env;
let failures = 0;
const ok = (message) => console.log(`OK    ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`FAIL  ${message}`);
};
const note = (message) => console.log(`NOTE  ${message}`);

function checkFiles() {
  const paths = Object.keys(manifest.files);
  const bad = paths.filter((rel) => {
    const file = path.join(ROOT, rel);
    return (
      !existsSync(file) ||
      createHash('sha256').update(readFileSync(file)).digest('hex') !== manifest.files[rel]
    );
  });
  if (bad.length === 0) return ok(`All ${paths.length} package files match manifest.json.`);
  fail(`${bad.length} package file(s) are missing or changed. Unpack the archive again.`);
  for (const rel of bad.slice(0, 20)) console.log(`        ${rel}`);
}

function checkNode() {
  if (process.versions.node === manifest.node) ok(`Node ${manifest.node}, same as the build.`);
  else fail(`This package was built with Node ${manifest.node} but this computer runs Node ${process.versions.node}. Install Node ${manifest.node}.`);
  if (process.platform !== manifest.platform)
    note(`Built on ${manifest.platform}, running on ${process.platform}. Not tested: build on the same kind of computer if anything fails to start.`);
}

function checkEnv() {
  if (!existsSync(path.join(ROOT, ENV_FILE)))
    note(`No ${ENV_FILE} file here, so settings come from the environment only.`);
  const problems = envProblems(env, manifest.urls);
  if (problems.length === 0) ok('Settings are complete, and the four addresses match this build.');
  problems.forEach(fail);
  const stray = NEVER_IN_PRODUCTION.filter((name) => env[name]);
  if (stray.length) note(`Remove these development settings: ${stray.join(', ')}.`);
}

async function exists(client, table) {
  return Boolean((await client.query('SELECT to_regclass($1) AS t', [table])).rows[0].t);
}
const firstRow = async (client, sql, params) => (await client.query(sql, params)).rows[0];

async function pendingMigrations(client) {
  const last = (await exists(client, 'drizzle.__drizzle_migrations'))
    ? Number((await firstRow(client, 'SELECT coalesce(max(created_at), 0) AS m FROM drizzle.__drizzle_migrations')).m)
    : 0;
  const { entries } = JSON.parse(readFileSync(path.join(ROOT, 'db', 'migrations', 'meta', '_journal.json'), 'utf8'));
  return entries.filter((entry) => entry.when > last).map((entry) => entry.tag);
}

async function sampleRows(client) {
  const { rows: columns } = await client.query(
    `SELECT table_schema AS s, table_name AS t FROM information_schema.columns
     WHERE column_name = 'is_sample' AND table_schema IN ('core', 'ops', 'academic', 'marketing')`,
  );
  let total = 0;
  for (const { s, t } of columns)
    total += Number((await firstRow(client, `SELECT count(*) AS n FROM "${s}"."${t}" WHERE is_sample`)).n);
  return total;
}

/** Facts about the database, or null when it cannot be read. Also reports what fails on it. */
async function checkDatabase() {
  if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '')) return null;
  const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
  } catch (error) {
    fail(`The database cannot be reached: ${error.message || error.code}`);
    return null;
  }
  try {
    ok('The database answers.');
    const pending = await pendingMigrations(client);
    if (pending.length) note(`${pending.length} migration(s) waiting: ${pending.join(', ')}.`);
    else ok('No migrations waiting.');

    const hasUsers = await exists(client, 'core.users');
    const hasNotifications = await exists(client, 'core.notifications');
    const pending0017 = pending.some((tag) => tag.startsWith('0017'));
    const pending0019 = pending.some((tag) => tag.startsWith('0019'));
    if (pending0017 && hasNotifications) {
      // The same rule migration 0017 adds: a stored link that breaks it makes the migration fail.
      const { n } = await firstRow(
        client,
        `SELECT count(*) AS n FROM core.notifications
         WHERE link IS NOT NULL AND NOT (link ~ '^/([^/\\\\]|$)' AND link !~ '[[:cntrl:]]')`,
      );
      if (Number(n) > 0) fail(`${n} stored notification link(s) would make migration 0017 fail. They must be corrected first; nothing was changed.`);
      else ok('Migration 0017 precheck: no stored notification link breaks its rule.');
    }

    if (!hasUsers) return { pending0017, pending0019, hasNotifications };

    const samples = await sampleRows(client);
    if (samples > 0) fail(`${samples} sample row(s) in this database. Production must hold none: use an empty database.`);
    else ok('No sample rows.');
    const { n: demo } = await firstRow(
      client,
      `SELECT count(*) AS n FROM core.users
       WHERE status = 'active' AND (email LIKE '%@example.test' OR email = ANY($1))`,
      [DEMO_LOGINS],
    );
    if (Number(demo) > 0) fail(`${demo} demo account(s) can sign in on this database. They share one password: use an empty database.`);
    else ok('No demo accounts can sign in.');

    return {
      pending0017,
      pending0019,
      hasNotifications,
      hasProgrammes: Number((await firstRow(client, 'SELECT count(*) AS n FROM core.programmes')).n) > 0,
      hasAdmin: Number((await firstRow(client, `SELECT count(*) AS n FROM core.user_roles r JOIN core.users u ON u.id = r.user_id WHERE r.role = 'platform_admin' AND u.status = 'active'`)).n) > 0,
      hasOnboardingTemplate:
        (await exists(client, 'ops.onboarding_templates')) &&
        Number((await firstRow(client, 'SELECT count(*) AS n FROM ops.onboarding_templates')).n) > 0,
    };
  } finally {
    await client.end();
  }
}

function hasPgDump() {
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (env.PG_BIN_DIR) return existsSync(path.join(env.PG_BIN_DIR, exe));
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump'], { stdio: 'ignore' }).status === 0;
}

checkFiles();
checkNode();
checkEnv();
const db = await checkDatabase();

const applying = BLOCKERS.filter((blocker) => blocker.applies({ env, db, pgDump: hasPgDump() }));
console.log(`\nStill in the way of real use here (${applying.length} of ${BLOCKERS.length}; README-RUN.md lists them all):`);
for (const blocker of applying) console.log(`  - ${blocker.title}. ${blocker.why}`);

console.log(
  failures
    ? `\nPREFLIGHT FAILED: ${failures} problem(s) above. Do not start the apps until they are fixed.`
    : `\nPREFLIGHT PASSED: the apps can start. The list above still stops real use. Status: packaged and checked, not deployed.`,
);
process.exitCode = failures ? 1 : 0;
