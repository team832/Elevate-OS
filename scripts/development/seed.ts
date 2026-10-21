/**
 * `npm run db:seed` — load development data: core seeds (departments,
 * programmes, one sample user per role, staff records) followed by every
 * module's `seeds` export (apps/<module>/seed/index.ts), then the platform seeds
 * (apps/platform/seed: the sample enrolment handoff across modules). Idempotent.
 * Development only: refuses NODE_ENV=production and non-local databases.
 */
import { hashPassword } from '@elevate/authentication';
import { isLocalDatabaseUrl, loadEnv } from '@elevate/configuration';
import { loadRootEnv } from '@elevate/configuration/node';
import { createDatabase } from '@elevate/database';
import { SEED_USERS, coreSeeds, runSeeds, type SeedDefinition } from '@elevate/database/seed';
import { seeds as academicSeeds } from '@elevate/academic-os/seed';
import { seeds as opsSeeds } from '@elevate/business-ops-os/seed';
import { seeds as marketingSeeds } from '@elevate/marketing-os/seed';
import { seeds as platformSeeds } from '@elevate/platform/seed';

loadRootEnv();
const env = loadEnv('seed');
if (env.NODE_ENV === 'production') {
  console.error('db:seed — refusing to seed with NODE_ENV=production.');
  process.exit(1);
}
if (!isLocalDatabaseUrl(env.DATABASE_URL)) {
  console.error(
    'db:seed — refusing: DATABASE_URL is not a local database. Seeds are fictional development data.',
  );
  process.exit(1);
}

const all: SeedDefinition[] = [
  ...coreSeeds,
  ...marketingSeeds,
  ...academicSeeds,
  ...opsSeeds,
  ...platformSeeds,
];
const handle = createDatabase(env.DATABASE_URL, { maxConnections: 2 });
try {
  const results = await runSeeds(handle.db, all, {
    seedUserPassword: env.SEED_USER_PASSWORD,
    hashPassword,
    log: (message) => console.log(`db:seed — ${message}`),
  });
  console.log(
    `db:seed — ${results.length} seed(s) applied: ${results.map((r) => `${r.name} (${r.ms} ms)`).join(', ')}`,
  );
  console.log('db:seed — sample sign-ins (password = SEED_USER_PASSWORD):');
  for (const u of SEED_USERS) console.log(`  ${u.role.padEnd(22)} ${u.email}`);
} catch (error) {
  console.error('db:seed — failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
