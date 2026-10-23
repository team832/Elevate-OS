import { z } from 'zod';
import type { StudentIdentityId } from '@elevate/shared-types';
import {
  batchIdSchema,
  enrolmentIdSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  programmeCodeSchema,
  staffMemberIdSchema,
  studentIdSchema,
} from './ids';

/** The canonical person (core.students.id), shared by Ops and Academic. */
export const coreStudentIdSchema = idSchema<StudentIdentityId>();

/**
 * Cross-module read-only summaries (D-011.2), served at
 * `GET /<zone>/api/internal/v1/summary` and consumed by Business Ops and the
 * platform dashboard.
 *
 * MISSING IS NOT ZERO. Every metric carries a status:
 *   ok        — measured from real records in the window; value is a number
 *   estimated — derived/approximate (say how in `basis`); value is a number
 *   missing   — no trustworthy data (source not connected, nothing recorded);
 *               value is null and must be shown as "missing", never as 0
 * A consumer that cannot reach the source at all renders "source unavailable"
 * (see `SourceResult`).
 */

export const metricWindowSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    /** Human label, e.g. "Week of 12 Oct 2026". */
    label: z.string().min(1).max(100).optional(),
  })
  .refine((w) => w.from <= w.to, { error: 'window.from must not be after window.to' });
export type MetricWindow = z.output<typeof metricWindowSchema>;

export const metricUnitSchema = z.enum(['count', 'percent', 'ratio', 'inr', 'minutes', 'hours']);

const metricBase = {
  /** What is counted and how, in one sentence, e.g. "Classes marked delivered in the window". */
  definition: z.string().min(1).max(500),
  window: metricWindowSchema,
  unit: metricUnitSchema,
};

export const metricSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), value: z.number().finite(), ...metricBase }),
  z.object({
    status: z.literal('estimated'),
    value: z.number().finite(),
    ...metricBase,
    /** How the estimate was produced. */
    basis: z.string().min(1).max(500),
  }),
  z.object({
    status: z.literal('missing'),
    value: z.null(),
    ...metricBase,
    /** Why the value is missing, e.g. "Metricool not connected". */
    reason: z.string().min(1).max(500),
  }),
]);
export type Metric = z.output<typeof metricSchema>;
export type MetricStatus = Metric['status'];

export type MetricMeta = {
  definition: string;
  window: z.input<typeof metricWindowSchema>;
  unit: Metric['unit'];
};

/** Validated metric builders (throw ZodError on an invalid window or value). */
export const metric = {
  ok: (value: number, meta: MetricMeta): Metric =>
    metricSchema.parse({ status: 'ok', value, ...meta }),
  estimated: (value: number, basis: string, meta: MetricMeta): Metric =>
    metricSchema.parse({ status: 'estimated', value, basis, ...meta }),
  missing: (reason: string, meta: MetricMeta): Metric =>
    metricSchema.parse({ status: 'missing', value: null, reason, ...meta }),
};

export const connectionStatusSchema = z.enum(['not_configured', 'sandbox', 'connected', 'error']);
export type ConnectionStatus = z.output<typeof connectionStatusSchema>;

// --- Marketing ------------------------------------------------------------------

