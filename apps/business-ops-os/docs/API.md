# Business Ops OS — API

Every route is built with `defineRoute` (`@elevate/server-kit`). Check order: **401** no session → **403** missing permission (before validation) → **400** `VALIDATION_FAILED` with `details: [{ location, path, message }]` → handler. Envelope: `{ "data": … }` / `{ "error": { code, message, details?, requestId } }` (D-012). Bodies are JSON (`Content-Type: application/json`).

**Scope.** A permission held with scope `own` (admissions counsellor; teacher for tasks) limits records to those whose owner/counsellor (tasks: owner/accountable/backup for reads, owner for writes) is the staff member linked to the signed-in user. Out-of-scope records return **403**. Services re-check permissions, so pages that call services directly are protected too. HR scope (D-028): `own` is the user's own staff record, widened to the reporting chain for `department_manager` (`src/server/hr-scope.ts`); private HR fields narrow it back to the user only.

**Error codes used.** `VALIDATION_FAILED` 400 (bad input, missing reason, invalid phone with field path), `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409 (exact duplicate contact with `details.duplicates`, dependency cycle with `details.cycle`, task blocked by open tasks, same-person fee verification, unique codes), `INVALID_STATE_TRANSITION` 409 (illegal pipeline/SOP/task move, double enrolment request, confirmation gate with `details.missing`), `INTERNAL` 500.

**Idempotency.** `POST /leads` and `POST /admissions/{id}/enrolment-request` accept an `Idempotency-Key` header: a retry with the same key and body replays the stored response (`idempotency-replayed: true`); a different body is 409. Without a key a second enrolment request is 409 because the admission already left `admitted` — either way exactly one outbox event exists per attempt. `POST /admissions/{id}/fees` and `POST /admissions/{id}/enrolment-retry` also accept the header.

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
| POST | `/ops/api/v1/admissions/{id}/fee-approval` | any of [`ops:admissions:write`, `ops:admissions:approve`] | Request, approve, reject or withdraw the fee-arrangement approval. |
| POST | `/ops/api/v1/admissions/{id}/enrolment-request` | `ops:admissions:write` | admitted → enrolment_requested and publish ops.admission.enrolment_requested v1 in one transaction. |

## Follow-ups, counselling, demos, schedule

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/follow-ups` | `ops:leads:read` | Follow-ups (views: mine, overdue, due_today, open, all). |
| POST | `/ops/api/v1/follow-ups` | `ops:leads:write` | Create a follow-up (owner and due date required). |
| POST | `/ops/api/v1/follow-ups/{id}` | `ops:leads:write` | Complete or cancel a follow-up with an outcome. |
| POST | `/ops/api/v1/counselling` | `ops:leads:write` | Book a counselling appointment. |
| POST | `/ops/api/v1/counselling/{id}` | `ops:leads:write` | Complete, no-show or cancel a counselling session. |
| POST | `/ops/api/v1/demos` | `ops:leads:write` | Book a demo (terms/fee from settings). |
| POST | `/ops/api/v1/demos/{id}` | `ops:leads:write` | Attended, missed, cancel, or record the demo fee status. |
| GET | `/ops/api/v1/schedule` | `ops:leads:read` | Counselling and demos in a date range (default this IST week). |

