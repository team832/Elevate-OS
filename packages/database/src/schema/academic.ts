/**
 * OWNER: Academic OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Tables of the `academic` schema: batches, teachers' assignments, rooms, calendars,
 * timetable, class records, students, enrolments, attendance, catch-up, interventions,
 * settings (D-010). Curriculum lives in academic-curriculum.ts, assessments and results in
 * academic-assessments.ts.
 *
 * Rules (D-005, D-009):
 * - Declare every table with `academic.table(...)` so it lands in the `academic` schema.
 * - Prefix every export with `academic` (e.g. `academicBatches`) — export names must be
 *   unique across all four schema files because they are merged into one Drizzle schema.
 * - Primary keys: `uuid('id').primaryKey().defaultRandom()`. Human codes are separate
 *   unique columns.
 * - Foreign keys may point INTO `core` (import tables from './core'); never into
 *   `marketing` or `ops` — store the other module's UUID (e.g. the ops admission id on an
 *   enrolment) and validate it via a contract.
 * - Only `import type` from workspace packages (drizzle-kit loads this file directly).
 * - Do not run `drizzle-kit generate`; tests build the schema with `createTestDb()`.
 *
 * Status words (D-013/D-016): planning labels (`locked`, `provisional`, `proposed`,
 * `superseded`) describe PLANS; delivery is only ever recorded in class records,
 * attendance and results. Nothing planned is stored as delivered.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  BatchId,
  Brand,
  CourseId,
  EnrolmentId,
  ProgrammeId,
  StaffMemberId,
  StudentId,
  StudentIdentityId,
  UserId,
} from '@elevate/shared-types';
import { ACADEMIC_TEACHER_ROLES, academic, createdAt, inList, updatedAt } from './academic-columns';
import {
  ACADEMIC_LABEL_STATUSES,
  ACADEMIC_MODES,
  academicChapters,
  academicCourses,
  academicSubjects,
  type AcademicChapterId,
  type AcademicSubjectId,
} from './academic-curriculum';
import { academicTimetablePatterns, type AcademicPatternId } from './academic-delivery';
import { programmes, staffMembers, students as coreStudents, users } from './core';

export { ACADEMIC_TEACHER_ROLES, academic };

// --- Academic-local branded ids (the shared ones come from @elevate/shared-types) ---------
export type AcademicRoomId = Brand<string, 'AcademicRoomId'>;
export type AcademicSessionId = Brand<string, 'AcademicSessionId'>;
export type AcademicClassRecordId = Brand<string, 'AcademicClassRecordId'>;
export type AcademicAssignmentId = Brand<string, 'AcademicAssignmentId'>;
export type AcademicInterventionId = Brand<string, 'AcademicInterventionId'>;
export type AcademicCatchupTaskId = Brand<string, 'AcademicCatchupTaskId'>;

// --- vocabularies (mirrored by apps/academic-os/src/domain/vocabulary.ts) ------------------
export const ACADEMIC_BATCH_ROUTES = [
  'regular',
  'dropper',
  'class11_two_year',
  'fast_track',
] as const;
export const ACADEMIC_BATCH_STATUSES = ['planning', 'active', 'completed', 'cancelled'] as const;
export const ACADEMIC_SESSION_TYPES = [
  'teaching',
  'practice',
  'catch_up',
  'test',
  'discussion',
] as const;
/** `held` = delivered: set only by an explicit "mark delivered" action (R12), never by attendance or a log. */
export const ACADEMIC_SESSION_STATUSES = ['scheduled', 'held', 'cancelled', 'rescheduled'] as const;
export const ACADEMIC_SESSION_KINDS = ['regular', 'makeup', 'doubt', 'extra'] as const;
export const ACADEMIC_RECORD_STATES = ['draft', 'submitted', 'verified', 'superseded'] as const;
/** `main` = first teaching (introduced); only `main` rows count as coverage (R11). */
export const ACADEMIC_RECORD_ACTIVITIES = [
  'main',
  'practice',
  'catch_up',
  'test',
  'discussion',
  'revision',
  'doubt_solving',
] as const;
export const ACADEMIC_ATTENDANCE_STATUSES = [
  'present',
  'partial',
  'late',
  'absent',
  'excused',
] as const;
export const ACADEMIC_ENROLMENT_STATUSES = ['active', 'paused', 'withdrawn', 'completed'] as const;
export const ACADEMIC_EXCLUSION_KINDS = [
  'holiday',
  'school_exam',
  'exam_blackout',
  'other',
] as const;

