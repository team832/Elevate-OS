# Business Operations: admissions audit and HR/Operations removal plan (Chunk 0, 20 Oct 2026)

Status words follow D-013 (Proposed, Approved, Implemented, Tested, Deployed). **Nothing is Deployed.** This audit measures the code against the owner's Business Operations / Admissions brief of 20 Oct 2026 (sections 4 to 19) and lists what to delete now that the owner has chosen to remove the existing HR and Operations features. It describes the working tree of branch `feature/business-ops-hr-admissions` at `63da4e4` plus the uncommitted restyle CSS. Where docs and code disagree, the code is treated as the truth. No code was changed; this file is the only file written.

It supersedes, for planning purposes, the 19 Oct baseline audit in `docs/BUSINESS_OPERATIONS_AUDIT.md` (root `docs/`), which measured the code against the earlier HR brief.

---

## 1. Method and checks

**Read:** the owner's brief; `AGENTS.md`; `docs/DECISIONS.md` (D-001 to D-031, skimmed; D-015, D-028, D-029 read); `docs/BUILD_PLAN.md`; `INTEGRATION_CONTRACT.md`; `IMPLEMENTATION_STATUS.md` (Ops sections); this module's `README.md`, `requirements/REQUIREMENTS.md`, every file in `docs/`; all of `src/server`, `src/domain`, `src/ui`, the page and route trees (import lists of every file), `seed/`, `tests/` (import lists and test counts); `packages/database/src/schema/{core,ops,ops-*,academic,marketing,index}.ts`, `migrations/`; `packages/authorization/src/{roles.ts,permissions/ops.ts,permissions/platform.ts}`; `packages/shared-types/src/roles.ts`; `packages/shared-contracts/src/{modules/*,events/*}`; `apps/platform/src/server/{overview-adapter,access-revocation}.ts` and `src/app/page.tsx`; the register `C:\OPENBOT\Elevate-Not-Working\items\*.json`; the prototype `C:\OPENBOT\Elevate\src\ops.js` (headings only).

**Commands run (real output):**

| Command | Output |
|---|---|
| `npx vitest run apps/business-ops-os/tests/unit/pipeline.test.ts …/admissions-fees.test.ts …/admission-followups.test.ts` | `Test Files 3 passed (3)`, `Tests 53 passed (53)` |
| `npx vitest run apps/business-ops-os/tests/integration/admissions.test.ts …/admissions-students.test.ts` | `Test Files 2 passed (2)`, `Tests 14 passed (14)` (the "Simulated Academic outage" log lines are expected test output) |
| `git status --short` | 7 modified files and 3 new CSS files, all the uncommitted restyle (`apps/*/src/app/*.css`, layouts, global-error) |
| `grep -ri ssrn` (whole repo, excluding node_modules) | no matches |

`npm run validate` was not run here (it was already running elsewhere). No result from it is reported in this file.

**Size of the module today:** 170 API route files (75 under `api/v1/hr`), 65 page/UI `.tsx` files under `src/app` (32 under `src/app/hr`), 21 files in `src/server/hr`, 13 in `src/domain/hr`, 31 integration test files (plus fixtures) and 14 unit test files, 9 seed files. The ops Postgres schema has 72 tables in `0000_baseline.sql`; 51 of them belong to HR or Operations.

---

## 2. Summary

1. **Demo lifecycle is the biggest gap.** A demo is one row with an array of dates (`packages/database/src/schema/ops.ts:694-741`, `day_dates` at :708) and one status for the whole demo (`scheduled|attended|missed|cancelled`, :709, :730). There is no `demo_sessions` table, no per-session time, teacher, attendance, mock status or correction history. The session count is fixed at **2** by an **approved, non-editable** setting taken from legacy decisions D-003/D-004 (`src/domain/policies.ts:224-239`), enforced exactly (`src/server/schedule.ts:214-215`). The brief asks for a default of **3** as a *proposed* setting. This is a conflict the owner must resolve with a recorded decision (`elevate-record-decision`) before Chunk 1.
2. **There is no admission number.** `ops.admissions.code` (`ADM-######`, `ops.ts:513`) is a *case* number assigned when the lead is created (`src/server/pipeline.ts:46-56`), not at conversion. It is concurrency-safe (advisory lock + max + unique index, `src/server/context.ts:63-82`, `ops.ts:506`) but has no proposed format setting and no manual override with reason/audit.
3. **There is no canonical student identity.** Ops treats "student" as lead + admission. Academic creates `academic.students` per admission (`academic.ts:736-772`, unique on `source_admission_id`). Ops sends `existingStudentId` for a second admission (`src/server/enrolment.ts:157`) but Academic ignores it (IR-OPS-ADM-1, open), so one child admitted twice gets two student rows. Nothing lives in `core`.
4. **Missing entirely:** demo sessions, demo checklist (the existing checklist is the admission confirmation gate), Convert-to-Admission wizard, Past/Inactive student records (withdrawn/completed/transferred, exit records, reactivation), multiple guardians, fee plans and instalments, counselling appointment types / participants / conflict checks, teacher subject expertise, both feedback tables, Marketing lead handoff (Marketing has no lead model and no events), student report/PDF, SSRN, and the brief's navigation (Demo Students, Active, Past/Inactive, Leads from Marketing, Counselling & Meetings, Applications/Decisions, Enrolment Handoffs).
5. **Working and worth keeping:** leads, enquiries, contact attempts, duplicate warnings with manual merge review, the admission pipeline state machine with append-only transitions, follow-ups with IST due rules and reminders, the confirmation gate with core fee-arrangement approval, manual fee records in paise with void-not-delete, the enrolment handoff over the outbox with attempts and retry, consent preferences, private-field redaction, the student directory/profile, the admissions KPI report, settings with decision states, the staff directory (core steward).
6. **HR and Operations can be removed without touching admissions logic**, but five KEEP files import them and must be trimmed first: `src/server/organisation.ts` (staff directory imports `hr/employee-core` and `hr/wiring`), `src/server/approvals.ts` (inbox includes HR, SOP, task and policy sources), `src/server/dashboard.ts` (task and risk KPIs), `src/server/reports/overview.ts` (`staffPresentToday` reads HR attendance), and `src/app/api/v1/jobs/[job]/route.ts` (HR and task jobs). The platform overview (`apps/platform/src/server/overview-adapter.ts`, `src/app/page.tsx`) shows staff present, attendance corrections and team priorities (tasks) and must change in the same pass.

---

## 3. Admissions gap analysis (brief sections 4 to 12)

Legend: **Implemented** = code exists and works for the requirement as written; **Partial** = a smaller or different version exists; **Missing** = nothing exists; **Mock-only** = adapter or simulation only. Evidence paths are relative to the repo root unless they start with `src/` (then `apps/business-ops-os/src/`).

### 3.1 Section 4: populations and lifecycle

| Requirement | Status | Evidence / notes |
|---|---|---|
| Explicit lifecycle states with transition rules, not free text | Partial | Pipeline state machine with a legal-transition table: `src/domain/pipeline.ts`, statuses `ops.ts:114-127` (`new … enrolled, lost, on_hold`). Covers leads to enrolment only. |
| Leads population | Implemented | `ops.leads` `ops.ts:276-351`; `/ops/leads`. |
| Demo students population | Partial | Derived from admission status `demo_scheduled`/`demo_attended`; no demo entity with its own outcome. |
| Active students | Partial | Student directory states `admitted`, `awaiting_enrolment`, `enrolled`, `withdrawn` (`src/domain/students.ts:13-49`, `src/server/students.ts:64-75`). |
| On-hold with reason + review date | Partial | `on_hold` with `held_from_status` and free reason (`ops.ts:470-472`, check :516-519). No review date. Pre-admission only. |
| Past: left / withdrew / completed / transferred with reason + history | Missing | Only "withdrawn after admission" = `lost` + `admitted_at` set (`src/server/students.ts:64`). No completed/transferred, no exit record. |
| Conversion keeps demo history and links demo → same student → admission/enrolment | Partial | Demos hang off the admission (`ops.demos.admission_id`), so history is kept. There is no student identity to link (see 3.6). |

### 3.2 Section 4.1: landing page

| Requirement | Status | Evidence / notes |
|---|---|---|
| Search, programme/batch, counsellor, status, date range, follow-up due/overdue, course filters | Partial | Admissions board `src/app/admissions/page.tsx` (status lists); student directory filters status/programme/handoff and `q` (`src/server/students.ts:105-113`); leads filters q/status/flag (`src/server/leads.ts:498-521`). No batch, course, counsellor or date-range filter on one landing page. |
| Tabs Current / Upcoming / Previous demos / Active / Past-On-hold | Missing | `/ops/schedule` lists counselling and demos by date (`src/server/schedule.ts:398+`). |
| Counts from real records; empty/loading/error states; pagination | Partial | Frame/Section/load helpers give loading/empty/error (`src/ui/frame.tsx:141-171`); pagination exists on the student directory and in `src/ui/hr-records.tsx` (`Pager`, `FilterForm`). |

### 3.3 Section 4.2 and 4.3: three-class demo and fixtures

