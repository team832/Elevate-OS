# elevate — Elevate OS

Elevate OS is the internal operating system for **Elevate Education**, a coaching institute (Sikar + online) preparing students for **CLAT, IPMAT, CUET, Class 11–12 Commerce and CA Foundation**. It replaces scattered spreadsheets, Markdown trackers and chat memory with one system that staff sign in to once.

> Status (22 Oct 2026): Foundation, Marketing OS, Academic OS and Business Ops OS are built and tested; nothing is deployed. The latest work added the Academic teacher workspace (placements, classes and attendance, delivery, timetable patterns, teaching log, reviews, marks, progress, reports) and the Business Ops task tracker, end-of-day versions and teacher operations (D-058 … D-071). `npm run validate` passed: 158 test files, 2,069 tests, secret scan 1,166 files; `npm run build` passed for all four apps. Migrations `0009`–`0012` are applied on the owner's computer (`0012` adds 22 missing database checks, 22 Oct; next = `0013`); both milestones were checked live over HTTP and in Chrome (1440 px). Details: `IMPLEMENTATION_STATUS.md`.

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
| Module | URL | Owns (D-010) | Does **not** own |
|---|---|---|---|
| **Marketing OS** (`apps/marketing-os`) | `/marketing` | Social accounts, ideas, content items & versions, placements, publishing records, marketing metrics, campaigns | Leads (Ops), students (Academic) |
| **Academic OS** (`apps/academic-os`) | `/academic` | Courses, curriculum, batches, teaching assignments, timetable, class records, attendance, assessments, students, enrolments, results, catch-up, interventions; stewards the programme catalogue | Leads/admissions (Ops) |
| **Business Ops OS** (`apps/business-ops-os`) | `/ops` | Leads, enquiries, counselling, demos, admissions, student administration and manual fee records, tasks, SOPs, policies register, decisions, risks, projects, responsibilities; HR (employee records, recruitment, onboarding and offboarding, staff attendance, shifts, leave, compensation records, assets); stewards departments and staff. Not payroll | Enrolment records (Academic), content (Marketing) |
| **Platform** (`apps/platform`) | `/` | Sign-in, home, leadership dashboard, users/sessions/roles | Module data |

Modules never import each other. They cooperate through **contracts** in `@elevate/shared-contracts`:
- **Commands** use the transactional outbox — e.g. the admission → enrolment handoff: Ops publishes `ops.admission.enrolment_requested` v1; Academic replies `academic.enrolment.confirmed` / `.rejected` v1.
- **Read-only summaries** use internal HTTP (`MarketingSummaryV1`, `AcademicDeliverySummaryV1`) where every metric is `ok`, `estimated` or `missing` — **missing is never shown as zero**.

