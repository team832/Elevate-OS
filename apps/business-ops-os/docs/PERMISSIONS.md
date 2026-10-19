# Business Ops OS: permissions by role

Generated from `packages/authorization/src/permissions/ops.ts` on 19 Oct 2026 (re-read after the wiring changes). The platform-wide matrix in `docs/SECURITY_AND_PERMISSIONS.md` is produced by `npm run docs:permissions`; it must be rerun (IR-OPS-04), and this file should be regenerated from the same source. Roles are permission profiles, not people: nobody holds `hr_manager`, `hr_contributor`, `recruiter`, `department_manager`, `employee` or `finance_officer` until a platform administrator assigns it (D-028, OD-009). A company email address grants nothing.

Every page, route and service checks its permission on the server. `platform_admin`, `marketing_manager` and `marketing_contributor` hold no Ops permission.

## Matrix (61 permissions, 15 roles)
● = all records. ○ = `own` scope. (S) = sensitive set (below). Blank = no grant. `plat` = platform_admin, `dir` = director, `mkt-m` = marketing_manager, `mkt-c` = marketing_contributor, `acad` = academic_coordinator, `tchr` = teacher, `couns` = admissions_counsellor, `ops-m` = operations_manager, `audit` = auditor, `hr-m` = hr_manager, `hr-c` = hr_contributor, `recr` = recruiter, `dept-m` = department_manager, `emp` = employee, `fin` = finance_officer.

