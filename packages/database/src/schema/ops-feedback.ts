/**
 * OWNER: Business Ops OS — student feedback about teachers, HR side (owner brief 23 Oct 2026 §15,
 * ruling R8): file imports with row-level outcomes, edited summaries HR approves for the teacher,
 * and agreed development actions. The original feedback rows stay in
 * ops.student_teacher_feedback (ops-meetings.ts) and never reach teacher-facing code. Part of
 * the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts.
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
  filled,
  inList,
  instant,
  isoDate,
  ops,
  staffRef,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';
import { opsStudentTeacherFeedback } from './ops-meetings';

export type OpsTeacherFeedbackImportId = Brand<string, 'OpsTeacherFeedbackImportId'>;
export type OpsTeacherFeedbackSummaryId = Brand<string, 'OpsTeacherFeedbackSummaryId'>;

export const OPS_FEEDBACK_IMPORT_STATUSES = ['preview', 'committed', 'discarded'] as const;
export const OPS_FEEDBACK_IMPORT_OUTCOMES = [
  'valid',
  'invalid',
  'duplicate',
  'unresolved',
] as const;
export const OPS_FEEDBACK_SUMMARY_STATUSES = ['draft', 'approved', 'withdrawn'] as const;
export const OPS_DEVELOPMENT_ACTION_STATUSES = ['open', 'done', 'dropped'] as const;

/** One uploaded feedback file (stored as an attachment, owner_kind feedback_import). */
export const opsTeacherFeedbackImports = ops.table(
  'teacher_feedback_imports',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTeacherFeedbackImportId>(),
    sha256: text('sha256').notNull(),
    originalName: text('original_name').notNull(),
    status: text('status', { enum: OPS_FEEDBACK_IMPORT_STATUSES }).notNull().default('preview'),
    rowsTotal: integer('rows_total').notNull().default(0),
    rowsValid: integer('rows_valid').notNull().default(0),
    rowsInvalid: integer('rows_invalid').notNull().default(0),
    rowsDuplicate: integer('rows_duplicate').notNull().default(0),
    /** File column → field mapping used for the preview. */
    mapping: jsonb('mapping').$type<Record<string, string>>().notNull(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    committedAt: instant('committed_at'),
    isSample: boolean('is_sample').notNull().default(false),
  },
  (t) => [
    // A discarded preview may be uploaded again; a live or committed file only once.
    uniqueIndex('teacher_feedback_imports_sha256_key')
      .on(t.sha256)
      .where(sql`${t.status} <> 'discarded'`),
    check('teacher_feedback_imports_sha_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'teacher_feedback_imports_status_check',
      sql`${t.status} IN ${inList(OPS_FEEDBACK_IMPORT_STATUSES)}`,
    ),
    check(
      'teacher_feedback_imports_committed_check',
      sql`(${t.status} = 'committed') = (${t.committedAt} IS NOT NULL)`,
    ),
    check(
      'teacher_feedback_imports_counts_check',
      sql`LEAST(${t.rowsTotal}, ${t.rowsValid}, ${t.rowsInvalid}, ${t.rowsDuplicate}) >= 0 AND ${t.rowsValid} + ${t.rowsInvalid} + ${t.rowsDuplicate} <= ${t.rowsTotal}`,
    ),
    check('teacher_feedback_imports_name_check', filled(t.originalName)),
  ],
);

/** One file row as read, its outcome and messages; a committed valid row links its feedback. */
export const opsTeacherFeedbackImportRows = ops.table(
  'teacher_feedback_import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => opsTeacherFeedbackImports.id, { onDelete: 'cascade' })
      .$type<OpsTeacherFeedbackImportId>(),
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    outcome: text('outcome', { enum: OPS_FEEDBACK_IMPORT_OUTCOMES }).notNull(),
    messages: jsonb('messages').$type<string[]>().notNull().default([]),
    feedbackId: uuid('feedback_id').references((): AnyPgColumn => opsStudentTeacherFeedback.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    uniqueIndex('teacher_feedback_import_rows_row_key').on(t.importId, t.rowNumber),
    check('teacher_feedback_import_rows_number_check', sql`${t.rowNumber} >= 1`),
    check(
      'teacher_feedback_import_rows_outcome_check',
      sql`${t.outcome} IN ${inList(OPS_FEEDBACK_IMPORT_OUTCOMES)}`,
    ),
    check(
      'teacher_feedback_import_rows_feedback_check',
      sql`${t.feedbackId} IS NULL OR ${t.outcome} = 'valid'`,
    ),
  ],
);

