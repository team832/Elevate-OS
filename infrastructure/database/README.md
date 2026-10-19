# Database operations

PostgreSQL with schemas `core`, `marketing`, `academic`, `ops` (+ `drizzle` for the migration journal). Design: `DATABASE_DESIGN.md`. Migrations: `docs/DATABASE_MIGRATION_PLAN.md`.

## Backup
```bash
# needs PostgreSQL 18 client tools (pg_dump) — not bundled with embedded-postgres on Windows
set PG_BIN_DIR=C:\Program Files\PostgreSQL\18\bin      # or put pg_dump on PATH
npm run db:backup                                       # → .data/backups/<db>-<YYYYMMDD-HHMMSS>.dump
pg_restore --list .data/backups/<file>.dump            # verify the archive is readable
```
`scripts/backup/pg-backup.mjs` runs `pg_dump --format=custom --no-owner --no-privileges` for the five schemas, passing the password via `PGPASSWORD`. Without `pg_dump` it exits with code 2 and does nothing (verified). **An actual backup has not yet been run on this machine** because the client tools are not installed (D-024).

Equivalent manual command:
```bash
PGPASSWORD=… pg_dump --format=custom --no-owner --no-privileges -h 127.0.0.1 -p 54320 -U elevate -d elevate \
  --schema=core --schema=marketing --schema=academic --schema=ops --schema=drizzle -f elevate.dump
```

## Restore
1. Stop all four apps.
2. `pg_restore --clean --if-exists --no-owner --dbname "postgres://USER:PASSWORD@HOST:PORT/DB" <file>.dump`
3. Start the apps; check `/api/health` and sign in.

Restoring replaces the five schemas' contents with the backup. On production it is a leadership-approved incident action.

## Rules
- Take and verify a backup **before** every destructive migration and before any manual data fix.
- Keep at least 7 daily backups off the database host (production: Proposed — see deployment README).
- PGlite data directories (`pglite://<dir>`) are backed up by copying the directory while no process uses it.
- Never copy production data into development; development uses fictional seeds (D-016).