| Requirement | Status | Evidence / notes |
|---|---|---|
| Configurable demo count, default 3, `proposed` | **Conflict** | `demo.terms.days = 2`, state `approved`, `editable: false`, source legacy D-003/D-004, "the earlier 3-day demo is superseded" (`src/domain/policies.ts:224-239`). Enforced as exact count (`src/server/schedule.ts:214-215`). Needs an owner decision. `demo.limits` (open, OD-012) is separate (:253-262). |
| N session records per demo | Missing | One `ops.demos` row with `day_dates date[]` (`ops.ts:708`). No `demo_sessions` table. |
| Session number, date/time + timezone, subject/course/programme, assigned teacher | Missing | Dates only, no times; `subjects text[]` per demo (:706); teachers per demo in `ops.demo_teachers` (:743-757), not per session. |
| Attendance status scheduled/present/absent/rescheduled/cancelled/not_recorded | Missing | Demo-level `scheduled|attended|missed|cancelled` (:709). |
| Actual timestamp or authorised manual update | Partial | `completed_at` on the demo (:722) set by `updateDemo` (`src/server/schedule.ts:322-397`). |
| Notes/topics; mock planned/prepared status; mock score only from a real assessment | Missing | Only `notes` text on the demo. No mock fields; no link to `academic.attempts`. |
| Follow-up + exception reason; updated by + audit timestamp | Partial | Follow-ups exist per admission (`ops.follow_ups` :596-643); demo changes are audited in `core.audit_events`. |
| "2 of 3 classes completed"; cancelled/scheduled never counted | Missing | No per-session data to count. |
| Attendance correction keeps previous value, actor, reason, new value | Missing | Status is updated in place; only the generic audit row records before/after. A demo that is no longer `scheduled` cannot be changed at all (`schedule.ts:344-345`). |
| Teacher notification on scheduling | Implemented | In-app `notify` to linked teacher users (`schedule.ts:284-293`); `demo_teachers.notified_at`. This is a real in-app record, not an email. |
| Fixture "Tanisha Demo Student (fictional)" + 6 other fixtures, labelled SAMPLE DATA | Missing | Seeds have 4 fictional pipeline leads (`seed/samples.ts`) and 2 fictional admissions with 3 fee records (`seed/admissions-samples.ts`). No demo session fixtures. |

### 3.4 Sections 5 and 5.1: demo lists and drawer

| Requirement | Status | Evidence / notes |
|---|---|---|
| Current / Upcoming / Previous demo lists with the listed columns | Missing | None of the columns attendance x/3, mock status, checklist progress, next class, outcome exist. |
| Right-side drawer (backdrop, Escape, focus trap/return, mobile sheet, deep link) | Missing | No drawer component in `src/ui` or `@elevate/shared-ui` usage. Detail pages are full routes (`/ops/admissions/[id]`, `/ops/leads/[id]`, `/ops/students/[id]`). |
| Drawer sections (overview, attendance, mock, checklist, feedback, teachers, counselling, timeline, convert) | Missing | Admission detail page shows pipeline, checks, fee approval, fees, enrolment (`src/app/admissions/[id]/page.tsx`). |

### 3.5 Section 6: checklist, conversion, admission numbers

| Requirement | Status | Evidence / notes |
|---|---|---|
| Checklist items with complete/pending/waived-with-reason/not-applicable | Partial | `ops.admission_checks` (`ops.ts:571-593`): 10 fixed items (`ops.ts:151-162`: admission form, documents, two fee verifications, down payment, kit, communication group, timetable, school and hostel coordination); statuses `done|not_done|not_applicable`. No waiver with reason. |
| Checklist history kept | Partial | Upsert overwrites the row (`src/server/admissions.ts:574-580`); the previous value survives only in `core.audit_events` (:582-591). |
| Brief's demo checklist items (sessions 1-3, mock, programme & batch discussed, fee explained, instalments, admission process, student/guardian feedback, next action, conversion decision) | Missing | None of these item keys exist. |
| Required-items policy as a proposed setting | Partial | `admission.confirmation` (proposed) toggles documents and down payment only (`src/domain/policies.ts:275+`). |
| Convert-to-Admission wizard (identity check, programmes, batches/"to be assigned", effective date, fee plan, discount + approval, guardian confirmation, checklist summary, number preview) | Missing | Conversion today = status transitions `admission_pending → admitted` through the gate (`src/domain/admission-readiness.ts:85-116`), then `requestEnrolment` publishes `ops.admission.enrolment_requested` v1 (`src/server/enrolment.ts`). Intended course/batch are plain UUIDs on the admission (`ops.ts:476-477`). |
| One transaction: create/link canonical student, admission record, handoff event; demo outcome = converted | Partial | Handoff event is published in the same transaction as the status change (A-15). No student creation in Ops; no demo outcome field. |
| Admission number: automatic, DB-backed, concurrency-safe | Partial | `ADM-######` via `nextCode` under `pg_advisory_xact_lock` + `max()` (`src/server/context.ts:63-82`), unique index `admissions_code_key` (`ops.ts:506`), format check (:513). But it is assigned when the case opens at lead creation (`src/server/pipeline.ts:46-56`), so every lead has one. |
| Format/prefix/year as a proposed setting | Missing | Format is hard-coded in `src/domain/registers.ts:8-28`. |
| Manual entry only for authorised roles with reason, actor, timestamp, previous/new value | Missing | No override path, permission or history table. |
| Collision → safe error, no partial conversion | Partial | Unique index + transaction would roll back; no explicit collision message for a manual number. |
| Admission appears in Active only when admission + enrolment statuses are satisfied | Partial | Directory state is derived from admission status and handoff (`src/domain/students.ts:33-49`). |

### 3.6 Sections 7 and 8: active students, search, profile

| Requirement | Status | Evidence / notes |
|---|---|---|
| Canonical student identity | **Missing** | No `core.students`. Academic owns `academic.students` (`packages/database/src/schema/academic.ts:736-772`), one per admission (unique `source_admission_id`). Ops keeps `ops.admissions.student_id` as a plain UUID (`ops.ts:487`). `existingStudentId` is sent (`src/server/enrolment.ts:157`) and ignored by Academic (no match in `apps/academic-os/src`; IR-OPS-ADM-1 open). |
| Admission no. in list | Partial | Case code `ADM-######` shown. |
| SSRN only if confirmed | Missing | No field anywhere (grep: 0 matches). The brief's rule "omit/flag until confirmed" is met by default, but the field and its confirmation flag do not exist. |
| Programmes & batches (many-to-many, dates, status, change history) | Partial | One programme per admission case (`admissions_one_open_per_programme`, `ops.ts:507-509`); several cases per lead are allowed. Batch participation is Academic's `academic.enrolments` (`academic.ts:774-833`, statuses `active|paused|withdrawn|completed` at :138); Ops stores only `enrolled_course_id`/`enrolled_batch_id` from the reply. No read contract for a student's enrolment list. |
| Catalogue options CLAT, IPMAT, IIMB UG-AT, CUET, Regular 11, Regular 12, Dropper/Repeater, CA/Commerce; data-driven | Partial | `core.programmes` seeds CLAT, IPMAT (description mentions IIMB UG-AT), CUET, COMMERCE_11_12, CA_FOUNDATION (planned) (`packages/database/src/seed/core-seed.ts:34-55`). Regular 11/12 and Dropper exist only as `academic.batches.route` values (`academic.ts:97-102`). Exam type is free text `academic.batches.target_exam`. |
| Enrolment status, counsellor, teachers/subjects summary | Partial | Handoff status and counsellor shown; teachers come from Academic `teacher_assignments` (`academic.ts:466-499`) with no Ops read. |
| Latest assessment, attendance/progress from Academic OS | Missing | Only a link to `/academic/students/{id}` (`src/domain/students.ts:171`). No contract. |
| Fee status paid/due/overdue/not configured | Partial | Fee summary from `ops.fee_records` (`src/domain/fees.ts`) on the profile; no overdue (no instalment due dates beyond `due` records). |
| Missing = unknown, never zero | Implemented (pattern) | `metric.missing`/`SourceResult` used in reports; must be carried into new lists. |
| Search by name, admission no., SSRN, student phone, guardian phone, emails, course/batch | Partial | Students: name, admission code, lead code (`src/server/students.ts:107-113`). Leads: name, code (`src/server/leads.ts:518-521`). No phone/email search (indexes exist on lead phones/emails, `ops.ts:319-323`). |
| Contact lookups only for authorised staff; masked phones in lists; audit sensitive lookups/exports | Partial | Private fields are removed unless `ops:student_private:read` (`src/domain/students.ts:176-212`, `src/server/leads.ts:154-156`). Removal, not partial masking. Lookups are not audited. |
| Profile full route + drawer | Partial | Full route `/ops/students/[id]` (Implemented, screen not browser-tested); no drawer. |
| A Overview, demo conversion history, next action, flags | Partial | Admission history with coded reasons, enquiries, counselling, demos, handoff (`src/server/students.ts` profile, history at :359). |
| C Academic results with comparable averages and coverage | Missing | Needs an Academic contract. |
| D Attendance (Academic) + demo attendance (Ops) with freshness | Missing | — |
| E Fees: plan ref, paid, outstanding, instalments, overdue, discounts/waivers/refunds as separate ledger events, receipts, recorder, "manually recorded, not verified" | Partial | Ledger-like `ops.fee_records` (`ops.ts:769-843`): kinds `due|received|refund|adjustment` (credit/debit), integer paise, receipt ref, recorder, optional verification by another person, void with reason, labelled "manually recorded" (A-17). No fee plan, no instalment schedule, no discount/waiver kinds (adjustment only), no chart. `fees.schedule` is a reference text setting. |
| F Guardians: multiple, relationship, contact preference, consent; restricted | Partial | One guardian as columns on the lead (`ops.ts:291-294`); consent and channel preferences per lead (`ops.contact_preferences`, `ops.ts:902-933`); restricted by `ops:student_private:read`. Not multiple. |
| G Upcoming items | Partial | Follow-ups and scheduled counselling/demos exist; not gathered on the profile as "upcoming". |
| H Feedback teacher→student and student/parent→teacher | Missing | No feedback tables (only HR interview feedback, `ops-lifecycle.ts:344-375`). |
| I Generate Student Report (print-ready, role-based fields, export audit) | Missing | No PDF/print code in the module (the only exports are HR CSVs). |
| J Activity timeline from audit/event source | Partial | `admission_transitions` (append-only, `ops.ts:533-569`), `lead_activities`, and `core.audit_events` via `auditTrail` (`src/server/ops-common.ts:68`, used today only by SOPs, tasks, policies). |

