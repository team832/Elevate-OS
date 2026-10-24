/**
 * OWNER: Academic OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Contracts that Academic OS publishes for other modules: its integration
 * events (add `defineEvent(...)` entries to `academicEvents`; type names start
 * with `academic.`) and shared shapes for its internal APIs.
 *
 * Already defined elsewhere (Foundation-owned, change via Integration):
 * - `academic.enrolment.confirmed` v1 / `academic.enrolment.rejected` v1 — `../events/enrolment.ts`
 * - `AcademicDeliverySummaryV1` — `../summaries.ts`
 *
 * Do not import other modules' files from here.
 */
import { z } from 'zod';
import type { EventDefinition } from '../events/define';
import { defineEvent } from '../events/define';
import {
  batchIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  programmeCodeSchema,
  staffMemberIdSchema,
  studentIdSchema,
  userIdSchema,
} from '../ids';

/** Consumer names Academic OS uses with `processEvents` (stable: renaming re-processes everything). */
export const ACADEMIC_CONSUMERS = {
  /** Consumes `ops.admission.enrolment_requested` v1 and replies confirmed/rejected. */
  enrolmentIntake: 'academic.enrolment-intake',
} as const;

/**
 * `academic.assessment.finalised` v1 — published in the same transaction that
 * writes an immutable result version (first finalisation or a re-score). It
 * carries counts only — never student names or scores — so a future consumer
 * (e.g. parent-report reminders in Ops, ACD-028) can react without reading
 * Academic's tables. No consumer exists yet.
 */
export const assessmentFinalisedV1Payload = z
  .object({
    assessmentId: z.uuid(),
    assessmentCode: z.string().min(1).max(80),
    kind: z.enum(['chapter_test', 'sectional', 'full_mock', 'practice']),
    batchId: batchIdSchema,
    programmeCode: programmeCodeSchema,
    /** 1 for the first finalisation; +1 for each re-score. */
    resultVersion: z.int().min(1),
    studentsScored: z.int().min(0),
    studentsAbsent: z.int().min(0),
    finalisedAt: isoDateTimeSchema,
    finalisedByUserId: userIdSchema,
  })
  .strict();

export const assessmentFinalisedV1 = defineEvent({
  type: 'academic.assessment.finalised',
  version: 1,
  producer: 'academic',
  consumers: [],
  description:
    'Academic OS finalised (or re-scored) the results of an assessment. Counts only; no personal data.',
  payload: assessmentFinalisedV1Payload,
});

export const academicEvents = [assessmentFinalisedV1] as const satisfies readonly EventDefinition[];

// --- Tests and Mock Tests: Academic internal assessment API (owner answer 1, 23 Oct 2026) ------
// ONE record in Academic. Business Ops reads and writes it only through these routes
// (`/academic/api/internal/v1/assessments/...`, caller `ops`, Ops service token, acting-user
// header). Vocabularies mirror packages/database/src/schema/academic-assessment*.ts.

export const ASSESSMENT_KINDS = ['chapter_test', 'sectional', 'full_mock', 'practice'] as const;
/** The two types Ops shows: sectional and full mocks are mock tests; the rest are tests. */
export const ASSESSMENT_TYPE_OF_KIND = {
  chapter_test: 'test',
  practice: 'test',
  sectional: 'mock_test',
  full_mock: 'mock_test',
} as const satisfies Record<(typeof ASSESSMENT_KINDS)[number], 'test' | 'mock_test'>;
export const ASSESSMENT_STATUSES = [
  'draft',
  'scheduled',
  'conducted',
  'finalised',
  'cancelled',
] as const;
export const ASSESSMENT_VIEWS = [
  'upcoming',
  'in_progress',
  'previous',
  'awaiting_publication',
] as const;
export const ROSTER_ATTENDANCE = ['unmarked', 'present', 'absent', 'excused'] as const;
export const ROSTER_MARKS_STATES = ['not_entered', 'imported', 'verified'] as const;
/** Where recorded scores came from (same vocabulary as ops.score_imports.source). */
export const SCORE_SOURCES = ['csv', 'pdf_ai', 'manual'] as const;
export const RANKING_SCOPES = ['roster', 'cohort'] as const;
export const PUBLICATION_STATUSES = ['current', 'superseded', 'withdrawn'] as const;
/** Derived per assessment from its publications (and the legacy `published_at`). */
export const PUBLICATION_STATES = [
  'not_published',
  'provisional',
  'published',
  'withdrawn',
] as const;

