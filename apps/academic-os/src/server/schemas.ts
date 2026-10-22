/**
 * Request schemas for Academic OS routes (validated by `defineRoute`).
 * Dates are `YYYY-MM-DD` (Asia/Kolkata days); times are `HH:MM`; marks are
 * decimal strings with at most 4 decimals (exact; see domain/marks.ts).
 */
import { z } from 'zod';
import { phoneSchema, programmeCodeSchema } from '@elevate/shared-contracts';
import { isIsoDate } from '@elevate/shared-types';
import { isExactMark } from '../domain';

/** A real calendar date `YYYY-MM-DD` (Asia/Kolkata day), kept as a plain string for services. */
export const isoDateSchema = z.string().refine((v: string): boolean => Boolean(isIsoDate(v)), { error: 'Expected a calendar date in YYYY-MM-DD form' });
const code = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, {
  error: 'Codes use letters, digits and - _ . :',
});
export const text = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 2000) => z.string().trim().max(max).optional();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Use HH:MM (24 h)' });
const mark = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => isExactMark(v), { error: 'Marks must be decimals with at most 4 decimal places' });
const nullableMark = z.union([mark, z.null()]).optional();
const labelStatus = z.enum(['locked', 'approved', 'provisional', 'proposed', 'draft', 'unverified', 'unknown']);
const mode = z.enum(['offline', 'online', 'hybrid']);
export const uuidParams = z.object({ id: z.uuid() });

// --- curriculum --------------------------------------------------------------------------
export const createCourseBody = z
  .object({
    programmeCode: programmeCodeSchema,
    code,
    familyCode: code,
    version: z.int().min(1).default(1),
    name: text(),
    description: optionalText(),
    mode: mode.optional(),
    classMinutes: z.int().min(15).max(300).nullable().optional(),
    classMinutesStatus: labelStatus.default('unknown'),
    status: z.enum(['draft', 'active', 'paused', 'archived']).default('draft'),
  })
  .strict();

export const createSubjectBody = z
  .object({ code, name: text(), sortOrder: z.int().min(0).default(0) })
  .strict();

export const createChapterBody = z
  .object({
    subjectId: z.uuid(),
    code,
    title: text(),
    sortOrder: z.int().min(0).default(0),
    weight: z.int().min(1).max(10).default(1),
  })
  .strict();

export const retireChapterBody = z
  .object({ status: z.enum(['retired', 'moved']), aliasOfChapterId: z.uuid(), reason: text(500) })
  .strict();

export const createPlanBody = z
  .object({
    courseId: z.uuid(),
    batchId: z.uuid().optional(),
    code,
    title: text(),
    supersedesPlanId: z.uuid().optional(),
    /** Copy the predecessor's items into the new proposed version. */
    copyItems: z.boolean().default(false),
    classMinutes: z.int().min(15).max(300).optional(),
    countsStatus: labelStatus.default('proposed'),
    datesStatus: labelStatus.default('unknown'),
    scopeNote: optionalText(),
    changeLog: optionalText(),
  })
  .strict();