### 3.7 Section 9: past / inactive

| Requirement | Status | Evidence / notes |
|---|---|---|
| Statuses active, on_hold, withdrawn, completed, transferred, cancelled_before_enrolment, other_inactive (proposed) | Missing | Pipeline has `lost` (with reason codes from `admissions.closure_reasons`, proposed, `src/domain/policies.ts:498-524`) and `on_hold`. |
| Last programme/batch, admission & exit dates, reason, who/when, exit and guardian feedback, pending fee/refund refs, follow-ups, reactivation + approver, full status history | Missing | Only transition history and closure codes. |
| Never physically delete | Implemented (pattern) | `onDelete: 'restrict'` on history FKs; fee records voided not deleted. |
| Past demos (never enrolled) separate from former admitted students | Partial | Directory separates admitted states; past demos are not listed. |

### 3.8 Section 10: Marketing lead handoff

| Requirement | Status | Evidence / notes |
|---|---|---|
| Idempotent contract with stable lead id, source, campaign, permitted contacts, course interest, consent, capture time, source ref | Missing | `marketingEvents = []` (`packages/shared-contracts/src/modules/marketing.ts:19`); Marketing has no lead or enquiry table (`marketing.ts` schema). MKT-036 / IR-MKT-05 propose `marketing.enquiry.captured` v1, not built. |
| Duplicate detection → review | Implemented (manual entry) | A-01/A-02, `ops.duplicate_flags` (`ops.ts:413-453`); merge only by explicit review. |
| Handoff received/failed/retried statuses | Missing | No receipt table. |
| "Convert to Demo" when authorised | Partial | Demo booking exists after counselling (`schedule.ts:249-252`). |
| Attribution preserved | Partial | `ops.enquiries.campaign_ref`/`content_ref` text (`ops.ts:369-370`) on manual entry. |
| Contract/adapter tested with mock events, labelled "live sync not configured" | Mock-only (other) | `src/server/adapters/crm.ts` is a CRM import mock reporting `not_configured` (OPS-026), not a Marketing adapter. |

### 3.9 Section 11: counselling and PTM

| Requirement | Status | Evidence / notes |
|---|---|---|
| Appointment types (student, guardian, teacher academic counselling, PTM, admission follow-up/demo review) | Missing | `ops.counselling_sessions` (`ops.ts:645-692`) has no type column. |
| Student, teacher/counsellor, guardian participants, organiser | Partial | One `counsellor_staff_id`; `attendees` enum `student|parent|both` (:663). Admission is required (`admission_id NOT NULL`), so no PTM for enrolled students outside a case. |
| Date/start/end/timezone, location/mode | Partial | `scheduled_at` only (:657); mode `in_person|phone|video` (:662). No end time, no timezone column, no location. |
| Status proposed/scheduled/confirmed/completed/cancelled/rescheduled | Partial | `scheduled|completed|no_show|cancelled` (:664, check :682). |
| Reminders, outcome + follow-ups, audit | Partial | Outcome, objections, next step, audit; follow-up rules after counselling (`src/domain/follow-ups.ts`). No reminder status. |
| Double-booking prevention | Missing | `scheduleCounselling` checks the counsellor is active only (`schedule.ts:50-105`). |
| Teacher picked by subject/programme expertise | Missing | No expertise data on staff. |
| Teacher notification (labelled simulated if mock) | Partial | Done for demos (in-app), not for counselling. |
| Calendar + list views, reschedule/cancel, profile timeline | Partial | `/ops/schedule` list by date; cancel exists; no reschedule history. |

### 3.10 Section 12: teachers

| Requirement | Status | Evidence / notes |
|---|---|---|
| Canonical staff model, no second teacher table | Implemented (base) | `core.staff_members` (`packages/database/src/schema/core.ts:161-195`), Ops is steward (`src/server/organisation.ts`). Fields: name, user link, department, title, manager, status. `ops.staff_profiles` adds employment type and role labels (`ops.ts:1082-1112`). |
| Seed 7 named teachers as UNVERIFIED | Missing | Core seed has one fictional user per role (`core-seed.ts:57-140`); Ops seeds 2 fictional staff (`seed/reference.ts`). |
| Display name, staff ref, subjects/programme expertise, batches, workload, feedback summary, appointments, history | Partial | No display name, no staff code, no expertise. Batches/subjects per teacher exist in Academic `teacher_assignments`. Workload today counts tasks + follow-ups (`src/domain/staff.ts:80-135`). |
| `teacher_student_feedback` and `student_teacher_feedback` distinct | Missing | — |
| Accountancy/CA as a subject capability with no teacher | Missing | — |

### 3.11 Sections 14 to 19 (cross-cutting)

| Requirement | Status | Evidence / notes |
|---|---|---|
| Role restriction of guardian contacts, finance, reports | Partial | `ops:student_private:read`, `ops:fees:read`; no report export permission. |
| Audit sensitive search/export | Missing | — |
| Reports: Admissions Funnel, Demo Conversion, Student Summary | Partial | Admissions report with 11 KPIs (`src/server/reports/admissions.ts`, `src/domain/admissions-kpis.ts`; OPS-078). No demo conversion (no demo outcome), no student summary report. |
| KPI cards that filter the list (current demos, upcoming demos, pending follow-ups, conversions this period, admissions pending decision) | Missing | Dashboard KPIs are K-01/K-06/K-10/K-14/K-15/K-19 + workload (`src/server/dashboard.ts`). |
| Append-only history for status changes, number overrides, attendance corrections, approvals, financial adjustments | Partial | Status changes (`admission_transitions`), approvals (`core.approvals`), fee voids. Not: number overrides, attendance corrections, checklist. |
| Brief's test list (section 19) | Partial | Covered today: duplicate contacts → review, search by name/admission no., unauthorised cannot see guardian/finance, missing fees not zero, conversion once (handoff idempotent). Not covered: everything about sessions, numbers, feedback, appointments, Marketing handoff, PDF. |

---

## 4. Deletion manifest: HR and Operations

Owner instruction (brief, session rules): delete the existing HR and Operations features, keep what admissions needs (staff/teacher identity in `core.staff_members`, settings with proposed policies, core approvals, follow-ups, tasks only if follow-ups need them). Everything is recoverable from git.

**Finding that shapes the manifest:** follow-ups do **not** use tasks. `ops.follow_ups` (`ops.ts:596-643`) and `src/server/follow-ups.ts` import nothing from tasks; `runFollowUpReminders` is self-contained. No admissions, leads, students, fees, counselling or demo file imports tasks, SOPs, decisions, risks, projects, incidents, policies register, responsibilities or any HR module (import graph checked for every file in `src/server`, `src/domain`, `src/app`). Tasks can therefore be deleted completely.

### 4.1 Pages (`apps/business-ops-os/src/app/`)