/**
 * HR's edited summary of one teacher's feedback for a period. Teachers see only approved ones
 * (and only when `response_count` reaches feedback.min_group_size). The originals stay untouched.
 */
export const opsTeacherFeedbackSummaries = ops.table(
  'teacher_feedback_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTeacherFeedbackSummaryId>(),
    teacherStaffId: staffRefRestrict('teacher_staff_id').notNull(),
    periodStart: isoDate('period_start').notNull(),
    periodEnd: isoDate('period_end').notNull(),
    responseCount: integer('response_count').notNull(),
    /** Students who could have answered; null = not known (no response rate shown). */
    eligiblePopulation: integer('eligible_population'),
    ratingScaleMax: integer('rating_scale_max').notNull(),
    /** Mean and count, overall and per category key; a category with no ratings is absent, never 0. */
    categoryMeans: jsonb('category_means')
      .$type<{
        overall?: { mean: number; n: number };
        categories: Record<string, { mean: number; n: number }>;
      }>()
      .notNull(),
    strengths: text('strengths'),
    areasToImprove: text('areas_to_improve'),
    summaryText: text('summary_text'),
    status: text('status', { enum: OPS_FEEDBACK_SUMMARY_STATUSES }).notNull().default('draft'),
    approvedBy: userRef('approved_by'),
    approvedAt: instant('approved_at'),
    createdBy: userRef('created_by').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('teacher_feedback_summaries_teacher_idx').on(t.teacherStaffId, t.status),
    uniqueIndex('teacher_feedback_summaries_period_key')
      .on(t.teacherStaffId, t.periodStart, t.periodEnd)
      .where(sql`${t.status} <> 'withdrawn'`),
    check(
      'teacher_feedback_summaries_status_check',
      sql`${t.status} IN ${inList(OPS_FEEDBACK_SUMMARY_STATUSES)}`,
    ),
    check('teacher_feedback_summaries_period_check', sql`${t.periodEnd} >= ${t.periodStart}`),
    check(
      'teacher_feedback_summaries_counts_check',
      sql`${t.responseCount} >= 0 AND (${t.eligiblePopulation} IS NULL OR ${t.eligiblePopulation} >= ${t.responseCount})`,
    ),
    check('teacher_feedback_summaries_scale_check', sql`${t.ratingScaleMax} BETWEEN 2 AND 10`),
    check(
      'teacher_feedback_summaries_approved_check',
      sql`(${t.approvedAt} IS NULL) = (${t.approvedBy} IS NULL) AND (${t.status} <> 'approved' OR ${t.approvedAt} IS NOT NULL)`,
    ),
  ],
);

/** A follow-up agreed with the teacher (shown to them with the approved summary). */
export const opsTeacherDevelopmentActions = ops.table(
  'teacher_development_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teacherStaffId: staffRefRestrict('teacher_staff_id').notNull(),
    summaryId: uuid('summary_id')
      .references(() => opsTeacherFeedbackSummaries.id, { onDelete: 'restrict' })
      .$type<OpsTeacherFeedbackSummaryId>(),
    action: text('action').notNull(),
    ownerStaffId: staffRef('owner_staff_id'),
    dueOn: isoDate('due_on'),
    status: text('status', { enum: OPS_DEVELOPMENT_ACTION_STATUSES }).notNull().default('open'),
    /** When the teacher agreed it; null = not yet agreed. */
    agreedAt: instant('agreed_at'),
    createdBy: userRef('created_by').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('teacher_development_actions_teacher_idx').on(t.teacherStaffId, t.status),
    check('teacher_development_actions_action_check', filled(t.action)),
    check(
      'teacher_development_actions_status_check',
      sql`${t.status} IN ${inList(OPS_DEVELOPMENT_ACTION_STATUSES)}`,
    ),
  ],
);
