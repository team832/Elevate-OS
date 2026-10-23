# elevate — Elevate OS

Elevate OS is the internal operating system for **Elevate Education**, a coaching institute (Sikar + online) preparing students for **CLAT, IPMAT, CUET, Class 11–12 Commerce and CA Foundation**. It replaces scattered spreadsheets, Markdown trackers and chat memory with one system that staff sign in to once.

> Status (22 Oct 2026): Foundation, Marketing OS, Academic OS and Business Ops OS are built and tested; nothing is deployed. The latest work added the Academic teacher workspace (placements, classes and attendance, delivery, timetable patterns, teaching log, reviews, marks, progress, reports) and the Business Ops task tracker, end-of-day versions and teacher operations (D-058 … D-071). `npm run validate` passed: 158 test files, 2,069 tests, secret scan 1,166 files; `npm run build` passed for all four apps. Migrations `0009`–`0012` are applied on the owner's computer (`0012` adds 22 missing database checks, 22 Oct; next = `0013`); both milestones were checked live over HTTP and in Chrome (1440 px). Details: `IMPLEMENTATION_STATUS.md`.
>
> Later on 22 Oct 2026 (D-072, D-073): the three modules became three **role workspaces** on their own ports — Business Operations http://localhost:3000/ops, Academic OS http://localhost:3001/academic, Marketing OS http://localhost:3002/marketing — with the platform admin on http://localhost:3003. One sign-in and one database serve all of them. Migration `0013` (remembered workspace) is applied locally; the next is `0014`. Guide: `docs/WORKSPACES.md`. Test and build results of this round: `IMPLEMENTATION_STATUS.md`, section "Role workspaces".
>
> 23 Oct 2026 (D-080 … D-093): an **HR area** in Business Operations (new role HR manager; staff records and HR-only details, teaching assignments, staff attendance, task assignment and submission review, day/week/month work reports, student feedback about teachers, HR settings), file attachments, a notifications inbox in every workspace, AI draft helpers (OpenAI, drafts only), a charcoal sidebar and campaign membership for marketing employees. All new grants are **Proposed**. Migration `0015_hr_staff_workspaces` is written and tested but **not applied**; the next is `0016`. Startup commands are unchanged. Details: `IMPLEMENTATION_STATUS.md`, section "HR area".