| Path | Action | Why |
|---|---|---|
| `hr/**` (32 files: attendance, compensation, departments, employees, leave, offboarding, onboarding, recruitment, shifts, timesheets and their `_components`) | DELETE | HR. |
| `tasks/page.tsx`, `tasks/[id]/page.tsx` | DELETE | Operations (tasks). |
| `sops/page.tsx`, `sops/[id]/page.tsx` | DELETE | Operations (SOPs). |
| `decisions/page.tsx`, `risks/page.tsx`, `projects/page.tsx`, `incidents/page.tsx` | DELETE | Operations registers. |
| `operations/assets/page.tsx`, `operations/assets/[id]/page.tsx` | DELETE | HR assets. |
| `settings/policies/page.tsx`, `settings/policies/[id]/page.tsx` | DELETE | Policies & compliance register (Operations). Not the same thing as `/ops/settings`. |
| `reports/hr/page.tsx`, `reports/operations/page.tsx` | DELETE | HR and Operations reports. |
| `operations/approvals/page.tsx` | KEEP minimal | After trimming the sources it lists only fee arrangements awaiting approval (admission decisions). Consider moving it under Admissions (`/ops/admissions/approvals`) in Chunk 1. |
| `page.tsx` (dashboard) | KEEP, edit | Imports `server/reports/operations` (operations panel) — remove that panel; keep admissions KPIs and cross-module panels. |
| `reports/page.tsx` | KEEP, edit | Remove the HR and Operations entries from `REPORTS`. |
| `staff/page.tsx`, `staff/[id]/page.tsx` | KEEP, edit | Staff directory (teachers need it). Remove links to `/ops/hr/employees` and `/ops/hr/departments`, the `EMPLOYMENT_TYPES` import from `domain/hr/employees`, onboarding checklist and responsibilities sections. Move department create/edit here (the form lives on `hr/departments` today). |
| `settings/page.tsx` | KEEP, edit | Remove HR/task/incident setting groups (follows the settings trim in 4.3). The CRM adapter panel goes if the CRM mock is deleted (section 5). |
| `admissions/**`, `leads/**`, `students/**`, `schedule/page.tsx`, `reports/admissions/page.tsx`, `login`, `layout.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx` | KEEP | Admissions and shell. |

### 4.2 API routes (`apps/business-ops-os/src/app/api/v1/`)

| Path | Action | Why |
|---|---|---|
| `hr/**` (75 route files) | DELETE | HR. |
| `tasks/**` (11), `escalations/[id]` (1) | DELETE | Tasks and task escalations. |
| `sops/**` (11) | DELETE | SOPs. |
| `decisions/**` (2), `risks/**` (4, incl. mitigations), `projects/**` (4, incl. `blocked`, `[id]/milestones`), `milestones/[id]` (1), `work-inventory` (1), `incidents/**` (2) | DELETE | Operations registers. |
| `responsibilities/**` (2), `onboarding-items/[id]` (1), `staff/[id]/onboarding` (1) | DELETE | Operations responsibilities and staff onboarding checklist (HR-type). |
| `organisation/chart` (1), `departments/[id]/heads` (1) | DELETE | Use `server/hr/org-history` (department heads, org chart). |
| `settings/policies/**` (5) | DELETE | Policies register. |
| `reports/operations` (1) | DELETE | Operations report. |
| `jobs/[job]/route.ts` | KEEP, edit | Keep `follow-up-reminders` and `enrolment-replies`; remove `task-escalations`, `task-reminders`, `attendance-missing-clock-out`, `lifecycle-reminders`, `separations` (and their imports, lines 5-9). Trim `OPS_JOBS` in `server/schemas.ts:430-438`. `tests/integration/admissions.test.ts` and `dashboard.test.ts` call this route. |
| `operations/approvals/route.ts` | KEEP minimal | Fee-arrangement inbox only. |
| `organisation/route.ts`, `staff/route.ts`, `staff/[id]/route.ts`, `departments/route.ts`, `departments/[id]/route.ts` | KEEP | Staff directory and departments (core steward). Trim responsibilities from the organisation response. |
| `settings/route.ts`, `settings/[key]/route.ts`, `dashboard/route.ts` | KEEP | Settings (proposed policies) and dashboard. |
| `admissions/**`, `fees/**`, `students/**`, `leads/**`, `lead-sources`, `follow-ups/**`, `counselling/**`, `demos/**`, `schedule`, `auth/**`, `health` | KEEP | Admissions. |

### 4.3 Domain (`src/domain/`)

| Path | Action | Why |
|---|---|---|
| `hr/**` (13 files) | DELETE | HR rules. |
| `tasks.ts`, `escalation.ts`, `sops.ts`, `legacy.ts` | DELETE | Tasks, escalation, SOP lifecycle, legacy import of decisions/work inventory/SOPs/responsibilities. |
| `registers.ts` | KEEP minimal | Keep `CODE_FORMATS` (lead, admission, fee), `formatCode`, `parseCodeNumber`; delete decision-log, risk, project, milestone, incident, mitigation and policy-register sections (:45-366). |
| `kpis.ts` | KEEP minimal | Keep `newLeads`, `leadToAdmissionConversion`, `latestElapsedCohortWeek`, `followUpCompliance`, `pointCount`; delete task/risk/capacity/SOP/deadline functions (:143-346). `overdueWork` becomes follow-ups only. |
| `staff.ts` | KEEP minimal | Keep `checkReportingLine` (uses `graph.ts`); delete responsibilities gaps and `DEFAULT_ONBOARDING_ITEMS`; `workloadPerStaff` drops the task input. |
| `graph.ts` | KEEP | Cycle check used by `staff.ts` reporting lines. |
| `policies.ts` | KEEP minimal | Settings with decision states. Delete keys `tasks.escalation`, `tasks.reminders`, `hr.candidate_retention`, `hr.onboarding_template`, `hr.offboarding_checklist`, `attendance.rules`, `shifts.rules`, `leave.rules`, `leave.entitlements`, `incidents.resolution_sla`, `registers.review_due`, `hr.document_retention`, `office.online_hours` (only used by the HR time seed). Keep `demo.*`, `pipeline.demo_skip`, `admission.confirmation`, `followups.due_rules`, `kpi.conversion`, `admissions.closure_reasons`, `fees.recording`, `fees.schedule`. |
| `index.ts` | KEEP, edit | Remove re-exports of the deleted files. |
| `pipeline.ts`, `admission-readiness.ts`, `admissions-kpis.ts`, `contacts.ts`, `dates.ts`, `fees.ts`, `follow-ups.ts`, `students.ts` | KEEP | Admissions. |

### 4.4 Server (`src/server/`)

| Path | Action | Why |
|---|---|---|
| `hr/**` (21 files) | DELETE | HR services, approval sources, separation wiring. |
| `hr-scope.ts` | DELETE | HR record scope; used only by HR and `staffPresentToday`. |
| `tasks.ts`, `escalations.ts`, `sops.ts`, `planning.ts`, `incidents.ts`, `policies-register.ts`, `work-schemas.ts` | DELETE | Operations. |
| `reports/hr.ts`, `reports/hr-records-metrics.ts`, `reports/hr-lifecycle-metrics.ts`, `reports/hr-time-metrics.ts`, `reports/operations.ts` | DELETE | HR and Operations reports. |
| `adapters/attendance-provider.ts`, `adapters/document-storage.ts` | DELETE | Used only by HR (checked: no non-HR importer). |
| `approvals.ts` | KEEP minimal | Keep `ApprovalSource` model, `feeArrangementSource`, `listApprovalInbox`. Delete SOP, SOP-review, task-review, policy-version sources and the `HR_APPROVAL_SOURCES` import (:31-35). The platform overview calls `listApprovalInbox`. |
| `approval-policies.ts` | KEEP minimal | Keep `feeArrangementPolicy`; delete `sopApprovalPolicy`. |
| `organisation.ts` | KEEP, edit | Staff directory, core steward. Remove imports of `opsEmployeeRecords`, `opsOnboardingItems`, `opsResponsibilities`, `historyChanges`, `runDeactivationHook`, `writeHistory`, `./hr/wiring` (:8-31); remove responsibility and onboarding functions (:296-445) and `employeeCode` in staff detail (:377-384). Staff deactivation then no longer publishes `ops.employee.separated` (see 4.9). |
| `dashboard.ts` | KEEP, edit | Remove `opsTasks`/`opsRisks` queries and task/blocker KPIs (:13-14, :78-86, :142-145). |
| `reports/overview.ts` | KEEP, edit | Remove `staffPresentToday` (:75-110) and the `opsAttendanceSessions`/`opsShiftAssignments`/`hr-scope` imports (:21-24, :32). Keep `countOpenLeads`, `countAdmissionsByStatus`, `openFollowUpsForOverview`. |
| `schemas.ts` | KEEP minimal | Delete task, escalation, responsibility, onboarding, SOP, incident, decision, risk, project, milestone schemas (:232-427); trim `OPS_JOBS`. |
| `ops-common.ts` | KEEP minimal | `versionApprovals` (:86-98) is used only by SOPs and policies — delete. |
| `index.ts` (barrel `@elevate/business-ops-os/server`) | KEEP, edit | Remove HR exports, `runTaskEscalations`, `runTaskReminders`, `buildOperationsReport`, HR metrics, `staffPresentToday`, `listTasks`, `TASK_STATUS_LABELS`, attendance provider, `insertEmployee`, `changeEmploymentStatus`, `registerDeactivationHandler`, `APPROVAL_SOURCES` (keep `listApprovalInbox`). |
| `adapters/crm.ts` | Candidate DELETE (section 5) | Not HR/Ops; admissions extra. |
| `admissions.ts`, `admissions-schemas.ts`, `enrolment.ts`, `fees.ts`, `follow-ups.ts`, `leads.ts`, `pipeline.ts`, `schedule.ts`, `students.ts`, `settings.ts`, `summaries.ts`, `context.ts`, `options.ts`, `paths.ts`, `auth.ts`, `reports/admissions.ts` | KEEP | Admissions and shared helpers. |

