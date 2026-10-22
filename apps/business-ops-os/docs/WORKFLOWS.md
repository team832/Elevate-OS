# Business Ops OS: workflows and state machines

One diagram per status column that has rules. The rules (guards, reasons, actors) are in `docs/ALGORITHMS.md`; this file only shows the legal moves. Labels in brackets are the authority or condition. "Reason" means a reason is required. Anything not drawn is illegal and answers 409 `INVALID_STATE_TRANSITION` (a missing reason answers 400). Nothing here is Deployed.

## Admissions

### Admission case (A-03, `domain/pipeline.ts`)
```mermaid
stateDiagram-v2
  [*] --> new
  new --> contacted: two-way contact
  contacted --> counselling_scheduled
  contacted --> counselled: reason (walk-in)
  counselling_scheduled --> counselled
  counselling_scheduled --> contacted: reason
  counselled --> demo_scheduled
  counselled --> admission_pending: reason, demo skip (setting, proposed)
  demo_scheduled --> demo_attended
  demo_scheduled --> counselled: reason
  demo_attended --> admission_pending
  admission_pending --> admitted: gate A-04 empty
  admitted --> enrolment_requested: handoff service only
  enrolment_requested --> enrolled: Academic confirmed (system)
  enrolment_requested --> admitted: Academic rejected (system, reason)
  new --> lost: reason (+ reason code)
  contacted --> lost
  counselled --> lost
  admission_pending --> lost
  admitted --> lost
  new --> on_hold: reason
  admitted --> on_hold
  on_hold --> new: resume to held status only
  on_hold --> lost
  lost --> new: reopen, reason
  enrolled --> on_hold: student lifecycle (see below)
```
Every non-terminal status from `new` to `admitted` can go to `lost` or `on_hold`; only the sources above are drawn once. `enrolment_requested` cannot be lost or held. Lifecycle names used in the brief map onto these statuses (see `requirements/REQUIREMENTS.md`, OPS-070). After `admitted` and `enrolled` the student lifecycle below applies (A-69, 20 Oct 2026).

### Enrolment handoff attempt (A-19, table `enrolment_attempts`)
```mermaid
stateDiagram-v2
  [*] --> pending: request published (initial, after_rejection, after_failure)
  pending --> confirmed: Academic confirmed
  pending --> rejected: Academic rejected
  pending --> superseded: audited retry after a dead delivery
  superseded --> superseded: late reply recorded as a note, never applied
```
A new attempt is allowed only when the earlier request can no longer create an enrolment: Academic rejected it, or its delivery is `dead` (reason required). It is refused while the delivery is missing, `failed` (Academic retries) or `processed` (apply the reply). A late confirmation of a superseded attempt notifies operations managers.

### Fee record (A-17, table `fee_records`)
```mermaid
stateDiagram-v2
  [*] --> recorded: ops:fees:record
  recorded --> verified: a different person
  recorded --> voided: reason
  verified --> voided: reason
```
Verified and voided are final. Entries are manual records, never verified payments.

The HR records, recruitment and lifecycle, HR time and Operations workflows (tasks, SOPs, policies, risks) were removed by the owner on 2026-10-20 (D-032); recoverable from git commit 63da4e4.

---

## Admissions workspace (added 20 Oct 2026)

Rules behind each diagram: `docs/ALGORITHMS.md` A-57 … A-84. Requirements: OPS-080 … OPS-121.

### Demo outcome (A-62, A-67; column `demos.outcome`)
```mermaid
stateDiagram-v2
  [*] --> open: booked with 3 demo days (admissions.demo.day_count, D-038); identity created
  open --> converted: Convert to admission (A-67 only), sets converted_admission_id
  open --> declined: reason
  open --> withdrawn: reason
  open --> not_converted: reason
  open --> cancelled: reason
  open --> no_show: reason
  no_show --> [*]
  converted --> [*]
  declined --> [*]
  withdrawn --> [*]
  not_converted --> [*]
  cancelled --> [*]
```
Closing a demo cancels future pending sessions and marks past unrecorded ones `not_recorded`. `cancelled` and `not_converted` send a case still at `demo_scheduled` back to `counselled`. There is no reopen. Tabs: Upcoming and Current are `open` demos split by the first session's IST day (A-58); every other outcome is Previous.