Full rules: `INTEGRATION_CONTRACT.md`. Business requirements: `docs/PRODUCT_REQUIREMENTS.md`. What existed before and why it was rebuilt: `docs/EXISTING_PROJECT_AUDIT.md`. Structured legacy planning data (with provenance and status labels): `data/legacy/README.md`. The original material is kept, read-only, in `C:\OPENBOT\OLD\` (D-001, D-027).

## 2. Repository map
```
apps/
  platform/          @elevate/platform        :3000  sign-in, home, dashboard, rewrites to the zones
  marketing-os/      @elevate/marketing-os    :3001  /marketing   (Marketing team)
  academic-os/       @elevate/academic-os     :3002  /academic    (Academic team)
  business-ops-os/   @elevate/business-ops-os :3003  /ops         (Business Ops team)
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
npm run dev                   # terminal 2 — all four apps
```
Open http://localhost:3000 and sign in as one of the fictional seed users (password = `SEED_USER_PASSWORD`):
`platform-admin@`, `director@`, `marketing-manager@`, `marketing-contributor@`, `academic-coordinator@`, `teacher@`, `admissions-counsellor@`, `operations-manager@`, `auditor@` — all `…@example.test`.

npm 11 runs dependency install scripts only when approved; `package.json → allowScripts` approves embedded-postgres' Windows binaries and esbuild. Details and troubleshooting: `infrastructure/development/README.md`.

## 5. Environment variables
All apps and scripts read the **root** `.env` (git-ignored; values already in the environment win). Validation and per-app subsets: `packages/configuration/src/env.ts`. Placeholder values are rejected.

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | all | `postgres://user:pass@127.0.0.1:54320/elevate` (dev server), or `pglite://memory` / `pglite://<dir>` (single process) |
| `SESSION_SECRET` | all | ≥ 32 chars; HMAC key for session tokens; changing it signs everyone out |
| `INTERNAL_SERVICE_TOKEN` | all | ≥ 32 chars; bearer token for `/api/internal/*`; same in every app |
| `PLATFORM_URL` | modules | Browser-facing platform origin (Server Actions origin check); default `http://localhost:3000` |
| `MARKETING_OS_URL`, `ACADEMIC_OS_URL`, `BUSINESS_OPS_OS_URL` | platform | Module origins for the rewrites (resolved at build/start) |
| `SEED_USER_PASSWORD` | `db:seed` | ≥ 12 chars; password of the fictional seed users |
| `MARKETING_PUBLISHING_ADAPTER`, `MARKETING_METRICS_ADAPTER`, `NOTIFICATIONS_EMAIL_ADAPTER` | modules | `mock` (default) or `disabled` — no live adapters exist (D-014) |
| `LOG_LEVEL` | all | `debug`, `info`, `warn` or `error` |

## 6. Commands
| Command | What it does |
|---|---|
| `npm run dev` | All four apps with hot reload (concurrently) |
| `npm run dev:platform` / `dev:marketing` / `dev:academic` / `dev:ops` | One app |
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
| `npm run db:reset` | Dev only: drop Elevate schemas, migrate, seed (refuses non-local URLs) |
| `npm run db:check` | Read-only check of the local database: live schema = code schema, all migrations applied, valid indexes and constraints, sample-data rules (D-036) |
| `npm run db:backup` | `pg_dump` wrapper (needs PostgreSQL client tools) |
| `npm run docs:permissions` | Regenerate the permission matrix in `docs/SECURITY_AND_PERMISSIONS.md` (`-- --check` to verify) |

## 7. Running modules alone and integrated
- **Integrated:** `npm run dev` (or `dev:platform` + the modules you need) and use http://localhost:3000 — the platform rewrites `/marketing`, `/academic`, `/ops` to the module apps, so one `elevate_session` cookie covers everything.
- **One module alone:** `npm run db:start` + e.g. `npm run dev:academic`, then http://localhost:3002/academic (sign in at `/academic/login`). Links to other zones need the platform running.
- **Production-like:** `npm run build`, then `npm run start -w @elevate/platform` (and `-w @elevate/<module>-os`). With `NODE_ENV=production` the cookie is `Secure` (fine on `localhost`, HTTPS required elsewhere).

## 8. Database, migrations and seed data
- Schemas: `core` (shared, Foundation) and `marketing`, `academic`, `ops` — one file each in `packages/database/src/schema/`, owned by the module team. Design: `DATABASE_DESIGN.md`; columns: `docs/DATA_DICTIONARY.md`.
- Tests never need migrations: `createTestDb()` builds the live schema in in-memory PGlite.
- Migrations are central: **module teams do not run `db:generate`** during wave 2; wave 3 generates the baseline. Process, rollback and the backup-before-destructive rule: `docs/DATABASE_MIGRATION_PLAN.md`; backups/restore: `infrastructure/database/README.md`.
- Seeds are idempotent and **fictional** (D-016): 9 users (one per role), 8 staff, 13 provisional departments from the legacy model, 5 programmes. Modules add seeds in `apps/<module>/seed/index.ts`.

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
| `docs/DECISIONS.md` | Decision log (D-001 … D-071) |
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