# Implementation Status

Status vocabulary (D-013): **Proposed → Approved → Implemented → Tested → Deployed**. "Tested" = a passing automated test listed here. Nothing is Deployed. Each agent edits only its own section.

---

## Foundation (wave 1a) — completed 2026-10-18

### Features
| # | Feature | Status | Evidence |
|---|---|---|---|
| F-01 | npm workspaces monorepo, strict TS (`noUncheckedIndexedAccess`), ESLint flat config, Prettier, vitest projects | Tested | `npm run validate` passes (below) |
| F-02 | Module-boundary lint rules (no module→module, no package→app, pure domain, no test helpers in app code) | Tested (manual probe) | Probe file importing `@elevate/academic-os/domain` + `@elevate/database` from `apps/marketing-os/src/domain` → 2 ESLint errors; probe deleted |
| F-03 | `@elevate/configuration` — zod env loader, per-app subsets, one error listing all problems, placeholder rejection; JSON logger | Tested | `packages/configuration/tests/env.test.ts` |
| F-04 | `@elevate/shared-types` — branded IDs, ModuleKey, FeatureStatus, Result, Asia/Kolkata dates, role keys | Tested | `packages/shared-types/tests/shared-types.test.ts` |
| F-05 | `@elevate/shared-contracts` — entities, envelope + AppErrors, enrolment handoff events v1, event registry, MarketingSummaryV1 / AcademicDeliverySummaryV1 with missing ≠ zero | Tested | `packages/shared-contracts/tests/contracts.test.ts` |
| F-06 | `@elevate/database` — core schema (12 tables), module schema files, driver factory (node-postgres / PGlite), audit insert | Tested | `packages/database/tests/create-test-db.test.ts`; dev-server run below |
| F-07 | `createTestDb()` builds all four schema files without migrations; picks up new module tables | Tested | same test file (every exported table exists); manual: temporary `opsProbeLeads` in `ops.ts` was created, then reverted |
| F-08 | Migration runner, seed registry + core seed, `db:reset` safety | Implemented (manual verification) | Commands below |
| F-09 | `@elevate/authentication` — scrypt, hashed-token sessions, expiry/revocation, cookie, throttle, login/logout handlers | Tested | `packages/authentication/tests/{password,sessions}.test.ts` |
| F-10 | `@elevate/authorization` — roles, per-module permission files, can/requirePermission/scopeFor/scopedValue/modulesFor, invariants (auditor read-only, only platform_admin administers users) | Tested | `packages/authorization/tests/authorization.test.ts`; matrix generated into `docs/SECURITY_AND_PERMISSIONS.md` |
| F-11 | `@elevate/server-kit` — defineRoute (401/403/400/200, error mapping, Idempotency-Key), approvals (self-approval rule, history), outbox (idempotent publish/consume, retry/dead), internal routes + fetchInternal, health, `toAppPath` | Tested | `packages/server-kit/tests/*.test.ts` |
| F-12 | `@elevate/notifications` — in-app notify/list/mark-read, mock email adapter (never claims delivery) | Tested | `packages/notifications/tests/notifications.test.ts` |
| F-13 | `@elevate/shared-ui` — AppShell, PageHeader, Card, DataTable, badges, Button, form fields, Alert, Empty/Error/Loading states, StatTile, LoginForm, CSS tokens (light/dark) | Tested | `packages/shared-ui/tests/shared-ui.test.tsx` |
| F-14 | `@elevate/testing` — setupTestDatabase, createTestUser, authedRequest, callRoute | Tested | `packages/testing/tests/testing.test.ts` |
| F-15 | `apps/platform` — login, logout, home (modules user can open), honest dashboard placeholder, `/api/health`, `/api/v1/auth/me`, proxy redirect, rewrites to the three zones | Tested + manual E2E | `apps/platform/tests/**`; curl run below |
| F-16 | Module skeletons (marketing-os 3001, academic-os 3002, business-ops-os 3003) — basePath, login, AppShell home behind `<module>:module:access`, `/api/v1/health`, layout folders, `./domain` `./server` `./seed` exports | Tested + manual E2E | `apps/*/tests/{unit,integration}`; curl run below |
| F-17 | Dev database via embedded-postgres (D-006a) | Implemented (manual verification) | Commands below |
| F-18 | Secret scan | Tested (manual probe) | Clean run + probe with 3 fake secrets → 3 findings, exit 1 |
| F-19 | Backup wrapper (`db:backup`) | Implemented, **not verified** | `pg_dump` not installed; script exits 2 with a clear message (D-024) |