const count = z.int().min(0);
/** An exact mark as text, at most 4 decimals ("12.75", "-0.25"); never a float. */
export const markTextSchema = z
  .string()
  .regex(/^-?\d{1,6}(\.\d{1,4})?$/, { error: 'Marks are decimals with at most 4 decimal places' });
const academicYearSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, { error: 'Use YYYY-YY, e.g. 2026-27' });
const reason = z.string().trim().min(3).max(500);
const staffRef = z.object({ staffId: staffMemberIdSchema, name: z.string().min(1) }).nullable();

/** Roster counts: active (not removed) rows by state, plus removed rows. */
export const rosterCountsSchema = z.object({
  active: count,
  present: count,
  absent: count,
  excused: count,
  unmarked: count,
  notEntered: count,
  imported: count,
  verified: count,
  removed: count,
});
export type RosterCounts = z.output<typeof rosterCountsSchema>;

type RosterFacts = {
  attendance?: (typeof ROSTER_ATTENDANCE)[number];
  marksState: (typeof ROSTER_MARKS_STATES)[number];
  score: string | null;
};
/**
 * The roster rules (the database CHECKs say the same): a score exists exactly when marks are not
 * `not_entered`; absent/excused carry no score (absent is never 0); verified needs present.
 * `attendance` undefined = unchanged (the server checks the stored row).
 */
export function rosterFactsProblem(r: RosterFacts): string | null {
  if ((r.score === null) !== (r.marksState === 'not_entered'))
    return 'A score is given exactly when marks are imported or verified.';
  if ((r.attendance === 'absent' || r.attendance === 'excused') && r.score !== null)
    return 'An absent or excused student has no score (absent is not zero).';
  if (r.marksState === 'verified' && r.attendance !== undefined && r.attendance !== 'present')
    return 'Only a present student can have verified marks.';
  return null;
}
const rosterRefine = (r: RosterFacts) => rosterFactsProblem(r) === null;
const rosterError = { error: 'Attendance, marks state and score contradict each other.' };

const assessmentSummary = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(ASSESSMENT_KINDS),
  type: z.enum(['test', 'mock_test']),
  status: z.enum(ASSESSMENT_STATUSES),
  academicYear: academicYearSchema.nullable(),
  courseId: z.uuid(),
  courseName: z.string().min(1),
  /** Eligible batches; exactly one is `primary` (= assessments.batch_id). */
  batches: z
    .array(z.object({ batchId: batchIdSchema, code: z.string().min(1), primary: z.boolean() }))
    .min(1),
  scheduledDate: isoDateSchema.nullable(),
  startTime: z.string().nullable(),
  /** null = unknown (no max entered and the scoring rule is incomplete); never shown as 0. */
  maxMarks: markTextSchema.nullable(),
  responsibleTeacher: staffRef,
  evaluator: staffRef,
  publicationState: z.enum(PUBLICATION_STATES),
  /** null = no roster snapshot yet (missing, not zero). */
  rosterCounts: rosterCountsSchema.nullable(),
  isSample: z.boolean(),
});

