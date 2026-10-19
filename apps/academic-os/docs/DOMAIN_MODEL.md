# Academic OS — domain model

Source of truth: `packages/database/src/schema/academic.ts` (schema `academic`). Every primary key is a UUID; human codes are separate unique columns. Foreign keys point only within `academic` or into `core` (`programmes`, `staff_members`, `users`); Business Ops ids (`admission_id`, `lead_id`) are plain UUIDs without FKs (D-005). Timestamps are `timestamptz` (UTC); calendar dates are `date` (Asia/Kolkata days). Marks are `numeric(10,4)` and computed in integer units (1 mark = 10 000).

## 1. Relationships
```
core.programmes ─< courses ─< subjects ─< chapters (alias_of_chapter_id → chapters)
                      │                      ▲
                      ├─< curriculum_plans ─< plan_items ─┘      (supersedes_plan_id → curriculum_plans; batch_id = scope)
                      └─< batches ─< teacher_assignments >── core.staff_members, subjects
                             ├─< calendar_rules, calendar_exclusions (batch_id null = centre-wide)
                             ├─< class_sessions >── subjects, chapters (planned), staff (teacher), rooms
                             │       ├─< class_records >── chapters, staff   (corrects_record_id → class_records)
                             │       └─< attendance >── students
                             ├─< assessments ─< assessment_sections, answer_keys, attempts >── students
                             │                 └─< result_runs ─< results >── attempts, students
                             └─< enrolments >── students, core.programmes, courses
students ─< enrolments ─< catchup_tasks >── class_sessions, chapters
students ─< interventions >── core.staff_members (responsible)
enrolment_intake_log >── students, enrolments   (request_event_id → core.integration_events by value)
concept_book_chapters (standalone reference)     settings (key → value)
```

## 2. Curriculum
| Table | Key columns | States / labels | Notes |
|---|---|---|---|
| `courses` | `code` (unique), `family_code` + `version` (unique), `programme_id` → core, `mode`, `class_minutes` (null = undecided, 15–300), `class_minutes_status` | `status` draft/active/paused/archived; `class_minutes_status` ∈ labels | A course is one version of a curriculum under a programme |
| `subjects` | `course_id`, `code` (unique per course), `sort_order` | — | |
| `chapters` | `course_id`, `subject_id`, `code` (unique per course, never renumbered), `weight` 1–10 (catch-up), `alias_of_chapter_id` | `status` active / retired / moved; alias only when not active | ACD-001, BR-ACD-10 |
| `curriculum_plans` | `code` (unique), `course_id`, `batch_id` (scope; null = course template), `version`, `supersedes_plan_id`, `class_minutes`, `counts_status`, `dates_status`, `pending_target_status`, `approved_by_user_id`/`approved_at`, `legacy_approved_on`, `scope_note`, `change_log`, `source_ref` | `status` proposed → provisional → locked → superseded (see below) | Never self-superseding |
| `plan_items` | `plan_id`, `chapter_id`, `sequence` (unique per plan), `lesson_code` (unique per plan), `session_type` teaching/practice, `planned_classes` ≥ 1, `planned_minutes` ≥ 1, `planned_date` (provisional/undated), `coverage` | — | PLANNED only |
| `concept_book_chapters` | `book_code`, `book_title`, `chapter_code` (unique), `chapter_number`, `section`, `title`, `subtopics[]`, `alias_of_code`, `index_status`, `content_status` (`not_started`), planned concept/practice/ranker counts, `question_count_status` (`planned` or null) | `status` active / retired / moved / opening_unit | Index only; counts are planned allocations |

**Plan status machine** (`src/domain/plans.ts`, enforced in `curriculum.ts`):
```
proposed ──approval──▶ provisional ──approval──▶ locked ──(successor approved)──▶ superseded
proposed ──approval──▶ locked
proposed / provisional ──(successor approved)──▶ superseded
```
- Items can be added only while `proposed`; locked and provisional plans are immutable.
- `POST plans/:id/approval` sets `pending_target_status` and opens a core approval (`academic.curriculum_plan.status_change`); `…/decision` by **another** coordinator applies the status, records `approved_by_user_id/at` and moves the predecessor to `superseded` in the same transaction. A rejection clears the pending target.
- A plan may supersede only a locked/provisional plan of the same course and the same batch scope.

## 3. Batches, calendar, timetable
| Table | Key columns | States |
|---|---|---|
| `batches` | `code` (unique), `course_id`, `programme_id`, `route` (regular/dropper/class11_two_year/fast_track), `mode`, `start_date`/`end_date`, `class_minutes_override`, `capacity` (null = unlimited), `target_exam`, `target_exam_date`, `target_exam_date_status` (official/tentative/assumed/unverified) | `status` planning / active / completed / cancelled |
| `teacher_assignments` | `batch_id`, `subject_id`, `staff_member_id` → core, `employment_type`, dates | `status` active / ended (one active row per batch+subject+staff) |
| `rooms` | `code` (unique), `name`, `capacity` | active / inactive |
| `calendar_exclusions` | `batch_id` (null = centre-wide), `kind` holiday/school_exam/exam_blackout/other, `label`; either `date` (dated) or `period_start`/`period_end` (+ `days` and `slots_per_day` for an allowance; a period with kind `exam_blackout` is a blackout window) | `status` provisional / confirmed / locked / unverified |
| `calendar_rules` | `batch_id`, `period_start`/`period_end`, `weekdays[]` (ISO 1–7), `slots_per_day`, `kind` regular/extra | label status |
| `class_sessions` | `batch_id`, `subject_id`, `planned_chapter_id`, `teacher_staff_id` → core, `room_id`, `session_type` teaching/practice/catch_up/test/discussion, `date`, `start_time` `HH:MM`, `duration_minutes` 5–600, `status_reason`, `rescheduled_from_session_id`, `online_link` | `status` scheduled → held (by a class record or attendance) / cancelled (reason) / rescheduled (reason; replacement row links back) |

