# Academic OS — domain model

Source of truth: `packages/database/src/schema/academic.ts`, with the 21 Oct 2026 additions in `academic-delivery.ts` (placements, patterns, session teachers, unavailability, demo attendees), `academic-reviews.ts` (teacher reviews) and `academic-columns.ts` (shared helpers) (schema `academic`). The additions reach a database through migration `0009_academic_teacher_workspace_tasks`, generated, not applied. Generated column list: `apps/business-ops-os/docs/DATA_DICTIONARY.md`. Every primary key is a UUID; human codes are separate unique columns. Foreign keys point only within `academic` or into `core` (`programmes`, `staff_members`, `users`); Business Ops ids (`admission_id`, `lead_id`) are plain UUIDs without FKs (D-005). Timestamps are `timestamptz` (UTC); calendar dates are `date` (Asia/Kolkata days). Marks are `numeric(10,4)` and computed in integer units (1 mark = 10 000).

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
enrolments ─< batch_placements >── batches   (transfer_from_placement_id → batch_placements; one open per enrolment)
batches ─< timetable_patterns ─< class_sessions (pattern_id; unique pattern + date)
class_sessions ─< session_teachers >── core.staff_members   (planned / actual; substitute names replaces_staff_id)
class_sessions ─< session_demo_attendees   (ops_demo_session_id, core_student_id by value: no FK to ops)
core.staff_members ─< teacher_unavailability
teacher_reviews >── core.staff_members (author), students | core.students, subjects, class_sessions, enrolments (supersedes_id → teacher_reviews)
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
| `batches` | `code` (unique), `course_id`, `programme_id`, `route` (regular/dropper/class11_two_year/fast_track), `mode`, `campus`, `coordinator_staff_id`, `is_sample`, `start_date`/`end_date`, `class_minutes_override`, `capacity` (null = unlimited), `target_exam`, `target_exam_date`, `target_exam_date_status` (official/tentative/assumed/unverified) | `status` planning / active / completed / cancelled |
| `teacher_assignments` | `batch_id`, `subject_id`, `staff_member_id` → core, `role` primary/co_teacher/substitute, `employment_type`, dates | `status` active / ended; a stored end date means `ended` (D-065). Whether an assignment is current is decided by its dates (`assignmentActiveOn`), never by status. Overlapping windows for the same teacher + batch + subject are refused |
| `rooms` | `code` (unique), `name`, `capacity` | active / inactive |
| `calendar_exclusions` | `batch_id` (null = centre-wide), `kind` holiday/school_exam/exam_blackout/other, `label`; either `date` (dated) or `period_start`/`period_end` (+ `days` and `slots_per_day` for an allowance; a period with kind `exam_blackout` is a blackout window) | `status` provisional / confirmed / locked / unverified |
| `calendar_rules` | `batch_id`, `period_start`/`period_end`, `weekdays[]` (ISO 1–7), `slots_per_day`, `kind` regular/extra | label status |
| `class_sessions` | `batch_id`, `subject_id`, `planned_chapter_id`, `teacher_staff_id` → core, `room_id`, `session_type` teaching/practice/catch_up/test/discussion, `date`, `start_time` `HH:MM`, `duration_minutes` 5–600, `status_reason`, `rescheduled_from_session_id`, `online_link`, `pattern_id` (unique with `date`), `kind` regular/makeup/doubt/extra, `makeup_for_session_id` (only kind makeup), `delivered_at` + `delivered_by_user_id` (both or neither), `delivery_note`, `version` | `status` scheduled → held (**only** by "Mark delivered", D-063) → scheduled again (coordinator reopen with reason) / cancelled (reason) / rescheduled (reason; replacement row links back) |