### Demo session attendance (A-60, A-61; column `demo_sessions.attendance`)
```mermaid
stateDiagram-v2
  [*] --> scheduled
  scheduled --> present: after start
  scheduled --> absent: after start
  scheduled --> not_recorded: after start
  scheduled --> rescheduled: reason
  scheduled --> cancelled: reason
  rescheduled --> present: after start
  rescheduled --> absent: after start
  rescheduled --> not_recorded: after start
  rescheduled --> rescheduled: reason
  rescheduled --> cancelled: reason
  present --> absent: correction, reason
  absent --> present: correction, reason
  present --> not_recorded: correction, reason
  not_recorded --> present: correction, reason
  present --> scheduled: correction, reason
  absent --> rescheduled: make-up class, reason
  cancelled --> rescheduled: reason
```
Since 21 Oct 2026 attendance also has `late` (counts as attended) and `excused` (does not); the same edges apply. Every change appends to `demo_session_changes`. Progress counts attended DAYS (a day with a present or late class, A-57). A present session cannot be rescheduled. Reschedule and cancel are refused once the demo is closed; corrections are still allowed.

### Conversion (A-65, A-66, A-67)
```mermaid
flowchart TD
  A[Convert to admission: POST /demos/id/convert] --> B{demo outcome open and case convertible?}
  B -- no --> X1[409, nothing written]
  B -- yes --> C{checklist required setting on and items open?}
  C -- yes --> X2[400, nothing written]
  C -- no --> D{identity}
  D -- same lead --> E[link core.students row]
  D -- contact match, no choice --> X3[409 IDENTITY_REVIEW with candidates]
  D -- person chose / confirmed new --> E
  E --> F[programmes: allowed combination; second programme opens its own case]
  F --> G[case to admission_pending, to admitted if gate A-04 passes]
  G --> H{manual number?}
  H -- no --> I[counter row FOR UPDATE, next number]
  H -- yes, permission + reason --> J[manual number]
  I --> K[demo outcome converted + link]
  J --> K
  K --> L[optional fee-arrangement approval request; optional enrolment request on the outbox]
  L --> M[audit; commit]
  I -. unique violation .-> X4[409, whole transaction rolled back]
  J -. unique violation .-> X4
```
A retry with the same `Idempotency-Key` replays the stored response; a second conversion of the same demo is 409. **Changed 21 Oct 2026:** the identity already exists from booking; conversion creates the application and stops at `admission_pending` — no number, no enrolment request, no `admitted` (see "Admission end to end" below).

### Student lifecycle (A-69; column `admissions.status` after admission)
```mermaid
stateDiagram-v2
  admitted --> enrolment_requested: handoff (A-15)
  enrolment_requested --> enrolled: Academic confirmed
  enrolled --> on_hold: reason + review date
  on_hold --> enrolled: resume, reason
  enrolled --> withdrawn: exit record
  enrolled --> completed: exit record
  enrolled --> transferred: exit record
  enrolled --> other_inactive: exit record (value proposed)
  admitted --> cancelled_before_enrolment: exit record
  withdrawn --> admitted: reactivate (approver, record allows it)
  completed --> admitted: reactivate
  transferred --> admitted: reactivate
  other_inactive --> admitted: reactivate
  cancelled_before_enrolment --> admitted: reactivate
```
A student on hold from `enrolled` can also exit directly (same edges as from `enrolled`); on hold from `admitted` can be cancelled before enrolment. Every move needs a reason and is audited; reactivation needs `ops:students:reactivate`, an exit record with `reactivation_allowed`, and someone other than the person who recorded the exit. After reactivation, enrolment must be requested again. Since 21 Oct 2026 the recommended path back is **readmission** (below): a new case and application; reactivation is refused while a readmission is open. Nothing is deleted. Lists: Active = `enrolled`; On hold = `on_hold` held from `enrolled`; Former = exit statuses or `lost` after admission (A-68).

