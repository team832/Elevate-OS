# Business Ops OS — domain model

Source of truth: `packages/database/src/schema/ops*.ts` (73 tables in schema `ops`, five files, D-029; the 29 wave 2 tables are described first). Every PK is a UUID; human codes are separate unique columns; legacy codes start with `LEGACY-`. FKs go only into `ops` or `core` (no FK to Academic/Marketing). Status columns have CHECK constraints mirroring `src/domain`.

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
| `admissions` | Pipeline case per lead and programme (+ `status_reason_code`, `admission_date`, Academic ids, see below) | `code` `ADM-000001`; `status` (12 states, A-03); `status_reason`; `held_from_status` (CHECK: set iff on_hold); counsellor; delivery mode; intended start/course/batch (Academic UUIDs, no FK); `demo_skipped`; `admitted_at`; handoff: `enrolment_attempt`, `handoff_status` not_requested/pending/enrolled/rejected, `last_request_event_id`, `enrolment_id`/`student_id` (CHECK: present when enrolled), rejection code/reason/time. Partial unique: one open case per (lead, programme) |
| `admission_transitions` | Every status change | from/to, reason, `actor_type` user/system, actor, `event_id`, `at` |
| `admission_checks` | Checklist (OPS-010/011) | PK (admission, `item_key`), `status` done/not_done/not_applicable, `reference` (no files, no amounts), recorded by/at |
| `follow_ups` | Next actions (OPS-007) | `kind` first_contact/counselling_followup/demo_followup/general; `due_date` (IST date, required); `owner_staff_id` (required, BR-OPS-9); `status` open/done/cancelled; outcome; `last_reminder_on`; `source` manual/rule |
| `counselling_sessions` | Appointments (OPS-008) | scheduled at, counsellor, mode in_person/phone/video, attendees, `status` scheduled/completed/no_show/cancelled, recommended programme, objections, outcome, next step |
| `demos`, `demo_teachers` | Demo classes (OPS-009) | subjects[], `day_dates[]` (count = demo terms), `status` scheduled/attended/missed/cancelled, `fee_status` not_paid/paid_verified/adjusted_against_fees/retained_non_refundable, `fee_amount_inr` numeric(12,2) + `fee_terms_state` copied from settings, fee reference; teachers booked + notified at |
| `tasks` | Work items (OPS-016) | `code` `TSK-00001` or `LEGACY-…`; title; department; owner / accountable / backup; `due_date`; `priority` low/medium/high/critical; `status` (BR-OPS-10 7 states); `blocked_since`; `escalation_level` 1–4; completion note/evidence (CHECK when completed); `blocker_override_reason`; optional links to lead, admission, SOP, decision, project; `source` |
| `task_dependencies` | "task is blocked by task" | PK pair, not self (CHECK); acyclic (A-07) |
| `escalations` | L2–L4 escalations (OPS-017) | unique (task, level); trigger overdue/blocked/manual; reason; days overdue; threshold; recipient staff (null = routed to ops managers); `status` open/acknowledged/resolved; respond by; ack/resolve fields |
| `staff_profiles` | Ops data about a core staff member | employment type full_time/part_time/contract/visiting/not_recorded; role labels[] — HR facts live in `employee_records` (ops-hr.ts); **no payroll, biometrics or payroll run** (D-028) |
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

---

## Tables added on 19 Oct 2026 (D-028, D-029)

The `ops` schema is now spread over five files: `ops.ts` (wave 2 and admissions administration), `ops-hr.ts`, `ops-lifecycle.ts`, `ops-time.ts`, `ops-work.ts` (shared helpers in `ops-columns.ts`). The whole schema as a diagram, with owner file per table: `DATA_MODEL.md`. All tables follow the rules at the top of this file. **Nothing is migrated yet** (no migration exists; the baseline is generated centrally).

### Admissions administration (`ops.ts`, additive)
**New columns on `ops.admissions`:** `status_reason_code` text (format CHECK `^[a-z][a-z0-9_]{1,39}$`), `admission_date` date, `academic_existing_student` boolean, `enrolled_course_id` uuid, `enrolled_batch_id` uuid (Academic ids, no FK, D-005). **On `ops.admission_transitions`:** `reason_code` text. All nullable; existing rows unaffected.

