# Database operations

PostgreSQL with schemas `core`, `marketing`, `academic`, `ops` (+ `drizzle` for the migration journal). Design: `DATABASE_DESIGN.md`. Migrations: `docs/DATABASE_MIGRATION_PLAN.md`.

## Backup (local database, since 6 Nov 2026)
```bash
npm run db:backup                      # → .data/backups/<date_time>/ : one NDJSON file per table + manifest.json
```
`scripts/backup/json-backup.ts` reads every table of the five schemas in one read-only snapshot, writes each row as PostgreSQL's own `row_to_json` (bigint, numeric, timestamps and jsonb stay exact; file bytes as base64) and a manifest with row counts, sha256 per file and the applied migrations. No `pg_dump` is needed (D-024). It refuses a database that is not on this computer. Tested: `apps/platform/tests/integration/json-backup.test.ts`; on a throwaway PostgreSQL 18.4 with 168 MB of files, backup 11 s, restore 17 s, 185 tables identical. `node .data/json-backup.mjs` (local helper) now calls the same script.

## Restore (local database)
1. Stop all four apps.
2. `npm run db:restore -- .data/backups/<folder>` into an empty database at the same migration level, or add `--replace` to throw away what is there (it saves the current data first).
3. Start the apps; check `/api/health` and sign in.

Restore refuses, changing nothing, when the database is not on this computer (a `?host=` or `?hostaddr=` in `DATABASE_URL` counts as not local), the migration level differs from the backup's, a file does not match its checksum, or the database holds data and `--replace` was not given. It loads all tables in one transaction, checks foreign keys at the end, compares row counts with the manifest and undoes everything on any failure.

## Release package and production (`pg_dump`)
`scripts/backup/pg-backup.mjs` (shipped with the release package) runs `pg_dump --format=custom --no-owner --no-privileges` for the five schemas, password via `PGPASSWORD`; it needs PostgreSQL 18 client tools (`PG_BIN_DIR` or PATH) and exits with code 2 without them. Restore such an archive with `pg_restore --clean --if-exists --no-owner --dbname "postgres://USER:PASSWORD@HOST:PORT/DB" <file>.dump` after `pg_restore --list <file>.dump` shows it is readable. On production a restore is a leadership-approved incident action.

## Rules
- Take and check a backup **before** every migration (`0020` is next on the owner's computer: `npm run db:backup`, `npm run db:migrate`, `npm run db:check`) and before any manual data fix.
- Keep at least 7 daily backups off the database host (production: Proposed — see deployment README).
- PGlite data directories (`pglite://<dir>`) are backed up by copying the directory while no process uses it.
- Never copy production data into development; development uses fictional seeds (D-016).
