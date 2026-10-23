/**
 * OWNER: Business Ops OS — staff tasks: the task, its dated history (`task_events`), work updates
 * and dependencies (owner decision 21 Oct 2026, partial reversal of D-032; owner brief 2 §5–6).
 * Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts. EOD reports are
 * in ops-eod.ts, tracker imports in ops-task-imports.ts, checklist / submissions / reviews /
 * collaborators in ops-task-work.ts. Ownership history = `reassigned` events.
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
  filled,
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
/**
 * Lifecycle (brief 23 Oct 2026 §10, ruling R4): draft → pending ("Assigned") → in_progress →
 * in_review ("Submitted") → done ("Approved"), plus changes_requested and cancelled.
 * Acknowledgement and blocked/on-hold are not statuses (acknowledged_at, blocked_* columns);
 * overdue is computed.
 */
export const OPS_TASK_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'in_review',
  'cancelled',
  'draft',
  'changes_requested',
] as const;
/** Statuses task_events may hold: today's plus the retired `blocked` / `on_hold` (history). */
export const OPS_TASK_EVENT_STATUSES = [...OPS_TASK_STATUSES, 'blocked', 'on_hold'] as const;
export const OPS_TASK_BLOCK_KINDS = ['blocked', 'on_hold'] as const;
/**
 * Records a task is about (plain UUIDs, no FK); lead / admission / student use their FK columns.
 * `test` = an Academic assessment, `hr_request` = ops.hr_requests (0016).
 */
export const OPS_TASK_RELATED_KINDS = [
  'batch',
  'subject',
  'campaign',
  'event',
  'test',
  'hr_request',
] as const;
export const OPS_TASK_REMINDER_KINDS = ['due_soon', 'overdue', 'unacknowledged'] as const;
export const OPS_TASK_VISIBILITIES = ['assignee_chain', 'department', 'collaborators'] as const;
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
  'blocked_set',
  'blocked_cleared',
  'checklist_changed',
  'collaborator_added',
  'delivered',
] as const;

