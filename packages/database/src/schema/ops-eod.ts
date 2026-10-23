/**
 * OWNER: Business Ops OS — end-of-day (EOD) reports: the report identity, its immutable submitted
 * versions and the manager's review trail (owner brief 2 §9–11). Part of the `ops` Postgres
 * schema, split across ops*.ts; same rules as ops.ts.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Brand } from '@elevate/shared-types';
import {
  createdAt,
  inList,
  instant,
  isoDate,
  ops,
  staffRef,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';
import { opsStaffTasks, type OpsStaffTaskId } from './ops-tasks';

export type OpsEodReportId = Brand<string, 'OpsEodReportId'>;
export type OpsEodReportVersionId = Brand<string, 'OpsEodReportVersionId'>;
export type OpsEodReviewEventId = Brand<string, 'OpsEodReviewEventId'>;

// Mirrored in apps/business-ops-os/src/domain/staff-tasks.ts (a unit test keeps them equal).
export const OPS_EOD_STATUSES = [
  'draft',
  'submitted',
  'revision_requested',
  'acknowledged',
] as const;
/** Report period (ruling R7): one table for EOD, weekly and monthly work reports. */
export const OPS_REPORT_PERIOD_KINDS = ['day', 'week', 'month'] as const;
export const OPS_EOD_REVIEW_EVENT_KINDS = [
  'viewed',
  'comment',
  'clarification_requested',
  'revision_requested',
  'acknowledged',
  'follow_up_task_created',
] as const;

/** Employee-written parts of a submitted version. */
export interface OpsEodNarrative {
  summary: string | null;
  nextDayPlan: string | null;
  notes: string | null;
}

/**
 * One staff member's work report for one period — the report identity (one per staff member,
 * period kind and start). Day = the EOD report (`report_date` = the day; null for week / month so
 * day-only readers never pick up a period report); week = 7 days from `period_start`; month =
 * a calendar month. The row holds the working draft; each submission freezes a version in
 * `eod_report_versions` (`current_version` = latest submitted, 0 = never submitted).
 * `submitted_at` is the latest submission. `version` is bumped on every write (concurrency).
 */
export const opsEodReports = ops.table(
  'eod_reports',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEodReportId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    periodKind: text('period_kind', { enum: OPS_REPORT_PERIOD_KINDS }).notNull().default('day'),
    periodStart: isoDate('period_start').notNull(),
    periodEnd: isoDate('period_end').notNull(),
    reportDate: isoDate('report_date'),
    status: text('status', { enum: OPS_EOD_STATUSES }).notNull().default('draft'),
    /** Shape: EodSnapshot (business-ops domain/staff-tasks.ts); packages cannot import app types. */
    snapshot: jsonb('snapshot').$type<object>().notNull(),
    summary: text('summary'),
    nextDayPlan: text('next_day_plan'),
    notes: text('notes'),
    currentVersion: integer('current_version').notNull().default(0),
    submittedAt: instant('submitted_at'),
    /** Reporting manager at submit time; null = sent to the EOD reviewers. */
    submittedToStaffId: staffRef('submitted_to_staff_id'),
    reviewedBy: userRef('reviewed_by'),
    reviewedAt: instant('reviewed_at'),
    isSample: boolean('is_sample').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('eod_reports_staff_period_key').on(t.staffId, t.periodKind, t.periodStart),
    index('eod_reports_date_idx').on(t.reportDate),
    index('eod_reports_period_idx').on(t.periodKind, t.periodStart),
    check(
      'eod_reports_period_kind_check',
      sql`${t.periodKind} IN ${inList(OPS_REPORT_PERIOD_KINDS)}`,
    ),
    check(
      'eod_reports_period_check',
      sql`(${t.periodKind} = 'day') = (${t.reportDate} IS NOT NULL) AND (${t.reportDate} IS NULL OR ${t.reportDate} = ${t.periodStart}) AND CASE ${t.periodKind} WHEN 'day' THEN ${t.periodEnd} = ${t.periodStart} WHEN 'week' THEN ${t.periodEnd} = ${t.periodStart} + 6 ELSE extract(day FROM ${t.periodStart}) = 1 AND ${t.periodEnd} = (${t.periodStart} + interval '1 month' - interval '1 day')::date END`,
    ),
    check('eod_reports_status_check', sql`${t.status} IN ${inList(OPS_EOD_STATUSES)}`),
    check('eod_reports_submitted_check', sql`(${t.status} = 'draft') = (${t.submittedAt} IS NULL)`),
    check(
      'eod_reports_reviewed_check',
      sql`(${t.reviewedBy} IS NULL) = (${t.reviewedAt} IS NULL) AND (${t.reviewedAt} IS NULL OR ${t.status} <> 'draft')`,
    ),
    check('eod_reports_version_check', sql`${t.currentVersion} >= 0 AND ${t.version} >= 1`),
  ],
);