/** A cohort that follows one course version (ACD-002). */
export const academicBatches = academic.table(
  'batches',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<BatchId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => academicCourses.id, { onDelete: 'restrict' })
      .$type<CourseId>(),
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    route: text('route', { enum: ACADEMIC_BATCH_ROUTES }),
    mode: text('mode', { enum: ACADEMIC_MODES }),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    /** Overrides the course's class length for this batch only. */
    classMinutesOverride: integer('class_minutes_override'),
    /** Seat limit; null = not set (no BATCH_FULL check). */
    capacity: integer('capacity'),
    targetExam: text('target_exam'),
    targetExamDate: date('target_exam_date', { mode: 'string' }),
    /** official | tentative | assumed | unverified (ACD-024): unverified dates are flagged in every check. */
    targetExamDateStatus: text('target_exam_date_status', {
      enum: ['official', 'tentative', 'assumed', 'unverified'],
    }),
    status: text('status', { enum: ACADEMIC_BATCH_STATUSES }).notNull().default('planning'),
    campus: text('campus'),
    coordinatorStaffId: uuid('coordinator_staff_id')
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    isSample: boolean('is_sample').notNull().default(false),
    sourceRef: text('source_ref'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('batches_code_key').on(t.code),
    index('batches_course_idx').on(t.courseId),
    index('batches_coordinator_idx').on(t.coordinatorStaffId),
    index('batches_programme_status_idx').on(t.programmeId, t.status),
    check('batches_status_check', sql`${t.status} IN (${inList(ACADEMIC_BATCH_STATUSES)})`),
    check(
      'batches_route_check',
      sql`${t.route} IS NULL OR ${t.route} IN (${inList(ACADEMIC_BATCH_ROUTES)})`,
    ),
    check('batches_mode_check', sql`${t.mode} IS NULL OR ${t.mode} IN (${inList(ACADEMIC_MODES)})`),
    check(
      'batches_dates_order',
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`,
    ),
    check('batches_capacity_positive', sql`${t.capacity} IS NULL OR ${t.capacity} >= 1`),
    check(
      'batches_class_minutes_positive',
      sql`${t.classMinutesOverride} IS NULL OR ${t.classMinutesOverride} > 0`,
    ),
    check(
      'batches_exam_date_status_check',
      sql`${t.targetExamDateStatus} IS NULL OR ${t.targetExamDateStatus} IN ('official', 'tentative', 'assumed', 'unverified')`,
    ),
  ],
);

/** Teacher (core staff member) → subject → batch (ACD-003). */
export const academicTeacherAssignments = academic.table(
  'teacher_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicAssignmentId>(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'cascade' })
      .$type<BatchId>(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => academicSubjects.id, { onDelete: 'restrict' })
      .$type<AcademicSubjectId>(),
    staffMemberId: uuid('staff_member_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    employmentType: text('employment_type', { enum: ['full_time', 'part_time'] }),
    role: text('role', { enum: ACADEMIC_TEACHER_ROLES }).notNull().default('primary'),
    status: text('status', { enum: ['active', 'ended'] })
      .notNull()
      .default('active'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('teacher_assignments_active_key')
      .on(t.batchId, t.subjectId, t.staffMemberId)
      .where(sql`${t.status} = 'active'`),
    index('teacher_assignments_staff_idx').on(t.staffMemberId, t.status),
    check('teacher_assignments_status_check', sql`${t.status} IN ('active', 'ended')`),
    check('teacher_assignments_role_check', sql`${t.role} IN (${inList(ACADEMIC_TEACHER_ROLES)})`),
    check(
      'teacher_assignments_employment_check',
      sql`${t.employmentType} IS NULL OR ${t.employmentType} IN ('full_time', 'part_time')`,
    ),
    check(
      'teacher_assignments_dates_order',
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`,
    ),
  ],
);

/** Optional rooms (online sessions have none). */
export const academicRooms = academic.table(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicRoomId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    capacity: integer('capacity'),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('rooms_code_key').on(t.code),
    check('rooms_status_check', sql`${t.status} IN ('active', 'inactive')`),
    check('rooms_capacity_positive', sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
  ],
);

