# Business Ops OS: demo students workspace (part for merging)

> **Renamed on 21 Oct 2026 by migration `0005_clear_names` (D-036):** this note describes the 20 Oct build. `ops.counselling_sessions` is now `ops.appointments` (`starts_at`, `staff_id`; `attendees` dropped), the legacy demo columns `subjects`/`day_dates`/`status`/`is_sample` and `ops.demo_teachers` are gone, `student_identity_id` is `student_id`, `admissions.student_id` is `academic_student_id`, `guardian_ref` is `guardian_id`, `staff_ref` is `staff_code`. Current columns: [../DATA_DICTIONARY.md](../DATA_DICTIONARY.md).

> **Merged on 21 Oct 2026.** Kept as a detailed appendix. Final ids: OPS-080 … OPS-088; rules D-1 … D-8 are now A-57 … A-64. Canonical docs: `../../README.md`, `../../requirements/REQUIREMENTS.md`, `../DATA_MODEL.md`, `../WORKFLOWS.md`, `../API.md`, `../PERMISSIONS.md`, `../ALGORITHMS.md`, `../TEST_PLAN.md`, `../INTEGRATION_REQUESTS.md`. The migration it asks for exists: `packages/database/migrations/0003_admissions_workspace.sql`. Where this file and the canonical docs differ, the canonical docs win.

Owner brief of 20 Oct 2026, chunks 1 and 2 (§4, §4.1 to §4.3, §5, §5.1, the checklist part of §6, §17, §19). Built by build agent A on branch `feature/business-ops-hr-admissions`. The coordinator merges this file into `README.md`, `requirements/REQUIREMENTS.md`, `docs/{DATA_MODEL,API,API_SPECIFICATION,ALGORITHMS,WORKFLOWS,PERMISSIONS,TEST_PLAN}.md` and records the D-entry for the session-count decision. Status words follow D-013; nothing is Deployed. Requirement IDs below are provisional (`ADM-DEMO-xx`); renumber on merge.

## 1. Requirements

| ID | Title | Status | Evidence |
|---|---|---|---|
| ADM-DEMO-01 | Demo with N sessions; N = setting `admissions.demo.session_count` (default 3, proposed, editable, audited) snapshotted on the demo | **Tested** | integration `demos.test.ts` → "401 / 403 / 400 / 201 with N = 3 sessions…"; unit `demos.test.ts` → "demo settings" |
| ADM-DEMO-02 | Per-session attendance `scheduled/present/absent/rescheduled/cancelled/not_recorded`; progress = present / N | **Tested** | unit "D-1 progress"; integration "records, refuses before start…" |
| ADM-DEMO-03 | Corrections keep previous value, new value, actor, reason (`ops.demo_session_changes`) | **Tested** | integration "…corrections need a reason and keep history" |
| ADM-DEMO-04 | Current / Upcoming / Previous at IST calendar boundaries; list filters, pagination, counts from the same query | **Tested** (API, domain) · **Implemented** (screen) | unit "D-2 view at IST calendar boundaries"; integration "list views (GET /demos)" |
| ADM-DEMO-05 | Reschedule / cancel a session with a reason; mock status per session; teacher/subject per session | **Tested** (reschedule, cancel) · **Implemented** (mock, assign) | integration "reschedule needs a reason…" |
| ADM-DEMO-06 | Demo checklist: append-only entries, latest wins, waived needs reason (DB CHECK too), derived items read-only; "required before conversion" = proposed setting, off | **Tested** | unit "D-7 checklist"; integration "checklist: waiver needs a reason…" |
| ADM-DEMO-07 | Manual outcome `declined/withdrawn/not_converted/cancelled` with a reason; `converted` only through Convert to admission | **Tested** | integration "outcome needs a reason, cannot be converted by hand…" |
| ADM-DEMO-08 | `/ops/admissions` landing: KPI tiles that set filters, filters, tabs with counts, table per §5, drawer `?open=<id>`, booking drawer `?new=1`; full record `/ops/admissions/demos/<id>` | **Implemented** (not browser-checked, see §8) | typecheck + lint clean |
| ADM-DEMO-09 | Fixtures: Tanisha + all-attended, one absence, reschedule, not converted, declined, withdrawn (SAMPLE DATA) | **Tested** | integration "creates Tanisha as described…" |

## 2. Data model

Tables (schema `ops`; `packages/database/src/schema/ops-demos.ts`, plus the `opsDemos` columns in `ops.ts`):

