# Database Migration Plan

## 1. Principles
- **One migration stream** for the whole database, generated and applied centrally from `packages/database` (D-005). Module teams change only their schema file.
- Migrations are SQL files produced by `drizzle-kit generate` from all four schema files (`packages/database/drizzle.config.ts`, `schemaFilter: core, marketing, academic, ops`). Applied ones are recorded in `drizzle.__drizzle_migrations`.
- Generated SQL is reviewed by a human before it is committed (it is code).
- Applied migrations are never edited; fixes are new migrations.
- **Backup before destructive change:** any migration that drops/renames a column or table, changes a type, or rewrites data requires a fresh backup verified with `pg_restore --list` first (D-024).

## 2. Lifecycle by wave
| Wave | What happens |
|---|---|
| 1a Foundation (done) | Pipeline proven with a throwaway run against the dev server: `db:generate` produced `0000_*.sql` (12 core tables + `CREATE SCHEMA` for all four schemas) → `db:migrate` (twice, idempotent) → `db:seed` → `db:reset`. The throwaway migration and its tables were then deleted. **No migration is in the repo.** |
| 2 Modules | Module teams add tables to their schema file only and test with `createTestDb()`. They do **not** run `db:generate`. Local experiments against the dev server: `db:generate` in a scratch branch, then delete the files. |
| 3 Integration | Generate the single baseline (`0000_baseline.sql`) from all four files, review, commit, apply to dev, run all tests and seeds. From then on every schema change ships with a reviewed migration. |

## 3. Commands
| Command | Effect |
|---|---|
| `npm run db:start` | Local PostgreSQL 18 (embedded-postgres) from `DATABASE_URL` |
| `npm run db:generate` | `drizzle-kit generate` → `packages/database/migrations/NNNN_name.sql` + `meta/` snapshot |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` (fails clearly if none exist) |
| `npm run db:seed` | Core + module seeds (local databases only; refuses `NODE_ENV=production`) |
| `npm run db:reset` | **Dev only**: drops `core, marketing, academic, ops, drizzle` and re-runs migrate + seed. Refuses unless `DATABASE_URL` is localhost/127.0.0.1/PGlite and `NODE_ENV≠production`; 5-second countdown unless `--yes` |
| `npm run db:backup` | `pg_dump -Fc` of the five schemas to `.data/backups/` (needs PostgreSQL 18 client tools, D-024) |

## 4. Writing a safe change (after the baseline exists)
1. Change the schema file; run `npm test` (tests use the live schema).
2. `npm run db:generate` (or, for a named file, `cd packages/database && npx drizzle-kit generate --name <describe_change>`); read the SQL.
3. For destructive or data-moving changes use expand → migrate → contract:
   - **Expand:** add new nullable columns/tables; deploy code that writes both.
   - **Migrate:** backfill in a separate migration or script (idempotent, batched).
   - **Contract:** after all code uses the new shape, drop the old one — with a verified backup first.
4. Apply to dev (`db:migrate`), run seeds and all tests, then commit migration + code together.

## 5. Rollback
- Drizzle generates forward-only SQL. Every destructive migration's PR must include a written rollback note: the reverse SQL, or "restore from backup `<file>`".
- Non-destructive (additive) migrations roll back by deploying the previous code; the extra column/table is harmless and is removed by a later migration if needed.
- Destructive migrations roll back by restoring the pre-migration backup: `pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" <backup>.dump` (stop the apps first). See `infrastructure/database/README.md`.

## 6. Production (Proposed)
Run `db:migrate` as a one-off release step before starting the new app version, with a verified backup taken minutes before. Never run `db:reset` or `db:seed` against production (both refuse non-local URLs).
