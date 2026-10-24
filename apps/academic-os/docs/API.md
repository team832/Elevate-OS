# Academic OS — API reference

Base path `/academic/api/v1`. Every route is built with `defineRoute` (`src/app/api/**/route.ts`; schemas in `src/server/schemas.ts`, `schemas-placements.ts`, `schemas-sessions.ts`, `schemas-teaching.ts`, `schemas-assessment.ts`). Status of the 21 Oct 2026 teacher-workspace routes: **Tested** where a test file is named in `docs/TEST_PLAN.md`; nothing is Deployed; their tables arrive with migration `0009` (applied to the owner's local database, like `0000`–`0013`).

**Conventions**
- Order of checks (22 Oct 2026, D-072): a `POST`/`PUT`/`PATCH`/`DELETE` whose `Origin` is neither this origin nor a configured app origin → **403** `FORBIDDEN` ("This request came from another site and was refused."); no session → **401** `UNAUTHENTICATED`; no `academic:module:access` → **403** "Your roles do not include this workspace."; missing permission → **403** `FORBIDDEN` (before validation); invalid params/query/body → **400** `VALIDATION_FAILED` with `details: [{ location, path, message }]`; then the handler.
- Bodies are JSON with the media type `application/json` exactly (`text/plain;application/json` is **400**). Success `{ "data": … }` (201 for creates); failure `{ "error": { code, message, details?, requestId } }`.
- Handler errors: **404** `NOT_FOUND` (also for records outside a teacher's own scope), **409** `CONFLICT` (unique violations, timetable conflicts with `details.hard`/`details.preferences`, full batch), **409** `INVALID_STATE_TRANSITION`, **400** `VALIDATION_FAILED` (business validation, e.g. finalise issues in `details`).
- "own" = teacher scope (README §3): sessions they teach (planned teacher or an active co-teacher/substitute row), batches where their assignment is open on the day, students placed in those batches during that window.
- Writes that edit an existing row send the `version` (or `updatedAt` for review drafts) the form was opened with; a stale value is **409** `CONFLICT` ("changed since you opened it").
- Dates `YYYY-MM-DD`, times `HH:MM`, marks are decimal strings/numbers with ≤ 4 decimals (e.g. `"-0.25"`); `null` mark = unknown.

## 1. Curriculum
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /programmes` | `courses:read` | — | `core.programmes` rows |
| `GET /courses` | `courses:read` | — | courses + `programmeCode` + `plansByStatus` |
| `POST /courses` | `courses:write` | `programmeCode`, `code`, `familyCode`, `version`=1, `name`, `description?`, `mode?`, `classMinutes?` (15–300, null), `classMinutesStatus`='unknown', `status`='draft' | 201 course (400 unknown programme; 409 duplicate code/version) |
| `GET /courses/:id` | `courses:read` | — | course + `subjects`, `chapters`, `plans` (404) |
| `POST /courses/:id/subjects` | `courses:write` | `code`, `name`, `sortOrder`=0 | 201 subject |
| `POST /courses/:id/chapters` | `courses:write` | `subjectId`, `code`, `title`, `sortOrder`=0, `weight` 1–10 =1 | 201 chapter (400 subject of another course) |
| `POST /chapters/:id/retire` | `courses:write` | `status` retired\|moved, `aliasOfChapterId`, `reason` | chapter (409 already retired; 400 alias not an active chapter of the course) |
| `GET /plans?courseId=` | `courses:read` | — | plans + `courseCode`, `itemCount`, `plannedClasses`, `plannedMinutes`, `plannedHours` |
| `POST /plans` | `courses:write` | `courseId`, `batchId?`, `code`, `title`, `supersedesPlanId?`, `copyItems`=false, `classMinutes?`, `countsStatus`='proposed', `datesStatus`='unknown', `scopeNote?`, `changeLog?` | 201 plan in status `proposed` (400 supersession problem) |
| `GET /plans/:id` | `courses:read` | — | `{ plan, items[] (with chapter/subject codes), totals[] by subject, totalClasses, totalHours, approvals[], supersededBy }` |
| `POST /plans/:id/items` | `courses:write` | `items[1..500]`: `chapterId`, `lessonCode`, `sessionType` teaching\|practice, `plannedClasses`=1, `plannedMinutes?` (default classes × plan class minutes), `plannedDate?`, `coverage?` | 201 items (409 `INVALID_STATE_TRANSITION` unless proposed; 400 foreign/retired chapter) |
| `POST /plans/:id/approval` | `courses:write` | `targetStatus` locked\|provisional, `comment?` | 201 `{ plan, approval }` (409 transition not allowed / already pending; 400 no items) |
| `POST /plans/:id/approval/decision` | `curriculum:approve` | `decision` approved\|rejected, `comment?` (required to reject) | `{ plan, approval, superseded }` (403 self-approval; 409 nothing pending or predecessor no longer current) |
| `GET /concept-books` | `courses:read` | — | `{ books[{ bookCode, bookTitle, chapters[], numberedChapters }], numberedChapters, note }` |

## 2. Batches, staff, calendars
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /batches` | `batches:read` (own: assigned) | — | batches + `courseCode`, `programmeCode`, `classLength {minutes, status, source}`, `activeEnrolments` |
| `POST /batches` | `batches:write` | `code`, `name`, `courseId`, `route?`, `mode?`, `startDate?`, `endDate?`, `classMinutesOverride?`, `capacity?`, `targetExam?`, `targetExamDate?` + `targetExamDateStatus` (required with a date), `status`='planning' | 201 batch |
| `GET /batches/:id` | `batches:read` (own) | — | batch + `classLength`, `activeEnrolments`, `currentPlan`, `assignments[]`, `calendarRules[]`, `exclusions[]` (404 outside scope) |
| `PATCH /batches/:id` | `batches:write` | `status?`, `capacity?`, `startDate?`, `endDate?`, `mode?`, `campus?`, `coordinatorStaffId?` (each nullable) | batch (audited) |
| `GET /batches/:id/coverage?asOf=` | `batches:read` (own) | — | `{ batch, plan, asOf, coverage { chapters[], subjects[], course, unplanned[] }, note }` |
| `GET /batches/:id/feasibility?from=&to=` | `timetable:read` (own) | — | `{ batch, plan, window, ruleStatuses, exclusionStatuses, result }` (`result` = capacity result, or `null` + `message` without rules/dates) |
| `GET /assignments` | `assignments:read` (own: their assignments) | — | assignments with batch, subject and staff names |
| `POST /assignments` | `assignments:write` | `batchId`, `subjectId`, `staffMemberId`, `employmentType?`, `role` primary\|co_teacher\|substitute (default primary), `startDate?`, `endDate?` (not before start) | 201 (400 subject of another course / inactive staff; 409 duplicate active or overlapping window) |
| `POST /assignments/:id/end` | `assignments:write` | `endDate` | assignment with the end date; a stored end date sets status `ended` (D-065). Also moves a planned end date that is today or later. 409 when it would overlap another assignment of the same teacher, batch and subject; audited `assignment.ended` |
| `GET /staff` | `assignments:write` | — | active/on-leave core staff `{ id, fullName, title, userId }`. Teacher pickers on the reports and teaching-log pages use `listStaff(db, { teachingOnly: true })` (staff with a past or current teaching assignment) |
| `GET /rooms` | `timetable:read` | — | rooms |
| `POST /rooms` | `timetable:write` | `code`, `name`, `capacity?` | 201 room |
| `GET /exclusions?batchId=` | `timetable:read` | — | exclusions (with `batchId`: the batch's + centre-wide) |
| `POST /exclusions` | `timetable:write` | `batchId?`, `kind`, `label`, either `date` or `periodStart`+`periodEnd`; allowances need `days` + `slotsPerDay`, each ≥ 1 (not for `exam_blackout` windows); `status`='provisional' | 201; 400 for a `date` sent together with a period, or `days`/`slotsPerDay` below 1 (the database check `calendar_exclusions_shape` backs this, migration 0012) |
| `POST /calendar-rules` | `batches:write` | `batchId`, `label`, `periodStart`, `periodEnd`, `weekdays[1..7]`, `slotsPerDay` 1–12, `kind` regular\|extra, `status`='provisional' | 201 |

## 3. Timetable
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /sessions?batchId=&from=&to=&teacherId=&roomId=&status=` | `timetable:read` (own: sessions they teach) | — | sessions + batch/subject/chapter codes, teacher name, room code (max 1000) |
| `POST /sessions` | `timetable:write` | `sessions[1..200]`: `batchId`, `subjectId?`, `plannedChapterId?`, `teacherStaffId?`, `roomId?`, `sessionType`='teaching', `date`, `startTime`, `durationMinutes` 5–600, `onlineLink?` | 201 `{ sessions, warnings (preferences), notes }`; **409** `CONFLICT` with `details.hard` when any hard constraint fails (nothing saved). Runs under the timetable lock (D-070) |
| `POST /sessions/:id/deliver` | `classes:record` (own: a class they teach) | `note?`, `actualStaffIds?[1..10]` (default: the planned teachers, a substitute replacing the original), `version?` | session `held` with `deliveredAt`/`deliveredByUserId`; one `session_teachers` row per actual teacher (participation `actual`); audited `class_session.delivered`. 404 not own; 400 future session, no teacher named, a teacher marks a class without naming themselves; 409 not `scheduled` or stale version. The only way a session becomes `held` (D-063) |
| `POST /sessions/:id/reopen` | `timetable:write` | `reason` | session back to `scheduled`; actual-teacher rows kept with `removedAt`; audited `class_session.reopened` (409 unless `held`) |
| `POST /sessions/:id/substitute` | `timetable:publish` + the role in setting `timetable.substitute_authoriser` (proposed: `academic_coordinator`) | `staffId`, `reason` | 201 `session_teachers` row (role `substitute`, `replacesStaffId`, `authorisedByUserId`); the original teacher stays on record; an earlier substitute for the same teacher is marked removed. 403 wrong role; 400 no planned teacher / same teacher / unknown staff; 409 not scheduled, already on the session, or the substitute is busy or unavailable |
| `POST /sessions/:id/cancel` | `timetable:write` | `reason` | session `cancelled` (409 unless scheduled); teacher notified |
| `POST /sessions/:id/reschedule` | `timetable:write` | `date`, `startTime`, `durationMinutes?`, `teacherStaffId?`, `roomId?` (null clears), `reason` | 201 `{ original (rescheduled), replacement, warnings }` (409 conflicts / not scheduled) |
| `POST /timetable/check` | `timetable:read` (own: their sessions) | `batchId?`, `from`, `to`, `candidates[]` (session shape) | `{ verdict feasible\|infeasible, hard[], preferences[], checkedSessions, notes[] }` — read-only |

Conflict objects: `{ code, severity hard|preference, sessionIds[], date, message }`; codes `TEACHER_OVERLAP` (incl. co-teachers and substitutes), `BATCH_OVERLAP`, `ROOM_OVERLAP`, `STUDENT_OVERLAP`, `TEACHER_UNAVAILABLE`, `ON_EXCLUSION`, `CROSSES_MIDNIGHT`, `INVALID_TIME`, `DURATION_MISMATCH`, `CLASS_LENGTH_UNKNOWN`, `TEACHER_WORKLOAD`.

### Patterns, unavailability, teachers
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /patterns?batchId=` | `timetable:read` (own: patterns they teach) | — | patterns + batch code, subject, teacher, room |
| `POST /patterns` | `timetable:write` | `batchId`, `subjectId` (of the batch's course), `staffId`, `roomId?`, `onlineLink?`, `weekday` 1–7, `startTime`, `durationMinutes` 5–600, `effectiveFrom`, `effectiveTo` (≤ 400 days) | 201 pattern `draft`, version 1 |
| `PATCH /patterns/:id` | `timetable:write` | any pattern field + `version` | draft with version + 1 (409 not a draft or stale version) |
| `DELETE /patterns/:id` | `timetable:write` | `version`, `confirm: true` | `{ id, deleted }` (drafts only; content kept in the audit row) |
| `GET /patterns/:id/preview` | `timetable:read` (own) | — | `{ pattern, toCreate[], check, occurrences[{ date, sessionId, skipped, conflicts[] }] }` |
| `POST /patterns/:id/publish` | `timetable:publish` | `version` | `{ pattern (published), created[] }`; generates only missing dates (unique pattern + date), closures skipped. 409 on any hard conflict (nothing created) or stale version |
| `POST /timetable/build` | `timetable:write` | `batchId`, `from`, `to` (≤ 400 days), `dayStart`, `dayEnd` (HH:MM, end after start), `subjects[1..40]`: `subjectId` (of the batch's course, once each), `weeklyClasses` 1–14 | 201 `{ drafts[{ id, subjectName, weekday, startTime, durationMinutes, teacherName, roomCode, classes, warnings[] }], unplaced[{ subjectId, subjectName, missing, reasons[{ code, text }] }], notes[], note{ text, source ai\|system, label } }`. Saves **draft** patterns only (never publishes, creates no session) under the timetable lock; audited `timetable.build_drafted` (+ `timetable_pattern.created` per draft; `ai.draft_requested`/`ai.draft_finished` metadata only when AI is set up). **409** when the batch already has draft patterns in the dates; 400 unknown subject, completed/cancelled batch. ACD-029, A24, D-111 |
| `POST /patterns/:id/series` | `timetable:publish` | `effectiveDate` (after today, inside the pattern), `staffId?`, `roomId?`, `weekday?`, `startTime?`, `durationMinutes?`, `reason`, `version` | `{ previousId, pattern, cancelled[], created[] }`: later scheduled occurrences cancelled with the reason (teacher notified, one audit row each), old pattern ends the day before (or is retired), a new published pattern takes over. Delivered classes are never changed |
| `GET /unavailability?staffId=` | `assignments:read` (own: their records) | — | records + `staffName`, `label` = "Academic availability record — not HR leave" |
| `POST /unavailability` | `timetable:write` | `staffId`, `fromDate`, `toDate`, `reason` | 201 `{ record, affectedSessions[] }` (scheduled classes from today in the range that the teacher still teaches). Never assigns a substitute |
| `DELETE /unavailability/:id` | `timetable:write` | `reason` | record withdrawn (`cancelledAt`), row kept (409 already withdrawn) |
| `GET /teachers` | `assignments:read` (own: themselves) | — | directory from core staff + assignments |
| `GET /teachers/:staffId?from=&to=` | `assignments:read` (own) | — | profile: assignments, timetable, planned / delivered / cancelled / substituted counts (operational, not payroll), "HR attendance unavailable". Default window the last 30 days |

## 4. Teaching log and attendance
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /class-records?batchId=&teacherStaffId=&state=&from=&to=` | `classes:read` (own: their sessions) | — | records + session date/time, planned minutes, batch/chapter codes, teacher name (max 500); drafts only to their author |
| `POST /class-records` | `classes:record` (own: sessions they teach, incl. as substitute or co-teacher) | `sessionId`, `chapterId`, `activity` main\|practice\|catch_up\|test\|discussion\|revision\|doubt_solving, `completion` completed\|partial, `actualMinutes` 1–600, `materials?`, `homework?`, `homeworkDueOn?`, `difficulties?`, `nextPlan?`, `catchUpNeeded?`, `notes?`, `evidence?`, `submit?` (no defaults) | 201 record `draft`, or `submitted` with `submit: true`. The log names the actor as teacher when they are on the session (substitute, co-teacher), else the planned teacher. Never changes the session. 404 not own; 400 future session, no teacher, foreign/retired chapter, **submit before the class is marked delivered** (draft kept); 409 cancelled/rescheduled session, a draft or a log for that chapter already exists |
| `PATCH /class-records/:id` | `classes:record` (author of the draft) | the same fields + `version`, `submit?` | draft saved or submitted (404 another author's draft; 409 not a draft or stale version; 400 submit before delivery) |
| `POST /class-records/:id/verify` | `classes:verify` | — | record `verified` (409 unless submitted) |
| `POST /class-records/:id/request-correction` | `classes:verify` | `reason` | 201: the record becomes `superseded` and a new draft (`corrects_record_id`, reason) goes back to the log's teacher to fix and resubmit; audited `class_record.correction_requested` |
| `POST /class-records/:id/correct` | `classes:verify` | `chapterId?`, `completion?`, `actualMinutes?`, `activity?`, `notes?`, `reason` | 201 `{ original (superseded, content unchanged), correction (verified) }` (409 already superseded) |
| `GET /class-records/exceptions?batchId=&teacherStaffId=&from=&to=` | `classes:read` (own) | — | `{ window, missingLogs[] (delivered, no submitted/verified log; drafts do not count), discrepancies[] (planned chapter not among logged chapters) }`; default window the last 30 days |
| `GET /sessions/:id/attendance` | `attendance:read` (own) | — | `{ session, roster[{ studentId, code, fullName, isSample, onPlacement, mark }], demoAttendees[], counts, demoCounts, recorded, notRecorded, history[] }`; counts keep `notRecorded` separate |
| `PUT /sessions/:id/attendance` | `attendance:record` (own) | `marks[0..500]`: `studentId`, `status`, `minutesPresent?`, `note?`; `demoMarks[0..200]`: `attendeeId`, `status` present\|late\|absent\|excused, `note?`; `reason?` (required when a recorded status or minutes change); at least one mark | `{ sessionId, recorded, rosterSize, changed }`; audited `attendance.recorded` / `attendance.corrected` (with the reason and each change). Does **not** mark the session delivered. 400 duplicate student, student not placed on the session date, unknown demo attendee, future session, missing reason |
| `POST /sessions/:id/attendance/mark-remaining` | `attendance:record` (own) | — | `{ sessionId, marked }`: every placed student and demo attendee still without a mark becomes present; recorded marks untouched; audited `attendance.bulk_present` |
| `GET /demo-attendees?sessionId=` | `attendance:record` (own) | — | Business Ops demo sessions on the class date (`GET /ops/api/internal/v1/demo-sessions?date=`), or `{ status: 'unavailable', reason }` when Ops cannot be reached — never an empty list |
| `POST /demo-attendees` | `attendance:record` (own) | `sessionId`, `opsDemoSessionId` | 201 attendee (name, core student id and day number from the Ops item). 400 cancelled/rescheduled session or no such demo session that day; 409 Ops unavailable or already on the class |
| `DELETE /demo-attendees/:id` | `attendance:record` (own) | `reason` | removed (409 once a mark is recorded: correct the mark instead) |

## 5. Assessments
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /assessments?batchId=` | `assessments:read` (own batches) | — | assessments + `batchCode` |
| `POST /assessments` | `assessments:write` | `code`, `title`, `kind`, `batchId`, `subjectId?`, `chapterIds[]`, `scheduledDate?`, `startTime?`, `durationMinutes?`, `discussionMinutes?`, `patternRef?`, `marksPerCorrect?`, `marksPerWrong?`, `marksUnattempted?`, `sections[]` (see below) | 201 (status `scheduled` when dated, else `draft`) |
| `GET /assessments/:id` | `assessments:read` (own) | — | assessment + `sections`, `answerKeys` (versions), `attempts` counts, `resultRuns` |
| `PUT /assessments/:id/scoring` | `assessments:write` | `marksPerCorrect`, `marksPerWrong`, `marksUnattempted` (each may be null = unknown), `sections[1..20]` | `{ assessment, sections }` (409 finalised/cancelled, or structure change after responses exist; 400 duplicate section codes) |
| `POST /assessments/:id/answer-keys` | `assessments:write` | `answers { sectionCode: (answer\|null)[] }` (null = dropped question), `note?` | 201 key with `version` = previous + 1 |
| `POST /assessments/:id/attempts` | `assessments:write` | either `csv` (`student_code,key_version,section_code,answers` with `\|`-separated answers, `ABSENT` section) or `attempts[]`: `studentId`, `status` submitted\|absent, `keyVersion?`, `responses?` | `{ saved, replaced, submitted, absent }`; status → `conducted` (400 CSV problems with line numbers, unknown codes, duplicates, students not enrolled — nothing saved) |
| `POST /assessments/:id/validate` | `assessments:read` (own) | — | `{ ok, issues[{ code, message, studentId?, sectionCode?, questionNo? }], keyVersion, attempts, enrolled }` |
| `POST /assessments/:id/finalise` | `assessments:finalise` | — | 201 `{ run (version 1, final), scored, absent, sectionStats }`; publishes `academic.assessment.finalised` v1 (400 with all issues; 409 already final / cancelled) |
| `POST /assessments/:id/rescore` | `assessments:finalise` | `reason` | 201 `{ run (version n+1), previousVersion, scored, absent }`; previous run `superseded` (kept); audited before/after totals (409 unless finalised) |
| `GET /assessments/:id/results?version=` | `assessments:read` (own: their students' rows) | — | `{ assessment, run, versions[], showRank, results[] (state, totalScore, maxScore, percentile, rank, sectionScores, absent, student code/name) }`; `rank` and `percentile` are null unless setting `progress.show_rank_percentile` is approved with `show: true` |
| `GET /assessments/:id/marks` | `assessments:mark` (own: batches where their assignment is open today and, when the assessment has a subject, that subject) | — | marks sheet: every eligible student (placed in the batch on the assessment date) with state, manual score and attempt `version` (0 = no attempt) |
| `PUT /assessments/:id/marks` | `assessments:mark` (own as above) | `marks[1..2000]`: `studentId`, `state` scored\|absent\|exempt\|withheld\|pending, `manualScore?`, `version` | saved marks; nothing saved on any error. 403 `withheld` (setting or clearing) by anyone without `assessments:publish`; 400 student not eligible, duplicate, total outside the scheme (no negative total without negative marking, max enforced), a student with recorded answers (set Pending first), pending after a finalised result; 409 stale version, cancelled assessment |
| `POST /assessments/:id/publish` | `assessments:publish` | — | `{ id, publishedAt, publishedByUserId }`; only published results reach Business Ops. 409 not finalised or already published (a later re-score is visible at once as the new final version) |
| `GET /assessments/:id/analysis` | `assessments:read` (own batches) | — | `{ analysis (eligible, scored, absent, exempt, withheld, pending, mean, highest, lowest, max, meanPercent), sections[], topics (questions not mapped to chapters), comparison { comparable[], notComparable[], trend } }`; `analysis: null` before finalising |
| `POST /assessments/schedule-check` | `assessments:read` (own) | `batchId`, `candidates?[]`: `id`, `label`, `date`, `startTime?`, `durationMinutes?`, `discussionDate?`, `chapterIds[]` (without candidates: every dated assessment of the batch) | `{ batch, blackouts[], minGap, checked, verdict, hard[], preferences[], conflictingCandidates[] }` |

Section body: `code`, `name`, `questionCount` 1–500, `answerFormat` choice\|numeric, `options` (default A–D), `timeLimitMinutes?`, `marksPerCorrect?`, `marksPerWrong?`, `marksUnattempted?`, `capMarks?` (null/absent = inherit the assessment rule).

Validation codes: `NO_SECTIONS`, `RULE_INCOMPLETE`, `NO_ANSWER_KEY`, `KEY_INVALID`, `KEY_VERSION_MISMATCH`, `MISSING_RESPONSES`, `OUT_OF_RANGE`, `DUPLICATE_ATTEMPT`, `NOT_ENROLLED`, `MISSING_ATTEMPT`. Schedule codes: `CLASS_CLASH`, `ASSESSMENT_CLASH`, `BLACKOUT` (with `unverified`), `BEFORE_PREREQUISITE`, `MIN_GAP`, `SAME_DAY_TIME_UNKNOWN`, `INVALID_DATE`.

## 6. Students, enrolments, progress
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /students?batchId=&q=` | `students:read` (own: students of their batches) | — | students + active `batches`; contacts, DOB and every guardian field (name, relationship, email, phone; name and relationship since 22 Oct 2026) only for `students:write` holders, else `null` with `contactsHidden: true` (test `teacher-privacy.test.ts`) |
| `POST /students` | `students:write` | `fullName`, `preferredName?`, `dateOfBirth?`, `currentStage?`, `schoolBoard?`, `email?`, `phone?` (E.164), `city?`, guardian fields? | 201 student with generated `code` |
| `GET /students/:id` | `students:read` (own) | — | `{ student, enrolments[] }` (404 outside scope) |
| `GET /students/:id/progress` | `progress:read` (own) | — | `{ student, batches[{ attendance, missed { missed[], unrecorded }, results[], trend }], catchupTasks, interventions, trendOptions }` |
| `GET /enrolments?batchId=` | `enrolments:read` | — | enrolments + student code/name, batch code |
| `POST /enrolments` | `enrolments:decide` | `studentId`, `batchId`, `startDate?`, `reason` | 201 enrolment `source=manual` with its open placement (409 full batch or duplicate active enrolment; 400 batch closed) |
| `GET /placements?view=awaiting\|placed\|transfers\|ended` | `enrolments:read` | — | `{ view, counts{awaiting, placed, transfers, ended}, rows[] }` (counts from the same rows; transfers carry the proposed catch-up chapters). Placement reasons only for `enrolments:decide` holders |
| `POST /placements` | `enrolments:decide` | `enrolmentId`, `batchId`, `startDate?` (default: today or the later enrolment start), `reason?` | 201 placement; `enrolments.batch_id` follows. 400 batch of another programme or course, closed batch; 409 already placed, batch full (seat check on the locked batch row), timetable clash with the student's other batches (details list each clash) |
| `POST /placements/transfer` | `enrolments:decide` | `enrolmentId`, `toBatchId`, `effectiveDate`, `reason` | `{ ended, placement, catchUp { status: 'proposed', chapters[], note } }`: old placement ends the day before, the new one links back. History, attendance, logs and marks untouched; no catch-up task created |
| `POST /placements/end` | `enrolments:decide` | `enrolmentId`, `outcome` completed\|withdrawn, `endDate` (not in the future, not before the start), `reason`, `confirm: true` | `{ enrolment, placement }`; ends this enrolment only (another programme's enrolment is untouched); audited `enrolment.ended` |
| `GET /batches/:id/catch-up` | `progress:read` (own) | — | `{ asOf, weights, ranked[{ rank, score, factors, explanation, task, … }], closed }` |
| `POST /batches/:id/catch-up` | `progress:write` | — | `{ created }` (idempotent: one task per enrolment + session) |
| `PATCH /catch-up-tasks/:id` | `progress:write` | `status?`, `assignedStaffId?`, `dueDate?`, `note?` | task |
| `GET /interventions?studentId=` | `progress:read` (own) | — | interventions + student and responsible names |
| `POST /interventions` | `progress:write` | `studentId`, `batchId?`, `trigger`, `description`, `responsibleStaffId`, `action`, `dueDate?`, support-plan fields `evidence?`, `goal?`, `reviewOn?` | 201 |
| `PATCH /interventions/:id` | `progress:write` | `status?`, `outcome?`, `parentContactStatus?`, `action?` | intervention (400 resolve/close without an outcome) |

## 7. Enrolment intake and settings
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /enrolment-intake` | `enrolments:read` | — | `{ waiting, processed[] (intake log), problems[] (failed/dead deliveries), scheduler }` |
| `POST /enrolment-intake/run` | `enrolments:decide` | — (no body) | `{ processed, failed, skipped }` from `processEvents` |
| `GET /settings` | `courses:read` | — | `[{ key, description, value, status, isDefault, updatedAt }]` |
| `PUT /settings/:key` | `settings:manage` | `value`, `status` proposed\|approved, `decisionRef?` (`D-0xx` or `OD-0xx`) | setting row; the reference is kept in the audit row (404 unknown key; 400 invalid value, or `approved` for a new value without `decisionRef` — only the format is checked) |

## 7a. Teacher reviews
Rules: `docs/ALGORITHMS.md` A19. Visibility labels on screens: `internal` = "Staff only", `shareable` = "May inform a reviewed parent summary".

| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /reviews?academicStudentId=&coreStudentId=&status=&mine=1` | `reviews:read` (own: own reviews any status + submitted reviews of students in current scope) | — | reviews with author, subject, session date, student name (max 500) |
| `POST /reviews` | `reviews:write` (own) | `reviewType` demo_session\|periodic_progress\|assessment_follow_up\|support_referral; exactly one of `academicStudentId` or `coreStudentId` (+ `opsDemoSessionId`, demo reviews only); `sessionId?`, `subjectId?`, `periodFrom?`/`periodTo?` (required for periodic), `strengths?`, `areasForSupport?`, `attendanceEvidence?`, `homeworkEvidence?`, `academicConcerns?`, `suggestedAction?` (at least one), `followUpOn?`, `visibility` internal\|shareable (default internal), `submit?` | 201 draft or submitted version 1. 403 no staff record; 404 student not currently in the author's scope; 400 class not taught by the author, subject not in the student's course, no evidence written |
| `GET /reviews/:id` | `reviews:read` | — | review + visible version history + `isAuthor` (404 when not visible) |
| `PATCH /reviews/:id` | `reviews:write` (author of the draft) | content fields + `updatedAt`, `submit?` | draft saved or submitted. 409 not a draft (submitted versions are never edited), stale `updatedAt`, or a newer version was submitted meanwhile |
| `POST /reviews/:id/revise` | `reviews:write` (author) | — | 201 draft version n + 1 (409 a draft or newer version already exists; only a submitted version can be revised) |
| `POST /reviews/:id/withdraw` | `reviews:write` (author) | `reason` | every submitted version becomes `withdrawn`; Business Ops stops showing the text on its next read |
| `GET /students/:id/reviews` | `reviews:read` (own: student in current scope) | — | `{ reviews[], pending }` — `pending` = no submitted review yet, never a negative signal |

## 7b. Reports (print views and CSV)
`GET /reports/:kind?batchId=&assessmentId=&staffId=&from=&to=&format=json|csv` — route permission `module:access`; each kind re-checks its screen's permission in the service: `attendance` (`attendance:read`, own batches), `coverage` (`batches:read` via the coverage read), `assessment` (`assessments:read`), `teacher-week` (`classes:read`; a teacher sees only their own week, 404 for another). JSON `{ kind, title, subtitle, definition, columns, rows, notes }`; `format=csv` returns `text/csv` built with the shared helper `@elevate/server-kit` `toCsv` (D-071) and writes an audit row `report.exported` (who, which report, filters, row count). The print view is the page `/academic/reports/[kind]` (A4, black on white).

## 8. Internal routes (bearer `INTERNAL_SERVICE_TOKEN` + `X-Elevate-Caller`)
All are `defineInternalRoute`: 401 bad/missing token, 403 caller not allowed, 400 invalid query. Contracts are in `packages/shared-contracts/src/summaries.ts`; consumer rules in `INTEGRATION_CONTRACT.md`.

### Teacher reviews (D-058, R4)
`GET /academic/api/internal/v1/reviews?coreStudentId=|authorStaffId=&from=&to=` — callers `['ops']`; one of `coreStudentId` / `authorStaffId` required; `from`/`to` filter the IST submission date. Response `AcademicStudentReviewsV1` (`contract: 'academic.student_reviews'`, `version: 1`): submitted versions and withdrawn markers (withdrawn text and follow-up date are `null`), never drafts; `superseded` = a later submitted version exists. Each review carries `reviewKey`, `version`, `coreStudentId`, `academicStudentId`, `studentName`, `status`, `authorStaffId`, `authorName`, `subjectName`, `reviewType`, `sessionDate`, `opsDemoSessionId`, period, the six evidence fields, `followUpOn`, `visibility`, `submittedAt`, `withdrawnAt`, `sourcePath`. Academic does not know the Ops user: Business Ops checks `ops:feedback:read` (and filters by `visibility`) before calling. Max 1,000 rows. Test: `tests/integration/reviews.test.ts`.

### Teacher activity
`GET /academic/api/internal/v1/teachers/{staffId}/activity?from=&to=` — callers `['ops']`; default window the last 30 days (IST), at most one year; 404 unknown staff. Response `AcademicTeacherActivityV1`: assignments (batch code, subject, role, dates), session counts planned / delivered / cancelled / substituted (operational, not payroll or HR attendance), logs / attendance / marking pending, reviews submitted / draft, academic unavailability ranges. A staff member with no assignment in the window gets `missing` ("No teaching assignments") for sessions, logs, attendance and marking; reviews are still measured (D-076, 22 Oct 2026). Test: `tests/integration/teachers-myday.test.ts`.

### Demo attendance (D-060, R5)
`GET /academic/api/internal/v1/demo-attendance?ids=<ops demo session ids, comma-separated, 1–200>` — callers `['ops']`. Response `AcademicDemoAttendanceV1`: per linked demo session `{ opsDemoSessionId, academicSessionId, status not_recorded|present|absent|late|excused, recordedAt, teacherStaffIds, teacherNames }` (actual teachers once the class is delivered, incl. a substitute). Ids with no Academic link are simply absent from `items`. Test: `tests/integration/attendance-roster.test.ts`.

### Outbound: Ops demo sessions
Academic calls `GET /ops/api/internal/v1/demo-sessions?date=` (caller `academic`, 3 s timeout) to list demo students for a class date (`OpsDemoSessionsForDayV1`). Unreachable → "Business Ops unavailable" (the add form shows the reason; nothing is added).

### Per-student summary (IR-OPS-STU-1, 21 Oct 2026; placement windows and publication added 21 Oct 2026)
`GET /academic/api/internal/v1/students/{academicStudentId}/summary?from=&to=` — `defineInternalRoute({ callers: ['ops'] })` (Business Ops only). Default window: the last 365 days ending today (IST); at most three years. Errors: 401 bad/missing token, 403 any caller other than `ops`, 400 invalid dates, `from > to` or a window over three years, 404 unknown student. Response: `AcademicStudentSummaryV1` (`contract: 'academic.student_summary'`, `version: 1`; fields in `INTEGRATION_CONTRACT.md` §7). Rules: held sessions per enrolment inside the student's batch placements and the window (a transfer moves the window to the new batch; an enrolment with a batch but no placement history is listed in a non-contract `extensions.attendanceNotRecorded` with "Not recorded — no batch history before 21 Oct 2026"); attendance counts per status (unrecorded = held − the sum) plus, since 22 Oct 2026, `attendance.ratePercent` (per the `attendance.denominator` setting, one `summariseAttendance` over all enrolments; null when nothing is countable) and `attendance.definition` in words — Business Ops prints them and never recomputes (D-076); teachers = the submitted/verified class record's teacher, else the session's teacher, once per subject; results only from final runs of **published** assessments with the assessment date in the window; only `scored` and `absent` states are sent (exempt/withheld have no v1 state); absent results have no score; rank and percentile are null unless setting `progress.show_rank_percentile` is approved with `show: true`; the comparison group is the assessment's batch and run. Service: `src/server/services/student-summary.ts`. Test: `tests/integration/student-summary.test.ts`.

### Delivery summary
`GET /academic/api/internal/v1/summary?from=&to=` — `defineInternalRoute({ callers: ['ops', 'platform'] })`; headers `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` and `X-Elevate-Caller: ops|platform`. Default window: the last 30 days ending today (IST). Errors: 401 bad/missing token, 403 unknown or disallowed caller, 400 invalid dates or `from > to`.

Response: `AcademicDeliverySummaryV1` (`contract: 'academic.delivery_summary'`, `version: 1`, `generatedAt`, `window`, `metrics`, `programmes[]`) plus a non-contract `extensions` object (`hoursPlanned`, `hoursDelivered`, `hoursDeliveredInWindow`, null = missing).

| Metric | Definition | Missing when |
|---|---|---|
| `activeStudents` | students with an active enrolment (at generation) | never |
| `activeBatches` | batches with status active | never |
| `classesPlanned` | timetabled sessions dated in the window | no session ever timetabled for these batches |
| `classesDelivered` | sessions in the window marked delivered (`held`, D-063) | same |
| `classesCancelled` | sessions in the window cancelled | same |
| `attendanceRate` | attended ÷ recorded over held sessions in the window, under setting `attendance.denominator` (proposed: late counts as attended, excused left out) | no attendance recorded |
| `assessmentsPlanned` | assessments (not cancelled) scheduled in the window | no assessments exist |
| `assessmentsConducted` | assessments first finalised in the window | no assessments exist |
| `studentsAtRisk` | — | always (risk rules not implemented) |
| `syllabusCompletionRate` | verified first-teaching (`main`) minutes ÷ planned minutes of active batches' current plans (coverage rules, D-062) | no active batch has a locked/provisional plan |

## 9. Foundation routes in this app
`GET /academic/api/v1/health` (public), `POST /academic/api/v1/auth/login`, `POST /academic/api/v1/auth/logout`.

Changed and added on 22 Oct 2026 (D-072):
| Method | Path | Permission | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/academic/api/v1/auth/login` (changed) | public | form `email`, `password`, `next?` (relative path; control characters and backslashes refused) | form post: **303** to the landing: stay in Academic OS (at `next`) if you belong here; else your remembered workspace; else your only one; else `/academic/workspaces`. Absolute redirects only to the configured origins | 403 cross-site `Origin`; 401 wrong email or password |
| POST | `/academic/api/v1/auth/logout` (changed) | session | — | 303 to sign-in; the session ends on every port | 403 cross-site `Origin` |
| POST | `/academic/api/v1/auth/workspace` (new) | signed in | form `workspace` (`ops` \| `academic` \| `marketing`), `remember=yes` (optional) | **303** to that workspace's home; `remember=yes` stores `core.users.preferred_workspace` and audits `user.workspace_preference_set` | 303 to sign-in when signed out; 403 a workspace you do not belong to; 403 cross-site `Origin` |

## 10. Tasks and EOD reports mounted from Business Ops (22 Oct 2026, D-073)
Fifteen route files under `/academic/api/v1/` re-export Business Ops' handlers (`workRoutes` from `@elevate/business-ops-os/work`): `staff-tasks`, `staff-tasks/:id`, `staff-tasks/:id/:action`, `staff-tasks/:id/dependencies`, `staff-tasks/:id/reassign`, `staff-tasks/:id/report`, `staff-tasks/:id/updates`, `eod-reports`, `eod-reports/:id`, `eod-reports/:id/csv`, `eod-reports/:id/follow-up`, `eod-reports/:id/pdf`, `eod-reports/:id/review`, `eod-reports/:id/submit`, `task-reports`. Permissions (`ops:tasks:read/write`, own scope for teachers; `ops:eod:review` for reviewers), requests, responses and errors are exactly those in `apps/business-ops-os/docs/API.md` ("Daily tasks, end-of-day reports, imports"); the workspace check here is `academic:module:access`. The records are the same `ops.staff_tasks` / `ops.eod_*` rows: nothing is copied. Tracker imports are not mounted. Test: `tests/integration/work-mount.test.tsx`.

## 11. Added on 23 Oct 2026 (HR area, D-080 … D-093; grants Proposed)
### Internal: teaching assignments for HR (D-083)
`GET /academic/api/internal/v1/teaching-assignments?staffId=&status=&q=&page=&pageSize=` — callers `['ops']` only (bearer token + `X-Elevate-Caller: ops`); one page of `academic.teaching_assignments` v1 for Business Operations' HR Teaching Assignments page. Pending rows (no batch yet) are included; page size at most 100. Assignment statuses are `pending | active | ended`; only a non-pending row with a batch whose dates cover the day gives a teacher access (`assignmentActiveOn`).

### Mounted from Business Operations (same handlers and permissions as `apps/business-ops-os/docs/API.md`, "Routes added or changed on 23 Oct 2026")
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/academic/api/v1/attendance` | `ops:attendance:read` (own) | Your own staff attendance days |
| GET, POST | `/academic/api/v1/attendance/corrections` | `ops:attendance:read` / `ops:attendance:request` (own) | Ask HR to correct one of your days |
| GET | `/academic/api/v1/feedback/mine`, `…/mine/{id}` | `ops:teacher_feedback_summaries:read` (own) | Your approved feedback summaries and agreed actions, never raw rows |
| POST | `/academic/api/v1/ai/report-draft` | `ops:tasks:write` | AI draft of your own report's narrative (nothing saved) |
| POST, GET, DELETE | `/academic/api/v1/attachments`, `…/{id}` | the owning record's rule | Files on your tasks and submissions |
| GET, POST | `/academic/api/v1/notifications` | `platform:notifications:read` (own) | Your notifications; the bell links to `/academic/notifications` |
| — | `/academic/api/v1/staff-tasks/{id}/checklist` | `ops:tasks:write` | Plus the task actions, reassign, dependencies, updates and report already mounted (D-073) |

Pages: `/academic/my-attendance`, `/academic/my-feedback`, `/academic/my-reports` (day, week and month reports), `/academic/notifications`.

## 12. Added on 23–24 Oct 2026 (milestone: one test record for Business Ops, requests through HR)
Nothing here is Deployed.

### Internal: tests and mock tests for Business Operations (Implemented, Tested: `tests/integration/assessment-ops.test.ts`, `teacher-scope.test.ts`, `tests/unit/assessment-bounds.test.ts`; Ops side `apps/business-ops-os/tests/integration/tests-ops.test.ts`)
A test is ONE record in Academic (`academic.assessments` with its eligible batches, roster snapshot, marks state, result runs and publication versions). Business Ops owns the Tests and Mock Tests screens, uploads, score import and publishing, and writes the record only through these routes. Auth: `Authorization: Bearer <internal token>` + `X-Elevate-Caller: ops` (any other caller → 403). Write routes (`defineInternalWriteRoute`, `packages/server-kit/src/internal.ts`) also need `x-elevate-acting-user: <user id>` (missing or not a UUID → 400; unknown user → 400; disabled user → 403); that user is the audit actor. Ops checks the user's own permission (`ops:assessments:manage` / `:publish`) before calling. Bodies are JSON (`application/json`), validated against `packages/shared-contracts/src/modules/academic.ts`. Every write answers the full `academic.assessment` v1 detail.

| Method & path (under `/academic/api/internal/v1`) | Request | Response / errors |
|---|---|---|
| `GET /assessments` | `?view=upcoming\|in_progress\|previous\|awaiting_publication&courseId&batchId&teacherStaffId&from&to&page&pageSize≤100` | `academic.assessments` v1: one page, `viewCounts` per view, `filterOptions` (courses, batches) |
| `POST /assessments` | `{ code, kind: chapter_test\|sectional\|full_mock\|practice, title, academicYear, batchIds[1–50] (first = primary, one course), subjectId?, scheduledDate?, startTime?, durationMinutes?, maxMarks?, marksPerCorrect?, marksPerWrong?, marksUnattempted?, sections[]?, responsibleTeacherStaffId?, evaluatorStaffId? }` | detail (draft, or scheduled with a date). 400 unknown batch, batches of two courses, subject outside the course, teacher not a staff member, maximum ≤ 0; 409 code exists |
| `GET /assessments/{id}` | — | `academic.assessment` v1: `assessment` (batches, marking, per-section effective rules, `rosterSnapshotAt`, roster counts), `roster` (incl. `studentCode`, `admissionNumber`, attendance, marks state, version), `results` (null until finalised), `publication` (state and history); 404 |
| `PATCH /assessments/{id}` | the fields above (partial), `status: scheduled\|cancelled`, `reason` (required to cancel) | 400 scheduled without a date; 409 finalised or cancelled; 409 batches after the roster was taken; 409 marking rule or sections after marks were entered |
| `POST /assessments/{id}/roster` | `{ admissionNumbers: [{ coreStudentId, admissionNumber }] }` (copied for display; identity is the student id) | Snapshot of the eligible batches' active placements on the test date, once. 409 already taken; 409 not scheduled with a date |
| `POST /assessments/{id}/roster/corrections` | `{ action: add\|remove\|restore, studentId, batchId (add), admissionNumber?, reason }` | 400 not an eligible batch, no active placement there on the test date; 409 already on (or removed from) the roster, admission number used by another roster student; 404 not on the roster |
| `POST /assessments/{id}/scores` | `{ source: csv\|pdf_ai\|manual, importRef?, rows[1–2000]: { studentId, version, attendance?, marksState: not_entered\|imported\|verified, score }, overwriteVerified?, reason? }` | All rows or none. 400 a student twice, not on the active roster, a row outside the roster or marking rules (per-section bounds; blank is not 0); 409 stale `version` (`details.stale`); 409 a verified mark would change without `overwriteVerified` + `reason` (`details.overwriteRequired`); 409 no roster or cancelled. After a final publication a change needs a reason and creates a new result version; a correction that leaves the roster incomplete withdraws the current publication (audited) |
| `POST /assessments/{id}/finalise` | `{}` | Mirrors the roster into attempts and writes result version 1 |
| `POST /assessments/{id}/publications` | `{ version (= current + 1), rankingScope: roster\|cohort, cohortBatchIds? (exactly when cohort), provisional, note? }` | Publishes; ranks are competition ranks (1, 2, 2, 4) over present students with verified marks. 409 no roster, not finalised, stale version (`details.expectedVersion`); 409 incomplete results (`details.issues`) unless provisional, and provisional only when the setting `assessments.provisional_publication` allows it (Proposed: off); 400 cohort batches not eligible |
| `POST /assessments/{id}/publications/{version}/withdraw` | `{ reason }` | 404 unknown version; 409 not the current publication |

### Changed behaviour on existing teacher routes (no new route)
Teachers' per-student marks, results, progress and analysis follow one scope rule: the (batch, subject, academic year, dates) pairs of their active assignments, through `markBatchesInScope` / `markStudentIds` (`src/server/services/assessment-scope.ts`). A teacher's student payload is an allow-list; the director and the auditor keep their previous view. Tested: `tests/integration/teacher-scope.test.ts`, `teacher-privacy.test.ts`, `students-progress.test.ts`.

### Mounted from Business Operations (same handlers and permissions as `apps/business-ops-os/docs/API.md`, "Routes added or changed on 23–24 Oct 2026")
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET, POST | `/academic/api/v1/hr-requests` | `ops:hr_requests:create` (GET also `ops:hr_requests:read`) | Your requests through HR; send one |
| GET, PATCH | `/academic/api/v1/hr-requests/{id}` | as in Ops | Viewer-shaped request; edit your draft |
| POST | `/academic/api/v1/hr-requests/{id}/{action}` | as in Ops | `submit`, `respond` and HR's actions |
| GET | `/academic/notifications/{id}/open` (page route) | `platform:notifications:read` | Marks read, re-checks access, 303 to the link |

Pages: `/academic/hr-requests`.
