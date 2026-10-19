/**
 * `npm run db:reset` — DEVELOPMENT ONLY. Drops the Elevate schemas (core,
 * marketing, academic, ops) and drizzle's migration journal from DATABASE_URL,
 * then re-applies migrations and seeds.
 *
 * Refuses unless DATABASE_URL points at localhost/127.0.0.1 or PGlite, and
 * NODE_ENV is not production. Pass --yes to skip the 5-second countdown.
 */
import { spawnSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { isLocalDatabaseUrl, loadEnv } from '@elevate/configuration';
import { findRepoRoot, loadRootEnv } from '@elevate/configuration/node';
import { MANAGED_SCHEMAS, createDatabase } from '@elevate/database';

loadRootEnv();
const env = loadEnv('database');
if (env.NODE_ENV === 'production') {
  console.error('db:reset — refusing: NODE_ENV=production.');
  process.exit(1);
}
if (!isLocalDatabaseUrl(env.DATABASE_URL)) {
  console.error(
    'db:reset — refusing: DATABASE_URL is not local (localhost/127.0.0.1/pglite). Nothing was changed.',
  );
  process.exit(1);
}

const target = env.DATABASE_URL.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1:***@');
if (!process.argv.includes('--yes')) {
  console.log(
    `db:reset — will DROP schemas ${MANAGED_SCHEMAS.join(', ')} and drizzle in ${target}. Ctrl+C within 5 s to abort.`,
  );
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

const handle = createDatabase(env.DATABASE_URL, { maxConnections: 1 });
try {
  for (const schema of [...MANAGED_SCHEMAS, 'drizzle']) {
    await handle.db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  }
  console.log('db:reset — schemas dropped.');
} finally {
  await handle.close();
}

const root = findRepoRoot() ?? process.cwd();
for (const script of ['db:migrate', 'db:seed']) {
  const result = spawnSync('npm', ['run', script], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`db:reset — ${script} failed.`);
    process.exit(result.status ?? 1);
  }
}
console.log('db:reset — done.');
