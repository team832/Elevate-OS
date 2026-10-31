/** Source of db/migrate.mjs: the same migrations and the same tracking table as `npm run db:migrate`. */
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { ROOT, loadEnvFile } from './common.mjs';

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!/^postgres(ql)?:\/\//.test(url ?? '')) {
  console.error('migrate: DATABASE_URL must be set to a postgres:// address. Nothing was changed.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
async function recorded() {
  const { rows } = await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS t");
  if (!rows[0].t) return 0;
  return Number((await pool.query('SELECT count(*) AS n FROM drizzle.__drizzle_migrations')).rows[0].n);
}

try {
  const before = await recorded();
  await migrate(drizzle({ client: pool }), { migrationsFolder: path.join(ROOT, 'db', 'migrations') });
  const after = await recorded();
  console.log(`migrate: ${after - before} migration(s) applied, ${after} on record.`);
} catch (error) {
  console.error(`migrate: failed, nothing from this run was kept. ${error.cause?.message ?? error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