export const marketingSummaryV1Schema = z.object({
  contract: z.literal('marketing.summary'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  window: metricWindowSchema,
  metrics: z.object({
    ideasCaptured: metricSchema,
    contentApproved: metricSchema,
    postsScheduled: metricSchema,
    postsPublished: metricSchema,
    totalReach: metricSchema,
    engagementRate: metricSchema,
    followerGrowth: metricSchema,
    leadsAttributed: metricSchema,
  }),
  accounts: z.array(
    z.object({
      accountCode: z.string().min(1).max(40),
      platform: z.enum(['instagram', 'youtube', 'linkedin', 'other']),
      connection: connectionStatusSchema,
      postsPublished: metricSchema,
      reach: metricSchema,
    }),
  ),
  dataSources: z.array(
    z.object({
      name: z.string().min(1),
      connection: connectionStatusSchema,
      lastSyncAt: isoDateTimeSchema.nullable(),
    }),
  ),
});
export type MarketingSummaryV1 = z.output<typeof marketingSummaryV1Schema>;

// --- Academic ---------------------------------------------------------------------

const academicDeliveryMetrics = z.object({
  activeStudents: metricSchema,
  activeBatches: metricSchema,
  /** Planned ≠ delivered: planned classes are never reported as delivered (D-016). */
  classesPlanned: metricSchema,
  classesDelivered: metricSchema,
  classesCancelled: metricSchema,
  attendanceRate: metricSchema,
  assessmentsPlanned: metricSchema,
  assessmentsConducted: metricSchema,
  studentsAtRisk: metricSchema,
  syllabusCompletionRate: metricSchema,
});

export const academicDeliverySummaryV1Schema = z.object({
  contract: z.literal('academic.delivery_summary'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  window: metricWindowSchema,
  metrics: academicDeliveryMetrics,
  programmes: z.array(
    z.object({ programmeCode: programmeCodeSchema, metrics: academicDeliveryMetrics }),
  ),
});
export type AcademicDeliverySummaryV1 = z.output<typeof academicDeliverySummaryV1Schema>;

const count = z.int().min(0);

/**
 * One student's evidence from Academic OS for Business Ops (IR-OPS-STU-1), served at
 * `GET /academic/api/internal/v1/students/{academicStudentId}/summary?from&to` (caller `ops`).
 * Only final result runs. Absent is never a score of 0; `cohort.scored` is the number of
 * students with a score in the same assessment (the comparison group).
 */
export const academicStudentSummaryV1Schema = z.object({
  contract: z.literal('academic.student_summary'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  studentId: studentIdSchema,
  window: metricWindowSchema,
  enrolments: z.array(
    z.object({
      enrolmentId: enrolmentIdSchema,
      programmeCode: programmeCodeSchema,
      batchId: batchIdSchema.nullable(),
      batchName: z.string().nullable(),
      status: z.string().min(1),
      /**
       * Teacher assignments of the batch in the window. Ids only (core.staff_members); the
       * reviews and demo-attendance contracts send display names. Consumers resolve ids.
       */
      teachers: z.array(z.object({ staffId: staffMemberIdSchema, subject: z.string().min(1) })),
    }),
  ),
  /** Held class sessions in the window and the student's recorded marks; unrecorded = held − sum. */
  attendance: z.object({
    held: count,
    present: count,
    partial: count,
    late: count,
    absent: count,
    excused: count,
    /**
     * Rate per Academic's `attendance.denominator` setting (null when nothing was held) and the
     * words for it. Optional since 22 Oct 2026: a consumer must accept their absence and never
     * recompute the rate itself.
     */
    ratePercent: z.number().min(0).max(100).nullable().optional(),
    definition: z.string().min(1).optional(),
  }),
  results: z.array(
    z
      .object({
        assessmentId: z.uuid(),
        code: z.string().min(1),
        subject: z.string().nullable(),
        examType: z.string().min(1),
        heldOn: isoDateSchema.nullable(),
        state: z.enum(['scored', 'absent']),
        score: z.number().nullable(),
        maxScore: z.number().positive(),
        percentile: z.number().min(0).max(100).nullable(),
        rank: z.int().min(1).nullable(),
        cohort: z.object({ label: z.string().min(1), scored: count }),
        /** Result run version the figures come from (a re-run supersedes it). */
        resultVersion: z.int().min(1),
      })
      .refine(
        (r) =>
          (r.state === 'absent') === (r.score === null) &&
          (r.state === 'scored' || (r.percentile === null && r.rank === null)),
        {
          error: 'An absent result has no score, percentile or rank; a scored result has a score.',
        },
      ),
  ),
});
export type AcademicStudentSummaryV1 = z.output<typeof academicStudentSummaryV1Schema>;

// --- Academic teacher workspace (owner brief 21 Oct 2026) ----------------------------------
// Vocabularies mirror packages/database/src/schema/academic-*.ts (schema files cannot import
// this package at runtime).

export const TEACHER_ROLES = ['primary', 'co_teacher', 'substitute'] as const;
export const TEACHER_REVIEW_TYPES = [
  'demo_session',
  'periodic_progress',
  'assessment_follow_up',
  'support_referral',
] as const;
export const DEMO_ATTENDANCE_STATUSES = [
  'not_recorded',
  'present',
  'absent',
  'late',
  'excused',
] as const;

const optionalText = z.string().max(4000).nullable();

/**
 * Submitted teacher reviews for Business Ops (R4), served at
 * `GET /academic/api/internal/v1/reviews?coreStudentId|authorStaffId` (caller `ops`).
 * `student` is null when queried by author only; each review names its student.
 * Drafts are never included. Withdrawn and superseded versions are listed with their markers so
 * the reader can hide them; Ops never edits them.
 */
export const academicStudentReviewsV1Schema = z.object({
  contract: z.literal('academic.student_reviews'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  student: z
    .object({
      coreStudentId: coreStudentIdSchema.nullable(),
      academicStudentId: studentIdSchema.nullable(),
    })
    .refine((s) => s.coreStudentId !== null || s.academicStudentId !== null, {
      error: 'A student reference is required',
    })
    .nullable(),
  reviews: z.array(
    z
      .strictObject({
        reviewKey: z.uuid(),
        version: z.int().min(1),
        coreStudentId: coreStudentIdSchema.nullable(),
        academicStudentId: studentIdSchema.nullable(),
        studentName: z.string().min(1),
        status: z.enum(['submitted', 'withdrawn']),
        /** A later submitted version of the same review exists. */
        superseded: z.boolean(),
        authorStaffId: staffMemberIdSchema,
        authorName: z.string().min(1),
        subjectName: z.string().min(1).nullable(),
        reviewType: z.enum(TEACHER_REVIEW_TYPES),
        sessionDate: isoDateSchema.nullable(),
        /** Ops demo class the review is about (demo_session reviews), for exact matching in Ops. */
        opsDemoSessionId: z.uuid().nullable(),
        periodFrom: isoDateSchema.nullable(),
        periodTo: isoDateSchema.nullable(),
        strengths: optionalText,
        areasForSupport: optionalText,
        attendanceEvidence: optionalText,
        homeworkEvidence: optionalText,
        academicConcerns: optionalText,
        suggestedAction: optionalText,
        followUpOn: isoDateSchema.nullable(),
        /** Added 23 Oct 2026b (optional, brief §16): date observed and the batch the review is about. */
        observationOn: isoDateSchema.nullable().optional(),
        batchId: batchIdSchema.nullable().optional(),
        visibility: z.enum(['internal', 'shareable']),
        submittedAt: isoDateTimeSchema,
        withdrawnAt: isoDateTimeSchema.nullable(),
        /** Academic page of the source review (link target for authorised users). */
        sourcePath: z.string().startsWith('/academic/'),
      })
      .refine((r) => (r.status === 'withdrawn') === (r.withdrawnAt !== null), {
        error: 'withdrawnAt is set exactly when the review is withdrawn',
      }),
  ),
});
export type AcademicStudentReviewsV1 = z.output<typeof academicStudentReviewsV1Schema>;

/**
 * One teacher's academic activity for Business Ops teacher views. Operational counts, not
 * payroll or HR attendance; nothing here rates the teacher.
 */
export const academicTeacherActivityV1Schema = z.object({
  contract: z.literal('academic.teacher_activity'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  staffId: staffMemberIdSchema,
  window: metricWindowSchema,
  assignments: z.array(
    z.object({
      batchCode: z.string().min(1),
      subjectName: z.string().min(1),
      role: z.enum(TEACHER_ROLES),
      startDate: isoDateSchema.nullable(),
      endDate: isoDateSchema.nullable(),
      /** Added 23 Oct 2026 (optional, v1-compatible): ids to link feedback/reports to the batch and subject. */
      batchId: z.uuid().optional(),
      subjectId: z.uuid().optional(),
    }),
  ),
  /** Planned ≠ delivered: `delivered` counts sessions marked delivered with this teacher as actual. */
  sessions: z.object({
    planned: metricSchema,
    delivered: metricSchema,
    cancelled: metricSchema,
    substituted: metricSchema,
  }),
  logsPending: metricSchema,
  attendancePending: metricSchema,
  markingPending: metricSchema,
  reviews: z.object({ submitted: metricSchema, draft: metricSchema }),
  /** Academic availability records (not HR leave). */
  unavailability: z.array(z.object({ from: isoDateSchema, to: isoDateSchema })),
  /**
   * Added 23 Oct 2026, optional so v1 consumers and stubs stay valid. Chapters of VERIFIED class
   * records of this teacher whose class date is in the window (verified delivery, not mastery).
   */
  topicsCovered: z
    .array(z.object({ batchCode: z.string().min(1), subjectName: z.string().min(1), chapterTitle: z.string().min(1), classes: z.int().min(1) }))
    .optional(),
  /** Added 23 Oct 2026 (optional): assessments created, and assessments with marks entered, by this teacher's sign-in in the window. */
  assessments: z
    .object({
      prepared: metricSchema,
      marked: metricSchema,
      /**
       * Added 23 Oct 2026b (optional, brief §21), over not-cancelled assessments dated in the window
       * where this teacher is the responsible teacher or evaluator: `assigned` all of them;
       * `completed` conducted or finalised; `awaitingMarking` (as evaluator, else responsible)
       * held with an active roster row unmarked or not verified; `published` with a current
       * publication. `missing` when the source cannot tell (e.g. no roster snapshot), never 0.
       */
      assigned: metricSchema.optional(),
      completed: metricSchema.optional(),
      awaitingMarking: metricSchema.optional(),
      published: metricSchema.optional(),
    })
    .optional(),
});
export type AcademicTeacherActivityV1 = z.output<typeof academicTeacherActivityV1Schema>;

export const TEACHING_ASSIGNMENT_STATUSES = ['pending', 'active', 'ended'] as const;

/**
 * One page of teaching assignments (brief 23 Oct 2026 §4, R9) for HR, served by Academic at
 * `GET /academic/api/internal/v1/teaching-assignments?staffId&status&q&page&pageSize` (caller `ops`).
 * Includes pending rows (no batch yet: they open no students). `status` is the stored status.
 */
export const teachingAssignmentsV1Schema = z.object({
  contract: z.literal('academic.teaching_assignments'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  total: z.int().min(0),
  page: z.int().min(1),
  pageSize: z.int().min(1),
  items: z.array(
    z.object({
      assignmentId: z.uuid(),
      staffId: staffMemberIdSchema,
      teacherName: z.string().min(1),
      /** Course or programme name. */
      courseName: z.string().min(1).nullable(),
      subjectName: z.string().min(1),
      classLevel: z.string().min(1).nullable(),
      /** null only while pending ("No batch yet"). */
      batchCode: z.string().min(1).nullable(),
      /** Added 23 Oct 2026 (optional): ids for related-batch/subject pickers; batchId null while pending. */
      batchId: z.uuid().nullable().optional(),
      subjectId: z.uuid().optional(),
      academicYear: z.string().nullable(),
      branchName: z.string().min(1).nullable(),
      startDate: isoDateSchema.nullable(),
      endDate: isoDateSchema.nullable(),
      role: z.enum(TEACHER_ROLES),
      status: z.enum(TEACHING_ASSIGNMENT_STATUSES),
    }),
  ),
});
export type TeachingAssignmentsV1 = z.output<typeof teachingAssignmentsV1Schema>;

/**
 * Demo attendance marked by teachers on Academic class rosters (R5), served at
 * `GET /academic/api/internal/v1/demo-attendance?ids=<ops demo session ids>` (caller `ops`).
 */
export const academicDemoAttendanceV1Schema = z.object({
  items: z.array(
    z.object({
      opsDemoSessionId: z.uuid(),
      academicSessionId: z.uuid(),
      status: z.enum(DEMO_ATTENDANCE_STATUSES),
      recordedAt: isoDateTimeSchema.nullable(),
      /** Actual teachers of the session (incl. substitutes). */
      teacherStaffIds: z.array(staffMemberIdSchema),
      teacherNames: z.array(z.string().min(1)),
    }),
  ),
});
export type AcademicDemoAttendanceV1 = z.output<typeof academicDemoAttendanceV1Schema>;

/**
 * Ops demo sessions on one day (R5), served at
 * `GET /ops/api/internal/v1/demo-sessions?date=YYYY-MM-DD` (caller `academic`). Minimal fields.
 */
export const opsDemoSessionsForDayV1Schema = z.object({
  items: z.array(
    z.object({
      demoSessionId: z.uuid(),
      coreStudentId: coreStudentIdSchema,
      displayName: z.string().min(1),
      dayNumber: z.int().min(1).max(10),
      subject: z.string().min(1).nullable(),
      startsAt: isoDateTimeSchema,
      isSample: z.boolean(),
    }),
  ),
});
export type OpsDemoSessionsForDayV1 = z.output<typeof opsDemoSessionsForDayV1Schema>;

// --- Consumer side ------------------------------------------------------------------

/** What a consumer holds after trying to fetch a summary. Never substitute zeros. */
export type SourceResult<T> =
  | { status: 'available'; data: T; fetchedAt: string }
  | { status: 'unavailable'; reason: string; fetchedAt: string };