## Contents
1. [The three modules and their boundaries](#1-the-three-modules-and-their-boundaries)
2. [Repository map](#2-repository-map)
3. [Stack and why](#3-stack-and-why)
4. [Setup](#4-setup)
5. [Environment variables](#5-environment-variables)
6. [Commands](#6-commands)
7. [Running modules alone and integrated](#7-running-modules-alone-and-integrated)
8. [Database, migrations and seed data](#8-database-migrations-and-seed-data)
9. [Tests](#9-tests)
10. [Adding a feature without breaking boundaries](#10-adding-a-feature-without-breaking-boundaries)
11. [Status vocabulary](#11-status-vocabulary)
12. [How future agents continue](#12-how-future-agents-continue)
13. [Document index](#13-document-index)

## 1. The three modules and their boundaries
Each module is also a **workspace** for one kind of work, on its own origin (D-072): a person opens the workspaces their roles grant (`<workspace>:module:access`). Who sees what: `docs/WORKSPACES.md`.

| Module | URL | Owns (D-010) | Does **not** own |
|---|---|---|---|
| **Marketing OS** (`apps/marketing-os`) | http://localhost:3002/marketing | Social accounts, ideas, content items & versions, placements, publishing records, marketing metrics, campaigns | Leads (Ops), students (Academic) |
| **Academic OS** (`apps/academic-os`) | http://localhost:3001/academic | Courses, curriculum, batches, teaching assignments, timetable, class records, attendance, assessments, students, enrolments, results, catch-up, interventions; stewards the programme catalogue | Leads/admissions (Ops) |
| **Business Ops OS** (`apps/business-ops-os`) | http://localhost:3000/ops | Leads, enquiries, counselling, demos, admissions, student administration, fee agreements and manual fee records, staff tasks and EOD reports (shared with the other workspaces, D-073); stewards departments, staff and the canonical student. HR and Operations were removed (D-032). Not payroll | Enrolment records (Academic), content (Marketing) |
| **Platform** (`apps/platform`) | http://localhost:3003 | Users & roles, Google sign-in callback, leadership dashboard, optional single-origin gateway (rewrites `/marketing`, `/academic`, `/ops`) | Module data |

Modules never import each other, with one exception (D-073): Academic OS may import `@elevate/business-ops-os/work` and Marketing OS `@elevate/business-ops-os/work` and `/leads`, so tasks, EOD reports, leads and follow-ups have one implementation (ESLint `SHARED_ENTRIES`). They cooperate through **contracts** in `@elevate/shared-contracts`:
- **Commands** use the transactional outbox — e.g. the admission → enrolment handoff: Ops publishes `ops.admission.enrolment_requested` v1; Academic replies `academic.enrolment.confirmed` / `.rejected` v1.
- **Read-only summaries** use internal HTTP (`MarketingSummaryV1`, `AcademicDeliverySummaryV1`) where every metric is `ok`, `estimated` or `missing` — **missing is never shown as zero**.

Full rules: `INTEGRATION_CONTRACT.md`. Business requirements: `docs/PRODUCT_REQUIREMENTS.md`. What existed before and why it was rebuilt: `docs/EXISTING_PROJECT_AUDIT.md`. Structured legacy planning data (with provenance and status labels): `data/legacy/README.md`. The original material is kept, read-only, in `C:\OPENBOT\OLD\` (D-001, D-027).

## 2. Repository map
```
apps/
  business-ops-os/   @elevate/business-ops-os :3000  /ops         Business Operations workspace
  academic-os/       @elevate/academic-os     :3001  /academic    Academic workspace (teachers, coordinators)
  marketing-os/      @elevate/marketing-os    :3002  /marketing   Marketing workspace
  platform/          @elevate/platform        :3003  Users & roles, Google sign-in, optional gateway
packages/
  shared-types/      branded IDs, ModuleKey, FeatureStatus, Result, Asia/Kolkata dates
  configuration/     zod env loader (loadEnv), JSON logger; /node: loadRootEnv
  shared-contracts/  entities, API envelope + errors, events, summary contracts (modules/*.ts owned by teams)
  database/          Drizzle schema (core + 3 module files), client, seeds, migrations, createTestDb
  authentication/    scrypt, sessions, elevate_session cookie, login/logout handlers
  authorization/     roles, permissions/{platform,marketing,academic,ops}.ts, can/requirePermission
  server-kit/        defineRoute, transactions, audit, approvals, outbox, internal routes, idempotency
  notifications/     in-app notifications, mock email adapter
  shared-ui/         React server components + styles.css design tokens
  testing/           test DB, test users, authed requests, envelope parsing
scripts/
  development/       db-server.mjs (db:start), migrate.ts, seed.ts, db-reset.ts, permission-matrix.ts
  validation/        secret-scan.mjs
  backup/            pg-backup.mjs
infrastructure/      development/, database/, deployment/ READMEs
docs/                decisions, build plan, audit, requirements, system design, API, security, data dictionary, migrations, testing
data/legacy/         extracted legacy planning data (Legacy-data agent)
```
Each module app follows the BUILD_PLAN layout: `src/app` (thin routes/pages), `src/domain` (pure logic), `src/server` (services), `src/ui`, `tests/unit`, `tests/integration`, `seed/`.

## 3. Stack and why
| Choice | Version | Why |
|---|---|---|
| Node.js / npm workspaces | 24 / 11 | Already installed; no extra tooling (D-003) |
| TypeScript (strict, `noUncheckedIndexedAccess`) | 5.9.3 | TS 7 is not supported by typescript-eslint yet (D-017) |
| Next.js App Router, multi-zone | 16.4.2 | One site for users, independently built modules (D-004) |
| React | 19.3.1 | Server components by default |
| PostgreSQL, one DB / schema per domain | 18 (dev), PGlite 17 (tests) | Integrity where it matters, module independence (D-005) |
| Drizzle ORM + drizzle-kit | 0.45.4 / 0.31.11 | SQL-first schema and migrations, works with PGlite (D-006) |
| embedded-postgres | 18.4.0-beta.17 | Real PostgreSQL for dev without installing anything (D-006a) |
| zod | 4.6.7 | One schema = runtime validation + types (D-007) |
| vitest | 5.0.5 | Fast tests on in-memory PostgreSQL (D-007) |
| ESLint + typescript-eslint, Prettier | 10.13.0 / 8.71.2, 3.9.10 | Quality + enforced module boundaries (D-023) |
| Plain CSS design tokens | — | No Tailwind; calm, legible light/dark UI |

All versions are pinned exactly (D-018).

## 4. Setup
Prerequisites: Windows/macOS/Linux with **Node ≥ 24** and **npm ≥ 11**. No PostgreSQL or Docker needed.
```bash
npm install
cp .env.example .env          # replace every "replace-with-…" value (see §5)
npm run db:start              # terminal 1 — local PostgreSQL 18 on 127.0.0.1:54320
npm run db:generate           # only until wave 3 commits the baseline migration
npm run db:migrate
npm run db:seed
npm run dev:all               # terminal 2 — the three workspaces (:3000, :3001, :3002)
```
`npm run dev:business`, `dev:academic`, `dev:marketing` or `dev:platform` start one app each; each starts the local database if nothing is listening on the `DATABASE_URL` port and otherwise reuses it (with several terminals, run `npm run db:start` yourself first). Sign in on the workspace you need, e.g. http://localhost:3000, as one of the fictional seed users (password = `SEED_USER_PASSWORD`):
`platform-admin@`, `director@`, `marketing-manager@`, `marketing-contributor@`, `academic-coordinator@`, `teacher@`, `admissions-counsellor@`, `operations-manager@`, `auditor@`, `hr-manager@` — all `…@example.test`.

**Demo sign-ins (development only, D-072):** set `LOCAL_DEMO_PASSWORD` (at least 12 characters) in `.env`, then `npm run db:seed-demo-accounts`. It creates `business@elevateeducation.in` (operations manager, :3000), `teacher@elevateeducation.in` (teacher, :3001) and `marketing@elevateeducation.in` (marketing manager, :3002). It refuses production and any non-local database; `npm run db:clear-samples` switches them off before real use.

npm 11 runs dependency install scripts only when approved; `package.json → allowScripts` approves embedded-postgres' Windows binaries and esbuild. Details and troubleshooting: `infrastructure/development/README.md`.

## 5. Environment variables
All apps and scripts read the **root** `.env` (git-ignored; values already in the environment win). Validation and per-app subsets: `packages/configuration/src/env.ts`. Placeholder values are rejected.

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | all | `postgres://user:pass@127.0.0.1:54320/elevate` (dev server), or `pglite://memory` / `pglite://<dir>` (single process) |
| `SESSION_SECRET` | all | ≥ 32 chars; HMAC key for session tokens; changing it signs everyone out |
| `INTERNAL_SERVICE_TOKEN` | all | ≥ 32 chars; bearer token for `/api/internal/*`; same in every app |
| `BUSINESS_OPS_OS_URL`, `ACADEMIC_OS_URL`, `MARKETING_OS_URL`, `PLATFORM_URL` | all | Origin of each app (defaults `http://localhost:3000`, `:3001`, `:3002`, `:3003`; `appOrigin()` in `packages/configuration/src/workspaces.ts`). The dev commands take the port from them; they are the only places a sign-in may redirect to and the only origins whose state-changing requests are accepted (D-072) |
| `SEED_USER_PASSWORD` | `db:seed` | ≥ 12 chars; password of the fictional seed users |
| `LOCAL_DEMO_PASSWORD` | `db:seed-demo-accounts` | ≥ 12 chars; shared password of the three local demo sign-ins; never printed |
| `ATTACHMENTS_DIR` | Business Operations (and the mounted task pages) | Folder for uploaded files in development; empty = `.data/attachments` (git-ignored). Production refuses uploads until a storage provider is chosen (D-085) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI draft helpers | Secret key from platform.openai.com (only in the git-ignored `.env`; the secret scan blocks `sk-` keys) and the model name (no default in code). Without both the AI buttons say "AI drafting is not set up" (D-092) |
| `OPENAI_TIMEOUT_MS`, `OPENAI_BASE_URL` | AI draft helpers | Optional: give up after this many milliseconds (default 20000); API address (default `https://api.openai.com/v1`) |
| `MARKETING_PUBLISHING_ADAPTER`, `MARKETING_METRICS_ADAPTER`, `NOTIFICATIONS_EMAIL_ADAPTER` | modules | `mock` (default) or `disabled` — no live adapters exist (D-014) |
| `LOG_LEVEL` | all | `debug`, `info`, `warn` or `error` |

## 6. Commands
| Command | What it does |
|---|---|
| `npm run dev` / `dev:all` | The three workspaces with hot reload (webpack; Turbopack is blocked on the office PCs); starts or reuses the local database |
| `npm run dev:business` / `dev:academic` / `dev:marketing` / `dev:platform` | One app (:3000 / :3001 / :3002 / :3003). `dev:ops` was removed |
| `npm run build` | Production build of the four apps |
| `npm run typecheck` | `tsc --noEmit` in every workspace + scripts |
| `npm run lint` | ESLint (incl. module-boundary rules), zero warnings allowed |
| `npm run format` / `format:check` | Prettier |
| `npm test` / `test:watch` | vitest, all projects |
| `npm run secret-scan` | Fails on credential-like text or non-ignored `.env` files |
| `npm run validate` | typecheck + lint + test + secret-scan |
| `npm run db:start` / `db:stop` | Local PostgreSQL (embedded-postgres). After a crash, `db:start` removes a stale `postmaster.pid` when nothing listens on the port |
| `npm run db:generate` | drizzle-kit migration from all schema files (the `ops` schema spans five, D-029) (wave 3 / Integration) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Core + module seeds (local DBs only) |
| `npm run db:seed-demo-accounts` | Development only: the three demo sign-ins with `LOCAL_DEMO_PASSWORD` (safe to repeat) |
| `npm run db:clear-samples` | Before real use: delete every sample row and switch the demo sign-ins off |
| `npm run db:reset` | Dev only: drop Elevate schemas, migrate, seed (refuses non-local URLs) |
| `npm run db:check` | Read-only check of the local database: live schema = code schema, all migrations applied, valid indexes and constraints, sample-data rules (D-036) |
| `npm run db:backup` | `pg_dump` wrapper (needs PostgreSQL client tools) |
| `npm run docs:permissions` | Regenerate the permission matrix in `docs/SECURITY_AND_PERMISSIONS.md` (`-- --check` to verify) |

## 7. Running modules alone and integrated
- **Workspaces (default, D-072):** `npm run dev:all` and open each workspace on its own port: http://localhost:3000 (Business Operations), :3001 (Academic), :3002 (Marketing); `/` redirects to the workspace. Browsers share cookies across ports, so the one `elevate_session` cookie signs you in to every workspace your roles grant; signing out anywhere ends the session everywhere.
- **One workspace alone:** e.g. `npm run dev:academic`, then http://localhost:3001 (sign in at `/academic/login`). Panels that show another workspace's figures say "source unavailable" while that workspace is not running; they never show 0.
- **Platform admin and Google sign-in:** `npm run dev:platform` (:3003). The platform can still act as an optional single-origin gateway: it rewrites `/marketing`, `/academic`, `/ops` to the workspace apps.
- **Production-like:** `npm run build`, then `npm run start -w @elevate/platform` (and `-w @elevate/<module>-os`). With `NODE_ENV=production` the cookie is `Secure` (fine on `localhost`, HTTPS required elsewhere).

## 8. Database, migrations and seed data
- Schemas: `core` (shared, Foundation) and `marketing`, `academic`, `ops` — one file each in `packages/database/src/schema/`, owned by the module team. Design: `DATABASE_DESIGN.md`; columns: `docs/DATA_DICTIONARY.md`.
- Tests never need migrations: `createTestDb()` builds the live schema in in-memory PGlite.
- Migrations are central: **module teams do not run `db:generate`** during wave 2; wave 3 generates the baseline. Process, rollback and the backup-before-destructive rule: `docs/DATABASE_MIGRATION_PLAN.md`; backups/restore: `infrastructure/database/README.md`.
- Seeds are idempotent and **fictional** (D-016): 10 users (one per role except the finance-authorised user; `hr-manager@example.test` added 23 Oct), 8 staff, 13 provisional departments from the legacy model, 5 programmes. Modules add seeds in `apps/<module>/seed/index.ts`.

## 9. Tests
`npm test` runs 158 files / 2,069 tests as of 22 Oct 2026 (foundation + all three modules + platform). Strategy, layers and inventory: `docs/TESTING_STRATEGY.md`. Write module tests with `@elevate/testing` (`setupTestDatabase`, `createTestUser`, `authedRequest`, `callRoute`). One project: `npx vitest run --project academic-os`.

## 10. Adding a feature without breaking boundaries
1. Find or add the requirement ID in your module's `requirements/REQUIREMENTS.md` (from `docs/PRODUCT_REQUIREMENTS.md`).
2. **Schema:** add tables to *your* schema file (module-prefixed exports, FKs only into `core`). Tests see them immediately.
3. **Permissions:** add `<module>:<resource>:<action>` to *your* permission file; least privilege (auditor: read only).
4. **Domain:** pure rules in `src/domain` + unit tests (normal, boundary, missing, invalid, conflicting).
5. **Service:** `src/server` — `withTransaction`, repository writes, `recordAudit`, `publishEvent` / `notify` if needed, `scopedValue` for `own` scopes.
6. **Route:** `defineRoute({ permission, body, query, params })` under `src/app/api/v1/…` + integration tests (401/403/400/2xx).
7. **Screen:** server component inside `AppShell`, gated by `requirePageAccess(…, { basePath })`; loading/empty/error/success states from `@elevate/shared-ui`.
8. **Cross-module needs:** add an event in your `shared-contracts/src/modules/<module>.ts`, or consume a summary with `fetchInternal`; never import the other module. Anything in a file you do not own → `docs/INTEGRATION_REQUESTS.md`.
9. `npm run validate`; update module README, API.md, REQUIREMENTS status and your section of `IMPLEMENTATION_STATUS.md`.

## 11. Status vocabulary
`Proposed → Approved → Implemented → Tested → Deployed` (D-013). *Tested* needs a passing automated test recorded in `IMPLEMENTATION_STATUS.md`; *Deployed* needs deployment evidence (none yet). Legacy planning data keeps its own labels — `locked`, `provisional`, `proposed`, `delivered` — and a planned count is never shown as delivered.

## 12. How future agents continue
1. Read `AGENTS.md` (rules), `docs/DECISIONS.md`, `docs/BUILD_PLAN.md` (waves, file ownership), `INTEGRATION_CONTRACT.md`.
2. Read `IMPLEMENTATION_STATUS.md` for what exists and how it was verified, then your module's README and requirements.
3. Work only in your owned paths; record cross-team needs in `docs/INTEGRATION_REQUESTS.md`.
4. Record new technical decisions as `D-0xx` in `docs/DECISIONS.md`; flag business choices "Owner decision required".
5. Finish with `npm run validate` and an honest status update.

## 13. Document index
| Document | Purpose |
|---|---|
| `AGENTS.md` | Non-negotiable rules for coding agents |
| `ARCHITECTURE.md` | Structure, packages, layering |
| `INTEGRATION_CONTRACT.md` | Identities, IDs, ownership, permissions, API, events, summaries, versioning, failure behaviour |
| `DATABASE_DESIGN.md` | Schemas, conventions, core tables |
| `IMPLEMENTATION_STATUS.md` | What is built and the evidence |
| `docs/DECISIONS.md` | Decision log (D-001 … D-093) |
| `docs/WORKSPACES.md` | The three role workspaces: URLs, dev commands, demo sign-ins, sign-in and access rules, role × workspace matrix |
| `docs/BUILD_PLAN.md` | Waves, ownership, module layout, definition of done |
| `docs/EXISTING_PROJECT_AUDIT.md` | Audit of the legacy material |
| `docs/PRODUCT_REQUIREMENTS.md` | Product requirements |
| `docs/SYSTEM_DESIGN.md` | Runtime behaviour, flows, environments |
| `docs/API_SPECIFICATION.md` | API conventions and platform endpoints |
| `docs/SECURITY_AND_PERMISSIONS.md` | Auth, sessions, RBAC, generated role × permission matrix |
| `docs/DATA_DICTIONARY.md` | Core columns |
| `docs/DATABASE_MIGRATION_PLAN.md` | Migration process, rollback, backups |
| `docs/TESTING_STRATEGY.md` | Test layers and inventory |
| `infrastructure/*/README.md` | Dev environment, database operations, deployment outline (Proposed) |
| `packages/*/README.md` | Package APIs |
| `data/legacy/README.md` | Legacy data extracts |
#   E l e v a t e - O S 
 
 