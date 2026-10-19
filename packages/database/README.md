# @elevate/database

Drizzle ORM schema, client factory, migrations, seeds and the in-memory test database (D-005, D-006, D-006a).

## Entry points

| Import | Contents |
|---|---|
| `@elevate/database` | `createDatabase(url)`, `getDb()`, `setDatabaseForTesting(db)`, `closeDb()`, `type Database`, all tables (`users`, `sessions`, …), `schema`, `MANAGED_SCHEMAS`, `insertAuditEvent`, PG error helpers (`isUniqueViolation`, `isForeignKeyViolation`, `isCheckViolation`, `findPgError`) |
| `@elevate/database/schema` | Tables only |
| `@elevate/database/seed` | `defineSeed`, `runSeeds`, `orderSeeds`, `type SeedDefinition`, `coreSeeds`, `SEED_USERS`, `SEED_DEPARTMENTS`, `SEED_PROGRAMMES` |
| `@elevate/database/migrate` | `runMigrations(handle)`, `MIGRATIONS_DIR` (scripts only) |
| `@elevate/database/testing` | `createTestDb()`, `buildSchemaDdl()` — tests only (pulls in drizzle-kit) |

## Driver selection (`DATABASE_URL`)
- `postgres://…` / `postgresql://…` → node-postgres pool (dev server from `npm run db:start`, production)
- `pglite://memory` → in-process PGlite, in memory
- `pglite://<dir>` → in-process PGlite persisted to `<dir>` (single process only — not usable by four apps at once)

`getDb()` creates one handle per process lazily and caches it on `globalThis` (survives Next.js hot reload). `Database` is `PgDatabase<…, Schema>`; a transaction `tx` is also a `Database`, so services take `db: Database` and work inside or outside a transaction.

## Schema files and ownership

| File | Postgres schema | Owner |
|---|---|---|
| `src/schema/core.ts` | `core` | Foundation → Integration |
| `src/schema/marketing.ts` | `marketing` | **Marketing team** |
| `src/schema/academic.ts` | `academic` | **Academic team** |
| `src/schema/ops.ts` | `ops` | **Business Ops team** |

Adding a table (module team), e.g. in `ops.ts`:

```ts
import { index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { LeadId, UserId } from '@elevate/shared-types';   // type-only imports!
import { users } from './core';                                 // FKs into core are allowed

// `export const ops = pgSchema('ops');` is already declared at the top of the file.
export const opsLeads = ops.table('leads', {
  id: uuid('id').primaryKey().defaultRandom().$type<LeadId>(),
  code: text('code').notNull().unique(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).$type<UserId>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ops_leads_owner_idx').on(t.ownerUserId)]);
```

Rules: prefix exports with the module name (`opsLeads`) — `schema/index.ts` throws on duplicate export names; never reference another module's tables; use only `import type` from workspace packages (drizzle-kit loads these files directly); do **not** run `db:generate` in wave 2.

## Tests
`createTestDb()` builds the full current schema (all four files) in a fresh in-memory PGlite by diffing an empty snapshot against the live TypeScript schema with `drizzle-kit/api` (`generateDrizzleJson` + `generateMigration`) and executing the DDL. No generated migration is needed, and a table added to a module file appears immediately (proved by `tests/create-test-db.test.ts`, which checks every exported table exists). Usually you use it through `setupTestDatabase()` from `@elevate/testing`.

## Migrations and seeds
- `npm run db:generate` → `drizzle-kit generate` (all four schema files, `schemaFilter: core, marketing, academic, ops`) into `migrations/`. Wave 3 generates the baseline.
- `npm run db:migrate` → applies `migrations/` (journal in `drizzle.__drizzle_migrations`).
- `npm run db:seed` → `scripts/development/seed.ts`: `coreSeeds` + each module's `seeds` export, dependency-ordered, each in its own transaction, idempotent.
- See `docs/DATABASE_MIGRATION_PLAN.md`.

Tests: `tests/create-test-db.test.ts`.
