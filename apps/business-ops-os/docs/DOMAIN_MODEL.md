# Business Ops OS — domain model

Source of truth: `packages/database/src/schema/ops.ts` (29 tables in schema `ops`). Every PK is a UUID; human codes are separate unique columns; legacy codes start with `LEGACY-`. FKs go only into `ops` or `core` (no FK to Academic/Marketing). Status columns have CHECK constraints mirroring `src/domain`.

```
core.users ─┐                                   core.programmes
core.staff_members ─< ops.staff_profiles        (programme of interest / admission)
            ├─< ops.responsibilities (holder, backup)
            ├─< ops.onboarding_items
ops.lead_sources ─< ops.enquiries >─ ops.leads ─< ops.lead_activities
                                      ├─< ops.duplicate_flags (lead, matched lead)
                                      ├─< ops.follow_ups
                                      └─< ops.admissions ─< ops.admission_transitions
                                              ├─< ops.admission_checks
                                              ├─< ops.counselling_sessions
                                              ├─< ops.demos ─< ops.demo_teachers
                                              └── last_request_event_id → core.integration_events
ops.tasks ─< ops.task_dependencies, ─< ops.escalations; links → leads, admissions, sops, decisions, projects
ops.sops ─< ops.sop_versions ─< ops.sop_checklist_items; version.approval_id → core.approvals
ops.incidents, ops.decisions (superseded_by self), ops.risks, ops.projects ─< ops.milestones ─< ops.milestone_dependencies
ops.work_items, ops.settings
```

## Entities