### 4.5 UI (`src/ui/`)

| Path | Action | Why |
|---|---|---|
| `hr-records.tsx` | KEEP, rename | Generic `FilterForm`, `Pager`, `options`, `hrTone`. Staff pages use it and the admissions lists need filters and pagination. Rename to `list-controls.tsx` and drop `hrTone`. |
| `frame.tsx` | KEEP, edit | NAV (:26-63): delete the "People" group except Staff directory, the whole "Time & leave" group, the "Operations" group except Approvals, and the "Policies & compliance" settings entry; `myWorkHref` (:121) points to `/ops/tasks` — remove. |
| `action-form.tsx`, `cross-module.tsx`, `format.ts`, `lead-create-form.tsx`, `README.md` | KEEP | Shared. |

### 4.6 Seeds (`apps/business-ops-os/seed/`)

| Path | Action | Why |
|---|---|---|
| `hr-records.ts`, `hr-lifecycle.ts`, `hr-time.ts` | DELETE | HR fixtures. |
| `legacy.ts` | DELETE | Imports 24 legacy decisions, 25 work items, 51 SOPs, 12 responsibilities — all Operations. |
| `samples.ts` | KEEP minimal | Keep `ops.sample-pipeline`; delete `ops.sample-tasks`. |
| `sample-placeholders.ts` | KEEP minimal | Keep the `fees.schedule` sample setting only; delete shift templates, holidays, leave types and draft policies (it imports `server/hr/leave`, `server/hr/shifts`, `server/hr/time-schemas`, `server/policies-register`, `server/work-schemas`). Drop `dependsOn: 'ops.hr-time'`. |
| `reference.ts`, `admissions-samples.ts`, `index.ts` | KEEP (edit `index.ts`) | Lead sources, fictional staff, admissions samples. |
| `data/legacy/ops/*.json` (repo root) | KEEP | Read-only legacy extracts owned by the legacy-data wave; no longer loaded once `seed/legacy.ts` goes. Removing them is an owner choice, not part of this change. |

### 4.7 Tests

| Path | Action | Why |
|---|---|---|
| `tests/integration/hr-*.ts` (13 files incl. `hr-lifecycle-fixtures.ts`, `hr-records-fixtures.ts`, `hr-time-fixtures.ts`) | DELETE | HR. |
| `tests/integration/operations-*.ts` (5 files incl. `operations-fixtures.ts`), `sops.test.ts`, `tasks.test.ts` | DELETE | Operations. |
| `tests/unit/hr-lifecycle-domain.test.ts`, `hr-records-domain.test.ts`, `hr-time-domain.test.ts`, `operations-domain.test.ts`, `tasks-escalation.test.ts`, `legacy.test.ts` | DELETE | HR / Operations. |
| `tests/integration/organisation-planning.test.ts` | KEEP, rewrite | Keep staff, departments and settings cases; delete responsibilities, decisions, risks, projects, milestones, incidents, work-inventory, onboarding cases. Imports `operations-fixtures` and `seed/legacy` today. |
| `tests/unit/sops-staff-policies.test.ts` | KEEP, rewrite | Keep reporting-line and settings cases; delete SOP cases. |
| `tests/unit/kpis.test.ts` | KEEP, trim | Delete task/blocker KPI cases. |
| `tests/integration/dashboard.test.ts`, `seeds.test.ts`, `sample-placeholders-seed.test.ts` | KEEP, edit | Expectations include tasks, legacy registers, shifts, leave types, policies. |
| Admissions, leads, fees, students, report, routes, contacts, pipeline, follow-ups tests | KEEP | Unaffected (checked imports). |
| `apps/platform/tests/integration/access-revocation.test.ts`, `separation-access.test.ts` | DELETE | HR separation. |
| `apps/platform/tests/integration/overview.test.ts` | KEEP, edit | Uses `hr_manager`/`employee` roles and the `staffPresent` widget (:163, :372-384). |
| `apps/platform/tests/integration/admin-users.test.ts` | KEEP, edit | Uses role `employee` as a sample role (:69-294); switch to a role that stays. |
| `packages/authorization/tests/authorization.test.ts` | KEEP, edit | Cases at :103-114 reference `ops:compensation:approve`, `ops:policies:approve`, `department_manager`. |

### 4.8 Schema and tables

| Item | Action | Why |
|---|---|---|
| `packages/database/src/schema/ops-hr.ts` (11 tables: employee_records, assets, asset_assignments, employment_history, department_heads, employee_private_details, emergency_contacts, employee_documents, employee_identity_references, compensation_records) | DELETE | HR. |
| `ops-lifecycle.ts` (requisitions, candidates, job_applications, job_application_stages, interviews, interview_panelists, job_offers, lifecycle_cases, lifecycle_items) | DELETE | HR. |
| `ops-time.ts` (shift_templates, shift_assignments, holidays, attendance_imports, attendance_sessions, attendance_breaks, attendance_corrections, leave_types, leave_requests, leave_ledger_entries) | DELETE | HR. |
| `ops-work.ts` (task_comments, task_references, task_review_requirements, task_reviews, task_reminders, sop_version_schedules, sop_archives, sop_ack_requirements, sop_acknowledgements, risk_mitigations, policies, policy_versions) | DELETE | Operations. |
| `ops-columns.ts` | DELETE | Helpers used only by the four files above; `ops.ts` defines its own copies (`ops.ts:84-100`). |
| `ops.ts` tables `tasks`, `task_dependencies`, `escalations`, `responsibilities`, `onboarding_items`, `sops`, `sop_versions`, `sop_checklist_items`, `incidents`, `decisions`, `risks`, `projects`, `milestones`, `milestone_dependencies`, `work_items` (`ops.ts:938-1533` except staff_profiles) | DELETE | Operations. Also delete the constants `OPS_TASK_STATUSES`, `OPS_TASK_PRIORITIES`, `OPS_SOP_STATUSES`, `OPS_SOP_VERSION_STATUSES`, `OPS_DECISION_LOG_STATES`, `OPS_LEVELS` and the branded ids of deleted tables. |
| `ops.ts` table `staff_profiles` (`:1082-1112`) | KEEP | Ops extension of `core.staff_members`; the natural home for teacher display name, staff ref and subject expertise (section 6). |
| `ops.ts` admissions tables (settings, lead_sources, leads, enquiries, lead_activities, duplicate_flags, admissions, admission_transitions, admission_checks, follow_ups, counselling_sessions, demos, demo_teachers, fee_records, enrolment_attempts, contact_preferences) | KEEP | Admissions. |
| `schema/index.ts` (`SCHEMA_MODULES` and re-exports), `packages/database/drizzle.config.ts` (`schema:` list, lines 15-18) | KEEP, edit | Remove the four ops-* files. |
| `core.departments`, `core.staff_members` | KEEP | Steward role stays with Ops (teachers). |
| `TaskId` in `packages/shared-types/src/ids.ts` | KEEP | Academic uses it (`apps/academic-os/src/server/services/progress.ts`, `academic.ts`). |

**51 ops tables** go in total (36 from the four split files, 15 from `ops.ts`).

### 4.9 Permissions, roles, events, platform

