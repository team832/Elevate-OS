# Business Ops OS — API

HR and Operations (tasks, SOPs, registers, policies, HR records/lifecycle/time) were removed by the owner on 2026-10-20 (D-032); their routes are recoverable from commit 63da4e4.

Every route is built with `defineRoute` (`@elevate/server-kit`). Check order: **401** no session → **403** missing permission (before validation) → **400** `VALIDATION_FAILED` with `details: [{ location, path, message }]` → handler. Envelope: `{ "data": … }` / `{ "error": { code, message, details?, requestId } }` (D-012). Bodies are JSON (`Content-Type: application/json`).

**Scope.** A permission held with scope `own` (admissions counsellor) limits records to those whose owner/counsellor is the staff member linked to the signed-in user. Out-of-scope records return **403**. Services re-check permissions, so pages that call services directly are protected too.

**Error codes used.** `VALIDATION_FAILED` 400 (bad input, missing reason, invalid phone with field path), `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409 (exact duplicate contact with `details.duplicates`, same-person fee verification, unique codes), `INVALID_STATE_TRANSITION` 409 (illegal pipeline move, double enrolment request, confirmation gate with `details.missing`), `INTERNAL` 500.

**Idempotency.** `POST /leads` and `POST /admissions/{id}/enrolment-request` accept an `Idempotency-Key` header: a retry with the same key and body replays the stored response (`idempotency-replayed: true`); a different body is 409. Without a key a second enrolment request is 409 because the admission already left `admitted` — either way exactly one outbox event exists per attempt. `POST /admissions/{id}/fees` and `POST /admissions/{id}/enrolment-retry` also accept the header, and so do every fee write (`POST /fees`, `/fees/{id}`, `/fee-plans`, `/fee-plans/{id}`, `/fee-plans/{id}/entries`: `idempotency: 'optional'`, 24 h replay window) and `POST /applications`. The screens' `ActionForm` sends a key automatically.

**Final confirmation is idempotent without the header (decision 21 Oct 2026).** `POST /applications/{id}/confirm` does not use `defineRoute({ idempotency })`: the stored request hash would be an unsalted SHA-256 of a body that holds the password, and the idempotency transaction would roll back the audit row of a failed attempt. Instead the unique `ops.admission_approvals` row is the idempotency record: a retry or a concurrent click for the same version replays it (200, `replayed: true`); another version is 409.

Request/response schemas: `src/server/schemas.ts` (zod). Response shapes are the service return values in `src/server/*.ts`.

## Leads and enquiries

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/leads` | `ops:leads:read` | List leads (own scope for counsellors). |
| POST | `/ops/api/v1/leads` | `ops:leads:write` | Create a lead + first enquiry + admission case; 409 CONFLICT with details.duplicates on an exact duplicate unless acknowledged. |
| POST | `/ops/api/v1/leads/check-duplicates` | `ops:leads:write` | Preview duplicate warnings for contact details (nothing is saved). |
| GET | `/ops/api/v1/leads/duplicates` | `ops:leads:merge` | Open duplicate flags (merge-review queue). |
| POST | `/ops/api/v1/leads/duplicates/{id}` | `ops:leads:merge` | Dismiss a duplicate flag after review. |
| GET | `/ops/api/v1/leads/{id}` | `ops:leads:read` | Lead detail: enquiries, activity, admissions, follow-ups, duplicates, history. |
| PATCH | `/ops/api/v1/leads/{id}` | `ops:leads:write` | Edit lead details (contacts re-normalised; new duplicate flags raised, never merged). |
| GET | `/ops/api/v1/leads/{id}/history` | `ops:leads:read` | Audit history of the lead and linked records. |
| POST | `/ops/api/v1/leads/{id}/enquiries` | `ops:leads:write` | Attach a new enquiry to an existing lead. |
| POST | `/ops/api/v1/leads/{id}/assign` | `ops:leads:assign` | Assign the lead owner (handoff pending until accepted). |
| POST | `/ops/api/v1/leads/{id}/accept` | `ops:leads:write` | The assigned owner accepts the handoff. |
| POST | `/ops/api/v1/leads/{id}/activities` | `ops:leads:write` | Log a contact attempt; a successful two-way contact moves new admissions to contacted. |
| POST | `/ops/api/v1/leads/{id}/merge` | `ops:leads:merge` | Merge this lead INTO targetLeadId (explicit, audited). |
| GET | `/ops/api/v1/lead-sources` | `ops:leads:read` | Configured lead sources. |

## Admissions and enrolment handoff

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/admissions` | `ops:admissions:read` | Admissions pipeline board. |
| GET | `/ops/api/v1/admissions/{id}` | `ops:admissions:read` | Admission detail with readiness, checklist, approvals and handoff status. |
| PATCH | `/ops/api/v1/admissions/{id}` | `ops:admissions:write` | Edit programme, counsellor (managers), mode, intended start/course/batch. |
| POST | `/ops/api/v1/admissions/{id}/transitions` | `ops:admissions:write` | Move the admission along the legal-transition table. |
| POST | `/ops/api/v1/admissions/{id}/checks` | `ops:admissions:write` | Record a checklist item (status + reference only). |
| POST | `/ops/api/v1/admissions/{id}/fee-approval` | any of [`ops:admissions:write`, `ops:admissions:approve`] | Request, approve, reject or withdraw the admission-level fee-arrangement approval. Since 21 Oct 2026 (round 4) these approvals activate nothing; they stay readable as history. Fee approval is per agreement version: see "Fee agreements". |
| POST | `/ops/api/v1/admissions/{id}/enrolment-request` | `ops:admissions:write` | admitted → enrolment_requested and publish ops.admission.enrolment_requested v1 in one transaction. |

## Follow-ups, counselling, demos, schedule

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/follow-ups` | `ops:leads:read` | Follow-ups (views: mine, overdue, due_today, open, all). |
| POST | `/ops/api/v1/follow-ups` | `ops:leads:write` | Create a follow-up (owner and due date required). |
| POST | `/ops/api/v1/follow-ups/{id}` | `ops:leads:write` | Complete or cancel a follow-up with an outcome. |
| GET | `/ops/api/v1/schedule` | `ops:leads:read` | `{ from, to, counselling: appointment rows (`startsAt`, `staffId` …), demos: demos with a class in the range, each with `sessions` (its classes in the range, with `teacherName`) }` for a date range (default this IST week). Since 0005 (D-036) demo days and subjects come from the sessions; the old `dayDates`/`subjects`/`teachers` fields are gone. The `/ops/schedule` page redirects to `/ops/meetings`. |

The old `/ops/api/v1/counselling` adapter routes no longer exist; book counselling with `POST /appointments`. Demo routes changed on 20 Oct 2026: see "Demo students" below. The old `POST /demos` body (`subjects`, `dayDates`, `teacherStaffIds`) and the demo-level `attended | missed | cancel` actions are retired.

## Staff directory (steward of core tables)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/organisation` | `ops:organisation:read` | Departments and staff. |
| POST | `/ops/api/v1/staff` | `ops:organisation:manage` | Create a staff member (core.staff_members, steward). |
| GET | `/ops/api/v1/staff/{id}` | `ops:organisation:read` | Staff detail (profile, manager, department, direct reports). |
| PATCH | `/ops/api/v1/staff/{id}` | `ops:organisation:manage` | Update a staff member (reporting-line loops rejected). |
| POST | `/ops/api/v1/departments` | `ops:organisation:manage` | Create a department (provisional). |
| PATCH | `/ops/api/v1/departments/{id}` | `ops:organisation:manage` | Rename, confirm or archive a department. |

## Dashboard, settings, jobs

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/dashboard` | `ops:dashboard:read` | KPIs, workload and cross-module panels. |
| GET | `/ops/api/v1/settings` | `ops:settings:read` | Configuration with decision states. |
| PUT | `/ops/api/v1/settings/{key}` | `ops:settings:manage` | Change a configurable value (stays proposed). |
| POST | `/ops/api/v1/jobs/{job}` | `ops:jobs:run` | Run a job by hand (list under Jobs below). Idempotent. |
| GET | `/ops/api/v1/operations/approvals` | `ops:module:access` | Approvals inbox from two sources: annual fee agreement versions (`ops.fee_agreement.version`; student name only with `ops:students:read`, "Tuition ₹before → ₹after (change)" only with `ops:fees:read`, link to the student's Fees tab, Approve / Reject call `POST /fee-plans/{id}/decision`) and the older admission-level fee arrangements (history). Never lists the user's own requests or agreements they made; own scope applies. |
| GET, POST | `/ops/api/v1/onboarding-templates` | GET `ops:settings:read`; POST `ops:settings:manage` | Onboarding template versions (newest first per code); POST publishes the next version and retires the active one (see "Onboarding"). |

## Admissions administration (fees, students, handoff retry, report)

Check order and errors as above. Fee and retry creates accept an optional `Idempotency-Key`.

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| POST | `/ops/api/v1/admissions/{id}/transitions` | `ops:admissions:write` (own) | `{ to, reason?, reasonCode? }` | admission row | 400 reason/reasonCode, 403 scope, 409 illegal/gate |
| GET | `/ops/api/v1/admissions/{id}/fees` | `ops:fees:read` (own) | — | `{ admission, records[] (manuallyRecorded: true, recorder/checker names), summary, disclaimer, settings }` | 403, 404 |
| POST | `/ops/api/v1/admissions/{id}/fees` | `ops:fees:record` | `{ kind, direction?, amountPaise? \| amountRupees?, pricingReference?, receiptReference?, method?, paymentDate?, dueDate?, demoId?, notes? }`; `Idempotency-Key` optional | 201 record + `disclaimer` | 400 per field (non-integer/≤0/over limit, future date, missing reference, refund > received, demo mismatch), 403, 404. Since 21 Oct 2026 a `refund` here fails 400 (use `POST /fees/{id}` refund), and tuition rows are refused while the student has an open agreement ("Record tuition on the annual agreement.") |
| POST | `/ops/api/v1/fees/{id}` | `ops:fees:record` | `{ action: 'verify', note? }` or `{ action: 'void', reason }` | record | 400, 403 (self-check / scope), 404, 409 (state) |
| GET | `/ops/api/v1/fees` | `ops:fees:read` (own) | `?status=&limit=&cursor=FEE-…` | `{ items, disclaimer }`, `meta.page.nextCursor` | 400, 403 |
| GET | `/ops/api/v1/students` | `ops:students:read` (own) | `?q=&state=…&programme=&handoff=&sort=&limit=&cursor=`; since 20 Oct 2026 also `view` and `contact` (see "Students, lifecycle, guardians, reports") | items (no private fields) + `meta.page` | 400, 403 |
| GET | `/ops/api/v1/students/{id}` | `ops:students:read` (own) | `{id}` = canonical student id or (older links) admission id | profile; `person.privateFields: visible\|hidden` | 403, 404 (not admitted) |
| PUT | `/ops/api/v1/admissions/{id}/contact-preferences` | `ops:admissions:write` + `ops:student_private:read` (both own) | `{ consentStatus, consentBy, allowedChannels[], preferredContact?, note? }` | row | 400 channels without consent, 403, 404 |
| POST | `/ops/api/v1/admissions/{id}/enrolment-retry` | `ops:admissions:write` (own) | `{ reason }`; `Idempotency-Key` optional | 201 `{ admission, eventId, attempt }` | 400, 403, 409 (not dead / not awaiting) |
| GET | `/ops/api/v1/admissions/report` | `ops:admissions:read` (own) | `?from=&to=` (IST dates) | `{ asOf, window, scope, cohort, kpis, bySource, byStatus, closures }` | 400, 403 |
| GET | `/ops/api/v1/leads/{id}` (changed) | `ops:leads:read` | — | `lead` without contact fields and `privateVisible: false` unless `ops:student_private:read` covers the lead; history `before/after` stripped likewise | unchanged |

Contract change: `ops.admission.enrolment_requested` v1 gained the optional `existingStudentId` (additive, `packages/shared-contracts/src/events/enrolment.ts`).

## Jobs

All idempotent; there is no scheduler yet (IR-OPS-02). Each is also exported from `@elevate/business-ops-os/server`.

| Job | Route | Permission |
|---|---|---|
| `follow-up-reminders`, `enrolment-replies` | `POST /ops/api/v1/jobs/{job}` | `ops:jobs:run` |
| `lead-intake` (Marketing handoff events, then retries of failed receipts with fewer than 5 attempts) | `POST /ops/api/v1/jobs/lead-intake` | `ops:jobs:run`; the service also needs `ops:lead_handoffs:manage` |

## Pre-existing routes

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/health` | public | Health incl. database |
| POST | `/ops/api/v1/auth/login` | public | Sign in (shared session cookie) |
| POST | `/ops/api/v1/auth/logout` | session | Sign out |

## Internal (server-to-server)

Business Ops **calls** `GET /academic/api/internal/v1/summary` and `GET /marketing/api/internal/v1/summary` with `fetchInternal` (`src/server/summaries.ts`). Its own `GET /ops/api/internal/v1/summary` is **Proposed** (P2, not built).

## Screens (pages)

Screens are type-checked and Implemented. The redesigned screens (21 Oct 2026: dark theme kept, grouped sidebar Today / Admissions / Students / Money / People / Reports) were looked at by their build agents at 1440 and 390 px (no console errors, no sideways scroll, keyboard path); a full browser pass with axe is still to do.

| Path | Permission | Purpose |
|---|---|---|
| `/ops` | `ops:module:access` (+ `ops:dashboard:read` for the dashboard) | Management dashboard (KPIs, workload, Academic/Marketing panels) or "My work" |
| `/ops/admissions` | `ops:leads:read` | Demo students: five KPI cards that set filters (Follow-ups due opens the tab holding them), search section (name or reference; Filters disclosure), tabs Current / Upcoming / Previous with counts, bordered table with whole-row click, pager; one centred pop-up at a time: `?open=<demoId>` demo record (tabs Overview, Classes, Mock test, Checklist, Feedback, Follow-ups, Activity), `?convert=<demoId>` Convert to admission form (needs `ops:admissions:convert`), `?new=1` booking form (write only) |
| `/ops/admissions/demos/{id}` | `ops:leads:read` | Full demo record: the pop-up's sections stacked (overview, classes with attendance and change history, mock test, checklist with its basis, feedback, follow-ups and counselling, activity) |
| `/ops/admissions/demos/{id}/convert` | `ops:admissions:convert` | Convert to admission, full-page deep link of the `?convert=` pop-up: identity, programmes, batch or "to be assigned", effective date, fee reference, discount request, guardian confirmation, checklist summary, number preview |
| `/ops/admissions/{id}` | `ops:admissions:read` | Admission case: legal transitions, readiness gate, checklist, fee approval, counselling, demo links, admission number, enrolment handoff status, transition history. Before admission (no student profile yet, `hasStudentRecord` false) the annual fee agreement section is shown on the case itself; afterwards the case links to the student's Fees tab |
| `/ops/students` | `ops:students:read` | Active students (enrolled only), search, filters, `?open=` drawer |
| `/ops/students/past` | `ops:students:read` | Tabs On hold / Former / Past demos (`?tab=on_hold\|former\|demos`) |
| `/ops/students/{id}` | `ops:students:read` | Student profile (canonical id; older admission-id links open too) |
| `/ops/students/{id}/report` | `ops:student_reports:generate` | Generate or reopen (`?export=SR-…`) a student report: draft → reviewed → final, PDF download (template `progress-report/1`) |
| `/ops/leads`, `/ops/leads/{id}` | `ops:leads:read` | Leads list (filters, merge-review queue, create with duplicate warnings, `?view=marketing` for Marketing handoffs); detail. `?act=details` = Edit contact details (student phone/email, school, class, guardian; `PATCH /leads/{id}`; needs `ops:leads:write` and private-detail access), `?act=assign` = Assign owner (the counsellor unless the case names one) |
| `/ops/meetings`, `/ops/meetings/{id}` | `ops:appointments:read` | Counselling & meetings: list and week calendar (`?view=week`), schedule form with subject-filtered teacher picker, `?open=` drawer; full record |
| `/ops/schedule` | — | Permanent redirect to `/ops/meetings` |
| `/ops/teachers`, `/ops/teachers/{id}` | `ops:teachers:read` | Teacher directory and profile |
| `/ops/staff`, `/ops/staff/{id}` | `ops:organisation:read` | Staff directory and departments; staff detail and edit |
| `/ops/settings` | `ops:settings:read` | Configuration with decision states; CRM adapter status (mock) |
| `/ops/reports`, `/ops/reports/admissions` | `ops:module:access` / `ops:admissions:read` | Reports index; admissions report with `#funnel`, `#demo-conversion`, `#students` |
| `/ops/operations/approvals` | `ops:module:access` | Approvals inbox (fee agreement versions with before → after amounts for fee readers; older fee arrangements) |
| `/ops/admissions/overview` | `ops:admissions:read` | Admissions overview KPIs (`KPI_DEFINITIONS.md` "Admissions overview") |
| `/ops/admissions/applications`, `/ops/admissions/applications/{id}` | `ops:admissions:read` | Applications list (search, status, programme, sort, 25 per page, `?open=`); application record with "check your answers", form PDF, signatures and the password confirmation |
| `/ops/search` | `ops:module:access` | One search box: leads, demo students, applications, students (each group needs its own read permission) |
| `/ops/fees` | `ops:fees:read` | Fee records list |
| `/ops/tasks` | `ops:tasks:read` | Daily tasks and end-of-day reports: `?tab=` day (My day) · all · eod · team (Team reports, `ops:eod:review` only) |

---

# Admissions workspace routes (added 20 Oct 2026)

Same check order (401 → 403 → 400 → handler), envelope and error codes as above; services re-check permissions and own scope. Requirements OPS-080 … OPS-121; rules A-57 … A-84 in `ALGORITHMS.md`. Zod schemas: `src/server/demos-schemas.ts`, `students-schemas.ts`, `appointments-schemas.ts`, `fee-agreements.ts` and `fees.ts` (fee bodies), `applications-schemas.ts`, `profile-schemas.ts`, `report-schemas.ts`, `staff-tasks-schemas.ts`. Rules added on 21 Oct 2026 are in `ALGORITHMS.md` under "Added on 21 Oct 2026".

## Demo students

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| GET | `/ops/api/v1/demos` | `ops:leads:read` (own) | `view=current\|upcoming\|previous`, `q`, `programme`, `counsellor`, `outcome`, `stage`, `from`, `to` (IST dates of any session), `followUp=due\|overdue`, `page` (25 per page) | `{ view, counts, kpis, month, total, page, pageSize, rows }` | 400, 403 |
| POST | `/ops/api/v1/demos` | `ops:leads:write` (own) | `{ admissionId, sessions[]: { dayNumber?, startsAt, endsAt?, subject, teacherStaffId? }, durationMinutes = 60, programmeCode?, counsellorStaffId?, notes? }`; without `dayNumber`, classes on the same IST date form one demo day; the days must equal `admissions.demo.day_count` (approved, 3; D-038) | 201 demo + sessions; case → `demo_scheduled`; the canonical `core.students` identity is created here (identity at booking, 21 Oct 2026) | 400 wrong day count or fields, 403, 409 the case already has an open demo |
| GET | `/ops/api/v1/demos/{id}` | `ops:leads:read` (own) | — | sessions, changes, checklist with history, follow-ups, counselling, activity (audit rows) | 403, 404 |
| POST | `/ops/api/v1/demos/{id}` | `ops:leads:write` (own) | `{ action: 'outcome', outcome: not_converted\|cancelled\|no_show\|declined\|withdrawn, reason }` or `{ action: 'kyc', …student details }` (the demo fee is recorded with `POST /fees`, `chargeCategory: 'demo'`) | demo | 400 missing reason or `converted`, 403, 409 already closed |
| POST | `/ops/api/v1/demos/{id}/sessions` | `ops:leads:write` (own) | `{ dayNumber, startsAt, endsAt?, subject, teacherStaffId?, reason }` | 201 class added to a demo day; a day beyond the plan only when `admissions.demo.extension` allows it (proposed, off) | 400, 403, 409 closed demo |
| POST | `/ops/api/v1/demos/{id}/sessions/{sessionId}` | `ops:leads:write` (own) | `{ action: 'attendance', attendance: present\|late\|absent\|excused\|not_recorded\|scheduled, reason?, notes? }`, `{ action: 'reschedule', startsAt, endsAt?, wholeDay?, reason }`, `{ action: 'cancel', reason }`, `{ action: 'mock', mockStatus, … }`, `{ action: 'assign', teacherStaffId?, … }` (substitute flagged) | session | 400 before start / missing reason, 403, 404, 409 closed demo or illegal move |
| POST | `/ops/api/v1/demos/{id}/checklist` | `ops:leads:write` (own) | `{ itemKey, status: complete\|pending\|waived\|not_applicable, reason? }` | 201 entry | 400 waiver without reason, derived item, unknown key; 403 |

## Conversion and admission numbers

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| GET | `/ops/api/v1/demos/{id}/convert` | `ops:admissions:convert` (own) | — | wizard preview: identity candidates, checklist, number preview; writes nothing | 403, 404 |
| POST | `/ops/api/v1/demos/{id}/convert` | `ops:admissions:convert` (own) | `{ identityVerified: true, guardianConfirmation: confirmed\|not_applicable, programmeCodes[1–2], intendedBatchId?, deliveryMode: offline\|online, effectiveDate, feePlanReference?, discountRequest?, existingStudentIdentityId?, createNewStudent? }`; `Idempotency-Key` optional | 201 the APPLICATION (`id` = application id, `reference` APP-…, `admissionId`, `status`, `studentId`); reuses the identity made at booking; gives NO number (D-040) and requests no enrolment | 400 combination not offered, checklist required and open, invalid identity choice, `admissionNumber` or `requestEnrolment` sent (both refused since 21 Oct 2026); 403; 409 already converted / closed demo / `IDENTITY_REVIEW` with candidates; `INVALID_STATE_TRANSITION` 409 case not convertible |
| POST | `/ops/api/v1/admissions/{id}/admission-number` | `ops:admission_number:override` | `{ admissionNumber, reason }` (reason ≥ 10 characters) | admission + change row | Only for a legacy case without a number; 409 when the case already has a number (never changed, D-040) or the number is taken; 400, 403, 404 |
| POST | `/ops/api/v1/admissions/{id}/transitions` `to: admitted` | — | — | — | 409 with gap `final_confirmation`: admission happens only through `POST /applications/{id}/confirm` |

## Students, lifecycle, guardians, reports

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| GET | `/ops/api/v1/students` | `ops:students:read` (own) | `view=directory\|active\|on_hold\|former`, `q` (name, admission number), `contact` (phone/email of student or guardian; needs `ops:student_private:read`; audited), `programme`, `state`, `handoff`, `sort`, `limit`, `cursor` | items (phones masked) + `meta.total`, `meta.page` | 400, 403 (contact search without private access) |
| GET | `/ops/api/v1/students/{id}` | `ops:students:read` (own) | canonical id or admission id | profile (fields by permission; Academic attendance and results through `academic.student_summary` v1); `actions.exitStatuses` = list of exit statuses the caller may record (empty = none), plus `hold`, `resume`, `reactivate`, `editGuardians` booleans | 403, 404 |
| POST | `/ops/api/v1/admissions/{id}/lifecycle` | `ops:students:lifecycle` (own); `reactivate` also `ops:students:reactivate`; `readmit` also `ops:admissions:write` | `{ action: 'hold', reason, reviewDate }`, `{ action: 'resume', reason }`, `{ action: 'exit', exitStatus, exitDate, reason, reasonCode? (from `admissions.closure_reasons`), materialStatus = not_recorded, closingNotes?, exitFeedback?, guardianFeedback?, feeReference?, reactivationAllowed = false }`, `{ action: 'reactivate', reason }`, `{ action: 'readmit', reason, programmeCode?, academicYear? }` | admission (+ exit record); `readmit` returns the new APPLICATION (origin `readmission`) on a new case of the same lead and identity | 400 reason, 403 (reactivation by the person who recorded the exit, or without the permission), 404, 409 illegal edge, record does not allow reactivation, a readmission is already open (reactivate or readmit), or a live case for that programme exists |
| POST | `/ops/api/v1/students/{id}/guardians` | `ops:guardians:write` + `ops:student_private:read` (own) | `{ fullName, relationship, phone?, email?, preferredContact?, consentStatus = not_recorded, notes?, address?, isPrimary?, isEmergency? }` (exactly one live primary; the first guardian becomes primary) | 201 guardian (contacts normalised) | 400 invalid phone/email with path, 403, 404 |
| PATCH | `/ops/api/v1/students/{id}/guardians/{guardianId}` | as above | any subset of the POST body, `archived: true` to archive | guardian | 400, 403, 404 |
| POST | `/ops/api/v1/students/{id}/report` | `ops:student_reports:generate` (own) | `{ from, to, audience = internal, sections?: list \| { section: boolean }, acknowledgement? }` (IST dates, from ≤ to) | 201 draft report with a frozen snapshot + `referenceCode` (`SR-…`), export row + audit | 400 (audience not enabled in `reports.audiences`), 403, 404 |
| GET | `/ops/api/v1/students/{id}/report` | `ops:student_reports:generate` (own) | `?ref=SR-XXXXXXXXXX` | `{ export (no snapshot), fields, view, actions }`, sections cut to the reader's current permissions | 400, 403, 404 |
| POST | `/ops/api/v1/students/{id}/report/{ref\|id}/status` | `ops:student_reports:generate` (+ `ops:student_reports:review` to review or finalise) | `{ to: reviewed \| final }` | report | 403 own report / no review permission, 409 illegal move or "review first" (A-RPT-2) |
| GET | `/ops/api/v1/students/{id}/report/{ref\|id}/pdf` | `ops:student_reports:generate` (own) | — | `application/pdf` (template `progress-report/1`), audit `student.report_downloaded` | 400 report made before snapshots existed, 403, 404 |
| GET | `/ops/api/v1/students/{id}/kyc` | `ops:student_private:read` (own) | — | identity documents (current + replaced), siblings, KYC history (masked), document-type setting | 403, 404 |
| POST | `/ops/api/v1/students/{id}/kyc` | `ops:guardians:write` + `ops:student_private:read` | `{ subjectType, guardianId?, documentType, maskedReference }` (masked reference only, D-043) | 201 unverified document; supersedes the previous one of the same type and person | 400 unmasked reference, 403, 404 |
| POST | `/ops/api/v1/students/{id}/kyc/{documentId}` | `ops:kyc:verify` + `ops:student_private:read` | `{ status: verified \| rejected, note }` (rejection needs the note) | document | 403, 404, 409 superseded or already decided |
| POST | `/ops/api/v1/students/{id}/siblings` | `ops:guardians:write` + private read on BOTH students | `{ siblingStudentId, note? }` | 201 link (never merges records) | 400 self, 404 unknown or out of scope, 409 duplicate |
| GET | `/ops/api/v1/students/{id}/onboarding` | `ops:students:read` (own) | — | checklist items with status, history, materials, counts | 403, 404 |
| POST | `/ops/api/v1/students/{id}/onboarding` | `ops:admissions:write` (own) | `{ action: 'generate', admissionId }` or `{ action: 'add', admissionId, itemKey, label, kind, dueDate?, ownerStaffId? }` | items | 400, 403, 404, 409 |
| POST | `/ops/api/v1/students/{id}/onboarding/{itemId}` | `ops:admissions:write` (own) | `{ status, note?, evidenceRef?, ownerStaffId?, dueDate? }` (blocked needs a note; biometric "completed" needs an evidence reference; material "completed" only when fully issued) | status event + audit `onboarding.item_status` | 400, 403, 404 |
| POST | `/ops/api/v1/students/{id}/materials` | `ops:admissions:write` (own) | `{ itemId, kind: issue \| return \| replacement, quantity, edition?, issuedOn, note? }` | 201 move + audit `onboarding.material_recorded` | 400 more returned than held, 403, 404 |

## Counselling and meetings, teachers, feedback

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| GET | `/ops/api/v1/appointments` | `ops:appointments:read` (own = assigned, organiser or participant) | `type`, `status`, `staffId`, `studentId`, `from`, `to` (IST dates), `page` | page of appointments | 400, 403 |
| POST | `/ops/api/v1/appointments` | `ops:appointments:manage` (own) | `{ type, staffId, startsAt, endsAt?, mode: offline\|online, location?, studentId?, leadId?, admissionId?, demoId?, programmeCode?, subject?, purpose?, status: proposed\|scheduled = scheduled, otherStaffIds[≤10], guardianIds[≤5] (ops.guardians ids) }` | 201 appointment + participants; teacher notified in-app; email/SMS "simulated — not sent" | 400 bad input or unknown staff, 403, 409 clash (`details[0].path = ['startsAt']`, names the clash) |
| GET | `/ops/api/v1/appointments/{id}` | `ops:appointments:read` (own) | — | appointment, participants, change history | 403, 404 |
| PATCH | `/ops/api/v1/appointments/{id}` | `ops:appointments:manage` (own) | `{ action: 'confirm' }`, `{ action: 'reschedule', startsAt, endsAt?, reason }`, `{ action: 'cancel', reason }`, `{ action: 'complete', outcome, objections?, nextStep?, followUpOn?, recommendedProgrammeCode? }` | appointment | 400 reason / outcome before start, 403, 404, 409 illegal move or clash |
| GET | `/ops/api/v1/teachers` | `ops:teachers:read` (teacher: own) | `subject`, `programmeCode` | directory, picker list, subjects with no teacher | 400, 403 |
| GET | `/ops/api/v1/teachers/{id}` | `ops:teachers:read` (own) | — | profile; sections by permission; batches "not available" | 403, 404 |
| PATCH | `/ops/api/v1/teachers/{id}` | `ops:teachers:manage` | `{ displayName?, staffCode? (A–Z, 0–9, hyphen; renamed from `staffRef`, D-036), verificationStatus?, roleNote?, subjects?[≤20] (replaces the list) }` | profile | 400, 403, 404 (staff ref is unique by index; a duplicate is refused) |
| GET | `/ops/api/v1/feedback/about-students` | `ops:feedback:read` (teacher: own) | `studentId` | teacher → student feedback | 400, 403 |
| POST | `/ops/api/v1/feedback/about-students` | any of `ops:feedback:write` (own), `ops:feedback:manage` | `{ studentId, teacherStaffId? (manage only), subject, observedOn, relatedRef?, observations, strengths?, areasToImprove?, actionPlan?, status = draft, scope: general \| demo_session \| enrolment, demoSessionId? (scope demo_session), enrolmentId? (scope enrolment), visibility: internal \| shareable = internal }` | 201 | 400, 403 (student not taught by the teacher, writing as someone else) |
| PATCH | `/ops/api/v1/feedback/about-students/{id}` | as POST | same fields without `studentId` | row edited in place (draft) or version n+1 (final) | 400, 403 other teacher, 404, 409 superseded version |
| GET | `/ops/api/v1/feedback/about-teachers` | `ops:feedback:read` (teacher: approved rows shared with them) | `teacherStaffId` | student/guardian → teacher feedback + rating summary with denominator | 400, 403 |
| POST | `/ops/api/v1/feedback/about-teachers` | `ops:feedback:record` | `{ teacherStaffId, studentId?, submittedByKind: student\|guardian, subjectRef?, feedbackOn, rating? (1–5), comment }` | 201, status `pending` | 400, 403 |
| PATCH | `/ops/api/v1/feedback/about-teachers/{id}` | `ops:feedback:moderate` | `{ action: approve\|reject\|hide, note?, visibility? }` (approve also un-hides) | row | 400, 403 (moderating feedback about yourself), 404, 409 illegal move |

## Fee agreements (fee plans; annual since 21 Oct 2026)

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| GET | `/ops/api/v1/fee-plans` | `ops:fees:read` (own) | `studentId` | annual agreements with `status`, `nextDue`, `versions`, instalments with status, ledger, totals (incl. `creditPaise`), reconciliation, `pendingApproval { subjectId, requestedBy } \| null`, `canActivate`; plus `registration { configuredPaise, summary }`, `demo`, `otherCharges`, `admissions`, `tuitionOutsideAgreement`, disclaimer | 400, 403 |
| POST | `/ops/api/v1/fee-plans` | `ops:fees:record` | `{ admissionId \| admissionCode, studentId (must equal the admission's student), label, pricingReference?, academicYear "2026-27", totalPaise \| totalRupees, dueDates[3] }`; instalments come from `fees.tuition_split` 50/25/25 (D-039; `instalments[]` removed); `Idempotency-Key` optional | 201 draft agreement (`tuitionDiffers` when it differs from the configured figure) | 400 (admission has no student, student mismatch, tuition over ₹1,00,00,000), 403, 404, 409 the student already has an agreement for that year or the admission has an open one |
| POST | `/ops/api/v1/fee-plans/{id}` | `ops:fees:record` (activate, close a draft); closing or adjusting an ACTIVE agreement also needs `ops:admissions:approve` | `{ action: 'activate' }`, `{ action: 'close', reason }`, `{ action: 'adjust', totalPaise \| totalRupees, dueDates, reason ≥ 10, academicYear? (legacy only) }`; `Idempotency-Key` optional | agreement. Adjust closes vN ("Replaced by version N+1: reason") and inserts vN+1 as a draft with a new plan-bound approval request | 403, 404, 409 activation without the version's own approved `ops.fee_agreement.version` approval (decided by someone other than the maker), agreement closed, other academic year |
| POST | `/ops/api/v1/fee-plans/{id}/approval-request` | `ops:admissions:write` (own) | `{ comment? }` | core approval request for this exact draft version (`ops.fee_agreement.version`, subject = `fee_plans.id`) | 400 both fee verifications by two different people missing (BR-OPS-7), 403, 404, 409 not a draft / one already pending |
| POST | `/ops/api/v1/fee-plans/{id}/decision` | `ops:admissions:approve` (own) | `{ decision: approved \| rejected, comment? }` | the approval row (approves or rejects only; finance activates with `activate`) | 403 the maker or the requester, 404, 409 not a draft / nothing pending |
| POST | `/ops/api/v1/fee-plans/{id}/entries` | `ops:fees:record` | `{ kind: received \| discount \| waiver \| adjustment, direction?, amountPaise \| amountRupees, instalmentId?, paymentDate?, receiptReference?, method?, demoId?, notes? }` (refunds and reversals: `POST /fees/{id}`); `Idempotency-Key` optional | 201 ledger row, labelled "manually recorded, not a verified payment" | 400 (reason in `notes` for a reduction, instalment of another agreement), 403 a discount, waiver or credit (not a demo credit) without `ops:admissions:approve` or by the agreement's maker (rule O2, **Proposed**: owner to confirm whether one approver alone may do it), 404, 409 agreement not active |
| POST | `/ops/api/v1/fees` | `ops:fees:record` | `{ admissionId, chargeCategory: registration \| demo, kind: due \| received \| discount \| waiver, amountPaise \| amountRupees, demoId?, paymentDate?, receiptReference?, method?, notes? }`; `Idempotency-Key` optional | 201 fee record. A registration `due` takes its amount from `fees.registration` (₹5,000, D-044) and is charged once per student | 400 "Registration fee not configured." when the setting is empty, 403, 404, 409 already charged |
| GET | `/ops/api/v1/fee-structures` | `ops:fees:read` | — | `{ items: fee structure rows (programmeCodes, label, mode, amountPaise, billingPeriod, instalmentCount, instalmentNote, billingNote, source sample\|website_stated\|owner_approved, sourceNote, status draft\|approved, isSample), anyApproved }` | 401, 403 |
| PATCH | `/ops/api/v1/fee-structures/{id}` | `ops:fees:record`; promoting to `owner_approved` / `approved`, or changing an approved row, also needs `ops:admissions:approve` | `{ label?, mode?, amountPaise \| amountRupees?, billingPeriod?, instalmentCount?, instalmentNote?, billingNote?, sourceNote?, source?: 'owner_approved', status?: draft\|approved, reason? }` (promoting needs `reason` ≥ 10 characters) | updated row; audit `fee_structure.updated` with the reason | 400 (sample/website figure approved, reason missing, amount ≤ 0), 403, 404 |
| POST | `/ops/api/v1/fees/{id}` (changed 21 Oct 2026) | `ops:fees:record` | `{ action: 'verify', note? }`, `{ action: 'void', reason }`, `{ action: 'refund', amount…, paymentDate, receiptReference?, method?, notes? }` (only on a `received` row; ≤ that payment less its earlier refunds), `{ action: 'reverse', reason }`; `Idempotency-Key` optional | record, or 201 linked row with audit `fee_record.refunded` / `fee_record.reversed` | 409 void of an agreement row, a registration/demo row or a reversal (reverse instead); 409 reversing or voiding a payment that still has live refunds (\"Reverse its refunds first\") |

`feeStatusForStudents(db, studentIds, now?)` in `src/server/fees.ts` returns `paid | due | overdue | not_configured` per student for lists; it does no permission check, so callers show it only to holders of `ops:fees:read`.

## Marketing lead handoff and reports

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| GET | `/ops/api/v1/leads/handoffs` | `ops:leads:read` (own: handoffs whose lead you own) | `status` | receipts without contacts, `counts` per status; `attribution` null without `ops:lead_attribution:read` | 400, 403 |
| POST | `/ops/api/v1/leads/handoffs/{id}/retry` | `ops:lead_handoffs:manage` | — | receipt; audited `lead_handoff.retry_requested` | 403, 404, 409 not failed |
| POST | `/ops/api/v1/jobs/lead-intake` | `ops:jobs:run` (+ `ops:lead_handoffs:manage` in the service) | — | processed counts | 403 |
| GET | `/ops/api/v1/admissions/report` (changed) | `ops:admissions:read` (own) | `from`, `to` | existing KPIs + `funnelReport { window, funnel[], demoConversion { total, byProgramme, byCounsellor, bySource \| null }, students { active, on_hold, former } }` | 400, 403 |

Event consumed: `marketing.lead.handed_off` v1 (consumer `ops.lead-intake`; contract declared by Ops in `packages/shared-contracts`, producer not built, IR-MKT-OPS-HANDOFF).

## Settings (20–21 Oct 2026; `PUT /ops/api/v1/settings/{key}`, `ops:settings:manage`, audited; approved keys are not editable here)
| Key | Default | State | Used by |
|---|---|---|---|
| `admissions.demo.day_count` | `{ count: 3 }` | approved (D-038; replaces `admissions.demo.session_count`) | A-57, booking |
| `admissions.demo.extension` | `{ allowed: false, maxExtraDays: 1 }` | proposed | extra demo days |
| `admissions.demo.checklist_required` | `{ requiredBeforeConversion: false }` | proposed | A-63, A-67 |
| `admissions.number.format` | `{ prefix: '', separator: '-', includeYear: false, width: 3 }` | approved (D-037, D-040) | A-65, A-APP-4 |
| `appointments.scheduling` | `{ bufferMinutes: 0, defaultDurationMinutes: 60 }` | proposed | A-73 |
| `fees.allocation` | `{ rule: 'oldest_due_first', dueWindowDays: 7 }` | proposed (`dueWindowDays` is no longer used: there is no "due soon" state) | A-FEE-2 |
| `fees.tuition_split` | `{ sharesPercent: [50, 25, 25] }` | approved (D-039) | A-FEE-5 |
| `fees.registration` | `{ amountPaise: 500000 }` | approved (D-044) | `POST /fees` registration |
| `fees.demo_credit` | `{ creditTowardTuition: true }` | approved; never applied automatically (a manual `adjustment` credit with `demoId`) | fee ledger |
| `admission.payment_gate` | `{ rule: 'none' }` (or `registration_fee`, `first_instalment`) | proposed | A-APP-3 |
| `admission.confirmation` | `{ requireDocuments: true }` | proposed (`requireDownPayment` removed) | A-04, A-APP-3 |
| `admissions.kyc.required_fields`, `admissions.kyc.id_document_types` | lists | proposed | A-APP-3, KYC |
| `admissions.declarations` | the owner's form wording, version 2 | approved (D-046) | form PDF, A-APP-3 |
| `admissions.signatures.required_signers` | `{ student: true, guardian: 'if_under_18' }` | proposed | A-APP-3 |
| `admissions.confirm.reauth` | `{ method: 'password' }` | approved (D-041) | A-APP-4 |
| `events.eligibility` | `{ populations: ['demo', 'active'], includeGuardians: true }` | proposed | A-EVT-1 |
| `reports.audiences` | `{ enabled: ['internal', 'guardian', 'admin_dossier'], reviewBeforeFinal: true }` | proposed | A-RPT-1, A-RPT-2 |

The `days` field left `demo.terms`.

---

# Routes added on 21 Oct 2026

Same check order, envelope and error codes as above. Status: Implemented, Tested (integration tests named in `TEST_PLAN.md`); nothing is Deployed.

## Applications and final confirmation (owner brief §6–§7; A-APP-1 … A-APP-4)

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| GET | `/ops/api/v1/applications` | `ops:admissions:read` (own) | `q`, `status`, `programme`, `sort = updated \| oldest \| name`, `page` (25 per page) | page of applications | 400, 403 |
| POST | `/ops/api/v1/applications` | `ops:admissions:write` (own) | `{ admissionId, academicYear?, existingStudentIdentityId?, createNewStudent? }`; `Idempotency-Key` optional | 201 direct application (reference `APP-nnnnnn` mirrors the case code) | 403, 409 case not `admission_pending` or has an open demo |
| GET | `/ops/api/v1/applications/{id}` | `ops:admissions:read` (own) | — | application, versions, gaps (`fix: contact | counsellor` marks a gap fixed on the lead, not in the application form); KYC and the paper-form answers only with `ops:student_private:read`; fee agreement only with `ops:fees:read` | 403, 404 |
| PATCH | `/ops/api/v1/applications/{id}` | `ops:admissions:write` (own); private fields also need `ops:student_private:read` | `{ version, academicYear?, intendedStartDate?, deliveryMode?, intendedBatchId?, student?: {…KYC on the lead}, form?: { gender, whatsapp, guardianOccupation, guardianOfficeAddress, guardianAlternateContact, qualification, yearOfPassing, percentageOrGrade, subjectsOrStream, batchTiming }, resultPublicityConsent? }` | application; a material change makes version N+1, status draft, live signature confirmation invalidated | 400, 403, 409 `STALE_VERSION` |
| POST | `/ops/api/v1/applications/{id}/ready` | `ops:admissions:write` (own) | `{ version }` | `ready_for_review` | 409 information gaps (`details.missing`), stale version |
| POST | `/ops/api/v1/applications/{id}/form` | `ops:admissions:write` (+ `ops:student_private:read` in the service) | — | `application/pdf` admission form (SHA-256 and template version recorded per version; banner "Application — admission pending"; a reference, never a number) | 403, 409 |
| POST | `/ops/api/v1/applications/{id}/signatures` | `ops:admissions:write` (own) | `{ version, formId, signedOn, studentSigned, guardianSigned }` | `signatures_confirmed` | 400 a required signer missing (by age on the signing day; no date of birth ⇒ guardian), 409 form of another version |
| POST | `/ops/api/v1/applications/{id}/withdraw` | `ops:admissions:write` (own) | `{ reason }` | `withdrawn` | 409 |
| POST | `/ops/api/v1/applications/{id}/confirm` | `ops:admissions:confirm` | `{ password, applicationVersion }` (strict: no other key) | 201 new confirmation (number, approval, enrolment request) or 200 `replayed: true` | 403 wrong password / account without a password (Google-only: open decision D-041) / inactive; 429 + `Retry-After` after 5 failures in 15 min; 409 gaps (`details.missing`), stale version, confirmed on another version |
| GET | `/ops/api/v1/admissions/{id}/acknowledgement` | `ops:admissions:read` (own) | — | `application/pdf` acknowledgement with the fee tracker | 409 before confirmation |
| GET | `/ops/api/v1/admissions/{id}/id-card` | `ops:admissions:read` (own) | — | `application/pdf` CR80 card: name, number, programme, academic year; no guardian data, no QR | 409 before confirmation |
| POST | `/ops/api/v1/admissions/{id}/legacy-verification` | `ops:admissions:confirm` | `{ note ≥ 10 }` | admission marked `legacy_verification = verified`, audited | 403, 409 not a legacy case |

PDF downloads never use `idempotency` (an idempotent route cannot return a raw `Response`); they are `no-store` attachments.

## Events and webinars (owner brief §12; A-EVT-1 … A-EVT-3)

| Method | Path | Permission | Body | Response | Errors |
|---|---|---|---|---|---|
| POST | `/ops/api/v1/appointments/events` | `ops:appointments:manage` | `{ type: event \| webinar, title, startsAt, durationMinutes?, timezone = Asia/Kolkata, mode, onlineLink?, location?, capacity?, purpose?, staffId?, audience { populations[], programmeCodes[], stages[], batchIds[] }, participantStudentIds[] }` | 201 event; the audience is resolved once into participant rows (names kept). Scheduling sends nothing | 400 a chosen student outside `events.eligibility`, 403 |
| PATCH | `/ops/api/v1/appointments/{id}` | `ops:appointments:manage` | adds `{ action: 'edit', …event fields }` for events (never rewrites participants) | event | 400, 403, 404, 409 |
| POST, PATCH | `/ops/api/v1/appointments/{id}/participants` | `ops:appointments:manage` | POST `{ studentId }`; PATCH `{ action: 'remove', participantId, reason }` or `{ action: 'update', participantId, registrationStatus?, attendance? }` | participant | 400, 403, 404, 409 |
| POST | `/ops/api/v1/appointments/{id}/messages` | `ops:appointments:manage` | `{ channel: email \| sms \| whatsapp, body }` | 201 draft with a preview of who it can reach (A-EVT-2) | 400, 403 |
| POST | `/ops/api/v1/appointments/{id}/messages/{messageId}` | `ops:event_messages:send` | — | message `simulated` (no provider is connected); `sent` only with a provider reference (A-EVT-3) | 403, 404, 409 already sent |

## Daily tasks and end-of-day reports (owner decision 21 Oct 2026; A-TSK-1 … A-TSK-4)

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| GET | `/ops/api/v1/staff-tasks` | `ops:tasks:read` (own = your tasks) | `q, staffId, status, priority, from, to, page` | page of tasks | 400, 403 |
| POST | `/ops/api/v1/staff-tasks` | `ops:tasks:write` | `{ title, details?, assignedByStaffId?, priority = medium, dueOn = today, dueTime? (HH:MM IST), status = pending, progressPercent = 0, reason?, recurrence = none \| daily \| weekly \| monthly, staffId? (someone else: all-scope write), leadId? \| admissionId? \| studentId? (one at most) }` | 201 task, audit `staff_task.created` | 400 blocked / on hold without a reason, 403 |
| GET, PATCH | `/ops/api/v1/staff-tasks/{id}` | GET `ops:tasks:read`; PATCH `ops:tasks:write` | any editable field | task; marking a recurring task done creates the next occurrence (A-TSK-3) | 400, 403, 404 |
| GET | `/ops/api/v1/eod-reports` | `ops:eod:review` | `?date=` (default today IST) | team day: who submitted, late, not submitted | 403 |
| POST | `/ops/api/v1/eod-reports` | `ops:tasks:write` | `{ reportDate, summary? }` | draft for the day built from your tasks (A-TSK-4), refreshed while it is a draft | 403, 409 already submitted |
| GET | `/ops/api/v1/eod-reports/{id}` | `ops:tasks:read` (own, addressed to you, or all scope) | — | report with staff, manager and shares | 404 out of scope |
| POST | `/ops/api/v1/eod-reports/{id}/submit` | `ops:tasks:write` | — | snapshot frozen; sent to `core.staff_members.manager_id` (in-app notice); no active manager with a login → every `ops:eod:review` holder | 400 a not-done task without a reason, 409 already submitted |
| POST | `/ops/api/v1/eod-reports/{id}/review` | `ops:tasks:read` + (`ops:eod:review` or being the manager it was sent to) | — | `reviewed`, audit `eod_report.reviewed` | 403 your own report or not addressed to you, 409 not submitted |
| POST | `/ops/api/v1/eod-reports/{id}/share` | `ops:tasks:write` | `{ channel: email \| whatsapp }` | "Simulated — not sent. No WhatsApp or email provider is connected." (audited) | 409 not submitted |
| GET | `/ops/api/v1/eod-reports/{id}/pdf` | `ops:tasks:read` (as GET) | — | `application/pdf` | 404 |

## Search

`GET /ops/search?q=` is a page (no JSON route): leads, demo students, applications and students by name or reference, 10 hits per group, each group only with its module's read permission and own scope. A query that looks like an email or a phone (at least 4 digits) also searches contacts, only with `ops:student_private:read`, audited (`student.contact_search`, masked value); without it the page says contacts were not searched. Phones in results are masked. The student list's own search box (`/ops/students`) sends a query of 10 or more digits, or an email, to the audited `contact` filter when permitted; a 3-digit admission number stays a name/number search. **Host request logs must not keep query strings** (`q` can hold a phone number).
