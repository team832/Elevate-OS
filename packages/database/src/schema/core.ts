/**
 * OWNER: Foundation (wave 1), then Integration (wave 3).
 *
 * The `core` schema: identity, sessions, roles, the shared organisation
 * catalogue (departments, staff, programmes), approvals, audit, notifications,
 * the integration-event outbox and idempotency keys.
 *
 * Write rules (D-005, D-010):
 * - users / sessions / user_roles: only @elevate/authentication and platform admin routes.
 * - departments / staff_members: only Business Ops OS (steward).
 * - programmes: only Academic OS (steward).
 * - approvals / audit_events / integration_events / event_deliveries / idempotency_keys:
 *   only through @elevate/server-kit; notifications only through @elevate/notifications.
 * Any module may hold a foreign key INTO core.
 *
 * Only `import type` from workspace packages here: drizzle-kit loads this file
 * directly and must not need to resolve runtime workspace imports.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  ApprovalId,
  AuditEventId,
  DepartmentId,
  EventDeliveryId,
  IdempotencyKeyId,
  IntegrationEventId,
  ModuleKey,
  NotificationId,
  ProgrammeId,
  RoleKey,
  SessionId,
  StaffMemberId,
  UserId,
} from '@elevate/shared-types';

export const core = pgSchema('core');

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const MODULE_CHECK = sql`IN ('platform', 'marketing', 'academic', 'ops')`;

// --- identity -----------------------------------------------------------------------

export const users = core.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<UserId>(),
    /** Stored lower-case; unique. */
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** scrypt hash (see @elevate/authentication); null = cannot sign in with a password. */
    passwordHash: text('password_hash'),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    // D-030: only organisation accounts; @example.test is the fictional seed/test domain,
    // refused at sign-in in production by @elevate/authentication.
    check(
      'users_email_domain',
      sql`${t.email} ~ '^[^@[:space:]]+@(elevateeducation\\.in|example\\.test)$'`,
    ),
    check('users_status_check', sql`${t.status} IN ('active', 'disabled')`),
  ],
);

