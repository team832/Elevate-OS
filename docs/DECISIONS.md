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
Verified on Next 16.4.2: `redirect()` in a server component **prepends the app's basePath** (`redirect('/academic/login')` in Academic OS went to `/academic/academic/login`). `requirePageAccess`/`requireUser` therefore take browser paths plus `basePath` and strip it (`toAppPath`). A root `app/loading.tsx` wraps pages in Suspense and turns auth redirects into a streamed 200 with a client-side refresh; the apps have no root `loading.tsx` so signed-out visitors get a real 307. ~~Put `loading.tsx` in nested route segments.~~ **Corrected 18 Oct 2026:** Marketing OS's smoke test showed nested `loading.tsx` files do the same thing to pages under them (the redirect becomes a 200 page load; no data is shown, but the 307 is lost). Do not use `loading.tsx` on permission-checked pages; render loading states after the access check instead. Academic OS's eight nested ones were removed on 20 Oct 2026 (Suspense after `gate()` in `apps/academic-os/src/ui/shell.tsx`); production smoke test: all eight pages return 307 when signed out.

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

## D-030 — Only @elevateeducation.in accounts may use Elevate OS (Approved, owner request 20 Oct 2026)
- **Decision:** Elevate OS is internal software. Only people with an `@elevateeducation.in` email may hold an account or sign in, by email + password or by Google sign-in. The domain is a constant (`ORGANISATION_EMAIL_DOMAIN` in `packages/authentication/src/email-domain.ts`), not configuration, so no deployment can widen it. Exact match only: subdomains and look-alike domains are refused.
- **Enforced at every way in:** the password login handler (403 before any lookup), `checkPassword`, `validateSession` on every request (a non-organisation account never has a live session), Google sign-in (the ID token must carry `hd = elevateeducation.in`, a verified email and the same domain), and the database: CHECK `users_email_domain` on `core.users` (migration `0001_users_email_domain.sql`).
- **Fictional seed/test accounts** (`@example.test`, D-016) are accepted outside production only. With `NODE_ENV=production` they cannot sign in and their sessions are invalid; the database constraint still admits the domain so local seeds and tests work.
- **Signing in grants nothing:** a first-time Google sign-in from the organisation creates an account with no roles; a platform administrator assigns roles (OD-009). Setting a password by email ("set your password" link) needs an email provider and is deferred (PLT-EMAIL).
- **Google sign-in implementation (20 Oct 2026, technical):** OpenID Connect authorization code flow with PKCE, written with `node:crypto` and `fetch` (no new dependency) in `packages/authentication/src/google.ts`; routes `GET /api/v1/auth/google/start` and `/callback` on the platform only. Optional: without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` the button is hidden and both routes answer 404 (D-014). The redirect URI is `PLATFORM_URL` + `/api/v1/auth/google/callback`; module login pages link to the platform start route with `next` set to the module path (a plain link, so CSP `form-action` is unaffected). State, nonce and PKCE verifier live in a 10-minute HttpOnly, SameSite=Lax cookie HMAC'd with `SESSION_SECRET`. The ID token is verified locally (RS256 against Google's JWKS, cached by key id and refetched on an unknown one; issuer, audience, expiry with 5 minutes' skew, nonce, `email_verified`, `hd`) and `isAllowedEmail` is applied with production rules in every environment, since a Google account is never `@example.test`. A disabled account is refused. Refusals are logged without tokens or emails and counted by the per-IP throttle. Owner setup: `docs/GOOGLE_SIGN_IN_SETUP.md`.
- **Users & roles screen and first-owner bootstrap (20 Oct 2026, technical):** `/admin/users` (list: search, role/status/"No roles yet" filters, sort, 25 per page; detail: role checklist from `ROLES`, Save roles, Disable/Enable account, audit history) on `platform:users:read`, with `platform:roles:manage` / `platform:users:manage` for changes; API `/api/v1/admin/users/**`. Server rules: nobody changes their own roles or status; the last active `platform_admin` cannot lose the role or be disabled (409; admin rows are locked first); unknown role keys are 400; added people must pass `assertAllowedEmail` (403) and get no password (Google sign-in; password by email is PLT-EMAIL); disabling ends every session. Audited as `user.created`, `user.roles_changed`, `user.disabled`, `user.enabled`. The first administrator at go-live comes from optional `BOOTSTRAP_OWNER_EMAILS` (only exact `@elevateeducation.in` addresses; anything else is a configuration error and sign-in fails until fixed): at every sign-in (password or Google, shared `openSession`) a listed email gets any missing `platform_admin` and `director` role, audited `role.bootstrapped` only when something was added. While an email stays listed its two roles return at each sign-in, so remove it once another administrator exists.

## D-031 — Security headers and Content-Security-Policy (Approved, technical, 20 Oct 2026)
All four apps send a per-request nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`, `style-src-attr 'unsafe-inline'` because React `style={}` props render as attributes that nonces cannot cover, `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a deny-all `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin` and `X-Robots-Tag: noindex, nofollow` (internal app), with no `X-Powered-By`. The CSP is set in each app's `src/proxy.ts`; the static headers come from `@elevate/configuration/security-headers` via `next.config.ts` (the platform skips `/ops`, `/academic` and `/marketing` so the modules' own headers pass through the rewrites). HSTS and `upgrade-insecure-requests` are added only for production builds served over https; `includeSubDomains` waits until the owner confirms no subdomain is http-only. Development relaxes the CSP for hot reload only. Google sign-in uses plain links and a server redirect, so `form-action 'self'` does not affect it.

## D-032 — Owner removed HR and Operations from Business Ops (Approved, owner decision 20 Oct 2026)
- **Decision:** the owner chose to delete the existing HR features (employee records, private HR fields, documents, compensation, assets, recruitment, onboarding/offboarding, staff attendance, shifts, leave, timesheets, HR reports) and the Operations features (tasks, task dependencies, escalations, SOPs and acknowledgements, the policies & compliance register, incidents, decisions, risks, projects, milestones, responsibilities, the work inventory, staff onboarding items, the operations report) from Business Ops, to concentrate the module on admissions. Supersedes D-028's HR scope; D-029 (split `ops` schema files) is moot.
- **Kept, because admissions depends on it:** leads, counselling, demos, admissions, students, fee records, follow-ups, enrolment handoff, schedule, settings (HR/task/incident keys removed), core approvals with the approvals inbox limited to fee arrangements, the staff directory and departments (Ops stays steward of `core.staff_members` / `core.departments`; teachers are staff), `ops.staff_profiles`, the dashboard (task and blocker KPIs removed) and the admissions report. Role `finance_officer` stays for fee records (the owner may remove it later); `teacher` stays (Academic) without its Ops task grant.
- **Removed with it:** roles `hr_manager`, `hr_contributor`, `recruiter`, `department_manager`, `employee`; 43 Ops permission keys (61 → 18); event `ops.employee.separated` v1 and the platform access-revocation consumer and job; 56 `ops` tables, dropped by migration `0002_remove_hr_operations.sql` (which also deletes `core.user_roles` rows for the removed roles, removed setting keys, pending SOP/policy approvals and undelivered `ops.employee.separated` events); the legacy decision/SOP/work-inventory/responsibility seeds and the HR seeds.
- **Recovery:** everything is in git; the last commit that contains it is `63da4e4` (branch `feature/business-ops-hr-admissions`). The prototype (`C:\OPENBOT\Elevate`) still shows the Operations screens until a separate `elevate-prototype` change.

## D-033 — Canonical student identity in `core.students` (Approved, technical, 20 Oct 2026)
- **Decision:** one row per person who studies (or studied) with Elevate lives in `core.students` (`StudentIdentityId`). Business Ops is the steward (it creates the row at conversion); Academic enrolments link to it by plain UUID (IR to Academic). No contact data in core: contacts and guardians stay in restricted Ops tables. Rows are never physically deleted; exits are recorded in Ops.
- **Why:** the owner's brief (20 Oct 2026) forbids competing student records, and the audit found Academic creating one student row per admission (a child admitted twice got two rows).

## D-034 — Programme catalogue and combinations (Approved, owner decision 20 Oct 2026)
- **Decision:** the programmes sold are CLAT, IPMAT (IIM Indore IPM; the owner's "IAM IP mat"), CUET, CA Foundation, Class 11 and Class 12. A student joins one combination: Class 11 + CLAT, Class 12 + CLAT, CLAT only, Class 11 + IPMAT, Class 12 + IPMAT, Class 12 + CA Foundation, Class 11 + CUET, Class 12 + CUET, Class 11 alone, Class 12 alone (`apps/business-ops-os/src/domain/catalog.ts`). The owner wrote "CAT" in the CLAT line; it is read as CLAT. Classes run online and offline, both at the Sikar centre. `CLASS_11`/`CLASS_12` were added to the `core.programmes` seed; `COMMERCE_11_12` stays for Academic's existing data.
- **Also decided:** SSRN is out of scope; the seven teacher names are correct ("Satish Raghuvanshi" as on the public site).
- **Open:** whether IIMB UG ("IMBUG") is coached inside IPMAT; whether Class 11/12 are Commerce only; dropper batch; CA Foundation start date (`docs/PUBLIC_COURSE_CATALOG_RESEARCH.md` §5).

## D-035 — Demo = 3 classes by default, configurable (Superseded by D-038 on 21 Oct 2026)
- **Decision:** the standard demo is three classes per demo student, each tracked as its own session record. Setting `admissions.demo.session_count` defaults to 3 and stays editable (audited). Supersedes the legacy fixed two-day demo (legacy D-003/D-004). Whether the whole checklist must be complete before conversion stays a `proposed` setting (`admissions.demo.checklist_required`, off).

## D-036 — One clean sample set and clearer Ops table names (Approved, owner request 21 Oct 2026; technical choices Implemented)
- **Owner request (21 Oct 2026):** "create it in a more structured way … perfectly structured, with no vague data"; the owner named messy sample data ("Tara Teacher (fictional)" teaching every subject, many ADM codes) and asked for a clearer schema with plain-language docs.
- **Sample data:** sample records are marked by an `is_sample` flag (`ops.leads`, `core.students`, `ops.staff_profiles`; everything else follows its lead or student) and the SAMPLE DATA badge, by "Sample …" names ("Aarav Sample Student", "Sample Counsellor", one "Sample <Subject> Teacher" per subject; "Tanisha Demo Student" keeps the brief's name) and by `@example.test` emails with no phone numbers. This supersedes the "(fictional)" name suffix for Ops and core samples (AGENTS.md rule 7; the workspace CLAUDE.md wording is the owner's file and is unchanged). One sample set, `apps/business-ops-os/seed/samples.ts`, replaces the six earlier fixture seeds: 9 demo cases mapped 1:1 to the brief plus 1 mock Marketing handoff. The seven owner-supplied teachers are never given sample classes or meetings. `npm run db:clear-samples` deletes every sample row (and its dependants) in one transaction before real use; it refuses non-local databases and keeps the sample logins (other modules reference them; production refuses `@example.test` sign-in, D-030), audit and outbox history.
- **Schema (migration `0005_clear_names`, nothing deployed):** `ops.counselling_sessions` → `ops.appointments` (`scheduled_at` → `starts_at`, `counsellor_staff_id` → `staff_id`; unused `attendees` dropped) because it holds every appointment type; legacy demo columns `subjects`, `day_dates`, `status`, `is_sample` and table `ops.demo_teachers` dropped because `ops.demo_sessions` is the only source; `demos.fee_amount_inr` numeric → `fee_amount_paise` bigint so all money is integer paise; `admissions.student_id` → `academic_student_id` and `student_identity_id` → `student_id` (also `guardians`, `report_exports`) so `student_id` always means `core.students`; `appointment_participants.guardian_ref` → `guardian_id` with a foreign key; `staff_profiles.staff_ref` → `staff_code` (it is a human code, not a staff reference). Naming convention recorded in `ops.ts`: `_staff_id`, `student_id`, `_by`, `_at` (UTC), `_date`/`_on` (IST day), `_paise`.
- **Docs:** `apps/business-ops-os/docs/DATA_DICTIONARY.md`, generated from the schema and its comments by `npm run docs:data-dictionary` (`-- --check` reports drift).

## D-037 — Commerce cohorts, dropper batch, CA running, admission numbers 001… (Approved, owner decision 21 Oct 2026)
- **Class 11 and Class 12 are Commerce only** — complete Commerce batches (`CLASS_11` "Class 11 Commerce", `CLASS_12` "Class 12 Commerce").
- **Dropper batch** (`DROPPER`) for students who have finished Class 12, always with one exam: CLAT, IPMAT (incl. IIMB UG-AT), CUET or CA Foundation. A dropper is never enrolled alone (`apps/business-ops-os/src/domain/catalog.ts`).
- **CA Foundation is running now** (status `active`; supersedes the legacy "1 March 2027 start").
- **IIMB UG-AT is coached inside the IPMAT batch**; its syllabus finishes earlier because that exam comes first. No separate programme.
- **Admission numbers run 001, 002, 003 …** — sequence only, three digits, no prefix or year; 1000 follows 999. Setting `admissions.number.format` is now approved (was proposed).

## D-038 — Demo = 3 demo days, each with one or more classes (Approved, owner decision 21 Oct 2026)
- **Decision:** a demo is three scheduled demo days (not necessarily consecutive); each day holds one or more class sessions. Setting `admissions.demo.day_count` (approved, 3) replaces `admissions.demo.session_count`; migration `0007` moves a stored value to the new key. `ops.demos.planned_day_count` is copied at booking; `ops.demo_sessions.day_number` says which day a class belongs to (existing classes: day N = class N). Progress counts days attended; sessions attended are shown separately. Attendance adds `late` and `excused`; a substitute teacher is flagged (`is_substitute`). Extra days only through the `admissions.demo.extension` setting (proposed, off). Demo outcome `no_show` is added; "completed" is `completed_at` with the outcome still open (completing the days never enrols).
- **Supersedes:** D-035's "3 classes".

## D-039 — Annual tuition 50 / 25 / 25, separate registration and demo charges (Approved, owner brief 21 Oct 2026 §9)
- **Decision:** annual tuition per admission and academic year is split 50 %, 25 %, 25 % (setting `fees.tuition_split`, approved, not editable here). Each share is floored to the paisa; the remainder goes to the last instalment. Registration and demo fees are separate ledger charges (`ops.fee_records.charge_category` = `registration` / `demo`), never part of the split. Due dates are entered per student (no monthly default). Money is ledger rows only; refunds and reversals are linked rows (`reverses_record_id`), never deletions or a "paid" checkbox. A changed accepted agreement is a new `fee_plans` version (`supersedes_plan_id`, `adjustment_reason`). Registration amount (`fees.registration`) and a payment gate before confirmation (`admission.payment_gate`) stay **Proposed** (not set / none). The demo-fee credit (`fees.demo_credit`, on) follows the approved demo terms ("adjusted against fees on joining", legacy D-003/D-004 in `demo.terms`); it stays configurable, and a credit is only ever a linked ledger row against a recorded demo payment.

## D-040 — Admission number at final confirmation, immutable, never reused (Approved, owner decision 21 Oct 2026)
- **Decision:** the number (format D-037: 001, 002 …) is given only in the final-confirmation transaction: the service writes `ops.admissions.admission_number` first, then the `ops.admission_approvals` row (one per admission case, unique number, never updated or deleted). Existing numbers are kept, never renumbered or recycled: `ops:admission_number:override` may only enter a number where none was given. Setting `admissions.number.format` is approved and no longer editable here. The structured `ELEV-{YYYY}-{CC}-{DDMM}-{NNN}` format is documented as a **Proposed** alternative only.
- **Enforced by the database (round 1, supersedes the earlier "service guard only" ruling):** `admission_approvals (admission_id, admission_number)` references `admissions (id, admission_number)` (unique constraint `admissions_id_number_key`), so the approval's number must equal the admission's and any later `UPDATE` of that number fails. A foreign key is part of the Drizzle schema, so it holds in `createTestDb` (D-025) as well as in migrated databases; a trigger would not.
- **Legacy:** admissions numbered or admitted before `0007` are marked `admissions.legacy_verification = 'required'` ("Legacy — verification required"); an `ops:admissions:confirm` holder reconciles them (`verified`, audited). No approval, signed form or payment evidence is invented for them.

## D-041 — Password re-check at admission confirmation; Google-only accounts fail closed (Approved, technical, 21 Oct 2026; owner decision open)
- **Decision:** confirming an admission needs `ops:admissions:confirm` and the approver's account password in the same request, verified on the server against the stored hash, throttled per user, never logged or stored (setting `admissions.confirm.reauth`, method `password`). Accounts without a password (Google sign-in only: every real staff account today) cannot confirm and get a specific error.
- **Holders are Proposed** (brief §1 lists "who may finalize admissions" as not approved): director and operations manager are granted so the workflow can run; the owner must confirm or change them.
- **Re-check evidence:** the audit event written in the confirmation transaction (actor, request id, application version, `reauth_method`, `reauth_verified_at`) is the evidence; `admission_approvals` stores the method and time, never the password.
- **Open owner decisions:** (1) Google re-authentication (`prompt=login` / `max_age`) for admission confirmation; (2) who may confirm admissions (and who verifies identity documents, reviews reports and sends event messages: operations manager only, proposed).

## D-042 — PDFs with pdf-lib, fontkit and a vendored OFL font (Approved, technical; owner approved 21 Oct 2026)
- **Decision:** admission forms, acknowledgements, ID cards and progress reports are real PDFs built with `pdf-lib` + `@pdf-lib/fontkit` and one vendored SIL OFL font that has the ₹ sign (licence file kept beside it). PDFs and print views are light (white paper); the screens keep the dark theme.

## D-043 — Admissions lifecycle schema (Approved, technical, 21 Oct 2026; migration `0007_admissions_lifecycle`)
- **Applications:** `ops.applications` (one per primary admission case; origin demo / direct / readmission; status draft → ready_for_review → form_generated → signatures_confirmed → admission_confirmed, or withdrawn), `application_versions` (content snapshot + SHA-256), `application_forms` (PDF hash, template version), `signature_confirmations` (one live row; a material change invalidates it), `admission_approvals` (D-040). Forms, signatures and approvals reference `application_versions (application_id, version)` by composite foreign keys, so a form or signature can never belong to another application or a missing version. `ops.admissions.application_id` (nullable, indexed) links every admission case an application covers (multi-programme bundles; the primary too). `ops.ts` and `ops-applications.ts` import each other; the cycle is safe because the `ops` schema object lives in `ops-columns.ts` and the cross-file references are lazy FK callbacks.
- **KYC:** identity documents keep a masked reference only (`ops.kyc_documents`: at most 4 digits in total and at least one mask character X, x, * or •; same rule as `isMaskedReference` in `@elevate/shared-contracts`; no numbers, no scans — no protected file storage exists). A guardian's document must belong to a guardian of the same student (composite foreign key). KYC edit history is the audit trail (`core.audit_events` before/after), not a second table. Student KYC stays on the lead (`date_of_birth`, `address`, emergency contact, interested programmes); class/category is `leads.current_stage` (`gap_year` = dropper). Guardians gain `is_primary` (one live per student), `is_emergency`, `address`; sibling links are explicit (`ops.student_siblings`), never inferred from a shared phone.
- **Onboarding:** versioned templates; items copied per admission; append-only status events; material issue / return / replacement rows (`ops-onboarding.ts`).
- **Teacher reviews** stay in the single store `ops.teacher_student_feedback` with `scope` (demo_session / enrolment / general), `demo_session_id`, `enrolment_id` and `visibility` (internal by default).
- **Reports:** `report_exports` gains audience, draft / reviewed / final, snapshot and source references; exports made before `0007` are marked final with a `{legacy: true}` snapshot.
- **Events:** appointment types `event` and `webinar` (no single person needed; title required); participants keep a name snapshot, how they were added, removal, registration and attendance; `ops.event_messages` never `sent` without a provider reference.
- **Exits:** existing `withdrawn` = early withdrawal, `completed` = completion; exit records add reason code, prior batch, balance in paise, material status and closing notes.
- **Integrity added in round 1:** `fee_records.plan_id` / `instalment_id` are foreign keys; at most one open admission without a programme per lead; report reviewer ≠ requester; event messages `sent` need a non-blank provider reference; indexes on the new foreign keys and on `follow_ups (admission_id, status)` and merged leads.
- **Permissions (least privilege; holders Proposed, D-041):** new `ops:admissions:confirm` (director, operations manager), `ops:kyc:verify`, `ops:student_reports:review`, `ops:event_messages:send` (operations manager). Onboarding and applications reuse `ops:admissions:write`; KYC documents are read with `ops:student_private:read`; events are scheduled with `ops:appointments:manage`.

## D-044 — Registration fee ₹5,000, charged once per student (Approved, owner decision OD-013 in part, 21 Oct 2026)
- **Decision:** setting `fees.registration` = `{ amountPaise: 500000 }` (₹5,000), approved. Charged once per student (current rule: a second programme admission of the same student is not charged again). **Still open:** whether it is charged again in each academic year.
- **Decided by:** the owner. **Source:** owner, in session, 21 Oct 2026.
- **Consequence:** `apps/business-ops-os/src/domain/policies.ts`; "Registration fee not configured" no longer appears with the default; tests `tests/unit/staff-settings.test.ts`, `tests/integration/fee-plans.test.ts`. A stored row in an existing database still overrides the default (setting stays editable).

## D-045 — Demo fee ₹1,000 (Approved, owner decision OD-013 in part, 21 Oct 2026)
- **Decision:** setting `demo.fee` = `{ amountInr: 1000 }`, approved (was `pending_verification`). The value keeps its rupee shape because demo booking already converts it to paise (`server/demos.ts`) and stored rows use that shape. **Still open from OD-013:** refund and waiver limits (D-046 clause 1 makes fees non-refundable unless a written exception is approved; who may approve an exception is not decided).
- **Decided by:** the owner. **Source:** owner, in session, 21 Oct 2026.
- **Consequence:** `policies.ts`; new demo bookings copy `feeTermsState = approved`; tests `staff-settings.test.ts`, `organisation.test.ts`.

## D-046 — Admission declaration and terms: the owner's paper form, version 2 (Approved, owner decision 21 Oct 2026)
- **Decision:** setting `admissions.declarations` = the wording of the owner's admission form "Student Admission & Fee Record" (student / parent declaration, fee acknowledgement, Terms & Conditions 1–12; typos from the paper fixed), version `2`, approved. Stored as one `text` field (sections separated by line breaks; the setting has no section fields).
- **History:** a version 1 draft (declaration with "[owner to supply]" and "[contact email]" placeholders) was approved earlier the same session and replaced before release by the owner's own form; it was never printed. The setting keeps no history; this entry is the record.
- **Decided by:** the owner. **Source:** owner-supplied paper form, approved in session, 21 Oct 2026.
- **Consequence:** `policies.ts`; the form PDF prints the text and the confirmation gate (`server/applications.ts`, decision state `approved`) passes with the default. Test `staff-settings.test.ts` (approved, 17 lines, no placeholders, every glyph in the PDF font).

## D-047 — Nikunj Bindal teaches Accounts (Approved, owner decision 21 Oct 2026)
- **Decision:** Nikunj Bindal (role stays Head of Business Operations; role and teaching stored separately, like Sushant Bindal) teaches Class 11/12 Accountancy, CA Foundation Paper 1 (Accounting) and CUET Accountancy. No contact details, login or credentials are stored. No Academic batch teacher assignment is created.
- **Decided by:** the owner. **Source:** owner, in session, 21 Oct 2026.
- **Consequence:** `apps/business-ops-os/seed/teachers.ts` adds the three subject capabilities and removes the old "Accountancy / CA — no teacher" row on re-seed; test `tests/integration/appointments.test.ts`. Existing databases change only after `npm run db:seed` (local only).

## D-048 — Institute address and GSTIN from the owner's form (Approved, owner decision 21 Oct 2026)
- **Decision:** `INSTITUTE` (`packages/shared-ui/src/components/brand.tsx`) gains `address` "214, Bhaskar Heights, Silver Jubilee Road, Sikar, Rajasthan 332001" and `gstin` "08AACC2204Q120". The GSTIN is printed **exactly as on the form**: it has 14 characters while a GSTIN has 15; the owner was told and accepted this. Phone (8505099888) and website (elevateeducation.in) already matched. The form's email `team@elevateeducation.in` differs from the stored public email `elevatesikar@gmail.com`; the stored one is kept until the owner says which to publish.
- **Decided by:** the owner. **Source:** owner's admission form, approved in session, 21 Oct 2026.

## D-049 — Public email: team@elevateeducation.in (Approved, owner decision 21 Oct 2026)
- **Decision:** `INSTITUTE.email` (`packages/shared-ui/src/components/brand.tsx`) is `team@elevateeducation.in`, the address on the owner's admission form. It is printed on admission documents and shown wherever `INSTITUTE.email` is used. This settles the open point in D-048; `elevatesikar@gmail.com` is no longer published.
- **Decided by:** the owner. **Source:** owner answer in session, 21 Oct 2026.

## D-050 — Student identity created at demo booking (Approved, technical, 21 Oct 2026; supersedes D-033's timing)
- **Decision:** the `core.students` row is created when a demo is booked (`ensureStudentIdentity` in `server/pipeline.ts`; the lead row is locked so two bookings cannot make two identities), not at conversion. Conversion and direct admission reuse `admissions.student_id`. Identities for demos that never convert stay (rows are never deleted, D-033); `is_sample` follows the lead.
- **Why:** owner brief §3 / acceptance 1 — demo attendance, reviews and the later admission hang off one person from the first class.
- **Unchanged from D-033:** one row per person, no contacts in core, Ops is the steward.

## D-051 — Draft syllabus reference courses (Approved as drafts, owner request 21 Oct 2026)
- **Decision:** Academic seed `academic.syllabus-drafts` (`apps/academic-os/seed/syllabus.ts`; data `data/syllabus/syllabus-distribution-2026-10-21.json`, official sources only, accuracy-reviewed) adds five **draft** courses: `CLAT-SYL-2027`, `CUET-SYL-2026`, `CAF-SYL-2024`, `COM-C11-2627`, `COM-C12-2627` — subjects, chapters and weights only; no plans, class counts or teacher assignments. Each description says "Draft syllabus — pending owner verification" and names its source.
- **Owner answers built in:** Class 11/12 Mathematics (041) and Applied Mathematics (241) are separate subjects (the student or batch takes one); CUET holds all six Commerce papers and the counsellor picks five per student; IPMAT chapter weights = the average of the IIM Indore, IIMB UG-AT, IIM Rohtak and JIPMAT shares, written onto the **existing** IPMAT-BASE chapters only (codes, order, plan and the locked 253 classes unchanged); CA Foundation course `CAF-ACC-SEP27` is `active` (implements D-037).
- **Open (owner):** approve the five course codes; CA chapter weights on `CAF-ACC-SEP27`; whether Sobha's "Commerce" means Business Studies; an IIMB-first schedule. Local data changes only after `npm run db:seed`.

## D-052 — Daily tasks and end-of-day reports built in Elevate OS (Approved, owner decision 21 Oct 2026; partly reverses D-032)
- **Decision:** staff get "My day" tasks and a daily end-of-day (EOD) report at `/ops/tasks` (My day, All tasks, EOD, Team EOD). Own code, written from the owner's description; nothing is copied from the purchased third-party "Daily Task & EOD Report Tool" (licence). Tables `ops.staff_tasks` and `ops.eod_reports` (`packages/database/src/schema/ops-tasks.ts`, migration `0008_staff_tasks`, applied locally by the owner and now frozen — later changes go in `0009`). Permissions `ops:tasks:read`, `ops:tasks:write` (own scope for staff) and `ops:eod:review`.
- **Rules:** a report goes to the staff member's active manager (`core.staff_members.manager_id`); without one it goes to `ops:eod:review` holders (shortcut). "Share" is simulated and audited (no messaging provider). Changes are kept as audit history.
- **Reverses in part:** D-032 removed the old Operations task module; this is a smaller, new feature, not that module back.
- **Not built:** weekly/monthly range report, calendar view.

## D-053 — Admission confirmation is idempotent through its approval row, not request replay (Approved, technical, 21 Oct 2026)
- **Decision:** `POST /ops/api/v1/applications/{id}/confirm` does **not** use `defineRoute({ idempotency })`. Server-kit would store an unsalted SHA-256 of the body, which holds the approver's password (a password-equivalent at rest), and its transaction would roll back the audit row of a failed password attempt. The unique `ops.admission_approvals` row is the idempotency record instead: a retry or a second click on the same application version replays it (200, `replayed: true`); another version gets 409.
- **Money routes differ:** fee routes accept an optional `Idempotency-Key` (their bodies hold no secrets; 24-hour replay window). The shared `ActionForm` sends one automatically and disables its button before the request.
- **Evidence:** `apps/business-ops-os/tests/integration/applications.test.ts` (retry and parallel clicks).

## D-054 — Screens: keep the dark theme, redesign the layout (Approved, owner decision 21 Oct 2026)
- **Decision:** after seeing the screens the owner asked for "UI first": keep the dark look, redesign the structure. Layered dark surfaces; orange only for the main action and the current place; a grouped sidebar (Today, Admissions, Students, Money, People, Reports) with a module switcher; a header band with underline tabs; figure strips; toolbar filters; journey and timeline components. The theme now lives once in `packages/shared-ui` (the four apps' own theme blocks were deleted). Tables become cards below 720 px. This replaces the "do not restyle" line of the `elevate-ops-ui` skill for layout only; tokens and accessibility rules stay.
- **UI libraries:** React Aria (`react-aria-components`) is approved as a dependency but **not used**: search stays a plain form (a ComboBox would log a phone search on every keystroke and add script to every page). shadcn, TanStack, Spectrum audits and Recharts are guidance only. No UI dependency was added.
- **Open:** the owner confirms the new sidebar grouping.

## D-055 — Sample clean-up before real use (Approved, technical, 21 Oct 2026; extends D-036)
- **Decision:** the owner ran `npm run db:clear-samples` (850 sample rows removed, real rows untouched, admission-number counter reset so real numbers start at 001) and then `npm run db:seed`. Sample admissions that must look admitted are admitted by `admitSample` (seed only, `is_sample` only) with **no** approval row and `legacy_verification = 'required'`; no password check or declaration text is faked. Sample fee agreements follow the real path (manager makes → counsellor requests → director approves → manager activates).
- **Final-wave follow-ups:** clear-samples also closes sample events still waiting in the outbox (two Academic replies had retried into "unknown admission"); samples stop creating admission-level fee approvals.
- **Backup** taken before clearing, in `.data/backups/` (git-ignored, local only).

## D-056 — Search uses the address bar; host logs must drop query strings (Approved, technical, 21 Oct 2026)
- **Decision:** global search is `GET /ops/search?q=…` (shareable, works without JavaScript). A query that looks like an email, or a phone (4 or more digits), searches contacts only for `ops:student_private:read` holders and is audited with a masked value; others search names and references only. The student list search sends a full phone (10 or more digits) or an email to the same audited contact filter; admission numbers have three digits, so they never look like a phone there.
- **Consequence:** a phone number can sit in the address bar, browser history and server request logs. Any host must keep request logs **without query strings** (deployment step in `HANDOFF.md`); staff on shared computers should use a private window.

## D-057 — A fee approval binds one exact agreement version (Approved, technical, 21 Oct 2026)
- **Decision:** each fee-agreement version is activated only with its own approval (core policy `ops.fee_agreement.version`, subject = that `fee_plans.id`), decided by someone other than the requester and the version's maker; finance then activates it. Older admission-level `ops.admission.fee_arrangement` approvals stay readable and activate nothing. A paid demo fee is never credited automatically at confirmation (manual linked credit only).
- **Why:** review found approvals reused across sibling admissions, years and versions; binding to the version id closes every reuse path (`apps/business-ops-os/tests/integration/fee-plans.test.ts`, "an approval binds one exact agreement version", 10 paths).
- **Proposed (owner to confirm):** a discount, waiver or credit on an active agreement needs `ops:admissions:approve`, a reason, and a poster who is not the agreement's maker (implemented). The alternative — a second person approves every such posting — is the owner's choice.
