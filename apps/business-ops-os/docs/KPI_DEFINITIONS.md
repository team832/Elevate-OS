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
K-02 first contact within SLA (needs OD-011 service hours), K-03 median time to first contact, K-04/K-05 cohort counselling/demo rates, K-07 demo → admission, K-08 admissions confirmed, K-09 source mix, K-11 ownership health, K-12 duplicate rate, K-13 handoff timings, K-16–K-19 escalation/SOP/decision/risk aggregates, and target bands (OD-027). The data for most of them exists in the `ops` tables.
