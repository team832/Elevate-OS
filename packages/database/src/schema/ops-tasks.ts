/**
 * OWNER: Business Ops OS — staff daily tasks and end-of-day (EOD) reports (owner decision
 * 21 Oct 2026, partial reversal of D-032). Part of the `ops` Postgres schema, split across
 * ops*.ts; same rules as ops.ts. Task history is the audit trail (before/after, actor, reason in
 * metadata), so there is no separate change table.
 */
import { sql } from 'drizzle-orm';
import {
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
import type { AdmissionId, Brand, LeadId } from '@elevate/shared-types';
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

export type OpsStaffTaskId = Brand<string, 'OpsStaffTaskId'>;
export type OpsEodReportId = Brand<string, 'OpsEodReportId'>;

// Mirrored in apps/business-ops-os/src/domain/staff-tasks.ts (a unit test keeps them equal).
export const OPS_TASK_STATUSES = ['pending', 'in_progress', 'done', 'blocked', 'on_hold'] as const;
export const OPS_TASK_PRIORITIES = ['high', 'medium', 'low'] as const;
export const OPS_TASK_RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const;
export const OPS_EOD_STATUSES = ['draft', 'submitted'] as const;

/**
 * Work a staff member received (call, WhatsApp, in person) and logs for one IST day. Blocked and
 * on-hold tasks carry a reason; a done task is 100% with its completion time. Completing a
 * recurring task creates its next occurrence once (`recurrence_parent_id` is unique).
 */
export const opsStaffTasks = ops.table(
  'staff_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsStaffTaskId>(),
    /** Whose task it is. */
    staffId: staffRefRestrict('staff_id').notNull(),
    title: text('title').notNull(),
    details: text('details'),
    /** Who gave the work, when recorded. */
    assignedByStaffId: staffRef('assigned_by_staff_id'),
    /** What the task is about (at most one). */
    leadId: uuid('lead_id')
      .references(() => opsLeads.id, { onDelete: 'restrict' })
      .$type<LeadId>(),
    admissionId: uuid('admission_id')
      .references(() => opsAdmissions.id, { onDelete: 'restrict' })
      .$type<AdmissionId>(),
    studentId: studentRef(),
    priority: text('priority', { enum: OPS_TASK_PRIORITIES }).notNull().default('medium'),
    /** IST due day, and optional IST time on that day. */
    dueOn: isoDate('due_on').notNull(),
    dueTime: time('due_time'),
    status: text('status', { enum: OPS_TASK_STATUSES }).notNull().default('pending'),
    progressPercent: integer('progress_percent').notNull().default(0),
    /** Why it is blocked, on hold or not done (shown in the EOD report). */
    reason: text('reason'),
    recurrence: text('recurrence', { enum: OPS_TASK_RECURRENCES }).notNull().default('none'),
    /** The completed task this occurrence follows. */
    recurrenceParentId: uuid('recurrence_parent_id')
      .references((): AnyPgColumn => opsStaffTasks.id, { onDelete: 'restrict' })
      .$type<OpsStaffTaskId>(),
    completedAt: instant('completed_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('staff_tasks_staff_due_idx').on(t.staffId, t.dueOn),
    index('staff_tasks_status_idx').on(t.status),
    uniqueIndex('staff_tasks_recurrence_parent_key')
      .on(t.recurrenceParentId)
      .where(sql`${t.recurrenceParentId} IS NOT NULL`),
    check('staff_tasks_title_check', sql`length(trim(${t.title})) > 0`),
    check('staff_tasks_status_check', sql`${t.status} IN ${inList(OPS_TASK_STATUSES)}`),
    check('staff_tasks_priority_check', sql`${t.priority} IN ${inList(OPS_TASK_PRIORITIES)}`),
    check('staff_tasks_recurrence_check', sql`${t.recurrence} IN ${inList(OPS_TASK_RECURRENCES)}`),
    check('staff_tasks_progress_check', sql`${t.progressPercent} BETWEEN 0 AND 100`),
    check(
      'staff_tasks_done_check',
      sql`(${t.status} = 'done') = (${t.completedAt} IS NOT NULL) AND (${t.status} <> 'done' OR ${t.progressPercent} = 100)`,
    ),
    check(
      'staff_tasks_reason_check',
      sql`${t.status} NOT IN ('blocked', 'on_hold') OR length(trim(coalesce(${t.reason}, ''))) > 0`,
    ),
    check(
      'staff_tasks_one_related',
      sql`num_nonnulls(${t.leadId}, ${t.admissionId}, ${t.studentId}) <= 1`,
    ),
  ],
);

/**
 * One staff member's end-of-day report for one IST day. `snapshot` is the day's tasks
 * (done, open with reasons, overdue, carried forward) as built by domain/staff-tasks.ts; it is
 * frozen when submitted. Submitted to the reporting manager (`submitted_to_staff_id`).
 */
export const opsEodReports = ops.table(
  'eod_reports',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEodReportId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    reportDate: isoDate('report_date').notNull(),
    status: text('status', { enum: OPS_EOD_STATUSES }).notNull().default('draft'),
    /** Shape: EodSnapshot (business-ops domain/staff-tasks.ts); packages cannot import app types. */
    snapshot: jsonb('snapshot').$type<object>().notNull(),
    summary: text('summary'),
    submittedAt: instant('submitted_at'),
    /** Reporting manager at submit time; null = sent to the EOD reviewers. */
    submittedToStaffId: staffRef('submitted_to_staff_id'),
    reviewedBy: userRef('reviewed_by'),
    reviewedAt: instant('reviewed_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('eod_reports_staff_date_key').on(t.staffId, t.reportDate),
    index('eod_reports_date_idx').on(t.reportDate),
    check('eod_reports_status_check', sql`${t.status} IN ${inList(OPS_EOD_STATUSES)}`),
    check(
      'eod_reports_submitted_check',
      sql`(${t.status} = 'submitted') = (${t.submittedAt} IS NOT NULL)`,
    ),
    check(
      'eod_reports_reviewed_check',
      sql`(${t.reviewedBy} IS NULL) = (${t.reviewedAt} IS NULL) AND (${t.reviewedAt} IS NULL OR ${t.status} = 'submitted')`,
    ),
  ],
);