| Table | Purpose | Key fields and states |
|---|---|---|
| `settings` | Policy register values (OPS-022) | `key` unique, `value` jsonb (validated per key in `domain/policies.ts`), `decision_state` ∈ proposed/approved/locked/open/pending_verification/superseded, `source`, `owner_decision` |
| `lead_sources` | Configurable source list (OPS-002) | `code` (unique constraint, referenced by enquiries), `label`, `status` active/retired |
| `leads` | The person who enquired | `code` `LEAD-000001`; student name/stage/school/city; `student_phone`/`guardian_phone` E.164 (CHECK), emails lower-case (CHECK); ≥ 1 contact (CHECK); guardian relationship; `programme_id`; `interest_mode` offline/online/undecided; `first_received_at`; `owner_staff_id`, `owner_assigned_at`, `accepted_at` (assignment = unassigned / handoff_pending / accepted); `first_successful_contact_at`; `merged_into_lead_id`, `merged_at` |
| `enquiries` | Each enquiry with its own source (BR-OPS-5) | `received_at`, `source_code`, channel, discovery source, campaign/content refs, programme, mode, `merged_from_lead_id` |
| `lead_activities` | Contact attempts (OPS-006) | `kind` call/whatsapp/sms/email/visit/note; `outcome` connected_two_way/replied/visited (successful) or no_answer/busy/wrong_number/message_sent/other |
| `duplicate_flags` | Duplicate warnings (OPS-003) | unique (lead, matched lead); `level` exact/possible; `signals[]`; `status` open/dismissed/merged; acknowledgement; review fields |
| `admissions` | Pipeline case per lead and programme | `code` `ADM-000001`; `status` (12 states, A-03); `status_reason`; `held_from_status` (CHECK: set iff on_hold); counsellor; delivery mode; intended start/course/batch (Academic UUIDs, no FK); `demo_skipped`; `admitted_at`; handoff: `enrolment_attempt`, `handoff_status` not_requested/pending/enrolled/rejected, `last_request_event_id`, `enrolment_id`/`student_id` (CHECK: present when enrolled), rejection code/reason/time. Partial unique: one open case per (lead, programme) |
| `admission_transitions` | Every status change | from/to, reason, `actor_type` user/system, actor, `event_id`, `at` |
| `admission_checks` | Checklist (OPS-010/011) | PK (admission, `item_key`), `status` done/not_done/not_applicable, `reference` (no files, no amounts), recorded by/at |
| `follow_ups` | Next actions (OPS-007) | `kind` first_contact/counselling_followup/demo_followup/general; `due_date` (IST date, required); `owner_staff_id` (required, BR-OPS-9); `status` open/done/cancelled; outcome; `last_reminder_on`; `source` manual/rule |
| `counselling_sessions` | Appointments (OPS-008) | scheduled at, counsellor, mode in_person/phone/video, attendees, `status` scheduled/completed/no_show/cancelled, recommended programme, objections, outcome, next step |
| `demos`, `demo_teachers` | Demo classes (OPS-009) | subjects[], `day_dates[]` (count = demo terms), `status` scheduled/attended/missed/cancelled, `fee_status` not_paid/paid_verified/adjusted_against_fees/retained_non_refundable, `fee_amount_inr` numeric(12,2) + `fee_terms_state` copied from settings, fee reference; teachers booked + notified at |
| `tasks` | Work items (OPS-016) | `code` `TSK-00001` or `LEGACY-…`; title; department; owner / accountable / backup; `due_date`; `priority` low/medium/high/critical; `status` (BR-OPS-10 7 states); `blocked_since`; `escalation_level` 1–4; completion note/evidence (CHECK when completed); `blocker_override_reason`; optional links to lead, admission, SOP, decision, project; `source` |
| `task_dependencies` | "task is blocked by task" | PK pair, not self (CHECK); acyclic (A-07) |
| `escalations` | L2–L4 escalations (OPS-017) | unique (task, level); trigger overdue/blocked/manual; reason; days overdue; threshold; recipient staff (null = routed to ops managers); `status` open/acknowledged/resolved; respond by; ack/resolve fields |
| `staff_profiles` | Ops data about a core staff member | employment type full_time/part_time/contract/visiting/not_recorded; role labels[] — **no HR, payroll, leave, biometrics** |
| `responsibilities` | OPS-015 | code (`RESP-0001` or legacy), title, department, accountable role, holder, backup, hand-over role, critical, status, source |
| `onboarding_items` | Staff onboarding checklist | seq, title, `document_ref` (reference only), status pending/done/not_applicable |
| `sops` | SOP register (OPS-019) | code `SOP-0001` or legacy (legacy needs `legacy_source`, CHECK); title; process; department; owner/reviewer/backup staff; owner role; risk; priority; `status` not_drafted/draft/in_review/approved/retired; `current_version_id`, `approved_version_id`; next review; legacy source/status/ref; retired |
| `sop_versions` | Never-erased versions | unique (sop, number); label; `status` draft/in_review/approved/rejected/superseded; content; change note; document ref; `content_hash` at submission; `approval_id` → core.approvals; review (by, at, outcome, note); approved by/at (CHECK); source date |
| `sop_checklist_items` | Steps of a version | seq, section, text |
| `incidents` | Exceptions and incidents | code `INC-00001`; kind exception/incident; category; severity; `status` open/in_progress/resolved/closed (resolution required, CHECK); `needs_authorised_approval` |
| `decisions` | Decision log (OPS-021) | code `DEC-0001` or `LEGACY-OPSWB-D-…`; area; statement; `state` open/proposed/confirmed/provisional/superseded (superseded needs `superseded_by_id`, CHECK); decided by/on; source; owner decision ref; legacy status/ref |
| `risks` | Risks, issues, blockers (OPS-023) | code `RSK-0001`; kind risk/issue/blocker; likelihood/impact low/medium/high; owner; mitigation; review/target dates; status open/mitigating/resolved/closed/accepted; task/project links |
| `projects`, `milestones`, `milestone_dependencies` | OPS-025 | project code `PRJ-0001`, dates (end ≥ start CHECK), status; milestones with due date/status; acyclic dependencies |
| `work_items` | Legacy work inventory | `LEGACY-OPSWB-OP-…`, function, process, scope, proposed role, status approved/documented/planned/proposed/open + verbatim legacy word |

## Core tables written as steward
`core.departments` (create, rename, confirm `active`, archive when empty) and `core.staff_members` (create, title, department, manager with loop check, login link unique, status). Ops never changes `core.ts`.

## Values that are configuration, not policy
Demo terms (approved in legacy, read-only), demo fee ₹1,000 (`pending_verification`, OD-013), demo limits (`open`, OD-012), demo skip (`proposed`), confirmation requirements (BR-OPS-6 `proposed`), follow-up due rules (`proposed`, OD-011), escalation thresholds (`proposed`), conversion window (`proposed`, OD-027), online office hours (`locked`).
