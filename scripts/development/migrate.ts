/**
 * `npm run db:migrate` — apply the SQL migrations in packages/database/migrations
 * to DATABASE_URL (root .env). Generate them first with `npm run db:generate`. Local databases
 * only: a release package has its own db/migrate.mjs. `-- --allow-non-local` is the deliberate exception.
 */
import { isLocalDatabaseUrl, loadEnv } from '@elevate/configuration';
import { loadRootEnv } from '@elevate/configuration/node';
import { createDatabase } from '@elevate/database';
import { MIGRATIONS_DIR, runMigrations } from '@elevate/database/migrate';

loadRootEnv();
const env = loadEnv('database');
if (!isLocalDatabaseUrl(env.DATABASE_URL) && !process.argv.includes('--allow-non-local')) {
  console.error('db:migrate — refusing: DATABASE_URL is not a local database. Nothing was changed.');
  process.exit(1);
}
const handle = createDatabase(env.DATABASE_URL, { maxConnections: 1 });
try {
  const count = await runMigrations(handle);
  console.log(
    `db:migrate — ${count} migration file(s) in ${MIGRATIONS_DIR} applied or already up to date (${handle.driver}).`,
  );
} catch (error) {
  const cause = error instanceof Error ? error.cause : undefined;
  console.error(
    'db:migrate — failed:',
    error instanceof Error ? error.message : error,
    cause instanceof Error ? `(${cause.message})` : '',
  );
  process.exitCode = 1;
} finally {
  await handle.close();
}
