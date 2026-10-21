# Business Ops OS — fee plans, Marketing lead handoff, admissions reports (part for merging)

> **Merged on 21 Oct 2026.** Kept as a detailed appendix. Final ids: OPS-109 … OPS-119; rules A-FEE-1 … 5, A-INT-1, A-REP-1 … 3 are now A-76 … A-84. Canonical docs: `../../README.md`, `../../requirements/REQUIREMENTS.md`, `../DATA_MODEL.md`, `../WORKFLOWS.md`, `../API.md`, `../PERMISSIONS.md`, `../ALGORITHMS.md`, `../TEST_PLAN.md`, `../INTEGRATION_REQUESTS.md`. The migration it asks for exists: `packages/database/migrations/0003_admissions_workspace.sql`. Where this file and the canonical docs differ, the canonical docs win.

Owner brief 20 Oct 2026, chunks 5 (fees), 8, §8E, §10, §15; nav "Reports: Admissions Funnel, Demo Conversion". Built by agent D on 20 Oct 2026. The coordinator merges this into `README.md`, `requirements/REQUIREMENTS.md`, `docs/{DATA_MODEL,API_SPECIFICATION/API,ALGORITHMS,PERMISSIONS,WORKFLOWS,TEST_PLAN,INTEGRATION_REQUESTS}.md`. Status words per D-013; nothing is Deployed. "Tested" = a passing automated test named below; screens are **Implemented** (not browser-checked: no dev server was run in this build).

## 1. Requirements

