# Business Ops OS — domain model

Source of truth: `packages/database/src/schema/ops*.ts` (32 tables in schema `ops`; every column in plain words: [DATA_DICTIONARY.md](DATA_DICTIONARY.md)). The 56 HR and Operations tables were dropped by migration `0002_remove_hr_operations.sql` (owner, 2026-10-20, D-032; recoverable from git commit 63da4e4). Every PK is a UUID; human codes are separate unique columns; legacy codes start with `LEGACY-`. FKs go only into `ops` or `core` (no FK to Academic/Marketing). Status columns have CHECK constraints mirroring `src/domain`.

```
core.users ─┐                                   core.programmes
core.staff_members ─< ops.staff_profiles        (programme of interest / admission)
ops.lead_sources ─< ops.enquiries >─ ops.leads ─< ops.lead_activities
                                      ├─< ops.duplicate_flags (lead, matched lead)
                                      ├─< ops.follow_ups
                                      └─< ops.admissions ─< ops.admission_transitions
                                              ├─< ops.admission_checks
                                              ├─< ops.appointments (ops-meetings.ts)
                                              ├─< ops.demos ─< ops.demo_sessions (ops-demos.ts)
                                              └── last_request_event_id → core.integration_events
                                              ├─< ops.fee_records, ops.enrolment_attempts
ops.leads ─ ops.contact_preferences;  ops.settings
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
| `appointments` (was `counselling_sessions`, renamed by 0005, D-036) | Appointments of every type (OPS-008, OPS-101…) | `type`, `starts_at`/`ends_at`, assigned `staff_id`, `mode` offline/online, `status` proposed/scheduled/confirmed/completed/cancelled/rescheduled, participants in `appointment_participants`, history in `appointment_changes`; columns: [DATA_DICTIONARY.md](DATA_DICTIONARY.md) |
| `demos` | Demo classes (OPS-009) | one row per demo; its N classes are `demo_sessions` (dates, subject, teacher, attendance); `fee_status` not_paid/paid_verified/adjusted_against_fees/retained_non_refundable, `fee_amount_paise` + `fee_terms_state` copied from settings, `outcome`. Legacy `subjects`, `day_dates`, `status` and `demo_teachers` were dropped by 0005 (D-036) |
| `staff_profiles` | Ops data about a core staff member | employment type full_time/part_time/contract/visiting/not_recorded; role labels[]; **no payroll, biometrics or HR records** (D-032) |

---

## Tables added on 19 Oct 2026 (D-028)

### Admissions administration (`ops.ts`, additive)
**New columns on `ops.admissions`:** `status_reason_code` text (format CHECK `^[a-z][a-z0-9_]{1,39}$`), `admission_date` date, `academic_existing_student` boolean, `enrolled_course_id` uuid, `enrolled_batch_id` uuid (Academic ids, no FK, D-005). **On `ops.admission_transitions`:** `reason_code` text. All nullable; existing rows unaffected.

**`ops.fee_records`** — id uuid PK; `code` `FEE-000001` unique; `admission_id` → admissions; `lead_id` → leads; `kind` ∈ due/received/refund/adjustment; `direction` ∈ credit/debit, present iff adjustment (CHECK); `amount_paise` bigint > 0 (CHECK); `currency` = 'INR' (CHECK); `pricing_reference`, `receipt_reference`, `method` ∈ cash/upi/bank_transfer/cheque/card_terminal/other; `payment_date`, `due_date` (IST dates); `demo_id` → demos; `status` ∈ recorded/verified/voided; `notes`; `recorded_by` → users, `recorded_at`; `verified_by` (≠ recorded_by, CHECK), `verified_at`, `verification_note`; `voided_by`, `voided_at`, `void_reason` (required when voided, CHECK); timestamps. Indexes: (admission_id, recorded_at), status. Never deleted.

**`ops.enrolment_attempts`** — id uuid PK; `admission_id` → admissions; `attempt` ≥ 1; `request_event_id` → core.integration_events (unique); unique (admission_id, attempt); `kind` ∈ initial/after_rejection/after_failure (after_failure needs `reason`, CHECK); `requested_by`, `requested_at`; `outcome` ∈ pending/confirmed/rejected/superseded; `outcome_at`; `reply_event_id`; `rejection_code`, `rejection_reason`; `note` (late-reply flags).

**`ops.contact_preferences`** — `lead_id` PK → leads; `consent_status` ∈ given/refused/withdrawn; `consent_by` ∈ student/guardian/both; `allowed_channels` text[] ⊆ {call, whatsapp, sms, email} and empty unless given (CHECKs); `preferred_contact` ∈ student/guardian; `note`; `recorded_by`, `recorded_at`. No row = not recorded.

## Core tables written as steward
`core.departments` (create, rename, confirm `active`, archive when empty) and `core.staff_members` (create, title, department, manager with loop check, login link unique, status). Ops never changes `core.ts`.

## Values that are configuration, not policy
Demo terms (approved in legacy, read-only), demo fee ₹1,000 (`pending_verification`, OD-013), demo limits (`open`, OD-012), demo skip (`proposed`), confirmation requirements (BR-OPS-6 `proposed`), follow-up due rules (`proposed`, OD-011), conversion window (`proposed`, OD-027), admissions closure reasons (`proposed`), fee recording (`proposed`), fee schedule reference (`open`, OD-013).

## Tables added on 20 Oct 2026 (admissions workspace)
Sixteen `ops` tables and `core.students` (migration `0003_admissions_workspace.sql`), with field definitions, constraints, indexes and ownership in `DATA_MODEL.md`; state machines in `WORKFLOWS.md`. New configuration, all `proposed`: `admissions.demo.session_count` (3), `admissions.demo.checklist_required` (off), `admissions.number.format`, `appointments.scheduling`, `fees.allocation`.
