# Academic OS — API reference

Base path `/academic/api/v1`. Every route is built with `defineRoute` (`src/app/api/**/route.ts`; schemas in `src/server/schemas.ts`).

**Conventions**
- Order of checks: no session → **401** `UNAUTHENTICATED`; missing permission → **403** `FORBIDDEN` (before validation); invalid params/query/body → **400** `VALIDATION_FAILED` with `details: [{ location, path, message }]`; then the handler.
- Bodies are JSON (`Content-Type: application/json`). Success `{ "data": … }` (201 for creates); failure `{ "error": { code, message, details?, requestId } }`.
- Handler errors: **404** `NOT_FOUND` (also for records outside a teacher's own scope), **409** `CONFLICT` (unique violations, timetable conflicts with `details.hard`/`details.preferences`, full batch), **409** `INVALID_STATE_TRANSITION`, **400** `VALIDATION_FAILED` (business validation, e.g. finalise issues in `details`).
- "own" = teacher scope (README §3): sessions they teach, batches they are assigned to, students enrolled in those batches.
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
| `PATCH /batches/:id` | `batches:write` | `status?`, `capacity?`, `startDate?`, `endDate?` | batch |
| `GET /batches/:id/coverage?asOf=` | `batches:read` (own) | — | `{ batch, plan, asOf, coverage { chapters[], subjects[], course, unplanned[] }, note }` |
| `GET /batches/:id/feasibility?from=&to=` | `timetable:read` (own) | — | `{ batch, plan, window, ruleStatuses, exclusionStatuses, result }` (`result` = capacity result, or `null` + `message` without rules/dates) |
| `GET /assignments` | `assignments:read` (own: their assignments) | — | assignments with batch, subject and staff names |
| `POST /assignments` | `assignments:write` | `batchId`, `subjectId`, `staffMemberId`, `employmentType?`, `startDate?` | 201 (400 subject of another course / inactive staff; 409 duplicate active) |
| `GET /staff` | `assignments:write` | — | active/on-leave core staff `{ id, fullName, title, userId }` |
| `GET /rooms` | `timetable:read` | — | rooms |
| `POST /rooms` | `timetable:write` | `code`, `name`, `capacity?` | 201 room |
| `GET /exclusions?batchId=` | `timetable:read` | — | exclusions (with `batchId`: the batch's + centre-wide) |
| `POST /exclusions` | `timetable:write` | `batchId?`, `kind`, `label`, either `date` or `periodStart`+`periodEnd`; allowances need `days` + `slotsPerDay` (not for `exam_blackout` windows); `status`='provisional' | 201 |
| `POST /calendar-rules` | `batches:write` | `batchId`, `label`, `periodStart`, `periodEnd`, `weekdays[1..7]`, `slotsPerDay` 1–12, `kind` regular\|extra, `status`='provisional' | 201 |

## 3. Timetable
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /sessions?batchId=&from=&to=` | `timetable:read` (own: sessions they teach) | — | sessions + batch/subject/chapter codes, teacher name, room code (max 1000) |
| `POST /sessions` | `timetable:write` | `sessions[1..200]`: `batchId`, `subjectId?`, `plannedChapterId?`, `teacherStaffId?`, `roomId?`, `sessionType`='teaching', `date`, `startTime`, `durationMinutes` 5–600, `onlineLink?` | 201 `{ sessions, warnings (preferences), notes }`; **409** `CONFLICT` with `details.hard` when any hard constraint fails (nothing saved) |
| `POST /sessions/:id/cancel` | `timetable:write` | `reason` | session `cancelled` (409 unless scheduled); teacher notified |
| `POST /sessions/:id/reschedule` | `timetable:write` | `date`, `startTime`, `durationMinutes?`, `teacherStaffId?`, `roomId?` (null clears), `reason` | 201 `{ original (rescheduled), replacement, warnings }` (409 conflicts / not scheduled) |
| `POST /timetable/check` | `timetable:read` (own: their sessions) | `batchId?`, `from`, `to`, `candidates[]` (session shape) | `{ verdict feasible\|infeasible, hard[], preferences[], checkedSessions, notes[] }` — read-only |

Conflict objects: `{ code, severity hard|preference, sessionIds[], date, message }`; codes `TEACHER_OVERLAP`, `BATCH_OVERLAP`, `ROOM_OVERLAP`, `ON_EXCLUSION`, `CROSSES_MIDNIGHT`, `INVALID_TIME`, `DURATION_MISMATCH`, `CLASS_LENGTH_UNKNOWN`, `TEACHER_WORKLOAD`.

## 4. Teaching log and attendance
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /class-records?batchId=&state=` | `classes:read` (own: their sessions) | — | records + session date/time, planned minutes, batch/chapter codes, teacher name (max 500) |
| `POST /class-records` | `classes:record` (own: their sessions) | `sessionId`, `chapterId`, `completion` completed\|partial, `actualMinutes` 1–600, `activity`='main', `notes?`, `evidence?` | 201 record `submitted`; session → `held` (404 not own; 409 cancelled/rescheduled session or chapter already logged; 400 future session, no teacher, foreign/retired chapter) |
| `POST /class-records/:id/verify` | `classes:verify` | — | record `verified` (409 unless submitted) |
| `POST /class-records/:id/correct` | `classes:verify` | `chapterId?`, `completion?`, `actualMinutes?`, `activity?`, `notes?`, `reason` | 201 `{ original (superseded, content unchanged), correction (verified) }` (409 already superseded) |
| `GET /sessions/:id/attendance` | `attendance:read` (own) | — | `{ session, roster[{ studentId, code, fullName, enrolmentId, mark }], recorded, notRecorded }` |
| `PUT /sessions/:id/attendance` | `attendance:record` (own) | `marks[1..500]`: `studentId`, `status`, `minutesPresent?`, `note?` | `{ sessionId, recorded, rosterSize }`; session → `held`; audited as recorded/corrected (400 duplicate student, student not on roster, future session) |

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
| `GET /assessments/:id/results?version=` | `assessments:read` (own: their students' rows) | — | `{ assessment, run, versions[], results[] (totalScore, maxScore, percentile, rank, sectionScores, absent, student code/name) }` |
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
| `POST /enrolments` | `enrolments:decide` | `studentId`, `batchId`, `startDate?`, `reason` | 201 enrolment `source=manual` (409 full batch or duplicate active enrolment; 400 batch closed) |
| `GET /batches/:id/catch-up` | `progress:read` (own) | — | `{ asOf, weights, ranked[{ rank, score, factors, explanation, task, … }], closed }` |
| `POST /batches/:id/catch-up` | `progress:write` | — | `{ created }` (idempotent: one task per enrolment + session) |
| `PATCH /catch-up-tasks/:id` | `progress:write` | `status?`, `assignedStaffId?`, `dueDate?`, `note?` | task |
| `GET /interventions?studentId=` | `progress:read` (own) | — | interventions + student and responsible names |
| `POST /interventions` | `progress:write` | `studentId`, `batchId?`, `trigger`, `description`, `responsibleStaffId`, `action`, `dueDate?` | 201 |
| `PATCH /interventions/:id` | `progress:write` | `status?`, `outcome?`, `parentContactStatus?`, `action?` | intervention (400 resolve/close without an outcome) |

## 7. Enrolment intake and settings
| Method & path | Permission | Request | Response |
|---|---|---|---|
| `GET /enrolment-intake` | `enrolments:read` | — | `{ waiting, processed[] (intake log), problems[] (failed/dead deliveries), scheduler }` |
| `POST /enrolment-intake/run` | `enrolments:decide` | — (no body) | `{ processed, failed, skipped }` from `processEvents` |
| `GET /settings` | `courses:read` | — | `[{ key, description, value, status, isDefault, updatedAt }]` |
| `PUT /settings/:key` | `settings:manage` | `value`, `status` proposed\|approved | setting row (404 unknown key; 400 invalid value) |

## 8. Internal summary
### Per-student summary (IR-OPS-STU-1, 21 Oct 2026)
`GET /academic/api/internal/v1/students/{academicStudentId}/summary?from=&to=` — `defineInternalRoute({ callers: ['ops'] })` (Business Ops only). Default window: the last 365 days ending today (IST); at most three years. Errors: 401 bad/missing token, 403 any caller other than `ops`, 400 invalid dates, `from > to` or a window over three years, 404 unknown student. Response: `AcademicStudentSummaryV1` (`contract: 'academic.student_summary'`, `version: 1`; fields in `INTEGRATION_CONTRACT.md` §7). Rules: held sessions per enrolment from the later of the window start and the enrolment start; attendance counts per status (unrecorded = held − the sum); teachers = the class record's teacher, else the session's teacher, once per subject; results only from final runs with the assessment date in the window; absent results have no score, percentile or rank; the comparison group is the assessment's batch and run. Service: `src/server/services/student-summary.ts`. Test: `tests/integration/student-summary.test.ts`.

### Delivery summary
`GET /academic/api/internal/v1/summary?from=&to=` — `defineInternalRoute({ callers: ['ops', 'platform'] })`; headers `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` and `X-Elevate-Caller: ops|platform`. Default window: the last 30 days ending today (IST). Errors: 401 bad/missing token, 403 unknown or disallowed caller, 400 invalid dates or `from > to`.

Response: `AcademicDeliverySummaryV1` (`contract: 'academic.delivery_summary'`, `version: 1`, `generatedAt`, `window`, `metrics`, `programmes[]`) plus a non-contract `extensions` object (`hoursPlanned`, `hoursDelivered`, `hoursDeliveredInWindow`, null = missing).

| Metric | Definition | Missing when |
|---|---|---|
| `activeStudents` | students with an active enrolment (at generation) | never |
| `activeBatches` | batches with status active | never |
| `classesPlanned` | timetabled sessions dated in the window | no session ever timetabled for these batches |
| `classesDelivered` | sessions in the window with ≥ 1 verified class record | same |
| `classesCancelled` | sessions in the window cancelled | same |
| `attendanceRate` | (present + late + partial) ÷ (recorded − excused) over held sessions in the window | no attendance recorded |
| `assessmentsPlanned` | assessments (not cancelled) scheduled in the window | no assessments exist |
| `assessmentsConducted` | assessments first finalised in the window | no assessments exist |
| `studentsAtRisk` | — | always (risk rules not implemented) |
| `syllabusCompletionRate` | verified minutes ÷ planned minutes of active batches' current plans | no active batch has a locked/provisional plan |

## 9. Foundation routes in this app
`GET /academic/api/v1/health` (public), `POST /academic/api/v1/auth/login`, `POST /academic/api/v1/auth/logout`.