| Item | Action | Why / who else uses it |
|---|---|---|
| Permission keys `ops:tasks:*`, `ops:sops:*` (incl. `acknowledge`), `ops:incidents:*`, `ops:decisions:*`, `ops:risks:*`, `ops:policies:approve` | DELETE | Operations. |
| Permission keys `ops:employees:*`, `ops:employee_private:*`, `ops:employee_documents:*`, `ops:compensation:*`, `ops:assets:*`, `ops:recruitment:*`, `ops:lifecycle:*`, `ops:attendance:*`, `ops:shifts:*`, `ops:leave:*`, `ops:hr_reports:*` | DELETE | HR. `SENSITIVE_RESOURCES` (`permissions/ops.ts:205-210`) shrinks to `student_private`. |
| Remaining keys (18): `ops:module:access`, `dashboard:read`, `leads:read/write/assign/merge`, `admissions:read/write/approve`, `organisation:read/manage`, `settings:read/manage`, `jobs:run`, `fees:read/record`, `students:read`, `student_private:read` | KEEP | Admissions + staff directory + settings. |
| Roles `hr_manager`, `hr_contributor`, `recruiter`, `department_manager`, `employee` | DELETE | Defined in `packages/shared-types/src/roles.ts:17-24`, `packages/authorization/src/roles.ts:48-72`, granted in `permissions/ops.ts:259-375` and `permissions/platform.ts:77-97`. Other users: platform tests only (listed in 4.7). No seed user holds them (`core-seed.ts:57-140`). Stale `core.user_roles` rows are ignored at sign-in (`packages/authentication/src/sessions.ts:71` filters with `isRoleKey`) but should be removed by the migration. |
| Role `finance_officer` | KEEP minimal (owner decision) | Today holds compensation (delete) and `ops:fees:read/record` + `ops:admissions:read` (keep). Fee plans and the ledger need a finance role; re-describe it as "fee records". If the owner prefers, delete it and rely on `operations_manager`. |
| Role `teacher` Ops grant (`own` tasks, `permissions/ops.ts:250`) | DELETE | Tasks go. Teachers get Ops grants again in Chunk 6/7 (feedback, appointments). IR-OPS-01 becomes moot until then. |
| `operations_manager`, `admissions_counsellor`, `director` grants | KEEP, trim | Remove deleted keys (`admissions_counsellor` loses `own` tasks, `sops:read/acknowledge`, `employees:read`; `director` loses `sops:approve`, `decisions:write`, `recruitment:decide`, `lifecycle:approve`, `policies:approve`, `sops:acknowledge`). |
| `packages/shared-contracts/src/modules/ops-hr.ts` (`ops.employee.separated` v1, `PLATFORM_ACCESS_REVOCATION_CONSUMER`, `hrLifecycleKeys`) | DELETE | HR event. `modules/ops.ts` stops re-exporting it; `opsEvents = []`. |
| `apps/platform/src/server/access-revocation.ts`, `apps/platform/src/app/api/v1/jobs/access-revocations/route.ts` | DELETE | Only consumer of `ops.employee.separated`. |
| `apps/platform/src/server/overview-adapter.ts` | KEEP, edit | Remove `staffPresentToday` (staff present tile, :166-190), the attendance-corrections row (:280-281), `listTasks`/`TASK_STATUS_LABELS` (team priorities, :449-500). Keep enquiries, admissions pipeline, follow-ups, approvals (fee arrangements), Academic and Marketing widgets. |
| `apps/platform/src/app/page.tsx` | KEEP, edit | Links to `/ops/tasks` (:135-136, :196, :370) and the "Team priorities" card (:193, :350). |
| Notifications | Nothing to delete in code | `core.notifications.kind` is free text (`packages/notifications/src/in-app.ts:10`). HR/task kinds stop being produced. Existing rows linking to `/ops/hr/…`, `/ops/tasks/…`, `/ops/sops/…` become dead links (see 4.10). |
| `docs/SECURITY_AND_PERMISSIONS.md` | Regenerate | `npm run docs:permissions` after the permission change. |

### 4.10 Migration impact

- **Where the tables are:** all 51 HR/Operations tables are created in `packages/database/migrations/0000_baseline.sql`. `0001_users_email_domain.sql` contains one statement (a CHECK on `core.users.email`) and **no HR tables** (the brief says otherwise; see section 7).
- **What the removal needs:** a new migration `0002_…` generated by `npm run db:generate` after the schema files change (never edit 0000/0001, AGENTS rule 10). drizzle-kit will emit `DROP TABLE "ops"."…" CASCADE` for the 51 tables. Order matters only if written by hand: drop `ops-work` side tables, then `escalations`, `task_dependencies`, `tasks` (FKs to `sops`, `decisions`, `projects`), `risks` (FK to tasks/projects), `milestone_dependencies`, `milestones`, `projects`, `sop_checklist_items`, `sop_versions`, `sops`, `incidents`, then the HR tables (`lifecycle_items` → `lifecycle_cases` → `job_offers` … → `employee_records`).
- **Data clean-up statements to add by hand to the same migration** (data, not schema): `DELETE FROM core.user_roles WHERE role IN ('hr_manager','hr_contributor','recruiter','department_manager','employee')`; `DELETE FROM ops.settings WHERE key IN (…deleted keys…)` (unknown keys are ignored by `resolveSettings`, `src/domain/policies.ts:635-660`, so this is tidiness); withdraw pending `core.approvals` with policy `ops.sop.approve` or `ops.policy.approve`; mark undelivered `core.event_deliveries` / `core.integration_events` of type `ops.employee.separated` as processed or delete them, because the outbox throws for an unknown event type (`getEventDefinition`, `packages/shared-contracts/src/events/registry.ts`). `core.audit_events` rows stay (append-only history). Notification rows can stay (dead links) or be marked read.
- **Local dev database:** embedded PostgreSQL in `.data/postgres` (port 54320). Data there is fictional seed data. Back up before migrating: `pg_dump` is not installed (D-024), so stop the server (`npm run db:stop` or end `npm run db:start`) and copy the `.data` folder. Never run `db:reset`/`db:seed` against anything but this local database.
- **Tests** build the schema from the TypeScript files (`createTestDb()`), so they need no migration.

### 4.11 Docs, register, prototype

| Item | Action |
|---|---|
| `apps/business-ops-os/docs/parts/hr-lifecycle.md`, `hr-records.md`, `hr-time.md`, `operations.md` | DELETE |
| `apps/business-ops-os/docs/parts/admissions.md` | KEEP |
| Module `README.md`, `requirements/REQUIREMENTS.md` (OPS-013…029 Operations rows, OPS-030…069), `docs/ALGORITHMS.md` (A-07…A-11, A-13, A-21…A-56; A-14 workload loses tasks), `WORKFLOWS.md` (HR, Recruitment, HR time, Operations sections), `KPI_DEFINITIONS.md` (HR and Operations sections; K-14, K-15 task part, K-19), `PERMISSIONS.md`, `DATA_MODEL.md`, `DOMAIN_MODEL.md`, `API.md` (Tasks, SOPs, Incidents, Planning, HR ×3, Operations work), `TEST_PLAN.md`, `INTEGRATION_REQUESTS.md` (IR-OPS-01, 02 trimmed, 05, 09-12, IR-ACD-08 withdrawn) | Edit (follow `elevate-sync-docs`). Recommend marking removed requirement rows "Withdrawn 20 Oct 2026 (owner)" in one line each rather than silently deleting, so OPS IDs are not reused. |
| Root `IMPLEMENTATION_STATUS.md` (OPS-F8…F13, F23…F29 and the operations rows after them), `HANDOFF.md` (lines 7, 24, 148 mention HR), `PLACEHOLDERS.md` (compensation viewers line 10, "Staff time and leave" section lines 21-27, "Company policies" line 32), `INTEGRATION_CONTRACT.md` ownership row (line 30 lists tasks, SOPs, decisions, risks, projects, responsibilities) | Edit |
| `docs/DECISIONS.md` | Add a decision (next free number, D-032) "HR and Operations features removed (owner, 20 Oct 2026)", superseding D-028's scope; D-029 (ops schema split) is then moot. |
| `docs/EXISTING_PROJECT_AUDIT.md` §9 (Audit-owned) | Mark OD-026, OD-028 (SOP approvals), OD-029…OD-043, OD-045 withdrawn; OD-011 loses the escalation-threshold part. Keep OD-044, OD-046, OD-047, OD-048, OD-009, OD-012, OD-013, OD-021, OD-027. |
| Root `docs/BUSINESS_OPERATIONS_AUDIT.md` (19 Oct HR baseline audit) | DELETE (superseded by this file) or add a one-line "superseded" header. |
| `docs/code-map.html` | Regenerate (`scripts/development/code-map.mjs`). |
| Register `Elevate-Not-Working/items/ops.json` | Delete HR-TEAMS, HR-BULK-IMPORT, HR-RETENTION, HR-READ-AUDIT, HR-OVERTIME, HR-ACCRUAL, HR-SHIFT-CHANGE, HR-INBOX, HR-ONBOARDING-MERGE, HR-ACADEMIC-LEAVE, HR-DOC-STORAGE, HR-ATTENDANCE-PROVIDER, OPS-P-HR, OD-026, OD-029…OD-043, OD-045, OD-028, OPS-018, OPS-025-TIMELINE, OPS-029, OPS-A13-ONLINE, OPS-P04, OPS-013 (task generation), IR-OPS-05, IR-OPS-11, IR-OPS-12. Edit OPS-024-KPI (drop HR dashboard), OD-011 (drop escalation thresholds), IR-OPS-01, IR-OPS-02. Keep the admissions items. Then `node build.mjs`. |
| `platform.json` OD-026, OD-028; `academic.json` ACD-NW-009 (mentions teacher leave as a timetable check source) | Edit: OD-026 withdrawn; ACD-NW-009 loses the Ops leave source. |
| Prototype `C:\OPENBOT\Elevate\src\ops.js` (tasks, escalations, SOPs, responsibilities, risks, projects, milestones, incidents, decisions; no HR screens) and `src/data/ops.json`, `src/data/gen/ops.mjs` | Separate change through `elevate-prototype` (the prototype must match the real rules). Not part of the elevate-os deletion; then `npm run check` in `Elevate`. |

### 4.12 Dependency check: what must keep working