/** `GET /academic/api/internal/v1/assessments?view&courseId&batchId&teacherStaffId&from&to&page&pageSize`. */
export const assessmentListQuerySchema = z.object({
  view: z.enum(ASSESSMENT_VIEWS).default('upcoming'),
  courseId: z.uuid().optional(),
  batchId: batchIdSchema.optional(),
  /** Responsible teacher or evaluator. */
  teacherStaffId: staffMemberIdSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const filterOption = z.object({ id: z.uuid(), label: z.string().min(1) });

export const academicAssessmentListV1Schema = z.object({
  contract: z.literal('academic.assessments'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  view: z.enum(ASSESSMENT_VIEWS),
  total: count,
  page: z.int().min(1),
  pageSize: z.int().min(1),
  /** Stored-record counts per view under the same filters (a previous test can also await publication). */
  viewCounts: z.record(z.enum(ASSESSMENT_VIEWS), count),
  /**
   * Filter choices over every assessment in the view (all pages) under the teacher and date filters;
   * the course and batch filters themselves are not applied, so other choices stay selectable.
   */
  filterOptions: z.object({ courses: z.array(filterOption), batches: z.array(filterOption) }),
  items: z.array(assessmentSummary),
});
export type AcademicAssessmentListV1 = z.output<typeof academicAssessmentListV1Schema>;

export const rosterRowSchema = z
  .object({
    rosterId: z.uuid(),
    studentId: studentIdSchema,
    /** core.students.id for Ops profile links; null when the academic student has none. */
    coreStudentId: z.uuid().nullable(),
    /** Academic student code (stable identifier for score-sheet matching). */
    studentCode: z.string().nullable(),
    /** Copied from Ops at snapshot; identity is studentId, never this text. */
    admissionNumber: z.string().min(1).nullable(),
    displayName: z.string().min(1),
    batchId: batchIdSchema,
    batchCode: z.string().min(1),
    attendance: z.enum(ROSTER_ATTENDANCE),
    marksState: z.enum(ROSTER_MARKS_STATES),
    score: markTextSchema.nullable(),
    /** Rank in the current publication; null when unpublished, unranked or removed. */
    rank: z.int().min(1).nullable(),
    addedReason: z.string().nullable(),
    removedAt: isoDateTimeSchema.nullable(),
    removedReason: z.string().nullable(),
    /** Optimistic lock: send it back with a change (stale → 409). */
    version: z.int().min(1),
    isSample: z.boolean(),
  })
  .refine(rosterRefine, rosterError);

const publicationSchema = z.object({
  version: z.int().min(1),
  resultVersion: z.int().min(1),
  status: z.enum(PUBLICATION_STATUSES),
  rankingScope: z.enum(RANKING_SCOPES),
  cohortBatchIds: z.array(batchIdSchema).nullable(),
  /** Competition ranking 1, 2, 2, 4 over present students with verified scores only. */
  tiePolicy: z.literal('competition'),
  provisional: z.boolean(),
  /** Roster counts at publication: what was still unmarked or unverified. */
  completeness: rosterCountsSchema,
  publishedAt: isoDateTimeSchema,
  publishedByName: z.string().min(1),
  withdrawnAt: isoDateTimeSchema.nullable(),
  withdrawnReason: z.string().nullable(),
  note: z.string().nullable(),
});

/** `GET /academic/api/internal/v1/assessments/{id}`; every write route below answers with this too. */
export const academicAssessmentDetailV1Schema = z.object({
  contract: z.literal('academic.assessment'),
  version: z.literal(1),
  generatedAt: isoDateTimeSchema,
  assessment: assessmentSummary.extend({
    subjectId: z.uuid().nullable(),
    subjectName: z.string().nullable(),
    durationMinutes: z.int().min(1).nullable(),
    marking: z.object({
      marksPerCorrect: markTextSchema.nullable(),
      marksPerWrong: markTextSchema.nullable(),
      marksUnattempted: markTextSchema.nullable(),
    }),
    sections: z.array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        questionCount: z.int().min(1),
        /** null = not known (rule incomplete). */
        maxMarks: markTextSchema.nullable(),
        /** Effective rule of the section (its override, else the assessment's); null = unknown. Same values as Academic scoring. */
        perCorrect: markTextSchema.nullable(),
        perWrong: markTextSchema.nullable(),
        perUnattempted: markTextSchema.nullable(),
        /** Section cap; null = no cap. */
        capMarks: markTextSchema.nullable(),
      }),
    ),
    rosterSnapshotAt: isoDateTimeSchema.nullable(),
  }),
  /** Empty while `rosterSnapshotAt` is null. */
  roster: z.array(rosterRowSchema),
  /** The final result run; null until finalised. */
  results: z
    .object({
      resultVersion: z.int().min(1),
      finalisedAt: isoDateTimeSchema,
      maxScore: markTextSchema,
    })
    .nullable(),
  publication: z.object({
    state: z.enum(PUBLICATION_STATES),
    /** Ranks are returned only while Academic setting progress.show_rank_percentile is approved and on. */
    rankVisible: z.boolean(),
    current: publicationSchema.nullable(),
    history: z.array(publicationSchema),
  }),
});
export type AcademicAssessmentDetailV1 = z.output<typeof academicAssessmentDetailV1Schema>;

const optionalMark = markTextSchema.nullable().optional();
const assessmentFields = {
  title: z.string().trim().min(1).max(200),
  academicYear: academicYearSchema,
  /** Eligible batches, first = primary, all of one course. Changeable only before the roster snapshot. */
  batchIds: z
    .array(batchIdSchema)
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'A batch is listed twice.' }),
  subjectId: z.uuid().nullable().optional(),
  scheduledDate: isoDateSchema.nullable().optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Use HH:MM (24 h)' })
    .nullable()
    .optional(),
  durationMinutes: z.int().min(1).max(600).nullable().optional(),
  /** For tests entered as totals (no sections); > 0. */
  maxMarks: optionalMark,
  marksPerCorrect: optionalMark,
  marksPerWrong: optionalMark,
  marksUnattempted: optionalMark,
  sections: z
    .array(
      z.strictObject({
        code: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(200),
        questionCount: z.int().min(1).max(500),
        marksPerCorrect: optionalMark,
        marksPerWrong: optionalMark,
        marksUnattempted: optionalMark,
        capMarks: optionalMark,
      }),
    )
    .max(20)
    .optional(),
  responsibleTeacherStaffId: staffMemberIdSchema.nullable().optional(),
  evaluatorStaffId: staffMemberIdSchema.nullable().optional(),
};