- `ops.demos` (extended): `programme_id` (FK core), `counsellor_staff_id` (FK core), `planned_session_count` (1–10, not null, snapshot of the setting), `outcome` (`open|converted|declined|withdrawn|not_converted|cancelled`, default `open`), `outcome_reason`, `outcome_at`, `outcome_by`, `converted_admission_id` (FK `ops.admissions`, set with `converted` only), `is_sample`. CHECKs: outcome vocabulary; `outcome='open'` ⇔ `outcome_at IS NULL`; manual outcomes need a reason; `converted` ⇔ `converted_admission_id` set. Partial unique index `demos_one_open_per_admission` (one open demo per case).
- Legacy columns kept and maintained by the demos service for older readers (admission page, student profile, schedule, KPI report): `subjects` (distinct session subjects), `day_dates` (distinct IST session dates), `status` (`legacyDemoStatus`). `ops.demo_teachers` is no longer written; teachers live on sessions.
- `ops.demo_sessions`: demo FK, `session_number` (unique per demo, 1–10), `starts_at`, `ends_at` (null only for migrated legacy rows; CHECK end > start), `timezone` default `Asia/Kolkata`, `programme_id`, `subject`, `teacher_staff_id` (FK core.staff_members), `attendance` + CHECK, `recorded_at/by` (required for present/absent), `notes`, `mock_status` (`not_required|pending|prepared|scheduled|completed`), `mock_attempt_ref` (plain reference, no cross-module FK), `exception_reason`, `teacher_notified_at`, `updated_by/at`.
- `ops.demo_session_changes` (append-only): session FK, `field` (`attendance|schedule|mock|teacher`), `previous_value`, `new_value`, `reason`, `actor_user_id`, `at`. Every tracked change writes a row (first recording too); a reason is required for corrections.
- `ops.checklist_entries` (append-only, shared with admissions): `subject_type` (`demo|admission`), `subject_id`, `item_key` (format CHECK), `status` (`complete|pending|waived|not_applicable`), `reason` (CHECK: required when waived), `actor_user_id`, `at`.

### Migration notes for the coordinator (no `drizzle-kit generate` was run)
1. Add the new `ops.demos` columns; add `planned_session_count` with a temporary default, backfill `cardinality(day_dates)`, then drop the default.
2. Backfill outcome from the legacy status: `cancelled` and `missed` → `outcome='cancelled'`, `outcome_at = updated_at`, `outcome_reason = 'Legacy demo-level status: <status>'`; others stay `open`. This must run before creating `demos_one_open_per_admission` (older data may hold a missed and a rebooked demo for one case).
3. Generate sessions for legacy rows (choice: **migration backfill**, not generated at read): one row per `day_dates` element ordered by date, `starts_at = date 00:00 Asia/Kolkata`, `ends_at = NULL`, `exception_reason = 'Legacy demo: day recorded without a time'`, `subject = subjects[1]` when there is one subject, else NULL; attendance from the demo status (`attended→present` with `recorded_at = completed_at`, `recorded_by = created_by`; `missed→absent` likewise; `cancelled→cancelled`; `scheduled→scheduled`); teacher from `demo_teachers` when exactly one teacher, else NULL.
4. `ops.demo_teachers` can be dropped after step 3.

## 3. Settings
- `admissions.demo.session_count` `{ count: 1–10 }`, default **3**, state `proposed`, editable through `PUT /ops/api/v1/settings/admissions.demo.session_count` (`ops:settings:manage`, audited `setting.changed`). Source text: "owner brief 2026-10-20 … supersedes the legacy 2-day demo of LEGACY-OPSWB-D-003/D-004". The `days` field was removed from `demo.terms` (the rest of `demo.terms` is unchanged). **Coordinator: record the D-entry.**
- `admissions.demo.checklist_required` `{ requiredBeforeConversion: boolean }`, default `false`, `proposed`. Read by the demo record (Convert link disabled with a reason when on and the checklist is unresolved); conversion (agent B) should enforce it server-side.
- `demo.limits` (open, OD-012) is still enforced only when set (subject cap, consecutive days).

## 4. Rules (10-point format, for ALGORITHMS.md)

### D-1 Demo progress
1. Purpose: show "2 of 3 classes attended". 2. Inputs: sessions' attendance, `planned_session_count`. 3. Output: `{ attended, planned, label }`. 4. Preconditions: none. 5. Rules: only `present` counts; scheduled, rescheduled, cancelled, absent, not recorded never count; the denominator is the planned count, not the number of rows. 6. Steps: count present. 7. Edge cases: legacy demo with fewer rows still shows "x of planned". 8. Permissions: read with `ops:leads:read`. 9. Tests: unit "D-1 progress counts only present"; integration "only present counts". 10. Limitations: none.

