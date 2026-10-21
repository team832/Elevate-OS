# Integration Contract

The rules every module (Marketing OS, Academic OS, Business Ops OS) and the platform follow so they can be built in parallel and still fit together. Code is the source of truth; this document points to it. Decisions: `docs/DECISIONS.md` (D-004, D-005, D-009–D-012, D-019–D-025).

## 1. Identities
- **One user identity** for everyone: `core.users` (`UserId`). Sign-in, sessions and roles are platform services (`@elevate/authentication`, `@elevate/authorization`). Modules never create their own user/login tables.
- **Staff** (`core.staff_members`, `StaffMemberId`) are people in the organisation; a staff member may or may not have a login (`user_id` nullable, unique). Business Ops stewards staff and departments.
- **Students and leads are not users.** A lead (`LeadId`) is owned by Business Ops; a student (`StudentId`) by Academic OS. Neither signs in (parent/student portals are out of scope, D-015).
- The signed-in user inside any server code is an `AuthenticatedUser` `{ id, email, displayName, roles, sessionId }`, which is also an authorization `Principal`.

## 2. ID rules (D-009)
- Every primary key is a UUID (`uuid('id').primaryKey().defaultRandom()`), typed with a branded type from `@elevate/shared-types` (`UserId`, `LeadId`, `StudentId`, `CourseId`, `BatchId`, `EnrolmentId`, `AdmissionId`, `TaskId`, `IdeaId`, `ContentItemId`, `CampaignId`, …).
- Human business codes (`CLAT-028`, `CLAT-028-IGC`, `SOP-OPS-004`) are **separate unique columns**, never primary keys, never reused. Generate the next number under a lock or rely on the unique constraint and retry.
- Validate incoming IDs with the zod schemas in `@elevate/shared-contracts` (`leadIdSchema`, …), which yield the branded type.
- Cross-module references store the other module's UUID **without a foreign key** (D-005) and are validated through a contract (API, event or documented read function).

## 3. Ownership
| Entity | Owner (writes) | Table(s) | Others may |
|---|---|---|---|
| User, Session, Role assignment | Platform | `core.users`, `core.sessions`, `core.user_roles` | FK to `core.users`; read via `AuthenticatedUser` |
| Department, Staff member | core, **stewarded by Business Ops** | `core.departments`, `core.staff_members` | FK into them; read |
| Programme catalogue | core, **stewarded by Academic OS** | `core.programmes` | FK / store `programmeCode`; read |
| Approval request/decision | server-kit approvals service | `core.approvals` | create/decide through `requestApproval`/`decideApproval` only |
| Audit event | server-kit | `core.audit_events` | append through `recordAudit` only |
| Notification | notifications package | `core.notifications` | `notify()` only |
| Integration events, deliveries | server-kit outbox | `core.integration_events`, `core.event_deliveries` | `publishEvent` / `processEvents` only |
| Idempotency keys | server-kit | `core.idempotency_keys` | via `defineRoute({ idempotency })` |
| Social accounts, ideas, content, versions, placements, publishing records, metrics, campaigns | Marketing OS | `marketing.*` | — |
| Courses, curriculum, batches, assignments, timetable, class records, attendance, assessments, students, enrolments, results, catch-up, interventions | Academic OS | `academic.*` | — |
| Leads, enquiries, counselling, demos, admissions, tasks, SOPs, decisions, risks, projects, responsibilities | Business Ops OS | `ops.*` | — |

File ownership during parallel work: `docs/BUILD_PLAN.md`. Need a change in a file you do not own? Write it in your module's `docs/INTEGRATION_REQUESTS.md`.

## 4. Permissions model
- Strings `<module>:<resource>:<action>`; each module declares its own in `packages/authorization/src/permissions/<module>.ts` with role grants (`'perm'` = all records, `{ permission, scope: 'own' }`).
- Every module has `<module>:module:access`; the AppShell switcher shows exactly the modules returned by `modulesFor(user)`.
- `read`/`access` are the only read-only actions; the auditor may hold only those. Only `platform_admin` manages users/roles.
- Enforcement is server-side: `defineRoute({ permission })`, `requirePageAccess(permission, …)`, `requirePermission()`, and record-level `scopedValue()` / `canAccessRecord()`.
- Matrix: `docs/SECURITY_AND_PERMISSIONS.md` (generated from code).