## 4. Teaching log and attendance
| Table | Key columns | States |
|---|---|---|
| `class_records` | `session_id`, `batch_id`, `chapter_id`, `teacher_staff_id`, `activity` main/practice/catch_up/test/discussion/revision/doubt_solving (`main` = first teaching, the only coverage-counting activity, D-062), `completion` completed/partial, `actual_minutes`, `materials`, `homework`, `homework_due_on`, `difficulties`, `next_plan`, `catch_up_needed`, `notes`, `evidence`, `submitted_at` (null while draft), `version`, `recorded_by_user_id`/`recorded_at`, `verified_by_user_id`/`verified_at` (both or neither), `corrects_record_id` + `correction_reason`, `superseded_at` | `state` draft → submitted (only for a delivered session) → verified; submitted/verified → superseded (by a correction, or by a correction request that opens a new draft for the log's teacher). Drafts are private to their author and count for nothing. One current (non-superseded) record per session + chapter |
| `attendance` | `session_id`, `student_id`, `status` present/partial/late/absent/excused, `minutes_present`, `note`, `recorded_by_user_id` | one row per session + student; corrections update the row and are audited with before/after |

Only `verified` records count as delivered minutes (BR-ACD-11); coverage counts submitted or verified `main` records once per chapter (D-062). A correction keeps the original's content and adds a new row. Attendance has no "not recorded" row: no row = not recorded, never present or absent.

## 5. Students, enrolments, intake
| Table | Key columns | States |
|---|---|---|
| `students` | `code` (unique, `STU-XXXXXXXX`), names, optional DOB, stage, board, contacts, guardian name/relationship/contacts, `source_admission_id` (unique when set), `source_lead_id`, `core_student_id` (unique when set: one academic student per person), `is_sample` | active / inactive |
| `enrolments` | `student_id`, `programme_id` → core, `course_id`, `batch_id` (null = awaiting batch), `start_date`, `late_joiner`, `source` admission_event/manual, `manual_reason` (required for manual), `request_event_id` (unique; required for admission_event), `source_admission_id`, `source_lead_id`, `academic_year` (label, e.g. `2026-27`), `created_by_user_id` | `status` active / paused / withdrawn / completed; one active enrolment per student + batch and per student + course. `batch_id` mirrors the open placement for older readers; the placement is the source of truth (D-064) |
| `enrolment_intake_log` | `request_event_id` (unique), `admission_id`, `lead_id`, `attempt`, `programme_code`, `student_name`, `outcome` confirmed/rejected, `reason_code`/`reason`, `student_id`, `enrolment_id`, `existing_student`, `reply_event_id`, `processed_at` | confirmed rows need student + enrolment; rejected rows need a reason code |

## 6. Assessments and results
| Table | Key columns | States |
|---|---|---|
| `assessments` | `code` (unique), `title`, `kind` chapter_test/sectional/full_mock/practice, `batch_id`, `subject_id`, `chapter_ids[]`, `scheduled_date`, `start_time`, `duration_minutes`/`discussion_minutes` (null = unknown), `pattern_ref`, default rule `marks_per_correct`, `marks_per_wrong` (signed, ≤ 0), `marks_unattempted` (null = unknown), `published_at` + `published_by_user_id` (both or neither) | `status` draft → scheduled (has a date) → conducted (responses entered) → finalised; cancelled. Publication is a separate step after finalising; only published results leave Academic |
| `assessment_sections` | `assessment_id`, `code` (unique per assessment), `question_count`, `answer_format` choice/numeric, `options[]`, `time_limit_minutes`, rule overrides and `cap_marks` | replaced as a set while no attempts exist; afterwards only rule values may change |
| `answer_keys` | `assessment_id`, `version` (unique, +1 each time), `answers` jsonb `{ section: (answer \| null)[] }` (null = dropped), `note` | versions kept |
| `attempts` | `assessment_id`, `student_id` (unique pair), `status` submitted/absent/exempt/withheld, `responses` jsonb, `manual_score` (a directly entered total), `key_version`, `marked_by_user_id`, `version` | absent/exempt: no responses and no score; submitted: responses or a manual score; replaced on re-entry (audited); no row = pending |
| `result_runs` | `assessment_id`, `version` (unique), `answer_key_id` (null when every result is a manual total), `rule_snapshot` jsonb, `reason` (required from version 2), `students_scored`, `students_absent`, `finalised_by_user_id`/`at`, `superseded_at` | `status` final / superseded; at most one final per assessment |
| `results` | `run_id`, `attempt_id` (unique per run), `student_id`, `state` scored/absent/exempt/withheld, `total_score` (set only when scored), `max_score`, `percentile` (null when not scored or cohort < 2), `rank`, `section_scores` jsonb, `absent` (= state is not scored, kept for old readers) | immutable (no update path); rank/percentile hidden unless `progress.show_rank_percentile` is approved |

## 7. Progress
| Table | Key columns | States |
|---|---|---|
| `catchup_tasks` | `student_id`, `enrolment_id`, `batch_id`, `session_id` (unique per enrolment), `chapter_id`, `reason` absent/excused/late_joiner, `assigned_staff_id`, `due_date`, `note`, `completed_at` | open / in_progress / done / cancelled |
| `interventions` (support plans) | `student_id`, `batch_id`, `evidence`, `goal`, `review_on`, `trigger` repeated_absence/declining_scores/low_scores/missed_assessments/overdue_catch_up/other, `description`, `responsible_staff_id` → core (required), `action`, `due_date`, `outcome` (required to resolve/close), `parent_contact_status` not_contacted/contacted/unreachable/not_required, `resolved_at` | open / in_progress / resolved / closed |
| `settings` | `key` (PK), `value` jsonb, `status` proposed/approved, `description`, `updated_by_user_id` | defaults are `proposed` |

## 8. Teacher workspace (21 Oct 2026, `academic-delivery.ts`, `academic-reviews.ts`)
| Table | Key columns | States / invariants |
|---|---|---|
| `batch_placements` | `enrolment_id`, `batch_id`, `start_date`, `end_date` (last day; null = open), `reason`, `placed_by_user_id`, `transfer_from_placement_id`, `ended_by_user_id`, `ended_reason`, `is_sample` | one open placement per enrolment; end ≥ start; a transfer needs a reason. Rosters, teacher scope, assessment eligibility and attendance windows read placements (D-064). Migration 0009 backfills one open placement per **active** enrolment with a batch |
| `timetable_patterns` | `batch_id`, `subject_id`, `staff_id`, `room_id`, `online_link`, `weekday` 1–7, `start_time`, `duration_minutes` 5–600, `effective_from`, `effective_to`, `published_at`/`published_by_user_id`, `version` | `status` draft → published → retired; a published pattern has its stamp. A series edit ends the old pattern the day before the effective date and creates a new published one |
| `session_teachers` | `session_id`, `staff_id`, `role` primary/co_teacher/substitute, `participation` planned/actual, `replaces_staff_id`, `reason`, `authorised_by_user_id`, `removed_at` | one active row per session + staff + participation; a substitution needs a reason and an authoriser and cannot replace oneself; rows are never deleted (`removed_at`) |
| `teacher_unavailability` | `staff_id`, `from_date`, `to_date`, `reason`, `entered_by_user_id`, `cancelled_at`/`cancelled_by_user_id` | label "Academic availability record — not HR leave"; withdrawing keeps the row |
| `session_demo_attendees` | `session_id`, `ops_demo_session_id`, `core_student_id`, `display_name`, `demo_day_number` 1–10, `status` not_recorded/present/absent/late/excused, `recorded_by_user_id`/`recorded_at`, `note`, `added_by_user_id`, `is_sample` | unique session + Ops demo session; a recorded mark needs who and when; no enrolment entitlement (D-060) |
| `teacher_reviews` | `review_key` + `version` (unique), `author_staff_id`, `academic_student_id` or `core_student_id` (at least one), `subject_id`, `review_type` demo_session/periodic_progress/assessment_follow_up/support_referral, `session_id`, `enrolment_id`, `ops_demo_session_id`, `period_from`/`period_to`, `strengths`, `areas_for_support`, `attendance_evidence`, `homework_evidence`, `academic_concerns`, `suggested_action`, `follow_up_on`, `visibility` internal/shareable, `supersedes_id`, `submitted_at`, `withdrawn_at` + `withdrawn_reason`, `is_sample` | `status` draft → submitted → withdrawn; one draft per review key; submitted versions are never edited (a revision is version + 1). No ratings or scores (D-058) |