### D-2 Demo view (Current / Upcoming / Previous)
1. Purpose: put each demo in one tab. 2. Inputs: outcome, sessions, now. 3. Output: `current|upcoming|previous`. 4. Preconditions: none. 5. Rules: outcome not `open` → Previous; else Current from 00:00 IST on the calendar day of the earliest non-cancelled session; before that, or with no live session, Upcoming. 6. Steps: `istToday(first start) <= istToday(now)`. 7. Edge cases: 23:59:59 IST the day before → Upcoming, 00:00:00 IST → Current (tested at 18:29:59Z / 18:30:00Z); a cancelled first session is ignored. 8. Permissions: list/detail read. 9. Tests: unit "D-2 view at IST calendar boundaries"; integration "list views". 10. Limitations: classification is computed in the service after one SQL query (fine for hundreds of demos; move to SQL if volumes grow).

### D-3 Next class
1. Purpose: "Next class" column and "attendance to record" hint. 2. Inputs: sessions, now. 3. Output: `{ next, awaitingRecord }`. 4–5. Rules: next = earliest scheduled/rescheduled session starting at or after now; awaitingRecord = scheduled/rescheduled sessions already started. 6–8. Pure; read permission. 9. Tests: unit "D-3 next class". 10. —

### D-4 Attendance changes
1. Purpose: legal attendance updates with history. 2. Inputs: session (attendance, start), new value (`present|absent|not_recorded|scheduled`), reason, now. 3. Output: ok + `correction`, or a message. 4. Preconditions: `ops:leads:write`, own scope. 5. Rules: same value refused; cancelled sessions must be rescheduled first; present/absent/not recorded only once the session has started; changing a recorded value (present/absent/not recorded) is a correction and needs a reason; back to `scheduled` only as a correction. 6. Steps: lock demo + case, validate, update, write a `demo_session_changes` row per changed field, recompute the legacy summary, audit `demo_session.attendance`. When an open demo has no pending session and at least one present, the case moves `demo_scheduled → demo_attended` and the demo follow-up is created (A-05), as the retired demo-level "attended" action did. 7. Edge cases: corrections stay allowed after the demo is closed (records can be fixed); reschedule/cancel/assign do not. 8. Permissions: `ops:leads:write` (counsellor own). 9. Tests: unit "D-4 attendance changes"; integration "records, refuses before start…". 10. Limitations: no teacher self-service yet (teachers hold no Ops permission).

### D-5 Reschedule and cancel
1–3. Reschedule moves the session (attendance `rescheduled`, keeps the class length unless an end is given) and cancel sets `cancelled`; both store the reason in `exception_reason` and the change table. 5. Rules: reason always required; an attended session cannot be rescheduled; only scheduled/rescheduled sessions can be cancelled; a cancelled or absent session can be rescheduled (make-up class). 7. Not allowed on closed demos (409). 9. Tests: unit "D-5/D-6"; integration "reschedule needs a reason…".

### D-6 Outcome
1. Purpose: close a demo without converting. 2. Inputs: outcome (`declined|withdrawn|not_converted|cancelled`), reason. 5. Rules: only from `open`; reason required (also a DB CHECK); `converted` is never accepted here. 6. Steps: future pending sessions → `cancelled`, past unrecorded ones → `not_recorded` (with change rows); set outcome fields; if the case is still `demo_scheduled` and the outcome is `cancelled` or `not_converted`, the case returns to `counselled` so a new demo can be booked; declined/withdrawn leave the pipeline to staff (closing a case as lost needs its closure code). Audit `demo.outcome_set`. 9. Tests: integration "outcome needs a reason…". 10. Limitations: no reopen.

### D-7 Checklist
1. Purpose: the fee and admission checklist of §6. 2. Inputs: append-only entries, sessions. 3. Output: 11 items with status, latest entry, `done of total`. 5. Rules: latest entry per item wins (ties: later row); no entry = pending; waived needs a reason; three items are derived from sessions and read-only (`sessions_recorded`: all sessions recorded; `mock_prepared`: furthest mock stage past pending, not applicable when no mock is planned; `mock_result_linked`: a session holds a result reference); done = anything but pending. A fee discussion is never evidence of payment. 8. Permissions: write `ops:leads:write`. 9. Tests: unit "D-7 checklist"; integration "checklist…". 10. Enforcement before conversion is the proposed setting above, off by default.

### D-8 Follow-up urgency and setup gaps
1. Purpose: Follow-up column, "Follow-ups due" tile, Upcoming "Still to arrange". 5. Rules: the case's earliest open follow-up with the A-06 due state (overdue from 00:00 IST the next day); gaps: sessions not scheduled vs planned, sessions without a teacher, no counsellor. 9. Tests: unit "summaries". 10. Follow-ups belong to the admission case (no demo-level follow-ups).