## Tasks and escalations

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/tasks` | `ops:tasks:read` | Tasks (views: mine, overdue, escalated, blocked, open, all). |
| POST | `/ops/api/v1/tasks` | `ops:tasks:write` | Create a task. |
| GET | `/ops/api/v1/tasks/{id}` | `ops:tasks:read` | Task detail with dependencies and escalations. |
| PATCH | `/ops/api/v1/tasks/{id}` | `ops:tasks:write` | Edit a task. |
| POST | `/ops/api/v1/tasks/{id}/status` | `ops:tasks:write` | Change task status (completion needs evidence; blockers enforced). |
| POST | `/ops/api/v1/tasks/{id}/dependencies` | `ops:tasks:write` | Add a blocked-by dependency (cycles rejected with 409). |
| DELETE | `/ops/api/v1/tasks/{id}/dependencies` | `ops:tasks:write` | Remove a dependency. |
| POST | `/ops/api/v1/escalations/{id}` | `ops:tasks:write` | Acknowledge or resolve an escalation. |

## Staff directory (steward of core tables)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/organisation` | `ops:organisation:read` | Departments, staff, responsibilities and gap report. |
| POST | `/ops/api/v1/staff` | `ops:organisation:manage` | Create a staff member (core.staff_members, steward). |
| GET | `/ops/api/v1/staff/{id}` | `ops:organisation:read` | Staff detail with onboarding checklist. |
| PATCH | `/ops/api/v1/staff/{id}` | `ops:organisation:manage` | Update a staff member (reporting-line loops rejected). |
| POST | `/ops/api/v1/staff/{id}/onboarding` | `ops:organisation:manage` | Create the default onboarding checklist. |
| PATCH | `/ops/api/v1/onboarding-items/{id}` | `ops:organisation:manage` | Update an onboarding item (document reference only). |
| POST | `/ops/api/v1/departments` | `ops:organisation:manage` | Create a department (provisional). |
| PATCH | `/ops/api/v1/departments/{id}` | `ops:organisation:manage` | Rename, confirm or archive a department. |
| POST | `/ops/api/v1/responsibilities` | `ops:organisation:manage` | Create a responsibility. |
| PATCH | `/ops/api/v1/responsibilities/{id}` | `ops:organisation:manage` | Update holder, backup or status. |

## SOPs

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/sops` | `ops:sops:read` | SOP register. |
| POST | `/ops/api/v1/sops` | `ops:sops:write` | Create an SOP with draft version 0.1. |
| GET | `/ops/api/v1/sops/{id}` | `ops:sops:read` | SOP detail with versions, checklist and approval history. |
| PATCH | `/ops/api/v1/sops/{id}` | `ops:sops:write` | Edit SOP metadata (owner, reviewer, backup...). |
| PUT | `/ops/api/v1/sops/{id}/draft` | `ops:sops:write` | Save draft content (new version if the current one is not a draft). |
| POST | `/ops/api/v1/sops/{id}/workflow` | `ops:sops:read` | submit | review | withdraw | approve | reject | retire (each action re-checks its own permission). |

## Incidents and exceptions

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/incidents` | `ops:incidents:read` | Exceptions and incidents. |
| POST | `/ops/api/v1/incidents` | `ops:incidents:write` | Record an exception or incident. |
| PATCH | `/ops/api/v1/incidents/{id}` | `ops:incidents:write` | Update status/owner/resolution. |

## Planning registers

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/decisions` | `ops:decisions:read` | Decision log. |
| POST | `/ops/api/v1/decisions` | `ops:decisions:write` | Record a decision. |
| PATCH | `/ops/api/v1/decisions/{id}` | `ops:decisions:write` | Update a decision (superseded needs supersededById). |
| GET | `/ops/api/v1/risks` | `ops:risks:read` | Risks, issues and blockers. |
| POST | `/ops/api/v1/risks` | `ops:risks:write` | Record a risk, issue or blocker. |
| PATCH | `/ops/api/v1/risks/{id}` | `ops:risks:write` | Update a risk. |
| GET | `/ops/api/v1/projects` | `ops:risks:read` | Projects with milestones. |
| POST | `/ops/api/v1/projects` | `ops:risks:write` | Create a project. |
| PATCH | `/ops/api/v1/projects/{id}` | `ops:risks:write` | Update a project. |
| POST | `/ops/api/v1/projects/{id}/milestones` | `ops:risks:write` | Add a milestone (dependency cycles rejected). |
| PATCH | `/ops/api/v1/milestones/{id}` | `ops:risks:write` | Update milestone status/date or add a dependency. |
| GET | `/ops/api/v1/work-inventory` | `ops:risks:read` | Imported legacy work inventory. |

## Dashboard, settings, jobs

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/dashboard` | `ops:dashboard:read` | KPIs, workload and cross-module panels. |
| GET | `/ops/api/v1/settings` | `ops:settings:read` | Configuration with decision states. |
| PUT | `/ops/api/v1/settings/{key}` | `ops:settings:manage` | Change a configurable value (stays proposed). |
| POST | `/ops/api/v1/jobs/{job}` | `ops:jobs:run` | Run a job by hand (list under Jobs below). Idempotent. |

