# Academic OS — module manual

Academic OS (`@elevate/academic-os`, port 3002, basePath `/academic`) plans and runs teaching at Elevate Education: programmes' course versions, curricula and their versioned baselines, batches, teacher assignments, timetables, class records, attendance, assessments and results, students and enrolments, catch-up and interventions. It stewards the programme catalogue (`core.programmes`) and owns every `academic.*` table.

> Status (2026-10-18, wave 2): the slices below are **Implemented**; the ones with passing automated tests are **Tested** (see `requirements/REQUIREMENTS.md` and the Academic section of `IMPLEMENTATION_STATUS.md`). Nothing is Deployed. No real student data, scores or deliveries exist in this system.

## Contents
1. [Scope and boundaries](#1-scope-and-boundaries)
2. [Status words: planned is never delivered](#2-status-words-planned-is-never-delivered)
3. [Roles, permissions and teacher own-scope](#3-roles-permissions-and-teacher-own-scope)
4. [Commands](#4-commands)
5. [Screens](#5-screens)
6. [API overview](#6-api-overview)
7. [Events produced and consumed](#7-events-produced-and-consumed)
8. [Enrolment intake (no scheduler yet)](#8-enrolment-intake-no-scheduler-yet)
9. [Algorithms](#9-algorithms)
10. [Configurable rules (settings)](#10-configurable-rules-settings)
11. [Seeds and legacy data](#11-seeds-and-legacy-data)
12. [Owner decisions this module depends on](#12-owner-decisions-this-module-depends-on)
13. [Known limitations](#13-known-limitations)
14. [Document index](#14-document-index)

## 1. Scope and boundaries
| Owns (writes) | Reads | Never touches |
|---|---|---|
| Every table in `packages/database/src/schema/academic.ts` (`academic.*`) | `core.programmes` (steward; seeded by the core seed, read here), `core.staff_members` (teachers are staff; Business Ops stewards them), `core.users`, `core.approvals` / `core.audit_events` / `core.integration_events` / `core.event_deliveries` / `core.notifications` through server-kit and notifications | `ops.*`, `marketing.*`, fees and payments |

- Cross-module references (the Ops `admission_id` / `lead_id` on students, enrolments and the intake log) are stored as plain UUIDs with **no foreign key** (D-005).
- Other modules talk to Academic only through events (`@elevate/shared-contracts`) and the internal summary endpoint. Nobody imports this app; the platform and wave-3 tests may import `@elevate/academic-os/{domain,server,seed}`.
- Out of scope (PRD §3.3, D-015): biometric devices, the LMS, writing concept-book content, parent/student portals, fee handling, parent messaging (ACD-028).

Layout (BUILD_PLAN):
```
src/domain/     pure algorithms (no I/O)            → docs/ALGORITHMS.md
src/server/     context (actor, scope, audit), schemas (zod), services/*  → docs/ARCHITECTURE.md
src/app/        pages and thin route handlers        → docs/API.md
src/ui/         module React components
seed/           fictional fixtures + legacy importers (data/legacy/academic/*.json)
tests/unit      domain tests     tests/integration  services + routes on PGlite
```

## 2. Status words: planned is never delivered
Four different vocabularies are kept apart everywhere (PRD 0.1 rule 1, D-013, D-016):

| Vocabulary | Values | Where |
|---|---|---|
| Plan status | `locked`, `provisional`, `proposed`, `superseded` | `curriculum_plans.status` |
| Labels on planning facts | `locked`, `approved`, `provisional`, `proposed`, `draft`, `unverified`, `unknown` | `countsStatus` / `datesStatus` of a plan, a course's `classMinutesStatus`, calendar rules, exclusions (`provisional`/`confirmed`/`locked`/`unverified`), a batch's `targetExamDateStatus` (`official`/`tentative`/`assumed`/`unverified`), settings (`proposed`/`approved`) |
| Feature status | Proposed → Approved → Implemented → Tested → Deployed | `requirements/REQUIREMENTS.md`, `IMPLEMENTATION_STATUS.md` |
| Delivery | class record `submitted` / `verified` / `superseded`; session `scheduled` / `held` / `cancelled` / `rescheduled`; results `final` / `superseded` | the only places where work is recorded as done |

Rules enforced in code:
- Plan items are planned class counts and minutes; they never become delivered work. Delivered hours count only **verified** class records (BR-ACD-11). Recorded-but-unverified minutes are shown separately.
- The Class 12 override plan has `countsStatus = locked` and `datesStatus = provisional`; screens show both badges.
- Missing data is `null` / `metric.missing` with a reason, never 0 (attendance rate with nothing recorded, completion with no plan, the summary's `studentsAtRisk`).
- Nothing is called "optimal": timetable, capacity and assessment-schedule checks answer `feasible` / `infeasible` (capacity also `not_assessed`) with reasons, and capacity always returns the caveat that totals do not prove a dated schedule exists.

## 3. Roles, permissions and teacher own-scope
Declared in `packages/authorization/src/permissions/academic.ts`.

| Role | Academic access |
|---|---|
| `academic_coordinator` | Everything academic (all permissions below) |
| `teacher` | `module:access`, `courses:read`; **own** scope on `batches:read`, `students:read`, `assignments:read`, `timetable:read`, `classes:read`, `classes:record`, `attendance:read`, `attendance:record`, `assessments:read`, `progress:read` |
| `director` | every `…:read` and `module:access` |
| `auditor` | every `…:read` and `module:access` (read only; the catalogue refuses anything else) |
| counsellors, operations manager, marketing roles, platform admin | none — no student academic records |

Permissions: `module:access`, `programmes:manage`, `courses:read|write`, `curriculum:approve`, `batches:read|write`, `students:read|write`, `enrolments:read|decide`, `assignments:read|write`, `timetable:read|write`, `classes:read|record|verify`, `attendance:read|record`, `assessments:read|write|finalise`, `progress:read|write`, `settings:manage`, `summary:read` (all prefixed `academic:`).

**Own scope** (`src/server/context.ts → resolveScope`): the teacher's `core.staff_members` row is found by `user_id`.
- Sessions, class records, attendance: only sessions whose `teacher_staff_id` is that staff row. A teacher can log a class or attendance only for those sessions.
- Batches and assessments: batches with an **active** teacher assignment for that staff row.
- Students, progress, interventions: students with an active enrolment in those batches.
- A user without a staff record has an empty scope (sees nothing), never "all".
- Out-of-scope records answer **404** (existence is not leaked), not 403.
- Student contact details (student/guardian email and phone, date of birth) are returned only to holders of `academic:students:write` (the coordinator); others get `contactsHidden: true` (PLT-014).

Every route checks its permission on the server (`defineRoute`), every page with `requirePageAccess`; every business-state change runs in `withTransaction` with `recordAudit` (and `publishEvent` / `notify` where others must react).

## 4. Commands
Run from the repository root.

| Command | What |
|---|---|
| `npm run typecheck -w @elevate/academic-os` | TypeScript for the app |
| `npx eslint apps/academic-os packages/database/src/schema/academic.ts packages/authorization/src/permissions/academic.ts packages/shared-contracts/src/modules/academic.ts --max-warnings=0` | Lint incl. module-boundary and domain-purity rules |
| `npx vitest run apps/academic-os` (or `--project academic-os`) | Unit + integration tests (in-memory PGlite, no server needed) |
| `npm run build -w @elevate/academic-os` | Production build |
| `npm run dev:academic` | Run alone on http://localhost:3002/academic (needs `npm run db:start` and a migrated, seeded database; sign in at `/academic/login`) |
| `npm run db:seed` | Core + module seeds, including this module's (local databases only) |

Do **not** run `npm run db:generate` in wave 2 — the baseline migration (including the academic tables) is generated by Integration in wave 3. Tests build the live schema with `createTestDb()`.

## 5. Screens
Server components inside `AppShell`, gated by `requirePageAccess(<permission>, { basePath: '/academic' })`; each has loading, empty, error and success states. Forms post JSON to the routes in §6 (the same server-side checks apply).

| Screen | Path | Permission | What it shows |
|---|---|---|---|
| Dashboard | `/academic` | `academic:module:access` | Honest figures from the delivery summary (missing shown as "Missing", never 0), plan badges, intake waiting count |
| Curriculum | `/academic/curriculum` | `courses:read` | Course versions by programme with class length and its label; plan versions with `locked` / `provisional` / `proposed` / `superseded` badges and counts/dates labels |
| Plan detail | `/academic/curriculum/plans/[id]` | `courses:read` | Lesson items, totals by subject (teaching / practice / hours), supersession chain, approval history; request / decide approval (coordinator) |
| Concept books | `/academic/curriculum/concept-books` | `courses:read` | Six indices, stable chapter codes with aliases; question counts labelled "planned" |
| Batches | `/academic/batches` | `batches:read` | Batches (teachers: own), course, class length, active enrolments |
| Batch detail | `/academic/batches/[id]` | `batches:read` | Assignments, calendar rules, exclusions, chapter plan with planned vs completed (verified) hours, capacity feasibility |
| Timetable | `/academic/timetable` | `timetable:read` | Sessions (teachers: own), conflict check results (hard vs preferences), cancel / reschedule (coordinator) |
| Teaching log | `/academic/teaching` | `classes:read` | Log a class for an own session; records with verify / correct (coordinator) |
| Attendance | `/academic/teaching/attendance/[sessionId]` | `attendance:read` | Roster with marks; record or correct (own sessions) |
| Assessments | `/academic/assessments`, `/academic/assessments/[id]` | `assessments:read` | Configure scoring, answer keys, enter/import responses, validate, finalise, re-score, results with percentiles |
| Students | `/academic/students`, `/academic/students/[id]` | `students:read` | Students (teachers: own batches; contacts hidden), progress: attendance, results, trend, missed classes |
| Progress | `/academic/progress` | `progress:read` | Prioritised catch-up list per batch with explanations; interventions |
| Enrolment intake | `/academic/intake` | `enrolments:read` | Waiting requests, processed outcomes (confirmed / rejected with reason), failed/dead deliveries; "Process intake" (coordinator) |

The exact page files are listed in `docs/TEST_PLAN.md` and `IMPLEMENTATION_STATUS.md`.

## 6. API overview
Browser-facing REST under `/academic/api/v1/…` built with `defineRoute` (401 → 403 → 400 → handler; envelope `{ data }` / `{ error }`); full reference in `docs/API.md`.

| Area | Routes |
|---|---|
| Curriculum | `GET programmes`; `GET/POST courses`; `GET courses/:id`; `POST courses/:id/subjects`; `POST courses/:id/chapters`; `POST chapters/:id/retire`; `GET/POST plans`; `GET plans/:id`; `POST plans/:id/items`; `POST plans/:id/approval`; `POST plans/:id/approval/decision`; `GET concept-books` |
| Batches & calendar | `GET/POST batches`; `GET/PATCH batches/:id`; `GET batches/:id/coverage`; `GET batches/:id/feasibility`; `GET/POST assignments`; `GET staff`; `GET/POST rooms`; `GET/POST exclusions`; `POST calendar-rules` |
| Timetable | `GET/POST sessions`; `POST sessions/:id/cancel`; `POST sessions/:id/reschedule`; `POST timetable/check` |
| Teaching | `GET/POST class-records`; `POST class-records/:id/verify`; `POST class-records/:id/correct`; `GET/PUT sessions/:id/attendance` |
| Assessments | `GET/POST assessments`; `GET assessments/:id`; `PUT assessments/:id/scoring`; `POST assessments/:id/answer-keys`; `POST assessments/:id/attempts`; `POST assessments/:id/validate`; `POST assessments/:id/finalise`; `POST assessments/:id/rescore`; `GET assessments/:id/results`; `POST assessments/schedule-check` |
| Students & progress | `GET/POST students`; `GET students/:id`; `GET students/:id/progress`; `GET/POST enrolments`; `GET/POST batches/:id/catch-up`; `PATCH catch-up-tasks/:id`; `GET/POST interventions`; `PATCH interventions/:id` |
| Intake | `GET enrolment-intake`; `POST enrolment-intake/run` |
| Settings | `GET settings`; `PUT settings/:key` |
| Internal | `GET /academic/api/internal/v1/summary` (bearer `INTERNAL_SERVICE_TOKEN` + `X-Elevate-Caller: ops|platform`) → `AcademicDeliverySummaryV1`; `GET /academic/api/internal/v1/students/{id}/summary` (caller `ops` only) → `AcademicStudentSummaryV1` (IR-OPS-STU-1) |
| Platform | `GET health`, `POST auth/login`, `POST auth/logout` (Foundation) |

## 7. Events produced and consumed
| Event | Direction | When | Idempotency |
|---|---|---|---|
| `ops.admission.enrolment_requested` v1 | **consumed** by `academic.enrolment-intake` | Ops accepted an admission | delivery unique per (event, consumer); intake log unique per request event; enrolment unique per request event |
| `academic.enrolment.confirmed` v1 | produced | Intake created/reused the student and created the enrolment | key `enrolment-reply:<requestEventId>`, correlation = causation = request event id |
| `academic.enrolment.rejected` v1 | produced | Intake rejected the request (`reasonCode` + human `reason`) | same key rule |
| `academic.assessment.finalised` v1 | produced (defined in `packages/shared-contracts/src/modules/academic.ts`; no consumer yet) | Results finalised (version 1) or re-scored (version n) | key `assessment-finalised:<assessmentId>:v<version>`; payload carries counts only, no names or scores |

Consumer name constant: `ACADEMIC_CONSUMERS.enrolmentIntake` (`academic.enrolment-intake`).

## 8. Enrolment intake (no scheduler yet)
`src/server/services/intake.ts → runEnrolmentIntake(db, { triggeredByUserId? })` calls `processEvents` with consumer `academic.enrolment-intake`. For each waiting `ops.admission.enrolment_requested` v1, in **one transaction** with the delivery row:
1. load programme (by code), intended course and batch (locked), active enrolment count, an existing student with the same `source_admission_id`;
2. `decideIntake` (pure) → confirm or reject with a reason code (`PROGRAMME_NOT_OFFERED`, `COURSE_NOT_FOUND`, `BATCH_NOT_FOUND`, `INVALID_REQUEST`, `DUPLICATE_ENROLMENT`, `BATCH_FULL`);
3. confirm: reuse the student or create one (idempotent by source admission id), create the enrolment (`source = admission_event`, `request_event_id` set, late-joiner flag), publish `academic.enrolment.confirmed` v1 (`confirmedByUserId: null` — confirmed by rule);
4. reject: publish `academic.enrolment.rejected` v1 (`rejectedByUserId: null`);
5. write `academic.enrolment_intake_log` and audit (actor `system`, metadata `triggeredBy`).

A failing handler rolls back and is retried on the next run; after 5 attempts the delivery is `dead` and is listed on the intake screen.

**There is no scheduler.** Run the consumer by pressing "Process intake" on `/academic/intake` (`POST /academic/api/v1/enrolment-intake/run`, permission `academic:enrolments:decide`) or by calling `runEnrolmentIntake(db)` from code. A scheduler is a wave-3 Integration item (`docs/INTEGRATION_REQUESTS.md` IR-ACD-02). Until a reply exists Ops must show "awaiting Academic OS".

## 9. Algorithms
All pure, in `src/domain`, documented in the 10-point format in `docs/ALGORITHMS.md`:
exact marks (`marks.ts`), scoring + finalise validation + aggregation/percentiles (`scoring.ts`), curriculum coverage (`coverage.ts`), timetable conflict detection (`timetable.ts`), capacity feasibility (`capacity.ts` — reproduces the legacy Class 12 figures 345 − 28 = 317 vs 305, headroom 12), assessment scheduling constraints (`assessment-schedule.ts` — reproduces the legacy late-weekend-test conflict), attendance summary, missed classes and least-squares trend (`progress.ts`), catch-up prioritisation (`catchup.ts`), enrolment intake decision (`intake.ts`), plan status rules (`plans.ts`), responses CSV (`responses-csv.ts`), settings (`settings.ts`).

## 10. Configurable rules (settings)
Stored in `academic.settings` (key → jsonb value + `proposed`/`approved`), defined in `src/domain/settings.ts`, changed with `PUT /academic/api/v1/settings/:key` (`academic:settings:manage`, audited). **Every shipped default is `proposed`** — not owner-approved policy. A missing or invalid stored value falls back to the proposed default.

| Key | Proposed default | Effect |
|---|---|---|
| `timetable.teacher_workload_cap` | `{ maxMinutesPerDay: null, maxMinutesPerWeek: null, enforcement: 'warning' }` (not configured → not checked) | `TEACHER_WORKLOAD` finding; a preference unless `enforcement: 'hard'` |
| `assessments.min_gap_days` | `{ minDays: 0, enforcement: 'warning' }` (no gap rule) | `MIN_GAP` finding between assessments of a batch |
| `catchup.weights` | `{ recency: 2, chapter: 1, assessment: 3, horizonDays: 14 }` | Catch-up priority weights |
| `progress.trend` | `{ lastN: 5, minPoints: 3, flatThreshold: 1 }` | Least-squares trend window and minimum data |

Other configuration lives on records: class length per course (`classMinutes` + `classMinutesStatus`) with an optional batch override; capacity per batch (`BATCH_FULL`); calendar rules and exclusions per batch; scoring rules per assessment and section.

## 11. Seeds and legacy data
`seed/index.ts` exports `seeds` run by `npm run db:seed` after the core seeds. They are idempotent (upsert on codes) and use only fictional people (`(fictional)` names, `@example.test`). Legacy planning data from `data/legacy/academic/*.json` keeps its status label; **nothing is seeded as delivered** (no class records, attendance, attempts or results).

| Seeded | Source | Labels |
|---|---|---|
| Courses `IPMAT-BASE` (programme template, 75 min `locked`), `IPMAT-C12-2027` (Class 12, 75 min `locked`), `CAF-ACC-SEP27` (CA Foundation Accountancy, 75 min `proposed`, course `paused`, OD-019), `ONL-C12-ACC` (online Class 12 Accountancy under `COMMERCE_11_12`, 60 min `proposed`, course `paused`, OD-020), with subjects and chapters | `ipmat-baseline.json`, `class12-plan.json`, `ca-foundation-accountancy.json`, `online-class12-accountancy.json` | as in source |
| Plan `IPMAT-BASELINE-253` | locked 253-class teaching baseline (10 Sep 2026) | `locked`, counts `locked` |
| Plan `IPMAT-C12-313` | superseded 313-class Class 12 version | `superseded` |
| Plan `IPMAT-C12-305` | Class 12 override, 305 lessons / 381.25 h, supersedes 313 | `locked`; counts `locked`, dates `provisional` |
| Plan `CAF-ACC-V0.2` | CA Foundation Accountancy, 46 topic blocks | `provisional` |
| Plan `ONL-C12-ACC-226` | Online Class 12 Accountancy, 226 h | `provisional` |
| Concept books (133 numbered chapters + 1 opening unit, aliases for moved/retired ids) | `concept-books.json` | index `locked`; question counts `planned` |
| Batch `IPMAT-C12-APR27` (status `planning`): the documented weekly calendar rules (`provisional`), the 28-slot allowance as undated allowances (`locked` allowance, no dates), the mock-phase blackout 16 Oct–10 Nov 2027 (`provisional`); target exam 14 Nov 2027 `unverified` | `class12-plan.json`, `ipmat-baseline.json` | as noted |
| Batch `CAF-SEP27-REG` (status `planning`, no start date — OD-019) | `ca-foundation-accountancy.json` | planning |
| Teacher assignment: the fictional `teacher@example.test` staff record teaches Quant in `IPMAT-C12-APR27` | fictional | — |
| 6 fictional students ("… Example (fictional)") enrolled manually in `IPMAT-C12-APR27` with reason "Development seed (fictional student)" | fictional | — |

The seed is the ACD-008 importer; there is no separate dry-run/diff import tool yet (Proposed).

## 12. Owner decisions this module depends on
Exposed as labels, approval states or configuration — never silently decided.

| OD | Decision | How it appears here |
|---|---|---|
| OD-015 | IPMAT Class 12 cycle and official exam dates | Plan `datesStatus = provisional`; batch `targetExamDateStatus = unverified`; schedule conflicts on it carry `unverified: true` |
| OD-016 | Full mocks 70 or 50 | Not seeded as assessments; open |
| OD-017 | Weekend chapter-test map | Not imported as scheduled assessments; the legacy conflict is reproduced in a test |
| OD-018 | Holiday / closure calendar | 28-slot allowance seeded as undated `provisional` allowances; dated closures replace them when entered |
| OD-019 | CA Foundation parameters | CA course class length `proposed`; plan `provisional`; programme `planned` |
| OD-020 | Online Class 12 + CUET | Course `ONL-C12-ACC` 60 min `proposed`; plan `provisional` |
| OD-021 | 2026–27 programme and batch catalogue | Only the batches evidenced in legacy data are seeded |
| OD-022 | Attendance rules (online ≥ 45/60) | Not automated; statuses entered manually |
| OD-023 | Parent/progress report cadence | Not built (ACD-028) |
| OD-024 | Quant / Higher Maths question mapping | Concept-book counts left null for Books 2 and 3 |
| OD-026 | Staff leave in scope? | Conflict checks do not know teacher leave |
| — | Who locks baselines? PRD §3.2 says the director; the wave-2 brief says approvals by the academic coordinator | Implemented: `academic:curriculum:approve` held by the coordinator only, no self-approval; IR-ACD-10 asks the owner |

## 13. Known limitations
- No scheduler for the intake consumer (manual run).
- Conflict detection does not cover lesson-before-prerequisite in the timetable, daily slot counts or teacher leave; assessment scheduling has no weekend-minutes cap (ACD-026).
- No absence follow-up items (ACD-015), automated risk flags (ACD-022: interventions are manual), homework tracking (ACD-025), parent communication log (ACD-028), LMS attendance import.
- Cancelling a session needs a reason and the `timetable:write` permission (the coordinator); there is no separate approval step, and dependent tests are not flagged automatically.
- Planned vs delivered hours are not fields of `AcademicDeliverySummaryV1`; they are returned in a non-contract `extensions` object until Integration adds them (IR-ACD-03).
- Student codes are `STU-` + 8 hex characters (unique), not a sequential number.
- Screen gaps (the APIs exist): no settings screen (use `PUT /academic/api/v1/settings/:key`); the schedule-session form has no subject / planned-chapter fields; the create-assessment form takes chapter ids as comma-separated UUIDs; the create-plan form takes a raw batch id for batch-scoped overrides; scoring sections and answer keys are entered as JSON. Screens are verified by typecheck and `next build` only (no E2E tests, D-007).
- `listStaff` and `getCourse` do not check permissions inside the service; their routes and the pages that call them do.
- Tests run on PGlite (PostgreSQL 17); dev runs PostgreSQL 18.

## 14. Document index
| Document | Purpose |
|---|---|
| `requirements/REQUIREMENTS.md` | ACD-001…028 with status and code trace; BR-ACD rules |
| `docs/ARCHITECTURE.md` | Layers, data flow, transactions, scope, intake flow |
| `docs/DOMAIN_MODEL.md` | Tables, states, relationships |
| `docs/API.md` | Every route |
| `docs/ALGORITHMS.md` | Every algorithm in the 10-point format |
| `docs/TEST_PLAN.md` | What is tested where |
| `docs/INTEGRATION_REQUESTS.md` | Requests to other owners |
