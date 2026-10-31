/**
 * Source of db/seed-reference.mjs: load the reference data a new production database needs, and
 * nothing else. No samples, no demo accounts, no sign-ins. Safe to run again.
 *
 *   node db/seed-reference.mjs --confirm-database <name> [--include owner-staff] [--include marketing-history]
 *
 * This is deliberately not db:seed, whose refusal of non-local databases stays as it is.
 */
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createDatabase } from '@elevate/database';
import { runSeeds } from '@elevate/database/seed';
import { OPTIONAL_SEEDS, referenceSeedList } from './reference-seeds';

function refuse(message: string): never {
  console.error(`seed-reference: ${message}`);
  process.exit(1);
}

if (existsSync('.env.production')) process.loadEnvFile('.env.production');
const { values } = parseArgs({
  options: {
    'confirm-database': { type: 'string' },
    include: { type: 'string', multiple: true, default: [] },
  },
});

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url))
  refuse('DATABASE_URL must be set to a postgres:// address. Nothing was changed.');
const database = decodeURIComponent(new URL(url).pathname.slice(1));
if (values['confirm-database'] !== database)
  refuse(
    `to load reference data, name the database you mean: --confirm-database ${database}. Nothing was changed.`,
  );
const unknown = values.include.filter((key) => !(key in OPTIONAL_SEEDS));
if (unknown.length)
  refuse(
    `unknown --include ${unknown.join(', ')}. Allowed: ${Object.keys(OPTIONAL_SEEDS).join(', ')}. Nothing was changed.`,
  );

const handle = createDatabase(url, { maxConnections: 2 });
try {
  const results = await runSeeds(handle.db, referenceSeedList(values.include), {
    seedUserPassword: '',
    hashPassword: () => Promise.reject(new Error('A reference seed must not create a sign-in.')),
    log: (message) => console.log(`seed-reference: ${message}`),
  });
  console.log(`seed-reference: done, ${results.length} seed(s) run on database ${database}.`);
} catch (error) {
  console.error('seed-reference: failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
