/**
 * `npm run db:seed-demo-accounts` — DEVELOPMENT ONLY (D-072). Creates or refreshes three local
 * demo sign-ins, one per workspace, all with LOCAL_DEMO_PASSWORD from the root .env (never
 * printed). Refuses NODE_ENV=production and non-local databases. Safe to run again.
 * Run `npm run db:seed` first so the departments exist.
 */
import { hashPassword } from '@elevate/authentication';
import { appOrigin, isLocalDatabaseUrl, loadEnv } from '@elevate/configuration';
import { loadRootEnv } from '@elevate/configuration/node';
import { createDatabase } from '@elevate/database';
import { DEMO_ACCOUNTS, assertDemoSeedAllowed, seedDemoAccounts } from '@elevate/database/seed';
import { MODULES } from '@elevate/shared-types';

loadRootEnv();
const env = loadEnv('database');
const password = process.env.LOCAL_DEMO_PASSWORD;
try {
  assertDemoSeedAllowed({
    nodeEnv: env.NODE_ENV,
    databaseIsLocal: isLocalDatabaseUrl(env.DATABASE_URL),
    password,
  });
} catch (error) {
  console.error(`db:seed-demo-accounts — ${(error as Error).message} Nothing was changed.`);
  process.exit(1);
}

const handle = createDatabase(env.DATABASE_URL, { maxConnections: 1 });
try {
  const passwordHash = await hashPassword(password!);
  await handle.db.transaction((tx) => seedDemoAccounts(tx as never, passwordHash));
  console.log('db:seed-demo-accounts — ready (password = LOCAL_DEMO_PASSWORD):');
  const home = {
    operations_manager: 'ops',
    teacher: 'academic',
    marketing_manager: 'marketing',
  } as const;
  for (const a of DEMO_ACCOUNTS) {
    const ws = home[a.role];
    console.log(`  ${a.email.padEnd(32)} ${appOrigin(ws)}${MODULES[ws].basePath}`);
  }
} catch (error) {
  console.error('db:seed-demo-accounts — failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
