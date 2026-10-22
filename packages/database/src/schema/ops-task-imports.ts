/**
 * OWNER: Business Ops OS — imports of the original task tracker's backup files (owner brief 2
 * §13). A batch is one source file for one reviewed staff mapping (never matched by name); each
 * legacy record gets one row saying what happened to it. Re-importing the same file for the same
 * person is refused by the unique key; a newer export matches tasks by `staff_tasks.legacy_ref`.
 * Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Brand } from '@elevate/shared-types';
import { createdAt, inList, instant, ops, staffRefRestrict, userRef } from './ops-columns';
import { opsEodReports, type OpsEodReportId } from './ops-eod';
import { opsStaffTasks, type OpsStaffTaskId } from './ops-tasks';

export type OpsTaskImportBatchId = Brand<string, 'OpsTaskImportBatchId'>;

export const OPS_TASK_IMPORT_SOURCE_KINDS = ['deskday_backup_json'] as const;
export const OPS_TASK_IMPORT_STATUSES = ['previewed', 'committed', 'failed'] as const;
export const OPS_TASK_IMPORT_ROW_KINDS = ['task', 'report'] as const;
export const OPS_TASK_IMPORT_OUTCOMES = [
  'accepted',
  'skipped',
  'changed',
  'duplicate',
  'unresolved',
  'failed',
] as const;
export type OpsTaskImportOutcome = (typeof OPS_TASK_IMPORT_OUTCOMES)[number];

export const opsTaskImportBatches = ops.table(
  'task_import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTaskImportBatchId>(),
    sourceFilename: text('source_filename').notNull(),
    sourceSha256: text('source_sha256').notNull(),
    sourceKind: text('source_kind', { enum: OPS_TASK_IMPORT_SOURCE_KINDS })
      .notNull()
      .default('deskday_backup_json'),
    /** Version or export date stated by the source, when it states one (never guessed). */
    sourceVersion: text('source_version'),
    /** The staff member the file belongs to (a reviewed mapping). */
    staffId: staffRefRestrict('staff_id').notNull(),
    status: text('status', { enum: OPS_TASK_IMPORT_STATUSES }).notNull().default('previewed'),
    /** Parsed and per-outcome counts. */
    counts: jsonb('counts')
      .$type<Partial<Record<OpsTaskImportOutcome | 'parsed', number>>>()
      .notNull()
      .default({}),
    /** Protected copy of the parsed source file (read only with ops:tasks:import). */
    raw: jsonb('raw').$type<unknown>().notNull(),
    /** A fictional fixture import (D-036), removed with the sample data. */
    isSample: boolean('is_sample').notNull().default(false),
    createdByUserId: userRef('created_by_user_id').notNull(),
    createdAt: createdAt(),
    committedAt: instant('committed_at'),
    committedByUserId: userRef('committed_by_user_id'),
  },
  (t) => [
    uniqueIndex('task_import_batches_source_staff_key').on(t.sourceSha256, t.staffId),
    check('task_import_batches_sha_check', sql`${t.sourceSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'task_import_batches_kind_check',
      sql`${t.sourceKind} IN ${inList(OPS_TASK_IMPORT_SOURCE_KINDS)}`,
    ),
    check(
      'task_import_batches_status_check',
      sql`${t.status} IN ${inList(OPS_TASK_IMPORT_STATUSES)}`,
    ),
    check(
      'task_import_batches_committed_check',
      sql`(${t.status} = 'committed') = (${t.committedAt} IS NOT NULL) AND (${t.committedAt} IS NULL) = (${t.committedByUserId} IS NULL)`,
    ),
  ],
);

/** One legacy record of a batch and its outcome (the reconciliation report reads these). */
export const opsTaskImportRows = ops.table(
  'task_import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .references(() => opsTaskImportBatches.id, { onDelete: 'restrict' })
      .$type<OpsTaskImportBatchId>()
      .notNull(),
    kind: text('kind', { enum: OPS_TASK_IMPORT_ROW_KINDS }).notNull(),
    legacyId: text('legacy_id').notNull(),
    /** Hash of the legacy record, to tell an unchanged record from a changed one. */
    contentHash: text('content_hash').notNull(),
    outcome: text('outcome', { enum: OPS_TASK_IMPORT_OUTCOMES }).notNull(),
    taskId: uuid('task_id')
      .references(() => opsStaffTasks.id, { onDelete: 'restrict' })
      .$type<OpsStaffTaskId>(),
    eodReportId: uuid('eod_report_id')
      .references(() => opsEodReports.id, { onDelete: 'restrict' })
      .$type<OpsEodReportId>(),
    message: text('message'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_import_rows_batch_record_key').on(t.batchId, t.kind, t.legacyId),
    index('task_import_rows_task_idx').on(t.taskId),
    check('task_import_rows_kind_check', sql`${t.kind} IN ${inList(OPS_TASK_IMPORT_ROW_KINDS)}`),
    check(
      'task_import_rows_outcome_check',
      sql`${t.outcome} IN ${inList(OPS_TASK_IMPORT_OUTCOMES)}`,
    ),
    check(
      'task_import_rows_target_check',
      sql`(${t.kind} = 'task' AND ${t.eodReportId} IS NULL) OR (${t.kind} = 'report' AND ${t.taskId} IS NULL)`,
    ),
  ],
);