**`ops.fee_records`** — id uuid PK; `code` `FEE-000001` unique; `admission_id` → admissions; `lead_id` → leads; `kind` ∈ due/received/refund/adjustment; `direction` ∈ credit/debit, present iff adjustment (CHECK); `amount_paise` bigint > 0 (CHECK); `currency` = 'INR' (CHECK); `pricing_reference`, `receipt_reference`, `method` ∈ cash/upi/bank_transfer/cheque/card_terminal/other; `payment_date`, `due_date` (IST dates); `demo_id` → demos; `status` ∈ recorded/verified/voided; `notes`; `recorded_by` → users, `recorded_at`; `verified_by` (≠ recorded_by, CHECK), `verified_at`, `verification_note`; `voided_by`, `voided_at`, `void_reason` (required when voided, CHECK); timestamps. Indexes: (admission_id, recorded_at), status. Never deleted.

**`ops.enrolment_attempts`** — id uuid PK; `admission_id` → admissions; `attempt` ≥ 1; `request_event_id` → core.integration_events (unique); unique (admission_id, attempt); `kind` ∈ initial/after_rejection/after_failure (after_failure needs `reason`, CHECK); `requested_by`, `requested_at`; `outcome` ∈ pending/confirmed/rejected/superseded; `outcome_at`; `reply_event_id`; `rejection_code`, `rejection_reason`; `note` (late-reply flags).

**`ops.contact_preferences`** — `lead_id` PK → leads; `consent_status` ∈ given/refused/withdrawn; `consent_by` ∈ student/guardian/both; `allowed_channels` text[] ⊆ {call, whatsapp, sms, email} and empty unless given (CHECKs); `preferred_contact` ∈ student/guardian; `note`; `recorded_by`, `recorded_at`. No row = not recorded.

### HR records (`ops-hr.ts`)
`employee_records` (1:1 with `core.staff_members`: `EMP-####` code, legal name, work email and phone, work location, IANA timezone, employment status onboarding / active / on_notice / separated, start and end dates), `assets` (`AST-#####`, status available / assigned / in_repair / retired / lost) and `asset_assignments` (one open assignment per asset) were created in the HR foundation commit. Added by the HR records slice:



| Table | Key columns and constraints |
|---|---|
| `employment_history` | `staff_id` (restrict), `field` ∈ department·title·manager·employment_type·employment_status, `from_value`/`to_value` (ids or enum values as text; names resolved on read), `effective_on` date, `reason`, `changed_by`, `changed_at`. Never updated or deleted. |
| `department_heads` | `department_id`, `staff_id`, `starts_on`, `ends_on` (null = current), `reason`, `assigned_by`, `ended_by`. Unique partial index: one row with `ends_on IS NULL` per department. Check `ends_on ≥ starts_on`. |
| `employee_private_details` | PK `staff_id`. Personal email (lower case), personal phone (E.164), address lines, city, state, postal code, country. **No date of birth** (not needed). |
| `emergency_contacts` | name, relationship, phone (E.164), `is_primary` (unique partial: one primary per employee). At most 5 (service). Removal deletes the row (data minimisation); the audit keeps the fact only. |
| `employee_documents` | `kind` (9 kinds), `title`, `storage_kind` reference/stored, `storage_key` (unique), `external_reference`, content type, size, `sha256` (64 hex), `retention_class` (4 classes), `status` active·superseded·retention_hold·deletion_requested·deleted, `expires_on`, `superseded_by_id`, deletion requester/decider and timestamps. Check: a reference document has `external_reference` and no key; a stored document has key and sha256. |
| `employee_identity_references` | `kind` (aadhaar, pan, passport, voter_id, driving_licence, other), `last4` (check `^[A-Z0-9]{1,4}$`), optional `document_id`, status active/retired. |
| `compensation_records` | `basis` monthly/annual/hourly, `amount_paise` bigint ≥ 0, `currency` = INR, `components` jsonb `[{kind: earning|allowance, label, amountPaise}]`, `effective_from`, `effective_to`, `status` draft·approved·superseded·cancelled, `created_by`, `approved_by/at`, `superseded_by_id`. Unique partial index: one `approved` per employee. Check: approved/superseded ⇔ `approved_by` set. |

