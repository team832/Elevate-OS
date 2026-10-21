# Business Ops OS — KPI definitions (OPS-024)

Implemented in `src/domain/kpis.ts` and `src/domain/staff.ts` (pure), loaded by `src/server/dashboard.ts`, shown on `/ops` and `GET /ops/api/v1/dashboard`. Every KPI is a `Metric` (`ok | estimated | missing`, `@elevate/shared-contracts`) with its definition and window printed under the tile.

**Defaults.** Window = the Asia/Kolkata week (Monday–Sunday) containing today; `?from=&to=` override it. Every value states its as-of time. **Missing is not zero:** a rate with no denominator is `missing` with a reason, never 0 %. **Targets** are not set — they are owner decision OD-027, so no tile is coloured good/bad. **Owner** below means the role accountable for acting on the KPI (a proposal until OD-009 names people).

| KPI (PRD ref) | Numerator | Denominator | Reporting window | Source | Owner | Missing-data behaviour |
|---|---|---|---|---|---|---|
| New leads (K-01) | Leads whose first receipt date (IST) is in the window, excluding leads merged as duplicates | — (count) | Selected week | `ops.leads.first_received_at`, `merged_into_lead_id` | Admissions lead (`admissions_counsellor` team) | Always `ok`; 0 is a true zero (Ops is the system of record for leads entered here). If an external CRM stays the source (OD-010) the imported share is not yet shown (OPS-026, Proposed). |
| Lead → admission conversion (K-06, BR-OPS-8) | Leads received in the **cohort week** whose admission first reached `admitted` within **N** days of receipt (N = setting `kpi.conversion.windowDays`, default 30, proposed) | Leads received in the cohort week (merged excluded) | Cohort = the latest Monday–Sunday week whose N-day window has fully elapsed (`cohort end + N ≤ as-of`) | `ops.leads`, `ops.admission_transitions` (first `→ admitted`) | Operations manager | `missing` "Window not elapsed: available from <date>" if asked for a cohort too recent; `missing` "No leads were received in the cohort window" when the denominator is 0. Never "this week's admissions ÷ this week's leads". |
| Counselling and demo follow-up compliance (K-10 related) | Follow-ups of kind `counselling_followup` or `demo_followup`, due in the window with the due date already passed, completed on or before their due date (IST) | Those follow-ups (cancelled excluded) | Selected week, judged after each due date ends | `ops.follow_ups` | Admissions lead | `missing` when no such follow-up fell due in the window. Items due today are not judged yet. |
| Overdue follow-ups (K-10) | Open follow-ups with due date < today (IST) | — (count) | Point in time (as-of) | `ops.follow_ups` | Operations manager | Always `ok` (complete internal data). |
| Workload per staff member | Per active staff member: open follow-ups owned + open admissions as counsellor | — | Point in time | `ops.follow_ups`, `ops.admissions`, `core.staff_members` | Operations manager (capacity planning) | Rows sorted **by name**; it is a capacity view, **not a quality score and never a ranking**. Unassigned items are reported separately. |

## Cross-module panels

| Panel | Source | Behaviour |
|---|---|---|
| Academic delivery (K-20/K-21 related) | `GET /academic/api/internal/v1/summary?from&to` → `AcademicDeliverySummaryV1` via `fetchInternal` (caller `ops`) | Each metric is shown through `StatTile` (`missing` shows "Missing" + reason, `estimated` shows "≈" + basis). If the call fails, times out or the payload does not match the contract: **"Source unavailable"** with the reason — no numbers. |
| Marketing (K-22 related) | `GET /marketing/api/internal/v1/summary?from&to` → `MarketingSummaryV1` | Same; data-source connection states (`not_configured / sandbox / connected / error`) are listed as reported by Marketing. |

Base URL: `ACADEMIC_OS_URL` / `MARKETING_OS_URL` when set, else `PLATFORM_URL` (the platform rewrites `/academic/*` and `/marketing/*`).

