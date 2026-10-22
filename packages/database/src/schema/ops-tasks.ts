/**
 * OWNER: Business Ops OS — staff tasks: the task, its dated history (`task_events`), work updates
 * and dependencies (owner decision 21 Oct 2026, partial reversal of D-032; owner brief 2 §5–6).
 * Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts. EOD reports are
 * in ops-eod.ts, tracker imports in ops-task-imports.ts. Ownership history = `reassigned` events.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  time,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { AdmissionId, Brand, DepartmentId, LeadId } from '@elevate/shared-types';
import { departments } from './core';
import { ops, opsAdmissions, opsLeads } from './ops';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  staffRef,
  staffRefRestrict,
  studentRef,
  updatedAt,
  userRef,
} from './ops-columns';
import { opsTaskImportBatches } from './ops-task-imports';

export type OpsStaffTaskId = Brand<string, 'OpsStaffTaskId'>;
export type OpsTaskEventId = Brand<string, 'OpsTaskEventId'>;
export type OpsTaskUpdateId = Brand<string, 'OpsTaskUpdateId'>;

// Mirrored in apps/business-ops-os/src/domain/staff-tasks.ts (a unit test keeps them equal).
/** D-052 tracker statuses plus `in_review` and `cancelled` (R1). Acknowledgement is not a status. */
export const OPS_TASK_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'blocked',
  'on_hold',
  'in_review',
  'cancelled',
] as const;
export const OPS_TASK_PRIORITIES = ['high', 'medium', 'low'] as const;
export const OPS_TASK_RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const;
export const OPS_TASK_SOURCES = [
  'manager',
  'self',
  'verbal',
  'academic',
  'import',
  'recurring',
] as const;
export const OPS_TASK_EVENT_KINDS = [
  'created',
  'assigned',
  'reassigned',
  'acknowledged',
  'clarification_requested',
  'status_changed',
  'submitted_for_review',
  'review_approved',
  'changes_requested',
  'reopened',
  'cancelled',
  'due_changed',
  'priority_changed',
  'comment',
  'imported',
  'dependency_added',
  'edited',
] as const;

const filled = (column: AnyPgColumn) => sql`length(trim(coalesce(${column}, ''))) > 0`;

/**
 * Work a staff member received (manager, self, verbal request, another module, import) and logs
 * by IST day. One accountable owner (`staff_id`); the backup owner is not accountable unless
 * reassigned. Blocked, on-hold and cancelled tasks carry a reason; a done task is 100% with its
 * completion time. Completing a recurring task creates its next occurrence once
 * (`recurrence_parent_id` is unique). `version` is bumped on every write (optimistic concurrency).
 */
