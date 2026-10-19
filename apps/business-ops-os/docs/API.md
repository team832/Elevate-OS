# Business Ops OS — API

Every route is built with `defineRoute` (`@elevate/server-kit`). Check order: **401** no session → **403** missing permission (before validation) → **400** `VALIDATION_FAILED` with `details: [{ location, path, message }]` → handler. Envelope: `{ "data": … }` / `{ "error": { code, message, details?, requestId } }` (D-012). Bodies are JSON (`Content-Type: application/json`).

**Scope.** A permission held with scope `own` (admissions counsellor; teacher for tasks) limits records to those whose owner/counsellor (tasks: owner/accountable/backup for reads, owner for writes) is the staff member linked to the signed-in user. Out-of-scope records return **403**. Services re-check permissions, so pages that call services directly are protected too.

**Error codes used.** `VALIDATION_FAILED` 400 (bad input, missing reason, invalid phone with field path), `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409 (exact duplicate contact with `details.duplicates`, dependency cycle with `details.cycle`, task blocked by open tasks, same-person fee verification, unique codes), `INVALID_STATE_TRANSITION` 409 (illegal pipeline/SOP/task move, double enrolment request, confirmation gate with `details.missing`), `INTERNAL` 500.

**Idempotency.** `POST /leads` and `POST /admissions/{id}/enrolment-request` accept an `Idempotency-Key` header: a retry with the same key and body replays the stored response (`idempotency-replayed: true`); a different body is 409. Without a key a second enrolment request is 409 because the admission already left `admitted` — either way exactly one outbox event exists per attempt.

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
| POST | `/ops/api/v1/jobs/{job}` | `ops:jobs:run` | Run a job by hand: follow-up-reminders | task-escalations | enrolment-replies (consumer ops.enrolment-replies). Idempotent. |

## Pre-existing routes

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/ops/api/v1/health` | public | Health incl. database |
| POST | `/ops/api/v1/auth/login` | public | Sign in (shared session cookie) |
| POST | `/ops/api/v1/auth/logout` | session | Sign out |

## Internal (server-to-server)

Business Ops **calls** `GET /academic/api/internal/v1/summary` and `GET /marketing/api/internal/v1/summary` with `fetchInternal` (`src/server/summaries.ts`). Its own `GET /ops/api/internal/v1/summary` is **Proposed** (P2, not built).

## Screens (pages)

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