/**
 * Work a staff member received (manager, HR, self, verbal request, another module, import) and
 * logs by IST day. One accountable owner (`staff_id`); the backup owner is not accountable unless
 * reassigned. Work for several people = one child task each under `parent_task_id` (each tracked
 * on its own). A cancelled task carries a reason; the blocked flag carries kind, reason and time
 * and keeps the status. A done task is 100% with its completion time. `original_due_*` never
 * change; `due_*` is the deadline in force. Completing a recurring task creates its next occurrence once
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
    /** Batch, subject, campaign or event the task is about (other module's UUID; no FK). */
    relatedKind: text('related_kind', { enum: OPS_TASK_RELATED_KINDS }),
    relatedId: uuid('related_id'),
    /** Label as shown when linked (e.g. "IPMAT-C12-APR27 · QUANT"). */
    relatedLabel: text('related_label'),
    category: text('category'),
    expectedDeliverable: text('expected_deliverable'),
    parentTaskId: uuid('parent_task_id')
      .references((): AnyPgColumn => opsStaffTasks.id, { onDelete: 'restrict' })
      .$type<OpsStaffTaskId>(),
    visibility: text('visibility', { enum: OPS_TASK_VISIBILITIES })
      .notNull()
      .default('assignee_chain'),
    priority: text('priority', { enum: OPS_TASK_PRIORITIES }).notNull().default('medium'),
    /** When the work was received (UTC). */
    receivedAt: instant('received_at').notNull().defaultNow(),
    plannedStartOn: isoDate('planned_start_on'),
    /** IST due day, and optional IST time on that day. */
    dueOn: isoDate('due_on').notNull(),
    dueTime: time('due_time'),
    /** Deadline when the task was created; never changes (brief §10). */
    originalDueOn: isoDate('original_due_on').notNull(),
    originalDueTime: time('original_due_time'),
    status: text('status', { enum: OPS_TASK_STATUSES }).notNull().default('pending'),
    /** Self-reported progress; never derived from elapsed time. */
    progressPercent: integer('progress_percent').notNull().default(0),
    /** Why it is cancelled or not done (shown in the EOD report). */
    reason: text('reason'),
    /** Blocked flag: set with kind and reason, cleared together; the status is kept. */
    blockedAt: instant('blocked_at'),
    blockedKind: text('blocked_kind', { enum: OPS_TASK_BLOCK_KINDS }),
    blockedReason: text('blocked_reason'),
    /** First and latest submission for review (on-time is judged on the first, R5). */
    firstSubmittedAt: instant('first_submitted_at'),
    lastSubmittedAt: instant('last_submitted_at'),
    approvedAt: instant('approved_at'),
    /** When the assignee's in-app notification was created. */
    deliveredAt: instant('delivered_at'),
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
    index('staff_tasks_staff_status_idx').on(t.staffId, t.status),
    index('staff_tasks_parent_idx')
      .on(t.parentTaskId)
      .where(sql`${t.parentTaskId} IS NOT NULL`),
    index('staff_tasks_related_idx')
      .on(t.relatedKind, t.relatedId)
      .where(sql`${t.relatedId} IS NOT NULL`),
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
    check('staff_tasks_reason_check', sql`${t.status} <> 'cancelled' OR ${filled(t.reason)}`),
    check(
      'staff_tasks_blocked_kind_check',
      sql`${t.blockedKind} IS NULL OR ${t.blockedKind} IN ${inList(OPS_TASK_BLOCK_KINDS)}`,
    ),
    check(
      'staff_tasks_blocked_check',
      sql`(${t.blockedAt} IS NULL) = (${t.blockedKind} IS NULL) AND (${t.blockedAt} IS NULL) = (${t.blockedReason} IS NULL) AND (${t.blockedReason} IS NULL OR ${filled(t.blockedReason)})`,
    ),
    check(
      'staff_tasks_submitted_check',
      sql`(${t.firstSubmittedAt} IS NULL) = (${t.lastSubmittedAt} IS NULL) AND (${t.lastSubmittedAt} IS NULL OR ${t.lastSubmittedAt} >= ${t.firstSubmittedAt}) AND (${t.status} <> 'in_review' OR ${t.lastSubmittedAt} IS NOT NULL)`,
    ),
    check(
      'staff_tasks_related_kind_check',
      sql`${t.relatedKind} IS NULL OR ${t.relatedKind} IN ${inList(OPS_TASK_RELATED_KINDS)}`,
    ),
    check(
      'staff_tasks_related_check',
      sql`(${t.relatedKind} IS NULL) = (${t.relatedId} IS NULL) AND (${t.relatedLabel} IS NULL OR ${t.relatedId} IS NOT NULL)`,
    ),
    check('staff_tasks_visibility_check', sql`${t.visibility} IN ${inList(OPS_TASK_VISIBILITIES)}`),
    check(
      'staff_tasks_not_own_parent',
      sql`${t.parentTaskId} IS NULL OR ${t.parentTaskId} <> ${t.id}`,
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
      sql`num_nonnulls(${t.leadId}, ${t.admissionId}, ${t.studentId}, ${t.relatedId}) <= 1`,
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
    fromStatus: text('from_status', { enum: OPS_TASK_EVENT_STATUSES }),
    toStatus: text('to_status', { enum: OPS_TASK_EVENT_STATUSES }),
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
      sql`(${t.fromStatus} IS NULL OR ${t.fromStatus} IN ${inList(OPS_TASK_EVENT_STATUSES)}) AND (${t.toStatus} IS NULL OR ${t.toStatus} IN ${inList(OPS_TASK_EVENT_STATUSES)})`,
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
      sql`${t.kind} NOT IN ('clarification_requested', 'changes_requested', 'reopened', 'cancelled', 'blocked_set') OR ${filled(t.reason)}`,
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

/**
 * One reminder sent to one person about one task in one window (e.g. the IST day, or the
 * interval number from setting `tasks.reminders`). The unique key suppresses duplicates.
 */
export const opsTaskReminders = ops.table(
  'task_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => opsStaffTasks.id, { onDelete: 'cascade' })
      .$type<OpsStaffTaskId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    kind: text('kind', { enum: OPS_TASK_REMINDER_KINDS }).notNull(),
    windowKey: text('window_key').notNull(),
    sentAt: instant('sent_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('task_reminders_window_key').on(t.taskId, t.staffId, t.kind, t.windowKey),
    check('task_reminders_kind_check', sql`${t.kind} IN ${inList(OPS_TASK_REMINDER_KINDS)}`),
    check('task_reminders_window_check', filled(t.windowKey)),
  ],
);
