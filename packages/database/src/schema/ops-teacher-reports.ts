/**
 * OWNER: Business Ops OS — teacher reports (owner brief 22 Oct 2026: "pull out any teacher in
 * business operations … beautifully generated … put that format in our database"). Part of the
 * `ops` Postgres schema, split across ops*.ts; same rules as ops.ts. An internal document:
 * generate → stored snapshot → download. No draft/review workflow (unlike student reports).
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Brand } from '@elevate/shared-types';
import { createdAt, inList, isoDate, ops, staffRefRestrict, userRef } from './ops-columns';

export type OpsTeacherReportExportId = Brand<string, 'OpsTeacherReportExportId'>;
/** `internal` only; a shareable one-pager is proposed, not built. */
export const OPS_TEACHER_REPORT_KINDS = ['internal'] as const;

export const opsTeacherReportExports = ops.table(
  'teacher_report_exports',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTeacherReportExportId>(),
    staffId: staffRefRestrict('staff_id').notNull(),
    /** Printed on the report, e.g. TR-0A1B2C3D4E. */
    referenceCode: text('reference_code').notNull(),
    kind: text('kind', { enum: OPS_TEACHER_REPORT_KINDS }).notNull().default('internal'),
    /** First and last day of the reporting period (IST). */
    periodFrom: isoDate('period_from').notNull(),
    periodTo: isoDate('period_to').notNull(),
    /** Report template version, e.g. teacher-report/1. */
    templateVersion: text('template_version').notNull(),
    /** Content as generated, cut to the generator's permissions; rendered later unchanged. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    /** SHA-256 (hex) of the stored snapshot JSON. */
    snapshotSha256: text('snapshot_sha256').notNull(),
    /** Where the content came from (Academic check time, review keys, task-report cut-off). */
    sourceRefs: jsonb('source_refs').$type<Record<string, unknown>>(),
    generatedBy: userRef('generated_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('teacher_report_exports_reference_key').on(t.referenceCode),
    index('teacher_report_exports_staff_idx').on(t.staffId, t.createdAt),
    check('teacher_report_exports_period_check', sql`${t.periodFrom} <= ${t.periodTo}`),
    check('teacher_report_exports_reference_format', sql`${t.referenceCode} ~ '^TR-[0-9A-Z]{10}$'`),
    check(
      'teacher_report_exports_kind_check',
      sql`${t.kind} IN ${inList(OPS_TEACHER_REPORT_KINDS)}`,
    ),
    check('teacher_report_exports_sha256_format', sql`${t.snapshotSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
