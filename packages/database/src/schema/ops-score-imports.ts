/**
 * OWNER: Business Ops OS — score imports for a test (owner brief 23 Oct 2026 §20). A file (CSV or
 * a PDF read with AI) or a manual sheet is staged row by row, matched to the test's roster and
 * reviewed; confirming writes marks to the one Academic record through its internal routes. The
 * pure rules are apps/business-ops-os/src/domain/score-import*.ts; these columns hold their
 * results. Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts.
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
} from 'drizzle-orm/pg-core';
import type { Brand } from '@elevate/shared-types';
import { createdAt, filled, inList, instant, ops, updatedAt, userRef } from './ops-columns';
import { opsAttachments, type OpsAttachmentId } from './ops-attachments';

export type OpsScoreImportId = Brand<string, 'OpsScoreImportId'>;

export const OPS_SCORE_IMPORT_SOURCES = ['csv', 'pdf_ai', 'manual'] as const;
export const OPS_SCORE_IMPORT_STATUSES = [
  'uploaded',
  'staged',
  'in_review',
  'confirmed',
  'cancelled',
  'failed',
] as const;
// Mirrors MatchStatus, MatchBasis and Change in the domain (score-import-match/validate.ts).
export const OPS_SCORE_MATCH_STATUSES = [
  'matched',
  'suggested',
  'ambiguous',
  'unmatched',
  'duplicate',
] as const;
export const OPS_SCORE_MATCH_BASES = [
  'admission_number',
  'student_code',
  'exact_name',
  'none',
] as const;
export const OPS_SCORE_ROW_RESOLUTIONS = ['matched', 'skip'] as const;
export const OPS_SCORE_ROW_CHANGES = ['new', 'no_change', 'overwrite', 'not_entered'] as const;

/**
 * One import into one test. A file may be imported into a test once (a cancelled or failed
 * import may be tried again). Manual imports have no file.
 */
export const opsScoreImports = ops.table(
  'score_imports',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsScoreImportId>(),
    /** The Academic test (academic.assessments); another module, so no FK. */
    assessmentId: uuid('assessment_id').notNull(),
    /** The uploaded file (owner_kind score_import). */
    attachmentId: uuid('attachment_id')
      .references(() => opsAttachments.id, { onDelete: 'restrict' })
      .$type<OpsAttachmentId>(),
    source: text('source', { enum: OPS_SCORE_IMPORT_SOURCES }).notNull(),
    status: text('status', { enum: OPS_SCORE_IMPORT_STATUSES }).notNull().default('uploaded'),
    sha256: text('sha256'),
    /** File column → score field (domain ScoreMapping). */
    mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
    rowsTotal: integer('rows_total').notNull().default(0),
    /** Review counts by match status, change and `withErrors` (domain ScoreImportReview.counts). */
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    /** Why parsing or extraction failed, in plain words. */
    error: text('error'),
    createdBy: userRef('created_by').notNull(),
    confirmedBy: userRef('confirmed_by'),
    confirmedAt: instant('confirmed_at'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('score_imports_assessment_idx').on(t.assessmentId, t.createdAt),
    uniqueIndex('score_imports_file_key')
      .on(t.assessmentId, t.sha256)
      .where(sql`${t.status} NOT IN ('cancelled', 'failed')`),
    check('score_imports_source_check', sql`${t.source} IN ${inList(OPS_SCORE_IMPORT_SOURCES)}`),
    check('score_imports_status_check', sql`${t.status} IN ${inList(OPS_SCORE_IMPORT_STATUSES)}`),
    check(
      'score_imports_file_check',
      sql`(${t.source} = 'manual') = (${t.attachmentId} IS NULL) AND (${t.attachmentId} IS NULL) = (${t.sha256} IS NULL) AND (${t.sha256} IS NULL OR ${t.sha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'score_imports_confirmed_check',
      sql`(${t.status} = 'confirmed') = (${t.confirmedAt} IS NOT NULL) AND (${t.confirmedAt} IS NULL) = (${t.confirmedBy} IS NULL)`,
    ),
    check('score_imports_error_check', sql`${t.status} <> 'failed' OR ${filled(t.error)}`),
    check('score_imports_rows_check', sql`${t.rowsTotal} >= 0`),
  ],
);

/**
 * One staged row: the cells as read, the parsed values (domain StagedRow: identifiers, attendance,
 * marks in units of 1/10 000), the roster match and what confirming it would change.
 * `roster_entry_id` / `student_id` = the matcher's match, or the student a person chose
 * (`resolution` matched); `candidates` = suggestions, never a match by themselves.
 */
export const opsScoreImportRows = ops.table(
  'score_import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => opsScoreImports.id, { onDelete: 'cascade' })
      .$type<OpsScoreImportId>(),
    rowNo: integer('row_no').notNull(),
    original: jsonb('original').$type<Record<string, string>>().notNull(),
    parsed: jsonb('parsed').$type<Record<string, unknown>>().notNull(),
    matchStatus: text('match_status', { enum: OPS_SCORE_MATCH_STATUSES }).notNull(),
    matchBasis: text('match_basis', { enum: OPS_SCORE_MATCH_BASES }).notNull().default('none'),
    /** Academic roster entry and student (another module, no FK). */
    rosterEntryId: uuid('roster_entry_id'),
    studentId: uuid('student_id'),
    candidates: jsonb('candidates').$type<Record<string, unknown>[]>().notNull().default([]),
    resolution: text('resolution', { enum: OPS_SCORE_ROW_RESOLUTIONS }),
    change: text('change', { enum: OPS_SCORE_ROW_CHANGES }),
    /** A person checked this AI-extracted row against the document. */
    aiConfirmed: boolean('ai_confirmed').notNull().default(false),
    /** A person confirmed this row may change a verified result. */
    overwriteConfirmed: boolean('overwrite_confirmed').notNull().default(false),
    /** Blocking issues (domain Issue[]). */
    errors: jsonb('errors').$type<{ code: string; message: string }[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex('score_import_rows_row_key').on(t.importId, t.rowNo),
    index('score_import_rows_status_idx').on(t.importId, t.matchStatus),
    check('score_import_rows_number_check', sql`${t.rowNo} >= 1`),
    check(
      'score_import_rows_match_status_check',
      sql`${t.matchStatus} IN ${inList(OPS_SCORE_MATCH_STATUSES)}`,
    ),
    check(
      'score_import_rows_match_basis_check',
      sql`${t.matchBasis} IN ${inList(OPS_SCORE_MATCH_BASES)}`,
    ),
    check(
      'score_import_rows_resolution_check',
      sql`${t.resolution} IS NULL OR ${t.resolution} IN ${inList(OPS_SCORE_ROW_RESOLUTIONS)}`,
    ),
    check(
      'score_import_rows_change_check',
      sql`${t.change} IS NULL OR ${t.change} IN ${inList(OPS_SCORE_ROW_CHANGES)}`,
    ),
    check(
      'score_import_rows_student_check',
      sql`(${t.rosterEntryId} IS NULL) = (${t.studentId} IS NULL) AND (${t.studentId} IS NOT NULL OR (${t.matchStatus} NOT IN ('matched', 'duplicate') AND ${t.resolution} IS DISTINCT FROM 'matched' AND ${t.change} IS NULL))`,
    ),
    check(
      'score_import_rows_overwrite_check',
      sql`NOT ${t.overwriteConfirmed} OR ${t.change} = 'overwrite'`,
    ),
  ],
);
