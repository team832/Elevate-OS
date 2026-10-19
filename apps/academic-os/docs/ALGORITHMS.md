# Academic OS — algorithms and business rules

Every algorithm lives in `src/domain` (pure, deterministic, no I/O) and is documented in the BUILD_PLAN 10-point format. No algorithm here ever labels a schedule "optimal": checks answer **feasible / infeasible** (capacity also **not_assessed**) with reasons.

Contents: A1 exact marks · A2 scoring rule resolution and per-question scoring · A3 validation before finalising · A4 aggregation, ranks and percentiles · A5 curriculum coverage · A6 timetable conflict detection · A7 capacity feasibility · A8 assessment scheduling constraints · A9 attendance summary · A10 missed classes · A11 assessment trend · A12 catch-up prioritisation · A13 enrolment intake decision · A14 plan status rules and supersession · A15 responses CSV parsing · A16 settings resolution.

---

## A1. Exact marks arithmetic (`marks.ts`)
1. **Purpose** — score without floating-point drift (e.g. 120 × −0.25 must be exactly −30).
2. **Inputs** — decimal mark values as strings or numbers (`"-0.25"`, `1`, `0.5`); response/key strings for numeric answers.
3. **Output** — integer units (1 mark = 10 000 units; `UNITS_PER_MARK`); display strings (`formatMarks` → `12.75`, `-0.5`, `12`); database strings (`toNumericString` → `-0.2500` for `numeric(10,4)`); canonical numeric answers (`canonicalNumber`).
4. **Preconditions** — at most 6 integer digits and 4 decimals.
5. **Rules** — values needing more than 4 decimals are rejected, never rounded; `-0` normalises to 0; numeric answers compare canonically (`12.50` = `12.5` = `+12.5`; `-0` = `0`; exponents rejected).
6. **Steps** — regex parse sign / whole / fraction → `sign × (whole × 10 000 + fraction padded to 4)`; arithmetic is integer addition and multiplication by whole counts.
7. **Errors and edge cases** — `null`/`undefined`/`''` → `null` (unknown, not 0); non-finite or > 4-decimal numbers (e.g. `1/3`) throw `RangeError`; `isExactMark` is the non-throwing check used by request schemas.
8. **Permissions** — none (pure).
9. **Tests** — `tests/unit/scoring.test.ts` › "exact marks (integer units)": *parses decimals exactly and formats them back*; *rejects values that would need rounding (more than 4 decimals) or garbage*; *has no float drift: 120 wrong answers at −0.25 sum to exactly −30*; *canonicalises numeric answers*.
10. **Known limitations** — rules such as −1/3 cannot be represented exactly; they are rejected rather than approximated.

## A2. Scoring rule resolution and per-question scoring (`scoring.ts` › `resolveRules`, `normaliseAnswer`, `scoreAttempt`)
1. **Purpose** — compute section and total scores for one attempt under a configurable rule; no exam's rule is hard-coded (BR-ACD-16).
2. **Inputs** — assessment rule (`marksPerCorrect`, `marksPerWrong` (signed), `marksUnattempted`); sections (`code`, `questionCount`, `answerFormat` choice|numeric, `options`, per-section overrides, optional `capMarks`); answer key `{ section: (answer|null)[] }`; responses `{ section: (answer|null)[] }`.
3. **Output** — per section `{ correct, wrong, unattempted, dropped, rawUnits, scoreUnits, maxUnits, capped, score, max }` and totals `{ totalUnits, maxUnits, total, max }`.
4. **Preconditions** — rules resolved without problems (A3 guarantees this before finalising).
5. **Rules** — effective value = section override, else assessment value; `null` = unknown (a problem, never assumed 0); `marksPerCorrect` > 0; `marksPerWrong` ≤ 0 (a penalty); cap ≥ 0. Per question: key `null` → **dropped** (no marks either way, removed from the maximum); response empty/null → **unattempted**; equal after normalisation → **correct**; otherwise **wrong** (including out-of-range responses if scoring were forced). Choice answers compare case-insensitively against `options`.
6. **Steps** — resolve rules → for each section count outcomes → `raw = c×perCorrect + w×perWrong + u×perUnattempted` → `score = min(raw, cap)` when a cap is set → `max = (questions − dropped)×perCorrect`, capped → sum sections.
7. **Errors and edge cases** — scores can be negative (all wrong under a penalty); unattempted marks may be positive if configured; a missing resolved rule for a section throws (programming error).
8. **Permissions** — callers: `assessments:read` (validate), `assessments:finalise` (finalise/re-score).
9. **Tests** — `scoring.test.ts` › "resolveRules": *uses section overrides before the assessment rule*; *reports unknown (null) values instead of assuming zero*; *rejects a positive "penalty" and a non-positive reward*. › "scoreAttempt": *applies negative marking and unattempted marks exactly (quarter marks)*; *can go negative when every answer is wrong*; *awards marks for unattempted questions when the rule says so*; *caps a section score and its maximum*; *drops questions with a null key entry (no marks either way, max reduced)*; *compares numeric short answers canonically*.
10. **Known limitations** — no per-question weights or partial credit; per-question-type differences are modelled as separate sections.