| Permission | plat | dir | mkt-m | mkt-c | acad | tchr | couns | ops-m | audit | hr-m | hr-c | recr | dept-m | emp | fin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `ops:module:access` |  | ● |  |  | ● |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `ops:dashboard:read` |  | ● |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `ops:leads:read` |  | ● |  |  |  |  | ○ | ● | ● |  |  |  |  |  |  |
| `ops:leads:write` |  |  |  |  |  |  | ○ | ● |  |  |  |  |  |  |  |
| `ops:leads:assign` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:leads:merge` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:admissions:read` |  | ● |  |  |  |  | ○ | ● | ● |  |  |  |  |  | ● |
| `ops:admissions:write` |  |  |  |  |  |  | ○ | ● |  |  |  |  |  |  |  |
| `ops:admissions:approve` |  | ● |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:tasks:read` |  | ● |  |  |  | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ○ |  |
| `ops:tasks:write` |  |  |  |  |  | ○ | ○ | ● |  | ○ | ○ | ○ | ○ | ○ |  |
| `ops:sops:read` |  | ● |  |  |  |  | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `ops:sops:write` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:sops:approve` |  | ● |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:sops:acknowledge` |  | ● |  |  | ● |  | ● | ● |  | ● | ● | ● | ● | ● | ● |
| `ops:incidents:read` |  | ● |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `ops:incidents:write` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:decisions:read` |  | ● |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `ops:decisions:write` |  | ● |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:risks:read` |  | ● |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| `ops:risks:write` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:organisation:read` |  | ● |  |  |  |  | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `ops:organisation:manage` |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |
| `ops:settings:read` |  | ● |  |  |  |  |  | ● | ● | ● |  |  |  |  |  |
| `ops:settings:manage` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:policies:approve` |  | ● |  |  |  |  |  | ● |  | ● |  |  |  |  |  |
| `ops:jobs:run` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| `ops:fees:read` |  | ● |  |  |  |  | ○ | ● | ● |  |  |  |  |  | ● |
| `ops:fees:record` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  | ● |
| `ops:students:read` |  | ● |  |  | ● |  | ○ | ● | ● |  |  |  |  |  |  |
| `ops:student_private:read` (S) |  |  |  |  |  |  | ○ | ● |  |  |  |  |  |  |  |
| `ops:employees:read` |  | ● |  |  |  |  | ● | ● | ● | ● | ● |  | ○ | ● | ● |
| `ops:employees:manage` |  |  |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |
| `ops:employee_private:read` (S) |  |  |  |  |  |  |  |  |  | ● |  |  |  | ○ |  |
| `ops:employee_private:manage` (S) |  |  |  |  |  |  |  |  |  | ● |  |  |  | ○ |  |
| `ops:employee_documents:read` (S) |  |  |  |  |  |  |  |  |  | ● | ● |  |  | ○ |  |
| `ops:employee_documents:manage` (S) |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |
| `ops:compensation:read` (S) |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |
| `ops:compensation:manage` (S) |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |
| `ops:compensation:approve` (S) |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |
| `ops:compensation:export` (S) |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |
| `ops:assets:read` |  | ● |  |  |  |  |  | ● | ● | ● | ● |  | ○ | ○ |  |
| `ops:assets:manage` |  |  |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |
| `ops:recruitment:read` |  | ● |  |  |  |  |  | ● | ● | ● | ● | ○ | ○ |  |  |
| `ops:recruitment:manage` |  |  |  |  |  |  |  | ● |  | ● | ● | ○ |  |  |  |
| `ops:recruitment:decide` |  | ● |  |  |  |  |  | ● |  | ● |  |  |  |  |  |
| `ops:lifecycle:read` |  | ● |  |  |  |  |  | ● | ● | ● | ● |  | ○ |  |  |
| `ops:lifecycle:manage` |  |  |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |
| `ops:lifecycle:approve` |  | ● |  |  |  |  |  | ● |  | ● |  |  |  |  |  |
| `ops:attendance:read` |  | ● |  |  |  |  |  | ● | ● | ● | ● |  | ○ | ○ |  |
| `ops:attendance:record` |  |  |  |  |  |  |  | ● |  | ○ | ○ |  | ○ | ○ |  |
| `ops:attendance:manage` |  |  |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |
| `ops:attendance:approve` |  |  |  |  |  |  |  | ● |  | ● |  |  | ○ |  |  |
| `ops:shifts:read` |  | ● |  |  |  |  |  | ● | ● | ● | ● |  | ○ | ○ |  |
| `ops:shifts:manage` |  |  |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |
| `ops:leave:read` |  | ● |  |  |  |  |  | ● | ● | ● | ● |  | ○ | ○ |  |
| `ops:leave:request` |  |  |  |  |  |  |  | ● |  | ○ | ○ |  | ○ | ○ |  |
| `ops:leave:approve` |  |  |  |  |  |  |  | ● |  | ● |  |  | ○ |  |  |
| `ops:leave:manage` |  |  |  |  |  |  |  | ● |  | ● | ● |  |  |  |  |
| `ops:hr_reports:read` |  | ● |  |  |  |  |  | ● | ● | ● | ● |  | ○ |  | ● |
| `ops:hr_reports:export` |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |

## What `own` means
- **Admissions** (`couns`): leads and admissions whose owner or counsellor is the user's staff record; fee records of those admissions.
- **Tasks** (`couns`, `tchr`, and the HR roles): tasks where the user is owner, accountable owner or backup (reads); owner for writes.
- **Recruitment** (`recr`; `dept-m` read only): requisitions, candidates and interviews assigned to the user as recruiter or panelist.
- **HR scope** (`src/server/hr-scope.ts`): the user's own staff record; for `dept-m` also the whole reporting chain. Private fields and documents narrow `own` back to the user only (`selfOrAllScope`): a department manager who also holds `employee` never reads a report's private data (tested).
- Nobody decides their own request: leave, attendance correction, compensation, offer, separation and SOP/policy approvals refuse the requester or the subject (user or staff record).

## Sensitive sets (D-028)
`ops:employee_private:*`, `ops:employee_documents:*`, `ops:compensation:*` and `ops:student_private:read`. They are excluded from the blanket "all reads" grant: `dir` and `audit` hold none of them. `ops-m` holds none of the HR ones but does hold `ops:student_private:read` because admissions needs student and guardian contacts. Each holder is listed explicitly in the matrix.

## Field-level rules
| Data | Who may see it | Enforced by |
|---|---|---|
| Employee directory fields (code, display name, department, designation, manager, work email and phone, location, time zone) | `ops:employees:read` (everyone with `emp`; `dept-m` own chain). Separated employees are hidden from directory-tier callers. | `employeeFieldTiers`, `projectEmployee` (A-21) |
| Employment record (type, status, dates, history, roles, onboarding status, assets) | The employee; `ops:employees:manage` (`hr-m`, `hr-c`, `ops-m`); `ops:lifecycle:read` within scope (`dir`, `audit`, `dept-m` chain) | same |
| **Legal name**, personal email and phone, address, emergency contacts, identity-document references (last four characters only) | `ops:employee_private:read`: `hr-m` all, `emp` self only. Not `hr-c`, `ops-m`, `dir`, `audit`. | A-21, `server/hr/access.ts` |
| Employment document metadata and downloads | `ops:employee_documents:read`: `hr-m`, `hr-c` all, `emp` self. Identity documents also need private access. Downloads are short-lived URLs (at most 300 s), audited; none while storage is not configured. | A-25 |
| Compensation records | `ops:compensation:read`: `hr-m`, `fin`. Approval: a different holder of `ops:compensation:approve`. CSV export: `fin` only, audited with a reference. No `own` grant. | A-26, A-27 |
| **Candidate contacts** (email, phone, source detail, consent note) | Recruitment managers who cover the candidate (`hr-m`, `hr-c`, `ops-m`, `recr` own). Never in lists or audit payloads; `dir` and `audit` see none. | A-31, A-32 |
| Interview feedback notes | Recruitment managers covering the application, and the author. Recommendations are visible to every reader of the application. | A-31 |
| **Student and guardian contacts**, city, school, consent | `ops:student_private:read`: `couns` own, `ops-m`. Applies to student and lead records and to lead history; `dir`, `audit` and `acad` see none. Student directory lists never carry private fields. | A-18 |
| Fee records (manual) | `ops:fees:read`: `couns` own, `ops-m`, `dir`, `audit`, `fin`. Record: `ops-m`, `fin`. Check by a person other than the recorder. | A-17 |
| **Separation reasons** | Shown only to the approver and HR on the case; null for other readers. The separation event carries ids and dates only. | `lifecycle-cases/{id}` read rule, A-36 |
| Audit payloads | Changed field names, never contact values, amounts or reasons. | services |

## Open access choices (owner decisions)
Defaults below are what the code does now; none is company policy.
| ID | Choice | Today |
|---|---|---|
| OD-037 | Who sees or exports compensation | `hr-m` and `fin` only; export `fin` only |
| OD-040 | Whether `ops-m` sees private HR data and may approve or export for everyone | Excluded from private HR data; holds approve, decide and export for HR work |
| OD-034 | Who approves leave and attendance corrections; delegation; HR override | `dept-m` own chain, `hr-m` and `ops-m` all; never one's own |
| OD-041 | Who selects candidates and approves offers | `hr-m`, `dir`, `ops-m` hold `ops:recruitment:decide` |
| OD-042 | Whether teachers and others also hold `employee`; teacher sees no Ops module tile (IR-OPS-01) | `tchr` has own tasks only |
| OD-045 | Final approval of onboarding and separation | `hr-m`, `dir`, `ops-m` hold `ops:lifecycle:approve` |
| OD-014 | Identity documents stored or reference-only | Reference-only; no storage provider |
| (admissions) | Whether `dir` or `audit` may read student contacts; who may check fee records (OD-047, OD-048) | No; anyone with `ops:fees:record` other than the recorder |
| (HR records) | Whether `ops-m`, `dir` or `audit` may see legal names; whether employees see colleagues' work phone | No; yes |
