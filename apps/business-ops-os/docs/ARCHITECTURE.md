# Business Ops OS — architecture

Next.js App Router app at basePath `/ops` (port 3003), behind the platform's rewrite (D-004). Layers follow BUILD_PLAN "Module internal layout"; ESLint enforces the boundaries (D-023).

```
src/app/            pages (server components) + api/v1 route handlers (thin: defineRoute → service)
src/ui/             Frame (access gate + AppShell + Suspense/error helpers), ActionForm and
                    LeadCreateForm (client: JSON fetch to /ops/api/v1), CrossModulePanels, formatting
src/server/         services: one transaction per command, permission + scope checks, audit, outbox,
                    notifications; adapters (CRM mock); fetchInternal summaries; zod input schemas
src/domain/         pure rules: contacts/duplicates, pipeline, readiness, follow-ups, graph, tasks,
                    escalation, staff, SOPs, KPIs, policies (settings), registers, legacy mappers
seed/               reference data, legacy imports, fictional samples (through the real services)
packages/database/src/schema/ops.ts            29 ops tables (Ops-owned)
packages/authorization/src/permissions/ops.ts  permissions and role grants (Ops-owned)
packages/shared-contracts/src/modules/ops.ts   consumer name; no new events
```

## Request flow
1. **Route**: `defineRoute({ permission, body/query/params })` → 401/403/400 → handler calls a service with `(db, user, input, requestId)`.
2. **Service**: `accessScope(db, actor, permission)` returns `all` or `own` + the actor's staff id (records are "own" when the actor's staff record is the owner / counsellor). Then `withTransaction`: lock rows (`FOR UPDATE`), call pure domain checks, write, `recordAudit` (metadata `leadId` links everything to the lead history), `notify`, `publishEvent` when another module must react.
3. **Page**: `gate(permission)` (`requirePageAccess` — redirects signed-out users with a real 307 before any Suspense) → `Frame` (AppShell + permission-filtered navigation) → `<Section>` (Suspense → `LoadingState`) → async section calls the same services via `load()`, which turns AppErrors into `ErrorState` (403/404 messages) and other errors into a generic error with the request reference; empty lists use `EmptyState`.
4. **Forms**: client `ActionForm` posts JSON to `/ops/api/v1/...` (cookie same-origin), shows field errors from `details[].path`, and refreshes. The server is the only control; hiding buttons is cosmetic.

## Cross-module integration
| Direction | Mechanism | Code |
|---|---|---|
| Ops → Academic: enrolment request | Transactional outbox, `ops.admission.enrolment_requested` v1, key `admission:<id>:attempt:<n>` | `server/enrolment.ts` `requestEnrolment` |
| Academic → Ops: reply | `processEvents` consumer `ops.enrolment-replies` for `academic.enrolment.confirmed` / `.rejected` | `server/enrolment.ts` `processEnrolmentReplies` |
| Academic, Marketing → Ops dashboard | `fetchInternal` to `/academic|/marketing/api/internal/v1/summary`; failures render "source unavailable" | `server/summaries.ts`, `ui/cross-module.tsx` |
| Core (steward) | Ops writes `core.departments`, `core.staff_members` (only via `server/organisation.ts`, `seed/reference.ts`) | |
| Core shared services | approvals (`ops.admission.fee_arrangement`, `ops.sop.approve`), audit, notifications, idempotency keys | `server/approval-policies.ts` |

No other module is imported (ESLint). External CRM: interface + mock only (`server/adapters/crm.ts`, D-014, OD-010).

## Jobs (no scheduler yet — IR-OPS-02)
`runFollowUpReminders` (A-06), `runTaskEscalations` (A-09), `processEnrolmentReplies` (A-15) — idempotent; run from `/ops/tasks` or `POST /ops/api/v1/jobs/{job}` (`ops:jobs:run`).

## Configuration
`ops.settings` rows override code defaults in `domain/policies.ts`. Every value carries a decision state (`approved`, `locked`, `proposed`, `open`, `pending_verification`) and source; edits through the API are always stored as `proposed`. Values that record a legacy approved/locked decision (demo terms, online office hours) are read-only.

## Transactions and concurrency
Row locks on the record being changed; advisory locks for code generation and the task-dependency graph; conditional updates (`WHERE status = from`, reminder claim) so concurrent requests cannot double-apply. Idempotency keys on lead creation and enrolment requests.
