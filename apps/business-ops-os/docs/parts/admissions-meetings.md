# Business Ops OS — counselling & meetings, teachers, feedback (part for merging)

> **Changed 21 Oct 2026 (D-058, supersedes D-043 for reviews):** teachers write student reviews in Academic OS. The Ops write paths for teacher → student feedback described below (POST/PATCH `/feedback/about-students`, `ops:feedback:write` / `:manage` grants) are removed; the old rows are read-only history; Ops reads submitted reviews from Academic and acknowledges them (`POST /review-acks`). Current routes: `../API.md`; rules: `../ALGORITHMS.md` A-75, A-MTG-4, A-MTG-5.

> **Renamed on 21 Oct 2026 by migration `0005_clear_names` (D-036):** this note describes the 20 Oct build. `ops.counselling_sessions` is now `ops.appointments` (`starts_at`, `staff_id`; `attendees` dropped), the legacy demo columns `subjects`/`day_dates`/`status`/`is_sample` and `ops.demo_teachers` are gone, `student_identity_id` is `student_id`, `admissions.student_id` is `academic_student_id`, `guardian_ref` is `guardian_id`, `staff_ref` is `staff_code`. Current columns: [../DATA_DICTIONARY.md](../DATA_DICTIONARY.md).

> **Merged on 21 Oct 2026.** Kept as a detailed appendix. Final ids: OPS-101 … OPS-108 (OPS-MTG-1 … 4 are OPS-105 … 108); rules A-MTG-1 … 3 are now A-73 … A-75. Canonical docs: `../../README.md`, `../../requirements/REQUIREMENTS.md`, `../DATA_MODEL.md`, `../WORKFLOWS.md`, `../API.md`, `../PERMISSIONS.md`, `../ALGORITHMS.md`, `../TEST_PLAN.md`, `../INTEGRATION_REQUESTS.md`. The migration it asks for exists: `packages/database/migrations/0003_admissions_workspace.sql`. Where this file and the canonical docs differ, the canonical docs win.

Owner brief 20 Oct 2026, chunks 6–7 (§8H, §11, §12). Built by build agent C on 20 Oct 2026. The coordinator merges this into `README.md`, `requirements/REQUIREMENTS.md`, `docs/{DATA_MODEL,DOMAIN_MODEL,API,ALGORITHMS,PERMISSIONS,WORKFLOWS,TEST_PLAN,INTEGRATION_REQUESTS}.md` and renumbers the temporary IDs (`OPS-MTG-n`, `A-MTG-n`). Status words follow D-013; nothing is Deployed.

## 1. Requirements

| ID | Title | Status | Evidence |
|---|---|---|---|
| OPS-008 (ext.) | Appointments: 6 types, student identity, admission/lead/demo refs, organiser, assigned teacher/counsellor, start/end + timezone, mode online \| offline (Sikar centre), programme/subject, purpose, statuses proposed/scheduled/confirmed/completed/cancelled/rescheduled, reminder status, outcome + follow-up, participants, append-only change history | **Tested** (API) · **Implemented** (screens) | `tests/integration/appointments.test.ts` |
| OPS-008 (ext.) | Double-booking refused (half-open intervals, blocking statuses, buffer setting), also against the teacher's scheduled demo classes; 409 names the clash; concurrent bookings serialised | **Tested** (appointments) · **Implemented** (demo-class check, no test yet) | unit `appointments-feedback.test.ts` → A-MTG-1; integration → "409 on overlap…", "concurrent…" |
| OPS-008 (ext.) | Teacher notified in-app on schedule/reschedule/cancel; email/SMS labelled "simulated — not sent" | **Tested** | integration → "201: persists…" |
| OPS-008 (ext.) | Counselling linked to an admission still drives the pipeline (contacted → counselling_scheduled → counselled; last cancelled → contacted; rule follow-up) | **Tested** (existing admissions/seed tests use the legacy `/counselling` routes, now adapters) | `scheduleCounselling` / `updateCounselling` in `src/server/appointments.ts` |
| OPS-MTG-1 | Teacher directory + profile: one `core.staff_members` row + `ops.staff_profiles` (display name, staff ref, name verification, role note kept apart from teaching, source note) + subject capabilities; picker by subject; workload = booked appointments + scheduled demo classes (capacity, not a score); batches "not available" (no Academic contract) | **Tested** (API, seed) · **Implemented** (screens) | integration → "teacher seed…" |
| OPS-MTG-2 | Teacher → student feedback: **moved to Academic OS on 21 Oct 2026 (D-058).** Rows written in Ops before then are shown read-only (current and superseded versions); no Ops route writes them | **Tested** (read-only history) | `tests/integration/feedback.test.ts` "teacher → student reviews recorded in Ops before 21 Oct 2026"; Academic `apps/academic-os/tests/integration/reviews.test.ts` |
| OPS-MTG-3 | Student/guardian → teacher feedback: recorded by staff on their behalf, moderated (pending → approved/rejected/hidden), teacher can never edit or moderate it, shown on the teacher profile only, teacher sees approved rows shared with them | **Tested** | `feedback.test.ts` |
| OPS-MTG-4 | Owner-supplied teachers seeded (7 people, no contacts/logins/permissions) + Accountancy/CA as a subject with no teacher | **Tested** | integration → "teacher seed…" |