## Admissions administration (fees, students, handoff retry, report)

Check order and errors as above. Fee and retry creates accept an optional `Idempotency-Key`.

| Method | Path | Permission | Body / query | Response | Errors |
|---|---|---|---|---|---|
| POST | `/ops/api/v1/admissions/{id}/transitions` | `ops:admissions:write` (own) | `{ to, reason?, reasonCode? }` | admission row | 400 reason/reasonCode, 403 scope, 409 illegal/gate |
| GET | `/ops/api/v1/admissions/{id}/fees` | `ops:fees:read` (own) | — | `{ admission, records[] (manuallyRecorded: true, recorder/checker names), summary, disclaimer, settings }` | 403, 404 |
| POST | `/ops/api/v1/admissions/{id}/fees` | `ops:fees:record` | `{ kind, direction?, amountPaise? \| amountRupees?, pricingReference?, receiptReference?, method?, paymentDate?, dueDate?, demoId?, notes? }`; `Idempotency-Key` optional | 201 record + `disclaimer` | 400 per field (non-integer/≤0/over limit, future date, missing reference, refund > received, demo mismatch), 403, 404 |
| POST | `/ops/api/v1/fees/{id}` | `ops:fees:record` | `{ action: 'verify', note? }` or `{ action: 'void', reason }` | record | 400, 403 (self-check / scope), 404, 409 (state) |
| GET | `/ops/api/v1/fees` | `ops:fees:read` (own) | `?status=&limit=&cursor=FEE-…` | `{ items, disclaimer }`, `meta.page.nextCursor` | 400, 403 |
| GET | `/ops/api/v1/students` | `ops:students:read` (own) | `?q=&state=admitted\|awaiting_enrolment\|enrolled\|withdrawn&programme=&handoff=&sort=newest\|oldest\|name&limit=&cursor=` | items (no private fields) + `meta.page` | 400, 403 |
| GET | `/ops/api/v1/students/{admissionId}` | `ops:students:read` (own) | — | profile; `person.privateFields: visible\|hidden` | 403, 404 (not admitted) |
| PUT | `/ops/api/v1/admissions/{id}/contact-preferences` | `ops:admissions:write` + `ops:student_private:read` (both own) | `{ consentStatus, consentBy, allowedChannels[], preferredContact?, note? }` | row | 400 channels without consent, 403, 404 |
| POST | `/ops/api/v1/admissions/{id}/enrolment-retry` | `ops:admissions:write` (own) | `{ reason }`; `Idempotency-Key` optional | 201 `{ admission, eventId, attempt }` | 400, 403, 409 (not dead / not awaiting) |
| GET | `/ops/api/v1/admissions/report` | `ops:admissions:read` (own) | `?from=&to=` (IST dates) | `{ asOf, window, scope, cohort, kpis, bySource, byStatus, closures }` | 400, 403 |
| GET | `/ops/api/v1/leads/{id}` (changed) | `ops:leads:read` | — | `lead` without contact fields and `privateVisible: false` unless `ops:student_private:read` covers the lead; history `before/after` stripped likewise | unchanged |

Contract change: `ops.admission.enrolment_requested` v1 gained the optional `existingStudentId` (additive, `packages/shared-contracts/src/events/enrolment.ts`).

## HR records

