# Release package

The release package is one folder (and one archive) holding the four built apps, the database steps and the scripts that start and check them. Decision: D-112. Status per D-013: **Implemented; checked on three packages on the developer's PC, with a final one to come. Never Deployed.** No host is chosen and nothing is on the internet.

The first package was built on 31 Oct 2026 from a working tree with uncommitted changes (`manifest.json` says `dirty: true`). Figures below come from that package unless marked. Two more followed the same day after a fix round each, also from an uncommitted tree: the second with 11,016 files, 310.7 MB, archive 92.7 MB, 425 s, secret scan OK on all 11,016 files; the third with 11,032 files. Results on all three are under "Checks on the package". Final package and its re-test: GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held).

## Build it

```bash
# the four addresses are compiled in; give them in the environment or in a file
npm run release:package -- --urls-file <file>   # default output: dist/
```

| Option | Meaning |
|---|---|
| `--urls-file <file>` | Reads `BUSINESS_OPS_OS_URL`, `ACADEMIC_OS_URL`, `MARKETING_OS_URL`, `PLATFORM_URL` |
| `--secrets-file <file>` | Values that must not appear in the output (default: the root `.env`; no value is printed) |
| `--from <folder>` | Package existing builds instead of building |
| `--out <folder>` | Where to write |

It stops rather than package something wrong:
- Something is listening on 3000 to 3003 (a build overwrites the `.next` folders those servers read).
- Under about 800 MB free: it waits a minute at a time, then gives up after ten tries.
- A build fails, or a required file is missing from the output.
- A forbidden file is in the output: `.env` files, `.data`, `data/legacy/_private` and `_extract`, sample and clear-samples seed code, demo-account code, tests, `packages/testing`, `embedded-postgres`, `.next/cache`, `.claude`, `marker_env`, `.git`, any `.map`.
- The reference seed bundle holds sample code or an `@example.test` address.
- A secret value turns up in the output, or `secret-scan --path` finds one.

**After it runs**, each app's `.next` holds the standalone build. Run `npm run office:build` before `npm run office`. Checked on 31 Oct: after `office:build` no standalone folder is left and `next start`, `npm run office` and `npm run dev:platform` all work.

## What is in it

```
dist/elevate-os-<version>/
  manifest.json            version, git sha + dirty flag, the four URLs, node version, sha256 of every file, migrations
  README-RUN.md            plain steps for whoever installs it
  .env.production.example  names and rules, no values
  bin/  preflight.mjs  start.mjs  stop.mjs  smoke.mjs
  db/   migrate.mjs  seed-reference.mjs  migrations/  data/ (only the files the seeds read)
  apps/ ops/  academic/  marketing/  platform/   each with its own server.js, .next, node_modules
  scripts/backup/pg-backup.mjs
```

The Hindi and Latin PDF fonts ship in each of the three apps that print PDFs.

No samples, no demo accounts, no sign-ins. `db/seed-reference.mjs` loads departments, programmes, lead sources and stages, courses and plans, social accounts and brand rules. It names its target (`--confirm-database <name>`) and refuses without it. Two optional sets stay out unless asked for: `--include owner-staff` (the 8 real staff names and assignments) and `--include marketing-history` (59 ideas, 36 placements, the 60-post audit). The owner decides these; see `HANDOFF.md`. The names of `owner-staff` ship inside `db/seed-reference.mjs` either way, so **keep the archive private**.

## Sizes and timings (first package, this PC, other work running)

