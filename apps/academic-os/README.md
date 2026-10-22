# Academic OS — module manual

Academic OS (`@elevate/academic-os`, port 3001, basePath `/academic`) is the **Academic workspace** for teachers and academic coordinators at http://localhost:3001/academic (D-072; there is no separate teacher app; guide: `docs/WORKSPACES.md` at the repo root). It plans and runs teaching at Elevate Education: programmes' course versions, curricula and their versioned baselines, batches, teacher assignments, timetables, class records, attendance, assessments and results, students and enrolments, catch-up and interventions. It stewards the programme catalogue (`core.programmes`) and owns every `academic.*` table.

> Status (21 Oct 2026, teacher workspace added): the slices below are **Implemented**; the ones with passing automated tests are **Tested** (see `requirements/REQUIREMENTS.md` §4 and the Academic section of `IMPLEMENTATION_STATUS.md`). The new screens are Implemented only (typecheck and build; no browser check by the implementers). Migrations `0000`–`0013` are applied to the owner's local database only (`docs/DATABASE_MIGRATION_PLAN.md`). Nothing is Deployed.
>
> 22 Oct 2026 (role workspaces, D-072 / D-073): the sidebar, the student attendance worklist, My tasks / My EOD report, task detail, report inbox, task reports and My meetings (mounted from Business Ops' shared `./work` entry) and the workspace chooser were added; teachers no longer open Business Operations (grant **Proposed**). Evidence: `tests/integration/work-mount.test.tsx`, `teacher-privacy.test.ts`, `teachers-myday.test.ts`, `tests/unit/screens.test.tsx`. No real student data, scores or deliveries exist in this system; the sample rows are marked SAMPLE DATA (D-061).
>
> Test count: 36 Academic test files (12 unit, 24 integration) on 22 Oct 2026; whole-repo results: see `IMPLEMENTATION_STATUS.md`.

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
| Every table in `packages/database/src/schema/academic.ts`, `academic-delivery.ts` and `academic-reviews.ts` (`academic.*`), including teacher reviews (D-058) and demo attendance on class rosters (D-060) | `core.programmes` (steward; seeded by the core seed, read here), `core.staff_members` (teachers are staff; Business Ops stewards them), `core.users`, `core.approvals` / `core.audit_events` / `core.integration_events` / `core.event_deliveries` / `core.notifications` through server-kit and notifications | `ops.*`, `marketing.*`, fees and payments |

- Cross-module references (the Ops `admission_id` / `lead_id` on students, enrolments and the intake log) are stored as plain UUIDs with **no foreign key** (D-005).
- Other modules talk to Academic only through events (`@elevate/shared-contracts`) and internal routes (summaries, reviews, teacher activity, demo attendance; §6). Academic never writes `ops.*`; it reads Business Ops demo sessions through `GET /ops/api/internal/v1/demo-sessions`. Nobody imports this app; the platform and wave-3 tests may import `@elevate/academic-os/{domain,server,seed}`.
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
- Plan items are planned class counts and minutes; they never become delivered work. Delivered hours count only **verified** first-teaching (`main`) class records (BR-ACD-11, D-062). Recorded-but-unverified minutes are shown separately.
- Delivery, attendance and the teaching log are three separate facts: only "Mark delivered" makes a session `held`; a log can be submitted only after it; attendance never changes either (D-063).
- The Class 12 override plan has `countsStatus = locked` and `datesStatus = provisional`; screens show both badges.
- Missing data is `null` / `metric.missing` with a reason, never 0 (attendance rate with nothing recorded, completion with no plan, the summary's `studentsAtRisk`).
- Nothing is called "optimal": timetable, capacity and assessment-schedule checks answer `feasible` / `infeasible` (capacity also `not_assessed`) with reasons, and capacity always returns the caveat that totals do not prove a dated schedule exists.

## 3. Roles, permissions and teacher own-scope
Declared in `packages/authorization/src/permissions/academic.ts`.

| Role | Academic access |
|---|---|
| `academic_coordinator` | Everything academic (all permissions below); `reviews:write` is own scope (a coordinator with a staff record may review any student) |
| `teacher` | `module:access`, `courses:read`; **own** scope on `batches:read`, `students:read`, `assignments:read`, `timetable:read`, `classes:read`, `classes:record`, `attendance:read`, `attendance:record`, `assessments:read`, `assessments:mark`, `progress:read`, `reviews:read`, `reviews:write` |
| `director` | every `…:read` and `module:access` |
| `auditor` | every `…:read` and `module:access` (read only; the catalogue refuses anything else) |
| counsellors, operations manager, marketing roles, platform admin | none — no student academic records |

Workspace (D-072): a person belongs to Academic OS when a role grants `academic:module:access` (teacher, academic coordinator, director, auditor). Every page calls `requirePageAccess(…, { workspace: 'academic' })` and every `/academic/api` route refuses non-members with 403. Inside Academic OS the teacher also uses Business Ops permissions held with **own** scope: `ops:tasks:read/write` (own tasks and EOD reports) and `ops:appointments:read` (own meetings). Since 22 Oct 2026 the teacher no longer holds `ops:module:access` (Proposed, D-073); the academic coordinator keeps it and belongs to both Academic OS and Business Operations.

Permissions: `module:access`, `programmes:manage`, `courses:read|write`, `curriculum:approve`, `batches:read|write`, `students:read|write`, `enrolments:read|decide`, `assignments:read|write`, `timetable:read|write`, `classes:read|record|verify`, `attendance:read|record`, `assessments:read|write|finalise|mark|publish`, `progress:read|write`, `settings:manage`, `summary:read`, `reviews:read|write`, `timetable:publish` (all prefixed `academic:`). The last five are new on 21 Oct 2026.

**Own scope** (`src/server/context.ts → resolveScope`): the teacher's `core.staff_members` row is found by `user_id`.
- Sessions, class records, attendance: sessions the teacher teaches — the planned `teacher_staff_id`, or an active co-teacher / substitute / actual row in `session_teachers`. A teacher can mark delivered, log a class or take attendance only for those sessions.
- Batches and assessments: batches where the teacher's assignment is open on the day (by dates, not status; D-065). Marks entry also needs the assessment's subject.
- Students, progress, reviews: students placed in those batches (batch placements, D-064) during the assignment window.
- Rules: `docs/ALGORITHMS.md` A18.
- A user without a staff record has an empty scope (sees nothing), never "all".
- Out-of-scope records answer **404** (existence is not leaked), not 403.
- Student contact details (student email and phone, date of birth, and every guardian field: name, relationship, email, phone) are returned only to holders of `academic:students:write` (the coordinator); teachers, directors and auditors get `null` and `contactsHidden: true` (PLT-014; guardian name and relationship hidden since 22 Oct 2026, owner to confirm; test `teacher-privacy.test.ts`).

Every route checks its permission on the server (`defineRoute`), every page with `requirePageAccess`; every business-state change runs in `withTransaction` with `recordAudit` (and `publishEvent` / `notify` where others must react).

## 4. Commands
Run from the repository root.

| Command | What |
|---|---|
| `npm run typecheck -w @elevate/academic-os` | TypeScript for the app |
| `npx eslint apps/academic-os packages/database/src/schema/academic*.ts packages/authorization/src/permissions/academic.ts packages/shared-contracts/src/modules/academic.ts --max-warnings=0` | Lint incl. module-boundary and domain-purity rules |
| `npx vitest run apps/academic-os` (or `--project academic-os`) | Unit + integration tests (in-memory PGlite, no server needed) |
| `npm run build -w @elevate/academic-os` | Production build |
| `npm run dev:academic` | Run alone on http://localhost:3001/academic (`/` redirects there). Starts the local database if nothing is listening, otherwise reuses it; the database must be migrated and seeded. Sign in at `/academic/login` (demo: `teacher@elevateeducation.in` after `npm run db:seed-demo-accounts`). Panels that read Business Operations still work: the shared task and meeting screens run inside this app |
| `npm run db:seed` | Core + module seeds, including this module's (local databases only) |

Do **not** run `npm run db:generate` in wave 2 — the baseline migration (including the academic tables) is generated by Integration in wave 3. Tests build the live schema with `createTestDb()`.

## 5. Screens
Server components inside `AppShell`, gated by `requirePageAccess(<permission>, { basePath: '/academic' })`; each has loading, empty, error and success states. Forms post JSON to the routes in §6 (the same server-side checks apply).

| Screen | Path | Permission | What it shows |
|---|---|---|---|
| My day / overview | `/academic` | `academic:module:access` | Teacher: next class first, then attendance, logs, demo feedback and support follow-ups due, each with its date range; "HR attendance unavailable". Coordinator: planned vs delivered vs cancelled vs not recorded, uncovered classes, conflicts, missing attendance/logs, awaiting-batch enrolments, pending marking, coverage table, open support cases |
| Curriculum | `/academic/curriculum` | `courses:read` | Course versions by programme with class length and its label; plan versions with `locked` / `provisional` / `proposed` / `superseded` badges and counts/dates labels |
| Plan detail | `/academic/curriculum/plans/[id]` | `courses:read` | Lesson items, totals by subject (teaching / practice / hours), supersession chain, approval history; request / decide approval (coordinator) |
| Concept books | `/academic/curriculum/concept-books` | `courses:read` | Six indices, stable chapter codes with aliases; question counts labelled "planned" |
| Batches | `/academic/batches` | `batches:read` | Batches (teachers: own), course, class length, active enrolments |
| Batch detail | `/academic/batches/[id]` | `batches:read` | Assignments, calendar rules, exclusions, chapter plan with planned vs completed (verified) hours, capacity feasibility |
| Timetable | `/academic/timetable` | `timetable:read` | Agenda, week and print views (teachers: own), filters by teacher/room/status, conflict check results, cancel / reschedule (coordinator) |
| Patterns | `/academic/timetable/patterns`, `/academic/timetable/patterns/[id]` | `timetable:read` | Weekly patterns: draft → preview → publish; series edit from tomorrow (coordinator). The subject picker lists each subject once per course, labelled with that course's batch codes |
| Teachers | `/academic/teachers`, `/academic/teachers/[staffId]` | `assignments:read` | Directory and profile: assignments, timetable, planned / delivered / cancelled / substituted (operational, not payroll), academic unavailability, "HR attendance unavailable", no ratings |
| Enrolments | `/academic/enrolments` | `enrolments:read` | Awaiting batch / Placed / Transfers / Ended; allocate, transfer, end (coordinator) |
| Teaching logs | `/academic/teaching`, `/academic/teaching/log/[sessionId]` | `classes:read` | Logs to write, drafts, exceptions (delivered without a log, planned ≠ logged chapter); verify / request correction / correct (coordinator) |
| Class page | `/academic/teaching/attendance/[sessionId]` | `attendance:read` | Roster from placements + demo attendees (DEMO badge); marks with reasons for changes; "Mark all remaining present"; Mark delivered / reopen / substitute; history |
| Reviews | `/academic/reviews`, `/academic/reviews/new`, `/academic/reviews/[id]` | `reviews:read` (`new`: `reviews:write`) | Teacher reviews: drafts (author only), submitted versions, revise, withdraw; labels "Staff only" / "May inform a reviewed parent summary" |
| Assessments | `/academic/assessments`, `/academic/assessments/[id]`, `/academic/assessments/[id]/marks` (`assessments:mark`) | `assessments:read` | Configure scoring, answer keys, enter/import responses or marks (states), validate, finalise, publish, re-score, analysis; rank/percentile only when the setting is approved |
| Students | `/academic/students`, `/academic/students/[id]` | `students:read` | Students (teachers: own batches; contacts hidden), progress: attendance, results, trend, missed classes |
| Progress and support | `/academic/progress`, `/academic/progress/students/[id]` | `progress:read` | Catch-up list per batch with explanations; per student four separate dimensions with definitions; support plans |
| Reports | `/academic/reports`, `/academic/reports/[kind]` | `module:access` (each report re-checks its own permission) | Batch attendance, coverage, assessment analysis, teacher week: print view (black on white) + CSV (audited) |
| Academic settings | `/academic/settings` | `settings:manage` | Proposed and approved settings; approving needs a D-0xx / OD-0xx reference |
| Enrolment intake | `/academic/intake` | `enrolments:read` | Waiting requests, processed outcomes (confirmed / rejected with reason), failed/dead deliveries; "Process intake" (coordinator) |
| Student attendance (22 Oct 2026) | `/academic/attendance` (`?view=all`) | `attendance:read` | Worklist of own classes over two weeks, newest first: tabs "Needs marking" and "All classes"; placed students without a mark counted only for classes that have ended; each row opens the class page |
| My tasks, My EOD report (22 Oct 2026) | `/academic/tasks` (`?tab=day\|all\|eod`), `/academic/tasks/[id]`, `/academic/tasks/inbox`, `/academic/tasks/reports` | `ops:tasks:read` (own) | Business Ops' task and EOD screens mounted from `@elevate/business-ops-os/work` (D-073): the same records and rules as `/ops/tasks`; links stay under `/academic`. The report inbox shows only for EOD recipients and reviewers (`hasInbox`) |
| My meetings (22 Oct 2026) | `/academic/meetings` | `ops:appointments:read` (own) | Read-only list of the teacher's own meetings (`MeetingsBody`), participant names only |
| Choose a workspace | `/academic/workspaces` | signed in | The chooser for people in several workspaces (D-072) |

**Sidebar (22 Oct 2026, `src/ui/shell.tsx`):** Today (My day, My meetings) · Teaching (Timetable, My batches — "Batches" for coordinators, Students, Student attendance, Teaching logs, Curriculum, Assessments, Student reviews, My tasks, My EOD report) · Coordination (Teachers, Enrolments, Enrolment intake, Progress and support, Reports, Academic settings), shown only with all-scope permission. Each item needs its permission. Not shown: **My Attendance** (no staff-attendance data; a proposed `ops.staff_attendance` table waits for OD-026) and **Resources** (no teaching-material store; concept-book indices are a Curriculum tab). Links to another workspace are absolute and shown only to its members (`workspaceLink`).

**My day (22 Oct 2026)** adds: Your batches, review drafts count, "Student attendance not recorded", a Tasks and EOD block (`taskDaySummary`: own open, overdue and blocked work, today's EOD status) and Meetings today.

The exact page files are listed in `docs/TEST_PLAN.md` and `IMPLEMENTATION_STATUS.md`.

## 6. API overview
Browser-facing REST under `/academic/api/v1/…` built with `defineRoute` (401 → 403 → 400 → handler; envelope `{ data }` / `{ error }`); full reference in `docs/API.md`.

| Area | Routes |
|---|---|
| Curriculum | `GET programmes`; `GET/POST courses`; `GET courses/:id`; `POST courses/:id/subjects`; `POST courses/:id/chapters`; `POST chapters/:id/retire`; `GET/POST plans`; `GET plans/:id`; `POST plans/:id/items`; `POST plans/:id/approval`; `POST plans/:id/approval/decision`; `GET concept-books` |
| Batches & calendar | `GET/POST batches`; `GET/PATCH batches/:id`; `GET batches/:id/coverage`; `GET batches/:id/feasibility`; `GET/POST assignments`; `POST assignments/:id/end`; `GET staff`; `GET/POST rooms`; `GET/POST exclusions`; `POST calendar-rules`; `GET teachers`; `GET teachers/:staffId`; `GET/POST unavailability`; `DELETE unavailability/:id` |
| Timetable | `GET/POST sessions`; `POST sessions/:id/cancel`; `POST sessions/:id/reschedule`; `POST sessions/:id/deliver`; `POST sessions/:id/reopen`; `POST sessions/:id/substitute`; `POST timetable/check`; `GET/POST patterns`; `PATCH/DELETE patterns/:id`; `GET patterns/:id/preview`; `POST patterns/:id/publish`; `POST patterns/:id/series` |
| Teaching | `GET/POST class-records`; `PATCH class-records/:id`; `POST class-records/:id/verify`; `POST class-records/:id/request-correction`; `POST class-records/:id/correct`; `GET class-records/exceptions`; `GET/PUT sessions/:id/attendance`; `POST sessions/:id/attendance/mark-remaining`; `GET/POST demo-attendees`; `DELETE demo-attendees/:id` |
| Reviews | `GET/POST reviews`; `GET/PATCH reviews/:id`; `POST reviews/:id/revise`; `POST reviews/:id/withdraw`; `GET students/:id/reviews` |
| Assessments | `GET/POST assessments`; `GET assessments/:id`; `PUT assessments/:id/scoring`; `POST assessments/:id/answer-keys`; `POST assessments/:id/attempts`; `POST assessments/:id/validate`; `POST assessments/:id/finalise`; `POST assessments/:id/rescore`; `GET assessments/:id/results`; `GET/PUT assessments/:id/marks`; `POST assessments/:id/publish`; `GET assessments/:id/analysis`; `POST assessments/schedule-check` |
| Students & progress | `GET/POST students`; `GET students/:id`; `GET students/:id/progress`; `GET/POST enrolments`; `GET/POST placements`; `POST placements/transfer`; `POST placements/end`; `GET/POST batches/:id/catch-up`; `PATCH catch-up-tasks/:id`; `GET/POST interventions`; `PATCH interventions/:id` |
| Intake | `GET enrolment-intake`; `POST enrolment-intake/run` |
| Settings | `GET settings`; `PUT settings/:key` |
| Reports | `GET reports/:kind` (`attendance`, `coverage`, `assessment`, `teacher-week`; `format=csv` audited) |
| Internal | `GET /academic/api/internal/v1/summary` (bearer `INTERNAL_SERVICE_TOKEN` + `X-Elevate-Caller: ops|platform`) → `AcademicDeliverySummaryV1`; `GET /academic/api/internal/v1/students/{id}/summary` (caller `ops` only) → `AcademicStudentSummaryV1` (IR-OPS-STU-1); caller `ops` only: `GET …/internal/v1/reviews` → `AcademicStudentReviewsV1` (D-058), `GET …/internal/v1/teachers/{staffId}/activity` → `AcademicTeacherActivityV1`, `GET …/internal/v1/demo-attendance?ids=` → `AcademicDemoAttendanceV1` (D-060) |
| Platform | `GET health`, `POST auth/login`, `POST auth/logout` (Foundation); `POST auth/workspace` (the chooser, D-072) |
| Tasks and EOD (mounted, D-073) | 15 route files re-exporting Business Ops' `workRoutes`: `staff-tasks`, `staff-tasks/:id`, `staff-tasks/:id/:action`, `…/dependencies`, `…/reassign`, `…/report`, `…/updates`, `eod-reports`, `eod-reports/:id`, `…/csv`, `…/follow-up`, `…/pdf`, `…/review`, `…/submit`, `task-reports`. Same permissions and bodies as `/ops/api/v1/…` (`apps/business-ops-os/docs/API.md`) |

## 7. Events produced and consumed
| Event | Direction | When | Idempotency |
|---|---|---|---|
| `ops.admission.enrolment_requested` v1 (optional `coreStudentId`, `academicYear` since 21 Oct 2026) | **consumed** by `academic.enrolment-intake` | Ops accepted an admission | delivery unique per (event, consumer); intake log unique per request event; enrolment unique per request event |
| `academic.enrolment.confirmed` v1 | produced | Intake created/reused the student and created the enrolment | key `enrolment-reply:<requestEventId>`, correlation = causation = request event id |
| `academic.enrolment.rejected` v1 | produced | Intake rejected the request (`reasonCode` + human `reason`) | same key rule |
| `academic.assessment.finalised` v1 | produced (defined in `packages/shared-contracts/src/modules/academic.ts`; no consumer yet) | Results finalised (version 1) or re-scored (version n) | key `assessment-finalised:<assessmentId>:v<version>`; payload carries counts only, no names or scores |

Consumer name constant: `ACADEMIC_CONSUMERS.enrolmentIntake` (`academic.enrolment-intake`).

## 8. Enrolment intake (no scheduler yet)
`src/server/services/intake.ts → runEnrolmentIntake(db, { triggeredByUserId? })` calls `processEvents` with consumer `academic.enrolment-intake`. For each waiting `ops.admission.enrolment_requested` v1, in **one transaction** with the delivery row:
1. load programme (by code), intended course and batch (locked), seats taken (placements), and the student: `existingStudentId`, then `coreStudentId`, then the same `source_admission_id` (one academic student per person; IR-OPS-STU-2 done; Business Ops sends `coreStudentId` and `academicYear`);
2. `decideIntake` (pure) → confirm or reject with a reason code (`PROGRAMME_NOT_OFFERED`, `COURSE_NOT_FOUND`, `BATCH_NOT_FOUND`, `INVALID_REQUEST`, `DUPLICATE_ENROLMENT`, `BATCH_FULL`);
3. confirm: reuse the student (linking the core student id when it was missing, audit `student.linked`) or create one, create the enrolment (`source = admission_event`, `request_event_id`, `academic_year`, late-joiner flag) and, with an intended batch, its open placement in the same transaction; on a timetable clash the enrolment waits for a batch and the intake log says why; publish `academic.enrolment.confirmed` v1 (`batchId` only when placed; `confirmedByUserId: null` — confirmed by rule). Duplicates (same admission + programme; same student + batch, course or programme) are rejected `DUPLICATE_ENROLMENT`; a student linked to a different person is rejected `INVALID_REQUEST`;
4. reject: publish `academic.enrolment.rejected` v1 (`rejectedByUserId: null`);
5. write `academic.enrolment_intake_log` and audit (actor `system`, metadata `triggeredBy`).

A failing handler rolls back and is retried on the next run; after 5 attempts the delivery is `dead` and is listed on the intake screen.

**There is no scheduler.** Run the consumer by pressing "Process intake" on `/academic/intake` (`POST /academic/api/v1/enrolment-intake/run`, permission `academic:enrolments:decide`) or by calling `runEnrolmentIntake(db)` from code. A scheduler is a wave-3 Integration item (`docs/INTEGRATION_REQUESTS.md` IR-ACD-02). Until a reply exists Ops must show "awaiting Academic OS".

## 9. Algorithms
All pure, in `src/domain`, documented in the 10-point format in `docs/ALGORITHMS.md`:
exact marks (`marks.ts`), scoring + finalise validation + aggregation/percentiles (`scoring.ts`), curriculum coverage (`coverage.ts`), timetable conflict detection (`timetable.ts`), capacity feasibility (`capacity.ts` — reproduces the legacy Class 12 figures 345 − 28 = 317 vs 305, headroom 12), assessment scheduling constraints (`assessment-schedule.ts` — reproduces the legacy late-weekend-test conflict), attendance summary, missed classes and least-squares trend (`progress.ts`), catch-up prioritisation (`catchup.ts`), enrolment intake decision (`intake.ts`), plan status rules (`plans.ts`), responses CSV (`responses-csv.ts`), settings (`settings.ts`); since 21 Oct 2026 also placement rules (`placements.ts`), assessment analysis (`analysis.ts`), pattern dates (`timetable.ts`), support signals and the attendance denominator (`progress.ts`), plus service-level rules A17–A22 (placements, current assignment, reviews, delivery, patterns, marks).

## 10. Configurable rules (settings)
Stored in `academic.settings` (key → jsonb value + `proposed`/`approved`), defined in `src/domain/settings.ts`, changed with `PUT /academic/api/v1/settings/:key` (`academic:settings:manage`, audited). **Every shipped default is `proposed`** — not owner-approved policy. A missing or invalid stored value falls back to the proposed default.

| Key | Proposed default | Effect |
|---|---|---|
| `timetable.teacher_workload_cap` | `{ maxMinutesPerDay: null, maxMinutesPerWeek: null, enforcement: 'warning' }` (not configured → not checked) | `TEACHER_WORKLOAD` finding; a preference unless `enforcement: 'hard'` |
| `assessments.min_gap_days` | `{ minDays: 0, enforcement: 'warning' }` (no gap rule) | `MIN_GAP` finding between assessments of a batch |
| `catchup.weights` | `{ recency: 2, chapter: 1, assessment: 3, horizonDays: 14 }` | Catch-up priority weights |
| `progress.trend` | `{ lastN: 5, minPoints: 3, flatThreshold: 1 }` | Least-squares trend window and minimum data |
| `attendance.denominator` | `{ lateCountsAsAttended: true, excludeExcused: true }` | What counts as attended and whether excused sessions leave the denominator; not-recorded is always separate |
| `progress.show_rank_percentile` | `{ show: false }` | Rank and percentile hidden until approved with `show: true` |
| `teaching_log.deadline_hours` | `{ hours: null }` | No log deadline: logs are pending, never late |
| `demo.attendees_count_toward_capacity` | `{ counts: true }` | Reported next to the seat count; not enforced |
| `reviews.cadence_days` | `{ days: null }` | No review cadence: a missing review is pending, never negative |
| `timetable.substitute_authoriser` | `{ role: 'academic_coordinator' }` | Role allowed to authorise a substitute |

Approving a new value needs the owner's decision reference (`D-0xx` / `OD-0xx`; format checked only), kept in the audit row.

Other configuration lives on records: class length per course (`classMinutes` + `classMinutesStatus`) with an optional batch override; capacity per batch (`BATCH_FULL`); calendar rules and exclusions per batch; scoring rules per assessment and section.

## 11. Seeds and legacy data
`seed/index.ts` exports `seeds` run by `npm run db:seed` after the core seeds. They are idempotent (upsert on codes). Sample people follow D-036/D-061: "Sample …" / "<First> Sample Student" names, `@example.test`, `is_sample`, no phone numbers, SAMPLE DATA badge; `npm run db:clear-samples` removes them. Legacy planning data from `data/legacy/academic/*.json` keeps its status label; **nothing is seeded as delivered** (no class records, attendance, attempts or results).

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
| `academic.students` (`seed/samples.ts`): 3 sample batches (`SAMPLE-IPMAT-A`, `SAMPLE-IPMAT-B`, `SAMPLE-CAF`) and 6 "<First> Sample Student" students placed in `SAMPLE-IPMAT-A`; re-seeding takes sample students off the real planning batch | sample | `is_sample` |
| `academic.sample-teaching`: assignments for the sample teachers from the Ops seed `ops.sample-staff` (DEMO-T01…T12; only 6 have Academic assignments because the other subjects exist only in draft syllabus courses, D-051), classes around the anchor date (`SAMPLE_ANCHOR_DATE`, default today IST: delivered, cancelled + make-up, substituted, log pending, scheduled), attendance, logs, one demo attendee and teacher reviews | sample | `is_sample` |

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
| OD-026 | Staff leave in scope? | No HR source: screens show "HR attendance unavailable"; coordinators can enter an academic unavailability record (not HR leave), which is a hard timetable conflict |
| D-058 | Teacher reviews live in Academic (owner, 21 Oct 2026; supersedes D-043) | `teacher_reviews`, `/academic/reviews`, internal feed to Ops |
| D-059 | Theme stays dark | New screens use the existing tokens; print views are black on white |
| D-060 | Demo attendance for linked demo students is marked by the teacher in Academic | `session_demo_attendees`, class page DEMO badge, internal demo-attendance feed |
| D-061 | Sample staff and students | `seed/samples.ts` |
| — | Open (proposed settings): attendance denominator, rank/percentile, log deadline, demo seats, review cadence, substitute authoriser | §10; listed in `HANDOFF.md` "Decisions waiting for you" |
| — | Who locks baselines? PRD §3.2 says the director; the wave-2 brief says approvals by the academic coordinator | Implemented: `academic:curriculum:approve` held by the coordinator only, no self-approval; IR-ACD-10 asks the owner |

## 13. Known limitations
- No scheduler for the intake consumer (manual run).
- Conflict detection does not cover lesson-before-prerequisite in the timetable, daily slot counts or HR leave (academic unavailability only); assessment scheduling has no weekend-minutes cap (ACD-026).
- Not built (Proposed): topics/learning objectives below chapter, homework submissions, log reminders and autosave, wording help, Academic PDFs (reports are print views + CSV, R7), contract v2 for missing attendance in `AcademicStudentSummaryV1` and for removing guardian contact from the enrolment event (IR-ACD-12, IR-ACD-13), protected file storage for evidence (links only).
- Placements exist only from migration 0009: closed enrolments from before 21 Oct 2026 have no placement, so their attendance shows "Not recorded — no batch history before 21 Oct 2026".
- `packages/database/src/schema/academic.ts` is over 1,000 lines (1,383); splitting it is follow-up work.
- Future enrolment end dates are refused; series edits start tomorrow at the earliest; all timetable writes share one advisory lock.
- No absence follow-up items (ACD-015), automated risk flags (ACD-022: support plans are manual; support signals are raw facts), homework tracking (ACD-025: homework text on the log only), parent communication log (ACD-028), LMS attendance import.
- Cancelling a session needs a reason and the `timetable:write` permission (the coordinator); there is no separate approval step, and dependent tests are not flagged automatically.
- Planned vs delivered hours are not fields of `AcademicDeliverySummaryV1`; they are returned in a non-contract `extensions` object until Integration adds them (IR-ACD-03).
- Student codes are `STU-` + 8 hex characters (unique), not a sequential number.
- Screen gaps (the APIs exist): the schedule-session form has no subject / planned-chapter fields; the create-assessment form takes chapter ids as comma-separated UUIDs; the create-plan form takes a raw batch id for batch-scoped overrides; scoring sections and answer keys are entered as JSON. Screens are verified by typecheck and `next build` only (no E2E tests, D-007).
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
