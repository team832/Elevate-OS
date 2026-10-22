/**
 * OWNER: Academic OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Assessment tables of the `academic` schema: assessments with their default scoring rule,
 * sections, answer-key versions, attempts, result runs and per-student results. Same rules
 * as academic.ts (`academic.table`, `academic` prefix, UUID PKs, FKs only within academic or
 * into core, only `import type` from workspace packages).
 *
 * Marks are stored as `numeric(10,4)` strings and computed in integer units of
 * 1/10 000 mark in `apps/academic-os/src/domain/marks.ts` (no floating point).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { BatchId, Brand, StudentId, UserId } from '@elevate/shared-types';
import { academic, createdAt, inList, updatedAt } from './academic-columns';
import { academicBatches, academicStudents } from './academic';
import { academicSubjects, type AcademicSubjectId } from './academic-curriculum';
import { users } from './core';

export type AcademicAssessmentId = Brand<string, 'AcademicAssessmentId'>;
export type AcademicSectionId = Brand<string, 'AcademicSectionId'>;
export type AcademicAnswerKeyId = Brand<string, 'AcademicAnswerKeyId'>;
export type AcademicAttemptId = Brand<string, 'AcademicAttemptId'>;
export type AcademicResultRunId = Brand<string, 'AcademicResultRunId'>;

/** `withheld` = sat but result held back; `exempt` = not required to sit (neither is a 0). */
export const ACADEMIC_ATTEMPT_STATUSES = ['submitted', 'absent', 'exempt', 'withheld'] as const;
export const ACADEMIC_RESULT_STATES = ['scored', 'absent', 'exempt', 'withheld'] as const;
export const ACADEMIC_ASSESSMENT_KINDS = [
  'chapter_test',
  'sectional',
  'full_mock',
  'practice',
] as const;
export const ACADEMIC_ASSESSMENT_STATUSES = [
  'draft',
  'scheduled',
  'conducted',
  'finalised',
  'cancelled',
] as const;

/** Marks as exact decimals (≤ 4 dp). Computed in integer 1/10 000-mark units in the domain. */
const marks = (name: string) => numeric(name, { precision: 10, scale: 4 });

/**
 * An assessment (ACD-016) with its DEFAULT scoring rule. Every rule value may be
 * null = unknown (e.g. an exam pattern not recorded in the legacy sources): a
 * rule with unknowns cannot be finalised. Nothing hard-codes one exam's rule.
 */
