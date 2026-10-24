/**
 * `npm run db:seed-demo-accounts` — DEVELOPMENT ONLY (D-072). Creates or refreshes the local
 * demo sign-ins (business administrator, HR manager, teacher, marketing manager, two marketing
 * employees) plus the four teacher logins, labelled development assumptions linked to the
 * owner-supplied staff records (brief 23 Oct 2026 §4, R10; soma@ = "Soma", owner to confirm), all with
 * LOCAL_DEMO_PASSWORD from the root .env (never printed). Refuses NODE_ENV=production and
 * non-local databases. Safe to run again. Run `npm run db:seed` first so the departments and
 * the owner-supplied staff exist.
 */
import { hashPassword } from '@elevate/authentication';
import { appOrigin, isLocalDatabaseUrl, loadEnv } from '@elevate/configuration';
import { loadRootEnv } from '@elevate/configuration/node';
import { createDatabase } from '@elevate/database';
import {
  DEMO_ACCOUNTS,
  DEV_ASSUMPTION_ACCOUNTS,
  assertDemoSeedAllowed,
  seedDemoAccounts,
  seedDevAssumptionAccounts,
} from '@elevate/database/seed';
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
  await handle.db.transaction(async (tx) => {
    await seedDemoAccounts(tx as never, passwordHash);
    await seedDevAssumptionAccounts(tx as never, passwordHash);
  });
  console.log('db:seed-demo-accounts — ready (password = LOCAL_DEMO_PASSWORD):');
  const home = {
    operations_manager: 'ops',
    hr_manager: 'ops',
    teacher: 'academic',
    marketing_manager: 'marketing',
    marketing_contributor: 'marketing',
  } as const;
  for (const a of [...DEMO_ACCOUNTS, ...DEV_ASSUMPTION_ACCOUNTS]) {
    const ws = home[a.role];
    console.log(
      `  ${a.email.padEnd(32)} ${appOrigin(ws)}${MODULES[ws].basePath}  ${a.displayName}`,
    );
  }
} catch (error) {
  console.error('db:seed-demo-accounts — failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