Paths below are relative to `/ops/api/v1/`. Every route checks its permission in `defineRoute` and again in the service (HR scope and field tier, see `docs/PERMISSIONS.md`). Responses follow the D-012 envelope.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | hr/employees | ops:employees:read | `q, departmentId, location, status*, employmentType*, includeSeparated*, sort (name, code, department, start_date*, status*), dir, page, pageSize ≤ 100` (* record tier only, otherwise 403) → `{items, total, page, pageSize, recordTier}` |
| POST | hr/employees | ops:employees:manage (all) | create (`fullName` …) or `existingStaffId` → 201 `{id, staffId, employeeCode}`; 409 duplicate work email |
| GET | hr/employees/[id] | ops:employees:read | `{employee (tiered), reports, roles\|null, lifecycle\|null, access}` |
| PATCH | hr/employees/[id] | ops:employees:manage | fields + `effectiveOn`, `reason`; 409 on loop or illegal status change, 400 on missing reason or end date |
| GET | hr/employees/[id]/history | ops:employees:read + record tier | append-only history, names resolved |
| GET / PUT | hr/employees/[id]/private | ops:employee_private:read / :manage (own = self) | legal name, personal details, emergency contacts, identity references |
| POST | hr/employees/[id]/emergency-contacts | ops:employee_private:manage | max 5; the first becomes primary |
| PATCH / DELETE | hr/employees/[id]/emergency-contacts/[contactId] | ops:employee_private:manage | |
| POST | hr/employees/[id]/identity-references | ops:employee_private:manage | `last4` > 4 characters → 400 |
| PATCH | hr/employees/[id]/identity-references/[refId] | ops:employee_private:manage | `{status:'retired'}` |
| GET / POST | hr/employees/[id]/documents | ops:employee_documents:read / :manage | POST `stored` while not configured → **503** `{stored:false, connection:'not_configured'}`, nothing written |
| POST | hr/documents/[id]/status | ops:employee_documents:manage | `action` hold · release_hold · request_deletion · approve_deletion (`confirm:true`) · reject_deletion |
| GET | hr/documents/[id]/download | ops:employee_documents:read | 200 `{url, expiresAt}` (≤ 300 s) or 302 with `?redirect=1`; 503 storage not configured; 409 reference-only or deleted. Audited. |
| GET / POST | hr/compensation | ops:compensation:read / :manage | POST takes `amountPaise` or `amountInr` ("45000.50") |
| PATCH | hr/compensation/[id] | ops:compensation:manage | drafts only |
| POST | hr/compensation/[id]/approve | ops:compensation:approve | `{confirm:true}`; 403 drafter or subject; 409 not forward in time |
| POST | hr/compensation/[id]/cancel | ops:compensation:manage | `{reason}` |
| GET | hr/compensation/export?asOf= | ops:compensation:export | `text/csv`, header `X-Export-Reference`; 409 if approved windows overlap |
| GET / POST | hr/assets | ops:assets:read / :manage | list: `q, status, category, page, pageSize` |
| GET / PATCH | hr/assets/[id] | ops:assets:read / :manage | |
| POST | hr/assets/[id]/assign | ops:assets:manage | 409 already assigned / not available / separated |
| POST | hr/assets/[id]/return | ops:assets:manage | `condition` good · worn · damaged · lost |
| GET | hr/employees/[id]/assets | ops:assets:read (HR scope) | |
| POST / PATCH | departments/[id]/heads | ops:organisation:manage | appoint / end tenure |
| GET | organisation/chart | ops:organisation:read | depth-first rows, `detached` flag |

## HR recruitment, onboarding, offboarding

Relative to `/ops/api/v1/hr/`. Edge rules: A-29; state diagrams: `docs/WORKFLOWS.md`.