KPI tiles (from the same filtered rows as the list, ignoring the view and follow-up filters): current, upcoming, follow-ups due (due today or overdue), conversions this IST calendar month (tile opens all converted demos), admissions pending decision (demo students whose case is `admission_pending`).

## 5. API (all JSON, `defineRoute`, 401 → 403 → 400 → handler)
| Method + path | Permission | Body / query | Result |
|---|---|---|---|
| `GET /ops/api/v1/demos` | `ops:leads:read` (own) | `view`, `q`, `programme`, `counsellor`, `outcome`, `stage`, `from`, `to` (IST dates of any session), `followUp=due|overdue`, `page` (25 per page) | `{ view, counts, kpis, month, total, page, pageSize, rows }` |
| `POST /ops/api/v1/demos` | `ops:leads:write` (own) | `{ admissionId, sessions[N]: { startsAt, endsAt?, subject, teacherStaffId? }, durationMinutes=60, programmeCode?, counsellorStaffId?, notes? }` | 201 demo + sessions; 409 when the case has an open demo |
| `GET /ops/api/v1/demos/[id]` | `ops:leads:read` (own) | — | record: sessions, changes, checklist (+history), follow-ups, counselling, activity (audit rows) |
| `POST /ops/api/v1/demos/[id]` | `ops:leads:write` (own) | `{ action: 'record_fee', … }` or `{ action: 'outcome', outcome, reason }` | demo |
| `POST /ops/api/v1/demos/[id]/sessions/[sessionId]` | `ops:leads:write` (own) | `attendance` / `reschedule` / `cancel` / `mock` / `assign` | session |
| `POST /ops/api/v1/demos/[id]/checklist` | `ops:leads:write` (own) | `{ itemKey, status, reason? }` | 201 entry |

Retired: the old `POST /demos` body (`subjects`, `dayDates`, `teacherStaffIds`) and the demo-level `attended|missed|cancel` actions.

## 6. Permissions
No new keys: demos stay under `ops:leads:read` / `ops:leads:write` (their descriptions already cover demos), `own` scope for counsellors = demo counsellor, case counsellor or lead owner. The Convert link checks agent B's `ops:admissions:convert`.

## 7. Screens
- `/ops/admissions` (gate `ops:leads:read`): PageHeader "Admissions" + "Book a demo" (write only), `AdmissionsNav current="demos"`, five KPI links (`aria-current` when active), GET filter form (keeps the tab), shared-ui `Tabs` with counts, `DataTable` columns per view (§5 of the brief), `Pager`, empty states per view, filter-specific empty state. Row link → `?open=<id>` → `Drawer` with the record; `?new=1` → booking drawer.
- `/ops/admissions/demos/[id]`: the same record sections as a page.
- Record sections: Overview (status, progress, next class, outcome, demo fee note, Convert to admission link or the reason it is unavailable, close-demo form), Demo attendance (marks, table, per-session forms in `<details>`, change history), Mock test, Fee and admission checklist, Student and guardian feedback, Teachers and subjects, Counselling and follow-ups, Activity. Sample records show the shared-ui "Sample data" badge.
- The old pipeline board that lived at `/ops/admissions` is gone from this route; `/ops/admissions/[id]` (agent B) is unchanged.

## 8. Checks run (real output, 20 Oct 2026)
- `npx vitest run apps/business-ops-os/tests/unit/demos apps/business-ops-os/tests/integration/demos` → 2 files, 61 tests passed.
- `npx tsc --noEmit -p apps/business-ops-os` → no errors in the files listed in this part (other agents' files had errors mid-build).
- `npx eslint <demo files> --max-warnings=0` → clean.
- Not run: `npm run build`, browser checks at 360/768/1280 px, keyboard path, axe (dev servers were out of scope for this agent). These remain open before "done".

## 9. Open items
- Owner: confirm session count 3 (recorded here as proposed), and whether the checklist must be complete before conversion.
- Coordinator: migration (§2), D-entry, nav entry "Demo students" (the frame NAV item for `/ops/admissions` still gates on `ops:admissions:read`; the page gates on `ops:leads:read`), a home for the pipeline board if still wanted, `npm run docs:permissions` not needed (no key change).
- Agent B: set `outcome='converted'`, `outcome_at/by`, `converted_admission_id` in the conversion transaction (the CHECK requires all together) and enforce `admissions.demo.checklist_required`; add the converted fixture; the "Book demo" form and "Mark attended" button on `/ops/admissions/[id]` still post the retired body.
- `tests/integration/seeds.test.ts` lead count updated to 13 for the demo fixtures; the conversion fixture will change it again.