## A3. Validation before finalising (`scoring.ts` › `validateForFinalise`)
1. **Purpose** — refuse to finalise unless everything needed for a correct result is present (ACD-018).
2. **Inputs** — assessment rule, sections, the current (latest) answer key `{ version, answers }`, all attempts `{ attemptId, studentId, status, responses, keyVersion }`, student ids with an active enrolment in the batch.
3. **Output** — `{ ok, issues[], rules }`; every issue at once with `code`, `message` and where relevant `studentId`, `sectionCode`, `questionNo`.
4. **Preconditions** — none; it is safe to call at any time (`POST …/validate` is read-only).
5. **Rules** — codes: `NO_SECTIONS`; `RULE_INCOMPLETE` (unknown or invalid rule values); `NO_ANSWER_KEY`; `KEY_INVALID` (section missing, wrong length, invalid key answer); `KEY_VERSION_MISMATCH` (responses entered against an older key); `MISSING_RESPONSES` (section absent or fewer answers than questions — unattempted must be entered explicitly as empty); `OUT_OF_RANGE` (answer not among options / not numeric, too many answers, unknown section); `DUPLICATE_ATTEMPT`; `NOT_ENROLLED`; `MISSING_ATTEMPT` (every enrolled student needs an attempt or an explicit absent).
6. **Steps** — sections → rules → key → duplicate count → per attempt (enrolment, then for submitted attempts key version and per-section responses) → enrolled students without attempts.
7. **Errors and edge cases** — absent attempts skip response checks; an empty enrolment list with no attempts passes the attempt checks.
8. **Permissions** — `academic:assessments:read` (own batches for teachers); finalising requires `academic:assessments:finalise`.
9. **Tests** — `scoring.test.ts` › "validateForFinalise": *passes a complete, consistent set*; *reports every problem: rule, missing responses, out-of-range, key mismatch, duplicate, not enrolled, missing attempt*; *requires an answer key that matches the sections*. Integration: `tests/integration` assessment finalise tests.
10. **Known limitations** — the database's unique (assessment, student) index already prevents stored duplicates; `DUPLICATE_ATTEMPT` matters for imports and direct domain use.

