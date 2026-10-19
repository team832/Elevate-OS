# Business Ops OS

Elevate Education's operations module (`@elevate/business-ops-os`, Next.js, basePath `/ops`, port 3003): leads and admissions from first enquiry to the enrolment handoff, student administration and manual fee records, follow-ups, counselling and demos, tasks with dependencies, review and escalation, HR (employee records, recruitment, onboarding and offboarding, staff attendance, shifts, leave, compensation records, assets), SOPs with acknowledgements, a policies and compliance register, exceptions, the decision log, risks, projects, an approvals inbox and management reports. It is **not** payroll and not a full HRIS (D-028). Documented student flow: **lead → counselling → demo → admission → (enrolment in Academic OS) → onboarding → attendance → tests**.

Status: wave 2 plus the 19 Oct 2026 pass (D-028, D-029). Services and domain rules are **Tested** (repository result at ce7589c: 86 test files, 896 tests passed, 1 todo); the new screens are **Implemented** (type-checked, not yet built or rendered in a browser); nothing is Deployed and no migration exists yet. Requirement-by-requirement status: `requirements/REQUIREMENTS.md`.

## Run
| What | Command |
|---|---|
| Dev server alone | `npm run dev:ops` → http://localhost:3003/ops (needs `npm run db:start`, migrations from wave 3, `npm run db:seed`) |
| Typecheck | `npm run typecheck -w @elevate/business-ops-os` |
| Lint (Ops-owned files) | `npx eslint apps/business-ops-os packages/database/src/schema/ops.ts packages/authorization/src/permissions/ops.ts packages/shared-contracts/src/modules/ops.ts --max-warnings=0` |
| Tests | `npx vitest run apps/business-ops-os` (whole repo: `npm test`) |
| Build | `npm run build -w @elevate/business-ops-os` |

## Slices
1. **CRM and admissions** (OPS-001…012). Leads with normalised contacts (Indian numbers → `+91…`, emails lower-cased), enquiries with their own source, programme interest (`core.programmes`), owner + handoff acceptance, contact attempts (only a two-way contact counts as "contacted"), history. **Duplicate detection** warns and offers merge review; it never merges (A-01, A-02). **Admission pipeline** state machine with a legal-transition table (A-03): demo skip is an explicit, reasoned path controlled by a *proposed* setting. Confirmation gate (A-04): two fee verifications by different people + an authorised approval + documents + verified down payment; a demo fee alone is never an admission. **Enrolment handoff** (A-15): `ops.admission.enrolment_requested` v1 published in the same transaction as the status change (key `enrolmentKeys.request`), consumer `ops.enrolment-replies` applies `academic.enrolment.confirmed / rejected` exactly once. Counselling appointments and demo classes; demo terms come from the legacy record with their decision states (fee `pending_verification` under OD-013, limits `open` under OD-012). Follow-up due rules and IST overdue computation with daily reminders (A-05, A-06).
2. **Tasks and escalation** (OPS-016, 017). Owner, accountable owner, backup, due date, priority, BR-OPS-10 statuses, dependencies with cycle detection, completion needs evidence and no open blockers unless overridden (A-07, A-08). Escalation by configurable thresholds to the manager chain from staff reporting lines, audited (A-09). Links to leads, admissions, SOPs, decisions and projects.
3. **Staff directory** (OPS-014, 015). Business Ops is the **steward** of `core.departments` (13 provisional, D-026) and `core.staff_members`; role labels, employment type, reporting lines (loop-checked), responsibilities with holder and backup and a gap report, onboarding checklists with document references only. Payroll, biometrics and a full HRIS stay out of scope (D-015 as narrowed by D-028); HR records are slices 7 to 9 below.
4. **SOPs and workflows** (OPS-019, OPS-022, BR-OPS-15). Register with code, department, owner, reviewer, backup, statuses draft / in_review / approved / retired, versions that are never erased, checklists, approval through core approvals on a specific version; the owner cannot approve their own SOP and a reviewer must recommend it (A-11). Legacy registers imported with namespaced IDs; the online coordinator SOP enters as **draft** (OD-028). Exceptions/incidents register. Settings page = policy register with decision states.
5. **Business planning** (OPS-021, 023, 025). Decision log with the 24 legacy decisions (`LEGACY-OPSWB-D-…`, original status), risks/issues/blockers with flags, projects and milestones with dependency checks, the 25-row legacy work inventory (A-13).
6. **Management dashboard** (OPS-024). New leads, cohort lead → admission conversion, counselling/demo follow-up compliance, task completion rate, overdue work, unresolved blockers, workload per staff member (a capacity view, never a score or ranking) — definitions in `docs/KPI_DEFINITIONS.md`; denominator 0 is **missing, not 0 %**. Academic delivery and Marketing panels via `fetchInternal`; any failure shows **"source unavailable"**.

