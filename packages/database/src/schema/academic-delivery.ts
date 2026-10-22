/**
 * OWNER: Academic OS team (teacher workspace, owner brief 21 Oct 2026).
 *
 * Delivery tables of the `academic` schema: effective-dated batch placements, timetable
 * patterns, planned/actual session teachers, teacher unavailability and demo attendees.
 * Same rules as academic.ts (`academic.table`, `academic` prefix, UUID PKs, FKs only within
 * academic or into core, only `import type` from workspace packages).
 *
 * - Placement history is kept: a transfer ends the open placement and opens a new one.
 * - Delivery (`class_sessions.delivered_at`), attendance and the teaching log are separate
 *   facts (R12); none of them is HR attendance.
 * - Teacher unavailability is an ACADEMIC availability record entered by a coordinator, not
 *   HR leave (R2). It flags affected classes; it never assigns a substitute.
 * - Demo attendees link an Academic session to an Ops demo session (plain UUID, D-005) and
 *   the canonical student (R5).
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
  StudentIdentityId,
  UserId,
} from '@elevate/shared-types';
import { ACADEMIC_TEACHER_ROLES, academic, createdAt, inList, updatedAt } from './academic-columns';
import {
  academicBatches,
  academicClassSessions,
  academicEnrolments,
  academicRooms,
  academicSubjects,
  type AcademicRoomId,
  type AcademicSessionId,
  type AcademicSubjectId,
} from './academic';
import { staffMembers, students as coreStudents, users } from './core';

export type AcademicPlacementId = Brand<string, 'AcademicPlacementId'>;
export type AcademicPatternId = Brand<string, 'AcademicPatternId'>;
export type AcademicSessionTeacherId = Brand<string, 'AcademicSessionTeacherId'>;
export type AcademicUnavailabilityId = Brand<string, 'AcademicUnavailabilityId'>;
export type AcademicDemoAttendeeId = Brand<string, 'AcademicDemoAttendeeId'>;

export const ACADEMIC_PATTERN_STATUSES = ['draft', 'published', 'retired'] as const;
export const ACADEMIC_PARTICIPATIONS = ['planned', 'actual'] as const;
export const ACADEMIC_DEMO_ATTENDANCE_STATUSES = [
  'not_recorded',
  'present',
  'absent',
  'late',
  'excused',
] as const;

const userRef = (name: string) =>
  uuid(name)
    .references(() => users.id, { onDelete: 'restrict' })
    .$type<UserId>();
const staffRef = (name: string) =>
  uuid(name)
    .references(() => staffMembers.id, { onDelete: 'restrict' })
    .$type<StaffMemberId>();
const isoDate = (name: string) => date(name, { mode: 'string' });
const instant = (name: string) => timestamp(name, { withTimezone: true });

/** Effective-dated batch membership of an enrolment (history is never rewritten). */
export const academicBatchPlacements = academic.table(
  'batch_placements',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicPlacementId>(),
    enrolmentId: uuid('enrolment_id')
      .notNull()
      .references(() => academicEnrolments.id, { onDelete: 'restrict' })
      .$type<EnrolmentId>(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    startDate: isoDate('start_date').notNull(),
    /** Last day in the batch; null = open. */
    endDate: isoDate('end_date'),
    reason: text('reason'),
    /** null = recorded by the system (migration 0009 backfill of enrolments that had no creator). */
    placedByUserId: userRef('placed_by_user_id'),
    transferFromPlacementId: uuid('transfer_from_placement_id')
      .references((): AnyPgColumn => academicBatchPlacements.id, { onDelete: 'restrict' })
      .$type<AcademicPlacementId>(),
    endedByUserId: userRef('ended_by_user_id'),
    endedReason: text('ended_reason'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('batch_placements_one_open_key')
      .on(t.enrolmentId)
      .where(sql`${t.endDate} IS NULL`),
    index('batch_placements_batch_dates_idx').on(t.batchId, t.startDate),
    check(
      'batch_placements_dates_order',
      sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
    check(
      'batch_placements_transfer_reason',
      sql`${t.transferFromPlacementId} IS NULL OR ${t.reason} IS NOT NULL`,
    ),
  ],
);

/**
 * Reusable weekly pattern (draft → published → retired). Publishing generates dated
 * `class_sessions` with `pattern_id`; a later edit is a new pattern from an effective date.
 */
export const academicTimetablePatterns = academic.table(
  'timetable_patterns',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicPatternId>(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => academicBatches.id, { onDelete: 'restrict' })
      .$type<BatchId>(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => academicSubjects.id, { onDelete: 'restrict' })
      .$type<AcademicSubjectId>(),
    staffId: staffRef('staff_id').notNull(),
    roomId: uuid('room_id')
      .references(() => academicRooms.id, { onDelete: 'restrict' })
      .$type<AcademicRoomId>(),
    onlineLink: text('online_link'),
    /** ISO weekday, 1 = Monday … 7 = Sunday. */
    weekday: integer('weekday').notNull(),
    /** Local (Asia/Kolkata) `HH:MM`. */
    startTime: text('start_time').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    effectiveFrom: isoDate('effective_from').notNull(),
    effectiveTo: isoDate('effective_to'),
    status: text('status', { enum: ACADEMIC_PATTERN_STATUSES }).notNull().default('draft'),
    publishedByUserId: userRef('published_by_user_id'),
    publishedAt: instant('published_at'),
    createdByUserId: userRef('created_by_user_id').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('timetable_patterns_batch_status_idx').on(t.batchId, t.status),
    index('timetable_patterns_staff_weekday_idx').on(t.staffId, t.weekday),
    check(
      'timetable_patterns_status_check',
      sql`${t.status} IN (${inList(ACADEMIC_PATTERN_STATUSES)})`,
    ),
    check('timetable_patterns_weekday_range', sql`${t.weekday} BETWEEN 1 AND 7`),
    check(
      'timetable_patterns_start_time_format',
      sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check('timetable_patterns_duration_range', sql`${t.durationMinutes} BETWEEN 5 AND 600`),
    check(
      'timetable_patterns_effective_order',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    check(
      'timetable_patterns_published_stamp',
      sql`(${t.publishedAt} IS NULL) = (${t.publishedByUserId} IS NULL) AND (${t.status} = 'draft' OR ${t.publishedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Who was planned to teach a session and who actually taught it (one row per teacher and
 * participation). A substitution names the replaced teacher, a reason and who authorised it.
 * Removing a teacher sets `removed_at`; rows are never deleted.
 */
export const academicSessionTeachers = academic.table(
  'session_teachers',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicSessionTeacherId>(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => academicClassSessions.id, { onDelete: 'restrict' })
      .$type<AcademicSessionId>(),
    staffId: staffRef('staff_id').notNull(),
    role: text('role', { enum: ACADEMIC_TEACHER_ROLES }).notNull().default('primary'),
    participation: text('participation', { enum: ACADEMIC_PARTICIPATIONS }).notNull(),
    replacesStaffId: staffRef('replaces_staff_id'),
    reason: text('reason'),
    authorisedByUserId: userRef('authorised_by_user_id'),
    createdAt: createdAt(),
    removedAt: instant('removed_at'),
  },
  (t) => [
    uniqueIndex('session_teachers_active_key')
      .on(t.sessionId, t.staffId, t.participation)
      .where(sql`${t.removedAt} IS NULL`),
    index('session_teachers_staff_idx').on(t.staffId, t.participation),
    check('session_teachers_role_check', sql`${t.role} IN (${inList(ACADEMIC_TEACHER_ROLES)})`),
    check(
      'session_teachers_participation_check',
      sql`${t.participation} IN (${inList(ACADEMIC_PARTICIPATIONS)})`,
    ),
    check(
      'session_teachers_substitution_authorised',
      sql`${t.replacesStaffId} IS NULL OR (${t.reason} IS NOT NULL AND ${t.authorisedByUserId} IS NOT NULL AND ${t.replacesStaffId} <> ${t.staffId})`,
    ),
  ],
);

/** Academic availability record (not HR leave, R2): flags affected classes for the coordinator. */
export const academicTeacherUnavailability = academic.table(
  'teacher_unavailability',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicUnavailabilityId>(),
    staffId: staffRef('staff_id').notNull(),
    fromDate: isoDate('from_date').notNull(),
    toDate: isoDate('to_date').notNull(),
    reason: text('reason').notNull(),
    enteredByUserId: userRef('entered_by_user_id').notNull(),
    createdAt: createdAt(),
    cancelledAt: instant('cancelled_at'),
    cancelledByUserId: userRef('cancelled_by_user_id'),
  },
  (t) => [
    index('teacher_unavailability_staff_from_idx').on(t.staffId, t.fromDate),
    check('teacher_unavailability_dates_order', sql`${t.toDate} >= ${t.fromDate}`),
    check(
      'teacher_unavailability_cancel_pair',
      sql`(${t.cancelledAt} IS NULL) = (${t.cancelledByUserId} IS NULL)`,
    ),
  ],
);

/**
 * A demo student on an Academic class roster (R5, owner answer 3). The teacher marks
 * attendance here; Ops reads it back by `ops_demo_session_id`. No enrolment entitlement.
 */
export const academicSessionDemoAttendees = academic.table(
  'session_demo_attendees',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicDemoAttendeeId>(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => academicClassSessions.id, { onDelete: 'restrict' })
      .$type<AcademicSessionId>(),
    /** ops.demo_sessions.id (other module: no FK, D-005). */
    opsDemoSessionId: uuid('ops_demo_session_id').notNull(),
    coreStudentId: uuid('core_student_id')
      .notNull()
      .references(() => coreStudents.id, { onDelete: 'restrict' })
      .$type<StudentIdentityId>(),
    displayName: text('display_name').notNull(),
    demoDayNumber: integer('demo_day_number').notNull(),
    status: text('status', { enum: ACADEMIC_DEMO_ATTENDANCE_STATUSES })
      .notNull()
      .default('not_recorded'),
    recordedByUserId: userRef('recorded_by_user_id'),
    recordedAt: instant('recorded_at'),
    note: text('note'),
    addedByUserId: userRef('added_by_user_id').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('session_demo_attendees_session_demo_key').on(t.sessionId, t.opsDemoSessionId),
    index('session_demo_attendees_demo_idx').on(t.opsDemoSessionId),
    index('session_demo_attendees_student_idx').on(t.coreStudentId),
    check(
      'session_demo_attendees_status_check',
      sql`${t.status} IN (${inList(ACADEMIC_DEMO_ATTENDANCE_STATUSES)})`,
    ),
    check('session_demo_attendees_day_range', sql`${t.demoDayNumber} BETWEEN 1 AND 10`),
    check(
      'session_demo_attendees_recorded_has_actor',
      sql`${t.status} = 'not_recorded' OR (${t.recordedByUserId} IS NOT NULL AND ${t.recordedAt} IS NOT NULL)`,
    ),
  ],
);