### Recruitment, onboarding, offboarding (`ops-lifecycle.ts`)
All `ops.*`, UUID PKs, codes in unique columns, rows never deleted (status columns; anonymisation in place).

| Table | Purpose / key columns |
|---|---|
| `requisitions` | `code` REQ-####, title, `department_id`→core.departments, role_description, openings 1–500, employment_type, location, status, status_reason, `recruiter_staff_id`, `hiring_manager_staff_id`, approved_by/at (both or neither), created_by (= requester) |
| `candidates` | `code` CAND-#####, full_name, email (lower-case, unique), phone (E.164, unique), source, source_detail, recruiter, privacy_notice_at, consent_note, status `active \| anonymised` (anonymised ⇒ no contacts), anonymised_at/by. **Sensitive:** email, phone, source_detail, consent_note |
| `job_applications` | candidate × requisition (unique), stage, stage_reason, stage_changed_at, closed_at (set iff closed), `employee_staff_id`→employee_records (unique; required when hired) |
| `job_application_stages` | append-only stage history (from, to, reason, actor, at) |
| `interviews` | application, scheduled_at (UTC), duration 5–480, mode, location, status `scheduled \| completed \| cancelled \| no_show` |
| `interview_panelists` | (interview, staff) PK + that interviewer's recommendation, feedback_notes (**sensitive**), submitted_by/at |
| `job_offers` | application, status, offered_title, proposed_start_date, valid_until, compensation_reference (text only, no amount), notes, prepared_by, approved_by (≠ prepared_by, CHECK), extended_by/at, responded_at; one live offer per application (partial unique) |
| `lifecycle_cases` | `code` HRC-#####, kind, `staff_id`→employee_records, status `open \| approved \| completed \| cancelled`, application (onboarding from conversion, unique), separation_type, notice_date ≤ last_working_day, separation_reason (**sensitive**), settlement_reference, approval fields, separated_at, `separation_event_id`→core.integration_events; one live case per employee and kind |
| `lifecycle_items` | case, item_key (unique per case: `template:<k>`, `asset:<assignmentId>`, `transfer:<type>:<id>`, `access_revocation`, `final_settlement`, `exit_interview`, `custom:<n>`), kind, title, required, assignee, due_date (IST), status `pending \| done \| not_applicable \| blocked`, evidence, notes, `asset_assignment_id`→asset_assignments, transfer entity + target, completed_by/at, last_reminded_on |


**Relation to wave 2 `ops.onboarding_items`:** unchanged and still used by `/ops/staff/[id]` (a simple per-staff document checklist). HRC onboarding cases are a separate, richer process; neither reads the other. Merging them is a proposal for the owner, not done.

### Attendance, shifts and leave (`ops-time.ts`)
| Table | Purpose | Key rules |
|---|---|---|
| `shift_templates` | Shift definitions | `code` unique (`^[A-Z0-9][A-Z0-9_-]{1,23}$`); `start_time`/`end_time` `HH:MM` CHECKs; midnight consistency CHECK; break 0–600; `working_weekdays` jsonb int[]; `status` proposed/approved/retired; never deleted |
| `shift_assignments` | Employee ↔ template for `from_date`…`to_date` (null = open) | `to ≥ from`; `status` active/cancelled (+ `cancel_reason`); overlap refused in service under an advisory lock |
| `holidays` | Company holiday calendar | unique (date, lower(location)) among non-withdrawn rows; `status` proposed/approved/withdrawn; `location` null = all |
| `attendance_sessions` | Clock-in → clock-out | `work_date` in employee tz; `timezone`; `break_minutes`; `source` self/manual/csv_import/provider/correction; `status` open/closed/superseded; one `open` per staff (partial unique); clock-out > clock-in; manual ⇒ reason; `late_minutes`/`early_departure_minutes` (null = not measured); `missing_clock_out_flagged_at`; `import_id`; `correction_id`; `superseded_by_id` (self FK) + `superseded_at` |
| `attendance_breaks` | Self-recorded breaks | one running break per session; end > start |
| `attendance_corrections` | ATC-###### requests | `session_id` null = missed day; proposed instants + break; reason; `status` pending/approved/rejected/withdrawn; one pending per session; decided ⇔ `decided_by`; approved ⇔ `resulting_session_id` |
| `attendance_imports` | CSV batches | `file_sha256` unique (idempotency); counts CHECK `valid + invalid = total`; `row_errors` jsonb; `imported_by` |
| `leave_types` | Leave types | `code` unique; paid, half_day_allowed, requires_document; `status` proposed/approved/retired |
| `leave_requests` | LVR-###### | start/end dates + parts with consistency CHECK; `working_days` numeric(6,1); status pending/approved/rejected/cancelled; decided/cancelled columns |
| `leave_ledger_entries` | Balance ledger | `entry_type` allocation/adjustment/usage/reversal with sign CHECK; usage/reversal need `leave_request_id`; unique (request, entry_type) → idempotent |

