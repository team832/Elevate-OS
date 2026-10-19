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

## Integration (wave 3)
_Owned by the Integration agent._ Pending: baseline migration, cross-module tests (enrolment handoff end to end), consumer scheduler, platform consolidated dashboard from the summary contracts, docs reconciliation (`npm run docs:permissions`).
