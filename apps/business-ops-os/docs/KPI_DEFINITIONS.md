# Business Ops OS — KPI definitions (OPS-024)

Implemented in `src/domain/kpis.ts` and `src/domain/staff.ts` (pure), loaded by `src/server/dashboard.ts`, shown on `/ops` and `GET /ops/api/v1/dashboard`. Every KPI is a `Metric` (`ok | estimated | missing`, `@elevate/shared-contracts`) with its definition and window printed under the tile.

**Defaults.** Window = the Asia/Kolkata week (Monday–Sunday) containing today; `?from=&to=` override it. Every value states its as-of time. **Missing is not zero:** a rate with no denominator is `missing` with a reason, never 0 %. **Targets** are not set — they are owner decision OD-027, so no tile is coloured good/bad. **Owner** below means the role accountable for acting on the KPI (a proposal until OD-009 names people).

| KPI (PRD ref) | Numerator | Denominator | Reporting window | Source | Owner | Missing-data behaviour |
|---|---|---|---|---|---|---|
| New leads (K-01) | Leads whose first receipt date (IST) is in the window, excluding leads merged as duplicates | — (count) | Selected week | `ops.leads.first_received_at`, `merged_into_lead_id` | Admissions lead (`admissions_counsellor` team) | Always `ok`; 0 is a true zero (Ops is the system of record for leads entered here). If an external CRM stays the source (OD-010) the imported share is not yet shown (OPS-026, Proposed). |
| Lead → admission conversion (K-06, BR-OPS-8) | Leads received in the **cohort week** whose admission first reached `admitted` within **N** days of receipt (N = setting `kpi.conversion.windowDays`, default 30, proposed) | Leads received in the cohort week (merged excluded) | Cohort = the latest Monday–Sunday week whose N-day window has fully elapsed (`cohort end + N ≤ as-of`) | `ops.leads`, `ops.admission_transitions` (first `→ admitted`) | Operations manager | `missing` "Window not elapsed: available from <date>" if asked for a cohort too recent; `missing` "No leads were received in the cohort window" when the denominator is 0. Never "this week's admissions ÷ this week's leads". |
| Counselling and demo follow-up compliance (K-10 related) | Follow-ups of kind `counselling_followup` or `demo_followup`, due in the window with the due date already passed, completed on or before their due date (IST) | Those follow-ups (cancelled excluded) | Selected week, judged after each due date ends | `ops.follow_ups` | Admissions lead | `missing` when no such follow-up fell due in the window. Items due today are not judged yet. |
| Task completion rate (K-14/K-15 related) | Tasks due in the window (due on or before as-of) whose status is `completed` | Tasks due in the window, due on or before as-of, not cancelled | Selected week | `ops.tasks` | Operations manager | `missing` when no task was due. Tasks without a due date are not in the denominator (they appear as `missing_due` flags instead). |
| Overdue work (K-10/K-15) | Open tasks with due date < today (IST) + open follow-ups with due date < today | — (count, with the split shown) | Point in time (as-of) | `ops.tasks`, `ops.follow_ups` | Operations manager | Always `ok` (complete internal data). |
| Unresolved blockers (K-15/K-19) | Open or mitigating `issue`/`blocker` items in the risk register + tasks with status `blocked` | — (count, split shown) | Point in time | `ops.risks`, `ops.tasks` | Operations manager | Always `ok`. Risks of kind `risk` are not blockers. |
| Workload per staff member | Per active staff member: open tasks owned + open follow-ups owned + open admissions as counsellor | — | Point in time | `ops.tasks`, `ops.follow_ups`, `ops.admissions`, `core.staff_members` | Operations manager (capacity planning) | Rows sorted **by name**; it is a capacity view, **not a quality score and never a ranking**. Unassigned items are reported separately. |

## Cross-module panels

| Panel | Source | Behaviour |
|---|---|---|
| Academic delivery (K-20/K-21 related) | `GET /academic/api/internal/v1/summary?from&to` → `AcademicDeliverySummaryV1` via `fetchInternal` (caller `ops`) | Each metric is shown through `StatTile` (`missing` shows "Missing" + reason, `estimated` shows "≈" + basis). If the call fails, times out or the payload does not match the contract: **"Source unavailable"** with the reason — no numbers. |
| Marketing (K-22 related) | `GET /marketing/api/internal/v1/summary?from&to` → `MarketingSummaryV1` | Same; data-source connection states (`not_configured / sandbox / connected / error`) are listed as reported by Marketing. |

Base URL: `ACADEMIC_OS_URL` / `MARKETING_OS_URL` when set, else `PLATFORM_URL` (the platform rewrites `/academic/*` and `/marketing/*`).

## Not built (Proposed)
See the sections added below for admissions, HR and operations. Still not built: K-02 first contact within SLA (needs OD-011 service hours), K-03 median time to first contact, K-04/K-05 cohort counselling/demo rates, K-07 demo → admission, K-08 admissions confirmed, K-09 source mix, K-11 ownership health, K-12 duplicate rate, K-13 handoff timings, K-16–K-19 escalation/SOP/decision/risk aggregates, and target bands (OD-027). The data for most of them exists in the `ops` tables.