## A4. Aggregation, ranks and percentiles (`scoring.ts` › `aggregateResults`, `percentileRank`)
1. **Purpose** — produce per-student totals, ranks and percentiles within the batch, and section statistics.
2. **Inputs** — sections, resolved rules, key answers, attempts.
3. **Output** — `results[{ attemptId, studentId, absent, score, rank, percentile }]`, `scored`, `absent`, `sectionStats[{ sectionCode, mean, highest, lowest }]`.
4. **Preconditions** — validation passed.
5. **Rules** — absent students get no score, rank or percentile (absent ≠ 0). Rank = competition ranking (1, 2, 2, 4) = 1 + number of strictly higher totals. Percentile rank `P = (B + 0.5·E) / N × 100` with B = scores strictly below, E = scores equal (including the student), N = scored students; computed in integers and rounded half-up to 4 decimals; `null` when N < 2 (insufficient data). Section mean rounded half-up to a unit.
6. **Steps** — score each submitted attempt (A2) → collect totals → rank and percentile each → section stats over scored students.
7. **Errors and edge cases** — all absent → no stats (empty strings); ties share rank and percentile.
8. **Permissions** — `academic:assessments:finalise` to write; results readable with `assessments:read` (teachers: their students' rows).
9. **Tests** — `scoring.test.ts` › "aggregateResults and percentiles": *ranks with ties (1, 2, 2, 4), excludes absentees, computes percentile ranks*; *gives no percentile for a cohort of one (insufficient data)*; *rounds percentiles half-up to 4 decimals*.
10. **Known limitations** — percentiles are within one batch's attempts for one assessment; no cross-batch or normalised percentiles.

Finalisation (service `results.ts`): validation → `aggregateResults` → insert `result_runs` (version 1, status `final`, `rule_snapshot` = rule + sections + key version) and immutable `results` → assessment `finalised` → publish `academic.assessment.finalised` v1 → audit. **Re-score**: only when finalised; the current run becomes `superseded` (rows kept), a new run `version + 1` with a required reason is written from the current key, rule and responses, and the audit stores before/after totals.

## A5. Curriculum coverage (`coverage.ts` › `computeCoverage`)
1. **Purpose** — planned vs completed minutes/hours per chapter, subject and course (ACD-006, ACD-021).
2. **Inputs** — plan items `{ chapterId, plannedMinutes, plannedClasses, plannedDate }` of the batch's current plan; chapters; subjects; class records `{ chapterId, actualMinutes, state }` (activities `main` and `practice` only); `asOf` date or null.
3. **Output** — per chapter and per subject, and for the course: `plannedClasses`, `plannedMinutes`, `plannedHours`, `plannedToDateMinutes`, `verifiedMinutes`, `verifiedHours`, `unverifiedMinutes`, `completionPercent`, `varianceMinutes`; plus `unplanned[]` (records for chapters not in the plan).
4. **Preconditions** — the service picks the current plan: a locked/provisional batch-scoped plan first, else the course template (locked before provisional, then highest version).
5. **Rules** — completed = **verified** records only (BR-ACD-11); `submitted` minutes reported separately; `superseded` ignored. Planned-to-date = items dated ≤ asOf; null (unknown) when any contributing item is undated or no asOf. Completion % = verified ÷ planned × 100 (1 dp), null when nothing is planned. Variance = verified − planned-to-date, null when planned-to-date is unknown. The baseline is never changed by actuals.
6. **Steps** — group items and non-superseded records by chapter → chapter figures → subject figures over the subject's planned chapters → course figures over planned chapters → list unplanned chapters.
7. **Errors and edge cases** — no plan → everything planned is 0 and completion is null with a note; nothing delivered yet → 0 % (a measured zero, since the plan exists).
8. **Permissions** — `academic:batches:read` (teachers: assigned batches only).
9. **Tests** — `tests/unit/progress.test.ts` › "computeCoverage": *counts only verified minutes as completed; unverified separate; superseded ignored*; *nothing delivered yet is 0 % completed, not missing; undated plans give unknown planned-to-date*; *an empty plan has no completion percentage (missing, not zero)*.
10. **Known limitations** — combined lessons must be logged as one record per chapter with split minutes; manual forecast-remaining is not modelled.

## A6. Timetable conflict detection (`timetable.ts` › `checkTimetable`)
1. **Purpose** — report timetable conflicts without fixing them (ACD-012), separating hard constraints from preferences.
2. **Inputs** — sessions `{ id, batchId, teacherStaffId, roomId, date, startTime, durationMinutes, status, sessionType }`; dated exclusions; class length per batch `{ minutes, status }`; workload cap `{ maxMinutesPerDay, maxMinutesPerWeek, enforcement }` or null; optional `onlyInvolving` ids.
3. **Output** — `{ verdict feasible|infeasible, hard[], preferences[], checkedSessions, notes[] }`; each conflict `{ code, severity, sessionIds, date, message }`.
4. **Preconditions** — the service loads all scheduled/held sessions of **all batches** (teachers and rooms are shared) in the Monday–Sunday weeks touched.
5. **Rules** — only `scheduled`/`held` sessions count. Intervals are half-open `[start, end)`: **touching sessions do not overlap**. HARD: `TEACHER_OVERLAP`, `BATCH_OVERLAP`, `ROOM_OVERLAP` (null teacher/room never conflicts), `ON_EXCLUSION` (holiday / school_exam / other on that date, centre-wide or for the batch; `exam_blackout` does not block classes), `INVALID_TIME`, `CROSSES_MIDNIGHT`, `DURATION_MISMATCH` when the class length is `locked`/`approved`, `TEACHER_WORKLOAD` when the cap's enforcement is `hard`. PREFERENCE: `DURATION_MISMATCH` for provisional/proposed lengths, `CLASS_LENGTH_UNKNOWN`, `TEACHER_WORKLOAD` under a `warning` cap. Durations are checked for teaching and practice sessions only (BR-ACD-4). Workload: total minutes per teacher per day and per ISO week; exactly at the cap is allowed.
6. **Steps** — validate times → group by date, sort by start, compare pairs until starts pass the current end → exclusions → durations → workload → filter by `onlyInvolving` → split by severity.
7. **Errors and edge cases** — no cap configured → a note "workload was not checked"; cancelled/rescheduled sessions ignored; each pair is reported once per code.
8. **Permissions** — check: `academic:timetable:read` (teachers: conflicts on their own sessions); writes (`POST sessions`, reschedule) need `timetable:write` and are refused with 409 when a hard conflict involves the new sessions.
9. **Tests** — `tests/unit/timetable.test.ts` › "intervalsOverlap (half-open)": *treats touching intervals as not overlapping*; › "checkTimetable": *a clean timetable is feasible (never "optimal")*; *back-to-back sessions (touching) are not a conflict*; *detects teacher, batch and room overlaps separately*; *ignores cancelled and rescheduled sessions*; *flags sessions on holidays (centre-wide or batch-specific) but not on exam blackouts*; *duration mismatch is hard for a locked class length, a preference for a provisional one, and unknown lengths are reported*; *teacher workload is a preference by default and hard only when configured*; *weekly workload groups Monday–Sunday*; *rejects invalid times and sessions past midnight*; *onlyInvolving limits the report to candidate sessions*.
10. **Known limitations** — no teacher leave/availability (OD-026), no daily slot limit, no lesson-before-prerequisite check, no automatic generation from weekly rules.

## A7. Capacity feasibility (`capacity.ts` › `computeCapacity`)
1. **Purpose** — can the calendar hold the classes the plan needs? (ACD-010, BR-ACD-7)
2. **Inputs** — window `{ from, to }`; calendar rules `{ label, periodStart, periodEnd, weekdays (ISO 1–7), slotsPerDay, kind regular|extra }`; exclusions (dated `{ date, kind }` or undated allowances `{ periodStart, periodEnd, days, slotsPerDay, kind }`); required classes (null = unknown); optional planned classes per month.
3. **Output** — `{ verdict feasible|infeasible|not_assessed, teachingDays, regularSlots, extraSlots, grossSlots, excludedSlots, netSlots, requiredClasses, headroom, months[{ month, teachingDays, grossSlots, excludedSlots, netSlots, planned, overBy }], reasons[], errors[], caveat }`.
4. **Preconditions** — valid dates; the service uses the batch's rules and exclusions (excluding `exam_blackout`), the current plan's total planned classes, and the window from the query or the rules' span.
5. **Rules** — `gross = Σ teaching days × regular slots + extra slots`; a day is a teaching day only under exactly one regular rule; extra slots only on teaching days. Dated closure on a teaching day removes that day's slots once (two closures the same day deduct once); on a non-teaching day (e.g. a weekend) nothing is deducted — **no double counting**. An undated allowance removes `days × slotsPerDay`, reduced by dated closures of the same kind already entered in its period (dated closures **replace** the allowance, ACD-009). `net = gross − excluded`; `headroom = net − required`; feasible iff headroom ≥ 0; unknown required → `not_assessed`. Months where planned > net are reported ("relocation needed"). The caveat "capacity totals alone do not prove that a feasible dated schedule exists … not an optimal schedule" is always returned.
6. **Steps** — validate → expand every date of the window → apply dated closures → apply allowances → net, headroom, verdict, monthly flags.
7. **Errors and edge cases** — invalid window, weekdays outside 1–7, slots < 1, overlapping regular rules, extra slots without a regular rule → `errors[]` and verdict `not_assessed` (input problems are reported, not guessed around).
8. **Permissions** — `academic:timetable:read` (teachers: assigned batches).
9. **Tests** — `tests/unit/capacity.test.ts` › "computeCapacity — legacy Class 12 reproduction (BR-ACD-7)": *reproduces 157 days × 2 + 31 third classes = 345 gross*; *reproduces 345 − 28 = 317 net vs 305 required, headroom 12, feasible*; *monthly gross slots match the workbook (April 42 … September 61)*. The rules come from `class12-plan.json` planning controls (Mon–Fri × 2 from 1 Apr to 30 Jun 2027; Mon–Sat × 2 from 1 Jul to 15 Oct; a Tue/Thu third class from 1 Jul to 15 Oct) and the 28-slot allowance from its `exclusions` (April 1×2, June 1×2, August 1×3, September 5×3, 1–15 October 2×3), compared against the workbook cells B28, B29, B30, B35, B52. › "computeCapacity — rules": *a closure on a weekend is not deducted (no double counting)*; *a dated closure replaces the allowance it uses up (not added to it)*; *two closures on the same day deduct once*; *flags months over capacity (relocation needed)*; *rejects invalid and conflicting input instead of guessing*.
10. **Known limitations** — allowances are attributed to the month of their period start; public holidays are not known unless entered (OD-018); assessments are not placed into slots.

## A8. Assessment scheduling constraints (`assessment-schedule.ts` › `checkAssessmentSchedule`)
1. **Purpose** — check assessment dates against classes, other assessments, blackouts, prerequisites and a minimum gap (ACD-012, ACD-024, ACD-026).
2. **Inputs** — candidates `{ id, label, date, startTime?, durationMinutes?, discussionDate?, prerequisiteCompletion? }`; other assessments of the batch; the batch's classes; blackout windows `{ label, kind exam|mock_phase|closure|other, from, to, status }`; minimum gap `{ minDays, enforcement }` or null.
3. **Output** — `{ verdict feasible|infeasible, hard[], preferences[], conflictingCandidates[] }`; conflicts carry `code`, `severity`, `candidateId`, `otherId`, `date`, `unverified`, `message`.
4. **Preconditions** — the service builds blackouts from the batch's target exam date (status from `target_exam_date_status`, `unverified` when not set), `exam_blackout` exclusions (a date → exam; a period → mock-phase window) and dated holiday/school-exam closures; prerequisite completion = latest planned date of the assessment's chapters in the current plan.
5. **Rules** — HARD `CLASS_CLASH` / `ASSESSMENT_CLASH` when both clock times are known and overlap (touching is fine); PREFERENCE `SAME_DAY_TIME_UNKNOWN` when a time is missing on a shared day; HARD `BLACKOUT` when the test **or discussion** day is inside a window — with `unverified: true` when the window's status is `unverified` or `assumed`, so a provisional exam date stays flagged; HARD `BEFORE_PREREQUISITE` when the test date ≤ planned completion; `MIN_GAP` (hard or preference per config) when two assessments are fewer than `minDays` apart; HARD `INVALID_DATE`. Candidate pairs are compared once.
6. **Steps** — per candidate: date validity → clashes with classes → clashes with others/candidates → blackouts on test and discussion days → prerequisite → gap.
7. **Errors and edge cases** — no gap configured (default 0) → no gap check; several tests on one Saturday without clock times → warnings only.
8. **Permissions** — `academic:assessments:read` (teachers: assigned batches).
9. **Tests** — `tests/unit/assessment-schedule.test.ts` › "legacy known conflict: late weekend tests vs the provisional exam date and the mock phase" (all 70 chapter tests of `class12-plan.json`, mock phase 16 Oct–10 Nov 2027 `proposed`, IIMB date 14 Nov 2027 `unverified`): *detects the 12 tests listed in C12-CONFLICT-002 and no others*; *flags VT14-B (C12-CONFLICT-001): its discussion falls on the provisional exam date, marked unverified*; *no legacy test is scheduled before its prerequisites (all "After planned completion")*; *several tests on the same Saturday without clock times are warnings, not hard clashes*. › "checkAssessmentSchedule": *clashes with a class of the batch only when the times overlap (touching is fine)*; *clashes with another assessment and enforces a configurable minimum gap*; *rejects a test on or before its prerequisites' planned completion*; *a verified blackout is not flagged unverified; invalid dates are reported*.
10. **Known limitations** — no weekend minutes cap (210, OD-017), no Paper A/B weekend rule, no automatic placement or spill-over list.

## A9. Attendance summary (`progress.ts` › `summariseAttendance`)
1. **Purpose** — attendance rate that never turns missing data into 0 % (ACD-014).
2. **Inputs** — ids of HELD sessions; recorded marks `{ sessionId, status }`.
3. **Output** — `{ heldSessions, recorded, notRecorded, present, late, partial, absent, excused, ratePercent }`.
4. **Preconditions** — the caller passes only sessions the student was expected at (from the enrolment start).
5. **Rules** — `rate = (present + late + partial) ÷ (recorded − excused) × 100`, 1 dp; sessions without a mark are `notRecorded` and excluded; `null` when the denominator is 0 (nothing countable recorded).
6. **Steps** — keep marks of held sessions → count by status → rate.
7. **Errors and edge cases** — all excused → null; all absent → 0 % (a measured zero).
8. **Permissions** — `academic:progress:read` / `attendance:read` (teachers: own).
9. **Tests** — `progress.test.ts` › "summariseAttendance": *excludes unrecorded sessions and excused absences from the rate*; *returns a missing rate (null), never 0 %, when nothing is recorded*.
10. **Known limitations** — partial counts as attended; the ≥ 45/60 online rule (OD-022) is not applied automatically.

## A10. Missed classes (`progress.ts` › `findMissedClasses`)
1. **Purpose** — list classes a student missed, for catch-up (ACD-020).
2. **Inputs** — enrolment start date (nullable); held sessions of the batch `{ id, date, chapterId }`; the student's marks.
3. **Output** — `{ missed[{ sessionId, date, chapterId, reason late_joiner|absent|excused }], unrecorded }`.
4. **Preconditions** — sessions are `held`.
5. **Rules** — before the enrolment start → `late_joiner`; marked absent/excused → that reason; no mark → counted in `unrecorded`, not missed.
6. **Steps** — sort by date then id → classify.
7. **Errors and edge cases** — null start date → no late-joiner sessions.
8. **Permissions** — `academic:progress:read` (own) / `progress:write` to generate tasks (`generateCatchupTasks`, idempotent per enrolment + session).
9. **Tests** — `progress.test.ts` › "findMissedClasses": *lists late-joiner and absent/excused sessions; unrecorded are not missed*.
10. **Known limitations** — the session's planned chapter is used; what was actually taught is in class records.

## A11. Assessment trend (`progress.ts` › `assessmentTrend`)
1. **Purpose** — is a student improving, declining or flat, with an explicit "insufficient data" answer.
2. **Inputs** — points `{ date, percent }` (score ÷ max × 100 of final results; absent excluded); options `lastN` (5), `minPoints` (3), `flatThreshold` (1 pp) from setting `progress.trend`.
3. **Output** — `{ status: 'insufficient_data', reason, pointsUsed }` or `{ status: 'ok', slope, direction improving|declining|flat, pointsUsed, mean }`.
4. **Preconditions** — none.
5. **Rules** — keep percentages in [0, 100]; sort by date; take the last N; fewer than `minPoints` → insufficient data, never a trend; ordinary least squares with x = 0…n−1 (each assessment is one step; calendar gaps ignored): `slope = Σ(x−x̄)(y−ȳ) / Σ(x−x̄)²`, rounded to 2 dp; |slope| < threshold → flat.
6. **Steps** — filter → sort → window → regression → classify.
7. **Errors and edge cases** — zero x-spread → insufficient data; out-of-range points ignored.
8. **Permissions** — `academic:progress:read` (own).
9. **Tests** — `progress.test.ts` › "assessmentTrend (least squares)": *returns insufficient data below the minimum, never a trend*; *computes the slope over the last N results in date order*; *uses only the last N points and calls small slopes flat*; *detects a decline and ignores out-of-range values*.
10. **Known limitations** — mixes assessment kinds and difficulty; percentages are of each paper's own maximum.

## A12. Catch-up prioritisation (`catchup.ts` › `prioritiseCatchup`)
1. **Purpose** — a deterministic, explainable order for catch-up work.
2. **Inputs** — tasks `{ id, studentId, sessionDate, chapterId, chapterWeight, status }`; upcoming assessments `{ id, label, date, chapterIds }` (scheduled from today to the horizon); `asOf`; weights (setting `catchup.weights`, proposed default recency 2, chapter 1, assessment 3, horizon 14 days).
3. **Output** — `[{ taskId, studentId, score, rank, factors { daysSinceMissed, recencyPoints, chapterWeight, upcomingAssessment, assessmentPoints }, explanation }]`.
4. **Preconditions** — only `open` / `in_progress` tasks are ranked.
5. **Rules** — `score = wRecency × recency + wChapter × chapterWeight + wAssessment × urgency`; recency 3 (≤ 7 days ago), 2 (≤ 21), 1 (≤ 60), else 0; chapter weight 1–10 (1 when unknown); urgency for the nearest assessment covering the chapter: 3 (≤ 3 days), 2 (≤ 7), 1 (≤ horizon), else 0; past or beyond-horizon assessments ignored. Ties: earlier missed date, then task id.
6. **Steps** — filter → compute factors → score → sort → rank → explanation text.
7. **Errors and edge cases** — no chapter → no assessment urgency.
8. **Permissions** — list: `academic:progress:read` (own batches); generate/update: `academic:progress:write`.
9. **Tests** — `progress.test.ts` › "prioritiseCatchup": *is deterministic and explains every factor*; *breaks ties by earlier missed date then id; ignores assessments outside the horizon or in the past*.
10. **Known limitations** — weights are proposed, not owner-approved; no capacity for catch-up sessions.

## A13. Enrolment intake decision (`intake.ts` › `decideIntake`)
1. **Purpose** — confirm or reject one `ops.admission.enrolment_requested` v1 request (ACD-019).
2. **Inputs** — the request (programme code, intended course/batch, start date, student DOB/stage, guardian contacts); references looked up by the consumer (programme, course, batch with active enrolment count, duplicate flag); today (IST).
3. **Output** — `{ decision: 'confirm', programmeId, courseId, batchId, startDate, lateJoiner }` or `{ decision: 'reject', reasonCode, reason }`.
4. **Preconditions** — payload already validated against the contract by the outbox.
5. **Rules** (first match wins) — 1 `PROGRAMME_NOT_OFFERED` (unknown, paused or retired; active and planned are accepted); 2 `COURSE_NOT_FOUND` (unknown or another programme); 3 `BATCH_NOT_FOUND` (unknown, another programme or course, completed or cancelled); 4 `INVALID_REQUEST` (minor — under 18 by DOB, or a school stage class 9–12 without DOB — and no guardian email/phone, PLT-014); 5 `DUPLICATE_ENROLMENT` (active enrolment of the same student in the batch); 6 `BATCH_FULL` (capacity reached). Confirm: batch optional (enrolment waits for allocation); start = requested date, else the batch start if in the future, else today; late joiner when start > batch start.
6. **Steps** — the checks above in order.
7. **Errors and edge cases** — 18th birthday counts as adult.
8. **Permissions** — runs as the system inside the consumer; triggering it needs `academic:enrolments:decide`.
9. **Tests** — `tests/unit/intake-plans.test.ts` › "decideIntake": *confirms a valid request and flags a late joiner*; *confirms without a batch (enrolment waits for allocation)*; *rejects: …* (10 cases: unknown/paused programme, unknown/foreign course, unknown/foreign/completed batch, minor without guardian, duplicate, full); *a minor with a guardian contact is accepted*; *computes age at the boundary (18th birthday)*. Integration (consumer): duplicate delivery → one student and one enrolment; invalid batch → rejected event.
10. **Known limitations** — no coordinator review step before an automatic decision; `OTHER` is never produced.

## A14. Plan status rules and supersession (`plans.ts`)
1. **Purpose** — keep baselines immutable and changes traceable (ACD-004, PLT-007).
2. **Inputs** — plan statuses; successor/predecessor `{ id, courseId, batchId, status }`.
3. **Output** — booleans (`canTransitionPlan`, `canEditPlanItems`, `canRequestApproval`) and `supersessionProblem` (message or null); `plannedHours(minutes)`.
4. **Preconditions** — none.
5. **Rules** — transitions: proposed → provisional | locked | superseded; provisional → locked | superseded; locked → superseded; superseded is final. Items editable only when proposed. A successor must have the same course and batch scope and the predecessor must be locked or provisional; a plan cannot supersede itself. Status changes go through a core approval decided by another `academic:curriculum:approve` holder (no self-approval); on approval the predecessor becomes superseded in the same transaction.
6. **Steps** — table lookup / comparisons.
7. **Errors and edge cases** — a predecessor superseded meanwhile → 409 at decision time.
8. **Permissions** — create/request: `academic:courses:write`; decide: `academic:curriculum:approve`.
9. **Tests** — `intake-plans.test.ts` › "plan status rules": *allows only forward transitions; locked plans can only be superseded*; *supersession needs the same course and batch scope and a current predecessor*. Integration: plan approval tests.
10. **Known limitations** — no `draft` state distinct from `proposed`; withdrawing a proposal is not exposed as a route.

## A15. Responses CSV parsing (`responses-csv.ts` › `parseResponsesCsv`)
1. **Purpose** — import pasted responses safely.
2. **Inputs** — text `student_code,key_version,section_code,answers` (header optional, `#` comments), answers separated by `|`, empty = unattempted; section `ABSENT` marks an absent student.
3. **Output** — `{ attempts[{ studentCode, status, keyVersion, responses }], problems[{ line, message }] }`.
4. **Preconditions** — none.
5. **Rules** — rows grouped by student; a student cannot be both absent and answering; one key version per student; a section twice = duplicate; key version must be a positive integer or empty.
6. **Steps** — split lines → parse cells → validate → group.
7. **Errors and edge cases** — any problem rejects the whole import in the service (nothing saved); unknown student codes are rejected by the service.
8. **Permissions** — `academic:assessments:write`.
9. **Tests** — `intake-plans.test.ts` › "parseResponsesCsv": *groups rows by student, supports ABSENT and empty (unattempted) answers*; *reports duplicates, conflicting versions and malformed lines with line numbers*.
10. **Known limitations** — no quoted fields; answers cannot contain `,` or `|`.

## A16. Settings resolution (`settings.ts` › `readSetting`)
1. **Purpose** — configurable rules with honest status.
2. **Inputs** — setting key and stored jsonb value.
3. **Output** — the parsed value, or the **proposed** default when absent or invalid.
4. **Preconditions** — key is one of `timetable.teacher_workload_cap`, `assessments.min_gap_days`, `catchup.weights`, `progress.trend`.
5. **Rules** — zod schema per key; writes validate the same schema and record `proposed`/`approved` and the actor.
6. **Steps** — safeParse → value or default.
7. **Errors and edge cases** — invalid stored value falls back silently to the default (writes cannot store invalid values).
8. **Permissions** — read `academic:courses:read`; change `academic:settings:manage`.
9. **Tests** — `intake-plans.test.ts` › "settings": *falls back to the proposed default for missing or invalid values*.
10. **Known limitations** — settings are global, not per batch.