7. **Admissions administration** (OPS-070…079). Reason-coded closure, manually recorded fee records in integer paise (always labelled "manually recorded, not a verified payment"; A-17), student directory and profile with private contacts only for `ops:student_private:read` (A-18), consent and communication preferences, hardened handoff with attempt history and an audited retry after a dead delivery (A-19), admissions report with 11 KPIs (K-ADM, A-20). The contract field `existingStudentId` is sent for a second admission of the same person.
8. **HR records** (OPS-030…039). Employees with never-reused `EMP-####` codes, directory and profile with field tiers (A-21), organisation history and department-head succession, private HR fields, document metadata behind a storage adapter that reports `not_configured`, compensation records approved by a second person with an audited CSV export, work assets, HR records metrics.
9. **HR lifecycle** (OPS-040…049). Requisitions, candidates (minimal data, contacts restricted), applications, interviews with feedback, offers without salary, conversion to an employee, onboarding and offboarding cases with checklists, separation that disables the login through an event (`ops.employee.separated` v1), candidate anonymisation, lifecycle metrics.
10. **HR time** (OPS-050…059). Self clock-in/out and breaks, manual and CSV entries, corrections that never overwrite, late/early and missing-clock-out flags against assigned shifts, shift templates, holiday calendar, leave requests and approvals, balance ledger, team availability, timesheets with audited export. This is staff attendance only; Academic class attendance is never read. Every rule is a setting with state `proposed` or `open` (OD-026, OD-029…).
11. **Operations work** (OPS-060…069). Task comments, document references, supervisor review, reminders and filters, SOP effective/review dates, archive flag and required acknowledgements, policies and compliance register (nothing seeded), risk mitigations, blocked projects, incident resolution targets, approvals inbox, operations dashboard (K-OPS).

## Screens (`/ops/...`)
Dashboard (or "My work"), Reports (admissions, operations), Students and student profile, Approvals inbox, Assets, Policies register, HR (employees and record, departments, compensation, recruitment with requisition, candidate and application pages, onboarding and offboarding, attendance with self-service, corrections and CSV import, shifts, leave with types, balances and availability, timesheets), Leads list (filters, create with duplicate warnings, merge-review queue) and detail, Counselling & demo schedule, Admissions board and detail, Tasks (mine / overdue / escalated / blocked / open / all) and detail, Staff directory and staff detail, SOP register and detail, Incidents, Decisions, Risks, Projects (+ work inventory), Settings. Every screen checks its permission on the server before rendering and has empty and error states. Routes: `docs/API.md`. Navigation entries and a browser check are part of the wiring step (IR-OPS-12).

## Permissions (`packages/authorization/src/permissions/ops.ts`)
Full role by permission matrix, field-level rules and open access choices: `docs/PERMISSIONS.md`. Summary (scope `own` = records whose owner or counsellor is the user's staff record; for HR, the user's own record, plus the reporting chain for `department_manager`):

| Role | Ops access |
|---|---|
| `operations_manager` | Everything in Ops except the sensitive HR sets (private HR fields, employment documents, compensation); keeps student and guardian contacts. Assigns and merges leads, approves fee arrangements, SOPs and policies, stewards staff, runs jobs. |
| `admissions_counsellor` | Own leads, admissions, follow-ups, counselling, demos, tasks, fee reads, students and student contacts; SOPs and directory read-only. No SOP administration, staff administration, planning registers, dashboard or jobs. |
| `director` | Reads everything outside the sensitive sets; approves SOPs, policies, fee arrangements, selection and separations; records decisions. No private HR, compensation or student contacts. |
| `auditor` | Read only, outside the sensitive sets. |
| `academic_coordinator` | Admitted students and their handoff status. |
| `teacher` | Own tasks only (no module switcher entry yet, IR-OPS-01). |
| `hr_manager` | Employees, private HR fields, documents, compensation (read, manage, approve), assets, recruitment, lifecycle, attendance, shifts, leave, HR reports and export. |
| `hr_contributor` | Employee records, documents, assets, recruitment and lifecycle work, attendance, shifts, leave administration. No private fields, compensation or approvals. |
| `recruiter` | Own requisitions, candidates and interviews. |
| `department_manager` | Own reporting chain: employees, attendance and leave approval, lifecycle read, assets, HR reports. |
| `employee` | Self-service: own private fields and documents, attendance, leave, assets, tasks; directory read. |
| `finance_officer` | Compensation read, manage, approve and export; fee records; admissions read; HR reports. |
| `platform_admin`, `marketing_*` | No Ops access. |
The six HR profiles are profiles, not people: nobody holds them until a platform administrator assigns them (OD-009).
Pages and routes check permissions on the server; services check again (pages call services directly).