/**
 * Holiday / closure / exam-blackout calendar (ACD-009). Two shapes:
 * - DATED: `date` set — one closed day (or a blackout day for assessments);
 * - UNDATED ALLOWANCE: `periodStart`/`periodEnd` + `days` + `slotsPerDay` —
 *   e.g. the Class 12 "1 holiday day in April × 2 slots" reservation.
 * `batchId` null = applies to every batch (centre-wide).
 */
export const academicCalendarExclusions = academic.table(
  'calendar_exclusions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .references(() => academicBatches.id, { onDelete: 'cascade' })
      .$type<BatchId>(),
    kind: text('kind', { enum: ACADEMIC_EXCLUSION_KINDS }).notNull(),
    label: text('label').notNull(),
    date: date('date', { mode: 'string' }),
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    days: integer('days'),
    slotsPerDay: integer('slots_per_day'),
    status: text('status', { enum: ['provisional', 'confirmed', 'locked', 'unverified'] })
      .notNull()
      .default('provisional'),
    sourceRef: text('source_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    index('calendar_exclusions_batch_date_idx').on(t.batchId, t.date),
    check(
      'calendar_exclusions_kind_check',
      sql`${t.kind} IN (${inList(ACADEMIC_EXCLUSION_KINDS)})`,
    ),
    check(
      'calendar_exclusions_status_check',
      sql`${t.status} IN ('provisional', 'confirmed', 'locked', 'unverified')`,
    ),
    check(
      'calendar_exclusions_shape',
      sql`(${t.date} IS NOT NULL AND ${t.periodStart} IS NULL AND ${t.periodEnd} IS NULL AND ${t.days} IS NULL AND ${t.slotsPerDay} IS NULL) OR (${t.date} IS NULL AND ${t.periodStart} IS NOT NULL AND ${t.periodEnd} IS NOT NULL AND ${t.periodStart} <= ${t.periodEnd} AND (${t.kind} = 'exam_blackout' OR (${t.days} IS NOT NULL AND ${t.slotsPerDay} IS NOT NULL)) AND COALESCE(${t.days}, 1) > 0 AND COALESCE(${t.slotsPerDay}, 1) > 0)`,
    ),
  ],
);

/**
 * Weekly calendar rules that generate gross class slots for a batch (ACD-010/011),
 * e.g. Mon–Fri × 2 from 1 Apr to 30 Jun; Tue/Thu +1 extra from 1 Jul.
 * Weekdays are ISO numbers (1 = Monday … 7 = Sunday).
 */
