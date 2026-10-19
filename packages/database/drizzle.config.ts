import { defineConfig } from 'drizzle-kit';

/**
 * Central migration config (D-005). Covers all schema files (ops is split across ops*.ts, D-029).
 * `npm run db:generate` (root) writes SQL to ./migrations; `npm run db:migrate`
 * applies it. Module teams do not run generate during wave 2 (see BUILD_PLAN).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema/core.ts',
    './src/schema/marketing.ts',
    './src/schema/academic.ts',
    './src/schema/ops.ts',
    './src/schema/ops-hr.ts',
    './src/schema/ops-lifecycle.ts',
    './src/schema/ops-time.ts',
    './src/schema/ops-work.ts',
  ],
  out: './migrations',
  schemaFilter: ['core', 'marketing', 'academic', 'ops'],
  strict: true,
  verbose: true,
  ...(process.env.DATABASE_URL?.startsWith('postgres')
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