### Commands run (Windows 11, Node 24.19.0, npm 11.17.0) and results
| Command | Result |
|---|---|
| `npm install` | OK (4 "high" advisories, all `braces`→`micromatch`→`fast-glob` inside `@next/eslint-plugin-next`, dev-only lint tooling; npm's only fix downgrades the plugin to 14.x, not applied) |
| `npm run typecheck` (all 14 workspaces + `tsconfig.scripts.json`) | PASS |
| `npm run lint` (`eslint . --max-warnings=0`) | PASS |
| `npm test` | PASS — 22 files, 115 tests |
| `npm run secret-scan` | PASS (274 files) |
| `npm run validate` | PASS (exit 0) |
| `npx prettier --check .` | PASS |
| `npm run build` (all four apps, Next 16.4.2 Turbopack) | PASS |
| `npm run docs:permissions -- --check` | PASS |
| `npm run db:start` | PASS — "PostgreSQL 18.4 ready on 127.0.0.1:54320, database "elevate"" (first init 5.8 s) |
| `npm run db:generate` (throwaway) | PASS — `0000_*.sql`, 12 core tables, `CREATE SCHEMA` core/marketing/academic/ops |
| `npm run db:migrate` ×2 | PASS (second run no-op) |
| `npm run db:seed` ×2 | PASS — idempotent: users 9, user_roles 9, departments 13, programmes 5, staff_members 8 |
| `DATABASE_URL=postgres://…@db.example.com/… db:reset` | Refused, exit 1, nothing changed |
| `db:reset --yes` (local) | PASS — dropped, migrated, seeded |
| `npm run db:backup` | Exit 2: pg_dump not found (expected on this machine) |
| Cleanup | Throwaway migration files deleted; Elevate schemas dropped from the dev DB; `npm run db:stop` → "server stopped"; all app servers stopped |

### End-to-end smoke test (production builds: `next start` platform :3000, marketing-os :3001, academic-os :3002, against the dev DB)
| Check | Result |
|---|---|
| `GET :3000/api/health`, `GET :3002/academic/api/v1/health`, `GET :3000/academic/api/v1/health` (through rewrite) | 200, `database: ok` (all three) |
| `GET :3000/` without session | 307 → `/login?next=%2F` |
| `GET :3000/academic` without session (rewrite → Academic OS) | 307 → `/academic/login?next=%2Facademic` |
| `GET :3000/academic/login` | 200, form action `/academic/api/v1/auth/login` |
| `POST :3000/api/v1/auth/login` (form, teacher, `next=/academic`) | 303 → `/academic`, `elevate_session` cookie set |
| `GET :3000/academic` with that cookie (**session crosses the rewrite**) | 200, `<h1>Academic OS</h1>`, "Tara Teacher (fictional)", switcher shows only Home + Academic OS |
| `GET :3000/marketing` as teacher | 200 page with "No access to Marketing OS" (no data) |
| `GET :3000/api/v1/auth/me` | 200, modules `platform, academic`, teacher grants `own` |
| Wrong password (JSON) | 401 `UNAUTHENTICATED` "Email or password is incorrect." |
| Auditor: login + `/api/v1/auth/me` | modules = all four; actions only `access`, `read`; `/dashboard` 200 |
| `POST :3000/academic/api/v1/auth/logout` then `GET /academic` | 303 → `/academic/login`; then 307 → login (session revoked) |

Defects found and fixed during verification: `@next/env` ignored the root `.env` (D-021); Next `redirect()` double-prefixed the basePath and root `loading.tsx` downgraded auth redirects to 200 (D-022).

### Known limitations (Foundation)
- Login throttle is in-memory per process; no password reset/MFA/user-admin screens yet.
- No scheduler for outbox consumers (`processEvents` must be called by the consumer module).
- Backups not executed (no `pg_dump` on this machine).
- Tests run on PGlite (PostgreSQL 17) while dev runs PostgreSQL 18.
- Playwright E2E deferred; cross-zone checks are manual (above).
- Permission grants for module roles are a Foundation proposal; module teams refine them.
- Departments and CA Foundation status are provisional pending owner confirmation (D-026).

---

## Marketing OS (wave 2) — 2026-10-18
_Owned by the Marketing team._ Module manual: `apps/marketing-os/README.md`; per-requirement status: `apps/marketing-os/requirements/REQUIREMENTS.md`. Nothing is Deployed; no real platform is connected (publishing is a mock that reports `sandbox` and never a URL).

### Features
| # | Feature (requirements) | Status | Evidence |
|---|---|---|---|
| M-01 | Social account registry, OD-001 conflict surfaced, honest integration status (MKT-001, PLT-017) | Tested | `tests/integration/accounts-ideas.test.ts` |
| M-02 | Idea tracker: `COURSE-NNN` codes (counter + unique + savepoint retry, never reused), fields, lifecycle (MKT-003/004) | Tested | `accounts-ideas.test.ts` (12 concurrent creates, taken-code retry, archive), `unit/codes-duplicates.test.ts` |
| M-03 | Duplicate-idea detection (block exact same-course, warn otherwise) | Tested | `unit/codes-duplicates.test.ts`, `accounts-ideas.test.ts` |
| M-04 | Content items, immutable versions with hash, asset metadata, assignees, comments (MKT-010, MKT-023 partial) | Tested | `content-workflow.test.ts` |
| M-05 | State machine + approval via core approvals bound to version hash; approver roles policy (OD-002 proposed); no self/author approval (MKT-009/011, PLT-004/006) | Tested | `content-workflow.test.ts`, `unit/content-state-rules.test.ts` |
| M-06 | Brand-rule checker (45 rules as data), checklist acknowledgements, consent for students (OD-008 proposed), rights gate (MKT-012/022) | Tested | `unit/content-state-rules.test.ts`, `content-workflow.test.ts` |
| M-07 | Placements `<IDEA>-<ACCOUNT>[S|L]`, scope rule, collab groups (MKT-002/014) | Tested | `placements-publishing.test.ts`, `unit/schedule-collab-publishing.test.ts` |
| M-08 | Schedule-conflict detection (hard: not approved, past, LI cadence; warnings: collisions, cadence targets, stagger) + calendar (MKT-015/016/017) | Tested | same files |
| M-09 | Publishing via adapter (mock/disabled), idempotent per placement+version, retries ≤ max, manual publication record (MKT-024/025/026) | Tested | `placements-publishing.test.ts` |
| M-10 | Metrics CSV import (TS port, declared dates, impressions ≠ views, capture time, value states, rejected rows, idempotent) (MKT-028/029/030) | Tested | `legacy-metrics-summary.test.ts`, `unit/metrics-legacy.test.ts` |
| M-11 | Weekly aggregation per account/campaign with coverage; weekly report screen (MKT-032 partial) | Tested | same files |
| M-12 | Legacy import: accounts, rules, ideas with quarantine (OD-003), placements/content items (ambiguous linked to quarantine), post audit as labelled historical snapshots; idempotent (MKT-034/035) | Tested | `legacy-metrics-summary.test.ts` |
| M-13 | `GET /marketing/api/internal/v1/summary` → MarketingSummaryV1 (missing ≠ zero, sandbox excluded) (MKT-037, PLT-009) | Tested | `legacy-metrics-summary.test.ts` |
| M-14 | Organic campaigns + placement assignment (MKT-018 partial); settings/rules screen with proposed owner decisions | Tested | `campaigns.test.ts` |
| M-15 | Screens: dashboard, accounts, ideas (list/new/detail), content item, calendar, metrics import, weekly report, campaigns, settings — AppShell, loading/empty/error/success | Implemented (manual smoke test below) | — |
| M-16 | Permissions refined (least privilege; 3 new permissions) | Tested | route 401/403 tests above; catalogue invariants (`packages/authorization` tests) |

### Commands run (2026-10-18) and results
| Command | Result |
|---|---|
| `npm run typecheck -w @elevate/marketing-os` | PASS |
| `npx eslint apps/marketing-os packages/database/src/schema/marketing.ts packages/authorization/src/permissions/marketing.ts packages/shared-contracts/src/modules/marketing.ts --max-warnings=0` | PASS |
| `npx vitest run apps/marketing-os` | PASS — 11 files, 105 tests (62 unit, 43 integration) |
| `npm run build -w @elevate/marketing-os` | PASS (Next 16.4.2; 38 route handlers, 11 pages) |
| `npm test` (root, all teams) | PASS — 58 files, 506 tests |
| `npm run typecheck` (root), `npm run lint` (root), `npm run secret-scan` | PASS / PASS / PASS (650 files) |
| `npm run docs:permissions -- --check` | FAILS as expected: matrix stale after the permission changes (IR-MKT-01, Integration regenerates) |
| Smoke: production build + `next start` on a PGlite directory seeded with core + `marketing.legacy` | health 200; all screens 200 (manager); signed-out `/marketing/ideas` 307 → login; teacher “No access”; API flow idea CLAT-029 → item → placement → submit → approve → schedule → publish = “SANDBOX: nothing was posted … no URL”, repeat publish `duplicate=true`; internal summary returned v1. Server stopped; smoke DB and script removed. |

Defect found and fixed during the smoke test: segment `loading.tsx` files turned the sign-in redirect into a 200 (D-022); removed — pages show their loading state through a Suspense boundary placed after the permission check.

### Known limitations / Proposed
Idea inbox, pillar/series lists, fact register, repurposing, lead-time flags, post reviews, competitor scans, enquiry handoff event (MKT-005/006/007/013/019/027/031/033/036), paid campaigns, block override with reason, director-only approval for fees/offers, republish with reason, hold-flag API, match-confirmation UI, real adapters (OD-006), browser E2E. Tests use PGlite (single connection), so lock contention is verified by design rather than under real parallel load. Requests to other owners: `apps/marketing-os/docs/INTEGRATION_REQUESTS.md`.

## Academic OS (wave 2) — 2026-10-18
_Owned by the Academic team._ Requirement-level status: `apps/academic-os/requirements/REQUIREMENTS.md`; manual: `apps/academic-os/README.md`; test inventory: `apps/academic-os/docs/TEST_PLAN.md`. Nothing is Deployed. Planning data keeps its labels (locked / provisional / proposed / superseded); nothing is seeded or reported as delivered.

### Features
| # | Feature (requirements) | Status | Evidence |
|---|---|---|---|
| A-01 | Curriculum: courses (versions under core programmes), subjects, stable chapter codes with aliases, plan versions (`locked`/`provisional`/`proposed`/`superseded`, `supersedes`, counts/dates labels), lock/provisional/supersede only via core approval by another coordinator (ACD-001, 004, 005) | Tested | `tests/integration/curriculum.test.ts`, `tests/unit/intake-plans.test.ts` |
| A-02 | Curriculum coverage: planned vs verified minutes/hours per chapter, subject, course (ACD-006, 021) | Tested | `tests/unit/progress.test.ts`, `curriculum.test.ts` |
| A-03 | Batches, teacher assignments (core staff → subject → batch), rooms, holiday/closure/blackout calendar, calendar rules (ACD-002, 003, 009) | Tested | `timetable.test.ts` |
| A-04 | Timetable conflict detection (teacher/batch/room overlap, closures, duration vs class length, workload cap; hard vs preference; never "optimal") + scheduling, cancel, reschedule (ACD-011..013) | Tested | `tests/unit/timetable.test.ts`, `timetable.test.ts` |
| A-05 | Capacity feasibility — reproduces legacy Class 12: 345 − 28 = 317 vs 305, headroom 12 (ACD-010, BR-ACD-7) | Tested | `tests/unit/capacity.test.ts`, `seed.test.ts`, `timetable.test.ts` |
| A-06 | Teaching log with coordinator verification and audited corrections (original preserved); attendance; teacher `own` scope (ACD-007, 014) | Tested | `teaching.test.ts` |
| A-07 | Assessments: configurable rules per assessment/section (correct, signed wrong, unattempted, cap), answer-key versions, CSV/JSON responses, validation, immutable finalisation, re-score into new version (audited), percentiles; exact integer-unit arithmetic (ACD-016..018) | Tested | `tests/unit/scoring.test.ts`, `assessments.test.ts` |
| A-08 | Assessment scheduling constraints (class/assessment clash, min gap, blackout incl. unverified exam date, prerequisites) — reproduces legacy late-weekend-test conflict (C12-CONFLICT-001/002) | Tested | `tests/unit/assessment-schedule.test.ts`, `assessments.test.ts` |
| A-09 | Students, manual enrolment, enrolment intake consumer of `ops.admission.enrolment_requested` v1 (`academic.enrolment-intake`) replying `academic.enrolment.confirmed`/`rejected` v1 in the same transaction; run route (no scheduler yet) (ACD-019) | Tested | `intake-summary.test.ts`, `students-progress.test.ts`, `tests/unit/intake-plans.test.ts` |
| A-10 | Progress: attendance summary, least-squares trend with insufficient-data rule, missed classes, catch-up tasks + prioritisation, interventions (ACD-020..022 partly) | Tested | `tests/unit/progress.test.ts`, `students-progress.test.ts` |
| A-11 | `GET /academic/api/internal/v1/summary` → `AcademicDeliverySummaryV1` (missing ≠ zero; hours in non-contract `extensions`) (ACD-027) | Tested | `intake-summary.test.ts` |
| A-12 | Seeds: IPMAT baseline 253 (locked), Class 12 override 305/381.25 h (counts locked, dates provisional) superseding 313, concept books (133), CA Accountancy and online Class 12 Accountancy (provisional), Class 12 batch calendar, 6 fictional students (ACD-008, 023) | Tested | `seed.test.ts` |
| A-13 | Screens (15 pages, AppShell, loading/empty/error/success, generic JSON form) | Implemented (typecheck + build only; no E2E) | `npm run build -w @elevate/academic-os` |
| A-14 | Permissions refined (`academic:curriculum:approve`, `classes:verify`, `assessments:finalise`, `progress:read|write`, `settings:manage`; teacher `own`; director/auditor read; no counsellor/marketing access) | Tested | route 401/403 cases in every integration file |
| — | Not built (Proposed): absence follow-up (ACD-015), automated risk flags (ACD-022 rules), homework (ACD-025), weekend-minutes cap (ACD-026), parent communication log (ACD-028), lesson-before-prerequisite / daily-slot / teacher-leave timetable checks, settings screen, intake scheduler | Proposed | `requirements/REQUIREMENTS.md` |

### Commands run (2026-10-18) and results
| Command | Result |
|---|---|
| `npm run typecheck -w @elevate/academic-os` | PASS |
| `npx eslint apps/academic-os packages/database/src/schema/academic.ts packages/authorization/src/permissions/academic.ts packages/shared-contracts/src/modules/academic.ts --max-warnings=0` | PASS |
| `npx vitest run apps/academic-os` | PASS — 15 files, 127 tests (7 unit files / 79 tests, 8 integration files / 48 tests) |
| `npm run build -w @elevate/academic-os` | PASS (15 pages, 51 `/api/v1` routes + the internal summary route) |
| `npx vitest run --project database --project shared-contracts --project authorization` (schema/contract/permission changes) | PASS |
| `npm run secret-scan` | PASS (624 files) |
| `npm test` (root, once) | 502 / 503 pass; the 1 failure is `apps/business-ops-os/tests/integration/dashboard.test.ts` (Business Ops team, in progress) — not an Academic file |

### Known limitations
- `docs/SECURITY_AND_PERMISSIONS.md` matrix not regenerated (Foundation file; IR-ACD-01). No migration generated (wave 3).
- Planned/delivered hours are outside the v1 summary contract (IR-ACD-03). No scheduler for the intake consumer (IR-ACD-02).

## Business Ops OS (wave 2) — 2026-10-18
_Owned by the Business Ops team._ Details: `apps/business-ops-os/README.md`, `requirements/REQUIREMENTS.md`, `docs/*`. Nothing is Deployed.

### Features
| # | Feature (requirements) | Status | Evidence (tests) |
|---|---|---|---|
| OPS-F1 | Leads, enquiries, sources, owner + handoff acceptance, contact attempts, history (OPS-001, 002, 004, 006) | Tested | `tests/integration/leads.test.ts` |
| OPS-F2 | Phone/email normalisation and duplicate-contact detection; explicit audited merge review, never automatic (OPS-003; A-01, A-02) | Tested | `tests/unit/contacts.test.ts`, `leads.test.ts` |
| OPS-F3 | Admission pipeline state machine + legal-transition table; demo skip as a *proposed* setting (OPS-005; A-03) | Tested | `tests/unit/pipeline.test.ts`, `admissions.test.ts` |
| OPS-F4 | Confirmation gate: two different fee verifiers + authorised approval (core approvals) + documents + down payment (OPS-010, 011; A-04) | Tested | `admission-followups.test.ts`, `admissions.test.ts` |
| OPS-F5 | Enrolment handoff: `ops.admission.enrolment_requested` v1 in the same transaction; consumer `ops.enrolment-replies`; double submit → one event; reply twice → one transition (OPS-012; A-15) | Tested | `admissions.test.ts` |
| OPS-F6 | Counselling, demos (terms/fee/limits as settings with decision states), schedule (OPS-008, 009) | Tested | `admissions.test.ts`, `sops-staff-policies.test.ts` |
| OPS-F7 | Follow-up due rules, IST overdue computation, daily reminders via `notify` (OPS-007; A-05, A-06) | Tested | `admission-followups.test.ts`, `dashboard.test.ts` |
| OPS-F8 | Tasks with owner/accountable/backup, dependency cycle detection, completion rules (OPS-016; A-07, A-08) | Tested | `tasks-escalation.test.ts`, `tasks.test.ts` |
| OPS-F9 | Escalation L2–L4 by configurable thresholds via reporting lines, audited (OPS-017; A-09) | Tested | `tasks-escalation.test.ts`, `tasks.test.ts` |
| OPS-F10 | Staff directory (steward of core departments/staff), role labels, reporting-line loop check, responsibilities + gap report, onboarding checklists (OPS-014, 015; A-10) | Tested | `organisation-planning.test.ts` |
| OPS-F11 | SOP register, versions, checklists, approval rules (owner ≠ approver, reviewer required), legacy import with coordinator SOP as draft (OPS-019; A-11, A-13) | Tested | `sops-staff-policies.test.ts`, `sops.test.ts`, `legacy.test.ts` |
| OPS-F12 | Decision log (24 legacy decisions), risks/issues/blockers, projects + milestones with dependencies, work inventory, incidents (OPS-021, 023, 025) | Tested | `organisation-planning.test.ts`, `legacy.test.ts` |
| OPS-F13 | Settings = policy register with decision states; edits stay proposed (OPS-022) | Tested | `sops-staff-policies.test.ts`, `organisation-planning.test.ts` |
| OPS-F14 | Management dashboard: 6 KPIs (denominator 0 → missing), workload (no ranking), Academic/Marketing panels with "source unavailable" (OPS-024; A-12, A-14) | Tested | `kpis.test.ts`, `dashboard.test.ts` (stubbed fetch) |
| OPS-F15 | Permissions refined (counsellor `own`, ops manager all, director read + approve, auditor read, teacher own tasks) | Tested | route 401/403 cases across integration tests |
| OPS-F16 | 17 screens with loading/empty/error/success states | Implemented (build + manual smoke) | `npm run build` PASS; `next start` probe: `/ops/leads` 307, `/ops/api/v1/leads` 401, `/ops/login` 200 |
| OPS-F17 | Seeds: 12 sources, 2 fictional staff, 24 decisions, 25 work items, 51 legacy SOPs (none approved), 12 responsibilities, 4 fictional leads, 3 tasks | Tested | `seeds.test.ts` (twice, idempotent) |
| OPS-F18 | CRM adapter interface + mock (`not_configured`) | Implemented | `server/adapters/crm.ts` |

Proposed / not built: OPS-013 onboarding task generation, OPS-018 routines, OPS-020 SOP training acknowledgements, OPS-026 CRM export import, OPS-027 outreach, OPS-028 exports/retention, OPS-029 intake form, KPIs other than the six, `/ops/api/internal/v1/summary`, intake of Marketing enquiries.

### Commands run (2026-10-18) and results
| Command | Result |
|---|---|
| `npm run typecheck -w @elevate/business-ops-os` | PASS |
| `npx eslint apps/business-ops-os packages/database/src/schema/ops.ts packages/authorization/src/permissions/ops.ts packages/shared-contracts/src/modules/ops.ts --max-warnings=0` | PASS |
| `npx vitest run apps/business-ops-os` | PASS — 16 files, 174 tests (124 unit, 50 integration) |
| `npx vitest run --project database` | PASS — 6 tests (ops schema builds in PGlite) |
| `npm run build -w @elevate/business-ops-os` | PASS (17 pages, 71 API handlers + health/auth) |
| `npm test` (root, once) | PASS — 58 files, 506 tests |
| `npm run typecheck` (root) / `npm run lint` (root) | PASS / PASS |
| `npm run secret-scan` | PASS (658 files) |
| `npx prettier --check` on Ops-owned files | PASS |
| `npm run docs:permissions -- --check` | Out of date (expected: Ops grants changed; Foundation-owned doc — IR-OPS-04) |
| `next start --port 3013` smoke (stopped afterwards) | `/ops/leads` 307, `/ops/admissions` 307, `/ops/api/v1/leads` 401, `/ops/login` 200 |

### Known limitations
- No scheduler for reminders, escalations and reply processing (IR-OPS-02); teachers lack the Ops module switcher entry (IR-OPS-01).
- Due dates and escalation thresholds use calendar days with Sunday closed, not service hours (OD-011) or a holiday calendar (OD-018).
- Director and auditor can read lead contact details (read-all grants); exports/retention (OPS-028) not built.
- No migration generated (wave 3); browser E2E not automated.

## Business Ops HR, admissions and operations pass (19 Oct 2026)
_Owned by the Business Ops team. Branch `feature/business-ops-hr-admissions`, commit ce7589c (D-028, D-029). Details: `apps/business-ops-os/README.md`, `requirements/REQUIREMENTS.md` (OPS-030 to OPS-079), `docs/*`. Nothing is Deployed. Status words per D-013: services and domain rules are **Tested** where a passing automated test is named; screens are **Implemented** (type-checked, not yet built or rendered; the wiring step builds them)._

### Features
| # | Feature (requirements) | Status | Evidence (tests in `apps/business-ops-os/tests/` unless noted) |
|---|---|---|---|
| OPS-F19 | Student directory and profile, reason-coded closure, consent and preferences (OPS-070, 071, 073, 074, 077) | Tested (API) / Implemented (screens) | `integration/admissions-students.test.ts`, `unit/admissions-students-kpis.test.ts` |
| OPS-F20 | Manual fee records in paise, summary, check by another person, void (OPS-072; A-17) | Tested | `unit/admissions-fees.test.ts`, `integration/admissions-fees.test.ts` |
| OPS-F21 | Handoff attempts, audited retry after a dead delivery, `existingStudentId` sent (OPS-075, 076; A-19) | Tested (Ops side); Academic side Proposed (IR-OPS-ADM-1, 2) | `integration/admissions-students.test.ts`; `apps/platform/tests/integration/enrolment-handoff.test.ts` (6 cases, 1 todo) |
| OPS-F22 | Admissions report, 11 KPIs (OPS-078; K-ADM) | Tested (API, domain) / Implemented (screen) | `integration/admissions-report.test.ts` |
| OPS-F23 | Employee records, directory, field tiers, org history, department heads (OPS-030 to 033, 037) | Tested (API) / Implemented (screens) | `integration/hr-records-employees.test.ts`, `unit/hr-records-domain.test.ts` |
| OPS-F24 | Private HR fields, document metadata with two-person deletion, storage adapter `not_configured` (OPS-034, 035) | Tested | `integration/hr-records-private-documents.test.ts` |
| OPS-F25 | Compensation records (draft, approval by another person, export) and assets (OPS-036, 038) | Tested | `integration/hr-records-compensation-assets.test.ts` |
| OPS-F26 | Requisitions, candidates, applications, interviews, offers, conversion, anonymisation (OPS-040 to 045, 049) | Tested (API) / Implemented (screens) | `integration/hr-lifecycle-recruitment.test.ts`, `unit/hr-lifecycle-domain.test.ts` |
| OPS-F27 | Onboarding and offboarding cases, separation event, login revocation (OPS-046 to 048) | Tested | `integration/hr-lifecycle-cases.test.ts`, `hr-lifecycle-employee-journey.test.ts`; `apps/platform/tests/integration/access-revocation.test.ts` |
| OPS-F28 | Staff attendance, breaks, manual and CSV entries, corrections, flags (OPS-050 to 055) | Tested (API, domain) / Implemented (screens) | `integration/hr-time-attendance.test.ts`, `unit/hr-time-domain.test.ts` |
| OPS-F29 | Shifts, holidays, leave, balances, availability, timesheets (OPS-056 to 059) | Tested (API, domain) / Implemented (screens) | `integration/hr-time-leave.test.ts`, `hr-time-jobs-seed.test.ts` |
| OPS-F30 | HR, lifecycle, time and operations KPIs (K-HR, K-HRL, K-HRT, K-OPS) | Tested (functions); HR dashboard screen not built | `integration/hr-records-metrics.test.ts`, `hr-lifecycle-metrics.test.ts`, `operations-registers.test.ts` |
| OPS-F31 | Task comments, references, supervisor review, reminders; SOP dates, archive, acknowledgements; policies register; risk mitigations; incident targets; approvals inbox; operations dashboard (OPS-060 to 069) | Tested (services) / Implemented (screens) | `integration/operations-*.test.ts`, `unit/operations-domain.test.ts` |
| OPS-F32 | Six HR permission profiles and about 60 new `ops:*` permissions, sensitive sets excluded from blanket reads (D-028) | Implemented; effects Tested | per-role 401/403 and field-level cases in the integration files above |

Proposed or not built: teams, bulk employee import, photo or ID-card generation, document file storage (no provider, D-014), retention enforcement (settings open), audit of read access to private fields, overtime records, leave accrual, carry-forward and encashment, shift change requests, a scheduler for any job, an attendance device or provider (mock only), HR approval sources in the inbox, an HR dashboard screen, routine task templates (OPS-018), merging the old onboarding checklist with HR cases, prototype screens for HR (`Elevate.html` has none). Every HR and attendance rule is a `proposed` or `open` setting until the owner decides (OD-029 to OD-048).

### Commands run and results
| Command | Result |
|---|---|
| `npm test` (repository root, at ce7589c) | PASS: Test Files 86 passed, Tests 896 passed, 1 todo |
| `npm run typecheck`, `npm run lint` | PASS |
| `npm run secret-scan` | PASS (912 files) |
| `next build`, browser check of the new screens | Not run by the slice agents (shared `.next`); the wiring step builds them |
| `db:generate`, `db:migrate`, `db:seed` against a database | Not run |

### Migrations
Baseline generated on 20 Oct 2026: `packages/database/migrations/0000_baseline.sql` (`drizzle-kit generate --name baseline`), 131 tables — core 12, marketing 20, academic 26, ops 73 (the `ops` schema spans five files, D-029). Review: foreign keys only within a schema or into `core` (academic→core 22, marketing→core 16, ops→core 158; no cross-module FK), no DROP/TRUNCATE. Applied to the local embedded PostgreSQL 18.4 only: `npm run db:migrate` twice (second run a no-op) and `npm run db:seed` twice (24 seeds; counts unchanged on the second run: ops.leads 6, ops.fee_records 3, ops.employee_records 10, ops.requisitions 1, ops.candidates 1, academic.students 6). Not applied to any non-local database. Later schema changes need a reviewed `0001_*` migration (`docs/DATABASE_MIGRATION_PLAN.md` §4).

### Generated documents to rerun
`docs/SECURITY_AND_PERMISSIONS.md` is generated: run `npm run docs:permissions` after the permission list is final (IR-OPS-04). It was not edited by hand. `apps/business-ops-os/docs/PERMISSIONS.md` was generated from the same source on 19 Oct 2026.

## Business Ops: HR and Operations removed (owner, 20 Oct 2026, D-032)
_The owner chose to delete the HR and Operations features. Last commit that contains them: `63da4e4` (branch `feature/business-ops-hr-admissions`); recover any file with `git checkout 63da4e4 -- <path>`. Rows **OPS-F8, F9, F11, F12, F23 to F31** above and the HR/operations parts of F10, F14, F15, F17 and F32 no longer exist. Nothing is Deployed._

| Area | Before (63da4e4) | After |
|---|---|---|
| `ops` tables | 73 | 17 (56 dropped by `packages/database/migrations/0002_remove_hr_operations.sql`) |
| Ops permission keys | 61 | 18 |
| Roles | 15 | 10 (`hr_manager`, `hr_contributor`, `recruiter`, `department_manager`, `employee` removed; `finance_officer` kept for fee records) |
| Ops API route files | 170 | 46 kept (new admissions routes from the parallel build not counted) |
| Ops pages (`page.tsx`) | 55 | 15 kept |
| Ops seeds | 13 | 5 |
| Events | `ops.employee.separated` v1 + platform `access-revocation` consumer/job | removed (`opsEvents = []`) |

Kept: leads, counselling, demos, admissions, students, fee records, follow-ups, enrolment handoff, schedule, settings (13 HR/task/incident keys removed), approvals inbox (fee arrangements only, new `approvals-inbox.test.ts`), staff directory and departments (`core` steward), `ops.staff_profiles`, dashboard (task and blocker KPIs removed), admissions report. Platform overview lost the Staff present tile, the Attendance corrections row and Team priorities; no "My work" link points at `/ops/tasks` any more. `src/ui/hr-records.tsx` became `src/ui/list-controls.tsx`.

### Commands run and results
| Command | Result |
|---|---|
| `npm run validate` before the removal (baseline) | PASS: Test Files 99 passed, Tests 1109 passed, 1 todo; secret-scan OK (984 files) |
| `npm run validate` after the removal (another agent's parallel admissions work was already in the tree) | typecheck PASS, lint PASS (after `npx next typegen` in business-ops-os and platform; the stale `.next/types` from deleted routes failed the first run); tests: Test Files 71 passed, 1 failed (72); Tests 661 passed, 1 failed, 1 todo. The one failure is `packages/database/tests/create-test-db.test.ts` "creates every core table": it finds a new `core.students` table added by the parallel admissions work, not by this removal. Secret scan did not run because the tests failed. |
| `npm run docs:permissions` | matrix written to `docs/SECURITY_AND_PERMISSIONS.md` (0 HR/task keys) |
| `npm run build -w @elevate/business-ops-os` / `-w @elevate/platform` | PASS / PASS |
| `npm run db:migrate` and `npm run db:seed` (local embedded PostgreSQL only, after copying `.data/postgres` to `.data/backup-before-hr-ops-removal-20261020`) | 3 migration files applied; `ops` schema has 17 tables; 0 rows left for the removed roles or the removed event; 17 seeds applied |

## Google sign-in (D-030) — 20 Oct 2026

### Features
| # | Feature | Status | Evidence |
|---|---|---|---|
| G-01 | "Sign in with Google": OIDC authorization code + PKCE, signed 10-min state cookie, ID token verified locally (RS256 + JWKS, `iss`, `aud`, `exp`/`iat` ±5 min, `nonce`, `email_verified`, `hd`, production domain rule), first sign-in creates a user with no roles, disabled users refused, per-IP throttle, session + `auth.login` audit shared with the password login (`openSession`) | Tested (offline) | `packages/authentication/tests/google.test.ts` (32 tests: valid sign-in, account reuse, wrong/missing hd, unverified email, outside / fictional / look-alike domain, wrong aud/iss, expired, future iat, nonce mismatch, bad signature, unknown kid + JWKS refetch, malformed token, alg none, state mismatch, missing/tampered/expired state cookie, cancelled, disabled user, throttle, open redirects `//evil.com`, `https://evil.com`, `/\evil.com`) |
| G-02 | Optional configuration `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (server-only, subset `googleSignIn`); routes answer 404 and the button is hidden when unset | Tested | `google.test.ts` ("answers 404 … button link is absent"); `apps/platform/tests/integration/google-routes.test.ts` |
| G-03 | Platform routes `GET /api/v1/auth/google/start` and `/callback` | Tested + manual | Smoke run below |
| G-04 | Login pages (platform + three zones): "Use your @elevateeducation.in account.", "Sign in with Google" link-button (to `PLATFORM_URL/api/v1/auth/google/start?next=<zone path>`) only when configured, messages for the `google_*` error codes | Tested | `packages/shared-ui/tests/shared-ui.test.tsx`; smoke run below |
| G-05 | Owner setup guide | Implemented | `docs/GOOGLE_SIGN_IN_SETUP.md` (labels marked *(not verified)* could not be checked against the live console) |
| G-06 | Real Google round trip with the owner's client | **Not verified** | Needs the owner's client ID and secret (setup guide) |

### Commands run and results
- `npx tsc --noEmit -p <tsconfig>` for packages/authentication, packages/configuration, packages/shared-ui, apps/platform, apps/marketing-os, apps/academic-os, apps/business-ops-os → exit 0 each.
- `npx eslint <changed files> --max-warnings=0` → exit 0.
- `npx vitest run packages/authentication packages/configuration packages/shared-ui apps/platform` → `Test Files 15 passed (15)`, `Tests 146 passed | 1 todo (147)`.
- `npm run secret-scan` → `secret-scan — OK (973 files checked, no secrets or .env files found).`
- `npx vitest run apps/marketing-os apps/academic-os apps/business-ops-os` (login pages changed) → `Test Files 14 failed | 56 passed (70)`, `Tests 766 passed | 84 skipped`; all 14 were business-ops-os files that failed to start while other agents were running tests at the same time (suite-level, not assertions). Rerun: `leads.test.ts` alone → 10 passed; the other 13 with `--maxWorkers=2` → `Test Files 13 passed (13)`, `Tests 74 passed (74)`.
- `npm run build -w @elevate/platform` → success; `/api/v1/auth/google/start` and `/callback` listed as dynamic routes.
- Mutation probe: with the `hd` check removed, 3 tests fail (wrong hd, missing hd, throttle); check restored.
- Live discovery check (public GETs, no credentials): Google's discovery document parsed (`https://accounts.google.com/o/oauth2/v2/auth`), the real JWKS (2 RSA keys) parsed into keys, and a token we signed ourselves under a real Google key ID was refused with `bad signature`.
- Smoke (`next start --port 3100` with `PLATFORM_URL=http://localhost:3100` and dummy `test-only-` Google values, stopped afterwards): `/login` shows the domain line and the Google link; `/api/v1/auth/google/start?next=//evil.com` → 303 to `accounts.google.com/o/oauth2/v2/auth` with all parameters, `Set-Cookie: elevate_google_signin=…; Path=/api/v1/auth/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`; `/callback?code=x&state=y` without the cookie → 303 `/login?error=google_expired&next=%2F`; `/callback?error=access_denied` → 303 `/login?error=google_cancelled&next=%2F`.

### Known limitations
- A first-time Google user sees "No access" until an administrator gives roles on Users & roles (below).
- The per-IP throttle is in memory per process (same limitation as the password login).
- The "G" logo is not shown (text-only button): Google's official mark could not be verified for inline use, and Google requires it on a white background, which the dark theme does not give.

## Users & roles and first-owner bootstrap (D-030) — 20 Oct 2026

| # | Feature | Status | Evidence |
|---|---|---|---|
| U-01 | `BOOTSTRAP_OWNER_EMAILS` (optional; exact @elevateeducation.in only): listed email gets `platform_admin` + `director` at password or Google sign-in, audited `role.bootstrapped` once | Tested | `packages/authentication/tests/bootstrap.test.ts` (listed once, unlisted nothing, invalid list → sign-in 500 and no session, rule = `isAllowedEmail(…, 'production')`); `google.test.ts` (Google path); `packages/configuration/tests/env.test.ts` |
| U-02 | `/admin/users` list (search, role / status / "No roles yet" filters, sort, 25 per page, "via Google") and `/admin/users/[id]` (roles checklist, Save roles, Disable / Enable account with confirmation, history); sidebar "Users & roles" + Settings link for `platform:users:read` | Tested | `apps/platform/tests/integration/admin-users-pages.test.ts` (signed-out redirect, teacher "No access" and no links, director allowed); manual `next start` check below |
| U-03 | API `GET/POST /api/v1/admin/users`, `GET /api/v1/admin/users/[id]`, `PUT …/[id]/roles`, `PUT …/[id]/status`; no self-change (403), last active admin kept (409), unknown role 400, outside domain 403, duplicate 409, disabling revokes sessions, every change audited | Tested | `apps/platform/tests/integration/admin-users.test.ts` (26 tests: 401/403 per route, director/auditor read-only, add person, role save, disable/enable, last admin, list filters, detail) |

Commands (20 Oct 2026): `npx tsc --noEmit -p` apps/platform, packages/authentication, packages/configuration → exit 0 each; `npx eslint <changed files> --max-warnings=0` → exit 0; `npx vitest run packages/authentication packages/configuration apps/platform` → `Test Files 17 passed (17)`, `Tests 160 passed | 1 todo (161)`; `npm run build -w @elevate/platform` → success, the two pages and four API routes listed. Manual: `next start --port 3010` on a scratch PGlite with fictional @elevateeducation.in users (stopped afterwards): signed-out `/admin/users` → 307 `/login?next=%2Fadmin%2Fusers`; admin → 200 with "No roles yet" and "via Google"; teacher → "No access"; detail shows Save roles and Disable account, own account shows the "your own account" note and neither; `PUT …/roles` → 200; `PUT` own status → 403. Not verified: a browser walk-through with screenshots, axe and keyboard-only use.

## Business Ops: admissions workspace (owner brief, 20–21 Oct 2026)
_Built in four slices on branch `feature/business-ops-hr-admissions`; merged docs on 21 Oct 2026. Requirements OPS-080 … OPS-121 (`apps/business-ops-os/requirements/REQUIREMENTS.md`), rules A-57 … A-84 (`docs/ALGORITHMS.md`). Decisions D-032 … D-035. Status per D-013; **nothing is Deployed**. Screens are Implemented only: none has been opened in a browser._

| # | Feature | Status | Evidence |
|---|---|---|---|
| ADM-01 | Demo students with N sessions (default 3, `proposed` setting), per-session attendance, x/N progress, correction history, reschedule/cancel, outcome, checklist (OPS-080 … 086) | Tested | `tests/unit/demos.test.ts`, `tests/integration/demos.test.ts` |
| ADM-02 | Demo landing `/ops/admissions` with KPI tiles, tabs, drawer, booking drawer; demo record page (OPS-083, 087) | Implemented | typecheck + lint only |
| ADM-03 | Demo fixtures incl. "Tanisha Demo Student", SAMPLE DATA (OPS-088; one sample set since D-036) | Tested | `demos.test.ts` → "creates Tanisha…" |
| ADM-04 | Convert to admission in one transaction; canonical student `core.students`; review instead of merge; programme combinations; admission numbers from a locked counter; manual override with reason (OPS-089 … 093) | Tested | `tests/integration/conversion.test.ts`, `tests/unit/admission-numbers.test.ts`, `tests/unit/student-lifecycle.test.ts` |
| ADM-05 | Student lifecycle (hold, resume, exit records, reactivation by a second person), Active / Past lists, search with masked, audited contact lookup, guardians, student report with export audit (OPS-094 … 099) | Tested (API); screens Implemented | `tests/integration/students-profile.test.ts` |
| ADM-06 | Conversion fixtures (OPS-100) | Tested | `seeds.test.ts` (numbers 001, 002); `seed/samples.ts` (D-036) |
| ADM-07 | Appointments (6 types), double-booking refusal, change history, in-app teacher notification, email/SMS "simulated — not sent" (OPS-101 … 104) | Tested (API); screens and demo-class clash Implemented | `tests/integration/appointments.test.ts`, `tests/unit/appointments-feedback.test.ts` |
| ADM-08 | Teachers directory/profile, 7 owner-supplied teachers without contact data, two feedback directions (OPS-105 … 108) | Tested (API, seed); screens Implemented | `appointments.test.ts` → "teacher seed…", `tests/integration/feedback.test.ts` |
| ADM-09 | Fee plans, instalments, ledger kinds, instalment and list fee status, reconciliation gate (OPS-109 … 113) | Tested | `tests/unit/fee-plans.test.ts`, `tests/integration/fee-plans.test.ts` |
| ADM-10 | Fee section on the student profile (OPS-114) | Implemented | server permissions tested in `fee-plans.test.ts` |
| ADM-11 | Marketing lead handoff consumer with receipts, attribution, duplicate review, retry (OPS-115) | Tested with mock events | `tests/integration/lead-intake.test.ts` |
| ADM-12 | Live Marketing sync (OPS-116) | Proposed (IR-MKT-OPS-HANDOFF) | — |
| ADM-13 | "From Marketing" leads view (OPS-117) | Implemented | — |
| ADM-14 | Funnel, demo conversion, student summary reports (OPS-118) | Tested (API, rules); screen Implemented | `tests/unit/admissions-funnel.test.ts`, `tests/integration/admissions-report-funnel.test.ts` |
| ADM-15 | Fee and handoff fixtures (OPS-119) | Tested | `tests/integration/seeds.test.ts` (D-036) |
| ADM-16 | Separate "Applications / Admission Decisions" and "Enrolment Handoffs" screens (OPS-120); Academic data on student lists (OPS-121) | Applications list Implemented 21 Oct (LC-02); handoffs screen and OPS-121 Proposed | — |

### Migrations
`packages/database/migrations/0003_admissions_workspace.sql` (generated by the coordinator, with a hand-written backfill for appointments and legacy demos; see `apps/business-ops-os/docs/DATA_MODEL.md`): creates `core.students` and 16 `ops` tables (33 `ops` tables in total) and widens the admissions, appointments, demos and fee-record columns and CHECKs. Applied to: [TODO coordinator: say where it was applied, e.g. local embedded PostgreSQL only].

### Commands run and results
Verification commands: pending coordinator run.
| Command | Result |
|---|---|
| `npm run validate` (typecheck, lint, tests, secret scan) | [TODO coordinator: validate numbers — Test Files …, Tests …, secret-scan …] |
| `npm run build -w @elevate/business-ops-os` | [TODO coordinator: validate numbers] |
| `npm run docs:permissions` | [TODO coordinator: validate numbers] (35 `ops:*` keys; IR-OPS-13) |
| `npm run db:migrate` (local only) | [TODO coordinator: validate numbers] |
| `node build.mjs` in `C:\OPENBOT\Elevate-Not-Working` | see the register totals line in the docs-merge report |

Slice runs reported by the build agents on 20 Oct 2026 (before the merge, not a whole-suite result): demos 2 files / 61 tests passed; counselling, teachers and feedback 3 files / 47 tests passed.

### Known limitations
- No screen has been checked in a browser (drawer focus and Escape, phone sheet, keyboard path, contrast).
- Academic does not serve the per-student contract (IR-OPS-STU-1), so results and attendance show "Source unavailable"; Active stays empty until Academic confirms enrolments. _(21 Oct: IR-OPS-STU-1 done, LC-07.)_
- Marketing does not publish `marketing.lead.handed_off`; no scheduler runs the jobs; no system actor for intake rows.
- Admission number format, checklist enforcement, appointment buffer, allocation order and rating scale are `proposed` settings awaiting the owner.
- Suspected defect found while merging the docs: closing a draft fee plan conflicts with the CHECK `fee_plans_approved_check` (`docs/WORKFLOWS.md`, fee plan). Not tested. _(21 Oct: fixed — the check now applies to active agreements only.)_
- The prototype (`C:\OPENBOT\Elevate`) does not show any of this yet (IR-OPS-14).

## Business Ops: clean sample data and clearer names (owner request, 21 Oct 2026, D-036)
_Owned by the Business Ops team (data). Nothing is Deployed. Requirement OPS-122._

| # | Feature | Status | Evidence |
|---|---|---|---|
| DATA-01 | One sample set (`seed/samples.ts`): 9 demo cases mapped 1:1 to the brief + 1 mock Marketing handoff; `is_sample` on leads, students, staff profiles; "Sample …" names; per-subject sample teachers; real teachers never on sample events | Tested | `tests/integration/seeds.test.ts` (case 1), `demos.test.ts` "creates Tanisha…" |
| DATA-02 | `npm run db:clear-samples` (local only, one transaction, FK-safe order, counts printed, admission-number counter reset when no numbered admission is left) | Tested | `seeds.test.ts` (case 2); local run below |
| DATA-03 | Migration `0005_clear_names` (renames, legacy demo columns and `demo_teachers` dropped, demo fee in paise, sample flags with backfill) | Implemented, applied locally | migrated schema = schema-built schema (PGlite comparison: 1151 columns, 568 constraints, 687 NOT NULL names identical); `npm run db:generate` → "No schema changes" |
| DATA-04 | `docs/DATA_DICTIONARY.md` generated from the schema and its comments (`npm run docs:data-dictionary`, `-- --check`) | Implemented | 37 tables (5 core + 32 ops) |
| DATA-05 | SAMPLE DATA badge on the leads list and lead page (demos, students already had it) | Implemented | typecheck + lint |

### Commands run and results (21 Oct 2026)
| Command | Result |
|---|---|
| Logical backup before 0005 (node + `pg`, `row_to_json` per table; `pg_dump` is not installed, D-024) | `.data/backup-before-0005-20261021-013733/` — 93 tables, 2399 rows, `MANIFEST.json` |
| `npm run db:migrate` | `6 migration file(s) … applied or already up to date (node-postgres)` |
| `npm run db:clear-samples -- --yes` (second run, after the new seed) | 259 sample rows deleted across 25 tables (first run removed the 366 old fixture rows) |
| `npm run db:seed` | 17 seeds; `ops.samples: 10 sample students (9 demo cases + 1 Marketing handoff)` |
| Local counts (node `pg` query) | leads 10 sample of 12 (2 unflagged leads typed by hand earlier, left for the owner); `core.students` 2 (both sample); admissions 14; admission numbers 001, 002; demos: open 4, converted 2, declined 1, not_converted 1, withdrawn 1; demo sessions 27; appointments: 9 completed counselling, 1 scheduled PTM, 1 cancelled teacher meeting; fee plan 1 active, ledger received + discount; 1 accepted handoff; real teachers on sample events 0 |
| `npm run validate` | exit 0 — typecheck + lint (0 warnings) + `Test Files 86 passed (86)`, `Tests 896 passed | 1 todo (897)` + `secret-scan — OK (824 files checked …)`. Baseline before this change: 87 files / 893 tests; `admissions-seed.test.ts` and `fee-plans-seed.test.ts` were folded into `seeds.test.ts` (other agents' parallel changes account for the rest of the difference). First run had 1 flaky failure (a random staff UUID with 10 digits matched the "no phone" regex in `appointments.test.ts`); the assertion now ignores the id. |
| `npm run build -w @elevate/business-ops-os` | `✓ Compiled successfully`, all routes listed, exit 0 |

### Known limitations
- Two hand-typed leads in the local database are not flagged sample (`LEAD-000007` "Overview Check Enquiry (fictional)", `LEAD-000008` "chdrt"); `db:clear-samples` keeps them. The owner decides whether to delete them.
- Academic and Marketing seeds still use "(fictional)" names (outside this change).
- The sample login accounts stay after `db:clear-samples` (other modules reference them; production refuses `@example.test`).

## Business Ops: admissions lifecycle, fees, students, tasks and screen redesign (owner brief, 21 Oct 2026)
_Built in parallel slices, each reviewed and fixed, then one whole-tree quality pass. Decisions D-038 … D-057. Migrations `0007_admissions_lifecycle` and `0008_staff_tasks` (both applied to the local database by the owner; 0008 sha256 `4e676815…b7e0`, frozen). Status per D-013; **nothing is Deployed**. Screens were looked at in Chrome by the coordinator at 1440 px and 390 px (no console errors, no sideways scroll); axe and Lighthouse were not run._

| # | Feature | Status | Evidence (test files) |
|---|---|---|---|
| LC-01 | Demo = 3 demo days, each with one or more classes; late / excused marks; substitute flag; no-show outcome; student identity created at booking (D-038, D-050) | Tested | `apps/business-ops-os/tests/unit/demos.test.ts`, `tests/integration/demos.test.ts`, `tests/unit/pipeline.test.ts` |
| LC-02 | Applications: versioned snapshot + SHA-256, status draft → ready → form → signatures → confirmed (or withdrawn); material change → new version, signatures invalidated; applications list screen (OPS-120) | Tested (API); screen Implemented | `tests/unit/applications.test.ts`, `tests/integration/applications.test.ts`, `tests/integration/conversion.test.ts` |
| LC-03 | Admission form PDF (owner's paper form, sections 01–10 + terms, D-046), acknowledgement PDF, ID card (CR80); pdf-lib + Noto Sans (D-042) | Tested | `tests/unit/pdf-toolkit.test.ts`, `tests/unit/admission-documents.test.ts`, `tests/unit/admission-form.test.ts` |
| LC-04 | Final confirmation with the approver's password (D-041), number given in the same transaction (D-040), replay-safe (D-053), Academic handoff; legacy admissions "verification required" + audited reconciliation | Tested | `tests/integration/applications.test.ts`, `packages/authentication/tests/reauth.test.ts`, `packages/database/tests/constraints/ops-admissions.test.ts` |
| LC-05 | KYC: guardians (one primary), masked identity documents with verify / reject, sibling links; onboarding templates, checklist, materials | Tested | `tests/unit/onboarding.test.ts`, `tests/integration/student-kyc-onboarding.test.ts` |
| LC-06 | Fee agreements: 50/25/25 split (D-039), registration ₹5,000 once per student (D-044), demo fee ₹1,000 (D-045), refunds and reversals as linked rows, versioned agreements, approval bound to one version (D-057) | Tested | `tests/unit/fee-agreements.test.ts`, `tests/unit/fee-plans.test.ts`, `tests/unit/admissions-fees.test.ts`, `tests/integration/fee-plans.test.ts`, `tests/integration/admissions-fees.test.ts`, `tests/integration/approvals-inbox.test.ts` |
| LC-07 | Student reports (draft → reviewed → final, snapshot, PDF) using the new Academic per-student summary (IR-OPS-STU-1 done) | Tested | `tests/unit/academic-evidence.test.ts`, `tests/unit/progress-report-pdf.test.ts`, `tests/integration/academic-reports.test.ts`, `apps/academic-os/tests/integration/student-summary.test.ts` |
| LC-08 | Events and webinars (participants, registration, attendance; messages simulated — no provider) | Tested (API); screen Implemented | `tests/unit/events.test.ts`, `tests/integration/events.test.ts` |
| LC-09 | Exit records (reason, materials, closing notes, balance) and readmission; reactivation kept | Tested | `tests/integration/student-exit-readmission.test.ts`, `tests/unit/student-lifecycle.test.ts` |
| LC-10 | Global search `/ops/search` (names, references; contacts only with private-data permission, audited) | Tested | `tests/unit/search.test.ts`, `tests/integration/search.test.ts`, `tests/unit/student-contact-search.test.ts` |
| LC-11 | Daily tasks and EOD reports (`/ops/tasks`: My day, All, EOD, Team EOD; D-052) | Tested (API); screens Implemented | `tests/unit/staff-tasks.test.ts`, `tests/integration/staff-tasks.test.ts` |
| LC-12 | Overview KPIs, admissions settings group, onboarding templates screen | Tested (API); screens Implemented | `tests/unit/admissions-kpis-overview.test.ts`, `tests/integration/admissions-overview.test.ts`, `tests/integration/student-kyc-onboarding.test.ts` (templates route) |
| LC-13 | Money forms: one click only (button disabled before the request), automatic Idempotency-Key, error summary | Tested | `tests/unit/ui-kit.test.tsx` |
| LC-14 | Draft syllabus courses (5) + IPMAT chapter weights; CA Foundation active (D-051) | Tested | `apps/academic-os/tests/integration/seed.test.ts` |
| LC-15 | Screen redesign: dark theme kept, grouped sidebar, header band, figure strips, cards below 720 px, theme in `packages/shared-ui` (D-054) | Implemented (browser-checked by the coordinator) | `packages/shared-ui` tests; screenshots in the session scratchpad |
| LC-16 | Database constraints for the new tables (98 cases) | Tested | `packages/database/tests/constraints/*.test.ts` |

### Commands to re-run (exact)
| Command | What it checks |
|---|---|
| `npm run validate` | typecheck, lint (0 warnings), every test, secret scan |
| `npx vitest run apps/business-ops-os` | Business Ops unit + integration |
| `npx vitest run packages/database packages/authentication` | constraints, migrations ≡ schema, password re-check |
| `npx vitest run apps/academic-os apps/platform` | Academic summary route and seeds; platform sample enrolments |
| `npm run build` | all four apps build |
| `npm run docs:permissions -- --check` and `npm run docs:data-dictionary -- --check` | generated docs match the code |
| `cd packages/database && npx drizzle-kit generate --name check` | "No schema changes" (delete any file it writes) |
| `node build.mjs` in `C:\OPENBOT\Elevate-Not-Working` | register rebuilt |

### Results
Final totals (21 Oct 2026, run by the coordinator after the last change): `npm run validate` → exit 0 — typecheck all workspaces, lint 0 warnings, **124 test files, 1,642 tests passed (1 todo)**, secret scan OK (1,005 files). `npm run build` → exit 0 for platform, marketing-os, academic-os and business-ops-os. Browser walk-through on the local dev servers: 0 application console errors; full admission confirmation not walked end to end on sample data (needs a second person and a phone number by design). Status: **Implemented and Tested — not Deployed**.

### Known limitations
- Accounts that sign in only with Google cannot confirm admissions (D-041; owner decision on Google re-authentication).
- Characters outside the PDF font (for example Devanagari) print as "?" with a footer note.
- Event messages and EOD "share" are simulated; no messaging provider.
- Weekly / monthly EOD range report and calendar view not built.
- Academic does not yet receive `ops.enrolment.closed` (IR-OPS-EXIT-1) or serve batch end dates (IR-OPS-EXIT-2).
- The prototype (`C:\OPENBOT\Elevate`) does not show applications, fee agreements, tasks or the new layout.

## Academic OS teacher workspace and Business Ops task tracker, teacher operations and EOD (owner briefs 1 and 2, 21 Oct 2026)
_Built in parallel slices (Academic A1–A4, Ops O1–O4, two schema foundations), each reviewed and fixed. Owner decisions D-058 … D-061; technical rulings D-062 … D-071. Migrations `0009_academic_teacher_workspace_tasks` and `0010_link_academic_students_to_core` (data only: links Academic students to their core student where Ops records exactly one pair) are **applied on the owner's local database** (21–22 Oct; both frozen) (coordinator proofs: `packages/database` tests incl. `migration-0009.test.ts` — 0008-shaped rows keep their ids and get the backfills; `drizzle-kit generate --name check` → "No schema changes") (the owner runs `! npm run db:migrate`; it backfills placements, assignment status, result states, task sources and EOD version 1, see D-064 and `HANDOFF.md`). Status per D-013; **nothing is Deployed**. Paths below are relative to the app unless they start with `packages/`._

### Academic OS (`apps/academic-os`)
| # | Feature | Status | Evidence (test files) |
|---|---|---|---|
| TW-01 | Enrolment intake matches existing student (existingStudentId → coreStudentId → source admission), duplicate checks, clash keeps "Awaiting batch" with a note; Business Ops sends `coreStudentId` and `academicYear` (IR-OPS-STU-2 done) | Tested | `tests/integration/placements.test.ts`, `tests/unit/intake-plans.test.ts`, `apps/platform/tests/integration/enrolment-handoff.test.ts` |
| TW-02 | Batch placements: allocate (capacity under row lock), transfer (old ends the day before, catch-up chapters proposed), end (no future dates); Enrolments page and batch tabs (D-064) | Tested (API); screens Implemented | `tests/integration/placements.test.ts`, `tests/unit/placements.test.ts` |
| TW-03 | Teacher assignments current by dates; end or change a planned end, overlap refused (D-065) | Tested | `tests/integration/placements.test.ts` |
| TW-04 | Class roster from placements on the date + students already marked + demo attendees (DEMO badge); attendance never defaults to present, changes need a reason, "Mark all remaining present" separate | Tested (API); class page Implemented | `tests/integration/attendance-roster.test.ts` |
| TW-05 | Mark delivered / reopen (coordinator, reason) / substitute (original kept, reason + authoriser); teacher unavailability ("Academic availability record — not HR leave") and uncovered classes (D-063) | Tested | `tests/integration/delivery.test.ts`, `tests/integration/delivery-summary.test.ts` |
| TW-06 | Timetable patterns draft → preview → publish (idempotent), series edit from tomorrow, conflicts (teacher, room, batch, student in two batches, unavailable), one advisory lock (D-070); agenda / week / print views | Tested (API); screens Implemented | `tests/integration/patterns.test.ts`, `tests/unit/timetable-workspace.test.ts` |
| TW-07 | Role home: teacher My day, coordinator overview (coverage table, open support cases); teachers directory and profile | Tested (API); screens Implemented | `tests/integration/teachers-myday.test.ts` |
| TW-08 | Teaching log draft → submitted → request correction / correct / verify; submit needs a delivered class; substitute logs as the actual teacher; exceptions list | Tested (API); screens Implemented | `tests/integration/teaching-log.test.ts`, `tests/integration/teaching.test.ts` |
| TW-09 | Coverage counts first teaching (`main`) once per chapter from submitted/verified logs (D-062) | Tested | `tests/unit/coverage.test.ts`, `tests/integration/delivery-summary.test.ts` |
| TW-10 | Teacher reviews: drafts private, versions append-only, revise / withdraw, scope by placement or demo class taught, internal read route for Ops (D-058) | Tested (API); screens Implemented | `tests/integration/reviews.test.ts`, `packages/shared-contracts/tests/academic-workspace.test.ts` |
| TW-11 | Marks entry (scored / absent / exempt / withheld / pending, manual totals), manual-only finalise, publication separate, only published results reach Ops; rank/percentile hidden unless the setting is approved | Tested (API); marks screen Implemented | `tests/integration/marks-publication.test.ts`, `tests/unit/results-analysis.test.ts`, `tests/integration/assessments.test.ts` |
| TW-12 | Assessment analysis (scored only, n of m), trends (same kind, subject and maximum), eligibility by placement on the assessment date | Tested | `tests/unit/results-analysis.test.ts`, `tests/integration/marks-publication.test.ts` |
| TW-13 | Progress in four separate dimensions; attendance within placements per the denominator setting; no batch history before 21 Oct 2026 shown as "Not recorded"; support plans on interventions | Tested (API); screens Implemented | `tests/integration/progress-reports.test.ts`, `tests/unit/progress.test.ts`, `tests/integration/student-summary.test.ts` |
| TW-14 | Reports (batch attendance, coverage, assessment analysis, teacher week) as print views + CSV (audited, shared CSV helper D-071) | Tested (API); print views Implemented | `tests/integration/progress-reports.test.ts`, `packages/server-kit/tests/csv.test.ts` |
| TW-15 | Settings page; approving a setting needs a D-0xx / OD-0xx reference; six new settings (attendance denominator, rank/percentile, log deadline, demo attendees and capacity, review cadence, substitute authoriser), all Proposed | Implemented | `apps/academic-os/src/domain/settings.ts` (no screen test) |
| TW-16 | Sample teaching data (3 sample batches, 6 sample students, 8 classes incl. substituted, cancelled + make-up, log pending; reviews; a demo attendee) | Tested | `tests/integration/sample-teaching-seed.test.ts`, `tests/integration/sample-demo-attendee.test.ts`, `tests/integration/seed.test.ts` |
| TW-17 | Schema, permissions and contracts (new tables, `academic:reviews:*`, `academic:assessments:mark/publish`, `academic:timetable:publish`) | Tested | `packages/database/tests/constraints/academic-workspace.test.ts`, `packages/authorization/tests/academic-workspace.test.ts`, `packages/shared-contracts/tests/academic-workspace.test.ts` |

### Business Ops (`apps/business-ops-os`)
| # | Feature | Status | Evidence (test files) |
|---|---|---|---|
| TT-01 | Task lifecycle: acknowledge, request clarification, start, submit for review, approve, request changes, block, hold, resume, cancel, reopen, reassign; an event for every change; strict PATCH with `expectedVersion` | Tested (API); screens Implemented | `tests/unit/task-lifecycle.test.ts`, `tests/integration/task-lifecycle.test.ts`, `tests/integration/staff-tasks.test.ts` |
| TT-02 | Review-step, cancel and reassign authority (`mayReassign`); self-logged fixed at creation, inherited by recurrences; reassign to the reviewer refused (D-069) | Tested | `tests/unit/task-lifecycle.test.ts` ("R18 self-logged is fixed at creation"), `tests/integration/task-lifecycle.test.ts` |
| TT-03 | Work updates (IST work date vs entry time, overlaps flagged, one correction with reason), dependencies with cycle check | Tested | `tests/unit/task-lifecycle.test.ts`, `tests/integration/task-lifecycle.test.ts` |
| TT-04 | One visibility rule (owner, managed staff via the manager chain, reviewer, backup, assigner; a requester alone sees nothing) | Tested | `tests/integration/task-lifecycle.test.ts` |
| TT-05 | End-to-end task report page + PDF + CSV (audited); period report with definitions + PDF / CSV | Tested (API); pages Implemented | `tests/integration/task-reports.test.ts`, `tests/integration/task-lifecycle.test.ts` |
| TT-06 | EOD facts from the day's events and updates only (A-TSK-5), immutable versions, revisions, recipient = active manager or a chosen `ops:eod:review` holder, inbox (viewed / comment / clarification / revision / acknowledge / follow-up task) | Tested (API); inbox Implemented | `tests/unit/eod.test.ts`, `tests/integration/eod-reports.test.ts` |
| TT-07 | Simulated "share" removed: "Copy summary", PDF, "External delivery not configured" | Tested | `tests/integration/eod-reports.test.ts` |
| TT-08 | Tracker import from the owner's JSON backup: preview → commit, re-import detects duplicates, changed rows keep the Elevate value, no notifications; imported events dated at commit (D-068) | Tested (API); imports page Implemented | `tests/unit/task-import.test.ts`, `tests/integration/task-import.test.ts` |
| TT-09 | Teacher reviews read from Academic (after `ops:feedback:read`, own = authored or counselled students), acknowledgements, older Ops rows read-only; write routes deleted; family-audience reports use shareable reviews only; withdrawn source blocks non-final reports, final ones show a notice (D-058, D-067) | Tested | `tests/integration/academic-reviews.test.ts`, `tests/integration/feedback.test.ts`, `tests/unit/demo-review-match.test.ts` |
| TT-10 | Demo Day 1/2/3 read Academic's marks (asked only for classes already started and in the list's date window, batches of 200, outside any database transaction); known-linked classes wait while Academic is down (D-060, D-066); internal route `demo-sessions` | Tested | `tests/integration/academic-reviews.test.ts`, `tests/integration/demos.test.ts`, `tests/unit/demo-review-match.test.ts` |
| TT-11 | Teacher directory and profile (HR attendance unavailable, Academic activity, tasks, EOD, reviews authored; no appraisal) | Tested (API); screens Implemented | `tests/integration/academic-reviews.test.ts` ("teacher operations") |
| TT-12 | Sample staff (12 teachers `DEMO-T01`…`DEMO-T12` + Sample Academic Manager) and sample work (12 tasks, events, updates incl. midnight and late entry, 4 EODs); clear-samples extended (D-061) | Tested | `tests/integration/seeds.test.ts` |
| TT-13 | Schema and permissions (`ops:tasks:import`; `ops:feedback:acknowledge` and counsellor `ops:feedback:read` Proposed; `ops:feedback:write/manage` held by no role) | Tested | `packages/database/tests/constraints/ops-tasks.test.ts`, `packages/authorization/tests/ops-grants.test.ts` |
| TT-14 | Job `demo-academic-marks` (`POST /ops/api/v1/jobs/demo-academic-marks`): moves demos forward from Academic marks; needs `ops:jobs:run` and all-scope `ops:leads:write`; run by hand, no scheduler | Implemented | `apps/business-ops-os/src/app/api/v1/jobs/[job]/route.ts` |
| TT-15 | Bulk task changes | Proposed (not built) | — |

### Commands run and results
| Command | Result |
|---|---|
| `npm run validate` | exit 0 — typecheck + lint 0 warnings + `Test Files 156 passed (156)`, `Tests 2056 passed \| 1 todo (2057)`, secret scan OK (1,160 files). That run came before the platform `it.todo` became a real test (now 0 todo and one more test; Business Ops suite 1,205 / 1,205 after that fix); the coordinator re-runs validate after the browser pass |
| `npm run build` | exit 0 for platform, marketing-os, academic-os, business-ops-os |
| `npx vitest run packages/database` + `migration-0009.test.ts` | 10 files / 147 tests passed; 5 / 5 (0008-shaped rows keep their ids and get the backfills) |
| `cd packages/database && npx drizzle-kit generate --name check` | "No schema changes" |
| `npm run docs:permissions -- --check`, `npm run docs:data-dictionary -- --check` | "matrix is up to date."; "up to date." |
| `npm run docs:code-map` | "wrote docs/code-map.html: 1639 files, 72 tables, 153 foreign keys, 156 test files." |
| `node build.mjs` in `C:\OPENBOT\Elevate-Not-Working` | "164 items (owner_decision 43, needs_credentials 5, not_built 89, prototype_limitation 27)" |
| Browser pass of the new screens | **done 22 Oct at 1440 px** with the Chrome extension (teacher class → attendance → log → review; coordinator screens; Ops review read; task → EOD → manager inbox): no console errors, no horizontal scroll, keyboard focus visible; 9 findings fixed (sample badge via migration 0011 + intake, overview period labels, raw error details, chapter list by subject, form reset, allocation labels, chapter picker, EOD false "source changed" from jsonb key order, student header batch from Academic). 390 px not checked in the browser. Before that: signed-in HTTP check of 54 page/role combinations on fresh dev servers (all 200; denied pages show "No access"), and a live API walk of both milestones (admission → placement → class → attendance → delivered → log → review visible on the Ops student Feedback tab; manager assigns → teacher acknowledges/updates/submits → EOD submit (double submit = same version) → manager inbox viewed/comment/acknowledge → reviewer approves; review-gate bypass 403, close-without-review 409, counsellor refused). EOD and task-report PDFs rendered and looked at (2 pages each, A4) |

Final totals (22 Oct 2026, coordinator, after the teacher-workspace and task-tracker work and the live checks): `npm run validate` → exit 0: typecheck all workspaces, lint 0 warnings, `Test Files 158 passed (158)`, `Tests 2069 passed (2069)`, secret scan OK (1,166 files). `npm run build` → see the results table. Database: migrations `0000`–`0011`, all applied on the owner's local database (0009 sha256 `8b804acd…caf9bb`; 0010 and 0011 data only); `packages/database` 11 files / 155 tests (incl. `migration-0009.test.ts`: 0008-shaped rows keep ids and get the backfills, system-created enrolments get a placement with no placer, 0010 links only unambiguous pairs); `drizzle-kit generate --name check` → "No schema changes". Browser pass with the Chrome extension done on 22 Oct at 1440 px (all four flows; no console errors; no horizontal scroll; keyboard focus visible); its 9 findings were fixed and re-tested; 390 px not checked in the browser (window maximized). Status: **Implemented and Tested (API + live HTTP) — not Deployed**.

### Known limitations
- No HR module: every HR attendance or leave field says "HR attendance unavailable"; Academic unavailability is not HR leave (OD-026).
- Academic reports are print views and CSV only; no Academic PDFs.
- Not built: topics or learning objectives below chapter, homework submissions, log reminders and autosave, bulk task changes, protected file storage for evidence (links only).
- `AcademicStudentSummaryV1` has no "attendance not recorded" field (carried in `extensions.attendanceNotRecorded`); removing the guardian contact from the enrolment event needs contract v2.
- Withdrawn and completed enrolments get no backfilled placement (no end date on record).
- `packages/database/src/schema/academic.ts` is 1,383 lines (over the 1,000-line limit before this work; split is follow-up).
- The prototype (`C:\OPENBOT\Elevate`) does not show any of this work.
- Tracker parity with real data waits for the owner's browser exports; the HTML file holds no records.

## Integration (wave 3)
_Owned by the Integration agent._ Pending: baseline migration, cross-module tests (enrolment handoff end to end), consumer scheduler, platform consolidated dashboard from the summary contracts, docs reconciliation (`npm run docs:permissions`).