export const academicAssessments = academic.table(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicAssessmentId>(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    kind: text('kind', { enum: ACADEMIC_ASSESSMENT_KINDS }).notNull(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    subjectId: uuid('subject_id')
      .references(() => academicSubjects.id, { onDelete: 'restrict' })
      .$type<AcademicSubjectId>(),
    /** Chapters the assessment covers (prerequisites for scheduling). */
    chapterIds: uuid('chapter_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    scheduledDate: date('scheduled_date', { mode: 'string' }),
    startTime: text('start_time'),
    /** Minutes; null = unknown, never zero (BR-ACD-4). */
    durationMinutes: integer('duration_minutes'),
    discussionMinutes: integer('discussion_minutes'),
    status: text('status', { enum: ACADEMIC_ASSESSMENT_STATUSES }).notNull().default('draft'),
    /** Free-text reference to an exam pattern in data/legacy/academic/assessment-patterns.json. */
    patternRef: text('pattern_ref'),
    marksPerCorrect: marks('marks_per_correct'),
    /** Signed: a penalty is negative, e.g. -0.25. */
    marksPerWrong: marks('marks_per_wrong'),
    marksUnattempted: marks('marks_unattempted'),
    /** Publication to students/parents is separate from finalising results. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByUserId: uuid('published_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    sourceRef: text('source_ref'),
    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assessments_code_key').on(t.code),
    check(
      'assessments_publication_pair',
      sql`(${t.publishedAt} IS NULL) = (${t.publishedByUserId} IS NULL)`,
    ),
    index('assessments_batch_date_idx').on(t.batchId, t.scheduledDate),
    check('assessments_kind_check', sql`${t.kind} IN (${inList(ACADEMIC_ASSESSMENT_KINDS)})`),
    check(
      'assessments_status_check',
      sql`${t.status} IN (${inList(ACADEMIC_ASSESSMENT_STATUSES)})`,
    ),
    check(
      'assessments_minutes_positive',
      sql`(${t.durationMinutes} IS NULL OR ${t.durationMinutes} > 0) AND (${t.discussionMinutes} IS NULL OR ${t.discussionMinutes} >= 0)`,
    ),
    check(
      'assessments_start_time_format',
      sql`${t.startTime} IS NULL OR ${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
);

/**
 * Sections with their own question count, answer format and optional scoring
 * overrides (null = use the assessment's rule). `capMarks` limits the section score.
 */
export const academicAssessmentSections = academic.table(
  'assessment_sections',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicSectionId>(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => academicAssessments.id, { onDelete: 'cascade' })
      .$type<AcademicAssessmentId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    questionCount: integer('question_count').notNull(),
    /** `choice` answers must be one of `options`; `numeric` answers must parse as numbers. */
    answerFormat: text('answer_format', { enum: ['choice', 'numeric'] })
      .notNull()
      .default('choice'),
    options: text('options')
      .array()
      .notNull()
      .default(sql`'{A,B,C,D}'::text[]`),
    timeLimitMinutes: integer('time_limit_minutes'),
    marksPerCorrect: marks('marks_per_correct'),
    marksPerWrong: marks('marks_per_wrong'),
    marksUnattempted: marks('marks_unattempted'),
    capMarks: marks('cap_marks'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('assessment_sections_code_key').on(t.assessmentId, t.code),
    check('assessment_sections_questions_range', sql`${t.questionCount} BETWEEN 1 AND 500`),
    check('assessment_sections_format_check', sql`${t.answerFormat} IN ('choice', 'numeric')`),
  ],
);

/**
 * Answer-key versions. `answers` maps section code → array of answers by
 * question number (index 0 = Q1); `null` = question dropped (no marks either
 * way; the section maximum is reduced).
 */
export const academicAnswerKeys = academic.table(
  'answer_keys',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicAnswerKeyId>(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => academicAssessments.id, { onDelete: 'cascade' })
      .$type<AcademicAssessmentId>(),
    version: integer('version').notNull(),
    answers: jsonb('answers').notNull().$type<Record<string, (string | null)[]>>(),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('answer_keys_version_key').on(t.assessmentId, t.version),
    check('answer_keys_version_positive', sql`${t.version} >= 1`),
  ],
);

/**
 * One attempt per student per assessment. `responses` maps section code →
 * answers by question number (`null` = unattempted). `keyVersion` is the
 * answer-key version the responses were prepared against (mismatch is a
 * validation error). `absent` attempts are not zero scores (ACD-018).
 */
export const academicAttempts = academic.table(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicAttemptId>(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => academicAssessments.id, { onDelete: 'restrict' })
      .$type<AcademicAssessmentId>(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    status: text('status', { enum: ACADEMIC_ATTEMPT_STATUSES }).notNull(),
    responses: jsonb('responses').$type<Record<string, (string | null)[]>>(),
    keyVersion: integer('key_version'),
    /** Directly entered total (no per-question responses, e.g. a written test). */
    manualScore: marks('manual_score'),
    markedByUserId: uuid('marked_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    version: integer('version').notNull().default(1),
    enteredByUserId: uuid('entered_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attempts_assessment_student_key').on(t.assessmentId, t.studentId),
    check('attempts_status_check', sql`${t.status} IN (${inList(ACADEMIC_ATTEMPT_STATUSES)})`),
    check(
      'attempts_shape',
      sql`(${t.status} IN ('absent', 'exempt') AND ${t.responses} IS NULL AND ${t.manualScore} IS NULL) OR (${t.status} = 'submitted' AND (${t.responses} IS NOT NULL OR ${t.manualScore} IS NOT NULL)) OR ${t.status} NOT IN ('absent', 'exempt', 'submitted')`,
    ),
  ],
);

/**
 * A finalisation run: one immutable result version for an assessment. Re-scoring
 * creates run `version + 1` and marks the previous run `superseded` (its rows are
 * kept unchanged). `ruleSnapshot` freezes the scoring rule used.
 */
export const academicResultRuns = academic.table(
  'result_runs',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicResultRunId>(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => academicAssessments.id, { onDelete: 'restrict' })
      .$type<AcademicAssessmentId>(),
    version: integer('version').notNull(),
    /** null when every result was entered as a manual total (no answer key). */
    answerKeyId: uuid('answer_key_id')
      .references(() => academicAnswerKeys.id, { onDelete: 'restrict' })
      .$type<AcademicAnswerKeyId>(),
    status: text('status', { enum: ['final', 'superseded'] }).notNull(),
    ruleSnapshot: jsonb('rule_snapshot').notNull(),
    reason: text('reason'),
    studentsScored: integer('students_scored').notNull(),
    studentsAbsent: integer('students_absent').notNull(),
    finalisedByUserId: uuid('finalised_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    finalisedAt: timestamp('finalised_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('result_runs_version_key').on(t.assessmentId, t.version),
    uniqueIndex('result_runs_one_final_key')
      .on(t.assessmentId)
      .where(sql`${t.status} = 'final'`),
    check('result_runs_status_check', sql`${t.status} IN ('final', 'superseded')`),
    check('result_runs_rescore_reason', sql`${t.version} = 1 OR ${t.reason} IS NOT NULL`),
  ],
);

/** Per-student results of a run (immutable once written). */
export const academicResults = academic.table(
  'results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => academicResultRuns.id, { onDelete: 'restrict' })
      .$type<AcademicResultRunId>(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => academicAssessments.id, { onDelete: 'restrict' })
      .$type<AcademicAssessmentId>(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => academicAttempts.id, { onDelete: 'restrict' })
      .$type<AcademicAttemptId>(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    /** null for an absent student (absent is not 0). */
    totalScore: marks('total_score'),
    maxScore: marks('max_score').notNull(),
    /** Percentile within the batch for this run (0–100), null when absent. */
    percentile: numeric('percentile', { precision: 7, scale: 4 }),
    rank: integer('rank'),
    sectionScores: jsonb('section_scores').notNull(),
    absent: boolean('absent').notNull().default(false),
    /** Only `scored` carries a total; absent/exempt/withheld are never 0 (`absent` = no score, kept for old readers). */
    state: text('state', { enum: ACADEMIC_RESULT_STATES }).notNull().default('scored'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('results_run_attempt_key').on(t.runId, t.attemptId),
    check('results_state_check', sql`${t.state} IN (${inList(ACADEMIC_RESULT_STATES)})`),
    check(
      'results_state_shape',
      sql`(${t.state} = 'scored') = (${t.totalScore} IS NOT NULL) AND ${t.absent} = (${t.state} <> 'scored')`,
    ),
    index('results_student_idx').on(t.studentId),
    check(
      'results_percentile_range',
      sql`${t.percentile} IS NULL OR ${t.percentile} BETWEEN 0 AND 100`,
    ),
    check(
      'results_absent_shape',
      sql`(${t.absent} AND ${t.totalScore} IS NULL) OR (NOT ${t.absent} AND ${t.totalScore} IS NOT NULL)`,
    ),
  ],
);
