/**
 * OWNER: Business Ops OS — HR staff attendance (owner brief 23 Oct 2026 §12; supersedes D-032 in
 * part). Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts.
 * Raw punches, the daily status HR decides, and class delivery (Academic) are kept apart: a
 * present day never says classes were delivered, a missing teaching log never says absent.
 * No biometric device is connected (R12): punches are entered by hand or imported from a file.
 * Must not import ./ops.ts (ops.ts imports this file for staff_profiles.work_schedule_id).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { branches, type CoreBranchId } from './core';
import {
  createdAt,
  filled,
  inList,
  instant,
  isoDate,
  OPS_DECISION_STATES,
  ops,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';

export const OPS_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Working hours of one weekday (IST `HH:MM`), or null = weekly off. */
export type OpsWeeklyPattern = Record<
  (typeof OPS_WEEKDAYS)[number],
  { start: string; end: string } | null
>;
export const OPS_LEAVE_STATUSES = ['approved', 'cancelled'] as const;
export const OPS_PUNCH_DIRECTIONS = ['in', 'out'] as const;
export const OPS_PUNCH_SOURCES = ['manual', 'import'] as const;
export const OPS_ATTENDANCE_IMPORT_STATUSES = ['preview', 'committed'] as const;
export const OPS_DAILY_ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'half_day',
  'unmarked',
  'on_leave',
  'holiday',
  'weekly_off',
] as const;
export const OPS_ATTENDANCE_BASES = ['computed', 'hr_decision'] as const;
export const OPS_CORRECTION_STATUSES = ['pending', 'approved', 'rejected'] as const;

const sha256Check = (column: AnyPgColumn) => sql`${column} ~ '^[0-9a-f]{64}$'`;

/** A weekly working pattern; staff without one follow the single default schedule. */
export const opsWorkSchedules = ops.table(
  'work_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    weeklyPattern: jsonb('weekly_pattern').$type<OpsWeeklyPattern>().notNull(),
    /** Minutes after the start before an arrival counts as late (setting hr.attendance.late_grace_minutes is the default). */
    graceMinutes: integer('grace_minutes').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('work_schedules_name_key').on(t.name),
    uniqueIndex('work_schedules_one_default_key')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
    check('work_schedules_name_check', filled(t.name)),
    check('work_schedules_pattern_check', sql`jsonb_typeof(${t.weeklyPattern}) = 'object'`),
    check('work_schedules_grace_check', sql`${t.graceMinutes} BETWEEN 0 AND 240`),
  ],
);

/** Staff holiday (null branch = every branch). Not batch calendar exclusions (Academic). */
export const opsHolidays = ops.table(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    holidayOn: isoDate('holiday_on').notNull(),
    name: text('name').notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'restrict' })
      .$type<CoreBranchId>(),
    decisionState: text('decision_state', { enum: OPS_DECISION_STATES })
      .notNull()
      .default('proposed'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('holidays_day_branch_key').on(t.holidayOn, t.branchId).nullsNotDistinct(),
    check('holidays_name_check', filled(t.name)),
    check(
      'holidays_decision_state_check',
      sql`${t.decisionState} IN ${inList(OPS_DECISION_STATES)}`,
    ),
  ],
);

/** Approved leave recorded by HR (leave requests are not modelled). `kind` is HR's own wording. */
export const opsLeaveRecords = ops.table(
  'leave_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    fromDate: isoDate('from_date').notNull(),
    toDate: isoDate('to_date').notNull(),
    kind: text('kind').notNull(),
    status: text('status', { enum: OPS_LEAVE_STATUSES }).notNull().default('approved'),
    approvedBy: userRef('approved_by').notNull(),
    reason: text('reason'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('leave_records_staff_from_idx').on(t.staffId, t.fromDate),
    check('leave_records_status_check', sql`${t.status} IN ${inList(OPS_LEAVE_STATUSES)}`),
    check('leave_records_dates_check', sql`${t.toDate} >= ${t.fromDate}`),
    check('leave_records_kind_check', filled(t.kind)),
  ],
);

/** One uploaded punch file; the same file (sha256) is processed once. `rows` = parsed preview. */
export const opsAttendanceImports = ops.table(
  'attendance_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sha256: text('sha256').notNull(),
    /** Where the file came from, as entered (never claims a device connection). */
    sourceLabel: text('source_label').notNull(),
    rows: jsonb('rows').$type<unknown[]>().notNull(),
    rowsTotal: integer('rows_total').notNull().default(0),
    rowsValid: integer('rows_valid').notNull().default(0),
    rowsInvalid: integer('rows_invalid').notNull().default(0),
    rowsDuplicate: integer('rows_duplicate').notNull().default(0),
    status: text('status', { enum: OPS_ATTENDANCE_IMPORT_STATUSES }).notNull().default('preview'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    committedAt: instant('committed_at'),
    committedBy: userRef('committed_by'),
    isSample: boolean('is_sample').notNull().default(false),
  },
  (t) => [
    uniqueIndex('attendance_imports_sha256_key').on(t.sha256),
    check('attendance_imports_sha_check', sha256Check(t.sha256)),
    check(
      'attendance_imports_status_check',
      sql`${t.status} IN ${inList(OPS_ATTENDANCE_IMPORT_STATUSES)}`,
    ),
    check(
      'attendance_imports_committed_check',
      sql`(${t.status} = 'committed') = (${t.committedAt} IS NOT NULL) AND (${t.committedAt} IS NULL) = (${t.committedBy} IS NULL)`,
    ),
    check(
      'attendance_imports_counts_check',
      sql`LEAST(${t.rowsTotal}, ${t.rowsValid}, ${t.rowsInvalid}, ${t.rowsDuplicate}) >= 0 AND ${t.rowsValid} + ${t.rowsInvalid} + ${t.rowsDuplicate} <= ${t.rowsTotal}`,
    ),
    check('attendance_imports_source_check', filled(t.sourceLabel)),
  ],
);