export const opsStaffTasks = ops.table(
  'staff_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsStaffTaskId>(),
    /** Whose task it is (the one accountable owner). */
    staffId: staffRefRestrict('staff_id').notNull(),
    title: text('title').notNull(),
    details: text('details'),
    /** Who gave the work, when recorded. */
    assignedByStaffId: staffRef('assigned_by_staff_id'),
    source: text('source', { enum: OPS_TASK_SOURCES }).notNull().default('self'),
    /** Who asked for the work, when it is not the assigner (e.g. a verbal request). */
    requesterStaffId: staffRef('requester_staff_id'),
    /** Requester name/channel for a verbal or outside request (no ingestion is claimed). */
    requesterNote: text('requester_note'),
    departmentId: uuid('department_id')
      .references(() => departments.id, { onDelete: 'restrict' })
      .$type<DepartmentId>(),
    /** Stand-in owner; not accountable unless the task is reassigned. */
    backupStaffId: staffRef('backup_staff_id'),
    /** Who closes the task when review is required (null = resolved by the service). */
    reviewerStaffId: staffRef('reviewer_staff_id'),
    reviewRequired: boolean('review_required').notNull().default(false),
    acceptanceCriteria: text('acceptance_criteria'),
    /** What the task is about (at most one). */
    leadId: uuid('lead_id')
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    admissionId: uuid('admission_id')
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    studentId: studentRef(),
    /** Plain reference to a record in another module (e.g. an Academic support case); no FK (R8). */
    linkedRef: text('linked_ref'),
    priority: text('priority', { enum: OPS_TASK_PRIORITIES }).notNull().default('medium'),
    /** When the work was received (UTC). */
    receivedAt: instant('received_at').notNull().defaultNow(),
    plannedStartOn: isoDate('planned_start_on'),
    /** IST due day, and optional IST time on that day. */
    dueOn: isoDate('due_on').notNull(),
    dueTime: time('due_time'),
    status: text('status', { enum: OPS_TASK_STATUSES }).notNull().default('pending'),
    /** Self-reported progress; never derived from elapsed time. */
    progressPercent: integer('progress_percent').notNull().default(0),
    /** Why it is blocked, on hold, cancelled or not done (shown in the EOD report). */
    reason: text('reason'),
    acknowledgedAt: instant('acknowledged_at'),
    acknowledgedByUserId: userRef('acknowledged_by_user_id'),
    recurrence: text('recurrence', { enum: OPS_TASK_RECURRENCES }).notNull().default('none'),
    /** The completed task this occurrence follows. */
    recurrenceParentId: uuid('recurrence_parent_id')
      .references((): AnyPgColumn => opsStaffTasks.id, { onDelete: 'restrict' })
      .$type<OpsStaffTaskId>(),
    completedAt: instant('completed_at'),
    /** Tracker identity `<source kind>:<source staff id>:<legacy id>`, composed by the importer. */
    legacyRef: text('legacy_ref'),
    importBatchId: uuid('import_batch_id').references((): AnyPgColumn => opsTaskImportBatches.id, {
      onDelete: 'restrict',
    }),
    isSample: boolean('is_sample').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('staff_tasks_staff_due_idx').on(t.staffId, t.dueOn),
    index('staff_tasks_status_due_idx').on(t.status, t.dueOn),
    index('staff_tasks_reviewer_status_idx').on(t.reviewerStaffId, t.status),
    uniqueIndex('staff_tasks_recurrence_parent_key')
      .on(t.recurrenceParentId)
      .where(sql`${t.recurrenceParentId} IS NOT NULL`),
    uniqueIndex('staff_tasks_legacy_ref_key')
      .on(t.legacyRef)
      .where(sql`${t.legacyRef} IS NOT NULL`),
    check('staff_tasks_title_check', sql`length(trim(${t.title})) > 0`),
    check('staff_tasks_status_check', sql`${t.status} IN ${inList(OPS_TASK_STATUSES)}`),
    check('staff_tasks_priority_check', sql`${t.priority} IN ${inList(OPS_TASK_PRIORITIES)}`),
    check('staff_tasks_recurrence_check', sql`${t.recurrence} IN ${inList(OPS_TASK_RECURRENCES)}`),
    check('staff_tasks_source_check', sql`${t.source} IN ${inList(OPS_TASK_SOURCES)}`),
    check('staff_tasks_progress_check', sql`${t.progressPercent} BETWEEN 0 AND 100`),
    check('staff_tasks_version_check', sql`${t.version} >= 1`),
    check(
      'staff_tasks_done_check',
      sql`(${t.status} = 'done') = (${t.completedAt} IS NOT NULL) AND (${t.status} <> 'done' OR ${t.progressPercent} = 100)`,
    ),
    check(
      'staff_tasks_reason_check',
      sql`${t.status} NOT IN ('blocked', 'on_hold', 'cancelled') OR ${filled(t.reason)}`,
    ),
    check(
      'staff_tasks_acknowledged_check',
      sql`(${t.acknowledgedAt} IS NULL) = (${t.acknowledgedByUserId} IS NULL)`,
    ),
    check(
      'staff_tasks_backup_check',
      sql`${t.backupStaffId} IS NULL OR ${t.backupStaffId} <> ${t.staffId}`,
    ),
    check(
      'staff_tasks_one_related',
      sql`num_nonnulls(${t.leadId}, ${t.admissionId}, ${t.studentId}) <= 1`,
    ),
  ],
);

const taskRef = (name: string) =>
  uuid(name)
    .references(() => opsStaffTasks.id, { onDelete: 'restrict' })
    .$type<OpsStaffTaskId>();

/**
 * Append-only, date-aware history of a task: what happened, when, by whom and why. EOD drafts and
 * end-to-end reports read it (never the task's current status). `occurred_at` is the original
 * time (kept on import); `created_at` is when the row was written.
 */
