# Business Ops OS

Elevate Education's operations module (`@elevate/business-ops-os`, Next.js, basePath `/ops`, port 3003): leads and admissions from first enquiry to the enrolment handoff, follow-ups, counselling and demos, tasks with dependencies and escalation, the staff directory and responsibilities, SOPs, exceptions, the decision log, risks, projects, and a management dashboard. Documented student flow: **lead → counselling → demo → admission → (enrolment in Academic OS) → onboarding → attendance → tests**.

Status: wave 2, **Implemented and Tested** for the slices below; nothing is Deployed. Requirement-by-requirement status: `requirements/REQUIREMENTS.md`.

## Run
| What | Command |
|---|---|
| Dev server alone | `npm run dev:ops` → http://localhost:3003/ops (needs `npm run db:start`, migrations from wave 3, `npm run db:seed`) |
| Typecheck | `npm run typecheck -w @elevate/business-ops-os` |
| Lint (Ops-owned files) | `npx eslint apps/business-ops-os packages/database/src/schema/ops.ts packages/authorization/src/permissions/ops.ts packages/shared-contracts/src/modules/ops.ts --max-warnings=0` |
| Tests | `npx vitest run apps/business-ops-os` |
| Build | `npm run build -w @elevate/business-ops-os` |

## Slices
1. **CRM and admissions** (OPS-001…012). Leads with normalised contacts (Indian numbers → `+91…`, emails lower-cased), enquiries with their own source, programme interest (`core.programmes`), owner + handoff acceptance, contact attempts (only a two-way contact counts as "contacted"), history. **Duplicate detection** warns and offers merge review; it never merges (A-01, A-02). **Admission pipeline** state machine with a legal-transition table (A-03): demo skip is an explicit, reasoned path controlled by a *proposed* setting. Confirmation gate (A-04): two fee verifications by different people + an authorised approval + documents + verified down payment; a demo fee alone is never an admission. **Enrolment handoff** (A-15): `ops.admission.enrolment_requested` v1 published in the same transaction as the status change (key `enrolmentKeys.request`), consumer `ops.enrolment-replies` applies `academic.enrolment.confirmed / rejected` exactly once. Counselling appointments and demo classes; demo terms come from the legacy record with their decision states (fee `pending_verification` under OD-013, limits `open` under OD-012). Follow-up due rules and IST overdue computation with daily reminders (A-05, A-06).
2. **Tasks and escalation** (OPS-016, 017). Owner, accountable owner, backup, due date, priority, BR-OPS-10 statuses, dependencies with cycle detection, completion needs evidence and no open blockers unless overridden (A-07, A-08). Escalation by configurable thresholds to the manager chain from staff reporting lines, audited (A-09). Links to leads, admissions, SOPs, decisions and projects.
3. **Staff directory** (OPS-014, 015). Business Ops is the **steward** of `core.departments` (13 provisional, D-026) and `core.staff_members`; role labels, employment type, reporting lines (loop-checked), responsibilities with holder and backup and a gap report, onboarding checklists with document references only. **No payroll, biometrics, leave or HRIS** (D-015, OD-026).
4. **SOPs and workflows** (OPS-019, OPS-022, BR-OPS-15). Register with code, department, owner, reviewer, backup, statuses draft / in_review / approved / retired, versions that are never erased, checklists, approval through core approvals on a specific version; the owner cannot approve their own SOP and a reviewer must recommend it (A-11). Legacy registers imported with namespaced IDs; the online coordinator SOP enters as **draft** (OD-028). Exceptions/incidents register. Settings page = policy register with decision states.
5. **Business planning** (OPS-021, 023, 025). Decision log with the 24 legacy decisions (`LEGACY-OPSWB-D-…`, original status), risks/issues/blockers with flags, projects and milestones with dependency checks, the 25-row legacy work inventory (A-13).
6. **Management dashboard** (OPS-024). New leads, cohort lead → admission conversion, counselling/demo follow-up compliance, task completion rate, overdue work, unresolved blockers, workload per staff member (a capacity view, never a score or ranking) — definitions in `docs/KPI_DEFINITIONS.md`; denominator 0 is **missing, not 0 %**. Academic delivery and Marketing panels via `fetchInternal`; any failure shows **"source unavailable"**.