/** A raw check-in or check-out. The same punch is stored once, whatever its source. */
export const opsAttendancePunches = ops.table(
  'attendance_punches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    punchedAt: instant('punched_at').notNull(),
    direction: text('direction', { enum: OPS_PUNCH_DIRECTIONS }).notNull(),
    source: text('source', { enum: OPS_PUNCH_SOURCES }).notNull(),
    /** Row reference inside the source file, or a note for a manual entry. */
    sourceRef: text('source_ref'),
    importId: uuid('import_id').references(() => opsAttendanceImports.id, {
      onDelete: 'restrict',
    }),
    enteredBy: userRef('entered_by').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attendance_punches_staff_time_key').on(t.staffId, t.punchedAt, t.direction),
    index('attendance_punches_import_idx').on(t.importId),
    check(
      'attendance_punches_direction_check',
      sql`${t.direction} IN ${inList(OPS_PUNCH_DIRECTIONS)}`,
    ),
    check('attendance_punches_source_check', sql`${t.source} IN ${inList(OPS_PUNCH_SOURCES)}`),
    check(
      'attendance_punches_import_check',
      sql`(${t.source} = 'import') = (${t.importId} IS NOT NULL)`,
    ),
  ],
);

/**
 * The day's attendance status: computed from punches, schedule, leave and holidays, or decided by
 * HR (`basis = hr_decision`, with who). `unmarked` = no data; never read as absent.
 */
export const opsDailyAttendance = ops.table(
  'daily_attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    workDate: isoDate('work_date').notNull(),
    status: text('status', { enum: OPS_DAILY_ATTENDANCE_STATUSES }).notNull().default('unmarked'),
    firstIn: instant('first_in'),
    lastOut: instant('last_out'),
    /** null = not computed (no schedule or no check-in). */
    lateMinutes: integer('late_minutes'),
    missingCheckout: boolean('missing_checkout').notNull().default(false),
    basis: text('basis', { enum: OPS_ATTENDANCE_BASES }).notNull().default('computed'),
    decidedByUserId: userRef('decided_by_user_id'),
    note: text('note'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('daily_attendance_staff_date_key').on(t.staffId, t.workDate),
    index('daily_attendance_date_status_idx').on(t.workDate, t.status),
    check(
      'daily_attendance_status_check',
      sql`${t.status} IN ${inList(OPS_DAILY_ATTENDANCE_STATUSES)}`,
    ),
    check('daily_attendance_basis_check', sql`${t.basis} IN ${inList(OPS_ATTENDANCE_BASES)}`),
    check(
      'daily_attendance_decided_check',
      sql`(${t.basis} = 'hr_decision') = (${t.decidedByUserId} IS NOT NULL)`,
    ),
    check(
      'daily_attendance_times_check',
      sql`${t.lastOut} IS NULL OR ${t.firstIn} IS NULL OR ${t.lastOut} >= ${t.firstIn}`,
    ),
    check('daily_attendance_late_check', sql`${t.lateMinutes} IS NULL OR ${t.lateMinutes} >= 0`),
  ],
);

/** An employee's request to correct one day; HR approves or rejects it (one open request per day). */
export const opsAttendanceCorrections = ops.table(
  'attendance_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    workDate: isoDate('work_date').notNull(),
    requestedStatus: text('requested_status', { enum: OPS_DAILY_ATTENDANCE_STATUSES }),
    requestedIn: instant('requested_in'),
    requestedOut: instant('requested_out'),
    reason: text('reason').notNull(),
    status: text('status', { enum: OPS_CORRECTION_STATUSES }).notNull().default('pending'),
    requestedByUserId: userRef('requested_by_user_id').notNull(),
    decidedBy: userRef('decided_by'),
    decidedAt: instant('decided_at'),
    decisionNote: text('decision_note'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('attendance_corrections_staff_date_idx').on(t.staffId, t.workDate),
    index('attendance_corrections_status_idx').on(t.status, t.workDate),
    uniqueIndex('attendance_corrections_one_pending_key')
      .on(t.staffId, t.workDate)
      .where(sql`${t.status} = 'pending'`),
    check(
      'attendance_corrections_status_check',
      sql`${t.status} IN ${inList(OPS_CORRECTION_STATUSES)}`,
    ),
    check(
      'attendance_corrections_requested_status_check',
      sql`${t.requestedStatus} IS NULL OR ${t.requestedStatus} IN ${inList(OPS_DAILY_ATTENDANCE_STATUSES)}`,
    ),
    check('attendance_corrections_reason_check', filled(t.reason)),
    check(
      'attendance_corrections_something_check',
      sql`num_nonnulls(${t.requestedStatus}, ${t.requestedIn}, ${t.requestedOut}) > 0`,
    ),
    check(
      'attendance_corrections_decided_check',
      sql`(${t.status} = 'pending') = (${t.decidedAt} IS NULL) AND (${t.decidedAt} IS NULL) = (${t.decidedBy} IS NULL) AND (${t.status} <> 'rejected' OR ${filled(t.decisionNote)})`,
    ),
  ],
);