/** `POST /assessments`: create (draft, or scheduled when a date is given). */
export const createAssessmentInternalBody = z.strictObject({
  code: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, { error: 'Codes use letters, digits and - _ . :' }),
  kind: z.enum(ASSESSMENT_KINDS),
  ...assessmentFields,
});

/** `PATCH /assessments/{id}`: change fields, schedule or cancel (cancelling needs a reason). */
export const updateAssessmentInternalBody = z
  .strictObject({ ...assessmentFields, status: z.enum(['scheduled', 'cancelled']), reason })
  .partial()
  .refine((b) => b.status !== 'cancelled' || b.reason !== undefined, {
    error: 'Say why the assessment is cancelled.',
    path: ['reason'],
  });

const admissionNumber = z.string().trim().min(1).max(40);
/**
 * `POST /assessments/{id}/roster`: snapshot the eligible batches' placements on the scheduled date
 * (once; again → 409). Academic holds no admission numbers: Ops sends its admitted students'
 * numbers by core student id (read BEFORE calling); only rows on the roster copy theirs.
 */
export const rosterSnapshotBody = z.strictObject({
  admissionNumbers: z
    .array(z.strictObject({ coreStudentId: z.uuid(), admissionNumber }))
    .max(20000)
    .default([]),
});

/** `POST /assessments/{id}/finalise`: mirror the roster into attempts and write result version 1. */
export const finaliseResultsBody = z.strictObject({});

/** `POST /assessments/{id}/roster/corrections`: authorised add / remove / restore, with a reason. */
export const rosterCorrectionBody = z
  .strictObject({
    action: z.enum(['add', 'remove', 'restore']),
    studentId: studentIdSchema,
    /** The batch the added student sits with (required for add). */
    batchId: batchIdSchema.optional(),
    /** Ops admission number of an added student (copied, display only). */
    admissionNumber: admissionNumber.optional(),
    reason,
  })
  .refine((b) => b.action !== 'add' || b.batchId !== undefined, {
    error: 'Choose the batch of the added student.',
    path: ['batchId'],
  });

/**
 * `POST /assessments/{id}/scores`: attendance and marks from manual entry or a confirmed import,
 * all rows or none. Omitted attendance = unchanged (a score never marks a student present by
 * itself). Changing a verified score needs `overwriteVerified` and a reason. On final results the
 * change re-scores (result version + 1, and publication + 1 when published), so it needs a reason too.
 */
export const recordScoresBody = z
  .strictObject({
    source: z.enum(SCORE_SOURCES),
    /** Ops import job the rows came from (audit metadata; a repeat updates rows, never duplicates). */
    importRef: z.uuid().optional(),
    rows: z
      .array(
        z
          .strictObject({
            studentId: studentIdSchema,
            version: z.int().min(1),
            attendance: z.enum(ROSTER_ATTENDANCE).optional(),
            marksState: z.enum(ROSTER_MARKS_STATES),
            score: markTextSchema.nullable(),
          })
          .refine(rosterRefine, rosterError),
      )
      .min(1)
      .max(2000)
      .refine((rows) => new Set(rows.map((r) => r.studentId)).size === rows.length, {
        error: 'A student appears twice; nothing was saved.',
      }),
    overwriteVerified: z.boolean().default(false),
    reason: reason.optional(),
  })
  .refine((b) => !b.overwriteVerified || b.reason !== undefined, {
    error: 'Say why verified marks are changed.',
    path: ['reason'],
  });

/**
 * `POST /assessments/{id}/publications`: publish the final result version. `version` is the new
 * publication number (current highest + 1), so a retried call gets 409 instead of publishing twice.
 */
export const publishResultsBody = z
  .strictObject({
    version: z.int().min(1),
    rankingScope: z.enum(RANKING_SCOPES).default('roster'),
    cohortBatchIds: z.array(batchIdSchema).min(1).optional(),
    provisional: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((b) => (b.rankingScope === 'cohort') === (b.cohortBatchIds !== undefined), {
    error: 'Choose the cohort batches exactly when ranking a cohort.',
    path: ['cohortBatchIds'],
  });

/** `POST /assessments/{id}/publications/{version}/withdraw`. */
export const withdrawPublicationBody = z.strictObject({ reason });