### Appointment status (A-73, A-74; column `appointments.status`)
```mermaid
stateDiagram-v2
  [*] --> proposed
  [*] --> scheduled
  proposed --> scheduled
  proposed --> confirmed
  proposed --> rescheduled: reason
  proposed --> cancelled: reason
  scheduled --> confirmed
  scheduled --> rescheduled: reason, overlap re-checked
  scheduled --> completed: outcome, after start
  scheduled --> cancelled: reason
  confirmed --> rescheduled: reason
  confirmed --> completed: outcome, after start
  confirmed --> cancelled: reason
  rescheduled --> confirmed
  rescheduled --> rescheduled: reason
  rescheduled --> completed: outcome, after start
  rescheduled --> cancelled: reason
  completed --> [*]
  cancelled --> [*]
```
`proposed`, `scheduled`, `confirmed` and `rescheduled` block the staff member's time (A-73). Each change writes `appointment_changes` and notifies the teacher in-app; email/SMS are "simulated — not sent".

### Feedback (A-75)
Teacher → student (`teacher_student_feedback.status`):
```mermaid
stateDiagram-v2
  [*] --> draft
  [*] --> final
  draft --> draft: edit in place (author or manager)
  draft --> final
  final --> superseded: edit creates version n+1 (supersedes_id)
  superseded --> [*]: read-only
```
"superseded" is not a stored status: a final row that another row supersedes is read-only (409 on edit).

Student or guardian → teacher (`student_teacher_feedback.moderation_status`):
```mermaid
stateDiagram-v2
  [*] --> pending: recorded by staff on their behalf
  pending --> approved: moderator (never the teacher it is about)
  pending --> rejected: moderator
  pending --> hidden: moderator
  approved --> hidden
  hidden --> approved
  rejected --> [*]
```
No edit path exists for this table; the teacher can read approved rows shared with them (`visibility = teacher_and_staff`).

### Marketing lead handoff receipt (A-81; column `lead_handoff_receipts.status`)
```mermaid
stateDiagram-v2
  [*] --> received: event marketing.lead.handed_off v1 delivered
  received --> accepted: lead created, no duplicate match
  received --> duplicate_review: duplicate match, lead flagged, never merged
  received --> failed: error (savepoint rolled back), attempts + 1
  failed --> accepted: retry (job under 5 attempts, or manager route)
  failed --> duplicate_review: retry
  failed --> failed: retry fails again
  accepted --> accepted: later event counted in duplicate_deliveries
  duplicate_review --> duplicate_review: later event counted
```
Live Marketing events do not exist yet; tests and seeds use a mock publisher and the UI says "Live sync with Marketing OS: not configured".

### Annual fee agreement (A-FEE-1 … A-FEE-8; column `fee_plans.status`, 21 Oct 2026)
```mermaid
stateDiagram-v2
  [*] --> draft: created (50/25/25 split, 3 due dates)
  draft --> draft: approval requested (both fee verifications by two people) / approved or rejected by another approver
  draft --> active: activate by finance, only with this version's own approved approval
  draft --> closed: reason
  active --> closed: reason (needs ops:admissions:approve)
  active --> closed: adjust = close vN and create vN+1 as draft (needs ops:admissions:approve, reason ≥ 10)
  closed --> [*]
```
One agreement per student and academic year. Ledger rows are append-only; corrections are reversals or refunds linked to their row. The CHECK `fee_plans_approved_check` now applies to `active` rows only, so closing a draft works (the 20 Oct defect note is resolved).

---

## Admissions lifecycle (added 21 Oct 2026)

Rules: `ALGORITHMS.md` "Added on 21 Oct 2026". Status: Implemented, Tested; nothing is Deployed.

