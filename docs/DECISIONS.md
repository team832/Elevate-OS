# Architecture Decision Log

Each decision has an ID, a status (Proposed / Approved / Superseded), the decision, and the reason. Decisions marked **Owner decision required** are business choices that only Elevate leadership can make; the code must expose them as configuration or approval states rather than silently pick one.

Technical decisions below were made by the lead engineering agent on 2026-10-17 because the existing project had no application stack (see `docs/EXISTING_PROJECT_AUDIT.md`). They are **Approved (technical)** unless the owner overrides them.

---

## D-001 — New monorepo beside the original source, originals untouched
- **Decision:** Build Elevate OS in `C:\OPENBOT\elevate-os\`. The original material in `C:\OPENBOT\Elevate OS\` (content OS folder tree + operations handover zip) stays read-only source. Nothing there is moved, rewritten or deleted.
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

## D-016 — Development data
Seeds use **fictional people** (staff, students, leads). Business planning data that is not personal (programmes, chapter lists, planned class counts, idea titles) may be imported from the legacy source with its status label preserved (`locked`, `provisional`, `proposed`, `delivered`). Planned counts are never seeded as completed work.
