# Database Design

One PostgreSQL database, four schemas (D-005): `core` (shared), `marketing`, `academic`, `ops` (one per module). Definitions live in `packages/database/src/schema/{core,marketing,academic,ops}.ts` (the `ops` schema spans `ops.ts` plus the `ops-*.ts` files and `academic` spans `academic-*.ts`, D-029); column-level detail is in `docs/DATA_DICTIONARY.md`; process in `docs/DATABASE_MIGRATION_PLAN.md`.

## 1. Conventions
| Topic | Rule |
|---|---|
| Primary keys | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, branded in TypeScript (`$type<LeadId>()`) — D-009 |
| Business codes | Separate `code text` column with a unique index (e.g. `CLAT-028`); never reused |
| Names | snake_case tables and columns; plural table names; TypeScript exports camelCase and **prefixed with the module** for module tables (`opsLeads`) |
| Timestamps | `timestamptz`; `created_at DEFAULT now()`, `updated_at DEFAULT now()` maintained by Drizzle `$onUpdate`; instants are UTC, calendar dates (`date`) are Asia/Kolkata days |
| Status columns | `text` + explicit `CHECK (status IN (...))` + matching TypeScript enum; transitions enforced in domain code and reported as `INVALID_STATE_TRANSITION` |
| Foreign keys | Into `core` from anywhere. **Never between module schemas** — store the UUID and validate through a contract. `ON DELETE` chosen per relation (`cascade` for owned children, `restrict` for history, `set null` for optional links) |
| History | Business history is not deleted: approvals keep request + decision; audit is append-only; soft states (`archived`, `inactive`, `withdrawn`) instead of `DELETE` |
| JSON | `jsonb` only for open-ended data (audit before/after, event payloads); first-class fields are columns |
| Indexes | Every FK used in lookups, every `(status, date)` work queue, every unique business key |
| Money | `numeric(12,2)` rupees (or integer paise) — decide per table and document; never floating point |

## 2. `core` schema (Foundation-owned)

```
users ─┬─< sessions
       ├─< user_roles
       ├─< staff_members >── departments
       │        └── manager_id → staff_members (self)
       ├─< notifications
       ├─< approvals (requested_by, decided_by)
       ├─< audit_events (actor_user_id)
       └─< idempotency_keys
programmes                          (stewarded by Academic OS)
integration_events ─< event_deliveries (unique event_id + consumer)
```

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | Login identities | unique `email`; `email = lower(email)`; status `active`/`disabled` |
| `sessions` | Server-side sessions | unique `token_hash` (HMAC of the cookie token); `expires_at > created_at`; FK user cascade; indexes on user, expiry |
| `user_roles` | Role assignments | PK (`user_id`, `role`); `granted_by` → users (set null); role validated in code against `ROLE_KEYS` |
| `departments` | Organisation units (13 provisional, from the legacy model) | unique `code` matching `^[A-Z][A-Z0-9_]{1,39}$`; status `active`/`provisional`/`archived` |
| `staff_members` | People in the organisation (with or without a login) | partial unique `user_id`; FK department (restrict); self-FK manager (set null); cannot manage self; status `active`/`on_leave`/`inactive` |
| `branches` | Centres (since 23 Oct 2026, D-080; one row `SIKAR` "Sikar centre", provisional); referenced by staff profiles, holidays and teaching assignments | unique `code` (same format); status `active`/`provisional`/`archived` |
| `programmes` | Programme catalogue | unique `code` (same format); status `active`/`planned`/`paused`/`retired` |
| `approvals` | Approval requests and decisions (history-preserving) | partial unique (`subject_module`, `subject_type`, `subject_id`, `policy`) WHERE `status='pending'`; decision-consistency CHECK; module CHECK |
| `audit_events` | Append-only audit trail | `actor_type` user/system/service; a user actor needs `actor_user_id`; indexes (entity_type, entity_id, at), (module, at), (actor_user_id, at) |
| `notifications` | In-app notifications | relative `link` only (`LIKE '/%'`); index (user_id, read_at, created_at) |
| `integration_events` | Transactional outbox | unique (`producer`, `idempotency_key`); `version >= 1`; indexes (type, occurred_at), (correlation_id) |
| `event_deliveries` | Per-consumer processing state | unique (`event_id`, `consumer`); status `processed`/`failed`/`dead`; `attempts >= 1` |
| `idempotency_keys` | Stored responses for retried HTTP creates | unique (`scope`, `key`, `user_id`) NULLS NOT DISTINCT; index on `expires_at` |

Write ownership of core tables: `INTEGRATION_CONTRACT.md` §3.

## 3. `marketing` schema
**Owned by the Marketing team — to be filled.** Declared in `packages/database/src/schema/marketing.ts` (`pgSchema('marketing')`, no tables yet). Expected entities (D-010): social accounts, ideas, content items, versions, placements, publishing records, marketing metrics, campaigns.

## 4. `academic` schema
**Owned by the Academic team — to be filled.** Declared in `packages/database/src/schema/academic.ts` (no tables yet). Expected entities: courses, curriculum, batches, teachers' assignments, timetable, class records, attendance, assessments, students, enrolments (holding the ops `admission_id` / `lead_id` as plain UUIDs), results, catch-up, interventions.

## 5. `ops` schema
**Owned by the Business Ops team.** 55 tables (data dictionary, 23 Oct 2026) in `ops.ts` (leads, enquiries, follow-ups, staff profiles, settings and the shared `pgSchema('ops')`) and one file per area (D-029): `ops-applications.ts`, `ops-demos.ts`, `ops-students.ts`, `ops-fees-intake.ts`, `ops-onboarding.ts`, `ops-meetings.ts`, `ops-review-acks.ts`, `ops-teacher-reports.ts`, `ops-tasks.ts`, `ops-task-work.ts` (submissions, reviews, checklist, collaborators), `ops-task-imports.ts`, `ops-eod.ts` (day, week and month reports), and since 23 Oct 2026 (D-080, migration 0015) `ops-hr.ts` (staff private details, department and manager history), `ops-attendance.ts` (schedules, holidays, leave, punches, imports, corrections, HR decisions), `ops-feedback.ts` (feedback imports, summaries, development actions) and `ops-attachments.ts`; `ops-columns.ts` holds shared column helpers and defines no tables. The earlier `ops-lifecycle.ts`, `ops-time.ts` and `ops-work.ts` no longer exist. All use the one `pgSchema('ops')` exported by `ops.ts`; `SCHEMA_MODULES` and `drizzle.config.ts` list every file. Diagram and table list: `apps/business-ops-os/docs/DATA_MODEL.md`. Ops also writes `core.departments` and `core.staff_members` (steward).

## 6. How the schema reaches a database
- **Tests:** `createTestDb()` builds the live schema from all schema files in in-memory PGlite (no migrations needed; D-025).
- **Dev/prod:** SQL migrations generated centrally (`npm run db:generate`) into `packages/database/migrations/` and applied with `npm run db:migrate`. Migrations `0000`–`0015` are in the repo; `0000`–`0014` are applied on the owner's computer and `0015_hr_staff_workspaces` is written and tested but **not applied** (state and next number: `docs/DATABASE_MIGRATION_PLAN.md`).