## Rules this module enforces
Missing is never zero; unapproved policies are configuration marked `proposed`/`open`/`pending_verification`; every state change is audited in the same transaction; dates are Asia/Kolkata calendar days; seeds are fictional (`(fictional)` names, `@example.test`, no phone numbers); external systems are adapters with a mock (`server/adapters/crm.ts` reports `not_configured`).

## Integration
- Produces `ops.admission.enrolment_requested` v1 (now with optional `existingStudentId`) and `ops.employee.separated` v1 (consumed by the platform's `platform.access-revocation`); consumes `academic.enrolment.confirmed` / `.rejected` v1 (consumer `ops.enrolment-replies`).
- Reads `GET /academic/api/internal/v1/summary` and `GET /marketing/api/internal/v1/summary`.
- Jobs (no scheduler yet, IR-OPS-02): follow-up reminders, task escalations, enrolment replies, task reminders, missing clock-out check, lifecycle reminders and separations. Routes: `docs/API.md` (Jobs).
- Adapters that report `not_configured`: CRM (OD-010), document storage (D-014), attendance device or provider (D-028). Requests to other owners: `docs/INTEGRATION_REQUESTS.md`.

## Seeds (`seed/`, run by `npm run db:seed`; all idempotent and fictional)
`ops.lead-sources` (12), `ops.staff` (2 fictional staff without logins + role labels), `ops.legacy-decisions` (24), `ops.legacy-work-inventory` (25), `ops.legacy-sops` (51: 25 + 16 not drafted, 9 + 1 drafts, none approved), `ops.legacy-responsibilities` (12, no holders), `ops.sample-pipeline` (4 fictional leads), `ops.sample-tasks` (3 fictional tasks), `ops.admissions-samples` (2 fictional admissions, 3 sample fee records), `ops.hr-employee-records` (employee records for the fictional staff, no private data, pay or documents), `ops.hr-lifecycle-samples` (1 draft requisition, 1 candidate), `ops.hr-time` (1 proposed shift template; no leave types, holidays or attendance). No policies, compensation or approved SOPs are seeded.

## Documentation
`docs/ARCHITECTURE.md` · `docs/DATA_MODEL.md` (diagram) · `docs/DOMAIN_MODEL.md` · `docs/API.md` (`docs/API_SPECIFICATION.md` points to it) · `docs/PERMISSIONS.md` · `docs/WORKFLOWS.md` (state diagrams) · `docs/ALGORITHMS.md` (A-01…A-56, 10-point format) · `docs/KPI_DEFINITIONS.md` · `docs/TEST_PLAN.md` · `docs/INTEGRATION_REQUESTS.md` · `requirements/REQUIREMENTS.md`.

## Owner decisions this module depends on
OD-009 (staff ↔ roles, holders and backups), OD-010 (CRM system of record), OD-011 (service hours, SLAs, escalation thresholds), OD-012 (demo limits), OD-013 (fee data scope, exception limits), OD-014 (identity documents), OD-021/OD-025 (programmes offered), OD-026 (staff leave, in scope under D-028; its policies are open), OD-027 (KPI targets), OD-028 (approve the coordinator and marketing SOPs), D-026 (department structure), and OD-029…OD-048 (attendance, shifts, holidays, leave, retention, compensation viewers, access revocation, employee ID format, recruitment rules, student identity matching, onboarding checklists, admissions closure reasons and fee checks): `docs/EXISTING_PROJECT_AUDIT.md` section 9.