| Method and path | Permission | Notes |
|---|---|---|
| GET/POST `requisitions` | recruitment:read / manage | `?q&status&sort=code\|title\|status\|updated&dir&page&pageSize`; recruiter create forces self as recruiter |
| GET/PATCH `requisitions/{id}` | read / manage | detail incl. applications in scope, allowed targets, history |
| POST `requisitions/{id}/transitions` | manage or decide | `{to, reason}` |
| GET/POST `candidates` | read / manage | list has no contact fields; `?retention=due` |
| GET/PATCH `candidates/{id}` | read / manage | `contacts` null unless a covering manager |
| POST `candidates/{id}/anonymise` | decide | `{confirm: true}` |
| GET/POST `applications` | read / manage | `?view=all\|interviewing_me&stage&requisitionId&q&sort` |
| GET `applications/{id}` | read | interviewer-only viewers: no offers, no others' notes |
| POST `applications/{id}/transitions` | manage or decide | `{to, reason}` |
| POST `applications/{id}/convert` | decide | `{managerStaffId?, workEmail?, workLocation?}`; 201 first time, 200 `{created:false}` after |
| GET/POST `interviews` | read / manage | GET = interviews I sit on; POST `{applicationId, scheduledAt, durationMinutes, mode, location, interviewerStaffIds[] \| interviewer1..3}` |
| PATCH `interviews/{id}` | manage | `{status?, scheduledAt?, reason?}` |
| POST `interviews/{id}/feedback` | read + assigned interviewer | `{recommendation, notes}` |
| POST `offers` · POST `offers/{id}/transitions` | manage · manage or decide | |
| GET/POST `lifecycle-cases` | lifecycle:read / manage | POST `{kind:'onboarding', staffId}` or `{kind:'offboarding', staffId, separationType, noticeDate?, lastWorkingDay, reason?}` |
| GET `lifecycle-cases/{id}` | lifecycle:read (HR scope) | reason null unless approver/HR |
| POST `lifecycle-cases/{id}/items` · PATCH `…/items/{itemId}` · POST `…/items/{itemId}/transfer` | lifecycle:manage (all) | |
| POST `lifecycle-cases/{id}/approve` | lifecycle:approve, not self | `{confirm: true, comment?}` |
| POST `lifecycle-cases/{id}/cancel` · `…/refresh` | lifecycle:manage | retraction of an approved separation also needs approve |
| POST `lifecycle-cases/jobs` | lifecycle:approve (all) | `{job: 'lifecycle-reminders' \| 'separations'}` |

## HR time: attendance, shifts, leave, timesheets

Relative to `/ops/api/v1/hr/`. Check order 401, 403, 400, handler; services re-check permission and HR scope.

| Method & path | Permission (route + service) | Notes |
|---|---|---|
| GET `attendance` | `ops:attendance:read` (HR scope) | filters `staffId, from, to, status (open/closed/superseded/missing_clock_out), source, page`; 50 per page |
| POST `attendance` | `ops:attendance:manage` | manual entry `{staffId, workDate, clockIn HH:MM, clockOut?, clockOutDate?, breakMinutes, reason}` → 201 |
| GET `attendance/{id}` | `ops:attendance:read` | session, breaks, corrections, replacedBy/replaces, `canRequestCorrection` |
| POST `attendance/clock-in` · `clock-out` | `ops:attendance:record` (self) | 201 / 200; 409 when already in / not in |
| POST `attendance/breaks` | `ops:attendance:record` | `{action: start|end}` |
| GET `attendance/me` | `ops:attendance:record` | self-service status |
| GET `attendance/summary` | `ops:attendance:read` | `?staffId&month=YYYY-MM` (self by default) |
| GET `attendance/provider` | `ops:attendance:read` | mock: `not_configured` |
| GET/POST `attendance-corrections` | read / `ops:attendance:record` | create `{sessionId?, workDate, clockIn, clockOut, clockOutDate?, breakMinutes, reason}` |
| GET `attendance-corrections/{id}` | `ops:attendance:read` | `canDecide`, `canWithdraw` |
| POST `attendance-corrections/{id}/decision` | `ops:attendance:approve` | `{decision: approve|reject, note}`; self → 403 |
| POST `attendance-corrections/{id}/withdraw` | `ops:attendance:record` | requester only |
| GET/POST `attendance-imports` | `ops:attendance:manage` | POST `{csv, fileName?, commit}`; preview by default; repeat file → `alreadyImported: true` |
| GET/POST `shifts`, GET/PATCH `shifts/{id}` | `ops:shifts:read` / `ops:shifts:manage` | PATCH also `status` |
| GET/POST `shift-assignments`, PATCH `shift-assignments/{id}` | `ops:shifts:read` (scoped) / `ops:shifts:manage` | PATCH `{action:'end', toDate}` or `{action:'cancel', reason}`; conflicts → 409 with `details.conflicts` |
| GET/POST `holidays`, PATCH `holidays/{id}` | `ops:shifts:read` or `ops:leave:read` / `ops:leave:manage` | |
| GET/POST `leave-types`, PATCH `leave-types/{id}` | `ops:leave:read` / `ops:leave:manage` | |
| GET/POST `leave-requests` | `ops:leave:read` / `ops:leave:request` | `view=mine|to_decide|all`; create returns `perDate`, `countBasis`; overlap → 409 |
| GET `leave-requests/{id}` | `ops:leave:read` | day-by-day, ledger, `canDecide`, `canCancel` |
| POST `leave-requests/{id}/decision` | `ops:leave:approve` | self → 403 |
| POST `leave-requests/{id}/cancel` | `ops:leave:request` or `ops:leave:approve` | rules in `docs/WORKFLOWS.md` (leave request) |
| GET `leave-requests/availability` | `ops:leave:read` | `?from&to&departmentId`, ≤ 31 days |
| GET/POST `leave-balances` | `ops:leave:read` / `ops:leave:manage` | POST `{staffId, leaveTypeId, entryType: allocation|adjustment, days (0.5 steps), effectiveDate, periodLabel?, note}`; own balance → 403 |
| GET `leave-balances/ledger` | `ops:leave:read` | `?staffId` |
| GET `timesheets` | `ops:hr_reports:read` (HR scope) | `?from&to&staffId&departmentId`, ≤ 62 days; daily rows for one employee |
| GET `timesheets/export` | `ops:hr_reports:export` | `text/csv`, audited `timesheet.exported` |

