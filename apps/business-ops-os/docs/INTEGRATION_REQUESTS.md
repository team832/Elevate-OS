# Business Ops OS — integration requests

Requests to other owners (BUILD_PLAN rule 1). Business Ops did not edit any of these files. Last updated 21 Oct 2026 (final wave).

HR and Operations were removed by the owner on 2026-10-20 (D-032), recoverable from commit 63da4e4; requests that only served them are withdrawn below.

| ID | To | Request | Why | Status |
|---|---|---|---|---|
| IR-OPS-01 | Foundation/Integration (`packages/authorization/tests/authorization.test.ts`) | Grant `ops:module:access` to `teacher` (in `permissions/ops.ts`, Ops-owned) **and** update the test that pins `modulesFor(teacher)` to `['platform', 'academic']`. | Teachers hold `ops:tasks:read/write` with scope `own` and can open `/ops/tasks` directly, but the module switcher does not show Ops for them because granting module access would break a Foundation-owned test. | Withdrawn 20 Oct 2026 (owner removed HR/Operations, D-032) |
| IR-OPS-02 | Integration (wave 3) | Run the Ops jobs on a schedule (both idempotent, exported from `@elevate/business-ops-os/server`): enrolment replies every minute, follow-up reminders 09:00 IST daily. | No scheduler exists; an authorised person runs them from the jobs route (`docs/API.md` Jobs). | Open (task, HR and access-revocation jobs withdrawn 20 Oct 2026, D-032) |
| IR-OPS-03 | Integration (wave 3) | End-to-end test: Ops `requestEnrolment` → Academic consumer `academic.enrolment-intake` → reply → Ops `processEnrolmentReplies`. | Each side was tested with hand-published events only. | **Closed 19 Oct 2026.** Evidence: `apps/platform/tests/integration/enrolment-handoff.test.ts` (6 cases pass, 1 `it.todo` for IR-OPS-ADM-1). |
| IR-OPS-04 | Integration | Regenerate the permission matrix (`npm run docs:permissions`) in `docs/SECURITY_AND_PERMISSIONS.md`. | `permissions/ops.ts` changed: 18 `ops:*` permissions remain after the HR/Operations removal (D-032); five HR roles removed. | Open until the matrix is regenerated |
| IR-OPS-05 | Foundation (`packages/shared-types/src/ids.ts`) | Optional: add shared branded ids for Ops entities other modules may reference later (e.g. `SopId`, `DecisionId`). | Ops brands them locally in `packages/database/src/schema/ops.ts` for now. | Withdrawn 20 Oct 2026 (owner removed HR/Operations, D-032) |
| IR-OPS-06 | Academic OS | Serve `GET /academic/api/internal/v1/summary` with `callers` including `ops`, returning `AcademicDeliverySummaryV1`. | The Ops dashboard already calls it and shows "source unavailable" until it exists. | Endpoint exists (`callers` include `ops`, found in the 19 Oct audit). Not verified against a running server; the panel still shows "source unavailable" on any failure. Keep open until a live check. |
| IR-OPS-07 | Marketing OS | Serve `GET /marketing/api/internal/v1/summary` with `callers` including `ops` (`MarketingSummaryV1`). Later: `marketing.enquiry.captured.v1` for MKT-036 → OPS-001. | Same as IR-OPS-06; enquiry intake from Marketing is Proposed on the Ops side. | Summary endpoint exists (same audit). The event `marketing.enquiry.captured.v1` is not built; open for that part only. |
| IR-OPS-08 | Foundation (`packages/shared-ui`) | Optional: a `title` tooltip on `StatTile` (PRD: definition visible on hover). | Ops prints the definition under each tile instead. | Open (low priority) |
| IR-OPS-09 | Integration (`core.ts` owner) | If the owner wants an Ops-specific staff role list or employment type in core, move `ops.staff_profiles` fields into `core.staff_members`. | Ops did not change `core.ts` (steward rule); profiles live in `ops.staff_profiles`. | Proposal |
| IR-OPS-10 | Prototype owner (`Elevate\`) | Prototype parity: `Elevate.html` still has Operations screens (tasks, escalations, SOPs, responsibilities, risks, projects, milestones, incidents, decisions) that the real module removed on 20 Oct 2026 (D-032), and no student-administration or fee-record screens. Port the real rules, never invent them. | The prototype must match the real system. | Open |
| IR-OPS-11 | Foundation / permission owner | Dedicated permissions the slices asked for. Added to `permissions/ops.ts` on 19 Oct 2026: `ops:compensation:approve`, `ops:policies:approve`, `ops:sops:acknowledge`, and `own(ops:recruitment:read)` for `department_manager`. Still open: `ops:employee_records:read` (employment facts still reuse `ops:lifecycle:read`) and tests per new permission. | Matrix in `docs/PERMISSIONS.md`. | Withdrawn 20 Oct 2026 (owner removed HR/Operations, D-032) |
| IR-OPS-12 | Integration | Wiring left to shared files: NAV entries in `src/ui/frame.tsx` (HR, attendance, leave, shifts, timesheets, approvals, reports, students), barrel exports (`runMissingClockOutCheck`, `hrTimeMetrics`, attendance provider, `retryEnrolmentHandoff`), register the lifecycle separation publisher as a deactivation handler, a platform job route for `processAccessRevocations`, | These files are shared. | Withdrawn 20 Oct 2026 (owner removed HR/Operations, D-032) |
| IR-OPS-ADM-1 | Academic OS (`services/intake.ts`) | When `existingStudentId` is present and refers to an active student, reuse it and reply `existingStudent: true` instead of creating a new `academic.students` row. | Intake dedupes only by `source_admission_id`, so one child admitted to a second programme gets a second student. Test placeholder: `it.todo` in `enrolment-handoff.test.ts`. | Open |
| IR-OPS-ADM-2 | Academic OS | Duplicate-enrolment guard: before inserting an enrolment, look for an active `admission_event` enrolment with the same `source_admission_id`; reply confirmed with it (or reject `DUPLICATE_ENROLMENT`). Add a partial unique index on `academic.enrolments(source_admission_id) WHERE status = 'active' AND source = 'admission_event'`. | A re-driven old request without a batch would create a second enrolment. Ops flags a late confirmation but cannot prevent it. | Open |
| IR-OPS-ADM-3 | Integration | Declare `@elevate/business-ops-os` and `@elevate/academic-os` as devDependencies of `apps/platform`; re-export `retryEnrolmentHandoff` from `@elevate/business-ops-os/server`. | The E2E test resolves them through workspace links and a relative import. | Open |
| IR-ACD-08 (Academic) | Academic OS | Teacher availability from approved leave through a read contract, not a table join. | Needs OD-026 policy decisions; leave data now exists in Ops. | Withdrawn 20 Oct 2026 (owner removed HR/Operations, D-032) |

No npm dependencies were added (phone normalisation and similarity are implemented in `src/domain/contacts.ts` instead of using libphonenumber).

## Added on 20 Oct 2026 (admissions workspace)

Full text of each row lives in the file of the owner who must act; this table is the Business Ops index.

| ID | To | Request (short) | Full text | Status |
|---|---|---|---|---|
| IR-OPS-STU-1 | Academic OS | Per-student results and attendance read contract | `apps/academic-os/docs/INTEGRATION_REQUESTS.md` | **Done 21 Oct 2026.** `GET /academic/api/internal/v1/students/{academicStudentId}/summary` (caller `ops` only, contract `academic.student_summary` v1). Evidence: `apps/academic-os/tests/integration/student-summary.test.ts`; Ops side `tests/integration/academic-reports.test.ts`. |
| IR-OPS-STU-2 | Academic OS | Use the `core.students` id in enrolments (D-033); supersedes IR-OPS-ADM-1 | same | **Done 21 Oct 2026.** Academic: `academic.students.core_student_id` (unique when set); intake matches `existingStudentId`, then `coreStudentId`, then the source admission (evidence: `apps/academic-os/tests/integration/placements.test.ts` "a second programme for the same person reuses the student by coreStudentId, then existingStudentId"). Ops: `server/enrolment.ts` `buildPayload` sends `coreStudentId` (= `admissions.student_id`) and `academicYear` (from the application) with `existingStudentId`. End to end: `apps/platform/tests/integration/enrolment-handoff.test.ts` › *second programme: Academic reuses the student and links the canonical core student*. |
| IR-OPS-MTG-1 | Academic OS | Teacher → batch assignment contract | same | **Done 21 Oct 2026.** `GET /academic/api/internal/v1/teachers/{staffId}/activity` (`academic.teacher_activity` v1: assignments, sessions planned/delivered/cancelled/substituted, pending logs/attendance/marking, reviews, unavailability). Evidence: `apps/academic-os/tests/integration/teachers-myday.test.ts`; Ops side `tests/integration/academic-reviews.test.ts` "teacher operations". |
| IR-OPS-MTG-2 | Academic OS + owner | Who owns teacher → student feedback after enrolment | same | **Done 21 Oct 2026 (D-058):** reviews are written in Academic OS and read by Ops through `GET /academic/api/internal/v1/reviews`; Ops write routes removed, old rows read-only. Evidence: `apps/academic-os/tests/integration/reviews.test.ts`; Ops `tests/integration/academic-reviews.test.ts`, `feedback.test.ts`. |
| IR-MKT-OPS-HANDOFF | Marketing OS | Produce `marketing.lead.handed_off` v1 (supersedes the IR-MKT-05 / IR-OPS-07 event proposal) | `apps/marketing-os/docs/INTEGRATION_REQUESTS.md` | Open; Ops consumer tested with mock events |
| IR-OPS-PLT-1 | Platform | System actor for job- and consumer-created records | `apps/platform/docs/INTEGRATION_REQUESTS.md` | Open |
| IR-OPS-PLT-2 | Platform | Scheduler for `lead-intake`, `enrolment-replies`, `follow-up-reminders` (extends IR-OPS-02) | same | Open |
| IR-OPS-PLT-3 | Platform / Foundation | Theme block and `Drawer` into `@elevate/shared-ui` | same | Open |
| IR-OPS-13 | Integration | Regenerate the permission matrix: 35 `ops:*` keys after the admissions brief (18 + 17) | this file (extends IR-OPS-04) | Open |
| IR-OPS-14 | Prototype owner (`Elevate\`) | Port the admissions workspace rules (3-class demos, conversion, admission numbers, student lifecycle, guardians, appointments, teacher feedback, fee plans, Marketing handoff) to `Elevate.html` and the 17 new keys to `src/data/permissions.json` (extends IR-OPS-10) | this file | Open |
| IR-OPS-15 | Integration | Migration `0003_admissions_workspace.sql` exists (coordinator, 21 Oct 2026); apply it to the local database and verify the backfill on a copy of real data before any shared environment | this file | Open |

## Added on 21 Oct 2026 (exits)

| ID | To | Request | Why | Status |
|---|---|---|---|---|
| IR-OPS-EXIT-1 | Academic OS | Consume a new event `ops.enrolment.closed` v1 (published by Ops when a case exits: withdrawn, completed, transferred, other inactive) and stop attendance and new sessions for that enrolment. | Today an exit is recorded only in Ops; Academic keeps marking attendance for an exited student. | Open (event not defined yet; needs the contract in `INTEGRATION_CONTRACT.md`) |
| IR-OPS-EXIT-2 | Academic OS | A read contract for batch end dates (per enrolment or per batch). | "Completion" candidates (students whose batch has ended) cannot be listed without it; the completion list is blocked. Academic attendance for a closed enrolment with no end date counts only marked sessions. | Open |
| IR-OPS-13 (update) | Integration | Regenerate the permission matrix: 42 `ops:*` keys now (adds `ops:admissions:confirm`, `ops:kyc:verify`, `ops:student_reports:review`, `ops:event_messages:send`, `ops:tasks:read`, `ops:tasks:write`, `ops:eod:review`). | `npm run docs:permissions` | Open until regenerated |

## Added on 21 Oct 2026 (owner brief 2: tasks, EOD, teacher operations)

| ID | To | Request | Why | Status |
|---|---|---|---|---|
| IR-OPS-13 (update 2) | Integration | Regenerate the permission matrix: 44 `ops:*` keys (adds `ops:tasks:import`, `ops:feedback:acknowledge`; `ops:feedback:write` / `:manage` held by no role). | `npm run docs:permissions` | Open until regenerated |
| IR-OPS-16 | Integration / owner | Migration `0009_academic_teacher_workspace_tasks` (generated, not applied): apply locally with `npm run db:migrate`. Before that, check that no student has two active enrolments in the same course (the new unique index would stop the migration). | New task, EOD, import and review-acknowledgement tables, task `source` and EOD version backfills. | Open |
| IR-OPS-17 | Shared contracts owner | `ops.admission.enrolment_requested` v2 without guardian contact details, and an `AcademicStudentSummaryV1` field for "attendance not recorded" (today in `extensions.attendanceNotRecorded`). | Needs a contract version change; not done this round. | Open |
| IR-OPS-18 | Platform | Protected file storage for task evidence. | Evidence is text or a link today. | Open (not built) |
| IR-OPS-19 | Prototype owner (`Elevate\`) | Port tasks / EOD / imports / teacher operations and the Academic review reading to `Elevate.html` (extends IR-OPS-14). | The prototype does not show this work. | Open |


## Role workspaces (22 Oct 2026, D-072 / D-073)
| ID | To | Request | Why | Status |
|---|---|---|---|---|
| IR-OPS-WS-1 | Academic OS (`AcademicDeliverySummaryV1`) | Add a `reviewsSubmitted` count for a date range to the internal delivery summary. | The Overview and Academic Summary count reviews published in the range with one `/reviews` call per teacher (shortcut in `src/server/overview.ts`); slow past about 50 teachers. | Open |
| IR-OPS-WS-2 | Owner | Confirm the D-073 grants (teachers only in Academic OS; coordinators in Academic OS and Business Operations; marketing: leads, lead contacts and own tasks). | The grants are Proposed. | Open (owner decision) |
| IR-OPS-WS-3 | Owner, then Marketing OS | An events-only permission so Marketing can open Events and Webinars (`ops:appointments:*` also covers private counselling). | Events and Webinars is hidden in Marketing until then. | Open (owner decision) |
| IR-OPS-WS-4 | Owner, then Marketing OS / Ops | Make the enquiry's campaign a reference instead of free text (`campaignRef`), and choose the lead-source attribution rule (first enquiry or every enquiry). | Conversion outcomes by campaign and leads by source cannot be counted reliably until then. | Open (owner decision) |
| IR-OPS-WS-5 | Owner, then Ops | Staff attendance (OD-026): a proposed `ops.staff_attendance` table would feed "My Attendance" in Academic OS and teacher attendance on the Overview. | Hidden / "no HR module" today. | Open (owner decision) |