## 2. Data model

`opsCounsellingSessions` (table `ops.counselling_sessions`, kept) is now the one appointments table. Two old column names are kept so existing readers keep working: `scheduled_at` = start instant, `counsellor_staff_id` = assigned teacher/counsellor. New columns: `type`, `student_id` (FK core.students), `demo_id`, `organiser_staff_id`, `ends_at`, `timezone`, `location`, `programme_id`, `subject`, `purpose`, `reminder_status`, `follow_up_on`, `cancel_reason`; `admission_id`/`lead_id` are now nullable. Checks: ends after start; at least one of student/lead/admission; cancelled needs a reason.

**Migration notes (for the coordinator's migration):** `type := 'student_counselling'`; `ends_at := scheduled_at + interval '60 minutes'`; `mode`: `in_person → offline` (location 'Sikar centre'), `video → online`, `phone → online` (location 'Phone call'); `status`: `no_show → cancelled` with `cancel_reason = 'No-show (migrated)'`; `reminder_status := 'not_applicable'`; `student_id` from `admissions.student_identity_id` where set; insert one `appointment_participants` row (`kind 'staff'`, role 'counsellor') per existing row.

`opsStaffProfiles` gains `display_name`, `staff_ref` (unique when set), `verification_status` (`unverified | confirmed`, default unverified), `role_note`, `source_note`; `notes` is internal.

New in `packages/database/src/schema/ops-meetings.ts`: `opsAppointmentParticipants`, `opsAppointmentChanges` (append-only), `opsStaffSubjectCapabilities` (a row with no staff = catalogue subject with no teacher), `opsTeacherStudentFeedback` (versioned), `opsStudentTeacherFeedback` (moderated, rating 1–5 or null, visibility `staff_only | teacher_and_staff`).

## 3. Algorithms

**A-MTG-1 Overlap** (`domain/appointments.ts slotsOverlap/findClash`). Purpose: no double booking. Inputs: candidate slot, the staff member's nearby appointments and scheduled demo classes, buffer minutes. Output: the first clash or none. Rule: half-open `[start, end)`; clash when `a.start < b.end + buffer && b.start − buffer < a.end`; only `proposed | scheduled | confirmed | rescheduled` block; a reschedule ignores itself. Preconditions: end > start. Edge cases: touching edges allowed; demo session without an end uses the default length. Concurrency: per-staff `pg_advisory_xact_lock` inside the transaction, nearby rows `FOR UPDATE`. Permissions: `ops:appointments:manage`. Tests: unit matrix, integration 409 / concurrent.

**A-MTG-2 Status transitions**: proposed → scheduled/confirmed/rescheduled/cancelled; scheduled → confirmed/rescheduled/completed/cancelled; confirmed → rescheduled/completed/cancelled; rescheduled → confirmed/rescheduled/completed/cancelled; completed and cancelled are final. Reschedule and cancel need a reason; outcome only after the start time. Every change writes `appointment_changes` rows (status, starts_at, ends_at, outcome) with actor and reason.

**A-MTG-3 Feedback**: teacher → student: author or `ops:feedback:manage`; draft edits in place; final edit inserts version n+1 with `supersedes_id` (unique, so no forks); superseded versions read-only (409). Student → teacher: no edit path at all; moderation pending → approved | rejected | hidden, approved ↔ hidden, rejected final; the teacher it is about can never moderate it (403), even with the permission. Rating summary averages approved rated rows only and shows the denominator.

## 4. API (all under `/ops/api/v1`, check order 401 → 403 → 400)

| Route | Permission | Notes |
|---|---|---|
| `GET /appointments?type&status&staffId&studentId&from&to&page` | `ops:appointments:read` (own = assigned, organiser or participant) | IST date range |
| `POST /appointments` | `ops:appointments:manage` | 201; 409 clash with `details[0].path = ['startsAt']` |
| `GET /appointments/:id` | read | participants + history |
| `PATCH /appointments/:id` `{action: confirm \| reschedule \| cancel \| complete}` | manage (own scope) | 409 illegal move |
| `POST /counselling`, `POST /counselling/:id` | `ops:leads:write` + manage | legacy bodies, adapted to the service above |
| `GET /teachers?subject&programmeCode` | `ops:teachers:read` (own = self) | directory + picker + unassigned subjects |
| `GET/PATCH /teachers/:id` | read / `ops:teachers:manage` | PATCH replaces the subject list |
| `GET /feedback/about-students?studentId` | read | teacher → student, read-only history (POST removed 21 Oct 2026, D-058) |
| `PATCH /feedback/about-students/:id` | — | removed 21 Oct 2026 (D-058) |
| `GET /feedback/about-teachers?teacherStaffId`, `POST` | read / `ops:feedback:record` | student/guardian → teacher |
| `PATCH /feedback/about-teachers/:id` | `ops:feedback:moderate` | the only change allowed |

## 5. Permissions (appended to `packages/authorization/src/permissions/ops.ts`)

`ops:appointments:read`, `ops:appointments:manage`, `ops:teachers:read`, `ops:teachers:manage`, `ops:feedback:read`, `ops:feedback:write`, `ops:feedback:manage`, `ops:feedback:record`, `ops:feedback:moderate`. Grants: operations_manager all; admissions_counsellor own appointments read/manage, teachers read, feedback record; teacher `ops:module:access`, own appointments read, own teachers read, own feedback read/write; academic_coordinator teachers read + feedback read; director and auditor every `:read` (automatic). `npm run docs:permissions` must be re-run.

## 6. Settings

`appointments.scheduling` = `{ bufferMinutes: 0, defaultDurationMinutes: 60 }`, **proposed**, owner to confirm.

## 7. Screens

`/ops/meetings` (list + week calendar via `?view=week`, filters in the URL, schedule form with subject-filtered teacher picker, clash message beside the start time, row → `?open=` drawer with confirm/reschedule/cancel/record outcome, type shown as badge text), `/ops/meetings/[id]` (full record), `/ops/teachers`, `/ops/teachers/[id]`, `StudentFeedbackSection` on the student profile (says where student/guardian feedback lives), staff pages link to teacher profiles. `/ops/schedule` permanently redirects to `/ops/meetings`.

## 8. Seeds

`ops.teachers` (`seed/teachers.ts`): Nikunj Bindal (Head of Business Operations, no subject), Satish Raghuvanshi (Mathematics; owner also wrote "Raghuanshi", kept in the source note; spelling from elevateeducation.in/ace-batch), Sushant Bindal (Economics; role note "CEO / director of coaching"), Olivia Ma'am (English, name as supplied), Tushar Bhakte (IPM / IIM Bangalore-oriented programmes; public "IIM Bangalore Alumni" listing stored only as an internal unverified note), Sobha (Commerce-oriented / special mathematics, no surname), Soma Tiwari (Current Affairs). Names and subjects `confirmed` (owner, 20 Oct 2026). No emails, phones, logins, photos, credentials or permissions. Accountancy / CA: capability row with no teacher. `ops.meeting-samples` (`seed/meetings-fixtures.ts`): one fictional sample student and 3 appointments with the fictional seed counsellor/teacher logins only.

## 9. Tests

`npx vitest run apps/business-ops-os/tests/unit/appointments-feedback.test.ts apps/business-ops-os/tests/integration/appointments.test.ts apps/business-ops-os/tests/integration/feedback.test.ts` → 3 files, 47 tests passed (20 Oct 2026).

## 10. Open items

- Owner: confirm `appointments.scheduling`; confirm the 1–5 rating scale; which of "Satish Raghuvanshi" is used everywhere (public site spelling used); whether Tushar Bhakte's subject should map to the IPMAT programme record.
- IR (Academic): publish teacher batch assignments (teacher profile shows "not available"); confirm who owns teacher → student feedback for enrolled students.
- IR (Integration): run `npm run docs:permissions`; frame NAV should rename "Schedule" to "Counselling & meetings" (`/ops/meetings`) and add "Teachers" (`/ops/teachers`); `seeds.test.ts` must allow the 7 owner-supplied staff (real names, no logins) next to the fictional ones; drop the now-unused legacy `counsellingBody` mode values once seeds use `offline | online`.
- Not done: browser check at 360/768/1280 px and production build (concurrent agents; no dev server allowed in this pass); demo-class clash path has no automated test.