## Operations work: tasks, SOPs, registers, policies, approvals, reports

Relative to `/ops/api/v1`. 401, 403, 400, handler.

| Method & path | Permission | Notes |
|---|---|---|
| GET `/tasks?view&departmentId&staffId&role&q&page&pageSize` | tasks:read | views add `awaiting_review`; `meta {total,pageNumber,pageSize,pages}`; without page params all matches (≤1000) as before |
| GET/POST `/tasks/{id}/comments` | tasks:read / tasks:write | POST: owner/accountable/backup (own) or manager |
| POST `/tasks/{id}/comments/{commentId}/hide` | tasks:write | author or manager; reason required |
| POST `/tasks/{id}/references`, POST `/tasks/{id}/references/{referenceId}/remove` | tasks:write | |
| PUT / DELETE `/tasks/{id}/review-requirement` | tasks:write (all scope only) | reviewer ≠ owner, needs a login; DELETE refused while a review is pending |
| POST `/tasks/{id}/review` `{decision: accept\|return, note}` | tasks:write | rules in A-47 |
| GET `/tasks/{id}/activity` | tasks:read | own scope = participant |
| PUT `/sops/{id}/schedule` | sops:write | approved version in force only |
| POST `/sops/{id}/archive` | sops:write | retired only |
| GET/POST `/sops/{id}/acknowledgement-requirements`; POST `…/{requirementId}/withdraw` | sops:read / sops:write | names of outstanding people only for sops:write or dashboard:read |
| POST `/sops/{id}/acknowledge` | sops:acknowledge + audience member | 409 twice, 403 outside audience |
| GET `/sops/{id}/history`, GET `/sops/acknowledgements` | sops:read | |
| GET/POST `/risks/{id}/mitigations`; PATCH `/risks/{id}/mitigations/{mitigationId}` | risks:read / risks:write | |
| GET `/projects/blocked` | risks:read | |
| GET/POST `/settings/policies`; GET/PATCH `/settings/policies/{id}`; PUT `…/{id}/draft`; POST `…/{id}/workflow`; GET `…/{id}/history` | settings:read / settings:manage | approval gated by settings:manage + no self-approval (IR-OPS-11) |
| GET `/operations/approvals` | module:access | per-source items the user may decide |
| GET `/reports/operations` | dashboard:read | |

## Jobs

All idempotent; there is no scheduler yet (IR-OPS-02). Each is also exported from `@elevate/business-ops-os/server`.

| Job | Route | Permission |
|---|---|---|
| `follow-up-reminders`, `task-escalations`, `task-reminders` (A-48), `enrolment-replies`, `attendance-missing-clock-out` (A-40), `lifecycle-reminders` (A-38), `separations` (A-36) | `POST /ops/api/v1/jobs/{job}` | `ops:jobs:run` |
| `lifecycle-reminders`, `separations` | `POST /ops/api/v1/hr/lifecycle-cases/jobs` with `{job}` | `ops:lifecycle:approve`, all scope |