All staff references are `core.staff_members` (restrict); users are `core.users`. Employee timezone and work location come from `ops.employee_records` (HR records slice).

### Operations work (`ops-work.ts`)
Side tables; no column of `ops.ts` changed. FKs only into `ops` and `core`.


| Table | Key columns | Rules (CHECK / unique) |
|---|---|---|
| `task_comments` | task, author, body, created; hidden_at/by/reason | body non-blank; hidden fields all-or-none with a non-blank reason; body never updated (service) |
| `task_references` | task, kind (document/evidence/other), label, location, added_by; removed_at/by/reason | removal fields all-or-none; URL-looking locations must be http(s) (service) |
| `task_review_requirements` | task (PK), reviewer_staff (null = accountable or manager), note, required_by | one per task |
| `task_reviews` | task, cycle, status pending/accepted/returned, submitted_by/at, reviewer snapshot, decided_by/at, note | unique (task, cycle); one pending per task; decided ⇔ not pending; returned needs a note; decided_by ≠ submitted_by |
| `task_reminders` | task, kind due_soon/overdue, due_date, recipient_count | unique (task, kind, due_date) = idempotent job |
| `sop_version_schedules` | version (PK), effective_date, next_review_date, set_by | review ≥ effective |
| `sop_archives` | sop (PK), reason, archived_by/at | only for retired SOPs (service) |
| `sop_ack_requirements` | version, audience_type department/role, department / role, due_date, withdrawn_* | exactly one target; one active requirement per version and audience |
| `sop_acknowledgements` | version, user, staff, acknowledged_at, note | unique (version, user); append-only |
| `risk_mitigations` | risk, action, owner, due_date, status planned/in_progress/done/dropped, outcome, completed_at | done ⇒ completed_at; dropped ⇒ outcome |
| `policies` | code `POL-0001`, title, area (15 values), summary, accountable staff, owner_decision_ref `OD-xxx`, status, current/approved version, retired_* | code format; retired ⇔ retired fields; approved ⇒ approved version |
| `policy_versions` | policy, number, status draft/proposed/approved/rejected/superseded, requirement_text, source_reference, linked_setting_keys[], effective/review dates, change_note, approval, proposed_by/at, decided_by/at | unique (policy, number); review ≥ effective; non-draft ⇒ proposed_by; decided ⇒ decided_by; decided_by ≠ proposed_by |

## Core tables written as steward
`core.departments` (create, rename, confirm `active`, archive when empty) and `core.staff_members` (create, title, department, manager with loop check, login link unique, status). Ops never changes `core.ts`.

## Values that are configuration, not policy
Demo terms (approved in legacy, read-only), demo fee ₹1,000 (`pending_verification`, OD-013), demo limits (`open`, OD-012), demo skip (`proposed`), confirmation requirements (BR-OPS-6 `proposed`), follow-up due rules (`proposed`, OD-011), escalation thresholds (`proposed`), conversion window (`proposed`, OD-027), online office hours (`locked`).