| Area | What | Status | Evidence |
|---|---|---|---|
| Fee plans | Plan per admission + canonical student (`core.students`), total in integer paise (INR), pricing reference text, instalments (sequence, IST due date, amount; sum = total), `draft → active` only when the admission's fee-arrangement approval (core approvals, no self-approval) is approved — approver and time copied; `close` with reason; one open plan per admission | **Tested** | `tests/integration/fee-plans.test.ts` |
| Instalment ledger | Existing `ops.fee_records` with new kinds `discount`, `waiver` (payment = `received`), `plan_id`/`instalment_id`; append-only for plans (corrections = new `adjustment` rows); refund ≤ net received; discount/waiver need a reason; every row "manually recorded, not a verified payment" | **Tested** | unit `fee-plans.test.ts`; integration `fee-plans.test.ts` |
| Instalment status | `paid / partly_paid / overdue / due / upcoming` from ledger allocation (A-FEE-2, **proposed**) | **Tested** | unit `fee-plans.test.ts` (status matrix) |
| Reconciliation + chart | Donut paid vs outstanding only when plan and ledger reconcile (A-FEE-4); tables always | **Tested** (gate) · **Implemented** (screen) | unit `fee-plans.test.ts` → "reconciliation gate" |
| List fee status | `feeStatusForStudents(db, studentIds)` → `paid / due / overdue / not_configured` (active plans only; no plan = not configured, never paid) | **Tested** | integration `fee-plans.test.ts` → "feeStatusForStudents" |
| Student profile section | `src/ui/student-fees-section.tsx` (props `{ studentId, user }`): plan summary, instalments, ledger, donut, forms with `ops:fees:record`; nothing financial without `ops:fees:read` | **Implemented** | server permissions tested (403 for the academic coordinator, own scope for counsellors) |
| Fee structure | `ops.fee_structures`: one row per programme combination + mode (codes from `catalog.ts`), amount in paise per course or per month, instalment template, `source` sample / website_stated / owner_approved, `status` draft / approved (only owner-approved can be approved, A-FEE-6); seeded with one SAMPLE row per allowed combination ("sample figure, replace with your real fee") and the two prices elevateeducation.in states (Commerce + CUET ₹10,000/month, ACE Batch ₹12,000/month — drafts, not owner-approved). No real fee has been given by the owner (OD-013). Screen: phase 2 | **Tested** (API, rule) | unit `fee-plans.test.ts` → A-FEE-6; integration `fee-structures.test.ts` |
| Marketing lead handoff | Event `marketing.lead.handed_off` v1 (consumer-defined), consumer `ops.lead-intake`, receipts with `received / duplicate_review / accepted / failed`, attempts, last error; idempotent per Marketing lead id; attribution kept (enquiry source + campaign ref; campaign name/channel/source reference in the event, shown only with `ops:lead_attribution:read`); uncertain match → existing duplicate-review queue, never merged; failure recorded and retried (job + audited manual retry) | **Tested** | `tests/integration/lead-intake.test.ts` |
| Live Marketing sync | Marketing does not produce the event: mock publisher for tests/seeds only; UI says "Live sync with Marketing OS: not configured" | **Proposed** (IR-MKT-OPS-HANDOFF) | — |
| Leads "From Marketing" | `/ops/leads?view=marketing`: receipts by status with counts, retry (manager), "Review the duplicate", "Book a demo" (links to A's booking drawer `/ops/admissions?new=1`; it does not preselect the lead yet) | **Implemented** | — |
| Reports | `/ops/reports/admissions#funnel`, `#demo-conversion`, `#students`; API `GET /ops/api/v1/admissions/report` adds `funnelReport` | **Tested** (API, domain) · **Implemented** (screen) | unit `admissions-funnel.test.ts`; integration `admissions-report-funnel.test.ts` |
| Fixtures | `ops.fees-intake-fixtures`: Zoya (active plan, payment + discount), Kiran (draft plan), two mock handoffs (@example.test), SAMPLE DATA, idempotent | **Tested** | `tests/integration/fee-plans-seed.test.ts` |

## 2. Data model (`packages/database/src/schema/ops-fees-intake.ts`; `ops.ts` edits marked)

- `ops.fee_plans`: `admission_id` → ops.admissions, `student_id` → core.students, `label`, `pricing_reference`, `total_paise` (> 0), `currency` = INR, `status` draft|active|closed, `approval_id` → core.approvals, `approved_by/at`, `closed_by/at`, `close_reason`, `created_by/at`, `updated_at`. Unique: one non-closed plan per admission. Checks: active/closed need approval fields; closed needs reason.
- `ops.fee_instalments`: `plan_id`, `sequence` (unique per plan, ≥ 1), `due_date` (IST date), `amount_paise` (> 0), `note`.
- `ops.lead_handoff_receipts`: `marketing_lead_id` (unique, plain UUID — Marketing), `event_id` → core.integration_events, `status`, `attempts`, `duplicate_deliveries`, `last_error`, `lead_id` → ops.leads (required for accepted / duplicate_review), `received_at`, `processed_at`.
- `ops.fee_records` (ops.ts): kinds + `discount`, `waiver`; new nullable `plan_id`, `instalment_id` (plain UUIDs — `ops.ts` cannot import `ops-fees-intake.ts` without a cycle; `recordFee` checks plan ↔ admission and instalment ↔ plan), index `fee_records_plan_idx`.
- No new lead columns: attribution lives on the lead's first `ops.enquiries` row (`source_code`, `campaign_ref`, `channel`) and in the stored event.
- `ops.fee_structures` (migration `0006_fee_structures.sql`): `programme_codes` text[] (1–3), `label`, `mode` online|offline_sikar|both, `amount_paise` (> 0), `billing_period` course_total|per_month, `instalment_count` (1–24), `instalment_note`, `billing_note`, `source` sample|website_stated|owner_approved, `source_note`, `status` draft|approved, `is_sample` (= source is sample), `updated_by/at`. Unique per (codes, mode). Checks: approved ⇒ owner_approved. Fee plans keep a text `pricing_reference` (no FK to the structure).

## 3. API (all `defineRoute`; 401 → 403 → 400 → handler; services re-check)

| Method + path | Permission | Notes |
|---|---|---|
| `GET /ops/api/v1/fee-plans?studentId=` | `ops:fees:read` (own scope) | plans, instalments with status, ledger, totals, reconciliation, `hiddenPlans`, disclaimer |
| `POST /ops/api/v1/fee-plans` | `ops:fees:record` | `{ admissionId | admissionCode, studentId, label, pricingReference?, totalPaise | totalRupees, instalments[{ dueDate, amountPaise | amountRupees, note? }] }` → 201 draft; 409 if an open plan exists |
| `POST /ops/api/v1/fee-plans/{id}` | `ops:fees:record` | `{ action: 'activate' }` (409 until the fee arrangement is approved) or `{ action: 'close', reason }` |
| `POST /ops/api/v1/fee-plans/{id}/entries` | `ops:fees:record` | `{ kind: received|refund|discount|waiver|adjustment, direction?, amountPaise | amountRupees, instalmentId?, paymentDate?, receiptReference?, method?, notes? }` → 201; plan must be active |
| `GET /ops/api/v1/fee-structures` | `ops:fees:read` | every row with its source; `anyApproved` |
| `PATCH /ops/api/v1/fee-structures/{id}` | `ops:fees:record` (+ `ops:admissions:approve` to promote or change an approved row) | A-FEE-6; audited `fee_structure.updated` with the reason |
| `GET /ops/api/v1/leads/handoffs?status=` | `ops:leads:read` (own: handoffs whose lead you own) | no contacts; `attribution` null without `ops:lead_attribution:read`; `counts` per status |
| `POST /ops/api/v1/leads/handoffs/{id}/retry` | `ops:lead_handoffs:manage` | failed receipts only (409 otherwise); audited `lead_handoff.retry_requested` |
| `POST /ops/api/v1/jobs/lead-intake` | `ops:jobs:run` (+ `ops:lead_handoffs:manage` in the service) | processes new events, then retries receipts that failed before the run (< 5 attempts) |
| `GET /ops/api/v1/admissions/report` | `ops:admissions:read` (own scope) | existing KPIs + `funnelReport { window, funnel[], demoConversion{ total, byProgramme, byCounsellor, bySource|null }, students{ active, on_hold, former } }` |

`feeStatusForStudents(db, studentIds, now?)` (src/server/fees.ts) — for Active Students and other lists: returns `Map<studentId, 'paid'|'due'|'overdue'|'not_configured'>`. No permission check inside: show it only to holders of `ops:fees:read`.

## 4. Algorithms (10-point format: purpose · inputs · outputs · preconditions · rule · edge cases · permissions · audit · tests · status)

**A-FEE-1 Plan totals.** Purpose: totals that always equal the ledger. Inputs: plan total, instalments, plan ledger rows. Outputs: total, scheduled, paid, refunded, net paid, reductions (discount + waiver + credit adj − debit adj), outstanding = total − reductions − net paid. Pre: integer paise. Rule: sum non-voided rows per kind. Edge: voided rows ignored; outstanding may be negative (then not reconciled). Permissions: read `ops:fees:read`. Audit: n/a (read). Tests: unit "A-FEE-1". Status: Tested.

**A-FEE-2 Allocation (PROPOSED, setting `fees.allocation`).** Purpose: say which instalments are covered. Inputs: instalments, net paid, reductions. Output: allocated paise per instalment. Rule: pool = max(0, net paid + reductions), applied oldest due date first (then sequence). Edge: an instalment reference on a ledger row is kept for the receipt trail but does not steer allocation; over-payment leaves the last instalment fully allocated (and fails reconciliation). Owner decision: confirm the order. Tests: unit "A-FEE-2". Status: Tested.

**A-FEE-3 Instalment status.** paid if allocated ≥ amount; else overdue if due date < today (IST); else partly_paid if allocated > 0; else due if due date ≤ today + `dueWindowDays` (proposed default 7); else upcoming. Tests: unit status matrix (8 rows). Status: Tested.

**A-FEE-4 Reconciliation gate.** Reconciled when: instalments sum to the total; refunds ≤ payments; reductions ≥ 0; outstanding ≥ 0; only plan kinds on the plan; instalment refs belong to the plan. Only then is the donut drawn (accessible SVG: `role="img"`, `aria-label` with the figures, a `<title>`, figures repeated in text; table always shown). Tests: unit "A-FEE-4". Status: Tested.

**A-FEE-5 List fee status.** No active plan → not_configured (a draft is not configured); any overdue instalment → overdue; all paid → paid; else due. Tests: unit + integration. Status: Tested.

**A-FEE-6 Fee structure edits.** Purpose: the owner's fee structure is data, never a silent choice. Inputs: the row (source, status) and the edit. Rule: an `approved` row must be `owner_approved` (sample and website figures stay drafts; also a DB check); moving to `owner_approved` or `approved`, or changing any term of an approved row, needs `ops:admissions:approve`; promoting needs a reason ≥ 10 characters; a person can only set the source to `owner_approved`; `is_sample` follows the source. Audit: `fee_structure.updated` (before, after, reason). Tests: unit A-FEE-6 (8 cases), integration `fee-structures.test.ts`. Status: Tested.

**A-INT-1 Lead handoff intake.** Purpose: one Ops lead per Marketing lead, attribution kept. Inputs: `marketing.lead.handed_off` v1 events. Rule: per event (outbox delivery, exactly once per consumer) upsert the receipt by `marketing_lead_id`; a later event for a receipt that is not failed only increments `duplicate_deliveries` (audited `lead_handoff.duplicate_ignored`); otherwise process in a savepoint: map course interest to a programme code (code or name, case-insensitive; else keep the text in the lead notes, owner decision 20 Oct 2026), `createLead` (normalised contacts, first enquiry with source code, channel, campaign ref, admission case, follow-up rule, audit, duplicate flags), record consent in `ops.contact_preferences`. Any duplicate match → `duplicate_review` (existing queue, never merged), else `accepted`. A thrown error rolls back only the savepoint and marks the receipt `failed` with the message and attempt count. Retry: job (< 5 attempts) or manager route. Edge: unknown source code → failed until the source exists in Ops; refused consent stores no channels. Actor: the staff user running the intake (no system user exists — IR to Platform). Tests: `lead-intake.test.ts` (5 cases). Status: Tested.

**A-REP-1 Admissions funnel.** Cohort: leads first received in the period (IST), merged excluded, own scope for counsellors. Stages (each counted only if its denominator stage is reached): leads → demo booked (any demo row) → attended ≥ 1 (a `present` session) → attended every planned class (present ≥ planned count; denominator attended) → converted (demo outcome `converted`; denominator attended) → enrolled (converted admission has `enrolled_at`; denominator converted). Rate = count ÷ denominator, one decimal; denominator 0 → "Not enough data". Admissions without a demo are outside this funnel. Tests: unit + integration. Status: Tested.

**A-REP-2 Demo conversion.** Demos with a class in the period (same rule as the demo list's date filter, so links match). Groups: programme (demo programme, else lead interest), counsellor, first source + campaign (only with `ops:lead_attribution:read`). Rate = converted ÷ demos with an outcome (open demos excluded); 0 decided → not enough data. Converted counts link to `/ops/admissions?view=previous&outcome=converted&from&to&programme|counsellor`. Status: Tested.

**A-REP-3 Student summary.** Admissions with a student identity, population from `studentPopulation` (agent B); each student once, active > on hold > former. Links to `/ops/students?view=active|on_hold|former`. Status: Tested (domain), counts 0 in integration (Active needs Academic confirmation).

## 5. Permissions (packages/authorization/src/permissions/ops.ts)

New: `ops:lead_attribution:read` (operations manager; director and auditor via the read baseline; not counsellors), `ops:lead_handoffs:manage` (operations manager). Reused: `ops:fees:read` (counsellor own scope, finance officer, director, auditor), `ops:fees:record` (finance officer, operations manager), `ops:admissions:read`, `ops:leads:read`, `ops:jobs:run`. The permission matrix doc needs `npm run docs:permissions` (Integration).

## 6. Settings

`fees.allocation` = `{ rule: 'oldest_due_first', dueWindowDays: 7 }`, **proposed** (owner to confirm order and window). Existing `fees.recording` (receipt reference required) applies to plan payments/refunds.

## 7. Limitations / open

- Not browser-checked (no dev server in this build); `npm run build` not run (tree mid-edit by other agents).
- Legacy `void` still exists for admission-level fee records; `POST /fees/{id}` refuses to void a plan ledger row (409: record an adjustment instead).
- "Book a demo" from a handoff opens A's booking drawer without preselecting the lead.
- Campaign ref on `ops.enquiries` is still returned by the existing lead detail API to every `ops:leads:read` holder (leads.ts not changed); only the handoff list hides attribution.
- No system user for event consumers: intake rows are attributed to the user who ran the job.

## 8. Integration requests

- **IR-MKT-OPS-HANDOFF** (apps/marketing-os/docs/INTEGRATION_REQUESTS.md): Marketing to produce `marketing.lead.handed_off` v1 with `marketingLeadHandoffKey`.
- Integration: regenerate the permission matrix; include `ops.fee_plans`, `ops.fee_instalments`, `ops.lead_handoff_receipts` and the `fee_records` columns in the migration; schedule the `lead-intake` job.
- Platform: a system principal for outbox consumers (so intake is not attributed to whoever ran the job).