---

# KPIs added on 19 Oct 2026

Same conventions as above: every value is a `Metric` (`ok` or `missing`, never a guess), Asia/Kolkata dates, no targets (OD-027), nothing coloured good or bad. **Owner** = the role accountable for acting on the figure, a proposal until OD-009 names people. None of these is a performance score; HR and operations figures are counts and exceptions, sorted by name where they list people.

## Admissions report (`src/domain/admissions-kpis.ts`, `src/server/reports/admissions.ts`; permission `ops:admissions:read`, own scope for counsellors; `GET /ops/api/v1/admissions/report`, `/ops/reports/admissions`)
Default window: the IST Monday-to-Sunday week; `?from=&to=` overrides. Owner: admissions lead for K-ADM-01…07, 10, 11; operations manager for K-ADM-08, 09.

| KPI | Definition (numerator / denominator) | Period | Missing-data behaviour | Test |
|---|---|---|---|---|
| K-ADM-01 New enquiries | Enquiries received in the window (every enquiry, `ops.enquiries.received_at`). Count. | Window | Always `ok`; 0 is a real 0 | unit "enquiries count…"; report test |
| K-ADM-02 New leads by first source | Leads whose earliest enquiry is in the window, grouped by that enquiry's `source_code` (UNKNOWN stays UNKNOWN). | Window | Empty table "No new leads" | same |
| K-ADM-03 Admission cases by status | Current status of every admission case, merged leads excluded. | Point in time | Always `ok` | unit "pipeline snapshot"; report test |
| K-ADM-04 Counselling pending | `scheduled` sessions from now on, and past `scheduled` sessions with no outcome. Two counts. | Point in time | `ok` | unit "counselling and demos" |
| K-ADM-05 Upcoming demos | `scheduled` demos with a day in [today, today + 6]. Count. | Next 7 days | `ok` | same |
| K-ADM-06 Applications awaiting decision | `admission_pending` cases without an approved fee arrangement (split: approval pending). | Point in time | `ok` | unit "pipeline snapshot" |
| K-ADM-07 Offers awaiting response | `admission_pending` cases with an approved fee arrangement (nearest state to "offer made"). | Point in time | `ok` | same |
| K-ADM-08 Lead to admission conversion | The existing cohort KPI (setting `kpi.conversion`, proposed): admitted within N days ÷ cohort leads. | Latest elapsed cohort week | `missing` when the window has not elapsed or the cohort has no leads | `kpis.test.ts`; report test |
| K-ADM-09 Handoff outcomes and success rate | Request events published in the window: confirmed, rejected, failed (dead without a reply), awaiting. Rate = confirmed ÷ (confirmed + rejected + failed). | Window | Rate `missing` when no attempt has a final outcome | unit "handoff success rate"; report test |
| K-ADM-10 Overdue follow-ups | Open follow-ups with a due date before today. Count. | Point in time | `ok` | unit "overdue follow-ups…" |
| K-ADM-11 Closures by reason | `→ lost` transitions in the window by `reason_code` (null shown as "not coded"). | Window | Empty table | same |

Sources are `ops.*` tables. IST boundary: an enquiry at 18:30 UTC belongs to the next IST day. Not built: first-contact SLA (needs OD-011), cohort counselling and demo rates, source mix over time, duplicate rate.

## HR records (`src/server/reports/hr-records-metrics.ts`; permission `ops:hr_reports:read`, HR scope). Owner: HR manager.
| KPI | Function | Definition | Missing when |
|---|---|---|---|
| K-HR-01 Active employees | `activeEmployeesMetric(db, actor, now?)` | Employee records with status `active` on the day (onboarding, on notice and separated excluded). | No employee record exists in scope. |
| K-HR-02 Employees by department | `employeesByDepartmentMetric(db, actor, now?)` | Current (not separated) employee records per non-archived department, plus a "No department recorded" row. | No employee record exists in scope (every department shows `missing`, never 0). |
| K-HR-03 Upcoming joining dates | `upcomingJoiningDates(db, actor, {days = 30, now?})` | Onboarding or active employees whose recorded start date is in [today, today + days], listed; plus the count of onboarding employees with **no** start date (never guessed). | No employee record exists in scope. |

Tests: `hr-records-metrics.test.ts` (missing before any record; counts; department manager scope). The HR dashboard screen that shows them is not built (see `IMPLEMENTATION_STATUS.md`).

## HR lifecycle (`src/server/reports/hr-lifecycle-metrics.ts` → `hrLifecycleMetrics(db, actor, {from, to})`). Owner: HR manager.
Needs organisation-wide (`all` scope) `ops:recruitment:read` for K-HRL-01…03 and `ops:lifecycle:read` for K-HRL-04…07; without them the value is `missing` with that reason. Ids are assigned here (the slice note left them unnamed).