export const academicCalendarRules = academic.table(
  'calendar_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'cascade' })
      .$type<BatchId>(),
    label: text('label').notNull(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    weekdays: integer('weekdays').array().notNull(),
    slotsPerDay: integer('slots_per_day').notNull(),
    /** `regular` days count as teaching days; `extra` adds slots on days already counted. */
    kind: text('kind', { enum: ['regular', 'extra'] })
      .notNull()
      .default('regular'),
    status: text('status', { enum: ACADEMIC_LABEL_STATUSES }).notNull().default('provisional'),
    sourceRef: text('source_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    index('calendar_rules_batch_idx').on(t.batchId),
    check('calendar_rules_period_order', sql`${t.periodStart} <= ${t.periodEnd}`),
    check('calendar_rules_slots_positive', sql`${t.slotsPerDay} >= 1`),
    check('calendar_rules_kind_check', sql`${t.kind} IN ('regular', 'extra')`),
    check('calendar_rules_status_check', sql`${t.status} IN (${inList(ACADEMIC_LABEL_STATUSES)})`),
    check('calendar_rules_weekdays_range', sql`${t.weekdays} <@ ARRAY[1, 2, 3, 4, 5, 6, 7]`),
  ],
);

/**
 * Scheduled class sessions (the timetable). Status moves scheduled → held |
 * cancelled | rescheduled. A reschedule creates a NEW session linked by
 * `rescheduledFromSessionId`; the original keeps its row and reason.
 */
export const academicClassSessions = academic.table(
  'class_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicSessionId>(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    subjectId: uuid('subject_id')
      .references(() => academicSubjects.id, { onDelete: 'restrict' })
      .$type<AcademicSubjectId>(),
    /** Chapter planned for the session (the class record says what was actually covered). */
    plannedChapterId: uuid('planned_chapter_id')
      .references(() => academicChapters.id, { onDelete: 'restrict' })
      .$type<AcademicChapterId>(),
    teacherStaffId: uuid('teacher_staff_id')
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    roomId: uuid('room_id')
      .references(() => academicRooms.id, { onDelete: 'restrict' })
      .$type<AcademicRoomId>(),
    sessionType: text('session_type', { enum: ACADEMIC_SESSION_TYPES })
      .notNull()
      .default('teaching'),
    date: date('date', { mode: 'string' }).notNull(),
    /** Local (Asia/Kolkata) start time `HH:MM`. */
    startTime: text('start_time').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    status: text('status', { enum: ACADEMIC_SESSION_STATUSES }).notNull().default('scheduled'),
    statusReason: text('status_reason'),
    rescheduledFromSessionId: uuid('rescheduled_from_session_id')
      .references((): AnyPgColumn => academicClassSessions.id, { onDelete: 'restrict' })
      .$type<AcademicSessionId>(),
    onlineLink: text('online_link'),
    /** The published pattern this occurrence was generated from (null = one-off session). */
    patternId: uuid('pattern_id')
      .references((): AnyPgColumn => academicTimetablePatterns.id, { onDelete: 'restrict' })
      .$type<AcademicPatternId>(),
    kind: text('kind', { enum: ACADEMIC_SESSION_KINDS }).notNull().default('regular'),
    makeupForSessionId: uuid('makeup_for_session_id')
      .references((): AnyPgColumn => academicClassSessions.id, { onDelete: 'restrict' })
      .$type<AcademicSessionId>(),
    /** Explicit "mark delivered" (R12); actual teachers are in session_teachers. */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveredByUserId: uuid('delivered_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    deliveryNote: text('delivery_note'),
    /** Optimistic concurrency: writers compare and increment. */
    version: integer('version').notNull().default(1),
    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('class_sessions_batch_date_idx').on(t.batchId, t.date),
    uniqueIndex('class_sessions_pattern_date_key')
      .on(t.patternId, t.date)
      .where(sql`${t.patternId} IS NOT NULL`),
    check('class_sessions_kind_check', sql`${t.kind} IN (${inList(ACADEMIC_SESSION_KINDS)})`),
    check(
      'class_sessions_makeup_link',
      sql`${t.makeupForSessionId} IS NULL OR ${t.kind} = 'makeup'`,
    ),
    check(
      'class_sessions_delivery_pair',
      sql`(${t.deliveredAt} IS NULL) = (${t.deliveredByUserId} IS NULL)`,
    ),
    index('class_sessions_teacher_date_idx').on(t.teacherStaffId, t.date),
    index('class_sessions_room_date_idx').on(t.roomId, t.date),
    check(
      'class_sessions_type_check',
      sql`${t.sessionType} IN (${inList(ACADEMIC_SESSION_TYPES)})`,
    ),
    check(
      'class_sessions_status_check',
      sql`${t.status} IN (${inList(ACADEMIC_SESSION_STATUSES)})`,
    ),
    check(
      'class_sessions_start_time_format',
      sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check('class_sessions_duration_range', sql`${t.durationMinutes} BETWEEN 5 AND 600`),
    check(
      'class_sessions_reason_required',
      sql`${t.status} NOT IN ('cancelled', 'rescheduled') OR ${t.statusReason} IS NOT NULL`,
    ),
  ],
);

/**
 * Teaching log (ACD-007): what was actually taught in a held session, per chapter.
 * Corrections never overwrite: a correction is a NEW row with `correctsRecordId`
 * and a reason; the original becomes `superseded` with its content unchanged.
 * Only `verified` records count as delivered (BR-ACD-11).
 */
export const academicClassRecords = academic.table(
  'class_records',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicClassRecordId>(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => academicClassSessions.id, { onDelete: 'restrict' })
      .$type<AcademicSessionId>(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => academicChapters.id, { onDelete: 'restrict' })
      .$type<AcademicChapterId>(),
    teacherStaffId: uuid('teacher_staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    activity: text('activity', { enum: ACADEMIC_RECORD_ACTIVITIES }).notNull().default('main'),
    completion: text('completion', { enum: ['completed', 'partial'] }).notNull(),
    actualMinutes: integer('actual_minutes').notNull(),
    notes: text('notes'),
    evidence: text('evidence'),
    materials: text('materials'),
    homework: text('homework'),
    homeworkDueOn: date('homework_due_on', { mode: 'string' }),
    difficulties: text('difficulties'),
    nextPlan: text('next_plan'),
    catchUpNeeded: text('catch_up_needed'),
    state: text('state', { enum: ACADEMIC_RECORD_STATES }).notNull().default('submitted'),
    /** Null while `draft`; drafts are private to the author and never count. */
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    correctsRecordId: uuid('corrects_record_id')
      .references((): AnyPgColumn => academicClassRecords.id, { onDelete: 'restrict' })
      .$type<AcademicClassRecordId>(),
    correctionReason: text('correction_reason'),
    recordedByUserId: uuid('recorded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedByUserId: uuid('verified_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('class_records_current_key')
      .on(t.sessionId, t.chapterId)
      .where(sql`${t.state} <> 'superseded'`),
    index('class_records_batch_idx').on(t.batchId, t.state),
    index('class_records_teacher_idx').on(t.teacherStaffId),
    check('class_records_state_check', sql`${t.state} IN (${inList(ACADEMIC_RECORD_STATES)})`),
    check('class_records_minutes_range', sql`${t.actualMinutes} BETWEEN 1 AND 600`),
    check(
      'class_records_activity_check',
      sql`${t.activity} IN (${inList(ACADEMIC_RECORD_ACTIVITIES)})`,
    ),
    check(
      'class_records_draft_unsubmitted',
      sql`${t.state} <> 'draft' OR ${t.submittedAt} IS NULL`,
    ),
    check('class_records_completion_check', sql`${t.completion} IN ('completed', 'partial')`),
    check(
      'class_records_verification_pair',
      sql`(${t.verifiedByUserId} IS NULL) = (${t.verifiedAt} IS NULL)`,
    ),
    check(
      'class_records_correction_reason',
      sql`${t.correctsRecordId} IS NULL OR ${t.correctionReason} IS NOT NULL`,
    ),
  ],
);

/**
 * Students (ACD-019). Minimal personal data (PLT-014); a guardian contact for
 * minors. `sourceAdmissionId` is the Business Ops admission UUID (no FK across
 * modules, D-005) and makes intake idempotent: one student per admission.
 */
export const academicStudents = academic.table(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<StudentId>(),
    code: text('code').notNull(),
    fullName: text('full_name').notNull(),
    preferredName: text('preferred_name'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    currentStage: text('current_stage'),
    schoolBoard: text('school_board'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    guardianName: text('guardian_name'),
    guardianRelationship: text('guardian_relationship'),
    guardianEmail: text('guardian_email'),
    guardianPhone: text('guardian_phone'),
    sourceAdmissionId: uuid('source_admission_id'),
    sourceLeadId: uuid('source_lead_id'),
    /** The canonical person (core.students); one academic student per person. */
    coreStudentId: uuid('core_student_id')
      .references(() => coreStudents.id, { onDelete: 'restrict' })
      .$type<StudentIdentityId>(),
    isSample: boolean('is_sample').notNull().default(false),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('students_code_key').on(t.code),
    uniqueIndex('students_core_student_key')
      .on(t.coreStudentId)
      .where(sql`${t.coreStudentId} IS NOT NULL`),
    uniqueIndex('students_source_admission_key')
      .on(t.sourceAdmissionId)
      .where(sql`${t.sourceAdmissionId} IS NOT NULL`),
    check('students_status_check', sql`${t.status} IN ('active', 'inactive')`),
  ],
);

/**
 * Enrolments (ACD-019): created ONLY by the intake consumer (one per request
 * event) or manually by a coordinator with a reason. Academic owns them.
 */
export const academicEnrolments = academic.table(
  'enrolments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<EnrolmentId>(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    courseId: uuid('course_id')
      .references(() => academicCourses.id, { onDelete: 'restrict' })
      .$type<CourseId>(),
    batchId: uuid('batch_id')
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    status: text('status', { enum: ACADEMIC_ENROLMENT_STATUSES }).notNull().default('active'),
    startDate: date('start_date', { mode: 'string' }),
    /** Academic-year label from the admission, e.g. `2026-27` (a label, not a date). */
    academicYear: text('academic_year'),
    /** Joined after the batch start: missed topics are computed from the plan (ACD-020). */
    lateJoiner: boolean('late_joiner').notNull().default(false),
    source: text('source', { enum: ['admission_event', 'manual'] }).notNull(),
    manualReason: text('manual_reason'),
    sourceAdmissionId: uuid('source_admission_id'),
    sourceLeadId: uuid('source_lead_id'),
    /** The `ops.admission.enrolment_requested` event this answers (one enrolment per event). */
    requestEventId: uuid('request_event_id'),
    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('enrolments_request_event_key')
      .on(t.requestEventId)
      .where(sql`${t.requestEventId} IS NOT NULL`),
    uniqueIndex('enrolments_active_student_batch_key')
      .on(t.studentId, t.batchId)
      .where(sql`${t.status} = 'active' AND ${t.batchId} IS NOT NULL`),
    uniqueIndex('enrolments_active_student_course_key')
      .on(t.studentId, t.courseId)
      .where(sql`${t.status} = 'active' AND ${t.courseId} IS NOT NULL`),
    index('enrolments_batch_status_idx').on(t.batchId, t.status),
    index('enrolments_student_idx').on(t.studentId),
    check('enrolments_status_check', sql`${t.status} IN (${inList(ACADEMIC_ENROLMENT_STATUSES)})`),
    check('enrolments_source_check', sql`${t.source} IN ('admission_event', 'manual')`),
    check(
      'enrolments_manual_reason',
      sql`${t.source} <> 'manual' OR ${t.manualReason} IS NOT NULL`,
    ),
    check(
      'enrolments_event_has_request',
      sql`${t.source} <> 'admission_event' OR ${t.requestEventId} IS NOT NULL`,
    ),
  ],
);

/**
 * Outcome log of the `academic.enrolment-intake` consumer: one row per request
 * event, with the reply event published in the same transaction. Feeds the
 * intake queue screen; failed/dead deliveries are read from core.event_deliveries.
 */
export const academicEnrolmentIntakeLog = academic.table(
  'enrolment_intake_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestEventId: uuid('request_event_id').notNull(),
    admissionId: uuid('admission_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    attempt: integer('attempt').notNull(),
    programmeCode: text('programme_code').notNull(),
    studentName: text('student_name').notNull(),
    outcome: text('outcome', { enum: ['confirmed', 'rejected'] }).notNull(),
    reasonCode: text('reason_code'),
    reason: text('reason'),
    studentId: uuid('student_id')
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    enrolmentId: uuid('enrolment_id')
      .references(() => academicEnrolments.id, { onDelete: 'restrict' })
      .$type<EnrolmentId>(),
    existingStudent: boolean('existing_student'),
    replyEventId: uuid('reply_event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('enrolment_intake_log_request_key').on(t.requestEventId),
    index('enrolment_intake_log_processed_idx').on(t.processedAt),
    check('enrolment_intake_log_outcome_check', sql`${t.outcome} IN ('confirmed', 'rejected')`),
    check(
      'enrolment_intake_log_outcome_shape',
      sql`(${t.outcome} = 'confirmed' AND ${t.enrolmentId} IS NOT NULL AND ${t.studentId} IS NOT NULL) OR (${t.outcome} = 'rejected' AND ${t.reasonCode} IS NOT NULL)`,
    ),
  ],
);

/** Attendance per student per held session (ACD-014). Missing rows = not recorded, never 0 %. */
export const academicAttendance = academic.table(
  'attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => academicClassSessions.id, { onDelete: 'restrict' })
      .$type<AcademicSessionId>(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    status: text('status', { enum: ACADEMIC_ATTENDANCE_STATUSES }).notNull(),
    minutesPresent: integer('minutes_present'),
    note: text('note'),
    recordedByUserId: uuid('recorded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attendance_session_student_key').on(t.sessionId, t.studentId),
    index('attendance_student_idx').on(t.studentId),
    check('attendance_status_check', sql`${t.status} IN (${inList(ACADEMIC_ATTENDANCE_STATUSES)})`),
    check(
      'attendance_minutes_range',
      sql`${t.minutesPresent} IS NULL OR (${t.minutesPresent} BETWEEN 0 AND 600)`,
    ),
  ],
);

/** Catch-up work for a missed class (ACD-020). Priority is computed on read (domain/catchup.ts). */
export const academicCatchupTasks = academic.table(
  'catchup_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicCatchupTaskId>(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    enrolmentId: uuid('enrolment_id')
      .notNull()
      .references(() => academicEnrolments.id, { onDelete: 'restrict' })
      .$type<EnrolmentId>(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => academicClassSessions.id, { onDelete: 'restrict' })
      .$type<AcademicSessionId>(),
    chapterId: uuid('chapter_id')
      .references(() => academicChapters.id, { onDelete: 'restrict' })
      .$type<AcademicChapterId>(),
    reason: text('reason', { enum: ['absent', 'excused', 'late_joiner'] }).notNull(),
    status: text('status', { enum: ['open', 'in_progress', 'done', 'cancelled'] })
      .notNull()
      .default('open'),
    assignedStaffId: uuid('assigned_staff_id')
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    dueDate: date('due_date', { mode: 'string' }),
    note: text('note'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('catchup_tasks_enrolment_session_key').on(t.enrolmentId, t.sessionId),
    index('catchup_tasks_batch_status_idx').on(t.batchId, t.status),
    check('catchup_tasks_reason_check', sql`${t.reason} IN ('absent', 'excused', 'late_joiner')`),
    check(
      'catchup_tasks_status_check',
      sql`${t.status} IN ('open', 'in_progress', 'done', 'cancelled')`,
    ),
  ],
);

/** Interventions with a responsible staff member (ACD-022). */
export const academicInterventions = academic.table(
  'interventions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicInterventionId>(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => academicStudents.id, { onDelete: 'restrict' })
      .$type<StudentId>(),
    batchId: uuid('batch_id')
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    trigger: text('trigger', {
      enum: [
        'repeated_absence',
        'declining_scores',
        'low_scores',
        'missed_assessments',
        'overdue_catch_up',
        'other',
      ],
    }).notNull(),
    description: text('description').notNull(),
    /** Support plan (brief 14): evidence, goal, action, owner, due, review, outcome. */
    evidence: text('evidence'),
    goal: text('goal'),
    responsibleStaffId: uuid('responsible_staff_id')
      .notNull()
      .references(() => staffMembers.id, { onDelete: 'restrict' })
      .$type<StaffMemberId>(),
    action: text('action').notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    reviewOn: date('review_on', { mode: 'string' }),
    status: text('status', { enum: ['open', 'in_progress', 'resolved', 'closed'] })
      .notNull()
      .default('open'),
    outcome: text('outcome'),
    parentContactStatus: text('parent_contact_status', {
      enum: ['not_contacted', 'contacted', 'unreachable', 'not_required'],
    })
      .notNull()
      .default('not_contacted'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('interventions_student_idx').on(t.studentId),
    index('interventions_staff_status_idx').on(t.responsibleStaffId, t.status),
    check(
      'interventions_status_check',
      sql`${t.status} IN ('open', 'in_progress', 'resolved', 'closed')`,
    ),
    check(
      'interventions_outcome_on_resolve',
      sql`${t.status} NOT IN ('resolved', 'closed') OR ${t.outcome} IS NOT NULL`,
    ),
    check(
      'interventions_trigger_check',
      sql`${t.trigger} IN ('repeated_absence', 'declining_scores', 'low_scores', 'missed_assessments', 'overdue_catch_up', 'other')`,
    ),
    check(
      'interventions_parent_contact_check',
      sql`${t.parentContactStatus} IN ('not_contacted', 'contacted', 'unreachable', 'not_required')`,
    ),
  ],
);

/**
 * Configurable academic rules (open-ended values → jsonb). Every value carries a
 * status: defaults shipped by the system are `proposed` until the owner approves
 * (e.g. the teacher workload cap, the minimum gap between assessments).
 */
export const academicSettings = academic.table(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    status: text('status', { enum: ['proposed', 'approved'] })
      .notNull()
      .default('proposed'),
    description: text('description').notNull(),
    updatedByUserId: uuid('updated_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    updatedAt: updatedAt(),
  },
  (t) => [check('settings_status_check', sql`${t.status} IN ('proposed', 'approved')`)],
);