export const sessions = core.table(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<SessionId>(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .$type<UserId>(),
    /** HMAC-SHA256(SESSION_SECRET, token) — the raw token only ever lives in the cookie. */
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
    check('sessions_expiry_after_creation', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const userRoles = core.table(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .$type<UserId>(),
    /** Validated against ROLE_KEYS in code (@elevate/authorization). */
    role: text('role').notNull().$type<RoleKey>(),
    grantedBy: uuid('granted_by')
      .references(() => users.id, { onDelete: 'set null' })
      .$type<UserId>(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'user_roles_pkey', columns: [t.userId, t.role] }),
    index('user_roles_role_idx').on(t.role),
  ],
);

// --- organisation (stewarded: departments/staff by Ops, programmes by Academic) ----------

export const departments = core.table(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<DepartmentId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** provisional = from the legacy "suggested departments" model, not yet confirmed by the owner. */
    status: text('status', { enum: ['active', 'provisional', 'archived'] })
      .notNull()
      .default('provisional'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('departments_code_key').on(t.code),
    check('departments_status_check', sql`${t.status} IN ('active', 'provisional', 'archived')`),
    check('departments_code_format', sql`${t.code} ~ '^[A-Z][A-Z0-9_]{1,39}$'`),
  ],
);

export const staffMembers = core.table(
  'staff_members',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<StaffMemberId>(),
    /** Login account, if the staff member has one. One user ↔ at most one staff record. */
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'set null' })
      .$type<UserId>(),
    fullName: text('full_name').notNull(),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'restrict' })
      .$type<DepartmentId>(),
    title: text('title'),
    managerId: uuid('manager_id')
      .references((): AnyPgColumn => staffMembers.id, { onDelete: 'set null' })
      .$type<StaffMemberId>(),
    status: text('status', { enum: ['active', 'on_leave', 'inactive'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('staff_members_user_id_key')
      .on(t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    index('staff_members_department_idx').on(t.departmentId),
    index('staff_members_manager_idx').on(t.managerId),
    check('staff_members_status_check', sql`${t.status} IN ('active', 'on_leave', 'inactive')`),
    check(
      'staff_members_not_own_manager',
      sql`${t.managerId} IS NULL OR ${t.managerId} <> ${t.id}`,
    ),
  ],
);

export const programmes = core.table(
  'programmes',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<ProgrammeId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', { enum: ['active', 'planned', 'paused', 'retired'] })
      .notNull()
      .default('planned'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('programmes_code_key').on(t.code),
    check(
      'programmes_status_check',
      sql`${t.status} IN ('active', 'planned', 'paused', 'retired')`,
    ),
    check('programmes_code_format', sql`${t.code} ~ '^[A-Z][A-Z0-9_]{1,39}$'`),
  ],
);

// --- approvals (history-preserving: rows are never deleted) -----------------------------

export const approvals = core.table(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<ApprovalId>(),
    subjectModule: text('subject_module').notNull().$type<ModuleKey>(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** Policy key, e.g. `marketing.content.publish` (defineApprovalPolicy in server-kit). */
    policy: text('policy').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'withdrawn'] })
      .notNull()
      .default('pending'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    requestComment: text('request_comment'),
    decidedBy: uuid('decided_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Decision comment. */
    comment: text('comment'),
  },
  (t) => [
    index('approvals_subject_idx').on(t.subjectModule, t.subjectType, t.subjectId),
    index('approvals_status_idx').on(t.status, t.requestedAt),
    // At most one open request per subject and policy.
    uniqueIndex('approvals_one_pending_per_subject')
      .on(t.subjectModule, t.subjectType, t.subjectId, t.policy)
      .where(sql`${t.status} = 'pending'`),
    check('approvals_subject_module_check', sql`${t.subjectModule} ${MODULE_CHECK}`),
    check(
      'approvals_status_check',
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'withdrawn')`,
    ),
    check(
      'approvals_decision_consistency',
      sql`(${t.status} = 'pending' AND ${t.decidedAt} IS NULL AND ${t.decidedBy} IS NULL)
        OR (${t.status} IN ('approved', 'rejected') AND ${t.decidedAt} IS NOT NULL AND ${t.decidedBy} IS NOT NULL)
        OR (${t.status} = 'withdrawn' AND ${t.decidedAt} IS NOT NULL)`,
    ),
  ],
);

// --- audit (append-only by convention: no update/delete API exists) ---------------------

export const auditEvents = core.table(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AuditEventId>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorType: text('actor_type', { enum: ['user', 'system', 'service'] }).notNull(),
    actorUserId: uuid('actor_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    module: text('module').notNull().$type<ModuleKey>(),
    /** Dotted verb, e.g. `approval.decided`, `lead.created`. */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    metadata: jsonb('metadata'),
  },
  (t) => [
    index('audit_events_entity_idx').on(t.entityType, t.entityId, t.at),
    index('audit_events_module_at_idx').on(t.module, t.at),
    index('audit_events_actor_idx').on(t.actorUserId, t.at),
    check('audit_events_module_check', sql`${t.module} ${MODULE_CHECK}`),
    check('audit_events_actor_type_check', sql`${t.actorType} IN ('user', 'system', 'service')`),
    check(
      'audit_events_user_actor_has_id',
      sql`${t.actorType} <> 'user' OR ${t.actorUserId} IS NOT NULL`,
    ),
  ],
);

// --- notifications ------------------------------------------------------------------------

export const notifications = core.table(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<NotificationId>(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .$type<UserId>(),
    module: text('module').notNull().$type<ModuleKey>(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Relative link inside Elevate OS, e.g. /ops/admissions/<id>. */
    link: text('link'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('notifications_user_unread_idx').on(t.userId, t.readAt, t.createdAt),
    check('notifications_module_check', sql`${t.module} ${MODULE_CHECK}`),
    check('notifications_link_relative', sql`${t.link} IS NULL OR ${t.link} LIKE '/%'`),
  ],
);

// --- integration events (transactional outbox, D-011) ---------------------------------------

export const integrationEvents = core.table(
  'integration_events',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<IntegrationEventId>(),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    producer: text('producer').notNull().$type<ModuleKey>(),
    idempotencyKey: text('idempotency_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid('correlation_id'),
    causationId: uuid('causation_id'),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('integration_events_producer_key').on(t.producer, t.idempotencyKey),
    index('integration_events_type_idx').on(t.type, t.occurredAt),
    index('integration_events_correlation_idx').on(t.correlationId),
    check('integration_events_producer_check', sql`${t.producer} ${MODULE_CHECK}`),
    check('integration_events_version_positive', sql`${t.version} >= 1`),
  ],
);

export const eventDeliveries = core.table(
  'event_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<EventDeliveryId>(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => integrationEvents.id, { onDelete: 'restrict' })
      .$type<IntegrationEventId>(),
    /** Consumer name, e.g. `academic.enrolment-intake`. */
    consumer: text('consumer').notNull(),
    status: text('status', { enum: ['processed', 'failed', 'dead'] }).notNull(),
    attempts: integer('attempts').notNull().default(1),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('event_deliveries_event_consumer_key').on(t.eventId, t.consumer),
    index('event_deliveries_consumer_status_idx').on(t.consumer, t.status),
    check('event_deliveries_status_check', sql`${t.status} IN ('processed', 'failed', 'dead')`),
    check('event_deliveries_attempts_positive', sql`${t.attempts} >= 1`),
  ],
);

// --- idempotency keys for retried HTTP requests (D-012) ----------------------------------------

export const idempotencyKeys = core.table(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<IdempotencyKeyId>(),
    /** Route scope, e.g. `POST /ops/api/v1/leads`. */
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    /** Who sent it; keys are per user so two users cannot collide. Null for service calls. */
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .$type<UserId>(),
    /** sha256 of the request body — the same key with a different body is a CONFLICT. */
    requestHash: text('request_hash').notNull(),
    completed: boolean('completed').notNull().default(false),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('idempotency_keys_scope_user_key').on(t.scope, t.key, t.userId).nullsNotDistinct(),
    index('idempotency_keys_expires_idx').on(t.expiresAt),
  ],
);