| What | Measured |
|---|---|
| Archive | 92.7 MB |
| Unpacked | 336 MB on disk, 11,018 files (the final package's own log says 310.7 MB, 11,016 files: file sizes without disk rounding) |
| Each app | Ops 90 MB, Academic 84 MB, Marketing 83 MB, Platform 75 MB. Each carries 70 MB of `node_modules`: `next` 28, PGlite 21, `sharp` 19 |
| Longest path | 149 characters inside the package. On Windows use a short folder such as `C:\elevate` |
| Unpack | 25.8 s |
| Preflight on an empty database | 5.9 s |
| Migrate, 18 migrations | 4.7 s |
| Reference seed | 1.7 s (16 seeds) |
| Start, all four | 9.1 s; each app ready in 1.6 to 2.5 s |
| Smoke with a real sign-in | 8.7 s, 32 passed, 0 failed |
| Memory after smoke | Ops 207 MB, Academic 190 MB, Marketing 303 MB, Platform 110 MB |
| Build and package | About 7 minutes on the final package (11:43:57 to 11:51:02). `office:build`, the same four builds without packaging: 427 s |

Under real use, with 50 sessions for 2 minutes on the first package: 6,473 requests, 0 server errors, median 58 ms, 95th percentile 811 ms, slowest 4,683 ms; peak memory Ops 494, Academic 706, Marketing 582, Platform 304 MB; PostgreSQL peak 41 connections of 100 (10 per app). These ran on sample data on a loaded PC, so they are not a promise for real data.

## Install and verify

`README-RUN.md` inside the package holds the steps. In short, from the package folder:

1. Copy `.env.production.example` to `.env.production` and fill it in.
2. `node bin/preflight.mjs`: checks every file against the manifest, the Node version, settings, the four URLs, the database, waiting migrations, the 0017 precheck (`0018` only adds, so it has none), sample rows, demo sign-ins. It ends with the list of things still stopping real use here.
3. `node db/migrate.mjs`
4. `node db/seed-reference.mjs --confirm-database <name>`. The onboarding template and the website prices wait until someone holds the operations manager role; run it again then. It is safe to run again.
5. `node bin/start.mjs`, then `node bin/smoke.mjs` (set `SMOKE_EMAIL` and `SMOKE_PASSWORD` to include a real sign-in and a PDF).
6. `node bin/stop.mjs`

Over an existing database: back up, stop the apps, preflight, migrate, start, smoke.

`db/migrate.mjs` needs no TypeScript or dev tools and uses the same tracking table as `npm run db:migrate`, so a database migrated from source stays consistent. `npm run db:migrate` refuses a non-local database unless given `-- --allow-non-local`.

## What it does not do

- No HTTPS, no hosting, no domain.
- Background jobs are off until someone switches each one on in Settings → Background jobs (D-133); until then they run only from their buttons.
- Uploaded files are kept in the database (`ops.attachment_files`, D-135), so the database must have migration `0019`; preflight names it as a blocker while it is missing.
- No email, publishing or metrics: stand-ins only.
- No monitoring: logs go to `logs/<app>.log`.
- No backup or restore of its own (see Backup below).

## Go-live blockers

No package can fix these. Preflight lists the ones that apply.

| Blocker | Where it stands on 31 Oct 2026 (rows marked 6 Nov updated then) |
|---|---|
| Sign-in for real people | New accounts have no password and no screen sets one. Production needs Google configured, or nobody can sign in, including the first administrator (owner decision D-041) |
| Password reset | Not built |
| Admission confirmation | Asks for the approver's password. A Google-only person has none, and the step refuses. No real admission can be confirmed in production yet (D-041) |
| File storage | In the database since 6 Nov 2026 (D-135); needs migration `0019`. The JSON backup does not handle file bytes well and has no restore |
| Addresses and topology | See "Addresses are built in" below |
| HTTPS | Needs a proxy. The Secure cookie follows `PLATFORM_URL` |
| Scheduler | Built 6 Nov 2026 (D-133). Every job is off until someone with `ops:jobs:run` switches it on in Settings → Background jobs; how often each runs is Proposed. Not yet seen running under `next start` |
| Sign-in limits | Shared by every app and kept across restarts since 6 Nov 2026 (`core.login_attempts`, migration `0019`). See "Sign-in limits" below |
| Backup and restore | `pg_dump` needed; no restore has ever been tried |
| Clean-up | Sessions ended over 30 days ago, expired form keys and expired failed-sign-in counts go when the `housekeeping` job runs (button, or the runner once switched on). The audit trail and event history still grow without limit |
| Monitoring | None |
| External channels | Email, publishing and metrics are stand-ins |
| Owner approvals | Grants marked Proposed, the open questions in `HANDOFF.md`, DPDP guardian consent |
| 0017, 0018, 0019 on the owner's computer | Applied 6 Nov 2026 after a JSON backup; `db:check` 22/22. All three are frozen. A package carries 20 migrations; the next schema change is `0020` |
| A workspace stopped, through the Platform port | A bare 500 (RVD-010, Low). Matters only if staff use the Platform's rewrite instead of the workspace's own port |

Done since the spec of 30 Oct: reference data on a new database (`db/seed-reference.mjs`); an exit reaching Academic (the `enrolment-exits` button, D-115).

## Addresses are built in (F-05)

The four URLs are compiled into the build: the Platform's rewrites, `serverActions.allowedOrigins` and HSTS. There is no `NEXT_PUBLIC_*`. Preflight refuses a mismatch; **a new address needs a new build**.

Each `*_OS_URL` has two meanings: the Platform's rewrite target (internal) and the browser redirect, cross-site allowlist and internal-call address (public). So:
- **Works today:** one host with one port per app, as in office Wi-Fi mode.
- **Does not work:** only the Platform public with private module addresses (browsers get sent to the internal addresses); public module addresses behind the Platform (the rewrite loops); sub-domains (the session cookie is host-only).
- Anything other than one host and four ports needs a second variable (`*_INTERNAL_URL`), which waits for the host choice.

Internal routes (`/<zone>/api/internal/**`) are not forwarded by the Platform: 404 there, and they answer only on the zone's own port with the service token (HAT-004, 20 internal routes checked).

## The proxy must overwrite X-Forwarded-For (API-010)

The apps trust `x-forwarded-for`, because a proxy is expected to set it. With no proxy, a caller can send any value: the first package recorded the session address `8.8.8.8` on request. This is still open and needs the host choice. At go-live the proxy **must overwrite** the header, not append to it.

## Sign-in limits

- Counted once for all four apps in `core.login_attempts` and kept across restarts (6 Nov 2026). The raw email or address is never stored, only an HMAC-SHA256 of it with `SESSION_SECRET`; without `SESSION_SECRET` every sign-in is refused.
- Lock for 15 minutes after 5 failures per email and address, 20 per email, 50 per address.
- 60 wrong passwords at once: 5 checked, 55 refused.
- The per-email limit means anyone can lock a person out of every workspace for 15 minutes.
- Attempts count while in flight, so more than 5 simultaneous correct sign-ins for one person from one address can see a brief 429.

## Forty people at the same instant

On one process, 40 requests for the Overview at the same instant take a median of **9.47 s** on `/ops` (61.9 s before the fix; memory 685 MB, was 3,343 MB). Academic 4.73 s, Marketing 3.36 s. One request alone on `/ops` takes 264 to 298 ms (was 1,220 to 1,802). The next load risk named by the agent who fixed it: `confirmationCheck`, about 18 queries per application, capped at 50.

On the second package the same spike took a median of **16.53 s** on `/ops` (877 MB), Academic 5.70 s, Marketing 3.28 s, with the PC at 34 to 54% load from other agents; the same build alone took 163 to 530 ms a view. This is not shown to be a code regression, and not shown not to be. It needs measuring again on a quiet PC. With 50 sessions for 2 minutes on the same package: 6,763 requests, 0 server errors, median 51 ms, 95th percentile 554 ms, slowest 2,971 ms; PostgreSQL peak 41 of 100.

## Linux, sharp and Turbopack

- **Windows only so far.** The package was built and run on Windows x64 with Node 24.19.0. `node_modules` holds `@img/sharp-win32-x64`, a Windows binary, so build on the target system. Linux has **not** been tested.
- **A clean machine has not been tested.** A resolve trace on this PC found 284 lookups leaving the package; the eight printed were all `@opentelemetry/api` in the home folder's `node_modules`, an optional Next dependency. Unpack on a machine without that folder before relying on it.
- **Turbopack is not proven.** Windows Application Control blocks its binary on this PC, so every build here uses `--webpack`. Workspace membership reads `ELEVATE_BASE_PATH`, inlined at build time (D-113). If a Turbopack build failed to inline it, every signed-in API route would answer **500**, and the handler would not run. That failure was proven from source with the value removed: member and non-member both 500, the handler ran 0 times. It is a closed door, not an open one. Check `/ops/api/v1/leads` signed in after any Turbopack build.
- **PGlite** ships unused (21 MB in each app) because `packages/database/src/client.ts` imports it statically (F-07).

## Stale package rule

A package holds one snapshot. It is stale after any code change, and it does not know that. Before using one, compare `manifest.json` (`git.sha`, `git.dirty`, `builtAt`) with the tree. Rebuild after every fix and re-run the checks on the rebuilt one. Passes on an older package count only for that package; the coordinator's ledger keeps old-package results apart from new ones for this reason.

## Backup

The package's backup script needs `pg_dump`, the PostgreSQL 18 client tool, which is neither included nor installed on this PC (D-024). Without it the script stops and backs up nothing.

```bash
node --env-file=.env.production scripts/backup/pg-backup.mjs --out backups
```

No restore has been tried. Try one on a spare database before relying on it. On the owner's computer the current backup is the JSON helper (`node .data/json-backup.mjs`), which is local and is not a package step.

## Checks on the package

All on 31 Oct 2026, ports 3000 to 3003. Evidence: coordinator folder `rv-a`, `rv-b`, `rv-c`, `rv-last-1`, `rv-last-2`. Each column counts only for its own package.

| Pass | Second package, `elevate_v3` | Third package, `elevate_v4` |
|---|---|---|
| Use cases | 262 pass, 1 fail (APP-18, RVB-009), 3 held | 262 pass, 1 fail (ACH-01, RL1-001, a regression from the last fix), 3 held |
| Who can get in | 6,281 requests: 3,567 non-members refused, 0 server errors, 0 false refusals on 1,343 member reads | The same numbers |
| Interface per login | 19 logins: 0 of 671 denied opened, 418 of 418 allowed, 0 no-access links, 0 dead links | The same numbers |
| Earlier defects | RV-A 31 pass, 3 open (API-010, API-011, HAT-007). RV-C 62 pass, 1 fail (HUS-039), 4 partial, 4 not run, 3 open as recorded | Last fixes: 10 pass, 1 partial (RVC-030), 1 fail (RVB-010, RL1-001) |
| Browser | 3,480 page loads on 11 logins: 0 errors, 0 warnings, 0 hydration messages, 0 failed requests | 1,152 page loads on 3 logins: the same zeros; 237 Ops shapes not reached |
| Attacks and bad input | All held with controls; 8,335 bad requests, 0 server errors | All held; 7,839 sweep and 3,891 fuzz probes, 0 server errors; 224 of 224 cross-site variants refused with no stack lines |
| Money | 171 hand values, 0 wrong | 171 of 171 |
| Races | 18 of 18 | 21 of 21 |

First package, database `elevate_v2`:

| Pass | Result |
|---|---|
| Use cases (register, `docs/CASELETS.md`) | 266 rows: 260 pass, 3 fail, 3 held |
| Who can get in | 481 handlers × 11 roles, 6,281 requests: 3,567 from non-members all refused, 0 server errors, 0 false refusals on 1,343 member reads. 28 path and header tricks refused |
| Interface per login | 19 logins: 0 of 671 denied pages opened, 418 of 418 allowed pages opened, 0 links to a page the login cannot open |
| Earlier defects | RV-A 22 pass, 2 fail (API-010, API-011, both left). RV-B 58 pass, 1 fail. RV-C 57 pass, 3 fail, 5 partial, 6 not run, 3 open as recorded |
| Browser | 6,160 page loads: 14 console errors, all from defects fixed after this pass |

The failures found on these three were fixed in the source afterwards, except what `HANDOFF.md` "Known limits" lists. Re-test on the final package: GitHub check passed on commit 426837d: typecheck, lint, 299 test files (5,667 tests), secret scan, four builds. Final package (11,060 files, 311.4 MB) on the made-up data: 22 of 22 data checks, smoke 25 of 25, walk across 15 working logins with 1,560 direct and 1,814 crawled pages: 0 denied pages opened, 0 server errors. Full register, money by hand, races and browser checks last ran on the package before the made-up data (268 pass, 2 fail since fixed, 3 held).

Not checked anywhere yet: a real Google sign-in, a real phone on the Wi-Fi, a restore, Linux, a host.
