# Business Ops OS: permissions by role

Written from `packages/authorization/src/permissions/ops.ts` on 21 Oct 2026 (after owner brief 2 and decision D-058). The platform-wide matrix in `docs/SECURITY_AND_PERMISSIONS.md` is produced by `npm run docs:permissions`. Roles are permission profiles, not people: nobody holds a role until a platform administrator assigns it (D-028, OD-009). A company email address grants nothing.

HR and Operations were removed by the owner on 2026-10-20 (D-032): the HR, task, SOP, register, incident and policy permissions and the roles `hr_manager`, `hr_contributor`, `recruiter`, `department_manager` and `employee` are gone (recoverable from commit 63da4e4). On 20 Oct 2026 the admissions brief added 17 keys (18 → 35); on 21 Oct 2026 seven more came with admissions confirmation and daily tasks (→ 42), and owner brief 2 added `ops:tasks:import` and `ops:feedback:acknowledge` (→ 44). `ops:feedback:write` and `ops:feedback:manage` are retired (D-058): still defined, held by no role.

Every page, route and service checks its permission on the server. `platform_admin`, `marketing_manager` and `marketing_contributor` hold no Ops permission.

## Matrix (44 permissions)
● = all records. ○ = `own` scope. (S) = sensitive: left out of the director and auditor read baseline. Blank = no grant. `dir` = director, `acad` = academic_coordinator, `couns` = admissions_counsellor, `ops-m` = operations_manager, `audit` = auditor, `fin` = finance_officer, `tchr` = teacher. Director and auditor hold every `:read` / `:access` key except `ops:student_private:read`; the director also approves fee arrangements.

| Permission | dir | acad | couns | ops-m | audit | fin | tchr |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `ops:module:access` | ● | ● | ● | ● | ● | ● | ● |
| `ops:dashboard:read` | ● |  |  | ● | ● |  |  |
| `ops:leads:read` | ● |  | ○ | ● | ● |  |  |
| `ops:leads:write` (also demos) |  |  | ○ | ● |  |  |  |
| `ops:leads:assign` |  |  |  | ● |  |  |  |
| `ops:leads:merge` |  |  |  | ● |  |  |  |
| `ops:admissions:read` | ● |  | ○ | ● | ● | ● |  |
| `ops:admissions:write` |  |  | ○ | ● |  |  |  |
| `ops:admissions:approve` | ● |  |  | ● |  |  |  |
| `ops:organisation:read` | ● |  | ● | ● | ● |  |  |
| `ops:organisation:manage` |  |  |  | ● |  |  |  |
| `ops:settings:read` | ● |  |  | ● | ● |  |  |
| `ops:settings:manage` |  |  |  | ● |  |  |  |
| `ops:jobs:run` |  |  |  | ● |  |  |  |
| `ops:fees:read` | ● |  | ○ | ● | ● | ● |  |
| `ops:fees:record` |  |  |  | ● |  | ● |  |
| `ops:students:read` | ● | ● | ○ | ● | ● |  |  |
| `ops:student_private:read` (S) |  |  | ○ | ● |  |  |  |
| **Added 20 Oct 2026** | | | | | | | |
| `ops:lead_attribution:read` | ● |  |  | ● | ● |  |  |
| `ops:lead_handoffs:manage` |  |  |  | ● |  |  |  |
| `ops:admissions:convert` |  |  | ○ | ● |  |  |  |
| `ops:admission_number:override` |  |  |  | ● |  |  |  |
| `ops:students:lifecycle` |  |  | ○ | ● |  |  |  |
| `ops:students:reactivate` |  |  |  | ● |  |  |  |
| `ops:guardians:write` |  |  | ○ | ● |  |  |  |
| `ops:student_reports:generate` |  |  | ○ | ● |  |  |  |
| `ops:appointments:read` | ● |  | ○ | ● | ● |  | ○ |
| `ops:appointments:manage` |  |  | ○ | ● |  |  |  |
| `ops:teachers:read` | ● | ● | ● | ● | ● |  | ○ |
| `ops:teachers:manage` |  |  |  | ● |  |  |  |
| `ops:feedback:read` | ● | ● | ○ (proposed) | ● | ● |  | ○ |
| `ops:feedback:write` (retired, D-058) |  |  |  |  |  |  |  |
| `ops:feedback:manage` (retired, D-058) |  |  |  |  |  |  |  |
| `ops:feedback:record` |  |  | ● | ● |  |  |  |
| `ops:feedback:moderate` |  |  |  | ● |  |  |  |
| **Added 21 Oct 2026** | | | | | | | |
| `ops:admissions:confirm` (holders proposed) | ● |  |  | ● |  |  |  |
| `ops:kyc:verify` (holders proposed) |  |  |  | ● |  |  |  |
| `ops:student_reports:review` (holders proposed) |  |  |  | ● |  |  |  |
| `ops:event_messages:send` (holders proposed) |  |  |  | ● |  |  |  |
| `ops:tasks:read` | ● | ○ | ○ | ● | ● | ○ | ○ |
| `ops:tasks:write` | ○ | ○ | ○ | ● |  | ○ | ○ |
| `ops:eod:review` | ● |  |  | ● |  |  |  |
| `ops:tasks:import` |  |  |  | ● |  |  |  |
| `ops:feedback:acknowledge` (holders proposed) |  |  | ○ | ● |  |  |  |