## Pre-existing routes

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/health` | public | Health incl. database |
| POST | `/ops/api/v1/auth/login` | public | Sign in (shared session cookie) |
| POST | `/ops/api/v1/auth/logout` | session | Sign out |

## Internal (server-to-server)

Business Ops **calls** `GET /academic/api/internal/v1/summary` and `GET /marketing/api/internal/v1/summary` with `fetchInternal` (`src/server/summaries.ts`). Its own `GET /ops/api/internal/v1/summary` is **Proposed** (P2, not built).

## Screens (pages)

Screens are type-checked and Implemented; none has been built or rendered in a browser yet.

| Path | Permission | Purpose |
|---|---|---|
| `/ops` | `ops:module:access` (+ `ops:dashboard:read` for the dashboard) | Management dashboard (KPIs, workload, Academic/Marketing panels) or "My work" |
| `/ops/leads`, `/ops/leads/{id}` | `ops:leads:read` | Leads list (filters, merge-review queue, create with duplicate warnings); detail with duplicates, owner/handoff, admissions, follow-ups, contact attempts, enquiries, history |
| `/ops/schedule` | `ops:leads:read` | Counselling and demo schedule (IST week), demo terms with decision states |
| `/ops/admissions`, `/ops/admissions/{id}` | `ops:admissions:read` | Pipeline board; detail with legal transitions, readiness gate, checklist, fee approval, counselling, demo, enrolment handoff status, transition history |
| `/ops/tasks`, `/ops/tasks/{id}` | `ops:tasks:read` | Views mine/overdue/escalated/blocked/open/all; job buttons for managers; detail with status rules, dependencies, escalations |
| `/ops/staff`, `/ops/staff/{id}` | `ops:organisation:read` | Directory, departments, responsibilities, gap report; staff detail with onboarding checklist |
| `/ops/sops`, `/ops/sops/{id}` | `ops:sops:read` | Register with proposed/approved state; detail with versions, checklist, review/approval workflow, approval history |
| `/ops/incidents` | `ops:incidents:read` | Exceptions and incidents |
| `/ops/decisions`, `/ops/risks`, `/ops/projects` | `ops:decisions:read` / `ops:risks:read` | Decision log, risks/issues/blockers, projects + milestones + work inventory |
| `/ops/settings` | `ops:settings:read` | Configuration with decision states; CRM adapter status (mock) |
| `/ops/students`, `/ops/students/{id}` | `ops:students:read` | Student directory and profile (admission history, fees summary, handoff status and retry) |
| `/ops/reports`, `/ops/reports/admissions`, `/ops/reports/operations` | `ops:admissions:read` / `ops:dashboard:read` | Reports index; admissions report (K-ADM); operations dashboard (K-OPS) |
| `/ops/operations/approvals`, `/ops/operations/assets`, `/ops/operations/assets/{id}` | `ops:module:access` / `ops:assets:read` | Approvals inbox; assets register and detail |
| `/ops/settings/policies`, `/ops/settings/policies/{id}` | `ops:settings:read` | Policies and compliance register |
| `/ops/hr/employees`, `/ops/hr/employees/{id}`, `/ops/hr/departments`, `/ops/hr/compensation` | `ops:employees:read` / `ops:organisation:read` / `ops:compensation:read` | Employee directory and record, departments and heads, compensation records |
| `/ops/hr/recruitment` (+ `requisitions/{id}`, `candidates/{id}`, `applications/{id}`) | `ops:recruitment:read` | Requisitions, candidates, applications, interviews, offers |
| `/ops/hr/onboarding`, `/ops/hr/offboarding` (+ `/{id}`) | `ops:lifecycle:read` | Lifecycle cases and checklists; job buttons |
| `/ops/hr/attendance` (+ `/me`, `/{id}`, `/corrections`, `/corrections/{id}`, `/import`) | `ops:attendance:read` / `:record` | Attendance, self-service, corrections, CSV import |
| `/ops/hr/shifts` (+ `/{id}`), `/ops/hr/leave` (+ `/{id}`, `/types`, `/balances`, `/availability`), `/ops/hr/timesheets` | `ops:shifts:read` / `ops:leave:read` / `ops:hr_reports:read` | Shifts and holidays, leave, timesheets |
