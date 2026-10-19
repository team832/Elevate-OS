/**
 * `npm run db:migrate` — apply the SQL migrations in packages/database/migrations
 * to DATABASE_URL (root .env). Generate them first with `npm run db:generate`.
 */
import { loadEnv } from '@elevate/configuration';
import { loadRootEnv } from '@elevate/configuration/node';
import { createDatabase } from '@elevate/database';
import { MIGRATIONS_DIR, runMigrations } from '@elevate/database/migrate';

loadRootEnv();
const env = loadEnv('database');
const handle = createDatabase(env.DATABASE_URL, { maxConnections: 1 });
try {
  const count = await runMigrations(handle);
  console.log(
    `db:migrate — ${count} migration file(s) in ${MIGRATIONS_DIR} applied or already up to date (${handle.driver}).`,
  );
} catch (error) {
  console.error('db:migrate — failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
