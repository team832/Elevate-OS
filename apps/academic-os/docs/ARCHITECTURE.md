# Academic OS — architecture

## 1. Layers
```
 browser ──▶ src/app (pages: server components in AppShell; route handlers: defineRoute)
                │  permission check (401/403) → zod validation (400) → service call
                ▼
            src/server
              context.ts      Actor, resolveScope (all | own), assert*InScope, audit(), todayIst()
              schemas.ts      zod request schemas (shared by routes and services)
              route-helpers   actorOf(ctx)
              services/*.ts   transactions, repositories (Drizzle), audit, events, notifications
                │  calls pure functions
                ▼
            src/domain        pure, deterministic algorithms (no DB, no Next, no Node I/O — enforced by ESLint)
                ▼
            packages/database academic.* tables (+ FKs into core only)
```

| Layer | Files | May import |
|---|---|---|
| Domain | `src/domain/*.ts` | `@elevate/shared-types`, `@elevate/shared-contracts` (types/constants), `zod` |
| Server | `src/server/**` | domain, `@elevate/database`, `@elevate/server-kit`, `@elevate/authorization`, `@elevate/authentication` (types), `@elevate/notifications`, `@elevate/shared-contracts` |
| App | `src/app/**` | server, domain, `@elevate/shared-ui`, `@elevate/server-kit/next` |
| UI | `src/ui/**` | `@elevate/shared-ui`, React |
| Seed | `seed/index.ts` | `@elevate/database`, domain, `data/legacy/academic/*.json` |

No file imports another module app (ESLint D-023). The package exports `./domain`, `./server`, `./seed` for the platform and wave-3 integration tests only.

## 2. Services
| Service | Responsibility |
|---|---|
| `curriculum.ts` | programmes (read), courses, subjects, chapters (retire/alias), plans, plan items, approval policy `academic.curriculum_plan.status_change`, `currentPlanForBatch`, coverage, concept books |
| `batches.ts` | batches, class length resolution (`classLengthOf`), assignments, staff list (read of `core.staff_members`), rooms, exclusions, calendar rules, capacity feasibility |
| `timetable.ts` | sessions; conflict context (all batches in the Monday–Sunday weeks touched); create (409 on hard conflicts), cancel, reschedule; teacher notifications |
| `teaching.ts` | class records (record, verify, correct), attendance (roster, record/correct) |
| `assessments.ts` | assessments, scoring configuration, answer keys, attempts (CSV/JSON import) |
| `results.ts` | validation, finalisation, re-scoring, results, assessment scheduling check |
| `students.ts` | students (contact minimisation), manual enrolment, enrolment list |
| `progress.ts` | student progress, catch-up tasks (generate/prioritise/update), interventions |
| `intake.ts` | the `academic.enrolment-intake` consumer and the intake queue |
| `summary.ts` | `AcademicDeliverySummaryV1` |
| `settings.ts` | configurable rules |

## 3. Writes: transaction, audit, events, notifications
Every state change follows the same pattern:
```
withTransaction(db, async (tx) => {
  read + lock the row(s) (SELECT … FOR UPDATE where a state machine is involved)
  check state transition / references   → InvalidStateTransitionError / ValidationError / NotFoundError / ConflictError
  write rows
  recordAudit(tx, { module: 'academic', action, entityType, entityId, before, after, requestId })
  publishEvent(tx, …) / notify(tx, …)   when other modules or people must react
})
```
- Audited actions include `course.created`, `chapter.retired|moved`, `curriculum_plan.created|items_added|approval_requested|approval_rejected|locked|provisional|superseded`, `batch.created|updated`, `assignment.created`, `class_session.scheduled|cancelled|rescheduled|held`, `class_record.submitted|verified|corrected`, `attendance.recorded|corrected`, `assessment.created|scoring_configured|finalised|rescored`, `answer_key.added`, `attempts.entered|replaced`, `student.created`, `enrolment.created`, `enrolment_request.rejected`, `catchup.generated|updated`, `intervention.created|updated`, `setting.updated`, plus `approval.requested|decided` from server-kit.
- History is never deleted: superseded plans, superseded class records, superseded result runs and rescheduled sessions keep their rows.
- PostgreSQL unique violations (e.g. a duplicate active enrolment, duplicate codes) become 409 through `defineRoute`.

## 4. Scope resolution (teacher `own`)
`resolveScope(db, actor, permission)`:
1. `scopeFor(user, permission)` → `null` (403), `all`, or `own`.
2. For `own`: `staffIdForUser` (core.staff_members by user_id) and `assignedBatchIds` (active teacher assignments).
3. Services filter queries: sessions by `teacher_staff_id`, batches/assessments by batch ids, students by active enrolment in those batches (`studentIdsInScope`).
4. Single-record reads and writes call `assertSessionInScope` / `assertBatchInScope` / `assertStudentInScope`, which throw **404** so existence is not leaked.

## 5. Enrolment intake flow
```
 Business Ops (one tx)                               Academic OS (one tx per event)
 ─────────────────────                               ───────────────────────────────
 admission → enrolment_requested
 publishEvent(ops.admission.enrolment_requested v1) ─┐
                                                     │  POST /academic/api/v1/enrolment-intake/run
                                                     │  (or runEnrolmentIntake(db) — no scheduler yet)
                                                     ▼
                                processEvents(consumer 'academic.enrolment-intake')
                                  claim core.event_deliveries (unique event+consumer)
                                  intake log exists? → no-op
                                  load programme / course / batch (FOR UPDATE) / student by source_admission_id
                                  decideIntake()  ─── reject ──▶ publish academic.enrolment.rejected v1
                                        │                         intake log + audit
                                        └─ confirm ─▶ reuse/create student, create enrolment,
                                                      publish academic.enrolment.confirmed v1,
                                                      intake log + audit
 ops.enrolment-replies consumer ◀── reply events (key enrolment-reply:<requestEventId>, correlation = request id)
 (Business Ops team; IR-ACD-06)
```
A thrown error rolls the whole event back (including the delivery claim) and records `failed`; after 5 attempts the delivery is `dead` and appears on the intake screen.

## 6. Reads that cross into core
Read-only: `core.programmes` (catalogue), `core.staff_members` (teachers, responsible staff), `core.approvals` (plan approval history via `listApprovalHistory`), `core.integration_events` / `core.event_deliveries` (intake queue). Writes to core happen only through server-kit (`requestApproval`, `decideApproval`, `recordAudit`, `publishEvent`, `processEvents`) and `notify`.

## 7. Summary endpoint
`GET /academic/api/internal/v1/summary` (`defineInternalRoute`, callers `ops`, `platform`) → `buildAcademicDeliverySummary(db, window)`:
- overall metrics and one entry per programme (active, planned or paused);
- every metric is `ok` or `missing` with a reason (e.g. no timetable entered, no attendance recorded, no current plan, risk rules not implemented);
- the output is parsed with `academicDeliverySummaryV1Schema` before returning; planned vs delivered hours are added in a separate `extensions` object that is not part of the contract (IR-ACD-03).

## 8. Time
Calendar dates are `YYYY-MM-DD` Asia/Kolkata (`todayIst()`); clock times `HH:MM` local; timestamps UTC `timestamptz`; weeks run Monday–Sunday (`weekStart`). "Today" is injectable (`now`) in services that compare with the current date.
