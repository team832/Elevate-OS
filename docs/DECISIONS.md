# Architecture Decision Log

Each decision has an ID, a status (Proposed / Approved / Superseded), the decision, and the reason. Decisions marked **Owner decision required** are business choices that only Elevate leadership can make; the code must expose them as configuration or approval states rather than silently pick one.

Technical decisions below were made by the lead engineering agent on 2026-10-17 because the existing project had no application stack (see `docs/EXISTING_PROJECT_AUDIT.md`). They are **Approved (technical)** unless the owner overrides them.

---

## D-001 — New monorepo beside the original source, originals untouched
- **Decision:** Build Elevate OS in `C:\OPENBOT\elevate-os\`. The original material (content OS folder tree + operations handover zip) stays read-only source. Nothing in it is rewritten or deleted. *Location since 18 Oct 2026:* `C:\OPENBOT\OLD\01-original-elevate-os\` (see D-027; it was `C:\OPENBOT\Elevate OS\Elevate OS\`).
- **Reason:** The original folder is a Markdown/CSV operating manual plus a handover archive, not an application. Restructuring it in place would destroy provenance. Importers read from the original paths.

## D-002 — No existing stack to preserve
- **Decision:** Adopt the default TypeScript stack.
- **Reason:** The only code in the source is two Node scripts (`tools/yt-scan.mjs`, `tools/import-metrics.mjs`) and spreadsheet-builder scripts in the zip that depend on an unavailable library (`@oai/artifact-tool`) and absolute Mac paths. None is a runnable application.

## D-003 — npm workspaces monorepo
- **Decision:** npm workspaces (npm 11 / Node 24 are installed; pnpm is not). No Turborepo/Nx until build times demand it.
- **Reason:** Zero extra tooling to install; keeps commands obvious for non-specialist maintainers.

## D-004 — Next.js multi-zone: one integrated shell + three module apps
- **Decision:** Four Next.js (App Router) apps:
  | App | Package | Port | basePath |
  |---|---|---|---|
  | `apps/platform` | `@elevate/platform` | 3000 | `/` (login, home, consolidated views) |
  | `apps/marketing-os` | `@elevate/marketing-os` | 3001 | `/marketing` |
  | `apps/academic-os` | `@elevate/academic-os` | 3002 | `/academic` |
  | `apps/business-ops-os` | `@elevate/business-ops-os` | 3003 | `/ops` |
  The platform app rewrites `/marketing/*`, `/academic/*`, `/ops/*` to the module apps, so users see one site and one session cookie. Each module also runs standalone on its own port.
- **Reason:** Modules can be developed, tested and deployed independently, while integration is a routing concern rather than a rewrite. This is Next.js's documented multi-zone pattern.

## D-005 — One PostgreSQL database, one schema per domain, central migrations
- **Decision:** A single logical PostgreSQL database with schemas `core`, `marketing`, `academic`, `ops`. All table definitions live in `packages/database/src/schema/<schema>.ts` (one file per owner). Migrations are generated and applied centrally from `packages/database`.
- **Rules:**
  - Foreign keys **into `core`** are allowed from any module.
  - Foreign keys **between module schemas are not allowed.** Cross-module references store the other module's UUID and are validated through a contract (API, event, or documented read function).
  - A module writes only to its own schema. `core` tables are written only through the shared packages (authentication, authorization, server-kit, notifications) or by the designated steward module (see D-010).
- **Reason:** Referential integrity where it matters, without coupling modules' migration lifecycles.

## D-006 — Drizzle ORM; PGlite for tests, real PostgreSQL for dev/prod
- **Decision:** Drizzle ORM + drizzle-kit for schema and SQL migrations. `DATABASE_URL` selects the driver: `postgres://…` → node-postgres; `pglite://memory` or `pglite://<dir>` → PGlite (PostgreSQL compiled to WASM, in-process).
- **Reason:** No PostgreSQL or Docker is installed on the development machine. PGlite gives real PostgreSQL semantics (schemas, constraints, `gen_random_uuid()`, jsonb, transactions) for tests with no install. Prisma's PGlite story is weaker and its generated client complicates a multi-app workspace.
- **Dev server note:** PGlite is single-process, so running four apps at once needs a real server. The foundation build chooses and documents the dev-server approach (embedded PostgreSQL binaries via npm, a local install, or a PGlite socket server) in D-006a.

## D-007 — Validation, testing, lint
- **Decision:** zod for all input validation and shared contracts; vitest for unit and integration tests; ESLint (flat config, typescript-eslint) + Prettier; `tsc --noEmit` per workspace. Playwright E2E is deferred until screens stabilize (recorded in `docs/TESTING_STRATEGY.md`).
- **TypeScript version:** use the latest 5.x unless TypeScript 7 is verified to work with Next.js, typescript-eslint and drizzle-kit together.

## D-008 — Shared identity, server-side RBAC
- **Decision:** One user table (`core.users`), one session system (`core.sessions`, HTTP-only signed cookie shared across zones), roles assigned per user (`core.user_roles`). Roles and their permissions are a typed catalogue in `packages/authorization`. Permissions are strings `<module>:<resource>:<action>`. Every protected route handler and server action checks permissions on the server. Hiding UI is cosmetic only.
- **Starting roles:** `platform_admin`, `director`, `marketing_manager`, `marketing_contributor`, `academic_coordinator`, `teacher`, `admissions_counsellor`, `operations_manager`, `auditor` (read-only). **Owner decision required:** mapping of real staff to roles.

## D-009 — IDs
- **Decision:** Every row's primary key is a UUID (`gen_random_uuid()`), typed in TypeScript as a branded type per entity (`UserId`, `LeadId`, …). Human-readable business codes (idea `CLAT-028`, placement `CLAT-028-IGC`, SOP `SOP-OPS-004`) are separate unique columns. Codes are never reused; the generator reads the max under a lock/unique constraint (fixes the duplicate-ID defect in the legacy `ideas.csv`).

## D-010 — Data ownership
| Entity | Owner | Table |
|---|---|---|
| User, Session, Role assignment | Platform (core) | `core.users`, `core.sessions`, `core.user_roles` |
| Department, Staff member | core, **stewarded by Business Ops OS** (only Ops writes) | `core.departments`, `core.staff_members` |
| Programme catalogue (CLAT, IPMAT, CUET, Commerce, CA Foundation…) | core, stewarded by Academic OS | `core.programmes` |
| Approval request/decision history | core (shared service) | `core.approvals` |
| Audit event | core (shared service) | `core.audit_events` |
| Notification | core (notifications package) | `core.notifications` |
| Integration event outbox | core (server-kit) | `core.integration_events`, `core.event_deliveries` |
| Social accounts, ideas, content items, versions, placements, publishing records, marketing metrics, campaigns | Marketing OS | `marketing.*` |
| Courses, curriculum, batches, teachers' assignments, timetable, class records, attendance, assessments, students, enrolments, results, catch-up, interventions | Academic OS | `academic.*` |
| Leads, enquiries, counselling, demos, admissions, tasks, SOPs, decisions, risks, projects, responsibilities | Business Ops OS | `ops.*` |

## D-011 — Cross-module integration style
- **Decision:**
  1. **Commands that must not be lost or duplicated** (e.g. admission → enrolment) use the **transactional outbox**: the producer writes its state change and a `core.integration_events` row in one transaction; the consumer processes events idempotently (`core.event_deliveries` unique on event+consumer) and may emit a reply event.
  2. **Read-only summaries** (Ops dashboards showing academic delivery and marketing performance) use versioned HTTP endpoints `GET /<zone>/api/internal/v1/summary` returning a shared zod contract. The consumer must render "source unavailable" rather than zero when a source fails.
  3. Module server code is never imported by another module. Integration tests and the platform app may import modules' published entry points.
- **Reason:** Exactly-once-effect for business-critical handoffs without running a message broker; no hidden coupling.

## D-012 — API conventions
- REST JSON under `/<basePath>/api/v1/…`. Success `{ "data": … }`; failure `{ "error": { "code", "message", "details"?, "requestId" } }`. Codes: `VALIDATION_FAILED` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `INVALID_STATE_TRANSITION` 409, `INTERNAL` 500.
- Create operations that could be retried accept an `Idempotency-Key` header or rely on a natural unique key.
- Breaking changes → `/api/v2/…`; v1 kept until consumers migrate.

## D-013 — Feature status vocabulary
`Proposed` → `Approved` → `Implemented` → `Tested` → `Deployed`. "Tested" requires a passing automated test recorded in `IMPLEMENTATION_STATUS.md`. "Deployed" requires evidence of deployment. Nothing is Deployed as of 2026-10-17.

## D-014 — External integrations are adapters, default mock
- Metricool, Instagram, YouTube, LinkedIn, the CRM and Vacademy are reached only through adapter interfaces. The default adapter is a **sandbox/mock** that never claims a real connection. Connection status is stored and shown honestly (`not_configured` / `sandbox` / `connected` / `error`). No adapter is marked `connected` without real credentials and a successful verification call.

## D-015 — Scope limits (not built unless authorized)
Payroll, biometric device integration, legal employment records, a full HRIS, parent/student portals, the public website, and AI content generation are **out of scope**. Staff leave/attendance is out of scope pending owner decision.

Narrowed by D-028 (19 Oct 2026).

## D-016 — Development data
Seeds use **fictional people** (staff, students, leads). Business planning data that is not personal (programmes, chapter lists, planned class counts, idea titles) may be imported from the legacy source with its status label preserved (`locked`, `provisional`, `proposed`, `delivered`). Planned counts are never seeded as completed work.

---

# Decisions added by the Foundation wave (2026-10-17/18)

## D-006a — Development database server: `embedded-postgres` (Approved, technical)
- **Decision:** `npm run db:start` runs real PostgreSQL binaries from the npm package `embedded-postgres@18.4.0-beta.17` (`@embedded-postgres/windows-x64`), cluster in `.data/postgres` (git-ignored), listening on `127.0.0.1` only. User, password, port and database are parsed from `DATABASE_URL` in the root `.env` (default `postgres://elevate:<local password>@127.0.0.1:54320/elevate`). It refuses non-local hosts and placeholder passwords. `npm run db:stop` (or Ctrl+C) stops it cleanly with `pg_ctl stop -m fast`.
- **Evidence (this machine, Windows 11, Node 24.19.0):** first `initialise()` 5.8 s, start < 1 s, `SELECT version()` → `PostgreSQL 18.4 on x86_64-windows, compiled by msvc-19.44.35226, 64-bit`; `gen_random_uuid()` works. `db:generate` (throwaway) → `db:migrate` (twice, idempotent) → `db:seed` (twice, idempotent: 9 users, 9 role grants, 13 departments, 5 programmes, 8 staff) → `db:reset --yes` all succeeded against it; platform (3000), Marketing OS (3001) and Academic OS (3002) served health 200 with `database: ok` from it. The throwaway migration and its tables were then removed.
- **Why not the alternatives:** `@electric-sql/pglite-socket` was not needed once real PostgreSQL ran; a local PostgreSQL install would add a manual step.
- **Consequences:** npm 11.17 blocks install scripts by default, so the root `package.json` has an `allowScripts` entry for `@embedded-postgres/windows-x64@18.4.0-beta.17` (its postinstall restores symlinked libraries) and the esbuild versions. The Windows binary package does **not** include `pg_dump`/`pg_restore`/`psql`; backups need the PostgreSQL 18 client tools installed separately (D-024). Tests still use PGlite (PostgreSQL 17 in WASM) — see D-025.

## D-017 — TypeScript 5.9.3, not 7.x (Approved, technical)
- **Decision:** pin `typescript@5.9.3` (latest 5.x).
- **Reason:** `typescript-eslint@8.71.2` declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`, so TypeScript 7.0.2 is unsupported by the linter. Next.js 16.4.2 type-checks with the installed 5.9.3 during `next build` without issue; drizzle-kit 0.31.11 runs under tsx/esbuild independent of the TS version.
- **Revisit when** typescript-eslint supports 7.x.

## D-018 — Pinned toolchain (Approved, technical)
Exact versions, verified to install and work together on this machine: next 16.4.2 (Turbopack build), react/react-dom 19.3.1, @types/react(-dom) 19.3.0, drizzle-orm 0.45.4, drizzle-kit 0.31.11, @electric-sql/pglite 0.5.10, pg/@types/pg 8.23.1, zod 4.6.7, vitest 5.0.5, eslint 10.13.0, @eslint/js 10.0.1, typescript-eslint 8.71.2, @next/eslint-plugin-next 16.4.2, eslint-plugin-react-hooks 7.1.1, globals 17.13.0, prettier 3.9.10, tsx 4.23.15, concurrently 10.0.6, @types/node 24.19.2, embedded-postgres 18.4.0-beta.17. `eslint-config-next` is **not** used (it bundles eslint-plugin-react/import/jsx-a11y whose ESLint-10 support is unverified); the Next and react-hooks plugins are wired directly in `eslint.config.mjs`. Next.js 16 renamed `middleware.ts` to `proxy.ts`; the platform uses `src/proxy.ts`. `next lint` no longer exists; `npm run lint` runs ESLint directly.

## D-019 — Session tokens and cookie (Approved, technical)
Random 32-byte token in the `elevate_session` cookie (`HttpOnly; SameSite=Lax; Path=/; Secure` in production; 7-day absolute lifetime). The database stores only `HMAC-SHA256(SESSION_SECRET, token)`, so a database leak alone does not yield usable sessions, and rotating `SESSION_SECRET` signs everyone out. This fulfils D-008's "signed cookie" requirement with server-side revocation. CSRF: SameSite=Lax plus JSON-only bodies on `defineRoute` routes (cross-site forms cannot send `application/json`); login/logout accept HTML forms (login/logout CSRF is low impact and documented).

## D-020 — `RATE_LIMITED` (429) added to the D-012 error codes (Approved, technical)
Login throttling needs an honest status. `RATE_LIMITED` → 429 extends the D-012 list. The throttle is in-memory per process (known limitation, see docs/SECURITY_AND_PERMISSIONS.md).

## D-021 — Root `.env` for every app and script (Approved, technical)
All four Next.js apps and all scripts read the single root `.env` (process environment wins). `next.config.ts` parses it with `node:util.parseEnv` because `@next/env.loadEnvConfig` caches the app directory's result and silently ignores a second directory (found during verification: health reported `database: unavailable` until this was fixed). Scripts use `loadRootEnv()` from `@elevate/configuration/node`.

## D-022 — Redirects in basePath apps; no root `loading.tsx` (Approved, technical)
Verified on Next 16.4.2: `redirect()` in a server component **prepends the app's basePath** (`redirect('/academic/login')` in Academic OS went to `/academic/academic/login`). `requirePageAccess`/`requireUser` therefore take browser paths plus `basePath` and strip it (`toAppPath`). A root `app/loading.tsx` wraps pages in Suspense and turns auth redirects into a streamed 200 with a client-side refresh; the apps have no root `loading.tsx` so signed-out visitors get a real 307. ~~Put `loading.tsx` in nested route segments.~~ **Corrected 18 Oct 2026:** Marketing OS's smoke test showed nested `loading.tsx` files do the same thing to pages under them (the redirect becomes a 200 page load; no data is shown, but the 307 is lost). Do not use `loading.tsx` on permission-checked pages; render loading states after the access check instead. Academic OS still has eight nested ones — removal is part of the integration pass.

## D-023 — Module boundaries enforced by ESLint (Approved, technical)
`eslint.config.mjs` fails the build when a module app imports another module app (package name or relative path), when shared packages import apps, when application code imports test helpers, or when `apps/*/src/domain/**` imports frameworks, the database, server-kit or Node I/O. Verified with a probe file (both violations reported, file deleted).

## D-024 — Backups need separately installed client tools (Approved, technical)
`npm run db:backup` wraps `pg_dump --format=custom` for the five Elevate schemas, password via `PGPASSWORD`. `pg_dump` is not bundled on Windows by embedded-postgres, so it looks for `PG_BIN_DIR` or PATH and exits with code 2 and a clear message if absent (verified). The backup itself has **not** been executed on this machine. Rule: take and verify (`pg_restore --list`) a backup before any destructive migration (docs/DATABASE_MIGRATION_PLAN.md).

## D-025 — Test database built from the live schema (Approved, technical)
`createTestDb()` (`@elevate/database/testing`) diffs an empty snapshot against the four schema files with `drizzle-kit/api` (`generateDrizzleJson` + `generateMigration`) and executes the DDL in a fresh in-memory PGlite (PostgreSQL 17.x WASM). No generated migrations are needed during wave 2. Verified: a table temporarily added to `src/schema/ops.ts` was created by `createTestDb()` (then removed). Consequence: tests run on PostgreSQL 17 semantics while dev runs 18 — avoid version-specific SQL features.

## D-026 — Foundation seed data (Approved, technical; owner confirmation pending)
Core seeds: one **fictional** user per role (`<role>@example.test`, alliterative names marked "(fictional)") with `SEED_USER_PASSWORD`; 8 fictional staff records linked to them; the 13 departments from the legacy "Suggested departments" table (handover zip → `elevate-education-operations/SYSTEM_ARCHITECTURE.md`, "a starting model") seeded with status `provisional`; programmes CLAT, IPMAT, CUET, COMMERCE_11_12 (`active`) and CA_FOUNDATION (`planned`; legacy: paused, 1 March 2027 start confirmed). **Owner decision required:** confirm the department structure and programme statuses.

## D-027 — Legacy material moved into `C:\OPENBOT\OLD` (Approved, owner request 18 Oct 2026)
- **Decision:** At the owner's request, everything old was separated from the current work into one structured folder. Nothing was deleted or edited; every file was moved as-is.
  | Was | Now |
  |---|---|
  | `C:\OPENBOT\Elevate OS\Elevate OS\` (content OS + handover zip) | `C:\OPENBOT\OLD\01-original-elevate-os\` |
  | handover zip contents (previously only a temporary extracted copy) | `C:\OPENBOT\OLD\02-operations-handover-extracted\` (new extracted copy; the zip stays in 01) |
  | `C:\OPENBOT\ELEVATE-OS-COMPLETE-EXTRACTION.md` | `C:\OPENBOT\OLD\03-early-analysis\` |
  | `C:\OPENBOT\Elevate OS\__MACOSX\` (Mac zip metadata) | `C:\OPENBOT\OLD\04-mac-zip-metadata\__MACOSX\` |
- **Evidence:** 247 files / 11,295,906 bytes before and after; every file's SHA-256 identical. The empty `Elevate OS` shell folder was removed.
- **Consequence:** path references in `docs/EXISTING_PROJECT_AUDIT.md`, `docs/PRODUCT_REQUIREMENTS.md`, `README.md` and `data/legacy/**` (README, MANIFEST, `_extract` scripts) were updated. `data/legacy/_extract/extract_legacy.py` now defaults to the permanent extracted handover in `OLD\02-…` instead of a temporary session folder. The legacy JSON extracts themselves are unchanged (their `source.path` values are relative aliases).

## D-028 — Business Ops HR scope extended (Approved, owner request 19 Oct 2026; policies stay Proposed)
- **Context:** D-015 kept staff attendance/leave and HR records out of scope "unless authorized". On 19 Oct 2026 the owner (elevatesikarcentre@gmail.com) supplied the *Business Operations OS master implementation prompt*, which authorises building HR and employee management, recruitment, onboarding/offboarding, staff attendance, shifts, leave, employment-document metadata, restricted compensation records and HR/admissions/operations reporting in Business Ops OS.
- **Decision:** D-015 is narrowed. Now **in scope**: employee records, organisation history, recruitment, onboarding/offboarding, staff attendance (manual + validated CSV import), shifts, work calendars, leave requests/approvals, document metadata (files behind a storage adapter), compensation *records* and exports, assets. Still **out of scope**: payroll execution, statutory deductions/tax/PF/ESI/payslips, biometric device integration (mock adapter only, D-014), a payment gateway, parent/student portals.
- **Every HR rule is configuration with a decision state.** Attendance rules, shift timings, leave types/entitlements/accrual/carry-forward/encashment, holiday calendar and retention periods are `proposed` or `open` until the owner supplies the actual policy (OD-026 and new owner decisions listed in `docs/BUSINESS_OPERATIONS_AUDIT.md`). Nothing is enforced as company policy merely because a default exists.
- **Permission profiles** (not people): `hr_manager`, `hr_contributor`, `recruiter`, `department_manager`, `employee`, `finance_officer` added to `ROLE_KEYS`. Nobody holds them until a platform administrator assigns them; a company email grants nothing. Sensitive record sets — `ops:employee_private:*`, `ops:employee_documents:*`, `ops:compensation:*`, `ops:student_private:read` — are excluded from the blanket "all reads" grant: the auditor and director do not see them by default and the operations manager does not see salary/private HR data (the owner may widen this). HR `own` scope = the user's own staff record plus, for `department_manager`, their whole reporting chain (`apps/business-ops-os/src/server/hr-scope.ts`). Nobody decides their own request.

## D-029 — The `ops` schema is split across several files (Approved, technical)
`packages/database/src/schema/ops.ts` keeps the wave 2 tables; HR records live in `ops-hr.ts`, recruitment/onboarding/offboarding in `ops-lifecycle.ts`, attendance/shifts/leave in `ops-time.ts`, operations additions in `ops-work.ts`; shared column helpers in `ops-columns.ts` (not a schema file). All of them use the single `pgSchema('ops')` exported by `ops.ts` (no import cycle: `ops.ts` never imports the others). `SCHEMA_MODULES` and `drizzle.config.ts` list every file; `MANAGED_SCHEMAS` is unchanged. Reason: parallel work without edit conflicts and files of reviewable size.