## What `own` means
| Area | Counsellor (`couns`) | Teacher (`tchr`) |
|---|---|---|
| Leads, admissions, demos, conversion, lifecycle, guardians, reports, fees read | Leads and admissions whose owner or counsellor is the user's staff record; demos whose demo counsellor, case counsellor or lead owner is the user | — |
| Marketing handoffs | Handoffs whose lead the user owns (never attribution) | — |
| Appointments | Assigned, organised or taking part | Assigned or taking part |
| Teacher profile | — | Own profile only |
| Teacher reviews (from Academic) and the older Ops rows | Reviews about students they counsel (case counsellor, lead owner or demo counsellor) and reviews they wrote; acknowledge only those students' reviews | Reviews they wrote; approved student/guardian feedback shared with them. Teachers write reviews in Academic OS, not here (D-058) |
| Tasks and EOD reports (all roles with own scope) | Own tasks, tasks of staff who report to them directly or indirectly (`manager_id` chain, R3), tasks where they are reviewer, backup or assigner; EOD reports they wrote or that were sent to them | same |

Nobody decides their own request: a fee-arrangement approval refuses the requester; a reactivation refuses the person who recorded the exit; a teacher can never moderate feedback about themselves, even with `ops:feedback:moderate`.

## Sensitive set and field-level rules
| Data | Who may see or change it | Enforced by |
|---|---|---|
| **Student and guardian contacts**, city, school, consent, `ops.guardians` | Read: `ops:student_private:read` (`couns` own, `ops-m`). Write guardians: also `ops:guardians:write`. `dir`, `audit`, `acad` see none. Lists show masked phones only in a contact search. | A-18, A-71 |
| Contact search (phone or email) | Only with `ops:student_private:read`; each search writes an audit row with a masked value | A-71 |
| Fee plans, instalments, ledger, list fee status | Read `ops:fees:read`; record `ops:fees:record`. Profile fee section hidden without read. `feeStatusForStudents` does no check, so callers gate it. | A-17, A-76 … A-80 |
| Marketing attribution (campaign name, channel, source reference) | `ops:lead_attribution:read` (`ops-m`, `dir`, `audit`); null for others in the handoff list and in demo-conversion source groups | A-81, A-83 |
| Student report groups | `overview, programmes, results, attendance, feedback` for any generator; `fees` needs `ops:fees:read`; `guardians` needs private access; reopening a reference applies the reader's current permissions | A-72 |
| Manual admission number | `ops:admission_number:override` + reason of 10+ characters, logged | A-65 |
| Audit payloads | Changed field names, never contact values or amounts; guardian contacts never | services |

Two known gaps: the existing lead detail API still returns the enquiry's campaign ref to every `ops:leads:read` holder (only the handoff list hides attribution); older lead audit rows still hold contacts (redacted on read).

## Open access choices (owner decisions)
Defaults below are what the code does now; none is company policy.
| ID | Choice | Today |
|---|---|---|
| OD-047, OD-048 | Whether `dir` or `audit` may read student contacts; who may check fee records | No; anyone with `ops:fees:record` other than the recorder |
| (roles) | Keep `finance_officer` (fee records) or fold it into `operations_manager` | Kept |
| (reactivation) | Whether reactivation needs a second person | Yes |
| (teacher feedback) | Who owns teacher → student reviews | **Decided 21 Oct 2026: Academic OS (D-058)**; Ops reads and acknowledges |
| (reviews) | Counsellor holds `ops:feedback:read` and `ops:feedback:acknowledge` (own) | Proposed |
| (tasks) | Who may cancel assigned work and change its review step | The task's creator or all scope (R18, D-069) |
| (EOD history) | Whether a new manager reads reports sent to the earlier manager (`eod.manager_history`) | No (`submitted_to_manager`, proposed) |
| (imports) | Who imports tracker backups | Operations manager only (`ops:tasks:import`, all scope) |
