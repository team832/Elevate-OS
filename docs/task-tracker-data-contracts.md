# Task tracker, EOD and teacher operations: data and contracts

Tables, vocabularies, snapshot formats and cross-module contracts behind owner brief 2. Every column in plain words: `apps/business-ops-os/docs/DATA_DICTIONARY.md` (generated); exact columns: the schema files named below. Migration `0009_academic_teacher_workspace_tasks` creates them; it is generated and **not applied**. Overview of the build: [task-tracker-implementation.md](task-tracker-implementation.md); tracker field map: [task-tracker-source-map.md](task-tracker-source-map.md).

## Tables (schema `ops`)
| Table | File | What a row is | Key rules |
|---|---|---|---|
| `staff_tasks` (extended) | `ops-tasks.ts` | One task | `source` manager / self / verbal / academic / import / recurring; requester, department, backup (≠ owner), reviewer, `review_required`, acceptance criteria, `linked_ref` (plain text, e.g. an Academic record), `received_at`, `planned_start_on`, acknowledgement (time + user together), `legacy_ref` (unique), `import_batch_id`, `is_sample`, `version`. Done ⇔ `completed_at`; blocked, on hold and cancelled need `reason` |
| `task_events` | `ops-tasks.ts` | One dated change (append-only) | Kinds: created, assigned, reassigned (from/to staff = ownership history), acknowledged, clarification_requested, status_changed (needs to-status), submitted_for_review, review_approved, changes_requested, reopened, cancelled, due_changed, priority_changed, comment, imported, dependency_added, edited. Clarification, changes, reopen and cancel need a reason |
| `task_updates` | `ops-tasks.ts` | One work entry (append-only) | `occurred_on` = IST work date, `recorded_at` = entry time; minutes 1–1440 or start/stop; a correction is a new row pointing at the old one with a reason, once |
| `task_dependencies` | `ops-tasks.ts` | "Task waits on task" | Unique pair, not self; loops refused in code under an advisory lock |
| `eod_reports` (extended) | `ops-eod.ts` | One staff member's report for one IST day (unique staff + day) | Working draft: facts, `summary`, `next_day_plan`, `notes`, `current_version`, `version`, `is_sample`; draft ⇔ no `submitted_at` |
| `eod_report_versions` | `ops-eod.ts` | One frozen submission | Unique report + version; version 1 has no `revision_of_version_id`, later ones must; holds the facts snapshot, narrative, cut-off, submitter and recipient |
| `eod_review_events` | `ops-eod.ts` | One manager action | viewed, comment, clarification_requested, revision_requested, acknowledged, follow_up_task_created (comment, clarification and revision need text; only the follow-up carries a task id) |
| `task_import_batches` | `ops-task-imports.ts` | One uploaded backup for one staff member | Unique sha256 + staff; raw copy (read with `ops:tasks:import` only); committed ⇔ committed time + user |
| `task_import_rows` | `ops-task-imports.ts` | One record of a batch with its outcome | Unique batch + kind + legacy id; points at the task or report it created |
| `review_acknowledgements` | `ops-review-acks.ts` | Ops' acknowledgement of one Academic review version by one person | Unique review key + version + user; a follow-up date needs follow-up text |

Backfills in 0009 (only facts on record): task `source` = `recurring` for recurrence children and `manager` where the assigner differs from the owner; every submitted EOD gets version 1 from its frozen snapshot. No events are invented for older tasks: EOD facts fall back to `completed_at`, then current status, for tasks without events.

## Snapshot formats
- **`eod-facts/1`** (`apps/business-ops-os/src/domain/eod.ts`, `EodFacts`): staff, report day, window, cut-off (`asOf`), received, acknowledged, completed, blocked, decisions, work (minutes inside the day, late entry day, same-activity flag, overlap flag), backlog with overdue at the cut-off, duration with its definition, Academic facts (`available` with nullable metrics, or `unavailable` with reason and time), `hr: { status: 'unavailable' }`, counts. Rules: ALGORITHMS A-TSK-8.
- Reports stored before brief 2 keep the older "My day" shape; imported tracker reports are `legacy_tracker_report` ("Imported — not sent"). Neither is parsed as facts or exported as CSV.

## Legacy reference
`deskday_backup_json:<staffId>:<legacyId>` on `staff_tasks.legacy_ref`. The `imported` event is dated at commit; the tracker's own dates are kept in the event's `data.legacy` (D-068).

## Cross-module contracts (`packages/shared-contracts/src/summaries.ts`; full list in `INTEGRATION_CONTRACT.md`)
| Contract | Route | Caller | Used for |
|---|---|---|---|
| `academic.teacher_activity` v1 | `GET /academic/api/internal/v1/teachers/{staffId}/activity?from=&to=` | ops | Teacher directory/profile and EOD Academic facts: assignments, sessions planned / delivered / cancelled / substituted, pending logs / attendance / marking, reviews, unavailability. Counts only; class time is never added to task time |
| `AcademicStudentReviewsV1` | `GET /academic/api/internal/v1/reviews?coreStudentId=` or `?authorStaffId=` | ops | Submitted review versions only (never drafts); withdrawn marked so Ops hides every version; `ops:feedback:read` is checked before the call |
| `AcademicDemoAttendanceV1` | `GET /academic/api/internal/v1/demo-attendance?ids=` | ops | Teacher's mark and actual teachers per Ops demo class (D-060) |
| `OpsDemoSessionsForDayV1` | `GET /ops/api/internal/v1/demo-sessions?date=` | academic | The day's demo classes with minimal fields, so Academic can add demo students to a roster |

Failure behaviour: every Academic read becomes "source unavailable" with the reason and time, never zero or an empty list. For demo classes Ops already knows are linked (`ops.demo_sessions.academic_session_ref`), counsellor marking and the demo's move to attended wait while Academic is unreachable (D-066); unlinked classes stay counsellor-marked. A review acknowledgement is refused while Academic is unreachable.

## Settings (`apps/business-ops-os/src/domain/policies.ts`)
| Key | Default | State |
|---|---|---|
| `tasks.completion_without_reviewer` | `{ closedBy: 'owner' }` | proposed |
| `eod.submission_deadline` | `{ time: null }` (no deadline) | open |
| `eod.manager_history` | `{ scope: 'submitted_to_manager' }` (alternative `current_team_all`) | proposed |
| `eod.external_delivery` | `{ channel: null }` | proposed, not editable |