const reportRef = () =>
  uuid('report_id')
    .references(() => opsEodReports.id, { onDelete: 'restrict' })
    .$type<OpsEodReportId>()
    .notNull();

/**
 * A submitted EOD version: an immutable snapshot of the facts at `source_cutoff_at` plus the
 * employee's narrative. A revision is a new version linked to the one it revises; later source
 * corrections never rewrite a sent version.
 */
export const opsEodReportVersions = ops.table(
  'eod_report_versions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEodReportVersionId>(),
    reportId: reportRef(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<object>().notNull(),
    narrative: jsonb('narrative').$type<OpsEodNarrative>().notNull(),
    /** Events and updates up to this instant are in the snapshot. */
    sourceCutoffAt: instant('source_cutoff_at').notNull(),
    submittedAt: instant('submitted_at').notNull().defaultNow(),
    submittedByUserId: userRef('submitted_by_user_id').notNull(),
    /** Resolved recipient; null = sent to the EOD reviewers. */
    submittedToStaffId: staffRef('submitted_to_staff_id'),
    revisionOfVersionId: uuid('revision_of_version_id')
      .references((): AnyPgColumn => opsEodReportVersions.id, { onDelete: 'restrict' })
      .$type<OpsEodReportVersionId>(),
    /** The revision request this version answers. */
    revisionRequestEventId: uuid('revision_request_event_id')
      .references((): AnyPgColumn => opsEodReviewEvents.id, { onDelete: 'restrict' })
      .$type<OpsEodReviewEventId>(),
  },
  (t) => [
    uniqueIndex('eod_report_versions_report_version_key').on(t.reportId, t.version),
    check(
      'eod_report_versions_revision_check',
      sql`${t.version} >= 1 AND (${t.version} = 1) = (${t.revisionOfVersionId} IS NULL)`,
    ),
  ],
);

/** The manager side of an EOD: views, comments, requests, acknowledgement, follow-up tasks. */
export const opsEodReviewEvents = ops.table(
  'eod_review_events',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsEodReviewEventId>(),
    reportId: reportRef(),
    versionId: uuid('version_id')
      .references((): AnyPgColumn => opsEodReportVersions.id, { onDelete: 'restrict' })
      .$type<OpsEodReportVersionId>(),
    kind: text('kind', { enum: OPS_EOD_REVIEW_EVENT_KINDS }).notNull(),
    actorUserId: userRef('actor_user_id').notNull(),
    text: text('text'),
    /** The follow-up task created from the report. */
    taskId: uuid('task_id')
      .references(() => opsStaffTasks.id, { onDelete: 'restrict' })
      .$type<OpsStaffTaskId>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('eod_review_events_report_created_idx').on(t.reportId, t.createdAt),
    check('eod_review_events_kind_check', sql`${t.kind} IN ${inList(OPS_EOD_REVIEW_EVENT_KINDS)}`),
    check(
      'eod_review_events_text_check',
      sql`${t.kind} NOT IN ('comment', 'clarification_requested', 'revision_requested') OR length(trim(coalesce(${t.text}, ''))) > 0`,
    ),
    check(
      'eod_review_events_task_check',
      sql`(${t.kind} = 'follow_up_task_created') = (${t.taskId} IS NOT NULL)`,
    ),
  ],
);
