/**
 * OWNER: Academic OS team (owner answer 1, 23 Oct 2026: tests are ONE record in Academic).
 *
 * Assessment administration for the Business Ops Tests and Mock Tests section (brief §17–21):
 * eligible batches, the roster snapshot (population, attendance, marks state, verified score)
 * and result publication versions. Business Ops writes these only through Academic internal
 * routes. Same rules as academic-assessments.ts.
 *
 * Roster-managed assessment = `assessments.roster_snapshot_at` is set. Then the roster, not
 * placements and not attempts, is the population and the one place attendance, marks state and
 * totals are written; attempts keep per-question responses and, at finalisation, a mirror of
 * the roster (verified present → submitted, absent → absent, excused → exempt, else withheld).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { BatchId, Brand, StudentId, UserId } from '@elevate/shared-types';
import { academic, createdAt, inList, updatedAt } from './academic-columns';
import { academicBatches, academicStudents } from './academic';
import {
  academicAssessments,
  academicResultRuns,
  type AcademicAssessmentId,
  type AcademicResultRunId,
} from './academic-assessments';
import { users } from './core';

export type AcademicRosterEntryId = Brand<string, 'AcademicRosterEntryId'>;
export type AcademicPublicationId = Brand<string, 'AcademicPublicationId'>;

export const ACADEMIC_ROSTER_ATTENDANCE = ['unmarked', 'present', 'absent', 'excused'] as const;
export const ACADEMIC_ROSTER_MARKS_STATES = ['not_entered', 'imported', 'verified'] as const;
export const ACADEMIC_RANKING_SCOPES = ['roster', 'cohort'] as const;
export const ACADEMIC_TIE_POLICIES = ['competition'] as const;
export const ACADEMIC_PUBLICATION_STATUSES = ['current', 'superseded', 'withdrawn'] as const;

/** Roster counts frozen at publication (shape of shared-contracts `RosterCounts`). */
export type AcademicRosterCounts = Record<
  | 'active'
  | 'present'
  | 'absent'
  | 'excused'
  | 'unmarked'
  | 'notEntered'
  | 'imported'
  | 'verified'
  | 'removed',
  number
>;

/**
 * Eligible batches. Roster-managed assessments list every batch here, including the primary
 * one kept in `assessments.batch_id` (old readers and teacher scope use it). An assessment
 * with no rows here is a pre-0016 one: its only batch is `batch_id`.
 */
export const academicAssessmentBatches = academic.table(
  'assessment_batches',
  {
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => academicAssessments.id, { onDelete: 'cascade' })
      .$type<AcademicAssessmentId>(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'assessment_batches_pkey', columns: [t.assessmentId, t.batchId] }),
    index('assessment_batches_batch_idx').on(t.batchId),
  ],
);

/**
 * The roster snapshot (§18): one row per student taken from the eligible batches' placements on
 * the scheduled date; later batch changes never rewrite it. Corrections add, remove (kept, with
 * a reason) or restore rows. Present with 0 is a verified score of 0; absent/excused carry no
 * score; a missing score is never 0. `rank` is the rank in the current publication.
 */