| Area | Depends on deleted code today? | Action |
|---|---|---|
| Leads, enquiries, duplicates, merge | No | — |
| Admissions pipeline, checks, fee approval, enrolment handoff | No (fee approval uses `approval-policies.ts` directly, not the inbox) | Keep `feeArrangementPolicy`. |
| Students, fees, admissions report | No | — |
| Counselling, demos, schedule | No | — |
| Follow-ups and reminders job | No (jobs route imports HR/task jobs alongside) | Trim the jobs route. |
| Settings / proposed policies (incl. `pipeline.demo_skip`) | No (policies register is a separate table) | Trim setting keys. |
| Core approvals (fee arrangement) | Inbox imports SOP/task/policy/HR sources | Trim `approvals.ts`. |
| Staff directory, core steward | **Yes**: `organisation.ts` imports `hr/employee-core`, `hr/wiring`, `opsEmployeeRecords`, `domain/hr/employees`; pages import `domain/hr/employees`, link to HR pages | Edit before deleting HR. |
| Dashboard / overview | **Yes**: tasks, risks, operations report, `staffPresentToday` | Edit. |
| Platform app | **Yes**: overview adapter, page links, access-revocation consumer and tests | Edit/delete in the same change (Integration-owned files; see 6.4). |
| Academic and Marketing apps | No imports of any ops HR/Operations table (grep) | — |

---

## 5. Admissions extras not in the brief, and navigation stubs

**Candidates to delete or reshape (owner/lead to confirm):**

| Item | Where | Recommendation |
|---|---|---|
| CRM import adapter mock (OPS-026, `not_configured`) | `src/server/adapters/crm.ts`, settings page panel, barrel export | DELETE. The brief's external source is Marketing, not a CRM. OD-010 stays open in the register. |
| Admission checklist items kit issued, communication group added, timetable communicated, school coordination, hostel coordination | `ops.ts:151-162`, `src/domain/admission-readiness.ts:12-38` | Replace with the brief's checklist. Note OPS-011 was recorded as an Approved legacy rule; record the owner's choice before removing. |
| Demo fee (₹1,000, `demo.fee`, `fee_status`, `fee_amount_inr`, `fee_terms_state`, demo-fee adjustment link on fee records) | `ops.ts:712-720`, `:797-799`; `src/server/pipeline.ts:187-208` | The brief does not mention a demo fee; legacy D-003 records it as Confirmed. Ask the owner; keep until answered. |
| `demo.limits` (consecutive days, subject cap, missed-day rule; open, OD-012) | `src/domain/policies.ts:253-262`, `schedule.ts:216-222` | Fold into the new demo policy setting (session count + spacing) or delete. |
| Management dashboard KPIs K-14/K-15/K-19 and workload | `src/server/dashboard.ts` | Delete with tasks/risks; replace with the brief's five KPI cards. |
| Admissions KPI report (11 KPIs, OPS-078) | `src/server/reports/admissions.ts` | KEEP as the base of "Admissions Funnel"; add Demo Conversion and Student Summary. |
| `office.online_hours` (locked legacy setting) | `src/domain/policies.ts:334-349` | DELETE (only the HR seed reads it). |
| Explicit lead merge (`/leads/[id]/merge`, OPS-003) | `src/server/leads.ts` | KEEP. It is a manual, audited review outcome, which matches "duplicate detection → review workflow". |

**Navigation stubs:** none. Every NAV entry in `src/ui/frame.tsx:26-63` points to a built page, and every entry in `src/app/reports/page.tsx` has `available: true`. The brief's navigation items (Demo Students Current/Upcoming/Previous, Active Students, Past/Inactive, Leads from Marketing, Counselling & Meetings, Applications/Admission Decisions, Enrolment Handoffs, Demo Conversion, Student Summary Reports) do not exist yet; when the nav is rebuilt, unbuilt ones must be shown as "planned" without a link (the `available: false` pattern in `reports/page.tsx` already does this).

---

## 6. Ownership and architecture decisions

Module rules that constrain the design: modules never import each other; foreign keys only within a module or into `core`; Ops stewards `core.departments` and `core.staff_members`; Academic stewards `core.programmes`; `core` tables are written only by the designated steward or shared packages.

### 6.1 Canonical student identity

**Recommendation: a new `core.students` table, stewarded by Business Ops.** Reasons: the person becomes a student at admission, which Ops owns; demo students and former students need an identity Ops can reference before or after any Academic enrolment; Ops and Academic both need an FK, and FKs are allowed only into `core`.

