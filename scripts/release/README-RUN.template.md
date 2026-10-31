# Running Elevate OS {{VERSION}}

This folder holds the four Elevate OS apps, the database steps and the scripts that start and check them. It runs on one computer you choose. Nothing in it has been put on the internet, no hosting provider has been chosen, and this package is not a deployment.

Built {{BUILT}}.

## Read this first: what will not work yet

No package can fix these. `node bin/preflight.mjs` tells you which ones apply on your computer and database.

{{BLOCKERS}}

## What you need

- Node {{NODE}}, exactly this version. Check with `node --version`.
- A PostgreSQL database, empty for a first install. PostgreSQL 18 is what this was tested with.
- On Windows, a short folder for this package, such as `C:\elevate`. The deepest file is about 150 characters inside it, and some Windows programs stop at 260 in all.
- These four addresses. They are built into the apps, so they must be used exactly as written. A different address needs a new build.

{{URLS}}

## First install

Open a terminal in this folder and run each step in order. Stop at the first step that reports a failure.

1. Copy `.env.production.example` to `.env.production`, then fill it in. The comments in the file say what each setting is. To make a random secret, run:

   `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`

   Keep `.env.production` private. It holds the database password.

2. Check everything:

   `node bin/preflight.mjs`

   Fix every line marked FAIL and run it again. It ends with the list of things that still stop real use here.

3. Create the tables:

   `node db/migrate.mjs`

4. Load the reference data (departments, programmes, lead sources and stages, courses and plans, social accounts and brand rules). Name your database, which is the last part of `DATABASE_URL`, so that this can never run on the wrong one by accident:

   `node db/seed-reference.mjs --confirm-database <database name>`

   It loads no samples, no demo accounts and no sign-ins, and it is safe to run again. If it says the onboarding template and website prices waited, run it again after someone has the Operations manager role.

5. Start the apps:

   `node bin/start.mjs`

   They keep running in the background. Each one writes to `logs/<app>.log`.

6. Check that they answer:

   `node bin/smoke.mjs`

   To include a real sign-in on all four addresses, first set `SMOKE_EMAIL` and `SMOKE_PASSWORD` for an account that has a password. The script never prints them. It prints a PDF from the first work report it finds, or from the one named in `SMOKE_EOD_REPORT_ID`. Without a report to print, it checks the PDF font files on disk only.

7. Stop the apps when you are done:

   `node bin/stop.mjs`

## Data that is left out unless you ask for it

The owner has not yet decided whether these belong in a first install, so step 4 leaves them out. Add one by repeating step 4 with `--include`:

- `--include owner-staff`: the eight staff names and subjects the owner supplied, and their teaching assignments. These are real people, with no logins and no contact details.
- `--include marketing-history`: 59 ideas, 36 placements and the 60-post audit from the old trackers.

## Installing over an existing database

1. Back up first (below).
2. Stop the apps: `node bin/stop.mjs`
3. Run `node bin/preflight.mjs`. It lists the migrations waiting and checks migration 0017 against your stored data.
4. Run `node db/migrate.mjs`, then `node bin/start.mjs` and `node bin/smoke.mjs`.

## Backup

The backup script needs `pg_dump`, the PostgreSQL 18 client tool, on this computer. It is not included and is not installed by anything here. If it is missing the script stops and backs up nothing. Set `PG_BIN_DIR` if it is not on the PATH.

`node --env-file=.env.production scripts/backup/pg-backup.mjs --out backups`

To restore, the script's own header shows the `pg_restore` command. No restore has been tried yet, so try one on a spare database before relying on it.

## If something goes wrong

- **Preflight says files changed or are missing.** Unpack the archive again.
- **Preflight says an address does not match.** Use the address it names, or have a new package built for yours.
- **A step cannot reach the database.** Check that PostgreSQL is running and that `DATABASE_URL` is right.
- **An app does not start.** Read `logs/<app>.log`. The start script stops the others when one fails.
- **Nobody can sign in.** See the first item in the list at the top.

## Commands that do not belong here

`db:seed`, `db:seed-demo-accounts`, `db:reset` and `db:clear-samples` are development commands. They are not in this package, and they refuse any database that is not on the developer's own computer.