export const academicAssessmentRoster = academic.table(
  'assessment_roster',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicRosterEntryId>(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => academicAssessments.id, { onDelete: 'restrict' })
      .$type<AcademicAssessmentId>(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    /** The batch the student sat with, at snapshot time. */
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    /** Ops admission number copied at snapshot (display/matching aid; identity = student_id). */
    admissionNumberSnapshot: text('admission_number_snapshot'),
    displayNameSnapshot: text('display_name_snapshot').notNull(),
    attendance: text('attendance', { enum: ACADEMIC_ROSTER_ATTENDANCE })
      .notNull()
      .default('unmarked'),
    marksState: text('marks_state', { enum: ACADEMIC_ROSTER_MARKS_STATES })
      .notNull()
      .default('not_entered'),
    /** Exact total, numeric(10,4) like every academic mark (domain/marks.ts units). */
    score: numeric('score', { precision: 10, scale: 4 }),
    rank: integer('rank'),
    /** Optimistic lock for markers and imports (stale → 409). */
    version: integer('version').notNull().default(1),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    /** Set on rows added by a correction after the snapshot. */
    addedReason: text('added_reason'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedReason: text('removed_reason'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assessment_roster_student_key').on(t.assessmentId, t.studentId),
    index('assessment_roster_student_idx').on(t.studentId),
    check(
      'assessment_roster_attendance_check',
      sql`${t.attendance} IN (${inList(ACADEMIC_ROSTER_ATTENDANCE)})`,
    ),
    check(
      'assessment_roster_marks_state_check',
      sql`${t.marksState} IN (${inList(ACADEMIC_ROSTER_MARKS_STATES)})`,
    ),
    check(
      'assessment_roster_score_shape',
      sql`(${t.marksState} = 'not_entered') = (${t.score} IS NULL)`,
    ),
    check(
      'assessment_roster_absent_no_score',
      sql`${t.attendance} NOT IN ('absent', 'excused') OR ${t.score} IS NULL`,
    ),
    check(
      'assessment_roster_verified_present',
      sql`${t.marksState} <> 'verified' OR ${t.attendance} = 'present'`,
    ),
    check(
      'assessment_roster_verified_stamp',
      sql`(${t.marksState} = 'verified') = (${t.verifiedAt} IS NOT NULL) AND (${t.verifiedAt} IS NULL) = (${t.verifiedByUserId} IS NULL)`,
    ),
    check(
      'assessment_roster_rank_shape',
      sql`${t.rank} IS NULL OR (${t.rank} >= 1 AND ${t.marksState} = 'verified' AND ${t.removedAt} IS NULL)`,
    ),
    check(
      'assessment_roster_removed_pair',
      sql`(${t.removedAt} IS NULL) = (${t.removedReason} IS NULL)`,
    ),
    check('assessment_roster_version_positive', sql`${t.version} >= 1`),
  ],
);

/**
 * Result publication versions (§21). Publishing makes a final result run visible with a ranking
 * scope; a new version supersedes the current one; withdrawal needs a reason. At most one
 * `current` per assessment. `completeness` freezes the roster counts at publication.
 */
export const academicResultPublications = academic.table(
  'result_publications',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicPublicationId>(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => academicAssessments.id, { onDelete: 'restrict' })
      .$type<AcademicAssessmentId>(),
    version: integer('version').notNull(),
    resultRunId: uuid('result_run_id')
      .notNull()
      .references(() => academicResultRuns.id, { onDelete: 'restrict' })
      .$type<AcademicResultRunId>(),
    rankingScope: text('ranking_scope', { enum: ACADEMIC_RANKING_SCOPES })
      .notNull()
      .default('roster'),
    /** Cohort scope only: the batches ranked together (uuid[] like assessments.chapter_ids). */
    cohortBatchIds: uuid('cohort_batch_ids').array(),
    tiePolicy: text('tie_policy', { enum: ACADEMIC_TIE_POLICIES }).notNull().default('competition'),
    /** Published while roster rows were unmarked or unverified. */
    provisional: boolean('provisional').notNull().default(false),
    completeness: jsonb('completeness').notNull().$type<AcademicRosterCounts>(),
    status: text('status', { enum: ACADEMIC_PUBLICATION_STATUSES }).notNull().default('current'),
    note: text('note'),
    publishedByUserId: uuid('published_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnByUserId: uuid('withdrawn_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    withdrawnReason: text('withdrawn_reason'),
  },
  (t) => [
    uniqueIndex('result_publications_version_key').on(t.assessmentId, t.version),
    uniqueIndex('result_publications_one_current_key')
      .on(t.assessmentId)
      .where(sql`${t.status} = 'current'`),
    check('result_publications_version_positive', sql`${t.version} >= 1`),
    check(
      'result_publications_scope_check',
      sql`${t.rankingScope} IN (${inList(ACADEMIC_RANKING_SCOPES)})`,
    ),
    check(
      'result_publications_tie_policy_check',
      sql`${t.tiePolicy} IN (${inList(ACADEMIC_TIE_POLICIES)})`,
    ),
    check(
      'result_publications_status_check',
      sql`${t.status} IN (${inList(ACADEMIC_PUBLICATION_STATUSES)})`,
    ),
    check(
      'result_publications_cohort_shape',
      sql`(${t.rankingScope} = 'cohort') = (${t.cohortBatchIds} IS NOT NULL AND cardinality(${t.cohortBatchIds}) >= 1)`,
    ),
    check(
      'result_publications_withdrawn_shape',
      sql`(${t.status} = 'withdrawn') = (${t.withdrawnAt} IS NOT NULL) AND (${t.withdrawnAt} IS NULL) = (${t.withdrawnByUserId} IS NULL) AND (${t.withdrawnAt} IS NULL) = (${t.withdrawnReason} IS NULL)`,
    ),
  ],
);
