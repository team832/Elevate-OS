/**
 * OWNER: Academic OS team (owner answer 1, 21 Oct 2026 — supersedes D-043).
 *
 * Teacher reviews of a student, owned by Academic. Versioned: every version of one review
 * shares `review_key`; at most one draft per key; a submitted version is never edited (a
 * change is version + 1 that `supersedes` it). Drafts are private to the author. Business
 * Ops reads submitted, non-withdrawn versions through an Academic internal route (R4) and
 * never edits them. No ratings or labels: structured evidence fields only.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  BatchId,
  Brand,
  EnrolmentId,
  StaffMemberId,
  StudentId,
  StudentIdentityId,
  UserId,
} from '@elevate/shared-types';
import { academic, createdAt, inList, updatedAt } from './academic-columns';
import {
  academicBatches,
  academicClassSessions,
  academicEnrolments,
  academicStudents,
  type AcademicSessionId,
} from './academic';
import { academicSubjects, type AcademicSubjectId } from './academic-curriculum';
import { staffMembers, students as coreStudents, users } from './core';

export type AcademicReviewId = Brand<string, 'AcademicReviewId'>;
export type AcademicReviewKey = Brand<string, 'AcademicReviewKey'>;

export const ACADEMIC_REVIEW_TYPES = [
  'demo_session',
  'periodic_progress',
  'assessment_follow_up',
  'support_referral',
] as const;
export const ACADEMIC_REVIEW_STATUSES = ['draft', 'submitted', 'withdrawn'] as const;
export const ACADEMIC_REVIEW_VISIBILITIES = ['internal', 'shareable'] as const;

export const academicTeacherReviews = academic.table(
  'teacher_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicReviewId>(),
    reviewKey: uuid('review_key').notNull().$type<AcademicReviewKey>(),
    version: integer('version').notNull().default(1),
    authorStaffId: uuid('author_staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    academicStudentId: uuid('academic_student_id')
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    /** Set for demo students, who have no academic student yet. */
    coreStudentId: uuid('core_student_id')
      .references(() => coreStudents.id, { onDelete: 'restrict' })
      .$type<StudentIdentityId>(),
    subjectId: uuid('subject_id')
      .references(() => academicSubjects.id, { onDelete: 'restrict' })
      .$type<AcademicSubjectId>(),
    reviewType: text('review_type', { enum: ACADEMIC_REVIEW_TYPES }).notNull(),
    sessionId: uuid('session_id')
      .references(() => academicClassSessions.id, { onDelete: 'restrict' })
      .$type<AcademicSessionId>(),
    enrolmentId: uuid('enrolment_id')
      .references(() => academicEnrolments.id, { onDelete: 'restrict' })
      .$type<EnrolmentId>(),
    /** ops.demo_sessions.id (no FK across modules, D-005). */
    opsDemoSessionId: uuid('ops_demo_session_id'),
    periodFrom: date('period_from', { mode: 'string' }),
    periodTo: date('period_to', { mode: 'string' }),
    strengths: text('strengths'),
    areasForSupport: text('areas_for_support'),
    attendanceEvidence: text('attendance_evidence'),
    homeworkEvidence: text('homework_evidence'),
    academicConcerns: text('academic_concerns'),
    suggestedAction: text('suggested_action'),
    followUpOn: date('follow_up_on', { mode: 'string' }),
    /** Date the teacher observed what the review says (brief §16). */
    observationOn: date('observation_on', { mode: 'string' }),
    batchId: uuid('batch_id')
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    visibility: text('visibility', { enum: ACADEMIC_REVIEW_VISIBILITIES })
      .notNull()
      .default('internal'),
    status: text('status', { enum: ACADEMIC_REVIEW_STATUSES }).notNull().default('draft'),
    supersedesId: uuid('supersedes_id')
      .references((): AnyPgColumn => academicTeacherReviews.id, { onDelete: 'restrict' })
      .$type<AcademicReviewId>(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnReason: text('withdrawn_reason'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('teacher_reviews_version_key').on(t.reviewKey, t.version),
    uniqueIndex('teacher_reviews_one_draft_key')
      .on(t.reviewKey)
      .where(sql`${t.status} = 'draft'`),
    index('teacher_reviews_core_student_idx').on(t.coreStudentId),
    index('teacher_reviews_academic_student_idx').on(t.academicStudentId),
    index('teacher_reviews_author_status_idx').on(t.authorStaffId, t.status),
    check('teacher_reviews_type_check', sql`${t.reviewType} IN (${inList(ACADEMIC_REVIEW_TYPES)})`),
    check(
      'teacher_reviews_status_check',
      sql`${t.status} IN (${inList(ACADEMIC_REVIEW_STATUSES)})`,
    ),
    check(
      'teacher_reviews_visibility_check',
      sql`${t.visibility} IN (${inList(ACADEMIC_REVIEW_VISIBILITIES)})`,
    ),
    check(
      'teacher_reviews_student_ref',
      sql`${t.academicStudentId} IS NOT NULL OR ${t.coreStudentId} IS NOT NULL`,
    ),
    check('teacher_reviews_version_positive', sql`${t.version} >= 1`),
    check(
      'teacher_reviews_period_order',
      sql`${t.periodFrom} IS NULL OR ${t.periodTo} IS NULL OR ${t.periodFrom} <= ${t.periodTo}`,
    ),
    check(
      'teacher_reviews_status_stamps',
      sql`(${t.status} <> 'submitted' OR ${t.submittedAt} IS NOT NULL) AND (${t.status} <> 'withdrawn' OR (${t.withdrawnAt} IS NOT NULL AND ${t.withdrawnReason} IS NOT NULL))`,
    ),
    check(
      'teacher_reviews_not_self_superseding',
      sql`${t.supersedesId} IS NULL OR ${t.supersedesId} <> ${t.id}`,
    ),
  ],
);