## 5. API conventions (D-012)
- Browser-facing REST: `/<basePath>/api/v1/<resource>` (`/marketing/api/v1/…`, `/academic/api/v1/…`, `/ops/api/v1/…`, platform `/api/v1/…`). Build every route with `defineRoute`.
- Success `{ "data": … , "meta"?: { page?: { limit, nextCursor } } }`; failure `{ "error": { "code", "message", "details"?, "requestId" } }`.
- Codes: `VALIDATION_FAILED` 400 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `INVALID_STATE_TRANSITION` 409 · `RATE_LIMITED` 429 (D-020) · `INTERNAL` 500.
- `VALIDATION_FAILED.details` is `[{ location: 'body'|'query'|'params'|'headers', path, message }]`.
- Every response has `x-request-id`; send one to correlate logs.
- Retryable creates accept `Idempotency-Key` (`defineRoute({ idempotency: 'optional' | 'required' })`) or rely on a natural unique key.
- Lists use cursor pagination (`paginationQuerySchema`: `?limit=1..200&cursor=`).
- Server-to-server: `/<basePath>/api/internal/v1/…` with `defineInternalRoute` (bearer `INTERNAL_SERVICE_TOKEN` + `X-Elevate-Caller`). Never called from browsers.
- Dates: calendar dates are `YYYY-MM-DD` in **Asia/Kolkata**; instants are ISO 8601 UTC (`timestamptz` in the DB). Money in INR as numbers of rupees unless a contract says otherwise.

## 6. Event catalogue (D-011.1 — transactional outbox)
Envelope (`eventEnvelopeSchema`): `{ id, type, version, occurredAt, producer, idempotencyKey, correlationId, causationId, payload }`. Type names `<producer>.<aggregate>.<past-tense verb>`. Registry: `packages/shared-contracts/src/events/registry.ts` (module teams add events in `src/modules/<module>.ts`).

### `ops.admission.enrolment_requested` v1 — producer `ops`, consumer `academic`
Published in the same transaction that moves an admission to "enrolment requested". `idempotencyKey = enrolmentKeys.request(admissionId, attempt)` = `admission:<admissionId>:attempt:<attempt>`.

| Field | Type | Notes |
|---|---|---|
| `admissionId` | `AdmissionId` | ops record |
| `leadId` | `LeadId` | ops record |
| `attempt` | int ≥ 1 | +1 for each re-request after a rejection |
| `programmeCode` | `CLAT` \| `IPMAT` \| … | `core.programmes.code` (upper-case code; not an enum, Academic may add programmes) |
| `intendedCourseId?` | `CourseId` | chosen in counselling; Academic validates |
| `intendedBatchId?` | `BatchId` | chosen in counselling; Academic validates |
| `deliveryMode?` | `offline` \| `online` \| `hybrid` | |
| `intendedStartDate?` | `YYYY-MM-DD` | |
| `student.fullName` | string 1–200 | fictional in dev/test |
| `student.preferredName?`, `student.dateOfBirth?`, `student.currentStage?` (`class_9`…`graduate`/`other`), `student.schoolBoard?`, `student.email?`, `student.phone?` (E.164), `student.city?` | | collect only what is needed (many students are minors) |
| `guardian?` | `{ fullName, relationship: mother\|father\|guardian\|other, email?, phone? }` | needed for minors |
| `counsellorStaffId` | `StaffMemberId` | owning counsellor |
| `requestedByUserId` | `UserId` | who triggered it |
| `notes?` | string ≤ 2000 | |

Rules: strict object (unknown fields rejected); at least one contact (student or guardian email/phone). Fees and payments are **not** in this contract.

### `academic.enrolment.confirmed` v1 — producer `academic`, consumer `ops`
`{ requestEventId, admissionId, leadId, enrolmentId, studentId, existingStudent, programmeCode, courseId?, batchId?, confirmedAt, confirmedByUserId | null }`. `idempotencyKey = enrolmentKeys.reply(requestEventId)`; `correlationId = requestEventId`.

### `academic.enrolment.rejected` v1 — producer `academic`, consumer `ops`
`{ requestEventId, admissionId, leadId, reasonCode, reason, rejectedAt, rejectedByUserId | null }`, `reasonCode ∈ PROGRAMME_NOT_OFFERED | COURSE_NOT_FOUND | BATCH_NOT_FOUND | BATCH_FULL | DUPLICATE_ENROLMENT | INVALID_REQUEST | OTHER`. Same key/correlation rules. Ops may correct and re-request with `attempt + 1`.