## Screens (`/ops/...`)
Dashboard (or "My work"), Leads list (filters, create with duplicate warnings, merge-review queue) and detail, Counselling & demo schedule, Admissions board and detail, Tasks (mine / overdue / escalated / blocked / open / all) and detail, Staff directory and staff detail, SOP register and detail, Incidents, Decisions, Risks, Projects (+ work inventory), Settings. Every screen checks its permission on the server before rendering, streams a loading state, and has empty and error states.

## Permissions (`packages/authorization/src/permissions/ops.ts`)
| Role | Ops access |
|---|---|
| `operations_manager` | Everything in Ops (incl. assign/merge leads, approve fee arrangements and SOPs, staff stewardship, settings, jobs). |
| `admissions_counsellor` | Own leads, admissions, follow-ups, counselling, demos and tasks (scope `own` = owner/counsellor is their staff record); SOPs and directory read-only; **no** SOP administration, staff administration, planning registers, dashboard or jobs. |
| `director` | Reads everything; approves SOPs and fee arrangements; records decisions. |
| `auditor` | Read only (all `read`/`access` permissions). |
| `teacher` | Own tasks only (read and update status). No module switcher entry yet — see IR-OPS-01. |
| others | No access. |
Pages and routes check permissions on the server; services check again (pages call services directly).

## Rules this module enforces
Missing is never zero; unapproved policies are configuration marked `proposed`/`open`/`pending_verification`; every state change is audited in the same transaction; dates are Asia/Kolkata calendar days; seeds are fictional (`(fictional)` names, `@example.test`, no phone numbers); external systems are adapters with a mock (`server/adapters/crm.ts` reports `not_configured`).

## Integration
- Produces `ops.admission.enrolment_requested` v1; consumes `academic.enrolment.confirmed` / `.rejected` v1 (consumer `ops.enrolment-replies`).
- Reads `GET /academic/api/internal/v1/summary` and `GET /marketing/api/internal/v1/summary`.
- Jobs (no scheduler yet): `POST /ops/api/v1/jobs/{follow-up-reminders | task-escalations | enrolment-replies}` — exported as `runFollowUpReminders`, `runTaskEscalations`, `processEnrolmentReplies` from `@elevate/business-ops-os/server`.
- Requests to other owners: `docs/INTEGRATION_REQUESTS.md`.

## Seeds (`seed/`, run by `npm run db:seed`)
`ops.lead-sources` (12), `ops.staff` (2 fictional staff without logins + role labels), `ops.legacy-decisions` (24), `ops.legacy-work-inventory` (25), `ops.legacy-sops` (51: 25 + 16 not drafted, 9 + 1 drafts, none approved), `ops.legacy-responsibilities` (12, no holders), `ops.sample-pipeline` (4 fictional leads), `ops.sample-tasks` (3 fictional tasks). Idempotent.

## Documentation
`docs/ARCHITECTURE.md` · `docs/DOMAIN_MODEL.md` · `docs/API.md` · `docs/ALGORITHMS.md` (A-01…A-16, 10-point format) · `docs/KPI_DEFINITIONS.md` · `docs/TEST_PLAN.md` · `docs/INTEGRATION_REQUESTS.md` · `requirements/REQUIREMENTS.md`.

## Owner decisions this module depends on
OD-009 (staff ↔ roles, holders and backups), OD-010 (CRM system of record), OD-011 (service hours, SLAs, escalation thresholds), OD-012 (demo limits), OD-013 (fee data scope, exception limits), OD-014 (identity documents), OD-021/OD-025 (programmes offered), OD-026 (staff leave), OD-027 (KPI targets), OD-028 (approve the coordinator and marketing SOPs), D-026 (department structure).