## Not built (Proposed)
See the admissions section below. Still not built: K-02 first contact within SLA (needs OD-011 service hours), K-03 median time to first contact, K-04/K-05 cohort counselling/demo rates, K-07 demo → admission, K-08 admissions confirmed, K-09 source mix, K-11 ownership health, K-12 duplicate rate, K-13 handoff timings and target bands (OD-027). K-14, K-15 (task part) and K-16–K-19 (escalation, SOP, decision, risk aggregates) were **removed with Operations (owner, 2026-10-20, D-032)**; the task completion rate and unresolved-blocker tiles went with them. The data for most of them exists in the `ops` tables.


---

# KPIs added on 19 Oct 2026

Same conventions as above: every value is a `Metric` (`ok` or `missing`, never a guess), Asia/Kolkata dates, no targets (OD-027), nothing coloured good or bad. **Owner** = the role accountable for acting on the figure, a proposal until OD-009 names people. None of these is a performance score.

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

The HR records, HR lifecycle, HR time and Operations KPI sections were **removed by the owner on 2026-10-20 (D-032)**; recoverable from git commit 63da4e4.

---

# Admissions overview (21 Oct 2026, owner brief §4)

`src/domain/admissions-kpis.ts` (pure) loaded by `src/server/admissions-overview.ts` (`buildAdmissionsOverview`), shown on `/ops/admissions/overview`. Permission `ops:admissions:read` (own scope = the counsellor's cases); demo-list figures need `ops:leads:read`; money figures need `ops:fees:read` (otherwise the money block is absent, not ₹0). Default window: the last 30 IST days (today − 29 … today); `?from=&to=` and `?programme=` (demos by the demo's programme, everything else by the case's) narrow every figure. No targets (OD-027); nothing is coloured good or bad. Missing is never zero. Tests: unit `admissions-kpis-overview.test.ts`; integration `admissions-overview.test.ts`.

| KPI | Definition | Period | Missing-data behaviour |
|---|---|---|---|
| Demo list tiles | Taken from `listDemos` itself, so a tile and its list agree | As the demo list | absent without `ops:leads:read` |
| Demo days attended | Demos with a class in the window; a day counts once when one of its classes was attended (present or late). Classes are not days. Also: planned days, demos with every planned day attended (`attended ≥ planned`) | Window | `missing` "No demo had a class in the window." |
| Demo → admission conversion | Cohort = demos whose first demo day (earliest class not cancelled) is in the window AND whose `kpi.conversion.windowDays` (30, proposed) have passed; converted = reached "admission confirmed" within that many days of the first demo day (a confirmation before the first demo day does not count). Demos still inside their window are shown apart as `waiting`, never as not converted | Cohort window | `missing` when every demo is still waiting, or no demo had its first day in the window |
| Applications awaiting | Applications at draft, ready for review, form generated, signatures confirmed right now (the list's status filter shows the same rows) | Point in time | real 0 |
| Waiting for approval — blocked | Of the applications at "signatures confirmed", how many the confirmation gap check (A-APP-3) still blocks. The check runs for at most the **50 oldest** per page view (`APPROVAL_CHECK_LIMIT`); above that the screen says "Of the 50 oldest checked" | Point in time | — |
| Admissions confirmed | Final confirmations (A-APP-4) on an IST day in the window, one per admission case. Legacy admissions without an approval record are not counted | Window | real 0 |
| Overdue onboarding | Checklist items of current (not former) students with a due date before today that are not completed or not applicable, and how many admissions have one | Point in time | `missing` "No onboarding checklist has been built yet." |
| Fees collected | Received minus refunds by payment date (IST) in the window, per charge (tuition, registration, demo); voided and reversed rows never count | Window | `null` (unknown) when there is no fee record at all |
| Tuition outstanding | Owed (and credit held) across ACTIVE agreements (A-FEE-1) | Point in time | `null` when there is no active agreement |

**Admissions report change (21 Oct 2026):** a demo counts as completed when every planned demo DAY was attended (`demoProgress(...).attended ≥ plannedDayCount`), not by a count of classes. K-ADM-06 / K-ADM-07 still read the admission-level fee-arrangement decision; since A-FEE-8 the approval that matters is per agreement version, so these two tiles describe the older path (to revisit with the owner).