## 4. Teaching log and attendance
| Table | Key columns | States |
|---|---|---|
| `class_records` | `session_id`, `batch_id`, `chapter_id`, `teacher_staff_id`, `activity` main/practice/catch_up/test/discussion, `completion` completed/partial, `actual_minutes`, `notes`, `evidence`, `recorded_by_user_id`/`recorded_at`, `verified_by_user_id`/`verified_at` (both or neither), `corrects_record_id` + `correction_reason`, `superseded_at` | `state` submitted → verified; submitted/verified → superseded (by a correction). One current (non-superseded) record per session + chapter |
| `attendance` | `session_id`, `student_id`, `status` present/partial/late/absent/excused, `minutes_present`, `note`, `recorded_by_user_id` | one row per session + student; corrections update the row and are audited with before/after |

Only `verified` records count as delivered (BR-ACD-11). A correction keeps the original's content and adds a new verified row.

## 5. Students, enrolments, intake
| Table | Key columns | States |
|---|---|---|
| `students` | `code` (unique, `STU-XXXXXXXX`), names, optional DOB, stage, board, contacts, guardian name/relationship/contacts, `source_admission_id` (unique when set), `source_lead_id` | active / inactive |
| `enrolments` | `student_id`, `programme_id` → core, `course_id`, `batch_id` (null = awaiting batch), `start_date`, `late_joiner`, `source` admission_event/manual, `manual_reason` (required for manual), `request_event_id` (unique; required for admission_event), `source_admission_id`, `source_lead_id`, `created_by_user_id` | `status` active / paused / withdrawn / completed; one active enrolment per student + batch |
| `enrolment_intake_log` | `request_event_id` (unique), `admission_id`, `lead_id`, `attempt`, `programme_code`, `student_name`, `outcome` confirmed/rejected, `reason_code`/`reason`, `student_id`, `enrolment_id`, `existing_student`, `reply_event_id`, `processed_at` | confirmed rows need student + enrolment; rejected rows need a reason code |

## 6. Assessments and results
| Table | Key columns | States |
|---|---|---|
| `assessments` | `code` (unique), `title`, `kind` chapter_test/sectional/full_mock/practice, `batch_id`, `subject_id`, `chapter_ids[]`, `scheduled_date`, `start_time`, `duration_minutes`/`discussion_minutes` (null = unknown), `pattern_ref`, default rule `marks_per_correct`, `marks_per_wrong` (signed, ≤ 0), `marks_unattempted` (null = unknown) | `status` draft → scheduled (has a date) → conducted (responses entered) → finalised; cancelled |
| `assessment_sections` | `assessment_id`, `code` (unique per assessment), `question_count`, `answer_format` choice/numeric, `options[]`, `time_limit_minutes`, rule overrides and `cap_marks` | replaced as a set while no attempts exist; afterwards only rule values may change |
| `answer_keys` | `assessment_id`, `version` (unique, +1 each time), `answers` jsonb `{ section: (answer \| null)[] }` (null = dropped), `note` | versions kept |
| `attempts` | `assessment_id`, `student_id` (unique pair), `status` submitted/absent, `responses` jsonb (null when absent), `key_version` | replaced on re-entry (audited) |
| `result_runs` | `assessment_id`, `version` (unique), `answer_key_id`, `rule_snapshot` jsonb, `reason` (required from version 2), `students_scored`, `students_absent`, `finalised_by_user_id`/`at`, `superseded_at` | `status` final / superseded; at most one final per assessment |
| `results` | `run_id`, `attempt_id` (unique per run), `student_id`, `total_score` (null when absent), `max_score`, `percentile` (null when absent or cohort < 2), `rank`, `section_scores` jsonb, `absent` | immutable (no update path) |

## 7. Progress
| Table | Key columns | States |
|---|---|---|
| `catchup_tasks` | `student_id`, `enrolment_id`, `batch_id`, `session_id` (unique per enrolment), `chapter_id`, `reason` absent/excused/late_joiner, `assigned_staff_id`, `due_date`, `note`, `completed_at` | open / in_progress / done / cancelled |
| `interventions` | `student_id`, `batch_id`, `trigger` repeated_absence/declining_scores/low_scores/missed_assessments/overdue_catch_up/other, `description`, `responsible_staff_id` → core (required), `action`, `due_date`, `outcome` (required to resolve/close), `parent_contact_status` not_contacted/contacted/unreachable/not_required, `resolved_at` | open / in_progress / resolved / closed |
| `settings` | `key` (PK), `value` jsonb, `status` proposed/approved, `description`, `updated_by_user_id` | defaults are `proposed` |
