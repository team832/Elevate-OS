import { defineConfig } from 'drizzle-kit';

/**
 * Central migration config (D-005). Covers all four schema files.
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
  ],
  out: './migrations',
  schemaFilter: ['core', 'marketing', 'academic', 'ops'],
  strict: true,
  verbose: true,
  ...(process.env.DATABASE_URL?.startsWith('postgres')
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