| KPI | Definition | Window | Other missing case |
|---|---|---|---|
| K-HRL-01 Pipeline by stage | Applications currently at each stage (applied, screening, interview, offer, hired, rejected, withdrawn). | Point in time | — |
| K-HRL-02 Open requisitions | Requisitions with status `open`. | Point in time | — |
| K-HRL-03 Unfilled openings | Openings on open requisitions minus hires recorded against them. | Point in time | — |
| K-HRL-04 Onboarding completion | Required checklist items resolved (done or not applicable) ÷ required items, across open onboarding cases. | Point in time | No open onboarding case, or the open cases have no required items |
| K-HRL-05 Open onboarding cases | Cases of kind onboarding with status `open`. | Point in time | — |
| K-HRL-06 Pending offboarding items | Unresolved items on offboarding cases that are `open` or `approved`. | Point in time | — |
| K-HRL-07 Separations | Employees whose separation was applied in the window (IST days). | Default: the last 30 days to today | — |

Tests: `hr-lifecycle-metrics.test.ts` (2 cases). Tile wiring on a dashboard is Proposed.

## HR time (`src/server/reports/hr-time-metrics.ts` → `hrTimeMetrics(db, actor, window)`; permission `ops:hr_reports:read`, HR scope). Owner: HR manager.
Counts are `ok` (0 open is a known fact). Hours are `ok` or `missing`. Staff attendance only; Academic class attendance is never read.

| KPI | Definition | Unit | Source | Missing when |
|---|---|---|---|---|
| K-HRT-01 `attendanceExceptionsOpen` | Sessions flagged missing clock-out and still open, plus correction requests pending, now. | count | `attendance_sessions`, `attendance_corrections` | The caller's scope has no staff records |
| K-HRT-02 `leaveRequestsAwaitingApproval` | Leave requests in `pending`, now. | count | `leave_requests` | same |
| K-HRT-03 `scheduledHours` | Paid scheduled hours from shift assignments in the window (holidays and non-working days excluded). | hours | shifts, holidays | Nobody in scope has an assignment in the window |
| K-HRT-04 `recordedHours` | Hours worked in closed, non-superseded sessions in the window, breaks excluded. | hours | `attendance_sessions` | No closed session in the window |

Tests: `hr-time-attendance.test.ts`, `hr-time-leave.test.ts` ("timesheets, export and metrics"). Timesheet totals (A-45) use the same rules.

## Operations (`domain/kpis.ts`, `src/server/reports/operations.ts`; permission `ops:dashboard:read`: operations manager, director, auditor). Owner: operations manager.
Point in time as of the request (IST today), from Ops' own complete tables. Counts are `ok`; a real 0 is 0; rates with a 0 denominator are `missing`. Capacity tables are sorted by name and are not rankings. Tests: unit "operations KPIs: missing is not zero"; integration "operations report".

| KPI | Numerator | Denominator | Source | Missing-data behaviour |
|---|---|---|---|---|
| K-OPS-01 Open tasks | Tasks not_started, in_progress, waiting, at_risk or blocked | — | `ops.tasks` | Always `ok` |
| K-OPS-02 Overdue tasks | Open tasks with due date before today | — | `ops.tasks` | Tasks without a due date excluded (flagged elsewhere) |
| K-OPS-03 Share of dated open tasks overdue | Overdue open tasks | Open tasks with a due date | `ops.tasks` | `missing` "No open task has a due date." |
| K-OPS-04 Tasks awaiting supervisor review | Pending `task_reviews` | — | `ops.task_reviews` | Always `ok` |
| K-OPS-05 Open tasks by department and by owner | Open, overdue, blocked and due in 7 days per group | — | `ops.tasks`, names | "No department" / "No owner" rows last |
| K-OPS-06 SOP versions awaiting approval | Pending core approvals of policy `ops.sop.approve` | — | `core.approvals` | Always `ok` |
| K-OPS-07 Outstanding SOP acknowledgements | Audience members with a login who have not acknowledged the version in force (once per person per SOP) | — | requirements, acknowledgements, staff, roles | Staff without a login reported separately |
| K-OPS-08 SOP acknowledgement coverage | Acknowledged | Required (with a login) | same | `missing` "No SOP version currently requires acknowledgement." |
| K-OPS-09 Unresolved incidents | Incidents open or in progress | — | `ops.incidents` | Always `ok` |
| K-OPS-10 Incidents past resolution target | Unresolved incidents in state `breached` (A-53) | — | `ops.incidents` and setting `incidents.resolution_sla` (proposed, shown) | Always `ok` |
| K-OPS-11 Blocked projects | Live projects with at least one block reason (A-54) | — | projects, milestones, tasks, risks | Always `ok` |
| K-OPS-12 Approvals waiting for you | Inbox total (A-52) | — | approval sources | `missing` when every source failed; partial failures flagged |
| K-OPS-13 Deadlines in the next 7 days | Open tasks, planned milestones, SOP and policy review dates, acknowledgement due dates with people outstanding, due today to today + 7 | — | several | Listed soonest first |
| K-OPS-14 Unresolved integration errors | `core.event_deliveries` with status failed or dead whose consumer is `ops.*` or whose event producer is `ops` | — | `core.event_deliveries`, `core.integration_events` (read-only) | Always `ok` |
