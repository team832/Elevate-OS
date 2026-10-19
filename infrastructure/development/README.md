# Local development environment

Verified on Windows 11 with Node 24.19.0 and npm 11.17.0 (no PostgreSQL install, no Docker).

## First-time setup
```bash
npm install                      # also runs the approved install scripts (see "allowScripts" below)
cp .env.example .env             # then replace every "replace-with-…" value
npm run db:start                 # terminal 1: local PostgreSQL 18 on 127.0.0.1:54320 (first run initialises .data/postgres)
npm run db:generate              # wave 3 onwards the baseline migration is committed; skip this then
npm run db:migrate
npm run db:seed                  # fictional users, one per role; password = SEED_USER_PASSWORD
npm run dev                      # terminal 2: all four apps
```
Open http://localhost:3000 and sign in as e.g. `director@example.test`.

Generate secrets with:
```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## Ports
| Process | Port | URL |
|---|---|---|
| Platform | 3000 | http://localhost:3000 (integrated entry point; rewrites the zones below) |
| Marketing OS | 3001 | http://localhost:3001/marketing |
| Academic OS | 3002 | http://localhost:3002/academic |
| Business Ops OS | 3003 | http://localhost:3003/ops |
| PostgreSQL (embedded) | 54320 | `postgres://elevate:…@127.0.0.1:54320/elevate` |

Run one module alone: `npm run db:start` + `npm run dev:academic` → http://localhost:3002/academic/login. Cross-module links in the module switcher need the platform (`npm run dev:platform`).

## The dev database (D-006a)
- `npm run db:start` reads user/password/port/database from `DATABASE_URL`, refuses non-local hosts and placeholder passwords, listens on 127.0.0.1 only, and keeps data in `.data/postgres` (git-ignored).
- Ctrl+C stops it cleanly; if a session crashed and left `postmaster.pid`, run `npm run db:stop`.
- Start from scratch: stop the server, delete `.data/postgres`, start again.
- PGlite alternative for a single process (e.g. one app only): `DATABASE_URL=pglite://.data/pglite`. Four apps cannot share a PGlite directory.

## npm `allowScripts`
npm 11.17 does not run dependency install scripts unless approved. The root `package.json` approves `@embedded-postgres/windows-x64@18.4.0-beta.17` (restores the PostgreSQL DLL links) and the esbuild versions used by tsx/vite/drizzle-kit. If you upgrade one of them, run `npm approve-scripts --allow-scripts-pending` to review, then `npm rebuild <pkg>`.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Health shows `database: unavailable` | Is `npm run db:start` running? Is `DATABASE_URL` in the root `.env`? |
| `Invalid environment configuration … SESSION_SECRET: missing` | Fill `.env` (all apps read the root file) |
| `postmaster.pid exists` on `db:start` | `npm run db:stop`, then start again |
| Typecheck complains about `.next/types/…` | Run `npm run build` or `npm run dev` once for that app (Next generates `next-env.d.ts` and route types) |
| Git Bash mangles `next=/academic` in curl args | Prefix the command with `MSYS_NO_PATHCONV=1` |