export const opsTaskEvents = ops.table(
  'task_events',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTaskEventId>(),
    taskId: taskRef('task_id').notNull(),
    kind: text('kind', { enum: OPS_TASK_EVENT_KINDS }).notNull(),
    fromStatus: text('from_status', { enum: OPS_TASK_STATUSES }),
    toStatus: text('to_status', { enum: OPS_TASK_STATUSES }),
    /** Owner before/after (assigned, reassigned). */
    fromStaffId: staffRefRestrict('from_staff_id'),
    toStaffId: staffRefRestrict('to_staff_id'),
    actorUserId: userRef('actor_user_id').notNull(),
    occurredAt: instant('occurred_at').notNull().defaultNow(),
    reason: text('reason'),
    /** Changed values (e.g. due day before/after, priority before/after). */
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('task_events_task_occurred_idx').on(t.taskId, t.occurredAt),
    index('task_events_actor_occurred_idx').on(t.actorUserId, t.occurredAt),
    check('task_events_kind_check', sql`${t.kind} IN ${inList(OPS_TASK_EVENT_KINDS)}`),
    check(
      'task_events_status_check',
      sql`(${t.fromStatus} IS NULL OR ${t.fromStatus} IN ${inList(OPS_TASK_STATUSES)}) AND (${t.toStatus} IS NULL OR ${t.toStatus} IN ${inList(OPS_TASK_STATUSES)})`,
    ),
    check(
      'task_events_status_change_check',
      sql`${t.kind} <> 'status_changed' OR ${t.toStatus} IS NOT NULL`,
    ),
    check(
      'task_events_owner_change_check',
      sql`${t.kind} NOT IN ('assigned', 'reassigned') OR ${t.toStaffId} IS NOT NULL`,
    ),
    check(
      'task_events_reason_check',
      sql`${t.kind} NOT IN ('clarification_requested', 'changes_requested', 'reopened', 'cancelled') OR ${filled(t.reason)}`,
    ),
  ],
);

/**
 * A work update on a task (separate from comments and decisions). Append-only: a correction is a
 * new row pointing at the update it corrects, with a reason (one correction per update, no
 * forks). `occurred_on` is the IST work day; a late entry keeps it and records `recorded_at`.
 * Time is either a recorded duration or explicit start/stop.
 */
export const opsTaskUpdates = ops.table(
  'task_updates',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTaskUpdateId>(),
    taskId: taskRef('task_id').notNull(),
    authorUserId: userRef('author_user_id').notNull(),
    authorStaffId: staffRefRestrict('author_staff_id').notNull(),
    occurredOn: isoDate('occurred_on').notNull(),
    occurredAt: instant('occurred_at'),
    recordedAt: instant('recorded_at').notNull().defaultNow(),
    workPerformed: text('work_performed').notNull(),
    result: text('result'),
    evidence: text('evidence'),
    remainingWork: text('remaining_work'),
    blocker: text('blocker'),
    nextStep: text('next_step'),
    /** Actual minutes, self-reported (not shift hours). */
    durationMinutes: integer('duration_minutes'),
    startedAt: instant('started_at'),
    endedAt: instant('ended_at'),
    correctsUpdateId: uuid('corrects_update_id')
      .references((): AnyPgColumn => opsTaskUpdates.id, { onDelete: 'restrict' })
      .$type<OpsTaskUpdateId>(),
    correctionReason: text('correction_reason'),
    isSample: boolean('is_sample').notNull().default(false),
  },
  (t) => [
    index('task_updates_author_day_idx').on(t.authorStaffId, t.occurredOn),
    index('task_updates_task_recorded_idx').on(t.taskId, t.recordedAt),
    uniqueIndex('task_updates_corrects_key')
      .on(t.correctsUpdateId)
      .where(sql`${t.correctsUpdateId} IS NOT NULL`),
    check('task_updates_work_check', sql`length(trim(${t.workPerformed})) > 0`),
    check(
      'task_updates_duration_check',
      sql`${t.durationMinutes} IS NULL OR ${t.durationMinutes} BETWEEN 1 AND 1440`,
    ),
    check(
      'task_updates_interval_check',
      sql`${t.endedAt} IS NULL OR (${t.startedAt} IS NOT NULL AND ${t.endedAt} > ${t.startedAt})`,
    ),
    check(
      'task_updates_correction_check',
      sql`${t.correctsUpdateId} IS NULL OR (${t.correctsUpdateId} <> ${t.id} AND ${filled(t.correctionReason)})`,
    ),
  ],
);

/** Task A waits on task B. Self-links are refused here; cycles are refused by the service. */
export const opsTaskDependencies = ops.table(
  'task_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: taskRef('task_id').notNull(),
    dependsOnTaskId: taskRef('depends_on_task_id').notNull(),
    createdByUserId: userRef('created_by_user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_dependencies_pair_key').on(t.taskId, t.dependsOnTaskId),
    index('task_dependencies_depends_on_idx').on(t.dependsOnTaskId),
    check('task_dependencies_not_self', sql`${t.taskId} <> ${t.dependsOnTaskId}`),
  ],
);