- Columns (minimal): `id uuid`, `code` (`STU-######`, never reused), `full_name`, `preferred_name`, `date_of_birth` (nullable, restricted), `status` (`active|merged`), `merged_into_id`, `created_by`, `created_at`, `updated_at`. No contacts in core.
- Ops: `ops.admissions.student_id` becomes an FK to `core.students` (today a plain UUID filled from Academic's reply). The conversion transaction creates or links the `core.students` row (match rule = OD-044, currently open; duplicates go to review, never auto-merge).
- Academic: `academic.students` keeps its academic fields and gains `core_student_id` FK (or uses the same id). The enrolment request carries `studentId` (core), replacing IR-OPS-ADM-1.
- Contacts and guardians stay in `ops` (private, restricted by `ops:student_private:read`).

### 6.2 Programme / course offering / subject / batch / exam type

**Recommendation: no second catalogue in Ops.** Use what exists and fill the gaps through Academic:

| Concept | Home | Status |
|---|---|---|
| Programme (CLAT, IPMAT, CUET, Commerce, CA Foundation, …) | `core.programmes`, Academic steward | exists |
| Course offering (versioned) | `academic.courses` | exists |
| Subject | `academic.subjects` (per course) | exists; needs a stable cross-course `subject_area_code` (e.g. MATHS, ECONOMICS, ENGLISH, CURRENT_AFFAIRS, ACCOUNTANCY) so Ops can match teachers by code, not name |
| Batch / cohort (Regular 11, Regular 12, Dropper) | `academic.batches` (`route`) | exists as route values; Regular 11/12 and Dropper are cohort types, not exams (matches brief §13) |
| Exam type (CLAT UG, IPMAT Indore, IPMAT Rohtak, JIPMAT, IIMB UG-AT, CUET UG, CA Foundation) | new `core.exam_types` + `core.programme_exam_types`, Academic steward | missing; today free text `academic.batches.target_exam` |
| Student ↔ programme/batch many-to-many with dates and status | Ops: one admission per programme; Academic: `academic.enrolments` | exists; Ops needs an Academic read contract |

"IMBUG"/"IAM IP mat" naming stays an owner question (brief §13).

### 6.3 Recommended data model (smallest correct design)

All tables in `ops` unless stated. Append-only = rows are only inserted.

1. **Demo and sessions**
   - `ops.demos` (keep): add `programme_id` (FK core), `counsellor_staff_id`, `planned_session_count` (copied from the policy at booking) and the policy's decision state, `outcome` (`in_progress|completed|converted|declined|withdrawn|cancelled|on_hold`), `outcome_reason`, `outcome_at`, `converted_admission_id`. Retire `day_dates`, `subjects`, demo-level `status`, and `demo_teachers` after migrating rows into sessions.
   - `ops.demo_sessions` (new): `demo_id`, `session_number` (unique per demo), `starts_at`, `ends_at`, `timezone` (default `Asia/Kolkata`), `programme_id`, `subject_area_code`, `teacher_staff_id` (FK `core.staff_members`), `attendance_status` (`scheduled|present|absent|rescheduled|cancelled|not_recorded`), `attended_at`, `attendance_source` (`teacher|staff_manual`), `topics`, `mock_status` (`not_required|pending|prepared|scheduled|completed`), `assessment_attempt_id` (plain UUID into Academic, shown only if Academic confirms it exists), `exception_reason`, `teacher_notified_at`, `updated_by`, `updated_at`.
   - `ops.demo_session_changes` (new, append-only): `session_id`, `field` (`attendance|schedule|teacher`), `previous_value`, `new_value`, `reason` (required for corrections), `actor_user_id`, `at`.
   - Setting `demo.session_count` (default 3, `proposed`) replacing `demo.terms.days` — **requires the owner's decision first** (conflicts with approved legacy D-003/D-004).
   - Progress = count of `present` sessions ÷ `planned_session_count`; scheduled/cancelled never count.
2. **Checklist**: one append-only `ops.checklist_entries` (`subject_type` `demo|admission`, `subject_id`, `item_key`, `status` `complete|pending|waived|not_applicable`, `reason` required for waived, `reference`, `recorded_by`, `recorded_at`); current state = latest entry per item. It replaces the overwrite-in-place `ops.admission_checks` (migrate the 10 gate items; the fee-verification separation rule moves with them). Required items = setting `demo.checklist_required` (`proposed`).
3. **Admission number**: keep `admissions.code` as the *case* reference; add `admissions.admission_number` (nullable, unique partial index where not null), assigned only in the conversion transaction from `ops.admission_number_counters` (`scope` key such as the year, `last_value`; `UPDATE … RETURNING` under the row lock — works in PGlite tests and embedded Postgres). Format from setting `admissions.number_format` (`proposed`; owner has not approved a format). `ops.admission_number_changes` (append-only: `admission_id`, `previous_number`, `new_number`, `kind` `auto|manual`, `reason` required for manual, `actor_user_id`, `at`). New permission `ops:admissions:number_override`. A manual number that collides fails with a clear 409 and rolls back the whole conversion.
4. **Student lifecycle status**: extend the admission state machine after `enrolled` with `on_hold` (review date), `withdrawn`, `completed`, `transferred`, plus `cancelled_before_enrolment` before it; history stays in the existing append-only `ops.admission_transitions` (add `review_date`, `effective_date`). Student-level status = derived from that student's admissions. Exit details in `ops.exit_records` (one per admission: exit type, reason code, exit feedback, guardian feedback, pending fee/refund reference, `reactivation_allowed`, approver). `other_inactive` as a proposed value. Academic must be told (event) so it ends the enrolment.
5. **Guardians**: `ops.guardians` (`lead_id` FK, `student_id` FK core nullable until conversion, `full_name`, `relationship`, `phone`, `email`, `contact_preference`, `consent_status`, `is_primary`, `created_by`, timestamps). Migrate the four guardian columns on `ops.leads`; move consent from per-lead (`ops.contact_preferences`) to per-contact over time. Restricted by `ops:student_private:read`.
6. **Fee plan and ledger**: `ops.fee_plans` (`admission_id`, `pricing_reference`, `total_due_paise`, `status` `draft|approved|superseded`, `approval_id` FK `core.approvals`, `created_by`) and `ops.fee_instalments` (`plan_id`, `seq`, `due_date`, `amount_paise`). Keep `ops.fee_records` as the ledger; add kinds `discount` and `waiver` (each needing an approval reference) instead of overloading `adjustment`. Charts and totals read the ledger only.
7. **Counselling appointments**: evolve `ops.counselling_sessions` into appointments (one table, no copy): add `type` (`student_counselling|guardian_counselling|teacher_academic_counselling|parent_teacher_meeting|admission_follow_up`), make `admission_id` nullable and add `student_id` (core) / `lead_id`, `starts_at`, `ends_at`, `timezone`, `location`, `organiser_staff_id`, `programme_id`, `subject_area_code`, `purpose`, status set `proposed|scheduled|confirmed|completed|cancelled|rescheduled`, `reminder_status`, `rescheduled_from_id`. `ops.appointment_participants` (`appointment_id`, `staff_id` or `guardian_id`, `role`). Double-booking: inside the transaction take `pg_advisory_xact_lock` per participating staff id, then reject any overlapping non-cancelled appointment **or demo session** for that staff (an exclusion constraint needs `btree_gist`, which is not verified for PGlite). Notifications through `@elevate/notifications` (real in-app rows); anything e-mail stays labelled simulated.
8. **Teacher data**: extend `ops.staff_profiles` with `display_name`, `staff_ref` (unique), `verification_status` (`unverified|verified`) and add `ops.staff_subject_capabilities` (`staff_id`, `subject_area_code`, `programme_id` nullable). Seed the 7 named teachers as unverified with no contacts. Accountancy/CA = a subject area with no capability row.
9. **Feedback**: two separate tables. `ops.teacher_student_feedback` (`student_id` core, `teacher_staff_id`, `programme_id`, `subject_area_code`, `period`, structured fields, `version`, `supersedes_id`; a teacher writes only their own rows; edits create a new version). `ops.student_teacher_feedback` (`teacher_staff_id`, `student_id` nullable, `submitted_by_kind` `student|guardian`, ratings, comment, `moderation_status` `pending|published|rejected`, `moderated_by`; never editable by the teacher). Ownership of teacher→student feedback for enrolled students may belong to Academic ("progress"); see 6.4.
10. **Marketing lead handoff receipts**: consumer `ops.lead-intake` for a Marketing event, plus `ops.lead_handoff_receipts` (`event_id` FK `core.integration_events`, `source_lead_id` (Marketing's stable id, unique per source), `status` `received|duplicate_review|accepted|failed|retried`, `attempts`, `last_error`, `lead_id` FK nullable, minimised snapshot of permitted contacts, consent, campaign/source refs, `captured_at`). Idempotency from `core.event_deliveries` + the unique `source_lead_id`. Until Marketing publishes, tests use hand-published events and the UI says "live sync not configured".

### 6.4 Integration requests needed

| To | Request |
|---|---|
| Integration (core/platform owner) | Add `core.students` with Ops as steward (and `core.exam_types` / `core.programme_exam_types` with Academic as steward); remove the five HR roles from `ROLE_KEYS`, `roles.ts`, `permissions/platform.ts`; delete `apps/platform/src/server/access-revocation.ts` and its job route and tests; edit the platform overview (staff present, attendance corrections, team priorities, `/ops/tasks` links); generate the removal migration (4.10); update `drizzle.config.ts`; regenerate `docs/SECURITY_AND_PERMISSIONS.md`; scheduler for the remaining jobs (IR-OPS-02 trimmed). |
| Academic OS | Reuse the core student id on intake (supersedes IR-OPS-ADM-1); duplicate-enrolment guard per admission (IR-OPS-ADM-2, still open); publish enrolment status changes or accept `ops.admission.withdrawn`/`completed`; internal read contracts per student: enrolments (programme, course, batch, status, dates, teachers), attendance summary with as-of time, assessment results with max marks, exam type and date (so Ops can average only comparable scores and show coverage), and attempt existence for demo mocks; `subject_area_code` on `academic.subjects`; confirm who owns teacher→student feedback for enrolled students. |
| Marketing OS | A lead model and a versioned handoff event (e.g. `marketing.lead.handed_off` v1, replacing the proposed `marketing.enquiry.captured` v1 in IR-MKT-05) carrying stable lead id, source, campaign, permitted contacts, course interest, consent, capture time, source ref; idempotency key per lead. |
| Prototype owner | Remove Operations screens from `Elevate.html` after the real removal (4.11). |

### 6.5 Owner decisions needed before or during Chunk 1

1. Demo session count 3 (proposed) vs recorded approved 2-day demo (legacy D-003/D-004). Record with `elevate-record-decision`.
2. Admission number format (prefix, year, width) — expose as proposed; owner has not chosen.
3. Keep or drop the demo fee (₹1,000, legacy D-003).
4. Keep `finance_officer` (fee records) or fold into `operations_manager`.
5. Remove legacy-approved checklist items (kit, group, timetable, school, hostel)?
6. Student identity match rule (OD-044) for linking a converted demo to an existing student.
7. Which past-status values beyond the brief's list; who may reactivate.

---

## 7. Discrepancies between docs and code

| # | Doc says | Code / repo shows |
|---|---|---|
| 1 | Module `README.md` line 5: "nothing is Deployed and no migration exists yet". | `packages/database/migrations/0000_baseline.sql` and `0001_users_email_domain.sql` exist; `AGENTS.md` rule 10 says the baseline exists. |
| 2 | Owner brief: "0000_baseline.sql and 0001 contain HR tables". | `0001` is a single CHECK constraint on `core.users.email`. All HR/Operations tables are in `0000`. |
| 3 | README and REQUIREMENTS quote "86 test files, 896 tests passed, 1 todo" (commit ce7589c) as current evidence. | That is a whole-repo figure from an older commit. The Ops module alone has 31 integration and 14 unit test files today; the figure should be re-measured after the deletion. |
| 4 | Brief: three-class demo, default 3, proposed. | `demo.terms.days = 2`, approved, not editable (`src/domain/policies.ts:224-239`); its source note says the 3-day demo was superseded. |
| 5 | `INTEGRATION_CONTRACT.md` line 86: Ops consumer moves the admission to "`enrolled` or `enrolment_rejected`". | There is no `enrolment_rejected` status; a rejection returns the admission to `admitted` with `handoff_status = 'rejected'` (`src/server/enrolment.ts:445-462`). |
| 6 | `packages/shared-contracts/src/modules/ops.ts` header: "No other Ops events exist yet". | The same file re-exports `ops.employee.separated` v1 from `ops-hr.ts`. |
| 7 | `docs/BUILD_PLAN.md` ownership table lists only `schema/ops.ts` for Business Ops. | Ops also owns `ops-columns.ts`, `ops-hr.ts`, `ops-lifecycle.ts`, `ops-time.ts`, `ops-work.ts` (D-029). Moot after deletion. |
| 8 | Module README "Screens" and IMPLEMENTATION_STATUS: screens "Implemented (type-checked, not yet built or rendered)". `HANDOFF.md` line 9: "All three parts are built and pass their automated tests". | Two different claims about screens; the student and HR screens were not recorded as browser-checked in IMPLEMENTATION_STATUS. |
| 9 | README role table: `teacher` = "own tasks only (no module switcher entry yet, IR-OPS-01)". | True today; after tasks go, teachers have no Ops grant until feedback/appointments are built. |
| 10 | Root `docs/BUSINESS_OPERATIONS_AUDIT.md` (19 Oct) and this file share a name in two folders. | The root one measured the HR brief and is now superseded. |
| 11 | `docs/API_SPECIFICATION.md` (module) is a 3-line pointer to `API.md`. | Fine, but the brief lists `docs/API_SPECIFICATION.md` as a deliverable; decide which file is canonical. |

**Check status recorded in this audit:** the five targeted test files above pass (53 unit + 14 integration tests). No typecheck, lint, build or full test run was performed for this audit; `npm run validate` was running separately and its result is not reported here.
