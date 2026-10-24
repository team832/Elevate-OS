/**
 * `npm run db:clear-samples` — DEVELOPMENT/PRE-LAUNCH. Deletes every sample record
 * (is_sample rows and their dependants, D-036) from DATABASE_URL in one transaction and
 * prints how many rows each table lost. Real records are never deleted: their optional links to
 * sample records are emptied (one line per table), and a real record that needs a sample one stops
 * the command with a list of what to fix first. Rules: apps/business-ops-os/seed/clear-samples.ts.
 *
 * Refuses unless DATABASE_URL is local (localhost/127.0.0.1/PGlite) and NODE_ENV is not
 * production, like db:reset. Pass --yes to skip the 5-second countdown.
 */
import { isLocalDatabaseUrl, loadEnv } from '@elevate/configuration';
import { loadRootEnv } from '@elevate/configuration/node';
import { createDatabase } from '@elevate/database';
import { disableDemoAccounts } from '@elevate/database/seed';
import { ClearSamplesRefused, clearSamples } from '@elevate/business-ops-os/seed';

loadRootEnv();
const env = loadEnv('database');
if (env.NODE_ENV === 'production' || !isLocalDatabaseUrl(env.DATABASE_URL)) {
  console.error(
    'db:clear-samples — refusing: DATABASE_URL must be local and NODE_ENV not production. Nothing was changed.',
  );
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.log('db:clear-samples — deleting all sample records in 5 s (Ctrl+C to abort).');
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

const handle = createDatabase(env.DATABASE_URL, { maxConnections: 1 });
try {
  const counts = await clearSamples(handle.db, (line) => console.log(`  ${line}`));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(32)} ${n}`);
  console.log(`db:clear-samples — ${total} sample row(s) deleted; no real record was deleted.`);
  // The shared-password demo sign-ins (D-072) must not survive into real use.
  console.log(
    `db:clear-samples — ${await disableDemoAccounts(handle.db)} demo account(s) switched off.`,
  );
} catch (error) {
  console.error(
    error instanceof ClearSamplesRefused
      ? `db:clear-samples — ${error.message}`
      : `db:clear-samples — failed, nothing was deleted: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await handle.close();
}
