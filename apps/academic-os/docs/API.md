# Academic OS — API reference

Base path `/academic/api/v1`. Every route is built with `defineRoute` (`src/app/api/**/route.ts`; schemas in `src/server/schemas.ts`, `schemas-placements.ts`, `schemas-sessions.ts`, `schemas-teaching.ts`, `schemas-assessment.ts`). Status of the 21 Oct 2026 teacher-workspace routes: **Tested** where a test file is named in `docs/TEST_PLAN.md`; nothing is Deployed; their tables arrive with migration `0009`, generated, not applied.

**Conventions**
- Order of checks: no session → **401** `UNAUTHENTICATED`; missing permission → **403** `FORBIDDEN` (before validation); invalid params/query/body → **400** `VALIDATION_FAILED` with `details: [{ location, path, message }]`; then the handler.
- Bodies are JSON (`Content-Type: application/json`). Success `{ "data": … }` (201 for creates); failure `{ "error": { code, message, details?, requestId } }`.
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
| `GET /students?batchId=&q=` | `students:read` (own: students of their batches) | — | students + active `batches`; contacts and DOB only for `students:write` holders, else `contactsHidden: true` |
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
`GET /academic/api/internal/v1/teachers/{staffId}/activity?from=&to=` — callers `['ops']`; default window the last 30 days (IST), at most one year; 404 unknown staff. Response `AcademicTeacherActivityV1`: assignments (batch code, subject, role, dates), session counts planned / delivered / cancelled / substituted (operational, not payroll or HR attendance), logs / attendance / marking pending, reviews submitted / draft, academic unavailability ranges. Test: `tests/integration/teachers-myday.test.ts`.

### Demo attendance (D-060, R5)
`GET /academic/api/internal/v1/demo-attendance?ids=<ops demo session ids, comma-separated, 1–200>` — callers `['ops']`. Response `AcademicDemoAttendanceV1`: per linked demo session `{ opsDemoSessionId, academicSessionId, status not_recorded|present|absent|late|excused, recordedAt, teacherStaffIds, teacherNames }` (actual teachers once the class is delivered, incl. a substitute). Ids with no Academic link are simply absent from `items`. Test: `tests/integration/attendance-roster.test.ts`.

### Outbound: Ops demo sessions
Academic calls `GET /ops/api/internal/v1/demo-sessions?date=` (caller `academic`, 3 s timeout) to list demo students for a class date (`OpsDemoSessionsForDayV1`). Unreachable → "Business Ops unavailable" (the add form shows the reason; nothing is added).

### Per-student summary (IR-OPS-STU-1, 21 Oct 2026; placement windows and publication added 21 Oct 2026)
`GET /academic/api/internal/v1/students/{academicStudentId}/summary?from=&to=` — `defineInternalRoute({ callers: ['ops'] })` (Business Ops only). Default window: the last 365 days ending today (IST); at most three years. Errors: 401 bad/missing token, 403 any caller other than `ops`, 400 invalid dates, `from > to` or a window over three years, 404 unknown student. Response: `AcademicStudentSummaryV1` (`contract: 'academic.student_summary'`, `version: 1`; fields in `INTEGRATION_CONTRACT.md` §7). Rules: held sessions per enrolment inside the student's batch placements and the window (a transfer moves the window to the new batch; an enrolment with a batch but no placement history is listed in a non-contract `extensions.attendanceNotRecorded` with "Not recorded — no batch history before 21 Oct 2026"); attendance counts per status (unrecorded = held − the sum); teachers = the submitted/verified class record's teacher, else the session's teacher, once per subject; results only from final runs of **published** assessments with the assessment date in the window; only `scored` and `absent` states are sent (exempt/withheld have no v1 state); absent results have no score; rank and percentile are null unless setting `progress.show_rank_percentile` is approved with `show: true`; the comparison group is the assessment's batch and run. Service: `src/server/services/student-summary.ts`. Test: `tests/integration/student-summary.test.ts`.

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