export const planItemsBody = z
  .object({
    items: z
      .array(
        z
          .object({
            chapterId: z.uuid(),
            lessonCode: code,
            sessionType: z.enum(['teaching', 'practice']),
            plannedClasses: z.int().min(1).max(500).default(1),
            plannedMinutes: z.int().min(1).max(100_000).optional(),
            plannedDate: isoDateSchema.optional(),
            coverage: optionalText(500),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const requestPlanApprovalBody = z
  .object({ targetStatus: z.enum(['locked', 'provisional']), comment: optionalText(1000) })
  .strict();

export const decidePlanApprovalBody = z
  .object({ decision: z.enum(['approved', 'rejected']), comment: optionalText(1000) })
  .strict();

// --- batches, calendars, timetable ---------------------------------------------------------
export const createBatchBody = z
  .object({
    code,
    name: text(),
    courseId: z.uuid(),
    route: z.enum(['regular', 'dropper', 'class11_two_year', 'fast_track']).optional(),
    mode: mode.optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    classMinutesOverride: z.int().min(15).max(300).optional(),
    capacity: z.int().min(1).max(10_000).optional(),
    targetExam: optionalText(200),
    targetExamDate: isoDateSchema.optional(),
    targetExamDateStatus: z.enum(['official', 'tentative', 'assumed', 'unverified']).optional(),
    status: z.enum(['planning', 'active', 'completed', 'cancelled']).default('planning'),
  })
  .strict()
  .refine((b) => !b.startDate || !b.endDate || b.startDate <= b.endDate, {
    error: 'startDate must not be after endDate',
    path: ['endDate'],
  })
  .refine((b) => !b.targetExamDate || b.targetExamDateStatus, {
    error: 'Give the exam date status (official, tentative, assumed or unverified)',
    path: ['targetExamDateStatus'],
  });

export const updateBatchBody = z
  .object({
    status: z.enum(['planning', 'active', 'completed', 'cancelled']).optional(),
    capacity: z.int().min(1).max(10_000).nullable().optional(),
    startDate: isoDateSchema.nullable().optional(),
    endDate: isoDateSchema.nullable().optional(),
    mode: mode.nullable().optional(),
    campus: z.string().trim().min(1).max(120).nullable().optional(),
    coordinatorStaffId: z.uuid().nullable().optional(),
  })
  .strict();

export const createAssignmentBody = z
  .object({
    batchId: z.uuid(),
    subjectId: z.uuid(),
    staffMemberId: z.uuid(),
    employmentType: z.enum(['full_time', 'part_time']).optional(),
    role: z.enum(['primary', 'co_teacher', 'substitute']).default('primary'),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .strict()
  .refine((a) => !a.startDate || !a.endDate || a.startDate <= a.endDate, { error: 'The end date cannot be before the start date.', path: ['endDate'] });

export const createRoomBody = z
  .object({ code, name: text(), capacity: z.int().min(1).max(10_000).optional() })
  .strict();

export const createExclusionBody = z
  .object({
    batchId: z.uuid().optional(),
    kind: z.enum(['holiday', 'school_exam', 'exam_blackout', 'other']),
    label: text(),
    date: isoDateSchema.optional(),
    periodStart: isoDateSchema.optional(),
    periodEnd: isoDateSchema.optional(),
    days: z.int().min(0).max(366).optional(),
    slotsPerDay: z.int().min(0).max(24).optional(),
    status: z.enum(['provisional', 'confirmed', 'locked', 'unverified']).default('provisional'),
  })
  .strict()
  .refine((x) => Boolean(x.date) !== Boolean(x.periodStart && x.periodEnd), {
    error: 'Give either a date, or periodStart and periodEnd',
    path: ['date'],
  })
  .refine((x) => !x.periodStart || !x.periodEnd || x.periodStart <= x.periodEnd, {
    error: 'periodStart must not be after periodEnd',
    path: ['periodEnd'],
  })
  .refine((x) => x.date || x.kind === 'exam_blackout' || (x.days !== undefined && x.slotsPerDay !== undefined), {
    error: 'An undated allowance needs days and slotsPerDay',
    path: ['days'],
  });

export const createCalendarRuleBody = z
  .object({
    batchId: z.uuid(),
    label: text(),
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    weekdays: z.array(z.int().min(1).max(7)).min(1).max(7),
    slotsPerDay: z.int().min(1).max(12),
    kind: z.enum(['regular', 'extra']).default('regular'),
    status: labelStatus.default('provisional'),
  })
  .strict()
  .refine((r) => r.periodStart <= r.periodEnd, { error: 'periodStart must not be after periodEnd', path: ['periodEnd'] });

const sessionType = z.enum(['teaching', 'practice', 'catch_up', 'test', 'discussion']);
export const sessionInput = z
  .object({
    batchId: z.uuid(),
    subjectId: z.uuid().optional(),
    plannedChapterId: z.uuid().optional(),
    teacherStaffId: z.uuid().optional(),
    roomId: z.uuid().optional(),
    sessionType: sessionType.default('teaching'),
    date: isoDateSchema,
    startTime: clock,
    durationMinutes: z.int().min(5).max(600),
    onlineLink: z.url().max(500).optional(),
  })
  .strict();

export const createSessionsBody = z
  .object({ sessions: z.array(sessionInput).min(1).max(200) })
  .strict();

export const checkTimetableBody = z
  .object({
    batchId: z.uuid().optional(),
    from: isoDateSchema,
    to: isoDateSchema,
    candidates: z.array(sessionInput).max(200).default([]),
  })
  .strict()
  .refine((b) => b.from <= b.to, { error: 'from must not be after to', path: ['to'] });

export const cancelSessionBody = z.object({ reason: text(1000) }).strict();

export const rescheduleSessionBody = z
  .object({
    date: isoDateSchema,
    startTime: clock,
    durationMinutes: z.int().min(5).max(600).optional(),
    teacherStaffId: z.uuid().optional(),
    roomId: z.uuid().nullable().optional(),
    reason: text(1000),
  })
  .strict();

export const timetableQuery = z.object({
  batchId: z.uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  teacherId: z.uuid().optional(),
  roomId: z.uuid().optional(),
  status: z.enum(['scheduled', 'held', 'cancelled', 'rescheduled']).optional(),
});

export const feasibilityQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

// --- teaching operations ---------------------------------------------------------------------
/** Marks for enrolled students and demo attendees; changing an existing mark needs `reason` (audited). */
export const attendanceBody = z
  .object({
    marks: z
      .array(
        z
          .object({
            studentId: z.uuid(),
            status: z.enum(['present', 'partial', 'late', 'absent', 'excused']),
            minutesPresent: z.int().min(0).max(600).optional(),
            note: optionalText(500),
          })
          .strict(),
      )
      .max(500)
      .default([]),
    demoMarks: z
      .array(z.object({ attendeeId: z.uuid(), status: z.enum(['present', 'late', 'absent', 'excused']), note: optionalText(500) }).strict())
      .max(200)
      .default([]),
    reason: optionalText(500),
  })
  .strict()
  .refine((b) => b.marks.length + b.demoMarks.length > 0, { error: 'Mark at least one student.', path: ['marks'] });

// --- assessments --------------------------------------------------------------------------------
export const assessmentKind = z.enum(['chapter_test', 'sectional', 'full_mock', 'practice']);

export const sectionBody = z
  .object({
    code,
    name: text(),
    questionCount: z.int().min(1).max(500),
    answerFormat: z.enum(['choice', 'numeric']).default('choice'),
    options: z.array(z.string().trim().min(1).max(20)).min(2).max(10).default(['A', 'B', 'C', 'D']),
    timeLimitMinutes: z.int().min(1).max(600).optional(),
    marksPerCorrect: nullableMark,
    marksPerWrong: nullableMark,
    marksUnattempted: nullableMark,
    capMarks: nullableMark,
  })
  .strict();

export const createAssessmentBody = z
  .object({
    code,
    title: text(),
    kind: assessmentKind,
    batchId: z.uuid(),
    subjectId: z.uuid().optional(),
    chapterIds: z.array(z.uuid()).max(100).default([]),
    scheduledDate: isoDateSchema.optional(),
    startTime: clock.optional(),
    durationMinutes: z.int().min(1).max(600).optional(),
    discussionMinutes: z.int().min(0).max(600).optional(),
    patternRef: optionalText(200),
    marksPerCorrect: nullableMark,
    marksPerWrong: nullableMark,
    marksUnattempted: nullableMark,
    sections: z.array(sectionBody).max(20).default([]),
  })
  .strict();

export const scoringBody = z
  .object({
    marksPerCorrect: nullableMark,
    marksPerWrong: nullableMark,
    marksUnattempted: nullableMark,
    sections: z.array(sectionBody).min(1).max(20),
  })
  .strict();

export const answerKeyBody = z
  .object({
    answers: z.record(z.string().min(1).max(80), z.array(z.string().trim().max(40).nullable()).max(500)),
    note: optionalText(500),
  })
  .strict();

export const attemptsBody = z
  .object({
    csv: z.string().max(500_000).optional(),
    attempts: z
      .array(
        z
          .object({
            studentId: z.uuid(),
            status: z.enum(['submitted', 'absent']),
            keyVersion: z.int().min(1).nullable().optional(),
            responses: z.record(z.string(), z.array(z.string().max(40).nullable())).nullable().optional(),
          })
          .strict(),
      )
      .max(2000)
      .optional(),
  })
  .strict()
  .refine((b) => Boolean(b.csv) !== Boolean(b.attempts), { error: 'Send either csv or attempts', path: ['csv'] });

export const rescoreBody = z.object({ reason: text(1000) }).strict();

export const scheduleCheckBody = z
  .object({
    batchId: z.uuid(),
    candidates: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            label: text(),
            date: isoDateSchema,
            startTime: clock.nullable().optional(),
            durationMinutes: z.int().min(1).max(600).nullable().optional(),
            discussionDate: isoDateSchema.nullable().optional(),
            chapterIds: z.array(z.uuid()).max(100).default([]),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();

// --- students, enrolments, progress -----------------------------------------------------------
export const createStudentBody = z
  .object({
    fullName: text(),
    preferredName: optionalText(200),
    dateOfBirth: isoDateSchema.optional(),
    currentStage: z.enum(['class_9', 'class_10', 'class_11', 'class_12', 'gap_year', 'graduate', 'other']).optional(),
    schoolBoard: optionalText(60),
    email: z.email().optional(),
    phone: phoneSchema.optional(),
    city: optionalText(100),
    guardianName: optionalText(200),
    guardianRelationship: z.enum(['mother', 'father', 'guardian', 'other']).optional(),
    guardianEmail: z.email().optional(),
    guardianPhone: phoneSchema.optional(),
  })
  .strict();

export const manualEnrolmentBody = z
  .object({
    studentId: z.uuid(),
    batchId: z.uuid(),
    startDate: isoDateSchema.optional(),
    reason: text(1000),
  })
  .strict();

export const studentsQuery = z.object({ batchId: z.uuid().optional(), q: z.string().max(100).optional() });

export const catchupUpdateBody = z
  .object({
    status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
    assignedStaffId: z.uuid().nullable().optional(),
    dueDate: isoDateSchema.nullable().optional(),
    note: optionalText(1000),
  })
  .strict();

export const interventionTrigger = z.enum([
  'repeated_absence',
  'declining_scores',
  'low_scores',
  'missed_assessments',
  'overdue_catch_up',
  'other',
]);

export const createInterventionBody = z
  .object({
    studentId: z.uuid(),
    batchId: z.uuid().optional(),
    trigger: interventionTrigger,
    description: text(2000),
    responsibleStaffId: z.uuid(),
    action: text(2000),
    dueDate: isoDateSchema.optional(),
    evidence: optionalText(2000),
    goal: optionalText(2000),
    reviewOn: isoDateSchema.optional(),
  })
  .strict();

export const updateInterventionBody = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    outcome: optionalText(2000),
    parentContactStatus: z.enum(['not_contacted', 'contacted', 'unreachable', 'not_required']).optional(),
    action: optionalText(2000),
    evidence: optionalText(2000),
    goal: optionalText(2000),
    responsibleStaffId: z.uuid().optional(),
    dueDate: isoDateSchema.nullable().optional(),
    reviewOn: isoDateSchema.nullable().optional(),
  })
  .strict();

export const settingBody = z
  .object({
    value: z.unknown(),
    status: z.enum(['proposed', 'approved']),
    /** The owner's recorded decision (D-0xx / OD-0xx); required to approve a new value. */
    decisionRef: z.string().trim().regex(/^(D|OD)-\d{3}$/, { error: 'Use the decision reference, e.g. D-061 or OD-012' }).optional(),
  })
  .strict();
export const settingParams = z.object({ key: z.string().min(1).max(100) });

export const summaryQuery = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() });
export const plansQuery = z.object({ courseId: z.uuid().optional() });
export const coverageQuery = z.object({ asOf: isoDateSchema.optional() });
export const exclusionsQuery = z.object({ batchId: z.uuid().optional() });
export const assessmentsQuery = z.object({ batchId: z.uuid().optional() });
export const resultsQuery = z.object({ version: z.coerce.number().int().min(1).optional() });
export const enrolmentsQuery = z.object({ batchId: z.uuid().optional() });
export const interventionsQuery = z.object({ studentId: z.uuid().optional(), responsible: z.literal('me').optional() });