### Handoff sequence
1. Ops (one transaction): admission → `enrolment_requested`; `publishEvent(tx, enrolment_requested)`; `recordAudit`.
2. Academic consumer `academic.enrolment-intake` (`processEvents`): validates refs; creates or reuses the student; creates the enrolment (or decides to reject — automatically or after a coordinator's decision); publishes exactly one reply in the same transaction.
3. Ops consumer `ops.enrolment-replies`: moves the admission to `enrolled` or `enrolment_rejected`; notifies the counsellor.
4. Exactly-once effect: `core.event_deliveries` is unique per (event, consumer); a crashed handler rolls back and is retried; after `maxAttempts` the delivery is `dead` and needs a human.
5. Until a reply arrives the admission shows "awaiting Academic OS" — never "enrolled".

**Who runs consumers:** each consumer module calls `processEvents` (e.g. from a route its UI triggers, or a scheduled job). A scheduler is a wave-3 integration item.

## 7. Summary contracts (D-011.2 — read-only HTTP)
Endpoint `GET /<zone>/api/internal/v1/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`, built with `defineInternalRoute`, returning:
- `MarketingSummaryV1` (`marketingSummaryV1Schema`): `contract: 'marketing.summary'`, `version: 1`, `generatedAt`, `window`, `metrics { ideasCaptured, contentApproved, postsScheduled, postsPublished, totalReach, engagementRate, followerGrowth, leadsAttributed }`, `accounts[] { accountCode, platform, connection, postsPublished, reach }`, `dataSources[] { name, connection, lastSyncAt }`.
- `AcademicDeliverySummaryV1` (`academicDeliverySummaryV1Schema`): `contract: 'academic.delivery_summary'`, `version: 1`, `generatedAt`, `window`, `metrics { activeStudents, activeBatches, classesPlanned, classesDelivered, classesCancelled, attendanceRate, assessmentsPlanned, assessmentsConducted, studentsAtRisk, syllabusCompletionRate }`, `programmes[] { programmeCode, metrics }`.

Per-student contract (IR-OPS-STU-1, 21 Oct 2026):
- `AcademicStudentSummaryV1` (`academicStudentSummaryV1Schema`, `packages/shared-contracts/src/summaries.ts`) at `GET /academic/api/internal/v1/students/{academicStudentId}/summary?from&to` (caller `ops` only; 401 bad token, 403 other caller, 400 bad window or more than three years, 404 unknown student; default window the last 365 days, IST; teachers come from the sessions actually held: class record teacher, else the session teacher): `contract: 'academic.student_summary'`, `version: 1`, `generatedAt`, `studentId`, `window`, `enrolments[] { enrolmentId, programmeCode, batchId, batchName, status, teachers[] { staffId, subject } }`, `attendance { held, present, partial, late, absent, excused }` (unrecorded = held − the sum), `results[] { assessmentId, code, subject, examType, heldOn, state: scored | absent, score, maxScore, percentile, rank, cohort { label, scored }, resultVersion }`. Only final result runs; an absent result has no score, percentile or rank (never 0). Ops uses it for the student profile and progress reports; the Ops report keeps a snapshot taken at draft time.

Every metric is `{ status: 'ok' | 'estimated' | 'missing', value: number | null, definition, window: { from, to, label? }, unit }` (+ `basis` for estimated, `reason` for missing). **Missing is not zero**: a metric without trustworthy data is `missing` with `value: null`; planned counts are never reported as delivered (D-016). Connection status values: `not_configured | sandbox | connected | error` (D-014). Consumers call `fetchInternal(url, schema, { caller })` and render `SourceResult.status === 'unavailable'` as "source unavailable", never as zeros. UI: `StatTile` renders the three statuses distinctly.

## 8. Versioning
- Events: a breaking payload change is a new `version` (new `defineEvent`); producers may publish both while consumers migrate; consumers keep accepting the old version until every producer stops emitting it.
- HTTP: breaking changes go to `/api/v2/…`; v1 stays until consumers migrate (D-012).
- Summary contracts: `version` literal in the payload; v2 is a new schema and endpoint.
- Additive, optional fields are non-breaking; removing/renaming fields, tightening validation, or changing meaning is breaking.

## 9. Failure behaviour
| Situation | Required behaviour |
|---|---|
| Consumer handler throws | Transaction rolls back; delivery `failed` with `last_error`; retried on next `processEvents`; `dead` after `maxAttempts` (default 5) → surfaced for a human |
| Same event delivered twice | Second run is a no-op (delivery row already `processed`) |
| Producer transaction fails | No event exists (outbox row rolled back with the business change) |
| Publish retried with same key | Returns the existing event id (`created: false`) |
| Summary source down / slow / wrong shape | `fetchInternal` → `unavailable` + reason; UI says "source unavailable" |
| Partial data | Metric `missing` (with reason) or `estimated` (with basis) — never 0 |
| HTTP create retried | Same `Idempotency-Key` + same body → stored response replayed; different body → 409 |
| External system (Metricool, Instagram, YouTube, LinkedIn, CRM, Vacademy) | Adapter interface, mock by default, honest connection status (D-014) |

## 10. Code boundaries (enforced by ESLint, D-023)
- A module app never imports another module app — not its packages (`@elevate/<other>-os`), not by relative path.
- Shared packages never import apps.
- `apps/*/src/domain/**` is pure (no Next/React, database, server-kit, Node I/O).
- Application code never imports `@elevate/testing` / `@elevate/database/testing`.
- Modules publish `./domain`, `./server`, `./seed` entry points for the platform app and wave-3 integration tests only.