### Admission end to end
```mermaid
flowchart TD
  L[Lead + case] --> D[Book demo: 3 demo days; core.students identity created at booking]
  D --> R[Record attendance per class: present, late, absent, excused]
  R --> C[Convert to admission: creates the APPLICATION, case admission_pending]
  L -. direct admission .-> C2[POST /applications on an admission_pending case]
  C --> A1[Application draft: KYC, paper-form answers, programmes, batch, fee agreement]
  C2 --> A1
  A1 --> A2[Ready for review: information gaps empty]
  A2 --> A3[Admission form PDF for this version]
  A3 --> A4[Signatures confirmed on the printed form]
  A4 --> A5{Approver confirms with own password}
  A5 -- gaps, wrong password, stale version --> X[409 / 403 / 429, nothing admitted]
  A5 -- ok --> N[Admission number 001… + approval row + case admitted + enrolment request to Academic]
  N --> P[Acknowledgement PDF and ID card PDF]
  N --> O[Onboarding checklist: KYC check, batch, registration payment, counselling, biometric, books, ID card]
```
Where each gap is fixed: student phone/email and a guardian taken from the lead → the lead's "Edit contact details" (`/ops/leads/{id}?act=details`); no counsellor → "Assign owner" on the lead (the lead owner counts unless the case names a counsellor); the other details → "Edit application details". A guardian already on a student profile is edited there. Before admission there is no student profile (`hasStudentRecord` in `domain/student-lifecycle.ts`: admitted, or the case has left the pipeline), so the admission case shows the annual fee agreement section itself; once the profile exists the case links to its Fees tab. A demo can be booked only for a counselled case with no open demo; the booking form says so and points to the case to record counselling.

A material change at any step makes a new application version: back to draft, signatures invalidated. Legacy admissions (before migration 0007) show "Legacy — verification required" until an approver records the reconciliation.

### Application (A-APP-1; column `applications.status`)
```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> ready_for_review: no information gaps
  ready_for_review --> form_generated: form PDF of this version
  form_generated --> signatures_confirmed: required signers by age on the signing day
  signatures_confirmed --> admission_confirmed: password confirmation (A-APP-4)
  ready_for_review --> draft: material change (new version)
  form_generated --> draft: material change
  signatures_confirmed --> draft: material change (signature invalidated)
  draft --> withdrawn: reason
  ready_for_review --> withdrawn: reason
  form_generated --> withdrawn: reason
  signatures_confirmed --> withdrawn: reason
  admission_confirmed --> [*]
```

### Exit and readmission (A-STU-7)
```mermaid
flowchart TD
  E[Active or on hold] --> X[Exit record: status, reason code, materials, balance, closing notes]
  X --> RA{Return?}
  RA -- readmit (recommended) --> N[New case on the same lead and identity, admission_pending, application origin readmission]
  RA -- reactivate (exit record allows it, another approver) --> Y[Same case back to admitted; enrolment requested again]
  N --> F[Usual application path; new number only at final confirmation]
```
The closed case, its number and its exit record never change. One live case per student and programme.

### Staff task (A-TSK-5; column `staff_tasks.status`, D-052, D-069)
```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> in_progress: start
  pending --> blocked: block (reason)
  in_progress --> blocked: block (reason)
  on_hold --> blocked: block (reason)
  pending --> on_hold: hold (reason)
  in_progress --> on_hold: hold (reason)
  blocked --> on_hold: hold (reason)
  blocked --> in_progress: resume
  on_hold --> in_progress: resume
  in_progress --> in_review: submit for review
  in_review --> done: approve (reviewer)
  in_review --> in_progress: request changes (reason)
  pending --> done: complete (no review step)
  in_progress --> done: complete (no review step)
  pending --> cancelled: cancel (reason)
  in_progress --> cancelled: cancel (reason)
  done --> in_progress: reopen (reason)
  cancelled --> in_progress: reopen (reason)
```
Acknowledge and request clarification are events, not statuses (any open status). Blocked, on hold and cancelled may also be reached from the other open statuses as listed in the action table. Every change appends an `ops.task_events` row; work time is recorded as `ops.task_updates`; dependencies refuse cycles. Who may take each action, and the review-step / cancel / reassign authority: `ALGORITHMS.md` A-TSK-5 to A-TSK-7. Routes: `API.md` (staff tasks).

### End-of-day report (A-TSK-8; columns `eod_reports.status`, `eod_report_versions`)
Draft → submitted (a frozen version 1 built from that day's events and updates, `eod-facts/1`) → the recipient views, comments, asks for clarification, asks for a revision (the author submits version n+1, linked to the previous one) or acknowledges; a follow-up task can be created from the report. Versions never change after submit. The recipient is the author's active manager; with no manager the author chooses an `ops:eod:review` holder. Nothing is sent outside Elevate OS: "Copy summary" and PDF only ("External delivery not configured"). Detail: `ALGORITHMS.md` A-TSK-8.
